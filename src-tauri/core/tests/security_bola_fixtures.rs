use qa_touchstone_core::security::bola::*;
use serde_json::Value;

#[derive(serde::Deserialize)]
struct File {
    #[serde(rename = "denySet")] deny_set: Vec<i64>,
    #[serde(rename = "match")] match_cases: Vec<MatchCase>,
    classify: Vec<ClassifyCase>,
    ncf: Vec<NcfCase>,
    control: Vec<ControlCase>,
    #[serde(rename = "idKey")] id_key: Vec<IdKeyCase>,
    synth: Vec<SynthCase>,
}

#[derive(serde::Deserialize)]
struct MatchCase { name: String, attack: Value, owner: Value, idv: Value, expected: bool }

#[derive(serde::Deserialize)]
struct ClassifyCase { name: String, status: Option<i64>, matched: bool, expected: String }

#[derive(serde::Deserialize)]
struct NcfCase { name: String, status: Option<i64>, matched: bool, expected: bool }

#[derive(serde::Deserialize)]
struct ControlCase { name: String, control: Value, owner: Value, idv: Value, synth: String, expected: bool }

#[derive(serde::Deserialize)]
struct IdKeyCase { name: String, key: String, expected: bool }

#[derive(serde::Deserialize)]
struct SynthCase { name: String, sample: Value, expected: String }

fn verdict_str(v: BolaVerdict) -> &'static str {
    match v {
        BolaVerdict::Pass => "pass",
        BolaVerdict::Vuln => "vuln",
        BolaVerdict::Unconfirmed => "unconfirmed",
        BolaVerdict::Inconclusive => "inconclusive",
    }
}

#[test]
fn bola_matches_ts() {
    let f: File = serde_json::from_str(include_str!("fixtures/security_bola.json")).unwrap();

    for c in &f.match_cases {
        let got = matches_owner(&c.attack, &c.owner, &c.idv);
        assert_eq!(got, c.expected, "match case `{}`", c.name);
    }

    for c in &f.classify {
        let got = verdict_str(classify_bola(c.status, c.matched, &f.deny_set));
        assert_eq!(got, c.expected, "classify case `{}`", c.name);
    }

    for c in &f.ncf {
        let got = negative_control_failed(c.status, &f.deny_set, c.matched);
        assert_eq!(got, c.expected, "ncf case `{}`", c.name);
    }

    for c in &f.control {
        let got = control_suggests_ignored_id(&c.control, &c.owner, &c.idv, &c.synth);
        assert_eq!(got, c.expected, "control case `{}`", c.name);
    }

    for c in &f.id_key {
        let got = is_identity_key(&c.key);
        assert_eq!(got, c.expected, "idKey case `{}`", c.name);
    }

    for c in &f.synth {
        let got = synthetic_id_for(&c.sample);
        assert_eq!(got, c.expected, "synth case `{}`", c.name);
    }
}
