# Tauri 遷移 — 階段 4b-3：序列遞迴目錄下載（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Phase 4b 的最後一塊：序列「遞迴目錄下載」。把 `receive_file_serial` 的目錄分支（目前回 "Directory transfer not yet implemented"）改為真正列目錄（`cd && ls -l`）、解析清單、逐項下載（檔案用 4b-2 的單檔下載 + 3 次重試；子目錄遞迴）。`ls -l` 解析為純函式可測；I/O 編排重用 4b-2 的 `run_transaction`/`receive_single_file`，全同步、在「傳輸獨佔埠」鎖內。無前端變更（receiveFileSerial 已於 4b-2 接線）。

**Architecture:** 延續 4b-2「傳輸獨佔埠」。新增純 `serial_xfer::parse_ls_output`（ANSI 去除 + 過濾 + 檔名萃取 + 跳過規則 + 去重）。serial.rs 新增 `receive_directory`（列目錄→解析→download_files_sequentially）與 `download_files_sequentially`（逐項：目錄→mkdir + 遞迴；檔案→receive_single_file 3 重試），皆同步、共用既有鎖（`&mut SerialState` 穿遞，無重入）。

**Tech Stack:** Rust（regex、serialport、既有 serial_xfer/serial）。

**⚠️ 驗證界線：** 目錄列舉/遞迴/下載的序列 I/O 無法本機驗證，需 RFD 實機。`parse_ls_output` 純函式單元測試。

參照：Electron `receiveDirectorySerial`(electron.js:3459-3726)、`downloadFilesSequentially`(:3729-3875)。

**逐字保留的契約：**
- 列目錄指令：`cd "<remotePath>" && ls -l\n`；完成偵測：最後一行含提示（`# `/`$ `/`> `/`>> `/`~#`/`~$`）**且**回應含 `total ` 或 `No such file or directory`。15s 逾時。
- `ls -l` 解析：去 ANSI（`\x1b\[[0-9;]*m` 與 `\[[\d;]*m`）；跳過含 `cd `/`ls `/`# `/`$ ` 或 `total ` 開頭或空行；`split_whitespace` 後 `parts>=8` 且開頭為 `-`/`d`、且 `parts>=9` 才取 `parts[8..].join(" ")` 為檔名；跳過 `.`/`..`；檔案（`-`）跳過 `btmp`/`wtmp`/無 `.` 副檔名；目錄（`d`）跳過 `private`/`journal`；以名稱去重。
- 逐項下載：目錄 → `mkdir <save>/<name>` + 遞迴 `receive_directory`；檔案 → `receive_single_file`（最多 3 次、間隔 1s）；每項間隔 500ms。
- 回傳：空清單 `{success:true, message:"No files found in directory", fileCount:0}`；完成 `{success:true, message:"Downloaded N files and processed M directories", fileCount, dirCount, totalItems}`。
- dispatcher 目錄分支成功時仍加 `comCatFolder`/`comCatFolderPath`（4b-2 既有）。

---

## File Structure

**修改（Rust）**
- `src-tauri/src/serial_xfer.rs` — 加 `parse_ls_output` + 測試
- `src-tauri/src/commands/serial.rs` — 加 `receive_directory` + `download_files_sequentially`；dispatcher 目錄分支改呼叫 `receive_directory`

**不動：** 前端、Cargo.toml、state、lib.rs（command 已註冊）。

---

## Task 1: `parse_ls_output`（serial_xfer.rs，純 + 測試）

**Files:** Modify `src-tauri/src/serial_xfer.rs`

- [ ] **Step 1: 加 `parse_ls_output`**

