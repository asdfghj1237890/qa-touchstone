# Tauri 遷移 — 階段 5b：網路子網掃描（Implementation Plan，最後一個功能）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移植 `scan_network_devices`：列舉本機 IPv4 介面推導 /24 子網（或用指定 subnet），平行掃描各子網 1-254（反查 DNS → 含 "ring" 即裝置；否則 TCP 探 port 22 → ssh 識別），回傳 `[{ip, hostname}]`。接上前端 `scanNetworkDevices`。這是遷移的**最後一個功能**；之後只剩收尾。

**Architecture:** 擴充 `commands/network.rs`。純函式 `derive_subnets`（介面→子網 + 跳過規則）、`ssh_identify_args`、`classify_ssh_identify`（ring/.220 判定）可單元測試；I/O：`if-addrs` 列舉介面、`dns-lookup` 反查、`std::net::TcpStream::connect_timeout` 探測、`std::process`+wait-timeout 跑 ssh、每子網 spawn 254 執行緒平行（channel + 整體 deadline 收集，落單者放棄）。`scan_network_devices` 為同步 command。

**Tech Stack:** Rust（`if-addrs`、`dns-lookup`、既有 wait-timeout/std::net/std::process）。

**⚠️ 驗證界線：** 介面列舉/DNS/TCP/ssh/平行掃描需實網驗證。純函式（子網推導、ssh 識別分類、ssh 參數）單元測試。

參照：Electron `scan-network-devices`(electron.js:3933-4087)。

**逐字保留的契約：**
- 子網：manualSubnet 有值 → 只用它；否則列舉非 loopback IPv4 介面：取前三段為子網，跳過介面名含 vpn/virtual/vmware/vbox/docker 或子網 `10.`/`172.` 開頭；再額外加入所有 `192.168.x` 子網（不分介面名）；以子網字串去重。
- 每 IP `check_host`：反查 DNS——成功且 hostname 含 "ring" → `{ip, hostname}`；成功但不含 → 排除（不再探 TCP）；反查失敗 → TCP 連 port 22（500ms）：連上 → ssh 識別；連不上 → 排除。
- ssh 識別：`ssh -o ConnectTimeout=1 -o StrictHostKeyChecking=no -o PasswordAuthentication=no root@<ip> "hostname 2>/dev/null || echo unknown"`（2s）。有輸出時：hostname 含 "ring" 或 ip 含 ".220" → `{ip, hostname: hostname!="unknown"?hostname:"Ring Device (ip)"}`；否則排除。無輸出（ssh 失敗但 port 開）→ `{ip, hostname:"SSH Device (ip)"}`。
- 回傳：裝置陣列；無子網或錯誤 → `[]`。

---

## File Structure

**修改（Rust）**
- `src-tauri/Cargo.toml` — 加 `if-addrs`、`dns-lookup`
- `src-tauri/src/commands/network.rs` — 加 `derive_subnets`/`ssh_identify_args`/`classify_ssh_identify`（純 + 測試）+ `enumerate_interfaces`/`run_ssh_identify`/`check_host`/`scan_subnet`/`scan_network_devices`
- `src-tauri/src/lib.rs` — 註冊 `scan_network_devices`
- `src/api/index.js` — `scanNetworkDevices` 改真實 invoke
- `src/api/index.test.js` — 加測試 + 把「未移植」範例改成仍未移植者（5b 後序列/postman/credential 仍有 notPorted：`scanCredentials`/`getCredentialsPath`/`getSelectedCredential` → 改用 `scanCredentials`）

---

## Task 1: deps + network.rs 掃描（純 helper 測試 + I/O）+ 註冊

**Files:** Modify `src-tauri/Cargo.toml`, `src-tauri/src/commands/network.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: deps（Cargo.toml）**

```toml
if-addrs = "0.13"
dns-lookup = "2"
```

- [ ] **Step 2: network.rs 加入（純 helper + I/O）**

```rust
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::time::Duration;

fn skip_iface_name(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("vpn") || n.contains("virtual") || n.contains("vmware") || n.contains("vbox") || n.contains("docker")
}

