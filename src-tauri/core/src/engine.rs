//! Port of src/qa/engine.ts — variable resolver + assertion engine.
//! Behavior must match engine.ts exactly (verified by tests/engine_fixtures.rs).
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::OnceLock;

/// Resolves `{{$dynamic}}` names (timestamp/guid/...). Injected so fixtures pin time/RNG.
pub trait Dynamics {
    fn resolve(&mut self, name: &str) -> Option<String>;
}

/// Dynamics resolver that knows nothing (used where dynamics are irrelevant).
pub struct NoDynamics;
impl Dynamics for NoDynamics {
    fn resolve(&mut self, _name: &str) -> Option<String> {
        None
    }
}

fn var_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\{\{\s*([^}]+?)\s*\}\}").unwrap())
}

#[derive(Debug, Clone, Deserialize)]
pub struct VarRow {
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub on: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ScopedVars {
    #[serde(default)]
    pub globals: Vec<VarRow>,
    #[serde(default)]
    pub collections: BTreeMap<String, Vec<VarRow>>,
    #[serde(default)]
    pub environments: BTreeMap<String, Vec<VarRow>>,
}

/// Port of qaVarMap (engine.ts:35-46). Precedence low→high:
/// global < collection < environment < local. A row counts only when `on` is true.
pub fn qa_var_map(
    vars: &ScopedVars,
    env_label: Option<&str>,
    collection_id: Option<&str>,
    local: Option<&BTreeMap<String, String>>,
) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for v in &vars.globals {
        if v.on && !v.key.is_empty() {
            map.insert(v.key.clone(), v.value.clone());
        }
    }
    if let Some(cid) = collection_id {
        if let Some(rows) = vars.collections.get(cid) {
            for v in rows {
                if v.on && !v.key.is_empty() {
                    map.insert(v.key.clone(), v.value.clone());
                }
            }
        }
    }
    if let Some(label) = env_label {
        if let Some(rows) = vars.environments.get(label) {
            for v in rows {
                if v.on && !v.key.is_empty() {
                    map.insert(v.key.clone(), v.value.clone());
                }
            }
        }
    }
    if let Some(local) = local {
        for (k, v) in local {
            map.insert(k.clone(), v.clone());
        }
    }
    map
}

/// Port of qaSubstitute (engine.ts:58-64). Unknown vars are left as the ORIGINAL
/// matched token (whitespace preserved). `{{$name}}` is resolved via `dynamics`;
/// if it returns None, the original token is kept.
pub fn qa_substitute(
    text: &str,
    map: &BTreeMap<String, String>,
    dynamics: &mut dyn Dynamics,
) -> String {
    var_re()
        .replace_all(text, |caps: &regex::Captures| {
            let whole = caps.get(0).unwrap().as_str().to_string();
            let name = caps.get(1).unwrap().as_str();
            if name.starts_with('$') {
                match dynamics.resolve(name) {
                    Some(v) => v,
                    None => whole,
                }
            } else if let Some(v) = map.get(name) {
                v.clone()
            } else {
                whole
            }
        })
        .into_owned()
}

/// Production dynamics: real clock + RNG.
pub struct RealDynamics;
impl Dynamics for RealDynamics {
    fn resolve(&mut self, name: &str) -> Option<String> {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            // as i64 truncates sub-millisecond; unwrap_or(0) is a "never in practice" backdate fallback.
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let mut next = || rand::random::<f64>();
        dynamic_value(name, now_ms, &mut next)
    }
}

/// Deterministic dynamics for fixtures: fixed clock + a replayed float sequence.
pub struct PinnedDynamics {
    now_ms: i64,
    floats: Vec<f64>,
    cursor: usize,
}
impl PinnedDynamics {
    pub fn new(now_ms: i64, floats: Vec<f64>) -> Self {
        Self {
            now_ms,
            floats,
            cursor: 0,
        }
    }
}
impl Dynamics for PinnedDynamics {
    fn resolve(&mut self, name: &str) -> Option<String> {
        let len = self.floats.len();
        let mut cursor = self.cursor;
        let floats = &self.floats;
        let mut next = || {
            let v = floats[cursor % len];
            cursor += 1;
            v
        };
        let result = dynamic_value(name, self.now_ms, &mut next);
        self.cursor = cursor;
        result
    }
}

