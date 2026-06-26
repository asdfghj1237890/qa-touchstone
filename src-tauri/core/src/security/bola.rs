//! Port of src/qa/bola.ts + bolaSetup.ts::syntheticIdFor — BOLA/IDOR pure logic.
//! Response-analysis helpers match bola.ts EXACTLY (TS-fixtured). apply_id_location
//! mutates the CLI config Request shape (Rust-unit-tested; a documented adaptation).
use crate::config::{IdLocation, Kv, Request};
use crate::datafile::js_string;
use regex::Regex;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;

pub const MATCH_THRESHOLD: f64 = 0.6;
const WALK_MAX_DEPTH: u32 = 64; // mirrors oracles.ts WALK_MAX_DEPTH

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BolaVerdict { Pass, Vuln, Unconfirmed, Inconclusive }

const MUTATING_METHODS: [&str; 4] = ["POST", "PUT", "PATCH", "DELETE"];

// ── JSON walk (mirror oracles.ts walkJson): visit (path, key|None, value) for every
//    descendant of an object/array, depth-capped, with the SAME path format. ──
fn walk_json(node: &Value, path: &str, depth: u32, visit: &mut dyn FnMut(&str, Option<&str>, &Value)) {
    if depth >= WALK_MAX_DEPTH { return; }
    match node {
        Value::Array(a) => for (i, v) in a.iter().enumerate() {
            let p = if path.is_empty() { format!("[{i}]") } else { format!("{path}[{i}]") };
            visit(&p, None, v);
            if v.is_object() || v.is_array() { walk_json(v, &p, depth + 1, visit); }
        },
        Value::Object(o) => for (k, v) in o {
            let p = if path.is_empty() { k.clone() } else { format!("{path}.{k}") };
            visit(&p, Some(k), v);
            if v.is_object() || v.is_array() { walk_json(v, &p, depth + 1, visit); }
        },
        _ => {}
    }
}

fn scalar_leaves(body: &Value) -> HashSet<String> {
    let mut set = HashSet::new();
    if body.is_object() || body.is_array() {
        walk_json(body, "", 0, &mut |_p, _k, v| { if !v.is_null() && !v.is_object() && !v.is_array() { set.insert(js_string(v)); } });
    } else if !body.is_null() {
        set.insert(js_string(body));
    }
    set
}

fn array_index_re() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new(r"\[\d+\]").unwrap()) }
fn structural_signature(body: &Value) -> HashSet<String> {
    let mut sig = HashSet::new();
    if body.is_object() || body.is_array() {
        walk_json(body, "", 0, &mut |p, _k, _v| { sig.insert(array_index_re().replace_all(p, "[]").into_owned()); });
    }
    sig
}

const IDENTITY_KEYS: [&str; 13] = ["id","uuid","guid","oid","pk","key","ref","owner","ownerid","userid","accountid","customerid","objectid"];
fn id_suffix_re() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new(r"(?i)(^|[_-])id$").unwrap()) }
fn camel_id_re() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new(r"[a-z]Id$").unwrap()) }
/// isIdentityKey (bola.ts:114-121).
pub fn is_identity_key(key: &str) -> bool {
    if key.is_empty() { return false; }
    if IDENTITY_KEYS.contains(&key.to_lowercase().as_str()) { return true; }
    if id_suffix_re().is_match(key) { return true; }   // _id / -id / trailing id
    if camel_id_re().is_match(key) { return true; }    // camelCase userId
    false
}

fn id_echoed_at_identity_key(body: &Value, idv: &str) -> bool {
    let mut hit = false;
    walk_json(body, "", 0, &mut |_p, k, v| {
        if hit { return; }
        if let Some(k) = k {
            if is_identity_key(k) && !v.is_null() && !v.is_object() && !v.is_array() && js_string(v) == idv { hit = true; }
        }
    });
    hit
}

