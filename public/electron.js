const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
//const isDev = process.env.NODE_ENV === 'development';
const fs = require('fs');
const fsPromises = require('fs').promises;
const { exec, spawn } = require('child_process');
const treeKill = require('tree-kill');
const https = require('https');
const http = require('http');
const url = require('url');
const aws4 = require('aws4');
const crypto = require('crypto');
const { SerialPort } = require('serialport');

// AWS STS role assumption helper
const assumeRole = async (credentials, roleArn, sessionName = 'SidewalkQAFriends') => {
  if (!roleArn) {
    console.log('[AWS STS] No roleArn provided, using credentials directly');
    return credentials;
  }

  console.log(`[AWS STS] Assuming role: ${roleArn}`);
  
  // Construct STS AssumeRole request with form-encoded data
  const stsParams = new URLSearchParams({
    'Action': 'AssumeRole',
    'Version': '2011-06-15',
    'RoleArn': roleArn,
    'RoleSessionName': sessionName,
    'DurationSeconds': '3600'
  });

  const stsBody = stsParams.toString();

  const stsOptions = {
    hostname: 'sts.amazonaws.com',
    port: 443,
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      'Content-Length': Buffer.byteLength(stsBody)
    },
    service: 'sts',
    region: 'us-east-1'
  };

  stsOptions.body = stsBody;

  // Sign the STS request
  const stsSignableOptions = {
    method: stsOptions.method,
    host: stsOptions.hostname,
    path: stsOptions.path,
    headers: { ...stsOptions.headers },
    body: stsOptions.body,
    service: stsOptions.service,
    region: stsOptions.region
  };

  aws4.sign(stsSignableOptions, credentials);
  stsOptions.headers = stsSignableOptions.headers;

  return new Promise((resolve, reject) => {
    const stsReq = https.request(stsOptions, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        console.log(`[AWS STS] Response status: ${res.statusCode}`);
        
        if (res.statusCode === 200) {
          try {
            // Parse XML response using simple regex (no external dependencies needed)
            const accessKeyMatch = responseBody.match(/<AccessKeyId>([^<]+)<\/AccessKeyId>/);
            const secretKeyMatch = responseBody.match(/<SecretAccessKey>([^<]+)<\/SecretAccessKey>/);
            const sessionTokenMatch = responseBody.match(/<SessionToken>([^<]+)<\/SessionToken>/);
            
            if (accessKeyMatch && secretKeyMatch && sessionTokenMatch) {
              console.log('[AWS STS] Successfully assumed role');
              resolve({
                accessKeyId: accessKeyMatch[1],
                secretAccessKey: secretKeyMatch[1],
                sessionToken: sessionTokenMatch[1]
              });
            } else {
              console.error('[AWS STS] Failed to parse credentials from XML response');
              console.error('[AWS STS] Response body:', responseBody);
              reject(new Error('Failed to parse credentials from STS response'));
            }
          } catch (parseError) {
            console.error('[AWS STS] Failed to parse STS response:', parseError);
            console.error('[AWS STS] Response body:', responseBody);
            reject(new Error(`Failed to parse STS response: ${parseError.message}`));
          }
        } else {
          console.error('[AWS STS] STS request failed:', responseBody);
          reject(new Error(`STS AssumeRole failed with status ${res.statusCode}: ${responseBody}`));
        }
      });
    });

    stsReq.on('error', (e) => {
      console.error(`[AWS STS] Request error: ${e.message}`);
      reject(e);
    });

    stsReq.write(stsBody);
    stsReq.end();
  });
};

// Add command line switches to reduce GPU-related errors
app.commandLine.appendSwitch('disable-gpu-memory-buffer-compositor-resources');
app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Get single instance lock to prevent multiple application launches
const gotTheLock = app.requestSingleInstanceLock();

// Add global error handlers
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  console.error('Stack trace:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

if (!gotTheLock) {
  // If lock not acquired, another instance is already running, quit current instance
  app.quit();
} else {
  // Listen for second instance launch events
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // If someone tries to run a second instance, focus the existing main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
      mainWindow.show();
    }
  });

  // Application startup logic
  app.whenReady().then(() => {
    try {
      mainWindow = createWindow();
      console.log('Main window created successfully');
    } catch (error) {
      console.error('Error creating main window:', error);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        try {
          mainWindow = createWindow();
          console.log('Main window recreated on activate');
        } catch (error) {
          console.error('Error recreating main window on activate:', error);
        }
      }
    });
  }).catch((error) => {
    console.error('Error during app startup:', error);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

const DEFAULT_VISIBLE_PAGES = {
  credentials: true,
  flashNordic: true,
  flashSilabs: true,
  flashEFD: true,
  flashRFD: true,
  tab6: true,
  apiTest: true,
  tab8: false
};

const USER_DATA_PATH = app.getPath('userData');
const CONFIG_FILE_PATH = path.join(USER_DATA_PATH, 'config.json');

let mainWindow;
let settingsWindow = null;

// Add mutex for flash path data operations to prevent race conditions
let flashPathDataUpdateMutex = false;

const selectDirectory = async () => {
  const parent = settingsWindow || mainWindow;
  const result = await dialog.showOpenDialog(parent, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
};

const selectFile = async () => {
  const parent = settingsWindow || mainWindow;
  const result = await dialog.showOpenDialog(parent, {
    properties: ['openFile', 'showHiddenFiles']
  });
  return result.filePaths[0];
};

function createWindow(windowName = 'main') {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      enableRemoteModule: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 },
    backgroundColor: '#121212'
  });

  // Disable navigation buttons and context menu
  win.webContents.on('dom-ready', () => {
    win.webContents.insertCSS(`
      ::-webkit-scrollbar { display: none; }
      webview { pointer-events: none; }
    `);
  });

  // Disable back/forward navigation
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Disable new window creation
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log('Page load failed:', errorCode, errorDescription);
  });

  win.webContents.on('did-finish-load', () => {
    console.log('Page load complete');
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../build/index.html')}`;

  console.log('Loading URL:', startUrl);
  win.loadURL(`${startUrl}?window=${windowName}`);

  // Pass environment variables to renderer
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('process-env', { NODE_ENV: process.env.NODE_ENV });
  });

  if (isDev) {
    win.webContents.openDevTools();
  }
  // Maximize the window if it's the main window
  if (windowName === 'main') {
    win.maximize();
    // Add close event handler for main window
    win.on('closed', () => {
      console.log('Main window closed, clearing mainWindow reference');
      mainWindow = null;
    });
  }

  return win;
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      enableRemoteModule: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 },
    backgroundColor: '#121212'
  });

  // Disable navigation buttons and context menu
  settingsWindow.webContents.on('dom-ready', () => {
    settingsWindow.webContents.insertCSS(`
      ::-webkit-scrollbar { display: none; }
      webview { pointer-events: none; }
    `);
  });

  // Disable back/forward navigation
  settingsWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Disable new window creation
  settingsWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  settingsWindow.maximize();
  
  settingsWindow.loadURL(
    isDev
      ? 'http://localhost:3000?window=settings'
      : `file://${path.join(__dirname, '../build/index.html?window=settings')}`
  );

  if (isDev) {
    settingsWindow.webContents.openDevTools();
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

ipcMain.on('open-settings', () => {
  // Check if settings window already exists and is not destroyed
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    // If settings window exists, focus and show it instead of creating a new one
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.focus();
    settingsWindow.show();
  } else {
    // Create new settings window only if none exists
    createSettingsWindow();
  }
});

// Cache for certificates data to reduce file system operations
const certificatesCache = {
  data: null,
  timestamp: 0,
  folderPath: '',
  CACHE_DURATION: 5 * 60 * 1000 // 5 minutes
};

// Cache for user data
const userDataCache = {
  data: null,
  timestamp: 0,
  CACHE_DURATION: 2 * 60 * 1000 // 2 minutes
};

// Cache for config data
const configCache = {
  data: null,
  timestamp: 0,
  CACHE_DURATION: 1 * 60 * 1000 // 1 minute
};

async function _loadConfigInternal() {
  const now = Date.now();
  
  // Return cached config if valid
  if (configCache.data && (now - configCache.timestamp) < configCache.CACHE_DURATION) {
    return configCache.data;
  }

  const configPath = path.join(app.getPath('userData'), 'config.json');
  let config = {};
  try {
    const data = await fsPromises.readFile(configPath, 'utf8');
    config = JSON.parse(data);
    
    // Update cache
    configCache.data = config;
    configCache.timestamp = now;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error reading config.json:', error);
    }
    // Default config
    config = {};
    configCache.data = config;
    configCache.timestamp = now;
  }
  return config;
}

async function _saveConfigInternal(newConfigData) {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    const currentConfig = await _loadConfigInternal();
    const mergedConfig = { ...currentConfig, ...newConfigData };
    await fsPromises.writeFile(configPath, JSON.stringify(mergedConfig, null, 2));
    
    // Update cache with new data
    configCache.data = mergedConfig;
    configCache.timestamp = Date.now();
    
    console.log('Configuration saved successfully');
    
    // Notify all windows about config update
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('config-updated', mergedConfig);
      }
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error saving config.json:', error);
    return { success: false, error: error.message };
  }
}

async function saveUserData(userData) {
  const userDataPath = path.join(app.getPath('userData'), 'user_data.json');
  console.log('Saving user data to:', userDataPath);
  try {
    await fsPromises.writeFile(userDataPath, JSON.stringify(userData, null, 2));
    
    // Update cache
    userDataCache.data = userData;
    userDataCache.timestamp = Date.now();
    
    console.log('User data saved successfully');
    return { success: true };
  } catch (error) {
    console.error('Error saving user data:', error);
    return { success: false, error: error.message };
  }
}

async function loadUserData() {
  const now = Date.now();
  
  // Return cached data if valid
  if (userDataCache.data && (now - userDataCache.timestamp) < userDataCache.CACHE_DURATION) {
    return userDataCache.data;
  }

  const userDataPath = path.join(app.getPath('userData'), 'user_data.json');
  try {
    const data = await fsPromises.readFile(userDataPath, 'utf8');
    const parsedData = JSON.parse(data);
    
    // Update cache
    userDataCache.data = parsedData;
    userDataCache.timestamp = now;
    
    return parsedData;
  } catch (error) {
    if (error.code === 'ENOENT') {
      const emptyData = [];
      userDataCache.data = emptyData;
      userDataCache.timestamp = now;
      return emptyData;
    }
    throw error;
  }
}

