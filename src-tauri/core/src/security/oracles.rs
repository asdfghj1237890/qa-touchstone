//! Port of src/qa/oracles.ts — response oracles (sensitive-data + schema-drift), pure.
//! Findings carry NO cell context (method/endpoint/identity = None); run_matrix stamps the cell.
use crate::security::finding::{EngineId, Finding, Severity};
use crate::security::lifecycle::normalize_path;
use regex::Regex;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::OnceLock;

/// redact (oracles.ts:10): mask the middle so evidence/path never carry a usable secret.
pub fn redact(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 8 { return "•".repeat(chars.len()); }
    let first: String = chars[..3].iter().collect();
    let last: String = chars[chars.len() - 2..].iter().collect();
    format!("{first}…<redacted>…{last}")
}

pub const WALK_MAX_DEPTH: usize = 64;
/// walk_json (oracles.ts:39): visit(path, key, value) for every property, then recurse. depth-capped.
fn walk_json(node: &Value, path: &str, depth: usize, visit: &mut dyn FnMut(&str, &str, &Value)) {
    if depth >= WALK_MAX_DEPTH { return; }
    match node {
        Value::Object(map) => for (k, v) in map {
            let p = if path.is_empty() { k.clone() } else { format!("{path}.{k}") };
            visit(&p, k, v);
            if v.is_object() || v.is_array() { walk_json(v, &p, depth + 1, visit); }
        },
        Value::Array(arr) => for (i, v) in arr.iter().enumerate() {
            let p = if path.is_empty() { format!("[{i}]") } else { format!("{path}[{i}]") };
            visit(&p, "", v);
            if v.is_object() || v.is_array() { walk_json(v, &p, depth + 1, visit); }
        },
        _ => {}
    }
}

fn luhn_valid(s: &str) -> bool { // oracles.ts:81
    let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    if d.len() < 13 || d.len() > 19 { return false; }
    let mut sum = 0u32; let mut alt = false;
    for c in d.chars().rev() {
        let mut n = c.to_digit(10).unwrap();
        if alt { n *= 2; if n > 9 { n -= 9; } }
        sum += n; alt = !alt;
    }
    sum % 10 == 0
}

struct SensRule { id: &'static str, group: &'static str, severity: Severity, title: &'static str,
    key: Option<Regex>, value: Option<Regex>, luhn: bool }

