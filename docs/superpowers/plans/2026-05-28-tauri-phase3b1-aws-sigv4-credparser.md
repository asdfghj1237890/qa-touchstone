# Tauri 遷移 — 階段 3b-1：AWS SigV4 簽章 + 憑證檔解析（基礎，Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Rust 實作兩個**純函式、可單元測試**的 AWS 認證基礎：(1) AWS Signature V4 簽章（對齊 Electron 用的 `aws4` 函式庫，並以 AWS 官方測試向量驗證）；(2) 憑證檔解析 `parse_credential_file_content`（ini / json / csv / regex / 位置 fallback，從階段 1b 延後至此）。這兩者是階段 3b-2 `executePostmanRequest` / STS AssumeRole 的內部依賴；**本階段不接任何 command、不動前端**，只交付經測試的基礎模組。

**Architecture:** 新增 `src-tauri/src/aws.rs`（SigV4，spec §1 的 aws.rs；AssumeRole 留待 3b-2）與 `src-tauri/src/credentials.rs`（憑證解析）。兩模組為 lib 內 `pub`、暫無 crate 內呼叫點（消費者在 3b-2），故加 `#![allow(dead_code)]`（對齊 events.rs 既有做法），並以 `#[cfg(test)]` 測試完整覆蓋。SigV4 採**手寫實作**（hmac/sha2/hex），不引入整個 AWS SDK；正確性以 AWS 官方「get-vanilla」測試向量釘住。

**Tech Stack:** Rust（hmac、sha2、hex、chrono、regex）。

參照設計文件：`docs/superpowers/specs/2026-05-28-tauri-migration-design.md`（§1 aws.rs/certs.rs 職責、§5 SigV4 對測試向量）。憑證解析的 Electron 來源：`public/electron.js:1725-1879`（`parseCredentialFileContent`）。SigV4 對應 Electron 的 `aws4.sign` 兩個呼叫點（`electron.js:52-63` STS、`:2546-2564` 主請求）。

**為何拆出 3b-1：** `executePostmanRequest`（~350 行）+ AssumeRole（網路）+ 這兩個基礎，整包過大且網路部分無法自動驗證。先把**可用測試向量釘死正確性**的密碼學/解析基礎做完並驗證，是風險最低、價值最高的一步。

---

## File Structure

**新增（Rust）**
- `src-tauri/src/aws.rs` — SigV4：`Credentials`、`sign_core`（純、可對向量）、`sign`（用現在時間的薄包裝）+ helper（hmac/sha256/uri_encode/canonical_query）
- `src-tauri/src/credentials.rs` — `ParsedCredentials`、`parse_credential_file_content` + 測試

**修改（Rust）**
- `src-tauri/Cargo.toml` — 加 `hmac`、`sha2`、`hex`、`chrono`、`regex`
- `src-tauri/src/lib.rs` — 宣告 `mod aws; mod credentials;`

**不動：** 前端、command 註冊、capabilities。

---

## Task 1: 相依 + `aws.rs`（SigV4，含官方向量測試）

**Files:** Modify `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`; Create `src-tauri/src/aws.rs`

- [ ] **Step 1: 加相依（Cargo.toml `[dependencies]` 末尾）**

```toml
hmac = "0.12"
sha2 = "0.10"
hex = "0.4"
chrono = "0.4"
regex = "1"
```

- [ ] **Step 2: 建立 `src-tauri/src/aws.rs`**