/// matchesOwner (bola.ts:143-163): id-echo at an identity key, OR Jaccard(scalar leaves) >= 0.6.
pub fn matches_owner(attack_body: &Value, owner_body: &Value, owner_id_value: &Value) -> bool {
    let idv = js_string(owner_id_value);
    if attack_body.is_object() || attack_body.is_array() {
        if id_echoed_at_identity_key(attack_body, &idv) { return true; }
    } else if let Value::String(s) = attack_body {
        if s.contains(&idv) { return true; }
    }
    if (attack_body.is_object() || attack_body.is_array()) && (owner_body.is_object() || owner_body.is_array()) {
        let a = scalar_leaves(attack_body);
        let o = scalar_leaves(owner_body);
        if o.is_empty() { return false; }
        let inter = o.iter().filter(|x| a.contains(*x)).count();
        let union = a.len() + o.len() - inter;
        if union > 0 && (inter as f64) / (union as f64) >= MATCH_THRESHOLD { return true; }
    }
    false
}

/// classifyBola (bola.ts:165-171). `method` is unused (kept out — bolaSeverity uses it).
pub fn classify_bola(status: Option<i64>, matched: bool, deny_set: &[i64]) -> BolaVerdict {
    match status {
        None => BolaVerdict::Inconclusive,
        Some(s) if deny_set.contains(&s) => BolaVerdict::Pass,
        Some(s) if (200..=299).contains(&s) => if matched { BolaVerdict::Vuln } else { BolaVerdict::Unconfirmed },
        _ => BolaVerdict::Inconclusive,
    }
}

/// negativeControlFailed (bola.ts:179-185): a fake id answered 2xx that returned the owner's object.
pub fn negative_control_failed(status: Option<i64>, deny_set: &[i64], matched: bool) -> bool {
    match status {
        Some(s) if deny_set.contains(&s) => false,
        Some(s) if (200..=299).contains(&s) => matched,
        _ => false,
    }
}

/// controlSuggestsIgnoredId (bola.ts:195-215): structural shape == owner ref, synthetic id absent, owner id present.
pub fn control_suggests_ignored_id(control_body: &Value, owner_body: &Value, owner_id_value: &Value, synthetic: &str) -> bool {
    let idv = js_string(owner_id_value);
    if let (Value::String(c), Value::String(o)) = (control_body, owner_body) {
        return c == o && c.contains(&idv) && !c.contains(synthetic);
    }
    if !(control_body.is_object() || control_body.is_array()) || !(owner_body.is_object() || owner_body.is_array()) { return false; }
    let o_sig = structural_signature(owner_body);
    if o_sig.is_empty() { return false; }
    if structural_signature(control_body) != o_sig { return false; }
    let c_leaves = scalar_leaves(control_body);
    if c_leaves.contains(synthetic) { return false; }
    c_leaves.contains(&idv)
}

use crate::security::finding::Severity;
/// bolaSeverity (bola.ts:217-221).
pub fn bola_severity(method: &str, verdict: BolaVerdict) -> Option<Severity> {
    match verdict {
        BolaVerdict::Vuln => Some(if MUTATING_METHODS.contains(&method.to_uppercase().as_str()) { Severity::Critical } else { Severity::High }),
        BolaVerdict::Unconfirmed => Some(Severity::Medium),
        _ => None,
    }
}

fn uuid_re() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap()) }
fn hex24_re() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new(r"(?i)^[0-9a-f]{24}$").unwrap()) }
fn num_re() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new(r"^\d+$").unwrap()) }
/// syntheticIdFor (bolaSetup.ts:92-98). Deterministic, shape-matched.
pub fn synthetic_id_for(sample_value: &Value) -> String {
    let s = if sample_value.is_null() { String::new() } else { js_string(sample_value) };
    if uuid_re().is_match(&s) { return "ffffffff-eeee-4ddd-8ccc-bbbbaaaa9999".into(); }
    if hex24_re().is_match(&s) { return "ffffffffffffffffffffffff".into(); }
    if num_re().is_match(&s) { return "999999999".into(); }
    "qa-nonexistent-2c1f9a".into()
}

