use qa_touchstone_core::security::finding::{EngineId, Finding, Severity};
use qa_touchstone_core::security::lifecycle::*;

#[derive(serde::Deserialize)] struct File { fnv: Vec<Fnv>, alias: Vec<Alias>, sev: Vec<Sev> }
#[derive(serde::Deserialize)] struct Fnv { s: String, expected: String }
#[derive(serde::Deserialize)] struct Alias { id: String, expected: String }
#[derive(serde::Deserialize)] struct Sev { sev: String, ov: Option<String>, expected: String }

fn sev_from(s: &str) -> Severity { match s { "critical"=>Severity::Critical, "high"=>Severity::High, "medium"=>Severity::Medium, "low"=>Severity::Low, _=>Severity::Info } }
fn sev_opt(s: &str) -> Option<Severity> { matches!(s, "critical"|"high"|"medium"|"low"|"info").then(|| sev_from(s)) }

#[test]
fn lifecycle_matches_ts() {
    let f: File = serde_json::from_str(include_str!("fixtures/security_lifecycle.json")).unwrap();
    for c in &f.fnv { assert_eq!(fnv1a(&c.s), c.expected, "fnv1a({:?})", c.s); }
    for c in &f.alias { assert_eq!(canonical_rule_id(&c.id), c.expected, "canonical_rule_id({:?})", c.id); }
    for c in &f.sev {
        let base = Finding { engine: EngineId::Matrix, severity: sev_from(&c.sev), rule_id: "x".into(), oracle: "o".into(),
            title: String::new(), path: String::new(), evidence: String::new(), method: None, endpoint: None, identity: None };
        let ov = c.ov.as_deref().and_then(sev_opt);
        assert_eq!(effective_severity(&base, ov), sev_from(&c.expected), "effective_severity {:?}/{:?}", c.sev, c.ov);
    }
}