```rust
//! AWS Signature V4 簽章（對齊 Electron 的 aws4）。消費者為階段 3b-2 的
//! executePostmanRequest / STS AssumeRole；本階段先以 AWS 官方向量驗證。
#![allow(dead_code)]

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug)]
pub struct Credentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut m = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    m.update(data);
    m.finalize().into_bytes().to_vec()
}

fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    hex::encode(h.finalize())
}

/// URI-encode（unreserved 不編碼）。encode_slash=false 時保留 '/'（用於 canonical URI）。
fn uri_encode(s: &str, encode_slash: bool) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        let c = b as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
            out.push(c);
        } else if c == '/' && !encode_slash {
            out.push('/');
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn canonical_query(query: &str) -> String {
    if query.is_empty() {
        return String::new();
    }
    let mut pairs: Vec<(String, String)> = query
        .split('&')
        .map(|kv| {
            let mut it = kv.splitn(2, '=');
            let k = it.next().unwrap_or("");
            let v = it.next().unwrap_or("");
            (uri_encode(k, true), uri_encode(v, true))
        })
        .collect();
    pairs.sort();
    pairs.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&")
}

pub struct SignInput<'a> {
    pub method: &'a str,
    pub host: &'a str,
    pub path: &'a str, // canonical URI（會 uri-encode、保留 '/'）
    pub query: &'a str, // 不含 '?'
    pub headers: BTreeMap<String, String>, // 任意大小寫；會 lowercase
    pub payload: &'a [u8],
    pub service: &'a str,
    pub region: &'a str,
}

/// 核心簽章：給定固定 amzdate(YYYYMMDDTHHMMSSZ)/datestamp(YYYYMMDD)，
/// 回傳 (authorization 標頭值, signature hex, 實際參與簽章的 headers)。供測試對 AWS 向量。
fn sign_core(
    input: &SignInput,
    creds: &Credentials,
    amzdate: &str,
    datestamp: &str,
) -> (String, String, BTreeMap<String, String>) {
    let mut signed: BTreeMap<String, String> = BTreeMap::new();
    for (k, v) in &input.headers {
        signed.insert(k.to_lowercase(), v.trim().to_string());
    }
    signed.insert("host".into(), input.host.to_string());
    signed.insert("x-amz-date".into(), amzdate.to_string());
    if let Some(tok) = &creds.session_token {
        signed.insert("x-amz-security-token".into(), tok.clone());
    }

    let signed_headers = signed.keys().cloned().collect::<Vec<_>>().join(";");
    let canonical_headers: String = signed.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
    let payload_hash = sha256_hex(input.payload);

    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        input.method,
        uri_encode(input.path, false),
        canonical_query(input.query),
        canonical_headers,
        signed_headers,
        payload_hash
    );

    let scope = format!("{}/{}/{}/aws4_request", datestamp, input.region, input.service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amzdate,
        scope,
        sha256_hex(canonical_request.as_bytes())
    );

    let k_date = hmac_sha256(format!("AWS4{}", creds.secret_access_key).as_bytes(), datestamp.as_bytes());
    let k_region = hmac_sha256(&k_date, input.region.as_bytes());
    let k_service = hmac_sha256(&k_region, input.service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        creds.access_key_id, scope, signed_headers, signature
    );
    (authorization, signature, signed)
}

/// 用目前 UTC 時間簽章，回傳「要加到外送請求上的」標頭（Authorization、X-Amz-Date、
/// 視情況的 X-Amz-Security-Token）。3b-2 會把這些套到 reqwest 請求上。
pub fn sign(input: &SignInput, creds: &Credentials) -> BTreeMap<String, String> {
    let now = chrono::Utc::now();
    let amzdate = now.format("%Y%m%dT%H%M%SZ").to_string();
    let datestamp = now.format("%Y%m%d").to_string();
    let (authorization, _sig, _signed) = sign_core(input, creds, &amzdate, &datestamp);

    let mut out = BTreeMap::new();
    out.insert("Authorization".to_string(), authorization);
    out.insert("X-Amz-Date".to_string(), amzdate);
    if let Some(tok) = &creds.session_token {
        out.insert("X-Amz-Security-Token".to_string(), tok.clone());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example_creds() -> Credentials {
        Credentials {
            access_key_id: "AKIDEXAMPLE".into(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".into(),
            session_token: None,
        }
    }

    // AWS 官方 SigV4 測試套件「get-vanilla」向量。
    #[test]
    fn sigv4_get_vanilla_official_vector() {
        let input = SignInput {
            method: "GET",
            host: "example.amazonaws.com",
            path: "/",
            query: "",
            headers: BTreeMap::new(),
            payload: b"",
            service: "service",
            region: "us-east-1",
        };
        let (authz, sig, signed) = sign_core(&input, &example_creds(), "20150830T123600Z", "20150830");
        assert_eq!(sig, "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
        assert!(signed.contains_key("host"));
        assert!(signed.contains_key("x-amz-date"));
        assert_eq!(
            authz,
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, \
SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
        );
    }

    #[test]
    fn session_token_is_signed() {
        let mut creds = example_creds();
        creds.session_token = Some("TOKEN123".into());
        let input = SignInput {
            method: "GET",
            host: "example.amazonaws.com",
            path: "/",
            query: "",
            headers: BTreeMap::new(),
            payload: b"",
            service: "service",
            region: "us-east-1",
        };
        let (authz, _sig, signed) = sign_core(&input, &creds, "20150830T123600Z", "20150830");
        assert!(signed.contains_key("x-amz-security-token"));
        assert!(authz.contains("x-amz-security-token"));
    }

    #[test]
    fn uri_encode_preserves_slash_and_unreserved() {
        assert_eq!(uri_encode("/a/b~c", false), "/a/b~c");
        assert_eq!(uri_encode("a b", true), "a%20b");
        assert_eq!(uri_encode("/x", true), "%2Fx");
    }

    #[test]
    fn canonical_query_sorts_and_encodes() {
        assert_eq!(canonical_query("b=2&a=1"), "a=1&b=2");
        assert_eq!(canonical_query(""), "");
    }

    #[test]
    fn sign_wrapper_emits_expected_headers() {
        let input = SignInput {
            method: "GET", host: "h", path: "/", query: "",
            headers: BTreeMap::new(), payload: b"", service: "execute-api", region: "us-east-1",
        };
        let out = sign(&input, &example_creds());
        assert!(out.contains_key("Authorization"));
        assert!(out.contains_key("X-Amz-Date"));
        assert!(!out.contains_key("X-Amz-Security-Token")); // 無 token
    }
}
```

