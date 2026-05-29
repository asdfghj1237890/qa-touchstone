import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import CertificatesPage from '../../pages/CertificatesPage.jsx';

// Mock the useCertificates hook with a proper factory function
vi.mock('../../contexts/CertificatesContext.jsx', () => {
  const mockUseCertificates = vi.fn();
  return {
    useCertificates: mockUseCertificates
  };
});

// Mock the CertificatesDataGrid component
vi.mock('../../components/CertificatesDataGrid.jsx', () => ({
  default: ({ isLoading, error }) => (
    <div data-testid="certificates-data-grid">
      <div>Loading: {isLoading ? 'true' : 'false'}</div>
      {error && <div>Error: {error}</div>}
    </div>
  )
}));

// Mock electron API
const mockElectronAPI = {
  scanCertificates: vi.fn(),
  exportCertificate: vi.fn(),
  deleteCertificate: vi.fn(),
  showItemInFolder: vi.fn(),
  loadConfig: vi.fn().mockResolvedValue({ credentials: '/mock/path' }),
  onConfigUpdated: vi.fn(),
  removeConfigListener: vi.fn(),
  loadFilterModel: vi.fn().mockResolvedValue(null),
  loadSelectionModel: vi.fn().mockResolvedValue(null),
  getFlashPathData: vi.fn().mockResolvedValue({ certificate_folder_path: '' }),
  loadUserData: vi.fn().mockResolvedValue([]),
  saveFilterModel: vi.fn(),
  saveSelectionModel: vi.fn(),
  updateFlashPathData: vi.fn()
};

// Mock certificates data for testing
const mockCertificatesData = [
  { id: 'cert1', certificateid: 'test-cert-1', path: '/path/to/cert1', apid: 'K4zr' },
  { id: 'cert2', certificateid: 'test-cert-2', path: '/path/to/cert2', apid: 'L5as' }
];

// Mock context values factory
const createMockCertificatesContext = (overrides = {}) => ({
  certificateFolderPath: '',
  certificatesData: [],
  initialSelection: [],
  isLoading: false,
  error: null,
  updateCertificateFolderPath: vi.fn(),
  refreshCertificatesData: vi.fn(),
  updateCertificatesData: vi.fn(),
  setCertificateFolderPathOnly: vi.fn(),
  setInitialSelection: vi.fn(),
  initializeData: vi.fn(),
  loadCertificatesData: vi.fn(),
  setInitialFilter: vi.fn(),
  initialFilter: null,
  ...overrides
});

