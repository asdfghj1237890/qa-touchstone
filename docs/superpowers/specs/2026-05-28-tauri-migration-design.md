# Electron → Tauri 遷移設計文件

- 日期：2026-05-28
- 狀態：**待使用者 review**
- 進度：五段設計皆已確認並寫入

---

## 0. 背景與目標

現有專案 `SidewalkQAFriends` 是 Electron + React (MUI) 桌面 App，用於 Sidewalk 裝置 QA：
燒錄（Nordic/Silabs/EFD/RFD）、憑證管理、環境設定、即時指令監控。

**遷移動機**：擺脫 Electron/Node，縮小打包體積與記憶體佔用（Electron ~100MB → Tauri ~10MB）。

### 已確認的範圍決策

| 項目 | 決定 |
|------|------|
| 範圍 | **分階段完整遷移**，目標 feature parity |
| 平台 | **Windows + macOS** 都要（與現況相同） |
| 測試 | **保留前端 vitest 測試**（改 mock Tauri 層）+ Rust 後端加新單元測試 |
| 前端整合策略 | **方案 A：薄抽象層模組** |

### 現況規模（探查結果）

- Electron 主程序 `public/electron.js` 約 4,124 行，~70 個 IPC 方法。
- 前端 31 個檔案直接呼叫 `window.electronAPI.*`，無抽象層。
- 難點：XMODEM 序列傳輸（~1,050 行手寫狀態機）、網路裝置掃描（每子網 254 IP socket+DNS 探測）、AWS SigV4 + STS AssumeRole、即時子程序串流。
- Node 原生相依：`fs`、`path`、`https`/`http`、`crypto`、`child_process`、`os`、`dns`、`net`；npm：`aws4`、`serialport`、`tree-kill`、`electron-is-dev`。

---

## 1. 整體架構與專案結構

**技術選型**
- Tauri 2.x。
- 前端沿用 React 18 + MUI + Vite，不重寫。
- 後端 Rust，置於新的 `src-tauri/`。
- 開發時 Tauri 載入 Vite dev server；打包時載入 Vite build 產物。

**前端介面層（方案 A 核心）**
- 新增 `src/api/index.js`（可漸進改 `.ts`），對外導出前端現用的 ~70 個方法名稱，內部呼叫 Tauri `invoke()` / `listen()`。
- App 啟動時掛到 `window.electronAPI`，31 個既有呼叫點幾乎零改動。
- 未移植方法丟出 `NotPortedError('<method>')`。

**Rust 後端模組佈局（`src-tauri/src/`）**

| 檔案 | 職責 | 階段 |
|------|------|------|
| `main.rs` / `lib.rs` | Tauri builder、註冊 commands、初始化 state | 0 |
| `state.rs` | 共享狀態（子程序 handle、序列埠 handle、快取），以 `Mutex`/`RwLock` 保護 | 0 |
| `error.rs` | 統一錯誤型別 `AppError`（實作 `Serialize`） | 0 |
| `events.rs` | 事件名稱常數 | 0 |
| `config.rs` | config / userData / flashPathData（遷移+原子寫入+備份）/ filter / selection / visiblePages / apiTestState | 1 |
| `certs.rs` | 憑證遞迴掃描 + credential 解析（ini/json/csv） | 1 |
| `fsops.rs` | 對話框、read dir/file、find hex | 1 |
| `process.rs` | 子程序串流 + 停止（跨平台砍 process tree） | 2 |
| `aws.rs` | SigV4 簽章 + STS AssumeRole | 3 |
| `postman.rs` | collection 掃描/轉換/儲存 + 執行請求 | 3 |
| `serial.rs` | 序列埠 + XMODEM 收發 | 4 |
| `network.rs` | 子網掃描 + SSH 測試 | 5 |

**專案資料夾**
- 專案內新增 `src-tauri/`，保留 `src/`、`public/`。
- `public/electron.js`、`public/preload.js` 移植期間保留作參照，全部完成後移除。
- `vite.config.mjs` 微調（base 路徑、dev server port 對齊 Tauri）。
- `tauri.conf.json`：無邊框視窗（`decorations: false`）、Windows + macOS 打包目標。

**視窗模型**
- 主視窗 + 設定視窗皆無邊框、自訂控制；用 Tauri 多 window 設定重現，`close/minimize/maximize/open-settings` 改用 Tauri window API。

