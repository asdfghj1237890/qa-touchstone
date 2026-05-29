# Tauri 遷移 — 階段 1a：設定與簡單檔案 I/O（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Rust 實作設定與簡單檔案 I/O 領域的後端 command，並把前端 `src/api` 模組對應方法從 `NotPortedError` stub 換成真實 `invoke`，讓設定 ENV 頁、visiblePages、檔案選擇器、API Test 狀態、憑證表格的 filter/selection 持久化能運作。

**Architecture:** 延續方案 A（前端 `window.electronAPI` 介面不變，內部走 Tauri）。後端新增 `paths`（userData 目錄）與 `json_store`（讀寫 JSON 的 DRY helper）兩個 util 模組，以及 `commands/config.rs`、`commands/store.rs`、`commands/fsops.rs`。**刻意不移植 Electron 的記憶體 TTL 快取**——它只是效能優化，Rust 檔案讀取很快，移除可消除一整類快取一致性 bug；`clear_caches` 因此成為回傳 `{success:true}` 的 no-op。檔案對話框改用 `@tauri-apps/plugin-dialog` 的 JS API，不需 Rust command。

**Tech Stack:** Rust（serde_json、tauri 2、tauri-plugin-dialog）、既有前端 + vitest。

參照設計文件：`docs/superpowers/specs/2026-05-28-tauri-migration-design.md`（§2 api 契約、§3 跨視窗事件廣播、§4 錯誤處理）。階段 0 已完成 api 抽象層、系統/視窗 command、AppError、事件常數。

**逐字保留的回傳形狀（不可改）：**
- `save_config` / `save_visible_pages` / `save_user_data` / `save_filter_model` / `save_selection_model` / `save_api_test_state` → `{ success: true }` 或 `{ success: false, error: "..." }`
- `load_config` → config 物件（`visiblePages` 與預設合併）
- `load_visible_pages` → visiblePages 物件（與預設合併）
- `load_user_data` → 陣列（檔案不存在時回 `[]`）
- `load_filter_model` / `load_selection_model` / `load_api_test_state` → 物件或 `null`（檔案不存在時 `null`）
- `read_directory` → 檔名字串陣列（錯誤時回 `[]`）
- `read_file_content` → 字串（路徑含 `..` 或讀取失敗時 **throw**）
- `find_hex_file` → `.hex` 檔完整路徑或 `null`

**DEFAULT_VISIBLE_PAGES（對齊 electron.js）：**
```
{ credentials:true, flashNordic:true, flashSilabs:true, flashEFD:true, flashRFD:true, tab6:true, apiTest:true, tab8:false }
```

---

## File Structure

**新增（Rust）**
- `src-tauri/src/paths.rs` — userData 目錄解析 + 各 JSON 檔路徑
- `src-tauri/src/json_store.rs` — `read_value`/`write_pretty`/`read_or_null` 等 DRY helper
- `src-tauri/src/commands/config.rs` — `load_config`、`save_config`、`save_visible_pages`、`load_visible_pages`、`clear_caches`
- `src-tauri/src/commands/store.rs` — `load_user_data`、`save_user_data`、`load_filter_model`、`save_filter_model`、`load_selection_model`、`save_selection_model`、`save_api_test_state`、`load_api_test_state`
- `src-tauri/src/commands/fsops.rs` — `read_directory`、`read_file_content`、`find_hex_file`

**修改**
- `src-tauri/Cargo.toml` — 加 `tauri-plugin-dialog = "2"`
- `src-tauri/src/lib.rs` — 註冊 dialog plugin + 新 command；`save_config` 需 `AppHandle` 以 emit
- `src-tauri/src/commands/mod.rs` — 加 `config`/`store`/`fsops` 模組
- `src-tauri/capabilities/default.json` — 加 `dialog:default`
- `package.json` — 加 `@tauri-apps/plugin-dialog`
- `src/api/index.js` — 對應方法改真實 invoke；對話框用 plugin-dialog
- `src/api/index.test.js` — 更新（這些方法不再 NotPorted）

---

## Task 1: 安裝 dialog plugin（npm + cargo + capability）

**Files:** Modify `package.json`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 安裝前端 plugin**

Run（專案根）: `npm install @tauri-apps/plugin-dialog@^2`
Expected: 安裝成功，`package.json` dependencies 出現 `@tauri-apps/plugin-dialog`。