/// Shared formula port of qaDynamic. `next` yields the next Math.random() float.
/// Mirrors engine.ts:19-28 EXACTLY (same int math, same guid bit ops).
fn dynamic_value(name: &str, now_ms: i64, next: &mut dyn FnMut() -> f64) -> Option<String> {
    match name {
        "$timestamp" => Some(((now_ms as f64 / 1000.0).floor() as i64).to_string()),
        "$isoTimestamp" => {
            // new Date(now).toISOString() — RFC3339 millis, 'Z'. chrono is a dep.
            // `?` → None leaves `{{$isoTimestamp}}` verbatim if `now_ms` is out of chrono range.
            let dt = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms)?;
            Some(dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
        }
        "$randomInt" => Some(((next() * 1000.0).floor() as i64).to_string()),
        "$guid" => {
            // 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/, ...)
            let tmpl = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
            let mut out = String::with_capacity(tmpl.len());
            for ch in tmpl.chars() {
                if ch == 'x' || ch == 'y' {
                    let r = (next() * 16.0) as u32 & 0xF; // r = Math.random()*16 | 0; mask keeps 0..=15 even if next() returns 1.0
                    let v = if ch == 'x' { r } else { (r & 0x3) | 0x8 };
                    out.push(char::from_digit(v, 16).unwrap());
                } else {
                    out.push(ch);
                }
            }
            Some(out)
        }
        "$randomEmail" => Some(format!("user{}@acme.dev", (next() * 9999.0).floor() as i64)),
        _ => None,
    }
}

// =============================================================================
// Assertion evaluator — port of engine.ts:76-108
// =============================================================================

/// Port of qaGetPath (engine.ts:76-78): dotted path walk over JSON objects.
/// Returns `Some(&Value::Null)` for a present-but-null value (counts as PRESENT),
/// and `None` for a missing path segment (counts as missing / undefined).
fn qa_get_path<'a>(obj: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = obj;
    for seg in path.split('.') {
        cur = cur.get(seg)?;
    }
    Some(cur)
}

/// `JSON.stringify(v)`: for numbers/bools → plain string, for strings → the string itself
/// (serde_json's `Value::to_string()` adds quotes around strings; we mirror JS JSON.stringify
/// which for a number 7 yields "7" and for a string "foo" yields `"\"foo\""`,
/// but in engine.ts the `actual` field is set to `JSON.stringify(v)` where v = body[path]).
/// For the fixture case `id:7` (number), JSON.stringify(7) = "7" → stored as the string "7".
/// serde_json's Display for Number gives "7" (no quotes). ✓
/// If v were a string like "hello", JSON.stringify("hello") = '"hello"' → stored as `"hello"`.
/// serde_json's Display for String gives `"hello"` (with quotes). ✓
fn json_stringify(v: &Value) -> String {
    v.to_string()
}

/// `String(v)`: JS coercion — numbers/bools to their plain string; null → "null";
/// undefined → "undefined"; strings → their content (no extra quotes); arrays/objects via JSON.
fn string_coerce(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(other) => other.to_string(),
    }
}

/// JS `typeof` — used when body is not an array in `bodyArray`.
fn js_typeof(v: &Value) -> String {
    match v {
        Value::Null => "object".into(),
        Value::Bool(_) => "boolean".into(),
        Value::Number(_) => "number".into(),
        Value::String(_) => "string".into(),
        Value::Array(_) | Value::Object(_) => "object".into(),
    }
}

