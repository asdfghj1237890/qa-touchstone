use crate::events::COMMAND_OUTPUT;
use crate::state::AppState;
use std::process::Stdio;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncReadExt;

/// 依平台決定 shell 程式與參數。非 Windows 會套用 nrfjprog 改寫。
fn shell_invocation(command: &str) -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        ("cmd".to_string(), vec!["/C".to_string(), command.to_string()])
    }
    #[cfg(not(target_os = "windows"))]
    {
        ("/bin/zsh".to_string(), vec!["-c".to_string(), rewrite_nrfjprog(command)])
    }
}

/// macOS/Linux：含 nrfjprog 時改絕對路徑 + sudo（對齊 Electron）。Windows 不會呼叫此函式。
#[cfg(not(target_os = "windows"))]
fn rewrite_nrfjprog(command: &str) -> String {
    if !command.contains("nrfjprog") {
        return command.to_string();
    }
    if let Ok(out) = std::process::Command::new("which").arg("nrfjprog").output() {
        if out.status.success() {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                return format!("sudo {}", command.replace("nrfjprog", &path));
            }
        }
    }
    for p in [
        "/usr/local/bin/nrfjprog",
        "/opt/homebrew/bin/nrfjprog",
        "/usr/bin/nrfjprog",
        "/opt/local/bin/nrfjprog",
    ] {
        if std::path::Path::new(p).exists() {
            return format!("sudo {}", command.replace("nrfjprog", p));
        }
    }
    format!("sudo {command}")
}

fn build_command(command: &str, working_directory: &Option<String>) -> tokio::process::Command {
    let (program, args) = shell_invocation(command);
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
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
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd
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
pub async fn run_command(
    app: AppHandle,
    state: State<'_, AppState>,
    command: String,
    working_directory: Option<String>,
) -> Result<i32, String> {
    let mut cmd = build_command(&command, &working_directory);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    // 記錄 PID（block scope：parking_lot guard 不跨 await）。捕捉自己的 PID
    // 以便 wait 結束時做擁有權檢查 —— 若使用者已啟動下一輪 run_command，
    // current_process_pid 會被新的覆寫，我們不能把它抹掉。
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
    // 擁有權檢查：只有當 current_process_pid 仍是我們這次寫進去的值才清掉，
    // 否則代表已有新的 run_command 寫入了它的 PID，不能誤抹（會讓 stop_command
    // 對新 run 失效）。
    if let Some(our) = our_pid {
        let mut guard = state.current_process_pid.lock();
        if *guard == Some(our) {
            *guard = None;
        }
    }

    match status {
        // 被信號終止（如 Unix 上 stop_command 的 SIGKILL）時 code() 為 None → -1，
        // 非 spawn 失敗（那會在上方 spawn 時就 Err）。對齊 Electron 把 null code 當非零。
        Ok(s) => Ok(s.code().unwrap_or(-1)),
        Err(e) => Err(e.to_string()),
    }
}

pub(crate) fn kill_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        // /T 連子程序、/F 強制
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
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

    #[test]
    fn shell_invocation_per_platform() {
        let (prog, args) = shell_invocation("echo hello");
        #[cfg(target_os = "windows")]
        {
            assert_eq!(prog, "cmd");
            assert_eq!(args, vec!["/C".to_string(), "echo hello".to_string()]);
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(prog, "/bin/zsh");
            assert_eq!(args[0], "-c");
            assert_eq!(args[1], "echo hello"); // 無 nrfjprog → 不改寫
        }
    }

    #[tokio::test]
    async fn spawns_and_collects_output() {
        let mut cmd = build_command("echo hello", &None);
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
        assert!(s.contains("hello"), "stdout was: {s:?}");
    }
}
