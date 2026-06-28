use crate::json_store::{read_value, write_pretty};
use crate::paths::data_file;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const CONFIG_FILE: &str = "config.json";

#[derive(Serialize)]
pub struct CommandResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl CommandResult {
    pub fn ok_pub() -> Self {
        Self {
            success: true,
            error: None,
        }
    }
    pub fn err_pub(e: String) -> Self {
        Self {
            success: false,
            error: Some(e),
        }
    }
    fn ok() -> Self {
        Self::ok_pub()
    }
    fn err(e: String) -> Self {
        Self::err_pub(e)
    }
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

#[tauri::command]
pub fn load_config(app: AppHandle) -> Value {
    let mut config = load_config_raw(&app);
    if !config.is_object() {
        config = json!({});
    }
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
        for (k, v) in incoming {
            cur.insert(k.clone(), v.clone());
        }
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
    save_config(
        app,
        json!({ "credentialsFilePaths": api_configs, "credentialsFilePath": "" }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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
