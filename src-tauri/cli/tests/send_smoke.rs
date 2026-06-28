//! Integration smoke tests for `qa-touchstone-ci send`.
//! Each test spins up a wiremock server, writes a temp config JSON, and drives
//! the real binary via `std::process::Command`.
//!
//! Env-var macro `CARGO_BIN_EXE_qa-touchstone-ci` is set by Cargo for integration
//! tests in the same crate, so no PATH lookup is needed.

use std::path::PathBuf;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Unique temp file path per caller (uses test name + process id to avoid
/// collisions when tests run in parallel).
fn tmp_config(tag: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("qa_tc_smoke_{}_{}.json", tag, std::process::id()));
    p
}

/// Write config JSON to `path` and return it (for use in `defer_remove`).
fn write_config(path: &PathBuf, content: &str) {
    std::fs::write(path, content).expect("write temp config");
}

/// Best-effort cleanup — failure is not fatal.
fn remove_config(path: &PathBuf) {
    let _ = std::fs::remove_file(path);
}

// ---------------------------------------------------------------------------
// Test 1: passing assertion → exit 0
// ---------------------------------------------------------------------------
/// A 200 stub + assertion `status eq 200` → all assertions pass → exit 0.
#[tokio::test]
async fn send_pass_exits_0() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/x"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_raw(r#"{"id":1}"#, "application/json"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/x", server.uri());
    let cfg_path = tmp_config("pass");
    let config_json = format!(
        r#"{{
  "version": 1,
  "environments": [],
  "identities": [{{ "id": "anon", "auth": {{ "type": "none" }} }}],
  "requests": [{{
    "id": "r",
    "method": "GET",
    "url": "{url}",
    "assertions": [{{ "type": "status", "op": "eq", "value": 200 }}]
  }}]
}}"#
    );
    write_config(&cfg_path, &config_json);

    let status = std::process::Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
        .args([
            "send",
            "--config",
            cfg_path.to_str().unwrap(),
            "--request",
            "r",
            "--identity",
            "anon",
        ])
        .status()
        .expect("spawn binary");

    remove_config(&cfg_path);
    assert_eq!(
        status.code(),
        Some(0),
        "exit 0 expected for all-pass assertions"
    );
}

// ---------------------------------------------------------------------------
// Test 2: failing assertion → exit 4
// ---------------------------------------------------------------------------
/// Stub returns 200, but we assert `status eq 201` → assertion fails → exit 4.
#[tokio::test]
async fn send_fail_assertion_exits_4() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/x"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_raw(r#"{"id":1}"#, "application/json"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/x", server.uri());
    let cfg_path = tmp_config("fail4");
    let config_json = format!(
        r#"{{
  "version": 1,
  "environments": [],
  "identities": [{{ "id": "anon", "auth": {{ "type": "none" }} }}],
  "requests": [{{
    "id": "r",
    "method": "GET",
    "url": "{url}",
    "assertions": [{{ "type": "status", "op": "eq", "value": 201 }}]
  }}]
}}"#
    );
    write_config(&cfg_path, &config_json);

    let status = std::process::Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
        .args([
            "send",
            "--config",
            cfg_path.to_str().unwrap(),
            "--request",
            "r",
            "--identity",
            "anon",
        ])
        .status()
        .expect("spawn binary");

    remove_config(&cfg_path);
    assert_eq!(
        status.code(),
        Some(4),
        "exit 4 expected for failed assertion (status eq 201 vs actual 200)"
    );
}

// ---------------------------------------------------------------------------
// Test 3: missing {env} variable → exit 2
// ---------------------------------------------------------------------------
/// Bearer identity references env var `NOPE` which is unset.
/// `load_config` must fail closed → exit 2 (invalid input).
#[tokio::test]
async fn send_missing_env_exits_2() {
    // No real server needed — config load must fail before any network access.
    // We still provide a placeholder URL so the JSON is syntactically valid.
    let cfg_path = tmp_config("env2");
    let config_json = r#"{
  "version": 1,
  "environments": [],
  "identities": [{ "id": "tok", "auth": { "type": "bearer", "token": { "env": "NOPE" } } }],
  "requests": [{
    "id": "r",
    "method": "GET",
    "url": "http://127.0.0.1:1/x",
    "assertions": []
  }]
}"#;
    write_config(&cfg_path, config_json);

    let status = std::process::Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
        .args([
            "send",
            "--config",
            cfg_path.to_str().unwrap(),
            "--request",
            "r",
            "--identity",
            "tok",
        ])
        // Explicitly unset NOPE (in case it's somehow set in CI)
        .env_remove("NOPE")
        .status()
        .expect("spawn binary");

    remove_config(&cfg_path);
    assert_eq!(
        status.code(),
        Some(2),
        "exit 2 expected when env var NOPE is unset (fail-closed secret resolution)"
    );
}

