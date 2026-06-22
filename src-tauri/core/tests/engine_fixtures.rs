use qa_touchstone_core::engine::{qa_substitute, NoDynamics};
use std::collections::BTreeMap;

#[derive(serde::Deserialize)]
struct SubCase { name: String, text: String, map: BTreeMap<String, String>, expected: String }

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
    #[serde(rename = "collectionId")] collection_id: Option<String>,
    expected: BTreeMap<String, String>,
}

#[test]
fn varmap_matches_ts() {
    let cases: Vec<VarMapCase> = serde_json::from_str(include_str!("fixtures/varmap.json")).unwrap();
    for c in &cases {
        let got = qa_var_map(&c.vars, c.env.as_deref(), c.collection_id.as_deref(), None);
        assert_eq!(got, c.expected, "case {}", c.name);
    }
}

use qa_touchstone_core::engine::PinnedDynamics;

#[derive(serde::Deserialize)]
struct DynFile { #[serde(rename="fixedNowMs")] fixed_now_ms: i64, floats: Vec<f64>, cases: Vec<DynCase> }
#[derive(serde::Deserialize)]
struct DynCase { name: String, text: String, expected: String }

#[test]
fn dynamics_match_ts() {
    let f: DynFile = serde_json::from_str(include_str!("fixtures/dynamics.json")).unwrap();
    for c in &f.cases {
        let mut dyns = PinnedDynamics::new(f.fixed_now_ms, f.floats.clone());
        let got = qa_substitute(&c.text, &Default::default(), &mut dyns);
        assert_eq!(got, c.expected, "case {}", c.name);
    }
}
