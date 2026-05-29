import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { 
  Box, 
  Typography, 
  Checkbox, 
  Button, 
  Stack, 
  Paper,
  Chip,
  Card,
  CardContent,
  LinearProgress,
  IconButton,
  Tooltip
} from '@mui/material';
import { styled } from '@mui/system';
import StopIcon from '@mui/icons-material/Stop';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import SecurityIcon from '@mui/icons-material/Security';
import SettingsIcon from '@mui/icons-material/Settings';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SaveIcon from '@mui/icons-material/Save';
import UsbIcon from '@mui/icons-material/Usb';
import { useFlashing } from '../contexts/FlashingContext';

const StyledPre = styled('pre')({
  margin: 0,
  fontFamily: '"Fira Code", "Consolas", "Monaco", monospace',
  whiteSpace: 'pre-wrap',
  wordWrap: 'break-word',
  fontSize: '13px',
  lineHeight: '1.4',
});

const ConsoleContainer = styled(Paper)(({ theme }) => ({
  backgroundColor: '#1e1e1e',
  border: '1px solid #333',
  borderRadius: '8px',
  overflow: 'hidden',
  position: 'relative',
}));

const ConsoleHeader = styled(Box)(({ theme }) => ({
  backgroundColor: '#2d2d2d',
  padding: '8px 16px',
  borderBottom: '1px solid #333',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
}));

const PathCard = styled(Card)(({ theme }) => ({
  marginBottom: '12px',
  backgroundColor: '#2a2a2a',
  border: '1px solid #404040',
  '&:hover': {
    borderColor: '#555',
  },
}));

const StatusChip = styled(Chip)(({ theme, status }) => ({
  fontWeight: 'bold',
  ...(status === 'ready' && {
    backgroundColor: '#4caf50',
    color: 'white',
  }),
  ...(status === 'missing' && {
    backgroundColor: '#f44336',
    color: 'white',
  }),
  ...(status === 'processing' && {
    backgroundColor: '#ff9800',
    color: 'white',
  }),
}));

