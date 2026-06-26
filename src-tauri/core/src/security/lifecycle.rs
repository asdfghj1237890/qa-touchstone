//! Port of src/qa/findings.ts — findings lifecycle (fingerprint, diff, snapshot, gate).
//! Portable algorithms match findings.ts EXACTLY (TS-fixtured). `location_of`/`gate_count`
//! (threshold-parameterized)/`scope_hash_of` (descriptor) are documented Rust adaptations.
use crate::security::finding::{EngineId, Finding, Severity};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const FP_VERSION: u32 = 1;

/// FNV-1a 32-bit -> 8 lowercase hex (findings.ts:58-65). Iterates UTF-16 code units to
/// match JS `charCodeAt`; u32 wrapping arithmetic matches JS `>>> 0`-at-the-end.
pub fn fnv1a(s: &str) -> String {
    let mut h: u32 = 0x811c9dc5;
    for u in s.encode_utf16() {
        h ^= u as u32;
        h = h.wrapping_add((h << 1).wrapping_add(h << 4).wrapping_add(h << 7).wrapping_add(h << 8).wrapping_add(h << 24));
    }
    format!("{h:08x}")
}

/// normalizePath (oracles.ts:26): replace every `[<digits>]` with `[]`.
pub(crate) fn normalize_path(p: &str) -> String {
    use std::sync::OnceLock;
    use regex::Regex;
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\[\d+\]").unwrap()).replace_all(p, "[]").into_owned()
}

/// Engine token feeding the fingerprint — same lowercase strings as the TS `engine`.
fn engine_token(e: EngineId) -> &'static str { match e { EngineId::Matrix=>"matrix", EngineId::Bola=>"bola", EngineId::Bfla=>"bfla", EngineId::RateLimit=>"ratelimit", EngineId::Oracle=>"oracle" } }

/// ruleIdOf (findings.ts:21): rule_id, else oracle, else "unknown".
fn rule_id_of(f: &Finding) -> String {
    if !f.rule_id.is_empty() { f.rule_id.clone() } else if !f.oracle.is_empty() { f.oracle.clone() } else { "unknown".into() }
}

/// canonicalRuleId + RULE_ALIASES (findings.ts:28-37). `pub` — asserted by the alias fixture.
pub fn canonical_rule_id(id: &str) -> String {
    match id {
        "jwt-in-response" | "jwt-leakage" => "jwt".into(),
        "aws-access-key" => "aws-key".into(),
        "object-authz-bola" => "object-authz".into(),
        other => other.to_string(),
    }
}

/// locationOf — ADAPTATION (findings.ts:40-45 branches on a structured `ref` we don't carry).
/// Uniform: method + endpoint + identity. BOLA/rate-limit fold their test.id into `identity`
/// (Task 3), so this is collision-free across engines.
fn location_of(f: &Finding) -> String {
    format!("{} {} @{}", f.method.as_deref().unwrap_or(""), f.endpoint.as_deref().unwrap_or(""), f.identity.as_deref().unwrap_or(""))
}

/// fingerprint (findings.ts:71-74): fnv1a("engine|canonicalRuleId|location|normalizePath(path)").
pub fn fingerprint(f: &Finding) -> (String, String) {
    let material = format!("{}|{}|{}|{}", engine_token(f.engine), canonical_rule_id(&rule_id_of(f)), location_of(f), normalize_path(&f.path));
    (fnv1a(&material), material)
}

/// detailHash (findings.ts:81-83): fnv1a(title + " " + evidence). Computed over REDACTED strings.
pub fn detail_hash(f: &Finding) -> String { fnv1a(&format!("{} {}", f.title, f.evidence)) }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Presence { New, Carried, Resolved }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotItem {
    pub fp: String,
    #[serde(rename = "effectiveSeverity")] pub effective_severity: Severity,
    pub engine: EngineId,
    #[serde(rename = "ruleId")] pub rule_id: String,
    pub path: String,
    #[serde(rename = "locationLabel")] pub location_label: String,
    pub title: String,
    pub evidence: String,
    pub dfp: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    #[serde(rename = "fpVersion")] pub fp_version: u32,
    #[serde(rename = "runId", default)] pub run_id: String,
    #[serde(rename = "createdAt", default)] pub created_at: String,
    #[serde(rename = "scopeHash", default)] pub scope_hash: String,
    pub items: Vec<SnapshotItem>,
}

