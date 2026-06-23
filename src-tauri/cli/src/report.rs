//! Strict run-report DTO + reporters. The DTO IS the output allowlist: it holds ONLY
//! safe, already-redacted fields — never response body/headers, prepared requests,
//! local var maps, raw data rows, or executor metadata (which carries auth).
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct RunReport {
    pub collection: String,
    pub identity: String,
    pub iterations: usize,
    pub totals: Totals,
    pub results: Vec<ResultRow>,
    pub ok: bool,
}

#[derive(Debug, Serialize)]
pub struct Totals {
    pub requests: usize,
    pub assertions: usize,
    pub passed: usize,
    pub failed: usize,
    pub errors: usize,
}

#[derive(Debug, Serialize)]
pub struct ResultRow {
    pub iter: usize,
    pub request: String,
    pub status: i64,
    pub ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub assertions: Vec<AssertionRow>,
}

#[derive(Debug, Serialize)]
pub struct AssertionRow {
    pub label: String,
    pub pass: bool,
    pub actual: String,
}

impl RunReport {
    /// Compute totals + `ok` from rows, then construct. All strings in `results`
    /// MUST already be redacted by the caller (run loop).
    pub fn build(collection: String, identity: String, iterations: usize, results: Vec<ResultRow>) -> Self {
        debug_assert!(results.iter().all(|r| r.iter < iterations),
            "ResultRow.iter must be < iterations (dense 0..iterations) for JUnit suite grouping");
        let mut totals = Totals { requests: results.len(), assertions: 0, passed: 0, failed: 0, errors: 0 };
        for r in &results {
            if r.error.is_some() {
                totals.errors += 1;
            }
            for a in &r.assertions {
                totals.assertions += 1;
                if a.pass { totals.passed += 1 } else { totals.failed += 1 }
            }
        }
        let ok = totals.failed == 0 && totals.errors == 0;
        RunReport { collection, identity, iterations, totals, results, ok }
    }
}

/// Default human-readable summary.
pub fn print_human(r: &RunReport) {
    println!("collection {} as {} — {} iteration(s)", r.collection, r.identity, r.iterations);
    for row in &r.results {
        match &row.error {
            Some(e) => println!("  [iter {}] {} ERROR: {}", row.iter, row.request, e),
            None => {
                println!("  [iter {}] {} → {} ({}ms)", row.iter, row.request, row.status, row.ms);
                for a in &row.assertions {
                    let mark = if a.pass { '\u{2713}' } else { '\u{2717}' };
                    println!("    {mark} {} (actual: {})", a.label, a.actual);
                }
            }
        }
    }
    let t = &r.totals;
    println!(
        "totals: {} requests, {} assertions, {} passed, {} failed, {} errors",
        t.requests, t.assertions, t.passed, t.failed, t.errors
    );
}

/// JUnit XML. Each emitted string is already redacted; here we sanitize invalid
/// XML chars then escape per context (all our dynamic text goes in attributes).
pub fn to_junit(r: &RunReport) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str(&format!(
        "<testsuites tests=\"{}\" failures=\"{}\" errors=\"{}\">\n",
        r.totals.assertions + r.totals.errors, r.totals.failed, r.totals.errors
    ));
    for iter in 0..r.iterations {
        let rows: Vec<&ResultRow> = r.results.iter().filter(|x| x.iter == iter).collect();
        let mut tests = 0usize;
        let mut failures = 0usize;
        let mut errors = 0usize;
        for row in &rows {
            if row.error.is_some() { tests += 1; errors += 1; }
            else { tests += row.assertions.len(); failures += row.assertions.iter().filter(|a| !a.pass).count(); }
        }
        let secs = rows.iter().map(|x| x.ms).sum::<u64>() as f64 / 1000.0;
        out.push_str(&format!(
            "  <testsuite name=\"iteration {}\" tests=\"{}\" failures=\"{}\" errors=\"{}\" skipped=\"0\" time=\"{:.3}\">\n",
            iter + 1, tests, failures, errors, secs
        ));
        for row in rows {
            let cls = attr(&row.request);
            if let Some(err) = &row.error {
                out.push_str(&format!(
                    "    <testcase classname=\"{}\" name=\"request\" time=\"0\"><error message=\"{}\"/></testcase>\n",
                    cls, attr(err)
                ));
            } else {
                for a in &row.assertions {
                    if a.pass {
                        out.push_str(&format!("    <testcase classname=\"{}\" name=\"{}\" time=\"0\"/>\n", cls, attr(&a.label)));
                    } else {
                        out.push_str(&format!(
                            "    <testcase classname=\"{}\" name=\"{}\" time=\"0\"><failure message=\"{}\"/></testcase>\n",
                            cls, attr(&a.label), attr(&a.actual)
                        ));
                    }
                }
            }
        }
        out.push_str("  </testsuite>\n");
    }
    out.push_str("</testsuites>\n");
    out
}