function NordicFlashPage() {
  const [softDevicePath, setSoftDevicePath] = useState('');
  const [testAppPath, setTestAppPath] = useState('');
  const [certificatesPath, setCertificatesPath] = useState({ full: '', trimmed: '' });
  const [certificateDisplayText, setCertificateDisplayText] = useState('');
  const [customHexPath, setCustomHexPath] = useState('');
  const [consoleOutput, setConsoleOutput] = useState('');
  const [recoverChecked, setRecoverChecked] = useState(true);
  const [resetChecked, setResetChecked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isTesting, setIsTesting] = useState(false);
  const { isFlashing, setIsFlashing } = useFlashing();
  const isMountedRef = useRef(true);
  const shouldAutoScrollRef = useRef(true);
  const maxLogLength = 20000;
  const consoleRef = useRef(null);
  const componentRef = useRef(null);
  const lastLoadTimeRef = useRef(0);
  const certificateCacheRef = useRef(new Map()); // Cache for certificate search results
  const lastCertificateIdRef = useRef(''); // Track certificate ID changes

  useEffect(() => {
    console.log('[DEBUG Nordic] Component mounted, isMountedRef.current:', isMountedRef.current);
    isMountedRef.current = true; // Ensure it's true on mount
    
    // Safe wrapper to check if component is still mounted before executing functions
    const safeExecute = (fn) => {
      return (...args) => {
        if (isMountedRef.current) {
          return fn(...args);
        }
      };
    };

    loadFlashPathData();
    
    // Add visibility change listener to reload data when page becomes visible
    const handleVisibilityChange = safeExecute(() => {
      if (!document.hidden) {
        console.log('[DEBUG Nordic] Page became visible, reloading flash path data...');
        loadFlashPathData();
      }
    });
    
    // Add focus event listener to reload data when window gains focus
    const handleWindowFocus = safeExecute(() => {
      console.log('[DEBUG Nordic] Window gained focus, reloading flash path data...');
      loadFlashPathData();
    });
    
    // Add custom tab change event listener
    const handleTabChange = safeExecute((event) => {
      const { newValue } = event.detail;
      console.log('[DEBUG Nordic] Tab change event received, newValue:', newValue);
      
      // Check if this component is currently visible by examining the DOM
      setTimeout(() => {
        if (isMountedRef.current) {
          const nordicTabPanel = componentRef.current?.closest('[role="tabpanel"]');
          if (nordicTabPanel && nordicTabPanel.style.display !== 'none') {
            console.log('[DEBUG Nordic] Nordic tab is now active, reloading flash path data...');
            loadFlashPathData(true);
          }
        }
      }, 150); // Small delay to ensure tab switch is complete
    });
    
    // Add certificate selection change listener
    const handleCertificateSelectionChange = safeExecute(() => {
      console.log('[DEBUG Nordic] Certificate selection changed, reloading flash path data...');
      loadFlashPathData(true);
    });
    
    // Only add event listeners if we have the required objects
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleWindowFocus);
      window.addEventListener('tabChanged', handleTabChange);
      window.addEventListener('certificateSelectionChanged', handleCertificateSelectionChange);
    }
    
    return () => {
      console.log('[DEBUG Nordic] Component cleanup triggered');
      isMountedRef.current = false;
      
      // Safe cleanup of event listeners
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleWindowFocus);
        window.removeEventListener('tabChanged', handleTabChange);
        window.removeEventListener('certificateSelectionChanged', handleCertificateSelectionChange);
        
        // Safe cleanup of command if still running
        if (isFlashing && window.electronAPI?.stopCommand) {
          console.log('Stopping command due to component unmount');
          window.electronAPI.stopCommand().catch(console.error);
        }
      }
    };
  }, []);

  // Add an effect to monitor when the component becomes visible within its TabPanel
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0) {
            console.log('[DEBUG Nordic] Component became visible via intersection observer, reloading flash path data...');
            loadFlashPathData(true); // Force reload when becoming visible
          }
        });
      },
      { threshold: 0.1 }
    );

    // Observe the component's own root element
    if (componentRef.current) {
      observer.observe(componentRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  // Add an effect to periodically check for data updates when component is visible
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Only check if the component is visible and not during flashing
      // Also check if we actually need to scan (avoid unnecessary scans)
      if (isMountedRef.current && typeof document !== 'undefined' && !document.hidden && !isFlashing) {
        // Only do periodic check, don't force reload unless really needed
        const now = Date.now();
        if (now - lastLoadTimeRef.current > 10000) { // Only if last check was more than 10 seconds ago
          console.log('[DEBUG Nordic] Periodic data sync check...');
          loadFlashPathData();
        }
      }
    }, 10000); // Check every 10 seconds instead of 5

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isFlashing]);

  // Use useLayoutEffect for immediate scrolling after DOM updates
  useLayoutEffect(() => {
    if ((isFlashing || shouldAutoScrollRef.current) && consoleOutput && consoleRef.current) {
      const scrollToBottom = () => {
        if (consoleRef.current) {
          const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
          const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
          
          // Always scroll to bottom during flashing process
          if (isFlashing || shouldAutoScrollRef.current) {
            const oldScrollTop = consoleRef.current.scrollTop;
            consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
            console.log('[SCROLL] Scrolled from', oldScrollTop, 'to', consoleRef.current.scrollTop, 'height:', scrollHeight);
          }
        }
      };
      
      // Immediate scroll
      scrollToBottom();
      
      // Additional attempts to ensure scrolling works
      const timeoutId = setTimeout(() => {
        if (isMountedRef.current) scrollToBottom();
      }, 10);
      const timeoutId2 = setTimeout(() => {
        if (isMountedRef.current) scrollToBottom();
      }, 50);
      
      return () => {
        clearTimeout(timeoutId);
        clearTimeout(timeoutId2);
      };
    }
  }, [consoleOutput, isFlashing]);

  // Backup scroll effect with longer delay
  useEffect(() => {
    if ((isFlashing || shouldAutoScrollRef.current) && consoleOutput && consoleRef.current) {
      const timeoutId = setTimeout(() => {
        if (isMountedRef.current && consoleRef.current && (isFlashing || shouldAutoScrollRef.current)) {
          consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
          console.log('[SCROLL] Backup scroll executed');
        }
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [consoleOutput, isFlashing]);

  const loadFlashPathData = async (forceReload = false) => {
    // Check if component is still mounted
    if (!isMountedRef.current) {
      console.log('[DEBUG Nordic] Component not mounted, skipping loadFlashPathData');
      return;
    }

    // Check if electronAPI is available
    if (!window?.electronAPI?.getFlashPathData) {
      console.log('[DEBUG Nordic] electronAPI not available, skipping loadFlashPathData');
      return;
    }

    // Debounce: prevent too frequent reloads
    const now = Date.now();
    if (!forceReload && now - lastLoadTimeRef.current < 1000) {
      console.log('[DEBUG Nordic] Skipping reload due to debounce (too recent)');
      return;
    }
    lastLoadTimeRef.current = now;

    console.log('[DEBUG Nordic] Loading flash path data...', { forceReload, timestamp: new Date().toLocaleTimeString() });
    try {
      const data = await window.electronAPI.getFlashPathData('nordic');
      console.log('[DEBUG Nordic] Received flash path data:', {
        certificate_folder_path: data.certificate_folder_path,
        current_used_paths: data.current_used_paths,
        saved_paths_count: data.saved_paths?.length || 0
      });
      
      const newSoftDevicePath = {
        full: data.current_used_paths?.softDevicePath || '',
        trimmed: trimPath(data.current_used_paths?.softDevicePath || '', 'sid_sdk')
      };
      
      const newTestAppPath = {
        full: data.current_used_paths?.testAppPath || '',
        trimmed: trimPath(data.current_used_paths?.testAppPath || '', 'sid_test')
      };
      
      // Check if we need to reload certificate data
      const selectedCertificate = await window.electronAPI.getSelectedCertificate();
      const currentCertificateId = selectedCertificate?.certificateid || '';
      const certificateFolderPath = data.certificate_folder_path || '';
      const needsCertificateRescan = forceReload || 
                                     currentCertificateId !== lastCertificateIdRef.current ||
                                     !certificateCacheRef.current.has(`${certificateFolderPath}:${currentCertificateId}`);
      
      let hexFile = '';
      if (needsCertificateRescan) {
        console.log('[DEBUG Nordic] Certificate rescan needed:', { 
          forceReload, 
          certificateChanged: currentCertificateId !== lastCertificateIdRef.current,
          currentId: currentCertificateId,
          lastId: lastCertificateIdRef.current 
        });
        
        hexFile = await findSelectedCertificateHexFile(certificateFolderPath);
        
        // Cache the result
        if (currentCertificateId) {
          certificateCacheRef.current.set(`${certificateFolderPath}:${currentCertificateId}`, hexFile);
          lastCertificateIdRef.current = currentCertificateId;
        }
      } else {
        // Use cached result
        hexFile = certificateCacheRef.current.get(`${certificateFolderPath}:${currentCertificateId}`) || '';
        console.log('[DEBUG Nordic] Using cached certificate path:', hexFile);
      }
      
      const newCertificatesPath = {
        full: hexFile,
        trimmed: trimCertificatePath(hexFile)
      };

      // Only update state if there are actual changes
      if (newSoftDevicePath.full !== softDevicePath.full) {
        console.log('[DEBUG Nordic] SoftDevice path changed:', newSoftDevicePath.full);
        setSoftDevicePath(newSoftDevicePath);
      }
      
      if (newTestAppPath.full !== testAppPath.full) {
        console.log('[DEBUG Nordic] TestApp path changed:', newTestAppPath.full);
        setTestAppPath(newTestAppPath);
      }
      
      if (newCertificatesPath.full !== certificatesPath.full) {
        console.log('[DEBUG Nordic] Certificates path changed:', newCertificatesPath.full);
        setCertificatesPath(newCertificatesPath);
        
        // Update display text
        getCertificateDisplayText().then(displayText => {
          setCertificateDisplayText(displayText);
        });
      }
      
      console.log('[DEBUG Nordic] State sync completed with paths:', {
        softDevice: newSoftDevicePath.full,
        testApp: newTestAppPath.full,
        certificates: newCertificatesPath.full
      });
      
    } catch (error) {
      console.error('[DEBUG Nordic] Error loading flash path data:', error);
    }
  };

  const trimPath = (fullPath, startSubstring) => {
    const index = fullPath.indexOf(startSubstring);
    if (index !== -1) {
      return fullPath.substring(index);
    }
    return fullPath;
  };

  const trimCertificatePath = (fullPath) => {
    if (!fullPath) return '';
    
    // Look for "certificate_" pattern to start trimming from there
    const index = fullPath.indexOf('certificate_');
    if (index !== -1) {
      return fullPath.substring(index);
    }
    
    // If no certificate_ pattern found, show just the filename
    const lastSlash = fullPath.lastIndexOf('/');
    const lastBackslash = fullPath.lastIndexOf('\\');
    const lastSeparator = Math.max(lastSlash, lastBackslash);
    
    if (lastSeparator !== -1) {
      return fullPath.substring(lastSeparator + 1);
    }
    
    return fullPath;
  };

  // Helper function to get display text for certificate path
  const getCertificateDisplayText = async () => {
    if (!isMountedRef.current || !window?.electronAPI?.getSelectedCertificate) {
      return certificatesPath.trimmed || 'No certificate selected';
    }

    try {
      const selectedCertificate = await window.electronAPI.getSelectedCertificate();
      if (selectedCertificate) {
        const pathDisplay = certificatesPath.trimmed || 'No matching .hex file';
        return `${selectedCertificate.certificateid} → ${pathDisplay}`;
      } else {
        return certificatesPath.trimmed || 'No certificate selected';
      }
    } catch (error) {
      console.error('[DEBUG Nordic] Error getting certificate display text:', error);
      return certificatesPath.trimmed || 'Error loading certificate info';
    }
  };

  // Update certificate display text whenever certificate paths change
  useEffect(() => {
    if (certificatesPath.full) {
      getCertificateDisplayText().then(displayText => {
        setCertificateDisplayText(displayText);
      });
    } else {
      setCertificateDisplayText('No certificate selected');
    }
  }, [certificatesPath]);

  // Clear custom hex when a certificate hex becomes available
  useEffect(() => {
    if (certificatesPath.full && customHexPath) {
      setCustomHexPath('');
    }
  }, [certificatesPath.full]);

  // Helper function to recursively search for certificate files
  const searchCertificateRecursively = async (basePath, certificateId, depth = 0, maxDepth = 3) => {
    if (depth > maxDepth) return '';
    
    try {
      const items = await window.electronAPI.readDirectory(basePath);
      if (!Array.isArray(items) || items.length === 0) return '';
      
      console.log(`[DEBUG Nordic] Searching at depth ${depth}, path: ${basePath}`);
      console.log(`[DEBUG Nordic] Found ${items.length} items:`, items);
      
      // First, look for certificate folders in current directory
      for (const item of items) {
        // Skip files (look for directories only) but be more permissive
        if (item.includes('.') && !item.endsWith('.zip')) continue; // Allow .zip folders but skip other files
        if (item.startsWith('.')) continue; // Skip hidden items
        
        console.log(`[DEBUG Nordic] Checking item: ${item}`);
        
        // Check if this folder matches the certificate ID pattern (more flexible patterns)
        const isMatch = 
          new RegExp(`^certificate_${certificateId}_`, 'i').test(item) || // case insensitive
          item === certificateId ||
          item.includes(certificateId) || // More flexible matching
          new RegExp(`_${certificateId}_`, 'i').test(item); // ID in middle of name
          
        console.log(`[DEBUG Nordic] Pattern match for ${item}: ${isMatch}`);
        
        if (isMatch) {
          console.log(`[DEBUG Nordic] Found potential certificate folder: ${item}`);
          const certificateFolderPath = `${basePath}/${item}`;
          
          try {
            const certificateFiles = await window.electronAPI.readDirectory(certificateFolderPath);
            if (Array.isArray(certificateFiles) && certificateFiles.length > 0) {
              console.log(`[DEBUG Nordic] Files in certificate folder ${item}:`, certificateFiles);
              
              // Look for nordic-specific .hex files
              const hexFile = certificateFiles.find(file => 
                // Match patterns like: BFFFFFFA15.hex, certificate_BFFFFFFA15_nordic.hex, *_FD000.hex
                new RegExp(`^${certificateId}\\.hex$`).test(file) || 
                new RegExp(`^certificate_${certificateId}_nordic(\\_FD000)?\\.hex$`).test(file) ||
                file.endsWith('_FD000.hex') ||
                (file.endsWith('.hex') && file.includes('nordic')) ||
                (file.endsWith('.hex') && file.includes(certificateId)) // More flexible hex file matching
              );
              
              if (hexFile) {
                const fullHexPath = `${certificateFolderPath}/${hexFile}`;
                console.log('[DEBUG Nordic] Found matching hex file:', fullHexPath);
                return fullHexPath;
              } else {
                // Try to find any .hex file in the certificate folder
                const anyHexFile = certificateFiles.find(file => file.endsWith('.hex'));
                if (anyHexFile) {
                  const fullHexPath = `${certificateFolderPath}/${anyHexFile}`;
                  console.log('[DEBUG Nordic] Found fallback hex file:', fullHexPath);
                  return fullHexPath;
                }
              }
            }
          } catch (error) {
            console.error(`[DEBUG Nordic] Error reading certificate folder ${item}:`, error);
          }
        }
      }
      
      // If not found in current level, recursively search subdirectories
      console.log(`[DEBUG Nordic] No direct match found at depth ${depth}, searching subdirectories...`);
      for (const item of items) {
        // Skip files and hidden directories, but be less restrictive
        if (item.includes('.') && !item.endsWith('.zip')) continue;
        if (item.startsWith('.')) continue;
        
        console.log(`[DEBUG Nordic] Recursing into subdirectory: ${item}`);
        const subPath = `${basePath}/${item}`;
        const result = await searchCertificateRecursively(subPath, certificateId, depth + 1, maxDepth);
        if (result) return result;
      }
      
      return '';
    } catch (error) {
      console.error(`[DEBUG Nordic] Error searching directory ${basePath}:`, error);
      return '';
    }
  };

  const findSelectedCertificateHexFile = async (folderPath) => {
    if (!folderPath || !isMountedRef.current) return '';
    
    // Check if electronAPI is available
    if (!window?.electronAPI?.getSelectedCertificate) {
      console.log('[DEBUG Nordic] electronAPI not available for certificate search');
      return '';
    }
    
    try {
      // Get the selected certificate from selection model
      const selectedCertificate = await window.electronAPI.getSelectedCertificate();
      
      if (selectedCertificate) {
        const certificateId = selectedCertificate.certificateid;
        console.log('[DEBUG Nordic] Found selected certificate:', certificateId);
        console.log('[DEBUG Nordic] Starting recursive search for certificate folder...');
        
        // Use recursive search to find the certificate
        const result = await searchCertificateRecursively(folderPath, certificateId);
        
        if (result) {
          console.log('[DEBUG Nordic] Successfully found certificate file:', result);
          return result;
        } else {
          console.log('[DEBUG Nordic] No matching certificate file found after recursive search');
          
          // Final fallback: look for any .hex file with the certificate ID in the name
          const topLevelFiles = await window.electronAPI.readDirectory(folderPath);
          if (Array.isArray(topLevelFiles)) {
            const hexFile = topLevelFiles.find(file => 
              new RegExp(`^${certificateId}\\.hex$`).test(file) || 
              new RegExp(`^certificate_${certificateId}_nordic(\\_FD000)?\\.hex$`).test(file)
            );
            
            if (hexFile) {
              console.log('[DEBUG Nordic] Found hex file in main folder:', hexFile);
              return `${folderPath}/${hexFile}`;
            }
          }
        }
      } else {
        console.log('[DEBUG Nordic] No certificate selected, scanning for any nordic hex file');
        
        // No certificate selected, try to find any nordic hex file
        const files = await window.electronAPI.readDirectory(folderPath);
        
        if (!Array.isArray(files)) {
          console.error('readDirectory did not return an array:', files);
          return '';
        }
        
        // Look for .hex files in top level first
        let hexFile = files.find(file => 
          /^[A-Z0-9]{10}\.hex$/.test(file) || 
          /^certificate_[A-Z0-9]{10}_nordic(\_FD000)?\.hex$/.test(file)
        );
        
        if (hexFile) {
          return `${folderPath}/${hexFile}`;
        }
        
        // If no hex files in top level, look in first certificate folder
        const certificateFolder = files.find(item => item.startsWith('certificate_'));
        if (certificateFolder) {
          try {
            const certificateFiles = await window.electronAPI.readDirectory(`${folderPath}/${certificateFolder}`);
            if (Array.isArray(certificateFiles)) {
              hexFile = certificateFiles.find(file => file.endsWith('.hex'));
              if (hexFile) {
                return `${folderPath}/${certificateFolder}/${hexFile}`;
              }
            }
          } catch (error) {
            console.error('[DEBUG Nordic] Error reading first certificate folder:', error);
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error('Error in findSelectedCertificateHexFile:', error);
      return '';
    }
  };

  const updateConsoleOutput = (data) => {
    if (!isMountedRef.current) {
      console.log('[DEBUG] Component not mounted, skipping update');
      return;
    }
    
    setConsoleOutput(prev => {
      let processedData = '';
      
      // Handle different data types
      if (typeof data === 'string') {
        processedData = data;
      } else if (data && typeof data === 'object') {
        // If it's an object, try to extract useful information
        if (data.stdout) {
          processedData = data.stdout;
        } else if (data.stderr) {
          processedData = `<span style="color: #f44336;">${data.stderr}</span>`;
        } else if (data.message) {
          processedData = data.message;
        } else {
          processedData = JSON.stringify(data);
        }
      } else {
        processedData = String(data);
      }
      
      // Ensure the data ends with a newline for better formatting
      if (processedData && !processedData.endsWith('\n')) {
        processedData += '\n';
      }
      
      const newOutput = prev + processedData;
      const truncatedOutput = newOutput.slice(-maxLogLength);
      
              // console.log('[DEBUG] Console output updated. Prev length:', prev.length, 'New data length:', processedData.length, 'Final length:', truncatedOutput.length);
      
              // Don't scroll here - let useLayoutEffect handle it after DOM update
      
      return truncatedOutput;
    });
  };

  const getPathStatus = (path) => {
    if (!path || (typeof path === 'object' && !path.full)) return 'missing';
    return 'ready';
  };

  const checkDeviceConnection = async () => {
    setIsTesting(true);
    shouldAutoScrollRef.current = true; // Enable auto-scroll during testing
    
    updateConsoleOutput(`<span style="color: #2196f3; font-weight: bold;">═══════════════════════════════════════</span>\n`);
    updateConsoleOutput(`<span style="color: #2196f3; font-weight: bold;">🔍 DEVICE CONNECTION TEST STARTED</span>\n`);
    updateConsoleOutput(`<span style="color: #2196f3; font-weight: bold;">═══════════════════════════════════════</span>\n`);
    updateConsoleOutput(`<span style="color: #fff;">📋 Running diagnostic checks...</span>\n\n`);
    
    // Step 1: Check nrfjprog installation
    updateConsoleOutput(`<span style="color: #ffeb3b; font-weight: bold;">Step 1/4: Verifying nrfjprog installation</span>\n`);
    try {
      await runCommand('nrfjprog --version');
      updateConsoleOutput(`<span style="color: #4caf50;">   ✅ nrfjprog is installed and accessible</span>\n\n`);
    } catch (error) {
      updateConsoleOutput(`<span style="color: #f44336;">   ❌ nrfjprog not found or not accessible</span>\n`);
      updateConsoleOutput(`<span style="color: #ff9800;">   💡 Please install nRF Command Line Tools</span>\n\n`);
      return false;
    }
    
    // Step 2: List available programmers
    updateConsoleOutput(`<span style="color: #ffeb3b; font-weight: bold;">Step 2/4: Scanning for nRF programmers</span>\n`);
    try {
      await runCommand('nrfjprog --ids');
      updateConsoleOutput(`<span style="color: #4caf50;">   ✅ nRF programmer(s) detected successfully</span>\n\n`);
    } catch (error) {
      updateConsoleOutput(`<span style="color: #f44336;">   ❌ No nRF programmers found</span>\n`);
      updateConsoleOutput(`<span style="color: #ff9800;">   💡 This indicates device connection issues</span>\n\n`);
      
      // Continue with additional diagnostics even if no device found
    }
    
    // Step 3: Check system USB devices (informational)
    updateConsoleOutput(`<span style="color: #ffeb3b; font-weight: bold;">Step 3/4: System USB diagnostics</span>\n`);
    try {
      if (process.platform === 'darwin') {
        // macOS
        await runCommand('system_profiler SPUSBDataType | grep -A 5 -B 5 -i "nordic\\|segger\\|jlink"');
        updateConsoleOutput(`<span style="color: #4caf50;">   ✅ USB device information retrieved</span>\n\n`);
      } else if (process.platform === 'linux') {
        // Linux
        await runCommand('lsusb | grep -i "nordic\\|segger"');
        updateConsoleOutput(`<span style="color: #4caf50;">   ✅ USB device scan completed</span>\n\n`);
      } else {
        // Windows or other
        updateConsoleOutput(`<span style="color: #ffeb3b;">   ℹ️  Manual USB check recommended (Device Manager)</span>\n\n`);
      }
    } catch (error) {
      updateConsoleOutput(`<span style="color: #ff9800;">   ⚠️  No Nordic/Segger USB devices detected</span>\n\n`);
    }
    
    // Step 4: Test device communication
    updateConsoleOutput(`<span style="color: #ffeb3b; font-weight: bold;">Step 4/4: Testing device communication</span>\n`);
    try {
      await runCommand('nrfjprog --pinreset');
      updateConsoleOutput(`<span style="color: #4caf50;">   ✅ Device communication successful</span>\n`);
      updateConsoleOutput(`<span style="color: #4caf50;">   ✅ Device is ready for flashing operations</span>\n\n`);
      
      // Final success summary
      updateConsoleOutput(`<span style="color: #4caf50; font-weight: bold;">═══════════════════════════════════════</span>\n`);
      updateConsoleOutput(`<span style="color: #4caf50; font-weight: bold;">🎉 DEVICE CONNECTION TEST PASSED</span>\n`);
      updateConsoleOutput(`<span style="color: #4caf50; font-weight: bold;">═══════════════════════════════════════</span>\n`);
             updateConsoleOutput(`<span style="color: #4caf50;">Your nRF device is properly connected and ready!</span>\n`);
      updateConsoleOutput(`<span style="color: #fff;">You can now proceed with the flashing operation.</span>\n\n`);
      
      setIsTesting(false);
      setTimeout(() => { shouldAutoScrollRef.current = false; }, 1000);
      return true;
    } catch (error) {
      updateConsoleOutput(`<span style="color: #f44336;">   ❌ Device communication failed</span>\n\n`);
      
      // Final failure summary with troubleshooting
      updateConsoleOutput(`<span style="color: #f44336; font-weight: bold;">═══════════════════════════════════════</span>\n`);
      updateConsoleOutput(`<span style="color: #f44336; font-weight: bold;">❌ DEVICE CONNECTION TEST FAILED</span>\n`);
      updateConsoleOutput(`<span style="color: #f44336; font-weight: bold;">═══════════════════════════════════════</span>\n`);
      
      updateConsoleOutput(`<span style="color: #ff9800; font-weight: bold;">🔧 TROUBLESHOOTING GUIDE:</span>\n`);
      updateConsoleOutput(`<span style="color: #ffeb3b;">1. Physical Connection:</span>\n`);
      updateConsoleOutput(`<span style="color: #fff;">   • Ensure nRF52 board is connected via USB</span>\n`);
      updateConsoleOutput(`<span style="color: #fff;">   • Use a data-capable USB cable (not charge-only)</span>\n`);
      updateConsoleOutput(`<span style="color: #fff;">   • Try different USB ports or hubs</span>\n\n`);
      
      updateConsoleOutput(`<span style="color: #ffeb3b;">2. Software Installation:</span>\n`);
      updateConsoleOutput(`<span style="color: #fff;">   • Install nRF Command Line Tools from Nordic website</span>\n`);
      updateConsoleOutput(`<span style="color: #fff;">   • Update device drivers if needed</span>\n`);
      updateConsoleOutput(`<span style="color: #fff;">   • Restart application after driver installation</span>\n\n`);
      
      updateConsoleOutput(`<span style="color: #ffeb3b;">3. Device Status:</span>\n`);
      updateConsoleOutput(`<span style="color: #fff;">   • Check if device LED indicates power/connection</span>\n`);
      updateConsoleOutput(`<span style="color: #fff;">   • Try pressing reset button on the board</span>\n`);
      updateConsoleOutput(`<span style="color: #fff;">   • Ensure device is not in sleep/protected mode</span>\n\n`);
      
      updateConsoleOutput(`<span style="color: #ffeb3b;">4. macOS Specific:</span>\n`);
             updateConsoleOutput(`<span style="color: #fff;">   • Grant Terminal/Application USB access permissions</span>\n`);
      updateConsoleOutput(`<span style="color: #fff;">   • Check System Preferences > Security & Privacy</span>\n\n`);
      
      setIsTesting(false);
      setTimeout(() => { shouldAutoScrollRef.current = false; }, 1000);
      return false;
    }
  };

  const handleFlash = async () => {
    setIsFlashing(true);
    shouldAutoScrollRef.current = true; // Enable auto-scroll
    setConsoleOutput('');
    setProgress(0);
    
    try {
      // First check if device is connected
      updateConsoleOutput('<span style="color: #2196f3; font-weight: bold;">🚀 Starting flash process...</span>\n');
      const deviceConnected = await checkDeviceConnection();
      
      if (!deviceConnected) {
        throw new Error('No nRF device found. Please connect your device and try again.');
      }
      
      const hexToFlash = certificatesPath.full || customHexPath;
      if (!hexToFlash) {
        updateConsoleOutput('<span style="color: #ffeb3b; font-weight: bold;">ℹ️ Skipping certificate flashing (no certificate selected)</span>\n');
      }

      const commands = [
        recoverChecked ? 'nrfjprog --recover' : null,
        `nrfjprog --family NRF52 --program "${softDevicePath.full}" --sectorerase --verify --reset`,
        `nrfjprog --family NRF52 --program "${testAppPath.full}" --sectorerase --verify --reset`,
        hexToFlash ? `nrfjprog --family NRF52 --program "${hexToFlash}" --sectorerase --verify --reset` : null,
        resetChecked ? 'nrfjprog --reset' : null
      ].filter(Boolean);

      const totalCommands = commands.length;
      
      for (let i = 0; i < commands.length; i++) {
        const command = commands[i];
        console.log(`Executing command: ${command}`);
        await runCommand(command);
        setProgress(((i + 1) / totalCommands) * 100);
        console.log(`Finished executing command: ${command}`);
      }

      updateConsoleOutput('<span style="color: #4caf50; font-weight: bold;">✅ Flash process completed successfully.</span>\n');
    } catch (error) {
      updateConsoleOutput(`<span style="color: #f44336; font-weight: bold;">❌ Flash process failed: ${error.message}</span>\n`);
      
      // If it's a device connection issue, provide additional guidance
      if (error.message.includes('No nRF device found') || error.message.includes('No debuggers found')) {
        updateConsoleOutput(`<span style="color: #ff9800; font-weight: bold;">\n🔧 Quick Fix Steps:</span>\n`);
        updateConsoleOutput(`<span style="color: #ffeb3b;">1. Connect your nRF52 development board via USB</span>\n`);
        updateConsoleOutput(`<span style="color: #ffeb3b;">2. Ensure the USB cable supports data (not just charging)</span>\n`);
        updateConsoleOutput(`<span style="color: #ffeb3b;">3. Check Device Manager (Windows) or System Report (macOS) for the device</span>\n`);
        updateConsoleOutput(`<span style="color: #ffeb3b;">4. Install nRF Command Line Tools if not already installed</span>\n`);
        updateConsoleOutput(`<span style="color: #ffeb3b;">5. Try a different USB port or cable</span>\n`);
      }
    } finally {
      setIsFlashing(false);
      // Keep auto-scroll enabled for a bit longer to catch final messages
      setTimeout(() => {
        shouldAutoScrollRef.current = false;
      }, 2000);
      setProgress(0);
    }
  };

  const handleSelectCustomHex = async () => {
    try {
      if (!window?.electronAPI?.selectFile) {
        updateConsoleOutput('<span style="color: #f44336; font-weight: bold;">❌ File picker not available.</span>\n');
        return;
      }
      const selected = await window.electronAPI.selectFile();
      if (!selected) return;
      const isHex = typeof selected === 'string' && selected.toLowerCase().endsWith('.hex');
      if (!isHex) {
        updateConsoleOutput('<span style="color: #f44336; font-weight: bold;">❌ Please select a .hex file.</span>\n');
        return;
      }
      setCustomHexPath(selected);
      updateConsoleOutput(`<span style="color: #4caf50; font-weight: bold;">✅ Custom HEX selected:</span> ${selected}\n`);
    } catch (error) {
      updateConsoleOutput(`<span style="color: #f44336; font-weight: bold;">❌ Error selecting file: ${error.message}</span>\n`);
    }
  };

  const runCommand = async (command) => {
    return new Promise((resolve, reject) => {
      // Check if component is still mounted and electronAPI is available
      if (!isMountedRef.current) {
        reject(new Error('Component unmounted during command execution'));
        return;
      }

      if (!window?.electronAPI?.runCommandWithRealTimeOutput) {
        reject(new Error('electronAPI not available'));
        return;
      }

      updateConsoleOutput(`<span style="color: #2196f3; font-weight: bold;">🔄 Executing: ${command}</span>\n`);
      let hasError = false;
      let errorMessage = '';
      let commandOutput = '';
      
      window.electronAPI.runCommandWithRealTimeOutput(command, null, (data) => {
        if (typeof data === 'string') {
          commandOutput += data;
          
          if (data.includes('ERROR:')) {
            hasError = true;
            // Capture specific error messages for better user guidance
            if (data.includes('No debuggers were discovered')) {
              errorMessage = 'No debuggers found';
            } else if (data.includes('Cannot connect')) {
              errorMessage = 'Connection failed';
            } else if (data.includes('UICR access denied')) {
              errorMessage = 'Access denied - device may be protected';
            } else {
              errorMessage = 'Command execution error';
            }
          }
        }
        
        updateConsoleOutput(data);
      })
        .then(() => {
          if (hasError) {
            updateConsoleOutput(`<span style="color: #f44336; font-weight: bold;">❌ Command failed: ${command}</span>\n`);
            
            // Provide specific troubleshooting guidance based on error type
            if (errorMessage === 'No debuggers found') {
              updateConsoleOutput(`<span style="color: #ff9800; font-weight: bold;">💡 Troubleshooting:</span>\n`);
              updateConsoleOutput(`<span style="color: #ffeb3b;">   • Ensure your nRF development board is connected via USB</span>\n`);
              updateConsoleOutput(`<span style="color: #ffeb3b;">   • Check that the USB cable supports data transfer (not charge-only)</span>\n`);
              updateConsoleOutput(`<span style="color: #ffeb3b;">   • Try running: nrfjprog --ids to list available programmers</span>\n`);
              updateConsoleOutput(`<span style="color: #ffeb3b;">   • On macOS, you may need to install nRF Command Line Tools</span>\n`);
              updateConsoleOutput(`<span style="color: #ffeb3b;">   • Try reconnecting the device or using a different USB port</span>\n`);
            } else if (errorMessage === 'Access denied - device may be protected') {
              updateConsoleOutput(`<span style="color: #ff9800; font-weight: bold;">💡 Troubleshooting:</span>\n`);
              updateConsoleOutput(`<span style="color: #ffeb3b;">   • Device appears to be protected or locked</span>\n`);
              updateConsoleOutput(`<span style="color: #ffeb3b;">   • Try enabling "Device Recovery" option above</span>\n`);
              updateConsoleOutput(`<span style="color: #ffeb3b;">   • Use: nrfjprog --recover to unlock the device</span>\n`);
            }
            
            reject(new Error(`${errorMessage}: ${command}`));
          } else {
            updateConsoleOutput(`<span style="color: #4caf50; font-weight: bold;">✅ Command completed: ${command}</span>\n`);
            resolve();
          }
        })
        .catch((error) => {
          updateConsoleOutput(`<span style="color: #f44336; font-weight: bold;">❌ Error: ${error.message}</span>\n`);
          console.error('Command failed:', command, 'Error:', error);
          reject(error);
        });
    });
  };

  const handleStop = async () => {
    try {
      if (window?.electronAPI?.stopCommand) {
        await window.electronAPI.stopCommand();
        updateConsoleOutput('<span style="color: #ff9800; font-weight: bold;">⏹️ Process stopped by user.</span>\n');
      } else {
        updateConsoleOutput('<span style="color: #ff9800; font-weight: bold;">⏹️ Stop requested (electronAPI not available).</span>\n');
      }
    } catch (error) {
      updateConsoleOutput(`<span style="color: #f44336;">Error stopping process: ${error.message}</span>\n`);
    } finally {
      setIsFlashing(false);
      // Keep auto-scroll enabled for a bit longer to catch final messages
      setTimeout(() => {
        if (isMountedRef.current) {
          shouldAutoScrollRef.current = false;
        }
      }, 1000);
      setProgress(0);
    }
  };

  const exportLog = (logEntry = null) => {
    const content = logEntry ? logEntry.content : consoleOutput;
    const timestamp = logEntry ? logEntry.timestamp : new Date().toLocaleString();
    const filename = `nordic_flash_log_${timestamp.replace(/[/:]/g, '-').replace(/\s/g, '_')}.txt`;
    
    const element = document.createElement('a');
    const file = new Blob([content.replace(/<[^>]*>/g, '')], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <Box 
      ref={componentRef}
      sx={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: 'calc(100vh - 88px)', // Header (56px) + TabPanel padding (32px)
        gap: 0.4, // Reduced gap
        overflow: 'hidden',
        paddingTop: '8px', // Reduced padding
        paddingBottom: '8px',
        paddingLeft: '12px',
        paddingRight: '12px'
      }}>
      {/* Path Information Cards */}
      <Box sx={{ display: 'grid', gap: 0.2, flexShrink: 0 }}>
        <PathCard>
          <CardContent sx={{ py: 0.4, px: 1.5, '&:last-child': { pb: 0.4 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0 }}>
              <SettingsIcon sx={{ color: '#ff9800', fontSize: 16 }} />
              <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#fff', fontSize: '14px', flex: 1 }}>
                SoftDevice Path
              </Typography>
              <StatusChip 
                status={getPathStatus(softDevicePath)} 
                label={getPathStatus(softDevicePath) === 'ready' ? 'Ready' : 'Missing'} 
                size="small"
                sx={{ height: '20px', fontSize: '11px', fontWeight: 'bold', minWidth: '60px' }}
              />
            </Box>
            <Typography variant="body2" sx={{ color: '#ccc', fontFamily: 'monospace', fontSize: '14px', mt: 0.2 }}>
              {softDevicePath.trimmed || 'No Data'}
            </Typography>
          </CardContent>
        </PathCard>

        <PathCard>
          <CardContent sx={{ py: 0.4, px: 1.5, '&:last-child': { pb: 0.4 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0 }}>
              <FlashOnIcon sx={{ color: '#4caf50', fontSize: 16 }} />
              <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#fff', fontSize: '14px', flex: 1 }}>
                Test App Path
              </Typography>
              <StatusChip 
                status={getPathStatus(testAppPath)} 
                label={getPathStatus(testAppPath) === 'ready' ? 'Ready' : 'Missing'} 
                size="small"
                sx={{ height: '20px', fontSize: '11px', fontWeight: 'bold', minWidth: '60px' }}
              />
            </Box>
            <Typography variant="body2" sx={{ color: '#ccc', fontFamily: 'monospace', fontSize: '14px', mt: 0.2 }}>
              {testAppPath.trimmed || 'No Data'}
            </Typography>
          </CardContent>
        </PathCard>

        <PathCard>
          <CardContent sx={{ py: 0.4, px: 1.5, '&:last-child': { pb: 0.4 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0 }}>
              <SecurityIcon sx={{ color: '#9c27b0', fontSize: 16 }} />
              <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#fff', fontSize: '14px', flex: 1 }}>
                Certificates
              </Typography>
              <StatusChip 
                status={(certificatesPath.full || customHexPath) ? 'ready' : 'missing'} 
                label={(certificatesPath.full || customHexPath) ? 'Ready' : 'Missing'} 
                size="small"
                sx={{ height: '20px', fontSize: '11px', fontWeight: 'bold', minWidth: '60px' }}
              />
            </Box>
            <Typography variant="body2" sx={{ color: '#ccc', fontFamily: 'monospace', fontSize: '14px', mt: 0.2 }}>
              {customHexPath 
                ? `Custom HEX → ${trimCertificatePath(customHexPath)}` 
                : (certificateDisplayText || certificatesPath.trimmed || 'No selected certificate')}
            </Typography>
            {(!certificatesPath.full) && (
              <Box sx={{ mt: 0.6 }}>
                <Button 
                  variant="outlined" 
                  size="small" 
                  onClick={handleSelectCustomHex}
                  disabled={isFlashing || isTesting}
                  sx={{
                    borderColor: '#9c27b0',
                    color: '#9c27b0',
                    '&:hover': { borderColor: '#7b1fa2', backgroundColor: 'rgba(156, 39, 176, 0.06)' },
                    fontWeight: 'bold',
                    fontSize: '12px',
                    px: 1.5,
                    py: 0.2
                  }}
                >
                  Select Custom HEX
                </Button>
              </Box>
            )}
          </CardContent>
        </PathCard>
      </Box>

      {/* Console Output */}
      <ConsoleContainer sx={{ 
        flexGrow: 1,
        display: 'flex', 
        flexDirection: 'column',
        minHeight: '200px',
        overflow: 'hidden'
      }}>
        <ConsoleHeader>
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#f44336' }} />
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#ff9800' }} />
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#4caf50' }} />
          
          <Typography variant="caption" sx={{ color: '#aaa', ml: 2 }}>
            Console Output
          </Typography>
          
          {/* Status in Console Header */}
          {isFlashing && (
            <Box sx={{ ml: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <StatusChip 
                status="processing" 
                label="FLASHING..." 
                size="small"
                icon={<FlashOnIcon />}
              />
            </Box>
          )}
          {isTesting && !isFlashing && (
            <Box sx={{ ml: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <StatusChip 
                status="processing" 
                label="TESTING CONNECTION..." 
                size="small"
                icon={<UsbIcon />}
                sx={{ 
                  backgroundColor: '#ff9800',
                  color: 'white',
                  animation: 'pulse 1.5s ease-in-out infinite',
                  '@keyframes pulse': {
                    '0%': { opacity: 1 },
                    '50%': { opacity: 0.7 },
                    '100%': { opacity: 1 }
                  }
                }}
              />
            </Box>
          )}
          
          <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
            <Tooltip title="Export Current Log">
              <IconButton 
                size="small" 
                onClick={() => exportLog()}
                sx={{ color: '#aaa', '&:hover': { color: '#fff' } }}
              >
                <SaveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </ConsoleHeader>
        
        <Box 
          ref={consoleRef}
          sx={{ 
            flexGrow: 1, 
            overflow: 'auto', 
            backgroundColor: '#1e1e1e',
            padding: '12px',
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: '#333',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: '#666',
              borderRadius: '4px',
              '&:hover': {
                backgroundColor: '#888',
              },
            },
          }}
        >
          {consoleOutput ? (
            <StyledPre 
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(consoleOutput) }}
              style={{ color: '#fff', margin: 0 }}
            />
          ) : (
            <Typography sx={{ color: '#666', fontStyle: 'italic' }}>
              Console output will appear here...
            </Typography>
          )}

        </Box>
      </ConsoleContainer>

      {/* Progress Bar */}
      {isFlashing && (
        <Box sx={{ flexShrink: 0 }}>
          <LinearProgress 
            variant="determinate" 
            value={progress} 
            sx={{ 
              height: 6, 
              borderRadius: 3,
              backgroundColor: '#333',
              '& .MuiLinearProgress-bar': {
                backgroundColor: '#2196f3',
              }
            }} 
          />
          <Typography variant="caption" sx={{ color: '#aaa', mt: 0.3 }}>
            Progress: {Math.round(progress)}%
          </Typography>
        </Box>
      )}

      {/* Control Panel */}
      <Paper sx={{ 
        p: 1, 
        backgroundColor: '#2a2a2a', 
        border: '1px solid #404040',
        borderRadius: 2,
        flexShrink: 0
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
              <Checkbox
                checked={recoverChecked}
                onChange={(e) => setRecoverChecked(e.target.checked)}
                size="small"
                sx={{ 
                  color: '#2196f3',
                  '&.Mui-checked': { color: '#2196f3' }
                }}
              />
              <Box>
                <Typography sx={{ color: '#fff', fontWeight: 500, fontSize: '14px' }}>
                  Device Recovery
                </Typography>
                <Typography variant="caption" sx={{ color: '#aaa', fontSize: '11px' }}>
                  (Recommended for first-time flashing)
                </Typography>
              </Box>
            </Box>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
              <Checkbox
                checked={resetChecked}
                onChange={(e) => setResetChecked(e.target.checked)}
                size="small"
                sx={{ 
                  color: '#ff9800',
                  '&.Mui-checked': { color: '#ff9800' }
                }}
              />
              <Box>
                <Typography sx={{ color: '#fff', fontWeight: 500, fontSize: '14px' }}>
                  Final Reset
                </Typography>
                <Typography variant="caption" sx={{ color: '#aaa', fontSize: '11px' }}>
                  (Execute reset after flashing)
                </Typography>
              </Box>
            </Box>
          </Box>
          
          <Stack direction="row" spacing={1.5}>

            <Button 
              variant="outlined" 
              onClick={checkDeviceConnection} 
              disabled={isFlashing || isTesting}
              startIcon={<UsbIcon />}
              sx={{
                borderColor: isTesting ? '#ff9800' : '#4caf50',
                color: isTesting ? '#ff9800' : '#4caf50',
                '&:hover': { 
                  borderColor: isTesting ? '#f57c00' : '#388e3c',
                  backgroundColor: isTesting ? 'rgba(255, 152, 0, 0.04)' : 'rgba(76, 175, 80, 0.04)'
                },
                '&:disabled': { 
                  borderColor: '#333',
                  color: '#666'
                },
                fontWeight: 'bold',
                px: 2,
                fontSize: '12px',
                animation: isTesting ? 'pulse 1.5s ease-in-out infinite' : 'none',
                '@keyframes pulse': {
                  '0%': {
                    opacity: 1,
                  },
                  '50%': {
                    opacity: 0.6,
                  },
                  '100%': {
                    opacity: 1,
                  },
                }
              }}
            >
              {isTesting ? 'TESTING...' : 'TEST'}
            </Button>
            <Button 
              variant="contained" 
              onClick={handleFlash} 
              disabled={isFlashing}
              startIcon={<FlashOnIcon />}
              sx={{
                backgroundColor: '#2196f3',
                '&:hover': { backgroundColor: '#1976d2' },
                '&:disabled': { backgroundColor: '#333' },
                fontWeight: 'bold',
                px: 2.5,
                fontSize: '13px'
              }}
            >
              {isFlashing ? 'FLASHING...' : 'FLASH'}
            </Button>
            <Button
              variant="contained"
              color="error"
              onClick={handleStop}
              disabled={!isFlashing}
              startIcon={<StopIcon />}
              sx={{
                fontWeight: 'bold',
                px: 2.5,
                fontSize: '13px'
              }}
            >
              STOP
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}

export default NordicFlashPage;


