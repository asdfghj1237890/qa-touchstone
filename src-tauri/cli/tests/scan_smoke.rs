use std::io::Write;
use std::process::Command;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
}
fn write_temp(name: &str, c: &str) -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("qa_scan_{}_{}", std::process::id(), name));
    std::fs::File::create(&p)
        .unwrap()
        .write_all(c.as_bytes())
        .unwrap();
    p
}

#[tokio::test]
async fn scan_matrix_vuln_exits_3() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/s"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let cfg = write_temp(
        "v.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"s","method":"GET","url":"{base}/s"}}],
      "security":{{"matrix":{{"endpoints":["s"]}}}} }}"#,
            base = server.uri()
        ),
    );
    let out = bin()
        .args(["scan", "--config", cfg.to_str().unwrap(), "--json"])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(3),
        "anon-allowed = vuln >= high → exit 3"
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("matrix.deny-bypass"));
}

#[tokio::test]
async fn scan_all_pass_exits_0() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/s"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let cfg = write_temp(
        "p.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"s","method":"GET","url":"{base}/s"}}],
      "security":{{"matrix":{{"endpoints":["s"]}}}} }}"#,
            base = server.uri()
        ),
    );
    let out = bin()
        .args(["scan", "--config", cfg.to_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "anon denied = pass → exit 0");
}

#[test]
fn scan_no_security_block_exits_2() {
    let cfg = write_temp(
        "n.json",
        r#"{ "version":1,"environments":[],"identities":[],"requests":[] }"#,
    );
    let out = bin()
        .args(["scan", "--config", cfg.to_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
}

#[tokio::test]
async fn scan_redacts_identity_secret() {
    // A bearer-token identity that is ALLOWED on a deny-expected endpoint → vuln finding;
    // assert the token never appears in output (evidence/path/identity all redacted).
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/u"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let cfg = write_temp(
        "r.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"lowpriv","auth":{{"type":"bearer","token":"SUPERSECRET"}}}}],
      "requests":[{{"id":"del","method":"DELETE","url":"{base}/u"}}],
      "security":{{"matrix":{{"endpoints":["del"],"expect":{{"del":{{"lowpriv":"deny"}}}}}}}} }}"#,
            base = server.uri()
        ),
    );
    let out = bin()
        .args(["scan", "--config", cfg.to_str().unwrap(), "--json"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(3));
    assert!(
        !String::from_utf8_lossy(&out.stdout).contains("SUPERSECRET"),
        "identity secret must be redacted"
    );
}

#[tokio::test]
async fn scan_request_error_exits_1() {
    // No findings, but a request couldn't execute → exit 1 (scan incomplete), NOT exit 0.
    let cfg = write_temp(
        "err.json",
        r#"{ "version":1,"environments":[],
      "identities":[{"id":"anon","auth":{"type":"none"}}],
      "requests":[{"id":"down","method":"GET","url":"http://127.0.0.1:1/x"}],
      "security":{"matrix":{"endpoints":["down"]}} }"#,
    );
    let out = bin()
        .args(["scan", "--config", cfg.to_str().unwrap(), "--json"])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(1),
        "a non-run must not report clean (exit 0)"
    );
    let s = String::from_utf8_lossy(&out.stdout);
    assert!(s.contains("\"errors\""), "engines/errors surfaced in JSON");
}

#[tokio::test]
async fn scan_out_file_written_and_redacted() {
    // --out writes the same redacted report to a file.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/s"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let cfg = write_temp(
        "o.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"s","method":"GET","url":"{base}/s"}}],
      "security":{{"matrix":{{"endpoints":["s"]}}}} }}"#,
            base = server.uri()
        ),
    );
    let outfile = write_temp("findings.json", "");
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--out",
            outfile.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(3));
    let written = std::fs::read_to_string(&outfile).unwrap();
    assert!(
        written.contains("matrix.deny-bypass"),
        "findings written to --out file"
    );
}

