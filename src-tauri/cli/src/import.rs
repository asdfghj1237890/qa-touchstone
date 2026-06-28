//! `import` command: convert a Postman v2.1 or OpenAPI 3/Swagger 2 spec (JSON)
//! into a qa.json config scaffold. Read-only, no network, no auth secrets built.
//!
//! Exit codes:
//!   0  ok (even when a baseUrl warning is emitted)
//!   1  runtime error (cannot write --out file)
//!   2  invalid input (file read error / non-JSON / unrecognized format)
use qa_touchstone_core::import::{qa_parse_import, to_config};
use std::process::ExitCode;

pub async fn run(input: String, base_url: Option<String>, out: Option<String>) -> ExitCode {
    // Step 1: read the input file (IO error → stderr + exit 2)
    let text = match std::fs::read_to_string(&input) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("error: cannot read `{input}`: {e}");
            return ExitCode::from(2);
        }
    };

    // Step 2: parse (non-JSON or unrecognized format → stderr + exit 2)
    let parsed = match qa_parse_import(&text) {
        Ok(p) => p,
        Err(msg) => {
            eprintln!("{msg}");
            return ExitCode::from(2);
        }
    };

    // Step 3: map to config Value
    let cfg_val = to_config(&parsed, base_url.as_deref());

    // Step 4: serialize to pretty JSON
    let json_out = serde_json::to_string_pretty(&cfg_val)
        .expect("serde_json serialization of a Value cannot fail");

    // Step 5: baseUrl warning — when any url is {{baseUrl}}-templated and baseUrl is empty
    let resolved_base = cfg_val["globals"]["variables"]["baseUrl"]
        .as_str()
        .unwrap_or("");
    if resolved_base.is_empty() {
        let has_templated = cfg_val["requests"]
            .as_array()
            .map(|reqs| {
                reqs.iter().any(|r| {
                    r["url"]
                        .as_str()
                        .map(|u| u.contains("{{baseUrl}}"))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);
        if has_templated {
            eprintln!("warn: one or more request urls use {{{{baseUrl}}}} but globals.variables.baseUrl is empty — set --base-url or fill globals.variables.baseUrl before send/run");
        }
    }

    // Step 6: write to --out or stdout
    if let Some(ref out_path) = out {
        if let Err(e) = std::fs::write(out_path, &json_out) {
            eprintln!("error: cannot write `{out_path}`: {e}");
            return ExitCode::from(1);
        }
    } else {
        println!("{json_out}");
    }

    ExitCode::SUCCESS
}
