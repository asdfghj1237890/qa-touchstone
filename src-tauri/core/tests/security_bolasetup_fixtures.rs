//! TS-vs-Rust golden fixture test for detect_id_location (bolaSetup.ts port).
//! Ordered-Vec compare: candidate order must match exactly (sorted score-desc by both sides).
use qa_touchstone_core::security::bola::{detect_id_location, DetectableRequest, BolaIdCandidate};
use qa_touchstone_core::config::IdLocation;

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    req: ReqIn,
    expected: Vec<CandidateIn>,
}

#[derive(serde::Deserialize)]
struct ReqIn {
    url: String,
    params: Vec<ParamIn>,
    body: Option<String>,
}

#[derive(serde::Deserialize)]
struct ParamIn {
    key: String,
    value: serde_json::Value,
}

/// Mirrors the TS BolaIdCandidate serialized shape:
/// { idLocation: {kind, index|key|path}, value, confidence, why }
#[derive(serde::Deserialize, Debug, PartialEq, Eq)]
struct CandidateIn {
    #[serde(rename = "idLocation")] id_location: IdLocation,
    value: String,
    confidence: String,
    why: String,
}

#[test]
fn bolasetup_matches_ts() {
    let cases: Vec<Case> = serde_json::from_str(
        include_str!("fixtures/security_bolasetup.json")
    ).unwrap();

    for c in &cases {
        // Build DetectableRequest. params: coerce value to String via js_string parity
        // (TS does String(p.value ?? '')); values in the fixture are already strings
        // because we wrote them as string literals in gen-fixtures, but guard for numbers.
        let params: Vec<(String, String)> = c.req.params.iter().map(|p| {
            let v = match &p.value {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Null => String::new(),
                other => other.to_string(),
            };
            (p.key.clone(), v)
        }).collect();

        let req = DetectableRequest {
            url: c.req.url.clone(),
            params,
            body: c.req.body.clone(),
        };

        let got: Vec<BolaIdCandidate> = detect_id_location(&req);

        // Convert got to the comparable shape
        let got_cmp: Vec<CandidateIn> = got.iter().map(|g| CandidateIn {
            id_location: g.id_location.clone(),
            value: g.value.clone(),
            confidence: g.confidence.clone(),
            why: g.why.clone(),
        }).collect();

        // Ordered compare (the candidate list IS a ranking). Every fixture case uses DISTINCT
        // candidate scores, so order is deterministic across TS object-insertion vs Rust
        // serde_json key order; for EQUAL-score candidates the relative order is unspecified
        // (non-contract) — the cases deliberately avoid such ties.
        assert_eq!(
            got_cmp, c.expected,
            "bolasetup case `{}`: Rust detect_id_location output must match TS detectIdLocation output",
            c.name
        );
    }
}
