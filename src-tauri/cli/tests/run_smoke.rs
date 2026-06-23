use std::io::Write;
use std::process::Command;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn bin() -> Command { Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci")) }

fn write_temp(name: &str, contents: &str) -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("qa_run_{}_{}", std::process::id(), name));
    let mut f = std::fs::File::create(&p).unwrap();
    f.write_all(contents.as_bytes()).unwrap();
    p
}

fn config_json(base: &str) -> String {
    format!(r#"{{
      "version":1,
      "environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[
        {{"id":"ok","method":"GET","url":"{base}/ok","assertions":[{{"type":"status","op":"eq","value":200}}]}},
        {{"id":"bad","method":"GET","url":"{base}/ok","assertions":[{{"type":"status","op":"eq","value":500}}]}}
      ],
      "collections":[
        {{"id":"pass","requests":["ok"]}},
        {{"id":"fail","requests":["ok","bad"]}}
      ]
    }}"#)
}

#[tokio::test]
async fn run_all_pass_exits_0() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/ok")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let cfg = write_temp("p.json", &config_json(&server.uri()));
    let out = bin().args(["run","--config",cfg.to_str().unwrap(),"--collection","pass","--identity","anon"]).output().unwrap();
    assert_eq!(out.status.code(), Some(0), "stderr: {}", String::from_utf8_lossy(&out.stderr));
}

#[tokio::test]
async fn run_failed_assertion_exits_4() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/ok")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let cfg = write_temp("f.json", &config_json(&server.uri()));
    let out = bin().args(["run","--config",cfg.to_str().unwrap(),"--collection","fail","--identity","anon"]).output().unwrap();
    assert_eq!(out.status.code(), Some(4));
}

#[test]
fn unknown_collection_exits_2() {
    let cfg = write_temp("u.json", &config_json("https://example.invalid"));
    let out = bin().args(["run","--config",cfg.to_str().unwrap(),"--collection","nope","--identity","anon"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
}

#[test]
fn data_and_iterations_conflict_exits_2() {
    let cfg = write_temp("c.json", &config_json("https://example.invalid"));
    let data = write_temp("d.csv", "a\n1\n");
    let out = bin().args([
        "run","--config",cfg.to_str().unwrap(),"--collection","pass","--identity","anon",
        "--data",data.to_str().unwrap(),"--iterations","3",
    ]).output().unwrap();
    assert_eq!(out.status.code(), Some(2), "clap conflicts_with should reject");
}

#[test]
fn empty_data_exits_2() {
    let cfg = write_temp("e.json", &config_json("https://example.invalid"));
    let data = write_temp("empty.csv", "a\n");
    let out = bin().args([
        "run","--config",cfg.to_str().unwrap(),"--collection","pass","--identity","anon",
        "--data",data.to_str().unwrap(),
    ]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
}

#[tokio::test]
async fn run_writes_junit_with_failure_and_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/ok")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let cfg_json = format!(r#"{{
      "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[
        {{"id":"ok","method":"GET","url":"{base}/ok","assertions":[{{"type":"status","op":"eq","value":200}}]}},
        {{"id":"bad","method":"GET","url":"{base}/ok","assertions":[{{"type":"status","op":"eq","value":500}}]}},
        {{"id":"boom","method":"GET","url":"http://127.0.0.1:1/x","assertions":[{{"type":"status","op":"eq","value":200}}]}}
      ],
      "collections":[{{"id":"mix","requests":["ok","bad","boom"]}}]
    }}"#, base = server.uri());
    let cfg = write_temp("j.json", &cfg_json);
    let junit = write_temp("out.xml", "");
    let out = bin().args([
        "run","--config",cfg.to_str().unwrap(),"--collection","mix","--identity","anon",
        "--junit",junit.to_str().unwrap(),
    ]).output().unwrap();
    assert_eq!(out.status.code(), Some(4)); // a failure + an error
    let xml = std::fs::read_to_string(&junit).unwrap();
    let doc = roxmltree::Document::parse(&xml).expect("well-formed junit file");
    assert_eq!(doc.descendants().filter(|n| n.has_tag_name("failure")).count(), 1);
    assert_eq!(doc.descendants().filter(|n| n.has_tag_name("error")).count(), 1);
}

// The server echoes whatever query it received into its JSON body, so a secret
// substituted into the request surfaces in a response-derived assertion `actual`.
async fn echo_server() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("GET")).respond_with(|req: &wiremock::Request| {
        ResponseTemplate::new(200).set_body_string(format!("{{\"echo\":\"{}\"}}", req.url.query().unwrap_or("")))
    }).mount(&server).await;
    server
}

