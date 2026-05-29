import React, { createContext, useState, useContext, useCallback, useRef, useEffect, useMemo } from 'react';
import performanceMonitor from '../utils/performanceMonitor';

const CertificatesContext = createContext();

// Utility function to ensure unique IDs and normalize data
const normalizeData = (data) => {
  if (!Array.isArray(data)) return [];
  
  const seenIds = new Set();
  const normalizedData = [];
  
  data.forEach((item, index) => {
    let id = item.id;
    
    // If ID is a number or already exists, generate a stable unique ID based on certificate content
    if (typeof id === 'number' || seenIds.has(id) || !id) {
      // Create a stable ID based on certificate content instead of timestamp
      const certificateIdShort = item.certificateid ? item.certificateid.slice(0, 10) : 'unknown';
      const deviceIdShort = item.deviceid ? item.deviceid.slice(0, 8) : 'none';
      const pathHash = item.path ? item.path.split('/').pop().slice(0, 8) : 'nopath';
      id = `cert_${certificateIdShort}_${deviceIdShort}_${pathHash}_${index}`;
    }
    
    seenIds.add(id);
    normalizedData.push({
      ...item,
      id
    });
  });
  
  return normalizedData;
};

export const CertificatesProvider = ({ children }) => {
  const [certificatesData, setCertificatesData] = useState(null);
  const [certificateFolderPath, setCertificateFolderPath] = useState('');
  const [initialFilter, setInitialFilter] = useState(null);
  const [initialSelection, setInitialSelection] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const cacheRef = useRef({
    timestamp: 0,
    folderPath: '',
    data: null
  });
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // Auto-initialize when provider mounts (only once)
  useEffect(() => {
    if (!isInitialized) {
      console.log('[DEBUG CertificatesProvider] Auto-initializing on mount');
      initializeData();
    }
  }, [isInitialized]);

  // Function to reload filter from disk (for when user returns to page)
  const reloadFilter = useCallback(async () => {
    console.log('[DEBUG CertificatesProvider] Reloading filter from disk...');
    try {
      const savedFilter = await window.electronAPI.loadFilterModel();
      console.log('[DEBUG CertificatesProvider] Reloaded filter:', savedFilter ? JSON.stringify(savedFilter, null, 2) : 'null');
      
      // Use deep comparison for objects instead of reference comparison
      const savedFilterString = JSON.stringify(savedFilter);
      const currentFilterString = JSON.stringify(initialFilter);
      
      console.log('[DEBUG CertificatesProvider] Comparing filters:');
      console.log('[DEBUG CertificatesProvider] Current:', currentFilterString);
      console.log('[DEBUG CertificatesProvider] Saved:', savedFilterString);
      console.log('[DEBUG CertificatesProvider] Are equal?', savedFilterString === currentFilterString);
      
      if (savedFilterString !== currentFilterString) {
        console.log('[DEBUG CertificatesProvider] Filter changed, updating context');
        setInitialFilter(savedFilter);
      } else {
        console.log('[DEBUG CertificatesProvider] Filter unchanged');
        // Since we now use filterModel prop, no need to force update
        // The DataGrid will always show the current filter state
      }
    } catch (error) {
      console.error('[DEBUG CertificatesProvider] Error reloading filter:', error);
    }
  }, [initialFilter]);

  // Initialize data on first load
  const initializeData = useCallback(async () => {
    if (isLoading || isInitialized) {
      console.log('[DEBUG CertificatesProvider] Skipping initialization - already loading or initialized');
      return;
    }
    
    console.log('[DEBUG CertificatesProvider] Starting initialization...');
    setIsLoading(true);
    setError(null);

    try {
      // Load all initial data in parallel
      const [savedFilter, savedSelection, flashPathData, config] = await Promise.all([
        window.electronAPI.loadFilterModel().catch(() => null),
        window.electronAPI.loadSelectionModel().catch(() => null),
        window.electronAPI.getFlashPathData('nordic').catch(() => ({ certificate_folder_path: '' })),
        window.electronAPI.loadConfig().catch(() => ({ credentials: '' }))
      ]);

      console.log('[DEBUG CertificatesProvider] Loaded initial data:', {
        savedFilter: savedFilter ? 'exists' : 'null',
        savedFilterDetails: savedFilter ? JSON.stringify(savedFilter, null, 2) : 'null',
        savedSelection: savedSelection ? `${savedSelection.length} items` : 'null',
        selectedCertificatePath: flashPathData.certificate_folder_path,
        scanFolderPath: config.credentials
      });

      console.log('[DEBUG CertificatesProvider] Setting initial filter:', savedFilter);
      setInitialFilter(savedFilter);
      // Ensure selection model only contains at most one item for MUI X v8 compatibility
      const safeSelection = savedSelection && savedSelection.length > 0 ? [savedSelection[0]] : savedSelection;
      setInitialSelection(safeSelection);

      // certificateFolderPath is used for scanning - comes from config.credentials
      const scanPath = config.credentials || '';
      setCertificateFolderPath(scanPath);

      // Load certificates data if not cached or if folder path changed
      const now = Date.now();
      const isCacheValid = cacheRef.current.data && 
                          cacheRef.current.folderPath === scanPath &&
                          (now - cacheRef.current.timestamp) < CACHE_DURATION;

      if (!isCacheValid && scanPath) {
        await loadCertificatesData(scanPath);
      } else if (isCacheValid) {
        console.log('Using cached certificates data');
        setCertificatesData(cacheRef.current.data);
      }

      setIsInitialized(true);
      console.log('[DEBUG CertificatesProvider] Initialization complete');
    } catch (err) {
      console.error('Error initializing certificates data:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isInitialized]);

  // Load certificates data with caching
  const loadCertificatesData = useCallback(async (folderPath) => {
    return await performanceMonitor.measureAsync('loadCertificatesData', async () => {
      if (!folderPath) {
        setCertificatesData([]);
        return;
      }

      const now = Date.now();
      const isCacheValid = cacheRef.current.data && 
                          cacheRef.current.folderPath === folderPath &&
                          (now - cacheRef.current.timestamp) < CACHE_DURATION;

      if (isCacheValid) {
        console.log('Using cached certificates data');
        setCertificatesData(cacheRef.current.data);
        return cacheRef.current.data;
      }

      try {
        setIsLoading(true);
        
        // Removed the in-memory check to avoid dependency cycles
        
        // Try to load from saved data first
        let data = await performanceMonitor.measureAsync('loadUserData', () => 
          window.electronAPI.loadUserData()
        );
        
        // If no saved data, scan the folder
        if (data.length === 0) {
          data = await performanceMonitor.measureAsync('scanCertificates', () => 
            window.electronAPI.scanCertificates(folderPath)
          );
        }

        // Normalize data to ensure unique IDs
        const normalizedData = normalizeData(data);

        // Update cache
        cacheRef.current = {
          timestamp: now,
          folderPath,
          data: normalizedData
        };

        setCertificatesData(normalizedData);
        performanceMonitor.logMemoryUsage('After loading certificates');
        return normalizedData;
      } catch (err) {
        console.error('Error loading certificates data:', err);
        setError(err.message);
        return [];
      } finally {
        setIsLoading(false);
      }
    });
  }, []);

  // Refresh certificates data
  const refreshCertificatesData = useCallback(async () => {
    console.log('[DEBUG CertificatesContext] Starting manual refresh of certificates data');
    setIsLoading(true);
    setError(null);

    try {
      // Re-check config to get the latest scan folder path
      const config = await window.electronAPI.loadConfig().catch(() => ({ credentials: '' }));
      const scanPath = config.credentials;

      if (!scanPath) {
        console.log('[DEBUG CertificatesContext] No credentials path configured in config.json, cannot refresh');
        setError('No certificate folder path configured. Please set the path in Environment Settings.');
        return;
      }

      console.log('[DEBUG CertificatesContext] Refreshing with scan path:', scanPath);

      // Update the context scan path if it's different from config
      if (scanPath !== certificateFolderPath) {
        console.log('[DEBUG CertificatesContext] Updating context scan path from', certificateFolderPath, 'to', scanPath);
        setCertificateFolderPath(scanPath);
      }

      // Load existing saved user data to preserve remarks
      const savedUserData = await performanceMonitor.measureAsync('loadUserData', () => 
        window.electronAPI.loadUserData()
      );

      // Create a map of existing remarks by certificate ID
      const remarkMap = new Map();
      if (Array.isArray(savedUserData)) {
        savedUserData.forEach(item => {
          if (item.certificateid && item.remark) {
            remarkMap.set(item.certificateid, item.remark);
          }
        });
      }

      console.log('[DEBUG CertificatesContext] Found', remarkMap.size, 'existing remarks to preserve');

      // Force scan the folder directly to get latest certificates
      const scannedData = await performanceMonitor.measureAsync('scanCertificates', () => 
        window.electronAPI.scanCertificates(scanPath)
      );

      // Merge scanned data with existing remarks
      const mergedData = scannedData.map(cert => ({
        ...cert,
        remark: remarkMap.get(cert.certificateid) || cert.remark || ''
      }));

      // Normalize data to ensure unique IDs
      const normalizedData = normalizeData(mergedData);

      // Save the merged data to preserve remarks
      await window.electronAPI.saveUserData(normalizedData);

      // Update cache
      const now = Date.now();
      cacheRef.current = {
        timestamp: now,
        folderPath: scanPath,
        data: normalizedData
      };

      setCertificatesData(normalizedData);
      console.log('[DEBUG CertificatesContext] Manual refresh complete, found', normalizedData.length, 'certificates with preserved remarks');
      performanceMonitor.logMemoryUsage('After refreshing certificates');
    } catch (err) {
      console.error('Error refreshing certificates data:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [certificateFolderPath]);

  // Set certificate folder path without reloading (to preserve edits)
  const setCertificateFolderPathOnly = useCallback(async (newPath) => {
    console.log('[DEBUG CertificatesContext] setCertificateFolderPathOnly called with:', newPath);
    
    // Don't update if the new path is the same as current path
    if (newPath === certificateFolderPath) {
      console.log('[DEBUG CertificatesContext] Path unchanged, skipping update');
      return;
    }
    
    // Only update if the new path is a valid non-empty string
    // This prevents accidental clearing of the path
    if (newPath && newPath.trim() !== '') {
              try {
          const result = await window.electronAPI.updateFlashPathData({ 
            path_type: 'nordic',
            certificate_folder_path: newPath,
            user_initiated: true  // Flag to indicate this is a user action
          });
          
          // Only update frontend state if backend accepted the change
          if (result && result.success) {
            setCertificateFolderPath(newPath);
            console.log('[DEBUG CertificatesContext] Certificate folder path updated to:', newPath);
          } else {
            console.log('[DEBUG CertificatesContext] Backend rejected certificate_folder_path update, syncing current value from backend');
            // Re-sync the current value from backend to ensure consistency
            try {
              const flashPathData = await window.electronAPI.getFlashPathData('nordic');
              setCertificateFolderPath(flashPathData.certificate_folder_path || '');
            } catch (syncErr) {
              console.error('Error syncing certificate_folder_path from backend:', syncErr);
            }
          }
        } catch (err) {
          console.error('Error updating certificate folder path:', err);
          setError(err.message);
        }
    } else {
      console.log('[DEBUG CertificatesContext] Ignoring empty path update to prevent data loss');
    }
  }, [certificateFolderPath]);

  // Update certificate folder path (for selected certificate - used by flashing pages)
  const updateCertificateFolderPath = useCallback(async (newPath) => {
    // This function updates the selected certificate path in flash_path_data
    // It does NOT change the scan folder path (which comes from config.credentials)
    try {
      await window.electronAPI.updateFlashPathData({ 
        path_type: 'nordic',
        certificate_folder_path: newPath,
        user_initiated: true  // Flag to indicate this is a user action
      });
      console.log('[DEBUG CertificatesContext] Updated selected certificate path in flash_path_data:', newPath);
    } catch (err) {
      console.error('Error updating certificate folder path:', err);
      setError(err.message);
    }
  }, []);

  // Update certificates data (for edits)
  const updateCertificatesData = useCallback(async (newData) => {
    try {
      // Normalize the new data to ensure unique IDs
      const normalizedData = normalizeData(newData);
      
      const result = await window.electronAPI.saveUserData(normalizedData);
      
      if (result && result.success) {
        setCertificatesData(normalizedData);
        // Update cache
        cacheRef.current = {
          ...cacheRef.current,
          data: normalizedData,
          timestamp: Date.now()
        };
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error updating certificates data:', err);
      setError(err.message);
      return false;
    }
  }, []);

  // Effect to handle side-effects of selection changes.
  // This is the canonical way to handle side-effects from state updates.
  useEffect(() => {
    console.log('[DEBUG CertificatesContext] Selection effect triggered:', {
      initialSelection: initialSelection ? `${initialSelection.length} items` : 'null',
      certificatesData: certificatesData ? `${certificatesData.length} items` : 'null',
      certificateFolderPath,
      userDeselect: window._lastSelectionWasUserDeselect
    });

    const handleSelectionSideEffects = async () => {
      // Avoid running on initial mount before data is ready
      if (initialSelection === null || certificatesData === null) {
        console.log('[DEBUG CertificatesContext] Skipping - data not ready');
        return;
      }

      let flashPathDataUpdated = false;

      // When user selects a certificate, save the certificate path to flash_path_data
      if (initialSelection.length > 0) {
        const selectedCertificate = certificatesData.find(cert => cert.id === initialSelection[0]);
        if (selectedCertificate && selectedCertificate.path) {
          console.log('[DEBUG CertificatesContext] User selected certificate:', selectedCertificate.certificateid, 'path:', selectedCertificate.path);
          // Save selected certificate path to flash_path_data for Nordic/Silabs flashing
          try {
            await window.electronAPI.updateFlashPathData({ 
              path_type: 'nordic',
              certificate_folder_path: selectedCertificate.path,
              user_initiated: true
            });
            console.log('[DEBUG CertificatesContext] Updated flash_path_data with selected certificate path:', selectedCertificate.path);
            flashPathDataUpdated = true;
          } catch (err) {
            console.error('Error updating flash_path_data with selected certificate path:', err);
          }
        }
      } else if (window._lastSelectionWasUserDeselect) {
        // User actively deselected - clear the certificate folder path
        console.log('[DEBUG CertificatesContext] User actively deselected, clearing certificate_folder_path');
        try {
          const result = await window.electronAPI.updateFlashPathData({ 
            path_type: 'nordic',
            certificate_folder_path: '',
            user_initiated: true  // Flag to indicate this is a user action
          });
          
          // Only update frontend state if backend accepted the change
          if (result && result.success) {
            setCertificateFolderPath('');
            console.log('[DEBUG CertificatesContext] Certificate folder path successfully cleared');
            flashPathDataUpdated = true;
          } else {
            console.log('[DEBUG CertificatesContext] Backend rejected certificate_folder_path clearing, syncing current value from backend');
            // Re-sync the current value from backend to ensure consistency
            try {
              const flashPathData = await window.electronAPI.getFlashPathData('nordic');
              setCertificateFolderPath(flashPathData.certificate_folder_path || '');
            } catch (syncErr) {
              console.error('Error syncing certificate_folder_path from backend:', syncErr);
            }
          }
        } catch (err) {
          console.error('Error clearing certificate folder path:', err);
        }
        // Reset the flag
        window._lastSelectionWasUserDeselect = false;
      }
      // Note: When selection is cleared due to page switches, we preserve the certificate_folder_path
      
      // Always save the selection model, ensuring it contains at most one item
      const safeSelection = initialSelection && initialSelection.length > 0 ? [initialSelection[0]] : [];
      await window.electronAPI.saveSelectionModel(safeSelection);
      
      // Emit certificate selection change event for other components
      // Only emit if flash path data was actually updated to avoid unnecessary events
      if (typeof window !== 'undefined') {
        const event = new CustomEvent('certificateSelectionChanged', {
          detail: { 
            selection: initialSelection,
            flashPathDataUpdated: flashPathDataUpdated
          }
        });
        window.dispatchEvent(event);
        console.log('[DEBUG CertificatesContext] Dispatched certificateSelectionChanged event, flashPathDataUpdated:', flashPathDataUpdated);
      }
    };

    // Use setTimeout to defer the side effects to avoid setState during render warnings
    const timeoutId = setTimeout(() => {
      handleSelectionSideEffects();
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [initialSelection, certificatesData]);

  // Note: Removed automatic cache clearing when folder path changes
  // This was causing user edits to be lost when setting certificate paths
  // Cache clearing is now only done explicitly in refreshCertificatesData

  const value = useMemo(() => ({
    certificatesData,
    certificateFolderPath,
    initialFilter,
    initialSelection,
    isLoading,
    error,
    isInitialized,
    initializeData,
    loadCertificatesData,
    refreshCertificatesData,
    updateCertificateFolderPath,
    updateCertificatesData,
    setInitialFilter,
    setInitialSelection,
    setCertificateFolderPathOnly,
    reloadFilter
  }), [
    certificatesData,
    certificateFolderPath,
    initialFilter,
    initialSelection,
    isLoading,
    error,
    isInitialized,
    initializeData,
    loadCertificatesData,
    refreshCertificatesData,
    updateCertificateFolderPath,
    updateCertificatesData,
    setInitialFilter,
    setInitialSelection,
    setCertificateFolderPathOnly,
    reloadFilter
  ]);

  return (
    <CertificatesContext.Provider value={value}>
      {children}
    </CertificatesContext.Provider>
  );
};

export const useCertificates = () => {
  const context = useContext(CertificatesContext);
  if (!context) {
    throw new Error('useCertificates must be used within a CertificatesProvider');
  }
  return context;
}; 