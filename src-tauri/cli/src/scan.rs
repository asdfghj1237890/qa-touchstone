//! `scan` command: run the security suite (matrix -> bola -> ratelimit), redact (union of all identity
//! secrets), emit findings (JSON/human), baseline-aware gate (New >= fail_on => exit 3), SARIF emit,
//! atomic bless. Exit codes: 0 ok, 1 runtime error, 2 invalid input, 3 findings gate.
use qa_touchstone_core::config::{load_config, Config};
use qa_touchstone_core::redact::RedactionSet;
use qa_touchstone_core::security::finding::{EngineError, EngineId, Finding, Severity};
use qa_touchstone_core::security::lifecycle::{
    diff_runs, fingerprint, gate_count, scope_hash_of, snapshot_of, AnnotationsFile, Records, Snapshot, FP_VERSION,
};
use qa_touchstone_core::security::report::{build_report, report_to_sarif, report_to_html, report_to_junit};
use serde::Serialize;
use std::process::ExitCode;

#[derive(Serialize)]
struct ScanReport { engines: Vec<EngineSummary>, findings: Vec<RFinding>, errors: Vec<RError>, totals: Totals, ok: bool }
#[derive(Serialize)]
struct EngineSummary { engine: String, ran: bool, findings: usize, errors: usize }
#[derive(Serialize)]
struct Totals { critical: usize, high: usize, medium: usize, low: usize, info: usize, errors: usize }
#[derive(Serialize)]
struct RFinding {
    fp: String,
    engine: String, severity: String, rule_id: String, oracle: String,
    title: String, path: String, evidence: String,
    #[serde(skip_serializing_if = "Option::is_none")] method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] identity: Option<String>,
}
#[derive(Serialize)]
struct RError {
    engine: String,
    #[serde(skip_serializing_if = "Option::is_none")] endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] identity: Option<String>,
    message: String,
}

fn sev_str(s: Severity) -> &'static str {
    match s { Severity::Critical=>"critical", Severity::High=>"high", Severity::Medium=>"medium", Severity::Low=>"low", Severity::Info=>"info" }
}
fn engine_str(e: EngineId) -> &'static str {
    match e { EngineId::Matrix=>"matrix", EngineId::Bola=>"bola", EngineId::RateLimit=>"ratelimit", EngineId::Oracle=>"oracle" }
}

/// Explicit, stable wire tokens for scope-descriptor enums (NOT Debug — a code-shape detail
/// that could silently shift the scopeHash on a derive change).
fn expectation_token(e: &qa_touchstone_core::config::Expectation) -> &'static str {
    use qa_touchstone_core::config::Expectation;
    match e { Expectation::Allow => "allow", Expectation::Deny => "deny", Expectation::Skip => "skip" }
}
fn id_location_token(l: &qa_touchstone_core::config::IdLocation) -> String {
    use qa_touchstone_core::config::IdLocation;
    match l { IdLocation::Path { index } => format!("path:{index}"), IdLocation::Query { key } => format!("query:{key}"), IdLocation::Body { path } => format!("body:{path}") }
}
fn auth_kind_token(a: &qa_touchstone_core::config::Auth) -> &'static str {
    use qa_touchstone_core::config::Auth::*;
    match a { None => "none", Bearer { .. } => "bearer", ApiKey { .. } => "apikey", Basic { .. } => "basic" }
}
fn apikey_in_token(l: &qa_touchstone_core::config::ApiKeyIn) -> &'static str {
    use qa_touchstone_core::config::ApiKeyIn;
    match l { ApiKeyIn::Header => "header", ApiKeyIn::Query => "query" }
}
fn body_mode_token(m: &qa_touchstone_core::config::BodyMode) -> &'static str {
    use qa_touchstone_core::config::BodyMode;
    match m { BodyMode::None => "none", BodyMode::Json => "json", BodyMode::Raw => "raw" }
}

