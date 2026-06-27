use qa_touchstone_core::config::IdLocation;
use qa_touchstone_core::security::fuzz::{
    classify_fuzz_response, fuzz_cases_for, fuzz_finding, FuzzSignal, FUZZ_PAYLOADS,
    QaResponse,
};
use qa_touchstone_core::security::finding::Severity;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

/// Wire-format for one classify verdict from the TS fixture.
#[derive(Deserialize, Debug)]
struct TsVerdict {
    signal: String,
    severity: Option<String>,
}

/// Wire-format for one fuzz_finding from the TS fixture (nullable).
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct TsFinding {
    rule_id: Option<String>,
    severity: Option<String>,
    oracle: Option<String>,
    title: Option<String>,
    path: Option<String>,
    evidence: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct File {
    classify: HashMap<String, TsVerdict>,
    findings: HashMap<String, Option<TsFinding>>,
    cases_length: usize,   // top-level `casesLength`; "fuzz_cases_for returns 12" — NOT a classify entry
}

fn severity_str(s: Severity) -> &'static str {
    match s { Severity::Info=>"info", Severity::Low=>"low", Severity::Medium=>"medium", Severity::High=>"high", Severity::Critical=>"critical" }
}
fn signal_str(s: FuzzSignal) -> &'static str {
    match s { FuzzSignal::ServerError=>"server-error", FuzzSignal::ErrorLeak=>"error-leak", FuzzSignal::Reflected=>"reflected", FuzzSignal::Ok=>"ok" }
}

fn resp(status: i64, body: Value) -> QaResponse { QaResponse { status: Some(status), body } }
fn resp_str(status: i64, s: &str) -> QaResponse { resp(status, Value::String(s.to_string())) }

#[test]
fn fuzz_matches_ts() {
    let f: File = serde_json::from_str(include_str!("fixtures/security_fuzz.json")).unwrap();
    let loc = IdLocation::Query { key: "id".into() };

    // ── classify cases ──
    let xss_payload    = FUZZ_PAYLOADS.iter().find(|p| p.id == "xss").unwrap();
    let sqli_payload   = FUZZ_PAYLOADS.iter().find(|p| p.id == "sqli").unwrap();
    let long_payload   = FUZZ_PAYLOADS.iter().find(|p| p.id == "long").unwrap();
    let empty_payload  = FUZZ_PAYLOADS.iter().find(|p| p.id == "empty").unwrap();

    let classify_cases: Vec<(&str, Option<&qa_touchstone_core::security::fuzz::FuzzPayload>, QaResponse)> = vec![
        ("server-error",        Some(long_payload),   resp_str(500, "")),
        // NOTE: JS stack trace pattern requires no space before parens: "at fn(file:line)"
        ("error-leak-js",       Some(sqli_payload),   resp_str(200, "    at Object.fn(app.js:10:3)")),
        ("error-leak-python",   Some(sqli_payload),   resp_str(200, "Traceback (most recent call last):")),
        ("error-leak-sql",      Some(sqli_payload),   resp_str(200, r#"You have an error in your SQL syntax near "1": syntax error"#)),
        ("error-leak-jvm",      Some(sqli_payload),   resp_str(200, "java.lang.NullPointerException")),
        ("error-leak-dotnet",   Some(sqli_payload),   resp_str(200, "System.NullReferenceException")),
        ("error-leak-php",      Some(sqli_payload),   resp_str(200, "<b>Fatal error</b>: Uncaught")),
        ("error-leak-go",       Some(sqli_payload),   resp_str(200, "goroutine 1 [running],")),
        ("error-leak-node",     Some(sqli_payload),   resp_str(200, "UnhandledPromiseRejection")),
        ("reflected-xss",       Some(xss_payload),    resp_str(200, &format!("<div>{}</div>", xss_payload.value))),
        ("reflected-sqli",      Some(sqli_payload),   resp_str(200, &format!("echo: {}", sqli_payload.value))),
        ("benign-echo",         Some(empty_payload),  resp_str(200, "")),
        ("clean-400",           Some(sqli_payload),   resp(400, serde_json::json!({"error":"invalid id"}))),
    ];
    for (name, payload, response) in &classify_cases {
        let expected = f.classify.get(*name).unwrap_or_else(|| panic!("missing classify case `{name}` in fixture"));
        let got = classify_fuzz_response(payload.as_deref(), Some(response));
        assert_eq!(signal_str(got.signal), expected.signal.as_str(), "classify case `{name}`: signal mismatch");
        assert_eq!(got.severity.map(severity_str), expected.severity.as_deref(), "classify case `{name}`: severity mismatch");
    }

    // ── cases-length: fuzz_cases_for returns 12 ──
    let cases: Vec<_> = fuzz_cases_for("id", &loc).collect();
    assert_eq!(cases.len(), f.cases_length, "fuzz_cases_for must return exactly {} cases", f.cases_length);

    // ── fuzz_finding cases ──
    // finding-server-error
    let long_case = fuzz_cases_for("id", &loc).find(|c| c.payload.id == "long").unwrap();
    let got_500 = fuzz_finding("GET", "/items", &long_case, Some(&resp_str(500, "")));
    let exp_500 = f.findings["finding-server-error"].as_ref().expect("finding-server-error must not be null");
    assert_eq!(got_500.as_ref().map(|f| f.rule_id.as_str()), exp_500.rule_id.as_deref(), "finding-server-error ruleId");
    assert_eq!(got_500.as_ref().map(|f| severity_str(f.severity)), exp_500.severity.as_deref(), "finding-server-error severity");
    assert_eq!(got_500.as_ref().map(|f| f.path.as_str()), exp_500.path.as_deref(), "finding-server-error path");

    // finding-reflected-xss
    let xss_case = fuzz_cases_for("id", &loc).find(|c| c.payload.id == "xss").unwrap();
    let xss_body = format!("<div>{}</div>", xss_case.payload.value);
    let got_xss = fuzz_finding("GET", "/items", &xss_case, Some(&resp_str(200, &xss_body)));
    let exp_xss = f.findings["finding-reflected-xss"].as_ref().expect("finding-reflected-xss must not be null");
    assert_eq!(got_xss.as_ref().map(|f| f.rule_id.as_str()), exp_xss.rule_id.as_deref(), "finding-reflected-xss ruleId");
    assert_eq!(got_xss.as_ref().map(|f| severity_str(f.severity)), exp_xss.severity.as_deref(), "finding-reflected-xss severity");

    // finding-clean-null must be None
    let sqli_case = fuzz_cases_for("id", &loc).find(|c| c.payload.id == "sqli").unwrap();
    let got_clean = fuzz_finding("GET", "/items", &sqli_case, Some(&resp(200, serde_json::json!({"ok":true}))));
    assert!(got_clean.is_none(), "clean response must produce no finding");
}
