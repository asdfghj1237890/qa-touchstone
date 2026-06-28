//! Port of engine.ts `qaParseDataFile` (lines 195-227) + JS `String()` coercion.
//! The golden fixtures in `tests/fixtures/datafile.json` and `tests/fixtures/coercion.json`
//! are generated from the real TS engine and are the source of truth — Rust must match them.

use serde::Serialize;
use serde_json::{Map, Value};

/// Mirror of the TS `qaParseDataFile` return type.
#[derive(Debug, Serialize)]
pub struct DataFile {
    pub rows: Option<Vec<Map<String, Value>>>,
    pub columns: Vec<String>,
    pub error: String,
    pub format: Option<String>,
}

/// Port of engine.ts:195-227 `qaParseDataFile`.
/// `filename` is used to detect JSON (`.json` extension, or text starts with `[`/`{`).
pub fn parse_data_file(text: &str, filename: Option<&str>) -> DataFile {
    let t = text.trim();
    if t.is_empty() {
        return DataFile {
            rows: None,
            columns: vec![],
            error: String::new(),
            format: None,
        };
    }

    let is_json = filename.unwrap_or("").to_lowercase().ends_with(".json")
        || t.starts_with('[')
        || t.starts_with('{');

    if is_json {
        match serde_json::from_str::<Value>(t) {
            Ok(d) => {
                let arr: Vec<Value> = if d.is_array() {
                    d.as_array().unwrap().clone()
                } else {
                    vec![d]
                };
                if arr.is_empty() {
                    return DataFile {
                        rows: None,
                        columns: vec![],
                        error: "Empty JSON array".to_string(),
                        format: Some("json".to_string()),
                    };
                }
                // ordered union of keys (first-seen order, matching JS Set + flatMap)
                let mut cols: Vec<String> = vec![];
                let mut seen = std::collections::HashSet::new();
                for item in &arr {
                    if let Some(obj) = item.as_object() {
                        for k in obj.keys() {
                            if seen.insert(k.clone()) {
                                cols.push(k.clone());
                            }
                        }
                    }
                }
                let rows: Vec<Map<String, Value>> = arr
                    .into_iter()
                    .filter_map(|v| {
                        if let Value::Object(m) = v {
                            Some(m)
                        } else {
                            None
                        }
                    })
                    .collect();
                DataFile {
                    rows: Some(rows),
                    columns: cols,
                    error: String::new(),
                    format: Some("json".to_string()),
                }
            }
            Err(_) => DataFile {
                rows: None,
                columns: vec![],
                error: "Invalid JSON".to_string(),
                format: Some("json".to_string()),
            },
        }
    } else {
        // CSV: split on \r?\n, drop empty lines
        let lines: Vec<&str> = t
            .split('\n')
            .map(|l| l.trim_end_matches('\r'))
            .filter(|l| !l.is_empty())
            .collect();
        if lines.len() < 2 {
            return DataFile {
                rows: None,
                columns: vec![],
                error: "CSV needs a header row + at least one data row".to_string(),
                format: Some("csv".to_string()),
            };
        }
        let cols: Vec<String> = parse_csv_line(lines[0])
            .into_iter()
            .map(|c| c.trim().to_string())
            .collect();
        let rows: Vec<Map<String, Value>> = lines[1..]
            .iter()
            .map(|line| {
                let vals = parse_csv_line(line);
                let mut obj = Map::new();
                for (i, col) in cols.iter().enumerate() {
                    let val = vals
                        .get(i)
                        .map(|v| v.trim().to_string())
                        .unwrap_or_default();
                    obj.insert(col.clone(), Value::String(val));
                }
                obj
            })
            .collect();
        DataFile {
            rows: Some(rows),
            columns: cols,
            error: String::new(),
            format: Some("csv".to_string()),
        }
    }
}

/// Port of engine.ts `parseLine` (lines 211-219).
/// Handles `"`-quoted fields, embedded commas, and `""`→`"` escapes.
fn parse_csv_line(line: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    let mut cur = String::new();
    let mut q = false;
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if q {
            if c == '"' && chars.get(i + 1) == Some(&'"') {
                cur.push('"');
                i += 1;
            } else if c == '"' {
                q = false;
            } else {
                cur.push(c);
            }
        } else if c == '"' {
            q = true;
        } else if c == ',' {
            out.push(cur.clone());
            cur.clear();
        } else {
            cur.push(c);
        }
        i += 1;
    }
    out.push(cur);
    out
}

/// Mirror of JS `String(v)` for JSON value types.
/// - String → clone the string value
/// - Null   → `"null"`
/// - Bool   → `"true"` / `"false"`
/// - Number → its JS string representation
/// - Array  → elements `js_string`-joined by `,`
/// - Object → `"[object Object]"`
pub fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".to_string(),
        Value::Bool(b) => {
            if *b {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        Value::Number(n) => n.to_string(),
        Value::Array(arr) => arr.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}
