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
    // Postman: info is truthy AND (item OR _postman_id OR schema matching v2.[01]).
    // TS: obj.info && (obj.item || obj.info._postman_id || /v2\.[01]/.test(...)) — all
    // JS-truthy, not mere presence. js_truthy([]) is true (empty array is truthy), so
    // item:[] still detects; item:null and _postman_id:"" correctly do NOT.
    if o.get("info").map(js_truthy).unwrap_or(false) {
        let has_item = o.get("item").map(js_truthy).unwrap_or(false);
        let has_postman_id = o["info"].get("_postman_id").map(js_truthy).unwrap_or(false);
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
        // absolute raw: emulate new URL(raw).pathname (excludes the query)
        let after_scheme = &raw[p + 3..];
        match after_scheme.find('/') {
            Some(i) => after_scheme[i..].split('?').next().unwrap_or("").to_string(),
            None => String::new(),
        }
    } else {
        // relative raw: new URL(raw) throws → TS catch returns url.raw verbatim (keep query)
        raw.to_string()
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

                let fallback = format!("{} {}", method, path);
                let name = it.get("name").and_then(|n| n.as_str())
                    .unwrap_or(&fallback)
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
/// TS: `try { return decodeURIComponent(s); } catch { return s; }` — the percent BYTES are
/// decoded as UTF-8 as a whole; on ANY malformed escape OR invalid UTF-8 it throws and the
/// catch returns the ORIGINAL full string.
fn pct_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 < bytes.len() {
                if let (Some(h), Some(l)) = (hex_digit(bytes[i + 1]), hex_digit(bytes[i + 2])) {
                    out.push(h * 16 + l);
                    i += 3;
                    continue;
                }
            }
            // malformed % escape → decodeURIComponent throws → TS catch returns original
            return s.to_string();
        }
        out.push(bytes[i]);
        i += 1;
    }
    match String::from_utf8(out) {
        Ok(decoded) => decoded,
        Err(_) => s.to_string(), // invalid UTF-8 → throw → original
    }
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
                    // crate::datafile::js_string reproduces JS String() for every type,
                    // incl. arrays ("1,2") and objects ("[object Object]"); the != null
                    // guard keeps null → "" (not "null").
                    let value = match p.get("example") {
                        Some(ex) if !ex.is_null() => crate::datafile::js_string(ex),
                        _ => String::new(),
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
                        // TS: const ex = (...).example; if (ex) ... — JS-truthy, so
                        // 0/false/"" fall through to schemaStub (not emitted literally).
                        if let Some(ex) = jc.get("example").filter(|e| js_truthy(e)) {
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
            let auth = if op.get("security").map(js_truthy).unwrap_or(false) {
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

/// Produce a deterministic, URL-safe id slug from a string.
/// Mirrors the spec: lowercase, non-alphanumeric → '-', collapse repeats, trim;
/// empty → "req" (for requests) or "coll" (for collections — callers supply fallback).
/// ASCII-only: any non-ASCII char becomes '-', so an all-non-ASCII name yields an empty
/// slug here and the caller's `dedup_slug` fallback supplies the id.
pub fn make_slug(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut prev_dash = true; // trim leading dashes
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    // Trim trailing dash
    out.trim_end_matches('-').to_string()
}

/// Deduplicate a slug against a set of already-used ids.
/// Returns the slug itself if unused, else slug-2, slug-3, ...
fn dedup_slug(base: &str, used: &mut std::collections::HashSet<String>, fallback: &str) -> String {
    let base = if base.is_empty() { fallback.to_string() } else { base.to_string() };
    if used.insert(base.clone()) { return base; }
    let mut n = 2u32;
    loop {
        let candidate = format!("{}-{}", base, n);
        if used.insert(candidate.clone()) { return candidate; }
        n += 1;
    }
}

fn build_request_url(path: &str) -> String {
    // Step 1: strip inline ?query (the structured query is emitted in req.query separately)
    let raw = path.split('?').next().unwrap_or(path);

    // Step 2: absolute URL (case-insensitive http:// or https://)
    let lower = raw.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return raw.to_string();
    }

    // Step 3: already templated (contains {{)
    if raw.contains("{{") {
        return raw.to_string();
    }

    // Step 4: relative path → prepend {{baseUrl}} with guaranteed leading /
    let path_part = if raw.starts_with('/') {
        raw.to_string()
    } else {
        format!("/{}", raw)
    };
    format!("{{{{baseUrl}}}}{}", path_part)
}

/// Map an ImportParsed into a qa.json config Value.
/// `base_url_override`: --base-url CLI flag; takes precedence over parsed base_url.
/// The returned Value MUST pass load_config (unique ids, valid refs).
pub fn to_config(parsed: &ImportParsed, base_url_override: Option<&str>) -> serde_json::Value {
    use serde_json::{json, Value};
    use std::collections::HashSet;

    let base_url = base_url_override
        .map(|s| s.to_string())
        .or_else(|| parsed.collection.base_url.clone())
        .unwrap_or_default();

    let is_openapi = matches!(parsed.collection.source, Format::OpenApi);

    let mut req_id_used: HashSet<String> = HashSet::new();
    let mut coll_id_used: HashSet<String> = HashSet::new();

    // Build requests list, collecting per-folder request-id lists simultaneously.
    struct FolderOut { id: String, request_ids: Vec<String> }
    let mut all_requests: Vec<Value> = Vec::new();
    let mut folder_outs: Vec<FolderOut> = Vec::new();

    for folder in &parsed.folders {
        let coll_slug = make_slug(&folder.name);
        let coll_id = dedup_slug(&coll_slug, &mut coll_id_used, "coll");
        let mut request_ids: Vec<String> = Vec::new();

        for req in &folder.requests {
            let req_slug = make_slug(&format!("{} {}", req.method, req.path));
            let req_id = dedup_slug(&req_slug, &mut req_id_used, "req");
            request_ids.push(req_id.clone());

            let url = build_request_url(&req.path);

            // Query: only on:true entries (on:false → OpenAPI optional/header params → dropped)
            let query: Vec<Value> = req.params.iter()
                .filter(|p| p.on)
                .map(|p| json!({ "key": p.key, "value": p.value }))
                .collect();

            // Headers: only on:true entries
            let headers: Vec<Value> = req.headers.iter()
                .filter(|h| h.on)
                .map(|h| json!({ "key": h.key, "value": h.value }))
                .collect();

            // Body: mode depends on source format
            let body: Option<Value> = req.body.as_ref().map(|content| {
                let mode = if is_openapi { "json" } else { "raw" };
                json!({ "mode": mode, "content": content })
            });

            let mut req_obj = json!({
                "id": req_id,
                "method": req.method.to_uppercase(),
                "url": url,
                "headers": headers,
                "query": query,
            });
            if let Some(b) = body {
                req_obj["body"] = b;
            }
            all_requests.push(req_obj);
        }

        folder_outs.push(FolderOut { id: coll_id, request_ids });
    }

    // Collections: one per folder
    let collections: Vec<Value> = folder_outs.iter()
        .map(|fo| json!({
            "id": fo.id,
            "requests": fo.request_ids,
            "variables": {},
        }))
        .collect();

    json!({
        "version": 1,
        "globals": { "variables": { "baseUrl": base_url } },
        "identities": [{ "id": "anon", "auth": { "type": "none" } }],
        "requests": all_requests,
        "collections": collections,
    })
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

    #[test]
    fn detect_postman_item_null_not_postman() {
        // TS: obj.item is JS-truthy; null is falsy → not Postman (and no openapi keys → None)
        let v = json!({ "info": {}, "item": Value::Null });
        assert_eq!(qa_detect_format(&v), None);
    }

    #[test]
    fn detect_postman_empty_postman_id_not_postman() {
        // TS: obj.info._postman_id is JS-truthy; "" is falsy → not Postman
        let v = json!({ "info": { "_postman_id": "" } });
        assert_eq!(qa_detect_format(&v), None);
    }

    #[test]
    fn detect_postman_empty_item_array_is_postman() {
        // empty array is JS-truthy → item:[] still detects as Postman
        let v = json!({ "info": {}, "item": json!([]) });
        assert_eq!(qa_detect_format(&v), Some(Format::Postman));
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

    #[test]
    fn pm_url_object_relative_raw_only_keeps_query() {
        // relative raw, no path[]/query[]: TS new URL(raw) throws → catch returns raw verbatim
        // (query preserved). The structured-query append is skipped (no query[]).
        let v = json!({ "raw": "orders/recent?status=open" });
        assert_eq!(pm_url_to_path(&v), "orders/recent?status=open");
    }

    // ── pct_decode (mirror decodeURIComponent) ────────────────────────────

    #[test]
    fn pct_decode_utf8_two_byte() {
        assert_eq!(pct_decode("%C3%A9"), "é");
    }

    #[test]
    fn pct_decode_utf8_three_byte() {
        assert_eq!(pct_decode("%E2%9C%93"), "✓");
    }

    #[test]
    fn pct_decode_space() {
        assert_eq!(pct_decode("a%20b"), "a b");
    }

    #[test]
    fn pct_decode_malformed_returns_original() {
        assert_eq!(pct_decode("%ZZ"), "%ZZ");
    }

    #[test]
    fn pct_decode_truncated_returns_original() {
        assert_eq!(pct_decode("%2"), "%2");
    }

    #[test]
    fn pct_decode_plain_passthru() {
        assert_eq!(pct_decode("plain"), "plain");
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

    // ── to_config ─────────────────────────────────────────────────────────────

    fn make_postman_parsed() -> ImportParsed {
        ImportParsed {
            collection: ImportCollection {
                name: "Test API".to_string(),
                source: Format::Postman,
                base_url: None,
            },
            folders: vec![
                ImportFolder {
                    name: "Users".to_string(),
                    requests: vec![
                        ImportRequest {
                            method: "GET".to_string(),
                            name: "List Users".to_string(),
                            path: "/api/users?page=1".to_string(),  // inline query to be stripped
                            params: vec![KvOn { key: "page".to_string(), value: "1".to_string(), on: true }],
                            headers: vec![],
                            body: None,
                            auth: "none".to_string(),
                        },
                    ],
                },
            ],
        }
    }

    fn make_openapi_parsed() -> ImportParsed {
        ImportParsed {
            collection: ImportCollection {
                name: "Pet API".to_string(),
                source: Format::OpenApi,
                base_url: Some("https://api.pets.io".to_string()),
            },
            folders: vec![
                ImportFolder {
                    name: "pets".to_string(),
                    requests: vec![
                        ImportRequest {
                            method: "POST".to_string(),
                            name: "Create pet".to_string(),
                            path: "/pets".to_string(),
                            params: vec![],
                            headers: vec![KvOn { key: "X-Trace".to_string(), value: String::new(), on: false }],
                            body: Some(r#"{"name":"Buddy"}"#.to_string()),
                            auth: "bearer".to_string(),
                        },
                    ],
                },
            ],
        }
    }

    // -- URL rule tests --

    #[test]
    fn url_rule_strips_inline_query() {
        // path "/api/users?page=1" → url must be "{{baseUrl}}/api/users" (query stripped)
        let parsed = make_postman_parsed();
        let cfg = to_config(&parsed, None);
        let url = cfg["requests"][0]["url"].as_str().unwrap();
        assert_eq!(url, "{{baseUrl}}/api/users", "inline ?query must be stripped from url");
        // query param must survive in the query array
        let q = &cfg["requests"][0]["query"];
        assert!(q.as_array().unwrap().iter().any(|e| e["key"] == "page"), "query param must be in query[]");
    }

    #[test]
    fn url_rule_absolute_kept_as_is() {
        let parsed = ImportParsed {
            collection: ImportCollection { name: "T".into(), source: Format::Postman, base_url: None },
            folders: vec![ImportFolder { name: "f".into(), requests: vec![
                ImportRequest { method: "GET".into(), name: "r".into(),
                    path: "HTTPS://api.example.com/v1/u".to_string(),
                    params: vec![], headers: vec![], body: None, auth: "none".into() }
            ]}],
        };
        let cfg = to_config(&parsed, None);
        assert_eq!(cfg["requests"][0]["url"], "HTTPS://api.example.com/v1/u",
            "absolute URL (case-insensitive) must be kept as-is");
    }

    #[test]
    fn url_rule_templated_kept_as_is() {
        let parsed = ImportParsed {
            collection: ImportCollection { name: "T".into(), source: Format::Postman, base_url: None },
            folders: vec![ImportFolder { name: "f".into(), requests: vec![
                ImportRequest { method: "GET".into(), name: "r".into(),
                    path: "{{baseUrl}}/users".to_string(),
                    params: vec![], headers: vec![], body: None, auth: "none".into() }
            ]}],
        };
        let cfg = to_config(&parsed, None);
        assert_eq!(cfg["requests"][0]["url"], "{{baseUrl}}/users",
            "already-templated path must be kept as-is");
    }

    #[test]
    fn url_rule_bare_path_gets_leading_slash_and_base_url() {
        let parsed = ImportParsed {
            collection: ImportCollection { name: "T".into(), source: Format::Postman, base_url: None },
            folders: vec![ImportFolder { name: "f".into(), requests: vec![
                ImportRequest { method: "GET".into(), name: "r".into(),
                    path: "api/users".to_string(),   // no leading slash
                    params: vec![], headers: vec![], body: None, auth: "none".into() }
            ]}],
        };
        let cfg = to_config(&parsed, None);
        assert_eq!(cfg["requests"][0]["url"], "{{baseUrl}}/api/users",
            "bare path must get leading / and {{baseUrl}} prefix");
    }

    // -- Slug / dedupe --

    #[test]
    fn slug_deduplication() {
        // Two requests with the same method+path → slug-2 for the second
        let parsed = ImportParsed {
            collection: ImportCollection { name: "T".into(), source: Format::Postman, base_url: None },
            folders: vec![ImportFolder { name: "f".into(), requests: vec![
                ImportRequest { method: "GET".into(), name: "a".into(), path: "/users/id".into(), params: vec![], headers: vec![], body: None, auth: "none".into() },
                ImportRequest { method: "GET".into(), name: "b".into(), path: "/users/id".into(), params: vec![], headers: vec![], body: None, auth: "none".into() },
            ]}],
        };
        let cfg = to_config(&parsed, None);
        let ids: Vec<&str> = cfg["requests"].as_array().unwrap().iter().map(|r| r["id"].as_str().unwrap()).collect();
        assert_eq!(ids[0], "get-users-id");
        assert_eq!(ids[1], "get-users-id-2", "second collision must become -2");
    }

    // -- baseUrl precedence --

    #[test]
    fn base_url_override_wins_over_parsed() {
        let parsed = make_openapi_parsed(); // has base_url = Some("https://api.pets.io")
        let cfg = to_config(&parsed, Some("https://override.example.com"));
        assert_eq!(cfg["globals"]["variables"]["baseUrl"], "https://override.example.com",
            "--base-url override must win over parsed servers[0]");
    }

    #[test]
    fn base_url_falls_back_to_parsed() {
        let parsed = make_openapi_parsed(); // has base_url = Some("https://api.pets.io")
        let cfg = to_config(&parsed, None);
        assert_eq!(cfg["globals"]["variables"]["baseUrl"], "https://api.pets.io",
            "parsed servers[0] used when no --base-url override");
    }

    #[test]
    fn base_url_empty_when_neither() {
        let parsed = make_postman_parsed(); // base_url = None, no override
        let cfg = to_config(&parsed, None);
        assert_eq!(cfg["globals"]["variables"]["baseUrl"], "",
            "baseUrl must be empty string when no source and no override");
    }

    // -- Body mode --

    #[test]
    fn body_mode_openapi_is_json() {
        let parsed = make_openapi_parsed();
        let cfg = to_config(&parsed, None);
        assert_eq!(cfg["requests"][0]["body"]["mode"], "json",
            "OpenAPI requestBody must use mode:json");
    }

    #[test]
    fn body_mode_postman_is_raw() {
        let parsed = ImportParsed {
            collection: ImportCollection { name: "T".into(), source: Format::Postman, base_url: None },
            folders: vec![ImportFolder { name: "f".into(), requests: vec![
                ImportRequest { method: "POST".into(), name: "r".into(), path: "/u".into(),
                    params: vec![], headers: vec![], body: Some("{\"x\":1}".into()), auth: "none".into() }
            ]}],
        };
        let cfg = to_config(&parsed, None);
        assert_eq!(cfg["requests"][0]["body"]["mode"], "raw",
            "Postman raw body must use mode:raw");
    }

    // -- on:false dropped --

    #[test]
    fn on_false_params_and_headers_dropped() {
        let parsed = make_openapi_parsed(); // has header on:false
        let cfg = to_config(&parsed, None);
        let hdrs = cfg["requests"][0]["headers"].as_array().unwrap();
        assert!(hdrs.is_empty(), "on:false header must be dropped");
    }

    // -- Placeholder identity --

    #[test]
    fn placeholder_identity() {
        let parsed = make_postman_parsed();
        let cfg = to_config(&parsed, None);
        let ids = cfg["identities"].as_array().unwrap();
        assert_eq!(ids.len(), 1);
        assert_eq!(ids[0]["id"], "anon");
        assert_eq!(ids[0]["auth"]["type"], "none");
    }

    // -- load_config round-trip --

    #[test]
    fn to_config_passes_load_config() {
        use crate::config::load_config;
        let parsed = make_openapi_parsed();
        let cfg_val = to_config(&parsed, Some("https://api.pets.io"));
        let json_str = serde_json::to_string(&cfg_val).unwrap();
        let result = load_config(&json_str, &|_| None);
        assert!(result.is_ok(), "to_config output must pass load_config: {:?}", result.err());
    }

    // -- build_request-level Blocker guard --

    #[test]
    fn build_request_no_dup_query_from_inline_url() {
        // Postman request with inline-query url + structured query → build_request
        // must produce the query param EXACTLY ONCE (the Blocker: pm_url_to_path keeps
        // the query in path; to_config strips it; structured query is emitted in req.query).
        use crate::config::load_config;
        use crate::buildreq::build_request;
        use crate::engine::NoDynamics;
        use std::collections::BTreeMap;

        // Simulate what to_config emits for a Postman request with inline-query url.
        // path="/api/pets?limit=10" → url="{{baseUrl}}/api/pets" (stripped), query=[{key:"limit",value:"10"}]
        let cfg_json = r#"{
            "version": 1,
            "globals": { "variables": { "baseUrl": "https://api.pets.io" } },
            "identities": [{ "id": "anon", "auth": { "type": "none" } }],
            "requests": [{
                "id": "list-pets",
                "method": "GET",
                "url": "{{baseUrl}}/api/pets",
                "query": [{ "key": "limit", "value": "10" }]
            }]
        }"#;

        let cfg = load_config(cfg_json, &|_| None).expect("config loads");
        let req = cfg.requests.iter().find(|r| r.id == "list-pets").unwrap();
        let identity = cfg.identities.iter().find(|i| i.id == "anon").unwrap();

        // Build var map with baseUrl resolved
        let mut map = BTreeMap::new();
        map.insert("baseUrl".to_string(), "https://api.pets.io".to_string());

        let out = build_request(req, identity, &map, &mut NoDynamics).expect("build succeeds");
        let url = out["request"]["url"].as_str().unwrap();

        // Count occurrences of "limit=" in the built URL
        let count = url.matches("limit=").count();
        assert_eq!(count, 1, "query param 'limit' must appear exactly once in built URL, got: {url}");
        assert!(url.contains("limit=10"), "query value must be present: {url}");
    }
}