async function scanCertificates(certificatesPath) {
  const now = Date.now();
  
  // Check if we have valid cached data for this path
  if (certificatesCache.data && 
      certificatesCache.folderPath === certificatesPath &&
      (now - certificatesCache.timestamp) < certificatesCache.CACHE_DURATION) {
    console.log('Returning cached certificates data');
    return certificatesCache.data;
  }

  console.log('Scanning certificates in:', certificatesPath);
  const userData = [];
  let totalFiles = 0;
  let matchingFiles = 0;

  // Use a Set to track unique certificate IDs and prevent duplicates
  const seenCertificates = new Set();

  async function scanDirectory(dirPath) {
    try {
      // First check if the path is actually a directory
      const stats = await fsPromises.stat(dirPath);
      if (!stats.isDirectory()) {
        console.warn(`Skipping non-directory path: ${dirPath}`);
        return;
      }

      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
      
      // Process files in batches to improve performance
      const batchSize = 50;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        
        // Process batch sequentially to avoid race conditions with counters
        for (const entry of batch) {
          const fullPath = path.join(dirPath, entry.name);
          
          try {
            if (entry.isDirectory()) {
              await scanDirectory(fullPath);
            } else if (entry.isFile()) {
              totalFiles++;
              if (entry.name.match(/^certificate_[A-Za-z0-9]+\.json$/)) {
                try {
                  const content = await fsPromises.readFile(fullPath, 'utf8');
                  const data = JSON.parse(content);
                  const certificateId = entry.name.replace(/^certificate_|\.json$/g, '');
                  
                  // Create a unique key combining certificate ID and path to handle duplicates
                  const uniqueKey = `${certificateId}_${dirPath}`;
                  
                  // Skip if we've already seen this certificate in this path
                  if (seenCertificates.has(uniqueKey)) {
                    console.warn(`Duplicate certificate found: ${certificateId} in ${dirPath}`);
                    continue;
                  }
                  
                  seenCertificates.add(uniqueKey);
                  matchingFiles++;
                  
                  // Generate a more robust unique ID using timestamp + counter + hash
                  const uniqueId = `${now}_${matchingFiles}_${certificateId.slice(0, 8)}`;
                  
                  userData.push({
                    id: uniqueId,
                    certificateid: certificateId,
                    apid: data.metadata.apid,
                    deviceid: data.metadata.applicationDeviceId,
                    path: dirPath,
                    remark: ''
                  });
                } catch (error) {
                  console.error(`Error processing certificate file ${fullPath}:`, error);
                }
              }
              // Skip non-JSON files silently (like .zip files)
            }
            // Skip other file types (symbolic links, etc.)
          } catch (error) {
            console.error(`Error processing entry ${fullPath}:`, error);
            // Continue with next entry instead of stopping
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }
  }

  await scanDirectory(certificatesPath);
  console.log(`Scanned ${totalFiles} files, found ${matchingFiles} matching files.`);
  
  // Sort by certificate ID for consistent ordering
  userData.sort((a, b) => a.certificateid.localeCompare(b.certificateid));
  
  // Update cache
  certificatesCache.data = userData;
  certificatesCache.timestamp = now;
  certificatesCache.folderPath = certificatesPath;
  
  return userData;
}

// Clear caches when needed
function clearCaches() {
  certificatesCache.data = null;
  certificatesCache.timestamp = 0;
  certificatesCache.folderPath = '';
  
  userDataCache.data = null;
  userDataCache.timestamp = 0;
  
  configCache.data = null;
  configCache.timestamp = 0;
  
  // Clear API Test state cache
  apiTestStateCache = null;
  apiTestStateCacheTimestamp = 0;
}

// Add IPC handler to clear caches
ipcMain.handle('clear-caches', async () => {
  clearCaches();
  return { success: true };
});

ipcMain.handle('load-config', async () => {
  const config = await _loadConfigInternal();
  
  // Merge with default visible pages if visiblePages doesn't exist or is incomplete
  if (!config.visiblePages) {
    config.visiblePages = { ...DEFAULT_VISIBLE_PAGES };
  } else {
    // Fill in any missing properties with defaults
    config.visiblePages = { ...DEFAULT_VISIBLE_PAGES, ...config.visiblePages };
  }
  
  return config;
});

ipcMain.handle('save-config', async (event, newConfig) => {
  return _saveConfigInternal(newConfig);
});

ipcMain.handle('scan-certificates', async (event, certificatesPath) => {
  console.log('Starting certificates scan...');
  try {
    const userData = await scanCertificates(certificatesPath);
    console.log(`Scan complete. Found ${userData.length} matching files.`);
    await saveUserData(userData);
    
    return userData;
  } catch (error) {
    console.error('Error during certificates scan:', error);
    throw error;
  }
});

ipcMain.handle('load-user-data', async () => {
  return await loadUserData();
});

ipcMain.handle('save-user-data', async (event, userData) => {
  const result = await saveUserData(userData);
  return result;
});

ipcMain.handle('get-certificates-path', async () => {
  const config = await _loadConfigInternal();
  return config.credentials || null;
});

async function updateFlashPathData(newData) {
  // Wait for any ongoing update to complete to prevent race conditions
  while (flashPathDataUpdateMutex) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  flashPathDataUpdateMutex = true;
  
  try {
    const flashPathDataFile = path.join(app.getPath('userData'), 'flash_path_data.json');
    const flashPathDataTempFile = path.join(app.getPath('userData'), 'flash_path_data.json.tmp');
    const flashPathDataBackupFile = path.join(app.getPath('userData'), 'flash_path_data.json.bak');
    let flashPathData = {};

    console.log('Updating flash path data:', newData);

    try {
      const data = await fsPromises.readFile(flashPathDataFile, 'utf8');
      try {
        flashPathData = JSON.parse(data);
        console.log('Existing flash path data:', flashPathData);
      } catch (parseError) {
        console.error('JSON parse error in flash_path_data.json, attempting backup recovery:', parseError);
        
        // Try to restore from backup
        try {
          const backupData = await fsPromises.readFile(flashPathDataBackupFile, 'utf8');
          flashPathData = JSON.parse(backupData);
          console.log('Successfully restored from backup');
        } catch (backupError) {
          console.error('Backup recovery failed, using default structure:', backupError);
          flashPathData = {};
        }
      }

      // --- Start: Handle backward compatibility / migration ---
      if (flashPathData.hasOwnProperty('current_used_paths') && flashPathData.hasOwnProperty('saved_paths') && !flashPathData.hasOwnProperty('nordic')) {
        console.log('Old data format detected, migrating...');
        flashPathData.nordic = {
          current_used_paths: flashPathData.current_used_paths || {},
          saved_paths: flashPathData.saved_paths || []
        };
        delete flashPathData.current_used_paths;
        delete flashPathData.saved_paths;
        console.log('Migrated data:', flashPathData);
      }
      
      // Handle credential_folder_path to certificate_folder_path migration
      if (flashPathData.hasOwnProperty('credential_folder_path') && !flashPathData.hasOwnProperty('certificate_folder_path')) {
        console.log('Migrating credential_folder_path to certificate_folder_path...');
        flashPathData.certificate_folder_path = flashPathData.credential_folder_path;
        delete flashPathData.credential_folder_path;
      }
      // --- End: Handle backward compatibility / migration ---

    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error reading flash_path_data.json:', error);
        
        // Try backup recovery
        try {
          const backupData = await fsPromises.readFile(flashPathDataBackupFile, 'utf8');
          flashPathData = JSON.parse(backupData);
          console.log('Successfully restored from backup after read error');
        } catch (backupError) {
          console.error('Backup recovery failed after read error, using default structure:', backupError);
          flashPathData = {};
        }
      } else {
        console.log('flash_path_data.json does not exist, creating new file');
      }
    }

    // Determine the path type for the current operation
    const pathType = newData.path_type || 'nordic'; // default to nordic if not specified
    
    // Initialize path type structure if it doesn't exist
    if (!flashPathData[pathType]) {
      flashPathData[pathType] = { current_used_paths: {}, saved_paths: [] };
    }

    // Update current used paths for the specified type
    if (newData.current_used_paths) {
      console.log(`Updating current_used_paths for ${pathType}`);
      flashPathData[pathType].current_used_paths = {
        ...flashPathData[pathType].current_used_paths,
        ...newData.current_used_paths
      };
    }

    // Update saved paths for the specified type
    if (newData.saved_paths) {
      console.log(`Updating saved_paths for ${pathType}`);
      flashPathData[pathType].saved_paths = newData.saved_paths;
    }

    // Update certificate folder path (remains top-level)
    if (!flashPathData.hasOwnProperty('certificate_folder_path')) {
      flashPathData.certificate_folder_path = '';
    } 
    // Only update certificate_folder_path if it's explicitly provided in newData
    if (newData.hasOwnProperty('certificate_folder_path')) { 
      console.log('[DEBUG MAIN] Certificate folder path update:', {
        old: flashPathData.certificate_folder_path,
        new: newData.certificate_folder_path,
        callStack: new Error().stack.split('\n').slice(1, 5).join('\n')
      });
      
      // Prevent clearing of certificate_folder_path unless it's an explicit user action
      // If the old value exists and new value is empty, check if it's user-initiated
      if (flashPathData.certificate_folder_path && 
          flashPathData.certificate_folder_path.trim() !== '' && 
          (!newData.certificate_folder_path || newData.certificate_folder_path.trim() === '')) {
        
        if (newData.user_initiated) {
          // User explicitly wants to clear the path - allow it
          console.log('[DEBUG MAIN] User-initiated certificate_folder_path clearing from:', 
                     flashPathData.certificate_folder_path, 'to empty string - ALLOWED');
          flashPathData.certificate_folder_path = newData.certificate_folder_path;
        } else {
          // Automatic/system clearing - prevent it
          console.log('[DEBUG MAIN] Preventing automatic certificate_folder_path reset from:', 
                     flashPathData.certificate_folder_path, 'to empty string');
          console.log('[DEBUG MAIN] Call stack for rejected update:', new Error().stack.split('\n').slice(1, 8).join('\n'));
          // Return early with rejection status - don't continue with the update
          return { success: false, error: 'Certificate folder path reset prevented', rejected: true };
        }
      } else {
        flashPathData.certificate_folder_path = newData.certificate_folder_path;
      }
    }

    console.log('Updated flash path data structure:', flashPathData);

    try {
      // Create backup before writing
      try {
        const existingData = await fsPromises.readFile(flashPathDataFile, 'utf8');
        await fsPromises.writeFile(flashPathDataBackupFile, existingData);
        console.log('Backup created successfully');
      } catch (backupError) {
        if (backupError.code !== 'ENOENT') {
          console.warn('Failed to create backup (non-critical):', backupError);
        }
      }

      // Atomic write: write to temp file first
      const jsonContent = JSON.stringify(flashPathData, null, 2);
      await fsPromises.writeFile(flashPathDataTempFile, jsonContent);
      
      // Verify the temp file can be parsed
      const verifyData = await fsPromises.readFile(flashPathDataTempFile, 'utf8');
      JSON.parse(verifyData); // This will throw if corrupted
      
      // Atomic move: rename temp file to final file
      await fsPromises.rename(flashPathDataTempFile, flashPathDataFile);
      
      console.log('Flash path data saved successfully with atomic write');
      return { success: true };
    } catch (error) {
      console.error('Error writing flash_path_data.json:', error);
      
      // Clean up temp file if it exists
      try {
        await fsPromises.unlink(flashPathDataTempFile);
      } catch (unlinkError) {
        // Ignore unlink errors
      }
      
      return { success: false, error: error.message };
    }
  } finally {
    flashPathDataUpdateMutex = false;
  }
}

ipcMain.handle('update-flash-path-data', async (event, newData) => {
  console.log('Received update-flash-path-data request:', newData);
  const result = await updateFlashPathData(newData); // Capture the result
  console.log('update-flash-path-data request completed');
  return result; // Return the result to the renderer
});

ipcMain.handle('get-flash-path-data', async (event, pathType = 'nordic') => {
  console.log(`[DEBUG] get-flash-path-data called for pathType: ${pathType}`);
  const flashPathDataPath = path.join(app.getPath('userData'), 'flash_path_data.json');
  const flashPathDataBackupFile = path.join(app.getPath('userData'), 'flash_path_data.json.bak');
  let parsedData = {};
  
  // Add simple retry logic for file reading to handle temporary locks
  const readFileWithRetry = async (filePath, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fsPromises.readFile(filePath, 'utf8');
      } catch (error) {
        if (i === retries - 1) throw error; // Last attempt, throw the error
        if (error.code === 'EACCES' || error.code === 'EBUSY' || error.code === 'EPERM') {
          console.log(`File access issue on attempt ${i + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 50 * (i + 1))); // Exponential backoff
        } else {
          throw error; // Non-retriable error
        }
      }
    }
  };
  
  try {
    const data = await readFileWithRetry(flashPathDataPath);
    try {
      parsedData = JSON.parse(data);
    } catch (parseError) {
      console.error('JSON parse error in flash_path_data.json during read, attempting backup recovery:', parseError);
      
      // Only try backup recovery for actual JSON parse errors, not file access errors
      try {
        const backupData = await fsPromises.readFile(flashPathDataBackupFile, 'utf8');
        parsedData = JSON.parse(backupData);
        console.log('Successfully restored from backup during read');
        
        // Attempt to restore the corrupted main file with backup data (but don't block on failure)
        try {
          await updateFlashPathData(parsedData);
          console.log('Main file restored from backup');
        } catch (restoreError) {
          console.warn('Failed to restore main file from backup (non-critical):', restoreError);
        }
      } catch (backupError) {
        console.error('Backup recovery failed during read, returning default structure:', backupError);
        return { certificate_folder_path: '', current_used_paths: {}, saved_paths: [] };
      }
    }

    // --- Start: Handle backward compatibility / migration ---
    if (parsedData.hasOwnProperty('current_used_paths') && parsedData.hasOwnProperty('saved_paths') && !parsedData.hasOwnProperty('nordic')) {
      console.log('Old data format detected in getFlashPathData, migrating structure temporarily...');
      parsedData.nordic = {
        current_used_paths: parsedData.current_used_paths || {},
        saved_paths: parsedData.saved_paths || []
      };
      // Don't delete here as we are not saving back, just ensuring correct read structure
      // delete parsedData.current_used_paths;
      // delete parsedData.saved_paths;
    }
    
    // Handle credential_folder_path to certificate_folder_path migration
    if (parsedData.hasOwnProperty('credential_folder_path') && !parsedData.hasOwnProperty('certificate_folder_path')) {
      console.log('Migrating credential_folder_path to certificate_folder_path in read...');
      parsedData.certificate_folder_path = parsedData.credential_folder_path;
    }
    // --- End: Handle backward compatibility / migration ---

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('flash_path_data.json not found, returning default structure.');
      // Return default structure immediately if file not found
      return { certificate_folder_path: '', current_used_paths: {}, saved_paths: [] };
    } else {
      console.error('Error reading flash_path_data.json in getFlashPathData:', error);
      
      // For file access errors that persist after retries, try backup recovery
      if (error.code === 'EACCES' || error.code === 'EBUSY' || error.code === 'EPERM') {
        console.warn('Persistent file access error after retries, trying backup recovery:', error.code);
      }
      
      // Only try backup recovery for other types of errors that might indicate corruption
      try {
        const backupData = await fsPromises.readFile(flashPathDataBackupFile, 'utf8');
        parsedData = JSON.parse(backupData);
        console.log('Successfully restored from backup after read error');
      } catch (backupError) {
        console.error('Final backup recovery failed, returning default structure:', backupError);
        return { certificate_folder_path: '', current_used_paths: {}, saved_paths: [] };
      }
    }
  }
  
  // Ensure certificate_folder_path exists at the top level
  parsedData.certificate_folder_path = parsedData.certificate_folder_path || '';
  


  // Initialize structure for the requested pathType if it doesn't exist
  if (!parsedData[pathType]) {
    // Only log this if it's not a normal read operation
    if (Object.keys(parsedData).length > 1) {
      console.log(`Initializing structure for pathType: ${pathType}`);
    }
    parsedData[pathType] = { current_used_paths: {}, saved_paths: [] };
  }

  // Return structured data for the specified path type
  const result = {
    certificate_folder_path: parsedData.certificate_folder_path,
    current_used_paths: parsedData[pathType]?.current_used_paths || {},
    saved_paths: parsedData[pathType]?.saved_paths || []
  };
  
  console.log(`[DEBUG] Returning flash path data for ${pathType}:`, {
    certificate_folder_path: result.certificate_folder_path,
    current_used_paths: result.current_used_paths,
    saved_paths_count: result.saved_paths?.length || 0
  });
  
  return result;
});

async function saveFilterModel(filterModel) {
  const filterModelPath = path.join(app.getPath('userData'), 'filter_model.json');
  try {
    await fsPromises.writeFile(filterModelPath, JSON.stringify(filterModel, null, 2));
    console.log('Filter model saved successfully');
    return { success: true };
  } catch (error) {
    console.error('Error saving filter model:', error);
    return { success: false, error: error.message };
  }
}

async function loadFilterModel() {
  const filterModelPath = path.join(app.getPath('userData'), 'filter_model.json');
  try {
    console.log('Loading filter model from:', filterModelPath);
    const data = await fsPromises.readFile(filterModelPath, 'utf8');
    const parsedData = JSON.parse(data);
    console.log('Filter model loaded successfully:', parsedData);
    return parsedData;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Filter model file not found, returning null');
      return null;
    }
    console.error('Error loading filter model:', error);
    throw error;
  }
}

async function saveSelectionModel(selectionModel) {
  const selectionModelPath = path.join(app.getPath('userData'), 'selection_model.json');
  try {
    await fsPromises.writeFile(selectionModelPath, JSON.stringify(selectionModel, null, 2));
    console.log('Selection model saved successfully');
    return { success: true };
  } catch (error) {
    console.error('Error saving selection model:', error);
    return { success: false, error: error.message };
  }
}

async function loadSelectionModel() {
  const selectionModelPath = path.join(app.getPath('userData'), 'selection_model.json');
  try {
    const data = await fsPromises.readFile(selectionModelPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// Add function to get selected certificate information
async function getSelectedCertificate() {
  try {
    console.log('[electron] getSelectedCertificate called');
    
    const selectionModel = await loadSelectionModel();
    console.log('[electron] Selection model loaded:', selectionModel);
    
    if (!selectionModel || selectionModel.length === 0) {
      console.log('[electron] No certificate selected in selection model');
      return null; // No certificate selected
    }

    const selectedId = selectionModel[0];
    console.log('[electron] Selected certificate ID:', selectedId);
    
    // Get the user data (certificates)
    const userData = await (async () => {
      try {
        const data = await loadUserData();
        console.log('[electron] Loaded user data:', data ? `${data.length} certificates` : 'null');
        return data;
      } catch (error) {
        console.log('[electron] No user data file, attempting to scan certificates. Error:', error.message);
        // If no user data file, try to scan certificates from flash path data
        const certificatesPath = await (async () => {
          try {
            const flashPathData = await (async () => {
              const data = JSON.parse(await fsPromises.readFile(path.join(app.getPath('userData'), 'flash_path_data.json'), 'utf8'));
              return data;
            })();
            return flashPathData.certificate_folder_path;
          } catch (flashError) {
            console.log('[electron] No flash path data, falling back to config credentials');
            const config = await _loadConfigInternal();
            return config.credentials;
          }
        })();
        
        console.log('[electron] Certificates path from flash data:', certificatesPath);
        
        if (certificatesPath) {
          const scannedData = await scanCertificates(certificatesPath);
          console.log('[electron] Scanned certificates:', scannedData ? `${scannedData.length} certificates` : 'null');
          return scannedData || [];
        }
        return [];
      }
    })();

    // Find the selected certificate
    let selectedCertificate = userData.find(cert => cert.id === selectedId);
    
    console.log('[electron] Looking for certificate with ID:', selectedId);
    console.log('[electron] Available certificate IDs:', userData.map(cert => cert.id));

    // If not found with exact ID match, try to find by certificate ID (for backward compatibility)
    if (!selectedCertificate && selectedId) {
      // Extract certificate ID from old-format selection ID (e.g., "1749330818788_9_BAC62994")
      const parts = selectedId.split('_');
      if (parts.length >= 3) {
        const oldCertId = parts[parts.length - 1]; // Last part should be certificate ID
        console.log('[electron] Trying to find by certificate ID:', oldCertId);
        selectedCertificate = userData.find(cert => 
          cert.certificateid && cert.certificateid.startsWith(oldCertId)
        );
        
        if (selectedCertificate) {
          console.log('[electron] Found certificate by certificate ID match:', selectedCertificate.certificateid);
          // Update the selection model with the new ID format
          try {
            await saveSelectionModel([selectedCertificate.id]);
            console.log('[electron] Updated selection model with new ID:', selectedCertificate.id);
          } catch (error) {
            console.warn('[electron] Failed to update selection model:', error);
          }
        }
      }
    }

    if (selectedCertificate) {
      console.log('[electron] Found selected certificate:', {
        id: selectedCertificate.id,
        certificateId: selectedCertificate.certificateid,
        deviceId: selectedCertificate.deviceid,
        path: selectedCertificate.path
      });
    } else {
      console.log('[electron] No certificate found with selected ID:', selectedId);
    }

    return selectedCertificate || null;
  } catch (error) {
    console.error('[electron] Error getting selected certificate:', error);
    return null;
  }
}

ipcMain.handle('save-filter-model', async (event, filterModel) => {
  return await saveFilterModel(filterModel);
});

ipcMain.handle('load-filter-model', async () => {
  return await loadFilterModel();
});

ipcMain.handle('save-selection-model', async (event, selectionModel) => {
  return await saveSelectionModel(selectionModel);
});

ipcMain.handle('load-selection-model', async () => {
  return await loadSelectionModel();
});

// Add IPC handler for getting selected certificate
ipcMain.handle('get-selected-certificate', async (event) => {
  try {
    if (typeof getSelectedCertificate === 'function') {
      return await getSelectedCertificate();
    } else {
      return null;
    }
  } catch (err) {
    console.error('Error in get-selected-certificate handler:', err);
    return null;
  }
});

ipcMain.handle('select-directory', selectDirectory);
ipcMain.handle('select-file', selectFile);

let currentProcess = null;

ipcMain.handle('run-command-with-real-time-output', (event, command, workingDirectory) => {
  return new Promise((resolve, reject) => {
    console.log('Running command:', command);
    console.log('Working directory:', workingDirectory);

    // On macOS, use zsh to ensure proper PATH environment
    const isWindows = process.platform === 'win32';
    
    // Check if command needs sudo (for nrfjprog on macOS/Linux)
    let finalCommand = command;
    if (!isWindows && command.includes('nrfjprog')) {
      // Try to find nrfjprog path dynamically to support different Mac configurations
      try {
        const { execSync } = require('child_process');
        const nrfjprogPath = execSync('which nrfjprog', { encoding: 'utf8' }).trim();
        if (nrfjprogPath) {
          finalCommand = command.replace(/nrfjprog/g, nrfjprogPath);
          finalCommand = `sudo ${finalCommand}`;
          console.log('Added sudo with dynamic path for nrfjprog command:', finalCommand);
        } else {
          throw new Error('nrfjprog not found in PATH');
        }
      } catch (error) {
        console.warn('Could not find nrfjprog path dynamically, trying common locations:', error.message);
        // Fallback to common installation paths
        const commonPaths = [
          '/usr/local/bin/nrfjprog',
          '/opt/homebrew/bin/nrfjprog',
          '/usr/bin/nrfjprog',
          '/opt/local/bin/nrfjprog'
        ];
        
        let foundPath = null;
        for (const path of commonPaths) {
          try {
            require('fs').accessSync(path, require('fs').constants.F_OK);
            foundPath = path;
            break;
          } catch (e) {
            // Path doesn't exist, continue
          }
        }
        
        if (foundPath) {
          finalCommand = command.replace(/nrfjprog/g, foundPath);
          finalCommand = `sudo ${finalCommand}`;
          console.log('Added sudo with fallback path for nrfjprog command:', finalCommand);
                 } else {
           console.error('nrfjprog not found in any common locations. Please ensure nrfjprog is installed and in PATH.');
           console.error('Common installation methods:');
           console.error('- Homebrew: brew install --cask nordic-nrf-command-line-tools');
           console.error('- Manual: Download from Nordic Semiconductor website');
           finalCommand = `sudo ${command}`;
         }
      }
    } else if (isWindows && command.includes('nrfjprog')) {
      console.log('Running nrfjprog command on Windows (no sudo needed):', command);
    }
    
    const shellOptions = isWindows 
      ? { shell: true, cwd: workingDirectory }
      : { 
          shell: '/bin/zsh', 
          cwd: workingDirectory,
          env: { 
            ...process.env, 
            PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin'
          }
        };

    currentProcess = spawn(finalCommand, [], shellOptions);

    const sendOutput = (data) => {
      console.log('Sending output from main process:', data.toString());
      event.sender.send('command-output', data.toString());
    };

    currentProcess.stdout.on('data', sendOutput);
    currentProcess.stderr.on('data', sendOutput);

    currentProcess.on('error', (error) => {
      console.error('spawn error:', error);
      reject(error.toString());
    });

    currentProcess.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
      currentProcess = null;
      resolve(code);
    });
  });
});

ipcMain.handle('stop-command', async () => {
  console.log('stop-command received in main process');
  console.log('Current process state:', currentProcess ? 'Active' : 'Inactive');
  
  if (currentProcess && currentProcess.pid) {
    console.log('Current process PID:', currentProcess.pid);
    return new Promise((resolve) => {
      console.log('Attempting to terminate process with PID:', currentProcess.pid);
      
      exec(`tasklist /FI "PID eq ${currentProcess.pid}" /FO CSV /NH`, (error, stdout) => {
        if (stdout.includes(currentProcess.pid.toString())) {
          treeKill(currentProcess.pid, 'SIGKILL', (err) => {
            if (err) {
              console.warn('Error killing process:', err);
              console.warn('Error details:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
            } else {
              console.log('Process and its children terminated successfully');
            }
            currentProcess = null;
            console.log('currentProcess set to null');
            resolve();
          });
        } else {
          console.log('Process is no longer running');
          currentProcess = null;
          console.log('currentProcess set to null');
          resolve();
        }
      });
    });
  } else {
    console.log('No active process to terminate');
    currentProcess = null;
    return Promise.resolve();
  }
});

async function findHexFile(folderPath) {
  try {
    const files = await fsPromises.readdir(folderPath);
    for (const file of files) {
      if (path.extname(file).toLowerCase() === '.hex') {
        return path.join(folderPath, file);
      }
    }
    return null;
  } catch (error) {
    console.error('Error finding .hex file:', error);
    return null;
  }
}

ipcMain.handle('find-hex-file', async (event, folderPath) => {
  return await findHexFile(folderPath);
});

ipcMain.handle('read-directory', async (event, folderPath) => {
  try {
    return await fsPromises.readdir(folderPath);
  } catch (error) {
    console.error('Error reading directory:', error);
    return [];
  }
});

ipcMain.handle('close-window', (event, windowType) => {
  const window = windowType === 'settings' ? settingsWindow : mainWindow;
  if (window) window.close();
});

ipcMain.handle('minimize-window', (event, windowType) => {
  const window = windowType === 'settings' ? settingsWindow : mainWindow;
  if (window) window.minimize();
});

ipcMain.handle('maximize-window', (event, windowType) => {
  const window = windowType === 'settings' ? settingsWindow : mainWindow;
  if (window) {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  }
});

ipcMain.handle('save-visible-pages', async (event, visiblePages) => {
  console.log('[electron] Saving visiblePages:', visiblePages);
  return _saveConfigInternal({ visiblePages });
});

ipcMain.handle('load-visible-pages', async () => {
  const config = await _loadConfigInternal();
  
  // Merge with default visible pages if visiblePages doesn't exist or is incomplete
  if (!config.visiblePages) {
    return { ...DEFAULT_VISIBLE_PAGES };
  } else {
    // Fill in any missing properties with defaults
    return { ...DEFAULT_VISIBLE_PAGES, ...config.visiblePages };
  }
});

ipcMain.handle('get-postman-collection-path', async () => {
  const config = await _loadConfigInternal();
  return config.postmanCollectionPath; // Defaults are handled by _loadConfigInternal
});

const postmanCacheFilePath = path.join(app.getPath('userData'), 'postman_collections_cache.json');

// Helper function to convert OpenAPI spec to Postman-like structure
const convertOpenApiToPostmanLike = (openApiSpec, fileName, filePath) => {
  const collections = [];
  
  if (!openApiSpec.paths) return collections;
  
  // Helper function to resolve schema references
  const resolveSchemaRef = (schemaRef) => {
    console.log('[OpenAPI] resolveSchemaRef called with:', JSON.stringify(schemaRef, null, 2));
    
    if (typeof schemaRef === 'string' && schemaRef.startsWith('#/components/schemas/')) {
      const schemaName = schemaRef.replace('#/components/schemas/', '');
      console.log(`[OpenAPI] Resolving schema reference: ${schemaName}`);
      
      const resolvedSchema = openApiSpec.components?.schemas?.[schemaName] || null;
      console.log(`[OpenAPI] Resolved to:`, JSON.stringify(resolvedSchema, null, 2));
      return resolvedSchema;
    }
    
    if (schemaRef && typeof schemaRef === 'object' && schemaRef.$ref) {
      console.log(`[OpenAPI] Found $ref property: ${schemaRef.$ref}`);
      return resolveSchemaRef(schemaRef.$ref);
    }
    
    console.log('[OpenAPI] Returning schema as-is (no reference)');
    return schemaRef;
  };
  
  // Helper function to generate sample JSON from schema
  const generateSampleFromSchema = (schema) => {
    console.log('[OpenAPI] generateSampleFromSchema called with:', JSON.stringify(schema, null, 2));
    
    if (!schema) {
      console.log('[OpenAPI] Schema is null/undefined, returning empty object');
      return {};
    }
    
    const resolvedSchema = resolveSchemaRef(schema);
    console.log('[OpenAPI] Resolved schema:', JSON.stringify(resolvedSchema, null, 2));
    
    if (!resolvedSchema) {
      console.log('[OpenAPI] Resolved schema is null/undefined, returning empty object');
      return {};
    }
    
    if (resolvedSchema.type === 'object') {
      const sample = {};
      console.log('[OpenAPI] Processing object type schema');
      
      if (resolvedSchema.properties) {
        console.log('[OpenAPI] Found properties:', Object.keys(resolvedSchema.properties));
        
        Object.keys(resolvedSchema.properties).forEach(propName => {
          const propSchema = resolveSchemaRef(resolvedSchema.properties[propName]);
          console.log(`[OpenAPI] Processing property ${propName}:`, JSON.stringify(propSchema, null, 2));
          
          switch (propSchema?.type) {
            case 'string':
              // Remove quotes from string examples to avoid double-quoting in JSON.stringify
              sample[propName] = propSchema.example || `example_${propName}`;
              console.log(`[OpenAPI] Set string property ${propName} = ${sample[propName]}`);
              break;
            case 'number':
            case 'integer':
              sample[propName] = propSchema.example || 0;
              console.log(`[OpenAPI] Set number property ${propName} = ${sample[propName]}`);
              break;
            case 'boolean':
              sample[propName] = propSchema.example || false;
              console.log(`[OpenAPI] Set boolean property ${propName} = ${sample[propName]}`);
              break;
            case 'array':
              sample[propName] = propSchema.example || [];
              console.log(`[OpenAPI] Set array property ${propName} = ${sample[propName]}`);
              break;
            case 'object':
              sample[propName] = generateSampleFromSchema(propSchema);
              console.log(`[OpenAPI] Set object property ${propName} = ${JSON.stringify(sample[propName])}`);
              break;
            default:
              sample[propName] = propSchema.example || null;
              console.log(`[OpenAPI] Set default property ${propName} = ${sample[propName]}`);
          }
        });
      } else {
        console.log('[OpenAPI] No properties found in schema');
      }
      
      console.log('[OpenAPI] Generated sample object:', JSON.stringify(sample, null, 2));
      return sample;
    }
    
    console.log('[OpenAPI] Schema is not object type, returning example or empty object');
    return resolvedSchema.example || {};
  };
  
  // Create a collection for the OpenAPI spec
  const collection = {
    fileName: fileName,
    filePath: filePath,
    name: openApiSpec.info?.title || fileName.replace('.json', ''),
    description: openApiSpec.info?.description || '',
    type: 'openapi', // Mark as OpenAPI for special handling
    item: []
  };
  
  // Group endpoints by their first path segment
  const pathGroups = {};
  
  Object.keys(openApiSpec.paths).forEach(pathTemplate => {
    const pathObject = openApiSpec.paths[pathTemplate];
    const folderName = pathTemplate.split('/')[1] || 'Root';
    
    if (!pathGroups[folderName]) {
      pathGroups[folderName] = {
        name: folderName,
        item: []
      };
    }
    
    // Convert each HTTP method
    Object.keys(pathObject).forEach(method => {
      if (method === 'parameters') return; // Skip global parameters
      
      const operation = pathObject[method];
      if (method === 'options') return; // Skip CORS preflight for now
      
      // Build the base URL
      const baseUrl = openApiSpec.servers?.[0]?.url || '';
      let fullUrl = baseUrl + pathTemplate;
      
      // Replace server variables
      if (openApiSpec.servers?.[0]?.variables) {
        Object.keys(openApiSpec.servers[0].variables).forEach(varName => {
          const variable = openApiSpec.servers[0].variables[varName];
          fullUrl = fullUrl.replace(`{${varName}}`, variable.default || '');
        });
      }
      
      const requestItem = {
        name: operation.summary || operation.operationId || `${method.toUpperCase()} ${pathTemplate}`,
        request: {
          method: method.toUpperCase(),
          url: {
            raw: fullUrl,
            path: pathTemplate.split('/').filter(p => p !== '')
          },
          description: operation.description || ''
        }
      };
      
      // Handle request headers
      const headers = [];
      if (operation.requestBody?.content?.['application/json']) {
        headers.push({
          key: 'Content-Type',
          value: 'application/json'
        });
      }
      
      // Add security headers if using AWS SigV4
      if (operation.security?.some(sec => sec.sigv4 !== undefined)) {
        headers.push({
          key: 'Authorization',
          value: 'AWS4-HMAC-SHA256 {{signature}}'
        });
      }
      
      if (headers.length > 0) {
        requestItem.request.header = headers;
      }
      
      // Handle request body
      if (operation.requestBody) {
        console.log(`[OpenAPI] Processing request body for ${method.toUpperCase()} ${pathTemplate}`);
        console.log('[OpenAPI] Request body:', JSON.stringify(operation.requestBody, null, 2));
        
        const jsonContent = operation.requestBody.content?.['application/json'];
        if (jsonContent?.schema) {
          console.log('[OpenAPI] Found JSON content schema:', JSON.stringify(jsonContent.schema, null, 2));
          
          const sampleData = generateSampleFromSchema(jsonContent.schema);
          console.log('[OpenAPI] Generated sample data:', JSON.stringify(sampleData, null, 2));
          
          requestItem.request.body = {
            mode: 'raw',
            raw: JSON.stringify(sampleData, null, 2),
            options: {
              raw: {
                language: 'json'
              }
            }
          };
          
          console.log('[OpenAPI] Set request body:', JSON.stringify(requestItem.request.body, null, 2));
        } else {
          console.log('[OpenAPI] No JSON content schema found in request body');
        }
      } else {
        console.log(`[OpenAPI] No request body found for ${method.toUpperCase()} ${pathTemplate}`);
      }
      
      // Handle parameters (query, path, header)
      if (operation.parameters && operation.parameters.length > 0) {
        const queryParams = [];
        operation.parameters.forEach(param => {
          if (param.in === 'query') {
            queryParams.push({
              key: param.name,
              value: param.example || `{{${param.name}}}`,
              description: param.description || ''
            });
          }
          // Path parameters are already handled in the URL template
          // Header parameters should be added to headers if needed
          if (param.in === 'header') {
            if (!requestItem.request.header) {
              requestItem.request.header = [];
            }
            requestItem.request.header.push({
              key: param.name,
              value: param.example || `{{${param.name}}}`,
              description: param.description || ''
            });
          }
        });
        
        if (queryParams.length > 0) {
          requestItem.request.url.query = queryParams;
        }
      }
      
      // Store OpenAPI specific data for reference
      requestItem.request.openapi = {
        operationId: operation.operationId,
        parameters: operation.parameters || [],
        requestBody: operation.requestBody,
        responses: operation.responses,
        security: operation.security,
        // Store resolved schemas for runtime type checking
        resolvedSchemas: {},
        // Store reference to the full OpenAPI spec for runtime resolution
        fullSpec: openApiSpec
      };
      
      // Debug: Log what we're storing
      console.log(`[OpenAPI] Storing fullSpec for ${method.toUpperCase()} ${path}:`, !!openApiSpec);
      console.log(`[OpenAPI] FullSpec components available:`, !!openApiSpec?.components);
      console.log(`[OpenAPI] FullSpec schemas available:`, !!openApiSpec?.components?.schemas);
      
      // Pre-resolve schema references for the request body
      if (operation.requestBody?.content?.['application/json']?.schema) {
        const schema = operation.requestBody.content['application/json'].schema;
        
        if (schema.$ref) {
          const resolvedSchema = resolveSchemaRef(schema.$ref, openApiSpec);
          if (resolvedSchema) {
            requestItem.request.openapi.resolvedSchemas[schema.$ref] = resolvedSchema;
            console.log(`[OpenAPI] Pre-resolved schema ${schema.$ref}:`, JSON.stringify(resolvedSchema, null, 2));
          }
        }
      }
      
      pathGroups[folderName].item.push(requestItem);
    });
  });
  
  // Add grouped folders to collection
  Object.values(pathGroups).forEach(group => {
    if (group.item.length > 0) {
      collection.item.push(group);
    }
  });
  
  return collection;
};

// Enhanced scan-postman-collections handler with OpenAPI support
ipcMain.handle('scan-postman-collections', async (event, folderPath) => {
  if (!folderPath) {
    console.warn('No folder path provided for Postman collections scan.');
    return [];
  }
  console.log('Scanning Postman collections and OpenAPI specs in:', folderPath);
  const collections = [];
  try {
    const entries = await fsPromises.readdir(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        const filePath = path.join(folderPath, entry.name);
        console.log('Attempting to read:', filePath);
        try {
          const fileContent = await fsPromises.readFile(filePath, 'utf8');
          const jsonData = JSON.parse(fileContent);
          
          // Check if it's a Postman collection
          if (jsonData.info && jsonData.info.schema && typeof jsonData.info.schema === 'string' && 
              (jsonData.info.schema.includes('/v2.1.0/collection.json') || jsonData.info.schema.includes('/v2.0.0/collection.json'))) {
            console.log(`Valid Postman collection found: ${jsonData.info.name}`);
            collections.push({
              fileName: entry.name,
              filePath: filePath,
              name: jsonData.info.name || entry.name.replace('.json', ''),
              type: 'postman',
              item: jsonData.item || [] 
            });
          }
          // Check if it's an OpenAPI specification
          else if (jsonData.openapi && typeof jsonData.openapi === 'string' && 
                   (jsonData.openapi.startsWith('3.0') || jsonData.openapi.startsWith('3.1'))) {
            console.log(`Valid OpenAPI 3.x specification found: ${jsonData.info?.title || entry.name}`);
            console.log(`[OpenAPI Scan] Converting OpenAPI spec to collection format`);
            const convertedCollection = convertOpenApiToPostmanLike(jsonData, entry.name, filePath);
            console.log(`[OpenAPI Scan] Conversion completed for: ${convertedCollection.name}`);
            collections.push(convertedCollection);
          }
          // Check if it's a Swagger 2.0 specification
          else if (jsonData.swagger && typeof jsonData.swagger === 'string' && 
                   jsonData.swagger.startsWith('2.0')) {
            console.log(`Valid Swagger 2.0 specification found: ${jsonData.info?.title || entry.name}`);
            const convertedCollection = convertOpenApiToPostmanLike(jsonData, entry.name, filePath);
            collections.push(convertedCollection);
          }
          else {
            console.log(`Skipping invalid or unsupported JSON: ${entry.name}`);
          }
        } catch (parseError) {
          console.warn(`Error parsing JSON file ${entry.name}:`, parseError.message);
        }
      }
    }
    // After successful scan, save to cache
    try {
        await fsPromises.writeFile(postmanCacheFilePath, JSON.stringify(collections, null, 2));
        console.log('Collections cache saved successfully.');

        // --->>> ADD NOTIFICATION <<<---
        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log('Notifying main window of collections cache update.');
          mainWindow.webContents.send('postman-collections-updated');
        }
        // --->>> END NOTIFICATION <<<---

    } catch (cacheError) {
        console.error('Error saving collections cache:', cacheError);
    }

  } catch (scanError) {
    console.error(`Error scanning directory ${folderPath}:`, scanError);
    return []; 
  }
  console.log(`Scan complete. Found ${collections.length} valid collections (Postman + OpenAPI).`);
  return collections;
});

// New handler to load cached collections
ipcMain.handle('load-cached-postman-collections', async () => {
  try {
    const data = await fsPromises.readFile(postmanCacheFilePath, 'utf8');
    console.log('Successfully loaded cached Postman collections.');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Postman collections cache file not found. Returning empty array.');
      return []; // Cache file doesn't exist yet
    } else {
      console.error('Error reading Postman collections cache:', error);
      return []; // Return empty on other errors
    }
  }
});

// Helper function to parse credential files (similar to Setting4.js)
const parseCredentialFileContent = (content, filePathHint = '', targetProfile = null) => {
    let parsedAccessKey = '';
    let parsedSecretKey = '';
    let parsedSessionToken = '';
    let profiles = [];
    const isCsv = filePathHint.toLowerCase().endsWith('.csv');
    const isAwsCredentials = filePathHint.toLowerCase().includes('credentials') || filePathHint.toLowerCase().includes('.aws');

    // Handle AWS credentials file format
    if (isAwsCredentials) {
      const lines = content.replace(/\r\n/g, '\n').split('\n');
      const profileData = {};
      let currentProfile = null;

      for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Skip empty lines and comments
        if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith(';')) {
          continue;
        }

        // Check for profile section
        const profileMatch = trimmedLine.match(/^\[([^\]]+)\]$/);
        if (profileMatch) {
          currentProfile = profileMatch[1];
          profileData[currentProfile] = {};
          continue;
        }

        // Parse key-value pairs
        if (currentProfile) {
          const keyValueMatch = trimmedLine.match(/^([^=]+)=(.*)$/);
          if (keyValueMatch) {
            const key = keyValueMatch[1].trim();
            const value = keyValueMatch[2].trim();
            profileData[currentProfile][key] = value;
          }
        }
      }

      profiles = Object.keys(profileData);
      
      // Use targetProfile if specified, otherwise use first profile
      const profileToUse = targetProfile || (profiles.length > 0 ? profiles[0] : null);
      
      if (profileToUse && profileData[profileToUse]) {
        const profile = profileData[profileToUse];
        parsedAccessKey = profile.aws_access_key_id || '';
        parsedSecretKey = profile.aws_secret_access_key || '';
        parsedSessionToken = profile.aws_session_token || '';
      }

      return { 
        accessKeyId: parsedAccessKey, 
        secretAccessKey: parsedSecretKey, 
        sessionToken: parsedSessionToken,
        profiles: profiles 
      };
    }

    try {
        // Try parsing as JSON first
        const jsonContent = JSON.parse(content);
        parsedAccessKey = jsonContent['Access Key ID'] || jsonContent['access_key_id'] || jsonContent['AccessKeyId'] || '';
        parsedSecretKey = jsonContent['Secret Access Key'] || jsonContent['secret_access_key'] || jsonContent['SecretAccessKey'] || '';
        parsedSessionToken = jsonContent['Session Token'] || jsonContent['session_token'] || jsonContent['SessionToken'] || '';
        if (parsedAccessKey && parsedSecretKey) {
          return { 
            accessKeyId: parsedAccessKey, 
            secretAccessKey: parsedSecretKey, 
            sessionToken: parsedSessionToken,
            profiles: [] 
          };
        }
    } catch (e) {
        // JSON parsing failed, proceed to other formats
    }

    const lines = content.replace(/\r\n/g, '\n').split('\n');

    if (isCsv && lines.length >= 2) {
        const headerLine = lines[0].trim();
        const dataLine = lines[1].trim(); 
        const headers = headerLine.split(',').map(h => h.trim().toLowerCase());
        const values = dataLine.split(',').map(v => v.trim());

        let accessKeyIndex = -1;
        let secretKeyIndex = -1;
        let sessionTokenIndex = -1;

        const accessKeyPossibleHeaders = ['access key id', 'accesskeyid', 'aws_access_key_id'];
        const secretKeyPossibleHeaders = ['secret access key', 'secretaccesskey', 'aws_secret_access_key'];
        const sessionTokenPossibleHeaders = ['session token', 'sessiontoken', 'aws_session_token'];

        headers.forEach((header, index) => {
            if (accessKeyPossibleHeaders.includes(header)) accessKeyIndex = index;
            if (secretKeyPossibleHeaders.includes(header)) secretKeyIndex = index;
            if (sessionTokenPossibleHeaders.includes(header)) sessionTokenIndex = index;
        });
      
        if (accessKeyIndex === -1) accessKeyIndex = headers.findIndex(h => h.includes('access key id') || h.includes('accesskeyid'));
        if (secretKeyIndex === -1) secretKeyIndex = headers.findIndex(h => h.includes('secret access key') || h.includes('secretaccesskey'));
        if (sessionTokenIndex === -1) sessionTokenIndex = headers.findIndex(h => h.includes('session token') || h.includes('sessiontoken'));

        if (accessKeyIndex !== -1 && values.length > accessKeyIndex) parsedAccessKey = values[accessKeyIndex];
        if (secretKeyIndex !== -1 && values.length > secretKeyIndex) parsedSecretKey = values[secretKeyIndex];
        if (sessionTokenIndex !== -1 && values.length > sessionTokenIndex) parsedSessionToken = values[sessionTokenIndex];
        
        if (parsedAccessKey && parsedSecretKey) {
          return { 
            accessKeyId: parsedAccessKey, 
            secretAccessKey: parsedSecretKey, 
            sessionToken: parsedSessionToken,
            profiles: [] 
          };
        }
    }

    const accessKeyRegex = /(?:Access Key ID|access_key_id|AccessKeyId|aws_access_key_id)\s*[:=]\s*([A-Za-z0-9/+=]{20,})/i;
    const secretKeyRegex = /(?:Secret Access Key|secret_access_key|SecretAccessKey|aws_secret_access_key)\s*[:=]\s*([A-Za-z0-9/+=]{40,})/i;
    const sessionTokenRegex = /(?:Session Token|session_token|SessionToken|aws_session_token)\s*[:=]\s*([A-Za-z0-9/+=]{100,})/i;

    if (!parsedAccessKey || !parsedSecretKey) {
        for (const line of lines) {
            if (!parsedAccessKey) {
                const accessMatch = line.match(accessKeyRegex);
                if (accessMatch && accessMatch[1]) parsedAccessKey = accessMatch[1].trim();
            }
            if (!parsedSecretKey) {
                const secretMatch = line.match(secretKeyRegex);
                if (secretMatch && secretMatch[1]) parsedSecretKey = secretMatch[1].trim();
            }
            if (!parsedSessionToken) {
                const sessionMatch = line.match(sessionTokenRegex);
                if (sessionMatch && sessionMatch[1]) parsedSessionToken = sessionMatch[1].trim();
            }
            if (parsedAccessKey && parsedSecretKey) break; 
        }
    }
    
    if (!parsedAccessKey && lines.length >= 1 && lines[0].length > 15 && lines[0].length < 30 && /^[A-Z0-9]{20}$/.test(lines[0].trim())) {
        parsedAccessKey = lines[0].trim();
    }
    if (!parsedSecretKey && lines.length >= 2 && lines[1].length > 30 && lines[1].length < 50 && /^[a-zA-Z0-9/+=]{40}$/.test(lines[1].trim())) {
        parsedSecretKey = lines[1].trim();
    }

    return { 
      accessKeyId: parsedAccessKey, 
      secretAccessKey: parsedSecretKey, 
      sessionToken: parsedSessionToken,
      profiles: [] 
    };
};

// Helper function to remove comments from JSON-like strings
function removeJsonComments(jsonString) {
  if (typeof jsonString !== 'string') return jsonString;
  
  // Remove single-line comments (// comment)
  // But be careful not to remove // inside strings
  let result = jsonString;
  
  // First, let's handle single-line comments
  // This regex looks for // that are not inside quotes
  result = result.replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, (match, group1) => {
    // If group1 is captured (a string), return it as-is
    // Otherwise, it's a comment, so return empty string
    return group1 || '';
  });
  
  // Remove multi-line comments (/* comment */)
  // Again, being careful about strings
  result = result.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\//g, (match, group1) => {
    return group1 || '';
  });
  
  // Remove trailing commas before } or ] (common after removing comments)
  result = result.replace(/,(\s*[}\]])/g, '$1');
  
  return result;
}

// Helper function to resolve schema references at runtime
function resolveSchemaRefRuntime(schemaRef, openApiSpec) {
  console.log(`[Runtime Schema] Resolving reference: ${schemaRef}`);
  
  if (!schemaRef || !openApiSpec) {
    console.log(`[Runtime Schema] Missing schemaRef or openApiSpec`);
    return null;
  }
  
  if (typeof schemaRef === 'string' && schemaRef.startsWith('#/components/schemas/')) {
    const schemaName = schemaRef.replace('#/components/schemas/', '');
    console.log(`[Runtime Schema] Looking for schema: ${schemaName}`);
    
    const resolvedSchema = openApiSpec.components?.schemas?.[schemaName];
    if (resolvedSchema) {
      console.log(`[Runtime Schema] Found schema: ${schemaName}`, JSON.stringify(resolvedSchema, null, 2));
      return resolvedSchema;
    } else {
      console.log(`[Runtime Schema] Schema not found: ${schemaName}`);
      console.log(`[Runtime Schema] Available schemas:`, Object.keys(openApiSpec.components?.schemas || {}));
    }
  }
  
  return null;
}

// Helper function to get field type from OpenAPI schema
function getFieldTypeFromSchema(fieldName, requestDetails) {
  console.log(`[Schema Debug] Looking for field type: ${fieldName}`);
  
  if (!requestDetails?.request?.openapi?.requestBody) {
    console.log(`[Schema Debug] No OpenAPI requestBody found`);
    return null;
  }
  
  const requestBody = requestDetails.request.openapi.requestBody;
  console.log(`[Schema Debug] RequestBody:`, JSON.stringify(requestBody, null, 2));
  
  const jsonContent = requestBody.content?.['application/json'];
  if (!jsonContent?.schema) {
    console.log(`[Schema Debug] No JSON schema found`);
    return null;
  }
  
  console.log(`[Schema Debug] JSON schema:`, JSON.stringify(jsonContent.schema, null, 2));
  
  // Helper function to resolve schema references
  const resolveSchemaRef = (schemaRef, openApiSpec) => {
    if (typeof schemaRef === 'string' && schemaRef.startsWith('#/components/schemas/')) {
      const schemaName = schemaRef.replace('#/components/schemas/', '');
      return openApiSpec?.components?.schemas?.[schemaName] || null;
    }
    
    if (schemaRef && typeof schemaRef === 'object' && schemaRef.$ref) {
      return resolveSchemaRef(schemaRef.$ref, openApiSpec);
    }
    
    return schemaRef;
  };
  
  // Function to search for field type in schema
  const findFieldType = (schema, fieldName) => {
    if (!schema || typeof schema !== 'object') {
      return null;
    }
    
    // Direct property lookup
    if (schema.properties && schema.properties[fieldName]) {
      return schema.properties[fieldName].type;
    }
    
    // If it's a reference, try to resolve it
    if (schema.$ref) {
      console.log(`[Schema Debug] Found $ref: ${schema.$ref}`);
      // Try to get the resolved schema from the request details
      // The OpenAPI conversion process should have stored resolved schemas
      const resolvedSchema = requestDetails?.request?.openapi?.resolvedSchemas?.[schema.$ref];
      if (resolvedSchema) {
        console.log(`[Schema Debug] Using resolved schema:`, JSON.stringify(resolvedSchema, null, 2));
        return findFieldType(resolvedSchema, fieldName);
      } else {
        console.log(`[Schema Debug] Could not resolve $ref: ${schema.$ref}, attempting runtime resolution`);
        
        // Debug: Check what we have available
        console.log(`[Schema Debug] Request details available:`, !!requestDetails);
        console.log(`[Schema Debug] OpenAPI data available:`, !!requestDetails?.request?.openapi);
        console.log(`[Schema Debug] Full spec available:`, !!requestDetails?.request?.openapi?.fullSpec);
        
        if (requestDetails?.request?.openapi) {
          console.log(`[Schema Debug] OpenAPI keys:`, Object.keys(requestDetails.request.openapi));
          if (requestDetails.request.openapi.fullSpec) {
            console.log(`[Schema Debug] Full spec components available:`, !!requestDetails.request.openapi.fullSpec.components);
            console.log(`[Schema Debug] Full spec schemas available:`, !!requestDetails.request.openapi.fullSpec.components?.schemas);
            if (requestDetails.request.openapi.fullSpec.components?.schemas) {
              console.log(`[Schema Debug] Available schema names:`, Object.keys(requestDetails.request.openapi.fullSpec.components.schemas));
            }
          } else {
            console.log(`[Schema Debug] This collection may not be from OpenAPI conversion - no fullSpec stored`);
          }
        }
        
        // Fallback: try to resolve at runtime using the full OpenAPI spec
        if (requestDetails?.request?.openapi?.fullSpec && schema.$ref) {
          const fullSpec = requestDetails.request.openapi.fullSpec;
          const runtimeResolvedSchema = resolveSchemaRefRuntime(schema.$ref, fullSpec);
          if (runtimeResolvedSchema) {
            console.log(`[Schema Debug] Runtime resolved schema:`, JSON.stringify(runtimeResolvedSchema, null, 2));
            // Cache the resolved schema for future use
            if (!requestDetails.request.openapi.resolvedSchemas) {
              requestDetails.request.openapi.resolvedSchemas = {};
            }
            requestDetails.request.openapi.resolvedSchemas[schema.$ref] = runtimeResolvedSchema;
            return findFieldType(runtimeResolvedSchema, fieldName);
          }
        }
        console.log(`[Schema Debug] Could not resolve $ref: ${schema.$ref}`);
        return null;
      }
    }
    
    return null;
  };
  
  return findFieldType(jsonContent.schema, fieldName);
}

// Helper function to convert value based on OpenAPI type
function convertValueByType(value, type) {
  if (value === undefined || value === null || value === '') {
    return value;
  }
  
  const stringValue = String(value);
  
  switch (type) {
    case 'number':
      // Convert to number (supports both integers and decimals)
      if (/^\d+(\.\d+)?$/.test(stringValue)) {
        return parseFloat(stringValue);
      }
      break;
      
    case 'integer':
      // Convert to integer only
      if (/^\d+$/.test(stringValue)) {
        return parseInt(stringValue, 10);
      }
      break;
      
    case 'boolean':
      // Convert boolean strings
      if (stringValue === 'true') return true;
      if (stringValue === 'false') return false;
      break;
      
    case 'string':
    default:
      // Keep as string
      return stringValue;
  }
  
  // If conversion fails, return original value
  return value;
}

// Helper function for parameter substitution
function substituteParams(target, params, requestBody = null, requestDetails = null) {
  if (typeof target !== 'string') return target;
  let result = target;
  
  // Substitute params from the params object (e.g., from Page6 form)
  for (const key in params) {
    if (params[key] !== undefined && params[key] !== null) { // Check if the key exists and is not null/undefined
        // Support both {{variable}} and {variable} formats
        const doubleRegex = new RegExp(`{{\s*${key}\s*}}`, 'g');
        const singleRegex = new RegExp(`{\s*${key}\s*}`, 'g');
        result = result.replace(doubleRegex, params[key]);
        result = result.replace(singleRegex, params[key]);
    }
  }
  
  if (requestBody && typeof requestBody === 'string') {
      let tempBody = requestBody;
      
      // First, try to replace template variables ({{var}} or {var})
      for (const key in params) {
        if (params[key] !== undefined && params[key] !== null) {
            // Support both {{variable}} and {variable} formats in body too
            const doubleRegex = new RegExp(`{{\s*${key}\s*}}`, 'g');
            const singleRegex = new RegExp(`{\s*${key}\s*}`, 'g');
            
            // For JSON body, we need to handle numeric values differently
            // Check if we're replacing within a JSON context by looking for quotes
            tempBody = tempBody.replace(doubleRegex, (match, offset) => {
              // Check if this template is inside quotes or not
              const beforeMatch = tempBody.substring(0, offset);
              const afterMatch = tempBody.substring(offset + match.length);
              
              // Count quotes before the match to determine if we're inside a string
              const quotesBefore = (beforeMatch.match(/"/g) || []).length;
              const isInsideString = quotesBefore % 2 === 1;
              
              // If not inside a string and the value is numeric, return as number
              if (!isInsideString && /^\d+$/.test(params[key])) {
                return params[key]; // Return numeric string as-is (JSON.parse will handle it)
              }
              
              // Otherwise, wrap in quotes for string values
              return isInsideString ? params[key] : `"${params[key]}"`;
            });
            
            tempBody = tempBody.replace(singleRegex, (match, offset) => {
              const beforeMatch = tempBody.substring(0, offset);
              const quotesBefore = (beforeMatch.match(/"/g) || []).length;
              const isInsideString = quotesBefore % 2 === 1;
              
              if (!isInsideString && /^\d+$/.test(params[key])) {
                return params[key];
              }
              
              return isInsideString ? params[key] : `"${params[key]}"`;
            });
        }
      }
      
      // Second, if it's JSON, try to replace example values in the JSON structure
      try {
        const bodyObj = JSON.parse(tempBody);
        let modified = false;
        
        // Function to recursively replace values in JSON
        const replaceInObject = (obj) => {
          if (typeof obj === 'object' && obj !== null) {
            for (const key in obj) {
              if (params.hasOwnProperty(key) && params[key] !== undefined && params[key] !== null) {
                // If the parameter name matches the JSON key, replace the value
                console.log(`[Debug] Processing direct field match: ${key} = '${params[key]}'`);
                // Try to get type from OpenAPI schema first
                const fieldType = getFieldTypeFromSchema(key, requestDetails);
                console.log(`[Debug] Field type for '${key}': ${fieldType || 'not found'}`);
                
                if (fieldType) {
                  // Use OpenAPI schema type for conversion
                  obj[key] = convertValueByType(params[key], fieldType);
                  console.log(`[Type Conversion] Field '${key}' converted from '${params[key]}' to ${typeof obj[key]} '${obj[key]}' based on OpenAPI type '${fieldType}'`);
                } else {
                  // Fallback: without schema info, try to preserve the original type from the JSON body
                  const originalType = typeof obj[key];
                  console.log(`[Debug] Original type for '${key}': ${originalType}, original value: ${obj[key]}`);
                  
                  if (originalType === 'number') {
                    // If original was a number, try to convert to number
                    const numValue = Number(params[key]);
                    if (!isNaN(numValue)) {
                      obj[key] = numValue;
                      console.log(`[Type Conversion] Field '${key}' converted to number from '${params[key]}' to ${obj[key]} (preserving original type)`);
                    } else {
                      // If conversion fails, keep as string
                      obj[key] = params[key];
                      console.log(`[Type Conversion] Field '${key}' kept as string '${params[key]}' (number conversion failed)`);
                    }
                  } else if (originalType === 'boolean') {
                    // If original was a boolean, convert string to boolean
                    if (params[key] === 'true' || params[key] === 'false') {
                      obj[key] = params[key] === 'true';
                    } else if (params[key] === '1' || params[key] === '0') {
                      obj[key] = params[key] === '1';
                    } else {
                      // For other values, keep original boolean or use truthy conversion
                      obj[key] = Boolean(params[key]);
                    }
                    console.log(`[Type Conversion] Field '${key}' converted to boolean from '${params[key]}' to ${obj[key]} (preserving original type)`);
                  } else if (params[key] === 'true' || params[key] === 'false') {
                    // Even if original wasn't boolean, convert obvious boolean strings
                    obj[key] = params[key] === 'true';
                    console.log(`[Type Conversion] Field '${key}' converted to boolean from '${params[key]}' to ${obj[key]}`);
                  } else {
                    // Default: keep as string
                    obj[key] = params[key];
                    console.log(`[Type Conversion] Field '${key}' kept as string from '${params[key]}' to '${obj[key]}'`);
                  }
                }
                modified = true;
              } else if (typeof obj[key] === 'string' && obj[key].startsWith('example_')) {
                // Check if it's an example value like "example_ringnetId"
                const paramName = obj[key].replace('example_', '');
                console.log(`[Debug] Processing example field: ${key} = '${obj[key]}', looking for param: '${paramName}'`);
                if (params.hasOwnProperty(paramName) && params[paramName] !== undefined && params[paramName] !== null) {
                  console.log(`[Debug] Found parameter '${paramName}' = '${params[paramName]}'`);
                  // Try to get type from OpenAPI schema first
                  // For example values, we want the type of the field (key), not the parameter name
                  const fieldType = getFieldTypeFromSchema(key, requestDetails);
                  console.log(`[Debug] Field type for '${key}': ${fieldType || 'not found'}`);
                  
                  if (fieldType) {
                    // Use OpenAPI schema type for conversion
                    obj[key] = convertValueByType(params[paramName], fieldType);
                    console.log(`[Type Conversion] Example field '${key}' (param: '${paramName}') converted from '${params[paramName]}' to ${typeof obj[key]} '${obj[key]}' based on OpenAPI type '${fieldType}'`);
                  } else {
                    // Fallback: without schema info, try to preserve the original type from the JSON body
                    // For example fields, we need to infer the type from the example value pattern
                    const exampleValue = obj[key]; // The original example string like "example_ringnetId"
                    
                    // Try to infer type from the example value pattern
                    // Common patterns: example_123 (number), example_true (boolean), example_text (string)
                    if (/^example_\d+$/.test(exampleValue)) {
                      // Looks like a number example
                      const numValue = Number(params[paramName]);
                      if (!isNaN(numValue)) {
                        obj[key] = numValue;
                        console.log(`[Type Conversion] Example field '${key}' (param: '${paramName}') converted to number from '${params[paramName]}' to ${obj[key]} (inferred from example pattern)`);
                      } else {
                        obj[key] = params[paramName];
                        console.log(`[Type Conversion] Example field '${key}' (param: '${paramName}') kept as string '${params[paramName]}' (number conversion failed)`);
                      }
                    } else if (/^example_(true|false)$/i.test(exampleValue)) {
                      // Looks like a boolean example
                      if (params[paramName] === 'true' || params[paramName] === 'false') {
                        obj[key] = params[paramName] === 'true';
                      } else if (params[paramName] === '1' || params[paramName] === '0') {
                        obj[key] = params[paramName] === '1';
                      } else {
                        obj[key] = Boolean(params[paramName]);
                      }
                      console.log(`[Type Conversion] Example field '${key}' (param: '${paramName}') converted to boolean from '${params[paramName]}' to ${obj[key]} (inferred from example pattern)`);
                    } else if (params[paramName] === 'true' || params[paramName] === 'false') {
                      // Even if pattern doesn't suggest boolean, convert obvious boolean strings
                      obj[key] = params[paramName] === 'true';
                      console.log(`[Type Conversion] Example field '${key}' (param: '${paramName}') converted to boolean from '${params[paramName]}' to ${obj[key]}`);
                    } else {
                      // Default: keep as string
                      obj[key] = params[paramName];
                      console.log(`[Type Conversion] Example field '${key}' (param: '${paramName}') kept as string from '${params[paramName]}' to '${obj[key]}'`);
                    }
                  }
                  modified = true;
                } else {
                  console.log(`[Debug] Parameter '${paramName}' not found or empty for example field '${key}'`);
                }
              } else if (typeof obj[key] === 'object') {
                replaceInObject(obj[key]);
              }
            }
          }
        };
        
        replaceInObject(bodyObj);
        
        if (modified) {
          tempBody = JSON.stringify(bodyObj, null, 2);
        }
      } catch (e) {
        // Not valid JSON or parsing failed, continue with template substitution only
      }
      
      return { substitutedTarget: result, substitutedBody: tempBody };
  }
  
  return result; 
}

ipcMain.handle('execute-postman-request', async (event, { requestDetails, params, apiConfigId, selectedProfile, selectedEnvironment, isFileTransferCollection }) => {
  console.log('Executing Postman request:', requestDetails.name);
  console.log('With params from Page6:', params);
  if (apiConfigId) {
    console.log('Using API Config ID:', apiConfigId);
  }
  if (selectedProfile) {
    console.log('Using AWS Profile:', selectedProfile);
  }
  if (selectedEnvironment) {
    console.log('Using selected environment:', selectedEnvironment.label);
    console.log('Environment baseUrl:', selectedEnvironment.baseUrl);
    console.log('Environment basePath:', selectedEnvironment.basePath);
  }
  if (isFileTransferCollection !== undefined) {
    console.log('Is file transfer collection:', isFileTransferCollection);
  }

  if (!requestDetails || !requestDetails.request) {
    return { success: false, error: 'Invalid request details provided.' };
  }

  const req = requestDetails.request;
  let method = req.method || 'GET';
  let rawUrl = '';

  if (typeof req.url === 'string') {
    rawUrl = req.url;
  } else if (req.url && typeof req.url.raw === 'string') {
    rawUrl = req.url.raw;
  } else {
     return { success: false, error: 'Invalid URL format in request.' };
  }

  // If we have a selected environment and this is an OpenAPI request, override the URL
  if (selectedEnvironment && selectedEnvironment.baseUrl && selectedEnvironment.basePath) {
    console.log('[DEBUG] Original URL:', rawUrl);
    
    // Extract the endpoint path without URL parsing to preserve template variables
    try {
      // Extract the path part from the URL (everything after the domain)
      const urlMatch = rawUrl.match(/^(https?:\/\/[^\/]+)(\/.*)?$/);
      if (urlMatch) {
        const [, baseUrl, pathAndQuery] = urlMatch;
        let fullPath = pathAndQuery || '/';
        
        console.log('[DEBUG] Original path (unencoded):', fullPath);
        
        // Split path and query string
        const [pathname, search] = fullPath.split('?');
        let endpointPath = pathname;
        
        // Normalize the path by removing any double slashes
        endpointPath = endpointPath.replace(/\/+/g, '/');
        console.log('[DEBUG] Normalized path:', endpointPath);
        
        // Remove any basePath from the beginning of the path
        // Pattern: /basePath/endpoint -> /endpoint
        const basePathPattern = /^\/[^\/]+/;
        const match = endpointPath.match(basePathPattern);
        if (match) {
          const detectedBasePath = match[0];
          console.log('[DEBUG] Detected basePath in original URL:', detectedBasePath);
          endpointPath = endpointPath.substring(detectedBasePath.length);
          // Ensure endpoint starts with /
          if (!endpointPath.startsWith('/')) {
            endpointPath = '/' + endpointPath;
          }
        }
        
        console.log('[DEBUG] Extracted endpoint path:', endpointPath);
        
        // Construct new URL with selected environment
        rawUrl = selectedEnvironment.baseUrl + selectedEnvironment.basePath + endpointPath + (search ? '?' + search : '');
        console.log('[DEBUG] URL overridden with environment:', rawUrl);
      }
    } catch (urlError) {
      console.warn('[DEBUG] Failed to extract URL components for environment override:', urlError.message);
    }
  }

  // Perform parameter substitution BEFORE URL parsing to avoid URL encoding of template variables
  console.log('[DEBUG] URL before parameter substitution:', rawUrl);
  console.log('[DEBUG] Parameters for substitution:', params);
  let substitutedUrl = substituteParams(rawUrl, params);
  console.log('[DEBUG] URL after parameter substitution:', substitutedUrl);
  
  // Parse the URL after substitution to avoid URL encoding of template variables
  const parsedUrl = new url.URL(substitutedUrl);
  
  // Fix path construction - ensure it starts with single slash
  let requestPath = parsedUrl.pathname + parsedUrl.search;
  if (requestPath.startsWith('//')) {
    requestPath = requestPath.substring(1); // Remove extra leading slash
  }
  console.log('[DEBUG] Final request path:', requestPath);

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: requestPath, 
    method: method,
    headers: {
      'Content-Type': 'application/json', // Add default Content-Type
      'Accept': '*/*', // Accept all content types
      'Accept-Encoding': 'gzip, deflate, br', // Support compression
      'Connection': 'keep-alive' // Keep connection alive for performance
    },
    service: isFileTransferCollection ? 'iotwireless' : 'execute-api', // Use iotwireless for file transfer collections, execute-api for others
    region: 'us-east-1',   // Default region for AWS SigV4
  };

  // Prepare body and perform initial substitution for it
  let postData = null;
  if (req.body && req.body.mode && req.body[req.body.mode] && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      try {
          if (req.body.mode === 'raw') {
              console.log('[DEBUG] Original request body:', req.body.raw);
              // Remove comments from the body first
              const cleanedBody = removeJsonComments(req.body.raw);
              console.log('[DEBUG] Body after removing comments:', cleanedBody);
              // Substitute variables in the raw body string using the params from Page6
              const substitutionResult = substituteParams(substitutedUrl, params, cleanedBody, requestDetails);
              postData = substitutionResult.substitutedBody;
              substitutedUrl = substitutionResult.substitutedTarget; // URL might also get updated if it had body-specific vars (less common)
              console.log('[DEBUG] Substituted request body:', postData);
              
              if (!options.headers['Content-Type'] && postData.trim().startsWith('{')) {
                  options.headers['Content-Type'] = 'application/json';
              }
          } else if (req.body.mode === 'formdata') {
              console.warn('Formdata is not fully supported for AWS SigV4 signing with basic http module. Use raw JSON body if possible.');
              if (req.body.formdata && Array.isArray(req.body.formdata)) {
                 let substitutedFormData = req.body.formdata
                    .filter(item => !item.disabled)
                    .map(item => {
                        const key = substituteParams(item.key, params);
                        const value = substituteParams(item.value, params);
                        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
                    })
                    .join('&');
                 postData = substitutedFormData;
                 if (!options.headers['Content-Type']) {
                   options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                 }
              }
          }
          if (postData) {
              options.body = postData; // aws4 library expects body in options for signing
              // Content-Length will be set by http module or aws4 if not present
              // Explicitly set Content-Length to ensure proper request formatting
              options.headers['Content-Length'] = Buffer.byteLength(postData, 'utf8');
          }
      } catch (bodyError) {
          console.error('Error processing request body:', bodyError);
          return { success: false, error: `Error processing request body: ${bodyError.message}` };
      }
  }

  // Add original headers from Postman request, substituting variables in them
  if (req.header && Array.isArray(req.header)) {
    req.header.forEach(header => {
      if (!header.disabled) {
        const headerKey = substituteParams(header.key, params);
        const headerValue = substituteParams(header.value, params);
        options.headers[headerKey] = headerValue;
      }
    });
  }

  // Credentials for AWS Signature V4
  let credentials = null;

  if (apiConfigId) {
    try {
      const appConfig = await _loadConfigInternal();
      const apiCredentialConfigs = appConfig.credentialsFilePaths || [];
      const selectedConfig = apiCredentialConfigs.find(config => config.id === apiConfigId);

      if (selectedConfig) {
        console.log(`Found API credential config: ${selectedConfig.name}, type: ${selectedConfig.type || 'file'}`);
        
        // Handle manual credentials
        if (selectedConfig.type === 'manual' && selectedConfig.credentials) {
          const { accessKeyId, secretAccessKey } = selectedConfig.credentials;
          if (accessKeyId && secretAccessKey) {
            console.log('Successfully loaded manual AWS credentials.');
            credentials = {
              accessKeyId: accessKeyId,
              secretAccessKey: secretAccessKey,
            };
          } else {
            console.warn('Manual credential config found but missing accessKeyId or secretAccessKey.');
          }
        }
        // Handle file-based credentials
        else if (selectedConfig.path) {
          console.log(`Loading file-based credentials from path: ${selectedConfig.path}`);
          try {
            const credentialFileContent = await fsPromises.readFile(selectedConfig.path, 'utf-8');
            const { accessKeyId, secretAccessKey, sessionToken } = parseCredentialFileContent(credentialFileContent, selectedConfig.path, selectedProfile);

            if (accessKeyId && secretAccessKey) {
              console.log('Successfully parsed AWS keys from file.');
              credentials = {
                accessKeyId: accessKeyId,
                secretAccessKey: secretAccessKey,
              };
              // Add session token if available
              if (sessionToken) {
                credentials.sessionToken = sessionToken;
                console.log('Session token found and added to credentials.');
              }
            } else {
              console.warn(`Could not parse keys from credential file: ${selectedConfig.path}`);
            }
          } catch (fileError) {
            console.error(`Error reading or parsing credential file ${selectedConfig.path}:`, fileError);
          }
        } else {
          console.warn(`API Config ID ${apiConfigId} has no path and is not a manual credential type.`);
        }
      } else {
        console.warn(`API Config ID ${apiConfigId} not found in credentialsFilePaths.`);
      }
    } catch (configLoadError) {
      console.error('Error loading application configuration to get API credential paths:', configLoadError);
    }
  }

  // Override service and region if specified in Postman auth settings
  if (req.auth && req.auth.type === 'awsv4' && req.auth.awsv4) {
    const awsAuthDetails = req.auth.awsv4.reduce((acc, curr) => {
        acc[curr.key] = curr.value;
        return acc;
    }, {});
    if (awsAuthDetails.region) options.region = awsAuthDetails.region;
    if (awsAuthDetails.service) options.service = awsAuthDetails.service;
    // If accessKey/secretKey are directly in Postman auth, they could override file-based ones or be used as fallback
    // For now, file-based credentials take precedence if `apiConfigId` is used.
    // if (!credentials && awsAuthDetails.accessKey && awsAuthDetails.secretKey) {
    //    credentials = { accessKeyId: awsAuthDetails.accessKey, secretAccessKey: awsAuthDetails.secretKey };
    // }
  }
  
  // Perform AWS Signature V4 signing if credentials are available
  if (credentials) {
    console.log(`Signing request for service: ${options.service}, region: ${options.region}`);
    
    // Check if we need to assume a role for this environment
    let finalCredentials = credentials;
    if (selectedEnvironment && selectedEnvironment.roleArn) {
      try {
        console.log(`[AWS STS] Environment requires role assumption: ${selectedEnvironment.roleArn}`);
        
        // Check if we're already using the target role by looking for sessionToken
        // If we already have a session token, we're likely already in an assumed role
        if (credentials.sessionToken) {
          console.log('[AWS STS] Already using assumed role credentials, checking if target role matches current session');
          // For now, skip role assumption if we already have a session token
          // This prevents circular role assumption attempts
          console.log('[AWS STS] Skipping role assumption as we already have temporary credentials');
          finalCredentials = credentials;
        } else {
          finalCredentials = await assumeRole(credentials, selectedEnvironment.roleArn);
          console.log('[AWS STS] Successfully obtained assumed role credentials');
        }
      } catch (roleError) {
        console.error('[AWS STS] Failed to assume role:', roleError);
        return { success: false, error: `Failed to assume role ${selectedEnvironment.roleArn}: ${roleError.message}` };
      }
    }
    
    // Ensure options.path includes the query string for signing
    // The aws4 library expects options.host and options.path, not hostname.
    // It also expects options.body for the payload.
    let signableOptions = {
        method: options.method,
        host: options.hostname, // aws4 uses host
        path: options.path,     // Should be full path with query string
        headers: {...options.headers}, // Pass a copy of headers
        body: options.body,       // Pass the body for signing
        service: options.service,
        region: options.region,
    };

    // Explicitly set x-amz-content-sha256 header to ensure it's included in signing
    // This is required for proper AWS SigV4 signing and matches Postman behavior
    const bodyToHash = signableOptions.body || '';
    const contentSha256 = crypto.createHash('sha256').update(bodyToHash, 'utf8').digest('hex');
    signableOptions.headers['x-amz-content-sha256'] = contentSha256;

    aws4.sign(signableOptions, finalCredentials);
    // aws4.sign modifies signableOptions.headers in place
    options.headers = signableOptions.headers; // Update original options with signed headers
    console.log('Request signed with AWS Signature V4.');
    console.log('Signed headers:', Object.keys(options.headers).join(', '));
  } else if (req.auth && req.auth.type === 'awsv4'){
    console.warn('AWS V4 auth specified in Postman but no valid credentials found (either from API config or directly in Postman auth settings).');
  }
  
  if (!options.headers['User-Agent']) {
      options.headers['User-Agent'] = 'SidewalkQAFriends/1.0';
  }

  console.log('Making final request with options:', JSON.stringify(options, null, 2));
  if (options.body) { // options.body now holds the final postData
      console.log('Final request body:', options.body);
  }

  const httpModule = parsedUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    // Remove service, region, body from options before passing to http.request as they are not standard
    const { service, region, body, ...httpRequestOptions } = options; 

    const clientReq = httpModule.request(httpRequestOptions, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        console.log(`Response status: ${res.statusCode}`);
        console.log('Response body:', responseBody);
        resolve({ 
          success: true, 
          status: res.statusCode, 
          headers: res.headers, 
          body: responseBody,
          requestMetadata: {
            sentHeaders: options.headers,
            awsService: isFileTransferCollection ? 'iotwireless' : 'execute-api',
            isFileTransferCollection: isFileTransferCollection
          }
        });
      });
    });

    clientReq.on('error', (e) => {
      console.error(`Request error: ${e.message}`);
      resolve({ success: false, error: e.message });
    });

    // Write body if exists
    if (postData) {
      clientReq.write(postData);
    }
    clientReq.end();
  });
});

// IPC handler to get the list of API credential configurations
ipcMain.handle('get-api-credential-configs', async () => {
  const config = await _loadConfigInternal();
  // Ensure credentialsFilePaths is always an array, even if credentialsFilePath (singular) exists from old config
  let apiConfigs = config.credentialsFilePaths || [];
  if (apiConfigs.length === 0 && config.credentialsFilePath && typeof config.credentialsFilePath === 'string') {
    // Simple migration: if old singular path exists and new array is empty, add it as the first item.
    // This is a basic migration. A more robust one might check for duplicates if this runs multiple times.
    console.log('Migrating single credentialsFilePath to credentialsFilePaths array');
    apiConfigs = [{ id: 'default-migrated', name: 'Migrated Key', path: config.credentialsFilePath }];
    // We might want to save this migration immediately, but _loadConfigInternal is read-only.
    // The next save operation initiated by the user will persist this migrated structure if they modify API configs.
  }
  return apiConfigs; 
});

// IPC handler to save the entire list of API credential configurations
ipcMain.handle('set-api-credential-configs', async (event, apiConfigs) => {
  if (!Array.isArray(apiConfigs)) {
    return { success: false, error: 'Invalid data format: apiConfigs must be an array.' };
  }
  // Optionally, perform validation on each item in apiConfigs here (e.g., check for id, name, path)
  return _saveConfigInternal({ credentialsFilePaths: apiConfigs, credentialsFilePath: '' }); // Save new array, clear old singular path
});

// IPC handler to save modified Postman collection
ipcMain.handle('save-postman-collection', async (event, { filePath, collectionData }) => {
  try {
    console.log('Saving Postman collection to:', filePath);
    
    // Validate that the collection data has the required structure
    if (!collectionData || !collectionData.info) {
      return { success: false, error: 'Invalid collection data: missing info section.' };
    }
    
    // Write the collection data to file
    await fsPromises.writeFile(filePath, JSON.stringify(collectionData, null, 2));
    console.log('Postman collection saved successfully.');
    
    // Trigger a rescan to update the cache
    const config = await _loadConfigInternal();
    if (config.postmanCollectionPath) {
      // Re-scan collections to update cache
      const collections = [];
      try {
        const entries = await fsPromises.readdir(config.postmanCollectionPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
            const scanFilePath = path.join(config.postmanCollectionPath, entry.name);
            try {
              const fileContent = await fsPromises.readFile(scanFilePath, 'utf8');
              const jsonData = JSON.parse(fileContent);
              if (jsonData.info && jsonData.info.schema && typeof jsonData.info.schema === 'string' && 
                  (jsonData.info.schema.includes('/v2.1.0/collection.json') || jsonData.info.schema.includes('/v2.0.0/collection.json'))) {
                collections.push({
                  fileName: entry.name,
                  filePath: scanFilePath,
                  name: jsonData.info.name || entry.name.replace('.json', ''),
                  item: jsonData.item || [] 
                });
              }
            } catch (parseError) {
              console.warn(`Error parsing JSON file ${entry.name}:`, parseError.message);
            }
          }
        }
        
        // Update cache
        await fsPromises.writeFile(postmanCacheFilePath, JSON.stringify(collections, null, 2));
        
        // Notify windows of update
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('postman-collections-updated');
        }
        if (settingsWindow && !settingsWindow.isDestroyed()) {
          settingsWindow.webContents.send('postman-collections-updated');
        }
        
      } catch (scanError) {
        console.error('Error rescanning collections after save:', scanError);
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error saving Postman collection:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler to read file content (remains unchanged, used by Setting4.js)
ipcMain.handle('read-file-content', async (event, filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    console.error('readFileContent: Invalid file path provided.', filePath);
    throw new Error('Invalid file path provided.');
  }
  try {
    // Basic security check - this is a simplified check.
    // For a production app, consider more robust path validation/sandboxing.
    if (filePath.includes('..')) { 
      // Prevent directory traversal. 
      // A better check might be to ensure it's within a user-selected or userData path.
      console.warn(`readFileContent: Path "${filePath}" may be unsafe. Blocking read.`);
      throw new Error('Access to the path is restricted.');
    }
    // No need to check if absolute if it comes from dialog.showOpenDialog, it will be absolute.

    await fsPromises.access(filePath, fs.constants.F_OK); // Check if file exists and is accessible
    const content = await fsPromises.readFile(filePath, 'utf8');
    return content;
  } catch (error) {
    console.error(`Error reading file "${filePath}":`, error);
    // Send a clear error message back to the renderer
    throw new Error(`Failed to read file: ${error.message}`); 
  }
});

// API Test Page state persistence with memory cache
const apiTestStateFilePath = path.join(app.getPath('userData'), 'api_test_state.json');
let apiTestStateCache = null;
let apiTestStateCacheTimestamp = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// IPC handler to save API Test page state with memory cache
ipcMain.handle('save-api-test-state', async (event, state) => {
  try {
    console.log('Saving API Test page state:', state?.timestamp || 'no timestamp');
    
    // Validate state data
    if (!state || typeof state !== 'object') {
      console.warn('Invalid API Test state data provided');
      return { success: false, error: 'Invalid state data' };
    }
    
    // Update memory cache first for immediate access
    apiTestStateCache = state;
    apiTestStateCacheTimestamp = Date.now();
    
    // Save to file asynchronously (don't block UI)
    setImmediate(async () => {
      try {
        await fsPromises.writeFile(apiTestStateFilePath, JSON.stringify(state, null, 2));
        console.log('API Test page state saved to disk successfully');
      } catch (fileError) {
        console.error('Error saving API Test state to disk:', fileError);
      }
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error saving API Test page state:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler to load API Test page state with memory cache
ipcMain.handle('load-api-test-state', async () => {
  try {
    const now = Date.now();
    
    // Check if memory cache is valid and recent
    if (apiTestStateCache && (now - apiTestStateCacheTimestamp) < CACHE_DURATION) {
      console.log('API Test page state loaded from memory cache');
      return apiTestStateCache;
    }
    
    // Check if state file exists
    try {
      await fsPromises.access(apiTestStateFilePath, fs.constants.F_OK);
    } catch (accessError) {
      console.log('No existing API Test state file found, returning null');
      return null;
    }
    
    // Read and parse state file
    const stateContent = await fsPromises.readFile(apiTestStateFilePath, 'utf8');
    const state = JSON.parse(stateContent);
    
    // Update memory cache
    apiTestStateCache = state;
    apiTestStateCacheTimestamp = now;
    
    console.log('API Test page state loaded from disk and cached');
    return state;
  } catch (error) {
    console.error('Error loading API Test page state:', error);
    // Return null instead of throwing error so app can continue with fresh state
    return null;
  }
});

// Serial port management for RFD devices
let currentSerialPort = null;
let serialPortConfig = {
  port: 'COM7',
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none'
};

// Global flag to prevent concurrent serial operations
let serialOperationInProgress = false;
let lastCommandTime = 0;
let activeIpcCalls = new Set();
let activeTimeouts = new Set();

// List available serial ports
ipcMain.handle('list-serial-ports', async () => {
  try {
    const ports = await SerialPort.list();
    console.log('Available serial ports:', ports);
    return ports;
  } catch (error) {
    console.error('Error listing serial ports:', error);
    return [];
  }
});

// Configure serial port settings
ipcMain.handle('configure-serial-port', async (event, config) => {
  try {
    serialPortConfig = { ...serialPortConfig, ...config };
    console.log('Serial port configuration updated:', serialPortConfig);
    return { success: true };
  } catch (error) {
    console.error('Error configuring serial port:', error);
    return { success: false, error: error.message };
  }
});

// Open serial port connection
ipcMain.handle('open-serial-port', async (event, portPath) => {
  try {
    if (currentSerialPort && currentSerialPort.isOpen) {
      await currentSerialPort.close();
    }

    const config = portPath ? { ...serialPortConfig, path: portPath } : serialPortConfig;
    
    currentSerialPort = new SerialPort({
      path: config.port,
      baudRate: config.baudRate,
      dataBits: config.dataBits,
      stopBits: config.stopBits,
      parity: config.parity,
      autoOpen: false
    });

    return new Promise((resolve, reject) => {
      currentSerialPort.open((error) => {
        if (error) {
          console.error('Error opening serial port:', error);
          reject(error);
        } else {
          console.log('Serial port opened successfully:', config.port);
          resolve({ success: true, port: config.port });
        }
      });
    });
  } catch (error) {
    console.error('Error opening serial port:', error);
    return { success: false, error: error.message };
  }
});

// Close serial port connection
ipcMain.handle('close-serial-port', async () => {
  console.log('[DEBUG] close-serial-port called');
  console.trace('[DEBUG] Call stack for close-serial-port');
  
  try {
    // Clear all active timeouts first
    activeTimeouts.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    activeTimeouts.clear();
    
    // Clear active IPC calls
    activeIpcCalls.clear();
    
    // Reset operation flags
    serialOperationInProgress = false;
    
    if (currentSerialPort && currentSerialPort.isOpen) {
      return new Promise((resolve) => {
        currentSerialPort.close((error) => {
          if (error) {
            console.error('Error closing serial port:', error);
          } else {
            console.log('Serial port closed successfully');
          }
          currentSerialPort = null;
          resolve({ success: true });
        });
      });
    }
    
    // If port is already closed, just clear the reference
    currentSerialPort = null;
    return { success: true };
  } catch (error) {
    console.error('Error closing serial port:', error);
    currentSerialPort = null;
    return { success: false, error: error.message };
  }
});

// Global variable to track progress messages for this session
let currentTransferProgressSent = new Set();

// Send file via serial commands
ipcMain.handle('send-file-xmodem', async (event, filePath, destPath) => {
  try {
    if (!currentSerialPort || !currentSerialPort.isOpen) {
      return { success: false, error: 'Serial port not open' };
    }

    // Reset progress tracking for new transfer
    currentTransferProgressSent.clear();
    
    const fileContent = await fsPromises.readFile(filePath, 'utf8');
    
    // Extract filename from source path
    const fileName = path.basename(filePath);
    
    // Check if destPath is a directory (ends with / or doesn't have extension)
    let finalDestPath = destPath;
    if (destPath.endsWith('/') || (!destPath.includes('.') && !destPath.includes(fileName))) {
      // It's a directory, append filename
      finalDestPath = destPath.endsWith('/') ? destPath + fileName : destPath + '/' + fileName;
    }
    
    console.log(`Sending file via serial commands: ${filePath} -> ${finalDestPath}`);
    
    return new Promise((resolve) => {
      let responseData = '';
      let commandSent = false;
      let progressStep = 0; // Track which step we're on
      
      // Send progress updates to renderer (with global duplicate prevention)
      const sendProgress = (progress) => {
        const messageKey = `${progress.status}:${progress.message}`;
        if (!currentTransferProgressSent.has(messageKey)) {
          currentTransferProgressSent.add(messageKey);
          console.log(`[BACKEND] Sending progress: ${progress.message}`);
          event.sender.send('xmodem-progress', progress);
        } else {
          console.log(`[BACKEND] Blocked duplicate progress: ${progress.message}`);
        }
      };

      // Data handler for serial port
      const dataHandler = (data) => {
        responseData += data.toString();
        
        // Send data to renderer for display (with basic duplicate prevention)
        if (event.sender && !event.sender.isDestroyed()) {
          const dataStr = data.toString();
          // Only send non-empty, non-whitespace-only data
          if (dataStr.trim().length > 0) {
            event.sender.send('serial-data-received', dataStr);
          }
        }
        
        // Check for command completion or errors
        if (responseData.includes('# ') || responseData.includes('$ ')) {
          if (commandSent) {
            // Command completed
            if (responseData.includes('No such file') || responseData.includes('Permission denied') || responseData.includes('Is a directory')) {
              const errorMsg = responseData.includes('Permission denied') ? 'Permission denied' :
                              responseData.includes('Is a directory') ? 'Destination is a directory - file path needed' :
                              'File transfer failed - check permissions and paths';
              sendProgress({ status: 'error', message: `Send failed: ${errorMsg}` });
              resolve({ success: false, error: errorMsg });
            } else {
              sendProgress({ status: 'completed', message: 'File sent successfully via serial commands' });
              resolve({ success: true, message: 'File sent successfully via serial commands' });
            }
          }
        }
      };

      // Error handler
      const errorHandler = (error) => {
        console.error('Serial port error during file send:', error);
        resolve({ success: false, error: error.message });
      };

      // Set up event listeners
      currentSerialPort.on('data', dataHandler);
      currentSerialPort.on('error', errorHandler);
      
      // Send progress step by step with proper sequencing
      if (progressStep === 0) {
        progressStep = 1;
        sendProgress({ status: 'starting', message: 'Preparing to send file via serial commands...' });
      }
      
      // Small delay to ensure progress message is sent before next step
      setTimeout(() => {
        // Create the file using echo command (for small files) or cat command
        const escapedContent = fileContent.replace(/'/g, "'\"'\"'"); // Escape single quotes
        const command = `echo '${escapedContent}' > ${finalDestPath}\n`;
        
        if (progressStep === 1) {
          progressStep = 2;
          sendProgress({ status: 'sending', message: 'Sending file content...' });
        }
        
        // Another small delay before sending command
        setTimeout(() => {
          // Send the command
          currentSerialPort.write(command, (error) => {
            if (error) {
              console.error('Error writing to serial port:', error);
              resolve({ success: false, error: error.message });
            } else {
              commandSent = true;
              if (progressStep === 2) {
                progressStep = 3;
                sendProgress({ status: 'waiting', message: 'Waiting for command completion...' });
              }
              
              // Set timeout for command completion
              setTimeout(() => {
                currentSerialPort.removeListener('data', dataHandler);
                currentSerialPort.removeListener('error', errorHandler);
                
                if (!commandSent) {
                  resolve({ success: false, error: 'Command timeout' });
                }
              }, 10000); // 10 second timeout
            }
          });
        }, 200); // 200ms delay before sending command
      }, 200); // 200ms delay before preparing command
    });
  } catch (error) {
    console.error('Error sending file via serial commands:', error);
    return { success: false, error: error.message };
  }
});

// Receive file via serial commands (no compression for RFD)
ipcMain.handle('receive-file-xmodem', async (event, savePath, remotePath) => {
  // Create unique call ID to prevent duplicate calls
  const callId = `${savePath}:${remotePath}:${Date.now()}`;
  
  if (activeIpcCalls.has(callId) || activeIpcCalls.size > 0) {
    console.log('Duplicate or concurrent IPC call detected, rejecting');
    return { success: false, error: 'Operation already in progress or duplicate call detected' };
  }
  
  activeIpcCalls.add(callId);
  
  try {
    if (!currentSerialPort || !currentSerialPort.isOpen) {
      activeIpcCalls.delete(callId);
      return { success: false, error: 'Serial port not open' };
    }

    console.log(`[DEBUG] Receiving via serial commands: ${remotePath} -> ${savePath}`);
    console.log(`[DEBUG] Call ID: ${callId}`);
    console.log(`[DEBUG] Active IPC calls: ${activeIpcCalls.size}`);
    
    // Create com_cat timestamped folder
    const { folderName, folderPath } = createComCatFolder(savePath);
    
    console.log(`[DEBUG] Creating com_cat folder: ${folderName}`);
    
    // Create the com_cat directory
    try {
      await fsPromises.mkdir(folderPath, { recursive: true });
      console.log(`[DEBUG] Created com_cat folder: ${folderPath}`);
      
      // Send progress update about folder creation
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('xmodem-progress', {
          status: 'preparing',
          message: `Created folder: ${folderName}`
        });
      }
    } catch (mkdirError) {
      console.error(`[DEBUG] Error creating com_cat folder:`, mkdirError);
      activeIpcCalls.delete(callId);
      return { success: false, error: `Failed to create com_cat folder: ${mkdirError.message}` };
    }
    
    // Determine if it's a directory or file
    const isDirectory = remotePath.endsWith('/') || !remotePath.includes('.');
    
    let result;
    if (isDirectory) {
      // For directories, list files and download each one into com_cat folder
      result = await receiveDirectorySerial(event, folderPath, remotePath);
    } else {
      // For single files, download directly into com_cat folder
      const fileName = remotePath.split('/').pop() || 'received_file';
      const fileDestPath = path.join(folderPath, fileName);
      result = await receiveSingleFileSerial(event, fileDestPath, remotePath);
    }
    
    // Add folder info to result
    if (result.success) {
      result.comCatFolder = folderName;
      result.comCatFolderPath = folderPath;
    }
    
    activeIpcCalls.delete(callId);
    return result;
  } catch (error) {
    console.error('Error receiving via serial commands:', error);
    activeIpcCalls.delete(callId);
    return { success: false, error: error.message };
  }
});

// Helper function to create timestamped com_cat folder
function createComCatFolder(basePath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
  const comCatFolderName = `com_cat_${timestamp}`;
  const comCatFolderPath = path.join(basePath, comCatFolderName);
  
  return { folderName: comCatFolderName, folderPath: comCatFolderPath };
}

// Helper function to receive a single file via serial
async function receiveSingleFileSerial(event, savePath, remotePath) {
  // Check if serial port is open
  if (!currentSerialPort || !currentSerialPort.isOpen) {
    console.error('[DEBUG] Serial port not open for file download:', remotePath);
    return { success: false, error: 'Serial port not open' };
  }
  
  return new Promise((resolve) => {
    let responseData = '';
    let commandSent = false;
    let timeoutId = null;
    let lastProgressMessage = '';
    let dataHandlerAttached = false;
    
    // Send progress updates to renderer with deduplication
    const sendProgress = (progress) => {
      if (progress.message !== lastProgressMessage) {
        console.log(`[DEBUG] Single file - sending progress: ${progress.message}`);
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('xmodem-progress', progress);
        }
        lastProgressMessage = progress.message;
      }
    };

    // Process the complete response
    const processResponse = () => {
      console.log(`[DEBUG] Processing response, total length: ${responseData.length}`);
      
      // Clear timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
        activeTimeouts.delete(timeoutId);
        timeoutId = null;
      }
      
      // Remove event listeners to prevent duplicate processing
      if (currentSerialPort && currentSerialPort.removeListener && dataHandlerAttached) {
        currentSerialPort.removeListener('data', dataHandler);
        currentSerialPort.removeListener('error', errorHandler);
        dataHandlerAttached = false;
      }
      
      // Check for errors first
      if (responseData.includes('No such file') || responseData.includes('Permission denied') ||
          responseData.includes('cannot open') || responseData.includes('Is a directory')) {
        const errorMsg = responseData.includes('Permission denied') ? 'Permission denied' :
                        responseData.includes('Is a directory') ? 'Path is a directory' :
                        'File not found';
        resolve({ success: false, error: errorMsg });
        return;
      }
      
      // Extract file content with enhanced parsing
      const lines = responseData.split('\n');
      let cleanContent = '';
      let inContent = false;
      let expectedSize = null;
      let fileStartFound = false;
      let contentStartFound = false;
      let fileEndFound = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Look for file start marker
        if (!fileStartFound && line.includes('=== FILE_START ===')) {
          fileStartFound = true;
          console.log(`[DEBUG] Found file start marker at line ${i}`);
          continue;
        }
        
        // Look for file size information
        if (fileStartFound && !expectedSize && line.match(/^\s*\d+\s+/)) {
          const sizeMatch = line.match(/^\s*(\d+)\s+/);
          if (sizeMatch) {
            expectedSize = parseInt(sizeMatch[1]);
            console.log(`[DEBUG] Expected file size: ${expectedSize} bytes`);
          }
          continue;
        }
        
        // Look for content start marker
        if (fileStartFound && !contentStartFound && line.includes('=== CONTENT_START ===')) {
          contentStartFound = true;
          console.log(`[DEBUG] Found content start marker at line ${i}`);
          inContent = true;
          continue;
        }
        
        // Look for file end marker
        if (contentStartFound && line.includes('=== FILE_END ===')) {
          fileEndFound = true;
          console.log(`[DEBUG] Found file end marker at line ${i}`);
          break;
        }
        
        // Skip the command echo and binary detection messages
        if (!inContent && (line.includes(`cat "${remotePath}"`) || line.includes(`cat ${remotePath}`) ||
            line.includes('base64') || line.includes('Binary file detected') || line.includes('wc -c'))) {
          console.log(`[DEBUG] Skipping command echo at line ${i}: "${line}"`);
          continue;
        }
        
        // Stop at prompt if no end marker found
        if (inContent && !fileEndFound && (line === '# ' || line === '$ ' || 
            line.endsWith('# ') || line.endsWith('$ '))) {
          console.log(`[DEBUG] Prompt detected without end marker at line ${i}: "${line}"`);
          break;
        }
        
        if (inContent && !fileEndFound) {
          cleanContent += (cleanContent ? '\n' : '') + line;
        }
      }
      
      // Validate file transfer completeness
      if (!fileStartFound || !contentStartFound) {
        console.log('[DEBUG] File transfer markers not found - possible incomplete transfer');
        resolve({ success: false, error: 'File transfer incomplete - missing markers' });
        return;
      }
      
      // Validate file size if available
      if (expectedSize !== null && cleanContent.length !== expectedSize) {
        console.log(`[DEBUG] Size mismatch: expected ${expectedSize}, got ${cleanContent.length}`);
        // For text files, allow slight differences due to line ending conversion
        const sizeDifference = Math.abs(cleanContent.length - expectedSize);
        if (sizeDifference > expectedSize * 0.1) { // Allow 10% difference
          console.log('[DEBUG] Significant size difference detected');
          resolve({ success: false, error: `File size mismatch: expected ${expectedSize} bytes, got ${cleanContent.length} bytes` });
          return;
        }
      }
      
      // Handle empty files
      if (cleanContent === '' && inContent) {
        console.log('[DEBUG] Empty file detected');
        cleanContent = ''; // Empty file is valid
      }
      
      console.log(`[DEBUG] Extracted content length: ${cleanContent.length} bytes`);
      
      // Check if base64 encoded
      if (cleanContent.includes('Binary file detected, encoding...')) {
        const base64Content = cleanContent.replace('Binary file detected, encoding...', '').trim();
        try {
          const binaryData = Buffer.from(base64Content, 'base64');
          fsPromises.writeFile(savePath, binaryData)
            .then(() => {
              const result = { success: true, filePath: savePath, size: binaryData.length };
              if (expectedSize !== null) {
                result.expectedSize = expectedSize;
                result.verified = binaryData.length === expectedSize;
              }
              resolve(result);
            })
            .catch((err) => {
              resolve({ success: false, error: err.message });
            });
        } catch (err) {
          resolve({ success: false, error: 'Failed to decode base64' });
        }
      } else {
        // Save text file
        fsPromises.writeFile(savePath, cleanContent)
          .then(() => {
            const result = { success: true, filePath: savePath, size: cleanContent.length };
            if (expectedSize !== null) {
              result.expectedSize = expectedSize;
              result.verified = Math.abs(cleanContent.length - expectedSize) <= expectedSize * 0.1;
            }
            resolve(result);
          })
          .catch((err) => {
            resolve({ success: false, error: err.message });
          });
      }
    };

    // Data handler for serial port - with deduplication
    const dataHandler = (data) => {
      const dataStr = data.toString();
      
      // Send data to renderer for display (only once per data chunk)
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('serial-data-received', dataStr);
      }
      
      // Accumulate data
      responseData += dataStr;
      
      // Reset timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
        activeTimeouts.delete(timeoutId);
        timeoutId = null;
      }
      
      // Log data for debugging (reduced verbosity)
      if (dataStr.length > 50) {
        console.log(`[DEBUG] Received data chunk (${dataStr.length} bytes): "${dataStr.substring(0, 50)}..."`);
      } else {
        console.log(`[DEBUG] Received data: "${dataStr.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`);
      }
      
      // Check if we have a complete response (prompt at end)
      const lines = responseData.split('\n');
      const lastLine = lines[lines.length - 1];
      
      if (commandSent && (lastLine === '# ' || lastLine === '$ ' || 
          lastLine.endsWith('# ') || lastLine.endsWith('$ '))) {
        console.log(`[DEBUG] Prompt detected: "${lastLine}", processing response`);
        processResponse();
      } else {
        // Set new timeout
        timeoutId = setTimeout(() => {
          console.log('[DEBUG] Timeout waiting for prompt, processing what we have');
          processResponse();
        }, 5000); // 5 second timeout
        activeTimeouts.add(timeoutId);
      }
    };

    // Error handler
    const errorHandler = (error) => {
      console.error('Serial port error during file receive:', error);
      
      // Clean up timeouts
      if (timeoutId) {
        clearTimeout(timeoutId);
        activeTimeouts.delete(timeoutId);
        timeoutId = null;
      }
      
      // Remove event listeners
      if (currentSerialPort && currentSerialPort.removeListener && dataHandlerAttached) {
        currentSerialPort.removeListener('data', dataHandler);
        currentSerialPort.removeListener('error', errorHandler);
        dataHandlerAttached = false;
      }
      
      resolve({ success: false, error: error.message });
    };

    // Set up event listeners only once
    if (!dataHandlerAttached) {
      currentSerialPort.on('data', dataHandler);
      currentSerialPort.on('error', errorHandler);
      dataHandlerAttached = true;
    }
    
    // Send initial progress
    sendProgress({ status: 'starting', message: 'Preparing to receive file...' });
    
    // For files, determine if it's likely text or binary based on extension
    const fileName = remotePath.split('/').pop();
    const textExtensions = ['.txt', '.log', '.conf', '.cfg', '.json', '.xml', '.html', '.css', '.js', '.sh', '.py', '.md', '.yml', '.yaml'];
    const isLikelyText = textExtensions.some(ext => fileName.toLowerCase().endsWith(ext)) || !fileName.includes('.');
    
    // Use more robust command for better reliability
    const command = isLikelyText ? 
      `echo "=== FILE_START ===" && wc -c "${remotePath}" && echo "=== CONTENT_START ===" && cat "${remotePath}" && echo "=== FILE_END ==="\n` : 
      `echo "=== FILE_START ===" && wc -c "${remotePath}" && echo "=== CONTENT_START ===" && echo "Binary file detected, encoding..." && base64 "${remotePath}" && echo "=== FILE_END ==="\n`;
    
    sendProgress({ status: 'sending', message: 'Sending enhanced file read command...' });
    
    // Clear serial buffer before sending command
    if (currentSerialPort.flush) {
      currentSerialPort.flush();
    }
    
    // Send the command with a small delay to avoid duplication
    setTimeout(() => {
      console.log(`[DEBUG] Sending command: ${command.trim()}`);
      currentSerialPort.write(command, (error) => {
        if (error) {
          console.error('Error writing to serial port:', error);
          
          // Clean up on error
          if (timeoutId) {
            clearTimeout(timeoutId);
            activeTimeouts.delete(timeoutId);
            timeoutId = null;
          }
          
          if (currentSerialPort && currentSerialPort.removeListener && dataHandlerAttached) {
            currentSerialPort.removeListener('data', dataHandler);
            currentSerialPort.removeListener('error', errorHandler);
            dataHandlerAttached = false;
          }
          
          resolve({ success: false, error: error.message });
        } else {
          commandSent = true;
          sendProgress({ status: 'waiting', message: 'Waiting for file content...' });
          
          // Set main timeout for command completion
          const mainTimeoutId = setTimeout(() => {
            activeTimeouts.delete(mainTimeoutId);
            console.log('[DEBUG] Main timeout reached, forcing response processing');
            processResponse();
          }, 30000); // 30 second timeout for command completion
          
          activeTimeouts.add(mainTimeoutId);
        }
      });
    }, 500); // 500ms delay to ensure serial port is ready
  });
}

// Helper function to receive a directory via serial (download individual files)
async function receiveDirectorySerial(event, savePath, remotePath) {
  console.log('[DEBUG] Starting receiveDirectorySerial for:', remotePath);
  
  return new Promise((resolve) => {
    // Wrap resolve to cleanup
    const cleanupResolve = (result) => {
      resolve(result);
    };
    
    // For recursive calls, we don't want to block on serialOperationInProgress
    const isRecursiveCall = remotePath.split('/').length > 3; // Assuming base path has 2-3 parts
    
    if (!isRecursiveCall) {
      // Check if another serial operation is in progress
      if (serialOperationInProgress) {
        cleanupResolve({ success: false, error: 'Another serial operation is already in progress' });
        return;
      }
      
      // Check if we're sending commands too quickly
      const now = Date.now();
      if (now - lastCommandTime < 2000) {
        cleanupResolve({ success: false, error: 'Commands sent too quickly, please wait' });
        return;
      }
      
      serialOperationInProgress = true;
      lastCommandTime = now;
    }
    
    let responseData = '';
    let commandSent = false;
    let fileList = [];
    let lastProgressMessage = '';
    let lastDataTime = Date.now();
    let completionTimer = null;
    
    // Send progress updates to renderer (with deduplication)
    const sendProgress = (progress) => {
      if (progress.message !== lastProgressMessage) {
        console.log(`[DEBUG] Directory listing - sending progress: ${progress.message}`);
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('xmodem-progress', progress);
        }
        lastProgressMessage = progress.message;
      }
    };

    // Data handler for serial port - with deduplication
    const dataHandler = (data) => {
      const dataStr = data.toString();
      responseData += dataStr;
      lastDataTime = Date.now();
      
      // Log data for debugging (reduced verbosity for directory listing)
      if (dataStr.length > 100) {
        console.log(`[DEBUG] Received data chunk (${dataStr.length} bytes): "${dataStr.substring(0, 50)}..."`);
      } else {
        console.log(`[DEBUG] Received data chunk: "${dataStr.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`);
      }
      
      // Send data to renderer for display (only once per data chunk)
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('serial-data-received', dataStr);
      }
      
      // Clear any existing completion timer
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      
      // Only check for command completion if we've sent the command and received substantial data
      if (commandSent && responseData.length > command.length + 10) {
        // Check for command completion - look for prompt at the end of output
        const lastLine = responseData.split('\n').pop();
        const promptPatterns = ['# ', '$ ', '> ', '>> ', '~#', '~$'];
        const hasPromptAtEnd = promptPatterns.some(pattern => lastLine.includes(pattern));
        
        // Also check if we have the expected output (total line from ls -l)
        const hasListingOutput = responseData.includes('total ') || responseData.includes('No such file or directory');
        
        if (hasPromptAtEnd && hasListingOutput) {
          // Wait a bit more to ensure we get all data
          completionTimer = setTimeout(() => {
            console.log(`[DEBUG] Command completed. Raw response data:\n${responseData}`);
            
            // Parse the file list from ls -l output
            const lines = responseData.split('\n');
            for (const line of lines) {
              let trimmed = line.trim();
            
            // Strip ANSI color codes and escape sequences
            trimmed = trimmed.replace(/\x1b\[[0-9;]*m/g, '');
            trimmed = trimmed.replace(/\[[\d;]*m/g, ''); // Also remove partial escape sequences
            
            // Filter out command echoes, prompts, and total line
            if (trimmed && 
                !trimmed.includes('cd ') && 
                !trimmed.includes('ls ') && 
                !trimmed.includes('# ') && 
                !trimmed.includes('$ ') && 
                !trimmed.startsWith('total ') &&
                trimmed.length > 0) {
              
              // Extract filename from ls -l output (last column)
              // ls -l format: permissions links owner group size date time filename
              const parts = trimmed.split(/\s+/);
              if (parts.length >= 8 && (trimmed.startsWith('-') || trimmed.startsWith('d'))) {
                // Handle both files and directories
                if (trimmed.startsWith('-') || trimmed.startsWith('d')) {
                  // For ls -l, filename is the last part (or parts if it has spaces)
                  // The format is: permissions links owner group size month day time/year filename
                  let filename = '';
                  
                  // For files with permissions set, we know the structure
                  // Skip: permissions(0) links(1) owner(2) group(3) size(4) month(5) day(6) time/year(7)
                  // The filename starts at index 8
                  if (parts.length >= 9) {
                    filename = parts.slice(8).join(' ');
                  }
                  
                  if (filename && filename !== '.' && filename !== '..') {
                    // Skip btmp, wtmp, and files without extensions
                    if (trimmed.startsWith('-')) {
                      // It's a file
                      if (filename === 'btmp' || filename === 'wtmp' || !filename.includes('.')) {
                        console.log(`[DEBUG] Skipping file: ${filename} (btmp/wtmp or no extension)`);
                      } else {
                        console.log(`[DEBUG] Found file: ${filename}`);
                        fileList.push({ name: filename, type: 'file' });
                      }
                    } else if (trimmed.startsWith('d')) {
                      // It's a directory - skip system directories
                      if (filename === 'private' || filename === 'journal') {
                        console.log(`[DEBUG] Skipping system directory: ${filename}`);
                      } else {
                        console.log(`[DEBUG] Found directory: ${filename}`);
                        fileList.push({ name: filename, type: 'directory' });
                      }
                    }
                  }
                }
              }
            }
          }
          
            // Remove duplicates based on name
            const uniqueItems = [];
            const seen = new Set();
            for (const item of fileList) {
              if (!seen.has(item.name)) {
                seen.add(item.name);
                uniqueItems.push(item);
              }
            }
            fileList = uniqueItems;
            
            console.log(`[DEBUG] Parsed items:`, fileList);
            
            // Clear the main timeout since we're done
            if (completionTimer) {
              clearTimeout(completionTimer);
              completionTimer = null;
            }
            
            // Remove event listeners
            if (currentSerialPort && currentSerialPort.removeListener) {
              currentSerialPort.removeListener('data', dataHandler);
              currentSerialPort.removeListener('error', errorHandler);
            }
            
            // Download each file individually
            console.log('[DEBUG] About to start downloadFilesSequentially');
            console.log('[DEBUG] Serial port status:', currentSerialPort ? (currentSerialPort.isOpen ? 'open' : 'closed') : 'null');
            
            downloadFilesSequentially(event, savePath, remotePath, fileList, (result) => {
              console.log('[DEBUG] downloadFilesSequentially completed with result:', result);
              if (!isRecursiveCall) {
                serialOperationInProgress = false;
              }
              cleanupResolve(result);
            });
          }, 500); // Wait 500ms to ensure all data is received
        }
      }
    };

    // Error handler
    const errorHandler = (error) => {
      console.error('Serial port error during directory listing:', error);
      if (!isRecursiveCall) {
        serialOperationInProgress = false;
      }
      cleanupResolve({ success: false, error: error.message });
    };

    // Set up event listeners
    currentSerialPort.on('data', dataHandler);
    currentSerialPort.on('error', errorHandler);
    
    // Send initial progress
    sendProgress({ status: 'starting', message: 'Listing directory contents...' });
    
    // List directory contents - use cd first then ls -l for better compatibility
    const command = `cd "${remotePath}" && ls -l\n`;
    
    console.log(`[DEBUG] Preparing to send command: ${command.trim()}`);
    sendProgress({ status: 'sending', message: 'Getting file list...' });
    
          // Send the command with a small delay to avoid duplication
      setTimeout(() => {
        // Double-check that we're not sending duplicate commands
        if (commandSent) {
          console.log('[DEBUG] Command already sent, skipping duplicate');
          return;
        }
        
        // Clear any pending data before sending new command
        currentSerialPort.flush(() => {
          console.log(`[DEBUG] Sending command to serial port: ${command.trim()}`);
          currentSerialPort.write(command, (error) => {
            if (error) {
              console.error('Error writing to serial port:', error);
              if (!isRecursiveCall) {
                serialOperationInProgress = false;
              }
              cleanupResolve({ success: false, error: error.message });
            } else {
              commandSent = true;
              sendProgress({ status: 'waiting', message: 'Waiting for file list...' });
              
              // Set timeout for command completion
              const timeoutId = setTimeout(() => {
                // Remove from active timeouts
                activeTimeouts.delete(timeoutId);
                
                // Check if we're still waiting for response
                if (!isRecursiveCall && serialOperationInProgress) {
                  console.log('[DEBUG] Directory listing timeout - no response received');
                  if (currentSerialPort && currentSerialPort.removeListener) {
                    currentSerialPort.removeListener('data', dataHandler);
                    currentSerialPort.removeListener('error', errorHandler);
                  }
                  serialOperationInProgress = false;
                  cleanupResolve({ success: false, error: 'Directory listing timeout - no response from device' });
                } else if (isRecursiveCall) {
                  console.log('[DEBUG] Directory listing timeout in recursive call');
                  if (currentSerialPort && currentSerialPort.removeListener) {
                    currentSerialPort.removeListener('data', dataHandler);
                    currentSerialPort.removeListener('error', errorHandler);
                  }
                  cleanupResolve({ success: false, error: 'Directory listing timeout - no response from device' });
                }
              }, 15000); // 15 second timeout for listing
              
              // Add to active timeouts for cleanup
              activeTimeouts.add(timeoutId);
              
              // Store timeout ID for cleanup
              completionTimer = timeoutId;
            }
          });
        });
      }, 500); // 500ms delay to ensure serial port is ready
  });
}

// Helper function to download files sequentially
async function downloadFilesSequentially(event, savePath, remotePath, fileList, resolve) {
  if (fileList.length === 0) {
    resolve({ success: true, message: 'No files found in directory', fileCount: 0 });
    return;
  }
  
  // Check if serial port is still open
  if (!currentSerialPort || !currentSerialPort.isOpen) {
    console.error('[DEBUG] Serial port is not open, cannot download files');
    resolve({ success: false, error: 'Serial port was closed before downloading files' });
    return;
  }
  
  // Send progress updates
  const sendProgress = (progress) => {
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('xmodem-progress', progress);
    }
  };
  
  let downloadedCount = 0;
  let totalItems = fileList.length;
  let processedDirs = 0;
  
  console.log(`[DEBUG] Starting sequential download of ${totalItems} items (files and directories)`);
  sendProgress({ status: 'downloading', message: `Starting download of ${totalItems} items...` });
  
  for (const item of fileList) {
    try {
      // Check if serial port is still open before each item
      if (!currentSerialPort || !currentSerialPort.isOpen) {
        console.error('[DEBUG] Serial port closed during download sequence');
        break;
      }
      
      if (item.type === 'directory') {
        // Handle directory - create local directory and download its contents
        const remoteDirPath = `${remotePath}/${item.name}`;
        const localDirPath = path.join(savePath, item.name);
        
        console.log(`[DEBUG] Processing directory: ${item.name}`);
        sendProgress({ 
          status: 'downloading', 
          message: `Processing directory ${item.name}...` 
        });
        
        // Create local directory
        try {
          await fsPromises.mkdir(localDirPath, { recursive: true });
          console.log(`[DEBUG] Created local directory: ${localDirPath}`);
        } catch (mkdirError) {
          console.error(`[DEBUG] Error creating directory ${localDirPath}:`, mkdirError);
        }
        
        // Recursively download directory contents
        const dirResult = await receiveDirectorySerial(event, localDirPath, remoteDirPath);
        if (dirResult.success) {
          processedDirs++;
          console.log(`[DEBUG] Successfully processed directory: ${item.name}`);
        } else {
          console.error(`[DEBUG] Failed to process directory ${item.name}:`, dirResult.error);
        }
      } else {
        // Handle file
        const remoteFilePath = `${remotePath}/${item.name}`;
        const localFilePath = path.join(savePath, item.name);
        
        console.log(`[DEBUG] Downloading file ${downloadedCount + 1}: ${item.name}`);
        sendProgress({ 
          status: 'downloading', 
          message: `Downloading ${item.name} (${downloadedCount + 1}/${totalItems})...`,
          percentage: Math.round(((downloadedCount + processedDirs) / totalItems) * 100)
        });
        
        // Download individual file with retry
        let retryCount = 0;
        let result = null;
        
        while (retryCount < 3) {
          result = await receiveSingleFileSerial(event, localFilePath, remoteFilePath);
          
          if (result.success) {
            downloadedCount++;
            console.log(`[DEBUG] Successfully downloaded: ${item.name}`);
            
            // Send detailed success message with verification info
            let successMessage = `Downloaded ${item.name} (${result.size} bytes)`;
            if (result.expectedSize !== undefined) {
              if (result.verified) {
                successMessage += ` - ✅ Integrity verified`;
              } else {
                successMessage += ` - ⚠️ Size mismatch: expected ${result.expectedSize}, got ${result.size}`;
              }
            }
            
            const completionPercentage = Math.round(((downloadedCount + processedDirs) / totalItems) * 100);
            sendProgress({ 
              status: 'downloading', 
              message: successMessage,
              percentage: completionPercentage
            });
            break;
          } else {
            retryCount++;
            console.error(`[DEBUG] Failed to download ${item.name} (attempt ${retryCount}/3):`, result.error);
            
            if (retryCount < 3) {
              console.log(`[DEBUG] Retrying download for ${item.name}...`);
              sendProgress({ 
                status: 'downloading', 
                message: `Retrying ${item.name} (attempt ${retryCount + 1}/3)...` 
              });
              // Wait a bit before retry
              await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
              console.error(`[DEBUG] Failed to download ${item.name} after 3 attempts`);
              // Continue with next file instead of stopping
            }
          }
        }
      }
      
      // Add a longer delay between items to avoid overwhelming the serial port
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`[DEBUG] Error processing ${item.name}:`, error);
      // Continue with next item
    }
  }
  
  console.log(`[DEBUG] Download sequence completed: ${downloadedCount} files, ${processedDirs} directories`);
  
  // Send final completion progress
  sendProgress({ 
    status: 'completed', 
    message: `Completed: ${downloadedCount} files, ${processedDirs} directories`,
    percentage: 100
  });
  
  resolve({ 
    success: true, 
    message: `Downloaded ${downloadedCount} files and processed ${processedDirs} directories`, 
    fileCount: downloadedCount,
    dirCount: processedDirs,
    totalItems: totalItems
  });
}

