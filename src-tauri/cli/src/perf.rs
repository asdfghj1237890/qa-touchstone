//! `perf` command: generate a k6 script from one configured request and run it
//! through a k6 binary already installed on the CI runner.
use qa_touchstone_core::buildreq::build_request;
use qa_touchstone_core::config::load_config;
use qa_touchstone_core::engine::{qa_var_map, RealDynamics};
use qa_touchstone_core::redact::RedactionSet;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

#[derive(Debug, Clone, PartialEq, Eq)]
struct Stage {
    duration: String,
    target: u32,
}

#[derive(Debug, Clone)]
struct PerfRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub async fn run_perf(
    config_path: String,
    request_id: String,
    identity_id: String,
    env_name: Option<String>,
    collection_id: Option<String>,
    stage_args: Vec<String>,
    k6_bin: Option<String>,
    script_out: Option<String>,
    summary_out: Option<String>,
    use_json: bool,
    no_keepalive: bool,
    timeout_ms: u64,
) -> ExitCode {
    let text = match std::fs::read_to_string(&config_path) {
        Ok(t) => t,
        Err(e) => {
            return input_error(use_json, format!("cannot read config `{config_path}`: {e}"));
        }
    };
    let cfg = match load_config(&text, &|k| std::env::var(k).ok()) {
        Ok(c) => c,
        Err(e) => return input_error(use_json, format!("invalid config: {e}")),
    };
    let req = match cfg.requests.iter().find(|r| r.id == request_id) {
        Some(r) => r,
        None => return input_error(use_json, format!("no request with id `{request_id}`")),
    };
    let identity = match cfg.identities.iter().find(|i| i.id == identity_id) {
        Some(i) => i,
        None => return input_error(use_json, format!("no identity with id `{identity_id}`")),
    };
    if let Some(ref name) = env_name {
        if !cfg.environments.iter().any(|e| &e.name == name) {
            return input_error(use_json, format!("no environment named `{name}`"));
        }
    }
    if let Some(ref id) = collection_id {
        match cfg.collections.iter().find(|c| &c.id == id) {
            Some(c) if c.requests.iter().any(|r| r == &request_id) => {}
            Some(_) => {
                return input_error(
                    use_json,
                    format!("collection `{id}` does not include request `{request_id}`"),
                )
            }
            None => return input_error(use_json, format!("no collection with id `{id}`")),
        }
    }
    let stages = match parse_stages(&stage_args) {
        Ok(s) => s,
        Err(e) => return input_error(use_json, e),
    };

    let red = RedactionSet::from_auth(&identity.auth);
    let scoped = cfg.scoped_vars();
    let map = qa_var_map(&scoped, env_name.as_deref(), collection_id.as_deref(), None);
    let rd = match build_request(req, identity, &map, &mut RealDynamics) {
        Ok(v) => v,
        Err(e) => return input_error(use_json, red.redact_str(&e)),
    };
    let perf_req = match perf_request_from_payload(&rd) {
        Ok(r) => r,
        Err(e) => return input_error(use_json, e),
    };
    let script = build_k6_script(&perf_req, &stages, !no_keepalive, timeout_ms);
    let script_path = match materialize_script(script_out.as_deref(), &script) {
        Ok(p) => p,
        Err(e) => return runtime_error(use_json, format!("cannot write k6 script: {e}")),
    };
    if let Some(path) = summary_out.as_deref() {
        if let Err(e) = ensure_parent(path) {
            cleanup_temp_script(script_out.as_deref(), &script_path);
            return runtime_error(use_json, format!("cannot create summary directory: {e}"));
        }
    }

    let bin = k6_bin.unwrap_or_else(|| "k6".to_string());
    let mut cmd = k6_command(&bin);
    cmd.arg("run");
    if let Some(path) = summary_out.as_deref() {
        cmd.arg("--summary-export").arg(path);
    }
    cmd.arg(&script_path);

    let exit = if use_json {
        match cmd.output() {
            Ok(output) => {
                let code = output.status.code().unwrap_or(1);
                let ok = output.status.success();
                print_perf_json(PerfJson {
                    ok,
                    request_id: &request_id,
                    identity_id: &identity_id,
                    env_name: env_name.as_deref(),
                    collection_id: collection_id.as_deref(),
                    url: &red.redact_str(&perf_req.url),
                    stages: &stages,
                    script_out: script_out.as_deref(),
                    summary_out: summary_out.as_deref(),
                    k6_exit_code: Some(code),
                    stdout: Some(&red.redact_str(&String::from_utf8_lossy(&output.stdout))),
                    stderr: Some(&red.redact_str(&String::from_utf8_lossy(&output.stderr))),
                    error: None,
                });
                if ok {
                    ExitCode::SUCCESS
                } else {
                    ExitCode::from(4)
                }
            }
            Err(e) => {
                let msg = k6_spawn_error(&bin, e);
                print_perf_json(PerfJson {
                    ok: false,
                    request_id: &request_id,
                    identity_id: &identity_id,
                    env_name: env_name.as_deref(),
                    collection_id: collection_id.as_deref(),
                    url: &red.redact_str(&perf_req.url),
                    stages: &stages,
                    script_out: script_out.as_deref(),
                    summary_out: summary_out.as_deref(),
                    k6_exit_code: None,
                    stdout: None,
                    stderr: None,
                    error: Some(&msg),
                });
                ExitCode::from(1)
            }
        }
    } else {
        println!(
            "k6 {} {} as {}",
            perf_req.method,
            red.redact_str(&perf_req.url),
            identity_id
        );
        match cmd.status() {
            Ok(status) if status.success() => ExitCode::SUCCESS,
            Ok(status) => {
                eprintln!("error: k6 exited with code {}", status.code().unwrap_or(1));
                ExitCode::from(4)
            }
            Err(e) => {
                eprintln!("error: {}", k6_spawn_error(&bin, e));
                ExitCode::from(1)
            }
        }
    };
    cleanup_temp_script(script_out.as_deref(), &script_path);
    exit
}

