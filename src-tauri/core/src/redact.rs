//! Secret redaction for CLI output — the single source of truth shared by `send`,
//! the `run` reporters, and their tests. No Tauri deps (keeps `core` CI-clean).
use crate::buildreq::{basic_auth_value, enc};
use crate::config::Auth;
use crate::datafile::js_string;
use serde_json::{Map, Value};

const MARKER: &str = "***REDACTED***";

/// Secret tokens to scrub from output, kept sorted longest-first so a short token
/// (e.g. a username) cannot corrupt a longer one (e.g. a base64 blob) mid-replace.
#[derive(Debug, Clone, Default)]
pub struct RedactionSet {
    tokens: Vec<String>,
}

impl RedactionSet {
    /// Build from a resolved identity's auth secrets: each raw secret + its
    /// percent-encoded form; for Basic, both the full `Basic <b64>` and the bare b64.
    pub fn from_auth(auth: &Auth) -> Self {
        let raw: Vec<String> = match auth {
            Auth::None => vec![],
            Auth::Bearer { token } => vec![token.clone()],
            Auth::ApiKey { value, .. } => vec![value.clone()],
            Auth::Basic { username, password } => {
                let full = basic_auth_value(username, password);
                let bare = full.strip_prefix("Basic ").unwrap_or(&full).to_string();
                vec![username.clone(), password.clone(), full, bare]
            }
        };
        let mut set = RedactionSet::default();
        set.add_raw(raw);
        set
    }

    /// Extend with every non-empty value of a data-iteration row (+ percent-encoded).
    /// Row values are substituted into requests and can resurface in final_url/actuals,
    /// so they must be redacted from output even though they are not identity secrets.
    pub fn extend_with_data_row(&mut self, row: &Map<String, Value>) {
        let vals: Vec<String> = row.values().map(js_string).collect();
        self.add_raw(vals);
    }

    fn add_raw(&mut self, raws: Vec<String>) {
        for secret in raws {
            if secret.is_empty() {
                continue;
            }
            // raw form
            self.push(secret.clone());
            // percent-encoded form (apiKey-in-query and other URL contexts)
            self.push(enc(&secret));
            // JSON-string-escaped form: assertion `actual`s are JSON.stringify'd before they
            // reach redaction (engine.rs bodyEq/time/bodyArray), so a secret containing `"`,
            // `\`, or a control char would otherwise appear escaped (e.g. `a"b` -> `a\"b`) and
            // slip past the raw/encoded tokens. Add the inner-escaped form so it is caught too.
            self.push(json_escaped(&secret));
        }
        // longest-first so a short token cannot corrupt a longer one mid-replacement
        self.tokens.sort_by(|a, b| b.len().cmp(&a.len()));
    }

    /// Add a token if non-empty and not already present.
    fn push(&mut self, token: String) {
        if !token.is_empty() && !self.tokens.contains(&token) {
            self.tokens.push(token);
        }
    }

    /// Replace every token occurrence in `s` with the redaction marker.
    pub fn redact_str(&self, s: &str) -> String {
        let mut out = s.to_string();
        for t in &self.tokens {
            if !t.is_empty() {
                out = out.replace(t.as_str(), MARKER);
            }
        }
        out
    }

    /// Recursively redact all string leaves AND object keys of a JSON value.
    /// (A secret echoed as a body/header KEY would otherwise leak.) Used by `send`.
    pub fn redact_value(&self, v: &Value) -> Value {
        match v {
            Value::String(s) => Value::String(self.redact_str(s)),
            Value::Array(a) => Value::Array(a.iter().map(|x| self.redact_value(x)).collect()),
            Value::Object(o) => Value::Object(
                o.iter().map(|(k, x)| (self.redact_str(k), self.redact_value(x))).collect(),
            ),
            other => other.clone(),
        }
    }

    #[cfg(test)]
    pub(crate) fn tokens(&self) -> &[String] {
        &self.tokens
    }
}

/// The JSON-string escaping of `s` WITHOUT the surrounding quotes (`a"b` -> `a\"b`,
/// newline -> `\n`). Assertion actuals are JSON.stringify'd before they reach redaction,
/// so the escaped form of a secret must also be a redaction token.
fn json_escaped(s: &str) -> String {
    let quoted = serde_json::to_string(s).unwrap_or_default();
    quoted
        .strip_prefix('"')
        .and_then(|x| x.strip_suffix('"'))
        .unwrap_or(quoted.as_str())
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ApiKeyIn, Auth};
    use serde_json::json;

    #[test]
    fn bearer_secret_redacted_everywhere() {
        let r = RedactionSet::from_auth(&Auth::Bearer { token: "topsecret".into() });
        assert_eq!(r.redact_str("Authorization: Bearer topsecret"), "Authorization: Bearer ***REDACTED***");
        assert_eq!(r.redact_value(&json!({"topsecret": "topsecret"})), json!({"***REDACTED***": "***REDACTED***"}));
    }

    #[test]
    fn basic_redacts_full_bare_and_is_order_safe() {
        let r = RedactionSet::from_auth(&Auth::Basic { username: "u".into(), password: "passw0rd".into() });
        let full = crate::buildreq::basic_auth_value("u", "passw0rd");
        let bare = full.strip_prefix("Basic ").unwrap();
        assert_eq!(r.redact_str(&full), "***REDACTED***");
        assert_eq!(r.redact_str(bare), "***REDACTED***");
        let toks = r.tokens();
        assert!(toks.windows(2).all(|w| w[0].len() >= w[1].len()), "tokens longest-first: {toks:?}");
    }

    #[test]
    fn apikey_value_redacted_raw_and_encoded() {
        let r = RedactionSet::from_auth(&Auth::ApiKey {
            key: "X-API-Key".into(), value: "a b/c".into(), location: ApiKeyIn::Query,
        });
        assert_eq!(r.redact_str("key=a b/c"), "key=***REDACTED***");
        assert_eq!(r.redact_str("key=a%20b%2Fc"), "key=***REDACTED***");
    }

    #[test]
    fn data_row_values_redacted_after_extend() {
        let mut r = RedactionSet::from_auth(&Auth::None);
        let row: Map<String, Value> = serde_json::from_value(json!({"token": "rowsecret123", "page": 2})).unwrap();
        r.extend_with_data_row(&row);
        assert_eq!(r.redact_str("https://x/?t=rowsecret123"), "https://x/?t=***REDACTED***");
        assert_eq!(r.redact_str("count=2"), "count=***REDACTED***");
    }

    #[test]
    fn none_auth_is_noop() {
        let r = RedactionSet::from_auth(&Auth::None);
        assert_eq!(r.redact_str("nothing to hide"), "nothing to hide");
    }

    #[test]
    fn json_escaped_secret_form_is_redacted() {
        // Assertion actuals are JSON.stringify'd before redaction; a secret containing a quote
        // appears escaped (`a"b` -> `a\"b`). The escaped form must be in the token set too.
        let r = RedactionSet::from_auth(&Auth::Bearer { token: "a\"b".into() });
        // raw form still caught
        assert_eq!(r.redact_str("a\"b"), "***REDACTED***");
        // how a bodyEq actual carries it: serde_json::to_string("a\"b") == "\"a\\\"b\""
        let actual = serde_json::to_string("a\"b").unwrap();
        let red = r.redact_str(&actual);
        assert!(!red.contains("a\\\"b"), "JSON-escaped secret leaked: {red}");
        assert!(red.contains("***REDACTED***"), "redaction marker present: {red}");
    }
}
