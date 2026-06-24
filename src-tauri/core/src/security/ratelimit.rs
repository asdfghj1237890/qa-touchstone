//! Port of src/qa/ratelimit.ts — rate-limit / abuse engine pure logic.
//! Analysis helpers match ratelimit.ts EXACTLY (TS-fixtured). run_burst/run_ratelimit
//! are the async runner (Rust-unit/wiremock-tested; a documented CLI adaptation).
use serde_json::Value;

pub const MAX_N: i64 = 200;
pub const MAX_CONCURRENCY: i64 = 10;
pub const WEAK_AFTER_ABS: i64 = 20;
pub const WEAK_AFTER_FRAC: f64 = 0.5;

/// Lowercased header names that indicate a rate limiter is present. (ratelimit.ts:15-18)
pub const THROTTLE_HEADERS: [&str; 7] = [
    "retry-after", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset",
    "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset",
];

/// One burst cell. `status` is None for a net/transport error (excluded from completed).
/// Deserialize-friendly so the fixture's `{status, headers}` objects parse directly.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct BurstResponse {
    #[serde(default)] pub status: Option<i64>,
    #[serde(default)] pub headers: Value,
    #[serde(default)] pub time_ms: u64,
    #[serde(default)] pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThrottleSignal { pub throttled: bool, pub saw429: bool, pub header_hit: bool }

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ThrottleAnalysis {
    pub completed: i64, pub ok2xx: i64, pub c429: i64,
    pub saw429: bool, pub header_hit: bool, pub throttled: bool,
    pub first_throttled_index: i64, pub allowed_before_throttle: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strength { None, Weak, Strong }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateLimitVerdict { Pass, Vuln, Inconclusive }

/// True if any header name (case-insensitive) is in THROTTLE_HEADERS. (ratelimit.ts:31-33)
fn has_throttle_header(headers: &Value) -> bool {
    headers.as_object().map(|o| o.keys().any(|k| THROTTLE_HEADERS.contains(&k.to_lowercase().as_str()))).unwrap_or(false)
}

/// detectThrottleSignal (ratelimit.ts:23-37): any 429, or any rate-limit header.
pub fn detect_throttle_signal(responses: &[BurstResponse]) -> ThrottleSignal {
    let mut saw429 = false;
    let mut header_hit = false;
    for r in responses {
        if r.status == Some(429) { saw429 = true; }
        if has_throttle_header(&r.headers) { header_hit = true; }
        if saw429 && header_hit { break; }
    }
    ThrottleSignal { throttled: saw429 || header_hit, saw429, header_hit }
}

/// analyzeThrottle (ratelimit.ts:62-85). Quantifies how many requests slipped through
/// before the limiter engaged. Iterates in LAUNCH (slice) order.
pub fn analyze_throttle(responses: &[BurstResponse]) -> ThrottleAnalysis {
    let (mut completed, mut ok2xx, mut c429, mut allowed_before_throttle) = (0i64, 0i64, 0i64, 0i64);
    let (mut saw429, mut header_hit, mut first_throttled_index) = (false, false, -1i64);
    for (idx, r) in responses.iter().enumerate() {
        let idx = idx as i64;
        match r.status {
            Some(st) if st > 0 => {
                completed += 1;
                if st == 429 {
                    c429 += 1;
                    if !saw429 { saw429 = true; first_throttled_index = idx; }
                } else if (200..=299).contains(&st) {
                    ok2xx += 1;
                    if !saw429 { allowed_before_throttle += 1; }
                }
            }
            _ => {}
        }
        if has_throttle_header(&r.headers) { header_hit = true; }
    }
    ThrottleAnalysis { completed, ok2xx, c429, saw429, header_hit,
        throttled: saw429 || header_hit, first_throttled_index, allowed_before_throttle }
}

/// rateLimitStrength (ratelimit.ts:91-98): none / strong (429 within budget) / weak.
pub fn rate_limit_strength(a: &ThrottleAnalysis) -> Strength {
    if !a.saw429 && !a.header_hit { return Strength::None; }
    if a.saw429 {
        let budget = WEAK_AFTER_ABS.max(((a.completed as f64) * WEAK_AFTER_FRAC).ceil() as i64);
        return if a.allowed_before_throttle <= budget { Strength::Strong } else { Strength::Weak };
    }
    Strength::Weak // advertised by headers but never enforced in this burst
}

/// classifyRateLimit (ratelimit.ts:40-44): throttled → Pass; !throttled & completed>0 → Vuln; else Inconclusive.
pub fn classify_rate_limit(throttled: bool, completed: i64) -> RateLimitVerdict {
    if throttled { RateLimitVerdict::Pass }
    else if completed > 0 { RateLimitVerdict::Vuln }
    else { RateLimitVerdict::Inconclusive }
}

use crate::security::finding::Severity;
/// rateLimitSeverity (ratelimit.ts:100-103): only for a `vuln` verdict — sensitive → High else Low.
pub fn rate_limit_severity(sensitivity: Option<&str>, verdict: RateLimitVerdict) -> Option<Severity> {
    if verdict != RateLimitVerdict::Vuln { return None; }
    Some(if sensitivity == Some("sensitive") { Severity::High } else { Severity::Low })
}

use crate::config::{Auth, Config, Identity, Request};
use crate::engine::{qa_var_map, RealDynamics};
use crate::buildreq::{build_request, exec_opts_for};
use crate::step::{run_step, StepResult};
use crate::security::finding::{EngineError, EngineId, Finding};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

/// clampInt parity (ratelimit.ts:105-109): missing → lo; otherwise clamp into [lo, hi].
fn clamp_int(v: Option<i64>, lo: i64, hi: i64) -> i64 { v.unwrap_or(lo).max(lo).min(hi) }

fn cell_from_step(step: StepResult) -> BurstResponse {
    if step.success {
        // A 0/non-positive status is the transport-error sentinel → null (bucketed as net). (ratelimit.ts:140)
        BurstResponse { status: if step.status > 0 { Some(step.status) } else { None }, headers: step.headers, time_ms: step.ms, error: None }
    } else {
        BurstResponse { status: None, headers: Value::Null, time_ms: 0, error: step.error }
    }
}

/// Fire `n` (clamp 1..=200) requests at `concurrency` (clamp 1..=10) in flight via a tokio
/// JoinSet worker-pool (mirrors the TS Array.from({length:min(c,n)}, worker) pattern). Each
/// response is collected at its LAUNCH index `i` (NOT completion order) so allowed_before_throttle
/// analyzes in launch order. Never panics out of the burst; build/transport failures become net cells.
pub async fn run_burst(req: &Request, identity: &Identity, n: i64, concurrency: i64, var_map: &BTreeMap<String, String>) -> Vec<BurstResponse> {
    let n = clamp_int(Some(n), 1, MAX_N);
    let c = clamp_int(Some(concurrency), 1, MAX_CONCURRENCY);
    let counter = Arc::new(AtomicUsize::new(0));
    let mut set = tokio::task::JoinSet::new();
    let workers = c.min(n) as usize;
    for _ in 0..workers {
        let req = req.clone();
        let identity = identity.clone();
        let var_map = var_map.clone();
        let counter = counter.clone();
        let n_usize = n as usize;
        set.spawn(async move {
            let mut out: Vec<(usize, BurstResponse)> = Vec::new();
            loop {
                let i = counter.fetch_add(1, Ordering::Relaxed);
                if i >= n_usize { break; }
                let mut dyn_ = RealDynamics;
                let cell = match build_request(&req, &identity, &var_map, &mut dyn_) {
                    Ok(rd) => cell_from_step(run_step(&rd, &[], exec_opts_for(&identity.auth)).await),
                    Err(e) => BurstResponse { status: None, headers: Value::Null, time_ms: 0, error: Some(e) },
                };
                out.push((i, cell));
            }
            out
        });
    }
    let mut slots: Vec<Option<BurstResponse>> = (0..n as usize).map(|_| None).collect();
    while let Some(joined) = set.join_next().await {
        if let Ok(pairs) = joined { for (i, cell) in pairs { slots[i] = Some(cell); } }
    }
    slots.into_iter().flatten().collect()
}

/// Build a Finding from a completed burst (rlFindingFor, ratelimit.ts:192-220). None when the
/// endpoint is strongly protected or nothing landed. idValue masking is N/A (no idValues here).
fn rl_finding_for(test: &crate::config::RateLimitTest, req: &Request, idy: &str, responses: &[BurstResponse]) -> Option<Finding> {
    let a = analyze_throttle(responses);
    if a.completed == 0 { return None; } // inconclusive — nothing actually landed
    let sent = responses.len();
    let method = req.method.to_uppercase();
    let path = format!("{method} {}", test.request);
    let sensitive = test.sensitivity.as_deref() == Some("sensitive");
    match rate_limit_strength(&a) {
        Strength::None => {
            let severity = rate_limit_severity(test.sensitivity.as_deref(), RateLimitVerdict::Vuln)?;
            Some(Finding {
                engine: EngineId::RateLimit, severity, rule_id: "ratelimit.none".into(), oracle: "rate-limit".into(),
                title: "No rate limiting detected".into(), path,
                evidence: format!("{sent} requests, no 429/rate-limit headers"),
                method: Some(method), endpoint: Some(test.request.clone()), identity: Some(idy.to_string()),
            })
        }
        Strength::Weak => {
            let severity = if sensitive { Severity::Medium } else { Severity::Low };
            let evidence = if a.saw429 {
                format!("{} of {} requests succeeded before the first 429 — throttling engages late", a.allowed_before_throttle, sent)
            } else {
                format!("rate-limit headers present but no 429 enforced across {sent} requests")
            };
            Some(Finding {
                engine: EngineId::RateLimit, severity, rule_id: "ratelimit.weak".into(), oracle: "rate-limit".into(),
                title: "Weak rate limiting".into(), path, evidence,
                method: Some(method), endpoint: Some(test.request.clone()), identity: Some(idy.to_string()),
            })
        }
        Strength::Strong => None,
    }
}

/// Run rate-limit tests. Each test fires one burst at its request as its identity (or anon).
/// Returns (findings, errors). A burst that completes 0 requests → EngineError (no-false-clean).
pub async fn run_ratelimit(cfg: &Config, env: Option<&str>) -> (Vec<Finding>, Vec<EngineError>) {
    let rcfg = match cfg.security.as_ref().and_then(|s| s.rate_limit.as_ref()) { Some(r) => r, None => return (vec![], vec![]) };
    let scoped = cfg.scoped_vars();
    let var_map = qa_var_map(&scoped, env, None, None);
    let anon = Identity { id: "(none)".into(), auth: Auth::None, privileged: false };
    let mut findings = Vec::new();
    let mut errors: Vec<EngineError> = Vec::new();

    for test in &rcfg.tests {
        let req = match cfg.requests.iter().find(|r| r.id == test.request) { Some(r) => r, None => continue };
        // identity: Some → that identity (validated to exist); None → local anonymous.
        let identity = match &test.identity {
            Some(id) => match cfg.identities.iter().find(|i| &i.id == id) { Some(i) => i, None => continue },
            None => &anon,
        };
        let idy = identity.id.clone();
        // clamp with a stderr note (spec Nit) so a typo'd huge n/concurrency is visible.
        let n = clamp_int(test.n, 1, MAX_N);
        let c = clamp_int(test.concurrency, 1, MAX_CONCURRENCY);
        if test.n.map(|v| v != n).unwrap_or(false) { eprintln!("warn: rateLimit test `{}` n clamped to {}", test.id, n); }
        if test.concurrency.map(|v| v != c).unwrap_or(false) { eprintln!("warn: rateLimit test `{}` concurrency clamped to {}", test.id, c); }

        let responses = run_burst(req, identity, n, c, &var_map).await;
        let completed = responses.iter().filter(|r| r.status.map(|s| s > 0).unwrap_or(false)).count();
        if completed == 0 {
            // The burst could not run (all net errors / build failures) — surface, don't false-pass.
            // Message carries only the test id + counts (never the resolved URL / reqwest error).
            errors.push(EngineError {
                engine: EngineId::RateLimit, endpoint: Some(test.request.clone()), identity: Some(idy.clone()),
                message: format!("rate-limit test `{}`: no requests completed ({} sent, all net errors)", test.id, responses.len()),
            });
            continue;
        }
        if let Some(f) = rl_finding_for(test, req, &idy, &responses) { findings.push(f); }
    }
    (findings, errors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn r(status: Option<i64>, headers: Value) -> BurstResponse { BurstResponse { status, headers, time_ms: 0, error: None } }

    #[test]
    fn detect_429_and_header() {
        assert!(detect_throttle_signal(&[r(Some(200), json!({})), r(Some(429), json!({}))]).saw429);
        assert!(detect_throttle_signal(&[r(Some(200), json!({"Retry-After":"1"}))]).header_hit);
        assert!(!detect_throttle_signal(&[r(Some(200), json!({"x":"y"}))]).throttled);
    }

    #[test]
    fn strength_none_weak_strong() {
        let none = analyze_throttle(&[r(Some(200), json!({})), r(Some(200), json!({}))]);
        assert_eq!(rate_limit_strength(&none), Strength::None);
        let strong = analyze_throttle(&[r(Some(200), json!({})), r(Some(429), json!({}))]);
        assert_eq!(rate_limit_strength(&strong), Strength::Strong);
        let weak = analyze_throttle(&[r(Some(200), json!({"RateLimit-Limit":"100"}))]);
        assert_eq!(rate_limit_strength(&weak), Strength::Weak);
    }

    #[test]
    fn classify_and_severity() {
        assert_eq!(classify_rate_limit(true, 5), RateLimitVerdict::Pass);
        assert_eq!(classify_rate_limit(false, 5), RateLimitVerdict::Vuln);
        assert_eq!(classify_rate_limit(false, 0), RateLimitVerdict::Inconclusive);
        assert_eq!(rate_limit_severity(Some("sensitive"), RateLimitVerdict::Vuln), Some(Severity::High));
        assert_eq!(rate_limit_severity(None, RateLimitVerdict::Vuln), Some(Severity::Low));
        assert_eq!(rate_limit_severity(Some("sensitive"), RateLimitVerdict::Pass), None);
    }
}
