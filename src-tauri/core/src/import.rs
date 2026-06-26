//! Port of src/qa/import-parser.ts: Postman v2.1 + OpenAPI 3 / Swagger 2 (JSON only).
//! Pure parser — no network, no config, no tauri deps.
use serde_json::Value;

/// Source format tag, mirrors TS 'postman' | 'openapi'.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Format { Postman, OpenApi }

/// A single header or query entry, with enabled flag.
#[derive(Debug, Clone, PartialEq)]
pub struct KvOn { pub key: String, pub value: String, pub on: bool }

/// One imported request (detail inlined — no separate id-keyed map).
#[derive(Debug, Clone, PartialEq)]
pub struct ImportRequest {
    pub method: String,
    pub name: String,
    pub path: String,
    pub params: Vec<KvOn>,
    pub headers: Vec<KvOn>,
    pub body: Option<String>,
    pub auth: String,
}

/// A folder (Postman folder or OpenAPI tag group).
#[derive(Debug, Clone, PartialEq)]
pub struct ImportFolder { pub name: String, pub requests: Vec<ImportRequest> }

/// Top-level collection metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportCollection {
    pub name: String,
    pub source: Format,
    pub base_url: Option<String>,
}

/// The parse result: collection + folders (each carrying its requests inline).
#[derive(Debug, Clone, PartialEq)]
pub struct ImportParsed {
    pub collection: ImportCollection,
    pub folders: Vec<ImportFolder>,
}

/// Port of qaDetectFormat. Returns None when the input is not a recognized format.
pub fn qa_detect_format(obj: &Value) -> Option<Format> {
    let o = obj.as_object()?;
    // Postman: has info AND (item OR _postman_id OR schema matching v2.[01])
    if o.contains_key("info") {
        let has_item = o.contains_key("item");
        let has_postman_id = o["info"].get("_postman_id").is_some();
        let schema_matches = o["info"].get("schema")
            .and_then(|s| s.as_str())
            .map(|s| s.contains("v2.0") || s.contains("v2.1"))
            .unwrap_or(false);
        if has_item || has_postman_id || schema_matches {
            return Some(Format::Postman);
        }
    }
    // OpenAPI: openapi field, swagger field, or paths object
    if o.contains_key("openapi") || o.contains_key("swagger")
        || o.get("paths").map(|p| p.is_object()).unwrap_or(false)
    {
        return Some(Format::OpenApi);
    }
    None
}

/// Port of pmUrlToPath. Accepts a &Value that may be a string URL or a
/// Postman URL object {raw?, path?, query?}.
pub fn pm_url_to_path(url: &Value) -> String {
    match url {
        Value::Null => "/".to_string(),
        Value::String(s) => {
            if s.is_empty() { return "/".to_string(); }
            if s.to_lowercase().starts_with("http://") || s.to_lowercase().starts_with("https://") {
                return s.clone();
            }
            // Strip scheme://host prefix if present without http (shouldn't happen, but TS does it)
            // TS: url.replace(/^https?:\/\/[^/]+/, '') || url
            let stripped = strip_scheme_host(s);
            if stripped.is_empty() { s.clone() } else { stripped }
        }
        Value::Object(obj) => {
            // If raw is absolute, return it verbatim (TS: if (url.raw && /^https?:\/\//i.test(url.raw)) return url.raw)
            if let Some(raw) = obj.get("raw").and_then(|r| r.as_str()) {
                if raw.to_lowercase().starts_with("http://") || raw.to_lowercase().starts_with("https://") {
                    return raw.to_string();
                }
            }
            // Build path from path[] array or path string
            let mut path = if let Some(arr) = obj.get("path").and_then(|p| p.as_array()) {
                "/".to_string() + &arr.iter()
                    .filter_map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join("/")
            } else if let Some(s) = obj.get("path").and_then(|p| p.as_str()) {
                s.to_string()
            } else {
                // fallback: try parsing url.raw pathname
                if let Some(raw) = obj.get("raw").and_then(|r| r.as_str()) {
                    // TS: try { path = new URL(url.raw).pathname } catch { path = url.raw }
                    raw_to_pathname(raw)
                } else {
                    String::new()
                }
            };
            // Append structured query (mirrors TS)
            if let Some(query_arr) = obj.get("query").and_then(|q| q.as_array()) {
                let q: Vec<String> = query_arr.iter().filter_map(|q| {
                    let qobj = q.as_object()?;
                    if qobj.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false) { return None; }
                    let key = qobj.get("key")?.as_str()?;
                    if key.is_empty() { return None; }
                    let val = qobj.get("value").and_then(|v| v.as_str()).unwrap_or("");
                    Some(format!("{}={}", key, val))
                }).collect();
                if !q.is_empty() {
                    path = format!("{}?{}", path, q.join("&"));
                }
            }
            if path.is_empty() { "/".to_string() } else { path }
        }
        _ => "/".to_string(),
    }
}

