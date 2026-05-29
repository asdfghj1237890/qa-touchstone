import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模擬 @tauri-apps/api
const invokeMock = vi.fn();
const listenMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a) => invokeMock(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a) => listenMock(...a) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: vi.fn(), minimize: vi.fn(), toggleMaximize: vi.fn() }) }));
const openMock = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a) => openMock(...a) }));

import { api, NotPortedError } from './index.js';

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

  it('未移植方法回傳 rejected promise（NotPortedError），不可同步 throw', async () => {
    const p = api.scanCredentials('/x');
    expect(typeof p.then).toBe('function');
    await expect(p).rejects.toBeInstanceOf(NotPortedError);
  });

  it('暴露所有 preload 的事件訂閱方法（避免呼叫到 undefined 而崩潰）', () => {
    for (const name of [
      'onConfigUpdated', 'removeConfigListener', 'onConfigLoaded',
      'processCommandOutput', 'removeCommandOutputListener',
      'onPostmanCollectionsUpdated', 'removePostmanCollectionsUpdatedListener',
      'onSerialProgress', 'removeSerialProgressListener',
      'onSerialDataReceived', 'removeSerialDataListener',
      'onSerialError', 'removeSerialErrorListener',
    ]) {
      expect(typeof api[name], `${name} 應為 function`).toBe('function');
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

  it('loadConfig 轉呼 invoke load_config（已移植，不再 NotPorted）', async () => {
    invokeMock.mockResolvedValue({ visiblePages: {} });
    await expect(api.loadConfig()).resolves.toEqual({ visiblePages: {} });
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

  it('readFileContent 轉呼 invoke read_file_content', async () => {
    invokeMock.mockResolvedValue('file contents');
    await expect(api.readFileContent('/a/b.txt')).resolves.toBe('file contents');
    expect(invokeMock).toHaveBeenCalledWith('read_file_content', { filePath: '/a/b.txt' });
  });

  it('scanCertificates 轉呼 invoke scan_certificates 帶 certificatesPath', async () => {
    invokeMock.mockResolvedValue([{ id: 'X1' }]);
    await expect(api.scanCertificates('/certs')).resolves.toEqual([{ id: 'X1' }]);
    expect(invokeMock).toHaveBeenCalledWith('scan_certificates', { certificatesPath: '/certs' });
  });

  it('getSelectedCertificate 轉呼 invoke get_selected_certificate', async () => {
    invokeMock.mockResolvedValue({ id: 'X1', certificateid: 'AAAA' });
    await expect(api.getSelectedCertificate()).resolves.toEqual({ id: 'X1', certificateid: 'AAAA' });
    expect(invokeMock).toHaveBeenCalledWith('get_selected_certificate');
  });

  it('updateFlashPathData 轉呼 invoke update_flash_path_data 帶 newData', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.updateFlashPathData({ path_type: 'nordic', saved_paths: [] });
    expect(invokeMock).toHaveBeenCalledWith('update_flash_path_data', { newData: { path_type: 'nordic', saved_paths: [] } });
  });

  it('getFlashPathData 轉呼 invoke get_flash_path_data 帶 pathType', async () => {
    invokeMock.mockResolvedValue({ certificate_folder_path: '', current_used_paths: {}, saved_paths: [] });
    await api.getFlashPathData('silabs');
    expect(invokeMock).toHaveBeenCalledWith('get_flash_path_data', { pathType: 'silabs' });
  });

  it('setApiCredentialConfigs 轉呼 invoke set_api_credential_configs 帶 apiConfigs', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.setApiCredentialConfigs([{ id: 'a' }]);
    expect(invokeMock).toHaveBeenCalledWith('set_api_credential_configs', { apiConfigs: [{ id: 'a' }] });
  });

  it('stopCommand 轉呼 invoke stop_command', async () => {
    invokeMock.mockResolvedValue(undefined);
    await api.stopCommand();
    expect(invokeMock).toHaveBeenCalledWith('stop_command');
  });

  it('runCommandWithRealTimeOutput 先 listen command-output 再 invoke run_command，並回傳 exit code', async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    invokeMock.mockResolvedValue(0);
    const cb = vi.fn();
    const code = await api.runCommandWithRealTimeOutput('echo hi', null, cb);
    expect(code).toBe(0);
    expect(listenMock).toHaveBeenCalledWith('command-output', expect.any(Function));
    expect(invokeMock).toHaveBeenCalledWith('run_command', { command: 'echo hi', workingDirectory: null });
    expect(unlisten).toHaveBeenCalledTimes(1); // finally 解除
  });

  it('runCommandWithRealTimeOutput 的 callback 收到事件 payload 字串', async () => {
    let captured = null;
    listenMock.mockImplementation(async (_evt, handler) => {
      handler({ payload: 'line1' }); // 模擬一筆 command-output
      return vi.fn();
    });
    invokeMock.mockResolvedValue(0);
    const cb = vi.fn((d) => { captured = d; });
    await api.runCommandWithRealTimeOutput('x', null, cb);
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

  it('listSerialPorts 轉呼 invoke list_serial_ports', async () => {
    invokeMock.mockResolvedValue([{ path: 'COM7', manufacturer: 'Acme' }]);
    await expect(api.listSerialPorts()).resolves.toEqual([{ path: 'COM7', manufacturer: 'Acme' }]);
    expect(invokeMock).toHaveBeenCalledWith('list_serial_ports');
  });

  it('configureSerialPort 帶 config', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.configureSerialPort({ port: 'COM3', baudRate: 9600 });
    expect(invokeMock).toHaveBeenCalledWith('configure_serial_port', { config: { port: 'COM3', baudRate: 9600 } });
  });

  it('openSerialPort 帶 portPath', async () => {
    invokeMock.mockResolvedValue({ success: true, port: 'COM3' });
    await api.openSerialPort('COM3');
    expect(invokeMock).toHaveBeenCalledWith('open_serial_port', { portPath: 'COM3' });
  });

  it('closeSerialPort / sendSerialData / startSerialListening 轉呼對應 invoke', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.closeSerialPort();
    expect(invokeMock).toHaveBeenCalledWith('close_serial_port');
    await api.sendSerialData('AT\r');
    expect(invokeMock).toHaveBeenCalledWith('send_serial_data', { data: 'AT\r' });
    await api.startSerialListening();
    expect(invokeMock).toHaveBeenCalledWith('start_serial_listening');
  });

  it('sendFileSerial 帶 filePath/destPath', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.sendFileSerial('/a/f.txt', '/dev/dest');
    expect(invokeMock).toHaveBeenCalledWith('send_file_serial', { filePath: '/a/f.txt', destPath: '/dev/dest' });
  });

  it('receiveFileSerial 帶 savePath/remotePath', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.receiveFileSerial('/local/save', '/remote/f.bin');
    expect(invokeMock).toHaveBeenCalledWith('receive_file_serial', { savePath: '/local/save', remotePath: '/remote/f.bin' });
  });

  it('testSshConnection 帶 params', async () => {
    invokeMock.mockResolvedValue({ success: true, hostname: 'h' });
    await api.testSshConnection({ ip: '1.2.3.4', username: 'root' });
    expect(invokeMock).toHaveBeenCalledWith('test_ssh_connection', { ip: '1.2.3.4', username: 'root' });
  });

  it('scanNetworkDevices 帶 manualSubnet', async () => {
    invokeMock.mockResolvedValue([{ ip: '192.168.1.220', hostname: 'ring-x' }]);
    await expect(api.scanNetworkDevices('192.168.1')).resolves.toEqual([{ ip: '192.168.1.220', hostname: 'ring-x' }]);
    expect(invokeMock).toHaveBeenCalledWith('scan_network_devices', { manualSubnet: '192.168.1' });
  });
});
