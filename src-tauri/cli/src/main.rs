//! qa-touchstone-ci — headless CI runner. SP0a: skeleton + `ping` smoke.
//! Exit codes (fixed for all phases): 0 ok, 1 runtime error,
//! 2 invalid input (clap usage / config), 3 findings gate (reserved, SP3).
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
    }
}
