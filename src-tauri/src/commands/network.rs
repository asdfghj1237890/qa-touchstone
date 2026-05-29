use serde_json::{json, Value};
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::time::Duration;

/// 建構 ssh 測試指令的參數（金鑰認證；對齊 Electron）。
fn ssh_test_args(ip: &str, username: &str) -> Vec<String> {
    vec![
        "-o".into(),
        "ConnectTimeout=5".into(),
        "-o".into(),
        "StrictHostKeyChecking=no".into(),
        "-o".into(),
        "PasswordAuthentication=no".into(),
        format!("{username}@{ip}"),
        "echo 'SSH_TEST_SUCCESS' && hostname".into(),
    ]
}

/// 解析 ssh 結果（純函式）。對齊 Electron test-ssh-connection 的分支。
fn parse_ssh_test_result(success: bool, stdout: &str, stderr: &str) -> Value {
    if !success {
        let combined = format!("{stdout}\n{stderr}");
        if combined.contains("Permission denied") {
            return json!({ "success": false, "error": "SSH key authentication failed. Please ensure SSH keys are properly configured." });
        }
        if combined.contains("Connection refused") {
            return json!({ "success": false, "error": "SSH service not available on the device." });
        }
        let msg = stderr.trim();
        let msg = if msg.is_empty() { "SSH connection failed" } else { msg };
        return json!({ "success": false, "error": msg });
    }
    if stdout.contains("SSH_TEST_SUCCESS") {
        let hostname = stdout
            .lines()
            .nth(1)
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .unwrap_or("Unknown");
        return json!({ "success": true, "hostname": hostname });
    }
    json!({ "success": false, "error": "Unexpected response from device" })
}

#[tauri::command]
pub fn test_ssh_connection(ip: String, username: Option<String>) -> Value {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::Duration;
    use wait_timeout::ChildExt;

    let username = username.unwrap_or_else(|| "root".to_string());
    let args = ssh_test_args(&ip, &username);
    let mut child = match Command::new("ssh")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return json!({ "success": false, "error": e.to_string() }),
    };
    // 8s 上限（對齊 Electron exec timeout）：避免連上後卡住而永久凍結 invoke。
    let status = match child.wait_timeout(Duration::from_secs(8)) {
        Ok(Some(s)) => s,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            return json!({ "success": false, "error": "SSH connection timed out" });
        }
        Err(e) => return json!({ "success": false, "error": e.to_string() }),
    };
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut o) = child.stdout.take() {
        let _ = o.read_to_string(&mut stdout);
    }
    if let Some(mut e) = child.stderr.take() {
        let _ = e.read_to_string(&mut stderr);
    }
    parse_ssh_test_result(status.success(), &stdout, &stderr)
}

fn skip_iface_name(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("vpn") || n.contains("virtual") || n.contains("vmware") || n.contains("vbox") || n.contains("docker")
}

fn subnet_of(ipv4: &str) -> Option<String> {
    let parts: Vec<&str> = ipv4.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    Some(format!("{}.{}.{}", parts[0], parts[1], parts[2]))
}

/// 純：由介面 (name, ipv4) 與 manualSubnet 推導要掃的子網。對齊 Electron。
fn derive_subnets(interfaces: &[(String, String)], manual: Option<&str>) -> Vec<String> {
    if let Some(m) = manual.filter(|s| !s.is_empty()) {
        return vec![m.to_string()];
    }
    let mut subnets = Vec::new();
    let mut seen = HashSet::new();
    for (name, ip) in interfaces {
        if let Some(subnet) = subnet_of(ip) {
            if skip_iface_name(name) || subnet.starts_with("10.") || subnet.starts_with("172.") {
                continue;
            }
            if seen.insert(subnet.clone()) {
                subnets.push(subnet);
            }
        }
    }
    for (_name, ip) in interfaces {
        if ip.starts_with("192.168.") {
            if let Some(subnet) = subnet_of(ip) {
                if seen.insert(subnet.clone()) {
                    subnets.push(subnet);
                }
            }
        }
    }
    subnets
}

fn ssh_identify_args(ip: &str) -> Vec<String> {
    vec![
        "-o".into(),
        "ConnectTimeout=1".into(),
        "-o".into(),
        "StrictHostKeyChecking=no".into(),
        "-o".into(),
        "PasswordAuthentication=no".into(),
        format!("root@{ip}"),
        "hostname 2>/dev/null || echo unknown".into(),
    ]
}

/// 純：依 ssh 識別結果分類。對齊 Electron checkHost 的 exec callback。
fn classify_ssh_identify(ip: &str, has_output: bool, stdout: &str) -> Option<Value> {
    if has_output {
        let hostname = stdout.trim();
        if hostname != "unknown" && !hostname.is_empty() {
            Some(json!({ "ip": ip, "hostname": hostname }))
        } else if ip.contains(".220") {
            Some(json!({ "ip": ip, "hostname": format!("Network Device ({ip})") }))
        } else {
            None
        }
    } else {
        Some(json!({ "ip": ip, "hostname": format!("SSH Device ({ip})") }))
    }
}

