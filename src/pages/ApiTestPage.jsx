import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePostman } from '../contexts/PostmanContext';
import {
  Box,
  Grid,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Paper,
  Typography,
  Divider,
  AlertTitle,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Stack,
  IconButton,
  Tooltip,
  Badge,
  Tabs,
  Tab,
  RadioGroup,
  FormControlLabel,
  Radio,
  FormLabel
} from '@mui/material';
import {
  Send as SendIcon,
  ExpandMore as ExpandMoreIcon,
  Api as ApiIcon,
  Settings as SettingsIcon,
  Security as SecurityIcon,
  Code as CodeIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  Refresh as RefreshIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  ContentCopy as ContentCopyIcon,
  HighlightOff as HighlightOffIcon,
  PlayArrow as PlayArrowIcon,
  Download as DownloadIcon
} from '@mui/icons-material';
import { GENERIC_API_ENVIRONMENTS } from '../productConfig';
import { applyApiAuthentication } from '../utils/apiAuth';

const ENVIRONMENTS = GENERIC_API_ENVIRONMENTS;
const createDefaultApiKeyAuth = () => ({
  key: 'x-api-key',
  value: '',
  placement: 'header'
});
const createDefaultBasicAuth = () => ({
  username: '',
  password: ''
});

// Unified Color Theme
const THEME_COLORS = {
  primary: {
    main: '#1976d2',
    light: '#42a5f5',
    dark: '#1565c0',
    background: 'rgba(25, 118, 210, 0.1)',
    border: 'rgba(25, 118, 210, 0.3)'
  },
  secondary: {
    main: '#424242',
    light: '#6d6d6d',
    dark: '#2e2e2e',
    background: 'rgba(66, 66, 66, 0.1)',
    border: 'rgba(66, 66, 66, 0.3)'
  },
  success: {
    main: '#2e7d32',
    light: '#4caf50',
    dark: '#1b5e20',
    background: 'rgba(46, 125, 50, 0.1)',
    border: 'rgba(46, 125, 50, 0.3)'
  },
  warning: {
    main: '#ed6c02',
    light: '#ff9800',
    dark: '#e65100',
    background: 'rgba(237, 108, 2, 0.1)',
    border: 'rgba(237, 108, 2, 0.3)'
  },
  error: {
    main: '#d32f2f',
    light: '#f44336',
    dark: '#c62828',
    background: 'rgba(211, 47, 47, 0.1)',
    border: 'rgba(211, 47, 47, 0.3)'
  },
  info: {
    main: '#0288d1',
    light: '#03a9f4',
    dark: '#01579b',
    background: 'rgba(2, 136, 209, 0.1)',
    border: 'rgba(2, 136, 209, 0.3)'
  },
  neutral: {
    main: '#607d8b',
    light: '#90a4ae',
    dark: '#455a64',
    background: 'rgba(96, 125, 139, 0.1)',
    border: 'rgba(96, 125, 139, 0.3)'
  }
};

// Parameter type colors
const PARAM_COLORS = {
  device: THEME_COLORS.success,
  sequence: THEME_COLORS.info,
  body: THEME_COLORS.primary,
  path: THEME_COLORS.primary,
  query: THEME_COLORS.warning,
  prefilled: THEME_COLORS.neutral,
  default: THEME_COLORS.secondary
};

// Helper function to recursively find requests in collection items
const flattenRequests = (items, path = '') => {
  let requests = [];
  if (!Array.isArray(items)) return requests; // Handle cases where items might not be an array

  items.forEach(item => {
    if (item.request) {
      // It's a request
      // Check if we should include the path or if the item name already contains the full info
      let displayName = item.name;
      
      // Only add folder path if it's different from the item name and provides useful context
      if (path && path !== item.name && !item.name.includes(path)) {
        displayName = `${path} / ${item.name}`;
      }
      
      requests.push({ 
        ...item, 
        displayName: displayName // Add a display name with folder structure only when needed
      });
    } else if (item.item) {
      // It's a folder, recurse
      const currentPath = path ? `${path} / ${item.name}` : item.name;
      requests = requests.concat(flattenRequests(item.item, currentPath));
    }
  });
  return requests;
};

// Helper to pretty print JSON
const formatJsonResponse = (body) => {
    try {
        const parsed = JSON.parse(body);
        return JSON.stringify(parsed, null, 2);
    } catch (e) {
        return body; // Return original body if not valid JSON
    }
};

// Helper to extract variables from strings
const extractVariablesFromString = (str) => {
  if (typeof str !== 'string') return [];
  const regex = /{{\s*([\w.-]+)\s*}}/g; // Matches {{variable_name}}, allowing for dots and hyphens in names
  const variables = new Set();
  let match;
  while ((match = regex.exec(str)) !== null) {
    variables.add(match[1]);
  }
  return Array.from(variables);
};

// Helper to extract parameters from POST request body schema
const extractBodyParameters = (requestBody) => {
  const bodyParams = new Set();
  
  if (!requestBody || !requestBody.content) return [];
  
  // Look for JSON content
  const jsonContent = requestBody.content['application/json'];
  if (jsonContent && jsonContent.schema) {
    const schema = jsonContent.schema;
    
    // If it's a direct object with properties
    if (schema.properties) {
      Object.keys(schema.properties).forEach(propName => {
        bodyParams.add(propName);
      });
    }
    
    // If it references a schema (like $ref), we need to extract from the actual body content
    // For now, we'll try to parse the raw body if available
  }
  
  return Array.from(bodyParams);
};

// Helper to get sample body structure for parameter extraction
const getBodyParametersFromSample = (requestBody) => {
  const params = new Set();
  
  if (!requestBody || !requestBody.raw) return [];
  
  try {
    // Replace template variables with placeholder values to make JSON parseable
    let sanitizedBody = requestBody.raw;
    sanitizedBody = sanitizedBody.replace(/\{\{\s*[\w.-]+\s*\}\}/g, '"TEMPLATE_PLACEHOLDER"');
    
    const bodyObj = JSON.parse(sanitizedBody);
    
    // Define keys that should not have their nested content extracted
    const skipNestedKeys = ['wirelessmetadata', 'wireless_metadata'];
    
    const extractKeysRecursively = (obj, prefix = '') => {
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
        Object.keys(obj).forEach(key => {
          // Check if this key should be completely skipped
          const shouldSkipKey = skipNestedKeys.includes(key.toLowerCase());
          
          if (!shouldSkipKey) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            params.add(fullKey);
            
            // If the value contains variables, extract them too (from original raw body)
            if (typeof obj[key] === 'string' && obj[key] !== 'TEMPLATE_PLACEHOLDER') {
              extractVariablesFromString(obj[key]).forEach(v => params.add(v));
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
              // Recurse into nested objects
              extractKeysRecursively(obj[key], fullKey);
            }
          }
        });
      } else if (Array.isArray(obj)) {
        // Handle arrays (like consents array)
        obj.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            extractKeysRecursively(item, `${prefix}[${index}]`);
          }
        });
      }
    };
    
    extractKeysRecursively(bodyObj);
    
    // Also extract template variables from the original raw body
    extractVariablesFromString(requestBody.raw).forEach(v => params.add(v));
  } catch (e) {
    // If parsing fails, fall back to variable extraction
    extractVariablesFromString(requestBody.raw).forEach(v => params.add(v));
  }
  
  return Array.from(params);
};

// Helper to extract existing values from request body
const getBodyParameterValues = (requestBody) => {
  const values = {};
  
  if (!requestBody || !requestBody.raw) return values;
  
  try {
    // Clean up the raw JSON string before parsing
    let rawBody = requestBody.raw.trim();
    
    // Handle common JSON formatting issues
    if (!rawBody.startsWith('{') && !rawBody.startsWith('[')) {
      console.warn('Request body does not appear to be valid JSON, skipping parsing');
      return values;
    }
    
    // Replace template variables with placeholder values to make JSON parseable
    // This allows us to extract the structure while handling template syntax
    let sanitizedBody = rawBody;
    
    // Replace {{variable}} with "TEMPLATE_PLACEHOLDER" to make valid JSON
    sanitizedBody = sanitizedBody.replace(/\{\{\s*[\w.-]+\s*\}\}/g, '"TEMPLATE_PLACEHOLDER"');
    
    const bodyObj = JSON.parse(sanitizedBody);
    
    const extractValuesRecursively = (obj, prefix = '') => {
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
        Object.keys(obj).forEach(key => {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          const value = obj[key];
          
          // Store the value if it's a simple type and not a template placeholder
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            const stringValue = String(value);
            // Only store if it's not a template placeholder and not empty
            if (stringValue !== 'TEMPLATE_PLACEHOLDER' && !stringValue.includes('{{') && stringValue.trim() !== '') {
              values[fullKey] = stringValue;
            }
          } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            extractValuesRecursively(value, fullKey);
          }
        });
      } else if (Array.isArray(obj)) {
        // Handle arrays
        obj.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            extractValuesRecursively(item, `${prefix}[${index}]`);
          }
        });
      }
    };
    
    extractValuesRecursively(bodyObj);
  } catch (e) {
    // If parsing still fails, return empty values
    console.warn('Failed to parse request body for value extraction:', e.message);
    console.warn('Raw body content:', requestBody.raw ? requestBody.raw.substring(0, 200) + '...' : 'null');
  }
  
  return values;
};

// Helper to check if a parameter is a body parameter
const isBodyParameter = (paramName, requestBody) => {
  if (!requestBody || !requestBody.raw) return false;
  
  try {
    // Clean up the raw JSON string before parsing
    let rawBody = requestBody.raw.trim();
    
    // Handle common JSON formatting issues
    if (!rawBody.startsWith('{') && !rawBody.startsWith('[')) {
      return false;
    }
    
    // Replace template variables with placeholder values to make JSON parseable
    let sanitizedBody = rawBody;
    sanitizedBody = sanitizedBody.replace(/\{\{\s*[\w.-]+\s*\}\}/g, '"TEMPLATE_PLACEHOLDER"');
    
    const bodyObj = JSON.parse(sanitizedBody);
    return hasNestedProperty(bodyObj, paramName);
  } catch (e) {
    console.warn('Failed to parse request body in isBodyParameter:', e.message);
    return false;
  }
};

// Helper to check if an object has a nested property
const hasNestedProperty = (obj, propertyPath) => {
  if (typeof obj !== 'object' || obj === null) return false;
  
  // Handle simple property
  if (obj.hasOwnProperty(propertyPath)) return true;
  
  // Define keys that should not have their nested content checked
  const skipNestedKeys = ['wirelessmetadata', 'wireless_metadata'];
  
  // Handle nested property (like "consents[0].deviceId")
  const parts = propertyPath.split(/[.\[\]]+/).filter(p => p);
  let current = obj;
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (current === null || typeof current !== 'object') return false;
    
    // Check if we should skip nested content for this key
    if (skipNestedKeys.includes(part.toLowerCase()) && i < parts.length - 1) {
      // If this is a skipped key and there are more parts, return false
      return false;
    }
    
    if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (isNaN(index) || !current[index]) return false;
      current = current[index];
    } else {
      if (!current.hasOwnProperty(part)) return false;
      current = current[part];
    }
  }
  
  return true;
};

// Placeholder for keyset data - replace with actual fetch from ApiSettings
/*
const fetchApiKeysets = async () => {
  console.warn("[Page6] Placeholder: Simulating fetch for API keysets. Replace with actual call to window.electronAPI.loadApiKeysetsFromApiSettings()");
  return new Promise(resolve => {
    setTimeout(() => {
      resolve([
        { id: 'keyset1', name: 'Keyset A (Test)', wirelessDeviceId: 'device_id_from_keyset_A' },
        { id: 'keyset2', name: 'Keyset B (Dev)', wirelessDeviceId: 'device_id_from_keyset_B' },
        { id: 'keyset3', name: 'Keyset C (Staging)', wirelessDeviceId: 'another_device_id_C' },
      ]);
    }, 1000);
  });
};
*/

// Add helper to parse URL and extract baseUrl, basePath, endpoint, path/query params
const parseUrlDetails = (urlRaw) => {
  if (!urlRaw || typeof urlRaw !== 'string') return null;
  
  console.log('[DEBUG] parseUrlDetails input:', urlRaw);
  
  // Extract baseUrl and basePath
  let baseUrl = '', basePath = '', endpoint = '';
  // Extract endpoint (path + query) directly from urlRaw
  const match = urlRaw.match(/^https?:\/\/[^/]+(\/.*)$/);
  if (match) {
    endpoint = match[1];
  } else {
    endpoint = urlRaw; // fallback
  }
  
  console.log('[DEBUG] extracted endpoint:', endpoint);
  
  // Try to extract baseUrl and basePath for display
  const baseUrlMatch = urlRaw.match(/^(https?:\/\/[^/]+)/);
  if (baseUrlMatch) baseUrl = baseUrlMatch[1];
  const basePathMatch = endpoint.match(/^(\/[\w-]+)/);
  if (basePathMatch) basePath = basePathMatch[1];
  
  // Support :param, {{param}}, and {param}
  const pathParams = [];
  const paramRegex = /:([a-zA-Z0-9_]+)|\{\{\s*([\w.-]+)\s*\}\}|\{([a-zA-Z0-9_]+)\}/g;
  let m;
  while ((m = paramRegex.exec(endpoint)) !== null) {
    const paramName = m[1] || m[2] || m[3]; // Support all three formats
    pathParams.push(paramName);
    console.log('[DEBUG] Found path parameter:', paramName);
  }
  
  // Find query params (e.g., ?foo={{bar}})
  const queryParamRegex = /[?&]([\w.-]+)=\{\{\s*([\w.-]+)\s*\}\}/g;
  const queryParams = [];
  let q;
  while ((q = queryParamRegex.exec(urlRaw)) !== null) {
    queryParams.push(q[2]);
  }
  
  const result = {
    baseUrl,
    basePath,
    endpoint,
    pathParams,
    queryParams,
  };
  
  console.log('[DEBUG] parseUrlDetails result:', result);
  
  return result;
};

// Helper to check if a variable is a sequence ID
const isSequenceIdVariable = (variableName) => {
  const lowerName = variableName.toLowerCase();
  return lowerName.includes('sequence') || 
         lowerName.includes('sequenceid') || 
         lowerName.includes('sequence_id') ||
         lowerName === 'seqid' ||
         lowerName === 'seq';
};

// Helper to check if parameter has pre-filled value in collection
const hasPrefilledValue = (paramName, requestBody) => {
  if (!requestBody) return false;
  const bodyValues = getBodyParameterValues(requestBody);
  return bodyValues[paramName] !== undefined && bodyValues[paramName] !== '';
};

