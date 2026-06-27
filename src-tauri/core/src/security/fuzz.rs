//! Port of src/qa/fuzz.ts — input fuzzing engine (pure logic + runner).
//! Mutates request inputs with 12 boundary/injection payloads and classifies
//! responses for server errors, internal-error leaks, and dangerous reflections.
use crate::config::{FuzzSeedCfg, IdLocation};
use crate::security::bola::walk_json;
use crate::security::finding::{EngineId, Finding, Severity};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;

/// Tags a payload whose verbatim reflection is a vulnerability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FuzzDanger { Sqli, Xss, Traversal, Format, Overflow }

/// One boundary or injection payload.
#[derive(Debug, Clone)]
pub struct FuzzPayload {
    pub id: &'static str,
    pub value: String,          // String not &str — long/null-byte/rtl are built at runtime
    pub dangerous: Option<FuzzDanger>,
}

/// The 12 fixed payloads, in spec order.
/// Built via char::from_u32 / repeat so the source stays clean ASCII (mirrors fuzz.ts NUL/RTL rationale).
pub static FUZZ_PAYLOADS: std::sync::LazyLock<Vec<FuzzPayload>> = std::sync::LazyLock::new(|| {
    let nul: char = char::from_u32(0).unwrap();          // '\0' — NUL byte
    let rtl: char = char::from_u32(0x202e).unwrap();     // '\u{202e}' — RTL override
    vec![
        FuzzPayload { id: "empty",          value: String::new(),                                dangerous: None },
        FuzzPayload { id: "space",          value: "   ".into(),                                  dangerous: None },
        FuzzPayload { id: "long",           value: "A".repeat(8192),                              dangerous: None },
        FuzzPayload { id: "null-byte",      value: format!("x{}y", nul),                         dangerous: None },
        FuzzPayload { id: "neg",            value: "-1".into(),                                   dangerous: None },
        FuzzPayload { id: "big-int",        value: "999999999999999999999999".into(),             dangerous: Some(FuzzDanger::Overflow) },
        FuzzPayload { id: "sqli",           value: "' OR '1'='1".into(),                          dangerous: Some(FuzzDanger::Sqli) },
        FuzzPayload { id: "sqli-comment",   value: "1;--".into(),                                 dangerous: Some(FuzzDanger::Sqli) },
        FuzzPayload { id: "xss",            value: "<script>alert(1)</script>".into(),            dangerous: Some(FuzzDanger::Xss) },
        FuzzPayload { id: "path-traversal", value: "../../../../etc/passwd".into(),               dangerous: Some(FuzzDanger::Traversal) },
        FuzzPayload { id: "format-string",  value: "%s%n%x%x".into(),                            dangerous: Some(FuzzDanger::Format) },
        FuzzPayload { id: "unicode-rtl",    value: format!("{}abc", rtl),                        dangerous: None },
    ]
});

