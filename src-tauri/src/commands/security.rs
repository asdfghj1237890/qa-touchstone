//! Security-scan IPC surface. Slice 1: matrix (+ inline oracles) via the Rust core.
use serde_json::{json, Value};

/// Testable inner fn: parse the CI-config JSON, run the matrix engine, and shape
/// the result. Secrets are already inlined as literals by the TS serializer, so
/// the env resolver is only a safety net for any `{env}` refs.
pub(crate) async fn matrix_scan(config_json: &str, env: Option<&str>) -> Result<Value, String> {
    let cfg = qa_touchstone_core::config::load_config(config_json, &|k| std::env::var(k).ok())?;
    let (findings, errors) = qa_touchstone_core::security::runner::run_matrix(&cfg, env).await;
    Ok(json!({ "findings": findings, "errors": errors, "engineSource": "core" }))
}

/// IPC command. `config` is the JSON object built by src/qa/coreConfig.ts.
#[tauri::command]
pub async fn run_security_matrix(config: Value, env: Option<String>) -> Result<Value, String> {
    matrix_scan(&config.to_string(), env.as_deref()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn anon_reaching_a_deny_expected_endpoint_is_a_finding() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"ok": true})))
            .mount(&server)
            .await;
        let config = format!(
            r#"{{
              "version": 1,
              "environments": [],
              "identities": [{{ "id": "anon", "auth": {{ "type": "none" }} }}],
              "requests": [{{ "id": "getU", "method": "GET", "url": "{}/u" }}],
              "security": {{ "matrix": {{ "endpoints": ["getU"], "expect": {{ "getU": {{ "anon": "deny" }} }} }} }}
            }}"#,
            server.uri()
        );
        let out = matrix_scan(&config, None).await.expect("scan runs");
        assert_eq!(out["engineSource"], "core");
        let findings = out["findings"].as_array().expect("findings array");
        assert_eq!(findings.len(), 1, "one deny-bypass finding");
        assert_eq!(findings[0]["engine"], "matrix");
        assert_eq!(findings[0]["rule_id"], "matrix.deny-bypass");
    }

    #[tokio::test]
    async fn serializer_shaped_config_is_accepted_by_load_config() {
        // Mirrors the exact JSON src/qa/coreConfig.ts emits — proves deny_unknown_fields
        // compliance (round-trip contract between the TS serializer and the core).
        let config = r#"{
          "version": 1,
          "globals": { "variables": { "ua": "qa" } },
          "environments": [{ "name": "staging", "variables": { "apiHost": "https://x" } }],
          "identities": [
            { "id": "admin", "auth": { "type": "bearer", "token": "t" }, "privileged": true },
            { "id": "anon", "auth": { "type": "none" }, "privileged": false }
          ],
          "requests": [{ "id": "getU", "method": "GET", "url": "{{apiHost}}/u",
            "headers": [{ "key": "Accept", "value": "application/json" }],
            "query": [], "body": null, "assertions": [], "privileged": null }],
          "security": { "matrix": { "endpoints": ["getU"], "denySet": [401,403],
            "expect": { "getU": { "anon": "deny" } } }, "oracles": { "sensitive": true, "schema": true } }
        }"#;
        qa_touchstone_core::config::load_config(config, &|_| None).expect("config accepted");
    }
}
