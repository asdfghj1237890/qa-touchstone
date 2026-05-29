import React, { useState, useEffect, useCallback } from 'react';
import { Box, IconButton, ThemeProvider, createTheme, CssBaseline, Typography, Button } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import HomeIcon from '@mui/icons-material/Home';
import SecurityIcon from '@mui/icons-material/Security';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import MemoryIcon from '@mui/icons-material/Memory';
import RouterIcon from '@mui/icons-material/Router';
import ApiIcon from '@mui/icons-material/Api';
import Home from './pages/Home.jsx';
import CertificatesPage from './pages/CertificatesPage.jsx';
import NordicFlashPage from './pages/NordicFlashPage.jsx';
import SilabsFlashPage from './pages/SilabsFlashPage.jsx';
import EfdFlashPage from './pages/EfdFlashPage.jsx';
import RfdFlashPage from './pages/RfdFlashPage.jsx';
import FilesPage from './pages/FilesPage.jsx';
import ApiTestPage from './pages/ApiTestPage.jsx';
import Page7 from './pages/Page7.jsx';
import EnvSettings from './pages/settings/EnvSettings.jsx';
import NordicPathsSettings from './pages/settings/NordicPathsSettings.jsx';
import SilabsPathsSettings from './pages/settings/SilabsPathsSettings.jsx';
import ApiSettings from './pages/settings/ApiSettings.jsx';
import Setting5 from './pages/settings/Setting5.jsx';
import { FlashingProvider, useFlashing } from './contexts/FlashingContext.jsx';
import { PostmanProvider } from './contexts/PostmanContext.jsx';
import { CertificatesProvider } from './contexts/CertificatesContext.jsx';
import {
  PRODUCT_NAME,
  getVisiblePagesForEdition,
  isExternalSettingsTabVisible,
} from './productConfig.js';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import { isEqual } from 'lodash';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
  // By spreading the default breakpoints, we ensure the theme is responsive.
  breakpoints: {
    ...createTheme().breakpoints,
  },
});

