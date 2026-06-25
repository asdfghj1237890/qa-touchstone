//! `scan` command: run the security suite (matrix -> bola -> ratelimit), redact (union of all identity
//! secrets), emit findings (JSON/human), baseline-aware gate (New >= fail_on => exit 3), SARIF emit,
//! atomic bless. Exit codes: 0 ok, 1 runtime error, 2 invalid input, 3 findings gate.
use qa_touchstone_core::config::{load_config, Config};
use qa_touchstone_core::redact::RedactionSet;
use qa_touchstone_core::security::finding::{EngineError, EngineId, Finding, Severity};
use qa_touchstone_core::security::lifecycle::{
    diff_runs, gate_count, scope_hash_of, snapshot_of, Snapshot, FP_VERSION,
};
use qa_touchstone_core::security::report::{build_report, report_to_sarif};
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
    match e { EngineId::Matrix=>"matrix", EngineId::Bola=>"bola", EngineId::RateLimit=>"ratelimit" }
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

/// Canonical, sorted, secret-free descriptor of the scanned surface, for scope-drift detection.
fn build_scope_descriptor(cfg: &Config) -> String {
    use serde_json::{json, Map, Value};
    let sec = cfg.security.as_ref();
    let mut root = Map::new();
    if let Some(m) = sec.and_then(|s| s.matrix.as_ref()) {
        let mut eps: Vec<String> = m.endpoints.clone(); eps.sort();
        let mut deny = m.deny_set.clone(); deny.sort();
        let mut expect: Vec<Value> = m.expect.iter().flat_map(|(rid, row)| row.iter().map(move |(idid, exp)| json!([rid, idid, expectation_token(exp)]))).collect();
        expect.sort_by(|a, b| a.to_string().cmp(&b.to_string()));
        root.insert("matrix".into(), json!({ "endpoints": eps, "denySet": deny, "expect": expect }));
    }
    if let Some(b) = sec.and_then(|s| s.bola.as_ref()) {
        let mut tests: Vec<Value> = b.tests.iter().map(|t| {
            let mut owners: Vec<String> = t.id_values.keys().cloned().collect(); owners.sort();
            json!({ "id": t.id, "request": t.request, "idLocation": id_location_token(&t.id_location), "owners": owners })
        }).collect();
        tests.sort_by(|a, b| a["id"].as_str().unwrap_or("").cmp(b["id"].as_str().unwrap_or("")));
        root.insert("bola".into(), Value::Array(tests));
    }
    if let Some(r) = sec.and_then(|s| s.rate_limit.as_ref()) {
        let mut tests: Vec<Value> = r.tests.iter().map(|t| json!({ "id": t.id, "request": t.request,
            "identity": t.identity, "sensitivity": t.sensitivity, "n": t.n, "concurrency": t.concurrency })).collect();
        tests.sort_by(|a, b| a["id"].as_str().unwrap_or("").cmp(b["id"].as_str().unwrap_or("")));
        root.insert("ratelimit".into(), Value::Array(tests));
    }
    // serde_json::Map preserves insertion order; we inserted matrix/bola/ratelimit in a fixed order,
    // and every array is sorted, so the serialization is canonical for a given config.
    serde_json::to_string(&Value::Object(root)).unwrap()
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

    let mut totals = Totals { critical:0, high:0, medium:0, low:0, info:0, errors: errors.len() };
    let rfs: Vec<RFinding> = findings.iter().map(|f| {
        match f.severity { Severity::Critical=>totals.critical+=1, Severity::High=>totals.high+=1, Severity::Medium=>totals.medium+=1, Severity::Low=>totals.low+=1, Severity::Info=>totals.info+=1 }
        RFinding {
            engine: engine_str(f.engine).into(), severity: sev_str(f.severity).into(), rule_id: f.rule_id.clone(), oracle: f.oracle.clone(),
            title: red.redact_str(&f.title), path: red.redact_str(&f.path), evidence: red.redact_str(&f.evidence),
            method: f.method.clone(), endpoint: f.endpoint.clone(), identity: f.identity.as_deref().map(|s| red.redact_str(s)),
        }
    }).collect();

    let rerrors: Vec<RError> = errors.iter().map(|e| RError {
        engine: engine_str(e.engine).into(),
        endpoint: e.endpoint.clone(),
        identity: e.identity.clone(),
        message: red.redact_str(&e.message),
    }).collect();

    // Build scope hash and current snapshot from REDACTED findings (secrets-free, stable FPs).
    let scope_json = build_scope_descriptor(&cfg);
    let scope_hash = scope_hash_of(&scope_json);
    let redacted: Vec<Finding> = findings.iter().map(|f| Finding {
        engine: f.engine, severity: f.severity, rule_id: f.rule_id.clone(), oracle: f.oracle.clone(),
        title: red.redact_str(&f.title), path: red.redact_str(&f.path), evidence: red.redact_str(&f.evidence),
        method: f.method.clone(), endpoint: f.endpoint.clone(), identity: f.identity.as_deref().map(|s| red.redact_str(s)),
    }).collect();
    let current = snapshot_of(&redacted, "cli", "", &scope_hash);

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
    if let Some(b) = &baseline_snapshot {
        if !b.scope_hash.is_empty() && b.scope_hash != scope_hash {
            eprintln!("warn: baseline scope differs from this run — the diff may be unreliable");
        }
    }

    // Baseline-aware gate: only NEW findings >= fail_on trigger exit 3.
    let diff = diff_runs(&current.items, &baseline_items);
    let gated = gate_count(&current.items, &diff, fail_on_sev);

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
        for f in &report.findings { println!("  [{}] {}  {}  — {}", f.severity, f.engine, f.path, f.evidence); }
        for e in &report.errors { println!("  ERROR {} {} — {}", e.engine, e.endpoint.as_deref().unwrap_or("?"), e.message); }
    }

    // SARIF emit.
    if let Some(path) = sarif.as_deref() {
        let model = build_report(&current.items, &baseline_items);
        if let Err(e) = std::fs::write(path, report_to_sarif(&model)) {
            eprintln!("error: cannot write SARIF `{path}`: {e}"); return ExitCode::from(1);
        }
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
