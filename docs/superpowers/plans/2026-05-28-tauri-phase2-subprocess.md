# Tauri 遷移 — 階段 2：子程序即時串流 + 停止（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Rust（tokio）移植「執行指令並即時串流輸出」與「停止指令」：`run_command` 開子程序、把 stdout/stderr 逐塊 `emit('command-output')`、結束時回傳 exit code；`stop_command` 跨平台砍整棵 process tree。同時順手修兩個 P1 既有 bug：#2（stop 用 Windows-only `tasklist` 判斷，macOS 砍不掉）與 #1（四個 FlashPage 把子程序輸出原樣丟進 `dangerouslySetInnerHTML`，XSS）。

**Architecture:** 延續方案 A。後端新增 `commands/process.rs`，用 `tokio::process` 開 shell 子程序（Windows `cmd /C`、macOS/Linux `/bin/zsh -c`），spawn 兩個非同步讀取 task 逐塊 `app.emit(COMMAND_OUTPUT, chunk)`，`child.wait().await` 後回傳 exit code。子程序 PID 存進既有 `AppState.current_process_pid`，供 `stop_command` 砍 tree。停止採跨平台：Windows `taskkill /PID <pid> /T /F`；Unix 在 spawn 時 `process_group(0)` 讓子程序成為 group leader，停止時 `kill -KILL -<pid>` 砍整個 group。前端 `runCommandWithRealTimeOutput` 走「listen → invoke → finally unlisten」。XSS：四個 FlashPage 在 `dangerouslySetInnerHTML` 前用 DOMPurify 清洗（保留 App 自己注入的 `<span style>` 狀態列，移除子程序輸出中的 `<script>`/`onerror` 等）。

**Tech Stack:** Rust（`tokio` process/io-util/rt/macros、tauri 2、parking_lot）、前端 + DOMPurify + vitest。

參照設計文件：`docs/superpowers/specs/2026-05-28-tauri-migration-design.md`（§2 混合型方法 runCommandWithRealTimeOutput/stopCommand、§3 串流資料流、§7 bug #1 與 #2）。階段 0 已建立 `events.rs` 的 `COMMAND_OUTPUT` 常數與前端 `processCommandOutput`/`removeCommandOutputListener`（已接真實 listen），`AppState.current_process_pid` 欄位已存在（本階段開始使用）。

**逐字保留的契約（不可改）：**
- `command-output` 事件 payload = **純字串**（stdout 與 stderr 合併、不分流；前端 `subscribe` 直接把 `e.payload` 傳給 callback）。
- `run_command` 解析為 **exit code（整數）**；spawn 失敗則 reject（`Err(String)`）。
- `stop_command` 解析為 undefined/null（前端忽略回傳）。
- 前端 `runCommandWithRealTimeOutput(command, workingDirectory, callback)`：callback 收到原始字串、回傳 promise 解析為 exit code、每次呼叫自帶 listener 並於 finally 解除。
- shell 行為：Windows 用 `cmd`（`shell:true` 等效）、macOS/Linux 用 `/bin/zsh` 且覆寫 `PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin`（其餘 env 繼承）。macOS/Linux 當指令含 `nrfjprog` 時：`which nrfjprog` 取絕對路徑替換並前綴 `sudo`（找不到則試常見路徑、再不行就 `sudo <原指令>`）。Windows 不做此改寫。

**安全註記（既有、非本次引入）：** spawn 一律走 shell，指令字串由前端字串拼接而成（command-injection 面）。這是 App 既有設計（要跑 nrfjprog/commander/adb/ssh 等 CLI），本階段維持行為、不重構指令組裝；僅修 #1 的輸出渲染 XSS 與 #2 的停止。

---

## File Structure

**新增（Rust）**
- `src-tauri/src/commands/process.rs` — `run_command`、`stop_command` + shell/串流/砍 tree helper

**修改（Rust）**
- `src-tauri/Cargo.toml` — 加 `tokio`（features: process, io-util, rt-multi-thread, macros, time）
- `src-tauri/src/commands/mod.rs` — 加 `process` 模組
- `src-tauri/src/lib.rs` — 註冊 `run_command`、`stop_command`

