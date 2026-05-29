# Tauri 遷移 — 階段 4b-2：序列檔案傳輸 I/O 編排（send + 單檔 receive，Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 4b-1 的純解析/解碼，組裝序列檔案傳輸的 I/O 編排：`send_file_serial`（送檔）與 `receive_file_serial`（dispatcher → **單檔**下載）+ `xmodem-progress` 事件，並接上前端 `sendFileSerial`/`receiveFileSerial`。遞迴目錄下載（receiveDirectorySerial）留待 4b-3。

**Architecture（重要設計決策）：** Electron 用 `on('data')` 廣播給「即時監聽」與「傳輸處理器」兩者；Rust 的阻塞式序列讀取無法兩個 reader 同時消費同一串流。故採「**傳輸期間由傳輸獨佔埠**」：傳輸 command 先 `stop_reader`（停掉 4a 背景監聽執行緒）、短暫等待其退出，再以主 handle 做「寫指令→迴圈讀到提示/標記或逾時」的同步交易，過程中一樣 `emit('serial-data-received')`（與 Electron 觀感一致），完成後背景監聽維持停止（前端可重新監聽）。傳輸 command 為**同步**（Tauri 在工作執行緒跑同步 command，阻塞讀取不影響 UI）；以 `SerialState.transfer_active: AtomicBool` 防止並行傳輸（對齊 Electron 的 activeIpcCalls 拒絕）。

**Tech Stack:** Rust（serialport、既有 serial_xfer/state、tauri 2）。

**⚠️ 驗證界線：** 序列 I/O 編排無法本機驗證，需 RFD 實機。可測的純 helper（送檔目的地計算、單引號跳脫、com_cat 資料夾命名）會單元測試。

參照：Electron `send-file-xmodem`(electron.js:2932-3062)、`receive-file-xmodem` dispatcher(:3064-3136)、`createComCatFolder`(:3138-3145)、`receiveSingleFileSerial`(:3147-3457)。

**逐字保留的契約：**
- `send_file_serial(filePath, destPath)`：讀檔（utf8）；destPath 以 `/` 結尾或（無 `.` 且不含檔名）視為目錄 → 補檔名；指令 `echo '<單引號跳脫的內容>' > <finalDest>\n`；寫入後讀到 `# `/`$ ` 視為完成；回應含 `No such file`/`Permission denied`/`Is a directory` → 失敗（訊息對齊）。成功 `{success:true, message:"File sent successfully via serial commands"}`。10s 逾時。
- `receive_file_serial(savePath, remotePath)`：並行/重複 → `{success:false, error:"Operation already in progress or duplicate call detected"}`；建 `com_cat_<ISO時間去:._>` 資料夾（emit `{status:'preparing', message:'Created folder: <name>'}`）；`remotePath` 以 `/` 結尾或無 `.` → 目錄（本階段回 `{success:false, error:"Directory transfer not yet implemented"}`，4b-3 補）；否則單檔下載到 `<folder>/<fileName>`。成功時加 `comCatFolder`/`comCatFolderPath`。
- 單檔下載：`build_receive_command`→寫→讀到提示/`FILE_END` 或 30s→`parse_file_response`→`finalize`→寫檔；回 `{success:true, filePath, size, expectedSize?, verified?}` 或 `{success:false, error}`。
- 單引號跳脫：`'` → `'"'"'`（對齊 Electron `replace(/'/g, "'\"'\"'")`）。

---

## File Structure

**修改（Rust）**
- `src-tauri/src/serial_xfer.rs` — 加純 helper：`escape_single_quotes`、`compute_send_dest`、`com_cat_folder_name` + 測試
- `src-tauri/src/state.rs` — `SerialState` 加 `transfer_active: std::sync::Arc<std::sync::atomic::AtomicBool>`（或 AtomicBool）
- `src-tauri/src/commands/serial.rs` — 加 `run_transaction` helper + `send_file_serial`、`receive_file_serial`（單檔）
- `src-tauri/src/lib.rs` — 註冊 2 個 command
- `src/api/index.js` — `sendFileSerial`/`receiveFileSerial` 改真實 invoke
- `src/api/index.test.js` — 加測試 + 把「未移植」範例改成 `scanNetworkDevices`（已是）或其他仍未移植者