// ---------------------------------------------------------------------------
// Test 4: --json output does NOT contain the bearer token (secret redaction)
// ---------------------------------------------------------------------------
/// Run with a bearer identity whose token we supply via `SECRET_TOK=supersecret123`,
/// capture stdout with `--json`, and assert that `supersecret123` is absent.
#[tokio::test]
async fn send_json_no_secret_in_output() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/x"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_raw(r#"{"ok":true}"#, "application/json"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/x", server.uri());
    let cfg_path = tmp_config("json_redact");
    let config_json = format!(
        r#"{{
  "version": 1,
  "environments": [],
  "identities": [{{ "id": "tok", "auth": {{ "type": "bearer", "token": {{ "env": "SECRET_TOK" }} }} }}],
  "requests": [{{
    "id": "r",
    "method": "GET",
    "url": "{url}",
    "assertions": [{{ "type": "status", "op": "eq", "value": 200 }}]
  }}]
}}"#
    );
    write_config(&cfg_path, &config_json);

    let output = std::process::Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
        .args([
            "send",
            "--config",
            cfg_path.to_str().unwrap(),
            "--request",
            "r",
            "--identity",
            "tok",
            "--json",
        ])
        // Supply the secret via env var (resolved by load_config)
        .env("SECRET_TOK", "supersecret123")
        .output()
        .expect("spawn binary");

    remove_config(&cfg_path);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // The binary must succeed (exit 0) for this test to be meaningful.
    assert_eq!(
        output.status.code(),
        Some(0),
        "expected exit 0 for passing assertion; stderr: {stderr}"
    );

    // Core assertion: the secret value must NOT appear anywhere in stdout.
    assert!(
        !stdout.contains("supersecret123"),
        "bearer token 'supersecret123' must NOT appear in --json stdout; got:\n{stdout}"
    );

    // Sanity: stdout must be non-empty JSON-ish output (we did get a response).
    assert!(
        !stdout.trim().is_empty(),
        "stdout must be non-empty with --json"
    );

    // The status code should appear in the output (it's safe to include).
    assert!(
        stdout.contains("200"),
        "--json output should include the HTTP status 200; got:\n{stdout}"
    );
}

// ---------------------------------------------------------------------------
// Test 5: apiKey-in-query secret must not appear in --json url output
// ---------------------------------------------------------------------------
/// Identity is apikey in:query with value from env `QKEY=qsecret_abc123`.
/// Wiremock matches the path only (ignoring query params) → 200.
/// Run `send --json`. Assert exit 0 AND that `qsecret_abc123` is absent from stdout.
#[tokio::test]
async fn send_redacts_apikey_in_query_url() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/q"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_raw(r#"{"ok":true}"#, "application/json"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/q", server.uri());
    let cfg_path = tmp_config("apikey_query");
    let config_json = format!(
        r#"{{
  "version": 1,
  "environments": [],
  "identities": [{{
    "id": "keyid",
    "auth": {{
      "type": "apikey",
      "key": "api_key",
      "value": {{ "env": "QKEY" }},
      "in": "query"
    }}
  }}],
  "requests": [{{
    "id": "r",
    "method": "GET",
    "url": "{url}",
    "assertions": [{{ "type": "status", "op": "eq", "value": 200 }}]
  }}]
}}"#
    );
    write_config(&cfg_path, &config_json);

    let output = std::process::Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
        .args([
            "send",
            "--config",
            cfg_path.to_str().unwrap(),
            "--request",
            "r",
            "--identity",
            "keyid",
            "--json",
        ])
        .env("QKEY", "qsecret_abc123")
        .output()
        .expect("spawn binary");

    remove_config(&cfg_path);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert_eq!(
        output.status.code(),
        Some(0),
        "expected exit 0 for passing assertion; stderr: {stderr}"
    );

    // Core assertion: the raw apiKey secret must NOT appear in stdout (it was in the URL query string).
    assert!(
        !stdout.contains("qsecret_abc123"),
        "apiKey query secret 'qsecret_abc123' must NOT appear in --json stdout; got:\n{stdout}"
    );

    // Sanity: the response status should appear.
    assert!(
        stdout.contains("200"),
        "--json output should include HTTP status 200; got:\n{stdout}"
    );
}

