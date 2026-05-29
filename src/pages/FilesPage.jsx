import React, { useState, useRef, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Button,
  Paper,
  Chip,
  CircularProgress,
  Tabs,
  Tab,
  ToggleButton,
  ToggleButtonGroup,
  alpha,
  useTheme,
  Fade,
  IconButton,
  Tooltip,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress
} from '@mui/material';
import { styled } from '@mui/material/styles';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import DevicesIcon from '@mui/icons-material/Devices';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ArchiveIcon from '@mui/icons-material/Archive';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import HistoryIcon from '@mui/icons-material/History';
import TerminalIcon from '@mui/icons-material/Terminal';
import ClearIcon from '@mui/icons-material/Clear';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SettingsIcon from '@mui/icons-material/Settings';
import UsbIcon from '@mui/icons-material/Usb';
import SendIcon from '@mui/icons-material/Send';
import GetAppIcon from '@mui/icons-material/GetApp';
import WifiIcon from '@mui/icons-material/Wifi';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import LinkIcon from '@mui/icons-material/Link';
// Removed AutorenewIcon as it's no longer used
// Removed auto-fallback toggle icons

// Simplified styled components
const MainContainer = styled(Box)(({ theme }) => ({
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  padding: theme.spacing(2),
  backgroundColor: theme.palette.background.default,
  overflow: 'hidden',
}));

const ContentCard = styled(Paper)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  padding: theme.spacing(2),
  borderRadius: 12,
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  boxShadow: theme.shadows[1],
  overflow: 'hidden',
}));

const ConsoleContainer = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  marginTop: theme.spacing(1.5),
  borderRadius: 8,
  overflow: 'hidden',
  backgroundColor: '#1e1e1e',
  border: `1px solid ${theme.palette.divider}`,
}));

const ConsoleHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(0.75, 1.5),
  backgroundColor: 'rgba(0, 0, 0, 0.4)',
  borderBottom: `1px solid rgba(255, 255, 255, 0.1)`,
  '& .console-title': {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    fontSize: '0.7rem',
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.6)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  '& .console-icon': {
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.5)',
  },
}));

const ConsoleOutput = styled(Box)(({ theme }) => ({
  flex: 1,
  padding: theme.spacing(1.5),
  color: '#d4d4d4',
  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  fontSize: '0.75rem',
  lineHeight: 1.5,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  minHeight: 0,
  '&::-webkit-scrollbar': {
    width: 6,
    height: 6,
  },
  '&::-webkit-scrollbar-track': {
    background: 'rgba(0, 0, 0, 0.1)',
  },
  '&::-webkit-scrollbar-thumb': {
    background: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 3,
    '&:hover': {
      background: 'rgba(255, 255, 255, 0.3)',
    },
  },
}));

const StatusChip = styled(Chip)(({ theme, status }) => ({
  borderRadius: 6,
  fontWeight: 500,
  height: 22,
  fontSize: '0.7rem',
  ...(status === 'success' && {
    backgroundColor: alpha(theme.palette.success.main, 0.1),
    color: theme.palette.success.main,
  }),
  ...(status === 'error' && {
    backgroundColor: alpha(theme.palette.error.main, 0.1),
    color: theme.palette.error.main,
  }),
  ...(status === 'warning' && {
    backgroundColor: alpha(theme.palette.warning.main, 0.1),
    color: theme.palette.warning.main,
  }),
}));

const CompactButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  padding: '6px 16px',
  fontWeight: 500,
  textTransform: 'none',
  fontSize: '0.8rem',
  minHeight: 36,
  boxShadow: 'none',
  '&:hover': {
    boxShadow: 'none',
  },
}));

const PathField = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(0.5),
  '& .path-label': {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: theme.palette.text.secondary,
  },
  '& .path-input-wrapper': {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: theme.palette.mode === 'dark' 
      ? 'rgba(255, 255, 255, 0.05)' 
      : 'rgba(0, 0, 0, 0.02)',
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    padding: theme.spacing(1),
    transition: 'all 0.2s',
    minHeight: 36,
    '&:hover': {
      borderColor: theme.palette.text.secondary,
    },
    '&:focus-within': {
      borderColor: theme.palette.primary.main,
      borderWidth: 2,
      padding: theme.spacing(0.875),
    },
  },
  '& .path-icon': {
    marginRight: theme.spacing(1),
    color: theme.palette.text.secondary,
    fontSize: '1rem',
    flexShrink: 0,
  },
  '& .path-input': {
    flex: 1,
    border: 'none',
    outline: 'none',
    backgroundColor: 'transparent',
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    fontSize: '0.75rem',
    color: theme.palette.text.primary,
    '&::placeholder': {
      color: theme.palette.text.disabled,
    },
    '&:disabled': {
      color: theme.palette.text.disabled,
      cursor: 'not-allowed',
    },
  },
}));

const DeviceToggle = styled(ToggleButtonGroup)(({ theme }) => ({
  height: 32,
  '& .MuiToggleButton-root': {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    padding: '4px 12px',
    textTransform: 'none',
    fontWeight: 500,
    fontSize: '0.75rem',
    color: theme.palette.text.secondary,
    '&.Mui-selected': {
      backgroundColor: theme.palette.action.selected,
      color: theme.palette.text.primary,
      borderColor: theme.palette.primary.main,
      '&:hover': {
        backgroundColor: theme.palette.action.selected,
      },
    },
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
    '&.Mui-disabled': {
      color: theme.palette.text.disabled,
    },
  },
}));

const CompactTabs = styled(Tabs)(({ theme }) => ({
  minHeight: 36,
  '& .MuiTabs-indicator': {
    height: 2,
  },
  '& .MuiTab-root': {
    textTransform: 'none',
    fontWeight: 500,
    fontSize: '0.8rem',
    minHeight: 36,
    padding: theme.spacing(0.75, 2),
    color: theme.palette.text.secondary,
    '&.Mui-selected': {
      color: theme.palette.primary.main,
    },
  },
}));

const TabPanel = ({ children, value, index }) => (
  <Box
    role="tabpanel"
    hidden={value !== index}
    sx={{ 
      flex: 1,
      display: value === index ? 'flex' : 'none', 
      flexDirection: 'column',
      minHeight: 0,
      mt: 1.5,
    }}
  >
    {value === index && children}
  </Box>
);

const StatusIndicator = styled(Box)(({ theme, status }) => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  ...(status === 'success' && {
    backgroundColor: theme.palette.success.main,
  }),
  ...(status === 'error' && {
    backgroundColor: theme.palette.error.main,
  }),
}));

// PathInput component moved outside to prevent re-creation on each render
const PathInput = ({ label, value, onChange, placeholder, icon, disabled }) => (
  <PathField>
    <Typography className="path-label">{label}</Typography>
    <Box className="path-input-wrapper">
      <Box className="path-icon">{icon}</Box>
      <input
        className="path-input"
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
      />
    </Box>
  </PathField>
);

