use qa_touchstone_core::config::load_config;
use qa_touchstone_core::security::bola::run_bola;
use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

// Server returns {"id":"<2nd path segment>","secret":"..."} — i.e. it echoes the object id from the path,
// and is NOT object-scoped by identity (any caller gets any id's object) → a real BOLA hole.
async fn idor_server() -> MockServer {
    let s = MockServer::start().await;
    Mock::given(method("GET")).respond_with(|req: &wiremock::Request| {
        let seg = req.url.path_segments().and_then(|mut p| { p.next(); p.next() }).unwrap_or("").to_string(); // 2nd segment = id
        ResponseTemplate::new(200).set_body_string(format!("{{\"id\":\"{}\",\"data\":\"x\"}}", seg))
    }).mount(&s).await;
    s
}

fn cfg(base: &str, neg: bool) -> String {
    format!(r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"alice","auth":{{"type":"none"}}}},{{"id":"bob","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"getOrder","method":"GET","url":"{base}/orders/PLACEHOLDER"}}],
      "security":{{"bola":{{"tests":[{{"id":"t1","request":"getOrder","idLocation":{{"kind":"path","index":1}},
        "idValues":{{"alice":"ordA","bob":"ordB"}},"negativeControl":{neg}}}]}}}} }}"#)
}

#[tokio::test]
async fn bola_flags_cross_object() {
    let s = idor_server().await;
    let c = load_config(&cfg(&s.uri(), false), &|_| None).unwrap();
    let (findings, errors) = run_bola(&c, None).await;
    assert!(errors.is_empty(), "{errors:?}");
    // alice→bob (gets ordB) and bob→alice (gets ordA): both confirmed cross-object → 2 vuln findings.
    assert_eq!(findings.len(), 2);
    assert!(findings.iter().all(|f| f.rule_id == "bola.cross-object"));
    // idValue never leaks into evidence
    assert!(findings.iter().all(|f| !f.evidence.contains("ordA") && !f.evidence.contains("ordB")));
}

#[tokio::test]
async fn bola_denied_is_pass() {
    let s = MockServer::start().await;
    Mock::given(method("GET")).respond_with(ResponseTemplate::new(403)).mount(&s).await;
    let c = load_config(&cfg(&s.uri(), false), &|_| None).unwrap();
    let (findings, _e) = run_bola(&c, None).await;
    assert!(findings.is_empty(), "403 on attack → pass (no finding)");
}

#[tokio::test]
async fn bola_negative_control_demotes() {
    // Server ignores the id entirely (always returns ordA's object) → not object-scoped →
    // the synthetic-id control returns the owner's object → controlFailed → attacks demoted (no findings).
    let s = MockServer::start().await;
    Mock::given(method("GET")).respond_with(ResponseTemplate::new(200).set_body_string("{\"id\":\"ordA\",\"data\":\"x\"}")).mount(&s).await;
    let c = load_config(&cfg(&s.uri(), true), &|_| None).unwrap();
    let (findings, _e) = run_bola(&c, None).await;
    assert!(findings.is_empty(), "negative control failed → demoted to inconclusive");
}

#[tokio::test]
async fn bola_skips_under_two_owners() {
    let s = MockServer::start().await;
    Mock::given(method("GET")).respond_with(ResponseTemplate::new(200)).mount(&s).await;
    let one = format!(r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"alice","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"getOrder","method":"GET","url":"{base}/orders/x"}}],
      "security":{{"bola":{{"tests":[{{"id":"t1","request":"getOrder","idLocation":{{"kind":"path","index":1}},"idValues":{{"alice":"ordA"}}}}]}}}} }}"#, base=s.uri());
    let c = load_config(&one, &|_| None).unwrap();
    let (findings, errors) = run_bola(&c, None).await;
    assert!(findings.is_empty() && errors.is_empty(), "skipped (warn), not a finding/error");
}

#[tokio::test]
async fn bola_templated_url_resolves() {
    // The codex finding: a TEMPLATED url must work (substitute-first before apply_id_location Path).
    let s = idor_server().await;
    let c = format!(r#"{{ "version":1,
      "environments":[{{"name":"e","variables":{{"apiHost":"{base}"}}}}],
      "identities":[{{"id":"alice","auth":{{"type":"none"}}}},{{"id":"bob","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"getOrder","method":"GET","url":"{{{{apiHost}}}}/orders/PLACEHOLDER"}}],
      "security":{{"bola":{{"tests":[{{"id":"t1","request":"getOrder","idLocation":{{"kind":"path","index":1}},
        "idValues":{{"alice":"ordA","bob":"ordB"}}}}]}}}} }}"#, base=s.uri());
    let cc = load_config(&c, &|_| None).unwrap();
    let (findings, errors) = run_bola(&cc, Some("e")).await;
    assert!(errors.is_empty(), "templated url must resolve, not error: {errors:?}");
    assert_eq!(findings.len(), 2, "cross-object confirmed on a templated-URL config");
}
