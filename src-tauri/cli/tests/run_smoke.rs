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
