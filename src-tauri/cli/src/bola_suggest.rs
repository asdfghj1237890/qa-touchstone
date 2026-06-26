//! `bola-suggest` command: detect id locations in configured requests (read-only, no network).
//! Mirrors the TS GUI's suggest-then-confirm flow. Outputs ranked candidates + a paste-ready
//! security.bola.tests stub per request. Exit 0 normally; 2 on config load failure.
use qa_touchstone_core::{
    config::{load_config, IdLocation},
    engine::{qa_substitute, qa_var_map, RealDynamics},
    redact::RedactionSet,
    security::bola::{detect_id_location, DetectableRequest},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::process::ExitCode;

// ── CLI-adapter: build a DetectableRequest from a config Request + resolved var map ──

/// Parse the substituted absolute url into a DetectableRequest:
/// - url  = the PATHNAME only (so path{index} aligns with apply_id_location's indexing)
/// - params = inline-url ?query pairs MERGED with substituted structured query
/// - body  = substituted body string
fn build_detectable(
    req: &qa_touchstone_core::config::Request,
    var_map: &std::collections::BTreeMap<String, String>,
) -> DetectableRequest {
    // Substitute {{vars}} in url, query values, and body content.
    let resolved_url = qa_substitute(&req.url, var_map, &mut RealDynamics);
    let resolved_query: Vec<(String, String)> = req.query.iter()
        .map(|kv| (kv.key.clone(), qa_substitute(&kv.value, var_map, &mut RealDynamics)))
        .collect();
    let resolved_body: Option<String> = req.body.as_ref().map(|b| {
        qa_substitute(&b.content, var_map, &mut RealDynamics)
    });

    // Extract pathname from the absolute url (reqwest::Url::parse for authority urls;
    // fall back to treating the whole string as a path for templated/relative urls).
    let (pathname, inline_query_pairs) = if let Ok(url) = reqwest::Url::parse(&resolved_url) {
        let path = url.path().to_string();
        let pairs: Vec<(String, String)> = url.query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        (path, pairs)
    } else {
        // Unresolvable/relative url (e.g. "{{apiHost}}/orders/123" with apiHost unset) —
        // strip ?query manually; inline ?query params are skipped (documented limitation:
        // an unresolved templated url can't be parsed, so its inline query isn't extracted).
        // No `url` crate needed for this branch.
        let before_q = resolved_url.split('?').next().unwrap_or(&resolved_url).to_string();
        (before_q, Vec::new())
    };

    // Merge inline-url ?query pairs with structured query (structured takes precedence
    // on key collision — same as how the request is actually built by buildreq).
    let mut params: Vec<(String, String)> = inline_query_pairs;
    for (k, v) in resolved_query {
        // Deduplicate: if the same key is already present from the inline url, replace it.
        if let Some(pos) = params.iter().position(|(ik, _)| ik == &k) {
            params[pos].1 = v;
        } else {
            params.push((k, v));
        }
    }

    DetectableRequest {
        url: pathname,
        params,
        body: resolved_body,
    }
}

// ── Output structs ──

#[derive(Serialize)]
struct CandidateOut {
    #[serde(rename = "idLocation")] id_location: Value,
    value: String,
    confidence: String,
    why: String,
}

#[derive(Serialize)]
struct RequestOut {
    request: String,
    candidates: Vec<CandidateOut>,
    stub: Option<Value>,
    note: Option<String>,
}

fn id_location_to_json(loc: &IdLocation) -> Value {
    match loc {
        IdLocation::Path { index } => json!({ "kind": "path", "index": index }),
        IdLocation::Query { key }  => json!({ "kind": "query", "key": key }),
        IdLocation::Body { path }  => json!({ "kind": "body", "path": path }),
    }
}

fn id_location_human(loc: &IdLocation) -> String {
    match loc {
        IdLocation::Path { index } => format!("path[{}]", index),
        IdLocation::Query { key }  => format!("query[{}]", key),
        IdLocation::Body { path }  => format!("body.{}", path),
    }
}

pub async fn run(config_path: String, env: Option<String>, use_json: bool) -> ExitCode {
    // Load config (fail-closed on missing env vars).
    let text = match std::fs::read_to_string(&config_path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("error: cannot read config `{config_path}`: {e}");
            return ExitCode::from(2);
        }
    };
    let cfg = match load_config(&text, &|k| std::env::var(k).ok()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: invalid config: {e}");
            return ExitCode::from(2);
        }
    };
    if let Some(ref name) = env {
        if !cfg.environments.iter().any(|e| &e.name == name) {
            eprintln!("error: no environment named `{name}` in config");
            return ExitCode::from(2);
        }
    }

    // Build var map (global + env only — no collection context; documented limitation).
    let scoped = cfg.scoped_vars();
    let var_map = qa_var_map(&scoped, env.as_deref(), None, None);

    // Union redaction set: all identities' auth secrets (defense-in-depth).
    let red = RedactionSet::from_auths(cfg.identities.iter().map(|i| &i.auth));

    // Per-request: substitute → build DetectableRequest → detect → output.
    let mut results: Vec<RequestOut> = Vec::new();

    for req in &cfg.requests {
        let detectable = build_detectable(req, &var_map);
        let candidates = detect_id_location(&detectable);

        let candidates_out: Vec<CandidateOut> = candidates.iter().map(|c| CandidateOut {
            id_location: id_location_to_json(&c.id_location),
            value: red.redact_str(&c.value),
            confidence: c.confidence.clone(),
            why: red.redact_str(&c.why),
        }).collect();

        // Paste-ready stub for the top candidate (if any).
        let stub: Option<Value> = candidates.first().map(|top| {
            let id_values: serde_json::Map<String, Value> = cfg.identities.iter()
                .map(|i| (i.id.clone(), json!("")))
                .collect();
            json!({
                "id": format!("{}-bola", req.id),
                "request": req.id,
                "idLocation": id_location_to_json(&top.id_location),
                "idValues": id_values,
                "negativeControl": true,
            })
        });

        let note: Option<String> = if candidates.is_empty() {
            Some("no id-shaped value detected in this request".into())
        } else {
            None
        };

        results.push(RequestOut {
            request: req.id.clone(),
            candidates: candidates_out,
            stub,
            note,
        });
    }

    // Output: JSON or human-readable.
    if use_json {
        println!("{}", red.redact_str(&serde_json::to_string(&results).unwrap()));
    } else {
        for r in &results {
            println!("request: {}", r.request);
            if let Some(note) = &r.note {
                println!("  note: {}", note);
            } else {
                for (i, c) in r.candidates.iter().enumerate() {
                    let loc_json: IdLocation = serde_json::from_value(c.id_location.clone()).unwrap();
                    println!("  [{}] {} = {:?}  confidence:{} ({})",
                        i + 1,
                        red.redact_str(&id_location_human(&loc_json)),
                        c.value,
                        c.confidence,
                        c.why,
                    );
                }
                if let Some(stub) = &r.stub {
                    println!("  stub: {}", red.redact_str(&serde_json::to_string_pretty(stub).unwrap()));
                }
            }
            println!();
        }
    }

    ExitCode::SUCCESS
}

