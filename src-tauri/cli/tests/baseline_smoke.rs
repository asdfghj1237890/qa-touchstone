use std::io::Write;
use std::process::Command;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
}
fn write_temp(name: &str, c: &str) -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("qa_bl_{}_{}", std::process::id(), name));
    std::fs::File::create(&p)
        .unwrap()
        .write_all(c.as_bytes())
        .unwrap();
    p
}
fn matrix_cfg(base: &str) -> String {
    format!(
        r#"{{ "version":1,"environments":[],
  "identities":[{{"id":"anon","auth":{{"type":"none"}}}}],
  "requests":[{{"id":"s","method":"GET","url":"{base}/s"}}],
  "security":{{"matrix":{{"endpoints":["s"]}}}} }}"#
    )
}

#[tokio::test]
async fn baseline_new_gates_carried_passes() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/s"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await; // anon-allowed = vuln (High)
    let cfg = write_temp("bn.json", &matrix_cfg(&server.uri()));
    let bl = write_temp("base.json", ""); // empty file => empty baseline (all New)
                                          // First run: finding is NEW => exit 3
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--baseline",
            bl.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(3),
        "new finding gates: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    // Bless: write current as baseline => exit 0
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--baseline",
            bl.to_str().unwrap(),
            "--update-baseline",
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "bless writes + exits 0: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    // Re-run vs the blessed baseline: CARRIED => exit 0
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--baseline",
            bl.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "carried finding does not gate: {}",
        String::from_utf8_lossy(&out.stdout)
    );
}

#[tokio::test]
async fn sarif_written_with_fingerprint() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/s"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let cfg = write_temp("sa.json", &matrix_cfg(&server.uri()));
    let sarif = write_temp("out.sarif", "");
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--sarif",
            sarif.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(3));
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&sarif).unwrap()).unwrap();
    assert_eq!(v["version"], "2.1.0");
    assert_eq!(v["runs"][0]["results"][0]["baselineState"], "new");
    assert!(v["runs"][0]["results"][0]["partialFingerprints"]["qaFingerprint"].is_string());
}

#[tokio::test]
async fn update_baseline_refuses_on_error() {
    // unreachable host => engine error => --update-baseline must NOT write, exit 1
    let cfg = write_temp(
        "er.json",
        r#"{ "version":1,"environments":[],
      "identities":[{"id":"anon","auth":{"type":"none"}}],
      "requests":[{"id":"down","method":"GET","url":"http://127.0.0.1:1/x"}],
      "security":{"matrix":{"endpoints":["down"]}} }"#,
    );
    let bl = write_temp("ne.json", "");
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--baseline",
            bl.to_str().unwrap(),
            "--update-baseline",
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(1),
        "engine error => no bless, exit 1"
    );
    assert!(
        std::fs::read_to_string(&bl).unwrap().is_empty(),
        "baseline not written on error"
    );
}

#[tokio::test]
async fn baseline_secret_is_redacted() {
    // a bearer-token identity allowed on a deny-expected endpoint => vuln; the blessed baseline must not contain the secret.
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/u"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let cfg = write_temp(
        "rl.json",
        &format!(
            r#"{{ "version":1,"environments":[],
      "identities":[{{"id":"lp","auth":{{"type":"bearer","token":"SUPERSECRET"}}}}],
      "requests":[{{"id":"del","method":"DELETE","url":"{base}/u"}}],
      "security":{{"matrix":{{"endpoints":["del"],"expect":{{"del":{{"lp":"deny"}}}}}}}} }}"#,
            base = server.uri()
        ),
    );
    let bl = write_temp("sec.json", "");
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--baseline",
            bl.to_str().unwrap(),
            "--update-baseline",
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "bless exits 0: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        !std::fs::read_to_string(&bl)
            .unwrap()
            .contains("SUPERSECRET"),
        "secret must never reach the baseline file"
    );
}

#[tokio::test]
async fn update_baseline_refuses_with_engine_filter() {
    // A single-engine bless would write a PARTIAL baseline (missing the other engines' findings),
    // which the next full run would then flag as new => refuse the combo (exit 2), don't write.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/s"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let cfg = write_temp("ef.json", &matrix_cfg(&server.uri()));
    let bl = write_temp("ef_base.json", "");
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--baseline",
            bl.to_str().unwrap(),
            "--update-baseline",
            "--engine",
            "matrix",
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(2),
        "--engine + --update-baseline must be rejected: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        std::fs::read_to_string(&bl).unwrap().is_empty(),
        "baseline not written when refused"
    );
}

#[tokio::test]
async fn unreadable_baseline_is_input_error() {
    // A baseline path that EXISTS but can't be read as a file (a directory) is NOT 'absent' —
    // it must be a bad-input error (exit 2), never a silent bootstrap.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/s"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let cfg = write_temp("ub.json", &matrix_cfg(&server.uri()));
    let mut dir = std::env::temp_dir();
    dir.push(format!("qa_bl_dir_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let out = bin()
        .args([
            "scan",
            "--config",
            cfg.to_str().unwrap(),
            "--baseline",
            dir.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(2),
        "unreadable (directory) baseline => exit 2, not bootstrap"
    );
}
