# Tauri 遷移 — 階段 3a：Postman collection 管理（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Rust 移植 Postman collection 的「掃描 / 載入 / 儲存 / 路徑」四個後端 command，並把前端 `src/api` 對應方法從 `NotPortedError` 換成真實 invoke，讓 API Test 頁能列出、重掃、編輯儲存 Postman collection。請求執行（executePostmanRequest）+ SigV4/AssumeRole/憑證解析屬階段 3b，不在此。

**Architecture:** 延續方案 A。後端新增 `commands/postman.rs`。**使用者確認只用原生 Postman collection（info.schema v2.0/v2.1）**，故本階段**不移植** Electron 的 `convertOpenApiToPostmanLike`（OpenAPI 3.x / Swagger 2.0 轉換器，~276 行手寫、含既有 bug）；掃描時遇到非 Postman 的 JSON（含 OpenAPI/Swagger）一律略過（OpenAPI 轉換延到日後需要時再做）。延續「不移植快取」決策：**不寫 `postman_collections_cache.json`**；`load_cached_postman_collections` 改為重掃 `config.postmanCollectionPath`（與 scan 共用同一掃描函式），維持前端「收到 `postman-collections-updated` → 重新載入」的刷新迴圈。

**Tech Stack:** Rust（serde_json、tauri 2）、既有前端 + vitest。

參照設計文件：`docs/superpowers/specs/2026-05-28-tauri-migration-design.md`（§2 api 契約、§3 跨視窗事件廣播）。階段 0 已有 `events.rs` 的 `POSTMAN_COLLECTIONS_UPDATED` 常數與前端 `onPostmanCollectionsUpdated`/`removePostmanCollectionsUpdatedListener`（已接真實 listen）。`load_config_raw`（config.rs，pub(crate)）已可重用。

**逐字保留的契約（不可改）：**
- `get_postman_collection_path` → `config.postmanCollectionPath` 的值（字串），無則 `null`。
- `scan_postman_collections(folderPath)` → collection 物件**陣列**；folderPath 空 → `[]`；讀目錄失敗 → `[]`；不 throw。掃描後 emit `postman-collections-updated`。
- `load_cached_postman_collections()` → collection 物件**陣列**（重掃 `config.postmanCollectionPath`；未設或失敗 → `[]`）。
- `save_postman_collection(filePath, collectionData)` → `{success:true}`；`collectionData.info` 缺 → `{success:false, error:"Invalid collection data: missing info section."}`；寫檔失敗 → `{success:false, error}`。成功後 emit `postman-collections-updated`。
- **Postman collection 物件形狀**：`{ fileName, filePath, name, type:"postman", item }`，其中 `name = info.name || 檔名去.json`、`item = jsonData.item || []`。
- **Postman 偵測**：`jsonData.info.schema` 為字串且包含 `/v2.1.0/collection.json` 或 `/v2.0.0/collection.json`。
- `postman-collections-updated` 事件 payload 無（前端 handler 忽略參數）。

---

## File Structure

**新增（Rust）**
- `src-tauri/src/commands/postman.rs` — `get_postman_collection_path`、`scan_postman_collections`、`load_cached_postman_collections`、`save_postman_collection` + 掃描 helper

**修改（Rust）**
- `src-tauri/src/commands/mod.rs` — 加 `postman` 模組
- `src-tauri/src/lib.rs` — 註冊 4 個 command

**修改（前端）**
- `src/api/index.js` — 4 個方法改真實 invoke（`executePostmanRequest` 維持 notPorted）
- `src/api/index.test.js` — 更新（這 4 個不再 NotPorted）

---

## Task 1: `postman.rs`（四個 command + 掃描 helper + 測試）

**Files:** Create `src-tauri/src/commands/postman.rs`; Modify `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 建立 `src-tauri/src/commands/postman.rs`**

```rust
use crate::commands::config::load_config_raw;
use crate::events::POSTMAN_COLLECTIONS_UPDATED;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
pub struct SaveResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 是否為 Postman collection（info.schema 含 v2.0/v2.1 collection.json）。
fn is_postman_collection(data: &Value) -> bool {
    data.get("info")
        .and_then(|i| i.get("schema"))
        .and_then(|s| s.as_str())
        .map(|s| s.contains("/v2.1.0/collection.json") || s.contains("/v2.0.0/collection.json"))
        .unwrap_or(false)
}

