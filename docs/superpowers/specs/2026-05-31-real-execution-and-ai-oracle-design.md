# 設計：真實批次執行 + AI oracle

> 2026-05-31。把 QA Companion 從「批次/監控跑在罐頭資料上」推進到「真實打網路 + AI 當批改」。
> 背景與動機見 [ai-era-api-testing-assessment.md](../../ai-era-api-testing-assessment.md)。

## 目標

逐項漸進落地三件事：

1. **Collection Runner 打真網路** — 斷言跑在 live 回應上，而非罐頭 `window.QA.RESPONSES`。
2. **Monitors「Run now」真跑** — 真實請求+斷言計分，取代 `Math.random()`。
3. **ResponsePanel 單筆 AI 審查** — 把 request+回應丟給模型判斷「符合 spec 嗎/有何可疑」。

交付節奏：**1 → 3 → 2**，每項各自可驗、可 commit。

非目標（明確排除）：背景 cadence 排程、批次 AI 審查、authz/BOLA/schema scan、重構已驗證的 `App.send`。

## 共用層（兩個小抽取）

### `src/qa/sendRequest.js`
純執行 helper，Runner 與 Monitors 共用。沿用 PerfTest 既有「自行從 `REQUEST_DETAILS` 組請求」的 precedent，**不動** `App.send`。

```
qaRunSavedRequest(reqMeta, { env, vars, cookies, sslVerify, oauthToken, collectionId }) -> Promise<response>
```

- 從 `reqMeta`（{id, method, path}）+ `window.QA.REQUEST_DETAILS[id]` 組出完整 request：
  - URL：`path` 去 query → 變數替換 → 絕對/相對判斷 → 相對則前綴 `env.baseUrl` → 重組 params（與 PerfTest/executor 同邏輯）。
  - headers / body：來自 det，經變數替換。
  - auth type：來自 det。
- 用 `window.qaVarMap(vars, env.label, collectionId, {})` 算 varMap，`window.qaSubstitute` 替換。
- cookie：用 `cookieMatches` 對組好的 URL 配對（best-effort，沿用 App 的同一套）。
- 呼叫既有 `executeRequest(req, env, varMap, { cookies, sslVerify, oauthToken })` 回傳 response。
- **非 Tauri 環境**：`executeRequest` 既有行為自動 fallback 罐頭 → 測試/瀏覽器 dev 仍可運作。

### `src/qa/llm.js`
把 [TestGen.jsx](../../../src/qa/TestGen.jsx) 內 local 的 `callLLM` 抽出共用。

```
qaCallLLM(prompt: string) -> Promise<string>
```

- 讀 `window.loadLlmCfg()`：`builtin`（`window.claude.complete`）/ `openai` / `custom`（`cfg.baseUrl`）。
- 無可用 provider 時 throw，呼叫端優雅降級。
- TestGen 改用此 helper（移除重複）。

## Item 1 — Runner 打真網路

**改動**：`src/qa/Runner.jsx`、`src/App.jsx`（多傳 props）。

- `App.jsx`：`<Runner ... cookies={cookies} sslVerify={sslVerify} oauthTokens={oauthTokens} />`。
- `Runner.run()` 改 async 序列：
  - 每個 queue item 呼叫 `qaRunSavedRequest(r, { env, vars, cookies, sslVerify, oauthToken: oauthTokens[r.id], collectionId: colId })` 取 **live response**。
  - `qaRunAssertions(tests[r.id] || [], liveResponse)` 跑在真實回應上。
  - 結果 row 的 status/time/passed/total 來自真實回應。
  - 沿用既有 stop / progress / delay 機制；保留 `iters` 上限（≤50）與 per-step delay，避免 hammer。
- 失敗請求（network error / 非 2xx）照實記錄，不中斷整批。

**測試**（vitest，無 Tauri → 罐頭 fallback）：
- Runner 跑完後 `passed/total` 反映 `qaRunAssertions` 對（罐頭）回應的真實評估，而非寫死。
- 一筆有斷言的請求：assert 結果計數正確；一筆無斷言：顯示 no tests。

## Item 3 — Monitors「Run now」真跑

**改動**：`src/qa/Monitors.jsx`、`src/App.jsx`（多傳 props）。

- `App.jsx`：`<MonitorsPage ... vars={vars} cookies={cookies} sslVerify={sslVerify} tests={tests} oauthTokens={oauthTokens} />`。
- `runNow(id)`：取該 monitor 的 collection（`m.collectionId`）的所有請求，逐一 `qaRunSavedRequest` + `qaRunAssertions`，統計 passed/failed/總耗時，記一筆**真實** run（取代 `Math.random()`）。
- `enabled`/`nextRun`/cadence 維持顯示性，明確不啟動背景排程（程式碼註明）。
- 找不到 collection（如 demo 重塑後 id 不符）→ 記一筆 0/0 或顯示 skip，不崩。

**測試**：`runNow` 產出的 passed/failed 來自真實斷言計數（罐頭 fallback 下可預期），非亂數。

## Item 2 — ResponsePanel 單筆 AI 審查

**改動**：`src/qa/ResponsePanel.jsx`、新增 `qa/llm.js`。

- 回應面板（status bar 或 tests 區附近）加「AI review」按鈕。
- 點擊：用 `reqPreview`（method/url/headers/body）+ response（status/headers/body 截斷）+ 該請求既有斷言（當「預期」）組 prompt，呼叫 `qaCallLLM`，顯示模型結論（一句判定 + 可疑點列點）。
- 狀態：idle / loading（spinner）/ done（顯示文字）/ error（降級訊息，同 TestGen 的「沒 key/built-in 不可用」處理）。
- prompt 帶「預期」：把該請求的 assertions 一併給模型，讓它對照而非空泛評論。

**測試**：
- `qaCallLLM` 抽取後 TestGen 既有測試仍綠。
- prompt builder（純函式）單元測試：含 method/url/status/預期斷言。
- LLM 以 mock 注入，驗 loading→done 流程與錯誤降級。

## 風險與相容

- **真打網路**：Runner/Monitors 在真實 Tauri 下會發實際流量；保留 iteration 上限 + delay。demo collection 全是無 auth 公開 API，安全。
- **歷史相容**：Runner/Monitors 結果結構不變（沿用既有欄位），只是數據來源從罐頭→真實。
- **測試環境**：vitest/瀏覽器無 Tauri，`executeRequest` fallback 罐頭，所有單元測試照舊可跑、可預期。
