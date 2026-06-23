//! One request execution + assertion scoring, shared by `send` and `run`.
use crate::engine::run_assertions;
use crate::executor::{execute_request, ExecOptions};
use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub struct StepResult {
    pub success: bool,
    pub status: i64,
    pub ms: u64,
    pub final_url: String,
    pub error: Option<String>,
    /// Response headers (for send's --json responseHeaders); Null on error.
    pub headers: Value,
    /// Parsed response body (for send's --json body); Null on error.
    pub body: Value,
    /// run_assertions output (empty on error).
    pub results: Vec<Value>,
}

/// tryParse mirror (executor.ts:71-74): empty → Null; valid JSON → parsed; else the raw string.
/// Private: returns the UNREDACTED body — callers consume the redaction-agnostic
/// `StepResult.body` (and redact at output) rather than parsing raw bodies themselves.
fn try_parse(raw: &str) -> Value {
    if raw.is_empty() {
        return Value::Null;
    }
    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_string()))
}

/// Execute one already-built request and score `assertions`. Structured output only
/// (no printing/redaction — the caller redacts). On execute failure, returns the error
/// and runs NO assertions (matching send's runtime-failure short-circuit).
pub async fn run_step(
    prepared_request: &Value,
    assertions: &[Value],
    options: ExecOptions,
) -> StepResult {
    let t0 = std::time::Instant::now();
    let resp = execute_request(prepared_request, &json!({}), None, None, options).await;
    let ms = t0.elapsed().as_millis() as u64;

    let status = resp["status"].as_i64().unwrap_or(0);
    let final_url = resp["finalUrl"]
        .as_str()
        .or_else(|| prepared_request["request"]["url"].as_str())
        .unwrap_or("")
        .to_string();

    if resp["success"] != json!(true) {
        let error = resp["error"]
            .as_str()
            .unwrap_or("request failed")
            .to_string();
        return StepResult {
            success: false,
            status,
            ms,
            final_url,
            error: Some(error),
            headers: Value::Null,
            body: Value::Null,
            results: vec![],
        };
    }

    let headers = resp.get("headers").cloned().unwrap_or(Value::Null);
    let body = try_parse(resp["body"].as_str().unwrap_or(""));
    let assert_resp = json!({
        "status": resp["status"],
        "headers": headers.clone(),
        "time": ms,
        "body": body.clone(),
    });
    let results = run_assertions(assertions, &assert_resp);

    StepResult {
        success: true,
        status,
        ms,
        final_url,
        error: None,
        headers,
        body,
        results,
    }
}
