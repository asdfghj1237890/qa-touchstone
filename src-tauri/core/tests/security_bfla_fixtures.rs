use qa_touchstone_core::security::bfla::{bfla_plan, classify_bfla, bfla_severity, BflaEndpoint, BflaIdentity};
use qa_touchstone_core::security::authz::Verdict;
use qa_touchstone_core::security::finding::Severity;
use serde_json::Value;

#[derive(serde::Deserialize)]
struct File {
    #[serde(rename = "denySet")] deny_set: Vec<i64>,
    plan: Vec<[String; 2]>,
    classify: Vec<ClassifyCase>,
    severity: Vec<SeverityCase>,
}

#[derive(serde::Deserialize)]
struct ClassifyCase {
    name: String,
    status: Option<i64>,
    body: Value,
    #[serde(rename = "denySet")] deny_set: Vec<i64>,
    expected: String,
}

#[derive(serde::Deserialize)]
struct SeverityCase {
    name: String,
    method: String,
    verdict: String,
    expected: Option<String>,
}

fn verdict_str(v: Verdict) -> &'static str {
    match v {
        Verdict::Pass => "pass",
        Verdict::Fail => "fail",
        Verdict::Vuln => "vuln",
        Verdict::Inconclusive => "inconclusive",
    }
}

fn severity_str(s: Severity) -> &'static str {
    match s {
        Severity::Info => "info",
        Severity::Low => "low",
        Severity::Medium => "medium",
        Severity::High => "high",
        Severity::Critical => "critical",
    }
}

fn parse_verdict(s: &str) -> Verdict {
    match s {
        "pass" => Verdict::Pass,
        "fail" => Verdict::Fail,
        "vuln" => Verdict::Vuln,
        "inconclusive" => Verdict::Inconclusive,
        other => panic!("unknown verdict `{other}`"),
    }
}

#[test]
fn bfla_matches_ts() {
    let f: File = serde_json::from_str(include_str!("fixtures/security_bfla.json")).unwrap();

    // ── plan: ordered Vec compare (endpoint-major / identity-minor) ──
    let endpoints = vec![
        BflaEndpoint { method: "DELETE".into(), path: "/admin/x".into(), privileged: None },
        BflaEndpoint { method: "GET".into(),    path: "/admin/y".into(), privileged: None },
        BflaEndpoint { method: "GET".into(),    path: "/u".into(),       privileged: Some(true) },
        BflaEndpoint { method: "DELETE".into(), path: "/v".into(),       privileged: Some(false) },
        BflaEndpoint { method: "GET".into(),    path: "/w".into(),       privileged: None },
    ];
    let identities = vec![
        BflaIdentity { id: "admin".into(), privileged: true },
        BflaIdentity { id: "anon".into(),  privileged: false },
        BflaIdentity { id: "user".into(),  privileged: false },
    ];
    let plan = bfla_plan(&endpoints, &identities);
    // Map index pairs to ["{method} {path}", "{identityId}"] tuples for comparison.
    let got_tuples: Vec<[String; 2]> = plan.iter().map(|p| {
        let ep = &endpoints[p.endpoint_index];
        let id = &identities[p.identity_index];
        [format!("{} {}", ep.method, ep.path), id.id.clone()]
    }).collect();
    assert_eq!(got_tuples, f.plan, "bfla_plan order must match TS bflaPlan order");

    // ── classify ──
    for c in &f.classify {
        let got = verdict_str(classify_bfla(c.status, &c.body, &c.deny_set));
        assert_eq!(got, c.expected, "classify case `{}`", c.name);
    }

    // ── severity ──
    for c in &f.severity {
        let verdict = parse_verdict(&c.verdict);
        let got = bfla_severity(&c.method, verdict).map(severity_str);
        assert_eq!(got.as_deref(), c.expected.as_deref(), "severity case `{}`", c.name);
    }
}
