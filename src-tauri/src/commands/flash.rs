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

/// 讀主檔；parse 失敗或讀取錯誤 → 試 .bak；皆失敗 → {}（ENOENT 直接回 {}）。
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

fn read_bak_value(p: &FlashPaths) -> Option<Value> {
    let s = std::fs::read_to_string(&p.bak).ok()?;
    serde_json::from_str::<Value>(&s).ok().filter(|v| v.is_object())
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
    match std::fs::read_to_string(&p.tmp)
        .map_err(|e| e.to_string())
        .and_then(|s| serde_json::from_str::<Value>(&s).map_err(|e| e.to_string()))
    {
        Ok(_) => {}
        Err(e) => { let _ = std::fs::remove_file(&p.tmp); return Err(e); }
    }
    if let Err(e) = std::fs::rename(&p.tmp, &p.main) {
        let _ = std::fs::remove_file(&p.tmp);
        return Err(e.to_string());
    }
    Ok(())
}

fn read_main_with_retry(main: &PathBuf) -> std::io::Result<String> {
    use std::io::ErrorKind;
    let mut last: Option<std::io::Error> = None;
    for i in 0..3 {
        match std::fs::read_to_string(main) {
            Ok(s) => return Ok(s),
            Err(e) => {
                let retriable = matches!(e.kind(), ErrorKind::PermissionDenied)
                    || matches!(e.raw_os_error(), Some(32) | Some(33)); // Windows 共享/鎖定衝突
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

/// 讀取 flashPathData 並回傳指定 pathType 的結構化資料。永不 throw；失敗回預設結構。
#[tauri::command]
pub fn get_flash_path_data(app: AppHandle, state: State<AppState>, path_type: Option<String>) -> Value {
    let path_type = path_type.unwrap_or_else(|| "nordic".to_string());
    let _guard = state.flash_lock.lock();
    let p = match flash_paths(&app) {
        Ok(p) => p,
        Err(_) => return default_flash(),
    };

    let mut parsed: Value = match read_main_with_retry(&p.main) {
        Ok(s) => match serde_json::from_str::<Value>(&s) {
            Ok(v) if v.is_object() => v,
            _ => match read_bak_value(&p) {
                Some(bak) => {
                    let _ = atomic_write(&p, &bak); // best-effort 修復主檔（不致命）
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

    // 確保 certificate_folder_path（且為字串）
    let cert = obj.get("certificate_folder_path").cloned().unwrap_or_else(|| Value::String(String::new()));
    obj.insert(
        "certificate_folder_path".into(),
        if cert.is_string() { cert } else { Value::String(String::new()) },
    );

    // 確保 pathType 結構
    if !obj.get(&path_type).map(|v| v.is_object()).unwrap_or(false) {
        obj.insert(path_type.clone(), json!({ "current_used_paths": {}, "saved_paths": [] }));
    }

    let type_obj = obj.get(&path_type).unwrap();
    let mut result = Map::new();
    result.insert("certificate_folder_path".into(), obj.get("certificate_folder_path").cloned().unwrap());
    result.insert(
        "current_used_paths".into(),
        type_obj.get("current_used_paths").cloned().unwrap_or_else(|| json!({})),
    );
    result.insert(
        "saved_paths".into(),
        type_obj.get("saved_paths").cloned().unwrap_or_else(|| json!([])),
    );
    Value::Object(result)
}

// 與 update 的 apply 段相同邏輯（僅供單元測試驗證合併/取代，不含 IO）
#[cfg(test)]
fn apply_for_test(existing: &mut Value, new_data: &Value) {
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

    #[test]
    fn structure_result_from_parsed() {
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
}