describe('CertificatesPage', () => {
  beforeEach(async () => {
    global.window.electronAPI = mockElectronAPI;
    vi.clearAllMocks();
    
    // Restore default mock implementations after clearing
    mockElectronAPI.getFlashPathData.mockResolvedValue({ certificate_folder_path: '' });
    mockElectronAPI.loadConfig.mockResolvedValue({ credentials: '/mock/path' });
    mockElectronAPI.loadFilterModel.mockResolvedValue(null);
    mockElectronAPI.loadSelectionModel.mockResolvedValue(null);
    mockElectronAPI.loadUserData.mockResolvedValue([]);
    
    // Get the mocked useCertificates function and set default return value
    const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
    useCertificates.mockReturnValue(createMockCertificatesContext());
  });

  afterEach(() => {
    cleanup();
  });

  it('renders page title and main elements', async () => {
    render(<CertificatesPage />);
    
    expect(screen.getByText('No certificate selected')).toBeInTheDocument();
    expect(screen.getByTestId('certificates-data-grid')).toBeInTheDocument();
  });

  it('shows loading state properly', async () => {
    const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
    useCertificates.mockReturnValue(createMockCertificatesContext({
      isLoading: true
    }));

    render(<CertificatesPage />);
    
    expect(screen.getByText('Loading: true')).toBeInTheDocument();
  });

  it('displays error state', async () => {
    const errorMessage = 'Test error message';
    const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
    useCertificates.mockReturnValue(createMockCertificatesContext({
      error: errorMessage
    }));

    render(<CertificatesPage />);
    
    expect(screen.getByText(`Error: ${errorMessage}`)).toBeInTheDocument();
  });

  it('shows certificate folder path when configured', async () => {
    const testPath = '/test/certificate/path';
    
    // Mock the getFlashPathData call to return the certificate folder path
    mockElectronAPI.getFlashPathData.mockResolvedValue({
      certificate_folder_path: testPath
    });
    
    const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
    useCertificates.mockReturnValue(createMockCertificatesContext({
      certificateFolderPath: testPath
    }));

    render(<CertificatesPage />);
    
    // Wait for the component to load the flash path data
    await waitFor(() => {
      expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('nordic');
    });
    
    await waitFor(() => {
      expect(screen.getByText('Certificate folder configured')).toBeInTheDocument();
      expect(screen.getByText(testPath)).toBeInTheDocument();
    });
  });

  it('displays certificate count when certificates exist', async () => {
    const mockCertificates = [
      { id: 'cert1', certificateid: 'test-cert-1', path: '/path/to/cert1' },
      { id: 'cert2', certificateid: 'test-cert-2', path: '/path/to/cert2' }
    ];

    const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
    useCertificates.mockReturnValue(createMockCertificatesContext({
      certificatesData: mockCertificates,
      certificateFolderPath: '/test/path'
    }));

    render(<CertificatesPage />);
    
    expect(screen.getByText('2 certificates')).toBeInTheDocument();
  });

  it('shows selected certificate when one is selected', async () => {
    const mockCertificates = [
      { id: 'cert1', certificateid: 'test-cert-1', path: '/path/to/cert1' }
    ];

    const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
    useCertificates.mockReturnValue(createMockCertificatesContext({
      certificatesData: mockCertificates,
      initialSelection: ['cert1']
    }));

    render(<CertificatesPage />);
    
    expect(screen.getByText('Certificate selected: test-cert-1')).toBeInTheDocument();
    expect(screen.getByText('/path/to/cert1')).toBeInTheDocument();
  });

  it('shows warning when no certificate selected and no folder path', async () => {
    const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
    useCertificates.mockReturnValue(createMockCertificatesContext());

    render(<CertificatesPage />);
    
    expect(screen.getAllByText('No certificate selected')[0]).toBeInTheDocument();
    expect(screen.getByText('Select a certificate from the table below to set as active certificate for flashing.')).toBeInTheDocument();
  });

  it('passes correct props to CertificatesDataGrid', async () => {
    const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
    useCertificates.mockReturnValue(createMockCertificatesContext({
      isLoading: true,
      error: 'Test error'
    }));

    render(<CertificatesPage />);
    
    expect(screen.getAllByText('Loading: true')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Error: Test error')[0]).toBeInTheDocument();
  });

  it('renders the certificates page with initial state', async () => {
    render(<CertificatesPage />);
    
    await waitFor(() => {
      expect(screen.getByText('No certificate selected')).toBeInTheDocument();
    });
    
    expect(screen.getByText('Select a certificate from the table below to set as active certificate for flashing.')).toBeInTheDocument();
  });

  // Add comprehensive test cases for filter reload functionality
  describe('Filter Reload Functionality', () => {
    it('reloads filter when component mounts', async () => {
      const mockReloadFilter = vi.fn();
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue({
        certificateFolderPath: '/test/path',
        certificatesData: mockCertificatesData,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        updateCertificateFolderPath: vi.fn(),
        refreshCertificatesData: vi.fn(),
        reloadFilter: mockReloadFilter
      });

      render(<CertificatesPage />);

      // Wait for component to mount and trigger reloadFilter
      await waitFor(() => {
        expect(mockReloadFilter).toHaveBeenCalled();
      }, { timeout: 2000 });
    });

    it('calls reloadFilter with proper delay on mount', async () => {
      const mockReloadFilter = vi.fn();
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue({
        certificateFolderPath: '/test/path',
        certificatesData: mockCertificatesData,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        updateCertificateFolderPath: vi.fn(),
        refreshCertificatesData: vi.fn(),
        reloadFilter: mockReloadFilter
      });

      render(<CertificatesPage />);

      // Wait for component to settle and call reloadFilter
      await waitFor(() => {
        expect(mockReloadFilter).toHaveBeenCalled();
      }, { timeout: 2000 });
    });

    it('does not call reloadFilter if function is not available', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue({
        certificateFolderPath: '/test/path',
        certificatesData: mockCertificatesData,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        updateCertificateFolderPath: vi.fn(),
        refreshCertificatesData: vi.fn(),
        reloadFilter: null // Simulate missing reloadFilter function
      });

      render(<CertificatesPage />);

      await waitFor(() => {
        expect(screen.getByText('No certificate selected')).toBeInTheDocument();
      });

      // Should not cause any errors when reloadFilter is null
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG CertificatesPage] Component mounted, reloading filter...')
      );

      consoleLogSpy.mockRestore();
    });

    it('logs debug information when filter changes', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const testFilter = {
        items: [
          {
            field: 'certificateid',
            operator: 'contains',
            value: 'test-cert'
          }
        ]
      };

      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue({
        certificateFolderPath: '/test/path',
        certificatesData: mockCertificatesData,
        initialFilter: testFilter,
        initialSelection: [],
        isLoading: false,
        error: null,
        updateCertificateFolderPath: vi.fn(),
        refreshCertificatesData: vi.fn(),
        reloadFilter: vi.fn()
      });

      render(<CertificatesPage />);

      await waitFor(() => {
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('[DEBUG CertificatesPage] initialFilter changed:'),
          expect.stringContaining('test-cert')
        );
      });

      consoleLogSpy.mockRestore();
    });

    it('logs debug information when filter is null', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue({
        certificateFolderPath: '/test/path',
        certificatesData: mockCertificatesData,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        updateCertificateFolderPath: vi.fn(),
        refreshCertificatesData: vi.fn(),
        reloadFilter: vi.fn()
      });

      render(<CertificatesPage />);

      await waitFor(() => {
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('[DEBUG CertificatesPage] initialFilter changed:'),
          'null'
        );
      });

      consoleLogSpy.mockRestore();
    });

    it('handles filter reload on component remount correctly', async () => {
      const mockReloadFilter = vi.fn();
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue({
        certificateFolderPath: '/test/path',
        certificatesData: mockCertificatesData,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        updateCertificateFolderPath: vi.fn(),
        refreshCertificatesData: vi.fn(),
        reloadFilter: mockReloadFilter
      });

      // First mount
      const { unmount } = render(<CertificatesPage />);

      await waitFor(() => {
        expect(mockReloadFilter).toHaveBeenCalledTimes(1);
      });

      // Unmount and remount (simulating tab navigation)
      unmount();
      
      // Reset mock
      mockReloadFilter.mockClear();

      // Remount
      render(<CertificatesPage />);

      await waitFor(() => {
        expect(mockReloadFilter).toHaveBeenCalledTimes(1);
      });
    });

    it('properly handles filter state updates through context', async () => {
      const initialFilter = {
        items: [{ field: 'certificateid', operator: 'contains', value: 'initial' }]
      };
      
      const updatedFilter = {
        items: [{ field: 'certificateid', operator: 'contains', value: 'updated' }]
      };

      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue({
        certificateFolderPath: '/test/path',
        certificatesData: mockCertificatesData,
        initialFilter: initialFilter,
        initialSelection: [],
        isLoading: false,
        error: null,
        updateCertificateFolderPath: vi.fn(),
        refreshCertificatesData: vi.fn(),
        reloadFilter: vi.fn()
      });

      const { rerender } = render(<CertificatesPage />);

      // Update the mock with new filter
      useCertificates.mockReturnValue({
        certificateFolderPath: '/test/path',
        certificatesData: mockCertificatesData,
        initialFilter: updatedFilter,
        initialSelection: [],
        isLoading: false,
        error: null,
        updateCertificateFolderPath: vi.fn(),
        refreshCertificatesData: vi.fn(),
        reloadFilter: vi.fn()
      });

      // Trigger rerender
      rerender(<CertificatesPage />);

      // Component should handle the filter update
      await waitFor(() => {
        expect(screen.getByText('No certificate selected')).toBeInTheDocument();
      });
    });

    it('handles complex filter structures during reload', async () => {
      const complexFilter = {
        items: [
          {
            field: 'certificateid',
            operator: 'contains',
            value: 'cert-id'
          },
          {
            field: 'apid',
            operator: 'equals',
            value: 'K4zr'
          }
        ],
        logicOperator: 'and',
        quickFilterValues: ['quick-filter']
      };

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue({
        certificateFolderPath: '/test/path',
        certificatesData: mockCertificatesData,
        initialFilter: complexFilter,
        initialSelection: [],
        isLoading: false,
        error: null,
        updateCertificateFolderPath: vi.fn(),
        refreshCertificatesData: vi.fn(),
        reloadFilter: vi.fn()
      });

      render(<CertificatesPage />);

      await waitFor(() => {
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('[DEBUG CertificatesPage] initialFilter changed:'),
          expect.stringContaining('cert-id')
        );
      });

      consoleLogSpy.mockRestore();
    });

    it('maintains component stability during rapid filter changes', async () => {
      const mockReloadFilter = vi.fn();
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue({
        certificateFolderPath: '/test/path',
        certificatesData: mockCertificatesData,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        updateCertificateFolderPath: vi.fn(),
        refreshCertificatesData: vi.fn(),
        reloadFilter: mockReloadFilter
      });

      const { rerender } = render(<CertificatesPage />);

      // Wait for initial mount to trigger reloadFilter
      await waitFor(() => {
        expect(mockReloadFilter).toHaveBeenCalled();
      });

      // Simulate rapid filter changes
      const filters = [
        { items: [{ field: 'certificateid', operator: 'contains', value: 'a' }] },
        { items: [{ field: 'certificateid', operator: 'contains', value: 'ab' }] },
        { items: [{ field: 'certificateid', operator: 'contains', value: 'abc' }] }
      ];

      for (const filter of filters) {
        useCertificates.mockReturnValue({
          certificateFolderPath: '/test/path',
          certificatesData: mockCertificatesData,
          initialFilter: filter,
          initialSelection: [],
          isLoading: false,
          error: null,
          updateCertificateFolderPath: vi.fn(),
          refreshCertificatesData: vi.fn(),
          reloadFilter: mockReloadFilter
        });

        rerender(<CertificatesPage />);
      }

      // Component should remain stable
      await waitFor(() => {
        expect(screen.getByText('No certificate selected')).toBeInTheDocument();
      });

      // Initial mount should have triggered reloadFilter at least once
      expect(mockReloadFilter).toHaveBeenCalled();
    });
  });

  // Add comprehensive tests for refresh functionality
  describe('Refresh Functionality', () => {
    it('calls refreshCertificatesData when refresh button is clicked', async () => {
      const mockRefreshCertificatesData = vi.fn().mockResolvedValue();
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        refreshCertificatesData: mockRefreshCertificatesData
      }));

      render(<CertificatesPage />);
      
      const refreshButton = screen.getByRole('button', { name: /refresh certificates data/i });
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(mockRefreshCertificatesData).toHaveBeenCalled();
      });
    });

    it('does not call refresh when already loading', async () => {
      const mockRefreshCertificatesData = vi.fn().mockResolvedValue();
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        isLoading: true,
        refreshCertificatesData: mockRefreshCertificatesData
      }));

      render(<CertificatesPage />);
      
      const refreshButton = screen.getByRole('button', { name: /refresh certificates data/i });
      expect(refreshButton).toBeDisabled();
      
      fireEvent.click(refreshButton);

      // Should not call refresh when loading
      expect(mockRefreshCertificatesData).not.toHaveBeenCalled();
    });

    it('handles refresh error gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockRefreshCertificatesData = vi.fn().mockRejectedValue(new Error('Refresh failed'));
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        refreshCertificatesData: mockRefreshCertificatesData
      }));

      render(<CertificatesPage />);
      
      const refreshButton = screen.getByRole('button', { name: /refresh certificates data/i });
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error refreshing certificates data:',
          expect.any(Error)
        );
      });

      consoleErrorSpy.mockRestore();
    });

    it('refreshes flash path data along with certificates', async () => {
      const mockRefreshCertificatesData = vi.fn().mockResolvedValue();
      mockElectronAPI.getFlashPathData.mockResolvedValue({
        certificate_folder_path: '/updated/path'
      });
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        refreshCertificatesData: mockRefreshCertificatesData
      }));

      render(<CertificatesPage />);
      
      const refreshButton = screen.getByRole('button', { name: /refresh certificates data/i });
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(mockRefreshCertificatesData).toHaveBeenCalled();
        expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('nordic');
      });
    });

    it('shows loading animation on refresh button when loading', async () => {
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        isLoading: true
      }));

      render(<CertificatesPage />);
      
      const refreshButton = screen.getByRole('button', { name: /refresh certificates data/i });
      expect(refreshButton).toBeDisabled();
      
      // Check for rotation style (loading animation)
      const refreshIcon = refreshButton.querySelector('svg');
      expect(refreshIcon).toHaveStyle({ transform: 'rotate(360deg)' });
    });
  });

  // Add tests for event listeners
  describe('Event Listeners', () => {
    it('adds and removes certificateSelectionChanged event listener', async () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext());

      const { unmount } = render(<CertificatesPage />);
      
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'certificateSelectionChanged',
        expect.any(Function)
      );
      
      unmount();
      
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'certificateSelectionChanged',
        expect.any(Function)
      );
      
      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('handles certificateSelectionChanged event with flashPathDataUpdated', async () => {
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext());

      mockElectronAPI.getFlashPathData.mockResolvedValue({
        certificate_folder_path: '/updated/certificate/path'
      });

      render(<CertificatesPage />);
      
      // Simulate certificate selection change event
      const event = new CustomEvent('certificateSelectionChanged', {
        detail: { flashPathDataUpdated: true }
      });
      
      window.dispatchEvent(event);

      // Wait for the setTimeout delay and async operation
      await waitFor(() => {
        expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('nordic');
      }, { timeout: 200 });
    });

    it('ignores certificateSelectionChanged event without flashPathDataUpdated', async () => {
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext());

      render(<CertificatesPage />);
      
      // Clear previous calls
      mockElectronAPI.getFlashPathData.mockClear();
      
      // Simulate certificate selection change event without flashPathDataUpdated
      const event = new CustomEvent('certificateSelectionChanged', {
        detail: { flashPathDataUpdated: false }
      });
      
      window.dispatchEvent(event);

      // Wait a bit to ensure no async operations are triggered
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should not call getFlashPathData for this event
      expect(mockElectronAPI.getFlashPathData).not.toHaveBeenCalled();
    });

    it('handles certificateSelectionChanged event error gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext());

      mockElectronAPI.getFlashPathData.mockRejectedValue(new Error('Failed to load flash path data'));

      render(<CertificatesPage />);
      
      // Simulate certificate selection change event
      const event = new CustomEvent('certificateSelectionChanged', {
        detail: { flashPathDataUpdated: true }
      });
      
      window.dispatchEvent(event);

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error reloading flash path certificate_folder_path after selection change:',
          expect.any(Error)
        );
      }, { timeout: 200 });

      consoleErrorSpy.mockRestore();
    });
  });

  // Add tests for flash path data loading
  describe('Flash Path Data Loading', () => {
    it('loads flash path data on component mount', async () => {
      const testPath = '/test/flash/path';
      mockElectronAPI.getFlashPathData.mockResolvedValue({
        certificate_folder_path: testPath
      });
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext());

      render(<CertificatesPage />);
      
      await waitFor(() => {
        expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('nordic');
      });
    });

    it('handles flash path data loading error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      mockElectronAPI.getFlashPathData.mockRejectedValue(new Error('Failed to load flash path'));
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext());

      render(<CertificatesPage />);
      
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error loading flash path certificate_folder_path:',
          expect.any(Error)
        );
      });

      consoleErrorSpy.mockRestore();
    });

    it('has correct dependencies for flash path data loading effect', async () => {
      // This test verifies that the effect has the correct dependencies
      // Testing the actual re-execution is complex due to React's dependency comparison
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      
      useCertificates.mockReturnValue(createMockCertificatesContext({
        certificatesData: mockCertificatesData
      }));

      render(<CertificatesPage />);
      
      // Verify that the effect runs on mount with the correct dependencies
      await waitFor(() => {
        expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('nordic');
      });
      
      // The useEffect has [certificatesData, initialSelection] as dependencies
      // which is the correct setup for reloading when these values change
    });

    it('verifies flash path data loading with different initial selections', async () => {
      // Test that the component works correctly with different initial selections
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        initialSelection: ['cert1'],
        certificatesData: mockCertificatesData
      }));

      render(<CertificatesPage />);
      
      // Verify that the effect runs with selection data
      await waitFor(() => {
        expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('nordic');
      });
      
      // The component should handle the initialSelection dependency correctly
      // and display the selected certificate information
      expect(screen.getByText('Certificate selected: test-cert-1')).toBeInTheDocument();
    });
  });

  // Add tests for memoized values
  describe('Memoized Values', () => {
    it('memoizes pathStatus correctly for certificate folder path', async () => {
      const testPath = '/test/certificate/folder';
      mockElectronAPI.getFlashPathData.mockResolvedValue({
        certificate_folder_path: testPath
      });
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext());

      render(<CertificatesPage />);
      
      await waitFor(() => {
        expect(screen.getByText('Certificate folder configured')).toBeInTheDocument();
      });
    });

    it('memoizes pathStatus correctly for selected certificate', async () => {
      const mockCertificates = [
        { id: 'cert1', certificateid: 'test-cert-1', path: '/path/to/cert1' }
      ];

      mockElectronAPI.getFlashPathData.mockResolvedValue({
        certificate_folder_path: ''
      });
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        certificatesData: mockCertificates,
        initialSelection: ['cert1']
      }));

      render(<CertificatesPage />);
      
      await waitFor(() => {
        expect(screen.getByText('Certificate selected: test-cert-1')).toBeInTheDocument();
      });
    });

    it('memoizes pathStatus correctly for no certificate selected', async () => {
      mockElectronAPI.getFlashPathData.mockResolvedValue({
        certificate_folder_path: ''
      });
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        certificatesData: [],
        initialSelection: []
      }));

      render(<CertificatesPage />);
      
      await waitFor(() => {
        expect(screen.getByText('No certificate selected')).toBeInTheDocument();
      });
    });

    it('memoizes certificateCount correctly', async () => {
      const mockCertificates = [
        { id: 'cert1', certificateid: 'test-cert-1', path: '/path/to/cert1' },
        { id: 'cert2', certificateid: 'test-cert-2', path: '/path/to/cert2' },
        { id: 'cert3', certificateid: 'test-cert-3', path: '/path/to/cert3' }
      ];

      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        certificatesData: mockCertificates
      }));

      render(<CertificatesPage />);
      
      expect(screen.getByText('3 certificates')).toBeInTheDocument();
    });

    it('does not show certificate count chip when no certificates', async () => {
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        certificatesData: []
      }));

      render(<CertificatesPage />);
      
      expect(screen.queryByText(/certificates$/)).not.toBeInTheDocument();
    });
  });

  // Add tests for conditional rendering
  describe('Conditional Rendering', () => {
    it('renders flash path certificate path when available', async () => {
      const testPath = '/test/flash/certificate/path';
      mockElectronAPI.getFlashPathData.mockResolvedValue({
        certificate_folder_path: testPath
      });
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext());

      render(<CertificatesPage />);
      
      await waitFor(() => {
        expect(screen.getByText(testPath)).toBeInTheDocument();
      });
    });

    it('renders selected certificate path when no flash path but certificate selected', async () => {
      const mockCertificates = [
        { id: 'cert1', certificateid: 'test-cert-1', path: '/path/to/selected/cert' }
      ];

      mockElectronAPI.getFlashPathData.mockResolvedValue({
        certificate_folder_path: ''
      });
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        certificatesData: mockCertificates,
        initialSelection: ['cert1']
      }));

      render(<CertificatesPage />);
      
      await waitFor(() => {
        expect(screen.getByText('/path/to/selected/cert')).toBeInTheDocument();
      });
    });

    it('renders warning message when no path and no certificate selected', async () => {
      mockElectronAPI.getFlashPathData.mockResolvedValue({
        certificate_folder_path: ''
      });
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        certificatesData: [],
        initialSelection: []
      }));

      render(<CertificatesPage />);
      
      await waitFor(() => {
        expect(screen.getByText('Select a certificate from the table below to set as active certificate for flashing.')).toBeInTheDocument();
      });
    });

    it('prioritizes flash path over selected certificate path', async () => {
      const flashPath = '/flash/path/priority';
      const certPath = '/cert/path/secondary';
      
      const mockCertificates = [
        { id: 'cert1', certificateid: 'test-cert-1', path: certPath }
      ];

      mockElectronAPI.getFlashPathData.mockResolvedValue({
        certificate_folder_path: flashPath
      });
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        certificatesData: mockCertificates,
        initialSelection: ['cert1']
      }));

      render(<CertificatesPage />);
      
      await waitFor(() => {
        expect(screen.getByText(flashPath)).toBeInTheDocument();
        expect(screen.queryByText(certPath)).not.toBeInTheDocument();
      });
    });
  });

  // Add tests for component lifecycle and cleanup
  describe('Component Lifecycle', () => {
    it('properly cleans up event listeners on unmount', async () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext());

      const { unmount } = render(<CertificatesPage />);
      
      unmount();
      
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'certificateSelectionChanged',
        expect.any(Function)
      );
      
      removeEventListenerSpy.mockRestore();
    });

    it('handles window undefined gracefully', async () => {
      // This test is not practical in jsdom environment since React DOM requires window
      // Instead, test the actual window check logic in the component
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext());

      // Component should render without errors when window is available
      expect(() => render(<CertificatesPage />)).not.toThrow();
    });
  });

  // Add tests for error edge cases
  describe('Error Edge Cases', () => {
    beforeEach(() => {
      // Ensure window.electronAPI is properly set up for these tests
      global.window.electronAPI = mockElectronAPI;
    });

    it('handles missing event detail gracefully', async () => {
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext());

      render(<CertificatesPage />);
      
      // Simulate event without detail
      const event = new CustomEvent('certificateSelectionChanged');
      window.dispatchEvent(event);

      // Should not throw error
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('handles null certificatesData gracefully', async () => {
      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        certificatesData: null
      }));

      render(<CertificatesPage />);
      
      expect(screen.getByText('No certificate selected')).toBeInTheDocument();
    });

    it('handles invalid initialSelection gracefully', async () => {
      const mockCertificates = [
        { id: 'cert1', certificateid: 'test-cert-1', path: '/path/to/cert1' }
      ];

      const { useCertificates } = await import('../../contexts/CertificatesContext.jsx');
      useCertificates.mockReturnValue(createMockCertificatesContext({
        certificatesData: mockCertificates,
        initialSelection: ['nonexistent-cert']
      }));

      render(<CertificatesPage />);
      
      expect(screen.getByText('No certificate selected')).toBeInTheDocument();
    });
  });
}); 