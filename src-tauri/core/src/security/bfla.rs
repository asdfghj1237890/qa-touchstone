//! Port of src/qa/bfla.ts — BFLA (Broken Function-Level Authorization) pure logic.
//! OWASP API5: every privileged endpoint × every non-privileged identity, expect deny.
//! Reuses authz::{endpoint_privileged, classify_response_outcome, is_mutating_method,
//! DEFAULT_DENY_SET, Outcome, Verdict}. The runner lives in this same file (mirrors bola.rs).
use crate::security::authz::{
    classify_response_outcome, endpoint_privileged, is_mutating_method, Outcome, Verdict,
};
use crate::security::finding::{EngineId, Finding, Severity};
use serde_json::Value;

// ── Abstract descriptors (pure helper is callable by runner and fixture bridge) ──

pub struct BflaEndpoint {
    pub method: String,
    pub path: String, // URL path, for privileged-detection only
    pub privileged: Option<bool>,
}

pub struct BflaIdentity {
    pub id: String,
    pub privileged: bool,
}

pub struct BflaPair {
    pub endpoint_index: usize,
    pub identity_index: usize,
}

// ── Pure helpers (TS-golden-fixtured) ─────────────────────────────────────────

/// bflaPlan (bfla.ts:20-31): privileged endpoints × non-privileged identities, endpoint-major.
pub fn bfla_plan(endpoints: &[BflaEndpoint], identities: &[BflaIdentity]) -> Vec<BflaPair> {
    let mut pairs = Vec::new();
    for (ei, ep) in endpoints.iter().enumerate() {
        if !endpoint_privileged(ep.privileged, &ep.method, &ep.path) {
            continue;
        }
        for (ii, id) in identities.iter().enumerate() {
            if id.privileged {
                continue; // privileged identity is not the attacker
            }
            pairs.push(BflaPair {
                endpoint_index: ei,
                identity_index: ii,
            });
        }
    }
    pairs
}

/// classifyBfla (bfla.ts:35-40): Allowed → Vuln, Denied → Pass, Other → Inconclusive.
pub fn classify_bfla(status: Option<i64>, body: &Value, deny_set: &[i64]) -> Verdict {
    match classify_response_outcome(status, body, deny_set) {
        Outcome::Allowed => Verdict::Vuln,
        Outcome::Denied => Verdict::Pass,
        Outcome::Other => Verdict::Inconclusive,
    }
}

/// bflaSeverity (bfla.ts:42-45): Vuln + mutating → Critical, Vuln + read → High, else None.
pub fn bfla_severity(method: &str, verdict: Verdict) -> Option<Severity> {
    if verdict != Verdict::Vuln {
        return None;
    }
    Some(if is_mutating_method(method) {
        Severity::Critical
    } else {
        Severity::High
    })
}

/// bflaFinding: build a Finding for a BFLA violation. Returns None for non-vuln verdicts.
/// NOTE: evidence uses identity_id directly (Rust Identity has no `name` field; TS used
/// `identity.name || identity.id`). Callers MUST uppercase method ONCE before calling.
pub fn bfla_finding(
    method: &str,
    request_id: &str,
    identity_id: &str,
    verdict: Verdict,
) -> Option<Finding> {
    let severity = bfla_severity(method, verdict)?;
    Some(Finding {
        engine: EngineId::Bfla,
        severity,
        rule_id: "bfla".into(),
        oracle: "bfla".into(),
        title: "Broken function-level authorization".into(),
        path: format!("{} {}", method, request_id),
        evidence: format!(
            "{} (non-privileged) invoked a privileged function",
            identity_id
        ),
        method: Some(method.into()),
        endpoint: Some(request_id.into()),
        identity: Some(identity_id.into()),
    })
}

// ── Runner ────────────────────────────────────────────────────────────────────

use crate::config::{Config, Identity, Request};
use crate::security::finding::EngineError;
use crate::security::runner::run_security_step;