```rust
/// 解析 `ls -l` 輸出 → (檔名, 是否為目錄) 清單（對齊 Electron receiveDirectorySerial 的解析）。
pub fn parse_ls_output(response: &str) -> Vec<(String, bool)> {
    let ansi = Regex::new(r"\x1b\[[0-9;]*m").unwrap();
    let ansi_partial = Regex::new(r"\[[\d;]*m").unwrap();
    let mut out: Vec<(String, bool)> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in response.split('\n') {
        let t = line.trim();
        let t = ansi.replace_all(t, "");
        let t = ansi_partial.replace_all(&t, "");
        let t = t.as_ref();
        if t.is_empty()
            || t.contains("cd ")
            || t.contains("ls ")
            || t.contains("# ")
            || t.contains("$ ")
            || t.starts_with("total ")
        {
            continue;
        }
        let is_file = t.starts_with('-');
        let is_dir = t.starts_with('d');
        if !(is_file || is_dir) {
            continue;
        }
        let parts: Vec<&str> = t.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }
        let filename = parts[8..].join(" ");
        if filename.is_empty() || filename == "." || filename == ".." {
            continue;
        }
        if is_file {
            if filename == "btmp" || filename == "wtmp" || !filename.contains('.') {
                continue;
            }
            if seen.insert(filename.clone()) {
                out.push((filename, false));
            }
        } else {
            // 目錄
            if filename == "private" || filename == "journal" {
                continue;
            }
            if seen.insert(filename.clone()) {
                out.push((filename, true));
            }
        }
    }
    out
}
```

- [ ] **Step 2: 測試（serial_xfer.rs tests）**

```rust
    #[test]
    fn parse_ls_files_and_dirs() {
        let resp = "cd \"/data\" && ls -l\n\
total 12\n\
-rw-r--r-- 1 root root  100 Jan  1 00:00 config.json\n\
drwxr-xr-x 2 root root 4096 Jan  1 00:00 logs\n\
-rw-r--r-- 1 root root   50 Jan  1 00:00 noext\n\
-rw-r--r-- 1 root root   10 Jan  1 00:00 btmp\n\
drwxr-xr-x 2 root root 4096 Jan  1 00:00 private\n\
# ";
        let items = parse_ls_output(resp);
        // config.json（檔）、logs（目錄）保留；noext（無副檔名）、btmp、private 跳過
        assert_eq!(items, vec![("config.json".to_string(), false), ("logs".to_string(), true)]);
    }

    #[test]
    fn parse_ls_dedups_by_name() {
        let resp = "total 1\n-rw-r--r-- 1 a a 1 Jan 1 00:00 a.txt\n-rw-r--r-- 1 a a 1 Jan 1 00:00 a.txt\n# ";
        assert_eq!(parse_ls_output(resp), vec![("a.txt".to_string(), false)]);
    }

    #[test]
    fn parse_ls_empty_on_no_listing() {
        assert!(parse_ls_output("# ").is_empty());
    }
```

- [ ] **Step 3: 測試** — `cd src-tauri && cargo test serial_xfer`；Expected: 既有 13 + 3 共 16 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/serial_xfer.rs
git commit -m "feat(tauri): parse ls -l output for serial directory download"
```

---

## Task 2: `receive_directory` + `download_files_sequentially`（serial.rs）+ 接 dispatcher

**Files:** Modify `src-tauri/src/commands/serial.rs`

- [ ] **Step 1: 在 serial.rs（`receive_single_file` 之後）加入**

```rust
fn listing_done(response: &str) -> bool {
    let last = response.rsplit('\n').next().unwrap_or("");
    let has_prompt = ["# ", "$ ", "> ", ">> ", "~#", "~$"].iter().any(|p| last.contains(p));
    has_prompt && (response.contains("total ") || response.contains("No such file or directory"))
}

