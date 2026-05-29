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
