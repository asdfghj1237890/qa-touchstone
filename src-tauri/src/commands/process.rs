use crate::events::COMMAND_OUTPUT;
use crate::state::AppState;
use std::process::Stdio;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncReadExt;

/// 通用設定 —— pipe stdout/stderr、設工作目錄、Unix 上的 PATH/process group。
fn finalize_cmd(
    mut cmd: tokio::process::Command,
    working_directory: &Option<String>,
) -> tokio::process::Command {
    if let Some(dir) = working_directory {
        if !dir.is_empty() {
            cmd.current_dir(dir);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // 覆寫 PATH（對齊 Electron），其餘 env 繼承
        cmd.env(
            "PATH",
            "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin",
        );
        // 讓子程序自成 process group（pgid==pid），供 stop_command 砍整 group
        cmd.process_group(0);
    }
    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW (0x08000000)：k6.exe 是 console 程式，GUI app 下
        // spawn 會閃出一個黑色 console 視窗。帶此 flag 隱藏視窗；stdout/stderr
        // 仍是 pipe，不影響 ndjson 擷取。
        cmd.creation_flags(0x0800_0000);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd
}

/// Structured-args spawn — no shell interpretation. Use this for trusted
/// programs (e.g. the bundled k6 binary) to keep injection surface zero.
fn build_program(
    program: &str,
    args: &[String],
    working_directory: &Option<String>,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    finalize_cmd(cmd, working_directory)
}

fn validate_k6_args(args: &[String]) -> Result<(), String> {
    const PREFIX: [&str; 6] = [
        "run",
        "--quiet",
        "--summary-mode",
        "disabled",
        "--out",
        "json=-",
    ];
    if args.len() != PREFIX.len() + 1
        || !PREFIX
            .iter()
            .enumerate()
            .all(|(i, expected)| args[i] == *expected)
    {
        return Err("Unsupported k6 invocation".into());
    }
    let script = std::path::PathBuf::from(&args[PREFIX.len()]);
    let canon_script =
        std::fs::canonicalize(&script).map_err(|e| format!("Invalid k6 script path: {e}"))?;
    let temp = std::env::temp_dir();
    let canon_temp = std::fs::canonicalize(&temp).unwrap_or(temp);
    if !canon_script.starts_with(&canon_temp) {
        return Err("Refusing to run a k6 script outside the temp dir".into());
    }
    if canon_script
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("js"))
        != Some(true)
    {
        return Err("k6 script must be a .js temp file".into());
    }
    Ok(())
}

fn k6_program(app: &AppHandle) -> String {
    #[cfg(target_os = "windows")]
    let rel = "resources/k6.exe";
    #[cfg(not(target_os = "windows"))]
    let rel = "resources/k6";

    app.path()
        .resolve(rel, BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists())
        .and_then(|p| p.to_str().map(String::from))
        .unwrap_or_else(|| "k6".into())
}

/// Shared spawn-stream-wait body used by the k6 runner. Returns the exit code
/// (or -1 if killed).
async fn spawn_stream_wait(
    state: &AppState,
    app: AppHandle,
    mut cmd: tokio::process::Command,
) -> Result<i32, String> {
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    let our_pid = child.id();
    if let Some(pid) = our_pid {
        *state.current_process_pid.lock() = Some(pid);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut handles = Vec::new();
    if let Some(out) = stdout {
        let app_c = app.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            stream_to_events(out, app_c).await
        }));
    }
    if let Some(err) = stderr {
        let app_c = app.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            stream_to_events(err, app_c).await
        }));
    }

    let status = child.wait().await;
    for h in handles {
        let _ = h.await;
    }
    // 擁有權檢查：只有 current_process_pid 仍是這次寫的值才清掉。
    if let Some(our) = our_pid {
        let mut guard = state.current_process_pid.lock();
        if *guard == Some(our) {
            *guard = None;
        }
    }
    match status {
        Ok(s) => Ok(s.code().unwrap_or(-1)),
        Err(e) => Err(e.to_string()),
    }
}

