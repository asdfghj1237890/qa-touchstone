use crate::json_store::{read_value, write_pretty};
use crate::paths::data_file;
use serde::Serialize;
use serde_json::{json, Value};
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
    pub fn ok_pub() -> Self { Self { success: true, error: None } }
    pub fn err_pub(e: String) -> Self { Self { success: false, error: Some(e) } }
    fn ok() -> Self { Self::ok_pub() }
    fn err(e: String) -> Self { Self::err_pub(e) }
}

pub(crate) fn load_config_raw(app: &AppHandle) -> Value {
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

    #[test]
    fn api_configs_migrates_singular_when_array_empty() {
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
}
