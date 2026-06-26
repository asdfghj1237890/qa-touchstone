//! Integration smoke tests for `qa-touchstone-ci bola-suggest`.
//! No network (no wiremock needed — bola-suggest makes no HTTP calls).
use std::io::Write;
use std::process::Command;

fn bin() -> Command { Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci")) }

fn write_temp(name: &str, content: &str) -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("qa_bola_suggest_{}_{}", std::process::id(), name));
    std::fs::File::create(&p).unwrap().write_all(content.as_bytes()).unwrap();
    p
}

/// Config with three requests: path id, query id, body id.
fn make_cfg(base_url: &str) -> String {
    format!(r#"{{
  "version": 1,
  "environments": [],
  "identities": [
    {{"id": "alice", "auth": {{"type": "none"}}}},
    {{"id": "bob",   "auth": {{"type": "none"}}}}
  ],
  "requests": [
    {{
      "id": "getOrder",
      "method": "GET",
      "url": "{base}/orders/42"
    }},
    {{
      "id": "searchUser",
      "method": "GET",
      "url": "{base}/users",
      "query": [{{"key": "user_id", "value": "99"}}]
    }},
    {{
      "id": "createItem",
      "method": "POST",
      "url": "{base}/items",
      "body": {{"mode": "json", "content": "{{\"documentId\":\"0123456789abcdef01234567\"}}"}}
    }},
    {{
      "id": "noId",
      "method": "GET",
      "url": "{base}/health"
    }}
  ]
}}"#, base = base_url)
}

#[test]
fn bola_suggest_path_id_human_output() {
    let cfg = write_temp("path.json", &make_cfg("https://api.test"));
    let out = bin().args(["bola-suggest", "--config", cfg.to_str().unwrap()]).output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "exit 0 on valid config");
    assert!(stdout.contains("getOrder"), "request id in output");
    assert!(stdout.contains("path[1]"), "path id location surfaced");
    assert!(stdout.contains("42"),      "path id value surfaced");
    assert!(stdout.contains("high"),    "numeric after plural → high confidence");
    assert!(stdout.contains("stub"),    "paste-ready stub present");
}

#[test]
fn bola_suggest_query_id_json_output() {
    let cfg = write_temp("query.json", &make_cfg("https://api.test"));
    let out = bin().args(["bola-suggest", "--config", cfg.to_str().unwrap(), "--json"]).output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0));
    let parsed: serde_json::Value = serde_json::from_str(&stdout).expect("output must be valid JSON");
    let arr = parsed.as_array().expect("top level is array");
    let search = arr.iter().find(|r| r["request"] == "searchUser").expect("searchUser in output");
    let cands = search["candidates"].as_array().expect("candidates array");
    assert!(!cands.is_empty(), "searchUser must have candidates");
    let top = &cands[0];
    assert_eq!(top["idLocation"]["kind"], "query");
    assert_eq!(top["idLocation"]["key"], "user_id");
    assert_eq!(top["value"], "99");
}

#[test]
fn bola_suggest_body_id_json_output() {
    let cfg = write_temp("body.json", &make_cfg("https://api.test"));
    let out = bin().args(["bola-suggest", "--config", cfg.to_str().unwrap(), "--json"]).output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0));
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let arr = parsed.as_array().unwrap();
    let create = arr.iter().find(|r| r["request"] == "createItem").unwrap();
    let cands = create["candidates"].as_array().unwrap();
    assert!(!cands.is_empty(), "createItem must have body candidate");
    assert_eq!(cands[0]["idLocation"]["kind"], "body");
    assert_eq!(cands[0]["idLocation"]["path"], "documentId");
}

#[test]
fn bola_suggest_stub_contains_identity_ids() {
    let cfg = write_temp("stub.json", &make_cfg("https://api.test"));
    let out = bin().args(["bola-suggest", "--config", cfg.to_str().unwrap(), "--json"]).output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let arr = parsed.as_array().unwrap();
    let order = arr.iter().find(|r| r["request"] == "getOrder").unwrap();
    let stub = order["stub"].as_object().expect("stub present for getOrder");
    assert_eq!(stub["id"], "getOrder-bola");
    assert_eq!(stub["request"], "getOrder");
    assert_eq!(stub["negativeControl"], true);
    let id_values = stub["idValues"].as_object().expect("idValues map");
    assert!(id_values.contains_key("alice"), "alice in idValues");
    assert!(id_values.contains_key("bob"),   "bob in idValues");
    assert_eq!(id_values["alice"], "", "idValues empty for user to fill");
}

#[test]
fn bola_suggest_no_id_request_prints_note() {
    let cfg = write_temp("noid.json", &make_cfg("https://api.test"));
    let out = bin().args(["bola-suggest", "--config", cfg.to_str().unwrap(), "--json"]).output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let arr = parsed.as_array().unwrap();
    let health = arr.iter().find(|r| r["request"] == "noId").unwrap();
    assert!(health["candidates"].as_array().unwrap().is_empty(), "no candidates for /health");
    assert!(health["note"].is_string(), "note present when no candidates");
    assert!(health["note"].as_str().unwrap().contains("no id-shaped"));
    assert!(health["stub"].is_null(), "no stub when no candidates");
}

#[test]
fn bola_suggest_bad_config_exits_2() {
    let cfg = write_temp("bad.json", r#"{"version":99,"environments":[],"identities":[],"requests":[]}"#);
    let out = bin().args(["bola-suggest", "--config", cfg.to_str().unwrap()]).output().unwrap();
    assert_eq!(out.status.code(), Some(2), "unsupported version → exit 2");
}

#[test]
fn bola_suggest_missing_config_exits_2() {
    let out = bin().args(["bola-suggest", "--config", "/tmp/qa-nonexistent-config-2c1f9a.json"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2), "missing config file → exit 2");
}

#[test]
fn bola_suggest_redacts_auth_secret() {
    // A bearer-token identity — the token must never appear in bola-suggest output
    // (defense-in-depth union redaction).
    let cfg_json = r#"{
      "version": 1, "environments": [], "requests": [
        {"id": "r", "method": "GET", "url": "https://api.test/orders/42"}
      ],
      "identities": [{"id": "x", "auth": {"type": "bearer", "token": "SUPER_SECRET_TOKEN"}}]
    }"#;
    let cfg = write_temp("redact.json", cfg_json);
    let out = bin().args(["bola-suggest", "--config", cfg.to_str().unwrap(), "--json"]).output().unwrap();
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(!stdout.contains("SUPER_SECRET_TOKEN"), "auth secret must not appear in output");
}
