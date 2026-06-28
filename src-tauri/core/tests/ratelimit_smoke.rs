use qa_touchstone_core::config::load_config;
use qa_touchstone_core::security::ratelimit::run_ratelimit;
use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

fn cfg(base: &str, sensitivity: &str) -> String {
    format!(
        r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"login","method":"POST","url":"{base}/login"}}],
      "security":{{"rateLimit":{{"tests":[{{"id":"r1","request":"login","identity":"anon","n":8,"concurrency":2,"sensitivity":"{sensitivity}"}}]}}}} }}"#
    )
}

#[tokio::test]
async fn ratelimit_no_throttle_is_vuln() {
    let s = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&s)
        .await;
    let c = load_config(&cfg(&s.uri(), "sensitive"), &|_| None).unwrap();
    let (findings, errors) = run_ratelimit(&c, None).await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].rule_id, "ratelimit.none");
    assert_eq!(
        findings[0].severity,
        qa_touchstone_core::security::finding::Severity::High
    ); // sensitive
    assert!(findings[0].evidence.contains("no 429"));
}

#[tokio::test]
async fn ratelimit_429_is_strong_pass() {
    let s = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429))
        .mount(&s)
        .await;
    let c = load_config(&cfg(&s.uri(), "sensitive"), &|_| None).unwrap();
    let (findings, errors) = run_ratelimit(&c, None).await;
    assert!(errors.is_empty(), "{errors:?}");
    assert!(findings.is_empty(), "immediate 429 → strong → no finding");
}

#[tokio::test]
async fn ratelimit_all_net_errors_surfaces_error() {
    let c = load_config(r#"{ "version":1,"environments":[],
      "identities":[{"id":"anon","auth":{"type":"none"}}],
      "requests":[{"id":"login","method":"POST","url":"http://127.0.0.1:1/login"}],
      "security":{"rateLimit":{"tests":[{"id":"r1","request":"login","identity":"anon","n":3,"concurrency":2}]}} }"#, &|_| None).unwrap();
    let (findings, errors) = run_ratelimit(&c, None).await;
    assert!(findings.is_empty());
    assert!(
        !errors.is_empty(),
        "0 completed → an EngineError so scan won't report clean"
    );
}