- [ ] **Step 3: 在 lib.rs 宣告模組**（最上方 mod 區塊）

```rust
mod aws;
mod credentials;
```
（`credentials` 於 Task 2 建立；連續執行可一次加，否則本 Task 先只加 `mod aws;`，Task 2 再加 `mod credentials;`。）

- [ ] **Step 4: 跑測試**

Run: `cd src-tauri && cargo test aws`（新 shell 先 `export PATH="$USERPROFILE/.cargo/bin:$PATH"`；首次會下載 hmac/sha2/hex/chrono）
Expected: 5 個測試 PASS，**尤其 `sigv4_get_vanilla_official_vector`**（簽章對上官方向量）。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/aws.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): AWS SigV4 signing (verified against official get-vanilla vector)"
```

---

## Task 2: `credentials.rs`（憑證檔解析，從 1b 延後）

**Files:** Create `src-tauri/src/credentials.rs`; Modify `src-tauri/src/lib.rs`

> 對齊 Electron `parseCredentialFileContent`（electron.js:1725-1879）。分支順序：AWS/ini → JSON → CSV → regex 逐行 → 位置 fallback。回傳 `{access_key_id, secret_access_key, session_token, profiles}`，永不 panic。

- [ ] **Step 1: 建立 `src-tauri/src/credentials.rs`**

```rust
//! AWS 憑證檔解析（ini/json/csv/regex/位置 fallback）。對齊 Electron parseCredentialFileContent。
//! 消費者為階段 3b-2 的 executePostmanRequest（檔案型憑證）。
#![allow(dead_code)]

use regex::Regex;
use serde_json::Value;

#[derive(Debug, Default, PartialEq)]
pub struct ParsedCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: String,
    pub profiles: Vec<String>,
}

