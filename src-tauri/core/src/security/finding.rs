//! Security finding model — emitted by the engines, consumed by `scan` reporters.
//! ≈ TS UnionFinding (types.ts) minus lifecycle/raw (those are SP3). Carries only
//! SAFE strings (no raw bodies/headers); `scan` redacts them on output.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity { Info, Low, Medium, High, Critical } // Ord: Critical is greatest

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineId { Matrix, Bola, Bfla, RateLimit, Oracle, Fuzz }

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

/// A per-cell build/exec failure tracked by an engine — not a vulnerability finding.
/// Emitted when a request could not be constructed or executed (DNS failure, bad URL,
/// connection refused, etc.) so callers can distinguish "scan ran clean" from "scan
/// couldn't run at all".
#[derive(Debug, Clone, Serialize)]
pub struct EngineError {
    pub engine: EngineId,
    #[serde(skip_serializing_if = "Option::is_none")] pub endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub identity: Option<String>,
    pub message: String,
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
    #[test] fn bfla_engine_id_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&EngineId::Bfla).unwrap(), "\"bfla\"");
        let rt: EngineId = serde_json::from_str("\"bfla\"").unwrap();
        assert_eq!(rt, EngineId::Bfla);
    }
    #[test] fn oracle_engine_serializes_lowercase() {
        assert_eq!(serde_json::to_value(EngineId::Oracle).unwrap(), "oracle");
        assert_ne!(EngineId::Oracle, EngineId::Matrix);
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
