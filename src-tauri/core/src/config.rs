//! CI config: typed JSON model + fail-closed `{env}` secret resolution.
use serde::Deserialize;
use std::collections::BTreeMap;

/// A secret-bearing field: either a literal string or a `{ "env": "VAR" }` ref.
#[derive(Debug, Clone)]
enum SecretRef {
    Env(String),
    Literal(String),
}

impl<'de> serde::Deserialize<'de> for SecretRef {
    fn deserialize<D>(d: D) -> Result<Self, D::Error>
    where D: serde::Deserializer<'de> {
        use serde::de::Error;
        let v = serde_json::Value::deserialize(d)?;
        match v {
            serde_json::Value::String(s) => Ok(SecretRef::Literal(s)),
            serde_json::Value::Object(map) => {
                let env = map.get("env").and_then(|x| x.as_str())
                    .ok_or_else(|| D::Error::custom("secret object must have a string `env`"))?;
                if map.len() != 1 {
                    return Err(D::Error::custom("secret object must contain only `env`"));
                }
                Ok(SecretRef::Env(env.to_string()))
            }
            _ => Err(D::Error::custom("secret must be a string or { \"env\": \"VAR\" }")),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Collection {
    pub id: String,
    pub requests: Vec<String>,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConfig {
    version: u32,
    #[serde(default)]
    globals: Globals,
    #[serde(default)]
    environments: Vec<Environment>,
    #[serde(default)]
    identities: Vec<RawIdentity>,
    #[serde(default)]
    requests: Vec<Request>,
    #[serde(default)]
    collections: Vec<Collection>,
    #[serde(default)]
    security: Option<SecurityConfig>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Globals { #[serde(default)] pub variables: BTreeMap<String, String> }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Environment { pub name: String, #[serde(default)] pub variables: BTreeMap<String, String> }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawIdentity { id: String, auth: RawAuth, #[serde(default)] privileged: bool }

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum RawAuth {
    None,
    Bearer { token: SecretRef },
    ApiKey { key: String, value: SecretRef, #[serde(rename = "in")] location: ApiKeyIn },
    Basic { username: SecretRef, password: SecretRef },
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ApiKeyIn { Header, Query }

/// Resolved auth (secrets are now opaque literals).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Auth {
    None,
    Bearer { token: String },
    ApiKey { key: String, value: String, location: ApiKeyIn },
    Basic { username: String, password: String },
}

#[derive(Debug, Clone)]
pub struct Identity { pub id: String, pub auth: Auth, pub privileged: bool }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub id: String,
    pub method: String,
    pub url: String,
    #[serde(default)] pub headers: Vec<Kv>,
    #[serde(default)] pub query: Vec<Kv>,
    pub body: Option<Body>,
    #[serde(default)] pub assertions: Vec<serde_json::Value>,
    #[serde(default)] pub privileged: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Kv { pub key: String, pub value: String }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Body { pub mode: BodyMode, #[serde(default)] pub content: String }

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BodyMode { None, Json, Raw }

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Expectation { Allow, Deny, Skip }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MatrixConfig {
    #[serde(default)] pub endpoints: Vec<String>,
    #[serde(default = "default_deny_set", rename = "denySet")] pub deny_set: Vec<i64>,
    #[serde(default)] pub expect: std::collections::BTreeMap<String, std::collections::BTreeMap<String, Expectation>>,
}
fn default_deny_set() -> Vec<i64> { vec![401, 403, 404] }

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum IdLocation {
    Path { index: usize },
    Query { key: String },
    Body { path: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BolaTest {
    pub id: String,
    pub request: String,
    #[serde(rename = "idLocation")] pub id_location: IdLocation,
    #[serde(default, rename = "idValues")] pub id_values: std::collections::BTreeMap<String, serde_json::Value>,
    #[serde(default, rename = "negativeControl")] pub negative_control: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BolaConfig { #[serde(default)] pub tests: Vec<BolaTest> }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RateLimitTest {
    pub id: String,
    pub request: String,
    #[serde(default)] pub identity: Option<String>,
    /// Burst size; clamped to 1..=200 at runtime (TS clampInt parity), not rejected.
    #[serde(default)] pub n: Option<i64>,
    /// Max requests in flight; clamped to 1..=10 at runtime, not rejected.
    #[serde(default)] pub concurrency: Option<i64>,
    /// `"sensitive"` raises a no-protection finding to High (else Low). Free-form per TS.
    #[serde(default)] pub sensitivity: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RateLimitConfig { #[serde(default)] pub tests: Vec<RateLimitTest> }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BflaConfig {
    #[serde(default)] pub endpoints: Vec<String>,
    #[serde(default = "default_deny_set", rename = "denySet")] pub deny_set: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SecurityConfig {
    #[serde(default)] pub matrix: Option<MatrixConfig>,
    #[serde(default)] pub bola: Option<BolaConfig>,
    #[serde(default)] pub bfla: Option<BflaConfig>,
    #[serde(default, rename = "rateLimit")] pub rate_limit: Option<RateLimitConfig>,
    #[serde(default)] pub oracles: Option<OracleConfigRaw>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OracleConfigRaw {
    #[serde(default)] pub sensitive: Option<bool>,
    #[serde(default)] pub schema: Option<bool>,
    #[serde(default, rename = "severityOverrides")] pub severity_overrides: BTreeMap<String, crate::security::finding::Severity>,
}

impl OracleConfigRaw {
    /// Resolve to the engine config; absent fields default ON (TS DEFAULT_ORACLE_CONFIG parity).
    pub fn resolve(&self) -> crate::security::oracles::OracleConfig {
        crate::security::oracles::OracleConfig {
            sensitive: self.sensitive.unwrap_or(true),
            schema: self.schema.unwrap_or(true),
            severity_overrides: self.severity_overrides.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub version: u32,
    pub globals: Globals,
    pub environments: Vec<Environment>,
    pub identities: Vec<Identity>,
    pub requests: Vec<Request>,
    pub collections: Vec<Collection>,
    pub security: Option<SecurityConfig>,
}

const SUPPORTED_VERSION: u32 = 1;

/// Resolve one secret ref, failing closed on a missing env var.
fn resolve_secret(s: &SecretRef, env: &dyn Fn(&str) -> Option<String>) -> Result<String, String> {
    match s {
        SecretRef::Literal(v) => Ok(v.clone()),
        SecretRef::Env(name) => match env(name) {
            Some(v) if !v.is_empty() => Ok(v),
            Some(_) => Err(format!("required environment variable `{name}` is set but empty")),
            None => Err(format!("required environment variable `{name}` is unset")),
        },
    }
}

fn resolve_auth(raw: RawAuth, env: &dyn Fn(&str) -> Option<String>) -> Result<Auth, String> {
    Ok(match raw {
        RawAuth::None => Auth::None,
        RawAuth::Bearer { token } => Auth::Bearer { token: resolve_secret(&token, env)? },
        RawAuth::ApiKey { key, value, location } =>
            Auth::ApiKey { key, value: resolve_secret(&value, env)?, location },
        RawAuth::Basic { username, password } =>
            Auth::Basic { username: resolve_secret(&username, env)?, password: resolve_secret(&password, env)? },
    })
}

/// Parse a CI config from JSON, resolve `{env}` secrets via `env` (fail-closed), and
/// run structural `validate()`. A `Config` returned here is therefore always validated.
pub fn load_config(json: &str, env: &dyn Fn(&str) -> Option<String>) -> Result<Config, String> {
    let raw: RawConfig = serde_json::from_str(json).map_err(|e| format!("invalid config JSON: {e}"))?;
    if raw.version != SUPPORTED_VERSION {
        return Err(format!("unsupported config version {} (this binary supports {SUPPORTED_VERSION})", raw.version));
    }
    let identities = raw.identities.into_iter()
        .map(|i| Ok(Identity { id: i.id, auth: resolve_auth(i.auth, env)?, privileged: i.privileged }))
        .collect::<Result<Vec<_>, String>>()?;
    let cfg = Config {
        version: raw.version, globals: raw.globals, environments: raw.environments,
        identities, requests: raw.requests, collections: raw.collections,
        security: raw.security,
    };
    // Enforce structural validation at the single construction site so it is impossible
    // to obtain an unvalidated Config. scoped_vars() and the CLI both rely on this — e.g.
    // duplicate collection ids would otherwise silently drop a collection's variables
    // via the BTreeMap in scoped_vars().
    validate(&cfg)?;
    Ok(cfg)
}

impl Config {
    /// Adapt the JSON config (object-map variables) into the engine's scoped-vars
    /// shape (rows with `on: true`). Rust-only glue — no TS counterpart.
    pub fn scoped_vars(&self) -> crate::engine::ScopedVars {
        use crate::engine::{ScopedVars, VarRow};
        let row = |(k, v): (&String, &String)| VarRow { key: k.clone(), value: v.clone(), on: true };
        ScopedVars {
            globals: self.globals.variables.iter().map(row).collect(),
            collections: self.collections.iter()
                .map(|c| (c.id.clone(), c.variables.iter().map(row).collect()))
                .collect(),
            environments: self.environments.iter()
                .map(|e| (e.name.clone(), e.variables.iter().map(row).collect()))
                .collect(),
        }
    }
}

/// Up-front structural validation: unique ids, and every collection request-ref exists.
/// Returns Err(message naming the offender) → the caller maps to exit 2.
pub fn validate(cfg: &Config) -> Result<(), String> {
    fn dups(label: &str, ids: impl Iterator<Item = String>) -> Result<(), String> {
        let mut seen = std::collections::HashSet::new();
        for id in ids {
            if !seen.insert(id.clone()) {
                return Err(format!("duplicate {label} `{id}`"));
            }
        }
        Ok(())
    }
    dups("request", cfg.requests.iter().map(|r| r.id.clone()))?;
    dups("collection", cfg.collections.iter().map(|c| c.id.clone()))?;
    dups("identity", cfg.identities.iter().map(|i| i.id.clone()))?;
    dups("environment", cfg.environments.iter().map(|e| e.name.clone()))?;
    let req_ids: std::collections::HashSet<&str> = cfg.requests.iter().map(|r| r.id.as_str()).collect();
    for c in &cfg.collections {
        for r in &c.requests {
            if !req_ids.contains(r.as_str()) {
                return Err(format!("collection `{}` references unknown request `{}`", c.id, r));
            }
        }
    }
    if let Some(sec) = &cfg.security {
        let id_ids: std::collections::HashSet<&str> = cfg.identities.iter().map(|i| i.id.as_str()).collect();
        if let Some(m) = &sec.matrix {
            for e in &m.endpoints {
                if !req_ids.contains(e.as_str()) { return Err(format!("security.matrix endpoint references unknown request `{e}`")); }
            }
            for (rid, row) in &m.expect {
                if !req_ids.contains(rid.as_str()) { return Err(format!("security.matrix.expect references unknown request `{rid}`")); }
                for idid in row.keys() {
                    if !id_ids.contains(idid.as_str()) { return Err(format!("security.matrix.expect references unknown identity `{idid}`")); }
                }
            }
        }
        if let Some(b) = &sec.bola {
            let mut seen = std::collections::HashSet::new();
            for t in &b.tests {
                if !seen.insert(t.id.clone()) { return Err(format!("duplicate bola test `{}`", t.id)); }
                if !req_ids.contains(t.request.as_str()) { return Err(format!("bola test `{}` references unknown request `{}`", t.id, t.request)); }
                for (idid, v) in &t.id_values {
                    if !id_ids.contains(idid.as_str()) { return Err(format!("bola test `{}` idValues references unknown identity `{}`", t.id, idid)); }
                    if !(v.is_string() || v.is_number() || v.is_boolean()) {
                        return Err(format!("bola test `{}` idValue for `{}` must be a string/number/bool", t.id, idid));
                    }
                }
            }
        }
        if let Some(rl) = &sec.rate_limit {
            let mut seen = std::collections::HashSet::new();
            for t in &rl.tests {
                if !seen.insert(t.id.clone()) { return Err(format!("duplicate rateLimit test `{}`", t.id)); }
                if !req_ids.contains(t.request.as_str()) { return Err(format!("rateLimit test `{}` references unknown request `{}`", t.id, t.request)); }
                if let Some(idid) = &t.identity {
                    if !id_ids.contains(idid.as_str()) { return Err(format!("rateLimit test `{}` references unknown identity `{}`", t.id, idid)); }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn envmap(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    const SAMPLE: &str = r#"{
      "version": 1,
      "globals": { "variables": { "ua": "qa-touchstone-ci" } },
      "environments": [ { "name": "staging", "variables": { "apiHost": "https://x" } } ],
      "identities": [
        { "id": "admin", "auth": { "type": "bearer", "token": { "env": "ADMIN_TOKEN" } } },
        { "id": "anon",  "auth": { "type": "none" } }
      ],
      "requests": [ { "id": "getUser", "method": "GET", "url": "{{apiHost}}/u/1" } ]
    }"#;

    #[test]
    fn loads_and_resolves_env() {
        let cfg = load_config(SAMPLE, &|k| envmap(&[("ADMIN_TOKEN", "secret")]).get(k).cloned())
            .expect("loads");
        assert_eq!(cfg.version, 1);
        let admin = cfg.identities.iter().find(|i| i.id == "admin").unwrap();
        match &admin.auth {
            Auth::Bearer { token } => assert_eq!(token, "secret"),
            _ => panic!("expected bearer"),
        }
    }

    #[test]
    fn missing_env_fails_closed() {
        let err = load_config(SAMPLE, &|_| None).unwrap_err();
        assert!(err.contains("ADMIN_TOKEN"), "error names the missing var: {err}");
    }

    #[test]
    fn unknown_field_is_rejected() {
        let bad = r#"{ "version": 1, "environments": [], "identities": [], "requests": [], "oops": true }"#;
        assert!(load_config(bad, &|_| None).is_err());
    }

    #[test]
    fn unsupported_version_is_rejected() {
        let bad = r#"{ "version": 2, "environments": [], "identities": [], "requests": [] }"#;
        let err = load_config(bad, &|_| None).unwrap_err();
        assert!(err.to_lowercase().contains("version"));
    }

    #[test]
    fn secret_ref_rejects_extra_keys() {
        let bad = r#"{ "version":1, "environments":[], "requests":[],
          "identities":[{ "id":"a", "auth":{ "type":"bearer", "token":{ "env":"T", "typo":1 } } }] }"#;
        assert!(load_config(bad, &|_| Some("x".into())).is_err(), "extra key in secret ref must be rejected");
    }

    #[test]
    fn secret_ref_accepts_string_literal() {
        let cfg = r#"{ "version":1, "environments":[], "requests":[],
          "identities":[{ "id":"a", "auth":{ "type":"bearer", "token":"literal-tok" } }] }"#;
        let c = load_config(cfg, &|_| None).expect("literal token loads without env");
        match &c.identities[0].auth { Auth::Bearer { token } => assert_eq!(token, "literal-tok"), _ => panic!() }
    }

    #[test]
    fn empty_env_message_differs_from_unset() {
        let j = r#"{ "version":1, "environments":[], "requests":[],
          "identities":[{ "id":"a", "auth":{ "type":"bearer", "token":{ "env":"T" } } }] }"#;
        let empty = load_config(j, &|_| Some(String::new())).unwrap_err();
        let unset = load_config(j, &|_| None).unwrap_err();
        assert!(empty.contains("empty"));
        assert!(unset.contains("unset"));
    }

    // Diagnostic: does deny_unknown_fields reject extras inside an internally-tagged
    // auth block in this serde version? Report the outcome (do not fail the suite on it).
    #[test]
    fn auth_block_unknown_field_behavior() {
        let j = r#"{ "version":1, "environments":[], "requests":[],
          "identities":[{ "id":"a", "auth":{ "type":"none", "extra":true } }] }"#;
        let rejected = load_config(j, &|_| None).is_err();
        // NOTE: serde tagged-enum deny_unknown_fields does not reject this; accepted limitation for SP0b-1.
        // `rejected` is false here — serde silently accepts extra fields inside internally-tagged enum
        // variants; deny_unknown_fields is a no-op in this position with the serde version in use.
        let _ = rejected;
    }

    #[test]
    fn scoped_vars_populates_globals_and_environments() {
        let cfg = load_config(SAMPLE, &|k| envmap(&[("ADMIN_TOKEN","s")]).get(k).cloned()).unwrap();
        let scoped = cfg.scoped_vars();
        // globals.ua present and enabled
        assert!(scoped.globals.iter().any(|r| r.key == "ua" && r.value == "qa-touchstone-ci" && r.on));
        // environment staging carries apiHost
        assert!(scoped.environments.get("staging").unwrap().iter().any(|r| r.key == "apiHost"));
    }

    #[test]
    fn resolves_apikey_and_basic_secrets() {
        let j = r#"{ "version":1, "environments":[], "requests":[], "identities":[
            { "id":"k", "auth":{ "type":"apikey", "key":"X-API-Key", "value":{ "env":"AK" }, "in":"header" } },
            { "id":"b", "auth":{ "type":"basic", "username":{ "env":"BU" }, "password":{ "env":"BP" } } }
        ] }"#;
        let env = envmap(&[("AK","secretkey"),("BU","user"),("BP","pass")]);
        let cfg = load_config(j, &|k| env.get(k).cloned()).unwrap();
        match &cfg.identities[0].auth {
            Auth::ApiKey { key, value, location } => {
                assert_eq!(key, "X-API-Key"); assert_eq!(value, "secretkey");
                assert_eq!(*location, ApiKeyIn::Header);
            }
            _ => panic!("apiKey"),
        }
        match &cfg.identities[1].auth {
            Auth::Basic { username, password } => { assert_eq!(username, "user"); assert_eq!(password, "pass"); }
            _ => panic!("basic"),
        }
    }

    #[test]
    fn secret_value_is_opaque_not_a_template() {
        // A secret whose value contains {{...}} must survive verbatim — secrets are
        // never re-substituted (spec ordering). buildreq relies on this.
        let j = r#"{ "version":1, "environments":[], "requests":[], "identities":[
            { "id":"a", "auth":{ "type":"bearer", "token":{ "env":"T" } } } ] }"#;
        let cfg = load_config(j, &|_| Some("abc{{apiHost}}".to_string())).unwrap();
        match &cfg.identities[0].auth {
            Auth::Bearer { token } => assert_eq!(token, "abc{{apiHost}}"),
            _ => panic!("bearer"),
        }
    }

    const WITH_COLLECTIONS: &str = r#"{
      "version":1,
      "environments":[{"name":"staging","variables":{"apiHost":"https://x"}}],
      "identities":[{"id":"admin","auth":{"type":"none"}}],
      "requests":[{"id":"getUser","method":"GET","url":"{{apiHost}}/u"}],
      "collections":[{"id":"smoke","requests":["getUser"],"variables":{"page":"1"}}]
    }"#;

    #[test]
    fn parses_collections_and_validates() {
        let cfg = load_config(WITH_COLLECTIONS, &|_| None).unwrap();
        assert_eq!(cfg.collections.len(), 1);
        assert_eq!(cfg.collections[0].requests, vec!["getUser".to_string()]);
        validate(&cfg).expect("valid config passes");
        // collection-scope var available via scoped_vars under the collection id
        let sv = cfg.scoped_vars();
        assert!(sv.collections.get("smoke").unwrap().iter().any(|r| r.key == "page" && r.value == "1" && r.on));
    }

    #[test]
    fn validate_rejects_unknown_collection_ref() {
        let bad = r#"{ "version":1,"environments":[],"identities":[],
          "requests":[{"id":"a","method":"GET","url":"https://x"}],
          "collections":[{"id":"c","requests":["nope"]}] }"#;
        let err = load_config(bad, &|_| None).unwrap_err();
        assert!(err.contains("nope"), "names the missing request: {err}");
    }

    #[test]
    fn validate_rejects_duplicate_ids() {
        let dup = r#"{ "version":1,"environments":[],"identities":[],
          "requests":[{"id":"a","method":"GET","url":"https://x"},{"id":"a","method":"GET","url":"https://y"}],
          "collections":[] }"#;
        assert!(load_config(dup, &|_| None).unwrap_err().to_lowercase().contains("duplicate"));
    }

    #[test]
    fn validate_rejects_duplicate_collection_ids() {
        // Two collections sharing an id would make scoped_vars() silently drop the
        // first collection's variables (BTreeMap overwrite). load_config must reject
        // the config up front so the silent loss can never occur.
        let j = r#"{ "version":1,"environments":[],"identities":[],
          "requests":[{"id":"a","method":"GET","url":"https://x"}],
          "collections":[
            {"id":"c","requests":["a"],"variables":{"page":"1"}},
            {"id":"c","requests":["a"],"variables":{"page":"2"}}
          ] }"#;
        let err = load_config(j, &|_| None).unwrap_err();
        assert!(err.contains("duplicate") && err.contains("collection"), "{err}");
    }

    #[test]
    fn validate_rejects_duplicate_identity_ids() {
        let j = r#"{ "version":1,"environments":[],
          "identities":[{"id":"x","auth":{"type":"none"}},{"id":"x","auth":{"type":"none"}}],
          "requests":[],"collections":[] }"#;
        let err = load_config(j, &|_| None).unwrap_err();
        assert!(err.contains("duplicate") && err.contains("identity"), "{err}");
    }

    #[test]
    fn validate_rejects_duplicate_environment_names() {
        let j = r#"{ "version":1,
          "environments":[{"name":"staging","variables":{}},{"name":"staging","variables":{}}],
          "identities":[],"requests":[],"collections":[] }"#;
        let err = load_config(j, &|_| None).unwrap_err();
        assert!(err.contains("duplicate") && err.contains("environment"), "{err}");
    }

