use crate::events::{SERIAL_DATA_RECEIVED, SERIAL_ERROR, XMODEM_PROGRESS};
use crate::serial_xfer;
use crate::state::{AppState, SerialConfig};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
pub struct SerialResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<String>,
}

impl SerialResult {
    fn ok() -> Self { Self { success: true, error: None, port: None } }
    fn ok_port(p: String) -> Self { Self { success: true, error: None, port: Some(p) } }
    fn err(e: String) -> Self { Self { success: false, error: Some(e), port: None } }
}

fn data_bits(n: u8) -> serialport::DataBits {
    match n {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        _ => serialport::DataBits::Eight,
    }
}

fn stop_bits(n: u8) -> serialport::StopBits {
    match n {
        2 => serialport::StopBits::Two,
        _ => serialport::StopBits::One,
    }
}

fn parity(s: &str) -> serialport::Parity {
    match s.to_lowercase().as_str() {
        "odd" => serialport::Parity::Odd,
        "even" => serialport::Parity::Even,
        _ => serialport::Parity::None,
    }
}

/// 把 config Value 合併進 SerialConfig（對齊 Electron 的 {...cfg, ...incoming}）。
fn apply_config(cfg: &mut SerialConfig, incoming: &Value) {
    if let Some(p) = incoming.get("port").and_then(|v| v.as_str()) {
        cfg.port = p.to_string();
    }
    if let Some(b) = incoming.get("baudRate").and_then(|v| v.as_u64()) {
        cfg.baud_rate = b as u32;
    }
    if let Some(d) = incoming.get("dataBits").and_then(|v| v.as_u64()) {
        cfg.data_bits = d as u8;
    }
    if let Some(s) = incoming.get("stopBits").and_then(|v| v.as_u64()) {
        cfg.stop_bits = s as u8;
    }
    if let Some(par) = incoming.get("parity").and_then(|v| v.as_str()) {
        cfg.parity = par.to_string();
    }
}

/// 把列舉到的埠對映成前端要的 {path, manufacturer}。
fn port_entry(path: &str, manufacturer: Option<&str>) -> Value {
    json!({
        "path": path,
        "manufacturer": manufacturer.unwrap_or("Unknown"),
    })
}