/// Replace characters not permitted in XML 1.0 (NUL/most C0 controls, U+FFFE/FFFF)
/// with the replacement char. Tab/newline/CR are allowed.
fn sanitize_xml(s: &str) -> String {
    // Rust `String` is valid UTF-8, so lone surrogates (U+D800–U+DFFF) cannot occur here;
    // we only need to strip the forbidden control chars and U+FFFE/U+FFFF.
    s.chars().map(|c| {
        let u = c as u32;
        if c == '\t' || c == '\n' || c == '\r' { c }
        else if u < 0x20 || u == 0xFFFE || u == 0xFFFF { '\u{FFFD}' }
        else { c }
    }).collect()
}

/// Escape for an XML attribute value (sanitize first). `&` must be replaced first.
fn attr(s: &str) -> String {
    sanitize_xml(s)
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Machine-readable report. The DTO derives `Serialize`; its fields ARE the
/// allowlist, and every string was redacted when the run loop built it.
pub fn to_json(r: &RunReport) -> serde_json::Value {
    serde_json::to_value(r).expect("RunReport serializes")
}

#[cfg(test)]
mod junit_tests {
    use super::*;

    fn sample() -> RunReport {
        RunReport::build("smoke".into(), "anon".into(), 1, vec![
            ResultRow { iter: 0, request: "ok".into(), status: 200, ms: 12, final_url: Some("https://x/ok".into()), error: None,
                assertions: vec![ AssertionRow { label: "status eq 200".into(), pass: true, actual: "200".into() } ] },
            ResultRow { iter: 0, request: "bad".into(), status: 200, ms: 8, final_url: Some("https://x/ok".into()), error: None,
                assertions: vec![ AssertionRow { label: "status eq 500".into(), pass: false, actual: "200".into() } ] },
            ResultRow { iter: 0, request: "boom".into(), status: 0, ms: 0, final_url: None, error: Some("dns failure".into()), assertions: vec![] },
        ])
    }

    #[test]
    fn junit_is_well_formed_and_structured() {
        let xml = to_junit(&sample());
        let doc = roxmltree::Document::parse(&xml).expect("well-formed XML");
        let suites: Vec<_> = doc.descendants().filter(|n| n.has_tag_name("testsuite")).collect();
        assert_eq!(suites.len(), 1);
        assert_eq!(suites[0].attribute("failures"), Some("1"));
        assert_eq!(suites[0].attribute("errors"), Some("1"));
        let cases: Vec<_> = doc.descendants().filter(|n| n.has_tag_name("testcase")).collect();
        assert_eq!(cases.len(), 3); // 2 assertions + 1 error case
        assert_eq!(doc.descendants().filter(|n| n.has_tag_name("failure")).count(), 1);
        assert_eq!(doc.descendants().filter(|n| n.has_tag_name("error")).count(), 1);
    }

    #[test]
    fn metachars_and_control_chars_are_safe() {
        let r = RunReport::build("c".into(), "i".into(), 1, vec![
            ResultRow { iter: 0, request: "r".into(), status: 200, ms: 1, final_url: None,
                error: Some("a<b>&\"'\u{0}\u{7}z".into()), assertions: vec![] },
        ]);
        let xml = to_junit(&r);
        roxmltree::Document::parse(&xml).expect("well-formed even with metachars/control chars");
        assert!(!xml.contains('\u{0}'), "NUL must be sanitized out");
        assert!(xml.contains("&lt;b&gt;"), "angle brackets escaped");
        assert!(xml.contains("&amp;"), "ampersand escaped to &amp;");
    }
}