fn strip_scheme_host(s: &str) -> String {
    // Mirror TS: s.replace(/^https?:\/\/[^/]+/, '')
    // Handles http:// or https:// followed by non-slash chars (host+port), then rest.
    let lower = s.to_lowercase();
    let prefix_end = if lower.starts_with("https://") { 8 } else if lower.starts_with("http://") { 7 } else { return s.to_string(); };
    let rest = &s[prefix_end..];
    match rest.find('/') {
        Some(i) => rest[i..].to_string(),
        None => String::new(),
    }
}

// Inline replacement for `new URL(raw).pathname`:
fn raw_to_pathname(raw: &str) -> String {
    // Find "://" then the first "/" after it → that's the path start
    if let Some(p) = raw.find("://") {
        let after_scheme = &raw[p + 3..];
        match after_scheme.find('/') {
            Some(i) => after_scheme[i..].split('?').next().unwrap_or("").to_string(),
            None => String::new(),
        }
    } else {
        raw.split('?').next().unwrap_or(raw).to_string()
    }
}

/// Port of schemaStub. Replicates JS truthiness exactly:
/// - top-level s.example: truthy test (0/false/""/null fall through to type stub)
/// - per-property v.example != null: keeps 0/false/""; only null/absent → typed zero
pub fn schema_stub(s: &Value) -> Value {
    if s.is_null() || !s.is_object() { return Value::Object(Default::default()); }
    let obj = s.as_object().unwrap();

    // Top-level example: JS truthy (not just is_some/not-null)
    if let Some(ex) = obj.get("example") {
        if js_truthy(ex) { return ex.clone(); }
        // 0/false/""/null → fall through to type stub below
    }

    // Type-dispatch for object with properties
    if obj.get("type").and_then(|t| t.as_str()) == Some("object") {
        if let Some(props) = obj.get("properties").and_then(|p| p.as_object()) {
            let mut out = serde_json::Map::new();
            for (k, v) in props.iter().take(12) {
                // Per-property: v.example != null (keeps 0/false/""; only null/absent → zero)
                let val = if let Some(ex) = v.get("example") {
                    if !ex.is_null() { ex.clone() } else {
                        // null → typed zero
                        typed_zero(v)
                    }
                } else {
                    // absent → typed zero
                    typed_zero(v)
                };
                out.insert(k.clone(), val);
            }
            return Value::Object(out);
        }
    }

    Value::Object(Default::default())
}

/// JS truthiness: false for null, false, 0, "", and the number -0 (same as 0 in JSON).
fn js_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        _ => true, // arrays, objects → truthy
    }
}

/// Typed zero for schema property: integer/number → 0, boolean → false, array → [], else → "".
fn typed_zero(v: &Value) -> Value {
    match v.get("type").and_then(|t| t.as_str()) {
        Some("integer") | Some("number") => Value::Number(0.into()),
        Some("boolean") => Value::Bool(false),
        Some("array") => Value::Array(vec![]),
        _ => Value::String(String::new()),
    }
}

const OAS_METHODS: &[&str] = &["get", "post", "put", "patch", "delete", "head", "options"];