// Modern pill-style navigation component
function NavigationPills({ tabs, activeTab, onChange, isFlashing }) {
  return (
    <Box sx={{
      display: 'flex',
      gap: 0.5,
      padding: '6px',
      backgroundColor: 'rgba(0,0,0,0.4)', // Use more opaque black background
      borderRadius: '20px',
      backdropFilter: 'blur(12px)', // Enhanced blur effect
      border: '1px solid rgba(255,255,255,0.15)', // Slightly enhanced border
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)', // Add shadow for layered effect
      maxWidth: {
        xs: 'calc(100vw - 120px)', // Smaller space for controls in mobile
        sm: 'calc(100vw - 180px)', // Medium space for tablet
        md: 'calc(100vw - 400px)'  // Full space for desktop
      },
      overflow: 'hidden',
      // Ensure the navigation is always centered within its container
      margin: '0 auto'
    }}>
      {tabs.map((tab, index) => (
        <Button
          key={tab.key}
          onClick={() => !isFlashing && onChange(index)}
          disabled={isFlashing}
          startIcon={tab.icon}
          data-testid={`nav-button-${tab.key}`}
          sx={{
            minWidth: {
              xs: '40px',      // Fixed width for icon-only mode
              sm: '40px',      // Fixed width for icon-only mode
              md: 'auto'       // Auto width for full mode
            },
            padding: {
              xs: '8px 8px',   // Small screen: square padding for icons
              sm: '8px 8px',   // Medium screen: square padding for icons
              md: '8px 16px'   // Large screen: normal padding
            },
            borderRadius: '16px',
            textTransform: 'none',
            fontSize: '13px',
            fontWeight: activeTab === index ? 500 : 400,
            color: activeTab === index ? (isFlashing ? 'rgba(255,255,255,0.9)' : '#000') : 'rgba(255,255,255,0.8)',
            backgroundColor: activeTab === index ? (isFlashing ? 'rgba(255,255,255,0.2)' : '#ffffff') : 'transparent',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            cursor: isFlashing ? 'not-allowed' : 'pointer',
            opacity: isFlashing && activeTab !== index ? 0.6 : 1,
            '&:hover': {
              backgroundColor: isFlashing ? (activeTab === index ? 'rgba(255,255,255,0.2)' : 'transparent') : (activeTab === index ? '#ffffff' : 'rgba(255,255,255,0.12)'),
              color: isFlashing ? (activeTab === index ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.8)') : (activeTab === index ? '#000' : '#ffffff'),
              transform: isFlashing ? 'none' : 'translateY(-1px)'
            },
            '&:disabled': {
              color: 'rgba(255,255,255,0.5)'
            },
            '& .MuiButton-startIcon': {
              marginRight: {
                xs: '0px',   // Small screen: no spacing (icon only)
                sm: '0px',   // Medium screen: no spacing (icon only) 
                md: '6px'    // Large screen: normal spacing
              },
              '& svg': {
                fontSize: '16px'
              }
            },
            // Center the icon when text is hidden
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          {/* Use span to control text display */}
          <Box 
            component="span" 
            sx={{
              display: {
                xs: 'none',     // Small screen: hide text, show icons only
                sm: 'none',     // Medium screen: hide text
                md: 'inline'    // Large screen: show text
              }
            }}
          >
            {tab.label}
          </Box>
        </Button>
      ))}
    </Box>
  );
}

// Modern window controls component
function WindowControls({ onClose, onMinimize, onMaximize }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, mr: 2, alignItems: 'center' }}>
      <IconButton 
        onClick={onMinimize} 
        size="small"
        aria-label="minimize"
        sx={{ 
          color: 'rgba(255,255,255,0.6)', 
          transition: 'all 0.2s ease',
          '&:hover': { 
            color: '#fff', 
            backgroundColor: 'rgba(255,255,255,0.1)',
            transform: 'scale(1.05)'
          }
        }}
      >
        <MinimizeIcon fontSize="small" />
      </IconButton>
      
      <IconButton 
        onClick={onMaximize} 
        size="small"
        aria-label="maximize"
        sx={{ 
          color: 'rgba(255,255,255,0.6)', 
          transition: 'all 0.2s ease',
          '&:hover': { 
            color: '#fff', 
            backgroundColor: 'rgba(255,255,255,0.1)',
            transform: 'scale(1.05)'
          }
        }}
      >
        <CropSquareIcon fontSize="small" />
      </IconButton>
      
      <IconButton 
        onClick={onClose} 
        size="small"
        aria-label="close"
        sx={{ 
          color: 'rgba(255,255,255,0.6)', 
          transition: 'all 0.2s ease',
          '&:hover': { 
            color: '#ff6b6b', 
            backgroundColor: 'rgba(255,107,107,0.1)',
            transform: 'scale(1.05)'
          }
        }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

function TabPanel({ children, value, index }) {
  // Only render children when tab is active to avoid DataGrid height issues
  if (value !== index) {
    return null;
  }

  return (
    <Box 
      role="tabpanel" 
      sx={{ 
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      <Box sx={{ 
        p: 2, 
        height: '100%',
        overflow: 'auto',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}>
        {children}
      </Box>
    </Box>
  );
}

function AppContent({ isSettingsWindow }) {
  const [value, setValue] = useState(0);
  const { isFlashing } = useFlashing();
  const [visiblePages, setVisiblePages] = useState(getVisiblePagesForEdition());

  useEffect(() => {
    console.log('[React] Initializing config listener');
    
    const handleConfigUpdate = (newConfig) => {
      console.log('[React] Received config-updated event:', newConfig);
      try {
        if (newConfig && typeof newConfig === 'object' && newConfig.visiblePages) {
          // Deep compare to avoid unnecessary re-renders and state resets
          setVisiblePages(currentVisiblePages => {
            const nextVisiblePages = getVisiblePagesForEdition(newConfig.visiblePages);
            if (!isEqual(currentVisiblePages, nextVisiblePages)) {
              console.log('[React] visiblePages have changed. Updating state:', nextVisiblePages);
              return nextVisiblePages;
            }
            console.log('[React] visiblePages are the same. No state update needed.');
            return currentVisiblePages;
          });
        } else {
          console.warn('[React] Invalid config received or missing visiblePages:', newConfig);
        }
      } catch (error) {
        console.error('[React] Error handling config update:', error);
      }
    };

    window.electronAPI.onConfigUpdated(handleConfigUpdate);
    
    return () => {
      console.log('[React] Cleaning up config listener');
      window.electronAPI.removeConfigListener(handleConfigUpdate);
    };
  }, []);

  const loadVisiblePages = useCallback(async () => {
    try {
      const config = await window.electronAPI.loadConfig();
      setVisiblePages(getVisiblePagesForEdition(config.visiblePages));
    } catch (error) {
      console.error('Error loading visible pages config:', error);
    }
  }, []);

  useEffect(() => {
    loadVisiblePages();
  }, [loadVisiblePages]);

  // Listen for tab change requests from Home component
  useEffect(() => {
    const handleTabChangeRequest = (event) => {
      const { newValue } = event.detail;
      console.log('[App] Received tab change request to:', newValue);
      handleChange(newValue);
    };

    window.addEventListener('requestTabChange', handleTabChangeRequest);
    
    return () => {
      window.removeEventListener('requestTabChange', handleTabChangeRequest);
    };
  }, []);

  useEffect(() => {
    // Reset to first tab when visible pages change - but only for main window, not settings window
    if (!isSettingsWindow) {
      setValue(0);
    }
  }, [visiblePages, isSettingsWindow]);

  const handleChange = (newValue) => {
    const maxValue = getFilteredTabs().length - 1;
    const clampedValue = Math.min(newValue, maxValue);
    
    if (!isFlashing) {
      setValue(clampedValue);
      
      // Emit a custom event when tab changes to notify components
      const tabChangeEvent = new CustomEvent('tabChanged', { 
        detail: { 
          oldValue: value, 
          newValue: clampedValue,
          timestamp: Date.now()
        } 
      });
      window.dispatchEvent(tabChangeEvent);
      console.log('[DEBUG App] Tab changed from', value, 'to', clampedValue);
    }
  };

  const handleSettingsClick = () => {
    if (window.electronAPI) {
      window.electronAPI.openSettings();
    } else {
      console.log('Electron API not available');
    }
  };

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.closeWindow(isSettingsWindow ? 'settings' : 'main');
    }
  };

  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.minimizeWindow(isSettingsWindow ? 'settings' : 'main');
    }
  };

  const handleMaximize = () => {
    if (window.electronAPI) {
      window.electronAPI.maximizeWindow(isSettingsWindow ? 'settings' : 'main');
    }
  };

  const mainTabs = [
    { label: "Home", key: "home", icon: <HomeIcon /> },
    visiblePages.credentials && { label: "Certificates", key: "tab1", icon: <SecurityIcon /> },
    visiblePages.flashNordic && { label: "Nordic", key: "tab2", icon: <FlashOnIcon /> },
    visiblePages.flashSilabs && { label: "Silabs", key: "tab3", icon: <MemoryIcon /> },
    visiblePages.flashEFD && { label: "EFD", key: "tab4", icon: <MemoryIcon /> },
    visiblePages.flashRFD && { label: "RFD", key: "tab5", icon: <RouterIcon /> },
    visiblePages.tab6 && { label: "Files", key: "tab6", icon: <ApiIcon /> },
    visiblePages.apiTest && { label: "API", key: "apiTest", icon: <ApiIcon /> },
    visiblePages.tab8 && { label: "Tab 8", key: "tab8", icon: <ApiIcon /> }
  ].filter(Boolean);

  console.log('[React] Current visiblePages:', visiblePages);
  console.log('[React] Rendered tabs:', mainTabs.map(t => t.label));

  const settingsTabs = [
    { label: "ENV", key: "setting1", icon: <SettingsIcon /> },
    { label: "Nordic Paths", key: "setting2", icon: <FlashOnIcon /> },
    { label: "Silabs Paths", key: "setting3", icon: <MemoryIcon /> },
    { label: "API Setting", key: "apiSettings", icon: <ApiIcon /> },
    { label: "Setting 5", key: "setting5", icon: <SettingsIcon /> }
  ].filter((tab) => isExternalSettingsTabVisible(tab.key));

  const settingsPages = [
    { key: "setting1", component: EnvSettings },
    { key: "setting2", component: NordicPathsSettings },
    { key: "setting3", component: SilabsPathsSettings },
    { key: "apiSettings", component: ApiSettings },
    { key: "setting5", component: Setting5 }
  ].filter((page) => isExternalSettingsTabVisible(page.key));

  const getFilteredTabs = () => {
    return isSettingsWindow ? settingsTabs : mainTabs;
  };

  const getFilteredPages = () => {
    const pages = [
      { key: "home", component: Home },
      visiblePages.credentials && { key: "tab1", component: CertificatesPage },
      visiblePages.flashNordic && { key: "tab2", component: NordicFlashPage },
      visiblePages.flashSilabs && { key: "tab3", component: SilabsFlashPage },
      visiblePages.flashEFD && { key: "tab4", component: EfdFlashPage },
      visiblePages.flashRFD && { key: "tab5", component: RfdFlashPage },
      visiblePages.tab6 && { key: "tab6", component: FilesPage },
      visiblePages.apiTest && { key: "apiTest", component: ApiTestPage },
      visiblePages.tab8 && { key: "tab8", component: Page7 }
    ].filter(Boolean);

    console.log('Filtered pages:', pages.map(p => p.key));
    return pages;
  };

  return (
    <Box sx={{ 
      width: '100%', 
      height: '100vh',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Unified Header Bar */}
      <Box sx={{
        height: '56px',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        WebkitAppRegion: 'drag',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        position: 'relative',
        zIndex: 1000
      }}>
        {/* App Title */}
        <Typography variant="h6" sx={{ 
          ml: 2, 
          color: '#ffffff', 
          fontWeight: 300,
          fontSize: '14px',
          opacity: 0.9,
          letterSpacing: '0.5px'
        }}>
          {isSettingsWindow ? 'Settings' : PRODUCT_NAME}
        </Typography>
        
        {/* Navigation Pills - Centered */}
        <Box sx={{ 
          flexGrow: 1, 
          display: 'flex', 
          justifyContent: 'center',
          alignItems: 'center',
          WebkitAppRegion: 'no-drag',
          // Ensure proper centering by accounting for left and right content
          position: 'relative'
        }}>
          <NavigationPills 
            tabs={getFilteredTabs()}
            activeTab={value}
            onChange={handleChange}
            isFlashing={isFlashing}
          />
        </Box>
        
        {/* Right side controls */}
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 1,
          WebkitAppRegion: 'no-drag'
        }}>
          {!isSettingsWindow && (
            <IconButton 
              color="inherit" 
              aria-label="settings" 
              onClick={handleSettingsClick}
              sx={{ 
                color: 'rgba(255,255,255,0.8)',
                transition: 'all 0.2s ease',
                '&:hover': {
                  color: '#ffffff',
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  transform: 'scale(1.05)'
                }
              }}
              size="small"
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          )}
          
          {/* Window Controls */}
          <WindowControls 
            onClose={handleClose}
            onMinimize={handleMinimize}
            onMaximize={handleMaximize}
          />
        </Box>
      </Box>

      {/* Content Area */}
      <Box sx={{ 
        flexGrow: 1, 
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#121212',
        height: 'calc(100vh - 56px)',
        minHeight: 0
      }}>
        {isSettingsWindow ? (
          settingsPages.map((page, index) => {
            const Component = page.component;
            return (
              <TabPanel value={value} index={index} key={page.key}>
                <Component />
              </TabPanel>
            );
          })
        ) : (
          getFilteredPages().map((page, index) => {
            const Component = page.component;
            return (
              <TabPanel value={value} index={index} key={page.key}>
                <Component />
              </TabPanel>
            );
          })
        )}
      </Box>
    </Box>
  );
}

function App() {
  const [isSettingsWindow, setIsSettingsWindow] = useState(false);

  useEffect(() => {
    // 先看 URL query（相容舊行為/測試），再退回 Tauri window label
    const windowName = new URLSearchParams(window.location.search).get('window') || window.__WINDOW_LABEL__;
    setIsSettingsWindow(windowName === 'settings');
  }, []);

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <FlashingProvider>
        <PostmanProvider>
          <CertificatesProvider>
            <AppContent isSettingsWindow={isSettingsWindow} />
          </CertificatesProvider>
        </PostmanProvider>
      </FlashingProvider>
    </ThemeProvider>
  );
}

export default App;
