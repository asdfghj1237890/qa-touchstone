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