fn enumerate_interfaces() -> Vec<(String, String)> {
    match if_addrs::get_if_addrs() {
        Ok(ifs) => ifs
            .into_iter()
            .filter(|i| !i.is_loopback())
            .filter_map(|i| match i.addr {
                if_addrs::IfAddr::V4(v4) => Some((i.name, v4.ip.to_string())),
                _ => None,
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn run_ssh_identify(ip: &str) -> (bool, String) {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use wait_timeout::ChildExt;
    let args = ssh_identify_args(ip);
    let mut child = match Command::new("ssh")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return (false, String::new()),
    };
    let status = match child.wait_timeout(Duration::from_secs(2)) {
        Ok(Some(s)) => s,
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            return (false, String::new());
        }
    };
    let mut stdout = String::new();
    if let Some(mut o) = child.stdout.take() {
        let _ = o.read_to_string(&mut stdout);
    }
    (status.success() && !stdout.trim().is_empty(), stdout)
}

fn check_host(ip: &str) -> Option<Value> {
    if let Ok(addr) = ip.parse::<IpAddr>() {
        if let Ok(hostname) = dns_lookup::lookup_addr(&addr) {
            return if hostname.to_lowercase().contains("ring") {
                Some(json!({ "ip": ip, "hostname": hostname }))
            } else {
                None
            };
        }
    }
    let sock: SocketAddr = format!("{ip}:22").parse().ok()?;
    match TcpStream::connect_timeout(&sock, Duration::from_millis(500)) {
        Ok(_) => {
            let (has_output, stdout) = run_ssh_identify(ip);
            classify_ssh_identify(ip, has_output, &stdout)
        }
        Err(_) => None,
    }
}

fn scan_subnet(subnet: &str) -> Vec<Value> {
    let (tx, rx) = std::sync::mpsc::channel();
    for i in 1..=254 {
        let ip = format!("{subnet}.{i}");
        let tx = tx.clone();
        std::thread::spawn(move || {
            let _ = tx.send(check_host(&ip));
        });
    }
    drop(tx);
    let mut devices = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(6);
    let mut received = 0;
    while received < 254 {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match rx.recv_timeout(remaining) {
            Ok(opt) => {
                received += 1;
                if let Some(d) = opt {
                    devices.push(d);
                }
            }
            Err(_) => break,
        }
    }
    devices
}

#[tauri::command]
pub fn scan_network_devices(manual_subnet: Option<String>) -> Vec<Value> {
    let interfaces = enumerate_interfaces();
    let subnets = derive_subnets(&interfaces, manual_subnet.as_deref());
    let mut all = Vec::new();
    for subnet in &subnets {
        all.extend(scan_subnet(subnet));
    }
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_args_shape() {
        let a = ssh_test_args("1.2.3.4", "root");
        assert!(a.contains(&"PasswordAuthentication=no".to_string()));
        assert!(a.contains(&"root@1.2.3.4".to_string()));
        assert_eq!(a.last().unwrap(), "echo 'SSH_TEST_SUCCESS' && hostname");
    }

    #[test]
    fn parse_success_extracts_hostname() {
        let r = parse_ssh_test_result(true, "SSH_TEST_SUCCESS\nmy-ring-device\n", "");
        assert_eq!(r["success"], true);
        assert_eq!(r["hostname"], "my-ring-device");
    }

    #[test]
    fn parse_success_hostname_unknown_when_missing() {
        let r = parse_ssh_test_result(true, "SSH_TEST_SUCCESS\n", "");
        assert_eq!(r["hostname"], "Unknown");
    }

    #[test]
    fn parse_permission_denied() {
        let r = parse_ssh_test_result(false, "", "root@x: Permission denied (publickey).");
        assert_eq!(r["success"], false);
        assert!(r["error"].as_str().unwrap().contains("SSH key authentication failed"));
    }

    #[test]
    fn parse_connection_refused() {
        let r = parse_ssh_test_result(false, "", "ssh: connect to host x port 22: Connection refused");
        assert_eq!(r["error"], "SSH service not available on the device.");
    }

    #[test]
    fn parse_unexpected_output() {
        let r = parse_ssh_test_result(true, "garbage", "");
        assert_eq!(r["error"], "Unexpected response from device");
    }

    #[test]
    fn derive_subnets_manual_overrides() {
        assert_eq!(derive_subnets(&[], Some("192.168.50")), vec!["192.168.50".to_string()]);
    }

    #[test]
    fn derive_subnets_skips_vpn_and_10_172_keeps_192168() {
        let ifs = vec![
            ("eth0".to_string(), "192.168.1.10".to_string()),
            ("vpn0".to_string(), "192.168.9.5".to_string()),
            ("docker0".to_string(), "172.17.0.1".to_string()),
            ("eth1".to_string(), "10.0.0.5".to_string()),
        ];
        let subnets = derive_subnets(&ifs, None);
        assert!(subnets.contains(&"192.168.1".to_string()));
        assert!(subnets.contains(&"192.168.9".to_string())); // loop2 加入
        assert!(!subnets.contains(&"172.17.0".to_string()));
        assert!(!subnets.contains(&"10.0.0".to_string()));
    }

    #[test]
    fn classify_named_and_ssh_device() {
        assert_eq!(classify_ssh_identify("1.2.3.4", true, "my-ssh-host\n").unwrap()["hostname"], "my-ssh-host");
        assert_eq!(classify_ssh_identify("1.2.3.220", true, "unknown\n").unwrap()["hostname"], "Network Device (1.2.3.220)");
        assert!(classify_ssh_identify("1.2.3.4", true, "unknown\n").is_none());
        assert_eq!(classify_ssh_identify("1.2.3.4", false, "").unwrap()["hostname"], "SSH Device (1.2.3.4)");
    }

    #[test]
    fn ssh_identify_args_shape() {
        let a = ssh_identify_args("1.2.3.4");
        assert!(a.contains(&"root@1.2.3.4".to_string()));
        assert_eq!(a.last().unwrap(), "hostname 2>/dev/null || echo unknown");
    }
}