**修改（前端）**
- `package.json` — 加 `dompurify`
- `src/api/index.js` — `runCommandWithRealTimeOutput`、`stopCommand` 改真實 invoke/listen
- `src/api/index.test.js` — 更新（這兩個不再 NotPorted；未移植範例已是 `listSerialPorts`）
- `src/pages/NordicFlashPage.jsx`、`SilabsFlashPage.jsx`、`EfdFlashPage.jsx`、`RfdFlashPage.jsx` — `dangerouslySetInnerHTML` 前 DOMPurify 清洗（修 bug #1）

---

## Task 1: 安裝 tokio 並實作 `run_command`（串流）

**Files:** Modify `src-tauri/Cargo.toml`; Create `src-tauri/src/commands/process.rs`; Modify `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 加 tokio 相依（Cargo.toml）**

在 `[dependencies]` 末尾加：
```toml
tokio = { version = "1", features = ["process", "io-util", "rt-multi-thread", "macros", "time"] }
```

- [ ] **Step 2: 建立 `src-tauri/src/commands/process.rs`（run_command + helper + 測試）**

```rust
use crate::events::COMMAND_OUTPUT;
use crate::state::AppState;
use std::process::Stdio;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncReadExt;

/// 依平台決定 shell 程式與參數。非 Windows 會套用 nrfjprog 改寫。
fn shell_invocation(command: &str) -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        ("cmd".to_string(), vec!["/C".to_string(), command.to_string()])
    }
    #[cfg(not(target_os = "windows"))]
    {
        ("/bin/zsh".to_string(), vec!["-c".to_string(), rewrite_nrfjprog(command)])
    }
}

/// macOS/Linux：含 nrfjprog 時改絕對路徑 + sudo（對齊 Electron）。Windows 不會呼叫此函式。
#[cfg(not(target_os = "windows"))]
fn rewrite_nrfjprog(command: &str) -> String {
    if !command.contains("nrfjprog") {
        return command.to_string();
    }
    // 動態找 nrfjprog
    if let Ok(out) = std::process::Command::new("which").arg("nrfjprog").output() {
        if out.status.success() {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                return format!("sudo {}", command.replace("nrfjprog", &path));
            }
        }
    }
    // 常見安裝路徑 fallback
    for p in ["/usr/local/bin/nrfjprog", "/opt/homebrew/bin/nrfjprog", "/usr/bin/nrfjprog", "/opt/local/bin/nrfjprog"] {
        if std::path::Path::new(p).exists() {
            return format!("sudo {}", command.replace("nrfjprog", p));
        }
    }
    format!("sudo {command}")
}

fn build_command(command: &str, working_directory: &Option<String>) -> tokio::process::Command {
    let (program, args) = shell_invocation(command);
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    if let Some(dir) = working_directory {
        if !dir.is_empty() {
            cmd.current_dir(dir);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // 覆寫 PATH（對齊 Electron），其餘 env 繼承
        cmd.env("PATH", "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin");
        // 讓子程序自成 process group（pgid==pid），供 stop_command 砍整 group
        cmd.process_group(0);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd
}

/// 讀一條串流、逐塊 emit command-output（保留 \r 進度更新；不以行為單位緩衝）。
async fn stream_to_events<R: AsyncReadExt + Unpin>(mut reader: R, app: AppHandle) {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = app.emit(COMMAND_OUTPUT, chunk);
            }
            Err(_) => break,
        }
    }
}

