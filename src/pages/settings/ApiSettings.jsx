import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePostman } from '../../contexts/PostmanContext';
import { 
  Box, Button, Typography, CircularProgress, Alert, TextField, Divider, List, ListItem, ListItemText, 
  IconButton, Paper, Dialog, DialogTitle, DialogContent, DialogActions, Select, MenuItem, FormControl, 
  InputLabel, Chip, Stack, Grid, Card, CardContent, CardHeader, Accordion, AccordionSummary, AccordionDetails,
  Tabs, Tab
} from '@mui/material';
import { RichTreeView } from '@mui/x-tree-view/RichTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FolderIcon from '@mui/icons-material/Folder';
import DescriptionIcon from '@mui/icons-material/Description';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteIcon from '@mui/icons-material/Delete';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
import HttpIcon from '@mui/icons-material/Http';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import DataObjectIcon from '@mui/icons-material/DataObject';
import CodeIcon from '@mui/icons-material/Code';
import SettingsIcon from '@mui/icons-material/Settings';
import InfoIcon from '@mui/icons-material/Info';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ApiIcon from '@mui/icons-material/Api'; // New icon for OpenAPI
import GetAppIcon from '@mui/icons-material/GetApp'; // For CSV export

// Helper to get color based on HTTP method - using consistent color scheme
const getMethodColor = (method) => {
    switch (method?.toUpperCase()) {
        case 'GET': return '#2196f3'; // Consistent Material UI blue
        case 'POST': return '#4caf50'; // Consistent Material UI green
        case 'PUT': return '#ff9800'; // Consistent Material UI orange
        case 'PATCH': return '#9c27b0'; // Consistent Material UI purple
        case 'DELETE': return '#f44336'; // Consistent Material UI red
        default: return '#757575'; // Consistent Material UI grey
    }
};

