# QA Touchstone — AI 時代 API 測試能力評估

> 撰於 2026-05-31。盤點 QA Touchstone 對「AI 時代 API 測試必要元素」的覆蓋程度，並列出補強路線圖。
> 評估根據實際原始碼，非功能清單。

## 框架：AI 時代，API 測試拆成兩半

1. **機械勞動**（AI 會吃掉的）：照 spec 產測試案例、邊界值、組 request、寫 assertion 樣板、比對回應、產報表。
2. **判斷 / oracle / 探索**（人不可取代、且更重要的）：定義「什麼叫對」（業務意圖、金額、授權邊界）、規模化驗證真實行為、探索意外、首次親自驗收。

工具的價值在於：讓 AI 處理第 1 半的「量」，讓人專心在第 2 半的「判斷」。

## 現況評估

### ✅ 機械那一半 — 做得扎實

| 能力 | 位置 | 狀態 |
|---|---|---|
| AI 生測試案例（built-in Claude / OpenAI / 自訂 + heuristic fallback；吃 BDD/OpenAPI/PRD/PDF；修補截斷 JSON、分類 happy/edge/negative） | `src/qa/TestGen.jsx` | ✅ 真貨 |
| 真實單發送（真打 HTTP）+ 斷言**跑在實際回應上** | `src/qa/executor.js`、`src/qa/ResponsePanel.jsx:158` | ✅ |
| 真實負載/壓力測試（k6 子行程、ndjson 串流） | `src/qa/PerfTest.jsx`、`k6gen.js`、`k6parse.js` | ✅ 已實機驗證 |
| Postman v2.1 / OpenAPI 匯入、CodeGen、Docs、5 種 auth、cookie jar（RFC 6265） | `ImportData/import-parser`、`CodeGen`、`Docs`、`SettingsPage` | ✅ Postman-class 底子 |

### ⚠️ 判斷那一半 — 大多還是 demo 級

| 缺口 | 位置 | 問題 |
|---|---|---|
| **Collection Runner 不打網路** | `src/qa/Runner.jsx:57` | 批次斷言對著罐頭 `window.QA.RESPONSES` 評估，不是真實 API。匯入 collection 的回應是 `synthResponse`（永遠 200/201 `{ok:true}`），所以「status==200」永遠綠燈，與真實後端無關。**規模化驗證該發生的地方跑在假資料上。** |
| **Monitors 是模擬的** | `src/qa/Monitors.jsx` | `Math.random() < 0.25` 假裝 pass/fail，沒有真的排程跑 collection。 |
| **AI 只用在「出題」、沒用在「批改」** | — | 模型負責生案例，但沒有拿來判斷「這個 200 語意上對不對」、從回應反推斷言、或抓異常。AI 被放在容易的那一半。 |
| **幾乎沒有 authz / 安全測試** | — | 能帶 token 發請求，但沒有 BOLA/BFLA、fuzzing、schema conformance scan。TestGen 會生「未授權→401」算沾到邊，不成體系。 |

## 一句話評

一個**扎實的「Postman-class client + AI 出題機 + 真 k6 壓測」**，但還不是能**閉環回答「真實 API 在規模下到底有沒有正確、有沒有越權」**的工具——而後者正是 AI 時代最該守住的那塊。最有機會贏的地方，恰好是現在最弱的地方。

## 補強路線圖（優先序）

1. ✅ **Runner 改打真網路** — 複用 `executeRequest`（`qa/sendRequest.js`），斷言跑在 live 回應上。非 Tauri（瀏覽器/dev）仍自然 fallback 罐頭。**已完成 2026-05-31。**
2. ✅ **AI 當 oracle** — ResponsePanel 加「AI review」：把 request + 回應 + 既有斷言丟給模型判斷，複用 `qa/llm.js`。**已完成 2026-05-31。**
3. ✅ **Monitors 接真實 Runner** — 「Run now」真的跑（真實請求 + 斷言）取代亂數。背景排程 cadence 仍為後續工作。**已完成 2026-05-31。**
4. ⬜ **（後續）背景 cadence 排程、批次 AI 審查、authz/BOLA matrix、schema conformance scan。**

> 進度：1、2、3 於 2026-05-31 完成（spec：[real-execution-and-ai-oracle](superpowers/specs/2026-05-31-real-execution-and-ai-oracle-design.md)，plan：[同名 plan](superpowers/plans/2026-05-31-real-execution-and-ai-oracle.md)）。共用層 `buildReq.js` / `sendRequest.js` / `llm.js`。
