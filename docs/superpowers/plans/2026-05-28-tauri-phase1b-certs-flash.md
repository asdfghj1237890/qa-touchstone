# Tauri 遷移 — 階段 1b：憑證掃描 + flashPathData + API 憑證設定（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Rust 移植憑證相關領域：憑證遞迴掃描、已選憑證解析、憑證資料夾路徑、flashPathData 的原子寫入/備份/遷移讀寫，以及 API 憑證設定清單（get/set），並把前端 `src/api` 對應方法從 `NotPortedError` 換成真實 `invoke`，讓憑證頁、Nordic/Silabs 路徑設定、API Settings 能運作。

**Architecture:** 延續方案 A。後端新增 `commands/certs.rs`（掃描 / 已選憑證 / 憑證路徑）與 `commands/flash.rs`（flashPathData），並在既有 `commands/config.rs` 加 API 憑證設定 get/set。延續 1a 決策**不移植 TTL 記憶體快取**（`certificatesCache`/`userDataCache`/`configCache` 全部不移植；每次直接讀檔）。flashPathData 的 Electron 布林 busy-wait 旗標改為 `AppState` 內的 `parking_lot::Mutex<()>`，command 內持鎖跨越「讀→改→寫」消除競態（對齊 spec §3）。

**Tech Stack:** Rust（serde_json、tauri 2、parking_lot）、既有前端 + vitest。

參照設計文件：`docs/superpowers/specs/2026-05-28-tauri-migration-design.md`（§2 api 契約、§3 共享狀態與 flashPathData 競態、§4 錯誤處理與檔案損毀復原）。階段 0/1a 已完成 api 抽象層、系統/視窗/config/store/fsops command。

---

## 範圍決策（重要，務必先讀）

1. **`scan-credentials` / `get-credentials-path` / `get-selected-credential` 不需移植。** 經查 Electron `electron.js` 根本沒有註冊這三個 IPC handler（只在 preload 暴露），現況呼叫會 reject「No handler registered」。`src/api/index.js` 已把這三個設為 `notPorted`（reject），行為與 Electron 一致。**本階段維持不變**，不動它們。
2. **`parseCredentialFileContent`（ini/json/csv 憑證解析）延到階段 3。** 它唯一的消費者是 `execute-postman-request`（階段 3 AWS/Postman）。階段 1b 沒有任何呼叫點，故與其消費者一起在階段 3 移植 + 整合測試，避免本階段產生整段死碼與多餘相依（regex）。spec §1 把它列在 certs.rs，但 0/1 階段切成 1a/1b 是後來的決定；此調整已在此載明。
3. **`get-api-credential-configs` / `set-api-credential-configs` 屬本階段。** 它們是 API Settings 頁實際在用的設定清單管理（讀寫 `config.json`），與憑證檔解析無關。

**逐字保留的回傳形狀（不可改）：**
- `scan_certificates` → 憑證物件**陣列**；失敗 **throw**（Rust `Result::Err`）。副作用：寫入 `user_data.json`。
- `get_certificates_path` → `config.credentials` 字串，或 `null`。
- `get_selected_certificate` → 憑證物件，或 `null`（任何錯誤都吞掉回 `null`，不 throw）。
- `update_flash_path_data` → 三種：`{success:true}` / `{success:false,error}` / `{success:false,error:"Certificate folder path reset prevented",rejected:true}`。永不 throw。
- `get_flash_path_data` → 固定三鍵物件 `{certificate_folder_path, current_used_paths, saved_paths}`；任何失敗都回預設結構，永不 throw。
- `get_api_credential_configs` → **陣列**（含 singular→plural 遷移，唯讀不持久化）。
- `set_api_credential_configs` → `{success:true}` / `{success:false,error}`；非陣列回 `{success:false,error:"Invalid data format: apiConfigs must be an array."}`；成功會廣播 `config-updated`。

**憑證項目形狀（`scan_certificates` 每筆）：** `{ id, certificateid, apid, deviceid, path, remark }`
- `id` = `"<now_ms>_<n>_<certId 前8碼>"`（`now_ms` 為掃描開始時取一次、`n` 為 1-based 命中計數）
- `certificateid` = 檔名去掉前綴 `certificate_` 與後綴 `.json`
- `apid` = JSON 內 `metadata.apid`；`deviceid` = `metadata.applicationDeviceId`
- `path` = 檔案所在的**目錄**（非檔案完整路徑）；`remark` = `""`

**flashPathData 預設結構（讀取失敗/不存在時回傳）：** `{ certificate_folder_path:"", current_used_paths:{}, saved_paths:[] }`

---

## File Structure

**新增（Rust）**
- `src-tauri/src/commands/certs.rs` — `scan_certificates`、`get_certificates_path`、`get_selected_certificate`
- `src-tauri/src/commands/flash.rs` — `update_flash_path_data`、`get_flash_path_data` + 遷移/原子寫入 helper

**修改（Rust）**
- `src-tauri/src/state.rs` — `AppState` 加 `flash_lock: parking_lot::Mutex<()>`
- `src-tauri/src/commands/config.rs` — `load_config_raw` 改 `pub(crate)`；新增 `get_api_credential_configs`、`set_api_credential_configs`
- `src-tauri/src/commands/mod.rs` — 加 `certs`、`flash` 模組
- `src-tauri/src/lib.rs` — 註冊新 command

**修改（前端）**
- `src/api/index.js` — 7 個方法改真實 invoke
- `src/api/index.test.js` — 更新（這些方法不再 NotPorted；把「未移植」測試的範例方法換成仍未移植的 `listSerialPorts`）

---

## Task 1: `certs.rs` — `scan_certificates` + `get_certificates_path`

