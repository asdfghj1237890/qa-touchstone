use crate::commands::config::load_config_raw;
use crate::credentials::parse_credential_file_content;
use qa_touchstone_core::aws::Credentials;
use serde_json::Value;
use tauri::AppHandle;

/// 從 config + apiConfigId 解析出 AWS 憑證（manual 或檔案型）。
fn resolve_credentials(
    config: &Value,
    api_config_id: &str,
    selected_profile: Option<&str>,
) -> Option<Credentials> {
    let arr = config.get("credentialsFilePaths").and_then(|a| a.as_array())?;
    let sel = arr
        .iter()
        .find(|c| c.get("id").and_then(|i| i.as_str()) == Some(api_config_id))?;
    let typ = sel.get("type").and_then(|t| t.as_str()).unwrap_or("file");
    if typ == "manual" {
        let c = sel.get("credentials");
        let ak = c.and_then(|c| c.get("accessKeyId")).and_then(|x| x.as_str()).unwrap_or("");
        let inline_sk = c.and_then(|c| c.get("secretAccessKey")).and_then(|x| x.as_str()).unwrap_or("");
        // Secret resolution: a legacy inline secret (plaintext in config.json) still
        // works; otherwise the secret comes from the OS keychain, keyed by profile id.
        let sk: Option<String> = if !inline_sk.is_empty() {
            Some(inline_sk.to_string())
        } else {
            crate::secrets::get_secret(api_config_id).ok().flatten().filter(|s| !s.is_empty())
        };
        return match (ak.is_empty(), sk) {
            (false, Some(sk)) => Some(Credentials { access_key_id: ak.into(), secret_access_key: sk, session_token: None }),
            _ => None,
        };
    }
    let path = sel.get("path").and_then(|p| p.as_str())?;
    let content = std::fs::read_to_string(path).ok()?;
    let parsed = parse_credential_file_content(&content, path, selected_profile);
    if parsed.access_key_id.is_empty() || parsed.secret_access_key.is_empty() {
        return None;
    }
    Some(Credentials {
        access_key_id: parsed.access_key_id,
        secret_access_key: parsed.secret_access_key,
        session_token: if parsed.session_token.is_empty() { None } else { Some(parsed.session_token) },
    })
}

#[tauri::command]
pub async fn execute_postman_request(
    app: AppHandle,
    request_details: Value,
    params: Value,
    api_config_id: Option<String>,
    selected_profile: Option<String>,
    selected_environment: Option<Value>,
    is_file_transfer_collection: Option<bool>,
    ssl_verify: Option<bool>,
    ssl_verify_confirmed: Option<bool>,
) -> Value {
    let credentials = api_config_id
        .as_deref()
        .and_then(|id| resolve_credentials(&load_config_raw(&app), id, selected_profile.as_deref()));
    qa_touchstone_core::executor::execute_request(
        &request_details,
        &params,
        selected_environment.as_ref().filter(|e| !e.is_null()),
        is_file_transfer_collection,
        ssl_verify,
        ssl_verify_confirmed,
        credentials,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolve_manual_credentials() {
        let config = json!({ "credentialsFilePaths": [
            { "id": "m1", "type": "manual", "credentials": { "accessKeyId": "AKIA", "secretAccessKey": "SEC" } }
        ]});
        let c = resolve_credentials(&config, "m1", None).expect("creds");
        assert_eq!(c.access_key_id, "AKIA");
        assert_eq!(c.secret_access_key, "SEC");
        assert!(c.session_token.is_none());
    }

    #[test]
    fn resolve_missing_id_is_none() {
        let config = json!({ "credentialsFilePaths": [] });
        assert!(resolve_credentials(&config, "nope", None).is_none());
    }

    #[test]
    fn resolve_manual_missing_keys_is_none() {
        let config = json!({ "credentialsFilePaths": [ { "id": "m1", "type": "manual", "credentials": {} } ]});
        assert!(resolve_credentials(&config, "m1", None).is_none());
    }
}
