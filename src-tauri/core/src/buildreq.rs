//! Port of the buildPayload subset (src/qa/executor.ts:84-150): turn a config
//! request + identity + var map into the inner `{ "request": {...} }` Value that
//! `executor::execute_request` consumes. SP0b: absolute URLs only; auth = none/bearer/apiKey/basic.
use crate::config::{BodyMode, Identity, Request};
use crate::engine::{qa_substitute, NoDynamics};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use std::collections::BTreeMap;

// encodeURIComponent leaves A-Za-z0-9 and -_.!~*'() unescaped.
const ENCODE_URI_COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-').remove(b'_').remove(b'.').remove(b'!').remove(b'~')
    .remove(b'*').remove(b'\'').remove(b'(').remove(b')');
fn enc(s: &str) -> String { utf8_percent_encode(s, ENCODE_URI_COMPONENT).to_string() }

fn sub(text: &str, map: &BTreeMap<String, String>) -> String {
    // request fields use {{var}} + dynamics in production; fixtures pass no dynamics
    qa_substitute(text, map, &mut NoDynamics)
}

/// Build the inner `{ request }` Value. Returns Err(String) on a non-absolute resolved URL.
pub fn build_request(req: &Request, identity: &Identity, map: &BTreeMap<String, String>) -> Result<Value, String> {
    let mut headers: Vec<Value> = Vec::new();
    for h in &req.headers {
        headers.push(json!({ "key": sub(&h.key, map), "value": sub(&h.value, map) }));
    }
    let mut query: Vec<String> = req.query.iter()
        .map(|p| format!("{}={}", enc(&sub(&p.key, map)), enc(&sub(&p.value, map)))).collect();

    // body (none/json/raw); Content-Type for json if absent
    let mut body_raw: Option<String> = None;
    let mut content_type: Option<String> = None;
    if let Some(b) = &req.body {
        match b.mode {
            BodyMode::Json => { body_raw = Some(sub(&b.content, map)); content_type = Some("application/json".into()); }
            BodyMode::Raw => { body_raw = Some(sub(&b.content, map)); }
            BodyMode::None => {}
        }
    }

    // auth (Task 3 fills none/bearer/apiKey/basic) — apiKey-in-query may push to `query`
    apply_auth(identity, map, &mut headers, &mut query)?;

    if let Some(ct) = content_type {
        if !headers.iter().any(|h| h["key"].as_str().map(|k| k.eq_ignore_ascii_case("content-type")).unwrap_or(false)) {
            headers.push(json!({ "key": "Content-Type", "value": ct }));
        }
    }

    let resolved = sub(&req.url, map);
    if !(resolved.starts_with("http://") || resolved.starts_with("https://")) {
        return Err(format!("request `{}` resolved to a non-absolute URL `{}` (SP0b requires absolute URLs)", req.id, resolved));
    }
    let url = if query.is_empty() { resolved }
        else { format!("{}{}{}", resolved, if resolved.contains('?') { '&' } else { '?' }, query.join("&")) };

    let mut request = json!({ "method": req.method, "url": url, "header": headers });
    if let Some(b) = body_raw { request["body"] = json!({ "mode": "raw", "raw": b }); }
    Ok(json!({ "request": request }))
}

// Task 3 replaces this stub with the real auth construction.
fn apply_auth(_id: &Identity, _map: &BTreeMap<String, String>, _headers: &mut Vec<Value>, _query: &mut Vec<String>) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Request, Identity, Auth};
    use std::collections::BTreeMap;

    fn req(url: &str) -> Request {
        serde_json::from_str(&format!(r#"{{"id":"r","method":"GET","url":"{url}"}}"#)).unwrap()
    }
    fn anon() -> Identity { Identity { id: "anon".into(), auth: Auth::None } }

    #[test]
    fn substitutes_and_requires_absolute_url() {
        let mut map = BTreeMap::new();
        map.insert("apiHost".to_string(), "https://x.example".to_string());
        let out = build_request(&req("{{apiHost}}/v1/u"), &anon(), &map).unwrap();
        assert_eq!(out["request"]["url"], serde_json::json!("https://x.example/v1/u"));
        assert_eq!(out["request"]["method"], serde_json::json!("GET"));
    }

    #[test]
    fn non_absolute_url_is_error() {
        let out = build_request(&req("/v1/u"), &anon(), &BTreeMap::new());
        assert!(out.is_err(), "relative URL must be rejected in SP0b");
    }

    #[test]
    fn encodes_query_like_encodeuricomponent() {
        let mut r = req("https://x.example/s");
        r.query = vec![crate::config::Kv { key: "q".into(), value: "a b&c".into() }];
        let out = build_request(&r, &anon(), &BTreeMap::new()).unwrap();
        // encodeURIComponent("a b&c") = "a%20b%26c"
        assert_eq!(out["request"]["url"], serde_json::json!("https://x.example/s?q=a%20b%26c"));
    }
}