/// Compiled ERROR_SIGNATURES regexes. Compiled once via OnceLock, ASCII mode.
/// Pattern-by-pattern translation from fuzz.ts:51-60, line by line:
///
///   TS: /\bat [\w$.]+\([^)]*:\d+(?::\d+)?\)/
///   RS: r"(?-u:\b)at [0-9A-Za-z_$.]+\([^)]*:\d+(?::\d+)?\)"      — JS/Java stack frame
///
///   TS: /Traceback \(most recent call last\)/
///   RS: r"Traceback \(most recent call last\)"      — Python traceback (literal, no specials)
///
///   TS: /\b(?:SQL syntax|SQLSTATE|SQLException|ORA-\d{5}|PG::\w+|near ".+": syntax error)\b/i
///   RS: r#"(?i)(?-u:\b)(?:SQL syntax|SQLSTATE|SQLException|ORA-\d{5}|PG::(?-u:\w)+|near ".+": syntax error)(?-u:\b)"#
///
///   TS: /\bjava\.lang\.\w+(?:Exception|Error)\b/
///   RS: r"(?-u:\b)java\.lang\.(?-u:\w)+(?:Exception|Error)(?-u:\b)"   — JVM exception
///
///   TS: /\bSystem\.\w+Exception\b/
///   RS: r"(?-u:\b)System\.(?-u:\w)+Exception(?-u:\b)"                 — .NET System.*Exception
///
///   TS: /<b>(?:Warning|Fatal error|Notice|Parse error)<\/b>:/
///   RS: r"<b>(?:Warning|Fatal error|Notice|Parse error)</b>:"  — PHP error tag
///
///   TS: /goroutine \d+ \[/
///   RS: r"goroutine \d+ \["                         — Go panic goroutine
///
///   TS: /\bUnhandledPromiseRejection\b|\bECONNREFUSED\b/
///   RS: r"(?-u:\b)UnhandledPromiseRejection(?-u:\b)|(?-u:\b)ECONNREFUSED(?-u:\b)"  — Node-ish
fn error_signatures() -> &'static [Regex] {
    static SIGS: OnceLock<Vec<Regex>> = OnceLock::new();
    SIGS.get_or_init(|| {
        // ASCII mode (JS \b/\w semantics): scope \b/\w per-token with (?-u:…); . / [^)] / .+
        // stay default (they would otherwise allow invalid UTF-8 on &str). The in-class \w of
        // the old [\w$.] cannot be scoped ([(?-u:\w)] is illegal) so it is expanded to
        // [0-9A-Za-z_$.]. Order is positional — the keyed fixture + family unit test index by it.
        let patterns: &[&str] = &[
            // JS/Java "at fn(file:line:col)"
            r"(?-u:\b)at [0-9A-Za-z_$.]+\([^)]*:\d+(?::\d+)?\)",
            // Python traceback
            r"Traceback \(most recent call last\)",
            // SQL errors (case-insensitive)
            r#"(?i)(?-u:\b)(?:SQL syntax|SQLSTATE|SQLException|ORA-\d{5}|PG::(?-u:\w)+|near ".+": syntax error)(?-u:\b)"#,
            // JVM exception
            r"(?-u:\b)java\.lang\.(?-u:\w)+(?:Exception|Error)(?-u:\b)",
            // .NET System.*Exception
            r"(?-u:\b)System\.(?-u:\w)+Exception(?-u:\b)",
            // PHP error tag
            r"<b>(?:Warning|Fatal error|Notice|Parse error)</b>:",
            // Go panic goroutine
            r"goroutine \d+ \[",
            // Node-ish
            r"(?-u:\b)UnhandledPromiseRejection(?-u:\b)|(?-u:\b)ECONNREFUSED(?-u:\b)",
        ];
        patterns.iter().map(|p| Regex::new(p).expect("ERROR_SIGNATURES pattern failed to compile")).collect()
    })
}

