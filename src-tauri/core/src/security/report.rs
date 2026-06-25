//! Port of the SARIF subset of src/qa/securityReport.ts. report_to_sarif matches the TS
//! for ReportModels whose ruleIds are NOT in SARIF_RULE_META (all of ours) — the rich rule
//! catalog is deferred (SP3b). Fixture compares PARSED JSON (semantic), not bytes.
use crate::security::finding::{EngineId, Severity};
use crate::security::lifecycle::{diff_runs, Presence, SnapshotItem};
use serde_json::{json, Value};

pub struct ReportFinding {
    pub fp: String,
    pub presence: Presence,
    pub severity: Severity,
    pub engine: EngineId,
    pub rule_id: String,
    pub title: String,
    pub location: String,
    pub path: String,
    pub count: u32,
    pub evidence: Option<String>,
}

pub struct ReportModel {
    pub findings: Vec<ReportFinding>,
}

fn sev_index(s: Severity) -> i32 {
    match s {
        Severity::Info => 0,
        Severity::Low => 1,
        Severity::Medium => 2,
        Severity::High => 3,
        Severity::Critical => 4,
    }
}

fn presence_order(p: Presence) -> i32 {
    match p {
        Presence::New => 0,
        Presence::Carried => 1,
        Presence::Resolved => 2,
    }
}

fn engine_token(e: EngineId) -> &'static str {
    match e {
        EngineId::Matrix => "matrix",
        EngineId::Bola => "bola",
        EngineId::RateLimit => "ratelimit",
    }
}

fn sev_token(s: Severity) -> &'static str {
    match s {
        Severity::Critical => "critical",
        Severity::High => "high",
        Severity::Medium => "medium",
        Severity::Low => "low",
        Severity::Info => "info",
    }
}

/// sevToSarifLevel (securityReport.ts:138-142).
pub fn sev_to_sarif_level(sev: Severity) -> &'static str {
    match sev {
        Severity::Critical | Severity::High => "error",
        Severity::Medium => "warning",
        _ => "note",
    }
}

/// sarifBaselineState (securityReport.ts:143).
pub fn sarif_baseline_state(p: Presence) -> &'static str {
    if p == Presence::Carried {
        "unchanged"
    } else {
        "new"
    }
}

fn security_severity_score(s: Severity) -> &'static str {
    match s {
        Severity::Critical => "9.5",
        Severity::High => "7.5",
        Severity::Medium => "5.0",
        Severity::Low => "3.0",
        Severity::Info => "1.0",
    }
}

fn pascal_case(id: &str) -> String {
    let w: String = id
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(|s| {
            let mut c = s.chars();
            c.next()
                .map(|f| f.to_ascii_uppercase().to_string() + c.as_str())
                .unwrap_or_default()
        })
        .collect();
    if w.is_empty() {
        "Rule".into()
    } else {
        w
    }
}

/// locationToUri (securityReport.ts:191-195), ported faithfully.
pub fn location_to_uri(location: &str) -> String {
    use regex::Regex;
    use std::sync::OnceLock;
    static LEAD: OnceLock<Regex> = OnceLock::new();
    static MID: OnceLock<Regex> = OnceLock::new();
    static BAD: OnceLock<Regex> = OnceLock::new();
    static EDGE: OnceLock<Regex> = OnceLock::new();
    let raw = location.trim();
    let raw = if raw.is_empty() { "finding" } else { raw };
    let s = LEAD
        .get_or_init(|| Regex::new(r"^([A-Z]+)\s+").unwrap())
        .replace(raw, "$1/");
    let s = MID
        .get_or_init(|| Regex::new(r"\s*·\s*").unwrap())
        .replace_all(&s, "/");
    let s = BAD
        .get_or_init(|| Regex::new(r"[^a-zA-Z0-9/_.{}@:-]+").unwrap())
        .replace_all(&s, "-");
    let s = EDGE
        .get_or_init(|| Regex::new(r"^-+|-+$").unwrap())
        .replace_all(&s, "");
    format!(
        "security/{}",
        if s.is_empty() {
            "finding".into()
        } else {
            s.into_owned()
        }
    )
}

