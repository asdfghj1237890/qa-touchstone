# Tauri 遷移 — 階段 0：骨架與可運行的 App（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓現有的 React/MUI 前端跑在 Tauri 殼上：無邊框視窗 + 視窗控制可用、`src/api` 模組掛到 `window.electronAPI`（真實方法 + 其餘 stub 丟 `NotPortedError`）、兩個真實 command（`get_platform`、`get_process_env`）、事件管線就緒、前端 vitest 維持綠燈。

**Architecture:** 採設計文件方案 A。前端不重寫；新增單一 `src/api/index.js` 抽象層，內部呼叫 Tauri `invoke`/`listen`，啟動時掛到 `window.electronAPI`。Rust 後端置於 `src-tauri/`，依領域分模組，本階段只實作系統類 command 與視窗管理，其餘領域留待階段 1+。

**Tech Stack:** Tauri 2.x、Rust（`thiserror`、`parking_lot`、`tauri-plugin-log`）、既有 Vite 6 + React 18 + MUI、vitest。

參照設計文件：`docs/superpowers/specs/2026-05-28-tauri-migration-design.md`（特別是 §1 架構、§2 api 契約、§4 錯誤處理、§7 既有 bug #3/#4）。

**關鍵既有設定（不可改錯）：**
- Vite dev server：`http://localhost:3000`（`strictPort: true`）
- Vite build 輸出：`build/`（相對專案根；`base: './'`）
- 前端入口：`src/index.jsx`；測試 setup：`src/setupTests.js`（已在 `beforeEach` mock `window.electronAPI`）
- App 以 `?window=` query 區分主視窗 / 設定視窗

---

## File Structure

**新增（Rust 後端，`src-tauri/`）**
- `src-tauri/Cargo.toml` — crate 與相依
- `src-tauri/build.rs` — `tauri_build::build()`
- `src-tauri/tauri.conf.json` — App 設定、視窗、打包目標
- `src-tauri/capabilities/default.json` — 權限
- `src-tauri/src/main.rs` — 二進位入口（呼叫 lib）
- `src-tauri/src/lib.rs` — Tauri builder、註冊 commands、manage state、panic hook、log plugin
- `src-tauri/src/error.rs` — `AppError`（`thiserror` + `Serialize`）
- `src-tauri/src/events.rs` — 事件名稱常數
- `src-tauri/src/state.rs` — `AppState` 骨架
- `src-tauri/src/commands/mod.rs` — command 模組匯出
- `src-tauri/src/commands/system.rs` — `get_platform`、`get_process_env`
- `src-tauri/src/commands/window.rs` — `open_settings`

**新增（前端）**
- `src/api/index.js` — api 抽象層（真實方法 + stub + 監聽器 Map + `NotPortedError`）
- `src/api/index.test.js` — api 模組 vitest 測試

**修改**
- `package.json` — 加 `@tauri-apps/cli`、`@tauri-apps/api` 與 `tauri` scripts
- `src/index.jsx` — 啟動時掛載 api 模組到 `window.electronAPI`
- `.gitignore` — 加 `src-tauri/target`

---

## Task 0: 前置工具鏈（Rust + Tauri CLI + WebView2）

**Files:** 無（環境設定）

本機現況：Node v26 / npm 11 已裝；**Rust/Cargo 尚未安裝**。

- [ ] **Step 1: 安裝 Rust 工具鏈**

Windows（PowerShell）：下載並執行 rustup 安裝程式
```powershell
winget install --id Rustlang.Rustup -e --silent
```
若無 winget，從 https://rustup.rs 下載 `rustup-init.exe` 執行（預設選項即可）。安裝後**開新的終端機**讓 PATH 生效。

- [ ] **Step 2: 驗證 Rust**

Run: `rustc --version && cargo --version`
Expected: 兩者都印出版本（如 `rustc 1.8x.x`、`cargo 1.8x.x`）。若 `command not found`，重開終端機或手動把 `%USERPROFILE%\.cargo\bin` 加進 PATH。

