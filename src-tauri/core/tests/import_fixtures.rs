//! TS-vs-Rust golden fixture test for qa_parse_import (import-parser.ts port).
//! Structure compare: collection.name/source/base_url + folders[name → requests[method/name/path/params/headers/body/auth]].
//! No ids, no responses (dropped as non-deterministic / GUI-only).
use qa_touchstone_core::import::{qa_parse_import, Format, ImportParsed, ImportRequest};

#[derive(serde::Deserialize, Debug)]
struct Fixture {
    postman: RustImportParsed,
    openapi: RustImportParsed,
    errors: ErrorCases,
}

#[derive(serde::Deserialize, Debug)]
struct ErrorCases {
    bad_json: String,
    unknown: String,
}

#[derive(serde::Deserialize, Debug)]
struct RustImportParsed {
    collection: RustCollection,
    folders: Vec<RustFolder>,
}

#[derive(serde::Deserialize, Debug)]
struct RustCollection {
    name: String,
    source: String,          // "postman" | "openapi"
    base_url: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
struct RustFolder {
    name: String,
    requests: Vec<RustRequest>,
}

#[derive(serde::Deserialize, Debug)]
struct RustRequest {
    method: String,
    name: String,
    path: String,
    params: Vec<RustKvOn>,
    headers: Vec<RustKvOn>,
    body: Option<String>,
    auth: String,
}

#[derive(serde::Deserialize, Debug, PartialEq)]
struct RustKvOn { key: String, value: String, on: bool }

fn source_str(f: &Format) -> &'static str {
    match f { Format::Postman => "postman", Format::OpenApi => "openapi" }
}

fn compare_request(got: &ImportRequest, exp: &RustRequest, label: &str) {
    assert_eq!(got.method, exp.method, "{label}: method");
    assert_eq!(got.name,   exp.name,   "{label}: name");
    assert_eq!(got.path,   exp.path,   "{label}: path");
    assert_eq!(got.body,   exp.body,   "{label}: body");
    assert_eq!(got.auth,   exp.auth,   "{label}: auth");
    // params
    let got_params: Vec<RustKvOn> = got.params.iter().map(|k| RustKvOn { key: k.key.clone(), value: k.value.clone(), on: k.on }).collect();
    let exp_params: Vec<RustKvOn> = exp.params.iter().map(|k| RustKvOn { key: k.key.clone(), value: k.value.clone(), on: k.on }).collect();
    assert_eq!(got_params, exp_params, "{label}: params");
    // headers
    let got_hdrs: Vec<RustKvOn> = got.headers.iter().map(|k| RustKvOn { key: k.key.clone(), value: k.value.clone(), on: k.on }).collect();
    let exp_hdrs: Vec<RustKvOn> = exp.headers.iter().map(|k| RustKvOn { key: k.key.clone(), value: k.value.clone(), on: k.on }).collect();
    assert_eq!(got_hdrs, exp_hdrs, "{label}: headers");
}

fn compare_parsed(got: &ImportParsed, exp: &RustImportParsed, label: &str) {
    assert_eq!(got.collection.name,     exp.collection.name,                       "{label}: collection.name");
    assert_eq!(source_str(&got.collection.source), exp.collection.source.as_str(), "{label}: collection.source");
    assert_eq!(got.collection.base_url, exp.collection.base_url,                   "{label}: collection.base_url");
    assert_eq!(got.folders.len(), exp.folders.len(), "{label}: folder count");
    for (fi, (gf, ef)) in got.folders.iter().zip(exp.folders.iter()).enumerate() {
        assert_eq!(gf.name, ef.name, "{label}: folder[{fi}].name");
        assert_eq!(gf.requests.len(), ef.requests.len(), "{label}: folder[{fi}] request count");
        for (ri, (gr, er)) in gf.requests.iter().zip(ef.requests.iter()).enumerate() {
            compare_request(gr, er, &format!("{label}: folder[{fi}].req[{ri}]"));
        }
    }
}

// Include the fixture at compile time (gen-fixtures must run first).
static FIXTURE: &str = include_str!("fixtures/import.json");

