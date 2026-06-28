// ── QA Touchstone — 統一本機儲存層 ───────────────────────────────────────────
// 取代散落各處的裸 localStorage 存取：
// 1. loadJSON/saveJSON、loadString/saveString：解析失敗回 fallback；寫入失敗
//    「不再無聲」—— console.error + 對 window 發出 'qa-storage-error' 事件，
//    App 層可據此顯示 toast。
// 2. 磁碟鏡像：MIRRORED_KEYS 透過 Tauri save_user_data/load_user_data 鏡像到
//    app-data 的 user_data.json。webview 快取被清掉（localStorage 蒸發）時，
//    開機自動從磁碟還原 —— findings/baseline/perf 歷史不再單點故障。
// 3. 機密不落鏡像：qa_llm_cfg 內含 API key，刻意排除在 MIRRORED_KEYS 之外。

export const STORAGE_ERROR_EVENT = 'qa-storage-error';

export const MIRRORED_KEYS = [
  'qa_security_lifecycle',
  'qa_security_snapshots',
  'qa_perf_runs',
  'qa_monitors',
  'qa_ai_privacy',
  'qa_accent',
  'qa_locale',
];

/** 磁碟鏡像 blob：`__qaMirror: 1` 版本標記 + 各鏡像 key 的 localStorage 原始字串。 */
export type MirrorBlob = Record<string, unknown>;

/** 磁碟鏡像後端的最小介面（src/api 的 load_user_data / save_user_data 橋接）。 */
export interface StorageMirrorApi {
  loadUserData(): Promise<unknown>;
  saveUserData(blob: MirrorBlob): Promise<unknown>;
}

const FLUSH_DELAY_MS = 1500;
let _api: StorageMirrorApi | null = null;
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

function notifyError(key: string, error: any) {
  try {
    window.dispatchEvent(
      new CustomEvent(STORAGE_ERROR_EVENT, {
        detail: { key, message: String((error && error.message) || error) },
      })
    );
  } catch {
    /* window unavailable（純 node 測試）— 已有 console.error */
  }
}

// ── Schema versioning / migration ───────────────────────────────────────────
// Persisted shapes drift over releases. Without a recorded version, an old
// user_data.json silently feeds a stale shape into new code — a latent data-loss
// bug. A store opts in by saving through saveVersioned (stamps SCHEMA_VERSION_FIELD)
// and reading through loadVersioned, which runs ordered migration steps to bring
// legacy data up to the current shape before the consumer ever sees it.
export const SCHEMA_VERSION_FIELD = '__schemaVersion';

/** migrations[i] upgrades a record from version i → i+1. Pure + synchronous. */
export type MigrationStep = (data: any) => any;

// Bring `parsed` up to `targetVersion`. Data with no recorded version (legacy
// raw) is treated as v0 and run through every step. Only object records carry a
// version stamp (arrays/scalars pass through unstamped — wrap them if needed).
export function migrateRecord(
  parsed: any,
  targetVersion: number,
  migrations: MigrationStep[] = []
): any {
  let data = parsed;
  let from = 0;
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    typeof data[SCHEMA_VERSION_FIELD] === 'number'
  ) {
    from = data[SCHEMA_VERSION_FIELD];
  }
  for (let v = from; v < targetVersion; v++) {
    const step = migrations[v];
    if (typeof step === 'function') data = step(data);
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    data[SCHEMA_VERSION_FIELD] = targetVersion;
  }
  return data;
}

// Versioned read: parse `key`, migrate to `currentVersion`, return the result —
// or `fallback` if the key is absent or a migration throws (never propagates).
export function loadVersioned<T = unknown>(
  key: string,
  currentVersion: number,
  migrations: MigrationStep[],
  fallback: T
): T {
  const raw = loadJSON<any>(key, null);
  if (raw == null) return fallback;
  try {
    return migrateRecord(raw, currentVersion, migrations) as T;
  } catch (e) {
    console.error(`qaStorage: migration failed for ${key}`, e);
    return fallback;
  }
}

// Versioned write: stamp `currentVersion` onto an object payload before persisting.
export function saveVersioned(key: string, currentVersion: number, value: unknown): boolean {
  const out =
    value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>), [SCHEMA_VERSION_FIELD]: currentVersion }
      : value;
  return saveJSON(key, out);
}

export function loadJSON<T = unknown>(key: string, fallback: T | null = null): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`qaStorage: failed to read ${key}`, e);
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`qaStorage: failed to write ${key}`, e);
    notifyError(key, e);
    return false;
  }
  scheduleMirrorFlush(key);
  return true;
}

export function loadString(key: string, fallback = ''): string {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : raw;
  } catch {
    return fallback;
  }
}

export function saveString(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {
    console.error(`qaStorage: failed to write ${key}`, e);
    notifyError(key, e);
    return false;
  }
  scheduleMirrorFlush(key);
  return true;
}

export function removeStorageKey(key: string): boolean {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.error(`qaStorage: failed to remove ${key}`, e);
    notifyError(key, e);
    return false;
  }
  scheduleMirrorFlush(key);
  return true;
}

function scheduleMirrorFlush(key: string): void {
  if (!_api || !MIRRORED_KEYS.includes(key)) return;
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(() => {
    flushMirror();
  }, FLUSH_DELAY_MS);
}

// 把鏡像 key 目前的 localStorage 原始字串寫進 user_data.json（debounce 後呼叫）。
export async function flushMirror(): Promise<void> {
  if (!_api) return;
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  const blob: MirrorBlob = { __qaMirror: 1 };
  for (const k of MIRRORED_KEYS) {
    try {
      const raw = localStorage.getItem(k);
      if (raw != null) blob[k] = raw;
    } catch {
      /* 單一 key 讀不到就略過 */
    }
  }
  try {
    await _api.saveUserData(blob);
  } catch (e) {
    console.error('qaStorage: disk mirror write failed', e);
  }
}

// App 開機（render 前）呼叫。非 Tauri 環境 loadUserData 會 reject —— 安靜停用鏡像。
// localStorage 已有的 key 一律以 localStorage 為準（不覆寫），只還原缺少的。
export async function initStorageMirror(
  api: StorageMirrorApi | null | undefined
): Promise<boolean> {
  if (!api || typeof api.loadUserData !== 'function') return false;
  let blob: unknown = null;
  try {
    blob = await api.loadUserData();
  } catch {
    return false; // 非 Tauri / 後端不可用：鏡像停用
  }
  _api = api;
  if (
    !blob ||
    typeof blob !== 'object' ||
    Array.isArray(blob) ||
    (blob as MirrorBlob).__qaMirror !== 1
  ) {
    return true; // 鏡像啟用，但磁碟尚無快照（首次啟動）
  }
  const snapshot = blob as MirrorBlob;
  for (const k of MIRRORED_KEYS) {
    try {
      if (localStorage.getItem(k) == null && typeof snapshot[k] === 'string') {
        localStorage.setItem(k, snapshot[k]);
      }
    } catch {
      /* 還原單一 key 失敗不阻斷其他 key */
    }
  }
  return true;
}

// 測試用：重設模組內部狀態。
export function _resetStorageMirrorForTests(): void {
  _api = null;
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
}
