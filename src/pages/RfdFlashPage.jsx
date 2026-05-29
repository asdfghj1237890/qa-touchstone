import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { 
  Button, 
  Typography, 
  Box, 
  TextField, 
  Stack, 
  Paper, 
  Chip, 
  Alert,
  LinearProgress,
  Divider,
  Card,
  CardContent,
  CardActions
} from '@mui/material';
import { styled } from '@mui/system';
import StopIcon from '@mui/icons-material/Stop';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import { debounce } from 'lodash';
import { useFlashing } from '../contexts/FlashingContext';

const StyledPre = styled('pre')({
  margin: 0,
  padding: 0,
  fontFamily: '"Fira Code", "Consolas", "Monaco", monospace',
  whiteSpace: 'pre-wrap',
  wordWrap: 'break-word',
  fontSize: '14px',
  lineHeight: '1.5',
  color: '#fff',
  overflow: 'visible',
  width: '100%',
});

const ConsoleContainer = styled(Paper)(({ theme }) => ({
  backgroundColor: '#1e1e1e',
  border: '1px solid #333',
  borderRadius: '12px',
  overflow: 'hidden',
  position: 'relative',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
}));

const ConsoleHeader = styled(Box)(({ theme }) => ({
  backgroundColor: '#2d2d2d',
  padding: '12px 20px',
  borderBottom: '1px solid #333',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
}));

