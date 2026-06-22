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
        .args(["send", "--config", cfg_path.to_str().unwrap(),
               "--request", "r", "--identity", "anon"])
        .status()
        .expect("spawn binary");

    remove_config(&cfg_path);
    assert_eq!(status.code(), Some(0), "exit 0 expected for all-pass assertions");
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
        .args(["send", "--config", cfg_path.to_str().unwrap(),
               "--request", "r", "--identity", "anon"])
        .status()
        .expect("spawn binary");

    remove_config(&cfg_path);
    assert_eq!(status.code(), Some(4), "exit 4 expected for failed assertion (status eq 201 vs actual 200)");
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
        .args(["send", "--config", cfg_path.to_str().unwrap(),
               "--request", "r", "--identity", "tok"])
        // Explicitly unset NOPE (in case it's somehow set in CI)
        .env_remove("NOPE")
        .status()
        .expect("spawn binary");

    remove_config(&cfg_path);
    assert_eq!(status.code(), Some(2), "exit 2 expected when env var NOPE is unset (fail-closed secret resolution)");
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
        .args(["send", "--config", cfg_path.to_str().unwrap(),
               "--request", "r", "--identity", "tok", "--json"])
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
    assert!(!stdout.trim().is_empty(), "stdout must be non-empty with --json");

    // The status code should appear in the output (it's safe to include).
    assert!(
        stdout.contains("200"),
        "--json output should include the HTTP status 200; got:\n{stdout}"
    );
}
