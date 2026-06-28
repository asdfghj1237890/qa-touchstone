use qa_touchstone_core::executor::ExecOptions;
use qa_touchstone_core::step::run_step;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn run_step_executes_and_asserts() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/x"))
        .respond_with(ResponseTemplate::new(200).set_body_string("{\"id\":1}"))
        .mount(&server)
        .await;
    let rd =
        json!({ "request": { "method":"GET", "url": format!("{}/x", server.uri()), "header": [] }});
    let assertions = vec![json!({"type":"status","op":"eq","value":200})];
    let step = run_step(&rd, &assertions, ExecOptions::default()).await;
    assert!(step.success);
    assert_eq!(step.status, 200);
    assert!(step.error.is_none());
    // headers/body are the SP1-2 reporter inputs (send's --json responseHeaders/body):
    // body is try_parse'd JSON; headers is populated (non-null) on success.
    assert_eq!(step.body, json!({"id":1}));
    assert!(!step.headers.is_null());
    assert_eq!(step.results.len(), 1);
    assert_eq!(step.results[0]["pass"], json!(true));
}

#[tokio::test]
async fn run_step_reports_error_without_assertions() {
    let rd = json!({ "request": { "method":"GET", "url":"not a url", "header": [] }});
    let assertions = vec![json!({"type":"status","op":"eq","value":200})];
    let step = run_step(&rd, &assertions, ExecOptions::default()).await;
    assert!(!step.success);
    assert!(step.error.is_some());
    assert!(step.results.is_empty());
}
