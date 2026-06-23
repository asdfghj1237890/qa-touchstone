//! Port of src/qa/authz.ts — RBAC matrix engine (pure). Behavior must match
//! authz.ts exactly (verified by tests/security_fixtures.rs).
use crate::config::Expectation;
use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

pub const DEFAULT_DENY_SET: [i64; 3] = [401, 403, 404];
const MUTATING_METHODS: [&str; 4] = ["POST", "PUT", "PATCH", "DELETE"];
const ADMIN_PATH_TOKENS: [&str; 8] =
    ["admin", "internal", "manage", "management", "root", "sudo", "privileged", "superuser"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome { Allowed, Denied, Other }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict { Pass, Fail, Vuln, Inconclusive }

fn path_token_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"[/._\-?=&]+").unwrap())
}
fn deny_token_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)^(?:access[_\s-]?denied|denied|forbidden|unauthoriz(?:ed|ation)|unauthoris(?:ed|ation)|permission[_\s-]?denied|not[_\s-]?allowed|insufficient[_\s-]?(?:scope|privilege|permission|role)|login[_\s-]?required|auth(?:entication)?[_\s-]?required)$").unwrap())
}
fn deny_phrase_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)\b(?:access denied|permission denied|authoriz(?:ation|ed) denied|not authoriz(?:ed|ation)|unauthoriz(?:ed|ation)|unauthoris(?:ed|ation)|you (?:do not|don't) have permission|insufficient (?:permission|permissions|privilege|privileges|scope|scopes|role)|must be logged in|login required|authentication required|not allowed to)\b").unwrap())
}
fn status_field(k: &str) -> bool { matches!(k, "status"|"code"|"result"|"outcome"|"errorcode"|"error_code"|"reason_code") }
fn prose_field(k: &str) -> bool { matches!(k, "message"|"msg"|"detail"|"details"|"title"|"description"|"reason"|"error_description"|"errordescription") }
fn error_marker_key(k: &str) -> bool { matches!(k, "error"|"errors"|"errorcode"|"error_code") }

/// classifyEndpoint (authz.ts:23-29).
pub fn classify_endpoint(method: &str, path: &str) -> bool {
    if MUTATING_METHODS.contains(&method.to_uppercase().as_str()) { return true; }
    path_token_re().split(&path.to_lowercase()).filter(|t| !t.is_empty()).any(|t| ADMIN_PATH_TOKENS.contains(&t))
}
/// endpointPrivileged (authz.ts:33-38): manual override wins, else heuristic.
pub fn endpoint_privileged(override_: Option<bool>, method: &str, path: &str) -> bool {
    override_.unwrap_or_else(|| classify_endpoint(method, path))
}
/// classifyOutcome (authz.ts:41-46).
pub fn classify_outcome(status: Option<i64>, deny_set: &[i64]) -> Outcome {
    match status {
        Some(s) if (200..=299).contains(&s) => Outcome::Allowed,
        Some(s) if deny_set.contains(&s) => Outcome::Denied,
        _ => Outcome::Other,
    }
}

fn value_denies(key: &str, value: &Value) -> bool {
    let s = match value { Value::String(s) => s.trim(), _ => return false };
    if s.is_empty() { return false; }
    if deny_phrase_re().is_match(s) { return true; }
    if (status_field(key) || key == "error") && deny_token_re().is_match(s) { return true; }
    false
}
fn scan_for_deny_phrase(node: &Value, depth: u32) -> bool {
    if depth > 6 { return false; }
    match node {
        Value::Array(a) => a.iter().any(|v| scan_for_deny_phrase(v, depth + 1)),
        Value::Object(o) => o.iter().any(|(raw, value)| {
            let key = raw.to_lowercase();
            ((status_field(&key) || prose_field(&key) || key == "error") && value_denies(&key, value))
                || (value.is_object() || value.is_array()) && scan_for_deny_phrase(value, depth + 1)
        }),
        _ => false,
    }
}
fn is_truthy_marker(v: &Value) -> bool {
    match v {
        Value::Null | Value::Bool(false) => false,
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Value::Bool(true) => true,
    }
}
fn has_error_marker(body: &serde_json::Map<String, Value>) -> bool {
    body.iter().any(|(raw, v)| error_marker_key(&raw.to_lowercase()) && is_truthy_marker(v))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SoftOutcome { Denied, Error }
/// detectSoftDeny (authz.ts:108-116). `body` is the parsed response body.
pub fn detect_soft_deny(body: &Value) -> Option<SoftOutcome> {
    match body {
        Value::Null => None,
        Value::String(s) => (deny_phrase_re().is_match(s) || deny_token_re().is_match(s.trim())).then_some(SoftOutcome::Denied),
        Value::Object(o) => {
            if scan_for_deny_phrase(body, 0) { Some(SoftOutcome::Denied) }
            else if has_error_marker(o) { Some(SoftOutcome::Error) }
            else { None }
        }
        Value::Array(_) => if scan_for_deny_phrase(body, 0) { Some(SoftOutcome::Denied) } else { None },
        _ => None,
    }
}
/// classifyResponseOutcome (authz.ts:122-130).
pub fn classify_response_outcome(status: Option<i64>, body: &Value, deny_set: &[i64]) -> Outcome {
    let base = classify_outcome(status, deny_set);
    if base != Outcome::Allowed { return base; }
    match detect_soft_deny(body) {
        Some(SoftOutcome::Denied) => Outcome::Denied,
        Some(SoftOutcome::Error) => Outcome::Other,
        None => Outcome::Allowed,
    }
}
/// verdictFor (authz.ts:134-139). None when expectation is Skip.
pub fn verdict_for(expectation: Expectation, outcome: Outcome) -> Option<Verdict> {
    match expectation {
        Expectation::Skip => None,
        _ if outcome == Outcome::Other => Some(Verdict::Inconclusive),
        Expectation::Allow => Some(if outcome == Outcome::Allowed { Verdict::Pass } else { Verdict::Fail }),
        Expectation::Deny => Some(if outcome == Outcome::Denied { Verdict::Pass } else { Verdict::Vuln }),
    }
}
/// defaultExpectation (authz.ts:149-153).
pub fn default_expectation(auth_is_none: bool, identity_privileged: bool, endpoint_priv: bool) -> Expectation {
    if auth_is_none { return Expectation::Deny; }
    if endpoint_priv && !identity_privileged { return Expectation::Deny; }
    Expectation::Allow
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn outcome_basic() {
        assert_eq!(classify_outcome(Some(200), &DEFAULT_DENY_SET), Outcome::Allowed);
        assert_eq!(classify_outcome(Some(403), &DEFAULT_DENY_SET), Outcome::Denied);
        assert_eq!(classify_outcome(Some(500), &DEFAULT_DENY_SET), Outcome::Other);
        assert_eq!(classify_outcome(None, &DEFAULT_DENY_SET), Outcome::Other);
    }
    #[test] fn soft_deny_200_body() {
        assert_eq!(classify_response_outcome(Some(200), &json!({"error":"Access denied"}), &DEFAULT_DENY_SET), Outcome::Denied);
        assert_eq!(classify_response_outcome(Some(200), &json!({"id":1}), &DEFAULT_DENY_SET), Outcome::Allowed);
        assert_eq!(classify_response_outcome(Some(200), &json!({"error":"boom"}), &DEFAULT_DENY_SET), Outcome::Other);
    }
    #[test] fn endpoint_priv() {
        assert!(classify_endpoint("DELETE","/u")); assert!(classify_endpoint("GET","/admin/x"));
        assert!(!classify_endpoint("GET","/u")); assert!(endpoint_privileged(Some(true),"GET","/u"));
    }
}
