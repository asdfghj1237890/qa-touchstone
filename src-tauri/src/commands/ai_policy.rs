use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPolicy {
    pub external_allowed: bool,
    pub forced_mode: Option<String>,
    pub locked: bool,
}

// Authoritative AI egress policy resolved at runtime from the process env.
// QA_ALLOW_EXTERNAL_AI=true|1 allows external AI; anything else (or absent) -> off.
// QA_AI_PRIVACY=local forces local-only and locks the selector.
#[tauri::command]
pub fn get_ai_policy() -> AiPolicy {
    let allow = std::env::var("QA_ALLOW_EXTERNAL_AI")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    let forced = std::env::var("QA_AI_PRIVACY").ok().filter(|v| v == "local");
    let locked = forced.is_some() || !allow;
    AiPolicy {
        external_allowed: allow,
        forced_mode: forced,
        locked,
    }
}
