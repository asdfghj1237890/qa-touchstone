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

/// Mirrors tryParse(executor.ts:71-74): empty string → Null, valid JSON → parsed,
/// otherwise the raw string as a JSON String value.
fn try_parse(raw: &str) -> serde_json::Value {
    if raw.is_empty() {
        return serde_json::Value::Null;
    }
    serde_json::from_str(raw).unwrap_or_else(|_| serde_json::Value::String(raw.to_string()))
}

async fn run_send(
    config_path: String,
    request_id: String,
    identity_id: String,
    env_name: Option<String>,
    use_json: bool,
) -> std::process::ExitCode {
    use qa_touchstone_core::{buildreq, config::load_config, engine::qa_var_map, executor::execute_request};

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

    // Step 4: build var map
    let scoped = cfg.scoped_vars();
    let map = qa_var_map(&scoped, env_name.as_deref(), None, None);

    // Step 5: build the request payload (Err → exit 2)
    let rd = match buildreq::build_request(req, identity, &map) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("error: build_request failed: {e}");
            return std::process::ExitCode::from(2);
        }
    };

    // Step 6: execute + measure wall-clock ms
    let t0 = std::time::Instant::now();
    let resp = execute_request(&rd, &json!({}), None, None, ExecOptions::default()).await;
    let ms = t0.elapsed().as_millis() as i64;

    // Step 7: response adapter → assertion-response shape
    let assert_resp = json!({
        "status": resp["status"],
        "headers": resp["headers"],
        "time": ms,
        "body": try_parse(resp["body"].as_str().unwrap_or("")),
    });

    // Step 8: run assertions
    let results = qa_touchstone_core::engine::run_assertions(&req.assertions, &assert_resp);

    // Step 9: determine exit code
    // success != true → runtime failure (exit 1)
    // any assertion pass != true → assertion failure (exit 4)
    // all passed → exit 0
    let runtime_ok = resp["success"] == json!(true);
    let assertions_pass = results.iter().all(|r| r["pass"] == json!(true));

    let method = rd["request"]["method"].as_str().unwrap_or("?");
    let final_url = resp["finalUrl"].as_str()
        .or_else(|| rd["request"]["url"].as_str())
        .unwrap_or("?");
    let status = resp["status"].as_i64().unwrap_or(0);

    // Step 10: output
    if use_json {
        // Machine-readable JSON — REDACTED: request headers and identity auth are never echoed.
        // Only safe response fields are included.
        let json_out = json!({
            "success": runtime_ok,
            "status": status,
            "url": final_url,
            "method": method,
            "ms": ms,
            // response headers (from server) are included; request headers are NOT (auth redaction)
            "responseHeaders": resp["headers"],
            "body": assert_resp["body"],
            "assertions": results,
        });
        println!("{}", json_out);
    } else {
        // Human-readable output — no request headers, so secrets never leak here
        println!("{method} {final_url} → {status} ({ms}ms)");
        for r in &results {
            let pass = r["pass"] == json!(true);
            let mark = if pass { '\u{2713}' } else { '\u{2717}' }; // ✓ / ✗
            let label = r.get("label")
                .and_then(|v| v.as_str())
                .or_else(|| r.get("type").and_then(|v| v.as_str()))
                .unwrap_or("?");
            let actual = r.get("actual").and_then(|v| v.as_str()).unwrap_or("?");
            println!("{mark} {label} (actual: {actual})");
        }
        if !runtime_ok {
            let err = resp["error"].as_str().unwrap_or("request failed");
            eprintln!("error: runtime failure: {err}");
        }
    }

    if !runtime_ok {
        std::process::ExitCode::from(1)
    } else if !assertions_pass {
        std::process::ExitCode::from(4)
    } else {
        std::process::ExitCode::SUCCESS
    }
}