/// 讀一條串流、逐塊 emit command-output（保留 \r 進度更新；不以行為單位緩衝）。
async fn stream_to_events<R: AsyncReadExt + Unpin>(mut reader: R, app: AppHandle) {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = app.emit(COMMAND_OUTPUT, chunk);
            }
            Err(_) => break,
        }
    }
}

#[tauri::command]
pub async fn run_k6(
    app: AppHandle,
    state: State<'_, AppState>,
    args: Vec<String>,
    working_directory: Option<String>,
) -> Result<i32, String> {
    validate_k6_args(&args)?;
    let program = k6_program(&app);
    let cmd = build_program(&program, &args, &working_directory);
    spawn_stream_wait(&state, app, cmd).await
}

pub(crate) fn kill_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // /T 連子程序、/F 強制；CREATE_NO_WINDOW 別讓 taskkill 自己也閃 console
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        // 子程序在 spawn 時 process_group(0) → pgid==pid；砍整個 group（負號）
        let _ = std::process::Command::new("kill")
            .args(["-KILL", &format!("-{pid}")])
            .output();
    }
}

#[tauri::command]
pub fn stop_command(state: State<AppState>) {
    let pid = state.current_process_pid.lock().take();
    if let Some(pid) = pid {
        kill_tree(pid);
    }
    // 對齊 Electron：resolve 無回傳值
}

#[cfg(test)]
mod tests {
    use super::*;

    // Structured-args path bypasses cmd /C / zsh -c.
    // does not need shell interpretation. Spawning the platform's
    // built-in echo program lets us verify args are passed positionally.
    #[tokio::test]
    async fn build_program_spawns_without_shell() {
        #[cfg(target_os = "windows")]
        let (prog, args) = (
            "cmd",
            vec!["/C".to_string(), "echo".to_string(), "hi".to_string()],
        );
        #[cfg(not(target_os = "windows"))]
        let (prog, args) = ("/bin/echo", vec!["hi".to_string()]);
        let mut cmd = build_program(prog, &args, &None);
        let mut child = cmd.spawn().expect("spawn");
        let mut out = child.stdout.take().unwrap();
        let mut s = String::new();
        let mut buf = [0u8; 1024];
        loop {
            let n = out.read(&mut buf).await.unwrap();
            if n == 0 {
                break;
            }
            s.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
        let status = child.wait().await.unwrap();
        assert_eq!(status.code(), Some(0));
        assert!(s.contains("hi"), "stdout was: {s:?}");
    }

    #[test]
    fn validate_k6_args_accepts_only_temp_js_script() {
        let path = std::env::temp_dir().join(format!("qa-k6-{}-test.js", std::process::id()));
        std::fs::write(&path, "export default function() {}\n").unwrap();
        let args = vec![
            "run".into(),
            "--quiet".into(),
            "--summary-mode".into(),
            "disabled".into(),
            "--out".into(),
            "json=-".into(),
            path.to_string_lossy().to_string(),
        ];
        assert!(validate_k6_args(&args).is_ok());
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn validate_k6_args_rejects_arbitrary_program_shapes() {
        let args = vec!["version".into()];
        assert!(validate_k6_args(&args).is_err());
    }

    // PID-ownership semantics: even if a second run finishes BEFORE
    // the first (because the first is a longer command), the first's
    // finalizer must not clobber the second's PID. We simulate by directly
    // exercising the lock pattern used inside spawn_stream_wait.
    #[test]
    fn pid_ownership_does_not_clobber_unrelated_pids() {
        use parking_lot::Mutex;
        let guard = Mutex::new(None::<u32>);
        // run A writes PID 100
        let our_a: u32 = 100;
        *guard.lock() = Some(our_a);
        // run B writes PID 200 (overwriting)
        let our_b: u32 = 200;
        *guard.lock() = Some(our_b);
        // run A finalizes — must NOT clear, since current is B's pid.
        {
            let mut g = guard.lock();
            if *g == Some(our_a) {
                *g = None;
            }
        }
        assert_eq!(
            *guard.lock(),
            Some(our_b),
            "A's finalizer wrongly cleared B's PID"
        );
        // run B finalizes — clears its own.
        {
            let mut g = guard.lock();
            if *g == Some(our_b) {
                *g = None;
            }
        }
        assert_eq!(*guard.lock(), None);
    }
}