#[tauri::command]
pub fn list_serial_ports() -> Vec<Value> {
    match serialport::available_ports() {
        Ok(ports) => ports
            .into_iter()
            .map(|p| {
                let manufacturer = match &p.port_type {
                    serialport::SerialPortType::UsbPort(info) => info.manufacturer.clone(),
                    _ => None,
                };
                port_entry(&p.port_name, manufacturer.as_deref())
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
pub fn configure_serial_port(state: State<AppState>, config: Value) -> SerialResult {
    let mut s = state.serial.lock();
    apply_config(&mut s.config, &config);
    SerialResult::ok()
}

fn stop_reader(s: &mut crate::state::SerialState) {
    if let Some(flag) = s.reader_stop.take() {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn open_serial_port(state: State<AppState>, port_path: Option<String>) -> SerialResult {
    let mut s = state.serial.lock();
    // 先關舊
    stop_reader(&mut s);
    s.port = None;

    let path = match port_path.filter(|p| !p.is_empty()) {
        Some(p) => p,
        None => s.config.port.clone(),
    };
    s.config.port = path.clone();
    let cfg = s.config.clone();

    let built = serialport::new(&path, cfg.baud_rate)
        .data_bits(data_bits(cfg.data_bits))
        .stop_bits(stop_bits(cfg.stop_bits))
        .parity(parity(&cfg.parity))
        .timeout(Duration::from_millis(100))
        .open();

    match built {
        Ok(port) => {
            s.port = Some(port);
            SerialResult::ok_port(path)
        }
        Err(e) => SerialResult::err(e.to_string()),
    }
}

#[tauri::command]
pub fn close_serial_port(state: State<AppState>) -> SerialResult {
    let mut s = state.serial.lock();
    stop_reader(&mut s);
    s.port = None; // drop → 關閉
    SerialResult::ok()
}

#[tauri::command]
pub fn send_serial_data(state: State<AppState>, data: String) -> SerialResult {
    let mut s = state.serial.lock();
    match s.port.as_mut() {
        Some(port) => match port.write_all(data.as_bytes()) {
            Ok(()) => SerialResult::ok(),
            Err(e) => SerialResult::err(e.to_string()),
        },
        None => SerialResult::err("Serial port not open".into()),
    }
}

#[tauri::command]
pub fn start_serial_listening(app: AppHandle, state: State<AppState>) -> SerialResult {
    let mut s = state.serial.lock();
    // 停掉舊的讀取執行緒（避免重複）
    stop_reader(&mut s);

    let reader = match s.port.as_ref() {
        Some(port) => match port.try_clone() {
            Ok(r) => r,
            Err(e) => return SerialResult::err(e.to_string()),
        },
        None => return SerialResult::err("Serial port not open".into()),
    };

    let stop = Arc::new(AtomicBool::new(false));
    s.reader_stop = Some(stop.clone());
    let app_c = app.clone();

    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 1024];
        loop {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                // Ok(0) 通常代表 EOF/裝置斷線；小睡避免持續斷線時忙等吃滿 CPU。
                Ok(0) => std::thread::sleep(Duration::from_millis(50)),
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_c.emit(SERIAL_DATA_RECEIVED, chunk);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {} // 無資料，續迴圈
                Err(e) => {
                    let _ = app_c.emit(SERIAL_ERROR, e.to_string());
                    break;
                }
            }
        }
    });

    SerialResult::ok()
}

fn emit_progress(app: &AppHandle, status: &str, message: &str) {
    let _ = app.emit(XMODEM_PROGRESS, json!({ "status": status, "message": message }));
}

/// 寫指令並讀到 is_done 為真或逾時；過程逐塊 emit serial-data-received。回傳累積回應。
fn run_transaction(
    port: &mut Box<dyn serialport::SerialPort>,
    app: &AppHandle,
    command: &str,
    timeout: Duration,
    is_done: impl Fn(&str) -> bool,
) -> Result<String, String> {
    // 清掉殘留 RX（對齊 Electron 送指令前的 flush）。背景 reader 已於呼叫前停掉並 drain，
    // 故此時 RX 只剩裝置雜訊；清除後再寫指令，避免雜訊混入回應。
    let _ = port.clear(serialport::ClearBuffer::Input);
    port.write_all(command.as_bytes()).map_err(|e| e.to_string())?;
    let mut response = String::new();
    let deadline = Instant::now() + timeout;
    let mut buf = [0u8; 1024];
    while Instant::now() < deadline {
        match port.read(&mut buf) {
            Ok(0) => std::thread::sleep(Duration::from_millis(20)),
            Ok(n) => {
                let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                if !chunk.trim().is_empty() {
                    let _ = app.emit(SERIAL_DATA_RECEIVED, chunk.clone());
                }
                response.push_str(&chunk);
                if is_done(&response) {
                    break;
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(response)
}

fn ends_with_prompt(response: &str) -> bool {
    let last = response.rsplit('\n').next().unwrap_or("");
    last == "# " || last == "$ " || last.ends_with("# ") || last.ends_with("$ ")
}

fn basename(p: &str) -> String {
    p.rsplit(['/', '\\']).next().unwrap_or(p).to_string()
}

fn safe_local_child(root: &Path, name: &str) -> Result<PathBuf, String> {
    let safe_name = serial_xfer::safe_listing_name(name)
        .ok_or_else(|| "Unsafe file name from device listing".to_string())?;
    let child = root.join(safe_name);
    if child.exists() {
        let root_canon = std::fs::canonicalize(root)
            .map_err(|e| format!("Invalid download root: {e}"))?;
        let child_canon = std::fs::canonicalize(&child)
            .map_err(|e| format!("Invalid existing download path: {e}"))?;
        if !child_canon.starts_with(&root_canon) {
            return Err("Existing download path escapes the selected folder".into());
        }
    }
    Ok(child)
}

#[tauri::command]
pub fn send_file_serial(app: AppHandle, state: State<AppState>, file_path: String, dest_path: String) -> Value {
    let content = match std::fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(e) => return json!({ "success": false, "error": e.to_string() }),
    };
    let file_name = basename(&file_path);
    let final_dest = serial_xfer::compute_send_dest(&dest_path, &file_name);
    let command = format!(
        "echo {} > {}\n",
        serial_xfer::shell_quote(&content),
        serial_xfer::shell_quote(&final_dest),
    );

    let mut s = state.serial.lock();
    if s.transfer_active.swap(true, Ordering::SeqCst) {
        return json!({ "success": false, "error": "Operation already in progress or duplicate call detected" });
    }
    stop_reader(&mut s);
    std::thread::sleep(Duration::from_millis(200)); // 讓背景 reader 退出，避免搶讀

    let result = (|| {
        let port = match s.port.as_mut() {
            Some(p) => p,
            None => return json!({ "success": false, "error": "Serial port not open" }),
        };
        emit_progress(&app, "sending", "Sending file content...");
        emit_progress(&app, "waiting", "Waiting for command completion...");
        match run_transaction(port, &app, &command, Duration::from_secs(10), |r| r.contains("# ") || r.contains("$ ")) {
            Ok(resp) => {
                if resp.contains("Permission denied") {
                    emit_progress(&app, "error", "Send failed: Permission denied");
                    json!({ "success": false, "error": "Permission denied" })
                } else if resp.contains("Is a directory") {
                    let msg = "Destination is a directory - file path needed";
                    emit_progress(&app, "error", &format!("Send failed: {msg}"));
                    json!({ "success": false, "error": msg })
                } else if resp.contains("No such file") {
                    let msg = "File transfer failed - check permissions and paths";
                    emit_progress(&app, "error", &format!("Send failed: {msg}"));
                    json!({ "success": false, "error": msg })
                } else {
                    emit_progress(&app, "completed", "File sent successfully via serial commands");
                    json!({ "success": true, "message": "File sent successfully via serial commands" })
                }
            }
            Err(e) => json!({ "success": false, "error": e }),
        }
    })();

    s.transfer_active.store(false, Ordering::SeqCst);
    result
}

fn receive_single_file(app: &AppHandle, s: &mut crate::state::SerialState, save_path: &Path, remote_path: &str) -> Value {
    emit_progress(app, "starting", "Preparing to receive file...");
    let is_text = serial_xfer::is_likely_text(remote_path);
    let command = serial_xfer::build_receive_command(remote_path, is_text);

    let port = match s.port.as_mut() {
        Some(p) => p,
        None => return json!({ "success": false, "error": "Serial port not open" }),
    };
    emit_progress(app, "sending", "Sending enhanced file read command...");
    emit_progress(app, "waiting", "Waiting for file content...");
    let response = match run_transaction(port, app, &command, Duration::from_secs(30), |r| {
        r.contains("=== FILE_END ===") || ends_with_prompt(r)
    }) {
        Ok(r) => r,
        Err(e) => return json!({ "success": false, "error": e }),
    };

    let parsed = match serial_xfer::parse_file_response(&response, remote_path) {
        Ok(p) => p,
        Err(e) => return json!({ "success": false, "error": e }),
    };
    let fin = match serial_xfer::finalize(&parsed.content, parsed.expected_size) {
        Ok(f) => f,
        Err(e) => return json!({ "success": false, "error": e }),
    };
    if let Err(e) = std::fs::write(save_path, &fin.bytes) {
        return json!({ "success": false, "error": e.to_string() });
    }
    let mut out = json!({
        "success": true,
        "filePath": save_path.to_string_lossy(),
        "size": fin.bytes.len(),
    });
    if let Some(e) = parsed.expected_size {
        out["expectedSize"] = json!(e);
        out["verified"] = json!(fin.verified.unwrap_or(false));
    }
    out
}

fn listing_done(response: &str) -> bool {
    let last = response.rsplit('\n').next().unwrap_or("");
    let has_prompt = ["# ", "$ ", "> ", ">> ", "~#", "~$"].iter().any(|p| last.contains(p));
    has_prompt && (response.contains("total ") || response.contains("No such file or directory"))
}

fn receive_directory(app: &AppHandle, s: &mut crate::state::SerialState, save_path: &Path, remote_path: &str) -> Value {
    emit_progress(app, "starting", "Listing directory contents...");
    let command = format!("cd {} && ls -l\n", serial_xfer::shell_quote(remote_path));
    let response = {
        let port = match s.port.as_mut() {
            Some(p) => p,
            None => return json!({ "success": false, "error": "Serial port not open" }),
        };
        emit_progress(app, "sending", "Getting file list...");
        emit_progress(app, "waiting", "Waiting for file list...");
        match run_transaction(port, app, &command, Duration::from_secs(15), listing_done) {
            Ok(r) => r,
            Err(e) => return json!({ "success": false, "error": e }),
        }
    };
    let entries = serial_xfer::parse_ls_output(&response);
    download_files_sequentially(app, s, save_path, remote_path, &entries)
}

fn download_files_sequentially(
    app: &AppHandle,
    s: &mut crate::state::SerialState,
    save_path: &Path,
    remote_path: &str,
    entries: &[(String, bool)],
) -> Value {
    if entries.is_empty() {
        return json!({ "success": true, "message": "No files found in directory", "fileCount": 0 });
    }
    let total = entries.len();
    let mut downloaded = 0u64;
    let mut processed_dirs = 0u64;
    emit_progress(app, "downloading", &format!("Starting download of {total} items..."));

    for (name, is_dir) in entries {
        if s.port.is_none() {
            break;
        }
        if *is_dir {
            let remote_dir = format!("{remote_path}/{name}");
            let local_dir = match safe_local_child(save_path, name) {
                Ok(p) => p,
                Err(e) => {
                    emit_progress(app, "downloading", &format!("Skipping unsafe entry {name}: {e}"));
                    continue;
                }
            };
            if let Err(e) = std::fs::create_dir_all(&local_dir) {
                emit_progress(app, "downloading", &format!("Skipping {name}: {e}"));
                continue;
            }
            emit_progress(app, "downloading", &format!("Processing directory {name}..."));
            let r = receive_directory(app, s, &local_dir, &remote_dir);
            if r.get("success").and_then(|v| v.as_bool()) == Some(true) {
                processed_dirs += 1;
            }
        } else {
            let remote_file = format!("{remote_path}/{name}");
            let local_file = match safe_local_child(save_path, name) {
                Ok(p) => p,
                Err(e) => {
                    emit_progress(app, "downloading", &format!("Skipping unsafe entry {name}: {e}"));
                    continue;
                }
            };
            let mut retry = 0;
            loop {
                let result = receive_single_file(app, s, &local_file, &remote_file);
                if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
                    downloaded += 1;
                    let size = result.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
                    emit_progress(app, "downloading", &format!("Downloaded {name} ({size} bytes)"));
                    break;
                }
                retry += 1;
                if retry >= 3 {
                    break;
                }
                emit_progress(app, "downloading", &format!("Retrying {name} (attempt {}/3)...", retry + 1));
                std::thread::sleep(Duration::from_secs(1));
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    emit_progress(app, "completed", &format!("Completed: {downloaded} files, {processed_dirs} directories"));
    json!({
        "success": true,
        "message": format!("Downloaded {downloaded} files and processed {processed_dirs} directories"),
        "fileCount": downloaded,
        "dirCount": processed_dirs,
        "totalItems": total,
    })
}

#[tauri::command]
pub fn receive_file_serial(app: AppHandle, state: State<AppState>, save_path: String, remote_path: String) -> Value {
    let mut s = state.serial.lock();
    if s.transfer_active.swap(true, Ordering::SeqCst) {
        return json!({ "success": false, "error": "Operation already in progress or duplicate call detected" });
    }
    stop_reader(&mut s);
    std::thread::sleep(Duration::from_millis(200));

    let result = (|| {
        if s.port.is_none() {
            return json!({ "success": false, "error": "Serial port not open" });
        }
        let iso = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let folder = serial_xfer::com_cat_folder_name(&iso);
        let folder_path = Path::new(&save_path).join(&folder);
        if let Err(e) = std::fs::create_dir_all(&folder_path) {
            return json!({ "success": false, "error": format!("Failed to create com_cat folder: {e}") });
        }
        emit_progress(&app, "preparing", &format!("Created folder: {folder}"));

        let is_directory = remote_path.ends_with('/') || !remote_path.contains('.');
        if is_directory {
            let mut r = receive_directory(&app, &mut s, &folder_path, &remote_path);
            if r.get("success").and_then(|v| v.as_bool()) == Some(true) {
                r["comCatFolder"] = json!(folder);
                r["comCatFolderPath"] = json!(folder_path.to_string_lossy());
            }
            return r;
        }
        let file_name = remote_path.rsplit('/').next().filter(|x| !x.is_empty()).unwrap_or("received_file").to_string();
        let file_dest = folder_path.join(&file_name);
        let mut r = receive_single_file(&app, &mut s, &file_dest, &remote_path);
        if r.get("success").and_then(|v| v.as_bool()) == Some(true) {
            r["comCatFolder"] = json!(folder);
            r["comCatFolderPath"] = json!(folder_path.to_string_lossy());
        }
        r
    })();

    s.transfer_active.store(false, Ordering::SeqCst);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bits_and_parity_mapping() {
        assert_eq!(data_bits(8), serialport::DataBits::Eight);
        assert_eq!(data_bits(7), serialport::DataBits::Seven);
        assert_eq!(stop_bits(1), serialport::StopBits::One);
        assert_eq!(stop_bits(2), serialport::StopBits::Two);
        assert_eq!(parity("none"), serialport::Parity::None);
        assert_eq!(parity("Odd"), serialport::Parity::Odd);
        assert_eq!(parity("even"), serialport::Parity::Even);
    }

    #[test]
    fn apply_config_merges_fields() {
        let mut cfg = SerialConfig::default();
        apply_config(&mut cfg, &json!({ "port": "COM3", "baudRate": 115200 }));
        assert_eq!(cfg.port, "COM3");
        assert_eq!(cfg.baud_rate, 115200);
        assert_eq!(cfg.data_bits, 8); // 未提供 → 保留預設
        assert_eq!(cfg.parity, "none");
    }

    #[test]
    fn port_entry_shape() {
        let e = port_entry("COM7", Some("Acme"));
        assert_eq!(e["path"], "COM7");
        assert_eq!(e["manufacturer"], "Acme");
        let e2 = port_entry("COM1", None);
        assert_eq!(e2["manufacturer"], "Unknown");
    }

    #[test]
    fn list_serial_ports_does_not_panic() {
        let _ = list_serial_ports();
    }

    #[test]
    fn safe_local_child_rejects_path_escape_names() {
        let dir = std::env::temp_dir().join(format!("serialsafe_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(safe_local_child(&dir, "ok.txt").unwrap().ends_with("ok.txt"));
        assert!(safe_local_child(&dir, "../evil.txt").is_err());
        assert!(safe_local_child(&dir, "sub/evil.txt").is_err());
        assert!(safe_local_child(&dir, "sub\\evil.txt").is_err());
        assert!(safe_local_child(&dir, "/tmp/evil.txt").is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn safe_local_child_rejects_existing_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!("serialroot_{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("serialoutside_{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&outside, "outside").unwrap();
        symlink(&outside, root.join("link.txt")).unwrap();

        assert!(safe_local_child(&root, "link.txt").is_err());

        std::fs::remove_file(&outside).ok();
        std::fs::remove_dir_all(&root).ok();
    }
}