async fn idor_server() -> MockServer {
    let s = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(|req: &wiremock::Request| {
            let seg = req
                .url
                .path_segments()
                .and_then(|mut p| {
                    p.next();
                    p.next()
                })
                .unwrap_or("")
                .to_string();
            ResponseTemplate::new(200).set_body_string(format!("{{\"id\":\"{}\"}}", seg))
        })
        .mount(&s)
        .await;
    s
}

#[tokio::test]
async fn scan_bola_vuln_exits_3() {
    let s = idor_server().await;
    let cfg = write_temp(
        "bv.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"alice","auth":{{"type":"none"}}}},{{"id":"bob","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"getOrder","method":"GET","url":"{base}/orders/PLACEHOLDER"}}],
      "security":{{"bola":{{"tests":[{{"id":"t1","request":"getOrder","idLocation":{{"kind":"path","index":1}},
        "idValues":{{"alice":"ordA","bob":"ordB"}}}}]}}}} }}"#,
            base = s.uri()
        ),
    );
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--engine",
            "bola",
            "--json",
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(3),
        "cross-object access = vuln >= high → exit 3"
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("bola.cross-object"));
    // idValue must NOT leak (masked at evidence construction)
    assert!(
        !stdout.contains("ordA") && !stdout.contains("ordB"),
        "idValue leaked: {stdout}"
    );
}

#[tokio::test]
async fn scan_bola_denied_exits_0() {
    let s = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&s)
        .await;
    let cfg = write_temp(
        "bd.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"alice","auth":{{"type":"none"}}}},{{"id":"bob","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"getOrder","method":"GET","url":"{base}/orders/PLACEHOLDER"}}],
      "security":{{"bola":{{"tests":[{{"id":"t1","request":"getOrder","idLocation":{{"kind":"path","index":1}},
        "idValues":{{"alice":"ordA","bob":"ordB"}}}}]}}}} }}"#,
            base = s.uri()
        ),
    );
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--engine",
            "bola",
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "403 → pass → exit 0");
}

#[tokio::test]
async fn scan_ratelimit_vuln_exits_3() {
    // sensitive endpoint with NO throttling → ratelimit.none High → exit 3.
    let s = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&s)
        .await;
    let cfg = write_temp(
        "rv.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"login","method":"POST","url":"{base}/login"}}],
      "security":{{"rateLimit":{{"tests":[{{"id":"r1","request":"login","identity":"anon","n":6,"concurrency":2,"sensitivity":"sensitive"}}]}}}} }}"#,
            base = s.uri()
        ),
    );
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--engine",
            "ratelimit",
            "--json",
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(3),
        "no protection on a sensitive endpoint → High → exit 3"
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("ratelimit.none"));
}

#[tokio::test]
async fn scan_ratelimit_throttled_exits_0() {
    // immediate 429 → strong protection → no finding → exit 0.
    let s = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429))
        .mount(&s)
        .await;
    let cfg = write_temp(
        "rt.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"login","method":"POST","url":"{base}/login"}}],
      "security":{{"rateLimit":{{"tests":[{{"id":"r1","request":"login","identity":"anon","n":6,"concurrency":2,"sensitivity":"sensitive"}}]}}}} }}"#,
            base = s.uri()
        ),
    );
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--engine",
            "ratelimit",
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "strong throttling → exit 0");
}