- [ ] **Step 3: 確認 WebView2 Runtime（Windows）**

Run（PowerShell）:
```powershell
Get-ItemProperty -Path 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue | Select-Object pv
```
Expected: 印出版本號 `pv`。若空白，到 https://developer.microsoft.com/microsoft-edge/webview2/ 安裝 Evergreen Runtime。（Windows 10/11 多半已內建。）

- [ ] **Step 4: 安裝前端側 Tauri CLI 與 API（在專案根）**

Run:
```bash
npm install -D @tauri-apps/cli@^2
npm install @tauri-apps/api@^2
```
Expected: 安裝成功，`package.json` devDependencies 出現 `@tauri-apps/cli`。

- [ ] **Step 5: 驗證 Tauri CLI**

Run: `npx tauri --version`
Expected: 印出 `tauri-cli 2.x.x`。

---

## Task 1: 在 `package.json` 加 scripts

**Files:**
- Modify: `package.json`（`scripts` 區塊）

- [ ] **Step 1: 加入 tauri scripts**

在 `package.json` 的 `"scripts"` 內新增三行（放在 `"dev"` 之後）：
```json
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
```

- [ ] **Step 2: 驗證**

Run: `npm run tauri -- --version`
Expected: 印出 `tauri-cli 2.x.x`。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add tauri cli/api deps and scripts"
```

---

## Task 2: 建立 `src-tauri` 骨架與設定

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`
- Modify: `.gitignore`

> 不用互動式 `tauri init`（會問問題且可能覆蓋 Vite 設定）。直接手動建立下列檔案，數值已對齊本專案。

- [ ] **Step 1: `.gitignore` 加入 Rust 產物**

在 `.gitignore` 末端新增：
```
src-tauri/target
src-tauri/gen
```

- [ ] **Step 2: 建立 `src-tauri/Cargo.toml`**

```toml
[package]
name = "qa-companion"
version = "0.13.1"
description = "QA Companion"
edition = "2021"

[lib]
name = "qa_companion_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-log = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
parking_lot = "0.12"
log = "0.4"

[features]
default = []
```

- [ ] **Step 3: 建立 `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 4: 建立 `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "QA Companion",
  "version": "0.13.1",
  "identifier": "com.qacompanion.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:3000",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../build"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "QA Companion",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "decorations": false,
        "backgroundColor": "#121212",
        "maximized": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "dmg"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.ico",
      "icons/icon.icns"
    ]
  }
}
```

- [ ] **Step 5: 產生圖示**

Run（專案根）:
```bash
npx tauri icon public/favicon512.ico
```
Expected: 在 `src-tauri/icons/` 產生各尺寸圖示（含 `icon.ico`、`icon.icns`、png）。若 `public/favicon512.ico` 不存在，改用 `public/favicon.ico`。

- [ ] **Step 6: 建立 `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capabilities for main and settings windows",
  "windows": ["main", "settings"],
  "permissions": [
    "core:default",
    "core:window:allow-minimize",
    "core:window:allow-unminimize",
    "core:window:allow-maximize",
    "core:window:allow-unmaximize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-is-maximized",
    "core:window:allow-close",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:webview:allow-create-webview-window",
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "core:event:allow-emit",
    "log:default"
  ]
}
```

- [ ] **Step 7: Commit**（先建 Rust 原始碼後才能編譯，故此處只 commit 設定）

```bash
git add .gitignore src-tauri/Cargo.toml src-tauri/build.rs src-tauri/tauri.conf.json src-tauri/capabilities src-tauri/icons
git commit -m "chore: scaffold src-tauri config and capabilities"
```

---

## Task 3: Rust 錯誤型別、事件常數、狀態骨架

**Files:**
- Create: `src-tauri/src/error.rs`, `src-tauri/src/events.rs`, `src-tauri/src/state.rs`

- [ ] **Step 1: 建立 `src-tauri/src/error.rs`**

```rust
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Other(String),
}

