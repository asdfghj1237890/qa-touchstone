const { contextBridge, ipcRenderer } = require('electron');

let processEnv = {};

contextBridge.exposeInMainWorld('electronAPI', {
  loadConfig: () => ipcRenderer.invoke('load-config'),
  onConfigLoaded: (callback) => ipcRenderer.on('config-loaded', callback),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  getProcessEnv: () => processEnv,
  getPlatform: () => process.platform,
  openSettings: () => ipcRenderer.send('open-settings'),
  scanCredentials: (path) => ipcRenderer.invoke('scan-credentials', path),
  scanCertificates: (path) => ipcRenderer.invoke('scan-certificates', path),
  loadUserData: () => ipcRenderer.invoke('load-user-data'),
  saveUserData: (userData) => ipcRenderer.invoke('save-user-data', userData),
  getCredentialsPath: () => ipcRenderer.invoke('get-credentials-path'),
  getCertificatesPath: () => ipcRenderer.invoke('get-certificates-path'),
  updateFlashPathData: (data) => ipcRenderer.invoke('update-flash-path-data', data),
  getFlashPathData: (pathType) => ipcRenderer.invoke('get-flash-path-data', pathType),
  loadFilterModel: () => ipcRenderer.invoke('load-filter-model'),
  saveFilterModel: (filterModel) => ipcRenderer.invoke('save-filter-model', filterModel),
  loadSelectionModel: () => ipcRenderer.invoke('load-selection-model'),
  saveSelectionModel: (selectionModel) => ipcRenderer.invoke('save-selection-model', selectionModel),
  selectFile: () => ipcRenderer.invoke('select-file'),
  runCommandWithRealTimeOutput: (command, workingDirectory, callback) => {
    console.log('[Preload] Setting up runCommandWithRealTimeOutput');
    const wrappedCallback = (_, data) => {
      console.log('[Preload] Received command output:', data.substring(0, 100));
      callback(data);
    };
    
    // Add the listener
    ipcRenderer.on('command-output', wrappedCallback);
    
    // Start the command and return the promise
    return ipcRenderer.invoke('run-command-with-real-time-output', command, workingDirectory)
      .then((exitCode) => {
        console.log('[Preload] Command completed with exit code:', exitCode);
        return exitCode;
      })
      .catch((error) => {
        console.error('[Preload] Command failed with error:', error);
        throw error;
      })
      .finally(() => {
        console.log('[Preload] Removing command-output listener');
        ipcRenderer.removeListener('command-output', wrappedCallback);
      });
  },
  stopCommand: () => {
    console.log('Stop command called from renderer process');
    console.log('Current window location:', window.location.href);
    console.log('Current time:', new Date().toISOString());
    return ipcRenderer.invoke('stop-command');
  },
  findHexFile: (folderPath) => ipcRenderer.invoke('find-hex-file', folderPath),
  readDirectory: (folderPath) => ipcRenderer.invoke('read-directory', folderPath),
  processCommandOutput: (callback) => ipcRenderer.on('command-output', callback),
  removeCommandOutputListener: (callback) => ipcRenderer.removeListener('command-output', callback),
  closeWindow: (windowType) => ipcRenderer.invoke('close-window', windowType),
  minimizeWindow: (windowType) => ipcRenderer.invoke('minimize-window', windowType),
  maximizeWindow: (windowType) => ipcRenderer.invoke('maximize-window', windowType),
  saveVisiblePages: (visiblePages) => ipcRenderer.invoke('save-visible-pages', visiblePages),
  loadVisiblePages: () => ipcRenderer.invoke('load-visible-pages'),
  onConfigUpdated: (callback) => ipcRenderer.on('config-updated', (event, config) => {
    try {
      if (config && typeof config === 'object') {
        callback(config);
      } else {
        console.warn('Received invalid config in config-updated event:', config);
      }
    } catch (error) {
      console.error('Error in onConfigUpdated callback:', error);
    }
  }),
  removeConfigListener: (callback) => ipcRenderer.removeListener('config-updated', callback),
  // Postman related APIs
  getPostmanCollectionPath: () => ipcRenderer.invoke('get-postman-collection-path'),
  scanPostmanCollections: (folderPath) => ipcRenderer.invoke('scan-postman-collections', folderPath),
  loadCachedPostmanCollections: () => ipcRenderer.invoke('load-cached-postman-collections'),
  executePostmanRequest: (details) => ipcRenderer.invoke('execute-postman-request', details),
  onPostmanCollectionsUpdated: (callback) => ipcRenderer.on('postman-collections-updated', callback),
  removePostmanCollectionsUpdatedListener: (callback) => ipcRenderer.removeListener('postman-collections-updated', callback),
  savePostmanCollection: (filePath, collectionData) => ipcRenderer.invoke('save-postman-collection', { filePath, collectionData }),
  // Credentials File Path API (now for multiple configurations)
  getApiCredentialConfigs: () => ipcRenderer.invoke('get-api-credential-configs'),
  setApiCredentialConfigs: (configs) => ipcRenderer.invoke('set-api-credential-configs', configs),
  // File Content Reading API (still used for individual file reading)
  readFileContent: (filePath) => ipcRenderer.invoke('read-file-content', filePath),
  // Get selected credential information
  getSelectedCredential: () => ipcRenderer.invoke('get-selected-credential'),
  // Expose getSelectedCertificate for API Test Page
  getSelectedCertificate: () => ipcRenderer.invoke('get-selected-certificate'),
  // API Test Page state persistence
  saveApiTestState: (state) => ipcRenderer.invoke('save-api-test-state', state),
  loadApiTestState: () => ipcRenderer.invoke('load-api-test-state'),
  // Cache management
  clearCaches: () => ipcRenderer.invoke('clear-caches'),
  // Serial port APIs for RFD devices
  listSerialPorts: () => ipcRenderer.invoke('list-serial-ports'),
  configureSerialPort: (config) => ipcRenderer.invoke('configure-serial-port', config),
  openSerialPort: (portPath) => ipcRenderer.invoke('open-serial-port', portPath),
  closeSerialPort: () => ipcRenderer.invoke('close-serial-port'),
  sendFileSerial: (filePath, destPath) => ipcRenderer.invoke('send-file-xmodem', filePath, destPath),
  receiveFileSerial: (savePath, remotePath) => ipcRenderer.invoke('receive-file-xmodem', savePath, remotePath),
  sendSerialData: (data) => ipcRenderer.invoke('send-serial-data', data),
  startSerialListening: () => ipcRenderer.invoke('start-serial-listening'),
  onSerialProgress: (callback) => ipcRenderer.on('xmodem-progress', (event, progress) => callback(progress)),
  onSerialDataReceived: (callback) => ipcRenderer.on('serial-data-received', (event, data) => callback(data)),
  onSerialError: (callback) => ipcRenderer.on('serial-error', (event, error) => callback(error)),
  removeSerialDataListener: (callback) => ipcRenderer.removeListener('serial-data-received', callback),
  removeSerialErrorListener: (callback) => ipcRenderer.removeListener('serial-error', callback),
  removeSerialProgressListener: (callback) => ipcRenderer.removeListener('xmodem-progress', callback),
  // Network scanning APIs for RFD devices
  scanNetworkDevices: (manualSubnet) => ipcRenderer.invoke('scan-network-devices', manualSubnet),
  testSshConnection: (params) => ipcRenderer.invoke('test-ssh-connection', params),
});

ipcRenderer.on('process-env', (event, env) => {
  processEnv = env;
});