import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

export class NotPortedError extends Error {
  constructor(method) {
    super(`electronAPI.${method} 尚未移植到 Tauri`);
    this.name = 'NotPortedError';
  }
}

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
let cachedPlatform = 'win32';
let cachedProcessEnv = { NODE_ENV: 'production' };
export async function initApi() {
  // 非 Tauri（瀏覽器 fallback / 測試）：保留上方預設值，不去呼叫 invoke，
  // 否則每次啟動都會在 console 印出一筆 invoke undefined 的紅色錯誤。
  if (!hasTauri()) return;
  try {
    cachedPlatform = await invoke('get_platform');
    cachedProcessEnv = await invoke('get_process_env');
  } catch (e) {
    console.error('initApi failed', e);
  }
}

// 未移植方法：回傳 rejected promise（不可同步 throw）。
// 既有 electronAPI 方法全是 async，呼叫端常用 .catch() 或 await+try/catch；
// 同步 throw 會讓那些防護失效並使 React 樹崩潰。
const notPorted = (name) => () => Promise.reject(new NotPortedError(name));

export const api = {
  // --- 階段 0 真實實作 ---
  getPlatform: () => invoke('get_platform'),
  getProcessEnv: () => cachedProcessEnv,
  openSettings: () => invoke('open_settings'),
  closeWindow: () => getCurrentWindow().close(),
  // Custom-titlebar X for the main window: quit the whole app deterministically
  // via a Rust command instead of relying on close() → CloseRequested → exit.
  quitApp: () => invoke('quit_app'),
  minimizeWindow: () => getCurrentWindow().minimize(),
  maximizeWindow: () => getCurrentWindow().toggleMaximize(),

  // --- 事件訂閱 / 解除（接真實 Tauri listen；後端尚未發送時不觸發，但不崩潰）---
  onConfigUpdated: (cb) => subscribe('config-updated', cb),
  removeConfigListener: (cb) => unsubscribe(cb),
  onConfigLoaded: (cb) => subscribe('config-loaded', cb),
  processCommandOutput: (cb) => subscribe('command-output', cb),
  removeCommandOutputListener: (cb) => unsubscribe(cb),
  onPostmanCollectionsUpdated: (cb) => subscribe('postman-collections-updated', cb),
  removePostmanCollectionsUpdatedListener: (cb) => unsubscribe(cb),
  onSerialProgress: (cb) => subscribe('xmodem-progress', cb),
  removeSerialProgressListener: (cb) => unsubscribe(cb),
  onSerialDataReceived: (cb) => subscribe('serial-data-received', cb),
  removeSerialDataListener: (cb) => unsubscribe(cb),
  onSerialError: (cb) => subscribe('serial-error', cb),
  removeSerialErrorListener: (cb) => unsubscribe(cb),

  // --- 階段 1+ stub（依設計逐步取代；回傳 rejected promise）---
  loadConfig: () => invoke('load_config'),
  saveConfig: (config) => invoke('save_config', { config }),
  selectDirectory: () => openDialog({ directory: true, multiple: false }),
  selectFile: () => openDialog({ directory: false, multiple: false }),
  scanCredentials: notPorted('scanCredentials'),
  scanCertificates: (path) => invoke('scan_certificates', { certificatesPath: path }),
  loadUserData: () => invoke('load_user_data'),
  saveUserData: (userData) => invoke('save_user_data', { userData }),
  getCredentialsPath: notPorted('getCredentialsPath'),
  getCertificatesPath: () => invoke('get_certificates_path'),
  updateFlashPathData: (data) => invoke('update_flash_path_data', { newData: data }),
  getFlashPathData: (pathType) => invoke('get_flash_path_data', { pathType }),
  loadFilterModel: () => invoke('load_filter_model'),
  saveFilterModel: (filterModel) => invoke('save_filter_model', { filterModel }),
  loadSelectionModel: () => invoke('load_selection_model'),
  saveSelectionModel: (selectionModel) => invoke('save_selection_model', { selectionModel }),
  readDirectory: (folderPath) => invoke('read_directory', { folderPath }),
  readFileContent: (filePath) => invoke('read_file_content', { filePath }),
  writeTempText: (content, suffix) => invoke('write_temp_text', { content, suffix }),
  cleanupTempFile: (path) => invoke('cleanup_temp_file', { path }),
  getK6Path: () => invoke('get_k6_path'),
  findHexFile: (folderPath) => invoke('find_hex_file', { folderPath }),
  saveVisiblePages: (visiblePages) => invoke('save_visible_pages', { visiblePages }),
  loadVisiblePages: () => invoke('load_visible_pages'),
  saveApiTestState: (state) => invoke('save_api_test_state', { state }),
  loadApiTestState: () => invoke('load_api_test_state'),
  clearCaches: () => invoke('clear_caches'),
  getSelectedCertificate: () => invoke('get_selected_certificate'),
  getSelectedCredential: notPorted('getSelectedCredential'),
  getApiCredentialConfigs: () => invoke('get_api_credential_configs'),
  setApiCredentialConfigs: (configs) => invoke('set_api_credential_configs', { apiConfigs: configs }),
  runCommandWithRealTimeOutput: async (command, workingDirectory, callback) => {
    const unlisten = await listen('command-output', (e) => callback(e.payload));
    try {
      return await invoke('run_command', { command, workingDirectory });
    } finally {
      unlisten();
    }
  },
  // Structured-args spawn: no shell, no quoting. Use this for trusted
  // binaries (e.g. the bundled k6) — eliminates injection risk that a
  // shell-string call would carry even with internal-only inputs.
  runProgramWithRealTimeOutput: async (program, args, workingDirectory, callback) => {
    const unlisten = await listen('command-output', (e) => callback(e.payload));
    try {
      return await invoke('run_program', { program, args, workingDirectory });
    } finally {
      unlisten();
    }
  },
  stopCommand: () => invoke('stop_command'),
  getPostmanCollectionPath: () => invoke('get_postman_collection_path'),
  scanPostmanCollections: (folderPath) => invoke('scan_postman_collections', { folderPath }),
  loadCachedPostmanCollections: () => invoke('load_cached_postman_collections'),
  executePostmanRequest: (details) => invoke('execute_postman_request', details),
  savePostmanCollection: (filePath, collectionData) => invoke('save_postman_collection', { filePath, collectionData }),
  listSerialPorts: () => invoke('list_serial_ports'),
  configureSerialPort: (config) => invoke('configure_serial_port', { config }),
  openSerialPort: (portPath) => invoke('open_serial_port', { portPath }),
  closeSerialPort: () => invoke('close_serial_port'),
  sendFileSerial: (filePath, destPath) => invoke('send_file_serial', { filePath, destPath }),
  receiveFileSerial: (savePath, remotePath) => invoke('receive_file_serial', { savePath, remotePath }),
  sendSerialData: (data) => invoke('send_serial_data', { data }),
  startSerialListening: () => invoke('start_serial_listening'),
  scanNetworkDevices: (manualSubnet) => invoke('scan_network_devices', { manualSubnet }),
  testSshConnection: (params) => invoke('test_ssh_connection', params),
};

export default api;
