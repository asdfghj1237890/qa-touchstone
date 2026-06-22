use qa_touchstone_core::datafile::{js_string, parse_data_file};
use serde_json::Value;

#[derive(serde::Deserialize)]
struct DataCase {
    name: String,
    text: String,
    file: String,
    expected: Value,
}

#[derive(serde::Deserialize)]
struct CoerceCase {
    name: String,
    value: Value,
    expected: String,
}

#[test]
fn datafile_matches_ts() {
    let cases: Vec<DataCase> =
        serde_json::from_str(include_str!("fixtures/datafile.json")).unwrap();
    for c in &cases {
        let got = parse_data_file(&c.text, Some(&c.file));
        let got_json = serde_json::to_value(&got).unwrap();
        assert_eq!(got_json, c.expected, "case {}", c.name);
    }
}

#[test]
fn js_string_matches_ts() {
    let cases: Vec<CoerceCase> =
        serde_json::from_str(include_str!("fixtures/coercion.json")).unwrap();
    for c in &cases {
        assert_eq!(js_string(&c.value), c.expected, "case {}", c.name);
    }
}
