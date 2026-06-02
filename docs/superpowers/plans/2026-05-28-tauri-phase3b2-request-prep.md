# Tauri 遷移 — 階段 3b-2：請求準備純函式 + STS XML 解析（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `executePostmanRequest` 會用到的**純函式、可單元測試**邏輯先移植並測好：參數代入（URL 與 body，含引號感知與 JSON 型別保留）、移除 JSON 註解、環境覆寫 URL 重組（**修 bug #8**：只剝除已知的環境 base path、不剝任意第一段），以及 STS AssumeRole 回應的 XML 解析。**本階段不接 command、不打網路、不動前端**；網路組裝（reqwest + assume_role + execute_postman_request + 前端 + bug #7）留待階段 3b-3。

**Architecture:** 新增 `src-tauri/src/reqprep.rs`（請求準備純函式），並在既有 `src-tauri/src/aws.rs` 加 `parse_sts_xml`。兩者皆無 IO、無網路，完整單元測試。對齊 Electron `substituteParams`(electron.js:2075-2268)、`removeJsonComments`(:1882-1907)、execute 內的環境覆寫區塊(:2304-2349) 與 `assumeRole` 的 XML 解析(:78-92)。延續使用者確認「只用 Postman collection」：`substituteParams` 內的 OpenAPI schema 型別查詢（`getFieldTypeFromSchema`/`convertValueByType`）**不移植**（Postman 請求不會走到，恆為 None → 走型別保留 fallback）。

**Tech Stack:** Rust（serde_json、regex；皆已是相依）。

**為何再拆：** `substituteParams` 的 body 代入（引號感知 + JSON 型別保留）、bug #8 的 URL 重組、STS XML 解析，都是**容易出細節錯且可被單元測試釘死**的純邏輯；而簽章後的真實送出無法在本機驗證。先把純邏輯測好，3b-3 的網路組裝就只剩薄薄一層 + 實機驗證。

**逐字保留的契約：**
- `remove_json_comments`：移除 `//` 與 `/* */`（字串內的不動）、移除 `}`/`]` 前的尾逗號。
- `substitute_url(target, params)`：把 `{{key}}`/`{key}`（容許前後空白）換成 `params[key]`。
- `substitute_body(body, params)`：先做引號感知的模板代入（字串內→原值；字串外且純數字→裸值；否則→加引號），再 JSON 走訪把「欄位名等於 param 名」的值依原型別保留替換、處理 `example_` 佔位；回傳替換後的 body 字串。
- `rebase_url(raw_url, env_base_url, env_base_path, known_base_paths)`：把 `https?://host[/path?query]` 重組為 `env_base_url + env_base_path + endpoint + ?query`；endpoint 為「剝掉**已知** base path 後」的路徑（非任意第一段）。相對 URL（無 scheme）原樣回傳。
- `parse_sts_xml(xml)`：以 regex 取 `<AccessKeyId>`/`<SecretAccessKey>`/`<SessionToken>`；三者齊備回 `Some(Credentials)`，否則 `None`。

---

## File Structure

**新增（Rust）**
- `src-tauri/src/reqprep.rs` — `remove_json_comments`、`substitute_url`、`substitute_body`、`rebase_url`、`KNOWN_ENV_BASE_PATHS` + 測試

**修改（Rust）**
- `src-tauri/src/aws.rs` — 加 `parse_sts_xml` + 測試
- `src-tauri/src/lib.rs` — 宣告 `mod reqprep;`

**不動：** 前端、command、capabilities。

---

## Task 1: `reqprep.rs`（請求準備純函式 + 測試）

**Files:** Create `src-tauri/src/reqprep.rs`; Modify `src-tauri/src/lib.rs`

- [ ] **Step 1: 建立 `src-tauri/src/reqprep.rs`**