---

## Task 1: 純 helper（serial_xfer.rs）+ state 旗標

**Files:** Modify `src-tauri/src/serial_xfer.rs`, `src-tauri/src/state.rs`

- [ ] **Step 1: serial_xfer.rs 加 helper + 測試**

```rust
/// 單引號跳脫（對齊 Electron replace(/'/g, "'\"'\"'")）。
pub fn escape_single_quotes(s: &str) -> String {
    s.replace('\'', "'\"'\"'")
}

/// 計算送檔最終目的地（對齊 Electron：目錄則補檔名）。
pub fn compute_send_dest(dest_path: &str, file_name: &str) -> String {
    if dest_path.ends_with('/') {
        format!("{dest_path}{file_name}")
    } else if !dest_path.contains('.') && !dest_path.contains(file_name) {
        format!("{dest_path}/{file_name}")
    } else {
        dest_path.to_string()
    }
}

/// com_cat 資料夾名：com_cat_<ISO 去 :._，T→_，去毫秒>。
pub fn com_cat_folder_name(iso_now: &str) -> String {
    // iso_now 形如 2026-05-28T12:34:56.789Z；對齊 Electron 的 replace 規則
    let no_ms = iso_now.split('.').next().unwrap_or(iso_now);
    let replaced: String = no_ms.chars().map(|c| match c { ':' => '-', 'T' => '_', _ => c }).collect();
    format!("com_cat_{replaced}")
}
```
測試：
```rust
    #[test]
    fn escape_quotes() {
        assert_eq!(escape_single_quotes("a'b"), "a'\"'\"'b");
    }
    #[test]
    fn send_dest_dir_vs_file() {
        assert_eq!(compute_send_dest("/tmp/", "f.txt"), "/tmp/f.txt");
        assert_eq!(compute_send_dest("/tmp/data", "f.txt"), "/tmp/data/f.txt"); // 無 . 視為目錄
        assert_eq!(compute_send_dest("/tmp/out.bin", "f.txt"), "/tmp/out.bin"); // 有 . 視為檔
    }
    #[test]
    fn com_cat_name_format() {
        assert_eq!(com_cat_folder_name("2026-05-28T12:34:56.789Z"), "com_cat_2026-05-28_12-34-56Z");
    }
```

- [ ] **Step 2: state.rs 加 transfer 旗標**

在 `SerialState` 加欄位：
```rust
    pub transfer_active: std::sync::Arc<std::sync::atomic::AtomicBool>,
```
（`#[derive(Default)]` 對 `Arc<AtomicBool>` 預設為 `Arc::new(AtomicBool::new(false))`，可用。）

- [ ] **Step 3: 測試** — `cd src-tauri && cargo test serial_xfer`；Expected: 既有 10 + 新 3 共 13 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/serial_xfer.rs src-tauri/src/state.rs
git commit -m "feat(tauri): serial transfer pure helpers (escape/dest/com_cat) + transfer flag"
```

---

## Task 2: `serial.rs` — `run_transaction` + `send_file_serial` + `receive_file_serial`（單檔）

**Files:** Modify `src-tauri/src/commands/serial.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 `serial.rs` 加入下列（imports 補 `std::time::Instant`、`crate::serial_xfer`、`crate::events::XMODEM_PROGRESS`、`std::path::Path`、`std::io::Read`）**

