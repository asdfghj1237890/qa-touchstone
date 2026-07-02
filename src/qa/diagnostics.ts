// ── QA Touchstone — 匯出診斷資料（純組裝層）───────────────────────────────────
// 輸入一律由呼叫端（SettingsPage）蒐集後傳入；本模組刻意零 import，
// 保持純函式可測，也讓 tsconfig.strict.json 的 include 閉包只有這一支檔案。
//
// 隱私邊界（by construction）：輸入形狀只有版本/平台/外觀設定/儲存 key+位元組數/
// log 尾段 —— 沒有任何欄位能攜帶變數值、token、請求/回應內容或 LLM key。
// src/__tests__/diagnostics.test.ts 以 canary 值釘死這條邊界。

/** 單一 localStorage key 的健康資訊：只有 key 名與值的位元組數，絕不含值本身。 */
export interface StorageHealthEntry {
  key: string;
  bytes: number;
}

/** 報告要列的外觀/語系設定（值皆為 app 自訂的枚舉字串，非使用者資料）。 */
export interface DiagnosticsSettings {
  locale: string;
  accent: string;
  density: string;
}

export interface DiagnosticsInput {
  appVersion: string;
  platform: string;
  settings: DiagnosticsSettings;
  storage: StorageHealthEntry[];
  /** Rust read_app_logs 的 log 尾段；不可用時呼叫端放說明文字。 */
  logTail: string;
  /** ISO 時間戳；未給則取現在時間（測試傳固定值）。 */
  generatedAt?: string;
}

/** DOM Storage 的最小讀取面（length/key/getItem），方便測試餵假物件。 */
export type StorageLike = Pick<Storage, 'length' | 'key' | 'getItem'>;

const ENCODER = new TextEncoder();

/** 走訪 storage，只輸出 key 名與 UTF-8 位元組數（依 key 排序，locale 無關）。 */
export function collectStorageHealth(storage: StorageLike): StorageHealthEntry[] {
  const out: StorageHealthEntry[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key == null) continue;
    const value = storage.getItem(key);
    out.push({ key, bytes: value == null ? 0 : ENCODER.encode(value).length });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** 組出純文字診斷報告。 */
export function buildDiagnosticsReport(input: DiagnosticsInput): string {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const totalBytes = input.storage.reduce((sum, e) => sum + e.bytes, 0);
  const storageLines = input.storage.length
    ? input.storage.map((e) => `${e.key}: ${e.bytes} B`)
    : ['(empty)'];
  const lines = [
    'QA Touchstone diagnostics report',
    `generated: ${generatedAt}`,
    `app version: ${input.appVersion}`,
    `platform: ${input.platform}`,
    '',
    'PII-free by construction: no variable values, no tokens,',
    'no request/response bodies, no LLM keys.',
    '',
    '[settings]',
    `locale: ${input.settings.locale}`,
    `accent: ${input.settings.accent}`,
    `density: ${input.settings.density}`,
    '',
    '[storage health]',
    ...storageLines,
    `total: ${input.storage.length} keys, ${totalBytes} B`,
    '',
    '[app log tail]',
    input.logTail || '(no log content)',
    '',
  ];
  return lines.join('\n');
}