#[test]
fn import_postman_matches_ts() {
    let f: Fixture = serde_json::from_str(FIXTURE).expect("fixture must parse");
    let postman_spec = serde_json::json!({
        "info": { "name": "Pet Store", "_postman_id": "abc123",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
        "item": [
            { "name": "List Pets", "request": { "method": "GET",
                "url": "https://api.pets.io/v1/pets?limit=10",
                "header": [
                    { "key": "Accept", "value": "application/json", "disabled": false },
                    { "key": "X-Internal", "value": "secret", "disabled": true }
                ] } },
            { "name": "Create Pet", "request": { "method": "POST",
                "url": { "raw": "https://api.pets.io/v1/pets", "path": ["v1","pets"], "query": [] },
                "header": [{ "key": "Content-Type", "value": "application/json", "disabled": false }],
                "body": { "mode": "raw", "raw": "{\"name\":\"Buddy\",\"species\":\"dog\"}" } } },
            { "name": "Users", "item": [
                { "name": "Get User", "request": { "method": "GET",
                    "url": { "raw": "https://api.pets.io/v1/users/{{userId}}",
                             "path": ["v1","users","{{userId}}"],
                             "query": [{ "key": "include", "value": "pets", "disabled": false }] },
                    "header": [] } }
            ] }
        ]
    }).to_string();

    let got = qa_parse_import(&postman_spec).expect("Postman parse must succeed");
    compare_parsed(&got, &f.postman, "postman");
}

#[test]
fn import_openapi_matches_ts() {
    let f: Fixture = serde_json::from_str(FIXTURE).expect("fixture must parse");
    let oas_spec = r#"{
      "openapi": "3.0.3",
      "info": { "title": "Pet API", "version": "1.0.0" },
      "servers": [{ "url": "https://api.pets.io" }],
      "paths": {
        "/pets": {
          "get": { "summary": "List all pets", "tags": ["pets"],
            "parameters": [
              { "name": "limit",  "in": "query", "required": true,  "example": 20 },
              { "name": "offset", "in": "query", "required": false, "example": 0  },
              { "name": "X-Trace-Id", "in": "header" }
            ], "security": [] },
          "post": { "summary": "Create pet", "tags": ["pets"], "security": [{ "bearerAuth": [] }],
            "requestBody": { "content": { "application/json": { "schema": {
              "type": "object",
              "properties": {
                "name":    { "type": "string",  "example": "Buddy" },
                "active":  { "type": "boolean", "example": false },
                "score":   { "type": "number",  "example": 0 },
                "species": { "type": "string",  "example": "" },
                "count":   { "type": "integer", "example": null },
                "tags":    { "type": "array" }
              }
            } } } } }
        },
        "/pets/{id}": {
          "get": { "summary": "Get pet", "operationId": "getPetById", "tags": ["pets"],
            "parameters": [],
            "requestBody": { "content": { "application/json": { "schema": {
              "type": "object", "example": 0,
              "properties": { "id": { "type": "integer" } }
            } } } } }
        },
        "/users": {
          "get": { "summary": "List users", "tags": ["users"],
            "parameters": [{ "name": "role", "in": "query", "required": true }] }
        },
        "/orders": {
          "post": { "summary": "Create order", "tags": ["orders"],
            "requestBody": { "content": { "application/json": {
              "example": 0,
              "schema": { "type": "object", "properties": { "total": { "type": "number" } } }
            } } } },
          "put": { "summary": "Replace order", "tags": ["orders"],
            "requestBody": { "content": { "application/json": {
              "example": "",
              "schema": { "type": "object", "properties": { "note": { "type": "string" } } }
            } } } }
        }
      }
    }"#;

    let got = qa_parse_import(oas_spec).expect("OpenAPI parse must succeed");
    compare_parsed(&got, &f.openapi, "openapi");
}

#[test]
fn import_error_strings_match_ts() {
    let f: Fixture = serde_json::from_str(FIXTURE).expect("fixture must parse");
    // Verify the TS error strings match what we expect (locking them against future TS changes)
    assert_eq!(f.errors.bad_json, "Not valid JSON. (YAML specs must be converted to JSON first.)");
    assert_eq!(f.errors.unknown, "Unrecognized format \u{2014} expected a Postman v2.1 collection or an OpenAPI/Swagger spec.");
    // Verify Rust produces the same strings
    assert_eq!(qa_parse_import("not json").unwrap_err(), f.errors.bad_json);
    assert_eq!(qa_parse_import(r#"{"x":1}"#).unwrap_err(), f.errors.unknown);
}