// ---------------------------------------------------------------------------
// Test 7: Basic-auth base64 blob echoed in response body must not appear in --json output
// ---------------------------------------------------------------------------
/// Identity is `basic` with username `u` and password from env `BPW=pw_secret_42`.
/// The Authorization header sent is `Basic dTpwd19zZWNyZXRfNDI=` (base64 of `u:pw_secret_42`).
/// Wiremock `/x` → 200 with a body that echoes that exact base64 blob.
/// Run `send --json`. Assert exit 0 AND that the blob is absent from stdout.
#[tokio::test]
async fn send_redacts_basic_blob_in_body() {
    // Compute the base64 blob the same way the production code does, so this
    // test stays correct if the encoding ever changes.
    let blob = qa_touchstone_core::buildreq::basic_auth_value("u", "pw_secret_42");
    // blob == "Basic dTpwd19zZWNyZXRfNDI=" — the part after "Basic " is what we
    // check, but we assert the whole string is absent to be thorough.
    let blob_b64 = blob.strip_prefix("Basic ").unwrap_or(&blob).to_owned();

    let server = MockServer::start().await;

    // The body echoes the full base64-encoded credential blob (like a debug echo endpoint).
    let body = format!("{{\"a\":\"Basic {}\"}}", blob_b64);

    Mock::given(method("GET"))
        .and(path("/x"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_raw(body.clone(), "application/json"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/x", server.uri());
    let cfg_path = tmp_config("basic_blob");
    let config_json = format!(
        r#"{{
  "version": 1,
  "environments": [],
  "identities": [{{
    "id": "basicid",
    "auth": {{
      "type": "basic",
      "username": "u",
      "password": {{ "env": "BPW" }}
    }}
  }}],
  "requests": [{{
    "id": "r",
    "method": "GET",
    "url": "{url}",
    "assertions": [{{ "type": "status", "op": "eq", "value": 200 }}]
  }}]
}}"#
    );
    write_config(&cfg_path, &config_json);

    let output = std::process::Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
        .args([
            "send",
            "--config",
            cfg_path.to_str().unwrap(),
            "--request",
            "r",
            "--identity",
            "basicid",
            "--json",
        ])
        .env("BPW", "pw_secret_42")
        .output()
        .expect("spawn binary");

    remove_config(&cfg_path);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert_eq!(
        output.status.code(),
        Some(0),
        "expected exit 0 for passing assertion; stderr: {stderr}"
    );

    // Core assertion: the base64 blob must NOT appear in stdout.
    assert!(
        !stdout.contains(&blob_b64),
        "Basic-auth base64 blob '{}' must NOT appear in --json stdout (was echoed in response body); got:\n{stdout}",
        blob_b64
    );

    // Sanity: status must appear.
    assert!(
        stdout.contains("200"),
        "--json output should include HTTP status 200; got:\n{stdout}"
    );
}

// ---------------------------------------------------------------------------
// Test 6: bearer token echoed in response body must not appear in --json output
// ---------------------------------------------------------------------------
/// Identity is bearer with token from env `BTOK=btok_xyz789`.
/// Wiremock `/x` → 200 with a JSON body that ECHOES the token (simulating httpbin).
/// Run `send --json`. Assert exit 0 AND that `btok_xyz789` is absent from stdout.
#[tokio::test]
async fn send_redacts_echoed_secret_in_body() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/x"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_raw(r#"{"echoed":"Bearer btok_xyz789"}"#, "application/json"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/x", server.uri());
    let cfg_path = tmp_config("bearer_echo");
    let config_json = format!(
        r#"{{
  "version": 1,
  "environments": [],
  "identities": [{{
    "id": "bearid",
    "auth": {{ "type": "bearer", "token": {{ "env": "BTOK" }} }}
  }}],
  "requests": [{{
    "id": "r",
    "method": "GET",
    "url": "{url}",
    "assertions": [{{ "type": "status", "op": "eq", "value": 200 }}]
  }}]
}}"#
    );
    write_config(&cfg_path, &config_json);

    let output = std::process::Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
        .args([
            "send",
            "--config",
            cfg_path.to_str().unwrap(),
            "--request",
            "r",
            "--identity",
            "bearid",
            "--json",
        ])
        .env("BTOK", "btok_xyz789")
        .output()
        .expect("spawn binary");

    remove_config(&cfg_path);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert_eq!(
        output.status.code(),
        Some(0),
        "expected exit 0 for passing assertion; stderr: {stderr}"
    );

    // Core assertion: the bearer token must NOT appear anywhere in stdout (it was echoed in the body).
    assert!(
        !stdout.contains("btok_xyz789"),
        "bearer token 'btok_xyz789' must NOT appear in --json stdout (echoed in response body); got:\n{stdout}"
    );

    // Sanity: the response status should appear.
    assert!(
        stdout.contains("200"),
        "--json output should include HTTP status 200; got:\n{stdout}"
    );
}