---

## 2. `api` 模組介面契約與 command/event 對應

**三條核心規則**
1. **命名轉換**：前端維持 camelCase；Tauri command 用 snake_case；轉換只在 `api` 模組內。Tauri v2 自動把 camelCase 參數鍵轉成 Rust snake_case 參數。
2. **回傳形狀逐字保留**：許多 handler 回傳 `{ success: true }` / `{ success: false, error }`（如 `saveConfig`、`updateFlashPathData`），Rust 端必須回傳相同形狀；真正的內部錯誤才用 `Result::Err` → invoke reject → JS throw（對應原本會 throw 的方法，如 `scanCertificates`）。
3. request/response 走 `invoke`；持續推播走 `listen`。

**事件對應**

| Electron 事件 | Tauri 事件 | 前端註冊方法 |
|---------------|-----------|--------------|
| `command-output` | `command-output` | `runCommandWithRealTimeOutput`、`processCommandOutput` |
| `config-updated` | `config-updated` | `onConfigUpdated` |
| `postman-collections-updated` | `postman-collections-updated` | `onPostmanCollectionsUpdated` |
| `xmodem-progress` | `xmodem-progress` | `onSerialProgress` |
| `serial-data-received` | `serial-data-received` | `onSerialDataReceived` |
| `serial-error` | `serial-error` | `onSerialError` |
| `process-env` | 改為啟動時 `invoke('get_process_env')` 同步取得 | `getProcessEnv` |

**監聽器移除相容**：`api` 模組維護 `Map<callback, unlistenFn>`；註冊時 `listen()` 並存 `cb → unlisten`；`removeXListener(cb)` 查 map 取出 unlisten 呼叫並刪除。前端 callback-identity API 不變。

**混合型方法**
- `runCommandWithRealTimeOutput(command, dir, callback)`：先 `listen('command-output', …)`，再 `invoke('run_command', {command, workingDirectory})`，`.finally()` 解除監聽，回傳 exit code。
- `stopCommand()`：`invoke('stop_command')`。
- `getPlatform()` / `getProcessEnv()`：啟動時一次性 `invoke` 取得後快取於模組變數，維持同步介面。

**代表性 command 對應（節錄；完整 ~70 項對應表於實作計畫補齊）**

| 前端方法 | Tauri command | 回傳形狀 |
|----------|---------------|----------|
| `loadConfig()` | `load_config` | config 物件（含 visiblePages 預設合併） |
| `saveConfig(c)` | `save_config` | `{ success, error? }` |
| `scanCertificates(p)` | `scan_certificates` | 陣列（失敗 throw） |
| `updateFlashPathData(d)` | `update_flash_path_data` | `{ success, error?, rejected? }` |
| `runCommandWithRealTimeOutput` | `run_command` + 事件 | exit code |
| `listSerialPorts()` | `list_serial_ports` | 埠陣列 |
| `executePostmanRequest(d)` | `execute_postman_request` | 回應物件 |

---

## 3. 資料流與共享狀態

**Rust 端共享狀態（Tauri `app.manage(AppState)`）**

| 狀態 | 型別 | 取代 Electron 的 |
|------|------|------------------|
| 目前子程序 | `Mutex<Option<ProcessHandle>>`（含 PID） | 全域 `currentProcess` |
| 序列埠連線 | `Mutex<Option<SerialConn>>` | 模組層 port |
| 各式快取 | `Mutex<Cache<T>>`（config/userData/certs/apiTestState，帶 TTL） | 那幾個 `*Cache` 物件 |

**flashPathData 競態**：Electron 用 `flashPathDataUpdateMutex` 布林旗標 + busy-wait 序列化更新。Rust 端在 command 內持有 `Mutex` guard 跨越整段「讀→改→寫」即由編譯器保證消除競態，不需旗標。

**典型 command 資料流（`saveConfig`）**
```
前端 api.saveConfig(c)
  → invoke('save_config', { config: c })
  → Rust save_config（async tauri::command）
      取 config 快取鎖 → 合併 → 原子寫入（temp + rename）→ 更新快取
      → app.emit("config-updated", merged)   ← 廣播所有視窗
  → 回傳 { success: true }
```

**跨視窗事件廣播**：Tauri `app.emit("config-updated", payload)` 預設廣播到所有視窗（取代 Electron 手動迭代 `getAllWindows()`）。`postman-collections-updated` 同理。