/// 把一份 Postman collection JSON 轉成前端用的物件形狀。
fn postman_collection_entry(data: &Value, file_name: &str, file_path: &str) -> Value {
    let name = data
        .get("info")
        .and_then(|i| i.get("name"))
        .and_then(|n| n.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| file_name.trim_end_matches(".json").to_string());
    json!({
        "fileName": file_name,
        "filePath": file_path,
        "name": name,
        "type": "postman",
        "item": data.get("item").cloned().unwrap_or_else(|| json!([])),
    })
}

/// 掃描目錄中所有 .json，回傳 Postman collection 陣列。非 Postman（含 OpenAPI/Swagger）略過。
/// 錯誤吞掉、繼續；讀目錄失敗回空陣列。
fn scan_dir_for_collections(folder_path: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(folder_path) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if !ft.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.to_lowercase().ends_with(".json") {
            continue;
        }
        let path = entry.path();
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let data: Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => continue, // 解析失敗略過（對齊 Electron per-file catch）
        };
        if is_postman_collection(&data) {
            out.push(postman_collection_entry(&data, &name, &path.to_string_lossy()));
        }
        // 非 Postman（OpenAPI/Swagger/其他）略過：本階段不支援轉換。
    }
    out
}

fn configured_path(app: &AppHandle) -> Option<String> {
    load_config_raw(app)
        .get("postmanCollectionPath")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

#[tauri::command]
pub fn get_postman_collection_path(app: AppHandle) -> Value {
    match load_config_raw(&app).get("postmanCollectionPath") {
        Some(v) => v.clone(),
        None => Value::Null,
    }
}

#[tauri::command]
pub fn scan_postman_collections(app: AppHandle, folder_path: Option<String>) -> Vec<Value> {
    let folder = match folder_path {
        Some(f) if !f.is_empty() => f,
        _ => return Vec::new(),
    };
    let collections = scan_dir_for_collections(&folder);
    let _ = app.emit(POSTMAN_COLLECTIONS_UPDATED, ());
    collections
}

#[tauri::command]
pub fn load_cached_postman_collections(app: AppHandle) -> Vec<Value> {
    // 不用快取檔：重掃設定的目錄（維持前端刷新迴圈）。
    match configured_path(&app) {
        Some(p) => scan_dir_for_collections(&p),
        None => Vec::new(),
    }
}

#[tauri::command]
pub fn save_postman_collection(app: AppHandle, file_path: String, collection_data: Value) -> SaveResult {
    if collection_data.get("info").is_none() {
        return SaveResult {
            success: false,
            error: Some("Invalid collection data: missing info section.".into()),
        };
    }
    let pretty = match serde_json::to_string_pretty(&collection_data) {
        Ok(s) => s,
        Err(e) => return SaveResult { success: false, error: Some(e.to_string()) },
    };
    if let Err(e) = std::fs::write(Path::new(&file_path), pretty) {
        return SaveResult { success: false, error: Some(e.to_string()) };
    }
    // 通知前端刷新（前端會 re-load → 重掃）
    let _ = app.emit(POSTMAN_COLLECTIONS_UPDATED, ());
    SaveResult { success: true, error: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_postman_collection() {
        let v21 = json!({ "info": { "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" } });
        let v20 = json!({ "info": { "schema": "https://schema.getpostman.com/json/collection/v2.0.0/collection.json" } });
        let openapi = json!({ "openapi": "3.0.1", "info": { "title": "x" } });
        let plain = json!({ "foo": 1 });
        assert!(is_postman_collection(&v21));
        assert!(is_postman_collection(&v20));
        assert!(!is_postman_collection(&openapi));
        assert!(!is_postman_collection(&plain));
    }

    #[test]
    fn entry_shape_and_name_fallback() {
        let with_name = json!({ "info": { "name": "My API" }, "item": [{"name":"r1"}] });
        let e = postman_collection_entry(&with_name, "file.json", "/p/file.json");
        assert_eq!(e["fileName"], "file.json");
        assert_eq!(e["filePath"], "/p/file.json");
        assert_eq!(e["name"], "My API");
        assert_eq!(e["type"], "postman");
        assert_eq!(e["item"][0]["name"], "r1");

        let no_name = json!({ "info": { "schema": "x" } });
        let e2 = postman_collection_entry(&no_name, "coll.json", "/p/coll.json");
        assert_eq!(e2["name"], "coll"); // 檔名去 .json
        assert_eq!(e2["item"], json!([])); // 無 item → []
    }

    #[test]
    fn scan_returns_only_postman_collections() {
        let dir = std::env::temp_dir().join(format!("pmscan_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("good.json"),
            r#"{"info":{"name":"Good","schema":"x/v2.1.0/collection.json"},"item":[{"name":"r"}]}"#,
        ).unwrap();
        std::fs::write(dir.join("openapi.json"), r#"{"openapi":"3.0.0","info":{"title":"o"}}"#).unwrap();
        std::fs::write(dir.join("notjson.txt"), "x").unwrap();
        std::fs::write(dir.join("bad.json"), "{ not json").unwrap();

        let out = scan_dir_for_collections(dir.to_str().unwrap());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["name"], "Good");
        assert_eq!(out[0]["type"], "postman");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_missing_dir_is_empty() {
        assert!(scan_dir_for_collections("/no/such/pm/dir/xyz").is_empty());
    }

    #[test]
    fn save_rejects_missing_info() {
        // 純驗證分支（不寫檔）
        let data = json!({ "item": [] });
        assert!(data.get("info").is_none());
    }
}
```

- [ ] **Step 2: `commands/mod.rs` 加模組**（字母序：…, fsops, postman, process, store, …）

```rust
pub mod postman;
```

- [ ] **Step 3: 註冊（lib.rs `generate_handler!`，於 process 之後）**

```rust
            commands::postman::get_postman_collection_path,
            commands::postman::scan_postman_collections,
            commands::postman::load_cached_postman_collections,
            commands::postman::save_postman_collection,
```

- [ ] **Step 4: 跑測試**

Run: `cd src-tauri && cargo test postman`（新 shell 先 `export PATH="$USERPROFILE/.cargo/bin:$PATH"`）
Expected: 5 個測試 PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/postman.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): postman collection commands (scan/load/save/path, postman-format only)"
```

---

## Task 2: 前端 api 接線（含 vitest）

**Files:** Modify `src/api/index.js`, `src/api/index.test.js`

- [ ] **Step 1: 更新測試 `src/api/index.test.js`**（在最後一個測試後、`});` 前新增）

```javascript
  it('getPostmanCollectionPath 轉呼 invoke get_postman_collection_path', async () => {
    invokeMock.mockResolvedValue('/p');
    await expect(api.getPostmanCollectionPath()).resolves.toBe('/p');
    expect(invokeMock).toHaveBeenCalledWith('get_postman_collection_path');
  });

  it('scanPostmanCollections 帶 folderPath', async () => {
    invokeMock.mockResolvedValue([{ name: 'c' }]);
    await expect(api.scanPostmanCollections('/p')).resolves.toEqual([{ name: 'c' }]);
    expect(invokeMock).toHaveBeenCalledWith('scan_postman_collections', { folderPath: '/p' });
  });

  it('loadCachedPostmanCollections 轉呼 invoke', async () => {
    invokeMock.mockResolvedValue([]);
    await expect(api.loadCachedPostmanCollections()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith('load_cached_postman_collections');
  });

  it('savePostmanCollection 帶 filePath/collectionData', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.savePostmanCollection('/p/c.json', { info: { name: 'c' } });
    expect(invokeMock).toHaveBeenCalledWith('save_postman_collection', { filePath: '/p/c.json', collectionData: { info: { name: 'c' } } });
  });
```

- [ ] **Step 2: 跑測試確認失敗** — Run: `npx vitest run src/api/index.test.js`；Expected: 新增 4 個 FAIL。

- [ ] **Step 3: 實作 `src/api/index.js`**

把這 4 行（原 `notPorted`）改為真實 invoke（`executePostmanRequest` **維持** notPorted）：
```javascript
  getPostmanCollectionPath: () => invoke('get_postman_collection_path'),
  scanPostmanCollections: (folderPath) => invoke('scan_postman_collections', { folderPath }),
  loadCachedPostmanCollections: () => invoke('load_cached_postman_collections'),
  savePostmanCollection: (filePath, collectionData) => invoke('save_postman_collection', { filePath, collectionData }),
```

- [ ] **Step 4: 跑測試確認通過** — Run: `npx vitest run src/api/index.test.js`；Expected: 全 PASS。

- [ ] **Step 5: 全套件無回歸** — Run: `npx vitest run`；Expected: 無新增 failure（基準 689）。

- [ ] **Step 6: Commit**

```bash
git add src/api/index.js src/api/index.test.js
git commit -m "feat(api): wire postman collection methods to tauri"
```

---

## Task 3: 端到端驗證 + 收尾

**Files:** 無

- [ ] **Step 1: 後端全測試** — Run: `cd src-tauri && cargo test`；Expected: 既有 27 + 本階段 5 全綠。
- [ ] **Step 2: 前端全測試** — Run: `npx vitest run`；Expected: 無新增 failure（基準 689）。
- [ ] **Step 3: 啟動煙霧** — Run: `npm run tauri:dev`；Expected: App 啟動、無 runtime/capability 錯誤。（驗畢關閉 dev 程序樹。）
- [ ] **Step 4: 手動 GUI 驗收**
  - 設定頁設定 Postman collection 資料夾 → API Test 頁列出該資料夾的 Postman collection（名稱/檔名正確）。
  - 在設定頁編輯某 collection 並儲存 → `save_postman_collection` 成功、`postman-collections-updated` 觸發、清單刷新、重啟後保留。
  - 資料夾含 OpenAPI/Swagger 檔 → 不出現在清單（本階段刻意略過，不崩潰）。
  - 切到「送出請求」相關操作（executePostmanRequest）→ 仍 NotPortedError 優雅降級（屬階段 3b）。
- [ ] **Step 5: 記錄結果**（無 commit，除非修問題）

---

## 階段 3a 完成定義

- [ ] API Test 頁能列出設定資料夾內的 Postman collection（掃描 + 載入）
- [ ] 編輯儲存 collection 可寫檔並刷新清單（emit → reload）
- [ ] 非 Postman JSON（含 OpenAPI/Swagger）被略過、不崩潰
- [ ] `cargo test` 綠；前端 vitest 無回歸
- [ ] executePostmanRequest 等請求執行仍以 NotPortedError 優雅降級（階段 3b）

---

## Self-Review 紀錄

- **Spec 覆蓋**：對應 spec §1 postman.rs 的「collection 掃描/儲存」職責（執行請求劃到 3b）、§2 回傳形狀（陣列／`{success,error}`／字串或 null）與 camelCase→snake_case（`folderPath`/`filePath`/`collectionData`）、§3 `postman-collections-updated` 廣播。
- **範圍決策（已與使用者確認）**：只支援原生 Postman collection；OpenAPI/Swagger 轉換器（`convertOpenApiToPostmanLike`）**不移植**，掃描時略過非 Postman JSON。日後若需要再開小任務移植轉換器（需樣本檔）。已於 Architecture 與完成定義載明。
- **快取決策**：延續不移植快取——不寫 `postman_collections_cache.json`；`load_cached_postman_collections` 重掃 `config.postmanCollectionPath`，與 `scan_postman_collections` 共用 `scan_dir_for_collections`，確保 emit→reload 迴圈回傳最新資料。比 Electron 更一致（Electron 的 save 後重掃是 Postman-only 且漏 `type`，本版統一帶 `type:"postman"`）。
- **Placeholder 掃描**：無 TBD/TODO；每步有完整程式碼與預期輸出。
- **型別一致性**：`SaveResult{success,error}` 對應儲存兩種回傳；command 名稱（snake_case）與前端 `invoke('...')` 字串逐一對應；`load_config_raw`（pub(crate)）重用讀 `postmanCollectionPath`；事件常數 `POSTMAN_COLLECTIONS_UPDATED` 與前端 subscribe 字串一致。
