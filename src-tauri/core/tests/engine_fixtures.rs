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