/// Port of qaEval (engine.ts:90-107). Returns the assertion object with `pass` + `actual` added.
pub fn qa_eval(a: &Value, resp: &Value) -> Value {
    let body = resp.get("body").unwrap_or(&Value::Null);
    let typ = a.get("type").and_then(|t| t.as_str()).unwrap_or("");
    let (pass, actual): (bool, String) = match typ {
        "status" => {
            let s = resp
                .get("status")
                .and_then(|v| v.as_f64())
                .unwrap_or(f64::NAN);
            let val = a.get("value").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
            let op = a.get("op").and_then(|o| o.as_str()).unwrap_or("eq");
            let pass = match op {
                "neq" => s != val,
                "lt" => s < val,
                "gt" => s > val,
                _ => s == val,
            };
            // actual mirrors JS String(resp.status) — faithful for non-integer/missing values
            let actual = resp
                .get("status")
                .map(json_stringify)
                .unwrap_or_else(|| "undefined".into());
            (pass, actual)
        }
        "time" => {
            let t = resp
                .get("time")
                .and_then(|v| v.as_f64())
                .unwrap_or(f64::NAN);
            let val = a.get("value").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
            let op = a.get("op").and_then(|o| o.as_str()).unwrap_or("");
            let pass = if op == "gt" { t > val } else { t < val };
            // actual mirrors JS resp.time + ' ms' — faithful for non-integer/missing values
            let actual = format!(
                "{} ms",
                resp.get("time")
                    .map(json_stringify)
                    .unwrap_or_else(|| "undefined".into())
            );
            (pass, actual)
        }
        "bodyHas" => {
            let p = a.get("path").and_then(|p| p.as_str()).unwrap_or("");
            let v = qa_get_path(body, p);
            (
                v.is_some(),
                if v.is_none() {
                    "missing".into()
                } else {
                    "present".into()
                },
            )
        }
        "bodyEq" => {
            let p = a.get("path").and_then(|p| p.as_str()).unwrap_or("");
            let v = qa_get_path(body, p);
            // actual = JSON.stringify(v) (engine.ts:101)
            let actual = v.map(json_stringify).unwrap_or_else(|| "null".into());
            // pass = String(v) === String(value)
            let vs = string_coerce(v);
            let want = string_coerce(a.get("value"));
            (vs == want, actual)
        }
        "bodyArray" => {
            let arr = body
                .as_array()
                .or_else(|| body.get("data").and_then(|d| d.as_array()));
            let actual = match arr {
                Some(a) => format!("array({})", a.len()),
                None => js_typeof(body),
            };
            (arr.is_some(), actual)
        }
        "header" => {
            let want_name = a.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let empty_obj = json!({});
            let headers = resp.get("headers").unwrap_or(&empty_obj);
            // case-insensitive key lookup
            let val = headers.as_object().and_then(|m| {
                m.iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(want_name))
                    .map(|(_, v)| v)
            });
            let op = a.get("op").and_then(|o| o.as_str()).unwrap_or("");
            // actual = value as string, or "missing"
            let actual = val
                .map(|v| string_coerce(Some(v)))
                .unwrap_or_else(|| "missing".into());
            let pass = match op {
                "exists" => val.is_some(),
                "contains" => {
                    // Mirror engine.ts:103: String(val || '').includes(a.value)
                    // search = String(a.value) via string_coerce (handles numeric values like 3 → "3")
                    let search = string_coerce(a.get("value"));
                    // target = header value as string if present, else "" (NOT "missing")
                    // TS: String(val || '') — undefined||'' = '' → String('')= ""
                    let target = val.map(|v| string_coerce(Some(v))).unwrap_or_default();
                    target.contains(search.as_str())
                }
                _ => {
                    // TS: String(val) === String(a.value)
                    // val is already String(val) for present headers; for missing,
                    // `actual` is "missing" but TS yields String(undefined) = "undefined".
                    let lhs = val
                        .map(|v| string_coerce(Some(v)))
                        .unwrap_or_else(|| "undefined".into());
                    let rhs = string_coerce(a.get("value"));
                    lhs == rhs
                }
            };
            (pass, actual)
        }
        _ => (true, "\u{2014}".into()), // unknown type passes; actual = em dash "—" (U+2014)
    };
    let mut out = a.clone();
    if let Some(o) = out.as_object_mut() {
        o.insert("pass".into(), json!(pass));
        o.insert("actual".into(), json!(actual));
        return out;
    }
    // Non-object assertion (degenerate input) — return a visible error object rather than silently
    // returning the unchanged value with no pass/actual fields.
    json!({ "pass": false, "actual": "invalid assertion" })
}

/// Port of qaRunAssertions (engine.ts:108): skip `on === false`, eval the rest.
pub fn run_assertions(list: &[Value], resp: &Value) -> Vec<Value> {
    list.iter()
        .filter(|a| a.get("on") != Some(&json!(false)))
        .map(|a| qa_eval(a, resp))
        .collect()
}
