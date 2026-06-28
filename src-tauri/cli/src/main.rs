//! qa-touchstone-ci — headless CI runner. SP0a: skeleton + `ping` smoke.
//! Exit codes (fixed for all phases):
//!   0 ok
//!   1 runtime error (HTTP/network failure)
//!   2 invalid input (clap usage / config / missing request or identity)
//!   3 findings gate (any security finding >= High from `scan`)
//!   4 assertion failure (one or more assertions did not pass)
use clap::{Parser, Subcommand};
use qa_touchstone_core::executor::ExecOptions;
use serde_json::json;

mod bola_suggest;
mod import;
mod perf;
mod report;
mod run;
mod scan;

#[derive(Parser)]
#[command(name = "qa-touchstone-ci", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Send one GET request through the core executor (no config; smoke test).
    Ping {
        /// Absolute URL to GET.
        #[arg(long)]
        url: String,
    },
    /// Send one configured request under an identity and evaluate its assertions.
    Send {
        /// Path to the QA Touchstone config JSON file.
        #[arg(long)]
        config: String,
        /// ID of the request to send (from the config `requests` array).
        #[arg(long)]
        request: String,
        /// ID of the identity to use (from the config `identities` array).
        #[arg(long)]
        identity: String,
        /// Name of the environment to activate (from the config `environments` array).
        #[arg(long)]
        env: Option<String>,
        /// Output machine-readable JSON instead of human lines.
        #[arg(long)]
        json: bool,
    },
    /// Run a collection (optionally over a data file) and report per-assertion results.
    Run {
        #[arg(long)]
        config: String,
        #[arg(long)]
        collection: String,
        #[arg(long)]
        identity: String,
        #[arg(long)]
        env: Option<String>,
        #[arg(long)]
        data: Option<String>,
        #[arg(long, conflicts_with = "data")]
        iterations: Option<u32>,
        #[arg(long)]
        junit: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Generate a k6 script from one configured request and run system k6.
    Perf {
        /// Path to the QA Touchstone config JSON file.
        #[arg(long)]
        config: String,
        /// ID of the request to run as a k6 target.
        #[arg(long)]
        request: String,
        /// ID of the identity whose auth should be applied.
        #[arg(long)]
        identity: String,
        /// Name of the environment to activate.
        #[arg(long)]
        env: Option<String>,
        /// Optional collection id whose variables should be active.
        #[arg(long)]
        collection: Option<String>,
        /// k6 stage as DURATION:VUS, e.g. --stage 30s:5 --stage 1m:20.
        #[arg(long)]
        stage: Vec<String>,
        /// k6 executable path. Defaults to `k6` on PATH.
        #[arg(long)]
        k6_bin: Option<String>,
        /// Keep the generated k6 script at this path. May contain auth secrets.
        #[arg(long)]
        script_out: Option<String>,
        /// Pass --summary-export to k6 and write the summary JSON here.
        #[arg(long)]
        summary_out: Option<String>,
        /// Disable HTTP keep-alive in k6.
        #[arg(long)]
        no_keepalive: bool,
        /// Per-request timeout in milliseconds.
        #[arg(long, default_value_t = 30_000)]
        timeout_ms: u64,
        /// Output machine-readable JSON instead of human lines.
        #[arg(long)]
        json: bool,
    },
    /// Run the security suite (matrix + BOLA + rate-limit), gate on new findings, and emit
    /// reports (SARIF / HTML / JUnit) with baseline-aware scope-drift detection.
    Scan {
        #[arg(long)]
        config: String,
        #[arg(long)]
        engine: Option<String>,
        #[arg(long)]
        env: Option<String>,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        out: Option<String>,
        /// Path to a baseline snapshot JSON file (absent or empty => bootstrap / all-new).
        #[arg(long)]
        baseline: Option<String>,
        /// Overwrite the baseline file with this run's snapshot (requires --baseline; ignored on engine errors). With --annotations, the overridden effective severities are frozen into the baseline.
        #[arg(long, requires = "baseline")]
        update_baseline: bool,
        /// Gate threshold: critical|high|medium|low (default: high).
        #[arg(long)]
        fail_on: Option<String>,
        /// Write a SARIF 2.1.0 report to this file path.
        #[arg(long)]
        sarif: Option<String>,
        /// Write an HTML security report to this file path.
        #[arg(long)]
        html: Option<String>,
        /// Write a JUnit XML report to this file path.
        #[arg(long)]
        junit: Option<String>,
        /// Read a findings annotations file (suppress / severityOverride / status / owner / note), keyed by fingerprint.
        #[arg(long)]
        annotations: Option<String>,
    },
    /// Detect id locations in configured requests and print ranked candidates
    /// + a paste-ready security.bola.tests config stub. Read-only, no network.
    BolaSuggest {
        /// Path to the QA Touchstone config JSON file.
        #[arg(long)]
        config: String,
        /// Name of the environment to activate (from the config `environments` array).
        #[arg(long)]
        env: Option<String>,
        /// Output machine-readable JSON instead of human lines.
        #[arg(long)]
        json: bool,
    },
    /// Convert a Postman v2.1 collection or OpenAPI 3 / Swagger 2 spec (JSON)
    /// into a qa.json config scaffold. Read-only, no network.
    Import {
        /// Path to the input spec file (Postman v2.1 or OpenAPI 3 / Swagger 2, JSON).
        #[arg(long)]
        input: String,
        /// Override or supply the base URL (sets globals.variables.baseUrl in the output).
        #[arg(long)]
        base_url: Option<String>,
        /// Write the generated config to this file (default: stdout). Prefer --out for specs that embed credentials — stdout may surface secret literals into CI logs.
        #[arg(long)]
        out: Option<String>,
    },
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let cli = Cli::parse();
    match cli.command {
        Command::Ping { url } => {
            let request_details =
                json!({ "request": { "method": "GET", "url": url, "header": [] } });
            let out = qa_touchstone_core::executor::execute_request(
                &request_details,
                &json!({}),
                None,
                None,
                ExecOptions::default(),
            )
            .await;
            if out["success"].as_bool() == Some(true) {
                println!(
                    "{} {}",
                    out["status"],
                    out["finalUrl"].as_str().unwrap_or("?")
                );
                std::process::ExitCode::SUCCESS
            } else {
                eprintln!(
                    "error: {}",
                    out["error"].as_str().unwrap_or("request failed")
                );
                std::process::ExitCode::from(1)
            }
        }
        Command::Send {
            config,
            request,
            identity,
            env,
            json: use_json,
        } => run_send(config, request, identity, env, use_json).await,
        Command::Run {
            config,
            collection,
            identity,
            env,
            data,
            iterations,
            junit,
            json: use_json,
        } => {
            run::run_collection(
                config, collection, identity, env, data, iterations, junit, use_json,
            )
            .await
        }
        Command::Perf {
            config,
            request,
            identity,
            env,
            collection,
            stage,
            k6_bin,
            script_out,
            summary_out,
            no_keepalive,
            timeout_ms,
            json: use_json,
        } => {
            perf::run_perf(
                config,
                request,
                identity,
                env,
                collection,
                stage,
                k6_bin,
                script_out,
                summary_out,
                use_json,
                no_keepalive,
                timeout_ms,
            )
            .await
        }
        Command::Scan {
            config,
            engine,
            env,
            json: use_json,
            out,
            baseline,
            update_baseline,
            fail_on,
            sarif,
            html,
            junit,
            annotations,
        } => {
            scan::run_scan(
                config,
                engine,
                env,
                use_json,
                out,
                baseline,
                update_baseline,
                fail_on,
                sarif,
                html,
                junit,
                annotations,
            )
            .await
        }
        Command::BolaSuggest {
            config,
            env,
            json: use_json,
        } => bola_suggest::run(config, env, use_json).await,
        Command::Import {
            input,
            base_url,
            out,
        } => import::run(input, base_url, out).await,
    }
}