// 讓 AppError 可被 Tauri command 當作 Err 回傳並序列化到前端（invoke reject）
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
```

- [ ] **Step 2: 建立 `src-tauri/src/events.rs`**

```rust
//! 前後端共用的事件名稱常數（與 src/api/index.js 對應）。
#![allow(dead_code)]

pub const COMMAND_OUTPUT: &str = "command-output";
pub const CONFIG_UPDATED: &str = "config-updated";
pub const POSTMAN_COLLECTIONS_UPDATED: &str = "postman-collections-updated";
```

- [ ] **Step 3: 建立 `src-tauri/src/state.rs`（骨架，欄位隨後續階段填入）**

```rust
use parking_lot::Mutex;

/// 全域共享狀態。階段 0 先放空骨架，子程序 / 快取在後續階段補上。
#[derive(Default)]
pub struct AppState {
    /// 階段 2 用：目前執行中的子程序 PID（佔位）。
    pub current_process_pid: Mutex<Option<u32>>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }
}
```

- [ ] **Step 4: 編譯檢查（這些檔案會在 Task 4 被 lib.rs 引用，先單獨確認語法）**

此步無獨立測試；語法會在 Task 4 的 `cargo build` 一併驗證。先不 commit，與 Task 4 一起。

---

## Task 4: 系統 command + lib.rs 接線（含 cargo 測試）

**Files:**
- Create: `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/system.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 先寫失敗的 Rust 測試 — `system.rs`**

建立 `src-tauri/src/commands/system.rs`：
```rust
use serde::Serialize;

#[derive(Serialize)]
pub struct ProcessEnv {
    #[serde(rename = "NODE_ENV")]
    pub node_env: String,
}

/// 回傳平台字串，對齊 Electron 的 process.platform：win32 / darwin / linux。
#[tauri::command]
pub fn get_platform() -> String {
    platform_string().to_string()
}

#[tauri::command]
pub fn get_process_env() -> ProcessEnv {
    ProcessEnv {
        node_env: std::env::var("NODE_ENV").unwrap_or_else(|_| "production".to_string()),
    }
}

fn platform_string() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_matches_current_os() {
        let p = platform_string();
        if cfg!(target_os = "windows") {
            assert_eq!(p, "win32");
        } else if cfg!(target_os = "macos") {
            assert_eq!(p, "darwin");
        } else {
            assert_eq!(p, "linux");
        }
    }
}
```

- [ ] **Step 2: 建立 `src-tauri/src/commands/mod.rs`**

```rust
pub mod system;
pub mod window;
```

- [ ] **Step 3: 建立 `src-tauri/src/lib.rs`（註冊 command、manage state、log plugin、panic hook）**

```rust
mod commands;
mod error;
mod events;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 對齊 Electron 的 process.on('uncaughtException') —— 記錄 panic。
    std::panic::set_hook(Box::new(|info| {
        log::error!("panic: {info}");
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::system::get_platform,
            commands::system::get_process_env,
            commands::window::open_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: 建立 `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sidewalk_qa_friends_lib::run()
}
```

> 注意：`lib.rs` 引用了 `commands::window::open_settings`，該檔在 Task 5 建立。為了讓本 Task 可獨立編譯，先在 Task 5 之前**暫時**把 `invoke_handler` 內的 `commands::window::open_settings,` 那行與 `mod.rs` 的 `pub mod window;` 註解掉，待 Task 5 再打開。（執行者請依序做 Task 4→5；若連續執行，可直接在 Task 5 一起編譯。）

- [ ] **Step 5: 跑 Rust 單元測試**

Run: `cd src-tauri && cargo test`
Expected: `platform_matches_current_os` PASS（首次會編譯較久並下載相依）。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src
git commit -m "feat(tauri): rust error/events/state + system commands"
```

---

## Task 5: `open_settings` 視窗 command（修正既有 bug #3）

**Files:**
- Create: `src-tauri/src/commands/window.rs`