#[tokio::test]
async fn scan_writes_html_and_junit() {
    let s = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/s"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&s)
        .await;
    let cfg = write_temp(
        "hj.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"lp","auth":{{"type":"bearer","token":"SUPERSECRET"}}}}],
      "requests":[{{"id":"s","method":"GET","url":"{base}/s"}}],
      "security":{{"matrix":{{"endpoints":["s"],"expect":{{"s":{{"lp":"deny"}}}}}}}} }}"#,
            base = s.uri()
        ),
    );
    let html = write_temp("o.html", "");
    let junit = write_temp("o.xml", "");
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--html",
            html.to_str().unwrap(),
            "--junit",
            junit.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(3), "anon-bypass vuln High → exit 3");
    let h = std::fs::read_to_string(&html).unwrap();
    assert!(
        h.contains("<!doctype html>") && h.contains("matrix.deny-bypass"),
        "html has doctype + rule id"
    );
    let x = std::fs::read_to_string(&junit).unwrap();
    roxmltree::Document::parse(&x).expect("valid JUnit XML");
    assert!(
        x.contains("<failure"),
        "a new High finding is a JUnit failure"
    );
    assert!(
        !h.contains("SUPERSECRET") && !x.contains("SUPERSECRET"),
        "secret must not leak into HTML/JUnit"
    );
}

#[tokio::test]
async fn scan_annotations_suppress_and_override() {
    let s = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/s"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&s)
        .await;
    let cfg = write_temp(
        "ann.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"lp","auth":{{"type":"bearer","token":"SUPERSECRET"}}}}],
      "requests":[{{"id":"s","method":"GET","url":"{base}/s"}}],
      "security":{{"matrix":{{"endpoints":["s"],"expect":{{"s":{{"lp":"deny"}}}}}}}} }}"#,
            base = s.uri()
        ),
    );
    // 1) baseline run: anon-bypass High -> exit 3; capture the fp from --json output.
    let out = bin()
        .args(["scan", "--config", cfg.to_str().unwrap(), "--json"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(3));
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let fp = v["findings"][0]["fp"]
        .as_str()
        .expect("fp in json output")
        .to_string();
    // 2) suppress that fp -> exit 0 + JUnit <skipped> + SARIF suppressions + no secret leak.
    let ann = write_temp(
        "a.json",
        &format!(
            r#"{{"fpVersion":1,"records":{{"{fp}":{{"suppressed":true,"suppressReason":"accepted"}}}}}}"#
        ),
    );
    let junit = write_temp("annsupp.xml", "");
    let sarif = write_temp("annsupp.sarif", "");
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--annotations",
            ann.to_str().unwrap(),
            "--junit",
            junit.to_str().unwrap(),
            "--sarif",
            sarif.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "suppressed finding must not gate"
    );
    let x = std::fs::read_to_string(&junit).unwrap();
    assert!(
        x.contains("<skipped") && !x.contains("<failure"),
        "suppressed -> <skipped>"
    );
    let sf = std::fs::read_to_string(&sarif).unwrap();
    assert!(sf.contains("\"suppressions\"") && sf.contains("accepted"));
    assert!(
        !x.contains("SUPERSECRET") && !sf.contains("SUPERSECRET"),
        "secret must not leak"
    );
    // 3) severityOverride high->low also un-gates.
    let ann2 = write_temp(
        "a2.json",
        &format!(r#"{{"fpVersion":1,"records":{{"{fp}":{{"severityOverride":"low"}}}}}}"#),
    );
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--annotations",
            ann2.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "downgraded finding must not gate at fail_on=high"
    );
}

#[tokio::test]
async fn scan_oracle_sensitive_jwt_exits_3() {
    // An ALLOWED 200 whose body leaks a JWT → an oracle sensitive-data finding (High) → gate (exit 3).
    let s = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/u"))
        .respond_with(ResponseTemplate::new(200).set_body_string(
            r#"{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4In0.abcdEFsig"}"#,
        ))
        .mount(&s)
        .await;
    let cfg = write_temp(
        "orc.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"u","method":"GET","url":"{base}/u"}}],
      "security":{{"matrix":{{"endpoints":["u"],"expect":{{"u":{{"anon":"allow"}}}}}}}} }}"#,
            base = s.uri()
        ),
    );
    let out = bin()
        .args(["scan", "--config", cfg.to_str().unwrap(), "--json"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(3), "a new high jwt leak gates");
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let fs = v["findings"].as_array().unwrap();
    let jwt = fs
        .iter()
        .find(|f| f["rule_id"] == "jwt")
        .expect("jwt finding present");
    assert_eq!(jwt["engine"], "oracle");
    assert_eq!(jwt["oracle"], "sensitive-data");
    assert!(
        jwt["evidence"].as_str().unwrap().contains("…<redacted>…"),
        "evidence must be masked"
    );
    assert!(
        !String::from_utf8_lossy(&out.stdout).contains("abcdEFsig"),
        "raw JWT must not leak anywhere in output"
    );
}

