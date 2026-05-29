# Tauri 遷移 — 階段 5a：SSH 連線測試（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移植 `test_ssh_connection`：對指定 IP 用金鑰跑一個 ssh 測試指令、解析結果，並接上前端 `testSshConnection`。網路子網掃描（scanNetworkDevices）較重（需介面列舉 + 反查 DNS + 平行探測 + 新相依），留待 5b。

**Architecture:** 新增 `commands/network.rs`。`test_ssh_connection` 用 `std::process::Command` 跑 `ssh`（**金鑰認證**，保留 `PasswordAuthentication=no`——使用者確認只用金鑰；spec bug #10 採「停用/不接密碼欄位」解，前端密碼欄位維持非功能、如同 Electron）。指令建構與輸出解析為純函式可測；實際 ssh 執行需實網/裝置驗證。無新相依。

**Tech Stack:** Rust（std::process、既有 serde_json、tauri 2）。

**⚠️ 驗證界線：** ssh 執行需可達的裝置 + 已設定金鑰；純函式（指令 args、輸出解析、錯誤對映）單元測試。

參照：Electron `test-ssh-connection`(electron.js:4090-4121)。preload `testSshConnection(params={ip,username})`(preload.js:117)。

**逐字保留的契約：**
- 指令：`ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o PasswordAuthentication=no <username>@<ip> "echo 'SSH_TEST_SUCCESS' && hostname"`（username 預設 `root`）。
- 失敗對映：錯誤含 `Permission denied` → `{success:false, error:"SSH key authentication failed. Please ensure SSH keys are properly configured."}`；含 `Connection refused` → `{success:false, error:"SSH service not available on the device."}`；其他 → `{success:false, error:<錯誤訊息>}`。
- 成功（stdout 含 `SSH_TEST_SUCCESS`）→ `{success:true, hostname:<stdout 第 2 行 trim，空則 "Unknown">}`。
- stdout 不含 success 標記 → `{success:false, error:"Unexpected response from device"}`。

---

## File Structure

**新增（Rust）**
- `src-tauri/src/commands/network.rs` — `test_ssh_connection` + 純 helper（`ssh_test_args`、`parse_ssh_test_result`）+ 測試

**修改（Rust）**
- `src-tauri/src/commands/mod.rs` — 加 `network`
- `src-tauri/src/lib.rs` — 註冊 `test_ssh_connection`

**修改（前端）**
- `src/api/index.js` — `testSshConnection` 改真實 invoke（`scanNetworkDevices` 維持 notPorted → 5b）
- `src/api/index.test.js` — 加測試（「未移植」範例維持 `scanNetworkDevices`）

---

## Task 1: `network.rs` — `test_ssh_connection` + 純 helper + 測試

**Files:** Create `src-tauri/src/commands/network.rs`; Modify `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 建立 `src-tauri/src/commands/network.rs`**

```rust
use serde_json::{json, Value};

/// 建構 ssh 測試指令的參數（金鑰認證；對齊 Electron）。
fn ssh_test_args(ip: &str, username: &str) -> Vec<String> {
    vec![
        "-o".into(), "ConnectTimeout=5".into(),
        "-o".into(), "StrictHostKeyChecking=no".into(),
        "-o".into(), "PasswordAuthentication=no".into(),
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
    let username = username.unwrap_or_else(|| "root".to_string());
    let args = ssh_test_args(&ip, &username);
    match std::process::Command::new("ssh").args(&args).output() {
        Ok(out) => parse_ssh_test_result(
            out.status.success(),
            &String::from_utf8_lossy(&out.stdout),
            &String::from_utf8_lossy(&out.stderr),
        ),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
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
}
```

- [ ] **Step 2: `commands/mod.rs` 加 `pub mod network;`**（字母序：…, fsops, network, postman, …）

- [ ] **Step 3: 註冊（lib.rs，於 serial 之後）**

```rust
            commands::network::test_ssh_connection,
```

- [ ] **Step 4: 測試** — `cd src-tauri && cargo test network`（新 shell 先 `export PATH="$USERPROFILE/.cargo/bin:$PATH"`）；Expected: 6 個測試 PASS、`cargo build` 成功。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/network.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): test_ssh_connection (key-based ssh test)"
```

---

## Task 2: 前端接線

**Files:** Modify `src/api/index.js`, `src/api/index.test.js`

- [ ] **Step 1: 測試（index.test.js，最後一個測試後）**

```javascript
  it('testSshConnection 帶 params', async () => {
    invokeMock.mockResolvedValue({ success: true, hostname: 'h' });
    await api.testSshConnection({ ip: '1.2.3.4', username: 'root' });
    expect(invokeMock).toHaveBeenCalledWith('test_ssh_connection', { ip: '1.2.3.4', username: 'root' });
  });
```
> 「未移植方法」測試維持用 `scanNetworkDevices`（5b 才移植）。

- [ ] **Step 2: 確認失敗** — `npx vitest run src/api/index.test.js`；Expected: 新測試 FAIL。

- [ ] **Step 3: 實作（index.js）** — 把 `testSshConnection: notPorted('testSshConnection'),` 改為：
```javascript
  testSshConnection: (params) => invoke('test_ssh_connection', params),
```
> `params` 為 `{ip, username}`；invoke 直接把它當 args 物件。

- [ ] **Step 4: 跑測試** — `npx vitest run src/api/index.test.js`；Expected: 全 PASS。
- [ ] **Step 5: 全套件** — `npx vitest run`；Expected: 700 + 1 = 701，無回歸。
- [ ] **Step 6: Commit**

```bash
git add src/api/index.js src/api/index.test.js
git commit -m "feat(api): wire testSshConnection to tauri"
```

---

## Task 3: 驗證 + 收尾

- [ ] **Step 1:** `cd src-tauri && cargo test`；Expected: 76 + network 6 共 82 全綠。
- [ ] **Step 2:** `npx vitest run`；Expected: 701，無回歸。
- [ ] **Step 3:** `npm run tauri:dev`；Expected: App 啟動、test_ssh_connection 已註冊、無 runtime/capability 錯誤。（驗畢關閉 dev 程序樹。）
- [ ] **Step 4: 實機驗收（需可達裝置 + 金鑰）：** 對裝置 IP 測 SSH → 成功回 hostname；不可達/拒絕回對應錯誤。
- [ ] **Step 5: 最終 code review + finishing-a-development-branch。**

---

## 階段 5a 完成定義

- [ ] `test_ssh_connection`（金鑰）實作 + 註冊；前端 `testSshConnection` 接上
- [ ] 純 helper（args、結果解析、錯誤對映）測試綠；`cargo test`/vitest 全綠；App 啟動正常
- [ ] bug #10：採金鑰路徑（使用者確認），密碼欄位維持非功能（如 Electron）
- [ ] **實機**：SSH 測試成功（使用者驗證）

---

## Self-Review 紀錄

- **Spec 覆蓋**：對齊 Electron test-ssh-connection（指令、成功/失敗分支、錯誤對映）。spec bug #10 依使用者選擇採「只用金鑰、密碼欄位停用」；不加 sshpass/密碼路徑。scanNetworkDevices = 5b。
- **驗證界線**：ssh 執行需實網；指令建構/輸出解析/錯誤對映純函式已測。
- **型別一致性**：command `test_ssh_connection(ip, username: Option<String>)` 對應前端 `params={ip,username}`；回傳 `{success,hostname}`/`{success:false,error}` 逐字。
- **Placeholder 掃描**：無 TBD/TODO。
