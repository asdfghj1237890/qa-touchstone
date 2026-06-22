// TS-vs-Rust golden fixture tests for buildreq::build_request.
// Each case constructs the Rust Request + Identity that corresponds to the
// matching generator case in scripts/gen-fixtures.mjs (brCases), then asserts
// that build_request output equals the fixture's `expected` (the TS buildPayload
// requestDetails captured from the real executor.ts).
use qa_touchstone_core::{
    buildreq::build_request,
    config::{ApiKeyIn, Auth, Body, BodyMode, Identity, Kv, Request},
};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

fn fixture_path() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("buildreq.json")
}

fn load_fixtures() -> Vec<serde_json::Value> {
    let text = fs::read_to_string(fixture_path()).expect("buildreq.json not found — run `node scripts/gen-fixtures.mjs`");
    serde_json::from_str(&text).expect("buildreq.json must be a JSON array")
}

fn get_expected(cases: &[serde_json::Value], name: &str) -> serde_json::Value {
    cases
        .iter()
        .find(|c| c["name"] == serde_json::json!(name))
        .unwrap_or_else(|| panic!("fixture case `{name}` not found"))["expected"]
        .clone()
}

fn bare_req(method: &str, url: &str) -> Request {
    Request {
        id: "r".into(),
        method: method.into(),
        url: url.into(),
        headers: vec![],
        query: vec![],
        body: None,
        assertions: vec![],
    }
}

fn anon() -> Identity {
    Identity { id: "anon".into(), auth: Auth::None }
}

fn no_map() -> BTreeMap<String, String> {
    BTreeMap::new()
}

// ── Test cases (mirror gen-fixtures.mjs brCases in order) ────────────────────

#[test]
fn bearer() {
    let cases = load_fixtures();
    let expected = get_expected(&cases, "bearer");

    let req = bare_req("GET", "https://x.example/u");
    let id = Identity { id: "id".into(), auth: Auth::Bearer { token: "TOK".into() } };
    let got = build_request(&req, &id, &no_map()).unwrap();
    assert_eq!(got, expected, "bearer: Rust output must match TS buildPayload golden");
}

#[test]
fn apikey_header() {
    let cases = load_fixtures();
    let expected = get_expected(&cases, "apikey_header");

    let req = bare_req("GET", "https://x.example/u");
    let id = Identity {
        id: "id".into(),
        auth: Auth::ApiKey { key: "X-API-Key".into(), value: "AK".into(), location: ApiKeyIn::Header },
    };
    let got = build_request(&req, &id, &no_map()).unwrap();
    assert_eq!(got, expected, "apikey_header: Rust output must match TS buildPayload golden");
}

#[test]
fn apikey_query() {
    let cases = load_fixtures();
    let expected = get_expected(&cases, "apikey_query");

    let req = bare_req("GET", "https://x.example/u");
    let id = Identity {
        id: "id".into(),
        auth: Auth::ApiKey { key: "X-API-Key".into(), value: "AK".into(), location: ApiKeyIn::Query },
    };
    let got = build_request(&req, &id, &no_map()).unwrap();
    assert_eq!(got, expected, "apikey_query: Rust output must match TS buildPayload golden");
}

#[test]
fn basic() {
    let cases = load_fixtures();
    let expected = get_expected(&cases, "basic");

    let req = bare_req("GET", "https://x.example/u");
    let id = Identity {
        id: "id".into(),
        auth: Auth::Basic { username: "u".into(), password: "p".into() },
    };
    let got = build_request(&req, &id, &no_map()).unwrap();
    assert_eq!(got, expected, "basic: Rust output must match TS buildPayload golden (Basic dTpw)");
}

#[test]
fn query_enc() {
    let cases = load_fixtures();
    let expected = get_expected(&cases, "query_enc");

    let mut req = bare_req("GET", "https://x.example/s");
    req.query = vec![Kv { key: "q".into(), value: "a b&c".into() }];
    let got = build_request(&req, &anon(), &no_map()).unwrap();
    assert_eq!(got, expected, "query_enc: Rust output must match TS encodeURIComponent golden");
}

#[test]
fn json_body() {
    let cases = load_fixtures();
    let expected = get_expected(&cases, "json_body");

    let mut req = bare_req("POST", "https://x.example/u");
    req.body = Some(Body { mode: BodyMode::Json, content: r#"{"a":1}"#.into() });
    let got = build_request(&req, &anon(), &no_map()).unwrap();
    assert_eq!(got, expected, "json_body: Rust output must match TS buildPayload golden");
}