```rust
use crate::events::XMODEM_PROGRESS;
use crate::serial_xfer;
use std::io::Read;
use std::path::Path;
use std::time::Instant;

fn emit_progress(app: &AppHandle, status: &str, message: &str) {
    let _ = app.emit(XMODEM_PROGRESS, serde_json::json!({ "status": status, "message": message }));
}

/// 寫指令並讀到 is_done 為真或逾時；過程逐塊 emit serial-data-received。回傳累積回應。
fn run_transaction(
    port: &mut Box<dyn serialport::SerialPort>,
    app: &AppHandle,
    command: &str,
    timeout: Duration,
    is_done: impl Fn(&str) -> bool,
) -> Result<String, String> {
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
                    let _ = app.emit(crate::events::SERIAL_DATA_RECEIVED, chunk.clone());
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

#[tauri::command]
pub fn send_file_serial(app: AppHandle, state: State<AppState>, file_path: String, dest_path: String) -> serde_json::Value {
    let content = match std::fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
    };
    let file_name = basename(&file_path);
    let final_dest = serial_xfer::compute_send_dest(&dest_path, &file_name);
    let command = format!("echo '{}' > {}\n", serial_xfer::escape_single_quotes(&content), final_dest);

    let mut s = state.serial.lock();
    if s.transfer_active.swap(true, Ordering::SeqCst) {
        return serde_json::json!({ "success": false, "error": "Operation already in progress or duplicate call detected" });
    }
    stop_reader(&mut s);
    std::thread::sleep(Duration::from_millis(200)); // 讓背景 reader 退出，避免搶讀

    let result = (|| {
        let port = match s.port.as_mut() {
            Some(p) => p,
            None => return serde_json::json!({ "success": false, "error": "Serial port not open" }),
        };
        emit_progress(&app, "sending", "Sending file content...");
        match run_transaction(port, &app, &command, Duration::from_secs(10), |r| r.contains("# ") || r.contains("$ ")) {
            Ok(resp) => {
                if resp.contains("Permission denied") {
                    emit_progress(&app, "error", "Send failed: Permission denied");
                    serde_json::json!({ "success": false, "error": "Permission denied" })
                } else if resp.contains("Is a directory") {
                    let msg = "Destination is a directory - file path needed";
                    emit_progress(&app, "error", &format!("Send failed: {msg}"));
                    serde_json::json!({ "success": false, "error": msg })
                } else if resp.contains("No such file") {
                    let msg = "File transfer failed - check permissions and paths";
                    emit_progress(&app, "error", &format!("Send failed: {msg}"));
                    serde_json::json!({ "success": false, "error": msg })
                } else {
                    emit_progress(&app, "completed", "File sent successfully via serial commands");
                    serde_json::json!({ "success": true, "message": "File sent successfully via serial commands" })
                }
            }
            Err(e) => serde_json::json!({ "success": false, "error": e }),
        }
    })();

    s.transfer_active.store(false, Ordering::SeqCst);
    result
}

fn receive_single_file(app: &AppHandle, s: &mut crate::state::SerialState, save_path: &Path, remote_path: &str) -> serde_json::Value {
    emit_progress(app, "starting", "Preparing to receive file...");
    let is_text = serial_xfer::is_likely_text(remote_path);
    let command = serial_xfer::build_receive_command(remote_path, is_text);

    let port = match s.port.as_mut() {
        Some(p) => p,
        None => return serde_json::json!({ "success": false, "error": "Serial port not open" }),
    };
    emit_progress(app, "sending", "Sending enhanced file read command...");
    let response = match run_transaction(port, app, &command, Duration::from_secs(30), |r| {
        r.contains("=== FILE_END ===") || ends_with_prompt(r)
    }) {
        Ok(r) => r,
        Err(e) => return serde_json::json!({ "success": false, "error": e }),
    };

    let parsed = match serial_xfer::parse_file_response(&response, remote_path) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "success": false, "error": e }),
    };
    let fin = match serial_xfer::finalize(&parsed.content, parsed.expected_size) {
        Ok(f) => f,
        Err(e) => return serde_json::json!({ "success": false, "error": e }),
    };
    if let Err(e) = std::fs::write(save_path, &fin.bytes) {
        return serde_json::json!({ "success": false, "error": e.to_string() });
    }
    let mut out = serde_json::json!({
        "success": true,
        "filePath": save_path.to_string_lossy(),
        "size": fin.bytes.len(),
    });
    if let Some(e) = parsed.expected_size {
        out["expectedSize"] = serde_json::json!(e);
        out["verified"] = serde_json::json!(fin.verified.unwrap_or(false));
    }
    out
}

#[tauri::command]
pub fn receive_file_serial(app: AppHandle, state: State<AppState>, save_path: String, remote_path: String) -> serde_json::Value {
    let mut s = state.serial.lock();
    if s.transfer_active.swap(true, Ordering::SeqCst) {
        return serde_json::json!({ "success": false, "error": "Operation already in progress or duplicate call detected" });
    }
    stop_reader(&mut s);
    std::thread::sleep(Duration::from_millis(200));

    let result = (|| {
        if s.port.is_none() {
            return serde_json::json!({ "success": false, "error": "Serial port not open" });
        }
        // com_cat 資料夾
        let iso = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let folder = serial_xfer::com_cat_folder_name(&iso);
        let folder_path = Path::new(&save_path).join(&folder);
        if let Err(e) = std::fs::create_dir_all(&folder_path) {
            return serde_json::json!({ "success": false, "error": format!("Failed to create com_cat folder: {e}") });
        }
        emit_progress(&app, "preparing", &format!("Created folder: {folder}"));

        let is_directory = remote_path.ends_with('/') || !remote_path.contains('.');
        if is_directory {
            // 4b-3 補：遞迴目錄下載
            return serde_json::json!({ "success": false, "error": "Directory transfer not yet implemented" });
        }
        let file_name = remote_path.rsplit('/').next().filter(|s| !s.is_empty()).unwrap_or("received_file");
        let file_dest = folder_path.join(file_name);
        let mut r = receive_single_file(&app, &mut s, &file_dest, &remote_path);
        if r.get("success").and_then(|v| v.as_bool()) == Some(true) {
            r["comCatFolder"] = serde_json::json!(folder);
            r["comCatFolderPath"] = serde_json::json!(folder_path.to_string_lossy());
        }
        r
    })();

    s.transfer_active.store(false, Ordering::SeqCst);
    result
}
```