```rust
//! 請求準備純函式：JSON 註解移除、參數代入、環境覆寫 URL 重組。
//! 消費者為階段 3b-3 的 execute_postman_request。對齊 Electron substituteParams /
//! removeJsonComments / 環境覆寫區塊。Postman-only：不移植 OpenAPI schema 型別查詢。
#![allow(dead_code)]

use regex::Regex;
use serde_json::{Map, Value};

/// 已知的環境 base path（由環境設定提供；用於 rebase_url 只剝除「已知」
/// base path——修正 bug #8 的「剝任意第一段」）。
pub const KNOWN_ENV_BASE_PATHS: &[&str] = &[
    "/staging",
    "/production",
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
    // 單行： ("...")  |  //...    → 保留字串、移除註解
    let line_re = Regex::new(r#"("(?:[^"\\]|\\.)*")|//[^\n]*"#).unwrap();
    let step1 = line_re.replace_all(s, |c: &regex::Captures| {
        c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default()
    });
    // 多行： ("...") | /* ... */
    let block_re = Regex::new(r#"("(?:[^"\\]|\\.)*")|/\*[\s\S]*?\*/"#).unwrap();
    let step2 = block_re.replace_all(&step1, |c: &regex::Captures| {
        c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default()
    });
    // 尾逗號： ,(\s*[}\]]) → $1
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

/// 引號感知替換：在 body 內把 pattern 換成 value。字串內→原值；字串外且數字→裸值；否則→加引號。
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

/// body 代入：先引號感知模板代入，再 JSON 欄位名比對型別保留替換。對齊 Electron substituteParams 的 body 分支。
pub fn substitute_body(body: &str, params: &Map<String, Value>) -> String {
    let mut temp = body.to_string();

    // 1) 引號感知模板代入（double 後 single）
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

    // 2) JSON 走訪：欄位名 == param 名 → 依原型別保留替換；example_ 佔位處理
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

fn param_str<'a>(params: &'a Map<String, Value>, key: &str) -> Option<String> {
    params.get(key).filter(|v| !v.is_null()).map(value_to_plain)
}

/// 依「原值型別」把字串 param 轉成保留型別的 Value（對齊 Electron 的 fallback：無 schema）。
fn coerce_like(original: &Value, raw: &str) -> Value {
    match original {
        Value::Number(_) => raw.parse::<i64>().map(|n| Value::from(n))
            .or_else(|_| raw.parse::<f64>().map(|n| Value::from(n)))
            .unwrap_or_else(|_| Value::String(raw.to_string())),
        Value::Bool(_) => match raw {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            "1" => Value::Bool(true),
            "0" => Value::Bool(false),
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
            // 直接欄位名比對
            if let Some(raw) = param_str(params, &k) {
                let original = map.get(&k).cloned().unwrap_or(Value::Null);
                map.insert(k.clone(), coerce_like(&original, &raw));
                *modified = true;
                continue;
            }
            // example_ 佔位（無 schema → 依 pattern 推型別）
            let example_param: Option<(String, String)> = match map.get(&k) {
                Some(Value::String(s)) if s.starts_with("example_") => {
                    let pname = s.trim_start_matches("example_").to_string();
                    param_str(params, &pname).map(|raw| (s.clone(), raw))
                }
                _ => None,
            };
            if let Some((example_value, raw)) = example_param {
                let num_re = Regex::new(r"^example_\d+$").unwrap();
                let bool_re = Regex::new(r"^example_(true|false)$").unwrap();
                let new_val = if num_re.is_match(&example_value) {
                    raw.parse::<i64>().map(Value::from)
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
            // 遞迴
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
        None => return raw_url.to_string(), // 相對 URL：無法重組，原樣回傳
    };
    let path_and_query = caps.get(2).map(|m| m.as_str()).unwrap_or("/");
    let (pathname, search) = match path_and_query.split_once('?') {
        Some((p, q)) => (p.to_string(), Some(q.to_string())),
        None => (path_and_query.to_string(), None),
    };
    // 正規化雙斜線
    let mut endpoint = Regex::new(r"/+").unwrap().replace_all(&pathname, "/").to_string();
    // 只剝除「已知」base path（bug #8 修正）
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
        assert!(out.contains("http://x//y")); // 字串內的 // 不動
        assert!(serde_json::from_str::<Value>(&out).is_ok()); // 尾逗號已移除 → 合法 JSON
    }

    #[test]
    fn substitute_url_double_and_single() {
        let p = params(&[("id", json!("ABC")), ("n", json!(5))]);
        assert_eq!(substitute_url("/d/{{id}}/x/{n}", &p), "/d/ABC/x/5");
        assert_eq!(substitute_url("/d/{{ id }}", &p), "/d/ABC"); // 容許空白
    }

    #[test]
    fn substitute_body_quote_aware() {
        let p = params(&[("name", json!("bob")), ("count", json!("3"))]);
        // name 在字串內 → 原值；count 在字串外且數字 → 裸值
        let body = "{\"name\": \"{{name}}\", \"count\": {{count}}}";
        let out = substitute_body(body, &p);
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["name"], "bob");
        assert_eq!(v["count"], 3); // 數字（非字串）
    }

    #[test]
    fn substitute_body_field_name_type_preserve() {
        // 欄位名等於 param 名：原值是數字 → 保留數字型別
        let p = params(&[("port", json!("8080"))]);
        let body = "{\"port\": 1}";
        let out = substitute_body(body, &p);
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["port"], 8080);
        assert!(v["port"].is_number());
    }

    #[test]
    fn rebase_strips_only_known_base_path() {
        let known = KNOWN_ENV_BASE_PATHS;
        // 原 URL 含已知 base path → 剝除後套新環境
        let r = rebase_url(
            "https://orig.execute-api.us-east-1.amazonaws.com/hyperion-gamma/devices/{id}",
            "https://new.execute-api.us-east-1.amazonaws.com",
            "/hyperion-prod",
            known,
        );
        assert_eq!(r, "https://new.execute-api.us-east-1.amazonaws.com/hyperion-prod/devices/{id}");
    }

    #[test]
    fn rebase_does_not_strip_unknown_first_segment() {
        // bug #8 修正：第一段不是已知 base path → 不剝
        let known = KNOWN_ENV_BASE_PATHS;
        let r = rebase_url(
            "https://orig.example.com/devices/123",
            "https://new.example.com",
            "/hyperion-prod",
            known,
        );
        assert_eq!(r, "https://new.example.com/hyperion-prod/devices/123");
    }

    #[test]
    fn rebase_preserves_query_and_ignores_relative() {
        let known = KNOWN_ENV_BASE_PATHS;
        let r = rebase_url("https://h.com/ffs-gamma/x?a=1", "https://n.com", "/ffs-prod", known);
        assert_eq!(r, "https://n.com/ffs-prod/x?a=1");
        // 相對 URL 原樣回傳
        assert_eq!(rebase_url("/relative/path", "https://n.com", "/p", known), "/relative/path");
    }
}
```

