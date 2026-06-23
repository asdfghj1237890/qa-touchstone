//! qa-touchstone-ci — headless CI runner. SP0a: skeleton + `ping` smoke.
//! Exit codes (fixed for all phases):
//!   0 ok
//!   1 runtime error (HTTP/network failure)
//!   2 invalid input (clap usage / config / missing request or identity)
//!   3 findings gate (reserved, SP3)
//!   4 assertion failure (one or more assertions did not pass)
use clap::{Parser, Subcommand};
use qa_touchstone_core::executor::ExecOptions;
use serde_json::json;

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
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let cli = Cli::parse();
    match cli.command {
        Command::Ping { url } => {
            let request_details = json!({ "request": { "method": "GET", "url": url, "header": [] } });
            let out = qa_touchstone_core::executor::execute_request(
                &request_details, &json!({}), None, None, ExecOptions::default(),
            )
            .await;
            if out["success"].as_bool() == Some(true) {
                println!("{} {}", out["status"], out["finalUrl"].as_str().unwrap_or("?"));
                std::process::ExitCode::SUCCESS
            } else {
                eprintln!("error: {}", out["error"].as_str().unwrap_or("request failed"));
                std::process::ExitCode::from(1)
            }
        }
        Command::Send { config, request, identity, env, json: use_json } => {
            run_send(config, request, identity, env, use_json).await
        }
    }
}


async fn run_send(
    config_path: String,
    request_id: String,
    identity_id: String,
    env_name: Option<String>,
    use_json: bool,
) -> std::process::ExitCode {
    use qa_touchstone_core::{buildreq, config::load_config, engine::{qa_var_map, RealDynamics}};

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
    // Mark the identity's api-key header as sensitive so it is stripped on cross-origin
    // redirects (Authorization/Cookie/x-amz-* are already covered by the built-in list).
    let sensitive_header_names = match &identity.auth {
        qa_touchstone_core::config::Auth::ApiKey {
            key,
            location: qa_touchstone_core::config::ApiKeyIn::Header,
            ..
        } => vec![key.clone()],
        _ => vec![],
    };
    let exec_opts = ExecOptions { sensitive_header_names, ..Default::default() };

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
            let label_raw = r.get("label")
                .and_then(|v| v.as_str())
                .or_else(|| r.get("type").and_then(|v| v.as_str()))
                .unwrap_or("?");
            let label = red.redact_str(label_raw);
            let actual = match r.get("actual") {
                Some(v) => v.as_str().map(str::to_owned).unwrap_or_else(|| v.to_string()),
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
