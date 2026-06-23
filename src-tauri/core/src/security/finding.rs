//! Security finding model — emitted by the engines, consumed by `scan` reporters.
//! ≈ TS UnionFinding (types.ts) minus lifecycle/raw (those are SP3). Carries only
//! SAFE strings (no raw bodies/headers); `scan` redacts them on output.
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity { Info, Low, Medium, High, Critical } // Ord: Critical is greatest

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineId { Matrix, Bola, RateLimit }

#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub engine: EngineId,
    pub severity: Severity,
    pub rule_id: String,
    pub oracle: String,
    pub title: String,
    pub path: String,
    pub evidence: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub identity: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn severity_orders_critical_highest() {
        assert!(Severity::Critical > Severity::High);
        assert!(Severity::High > Severity::Medium);
        assert!(Severity::Medium > Severity::Low);
        assert!(Severity::Low > Severity::Info);
        assert!(Severity::High >= Severity::High);
    }
    #[test]
    fn serializes_lowercase_and_skips_none() {
        let f = Finding { engine: EngineId::Matrix, severity: Severity::High, rule_id: "matrix.deny-bypass".into(),
            oracle: "matrix-cell".into(), title: "t".into(), path: "GET /u".into(), evidence: "e".into(),
            method: Some("GET".into()), endpoint: Some("getU".into()), identity: None };
        let v = serde_json::to_value(&f).unwrap();
        assert_eq!(v["engine"], "matrix"); assert_eq!(v["severity"], "high");
        assert!(v.get("identity").is_none(), "None fields skipped");
    }
}
