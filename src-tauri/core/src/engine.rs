//! Port of src/qa/engine.ts — variable resolver + assertion engine.
//! Behavior must match engine.ts exactly (verified by tests/engine_fixtures.rs).
use regex::Regex;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

/// Resolves `{{$dynamic}}` names (timestamp/guid/...). Injected so fixtures pin time/RNG.
pub trait Dynamics { fn resolve(&mut self, name: &str) -> Option<String>; }

/// Dynamics resolver that knows nothing (used where dynamics are irrelevant).
pub struct NoDynamics;
impl Dynamics for NoDynamics { fn resolve(&mut self, _name: &str) -> Option<String> { None } }

fn var_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\{\{\s*([^}]+?)\s*\}\}").unwrap())
}

#[derive(Debug, Clone, Deserialize)]
pub struct VarRow { pub key: String, pub value: String, #[serde(default)] pub on: bool }

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ScopedVars {
    #[serde(default)] pub globals: Vec<VarRow>,
    #[serde(default)] pub collections: BTreeMap<String, Vec<VarRow>>,
    #[serde(default)] pub environments: BTreeMap<String, Vec<VarRow>>,
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
    for v in &vars.globals { if v.on && !v.key.is_empty() { map.insert(v.key.clone(), v.value.clone()); } }
    if let Some(cid) = collection_id {
        if let Some(rows) = vars.collections.get(cid) {
            for v in rows { if v.on && !v.key.is_empty() { map.insert(v.key.clone(), v.value.clone()); } }
        }
    }
    if let Some(label) = env_label {
        if let Some(rows) = vars.environments.get(label) {
            for v in rows { if v.on && !v.key.is_empty() { map.insert(v.key.clone(), v.value.clone()); } }
        }
    }
    if let Some(local) = local { for (k, v) in local { map.insert(k.clone(), v.clone()); } }
    map
}

/// Port of qaSubstitute (engine.ts:58-64). Unknown vars are left as the ORIGINAL
/// matched token (whitespace preserved). `{{$name}}` is resolved via `dynamics`;
/// if it returns None, the original token is kept.
pub fn qa_substitute(text: &str, map: &BTreeMap<String, String>, dynamics: &mut dyn Dynamics) -> String {
    var_re().replace_all(text, |caps: &regex::Captures| {
        let whole = caps.get(0).unwrap().as_str().to_string();
        let name = caps.get(1).unwrap().as_str();
        if name.starts_with('$') {
            match dynamics.resolve(name) { Some(v) => v, None => whole }
        } else if let Some(v) = map.get(name) {
            v.clone()
        } else {
            whole
        }
    }).into_owned()
}

/// Production dynamics: real clock + RNG.
pub struct RealDynamics;
impl Dynamics for RealDynamics {
    fn resolve(&mut self, name: &str) -> Option<String> {
        let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64).unwrap_or(0);
        let mut next = || rand::random::<f64>();
        dynamic_value(name, now_ms, &mut next)
    }
}

/// Deterministic dynamics for fixtures: fixed clock + a replayed float sequence.
pub struct PinnedDynamics { now_ms: i64, floats: Vec<f64>, cursor: usize }
impl PinnedDynamics {
    pub fn new(now_ms: i64, floats: Vec<f64>) -> Self { Self { now_ms, floats, cursor: 0 } }
}
impl Dynamics for PinnedDynamics {
    fn resolve(&mut self, name: &str) -> Option<String> {
        let floats = self.floats.clone();
        let mut next = || { let v = floats[self.cursor % floats.len()]; self.cursor += 1; v };
        dynamic_value(name, self.now_ms, &mut next)
    }
}

/// Shared formula port of qaDynamic. `next` yields the next Math.random() float.
/// Mirrors engine.ts:19-28 EXACTLY (same int math, same guid bit ops).
fn dynamic_value(name: &str, now_ms: i64, next: &mut dyn FnMut() -> f64) -> Option<String> {
    match name {
        "$timestamp" => Some(((now_ms as f64 / 1000.0).floor() as i64).to_string()),
        "$isoTimestamp" => {
            // new Date(now).toISOString() — RFC3339 millis, 'Z'. chrono is a dep.
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
                    let r = (next() * 16.0) as u32 & 0xF;       // r = Math.random()*16 | 0
                    let v = if ch == 'x' { r } else { (r & 0x3) | 0x8 };
                    out.push(char::from_digit(v, 16).unwrap());
                } else { out.push(ch); }
            }
            Some(out)
        }
        "$randomEmail" => Some(format!("user{}@acme.dev", (next() * 9999.0).floor() as i64)),
        _ => None,
    }
}
