import React from 'react';
import { render, act, waitFor, renderHook, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CertificatesProvider, useCertificates } from '../../contexts/CertificatesContext.jsx';

// Mock the performance monitor
vi.mock('../../utils/performanceMonitor', () => ({
  default: {
    measureAsync: vi.fn((name, fn) => fn()),
    logMemoryUsage: vi.fn()
  }
}));

// Mock electron API
const mockElectronAPI = {
  loadFilterModel: vi.fn(),
  loadSelectionModel: vi.fn(),
  getFlashPathData: vi.fn(),
  loadConfig: vi.fn(),
  scanCertificates: vi.fn(),
  loadUserData: vi.fn(),
  saveUserData: vi.fn(),
  updateFlashPathData: vi.fn(),
  saveSelectionModel: vi.fn()
};

// Test wrapper component
const TestWrapper = ({ children }) => (
  <CertificatesProvider>{children}</CertificatesProvider>
);

describe('CertificatesContext', () => {
  beforeEach(() => {
    global.window.electronAPI = mockElectronAPI;
    vi.clearAllMocks();
    
    // Setup default mock responses
    mockElectronAPI.loadFilterModel.mockResolvedValue(null);
    mockElectronAPI.loadSelectionModel.mockResolvedValue(null);
    mockElectronAPI.getFlashPathData.mockResolvedValue({ certificate_folder_path: '' });
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '' });
    mockElectronAPI.scanCertificates.mockResolvedValue([]);
    mockElectronAPI.loadUserData.mockResolvedValue([]);
    mockElectronAPI.saveUserData.mockResolvedValue({ success: true });
    mockElectronAPI.updateFlashPathData.mockResolvedValue({ success: true });
    mockElectronAPI.saveSelectionModel.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('provides initial context values', async () => {
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(result.current).toBeDefined();
      expect(result.current.certificatesData).toBeDefined();
      expect(result.current.certificateFolderPath).toBeDefined();
      expect(result.current.isLoading).toBeDefined();
      expect(result.current.error).toBeDefined();
    });
  });

  it('initializes data on mount', async () => {
    renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(mockElectronAPI.loadFilterModel).toHaveBeenCalled();
      expect(mockElectronAPI.loadSelectionModel).toHaveBeenCalled();
      expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('nordic');
      expect(mockElectronAPI.loadConfig).toHaveBeenCalled();
    });
  });

  it('loads certificates data when folder path is provided', async () => {
    const mockCertificates = [
      { id: '1', certificateid: 'cert1', deviceid: 'device1', path: '/path/to/cert1' },
      { id: '2', certificateid: 'cert2', deviceid: 'device2', path: '/path/to/cert2' }
    ];
    
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '/test/path' });
    mockElectronAPI.loadUserData.mockResolvedValue(mockCertificates);
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(result.current.certificatesData).toHaveLength(2);
      expect(result.current.certificateFolderPath).toBe('/test/path');
    });
  });

  it('normalizes certificate data to ensure unique IDs', async () => {
    const mockCertificates = [
      { id: 1, certificateid: 'cert1', deviceid: 'device1', path: '/path/to/cert1' },
      { id: 1, certificateid: 'cert2', deviceid: 'device2', path: '/path/to/cert2' }, // Duplicate ID
      { certificateid: 'cert3', deviceid: 'device3', path: '/path/to/cert3' } // Missing ID
    ];
    
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '/test/path' });
    mockElectronAPI.loadUserData.mockResolvedValue(mockCertificates);
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(result.current.certificatesData).toHaveLength(3);
      // Check that all IDs are unique
      const ids = result.current.certificatesData.map(cert => cert.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });

  it('handles error during initialization', async () => {
    // Mock loadUserData to throw an error during loadCertificatesData
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '/test/path' });
    mockElectronAPI.loadUserData.mockRejectedValue(new Error('Load failed'));
    mockElectronAPI.scanCertificates.mockRejectedValue(new Error('Scan failed'));
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(result.current.error).toBe('Load failed');
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('uses cached data when available', async () => {
    const mockCertificates = [
      { id: '1', certificateid: 'cert1', deviceid: 'device1', path: '/path/to/cert1' }
    ];
    
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '/test/path' });
    mockElectronAPI.loadUserData.mockResolvedValue(mockCertificates);
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    // Wait for initial load
    await waitFor(() => {
      expect(result.current.certificatesData).toHaveLength(1);
    });
    
    // Call loadCertificatesData again - should use cache
    vi.clearAllMocks();
    
    await act(async () => {
      await result.current.loadCertificatesData('/test/path');
    });
    
    // Should not call API again due to cache
    expect(mockElectronAPI.loadUserData).not.toHaveBeenCalled();
  });

  it('refreshes certificates data and preserves remarks', async () => {
    const existingData = [
      { id: '1', certificateid: 'cert1', deviceid: 'device1', path: '/path/to/cert1', remark: 'Important cert' }
    ];
    
    const scannedData = [
      { id: '1', certificateid: 'cert1', deviceid: 'device1', path: '/path/to/cert1' },
      { id: '2', certificateid: 'cert2', deviceid: 'device2', path: '/path/to/cert2' }
    ];
    
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '/test/path' });
    mockElectronAPI.loadUserData.mockResolvedValue(existingData);
    mockElectronAPI.scanCertificates.mockResolvedValue(scannedData);
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(result.current.certificatesData).toBeDefined();
    });
    
    await act(async () => {
      await result.current.refreshCertificatesData();
    });
    
    await waitFor(() => {
      expect(result.current.certificatesData).toHaveLength(2);
      // Check that remark was preserved
      const cert1 = result.current.certificatesData.find(c => c.certificateid === 'cert1');
      expect(cert1.remark).toBe('Important cert');
    });
  });

  it('updates certificate folder path', async () => {
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(result.current.certificateFolderPath).toBe('');
    });
    
    await act(async () => {
      await result.current.setCertificateFolderPathOnly('/new/path');
    });
    
    await waitFor(() => {
      expect(mockElectronAPI.updateFlashPathData).toHaveBeenCalledWith({
        path_type: 'nordic',
        certificate_folder_path: '/new/path',
        user_initiated: true
      });
      expect(result.current.certificateFolderPath).toBe('/new/path');
    });
  });

  it('prevents updating to empty certificate folder path', async () => {
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '/test/path' });
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(result.current.certificateFolderPath).toBe('/test/path');
    });
    
    await act(async () => {
      await result.current.setCertificateFolderPathOnly('');
    });
    
    // Should not update to empty path
    expect(mockElectronAPI.updateFlashPathData).not.toHaveBeenCalled();
    expect(result.current.certificateFolderPath).toBe('/test/path');
  });

  it('updates certificates data and saves', async () => {
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    const newData = [
      { id: '1', certificateid: 'cert1', deviceid: 'device1', path: '/path/to/cert1' }
    ];
    
    await act(async () => {
      const success = await result.current.updateCertificatesData(newData);
      expect(success).toBe(true);
    });
    
    expect(mockElectronAPI.saveUserData).toHaveBeenCalledWith(newData);
    expect(result.current.certificatesData).toEqual(newData);
  });

  it('handles selection changes and updates flash path data', async () => {
    const mockCertificates = [
      { id: '1', certificateid: 'cert1', deviceid: 'device1', path: '/path/to/cert1' }
    ];
    
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '/test/path' });
    mockElectronAPI.loadUserData.mockResolvedValue(mockCertificates);
    mockElectronAPI.loadSelectionModel.mockResolvedValue(['1']);
    
    // Mock window event
    const eventListener = vi.fn();
    global.window.addEventListener = vi.fn((event, handler) => {
      if (event === 'certificateSelectionChanged') {
        eventListener.mockImplementation(handler);
      }
    });
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(result.current.certificatesData).toHaveLength(1);
      expect(result.current.initialSelection).toEqual(['1']);
    });
    
    // Wait for selection effect to run
    await waitFor(() => {
      expect(mockElectronAPI.updateFlashPathData).toHaveBeenCalledWith({
        path_type: 'nordic',
        certificate_folder_path: '/path/to/cert1',
        user_initiated: true
      });
    });
  });

  it('handles user deselection', async () => {
    const mockCertificates = [
      { id: '1', certificateid: 'cert1', deviceid: 'device1', path: '/path/to/cert1' }
    ];
    
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '/test/path' });
    mockElectronAPI.loadUserData.mockResolvedValue(mockCertificates);
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(result.current.certificatesData).toHaveLength(1);
    });
    
    // Set flag for user deselection
    global.window._lastSelectionWasUserDeselect = true;
    
    await act(async () => {
      result.current.setInitialSelection([]);
    });
    
    await waitFor(() => {
      expect(mockElectronAPI.updateFlashPathData).toHaveBeenCalledWith({
        path_type: 'nordic',
        certificate_folder_path: '',
        user_initiated: true
      });
    });
  });

  it('handles scan when no saved data exists', async () => {
    const scannedData = [
      { id: '1', certificateid: 'cert1', deviceid: 'device1', path: '/path/to/cert1' }
    ];
    
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '/test/path' });
    mockElectronAPI.loadUserData.mockResolvedValue([]);
    mockElectronAPI.scanCertificates.mockResolvedValue(scannedData);
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(result.current.certificatesData).toHaveLength(1);
      expect(mockElectronAPI.scanCertificates).toHaveBeenCalledWith('/test/path');
    });
  });

  it('handles error when updating certificates data', async () => {
    mockElectronAPI.saveUserData.mockResolvedValue({ success: false });
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    const newData = [
      { id: '1', certificateid: 'cert1', deviceid: 'device1', path: '/path/to/cert1' }
    ];
    
    await act(async () => {
      const success = await result.current.updateCertificatesData(newData);
      expect(success).toBe(false);
    });
  });

  it('handles backend rejection when updating certificate folder path', async () => {
    mockElectronAPI.updateFlashPathData.mockResolvedValue({ success: false });
    mockElectronAPI.getFlashPathData.mockResolvedValue({ certificate_folder_path: '/original/path' });
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    // Wait for initial load
    await waitFor(() => {
      expect(result.current.certificateFolderPath).toBe('');
    });
    
    await act(async () => {
      await result.current.setCertificateFolderPathOnly('/new/path');
    });
    
    // Should sync from backend when update is rejected
    expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('nordic');
    await waitFor(() => {
      expect(result.current.certificateFolderPath).toBe('/original/path');
    });
  });

  it('handles refresh with no configured path', async () => {
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '' });
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await act(async () => {
      await result.current.refreshCertificatesData();
    });
    
    expect(result.current.error).toContain('No certificate folder path configured');
    expect(mockElectronAPI.scanCertificates).not.toHaveBeenCalled();
  });

  it('throws error when used outside provider', () => {
    // Mock console.error to avoid noise in test output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Test that the hook throws when used outside provider
    // We'll use renderHook without wrapper to test this
    const { result } = renderHook(() => {
      try {
        return useCertificates();
      } catch (error) {
        return { error: error.message };
      }
    });
    
    expect(result.current.error).toBe('useCertificates must be used within a CertificatesProvider');
    
    consoleSpy.mockRestore();
  });

  it('handles multiple selection items by keeping only the first', async () => {
    mockElectronAPI.loadSelectionModel.mockResolvedValue(['1', '2', '3']);
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      // Should only keep the first item for MUI X v8 compatibility
      expect(result.current.initialSelection).toEqual(['1']);
    });
  });

  it('handles array and nested object parameters during data normalization', async () => {
    const mockCertificates = [
      { 
        id: '1', 
        certificateid: 'cert1', 
        deviceid: 'device1', 
        path: '/path/to/cert1',
        metadata: { tags: ['test', 'dev'] }
      }
    ];
    
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '/test/path' });
    mockElectronAPI.loadUserData.mockResolvedValue(mockCertificates);
    
    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });
    
    await waitFor(() => {
      expect(result.current.certificatesData).toHaveLength(1);
      expect(result.current.certificatesData[0].metadata).toBeDefined();
    });
  });

  it('updates certificates data successfully', async () => {
    const newData = [
      { id: '1', certificateid: 'new-cert', deviceid: 'new-device', path: '/new/path' }
    ];

    mockElectronAPI.saveUserData.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });

    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });

    await act(async () => {
      const success = await result.current.updateCertificatesData(newData);
      expect(success).toBe(true);
    });

    expect(mockElectronAPI.saveUserData).toHaveBeenCalledWith(newData);
  });

  // Comprehensive filter fix test cases
  describe('Filter Management Fixes', () => {
    it('reloads filter from disk when user returns to page', async () => {
      const savedFilter = {
        items: [
          {
            field: 'certificateid',
            operator: 'contains',
            value: 'test-filter'
          }
        ]
      };

      mockElectronAPI.loadFilterModel.mockResolvedValue(savedFilter);

      const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });

      await waitFor(() => {
        expect(result.current.isInitialized).toBe(true);
      });

      // Initial filter should be loaded during initialization
      expect(result.current.initialFilter).toEqual(savedFilter);

      // Simulate filter change in another context
      const newFilter = {
        items: [
          {
            field: 'apid',
            operator: 'equals',
            value: 'K4zr'
          }
        ]
      };
      
      mockElectronAPI.loadFilterModel.mockResolvedValue(newFilter);

      // Call reloadFilter to simulate user returning to certificates page
      await act(async () => {
        await result.current.reloadFilter();
      });

      await waitFor(() => {
        expect(result.current.initialFilter).toEqual(newFilter);
      });

      expect(mockElectronAPI.loadFilterModel).toHaveBeenCalledTimes(2);
    });

    it('handles filter comparison correctly during reload', async () => {
      const sameFilter = {
        items: [
          {
            field: 'certificateid',
            operator: 'contains',
            value: 'test'
          }
        ]
      };

      // Set up initial filter
      mockElectronAPI.loadFilterModel.mockResolvedValue(sameFilter);

      const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });

      await waitFor(() => {
        expect(result.current.isInitialized).toBe(true);
        expect(result.current.initialFilter).toEqual(sameFilter);
      });

      // Mock returning the same filter from disk
      mockElectronAPI.loadFilterModel.mockResolvedValue(sameFilter);

      const setInitialFilterSpy = vi.fn();
      
      // Call reloadFilter with same filter - should not trigger state change
      await act(async () => {
        await result.current.reloadFilter();
      });

      // Filter should remain the same (no unnecessary state update)
      expect(result.current.initialFilter).toEqual(sameFilter);
    });

    it('handles null filter gracefully during reload', async () => {
      // Start with a filter
      const initialFilter = {
        items: [{ field: 'certificateid', operator: 'contains', value: 'test' }]
      };

      mockElectronAPI.loadFilterModel.mockResolvedValueOnce(initialFilter);

      const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });

      await waitFor(() => {
        expect(result.current.initialFilter).toEqual(initialFilter);
      });

      // Simulate filter being cleared (null returned from disk)
      mockElectronAPI.loadFilterModel.mockResolvedValue(null);

      await act(async () => {
        await result.current.reloadFilter();
      });

      await waitFor(() => {
        expect(result.current.initialFilter).toBeNull();
      });
    });

    it('handles filter reload errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      mockElectronAPI.loadFilterModel.mockResolvedValueOnce(null);

      const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });

      await waitFor(() => {
        expect(result.current.isInitialized).toBe(true);
      });

      // Mock error during filter reload
      mockElectronAPI.loadFilterModel.mockRejectedValue(new Error('Filter load failed'));

      await act(async () => {
        await result.current.reloadFilter();
      });

      // Should handle error gracefully without crashing
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG CertificatesProvider] Error reloading filter:'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('properly initializes with saved filter during context setup', async () => {
      const savedFilter = {
        items: [
          {
            field: 'apid',
            operator: 'contains',
            value: 'FFS_Gamma'
          }
        ]
      };

      mockElectronAPI.loadFilterModel.mockResolvedValue(savedFilter);
      mockElectronAPI.loadSelectionModel.mockResolvedValue(['cert1']);

      const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });

      await waitFor(() => {
        expect(result.current.isInitialized).toBe(true);
        expect(result.current.initialFilter).toEqual(savedFilter);
        expect(result.current.initialSelection).toEqual(['cert1']);
      });

      // Verify all initialization calls were made
      expect(mockElectronAPI.loadFilterModel).toHaveBeenCalled();
      expect(mockElectronAPI.loadSelectionModel).toHaveBeenCalled();
      expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('nordic');
      expect(mockElectronAPI.loadConfig).toHaveBeenCalled();
    });

    it('handles complex filter structures during reload', async () => {
      const complexFilter = {
        items: [
          {
            field: 'certificateid',
            operator: 'contains',
            value: 'test'
          },
          {
            field: 'apid',
            operator: 'equals',
            value: 'K4zr'
          }
        ],
        logicOperator: 'and'
      };

      mockElectronAPI.loadFilterModel.mockResolvedValue(complexFilter);

      const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });

      await waitFor(() => {
        expect(result.current.initialFilter).toEqual(complexFilter);
      });

      // Modify the complex filter
      const modifiedComplexFilter = {
        ...complexFilter,
        items: [
          ...complexFilter.items,
          {
            field: 'deviceid',
            operator: 'contains',
            value: 'device'
          }
        ]
      };

      mockElectronAPI.loadFilterModel.mockResolvedValue(modifiedComplexFilter);

      await act(async () => {
        await result.current.reloadFilter();
      });

      await waitFor(() => {
        expect(result.current.initialFilter).toEqual(modifiedComplexFilter);
      });
    });

    it('maintains filter state consistency across multiple reloads', async () => {
      const filter1 = {
        items: [{ field: 'certificateid', operator: 'contains', value: 'test1' }]
      };
      const filter2 = {
        items: [{ field: 'certificateid', operator: 'contains', value: 'test2' }]
      };
      const filter3 = {
        items: [{ field: 'apid', operator: 'equals', value: 'K4zr' }]
      };

      // Initialize with first filter
      mockElectronAPI.loadFilterModel.mockResolvedValueOnce(filter1);

      const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });

      await waitFor(() => {
        expect(result.current.initialFilter).toEqual(filter1);
      });

      // Reload with second filter
      mockElectronAPI.loadFilterModel.mockResolvedValueOnce(filter2);

      await act(async () => {
        await result.current.reloadFilter();
      });

      await waitFor(() => {
        expect(result.current.initialFilter).toEqual(filter2);
      });

      // Reload with third filter
      mockElectronAPI.loadFilterModel.mockResolvedValueOnce(filter3);

      await act(async () => {
        await result.current.reloadFilter();
      });

      await waitFor(() => {
        expect(result.current.initialFilter).toEqual(filter3);
      });

      // Verify each reload triggered exactly one load call
      expect(mockElectronAPI.loadFilterModel).toHaveBeenCalledTimes(3);
    });

    it('handles deep object comparison for filter changes', async () => {
      const filterWithNestedData = {
        items: [
          {
            field: 'certificateid',
            operator: 'contains',
            value: 'test',
            metadata: {
              caseSensitive: true,
              matchMode: 'partial'
            }
          }
        ],
        quickFilterValues: ['test'],
        quickFilterLogicOperator: 'and'
      };

      mockElectronAPI.loadFilterModel.mockResolvedValue(filterWithNestedData);

      const { result } = renderHook(() => useCertificates(), { wrapper: TestWrapper });

      await waitFor(() => {
        expect(result.current.initialFilter).toEqual(filterWithNestedData);
      });

      // Create a deep copy with same content - should not trigger update
      const identicalFilter = JSON.parse(JSON.stringify(filterWithNestedData));
      mockElectronAPI.loadFilterModel.mockResolvedValue(identicalFilter);

      const initialFilterBeforeReload = result.current.initialFilter;

      await act(async () => {
        await result.current.reloadFilter();
      });

      // Should not change since filters are deeply equal
      expect(result.current.initialFilter).toEqual(initialFilterBeforeReload);
    });
  });
}); 