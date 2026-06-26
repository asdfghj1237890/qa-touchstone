use qa_touchstone_core::security::oracles::*;
use serde_json::{json, Value};

#[derive(serde::Deserialize)]
struct File { sensitive: Vec<SensCase>, redact: Vec<RedactCase>, schema: Vec<SensCase>, #[serde(rename="runBump")] run_bump: Vec<ExpF2> }
#[derive(serde::Deserialize)]
struct SensCase { name: String, findings: Vec<ExpF> }
#[derive(serde::Deserialize, Clone)]
struct ExpF { #[serde(rename="ruleId")] rule_id: String, oracle: String, severity: String, #[serde(default)] title: String, path: String, evidence: String }
#[derive(serde::Deserialize)]
struct ExpF2 { #[serde(rename="ruleId")] rule_id: String, oracle: String, severity: String, path: String }
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
        "secret_null" => (json!({"password":null}), json!({})),
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
fn schema_body(name: &str) -> Value {
    match name {
        "undeclared" => json!({"id":1,"name":"a","tags":["x"],"extra":true}),
        "type_mismatch" => json!({"id":"1","name":"a","tags":["x"]}),
        "missing" => json!({"id":1,"tags":["x"]}),
        "nullable_tol" => json!({"id":null,"name":"a","tags":["x"]}),
        _ => Value::Null,
    }
}

#[test]
fn oracles_sensitive_matches_ts() {
    let f: File = serde_json::from_str(include_str!("fixtures/security_oracles.json")).unwrap();
    for c in &f.redact { assert_eq!(redact(&c.s), c.expected, "redact `{}`", c.s); }
    for c in &f.sensitive {
        let (body, headers) = resp_for(&c.name);
        let fs = scan_sensitive(&body, &headers, &OracleConfig::default());
        // SET compare on (ruleId, oracle, severity, title, evidence) — order-insensitive
        let mut got: Vec<(String,String,String,String,String)> = fs.iter().map(|x| (x.rule_id.clone(), x.oracle.clone(), sev_str(x.severity).to_string(), x.title.clone(), x.evidence.clone())).collect();
        let mut want: Vec<(String,String,String,String,String)> = c.findings.iter().map(|e| (e.rule_id.clone(), e.oracle.clone(), e.severity.clone(), e.title.clone(), e.evidence.clone())).collect();
        got.sort(); want.sort();
        assert_eq!(got, want, "sensitive `{}` (ruleId/oracle/severity/title/evidence set)", c.name);
        // path parity EXCEPT secret_as_key (Rust masks the secret-key in path; TS does not — unit-covered)
        if c.name != "secret_as_key" {
            let mut gp: Vec<String> = fs.iter().map(|x| x.path.clone()).collect();
            let mut wp: Vec<String> = c.findings.iter().map(|e| e.path.clone()).collect();
            gp.sort(); wp.sort();
            assert_eq!(gp, wp, "sensitive `{}` paths", c.name);
        }
    }
}

#[test]
fn oracles_schema_matches_ts() {
    let f: File = serde_json::from_str(include_str!("fixtures/security_oracles.json")).unwrap();
    let contract = infer_contract(&json!({"id":1,"name":"a","tags":["x"]}));
    for c in &f.schema {
        let body = schema_body(&c.name);
        let mut got: Vec<(String,String,String,String,String)> = check_schema(&body, &contract, &OracleConfig::default())
            .iter().map(|x| (x.rule_id.clone(), x.oracle.clone(), sev_str(x.severity).to_string(), x.title.clone(), x.path.clone())).collect();
        let mut want: Vec<(String,String,String,String,String)> = c.findings.iter()
            .map(|e| (e.rule_id.clone(), e.oracle.clone(), e.severity.clone(), e.title.clone(), e.path.clone())).collect();
        got.sort(); want.sort();
        assert_eq!(got, want, "schema `{}`", c.name);
    }
    // runOracles golden compare (locks the undeclared→high bump against TS)
    let rb_got: Vec<(String,String,String,String)> = {
        let mut v: Vec<_> = run_oracles(200, &json!({"id":1,"name":"a","tags":["x"],"leak":"u@v.com"}), &json!({}), Some(&contract), &OracleConfig::default())
            .iter().map(|x| (x.rule_id.clone(), x.oracle.clone(), sev_str(x.severity).to_string(), x.path.clone())).collect();
        v.sort(); v
    };
    let rb_want: Vec<(String,String,String,String)> = {
        let mut v: Vec<_> = f.run_bump.iter().map(|e| (e.rule_id.clone(), e.oracle.clone(), e.severity.clone(), e.path.clone())).collect();
        v.sort(); v
    };
    assert_eq!(rb_got, rb_want, "runOracles bump (set)");
    assert!(rb_got.iter().any(|t| t.0=="schema:undeclared" && t.3=="leak" && t.2=="high"), "undeclared leak bumped to high");
}