#[tauri::command]
pub async fn run_command(
    app: AppHandle,
    state: State<'_, AppState>,
    command: String,
    working_directory: Option<String>,
) -> Result<i32, String> {
    let mut cmd = build_command(&command, &working_directory);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    // 記錄 PID（block scope：parking_lot guard 不跨 await）
    if let Some(pid) = child.id() {
        *state.current_process_pid.lock() = Some(pid);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut handles = Vec::new();
    if let Some(out) = stdout {
        let app_c = app.clone();
        handles.push(tauri::async_runtime::spawn(async move { stream_to_events(out, app_c).await }));
    }
    if let Some(err) = stderr {
        let app_c = app.clone();
        handles.push(tauri::async_runtime::spawn(async move { stream_to_events(err, app_c).await }));
    }

    let status = child.wait().await;

    for h in handles {
        let _ = h.await;
    }
    *state.current_process_pid.lock() = None;

    match status {
        Ok(s) => Ok(s.code().unwrap_or(-1)),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_invocation_per_platform() {
        let (prog, args) = shell_invocation("echo hello");
        #[cfg(target_os = "windows")]
        {
            assert_eq!(prog, "cmd");
            assert_eq!(args, vec!["/C".to_string(), "echo hello".to_string()]);
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(prog, "/bin/zsh");
            assert_eq!(args[0], "-c");
            assert_eq!(args[1], "echo hello"); // 無 nrfjprog → 不改寫
        }
    }

    #[tokio::test]
    async fn spawns_and_collects_output() {
        // 用同一條 build_command 開 echo，直接讀 stdout（不經 Tauri emit）
        let mut cmd = build_command("echo hello", &None);
        let mut child = cmd.spawn().expect("spawn");
        let mut out = child.stdout.take().unwrap();
        let mut s = String::new();
        let mut buf = [0u8; 1024];
        loop {
            let n = out.read(&mut buf).await.unwrap();
            if n == 0 { break; }
            s.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
        let status = child.wait().await.unwrap();
        assert_eq!(status.code(), Some(0));
        assert!(s.contains("hello"), "stdout was: {s:?}");
    }
}
```

> 註：`process_group` 為 `tokio::process::Command` 的 Unix 方法（對應 std 1.64+）。Windows 不呼叫。Windows 上 `taskkill /T` 砍 tree 由 Task 2 處理。

- [ ] **Step 3: `commands/mod.rs` 加模組**

```rust
pub mod process;
```
（插在 `pub mod fsops;` 之後，維持字母序：certs, config, flash, fsops, process, store, system, window）

- [ ] **Step 4: 註冊（lib.rs）**

於既有 handler 清單末尾（`commands::config::set_api_credential_configs,` 之後）加入：
```rust
            commands::process::run_command,
```
（`stop_command` 在 Task 2 加入。）

- [ ] **Step 5: 跑測試**

Run: `cd src-tauri && cargo test process`（首次會下載 tokio）
Expected: `shell_invocation_per_platform`、`spawns_and_collects_output` PASS。
> 環境：新 shell 先 `export PATH="$USERPROFILE/.cargo/bin:$PATH"`。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/commands/process.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): run_command with real-time stdout/stderr streaming"
```

---

## Task 2: `stop_command`（跨平台砍 process tree，修 bug #2）

**Files:** Modify `src-tauri/src/commands/process.rs`, `src-tauri/src/lib.rs`

> 既有 bug #2（spec §7）：Electron `stop-command` 用 Windows-only `tasklist` 判斷存活，macOS/Linux 因 `tasklist` 不存在而走 else 分支、永遠不砍。Rust 版**無條件**跨平台砍整棵 tree。

- [ ] **Step 1: 在 `process.rs` 加 `stop_command` 與 `kill_tree`**

```rust
fn kill_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        // /T 連子程序、/F 強制
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        // 子程序在 spawn 時 process_group(0) → pgid==pid；砍整個 group（負號）
        let _ = std::process::Command::new("kill")
            .args(["-KILL", &format!("-{pid}")])
            .output();
    }
}

#[tauri::command]
pub fn stop_command(state: State<AppState>) {
    let pid = state.current_process_pid.lock().take();
    if let Some(pid) = pid {
        kill_tree(pid);
    }
    // 對齊 Electron：resolve 無回傳值
}
```

- [ ] **Step 2: 註冊（lib.rs）**

於 `commands::process::run_command,` 之後加入：
```rust
            commands::process::stop_command,
```

- [ ] **Step 3: 編譯 + 既有測試**

Run: `cd src-tauri && cargo test process`
Expected: Task 1 的 2 個測試仍 PASS、`cargo build` 無錯。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/process.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): stop_command cross-platform process-tree kill (fix bug #2)"
```

---

## Task 3: 前端 api 接線（runCommandWithRealTimeOutput / stopCommand）

**Files:** Modify `src/api/index.js`, `src/api/index.test.js`

- [ ] **Step 1: 更新測試 `src/api/index.test.js`**

在 `describe('api module', ...)` 內新增（放最後一個測試之後、`});` 之前）：
```javascript
  it('stopCommand 轉呼 invoke stop_command', async () => {
    invokeMock.mockResolvedValue(undefined);
    await api.stopCommand();
    expect(invokeMock).toHaveBeenCalledWith('stop_command');
  });

  it('runCommandWithRealTimeOutput 先 listen command-output 再 invoke run_command，並回傳 exit code', async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    invokeMock.mockResolvedValue(0);
    const cb = vi.fn();
    const code = await api.runCommandWithRealTimeOutput('echo hi', null, cb);
    expect(code).toBe(0);
    expect(listenMock).toHaveBeenCalledWith('command-output', expect.any(Function));
    expect(invokeMock).toHaveBeenCalledWith('run_command', { command: 'echo hi', workingDirectory: null });
    expect(unlisten).toHaveBeenCalledTimes(1); // finally 解除
  });

  it('runCommandWithRealTimeOutput 的 callback 收到事件 payload 字串', async () => {
    let captured = null;
    listenMock.mockImplementation(async (_evt, handler) => {
      handler({ payload: 'line1' }); // 模擬一筆 command-output
      return vi.fn();
    });
    invokeMock.mockResolvedValue(0);
    const cb = vi.fn((d) => { captured = d; });
    await api.runCommandWithRealTimeOutput('x', null, cb);
    expect(captured).toBe('line1');
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/api/index.test.js`
Expected: 新增 3 個 FAIL（方法仍 NotPorted）。

- [ ] **Step 3: 實作 `src/api/index.js`**

把這兩行（原 `notPorted`）：
```javascript
  runCommandWithRealTimeOutput: notPorted('runCommandWithRealTimeOutput'),
  stopCommand: notPorted('stopCommand'),
```
改為：
```javascript
  runCommandWithRealTimeOutput: async (command, workingDirectory, callback) => {
    const unlisten = await listen('command-output', (e) => callback(e.payload));
    try {
      return await invoke('run_command', { command, workingDirectory });
    } finally {
      unlisten();
    }
  },
  stopCommand: () => invoke('stop_command'),
```
> `listen` 已在檔頭 import（階段 0）。此處每次呼叫自帶 listener、finally 解除，對齊 Electron preload 行為；與全域 `processCommandOutput` 監聽（階段 0 已接）並存、互不影響。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/api/index.test.js`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/api/index.js src/api/index.test.js
git commit -m "feat(api): wire runCommandWithRealTimeOutput/stopCommand to tauri"
```

---

## Task 4: 修 XSS（bug #1）— 四個 FlashPage 渲染前 DOMPurify 清洗

**Files:** Modify `package.json`, `src/pages/NordicFlashPage.jsx`, `src/pages/SilabsFlashPage.jsx`, `src/pages/EfdFlashPage.jsx`, `src/pages/RfdFlashPage.jsx`

> 既有 bug #1（spec §7）：四頁把累積的 `consoleOutput`（混了 App 自己的 `<span style>` 狀態列 + 原始子程序輸出）以 `dangerouslySetInnerHTML` 注入，子程序輸出中的 `<script>`/`<img onerror>` 會執行。修法：注入前用 DOMPurify 清洗——移除可執行向量、保留 App 的狀態列樣式。

- [ ] **Step 1: 安裝 DOMPurify**

Run（專案根）: `npm install dompurify`
Expected: `package.json` dependencies 出現 `dompurify`。

- [ ] **Step 2: 四頁加入 import 並包住 dangerouslySetInnerHTML**

對 `NordicFlashPage.jsx`、`SilabsFlashPage.jsx`、`EfdFlashPage.jsx`、`RfdFlashPage.jsx` 各做兩處修改：

(a) 在檔頭 import 區加：
```javascript
import DOMPurify from 'dompurify';
```

(b) 把渲染處（各頁的 `dangerouslySetInnerHTML={{ __html: consoleOutput }}`）改為：
```jsx
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(consoleOutput) }}
```
四頁對應行（移植時以實際檔案為準，搜尋 `dangerouslySetInnerHTML={{ __html: consoleOutput }}`）：
- `NordicFlashPage.jsx:1149`
- `SilabsFlashPage.jsx:830`
- `EfdFlashPage.jsx:765`
- `RfdFlashPage.jsx:664`

> DOMPurify 預設保留 `<span style="color:...">`（App 狀態列）、移除 `<script>`/事件處理屬性。`consoleOutput` 已被截斷到 `maxLogLength`，每次 render 清洗成本有限。

- [ ] **Step 3: 既有頁面測試無回歸**

Run: `npx vitest run src/__tests__/pages/NordicFlashPage.test.jsx src/__tests__/pages/SilabsFlashPage.test.jsx src/__tests__/pages/EfdFlashPage.test.jsx src/__tests__/pages/RfdFlashPage.test.jsx`
Expected: 維持原通過狀態（DOMPurify 在 jsdom 可運作；若某頁無測試檔則略過該檔）。

- [ ] **Step 4: 全套件無回歸**

Run: `npx vitest run`
Expected: 無新增 failure（基準 686）。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/pages/NordicFlashPage.jsx src/pages/SilabsFlashPage.jsx src/pages/EfdFlashPage.jsx src/pages/RfdFlashPage.jsx
git commit -m "fix(security): sanitize command output before dangerouslySetInnerHTML (fix bug #1 XSS)"
```

