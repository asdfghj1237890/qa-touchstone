//! Port of the SARIF subset of src/qa/securityReport.ts. report_to_sarif matches the TS
//! for ReportModels whose ruleIds are NOT in SARIF_RULE_META (all of ours) — the rich rule
//! catalog is deferred (SP3b). Fixture compares PARSED JSON (semantic), not bytes.
use crate::security::finding::{EngineId, Severity};
use crate::security::lifecycle::{diff_runs, Presence, SnapshotItem, Records, LifecycleRecord};
use crate::xml::{sanitize_xml, xml_attr_escape};
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
    pub suppressed: bool,
    pub suppress_reason: String,
    pub status: String,
    pub owner: String,
    pub note: String,
}

pub struct ReportMeta { pub run_id: String, pub scope_mismatch: bool }
pub struct EngineReport { pub engine: String, pub ran: bool, pub findings: usize, pub errors: usize }
pub struct ReportSummary {
    pub total: usize,
    pub critical: usize, pub high: usize, pub medium: usize, pub low: usize, pub info: usize,
    pub new: usize, pub carried: usize, pub resolved: usize,
    pub fail_on: Severity,   // the gate threshold, carried for the reporters
    pub gated: usize,        // count(presence==New && severity >= fail_on)
}
pub struct ReportModel {
    pub meta: ReportMeta,
    pub engines: Vec<EngineReport>,
    pub summary: ReportSummary,
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
        EngineId::Oracle => "oracle",
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

/// annOf (securityReport.ts:17): annotation fields for a fp, with safe defaults. "" status => "open".
fn ann_of(rec: Option<&LifecycleRecord>) -> (bool, String, String, String, String) {
    match rec {
        Some(r) => (
            r.suppressed, r.suppress_reason.clone(),
            if r.status.is_empty() { "open".into() } else { r.status.clone() },
            r.owner.clone(), r.note.clone(),
        ),
        None => (false, String::new(), "open".into(), String::new(), String::new()),
    }
}

/// buildReport (securityReport.ts:27-94) trimmed to SARIF needs: presence + sorted findings,
/// default annotations (no lifecycle/suppressions). resolved appended; sort presence then sev desc.
pub fn build_report(
    current: &[SnapshotItem], baseline: &[SnapshotItem],
    engines: Vec<EngineReport>, fail_on: Severity, scope_mismatch: bool, run_id: &str,
    records: &Records,
) -> ReportModel {
    let diff = diff_runs(current, baseline);
    let mut findings: Vec<ReportFinding> = Vec::new();
    for it in current {
        let presence = *diff.get(&it.fp).unwrap_or(&Presence::New);
        let (suppressed, suppress_reason, status, owner, note) = ann_of(records.get(&it.fp));
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
            suppressed, suppress_reason, status, owner, note,
        });
    }
    let cur_fps: std::collections::BTreeSet<&str> =
        current.iter().map(|i| i.fp.as_str()).collect();
    for it in baseline {
        if cur_fps.contains(it.fp.as_str()) {
            continue;
        }
        let (suppressed, suppress_reason, status, owner, note) = ann_of(records.get(&it.fp));
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
            suppressed, suppress_reason, status, owner, note,
        });
    }
    findings.sort_by(|a, b| {
        presence_order(a.presence)
            .cmp(&presence_order(b.presence))
            .then(sev_index(b.severity).cmp(&sev_index(a.severity)))
    });
    // Compute the summary over the CURRENT (non-resolved) findings:
    let mut s = ReportSummary { total: 0, critical:0, high:0, medium:0, low:0, info:0,
        new:0, carried:0, resolved:0, fail_on, gated:0 };
    for f in &findings {
        match f.presence {
            Presence::New => s.new += 1,
            Presence::Carried => s.carried += 1,
            Presence::Resolved => { s.resolved += 1; continue; }
        }
        s.total += 1;
        match f.severity {
            Severity::Critical => s.critical += 1, Severity::High => s.high += 1, Severity::Medium => s.medium += 1,
            Severity::Low => s.low += 1, Severity::Info => s.info += 1,
        }
        if is_gate_failure(f, fail_on) { s.gated += 1; } // New ∧ sev>=fail_on ∧ !suppressed — matches the exit gate + JUnit
    }
    ReportModel { meta: ReportMeta { run_id: run_id.into(), scope_mismatch }, engines, summary: s, findings }
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
            let mut result = json!({
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
                    "owner": f.owner,
                    "status": f.status,
                    "count": f.count
                }
            });
            if f.suppressed {
                result["suppressions"] = json!([{ "kind": "external", "justification": f.suppress_reason }]);
            }
            result
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

fn is_gate_failure(f: &ReportFinding, fail_on: Severity) -> bool {
    f.presence == Presence::New && f.severity >= fail_on && !f.suppressed
}