function RfdFlashPage() {
  const [selectedFile, setSelectedFile] = useState('');
  const [consoleOutput, setConsoleOutput] = useState('');
  const [platformTools, setPlatformTools] = useState('');
  const [configLoaded, setConfigLoaded] = useState(false);
  const { isFlashing, setIsFlashing } = useFlashing();
  const isMountedRef = useRef(true);
  const shouldAutoScrollRef = useRef(true);
  const consoleRef = useRef(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const maxLogLength = 20000;
  const [screenResolution, setScreenResolution] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Detect screen resolution
  useEffect(() => {
    const handleResize = () => {
      setScreenResolution({ width: window.innerWidth, height: window.innerHeight });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Determine layout based on resolution
  const getLayoutConfig = () => {
    const { width, height } = screenResolution;
    
    if (width >= 2560 && height >= 1440) {
      // 2560x1440 layout - more spacious
      return {
        containerPadding: { px: 4, py: 3 },
        containerHeight: 'calc(100vh - 80px)',
        cardMargin: 3,
        cardPadding: 3,
        buttonPadding: '10px 24px',
        buttonFontSize: '14px',
        buttonMinWidth: { select: '220px', flash: '120px', stop: '100px' },
        statusCardPadding: 2,
        statusFontSize: '14px',
        pathFontSize: '13px',
        chipHeight: '38px',
        chipFontSize: '13px',
        consoleBorderRadius: '12px'
      };
    } else {
      // 1920x1080 layout - current compact layout
      return {
        containerPadding: { px: 3, py: 2 },
        containerHeight: 'calc(100vh - 100px)',
        cardMargin: 2,
        cardPadding: 2,
        buttonPadding: '8px 16px',
        buttonFontSize: '13px',
        buttonMinWidth: { select: '180px', flash: '100px', stop: '80px' },
        statusCardPadding: 1.5,
        statusFontSize: '13px',
        pathFontSize: '12px',
        chipHeight: '34px',
        chipFontSize: '12px',
        consoleBorderRadius: '8px'
      };
    }
  };

  const layout = getLayoutConfig();

  // Ensure isMountedRef is set to true on component mount
  useEffect(() => {
    console.log('[RfdFlashPage] Component mounted, setting isMountedRef to true');
    isMountedRef.current = true;
    
    return () => {
      console.log('[RfdFlashPage] Component unmounting, setting isMountedRef to false');
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await window.electronAPI.loadConfig();
        if (isMountedRef.current) {
          setPlatformTools(config.platformTools || '');
          setConfigLoaded(true);
        }
      } catch (error) {
        console.error('Error loading config:', error);
        if (isMountedRef.current) {
          setConfigLoaded(true);
        }
      }
    };

    loadConfig();

    return () => {
      if (isFlashing) {
        console.log('Stopping command due to component unmount');
        window.electronAPI.stopCommand().catch(console.error);
        setIsFlashing(false);
      }
    };
  }, [setIsFlashing]);

  // Auto-scroll useEffect similar to Page4
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

  useEffect(() => {
    console.log('[RfdFlashPage] consoleOutput state changed - length:', consoleOutput.length);
    console.log('[RfdFlashPage] consoleOutput preview:', consoleOutput.substring(0, 200));
  }, [consoleOutput]);

  const isScrolledToBottom = () => {
    if (!consoleRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
    return Math.abs(scrollHeight - clientHeight - scrollTop) < 50;
  };

  const updateConsoleOutput = (data) => {
    console.log('[RfdFlashPage] updateConsoleOutput called with:', data.substring(0, 100));
    console.log('[RfdFlashPage] isMountedRef.current:', isMountedRef.current);

    // If the output contains "Finished", append a success message and call the stop function.
    if (data.includes("Finished")) {
      setConsoleOutput((prev) => {
        console.log('[RfdFlashPage] Finished detected, processing success message');
        let newOutput = prev + '\n' + data + '\n<span style="color: #4CAF50;">Flash process completed successfully.</span>\n';
        if (newOutput.length > maxLogLength) {
          newOutput = newOutput.slice(-maxLogLength);
        }
        return newOutput;
      });
      setTimeout(() => {
        handleStop();
      }, 100);
      return;
    }

    // Append other messages directly.
    if (isMountedRef.current) {
      setConsoleOutput((prev) => {
        console.log('[RfdFlashPage] Previous console output length:', prev.length);
        let newOutput = prev + (typeof data === 'string' ? data : JSON.stringify(data));
        const truncatedOutput = newOutput.slice(-maxLogLength);
        console.log('[RfdFlashPage] New console output length:', truncatedOutput.length);
        
        // Auto-scroll console to bottom during flashing - but only if user hasn't manually scrolled
        if ((isFlashing || shouldAutoScrollRef.current) && consoleRef.current && !userScrolled) {
          // Check if user is at the bottom before auto-scrolling
          const isAtBottom = isScrolledToBottom();
          if (isAtBottom) {
            requestAnimationFrame(() => {
              if (consoleRef.current && (isFlashing || shouldAutoScrollRef.current) && !userScrolled) {
                console.log('[RfdFlashPage] Auto-scrolling to bottom');
                consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
              }
            });
          }
        }
        
        return truncatedOutput;
      });
    } else {
      console.warn('[RfdFlashPage] updateConsoleOutput called but component not mounted');
    }
  };

  const selectFile = async () => {
    const result = await window.electronAPI.selectFile();
    if (result && result.match(/flash-without-bld-.*\.bin$/)) {
      setSelectedFile(result);
      setConsoleOutput(''); // Clear the console when a valid file is selected.
      updateConsoleOutput('✅ Flash file selected successfully.\n');
    } else {
      updateConsoleOutput('❌ Please select a valid flash-without-bld-xxxxxx.bin file.\n');
    }
  };

  // Function to shorten the file path display
  const getShortFilePath = (fullPath) => {
    if (!fullPath) return '';
    
    // Look for flash-without-bld pattern and extract the relevant part
    const match = fullPath.match(/(flash-without-bld-[^\\\/]*\.bin)$/);
    if (match) {
      const fileName = match[1];
      const pathParts = fullPath.split(/[\\\/]/);
      if (pathParts.length > 2) {
        return `.../${pathParts[pathParts.length - 2]}/${fileName}`;
      }
      return fileName;
    }
    
    // Fallback: show last 50 characters
    return fullPath.length > 50 ? `...${fullPath.slice(-50)}` : fullPath;
  };

  const handleFlash = async () => {
    if (!selectedFile) {
      updateConsoleOutput('Please select a flash-without-bld-xxxxxx.bin file first.\n');
      return;
    }

    // Debug: Log the current state
    console.log('[RfdFlashPage] handleFlash called');
    console.log('[RfdFlashPage] selectedFile:', selectedFile);
    console.log('[RfdFlashPage] platformTools:', platformTools);

    // If platform tools is not configured, try to reload config
    if (!platformTools) {
      console.log('[RfdFlashPage] Platform tools not configured, attempting to reload config...');
      try {
        const config = await window.electronAPI.loadConfig();
        console.log('[RfdFlashPage] Reloaded config:', config);
        if (config && config.platformTools) {
          setPlatformTools(config.platformTools);
          updateConsoleOutput(`<span style="color: #4CAF50;">✅ Configuration reloaded successfully.</span>\n`);
        }
      } catch (error) {
        console.error('[RfdFlashPage] Failed to reload config:', error);
        updateConsoleOutput(`<span style="color: orange;">⚠️ Could not reload configuration, using fallback.</span>\n`);
      }
    }

    // Clear the console.
    setConsoleOutput('');

    try {
      setIsFlashing(true);
      shouldAutoScrollRef.current = true; // Enable auto-scroll like Page4
      updateConsoleOutput('<span style="color: #7ddbfa;">Starting flash process...</span>\n');
      const command = `${platformTools}/fastboot boot ${selectedFile}`;
      updateConsoleOutput(`<span style="color: #7ddbfa;">${command}</span>\n`);
      
      console.log('Starting flash command execution...');
      
      await window.electronAPI.runCommandWithRealTimeOutput(command, null, (data) => {
        console.log('[RfdFlashPage] Received callback data:', data, 'type:', typeof data);
        if (!data) {
          console.warn('[RfdFlashPage] Received empty data in callback');
          return;
        }
        console.log('[RfdFlashPage] Processing data in handleFlash:', data.substring(0, 100));
        updateConsoleOutput(data);
      });
    } catch (error) {
      console.error('Error in handleFlash:', error);
      if (error.message !== 'Process stopped by user') {
        updateConsoleOutput(`<span style="color: red;">Error: ${error.message}</span>\n`);
      }
    } finally {
      if (isMountedRef.current) {
        setIsFlashing(false);
        // Keep auto-scroll enabled for a bit longer to catch final messages (like Page4)
        setTimeout(() => {
          shouldAutoScrollRef.current = false;
        }, 2000);
        console.log('Flash process finished or stopped, setting isFlashing to false.');
      } else {
        setIsFlashing(false);
        console.log('Component unmounted during flash, state cleanup skipped in finally.');
      }
    }
  };

  const handleStop = debounce(async () => {
    console.log('handleStop called');
    try {
      if (!isFlashing) {
        console.log('Process already stopped');
        return;
      }

      await window.electronAPI.stopCommand();
      if (isMountedRef.current) {
        updateConsoleOutput('Process stopped\n');
      }
    } catch (error) {
      console.warn('Error in handleStop:', error);
      if (isMountedRef.current) {
        if (error.message.includes('Cannot read properties of null')) {
          updateConsoleOutput('Process already completed or stopped\n');
        } else {
          updateConsoleOutput(`Process stop attempt completed with warning: ${error.message}\n`);
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsFlashing(false);
        // Keep auto-scroll enabled for a bit longer to catch final messages (like Page4)
        setTimeout(() => {
          shouldAutoScrollRef.current = false;
        }, 1000);
      }
    }
  }, 300);

  const getStatusInfo = () => {
    if (isFlashing) {
      return {
        status: 'Flashing in Progress',
        color: 'warning',
        icon: <InfoIcon />,
        description: 'Device flashing is currently running...'
      };
    } else if (selectedFile) {
      return {
        status: 'Ready to Flash',
        color: 'success',
        icon: <CheckCircleIcon />,
        description: 'Flash file selected and ready to proceed'
      };
    } else {
      return {
        status: 'Setup Required',
        color: 'info',
        icon: <InfoIcon />,
        description: 'Please select a flash-without-bld-xxxxxx.bin file to begin'
      };
    }
  };

  const statusInfo = getStatusInfo();

  // Handle manual scroll detection
  useEffect(() => {
    const handleScroll = () => {
      if (consoleRef.current && isFlashing) {
        const isAtBottom = isScrolledToBottom();
        if (!isAtBottom && !userScrolled) {
          setUserScrolled(true);
          // Re-enable auto-scroll after 3 seconds of no manual scrolling
          setTimeout(() => {
            setUserScrolled(false);
          }, 3000);
        } else if (isAtBottom && userScrolled) {
          setUserScrolled(false);
        }
      }
    };

    const consoleElement = consoleRef.current;
    if (consoleElement) {
      consoleElement.addEventListener('scroll', handleScroll);
      return () => {
        consoleElement.removeEventListener('scroll', handleScroll);
      };
    }
  }, [isFlashing, userScrolled]);

  return (
    <Box sx={{ 
      px: layout.containerPadding.px,
      py: layout.containerPadding.py,
      height: layout.containerHeight,
      display: 'flex', 
      flexDirection: 'column',
      maxWidth: '100%',
      boxSizing: 'border-box',
      overflow: 'hidden'
    }}>
      {/* Control Panel */}
      <Box sx={{ 
        mb: layout.cardMargin,
        p: layout.cardPadding,
        borderRadius: '8px',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Button 
            variant="outlined" 
            onClick={selectFile} 
            startIcon={<FolderOpenIcon />}
            disabled={isFlashing}
            sx={{ 
              fontSize: layout.buttonFontSize,
              padding: layout.buttonPadding,
              borderRadius: '6px',
              minWidth: layout.buttonMinWidth.select,
              borderColor: 'rgba(255, 255, 255, 0.3)',
              color: 'rgba(255, 255, 255, 0.9)',
              '&:hover': {
                borderColor: 'rgba(255, 255, 255, 0.5)',
                backgroundColor: 'rgba(255, 255, 255, 0.05)'
              }
            }}
          >
            Select flash-bin
          </Button>
          
          <Box sx={{ 
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: 'rgba(255, 255, 255, 0.7)',
            fontSize: layout.buttonFontSize,
            flex: 1
          }}>
            <InfoIcon sx={{ fontSize: '18px' }} />
            <Typography variant="body2" sx={{ fontSize: layout.buttonFontSize }}>
              Fastboot Approach: Ensure you have setup your platform tools path in settings
            </Typography>
          </Box>
          
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button 
              variant="contained" 
              onClick={handleFlash} 
              disabled={isFlashing || !selectedFile}
              startIcon={<FlashOnIcon />}
              sx={{
                backgroundColor: '#2196f3',
                '&:hover': { backgroundColor: '#1976d2' },
                fontSize: layout.buttonFontSize,
                padding: layout.buttonPadding,
                borderRadius: '6px',
                minWidth: layout.buttonMinWidth.flash
              }}
            >
              {isFlashing ? 'Flashing...' : 'Flash'}
            </Button>
            <Button
              variant="contained"
              color="error"
              onClick={handleStop}
              disabled={!isFlashing}
              startIcon={<StopIcon />}
              sx={{
                fontSize: layout.buttonFontSize,
                padding: layout.buttonPadding,
                borderRadius: '6px',
                minWidth: layout.buttonMinWidth.stop
              }}
            >
              Stop
            </Button>
            <Chip 
              label={statusInfo.status} 
              color={statusInfo.color}
              variant="outlined"
              icon={statusInfo.icon}
              sx={{ 
                fontSize: layout.chipFontSize,
                height: layout.chipHeight,
                borderRadius: '17px',
                // Custom styling for warning state to ensure readability
                ...(statusInfo.color === 'warning' && {
                  backgroundColor: 'rgba(255, 152, 0, 0.1)',
                  borderColor: 'rgba(255, 152, 0, 0.5)',
                  color: '#ff9800',
                  '& .MuiChip-icon': {
                    color: '#ff9800'
                  }
                })
              }}
            />
          </Box>
        </Stack>
      </Box>

      {/* Status Cards */}
      {(selectedFile || (configLoaded && platformTools)) && (
        <Stack direction="row" spacing={layout.cardMargin} sx={{ mb: layout.cardMargin }}>
          {selectedFile && (
            <Box sx={{ 
              flex: 1,
              p: layout.cardPadding,
              borderRadius: '6px',
              backgroundColor: 'rgba(76, 175, 80, 0.1)',
              border: '1px solid rgba(76, 175, 80, 0.3)'
            }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <CheckCircleIcon sx={{ color: '#4CAF50', fontSize: '18px' }} />
                <Typography variant="body2" sx={{ fontSize: layout.pathFontSize, color: '#4CAF50', fontWeight: 500 }}>
                  Selected File
                </Typography>
              </Stack>
              <Typography variant="body2" sx={{ 
                fontSize: layout.pathFontSize,
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: 'monospace',
                wordBreak: 'break-all'
              }}>
                {getShortFilePath(selectedFile)}
              </Typography>
            </Box>
          )}

          {configLoaded && (
            <Box sx={{ 
              flex: 1,
              p: layout.cardPadding,
              borderRadius: '6px',
              backgroundColor: platformTools ? 'rgba(76, 175, 80, 0.1)' : 'rgba(255, 152, 0, 0.1)',
              border: `1px solid ${platformTools ? 'rgba(76, 175, 80, 0.3)' : 'rgba(255, 152, 0, 0.3)'}`
            }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                {platformTools ? (
                  <CheckCircleIcon sx={{ color: '#4CAF50', fontSize: '18px' }} />
                ) : (
                  <ErrorIcon sx={{ color: '#ff9800', fontSize: '18px' }} />
                )}
                <Typography variant="body2" sx={{ 
                  fontSize: layout.pathFontSize, 
                  color: platformTools ? '#4CAF50' : '#ff9800',
                  fontWeight: 500
                }}>
                  Platform Tools
                </Typography>
              </Stack>
              <Typography variant="body2" sx={{ 
                fontSize: layout.pathFontSize,
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: 'monospace',
                wordBreak: 'break-all'
              }}>
                {platformTools || 'Not configured - Check Settings'}
              </Typography>
            </Box>
          )}
        </Stack>
      )}

      {/* Console Output */}
      <ConsoleContainer sx={{ 
        flexGrow: 1,
        display: 'flex', 
        flexDirection: 'column',
        minHeight: 0,
        borderRadius: layout.consoleBorderRadius,
        border: '1px solid rgba(255, 255, 255, 0.1)',
        overflow: 'hidden'
      }}>
        <ConsoleHeader sx={{
          backgroundColor: '#2a2a2a',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          flexShrink: 0
        }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#ff5f57' }} />
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#ffbd2e' }} />
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#28ca42' }} />
          
          <Typography variant="body2" sx={{ color: '#aaa', ml: 2, fontSize: layout.buttonFontSize }}>
            Console Output
          </Typography>
          
          {isFlashing && userScrolled && (
            <Typography variant="caption" sx={{ 
              ml: 'auto',
              fontSize: '11px',
              color: '#ff9800',
              backgroundColor: 'rgba(255, 152, 0, 0.1)',
              padding: '2px 8px',
              borderRadius: '4px'
            }}>
              Manual scroll - Auto-scroll resumes in 3s
            </Typography>
          )}
        </ConsoleHeader>
        
        <Box 
          ref={consoleRef}
          sx={{ 
            flexGrow: 1, 
            overflow: 'auto', 
            backgroundColor: '#1e1e1e',
            padding: '10px',
            '&::-webkit-scrollbar': {
              width: '14px',
              backgroundColor: '#2a2a2a',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: '#1e1e1e',
              borderRadius: '8px',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: '#555',
              borderRadius: '8px',
              border: '2px solid #1e1e1e',
              '&:hover': {
                backgroundColor: '#777',
              },
              '&:active': {
                backgroundColor: '#999',
              },
            },
            scrollbarWidth: 'auto',
            scrollbarColor: '#555 #1e1e1e',
          }}
        >
          {consoleOutput ? (
            <StyledPre 
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(consoleOutput) }}
            />
          ) : (
            <Typography sx={{ 
              color: '#666', 
              fontStyle: 'italic',
              fontSize: '15px',
              textAlign: 'center',
              mt: 4
            }}>
              Console output will appear here...
            </Typography>
          )}
        </Box>
      </ConsoleContainer>

      {/* Progress Bar - Ensure always visible */}
      {isFlashing && (
        <Box sx={{ flexShrink: 0, mt: 1.5, mb: 1 }}>
          <LinearProgress 
            sx={{ 
              height: 8,
              borderRadius: 4,
              backgroundColor: '#333',
              '& .MuiLinearProgress-bar': {
                backgroundColor: '#ff9800',
                borderRadius: 4,
              }
            }} 
          />
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
            <Typography variant="body2" sx={{ color: '#aaa', fontSize: '14px' }}>
              Flashing in progress...
            </Typography>
            <Typography variant="caption" sx={{ color: '#666', fontSize: '12px' }}>
              Please do not close the application or switch tabs
            </Typography>
          </Stack>
        </Box>
      )}

    </Box>
  );
}

export default RfdFlashPage;