function FilesPage() {
  const theme = useTheme();
  const [deviceType, setDeviceType] = useState('efd-fos');
  const [pullSourcePath, setPullSourcePath] = useState('/data/vendor/halo/var/log/');
  const [pullDestPath, setPullDestPath] = useState('');
  const [pushSourcePath, setPushSourcePath] = useState('');
  const [pushDestPath, setPushDestPath] = useState('/vendor/etc/halo_config/core-plugins/qa-touchstone.conf.d');
  const [pullOutput, setPullOutput] = useState('');
  const [pushOutput, setPushOutput] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [pullStatus, setPullStatus] = useState(null);
  const [pushStatus, setPushStatus] = useState(null);
  const [recentEfdPaths, setRecentEfdPaths] = useState([]);
  const [recentRfdPaths, setRecentRfdPaths] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  
  // RFD Serial Port States
  const [serialPorts, setSerialPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState(9600);
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [serialOutput, setSerialOutput] = useState('');
  const [serialFilePath, setSerialFilePath] = useState('');
  const [serialReceivePath, setSerialReceivePath] = useState('');
  const [rfdPushDestPath, setRfdPushDestPath] = useState('/tmp/'); // Separate state for RFD push destination
  const [isSerialTransferring, setIsSerialTransferring] = useState(false);
  const [serialTransferProgress, setSerialTransferProgress] = useState(0);
  const [showSerialConfig, setShowSerialConfig] = useState(false);
  const [serialStatus, setSerialStatus] = useState(null);
  
  // RFD Network States
  const [rfdTransferMode, setRfdTransferMode] = useState('serial'); // 'serial' or 'network'
  const [rfdIpAddress, setRfdIpAddress] = useState('');
  const [rfdUsername, setRfdUsername] = useState('root');
  const [rfdPassword, setRfdPassword] = useState('');
  const [isNetworkConnected, setIsNetworkConnected] = useState(false);
  const [showNetworkConfig, setShowNetworkConfig] = useState(false);
  const [networkStatus, setNetworkStatus] = useState(null);
  // Removed auto fallback functionality
  
  // Network Device Discovery States
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [manualSubnet, setManualSubnet] = useState('192.168.50');
  
  const pullOutputRef = useRef(null);
  const pushOutputRef = useRef(null);
  const serialOutputRef = useRef(null);
  
  // Debounce mechanism for button clicks
  const lastClickTime = useRef(0);

  // Load recent paths from local storage
  useEffect(() => {
    const savedEfd = localStorage.getItem('recentEfdFilePaths');
    if (savedEfd) {
      try {
        setRecentEfdPaths(JSON.parse(savedEfd));
      } catch (error) {
        console.error('Error parsing EFD paths from localStorage:', error);
        // Clear invalid data
        localStorage.removeItem('recentEfdFilePaths');
        setRecentEfdPaths([]);
      }
    }
    
    const savedRfd = localStorage.getItem('recentRfdFilePaths');
    if (savedRfd) {
      try {
        setRecentRfdPaths(JSON.parse(savedRfd));
      } catch (error) {
        console.error('Error parsing RFD paths from localStorage:', error);
        // Clear invalid data
        localStorage.removeItem('recentRfdFilePaths');
        setRecentRfdPaths([]);
      }
    }
  }, []);

  // Load available serial ports
  useEffect(() => {
    const loadSerialPorts = async () => {
      try {
        const ports = await window.electronAPI.listSerialPorts();
        setSerialPorts(ports);
      } catch (error) {
        console.error('Error loading serial ports:', error);
      }
    };
    loadSerialPorts();
  }, []);

  // Setup serial port event listeners
  useEffect(() => {
    let lastSerialData = '';
    let lastProgressMessage = '';
    let lastDataTimestamp = 0;
    let displayedMessages = new Set(); // Track all displayed messages
    
    const handleSerialData = (data) => {
      // More aggressive duplicate prevention for serial data with timestamp
      const now = Date.now();
      const cleanData = data.trim();
      
      // Prevent rapid duplicate data within 100ms
      if (cleanData && 
          (cleanData !== lastSerialData.trim() || now - lastDataTimestamp > 100)) {
        setSerialOutput(prev => prev + data);
        scrollToBottom(serialOutputRef);
        lastSerialData = data;
        lastDataTimestamp = now;
      }
    };

    const handleSerialError = (error) => {
      setSerialOutput(prev => prev + `\n❌ Serial Error: ${error}\n`);
      scrollToBottom(serialOutputRef);
    };

    const handleSerialProgress = (progress) => {
      // Ultra-aggressive duplicate prevention using Set
      const messageKey = `${progress.status}:${progress.message}`;
      
      // Only process if we haven't displayed this exact message before
      if (!displayedMessages.has(messageKey)) {
        console.log(`[DEBUG] UI received NEW progress: ${progress.message}`, progress);
        
        displayedMessages.add(messageKey);
        
        // Handle different progress status types
        if (progress.status === 'completed') {
          setSerialOutput(prev => prev + `✅ ${progress.message}\n`);
        } else if (progress.status === 'error') {
          setSerialOutput(prev => prev + `❌ ${progress.message}\n`);
        } else {
          setSerialOutput(prev => prev + `📡 ${progress.message}\n`);
        }
        
        lastProgressMessage = progress.message;
      } else {
        console.log(`[DEBUG] DUPLICATE progress message completely blocked: ${progress.message}`);
      }
      
      if (progress.percentage !== undefined && progress.percentage !== null) {
        console.log(`[DEBUG] Setting progress to: ${progress.percentage}%`);
        setSerialTransferProgress(progress.percentage);
      }
      scrollToBottom(serialOutputRef);
    };
    
    // Expose reset function for new transfers
    window.resetSerialProgressTracking = () => {
      lastProgressMessage = '';
      displayedMessages.clear();
      console.log('[DEBUG] Progress tracking reset for new transfer - cleared message set');
    };

    // Remove any existing listeners first to prevent duplicates
    window.electronAPI.removeSerialDataListener?.(handleSerialData);
    window.electronAPI.removeSerialErrorListener?.(handleSerialError);
    window.electronAPI.removeSerialProgressListener?.(handleSerialProgress);
    
    window.electronAPI.onSerialDataReceived(handleSerialData);
    window.electronAPI.onSerialError(handleSerialError);
    window.electronAPI.onSerialProgress(handleSerialProgress);

    return () => {
      // Remove global reset function
      delete window.resetSerialProgressTracking;
      window.electronAPI.removeSerialDataListener(handleSerialData);
      window.electronAPI.removeSerialErrorListener(handleSerialError);
      window.electronAPI.removeSerialProgressListener(handleSerialProgress);
    };
  }, []);

  const saveRecentPath = (path, deviceType) => {
    if (deviceType === 'rfd') {
      const updated = [path, ...recentRfdPaths.filter(p => p !== path)].slice(0, 3);
      setRecentRfdPaths(updated);
      localStorage.setItem('recentRfdFilePaths', JSON.stringify(updated));
    } else {
      // EFD devices (both FOS and Vega)
      const updated = [path, ...recentEfdPaths.filter(p => p !== path)].slice(0, 3);
      setRecentEfdPaths(updated);
      localStorage.setItem('recentEfdFilePaths', JSON.stringify(updated));
    }
  };

  const handleDeviceTypeChange = (event, newDeviceType) => {
    if (newDeviceType !== null) {
      setDeviceType(newDeviceType);
      
      if (newDeviceType === 'efd-fos') {
        setPullSourcePath('/data/vendor/halo/var/log/');
        setPushDestPath('/vendor/etc/halo_config/core-plugins/qa-touchstone.conf.d');
        // If currently on serial tabs, switch to pull files tab
        if (activeTab === 2 || activeTab === 3) {
          setActiveTab(0);
        }
      } else if (newDeviceType === 'efd-vega') {
        setPullSourcePath('/var/lib/data/halo/var/log/');
        setPushDestPath('/etc/halo_config/core-plugins/qa-touchstone.conf.d');
        // If currently on serial tabs, switch to pull files tab
        if (activeTab === 2 || activeTab === 3) {
          setActiveTab(0);
        }
      } else if (newDeviceType === 'rfd') {
        // RFD device selected - serial port based
        setPullSourcePath('/var/log');
        setPushDestPath(''); // Clear destination path for RFD
        setActiveTab(2); // Switch to serial pull tab
      }
    }
  };

  const handleSelectPullDestFolder = async () => {
    const selectedPath = await window.electronAPI.selectDirectory();
    if (selectedPath) {
      setPullDestPath(selectedPath);
      saveRecentPath(selectedPath, deviceType);
    }
  };

  const handleSelectPushSourceFile = async () => {
    const selectedPath = await window.electronAPI.selectFile();
    if (selectedPath) {
      setPushSourcePath(selectedPath);
    }
  };

  const scrollToBottom = (ref) => {
    if (ref.current) {
      setTimeout(() => {
        ref.current.scrollTop = ref.current.scrollHeight;
      }, 0);
    }
  };

  const handlePullFiles = async () => {
    if (!pullSourcePath || !pullDestPath) {
      setPullOutput('❌ Please specify both source path and destination folder\n');
      setPullStatus('error');
      scrollToBottom(pullOutputRef);
      return;
    }

    setIsPulling(true);
    setPullStatus(null);
    setPullOutput('🚀 Starting file pull process...\n');
    scrollToBottom(pullOutputRef);

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const tarFileName = `logs_${timestamp}.tgz`;
      const tempPath = `/data/local/tmp/${tarFileName}`;
      
      setPullOutput(prev => prev + `\n📦 Creating archive: ${tarFileName}\n`);
      scrollToBottom(pullOutputRef);
      
      const tarCommand = `adb shell "cd '${pullSourcePath}' && tar -czf '${tempPath}' *"`;
      
      await window.electronAPI.runCommandWithRealTimeOutput(
        tarCommand,
        null,
        (output) => {
          setPullOutput(prev => prev + output);
          scrollToBottom(pullOutputRef);
        }
      );

      setPullOutput(prev => prev + `\n⬇️ Downloading to destination...\n`);
      scrollToBottom(pullOutputRef);
      
      const pullCommand = `adb pull "${tempPath}" "${pullDestPath}/${tarFileName}"`;
      
      await window.electronAPI.runCommandWithRealTimeOutput(
        pullCommand,
        null,
        (output) => {
          setPullOutput(prev => prev + output);
          scrollToBottom(pullOutputRef);
        }
      );

      setPullOutput(prev => prev + `\n🧹 Cleaning up temporary files...\n`);
      scrollToBottom(pullOutputRef);
      
      const cleanupCommand = `adb shell "rm -f '${tempPath}'"`;
      
      await window.electronAPI.runCommandWithRealTimeOutput(
        cleanupCommand,
        null,
        (output) => {
          setPullOutput(prev => prev + output);
          scrollToBottom(pullOutputRef);
        }
      );

      setPullOutput(prev => prev + `\n✅ Success! Files saved to: ${pullDestPath}/${tarFileName}\n`);
      setPullStatus('success');
      scrollToBottom(pullOutputRef);
    } catch (error) {
      setPullOutput(prev => prev + `\n❌ Error: ${error.message}\n`);
      setPullStatus('error');
      scrollToBottom(pullOutputRef);
    } finally {
      setIsPulling(false);
    }
  };

  const handlePushFiles = async () => {
    if (!pushSourcePath || !pushDestPath) {
      setPushOutput('❌ Please specify both source file and destination path\n');
      setPushStatus('error');
      scrollToBottom(pushOutputRef);
      return;
    }

    setIsPushing(true);
    setPushStatus(null);
    setPushOutput('🚀 Starting file push process...\n');
    scrollToBottom(pushOutputRef);

    try {
      setPushOutput(prev => prev + '🔓 Remounting system as read-write...\n');
      scrollToBottom(pushOutputRef);
      
      const remountCommand = 'adb remount';
      
      await window.electronAPI.runCommandWithRealTimeOutput(
        remountCommand,
        null,
        (output) => {
          setPushOutput(prev => prev + output);
          scrollToBottom(pushOutputRef);
        }
      );

      setPushOutput(prev => prev + '\n⬆️ Pushing file to device...\n');
      scrollToBottom(pushOutputRef);
      
      const pushCommand = `adb push "${pushSourcePath}" "${pushDestPath}"`;
      
      await window.electronAPI.runCommandWithRealTimeOutput(
        pushCommand,
        null,
        (output) => {
          setPushOutput(prev => prev + output);
          scrollToBottom(pushOutputRef);
        }
      );

      setPushOutput(prev => prev + '\n✅ File pushed successfully!\n');
      setPushStatus('success');
      scrollToBottom(pushOutputRef);
    } catch (error) {
      setPushOutput(prev => prev + `\n❌ Error: ${error.message}\n`);
      setPushStatus('error');
      scrollToBottom(pushOutputRef);
    } finally {
      setIsPushing(false);
    }
  };

  const handleClearOutput = (type) => {
    if (type === 'pull') {
      setPullOutput('');
      setPullStatus(null);
    } else {
      setPushOutput('');
      setPushStatus(null);
    }
  };

  const handleCopyOutput = (type) => {
    const output = type === 'pull' ? pullOutput : (type === 'push' ? pushOutput : serialOutput);
    navigator.clipboard.writeText(output);
  };

  // Serial port connection functions
  const handleSerialConnect = async () => {
    if (!selectedPort) {
      setSerialOutput('❌ Please select a serial port first\n');
      scrollToBottom(serialOutputRef);
      return;
    }
    
    try {
      setSerialOutput('🔌 Connecting to serial port...\n');
      
      // Configure serial port
      await window.electronAPI.configureSerialPort({
        port: selectedPort,
        baudRate: baudRate
      });
      
      // Open connection
      const result = await window.electronAPI.openSerialPort(selectedPort);
      
      if (result.success) {
        setIsSerialConnected(true);
        setSerialStatus('success');
        setSerialOutput(prev => prev + `✅ Connected to ${selectedPort} at ${baudRate} baud\n`);
        
        // Start listening for data
        await window.electronAPI.startSerialListening();
      } else {
        setSerialStatus('error');
        setSerialOutput(prev => prev + `❌ Failed to connect: ${result.error}\n`);
      }
    } catch (error) {
      setSerialStatus('error');
      setSerialOutput(prev => prev + `❌ Connection error: ${error.message}\n`);
    }
    scrollToBottom(serialOutputRef);
  };

  const handleSerialDisconnect = async () => {
    try {
      setSerialOutput(prev => prev + '🔌 Disconnecting from serial port...\n');
      
      const result = await window.electronAPI.closeSerialPort();
      
      if (result.success) {
        setIsSerialConnected(false);
        setSerialStatus(null);
        setSerialOutput(prev => prev + '✅ Disconnected successfully\n');
      } else {
        setSerialOutput(prev => prev + `❌ Disconnect error: ${result.error}\n`);
      }
    } catch (error) {
      setSerialOutput(prev => prev + `❌ Disconnect error: ${error.message}\n`);
    }
    scrollToBottom(serialOutputRef);
  };

  const handleSerialSendFile = async () => {
    if (!serialFilePath || !rfdPushDestPath) {
      setSerialOutput(prev => prev + '❌ Please select a file to send and specify destination path\n');
      scrollToBottom(serialOutputRef);
      return;
    }

    try {
      setIsSerialTransferring(true);
      setSerialTransferProgress(0);
      
      // Reset progress message tracking for new transfer
      if (window.resetSerialProgressTracking) {
        window.resetSerialProgressTracking();
      }
      
      // Show helpful info about path handling
      const fileName = serialFilePath.split(/[/\\]/).pop();
      if (rfdPushDestPath.endsWith('/') || (!rfdPushDestPath.includes('.') && !rfdPushDestPath.includes(fileName))) {
        setSerialOutput(prev => prev + `📁 Destination is a directory, will create: ${rfdPushDestPath.endsWith('/') ? rfdPushDestPath + fileName : rfdPushDestPath + '/' + fileName}\n`);
      }
      
      setSerialOutput(prev => prev + `📤 Sending file: ${serialFilePath} -> ${rfdPushDestPath}\n`);
      
      const result = await window.electronAPI.sendFileSerial(serialFilePath, rfdPushDestPath);
      
      if (result.success) {
        setSerialStatus('success');
        // Success message is now handled by progress events for correct order
      } else {
        setSerialStatus('error');
        // Error message is now handled by progress events for correct order
        if (result.error.includes('Is a directory')) {
          setSerialOutput(prev => prev + '💡 Tip: Use a directory path like /tmp/ or specify full file path like /tmp/filename.conf\n');
        }
      }
    } catch (error) {
      setSerialStatus('error');
      setSerialOutput(prev => prev + `❌ Send error: ${error.message}\n`);
    } finally {
      setIsSerialTransferring(false);
      // Reset progress after a short delay to show completion
      setTimeout(() => {
        setSerialTransferProgress(0);
      }, 2000);
    }
    scrollToBottom(serialOutputRef);
  };

  const handleSerialReceiveFile = async () => {
    if (!serialReceivePath || !pullSourcePath) {
      setSerialOutput(prev => prev + '❌ Please select a save location and specify source path\n');
      scrollToBottom(serialOutputRef);
      return;
    }

    // Prevent multiple concurrent calls
    if (isSerialTransferring) {
      setSerialOutput(prev => prev + '⚠️ Transfer already in progress, please wait...\n');
      scrollToBottom(serialOutputRef);
      return;
    }

    try {
      setIsSerialTransferring(true);
      setSerialTransferProgress(0);
      setSerialOutput(prev => prev + `📥 Receiving: ${pullSourcePath} -> ${serialReceivePath}\n`);
      
      // Determine if it's a directory or file
      const isDirectory = pullSourcePath.endsWith('/') || !pullSourcePath.includes('.');
      
      if (isDirectory) {
        setSerialOutput(prev => prev + `📁 Downloading directory contents individually...\n`);
      } else {
        const fileName = pullSourcePath.split('/').pop() || 'received_file.txt';
        setSerialOutput(prev => prev + `📄 Downloading file: ${fileName}\n`);
      }
      
      const result = await window.electronAPI.receiveFileSerial(serialReceivePath, pullSourcePath);
      
      if (result.success) {
        setSerialStatus('success');
        if (isDirectory) {
          setSerialOutput(prev => prev + `✅ Directory download completed\n`);
          setSerialOutput(prev => prev + `📊 Downloaded ${result.fileCount || 0} out of ${result.totalFiles || 0} files\n`);
          if (result.comCatFolder) {
            setSerialOutput(prev => prev + `📁 Files saved to com_cat folder: ${result.comCatFolder}\n`);
          } else {
            setSerialOutput(prev => prev + `📁 Files saved to: ${serialReceivePath}\n`);
          }
        } else {
          setSerialOutput(prev => prev + `✅ File received successfully (${result.size} bytes)\n`);
          
          // Show file verification info if available
          if (result.expectedSize !== undefined) {
            if (result.verified) {
              setSerialOutput(prev => prev + `✅ File integrity verified (${result.expectedSize} bytes)\n`);
            } else {
              setSerialOutput(prev => prev + `⚠️ File size mismatch: expected ${result.expectedSize}, got ${result.size} bytes\n`);
            }
          }
          
          if (result.comCatFolder) {
            setSerialOutput(prev => prev + `📁 Saved to com_cat folder: ${result.comCatFolder}\n`);
          } else {
            setSerialOutput(prev => prev + `📁 Saved to: ${result.filePath}\n`);
          }
        }
      } else {
        setSerialStatus('error');
        setSerialOutput(prev => prev + `❌ Receive failed: ${result.error}\n`);
      }
    } catch (error) {
      setSerialStatus('error');
      setSerialOutput(prev => prev + `❌ Receive error: ${error.message}\n`);
    } finally {
      setIsSerialTransferring(false);
      // Reset progress after a short delay to show completion
      setTimeout(() => {
        setSerialTransferProgress(0);
      }, 2000);
    }
    scrollToBottom(serialOutputRef);
  };

  const handleSelectSerialFile = async () => {
    const selectedPath = await window.electronAPI.selectFile();
    if (selectedPath) {
      setSerialFilePath(selectedPath);
    }
  };

  const handleSelectSerialReceivePath = async () => {
    const selectedPath = await window.electronAPI.selectDirectory();
    if (selectedPath) {
      setSerialReceivePath(selectedPath);
      saveRecentPath(selectedPath, 'rfd');
    }
  };

  // Network connection functions for RFD
  const handleNetworkConnect = async () => {
    if (!rfdIpAddress || !rfdUsername) {
      setSerialOutput(prev => prev + '❌ Please enter IP address and username\n');
      scrollToBottom(serialOutputRef);
      return;
    }
    
    // Debug logging
    console.log('[Network Connect] Attempting connection with:', {
      ip: rfdIpAddress,
      username: rfdUsername,
      selectedDevice: selectedDevice?.hostname
    });

    try {
      const deviceName = selectedDevice?.hostname || `device at ${rfdIpAddress}`;
      setSerialOutput(prev => prev + `🌐 Connecting to ${deviceName}...\n`);
      
      // Test SSH connection
      const testCommand = `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${rfdUsername}@${rfdIpAddress} "echo 'Connection test successful' && hostname"`;
      
      const result = await window.electronAPI.runCommandWithRealTimeOutput(
        testCommand,
        null,
        (output) => {
          setSerialOutput(prev => prev + output);
          scrollToBottom(serialOutputRef);
        }
      );
      
      if (result === 0) {
        setIsNetworkConnected(true);
        setNetworkStatus('success');
        setSerialOutput(prev => prev + `✅ Connected to ${deviceName}\n`);
        setSerialOutput(prev => prev + `🔗 Ready for file transfers via SSH/SCP\n`);
      } else {
        setNetworkStatus('error');
        setSerialOutput(prev => prev + `❌ Failed to connect to ${deviceName}\n`);
        setSerialOutput(prev => prev + `   Check SSH key configuration and network connectivity\n`);
      }
    } catch (error) {
      setNetworkStatus('error');
      setSerialOutput(prev => prev + `❌ Connection error: ${error.message}\n`);
    }
    scrollToBottom(serialOutputRef);
  };

  const handleNetworkDisconnect = () => {
    setIsNetworkConnected(false);
    setNetworkStatus(null);
    setSerialOutput(prev => prev + '🌐 Disconnected from network\n');
    scrollToBottom(serialOutputRef);
  };

  // Network device discovery function
  const handleScanNetworkDevices = async () => {
    setIsScanning(true);
    setSerialOutput(prev => prev + '🔍 Scanning network for devices...\n');
    if (manualSubnet) {
      setSerialOutput(prev => prev + `📡 Using manual subnet: ${manualSubnet}.0/24\n`);
    }
    scrollToBottom(serialOutputRef);
    
    try {
      const devices = await window.electronAPI.scanNetworkDevices(manualSubnet || null);
      
      if (devices.length > 0) {
        setDiscoveredDevices(devices);
        setSerialOutput(prev => prev + `✅ Found ${devices.length} device(s):\n`);
        devices.forEach(device => {
          setSerialOutput(prev => prev + `  • ${device.hostname} (${device.ip})\n`);
        });
      } else {
        setSerialOutput(prev => prev + '⚠️ No devices found on the network\n');
        setDiscoveredDevices([]);
      }
    } catch (error) {
      setSerialOutput(prev => prev + `❌ Scan error: ${error.message}\n`);
    } finally {
      setIsScanning(false);
      scrollToBottom(serialOutputRef);
    }
  };

  // Handle device selection from discovered devices
  const handleSelectDevice = async (device) => {
    console.log('[Device Selection] Selecting device:', device);
    setSelectedDevice(device);
    setRfdIpAddress(device.ip);
    setRfdTransferMode('network'); // Automatically switch to network mode
    setSerialOutput(prev => prev + `📱 Selected device: ${device.hostname} (${device.ip})\n`);
    setSerialOutput(prev => prev + `🔄 Switched to network transfer mode\n`);
    console.log('[Device Selection] State updated:', { device, ip: device.ip, mode: 'network' });
    
    // Test SSH connection
    setSerialOutput(prev => prev + `🔐 Testing SSH connection to ${device.ip}...\n`);
    scrollToBottom(serialOutputRef);
    
    try {
      const result = await window.electronAPI.testSshConnection({ 
        ip: device.ip, 
        username: rfdUsername 
      });
      
      if (result.success) {
        setSerialOutput(prev => prev + `✅ SSH connection test successful\n`);
        if (result.hostname) {
          setSerialOutput(prev => prev + `   Device hostname: ${result.hostname}\n`);
        }
      } else {
        setSerialOutput(prev => prev + `⚠️ SSH connection test failed: ${result.error}\n`);
        setSerialOutput(prev => prev + `   Make sure SSH key is configured for ${rfdUsername}@${device.ip}\n`);
      }
    } catch (error) {
      setSerialOutput(prev => prev + `❌ Connection test error: ${error.message}\n`);
    }
    
    scrollToBottom(serialOutputRef);
  };

  // Add helper function to check if rsync is available
  const checkRsyncAvailable = async () => {
    try {
      const result = await window.electronAPI.runCommandWithRealTimeOutput(
        'rsync --version',
        null,
        () => {} // Empty callback
      );
      return result === 0;
    } catch (error) {
      return false;
    }
  };

  const handleNetworkPullFiles = async () => {
    if (!isNetworkConnected || !pullSourcePath || !serialReceivePath) {
      setSerialOutput(prev => prev + '❌ Please ensure network connection and paths are set\n');
      scrollToBottom(serialOutputRef);
      return;
    }

    try {
      setIsSerialTransferring(true);
      setSerialTransferProgress(5); // Start with 5% to show activity
      setSerialOutput(prev => prev + `📥 Pulling files from ${pullSourcePath} via network...\n`);
      
      // Check if rsync is available
      const isRsyncAvailable = await checkRsyncAvailable();
      if (!isRsyncAvailable) {
        setSerialOutput(prev => prev + `⚠️ rsync not available, falling back to SCP\n`);
      }
      
      // Check if pullSourcePath is a directory or file
      const isDirectory = pullSourcePath.endsWith('/') || !pullSourcePath.includes('.');
      
      // Prepare for transfer
      if (isDirectory) {
        setSerialOutput(prev => prev + `📁 Preparing directory transfer...\n`);
        setSerialTransferProgress(10); // 10% - preparing
      }
      
      if (isDirectory) {
        // Create timestamped folder for this pull operation
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        const timestampedFolderName = `${isRsyncAvailable ? 'rsync' : 'scp'}_${timestamp}`;
        
        // Check if serialReceivePath already contains a timestamped folder
        const pathParts = serialReceivePath.split(/[/\\]/);
        const lastPart = pathParts[pathParts.length - 1];
        const isAlreadyTimestamped = (lastPart.startsWith('rsync_') || lastPart.startsWith('scp_')) && 
          lastPart.match(/(rsync|scp)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/);
        
        // If already in a timestamped folder, use parent directory
        const currentPlatform = window.electronAPI.getPlatform();
        const pathSeparator = currentPlatform === 'win32' ? '\\' : '/';
        const basePath = isAlreadyTimestamped ? pathParts.slice(0, -1).join(pathSeparator) : serialReceivePath;
        const timestampedFolderPath = `${basePath}${pathSeparator}${timestampedFolderName}`;
        
        if (isAlreadyTimestamped) {
          setSerialOutput(prev => prev + `🔄 Detected nested timestamp folder, using parent directory\n`);
        }
        
        setSerialOutput(prev => prev + `📁 Creating timestamped folder: ${timestampedFolderName}\n`);
        setSerialTransferProgress(15); // 15% - folder creation
        
        // Create the timestamped directory locally
        const mkdirCommand = currentPlatform === 'win32' 
          ? `if not exist "${timestampedFolderPath}" mkdir "${timestampedFolderPath}"` 
          : `mkdir -p "${timestampedFolderPath}"`;
        
        const mkdirResult = await window.electronAPI.runCommandWithRealTimeOutput(
          mkdirCommand,
          null,
          (output) => {
            setSerialOutput(prev => prev + output);
            scrollToBottom(serialOutputRef);
          }
        );
        
        if (mkdirResult !== 0) {
          setSerialStatus('error');
          setSerialOutput(prev => prev + `❌ Failed to create timestamped folder\n`);
          return;
        }

        
        // First, check if source directory exists and list its contents
        const checkCommand = `ssh -o StrictHostKeyChecking=no ${rfdUsername}@${rfdIpAddress} "ls -la '${pullSourcePath}' 2>/dev/null || echo 'DIRECTORY_NOT_FOUND'"`;
        
        setSerialOutput(prev => prev + `🔍 Checking source directory: ${pullSourcePath}\n`);
        setSerialTransferProgress(20); // 20% - checking source
        
        const checkResult = await window.electronAPI.runCommandWithRealTimeOutput(
          checkCommand,
          null,
          (output) => {
            setSerialOutput(prev => prev + output);
            scrollToBottom(serialOutputRef);
          }
        );
        
        if (checkResult !== 0) {
          setSerialStatus('error');
          setSerialOutput(prev => prev + `❌ Failed to access source directory\n`);
          return;
        }
        
        // Choose command based on rsync availability
        const normalizedSourcePath = pullSourcePath.endsWith('/') ? pullSourcePath : `${pullSourcePath}/`;
        let transferCommand;
        
        if (isRsyncAvailable) {
          transferCommand = `rsync -avz --progress --stats -e "ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=60" ${rfdUsername}@${rfdIpAddress}:"${normalizedSourcePath}" "${timestampedFolderPath}/"`;
          setSerialOutput(prev => prev + `📡 Executing rsync command: ${transferCommand}\n`);
        } else {
          transferCommand = `scp -r -p -v -o StrictHostKeyChecking=no -o ServerAliveInterval=60 ${rfdUsername}@${rfdIpAddress}:"${normalizedSourcePath}*" "${timestampedFolderPath}/"`;
          setSerialOutput(prev => prev + `📡 Executing SCP command (with verbose): ${transferCommand}\n`);
        }
        
        setSerialTransferProgress(25); // 25% - starting transfer
        
        let lastProgressUpdate = 25;
        
        // Add a timer for smooth progress updates when no specific progress is detected
        const progressInterval = setInterval(() => {
          if (lastProgressUpdate < 90) {
            const incrementalProgress = Math.min(lastProgressUpdate + 1, 90);
            setSerialTransferProgress(incrementalProgress);
            lastProgressUpdate = incrementalProgress;
          }
        }, isRsyncAvailable ? 3000 : 2000); // Slower for rsync, faster for SCP
        
        const result = await window.electronAPI.runCommandWithRealTimeOutput(
          transferCommand,
          null,
          (output) => {
            setSerialOutput(prev => prev + output);
            scrollToBottom(serialOutputRef);
            
            if (isRsyncAvailable) {
              // Parse rsync output for progress
              const progressMatch = output.match(/\s+(\d+)%/);
              if (progressMatch) {
                const rsyncPercent = parseInt(progressMatch[1]);
                // Map rsync percentage (0-100%) to our progress range (25-95%)
                const progress = 25 + Math.round((rsyncPercent / 100) * 70);
                
                if (progress > lastProgressUpdate) {
                  setSerialTransferProgress(Math.min(progress, 95));
                  lastProgressUpdate = progress;
                }
              }
              // Also look for file transfer indicators
              else if (output.includes('receiving file list') || output.includes('receiving incremental file list')) {
                if (lastProgressUpdate < 30) {
                  setSerialTransferProgress(30);
                  lastProgressUpdate = 30;
                }
              }
              // Look for transfer completion indicators
              else if (output.includes('sent ') && output.includes('received ') && output.includes('bytes/sec')) {
                setSerialTransferProgress(95);
                lastProgressUpdate = 95;
              }
              // Look for speed indicators to show active transfer
              else if (output.includes('MB/s') || output.includes('KB/s') || output.includes('GB/s')) {
                const incrementalProgress = Math.min(lastProgressUpdate + Math.floor(Math.random() * 2) + 1, 90);
                if (incrementalProgress > lastProgressUpdate) {
                  setSerialTransferProgress(incrementalProgress);
                  lastProgressUpdate = incrementalProgress;
                }
              }
            } else {
              // Parse SCP output for progress (fallback)
              if (output.includes('%')) {
                const percentMatch = output.match(/(\d+)%/);
                if (percentMatch) {
                  const scpPercent = parseInt(percentMatch[1]);
                  const progress = 25 + Math.round((scpPercent / 100) * 70);
                  
                  if (progress > lastProgressUpdate) {
                    setSerialTransferProgress(Math.min(progress, 95));
                    lastProgressUpdate = progress;
                  }
                }
              } else if (output.includes('ETA') || output.includes('KB/s') || output.includes('MB/s')) {
                const incrementalProgress = Math.min(lastProgressUpdate + Math.floor(Math.random() * 3) + 1, 90);
                if (incrementalProgress > lastProgressUpdate) {
                  setSerialTransferProgress(incrementalProgress);
                  lastProgressUpdate = incrementalProgress;
                }
              }
            }
          }
        );
        
        // Clear the progress interval
        clearInterval(progressInterval);
        
        if (result === 0) {
          setSerialStatus('success');
          setSerialTransferProgress(100); // 100% - complete
          setSerialOutput(prev => prev + `✅ Directory files pulled successfully to ${timestampedFolderPath}\n`);
          setSerialOutput(prev => prev + `📂 Files organized in timestamped folder: ${timestampedFolderName}\n`);
          
          // Verify transferred files
          const currentPlatform = window.electronAPI.getPlatform ? window.electronAPI.getPlatform() : process.platform;
          const verifyCommand = currentPlatform === 'win32'
            ? `powershell -Command "Get-ChildItem -Path '${timestampedFolderPath}' -Recurse -File | Select-Object FullName, Length, LastWriteTime"`
            : `find "${timestampedFolderPath}" -type f -exec ls -la {} \\;`;
          
          setSerialOutput(prev => prev + `🔍 Verifying transferred files...\n`);
          
          await window.electronAPI.runCommandWithRealTimeOutput(
            verifyCommand,
            null,
            (output) => {
              setSerialOutput(prev => prev + output);
              scrollToBottom(serialOutputRef);
            }
          );
        } else {
          setSerialStatus('error');
          setSerialOutput(prev => prev + `❌ Failed to copy directory files from device\n`);
        }
      } else {
        // Clear the progress interval in case of error
        clearInterval(progressInterval);
        // Handle single file
        const fileName = pullSourcePath.split('/').pop() || 'received_file';
        
        // Create timestamped folder for single file as well
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        const timestampedFolderName = `${isRsyncAvailable ? 'rsync' : 'scp'}_${timestamp}`;
        
        // Check if serialReceivePath already contains a timestamped folder
        const pathParts = serialReceivePath.split(/[/\\]/);
        const lastPart = pathParts[pathParts.length - 1];
        const isAlreadyTimestamped = (lastPart.startsWith('rsync_') || lastPart.startsWith('scp_')) && 
          lastPart.match(/(rsync|scp)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/);
        
        // If already in a timestamped folder, use parent directory
        const currentPlatform2 = window.electronAPI.getPlatform();
        const pathSeparator2 = currentPlatform2 === 'win32' ? '\\' : '/';
        const basePath = isAlreadyTimestamped ? pathParts.slice(0, -1).join(pathSeparator2) : serialReceivePath;
        const timestampedFolderPath = `${basePath}${pathSeparator2}${timestampedFolderName}`;
        
        if (isAlreadyTimestamped) {
          setSerialOutput(prev => prev + `🔄 Detected nested timestamp folder, using parent directory\n`);
        }
        
        setSerialOutput(prev => prev + `📁 Creating timestamped folder: ${timestampedFolderName}\n`);
        
        // Create the timestamped directory locally
        const mkdirCommand = currentPlatform2 === 'win32' 
          ? `if not exist "${timestampedFolderPath}" mkdir "${timestampedFolderPath}"` 
          : `mkdir -p "${timestampedFolderPath}"`;
        
        const mkdirResult = await window.electronAPI.runCommandWithRealTimeOutput(
          mkdirCommand,
          null,
          (output) => {
            setSerialOutput(prev => prev + output);
            scrollToBottom(serialOutputRef);
          }
        );
        
        if (mkdirResult !== 0) {
          setSerialStatus('error');
          setSerialOutput(prev => prev + `❌ Failed to create timestamped folder\n`);
          return;
        }
        
        // First check if file exists and get its info
        const checkCommand = `ssh -o StrictHostKeyChecking=no ${rfdUsername}@${rfdIpAddress} "ls -la '${pullSourcePath}' 2>/dev/null || echo 'FILE_NOT_FOUND'"`;
        
        setSerialOutput(prev => prev + `🔍 Checking source file: ${pullSourcePath}\n`);
        
        const checkResult = await window.electronAPI.runCommandWithRealTimeOutput(
          checkCommand,
          null,
          (output) => {
            setSerialOutput(prev => prev + output);
            scrollToBottom(serialOutputRef);
          }
        );
        
        if (checkResult !== 0) {
          setSerialStatus('error');
          setSerialOutput(prev => prev + `❌ Failed to access source file\n`);
          return;
        }
        
        const localFilePath = `${timestampedFolderPath}/${fileName}`;
        
        // Choose command based on rsync availability
        let transferCommand;
        
        if (isRsyncAvailable) {
          transferCommand = `rsync -avz --progress --stats -e "ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=60" ${rfdUsername}@${rfdIpAddress}:"${pullSourcePath}" "${localFilePath}"`;
          setSerialOutput(prev => prev + `📡 Executing rsync command: ${transferCommand}\n`);
        } else {
          transferCommand = `scp -p -v -o StrictHostKeyChecking=no -o ServerAliveInterval=60 ${rfdUsername}@${rfdIpAddress}:"${pullSourcePath}" "${localFilePath}"`;
          setSerialOutput(prev => prev + `📡 Executing SCP command (with verbose): ${transferCommand}\n`);
        }
        
        setSerialTransferProgress(25); // 25% - starting transfer
        
        let lastProgressUpdate = 25;
        
        // Add a timer for smooth progress updates when no specific progress is detected
        const progressInterval = setInterval(() => {
          if (lastProgressUpdate < 90) {
            const incrementalProgress = Math.min(lastProgressUpdate + 1, 90);
            setSerialTransferProgress(incrementalProgress);
            lastProgressUpdate = incrementalProgress;
          }
        }, isRsyncAvailable ? 2500 : 1500); // Adjust timing based on tool
        
        const result = await window.electronAPI.runCommandWithRealTimeOutput(
          transferCommand,
          null,
          (output) => {
            setSerialOutput(prev => prev + output);
            scrollToBottom(serialOutputRef);
            
            if (isRsyncAvailable) {
              // Parse rsync output for single file transfer progress
              const progressMatch = output.match(/\s+(\d+)%/);
              if (progressMatch) {
                const rsyncPercent = parseInt(progressMatch[1]);
                // Map rsync percentage (0-100%) to our progress range (25-95%)
                const progress = 25 + Math.round((rsyncPercent / 100) * 70);
                
                if (progress > lastProgressUpdate) {
                  setSerialTransferProgress(Math.min(progress, 95));
                  lastProgressUpdate = progress;
                }
              }
              // Look for file transfer indicators
              else if (output.includes('receiving file list') || output.includes('receiving incremental file list')) {
                if (lastProgressUpdate < 30) {
                  setSerialTransferProgress(30);
                  lastProgressUpdate = 30;
                }
              }
              // Look for transfer completion indicators
              else if (output.includes('sent ') && output.includes('received ') && output.includes('bytes/sec')) {
                setSerialTransferProgress(95);
                lastProgressUpdate = 95;
              }
              // Look for speed indicators to show active transfer
              else if (output.includes('MB/s') || output.includes('KB/s') || output.includes('GB/s')) {
                const incrementalProgress = Math.min(lastProgressUpdate + Math.floor(Math.random() * 2) + 1, 90);
                if (incrementalProgress > lastProgressUpdate) {
                  setSerialTransferProgress(incrementalProgress);
                  lastProgressUpdate = incrementalProgress;
                }
              }
            } else {
              // Parse SCP output for single file transfer progress (fallback)
              if (output.includes('100%')) {
                setSerialTransferProgress(95);
                lastProgressUpdate = 95;
              } else if (output.includes('%')) {
                const percentMatch = output.match(/(\d+)%/);
                if (percentMatch) {
                  const scpPercent = parseInt(percentMatch[1]);
                  const progress = 25 + Math.round((scpPercent / 100) * 70);
                  if (progress > lastProgressUpdate) {
                    setSerialTransferProgress(Math.min(progress, 95));
                    lastProgressUpdate = progress;
                  }
                }
              } else if (output.includes('ETA') || output.includes('KB/s') || output.includes('MB/s')) {
                const incrementalProgress = Math.min(lastProgressUpdate + Math.floor(Math.random() * 3) + 1, 90);
                if (incrementalProgress > lastProgressUpdate) {
                  setSerialTransferProgress(incrementalProgress);
                  lastProgressUpdate = incrementalProgress;
                }
              }
            }
          }
        );
        
        // Clear the progress interval
        clearInterval(progressInterval);
        
        if (result === 0) {
          setSerialStatus('success');
          setSerialTransferProgress(100); // 100% - complete
          setSerialOutput(prev => prev + `✅ File pulled successfully to ${localFilePath}\n`);
          setSerialOutput(prev => prev + `📂 File organized in timestamped folder: ${timestampedFolderName}\n`);
          
          // Verify file size after transfer
          const currentPlatform = window.electronAPI.getPlatform ? window.electronAPI.getPlatform() : process.platform;
          const verifyCommand = currentPlatform === 'win32'
            ? `powershell -Command "Get-Item '${localFilePath}' | Select-Object FullName, Length, LastWriteTime"`
            : `ls -la "${localFilePath}"`;
          
          setSerialOutput(prev => prev + `🔍 Verifying transferred file...\n`);
          
          await window.electronAPI.runCommandWithRealTimeOutput(
            verifyCommand,
            null,
            (output) => {
              setSerialOutput(prev => prev + output);
              scrollToBottom(serialOutputRef);
            }
          );
        } else {
          setSerialStatus('error');
          setSerialOutput(prev => prev + `❌ Failed to copy file from device\n`);
        }
      }
    } catch (error) {
      // Clear the progress interval in case of error
      if (typeof progressInterval !== 'undefined') {
        clearInterval(progressInterval);
      }
      setSerialStatus('error');
      setSerialOutput(prev => prev + `❌ Network pull error: ${error.message}\n`);
    } finally {
      setIsSerialTransferring(false);
      // Reset progress after a short delay to show completion
      setTimeout(() => {
        setSerialTransferProgress(0);
      }, 2000);
    }
    scrollToBottom(serialOutputRef);
  };

  const handleNetworkPushFiles = async () => {
    if (!isNetworkConnected || !serialFilePath || !rfdPushDestPath) {
      setSerialOutput(prev => prev + '❌ Please ensure network connection and paths are set\n');
      scrollToBottom(serialOutputRef);
      return;
    }

    try {
      setIsSerialTransferring(true);
      setSerialTransferProgress(20); // 20% - starting
      setSerialOutput(prev => prev + `📤 Pushing file ${serialFilePath} via network...\n`);
      
      // Check if rsync is available
      const isRsyncAvailable = await checkRsyncAvailable();
      if (!isRsyncAvailable) {
        setSerialOutput(prev => prev + `⚠️ rsync not available, falling back to SCP\n`);
      }
      
      // Choose command based on rsync availability
      let transferCommand;
      
      if (isRsyncAvailable) {
        transferCommand = `rsync -avz --progress --stats -e "ssh -o StrictHostKeyChecking=no" "${serialFilePath}" ${rfdUsername}@${rfdIpAddress}:"${rfdPushDestPath}"`;
        setSerialOutput(prev => prev + `📡 Executing rsync command: ${transferCommand}\n`);
      } else {
        transferCommand = `scp -v -o StrictHostKeyChecking=no "${serialFilePath}" ${rfdUsername}@${rfdIpAddress}:"${rfdPushDestPath}"`;
        setSerialOutput(prev => prev + `📡 Executing SCP command (with verbose): ${transferCommand}\n`);
      }
      
      setSerialTransferProgress(30); // 30% - executing command
      
      let lastProgressUpdate = 30;
      
      // Add a timer for smooth progress updates when no specific progress is detected
      const progressInterval = setInterval(() => {
        if (lastProgressUpdate < 90) {
          const incrementalProgress = Math.min(lastProgressUpdate + 1, 90);
          setSerialTransferProgress(incrementalProgress);
          lastProgressUpdate = incrementalProgress;
        }
      }, isRsyncAvailable ? 2500 : 1500); // Adjust timing based on tool
      
      const result = await window.electronAPI.runCommandWithRealTimeOutput(
        transferCommand,
        null,
        (output) => {
          setSerialOutput(prev => prev + output);
          scrollToBottom(serialOutputRef);
          
          if (isRsyncAvailable) {
            // Parse rsync output for single file push progress
            const progressMatch = output.match(/\s+(\d+)%/);
            if (progressMatch) {
              const rsyncPercent = parseInt(progressMatch[1]);
              // Map rsync percentage (0-100%) to our progress range (30-95%)
              const progress = 30 + Math.round((rsyncPercent / 100) * 65);
              
              if (progress > lastProgressUpdate) {
                setSerialTransferProgress(Math.min(progress, 95));
                lastProgressUpdate = progress;
              }
            }
            // Look for file transfer indicators
            else if (output.includes('building file list') || output.includes('sending incremental file list')) {
              if (lastProgressUpdate < 35) {
                setSerialTransferProgress(35);
                lastProgressUpdate = 35;
              }
            }
            // Look for transfer completion indicators
            else if (output.includes('sent ') && output.includes('received ') && output.includes('bytes/sec')) {
              setSerialTransferProgress(95);
              lastProgressUpdate = 95;
            }
            // Look for speed indicators to show active transfer
            else if (output.includes('MB/s') || output.includes('KB/s') || output.includes('GB/s')) {
              const incrementalProgress = Math.min(lastProgressUpdate + Math.floor(Math.random() * 2) + 1, 90);
              if (incrementalProgress > lastProgressUpdate) {
                setSerialTransferProgress(incrementalProgress);
                lastProgressUpdate = incrementalProgress;
              }
            }
          } else {
            // Parse SCP output for single file push progress (fallback)
            if (output.includes('100%')) {
              setSerialTransferProgress(95);
              lastProgressUpdate = 95;
            } else if (output.includes('%')) {
              const percentMatch = output.match(/(\d+)%/);
              if (percentMatch) {
                const scpPercent = parseInt(percentMatch[1]);
                const progress = 30 + Math.round((scpPercent / 100) * 65);
                if (progress > lastProgressUpdate) {
                  setSerialTransferProgress(Math.min(progress, 95));
                  lastProgressUpdate = progress;
                }
              }
            } else if (output.includes('ETA') || output.includes('KB/s') || output.includes('MB/s')) {
              const incrementalProgress = Math.min(lastProgressUpdate + Math.floor(Math.random() * 3) + 1, 90);
              if (incrementalProgress > lastProgressUpdate) {
                setSerialTransferProgress(incrementalProgress);
                lastProgressUpdate = incrementalProgress;
              }
            }
          }
        }
      );
      
      // Clear the progress interval
      clearInterval(progressInterval);
      
              if (result === 0) {
          setSerialStatus('success');
          setSerialTransferProgress(100); // 100% - complete
          setSerialOutput(prev => prev + `✅ File pushed successfully to ${rfdPushDestPath}\n`);
        } else {
          setSerialStatus('error');
          setSerialOutput(prev => prev + `❌ Failed to push file to device\n`);
        }
    } catch (error) {
      // Clear the progress interval in case of error
      if (typeof progressInterval !== 'undefined') {
        clearInterval(progressInterval);
      }
      setSerialStatus('error');
      setSerialOutput(prev => prev + `❌ Network push error: ${error.message}\n`);
    } finally {
      setIsSerialTransferring(false);
      // Reset progress after a short delay to show completion
      setTimeout(() => {
        setSerialTransferProgress(0);
      }, 2000);
    }
    scrollToBottom(serialOutputRef);
  };

  // Smart connection handler
  const handleSmartConnect = async () => {
    // Debug logging
    console.log('[Smart Connect] State check:', {
      selectedDevice,
      rfdIpAddress,
      rfdTransferMode,
      isNetworkConnected,
      isSerialConnected
    });
    
    if (rfdTransferMode === 'network') {
      // In network mode, first scan for devices if no device is selected
      if (!selectedDevice && !rfdIpAddress) {
        setSerialOutput(prev => prev + '🔍 No device selected, scanning for devices first...\n');
        scrollToBottom(serialOutputRef);
        await handleScanNetworkDevices();
        
        // The handleScanNetworkDevices function will update the discoveredDevices state
        // User needs to select a device from the UI after scanning
        setSerialOutput(prev => prev + '📋 Please select a device from the Network Configuration dialog to connect.\n');
        scrollToBottom(serialOutputRef);
        return;
      }
      
      // If we have a device or IP address, connect via network
      setSerialOutput(prev => prev + `🌐 Attempting network connection to ${selectedDevice?.hostname || rfdIpAddress}...\n`);
      scrollToBottom(serialOutputRef);
      await handleNetworkConnect();
    } else {
      // Serial mode
      await handleSerialConnect();
    }
  };

  const handleSmartDisconnect = async () => {
    if (isSerialConnected) {
      await handleSerialDisconnect();
    }
    if (isNetworkConnected) {
      handleNetworkDisconnect();
    }
  };

  const handleSmartPullFiles = async () => {
    // Debounce rapid button clicks
    const now = Date.now();
    if (now - lastClickTime.current < 2000) {
      setSerialOutput(prev => prev + '⚠️ Please wait before clicking again...\n');
      scrollToBottom(serialOutputRef);
      return;
    }
    lastClickTime.current = now;

    // Prevent multiple concurrent calls
    if (isSerialTransferring) {
      setSerialOutput(prev => prev + '⚠️ Transfer already in progress, please wait...\n');
      scrollToBottom(serialOutputRef);
      return;
    }

    if (isSerialConnected) {
      await handleSerialReceiveFile();
    } else if (isNetworkConnected) {
      await handleNetworkPullFiles();
    } else {
      setSerialOutput(prev => prev + '❌ No active connection available\n');
      scrollToBottom(serialOutputRef);
    }
  };

  const handleSmartPushFiles = async () => {
    if (isSerialConnected) {
      await handleSerialSendFile();
    } else if (isNetworkConnected) {
      await handleNetworkPushFiles();
    } else {
      setSerialOutput(prev => prev + '❌ No active connection available\n');
      scrollToBottom(serialOutputRef);
    }
  };



  return (
    <MainContainer>
      {/* Device Selection */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <DevicesIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <DeviceToggle
          value={deviceType}
          exclusive
          onChange={handleDeviceTypeChange}
          size="small"
        >
          <ToggleButton value="efd-fos">
            EFD (FOS)
          </ToggleButton>
          <ToggleButton value="efd-vega">
            EFD (Vega)
          </ToggleButton>
          <ToggleButton value="rfd">
            RFD
          </ToggleButton>
        </DeviceToggle>
        
        {/* Recent Paths */}
        {((deviceType === 'rfd' && recentRfdPaths.length > 0) || (deviceType !== 'rfd' && recentEfdPaths.length > 0)) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto' }}>
            <HistoryIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            {(deviceType === 'rfd' ? recentRfdPaths : recentEfdPaths).map((path, index) => (
              <Chip 
                key={index}
                label={path.split(/[/\\]/).pop() || 'Root'}
                size="small" 
                onClick={() => {
                  if (deviceType === 'rfd') {
                    setSerialReceivePath(path);
                  } else {
                    setPullDestPath(path);
                  }
                }}
                sx={{ 
                  cursor: 'pointer', 
                  fontSize: '0.7rem',
                  height: 20,
                }}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* Tabs */}
      <CompactTabs value={activeTab} onChange={(e, v) => setActiveTab(v)}>
        <Tab 
          label="ADB Pull" 
          icon={<CloudDownloadIcon sx={{ fontSize: 16 }} />} 
          iconPosition="start" 
          disabled={deviceType === 'rfd'}
        />
        <Tab 
          label="ADB Push" 
          icon={<CloudUploadIcon sx={{ fontSize: 16 }} />} 
          iconPosition="start" 
          disabled={deviceType === 'rfd'}
        />
        <Tab 
          label="RFD Pull" 
          icon={<UsbIcon sx={{ fontSize: 16 }} />} 
          iconPosition="start" 
          disabled={deviceType === 'efd-fos' || deviceType === 'efd-vega'}
        />
        <Tab 
          label="RFD Push" 
          icon={<UsbIcon sx={{ fontSize: 16 }} />} 
          iconPosition="start" 
          disabled={deviceType === 'efd-fos' || deviceType === 'efd-vega'}
        />
      </CompactTabs>
      
      {/* Tab Panels */}
      <TabPanel value={activeTab} index={0}>
        <ContentCard elevation={0}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
              ADB Pull Files from Device
            </Typography>
            <StatusChip size="small" label="Compressed Archive" status="success" sx={{ pointerEvents: 'none' }} />
            {pullStatus && (
              <Tooltip title={pullStatus === 'success' ? 'Operation successful' : 'Operation failed'}>
                <StatusIndicator status={pullStatus} />
              </Tooltip>
            )}
          </Box>

          {/* 5.5:5.5:0.5:0.5 Layout */}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'end', mb: 1.5 }}>
            <Box sx={{ flex: 5.5 }}>
              <PathInput
                label="Source Directory (will be archived)"
                value={pullSourcePath}
                onChange={(e) => setPullSourcePath(e.target.value)}
                disabled={isPulling}
                icon={<ArchiveIcon sx={{ fontSize: 16 }} />}
              />
            </Box>
            <Box sx={{ flex: 5.5 }}>
              <PathInput
                label="Destination Folder"
                value={pullDestPath}
                onChange={(e) => setPullDestPath(e.target.value)}
                disabled={isPulling}
                placeholder="Select destination folder..."
                icon={<FolderOpenIcon sx={{ fontSize: 16 }} />}
              />
            </Box>
            <Box sx={{ flex: 0.5 }}>
              <CompactButton
                fullWidth
                variant="outlined"
                onClick={handleSelectPullDestFolder}
                disabled={isPulling}
                size="small"
              >
                <FolderOpenIcon sx={{ fontSize: 16 }} />
              </CompactButton>
            </Box>
            <Box sx={{ flex: 0.5 }}>
              <CompactButton
                fullWidth
                variant="contained"
                onClick={handlePullFiles}
                disabled={isPulling || !pullSourcePath || !pullDestPath}
                size="small"
              >
                {isPulling ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon sx={{ fontSize: 16 }} />}
              </CompactButton>
            </Box>
          </Box>

          {pullOutput && (
            <Fade in={!!pullOutput}>
              <ConsoleContainer>
                <ConsoleHeader>
                  <Box className="console-title">
                    <TerminalIcon className="console-icon" />
                    <Typography variant="caption">Console Output</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Copy output">
                      <IconButton size="small" onClick={() => handleCopyOutput('pull')} sx={{ padding: 0.5 }}>
                        <ContentCopyIcon sx={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)' }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Clear output">
                      <IconButton size="small" onClick={() => handleClearOutput('pull')} sx={{ padding: 0.5 }}>
                        <ClearIcon sx={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)' }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </ConsoleHeader>
                <ConsoleOutput ref={pullOutputRef}>
                  {pullOutput}
                </ConsoleOutput>
              </ConsoleContainer>
            </Fade>
          )}
        </ContentCard>
      </TabPanel>

      <TabPanel value={activeTab} index={1}>
        <ContentCard elevation={0}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
              ADB Push Files to Device
            </Typography>
            {pushStatus && (
              <Tooltip title={pushStatus === 'success' ? 'Operation successful' : 'Operation failed'}>
                <StatusIndicator status={pushStatus} />
              </Tooltip>
            )}
          </Box>

          {/* 5.5:5.5:0.5:0.5 Layout */}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'end', mb: 1.5 }}>
            <Box sx={{ flex: 5.5 }}>
              <PathInput
                label="Source File"
                value={pushSourcePath}
                onChange={(e) => setPushSourcePath(e.target.value)}
                disabled={isPushing}
                placeholder="Select source file..."
                icon={<FolderOpenIcon sx={{ fontSize: 16 }} />}
              />
            </Box>
            <Box sx={{ flex: 5.5 }}>
              <PathInput
                label="Destination Path on Device"
                value={pushDestPath}
                onChange={(e) => setPushDestPath(e.target.value)}
                disabled={isPushing}
                icon={<CloudUploadIcon sx={{ fontSize: 16 }} />}
              />
            </Box>
            <Box sx={{ flex: 0.5 }}>
              <CompactButton
                fullWidth
                variant="outlined"
                onClick={handleSelectPushSourceFile}
                disabled={isPushing}
                size="small"
              >
                <FolderOpenIcon sx={{ fontSize: 16 }} />
              </CompactButton>
            </Box>
            <Box sx={{ flex: 0.5 }}>
              <CompactButton
                fullWidth
                variant="contained"
                onClick={handlePushFiles}
                disabled={isPushing || !pushSourcePath || !pushDestPath}
                size="small"
              >
                {isPushing ? <CircularProgress size={16} color="inherit" /> : <UploadIcon sx={{ fontSize: 16 }} />}
              </CompactButton>
            </Box>
          </Box>

          {pushOutput && (
            <Fade in={!!pushOutput}>
              <ConsoleContainer>
                <ConsoleHeader>
                  <Box className="console-title">
                    <TerminalIcon className="console-icon" />
                    <Typography variant="caption">Console Output</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Copy output">
                      <IconButton size="small" onClick={() => handleCopyOutput('push')} sx={{ padding: 0.5 }}>
                        <ContentCopyIcon sx={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)' }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Clear output">
                      <IconButton size="small" onClick={() => handleClearOutput('push')} sx={{ padding: 0.5 }}>
                        <ClearIcon sx={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)' }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </ConsoleHeader>
                <ConsoleOutput ref={pushOutputRef}>
                  {pushOutput}
                </ConsoleOutput>
              </ConsoleContainer>
            </Fade>
          )}
        </ContentCard>
      </TabPanel>

      <TabPanel value={activeTab} index={2}>
        <ContentCard elevation={0}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
              RFD Pull Files (Hybrid Mode)
            </Typography>
            <StatusChip size="small" label="Individual Files" status="warning" sx={{ pointerEvents: 'none' }} />
            {serialStatus && (
              <Tooltip title={serialStatus === 'success' ? 'Operation successful' : 'Operation failed'}>
                <StatusIndicator status={serialStatus} />
              </Tooltip>
            )}
            {rfdTransferMode === 'serial' && (
              <Tooltip title="Configure connections">
                <IconButton size="small" onClick={() => setShowSerialConfig(true)}>
                  <SettingsIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            {rfdTransferMode === 'network' && (
              <Tooltip title="Configure network">
                <IconButton size="small" onClick={() => setShowNetworkConfig(true)}>
                  <NetworkCheckIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>

          {/* Transfer Mode Selection */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Transfer Mode:
            </Typography>
            <DeviceToggle
              value={rfdTransferMode}
              exclusive
              onChange={(e, newMode) => newMode && setRfdTransferMode(newMode)}
              size="small"
            >
              <ToggleButton value="serial">
                <UsbIcon sx={{ fontSize: 14, mr: 0.5 }} />
                Serial
              </ToggleButton>
              <ToggleButton value="network">
                <WifiIcon sx={{ fontSize: 14, mr: 0.5 }} />
                Network
              </ToggleButton>
            </DeviceToggle>
          </Box>

          {/* Connection Status */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
            {/* Serial Status */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <UsbIcon sx={{ fontSize: 16, color: isSerialConnected ? 'success.main' : 'text.secondary' }} />
              <Typography variant="caption" color={isSerialConnected ? 'success.main' : 'text.secondary'}>
                {isSerialConnected ? `Serial: ${selectedPort}` : (selectedPort ? `Serial: ${selectedPort} (Not connected)` : 'Serial: No port selected')}
              </Typography>
            </Box>
            
            {/* Network Status */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <WifiIcon sx={{ fontSize: 16, color: isNetworkConnected ? 'success.main' : 'text.secondary' }} />
              <Typography variant="caption" color={isNetworkConnected ? 'success.main' : 'text.secondary'}>
                {isNetworkConnected ? `Network: ${rfdIpAddress}` : 'Network: Not connected'}
              </Typography>
            </Box>
            
            {/* Quick Scan Button */}
            {rfdTransferMode === 'network' && !isNetworkConnected && (
              <Tooltip title="Scan for devices">
                <IconButton 
                  size="small" 
                  onClick={handleScanNetworkDevices}
                  disabled={isScanning}
                  sx={{ 
                    ml: 1,
                    color: 'primary.main',
                    animation: isScanning ? 'spin 1s linear infinite' : 'none',
                    '@keyframes spin': {
                      '0%': { transform: 'rotate(0deg)' },
                      '100%': { transform: 'rotate(360deg)' }
                    }
                  }}
                >
                  <NetworkCheckIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            
            {/* Smart Connect/Disconnect Button */}
            <CompactButton
              variant={isSerialConnected || isNetworkConnected ? "outlined" : "contained"}
              onClick={isSerialConnected || isNetworkConnected ? handleSmartDisconnect : (selectedDevice ? handleNetworkConnect : handleSmartConnect)}
              size="small"
              sx={{ ml: 'auto' }}
              startIcon={
                (isSerialConnected || isNetworkConnected) ? 
                  <ClearIcon sx={{ fontSize: 14 }} /> : 
                  (selectedDevice ? <LinkIcon sx={{ fontSize: 14 }} /> : (rfdTransferMode === 'network' ? <NetworkCheckIcon sx={{ fontSize: 14 }} /> : <UsbIcon sx={{ fontSize: 14 }} />))
              }
            >
              {isSerialConnected || isNetworkConnected ? 'Disconnect' : (selectedDevice ? 'Connect' : (rfdTransferMode === 'network' ? 'Scan & Connect' : 'Connect Serial'))}
            </CompactButton>
          </Box>

          {/* 4.5:4.5:1:1 Layout for Pull */}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'end', mb: 1.5 }}>
            <Box sx={{ flex: 4.5 }}>
              <PathInput
                label="Source Path on Device"
                value={pullSourcePath}
                onChange={(e) => setPullSourcePath(e.target.value)}
                disabled={(!isSerialConnected && !isNetworkConnected) || isSerialTransferring}
                icon={<ArchiveIcon sx={{ fontSize: 16 }} />}
              />
            </Box>
            <Box sx={{ flex: 4.5 }}>
              <PathInput
                label="Destination Folder"
                value={serialReceivePath}
                onChange={(e) => setSerialReceivePath(e.target.value)}
                disabled={(!isSerialConnected && !isNetworkConnected) || isSerialTransferring}
                placeholder="Select save location..."
                icon={<FolderOpenIcon sx={{ fontSize: 16 }} />}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <CompactButton
                fullWidth
                variant="outlined"
                onClick={handleSelectSerialReceivePath}
                disabled={(!isSerialConnected && !isNetworkConnected) || isSerialTransferring}
                size="small"
              >
                <FolderOpenIcon sx={{ fontSize: 16 }} />
              </CompactButton>
            </Box>
            <Box sx={{ flex: 1 }}>
              <CompactButton
                fullWidth
                variant="contained"
                onClick={handleSmartPullFiles}
                disabled={(!isSerialConnected && !isNetworkConnected) || isSerialTransferring || !serialReceivePath}
                size="small"
              >
                {isSerialTransferring ? <CircularProgress size={16} color="inherit" /> : <GetAppIcon sx={{ fontSize: 16 }} />}
              </CompactButton>
            </Box>
          </Box>

          {/* Serial Console Output */}
          {serialOutput && (
            <Fade in={!!serialOutput}>
              <ConsoleContainer>
                <ConsoleHeader>
                  <Box className="console-title">
                    <TerminalIcon className="console-icon" />
                    <Typography variant="caption">Serial Console</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Copy output">
                      <IconButton size="small" onClick={() => handleCopyOutput('serial')} sx={{ padding: 0.5 }}>
                        <ContentCopyIcon sx={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)' }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Clear output">
                      <IconButton size="small" onClick={() => { setSerialOutput(''); setSerialStatus(null); }} sx={{ padding: 0.5 }}>
                        <ClearIcon sx={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)' }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </ConsoleHeader>
                <ConsoleOutput ref={serialOutputRef}>
                  {serialOutput}
                </ConsoleOutput>
                {/* Transfer Progress Bar */}
                {isSerialTransferring && (
                  <Box sx={{ 
                    padding: theme.spacing(1, 1.5, 1.5, 1.5),
                    backgroundColor: 'rgba(0, 0, 0, 0.4)',
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                  }}>
                    <LinearProgress 
                      variant="determinate" 
                      value={serialTransferProgress} 
                      sx={{ 
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        '& .MuiLinearProgress-bar': {
                          borderRadius: 2,
                        }
                      }} 
                    />
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: 'rgba(255, 255, 255, 0.7)',
                        fontSize: '0.65rem',
                        mt: 0.5,
                        display: 'block'
                      }}
                    >
                      Transfer Progress: {serialTransferProgress}%
                    </Typography>
                  </Box>
                )}
              </ConsoleContainer>
            </Fade>
          )}
        </ContentCard>
      </TabPanel>

      <TabPanel value={activeTab} index={3}>
        <ContentCard elevation={0}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
              RFD Push Files (Hybrid Mode)
            </Typography>
            {serialStatus && (
              <Tooltip title={serialStatus === 'success' ? 'Operation successful' : 'Operation failed'}>
                <StatusIndicator status={serialStatus} />
              </Tooltip>
            )}
            {rfdTransferMode === 'serial' && (
              <Tooltip title="Configure connections">
                <IconButton size="small" onClick={() => setShowSerialConfig(true)}>
                  <SettingsIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            {rfdTransferMode === 'network' && (
              <Tooltip title="Configure network">
                <IconButton size="small" onClick={() => setShowNetworkConfig(true)}>
                  <NetworkCheckIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>

          {/* Transfer Mode Selection */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Transfer Mode:
            </Typography>
            <DeviceToggle
              value={rfdTransferMode}
              exclusive
              onChange={(e, newMode) => newMode && setRfdTransferMode(newMode)}
              size="small"
            >
              <ToggleButton value="serial">
                <UsbIcon sx={{ fontSize: 14, mr: 0.5 }} />
                Serial
              </ToggleButton>
              <ToggleButton value="network">
                <WifiIcon sx={{ fontSize: 14, mr: 0.5 }} />
                Network
              </ToggleButton>
            </DeviceToggle>
          </Box>

          {/* Connection Status */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
            {/* Serial Status */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <UsbIcon sx={{ fontSize: 16, color: isSerialConnected ? 'success.main' : 'text.secondary' }} />
              <Typography variant="caption" color={isSerialConnected ? 'success.main' : 'text.secondary'}>
                {isSerialConnected ? `Serial: ${selectedPort}` : (selectedPort ? `Serial: ${selectedPort} (Not connected)` : 'Serial: No port selected')}
              </Typography>
            </Box>
            
            {/* Network Status */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <WifiIcon sx={{ fontSize: 16, color: isNetworkConnected ? 'success.main' : 'text.secondary' }} />
              <Typography variant="caption" color={isNetworkConnected ? 'success.main' : 'text.secondary'}>
                {isNetworkConnected ? `Network: ${rfdIpAddress}` : 'Network: Not connected'}
              </Typography>
            </Box>
            
            {/* Smart Connect/Disconnect Button */}
            <CompactButton
              variant={isSerialConnected || isNetworkConnected ? "outlined" : "contained"}
              onClick={isSerialConnected || isNetworkConnected ? handleSmartDisconnect : (selectedDevice ? handleNetworkConnect : handleSmartConnect)}
              size="small"
              sx={{ ml: 'auto' }}
              startIcon={
                (isSerialConnected || isNetworkConnected) ? 
                  <ClearIcon sx={{ fontSize: 14 }} /> : 
                  (selectedDevice ? <LinkIcon sx={{ fontSize: 14 }} /> : (rfdTransferMode === 'network' ? <NetworkCheckIcon sx={{ fontSize: 14 }} /> : <UsbIcon sx={{ fontSize: 14 }} />))
              }
            >
              {isSerialConnected || isNetworkConnected ? 'Disconnect' : (selectedDevice ? 'Connect' : (rfdTransferMode === 'network' ? 'Scan & Connect' : 'Connect Serial'))}
            </CompactButton>
          </Box>

          {/* 4.5:4.5:1:1 Layout for Push */}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'end', mb: 1.5 }}>
            <Box sx={{ flex: 4.5 }}>
              <PathInput
                label="Source File"
                value={serialFilePath}
                onChange={(e) => setSerialFilePath(e.target.value)}
                disabled={(!isSerialConnected && !isNetworkConnected) || isSerialTransferring}
                placeholder="Select file to send..."
                icon={<FolderOpenIcon sx={{ fontSize: 16 }} />}
              />
            </Box>
            <Box sx={{ flex: 4.5 }}>
              <PathInput
                label="Destination Path on Device"
                value={rfdPushDestPath}
                onChange={(e) => setRfdPushDestPath(e.target.value)}
                disabled={(!isSerialConnected && !isNetworkConnected) || isSerialTransferring}
                placeholder="Directory path (e.g., /tmp/) or full file path"
                icon={<SendIcon sx={{ fontSize: 16 }} />}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <CompactButton
                fullWidth
                variant="outlined"
                onClick={handleSelectSerialFile}
                disabled={(!isSerialConnected && !isNetworkConnected) || isSerialTransferring}
                size="small"
              >
                <FolderOpenIcon sx={{ fontSize: 16 }} />
              </CompactButton>
            </Box>
            <Box sx={{ flex: 1 }}>
              <CompactButton
                fullWidth
                variant="contained"
                onClick={handleSmartPushFiles}
                disabled={(!isSerialConnected && !isNetworkConnected) || isSerialTransferring || !serialFilePath || !rfdPushDestPath}
                size="small"
              >
                {isSerialTransferring ? <CircularProgress size={16} color="inherit" /> : <SendIcon sx={{ fontSize: 16 }} />}
              </CompactButton>
            </Box>
          </Box>

          {/* Serial Console Output */}
          {serialOutput && (
            <Fade in={!!serialOutput}>
              <ConsoleContainer>
                <ConsoleHeader>
                  <Box className="console-title">
                    <TerminalIcon className="console-icon" />
                    <Typography variant="caption">Serial Console</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Copy output">
                      <IconButton size="small" onClick={() => handleCopyOutput('serial')} sx={{ padding: 0.5 }}>
                        <ContentCopyIcon sx={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)' }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Clear output">
                      <IconButton size="small" onClick={() => { setSerialOutput(''); setSerialStatus(null); }} sx={{ padding: 0.5 }}>
                        <ClearIcon sx={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)' }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </ConsoleHeader>
                <ConsoleOutput ref={serialOutputRef}>
                  {serialOutput}
                </ConsoleOutput>
                {/* Transfer Progress Bar */}
                {isSerialTransferring && (
                  <Box sx={{ 
                    padding: theme.spacing(1, 1.5, 1.5, 1.5),
                    backgroundColor: 'rgba(0, 0, 0, 0.4)',
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                  }}>
                    <LinearProgress 
                      variant="determinate" 
                      value={serialTransferProgress} 
                      sx={{ 
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        '& .MuiLinearProgress-bar': {
                          borderRadius: 2,
                        }
                      }} 
                    />
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: 'rgba(255, 255, 255, 0.7)',
                        fontSize: '0.65rem',
                        mt: 0.5,
                        display: 'block'
                      }}
                    >
                      Transfer Progress: {serialTransferProgress}%
                    </Typography>
                  </Box>
                )}
              </ConsoleContainer>
            </Fade>
          )}
        </ContentCard>
      </TabPanel>

      {/* Serial Configuration Dialog */}
      <Dialog open={showSerialConfig} onClose={() => setShowSerialConfig(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Serial Port Configuration</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <FormControl fullWidth variant="filled">
              <InputLabel>Serial Port</InputLabel>
              <Select
                value={selectedPort}
                onChange={(e) => setSelectedPort(e.target.value)}
                disabled={isSerialConnected}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      bgcolor: 'background.paper',
                      border: '1px solid',
                      borderColor: 'divider',
                      boxShadow: 2,
                      '& .MuiList-root': {
                        padding: 0,
                      },
                      '& .MuiMenuItem-root': {
                        padding: '12px 16px',
                        '&:not(:last-child)': {
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        },
                        '&:hover': {
                          bgcolor: 'action.hover',
                        },
                        '&.Mui-selected': {
                          bgcolor: 'action.selected',
                          '&:hover': {
                            bgcolor: 'action.selected',
                          },
                        },
                      },
                    },
                  },
                }}
              >
                <MenuItem value="">
                  <em>None - Select a port</em>
                </MenuItem>
                {serialPorts.map((port) => (
                  <MenuItem key={port.path} value={port.path}>
                    {port.path} - {port.manufacturer || 'Unknown'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth variant="filled">
              <InputLabel>Baud Rate</InputLabel>
              <Select
                value={baudRate}
                onChange={(e) => setBaudRate(e.target.value)}
                disabled={isSerialConnected}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      bgcolor: 'background.paper',
                      border: '1px solid',
                      borderColor: 'divider',
                      boxShadow: 2,
                      '& .MuiList-root': {
                        padding: 0,
                      },
                      '& .MuiMenuItem-root': {
                        padding: '12px 16px',
                        '&:not(:last-child)': {
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        },
                        '&:hover': {
                          bgcolor: 'action.hover',
                        },
                        '&.Mui-selected': {
                          bgcolor: 'action.selected',
                          '&:hover': {
                            bgcolor: 'action.selected',
                          },
                        },
                      },
                    },
                  },
                }}
              >
                <MenuItem value={9600}>9600</MenuItem>
                <MenuItem value={19200}>19200</MenuItem>
                <MenuItem value={38400}>38400</MenuItem>
                <MenuItem value={57600}>57600</MenuItem>
                <MenuItem value={115200}>115200</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSerialConfig(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Network Configuration Dialog */}
      <Dialog open={showNetworkConfig} onClose={() => setShowNetworkConfig(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Network Configuration</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {/* Device Discovery Section */}
            <Box sx={{ 
              p: 2, 
              border: `1px solid ${theme.palette.divider}`, 
              borderRadius: 1,
              backgroundColor: theme.palette.action.hover
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Device Discovery
                </Typography>
                <CompactButton
                  variant="outlined"
                  size="small"
                  onClick={handleScanNetworkDevices}
                  disabled={isScanning || isNetworkConnected}
                  startIcon={isScanning ? <CircularProgress size={14} /> : <NetworkCheckIcon sx={{ fontSize: 14 }} />}
                >
                  {isScanning ? 'Scanning...' : 'Scan Network'}
                </CompactButton>
              </Box>
              
              {discoveredDevices.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      Select a network device:
                    </Typography>
                    <IconButton 
                      size="small" 
                      onClick={() => { setDiscoveredDevices([]); setSelectedDevice(null); }}
                      sx={{ padding: 0.25 }}
                    >
                      <ClearIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
                    {discoveredDevices.map((device, index) => (
                      <Box
                        key={index}
                        sx={{
                          p: 1,
                          border: `1px solid ${selectedDevice?.ip === device.ip ? theme.palette.primary.main : theme.palette.divider}`,
                          borderRadius: 1,
                          cursor: 'pointer',
                          backgroundColor: selectedDevice?.ip === device.ip ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                          '&:hover': {
                            backgroundColor: alpha(theme.palette.primary.main, 0.05),
                          }
                        }}
                        onClick={() => handleSelectDevice(device)}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {device.hostname}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {device.ip}
                            </Typography>
                          </Box>
                          {selectedDevice?.ip === device.ip && (
                            <CheckCircleIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                          )}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
            
            {/* Manual Configuration Section */}
            <TextField
              fullWidth
              label="IP Address"
              value={rfdIpAddress}
              onChange={(e) => setRfdIpAddress(e.target.value)}
              disabled={isNetworkConnected}
              placeholder="192.168.1.100"
              helperText="Enter manually or select from discovered devices"
            />
            <TextField
              fullWidth
              label="Username"
              value={rfdUsername}
              onChange={(e) => setRfdUsername(e.target.value)}
              disabled={isNetworkConnected}
              placeholder="root"
              helperText="SSH username for the RFD device"
            />
            <TextField
              fullWidth
              label="Password (Optional)"
              type="password"
              value={rfdPassword}
              onChange={(e) => setRfdPassword(e.target.value)}
              disabled={isNetworkConnected}
              placeholder="Leave blank for key-based authentication"
              helperText="SSH password or leave blank for key-based auth"
            />
            <TextField
              fullWidth
              label="Subnet (for manual discovery)"
              value={manualSubnet}
              onChange={(e) => setManualSubnet(e.target.value)}
              disabled={isNetworkConnected}
              placeholder="e.g., 192.168.50"
              helperText="Enter the subnet (e.g., 192.168.50) for manual network scanning"
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <WifiIcon sx={{ fontSize: 20, color: 'primary.main' }} />
              <Typography variant="body2" color="text.secondary">
                Ensure SSH access is configured for devices on your network.
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowNetworkConfig(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </MainContainer>
  );
}

export default FilesPage;