---

## Task 5: 端到端驗證 + 收尾

**Files:** 無

- [ ] **Step 1: 後端全測試** — Run: `cd src-tauri && cargo test`；Expected: 1a/1b 的 25 + 本階段 2 全綠。
- [ ] **Step 2: 前端全測試** — Run: `npx vitest run`；Expected: 無新增 failure（基準 686）。
- [ ] **Step 3: 啟動煙霧** — Run: `npm run tauri:dev`；Expected: App 啟動、無 runtime/capability 錯誤。（驗畢關閉 dev 程序樹。）
- [ ] **Step 4: 手動 GUI 驗收（需人工 + 實機）**
  - 隨便一個 FlashPage 跑一條會持續輸出的指令（如 device list），console 即時逐塊更新、`\r` 進度正常。
  - 跑長指令時按「停止」→ Windows 與 macOS 都要砍掉整棵 tree（含子程序）。**macOS 需實機驗證**（本機為 Windows）。
  - 餵一段含 `<script>alert(1)</script>` 或 `<img src=x onerror=alert(1)>` 的輸出（例如讓指令 echo 這段字），確認不再執行、以純文字顯示。
  - macOS nrfjprog 燒錄：確認 sudo + 絕對路徑改寫生效（**實機**）。
- [ ] **Step 5: 記錄結果**（無 commit，除非修問題）