/// Per-finding lifecycle annotation (port of findings.ts BLANK_RECORD / LifecycleRecord),
/// keyed by fingerprint in `Records`. Read-only for the CLI. GUI bookkeeping fields
/// (createdAt/updatedAt/lastSeenAt/seenCount) are accepted-and-ignored (no deny_unknown_fields).
#[derive(Debug, Clone, Deserialize, Default)]
pub struct LifecycleRecord {
    #[serde(default)] pub suppressed: bool,
    #[serde(default, rename = "suppressReason")] pub suppress_reason: String,
    #[serde(default)] pub status: String,   // "" => "open" (normalized later in report::ann_of, per TS `r.status||'open'`)
    #[serde(default)] pub owner: String,
    #[serde(default)] pub note: String,
    #[serde(default, rename = "severityOverride")] pub severity_override: Option<Severity>,
}

pub type Records = BTreeMap<String, LifecycleRecord>;

/// The `scan --annotations <file>` JSON: `{ "fpVersion": 1, "records": { "<fp>": {...} } }`.
#[derive(Debug, Clone, Deserialize)]
pub struct AnnotationsFile {
    #[serde(rename = "fpVersion", default)] pub fp_version: u32,
    #[serde(default)] pub records: Records,
}

/// snapshotOf (findings.ts:112-140): dedup by fp, count repeats. effective_severity applies
/// severityOverride from records if present. Preserves first-seen order.
pub fn snapshot_of(findings: &[Finding], run_id: &str, created_at: &str, scope_hash: &str, records: &Records) -> Snapshot {
    let mut order: Vec<String> = Vec::new();
    let mut by_fp: BTreeMap<String, SnapshotItem> = BTreeMap::new();
    for f in findings {
        let (fp, _) = fingerprint(f);
        if let Some(it) = by_fp.get_mut(&fp) { it.count += 1; continue; }
        let eff = effective_severity(f, records.get(&fp).and_then(|r| r.severity_override));
        order.push(fp.clone());
        by_fp.insert(fp.clone(), SnapshotItem {
            fp, effective_severity: eff, engine: f.engine, rule_id: rule_id_of(f),
            path: normalize_path(&f.path), location_label: location_of(f),
            title: f.title.clone(), evidence: f.evidence.clone(), dfp: detail_hash(f), count: 1,
        });
    }
    Snapshot { fp_version: FP_VERSION, run_id: run_id.into(), created_at: created_at.into(), scope_hash: scope_hash.into(),
        items: order.into_iter().map(|fp| by_fp.remove(&fp).unwrap()).collect() }
}

/// diffRuns (findings.ts:149-159): fp -> New | Carried | Resolved.
pub fn diff_runs(current: &[SnapshotItem], baseline: &[SnapshotItem]) -> BTreeMap<String, Presence> {
    let base: BTreeSet<&str> = baseline.iter().map(|i| i.fp.as_str()).collect();
    let cur: BTreeSet<&str> = current.iter().map(|i| i.fp.as_str()).collect();
    let mut out = BTreeMap::new();
    for it in current { out.insert(it.fp.clone(), if base.contains(it.fp.as_str()) { Presence::Carried } else { Presence::New }); }
    for it in baseline { if !cur.contains(it.fp.as_str()) { out.insert(it.fp.clone(), Presence::Resolved); } }
    out
}

/// diffDetail (findings.ts:87-98): carried fps whose dfp changed.
pub fn diff_detail(current: &[SnapshotItem], baseline: &[SnapshotItem]) -> BTreeSet<String> {
    let base: BTreeMap<&str, &str> = baseline.iter().map(|i| (i.fp.as_str(), i.dfp.as_str())).collect();
    let mut changed = BTreeSet::new();
    for it in current {
        if let Some(d) = base.get(it.fp.as_str()) { if *d != it.dfp { changed.insert(it.fp.clone()); } }
    }
    changed
}

/// effectiveSeverity (findings.ts:101-106): override if present (already validated by caller), else severity.
pub fn effective_severity(f: &Finding, severity_override: Option<Severity>) -> Severity { severity_override.unwrap_or(f.severity) }

/// gateCount — ADAPTATION (findings.ts:164-178 hardcodes high/critical; we parameterize `fail_on`):
/// count items whose presence is New and effective_severity >= fail_on and not suppressed.
pub fn gate_count(items: &[SnapshotItem], diff: &BTreeMap<String, Presence>, fail_on: Severity, records: &Records) -> usize {
    items.iter().filter(|it| {
        matches!(diff.get(&it.fp), Some(Presence::New) | None)
            && it.effective_severity >= fail_on
            && !records.get(&it.fp).map(|r| r.suppressed).unwrap_or(false)
    }).count()
}

/// scopeHashOf — ADAPTATION: fnv1a over a CANONICAL serialized descriptor (the caller builds a
/// deterministic (insertion-ordered), secret-free string). NOT the TS scopeHashOf (raw JSON.stringify).
pub fn scope_hash_of(canonical_descriptor_json: &str) -> String { fnv1a(canonical_descriptor_json) }