fn input_error(use_json: bool, message: String) -> ExitCode {
    if use_json {
        println!("{}", json!({ "ok": false, "error": message }));
    } else {
        eprintln!("error: {message}");
    }
    ExitCode::from(2)
}

fn runtime_error(use_json: bool, message: String) -> ExitCode {
    if use_json {
        println!("{}", json!({ "ok": false, "error": message }));
    } else {
        eprintln!("error: {message}");
    }
    ExitCode::from(1)
}

fn parse_stages(stage_args: &[String]) -> Result<Vec<Stage>, String> {
    let raw = if stage_args.is_empty() {
        vec!["30s:1".to_string()]
    } else {
        stage_args.to_vec()
    };
    raw.iter().map(|s| parse_stage(s)).collect()
}

fn parse_stage(raw: &str) -> Result<Stage, String> {
    let (duration, target) = raw
        .split_once(':')
        .ok_or_else(|| format!("invalid --stage `{raw}`; expected DURATION:VUS, e.g. 30s:10"))?;
    let duration = duration.trim();
    if duration.is_empty() {
        return Err(format!("invalid --stage `{raw}`; duration is empty"));
    }
    let target = target
        .trim()
        .parse::<u32>()
        .map_err(|_| format!("invalid --stage `{raw}`; VUS must be a non-negative integer"))?;
    Ok(Stage {
        duration: duration.to_string(),
        target,
    })
}