> 既有 bug #3（spec §7）：Electron 把 `?window=settings` 放進 `path.join` 導致打包後開不了。Tauri 用 `WebviewUrl::App` + query 字串正確處理。

- [ ] **Step 1: 建立 `src-tauri/src/commands/window.rs`**

```rust
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 開啟（或聚焦既有的）設定視窗。對齊 Electron 的 open-settings 單例行為。
#[tauri::command]
pub fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "settings",
        // query 接在路徑後，App.jsx 以 ?window=settings 路由
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("Settings")
    .inner_size(800.0, 600.0)
    .decorations(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}
```

- [ ] **Step 2: 打開 Task 4 暫時註解的兩行**

確認 `src-tauri/src/commands/mod.rs` 有 `pub mod window;`，且 `lib.rs` 的 `invoke_handler!` 含 `commands::window::open_settings,`。

- [ ] **Step 3: 編譯**

Run: `cd src-tauri && cargo build`
Expected: 編譯成功，無錯誤。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src
git commit -m "feat(tauri): open_settings window command"
```

---

## Task 6: 前端 `api` 模組（TDD，修正既有 bug #4）

**Files:**
- Create: `src/api/index.js`, `src/api/index.test.js`

> 既有 bug #4（spec §7）：preload 的監聽器 wrapper 與 remover 對不上。本模組以 `Map<callback, unlisten>` 解決。

- [ ] **Step 1: 先寫失敗測試 `src/api/index.test.js`**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模擬 @tauri-apps/api
const invokeMock = vi.fn();
const listenMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a) => invokeMock(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a) => listenMock(...a) }));

import { api, NotPortedError } from './index.js';

describe('api module', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it('getPlatform 轉呼 invoke get_platform', async () => {
    invokeMock.mockResolvedValue('win32');
    await expect(api.getPlatform()).resolves.toBe('win32');
    expect(invokeMock).toHaveBeenCalledWith('get_platform');
  });

  it('未移植方法丟 NotPortedError', () => {
    expect(() => api.scanCertificates('/x')).toThrow(NotPortedError);
  });

  it('removeConfigListener 能用原 callback 解除監聽', async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const cb = vi.fn();
    api.onConfigUpdated(cb);
    // 等待 listen 的 promise 解析
    await Promise.resolve();
    await Promise.resolve();
    api.removeConfigListener(cb);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/api/index.test.js`
Expected: FAIL（`./index.js` 不存在 / 匯出缺失）。

- [ ] **Step 3: 實作 `src/api/index.js`**

