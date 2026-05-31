# QA Companion — AI 時代 API 測試能力評估

> 撰於 2026-05-31。盤點 QA Companion 對「AI 時代 API 測試必要元素」的覆蓋程度，並列出補強路線圖。
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

1. **Runner 改打真網路** — 複用 `executeRequest`，斷言跑在 live 回應上。把「規模驗證」從 demo 變真的最小改動，價值最大。非 Tauri（瀏覽器/dev）仍自然 fallback 罐頭。
2. **AI 當 oracle** — 發送後把 request + 回應丟給模型「這符合 spec 嗎 / 有什麼可疑」，把 AI 從出題搬到批改。複用 LLM 設定。
3. **Monitors 接真實 Runner** — 「Run now」真的跑（真實請求 + 斷言）取代亂數；真正的背景排程 cadence 屬獨立後續工作。
4. **（後續）authz matrix / schema conformance scan。**

> 進度：1、2、3 於 2026-05-31 開工。詳見對應的設計與 commit。
