use qa_touchstone_core::security::oracles::*;
use serde_json::{json, Value};

#[derive(serde::Deserialize)]
struct File { sensitive: Vec<SensCase>, redact: Vec<RedactCase> }
#[derive(serde::Deserialize)]
struct SensCase { name: String, findings: Vec<ExpF> }
#[derive(serde::Deserialize, Clone)]
struct ExpF { #[serde(rename="ruleId")] rule_id: String, oracle: String, severity: String, path: String, evidence: String }
#[derive(serde::Deserialize)]
struct RedactCase { s: String, expected: String }

fn sev_str(s: qa_touchstone_core::security::finding::Severity) -> &'static str {
    use qa_touchstone_core::security::finding::Severity::*;
    match s { Critical=>"critical", High=>"high", Medium=>"medium", Low=>"low", Info=>"info" }
}
fn resp_for(name: &str) -> (Value, Value) { // (body, headers) — mirrors gen-fixtures inputs
    match name {
        "jwt" => (json!({"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEF"}), json!({})),
        "aws-key" => (json!({"key":"AKIAIOSFODNN7EXAMPLE"}), json!({})),
        "private-key" => (json!({"pem":"-----BEGIN RSA PRIVATE KEY-----xxxx"}), json!({})),
        "secret-name" => (json!({"password":"hunter2","other":"ok"}), json!({})),
        "email" => (json!({"contact":"user@example.com"}), json!({})),
        "card_luhn_ok" => (json!({"pan":"4111 1111 1111 1111"}), json!({})),
        "card_luhn_no" => (json!({"pan":"4111 1111 1111 1112"}), json!({})),
        "internal" => (json!({"stack_trace":"at x"}), json!({})),
        "leaky_header" => (json!({}), json!({"Server":"nginx/1.2"})),
        "secret_as_key" => (json!({"eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig123":"eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig123"}), json!({})),
        "dedup" => (json!({"a":{"email":"x@y.com"},"b":{"email":"x@y.com"}}), json!({})),
        _ => (Value::Null, json!({})),
    }
}

#[test]
fn oracles_sensitive_matches_ts() {
    let f: File = serde_json::from_str(include_str!("fixtures/security_oracles.json")).unwrap();
    for c in &f.redact { assert_eq!(redact(&c.s), c.expected, "redact `{}`", c.s); }
    for c in &f.sensitive {
        let (body, headers) = resp_for(&c.name);
        let fs = scan_sensitive(&body, &headers, &OracleConfig::default());
        // SET compare on (ruleId, oracle, severity, evidence) — order-insensitive
        let mut got: Vec<(String,String,String,String)> = fs.iter().map(|x| (x.rule_id.clone(), x.oracle.clone(), sev_str(x.severity).to_string(), x.evidence.clone())).collect();
        let mut want: Vec<(String,String,String,String)> = c.findings.iter().map(|e| (e.rule_id.clone(), e.oracle.clone(), e.severity.clone(), e.evidence.clone())).collect();
        got.sort(); want.sort();
        assert_eq!(got, want, "sensitive `{}` (ruleId/oracle/severity/evidence set)", c.name);
        // path parity EXCEPT secret_as_key (Rust masks the secret-key in path; TS does not — unit-covered)
        if c.name != "secret_as_key" {
            let mut gp: Vec<String> = fs.iter().map(|x| x.path.clone()).collect();
            let mut wp: Vec<String> = c.findings.iter().map(|e| e.path.clone()).collect();
            gp.sort(); wp.sort();
            assert_eq!(gp, wp, "sensitive `{}` paths", c.name);
        }
    }
}