- [ ] **Step 2: 加 Rust 相依**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 區塊末尾加一行：
```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 3: 註冊 plugin（lib.rs）**

在 `src-tauri/src/lib.rs` 的 builder 鏈，於 `.plugin(tauri_plugin_log::Builder::new().build())` 之後加一行：
```rust
        .plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 4: 加 capability**

在 `src-tauri/capabilities/default.json` 的 `permissions` 陣列加入：
```json
    "dialog:default",
```

- [ ] **Step 5: 編譯確認**

Run: `cd src-tauri && cargo build`
Expected: 編譯成功（會下載 tauri-plugin-dialog）。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities/default.json src-tauri/src/lib.rs
git commit -m "chore(tauri): add dialog plugin"
```

---

## Task 2: `paths` 與 `json_store` helper（含 cargo 測試）

**Files:** Create `src-tauri/src/paths.rs`, `src-tauri/src/json_store.rs`; Modify `src-tauri/src/lib.rs`

- [ ] **Step 1: 建立 `src-tauri/src/paths.rs`**

```rust
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// 取得 userData 目錄（對齊 Electron 的 app.getPath('userData')）。
/// 若不存在則建立。
pub fn config_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string()))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

/// userData 下某個檔案的完整路徑。
pub fn data_file(app: &AppHandle, name: &str) -> std::io::Result<PathBuf> {
    Ok(config_dir(app)?.join(name))
}
```

- [ ] **Step 2: 建立 `src-tauri/src/json_store.rs`（含測試）**

```rust
use crate::error::{AppError, AppResult};
use serde_json::Value;
use std::path::Path;