/// run_bfla: mirrors run_bola's structure. Returns (vec![], vec![]) when no security.bfla block.
pub async fn run_bfla(cfg: &Config, env: Option<&str>) -> (Vec<Finding>, Vec<EngineError>) {
    let bcfg = match cfg.security.as_ref().and_then(|s| s.bfla.as_ref()) {
        Some(b) => b,
        None => return (vec![], vec![]),
    };
    // Empty `denySet: []` is honored as-is (user says no status is a hard-deny), like matrix; an
    // ABSENT denySet already defaulted to [401,403,404] via serde at config load.
    let deny_set = bcfg.deny_set.clone();

    // Build filtered request list (bfla.endpoints non-empty ⇒ filter; else all).
    let reqs: Vec<&Request> = if bcfg.endpoints.is_empty() {
        cfg.requests.iter().collect()
    } else {
        cfg.requests
            .iter()
            .filter(|r| bcfg.endpoints.contains(&r.id))
            .collect()
    };

    // Build parallel BflaEndpoint descriptors. `path` is used ONLY for privileged-detection
    // (admin-path tokens) — parse the RAW url exactly like run_matrix (runner.rs): a templated
    // url fails Url::parse and falls back to the raw string, which still carries the path tokens.
    // No {{var}} substitution here — run_security_step does its own substitution via build_request.
    let endpoints: Vec<BflaEndpoint> = reqs
        .iter()
        .map(|req| {
            let path = reqwest::Url::parse(&req.url)
                .map(|u| u.path().to_string())
                .unwrap_or_else(|_| req.url.clone());
            BflaEndpoint {
                method: req.method.clone(),
                path,
                privileged: req.privileged,
            }
        })
        .collect();

    // All identities.
    let identities_ref: Vec<&Identity> = cfg.identities.iter().collect();
    let bfla_identities: Vec<BflaIdentity> = identities_ref
        .iter()
        .map(|i| BflaIdentity {
            id: i.id.clone(),
            privileged: i.privileged,
        })
        .collect();

    let plan = bfla_plan(&endpoints, &bfla_identities);

    let mut findings: Vec<Finding> = Vec::new();
    let mut errors: Vec<EngineError> = Vec::new();

    for pair in &plan {
        let req = reqs[pair.endpoint_index];
        let identity = identities_ref[pair.identity_index];
        let req_id = &req.id;
        let method = req.method.to_uppercase(); // uppercase ONCE

        let step = run_security_step(cfg, req, identity, env).await;
        if !step.success {
            errors.push(EngineError {
                engine: EngineId::Bfla,
                endpoint: Some(req_id.clone()),
                identity: Some(identity.id.clone()),
                // method+req_id only; step.error may carry the resolved URL → redacted at scan output.
                message: format!(
                    "{} {}: {}",
                    method,
                    req_id,
                    step.error.as_deref().unwrap_or("request failed")
                ),
            });
            continue;
        }

        let verdict = classify_bfla(Some(step.status), &step.body, &deny_set);
        if let Some(finding) = bfla_finding(&method, req_id, &identity.id, verdict) {
            findings.push(finding);
        }
    }

    (findings, errors)
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ep(method: &str, path: &str, privileged: Option<bool>) -> BflaEndpoint {
        BflaEndpoint {
            method: method.into(),
            path: path.into(),
            privileged,
        }
    }
    fn id(id: &str, privileged: bool) -> BflaIdentity {
        BflaIdentity {
            id: id.into(),
            privileged,
        }
    }

    #[test]
    fn bfla_plan_crosses_priv_ep_with_nonpriv_id() {
        let eps = vec![ep("DELETE", "/admin/x", None), ep("GET", "/u", None)];
        let ids = vec![id("admin", true), id("anon", false)];
        let plan = bfla_plan(&eps, &ids);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].endpoint_index, 0); // DELETE /admin/x (priv via heuristic)
        assert_eq!(plan[0].identity_index, 1); // anon (non-priv)
    }

    #[test]
    fn bfla_plan_explicit_privileged_override() {
        // explicit privileged:true on a GET (non-mutating) => still included
        let eps = vec![ep("GET", "/u", Some(true))];
        let ids = vec![id("anon", false)];
        let plan = bfla_plan(&eps, &ids);
        assert_eq!(plan.len(), 1);
        // explicit privileged:false on a DELETE => excluded
        let eps2 = vec![ep("DELETE", "/admin/x", Some(false))];
        let plan2 = bfla_plan(&eps2, &ids);
        assert_eq!(plan2.len(), 0, "explicit false overrides DELETE heuristic");
    }

    #[test]
    fn classify_bfla_cases() {
        let deny = &[401i64, 403, 404];
        assert_eq!(classify_bfla(Some(200), &json!({}), deny), Verdict::Vuln);
        assert_eq!(classify_bfla(Some(403), &json!({}), deny), Verdict::Pass);
        assert_eq!(
            classify_bfla(Some(500), &json!({}), deny),
            Verdict::Inconclusive
        );
        assert_eq!(classify_bfla(None, &json!({}), deny), Verdict::Inconclusive);
        // soft-deny: 200 with error body => denied => pass
        assert_eq!(
            classify_bfla(Some(200), &json!({"error":"Access denied"}), deny),
            Verdict::Pass
        );
    }

    #[test]
    fn bfla_severity_cases() {
        assert_eq!(
            bfla_severity("DELETE", Verdict::Vuln),
            Some(Severity::Critical)
        );
        assert_eq!(
            bfla_severity("POST", Verdict::Vuln),
            Some(Severity::Critical)
        );
        assert_eq!(
            bfla_severity("PUT", Verdict::Vuln),
            Some(Severity::Critical)
        );
        assert_eq!(
            bfla_severity("PATCH", Verdict::Vuln),
            Some(Severity::Critical)
        );
        assert_eq!(bfla_severity("GET", Verdict::Vuln), Some(Severity::High));
        assert_eq!(bfla_severity("get", Verdict::Vuln), Some(Severity::High)); // case-insensitive via is_mutating_method
        assert_eq!(bfla_severity("DELETE", Verdict::Pass), None);
        assert_eq!(bfla_severity("GET", Verdict::Inconclusive), None);
    }

    #[test]
    fn bfla_finding_shape() {
        let f = bfla_finding("DELETE", "deleteAdmin", "anon", Verdict::Vuln).unwrap();
        assert_eq!(f.engine, EngineId::Bfla);
        assert_eq!(f.severity, Severity::Critical);
        assert_eq!(f.rule_id, "bfla");
        assert_eq!(f.oracle, "bfla");
        assert_eq!(f.title, "Broken function-level authorization");
        assert_eq!(f.path, "DELETE deleteAdmin");
        assert_eq!(
            f.evidence,
            "anon (non-privileged) invoked a privileged function"
        );
        assert_eq!(f.method, Some("DELETE".into()));
        assert_eq!(f.endpoint, Some("deleteAdmin".into()));
        assert_eq!(f.identity, Some("anon".into()));
    }

    #[test]
    fn bfla_finding_none_for_non_vuln() {
        assert!(bfla_finding("DELETE", "r", "anon", Verdict::Pass).is_none());
        assert!(bfla_finding("DELETE", "r", "anon", Verdict::Inconclusive).is_none());
    }

    #[test]
    fn bfla_finding_get_is_high() {
        let f = bfla_finding("GET", "getAdmin", "anon", Verdict::Vuln).unwrap();
        assert_eq!(f.severity, Severity::High);
    }
}