// ── id mutation on the CLI config Request (NOT TS-fixtured — a documented adaptation) ──
fn set_at_path(obj: &mut Value, path: &str, value: Value) -> bool {
    let dotted = array_index_re_dot().replace_all(path, ".$1");
    let keys: Vec<&str> = dotted.split('.').filter(|s| !s.is_empty()).collect();
    if keys.is_empty() { return false; }
    let mut cur = obj;
    for k in &keys[..keys.len() - 1] {
        cur = match cur {
            Value::Object(m) if m.contains_key(*k) => m.get_mut(*k).unwrap(),
            Value::Array(a) => match k.parse::<usize>() { Ok(i) if i < a.len() => &mut a[i], _ => return false },
            _ => return false,
        };
    }
    let last = keys[keys.len() - 1];
    match cur {
        Value::Object(m) if m.contains_key(last) => { m.insert(last.to_string(), value); true }
        Value::Array(a) => match last.parse::<usize>() { Ok(i) if i < a.len() => { a[i] = value; true } _ => false },
        _ => false,
    }
}
fn array_index_re_dot() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new(r"\[(\d+)\]").unwrap()) }

/// NOTE: for `IdLocation::Path`, `req.url` must already be variable-RESOLVED (absolute) —
/// `run_bola`'s `build_bola_request` substitutes `{{vars}}` in the URL before calling, so a
/// templated `{{apiHost}}/orders/1` config works. (Mirrors the TS, where the page resolves first.)
///
/// Mutate the config Request so the object id at `loc` becomes `value`, BEFORE build_request.
/// path → the (parsed, absolute) URL's path segments (CLI adaptation); query → upsert Kv;
/// body → JSON dot-path. Err if it cannot apply (out-of-range index / missing body path / non-JSON body).
pub fn apply_id_location(req: &Request, loc: &IdLocation, value: &Value) -> Result<Request, String> {
    let mut out = req.clone();
    let v = js_string(value);
    match loc {
        IdLocation::Path { index } => {
            let mut url = reqwest::Url::parse(&out.url).map_err(|e| format!("bad URL `{}`: {e}", out.url))?;
            let segs: Vec<String> = url.path_segments().map(|s| s.map(str::to_string).collect()).unwrap_or_default();
            let non_empty: Vec<usize> = segs.iter().enumerate().filter(|(_, s)| !s.is_empty()).map(|(i, _)| i).collect();
            let target = *non_empty.get(*index).ok_or_else(|| format!("path index {index} out of range ({} segments)", non_empty.len()))?;
            let mut new_segs = segs.clone();
            new_segs[target] = v;
            url.set_path(&new_segs.join("/"));
            out.url = url.to_string();
        }
        IdLocation::Query { key } => {
            // Drop any same-key pair already in the resolved URL's own query string: build_request
            // appends Request.query with `&`, so a leftover `?key=old` would survive next to the
            // injected `key=new` and a first-wins server could defeat the test. (The TS mutates
            // structured params, which dedupe by key.)
            if out.url.contains('?') {
                if let Ok(mut url) = reqwest::Url::parse(&out.url) {
                    let kept: Vec<(String, String)> = url.query_pairs()
                        .filter(|(k, _)| k.as_ref() != key.as_str())
                        .map(|(k, val)| (k.into_owned(), val.into_owned()))
                        .collect();
                    if kept.is_empty() {
                        url.set_query(None);
                    } else {
                        let mut qp = url.query_pairs_mut();
                        qp.clear();
                        for (k, val) in &kept { qp.append_pair(k, val); }
                    }
                    out.url = url.to_string();
                }
            }
            if let Some(kv) = out.query.iter_mut().find(|kv| &kv.key == key) { kv.value = v; }
            else { out.query.push(Kv { key: key.clone(), value: v }); }
        }
        IdLocation::Body { path } => {
            let body = out.body.as_mut().ok_or("body id location but request has no body")?;
            let mut json: Value = serde_json::from_str(&body.content).map_err(|_| "body is not JSON".to_string())?;
            if !set_at_path(&mut json, path, value.clone()) { return Err(format!("body path `{path}` not found")); }
            body.content = serde_json::to_string(&json).map_err(|e| e.to_string())?;
        }
    }
    Ok(out)
}