/// 讀取 JSON 檔為 Value；檔案不存在回 None。
pub fn read_value(path: &Path) -> AppResult<Option<Value>> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(Some(serde_json::from_str(&s)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// 以 pretty JSON 寫檔（2 空格縮排，對齊 Electron 的 JSON.stringify(x,null,2)）。
pub fn write_pretty(path: &Path, value: &Value) -> AppResult<()> {
    let s = serde_json::to_string_pretty(value)?;
    std::fs::write(path, s)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_file_reads_none() {
        let dir = std::env::temp_dir().join(format!("jsdiag_{}", std::process::id()));
        let p = dir.join("nope.json");
        assert!(read_value(&p).unwrap().is_none());
    }

    #[test]
    fn write_then_read_roundtrips() {
        let dir = std::env::temp_dir().join(format!("jsrt_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("x.json");
        write_pretty(&p, &json!({"a":1,"b":[2,3]})).unwrap();
        let v = read_value(&p).unwrap().unwrap();
        assert_eq!(v["a"], 1);
        assert_eq!(v["b"][1], 3);
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Step 3: 在 lib.rs 宣告模組**

在 `src-tauri/src/lib.rs` 最上方的 `mod` 區塊加入：
```rust
mod json_store;
mod paths;
```

- [ ] **Step 4: 跑測試**

Run: `cd src-tauri && cargo test json_store`
Expected: `missing_file_reads_none`、`write_then_read_roundtrips` PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/paths.rs src-tauri/src/json_store.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): paths + json_store helpers"
```

---

## Task 3: config 與 visiblePages command（含測試）

**Files:** Create `src-tauri/src/commands/config.rs`; Modify `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 建立 `src-tauri/src/commands/config.rs`**

```rust
use crate::json_store::{read_value, write_pretty};
use crate::paths::data_file;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};

const CONFIG_FILE: &str = "config.json";

fn default_visible_pages() -> Value {
    json!({
        "credentials": true,
        "flashNordic": true,
        "flashSilabs": true,
        "flashEFD": true,
        "flashRFD": true,
        "tab6": true,
        "apiTest": true,
        "tab8": false
    })
}

#[derive(Serialize)]
pub struct CommandResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl CommandResult {
    fn ok() -> Self { Self { success: true, error: None } }
    fn err(e: String) -> Self { Self { success: false, error: Some(e) } }
}

fn load_config_raw(app: &AppHandle) -> Value {
    let path = match data_file(app, CONFIG_FILE) {
        Ok(p) => p,
        Err(_) => return json!({}),
    };
    match read_value(&path) {
        Ok(Some(v)) if v.is_object() => v,
        _ => json!({}),
    }
}

/// 將 visiblePages 與預設合併（缺的補預設）。
fn merge_visible_pages(config: &mut Value) {
    let defaults = default_visible_pages();
    let obj = config.as_object_mut().unwrap();
    let merged = match obj.get("visiblePages").and_then(|v| v.as_object()) {
        Some(existing) => {
            let mut m = defaults.as_object().unwrap().clone();
            for (k, val) in existing { m.insert(k.clone(), val.clone()); }
            Value::Object(m)
        }
        None => defaults,
    };
    obj.insert("visiblePages".into(), merged);
}

#[tauri::command]
pub fn load_config(app: AppHandle) -> Value {
    let mut config = load_config_raw(&app);
    if !config.is_object() { config = json!({}); }
    merge_visible_pages(&mut config);
    config
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: Value) -> CommandResult {
    let path = match data_file(&app, CONFIG_FILE) {
        Ok(p) => p,
        Err(e) => return CommandResult::err(e.to_string()),
    };
    let mut current = load_config_raw(&app);
    let cur = current.as_object_mut().unwrap();
    if let Some(incoming) = config.as_object() {
        for (k, v) in incoming { cur.insert(k.clone(), v.clone()); }
    }
    let merged = Value::Object(cur.clone());
    if let Err(e) = write_pretty(&path, &merged) {
        return CommandResult::err(e.to_string());
    }
    // 廣播給所有視窗（對齊 Electron 的 config-updated）
    let _ = app.emit(crate::events::CONFIG_UPDATED, merged);
    CommandResult::ok()
}

#[tauri::command]
pub fn save_visible_pages(app: AppHandle, visible_pages: Value) -> CommandResult {
    save_config(app, json!({ "visiblePages": visible_pages }))
}

#[tauri::command]
pub fn load_visible_pages(app: AppHandle) -> Value {
    let config = load_config(app);
    config.get("visiblePages").cloned().unwrap_or_else(default_visible_pages)
}

#[tauri::command]
pub fn clear_caches() -> CommandResult {
    // 本移植不使用記憶體快取，無需清除。
    CommandResult::ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_fills_missing_visible_pages() {
        let mut c = json!({ "visiblePages": { "tab8": true } });
        merge_visible_pages(&mut c);
        let vp = &c["visiblePages"];
        assert_eq!(vp["tab8"], true);        // 保留既有
        assert_eq!(vp["credentials"], true); // 補預設
        assert_eq!(vp["flashSilabs"], true);
    }

    #[test]
    fn merge_uses_defaults_when_absent() {
        let mut c = json!({ "credentials": "/x" });
        merge_visible_pages(&mut c);
        assert_eq!(c["visiblePages"]["tab8"], false);
    }
}
```

> 注意：Tauri v2 會把 JS 的 camelCase 參數鍵轉成 snake_case，所以前端傳 `visiblePages` 會對應到 `visible_pages` 參數。

- [ ] **Step 2: 在 `commands/mod.rs` 加模組**

```rust
pub mod config;
pub mod fsops;
pub mod store;
pub mod system;
pub mod window;
```

- [ ] **Step 3: 註冊 command（lib.rs `generate_handler!`）**

在 `tauri::generate_handler![...]` 內，於 `commands::window::open_settings,` 之後加入：
```rust
            commands::config::load_config,
            commands::config::save_config,
            commands::config::save_visible_pages,
            commands::config::load_visible_pages,
            commands::config::clear_caches,
```

- [ ] **Step 4: 跑測試**

Run: `cd src-tauri && cargo test config`
Expected: `merge_fills_missing_visible_pages`、`merge_uses_defaults_when_absent` PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/config.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): config + visiblePages commands with config-updated broadcast"
```

---

## Task 4: store command（userData / filter / selection / apiTestState）

**Files:** Create `src-tauri/src/commands/store.rs`; Modify `src-tauri/src/lib.rs`

- [ ] **Step 1: 建立 `src-tauri/src/commands/store.rs`**

```rust
use crate::commands::config::CommandResult;
use crate::json_store::{read_value, write_pretty};
use crate::paths::data_file;
use serde_json::{json, Value};
use tauri::AppHandle;

fn save_blob(app: &AppHandle, file: &str, value: &Value) -> CommandResult {
    let path = match data_file(app, file) {
        Ok(p) => p,
        Err(e) => return CommandResult::err_pub(e.to_string()),
    };
    match write_pretty(&path, value) {
        Ok(()) => CommandResult::ok_pub(),
        Err(e) => CommandResult::err_pub(e.to_string()),
    }
}

fn load_blob_or_null(app: &AppHandle, file: &str) -> Value {
    match data_file(app, file).ok().and_then(|p| read_value(&p).ok().flatten()) {
        Some(v) => v,
        None => Value::Null,
    }
}

#[tauri::command]
pub fn save_user_data(app: AppHandle, user_data: Value) -> CommandResult {
    save_blob(&app, "user_data.json", &user_data)
}

#[tauri::command]
pub fn load_user_data(app: AppHandle) -> Value {
    // 檔案不存在時回空陣列（對齊 Electron）
    match load_blob_or_null(&app, "user_data.json") {
        Value::Null => json!([]),
        v => v,
    }
}

#[tauri::command]
pub fn save_filter_model(app: AppHandle, filter_model: Value) -> CommandResult {
    save_blob(&app, "filter_model.json", &filter_model)
}

#[tauri::command]
pub fn load_filter_model(app: AppHandle) -> Value {
    load_blob_or_null(&app, "filter_model.json")
}

#[tauri::command]
pub fn save_selection_model(app: AppHandle, selection_model: Value) -> CommandResult {
    save_blob(&app, "selection_model.json", &selection_model)
}

#[tauri::command]
pub fn load_selection_model(app: AppHandle) -> Value {
    load_blob_or_null(&app, "selection_model.json")
}

#[tauri::command]
pub fn save_api_test_state(app: AppHandle, state: Value) -> CommandResult {
    if !state.is_object() {
        return CommandResult::err_pub("Invalid state data".into());
    }
    save_blob(&app, "api_test_state.json", &state)
}

#[tauri::command]
pub fn load_api_test_state(app: AppHandle) -> Value {
    load_blob_or_null(&app, "api_test_state.json")
}
```

- [ ] **Step 2: 讓 `CommandResult` 可被 store 模組使用**

在 `src-tauri/src/commands/config.rs` 的 `impl CommandResult` 區塊，把建構子改為 `pub` 並新增別名：
```rust
impl CommandResult {
    pub fn ok_pub() -> Self { Self { success: true, error: None } }
    pub fn err_pub(e: String) -> Self { Self { success: false, error: Some(e) } }
    fn ok() -> Self { Self::ok_pub() }
    fn err(e: String) -> Self { Self::err_pub(e) }
}
```

> （保留原本 `ok()`/`err()` 給 config.rs 內部使用，避免改動 Task 3 的呼叫點。）

- [ ] **Step 3: 註冊 command（lib.rs）**

在 `generate_handler!` 內加入：
```rust
            commands::store::save_user_data,
            commands::store::load_user_data,
            commands::store::save_filter_model,
            commands::store::load_filter_model,
            commands::store::save_selection_model,
            commands::store::load_selection_model,
            commands::store::save_api_test_state,
            commands::store::load_api_test_state,
```

- [ ] **Step 4: 編譯**

Run: `cd src-tauri && cargo build`
Expected: 編譯成功。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/store.rs src-tauri/src/commands/config.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): store commands (userData/filter/selection/apiTestState)"
```

---

## Task 5: fsops command（read_directory / read_file_content / find_hex_file）

**Files:** Create `src-tauri/src/commands/fsops.rs`; Modify `src-tauri/src/lib.rs`

- [ ] **Step 1: 建立 `src-tauri/src/commands/fsops.rs`（含測試）**

```rust
use crate::error::{AppError, AppResult};

#[tauri::command]
pub fn read_directory(folder_path: String) -> Vec<String> {
    match std::fs::read_dir(&folder_path) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect(),
        Err(_) => Vec::new(), // 對齊 Electron：錯誤回 []
    }
}

#[tauri::command]
pub fn find_hex_file(folder_path: String) -> Option<String> {
    let entries = std::fs::read_dir(&folder_path).ok()?;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("hex")) == Some(true) {
            return path.to_str().map(|s| s.to_string());
        }
    }
    None
}

#[tauri::command]
pub fn read_file_content(file_path: String) -> AppResult<String> {
    if file_path.is_empty() {
        return Err(AppError::Other("Invalid file path provided.".into()));
    }
    // 阻擋目錄穿越（對齊 Electron 的 includes('..') 檢查）
    if file_path.contains("..") {
        return Err(AppError::Other("Access to the path is restricted.".into()));
    }
    std::fs::read_to_string(&file_path)
        .map_err(|e| AppError::Other(format!("Failed to read file: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_content_blocks_traversal() {
        let r = read_file_content("../secret.txt".into());
        assert!(r.is_err());
    }

    #[test]
    fn read_file_content_rejects_empty() {
        assert!(read_file_content(String::new()).is_err());
    }

    #[test]
    fn find_hex_file_finds_hex() {
        let dir = std::env::temp_dir().join(format!("hexdiag_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("firmware.hex"), "x").unwrap();
        std::fs::write(dir.join("readme.txt"), "y").unwrap();
        let found = find_hex_file(dir.to_str().unwrap().to_string()).unwrap();
        assert!(found.to_lowercase().ends_with(".hex"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_directory_missing_returns_empty() {
        let v = read_directory("/no/such/dir/xyz".into());
        assert!(v.is_empty());
    }
}
```

- [ ] **Step 2: 註冊 command（lib.rs）**

在 `generate_handler!` 內加入：
```rust
            commands::fsops::read_directory,
            commands::fsops::find_hex_file,
            commands::fsops::read_file_content,
```

- [ ] **Step 3: 跑測試**

Run: `cd src-tauri && cargo test fsops`
Expected: 4 個測試 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/fsops.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): fsops commands (read_directory/read_file_content/find_hex_file)"
```

---

## Task 6: 前端 api 模組接線（含 vitest）

**Files:** Modify `src/api/index.js`, `src/api/index.test.js`

- [ ] **Step 1: 更新測試 `src/api/index.test.js`**

在檔案最上方 mock 區塊加入 plugin-dialog mock：
```javascript
const openMock = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a) => openMock(...a) }));
```

在 `describe('api module', ...)` 內，把 `beforeEach` 補上 `openMock.mockReset();`，並新增測試：
```javascript
  it('loadConfig 轉呼 invoke load_config（已移植，不再 NotPorted）', async () => {
    invokeMock.mockResolvedValue({ visiblePages: {} });
    await expect(api.loadConfig()).resolves.toEqual({ visiblePages: {} });
    expect(invokeMock).toHaveBeenCalledWith('load_config');
  });

  it('saveConfig 帶參數轉呼 invoke save_config', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.saveConfig({ credentials: '/x' });
    expect(invokeMock).toHaveBeenCalledWith('save_config', { config: { credentials: '/x' } });
  });

  it('selectDirectory 透過 plugin-dialog open({directory:true})', async () => {
    openMock.mockResolvedValue('/picked/dir');
    await expect(api.selectDirectory()).resolves.toBe('/picked/dir');
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it('readFileContent 轉呼 invoke read_file_content', async () => {
    invokeMock.mockResolvedValue('file contents');
    await expect(api.readFileContent('/a/b.txt')).resolves.toBe('file contents');
    expect(invokeMock).toHaveBeenCalledWith('read_file_content', { filePath: '/a/b.txt' });
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/api/index.test.js`
Expected: 新增的 4 個測試 FAIL（方法仍是 NotPorted stub / dialog 未接）。

- [ ] **Step 3: 實作 `src/api/index.js` 變更**

在檔頭加入 import：
```javascript
import { open as openDialog } from '@tauri-apps/plugin-dialog';
```

在 `export const api = {` 物件中，把下列**對話框**方法（原為 stub）改為：
```javascript
  selectDirectory: () => openDialog({ directory: true, multiple: false }),
  selectFile: () => openDialog({ directory: false, multiple: false }),
```

把下列方法從 `notPorted(...)` 改為真實 invoke（參數鍵用 camelCase，Tauri 會轉 snake_case）：
```javascript
  loadConfig: () => invoke('load_config'),
  saveConfig: (config) => invoke('save_config', { config }),
  loadUserData: () => invoke('load_user_data'),
  saveUserData: (userData) => invoke('save_user_data', { userData }),
  loadFilterModel: () => invoke('load_filter_model'),
  saveFilterModel: (filterModel) => invoke('save_filter_model', { filterModel }),
  loadSelectionModel: () => invoke('load_selection_model'),
  saveSelectionModel: (selectionModel) => invoke('save_selection_model', { selectionModel }),
  readDirectory: (folderPath) => invoke('read_directory', { folderPath }),
  readFileContent: (filePath) => invoke('read_file_content', { filePath }),
  findHexFile: (folderPath) => invoke('find_hex_file', { folderPath }),
  saveVisiblePages: (visiblePages) => invoke('save_visible_pages', { visiblePages }),
  loadVisiblePages: () => invoke('load_visible_pages'),
  saveApiTestState: (state) => invoke('save_api_test_state', { state }),
  loadApiTestState: () => invoke('load_api_test_state'),
  clearCaches: () => invoke('clear_caches'),
```
（把這些 key 從原本的 `notPorted('...')` 行刪除/取代；其餘未移植方法維持 `notPorted`。）

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/api/index.test.js`
Expected: 全部 PASS（原 5 個 + 新 4 個）。

- [ ] **Step 5: 確認既有套件無回歸**

Run: `npx vitest run`
Expected: 無新增 failure（與基準 676 一致；元件測試用 setupTests 的 mock，不受影響）。

- [ ] **Step 6: Commit**

```bash
git add src/api/index.js src/api/index.test.js
git commit -m "feat(api): wire config/store/fsops/dialog methods to tauri"
```

---

## Task 7: 端到端手動驗證

**Files:** 無

- [ ] **Step 1: 啟動**

Run: `npm run tauri:dev`
Expected: App 啟動、主視窗渲染。

- [ ] **Step 2: 設定頁讀寫**

操作：開設定視窗 → ENV 分頁 → 切換某個「Visible Pages」勾選項。
Expected: 主視窗的導覽分頁即時增減（`save_visible_pages` 寫入 + `config-updated` 廣播 + 主視窗 `onConfigUpdated` 收到）。重啟 App 後設定保留。

- [ ] **Step 3: 檔案選擇器**

操作：ENV 分頁點「Platform Tools」資料夾選擇。
Expected: 跳出原生資料夾選擇對話框；選擇後路徑顯示並存入 config（`saveConfig` 成功）。

- [ ] **Step 4: 確認未移植領域仍乾淨降級**

操作：切到憑證頁（會呼叫 flashPathData/scanCertificates —— 屬階段 1b）。
Expected: 頁面不崩潰（這些方法仍 reject NotPortedError，呼叫端 `.catch` 處理）；表格空但 UI 正常。

- [ ] **Step 5: 記錄結果**（無 commit，除非修問題）

---

## 階段 1a 完成定義

- [ ] 設定頁可讀寫 config、visiblePages 切換即時反映到主視窗並持久化
- [ ] 原生檔案/資料夾選擇器可用，選取結果存入 config
- [ ] userData / filter / selection / apiTestState 可往返讀寫
- [ ] `read_file_content` 阻擋 `..` 穿越；`find_hex_file`/`read_directory` 行為對齊
- [ ] `cargo test` 綠；前端 vitest 無回歸
- [ ] 未移植領域（flashPathData/憑證掃描）仍以 NotPortedError 優雅降級

---

## Self-Review 紀錄

- **Spec 覆蓋**：對應 spec §1 `config.rs`/`fsops.rs` 職責、§2 回傳形狀逐字保留與 camelCase→snake_case、§3 `save_config` 的 `config-updated` 廣播、§4 兩種回傳模式（`{success,error}` 用 `CommandResult`；`read_file_content` 用 `Result`/throw）。flashPathData/cert/credential 明確劃到階段 1b，非本計畫遺漏。
- **Placeholder 掃描**：無 TBD/TODO；每個程式步驟有完整程式碼與預期輸出。
- **型別一致性**：`CommandResult` 定義於 config.rs 並由 store.rs 以 `ok_pub`/`err_pub` 共用；command 名稱（snake_case）與前端 `invoke('...')` 字串逐一對應；參數鍵 camelCase（`folderPath`/`filePath`/`userData`/`filterModel`/`selectionModel`/`visiblePages`/`config`/`state`）與 Rust snake_case 參數對應；`load_user_data` 空檔回 `[]`、其餘 load 回 `null`，與「回傳形狀」表一致。
- **快取決策**：刻意不移植 TTL 快取，`clear_caches` 為 no-op；已於 Architecture 與完成定義載明，無行為依賴快取。
