//! AWS Signature V4 簽章（對齊 Electron 的 aws4）。消費者為階段 3b-2 的
//! executePostmanRequest / STS AssumeRole；本階段先以 AWS 官方向量驗證。
#![allow(dead_code)]

// hmac 0.13 / digest 0.11：`new_from_slice` 由 KeyInit 提供（0.12 時在 Mac 上）。
use hmac::{Hmac, KeyInit, Mac};
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

pub fn sha256_hex(data: &[u8]) -> String {
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
        // AWS canonical headers：trim + 內部連續空白折成單一空白（非引號內）。
        let collapsed = v.split_whitespace().collect::<Vec<_>>().join(" ");
        signed.insert(k.to_lowercase(), collapsed);
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
/// 注意：回傳為「附加」標頭——呼叫端仍須把 input.headers 內所有（已參與簽章的）標頭
/// 一併送出（尤其若加了 x-amz-content-sha256），否則 SignedHeaders 與實送不符會被 AWS 拒（403）。
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

/// STS AssumeRole（async）。對齊 Electron assumeRole：POST sts.amazonaws.com 表單、SigV4 簽、解析 XML。
/// 僅在傳入的 creds 無 session_token 時被呼叫（呼叫端負責判斷）。
pub async fn assume_role(creds: &Credentials, role_arn: &str, session_name: &str) -> Result<Credentials, String> {
    let body = format!(
        "Action=AssumeRole&Version=2011-06-15&RoleArn={}&RoleSessionName={}&DurationSeconds=3600",
        uri_encode(role_arn, true),
        uri_encode(session_name, true)
    );
    let mut headers = BTreeMap::new();
    headers.insert(
        "content-type".to_string(),
        "application/x-www-form-urlencoded; charset=utf-8".to_string(),
    );
    let input = SignInput {
        method: "POST",
        host: "sts.amazonaws.com",
        path: "/",
        query: "",
        headers,
        payload: body.as_bytes(),
        service: "sts",
        region: "us-east-1",
    };
    let signed = sign(&input, creds); // Authorization / X-Amz-Date /（無 token）

    let client = reqwest::Client::new();
    let mut rb = client
        .post("https://sts.amazonaws.com/")
        .header("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
        .body(body);
    for (k, v) in &signed {
        rb = rb.header(k.as_str(), v.as_str());
    }
    let resp = rb.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("STS AssumeRole failed with status {}: {}", status.as_u16(), text));
    }
    parse_sts_xml(&text).ok_or_else(|| "Failed to parse credentials from STS response".to_string())
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
}