async fn run_send(
    config_path: String,
    request_id: String,
    identity_id: String,
    env_name: Option<String>,
    use_json: bool,
) -> std::process::ExitCode {
    use qa_touchstone_core::{
        buildreq,
        config::load_config,
        engine::{qa_var_map, RealDynamics},
    };

    // Step 1: read the config file (IO error → exit 2)
    let text = match std::fs::read_to_string(&config_path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("error: cannot read config `{config_path}`: {e}");
            return std::process::ExitCode::from(2);
        }
    };

    // Step 2: parse + resolve secrets (Err → exit 2)
    let cfg = match load_config(&text, &|k| std::env::var(k).ok()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: invalid config: {e}");
            return std::process::ExitCode::from(2);
        }
    };

    // Step 3: look up request, identity, env (missing → exit 2)
    let req = match cfg.requests.iter().find(|r| r.id == request_id) {
        Some(r) => r,
        None => {
            eprintln!("error: no request with id `{request_id}` in config");
            return std::process::ExitCode::from(2);
        }
    };

    let identity = match cfg.identities.iter().find(|i| i.id == identity_id) {
        Some(i) => i,
        None => {
            eprintln!("error: no identity with id `{identity_id}` in config");
            return std::process::ExitCode::from(2);
        }
    };

    if let Some(ref name) = env_name {
        if !cfg.environments.iter().any(|e| &e.name == name) {
            eprintln!("error: no environment named `{name}` in config");
            return std::process::ExitCode::from(2);
        }
    }

    // Build redaction set from resolved identity secrets (raw + percent-encoded forms).
    let red = qa_touchstone_core::redact::RedactionSet::from_auth(&identity.auth);

    // Step 4: build var map
    let scoped = cfg.scoped_vars();
    let map = qa_var_map(&scoped, env_name.as_deref(), None, None);

    // Step 5: build the request payload (Err → exit 2)
    let rd = match buildreq::build_request(req, identity, &map, &mut RealDynamics) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("error: build_request failed: {}", red.redact_str(&e));
            return std::process::ExitCode::from(2);
        }
    };

    // Step 6: execute + measure wall-clock ms
    let exec_opts = qa_touchstone_core::buildreq::exec_opts_for(&identity.auth);

    // Steps 6-9: execute, adapt, and assert via run_step (no printing/redaction inside).
    let step = qa_touchstone_core::step::run_step(&rd, &req.assertions, exec_opts).await;

    let method = rd["request"]["method"].as_str().unwrap_or("?");
    let final_url = red.redact_str(&step.final_url);

    // Step 7: short-circuit on runtime failure — do NOT evaluate/print assertions against a null response.
    // Runtime failure → exit 1 (no assertion rows).
    if !step.success {
        let redacted_err = red.redact_str(step.error.as_deref().unwrap_or("request failed"));
        if use_json {
            // Machine-readable runtime-failure output — secrets are redacted.
            let json_out = json!({
                "success": false,
                "status": step.status,
                "url": final_url,
                "method": method,
                "ms": step.ms,
                "error": redacted_err,
            });
            println!("{}", json_out);
        } else {
            eprintln!("error: {redacted_err}");
        }
        return std::process::ExitCode::from(1);
    }

    // Step 10: determine exit code
    // any assertion pass != true → assertion failure (exit 4); all passed → exit 0
    let assertions_pass = step.results.iter().all(|r| r["pass"] == json!(true));

    // Step 11: output
    if use_json {
        // Machine-readable JSON — secrets are redacted from url, responseHeaders, body, and assertions.
        let redacted_results: serde_json::Value =
            red.redact_value(&serde_json::Value::Array(step.results.clone()));
        let json_out = json!({
            "success": true,
            "status": step.status,
            "url": final_url,
            "method": method,
            "ms": step.ms,
            // response headers (from server) included but redacted; request headers are NOT echoed (auth redaction)
            "responseHeaders": red.redact_value(&step.headers),
            "body": red.redact_value(&step.body),
            "assertions": redacted_results,
        });
        println!("{}", json_out);
    } else {
        // Human-readable output — final_url and assertion actuals are redacted.
        println!("{method} {final_url} → {} ({}ms)", step.status, step.ms);
        for r in &step.results {
            let pass = r.get("pass") == Some(&json!(true));
            let mark = if pass { '\u{2713}' } else { '\u{2717}' }; // ✓ / ✗
            let label_raw = r
                .get("label")
                .and_then(|v| v.as_str())
                .or_else(|| r.get("type").and_then(|v| v.as_str()))
                .unwrap_or("?");
            let label = red.redact_str(label_raw);
            let actual = match r.get("actual") {
                Some(v) => v
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| v.to_string()),
                None => "?".to_owned(),
            };
            let redacted_actual = red.redact_str(&actual);
            println!("{mark} {label} (actual: {redacted_actual})");
        }
    }

    if !assertions_pass {
        std::process::ExitCode::from(4)
    } else {
        std::process::ExitCode::SUCCESS
    }
}
