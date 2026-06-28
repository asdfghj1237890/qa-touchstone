use qa_touchstone_core::engine::{qa_substitute, NoDynamics};
use std::collections::BTreeMap;

#[derive(serde::Deserialize)]
struct SubCase {
    name: String,
    text: String,
    map: BTreeMap<String, String>,
    expected: String,
}

#[test]
fn substitute_matches_ts() {
    let raw = include_str!("fixtures/substitute.json");
    let cases: Vec<SubCase> = serde_json::from_str(raw).expect("parse fixtures");
    for c in &cases {
        let got = qa_substitute(&c.text, &c.map, &mut NoDynamics);
        assert_eq!(got, c.expected, "case {}", c.name);
    }
}

use qa_touchstone_core::engine::{qa_var_map, ScopedVars};

#[derive(serde::Deserialize)]
struct VarMapCase {
    name: String,
    vars: ScopedVars,
    env: Option<String>,
    #[serde(rename = "collectionId")]
    collection_id: Option<String>,
    #[serde(default)]
    local: Option<BTreeMap<String, String>>,
    expected: BTreeMap<String, String>,
}

#[test]
fn varmap_matches_ts() {
    let cases: Vec<VarMapCase> =
        serde_json::from_str(include_str!("fixtures/varmap.json")).unwrap();
    for c in &cases {
        let got = qa_var_map(
            &c.vars,
            c.env.as_deref(),
            c.collection_id.as_deref(),
            c.local.as_ref(),
        );
        assert_eq!(got, c.expected, "case {}", c.name);
    }
}

use qa_touchstone_core::engine::PinnedDynamics;

#[derive(serde::Deserialize)]
struct DynFile {
    #[serde(rename = "fixedNowMs")]
    fixed_now_ms: i64,
    floats: Vec<f64>,
    cases: Vec<DynCase>,
}
#[derive(serde::Deserialize)]
struct DynCase {
    name: String,
    text: String,
    expected: String,
}

#[test]
fn dynamics_match_ts() {
    let f: DynFile = serde_json::from_str(include_str!("fixtures/dynamics.json")).unwrap();
    for c in &f.cases {
        let mut dyns = PinnedDynamics::new(f.fixed_now_ms, f.floats.clone());
        let got = qa_substitute(&c.text, &Default::default(), &mut dyns);
        assert_eq!(got, c.expected, "case {}", c.name);
    }
}

use qa_touchstone_core::engine::run_assertions;
use serde_json::Value;

#[derive(serde::Deserialize)]
struct AssertFile {
    resp: Value,
    cases: Vec<AssertCase>,
}
#[derive(serde::Deserialize)]
struct AssertCase {
    name: String,
    a: Value,
    expected: Option<Value>,
}

#[test]
fn assertions_match_ts() {
    let f: AssertFile = serde_json::from_str(include_str!("fixtures/assertions.json")).unwrap();
    for c in &f.cases {
        let got = run_assertions(std::slice::from_ref(&c.a), &f.resp);
        match &c.expected {
            None => assert!(
                got.is_empty(),
                "case {} should be filtered (on:false)",
                c.name
            ),
            Some(exp) => {
                assert_eq!(got.len(), 1, "case {}", c.name);
                assert_eq!(got[0]["pass"], exp["pass"], "case {} pass", c.name);
                assert_eq!(got[0]["actual"], exp["actual"], "case {} actual", c.name);
            }
        }
    }
}