```javascript
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export class NotPortedError extends Error {
  constructor(method) {
    super(`electronAPI.${method} 尚未移植到 Tauri`);
    this.name = 'NotPortedError';
  }
}

// callback -> Promise<unlisten> 對應表，讓 removeXListener(cb) 能正確解除
const listenerMap = new Map();

function subscribe(eventName, callback) {
  const unlistenPromise = listen(eventName, (e) => callback(e.payload));
  listenerMap.set(callback, unlistenPromise);
}

function unsubscribe(callback) {
  const p = listenerMap.get(callback);
  if (p) {
    p.then((unlisten) => unlisten());
    listenerMap.delete(callback);
  }
}

// 啟動時一次性取得，維持同步介面（getPlatform/getProcessEnv 部分元件同步使用）
let cachedPlatform = 'win32';
let cachedProcessEnv = { NODE_ENV: 'production' };
export async function initApi() {
  try {
    cachedPlatform = await invoke('get_platform');
    cachedProcessEnv = await invoke('get_process_env');
  } catch (e) {
    console.error('initApi failed', e);
  }
}

const notPorted = (name) => () => {
  throw new NotPortedError(name);
};

export const api = {
  // --- 階段 0 真實實作 ---
  getPlatform: () => invoke('get_platform'),
  getProcessEnv: () => cachedProcessEnv,
  openSettings: () => invoke('open_settings'),
  closeWindow: () => getCurrentWindow().close(),
  minimizeWindow: () => getCurrentWindow().minimize(),
  maximizeWindow: () => getCurrentWindow().toggleMaximize(),
  onConfigUpdated: (cb) => subscribe('config-updated', cb),
  removeConfigListener: (cb) => unsubscribe(cb),

  // --- 階段 1+ stub（依設計逐步取代）---
  loadConfig: notPorted('loadConfig'),
  saveConfig: notPorted('saveConfig'),
  selectDirectory: notPorted('selectDirectory'),
  selectFile: notPorted('selectFile'),
  scanCredentials: notPorted('scanCredentials'),
  scanCertificates: notPorted('scanCertificates'),
  loadUserData: notPorted('loadUserData'),
  saveUserData: notPorted('saveUserData'),
  getCredentialsPath: notPorted('getCredentialsPath'),
  getCertificatesPath: notPorted('getCertificatesPath'),
  updateFlashPathData: notPorted('updateFlashPathData'),
  getFlashPathData: notPorted('getFlashPathData'),
  loadFilterModel: notPorted('loadFilterModel'),
  saveFilterModel: notPorted('saveFilterModel'),
  loadSelectionModel: notPorted('loadSelectionModel'),
  saveSelectionModel: notPorted('saveSelectionModel'),
  readDirectory: notPorted('readDirectory'),
  readFileContent: notPorted('readFileContent'),
  findHexFile: notPorted('findHexFile'),
  saveVisiblePages: notPorted('saveVisiblePages'),
  loadVisiblePages: notPorted('loadVisiblePages'),
  saveApiTestState: notPorted('saveApiTestState'),
  loadApiTestState: notPorted('loadApiTestState'),
  clearCaches: notPorted('clearCaches'),
  getSelectedCertificate: notPorted('getSelectedCertificate'),
  getSelectedCredential: notPorted('getSelectedCredential'),
  getApiCredentialConfigs: notPorted('getApiCredentialConfigs'),
  setApiCredentialConfigs: notPorted('setApiCredentialConfigs'),
  runCommandWithRealTimeOutput: notPorted('runCommandWithRealTimeOutput'),
  stopCommand: notPorted('stopCommand'),
  getPostmanCollectionPath: notPorted('getPostmanCollectionPath'),
  scanPostmanCollections: notPorted('scanPostmanCollections'),
  loadCachedPostmanCollections: notPorted('loadCachedPostmanCollections'),
  executePostmanRequest: notPorted('executePostmanRequest'),
  savePostmanCollection: notPorted('savePostmanCollection'),
  listSerialPorts: notPorted('listSerialPorts'),
  configureSerialPort: notPorted('configureSerialPort'),
  openSerialPort: notPorted('openSerialPort'),
  closeSerialPort: notPorted('closeSerialPort'),
  sendFileSerial: notPorted('sendFileSerial'),
  receiveFileSerial: notPorted('receiveFileSerial'),
  sendSerialData: notPorted('sendSerialData'),
  startSerialListening: notPorted('startSerialListening'),
  scanNetworkDevices: notPorted('scanNetworkDevices'),
  testSshConnection: notPorted('testSshConnection'),
};

export default api;
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/api/index.test.js`
Expected: 3 個測試 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/api/index.js src/api/index.test.js
git commit -m "feat(api): tauri abstraction layer with NotPorted stubs and listener map"
```

---

## Task 7: 啟動時掛載 api 到 `window.electronAPI`

**Files:**
- Modify: `src/index.jsx`

- [ ] **Step 1: 修改 `src/index.jsx`**

把現有檔案改為（在 render 前掛載並初始化 api）：
```jsx
import './processShim';
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import api, { initApi } from './api';

// 方案 A：把 api 掛到 window.electronAPI，既有 31 個呼叫點無需改動
window.electronAPI = api;

const container = document.getElementById('root');
const root = createRoot(container);