fn rules() -> &'static [SensRule] {
    static R: OnceLock<Vec<SensRule>> = OnceLock::new();
    R.get_or_init(|| vec![
        SensRule { id:"jwt", group:"secrets", severity:Severity::High, title:"JWT in response",
            key:None, value:Some(Regex::new(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\b").unwrap()), luhn:false },
        SensRule { id:"aws-key", group:"secrets", severity:Severity::High, title:"AWS access key id",
            key:None, value:Some(Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap()), luhn:false },
        SensRule { id:"private-key", group:"secrets", severity:Severity::Critical, title:"Private key",
            key:None, value:Some(Regex::new(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----").unwrap()), luhn:false },
        SensRule { id:"secret-name", group:"secrets", severity:Severity::Critical, title:"Secret-named field present",
            key:Some(Regex::new(r"(?i)^(password|passwd|pwd|secret|client_secret|access_token|refresh_token|api_?key|token)$").unwrap()), value:None, luhn:false },
        SensRule { id:"email", group:"pii", severity:Severity::Medium, title:"Email address",
            key:None, value:Some(Regex::new(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b").unwrap()), luhn:false },
        SensRule { id:"card", group:"pii", severity:Severity::High, title:"Credit-card-like number",
            key:None, value:Some(Regex::new(r"\b(?:\d[ -]?){13,19}\b").unwrap()), luhn:true },
        SensRule { id:"internal", group:"internal", severity:Severity::Medium, title:"Internal/debug field",
            key:Some(Regex::new(r"(?i)^(stack_?trace|exception|sql|query|internal.*|debug)$").unwrap()), value:None, luhn:false },
    ])
}

/// OracleConfig (resolved; oracles.ts DEFAULT_ORACLE_CONFIG = sensitive+schema on).
pub struct OracleConfig { pub sensitive: bool, pub schema: bool, pub severity_overrides: BTreeMap<String, Severity> }
impl Default for OracleConfig { fn default() -> Self { OracleConfig { sensitive: true, schema: true, severity_overrides: BTreeMap::new() } } }

fn value_to_match_str(v: &Value) -> Option<String> { // rules match strings + numbers
    match v { Value::String(s) => Some(s.clone()), Value::Number(n) => Some(n.to_string()), _ => None }
}

/// Redact secret-VALUE patterns (jwt/aws-key/private-key/email/card) anywhere in a finding path —
/// covers a secret used as a JSON *key* (an ancestor of the matched field), which would otherwise
/// reach JSON/SARIF/HTML/baseline output (the CLI redaction set only covers identity-auth secrets).
/// Internal dedup/fingerprint keys use the RAW path; only the emitted Finding.path is sanitized.
fn sanitize_path(path: &str) -> String {
    let mut out = path.to_string();
    for rule in rules() {
        let Some(re) = &rule.value else { continue };
        let hits: Vec<String> = re.find_iter(&out)
            .filter(|m| !rule.luhn || luhn_valid(m.as_str()))
            .map(|m| m.as_str().to_string())
            .collect();
        for h in hits { out = out.replace(&h, &redact(&h)); }
    }
    out
}

// Free fn (NOT a closure) so it can take &mut out/&mut seen without nested-closure borrow conflicts.
#[allow(clippy::too_many_arguments)]
fn emit(out: &mut Vec<Finding>, seen: &mut std::collections::BTreeSet<String>, cfg: &OracleConfig,
        id: &str, group: &str, sev: Severity, title: &str, raw_path: &str, value: &Value) {
    let k = format!("{id}@{raw_path}");
    if !seen.insert(k) { return; }                 // BTreeSet::insert → false if already present
    // Redact any secret value that appears in the path (e.g. a secret used as an ancestor key).
    let path = sanitize_path(raw_path);
    // TS parity (oracles.ts:120): a key-rule on an object/array/null value pushes "[object]";
    // value-rules only ever match strings/numbers, so they carry their own value here.
    let ev_src = match value { Value::Object(_) | Value::Array(_) | Value::Null => "[object]".to_string(),
        Value::String(s) => s.clone(), Value::Number(n) => n.to_string(), Value::Bool(b) => b.to_string() };
    let severity = cfg.severity_overrides.get(group).copied().unwrap_or(sev);
    out.push(Finding { engine: EngineId::Oracle, severity, rule_id: id.into(), oracle: "sensitive-data".into(),
        title: title.into(), path, evidence: redact(&ev_src), method: None, endpoint: None, identity: None });
}

/// scanSensitive (oracles.ts:93). Builds engine=Oracle findings (cell stamped later by run_matrix).
pub fn scan_sensitive(body: &Value, headers: &Value, cfg: &OracleConfig) -> Vec<Finding> {
    if !cfg.sensitive { return vec![]; }
    let mut out: Vec<Finding> = Vec::new();
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    if let Value::Object(h) = headers {
        static LH: OnceLock<Regex> = OnceLock::new();
        let lh = LH.get_or_init(|| Regex::new(r"(?i)^(server|x-powered-by)$").unwrap());
        for (hk, hv) in h {
            if lh.is_match(hk) {
                let hvs = hv.as_str().map(|s| s.to_string()).unwrap_or_else(|| hv.to_string());
                emit(&mut out, &mut seen, cfg, "leaky-header", "internal", Severity::Medium, "Server/version header", &format!("header:{hk}"), &Value::String(hvs));
            }
        }
    }
    let mut visits: Vec<(String, String, Value)> = Vec::new();
    match body {
        Value::Object(_) | Value::Array(_) => walk_json(body, "", 0, &mut |p, k, v| visits.push((p.to_string(), k.to_string(), v.clone()))),
        Value::String(s) => visits.push(("$".to_string(), String::new(), Value::String(s.clone()))),
        _ => {}
    }
    for (path, key, value) in &visits {
        for rule in rules() {
            if let Some(kre) = &rule.key {
                if !key.is_empty() && kre.is_match(key) {
                    emit(&mut out, &mut seen, cfg, rule.id, rule.group, rule.severity, rule.title, path, value);
                    continue;
                }
            }
            if let Some(vre) = &rule.value {
                if let Some(s) = value_to_match_str(value) {
                    if let Some(m) = vre.find(&s) {
                        if rule.luhn && !luhn_valid(m.as_str()) { continue; }
                        emit(&mut out, &mut seen, cfg, rule.id, rule.group, rule.severity, rule.title, path, value);
                    }
                }
            }
        }
    }
    out
}

fn js_type(v: &Value) -> &'static str { // oracles.ts:139
    match v { Value::Null=>"null", Value::Array(_)=>"array", Value::String(_)=>"string",
        Value::Number(_)=>"number", Value::Bool(_)=>"boolean", Value::Object(_)=>"object" }
}

pub type Contract = BTreeMap<String, (String, bool)>; // normalizedPath -> (type, required)

/// inferContract (oracles.ts:146).
pub fn infer_contract(body: &Value) -> Contract {
    let mut c = Contract::new();
    if body.is_object() || body.is_array() {
        walk_json(body, "", 0, &mut |path, _k, value| { c.insert(normalize_path(path), (js_type(value).into(), true)); });
    }
    c
}

/// checkSchema (oracles.ts:154). engine=Oracle, oracle="schema", cell stamped later.
pub fn check_schema(body: &Value, contract: &Contract, cfg: &OracleConfig) -> Vec<Finding> {
    if !cfg.schema { return vec![]; }
    let mut out = Vec::new();
    let mut present: BTreeMap<String, String> = BTreeMap::new();
    if body.is_object() || body.is_array() {
        walk_json(body, "", 0, &mut |path, _k, value| { present.insert(normalize_path(path), js_type(value).into()); });
    }
    let mk = |rule: &str, sev: Severity, title: &str, path: &str, ev: String| Finding {
        engine: EngineId::Oracle, severity: sev, rule_id: rule.into(), oracle: "schema".into(),
        title: title.into(), path: sanitize_path(path), evidence: ev, method: None, endpoint: None, identity: None };
    for (p, ty) in &present {
        match contract.get(p) {
            None => out.push(mk("schema:undeclared", Severity::Low, "Undeclared field", p, String::new())),
            Some((cty, _)) if ty != cty && cty != "null" && ty != "null" =>
                out.push(mk("schema:type-mismatch", Severity::Medium, "Type mismatch", p, format!("{cty} → {ty}"))),
            _ => {}
        }
    }
    for (p, (_ty, required)) in contract {
        if *required && !present.contains_key(p) {
            out.push(mk("schema:missing", Severity::Medium, "Missing field", p, String::new()));
        }
    }
    out
}

/// runOracles (oracles.ts:182): sensitive + (2xx & baseline ⇒ schema); undeclared-that-also-leaks ⇒ high.
pub fn run_oracles(status: i64, body: &Value, headers: &Value, baseline: Option<&Contract>, cfg: &OracleConfig) -> Vec<Finding> {
    let sensitive = scan_sensitive(body, headers, cfg);
    let leak_paths: std::collections::BTreeSet<String> = sensitive.iter().map(|f| normalize_path(&f.path)).collect();
    let mut out = sensitive;
    let is2xx = (200..=299).contains(&status);
    if is2xx {
        if let Some(c) = baseline {
            for mut f in check_schema(body, c, cfg) {
                if f.title == "Undeclared field" && leak_paths.contains(&f.path) { f.severity = Severity::High; }
                out.push(f);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn redact_thresholds() { assert_eq!(redact("abc"), "•••"); assert_eq!(redact("abcdefghij"), "abc…<redacted>…ij"); }
    #[test] fn secret_in_key_is_masked_in_path() {
        let body = json!({"eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig123":"eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig123"});
        let fs = scan_sensitive(&body, &json!({}), &OracleConfig::default());
        let jwt = fs.iter().find(|f| f.rule_id == "jwt").expect("jwt finding");
        assert!(jwt.path.contains("…<redacted>…") && !jwt.path.contains("sig123"), "path must mask the secret-key");
        assert!(jwt.evidence.contains("…<redacted>…"));
    }
    #[test] fn walk_depth_cap_no_panic() {
        let mut v = json!("x"); for _ in 0..200 { v = json!({"a": v}); }
        let _ = scan_sensitive(&v, &json!({}), &OracleConfig::default());
    }
    #[test] fn secret_in_ancestor_key_is_masked_in_path() {
        // A secret used as an object KEY (ancestor of the matched field) must not leak into the path.
        let body = json!({"AKIAIOSFODNN7EXAMPLE": {"token": "eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig123"}});
        let fs = scan_sensitive(&body, &json!({}), &OracleConfig::default());
        let jwt = fs.iter().find(|f| f.rule_id == "jwt").expect("jwt finding");
        assert!(!jwt.path.contains("AKIAIOSFODNN7EXAMPLE"), "ancestor secret key must be redacted in path: {}", jwt.path);
        assert!(jwt.path.contains("…<redacted>…"), "path should carry the redaction marker: {}", jwt.path);
    }
    #[test] fn schema_path_redacts_secret_key() {
        // Schema findings must redact a secret used as a key too (raw path previously leaked it).
        let fs = check_schema(&json!({"AKIAIOSFODNN7EXAMPLE": "v"}), &Contract::new(), &OracleConfig::default());
        let f = fs.iter().find(|f| f.rule_id == "schema:undeclared").expect("undeclared finding");
        assert!(!f.path.contains("AKIAIOSFODNN7EXAMPLE"), "schema path must redact a secret key: {}", f.path);
    }
    #[test] fn null_secret_field_evidence_is_object() {
        // TS parity (typeof null === 'object'): a secret-named key with a null value → "[object]" → 8 bullets.
        let fs = scan_sensitive(&json!({"password": null}), &json!({}), &OracleConfig::default());
        let f = fs.iter().find(|f| f.rule_id == "secret-name").expect("secret-name finding");
        assert_eq!(f.evidence, "••••••••", "null value redacts as 8 bullets like TS String('[object]')");
    }
}