fn perf_request_from_payload(payload: &Value) -> Result<PerfRequest, String> {
    let req = payload
        .get("request")
        .ok_or_else(|| "built request payload is missing `request`".to_string())?;
    let method = req
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_ascii_uppercase();
    let url = req
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "built request payload is missing request.url".to_string())?
        .to_string();
    let headers = req
        .get("header")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|h| {
                    let key = h.get("key")?.as_str()?;
                    if key.is_empty() {
                        return None;
                    }
                    let value = h.get("value").and_then(|v| v.as_str()).unwrap_or("");
                    Some((key.to_string(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    let body = req
        .get("body")
        .and_then(|b| b.get("raw"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    Ok(PerfRequest {
        method,
        url,
        headers,
        body,
    })
}

fn build_k6_script(
    req: &PerfRequest,
    stages: &[Stage],
    keep_alive: bool,
    timeout_ms: u64,
) -> String {
    let no_body_methods = ["GET", "HEAD", "OPTIONS"];
    let has_body = req
        .body
        .as_ref()
        .map(|b| !b.is_empty() && !no_body_methods.contains(&req.method.as_str()))
        .unwrap_or(false);
    let mut headers = Map::new();
    for (key, value) in &req.headers {
        headers.insert(key.clone(), Value::String(value.clone()));
    }
    if has_body
        && !headers
            .keys()
            .any(|k| k.eq_ignore_ascii_case("content-type"))
    {
        headers.insert(
            "Content-Type".to_string(),
            Value::String("application/json".to_string()),
        );
    }
    let timeout_sec = std::cmp::max(1, timeout_ms / 1000);
    let stage_js = stages
        .iter()
        .map(|s| {
            format!(
                "{{ duration: {}, target: {} }}",
                serde_json::to_string(&s.duration).unwrap(),
                s.target
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let no_reuse = if keep_alive {
        ""
    } else {
        "noConnectionReuse: true,\n  "
    };
    let body_expr = if has_body {
        serde_json::to_string(req.body.as_ref().unwrap()).unwrap()
    } else {
        "null".to_string()
    };
    format!(
        "import http from 'k6/http';\n\n\
export const options = {{\n  {no_reuse}stages: [{stage_js}],\n  summaryTrendStats: ['avg','min','med','max','p(80)','p(90)','p(95)','p(99)'],\n}};\n\n\
const url = {};\nconst params = {{ headers: {}, timeout: '{}s' }};\nconst body = {body_expr};\n\n\
export default function () {{\n  http.request({}, url, body, params);\n}}\n",
        serde_json::to_string(&req.url).unwrap(),
        serde_json::to_string(&headers).unwrap(),
        timeout_sec,
        serde_json::to_string(&req.method).unwrap()
    )
}

fn materialize_script(script_out: Option<&str>, script: &str) -> std::io::Result<PathBuf> {
    let path = match script_out {
        Some(path) => PathBuf::from(path),
        None => {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            std::env::temp_dir().join(format!(
                "qa-touchstone-k6-{}-{nanos}.js",
                std::process::id()
            ))
        }
    };
    ensure_parent(&path)?;
    std::fs::write(&path, script)?;
    Ok(path)
}

fn ensure_parent(path: impl AsRef<Path>) -> std::io::Result<()> {
    if let Some(parent) = path.as_ref().parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    Ok(())
}

fn cleanup_temp_script(script_out: Option<&str>, script_path: &Path) {
    if script_out.is_none() {
        let _ = std::fs::remove_file(script_path);
    }
}

fn k6_command(bin: &str) -> Command {
    #[cfg(windows)]
    if let Some(path) = resolve_windows_path_command(bin) {
        return Command::new(path);
    }

    Command::new(bin)
}

#[cfg(windows)]
fn resolve_windows_path_command(bin: &str) -> Option<PathBuf> {
    let path = Path::new(bin);
    if path.is_absolute() || path.components().count() > 1 || path.extension().is_some() {
        return None;
    }

    let path_var = std::env::var_os("PATH")?;
    let extensions = std::env::var_os("PATHEXT")
        .map(|value| {
            value
                .to_string_lossy()
                .split(';')
                .filter_map(|ext| {
                    let ext = ext.trim();
                    if ext.is_empty() {
                        None
                    } else if ext.starts_with('.') {
                        Some(ext.to_string())
                    } else {
                        Some(format!(".{ext}"))
                    }
                })
                .collect::<Vec<_>>()
        })
        .filter(|extensions| !extensions.is_empty())
        .unwrap_or_else(|| {
            [".COM", ".EXE", ".BAT", ".CMD"]
                .into_iter()
                .map(str::to_string)
                .collect()
        });

    for dir in std::env::split_paths(&path_var) {
        for ext in &extensions {
            let candidate = dir.join(format!("{bin}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

fn k6_spawn_error(bin: &str, e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        format!("k6 binary `{bin}` was not found; install k6 on the CI runner or pass --k6-bin")
    } else {
        format!("failed to run k6 binary `{bin}`: {e}")
    }
}

struct PerfJson<'a> {
    ok: bool,
    request_id: &'a str,
    identity_id: &'a str,
    env_name: Option<&'a str>,
    collection_id: Option<&'a str>,
    url: &'a str,
    stages: &'a [Stage],
    script_out: Option<&'a str>,
    summary_out: Option<&'a str>,
    k6_exit_code: Option<i32>,
    stdout: Option<&'a str>,
    stderr: Option<&'a str>,
    error: Option<&'a str>,
}

fn print_perf_json(report: PerfJson<'_>) {
    let stages: Vec<Value> = report
        .stages
        .iter()
        .map(|s| json!({ "duration": s.duration, "target": s.target }))
        .collect();
    println!(
        "{}",
        json!({
            "ok": report.ok,
            "request": report.request_id,
            "identity": report.identity_id,
            "env": report.env_name,
            "collection": report.collection_id,
            "url": report.url,
            "stages": stages,
            "script": report.script_out,
            "summary": report.summary_out,
            "k6ExitCode": report.k6_exit_code,
            "stdout": report.stdout.filter(|s| !s.is_empty()),
            "stderr": report.stderr.filter(|s| !s.is_empty()),
            "error": report.error,
        })
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stage_specs() {
        assert_eq!(
            parse_stage("15s:4").unwrap(),
            Stage {
                duration: "15s".into(),
                target: 4
            }
        );
        assert!(parse_stage("15s").is_err());
        assert!(parse_stage(":4").is_err());
        assert!(parse_stage("15s:nope").is_err());
    }

    #[test]
    fn builds_k6_script_with_stages_headers_and_body() {
        let req = PerfRequest {
            method: "POST".into(),
            url: "https://api.example.test/items".into(),
            headers: vec![("Accept".into(), "application/json".into())],
            body: Some(r#"{"name":"Ada"}"#.into()),
        };
        let script = build_k6_script(
            &req,
            &[Stage {
                duration: "10s".into(),
                target: 3,
            }],
            false,
            30_000,
        );
        assert!(script.contains("noConnectionReuse: true"));
        assert!(script.contains("{ duration: \"10s\", target: 3 }"));
        assert!(script.contains("\"Content-Type\":\"application/json\""));
        assert!(script.contains("http.request(\"POST\""));
        assert!(script.contains(r#"const body = "{\"name\":\"Ada\"}";"#));
    }

    #[test]
    fn get_script_drops_body() {
        let req = PerfRequest {
            method: "GET".into(),
            url: "https://api.example.test/items".into(),
            headers: vec![],
            body: Some("should-not-send".into()),
        };
        let script = build_k6_script(
            &req,
            &[Stage {
                duration: "1s".into(),
                target: 1,
            }],
            true,
            1,
        );
        assert!(script.contains("const body = null;"));
        assert!(!script.contains("should-not-send"));
        assert!(script.contains("timeout: '1s'"));
    }
}
