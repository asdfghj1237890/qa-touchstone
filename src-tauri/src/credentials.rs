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
                // 對齊 Electron：重複的 section 會清空（last-wins-whole-section）。
                profile_data.insert(name.clone(), std::collections::HashMap::new());
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
        // 注意：檔名不可含 "credentials"/".aws"，否則會走 ini 分支（對齊 Electron）。
        let content = "Access key ID,Secret access key\nAKIACSV,SECRETCSV\n";
        let r = parse_credential_file_content(content, "/d/keys_export.csv", None);
        assert_eq!(r.access_key_id, "AKIACSV");
        assert_eq!(r.secret_access_key, "SECRETCSV");
    }

    #[test]
    fn filename_with_credentials_uses_ini_branch() {
        // 對齊 Electron：檔名含 "credentials" → 視為 AWS ini 檔，即使副檔名是 .csv。
        let content = "[default]\naws_access_key_id = AKIA_INI\naws_secret_access_key = SEC_INI\n";
        let r = parse_credential_file_content(content, "/d/my_credentials.csv", None);
        assert_eq!(r.access_key_id, "AKIA_INI");
        assert_eq!(r.profiles, vec!["default".to_string()]);
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
