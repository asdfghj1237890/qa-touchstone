//! `scan` command: run the security suite (matrix -> bola -> ratelimit), redact (union of all identity
//! secrets), emit findings (JSON/human), exit 3 on any finding >= high, exit 1 on errors.
use qa_touchstone_core::config::load_config;
use qa_touchstone_core::redact::RedactionSet;
use qa_touchstone_core::security::finding::{EngineError, EngineId, Finding, Severity};
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

pub async fn run_scan(config_path: String, engine: Option<String>, env: Option<String>, use_json: bool, out: Option<String>) -> ExitCode {
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

    let gated = findings.iter().any(|f| f.severity >= Severity::High);
    let ok = !gated && errors.is_empty();
    let report = ScanReport { engines, findings: rfs, errors: rerrors, totals, ok };

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
    if gated { ExitCode::from(3) } else if !errors.is_empty() { ExitCode::from(1) } else { ExitCode::SUCCESS }
}