#[tokio::test]
async fn identity_secret_never_appears_in_any_report() {
    let server = echo_server().await;
    // The bearer token rides in the Authorization header (never echoed by the server), so this
    // is an ALLOWLIST guard: `run` must not dump request/auth headers into any report. The
    // redaction-of-secret path itself is covered by data_row_secret_* and the core::redact tests.
    let cfg = format!(r#"{{
      "version":1,"environments":[],
      "identities":[{{"id":"a","auth":{{"type":"bearer","token":"SUPERSECRETTOKEN"}}}}],
      "requests":[{{"id":"r","method":"GET","url":"{base}/x","assertions":[{{"type":"status","op":"eq","value":200}}]}}],
      "collections":[{{"id":"c","requests":["r"]}}]
    }}"#, base = server.uri());
    let cfgp = write_temp("rs.json", &cfg);
    let junit = write_temp("rs.xml", "");
    let out = bin().args([
        "run","--config",cfgp.to_str().unwrap(),"--collection","c","--identity","a",
        "--json","--junit",junit.to_str().unwrap(),
    ]).output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let xml = std::fs::read_to_string(&junit).unwrap();
    assert!(!stdout.contains("SUPERSECRETTOKEN"), "json/human leaked token: {stdout}");
    assert!(!xml.contains("SUPERSECRETTOKEN"), "junit leaked token");
}

#[tokio::test]
async fn data_row_secret_absent_even_when_it_reaches_url_and_actual() {
    let server = echo_server().await;
    // {{tok}} from the data row is substituted into the query (→ final_url) AND echoed into the
    // body; a FAILING bodyEq surfaces the echoed value into the assertion `actual`, which is
    // emitted in BOTH --json and the JUnit <failure>. Every path must be redacted.
    let cfg = format!(r#"{{
      "version":1,"environments":[],
      "identities":[{{"id":"a","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"r","method":"GET","url":"{base}/x?tok={{{{tok}}}}",
        "assertions":[{{"type":"bodyEq","path":"echo","value":"MISMATCH"}}]}}],
      "collections":[{{"id":"c","requests":["r"]}}]
    }}"#, base = server.uri());
    let cfgp = write_temp("dr.json", &cfg);
    let data = write_temp("dr.csv", "tok\nROWSECRETVALUE\n");
    let junit = write_temp("dr.xml", "");
    let out = bin().args([
        "run","--config",cfgp.to_str().unwrap(),"--collection","c","--identity","a",
        "--data",data.to_str().unwrap(),"--json","--junit",junit.to_str().unwrap(),
    ]).output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let xml = std::fs::read_to_string(&junit).unwrap();
    assert!(!stdout.contains("ROWSECRETVALUE"), "json leaked data-row secret: {stdout}");
    assert!(!xml.contains("ROWSECRETVALUE"), "junit leaked data-row secret: {xml}");
    // Non-vacuous: the value really did reach the emitted assertion `actual` (JUnit <failure>),
    // so the redaction marker must be present — proving redaction did the work, not absence.
    assert!(xml.contains("***REDACTED***"), "expected redaction marker in JUnit failure actual: {xml}");
}

#[tokio::test]
async fn response_body_and_headers_are_not_emitted_by_run() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/x")).respond_with(
        ResponseTemplate::new(200)
            .insert_header("X-Marker", "HEADERMARKER")
            .set_body_string("{\"secretBodyField\":\"BODYMARKER\"}")
    ).mount(&server).await;
    // assertion is on status only — nothing surfaces the body/header into an `actual`.
    let cfg = format!(r#"{{
      "version":1,"environments":[],
      "identities":[{{"id":"a","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"r","method":"GET","url":"{base}/x","assertions":[{{"type":"status","op":"eq","value":200}}]}}],
      "collections":[{{"id":"c","requests":["r"]}}]
    }}"#, base = server.uri());
    let cfgp = write_temp("aw.json", &cfg);
    let junit = write_temp("aw.xml", "");
    let out = bin().args([
        "run","--config",cfgp.to_str().unwrap(),"--collection","c","--identity","a",
        "--json","--junit",junit.to_str().unwrap(),
    ]).output().unwrap();
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    let xml = std::fs::read_to_string(&junit).unwrap();
    for marker in ["BODYMARKER", "HEADERMARKER", "secretBodyField"] {
        assert!(!stdout.contains(marker), "run --json must not emit response body/headers: {marker}");
        assert!(!xml.contains(marker), "run --junit must not emit response body/headers: {marker}");
    }
}

#[test]
fn iterations_zero_exits_2() {
    let cfg = write_temp("i0.json", &config_json("https://example.invalid"));
    let out = bin().args([
        "run","--config",cfg.to_str().unwrap(),"--collection","pass","--identity","anon","--iterations","0",
    ]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
}