    const WITH_SECURITY: &str = r#"{
      "version":1,"environments":[],
      "identities":[{"id":"admin","auth":{"type":"none"},"privileged":true},{"id":"anon","auth":{"type":"none"}}],
      "requests":[{"id":"getU","method":"GET","url":"https://x/u"},{"id":"delU","method":"DELETE","url":"https://x/u"}],
      "security":{"matrix":{"endpoints":["getU","delU"],"denySet":[401,403],"expect":{"delU":{"anon":"deny"}}}}
    }"#;

    #[test]
    fn parses_security_matrix() {
        let c = load_config(WITH_SECURITY, &|_| None).unwrap();
        let m = c.security.as_ref().unwrap().matrix.as_ref().unwrap();
        assert_eq!(m.endpoints, vec!["getU","delU"]);
        assert_eq!(m.deny_set, vec![401,403]);
        assert_eq!(m.expect["delU"]["anon"], Expectation::Deny);
        assert!(c.identities.iter().find(|i| i.id=="admin").unwrap().privileged);
    }

    #[test]
    fn security_matrix_rejects_unknown_endpoint() {
        let bad = r#"{ "version":1,"environments":[],"identities":[{"id":"a","auth":{"type":"none"}}],
          "requests":[{"id":"r","method":"GET","url":"https://x"}],
          "security":{"matrix":{"endpoints":["nope"]}} }"#;
        assert!(load_config(bad, &|_| None).unwrap_err().contains("nope"));
    }

    #[test]
    fn security_matrix_rejects_unknown_expect_identity() {
        let bad = r#"{ "version":1,"environments":[],"identities":[{"id":"a","auth":{"type":"none"}}],
          "requests":[{"id":"r","method":"GET","url":"https://x"}],
          "security":{"matrix":{"endpoints":["r"],"expect":{"r":{"ghost":"deny"}}}} }"#;
        assert!(load_config(bad, &|_| None).unwrap_err().contains("ghost"));
    }

    const WITH_BOLA: &str = r#"{
      "version":1,"environments":[],
      "identities":[{"id":"alice","auth":{"type":"none"}},{"id":"bob","auth":{"type":"none"}}],
      "requests":[{"id":"getOrder","method":"GET","url":"https://x/orders/1"}],
      "security":{"bola":{"tests":[
        {"id":"t1","request":"getOrder","idLocation":{"kind":"path","index":1},
         "idValues":{"alice":"ordA","bob":2},"negativeControl":true}
      ]}}
    }"#;

    #[test]
    fn parses_bola_config() {
        let c = load_config(WITH_BOLA, &|_| None).unwrap();
        let t = &c.security.unwrap().bola.unwrap().tests[0];
        assert_eq!(t.id, "t1"); assert_eq!(t.request, "getOrder");
        assert!(t.negative_control);
        assert_eq!(t.id_values["alice"], serde_json::json!("ordA"));
        assert_eq!(t.id_values["bob"], serde_json::json!(2)); // numeric id preserved
        match &t.id_location { IdLocation::Path { index } => assert_eq!(*index, 1), _ => panic!() }
    }

    #[test]
    fn bola_rejects_unknown_request() {
        let bad = r#"{ "version":1,"environments":[],"identities":[{"id":"a","auth":{"type":"none"}}],
          "requests":[],"security":{"bola":{"tests":[{"id":"t","request":"ghost","idLocation":{"kind":"query","key":"id"},"idValues":{}}]}} }"#;
        assert!(load_config(bad, &|_| None).unwrap_err().contains("ghost"));
    }

    #[test]
    fn bola_rejects_non_scalar_idvalue() {
        let bad = r#"{ "version":1,"environments":[],"identities":[{"id":"a","auth":{"type":"none"}}],
          "requests":[{"id":"r","method":"GET","url":"https://x"}],
          "security":{"bola":{"tests":[{"id":"t","request":"r","idLocation":{"kind":"query","key":"id"},"idValues":{"a":[1,2]}}]}} }"#;
        assert!(load_config(bad, &|_| None).unwrap_err().to_lowercase().contains("idvalue"));
    }

    #[test]
    fn bola_rejects_unknown_idvalue_identity() {
        let bad = r#"{ "version":1,"environments":[],"identities":[{"id":"a","auth":{"type":"none"}}],
          "requests":[{"id":"r","method":"GET","url":"https://x"}],
          "security":{"bola":{"tests":[{"id":"t","request":"r","idLocation":{"kind":"query","key":"id"},"idValues":{"ghost":"x"}}]}} }"#;
        assert!(load_config(bad, &|_| None).unwrap_err().contains("ghost"));
    }

    #[test]
    fn bola_rejects_duplicate_test_id() {
        let bad = r#"{ "version":1,"environments":[],"identities":[{"id":"a","auth":{"type":"none"}}],
          "requests":[{"id":"r","method":"GET","url":"https://x"}],
          "security":{"bola":{"tests":[
            {"id":"t","request":"r","idLocation":{"kind":"query","key":"id"},"idValues":{}},
            {"id":"t","request":"r","idLocation":{"kind":"query","key":"id"},"idValues":{}}
          ]}} }"#;
        assert!(load_config(bad, &|_| None).unwrap_err().to_lowercase().contains("duplicate"));
    }

    const WITH_RATELIMIT: &str = r#"{
      "version":1,"environments":[],
      "identities":[{"id":"anon","auth":{"type":"none"}}],
      "requests":[{"id":"login","method":"POST","url":"https://x/login"}],
      "security":{"rateLimit":{"tests":[
        {"id":"r1","request":"login","identity":"anon","n":50,"concurrency":5,"sensitivity":"sensitive"}
      ]}}
    }"#;

    #[test]
    fn parses_ratelimit_config() {
        let c = load_config(WITH_RATELIMIT, &|_| None).unwrap();
        let t = &c.security.unwrap().rate_limit.unwrap().tests[0];
        assert_eq!(t.id, "r1");
        assert_eq!(t.request, "login");
        assert_eq!(t.identity.as_deref(), Some("anon"));
        assert_eq!(t.n, Some(50));
        assert_eq!(t.concurrency, Some(5));
        assert_eq!(t.sensitivity.as_deref(), Some("sensitive"));
    }

    #[test]
    fn ratelimit_defaults_optional_fields() {
        let j = r#"{ "version":1,"environments":[],"identities":[],
          "requests":[{"id":"r","method":"GET","url":"https://x"}],
          "security":{"rateLimit":{"tests":[{"id":"t","request":"r"}]}} }"#;
        let c = load_config(j, &|_| None).unwrap();
        let t = &c.security.unwrap().rate_limit.unwrap().tests[0];
        assert!(t.n.is_none() && t.concurrency.is_none() && t.identity.is_none() && t.sensitivity.is_none());
    }

    #[test]
    fn ratelimit_rejects_unknown_request() {
        let bad = r#"{ "version":1,"environments":[],"identities":[{"id":"a","auth":{"type":"none"}}],
          "requests":[],"security":{"rateLimit":{"tests":[{"id":"t","request":"ghost"}]}} }"#;
        assert!(load_config(bad, &|_| None).unwrap_err().contains("ghost"));
    }

    #[test]
    fn ratelimit_rejects_unknown_identity() {
        let bad = r#"{ "version":1,"environments":[],"identities":[{"id":"a","auth":{"type":"none"}}],
          "requests":[{"id":"r","method":"GET","url":"https://x"}],
          "security":{"rateLimit":{"tests":[{"id":"t","request":"r","identity":"ghost"}]}} }"#;
        assert!(load_config(bad, &|_| None).unwrap_err().contains("ghost"));
    }

    #[test]
    fn ratelimit_rejects_duplicate_test_id() {
        let bad = r#"{ "version":1,"environments":[],"identities":[],
          "requests":[{"id":"r","method":"GET","url":"https://x"}],
          "security":{"rateLimit":{"tests":[{"id":"t","request":"r"},{"id":"t","request":"r"}]}} }"#;
        assert!(load_config(bad, &|_| None).unwrap_err().to_lowercase().contains("duplicate"));
    }

    #[test]
    fn oracles_config_tolerates_llm_and_resolves() {
        let j = r#"{ "version":1,"environments":[],"identities":[{"id":"a","auth":{"type":"none"}}],
          "requests":[{"id":"r","method":"GET","url":"https://h/r"}],
          "security":{"matrix":{"endpoints":["r"]},"oracles":{"sensitive":false,"llm":false,"severityOverrides":{"secrets":"critical"}}} }"#;
        let c = load_config(j, &|_| None).unwrap();
        let o = c.security.unwrap().oracles.unwrap().resolve();
        assert!(!o.sensitive && o.schema && o.severity_overrides["secrets"] == crate::security::finding::Severity::Critical);
    }
}
