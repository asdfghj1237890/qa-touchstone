import React, { useState, useEffect, useRef } from 'react';
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
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import { styled } from '@mui/system';
import StopIcon from '@mui/icons-material/Stop';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import SecurityIcon from '@mui/icons-material/Security';
import SettingsIcon from '@mui/icons-material/Settings';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
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

function SilabsFlashPage() {
  const [softDevicePath, setSoftDevicePath] = useState({ full: '', trimmed: '' });
  const [testAppPath, setTestAppPath] = useState({ full: '', trimmed: '' });
  const [credentialsPath, setCredentialsPath] = useState({ full: '', trimmed: '' });
  const [s37Files, setS37Files] = useState([]);
  const [selectedS37Path, setSelectedS37Path] = useState('');
  const [manualDevicePart, setManualDevicePart] = useState('');
  const [deviceSns, setDeviceSns] = useState([]);
  const [selectedDeviceSn, setSelectedDeviceSn] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState('');
  const [eraseAllChecked, setEraseAllChecked] = useState(true);
  const [progress, setProgress] = useState(0);
  const { isFlashing, setIsFlashing } = useFlashing();
  const isMountedRef = useRef(true);
  const shouldAutoScrollRef = useRef(true);
  const maxLogLength = 20000;
  const consoleRef = useRef(null);

  // Progress bands for full sequence (sum to 1.0)
  const STAGE_BANDS = {
    eraseUserdata: { base: 0.00, span: 0.15 },
    massErase:     { base: 0.15, span: 0.15 },
    flashTest:     { base: 0.30, span: 0.30 },
    reset1:        { base: 0.60, span: 0.05 },
    flashCert:     { base: 0.65, span: 0.30 },
    reset2:        { base: 0.95, span: 0.05 },
  };

  useEffect(() => {
    isMountedRef.current = true;
    loadFlashPathData();
    // Initial device scan for Simplicity Commander SNs
    scanSilabsDevices();
    return () => {
      isMountedRef.current = false;
      if (isFlashing) {
        console.log('Stopping command due to component unmount');
        window.electronAPI.stopCommand().catch(console.error);
      }
    };
  }, []);

  // Removed global command-output listener to prevent duplicate outputs

  // Simplified useEffect for final scroll insurance
  useEffect(() => {
    if ((isFlashing || shouldAutoScrollRef.current) && consoleOutput && consoleRef.current) {
      // Final scroll check with longer delay
      const timeoutId = setTimeout(() => {
        if (consoleRef.current && (isFlashing || shouldAutoScrollRef.current)) {
          consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
          console.log('Final scroll check executed');
        }
      }, 300);
      
      return () => clearTimeout(timeoutId);
    }
  }, [consoleOutput, isFlashing]);

  const loadFlashPathData = async () => {
    console.log('[DEBUG Silabs] Loading flash path data...');
    try {
      const data = await window.electronAPI.getFlashPathData('silabs');
      console.log('[DEBUG Silabs] Received flash path data:', {
        certificate_folder_path: data.certificate_folder_path,
        current_used_paths: data.current_used_paths,
        saved_paths_count: data.saved_paths?.length || 0
      });
      
      setSoftDevicePath({
        full: data.current_used_paths?.softDevicePath || '',
        trimmed: trimPath(data.current_used_paths?.softDevicePath || '', 'sid_sdk')
      });
      setTestAppPath({
        full: data.current_used_paths?.testAppPath || '',
        trimmed: trimPath(data.current_used_paths?.testAppPath || '', 'sid_test')
      });
      // Discover .s37 files under certificate folder and select default
      const s37List = await listS37Files(data.certificate_folder_path || '');
      setS37Files(s37List);
      const defaultS37 = s37List.length > 0 ? s37List[0].full : '';
      setSelectedS37Path(defaultS37);
      setCredentialsPath({
        full: defaultS37,
        trimmed: trimCertificatePath(defaultS37)
      });
      
      console.log('[DEBUG Silabs] State updated with paths:', {
        softDevice: data.current_used_paths?.softDevicePath || '',
        testApp: data.current_used_paths?.testAppPath || '',
        certificates: defaultS37
      });
    } catch (error) {
      console.error('[DEBUG Silabs] Error loading flash path data:', error);
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

  const listS37Files = async (folderPath) => {
    if (!folderPath) return [];
    try {
      const files = await window.electronAPI.readDirectory(folderPath);
      if (!Array.isArray(files)) {
        console.error('readDirectory did not return an array:', files);
        return [];
      }
      return files
        .filter(file => /\.s37$/i.test(file))
        .map(file => ({ full: `${folderPath}/${file}`, name: file }));
    } catch (error) {
      console.error('Error listing .s37 files:', error);
      return [];
    }
  };

  const findHexFile = async (folderPath) => {
    if (!folderPath) return '';
    
    try {
      const files = await window.electronAPI.readDirectory(folderPath);
      
      if (!Array.isArray(files)) {
        console.error('readDirectory did not return an array:', files);
        return '';
      }
      
      const hexFile = files.find(file => 
        /^[A-Z0-9]{10}\.hex$/.test(file) || 
        /^certificate_[A-Z0-9]{10}_silabs(\_FD000)?\.hex$/.test(file)
      );
      
      return hexFile ? `${folderPath}/${hexFile}` : '';
    } catch (error) {
      console.error('Error in findHexFile:', error);
      return '';
    }
  };

  const updateConsoleOutput = (data) => {
    if (isMountedRef.current) {
      setConsoleOutput(prev => {
        const newOutput = prev + (typeof data === 'string' ? data : JSON.stringify(data));
        const truncatedOutput = newOutput.slice(-maxLogLength);
        
        // Auto-scroll console to bottom - use both isFlashing and shouldAutoScrollRef
        if ((isFlashing || shouldAutoScrollRef.current) && consoleRef.current) {
          console.log('Attempting scroll - isFlashing:', isFlashing, 'shouldAutoScroll:', shouldAutoScrollRef.current);
          
          // Force scroll to bottom with multiple attempts
          const scrollToBottom = () => {
            if (consoleRef.current) {
              const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
              const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
              console.log('Scroll check - distance from bottom:', distanceFromBottom, 'scrollHeight:', scrollHeight);
              
              // Always scroll to bottom during flashing process
              if (isFlashing || shouldAutoScrollRef.current) {
                const oldScrollTop = consoleRef.current.scrollTop;
                consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
                console.log('Force scrolled from', oldScrollTop, 'to', consoleRef.current.scrollTop);
              }
            }
          };
          
          // Multiple scroll attempts with different timings
          setTimeout(scrollToBottom, 0);
          setTimeout(scrollToBottom, 10);
          setTimeout(scrollToBottom, 50);
          setTimeout(scrollToBottom, 100);
        }
        
        return truncatedOutput;
      });
    }
  };

  const getPathStatus = (path) => {
    if (!path || (typeof path === 'object' && !path.full)) return 'missing';
    return 'ready';
  };

  const getDevicePartFromPath = (filePath) => {
    if (!filePath) return null;
    const lower = filePath.toLowerCase();
    if (lower.includes('xg21')) return 'EFR32BG21BXXXF1024';
    if (lower.includes('xg23')) return 'EFR32ZG23B020F512';
    if (lower.includes('xg24')) return 'EFR32MG24B220F1536';
    if (lower.includes('xg25')) return 'EFR32FG25B222F1920';
    if (lower.includes('xg28')) return 'EFR32ZG28B312F1024';
    return null;
  };

  const buildFlashCommandForTestApp = (s37Path) => {
    const devicePart = getDevicePartFromPath(s37Path);
    if (!devicePart) {
      throw new Error('Cannot determine device type (xg21/xg23/xg24/xg25/xg28) from selected .s37 path.');
    }
    // Use quoted path to be safe across platforms
    return `commander flash --device ${devicePart} "${s37Path}"`;
  };

  const runSilabsCommand = async (command, progressBand) => {
    console.log('[Silabs] runSilabsCommand start:', command);
    return new Promise((resolve, reject) => {
      if (!isMountedRef.current) {
        console.warn('[Silabs] Component flag indicates unmounted, proceeding without UI updates');
      }
      if (!window?.electronAPI?.runCommandWithRealTimeOutput) {
        console.error('[Silabs] electronAPI.runCommandWithRealTimeOutput not available');
        reject(new Error('electronAPI not available'));
        return;
      }
      updateConsoleOutput(`<span style="color: #2196f3; font-weight: bold;">🔄 Executing: ${command}</span>\n`);
      let hasError = false;
      let totalBytes = 0;
      let writtenBytes = 0;

      // Initialize band start for any staged command
      if (progressBand) {
        setProgress((progressBand.base) * 100);
      }
 
      window.electronAPI
        .runCommandWithRealTimeOutput(command, null, (data) => {
          if (typeof data === 'string') {
            updateConsoleOutput(data);
            // Progress parsing for commander flash
            if (progressBand && /\bcommander\s+flash\b/i.test(command)) {
              const writeMatch = data.match(/Writing\s+(\d+)\s+bytes/i);
              if (writeMatch && !totalBytes) {
                totalBytes = parseInt(writeMatch[1], 10) || 0;
                writtenBytes = 0;
                // band start already set above
              }
              const progMatch = data.match(/Programming\s+range\b.*\((\d+)\s*KB\)/i);
              if (progMatch && totalBytes > 0) {
                const kb = parseInt(progMatch[1], 10) || 0;
                writtenBytes += kb * 1024;
                const fraction = Math.max(0, Math.min(1, writtenBytes / totalBytes));
                const pct = (progressBand.base + progressBand.span * fraction) * 100;
                setProgress(pct);
              }
              if (/Flashing completed successfully!/i.test(data) && totalBytes > 0) {
                setProgress((progressBand.base + progressBand.span) * 100);
              }
            }
            if (data.includes('ERROR:')) {
              hasError = true;
            }
          } else if (data && (data.stdout || data.stderr)) {
            updateConsoleOutput((data.stdout || data.stderr));
          }
        })
        .then((exitCode) => {
          console.log('[Silabs] Command exit code:', exitCode);
          if (hasError || exitCode !== 0) {
            updateConsoleOutput(`<span style="color: #f44336; font-weight: bold;">❌ Command failed (${exitCode}): ${command}</span>\n`);
            reject(new Error(`Command failed with code ${exitCode}`));
          } else {
            // For non-flash staged commands, mark band completion here
            if (progressBand && !/\bcommander\s+flash\b/i.test(command)) {
              setProgress((progressBand.base + progressBand.span) * 100);
            }
            updateConsoleOutput(`<span style="color: #4caf50; font-weight: bold;">✅ Command completed: ${command}</span>\n`);
            resolve(0);
          }
        })
        .catch((error) => {
          console.error('[Silabs] Command error:', error);
          updateConsoleOutput(`<span style="color: #f44336; font-weight: bold;">❌ Error: ${error.message}</span>\n`);
          reject(error);
        });
    });
  };

  const handleFlash = async () => {
    console.log('[Silabs] handleFlash clicked');
    isMountedRef.current = true;
    setIsFlashing(true);
    shouldAutoScrollRef.current = true; // Enable auto-scroll
    setConsoleOutput('');
    setProgress(0);
    updateConsoleOutput('<span style="color: #90caf9; font-weight: bold;">▶ Starting Silabs flash sequence...</span>\n');
    
    try {
      const s37Path = selectedS37Path || credentialsPath.full;
      console.log('[Silabs] Selected S37:', s37Path);
      const devicePartAuto = getDevicePartFromPath(s37Path || testAppPath?.full || softDevicePath?.full);
      const devicePart = manualDevicePart || devicePartAuto;
      console.log('[Silabs] Resolved device part:', devicePart);
      if (!devicePart) {
        throw new Error('Cannot determine device type (xg21/xg23/xg24/xg25/xg28). Please select it manually.');
      }
      if (!selectedDeviceSn) {
        throw new Error('No device serial number selected. Please choose a Device SN.');
      }

      // Step 0: Erase all (optional)
      if (eraseAllChecked) {
        await runSilabsCommand(
          `commander device pageerase --region @userdata --device ${devicePart} --serialno ${selectedDeviceSn}`,
          STAGE_BANDS.eraseUserdata
        );
        await runSilabsCommand(
          `commander device masserase --device ${devicePart} --serialno ${selectedDeviceSn}`,
          STAGE_BANDS.massErase
        );
      } else {
        updateConsoleOutput('<span style="color: #ff9800;">ℹ️ Erase All unchecked. Skipping erase operations.</span>\n');
      }

      // Step 1: Flash test app (if configured)
      if (testAppPath?.full) {
        await runSilabsCommand(
          `commander flash --device ${devicePart} \"${testAppPath.full}\"`,
          STAGE_BANDS.flashTest
        );
      } else {
        updateConsoleOutput('<span style="color: #ff9800;">ℹ️ Test app path not configured. Skipping test app flashing.</span>\n');
      }

      // Step 2: Device reset
      await runSilabsCommand('commander device reset', STAGE_BANDS.reset1);

      // Step 3: Flash certificate (.s37 selected)
      if (s37Path) {
        const isXg28 = /EFR32ZG28/i.test(devicePart);
        const isXg24 = /EFR32MG24/i.test(devicePart);
        const step3Command = isXg28
          ? `commander flash --address 0x080F8000 --serialno ${selectedDeviceSn} \"${s37Path}\"`
          : isXg24
          ? `commander flash --address 0x08172000 \"${s37Path}\" --serialno ${selectedDeviceSn}`
          : `commander flash --device ${devicePart} \"${s37Path}\"`;
        await runSilabsCommand(
          step3Command,
          STAGE_BANDS.flashCert
        );
      } else {
        updateConsoleOutput('<span style="color: #ff9800;">ℹ️ No .s37 selected. Skipping credential flashing.</span>\n');
      }

      // Step 4: Final device reset
      await runSilabsCommand('commander device reset', STAGE_BANDS.reset2);

      setProgress(100);
      updateConsoleOutput('<span style="color: #4caf50; font-weight: bold;">✅ Flash sequence completed successfully.</span>\n');
    } catch (error) {
      console.error('[Silabs] handleFlash error:', error);
      updateConsoleOutput(`<span style="color: #f44336; font-weight: bold;">❌ Flash process failed: ${error.message}</span>\n`);
    } finally {
      setIsFlashing(false);
      setTimeout(() => {
        shouldAutoScrollRef.current = false;
      }, 2000);
      setProgress(0);
    }
  };

  const handleStop = async () => {
    try {
      await window.electronAPI.stopCommand();
      updateConsoleOutput('<span style="color: #ff9800; font-weight: bold;">⏹️ Process stopped by user.</span>\n');
    } catch (error) {
      updateConsoleOutput(`<span style="color: #f44336;">Error stopping process: ${error.message}</span>\n`);
    } finally {
      setIsFlashing(false);
      // Keep auto-scroll enabled for a bit longer to catch final messages
      setTimeout(() => {
        shouldAutoScrollRef.current = false;
      }, 1000);
      setProgress(0);
    }
  };

  const exportLog = (logEntry = null) => {
    const content = logEntry ? logEntry.content : consoleOutput;
    const timestamp = logEntry ? logEntry.timestamp : new Date().toLocaleString();
    const filename = `silabs_flash_log_${timestamp.replace(/[/:]/g, '-').replace(/\s/g, '_')}.txt`;
    
    const element = document.createElement('a');
    const file = new Blob([content.replace(/<[^>]*>/g, '')], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const scanSilabsDevices = async () => {
    if (!window?.electronAPI?.runCommandWithRealTimeOutput) return;
    setIsScanning(true);
    try {
      let output = '';
      await window.electronAPI.runCommandWithRealTimeOutput('commander device list', null, (data) => {
        if (typeof data === 'string') {
          output += data + '\n';
        } else if (data && (data.stdout || data.stderr)) {
          output += (data.stdout || data.stderr) + '\n';
        }
      });

      let sns = parseCommanderSerials(output);

      // Fallback to adapter list if nothing found
      if (sns.length === 0) {
        output = '';
        await window.electronAPI.runCommandWithRealTimeOutput('commander adapter list', null, (data) => {
          if (typeof data === 'string') {
            output += data + '\n';
          } else if (data && (data.stdout || data.stderr)) {
            output += (data.stdout || data.stderr) + '\n';
          }
        });
        sns = parseCommanderSerials(output);
      }

      setDeviceSns(sns);
      if (!selectedDeviceSn && sns.length > 0) {
        setSelectedDeviceSn(sns[0]);
      } else if (selectedDeviceSn && !sns.includes(selectedDeviceSn)) {
        // Previously selected SN no longer present
        setSelectedDeviceSn(sns[0] || '');
      }
    } catch (error) {
      updateConsoleOutput(`<span style="color: #f44336; font-weight: bold;">❌ Commander scan failed: ${error.message}</span>\n`);
    } finally {
      setIsScanning(false);
    }
  };

  const parseCommanderSerials = (text) => {
    const found = new Set();
    if (!text) return [];
    const patterns = [
      // Common forms
      /serial\s*number\s*[:=]\s*(\d{6,})/gi, // "Serial Number: 822000605" or "Serial Number=822000605"
      /serialNumber\s*[:=]\s*(\d{6,})/gi,   // camelCase key output
      /device\((\d{6,})\)/gi,               // device(822000605)
      /J-?Link\s+Serial\s+(?:No\.?|Number)?\s*[:=]?\s*(\d{6,})/gi,
      /Adapter\s+(?:SN|Serial)\s*[:=]?\s*(\d{6,})/gi,
      /\bSN\s*[:=]\s*(\d{6,})\b/gi
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[1]) found.add(m[1]);
      }
    }
    return Array.from(found);
  };

  return (
    <Box sx={{ 
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
          <CardContent sx={{ py: 0.3, px: 1.2, '&:last-child': { pb: 0.3 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 0.4 }}>
              <SettingsIcon sx={{ color: '#90caf9', fontSize: 16 }} />
              <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#fff', fontSize: '14px', flex: 1 }}>
                Connected Device SN
              </Typography>
              <StatusChip 
                status={selectedDeviceSn ? 'ready' : 'missing'} 
                label={selectedDeviceSn ? 'Ready' : 'Missing'} 
                size="small"
                sx={{ height: '20px', fontSize: '11px', fontWeight: 'bold', minWidth: '60px' }}
              />
            </Box>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FormControl size="small" sx={{ minWidth: 180, flex: 1 }}>
                <InputLabel id="silabs-sn-label" sx={{ color: '#ccc' }}>Device SN</InputLabel>
                <Select
                  labelId="silabs-sn-label"
                  value={selectedDeviceSn}
                  label="Device SN"
                  onChange={(e) => setSelectedDeviceSn(e.target.value)}
                  sx={{
                    color: '#fff',
                    '.MuiOutlinedInput-notchedOutline': { borderColor: '#555' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#777' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#90caf9' }
                  }}
                >
                  {deviceSns.length === 0 && (
                    <MenuItem value="" disabled>No devices found</MenuItem>
                  )}
                  {deviceSns.map((sn) => (
                    <MenuItem key={sn} value={sn}>{sn}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 200, flex: 1.2 }}>
                <Select
                  value={manualDevicePart}
                  onChange={(e) => setManualDevicePart(e.target.value)}
                  displayEmpty
                  size="small"
                  sx={{
                    color: '#fff',
                    '.MuiOutlinedInput-notchedOutline': { borderColor: '#555' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#777' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#90caf9' },
                    '& .MuiSelect-select': {
                      color: manualDevicePart ? '#fff' : '#aaa'
                    }
                  }}
                  renderValue={(value) => {
                    if (!value) {
                      return <span style={{ color: '#aaa', fontStyle: 'italic' }}>EFR32 Part (Auto)</span>;
                    }
                    return value;
                  }}
                >
                  <MenuItem value=""><em>Auto</em></MenuItem>
                  <MenuItem value="EFR32BG21BXXXF1024">XG21 - EFR32BG21BXXXF1024</MenuItem>
                  <MenuItem value="EFR32ZG23B020F512">XG23 - EFR32ZG23B020F512</MenuItem>
                  <MenuItem value="EFR32MG24B220F1536">XG24 - EFR32MG24B220F1536</MenuItem>
                  <MenuItem value="EFR32FG25B222F1920">XG25 - EFR32FG25B222F1920</MenuItem>
                  <MenuItem value="EFR32ZG28B312F1024">XG28 - EFR32ZG28B312F1024</MenuItem>
                </Select>
              </FormControl>
              <Tooltip title={isScanning ? 'Scanning...' : 'Refresh devices'}>
                <span>
                  <IconButton 
                    size="small" 
                    onClick={scanSilabsDevices}
                    disabled={isScanning}
                    sx={{ color: isScanning ? '#666' : '#aaa', '&:hover': { color: '#fff' } }}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </CardContent>
        </PathCard>

        <PathCard>
          <CardContent sx={{ py: 0.3, px: 1.2, '&:last-child': { pb: 0.3 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 0 }}>
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
          <CardContent sx={{ py: 0.3, px: 1.2, '&:last-child': { pb: 0.3 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 0.4 }}>
              <SecurityIcon sx={{ color: '#9c27b0', fontSize: 16 }} />
              <Typography variant="subtitle2" fontWeight="bold" sx={{ color: '#fff', fontSize: '14px', flex: 1 }}>
                Credentials
              </Typography>
              <StatusChip 
                status={getPathStatus(credentialsPath)} 
                label={getPathStatus(credentialsPath) === 'ready' ? 'Ready' : 'Missing'} 
                size="small"
                sx={{ height: '20px', fontSize: '11px', fontWeight: 'bold', minWidth: '60px' }}
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
                <InputLabel id="silabs-s37-label" sx={{ color: '#ccc' }}>S37 File</InputLabel>
                <Select
                  labelId="silabs-s37-label"
                  value={selectedS37Path}
                  label="S37 File"
                  onChange={(e) => {
                    const newPath = e.target.value;
                    setSelectedS37Path(newPath);
                    setCredentialsPath({ full: newPath, trimmed: trimCertificatePath(newPath) });
                  }}
                  renderValue={(value) => value ? trimCertificatePath(value) : 'No .s37 selected'}
                  sx={{
                    color: '#fff',
                    '.MuiOutlinedInput-notchedOutline': { borderColor: '#555' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#777' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#90caf9' }
                  }}
                >
                  {s37Files.length === 0 && (
                    <MenuItem value="" disabled>No .s37 files found</MenuItem>
                  )}
                  {s37Files.map((f) => (
                    <MenuItem key={f.full} value={f.full}>{f.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              {!selectedS37Path && (
                <Box sx={{ ml: 1 }}>
                  <Button 
                    variant="outlined" 
                    size="small" 
                    onClick={async () => {
                      try {
                        if (!window?.electronAPI?.selectFile) {
                          updateConsoleOutput('<span style="color: #f44336; font-weight: bold;">❌ File picker not available.</span>\n');
                          return;
                        }
                        const selected = await window.electronAPI.selectFile();
                        if (!selected) return;
                        const isS37 = typeof selected === 'string' && /\.s37$/i.test(selected);
                        if (!isS37) {
                          updateConsoleOutput('<span style="color: #f44336; font-weight: bold;">❌ Please select a .s37 file.</span>\n');
                          return;
                        }
                        setSelectedS37Path(selected);
                        setCredentialsPath({ full: selected, trimmed: trimCertificatePath(selected) });
                        updateConsoleOutput(`<span style="color: #4caf50; font-weight: bold;">✅ Custom S37 selected:</span> ${selected}\n`);
                      } catch (error) {
                        updateConsoleOutput(`<span style=\"color: #f44336; font-weight: bold;\">❌ Error selecting file: ${error.message}</span>\\n`);
                      }
                    }}
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
                    Select Custom S37
                  </Button>
                </Box>
              )}
            </Box>
          </CardContent>
        </PathCard>
      </Box>

      {/* Console Output */}
      <ConsoleContainer sx={{ 
        flexGrow: 1,
        display: 'flex', 
        flexDirection: 'column',
        minHeight: '180px', // Reduced minimum height
        overflow: 'hidden'
      }}>
        <ConsoleHeader>
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#f44336' }} />
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#ff9800' }} />
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#4caf50' }} />
          
          <Typography variant="caption" sx={{ color: '#aaa', ml: 2 }}>
            Console Output
          </Typography>
          
          {/* Flashing Status in Console Header */}
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
            padding: '10px', // Reduced padding
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
        p: 0.8, // Reduced padding 
        backgroundColor: '#2a2a2a', 
        border: '1px solid #404040',
        borderRadius: 2,
        flexShrink: 0
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
              <Checkbox
                checked={eraseAllChecked}
                onChange={(e) => setEraseAllChecked(e.target.checked)}
                size="small"
                sx={{ 
                  color: '#ff9800',
                  '&.Mui-checked': { color: '#ff9800' }
                }}
              />
              <Box>
                <Typography sx={{ color: '#fff', fontWeight: 500, fontSize: '14px' }}>
                  Erase All
                </Typography>
                <Typography variant="caption" sx={{ color: '#aaa', fontSize: '11px' }}>
                  (Pageerase @userdata + Mass erase)
                </Typography>
              </Box>
            </Box>
            
          </Box>
          
          <Stack direction="row" spacing={1.2}>
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
                px: 2, // Reduced horizontal padding
                py: 0.6, // Reduced vertical padding
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
                px: 2, // Reduced horizontal padding
                py: 0.6, // Reduced vertical padding
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

export default SilabsFlashPage;