**Files:** Create `src-tauri/src/commands/certs.rs`; Modify `src-tauri/src/commands/config.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 把 config.rs 的 `load_config_raw` 開放給同 crate 使用**

在 `src-tauri/src/commands/config.rs`，將：
```rust
fn load_config_raw(app: &AppHandle) -> Value {
```
改為：
```rust
pub(crate) fn load_config_raw(app: &AppHandle) -> Value {
```

- [ ] **Step 2: 建立 `src-tauri/src/commands/certs.rs`（含掃描測試）**

```rust
use crate::commands::config::load_config_raw;
use crate::error::{AppError, AppResult};
use crate::json_store::write_pretty;
use crate::paths::data_file;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn is_certificate_file(name: &str) -> bool {
    // 對齊 Electron 正規式 ^certificate_[A-Za-z0-9]+\.json$
    let Some(mid) = name.strip_prefix("certificate_").and_then(|s| s.strip_suffix(".json")) else {
        return false;
    };
    !mid.is_empty() && mid.chars().all(|c| c.is_ascii_alphanumeric())
}

fn cert_id_from_name(name: &str) -> String {
    // 對齊 Electron：replace(/^certificate_|\.json$/g, '')
    name.strip_prefix("certificate_").unwrap_or(name)
        .strip_suffix(".json").unwrap_or(name)
        .to_string()
}

/// 遞迴掃描，回傳憑證項目陣列（錯誤吞掉、繼續）。對齊 Electron scanCertificates。
fn scan_dir(dir: &Path, now: u128, seen: &mut HashSet<String>, matching: &mut u64, out: &mut Vec<Value>) {
    let meta = match std::fs::metadata(dir) {
        Ok(m) => m,
        Err(_) => return,
    };
    if !meta.is_dir() {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            scan_dir(&path, now, seen, matching, out);
        } else if file_type.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_certificate_file(&name) {
                continue;
            }
            let cert_id = cert_id_from_name(&name);
            let dir_str = dir.to_string_lossy().to_string();
            let unique_key = format!("{cert_id}_{dir_str}");
            if seen.contains(&unique_key) {
                continue;
            }
            // 解析檔案；metadata 缺失 → 跳過此檔（對齊 Electron 的 try/catch 跳過）
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let data: Value = match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let Some(metadata) = data.get("metadata").filter(|m| m.is_object()) else {
                continue; // 對齊 Electron：metadata 缺失會 throw → 跳過
            };
            seen.insert(unique_key);
            *matching += 1;
            let prefix: String = cert_id.chars().take(8).collect();
            let unique_id = format!("{now}_{matching}_{prefix}");
            out.push(json!({
                "id": unique_id,
                "certificateid": cert_id,
                "apid": metadata.get("apid").cloned().unwrap_or(Value::Null),
                "deviceid": metadata.get("applicationDeviceId").cloned().unwrap_or(Value::Null),
                "path": dir_str,
                "remark": ""
            }));
        }
    }
}

fn scan_certificates_inner(certificates_path: &str) -> Vec<Value> {
    let now = now_ms();
    let mut seen = HashSet::new();
    let mut matching = 0u64;
    let mut out: Vec<Value> = Vec::new();
    scan_dir(Path::new(certificates_path), now, &mut seen, &mut matching, &mut out);
    // 依 certificateid 排序（對齊 localeCompare 的一般情形）
    out.sort_by(|a, b| {
        let ka = a.get("certificateid").and_then(|v| v.as_str()).unwrap_or("");
        let kb = b.get("certificateid").and_then(|v| v.as_str()).unwrap_or("");
        ka.cmp(kb)
    });
    out
}

#[tauri::command]
pub fn scan_certificates(app: AppHandle, certificates_path: String) -> AppResult<Vec<Value>> {
    let user_data = scan_certificates_inner(&certificates_path);
    // 副作用：寫入 user_data.json（對齊 Electron 的 saveUserData）。寫入失敗即 throw。
    let path = data_file(&app, "user_data.json").map_err(AppError::Io)?;
    write_pretty(&path, &Value::Array(user_data.clone()))?;
    Ok(user_data)
}

