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
