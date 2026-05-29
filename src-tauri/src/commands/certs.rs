use crate::commands::config::load_config_raw;
use crate::error::{AppError, AppResult};
use crate::json_store::{read_value, write_pretty};
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
    // 對齊 Electron 的 `config.credentials || null`：空字串也視為 null
    match config.get("credentials") {
        Some(Value::String(s)) if !s.is_empty() => Value::String(s.clone()),
        _ => Value::Null,
    }
}

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

    #[test]
    fn selected_cert_matches_by_exact_id() {
        let user_data = vec![
            json!({"id":"X1","certificateid":"AAAA"}),
            json!({"id":"X2","certificateid":"BBBB"}),
        ];
        let found = user_data.iter().find(|c| c["id"] == json!("X2"));
        assert_eq!(found.unwrap()["certificateid"], "BBBB");
    }

    #[test]
    fn selected_cert_backward_compat_suffix() {
        let user_data = vec![json!({"id":"new_id_1","certificateid":"BAC62994"})];
        let selected_id = "1749330818788_9_BAC62994";
        let parts: Vec<&str> = selected_id.split('_').collect();
        let old = parts[parts.len() - 1];
        let found = user_data.iter().find(|c| c["certificateid"].as_str().unwrap().starts_with(old));
        assert_eq!(found.unwrap()["id"], "new_id_1");
    }
}
