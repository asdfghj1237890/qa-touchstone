//! Integration smoke tests for `qa-touchstone-ci import`.
//! No network (import makes no HTTP calls).
use std::io::Write;
use std::process::Command;

fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
}

fn write_temp(name: &str, content: &str) -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("qa_import_{}_{}", std::process::id(), name));
    std::fs::File::create(&p)
        .unwrap()
        .write_all(content.as_bytes())
        .unwrap();
    p
}

// ── Postman fixture ───────────────────────────────────────────────────────

fn postman_spec() -> &'static str {
    r#"{
      "info": {
        "name": "Pet Store",
        "_postman_id": "abc123",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
      },
      "item": [
        {
          "name": "List Pets",
          "request": {
            "method": "GET",
            "url": "https://api.pets.io/v1/pets?limit=10",
            "header": [
              { "key": "Accept", "value": "application/json", "disabled": false }
            ]
          }
        },
        {
          "name": "Create Pet",
          "request": {
            "method": "POST",
            "url": { "raw": "https://api.pets.io/v1/pets", "path": ["v1","pets"], "query": [] },
            "header": [{ "key": "Content-Type", "value": "application/json", "disabled": false }],
            "body": { "mode": "raw", "raw": "{\"name\":\"Buddy\"}" }
          }
        }
      ]
    }"#
}

// ── OpenAPI fixture ────────────────────────────────────────────────────────

fn openapi_spec() -> &'static str {
    r#"{
      "openapi": "3.0.3",
      "info": { "title": "Pet API", "version": "1.0.0" },
      "servers": [{ "url": "https://api.pets.io" }],
      "paths": {
        "/pets": {
          "get": {
            "summary": "List pets",
            "tags": ["pets"],
            "parameters": [{ "name": "limit", "in": "query", "required": true, "example": 20 }]
          },
          "post": {
            "summary": "Create pet",
            "tags": ["pets"],
            "security": [{ "bearerAuth": [] }],
            "requestBody": {
              "content": {
                "application/json": {
                  "example": { "name": "Buddy", "species": "dog" }
                }
              }
            }
          }
        }
      }
    }"#
}

// ── Smoke: Postman → load_config valid + expected structure ───────────────

#[test]
fn import_postman_exit_0_and_valid_config() {
    let spec = write_temp("postman.json", postman_spec());
    let out = bin()
        .args(["import", "--input", spec.to_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "exit 0 on valid Postman spec");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let cfg: serde_json::Value = serde_json::from_str(&stdout).expect("stdout must be valid JSON");
    assert_eq!(cfg["version"], 1);
    let reqs = cfg["requests"].as_array().expect("requests array");
    assert!(!reqs.is_empty(), "must have at least one request");
    assert!(
        reqs.iter().any(|r| r["method"] == "GET"),
        "GET request present"
    );
    assert!(
        reqs.iter().any(|r| r["method"] == "POST"),
        "POST request present"
    );
    // Placeholder identity
    let ids = cfg["identities"].as_array().unwrap();
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0]["id"], "anon");
    assert_eq!(ids[0]["auth"]["type"], "none");
    // Round-trip through load_config
    let json_str = serde_json::to_string(&cfg).unwrap();
    qa_touchstone_core::config::load_config(&json_str, &|_| None)
        .expect("emitted config must pass load_config");
}

// ── Smoke: OpenAPI → load_config valid + baseUrl from servers[0] ──────────