#[tokio::test]
async fn scan_oracles_disabled_no_finding() {
    // Same leaky body, but oracles disabled via config ⇒ no oracle finding ⇒ exit 0.
    let s = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/u"))
        .respond_with(ResponseTemplate::new(200).set_body_string(
            r#"{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4In0.abcdEFsig"}"#,
        ))
        .mount(&s)
        .await;
    let cfg = write_temp(
        "orcoff.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"u","method":"GET","url":"{base}/u"}}],
      "security":{{"matrix":{{"endpoints":["u"],"expect":{{"u":{{"anon":"allow"}}}}}},"oracles":{{"sensitive":false,"schema":false}}}} }}"#,
            base = s.uri()
        ),
    );
    let out = bin()
        .args(["scan", "--config", cfg.to_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "oracles disabled ⇒ no jwt finding ⇒ exit 0"
    );
}

#[tokio::test]
async fn scan_oracle_secret_as_key_not_leaked() {
    // A secret used as a JSON object KEY (with a JWT child) must NOT leak into JSON or SARIF output.
    let s = MockServer::start().await;
    Mock::given(method("GET")).and(path("/u")).respond_with(ResponseTemplate::new(200)
        .set_body_string(r#"{"AKIAIOSFODNN7EXAMPLE":{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4In0.abcdEFsig"}}"#)).mount(&s).await;
    let cfg = write_temp(
        "orckey.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"u","method":"GET","url":"{base}/u"}}],
      "security":{{"matrix":{{"endpoints":["u"],"expect":{{"u":{{"anon":"allow"}}}}}}}} }}"#,
            base = s.uri()
        ),
    );
    let sarif = write_temp("orckey.sarif", "");
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--sarif",
            sarif.to_str().unwrap(),
            "--json",
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(3),
        "the JWT child of a secret-named key still gates"
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    let sf = std::fs::read_to_string(&sarif).unwrap();
    for sink in [stdout.as_ref(), sf.as_str()] {
        assert!(
            !sink.contains("AKIAIOSFODNN7EXAMPLE"),
            "secret-as-key must not leak into JSON/SARIF: {sink}"
        );
        assert!(
            !sink.contains("abcdEFsig"),
            "raw JWT value must not leak into JSON/SARIF"
        );
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let jwt = v["findings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["rule_id"] == "jwt")
        .expect("jwt finding present");
    assert_eq!(jwt["engine"], "oracle");
    assert!(
        jwt["path"].as_str().unwrap().contains("…<redacted>…"),
        "the secret-as-key in the path must be redacted"
    );
}

// ── BFLA smokes ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn scan_bfla_vuln_exits_3() {
    // A privileged endpoint (explicit privileged:true) reached (200) by a non-privileged
    // identity with security.bfla:{} ⇒ exit 3 + engine:"bfla" finding.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/admin/secret"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let cfg = write_temp(
        "bfv.json",
        &format!(
            r#"{{
      "version":1,"environments":[],
      "identities":[
        {{"id":"admin","auth":{{"type":"bearer","token":"ADMIN-TOK"}},"privileged":true}},
        {{"id":"anon","auth":{{"type":"none"}}}}
      ],
      "requests":[{{"id":"getSecret","method":"GET","url":"{base}/admin/secret","privileged":true}}],
      "security":{{"bfla":{{}}}}
    }}"#,
            base = server.uri()
        ),
    );
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--engine",
            "bfla",
            "--json",
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(3),
        "privileged endpoint reached by anon => vuln => exit 3"
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(&stdout).expect("valid JSON output");
    assert!(
        v["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["engine"] == "bfla"),
        "must have a bfla finding: {stdout}"
    );
    assert!(
        !stdout.contains("ADMIN-TOK"),
        "admin token must not appear in output"
    );
}