**串流資料流（`run_command`，階段 2）**
- `tokio::process::Command` 開子程序，stdout/stderr 接管後 spawn async task 逐行讀，每段 `app.emit("command-output", chunk)`。
- `invoke` future 於子程序結束時 resolve，回傳 exit code。
- child handle（含 pid）存入 `AppState.current_process`，供 `stop_command` 砍整棵 tree。

**序列資料流（階段 4 模式）**：開啟的埠包成「serial actor」task + channel；command 透過 channel 下指令，背景讀取 task 持續 `emit("serial-data-received")`、XMODEM 進度 `emit("xmodem-progress")`，避免 port handle 所有權與鎖競爭。

**userData 存放位置（已決定：(a) 從新開始）**
Tauri 用自己的 `app_config_dir()`/`app_data_dir()`（依 `tauri.conf.json` identifier），磁碟位置與 Electron 不同，舊資料不自動沿用。
- **採 (a)**：Tauri 用自己的目錄，舊資料不搬（重設成本低、最單純）。
- (b) 一次性遷移（啟動時偵測舊 Electron userData 並複製）可日後再加。

## 4. 錯誤處理

**統一錯誤型別（`error.rs`）**：用 `thiserror` 定義 `AppError` enum 並實作 `serde::Serialize`，command 回傳 `Result<T, AppError>` 時 `Err` 會序列化傳到 JS（invoke reject → 前端 catch）。變體：`Io`/`Json`/`Parse`/`Aws`/`Serial`/`Network`/`Process`/`NotFound` 等。

**兩種回傳模式（逐方法對應原行為）**

| 模式 | 何時用 | Rust 回傳 |
|------|--------|-----------|
| throw 型 | 原 handler 會 throw（如 `scanCertificates`） | `Result<T, AppError>` |
| `{success,error}` 型 | 原 handler 回 `{success:false,error}`（如 `saveConfig`、`updateFlashPathData`） | `Ok(CommandResult{success,error,…})` |

前端 `api` 模組：throw 型讓 rejection 自然上傳（保留元件 try/catch）；`{success,error}` 型原樣回傳。未移植方法丟 `NotPortedError`。

**檔案損毀復原**：flashPathData 的「temp 寫入 → 重新 parse 驗證 → rename 原子置換 → 保留 .bak → 損毀時從 .bak 還原」完整移植到 `config.rs`。

**Mutex 中毒**：改用 `parking_lot::Mutex`（無 poisoning），避免 panic 後鎖永久不可用。

**Panic／全域處理**：裝 `std::panic::set_hook` 記錄 panic；command 一律走 `Result`、對外部輸入不 `unwrap()`。

**日誌**：用 `tauri-plugin-log`（或 `tracing`）輸出到檔案 + devtools console，把 `console.log`/`[DEBUG MAIN]` 對應為 `log::debug!`/`info!`。

**使用者可見錯誤**：錯誤訊息維持與 UI 相容的字串；snackbar/dialog 仍由 React 層處理。

## 5. 測試策略與分階段交付

**測試策略（保留前端測試 + Rust 新測試）**
- **前端 vitest**：mock 點從 `window.electronAPI` 改為 mock `src/api` 模組（或用 `@tauri-apps/api/mocks` 的 `mockIPC`）；更新 `src/setupTests.js`。現有 `electron.test.jsx` 改寫為測 api 契約或移除。
- **Rust 單元測試**：各模組 `#[cfg(test)]`。檔案 I/O 用 `tempfile`；SigV4 對 AWS 已知測試向量；JSON 遷移用 fixtures；XMODEM 狀態機用模擬 byte stream。需硬體的部分靠手動驗證。

**分階段交付與驗收標準**（每階段 = Rust commands + api 接線 + 前端測試綠 + Rust 測試綠 + 手動驗證）