// Custom TabPanel component
function CustomTabPanel({ children, value, index, ...other }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`edit-tabpanel-${index}`}
      aria-labelledby={`edit-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 0 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

// Tab props helper
function a11yProps(index) {
  return {
    id: `edit-tab-${index}`,
    'aria-controls': `edit-tabpanel-${index}`,
  };
}

function ApiSettings() {
  const [postmanPath, setPostmanPath] = useState('');
  const { collections, isLoading, isCacheLoading, error: postmanError, scanCollections } = usePostman();

  // State for multiple API credential configurations
  const [apiCredentialConfigs, setApiCredentialConfigs] = useState([]);
  const [selectedConfigForKeys, setSelectedConfigForKeys] = useState(null);
  const [recentlyHiddenConfigId, setRecentlyHiddenConfigId] = useState(null);
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState('');

  // New states for editing functionality
  const [editMode, setEditMode] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [editingCollectionData, setEditingCollectionData] = useState(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [editingItemPath, setEditingItemPath] = useState([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState('');

  // State for session token and profile selection
  const [sessionToken, setSessionToken] = useState('');
  const [availableProfiles, setAvailableProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState('');

  // New states for tab management in edit dialog
  const [editDialogTab, setEditDialogTab] = useState(0);
  const [jsonError, setJsonError] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);

  // States for manual credential input
  const [manualInputDialogOpen, setManualInputDialogOpen] = useState(false);
  const [manualInputText, setManualInputText] = useState('');
  const [manualInputError, setManualInputError] = useState('');
  const [parsedCredentials, setParsedCredentials] = useState(null);
  const [exportSuccess, setExportSuccess] = useState(false);



  // Fetch Postman path and API Credential Configs on mount
  useEffect(() => {
    const fetchPaths = async () => {
      try {
        const pPath = await window.electronAPI.getPostmanCollectionPath();
        setPostmanPath(pPath || '');
        
        const apiConfigs = await window.electronAPI.getApiCredentialConfigs();
        // Ensure all configs have a type field for backward compatibility
        const normalizedConfigs = (apiConfigs || []).map(config => ({
          ...config,
          type: config.type || 'file' // Default to 'file' for existing configs
        }));
        setApiCredentialConfigs(normalizedConfigs);

      } catch (err) {
        console.error("Error fetching initial paths/configs:", err);
        setFileError('Failed to load initial configuration.');
      }
    };
    fetchPaths();
  }, []);

  useEffect(() => {
    if (postmanPath) {
      scanCollections(postmanPath);
    }
  }, [postmanPath, scanCollections]);

  // Helper function to find item by path in collection
  const findItemByPath = (items, path) => {
    if (path.length === 0) return null;
    
    let current = items;
    for (let i = 0; i < path.length; i++) {
      const index = path[i];
      if (!current[index]) return null;
      
      if (i === path.length - 1) {
        return current[index];
      } else {
        current = current[index].item || [];
      }
    }
    return null;
  };

  // Helper function to update item by path in collection
  const updateItemByPath = (items, path, newItem) => {
    if (path.length === 0) return items;
    
    const newItems = JSON.parse(JSON.stringify(items)); // Deep clone
    let current = newItems;
    
    for (let i = 0; i < path.length; i++) {
      const index = path[i];
      
      if (i === path.length - 1) {
        current[index] = newItem;
      } else {
        current = current[index].item || [];
      }
    }
    return newItems;
  };

  // Helper function to delete item by path in collection
  const deleteItemByPath = (items, path) => {
    if (path.length === 0) return items;
    
    const newItems = JSON.parse(JSON.stringify(items)); // Deep clone
    let current = newItems;
    
    for (let i = 0; i < path.length - 1; i++) {
      const index = path[i];
      current = current[index].item || [];
    }
    
    const lastIndex = path[path.length - 1];
    current.splice(lastIndex, 1);
    return newItems;
  };

  // Helper function to add new item to collection
  const addItemToPath = (items, path, newItem) => {
    const newItems = JSON.parse(JSON.stringify(items)); // Deep clone
    let current = newItems;
    
    for (let i = 0; i < path.length; i++) {
      const index = path[i];
      current = current[index].item || [];
    }
    
    current.push(newItem);
    return newItems;
  };

  const handleEnterEditMode = async (collection) => {
    try {
      // Load the complete collection data from file
      const fileContent = await window.electronAPI.readFileContent(collection.filePath);
      const fullCollectionData = JSON.parse(fileContent);
      
      // For OpenAPI specs, we need to handle the structure differently
      if (collection.type === 'openapi') {
        // Convert OpenAPI structure to be compatible with our editing interface
        setSelectedCollection(collection);
        setEditingCollectionData(collection); // Use the converted structure we already have
        setEditMode(true);
        setSaveError('');
      } else {
        // For Postman collections, use the original logic
        setSelectedCollection(collection);
        setEditingCollectionData(fullCollectionData);
        setEditMode(true);
        setSaveError('');
      }
    } catch (error) {
      console.error('Error loading collection file:', error);
      setSaveError(`Failed to load collection: ${error.message}`);
    }
  };

  const handleExitEditMode = () => {
    setEditMode(false);
    setSelectedCollection(null);
    setEditingCollectionData(null);
    setEditDialogOpen(false);
    setEditingItem(null);
    setEditingItemPath([]);
    setSaveError('');
  };

  const handleSaveCollection = async () => {
    if (!editingCollectionData || !selectedCollection) return;
    
    setSaveLoading(true);
    setSaveError('');
    
    try {
      // For OpenAPI specs, we need to convert back to original format if necessary
      if (selectedCollection.type === 'openapi') {
        // For now, we'll save the modified structure as-is since we're only editing
        // the converted structure. A full implementation would convert back to OpenAPI format.
        setSaveError('OpenAPI specifications can be viewed and their structure explored, but direct modification is limited to preserve specification integrity. Consider converting to Postman format for full editing capabilities.');
        setSaveLoading(false);
        return;
      }
      
      // For Postman collections, use the original logic
      const result = await window.electronAPI.savePostmanCollection(
        selectedCollection.filePath, 
        editingCollectionData
      );
      
      if (result.success) {
        handleExitEditMode();
        // Collections will be automatically updated via the context
      } else {
        setSaveError(result.error || 'Failed to save collection');
      }
    } catch (error) {
      setSaveError(error.message || 'Failed to save collection');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleEditItem = (item, path) => {
    setEditingItem(JSON.parse(JSON.stringify(item))); // Deep clone
    setEditingItemPath(path);
    setEditDialogOpen(true);
  };

  const handleSaveEditedItem = () => {
    if (!editingItem || !editingCollectionData) return;
    
    const updatedItems = updateItemByPath(
      editingCollectionData.item || [], 
      editingItemPath, 
      editingItem
    );
    
    setEditingCollectionData({
      ...editingCollectionData,
      item: updatedItems
    });
    
    setEditDialogOpen(false);
    setEditingItem(null);
    setEditingItemPath([]);
  };

  const handleDeleteItem = (path) => {
    if (!editingCollectionData) return;
    
    const updatedItems = deleteItemByPath(
      editingCollectionData.item || [], 
      path
    );
    
    setEditingCollectionData({
      ...editingCollectionData,
      item: updatedItems
    });
  };

  const handleAddNewRequest = (parentPath = []) => {
    const newRequest = {
      name: 'New Request',
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: 'https://api.example.com/endpoint',
          protocol: 'https',
          host: ['api', 'example', 'com'],
          path: ['endpoint']
        }
      }
    };
    
    if (!editingCollectionData) return;
    
    let updatedItems;
    if (parentPath.length === 0) {
      // Add to root level
      updatedItems = [...(editingCollectionData.item || []), newRequest];
    } else {
      // Add to specific folder
      updatedItems = addItemToPath(
        editingCollectionData.item || [], 
        parentPath, 
        newRequest
      );
    }
    
    setEditingCollectionData({
      ...editingCollectionData,
      item: updatedItems
    });
  };

  const handleAddNewFolder = (parentPath = []) => {
    const newFolder = {
      name: 'New Folder',
      item: []
    };
    
    if (!editingCollectionData) return;
    
    let updatedItems;
    if (parentPath.length === 0) {
      // Add to root level
      updatedItems = [...(editingCollectionData.item || []), newFolder];
    } else {
      // Add to specific folder
      updatedItems = addItemToPath(
        editingCollectionData.item || [], 
        parentPath, 
        newFolder
      );
    }
    
    setEditingCollectionData({
      ...editingCollectionData,
      item: updatedItems
    });
  };

  const parseFileContent = (content, filePathHint = '', targetProfile = null) => {
    let parsedAccessKey = '';
    let parsedSecretKey = '';
    let parsedSessionToken = '';
    let profiles = [];
    const isCsv = filePathHint.toLowerCase().endsWith('.csv');
    const isAwsCredentials = filePathHint.toLowerCase().includes('credentials') || filePathHint.toLowerCase().includes('.aws');

    // Handle AWS credentials file format
    if (isAwsCredentials) {
      const lines = content.replace(/\r\n/g, '\n').split('\n');
      const profileData = {};
      let currentProfile = null;

      for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Skip empty lines and comments
        if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith(';')) {
          continue;
        }

        // Check for profile section
        const profileMatch = trimmedLine.match(/^\[([^\]]+)\]$/);
        if (profileMatch) {
          currentProfile = profileMatch[1];
          profileData[currentProfile] = {};
          continue;
        }

        // Parse key-value pairs
        if (currentProfile) {
          const keyValueMatch = trimmedLine.match(/^([^=]+)=(.*)$/);
          if (keyValueMatch) {
            const key = keyValueMatch[1].trim();
            const value = keyValueMatch[2].trim();
            profileData[currentProfile][key] = value;
          }
        }
      }

      // Filter out empty profiles and get list of profiles with credentials
      profiles = Object.keys(profileData).filter(profileName => {
        const profile = profileData[profileName];
        return profile.aws_access_key_id && profile.aws_secret_access_key;
      });
      
      // Use targetProfile if specified, otherwise use selectedProfile, otherwise use first non-empty profile
      let profileToUse = targetProfile || selectedProfile;
      
      // If no specific profile requested, find the first profile with actual credentials
      if (!profileToUse && profiles.length > 0) {
        profileToUse = profiles[0];
      }
      
      if (profileToUse && profileData[profileToUse] && profileData[profileToUse].aws_access_key_id) {
        const profile = profileData[profileToUse];
        parsedAccessKey = profile.aws_access_key_id || '';
        parsedSecretKey = profile.aws_secret_access_key || '';
        parsedSessionToken = profile.aws_session_token || '';
      }

      return { 
        accessKeyId: parsedAccessKey, 
        secretAccessKey: parsedSecretKey, 
        sessionToken: parsedSessionToken,
        profiles: profiles 
      };
    }

    try {
      // Try parsing as JSON first
      const jsonContent = JSON.parse(content);
      parsedAccessKey = jsonContent['Access Key ID'] || jsonContent['access_key_id'] || jsonContent['AccessKeyId'] || '';
      parsedSecretKey = jsonContent['Secret Access Key'] || jsonContent['secret_access_key'] || jsonContent['SecretAccessKey'] || '';
      parsedSessionToken = jsonContent['Session Token'] || jsonContent['session_token'] || jsonContent['SessionToken'] || '';
      if (parsedAccessKey && parsedSecretKey) {
        return { 
          accessKeyId: parsedAccessKey, 
          secretAccessKey: parsedSecretKey, 
          sessionToken: parsedSessionToken,
          profiles: [] 
        };
      }
    } catch (e) {
      // JSON parsing failed, proceed to other formats
    }

    const lines = content.replace(/\r\n/g, '\n').split('\n');

    if (isCsv && lines.length >= 2) {
      // Attempt CSV parsing if hint suggests CSV and there are at least 2 lines (header + data)
      const headerLine = lines[0].trim();
      const dataLine = lines[1].trim(); // Assuming keys are on the second line for this specific CSV format

      const headers = headerLine.split(',').map(h => h.trim().toLowerCase());
      const values = dataLine.split(',').map(v => v.trim());

      let accessKeyIndex = -1;
      let secretKeyIndex = -1;
      let sessionTokenIndex = -1;

      const accessKeyPossibleHeaders = ['access key id', 'accesskeyid', 'aws_access_key_id'];
      const secretKeyPossibleHeaders = ['secret access key', 'secretaccesskey', 'aws_secret_access_key'];
      const sessionTokenPossibleHeaders = ['session token', 'sessiontoken', 'aws_session_token'];

      headers.forEach((header, index) => {
        if (accessKeyPossibleHeaders.includes(header)) {
          accessKeyIndex = index;
        }
        if (secretKeyPossibleHeaders.includes(header)) {
          secretKeyIndex = index;
        }
        if (sessionTokenPossibleHeaders.includes(header)) {
          sessionTokenIndex = index;
        }
      });
      
      // A more flexible search for partial matches in headers
      if (accessKeyIndex === -1) {
          accessKeyIndex = headers.findIndex(h => h.includes('access key id') || h.includes('accesskeyid'));
      }
      if (secretKeyIndex === -1) {
          secretKeyIndex = headers.findIndex(h => h.includes('secret access key') || h.includes('secretaccesskey'));
      }
      if (sessionTokenIndex === -1) {
          sessionTokenIndex = headers.findIndex(h => h.includes('session token') || h.includes('sessiontoken'));
      }

      if (accessKeyIndex !== -1 && values.length > accessKeyIndex) {
        parsedAccessKey = values[accessKeyIndex];
      }
      if (secretKeyIndex !== -1 && values.length > secretKeyIndex) {
        parsedSecretKey = values[secretKeyIndex];
      }
      if (sessionTokenIndex !== -1 && values.length > sessionTokenIndex) {
        parsedSessionToken = values[sessionTokenIndex];
      }
      
      if (parsedAccessKey && parsedSecretKey) {
        return { 
          accessKeyId: parsedAccessKey, 
          secretAccessKey: parsedSecretKey, 
          sessionToken: parsedSessionToken,
          profiles: [] 
        };
      }
    }

    // Fallback to Regex for key-value pairs (e.g., key: value, key=value, or from non-CSV text files)
    // More flexible regex to capture values, allows for various separators and optional quotes
    const accessKeyRegex = /(?:Access Key ID|access_key_id|AccessKeyId|aws_access_key_id)\s*[:=]\s*([A-Za-z0-9/+=]{20,})/i;
    const secretKeyRegex = /(?:Secret Access Key|secret_access_key|SecretAccessKey|aws_secret_access_key)\s*[:=]\s*([A-Za-z0-9/+=]{40,})/i;
    const sessionTokenRegex = /(?:Session Token|session_token|SessionToken|aws_session_token)\s*[:=]\s*([A-Za-z0-9/+=]{100,})/i;

    // Attempt to find keys directly if they are on separate lines with typical AWS CLI format
    if (!parsedAccessKey || !parsedSecretKey) {
        for (const line of lines) {
            if (!parsedAccessKey) {
                const accessMatch = line.match(accessKeyRegex);
                if (accessMatch && accessMatch[1]) {
                    parsedAccessKey = accessMatch[1].trim();
                }
            }
            if (!parsedSecretKey) {
                const secretMatch = line.match(secretKeyRegex);
                if (secretMatch && secretMatch[1]) {
                    parsedSecretKey = secretMatch[1].trim();
                }
            }
            if (!parsedSessionToken) {
                const sessionMatch = line.match(sessionTokenRegex);
                if (sessionMatch && sessionMatch[1]) {
                    parsedSessionToken = sessionMatch[1].trim();
                }
            }
            if (parsedAccessKey && parsedSecretKey) break; // Found both required keys
        }
    }
    
    // If regex failed on separate lines, try a simpler split for AWS CLI like output (often without explicit key names)
    // This is more of a heuristic for files that might just contain the key and secret on separate lines.
    if (!parsedAccessKey && lines.length >= 1 && lines[0].length > 15 && lines[0].length < 30 && /^[A-Z0-9]{20}$/.test(lines[0].trim())) {
        // Heuristic: If the first line looks like an AWS Access Key ID
        parsedAccessKey = lines[0].trim();
    }
    if (!parsedSecretKey && lines.length >= 2 && lines[1].length > 30 && lines[1].length < 50 && /^[a-zA-Z0-9/+=]{40}$/.test(lines[1].trim())) {
        // Heuristic: If the second line looks like an AWS Secret Access Key
        parsedSecretKey = lines[1].trim();
    }

    return { 
      accessKeyId: parsedAccessKey, 
      secretAccessKey: parsedSecretKey, 
      sessionToken: parsedSessionToken,
      profiles: [] 
    };
  };
  
  const loadAndParseFileForConfig = async (configId, filePath) => {
    // If this config was just hidden, prevent re-loading it immediately
    if (configId === recentlyHiddenConfigId) {
      return; 
    }

    setFileLoading(true);
    setFileError('');
    // Explicitly clear keys first, then set which config is being processed.
    // This ensures that `areKeysCurrentlyShownForThisConfig` becomes false
    // until new keys are actually loaded and set.
    setAccessKeyId(''); 
    setSecretAccessKey('');
    setSessionToken('');
    setAvailableProfiles([]);
    setSelectedProfile('');
    setSelectedConfigForKeys(configId); 

    try {
      const content = await window.electronAPI.readFileContent(filePath);
      if (content === null || typeof content === 'undefined') {
        throw new Error('File content is empty or could not be read.');
      }
      // Pass filePath to parseFileContent as a hint for format detection
      const { 
        accessKeyId: parsedAccessKey, 
        secretAccessKey: parsedSecretKey, 
        sessionToken: parsedSessionToken,
        profiles: parsedProfiles 
      } = parseFileContent(content, filePath);
      
      if (parsedAccessKey && parsedSecretKey) {
        setAccessKeyId(parsedAccessKey);
        setSecretAccessKey(parsedSecretKey);
        setSessionToken(parsedSessionToken || '');
        setAvailableProfiles(parsedProfiles || []);
        if (parsedProfiles && parsedProfiles.length > 0) {
          setSelectedProfile(parsedProfiles[0]); // Default to first profile
        }
      } else {
        setFileError(`Could not find keys in ${filePath}. Check format.`);
      }
    } catch (err) {
      console.error("Error reading or parsing file:", err);
      setFileError(`Error for ${filePath}: ${err.message}`);
    } finally {
      setFileLoading(false);
    }
  };

  const loadManualCredentialsForConfig = (configId, config) => {
    // If this config was just hidden, prevent re-loading it immediately
    if (configId === recentlyHiddenConfigId) {
      return; 
    }

    setFileError('');
    // Clear other fields and set the current config
    setSessionToken('');
    setAvailableProfiles([]);
    setSelectedProfile('');
    setSelectedConfigForKeys(configId);

    // Load the manual credentials
    if (config.credentials) {
      setAccessKeyId(config.credentials.accessKeyId || '');
      setSecretAccessKey(config.credentials.secretAccessKey || '');
    } else {
      setAccessKeyId('');
      setSecretAccessKey('');
      setFileError('Manual credentials not found for this configuration.');
    }
  };

  const handleSelectFileForApiConfig = async (configId) => {
    setFileLoading(true);
    setFileError('');
    try {
      const selectedPath = await window.electronAPI.selectFile();
      if (selectedPath) {
        const updatedConfigs = apiCredentialConfigs.map(config => 
          config.id === configId ? { ...config, path: selectedPath } : config
        );
        setApiCredentialConfigs(updatedConfigs);
        await window.electronAPI.setApiCredentialConfigs(updatedConfigs);
        await loadAndParseFileForConfig(configId, selectedPath); // Parse this newly selected file
      }
    } catch (err) {
      console.error("Error selecting or saving API config file:", err);
      setFileError('Failed to update API config file path.');
    } finally {
      setFileLoading(false);
    }
  };

  const handleAddApiConfig = () => {
    const newConfig = {
      id: `config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // More robust unique ID
      name: `API Key Set ${apiCredentialConfigs.length + 1}`,
      path: '',
      type: 'file' // Default to file type
    };
    const updatedConfigs = [...apiCredentialConfigs, newConfig];
    setApiCredentialConfigs(updatedConfigs);
    // Persist immediately or wait for a general save button? For now, persist.
    window.electronAPI.setApiCredentialConfigs(updatedConfigs).catch(err => {
        console.error("Failed to save new API config list after add:", err);
        setFileError("Failed to save updated API config list.");
        // Optionally revert: setApiCredentialConfigs(apiCredentialConfigs);
    });
  };

  // Parse DOTS output text to extract credentials
  const parseDOTSCredentials = (text) => {
    setManualInputError('');
    
    if (!text.trim()) {
      setManualInputError('Please paste the DOTS output text');
      return null;
    }

    try {
      // Extract bot name - looking for "Bot: name" pattern
      const botMatch = text.match(/Bot:\s*([^\r\n]+)/i);
      const botName = botMatch ? botMatch[1].trim() : '';

      // Extract Access Key ID - looking for "Username/AccessKeyId:" pattern
      const accessKeyMatch = text.match(/Username\/AccessKeyId:\s*([A-Z0-9]{20})/i);
      const accessKey = accessKeyMatch ? accessKeyMatch[1].trim() : '';

      // Extract Secret Key - looking for "Password/SecretKey:" pattern  
      const secretKeyMatch = text.match(/Password\/SecretKey:\s*([a-zA-Z0-9/+=]{40})/i);
      const secretKey = secretKeyMatch ? secretKeyMatch[1].trim() : '';

      // Validate that we found all required fields
      if (!botName) {
        setManualInputError('Could not find bot name. Please check the format.');
        return null;
      }
      if (!accessKey) {
        setManualInputError('Could not find Access Key ID. Please check the format.');
        return null;
      }
      if (!secretKey) {
        setManualInputError('Could not find Secret Key. Please check the format.');
        return null;
      }

      return {
        name: botName,
        accessKeyId: accessKey,
        secretAccessKey: secretKey
      };
    } catch (error) {
      setManualInputError(`Error parsing credentials: ${error.message}`);
      return null;
    }
  };

  const handleManualInputChange = (text) => {
    setManualInputText(text);
    const parsed = parseDOTSCredentials(text);
    setParsedCredentials(parsed);
  };

  const handleSaveManualCredentials = async () => {
    if (!parsedCredentials) {
      setManualInputError('Please provide valid DOTS output text');
      return;
    }

    try {
      const newConfig = {
        id: `config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: parsedCredentials.name,
        type: 'manual',
        credentials: {
          accessKeyId: parsedCredentials.accessKeyId,
          secretAccessKey: parsedCredentials.secretAccessKey
        }
      };

      const updatedConfigs = [...apiCredentialConfigs, newConfig];
      setApiCredentialConfigs(updatedConfigs);
      await window.electronAPI.setApiCredentialConfigs(updatedConfigs);

      // Clear the dialog
      setManualInputDialogOpen(false);
      setManualInputText('');
      setManualInputError('');
      setParsedCredentials(null);

      // Optionally show the credentials immediately
      setSelectedConfigForKeys(newConfig.id);
      setAccessKeyId(parsedCredentials.accessKeyId);
      setSecretAccessKey(parsedCredentials.secretAccessKey);
      setSessionToken('');
      setAvailableProfiles([]);
      setSelectedProfile('');

    } catch (err) {
      console.error("Failed to save manual credentials:", err);
      setManualInputError("Failed to save credentials. Please try again.");
    }
  };

  const handleExportManualCredentialsToCSV = async (config) => {
    if (!config.credentials) {
      setFileError('No credentials to export');
      return;
    }

    try {
      // Create CSV content with headers matching the expected format from DurationTestQA
      const csvHeaders = 'User Name,Access Key ID,Secret Access Key';
      const csvData = `${config.name},${config.credentials.accessKeyId},${config.credentials.secretAccessKey}`;
      const csvContent = `${csvHeaders}\n${csvData}`;

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${config.name}_credentials.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        // Show success feedback
        setExportSuccess(true);
        setTimeout(() => setExportSuccess(false), 2000);
      }
    } catch (err) {
      console.error("Failed to export CSV:", err);
      setFileError("Failed to export credentials to CSV.");
    }
  };

  const handleRemoveApiConfig = async (configId) => {
    const updatedConfigs = apiCredentialConfigs.filter(config => config.id !== configId);
    setApiCredentialConfigs(updatedConfigs);
    try {
      await window.electronAPI.setApiCredentialConfigs(updatedConfigs);
      if (selectedConfigForKeys === configId) { // If the removed config's keys were shown
        setAccessKeyId('');
        setSecretAccessKey('');
        setSelectedConfigForKeys(null);
        setFileError('');
      }
    } catch (err) {
      console.error("Failed to save API configs after removal:", err);
      setFileError("Failed to save API configs after removal.");
      // Optionally revert: setApiCredentialConfigs(apiCredentialConfigs);
    }
  };
  
  const handleConfigNameChange = async (configId, newName) => {
    const updatedConfigs = apiCredentialConfigs.map(config =>
      config.id === configId ? { ...config, name: newName } : config
    );
    setApiCredentialConfigs(updatedConfigs);
    // Debounce or save on blur? For now, save immediately.
    try {
      await window.electronAPI.setApiCredentialConfigs(updatedConfigs);
    } catch (err) {
      console.error("Failed to save API configs after name change:", err);
      setFileError("Failed to save API configs after name change.");
      // Optionally revert
    }
  };

  // Convert Postman collection structure to RichTreeView items format
  const convertToTreeViewItems = useCallback((nodes, parentPath = [], collectionId = '') => {
    if (!Array.isArray(nodes)) {
      return [];
    }
    
    return nodes.map((node, index) => {
      const isFolder = node.item && Array.isArray(node.item);
      const isRequest = node.request;
      const currentPath = [...parentPath, index];
      
      // Create a unique, stable ID for each item with multiple uniqueness factors
      const baseName = (node.name || (isRequest ? 'req' : 'folder')).replace(/[^a-zA-Z0-9_-]/g, '_');
      const pathString = currentPath.join('-');
      const typePrefix = isRequest ? 'req' : 'folder';
      const method = isRequest ? (node.request.method || 'GET') : '';
      const uniqueId = `${collectionId}-${typePrefix}-${baseName}-${pathString}-${method}`.replace(/--+/g, '-');
      
      if (isFolder) {
        return {
          id: uniqueId,
          label: node.name || 'Unnamed Folder',
          children: convertToTreeViewItems(node.item || [], currentPath, collectionId),
          type: 'folder',
          originalNode: node,
          path: currentPath
        };
      } else if (isRequest) {
        const method = node.request.method || 'GET';
        return {
          id: uniqueId,
          label: node.name || 'Unnamed Request',
          type: 'request',
          method: method,
          originalNode: node,
          path: currentPath
        };
      }
      
      return null;
    }).filter(Boolean);
  }, []);

  // Convert collections to tree view format
  const treeViewItems = useMemo(() => {
    if (editMode && editingCollectionData) {
      // In edit mode, show only the editing collection
      const collectionId = 'editing-collection';
      return [{
        id: collectionId,
        label: editingCollectionData.info?.name || 'Unnamed Collection',
        children: convertToTreeViewItems(editingCollectionData.item || [], [], collectionId),
        type: 'collection',
        originalNode: editingCollectionData,
        path: []
      }];
    } else {
      // In view mode, show all collections
      return collections.map((collection, index) => {
        const collectionId = `collection-${index}`;
        return {
          id: collectionId,
          label: collection.name || collection.fileName,
          children: convertToTreeViewItems(collection.item || [], [], collectionId),
          type: 'collection',
          originalNode: collection,
          path: [],
          isOpenApi: collection.type === 'openapi'
        };
      });
    }
  }, [collections, editMode, editingCollectionData, convertToTreeViewItems]);

  // Custom Tree Item component to handle complex rendering
  const CustomTreeItem = React.forwardRef((props, ref) => {
    const { id, itemId, label, children, ...other } = props;
    
    // Find the item data from our tree structure
    const findItemById = (items, targetId) => {
      for (const item of items) {
        if (item.id === targetId) return item;
        if (item.children) {
          const found = findItemById(item.children, targetId);
          if (found) return found;
        }
      }
      return null;
    };
    
    const item = findItemById(treeViewItems, itemId);
    if (!item) {
      return <TreeItem key={itemId} itemId={itemId} label={label} {...other} />;
    }

    // Render custom label based on item type and mode
    let customLabel = label;
    
    if (editMode) {
      if (item.type === 'folder') {
        customLabel = (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <FolderIcon color="action" sx={{ mr: 1 }} />
              <Typography variant="body2">{item.label}</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleAddNewRequest(item.path); }}>
                <AddIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleAddNewFolder(item.path); }}>
                <FolderIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleEditItem(item.originalNode, item.path); }}>
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.path); }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        );
      } else if (item.type === 'request') {
        const method = item.method || 'GET';
        customLabel = (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Chip 
                label={method} 
                size="small" 
                sx={{ 
                  backgroundColor: getMethodColor(method), 
                  color: 'white', 
                  fontWeight: 'bold',
                  mr: 1,
                  minWidth: '50px'
                }} 
              />
              <Typography variant="body2">{item.label}</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleEditItem(item.originalNode, item.path); }}>
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.path); }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        );
      }
    } else {
      // View mode
      if (item.type === 'collection') {
        const isOpenApi = item.isOpenApi;
        const CollectionIcon = isOpenApi ? ApiIcon : FolderIcon;
        const iconColor = isOpenApi ? 'secondary' : 'primary';
        
        customLabel = (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <CollectionIcon color={iconColor} sx={{ mr: 1 }} />
              <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                {item.label}
              </Typography>
              {isOpenApi && (
                <Chip 
                  label="OpenAPI" 
                  size="small" 
                  sx={{ 
                    ml: 1,
                    backgroundColor: 'rgba(156, 39, 176, 0.1)',
                    color: '#9c27b0',
                    fontSize: '0.7rem',
                    height: '20px'
                  }} 
                />
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {isOpenApi && (
                <Chip 
                  label="View/Explore" 
                  size="small" 
                  sx={{ 
                    backgroundColor: 'rgba(33, 150, 243, 0.1)',
                    color: '#2196f3',
                    fontSize: '0.7rem',
                    height: '20px'
                  }} 
                />
              )}
              <Button 
                size="small" 
                startIcon={<EditIcon />}
                onClick={(e) => { e.stopPropagation(); handleEnterEditMode(item.originalNode); }}
                sx={{ fontSize: '0.8rem', py: 0.25 }}
              >
                {isOpenApi ? 'View' : 'Edit'}
              </Button>
            </Box>
          </Box>
        );
      } else if (item.type === 'request') {
        const method = item.method || 'GET';
        customLabel = (
          <Box sx={{ display: 'flex', alignItems: 'center', py: 0.5 }}> 
            <Typography 
              variant="body2" 
              sx={{
                  fontWeight: 'bold',
                  color: getMethodColor(method),
                  mr: 1,
                  minWidth: '50px',
                  textAlign: 'right'
              }}>
              {method}
            </Typography>
            <Typography variant="body2">
              {item.label}
            </Typography>
          </Box>
        );
      }
    }

    return (
      <TreeItem 
        key={itemId} 
        itemId={itemId} 
        label={customLabel}
        ref={ref}
        {...other}
      >
        {children}
      </TreeItem>
    );
  });

  // JSON validation helper
  const validateJson = (jsonString) => {
    if (!jsonString.trim()) return { isValid: true, error: '' };
    try {
      JSON.parse(jsonString);
      return { isValid: true, error: '' };
    } catch (error) {
      return { isValid: false, error: error.message };
    }
  };

  // Format JSON helper
  const formatJson = (jsonString) => {
    try {
      const parsed = JSON.parse(jsonString);
      return JSON.stringify(parsed, null, 2);
    } catch (error) {
      return jsonString;
    }
  };

  // Copy to clipboard helper
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  return (
    <Box sx={{ 
      p: 1, 
      height: 'calc(100vh - 140px)', 
      overflow: 'hidden',
      maxHeight: 'calc(100vh - 140px)',
      width: '100%',
      boxSizing: 'border-box'
    }}>

      <Box sx={{ 
        display: 'flex',
        height: '100%', 
        maxHeight: '100%',
        width: '100%',
        gap: 1
      }}>
        {/* Postman Collections Area */}
        <Box sx={{ 
          flex: '1 1 50%',
          height: '100%', 
          maxHeight: '100%',
          minWidth: 0
        }}>
          <Card sx={{ 
            height: '100%', 
            maxHeight: '100%',
            display: 'flex', 
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: 3, // Increased border radius
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: (theme) => theme.shadows[2] // Consistent shadow
          }}>
            <CardHeader 
              title="API Collections & Specifications" 
              subheader={`Collection Folder Path: ${postmanPath || 'Not set in ENV settings'}`}
              titleTypographyProps={{ variant: 'h6', fontSize: '1.2rem', fontWeight: 600 }}
              subheaderTypographyProps={{ 
                sx: { 
                  overflowWrap: 'break-word', 
                  wordBreak: 'break-all',
                  fontSize: '0.85rem'
                } 
              }}
              action={
                postmanPath && (
                  <Button 
                    variant="outlined" 
                    startIcon={<InfoIcon />} 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      if (postmanPath) {
                        scanCollections(postmanPath);
                      }
                    }}
                    disabled={isLoading || isCacheLoading}
                    size="small"
                    sx={{ 
                      fontSize: '0.8rem', 
                      py: 0.5,
                      borderRadius: 2,
                      borderColor: '#2196f3',
                      color: '#2196f3',
                      '&:hover': {
                        borderColor: '#1976d2',
                        backgroundColor: 'rgba(33, 150, 243, 0.04)'
                      }
                    }}
                  >
                    {isLoading || isCacheLoading ? 'Scanning...' : 'Scan Collections'}
                  </Button>
                )
              }
              sx={{ 
                pb: 1, 
                pt: 2, 
                flexShrink: 0,
                backgroundColor: 'rgba(33, 150, 243, 0.02)' // Subtle background tint
              }}
            />
            <CardContent sx={{ 
              flex: 1, 
              overflow: 'hidden', 
              display: 'flex', 
              flexDirection: 'column', 
              pt: 0,
              pb: 1,
              '&:last-child': { pb: 1 }
            }}>
              {(isLoading || isCacheLoading) && (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 1 }}>
                  <CircularProgress size={20} />
                </Box>
              )}

              {postmanError && <Alert severity="error" sx={{ mb: 1, flexShrink: 0 }}>{postmanError}</Alert>}

              {!isLoading && !isCacheLoading && !postmanError && !postmanPath && (
                <Alert severity="info" sx={{ flexShrink: 0 }}>Please set the Postman Collection Folder path in the ENV settings first</Alert>
              )}

              {!isLoading && !isCacheLoading && postmanPath && collections.length === 0 && !postmanError && (
                <Typography color="text.secondary" variant="body2" sx={{ flexShrink: 0 }}>
                  No valid Postman v2/v2.1 collections or OpenAPI specifications found in the specified folder, or the folder is empty/inaccessible
                </Typography>
              )}

              {collections.length > 0 && (
                <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {editMode && (
                    <Box sx={{ mb: 0.5, display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                      <Typography variant="body2" sx={{ flexGrow: 1, minWidth: '120px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                        Edit Mode: {selectedCollection?.name}
                      </Typography>
                      <Button 
                        variant="outlined" 
                        startIcon={<AddIcon />} 
                        onClick={(e) => { e.stopPropagation(); handleAddNewRequest(); }}
                        size="small"
                        sx={{ 
                          fontSize: '0.8rem', 
                          py: 0.25,
                          borderRadius: 2,
                          borderColor: '#2196f3',
                          color: '#2196f3',
                          '&:hover': {
                            borderColor: '#1976d2',
                            backgroundColor: 'rgba(33, 150, 243, 0.04)'
                          }
                        }}
                      >
                        Add Request
                      </Button>
                      <Button 
                        variant="outlined" 
                        startIcon={<FolderIcon />} 
                        onClick={(e) => { e.stopPropagation(); handleAddNewFolder(); }}
                        size="small"
                        sx={{ 
                          fontSize: '0.8rem', 
                          py: 0.25,
                          borderRadius: 2,
                          borderColor: '#2196f3',
                          color: '#2196f3',
                          '&:hover': {
                            borderColor: '#1976d2',
                            backgroundColor: 'rgba(33, 150, 243, 0.04)'
                          }
                        }}
                      >
                        Add Folder
                      </Button>
                      <Button 
                        variant="contained" 
                        startIcon={<SaveIcon />} 
                        onClick={(e) => { e.stopPropagation(); handleSaveCollection(); }}
                        disabled={saveLoading}
                        size="small"
                        sx={{ 
                          fontSize: '0.8rem', 
                          py: 0.25,
                          borderRadius: 2,
                          backgroundColor: '#2196f3',
                          '&:hover': { backgroundColor: '#1976d2' }
                        }}
                      >
                        {saveLoading ? 'Saving...' : 'Save'}
                      </Button>
                      <Button 
                        variant="outlined" 
                        onClick={(e) => { e.stopPropagation(); handleExitEditMode(); }}
                        size="small"
                        sx={{ 
                          fontSize: '0.8rem', 
                          py: 0.25,
                          borderRadius: 2,
                          borderColor: '#757575',
                          color: '#757575',
                          '&:hover': {
                            borderColor: '#616161',
                            backgroundColor: 'rgba(117, 117, 117, 0.04)'
                          }
                        }}
                      >
                        Cancel
                      </Button>
                    </Box>
                  )}
                  
                  {saveError && <Alert severity="error" sx={{ mb: 0.5, flexShrink: 0 }}>{saveError}</Alert>}
                  
                  <Box sx={{ 
                    flex: 1,
                    border: '1px solid', 
                    borderColor: 'divider',
                    borderRadius: 1, 
                    p: 0.5,
                    overflow: 'auto',
                    minHeight: 0
                  }}>
                    <RichTreeView
                      aria-label="postman collections tree"
                      items={treeViewItems}
                      slots={{ item: CustomTreeItem }}
                      defaultExpandedItems={editMode ? ['editing-collection'] : []}
                      sx={{ flexGrow: 1, maxWidth: '100%' }}
                    />
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Box>

        {/* API Credentials Area */}
        <Box sx={{ 
          flex: '1 1 50%',
          height: '100%', 
          maxHeight: '100%',
          minWidth: 0
        }}>
          <Card sx={{ 
            height: '100%', 
            maxHeight: '100%',
            display: 'flex', 
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: 3, // Increased border radius
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: (theme) => theme.shadows[2] // Consistent shadow
          }}>
            <CardHeader 
              title="API Credentials Configuration" 
              titleTypographyProps={{ variant: 'h6', fontSize: '1.2rem', fontWeight: 600 }}
              action={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button 
                    variant="outlined" 
                    startIcon={<TextFieldsIcon />} 
                    onClick={(e) => { e.stopPropagation(); setManualInputDialogOpen(true); }}
                    disabled={fileLoading}
                    size="small"
                    sx={{ 
                      fontSize: '0.8rem', 
                      py: 0.5,
                      borderRadius: 2,
                      borderColor: '#4caf50',
                      color: '#4caf50',
                      '&:hover': {
                        borderColor: '#388e3c',
                        backgroundColor: 'rgba(76, 175, 80, 0.04)'
                      }
                    }}
                  >
                    Paste DOTS
                  </Button>
                  <Button 
                    variant="outlined" 
                    startIcon={<AddCircleOutlineIcon />} 
                    onClick={(e) => { e.stopPropagation(); handleAddApiConfig(); }}
                    disabled={fileLoading}
                    size="small"
                    sx={{ 
                      fontSize: '0.8rem', 
                      py: 0.5,
                      borderRadius: 2,
                      borderColor: '#2196f3',
                      color: '#2196f3',
                      '&:hover': {
                        borderColor: '#1976d2',
                        backgroundColor: 'rgba(33, 150, 243, 0.04)'
                      }
                    }}
                  >
                    Add File
                  </Button>
                </Box>
              }
              sx={{ 
                pb: 1, 
                pt: 2, 
                flexShrink: 0,
                backgroundColor: 'rgba(33, 150, 243, 0.02)' // Subtle background tint
              }}
            />
            <CardContent sx={{ 
              flex: 1, 
              overflow: 'hidden', 
              display: 'flex', 
              flexDirection: 'column', 
              pt: 0,
              pb: 1,
              '&:last-child': { pb: 1 }
            }}>
              {fileError && <Alert severity="error" sx={{ mb: 0.5, flexShrink: 0 }}>{fileError}</Alert>}
              {exportSuccess && <Alert severity="success" sx={{ mb: 0.5, flexShrink: 0 }}>Credentials exported to CSV successfully!</Alert>}

              {/* API Credentials List */}
              <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 'bold', flexShrink: 0, fontSize: '0.95rem' }}>
                  Credential Sets
                </Typography>
                <Box sx={{ 
                  flex: selectedConfigForKeys ? '0 0 30%' : 1, 
                  overflow: 'auto',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  minHeight: 0
                }}>
                  <List component={Paper} elevation={0} dense sx={{ py: 0 }}>
                    {apiCredentialConfigs.map((config) => (
                      <ListItem 
                        key={config.id} 
                        divider
                        sx={{ py: 1, alignItems: 'flex-start' }}
                        secondaryAction={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {(config.path || config.type === 'manual') && (() => { 
                              const areKeysCurrentlyShownForThisConfig = selectedConfigForKeys === config.id;
                              return (
                                <Button 
                                    size="small" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (areKeysCurrentlyShownForThisConfig) {
                                        // Action: Hide Keys
                                        setRecentlyHiddenConfigId(config.id);
                                        setSelectedConfigForKeys(null);
                                        setAccessKeyId('');
                                        setSecretAccessKey('');
                                        setSessionToken('');
                                        setAvailableProfiles([]);
                                        setSelectedProfile('');
                                        setFileError(''); 
                                        requestAnimationFrame(() => {
                                            setRecentlyHiddenConfigId(null);
                                        });
                                      } else {
                                        // Action: Show Keys
                                        setRecentlyHiddenConfigId(null);
                                        if (config.type === 'manual') {
                                          loadManualCredentialsForConfig(config.id, config);
                                        } else {
                                          loadAndParseFileForConfig(config.id, config.path);
                                        }
                                      }
                                    }}
                                    disabled={fileLoading} 
                                    sx={{ fontSize: '0.75rem', py: 0.25, minWidth: '80px' }} 
                                    variant={areKeysCurrentlyShownForThisConfig ? "contained" : "outlined"}
                                >
                                    {areKeysCurrentlyShownForThisConfig ? 'Hide Keys' : 'Show Keys'}
                                </Button>
                              );
                            })()}
                            {config.type === 'manual' && (
                              <IconButton 
                                edge="end" 
                                aria-label="export to csv" 
                                onClick={(e) => { e.stopPropagation(); handleExportManualCredentialsToCSV(config); }} 
                                disabled={fileLoading} 
                                size="small"
                                title="Export to CSV"
                                sx={{ 
                                  color: exportSuccess ? '#4caf50' : 'inherit',
                                  '&:hover': { backgroundColor: 'rgba(76, 175, 80, 0.1)' }
                                }}
                              >
                                {exportSuccess ? <CheckCircleIcon fontSize="small" /> : <GetAppIcon fontSize="small" />}
                              </IconButton>
                            )}
                            {config.type !== 'manual' && (
                              <IconButton edge="end" aria-label="select file" onClick={(e) => { e.stopPropagation(); handleSelectFileForApiConfig(config.id); }} disabled={fileLoading} size="small">
                                <FolderOpenIcon fontSize="small" />
                              </IconButton>
                            )}
                            <IconButton edge="end" aria-label="delete" onClick={(e) => { e.stopPropagation(); handleRemoveApiConfig(config.id); }} disabled={fileLoading} size="small">
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        }
                      >
                        <ListItemText 
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                              <TextField 
                                variant="standard" 
                                defaultValue={config.name} 
                                onBlur={(e) => { e.stopPropagation(); handleConfigNameChange(config.id, e.target.value); }}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                                sx={{ width: '180px' }}
                                size="small"
                                InputProps={{ sx: { fontSize: '0.95rem', fontWeight: 500 } }}
                              />
                              <Chip 
                                label={config.type === 'manual' ? 'Manual' : 'File'} 
                                size="small" 
                                sx={{ 
                                  backgroundColor: config.type === 'manual' ? 'rgba(76, 175, 80, 0.1)' : 'rgba(33, 150, 243, 0.1)',
                                  color: config.type === 'manual' ? '#4caf50' : '#2196f3',
                                  fontSize: '0.75rem',
                                  height: '22px',
                                  fontWeight: 600
                                }} 
                              />
                            </Box>
                          }
                          secondary={
                            <Typography 
                              variant="body2" 
                              sx={{ 
                                fontSize: '0.8rem',
                                color: 'text.secondary',
                                mt: 0.5,
                                overflowWrap: 'break-word', 
                                wordBreak: 'break-all'
                              }}
                            >
                              {config.type === 'manual' ? 'Manually entered credentials' : (config.path || 'No file selected')}
                            </Typography>
                          }
                        />
                      </ListItem>
                    ))}
                    {apiCredentialConfigs.length === 0 && (
                        <ListItem sx={{ py: 1 }}>
                            <ListItemText 
                              primary="No API credential sets configured. Click Add to create one."
                              primaryTypographyProps={{ variant: 'body2', sx: { fontSize: '0.9rem' } }}
                            />
                        </ListItem>
                    )}
                  </List>
                </Box>

                {/* Credential Details */}
                {selectedConfigForKeys && (
                  <Box sx={{ 
                    flex: '0 0 65%', 
                    mt: 0.5,
                    overflow: 'auto',
                    minHeight: 0
                  }}>
                    <Accordion defaultExpanded sx={{ '& .MuiAccordionSummary-root': { minHeight: '32px' } }}>
                      <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ py: 0.5, flexShrink: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                          Credential Details: {apiCredentialConfigs.find(c => c.id === selectedConfigForKeys)?.name || 'Selected Config'}
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails sx={{ pt: 0.5, pb: 1 }}>
                        <Stack spacing={1}>
                          {availableProfiles.length > 0 && (
                            <FormControl fullWidth size="small">
                              <InputLabel sx={{ fontSize: '0.9rem' }}>AWS Profile</InputLabel>
                              <Select
                                value={selectedProfile}
                                label="AWS Profile"
                                sx={{ fontSize: '0.9rem' }}
                                onChange={async (e) => {
                                  const newProfile = e.target.value;
                                  setSelectedProfile(newProfile);
                                  const config = apiCredentialConfigs.find(c => c.id === selectedConfigForKeys);
                                  if (config && config.path) {
                                    try {
                                      const content = await window.electronAPI.readFileContent(config.path);
                                      const { 
                                        accessKeyId: parsedAccessKey, 
                                        secretAccessKey: parsedSecretKey, 
                                        sessionToken: parsedSessionToken 
                                      } = parseFileContent(content, config.path, newProfile);
                                      
                                      setAccessKeyId(parsedAccessKey || '');
                                      setSecretAccessKey(parsedSecretKey || '');
                                      setSessionToken(parsedSessionToken || '');
                                    } catch (err) {
                                      console.error('Error re-parsing file with new profile:', err);
                                      setFileError(`Error switching profile: ${err.message}`);
                                    }
                                  }
                                }}
                                disabled={fileLoading}
                              >
                                {availableProfiles.map((profile) => (
                                  <MenuItem key={profile} value={profile} sx={{ fontSize: '0.9rem' }}>
                                    {profile}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          )}
                          
                          <TextField
                            label="Access Key ID"
                            value={accessKeyId}
                            fullWidth
                            InputProps={{ readOnly: true, sx: { fontSize: '0.9rem' } }}
                            InputLabelProps={{ sx: { fontSize: '0.9rem' } }}
                            variant="outlined"
                            size="small"
                            disabled={fileLoading}
                          />
                          <TextField
                            label="Secret Access Key"
                            value={secretAccessKey}
                            type="password"
                            fullWidth
                            InputProps={{ readOnly: true, sx: { fontSize: '0.9rem' } }}
                            InputLabelProps={{ sx: { fontSize: '0.9rem' } }}
                            variant="outlined"
                            size="small"
                            disabled={fileLoading}
                          />
                          {sessionToken && (
                            <TextField
                              label="Session Token"
                              value={sessionToken}
                              type="password"
                              fullWidth
                              InputProps={{ readOnly: true, sx: { fontSize: '0.9rem' } }}
                              InputLabelProps={{ sx: { fontSize: '0.9rem' } }}
                              variant="outlined"
                              size="small"
                              disabled={fileLoading}
                              helperText="Temporary session token for AWS STS"
                              FormHelperTextProps={{ sx: { fontSize: '0.75rem' } }}
                            />
                          )}
                          {availableProfiles.length > 0 && (
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                              AWS credentials file detected with {availableProfiles.length} profile(s). 
                              Select a profile above to view its credentials.
                            </Typography>
                          )}
                        </Stack>
                      </AccordionDetails>
                    </Accordion>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* Edit Item Dialog - Completely Redesigned */}
      <Dialog 
        open={editDialogOpen} 
        onClose={() => {
          setEditDialogOpen(false);
          setEditDialogTab(0);
          setJsonError('');
        }} 
        maxWidth="lg" 
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            overflow: 'hidden'
          }
        }}
      >
        {/* Header */}
        <Box sx={{ 
          p: 3,
          background: 'linear-gradient(135deg, #2196f3 0%, #1976d2 100%)',
          color: 'white'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {editingItem?.request ? (
              <HttpIcon sx={{ fontSize: '2rem' }} />
            ) : (
              <FolderIcon sx={{ fontSize: '2rem' }} />
            )}
            <Box sx={{ flex: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>
                {editingItem?.request ? 'Edit API Request' : 'Edit Folder'}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {editingItem?.request ? 'Configure your API endpoint' : 'Update folder information'}
              </Typography>
            </Box>
            {editingItem?.request?.method && (
              <Chip 
                label={editingItem.request.method}
                sx={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  color: 'white',
                  fontWeight: 600
                }}
              />
            )}
          </Box>
        </Box>
        
        {/* Content */}
        <DialogContent sx={{ p: 3 }}>
          <Stack spacing={3}>
            {/* Name */}
            <Box>
              <Typography variant="h6" sx={{ mb: 1.5, fontWeight: 600, color: '#2196f3' }}>
                Name
              </Typography>
              <TextField
                value={editingItem?.name || ''}
                onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                fullWidth
                placeholder={editingItem?.request ? "e.g., Get User Profile" : "e.g., User Management"}
                error={!editingItem?.name?.trim()}
                helperText={!editingItem?.name?.trim() ? "Name is required" : ""}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
              />
            </Box>

            {/* Request Details */}
            {editingItem?.request && (
              <>
                <Box>
                  <Typography variant="h6" sx={{ mb: 1.5, fontWeight: 600, color: '#2196f3' }}>
                    Request
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                    <FormControl sx={{ minWidth: 120, maxWidth: 120 }}>
                      <InputLabel>Method</InputLabel>
                      <Select
                        value={editingItem.request.method || 'GET'}
                        label="Method"
                        onChange={(e) => setEditingItem({
                          ...editingItem,
                          request: { ...editingItem.request, method: e.target.value }
                        })}
                        sx={{ borderRadius: 2 }}
                      >
                        {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                          <MenuItem key={method} value={method}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ 
                                width: 8, 
                                height: 8, 
                                borderRadius: '50%', 
                                backgroundColor: getMethodColor(method) 
                              }} />
                              {method}
                            </Box>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Box sx={{ flex: 1 }}>
                      <TextField
                        label="URL"
                        value={editingItem.request.url?.raw || editingItem.request.url || ''}
                        onChange={(e) => {
                          const newUrl = e.target.value;
                          setEditingItem({
                            ...editingItem,
                            request: {
                              ...editingItem.request,
                              url: typeof editingItem.request.url === 'object' 
                                ? { ...editingItem.request.url, raw: newUrl }
                                : newUrl
                            }
                          });
                        }}
                        fullWidth
                        placeholder="https://api.example.com/v1/users"
                        sx={{ 
                          '& .MuiOutlinedInput-root': {
                            borderRadius: 2,
                            fontFamily: 'monospace',
                            fontSize: '0.9rem'
                          }
                        }}
                      />
                    </Box>
                  </Box>
                </Box>

                {/* Headers */}
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, color: '#2196f3' }}>
                      Headers ({(editingItem.request.header || []).length})
                    </Typography>
                    <Button
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={(e) => {
                        e.stopPropagation();
                        const newHeaders = [...(editingItem.request.header || []), { key: '', value: '' }];
                        setEditingItem({
                          ...editingItem,
                          request: { ...editingItem.request, header: newHeaders }
                        });
                      }}
                      sx={{ borderRadius: 2 }}
                    >
                      Add
                    </Button>
                  </Box>

                  {(editingItem.request.header || []).length === 0 ? (
                    <Box sx={{ 
                      textAlign: 'center', 
                      py: 2, 
                      color: 'text.secondary',
                      border: '1px dashed',
                      borderColor: 'divider',
                      borderRadius: 2
                    }}>
                      <Typography variant="body2">No headers</Typography>
                    </Box>
                  ) : (
                    <Stack spacing={1}>
                      {(editingItem.request.header || []).map((header, index) => (
                        <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          <TextField
                            size="small"
                            placeholder="Name"
                            value={header.key || ''}
                            onChange={(e) => {
                              const newHeaders = [...(editingItem.request.header || [])];
                              newHeaders[index] = { ...newHeaders[index], key: e.target.value };
                              setEditingItem({
                                ...editingItem,
                                request: { ...editingItem.request, header: newHeaders }
                              });
                            }}
                            sx={{ 
                              flex: '0 0 150px',
                              '& .MuiOutlinedInput-root': { borderRadius: 1.5, fontFamily: 'monospace' }
                            }}
                          />
                          <TextField
                            size="small"
                            placeholder="Value"
                            value={header.value || ''}
                            onChange={(e) => {
                              const newHeaders = [...(editingItem.request.header || [])];
                              newHeaders[index] = { ...newHeaders[index], value: e.target.value };
                              setEditingItem({
                                ...editingItem,
                                request: { ...editingItem.request, header: newHeaders }
                              });
                            }}
                            sx={{ 
                              flex: 1,
                              '& .MuiOutlinedInput-root': { borderRadius: 1.5, fontFamily: 'monospace' }
                            }}
                          />
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              const newHeaders = [...(editingItem.request.header || [])];
                              newHeaders.splice(index, 1);
                              setEditingItem({
                                ...editingItem,
                                request: { ...editingItem.request, header: newHeaders }
                              });
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Box>

                {/* Body */}
                <Box>
                  <Typography variant="h6" sx={{ mb: 1.5, fontWeight: 600, color: '#2196f3' }}>
                    Body
                  </Typography>
                  
                  <FormControl size="small" sx={{ mb: 2, minWidth: 120 }}>
                    <InputLabel>Type</InputLabel>
                    <Select
                      value={editingItem.request.body?.mode || 'none'}
                      label="Type"
                      onChange={(e) => {
                        const mode = e.target.value;
                        let newBody;
                        
                        if (mode === 'none') {
                          // Keep the existing body data but set mode to none
                          newBody = { ...editingItem.request.body, mode: 'none' };
                        } else {
                          // Preserve existing data when switching between types
                          const existingBody = editingItem.request.body || {};
                          newBody = {
                            ...existingBody,
                            mode
                          };
                          
                          // Smart conversion between JSON and Form
                          if (mode === 'formdata' && !existingBody.formdata && existingBody.raw) {
                            // Convert JSON to Form Data
                            try {
                              const jsonData = JSON.parse(existingBody.raw);
                              const formFields = Object.entries(jsonData).map(([key, value]) => ({
                                key,
                                value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                                type: 'text'
                              }));
                              newBody.formdata = formFields;
                            } catch (error) {
                              // If JSON parsing fails, initialize empty form data
                              newBody.formdata = existingBody.formdata || [];
                            }
                          } else if (mode === 'raw' && !existingBody.raw && existingBody.formdata?.length > 0) {
                            // Convert Form Data to JSON
                            const jsonObject = {};
                            existingBody.formdata.forEach(field => {
                              if (field.key) {
                                // Try to parse as JSON first, fallback to string
                                try {
                                  jsonObject[field.key] = JSON.parse(field.value);
                                } catch {
                                  jsonObject[field.key] = field.value;
                                }
                              }
                            });
                            newBody.raw = JSON.stringify(jsonObject, null, 2);
                          } else {
                            // Keep existing data or initialize empty
                            if (!newBody[mode]) {
                              newBody[mode] = mode === 'raw' ? '' : [];
                            }
                          }
                        }
                        
                        setEditingItem({
                          ...editingItem,
                          request: { ...editingItem.request, body: newBody }
                        });
                        setJsonError('');
                      }}
                      sx={{ borderRadius: 1.5 }}
                    >
                      <MenuItem value="none">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <span>None</span>
                          {(editingItem.request.body?.raw || editingItem.request.body?.formdata?.length > 0) && (
                            <Box sx={{ 
                              width: 6, 
                              height: 6, 
                              borderRadius: '50%', 
                              backgroundColor: '#ff9800',
                              ml: 0.5
                            }} 
                            title="Has data in other types"
                            />
                          )}
                        </Box>
                      </MenuItem>
                      <MenuItem value="raw">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <span>JSON</span>
                          {editingItem.request.body?.raw ? (
                            <Box sx={{ 
                              width: 6, 
                              height: 6, 
                              borderRadius: '50%', 
                              backgroundColor: '#4caf50',
                              ml: 0.5
                            }} 
                            title="Has JSON data"
                            />
                          ) : editingItem.request.body?.formdata?.length > 0 ? (
                            <Box sx={{ 
                              width: 6, 
                              height: 6, 
                              borderRadius: '50%', 
                              backgroundColor: '#2196f3',
                              ml: 0.5
                            }} 
                            title="Can convert from Form data"
                            />
                          ) : null}
                        </Box>
                      </MenuItem>
                      <MenuItem value="formdata">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <span>Form</span>
                          {editingItem.request.body?.formdata?.length > 0 ? (
                            <Box sx={{ 
                              width: 6, 
                              height: 6, 
                              borderRadius: '50%', 
                              backgroundColor: '#4caf50',
                              ml: 0.5
                            }} 
                            title="Has form data"
                            />
                          ) : editingItem.request.body?.raw ? (
                            <Box sx={{ 
                              width: 6, 
                              height: 6, 
                              borderRadius: '50%', 
                              backgroundColor: '#2196f3',
                              ml: 0.5
                            }} 
                            title="Can convert from JSON data"
                            />
                          ) : null}
                        </Box>
                      </MenuItem>
                    </Select>
                  </FormControl>

                  {/* Data preserved notice */}
                  {editingItem.request.body?.mode === 'none' && 
                   (editingItem.request.body?.raw || editingItem.request.body?.formdata?.length > 0) && (
                    <Box sx={{ 
                      mb: 2, 
                      p: 2, 
                      backgroundColor: 'rgba(255, 152, 0, 0.1)',
                      border: '1px solid rgba(255, 152, 0, 0.3)',
                      borderRadius: 2 
                    }}>
                      <Typography variant="body2" sx={{ color: '#f57f17', fontWeight: 500 }}>
                        💾 Data preserved: Switch to JSON or Form to view your saved content
                      </Typography>
                    </Box>
                  )}

                  {/* Auto-conversion info */}
                  {editingItem.request.body?.mode === 'formdata' && 
                   editingItem.request.body?.formdata?.length > 0 && 
                   editingItem.request.body?.raw && (
                    <Box sx={{ 
                      mb: 2, 
                      p: 2, 
                      backgroundColor: 'rgba(33, 150, 243, 0.1)',
                      border: '1px solid rgba(33, 150, 243, 0.3)',
                      borderRadius: 2 
                    }}>
                      <Typography variant="body2" sx={{ color: '#1976d2', fontWeight: 500 }}>
                        🔄 Auto-converted from JSON: Your JSON data has been converted to form fields
                      </Typography>
                    </Box>
                  )}

                  {editingItem.request.body?.mode === 'raw' && 
                   editingItem.request.body?.raw && 
                   editingItem.request.body?.formdata?.length > 0 && (
                    <Box sx={{ 
                      mb: 2, 
                      p: 2, 
                      backgroundColor: 'rgba(33, 150, 243, 0.1)',
                      border: '1px solid rgba(33, 150, 243, 0.3)',
                      borderRadius: 2 
                    }}>
                      <Typography variant="body2" sx={{ color: '#1976d2', fontWeight: 500 }}>
                        🔄 Auto-converted from Form: Your form data has been converted to JSON
                      </Typography>
                    </Box>
                  )}

                  {editingItem.request.body?.mode === 'raw' && (
                    <Box>
                      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                        <Button
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            const formatted = formatJson(editingItem.request.body.raw || '');
                            setEditingItem({
                              ...editingItem,
                              request: {
                                ...editingItem.request,
                                body: { ...editingItem.request.body, raw: formatted }
                              }
                            });
                          }}
                        >
                          Format
                        </Button>
                        <Button
                          size="small"
                          onClick={(e) => { e.stopPropagation(); copyToClipboard(editingItem.request.body.raw || ''); }}
                        >
                          {copySuccess ? 'Copied!' : 'Copy'}
                        </Button>
                      </Box>
                      <TextField
                        multiline
                        rows={6}
                        fullWidth
                        placeholder='{"key": "value"}'
                        value={editingItem.request.body.raw || ''}
                        onChange={(e) => {
                          const newValue = e.target.value;
                          setEditingItem({
                            ...editingItem,
                            request: {
                              ...editingItem.request,
                              body: { ...editingItem.request.body, raw: newValue }
                            }
                          });
                          const validation = validateJson(newValue);
                          setJsonError(validation.isValid ? '' : validation.error);
                        }}
                        error={!!jsonError}
                        helperText={jsonError}
                        sx={{ 
                          '& .MuiOutlinedInput-root': {
                            borderRadius: 2,
                            fontFamily: 'monospace',
                            fontSize: '0.9rem'
                          }
                        }}
                      />
                    </Box>
                  )}

                  {editingItem.request.body?.mode === 'formdata' && (
                    <Box>
                      {(editingItem.request.body.formdata || []).length === 0 ? (
                        <Box sx={{ 
                          textAlign: 'center', 
                          py: 2, 
                          color: 'text.secondary',
                          border: '1px dashed',
                          borderColor: 'divider',
                          borderRadius: 2,
                          mb: 2
                        }}>
                          <Typography variant="body2">No form fields</Typography>
                        </Box>
                      ) : (
                        <Stack spacing={1} sx={{ mb: 2 }}>
                          {(editingItem.request.body.formdata || []).map((formItem, index) => (
                            <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                              <TextField
                                size="small"
                                placeholder="Key"
                                value={formItem.key || ''}
                                onChange={(e) => {
                                  const newFormData = [...(editingItem.request.body.formdata || [])];
                                  newFormData[index] = { ...newFormData[index], key: e.target.value };
                                  setEditingItem({
                                    ...editingItem,
                                    request: {
                                      ...editingItem.request,
                                      body: { ...editingItem.request.body, formdata: newFormData }
                                    }
                                  });
                                }}
                                sx={{ 
                                  flex: '0 0 150px',
                                  '& .MuiOutlinedInput-root': { borderRadius: 1.5 }
                                }}
                              />
                              <TextField
                                size="small"
                                placeholder="Value"
                                value={formItem.value || ''}
                                onChange={(e) => {
                                  const newFormData = [...(editingItem.request.body.formdata || [])];
                                  newFormData[index] = { ...newFormData[index], value: e.target.value };
                                  setEditingItem({
                                    ...editingItem,
                                    request: {
                                      ...editingItem.request,
                                      body: { ...editingItem.request.body, formdata: newFormData }
                                    }
                                  });
                                }}
                                sx={{ 
                                  flex: 1,
                                  '& .MuiOutlinedInput-root': { borderRadius: 1.5 }
                                }}
                              />
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newFormData = [...(editingItem.request.body.formdata || [])];
                                  newFormData.splice(index, 1);
                                  setEditingItem({
                                    ...editingItem,
                                    request: {
                                      ...editingItem.request,
                                      body: { ...editingItem.request.body, formdata: newFormData }
                                    }
                                  });
                                }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          ))}
                        </Stack>
                      )}
                      <Button
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={(e) => {
                          e.stopPropagation();
                          const newFormData = [...(editingItem.request.body?.formdata || []), { key: '', value: '', type: 'text' }];
                          setEditingItem({
                            ...editingItem,
                            request: {
                              ...editingItem.request,
                              body: { ...editingItem.request.body, formdata: newFormData }
                            }
                          });
                        }}
                      >
                        Add Field
                      </Button>
                    </Box>
                  )}
                </Box>
              </>
            )}
          </Stack>
        </DialogContent>
        
        {/* Footer */}
        <Box sx={{ 
          p: 3, 
          borderTop: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 2
        }}>
          <Button 
            onClick={(e) => {
              e.stopPropagation();
              setEditDialogOpen(false);
              setEditDialogTab(0);
              setJsonError('');
            }}
            variant="outlined"
            sx={{ borderRadius: 2 }}
          >
            Cancel
          </Button>
          <Button 
            onClick={(e) => { e.stopPropagation(); handleSaveEditedItem(); }}
            variant="contained"
            disabled={!editingItem?.name?.trim() || !!jsonError}
            sx={{ 
              borderRadius: 2,
              backgroundColor: '#2196f3',
              '&:hover': { backgroundColor: '#1976d2' }
            }}
          >
            Save
          </Button>
        </Box>
      </Dialog>

      {/* Manual Input Dialog */}
      <Dialog 
        open={manualInputDialogOpen} 
        onClose={() => {
          setManualInputDialogOpen(false);
          setManualInputText('');
          setManualInputError('');
          setParsedCredentials(null);
        }} 
        maxWidth="md" 
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            overflow: 'hidden'
          }
        }}
      >
        {/* Header */}
        <Box sx={{ 
          p: 3,
          background: 'linear-gradient(135deg, #4caf50 0%, #388e3c 100%)',
          color: 'white'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <TextFieldsIcon sx={{ fontSize: '2rem' }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>
                Paste DOTS Credentials
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                Paste the complete DOTS rotation output to automatically extract credentials
              </Typography>
            </Box>
          </Box>
        </Box>
        
        {/* Content */}
        <DialogContent sx={{ p: 3 }}>
          <Stack spacing={3}>
            {/* Instructions */}
            <Box sx={{ 
              p: 2, 
              backgroundColor: 'rgba(76, 175, 80, 0.1)',
              border: '1px solid rgba(76, 175, 80, 0.3)',
              borderRadius: 2 
            }}>
              <Typography variant="body2" sx={{ color: '#388e3c', fontWeight: 500, mb: 1 }}>
                📋 Expected Format:
              </Typography>
              <Typography variant="body2" sx={{ color: '#388e3c', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                Bot: your-bot-name<br/>
                Credentials:<br/>
                &nbsp;&nbsp;Username/AccessKeyId: AKIAXXXXXXXXXXXXXXXX<br/>
                &nbsp;&nbsp;Password/SecretKey: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
              </Typography>
            </Box>

            {/* Text Area */}
            <Box>
              <Typography variant="h6" sx={{ mb: 1.5, fontWeight: 600, color: '#4caf50' }}>
                DOTS Output
              </Typography>
              <TextField
                multiline
                rows={8}
                fullWidth
                placeholder="Paste your DOTS rotation output here..."
                value={manualInputText}
                onChange={(e) => handleManualInputChange(e.target.value)}
                error={!!manualInputError}
                helperText={manualInputError || 'Paste the complete output from DOTS credential rotation'}
                sx={{ 
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    fontFamily: 'monospace',
                    fontSize: '0.9rem'
                  }
                }}
              />
            </Box>

            {/* Parsed Results Preview */}
            {parsedCredentials && (
              <Box sx={{ 
                p: 2, 
                backgroundColor: 'rgba(76, 175, 80, 0.05)',
                border: '1px solid rgba(76, 175, 80, 0.2)',
                borderRadius: 2 
              }}>
                <Typography variant="h6" sx={{ mb: 1.5, fontWeight: 600, color: '#4caf50' }}>
                  ✅ Parsed Credentials
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <TextField
                      label="Bot Name"
                      value={parsedCredentials.name}
                      fullWidth
                      InputProps={{ readOnly: true }}
                      size="small"
                      sx={{ backgroundColor: 'rgba(76, 175, 80, 0.05)' }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Access Key ID"
                      value={parsedCredentials.accessKeyId}
                      fullWidth
                      InputProps={{ readOnly: true }}
                      size="small"
                      sx={{ backgroundColor: 'rgba(76, 175, 80, 0.05)' }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Secret Access Key"
                      value={`${parsedCredentials.secretAccessKey.substring(0, 8)}...`}
                      fullWidth
                      InputProps={{ readOnly: true }}
                      size="small"
                      sx={{ backgroundColor: 'rgba(76, 175, 80, 0.05)' }}
                    />
                  </Grid>
                </Grid>
              </Box>
            )}
          </Stack>
        </DialogContent>
        
        {/* Footer */}
        <Box sx={{ 
          p: 3, 
          borderTop: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 2
        }}>
          <Button 
            onClick={() => {
              setManualInputDialogOpen(false);
              setManualInputText('');
              setManualInputError('');
              setParsedCredentials(null);
            }}
            variant="outlined"
            sx={{ borderRadius: 2 }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSaveManualCredentials}
            variant="contained"
            disabled={!parsedCredentials}
            sx={{ 
              borderRadius: 2,
              backgroundColor: '#4caf50',
              '&:hover': { backgroundColor: '#388e3c' }
            }}
          >
            Save Credentials
          </Button>
        </Box>
      </Dialog>
    </Box>
  );
}

export default ApiSettings; 