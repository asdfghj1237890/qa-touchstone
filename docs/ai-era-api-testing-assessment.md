# QA Touchstone — AI 時代 API 測試能力評估

> 撰於 2026-05-31。盤點 QA Touchstone 對「AI 時代 API 測試必要元素」的覆蓋程度，並列出補強路線圖。
> 評估根據實際原始碼，非功能清單。

> **更新 2026-06-10：** 本文當初判斷「最該守住、卻最弱的是 authz / 安全測試」。
> 這個 bet 已被執行——安全測試套件（identity × endpoint RBAC 矩陣、物件層級
> 授權 BOLA/IDOR、rate-limit、findings lifecycle + baseline diff、SARIF/JUnit/
> HTML/JSON CI artifacts、AI 分流）現在是產品的**核心與首要賣點**（見 README
> 開頭與 v0.21.0 release）。下方「幾乎沒有 authz/安全測試」一節已不成立，保留
> 作為當時的時間點快照；路線圖第 4 項的 authz/BOLA matrix 已完成。仍未做的是
> fuzzing 與 schema conformance scan。同期另完成：移除遺留攻擊面、版本化磁碟
> 鏡像儲存層、完整 Public Suffix List cookie 防護、前端全面 TypeScript 化。

> **更新 2026-06-11（v0.22.0）：** 上一段的「仍未做」再清掉一批——**fuzzing**
> （5xx／stack-trace 洩漏／payload 反射偵測，`src/qa/fuzz.ts`）、**JSON-Schema/
> OpenAPI conformance 驗證**（`schemaConformance.ts`）與自動推導的 **BFLA**
> （OWASP API5，`bfla.ts`）已以純函式引擎出貨：完整單元測試、SARIF 規則中繼
> 資料已備妥於報告層，UI 整合為下一步。同版亦強化既有 oracles（RBAC soft-deny
> 偵測、BOLA 誤判防護、rate-limit 強度分級 none/weak/strong），並將 AWS secret
> key 移入 OS keychain。路線圖第 5 項僅剩批次 AI 審查與新引擎的 UI 接線。

> **更新 2026-07-02：** 路線圖第 5 項的「新引擎 UI 接線」已完成——fuzz／BFLA／
> conformance 三個引擎都已接入桌面版安全套件（`Security.tsx` 的 suite 引擎表
> `conformance/bfla/fuzz` adapters）。其中 fuzz 與 BFLA 另有 Rust port，也在
> headless `scan`（`cli/src/scan.rs`）執行；**conformance 目前仍是 TS-only
> （`schemaConformance.ts`），尚無 Rust port，故 CLI 不會跑它**——這是桌面與
> CLI 兩表面唯一剩下的引擎落差。下方各處「UI 整合為下一步／待做」為當時快照，
> 現已不成立。完整對照見 [capability-matrix.md](capability-matrix.md)。第 5 項
> 僅剩批次 AI 審查（第 6 項）與 conformance 的 Rust port。

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
| ~~**幾乎沒有 authz / 安全測試**~~（2026-06-10 已不成立） | `src/qa/Security.tsx`、`authz.ts`、`bola.ts`、`ratelimit.ts`、`securitySuite.ts`、`securityReport.ts` | 已建成完整安全測試套件：RBAC 矩陣、BOLA/IDOR、rate-limit、findings lifecycle、SARIF/JUnit 匯出。fuzzing、schema conformance 與 BFLA 引擎已於 v0.22.0 出貨（`fuzz.ts`、`schemaConformance.ts`、`bfla.ts`，待 UI 整合）。 |

## 一句話評

一個**扎實的「Postman-class client + AI 出題機 + 真 k6 壓測」**，但還不是能**閉環回答「真實 API 在規模下到底有沒有正確、有沒有越權**」的工具——而後者正是 AI 時代最該守住的那塊。最有機會贏的地方，恰好是現在最弱的地方。

## 補強路線圖（優先序）

1. ✅ **Runner 改打真網路** — 複用 `executeRequest`（`qa/sendRequest.js`），斷言跑在 live 回應上。非 Tauri（瀏覽器/dev）仍自然 fallback 罐頭。**已完成 2026-05-31。**
2. ✅ **AI 當 oracle** — ResponsePanel 加「AI review」：把 request + 回應 + 既有斷言丟給模型判斷，複用 `qa/llm.js`。**已完成 2026-05-31。**
3. ✅ **Monitors 接真實 Runner** — 「Run now」真的跑（真實請求 + 斷言）取代亂數。背景排程 cadence 仍為後續工作。**已完成 2026-05-31。**
4. ✅ **authz/BOLA matrix** 已完成（RBAC 矩陣 + BOLA/IDOR + rate-limit + findings lifecycle + SARIF/JUnit/HTML/JSON CI artifacts；現為產品核心）。背景 cadence 排程亦已完成（app 開啟時 enabled monitors 依 cadence 執行）。
5. ✅ **fuzzing、schema conformance scan、BFLA** — 純函式引擎已於 v0.22.0 出貨（完整單元測試 + SARIF 規則中繼資料）；桌面 UI 接線於 2026-07-02 完成（`Security.tsx` suite 引擎表）。fuzz／BFLA 另有 Rust port 也在 headless `scan` 執行；conformance 仍為 TS-only（CLI 尚缺 Rust port）。
6. ⬜ **（後續）批次 AI 審查。**

> 進度：1、2、3 於 2026-05-31 完成（spec：[real-execution-and-ai-oracle](superpowers/specs/2026-05-31-real-execution-and-ai-oracle-design.md)，plan：[同名 plan](superpowers/plans/2026-05-31-real-execution-and-ai-oracle.md)）。共用層 `buildReq.js` / `sendRequest.js` / `llm.js`。
