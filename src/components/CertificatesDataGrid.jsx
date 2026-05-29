import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { 
  Box, 
  CircularProgress, 
  Typography, 
  IconButton, 
  Snackbar,
  Alert,
  Chip,
  Button,
  Tooltip
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { debounce } from 'lodash';
import { useCertificates } from '../contexts/CertificatesContext';
import { 
  FolderOpen as FolderOpenIcon
} from '@mui/icons-material';

// Helper function to truncate long paths
const truncatePath = (path, maxLength = 30) => {
  if (typeof path !== 'string' || path.length <= maxLength) {
    return path;
  }
  return `...${path.slice(-maxLength)}`;
};

// Utility function to copy text to clipboard
const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Failed to copy: ', err);
  }
};

function CertificatesDataGrid({ isLoading: externalLoading, error: externalError }) {
  const {
    certificatesData,
    initialFilter,
    initialSelection,
    isLoading: contextLoading,
    error: contextError,
    refreshCertificatesData,
    updateCertificatesData,
    setCertificateFolderPathOnly,
    setInitialSelection
  } = useCertificates();

  // Cache for computed chip types by path to avoid repeated directory reads
  const chipTypeCacheRef = useRef(new Map());

  const [columnWidths, setColumnWidths] = useState({});
  const prevFilterModelRef = useRef(initialFilter);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const mountedRef = useRef(true);
  const [gridInitialState, setGridInitialState] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  
  // Use external loading state if provided, otherwise use context loading state
  const isLoading = externalLoading !== undefined ? externalLoading : contextLoading;
  const error = externalError !== undefined ? externalError : contextError;



  // The filter model is now saved directly without updating the context state,
  // preventing the re-render that was resetting the filter input.
  const saveFilterModel = useCallback(async (model) => {
    try {
      await window.electronAPI.saveFilterModel(model);
    } catch (error) {
      console.error('Error saving filter model:', error);
    }
  }, []);

  const debouncedSaveFilterModel = useMemo(
    () => debounce(async (model) => {
      console.log('[DEBUG DataGrid] Debounced save triggered for filter:', model);
      const currentFilterString = JSON.stringify(prevFilterModelRef.current);
      const newFilterString = JSON.stringify(model);
      
      if (currentFilterString !== newFilterString) {
        console.log('[DEBUG DataGrid] Filter model changed, saving:', model);
        prevFilterModelRef.current = model;
        await saveFilterModel(model);
      } else {
        console.log('[DEBUG DataGrid] Filter model unchanged, skipping save');
      }
    }, 1000),
    [saveFilterModel]
  );

  const loadColumnWidths = useCallback(async () => {
    try {
      const config = await window.electronAPI.loadConfig();
      if (config && config.columnWidths) {
        setColumnWidths(config.columnWidths);
      }
    } catch (error) {
      console.error('Error loading column widths:', error);
    }
  }, []);

  useEffect(() => {
    loadColumnWidths();
  }, [loadColumnWidths]);

  // Separate effect for mount/unmount tracking
  useEffect(() => {
    mountedRef.current = true;
    
    // Set visible after a short delay to ensure parent containers have proper dimensions
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 100);
    
    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
    };
  }, []);

  // Update prevFilterModelRef when initialFilter changes (important for proper debouncing)
  useEffect(() => {
    if (initialFilter !== null) {
      console.log('[DEBUG DataGrid] Updating prevFilterModelRef with initialFilter:', initialFilter);
      prevFilterModelRef.current = initialFilter;
    }
  }, [initialFilter]);

  // Set the initial state for the grid, including the filter model
  // We use a key-based approach to force DataGrid remount when filter changes
  useEffect(() => {
    const newInitialState = {
      pagination: {
        paginationModel: { pageSize: 50, page: 0 }
      }
    };
    
    if (initialFilter) {
      const cleanModel = {
        ...initialFilter,
        items: (initialFilter.items || []).filter(item => item != null),
      };
      newInitialState.filter = { filterModel: cleanModel };
      console.log('[DEBUG DataGrid] Setting grid initial state with filter:', cleanModel);
    } else {
      console.log('[DEBUG DataGrid] Setting default grid initial state (no filter)');
    }
    
    setGridInitialState(newInitialState);
  }, [initialFilter]); // Re-run whenever initialFilter changes
  
  // Create a unique key to force DataGrid remount when filter changes
  const dataGridKey = useMemo(() => {
    return `datagrid-${JSON.stringify(initialFilter)}`;
  }, [initialFilter]);

  // Separate cleanup effect for saving filter data
  useEffect(() => {
    return () => {
      debouncedSaveFilterModel.flush();
    };
  }, [debouncedSaveFilterModel]);

  const handleFilterModelChange = useCallback((newFilterModel) => {
    console.log('[DEBUG DataGrid] Filter model changed:', newFilterModel);
    debouncedSaveFilterModel(newFilterModel);
  }, [debouncedSaveFilterModel]);

  const handleRowSelectionModelChange = useCallback((newRowSelectionModel) => {
    if (!mountedRef.current) return;
    
    console.log('[DEBUG DataGrid] User changed selection:', {
      from: initialSelection,
      to: newRowSelectionModel
    });
    
    // Convert MUI X v8 selection model format to array format for internal use
    let selectedIds = [];
    if (newRowSelectionModel && newRowSelectionModel.ids) {
      selectedIds = Array.from(newRowSelectionModel.ids);
    } else if (Array.isArray(newRowSelectionModel)) {
      // Fallback for potential array format
      selectedIds = newRowSelectionModel;
    }
    
    // Ensure we never set more than one item for MUI X v8 compatibility
    const newSelection = selectedIds.length > 0 ? [selectedIds[0]] : [];
    
    // Mark this as a user-initiated change
    const isUserDeselect = initialSelection && initialSelection.length > 0 && newSelection.length === 0;
    if (isUserDeselect) {
      console.log('[DEBUG DataGrid] User actively deselected - will clear certificate path');
      // Store a flag to indicate this was user-initiated deselection
      window._lastSelectionWasUserDeselect = true;
    } else {
      window._lastSelectionWasUserDeselect = false;
    }
    
    // Use setTimeout to defer the state update to the next tick to avoid setState during render
    setTimeout(() => {
      setInitialSelection(newSelection);
    }, 0);
  }, [setInitialSelection, initialSelection]);

  const handleColumnResize = useCallback(async (params) => {
    const newColumnWidths = { ...columnWidths, [params.colDef.field]: params.width };
    setColumnWidths(newColumnWidths);
    
    // Defer the config save to avoid blocking the render
    setTimeout(async () => {
      await window.electronAPI.saveConfig({ columnWidths: newColumnWidths });
    }, 0);
  }, [columnWidths]);

  const handleCopy = useCallback(async (text) => {
    await copyToClipboard(text);
    setSnackbarMessage('Copied to clipboard!');
    setSnackbarOpen(true);
  }, []);

  // Add a function to manually select a certificate (for explicit user actions)
  const handleExplicitCertificateSelection = useCallback((certificateId) => {
    if (certificatesData && mountedRef.current) {
      const certificate = certificatesData.find(cert => cert.certificateid === certificateId);
      if (certificate) {
        const newSelection = [certificate.id];
        // Directly update the context state. Side effects are handled by the useEffect in context.
        setInitialSelection(newSelection);
      }
    }
  }, [certificatesData, setInitialSelection]);

  const columns = useMemo(() => [
    { 
      field: 'certificateid', 
      headerName: 'Certificate ID', 
      width: 150,
      minWidth: 150,
      filterable: true,
      renderCell: (params) => (
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          width: '100%',
          height: '100%',
          position: 'relative'
        }}>
          <Typography 
            variant="body2" 
            sx={{ 
              fontFamily: 'monospace', 
              fontSize: '0.875rem',
              userSelect: 'text',
              paddingRight: '28px',
              width: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.2,
              display: 'flex',
              alignItems: 'center'
            }}
            title={params.value}
          >
            {params.value}
          </Typography>
          <IconButton 
            onClick={(event) => {
              event.stopPropagation();
              handleCopy(params.value);
            }} 
            size="small"
            sx={{ 
              opacity: 0,
              transition: 'opacity 0.2s',
              '.MuiDataGrid-row:hover &': { opacity: 0.6 },
              '&:hover': { opacity: 1 },
              width: '20px',
              height: '20px',
              position: 'absolute',
              right: 4,
              top: '50%',
              transform: 'translateY(-50%)',
              padding: '2px'
            }}
          >
            <ContentCopyIcon sx={{ fontSize: '14px' }} />
          </IconButton>
        </Box>
      )
    },
    { 
      field: 'apid', 
      headerName: 'APID', 
      width: 170,
      minWidth: 170,
      filterable: true,
      valueGetter: (value, row) => {
        // Map the APID value to display value for filtering
        const apidMap = { 
          K4zr: 'FFS_Gamma(K4zr)', 
          gksR: 'FFN_Gamma(gksR)', 
          Sh4b: 'FFS_Prod(Sh4b)', 
          Lzkc: 'FFN_Prod(Lzkc)',
          BjZN: '3P_Gamma(BjZN)',
          gBkq: '3P_Prod(gBkq)'
        };
        return apidMap[value] || value || '';
      },
      renderCell: (params) => {
        const apidMap = { 
          K4zr: 'FFS_Gamma(K4zr)', 
          gksR: 'FFN_Gamma(gksR)', 
          Sh4b: 'FFS_Prod(Sh4b)', 
          Lzkc: 'FFN_Prod(Lzkc)',
          BjZN: '3P_Gamma(BjZN)',
          gBkq: '3P_Prod(gBkq)'
        };
        // Use params.row.apid to get the original value
        const originalValue = params.row.apid;
        const displayValue = apidMap[originalValue] || originalValue || '';
        const isProduction = displayValue.includes('Prod');
        
        return (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'flex-start',
            width: '100%',
            height: '100%'
          }}>
            <Chip
              label={displayValue}
              size="small"
              variant="outlined"
              color={isProduction ? 'error' : 'success'}
              sx={{ 
                fontSize: '0.75rem',
                height: '28px',
                fontWeight: 500,
                maxWidth: '100%'
              }}
            />
          </Box>
        );
      }
    },
    {
      field: 'type',
      headerName: 'Type',
      width: 180,
      minWidth: 160,
      filterable: false,
      sortable: false,
      renderCell: (params) => {
        const TypeChips = ({ path }) => {
          const [types, setTypes] = useState({ nordic: false, silabs: false });

          useEffect(() => {
            let isActive = true;
            const lower = (s) => (typeof s === 'string' ? s.toLowerCase() : '');

            const detectFromNames = (names) => {
              const hasNordic = names.some((n) => lower(n).endsWith('.hex'));
              const hasSilabs = names.some((n) => lower(n).endsWith('.s37'));
              return { nordic: hasNordic, silabs: hasSilabs };
            };

            const detect = async () => {
              if (!path || typeof path !== 'string') {
                return;
              }

              if (chipTypeCacheRef.current.has(path)) {
                const cached = chipTypeCacheRef.current.get(path);
                if (isActive) setTypes(cached);
                return;
              }

              // Try reading directory first
              try {
                const entries = await window.electronAPI.readDirectory(path);
                if (Array.isArray(entries)) {
                  const result = detectFromNames(entries);
                  chipTypeCacheRef.current.set(path, result);
                  if (isActive) setTypes(result);
                  return;
                }
              } catch (e) {
                // Fallback to checking the path string itself
              }

              const lp = lower(path);
              const fallback = {
                nordic: lp.includes('.hex'),
                silabs: lp.includes('.s37')
              };
              chipTypeCacheRef.current.set(path, fallback);
              if (isActive) setTypes(fallback);
            };

            detect();
            return () => { isActive = false; };
          }, [path]);

          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%', height: '100%' }}>
              {types.nordic && (
                <Chip
                  label="Nordic"
                  size="small"
                  variant="outlined"
                  color="info"
                  sx={{ fontSize: '0.75rem', height: '24px' }}
                />
              )}
              {types.silabs && (
                <Chip
                  label="Silabs"
                  size="small"
                  variant="outlined"
                  color="info"
                  sx={{ fontSize: '0.75rem', height: '24px' }}
                />
              )}
            </Box>
          );
        };

        return <TypeChips path={params.row.path} />;
      }
    },
    { 
      field: 'deviceid', 
      headerName: 'Device ID', 
      width: 380,
      minWidth: 380,
      filterable: true,
      renderCell: (params) => (
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          width: '100%',
          height: '100%',
          position: 'relative'
        }}>
          <Typography 
            variant="body2" 
            sx={{ 
              fontFamily: 'monospace', 
              fontSize: '0.875rem',
              userSelect: 'text',
              paddingRight: '28px',
              width: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.2,
              display: 'flex',
              alignItems: 'center'
            }}
            title={params.value}
          >
            {params.value}
          </Typography>
          <IconButton 
            onClick={(event) => {
              event.stopPropagation();
              handleCopy(params.value);
            }} 
            size="small"
            sx={{ 
              opacity: 0,
              transition: 'opacity 0.2s',
              '.MuiDataGrid-row:hover &': { opacity: 0.6 },
              '&:hover': { opacity: 1 },
              width: '20px',
              height: '20px',
              position: 'absolute',
              right: 4,
              top: '50%',
              transform: 'translateY(-50%)',
              padding: '2px'
            }}
          >
            <ContentCopyIcon sx={{ fontSize: '14px' }} />
          </IconButton>
        </Box>
      )
    },
    { 
      field: 'remark', 
      headerName: 'Remark', 
      width: 200,
      minWidth: 200,
      editable: true, 
      filterable: true,
      renderCell: (params) => (
        <Typography 
          variant="body2" 
          sx={{ 
            fontSize: '0.875rem',
            color: params.value ? 'text.primary' : 'text.disabled',
            fontStyle: params.value ? 'normal' : 'italic'
          }}
        >
          {params.value || 'Click to add...'}
        </Typography>
      )
    },
    { 
      field: 'path', 
      headerName: 'Certificate Path', 
      minWidth: 200,
      flex: 1,
      filterable: true,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%' }}>
          <Tooltip title={params.value} placement="top-start">
            <Typography 
              variant="body2" 
              sx={{ 
                fontFamily: 'monospace', 
                fontSize: '0.875rem',
                userSelect: 'text',
                width: '100%',
                
                direction: 'rtl',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {params.value}
            </Typography>
          </Tooltip>
        </Box>
      )
    },
  ], [columnWidths, handleCopy, setCertificateFolderPathOnly]);

  const processRowUpdate = useCallback(async (newRow, oldRow) => {
    if (!newRow || !oldRow || !mountedRef.current) {
      return oldRow || newRow || {};
    }
    
    if (newRow.remark !== oldRow.remark && certificatesData) {
      try {
        const updatedUserData = certificatesData.map((row) => (row.id === newRow.id ? newRow : row));
        const success = await updateCertificatesData(updatedUserData);
        return success ? newRow : oldRow;
      } catch (error) {
        console.error('Error saving user data:', error);
        return oldRow;
      }
    }
    return newRow;
  }, [certificatesData, updateCertificatesData]);

  const handleProcessRowUpdateError = useCallback((error) => {
    console.error('Error updating row:', error);
  }, []);

  if (isLoading) {
    return (
      <Box sx={{ 
        height: '100%', 
        width: '100%',
        minHeight: 400,
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center',
        gap: 2
      }}>
        <CircularProgress size={48} />
        <Typography variant="body1" color="text.secondary">
          Loading certificates...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ 
        height: '100%', 
        width: '100%',
        minHeight: 400,
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center',
        gap: 2,
        p: 3
      }}>
        <Alert severity="error" sx={{ width: '100%', maxWidth: 600 }}>
          <Typography variant="h6" gutterBottom>
            Failed to Load Certificates
          </Typography>
          <Typography variant="body2">
            {error}
          </Typography>
        </Alert>
        <IconButton onClick={refreshCertificatesData} color="primary">
          <RefreshIcon />
        </IconButton>
      </Box>
    );
  }

  if (!certificatesData || certificatesData.length === 0) {
    return (
      <Box sx={{ 
        height: '100%', 
        width: '100%',
        minHeight: 400,
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center',
        gap: 2,
        p: 3
      }}>
        <SearchIcon sx={{ fontSize: 64, color: 'text.disabled' }} />
        <Typography variant="h6" color="text.secondary">
          No Certificates Found
        </Typography>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          No certificate files were found in the selected folder.
          <br />
          Please check the folder path or scan a different location.
        </Typography>
        <IconButton onClick={refreshCertificatesData} color="primary">
          <RefreshIcon />
        </IconButton>
      </Box>
    );
  }

  if (!isVisible) {
    return (
      <Box sx={{ 
        height: '100%', 
        width: '100%',
        minHeight: 400,
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center',
        gap: 2
      }}>
        <CircularProgress size={24} />
        <Typography variant="body2" color="text.secondary">
          Initializing...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', width: '100%', minHeight: 400, position: 'relative' }}>
      <DataGrid
        key={dataGridKey}
        rows={certificatesData}
        columns={columns}
        getRowId={(row) => row.id}
        checkboxSelection
        disableMultipleRowSelection
        onRowSelectionModelChange={handleRowSelectionModelChange}
        rowSelectionModel={
          initialSelection && initialSelection.length > 0 
            ? { type: 'include', ids: new Set([initialSelection[0]]) }
            : { type: 'include', ids: new Set() }
        }
        onColumnResize={handleColumnResize}
        disableColumnMenu={false}
        pagination
        pageSizeOptions={[25, 50, 100]}
        initialState={gridInitialState || {
          pagination: {
            paginationModel: { pageSize: 50, page: 0 }
          }
        }}
        processRowUpdate={processRowUpdate}
        onProcessRowUpdateError={handleProcessRowUpdateError}
        onFilterModelChange={handleFilterModelChange}
        disableRowSelectionOnClick={false}
        onCellDoubleClick={(params, event) => {
          // Allow double-clicking to edit remark
        }}
        checkboxSelectionVisibleOnly={false}
        isCellEditable={(params) => {
          return params.field === 'remark';
        }}
        sx={{ 
          height: '100%',
          width: '100%',
          minHeight: 400,
          border: 'none',
          '& .MuiDataGrid-columnHeaders': {
            backgroundColor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
          },
          '& .MuiDataGrid-row': {
            cursor: 'pointer',
            '&:hover': {
              backgroundColor: 'action.hover',
            },
            '&.Mui-selected': {
              backgroundColor: 'rgba(25, 118, 210, 0.08)',
              '&:hover': {
                backgroundColor: 'rgba(25, 118, 210, 0.12)',
              },
            },
          },
          '& .MuiDataGrid-cell': {
            borderBottom: '1px solid',
            borderColor: 'divider',
            padding: '8px 12px',
            '&:focus': {
              outline: 'none',
            }
          },
          '& .MuiDataGrid-cell--editable': {
            cursor: 'text',
          },
        }}
      />
      
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={2000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ position: 'fixed' }}
      />
    </Box>
  );
}

export default React.memo(CertificatesDataGrid); 