// ── Unit tests (no network; no config file I/O) ──
#[cfg(test)]
mod tests {
    use super::*;
    use qa_touchstone_core::config::{Body, BodyMode, Kv, Request};
    use std::collections::BTreeMap;

    fn mk_req(id: &str, url: &str, query: Vec<Kv>, body: Option<&str>) -> Request {
        Request {
            id: id.into(), method: "GET".into(), url: url.into(),
            headers: vec![], query,
            body: body.map(|c| Body { mode: BodyMode::Json, content: c.into() }),
            assertions: vec![], privileged: None,
        }
    }

    #[test]
    fn adapter_absolute_url_pathname_alignment() {
        // THE KEY CORRECTNESS TEST (spec Blocker):
        // absolute url "https://api.test/orders/123" → pathname "/orders/123"
        // → detect → top candidate path{index:1}
        // → apply_id_location(absolute-url req, path{index:1}, value) succeeds.
        let req = mk_req("getOrder", "https://api.test/orders/123", vec![], None);
        let map: BTreeMap<String, String> = BTreeMap::new();
        let det = build_detectable(&req, &map);
        assert_eq!(det.url, "/orders/123", "adapter must extract pathname");

        let cands = detect_id_location(&det);
        assert!(!cands.is_empty(), "must detect a candidate");
        let top = &cands[0];
        match &top.id_location {
            qa_touchstone_core::config::IdLocation::Path { index } =>
                assert_eq!(*index, 1, "path index must be 1 (second segment of /orders/123)"),
            other => panic!("expected path candidate, got {:?}", other),
        }

        // Confirm apply_id_location accepts this index (the round-trip correctness check).
        let applied = qa_touchstone_core::security::bola::apply_id_location(
            &req, &top.id_location, &serde_json::json!("999")
        );
        assert!(applied.is_ok(), "apply_id_location must succeed for the detected path index");
        assert!(applied.unwrap().url.contains("/orders/999"), "id must be substituted at index 1");
    }

    #[test]
    fn adapter_inline_url_query_merged() {
        // Inline url ?query is extracted and merged with structured query.
        let req = mk_req("search", "https://api.test/search?user_id=7", vec![], None);
        let map: BTreeMap<String, String> = BTreeMap::new();
        let det = build_detectable(&req, &map);
        assert_eq!(det.url, "/search");
        assert!(det.params.iter().any(|(k, v)| k == "user_id" && v == "7"),
            "inline ?user_id=7 must appear in params");
        let cands = detect_id_location(&det);
        assert!(!cands.is_empty());
        match &cands[0].id_location {
            qa_touchstone_core::config::IdLocation::Query { key } =>
                assert_eq!(key, "user_id"),
            other => panic!("expected query candidate, got {:?}", other),
        }
    }

    #[test]
    fn adapter_body_id_field() {
        let req = mk_req("create", "https://api.test/items", vec![],
            Some(r#"{"userId":"550e8400-e29b-41d4-a716-446655440000"}"#));
        let map: BTreeMap<String, String> = BTreeMap::new();
        let det = build_detectable(&req, &map);
        let cands = detect_id_location(&det);
        assert!(!cands.is_empty());
        // body uuid → score 72 → "medium" (72 < 75 threshold)
        assert_eq!(cands[0].confidence, "medium",
            "body uuid → score 72 → medium (< 75 threshold)");
        match &cands[0].id_location {
            qa_touchstone_core::config::IdLocation::Body { path } =>
                assert_eq!(path, "userId"),
            other => panic!("expected body candidate, got {:?}", other),
        }
    }
}
