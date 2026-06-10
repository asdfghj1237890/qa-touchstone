// ── QA Touchstone — window 橋接的全域型別 ───────────────────────────────────
// 歷史包袱：部分共用工具與 demo 資料掛在 window 上（setup.js / components.jsx
// 的 Object.assign(window, ...)）。集中宣告在這裡，逐步收斂；新程式碼請改用
// 一般 import，不要再往 window 掛東西。

export {};

declare global {
  interface Window {
    /** Demo/canned 資料 + runtime collections（src/qa/setup.js 建立）。 */
    QA: any;
    /** 主題工具（applyTheme/methodColor/statusColor；src/qa/theme 建立）。 */
    QATheme: any;
    /** 變數替換/解析工具（src/qa/engine 掛上）。 */
    qaSubstitute?: (text: string, varMap: Record<string, string>) => string;
    qaVarMap?: (...args: any[]) => Record<string, string>;
    qaParseSetCookie?: (line: string, host: string, path: string) => any;
    /** Set-Cookie 捕捉 toast 的 App 層掛勾（ToastHost 訂閱）。 */
    highlightJson?: (json: string) => string;
    exportCollection?: (collection: any, env: any) => void;
    loadLlmCfg?: () => { provider: string; model: string; key: string; baseUrl: string };
    saveLlmCfg?: (cfg: any) => void;
    /** claude.ai Artifacts 沙箱注入；桌面版不存在。 */
    claude?: { complete: (req: { messages: Array<{ role: string; content: string }> }) => Promise<string> };
    /** Tauri 注入。 */
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

// ── 追加宣告（append-only）：src/qa/engine.ts 掛上 window 的其餘工具 ─────────
// 與上方 interface Window 做 declaration merging；過渡期型別從寬（any）。
declare global {
  interface Window {
    qaDynamic?: (name: string) => string | number | null;
    QA_DYNAMICS?: string[];
    qaVarSources?: (vars: any, envLabel?: string, collectionId?: string | null, local?: Record<string, any> | null) => Record<string, string>;
    QA_SCOPES?: string[];
    qaHasVars?: (text: unknown) => boolean;
    qaUnknownVars?: (text: string | null | undefined, map?: Record<string, string> | null) => string[];
    qaGetPath?: (obj: any, path: unknown) => any;
    qaAssertLabel?: (a: any) => string;
    qaEval?: (a: any, resp: any) => any;
    qaRunAssertions?: (list: any[] | null | undefined, resp: any) => any[];
    qaParseAssertion?: (str: string) => { type: string; op?: string; value?: number; path?: string; name?: string; text?: string; on: boolean };
    qaMergeCookie?: (jar: any[], ck: any) => any[];
    qaParseDataFile?: (text: string | null | undefined, filename?: string | null) => { rows: any[] | null; columns: string[]; error: string; format: 'json' | 'csv' | null };
  }
}

// ── 追加宣告（append-only）：src/processShim.ts 的 process polyfill ──────────
// 部分相依套件會讀 process.env.NODE_ENV；shim 只在瀏覽器掛上最小形狀。
declare global {
  interface Window {
    process?: { env: { NODE_ENV: string } };
  }
}

// ── 追加宣告（append-only）：src/qa/components.jsx 掛上 window 的 LLM 設定 ───
// SettingsPage.tsx（LlmSettings）讀取；components 轉 .tsx 前先從寬宣告（any）。
declare global {
  interface Window {
    LLM_DEFAULT_CFG?: any;
    LLM_PROVIDERS?: any;
  }
}