| 階段 | 驗收「完成」標準 |
|------|------------------|
| **0** | `cargo tauri dev` 啟動、React UI 渲染、無邊框視窗 + min/max/close/open-settings 可用、`api` 模組已掛載、stub 丟 `NotPortedError`、`get_platform`/`get_process_env` 正常 |
| **1** | 設定頁讀寫 config、憑證掃描填表、flashPathData 來回讀寫且能遷移舊格式、對話框可開；相關前端測試綠；config 遷移/原子寫入/憑證掃描/credential 解析的 Rust 測試綠 |
| **2** | 燒錄指令即時串流到 UI、停止鈕在 Win+Mac 都能砍整棵 tree；實機燒錄驗證 |
| **3** | API Test 頁掃 collection、SigV4 簽章、AssumeRole、送請求並顯示回應；SigV4 對測試向量通過；一筆真實簽章請求成功 |
| **4** | 列舉/開關埠、對真實 RFD 裝置 XMODEM 收發檔案、序列資料 + 進度事件渲染；實機驗證 |
| **5** | 子網掃描找到裝置、SSH 測試回報可達性；實網驗證 |

**收尾（全階段完成後）**：移除 `public/electron.js`、`public/preload.js` 與 electron / electron-builder 相依；`package.json` scripts 改為 `tauri dev`/`tauri build`；`.gitignore` 加 `src-tauri/target`；產出 Win + Mac 安裝包。

**風險**：序列、網路、燒錄需實體硬體，無法全自動化測試——這幾階段驗收倚賴手動實機測試。

---

## 6. 實作計畫切分

本文件是整個遷移的**總設計（umbrella spec）**，6 個階段太大、不適合塞進單一實作計畫。切分原則：**每個階段各自走一次 writing-plans → 實作 → 驗收** 循環。

- **第一份實作計畫只涵蓋階段 0 + 階段 1**（骨架 + 檔案/設定領域）—— 這是讓 App 能跑起來、且風險最低的基礎。
- 階段 2–5 在前一階段驗收通過後，各自再開新的實作計畫。
- 每份計畫完成時回到本 spec 對照驗收標準。

---

## 7. 移植時要一併修正的既有 bug（來源：Codex review 2026-05-28）

審查整個現有工作樹後發現的缺陷。**移植時不要照搬，要在對應階段順手修正**。

| # | 嚴重度 | 既有問題（檔案:行） | 對應階段 | 移植時的正確做法 |
|---|--------|---------------------|----------|------------------|
| 1 | P1 | 命令輸出未跳脫就以 HTML 渲染（`NordicFlashPage.jsx:1149`） | 2 | `command-output` 內容一律當純文字渲染（或先 escape）再套格式，杜絕 XSS |
| 2 | P1 | `stop-command` 用 Windows-only 的 `tasklist`，macOS 砍不掉程序（`electron.js:1251`） | 2 | Rust `stop_command` 跨平台砍整棵 process tree（非 Windows 直接砍，不靠 tasklist 判斷） |
| 3 | P1 | 設定視窗把 `?window=settings` 放進 `path.join`，打包後開不了（`electron.js:328`） | 0 | 視窗參數用 Tauri 正規方式傳（query 接在 file URL 後、或用 window label/init 參數），不混進路徑 |
| 4 | P2 | `onConfigUpdated` 等註冊的 wrapper 與 `removeXListener` 對不上，監聽器洩漏（`preload.js:66`） | 0 | **設計已解決**：`api` 模組用 `Map<callback, unlistenFn>`（見 §2），確保能正確解除 |
| 5 | P2 | 發佈 script 呼叫不存在的 `test:ci`（`package.json:22`） | 收尾 | 改寫 scripts 為 `tauri` 時定義 `test:ci` 或移除該呼叫 |
| 6 | P2 | 二進位序列下載在 base64 解碼前就用長度驗證，必失敗（`electron.js:3272`） | 4 | XMODEM 接收：二進位路徑的大小驗證移到解碼之後 |
| 7 | P2 | 送 `Accept-Encoding` 但回應不解壓，顯示亂碼（`electron.js:2375`） | 3 | Rust 用 `reqwest`（自動解壓 gzip/deflate/br），或不送該 header |
| 8 | P2 | 環境覆寫時把端點第一段誤當 base path 砍掉（`electron.js:2328`） | 3 | 只剝除「已知的原始 base path」，不要剝任意第一段 |
| 9 | P2 | Swagger 2.0 沒有 `servers`，URL 組成相對路徑導致無法執行（`electron.js:1480`） | 3 | 從 `schemes`/`host`/`basePath` 組出完整 URL |
| 10 | P2 | SSH 密碼欄位沒接線，且 `test-ssh-connection` 強制 `PasswordAuthentication=no`（`FilesPage.jsx:2525`） | 5 | 把密碼接進 SSH/SCP 路徑，或移除/停用該欄位 |