/// Port of oasBase: extract base URL from OpenAPI servers[] or Swagger 2 host+basePath.
pub fn oas_base(obj: &Value) -> String {
    // OpenAPI 3: servers[0].url
    if let Some(servers) = obj.get("servers").and_then(|s| s.as_array()) {
        if let Some(first) = servers.first() {
            return first.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string();
        }
    }
    // Swagger 2: schemes[0]://host + basePath
    if let Some(host) = obj.get("host").and_then(|h| h.as_str()) {
        let scheme = obj.get("schemes")
            .and_then(|s| s.as_array())
            .and_then(|a| a.first())
            .and_then(|s| s.as_str())
            .unwrap_or("https");
        let base_path = obj.get("basePath").and_then(|b| b.as_str()).unwrap_or("");
        return format!("{}://{}{}", scheme, host, base_path);
    }
    String::new()
}

/// Port of parsePostman. Walks items recursively, drops synthResponse + qaUid.
pub fn parse_postman(obj: &Value) -> ImportParsed {
    let mut folders: Vec<ImportFolder> = Vec::new();
    let mut root_reqs: Vec<ImportRequest> = Vec::new();

    fn walk(items: &Value, bucket: &mut Vec<ImportRequest>, folders: &mut Vec<ImportFolder>) {
        let arr = match items.as_array() { Some(a) => a, None => return };
        for it in arr {
            // Folder: has nested item array
            if let Some(sub) = it.get("item") {
                let mut fr: Vec<ImportRequest> = Vec::new();
                walk(sub, &mut fr, folders);
                if !fr.is_empty() {
                    let name = it.get("name").and_then(|n| n.as_str()).unwrap_or("Folder").to_string();
                    folders.push(ImportFolder { name, requests: fr });
                }
            } else if let Some(r) = it.get("request") {
                // Leaf request
                let url_spec = if r.is_string() { r } else { r.get("url").unwrap_or(&Value::Null) };
                let method = if r.is_string() { "GET".to_string() }
                    else { r.get("method").and_then(|m| m.as_str()).unwrap_or("GET").to_string() };
                let path = pm_url_to_path(url_spec);

                // Headers: filter disabled
                let headers: Vec<KvOn> = r.get("header")
                    .and_then(|h| h.as_array()).unwrap_or(&vec![])
                    .iter().filter_map(|h| {
                        if h.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false) { return None; }
                        let key = h.get("key")?.as_str()?.to_string();
                        let value = h.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        Some(KvOn { key, value, on: true })
                    }).collect();

                // Query: from string url (parse ?x=y) or from url.query[]
                let params: Vec<KvOn> = if url_spec.is_string() {
                    let s = url_spec.as_str().unwrap_or("");
                    let q_idx = s.find('?');
                    match q_idx {
                        None => vec![],
                        Some(i) => s[i + 1..].split('&').filter(|kv| !kv.is_empty()).map(|kv| {
                            let eq = kv.find('=');
                            let (k, v) = match eq {
                                Some(j) => (pct_decode(&kv[..j]), pct_decode(&kv[j + 1..])),
                                None => (pct_decode(kv), String::new()),
                            };
                            KvOn { key: k, value: v, on: true }
                        }).collect(),
                    }
                } else {
                    url_spec.get("query").and_then(|q| q.as_array()).unwrap_or(&vec![])
                        .iter().filter_map(|q| {
                            if q.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false) { return None; }
                            let key = q.get("key")?.as_str()?;
                            if key.is_empty() { return None; }
                            let value = q.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            Some(KvOn { key: key.to_string(), value, on: true })
                        }).collect()
                };

                // Body: raw only
                let body: Option<String> = r.get("body")
                    .filter(|b| b.get("mode").and_then(|m| m.as_str()) == Some("raw"))
                    .and_then(|b| b.get("raw"))
                    .and_then(|r| r.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());

                let auth = r.get("auth")
                    .and_then(|a| a.get("type"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("none")
                    .to_string();

                let name = it.get("name").and_then(|n| n.as_str())
                    .unwrap_or(&format!("{} {}", method, path))
                    .to_string();

                bucket.push(ImportRequest { method, name, path, params, headers, body, auth });
            }
        }
    }

    if let Some(items) = obj.get("item") {
        walk(items, &mut root_reqs, &mut folders);
    }
    if !root_reqs.is_empty() {
        let coll_name = obj.get("info").and_then(|i| i.get("name")).and_then(|n| n.as_str())
            .unwrap_or("Requests").to_string();
        folders.insert(0, ImportFolder { name: coll_name, requests: root_reqs });
    }

    let name = obj.get("info").and_then(|i| i.get("name")).and_then(|n| n.as_str())
        .unwrap_or("Imported collection").to_string();
    ImportParsed {
        collection: ImportCollection { name, source: Format::Postman, base_url: None },
        folders,
    }
}