#[cfg(test)]
mod tests {
    use super::*;
    fn f(engine: EngineId, rule: &str, sev: Severity, method: &str, endpoint: &str, identity: &str) -> Finding {
        Finding { engine, severity: sev, rule_id: rule.into(), oracle: "o".into(), title: "t".into(),
            path: format!("{method} {endpoint}"), evidence: "e".into(),
            method: Some(method.into()), endpoint: Some(endpoint.into()), identity: Some(identity.into()) }
    }
    #[test] fn location_is_collision_free_across_engines() {
        let a = fingerprint(&f(EngineId::Bola, "bola.cross-object", Severity::High, "GET", "getOrder", "t1: alice->bob")).0;
        let b = fingerprint(&f(EngineId::Bola, "bola.cross-object", Severity::High, "GET", "getOrder", "t2: alice->bob")).0;
        assert_ne!(a, b, "different test ids must fingerprint differently");
        let m = fingerprint(&f(EngineId::Matrix, "matrix.deny-bypass", Severity::High, "GET", "getOrder", "anon")).0;
        let r = fingerprint(&f(EngineId::RateLimit, "ratelimit.none", Severity::High, "GET", "getOrder", "anon")).0;
        assert_ne!(m, r);
    }
    #[test] fn gate_count_threshold_and_presence() {
        let mk = |fp: &str, sev: Severity| SnapshotItem{ fp:fp.into(), effective_severity:sev, engine:EngineId::Matrix, rule_id:"x".into(), path:String::new(), location_label:String::new(), title:String::new(), evidence:String::new(), dfp:String::new(), count:1 };
        let items = vec![mk("a", Severity::High), mk("b", Severity::Medium)];
        let mut diff = BTreeMap::new(); diff.insert("a".to_string(), Presence::New); diff.insert("b".to_string(), Presence::New);
        assert_eq!(gate_count(&items, &diff, Severity::High, &Records::new()), 1);
        assert_eq!(gate_count(&items, &diff, Severity::Medium, &Records::new()), 2);
        diff.insert("a".to_string(), Presence::Carried);
        assert_eq!(gate_count(&items, &diff, Severity::High, &Records::new()), 0);
        // a suppressed New-high finding is NOT counted
        diff.insert("a".to_string(), Presence::New);
        let mut recs = Records::new();
        recs.insert("a".into(), LifecycleRecord { suppressed: true, ..Default::default() });
        assert_eq!(gate_count(&items, &diff, Severity::High, &recs), 0);
    }
    #[test] fn override_reclassifies_and_moves_the_gate() {
        let finds = vec![ f(EngineId::Matrix, "matrix.deny-bypass", Severity::High, "GET", "u", "anon") ];
        let s0 = snapshot_of(&finds, "r", "", "h", &Records::new());
        let d0 = diff_runs(&s0.items, &[]);
        assert_eq!(gate_count(&s0.items, &d0, Severity::High, &Records::new()), 1); // New high gates
        let fp = s0.items[0].fp.clone();
        let mut down = Records::new();
        down.insert(fp.clone(), LifecycleRecord { severity_override: Some(Severity::Low), ..Default::default() });
        let s1 = snapshot_of(&finds, "r", "", "h", &down);
        assert_eq!(s1.items[0].effective_severity, Severity::Low);
        let d1 = diff_runs(&s1.items, &[]);
        assert_eq!(gate_count(&s1.items, &d1, Severity::High, &down), 0); // downgraded => no gate
    }
    #[test] fn fnv1a_is_deterministic() { assert_eq!(fnv1a("x"), fnv1a("x")); assert_ne!(fnv1a("a"), fnv1a("b")); }
    #[test] fn annotations_parse_defaults_and_ignores_gui_fields() {
        let j = r#"{ "fpVersion":1, "records": {
            "aa": { "suppressed": true, "suppressReason": "ok", "severityOverride": "low",
                    "createdAt": "x", "updatedAt": "y", "lastSeenAt": "z", "seenCount": 3 },
            "bb": { "status": "acknowledged", "owner": "alice", "note": "n" },
            "cc": {} } }"#;
        let a: AnnotationsFile = serde_json::from_str(j).unwrap();
        assert_eq!(a.fp_version, 1);
        let aa = &a.records["aa"];
        assert!(aa.suppressed && aa.suppress_reason == "ok" && aa.severity_override == Some(Severity::Low));
        let bb = &a.records["bb"];
        assert!(!bb.suppressed && bb.status == "acknowledged" && bb.owner == "alice" && bb.note == "n");
        let cc = &a.records["cc"];
        assert!(!cc.suppressed && cc.status.is_empty() && cc.severity_override.is_none()); // missing => defaults
    }
}