// Send raw data to serial port
ipcMain.handle('send-serial-data', async (event, data) => {
  try {
    if (!currentSerialPort || !currentSerialPort.isOpen) {
      return { success: false, error: 'Serial port not open' };
    }

    return new Promise((resolve) => {
      currentSerialPort.write(data, (error) => {
        if (error) {
          console.error('Error sending serial data:', error);
          resolve({ success: false, error: error.message });
        } else {
          console.log('Serial data sent successfully');
          resolve({ success: true });
        }
      });
    });
  } catch (error) {
    console.error('Error sending serial data:', error);
    return { success: false, error: error.message };
  }
});

// Listen for serial port data
ipcMain.handle('start-serial-listening', async (event) => {
  try {
    if (!currentSerialPort || !currentSerialPort.isOpen) {
      return { success: false, error: 'Serial port not open' };
    }

    // Remove any existing listeners to prevent duplicates
    currentSerialPort.removeAllListeners('data');
    currentSerialPort.removeAllListeners('error');

    currentSerialPort.on('data', (data) => {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('serial-data-received', data.toString());
      }
    });

    currentSerialPort.on('error', (error) => {
      console.error('Serial port error:', error);
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('serial-error', error.message);
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error starting serial listening:', error);
    return { success: false, error: error.message };
  }
});

// Scan network for Ring devices
ipcMain.handle('scan-network-devices', async (event, manualSubnet = null) => {
  try {
    console.log('[Network Scanner] Starting network scan for Ring devices...');
    if (manualSubnet) {
      console.log(`[Network Scanner] Using manual subnet: ${manualSubnet}`);
    }
    
    // Get local network information
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    const subnets = new Set();
    
    // If manual subnet is provided, use it
    if (manualSubnet) {
      subnets.add(manualSubnet);
    } else {
      // Find all IPv4 network interfaces
      for (const [name, interfaces] of Object.entries(networkInterfaces)) {
        for (const iface of interfaces) {
          if (iface.family === 'IPv4' && !iface.internal) {
            const ipParts = iface.address.split('.');
            const subnet = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}`;
            
            // Skip VPN and virtual adapters (common patterns)
            if (name.toLowerCase().includes('vpn') || 
                name.toLowerCase().includes('virtual') ||
                name.toLowerCase().includes('vmware') ||
                name.toLowerCase().includes('vbox') ||
                name.toLowerCase().includes('docker') ||
                subnet.startsWith('10.') ||
                subnet.startsWith('172.')) {
              console.log(`[Network Scanner] Skipping interface ${name} (${iface.address})`);
              continue;
            }
            
            subnets.add(subnet);
            console.log(`[Network Scanner] Found interface ${name}: ${iface.address}`);
          }
        }
      }
      
      // Also specifically check for 192.168.x.x subnets which are common for home networks
      for (const [name, interfaces] of Object.entries(networkInterfaces)) {
        for (const iface of interfaces) {
          if (iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('192.168.')) {
            const ipParts = iface.address.split('.');
            const subnet = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}`;
            subnets.add(subnet);
            console.log(`[Network Scanner] Adding home network subnet: ${subnet}`);
          }
        }
      }
    }
    
    if (subnets.size === 0) {
      console.error('[Network Scanner] Could not determine any valid subnets');
      return [];
    }
    
    console.log(`[Network Scanner] Will scan ${subnets.size} subnet(s): ${Array.from(subnets).join(', ')}`);
    
    const allDevices = [];
    
    // Function to check if a host has "Ring" in its hostname
    const checkHost = (ip) => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(null);
        }, 1000); // 1 second timeout per host
        
        // Try to get hostname via reverse DNS lookup
        const dns = require('dns');
        dns.reverse(ip, (err, hostnames) => {
          clearTimeout(timeout);
          if (!err && hostnames && hostnames.length > 0) {
            const hostname = hostnames[0];
            console.log(`[Network Scanner] Resolved ${ip} to ${hostname}`);
            if (hostname.toLowerCase().includes('ring')) {
              console.log(`[Network Scanner] Found Ring device: ${hostname} (${ip})`);
              resolve({ ip, hostname });
            } else {
              resolve(null);
            }
          } else {
            // If reverse DNS fails, try to check if SSH port is open
            const net = require('net');
            const socket = new net.Socket();
            socket.setTimeout(500);
            
            socket.on('connect', () => {
              socket.destroy();
              // SSH port is open, check if it might be a Ring device
              console.log(`[Network Scanner] Found SSH-enabled device at ${ip}`);
              
              // Try a quick SSH command to identify if it's a Ring device
              const testCommand = `ssh -o ConnectTimeout=1 -o StrictHostKeyChecking=no -o PasswordAuthentication=no root@${ip} "hostname 2>/dev/null || echo unknown"`;
              
              exec(testCommand, { timeout: 2000 }, (error, stdout, stderr) => {
                if (!error && stdout) {
                  const hostname = stdout.trim();
                  if (hostname.toLowerCase().includes('ring') || ip.includes('.220')) {
                    console.log(`[Network Scanner] Identified Ring device via SSH: ${hostname} (${ip})`);
                    resolve({ ip, hostname: hostname !== 'unknown' ? hostname : `Ring Device (${ip})` });
                  } else {
                    resolve(null);
                  }
                } else {
                  // Include it as a potential device if SSH is open
                  resolve({ ip, hostname: `SSH Device (${ip})` });
                }
              });
            });
            
            socket.on('timeout', () => {
              socket.destroy();
              resolve(null);
            });
            
            socket.on('error', () => {
              resolve(null);
            });
            
            socket.connect(22, ip);
          }
        });
      });
    };
    
    // Scan all identified subnets
    for (const subnet of subnets) {
      console.log(`[Network Scanner] Scanning subnet: ${subnet}.0/24`);
      const scanPromises = [];
      
      // Scan the subnet (1-254)
      for (let i = 1; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        scanPromises.push(checkHost(ip));
      }
      
      // Wait for this subnet scan to complete
      const results = await Promise.all(scanPromises);
      const foundDevices = results.filter(device => device !== null);
      allDevices.push(...foundDevices);
      
      console.log(`[Network Scanner] Subnet ${subnet}.0/24 scan complete. Found ${foundDevices.length} devices`);
    }
    
    console.log(`[Network Scanner] Total scan complete. Found ${allDevices.length} devices`);
    
    return allDevices;
  } catch (error) {
    console.error('[Network Scanner] Error scanning network:', error);
    return [];
  }
});