- [ ] **Step 2: 在 lib.rs 宣告 `mod reqprep;`**

- [ ] **Step 3: 跑測試** — Run: `cd src-tauri && cargo test reqprep`（新 shell 先 `export PATH="$USERPROFILE/.cargo/bin:$PATH"`）；Expected: 7 個測試 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/reqprep.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): request-prep helpers (substitute/strip-comments/rebase-url, fix bug #8)"
```

---

## Task 2: `aws.rs` 加 `parse_sts_xml`（AssumeRole 回應解析）

**Files:** Modify `src-tauri/src/aws.rs`

- [ ] **Step 1: 在 `aws.rs` 加入 `parse_sts_xml` 與測試**

於 `aws.rs`（`sign` 之後、tests 之前）加入：
```rust
/// 解析 STS AssumeRole 的 XML 回應（對齊 Electron 的三個 regex）。
/// 三者齊備才回 Some(Credentials)（帶 session_token）。
pub fn parse_sts_xml(xml: &str) -> Option<Credentials> {
    use regex::Regex;
    let pick = |tag: &str| -> Option<String> {
        let re = Regex::new(&format!(r"<{tag}>([^<]+)</{tag}>")).ok()?;
        re.captures(xml).map(|c| c[1].to_string())
    };
    let access = pick("AccessKeyId")?;
    let secret = pick("SecretAccessKey")?;
    let token = pick("SessionToken")?;
    Some(Credentials {
        access_key_id: access,
        secret_access_key: secret,
        session_token: Some(token),
    })
}
```

在 `aws.rs` 的 `#[cfg(test)] mod tests` 內新增：
```rust
    #[test]
    fn parse_sts_xml_extracts_temp_credentials() {
        let xml = "<AssumeRoleResponse><AssumeRoleResult><Credentials>\
<AccessKeyId>ASIA_TEMP</AccessKeyId><SecretAccessKey>SECRET_TEMP</SecretAccessKey>\
<SessionToken>TOKEN_TEMP</SessionToken><Expiration>2026-01-01T00:00:00Z</Expiration>\
</Credentials></AssumeRoleResult></AssumeRoleResponse>";
        let c = parse_sts_xml(xml).expect("parsed");
        assert_eq!(c.access_key_id, "ASIA_TEMP");
        assert_eq!(c.secret_access_key, "SECRET_TEMP");
        assert_eq!(c.session_token.as_deref(), Some("TOKEN_TEMP"));
    }

    #[test]
    fn parse_sts_xml_returns_none_when_incomplete() {
        let xml = "<Credentials><AccessKeyId>X</AccessKeyId></Credentials>";
        assert!(parse_sts_xml(xml).is_none());
    }
```

- [ ] **Step 2: 跑測試** — Run: `cd src-tauri && cargo test aws`；Expected: 既有 5 + 新 2 共 7 個 PASS。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/aws.rs
git commit -m "feat(tauri): parse STS AssumeRole XML response"
```

---

## Task 3: 驗證 + 收尾

**Files:** 無

- [ ] **Step 1: 後端全測試** — Run: `cd src-tauri && cargo test`；Expected: 既有 44 + reqprep 7 + aws 新 2 共 53 全綠。
- [ ] **Step 2: 編譯** — Run: `cd src-tauri && cargo build`；Expected: 無錯；警告只剩既有 `AppError::NotFound`。
- [ ] **Step 3: 確認 diff 為 Rust-only**（不動前端）— `git diff --name-only master..HEAD` 應只含 src-tauri。前端 vitest 因此不受影響（基準 693）。
- [ ] **Step 4: 最終 code review + finishing-a-development-branch。**

---

## 階段 3b-2 完成定義

- [ ] `remove_json_comments`、`substitute_url`、`substitute_body`（引號感知 + JSON 型別保留）、`rebase_url`（bug #8 只剝已知 base path）、`parse_sts_xml` 全數測試綠
- [ ] `cargo test` 全綠、`cargo build` 乾淨；diff 為 Rust-only（前端無回歸）
- [ ] 無 command/前端變更（純函式，消費者為 3b-3）

---

## Self-Review 紀錄

- **Spec 覆蓋**：對齊 Electron substituteParams（URL + body 引號感知 + JSON 型別保留）、removeJsonComments、環境覆寫 URL 重組（修 spec §7 bug #8：只剝已知 base path）、assumeRole 的 XML 解析。OpenAPI schema 型別查詢（getFieldTypeFromSchema/convertValueByType）不移植——Postman-only，恆走型別保留 fallback。
- **拆分理由**：這些是最易出細節錯且可被單元測試釘死的純邏輯；網路送出無法本機驗證，故先測純邏輯，3b-3 只剩薄組裝 + 實機驗證。
- **bug #8 修正**：`rebase_url` 以 `KNOWN_ENV_BASE_PATHS`（鏡像前端 ENVIRONMENTS）只剝已知 base path；未知第一段不剝（測試 `rebase_does_not_strip_unknown_first_segment` 釘住）。常數需與前端 ENVIRONMENTS 同步（已註記）。
- **Placeholder 掃描**：無 TBD/TODO；每步有完整程式碼與預期輸出。
- **型別一致性**：`parse_sts_xml` 回傳既有 `aws::Credentials`（帶 session_token）；`reqprep` 函式皆 `pub`、`#![allow(dead_code)]`（消費者 3b-3）；regex/serde_json 已是相依。
