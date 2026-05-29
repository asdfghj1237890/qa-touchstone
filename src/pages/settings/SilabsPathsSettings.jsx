import React, { useState, useEffect } from 'react';
import { 
  Button, 
  Typography, 
  Box, 
  TextField,
  Paper,
  Grid,
  Stack,
  Divider,
  Chip,
  IconButton,
  Tooltip
} from '@mui/material';
import { DataGrid, useGridApiContext } from '@mui/x-data-grid';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SaveIcon from '@mui/icons-material/Save';
import LoadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import AppsIcon from '@mui/icons-material/Apps';

function SilabsPathsSettings() {
  const [testAppPath, setTestAppPath] = useState('');
  const [pathData, setPathData] = useState([]);
  const [rowSelectionModel, setRowSelectionModel] = useState({ type: 'include', ids: new Set() });
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 });

  // Helper functions defined at the top
  const getFileName = (path) => {
    if (!path) return '';
    return path.split([/[/\\]/]).pop();
  };

  // Unified path display function that matches the table's valueGetter logic
  const getDisplayPath = (fullPath, type) => {
    if (!fullPath) return '';
    
    if (type === 'testApp') {
      // Match the table's logic for test app paths
      const searchStr = 'sid_test_apps';
      const firstIndex = fullPath.indexOf(searchStr);
      if (firstIndex === -1) return fullPath;
      
      const secondIndex = fullPath.indexOf(searchStr, firstIndex + 1);
      return secondIndex !== -1 ? fullPath.substring(secondIndex) : fullPath;
    }
    
    return fullPath;
  };

  const getPathSummary = (fullPath, type) => {
    if (!fullPath) return '';
    
    const fileName = fullPath.split(/[/\\]/).pop();
    
    // For test app paths, extract patterns like "sid_test_apps-silabs-debug-images-16"
    if (type === 'testApp') {
      // Look for patterns like "sid_test_apps-silabs-debug-images-XXXX"
      const testAppMatch = fileName.match(/(sid_test_apps[-_]silabs[-_]debug[-_]images[-_]\d+)/i);
      if (testAppMatch) {
        return testAppMatch[1];
      }
      
      // Fallback to look for any sid_test_apps pattern with version numbers
      const sidTestMatch = fileName.match(/(sid_test_apps[-_][^\\\/]*\d+)/i);
      if (sidTestMatch) {
        return sidTestMatch[1];
      }
      
      // Look for chip patterns as secondary option
      const chipMatch = fileName.match(/(silabs\d+)/i);
      if (chipMatch) {
        return chipMatch[1];
      }
    }
    
    return fileName;
  };

  useEffect(() => {
    loadFlashPathData();
  }, []);

  const loadFlashPathData = async () => {
    try {
      const data = await window.electronAPI.getFlashPathData('silabs');
      setTestAppPath(data.current_used_paths?.testAppPath || '');
      setPathData(data.saved_paths || []);
    } catch (error) {
      console.error('Error loading flash path data:', error);
    }
  };

  const selectFile = async (settingName) => {
    const result = await window.electronAPI.selectFile();
    if (result) {
      // Enforce .s37 for Silabs test app build files
      if (settingName === 'testAppPath') {
        const isS37 = typeof result === 'string' && result.toLowerCase().endsWith('.s37');
        if (!isS37) {
          console.warn('Please select a .s37 file for Silabs test app build.');
          return;
        }
        setTestAppPath(result);
      }
      await window.electronAPI.updateFlashPathData({
        path_type: 'silabs',
        current_used_paths: {
          [settingName]: result,
        },
      });
    }
  };

  const EditVersionCell = (params) => {
    const { id, field, value } = params;
    const [inputValue, setInputValue] = useState(value);
    const apiRef = useGridApiContext();

    const handleChange = (event) => {
      setInputValue(event.target.value);
    };

    const handleCommit = async () => {
      // Submit changes to DataGrid
      await apiRef.current.setEditCellValue({ id, field, value: inputValue });
      // Exit edit mode
      apiRef.current.stopCellEditMode({ id, field });
    };

    const handleBlur = () => {
      handleCommit();
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Enter') {
        handleCommit();
      }
    };

    return (
      <TextField
        fullWidth
        value={inputValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        size="small"
      />
    );
  };

  const columns = [
    { 
      field: 'version', 
      headerName: 'Version', 
      width: 110,
      minWidth: 90,
      editable: true,
      align: 'center',
      headerAlign: 'center',
      renderEditCell: (params) => <EditVersionCell {...params} />
    },
    { 
      field: 'test_app_path', 
      headerName: 'Test App Path', 
      flex: 1.2,
      minWidth: 250,
      renderCell: (params) => {
        const originalPath = params.row.test_app_path;
        if (!originalPath) {
          return (
            <Typography 
              variant="body2" 
              sx={{ 
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                color: 'text.secondary'
              }}
            >
              No path
            </Typography>
          );
        }
        
        // Apply the display logic directly in renderCell
        const searchStr = 'sid_test_apps';
        const firstIndex = originalPath.indexOf(searchStr);
        let displayValue = originalPath;
        
        if (firstIndex !== -1) {
          const secondIndex = originalPath.indexOf(searchStr, firstIndex + 1);
          if (secondIndex !== -1) {
            displayValue = originalPath.substring(secondIndex);
          }
        }
        
        return (
          <Typography 
            variant="body2" 
            sx={{ 
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              width: '100%',
              wordBreak: 'break-all',
              lineHeight: 1.4,
              py: 0.5
            }}
            title={originalPath}
          >
            {displayValue}
          </Typography>
        );
      }
    },
  ];

  const loadChosePath = async () => {
    if (rowSelectionModel.ids && rowSelectionModel.ids.size === 1) {
      const selectedId = Array.from(rowSelectionModel.ids)[0];
      const selectedPath = pathData.find((path) => path.id === selectedId);
      setTestAppPath(selectedPath.test_app_path);
      await window.electronAPI.updateFlashPathData({
        path_type: 'silabs',
        current_used_paths: {
          testAppPath: selectedPath.test_app_path
        },
      });
    }
  };

  const saveChosePath = async () => {
    // Add check for empty path
    if (!testAppPath) {
      console.warn('Test App Path must be selected before saving.');
      return; // Prevent saving if path is empty
    }

    try {
      const newPathData = [
        ...pathData,
        {
          id: Date.now(),
          test_app_path: testAppPath,
          version: '' // Default version, can be edited later
        },
      ];
      const result = await window.electronAPI.updateFlashPathData({ 
        path_type: 'silabs',
        saved_paths: newPathData 
      });
      await window.electronAPI.updateFlashPathData({
        path_type: 'silabs',
        current_used_paths: {
          testAppPath
        }
      });
      if (result && result.success) {
          setPathData(newPathData);
      } else {
          console.error('Failed to save path data to file.', result?.error);
      }
    } catch (error) {
      console.error('Error saving chosen path:', error);
    }
  };

  const deleteChosePath = async () => {
    if (rowSelectionModel.ids && rowSelectionModel.ids.size === 1) {
      try {
        const selectedId = Array.from(rowSelectionModel.ids)[0];
        const newPathData = pathData.filter((path) => path.id !== selectedId);
        await window.electronAPI.updateFlashPathData({ 
          path_type: 'silabs',
          saved_paths: newPathData 
        });
        setPathData(newPathData);
        setRowSelectionModel({ type: 'include', ids: new Set() });
      } catch (error) {
        console.error('Error deleting chosen path:', error);
      }
    }
  };

  const processRowUpdate = async (newRow, oldRow) => {
    if (!newRow || !oldRow) {
      console.error('Invalid row data:', { newRow, oldRow });
      return oldRow || newRow || {};
    }

    if (newRow.version !== oldRow.version) {
      try {
        const updatedPathData = pathData.map(row => 
          row.id === newRow.id ? newRow : row
        );
        const result = await window.electronAPI.updateFlashPathData({ 
          path_type: 'silabs',
          saved_paths: updatedPathData 
        });
        
        if (result && result.success) {
          setPathData(updatedPathData);
          return newRow;
        } else {
          console.error('Failed to save path data');
          return oldRow;
        }
      } catch (error) {
        console.error('Error updating row:', error);
        return oldRow;
      }
    }
    return newRow;
  };

  const PathSelector = ({ title, path, onSelect, settingName, icon }) => {
    const displayPath = getDisplayPath(path, 'testApp');
    const displayText = path ? displayPath : 'No path selected';
    
    return (
      <Paper sx={{ p: 2, mb: 1.5, width: '100%' }}>
        <Stack 
          direction={{ xs: 'column', sm: 'row' }} 
          spacing={1.5} 
          alignItems={{ xs: 'stretch', sm: 'center' }}
          sx={{ minHeight: 40 }}
        >
          <Button
            variant="outlined"
            startIcon={icon}
            onClick={() => onSelect(settingName)}
            size="small"
            sx={{ 
              minWidth: { xs: '100%', sm: 180, md: 200 },
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
              fontSize: '0.8rem',
              wordBreak: 'break-all',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
              lineHeight: 1.3
            }}
            title={path || 'No path selected'}
          >
            {displayText}
          </Typography>
        </Stack>
      </Paper>
    );
  };

  const canSave = testAppPath;
      const hasSelection = rowSelectionModel.ids && rowSelectionModel.ids.size === 1;

  return (
    <Box sx={{ 
      p: 2, 
      maxWidth: { xs: '100%', sm: 1200, lg: 1400, xl: 1600 },
      mx: 'auto',
      width: '100%',
      height: '100vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <Box sx={{ 
        display: 'flex',
        gap: 2,
        flexDirection: { xs: 'column', lg: 'row' },
        width: '100%',
        flex: 1,
        minHeight: 0
      }}>
        {/* Path Selection Section */}
        <Box sx={{ 
          flex: { xs: '1 1 100%', lg: '1 1 40%' },
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column'
        }}>
          <PathSelector
            title="Select Test App"
            path={testAppPath}
            onSelect={selectFile}
            settingName="testAppPath"
            icon={<AppsIcon />}
          />

          {/* Action Buttons */}
          <Paper sx={{ p: 2, mt: 1.5, flex: 1 }}>
            <Typography variant="h6" sx={{ mb: 1.5, fontWeight: 600, fontSize: '1.1rem' }}>
              Path Management
            </Typography>
            <Stack 
              spacing={1}
            >
              <Tooltip title={!canSave ? "Please select test app path first" : ""}>
                <span>
                  <Button 
                    variant="contained" 
                    color="success" 
                    startIcon={<SaveIcon />}
                    onClick={saveChosePath}
                    disabled={!canSave}
                    fullWidth
                    size="small"
                    sx={{ 
                      textTransform: 'none'
                    }}
                  >
                    Save Current Paths
                  </Button>
                </span>
              </Tooltip>
              
              <Tooltip title={!hasSelection ? "Please select a row first" : ""}>
                <span>
                  <Button 
                    variant="contained" 
                    startIcon={<LoadIcon />}
                    onClick={loadChosePath} 
                    disabled={!hasSelection}
                    fullWidth
                    size="small"
                    sx={{ 
                      textTransform: 'none'
                    }}
                  >
                    Load Selected
                  </Button>
                </span>
              </Tooltip>
              
              <Tooltip title={!hasSelection ? "Please select a row first" : ""}>
                <span>
                  <Button 
                    variant="contained" 
                    color="error" 
                    startIcon={<DeleteIcon />}
                    onClick={deleteChosePath} 
                    disabled={!hasSelection}
                    fullWidth
                    size="small"
                    sx={{ 
                      textTransform: 'none'
                    }}
                  >
                    Delete Selected
                  </Button>
                </span>
              </Tooltip>
            </Stack>
            
            {canSave && (
              <Box sx={{ mt: 1.5, p: 1, bgcolor: 'rgba(76, 175, 80, 0.1)', border: '1px solid rgba(76, 175, 80, 0.3)', borderRadius: 1 }}>
                <Typography variant="body2" color="text.primary" sx={{ fontWeight: 600, mb: 0.5, fontSize: '0.85rem' }}>
                  <strong>Ready to save:</strong>
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all', lineHeight: 1.3, mb: 0.3 }}>
                  Test App: {getDisplayPath(testAppPath, 'testApp')}
                </Typography>
              </Box>
            )}
          </Paper>
        </Box>

        {/* Saved Paths Table */}
        <Box sx={{ 
          flex: { xs: '1 1 100%', lg: '1 1 60%' },
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column'
        }}>
          <Paper sx={{ 
            p: 2,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0
          }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
              <Typography variant="h6" fontWeight={600} sx={{ fontSize: '1.1rem' }}>
                Saved Path Configurations
              </Typography>
              <Chip 
                label={`${pathData.length} saved`} 
                size="small" 
                color="primary" 
                variant="outlined"
              />
            </Stack>
            
            <Box sx={{ 
              flex: 1,
              minHeight: 0,
              width: '100%',
              '& .MuiDataGrid-root': {
                border: 'none',
                width: '100%',
              },
              '& .MuiDataGrid-cell': {
                fontSize: '0.85rem',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
              },
              '& .MuiDataGrid-columnHeaders': {
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: 'text.primary',
                minHeight: '40px !important',
              },
              '& .MuiDataGrid-columnHeaderTitle': {
                color: 'text.primary',
                fontWeight: 600,
              },
              '& .MuiDataGrid-row': {
                minHeight: '48px !important',
              },
              '& .MuiDataGrid-cell:focus': {
                outline: 'none',
              },
              '& .MuiDataGrid-cell:focus-within': {
                outline: 'none',
              }
            }}>
              <DataGrid
                rows={pathData}
                columns={columns}
                paginationModel={paginationModel}
                onPaginationModelChange={setPaginationModel}
                pageSizeOptions={[8, 10, 12, 16]}
                checkboxSelection
                disableMultipleRowSelection
                onRowSelectionModelChange={(newRowSelectionModel) => {
                  setRowSelectionModel(newRowSelectionModel);
                }}
                rowSelectionModel={rowSelectionModel}
                processRowUpdate={processRowUpdate}
                onProcessRowUpdateError={(error) => {
                  console.error('Error in row update:', error);
                }}
                editMode="cell"
                sx={{ height: '100%', width: '100%' }}
                density="compact"
                getRowHeight={() => 'auto'}
                columnHeaderHeight={40}
              />
            </Box>
            
            {pathData.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 2, color: 'text.secondary' }}>
                <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                  No saved path configurations yet.
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                  Select paths above and click "Save Current Paths" to get started.
                </Typography>
              </Box>
            )}
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}

export default SilabsPathsSettings;