use crate::config::{Config, Identity};
use crate::engine::{qa_substitute, qa_var_map, RealDynamics};
use crate::buildreq::{build_request, exec_opts_for};
use crate::redact::RedactionSet;
use crate::step::{run_step, StepResult};
use crate::security::finding::{EngineError, EngineId, Finding};
use std::collections::BTreeMap;

/// True if an idValue is usable as an owner (non-null, non-empty-string). The scan's
/// scope-descriptor reuses THIS predicate so the hashed surface can't drift from the
/// set of owners the runtime actually exercises (which filters by this same test below).
pub fn idval_nonempty(v: &Value) -> bool {
    match v { Value::Null => false, Value::String(s) => !s.is_empty(), _ => true }
}

/// Build the mutated+resolved prepared request for one (test, identity, id_value).
/// Substitutes {{vars}} in the URL FIRST so apply_id_location's Path branch can parse an
/// otherwise-templated URL; applies the id at idLocation; then build_request (auth + final shape).
fn build_bola_request(
    req: &Request, identity: &Identity, id_value: &Value, loc: &IdLocation, var_map: &BTreeMap<String, String>,
) -> Result<Value, String> {
    let mut r = req.clone();
    r.url = qa_substitute(&r.url, var_map, &mut RealDynamics); // resolve {{vars}} so Path can parse
    let mutated = apply_id_location(&r, loc, id_value)?;
    build_request(&mutated, identity, var_map, &mut RealDynamics)
}

