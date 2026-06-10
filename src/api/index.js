import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

// callback -> Promise<unlisten>[] 對應表，讓 removeXListener(cb) 能正確解除。
// 用陣列是因為同一個 callback 可能訂閱多個事件、或重複訂閱；以 callback 為單鍵
// 直接覆寫會導致先前的 unlisten 遺失而洩漏監聽器。
const listenerMap = new Map();

function subscribe(eventName, callback) {
  const unlistenPromise = listen(eventName, (e) => callback(e.payload));
  const arr = listenerMap.get(callback) || [];
  arr.push(unlistenPromise);
  listenerMap.set(callback, arr);
}

function unsubscribe(callback) {
  const arr = listenerMap.get(callback);
  if (arr) {
    arr.forEach((p) => p.then((unlisten) => unlisten()).catch(() => {}));
    listenerMap.delete(callback);
  }
}

// Tauri 環境偵測：__TAURI_INTERNALS__ 由 Tauri 在載入腳本前注入。純瀏覽器
// （vite dev、vitest）下不存在，呼叫 invoke 會丟 "reading 'invoke'"。
// 與 qa/executor.js 的 hasTauri() 同一套判斷。
const hasTauri = () => typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);

// 啟動時一次性取得，維持同步介面
let cachedProcessEnv = { NODE_ENV: 'production' };
export async function initApi() {
  // 非 Tauri（瀏覽器 fallback / 測試）：保留上方預設值，不去呼叫 invoke，
  // 否則每次啟動都會在 console 印出一筆 invoke undefined 的紅色錯誤。
  if (!hasTauri()) return;
  try {
    cachedProcessEnv = await invoke('get_process_env');
  } catch (e) {
    console.error('initApi failed', e);
  }
}

export const api = {
  // --- 系統 / 視窗 ---
  getPlatform: () => invoke('get_platform'),
  getAiPolicy: () => invoke('get_ai_policy'),
  getProcessEnv: () => cachedProcessEnv,
  // Custom-titlebar X for the main window: quit the whole app deterministically
  // via a Rust command instead of relying on close() → CloseRequested → exit.
  quitApp: () => invoke('quit_app'),
  minimizeWindow: () => getCurrentWindow().minimize(),
  maximizeWindow: () => getCurrentWindow().toggleMaximize(),

  // --- 事件訂閱 / 解除 ---
  onConfigUpdated: (cb) => subscribe('config-updated', cb),
  removeConfigListener: (cb) => unsubscribe(cb),
  onConfigLoaded: (cb) => subscribe('config-loaded', cb),
  processCommandOutput: (cb) => subscribe('command-output', cb),
  removeCommandOutputListener: (cb) => unsubscribe(cb),
  onPostmanCollectionsUpdated: (cb) => subscribe('postman-collections-updated', cb),
  removePostmanCollectionsUpdatedListener: (cb) => unsubscribe(cb),

  // --- 設定 / 憑證設定檔 ---
  loadConfig: () => invoke('load_config'),
  saveConfig: (config) => invoke('save_config', { config }),
  getApiCredentialConfigs: () => invoke('get_api_credential_configs'),
  setApiCredentialConfigs: (configs) => invoke('set_api_credential_configs', { apiConfigs: configs }),
  selectDirectory: () => openDialog({ directory: true, multiple: false }),
  selectFile: () => openDialog({ directory: false, multiple: false }),

  // --- 本機資料（qaStorage 磁碟鏡像）---
  loadUserData: () => invoke('load_user_data'),
  saveUserData: (userData) => invoke('save_user_data', { userData }),

  // --- k6 效能測試 ---
  writeTempText: (content, suffix) => invoke('write_temp_text', { content, suffix }),
  cleanupTempFile: (path) => invoke('cleanup_temp_file', { path }),
  getK6Path: () => invoke('get_k6_path'),
  runK6WithRealTimeOutput: async (args, workingDirectory, callback) => {
    const unlisten = await listen('command-output', (e) => callback(e.payload));
    try {
      return await invoke('run_k6', { args, workingDirectory });
    } finally {
      unlisten();
    }
  },
  stopCommand: () => invoke('stop_command'),

  // --- Postman collections / 請求執行 ---
  getPostmanCollectionPath: () => invoke('get_postman_collection_path'),
  scanPostmanCollections: (folderPath) => invoke('scan_postman_collections', { folderPath }),
  loadCachedPostmanCollections: () => invoke('load_cached_postman_collections'),
  executePostmanRequest: (details) => invoke('execute_postman_request', details),
  savePostmanCollection: (filePath, collectionData) => invoke('save_postman_collection', { filePath, collectionData }),
};

export default api;
