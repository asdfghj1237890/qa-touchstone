//! Request×identity runner adapter + the matrix loop. Produces Findings; no printing/redaction.
use crate::buildreq::build_request;
use crate::config::{Auth, Config, Expectation, Identity, Request};
use crate::engine::{qa_var_map, RealDynamics};
use crate::executor::ExecOptions;
use crate::security::authz::{classify_response_outcome, default_expectation, endpoint_privileged, verdict_for, Verdict};
use crate::security::finding::{EngineError, EngineId, Finding, Severity};
use crate::step::{run_step, StepResult};

fn exec_opts_for(auth: &Auth) -> ExecOptions {
    // Bearer/Basic `Authorization` + `Cookie` are covered by the executor's built-in
    // sensitive-header list; here we additionally mark a custom api-key-in-header so it is
    // stripped on cross-origin redirects.
    let sensitive_header_names = match auth {
        Auth::ApiKey { key, location: crate::config::ApiKeyIn::Header, .. } => vec![key.clone()],
        _ => vec![],
    };
    ExecOptions { sensitive_header_names, ..Default::default() }
}

/// Run one (request, identity): build with that identity's auth, execute, NO assertions.
pub async fn run_security_step(cfg: &Config, req: &Request, identity: &Identity, env: Option<&str>) -> StepResult {
    let scoped = cfg.scoped_vars();
    let map = qa_var_map(&scoped, env, None, None);
    match build_request(req, identity, &map, &mut RealDynamics) {
        Ok(rd) => run_step(&rd, &[], exec_opts_for(&identity.auth)).await,
        Err(e) => StepResult { success: false, status: 0, ms: 0, final_url: String::new(),
            error: Some(e), headers: serde_json::Value::Null, body: serde_json::Value::Null, results: vec![] },
    }
}

/// run_matrix: each endpoint × identity → verdict; a Vuln cell → a Finding.
/// Mirrors authz.ts runMatrix (skip Expectation::Skip; fill missing cells with defaults).
/// Returns `(findings, errors)`: errors are per-cell build/exec failures (not vulnerabilities).
pub async fn run_matrix(cfg: &Config, env: Option<&str>) -> (Vec<Finding>, Vec<EngineError>) {
    let sec = match cfg.security.as_ref().and_then(|s| s.matrix.as_ref()) { Some(m) => m, None => return (vec![], vec![]) };
    // Trust the config layer: MatrixConfig.deny_set defaults to [401,403,404] when absent, and an
    // explicit `denySet:[]` (user says no status is a hard-deny) is honored as-is.
    let deny_set = sec.deny_set.as_slice();
    let endpoint_ids: Vec<&String> = if sec.endpoints.is_empty() { cfg.requests.iter().map(|r| &r.id).collect() } else { sec.endpoints.iter().collect() };
    let mut findings = Vec::new();
    let mut errors: Vec<EngineError> = Vec::new();
    for eid in endpoint_ids {
        let req = match cfg.requests.iter().find(|r| &r.id == eid) { Some(r) => r, None => continue };
        // classify on the URL PATH only — a host like `admin.example.com` must NOT mark the endpoint privileged.
        let path = reqwest::Url::parse(&req.url).map(|u| u.path().to_string()).unwrap_or_else(|_| req.url.clone());
        let ep_priv = endpoint_privileged(req.privileged, &req.method, &path);
        for identity in &cfg.identities {
            let auth_none = matches!(identity.auth, Auth::None);
            let expectation = sec.expect.get(eid).and_then(|row| row.get(&identity.id)).copied()
                .unwrap_or_else(|| default_expectation(auth_none, identity.privileged, ep_priv));
            if expectation == Expectation::Skip { continue; } // skip: no run (avoid a wasted HTTP call)
            let step = run_security_step(cfg, req, identity, env).await;
            if !step.success {
                errors.push(EngineError {
                    engine: EngineId::Matrix,
                    endpoint: Some(eid.clone()),
                    identity: Some(identity.id.clone()),
                    // method+eid only here; step.error may carry the resolved URL → redacted at scan output.
                    message: format!("{} {}: {}", req.method.to_uppercase(), eid, step.error.as_deref().unwrap_or("request failed")),
                });
                continue;
            }
            let outcome = classify_response_outcome(Some(step.status), &step.body, deny_set);
            if let Some(Verdict::Vuln) = verdict_for(expectation, outcome) {
                let method = req.method.to_uppercase();
                // SP2 definition: write method → Critical, read → High (both ≥ High → gate).
                let severity = if matches!(method.as_str(), "POST" | "PUT" | "PATCH" | "DELETE") { Severity::Critical } else { Severity::High };
                findings.push(Finding {
                    engine: EngineId::Matrix, severity, rule_id: "matrix.deny-bypass".into(), oracle: "matrix-cell".into(),
                    title: "Access-control bypass (deny expected, access allowed)".into(),
                    path: format!("{} {}", method, eid),
                    evidence: format!("identity `{}` reached `{} {}` (expected deny; status {})", identity.id, method, eid, step.status),
                    method: Some(method), endpoint: Some(eid.clone()), identity: Some(identity.id.clone()),
                });
            }
        }
    }
    (findings, errors)
}