#[tokio::test]
async fn scan_bfla_denied_exits_0() {
    // Same setup but mock returns 403 ⇒ pass ⇒ exit 0, no bfla finding.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/admin/secret"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let cfg = write_temp(
        "bfd.json",
        &format!(
            r#"{{
      "version":1,"environments":[],
      "identities":[
        {{"id":"admin","auth":{{"type":"bearer","token":"ADMIN-TOK"}},"privileged":true}},
        {{"id":"anon","auth":{{"type":"none"}}}}
      ],
      "requests":[{{"id":"getSecret","method":"GET","url":"{base}/admin/secret","privileged":true}}],
      "security":{{"bfla":{{}}}}
    }}"#,
            base = server.uri()
        ),
    );
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--engine",
            "bfla",
            "--json",
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "403 denied ⇒ pass ⇒ exit 0");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(&stdout).expect("valid JSON output");
    assert!(
        v["findings"].as_array().unwrap().is_empty(),
        "no findings on pass: {stdout}"
    );
}

#[tokio::test]
async fn scan_bfla_secret_never_leaks() {
    // The bearer token sits on the NON-privileged attacker identity — the one BFLA actually
    // exercises (privileged identities are skipped), so the token IS sent by the runner. Assert it
    // never surfaces in --json output (findings are config-id-only + the union RedactionSet applies).
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/admin/resource"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let cfg = write_temp(
        "bfl.json",
        &format!(
            r#"{{
      "version":1,"environments":[],
      "identities":[
        {{"id":"attacker","auth":{{"type":"bearer","token":"SUPERSECRET-BFLA"}},"privileged":false}}
      ],
      "requests":[{{"id":"delAdmin","method":"DELETE","url":"{base}/admin/resource","privileged":true}}],
      "security":{{"bfla":{{}}}}
    }}"#,
            base = server.uri()
        ),
    );
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--engine",
            "bfla",
            "--json",
        ])
        .output()
        .unwrap();
    // Should be exit 3 (DELETE vuln = Critical >= High threshold)
    assert_eq!(
        out.status.code(),
        Some(3),
        "DELETE allowed by anon on privileged endpoint => exit 3"
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !stdout.contains("SUPERSECRET-BFLA"),
        "bearer token must be redacted from JSON output: {stdout}"
    );
}

#[tokio::test]
async fn scan_bfla_no_config_block_no_finding() {
    // When there is no security.bfla block, --engine bfla produces zero findings and exits 0.
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/admin/resource"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let cfg = write_temp(
        "bfn.json",
        &format!(
            r#"{{
      "version":1,"environments":[],
      "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
      "requests":[{{"id":"delAdmin","method":"DELETE","url":"{base}/admin/resource"}}],
      "security":{{"matrix":{{"endpoints":[]}}}}
    }}"#,
            base = server.uri()
        ),
    );
    // --engine bfla with no security.bfla block: run_bfla returns empty immediately.
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--engine",
            "bfla",
            "--json",
        ])
        .output()
        .unwrap();
    // engine row is pushed (ran:true) but findings = 0; no HTTP calls made; exit 0.
    assert_eq!(
        out.status.code(),
        Some(0),
        "no security.bfla block => no findings => exit 0"
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(&stdout).expect("valid JSON output");
    assert!(
        v["findings"].as_array().unwrap().is_empty(),
        "no bfla findings without config block"
    );
}