/// buildReport (securityReport.ts:27-94) trimmed to SARIF needs: presence + sorted findings,
/// default annotations (no lifecycle/suppressions). resolved appended; sort presence then sev desc.
pub fn build_report(current: &[SnapshotItem], baseline: &[SnapshotItem]) -> ReportModel {
    let diff = diff_runs(current, baseline);
    let mut findings: Vec<ReportFinding> = Vec::new();
    for it in current {
        let presence = *diff.get(&it.fp).unwrap_or(&Presence::New);
        findings.push(ReportFinding {
            fp: it.fp.clone(),
            presence,
            severity: it.effective_severity,
            engine: it.engine,
            rule_id: it.rule_id.clone(),
            title: if it.title.is_empty() {
                it.rule_id.clone()
            } else {
                it.title.clone()
            },
            location: it.location_label.clone(),
            path: it.path.clone(),
            count: it.count,
            evidence: if it.evidence.is_empty() {
                None
            } else {
                Some(it.evidence.clone())
            },
        });
    }
    let cur_fps: std::collections::BTreeSet<&str> =
        current.iter().map(|i| i.fp.as_str()).collect();
    for it in baseline {
        if cur_fps.contains(it.fp.as_str()) {
            continue;
        }
        findings.push(ReportFinding {
            fp: it.fp.clone(),
            presence: Presence::Resolved,
            severity: it.effective_severity,
            engine: it.engine,
            rule_id: it.rule_id.clone(),
            title: if it.title.is_empty() {
                it.rule_id.clone()
            } else {
                it.title.clone()
            },
            location: it.location_label.clone(),
            path: it.path.clone(),
            count: it.count,
            evidence: None,
        });
    }
    findings.sort_by(|a, b| {
        presence_order(a.presence)
            .cmp(&presence_order(b.presence))
            .then(sev_index(b.severity).cmp(&sev_index(a.severity)))
    });
    ReportModel { findings }
}