/// Mirrors fuzz.ts bodyToString: null→"", string→as-is, else JSON stringify.
/// Used for ERROR_SIGNATURES matching; result is NEVER stored in a finding.
pub fn body_to_string(body: &Value) -> String {
    match body {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FuzzSignal { ServerError, ErrorLeak, Reflected, Ok }

/// Verdict from classifying one fuzz response.
pub struct FuzzVerdict {
    pub signal: FuzzSignal,
    pub severity: Option<Severity>,
}

/// The response subset the pure classifier reads. The runner adapts the executor result here.
pub struct QaResponse {
    pub status: Option<i64>,
    pub body: Value,
}

/// One expanded fuzz case: a payload bound to one seed location.
pub struct FuzzCase<'a> {
    pub seed_name: &'a str,
    pub location: &'a IdLocation,
    pub payload: &'a FuzzPayload,
}

/// Port of fuzz.ts classifyFuzzResponse — PURE, golden-fixtured.
/// Priority: 5xx → ServerError/High; ERROR_SIGNATURE match → ErrorLeak/High;
/// dangerous payload reflected verbatim (non-empty) → Reflected (xss→High else Medium); else Ok/None.
pub fn classify_fuzz_response(payload: Option<&FuzzPayload>, resp: Option<&QaResponse>) -> FuzzVerdict {
    let status = resp.and_then(|r| r.status);
    if status.map(|s| s >= 500).unwrap_or(false) {
        return FuzzVerdict { signal: FuzzSignal::ServerError, severity: Some(Severity::High) };
    }
    let body_str = resp.map(|r| body_to_string(&r.body)).unwrap_or_default();
    if error_signatures().iter().any(|re| re.is_match(&body_str)) {
        return FuzzVerdict { signal: FuzzSignal::ErrorLeak, severity: Some(Severity::High) };
    }
    if let Some(p) = payload {
        if let Some(danger) = p.dangerous {
            if !p.value.is_empty() && body_str.contains(&p.value) {
                let sev = if danger == FuzzDanger::Xss { Severity::High } else { Severity::Medium };
                return FuzzVerdict { signal: FuzzSignal::Reflected, severity: Some(sev) };
            }
        }
    }
    FuzzVerdict { signal: FuzzSignal::Ok, severity: None }
}

fn signal_title(signal: FuzzSignal) -> &'static str {
    match signal {
        FuzzSignal::ServerError => "Fuzz input caused a server error (5xx)",
        FuzzSignal::ErrorLeak   => "Fuzz input leaked an internal error / stack trace",
        FuzzSignal::Reflected   => "Fuzz input reflected unescaped in the response",
        FuzzSignal::Ok          => "",
    }
}

/// Expand one seed into one FuzzCase per payload (12 total). Carries location by reference.
pub fn fuzz_cases_for<'a>(seed_name: &'a str, location: &'a IdLocation) -> impl Iterator<Item = FuzzCase<'a>> {
    FUZZ_PAYLOADS.iter().map(move |p| FuzzCase { seed_name, location, payload: p })
}

/// Build a Finding for one fuzz case, or None if the verdict is Ok / has no severity.
/// NOTE: `source` field is OMITTED — the Rust Finding model (finding.rs:15) has no `source` field.
/// The runner overrides path/identity/endpoint/evidence for the CLI shape; pure fn uses the naive shape.
pub fn fuzz_finding(method: &str, request_path: &str, case: &FuzzCase<'_>, resp: Option<&QaResponse>) -> Option<Finding> {
    let verdict = classify_fuzz_response(Some(case.payload), resp);
    let severity = verdict.severity?;
    if verdict.signal == FuzzSignal::Ok { return None; }
    Some(Finding {
        engine:   EngineId::Fuzz,
        severity,
        rule_id:  format!("fuzz:{}", signal_wire_token(verdict.signal)),
        oracle:   "fuzz".into(),
        title:    signal_title(verdict.signal).into(),
        path:     format!("{} {}", method, request_path),
        evidence: format!("payload \"{}\" on {}", case.payload.id, case.seed_name),
        method:   Some(method.into()),
        endpoint: None,
        identity: None,
    })
}

fn signal_wire_token(signal: FuzzSignal) -> &'static str {
    match signal {
        FuzzSignal::ServerError => "server-error",
        FuzzSignal::ErrorLeak   => "error-leak",
        FuzzSignal::Reflected   => "reflected",
        FuzzSignal::Ok          => "ok",
    }
}

const DEFAULT_MAX_SEEDS: usize = 50;

/// Canonical `loc_token` for an IdLocation. Mirrors `id_location_token` in scan.rs
/// but is defined here so fuzz.rs and scan.rs share the same formula.
pub fn loc_token(loc: &IdLocation) -> String {
    match loc {
        IdLocation::Path { index } => format!("path:{index}"),
        IdLocation::Query { key } => format!("query:{key}"),
        IdLocation::Body { path } => format!("body:{path}"),
    }
}

