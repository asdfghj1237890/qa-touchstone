//! Port of src/qa/engine.ts — variable resolver + assertion engine.
//! Behavior must match engine.ts exactly (verified by tests/engine_fixtures.rs).
use regex::Regex;
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