/// Reduce a request url to its canonical drift surface — `scheme://host[:port]/path` — dropping
/// userinfo (`user:pass@`), the `?query`, and the `#fragment`, ANY of which can carry a hardcoded
/// literal secret that the baseline's FNV digest would otherwise expose to brute-force. Pure string
/// ops so templated urls (e.g. `{{apiHost}}/x`) are handled too: no `://` => just strip query/fragment.
fn scope_url(url: &str) -> String {
    let before_frag = url.split('#').next().unwrap_or("");
    let before_q = before_frag.split('?').next().unwrap_or("");
    match before_q.find("://") {
        Some(p) => {
            let (scheme_sep, rest) = before_q.split_at(p + 3); // "scheme://"
            let (authority, path) = match rest.find('/') {
                Some(i) => (&rest[..i], &rest[i..]),
                None => (rest, ""),
            };
            let host_port = authority.rsplit('@').next().unwrap_or(authority); // drop userinfo (after last '@')
            format!("{scheme_sep}{host_port}{path}")
        }
        None => before_q.to_string(), // templated/relative: no authority to strip
    }
}

/// Canonical, sorted, secret-free descriptor of the scanned surface, for scope-drift detection.
fn build_scope_descriptor(cfg: &Config, env: Option<&str>) -> String {
    use serde_json::{json, Map, Value};
    // Secret-safe shape: we hash header/query KEY names + method/canonical-url/body-mode/privileged,
    // but NOT free-form header/query VALUES, body CONTENT, or any secret-bearing url part (userinfo,
    // ?query, #fragment) — any can hold a hardcoded literal secret the final FNV digest (stored in the
    // baseline) would otherwise expose to brute-force. (scheme/host/path kept for endpoint-drift.)
    let req_shape = |id: &str| -> Value {
        match cfg.requests.iter().find(|r| r.id == id) {
            Some(r) => {
                let mut hk: Vec<String> = r.headers.iter().map(|k| k.key.clone()).collect(); hk.sort();
                let mut qk: Vec<String> = r.query.iter().map(|k| k.key.clone()).collect(); qk.sort();
                let body_mode = r.body.as_ref().map(|b| body_mode_token(&b.mode)).unwrap_or("none");
                json!({ "method": r.method, "url": scope_url(&r.url), "privileged": r.privileged, "headerKeys": hk, "queryKeys": qk, "bodyMode": body_mode })
            }
            None => Value::Null,
        }
    };
    let sec = cfg.security.as_ref();
    let mut root = Map::new();
    root.insert("env".into(), json!(env.unwrap_or("")));
    // identities: auth KIND + privileged + apikey key/location ONLY — never token/value/password.
    let mut ids: Vec<Value> = cfg.identities.iter().map(|i| {
        let (k, loc) = match &i.auth {
            qa_touchstone_core::config::Auth::ApiKey { key, location, .. } => (Some(key.clone()), Some(apikey_in_token(location))),
            _ => (None, None),
        };
        json!({ "id": i.id, "authKind": auth_kind_token(&i.auth), "privileged": i.privileged, "apikeyKey": k, "apikeyLocation": loc })
    }).collect();
    ids.sort_by(|a, b| a["id"].as_str().unwrap_or("").cmp(b["id"].as_str().unwrap_or("")));
    root.insert("identities".into(), Value::Array(ids));
    // Every request id the security suite references, so its shape goes in the `requests` map.
    let mut req_ids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    if let Some(m) = sec.and_then(|s| s.matrix.as_ref()) {
        // An empty `endpoints` means the runtime scans ALL requests (runner.rs:28), so the
        // descriptor must enumerate them too — otherwise a change to a non-listed request's
        // shape would alter the scan without flipping the scopeHash.
        let mut eps: Vec<String> = if m.endpoints.is_empty() {
            cfg.requests.iter().map(|r| r.id.clone()).collect()
        } else { m.endpoints.clone() };
        eps.sort();
        for e in &eps { req_ids.insert(e.clone()); }
        for rid in m.expect.keys() { req_ids.insert(rid.clone()); }
        let mut deny = m.deny_set.clone(); deny.sort();
        let mut expect: Vec<Value> = m.expect.iter()
            .flat_map(|(rid, row)| row.iter().map(move |(idid, exp)| json!([rid, idid, expectation_token(exp)]))).collect();
        expect.sort_by(|a, b| a.to_string().cmp(&b.to_string()));
        root.insert("matrix".into(), json!({ "endpoints": eps, "denySet": deny, "expect": expect }));
    }
    if let Some(b) = sec.and_then(|s| s.bola.as_ref()) {
        let mut tests: Vec<Value> = b.tests.iter().map(|t| {
            req_ids.insert(t.request.clone());
            // owners as [identityId, hasNonEmptyIdValue] — the bool (NOT the idValue, which may be PII)
            // mirrors run_bola's owner filter so an idValue going empty<->non-empty flips the scopeHash.
            let mut owners: Vec<Value> = t.id_values.iter()
                .map(|(k, v)| json!([k, qa_touchstone_core::security::bola::idval_nonempty(v)])).collect();
            owners.sort_by(|a, b| a[0].as_str().unwrap_or("").cmp(b[0].as_str().unwrap_or("")));
            json!({ "id": t.id, "request": t.request, "idLocation": id_location_token(&t.id_location), "owners": owners, "negativeControl": t.negative_control })
        }).collect();
        tests.sort_by(|a, b| a["id"].as_str().unwrap_or("").cmp(b["id"].as_str().unwrap_or("")));
        root.insert("bola".into(), Value::Array(tests));
    }
    if let Some(r) = sec.and_then(|s| s.rate_limit.as_ref()) {
        let mut tests: Vec<Value> = r.tests.iter().map(|t| {
            req_ids.insert(t.request.clone());
            json!({ "id": t.id, "request": t.request, "identity": t.identity, "sensitivity": t.sensitivity, "n": t.n, "concurrency": t.concurrency })
        }).collect();
        tests.sort_by(|a, b| a["id"].as_str().unwrap_or("").cmp(b["id"].as_str().unwrap_or("")));
        root.insert("ratelimit".into(), Value::Array(tests));
    }
    let reqs: Map<String, Value> = req_ids.into_iter().map(|id| { let sh = req_shape(&id); (id, sh) }).collect();
    root.insert("requests".into(), Value::Object(reqs));
    serde_json::to_string(&Value::Object(root)).unwrap()
}

