//! Port of the buildPayload subset (src/qa/executor.ts:84-150): turn a config
//! request + identity + var map into the inner `{ "request": {...} }` Value that
//! `executor::execute_request` consumes. SP0b: absolute URLs only; auth = none/bearer/apiKey/basic.
use crate::config::{Auth, ApiKeyIn, BodyMode, Identity, Request};
use crate::engine::{qa_substitute, Dynamics};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use std::collections::BTreeMap;

// encodeURIComponent leaves A-Za-z0-9 and -_.!~*'() unescaped.
const ENCODE_URI_COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-').remove(b'_').remove(b'.').remove(b'!').remove(b'~')
    .remove(b'*').remove(b'\'').remove(b'(').remove(b')');
pub fn enc(s: &str) -> String { utf8_percent_encode(s, ENCODE_URI_COMPONENT).to_string() }

/// The `Authorization: Basic ...` header VALUE for the given credentials.
/// Shared between `apply_auth` (which sets the header) and the CLI redaction
/// set builder (which must redact the same byte sequence from output).
pub fn basic_auth_value(username: &str, password: &str) -> String {
    use base64::Engine as _;
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}")))
}

/// Build the inner `{ request }` Value. Returns Err(String) on a non-absolute resolved URL.
/// `dynamics` resolves `{{$timestamp}}`, `{{$guid}}`, etc. — pass `&mut RealDynamics` in
/// production (CLI send) and `&mut PinnedDynamics` / `&mut NoDynamics` in tests.
pub fn build_request(req: &Request, identity: &Identity, map: &BTreeMap<String, String>, dynamics: &mut dyn Dynamics) -> Result<Value, String> {
    let mut headers: Vec<Value> = Vec::new();
    for h in &req.headers {
        headers.push(json!({ "key": qa_substitute(&h.key, map, dynamics), "value": qa_substitute(&h.value, map, dynamics) }));
    }
    let mut query: Vec<String> = req.query.iter()
        .map(|p| format!("{}={}", enc(&qa_substitute(&p.key, map, dynamics)), enc(&qa_substitute(&p.value, map, dynamics)))).collect();

    // body (none/json/raw); Content-Type for json if absent
    let mut body_raw: Option<String> = None;
    let mut content_type: Option<String> = None;
    if let Some(b) = &req.body {
        match b.mode {
            BodyMode::Json => { body_raw = Some(qa_substitute(&b.content, map, dynamics)); content_type = Some("application/json".into()); }
            BodyMode::Raw => { body_raw = Some(qa_substitute(&b.content, map, dynamics)); }
            BodyMode::None => {}
        }
    }

    // auth (Task 3 fills none/bearer/apiKey/basic) — apiKey-in-query may push to `query`
    // Secrets (token/value/password/username) are opaque literals from config load; NOT re-substituted.
    apply_auth(identity, &mut headers, &mut query)?;

    if let Some(ct) = content_type {
        if !headers.iter().any(|h| h["key"].as_str().map(|k| k.eq_ignore_ascii_case("content-type")).unwrap_or(false)) {
            headers.push(json!({ "key": "Content-Type", "value": ct }));
        }
    }

    let resolved = qa_substitute(&req.url, map, dynamics);
    if !(resolved.starts_with("http://") || resolved.starts_with("https://")) {
        return Err(format!("request `{}` resolved to a non-absolute URL `{}` (SP0b requires absolute URLs)", req.id, resolved));
    }
    let url = if query.is_empty() { resolved }
        else { format!("{}{}{}", resolved, if resolved.contains('?') { '&' } else { '?' }, query.join("&")) };

    let mut request = json!({ "method": req.method, "url": url, "header": headers });
    if let Some(b) = body_raw { request["body"] = json!({ "mode": "raw", "raw": b }); }
    Ok(json!({ "request": request }))
}

/// Apply identity auth — port of executor.ts:97-104.
/// Secrets (token/value/password/username) are opaque literals from config load; NOT re-substituted.
/// Basic: Authorization: Basic <base64(utf8("user:pass"))>.
// Authorization: Basic base64(utf8(user:pass)). Matches TS btoa(unescape(encodeURIComponent(...))) for ALL Unicode — both base64 the UTF-8 bytes.
fn apply_auth(id: &Identity, headers: &mut Vec<Value>, query: &mut Vec<String>) -> Result<(), String> {
    match &id.auth {
        Auth::None => {}
        Auth::Bearer { token } => {
            headers.push(json!({ "key": "Authorization", "value": format!("Bearer {token}") }));
        }
        Auth::Basic { username, password } => {
            headers.push(json!({ "key": "Authorization", "value": basic_auth_value(username, password) }));
        }
        Auth::ApiKey { key, value, location } => match location {
            // TS: apiKey header uses value as-is (opaque), key is literal. (executor.ts:101-103)
            ApiKeyIn::Header => headers.push(json!({ "key": key, "value": value })),
            ApiKeyIn::Query => query.push(format!("{}={}", enc(key), enc(value))),
        },
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Request, Identity, Auth};
    use crate::engine::NoDynamics;
    use std::collections::BTreeMap;

    fn req(url: &str) -> Request {
        serde_json::from_str(&format!(r#"{{"id":"r","method":"GET","url":"{url}"}}"#)).unwrap()
    }
    fn anon() -> Identity { Identity { id: "anon".into(), auth: Auth::None, privileged: false } }

    #[test]
    fn substitutes_and_requires_absolute_url() {
        let mut map = BTreeMap::new();
        map.insert("apiHost".to_string(), "https://x.example".to_string());
        let out = build_request(&req("{{apiHost}}/v1/u"), &anon(), &map, &mut NoDynamics).unwrap();
        assert_eq!(out["request"]["url"], serde_json::json!("https://x.example/v1/u"));
        assert_eq!(out["request"]["method"], serde_json::json!("GET"));
    }

    #[test]
    fn non_absolute_url_is_error() {
        let out = build_request(&req("/v1/u"), &anon(), &BTreeMap::new(), &mut NoDynamics);
        assert!(out.is_err(), "relative URL must be rejected in SP0b");
    }

    #[test]
    fn encodes_query_like_encodeuricomponent() {
        let mut r = req("https://x.example/s");
        r.query = vec![crate::config::Kv { key: "q".into(), value: "a b&c".into() }];
        let out = build_request(&r, &anon(), &BTreeMap::new(), &mut NoDynamics).unwrap();
        // encodeURIComponent("a b&c") = "a%20b%26c"
        assert_eq!(out["request"]["url"], serde_json::json!("https://x.example/s?q=a%20b%26c"));
    }
}
