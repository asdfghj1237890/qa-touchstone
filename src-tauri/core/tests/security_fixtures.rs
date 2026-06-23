use qa_touchstone_core::config::Expectation;
use qa_touchstone_core::security::authz::*;
use serde_json::Value;

#[derive(serde::Deserialize)]
struct File { #[serde(rename="denySet")] deny_set: Vec<i64>, outcome: Vec<OutcomeC>, resp: Vec<RespC>, verdict: Vec<VerdictC>, endpoint: Vec<EndpointC>, #[serde(rename="defaultExpect")] default_expect: Vec<DefaultC> }
#[derive(serde::Deserialize)] struct OutcomeC { name: String, status: Option<i64>, expected: String }
#[derive(serde::Deserialize)] struct RespC { name: String, status: Option<i64>, body: Value, expected: String }
#[derive(serde::Deserialize)] struct VerdictC { name: String, expectation: String, outcome: String, expected: Option<String> }
#[derive(serde::Deserialize)] struct EndpointC { name: String, method: String, path: String, expected: bool }
#[derive(serde::Deserialize)] struct DefaultC { name: String, identity: Value, endpoint: Value, expected: String }

fn outcome_str(o: Outcome) -> &'static str { match o { Outcome::Allowed=>"allowed", Outcome::Denied=>"denied", Outcome::Other=>"other" } }
fn verdict_str(v: Verdict) -> &'static str { match v { Verdict::Pass=>"pass", Verdict::Fail=>"fail", Verdict::Vuln=>"vuln", Verdict::Inconclusive=>"inconclusive" } }
fn exp(s: &str) -> Expectation { match s { "allow"=>Expectation::Allow, "deny"=>Expectation::Deny, _=>Expectation::Skip } }
fn exp_str(e: Expectation) -> &'static str { match e { Expectation::Allow=>"allow", Expectation::Deny=>"deny", Expectation::Skip=>"skip" } }

#[test]
fn authz_matches_ts() {
    let f: File = serde_json::from_str(include_str!("fixtures/security_authz.json")).unwrap();
    for c in &f.outcome { assert_eq!(outcome_str(classify_outcome(c.status, &f.deny_set)), c.expected, "outcome {}", c.name); }
    for c in &f.resp { assert_eq!(outcome_str(classify_response_outcome(c.status, &c.body, &f.deny_set)), c.expected, "resp {}", c.name); }
    for c in &f.verdict {
        let got = verdict_for(exp(&c.expectation), match c.outcome.as_str(){"allowed"=>Outcome::Allowed,"denied"=>Outcome::Denied,_=>Outcome::Other});
        assert_eq!(got.map(verdict_str), c.expected.as_deref(), "verdict {}", c.name);
    }
    for c in &f.endpoint { assert_eq!(classify_endpoint(&c.method, &c.path), c.expected, "endpoint {}", c.name); }
    for c in &f.default_expect {
        let auth_none = c.identity["auth"]["type"] == "none";
        let id_priv = c.identity["privileged"] == true;
        let ep_priv = classify_endpoint(c.endpoint["method"].as_str().unwrap(), c.endpoint["path"].as_str().unwrap());
        assert_eq!(exp_str(default_expectation(auth_none, id_priv, ep_priv)), c.expected, "defaultExpect {}", c.name);
    }
}