// Helper function to download JSON response
const downloadJsonResponse = (
  apiResponse,
  selectedRequest,
  params,
  selectedEnv,
  authType,
  bearerToken,
  selectedApiConfigId,
  selectedProfile,
  apiKeyAuth,
  basicAuth
) => {
  if (!apiResponse) return;
  
  console.log('Downloading JSON response with headers:', apiResponse.headers);
  console.log('Request metadata:', apiResponse.requestMetadata);
  
  // Helper function to substitute parameters in URL
  const substituteParams = (url, params) => {
    if (!url || !params) return url;
    let substitutedUrl = url;
    
    // Replace {{param}} style variables
    Object.keys(params).forEach(key => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      substitutedUrl = substitutedUrl.replace(regex, params[key] || '');
    });
    
    // Replace :param style variables
    Object.keys(params).forEach(key => {
      const regex = new RegExp(`:${key}\\b`, 'g');
      substitutedUrl = substitutedUrl.replace(regex, params[key] || '');
    });
    
    // Replace {param} style variables
    Object.keys(params).forEach(key => {
      const regex = new RegExp(`{${key}}`, 'g');
      substitutedUrl = substitutedUrl.replace(regex, params[key] || '');
    });
    
    return substitutedUrl;
  };
  
  // Get the original URL from the request
  let originalUrl = selectedRequest?.request?.url?.raw || 'Unknown URL';
  
  // Apply environment substitution if environment is selected
  if (selectedEnv && selectedEnv.label !== 'None') {
    // Parse the original URL to extract components
    const urlMatch = originalUrl.match(/^(https?:\/\/[^\/]+)(.*)$/);
    if (urlMatch) {
      const [, originalBaseUrl, originalPath] = urlMatch;
      
      // Normalize the path (remove double slashes)
      const normalizedPath = originalPath.replace(/\/+/g, '/');
      
      // Try to detect the first path segment in the original URL.
      const basePathMatch = normalizedPath.match(/^(\/[^\/]+)(.*)/);
      if (basePathMatch) {
        const [, detectedBasePath, endpointPath] = basePathMatch;
        // Use the environment's basePath with the detected endpoint path
        originalUrl = `${selectedEnv.baseUrl}${selectedEnv.basePath}${endpointPath}`;
      } else {
        // Fallback: just use environment baseUrl + basePath + original path
        originalUrl = `${selectedEnv.baseUrl}${selectedEnv.basePath}${normalizedPath}`;
      }
    }
  }
  
  // Apply parameter substitution
  const finalUrl = substituteParams(originalUrl, params);
  
  // Use actual sent headers from backend response
  let requestHeaders = [];
  if (apiResponse.requestMetadata && apiResponse.requestMetadata.sentHeaders) {
    // Convert headers object to array format for consistency
    requestHeaders = Object.entries(apiResponse.requestMetadata.sentHeaders).map(([key, value]) => ({
      key: key,
      value: value
    }));
  }
  
  // Get request body with parameter substitution
  let requestBody = null;
  if (selectedRequest?.request?.body?.raw) {
    requestBody = substituteParams(selectedRequest.request.body.raw, params);
    try {
      requestBody = JSON.parse(requestBody);
    } catch (e) {
      // Keep as string if not valid JSON
    }
  }
  
  // Create detailed authentication info
  let authenticationInfo = null;
  if (authType !== 'none') {
    authenticationInfo = {
      type: authType
    };
    
    if (authType === 'aws') {
      authenticationInfo.details = {
        description: 'AWS Signature Version 4 (SigV4) authentication applied by backend',
        service: apiResponse.requestMetadata?.awsService || 'unknown',
        region: 'us-east-1',
        ...(selectedApiConfigId && { configId: selectedApiConfigId }),
        ...(selectedProfile && { awsProfile: selectedProfile })
      };
    } else if (authType === 'bearer') {
      authenticationInfo.details = {
        description: 'Bearer token authentication',
        tokenProvided: !!bearerToken
      };
    } else if (authType === 'apiKey') {
      authenticationInfo.details = {
        description: 'API key authentication',
        key: apiKeyAuth?.key || '',
        placement: apiKeyAuth?.placement || 'header',
        valueProvided: !!apiKeyAuth?.value
      };
    } else if (authType === 'basic') {
      authenticationInfo.details = {
        description: 'Basic authentication',
        usernameProvided: !!basicAuth?.username,
        passwordProvided: !!basicAuth?.password
      };
    }
  }
  
  // Create complete response object
  const completeResponse = {
    request: {
      name: selectedRequest?.displayName || selectedRequest?.name || 'Unknown Request',
      method: selectedRequest?.request?.method || 'GET',
      url: {
        original: selectedRequest?.request?.url?.raw || 'Unknown URL',
        final: finalUrl
      },
      headers: requestHeaders,
      body: requestBody,
      parameters: params,
      environment: selectedEnv ? {
        name: selectedEnv.label,
        baseUrl: selectedEnv.baseUrl,
        basePath: selectedEnv.basePath
      } : {
        name: 'None',
        baseUrl: '',
        basePath: ''
      },
      authentication: authenticationInfo,
      timestamp: new Date().toISOString()
    },
    response: {
      status: apiResponse.status,
      headers: apiResponse.headers || {},
      body: apiResponse.body
    }
  };
  
  // Create filename with timestamp and request name
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const requestName = (selectedRequest?.displayName || selectedRequest?.name || 'api-response')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const filename = `${requestName}-${timestamp}.json`;
  
  // Create and download the file
  const jsonString = JSON.stringify(completeResponse, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Memoize the certificate loading effect to prevent unnecessary re-renders
const CertificateLoader = React.memo(({ onCertificateLoad, isLoadingCertificate, setIsLoadingCertificate }) => {
  useEffect(() => {
    const loadSelectedCertificate = async () => {
      console.log('[Page6] Starting certificate loading...');
      setIsLoadingCertificate(true);
      try {
        const certificate = await window.electronAPI.getSelectedCertificate();
        console.log('[Page6] Certificate loading result:', certificate);
        onCertificateLoad(certificate);

        if (certificate) {
          console.log('[Page6] Successfully loaded certificate:', {
            certificateId: certificate.certificateid,
            deviceId: certificate.deviceid,
            path: certificate.path
          });
        } else {
          console.log('[Page6] No certificate selected or found');
        }
      } catch (err) {
        console.error('[Page6] Error loading selected certificate:', err);
        onCertificateLoad(null);
      } finally {
        setIsLoadingCertificate(false);
      }
    };

    loadSelectedCertificate();
  }, [onCertificateLoad, setIsLoadingCertificate]);

  return null; // This component doesn't render anything
});

// Memoize collection filtering
const useFilteredRequests = (selectedCollectionPath, collections, selectedEnvironment) => {
  return useMemo(() => {
    if (!selectedCollectionPath || collections.length === 0) {
      return [];
    }
    
    const selectedCollection = collections.find(collection => collection.filePath === selectedCollectionPath);
    
    // Fix: Collections have items directly, not in a nested data.item structure
    if (!selectedCollection || !selectedCollection.item) {
      return [];
    }

    // Get the environment label for filtering
    const environmentLabel = selectedEnvironment?.label || selectedEnvironment || 'None';
    
    // Special handling for OpenAPI collections that don't have environment tags
    const isOpenApiCollection = selectedCollection.type === 'openapi';

    const extractRequests = (items, parentPath = '') => {
      let requests = [];
      items.forEach(item => {
        if (item.request) {
          let shouldInclude = true;
          
          // OpenAPI collections can opt into environment-specific filtering.
          // Generic external environments do not declare supported APIs, so keep all requests visible.
          if (
            isOpenApiCollection &&
            environmentLabel !== 'None' &&
            Array.isArray(selectedEnvironment?.supportedApis) &&
            selectedEnvironment.supportedApis.length > 0
          ) {
            const operationId = item.request?.openapi?.operationId || item.name;
            const supportedApis = selectedEnvironment.supportedApis;
            // Check for exact match or case-insensitive match
            shouldInclude = supportedApis.includes(operationId) || 
                          supportedApis.some(api => 
                            api.toLowerCase() === operationId.toLowerCase()
                          );
            
            // Also check for common operation name variations
            if (!shouldInclude) {
              const normalizedOperationId = operationId.charAt(0).toLowerCase() + operationId.slice(1);
              const capitalizedOperationId = operationId.charAt(0).toUpperCase() + operationId.slice(1);
              
              shouldInclude = supportedApis.includes(normalizedOperationId) || 
                            supportedApis.includes(capitalizedOperationId);
            }
          } else if (!isOpenApiCollection) {
            // For regular Postman collections, use the original environment tag filtering
            shouldInclude = environmentLabel === 'None' || 
                           !item.name.includes('[') || 
                           item.name.includes(`[${environmentLabel}]`);
          }
          
          if (shouldInclude) {
            // Create a clean display name without redundant folder path repetition
            let displayName = item.name;
            // Only add folder path if the request name doesn't already contain it
            if (parentPath && !item.name.toLowerCase().includes(parentPath.toLowerCase()) && parentPath.toLowerCase() !== 'root') {
              displayName = `${parentPath} > ${item.name}`;
            }
            
            requests.push({
              ...item,
              displayName: displayName,
              fullPath: parentPath ? `${parentPath} > ${item.name}` : item.name
            });
          }
        }
        if (item.item) {
          // Always traverse folders, but filter requests inside
          requests = requests.concat(extractRequests(item.item, parentPath ? `${parentPath} > ${item.name}` : item.name));
        }
      });
      return requests;
    };

    const extractedRequests = extractRequests(selectedCollection.item);
    return extractedRequests;
  }, [selectedCollectionPath, collections, selectedEnvironment]);
};

function ApiTestPage() {
  const { collections, isCacheLoading: isCollectionsCacheLoading } = usePostman(); 
  console.log('[Page6] Context State:', { collections, isCollectionsCacheLoading }); 

  const [selectedCollectionPath, setSelectedCollectionPath] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  
  // Params state is now a dynamic object
  const [params, setParams] = useState({}); 
  const [identifiedVariables, setIdentifiedVariables] = useState([]);

  const [apiResponse, setApiResponse] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // API Credential Configs from ApiSettings
  const [apiConfigs, setApiConfigs] = useState([]);
  const [selectedApiConfigId, setSelectedApiConfigId] = useState('');
  const [isApiConfigsLoading, setIsApiConfigsLoading] = useState(false);
  const [apiConfigsError, setApiConfigsError] = useState(null);

  // AWS Profile selection for selected API config
  const [availableProfiles, setAvailableProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [isProfilesLoading, setIsProfilesLoading] = useState(false);

  // Bearer Token State
  const [bearerToken, setBearerToken] = useState('');
  const [showBearerToken, setShowBearerToken] = useState(false);

  // API Key State
  const [apiKeyAuth, setApiKeyAuth] = useState(createDefaultApiKeyAuth);
  const [showApiKeyValue, setShowApiKeyValue] = useState(false);

  // Basic Auth State
  const [basicAuth, setBasicAuth] = useState(createDefaultBasicAuth);
  const [showBasicPassword, setShowBasicPassword] = useState(false);

  // Authentication Type State
  const [authType, setAuthType] = useState('none'); // 'none', 'bearer', 'apiKey', 'basic', 'aws'

  // UI State
  const [expandedSections, setExpandedSections] = useState({
    authentication: true,
    parameters: true,
    response: true
  });

  // Selected Certificate State (from Page1)
  const [selectedCertificate, setSelectedCertificate] = useState(null);
  const [isLoadingCertificate, setIsLoadingCertificate] = useState(false);

  // Inside ApiTestPage component, after selectedRequest is set
  const [urlDetails, setUrlDetails] = useState(null);

  // In ApiTestPage component, add environment state
  const [selectedEnvIdx, setSelectedEnvIdx] = useState(0);
  const selectedEnv = ENVIRONMENTS[selectedEnvIdx];

  // Add state to track source for each device-related path param.
  const [paramSource, setParamSource] = useState({}); // e.g., { certificateId: 'certificate' | 'manual' }

  // State persistence key
  const API_TEST_STATE_KEY = 'apiTestPageState';

  // Add loading state for cache restoration
  const [isLoadingState, setIsLoadingState] = useState(true);

  // Add flag to prevent auth reset during state restoration
  const [isRestoringState, setIsRestoringState] = useState(false);
  
  // Add protection period after state restoration
  const [restorationProtectionEnd, setRestorationProtectionEnd] = useState(0);

  // Use memoized filtered requests
  const availableRequests = useFilteredRequests(selectedCollectionPath, collections, selectedEnv);

  // Check if the selected collection is a downlink/deregister/file transfer/fuota collection
  const isDownlinkDeregisterCollection = useMemo(() => {
    if (!selectedCollectionPath || collections.length === 0) {
      return false;
    }
    
    const selectedCollection = collections.find(collection => collection.filePath === selectedCollectionPath);
    if (!selectedCollection) {
      return false;
    }
    
    // Check if collection name or filename contains downlink, deregister, file transfer, or fuota (case insensitive)
    const collectionName = (selectedCollection.name || selectedCollection.fileName || '').toLowerCase();
    return collectionName.includes('downlink') || 
           collectionName.includes('deregister') ||
           collectionName.includes('file transfer') ||
           collectionName.includes('fuota');
  }, [selectedCollectionPath, collections]);

  // Check if the selected collection is specifically a file transfer collection
  const isFileTransferCollection = useMemo(() => {
    if (!selectedCollectionPath || collections.length === 0) {
      return false;
    }
    
    const selectedCollection = collections.find(collection => collection.filePath === selectedCollectionPath);
    if (!selectedCollection) {
      return false;
    }
    
    // Check if collection name or filename contains file transfer (case insensitive)
    const collectionName = (selectedCollection.name || selectedCollection.fileName || '').toLowerCase();
    return collectionName.includes('file transfer');
  }, [selectedCollectionPath, collections]);

  // Reset selected request if it's not in the filtered list
  useEffect(() => {
    if (selectedRequest && availableRequests.length > 0) {
      const isRequestAvailable = availableRequests.some(r => r.displayName === selectedRequest.displayName);
      if (!isRequestAvailable) {
        setSelectedRequest(null);
        setApiResponse(null);
        setError(null);
        setParams({});
        setIdentifiedVariables([]);
        setParamSource({});
        setUrlDetails(null);
      }
    }
  }, [availableRequests, selectedRequest]);

  // Reset environment to "None" when downlink/deregister/file transfer/fuota collection is selected
  useEffect(() => {
    if (isDownlinkDeregisterCollection && selectedEnvIdx !== 0) {
      console.log('[ApiTestPage] Downlink/deregister/file transfer/fuota collection detected, resetting environment to None');
      setSelectedEnvIdx(0);
    }
  }, [isDownlinkDeregisterCollection, selectedEnvIdx]);

  // Memoize certificate loading callback
  const handleCertificateLoad = useCallback((certificate) => {
    console.log('[Page6] handleCertificateLoad called with:', certificate);
    setSelectedCertificate(certificate);
    
    // If certificate loaded successfully, log details
    if (certificate) {
      console.log('[Page6] Certificate successfully set:', {
        certificateId: certificate.certificateid,
        deviceId: certificate.deviceid,
        path: certificate.path,
        id: certificate.id
      });
    } else {
      console.log('[Page6] Certificate is null or undefined');
    }
  }, []);

  // Optimized save state with priority levels
  const saveState = useCallback(async () => {
    try {
      // Only save if component is properly initialized and has meaningful data
      if (isLoadingState || isCollectionsCacheLoading) {
        return; // Don't save while loading
      }

      const criticalState = {
        selectedCollectionPath,
        selectedRequest: selectedRequest ? {
          name: selectedRequest.name,
          displayName: selectedRequest.displayName,
          request: selectedRequest.request
        } : null,
        params,
        authType,
        selectedApiConfigId,
        selectedProfile,
        selectedEnvIdx,
        identifiedVariables,
        paramSource,
        bearerToken,
        apiKeyAuth,
        basicAuth,
        expandedSections,
        urlDetails,
        timestamp: Date.now()
      };
      
      await window.electronAPI.saveApiTestState(criticalState);
      console.log('[ApiTestPage] State saved successfully');
    } catch (error) {
      console.error('[ApiTestPage] Failed to save state:', error);
    }
  }, [
    selectedCollectionPath,
    selectedRequest,
    params,
    identifiedVariables,
    selectedApiConfigId,
    selectedProfile,
    bearerToken,
    apiKeyAuth,
    basicAuth,
    authType,
    expandedSections,
    selectedEnvIdx,
    paramSource,
    urlDetails,
    isLoadingState,
    isCollectionsCacheLoading,
    isRestoringState,
    restorationProtectionEnd
  ]);

  // Optimized load state with progressive loading
  const loadState = useCallback(async () => {
    if (isCollectionsCacheLoading || isApiConfigsLoading) {
      return; // Wait for collections and API configs to load first
    }

    setIsLoadingState(true);
    setIsRestoringState(true); // Prevent auth reset during restoration
    try {
      const savedState = await window.electronAPI.loadApiTestState();
      if (savedState && savedState.timestamp) {
        console.log('[ApiTestPage] Loading saved state:', savedState);
        
        // Validate that the saved state is not too old (24 hours)
        const isStateValid = (Date.now() - savedState.timestamp) < (24 * 60 * 60 * 1000);
        if (!isStateValid) {
          console.log('[ApiTestPage] Saved state is too old, skipping restore');
          setIsLoadingState(false);
          return;
        }
        
        // Load critical state first
        if (savedState.selectedCollectionPath) {
          setSelectedCollectionPath(savedState.selectedCollectionPath);
        }
        if (typeof savedState.selectedEnvIdx === 'number') {
          setSelectedEnvIdx(savedState.selectedEnvIdx);
        }
        if (savedState.authType) {
          console.log('[ApiTestPage] Restoring authType:', savedState.authType);
          setAuthType(savedState.authType);
          // Also log the current restoration state
          console.log('[ApiTestPage] isRestoringState is:', isRestoringState);
        }
        if (savedState.selectedApiConfigId) {
          console.log('[ApiTestPage] Restoring selectedApiConfigId:', savedState.selectedApiConfigId);
          setSelectedApiConfigId(savedState.selectedApiConfigId);
        }
        if (savedState.selectedProfile) {
          console.log('[ApiTestPage] Restoring selectedProfile:', savedState.selectedProfile);
          setSelectedProfile(savedState.selectedProfile);
        }
        if (savedState.params) {
          setParams(savedState.params);
        }
        if (savedState.identifiedVariables) {
          setIdentifiedVariables(savedState.identifiedVariables);
        }
        if (savedState.paramSource) {
          setParamSource(savedState.paramSource);
        }
        if (savedState.bearerToken) {
          setBearerToken(savedState.bearerToken);
        }
        if (savedState.apiKeyAuth) {
          setApiKeyAuth(savedState.apiKeyAuth);
        }
        if (savedState.basicAuth) {
          setBasicAuth(savedState.basicAuth);
        }
        if (savedState.expandedSections) {
          setExpandedSections(savedState.expandedSections);
        }
        if (savedState.urlDetails) {
          setUrlDetails(savedState.urlDetails);
        }
        
        // Wait a bit for collections to be available, then restore request
        setTimeout(() => {
          if (savedState.selectedRequest && collections.length > 0) {
            const collection = collections.find(c => c.filePath === savedState.selectedCollectionPath);
            if (collection) {
              setSelectedRequest(savedState.selectedRequest);
            }
          }
        }, 100);
        
        console.log('[ApiTestPage] State restored successfully');
      } else {
        console.log('[ApiTestPage] No valid saved state found');
      }
    } catch (error) {
      console.error('[ApiTestPage] Failed to load state:', error);
    } finally {
      setIsLoadingState(false);
      // Delay clearing the restoration flag to allow all effects to complete
      setTimeout(() => {
        console.log('[ApiTestPage] Clearing restoration flag, current authType:', authType);
        setIsRestoringState(false);
        // Set protection period for 2 more seconds
        setRestorationProtectionEnd(Date.now() + 2000);
      }, 500); // Increase to 500ms
    }
  }, [collections, isCollectionsCacheLoading, isApiConfigsLoading]);

  // Clear API Response
  const clearApiResponse = useCallback(() => {
    setApiResponse(null);
    setError(null);
    console.log('[ApiTestPage] API Response cleared');
  }, []);

  // Load state on component mount
  useEffect(() => {
    // Only load state after collections and API configs are loaded
    if (!isCollectionsCacheLoading && !isApiConfigsLoading && collections.length >= 0) {
      loadState();
    }
  }, [loadState, isCollectionsCacheLoading, isApiConfigsLoading, collections.length]);

  // Save state whenever relevant state changes (with debouncing)
  useEffect(() => {
    // Don't save during loading or if no meaningful data
    if (isLoadingState || isCollectionsCacheLoading) {
      return;
    }
    
    // Only save if we have some meaningful state
    if (selectedCollectionPath || Object.keys(params).length > 0 || selectedRequest) {
      const timeoutId = setTimeout(() => {
        saveState();
      }, 2000); // Increase debounce to 2000ms to reduce frequency
      
      return () => clearTimeout(timeoutId);
    }
  }, [
    selectedCollectionPath,
    selectedRequest,
    params,
    identifiedVariables,
    selectedApiConfigId,
    selectedProfile,
    bearerToken,
    apiKeyAuth,
    basicAuth,
    authType,
    expandedSections,
    selectedEnvIdx,
    paramSource,
    urlDetails,
    saveState,
    isLoadingState,
    isCollectionsCacheLoading,
    isRestoringState,
    restorationProtectionEnd
  ]);

  // Save state before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveState();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Save state when component unmounts (user switches tabs)
      saveState();
    };
  }, [saveState]);

  // Fetch API Credential Configs from ApiSettings
  useEffect(() => {
    const loadApiConfigs = async () => {
      setIsApiConfigsLoading(true);
      setApiConfigsError(null);
      try {
        const configs = await window.electronAPI.getApiCredentialConfigs(); // Assuming this is exposed
        setApiConfigs(configs || []);
        if (!configs || configs.length === 0) {
          console.log('[Page6] No API credential configs loaded from ApiSettings or returned empty.');
        }
      } catch (err) {
        console.error('Error loading API credential configs:', err);
        setApiConfigsError(`Failed to load API credential configs: ${err.message}`);
      } finally {
        setIsApiConfigsLoading(false);
      }
    };
    loadApiConfigs();
  }, []);

  // Load profiles when selectedApiConfigId changes (including during state restoration)
  useEffect(() => {
    if (selectedApiConfigId && !isApiConfigsLoading) {
      console.log('[ApiTestPage] Loading profiles for config:', selectedApiConfigId);
      loadProfilesForSelectedConfig(selectedApiConfigId);
    }
  }, [selectedApiConfigId, isApiConfigsLoading]);

  // Effect to extract variables when a request is selected
  useEffect(() => {
    if (selectedRequest && selectedRequest.request) {
      const reqData = selectedRequest.request;
      let vars = new Set();

      // Extract from URL
      if (reqData.url && typeof reqData.url.raw === 'string') {
        extractVariablesFromString(reqData.url.raw).forEach(v => vars.add(v));
      }
      // Extract from Headers
      if (reqData.header && Array.isArray(reqData.header)) {
          reqData.header.forEach(h => {
              extractVariablesFromString(h.key).forEach(v => vars.add(v));
              extractVariablesFromString(h.value).forEach(v => vars.add(v));
          });
      }
      // Extract from body (enhanced to support JSON structure parsing)
      if (reqData.body && reqData.body.mode === 'raw' && typeof reqData.body.raw === 'string') {
        // Extract template variables first
        extractVariablesFromString(reqData.body.raw).forEach(v => vars.add(v));
        
        // Extract body parameter structure
        getBodyParametersFromSample(reqData.body).forEach(v => vars.add(v));
      }
      
      // TODO: Consider extracting from other body types (formdata, urlencoded) if needed
      
      const newVariables = Array.from(vars);
      setIdentifiedVariables(newVariables);
      
      // Initialize params for new variables and extract pre-filled values from request body
      const bodyValues = reqData.body ? getBodyParameterValues(reqData.body) : {};
      
      // Only set params if this is a completely new request (avoid overwriting user changes)
      setParams(prevParams => {
        const newParams = {};
        newVariables.forEach(v => {
          // Keep existing user input, or use pre-filled values from body, or default to empty
          newParams[v] = prevParams[v] || bodyValues[v] || '';
        });
        return newParams;
      });
      
      // Only reset auth state if not currently restoring state
      const isProtected = isRestoringState || Date.now() < restorationProtectionEnd;
      if (!isProtected) {
        console.log('[ApiTestPage] Resetting auth state due to request change');
        setAuthType('none'); // Reset auth type when request changes
        setBearerToken(''); // Clear bearer token when request changes
        setApiKeyAuth(createDefaultApiKeyAuth());
        setBasicAuth(createDefaultBasicAuth());
        setSelectedApiConfigId(''); // Clear API config when request changes
        setSelectedProfile(''); // Clear AWS profile when request changes
      } else {
        console.log('[ApiTestPage] Skipping auth reset due to state restoration or protection period');
      }
    } else {
      setIdentifiedVariables([]);
      setParams({});
      // Only reset auth state if not currently restoring state
      const isProtected = isRestoringState || Date.now() < restorationProtectionEnd;
      if (!isProtected) {
        console.log('[ApiTestPage] Resetting auth state due to no request');
        setAuthType('none'); // Reset auth type when no request
        setBearerToken(''); // Clear bearer token when no request
        setApiKeyAuth(createDefaultApiKeyAuth());
        setBasicAuth(createDefaultBasicAuth());
        setSelectedApiConfigId(''); // Clear API config when no request
        setSelectedProfile(''); // Clear AWS profile when no request
      } else {
        console.log('[ApiTestPage] Skipping auth reset due to state restoration or protection period (no request)');
      }
    }
  }, [selectedRequest, isRestoringState, restorationProtectionEnd]); // Rerun when selectedRequest changes

  useEffect(() => {
    if (selectedRequest && selectedRequest.request) {
      const urlRaw = selectedRequest.request.url?.raw || '';
      const parsedDetails = parseUrlDetails(urlRaw);
      
      // Extract body parameters if this is a POST request with body
      let bodyParams = [];
      if (selectedRequest.request.body && selectedRequest.request.body.raw) {
        bodyParams = getBodyParametersFromSample(selectedRequest.request.body)
          .filter(param => !param.includes('[') && !param.includes('.')); // Simple params only for display
      }
      
      setUrlDetails({
        ...parsedDetails,
        bodyParams: bodyParams
      });
    } else {
      setUrlDetails(null);
    }
  }, [selectedRequest]);

  const handleCollectionChange = (event) => {
    setSelectedCollectionPath(event.target.value);
    setSelectedEnvIdx(0); // Reset to None
    setSelectedRequest(null); // Reset request on collection change
    setApiResponse(null);
    setError(null);
    // Only reset auth state if not currently restoring state
    const isProtected = isRestoringState || Date.now() < restorationProtectionEnd;
    if (!isProtected) {
      setAuthType('none'); // Reset auth type on collection change
      setBearerToken(''); // Clear bearer token on collection change
      setApiKeyAuth(createDefaultApiKeyAuth());
      setBasicAuth(createDefaultBasicAuth());
      setSelectedApiConfigId(''); // Clear API config on collection change
      setSelectedProfile(''); // Clear AWS profile on collection change
    }
    setParams({}); // Clear parameters on collection change
    setIdentifiedVariables([]); // Clear variables on collection change
    setParamSource({}); // Clear param source on collection change
    setUrlDetails(null); // Clear URL details on collection change
  };

  const handleRequestChange = (event) => {
    const requestName = event.target.value;
    const req = availableRequests.find(r => r.displayName === requestName);
    setSelectedRequest(req || null);
    setApiResponse(null); 
    setError(null); 
    // Only reset auth state if not currently restoring state
    const isProtected = isRestoringState || Date.now() < restorationProtectionEnd;
    if (!isProtected) {
      setAuthType('none'); // Reset auth type on request change
      setBearerToken(''); // Clear bearer token on request change
      setApiKeyAuth(createDefaultApiKeyAuth());
      setBasicAuth(createDefaultBasicAuth());
      setSelectedApiConfigId(''); // Clear API config on request change
      setSelectedProfile(''); // Clear AWS profile on request change
    }
    // Note: params, identifiedVariables, paramSource, and urlDetails will be set by useEffect
  };

  // Helper function to validate file transfer collection parameters
  const validateFileTransferParam = (paramName, value) => {
    if (!isFileTransferCollection) return value;
    
    switch (paramName) {
      case 'AWS_IOTWIRELESS_URL':
        // Remove 'http://' and 'fuota-tasks' from the value
        return value.replace(/https:\/\//gi, '').replace(/\/?fuota-tasks/gi, '');
      
      case 'file_size':
        // Remove 'bytes' from the value and keep only numbers
        return value.replace(/bytes/gi, '').replace(/[^0-9]/g, '');
      
      case 'fragment_size':
        // Keep only numbers
        return value.replace(/[^0-9]/g, '');
      
      default:
        return value;
    }
  };

  // Helper function to get helper text for file transfer collection parameters
  const getFileTransferParamHelperText = (paramName) => {
    if (!isFileTransferCollection) return '';
    
    switch (paramName) {
      case 'AWS_IOTWIRELESS_URL':
        return 'https:// and fuota-tasks are not allowed in this field';
      
      case 'file_size':
        return 'Numbers only';
      
      case 'fragment_size':
        return 'Numbers only';
      
      default:
        return '';
    }
  };

  const handleParamChange = (event) => {
    const { name, value } = event.target;
    const validatedValue = validateFileTransferParam(name, value);
    setParams(prev => ({ ...prev, [name]: validatedValue }));
  };

  const handleApiConfigChange = async (event) => {
    const configId = event.target.value;
    setSelectedApiConfigId(configId);
    // Profile loading will be handled by useEffect
  };

  const handleProfileChange = (event) => {
    setSelectedProfile(event.target.value);
  };

  const handleBearerTokenChange = (event) => {
    setBearerToken(event.target.value);
  };

  const handleApiKeyAuthChange = (field) => (event) => {
    setApiKeyAuth(prev => ({
      ...prev,
      [field]: event.target.value
    }));
  };

  const handleBasicAuthChange = (field) => (event) => {
    setBasicAuth(prev => ({
      ...prev,
      [field]: event.target.value
    }));
  };

  const handleAuthTypeChange = (event) => {
    const newAuthType = event.target.value;
    setAuthType(newAuthType);
    
    // Clear other auth methods when switching
    if (newAuthType !== 'aws') {
      setSelectedApiConfigId('');
      setSelectedProfile('');
      setAvailableProfiles([]);
    }
    if (newAuthType !== 'bearer') {
      setBearerToken('');
    }
    if (newAuthType !== 'apiKey') {
      setApiKeyAuth(createDefaultApiKeyAuth());
      setShowApiKeyValue(false);
    }
    if (newAuthType !== 'basic') {
      setBasicAuth(createDefaultBasicAuth());
      setShowBasicPassword(false);
    }
  };

  const handleSendRequest = async () => {
    if (!selectedRequest) {
      setError('Please select a request to send.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setApiResponse(null); // Clear previous response when sending new request
    
    try {
      console.log('Sending request:', selectedRequest.displayName);
      console.log('With parameters:', params);
      console.log('Authentication type:', authType);
      console.log('Selected environment:', selectedEnv);
      if (authType === 'aws' && selectedApiConfigId) {
        console.log('Using AWS SigV4 with API Credential Config ID:', selectedApiConfigId);
        if (selectedProfile) {
          console.log('Using AWS Profile:', selectedProfile);
        }
      } else if (authType === 'bearer' && bearerToken) {
        console.log('Using Bearer Token authentication');
      } else if (authType === 'apiKey' && apiKeyAuth.value) {
        console.log('Using API Key authentication');
      } else if (authType === 'basic' && basicAuth.username && basicAuth.password) {
        console.log('Using Basic authentication');
      } else {
        console.log('No authentication configured');
      }

      const requestToSend = applyApiAuthentication(selectedRequest, {
        type: authType,
        bearerToken,
        apiKey: apiKeyAuth,
        basic: basicAuth
      });

      const result = await window.electronAPI.executePostmanRequest({ 
        requestDetails: requestToSend, // Pass the (potentially modified) request
        params: params, // Use the original params for sending
        apiConfigId: authType === 'aws' ? selectedApiConfigId || null : null, // Only pass config ID for AWS auth
        selectedProfile: authType === 'aws' ? selectedProfile || null : null, // Only pass AWS profile for AWS auth
        selectedEnvironment: selectedEnvIdx > 0 ? selectedEnv : null, // Pass selected environment info
        isFileTransferCollection: isFileTransferCollection // Pass collection type for service selection
      });
      console.log('API Response:', result);
      console.log('API Response Headers:', result.headers);
      if (result.success) {
        setApiResponse(result);
        
        // Auto-increment sequence ID parameters AFTER successful request
        const updatedParams = { ...params };
        identifiedVariables.forEach(variable => {
          if (isSequenceIdVariable(variable)) {
            const currentValue = updatedParams[variable];
            if (currentValue !== undefined && currentValue !== '') {
              const numValue = parseInt(currentValue, 10);
              if (!isNaN(numValue)) {
                updatedParams[variable] = (numValue + 1).toString();
              } else {
                // If it's not a valid number, start from 1
                updatedParams[variable] = '1';
              }
            } else {
              // If empty, start from 1
              updatedParams[variable] = '1';
            }
          }
        });
        
        // Update the params state with incremented sequence IDs only after successful request
        setParams(updatedParams);
        
        // Ensure API Response section is expanded when we get a response
        setExpandedSections(prev => ({
          ...prev,
          response: true
        }));
      } else {
        setError(result.error || 'An unknown error occurred during the API call.');
        // Also expand response section to show the error
        setExpandedSections(prev => ({
          ...prev,
          response: true
        }));
      }
    } catch (err) {
      console.error('Error executing Postman request:', err);
      setError(`Failed to execute request: ${err.message}`);
      // Expand response section to show the error
      setExpandedSections(prev => ({
        ...prev,
        response: true
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // Function to check if selected API config is AWS credentials file and load profiles
  const loadProfilesForSelectedConfig = async (configId) => {
    if (!configId) {
      setAvailableProfiles([]);
      setSelectedProfile('');
      return;
    }

    const selectedConfig = apiConfigs.find(config => config.id === configId);
    if (!selectedConfig || !selectedConfig.path) {
      setAvailableProfiles([]);
      setSelectedProfile('');
      return;
    }

    // Check if this is an AWS credentials file
    const isAwsCredentials = selectedConfig.path.toLowerCase().includes('credentials') || 
                            selectedConfig.path.toLowerCase().includes('.aws');
    
    if (!isAwsCredentials) {
      setAvailableProfiles([]);
      setSelectedProfile('');
      return;
    }

    setIsProfilesLoading(true);
    try {
      const content = await window.electronAPI.readFileContent(selectedConfig.path);
      
      // Parse AWS credentials file to extract profiles
      const lines = content.replace(/\r\n/g, '\n').split('\n');
      const profiles = [];
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        const profileMatch = trimmedLine.match(/^\[([^\]]+)\]$/);
        if (profileMatch) {
          profiles.push(profileMatch[1]);
        }
      }
      
      setAvailableProfiles(profiles);
      if (profiles.length > 0) {
        setSelectedProfile(profiles[0]); // Default to first profile
      } else {
        setSelectedProfile('');
      }
    } catch (err) {
      console.error('Error loading profiles for AWS credentials file:', err);
      setAvailableProfiles([]);
      setSelectedProfile('');
    } finally {
      setIsProfilesLoading(false);
    }
  };

  // Helper function to get HTTP method color
  const getMethodColor = (method) => {
    const colors = {
      GET: '#4CAF50',
      POST: '#2196F3', 
      PUT: '#FF9800',
      DELETE: '#F44336',
      PATCH: '#9C27B0'
    };
    return colors[method?.toUpperCase()] || '#757575';
  };

  // Helper function to get status color
  const getStatusColor = (status) => {
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'info';
    if (status >= 400 && status < 500) return 'warning';
    if (status >= 500) return 'error';
    return 'default';
  };

  const handleSectionToggle = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Helper function to check if a variable might be device ID related
  const isDeviceIdVariable = (variableName) => {
    const lowerName = variableName.toLowerCase();
    return lowerName.includes('device') || 
           lowerName.includes('deviceid') || 
           lowerName.includes('device_id') ||
           lowerName.includes('applicationdeviceid') ||
           lowerName.includes('application_device_id');
  };

  // Helper to determine if a variable can be populated from certificate metadata.
  const isCertificateBackedIdParam = (name) => {
    const lower = name.toLowerCase();
    return lower === 'ringnetid' || lower === 'deviceid' || lower === 'wirelessdeviceid';
  };

  // Helper to get the correct certificate value for a parameter
  const getCertificateValueForParam = (paramName) => {
    if (!selectedCertificate) return null;
    const lower = paramName.toLowerCase();
    if (lower === 'ringnetid') {
      return selectedCertificate.certificateid;
    } else if (lower === 'deviceid' || lower === 'wirelessdeviceid') {
      return selectedCertificate.deviceid;
    }
    return null;
  };

  // Helper to check if certificate has the required value for a parameter
  const hasCertificateValueForParam = (paramName) => {
    const value = getCertificateValueForParam(paramName);
    return value != null && value !== '';
  };

  // When selectedCertificate or identifiedVariables changes, reset paramSource for new path params
  useEffect(() => {
    console.log('[DEBUG] paramSource useEffect triggered', { 
      urlDetails: urlDetails ? `${urlDetails.pathParams?.length || 0} path params` : 'null', 
      selectedCertificate: selectedCertificate ? `${selectedCertificate.certificateid}` : 'null', 
      identifiedVariables: `${identifiedVariables.length} variables` 
    });
    
    if (!urlDetails || !urlDetails.pathParams) {
      console.log('[DEBUG] No urlDetails or pathParams, resetting paramSource');
      setParamSource({});
      return;
    }
    
    setParamSource(prev => {
      const newSource = { ...prev };
      urlDetails.pathParams.forEach((param) => {
        console.log('[DEBUG] Processing path param:', param, 'isCertificateBackedIdParam:', isCertificateBackedIdParam(param));
        if (isCertificateBackedIdParam(param)) {
          // If param is empty and certificate exists, default to certificate, else manual
          if ((params[param] === '' || params[param] == null) && hasCertificateValueForParam(param)) {
            console.log('[DEBUG] Setting', param, 'to certificate mode');
            newSource[param] = 'certificate';
          } else if (!newSource[param]) {
            console.log('[DEBUG] Setting', param, 'to manual mode');
            newSource[param] = 'manual';
          }
        }
      });
      console.log('[DEBUG] New paramSource:', newSource);
      return newSource;
    });
  }, [selectedCertificate, identifiedVariables, urlDetails, params]);

  // When paramSource or certificate changes, update param value if source is certificate
  useEffect(() => {
    console.log('[DEBUG] Certificate sync useEffect triggered', { 
      paramSource: Object.keys(paramSource).length > 0 ? paramSource : 'empty',
      selectedCertificate: selectedCertificate ? `${selectedCertificate.certificateid}` : 'null' 
    });
    
    Object.entries(paramSource).forEach(([param, source]) => {
      if (source === 'certificate') {
        const certValue = getCertificateValueForParam(param);
        if (certValue && params[param] !== certValue) {
          console.log('[DEBUG] Updating param', param, 'with certificate value:', certValue);
          setParams(prev => ({ ...prev, [param]: certValue }));
        }
      }
    });
  }, [paramSource, selectedCertificate]);

  // Auto-apply certificate values when certificate is first loaded
  useEffect(() => {
    if (selectedCertificate && identifiedVariables.length > 0) {
      console.log('[DEBUG] Certificate auto-apply triggered - checking for auto-fillable parameters');
      
      const newParams = { ...params };
      const newParamSource = { ...paramSource };
      let hasUpdates = false;

      // Auto-apply certificate values to supported identifier parameters that are empty.
      identifiedVariables.forEach(paramName => {
        if (isCertificateBackedIdParam(paramName) && (!params[paramName] || params[paramName] === '')) {
          const certValue = getCertificateValueForParam(paramName);
          if (certValue) {
            console.log('[DEBUG] Auto-applying certificate value for', paramName, ':', certValue);
            newParams[paramName] = certValue;
            newParamSource[paramName] = 'certificate';
            hasUpdates = true;
          }
        }
      });

      if (hasUpdates) {
        console.log('[DEBUG] Applying certificate auto-fill updates');
        setParams(newParams);
        setParamSource(newParamSource);
      }
    }
  }, [selectedCertificate, identifiedVariables]); // Only run when certificate or variables change

  // Handler for toggle button
  const handleParamSourceToggle = (param) => {
    console.log('[DEBUG] Toggle button clicked for param:', param);
    setParamSource(prev => {
      const current = prev[param] || 'manual';
      console.log('[DEBUG] Current source for', param, ':', current);
      if (current === 'certificate') {
        console.log('[DEBUG] Switching to manual');
        return { ...prev, [param]: 'manual' };
      } else if (hasCertificateValueForParam(param)) {
        console.log('[DEBUG] Switching to certificate');
        // Switch to certificate and update value
        const certValue = getCertificateValueForParam(param);
        setParams(p => ({ ...p, [param]: certValue }));
        return { ...prev, [param]: 'certificate' };
      }
      console.log('[DEBUG] No change, no certificate available');
      return prev;
    });
  };

  // Handler for manual edit: switch to manual if user types
  const handleParamManualEdit = (event) => {
    const { name, value } = event.target;
    console.log('[DEBUG] Manual edit for param:', name, 'value:', value);
    const validatedValue = validateFileTransferParam(name, value);
    setParams(prev => ({ ...prev, [name]: validatedValue }));
    if (isCertificateBackedIdParam(name) && paramSource[name] === 'certificate') {
      console.log('[DEBUG] Switching', name, 'to manual due to user edit');
      setParamSource(prev => ({ ...prev, [name]: 'manual' }));
    }
  };

  // Handler to apply certificate wireless device ID to all device-related parameters
  const handleApplyCertificateToDeviceParams = (event) => {
    event?.stopPropagation(); // Prevent event bubbling to parent Box
    if (!selectedCertificate) return;
    
    const newParams = { ...params };
    const newParamSource = { ...paramSource };
    
    // Find all device-related and certificate-backed identifier parameters.
    const allDeviceParams = identifiedVariables.filter(isDeviceIdVariable);
    const allCertificateIdParams = identifiedVariables.filter(param =>
      param.toLowerCase().includes('ringnet') || param.toLowerCase() === 'ringnetid'
    );
    
    // Apply certificate deviceid to all device-related parameters
    if (selectedCertificate.deviceid) {
      allDeviceParams.forEach(paramName => {
        newParams[paramName] = selectedCertificate.deviceid;
        newParamSource[paramName] = 'certificate';
      });
    }
    
    // Apply certificate ID to certificate-backed parameters.
    if (selectedCertificate.certificateid) {
      allCertificateIdParams.forEach(paramName => {
        newParams[paramName] = selectedCertificate.certificateid;
        newParamSource[paramName] = 'certificate';
      });
    }
    
    setParams(newParams);
    setParamSource(newParamSource);
  };

  // Handler to reset parameters to original values from collection
  const handleResetToOriginalValues = (event) => {
    event?.stopPropagation(); // Prevent event bubbling to parent Box
    if (!selectedRequest || !selectedRequest.request) return;
    
    const reqData = selectedRequest.request;
    const bodyValues = reqData.body ? getBodyParameterValues(reqData.body) : {};
    
    const newParams = { ...params };
    const newParamSource = { ...paramSource };
    
    // Reset all parameters to their original values from the collection
    identifiedVariables.forEach(paramName => {
      if (bodyValues[paramName] !== undefined) {
        newParams[paramName] = bodyValues[paramName];
        // Reset source to manual for body parameters
        if (isBodyParameter(paramName, reqData.body)) {
          newParamSource[paramName] = 'manual';
        }
      }
    });
    
    setParams(newParams);
    setParamSource(newParamSource);
  };

  const isOverallLoading = isCollectionsCacheLoading || isApiConfigsLoading || isLoadingState;

  return (
    <Box sx={{ p: '8px', flexGrow: 1, backgroundColor: '#1a1a1a', height: 'calc(100vh - 110px)', overflow: 'hidden' }}>
      <CertificateLoader 
        onCertificateLoad={handleCertificateLoad}
        isLoadingCertificate={isLoadingCertificate}
        setIsLoadingCertificate={setIsLoadingCertificate}
      />
      
      {/* Loading overlay for state restoration */}
      {isLoadingState && (
        <Box 
          sx={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            flexDirection: 'column',
            gap: 2
          }}
        >
          <CircularProgress size={40} sx={{ color: THEME_COLORS.primary.main }} />
          <Typography sx={{ color: 'white', fontSize: '0.9rem' }}>
            Loading cached data...
          </Typography>
        </Box>
      )}
      <Grid container spacing={2} sx={{ 
        height: 'calc(100vh - 126px)',
        margin: 0,
        width: '100%',
        display: 'flex',
        flexWrap: 'nowrap',
        alignItems: 'stretch',
        '& > .MuiGrid-item': {
          paddingTop: '8px',
          paddingLeft: '8px',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0
        }
      }}>
        {/* Left Column: Controls */}
        <Grid size={{ xs: 12, md: 6 }} sx={{ 
          height: '100%', 
          display: 'flex', 
          flexDirection: 'column',
          flex: '1 1 50%',
          maxWidth: '50%'
        }}>
          <Box sx={{ 
            height: '100%', 
            width: '100%',
            overflow: 'auto',
            pr: 1, // Add right padding to create space from scrollbar
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              background: '#555',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: '#777',
            },
          }}>
            {/* Collection & Request Selection */}
            <Card elevation={2} sx={{ mb: 2 }}>
              <CardContent sx={{ p: '8px !important' }}>
                <Stack spacing={2}>
                  <Typography variant="subtitle1" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem' }}>
                    <CodeIcon color="primary" sx={{ fontSize: '1.2rem' }} />
                    Collection & Request
                  </Typography>
                  
                  {isCollectionsCacheLoading && (
                    <Alert 
                      severity="info" 
                      icon={<CircularProgress size={20} />}
                      sx={{ 
                        backgroundColor: '#3d3d3d', 
                        color: 'white',
                        '& .MuiAlert-icon': { color: '#2196f3' }
                      }}
                    >
                      Loading collections...
                    </Alert>
                  )}
                  
                  <Box>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                      <Typography variant="body2" sx={{ color: '#b0b0b0' }}>
                        Collection
                      </Typography>
                      <Chip 
                        label={`${collections.length} collections`}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(33, 150, 243, 0.15)',
                          color: '#64b5f6',
                          border: '1px solid rgba(33, 150, 243, 0.3)',
                          fontSize: '0.7rem',
                          height: '20px',
                          '& .MuiChip-label': { px: 1 }
                        }}
                      />
                    </Stack>
                    <FormControl fullWidth>
                      <Select
                        id="collection-select"
                        value={selectedCollectionPath}
                        onChange={handleCollectionChange}
                        disabled={isCollectionsCacheLoading || collections.length === 0}
                        displayEmpty
                        sx={{
                          color: 'white',
                          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#555' },
                          '& .MuiSvgIcon-root': { color: 'white' },
                          '& .MuiSelect-select': { backgroundColor: 'transparent' }
                        }}
                        MenuProps={{
                          PaperProps: {
                            sx: {
                              backgroundColor: '#2d2d2d',
                              color: 'white',
                              '& .MuiMenuItem-root': {
                                backgroundColor: '#2d2d2d',
                                color: 'white',
                                '&:hover': { backgroundColor: '#3d3d3d' },
                                '&.Mui-selected': { backgroundColor: '#1976d2' }
                              }
                            }
                          }
                        }}
                      >
                        <MenuItem key="select-collection-placeholder" value="" disabled>
                          <em>Select a Collection</em>
                        </MenuItem>
                        {collections.map((col) => (
                          <MenuItem key={col.filePath} value={col.filePath}>
                            <Stack direction="row" alignItems="center" spacing={1}>
                              <CodeIcon sx={{ fontSize: '1rem', color: '#64b5f6' }} />
                              <Typography>{col.name || col.fileName}</Typography>
                            </Stack>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>

                  <Box sx={{ mt: 2, mb: 2 }}>
                    <FormControl fullWidth>
                      <InputLabel id="env-select-label" sx={{ color: '#b0b0b0' }}>Environment</InputLabel>
                      <Select
                        labelId="env-select-label"
                        id="env-select"
                        value={selectedEnvIdx}
                        label="Environment"
                        onChange={e => setSelectedEnvIdx(Number(e.target.value))}
                        disabled={isDownlinkDeregisterCollection}
                        sx={{
                          color: 'white',
                          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#555' },
                          '& .MuiSvgIcon-root': { color: 'white' },
                          '& .MuiSelect-select': { backgroundColor: 'transparent' },
                        }}
                        MenuProps={{
                          PaperProps: {
                            sx: {
                              backgroundColor: '#2d2d2d',
                              color: 'white',
                              '& .MuiMenuItem-root': {
                                backgroundColor: '#2d2d2d',
                                color: 'white',
                                '&:hover': { backgroundColor: '#3d3d3d' },
                                '&.Mui-selected': { backgroundColor: '#1976d2' },
                              },
                            },
                          },
                        }}
                      >
                        {ENVIRONMENTS.map((env, idx) => (
                          <MenuItem key={env.label} value={idx}>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                              {idx !== 0 && (
                                <Chip 
                                  label="Preset"
                                  size="small"
                                  sx={{
                                    height: '20px',
                                    fontSize: '0.65rem',
                                    fontWeight: 'bold',
                                    backgroundColor: '#455a64',
                                    color: 'white',
                                    '& .MuiChip-label': { px: 1 }
                                  }}
                                />
                              )}
                              <Typography sx={{ flex: 1 }}>{env.label}</Typography>
                            </Stack>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    {isDownlinkDeregisterCollection && (
                      <Alert 
                        severity="info"
                        sx={{ 
                          mt: 1,
                          backgroundColor: '#3d3d3d', 
                          color: 'white',
                          '& .MuiAlert-icon': { color: '#2196f3' }
                        }}
                      >
                        Environment selection is disabled for downlink/deregister/file transfer/fuota collections. These collections use their own endpoints.
                      </Alert>
                    )}
                  </Box>
                  
                  <Box>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                      <Typography variant="body2" sx={{ color: '#b0b0b0' }}>
                        Request
                      </Typography>
                      {selectedCollectionPath && (
                        <Chip 
                          label={`${availableRequests.length} requests`}
                          size="small"
                          sx={{
                            backgroundColor: 'rgba(156, 39, 176, 0.15)',
                            color: '#ba68c8',
                            border: '1px solid rgba(156, 39, 176, 0.3)',
                            fontSize: '0.7rem',
                            height: '20px',
                            '& .MuiChip-label': { px: 1 }
                          }}
                        />
                      )}
                    </Stack>
                    <FormControl 
                      fullWidth 
                      disabled={isCollectionsCacheLoading || !selectedCollectionPath || availableRequests.length === 0}
                    >
                      <Select
                        id="request-select"
                        value={selectedRequest && availableRequests.some(r => r.displayName === selectedRequest.displayName) ? selectedRequest.displayName : ''}
                        onChange={handleRequestChange}
                        displayEmpty
                        sx={{ 
                          color: 'white',
                          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#555' },
                          '& .MuiSvgIcon-root': { color: 'white' },
                          '& .MuiSelect-select': { backgroundColor: 'transparent' }
                        }}
                        MenuProps={{
                          PaperProps: {
                            sx: {
                              backgroundColor: '#2d2d2d',
                              color: 'white',
                              '& .MuiMenuItem-root': {
                                backgroundColor: '#2d2d2d',
                                color: 'white',
                                '&:hover': { backgroundColor: '#3d3d3d' },
                                '&.Mui-selected': { backgroundColor: '#1976d2' }
                              }
                            }
                          }
                        }}
                      >
                        <MenuItem key="select-request-placeholder" value="" disabled>
                          <em>Select a Request</em>
                        </MenuItem>
                        {availableRequests.map((req) => (
                          <MenuItem key={req.displayName} value={req.displayName}>
                            <Stack direction="row" alignItems="center" spacing={1.5}>
                              <Chip 
                                label={req.request?.method || 'GET'} 
                                size="small" 
                                sx={{ 
                                  backgroundColor: getMethodColor(req.request?.method),
                                  color: 'white',
                                  fontWeight: 'bold',
                                  minWidth: '50px',
                                  fontSize: '0.7rem'
                                }}
                              />
                              <Typography sx={{ flex: 1 }}>{req.displayName}</Typography>
                            </Stack>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                  
                  {!isCollectionsCacheLoading && collections.length === 0 && (
                    <Alert 
                      severity="warning"
                      sx={{ 
                        backgroundColor: '#3d3d3d', 
                        color: 'white',
                        '& .MuiAlert-icon': { color: '#ff9800' }
                      }}
                    >
                      <AlertTitle>No Collections Found</AlertTitle>
                      Please scan the folder in API Settings or check the cache.
                    </Alert>
                  )}
                </Stack>
              </CardContent>
            </Card>

            {/* Authentication Section */}
            <Card elevation={2} sx={{ mb: 2 }}>
              <CardContent sx={{ p: '8px !important' }}>
                <Stack spacing={2}>
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      cursor: 'pointer',
                      '&:hover': { opacity: 0.8 }
                    }}
                    onClick={() => handleSectionToggle('authentication')}
                  >
                    <Typography variant="subtitle1" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem', flexGrow: 1 }}>
                      <SecurityIcon color="primary" sx={{ fontSize: '1.2rem' }} />
                      Authentication
                      {(authType === 'aws' && selectedApiConfigId) && (
                        <Chip 
                          label="AWS SigV4" 
                          size="small" 
                          sx={{
                            backgroundColor: '#1976d2',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '0.75rem'
                          }}
                        />
                      )}
                      {(authType === 'bearer' && bearerToken) && (
                        <Chip 
                          label="Bearer Token" 
                          size="small" 
                          sx={{
                            backgroundColor: '#ff9800',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '0.75rem'
                          }}
                        />
                      )}
                      {(authType === 'apiKey' && apiKeyAuth.value) && (
                        <Chip 
                          label="API Key" 
                          size="small" 
                          sx={{
                            backgroundColor: '#7b1fa2',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '0.75rem'
                          }}
                        />
                      )}
                      {(authType === 'basic' && basicAuth.username && basicAuth.password) && (
                        <Chip 
                          label="Basic Auth" 
                          size="small" 
                          sx={{
                            backgroundColor: '#00897b',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '0.75rem'
                          }}
                        />
                      )}
                      {authType === 'none' && (
                        <Chip 
                          label="No Auth" 
                          size="small" 
                          sx={{
                            backgroundColor: '#666',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '0.75rem'
                          }}
                        />
                      )}
                    </Typography>
                    <ExpandMoreIcon 
                      sx={{ 
                        color: 'white',
                        transform: expandedSections.authentication ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.3s'
                      }} 
                    />
                  </Box>
                  
                  {expandedSections.authentication && (
                    <Stack spacing={2}>
                      {/* Authentication Type Selector */}
                      <FormControl component="fieldset">
                        <RadioGroup
                          row
                          value={authType}
                          onChange={handleAuthTypeChange}
                        >
                          <FormControlLabel 
                            value="none" 
                            control={<Radio sx={{ color: '#b0b0b0', '&.Mui-checked': { color: '#1976d2' } }} />} 
                            label={<Typography sx={{ color: 'white', fontSize: '0.9rem' }}>No Auth</Typography>}
                          />
                          <FormControlLabel 
                            value="bearer" 
                            control={<Radio sx={{ color: '#b0b0b0', '&.Mui-checked': { color: '#1976d2' } }} />} 
                            label={<Typography sx={{ color: 'white', fontSize: '0.9rem' }}>Bearer Token</Typography>}
                          />
                          <FormControlLabel 
                            value="apiKey" 
                            control={<Radio sx={{ color: '#b0b0b0', '&.Mui-checked': { color: '#1976d2' } }} />} 
                            label={<Typography sx={{ color: 'white', fontSize: '0.9rem' }}>API Key</Typography>}
                          />
                          <FormControlLabel 
                            value="basic" 
                            control={<Radio sx={{ color: '#b0b0b0', '&.Mui-checked': { color: '#1976d2' } }} />} 
                            label={<Typography sx={{ color: 'white', fontSize: '0.9rem' }}>Basic Auth</Typography>}
                          />
                          <FormControlLabel 
                            value="aws" 
                            control={<Radio sx={{ color: '#b0b0b0', '&.Mui-checked': { color: '#1976d2' } }} />} 
                            label={<Typography sx={{ color: 'white', fontSize: '0.9rem' }}>AWS SigV4</Typography>}
                            disabled={isApiConfigsLoading || (!isApiConfigsLoading && apiConfigs.length === 0)}
                          />
                        </RadioGroup>
                      </FormControl>

                      {/* AWS SigV4 Configuration */}
                      {authType === 'aws' && (
                        <Stack spacing={2}>
                          {isApiConfigsLoading && (
                            <Alert 
                              severity="info" 
                              icon={<CircularProgress size={20} />}
                              sx={{ 
                                backgroundColor: '#3d3d3d', 
                                color: 'white',
                                '& .MuiAlert-icon': { color: '#2196f3' }
                              }}
                            >
                              Loading API credential sets...
                            </Alert>
                          )}
                          
                          {apiConfigsError && (
                            <Alert 
                              severity="error"
                              sx={{ 
                                backgroundColor: '#3d3d3d', 
                                color: 'white',
                                '& .MuiAlert-icon': { color: '#f44336' }
                              }}
                            >
                              <AlertTitle>API Credential Set Loading Error</AlertTitle>
                              {apiConfigsError}
                            </Alert>
                          )}
                          
                          {!isApiConfigsLoading && !apiConfigsError && apiConfigs.length > 0 && (
                            <FormControl fullWidth>
                              <InputLabel id="api-config-select-label" sx={{ color: '#b0b0b0' }}>API Credential Set</InputLabel>
                              <Select
                                labelId="api-config-select-label"
                                id="api-config-select"
                                value={selectedApiConfigId}
                                label="API Credential Set"
                                onChange={handleApiConfigChange}
                                disabled={isOverallLoading || !selectedRequest}
                                sx={{ 
                                  color: 'white',
                                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#555' },
                                  '& .MuiSvgIcon-root': { color: 'white' },
                                  '& .MuiSelect-select': { backgroundColor: 'transparent' }
                                }}
                                MenuProps={{
                                  PaperProps: {
                                    sx: {
                                      backgroundColor: '#2d2d2d',
                                      color: 'white',
                                      '& .MuiMenuItem-root': {
                                        backgroundColor: '#2d2d2d',
                                        color: 'white',
                                        '&:hover': { backgroundColor: '#3d3d3d' },
                                        '&.Mui-selected': { backgroundColor: '#1976d2' }
                                      }
                                    }
                                  }
                                }}
                              >
                                <MenuItem key="select-credential-placeholder" value=""><em>Select a credential set</em></MenuItem>
                                {apiConfigs.map((config) => (
                                  <MenuItem key={config.id} value={config.id}>
                                    <Stack direction="row" alignItems="center" spacing={2}>
                                      <SettingsIcon fontSize="small" />
                                      <Typography>{config.name}</Typography>
                                    </Stack>
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          )}
                          
                          {!isApiConfigsLoading && !apiConfigsError && apiConfigs.length === 0 && (
                            <Alert 
                              severity="warning"
                              sx={{ 
                                backgroundColor: '#3d3d3d', 
                                color: 'white',
                                '& .MuiAlert-icon': { color: '#ff9800' }
                              }}
                            >
                              <AlertTitle>No API Credential Sets</AlertTitle>
                              Please add AWS credential sets in ApiSettings to use AWS SigV4 authentication.
                            </Alert>
                          )}

                          {/* AWS Profile Selection */}
                          {selectedApiConfigId && availableProfiles.length > 0 && (
                            <FormControl fullWidth>
                              <InputLabel id="profile-select-label" sx={{ color: '#b0b0b0' }}>AWS Profile</InputLabel>
                              <Select
                                labelId="profile-select-label"
                                id="profile-select"
                                value={selectedProfile}
                                label="AWS Profile"
                                onChange={handleProfileChange}
                                disabled={isOverallLoading || !selectedRequest || isProfilesLoading}
                                sx={{ 
                                  color: 'white',
                                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#555' },
                                  '& .MuiSvgIcon-root': { color: 'white' },
                                  '& .MuiSelect-select': { backgroundColor: 'transparent' }
                                }}
                                MenuProps={{
                                  PaperProps: {
                                    sx: {
                                      backgroundColor: '#2d2d2d',
                                      color: 'white',
                                      '& .MuiMenuItem-root': {
                                        backgroundColor: '#2d2d2d',
                                        color: 'white',
                                        '&:hover': { backgroundColor: '#3d3d3d' },
                                        '&.Mui-selected': { backgroundColor: '#1976d2' }
                                      }
                                    }
                                  }
                                }}
                              >
                                {availableProfiles.map((profile) => (
                                  <MenuItem key={profile} value={profile}>
                                    {profile}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          )}
                          
                          {isProfilesLoading && (
                            <Alert 
                              severity="info" 
                              icon={<CircularProgress size={20} />}
                              sx={{ 
                                backgroundColor: '#3d3d3d', 
                                color: 'white',
                                '& .MuiAlert-icon': { color: '#2196f3' }
                              }}
                            >
                              Loading AWS profiles...
                            </Alert>
                          )}
                        </Stack>
                      )}

                      {/* Bearer Token Configuration */}
                      {authType === 'bearer' && (
                        <TextField
                          label="Token Value"
                          value={bearerToken}
                          onChange={handleBearerTokenChange}
                          fullWidth
                          type={showBearerToken ? 'text' : 'password'}
                          disabled={isOverallLoading || !selectedRequest}
                          placeholder="Enter your bearer token"
                          InputLabelProps={{ 
                            shrink: !!bearerToken,
                            sx: { color: '#b0b0b0' }
                          }}
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              color: 'white',
                              backgroundColor: 'transparent',
                              '& fieldset': { borderColor: '#555' },
                              '&:hover fieldset': { borderColor: '#777' },
                              '&.Mui-focused fieldset': { borderColor: '#1976d2' }
                            }
                          }}
                          InputProps={{
                            endAdornment: (
                              <IconButton
                                onClick={() => setShowBearerToken(!showBearerToken)}
                                edge="end"
                                size="small"
                                sx={{ color: 'white' }}
                              >
                                {showBearerToken ? <VisibilityOffIcon /> : <VisibilityIcon />}
                              </IconButton>
                            )
                          }}
                        />
                      )}

                      {/* API Key Configuration */}
                      {authType === 'apiKey' && (
                        <Stack spacing={2}>
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                            <TextField
                              label="Key Name"
                              value={apiKeyAuth.key}
                              onChange={handleApiKeyAuthChange('key')}
                              fullWidth
                              disabled={isOverallLoading || !selectedRequest}
                              placeholder="x-api-key"
                              InputLabelProps={{ 
                                shrink: !!apiKeyAuth.key,
                                sx: { color: '#b0b0b0' }
                              }}
                              sx={{
                                '& .MuiOutlinedInput-root': {
                                  color: 'white',
                                  backgroundColor: 'transparent',
                                  '& fieldset': { borderColor: '#555' },
                                  '&:hover fieldset': { borderColor: '#777' },
                                  '&.Mui-focused fieldset': { borderColor: '#1976d2' }
                                }
                              }}
                            />
                            <FormControl fullWidth>
                              <InputLabel id="api-key-placement-label" sx={{ color: '#b0b0b0' }}>Add To</InputLabel>
                              <Select
                                labelId="api-key-placement-label"
                                value={apiKeyAuth.placement}
                                label="Add To"
                                onChange={handleApiKeyAuthChange('placement')}
                                disabled={isOverallLoading || !selectedRequest}
                                sx={{ 
                                  color: 'white',
                                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#555' },
                                  '& .MuiSvgIcon-root': { color: 'white' },
                                  '& .MuiSelect-select': { backgroundColor: 'transparent' }
                                }}
                                MenuProps={{
                                  PaperProps: {
                                    sx: {
                                      backgroundColor: '#2d2d2d',
                                      color: 'white',
                                      '& .MuiMenuItem-root': {
                                        backgroundColor: '#2d2d2d',
                                        color: 'white',
                                        '&:hover': { backgroundColor: '#3d3d3d' },
                                        '&.Mui-selected': { backgroundColor: '#1976d2' }
                                      }
                                    }
                                  }
                                }}
                              >
                                <MenuItem value="header">Header</MenuItem>
                                <MenuItem value="query">Query Parameter</MenuItem>
                              </Select>
                            </FormControl>
                          </Stack>
                          <TextField
                            label="Key Value"
                            value={apiKeyAuth.value}
                            onChange={handleApiKeyAuthChange('value')}
                            fullWidth
                            type={showApiKeyValue ? 'text' : 'password'}
                            disabled={isOverallLoading || !selectedRequest}
                            placeholder="Enter your API key"
                            InputLabelProps={{ 
                              shrink: !!apiKeyAuth.value,
                              sx: { color: '#b0b0b0' }
                            }}
                            sx={{
                              '& .MuiOutlinedInput-root': {
                                color: 'white',
                                backgroundColor: 'transparent',
                                '& fieldset': { borderColor: '#555' },
                                '&:hover fieldset': { borderColor: '#777' },
                                '&.Mui-focused fieldset': { borderColor: '#1976d2' }
                              }
                            }}
                            InputProps={{
                              endAdornment: (
                                <IconButton
                                  onClick={() => setShowApiKeyValue(!showApiKeyValue)}
                                  edge="end"
                                  size="small"
                                  sx={{ color: 'white' }}
                                >
                                  {showApiKeyValue ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                </IconButton>
                              )
                            }}
                          />
                        </Stack>
                      )}

                      {/* Basic Auth Configuration */}
                      {authType === 'basic' && (
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                          <TextField
                            label="Username"
                            value={basicAuth.username}
                            onChange={handleBasicAuthChange('username')}
                            fullWidth
                            disabled={isOverallLoading || !selectedRequest}
                            placeholder="Enter username"
                            InputLabelProps={{ 
                              shrink: !!basicAuth.username,
                              sx: { color: '#b0b0b0' }
                            }}
                            sx={{
                              '& .MuiOutlinedInput-root': {
                                color: 'white',
                                backgroundColor: 'transparent',
                                '& fieldset': { borderColor: '#555' },
                                '&:hover fieldset': { borderColor: '#777' },
                                '&.Mui-focused fieldset': { borderColor: '#1976d2' }
                              }
                            }}
                          />
                          <TextField
                            label="Password"
                            value={basicAuth.password}
                            onChange={handleBasicAuthChange('password')}
                            fullWidth
                            type={showBasicPassword ? 'text' : 'password'}
                            disabled={isOverallLoading || !selectedRequest}
                            placeholder="Enter password"
                            InputLabelProps={{ 
                              shrink: !!basicAuth.password,
                              sx: { color: '#b0b0b0' }
                            }}
                            sx={{
                              '& .MuiOutlinedInput-root': {
                                color: 'white',
                                backgroundColor: 'transparent',
                                '& fieldset': { borderColor: '#555' },
                                '&:hover fieldset': { borderColor: '#777' },
                                '&.Mui-focused fieldset': { borderColor: '#1976d2' }
                              }
                            }}
                            InputProps={{
                              endAdornment: (
                                <IconButton
                                  onClick={() => setShowBasicPassword(!showBasicPassword)}
                                  edge="end"
                                  size="small"
                                  sx={{ color: 'white' }}
                                >
                                  {showBasicPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                </IconButton>
                              )
                            }}
                          />
                        </Stack>
                      )}
                    </Stack>
                  )}
                </Stack>
              </CardContent>
            </Card>

            {/* Parameters Section */}
            <Card elevation={2} sx={{ mb: 2 }}>
              <CardContent sx={{ p: '12px !important' }}>
                <Stack spacing={2}>
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      cursor: 'pointer',
                      '&:hover': { opacity: 0.8 }
                    }}
                    onClick={() => handleSectionToggle('parameters')}
                  >
                    <Typography variant="subtitle1" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem', flexGrow: 1 }}>
                      <SettingsIcon color="primary" sx={{ fontSize: '1.2rem' }} />
                      Request Parameters
                      {isLoadingCertificate && (
                        <CircularProgress size={16} sx={{ color: '#2196f3' }} />
                      )}
                    </Typography>
                    <ExpandMoreIcon 
                      sx={{ 
                        color: 'white',
                        transform: expandedSections.parameters ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.3s'
                      }} 
                    />
                  </Box>
                  
                  {expandedSections.parameters && (
                    <Stack spacing={2}>
                      {/* Certificate Status Card */}
                      <Card 
                        elevation={0} 
                        sx={{ 
                          p: 2, 
                          backgroundColor: selectedCertificate ? THEME_COLORS.success.background : THEME_COLORS.warning.background,
                          border: selectedCertificate ? `1px solid ${THEME_COLORS.success.border}` : `1px solid ${THEME_COLORS.warning.border}`,
                          borderRadius: 2
                        }}
                      >
                        <Stack spacing={1.5}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Typography variant="subtitle2" sx={{ 
                              color: selectedCertificate ? THEME_COLORS.success.main : THEME_COLORS.warning.main,
                              fontWeight: 'bold',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1
                            }}>
                              <SecurityIcon sx={{ fontSize: '1.1rem' }} />
                              {selectedCertificate ? 'Certificate Connected' : 'No Certificate Selected'}
                            </Typography>
                            
                            {selectedCertificate && (identifiedVariables.some(isDeviceIdVariable) || identifiedVariables.some(v => isCertificateBackedIdParam(v))) && (
                              <Button
                                variant="contained"
                                size="small"
                                onClick={handleApplyCertificateToDeviceParams}
                                disabled={isOverallLoading || !selectedRequest}
                                startIcon={<PlayArrowIcon />}
                                sx={{
                                  background: `linear-gradient(45deg, ${THEME_COLORS.success.main} 30%, ${THEME_COLORS.success.light} 90%)`,
                                  color: 'white',
                                  fontWeight: 'bold',
                                  px: 2,
                                  py: 0.5,
                                  borderRadius: 1.5,
                                  boxShadow: `0 2px 8px ${THEME_COLORS.success.background}`,
                                  '&:hover': {
                                    background: `linear-gradient(45deg, ${THEME_COLORS.success.dark} 30%, ${THEME_COLORS.success.main} 90%)`,
                                    boxShadow: `0 4px 12px ${THEME_COLORS.success.border}`,
                                    transform: 'translateY(-1px)'
                                  },
                                  '&:disabled': {
                                    background: THEME_COLORS.secondary.main,
                                    color: THEME_COLORS.secondary.light
                                  },
                                  transition: 'all 0.2s ease'
                                }}
                              >
                                Auto Fill All
                              </Button>
                            )}
                          </Box>
                          
                          {selectedCertificate ? (
                            <Stack spacing={1}>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                <Chip
                                  label={`Cert ID: ${selectedCertificate.certificateid}`}
                                  size="small"
                                  sx={{
                                    backgroundColor: THEME_COLORS.primary.background,
                                    color: THEME_COLORS.primary.light,
                                    border: `1px solid ${THEME_COLORS.primary.border}`,
                                    fontFamily: 'monospace',
                                    fontSize: '0.75rem'
                                  }}
                                />
                                {selectedCertificate.deviceid && (
                                  <Chip
                                    label={`Device ID: ${selectedCertificate.deviceid}`}
                                    size="small"
                                    sx={{
                                      backgroundColor: THEME_COLORS.success.background,
                                      color: THEME_COLORS.success.light,
                                      border: `1px solid ${THEME_COLORS.success.border}`,
                                      fontFamily: 'monospace',
                                      fontSize: '0.75rem'
                                    }}
                                  />
                                )}
                              </Box>
                              
                              {selectedRequest && selectedRequest.request && selectedRequest.request.body && (
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={handleResetToOriginalValues}
                                    disabled={isOverallLoading || !selectedRequest}
                                    startIcon={<RefreshIcon />}
                                    sx={{
                                      color: THEME_COLORS.primary.main,
                                      borderColor: THEME_COLORS.primary.border,
                                      backgroundColor: THEME_COLORS.primary.background,
                                      fontSize: '0.75rem',
                                      py: 0.5,
                                      px: 1.5,
                                      '&:hover': {
                                        borderColor: THEME_COLORS.primary.main,
                                        backgroundColor: THEME_COLORS.primary.background
                                      }
                                    }}
                                  >
                                    Reset to Original
                                  </Button>
                                </Box>
                              )}
                            </Stack>
                          ) : (
                            <Typography variant="body2" sx={{ color: THEME_COLORS.warning.main, fontSize: '0.85rem' }}>
                              Select a certificate from the Certificate tab to enable auto-fill functionality
                            </Typography>
                          )}
                        </Stack>
                      </Card>

                      {/* Path Parameters */}
                      {urlDetails && urlDetails.pathParams && urlDetails.pathParams.length > 0 && (
                        <Box>
                          <Typography variant="subtitle2" sx={{ 
                            color: THEME_COLORS.primary.main, 
                            fontWeight: 'bold', 
                            mb: 1.5,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1
                          }}>
                            <Chip
                              label="Path Parameters"
                              size="small"
                              sx={{
                                backgroundColor: THEME_COLORS.primary.main,
                                color: 'white',
                                fontWeight: 'bold',
                                fontSize: '0.75rem'
                              }}
                            />
                            <Typography variant="body2" sx={{ color: '#b0b0b0' }}>
                              ({urlDetails.pathParams.length} parameters)
                            </Typography>
                          </Typography>
                          <Stack spacing={1.5}>
                            {urlDetails.pathParams.map((variableName) => {
                              const isDeviceVar = isDeviceIdVariable(variableName);
                              const isCertificateBackedId = isCertificateBackedIdParam(variableName);
                              const isSequenceVar = isSequenceIdVariable(variableName);
                              const hasCertificateValue = hasCertificateValueForParam(variableName);
                              const source = paramSource[variableName] || 'manual';
                              const hasPrefilledVal = selectedRequest && selectedRequest.request && selectedRequest.request.body ? 
                                                     hasPrefilledValue(variableName, selectedRequest.request.body) : false;
                              
                              return (
                                <Box key={variableName} sx={{ 
                                  p: 1.5, 
                                  backgroundColor: THEME_COLORS.primary.background,
                                  border: `1px solid ${THEME_COLORS.primary.border}`,
                                  borderRadius: 1.5
                                }}>
                                  <Stack spacing={1}>
                                    {/* Parameter Name and Tags */}
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                      <Typography variant="body1" sx={{ 
                                        color: THEME_COLORS.primary.main, 
                                        fontWeight: 'bold',
                                        fontSize: '0.9rem'
                                      }}>
                                        {variableName}
                                      </Typography>
                                      <Stack direction="row" spacing={0.5}>
                                        {isDeviceVar && (
                                          <Chip
                                            label="Device ID"
                                            size="small"
                                            sx={{
                                              height: '20px',
                                              fontSize: '0.65rem',
                                              backgroundColor: THEME_COLORS.success.main,
                                              color: 'white',
                                              fontWeight: 'bold'
                                            }}
                                          />
                                        )}
                                        {isSequenceVar && (
                                          <Chip
                                            label="Auto +1"
                                            size="small"
                                            sx={{
                                              height: '20px',
                                              fontSize: '0.65rem',
                                              backgroundColor: THEME_COLORS.info.main,
                                              color: 'white',
                                              fontWeight: 'bold'
                                            }}
                                          />
                                        )}
                                        {hasPrefilledVal && (
                                          <Chip
                                            label="Pre-filled"
                                            size="small"
                                            sx={{
                                              height: '20px',
                                              fontSize: '0.65rem',
                                              backgroundColor: THEME_COLORS.neutral.main,
                                              color: 'white',
                                              fontWeight: 'bold'
                                            }}
                                          />
                                        )}
                                      </Stack>
                                    </Box>
                                    
                                    {/* Input Field */}
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <TextField
                                        name={variableName}
                                        value={params[variableName] || ''}
                                        onChange={isCertificateBackedId ? handleParamManualEdit : handleParamChange}
                                        fullWidth
                                        disabled={isOverallLoading || !selectedRequest}
                                        placeholder={`Enter ${variableName}`}
                                        size="small"
                                        helperText={getFileTransferParamHelperText(variableName)}
                                        sx={{
                                          '& .MuiOutlinedInput-root': {
                                            color: 'white',
                                            backgroundColor: 'rgba(0, 0, 0, 0.2)',
                                            '& fieldset': {
                                              borderColor: THEME_COLORS.primary.main,
                                              borderWidth: '1px'
                                            },
                                            '&:hover fieldset': {
                                              borderColor: THEME_COLORS.primary.light
                                            },
                                            '&.Mui-focused fieldset': {
                                              borderColor: THEME_COLORS.primary.main,
                                              borderWidth: '2px'
                                            }
                                          },
                                          '& .MuiFormHelperText-root': {
                                            color: '#b0b0b0',
                                            fontSize: '0.75rem',
                                            marginTop: '4px'
                                          }
                                        }}
                                      />
                                      
                                      {/* Certificate Toggle Button */}
                                      {isCertificateBackedId && hasCertificateValue && (
                                        <Tooltip title={source === 'certificate' ? 'Using certificate value - Click to switch to manual' : 'Using manual input - Click to use certificate value'}>
                                          <IconButton
                                            onClick={() => handleParamSourceToggle(variableName)}
                                            size="small"
                                            sx={{ 
                                              color: source === 'certificate' ? THEME_COLORS.success.main : THEME_COLORS.secondary.light,
                                              backgroundColor: source === 'certificate' ? THEME_COLORS.success.background : THEME_COLORS.secondary.background,
                                              border: source === 'certificate' ? `1px solid ${THEME_COLORS.success.border}` : `1px solid ${THEME_COLORS.secondary.border}`,
                                              '&:hover': {
                                                backgroundColor: source === 'certificate' ? THEME_COLORS.success.border : THEME_COLORS.secondary.border,
                                                transform: 'scale(1.05)'
                                              },
                                              transition: 'all 0.2s ease'
                                            }}
                                            disabled={isOverallLoading || !selectedRequest}
                                          >
                                            <SecurityIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                      )}
                                    </Box>
                                    
                                    {/* Certificate Value Display */}
                                    {isCertificateBackedId && source === 'certificate' && (
                                      <Box sx={{ 
                                        p: 1, 
                                        backgroundColor: THEME_COLORS.success.background,
                                        border: `1px solid ${THEME_COLORS.success.border}`,
                                        borderRadius: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1
                                      }}>
                                        <CheckCircleIcon sx={{ fontSize: '1rem', color: THEME_COLORS.success.main }} />
                                        <Typography variant="body2" sx={{ 
                                          color: THEME_COLORS.success.main, 
                                          fontFamily: 'monospace',
                                          fontSize: '0.8rem'
                                        }}>
                                          Using certificate: {getCertificateValueForParam(variableName)}
                                        </Typography>
                                      </Box>
                                    )}
                                  </Stack>
                                </Box>
                              );
                            })}
                          </Stack>
                        </Box>
                      )}

                      {/* Other Parameters */}
                      {identifiedVariables
                        .filter(variableName =>
                          !((authType === 'aws' || authType === 'none') && variableName.toLowerCase() === 'signature') &&
                          (!urlDetails || !urlDetails.pathParams || !urlDetails.pathParams.includes(variableName))
                        ).length > 0 && (
                        <Box>
                          <Typography variant="subtitle2" sx={{ 
                            color: THEME_COLORS.warning.main, 
                            fontWeight: 'bold', 
                            mb: 1.5,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1
                          }}>
                            <Chip
                              label="Other Parameters"
                              size="small"
                              sx={{
                                backgroundColor: THEME_COLORS.warning.main,
                                color: 'white',
                                fontWeight: 'bold',
                                fontSize: '0.75rem'
                              }}
                            />
                            <Typography variant="body2" sx={{ color: '#b0b0b0' }}>
                              ({identifiedVariables.filter(variableName =>
                                !((authType === 'aws' || authType === 'none') && variableName.toLowerCase() === 'signature') &&
                                (!urlDetails || !urlDetails.pathParams || !urlDetails.pathParams.includes(variableName))
                              ).length} parameters)
                            </Typography>
                          </Typography>
                          <Stack spacing={1.5}>
                            {identifiedVariables
                              .filter(variableName =>
                                !((authType === 'aws' || authType === 'none') && variableName.toLowerCase() === 'signature') &&
                                (!urlDetails || !urlDetails.pathParams || !urlDetails.pathParams.includes(variableName))
                              )
                              .map((variableName) => {
                                const isDeviceVar = isDeviceIdVariable(variableName);
                                const isCertificateBackedId = isCertificateBackedIdParam(variableName);
                                const isSequenceVar = isSequenceIdVariable(variableName);
                                const hasCertificateValue = hasCertificateValueForParam(variableName);
                                const source = paramSource[variableName] || 'manual';
                                const isBodyParam = selectedRequest && selectedRequest.request && selectedRequest.request.body ? 
                                                   isBodyParameter(variableName, selectedRequest.request.body) : false;
                                const hasPrefilledVal = selectedRequest && selectedRequest.request && selectedRequest.request.body ? 
                                                       hasPrefilledValue(variableName, selectedRequest.request.body) : false;
                                
                                // Determine parameter color theme
                                const getParamTheme = () => {
                                  if (isDeviceVar) return PARAM_COLORS.device;
                                  if (isSequenceVar) return PARAM_COLORS.sequence;
                                  if (isBodyParam) return PARAM_COLORS.body;
                                  if (isCertificateBackedId) return PARAM_COLORS.query;
                                  return PARAM_COLORS.default;
                                };
                                
                                const paramTheme = getParamTheme();
                                
                                return (
                                  <Box key={variableName} sx={{ 
                                    p: 1.5, 
                                    backgroundColor: paramTheme.background,
                                    border: `1px solid ${paramTheme.border}`,
                                    borderRadius: 1.5
                                  }}>
                                    <Stack spacing={1}>
                                      {/* Parameter Name and Tags */}
                                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <Typography variant="body1" sx={{ 
                                          color: paramTheme.main, 
                                          fontWeight: 'bold',
                                          fontSize: '0.9rem'
                                        }}>
                                          {variableName}
                                        </Typography>
                                        <Stack direction="row" spacing={0.5}>
                                          {isDeviceVar && (
                                            <Chip
                                              label="Device ID"
                                              size="small"
                                              sx={{
                                                height: '20px',
                                                fontSize: '0.65rem',
                                                backgroundColor: THEME_COLORS.success.main,
                                                color: 'white',
                                                fontWeight: 'bold'
                                              }}
                                            />
                                          )}
                                          {isSequenceVar && (
                                            <Chip
                                              label="Auto +1"
                                              size="small"
                                              sx={{
                                                height: '20px',
                                                fontSize: '0.65rem',
                                                backgroundColor: THEME_COLORS.info.main,
                                                color: 'white',
                                                fontWeight: 'bold'
                                              }}
                                            />
                                          )}
                                          {isBodyParam && (
                                            <Chip
                                              label="Body Param"
                                              size="small"
                                              sx={{
                                                height: '20px',
                                                fontSize: '0.65rem',
                                                backgroundColor: THEME_COLORS.primary.main,
                                                color: 'white',
                                                fontWeight: 'bold'
                                              }}
                                            />
                                          )}
                                          {isCertificateBackedId && !isBodyParam && (
                                            <Chip
                                              label="Query Param"
                                              size="small"
                                              sx={{
                                                height: '20px',
                                                fontSize: '0.65rem',
                                                backgroundColor: THEME_COLORS.warning.main,
                                                color: 'white',
                                                fontWeight: 'bold'
                                              }}
                                            />
                                          )}
                                          {hasPrefilledVal && (
                                            <Chip
                                              label="Pre-filled"
                                              size="small"
                                              sx={{
                                                height: '20px',
                                                fontSize: '0.65rem',
                                                backgroundColor: THEME_COLORS.neutral.main,
                                                color: 'white',
                                                fontWeight: 'bold'
                                              }}
                                            />
                                          )}
                                        </Stack>
                                      </Box>
                                      
                                      {/* Input Field */}
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <TextField
                                          name={variableName}
                                          value={params[variableName] || ''}
                                          onChange={isCertificateBackedId ? handleParamManualEdit : handleParamChange}
                                          fullWidth
                                          disabled={isOverallLoading || !selectedRequest}
                                          placeholder={`Enter ${variableName}`}
                                          size="small"
                                          helperText={getFileTransferParamHelperText(variableName)}
                                          sx={{
                                            '& .MuiOutlinedInput-root': {
                                              color: 'white',
                                              backgroundColor: 'rgba(0, 0, 0, 0.2)',
                                              '& fieldset': {
                                                borderColor: paramTheme.main,
                                                borderWidth: '1px'
                                              },
                                              '&:hover fieldset': {
                                                borderColor: paramTheme.light
                                              },
                                              '&.Mui-focused fieldset': {
                                                borderColor: paramTheme.main,
                                                borderWidth: '2px'
                                              }
                                            },
                                            '& .MuiFormHelperText-root': {
                                              color: '#b0b0b0',
                                              fontSize: '0.75rem',
                                              marginTop: '4px'
                                            }
                                          }}
                                        />
                                        
                                        {/* Certificate Toggle Button */}
                                        {isCertificateBackedId && hasCertificateValue && (
                                          <Tooltip title={source === 'certificate' ? 'Using certificate value - Click to switch to manual' : 'Using manual input - Click to use certificate value'}>
                                            <IconButton
                                              onClick={() => handleParamSourceToggle(variableName)}
                                              size="small"
                                                                                             sx={{ 
                                                 color: source === 'certificate' ? THEME_COLORS.success.main : THEME_COLORS.secondary.light,
                                                 backgroundColor: source === 'certificate' ? THEME_COLORS.success.background : THEME_COLORS.secondary.background,
                                                 border: source === 'certificate' ? `1px solid ${THEME_COLORS.success.border}` : `1px solid ${THEME_COLORS.secondary.border}`,
                                                 '&:hover': {
                                                   backgroundColor: source === 'certificate' ? THEME_COLORS.success.border : THEME_COLORS.secondary.border,
                                                   transform: 'scale(1.05)'
                                                 },
                                                 transition: 'all 0.2s ease'
                                               }}
                                              disabled={isOverallLoading || !selectedRequest}
                                            >
                                              <SecurityIcon fontSize="small" />
                                            </IconButton>
                                          </Tooltip>
                                        )}
                                      </Box>
                                      
                                      {/* Certificate Value Display */}
                                      {isCertificateBackedId && source === 'certificate' && (
                                        <Box sx={{ 
                                          p: 1, 
                                          backgroundColor: 'rgba(76, 175, 80, 0.1)',
                                          border: '1px solid rgba(76, 175, 80, 0.3)',
                                          borderRadius: 1,
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 1
                                        }}>
                                          <CheckCircleIcon sx={{ fontSize: '1rem', color: '#4caf50' }} />
                                          <Typography variant="body2" sx={{ 
                                            color: '#4caf50', 
                                            fontFamily: 'monospace',
                                            fontSize: '0.8rem'
                                          }}>
                                            Using certificate: {getCertificateValueForParam(variableName)}
                                          </Typography>
                                        </Box>
                                      )}
                                    </Stack>
                                  </Box>
                                );
                              })}
                          </Stack>
                        </Box>
                      )}

                      {/* No Parameters Message */}
                      {selectedRequest && identifiedVariables.length === 0 && (
                        <Alert
                          severity="info"
                          sx={{
                            backgroundColor: '#3d3d3d',
                            color: 'white',
                            '& .MuiAlert-icon': { color: '#2196f3' }
                          }}
                        >
                          <AlertTitle>No Variables Found</AlertTitle>
                          No variables found in the selected request (URL, Raw Body, Headers).
                        </Alert>
                      )}
                      
                      {/* Select Request Message */}
                      {!selectedRequest && (
                        <Alert
                          severity="info"
                          sx={{
                            backgroundColor: '#3d3d3d',
                            color: 'white',
                            '& .MuiAlert-icon': { color: '#2196f3' }
                          }}
                        >
                          Select a request to see available parameters.
                        </Alert>
                      )}
                    </Stack>
                  )}
                </Stack>
              </CardContent>
            </Card>

            {/* Request Details Section */}
            {selectedRequest && urlDetails && (
              <Card elevation={1} sx={{ mb: 1, p: 1.5, background: '#23272f', border: '1px solid #333' }}>
                <Stack spacing={1.5}>
                  <Typography variant="subtitle2" sx={{ color: '#90caf9', fontWeight: 600, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ApiIcon sx={{ fontSize: 18, color: '#90caf9' }} />
                    API Endpoint Details
                  </Typography>
                  <Stack direction="row" spacing={2}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: '#b0b0b0' }}>Base URL</Typography>
                      <Typography variant="body2" sx={{ 
                        fontFamily: 'monospace', 
                        color: '#fff',
                        fontSize: '0.8rem',
                        wordBreak: 'break-all',
                        lineHeight: 1.3
                      }}>
                        {selectedEnvIdx === 0 ? urlDetails.baseUrl : selectedEnv.baseUrl}
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: '#b0b0b0' }}>Base Path</Typography>
                      <Typography variant="body2" sx={{ 
                        fontFamily: 'monospace', 
                        color: '#fff',
                        fontSize: '0.8rem',
                        wordBreak: 'break-all',
                        lineHeight: 1.3
                      }}>
                        {selectedEnvIdx === 0 ? urlDetails.basePath : selectedEnv.basePath}
                      </Typography>
                    </Box>
                  </Stack>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#b0b0b0' }}>Endpoint</Typography>
                    <Typography variant="body2" sx={{ 
                      fontFamily: 'monospace', 
                      color: '#fff',
                      fontSize: '0.8rem',
                      wordBreak: 'break-all',
                      lineHeight: 1.4
                    }}>
                      {(() => {
                        // If environment is selected and not "None", extract the clean endpoint
                        if (selectedEnvIdx !== 0) {
                          let cleanEndpoint = urlDetails.endpoint;
                          // Normalize double slashes
                          cleanEndpoint = cleanEndpoint.replace(/\/+/g, '/');
                          // Remove basePath pattern from the beginning
                          const basePathPattern = /^\/[^\/]+/;
                          const match = cleanEndpoint.match(basePathPattern);
                          if (match) {
                            cleanEndpoint = cleanEndpoint.substring(match[0].length);
                            if (!cleanEndpoint.startsWith('/')) {
                              cleanEndpoint = '/' + cleanEndpoint;
                            }
                          }
                          return cleanEndpoint;
                        }
                        // Otherwise show original endpoint
                        return urlDetails.endpoint;
                      })().split(/(:[a-zA-Z0-9_]+|{{.*?}})/g).map((part, idx) =>
                        part.match(/^(:[a-zA-Z0-9_]+|{{.*?}})$/)
                          ? (
                            <Chip
                              key={idx}
                              label={part.replace(/^:|{{|}}/g, '')}
                              size="small"
                              sx={{
                                backgroundColor: '#1976d2',
                                color: 'white',
                                fontWeight: 'bold',
                                mx: 0.2,
                                fontSize: '0.7rem',
                                height: '20px',
                                '& .MuiChip-label': { px: 0.5 }
                              }}
                            />
                          ) : (
                            <span key={idx}>{part}</span>
                          )
                      )}
                    </Typography>
                  </Box>
                  {(urlDetails.pathParams.length > 0 || urlDetails.queryParams.length > 0 || (urlDetails.bodyParams && urlDetails.bodyParams.length > 0)) && (
                    <Box>
                      <Typography variant="caption" sx={{ color: '#b0b0b0' }}>Parameters</Typography>
                      <Stack spacing={1}>
                        {urlDetails.pathParams.length > 0 && (
                          <Box>
                            <Typography variant="body2" sx={{ color: '#90caf9', fontWeight: 500, fontSize: '0.85rem', mb: 0.5 }}>Path Params:</Typography>
                            <Stack spacing={0.5}>
                              {urlDetails.pathParams.map((p) => (
                                <Box key={p} sx={{ 
                                  backgroundColor: 'rgba(33, 150, 243, 0.1)', 
                                  border: '1px solid rgba(33, 150, 243, 0.3)',
                                  borderRadius: 1,
                                  p: 1
                                }}>
                                  <Typography variant="body2" sx={{ 
                                    color: '#2196f3', 
                                    fontWeight: 600, 
                                    fontSize: '0.8rem',
                                    mb: 0.5
                                  }}>
                                    {p}
                                  </Typography>
                                  {params[p] && (
                                    <Typography variant="body2" sx={{ 
                                      color: '#fff',
                                      fontFamily: 'monospace',
                                      fontSize: '0.75rem',
                                      wordBreak: 'break-all',
                                      backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                      p: 0.5,
                                      borderRadius: 0.5,
                                      lineHeight: 1.3
                                    }}>
                                      {params[p]}
                                    </Typography>
                                  )}
                                </Box>
                              ))}
                            </Stack>
                          </Box>
                        )}
                        {urlDetails.queryParams.length > 0 && (
                          <Box>
                            <Typography variant="body2" sx={{ color: '#90caf9', fontWeight: 500, fontSize: '0.85rem', mb: 0.5 }}>Query Params:</Typography>
                            <Stack spacing={0.5}>
                              {urlDetails.queryParams.map((q) => (
                                <Box key={q} sx={{ 
                                  backgroundColor: 'rgba(255, 152, 0, 0.1)', 
                                  border: '1px solid rgba(255, 152, 0, 0.3)',
                                  borderRadius: 1,
                                  p: 1
                                }}>
                                  <Typography variant="body2" sx={{ 
                                    color: '#ff9800', 
                                    fontWeight: 600, 
                                    fontSize: '0.8rem',
                                    mb: 0.5
                                  }}>
                                    {q}
                                  </Typography>
                                  {params[q] && (
                                    <Typography variant="body2" sx={{ 
                                      color: '#fff',
                                      fontFamily: 'monospace',
                                      fontSize: '0.75rem',
                                      wordBreak: 'break-all',
                                      backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                      p: 0.5,
                                      borderRadius: 0.5,
                                      lineHeight: 1.3
                                    }}>
                                      {params[q]}
                                    </Typography>
                                  )}
                                </Box>
                              ))}
                            </Stack>
                          </Box>
                        )}
                        {urlDetails.bodyParams && urlDetails.bodyParams.length > 0 && (
                          <Box>
                            <Typography variant="body2" sx={{ color: '#90caf9', fontWeight: 500, fontSize: '0.85rem', mb: 0.5 }}>Body Params:</Typography>
                            <Stack spacing={0.5}>
                              {urlDetails.bodyParams.map((b) => (
                                <Box key={b} sx={{ 
                                  backgroundColor: 'rgba(233, 30, 99, 0.1)', 
                                  border: '1px solid rgba(233, 30, 99, 0.3)',
                                  borderRadius: 1,
                                  p: 1
                                }}>
                                  <Typography variant="body2" sx={{ 
                                    color: '#e91e63', 
                                    fontWeight: 600, 
                                    fontSize: '0.8rem',
                                    mb: 0.5
                                  }}>
                                    {b}
                                  </Typography>
                                  {params[b] && (
                                    <Typography variant="body2" sx={{ 
                                      color: '#fff',
                                      fontFamily: 'monospace',
                                      fontSize: '0.75rem',
                                      wordBreak: 'break-all',
                                      backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                      p: 0.5,
                                      borderRadius: 0.5,
                                      lineHeight: 1.3
                                    }}>
                                      {params[b]}
                                    </Typography>
                                  )}
                                </Box>
                              ))}
                            </Stack>
                          </Box>
                        )}
                      </Stack>
                    </Box>
                  )}
                </Stack>
              </Card>
            )}
          </Box>
        </Grid>

        {/* Right Column: Response */}
        <Grid size={{ xs: 12, md: 6 }} sx={{ 
          height: '100%', 
          display: 'flex', 
          flexDirection: 'column',
          flex: '1 1 50%',
          maxWidth: '50%'
        }}>
          <Card elevation={2} sx={{ 
            height: '100%', 
            width: '100%',
            display: 'flex', 
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <CardContent sx={{ 
              p: '12px !important', 
              flexGrow: 1, 
              overflow: 'hidden', 
              display: 'flex', 
              flexDirection: 'column',
              height: '100%'
            }}>
              <Stack spacing={2} sx={{ height: '100%', overflow: 'hidden' }}>
                <Box 
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    flexShrink: 0 // Prevent shrinking
                  }}
                >
                  <Typography variant="subtitle1" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem', flexGrow: 1 }}>
                    <ApiIcon color="primary" sx={{ fontSize: '1.2rem' }} />
                    API Response
                    {apiResponse && (
                      <Chip 
                        label={`${apiResponse.status}`} 
                        color={getStatusColor(apiResponse.status)}
                        size="small"
                        icon={apiResponse.status >= 200 && apiResponse.status < 300 ? <CheckCircleIcon /> : <ErrorIcon />}
                      />
                    )}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
                    {apiResponse && (
                      <Tooltip title="Download complete response as JSON file">
                        <Button
                          variant="contained"
                          onClick={() => downloadJsonResponse(apiResponse, selectedRequest, params, selectedEnv, authType, bearerToken, selectedApiConfigId, selectedProfile, apiKeyAuth, basicAuth)}
                          disabled={isLoading}
                          size="small"
                          sx={{
                            minWidth: '36px',
                            width: '36px',
                            height: '36px',
                            p: 0,
                            background: `linear-gradient(45deg, ${THEME_COLORS.info.main} 30%, ${THEME_COLORS.info.light} 90%)`,
                            border: 0,
                            borderRadius: '8px',
                            boxShadow: `0 2px 8px ${THEME_COLORS.info.background}`,
                            color: 'white',
                            transition: 'all 0.2s ease',
                            '&:hover': {
                              background: `linear-gradient(45deg, ${THEME_COLORS.info.dark} 30%, ${THEME_COLORS.info.main} 90%)`,
                              boxShadow: `0 4px 12px ${THEME_COLORS.info.border}`,
                              transform: 'translateY(-1px)',
                            },
                            '&:active': {
                              transform: 'translateY(0px)',
                            },
                            '&:disabled': {
                              background: THEME_COLORS.secondary.main,
                              color: THEME_COLORS.secondary.light,
                              boxShadow: 'none',
                              transform: 'none'
                            }
                          }}
                        >
                          <DownloadIcon sx={{ fontSize: '1rem' }} />
                        </Button>
                      </Tooltip>
                    )}
                    {(apiResponse || error) && (
                      <Button
                        variant="contained"
                        onClick={clearApiResponse}
                        disabled={isLoading}
                        size="small"
                        sx={{
                          minWidth: '36px',
                          width: '36px',
                          height: '36px',
                          p: 0,
                          background: `linear-gradient(45deg, ${THEME_COLORS.error.main} 30%, ${THEME_COLORS.error.light} 90%)`,
                          border: 0,
                          borderRadius: '8px',
                          boxShadow: `0 2px 8px ${THEME_COLORS.error.background}`,
                          color: 'white',
                          transition: 'all 0.2s ease',
                          '&:hover': {
                            background: `linear-gradient(45deg, ${THEME_COLORS.error.dark} 30%, ${THEME_COLORS.error.main} 90%)`,
                            boxShadow: `0 4px 12px ${THEME_COLORS.error.border}`,
                            transform: 'translateY(-1px)',
                          },
                          '&:active': {
                            transform: 'translateY(0px)',
                          },
                          '&:disabled': {
                            background: THEME_COLORS.secondary.main,
                            color: THEME_COLORS.secondary.light,
                            boxShadow: 'none',
                            transform: 'none'
                          }
                        }}
                      >
                        <HighlightOffIcon sx={{ fontSize: '1rem' }} />
                      </Button>
                    )}
                    <Button 
                      variant="contained" 
                      onClick={handleSendRequest} 
                      disabled={isOverallLoading || !selectedRequest || isLoading}
                      size="small"
                      sx={{ 
                        minWidth: '36px',
                        width: '36px',
                        height: '36px',
                        p: 0,
                        background: isLoading 
                          ? `linear-gradient(45deg, ${THEME_COLORS.warning.main} 30%, ${THEME_COLORS.warning.light} 90%)`
                          : `linear-gradient(45deg, ${THEME_COLORS.primary.main} 30%, ${THEME_COLORS.primary.light} 90%)`,
                        animation: isLoading ? 'gradientShift 2s ease-in-out infinite' : 'none',
                        border: 0,
                        borderRadius: '8px',
                        boxShadow: isLoading 
                          ? `0 2px 8px ${THEME_COLORS.warning.background}`
                          : `0 2px 8px ${THEME_COLORS.primary.background}`,
                        color: 'white',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          background: isLoading 
                            ? `linear-gradient(45deg, ${THEME_COLORS.warning.main} 30%, ${THEME_COLORS.warning.light} 90%)`
                            : `linear-gradient(45deg, ${THEME_COLORS.primary.dark} 30%, ${THEME_COLORS.primary.main} 90%)`,
                          boxShadow: isLoading 
                            ? `0 4px 12px ${THEME_COLORS.warning.border}`
                            : `0 4px 12px ${THEME_COLORS.primary.border}`,
                          transform: 'translateY(-1px)',
                        },
                        '&:active': {
                          transform: 'translateY(0px)',
                        },
                        '&:disabled': {
                          background: THEME_COLORS.secondary.main,
                          color: THEME_COLORS.secondary.light,
                          boxShadow: 'none',
                          transform: 'none'
                        },
                        '@keyframes gradientShift': {
                          '0%': { backgroundPosition: '0% 50%' },
                          '50%': { backgroundPosition: '100% 50%' },
                          '100%': { backgroundPosition: '0% 50%' }
                        }
                      }}
                    >
                      {isLoading ? <CircularProgress size={16} color="inherit" /> : <SendIcon sx={{ fontSize: '1rem' }} />}
                    </Button>
                  </Stack>
                </Box>
                
                {expandedSections.response && (
                  <Box sx={{ 
                    flexGrow: 1, 
                    overflow: 'auto',
                    minHeight: '0',
                    height: '100%',
                    '&::-webkit-scrollbar': {
                      width: '8px',
                    },
                    '&::-webkit-scrollbar-track': {
                      background: 'transparent',
                    },
                    '&::-webkit-scrollbar-thumb': {
                      background: '#555',
                      borderRadius: '4px',
                    },
                    '&::-webkit-scrollbar-thumb:hover': {
                      background: '#777',
                    },
                  }}>
                    <Stack spacing={2} sx={{ minHeight: '100%' }}>
                      {isLoading && (
                        <Card elevation={0} sx={{ 
                          p: 3, 
                          backgroundColor: THEME_COLORS.primary.background,
                          border: `1px solid ${THEME_COLORS.primary.border}`,
                          borderRadius: 2,
                          textAlign: 'center'
                        }}>
                          <CircularProgress size={40} sx={{ mb: 2, color: THEME_COLORS.primary.main }} />
                          <Typography sx={{ color: THEME_COLORS.primary.main, fontWeight: 'bold' }}>
                            Sending request...
                          </Typography>
                          <Typography variant="body2" sx={{ color: '#b0b0b0', mt: 0.5 }}>
                            Please wait while we process your request
                          </Typography>
                        </Card>
                      )}
                      
                      {error && (
                        <Card elevation={0} sx={{ 
                          p: 2, 
                          backgroundColor: THEME_COLORS.error.background,
                          border: `1px solid ${THEME_COLORS.error.border}`,
                          borderRadius: 2
                        }}>
                          <Stack spacing={1}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <ErrorIcon sx={{ color: THEME_COLORS.error.main }} />
                              <Typography variant="subtitle1" sx={{ color: THEME_COLORS.error.main, fontWeight: 'bold' }}>
                                Request Failed
                              </Typography>
                            </Box>
                            <Typography variant="body2" sx={{ 
                              color: '#fff',
                              fontFamily: 'monospace',
                              backgroundColor: 'rgba(0, 0, 0, 0.3)',
                              p: 1.5,
                              borderRadius: 1,
                              fontSize: '0.85rem',
                              lineHeight: 1.4
                            }}>
                              {error}
                            </Typography>
                          </Stack>
                        </Card>
                      )}
                      
                      {apiResponse && (
                        <Stack spacing={2}>
                          {/* Status Card */}
                          <Card elevation={0} sx={{ 
                            p: 2, 
                            backgroundColor: apiResponse.status >= 200 && apiResponse.status < 300 
                              ? THEME_COLORS.success.background 
                              : THEME_COLORS.error.background,
                            border: apiResponse.status >= 200 && apiResponse.status < 300 
                              ? `1px solid ${THEME_COLORS.success.border}` 
                              : `1px solid ${THEME_COLORS.error.border}`,
                            borderRadius: 2
                          }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              {apiResponse.status >= 200 && apiResponse.status < 300 ? (
                                <CheckCircleIcon sx={{ color: THEME_COLORS.success.main, fontSize: '1.5rem' }} />
                              ) : (
                                <ErrorIcon sx={{ color: THEME_COLORS.error.main, fontSize: '1.5rem' }} />
                              )}
                              <Box>
                                <Typography variant="h6" sx={{ 
                                  color: apiResponse.status >= 200 && apiResponse.status < 300 ? THEME_COLORS.success.main : THEME_COLORS.error.main,
                                  fontWeight: 'bold'
                                }}>
                                  {apiResponse.status >= 200 && apiResponse.status < 300 ? 'Success' : 'Error'}
                                </Typography>
                                <Typography variant="body2" sx={{ color: '#b0b0b0' }}>
                                  Status Code: {apiResponse.status}
                                </Typography>
                              </Box>
                            </Box>
                          </Card>

                          {/* Headers Section */}
                          <Card elevation={0} sx={{ 
                            backgroundColor: THEME_COLORS.info.background,
                            border: `1px solid ${THEME_COLORS.info.border}`,
                            borderRadius: 2
                          }}>
                            <Box sx={{ p: 1.5, borderBottom: `1px solid ${THEME_COLORS.info.border}` }}>
                              <Typography variant="subtitle1" sx={{ 
                                fontWeight: 'bold',
                                color: THEME_COLORS.info.main,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1
                              }}>
                                <CodeIcon sx={{ fontSize: '1rem' }} />
                                Response Headers
                              </Typography>
                            </Box>
                            <Box sx={{ p: 1.5 }}>
                              <Box sx={{ 
                                backgroundColor: '#1a1a1a', 
                                color: '#f1f1f1', 
                                p: 1.5, 
                                borderRadius: 1,
                                maxHeight: '200px',
                                overflow: 'auto',
                                border: `1px solid ${THEME_COLORS.secondary.main}`,
                                '&::-webkit-scrollbar': {
                                  width: '6px',
                                },
                                '&::-webkit-scrollbar-thumb': {
                                  background: THEME_COLORS.secondary.main,
                                  borderRadius: '3px',
                                }
                              }}>
                                <pre style={{ 
                                  margin: 0, 
                                  fontSize: '0.8rem', 
                                  whiteSpace: 'pre-wrap',
                                  fontFamily: 'Monaco, Consolas, "Courier New", monospace'
                                }}>
                                  {JSON.stringify(apiResponse.headers || {}, null, 2)}
                                </pre>
                              </Box>
                            </Box>
                          </Card>

                          {/* Body Section */}
                          <Card elevation={0} sx={{ 
                            backgroundColor: THEME_COLORS.primary.background,
                            border: `1px solid ${THEME_COLORS.primary.border}`,
                            borderRadius: 2
                          }}>
                            <Box sx={{ p: 1.5, borderBottom: `1px solid ${THEME_COLORS.primary.border}` }}>
                              <Typography variant="subtitle1" sx={{ 
                                fontWeight: 'bold',
                                color: THEME_COLORS.primary.main,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1
                              }}>
                                <CodeIcon sx={{ fontSize: '1rem' }} />
                                Response Body
                              </Typography>
                            </Box>
                            <Box sx={{ p: 1.5 }}>
                              <Box sx={{ 
                                backgroundColor: '#1a1a1a', 
                                color: '#f1f1f1',
                                p: 1.5, 
                                borderRadius: 1,
                                maxHeight: '400px',
                                overflow: 'auto',
                                border: `1px solid ${THEME_COLORS.secondary.main}`,
                                '&::-webkit-scrollbar': {
                                  width: '6px',
                                },
                                '&::-webkit-scrollbar-thumb': {
                                  background: THEME_COLORS.secondary.main,
                                  borderRadius: '3px',
                                }
                              }}>
                                <pre style={{ 
                                  margin: 0, 
                                  fontSize: '0.8rem', 
                                  whiteSpace: 'pre-wrap', 
                                  wordBreak: 'break-word',
                                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                  lineHeight: 1.4
                                }}>
                                  {formatJsonResponse(apiResponse.body)}
                                </pre>
                              </Box>
                            </Box>
                          </Card>
                        </Stack>
                      )}
                      
                      {!isLoading && !error && !apiResponse && (
                        <Card elevation={0} sx={{ 
                          p: 4, 
                          backgroundColor: THEME_COLORS.neutral.background,
                          border: `1px solid ${THEME_COLORS.neutral.border}`,
                          borderRadius: 2,
                          textAlign: 'center',
                          flexGrow: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          alignItems: 'center',
                          minHeight: '500px'
                        }}>
                          <InfoIcon sx={{ fontSize: 48, color: THEME_COLORS.neutral.main, mb: 2 }} />
                          <Typography variant="h6" sx={{ color: THEME_COLORS.neutral.main, fontWeight: 'bold', mb: 1 }}>
                            Ready to Send Request
                          </Typography>
                          <Typography variant="body1" sx={{ color: '#b0b0b0', mb: 2 }}>
                            {isOverallLoading ? 'Loading collections or API credential sets...' :
                             collections.length === 0 ? 'No collections found. Please scan in API Settings.' :
                             !selectedCollectionPath ? 'Please select a Collection first.' :
                             !selectedRequest ? 'Please select a Request from the Collection.' :
                             'Configure your request and click \'Send\' to see the response here.'}
                          </Typography>
                          {selectedRequest && (
                            <Box sx={{ 
                              p: 2, 
                              backgroundColor: THEME_COLORS.primary.background,
                              borderRadius: 1,
                              border: `1px solid ${THEME_COLORS.primary.border}`
                            }}>
                              <Typography variant="body2" sx={{ color: THEME_COLORS.primary.main, fontWeight: 'bold' }}>
                                Selected: {selectedRequest.displayName}
                              </Typography>
                              <Typography variant="body2" sx={{ color: '#b0b0b0', mt: 0.5 }}>
                                {selectedRequest.request?.method || 'GET'} • {identifiedVariables.length} parameters found
                              </Typography>
                            </Box>
                          )}
                        </Card>
                      )}
                    </Stack>
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

export default ApiTestPage;