---

## 階段 2 完成定義（對照 spec §5）

- [ ] 燒錄/列舉指令即時串流到 UI（逐塊、含 `\r` 進度），結束回傳正確 exit code
- [ ] 停止鈕在 Windows + macOS 都能砍整棵 process tree（bug #2 修正）
- [ ] 子程序輸出中的 HTML/script 不再執行（bug #1 修正，DOMPurify）
- [ ] `cargo test` 綠；前端 vitest 無回歸
- [ ] macOS nrfjprog sudo 改寫保留（實機驗證）

---

## Self-Review 紀錄

- **Spec 覆蓋**：對應 spec §2（runCommandWithRealTimeOutput 的 listen→invoke→finally、stopCommand、command-output payload=字串、回傳 exit code）、§3（tokio::process 串流、PID 存 AppState、stop 砍 tree）、§7 bug #1（輸出渲染 XSS）與 #2（跨平台砍 tree、不靠 tasklist）。
- **Placeholder 掃描**：無 TBD/TODO；每步有完整程式碼與預期輸出。唯一「移植時以實際檔案為準」是四頁 `dangerouslySetInnerHTML` 行號（已附搜尋字串與目前行號）。
- **型別一致性**：`run_command(app, state, command, working_directory)`：前端傳 `{ command, workingDirectory }`，camelCase→snake_case 對應；回傳 `Result<i32,String>`（exit code / reject）。`stop_command(state)` 無參數、無回傳。事件名 `COMMAND_OUTPUT`（events.rs 既有常數，值 `"command-output"`）與前端 `subscribe`/per-call listener 字串一致。`AppState.current_process_pid`（既有欄位）本階段開始讀寫，消除其 dead-code 警告。
- **平台未測碼**：macOS/Linux 的 `process_group(0)`、`kill -KILL -<pid>`、nrfjprog sudo 改寫在本機（Windows）無法驗證，列入 Task 5 實機驗收。Windows 的 `taskkill /T /F` 可在本機驗。
- **未引入新風險**：shell 執行與指令字串拼接為 App 既有設計，維持行為；本階段只修輸出渲染 XSS 與停止邏輯。
