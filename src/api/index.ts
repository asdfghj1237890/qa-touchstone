import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';

/** 事件 payload 一律是字串或 JSON 物件；橋接層從寬。 */
type EventCallback = (payload: any) => void;

// callback -> Promise<unlisten>[] 對應表，讓 removeXListener(cb) 能正確解除。
// 用陣列是因為同一個 callback 可能訂閱多個事件、或重複訂閱；以 callback 為單鍵
// 直接覆寫會導致先前的 unlisten 遺失而洩漏監聽器。
const listenerMap = new Map<EventCallback, Array<Promise<UnlistenFn>>>();

function subscribe(eventName: string, callback: EventCallback): void {
  const unlistenPromise = listen(eventName, (e) => callback(e.payload));
  const arr = listenerMap.get(callback) || [];
  arr.push(unlistenPromise);
  listenerMap.set(callback, arr);
}

function unsubscribe(callback: EventCallback): void {
  const arr = listenerMap.get(callback);
  if (arr) {
    arr.forEach((p) => p.then((unlisten) => unlisten()).catch(() => {}));
    listenerMap.delete(callback);
  }
}

export const api = {
  // --- 系統 / 視窗 ---
  getPlatform: (): Promise<string> => invoke('get_platform'),
  getAiPolicy: (): Promise<unknown> => invoke('get_ai_policy'),
  // Custom-titlebar X for the main window: quit the whole app deterministically
  // via a Rust command instead of relying on close() → CloseRequested → exit.
  quitApp: (): Promise<void> => invoke('quit_app'),
  minimizeWindow: (): Promise<void> => getCurrentWindow().minimize(),
  maximizeWindow: (): Promise<void> => getCurrentWindow().toggleMaximize(),

  // --- 事件訂閱 / 解除 ---
  onConfigUpdated: (cb: EventCallback) => subscribe('config-updated', cb),
  removeConfigListener: (cb: EventCallback) => unsubscribe(cb),
  onConfigLoaded: (cb: EventCallback) => subscribe('config-loaded', cb),
  processCommandOutput: (cb: EventCallback) => subscribe('command-output', cb),
  removeCommandOutputListener: (cb: EventCallback) => unsubscribe(cb),
  onPostmanCollectionsUpdated: (cb: EventCallback) => subscribe('postman-collections-updated', cb),
  removePostmanCollectionsUpdatedListener: (cb: EventCallback) => unsubscribe(cb),

  // --- 設定 / 憑證設定檔 ---
  loadConfig: (): Promise<Record<string, unknown>> => invoke('load_config'),
  saveConfig: (config: Record<string, unknown>): Promise<unknown> =>
    invoke('save_config', { config }),
  getApiCredentialConfigs: (): Promise<unknown> => invoke('get_api_credential_configs'),
  setApiCredentialConfigs: (configs: unknown[]): Promise<unknown> =>
    invoke('set_api_credential_configs', { apiConfigs: configs }),
  // --- AWS 秘密金鑰：存進 OS keychain（非 config.json 明文）---
  setAwsSecret: (id: string, secret: string): Promise<unknown> =>
    invoke('set_aws_secret', { id, secret }),
  hasAwsSecret: (id: string): Promise<boolean> => invoke('has_aws_secret', { id }),
  deleteAwsSecret: (id: string): Promise<unknown> => invoke('delete_aws_secret', { id }),
  selectDirectory: (): Promise<string | string[] | null> =>
    openDialog({ directory: true, multiple: false }),
  selectFile: (): Promise<string | string[] | null> =>
    openDialog({ directory: false, multiple: false }),

  // --- 匯出：原生存檔對話框 + 後端寫檔（取代在 WebView 失效的 blob 下載）---
  saveFileDialog: (opts: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null> => {
    // E2E seam（比照 App.tsx 的 __QA_ENABLE_UPDATE_CHECK__）：harness 設定
    // __QA_E2E_SAVE_DIR__ 時跳過原生存檔對話框、直接回傳目的路徑；後續
    // saveTextFile 的 Rust 寫檔照跑（0.21.1 的磁碟落檔行為仍被完整驗證）。
    // 一般執行時此全域不存在，行為不變。詳見 e2e/README.md。
    // 不加 build-mode gate（import.meta.env.PROD）：E2E 驅動的正是 release
    // build；且能設此全域者本就能直接 invoke save_text_file，無新增攻擊面。
    const e2eDir = window.__QA_E2E_SAVE_DIR__;
    if (typeof e2eDir === 'string' && e2eDir) {
      return Promise.resolve(
        e2eDir.replace(/[\\/]+$/, '') + '/' + (opts.defaultPath || 'export.txt')
      );
    }
    return saveDialog(opts);
  },
  saveTextFile: (path: string, contents: string): Promise<void> =>
    invoke('save_text_file', { path, contents }),
  downloadUpdateAsset: (url: string, path: string): Promise<void> =>
    invoke('download_update_asset', { url, path }),

  // --- 本機資料（qaStorage 磁碟鏡像）---
  loadUserData: (): Promise<unknown> => invoke('load_user_data'),
  saveUserData: (userData: unknown): Promise<unknown> => invoke('save_user_data', { userData }),

  // --- k6 效能測試 ---
  writeTempText: (content: string, suffix?: string): Promise<string> =>
    invoke('write_temp_text', { content, suffix }),
  cleanupTempFile: (path: string): Promise<void> => invoke('cleanup_temp_file', { path }),
  getK6Path: (): Promise<string> => invoke('get_k6_path'),
  runK6WithRealTimeOutput: async (
    args: string[],
    workingDirectory: string | null | undefined,
    callback: (line: string) => void
  ): Promise<number> => {
    const unlisten = await listen('command-output', (e) => callback(e.payload as string));
    try {
      return await invoke('run_k6', { args, workingDirectory });
    } finally {
      unlisten();
    }
  },
  stopCommand: (): Promise<void> => invoke('stop_command'),

  // --- Postman collections / 請求執行 ---
  getPostmanCollectionPath: (): Promise<string> => invoke('get_postman_collection_path'),
  scanPostmanCollections: (folderPath: string): Promise<unknown[]> =>
    invoke('scan_postman_collections', { folderPath }),
  loadCachedPostmanCollections: (): Promise<unknown[]> => invoke('load_cached_postman_collections'),
  // details 為 executor 的 QaPostmanPayload（具名介面無 index signature，從寬收 any）
  executePostmanRequest: (details: any): Promise<any> => invoke('execute_postman_request', details),
  savePostmanCollection: (filePath: string, collectionData: unknown): Promise<unknown> =>
    invoke('save_postman_collection', { filePath, collectionData }),
};

export default api;
