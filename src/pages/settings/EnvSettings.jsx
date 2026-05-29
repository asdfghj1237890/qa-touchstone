import React, { useState, useEffect } from 'react';
import { 
  Button, 
  FormGroup, 
  FormControlLabel, 
  Checkbox, 
  Typography, 
  Box,
  Paper,
  Grid,
  Stack,
  Divider,
  Chip
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { PRODUCT_EDITION } from '../../productConfig';

function EnvSettings() {
  const showVisiblePages = PRODUCT_EDITION === 'internal';
  const [platformToolsPath, setPlatformToolsPath] = useState('');
  const [certificatesPath, setCertificatesPath] = useState('');
  const [postmanCollectionPath, setPostmanCollectionPath] = useState('');
  const [visiblePages, setVisiblePages] = useState({
    credentials: true,
    flashNordic: true,
    flashSilabs: true,
    flashEFD: true,
    flashRFD: true,
    tab6: true,
    apiTest: true,
    tab8: false
  });

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const config = await window.electronAPI.loadConfig();
      console.log('[Setting1] Loaded config:', config);
      
      if (config && typeof config === 'object') {
        setPlatformToolsPath(config.platformTools || '');
        setCertificatesPath(config.credentials || '');
        setPostmanCollectionPath(config.postmanCollectionPath || '');
        
        // Ensure visiblePages is valid before setting
        if (config.visiblePages && typeof config.visiblePages === 'object') {
          setVisiblePages(config.visiblePages);
        } else {
          console.warn('[Setting1] Invalid visiblePages in config, using defaults');
          setVisiblePages({
            credentials: true,
            flashNordic: true,
            flashSilabs: true,
            flashEFD: true,
            flashRFD: true,
            tab6: true,
            apiTest: true,
            tab8: false
          });
        }
      } else {
        console.error('[Setting1] Invalid config object received:', config);
      }
    } catch (error) {
      console.error('[Setting1] Error loading config:', error);
    }
  };

  const handlePageVisibilityChange = async (pageName) => {
    const newVisiblePages = {
      ...visiblePages,
      [pageName]: !visiblePages[pageName]
    };
    console.log('[Settings] Local state updated:', newVisiblePages);
    setVisiblePages(newVisiblePages);
    
    try {
      console.log('[Settings] Calling electronAPI.saveVisiblePages');
      const result = await window.electronAPI.saveVisiblePages(newVisiblePages);
      if (!result.success) {
        console.error('[Settings] Save failed:', result.error);
      } else {
        console.log('[Settings] Save successful');
      }
    } catch (error) {
      console.error('[Settings] Save error:', error);
    }
  };

  const handleSelectFolder = async (settingName) => {
    try {
      const result = await window.electronAPI.selectDirectory();
      if (result) {
        if (settingName === 'platformTools') {
          setPlatformToolsPath(result);
        } else if (settingName === 'credentials') {
          setCertificatesPath(result);
          // Await the scan to ensure it completes before saving
          await window.electronAPI.scanCertificates(result);
        } else if (settingName === 'postmanCollectionPath') {
          setPostmanCollectionPath(result);
        }
        const saveResult = await window.electronAPI.saveConfig({ [settingName]: result });
        if (!saveResult.success) {
          console.error('Failed to save config:', saveResult.error);
        } else {
          console.log(`Successfully saved ${settingName}:`, result);
        }
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
    }
  };

  const PathSelector = ({ title, path, onSelect, settingName }) => (
    <Stack 
      direction={{ xs: 'column', sm: 'row' }} 
      spacing={2} 
      alignItems={{ xs: 'stretch', sm: 'center' }} 
      sx={{ minHeight: 48 }}
    >
      <Button
        variant="outlined"
        startIcon={<FolderIcon />}
        onClick={() => onSelect(settingName)}
        sx={{ 
          minWidth: { xs: '100%', sm: 200, md: 220 },
          textTransform: 'none',
          fontWeight: 500,
          flexShrink: 0
        }}
      >
        {title}
      </Button>
      <Typography 
        variant="body2" 
        sx={{ 
          flex: 1,
          color: path ? 'text.primary' : 'text.secondary',
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          wordBreak: 'break-all',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
          lineHeight: 1.4
        }}
        title={path || 'No path selected'}
      >
        {path || 'No path selected'}
      </Typography>
    </Stack>
  );

  const pageLabels = {
    credentials: 'Certificates',
    flashNordic: 'Flash Nordic',
    flashSilabs: 'Flash Silabs',
    flashEFD: 'Flash EFD',
    flashRFD: 'Flash RFD',
    tab6: 'Files',
    apiTest: 'API Testing',
    tab8: 'Tab 8'
  };

  const pageStatuses = {
    tab8: 'Not Ready'
  };

  return (
    <Box sx={{ 
      p: 3, 
      maxWidth: { xs: '100%', sm: 1200, lg: 1400, xl: 1600 },
      mx: 'auto',
      width: '100%'
    }}>
      <Box sx={{ 
        display: 'flex',
        gap: 3,
        flexDirection: { xs: 'column', md: 'row' },
        width: '100%'
      }}>
        {/* Environment Paths Section */}
        <Box sx={{ 
          flex: { xs: '1 1 100%', md: showVisiblePages ? '1 1 60%' : '1 1 100%' },
          minWidth: 0
        }} data-testid="env-paths-section">
          <Paper sx={{ p: 3, height: 'fit-content' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
              <FolderIcon color="primary" />
              <Typography variant="h6" fontWeight={600}>
                Environment Paths
              </Typography>
            </Stack>
            
            <Stack spacing={2.5}>
              <PathSelector
                title="Platform Tools"
                path={platformToolsPath}
                onSelect={handleSelectFolder}
                settingName="platformTools"
              />
              <Divider />
              <PathSelector
                title="Certificates"
                path={certificatesPath}
                onSelect={handleSelectFolder}
                settingName="credentials"
              />
              <Divider />
              <PathSelector
                title="Postman Collections"
                path={postmanCollectionPath}
                onSelect={handleSelectFolder}
                settingName="postmanCollectionPath"
              />
            </Stack>
          </Paper>
        </Box>

        {/* Visible Pages Section */}
        {showVisiblePages && (
          <Box sx={{
            flex: { xs: '1 1 100%', md: '1 1 40%' },
            minWidth: 0
          }} data-testid="visible-pages-section">
            <Paper sx={{ p: 3, height: 'fit-content' }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
                <VisibilityIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  Visible Pages
                </Typography>
              </Stack>

              <FormGroup>
                <Stack spacing={1.5}>
                  {Object.entries(pageLabels).map(([key, label]) => (
                    <FormControlLabel
                      key={key}
                      control={
                        <Checkbox
                          checked={Boolean(visiblePages[key])}
                          onChange={() => handlePageVisibilityChange(key)}
                          size="small"
                        />
                      }
                      label={
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Typography variant="body2" fontWeight={500}>
                            {label}
                          </Typography>
                          {pageStatuses[key] && (
                            <Chip
                              label={pageStatuses[key]}
                              size="small"
                              variant="outlined"
                              color="warning"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          )}
                        </Stack>
                      }
                      sx={{
                        margin: 0,
                        '& .MuiFormControlLabel-label': {
                          fontSize: '0.9rem'
                        }
                      }}
                    />
                  ))}
                </Stack>
              </FormGroup>
            </Paper>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default EnvSettings;