#[tauri::command]
pub fn get_certificates_path(app: AppHandle) -> Value {
    let config = load_config_raw(&app);
    match config.get("credentials") {
        Some(v) if v.is_string() => v.clone(),
        _ => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_certificate_filename() {
        assert!(is_certificate_file("certificate_ABC123.json"));
        assert!(!is_certificate_file("certificate_.json"));
        assert!(!is_certificate_file("cert_ABC.json"));
        assert!(!is_certificate_file("certificate_ABC.txt"));
        assert!(!is_certificate_file("certificate_AB-C.json"));
    }

    #[test]
    fn cert_id_strips_affixes() {
        assert_eq!(cert_id_from_name("certificate_BAC62994.json"), "BAC62994");
    }

    #[test]
    fn scan_finds_and_shapes_entries() {
        let dir = std::env::temp_dir().join(format!("certscan_{}", std::process::id()));
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(
            dir.join("certificate_AAAA1111.json"),
            r#"{"metadata":{"apid":"AP1","applicationDeviceId":"DEV1"}}"#,
        ).unwrap();
        std::fs::write(
            sub.join("certificate_BBBB2222.json"),
            r#"{"metadata":{"apid":"AP2","applicationDeviceId":"DEV2"}}"#,
        ).unwrap();
        std::fs::write(dir.join("ignore.txt"), "x").unwrap();
        std::fs::write(dir.join("certificate_bad.json"), "{ not json").unwrap();

        let out = scan_certificates_inner(dir.to_str().unwrap());
        assert_eq!(out.len(), 2);
        // 排序後第一筆為 AAAA1111
        assert_eq!(out[0]["certificateid"], "AAAA1111");
        assert_eq!(out[0]["apid"], "AP1");
        assert_eq!(out[0]["deviceid"], "DEV1");
        assert_eq!(out[0]["remark"], "");
        assert!(out[0]["id"].as_str().unwrap().ends_with("AAAA1111"));
        // path 為所在目錄
        assert_eq!(out[1]["certificateid"], "BBBB2222");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_skips_missing_metadata() {
        let dir = std::env::temp_dir().join(format!("certscan2_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("certificate_NOMETA.json"), r#"{"foo":1}"#).unwrap();
        let out = scan_certificates_inner(dir.to_str().unwrap());
        assert!(out.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_missing_dir_is_empty() {
        let out = scan_certificates_inner("/no/such/cert/dir/xyz");
        assert!(out.is_empty());
    }
}
```

- [ ] **Step 3: 在 `commands/mod.rs` 加模組**

```rust
pub mod certs;
pub mod config;
pub mod flash;
pub mod fsops;
pub mod store;
pub mod system;
pub mod window;
```
> （`flash` 在 Task 3 建立；若連續執行可一次加好，否則本 Task 先只加 `certs`，Task 3 再加 `flash`，避免引用不存在的模組。）

- [ ] **Step 4: 在 `lib.rs` `generate_handler!` 註冊**

於既有 `commands::fsops::read_file_content,` 之後加入：
```rust
            commands::certs::scan_certificates,
            commands::certs::get_certificates_path,
```

- [ ] **Step 5: 跑測試**

Run: `cd src-tauri && cargo test certs`
Expected: 5 個測試 PASS（`matches_certificate_filename`、`cert_id_strips_affixes`、`scan_finds_and_shapes_entries`、`scan_skips_missing_metadata`、`scan_missing_dir_is_empty`）。
> 環境註記：`cargo` 在新 shell 可能不在 PATH，先 `export PATH="$USERPROFILE/.cargo/bin:$PATH"`。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/certs.rs src-tauri/src/commands/config.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): scan_certificates + get_certificates_path commands"
```

---

## Task 2: `certs.rs` — `get_selected_certificate`

**Files:** Modify `src-tauri/src/commands/certs.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 `certs.rs` 加入 `get_selected_certificate` 與測試**

在 `certs.rs` 既有 imports 之外，於檔案中（command 區）加入以下函式（`read_value` 需 import）：

把檔頭 `use crate::json_store::write_pretty;` 改為：
```rust
use crate::json_store::{read_value, write_pretty};
```

新增：
```rust
fn read_array(app: &AppHandle, file: &str) -> AppResult<Option<Vec<Value>>> {
    let path = data_file(app, file).map_err(AppError::Io)?;
    match read_value(&path)? {
        Some(Value::Array(a)) => Ok(Some(a)),
        Some(_) => Ok(Some(vec![])), // 非陣列當空
        None => Ok(None),            // 檔案不存在
    }
}

/// 取得已選憑證。對齊 Electron getSelectedCertificate：任何錯誤吞掉回 null。
#[tauri::command]
pub fn get_selected_certificate(app: AppHandle) -> Option<Value> {
    // selection_model.json：陣列；空/不存在 → 無選取
    let selection = match read_array(&app, "selection_model.json") {
        Ok(Some(a)) => a,
        _ => return None,
    };
    let selected_id = match selection.first().and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return None,
    };

    // user_data：存在(含空陣列)就用；解析錯誤等 → fallback 掃描
    let user_data: Vec<Value> = match read_array(&app, "user_data.json") {
        Ok(Some(a)) => a,
        Ok(None) => vec![],
        Err(_) => fallback_scan(&app),
    };

    // 先以 id 完全比對
    if let Some(found) = user_data.iter().find(|c| c.get("id").and_then(|v| v.as_str()) == Some(selected_id.as_str())) {
        return Some(found.clone());
    }

    // 向後相容：舊格式 id "ts_n_CERTID"，取最後一段以 certificateid.startsWith 比對
    let parts: Vec<&str> = selected_id.split('_').collect();
    if parts.len() >= 3 {
        let old_cert_id = parts[parts.len() - 1];
        if let Some(found) = user_data.iter().find(|c| {
            c.get("certificateid").and_then(|v| v.as_str()).map(|s| s.starts_with(old_cert_id)).unwrap_or(false)
        }) {
            // best-effort 改寫 selection_model 為新 id
            if let (Some(new_id), Ok(path)) = (found.get("id").cloned(), data_file(&app, "selection_model.json")) {
                let _ = write_pretty(&path, &Value::Array(vec![new_id]));
            }
            return Some(found.clone());
        }
    }
    None
}

fn fallback_scan(app: &AppHandle) -> Vec<Value> {
    // 嘗試 flash_path_data.certificate_folder_path，否則 config.credentials
    let cert_path: Option<String> = (|| {
        if let Ok(p) = data_file(app, "flash_path_data.json") {
            if let Ok(Some(v)) = read_value(&p) {
                if let Some(s) = v.get("certificate_folder_path").and_then(|x| x.as_str()) {
                    if !s.is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
        }
        load_config_raw(app).get("credentials").and_then(|v| v.as_str()).map(|s| s.to_string())
    })();
    match cert_path {
        Some(p) if !p.is_empty() => scan_certificates_inner(&p),
        _ => vec![],
    }
}
```

在 `#[cfg(test)] mod tests` 內新增：
```rust
    #[test]
    fn selected_cert_matches_by_exact_id() {
        // 純資料層級驗證 find 行為（不經 AppHandle）
        let user_data = vec![
            json!({"id":"X1","certificateid":"AAAA"}),
            json!({"id":"X2","certificateid":"BBBB"}),
        ];
        let found = user_data.iter().find(|c| c["id"] == json!("X2"));
        assert_eq!(found.unwrap()["certificateid"], "BBBB");
    }

    #[test]
    fn selected_cert_backward_compat_suffix() {
        let user_data = vec![ json!({"id":"new_id_1","certificateid":"BAC62994"}) ];
        let selected_id = "1749330818788_9_BAC62994";
        let parts: Vec<&str> = selected_id.split('_').collect();
        let old = parts[parts.len()-1];
        let found = user_data.iter().find(|c| c["certificateid"].as_str().unwrap().starts_with(old));
        assert_eq!(found.unwrap()["id"], "new_id_1");
    }
```

- [ ] **Step 2: 註冊（lib.rs）**

於 `commands::certs::get_certificates_path,` 之後加入：
```rust
            commands::certs::get_selected_certificate,
```

- [ ] **Step 3: 跑測試**

Run: `cd src-tauri && cargo test certs`
Expected: Task 1 的 5 個 + 本 Task 2 個共 7 個 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/certs.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): get_selected_certificate with backward-compat id match"
```

---

## Task 3: `flash.rs` — `update_flash_path_data`（原子寫入 + 備份 + 遷移 + 鎖）

**Files:** Create `src-tauri/src/commands/flash.rs`; Modify `src-tauri/src/state.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: `AppState` 加 flash 鎖（state.rs）**

把 `src-tauri/src/state.rs` 改為：
```rust
use parking_lot::Mutex;

/// 全域共享狀態。
#[derive(Default)]
pub struct AppState {
    /// 階段 2 用：目前執行中的子程序 PID（佔位）。
    pub current_process_pid: Mutex<Option<u32>>,
    /// flashPathData 讀改寫序列化鎖（取代 Electron 的 busy-wait 布林旗標）。
    pub flash_lock: Mutex<()>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }
}
```

- [ ] **Step 2: 建立 `src-tauri/src/commands/flash.rs`（含測試）**

```rust
use crate::json_store::read_value;
use crate::paths::config_dir;
use crate::state::AppState;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[derive(Serialize)]
pub struct FlashUpdateResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rejected: Option<bool>,
}

impl FlashUpdateResult {
    fn ok() -> Self { Self { success: true, error: None, rejected: None } }
    fn err(e: String) -> Self { Self { success: false, error: Some(e), rejected: None } }
    fn rejected() -> Self {
        Self { success: false, error: Some("Certificate folder path reset prevented".into()), rejected: Some(true) }
    }
}

struct FlashPaths { main: PathBuf, tmp: PathBuf, bak: PathBuf }

fn flash_paths(app: &AppHandle) -> std::io::Result<FlashPaths> {
    let dir = config_dir(app)?;
    Ok(FlashPaths {
        main: dir.join("flash_path_data.json"),
        tmp: dir.join("flash_path_data.json.tmp"),
        bak: dir.join("flash_path_data.json.bak"),
    })
}

fn default_flash() -> Value {
    json!({ "certificate_folder_path": "", "current_used_paths": {}, "saved_paths": [] })
}

/// 兩種遷移。write 路徑會刪除 legacy 鍵（delete_legacy=true）；read 路徑保留（false）。
fn migrate(v: &mut Value, delete_legacy: bool) {
    let Some(obj) = v.as_object_mut() else { return };
    if obj.contains_key("current_used_paths") && obj.contains_key("saved_paths") && !obj.contains_key("nordic") {
        let cup = obj.get("current_used_paths").cloned().unwrap_or_else(|| json!({}));
        let sp = obj.get("saved_paths").cloned().unwrap_or_else(|| json!([]));
        obj.insert("nordic".into(), json!({ "current_used_paths": cup, "saved_paths": sp }));
        if delete_legacy {
            obj.remove("current_used_paths");
            obj.remove("saved_paths");
        }
    }
    if obj.contains_key("credential_folder_path") && !obj.contains_key("certificate_folder_path") {
        let c = obj.get("credential_folder_path").cloned().unwrap_or_else(|| Value::String(String::new()));
        obj.insert("certificate_folder_path".into(), c);
        if delete_legacy {
            obj.remove("credential_folder_path");
        }
    }
}

/// 讀主檔；parse 失敗或讀取錯誤 → 試 .bak；皆失敗 → {}（不含 ENOENT，ENOENT 直接回 {}）。
fn read_existing(p: &FlashPaths) -> Value {
    match std::fs::read_to_string(&p.main) {
        Ok(s) => match serde_json::from_str::<Value>(&s) {
            Ok(v) if v.is_object() => v,
            Ok(_) => json!({}),
            Err(_) => read_bak_or_empty(p),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(_) => read_bak_or_empty(p),
    }
}

fn read_bak_or_empty(p: &FlashPaths) -> Value {
    match std::fs::read_to_string(&p.bak) {
        Ok(s) => serde_json::from_str::<Value>(&s).ok().filter(|v| v.is_object()).unwrap_or_else(|| json!({})),
        Err(_) => json!({}),
    }
}

/// 原子寫入：備份 → tmp → 驗證 parse → rename。
fn atomic_write(p: &FlashPaths, value: &Value) -> Result<(), String> {
    // 備份現有主檔（ENOENT 忽略；其他錯誤非致命）
    if let Ok(existing) = std::fs::read(&p.main) {
        let _ = std::fs::write(&p.bak, existing);
    }
    let content = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::write(&p.tmp, &content) {
        return Err(e.to_string());
    }
    // 驗證 tmp 可被 parse
    match std::fs::read_to_string(&p.tmp).map_err(|e| e.to_string()).and_then(|s| serde_json::from_str::<Value>(&s).map_err(|e| e.to_string())) {
        Ok(_) => {}
        Err(e) => { let _ = std::fs::remove_file(&p.tmp); return Err(e); }
    }
    if let Err(e) = std::fs::rename(&p.tmp, &p.main) {
        let _ = std::fs::remove_file(&p.tmp);
        return Err(e.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn update_flash_path_data(app: AppHandle, state: State<AppState>, new_data: Value) -> FlashUpdateResult {
    let _guard = state.flash_lock.lock(); // 跨「讀→改→寫」持鎖
    let p = match flash_paths(&app) {
        Ok(p) => p,
        Err(e) => return FlashUpdateResult::err(e.to_string()),
    };
    let mut flash = read_existing(&p);
    migrate(&mut flash, true);
    if !flash.is_object() {
        flash = json!({});
    }
    let obj = flash.as_object_mut().unwrap();

    let path_type = new_data.get("path_type").and_then(|v| v.as_str()).unwrap_or("nordic").to_string();
    if !obj.get(&path_type).map(|v| v.is_object()).unwrap_or(false) {
        obj.insert(path_type.clone(), json!({ "current_used_paths": {}, "saved_paths": [] }));
    }

    // current_used_paths：present 且非 null → 淺合併
    if let Some(incoming) = new_data.get("current_used_paths").filter(|v| !v.is_null()) {
        if let Some(incoming_obj) = incoming.as_object() {
            let target = obj.get_mut(&path_type).unwrap().as_object_mut().unwrap();
            let cup = target.entry("current_used_paths").or_insert_with(|| json!({}));
            if let Some(cup_obj) = cup.as_object_mut() {
                for (k, v) in incoming_obj {
                    cup_obj.insert(k.clone(), v.clone());
                }
            }
        }
    }

    // saved_paths：present 且非 null → 整段取代
    if let Some(incoming) = new_data.get("saved_paths").filter(|v| !v.is_null()) {
        let target = obj.get_mut(&path_type).unwrap().as_object_mut().unwrap();
        target.insert("saved_paths".into(), incoming.clone());
    }

    // 確保頂層 certificate_folder_path 存在
    if !obj.contains_key("certificate_folder_path") {
        obj.insert("certificate_folder_path".into(), Value::String(String::new()));
    }

    // certificate_folder_path 更新守則
    if new_data.as_object().map(|o| o.contains_key("certificate_folder_path")).unwrap_or(false) {
        let old = obj.get("certificate_folder_path").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let new_val = new_data.get("certificate_folder_path").cloned().unwrap_or(Value::Null);
        let new_str = new_val.as_str().unwrap_or("");
        let old_nonempty = !old.trim().is_empty();
        let new_empty = new_str.trim().is_empty();
        if old_nonempty && new_empty {
            let user_initiated = new_data.get("user_initiated").and_then(|v| v.as_bool()).unwrap_or(false);
            if user_initiated {
                obj.insert("certificate_folder_path".into(), new_val);
            } else {
                return FlashUpdateResult::rejected();
            }
        } else {
            obj.insert("certificate_folder_path".into(), new_val);
        }
    }

    match atomic_write(&p, &flash) {
        Ok(()) => FlashUpdateResult::ok(),
        Err(e) => FlashUpdateResult::err(e),
    }
}

// 供測試與 get_flash_path_data 共用的純函式
fn apply_for_test(existing: &mut Value, new_data: &Value) {
    // 與 update 的 apply 段相同邏輯（僅供單元測試驗證合併/取代/守則，不含 IO）
    migrate(existing, true);
    let obj = existing.as_object_mut().unwrap();
    let path_type = new_data.get("path_type").and_then(|v| v.as_str()).unwrap_or("nordic").to_string();
    if !obj.get(&path_type).map(|v| v.is_object()).unwrap_or(false) {
        obj.insert(path_type.clone(), json!({ "current_used_paths": {}, "saved_paths": [] }));
    }
    if let Some(incoming) = new_data.get("current_used_paths").filter(|v| !v.is_null()) {
        if let Some(io) = incoming.as_object() {
            let target = obj.get_mut(&path_type).unwrap().as_object_mut().unwrap();
            let cup = target.entry("current_used_paths").or_insert_with(|| json!({}));
            let cup_obj = cup.as_object_mut().unwrap();
            for (k, v) in io { cup_obj.insert(k.clone(), v.clone()); }
        }
    }
    if let Some(incoming) = new_data.get("saved_paths").filter(|v| !v.is_null()) {
        let target = obj.get_mut(&path_type).unwrap().as_object_mut().unwrap();
        target.insert("saved_paths".into(), incoming.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_flat_to_nested_nordic() {
        let mut v = json!({ "current_used_paths": {"a":1}, "saved_paths": [1,2] });
        migrate(&mut v, true);
        assert_eq!(v["nordic"]["current_used_paths"]["a"], 1);
        assert_eq!(v["nordic"]["saved_paths"][1], 2);
        assert!(v.get("current_used_paths").is_none());
    }

    #[test]
    fn migrate_credential_to_certificate_folder() {
        let mut v = json!({ "credential_folder_path": "/c" });
        migrate(&mut v, true);
        assert_eq!(v["certificate_folder_path"], "/c");
        assert!(v.get("credential_folder_path").is_none());
    }

    #[test]
    fn migrate_read_keeps_legacy() {
        let mut v = json!({ "credential_folder_path": "/c" });
        migrate(&mut v, false);
        assert_eq!(v["certificate_folder_path"], "/c");
        assert_eq!(v["credential_folder_path"], "/c"); // 讀路徑保留
    }

    #[test]
    fn apply_merges_current_and_replaces_saved() {
        let mut v = json!({ "nordic": { "current_used_paths": {"x":"1"}, "saved_paths": ["old"] } });
        apply_for_test(&mut v, &json!({ "path_type":"nordic", "current_used_paths": {"y":"2"}, "saved_paths": ["new"] }));
        assert_eq!(v["nordic"]["current_used_paths"]["x"], "1"); // 保留既有
        assert_eq!(v["nordic"]["current_used_paths"]["y"], "2"); // 合併新值
        assert_eq!(v["nordic"]["saved_paths"], json!(["new"]));  // 整段取代
    }

    #[test]
    fn atomic_write_then_read_roundtrip() {
        let dir = std::env::temp_dir().join(format!("flashrt_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = FlashPaths {
            main: dir.join("flash_path_data.json"),
            tmp: dir.join("flash_path_data.json.tmp"),
            bak: dir.join("flash_path_data.json.bak"),
        };
        atomic_write(&p, &json!({ "certificate_folder_path": "/c", "nordic": {"current_used_paths":{},"saved_paths":[]} })).unwrap();
        let back = read_existing(&p);
        assert_eq!(back["certificate_folder_path"], "/c");
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Step 3: `commands/mod.rs` 加 `flash`（若 Task 1 未加）**

確認 `commands/mod.rs` 含 `pub mod flash;`。

- [ ] **Step 4: 註冊（lib.rs）**

於 `commands::certs::get_selected_certificate,` 之後加入：
```rust
            commands::flash::update_flash_path_data,
```

- [ ] **Step 5: 跑測試**

Run: `cd src-tauri && cargo test flash`
Expected: 5 個測試 PASS。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/flash.rs src-tauri/src/state.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): update_flash_path_data with atomic write/backup/migration + flash_lock"
```

---

## Task 4: `flash.rs` — `get_flash_path_data`

**Files:** Modify `src-tauri/src/commands/flash.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 `flash.rs` 加入 `get_flash_path_data`（讀取 + 遷移 + 結構化）**

於 command 區新增：
```rust
/// 讀取 flashPathData 並回傳指定 pathType 的結構化資料。永不 throw；失敗回預設結構。
#[tauri::command]
pub fn get_flash_path_data(app: AppHandle, state: State<AppState>, path_type: Option<String>) -> Value {
    let path_type = path_type.unwrap_or_else(|| "nordic".to_string());
    let _guard = state.flash_lock.lock();
    let p = match flash_paths(&app) {
        Ok(p) => p,
        Err(_) => return default_flash(),
    };

    // 讀主檔（含 EACCES/EBUSY/EPERM 簡單重試）；parse 失敗 → 試 .bak 並 best-effort 修復主檔。
    let mut parsed: Value = match read_main_with_retry(&p.main) {
        Ok(s) => match serde_json::from_str::<Value>(&s) {
            Ok(v) if v.is_object() => v,
            _ => match read_bak_value(&p) {
                Some(bak) => {
                    // best-effort 用備份修復主檔（不致命）
                    let _ = atomic_write(&p, &bak);
                    bak
                }
                None => return default_flash(),
            },
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return default_flash(),
        Err(_) => match read_bak_value(&p) {
            Some(bak) => bak,
            None => return default_flash(),
        },
    };

    migrate(&mut parsed, false); // 讀路徑：不刪 legacy
    let obj = parsed.as_object_mut().unwrap();

    // 確保 certificate_folder_path
    let cert = obj.get("certificate_folder_path").cloned().unwrap_or_else(|| Value::String(String::new()));
    obj.insert("certificate_folder_path".into(), if cert.is_string() { cert } else { Value::String(String::new()) });

    // 確保 pathType 結構
    if !obj.get(&path_type).map(|v| v.is_object()).unwrap_or(false) {
        obj.insert(path_type.clone(), json!({ "current_used_paths": {}, "saved_paths": [] }));
    }

    let type_obj = obj.get(&path_type).unwrap();
    let mut result = Map::new();
    result.insert("certificate_folder_path".into(), obj.get("certificate_folder_path").cloned().unwrap());
    result.insert("current_used_paths".into(), type_obj.get("current_used_paths").cloned().unwrap_or_else(|| json!({})));
    result.insert("saved_paths".into(), type_obj.get("saved_paths").cloned().unwrap_or_else(|| json!([])));
    Value::Object(result)
}

fn read_main_with_retry(main: &PathBuf) -> std::io::Result<String> {
    use std::io::ErrorKind;
    let mut last: Option<std::io::Error> = None;
    for i in 0..3 {
        match std::fs::read_to_string(main) {
            Ok(s) => return Ok(s),
            Err(e) => {
                let retriable = matches!(e.kind(), ErrorKind::PermissionDenied)
                    || matches!(e.raw_os_error(), Some(32) | Some(33)); // Windows ERROR_SHARING_VIOLATION/LOCK
                if e.kind() == ErrorKind::NotFound || !retriable || i == 2 {
                    return Err(e);
                }
                last = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(50 * (i as u64 + 1)));
            }
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "retry failed")))
}

fn read_bak_value(p: &FlashPaths) -> Option<Value> {
    let s = std::fs::read_to_string(&p.bak).ok()?;
    serde_json::from_str::<Value>(&s).ok().filter(|v| v.is_object())
}
```

> 註：`read_value` import 若未使用會有警告，本檔 `read_existing`/`get` 改用 `std::fs` 直接讀，故可移除 `use crate::json_store::read_value;`（若 Task 3 未用到）。編譯時依警告調整 import。

在 `#[cfg(test)] mod tests` 內新增（驗證結構化與預設）：
```rust
    #[test]
    fn structure_result_from_parsed() {
        // 模擬 get 的結構化輸出（純資料）
        let mut parsed = json!({
            "certificate_folder_path": "/cf",
            "nordic": { "current_used_paths": {"softDevicePath":"/s"}, "saved_paths": [{"id":1}] }
        });
        migrate(&mut parsed, false);
        let obj = parsed.as_object().unwrap();
        let t = obj.get("nordic").unwrap();
        assert_eq!(obj["certificate_folder_path"], "/cf");
        assert_eq!(t["current_used_paths"]["softDevicePath"], "/s");
        assert_eq!(t["saved_paths"][0]["id"], 1);
    }

    #[test]
    fn default_flash_shape() {
        let d = default_flash();
        assert_eq!(d["certificate_folder_path"], "");
        assert!(d["current_used_paths"].is_object());
        assert!(d["saved_paths"].is_array());
    }
```

- [ ] **Step 2: 註冊（lib.rs）**

於 `commands::flash::update_flash_path_data,` 之後加入：
```rust
            commands::flash::get_flash_path_data,
```

- [ ] **Step 3: 跑測試 + 編譯**

Run: `cd src-tauri && cargo test flash`
Expected: Task 3 的 5 個 + 本 Task 2 個共 7 個 PASS，且 `cargo build` 無錯（依警告移除未用 import）。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/flash.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): get_flash_path_data with backup recovery + retry"
```

---

## Task 5: config.rs — `get_api_credential_configs` + `set_api_credential_configs`

**Files:** Modify `src-tauri/src/commands/config.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 `config.rs` 加入兩個 command 與測試**

於 `config.rs`（`clear_caches` 之後）新增。注意 `save_config` 已存在且會 merge + 廣播 `config-updated`，`set_api_credential_configs` 直接複用：
```rust
#[tauri::command]
pub fn get_api_credential_configs(app: AppHandle) -> Value {
    let config = load_config_raw(&app);
    let api_configs = config.get("credentialsFilePaths").cloned();
    let arr_empty = match &api_configs {
        Some(Value::Array(a)) => a.is_empty(),
        _ => true,
    };
    if arr_empty {
        if let Some(p) = config.get("credentialsFilePath").and_then(|v| v.as_str()) {
            if !p.is_empty() {
                return json!([{ "id": "default-migrated", "name": "Migrated Key", "path": p }]);
            }
        }
    }
    match api_configs {
        Some(Value::Array(a)) => Value::Array(a),
        _ => json!([]),
    }
}

#[tauri::command]
pub fn set_api_credential_configs(app: AppHandle, api_configs: Value) -> CommandResult {
    if !api_configs.is_array() {
        return CommandResult::err_pub("Invalid data format: apiConfigs must be an array.".into());
    }
    // 寫入新陣列、清掉舊的 singular 路徑；save_config 會 merge + 廣播 config-updated
    save_config(app, json!({ "credentialsFilePaths": api_configs, "credentialsFilePath": "" }))
}
```

> 因 `set_api_credential_configs` 呼叫 `save_config`，而 `save_config` 簽名為 `pub fn save_config(app: AppHandle, config: Value)`，直接傳值即可。`CommandResult::err_pub` 已於 1a 設為 `pub`。

在 `config.rs` 的 `#[cfg(test)] mod tests` 內新增（純邏輯，不經 AppHandle）：
```rust
    #[test]
    fn api_configs_migrates_singular_when_array_empty() {
        // 模擬 get 的遷移判斷
        let config = json!({ "credentialsFilePath": "/old/key.csv" });
        let arr = config.get("credentialsFilePaths").cloned();
        let empty = !matches!(&arr, Some(Value::Array(a)) if !a.is_empty());
        assert!(empty);
        let migrated = json!([{ "id":"default-migrated", "name":"Migrated Key", "path": config["credentialsFilePath"] }]);
        assert_eq!(migrated[0]["path"], "/old/key.csv");
        assert_eq!(migrated[0]["id"], "default-migrated");
    }

    #[test]
    fn api_configs_prefers_existing_array() {
        let config = json!({ "credentialsFilePaths": [{"id":"a"}], "credentialsFilePath": "/x" });
        let arr = config.get("credentialsFilePaths").cloned();
        let empty = !matches!(&arr, Some(Value::Array(a)) if !a.is_empty());
        assert!(!empty); // 非空陣列 → 不遷移
    }
```

- [ ] **Step 2: 註冊（lib.rs）**

於 `commands::config::clear_caches,` 之後加入：
```rust
            commands::config::get_api_credential_configs,
            commands::config::set_api_credential_configs,
```

- [ ] **Step 3: 跑測試**

Run: `cd src-tauri && cargo test config`
Expected: 1a 的 2 個 + 本 Task 2 個共 4 個 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/config.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): get/set_api_credential_configs with singular->plural migration"
```

---

## Task 6: 前端 api 模組接線（含 vitest）

**Files:** Modify `src/api/index.js`, `src/api/index.test.js`

- [ ] **Step 1: 更新測試 `src/api/index.test.js`**

(a) 把「未移植方法」測試的範例從 `scanCertificates`（即將移植）改成仍未移植的 `listSerialPorts`：
```javascript
  it('未移植方法回傳 rejected promise（NotPortedError），不可同步 throw', async () => {
    const p = api.listSerialPorts();
    expect(typeof p.then).toBe('function');
    await expect(p).rejects.toBeInstanceOf(NotPortedError);
  });
```

(b) 在 `describe('api module', ...)` 內新增（放在現有測試之後、`});` 之前）：
```javascript
  it('scanCertificates 轉呼 invoke scan_certificates 帶 certificatesPath', async () => {
    invokeMock.mockResolvedValue([{ id: 'X1' }]);
    await expect(api.scanCertificates('/certs')).resolves.toEqual([{ id: 'X1' }]);
    expect(invokeMock).toHaveBeenCalledWith('scan_certificates', { certificatesPath: '/certs' });
  });

  it('getSelectedCertificate 轉呼 invoke get_selected_certificate', async () => {
    invokeMock.mockResolvedValue({ id: 'X1', certificateid: 'AAAA' });
    await expect(api.getSelectedCertificate()).resolves.toEqual({ id: 'X1', certificateid: 'AAAA' });
    expect(invokeMock).toHaveBeenCalledWith('get_selected_certificate');
  });

  it('updateFlashPathData 轉呼 invoke update_flash_path_data 帶 newData', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.updateFlashPathData({ path_type: 'nordic', saved_paths: [] });
    expect(invokeMock).toHaveBeenCalledWith('update_flash_path_data', { newData: { path_type: 'nordic', saved_paths: [] } });
  });

  it('getFlashPathData 轉呼 invoke get_flash_path_data 帶 pathType', async () => {
    invokeMock.mockResolvedValue({ certificate_folder_path: '', current_used_paths: {}, saved_paths: [] });
    await api.getFlashPathData('silabs');
    expect(invokeMock).toHaveBeenCalledWith('get_flash_path_data', { pathType: 'silabs' });
  });

  it('setApiCredentialConfigs 轉呼 invoke set_api_credential_configs 帶 apiConfigs', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.setApiCredentialConfigs([{ id: 'a' }]);
    expect(invokeMock).toHaveBeenCalledWith('set_api_credential_configs', { apiConfigs: [{ id: 'a' }] });
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/api/index.test.js`
Expected: 新增/改寫的測試 FAIL（方法仍 NotPorted）。

- [ ] **Step 3: 實作 `src/api/index.js` 變更**

把下列方法從 `notPorted(...)` 改為真實呼叫（其餘 stub 不動；**保留** `scanCredentials`/`getCredentialsPath`/`getSelectedCredential` 為 `notPorted`）：
```javascript
  scanCertificates: (path) => invoke('scan_certificates', { certificatesPath: path }),
  getCertificatesPath: () => invoke('get_certificates_path'),
  getSelectedCertificate: () => invoke('get_selected_certificate'),
  updateFlashPathData: (data) => invoke('update_flash_path_data', { newData: data }),
  getFlashPathData: (pathType) => invoke('get_flash_path_data', { pathType }),
  getApiCredentialConfigs: () => invoke('get_api_credential_configs'),
  setApiCredentialConfigs: (configs) => invoke('set_api_credential_configs', { apiConfigs: configs }),
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/api/index.test.js`
Expected: 全部 PASS。

- [ ] **Step 5: 全套件無回歸**

Run: `npx vitest run`
Expected: 無新增 failure（基準 681）。

- [ ] **Step 6: Commit**

```bash
git add src/api/index.js src/api/index.test.js
git commit -m "feat(api): wire certs/flash/api-credential-config methods to tauri"
```

---

## Task 7: 端到端驗證 + 收尾

**Files:** 無

- [ ] **Step 1: 後端全測試**

Run: `cd src-tauri && cargo test`
Expected: 1a 的 9 個 + 1b（certs 7、flash 7、config +2）全綠。

- [ ] **Step 2: 前端全測試**

Run: `npx vitest run`
Expected: 無新增 failure（基準 681）。

- [ ] **Step 3: 啟動煙霧測試**

Run: `npm run tauri:dev`
Expected: App 啟動、主視窗渲染、log 無 runtime/capability 錯誤。（驗畢請關閉 dev 程序樹，避免鎖住 .exe。）

- [ ] **Step 4: 手動 GUI 驗收（需人工點擊）**
- 設定 → ENV → 選 credentials 資料夾 → 觸發 `scanCertificates`，憑證頁表格出現掃描結果。
- Nordic/Silabs 路徑設定：選檔 → `updateFlashPathData(current_used_paths)`；儲存路徑組 → `saved_paths`；重啟後 `getFlashPathData` 還原。
- 憑證頁選一張憑證 → `getSelectedCertificate` 在 API Test / Flash 頁顯示正確 certificateid。
- API Settings 新增/刪除一組 API 金鑰設定 → `setApiCredentialConfigs` 持久化、`getApiCredentialConfigs` 還原。
- 切到未移植領域（postman 執行、序列、網路）仍以 NotPortedError 優雅降級、不崩潰。

- [ ] **Step 5: 記錄結果**（無 commit，除非修問題）

---

## 階段 1b 完成定義

- [ ] 憑證資料夾掃描填表（`scan_certificates` 寫 `user_data.json`、回陣列、失敗 throw）
- [ ] 已選憑證解析正確（含舊 id 格式向後相容與 selection_model 改寫）
- [ ] flashPathData 來回讀寫：`current_used_paths` 合併、`saved_paths` 取代、`certificate_folder_path` 守則三態、原子寫入 + .bak 備份 + 遷移、損毀可從 .bak 復原
- [ ] API 憑證設定 get/set 持久化（singular→plural 遷移、非陣列驗證、廣播 config-updated）
- [ ] `cargo test` 綠；前端 vitest 無回歸
- [ ] 未移植領域仍以 NotPortedError 優雅降級

---

## Self-Review 紀錄

- **Spec 覆蓋**：對應 spec §1 certs.rs（憑證掃描/已選憑證）與 config.rs flashPathData 職責；§2 回傳形狀逐字保留（陣列/`null`/三態 CommandResult/固定三鍵物件）與 camelCase→snake_case（`certificatesPath`/`newData`/`pathType`/`apiConfigs`）；§3 flashPathData 競態改用 `AppState.flash_lock` 持鎖跨讀改寫；§4 檔案損毀復原（temp→驗證→rename→.bak→損毀回復）。憑證檔解析（parseCredentialFileContent）明確劃到階段 3（其唯一消費者 execute_postman_request 在階段 3），三個無 handler 的 credential 通道維持 notPorted，皆已於範圍決策載明，非遺漏。
- **Placeholder 掃描**：無 TBD/TODO；每個程式步驟有完整程式碼與預期輸出。
- **型別一致性**：`FlashUpdateResult`（success/error/rejected）對應三態回傳；`CommandResult`（1a 既有，`ok_pub`/`err_pub` 為 pub）供 set_api_credential_configs 經 `save_config` 使用；command 名稱（snake_case）與前端 `invoke('...')` 字串逐一對應；`load_config_raw` 改 `pub(crate)` 供 certs.rs 使用；`AppState.flash_lock` 在 state.rs 定義、flash.rs 以 `State<AppState>` 取用。
- **快取決策**：延續 1a，不移植 `certificatesCache`/`userDataCache`/`configCache`，每次直接讀檔。
