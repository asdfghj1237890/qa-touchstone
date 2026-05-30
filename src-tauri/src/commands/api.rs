use crate::aws::{self, Credentials};
use crate::commands::config::load_config_raw;
use crate::credentials::parse_credential_file_content;
use crate::reqprep::{rebase_url, remove_json_comments, substitute_body, substitute_url};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use tauri::AppHandle;

fn err(msg: impl Into<String>) -> Value {
    json!({ "success": false, "error": msg.into() })
}

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
        let c = sel.get("credentials")?;
        let ak = c.get("accessKeyId").and_then(|x| x.as_str()).unwrap_or("");
        let sk = c.get("secretAccessKey").and_then(|x| x.as_str()).unwrap_or("");
        if !ak.is_empty() && !sk.is_empty() {
            return Some(Credentials { access_key_id: ak.into(), secret_access_key: sk.into(), session_token: None });
        }
        return None;
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

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn string_array_field(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn rebase_url_for_environment(raw_url: &str, env: &Value) -> String {
    let base_url = str_field(env, "baseUrl").unwrap_or("");
    if base_url.is_empty() {
        return raw_url.to_string();
    }

    let base_path = str_field(env, "basePath").unwrap_or("");
    let known_base_path_values = string_array_field(env, "knownBasePaths");
    let known_base_paths: Vec<&str> = known_base_path_values.iter().map(String::as_str).collect();

    rebase_url(raw_url, base_url, base_path, &known_base_paths)
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
) -> Value {
    let req = match request_details.get("request") {
        Some(r) if r.is_object() => r.clone(),
        _ => return err("Invalid request details provided."),
    };
    let method = str_field(&req, "method").unwrap_or("GET").to_uppercase();

    let mut raw_url = match req.get("url") {
        Some(Value::String(s)) => s.clone(),
        Some(u) if u.is_object() => str_field(u, "raw").unwrap_or("").to_string(),
        _ => return err("Invalid URL format in request."),
    };
    if raw_url.is_empty() {
        return err("Invalid URL format in request.");
    }

    let env = selected_environment.as_ref().filter(|e| !e.is_null());

    if let Some(env) = env {
        raw_url = rebase_url_for_environment(&raw_url, env);
    }

    let params_map: Map<String, Value> = params.as_object().cloned().unwrap_or_default();
    let substituted_url = substitute_url(&raw_url, &params_map);

    let parsed = match reqwest::Url::parse(&substituted_url) {
        Ok(u) => u,
        Err(e) => return err(format!("Invalid URL: {e}")),
    };
    let host = parsed.host_str().unwrap_or("").to_string();
    let path = parsed.path().to_string();
    let query = parsed.query().unwrap_or("").to_string();

    let mut content_type = "application/json".to_string();
    let mut post_data: Option<String> = None;
    if matches!(method.as_str(), "POST" | "PUT" | "PATCH") {
        if let Some(body) = req.get("body") {
            if str_field(body, "mode") == Some("raw") {
                if let Some(raw) = str_field(body, "raw") {
                    let cleaned = remove_json_comments(raw);
                    post_data = Some(substitute_body(&cleaned, &params_map));
                }
            }
        }
    }

    let mut custom_headers: BTreeMap<String, String> = BTreeMap::new();
    if let Some(hs) = req.get("header").and_then(|h| h.as_array()) {
        for h in hs {
            if h.get("disabled").and_then(|d| d.as_bool()) == Some(true) {
                continue;
            }
            let k = substitute_url(str_field(h, "key").unwrap_or(""), &params_map);
            let v = substitute_url(str_field(h, "value").unwrap_or(""), &params_map);
            if k.eq_ignore_ascii_case("content-type") {
                content_type = v.clone();
            } else if !k.is_empty() {
                custom_headers.insert(k, v);
            }
        }
    }

    let mut service = if is_file_transfer_collection == Some(true) { "iotwireless" } else { "execute-api" }.to_string();
    let mut region = "us-east-1".to_string();
    if let Some(auth) = req.get("auth") {
        if str_field(auth, "type") == Some("awsv4") {
            if let Some(arr) = auth.get("awsv4").and_then(|a| a.as_array()) {
                for kv in arr {
                    match (str_field(kv, "key"), str_field(kv, "value")) {
                        (Some("region"), Some(val)) => region = val.to_string(),
                        (Some("service"), Some(val)) => service = val.to_string(),
                        _ => {}
                    }
                }
            }
        }
    }

    let credentials = api_config_id
        .as_deref()
        .and_then(|id| resolve_credentials(&load_config_raw(&app), id, selected_profile.as_deref()));

    let mut out_headers: BTreeMap<String, String> = BTreeMap::new();
    out_headers.insert("Accept".to_string(), "*/*".to_string());
    out_headers.insert("Content-Type".to_string(), content_type.clone());
    for (k, v) in &custom_headers {
        out_headers.insert(k.clone(), v.clone());
    }

    if let Some(creds) = credentials {
        let mut final_creds = creds.clone();
        if let Some(env) = env {
            if let Some(role_arn) = str_field(env, "roleArn") {
                if !role_arn.is_empty() && creds.session_token.is_none() {
                    match aws::assume_role(&creds, role_arn, "QACompanion").await {
                        Ok(c) => final_creds = c,
                        Err(e) => return err(format!("Failed to assume role {role_arn}: {e}")),
                    }
                }
            }
        }

        let payload = post_data.clone().unwrap_or_default();
        let content_sha = aws::sha256_hex(payload.as_bytes());

        let mut sign_headers: BTreeMap<String, String> = BTreeMap::new();
        if post_data.is_some() {
            sign_headers.insert("content-type".to_string(), content_type.clone());
        }
        sign_headers.insert("x-amz-content-sha256".to_string(), content_sha.clone());
        for (k, v) in &custom_headers {
            sign_headers.insert(k.to_lowercase(), v.clone());
        }

        let input = aws::SignInput {
            method: &method,
            host: &host,
            path: &path,
            query: &query,
            headers: sign_headers,
            payload: payload.as_bytes(),
            service: &service,
            region: &region,
        };
        let signed = aws::sign(&input, &final_creds);

        for (k, v) in signed {
            out_headers.insert(k, v);
        }
        out_headers.insert("x-amz-content-sha256".to_string(), content_sha);
    }

    let method_enum = match reqwest::Method::from_bytes(method.as_bytes()) {
        Ok(m) => m,
        Err(e) => return err(format!("Invalid method: {e}")),
    };
    // KNOWN LIMITATION: reqwest follows redirects by default and we only
    // read headers from the final response, so Set-Cookie headers on 30x
    // hops never reach the JS cookie jar. Disabling auto-redirect would
    // break the common "Send" → final response UX (Postman-equivalent).
    // The proper fix is to manually follow redirects in this command and
    // surface each hop's Set-Cookie; tracked for a follow-up round.
    //
    // Honour the UI's SSL toggle. Default behaviour stays "verify" — only
    // disable verification when the renderer explicitly says so. Falls back
    // to the no-builder client on construction failure (very unlikely).
    let verify = ssl_verify.unwrap_or(true);
    let client = if verify {
        reqwest::Client::new()
    } else {
        reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    };
    let mut rb = client.request(method_enum, parsed.clone());
    for (k, v) in &out_headers {
        rb = rb.header(k.as_str(), v.as_str());
    }
    if let Some(body) = &post_data {
        rb = rb.body(body.clone());
    }

    let sent_headers: Map<String, Value> =
        out_headers.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();

    match rb.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            // The URL reqwest ultimately landed on (after auto-following any
            // redirects). The renderer uses this — not the originally
            // requested URL — to scope Set-Cookie capture, so a 302 → final
            // host's cookie ends up under the right host/path.
            let final_url = resp.url().to_string();
            let mut resp_headers = Map::new();
            // Collect Set-Cookie separately — multiple Set-Cookie headers in
            // a single response must NOT be collapsed (different name/path
            // can share a name). Join with `\n` (illegal in header values
            // per RFC 7230) and the renderer splits them back apart.
            let mut set_cookie_lines: Vec<String> = Vec::new();
            for (k, v) in resp.headers().iter() {
                let val = v.to_str().unwrap_or("").to_string();
                if k.as_str().eq_ignore_ascii_case("set-cookie") {
                    set_cookie_lines.push(val);
                } else {
                    resp_headers.insert(k.as_str().to_string(), Value::String(val));
                }
            }
            if !set_cookie_lines.is_empty() {
                resp_headers.insert("set-cookie".to_string(), Value::String(set_cookie_lines.join("\n")));
            }
            let body_text = resp.text().await.unwrap_or_default();
            json!({
                "success": true,
                "status": status,
                "finalUrl": final_url,
                "headers": resp_headers,
                "body": body_text,
                "requestMetadata": {
                    "sentHeaders": sent_headers,
                    // 對齊 Electron：metadata 回報 collection 預設 service（非 awsv4 覆寫後的）。
                    "awsService": if is_file_transfer_collection == Some(true) { "iotwireless" } else { "execute-api" },
                    "isFileTransferCollection": is_file_transfer_collection.unwrap_or(false)
                }
            })
        }
        Err(e) => err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn rebase_selected_environment_supports_empty_base_path() {
        let env = json!({
            "baseUrl": "https://new.example.com",
            "basePath": "",
            "knownBasePaths": []
        });

        let rebased = rebase_url_for_environment(
            "https://old.example.com/v1/devices?id=1",
            &env,
        );

        assert_eq!(rebased, "https://new.example.com/v1/devices?id=1");
    }

    #[test]
    fn rebase_selected_environment_uses_environment_known_base_paths() {
        let env = json!({
            "baseUrl": "https://new.example.com",
            "basePath": "/prod",
            "knownBasePaths": ["/old-base"]
        });

        let rebased = rebase_url_for_environment(
            "https://old.example.com/old-base/devices",
            &env,
        );

        assert_eq!(rebased, "https://new.example.com/prod/devices");
    }
}