/// reportToJUnit (securityReport.ts:113-136). <testsuite> per engine in FIRST-SEEN order; a finding
/// is a <failure> iff New && severity >= summary.fail_on && !suppressed. durations omitted (time="0.000").
pub fn report_to_junit(model: &ReportModel) -> String {
    use std::collections::BTreeMap;
    let fail_on = model.summary.fail_on;
    let current: Vec<&ReportFinding> = model.findings.iter().filter(|f| f.presence != Presence::Resolved).collect();
    let total = current.len();
    let total_fail = current.iter().filter(|f| is_gate_failure(f, fail_on)).count();
    let total_skip = current.iter().filter(|f| f.suppressed).count();
    let mut order: Vec<EngineId> = Vec::new();
    let mut by_engine: BTreeMap<&'static str, Vec<&ReportFinding>> = BTreeMap::new();
    for f in &current {
        let tok = engine_token(f.engine);
        if !order.iter().any(|e| engine_token(*e) == tok) { order.push(f.engine); }
        by_engine.entry(tok).or_default().push(f);
    }
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str(&format!(
        "<testsuites name=\"QA Touchstone Security\" tests=\"{total}\" failures=\"{total_fail}\" skipped=\"{total_skip}\" time=\"0.000\">\n"));
    for eng in &order {
        let tok = engine_token(*eng);
        let fs = &by_engine[tok];
        let sfail = fs.iter().filter(|f| is_gate_failure(f, fail_on)).count();
        let sskip = fs.iter().filter(|f| f.suppressed).count();
        out.push_str(&format!(
            "  <testsuite name=\"{}\" tests=\"{}\" failures=\"{}\" skipped=\"{}\">\n", xml_attr_escape(tok), fs.len(), sfail, sskip));
        for f in fs {
            let name = xml_attr_escape(&format!("{} @ {}", f.rule_id, f.location));
            let cls = xml_attr_escape(tok);
            if is_gate_failure(f, fail_on) {
                let note = if f.note.is_empty() { String::new() } else { format!("\n{}", f.note) };
                let body = format!("{}{}{}", f.location, f.evidence.as_deref().map(|e| format!("\n{e}")).unwrap_or_default(), note);
                let body = sanitize_xml(&body).replace("]]>", "]]]]><![CDATA[>");
                let msg = xml_attr_escape(&format!("{} ({})", f.title, sev_token(f.severity)));
                out.push_str(&format!("    <testcase name=\"{name}\" classname=\"{cls}\"><failure message=\"{msg}\"><![CDATA[{body}]]></failure></testcase>\n"));
            } else if f.suppressed {
                let msg = xml_attr_escape(&format!("suppressed: {}", f.suppress_reason));
                out.push_str(&format!("    <testcase name=\"{name}\" classname=\"{cls}\"><skipped message=\"{msg}\"/></testcase>\n"));
            } else {
                out.push_str(&format!("    <testcase name=\"{name}\" classname=\"{cls}\"/>\n"));
            }
        }
        out.push_str("  </testsuite>\n");
    }
    out.push_str("</testsuites>\n");
    out
}

