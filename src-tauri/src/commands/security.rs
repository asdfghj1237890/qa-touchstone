//! Security-scan IPC surface. Slice 1: matrix (+ inline oracles) via the Rust core.
use serde_json::{json, Value};

/// Testable inner fn: parse the CI-config JSON, run the matrix engine, and shape
/// the result. Secrets are already inlined as literals by the TS serializer, so
/// the env resolver is only a safety net for any `{env}` refs.
pub(crate) async fn matrix_scan(config_json: &str, env: Option<&str>) -> Result<Value, String> {
    let cfg = qa_touchstone_core::config::load_config(config_json, &|k| std::env::var(k).ok())?;
    let (findings, errors) = qa_touchstone_core::security::runner::run_matrix(&cfg, env).await;
    // run_matrix is deliberately non-redacting (see runner.rs) — the caller must scrub
    // secrets before returning, the same contract the CLI `scan` honors (scan.rs). A
    // resolved URL can carry an apikey-in-query value, and a connection error echoes that
    // URL verbatim into EngineError.message, so redact findings AND errors with the union
    // of the identities' auth secrets before they cross the IPC boundary.
    let red = qa_touchstone_core::redact::RedactionSet::from_auths(
        cfg.identities.iter().map(|i| &i.auth),
    );
    let findings = red.redact_value(&serde_json::to_value(&findings).unwrap_or(Value::Null));
    let errors = red.redact_value(&serde_json::to_value(&errors).unwrap_or(Value::Null));
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

    #[tokio::test]
    async fn apikey_in_query_secret_is_redacted_from_error_output() {
        // A request that fails to connect echoes the resolved URL in its error; with an
        // apikey-in-query identity that URL carries the plaintext key. run_matrix is
        // non-redacting by contract (see runner.rs), so matrix_scan MUST scrub it before
        // returning across the IPC boundary. Bind+drop a listener for a closed port so the
        // request is refused immediately and deterministically.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let secret = "supersecretkey123";
        let config = format!(
            r#"{{
              "version": 1,
              "environments": [],
              "identities": [{{ "id": "apiuser", "auth": {{ "type": "apikey", "key": "api_key", "value": "{secret}", "in": "query" }} }}],
              "requests": [{{ "id": "getU", "method": "GET", "url": "http://127.0.0.1:{port}/u" }}],
              "security": {{ "matrix": {{ "endpoints": ["getU"], "expect": {{ "getU": {{ "apiuser": "allow" }} }} }} }}
            }}"#
        );
        let out = matrix_scan(&config, None).await.expect("scan runs");
        let serialized = out.to_string();
        let errors = out["errors"].as_array().expect("errors array");
        assert!(
            !errors.is_empty(),
            "expected a connection-refused error to redact"
        );
        assert!(
            !serialized.contains(secret),
            "apikey secret leaked into the IPC payload: {serialized}"
        );
        // The error message carried the resolved URL, so redaction must have replaced the
        // secret with the marker (guards against the assertion above passing vacuously).
        assert!(
            errors[0]["message"]
                .as_str()
                .unwrap_or_default()
                .contains("***REDACTED***"),
            "expected the redaction marker in the error message: {}",
            errors[0]["message"]
        );
    }
}