> 註：`chrono` 已是相依（3b-1）。`receive_single_file` 借用 `&mut SerialState`（在持鎖期間呼叫），避免重入鎖。

- [ ] **Step 2: 註冊（lib.rs，於 start_serial_listening 之後）**

```rust
            commands::serial::send_file_serial,
            commands::serial::receive_file_serial,
```

- [ ] **Step 3: 編譯 + 測試** — `cd src-tauri && cargo test serial`；Expected: 既有 serial/serial_xfer 測試綠、`cargo build` 成功（編排無新單元測試，靠純 helper 覆蓋 + 實機）。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/serial.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): serial send_file + single-file receive orchestration (transfer owns port)"
```

---

## Task 3: 前端接線

**Files:** Modify `src/api/index.js`, `src/api/index.test.js`

- [ ] **Step 1: 測試（index.test.js，最後一個測試後）**

```javascript
  it('sendFileSerial 帶 filePath/destPath', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.sendFileSerial('/a/f.txt', '/dev/dest');
    expect(invokeMock).toHaveBeenCalledWith('send_file_serial', { filePath: '/a/f.txt', destPath: '/dev/dest' });
  });

  it('receiveFileSerial 帶 savePath/remotePath', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.receiveFileSerial('/local/save', '/remote/f.bin');
    expect(invokeMock).toHaveBeenCalledWith('receive_file_serial', { savePath: '/local/save', remotePath: '/remote/f.bin' });
  });
