//! 請求準備純函式：JSON 註解移除、參數代入、環境覆寫 URL 重組。
//! 消費者為階段 3b-3 的 execute_postman_request。對齊 Electron substituteParams /
//! removeJsonComments / 環境覆寫區塊。Postman-only：不移植 OpenAPI schema 型別查詢。
#![allow(dead_code)]

use regex::Regex;
use serde_json::{Map, Value};

/// Legacy/test base paths used by rebase_url tests. Runtime environments pass their own
/// knownBasePaths so external presets do not inherit default path-stripping behavior.
pub(crate) const KNOWN_ENV_BASE_PATHS: &[&str] = &[
    "/legacy-alpha",
    "/legacy-prod",
    "/api-alpha",
    "/api-prod",
    "/operations-alpha",
];

/// 把 serde_json 值轉成「裸字串」（字串去引號；其他用其 JSON 文字）。
fn value_to_plain(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// 移除 JSON 註解（字串內的不動）+ 尾逗號。對齊 Electron removeJsonComments。
pub fn remove_json_comments(s: &str) -> String {
    let line_re = Regex::new(r#"("(?:[^"\\]|\\.)*")|//[^\n]*"#).unwrap();
    let step1 = line_re.replace_all(s, |c: &regex::Captures| {
        c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default()
    });
    let block_re = Regex::new(r#"("(?:[^"\\]|\\.)*")|/\*[\s\S]*?\*/"#).unwrap();
    let step2 = block_re.replace_all(&step1, |c: &regex::Captures| {
        c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default()
    });
    let trailing_re = Regex::new(r"(,)(\s*[}\]])").unwrap();
    trailing_re.replace_all(&step2, "$2").to_string()
}

fn brace_patterns(key: &str) -> (Regex, Regex) {
    let esc = regex::escape(key);
    let double = Regex::new(&["\\{\\{\\s*", &esc, "\\s*\\}\\}"].concat()).unwrap();
    let single = Regex::new(&["\\{\\s*", &esc, "\\s*\\}"].concat()).unwrap();
    (double, single)
}

/// URL/target 代入：{{key}}/{key} → params[key]（無引號處理）。
pub fn substitute_url(target: &str, params: &Map<String, Value>) -> String {
    let mut result = target.to_string();
    for (key, val) in params {
        if val.is_null() {
            continue;
        }
        let v = value_to_plain(val);
        let (double, single) = brace_patterns(key);
        result = double.replace_all(&result, v.as_str()).to_string();
        result = single.replace_all(&result, v.as_str()).to_string();
    }
    result
}

/// 引號感知替換：字串內→原值；字串外且數字→裸值；否則→加引號。
fn replace_quote_aware(body: &str, pattern: &Regex, value: &str, is_numeric: bool) -> String {
    let mut out = String::new();
    let mut last = 0;
    for m in pattern.find_iter(body) {
        out.push_str(&body[last..m.start()]);
        let quotes_before = body[..m.start()].matches('"').count();
        let inside = quotes_before % 2 == 1;
        if inside || is_numeric {
            out.push_str(value);
        } else {
            out.push('"');
            out.push_str(value);
            out.push('"');
        }
        last = m.end();
    }
    out.push_str(&body[last..]);
    out
}

/// body 代入：先引號感知模板代入，再 JSON 欄位名比對型別保留替換。對齊 Electron substituteParams body 分支。
pub fn substitute_body(body: &str, params: &Map<String, Value>) -> String {
    let mut temp = body.to_string();

    for (key, val) in params {
        if val.is_null() {
            continue;
        }
        let v = value_to_plain(val);
        let is_numeric = !v.is_empty() && v.chars().all(|c| c.is_ascii_digit());
        let (double, single) = brace_patterns(key);
        temp = replace_quote_aware(&temp, &double, &v, is_numeric);
        temp = replace_quote_aware(&temp, &single, &v, is_numeric);
    }

    if let Ok(mut obj) = serde_json::from_str::<Value>(&temp) {
        let mut modified = false;
        replace_in_json(&mut obj, params, &mut modified);
        if modified {
            if let Ok(s) = serde_json::to_string_pretty(&obj) {
                temp = s;
            }
        }
    }
    temp
}

fn param_str(params: &Map<String, Value>, key: &str) -> Option<String> {
    params.get(key).filter(|v| !v.is_null()).map(value_to_plain)
}

/// 依「原值型別」把字串 param 轉成保留型別的 Value（對齊 Electron 無 schema 的 fallback）。
fn coerce_like(original: &Value, raw: &str) -> Value {
    match original {
        Value::Number(_) => raw
            .parse::<i64>()
            .map(Value::from)
            .or_else(|_| raw.parse::<f64>().map(Value::from))
            .unwrap_or_else(|_| Value::String(raw.to_string())),
        Value::Bool(_) => match raw {
            "true" | "1" => Value::Bool(true),
            "false" | "0" => Value::Bool(false),
            other => Value::Bool(!other.is_empty()),
        },
        _ => match raw {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            _ => Value::String(raw.to_string()),
        },
    }
}

fn replace_in_json(value: &mut Value, params: &Map<String, Value>, modified: &mut bool) {
    if let Value::Object(map) = value {
        let keys: Vec<String> = map.keys().cloned().collect();
        for k in keys {
            if let Some(raw) = param_str(params, &k) {
                let original = map.get(&k).cloned().unwrap_or(Value::Null);
                map.insert(k.clone(), coerce_like(&original, &raw));
                *modified = true;
                continue;
            }
            let example_param: Option<(String, String)> = match map.get(&k) {
                Some(Value::String(s)) if s.starts_with("example_") => {
                    let pname = s.strip_prefix("example_").unwrap_or(s).to_string();
                    param_str(params, &pname).map(|raw| (s.clone(), raw))
                }
                _ => None,
            };
            if let Some((example_value, raw)) = example_param {
                let num_re = Regex::new(r"^example_\d+$").unwrap();
                let bool_re = Regex::new(r"^example_(true|false)$").unwrap();
                let new_val = if num_re.is_match(&example_value) {
                    raw.parse::<i64>()
                        .map(Value::from)
                        .or_else(|_| raw.parse::<f64>().map(Value::from))
                        .unwrap_or_else(|_| Value::String(raw.clone()))
                } else if bool_re.is_match(&example_value) {
                    coerce_like(&Value::Bool(false), &raw)
                } else if raw == "true" || raw == "false" {
                    Value::Bool(raw == "true")
                } else {
                    Value::String(raw.clone())
                };
                map.insert(k.clone(), new_val);
                *modified = true;
                continue;
            }
            if let Some(child) = map.get_mut(&k) {
                if child.is_object() || child.is_array() {
                    replace_in_json(child, params, modified);
                }
            }
        }
    } else if let Value::Array(arr) = value {
        for item in arr.iter_mut() {
            replace_in_json(item, params, modified);
        }
    }
}

/// 環境覆寫 URL 重組（修 bug #8：只剝除「已知」base path）。
pub fn rebase_url(raw_url: &str, env_base_url: &str, env_base_path: &str, known_base_paths: &[&str]) -> String {
    let re = Regex::new(r"^(https?://[^/]+)(/.*)?$").unwrap();
    let caps = match re.captures(raw_url) {
        Some(c) => c,
        None => return raw_url.to_string(), // 相對 URL：無法重組
    };
    let path_and_query = caps.get(2).map(|m| m.as_str()).unwrap_or("/");
    let (pathname, search) = match path_and_query.split_once('?') {
        Some((p, q)) => (p.to_string(), Some(q.to_string())),
        None => (path_and_query.to_string(), None),
    };
    let mut endpoint = Regex::new(r"/+").unwrap().replace_all(&pathname, "/").to_string();
    for bp in known_base_paths {
        if endpoint == *bp || endpoint.starts_with(&format!("{bp}/")) {
            endpoint = endpoint[bp.len()..].to_string();
            if !endpoint.starts_with('/') {
                endpoint = format!("/{endpoint}");
            }
            break;
        }
    }
    match search {
        Some(q) => format!("{env_base_url}{env_base_path}{endpoint}?{q}"),
        None => format!("{env_base_url}{env_base_path}{endpoint}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    #[test]
    fn remove_comments_keeps_strings() {
        let src = "{\n  \"a\": 1, // comment\n  \"b\": \"http://x//y\", /* blk */\n}";
        let out = remove_json_comments(src);
        assert!(!out.contains("// comment"));
        assert!(!out.contains("/* blk */"));
        assert!(out.contains("http://x//y"));
        assert!(serde_json::from_str::<Value>(&out).is_ok());
    }

    #[test]
    fn substitute_url_double_and_single() {
        let p = params(&[("id", json!("ABC")), ("n", json!(5))]);
        assert_eq!(substitute_url("/d/{{id}}/x/{n}", &p), "/d/ABC/x/5");
        assert_eq!(substitute_url("/d/{{ id }}", &p), "/d/ABC");
    }

    #[test]
    fn substitute_body_quote_aware() {
        let p = params(&[("name", json!("bob")), ("count", json!("3"))]);
        let body = "{\"name\": \"{{name}}\", \"count\": {{count}}}";
        let out = substitute_body(body, &p);
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["name"], "bob");
        assert_eq!(v["count"], 3);
    }

    #[test]
    fn substitute_body_field_name_type_preserve() {
        let p = params(&[("port", json!("8080"))]);
        let body = "{\"port\": 1}";
        let out = substitute_body(body, &p);
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["port"], 8080);
        assert!(v["port"].is_number());
    }

    #[test]
    fn rebase_strips_only_known_base_path() {
        let r = rebase_url(
            "https://orig.execute-api.us-east-1.amazonaws.com/legacy-alpha/devices/{id}",
            "https://new.execute-api.us-east-1.amazonaws.com",
            "/legacy-prod",
            KNOWN_ENV_BASE_PATHS,
        );
        assert_eq!(r, "https://new.execute-api.us-east-1.amazonaws.com/legacy-prod/devices/{id}");
    }

    #[test]
    fn rebase_does_not_strip_unknown_first_segment() {
        let r = rebase_url(
            "https://orig.example.com/devices/123",
            "https://new.example.com",
            "/legacy-prod",
            KNOWN_ENV_BASE_PATHS,
        );
        assert_eq!(r, "https://new.example.com/legacy-prod/devices/123");
    }

    #[test]
    fn rebase_preserves_query_and_ignores_relative() {
        let r = rebase_url("https://h.com/api-alpha/x?a=1", "https://n.com", "/api-prod", KNOWN_ENV_BASE_PATHS);
        assert_eq!(r, "https://n.com/api-prod/x?a=1");
        assert_eq!(rebase_url("/relative/path", "https://n.com", "/p", KNOWN_ENV_BASE_PATHS), "/relative/path");
    }

    #[test]
    fn rebase_url_keeps_generic_path_when_no_known_paths() {
        let r = rebase_url(
            "https://old.example.com/v1/devices?id=1",
            "https://new.example.com",
            "",
            &[],
        );
        assert_eq!(r, "https://new.example.com/v1/devices?id=1");
    }
}
