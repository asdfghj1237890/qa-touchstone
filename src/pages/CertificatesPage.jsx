import React, { useEffect, useMemo, useState } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  Chip, 
  Alert, 
  Stack,
  IconButton,
  Tooltip
} from '@mui/material';
import { 
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import CertificatesDataGrid from '../components/CertificatesDataGrid.jsx';
import { useCertificates } from '../contexts/CertificatesContext.jsx';

function CertificatesPage() {
  const {
    certificateFolderPath,
    certificatesData,
    initialFilter,
    initialSelection,
    isLoading,
    error,
    updateCertificateFolderPath,
    refreshCertificatesData,
    reloadFilter
  } = useCertificates();

  // Debug log for initialFilter
  useEffect(() => {
    console.log('[DEBUG CertificatesPage] initialFilter changed:', initialFilter ? JSON.stringify(initialFilter, null, 2) : 'null');
  }, [initialFilter]);

  // Reload filter when component mounts (user navigates back to this page)
  // Since TabPanel unmounts components when switching tabs, this will run every time user returns
  useEffect(() => {
    console.log('[DEBUG CertificatesPage] Component mounted, reloading filter...');
    if (reloadFilter) {
      // Add a small delay to ensure the component is fully mounted and ready
      setTimeout(() => {
        reloadFilter();
      }, 50);
    }
  }, [reloadFilter]);

  // State to hold flash path data certificate_folder_path
  const [flashPathCertificatePath, setFlashPathCertificatePath] = useState('');

  // Load flash path data certificate_folder_path on component mount and when needed
  useEffect(() => {
    const loadFlashPathCertificatePath = async () => {
      try {
        const flashPathData = await window.electronAPI.getFlashPathData('nordic');
        setFlashPathCertificatePath(flashPathData.certificate_folder_path || '');
        console.log('[DEBUG CertificatesPage] Loaded flashPathCertificatePath:', flashPathData.certificate_folder_path || '');
      } catch (error) {
        console.error('Error loading flash path certificate_folder_path:', error);
        setFlashPathCertificatePath('');
      }
    };

    loadFlashPathCertificatePath();
  }, [certificatesData, initialSelection]); // Reload when certificates or selection changes

  // Add event listener for certificate selection changes to reload flash path data
  useEffect(() => {
    const handleCertificateSelectionChange = async (event) => {
      const { flashPathDataUpdated } = event.detail || {};
      console.log('[DEBUG CertificatesPage] Certificate selection changed, flashPathDataUpdated:', flashPathDataUpdated);
      
      // Only reload if flash path data was actually updated
      if (flashPathDataUpdated) {
        // Add a small delay to ensure the data is fully written to the file
        setTimeout(async () => {
          try {
            const flashPathData = await window.electronAPI.getFlashPathData('nordic');
            setFlashPathCertificatePath(flashPathData.certificate_folder_path || '');
            console.log('[DEBUG CertificatesPage] Updated flashPathCertificatePath after selection change:', flashPathData.certificate_folder_path || '');
          } catch (error) {
            console.error('Error reloading flash path certificate_folder_path after selection change:', error);
            setFlashPathCertificatePath('');
          }
        }, 100); // 100ms delay to ensure file write is complete
      }
    };

    // Listen for certificate selection change events
    if (typeof window !== 'undefined') {
      window.addEventListener('certificateSelectionChanged', handleCertificateSelectionChange);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('certificateSelectionChanged', handleCertificateSelectionChange);
      }
    };
  }, []);

  // Handle refresh button click
  const handleRefresh = async () => {
    if (isLoading) return;
    
    console.log('[DEBUG CertificatesPage] Refresh button clicked');
    try {
      await refreshCertificatesData();
      
      // Also refresh the flash path certificate_folder_path
      const flashPathData = await window.electronAPI.getFlashPathData('nordic');
      setFlashPathCertificatePath(flashPathData.certificate_folder_path || '');
      
      console.log('[DEBUG CertificatesPage] Refresh completed');
    } catch (error) {
      console.error('Error refreshing certificates data:', error);
    }
  };

  // Memoize path status to prevent unnecessary re-calculations
  const pathStatus = useMemo(() => {
    // Check if a certificate is selected
    const hasSelectedCertificate = initialSelection && initialSelection.length > 0;
    const selectedCertificate = hasSelectedCertificate && certificatesData 
      ? certificatesData.find(cert => cert.id === initialSelection[0])
      : null;

    // Check flash path data certificate_folder_path instead of in-memory certificateFolderPath
    if (flashPathCertificatePath && flashPathCertificatePath.trim() !== '') {
      return { type: 'success', message: 'Certificate folder configured', icon: <CheckIcon /> };
    } else if (selectedCertificate) {
      return { type: 'success', message: `Certificate selected: ${selectedCertificate.certificateid}`, icon: <CheckIcon /> };
    } else {
      return { type: 'warning', message: 'No certificate selected', icon: <WarningIcon /> };
    }
  }, [flashPathCertificatePath, initialSelection, certificatesData]);

  // Memoize certificate count to prevent unnecessary re-calculations
  const certificateCount = useMemo(() => {
    return certificatesData ? certificatesData.length : 0;
  }, [certificatesData]);

  return (
    <Box sx={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      gap: 1.5,
      p: 1
    }}>
      {/* Compact Header Section */}
      <Paper elevation={1} sx={{ p: 2, backgroundColor: 'background.paper', flexShrink: 0 }}>
        <Stack direction="row" alignItems="center" spacing={2} mb={1.5}>
          <Chip
            icon={pathStatus.icon}
            label={pathStatus.message}
            color={pathStatus.type}
            variant="outlined"
            size="small"
            onClick={() => {}}
          />
          {certificateCount > 0 && (
            <Chip
              icon={<InfoIcon />}
              label={`${certificateCount} certificates`}
              color="info"
              variant="outlined"
              size="small"
              onClick={() => {}}
            />
          )}
          <Box sx={{ ml: 'auto' }}>
            <Tooltip title="Refresh certificates data">
              <IconButton
                size="small"
                onClick={handleRefresh}
                disabled={isLoading}
                sx={{ 
                  p: 0.5,
                  '&:hover': {
                    backgroundColor: 'action.hover'
                  }
                }}
              >
                <RefreshIcon 
                  sx={{ 
                    fontSize: '1.2rem',
                    transform: isLoading ? 'rotate(360deg)' : 'rotate(0deg)',
                    transition: 'transform 0.6s ease-in-out'
                  }} 
                />
              </IconButton>
            </Tooltip>
          </Box>
        </Stack>

        {/* Current Path Display - More Compact */}
        {flashPathCertificatePath && flashPathCertificatePath.trim() !== '' ? (
          <Alert severity="info" sx={{ py: 1 }}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
              {flashPathCertificatePath}
            </Typography>
          </Alert>
        ) : (() => {
          const hasSelectedCertificate = initialSelection && initialSelection.length > 0;
          const selectedCertificate = hasSelectedCertificate && certificatesData 
            ? certificatesData.find(cert => cert.id === initialSelection[0])
            : null;

          if (selectedCertificate) {
            return (
              <Alert severity="info" sx={{ py: 1 }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  {selectedCertificate.path}
                </Typography>
              </Alert>
            );
          } else {
            return (
              <Alert severity="warning" sx={{ py: 1 }}>
                <Typography variant="body2">
                  Select a certificate from the table below to set as active certificate for flashing.
                </Typography>
              </Alert>
            );
          }
        })()}
      </Paper>

      {/* Data Grid Section - Simplified */}
      <Paper elevation={1} sx={{ 
        flexGrow: 1, 
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 400,
        height: 0 // This forces the flexGrow to work properly
      }}>
        <CertificatesDataGrid 
          isLoading={isLoading}
          error={error}
        />
      </Paper>
    </Box>
  );
}

export default React.memo(CertificatesPage);