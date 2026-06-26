use qa_touchstone_core::security::finding::{EngineId, Severity};
use qa_touchstone_core::security::lifecycle::SnapshotItem;
use qa_touchstone_core::security::report::*;
use serde_json::Value;
use roxmltree;

fn item(fp: &str, sev: Severity, eng: EngineId, rule: &str, loc: &str, title: &str) -> SnapshotItem {
    SnapshotItem {
        fp: fp.into(),
        effective_severity: sev,
        engine: eng,
        rule_id: rule.into(),
        path: String::new(),
        location_label: loc.into(),
        title: title.into(),
        evidence: String::new(),
        dfp: String::new(),
        count: 1,
    }
}

#[derive(serde::Deserialize)]
struct File {
    sarif: Value,
    junit: String,
    #[serde(rename = "sevLevel")]
    sev_level: Vec<SevLevel>,
}

#[derive(serde::Deserialize)]
struct SevLevel {
    s: String,
    expected: String,
}

#[test]
fn report_sarif_matches_ts() {
    let f: File =
        serde_json::from_str(include_str!("fixtures/security_report.json")).unwrap();
    let cur = vec![
        item(
            "aa",
            Severity::High,
            EngineId::Bola,
            "bola.cross-object",
            "GET getOrder @t1: alice\u{2192}bob",
            "Cross-object access confirmed",
        ),
        item(
            "bb",
            Severity::Critical,
            EngineId::Matrix,
            "matrix.deny-bypass",
            "DELETE delU @anon",
            "Access-control bypass",
        ),
    ];
    let base = vec![item(
        "bb",
        Severity::Critical,
        EngineId::Matrix,
        "matrix.deny-bypass",
        "DELETE delU @anon",
        "Access-control bypass",
    )];
    let model = build_report(&cur, &base, vec![], Severity::High, false, "r");
    let got: Value = serde_json::from_str(&report_to_sarif(&model)).unwrap();
    assert_eq!(
        got,
        f.sarif,
        "SARIF must match the TS reportToSarif (semantic JSON)\nGot:\n{}\nExpected:\n{}",
        serde_json::to_string_pretty(&got).unwrap(),
        serde_json::to_string_pretty(&f.sarif).unwrap()
    );
    for c in &f.sev_level {
        let s = match c.s.as_str() {
            "critical" => Severity::Critical,
            "high" => Severity::High,
            "medium" => Severity::Medium,
            "low" => Severity::Low,
            _ => Severity::Info,
        };
        assert_eq!(sev_to_sarif_level(s), c.expected);
    }

    // JUnit (fail_on=High; same model/cur/base as the SARIF assert above).
    let rust_junit = report_to_junit(&model);
    let ts = roxmltree::Document::parse(&f.junit).unwrap();
    let rs = roxmltree::Document::parse(&rust_junit).unwrap();
    let names = |d: &roxmltree::Document| d.descendants().filter(|n| n.has_tag_name("testcase"))
        .map(|n| (n.attribute("name").unwrap_or("").to_string(),
                  n.descendants().any(|c| c.has_tag_name("failure")))).collect::<Vec<_>>();
    assert_eq!(names(&rs), names(&ts), "JUnit testcases (name + has-failure) match TS at fail_on=high");
    let suites = |d: &roxmltree::Document| d.descendants().filter(|n| n.has_tag_name("testsuite"))
        .map(|n| n.attribute("name").unwrap_or("").to_string()).collect::<Vec<_>>();
    assert_eq!(suites(&rs), suites(&ts), "suite order/names match TS");
}