/// Percent-decode a query parameter component (mirrors TS decodeURIComponent with fallback).
fn pct_decode(s: &str) -> String {
    // Simple percent-decode: replace %XX sequences; on failure return original.
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_digit(bytes[i + 1]), hex_digit(bytes[i + 2])) {
                out.push(char::from(h * 16 + l));
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}
fn hex_digit(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Port of parseOpenApi. Walks paths × OAS_METHODS, groups by first tag.
pub fn parse_openapi(obj: &Value) -> ImportParsed {
    // Preserve insertion order (JS Object.entries) via Vec<String> + HashMap
    let mut tag_order: Vec<String> = Vec::new();
    let mut tag_map: std::collections::HashMap<String, Vec<ImportRequest>> = Default::default();

    let empty_map = serde_json::Map::new();
    let paths = obj.get("paths").and_then(|p| p.as_object()).unwrap_or(&empty_map);

    for (path, ops) in paths {
        for method_str in OAS_METHODS {
            let op = match ops.get(*method_str) { Some(o) => o, None => continue };
            let method = method_str.to_uppercase();

            // Query params: p.example != null → String(p.example); else ""
            let params: Vec<KvOn> = op.get("parameters").and_then(|p| p.as_array()).unwrap_or(&vec![])
                .iter().filter_map(|p| {
                    if p.get("in").and_then(|i| i.as_str()) != Some("query") { return None; }
                    let key = p.get("name")?.as_str()?.to_string();
                    // TS: value: p.example != null ? String(p.example) : ''
                    let value = if let Some(ex) = p.get("example") {
                        if !ex.is_null() {
                            // JS String() on a number → "20", on a string → the string
                            ex.as_str().map(|s| s.to_string()).unwrap_or_else(|| {
                                // For numbers, booleans etc. use to_string() on the raw JSON
                                // but without quotes (JS String(20) = "20", not '"20"')
                                match ex {
                                    Value::Number(n) => n.to_string(),
                                    Value::Bool(b) => b.to_string(),
                                    _ => ex.to_string(),
                                }
                            })
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    };
                    let on = p.get("required").and_then(|r| r.as_bool()).unwrap_or(false);
                    Some(KvOn { key, value, on })
                }).collect();

            // Header params (on: false per spec decision)
            let headers: Vec<KvOn> = op.get("parameters").and_then(|p| p.as_array()).unwrap_or(&vec![])
                .iter().filter_map(|p| {
                    if p.get("in").and_then(|i| i.as_str()) != Some("header") { return None; }
                    let key = p.get("name")?.as_str()?.to_string();
                    Some(KvOn { key, value: String::new(), on: false })
                }).collect();

            // Body: requestBody.content['application/json'].example or schemaStub
            let body: Option<String> = {
                let rb = op.get("requestBody").and_then(|rb| rb.get("content"));
                if let Some(rb) = rb {
                    let json_content = rb.get("application/json");
                    if let Some(jc) = json_content {
                        if let Some(ex) = jc.get("example").filter(|e| !e.is_null()) {
                            Some(serde_json::to_string_pretty(ex).unwrap_or_default())
                        } else if let Some(schema) = jc.get("schema") {
                            let stub = schema_stub(schema);
                            Some(serde_json::to_string_pretty(&stub).unwrap_or_default())
                        } else { None }
                    } else { None }
                } else { None }
            };

            // TS: auth: op.security ? 'bearer' : 'none'
            // In JS, any non-null/undefined value (including []) is truthy.
            let auth = if op.get("security").map(|s| js_truthy(s)).unwrap_or(false) {
                "bearer".to_string()
            } else {
                "none".to_string()
            };

            let tag = op.get("tags").and_then(|t| t.as_array()).and_then(|a| a.first())
                .and_then(|t| t.as_str()).unwrap_or("default").to_string();

            let fallback = format!("{} {}", method, path);
            let name = op.get("summary").and_then(|s| s.as_str())
                .or_else(|| op.get("operationId").and_then(|o| o.as_str()))
                .unwrap_or(&fallback)
                .to_string();

            let req = ImportRequest { method, name, path: path.clone(), params, headers, body, auth };

            if !tag_map.contains_key(&tag) {
                tag_order.push(tag.clone());
                tag_map.insert(tag.clone(), Vec::new());
            }
            tag_map.get_mut(&tag).unwrap().push(req);
        }
    }

    let folders: Vec<ImportFolder> = tag_order.into_iter()
        .map(|tag| ImportFolder { name: tag.clone(), requests: tag_map.remove(&tag).unwrap_or_default() })
        .collect();

    let title = obj.get("info").and_then(|i| i.get("title")).and_then(|t| t.as_str())
        .unwrap_or("OpenAPI").to_string();
    let base_url = Some(oas_base(obj)).filter(|s| !s.is_empty());

    ImportParsed {
        collection: ImportCollection { name: title, source: Format::OpenApi, base_url },
        folders,
    }
}

/// Port of qaParseImport. Error strings are TS-verbatim.
pub fn qa_parse_import(text: &str) -> Result<ImportParsed, String> {
    let obj: Value = serde_json::from_str(text)
        .map_err(|_| "Not valid JSON. (YAML specs must be converted to JSON first.)".to_string())?;
    match qa_detect_format(&obj) {
        Some(Format::Postman) => Ok(parse_postman(&obj)),
        Some(Format::OpenApi) => Ok(parse_openapi(&obj)),
        None => Err("Unrecognized format \u{2014} expected a Postman v2.1 collection or an OpenAPI/Swagger spec.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── qa_detect_format ───────────────────────────────────────────────────

    #[test]
    fn detect_postman_by_info_plus_item() {
        let v = json!({ "info": { "name": "My API" }, "item": [] });
        assert_eq!(qa_detect_format(&v), Some(Format::Postman));
    }

    #[test]
    fn detect_postman_by_schema_v21() {
        let v = json!({ "info": { "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" } });
        assert_eq!(qa_detect_format(&v), Some(Format::Postman));
    }

    #[test]
    fn detect_openapi_by_openapi_field() {
        let v = json!({ "openapi": "3.0.0", "paths": {} });
        assert_eq!(qa_detect_format(&v), Some(Format::OpenApi));
    }

    #[test]
    fn detect_openapi_by_paths_object() {
        let v = json!({ "paths": { "/u": {} } });
        assert_eq!(qa_detect_format(&v), Some(Format::OpenApi));
    }

    #[test]
    fn detect_none_for_unknown() {
        let v = json!({ "something": "else" });
        assert_eq!(qa_detect_format(&v), None);
    }

    // ── pm_url_to_path ────────────────────────────────────────────────────

    #[test]
    fn pm_url_string_absolute_passthru() {
        let v = json!("https://api.example.com/v1/users?page=1");
        assert_eq!(pm_url_to_path(&v), "https://api.example.com/v1/users?page=1");
    }

    #[test]
    fn pm_url_string_relative_passthru() {
        let v = json!("/v1/users");
        assert_eq!(pm_url_to_path(&v), "/v1/users");
    }

    #[test]
    fn pm_url_object_absolute_raw_passthru() {
        let v = json!({ "raw": "https://api.example.com/users", "path": ["users"], "query": [] });
        assert_eq!(pm_url_to_path(&v), "https://api.example.com/users");
    }

    #[test]
    fn pm_url_object_path_array_with_query() {
        // raw is absent → falls through to path[] + query[] handling
        let v = json!({
            "path": ["users", "42"],
            "query": [{ "key": "include", "value": "orders", "disabled": false }]
        });
        assert_eq!(pm_url_to_path(&v), "/users/42?include=orders");
    }

    #[test]
    fn pm_url_object_disabled_query_excluded() {
        let v = json!({
            "path": ["items"],
            "query": [
                { "key": "active", "value": "true", "disabled": false },
                { "key": "secret", "value": "x",    "disabled": true }
            ]
        });
        assert_eq!(pm_url_to_path(&v), "/items?active=true");
    }

    #[test]
    fn pm_url_null_returns_slash() {
        assert_eq!(pm_url_to_path(&Value::Null), "/");
    }

    // ── schema_stub truthiness ────────────────────────────────────────────

    #[test]
    fn schema_stub_truthy_example_returned() {
        let s = json!({ "example": { "id": 1 } });
        assert_eq!(schema_stub(&s), json!({ "id": 1 }));
    }

    #[test]
    fn schema_stub_top_level_zero_falls_through_to_type_stub() {
        // top-level example:0 is JS falsy → MUST fall through (not return 0)
        let s = json!({ "type": "object", "example": 0, "properties": { "n": { "type": "integer" } } });
        let got = schema_stub(&s);
        // Must return { "n": 0 } from property stubs, NOT 0
        assert_eq!(got, json!({ "n": 0 }), "top-level falsy 0 must NOT be returned as the example");
    }

    #[test]
    fn schema_stub_top_level_empty_string_falls_through() {
        let s = json!({ "type": "object", "example": "", "properties": { "s": { "type": "string" } } });
        assert_eq!(schema_stub(&s), json!({ "s": "" }), "top-level falsy '' must NOT be returned");
    }

    #[test]
    fn schema_stub_top_level_false_falls_through() {
        let s = json!({ "type": "object", "example": false, "properties": { "b": { "type": "boolean" } } });
        assert_eq!(schema_stub(&s), json!({ "b": false }), "top-level falsy false must NOT be returned");
    }

    #[test]
    fn schema_stub_property_zero_emitted() {
        // per-property example:0 is non-null → MUST be emitted (not replaced by typed zero)
        let s = json!({ "type": "object", "properties": { "count": { "type": "integer", "example": 0 } } });
        assert_eq!(schema_stub(&s), json!({ "count": 0 }), "property example:0 (non-null) must be emitted");
    }

    #[test]
    fn schema_stub_property_false_emitted() {
        let s = json!({ "type": "object", "properties": { "active": { "type": "boolean", "example": false } } });
        assert_eq!(schema_stub(&s), json!({ "active": false }), "property example:false (non-null) must be emitted");
    }

    #[test]
    fn schema_stub_property_null_example_falls_to_typed_zero() {
        let s = json!({ "type": "object", "properties": {
            "count": { "type": "integer", "example": null },
            "flag":  { "type": "boolean", "example": null }
        }});
        let got = schema_stub(&s);
        assert_eq!(got["count"], json!(0),     "null example → integer typed zero");
        assert_eq!(got["flag"],  json!(false),  "null example → boolean typed zero");
    }

    #[test]
    fn schema_stub_slices_at_12_properties() {
        let mut props = serde_json::Map::new();
        for i in 0..15 { props.insert(format!("f{i}"), json!({ "type": "string" })); }
        let s = Value::Object({
            let mut m = serde_json::Map::new();
            m.insert("type".into(), json!("object"));
            m.insert("properties".into(), Value::Object(props));
            m
        });
        let got = schema_stub(&s);
        assert_eq!(got.as_object().unwrap().len(), 12, "must slice at first 12 properties");
    }

    // ── qa_parse_import error strings ─────────────────────────────────────

    #[test]
    fn parse_import_rejects_non_json() {
        let err = qa_parse_import("not json at all").unwrap_err();
        assert_eq!(err, "Not valid JSON. (YAML specs must be converted to JSON first.)");
    }

    #[test]
    fn parse_import_rejects_unknown_format() {
        let err = qa_parse_import(r#"{"something":"else"}"#).unwrap_err();
        assert_eq!(err, "Unrecognized format \u{2014} expected a Postman v2.1 collection or an OpenAPI/Swagger spec.");
    }
}
