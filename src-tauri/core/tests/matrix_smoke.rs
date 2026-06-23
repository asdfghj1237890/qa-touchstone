use qa_touchstone_core::config::load_config;
use qa_touchstone_core::security::runner::run_matrix;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn matrix_flags_deny_bypass() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/secret")).respond_with(ResponseTemplate::new(200).set_body_string("{\"ok\":1}")).mount(&server).await;
    let cfg = format!(r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"sec","method":"GET","url":"{base}/secret"}}],
      "security":{{"matrix":{{"endpoints":["sec"]}}}} }}"#, base=server.uri());
    let c = load_config(&cfg, &|_| None).unwrap();
    let findings = run_matrix(&c, None).await;
    assert_eq!(findings.len(), 1, "anon defaults to deny; 200 → vuln");
    assert_eq!(findings[0].rule_id, "matrix.deny-bypass");
    assert_eq!(findings[0].severity, qa_touchstone_core::security::finding::Severity::High);
}

#[tokio::test]
async fn matrix_soft_deny_is_pass() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/secret")).respond_with(ResponseTemplate::new(200).set_body_string("{\"error\":\"Access denied\"}")).mount(&server).await;
    let cfg = format!(r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"sec","method":"GET","url":"{base}/secret"}}],
      "security":{{"matrix":{{"endpoints":["sec"]}}}} }}"#, base=server.uri());
    let c = load_config(&cfg, &|_| None).unwrap();
    assert!(run_matrix(&c, None).await.is_empty(), "soft-deny 200 → denied → pass (no finding)");
}

#[tokio::test]
async fn matrix_hard_deny_is_pass() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/secret")).respond_with(ResponseTemplate::new(403)).mount(&server).await;
    let cfg = format!(r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"sec","method":"GET","url":"{base}/secret"}}],
      "security":{{"matrix":{{"endpoints":["sec"]}}}} }}"#, base=server.uri());
    let c = load_config(&cfg, &|_| None).unwrap();
    assert!(run_matrix(&c, None).await.is_empty(), "403 default-deny-set → denied → pass");
}