/// htmlEscape (securityReport.ts:98).
pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// reportToHtml (securityReport.ts:297-316), CLI-adapted: durations omitted; gate label threshold-neutral;
/// evidence = the plain redacted string (no GUI evidenceArtifact); the GUI's separate Owner/Status columns
/// are merged into one compact "Triage" column (status/owner/suppressed). Every interpolated field is html_escape'd.
pub fn report_to_html(model: &ReportModel) -> String {
    let h = html_escape;
    let s = &model.summary;
    let sev_chip = |n: usize, name: &str| if n > 0 { format!("<span class=\"chip sev-{name}\">{n} {name}</span>") } else { String::new() };
    let chips = format!("{}{}{}{}{}",
        sev_chip(s.critical,"critical"), sev_chip(s.high,"high"), sev_chip(s.medium,"medium"), sev_chip(s.low,"low"), sev_chip(s.info,"info"));
    let eng_rows: String = model.engines.iter().map(|e| format!(
        "<tr><td>{}</td><td>{}</td><td>{}</td></tr>", h(&e.engine), if e.ran { e.findings.to_string() } else { "skipped".into() }, e.errors)).collect();
    let find_rows: String = model.findings.iter().map(|f| {
        let presence = match f.presence { Presence::New=>"new", Presence::Carried=>"carried", Presence::Resolved=>"resolved" };
        let supp = if f.suppressed { " suppressed" } else { "" };
        let mut tri: Vec<String> = Vec::new();
        if !f.status.is_empty() && f.status != "open" { tri.push(h(&f.status)); }
        if !f.owner.is_empty() { tri.push(h(&f.owner)); }
        if f.suppressed { tri.push(if f.suppress_reason.is_empty() { "(suppressed)".into() } else { format!("(suppressed: {})", h(&f.suppress_reason)) }); }
        let triage = tri.join(" \u{00b7} ");
        format!("<tr class=\"p-{presence}{supp}\"><td>{presence}</td><td class=\"sev-{sev}\">{sev}</td><td>{eng}</td><td><code>{rule}</code> {title}{cnt}</td><td><code>{loc}</code></td><td>{ev}</td><td>{triage}</td></tr>",
            sev=sev_token(f.severity), eng=h(engine_token(f.engine)), rule=h(&f.rule_id), title=h(&f.title),
            cnt=if f.count>1 { format!(" \u{00d7}{}", f.count) } else { String::new() },
            loc=h(&f.location), ev=f.evidence.as_deref().map(|e| format!("<code>{}</code>", h(e))).unwrap_or_default(), triage=triage)
    }).collect();
    format!("<!doctype html><html><head><meta charset=\"utf-8\"><title>QA Touchstone — Security report</title>\n\
<style>body{{font-family:system-ui,sans-serif;margin:24px;color:#111}}table{{border-collapse:collapse;width:100%;margin:12px 0}}th,td{{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:13px}}.gate{{font-size:20px;font-weight:700}}.chip{{display:inline-block;padding:2px 8px;margin:2px;border-radius:10px;background:#eee}}.sev-critical,.sev-high{{color:#b91c1c}}.sev-medium{{color:#b45309}}.suppressed,.p-resolved{{opacity:.55}}</style>\n\
</head><body>\n<h1>QA Touchstone — Security report</h1>\n\
<p>Run {run}{drift}</p>\n<p class=\"gate\">{gated} new (\u{2265} {fail_on})</p>\n\
<p>{total} findings — {new} new \u{00b7} {carried} carried \u{00b7} {resolved} resolved</p>\n<div>{chips}</div>\n\
<h2>Engines</h2><table><thead><tr><th>Engine</th><th>Findings</th><th>Errors</th></tr></thead><tbody>{eng_rows}</tbody></table>\n\
<h2>Findings</h2><table><thead><tr><th>State</th><th>Severity</th><th>Engine</th><th>Rule</th><th>Location</th><th>Evidence</th><th>Triage</th></tr></thead><tbody>{find_rows}</tbody></table>\n</body></html>",
        run=h(&model.meta.run_id), drift=if model.meta.scope_mismatch { " \u{00b7} <strong>baseline scope differs</strong>" } else { "" },
        gated=s.gated, fail_on=sev_token(s.fail_on), total=s.total, new=s.new, carried=s.carried, resolved=s.resolved)
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

    #[test] fn junit_failure_set_follows_fail_on() {
        let cur = vec![ mk_item("a", Severity::Medium, EngineId::Matrix, "matrix.deny-bypass", "GET u @anon", "t") ];
        let hi = build_report(&cur, &[], vec![], Severity::High, false, "r", &Records::new());
        assert!(!report_to_junit(&hi).contains("<failure"));   // medium NEW does not fail at fail_on=high
        let md = build_report(&cur, &[], vec![], Severity::Medium, false, "r", &Records::new());
        assert!(report_to_junit(&md).contains("<failure"));    // ...but does at fail_on=medium
    }

    #[test] fn junit_cdata_splits_and_sanitizes_controls() {
        // A New high finding whose evidence carries a raw "]]>" (would prematurely close CDATA)
        // and a C0 control char (illegal in XML 1.0).
        let mut it = mk_item("a", Severity::High, EngineId::Matrix, "matrix.deny-bypass", "GET u @anon", "t");
        it.evidence = "danger ]]> mid \u{0007} end".into();
        let model = build_report(&[it], &[], vec![], Severity::High, false, "r", &Records::new());
        let xml = report_to_junit(&model);
        assert!(xml.contains("]]]]><![CDATA[>"), "]]> must be split across CDATA sections");
        assert!(!xml.contains('\u{0007}'), "C0 control must be sanitized to U+FFFD");
        // The split must keep the document well-formed (a bad ]]> escape would fail to parse).
        roxmltree::Document::parse(&xml).expect("valid JUnit XML after CDATA split + sanitize");
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
        let model = build_report(&cur, &base, vec![], Severity::High, false, "t", &Records::new());
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

    #[test] fn html_contains_findings_and_threshold_gate() {
        let cur = vec![ mk_item("a", Severity::High, EngineId::Bola, "bola.cross-object", "GET getOrder @t1", "Cross-object") ];
        let model = build_report(&cur, &[], vec![EngineReport{engine:"bola".into(),ran:true,findings:1,errors:0}], Severity::High, false, "cli", &Records::new());
        let html = report_to_html(&model);
        assert!(html.contains("bola.cross-object"));
        assert!(html.contains("1 new (\u{2265} high)"), "threshold-neutral gate label");
        assert!(html.contains("<!doctype html>"));
    }
    #[test] fn html_gate_headline_and_summary_exclude_suppressed() {
        let cur = vec![ mk_item("aa", Severity::High, EngineId::Matrix, "matrix.deny-bypass", "GET u @anon", "t") ];
        let m0 = build_report(&cur, &[], vec![], Severity::High, false, "cli", &Records::new());
        assert_eq!(m0.summary.gated, 1);
        assert!(report_to_html(&m0).contains("1 new (\u{2265} high)"));
        let mut recs = Records::new();
        recs.insert("aa".into(), LifecycleRecord { suppressed: true, ..Default::default() });
        let m1 = build_report(&cur, &[], vec![], Severity::High, false, "cli", &recs);
        assert_eq!(m1.summary.gated, 0, "suppressed New-high must not be counted as gated");
        assert!(report_to_html(&m1).contains("0 new (\u{2265} high)"), "suppressed finding must not inflate the gate headline");
    }
    #[test] fn html_escapes_hostile_fields() {
        let cur = vec![ mk_item("a", Severity::High, EngineId::Matrix, "<script>x</script>", "GET u @anon", "<b>t</b>") ];
        let model = build_report(&cur, &[], vec![], Severity::High, false, "cli", &Records::new());
        let html = report_to_html(&model);
        assert!(!html.contains("<script>x</script>") && html.contains("&lt;script&gt;") && html.contains("&lt;b&gt;"), "rule id AND title escaped");
    }

    #[test] fn junit_suppressed_is_skipped_not_failure() {
        let cur = vec![ mk_item("aa", Severity::High, EngineId::Matrix, "matrix.deny-bypass", "GET u @anon", "t") ];
        let mut recs = Records::new();
        recs.insert("aa".into(), LifecycleRecord { suppressed: true, suppress_reason: "ok".into(), ..Default::default() });
        let xml = report_to_junit(&build_report(&cur, &[], vec![], Severity::High, false, "r", &recs));
        assert!(xml.contains("<skipped message=\"suppressed: ok\"") && !xml.contains("<failure"));
        assert!(xml.contains("skipped=\"1\""));
    }
    #[test] fn junit_failure_cdata_includes_note() {
        let cur = vec![ mk_item("aa", Severity::High, EngineId::Matrix, "matrix.deny-bypass", "GET u @anon", "t") ];
        let mut recs = Records::new();
        recs.insert("aa".into(), LifecycleRecord { note: "see JIRA-1".into(), ..Default::default() });
        let xml = report_to_junit(&build_report(&cur, &[], vec![], Severity::High, false, "r", &recs));
        assert!(xml.contains("<failure") && xml.contains("see JIRA-1]]>"), "note is appended into the failure CDATA body");
    }
    #[test] fn html_triage_shows_owner_status_and_dims_suppressed() {
        let cur = vec![ mk_item("aa", Severity::High, EngineId::Bola, "bola.cross-object", "GET g @t1", "X") ];
        let mut recs = Records::new();
        recs.insert("aa".into(), LifecycleRecord { suppressed: true, suppress_reason: "ok".into(),
            status: "acknowledged".into(), owner: "alice".into(), ..Default::default() });
        let html = report_to_html(&build_report(&cur, &[], vec![], Severity::High, false, "cli", &recs));
        assert!(html.contains("<th>Triage</th>"));
        assert!(html.contains("acknowledged") && html.contains("alice") && html.contains("(suppressed: ok)"));
        assert!(html.contains("class=\"p-new suppressed\""));
    }

    #[test] fn sarif_emits_suppressions_and_owner_status() {
        let cur = vec![ mk_item("aa", Severity::High, EngineId::Bola, "bola.cross-object", "GET getOrder @t1", "X") ];
        let mut recs = Records::new();
        recs.insert("aa".into(), LifecycleRecord { suppressed: true, suppress_reason: "accepted".into(),
            status: "acknowledged".into(), owner: "alice".into(), ..Default::default() });
        let model = build_report(&cur, &[], vec![], Severity::High, false, "r", &recs);
        let v: serde_json::Value = serde_json::from_str(&report_to_sarif(&model)).unwrap();
        let r0 = &v["runs"][0]["results"][0];
        assert_eq!(r0["suppressions"][0]["kind"], "external");
        assert_eq!(r0["suppressions"][0]["justification"], "accepted");
        assert_eq!(r0["properties"]["owner"], "alice");
        assert_eq!(r0["properties"]["status"], "acknowledged");
    }
}
