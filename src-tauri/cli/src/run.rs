//! `run` command: execute a collection over data iterations, score assertions,
//! and emit reporters. Validation is already enforced by load_config.
use crate::report::{AssertionRow, ResultRow, RunReport};
use qa_touchstone_core::buildreq::build_request;
use qa_touchstone_core::config::load_config;
use qa_touchstone_core::datafile::{js_string, parse_data_file};
use qa_touchstone_core::engine::{qa_var_map, RealDynamics};
use qa_touchstone_core::redact::RedactionSet;
use qa_touchstone_core::step::run_step;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::process::ExitCode;

#[allow(clippy::too_many_arguments)]
pub async fn run_collection(
    config_path: String,
    collection_id: String,
    identity_id: String,
    env_name: Option<String>,
    data_path: Option<String>,
    iterations: Option<u32>,
    junit_path: Option<String>,
    use_json: bool,
) -> ExitCode {
    let text = match std::fs::read_to_string(&config_path) {
        Ok(t) => t,
        Err(e) => { eprintln!("error: cannot read config `{config_path}`: {e}"); return ExitCode::from(2); }
    };
    let cfg = match load_config(&text, &|k| std::env::var(k).ok()) {
        Ok(c) => c,
        Err(e) => { eprintln!("error: invalid config: {e}"); return ExitCode::from(2); }
    };

    let collection = match cfg.collections.iter().find(|c| c.id == collection_id) {
        Some(c) => c,
        None => { eprintln!("error: no collection with id `{collection_id}`"); return ExitCode::from(2); }
    };
    let identity = match cfg.identities.iter().find(|i| i.id == identity_id) {
        Some(i) => i,
        None => { eprintln!("error: no identity with id `{identity_id}`"); return ExitCode::from(2); }
    };
    if let Some(ref name) = env_name {
        if !cfg.environments.iter().any(|e| &e.name == name) {
            eprintln!("error: no environment named `{name}`"); return ExitCode::from(2);
        }
    }

    let rows: Option<Vec<Map<String, Value>>> = match &data_path {
        Some(p) => {
            let dtext = match std::fs::read_to_string(p) {
                Ok(t) => t,
                Err(e) => { eprintln!("error: cannot read data `{p}`: {e}"); return ExitCode::from(2); }
            };
            let df = parse_data_file(&dtext, Some(p.as_str()));
            if !df.error.is_empty() { eprintln!("error: data file: {}", df.error); return ExitCode::from(2); }
            match df.rows {
                Some(r) if !r.is_empty() => Some(r),
                _ => { eprintln!("error: data file `{p}` has no rows"); return ExitCode::from(2); }
            }
        }
        None => None,
    };
    let count: usize = match &rows {
        Some(r) => r.len(),
        None => match iterations {
            Some(0) => { eprintln!("error: --iterations must be >= 1"); return ExitCode::from(2); }
            Some(n) => n as usize,
            None => 1,
        },
    };

    let base_red = RedactionSet::from_auth(&identity.auth);
    let scoped = cfg.scoped_vars();

    let mut results: Vec<ResultRow> = Vec::new();
    for iter in 0..count {
        let row: Option<&Map<String, Value>> = rows.as_ref().map(|r| &r[iter]);
        let local: BTreeMap<String, String> = row
            .map(|r| r.iter().map(|(k, v)| (k.clone(), js_string(v))).collect())
            .unwrap_or_default();
        let mut red = base_red.clone();
        if let Some(r) = row { red.extend_with_data_row(r); }
        let map = qa_var_map(&scoped, env_name.as_deref(), Some(collection.id.as_str()), Some(&local));

        for req_id in &collection.requests {
            let req = cfg.requests.iter().find(|r| &r.id == req_id)
                .expect("collection ref validated by load_config");
            match build_request(req, identity, &map, &mut RealDynamics) {
                Err(e) => results.push(ResultRow {
                    iter, request: req_id.clone(), status: 0, ms: 0,
                    final_url: None, error: Some(red.redact_str(&e)), assertions: vec![],
                }),
                Ok(rd) => {
                    let step = run_step(&rd, &req.assertions, crate::exec_opts_for(&identity.auth)).await;
                    if !step.success {
                        results.push(ResultRow {
                            iter, request: req_id.clone(), status: step.status, ms: step.ms,
                            final_url: Some(red.redact_str(&step.final_url)),
                            error: Some(red.redact_str(step.error.as_deref().unwrap_or("request failed"))),
                            assertions: vec![],
                        });
                    } else {
                        let assertions = step.results.iter().map(|a| {
                            let label = a.get("label").and_then(|v| v.as_str())
                                .or_else(|| a.get("type").and_then(|v| v.as_str())).unwrap_or("?");
                            let pass = a.get("pass") == Some(&json!(true));
                            let actual = match a.get("actual") {
                                Some(v) => v.as_str().map(str::to_owned).unwrap_or_else(|| v.to_string()),
                                None => "?".to_owned(),
                            };
                            AssertionRow { label: red.redact_str(label), pass, actual: red.redact_str(&actual) }
                        }).collect();
                        results.push(ResultRow {
                            iter, request: req_id.clone(), status: step.status, ms: step.ms,
                            final_url: Some(red.redact_str(&step.final_url)), error: None, assertions,
                        });
                    }
                }
            }
        }
    }

    let report = RunReport::build(collection_id, identity_id, count, results);
    if let Some(path) = junit_path {
        if let Err(e) = std::fs::write(&path, crate::report::to_junit(&report)) {
            eprintln!("error: cannot write junit `{path}`: {e}");
            return ExitCode::from(1);
        }
    }
    let _ = use_json; // JSON reporter lands in Task 5
    crate::report::print_human(&report);

    if report.ok { ExitCode::SUCCESS } else { ExitCode::from(4) }
}
