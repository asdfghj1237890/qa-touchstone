import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模擬 @tauri-apps/api
const invokeMock = vi.fn();
const listenMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a) => invokeMock(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a) => listenMock(...a) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: vi.fn(), minimize: vi.fn(), toggleMaximize: vi.fn() }) }));
const openMock = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a) => openMock(...a) }));

import { api } from './index';

describe('api module', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    openMock.mockReset();
  });

  it('getPlatform 轉呼 invoke get_platform', async () => {
    invokeMock.mockResolvedValue('win32');
    await expect(api.getPlatform()).resolves.toBe('win32');
    expect(invokeMock).toHaveBeenCalledWith('get_platform');
  });

  it('暴露所有事件訂閱方法（避免呼叫到 undefined 而崩潰）', () => {
    for (const name of [
      'onConfigUpdated', 'removeConfigListener', 'onConfigLoaded',
      'processCommandOutput', 'removeCommandOutputListener',
      'onPostmanCollectionsUpdated', 'removePostmanCollectionsUpdatedListener',
    ]) {
      expect(typeof api[name], `${name} 應為 function`).toBe('function');
    }
  });

  it('已下線的 Electron 遺留方法不再暴露（serial / network / flash / certs / fsops legacy）', () => {
    for (const name of [
      'listSerialPorts', 'configureSerialPort', 'openSerialPort', 'closeSerialPort',
      'sendSerialData', 'startSerialListening', 'sendFileSerial', 'receiveFileSerial',
      'onSerialProgress', 'onSerialDataReceived', 'onSerialError',
      'testSshConnection', 'scanNetworkDevices',
      'updateFlashPathData', 'getFlashPathData',
      'scanCertificates', 'getCertificatesPath', 'getSelectedCertificate',
      'readDirectory', 'readFileContent', 'findHexFile',
      'runCommandWithRealTimeOutput', 'runProgramWithRealTimeOutput',
      'scanCredentials', 'getCredentialsPath', 'getSelectedCredential',
      'openSettings', 'closeWindow',
      'saveVisiblePages', 'loadVisiblePages', 'clearCaches',
      'saveFilterModel', 'loadFilterModel', 'saveSelectionModel', 'loadSelectionModel',
      'saveApiTestState', 'loadApiTestState',
    ]) {
      expect(api[name], `${name} 應已移除`).toBeUndefined();
    }
  });

  it('removeConfigListener 能用原 callback 解除監聽', async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const cb = vi.fn();
    api.onConfigUpdated(cb);
    await Promise.resolve();
    await Promise.resolve();
    api.removeConfigListener(cb);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('同一 callback 訂閱多個事件時，解除會清掉全部（不洩漏）', async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const cb = vi.fn();
    api.onConfigUpdated(cb);
    api.processCommandOutput(cb);
    await Promise.resolve();
    await Promise.resolve();
    api.removeConfigListener(cb);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it('loadConfig 轉呼 invoke load_config', async () => {
    invokeMock.mockResolvedValue({ theme: 'dark' });
    await expect(api.loadConfig()).resolves.toEqual({ theme: 'dark' });
    expect(invokeMock).toHaveBeenCalledWith('load_config');
  });

  it('saveConfig 帶參數轉呼 invoke save_config', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.saveConfig({ credentials: '/x' });
    expect(invokeMock).toHaveBeenCalledWith('save_config', { config: { credentials: '/x' } });
  });

  it('selectDirectory 透過 plugin-dialog open({directory:true})', async () => {
    openMock.mockResolvedValue('/picked/dir');
    await expect(api.selectDirectory()).resolves.toBe('/picked/dir');
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it('setApiCredentialConfigs 轉呼 invoke set_api_credential_configs 帶 apiConfigs', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.setApiCredentialConfigs([{ id: 'a' }]);
    expect(invokeMock).toHaveBeenCalledWith('set_api_credential_configs', { apiConfigs: [{ id: 'a' }] });
  });

  it('loadUserData / saveUserData 轉呼對應 invoke', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.saveUserData({ k: 'v' });
    expect(invokeMock).toHaveBeenCalledWith('save_user_data', { userData: { k: 'v' } });
    await api.loadUserData();
    expect(invokeMock).toHaveBeenCalledWith('load_user_data');
  });

  it('stopCommand 轉呼 invoke stop_command', async () => {
    invokeMock.mockResolvedValue(undefined);
    await api.stopCommand();
    expect(invokeMock).toHaveBeenCalledWith('stop_command');
  });

  it('runK6WithRealTimeOutput 先 listen command-output 再 invoke run_k6，並回傳 exit code', async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    invokeMock.mockResolvedValue(0);
    const cb = vi.fn();
    const args = ['run', '--quiet', '--summary-mode', 'disabled', '--out', 'json=-', '/tmp/script.js'];
    const code = await api.runK6WithRealTimeOutput(args, null, cb);
    expect(code).toBe(0);
    expect(listenMock).toHaveBeenCalledWith('command-output', expect.any(Function));
    expect(invokeMock).toHaveBeenCalledWith('run_k6', { args, workingDirectory: null });
    expect(unlisten).toHaveBeenCalledTimes(1); // finally 解除
  });

  it('runK6WithRealTimeOutput 的 callback 收到事件 payload 字串', async () => {
    let captured = null;
    listenMock.mockImplementation(async (_evt, handler) => {
      handler({ payload: 'line1' }); // 模擬一筆 command-output
      return vi.fn();
    });
    invokeMock.mockResolvedValue(0);
    const cb = vi.fn((d) => { captured = d; });
    await api.runK6WithRealTimeOutput(['run', '--quiet', '--summary-mode', 'disabled', '--out', 'json=-', '/tmp/script.js'], null, cb);
    expect(captured).toBe('line1');
  });

  it('getPostmanCollectionPath 轉呼 invoke get_postman_collection_path', async () => {
    invokeMock.mockResolvedValue('/p');
    await expect(api.getPostmanCollectionPath()).resolves.toBe('/p');
    expect(invokeMock).toHaveBeenCalledWith('get_postman_collection_path');
  });

  it('scanPostmanCollections 帶 folderPath', async () => {
    invokeMock.mockResolvedValue([{ name: 'c' }]);
    await expect(api.scanPostmanCollections('/p')).resolves.toEqual([{ name: 'c' }]);
    expect(invokeMock).toHaveBeenCalledWith('scan_postman_collections', { folderPath: '/p' });
  });

  it('loadCachedPostmanCollections 轉呼 invoke', async () => {
    invokeMock.mockResolvedValue([]);
    await expect(api.loadCachedPostmanCollections()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith('load_cached_postman_collections');
  });

  it('savePostmanCollection 帶 filePath/collectionData', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.savePostmanCollection('/p/c.json', { info: { name: 'c' } });
    expect(invokeMock).toHaveBeenCalledWith('save_postman_collection', { filePath: '/p/c.json', collectionData: { info: { name: 'c' } } });
  });

  it('executePostmanRequest 轉呼 invoke execute_postman_request 帶整個 details', async () => {
    invokeMock.mockResolvedValue({ success: true, status: 200, headers: {}, body: '{}' });
    const details = {
      requestDetails: { request: { method: 'GET', url: { raw: 'https://x/y' } } },
      params: {}, apiConfigId: null, selectedProfile: null,
      selectedEnvironment: null, isFileTransferCollection: false,
    };
    await api.executePostmanRequest(details);
    expect(invokeMock).toHaveBeenCalledWith('execute_postman_request', details);
  });

  // ── AWS secret keychain commands — IPC contract must match the Rust signatures
  // (commands/secrets.rs): set_aws_secret(id, secret), has_aws_secret(id),
  // delete_aws_secret(id). A param-name drift here is a silent runtime break.
  it('setAwsSecret 轉呼 invoke set_aws_secret 帶 id/secret', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.setAwsSecret('profile-1', 'sk-secret');
    expect(invokeMock).toHaveBeenCalledWith('set_aws_secret', { id: 'profile-1', secret: 'sk-secret' });
  });

  it('hasAwsSecret 轉呼 invoke has_aws_secret 帶 id 並回傳 boolean', async () => {
    invokeMock.mockResolvedValue(true);
    await expect(api.hasAwsSecret('profile-1')).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('has_aws_secret', { id: 'profile-1' });
  });

  it('deleteAwsSecret 轉呼 invoke delete_aws_secret 帶 id', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.deleteAwsSecret('profile-1');
    expect(invokeMock).toHaveBeenCalledWith('delete_aws_secret', { id: 'profile-1' });
  });

  it('暴露憑證秘密 keychain 方法', () => {
    for (const name of ['setAwsSecret', 'hasAwsSecret', 'deleteAwsSecret']) {
      expect(typeof api[name], `${name} 應為 function`).toBe('function');
    }
  });
});