/// Run object-level authz (BOLA) tests. Mirrors bola.ts runBola: reference -> optional
/// negative control -> attacker x owner attack. Returns (findings, errors). Findings carry
/// NO idValue (masked); detection uses the raw idValue internally only.
pub async fn run_bola(cfg: &Config, env: Option<&str>) -> (Vec<Finding>, Vec<EngineError>) {
    let bcfg = match cfg.security.as_ref().and_then(|s| s.bola.as_ref()) { Some(b) => b, None => return (vec![], vec![]) };
    let deny_set = crate::security::authz::DEFAULT_DENY_SET;
    let scoped = cfg.scoped_vars();
    let var_map = qa_var_map(&scoped, env, None, None);
    let mut findings = Vec::new();
    let mut errors: Vec<EngineError> = Vec::new();

    for test in &bcfg.tests {
        let req = match cfg.requests.iter().find(|r| r.id == test.request) { Some(r) => r, None => continue };
        let owners: Vec<&Identity> = cfg.identities.iter()
            .filter(|i| test.id_values.get(&i.id).map(idval_nonempty).unwrap_or(false)).collect();
        if owners.len() < 2 {
            eprintln!("warn: bola test `{}` skipped: needs >= 2 identities with non-empty idValues", test.id);
            continue;
        }
        // idValues may be PII and are NOT in scan's auth-secret union set; redact every transform
        // form (raw / percent-encoded / JSON / lowercased) of them from error messages, which can
        // carry the resolved URL (with the id) from the executor. Masked here at construction.
        let mut idred = RedactionSet::default();
        idred.extend_with_values(test.id_values.values().map(js_string));
        let err = |idy: String, msg: String| EngineError { engine: EngineId::Bola, endpoint: Some(test.id.clone()), identity: Some(idy), message: idred.redact_str(&msg) };

        // Reference phase — each owner runs its OWN id. Surface execution failures as errors
        // (matrix-parity: a reference that cannot run must not let the scan report a false clean).
        let mut reference: BTreeMap<&str, StepResult> = BTreeMap::new();
        for o in &owners {
            match build_bola_request(req, o, &test.id_values[&o.id], &test.id_location, &var_map) {
                Ok(rd) => {
                    let step = run_step(&rd, &[], exec_opts_for(&o.auth)).await;
                    if !step.success {
                        errors.push(err(o.id.clone(), format!("bola `{}` reference {} failed: {}", test.id, o.id, step.error.as_deref().unwrap_or("request failed"))));
                    }
                    reference.insert(o.id.as_str(), step);
                }
                Err(e) => errors.push(err(o.id.clone(), format!("bola `{}` reference build failed: {e}", test.id))),
            }
        }
        let ref_ok = |id: &str| reference.get(id).map(|r| r.success && (200..=299).contains(&r.status)).unwrap_or(false);

        // Negative control (opt-in). Surface build/exec failures as errors too.
        let mut control_failed = false;
        if test.negative_control {
            let co = owners[0];
            let synth = synthetic_id_for(&test.id_values[&co.id]);
            match build_bola_request(req, co, &Value::String(synth.clone()), &test.id_location, &var_map) {
                Ok(rd) => {
                    let step = run_step(&rd, &[], exec_opts_for(&co.auth)).await;
                    if !step.success {
                        errors.push(err(co.id.clone(), format!("bola `{}` negative-control failed: {}", test.id, step.error.as_deref().unwrap_or("request failed"))));
                    }
                    let matched = step.success && ref_ok(&co.id)
                        && control_suggests_ignored_id(&step.body, &reference[co.id.as_str()].body, &test.id_values[&co.id], &synth);
                    control_failed = negative_control_failed(if step.success { Some(step.status) } else { None }, &deny_set, matched);
                }
                Err(e) => errors.push(err(co.id.clone(), format!("bola `{}` negative-control build failed: {e}", test.id))),
            }
        }

        // Attack phase — attacker A uses owner O's id.
        for a in &owners {
            for o in &owners {
                if a.id == o.id { continue; }
                let rd = match build_bola_request(req, a, &test.id_values[&o.id], &test.id_location, &var_map) {
                    Ok(rd) => rd,
                    Err(e) => { errors.push(err(format!("{}→{}", a.id, o.id), format!("bola `{}` attack build failed: {e}", test.id))); continue; }
                };
                let step = run_step(&rd, &[], exec_opts_for(&a.auth)).await;
                if !step.success {
                    errors.push(err(format!("{}→{}", a.id, o.id), format!("bola `{}` attack {}→{} failed: {}", test.id, a.id, o.id, step.error.as_deref().unwrap_or("request failed"))));
                    continue;
                }
                if control_failed { continue; } // endpoint not object-scoped → demote (no finding)
                let matched = ref_ok(&o.id) && matches_owner(&step.body, &reference[o.id.as_str()].body, &test.id_values[&o.id]);
                let verdict = classify_bola(Some(step.status), matched, &deny_set);
                if let Some(sev) = bola_severity(&req.method, verdict) {
                    let title = if verdict == BolaVerdict::Vuln { "Cross-object access confirmed" } else { "Cross-object access (unconfirmed)" };
                    let method = req.method.to_uppercase();
                    findings.push(Finding {
                        engine: EngineId::Bola, severity: sev, rule_id: "bola.cross-object".into(), oracle: "object-authz".into(),
                        title: title.into(),
                        path: format!("{method} {}", test.request),
                        evidence: format!("as `{}` reached `{}`'s object (id redacted)", a.id, o.id), // idValue MASKED
                        method: Some(method), endpoint: Some(test.request.clone()), identity: Some(format!("{}: {}→{}", test.id, a.id, o.id)),
                    });
                }
            }
        }
    }
    (findings, errors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn matches_owner_id_echo() {
        assert!(matches_owner(&json!({"userId":"ownerX","data":1}), &json!({}), &json!("ownerX")));
        assert!(!matches_owner(&json!({"page":"1"}), &json!({}), &json!("1")), "non-identity key is not a match");
    }
    #[test] fn matches_owner_jaccard() {
        let owner = json!({"a":"x","b":"y","c":"z"});
        assert!(matches_owner(&json!({"a":"x","b":"y","c":"z"}), &owner, &json!("nope")));
        assert!(!matches_owner(&json!({"a":"x"}), &owner, &json!("nope")), "1/3 overlap < 0.6");
    }
    #[test] fn classify_and_severity() {
        assert_eq!(classify_bola(Some(403), false, &[401,403,404]), BolaVerdict::Pass);
        assert_eq!(classify_bola(Some(200), true, &[401,403,404]), BolaVerdict::Vuln);
        assert_eq!(classify_bola(Some(200), false, &[401,403,404]), BolaVerdict::Unconfirmed);
        assert_eq!(bola_severity("DELETE", BolaVerdict::Vuln), Some(Severity::Critical));
        assert_eq!(bola_severity("GET", BolaVerdict::Vuln), Some(Severity::High));
    }
    #[test] fn synthetic_shapes() {
        assert_eq!(synthetic_id_for(&json!(42)), "999999999");
        assert_eq!(synthetic_id_for(&json!("550e8400-e29b-41d4-a716-446655440000")), "ffffffff-eeee-4ddd-8ccc-bbbbaaaa9999");
        assert_eq!(synthetic_id_for(&json!("abc")), "qa-nonexistent-2c1f9a");
    }
    #[test] fn apply_id_path_query_body() {
        let mk = |url: &str, q: Vec<Kv>, body: Option<&str>| Request { id:"r".into(), method:"GET".into(), url:url.into(),
            headers:vec![], query:q, body: body.map(|c| crate::config::Body{ mode: crate::config::BodyMode::Json, content:c.into() }), assertions:vec![], privileged:None };
        // path index 1 → second non-empty segment
        let r = apply_id_location(&mk("https://x/orders/1/items", vec![], None), &IdLocation::Path{index:1}, &json!("Z")).unwrap();
        assert!(r.url.contains("/orders/Z/items"), "{}", r.url);
        assert!(apply_id_location(&mk("https://x/orders", vec![], None), &IdLocation::Path{index:5}, &json!("Z")).is_err());
        // query upsert
        let r = apply_id_location(&mk("https://x/o", vec![], None), &IdLocation::Query{key:"id".into()}, &json!(7)).unwrap();
        assert_eq!(r.query[0].value, "7");
        // query id REPLACES a same-key param already in the URL string (no `id=alice&id=bob` dup)
        let r = apply_id_location(&mk("https://x/o?id=alice&page=2", vec![], None), &IdLocation::Query{key:"id".into()}, &json!("bob")).unwrap();
        assert!(!r.url.contains("id=alice"), "stale URL id stripped: {}", r.url);
        assert!(r.url.contains("page=2"), "other URL params kept: {}", r.url);
        assert_eq!(r.query.iter().find(|kv| kv.key=="id").unwrap().value, "bob");
        // body dot-path preserves number type
        let r = apply_id_location(&mk("https://x/o", vec![], Some(r#"{"order":{"id":1}}"#)), &IdLocation::Body{path:"order.id".into()}, &json!(9)).unwrap();
        assert!(r.body.unwrap().content.contains("\"id\":9"));
        // body dot-path through an array parent (matches TS setAtPath's `in` semantics)
        let r = apply_id_location(&mk("https://x/o", vec![], Some(r#"{"items":[{"id":1}]}"#)), &IdLocation::Body{path:"items[0].id".into()}, &json!(9)).unwrap();
        assert!(r.body.unwrap().content.contains("\"id\":9"));
    }
}