#[test]
fn import_openapi_exit_0_base_url_set() {
    let spec = write_temp("oas.json", openapi_spec());
    let out = bin()
        .args(["import", "--input", spec.to_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "exit 0 on valid OpenAPI spec");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let cfg: serde_json::Value = serde_json::from_str(&stdout).expect("valid JSON");
    assert_eq!(
        cfg["globals"]["variables"]["baseUrl"], "https://api.pets.io",
        "baseUrl from servers[0].url"
    );
    let reqs = cfg["requests"].as_array().unwrap();
    assert!(
        reqs.iter().any(|r| r["body"]["mode"] == "json"),
        "OpenAPI body uses mode:json"
    );
    // Round-trip
    let json_str = serde_json::to_string(&cfg).unwrap();
    qa_touchstone_core::config::load_config(&json_str, &|_| None)
        .expect("emitted config must pass load_config");
}

// ── Smoke: --out writes the file ──────────────────────────────────────────

#[test]
fn import_out_flag_writes_file() {
    let spec = write_temp("oas2.json", openapi_spec());
    let mut out_path = std::env::temp_dir();
    out_path.push(format!("qa_import_{}_out.json", std::process::id()));
    let out = bin()
        .args([
            "import",
            "--input",
            spec.to_str().unwrap(),
            "--out",
            out_path.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0));
    // stdout must be empty (output went to file)
    assert!(
        out.stdout.is_empty(),
        "stdout must be empty when --out is used"
    );
    // File must exist and be valid JSON
    let content = std::fs::read_to_string(&out_path).expect("--out file must exist");
    let _: serde_json::Value =
        serde_json::from_str(&content).expect("--out file must be valid JSON");
    let _ = std::fs::remove_file(&out_path);
}

// ── Smoke: --base-url override ────────────────────────────────────────────

#[test]
fn import_base_url_override() {
    let spec = write_temp("oas3.json", openapi_spec());
    let out = bin()
        .args([
            "import",
            "--input",
            spec.to_str().unwrap(),
            "--base-url",
            "https://staging.pets.io",
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    let cfg: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(
        cfg["globals"]["variables"]["baseUrl"], "https://staging.pets.io",
        "--base-url must override servers[0]"
    );
}

// ── Smoke: relative url + no --base-url → stderr warn + exit 0 ────────────

#[test]
fn import_relative_url_no_base_url_warns_stderr_exit_0() {
    // A Postman spec with a relative url path — no --base-url → {{baseUrl}} templated + empty
    let spec_json = r#"{
      "info": { "name": "Bare", "_postman_id": "x",
                "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      "item": [{
        "name": "Health",
        "request": { "method": "GET", "url": "/health", "header": [] }
      }]
    }"#;
    let spec = write_temp("bare.json", spec_json);
    let out = bin()
        .args(["import", "--input", spec.to_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "must exit 0 even with baseUrl warning"
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("baseUrl") && (stderr.contains("warn") || stderr.contains("empty")),
        "must emit a baseUrl warning on stderr: {stderr}"
    );
}

// ── Smoke: unrecognized format → exit 2 + TS error string ─────────────────

#[test]
fn import_unrecognized_format_exits_2() {
    let spec = write_temp("unknown.json", r#"{"something":"else"}"#);
    let out = bin()
        .args(["import", "--input", spec.to_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(2),
        "unrecognized format must exit 2"
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Unrecognized format"),
        "must echo the TS error string: {stderr}"
    );
    assert!(
        stderr.contains("Postman"),
        "must mention Postman in error: {stderr}"
    );
}

// ── Smoke: non-JSON input → exit 2 + TS error string ──────────────────────

#[test]
fn import_non_json_exits_2() {
    let spec = write_temp("yaml.yaml", "openapi: '3.0.0'\npaths: {}\n");
    let out = bin()
        .args(["import", "--input", spec.to_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2), "non-JSON must exit 2");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Not valid JSON"),
        "must echo the TS JSON error string: {stderr}"
    );
    assert!(
        stderr.contains("YAML"),
        "must mention YAML in error: {stderr}"
    );
}

// ── Smoke: missing input file → exit 2 ────────────────────────────────────

#[test]
fn import_missing_input_exits_2() {
    let out = bin()
        .args([
            "import",
            "--input",
            "/tmp/qa-nonexistent-import-2c1f9a.json",
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2), "missing file must exit 2");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("error:") && stderr.contains("cannot read"),
        "stderr explains: {stderr}"
    );
}

// ── Smoke: collections are present and wired to request ids ───────────────

#[test]
fn import_collections_reference_valid_request_ids() {
    let spec = write_temp("pm2.json", postman_spec());
    let out = bin()
        .args(["import", "--input", spec.to_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    let cfg: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let req_ids: std::collections::HashSet<&str> = cfg["requests"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap())
        .collect();
    let colls = cfg["collections"].as_array().unwrap();
    assert!(!colls.is_empty(), "must have at least one collection");
    for coll in colls {
        for rid in coll["requests"].as_array().unwrap() {
            assert!(
                req_ids.contains(rid.as_str().unwrap()),
                "collection request ref '{}' must exist in requests[]",
                rid
            );
        }
    }
    // load_config validates refs — this confirms it too
    let json_str = serde_json::to_string(&cfg).unwrap();
    qa_touchstone_core::config::load_config(&json_str, &|_| None).expect("load_config must pass");
}