fn report_engines(engines: &[EngineSummary]) -> Vec<qa_touchstone_core::security::report::EngineReport> {
    engines.iter().map(|e| qa_touchstone_core::security::report::EngineReport {
        engine: e.engine.clone(), ran: e.ran, findings: e.findings, errors: e.errors,
    }).collect()
}

fn atomic_write_json<T: serde::Serialize>(path: &str, v: &T) -> std::io::Result<()> {
    let body = serde_json::to_string_pretty(v).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let tmp = format!("{path}.tmp.{}", std::process::id());
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, path)
}

#[allow(clippy::too_many_arguments)]
pub async fn run_scan(
    config_path: String,
    engine: Option<String>,
    env: Option<String>,
    use_json: bool,
    out: Option<String>,
    baseline: Option<String>,
    update_baseline: bool,
    fail_on: Option<String>,
    sarif: Option<String>,
    html: Option<String>,
    junit: Option<String>,
    annotations: Option<String>,
) -> ExitCode {
    let text = match std::fs::read_to_string(&config_path) {
        Ok(t) => t, Err(e) => { eprintln!("error: cannot read config `{config_path}`: {e}"); return ExitCode::from(2); }
    };
    let cfg = match load_config(&text, &|k| std::env::var(k).ok()) {
        Ok(c) => c, Err(e) => { eprintln!("error: invalid config: {e}"); return ExitCode::from(2); }
    };
    if cfg.security.is_none() { eprintln!("error: config has no `security` block"); return ExitCode::from(2); }
    if let Some(ref name) = env {
        if !cfg.environments.iter().any(|e| &e.name == name) { eprintln!("error: no environment named `{name}`"); return ExitCode::from(2); }
    }
    if let Some(eng) = &engine {
        if !matches!(eng.as_str(), "matrix" | "bola" | "ratelimit") { eprintln!("error: unknown --engine `{eng}`"); return ExitCode::from(2); }
    }
    // A single-engine run produces a partial finding set; blessing it would write a baseline
    // missing the other engines' findings (which the next full run would then flag as New).
    if update_baseline && engine.is_some() {
        eprintln!("error: --update-baseline cannot be combined with --engine (a partial-engine bless corrupts the baseline)");
        return ExitCode::from(2);
    }

    // Parse --fail-on early so bad input exits before running engines.
    let fail_on_sev = match fail_on.as_deref() {
        None | Some("high") => Severity::High,
        Some("critical") => Severity::Critical,
        Some("medium") => Severity::Medium,
        Some("low") => Severity::Low,
        Some(other) => { eprintln!("error: bad --fail-on `{other}` (use critical|high|medium|low)"); return ExitCode::from(2); }
    };

    // Load the annotations file (absent/empty => no annotations; fpVersion mismatch / corrupt => exit 2).
    let records: Records = if let Some(path) = annotations.as_deref() {
        match std::fs::read_to_string(path) {
            Ok(t) if t.trim().is_empty() => Records::new(),
            Ok(t) => match serde_json::from_str::<AnnotationsFile>(&t) {
                Ok(a) if a.fp_version == FP_VERSION => a.records,
                Ok(_) => { eprintln!("error: annotations `{path}` fpVersion mismatch (expected {FP_VERSION})"); return ExitCode::from(2); }
                Err(e) => { eprintln!("error: corrupt annotations `{path}`: {e}"); return ExitCode::from(2); }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Records::new(),
            Err(e) => { eprintln!("error: cannot read annotations `{path}`: {e}"); return ExitCode::from(2); }
        }
    } else { Records::new() };

    // Redaction = UNION of every identity's auth secrets.
    let red = RedactionSet::from_auths(cfg.identities.iter().map(|i| &i.auth));

    // Run engines (suite order: matrix -> bola -> ratelimit). --engine filters.
    let want = |e: &str| engine.as_deref().map(|x| x == e).unwrap_or(true);
    let mut findings: Vec<Finding> = Vec::new();
    let mut errors: Vec<EngineError> = Vec::new();
    let mut engines: Vec<EngineSummary> = Vec::new();
    if want("matrix") {
        let (f, e) = qa_touchstone_core::security::runner::run_matrix(&cfg, env.as_deref()).await;
        engines.push(EngineSummary { engine: "matrix".into(), ran: true, findings: f.len(), errors: e.len() });
        findings.extend(f); errors.extend(e);
    }
    if want("bola") {
        let (f, e) = qa_touchstone_core::security::bola::run_bola(&cfg, env.as_deref()).await;
        engines.push(EngineSummary { engine: "bola".into(), ran: true, findings: f.len(), errors: e.len() });
        findings.extend(f); errors.extend(e);
    }
    if want("ratelimit") {
        let (f, e) = qa_touchstone_core::security::ratelimit::run_ratelimit(&cfg, env.as_deref()).await;
        engines.push(EngineSummary { engine: "ratelimit".into(), ran: true, findings: f.len(), errors: e.len() });
        findings.extend(f); errors.extend(e);
    }

    // Redact once (secrets-free, stable fps), then derive both the JSON findings and the snapshot from it.
    let redacted: Vec<Finding> = findings.iter().map(|f| Finding {
        engine: f.engine, severity: f.severity, rule_id: f.rule_id.clone(), oracle: f.oracle.clone(),
        title: red.redact_str(&f.title), path: red.redact_str(&f.path), evidence: red.redact_str(&f.evidence),
        method: f.method.clone(), endpoint: f.endpoint.as_deref().map(|s| red.redact_str(s)), identity: f.identity.as_deref().map(|s| red.redact_str(s)),
    }).collect();
    let mut totals = Totals { critical:0, high:0, medium:0, low:0, info:0, errors: errors.len() };
    let rfs: Vec<RFinding> = redacted.iter().map(|f| {
        match f.severity { Severity::Critical=>totals.critical+=1, Severity::High=>totals.high+=1, Severity::Medium=>totals.medium+=1, Severity::Low=>totals.low+=1, Severity::Info=>totals.info+=1 }
        RFinding {
            fp: fingerprint(f).0,
            engine: engine_str(f.engine).into(), severity: sev_str(f.severity).into(), rule_id: f.rule_id.clone(), oracle: f.oracle.clone(),
            title: f.title.clone(), path: f.path.clone(), evidence: f.evidence.clone(),
            method: f.method.clone(), endpoint: f.endpoint.clone(), identity: f.identity.clone(),
        }
    }).collect();

    let rerrors: Vec<RError> = errors.iter().map(|e| RError {
        engine: engine_str(e.engine).into(),
        endpoint: e.endpoint.as_deref().map(|s| red.redact_str(s)),
        identity: e.identity.as_deref().map(|s| red.redact_str(s)),
        message: red.redact_str(&e.message),
    }).collect();

    // Build scope hash and current snapshot from REDACTED findings (secrets-free, stable FPs).
    let scope_json = build_scope_descriptor(&cfg, env.as_deref());
    let scope_hash = scope_hash_of(&scope_json);
    let current = snapshot_of(&redacted, "cli", "", &scope_hash, &records);

    // Load baseline (absent or empty file => empty baseline, all findings are New).
    let baseline_snapshot: Option<Snapshot> = if let Some(path) = baseline.as_deref() {
        match std::fs::read_to_string(path) {
            Ok(t) if t.trim().is_empty() => None,
            Ok(t) => match serde_json::from_str::<Snapshot>(&t) {
                Ok(s) if s.fp_version == FP_VERSION => Some(s),
                Ok(_) => { eprintln!("error: baseline `{path}` fpVersion mismatch (expected {FP_VERSION})"); return ExitCode::from(2); }
                Err(e) => { eprintln!("error: corrupt baseline `{path}`: {e}"); return ExitCode::from(2); }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None, // absent file => bootstrap / all-new
            Err(e) => { eprintln!("error: cannot read baseline `{path}`: {e}"); return ExitCode::from(2); }
        }
    } else { None };
    let baseline_items: Vec<_> = baseline_snapshot.as_ref().map(|s| s.items.clone()).unwrap_or_default();
    let scope_mismatch = baseline_snapshot.as_ref()
        .map(|b| !b.scope_hash.is_empty() && b.scope_hash != scope_hash).unwrap_or(false);
    if scope_mismatch {
        eprintln!("warn: baseline scope differs from this run — the diff may be unreliable");
    }

    // Baseline-aware gate: only NEW findings >= fail_on trigger exit 3.
    let diff = diff_runs(&current.items, &baseline_items);
    let gated = gate_count(&current.items, &diff, fail_on_sev, &records);

    let ok = gated == 0 && errors.is_empty();
    let report = ScanReport { engines, findings: rfs, errors: rerrors, totals, ok };

    // Emit scan report (JSON / human).
    if let Some(path) = out {
        if let Err(e) = std::fs::write(&path, serde_json::to_string_pretty(&report).unwrap()) {
            eprintln!("error: cannot write `{path}`: {e}"); return ExitCode::from(1);
        }
    }
    if use_json { println!("{}", serde_json::to_string(&report).unwrap()); }
    else {
        println!("security scan: {} finding(s), {}E — {}C {}H {}M {}L {}I", report.findings.len(), report.totals.errors, report.totals.critical, report.totals.high, report.totals.medium, report.totals.low, report.totals.info);
        for f in &report.findings { println!("  {} [{}] {}  {}  — {}", f.fp, f.severity, f.engine, f.path, f.evidence); }
        for e in &report.errors { println!("  ERROR {} {} — {}", e.engine, e.endpoint.as_deref().unwrap_or("?"), e.message); }
    }

    // Build the report model once; write each requested file (SARIF / HTML / JUnit).
    let model = build_report(&current.items, &baseline_items, report_engines(&report.engines), fail_on_sev, scope_mismatch, "cli", &records);
    if let Some(p) = sarif.as_deref() {
        if let Err(e) = std::fs::write(p, report_to_sarif(&model)) { eprintln!("error: cannot write SARIF `{p}`: {e}"); return ExitCode::from(1); }
    }
    if let Some(p) = html.as_deref() {
        if let Err(e) = std::fs::write(p, report_to_html(&model)) { eprintln!("error: cannot write HTML `{p}`: {e}"); return ExitCode::from(1); }
    }
    if let Some(p) = junit.as_deref() {
        if let Err(e) = std::fs::write(p, report_to_junit(&model)) { eprintln!("error: cannot write JUnit `{p}`: {e}"); return ExitCode::from(1); }
    }

    // Bless: --update-baseline writes the current snapshot atomically (requires zero engine errors).
    if update_baseline {
        if !errors.is_empty() {
            eprintln!("warn: not updating baseline — {} engine error(s) this run", errors.len());
            return ExitCode::from(1);
        }
        let path = baseline.as_deref().unwrap(); // clap `requires = "baseline"` guarantees Some
        if let Err(e) = atomic_write_json(path, &current) {
            eprintln!("error: cannot write baseline `{path}`: {e}"); return ExitCode::from(1);
        }
        return ExitCode::SUCCESS; // deliberate bless => 0
    }

    if gated > 0 { ExitCode::from(3) } else if !errors.is_empty() { ExitCode::from(1) } else { ExitCode::SUCCESS }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_descriptor_stable_and_sensitive() {
        use qa_touchstone_core::config::load_config;
        let a = load_config(r#"{"version":1,"environments":[],"identities":[{"id":"x","auth":{"type":"none"}},{"id":"y","auth":{"type":"none"}}],"requests":[{"id":"r","method":"GET","url":"https://h/r"}],"security":{"matrix":{"endpoints":["r"]}}}"#, &|_| None).unwrap();
        let b = load_config(r#"{"version":1,"environments":[],"identities":[{"id":"y","auth":{"type":"none"}},{"id":"x","auth":{"type":"none"}}],"requests":[{"id":"r","method":"GET","url":"https://h/r"}],"security":{"matrix":{"endpoints":["r"]}}}"#, &|_| None).unwrap();
        assert_eq!(build_scope_descriptor(&a, None), build_scope_descriptor(&b, None), "identity reorder must not change the descriptor");
        let c = load_config(r#"{"version":1,"environments":[],"identities":[{"id":"x","auth":{"type":"none"}},{"id":"y","auth":{"type":"none"}}],"requests":[{"id":"r","method":"POST","url":"https://h/r"}],"security":{"matrix":{"endpoints":["r"]}}}"#, &|_| None).unwrap();
        assert_ne!(build_scope_descriptor(&a, None), build_scope_descriptor(&c, None), "a method change must flip the descriptor");
    }

    #[test]
    fn scope_descriptor_drops_header_values_keeps_keys() {
        use qa_touchstone_core::config::load_config;
        let mk = |hk: &str, hv: &str| format!(r#"{{"version":1,"environments":[],"identities":[{{"id":"x","auth":{{"type":"none"}}}}],"requests":[{{"id":"r","method":"GET","url":"https://h/r","headers":[{{"key":"{hk}","value":"{hv}"}}]}}],"security":{{"matrix":{{"endpoints":["r"]}}}}}}"#);
        let a = load_config(&mk("X-H", "v1"), &|_| None).unwrap();
        let b = load_config(&mk("X-H", "totally-different-secret"), &|_| None).unwrap();
        assert_eq!(build_scope_descriptor(&a, None), build_scope_descriptor(&b, None), "a header VALUE change must NOT affect the descriptor (values are never hashed)");
        let c = load_config(&mk("X-Other", "v1"), &|_| None).unwrap();
        assert_ne!(build_scope_descriptor(&a, None), build_scope_descriptor(&c, None), "a header KEY change MUST affect the descriptor");
    }

    #[test]
    fn scope_descriptor_tracks_bola_idvalue_presence() {
        use qa_touchstone_core::config::load_config;
        let mk = |bval: &str| format!(r#"{{"version":1,"environments":[],"identities":[{{"id":"a","auth":{{"type":"none"}}}},{{"id":"b","auth":{{"type":"none"}}}}],"requests":[{{"id":"r","method":"GET","url":"https://h/r/PH"}}],"security":{{"bola":{{"tests":[{{"id":"t","request":"r","idLocation":{{"kind":"path","index":1}},"idValues":{{"a":"oa","b":"{bval}"}}}}]}}}}}}"#);
        let nonempty = load_config(&mk("ob"), &|_| None).unwrap();
        let empty = load_config(&mk(""), &|_| None).unwrap();
        assert_ne!(build_scope_descriptor(&nonempty, None), build_scope_descriptor(&empty, None), "an idValue going non-empty -> empty must flip the descriptor (it changes which owners run)");
    }

    #[test]
    fn scope_descriptor_empty_endpoints_covers_all_requests() {
        use qa_touchstone_core::config::load_config;
        // endpoints:[] => the runtime scans ALL requests, so adding/altering any request must flip the hash.
        let one = load_config(r#"{"version":1,"environments":[],"identities":[{"id":"x","auth":{"type":"none"}}],"requests":[{"id":"r1","method":"GET","url":"https://h/r1"}],"security":{"matrix":{"endpoints":[]}}}"#, &|_| None).unwrap();
        let two = load_config(r#"{"version":1,"environments":[],"identities":[{"id":"x","auth":{"type":"none"}}],"requests":[{"id":"r1","method":"GET","url":"https://h/r1"},{"id":"r2","method":"POST","url":"https://h/r2"}],"security":{"matrix":{"endpoints":[]}}}"#, &|_| None).unwrap();
        assert_ne!(build_scope_descriptor(&one, None), build_scope_descriptor(&two, None), "with empty endpoints, adding a request must flip the descriptor (all requests are scanned)");
        // ...and r2's SHAPE (not just its id) is captured: changing r2's method must flip the hash.
        let two_put = load_config(r#"{"version":1,"environments":[],"identities":[{"id":"x","auth":{"type":"none"}}],"requests":[{"id":"r1","method":"GET","url":"https://h/r1"},{"id":"r2","method":"PUT","url":"https://h/r2"}],"security":{"matrix":{"endpoints":[]}}}"#, &|_| None).unwrap();
        assert_ne!(build_scope_descriptor(&two, None), build_scope_descriptor(&two_put, None), "with empty endpoints, changing a request's method must flip the descriptor (its shape is in `requests`)");
    }

    #[test]
    fn scope_url_strips_userinfo_query_fragment() {
        assert_eq!(scope_url("https://u:p@h:8080/x?q=1#frag"), "https://h:8080/x");
        assert_eq!(scope_url("https://h/x"), "https://h/x");
        assert_eq!(scope_url("https://h/a@b/c"), "https://h/a@b/c"); // '@' in the PATH is kept
        assert_eq!(scope_url("{{apiHost}}/x?y#z"), "{{apiHost}}/x");  // templated: strip query + fragment
        assert_eq!(scope_url("https://h"), "https://h");
    }

    #[test]
    fn scope_descriptor_drops_query_body_and_url_query_values() {
        use qa_touchstone_core::config::load_config;
        // query VALUE change => no flip; query KEY change => flip.
        let q = |k: &str, v: &str| format!(r#"{{"version":1,"environments":[],"identities":[{{"id":"x","auth":{{"type":"none"}}}}],"requests":[{{"id":"r","method":"POST","url":"https://h/r","query":[{{"key":"{k}","value":"{v}"}}]}}],"security":{{"matrix":{{"endpoints":["r"]}}}}}}"#);
        let a = load_config(&q("page", "1"), &|_| None).unwrap();
        let b = load_config(&q("page", "SECRET-2"), &|_| None).unwrap();
        assert_eq!(build_scope_descriptor(&a, None), build_scope_descriptor(&b, None), "a query VALUE change must NOT flip the descriptor");
        let c = load_config(&q("offset", "1"), &|_| None).unwrap();
        assert_ne!(build_scope_descriptor(&a, None), build_scope_descriptor(&c, None), "a query KEY change MUST flip the descriptor");
        // body CONTENT change => no flip; body MODE change => flip.
        let body = |mode: &str, content: &str| format!(r#"{{"version":1,"environments":[],"identities":[{{"id":"x","auth":{{"type":"none"}}}}],"requests":[{{"id":"r","method":"POST","url":"https://h/r","body":{{"mode":"{mode}","content":"{content}"}}}}],"security":{{"matrix":{{"endpoints":["r"]}}}}}}"#);
        let d = load_config(&body("raw", "hello"), &|_| None).unwrap();
        let e = load_config(&body("raw", "SECRET-BODY"), &|_| None).unwrap();
        assert_eq!(build_scope_descriptor(&d, None), build_scope_descriptor(&e, None), "a body CONTENT change must NOT flip the descriptor");
        let f = load_config(&body("json", "hello"), &|_| None).unwrap();
        assert_ne!(build_scope_descriptor(&d, None), build_scope_descriptor(&f, None), "a body MODE change MUST flip the descriptor");
        // url inline ?query VALUE change => no flip (query stripped); url PATH change => flip.
        let u = |url: &str| format!(r#"{{"version":1,"environments":[],"identities":[{{"id":"x","auth":{{"type":"none"}}}}],"requests":[{{"id":"r","method":"GET","url":"{url}"}}],"security":{{"matrix":{{"endpoints":["r"]}}}}}}"#);
        let g = load_config(&u("https://h/r?token=aaa"), &|_| None).unwrap();
        let h = load_config(&u("https://h/r?token=SECRET-bbb"), &|_| None).unwrap();
        assert_eq!(build_scope_descriptor(&g, None), build_scope_descriptor(&h, None), "a url ?query VALUE change must NOT flip the descriptor (query stripped)");
        let i = load_config(&u("https://h/r2?token=aaa"), &|_| None).unwrap();
        assert_ne!(build_scope_descriptor(&g, None), build_scope_descriptor(&i, None), "a url PATH change MUST flip the descriptor");
    }

    #[test]
    fn scope_descriptor_omits_literal_secrets() {
        use qa_touchstone_core::config::load_config;
        // Hardcoded secrets in a bearer token, a header value, a query value, and the url ?query —
        // none of these literals may appear anywhere in the descriptor string.
        let cfg = load_config(r#"{"version":1,"environments":[],"identities":[{"id":"x","auth":{"type":"bearer","token":"BEARER-SENTINEL"}}],"requests":[{"id":"r","method":"GET","url":"https://u:USERINFO-SENTINEL@h/r?apikey=URLQ-SENTINEL#FRAG-SENTINEL","headers":[{"key":"X-Api-Key","value":"HDR-SENTINEL"}],"query":[{"key":"q","value":"QRY-SENTINEL"}]}],"security":{"matrix":{"endpoints":["r"]}}}"#, &|_| None).unwrap();
        let d = build_scope_descriptor(&cfg, None);
        for sentinel in ["BEARER-SENTINEL", "HDR-SENTINEL", "QRY-SENTINEL", "URLQ-SENTINEL", "USERINFO-SENTINEL", "FRAG-SENTINEL"] {
            assert!(!d.contains(sentinel), "descriptor must not contain literal secret `{sentinel}`: {d}");
        }
    }
}
