use qa_touchstone_core::executor::{execute_request, ExecOptions};
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

// A 302 to a same-origin target: the executor must follow it (Policy::none +
// manual hop loop) and return the final 200 body, plus capture the Set-Cookie
// emitted on the first hop.
#[tokio::test]
async fn follows_redirect_and_captures_set_cookie() {
    let server = MockServer::start().await;
    let dest = format!("{}/final", server.uri());

    Mock::given(method("GET"))
        .and(path("/start"))
        .respond_with(
            ResponseTemplate::new(302)
                .insert_header("location", dest.as_str())
                .insert_header("set-cookie", "sid=abc; Path=/"),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/final"))
        .respond_with(ResponseTemplate::new(200).set_body_string("{\"ok\":true}"))
        .mount(&server)
        .await;

    let request_details = json!({
        "request": { "method": "GET", "url": format!("{}/start", server.uri()), "header": [] }
    });
    let out = execute_request(
        &request_details,
        &json!({}),
        None,
        None,
        ExecOptions::default(),
    )
    .await;

    assert_eq!(out["success"], json!(true));
    assert_eq!(out["status"], json!(200));
    assert_eq!(out["body"], json!("{\"ok\":true}"));
    let cookies = out["setCookies"].as_array().expect("setCookies array");
    assert!(
        cookies
            .iter()
            .any(|c| c["line"].as_str().unwrap_or("").contains("sid=abc")),
        "expected captured Set-Cookie, got {cookies:?}"
    );
}

// An invalid URL must return the structured failure Value, not panic.
#[tokio::test]
async fn invalid_url_returns_error_value() {
    let request_details =
        json!({ "request": { "method": "GET", "url": "not a url", "header": [] } });
    let out = execute_request(
        &request_details,
        &json!({}),
        None,
        None,
        ExecOptions::default(),
    )
    .await;
    assert_eq!(out["success"], json!(false));
    assert!(out["error"]
        .as_str()
        .unwrap_or("")
        .to_lowercase()
        .contains("url"));
}

// Matcher that only accepts requests that do NOT carry an X-API-Key header.
// Used as the server-B endpoint in the cross-origin strip test below.
struct NoApiKey;
impl wiremock::Match for NoApiKey {
    fn matches(&self, req: &Request) -> bool {
        !req.headers.contains_key("x-api-key")
    }
}

// Positive control: when ExecOptions::sensitive_header_names includes "X-API-Key",
// the executor must strip it before the cross-origin hop → server B sees no header
// → the NoApiKey matcher passes → 200.
//
// Negative control: same setup, but sensitive_header_names is empty → the header IS
// forwarded → the NoApiKey matcher rejects it → wiremock falls through to its
// unmatched-request default → 404. This confirms the test is meaningful.
#[tokio::test]
async fn cross_origin_strips_caller_marked_header() {
    // Server A: 302 to server B.
    let server_a = MockServer::start().await;
    // Server B: only matches when X-API-Key is absent.
    let server_b = MockServer::start().await;

    let dest = format!("{}/end", server_b.uri());

    Mock::given(method("GET"))
        .and(path("/start"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", dest.as_str()))
        .mount(&server_a)
        .await;

    Mock::given(method("GET"))
        .and(path("/end"))
        .and(NoApiKey)
        .respond_with(ResponseTemplate::new(200).set_body_string("ok"))
        .mount(&server_b)
        .await;

    let request_details = json!({
        "request": {
            "method": "GET",
            "url": format!("{}/start", server_a.uri()),
            "header": [{ "key": "X-API-Key", "value": "secret" }]
        }
    });

    // Positive: header marked sensitive → stripped → B matches → 200.
    let out = execute_request(
        &request_details,
        &json!({}),
        None,
        None,
        ExecOptions {
            sensitive_header_names: vec!["X-API-Key".into()],
            ..Default::default()
        },
    )
    .await;
    assert_eq!(
        out["status"],
        json!(200),
        "expected 200 (header stripped cross-origin), got: {out:?}"
    );

    // Negative: header not marked → forwarded → NoApiKey rejects → wiremock 404.
    let out2 = execute_request(
        &request_details,
        &json!({}),
        None,
        None,
        ExecOptions::default(),
    )
    .await;
    assert_eq!(
        out2["status"],
        json!(404),
        "expected 404 (header forwarded → no mock match), got: {out2:?}"
    );
}