fn receive_directory(app: &AppHandle, s: &mut crate::state::SerialState, save_path: &Path, remote_path: &str) -> Value {
    emit_progress(app, "starting", "Listing directory contents...");
    let command = format!("cd \"{remote_path}\" && ls -l\n");
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
            let local_dir = save_path.join(name);
            let _ = std::fs::create_dir_all(&local_dir);
            emit_progress(app, "downloading", &format!("Processing directory {name}..."));
            let r = receive_directory(app, s, &local_dir, &remote_dir);
            if r.get("success").and_then(|v| v.as_bool()) == Some(true) {
                processed_dirs += 1;
            }
        } else {
            let remote_file = format!("{remote_path}/{name}");
            let local_file = save_path.join(name);
            let mut retry = 0;
            loop {
                let result = receive_single_file(app, s, &local_file, &remote_file);
                if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
                    downloaded += 1;
                    let size = result.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
                    let pct = (((downloaded + processed_dirs) as f64 / total as f64) * 100.0).round() as u64;
                    emit_progress(app, "downloading", &format!("Downloaded {name} ({size} bytes)"));
                    let _ = pct; // 進度百分比僅供 UI；訊息已含
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
```

> 註：百分比欄位 Electron 放在 progress 物件的 `percentage`；此處進度訊息已足夠，若要完全對齊可在 emit_progress 增 percentage 參數（非必要）。

- [ ] **Step 2: dispatcher 目錄分支改呼叫 `receive_directory`**

把 `receive_file_serial` 內：
```rust
        if is_directory {
            // 遞迴目錄下載：4b-3 補。
            return json!({ "success": false, "error": "Directory transfer not yet implemented" });
        }
```
改為：
```rust
        if is_directory {
            let mut r = receive_directory(&app, &mut s, &folder_path, &remote_path);
            if r.get("success").and_then(|v| v.as_bool()) == Some(true) {
                r["comCatFolder"] = json!(folder);
                r["comCatFolderPath"] = json!(folder_path.to_string_lossy());
            }
            return r;
        }
```

- [ ] **Step 3: 編譯 + 測試** — `cd src-tauri && cargo test serial`；Expected: serial/serial_xfer 測試綠、`cargo build` 成功。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/serial.rs
git commit -m "feat(tauri): recursive serial directory download (receive_directory)"
```

---

## Task 3: 驗證 + 收尾

- [ ] **Step 1:** `cd src-tauri && cargo test`；Expected: 既有 73 + serial_xfer 新 3 共 76 全綠。
- [ ] **Step 2:** `npx vitest run`；Expected: 700 無回歸（前端未動）。
- [ ] **Step 3:** `npm run tauri:dev`；Expected: App 啟動、無 runtime/capability 錯誤。（驗畢關閉 dev 程序樹。）
- [ ] **Step 4: 實機驗收（需 RFD）：** 對裝置上的目錄做 receive → 遞迴下載到 com_cat 資料夾、子目錄結構正確、進度顯示、整合驗證。
- [ ] **Step 5: 最終 code review + finishing-a-development-branch。**

---

## 階段 4b-3 完成定義（= Phase 4 全部完成）

- [ ] `parse_ls_output` 測試綠；`receive_directory`/`download_files_sequentially` 實作；dispatcher 目錄分支接上
- [ ] `cargo test`/vitest 全綠；App 啟動正常
- [ ] **實機**：遞迴目錄下載成功（使用者驗證）

---

## Self-Review 紀錄

- **Spec 覆蓋**：對齊 Electron receiveDirectorySerial（cd && ls -l、完成偵測、ls 解析、跳過規則、去重）與 downloadFilesSequentially（目錄遞迴 + mkdir、檔案 3 重試、500ms 間隔、回傳形狀）。重用 4b-2 的 run_transaction/receive_single_file。
- **架構**：同步遞迴在「傳輸獨佔埠」鎖內，`&mut SerialState` 穿遞無重入；`parse_ls_output` 純可測。
- **驗證界線**：I/O/遞迴無法本機驗證；ls 解析已測；列入實機。
- **與 Electron 的小差異**：Electron 用 serialOperationInProgress + 2s 節流 + isRecursiveCall 判斷；本版以 transfer_active（4b-2，dispatcher 層）防並行，遞迴在同一鎖內天然序列化，故不需 per-call 旗標/節流。progress percentage 省略（訊息已足夠）。已載明。
- **Placeholder 掃描**：無 TBD/TODO（dispatcher 的 not-yet-implemented 已被取代）。