// ---------------------------------------------------------------------------
// Test 8: secret appearing as a JSON response body KEY must not appear in --json output
// ---------------------------------------------------------------------------
/// Identity is bearer with token from env `KTOK=ktok_key_99`.
/// Wiremock `/x` → 200 with body `{"ktok_key_99": "v"}` — the secret is a JSON KEY.
/// Run `send --json`. Assert exit 0 AND that `ktok_key_99` is absent from stdout.
#[tokio::test]
async fn send_redacts_secret_as_response_body_key() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/x"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_raw(r#"{"ktok_key_99": "v"}"#, "application/json"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/x", server.uri());
    let cfg_path = tmp_config("key_redact");
    let config_json = format!(
        r#"{{
  "version": 1,
  "environments": [],
  "identities": [{{
    "id": "tok",
    "auth": {{ "type": "bearer", "token": {{ "env": "KTOK" }} }}
  }}],
  "requests": [{{
    "id": "r",
    "method": "GET",
    "url": "{url}",
    "assertions": [{{ "type": "status", "op": "eq", "value": 200 }}]
  }}]
}}"#
    );
    write_config(&cfg_path, &config_json);

    let output = std::process::Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
        .args([
            "send",
            "--config",
            cfg_path.to_str().unwrap(),
            "--request",
            "r",
            "--identity",
            "tok",
            "--json",
        ])
        .env("KTOK", "ktok_key_99")
        .output()
        .expect("spawn binary");

    remove_config(&cfg_path);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert_eq!(
        output.status.code(),
        Some(0),
        "expected exit 0 for passing assertion; stderr: {stderr}"
    );

    // Core assertion: the secret must NOT appear as an object key in the output.
    assert!(
        !stdout.contains("ktok_key_99"),
        "bearer token 'ktok_key_99' must NOT appear in --json stdout (was echoed as a response body key); got:\n{stdout}"
    );

    assert!(
        stdout.contains("200"),
        "--json output should include HTTP status 200; got:\n{stdout}"
    );
}

// ---------------------------------------------------------------------------
// Test 9: bare base64 blob echoed in response body (no "Basic " prefix) must not appear
// ---------------------------------------------------------------------------
/// Identity is basic with username `u` and password from env `BPW=pw_bare_77`.
/// The bare base64 of `u:pw_bare_77` is computed and echoed in the response body
/// WITHOUT the "Basic " prefix (e.g. `{"echoed": "<b64>"}`).
/// Run `send --json`. Assert exit 0 AND that the bare base64 blob is absent from stdout.
#[tokio::test]
async fn send_redacts_bare_base64_blob() {
    use base64::Engine as _;
    let bareb64 = base64::engine::general_purpose::STANDARD.encode("u:pw_bare_77");

    let server = MockServer::start().await;

    let body = format!(r#"{{"echoed": "{}"}}"#, bareb64);

    Mock::given(method("GET"))
        .and(path("/x"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_raw(body.clone(), "application/json"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/x", server.uri());
    let cfg_path = tmp_config("bare_b64");
    let config_json = format!(
        r#"{{
  "version": 1,
  "environments": [],
  "identities": [{{
    "id": "basicid",
    "auth": {{
      "type": "basic",
      "username": "u",
      "password": {{ "env": "BPW" }}
    }}
  }}],
  "requests": [{{
    "id": "r",
    "method": "GET",
    "url": "{url}",
    "assertions": [{{ "type": "status", "op": "eq", "value": 200 }}]
  }}]
}}"#
    );
    write_config(&cfg_path, &config_json);

    let output = std::process::Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
        .args([
            "send",
            "--config",
            cfg_path.to_str().unwrap(),
            "--request",
            "r",
            "--identity",
            "basicid",
            "--json",
        ])
        .env("BPW", "pw_bare_77")
        .output()
        .expect("spawn binary");

    remove_config(&cfg_path);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert_eq!(
        output.status.code(),
        Some(0),
        "expected exit 0 for passing assertion; stderr: {stderr}"
    );

    // Core assertion: the bare base64 blob must NOT appear in stdout.
    assert!(
        !stdout.contains(&bareb64),
        "bare base64 blob '{}' must NOT appear in --json stdout (was echoed in response body without 'Basic ' prefix); got:\n{stdout}",
        bareb64
    );

    assert!(
        stdout.contains("200"),
        "--json output should include HTTP status 200; got:\n{stdout}"
    );
}
