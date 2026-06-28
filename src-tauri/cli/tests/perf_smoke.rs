use std::io::Write;
use std::process::Command;

fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_qa-touchstone-ci"))
}

fn write_temp(name: &str, contents: &str) -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("qa_perf_{}_{}", std::process::id(), name));
    let mut f = std::fs::File::create(&p).unwrap();
    f.write_all(contents.as_bytes()).unwrap();
    p
}

fn config_json() -> String {
    r#"{
      "version":1,
      "environments":[{"name":"ci","variables":{"baseUrl":"https://api.example.test"}}],
      "identities":[
        {"id":"api","auth":{"type":"apikey","key":"X-API-Key","value":"SECRET-PERF-KEY","in":"header"}}
      ],
      "requests":[
        {"id":"perf","method":"POST","url":"{{baseUrl}}/perf","body":{"mode":"json","content":"{\"ok\":true}"}}
      ],
      "collections":[{"id":"perf-suite","requests":["perf"],"variables":{"tenant":"acme"}}]
    }"#
    .to_string()
}

#[test]
fn perf_missing_k6_exits_1_json() {
    let cfg = write_temp("missing.json", &config_json());
    let missing = std::env::temp_dir().join(format!("missing-k6-{}", std::process::id()));
    let out = bin()
        .args([
            "perf",
            "--config",
            cfg.to_str().unwrap(),
            "--request",
            "perf",
            "--identity",
            "api",
            "--env",
            "ci",
            "--k6-bin",
            missing.to_str().unwrap(),
            "--json",
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("\"ok\":false"));
    assert!(stdout.contains("was not found"));
}

#[cfg(not(target_os = "windows"))]
#[test]
fn perf_runs_fake_k6_and_writes_outputs() {
    let cfg = write_temp("ok.json", &config_json());
    let fake = write_temp(
        "fake-k6.sh",
        r#"#!/bin/sh
set -eu
summary=""
last=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--summary-export" ]; then
    shift
    summary="$1"
  fi
  last="$1"
  shift
done
if [ -n "$summary" ]; then
  printf '{"metrics":{"http_reqs":{"count":1}}}\n' > "$summary"
fi
printf 'fake k6 ran %s\n' "$last"
exit 0
"#,
    );
    let mut perms = std::fs::metadata(&fake).unwrap().permissions();
    use std::os::unix::fs::PermissionsExt;
    perms.set_mode(0o755);
    std::fs::set_permissions(&fake, perms).unwrap();

    let script = write_temp("out.js", "");
    let summary = write_temp("summary.json", "");
    let out = bin()
        .args([
            "perf",
            "--config",
            cfg.to_str().unwrap(),
            "--request",
            "perf",
            "--identity",
            "api",
            "--env",
            "ci",
            "--collection",
            "perf-suite",
            "--stage",
            "1s:2",
            "--stage",
            "2s:0",
            "--no-keepalive",
            "--timeout-ms",
            "5000",
            "--k6-bin",
            fake.to_str().unwrap(),
            "--script-out",
            script.to_str().unwrap(),
            "--summary-out",
            summary.to_str().unwrap(),
            "--json",
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("\"ok\":true"));
    assert!(stdout.contains("fake k6 ran"));
    assert!(
        !stdout.contains("SECRET-PERF-KEY"),
        "secret must not appear in perf JSON output: {stdout}"
    );

    let script_text = std::fs::read_to_string(script).unwrap();
    assert!(script_text.contains("noConnectionReuse: true"));
    assert!(script_text.contains("{ duration: \"1s\", target: 2 }"));
    assert!(script_text.contains("{ duration: \"2s\", target: 0 }"));
    assert!(script_text.contains("\"X-API-Key\":\"SECRET-PERF-KEY\""));
    assert!(script_text.contains("http.request(\"POST\""));

    let summary_text = std::fs::read_to_string(summary).unwrap();
    assert!(summary_text.contains("http_reqs"));
}
