use qa_touchstone_core::executor::execute_request;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

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
    let out = execute_request(&request_details, &json!({}), None, None, None, None, None).await;

    assert_eq!(out["success"], json!(true));
    assert_eq!(out["status"], json!(200));
    assert_eq!(out["body"], json!("{\"ok\":true}"));
    let cookies = out["setCookies"].as_array().expect("setCookies array");
    assert!(
        cookies.iter().any(|c| c["line"].as_str().unwrap_or("").contains("sid=abc")),
        "expected captured Set-Cookie, got {cookies:?}"
    );
}

// An invalid URL must return the structured failure Value, not panic.
#[tokio::test]
async fn invalid_url_returns_error_value() {
    let request_details = json!({ "request": { "method": "GET", "url": "not a url", "header": [] } });
    let out = execute_request(&request_details, &json!({}), None, None, None, None, None).await;
    assert_eq!(out["success"], json!(false));
    assert!(out["error"].as_str().unwrap_or("").to_lowercase().contains("url"));
}