fn subnet_of(ipv4: &str) -> Option<String> {
    let parts: Vec<&str> = ipv4.split('.').collect();
    if parts.len() < 3 { return None; }
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
    // 再加所有 192.168.x（不分介面名）
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
        "-o".into(), "ConnectTimeout=1".into(),
        "-o".into(), "StrictHostKeyChecking=no".into(),
        "-o".into(), "PasswordAuthentication=no".into(),
        format!("root@{ip}"),
        "hostname 2>/dev/null || echo unknown".into(),
    ]
}

/// 純：依 ssh 識別結果分類。對齊 Electron checkHost 的 exec callback。
fn classify_ssh_identify(ip: &str, has_output: bool, stdout: &str) -> Option<Value> {
    if has_output {
        let hostname = stdout.trim();
        if hostname.to_lowercase().contains("ring") || ip.contains(".220") {
            let display = if hostname != "unknown" && !hostname.is_empty() {
                hostname.to_string()
            } else {
                format!("Ring Device ({ip})")
            };
            Some(json!({ "ip": ip, "hostname": display }))
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
    let mut child = match Command::new("ssh").args(&args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
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
    // 反查 DNS：成功 → ring 判定（不再探 TCP）；失敗 → TCP 路徑。
    if let Ok(addr) = ip.parse::<IpAddr>() {
        if let Ok(hostname) = dns_lookup::lookup_addr(&addr) {
            return if hostname.to_lowercase().contains("ring") {
                Some(json!({ "ip": ip, "hostname": hostname }))
            } else {
                None
            };
        }
    }
    // TCP 探 port 22（500ms）
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
```
並在 `#[cfg(test)] mod tests` 內加（純函式測試）：
```rust
    #[test]
    fn derive_subnets_manual_overrides() {
        assert_eq!(derive_subnets(&[], Some("192.168.50")), vec!["192.168.50".to_string()]);
    }
    #[test]
    fn derive_subnets_skips_vpn_and_10_172_keeps_192168() {
        let ifs = vec![
            ("eth0".into(), "192.168.1.10".into()),
            ("vpn0".into(), "192.168.9.5".into()), // 名稱含 vpn → loop1 跳過，但 192.168 → loop2 加入
            ("docker0".into(), "172.17.0.1".into()), // docker + 172 → 跳過
            ("eth1".into(), "10.0.0.5".into()),       // 10. → 跳過
        ];
        let subnets = derive_subnets(&ifs, None);
        assert!(subnets.contains(&"192.168.1".to_string()));
        assert!(subnets.contains(&"192.168.9".to_string())); // 由 loop2 加入
        assert!(!subnets.contains(&"172.17.0".to_string()));
        assert!(!subnets.contains(&"10.0.0".to_string()));
    }
    #[test]
    fn classify_ring_and_ssh_device() {
        // ring hostname → Ring device
        assert_eq!(classify_ssh_identify("1.2.3.4", true, "my-ring-cam\n").unwrap()["hostname"], "my-ring-cam");
        // .220 + unknown → Ring Device (ip)
        assert_eq!(classify_ssh_identify("1.2.3.220", true, "unknown\n").unwrap()["hostname"], "Ring Device (1.2.3.220)");
        // 有輸出但非 ring/非 .220 → 排除
        assert!(classify_ssh_identify("1.2.3.4", true, "some-host\n").is_none());
        // 無輸出（ssh 失敗、port 開）→ SSH Device
        assert_eq!(classify_ssh_identify("1.2.3.4", false, "").unwrap()["hostname"], "SSH Device (1.2.3.4)");
    }
    #[test]
    fn ssh_identify_args_shape() {
        let a = ssh_identify_args("1.2.3.4");
        assert!(a.contains(&"root@1.2.3.4".to_string()));
        assert_eq!(a.last().unwrap(), "hostname 2>/dev/null || echo unknown");
    }
```

- [ ] **Step 3: 註冊（lib.rs，於 test_ssh_connection 之後）**

```rust
            commands::network::scan_network_devices,
```

- [ ] **Step 4: 編譯 + 測試** — `cd src-tauri && cargo test network`（首次下載 if-addrs/dns-lookup）；Expected: 既有 6 + 新 4 共 10 PASS、`cargo build` 成功。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/commands/network.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): scan_network_devices (subnet probe + ssh identify)"
```

---

## Task 2: 前端接線 + 驗證 + 收尾

**Files:** Modify `src/api/index.js`, `src/api/index.test.js`

- [ ] **Step 1: 測試（index.test.js）**

把「未移植」範例由 `scanNetworkDevices` 改為仍未移植的 `scanCredentials`：
```javascript
    const p = api.scanCredentials('/x');
```
新增：
```javascript
  it('scanNetworkDevices 帶 manualSubnet', async () => {
    invokeMock.mockResolvedValue([{ ip: '192.168.1.220', hostname: 'ring-x' }]);
    await expect(api.scanNetworkDevices('192.168.1')).resolves.toEqual([{ ip: '192.168.1.220', hostname: 'ring-x' }]);
    expect(invokeMock).toHaveBeenCalledWith('scan_network_devices', { manualSubnet: '192.168.1' });
  });
```

- [ ] **Step 2: 確認失敗** — `npx vitest run src/api/index.test.js`。

- [ ] **Step 3: 實作（index.js）** — `scanNetworkDevices: notPorted(...)` → 
```javascript
  scanNetworkDevices: (manualSubnet) => invoke('scan_network_devices', { manualSubnet }),
```

- [ ] **Step 4: 跑測試** — `npx vitest run src/api/index.test.js`；Expected: 全 PASS。
- [ ] **Step 5: 全套件** — `npx vitest run`；Expected: 701 + 1 = 702，無回歸。
- [ ] **Step 6: Commit**

```bash
git add src/api/index.js src/api/index.test.js
git commit -m "feat(api): wire scanNetworkDevices to tauri"
```

- [ ] **Step 7: 後端全測試** — `cd src-tauri && cargo test`；Expected: 82 + 4 共 86 全綠。
- [ ] **Step 8: 啟動煙霧** — `npm run tauri:dev`；Expected: App 啟動、scan_network_devices 已註冊、無 runtime/capability 錯誤。（驗畢關閉 dev 程序樹。）
- [ ] **Step 9: 實機驗收（需實網）：** 掃描（自動子網或指定）→ 找到 Ring/SSH 裝置、清單正確。
- [ ] **Step 10: 最終 code review + finishing-a-development-branch。**

---

## 階段 5b 完成定義（= 所有功能階段完成）

- [ ] `scan_network_devices` 實作 + 註冊；前端 `scanNetworkDevices` 接上
- [ ] 純 helper（derive_subnets/classify/args）測試綠；`cargo test`/vitest 全綠；App 啟動正常
- [ ] **實機**：子網掃描找到裝置（使用者驗證）
- [ ] 至此功能移植完成；剩收尾（移除 electron 相依、scripts、安裝包）

---

## Self-Review 紀錄

- **Spec 覆蓋**：對齊 Electron scan-network-devices（子網推導 + 跳過規則 + 192.168 補、反查 DNS→ring、TCP port 22、ssh 識別 ring/.220/SSH Device）。
- **平行**：每子網 254 執行緒 + channel + 整體 deadline（6s）收集，落單 thread 由 connect/ssh timeout 自然結束；對應 Electron 每子網 Promise.all。
- **與 Electron 小差異**：(1) 反查 DNS 無顯式 1s timeout（靠 OS resolver + 整體 deadline 收束）；(2) `dns_lookup::lookup_addr` 在無 PTR 時行為依平台（多為 Err→走 TCP，符合 Electron）。已載明。
- **驗證界線**：I/O/網路/執行緒無法本機驗證；derive_subnets/classify_ssh_identify/ssh_identify_args 純函式已測。
- **型別一致性**：command `scan_network_devices(manual_subnet: Option<String>)` 對應前端 `{manualSubnet}`；回傳 `[{ip,hostname}]`。wait-timeout（5a 既有）重用於 ssh 識別。
- **Placeholder 掃描**：無 TBD/TODO。