```
> 並把「未移植方法」測試的範例由 `scanNetworkDevices` 維持（仍未移植）；本階段移植 sendFileSerial/receiveFileSerial 後，剩餘 notPorted：scanCredentials/getCredentialsPath/getSelectedCredential/scanNetworkDevices/testSshConnection。

- [ ] **Step 2: 確認失敗** — `npx vitest run src/api/index.test.js`；Expected: 新測試 FAIL。

- [ ] **Step 3: 實作（index.js）** — 把這兩行改真實 invoke：
```javascript
  sendFileSerial: (filePath, destPath) => invoke('send_file_serial', { filePath, destPath }),
  receiveFileSerial: (savePath, remotePath) => invoke('receive_file_serial', { savePath, remotePath }),
```

- [ ] **Step 4: 跑測試** — `npx vitest run src/api/index.test.js`；Expected: 全 PASS。
- [ ] **Step 5: 全套件** — `npx vitest run`；Expected: 無新增 failure（基準 699）。
- [ ] **Step 6: Commit**

```bash
git add src/api/index.js src/api/index.test.js
git commit -m "feat(api): wire sendFileSerial/receiveFileSerial to tauri"
```

---

## Task 4: 驗證 + 收尾

- [ ] **Step 1:** `cd src-tauri && cargo test`；Expected: 既有 70 + serial_xfer 新 3 共 73 全綠。
- [ ] **Step 2:** `npx vitest run`；Expected: 699 + 2 = 701，無回歸。
- [ ] **Step 3:** `npm run tauri:dev`；Expected: App 啟動、send_file_serial/receive_file_serial 已註冊、無 runtime/capability 錯誤。（驗畢關閉 dev 程序樹。）
- [ ] **Step 4: 實機驗收（需 RFD）：** 送一個檔到裝置；從裝置收一個單檔（文字 + 二進位）→ 內容/大小正確、進度事件顯示、UI 即時資料正常；目錄接收暫回「not yet implemented」（4b-3）。
- [ ] **Step 5: 最終 code review + finishing-a-development-branch。**

---

## 階段 4b-2 完成定義

- [ ] `send_file_serial` + 單檔 `receive_file_serial`（含 com_cat 資料夾、dispatcher、transfer_active 防並行）實作 + 註冊；前端接線
- [ ] 「傳輸獨佔埠」架構：停背景 reader、過程 emit serial-data-received + xmodem-progress
- [ ] 純 helper（escape/dest/com_cat）測試綠；`cargo test`/vitest 全綠；App 啟動正常
- [ ] 目錄接收暫回 not-yet-implemented（4b-3）
- [ ] **實機**：送/收單檔成功（使用者驗證）

---

## Self-Review 紀錄

- **Spec 覆蓋**：對齊 Electron send-file-xmodem（echo 重導向 + 提示偵測 + 錯誤訊息）、receive dispatcher（dedup、com_cat 資料夾、單檔分支）、receiveSingleFileSerial（指令→讀→parse→finalize→寫檔，用 4b-1）。目錄遞迴 = 4b-3。
- **架構決策**：因 Rust 阻塞讀取無法雙 reader，改「傳輸獨佔埠」（停背景監聽 + 過程 emit），與 Electron 廣播觀感一致；以 transfer_active 防並行（對齊 activeIpcCalls 拒絕）。已於 Architecture 載明此 divergence。
- **驗證界線**：I/O 編排無法本機驗證（無 RFD）；純 helper 已測；列入實機驗收。
- **型別一致性**：command 名 snake_case 對應前端鍵（filePath/destPath/savePath/remotePath）；回傳形狀逐字（send/receive 各自）；run_transaction 共用；`SerialState.transfer_active` 防並行；chrono 既有相依。
- **Placeholder 掃描**：唯一刻意的「Directory transfer not yet implemented」為 4b-3 範圍，已載明。
