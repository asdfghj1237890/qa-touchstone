use qa_touchstone_core::security::ratelimit::*;

#[derive(serde::Deserialize)]
struct File {
    cases: Vec<Case>,
    classify: Vec<ClassifyCase>,
    severity: Vec<SevCase>,
}

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    responses: Vec<BurstResponse>,
    detect: DetectExp,
    analyze: AnalyzeExp,
    strength: String,
}

#[derive(serde::Deserialize)]
struct DetectExp {
    throttled: bool,
    saw429: bool,
    #[serde(rename = "headerHit")]
    header_hit: bool,
}

#[derive(serde::Deserialize)]
struct AnalyzeExp {
    completed: i64,
    ok2xx: i64,
    c429: i64,
    saw429: bool,
    #[serde(rename = "headerHit")]
    header_hit: bool,
    throttled: bool,
    #[serde(rename = "firstThrottledIndex")]
    first_throttled_index: i64,
    #[serde(rename = "allowedBeforeThrottle")]
    allowed_before_throttle: i64,
}

#[derive(serde::Deserialize)]
struct ClassifyCase {
    throttled: bool,
    completed: i64,
    expected: String,
}

#[derive(serde::Deserialize)]
struct SevCase {
    sensitivity: Option<String>,
    verdict: String,
    expected: Option<String>,
}

fn strength_str(s: Strength) -> &'static str {
    match s {
        Strength::None => "none",
        Strength::Weak => "weak",
        Strength::Strong => "strong",
    }
}
fn verdict_str(v: RateLimitVerdict) -> &'static str {
    match v {
        RateLimitVerdict::Pass => "pass",
        RateLimitVerdict::Vuln => "vuln",
        RateLimitVerdict::Inconclusive => "inconclusive",
    }
}
fn sev_str(s: Severity) -> &'static str {
    match s {
        Severity::Critical => "critical",
        Severity::High => "high",
        Severity::Medium => "medium",
        Severity::Low => "low",
        Severity::Info => "info",
    }
}
fn verdict_from(s: &str) -> RateLimitVerdict {
    match s {
        "pass" => RateLimitVerdict::Pass,
        "vuln" => RateLimitVerdict::Vuln,
        _ => RateLimitVerdict::Inconclusive,
    }
}
use qa_touchstone_core::security::finding::Severity;

#[test]
fn ratelimit_matches_ts() {
    let f: File = serde_json::from_str(include_str!("fixtures/security_ratelimit.json")).unwrap();
    for c in &f.cases {
        let d = detect_throttle_signal(&c.responses);
        assert_eq!(
            (d.throttled, d.saw429, d.header_hit),
            (c.detect.throttled, c.detect.saw429, c.detect.header_hit),
            "detect `{}`",
            c.name
        );
        let a = analyze_throttle(&c.responses);
        assert_eq!(
            a.completed, c.analyze.completed,
            "analyze.completed `{}`",
            c.name
        );
        assert_eq!(a.ok2xx, c.analyze.ok2xx, "analyze.ok2xx `{}`", c.name);
        assert_eq!(a.c429, c.analyze.c429, "analyze.c429 `{}`", c.name);
        assert_eq!(a.saw429, c.analyze.saw429, "analyze.saw429 `{}`", c.name);
        assert_eq!(
            a.header_hit, c.analyze.header_hit,
            "analyze.headerHit `{}`",
            c.name
        );
        assert_eq!(
            a.throttled, c.analyze.throttled,
            "analyze.throttled `{}`",
            c.name
        );
        assert_eq!(
            a.first_throttled_index, c.analyze.first_throttled_index,
            "analyze.firstThrottledIndex `{}`",
            c.name
        );
        assert_eq!(
            a.allowed_before_throttle, c.analyze.allowed_before_throttle,
            "analyze.allowedBeforeThrottle `{}`",
            c.name
        );
        assert_eq!(
            strength_str(rate_limit_strength(&a)),
            c.strength,
            "strength `{}`",
            c.name
        );
    }
    for c in &f.classify {
        assert_eq!(
            verdict_str(classify_rate_limit(c.throttled, c.completed)),
            c.expected,
            "classify"
        );
    }
    for c in &f.severity {
        let got = rate_limit_severity(c.sensitivity.as_deref(), verdict_from(&c.verdict))
            .map(|s| sev_str(s).to_string());
        assert_eq!(
            got, c.expected,
            "severity {:?}/{}",
            c.sensitivity, c.verdict
        );
    }
}
