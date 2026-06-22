use crate::aws::{self, Credentials};
use crate::reqprep::{rebase_url, remove_json_comments, substitute_body, substitute_url};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::time::Duration;

/// Optional execution toggles. Defaults mean "safe default": `is_file_transfer_collection`
/// selects the AWS service default; `ssl_verify` verifies unless explicitly `Some(false)`;
/// `ssl_verify_confirmed` must be `Some(true)` to honor a `Some(false)` ssl_verify, else the
/// request is rejected.
#[derive(Debug, Default, Clone)]
pub struct ExecOptions {
    pub is_file_transfer_collection: Option<bool>,
    pub ssl_verify: Option<bool>,
    pub ssl_verify_confirmed: Option<bool>,
}

fn err(msg: impl Into<String>) -> Value {
    json!({ "success": false, "error": msg.into() })
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

fn method_allows_body(method: &str) -> bool {
    !matches!(method, "GET" | "HEAD")
}

/// link-local 雲端 metadata 端點（AWS/GCP/Azure IMDS、ECS task metadata、阿里雲）。
/// 命中這些位址＝可能拿到 instance role。
fn is_cloud_metadata_host(host: &str) -> bool {
    let h = host.trim().trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    matches!(
        h.as_str(),
        "169.254.169.254"            // AWS / GCP / Azure IMDS
            | "169.254.170.2"        // ECS task metadata
            | "100.100.100.200"      // Alibaba Cloud
            | "metadata.google.internal"
            | "metadata.goog"
    ) || h.starts_with("fd00:ec2:")  // AWS IPv6 IMDS
}

/// 帶 AWS 憑證對 metadata endpoint 發「已簽名」請求，會把使用者/instance 的憑證
/// 簽進去並可能外洩 —— 這個特定組合一律擋。打 localhost / 私有 IP（無憑證）仍是
/// API 測試工具的正常功能，不受影響。
fn metadata_request_blocked(host: &str, has_aws_creds: bool) -> bool {
    has_aws_creds && is_cloud_metadata_host(host)
}

/// 解析 TLS 驗證策略：停用憑證驗證＝接受 MITM 風險，必須由前端帶明確的確認旗標
/// （sslVerifyConfirmed）才放行，否則拒絕請求，逼出一個確認對話框。
fn resolve_tls_verification(ssl_verify: Option<bool>, confirmed: Option<bool>) -> Result<bool, String> {
    match ssl_verify {
        Some(false) if confirmed != Some(true) => Err(
            "TLS verification can only be disabled with explicit confirmation (sslVerifyConfirmed).".into(),
        ),
        Some(false) => Ok(false),
        _ => Ok(true),
    }
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

/// Execute one prepared request. Credentials are resolved by the caller
/// (app: keychain/config/files; CLI: env/config) and passed in already-resolved.
/// Returns the same JSON Value the Tauri command always returned:
/// { success, status, finalUrl, headers, setCookies, body, requestMetadata }.
pub async fn execute_request(
    request_details: &Value,
    params: &Value,
    selected_environment: Option<&Value>,
    credentials: Option<Credentials>,
    options: ExecOptions,
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

    let env = selected_environment.filter(|e| !e.is_null());

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
    if method_allows_body(method.as_str()) {
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

    let mut service = if options.is_file_transfer_collection == Some(true) { "iotwireless" } else { "execute-api" }.to_string();
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

    // SSRF guard: never send an AWS-signed request to a cloud metadata endpoint —
    // it would sign the user's/instance's credentials into a request to an address
    // that hands back instance-role credentials. Unsigned localhost/private testing
    // is unaffected.
    if metadata_request_blocked(&host, credentials.is_some()) {
        return err(format!(
            "Refusing to send an AWS-signed request to a cloud metadata endpoint ({host}). Remove the credential profile to target it without signing."
        ));
    }

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
    // Honour the UI's SSL toggle. Default behaviour stays "verify" — only
    // disable verification when the renderer explicitly says so. Auto-redirect
    // is disabled so we can manually follow each 30x hop and collect every
    // Set-Cookie along the way (browsers + Postman do the same).
    // Disabling TLS verification now requires an explicit confirmation flag from
    // the renderer (sslVerifyConfirmed) — a silent ssl_verify=false is rejected so
    // the UI must surface a confirm dialog before accepting MITM exposure.
    let verify = match resolve_tls_verification(options.ssl_verify, options.ssl_verify_confirmed) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    if !verify {
        // 審計線索：停用憑證驗證等於接受 MITM 風險，每次發生都留下紀錄
        // （只記 host，不記完整 URL / query，避免把敏感參數寫進 log）。
        let host = parsed.host_str().unwrap_or("<unknown>");
        log::warn!("TLS verification DISABLED for this request (host: {host}) — confirmed by user");
    }
    let client_builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none());
    let client_builder = if verify { client_builder } else { client_builder.danger_accept_invalid_certs(true) };
    let client = client_builder.build().unwrap_or_else(|_| reqwest::Client::new());

    let sent_headers: Map<String, Value> =
        out_headers.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();

    // Headers we MUST NOT forward across an origin boundary on redirect.
    // Authorization tokens, cookies, SigV4 signature artefacts must never
    // leak to a host other than the one they were minted for. Matches what
    // reqwest's built-in Policy does and what browsers do.
    fn is_sensitive_header(name: &str) -> bool {
        let lower = name.to_ascii_lowercase();
        matches!(lower.as_str(),
            "authorization" | "cookie" | "cookie2" |
            "proxy-authorization" | "www-authenticate"
        ) || lower.starts_with("x-amz-")
    }

    const MAX_HOPS: usize = 10;
    // Each captured cookie is stored alongside the URL of the response that
    // set it, so the renderer can scope domain/path against the right host
    // when a redirect chain crosses hosts.
    let mut all_set_cookies: Vec<(String, String)> = Vec::new();
    let mut current_url = parsed.clone();
    let mut current_method = method_enum.clone();
    let mut current_body = post_data.clone();
    let mut final_resp: Option<reqwest::Response> = None;
    // Same-origin per RFC 6454 = (scheme, host, port) match exactly.
    // Comparing host alone would forward credentials on
    // `https://api.x` → `http://api.x` or `:8080` → `:9090` and lose the
    // safety reqwest's built-in policy provided.
    fn origin_triple(u: &reqwest::Url) -> (String, Option<String>, Option<u16>) {
        (u.scheme().to_ascii_lowercase(),
         u.host_str().map(|h| h.to_ascii_lowercase()),
         u.port_or_known_default())
    }
    let original_origin = origin_triple(&current_url);
    // Sticky: once we cross to another origin, sensitive headers stay
    // stripped for every subsequent hop — even if a later redirect bounces
    // back to the original origin.
    let mut cross_origin = false;

    for hop in 0..=MAX_HOPS {
        let mut rb = client.request(current_method.clone(), current_url.clone());
        for (k, v) in &out_headers {
            if cross_origin && is_sensitive_header(k.as_str()) { continue; }
            rb = rb.header(k.as_str(), v.as_str());
        }
        if let Some(body) = &current_body {
            rb = rb.body(body.clone());
        }
        let resp = match rb.send().await {
            Ok(r) => r,
            Err(e) => return err(e.to_string()),
        };
        // Capture every Set-Cookie at this hop ALONG WITH the URL of the
        // response that emitted it — the renderer needs the per-hop URL to
        // apply RFC 6265 domain/path checks correctly when redirects cross
        // hosts or change paths.
        let hop_url = resp.url().to_string();
        for (k, v) in resp.headers().iter() {
            if k.as_str().eq_ignore_ascii_case("set-cookie") {
                all_set_cookies.push((hop_url.clone(), v.to_str().unwrap_or("").to_string()));
            }
        }
        let status = resp.status().as_u16();
        let is_redirect = matches!(status, 301 | 302 | 303 | 307 | 308);
        if !is_redirect || hop == MAX_HOPS {
            final_resp = Some(resp);
            break;
        }
        // Resolve the Location header against the current URL.
        let loc_str = resp.headers().get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let loc_str = match loc_str {
            Some(s) if !s.is_empty() => s,
            _ => { final_resp = Some(resp); break; }
        };
        let next_url = match current_url.join(&loc_str) {
            Ok(u) => u,
            Err(_) => { final_resp = Some(resp); break; }
        };
        // Method rewriting on redirect — match reqwest's default Policy:
        //   301/302 + POST       → GET, drop body
        //   301/302 + other      → preserve method + body
        //   303 + HEAD           → preserve HEAD (browser convention)
        //   303 + other          → GET, drop body (RFC)
        //   307/308              → always preserve
        if (status == 301 || status == 302) && current_method == reqwest::Method::POST {
            current_method = reqwest::Method::GET;
            current_body = None;
        } else if status == 303 && current_method != reqwest::Method::HEAD {
            current_method = reqwest::Method::GET;
            current_body = None;
        }
        // Sticky cross-origin detection — once the (scheme,host,port) triple
        // differs from the original we strip sensitive headers from every
        // subsequent hop.
        if !cross_origin && origin_triple(&next_url) != original_origin {
            cross_origin = true;
        }
        current_url = next_url;
    }

    let resp = match final_resp { Some(r) => r, None => return err("Redirect loop produced no response".to_string()) };
    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();
    let mut resp_headers = Map::new();
    for (k, v) in resp.headers().iter() {
        // Set-Cookie was already collected per-hop into all_set_cookies; skip
        // the final-hop duplicate here so the renderer sees each Set-Cookie
        // exactly once.
        if k.as_str().eq_ignore_ascii_case("set-cookie") { continue; }
        resp_headers.insert(k.as_str().to_string(), Value::String(v.to_str().unwrap_or("").to_string()));
    }
    // The renderer needs each Set-Cookie alongside the URL of the response
    // that emitted it so RFC 6265 domain/path checks run against the right
    // host (cross-host redirects would otherwise scope cookies wrong).
    let set_cookies_arr: Vec<Value> = all_set_cookies.iter()
        .map(|(u, line)| json!({"url": u, "line": line}))
        .collect();
    if !all_set_cookies.is_empty() {
        // Also surface as headers["set-cookie"] (newline-joined) so existing
        // display code paths show the raw values, but cookie capture goes
        // through `setCookies` above.
        let joined: Vec<String> = all_set_cookies.iter().map(|(_, line)| line.clone()).collect();
        resp_headers.insert("set-cookie".to_string(), Value::String(joined.join("\n")));
    }
    let body_text = resp.text().await.unwrap_or_default();
    json!({
        "success": true,
        "status": status,
        "finalUrl": final_url,
        "headers": resp_headers,
        "setCookies": set_cookies_arr,
        "body": body_text,
        "requestMetadata": {
            "sentHeaders": sent_headers,
            // 對齊 Electron：metadata 回報 collection 預設 service（非 awsv4 覆寫後的）。
            "awsService": if options.is_file_transfer_collection == Some(true) { "iotwireless" } else { "execute-api" },
            "isFileTransferCollection": options.is_file_transfer_collection.unwrap_or(false)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn body_policy_allows_delete_but_not_get_or_head() {
        assert!(method_allows_body("POST"));
        assert!(method_allows_body("PATCH"));
        assert!(method_allows_body("DELETE"));
        assert!(!method_allows_body("GET"));
        assert!(!method_allows_body("HEAD"));
    }

    #[test]
    fn detects_cloud_metadata_hosts() {
        for h in ["169.254.169.254", "169.254.170.2", "100.100.100.200", "metadata.google.internal", "fd00:ec2::254"] {
            assert!(is_cloud_metadata_host(h), "expected {h} to be a metadata host");
        }
        assert!(is_cloud_metadata_host("[fd00:ec2::254]")); // bracketed IPv6
        for h in ["example.com", "127.0.0.1", "localhost", "169.254.1.1", "10.0.0.5"] {
            assert!(!is_cloud_metadata_host(h), "expected {h} NOT to be a metadata host");
        }
    }

    #[test]
    fn metadata_blocked_only_with_aws_creds() {
        assert!(metadata_request_blocked("169.254.169.254", true));     // creds + metadata → block
        assert!(!metadata_request_blocked("169.254.169.254", false));   // no creds → IMDS allowed (no signing exfil)
        assert!(!metadata_request_blocked("127.0.0.1", true));          // localhost testing stays a feature
        assert!(!metadata_request_blocked("api.example.com", true));
    }

    #[test]
    fn tls_disable_requires_explicit_confirmation() {
        assert_eq!(resolve_tls_verification(None, None), Ok(true));            // default: verify
        assert_eq!(resolve_tls_verification(Some(true), None), Ok(true));      // verify on
        assert_eq!(resolve_tls_verification(Some(false), Some(true)), Ok(false)); // confirmed off
        assert!(resolve_tls_verification(Some(false), None).is_err());         // off without confirm → rejected
        assert!(resolve_tls_verification(Some(false), Some(false)).is_err());
    }
}