pub fn parse_credential_file_content(
    content: &str,
    file_path_hint: &str,
    target_profile: Option<&str>,
) -> ParsedCredentials {
    let hint = file_path_hint.to_lowercase();
    let is_csv = hint.ends_with(".csv");
    let is_aws_credentials = hint.contains("credentials") || hint.contains(".aws");

    // 1) AWS/INI 分支（命中即回傳，即使 key 為空）
    if is_aws_credentials {
        let normalized = content.replace("\r\n", "\n");
        let mut profile_order: Vec<String> = Vec::new();
        let mut profile_data: std::collections::HashMap<String, std::collections::HashMap<String, String>> =
            std::collections::HashMap::new();
        let mut current: Option<String> = None;
        for line in normalized.split('\n') {
            let t = line.trim();
            if t.is_empty() || t.starts_with('#') || t.starts_with(';') {
                continue;
            }
            if t.starts_with('[') && t.ends_with(']') {
                let name = t[1..t.len() - 1].to_string();
                if !profile_data.contains_key(&name) {
                    profile_order.push(name.clone());
                }
                profile_data.entry(name.clone()).or_default();
                current = Some(name);
                continue;
            }
            if let Some(cur) = &current {
                if let Some(eq) = t.find('=') {
                    let key = t[..eq].trim().to_string();
                    let val = t[eq + 1..].trim().to_string();
                    profile_data.get_mut(cur).unwrap().insert(key, val);
                }
            }
        }
        let chosen = target_profile
            .map(|s| s.to_string())
            .or_else(|| profile_order.first().cloned());
        let mut out = ParsedCredentials { profiles: profile_order.clone(), ..Default::default() };
        if let Some(name) = chosen {
            if let Some(kv) = profile_data.get(&name) {
                out.access_key_id = kv.get("aws_access_key_id").cloned().unwrap_or_default();
                out.secret_access_key = kv.get("aws_secret_access_key").cloned().unwrap_or_default();
                out.session_token = kv.get("aws_session_token").cloned().unwrap_or_default();
            }
        }
        return out;
    }

    // 2) JSON 分支
    if let Ok(json) = serde_json::from_str::<Value>(content) {
        let get = |keys: &[&str]| -> String {
            for k in keys {
                if let Some(s) = json.get(*k).and_then(|v| v.as_str()) {
                    if !s.is_empty() {
                        return s.to_string();
                    }
                }
            }
            String::new()
        };
        let ak = get(&["Access Key ID", "access_key_id", "AccessKeyId"]);
        let sk = get(&["Secret Access Key", "secret_access_key", "SecretAccessKey"]);
        let st = get(&["Session Token", "session_token", "SessionToken"]);
        if !ak.is_empty() && !sk.is_empty() {
            return ParsedCredentials { access_key_id: ak, secret_access_key: sk, session_token: st, profiles: vec![] };
        }
    }

    let normalized = content.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();

    // 3) CSV 分支
    if is_csv && lines.len() >= 2 {
        let headers: Vec<String> = lines[0].trim().split(',').map(|h| h.trim().to_lowercase()).collect();
        let values: Vec<String> = lines[1].trim().split(',').map(|v| v.trim().to_string()).collect();
        let access_headers = ["access key id", "accesskeyid", "aws_access_key_id"];
        let secret_headers = ["secret access key", "secretaccesskey", "aws_secret_access_key"];
        let session_headers = ["session token", "sessiontoken", "aws_session_token"];
        let mut ai = headers.iter().position(|h| access_headers.contains(&h.as_str()));
        let mut si = headers.iter().position(|h| secret_headers.contains(&h.as_str()));
        let mut ti = headers.iter().position(|h| session_headers.contains(&h.as_str()));
        if ai.is_none() {
            ai = headers.iter().position(|h| h.contains("access key id") || h.contains("accesskeyid"));
        }
        if si.is_none() {
            si = headers.iter().position(|h| h.contains("secret access key") || h.contains("secretaccesskey"));
        }
        if ti.is_none() {
            ti = headers.iter().position(|h| h.contains("session token") || h.contains("sessiontoken"));
        }
        let mut ak = String::new();
        let mut sk = String::new();
        let mut st = String::new();
        if let Some(i) = ai {
            if values.len() > i {
                ak = values[i].clone();
            }
        }
        if let Some(i) = si {
            if values.len() > i {
                sk = values[i].clone();
            }
        }
        if let Some(i) = ti {
            if values.len() > i {
                st = values[i].clone();
            }
        }
        if !ak.is_empty() && !sk.is_empty() {
            return ParsedCredentials { access_key_id: ak, secret_access_key: sk, session_token: st, profiles: vec![] };
        }
    }

    // 4) regex 逐行 fallback
    let access_re = Regex::new(r"(?i)(?:Access Key ID|access_key_id|AccessKeyId|aws_access_key_id)\s*[:=]\s*([A-Za-z0-9/+=]{20,})").unwrap();
    let secret_re = Regex::new(r"(?i)(?:Secret Access Key|secret_access_key|SecretAccessKey|aws_secret_access_key)\s*[:=]\s*([A-Za-z0-9/+=]{40,})").unwrap();
    let session_re = Regex::new(r"(?i)(?:Session Token|session_token|SessionToken|aws_session_token)\s*[:=]\s*([A-Za-z0-9/+=]{100,})").unwrap();
    let mut ak = String::new();
    let mut sk = String::new();
    let mut st = String::new();
    for line in &lines {
        if ak.is_empty() {
            if let Some(c) = access_re.captures(line) {
                ak = c[1].trim().to_string();
            }
        }
        if sk.is_empty() {
            if let Some(c) = secret_re.captures(line) {
                sk = c[1].trim().to_string();
            }
        }
        if st.is_empty() {
            if let Some(c) = session_re.captures(line) {
                st = c[1].trim().to_string();
            }
        }
        if !ak.is_empty() && !sk.is_empty() {
            break;
        }
    }

    // 5) 位置 fallback
    let line0_re = Regex::new(r"^[A-Z0-9]{20}$").unwrap();
    let line1_re = Regex::new(r"^[a-zA-Z0-9/+=]{40}$").unwrap();
    if ak.is_empty() && !lines.is_empty() && line0_re.is_match(lines[0].trim()) {
        ak = lines[0].trim().to_string();
    }
    if sk.is_empty() && lines.len() >= 2 && line1_re.is_match(lines[1].trim()) {
        sk = lines[1].trim().to_string();
    }

    ParsedCredentials { access_key_id: ak, secret_access_key: sk, session_token: st, profiles: vec![] }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ini_picks_target_profile_and_lists_profiles() {
        let content = "[default]\naws_access_key_id = AKIA_DEF\naws_secret_access_key = SECRET_DEF\n\n[prod]\naws_access_key_id = AKIA_PROD\naws_secret_access_key = SECRET_PROD\naws_session_token = TOK\n";
        let r = parse_credential_file_content(content, "/home/u/.aws/credentials", Some("prod"));
        assert_eq!(r.access_key_id, "AKIA_PROD");
        assert_eq!(r.secret_access_key, "SECRET_PROD");
        assert_eq!(r.session_token, "TOK");
        assert_eq!(r.profiles, vec!["default".to_string(), "prod".to_string()]);
    }

    #[test]
    fn ini_defaults_to_first_profile() {
        let content = "[default]\naws_access_key_id = AKIA_DEF\naws_secret_access_key = SECRET_DEF\n";
        let r = parse_credential_file_content(content, "credentials", None);
        assert_eq!(r.access_key_id, "AKIA_DEF");
        assert_eq!(r.profiles, vec!["default".to_string()]);
    }

    #[test]
    fn json_branch() {
        let content = r#"{"AccessKeyId":"AKIAJSON","SecretAccessKey":"SECRETJSON","SessionToken":"STJSON"}"#;
        let r = parse_credential_file_content(content, "creds.json", None);
        assert_eq!(r.access_key_id, "AKIAJSON");
        assert_eq!(r.secret_access_key, "SECRETJSON");
        assert_eq!(r.session_token, "STJSON");
        assert!(r.profiles.is_empty());
    }

    #[test]
    fn csv_branch() {
        let content = "Access key ID,Secret access key\nAKIACSV,SECRETCSV\n";
        let r = parse_credential_file_content(content, "/d/new_user_credentials.csv", None);
        assert_eq!(r.access_key_id, "AKIACSV");
        assert_eq!(r.secret_access_key, "SECRETCSV");
    }

    #[test]
    fn regex_fallback() {
        let content = "some preamble\nAccessKeyId = AKIAABCDEFGHIJKLMNOP\nSecretAccessKey = abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN\n";
        let r = parse_credential_file_content(content, "blob.txt", None);
        assert_eq!(r.access_key_id, "AKIAABCDEFGHIJKLMNOP");
        assert_eq!(r.secret_access_key, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN");
    }

    #[test]
    fn positional_fallback() {
        // line0 = 20 大寫英數、line1 = 40 字元
        let content = "AKIAABCDEFGHIJKLMNOP\nabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN\n";
        let r = parse_credential_file_content(content, "raw.txt", None);
        assert_eq!(r.access_key_id, "AKIAABCDEFGHIJKLMNOP");
        assert_eq!(r.secret_access_key, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN");
    }
}
```

- [ ] **Step 2: 在 lib.rs 宣告 `mod credentials;`**（若 Task 1 未加）

- [ ] **Step 3: 跑測試**

Run: `cd src-tauri && cargo test credentials`（首次下載 regex）
Expected: 6 個測試 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/credentials.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): AWS credential file parser (ini/json/csv/regex/positional)"
```

---

## Task 3: 驗證 + 收尾

**Files:** 無

- [ ] **Step 1: 後端全測試** — Run: `cd src-tauri && cargo test`；Expected: 既有 32 + 本階段（aws 5、credentials 6）共 43 全綠。
- [ ] **Step 2: 編譯整個 App lib** — Run: `cd src-tauri && cargo build`；Expected: 無錯；警告只剩既有的 `AppError::NotFound`（dead_code）。
- [ ] **Step 3: 前端全測試（確認無連帶破壞）** — Run: `npx vitest run`；Expected: 無新增 failure（基準 693）。
  > 本階段不動前端、不加 command，App 執行期行為不變，故不另跑 tauri:dev 煙霧。
- [ ] **Step 4: 最終 code review + finishing-a-development-branch。**

---

## 階段 3b-1 完成定義

- [ ] SigV4 簽章對上 AWS 官方「get-vanilla」向量（signature 與 Authorization 字串完全相符）
- [ ] session token 會被納入簽章（X-Amz-Security-Token）
- [ ] 憑證檔解析 ini/json/csv/regex/位置 fallback 全數測試綠
- [ ] `cargo test` 全綠、`cargo build` 乾淨；前端 vitest 無回歸
- [ ] 無 command/前端變更（基礎模組，消費者為 3b-2）

---

## Self-Review 紀錄

- **Spec 覆蓋**：對應 spec §1 aws.rs（SigV4；AssumeRole 留 3b-2）、§5「SigV4 對 AWS 已知測試向量」。憑證解析為 1b 明確延後項，於此補上（消費者 executePostmanRequest 在 3b-2）。
- **拆分理由**：執行請求（~350 行）+ AssumeRole（網路）+ 基礎，整包過大且網路部分無法自動驗證；先交付可用測試向量釘死正確性的密碼學/解析基礎。Bug #9（Swagger URL）因 3a 已延後 OpenAPI/Swagger 轉換而不適用，移出範圍。
- **Placeholder 掃描**：無 TBD/TODO；每步有完整程式碼與預期輸出。
- **正確性錨點**：`sign_core` 以固定 amzdate/datestamp 設計、可對 AWS 官方向量（get-vanilla，signature=5fa00fa3…fbf31）；`sign` 薄包裝用現在時間，3b-2 接 reqwest 時再處理「reqwest 自動管理的 Host/Content-Length 不要納入簽章」等整合細節（屬 3b-2 + 實機驗證）。
- **dead_code**：兩模組 `#![allow(dead_code)]`（消費者在 3b-2），對齊 events.rs 既有做法；測試完整覆蓋公開函式。
