// TS-vs-Rust golden fixture tests for buildreq::build_request.
// Each case constructs the Rust Request + Identity that corresponds to the
// matching generator case in scripts/gen-fixtures.mjs (brCases), then asserts
// that build_request output equals the fixture's `expected` (the TS buildPayload
// requestDetails captured from the real executor.ts).
use qa_touchstone_core::{
    buildreq::build_request,
    config::{ApiKeyIn, Auth, Body, BodyMode, Identity, Kv, Request},
    engine::{NoDynamics, PinnedDynamics},
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

struct Fixtures {
    fixed_now_ms: i64,
    floats: Vec<f64>,
    cases: Vec<serde_json::Value>,
}

fn load_fixtures() -> Fixtures {
    let text = fs::read_to_string(fixture_path())
        .expect("buildreq.json not found — run `node scripts/gen-fixtures.mjs`");
    let root: serde_json::Value =
        serde_json::from_str(&text).expect("buildreq.json must be valid JSON");
    let fixed_now_ms = root["fixedNowMs"]
        .as_i64()
        .expect("buildreq.json must have top-level `fixedNowMs`");
    let floats: Vec<f64> = root["floats"]
        .as_array()
        .expect("buildreq.json must have top-level `floats`")
        .iter()
        .map(|v| v.as_f64().expect("floats must be numbers"))
        .collect();
    let cases = root["cases"]
        .as_array()
        .expect("buildreq.json must have top-level `cases`")
        .clone();
    Fixtures {
        fixed_now_ms,
        floats,
        cases,
    }
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
        privileged: None,
    }
}

fn anon() -> Identity {
    Identity {
        id: "anon".into(),
        auth: Auth::None,
        privileged: false,
    }
}

fn no_map() -> BTreeMap<String, String> {
    BTreeMap::new()
}

// ── Test cases (mirror gen-fixtures.mjs brCases in order) ────────────────────

#[test]
fn bearer() {
    let fix = load_fixtures();
    let expected = get_expected(&fix.cases, "bearer");

    let req = bare_req("GET", "https://x.example/u");
    let id = Identity {
        id: "id".into(),
        auth: Auth::Bearer {
            token: "TOK".into(),
        },
        privileged: false,
    };
    let got = build_request(&req, &id, &no_map(), &mut NoDynamics).unwrap();
    assert_eq!(
        got, expected,
        "bearer: Rust output must match TS buildPayload golden"
    );
}

#[test]
fn apikey_header() {
    let fix = load_fixtures();
    let expected = get_expected(&fix.cases, "apikey_header");

    let req = bare_req("GET", "https://x.example/u");
    let id = Identity {
        id: "id".into(),
        auth: Auth::ApiKey {
            key: "X-API-Key".into(),
            value: "AK".into(),
            location: ApiKeyIn::Header,
        },
        privileged: false,
    };
    let got = build_request(&req, &id, &no_map(), &mut NoDynamics).unwrap();
    assert_eq!(
        got, expected,
        "apikey_header: Rust output must match TS buildPayload golden"
    );
}

#[test]
fn apikey_query() {
    let fix = load_fixtures();
    let expected = get_expected(&fix.cases, "apikey_query");

    let req = bare_req("GET", "https://x.example/u");
    let id = Identity {
        id: "id".into(),
        auth: Auth::ApiKey {
            key: "X-API-Key".into(),
            value: "AK".into(),
            location: ApiKeyIn::Query,
        },
        privileged: false,
    };
    let got = build_request(&req, &id, &no_map(), &mut NoDynamics).unwrap();
    assert_eq!(
        got, expected,
        "apikey_query: Rust output must match TS buildPayload golden"
    );
}

#[test]
fn basic() {
    let fix = load_fixtures();
    let expected = get_expected(&fix.cases, "basic");

    let req = bare_req("GET", "https://x.example/u");
    let id = Identity {
        id: "id".into(),
        auth: Auth::Basic {
            username: "u".into(),
            password: "p".into(),
        },
        privileged: false,
    };
    let got = build_request(&req, &id, &no_map(), &mut NoDynamics).unwrap();
    assert_eq!(
        got, expected,
        "basic: Rust output must match TS buildPayload golden (Basic dTpw)"
    );
}

#[test]
fn query_enc() {
    let fix = load_fixtures();
    let expected = get_expected(&fix.cases, "query_enc");

    let mut req = bare_req("GET", "https://x.example/s");
    req.query = vec![Kv {
        key: "q".into(),
        value: "a b&c".into(),
    }];
    let got = build_request(&req, &anon(), &no_map(), &mut NoDynamics).unwrap();
    assert_eq!(
        got, expected,
        "query_enc: Rust output must match TS encodeURIComponent golden"
    );
}

#[test]
fn json_body() {
    let fix = load_fixtures();
    let expected = get_expected(&fix.cases, "json_body");

    let mut req = bare_req("POST", "https://x.example/u");
    req.body = Some(Body {
        mode: BodyMode::Json,
        content: r#"{"a":1}"#.into(),
    });
    let got = build_request(&req, &anon(), &no_map(), &mut NoDynamics).unwrap();
    assert_eq!(
        got, expected,
        "json_body: Rust output must match TS buildPayload golden"
    );
}

#[test]
fn timestamp_query() {
    let fix = load_fixtures();
    let expected = get_expected(&fix.cases, "timestamp_query");

    // $timestamp is clock-only — no float consumption — so PinnedDynamics cursor stays at 0.
    let mut dyns = PinnedDynamics::new(fix.fixed_now_ms, fix.floats.clone());
    let mut req = bare_req("GET", "https://x.example/u");
    req.query = vec![Kv {
        key: "t".into(),
        value: "{{$timestamp}}".into(),
    }];
    let got = build_request(&req, &anon(), &no_map(), &mut dyns).unwrap();
    // With FIXED_NOW=1700000000000 ms → $timestamp = floor(1700000000000/1000) = 1700000000
    assert_eq!(
        got, expected,
        "timestamp_query: Rust PinnedDynamics must match TS pinned Date.now golden"
    );
}
