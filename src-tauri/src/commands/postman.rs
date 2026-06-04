use crate::commands::config::load_config_raw;
use crate::events::POSTMAN_COLLECTIONS_UPDATED;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
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
        .unwrap_or_else(|| file_name.strip_suffix(".json").unwrap_or(file_name).to_string());
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

fn canonical_dir(path: impl AsRef<Path>) -> Option<PathBuf> {
    let p = std::fs::canonicalize(path).ok()?;
    if p.is_dir() { Some(p) } else { None }
}

fn path_is_under(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn configured_collection_root(app: &AppHandle) -> Option<PathBuf> {
    configured_path(app).and_then(canonical_dir)
}

fn allowed_collection_dir(app: &AppHandle, folder_path: &str) -> Option<PathBuf> {
    let root = configured_collection_root(app)?;
    let folder = canonical_dir(folder_path)?;
    if path_is_under(&folder, &root) { Some(folder) } else { None }
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
    let Some(folder) = allowed_collection_dir(&app, &folder) else {
        return Vec::new();
    };
    let collections = scan_dir_for_collections(&folder.to_string_lossy());
    let _ = app.emit(POSTMAN_COLLECTIONS_UPDATED, ());
    collections
}

#[tauri::command]
pub fn load_cached_postman_collections(app: AppHandle) -> Vec<Value> {
    // 不用快取檔：重掃設定的目錄（維持前端刷新迴圈）。
    match configured_collection_root(&app) {
        Some(p) => scan_dir_for_collections(&p.to_string_lossy()),
        None => Vec::new(),
    }
}

#[tauri::command]
pub fn save_postman_collection(app: AppHandle, file_path: String, collection_data: Value) -> SaveResult {
    // Path validation — the renderer can in principle send any absolute path,
    // so refuse the obviously-bad shapes before writing. Aligns with the
    // existing fsops guards (read_directory, find_hex_file, read_file_content)
    // even though those are weaker than full canonicalization.
    if file_path.is_empty() {
        return SaveResult { success: false, error: Some("Empty file path.".into()) };
    }
    if file_path.contains("..") {
        return SaveResult { success: false, error: Some("Path traversal not allowed.".into()) };
    }
    let path = Path::new(&file_path);
    if !path.is_absolute() {
        return SaveResult { success: false, error: Some("Path must be absolute.".into()) };
    }
    // Only accept .json — refuses overwriting binaries, scripts, configs etc.
    if path.extension().and_then(|e| e.to_str()).map(|e| !e.eq_ignore_ascii_case("json")).unwrap_or(true) {
        return SaveResult { success: false, error: Some("Only .json paths are accepted.".into()) };
    }
    let Some(root) = configured_collection_root(&app) else {
        return SaveResult { success: false, error: Some("No configured collection root.".into()) };
    };
    // Refuse if the parent directory does not already exist — prevents
    // mkdir-anywhere accidents.
    let Some(parent) = path.parent() else {
        return SaveResult { success: false, error: Some("Path has no parent directory.".into()) };
    };
    let Some(canon_parent) = canonical_dir(parent) else {
        return SaveResult { success: false, error: Some("Parent directory does not exist.".into()) };
    };
    if !path_is_under(&canon_parent, &root) {
        return SaveResult { success: false, error: Some("Path is outside the configured collection root.".into()) };
    }
    if path.exists() {
        match std::fs::canonicalize(path) {
            Ok(canon_file) if path_is_under(&canon_file, &root) => {}
            Ok(_) => return SaveResult { success: false, error: Some("Refusing to overwrite a file outside the configured collection root.".into()) },
            Err(e) => return SaveResult { success: false, error: Some(e.to_string()) },
        }
    }
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
    if let Err(e) = std::fs::write(path, pretty) {
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
        let data = json!({ "item": [] });
        assert!(data.get("info").is_none());
    }

    #[test]
    fn path_scope_helper_requires_root_prefix() {
        let root = Path::new("/tmp/collections");
        assert!(path_is_under(Path::new("/tmp/collections"), root));
        assert!(path_is_under(Path::new("/tmp/collections/a/b.json"), root));
        assert!(!path_is_under(Path::new("/tmp/collections2/b.json"), root));
    }
}