/// reportToSarif (securityReport.ts:213-267), fallback synthesis (no SARIF_RULE_META — deferred).
pub fn report_to_sarif(model: &ReportModel) -> String {
    let current: Vec<&ReportFinding> = model
        .findings
        .iter()
        .filter(|f| f.presence != Presence::Resolved)
        .collect();
    let mut rule_ids: Vec<String> = Vec::new();
    let mut worst: std::collections::BTreeMap<String, Severity> =
        std::collections::BTreeMap::new();
    for f in &current {
        if !rule_ids.contains(&f.rule_id) {
            rule_ids.push(f.rule_id.clone());
        }
        worst
            .entry(f.rule_id.clone())
            .and_modify(|w| {
                if sev_index(f.severity) > sev_index(*w) {
                    *w = f.severity;
                }
            })
            .or_insert(f.severity);
    }
    let rules: Vec<Value> = rule_ids
        .iter()
        .map(|id| {
            let sample = current.iter().find(|f| &f.rule_id == id).unwrap();
            let short = if sample.title.is_empty() {
                id.clone()
            } else {
                sample.title.clone()
            };
            let sev = worst[id];
            json!({
                "id": id,
                "name": pascal_case(id),
                "shortDescription": { "text": short },
                "fullDescription": { "text": short },
                "helpUri": format!("https://github.com/asdfghj1237890/qa-touchstone#security-rules-{id}"),
                "help": { "text": format!("{short}\n\nDetected by QA Touchstone (engine: {}).", engine_token(sample.engine)) },
                "defaultConfiguration": { "level": sev_to_sarif_level(sev) },
                "properties": { "tags": ["security"], "security-severity": security_severity_score(sev) }
            })
        })
        .collect();
    let rule_index: std::collections::BTreeMap<&str, usize> = rule_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();
    let results: Vec<Value> = current
        .iter()
        .map(|f| {
            let msg = format!(
                "{}{} at {}",
                f.title,
                f.evidence
                    .as_deref()
                    .map(|e| format!(" — {e}"))
                    .unwrap_or_default(),
                f.location
            );
            json!({
                "ruleId": f.rule_id,
                "ruleIndex": rule_index[f.rule_id.as_str()],
                "level": sev_to_sarif_level(f.severity),
                "message": { "text": msg },
                "locations": [{
                    "physicalLocation": {
                        "artifactLocation": { "uri": location_to_uri(&f.location) },
                        "region": { "startLine": 1 }
                    },
                    "logicalLocations": [{
                        "fullyQualifiedName": if f.location.is_empty() { f.rule_id.clone() } else { f.location.clone() },
                        "kind": "member"
                    }]
                }],
                "partialFingerprints": { "qaFingerprint": f.fp },
                "baselineState": sarif_baseline_state(f.presence),
                "properties": {
                    "engine": engine_token(f.engine),
                    "severity": sev_token(f.severity),
                    "owner": "",
                    "status": "open",
                    "count": f.count
                }
            })
        })
        .collect();
    serde_json::to_string_pretty(&json!({
        "version": "2.1.0",
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "QA Touchstone",
                    "informationUri": "https://github.com/asdfghj1237890/qa-touchstone",
                    "rules": rules
                }
            },
            "results": results
        }]
    }))
    .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_item(
        fp: &str,
        sev: Severity,
        eng: EngineId,
        rule: &str,
        loc: &str,
        title: &str,
    ) -> SnapshotItem {
        SnapshotItem {
            fp: fp.into(),
            effective_severity: sev,
            engine: eng,
            rule_id: rule.into(),
            path: String::new(),
            location_label: loc.into(),
            title: title.into(),
            evidence: String::new(),
            dfp: String::new(),
            count: 1,
        }
    }

    #[test]
    fn sev_to_sarif_level_correct() {
        assert_eq!(sev_to_sarif_level(Severity::Critical), "error");
        assert_eq!(sev_to_sarif_level(Severity::High), "error");
        assert_eq!(sev_to_sarif_level(Severity::Medium), "warning");
        assert_eq!(sev_to_sarif_level(Severity::Low), "note");
        assert_eq!(sev_to_sarif_level(Severity::Info), "note");
    }

    #[test]
    fn sarif_baseline_state_correct() {
        assert_eq!(sarif_baseline_state(Presence::Carried), "unchanged");
        assert_eq!(sarif_baseline_state(Presence::New), "new");
        assert_eq!(sarif_baseline_state(Presence::Resolved), "new");
    }

    #[test]
    fn location_to_uri_transforms() {
        assert_eq!(
            location_to_uri("GET /foo · bar"),
            "security/GET//foo/bar"
        );
        assert_eq!(location_to_uri(""), "security/finding");
        assert_eq!(
            location_to_uri("DELETE delU @anon"),
            "security/DELETE/delU-@anon"
        );
    }

    #[test]
    fn pascal_case_splits_on_dots_and_dashes() {
        assert_eq!(pascal_case("matrix.deny-bypass"), "MatrixDenyBypass");
        assert_eq!(pascal_case("bola.cross-object"), "BolaCorssObject".replacen("CorssObject", "CrossObject", 1));
        assert_eq!(pascal_case(""), "Rule");
    }

    #[test]
    fn build_and_sarif_roundtrip() {
        let cur = vec![
            mk_item("aa", Severity::High, EngineId::Bola, "bola.cross-object",
                    "GET getOrder @t1: alice\u{2192}bob", "Cross-object access confirmed"),
            mk_item("bb", Severity::Critical, EngineId::Matrix, "matrix.deny-bypass",
                    "DELETE delU @anon", "Access-control bypass"),
        ];
        let base = vec![
            mk_item("bb", Severity::Critical, EngineId::Matrix, "matrix.deny-bypass",
                    "DELETE delU @anon", "Access-control bypass"),
        ];
        let model = build_report(&cur, &base);
        // bb is carried, aa is new; sort: presence(new=0,carried=1) then sev desc
        // new: aa(high), bb(critical) — wait: bb is carried not new
        // new findings: aa(high); carried: bb(critical)
        // sort by presence first: new(0) < carried(1), then sev desc
        assert_eq!(model.findings[0].fp, "aa"); // new, high
        assert_eq!(model.findings[1].fp, "bb"); // carried, critical
        let sarif_str = report_to_sarif(&model);
        let v: serde_json::Value = serde_json::from_str(&sarif_str).unwrap();
        assert_eq!(v["version"], "2.1.0");
        assert!(v["runs"][0]["tool"]["driver"]["rules"].is_array());
        assert!(v["runs"][0]["results"].is_array());
    }
}