/// Derive the effective seed set for one fuzz target.
///
/// Arguments:
///   `resolved_url`    — the request URL AFTER `{{var}}` substitution (so path-segment
///                       indexing uses the real resolved path, matching apply_id_location).
///   `structured_query`— the `Request.query` key-value pairs (BEFORE any URL-append).
///   `body`            — the parsed request body JSON (None if absent or non-JSON).
///   `explicit`        — the `target.seeds` list from config (may be None or empty).
///   `max`             — the per-target seed cap (default 50 when None).
///
/// Returns `Vec<(seed_name, loc_token_str, IdLocation)>` in explicit-first, deduped,
/// capped order. The caller (both runner and build_scope_descriptor) iterates this to
/// drive the fuzz loop and the scopeHash respectively.
pub fn derive_fuzz_seeds(
    resolved_url: &str,
    structured_query: &[crate::config::Kv],
    body: Option<&Value>,
    explicit: Option<&[FuzzSeedCfg]>,
    max: Option<usize>,
    request_id: &str,     // used in the truncation warning message only
) -> Vec<(String, String, IdLocation)> {
    let cap = max.unwrap_or(DEFAULT_MAX_SEEDS).max(1); // validated >= 1 at config load
    let mut result: Vec<(String, String, IdLocation)> = Vec::new();
    let mut seen_tokens: HashSet<String> = HashSet::new();

    // 1. Explicit seeds — FIRST, so cap never drops them.
    if let Some(seeds) = explicit {
        for s in seeds {
            let tok = loc_token(&s.location);
            if seen_tokens.insert(tok.clone()) {
                result.push((s.name.clone(), tok, s.location.clone()));
            }
        }
    }

    // 2. Auto-derive path seeds: parse resolved URL, enumerate NON-EMPTY segments.
    //    Indexing matches apply_id_location's Path branch (bola.rs:334-335).
    let path_only = resolved_url.split('?').next().unwrap_or(resolved_url).split('#').next().unwrap_or("");
    if let Ok(url) = reqwest::Url::parse(resolved_url) {
        let all_segs: Vec<String> = url.path_segments()
            .map(|s| s.map(str::to_string).collect())
            .unwrap_or_default();
        let non_empty_positions: Vec<usize> = all_segs.iter().enumerate()
            .filter(|(_, s)| !s.is_empty())
            .map(|(i, _)| i)
            .collect();
        for (path_idx, _raw_pos) in non_empty_positions.iter().enumerate() {
            let tok = format!("path:{path_idx}");
            if seen_tokens.insert(tok.clone()) {
                result.push((format!("path[{path_idx}]"), tok, IdLocation::Path { index: path_idx }));
            }
        }
    } else {
        // Non-parseable (e.g. still-templated) URL: parse path manually.
        let segs: Vec<&str> = path_only.split('/').filter(|s| !s.is_empty()).collect();
        for (i, _) in segs.iter().enumerate() {
            let tok = format!("path:{i}");
            if seen_tokens.insert(tok.clone()) {
                result.push((format!("path[{i}]"), tok, IdLocation::Path { index: i }));
            }
        }
    }

    // 3. Auto-derive query seeds: structured query first (RAW keys), then inline URL decoded keys.
    for kv in structured_query {
        let tok = format!("query:{}", kv.key);
        if seen_tokens.insert(tok.clone()) {
            result.push((kv.key.clone(), tok, IdLocation::Query { key: kv.key.clone() }));
        }
    }
    // Inline URL query keys (decoded — apply_id_location drops the same-key URL pair).
    if let Ok(url) = reqwest::Url::parse(resolved_url) {
        for (k, _v) in url.query_pairs() {
            let key = k.into_owned();
            // Skip if the same key already in structured query.
            let tok = format!("query:{key}");
            if seen_tokens.insert(tok.clone()) {
                result.push((key.clone(), tok, IdLocation::Query { key }));
            }
        }
    }

    // 4. Auto-derive body seeds via walk_json (scalar leaves only).
    if let Some(body_val) = body {
        if body_val.is_object() || body_val.is_array() {
            walk_json(body_val, "", 0, &mut |path, _key, val| {
                if val.is_null() || val.is_object() || val.is_array() { return; }
                let tok = format!("body:{path}");
                if seen_tokens.insert(tok.clone()) {
                    result.push((path.to_string(), tok, IdLocation::Body { path: path.to_string() }));
                }
            });
        }
    }

    // 5. Cap: keep first N. Truncation is a WARN (not an EngineError).
    if result.len() > cap {
        let total = result.len();
        result.truncate(cap);
        log::warn!("fuzz: target `{request_id}`: fuzzed first {cap} of {total} inputs (raise maxSeedsPerTarget to fuzz all)");
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payloads_length_is_12() {
        assert_eq!(FUZZ_PAYLOADS.len(), 12, "spec requires exactly 12 payloads");
    }

    #[test]
    fn payload_xss_is_dangerous_xss() {
        let xss = FUZZ_PAYLOADS.iter().find(|p| p.id == "xss").unwrap();
        assert_eq!(xss.dangerous, Some(FuzzDanger::Xss));
        assert!(xss.value.contains("<script>alert(1)</script>"));
    }

    #[test]
    fn payload_empty_is_not_dangerous() {
        let empty = FUZZ_PAYLOADS.iter().find(|p| p.id == "empty").unwrap();
        assert!(empty.dangerous.is_none());
        assert!(empty.value.is_empty());
    }

    #[test]
    fn payload_null_byte_contains_nul() {
        let nb = FUZZ_PAYLOADS.iter().find(|p| p.id == "null-byte").unwrap();
        assert!(nb.value.contains('\0'), "null-byte payload must contain NUL character");
    }

    #[test]
    fn payload_rtl_starts_with_rtl_char() {
        let rtl = FUZZ_PAYLOADS.iter().find(|p| p.id == "unicode-rtl").unwrap();
        assert!(rtl.value.starts_with('\u{202e}'));
    }

    #[test]
    fn payload_long_is_8192_chars() {
        let long = FUZZ_PAYLOADS.iter().find(|p| p.id == "long").unwrap();
        assert_eq!(long.value.len(), 8192);
        assert!(long.value.chars().all(|c| c == 'A'));
    }

    #[test]
    fn error_signatures_compile_and_match_families() {
        let sigs = error_signatures();
        assert_eq!(sigs.len(), 8, "must have exactly 8 signatures");

        let cases: &[(&str, &str)] = &[
            ("js",     "    at Object.fn(app.js:10:3)"),
            ("python", "Traceback (most recent call last)"),
            ("sql",    "You have an error in your SQL syntax near \"1\": syntax error"),
            ("jvm",    "java.lang.NullPointerException"),
            ("dotnet", "System.NullReferenceException"),
            ("php",    "<b>Fatal error</b>: Uncaught"),
            ("go",     "goroutine 1 [running],"),
            ("node",   "UnhandledPromiseRejection"),
        ];
        for (i, (family, input)) in cases.iter().enumerate() {
            assert!(
                sigs[i].is_match(input),
                "ERROR_SIGNATURES[{i}] (family `{family}`) must match `{input}`"
            );
        }
    }

    #[test]
    fn error_signatures_do_not_match_clean_body() {
        let sigs = error_signatures();
        let clean = r#"{"status":"ok","data":[1,2,3]}"#;
        for (i, sig) in sigs.iter().enumerate() {
            assert!(!sig.is_match(clean), "signature[{i}] must not match a clean JSON body");
        }
    }

    #[test]
    fn classify_5xx_is_server_error_high() {
        let resp = QaResponse { status: Some(500), body: Value::String(String::new()) };
        let xss = FUZZ_PAYLOADS.iter().find(|p| p.id == "xss").unwrap();
        let v = classify_fuzz_response(Some(xss), Some(&resp));
        assert_eq!(v.signal, FuzzSignal::ServerError);
        assert_eq!(v.severity, Some(Severity::High));
    }

    #[test]
    fn classify_sql_error_leak_is_high() {
        let resp = QaResponse { status: Some(200), body: Value::String("You have an error in your SQL syntax near \"'\": syntax error".into()) };
        let sqli = FUZZ_PAYLOADS.iter().find(|p| p.id == "sqli").unwrap();
        let v = classify_fuzz_response(Some(sqli), Some(&resp));
        assert_eq!(v.signal, FuzzSignal::ErrorLeak);
        assert_eq!(v.severity, Some(Severity::High));
    }

    #[test]
    fn classify_reflected_xss_is_high() {
        let payload = FUZZ_PAYLOADS.iter().find(|p| p.id == "xss").unwrap();
        let resp = QaResponse { status: Some(200), body: Value::String(format!("<div>{}</div>", payload.value)) };
        let v = classify_fuzz_response(Some(payload), Some(&resp));
        assert_eq!(v.signal, FuzzSignal::Reflected);
        assert_eq!(v.severity, Some(Severity::High));
    }

    #[test]
    fn classify_reflected_sqli_is_medium() {
        let payload = FUZZ_PAYLOADS.iter().find(|p| p.id == "sqli").unwrap();
        let resp = QaResponse { status: Some(200), body: Value::String(format!("echo: {}", payload.value)) };
        let v = classify_fuzz_response(Some(payload), Some(&resp));
        assert_eq!(v.signal, FuzzSignal::Reflected);
        assert_eq!(v.severity, Some(Severity::Medium));
    }

    #[test]
    fn classify_clean_400_is_ok() {
        let payload = FUZZ_PAYLOADS.iter().find(|p| p.id == "sqli").unwrap();
        let resp = QaResponse { status: Some(400), body: serde_json::json!({"error":"invalid id"}) };
        let v = classify_fuzz_response(Some(payload), Some(&resp));
        assert_eq!(v.signal, FuzzSignal::Ok);
        assert!(v.severity.is_none());
    }

    #[test]
    fn classify_echoed_benign_empty_payload_is_ok() {
        let payload = FUZZ_PAYLOADS.iter().find(|p| p.id == "empty").unwrap();
        let resp = QaResponse { status: Some(200), body: Value::String(String::new()) };
        let v = classify_fuzz_response(Some(payload), Some(&resp));
        assert_eq!(v.signal, FuzzSignal::Ok, "empty payload echo is never a reflection vuln");
    }

    #[test]
    fn fuzz_finding_server_error_shape() {
        let location = IdLocation::Query { key: "id".into() };
        let long = FUZZ_PAYLOADS.iter().find(|p| p.id == "long").unwrap();
        let case = FuzzCase { seed_name: "id", location: &location, payload: long };
        let resp = QaResponse { status: Some(500), body: Value::String(String::new()) };
        let f = fuzz_finding("GET", "/items", &case, Some(&resp)).unwrap();
        assert_eq!(f.rule_id, "fuzz:server-error");
        assert_eq!(f.severity, Severity::High);
        assert_eq!(f.path, "GET /items");
        assert!(f.evidence.contains("long"));
        assert!(f.evidence.contains("id"));
    }

    #[test]
    fn fuzz_finding_clean_returns_none() {
        let location = IdLocation::Query { key: "q".into() };
        let sqli = FUZZ_PAYLOADS.iter().find(|p| p.id == "sqli").unwrap();
        let case = FuzzCase { seed_name: "q", location: &location, payload: sqli };
        let resp = QaResponse { status: Some(200), body: serde_json::json!({"ok": true}) };
        assert!(fuzz_finding("GET", "/search", &case, Some(&resp)).is_none());
    }

    #[test]
    fn fuzz_cases_for_returns_12() {
        let loc = IdLocation::Query { key: "id".into() };
        let cases: Vec<_> = fuzz_cases_for("id", &loc).collect();
        assert_eq!(cases.len(), 12);
        assert!(cases.iter().all(|c| c.seed_name == "id"));
        assert!(cases.iter().all(|c| std::ptr::eq(c.location, &loc)));
    }

    #[test]
    fn derive_seeds_path_indexes_non_empty_segments() {
        // URL: https://api.example.com/orders/123/items
        // Non-empty segments: ["orders","123","items"] at raw positions [1,2,3]
        // → path:0, path:1, path:2 (index into the non-empty subset)
        let seeds = derive_fuzz_seeds(
            "https://api.example.com/orders/123/items",
            &[], None, None, None, "r",
        );
        let toks: Vec<&str> = seeds.iter().map(|(_, t, _)| t.as_str()).collect();
        assert!(toks.contains(&"path:0"), "path:0 for 'orders'");
        assert!(toks.contains(&"path:1"), "path:1 for '123'");
        assert!(toks.contains(&"path:2"), "path:2 for 'items'");
        assert!(!toks.iter().any(|t| t.starts_with("path:3")), "only 3 non-empty segments");
    }

    #[test]
    fn derive_seeds_query_structured_uses_raw_key() {
        use crate::config::Kv;
        let q = vec![Kv { key: "user_id".into(), value: "42".into() }];
        let seeds = derive_fuzz_seeds("https://api.example.com/u", &q, None, None, None, "r");
        let toks: Vec<&str> = seeds.iter().map(|(_, t, _)| t.as_str()).collect();
        assert!(toks.contains(&"query:user_id"));
    }

    #[test]
    fn derive_seeds_body_leaves_via_walk_json() {
        let body = serde_json::json!({ "order": { "id": 1 }, "tag": "x" });
        let seeds = derive_fuzz_seeds("https://api.example.com/u", &[], Some(&body), None, None, "r");
        let toks: Vec<&str> = seeds.iter().map(|(_, t, _)| t.as_str()).collect();
        assert!(toks.contains(&"body:order.id"));
        assert!(toks.contains(&"body:tag"));
    }

    #[test]
    fn derive_seeds_explicit_first_and_not_dropped_by_cap() {
        use crate::config::{Kv, FuzzSeedCfg};
        // Explicit seed for path:0, cap=1 → explicit survives, auto path:0 is deduped.
        let explicit = vec![FuzzSeedCfg { name: "my-id".into(), location: IdLocation::Path { index: 0 } }];
        // Use a URL with many path segments to generate lots of auto seeds.
        let seeds = derive_fuzz_seeds(
            "https://api.example.com/a/b/c/d/e/f",
            &[], None, Some(&explicit), Some(1), "r",
        );
        assert_eq!(seeds.len(), 1, "cap=1 keeps exactly 1 seed");
        assert_eq!(seeds[0].0, "my-id", "explicit seed must be the survivor (explicit-first)");
    }

    #[test]
    fn derive_seeds_dedup_by_loc_token_not_name() {
        use crate::config::FuzzSeedCfg;
        // Two explicit seeds with same loc_token but different names → second is deduped
        let explicit = vec![
            FuzzSeedCfg { name: "id-A".into(), location: IdLocation::Path { index: 0 } },
            FuzzSeedCfg { name: "id-B".into(), location: IdLocation::Path { index: 0 } },
        ];
        let seeds = derive_fuzz_seeds("https://h/x", &[], None, Some(&explicit), None, "r");
        let path0: Vec<_> = seeds.iter().filter(|(_, t, _)| t == "path:0").collect();
        assert_eq!(path0.len(), 1, "duplicate loc_token must produce only one seed");
    }

    #[test]
    fn loc_token_formats() {
        assert_eq!(loc_token(&IdLocation::Path { index: 2 }), "path:2");
        assert_eq!(loc_token(&IdLocation::Query { key: "user_id".into() }), "query:user_id");
        assert_eq!(loc_token(&IdLocation::Body { path: "order.id".into() }), "body:order.id");
    }
}
