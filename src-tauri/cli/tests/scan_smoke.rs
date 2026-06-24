use std::io::Write;
use std::process::Command;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn bin() -> Command { Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci")) }
fn write_temp(name: &str, c: &str) -> std::path::PathBuf {
    let mut p = std::env::temp_dir(); p.push(format!("qa_scan_{}_{}", std::process::id(), name));
    std::fs::File::create(&p).unwrap().write_all(c.as_bytes()).unwrap(); p
}

#[tokio::test]
async fn scan_matrix_vuln_exits_3() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/s")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let cfg = write_temp("v.json", &format!(r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"s","method":"GET","url":"{base}/s"}}],
      "security":{{"matrix":{{"endpoints":["s"]}}}} }}"#, base=server.uri()));
    let out = bin().args(["scan","--config",cfg.to_str().unwrap(),"--json"]).output().unwrap();
    assert_eq!(out.status.code(), Some(3), "anon-allowed = vuln >= high → exit 3");
    assert!(String::from_utf8_lossy(&out.stdout).contains("matrix.deny-bypass"));
}

#[tokio::test]
async fn scan_all_pass_exits_0() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/s")).respond_with(ResponseTemplate::new(403)).mount(&server).await;
    let cfg = write_temp("p.json", &format!(r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"s","method":"GET","url":"{base}/s"}}],
      "security":{{"matrix":{{"endpoints":["s"]}}}} }}"#, base=server.uri()));
    let out = bin().args(["scan","--config",cfg.to_str().unwrap()]).output().unwrap();
    assert_eq!(out.status.code(), Some(0), "anon denied = pass → exit 0");
}

#[test]
fn scan_no_security_block_exits_2() {
    let cfg = write_temp("n.json", r#"{ "version":1,"environments":[],"identities":[],"requests":[] }"#);
    let out = bin().args(["scan","--config",cfg.to_str().unwrap()]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
}

#[tokio::test]
async fn scan_redacts_identity_secret() {
    // A bearer-token identity that is ALLOWED on a deny-expected endpoint → vuln finding;
    // assert the token never appears in output (evidence/path/identity all redacted).
    let server = MockServer::start().await;
    Mock::given(method("DELETE")).and(path("/u")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let cfg = write_temp("r.json", &format!(r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"lowpriv","auth":{{"type":"bearer","token":"SUPERSECRET"}}}}],
      "requests":[{{"id":"del","method":"DELETE","url":"{base}/u"}}],
      "security":{{"matrix":{{"endpoints":["del"],"expect":{{"del":{{"lowpriv":"deny"}}}}}}}} }}"#, base=server.uri()));
    let out = bin().args(["scan","--config",cfg.to_str().unwrap(),"--json"]).output().unwrap();
    assert_eq!(out.status.code(), Some(3));
    assert!(!String::from_utf8_lossy(&out.stdout).contains("SUPERSECRET"), "identity secret must be redacted");
}

#[tokio::test]
async fn scan_request_error_exits_1() {
    // No findings, but a request couldn't execute → exit 1 (scan incomplete), NOT exit 0.
    let cfg = write_temp("err.json", r#"{ "version":1,"environments":[],
      "identities":[{"id":"anon","auth":{"type":"none"}}],
      "requests":[{"id":"down","method":"GET","url":"http://127.0.0.1:1/x"}],
      "security":{"matrix":{"endpoints":["down"]}} }"#);
    let out = bin().args(["scan","--config",cfg.to_str().unwrap(),"--json"]).output().unwrap();
    assert_eq!(out.status.code(), Some(1), "a non-run must not report clean (exit 0)");
    let s = String::from_utf8_lossy(&out.stdout);
    assert!(s.contains("\"errors\""), "engines/errors surfaced in JSON");
}

#[tokio::test]
async fn scan_out_file_written_and_redacted() {
    // --out writes the same redacted report to a file.
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/s")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let cfg = write_temp("o.json", &format!(r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"s","method":"GET","url":"{base}/s"}}],
      "security":{{"matrix":{{"endpoints":["s"]}}}} }}"#, base=server.uri()));
    let outfile = write_temp("findings.json", "");
    let out = bin().args(["scan","--config",cfg.to_str().unwrap(),"--out",outfile.to_str().unwrap()]).output().unwrap();
    assert_eq!(out.status.code(), Some(3));
    let written = std::fs::read_to_string(&outfile).unwrap();
    assert!(written.contains("matrix.deny-bypass"), "findings written to --out file");
}