initApi().finally(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
```

- [ ] **Step 2: 確認前端既有測試不受影響**

`src/setupTests.js` 已在 `beforeEach` 以 `createMockElectronAPI()` 覆蓋 `window.electronAPI`，故元件測試仍用 mock，不會碰到真實 Tauri。無需修改 setupTests。

Run: `npx vitest run`
Expected: 既有測試套件維持綠燈（與遷移前相同的通過/失敗基準；不應因本變更新增 failure）。

> 若 `npx vitest run` 在遷移前就有既存 failure，記錄基準數字；本 Task 不得讓 failure 數增加。

- [ ] **Step 3: Commit**

```bash
git add src/index.jsx
git commit -m "feat: mount tauri api as window.electronAPI at startup"
```

---

## Task 8: 端到端煙霧測試（手動驗證）

**Files:** 無（驗證）

- [ ] **Step 1: 啟動 Tauri 開發模式**

Run（專案根）: `npm run tauri:dev`
Expected: Vite 起在 3000、Rust 編譯後彈出無邊框視窗，載入現有 React UI 並渲染首頁。

- [ ] **Step 2: 驗證視窗控制**

操作：點自訂 titlebar 的最小化 / 最大化（toggle）/ 關閉鈕。
Expected: 三者都正常作用（關閉會結束 App）。

- [ ] **Step 3: 驗證 `get_platform` / 設定視窗**

在 DevTools console（dev 模式可開）執行：
```js
await window.electronAPI.getPlatform()
```
Expected: 回傳 `"win32"`（Windows）。
再呼叫觸發開設定視窗的 UI（或 console `window.electronAPI.openSettings()`）。
Expected: 開出設定視窗；再次呼叫只聚焦、不重複開。

- [ ] **Step 4: 驗證 stub 行為**

console 執行：
```js
try { window.electronAPI.loadConfig() } catch (e) { e.name }
```
Expected: `"NotPortedError"`。

- [ ] **Step 5: 打包煙霧測試（可選，確認 build 管線）**

Run: `npm run tauri:build`
Expected: 產生 Windows 安裝包（`src-tauri/target/release/bundle/`）。macOS 上則產 dmg。

- [ ] **Step 6: 記錄結果**

把 Step 1–5 的實際觀察記在 commit 訊息或 PR 描述。本階段不寫程式碼，故無 commit（除非修了問題）。

---

## 階段 0 完成定義（對照 spec §5）

- [ ] `npm run tauri:dev` 能啟動，現有 React UI 正常渲染
- [ ] 無邊框視窗 + 最小化/最大化/關閉/開設定視窗皆可用
- [ ] `window.electronAPI` 已掛載；`getPlatform`/`getProcessEnv` 回傳正確值
- [ ] 未移植方法丟 `NotPortedError`
- [ ] Rust 單元測試（`cargo test`）綠
- [ ] 前端 vitest 未新增 failure

---

## Self-Review 紀錄

- **Spec 覆蓋**：對應 spec §1（架構/結構/視窗模型）、§2（api 契約、監聽器 Map、混合方法中的 getPlatform/getProcessEnv、事件常數）、§4（AppError、panic hook、log plugin、parking_lot）、§7 bug #3（open_settings 不把 query 放進路徑）與 #4（listener Map）。階段 0 範圍內無遺漏。
- **Placeholder 掃描**：無 TBD/TODO；每個程式步驟都有完整程式碼與預期輸出。
- **型別一致性**：`AppError`/`AppResult` 定義於 error.rs；`get_platform`/`get_process_env`/`open_settings` 三者皆在 lib.rs `generate_handler!` 註冊，且與 api 模組的 `invoke('get_platform'|'get_process_env'|'open_settings')` 名稱一致；事件名稱（`config-updated`）前端字串與 events.rs 常數一致。
- **已知相依順序**：Task 4 與 Task 5 有循環引用風險，已於 Task 4 Step 4 標註暫時註解、Task 5 Step 2 打開，連續執行可一次編譯。