// Test SSH connection to a specific IP
ipcMain.handle('test-ssh-connection', async (event, { ip, username = 'root' }) => {
  try {
    console.log(`[SSH Test] Testing connection to ${username}@${ip}...`);
    
    return new Promise((resolve) => {
      const testCommand = `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o PasswordAuthentication=no ${username}@${ip} "echo 'SSH_TEST_SUCCESS' && hostname"`;
      
      exec(testCommand, { timeout: 8000 }, (error, stdout, stderr) => {
        if (error) {
          console.log(`[SSH Test] Connection failed: ${error.message}`);
          if (error.message.includes('Permission denied')) {
            resolve({ success: false, error: 'SSH key authentication failed. Please ensure SSH keys are properly configured.' });
          } else if (error.message.includes('Connection refused')) {
            resolve({ success: false, error: 'SSH service not available on the device.' });
          } else {
            resolve({ success: false, error: error.message });
          }
        } else if (stdout.includes('SSH_TEST_SUCCESS')) {
          const hostname = stdout.split('\n')[1]?.trim() || 'Unknown';
          console.log(`[SSH Test] Connection successful to ${ip} (${hostname})`);
          resolve({ success: true, hostname });
        } else {
          console.log(`[SSH Test] Unexpected output: ${stdout}`);
          resolve({ success: false, error: 'Unexpected response from device' });
        }
      });
    });
  } catch (error) {
    console.error('[SSH Test] Error testing SSH connection:', error);
    return { success: false, error: error.message };
  }
});

// Open serial port
// ... existing code ...