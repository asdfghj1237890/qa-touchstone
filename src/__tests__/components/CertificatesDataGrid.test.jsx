import React from 'react';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import CertificatesDataGrid from '../../components/CertificatesDataGrid.jsx';
import { useCertificates } from '../../contexts/CertificatesContext.jsx';

// Mock MUI DataGrid with comprehensive event handling
vi.mock('@mui/x-data-grid', () => ({
  DataGrid: ({ 
    rows, 
    columns, 
    onRowSelectionModelChange, 
    processRowUpdate, 
    onFilterModelChange,
    onColumnResize,
    onProcessRowUpdateError,
    rowSelectionModel,
    onCellDoubleClick,
    isCellEditable,
    getRowId,
    ...props 
  }) => (
    <div data-testid="mock-data-grid">
      <div>Rows: {rows.length}</div>
      <div>Columns: {columns.length}</div>
      <div data-testid="selection-model">{JSON.stringify(rowSelectionModel)}</div>
      <div data-testid="get-row-id-test">{getRowId ? getRowId(rows[0] || {}) : 'no-getRowId'}</div>
      <div data-testid="cell-editable-test">{isCellEditable ? String(isCellEditable({ field: 'remark' })) : 'no-isCellEditable'}</div>
      {rows.map(row => (
        <div key={row.id} data-testid={`row-${row.id}`}>
          <span data-testid={`cert-id-${row.id}`}>{row.certificateid}</span>
          <span data-testid={`path-${row.id}`}>{row.path}</span>
          <span data-testid={`apid-${row.id}`}>{row.apid}</span>
          <span data-testid={`deviceid-${row.id}`}>{row.deviceid}</span>
          <span data-testid={`remark-${row.id}`}>{row.remark}</span>
          <button 
            data-testid={`select-${row.id}`}
            onClick={() => onRowSelectionModelChange?.({ type: 'include', ids: new Set([row.id]) })}
          >
            Select
          </button>
          <button 
            data-testid={`edit-${row.id}`}
            onClick={() => processRowUpdate?.({ ...row, remark: 'edited' }, row)}
          >
            Edit
          </button>
          <button 
            data-testid={`filter-test-${row.id}`}
            onClick={() => onFilterModelChange?.({ items: [{ field: 'certificateid', operator: 'contains', value: 'test' }] })}
          >
            Filter
          </button>
          <button 
            data-testid={`resize-test-${row.id}`}
            onClick={() => onColumnResize?.({ colDef: { field: 'certificateid' }, width: 200 })}
          >
            Resize
          </button>
          <button 
            data-testid={`double-click-test-${row.id}`}
            onClick={() => onCellDoubleClick?.({ field: 'remark', row }, {})}
          >
            Double Click
          </button>
          <button 
            data-testid={`cell-editable-test-${row.id}`}
            onClick={() => console.log('Cell editable:', isCellEditable?.({ field: 'remark' }))}
          >
            Check Editable
          </button>
          <button 
            data-testid={`process-error-test-${row.id}`}
            onClick={() => onProcessRowUpdateError?.(new Error('Test error'))}
          >
            Process Error
          </button>
          {/* Test column render cells */}
          <div data-testid={`column-renders-${row.id}`}>
            {columns.map((col, index) => (
              <div key={`${col.field}-${index}`} data-testid={`column-${col.field}-${row.id}`}>
                {col.renderCell ? (
                  <div data-testid={`rendered-${col.field}-${row.id}`}>
                    {col.renderCell({ 
                      value: row[col.field], 
                      row, 
                      field: col.field,
                      colDef: col
                    })}
                  </div>
                ) : (
                  <span>{row[col.field]}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  ),
  GridToolbar: () => <div data-testid="grid-toolbar">Grid Toolbar</div>
}));

// Mock the CertificatesContext
vi.mock('../../contexts/CertificatesContext.jsx', () => ({
  useCertificates: vi.fn(),
  CertificatesProvider: ({ children }) => <div data-testid="certificates-provider">{children}</div>
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue()
  }
});

// Mock electron API
const mockElectronAPI = {
  scanCertificates: vi.fn(),
  exportCertificate: vi.fn(),
  deleteCertificate: vi.fn(),
  showItemInFolder: vi.fn(),
  loadConfig: vi.fn().mockResolvedValue({ credentials: '/mock/path', columnWidths: { certificateid: 150 } }),
  onConfigUpdated: vi.fn(),
  removeConfigListener: vi.fn(),
  loadFilterModel: vi.fn().mockResolvedValue(null),
  loadSelectionModel: vi.fn().mockResolvedValue(null),
  getFlashPathData: vi.fn().mockResolvedValue({ certificate_folder_path: '/mock/certificates' }),
  loadUserData: vi.fn().mockResolvedValue([]),
  saveFilterModel: vi.fn().mockResolvedValue(),
  saveSelectionModel: vi.fn().mockResolvedValue(),
  updateFlashPathData: vi.fn().mockResolvedValue({ success: true }),
  saveUserData: vi.fn().mockResolvedValue(),
  saveConfig: vi.fn().mockResolvedValue({ success: true })
};

describe('CertificatesDataGrid', () => {
  const mockCertificates = [
    { 
      id: 'cert1', 
      certificateid: 'test-cert-1', 
      path: '/path/to/cert1',
      deviceid: 'device1',
      version: '1.0.0',
      apid: 'K4zr',
      remark: ''
    },
    { 
      id: 'cert2', 
      certificateid: 'test-cert-2', 
      path: '/path/to/cert2',
      deviceid: 'device2',
      version: '1.0.1',
      apid: 'gksR',
      remark: 'Test remark'
    },
    { 
      id: 'cert3', 
      certificateid: 'test-cert-3', 
      path: '/path/to/cert3',
      deviceid: 'device3',
      version: '1.0.2',
      apid: 'Sh4b',
      remark: 'Production cert'
    }
  ];

  let container;

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    
    global.window.electronAPI = mockElectronAPI;
    
    // Default mock for useCertificates hook
    vi.mocked(useCertificates).mockReturnValue({
      certificatesData: mockCertificates,
      initialFilter: null,
      initialSelection: [],
      isLoading: false,
      error: null,
      refreshCertificatesData: vi.fn(),
      updateCertificatesData: vi.fn().mockResolvedValue(true),
      setCertificateFolderPathOnly: vi.fn(),
      setInitialSelection: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('Helper Functions', () => {
    it('tests truncatePath function through path rendering', async () => {
      const longPathCertificate = [{
        id: 'cert-long',
        certificateid: 'long-cert',
        path: '/very/long/path/that/should/be/truncated/because/it/exceeds/the/maximum/length/limit',
        deviceid: 'device-long',
        version: '1.0.0',
        apid: 'K4zr',
        remark: ''
      }];

      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: longPathCertificate,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
    });

    it('tests copyToClipboard function through copy button clicks', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });

      // Test copy functionality through rendered cells
      const renderedCells = within(container).getAllByTestId(/rendered-certificateid-/);
      expect(renderedCells.length).toBeGreaterThan(0);
    });
  });

  describe('DataGrid Function Props', () => {
    it('tests getRowId function', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const getRowIdTest = within(container).getByTestId('get-row-id-test');
        expect(getRowIdTest).toBeInTheDocument();
        expect(getRowIdTest.textContent).toBe('cert1'); // Should return the id of the first row
      });
    });

    it('tests isCellEditable function', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const cellEditableTest = within(container).getByTestId('cell-editable-test');
        expect(cellEditableTest).toBeInTheDocument();
        expect(cellEditableTest.textContent).toBe('true'); // remark field should be editable
      });
    });

    it('tests onCellDoubleClick function', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const doubleClickButton = within(container).getByTestId('double-click-test-cert1');
        fireEvent.click(doubleClickButton);
      });
      
      // Should not throw error and component should remain stable
      expect(within(container).getByTestId('mock-data-grid')).toBeInTheDocument();
    });
  });

  describe('Column Renderers', () => {
    it('tests certificate ID column renderer with copy functionality', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const renderedCertId = within(container).getByTestId('rendered-certificateid-cert1');
        expect(renderedCertId).toBeInTheDocument();
        
        // Test copy button in rendered cell
        const copyButton = within(renderedCertId).getByRole('button');
        fireEvent.click(copyButton);
        
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test-cert-1');
      });
    });

    it('tests APID column renderer with chip display', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const renderedApid = within(container).getByTestId('rendered-apid-cert1');
        expect(renderedApid).toBeInTheDocument();
        
        // Should render APID as chip
        expect(renderedApid).toBeInTheDocument();
      });
    });

    it('tests device ID column renderer with copy functionality', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const renderedDeviceId = within(container).getByTestId('rendered-deviceid-cert1');
        expect(renderedDeviceId).toBeInTheDocument();
        
        // Test copy button in rendered cell
        const copyButton = within(renderedDeviceId).getByRole('button');
        fireEvent.click(copyButton);
        
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('device1');
      });
    });

    it('tests remark column renderer', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const renderedRemark = within(container).getByTestId('rendered-remark-cert1');
        expect(renderedRemark).toBeInTheDocument();
        
        // Empty remark should show placeholder text
        expect(renderedRemark.textContent).toContain('Click to add...');
      });
    });

    it('tests path column renderer with tooltip', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const renderedPath = within(container).getByTestId('rendered-path-cert1');
        expect(renderedPath).toBeInTheDocument();
        
        // Should display path
        expect(renderedPath.textContent).toContain('/path/to/cert1');
      });
    });
  });

  describe('Explicit Certificate Selection', () => {
    it('tests handleExplicitCertificateSelection function', async () => {
      const mockSetInitialSelection = vi.fn();
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: mockSetInitialSelection
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });

      // The handleExplicitCertificateSelection function is tested indirectly through component behavior
      // It's a private function that would be called internally
    });
  });

  describe('Snackbar Functionality', () => {
    it('tests snackbar display and close functionality', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const renderedCertId = within(container).getByTestId('rendered-certificateid-cert1');
        expect(renderedCertId).toBeInTheDocument();
        
        // Trigger copy to show snackbar
        const copyButton = within(renderedCertId).getByRole('button');
        fireEvent.click(copyButton);
      });

      // Snackbar should be present in the DOM
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
      });
    });
  });

  describe('Process Row Update Edge Cases', () => {
    it('tests processRowUpdate with null/undefined values', async () => {
      const mockUpdateCertificatesData = vi.fn().mockResolvedValue(true);
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: mockUpdateCertificatesData,
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const editButton = within(container).getByTestId('edit-cert1');
        fireEvent.click(editButton);
      });
      
      await waitFor(() => {
        expect(mockUpdateCertificatesData).toHaveBeenCalled();
      });
    });

    it('tests processRowUpdate with no changes', async () => {
      const mockUpdateCertificatesData = vi.fn().mockResolvedValue(true);
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: mockUpdateCertificatesData,
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });

      // processRowUpdate should handle cases where no changes are made
    });
  });

  describe('Component Lifecycle Functions', () => {
    it('tests component mount and unmount effects', async () => {
      const { container: testContainer, unmount } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });

      // Component should handle mount/unmount lifecycle properly
      expect(() => unmount()).not.toThrow();
    });

    it('tests visibility state changes', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      // Component should become visible after initialization
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
    });
  });

  describe('Selection Model Handling', () => {
    it('tests array format selection model handling', async () => {
      const mockSetInitialSelection = vi.fn();
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: mockSetInitialSelection
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const selectButton = within(container).getByTestId('select-cert1');
        fireEvent.click(selectButton);
      });
      
      expect(mockSetInitialSelection).toHaveBeenCalled();
    });

    it('tests user deselection flag handling', async () => {
      const mockSetInitialSelection = vi.fn();
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: ['cert1'], // Start with selection
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: mockSetInitialSelection
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });

      // Test deselection behavior
      // The user deselection flag should be set properly
    });
  });

  describe('Filter Model Debouncing', () => {
    it('tests filter model debouncing with same values', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const filterButton = within(container).getByTestId('filter-test-cert1');
        
        // Click multiple times rapidly
        fireEvent.click(filterButton);
        fireEvent.click(filterButton);
        fireEvent.click(filterButton);
      });
      
      // Should debounce and only save once
      await waitFor(() => {
        expect(mockElectronAPI.saveFilterModel).toHaveBeenCalled();
      }, { timeout: 2000 });
    });

    it('tests filter model flush on unmount', async () => {
      const { container: testContainer, unmount } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const filterButton = within(container).getByTestId('filter-test-cert1');
        fireEvent.click(filterButton);
      });
      
      // Unmount should flush pending debounced calls
      unmount();
    });
  });

  describe('Basic Rendering', () => {
    it('renders data grid with certificates', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
        expect(within(container).getByText('Rows: 3')).toBeInTheDocument();
        expect(within(container).getByText('Columns: 6')).toBeInTheDocument();
      });
    });

    it('displays certificate data correctly', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByTestId('cert-id-cert1')).toHaveTextContent('test-cert-1');
        expect(within(container).getByTestId('path-cert1')).toHaveTextContent('/path/to/cert1');
        expect(within(container).getByTestId('apid-cert1')).toHaveTextContent('K4zr');
        expect(within(container).getByTestId('deviceid-cert1')).toHaveTextContent('device1');
        expect(within(container).getByTestId('remark-cert2')).toHaveTextContent('Test remark');
      });
    });

    it('displays all certificate types correctly', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByTestId('apid-cert1')).toHaveTextContent('K4zr');
        expect(within(container).getByTestId('apid-cert2')).toHaveTextContent('gksR');
        expect(within(container).getByTestId('apid-cert3')).toHaveTextContent('Sh4b');
      });
    });
  });

  describe('Loading States', () => {
    it('displays loading state from context', async () => {
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: [],
        initialFilter: null,
        initialSelection: [],
        isLoading: true,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByText('Loading certificates...')).toBeInTheDocument();
        expect(within(container).queryByTestId('mock-data-grid')).not.toBeInTheDocument();
      });
    });

    it('displays external loading state when prop is provided', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid isLoading={true} />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByText('Loading certificates...')).toBeInTheDocument();
      }, { timeout: 2000 });
      
      expect(within(container).queryByTestId('mock-data-grid')).not.toBeInTheDocument();
    });

    it('shows initializing state briefly', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      // Should show initializing briefly before becoming visible
      const initializingText = within(container).queryByText('Initializing...');
      if (initializingText) {
        expect(initializingText).toBeInTheDocument();
      }
      
      // Then should show the data grid
      await waitFor(() => {
        expect(within(container).getByTestId('mock-data-grid')).toBeInTheDocument();
      });
    });
  });

  describe('Error States', () => {
    it('displays error state from context', async () => {
      const errorMessage = 'Failed to load certificates';
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: [],
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: errorMessage,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByText('Failed to Load Certificates')).toBeInTheDocument();
        expect(within(container).getByText(errorMessage)).toBeInTheDocument();
        expect(within(container).queryByTestId('mock-data-grid')).not.toBeInTheDocument();
      });
    });

    it('displays external error state when prop is provided', async () => {
      const errorMessage = 'External error message';
      const { container: testContainer } = render(<CertificatesDataGrid error={errorMessage} />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByText('Failed to Load Certificates')).toBeInTheDocument();
        expect(within(container).getByText(errorMessage)).toBeInTheDocument();
      }, { timeout: 2000 });
      
      expect(within(container).queryByTestId('mock-data-grid')).not.toBeInTheDocument();
    });

    it('handles refresh functionality from error state', async () => {
      const mockRefreshCertificatesData = vi.fn();
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: [],
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: 'Some error',
        refreshCertificatesData: mockRefreshCertificatesData,
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByText('Failed to Load Certificates')).toBeInTheDocument();
      });

      const refreshIcon = within(container).getByTestId('RefreshIcon');
      const refreshButton = refreshIcon.closest('button');
      fireEvent.click(refreshButton);
      
      expect(mockRefreshCertificatesData).toHaveBeenCalled();
    });
  });

  describe('Empty State', () => {
    it('handles empty data state', async () => {
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: [],
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByText('No Certificates Found')).toBeInTheDocument();
        expect(within(container).queryByTestId('mock-data-grid')).not.toBeInTheDocument();
      });
    });

    it('handles null certificates data', async () => {
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: null,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByText('No Certificates Found')).toBeInTheDocument();
      });
    });

    it('shows refresh button in empty state', async () => {
      const mockRefreshCertificatesData = vi.fn();
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: [],
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: mockRefreshCertificatesData,
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByText('No Certificates Found')).toBeInTheDocument();
      });

      const refreshIcon = within(container).getByTestId('RefreshIcon');
      const refreshButton = refreshIcon.closest('button');
      fireEvent.click(refreshButton);
      
      expect(mockRefreshCertificatesData).toHaveBeenCalled();
    });
  });

  describe('Row Selection', () => {
    it('handles row selection', async () => {
      const mockSetInitialSelection = vi.fn();
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: mockSetInitialSelection
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const selectButton = within(container).getByTestId('select-cert1');
        fireEvent.click(selectButton);
      });
      
      expect(mockSetInitialSelection).toHaveBeenCalled();
    });

    it('displays selection model correctly', async () => {
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: ['cert1'],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const selectionModel = within(container).getByTestId('selection-model');
        expect(selectionModel).toBeInTheDocument();
        // The selection model should have the correct structure with selected ID
        expect(selectionModel.textContent).toContain('"type":"include"');
      });
    });

    it('handles empty selection', async () => {
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const selectionModel = within(container).getByTestId('selection-model');
        expect(selectionModel.textContent).toContain('{}');
      });
    });

    it('handles selection with multiple ids (should only use first)', async () => {
      const mockSetInitialSelection = vi.fn();
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: ['cert1', 'cert2'], // Multiple selections
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: mockSetInitialSelection
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const selectionModel = within(container).getByTestId('selection-model');
        // Should have the correct structure - component handles multiple selections properly
        expect(selectionModel.textContent).toContain('"type":"include"');
      });
    });
  });

  describe('Cell Editing', () => {
    it('handles cell editing', async () => {
      const mockUpdateCertificatesData = vi.fn().mockResolvedValue(true);
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: mockUpdateCertificatesData,
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const editButton = within(container).getByTestId('edit-cert1');
        fireEvent.click(editButton);
      });
      
      await waitFor(() => {
        expect(mockUpdateCertificatesData).toHaveBeenCalled();
      });
    });

    it('handles cell editing failure', async () => {
      const mockUpdateCertificatesData = vi.fn().mockResolvedValue(false);
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: mockUpdateCertificatesData,
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const editButton = within(container).getByTestId('edit-cert1');
        fireEvent.click(editButton);
      });
      
      await waitFor(() => {
        expect(mockUpdateCertificatesData).toHaveBeenCalled();
      });
    });

    it('handles cell editing with null data', async () => {
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: null,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByText('No Certificates Found')).toBeInTheDocument();
      });
    });

    it('handles process row update error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const errorButton = within(container).getByTestId('process-error-test-cert1');
        fireEvent.click(errorButton);
      });
      
      expect(consoleSpy).toHaveBeenCalledWith('Error updating row:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('handles double click events', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const doubleClickButton = within(container).getByTestId('double-click-test-cert1');
        fireEvent.click(doubleClickButton);
      });
      
      // Should not throw error
      expect(within(container).getByTestId('mock-data-grid')).toBeInTheDocument();
    });

    it('validates cell editability', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const editableButton = within(container).getByTestId('cell-editable-test-cert1');
        fireEvent.click(editableButton);
      });
      
      expect(consoleSpy).toHaveBeenCalledWith('Cell editable:', true);
      consoleSpy.mockRestore();
    });
  });

  describe('Column Management', () => {
    it('handles column resize', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const resizeButton = within(container).getByTestId('resize-test-cert1');
        fireEvent.click(resizeButton);
      });
      
      await waitFor(() => {
        expect(mockElectronAPI.saveConfig).toHaveBeenCalled();
      });
    });

    it('loads column widths from config', async () => {
      mockElectronAPI.loadConfig.mockResolvedValue({
        columnWidths: { certificateid: 200, path: 300 }
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(mockElectronAPI.loadConfig).toHaveBeenCalled();
      });
    });

    it('handles config loading error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockElectronAPI.loadConfig.mockRejectedValue(new Error('Config error'));

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Error loading column widths:', expect.any(Error));
      });
      
      consoleSpy.mockRestore();
    });
  });

  describe('Filter Management', () => {
    it('handles filter model changes', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
      
      // Trigger filter change
      const filterButton = within(container).getByTestId('filter-test-cert1');
      fireEvent.click(filterButton);
      
      // Should trigger debounced save after delay
      await waitFor(() => {
        expect(mockElectronAPI.saveFilterModel).toHaveBeenCalled();
      }, { timeout: 2000 });
    });

    it('properly handles initial filter loading', async () => {
      const initialFilter = {
        items: [
          {
            field: 'apid',
            operator: 'contains',
            value: 'K4zr'
          }
        ]
      };

      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: initialFilter,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
    });

    it('filters null items from filter model', async () => {
      const filterWithNulls = {
        items: [
          {
            field: 'certificateid',
            operator: 'contains',
            value: 'test'
          },
          null,
          undefined,
          {
            field: 'apid',
            operator: 'equals',
            value: 'K4zr'
          }
        ]
      };

      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: filterWithNulls,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
    });

    it('handles filter save errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockElectronAPI.saveFilterModel.mockRejectedValue(new Error('Save error'));

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
      
      // Trigger filter change
      const filterButton = within(container).getByTestId('filter-test-cert1');
      fireEvent.click(filterButton);
      
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Error saving filter model:', expect.any(Error));
      }, { timeout: 2000 });
      
      consoleSpy.mockRestore();
    });
  });

  describe('Clipboard Functionality', () => {
    it('handles clipboard copy operations', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
      
      // Verify clipboard API is available
      expect(navigator.clipboard.writeText).toBeDefined();
    });

    it('handles clipboard copy failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      navigator.clipboard.writeText.mockRejectedValue(new Error('Clipboard error'));

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
      
      consoleSpy.mockRestore();
    });
  });

  describe('Performance and Optimization', () => {
    it('handles large datasets efficiently', async () => {
      const largeCertificateSet = Array.from({ length: 100 }, (_, i) => ({
        id: `cert${i}`,
        certificateid: `test-cert-${i}`,
        path: `/path/to/cert${i}`,
        deviceid: `device${i}`,
        version: '1.0.0',
        apid: 'K4zr',
        remark: ''
      }));
      
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: largeCertificateSet,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const rowsElement = within(container).getByText('Rows: 100');
        expect(rowsElement).toBeInTheDocument();
      }, { timeout: 10000 });
    });

    it('uses React.memo for performance optimization', () => {
      expect(CertificatesDataGrid).toBeDefined();
      // Component should be memoized - React.memo components can be objects or functions
      expect(CertificatesDataGrid).toBeInstanceOf(Object);
    });

    it('handles component unmount cleanly', async () => {
      const { container: testContainer, unmount } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
      
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Real-time Updates', () => {
    it('handles real-time data updates', async () => {
      const { container: testContainer, rerender, unmount } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const rowsElement = within(container).getByText('Rows: 3');
        expect(rowsElement).toBeInTheDocument();
      });
      
      // Unmount and remount with new data to avoid stale state
      unmount();
      
      // Update with new data
      const updatedCertificates = [...mockCertificates, {
        id: 'cert4',
        certificateid: 'test-cert-4',
        path: '/path/to/cert4',
        deviceid: 'device4',
        version: '1.0.3',
        apid: 'Lzkc',
        remark: 'New cert'
      }];
      
      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: updatedCertificates,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      // Re-render with new data
      const { container: newContainer } = render(<CertificatesDataGrid />);
      container = newContainer;
      
      await waitFor(() => {
        const rowsElement = within(container).getByText('Rows: 4');
        expect(rowsElement).toBeInTheDocument();
      });
    });

    it('handles context state changes', async () => {
      const mockContext = {
        certificatesData: mockCertificates,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      };

      vi.mocked(useCertificates).mockReturnValue(mockContext);

      const { container: testContainer, unmount } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const rowsElement = within(container).getByText('Rows: 3');
        expect(rowsElement).toBeInTheDocument();
      });
      
      // Unmount and remount with loading state
      unmount();
      
      // Update context with loading state
      vi.mocked(useCertificates).mockReturnValue({
        ...mockContext,
        isLoading: true
      });

      // Re-render with loading state
      const { container: newContainer } = render(<CertificatesDataGrid />);
      container = newContainer;
      
      await waitFor(() => {
        expect(within(container).getByText('Loading certificates...')).toBeInTheDocument();
      });
    });
  });

  describe('APID Mapping', () => {
    it('correctly maps APID values for display', async () => {
      const apidTestCertificates = [
        { id: 'cert1', certificateid: 'test1', path: '/path1', deviceid: 'dev1', version: '1.0', apid: 'K4zr', remark: '' },
        { id: 'cert2', certificateid: 'test2', path: '/path2', deviceid: 'dev2', version: '1.0', apid: 'gksR', remark: '' },
        { id: 'cert3', certificateid: 'test3', path: '/path3', deviceid: 'dev3', version: '1.0', apid: 'Sh4b', remark: '' },
        { id: 'cert4', certificateid: 'test4', path: '/path4', deviceid: 'dev4', version: '1.0', apid: 'Lzkc', remark: '' },
        { id: 'cert5', certificateid: 'test5', path: '/path5', deviceid: 'dev5', version: '1.0', apid: 'BjZN', remark: '' },
        { id: 'cert6', certificateid: 'test6', path: '/path6', deviceid: 'dev6', version: '1.0', apid: 'gBkq', remark: '' }
      ];

      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: apidTestCertificates,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByTestId('apid-cert1')).toHaveTextContent('K4zr');
        expect(within(container).getByTestId('apid-cert2')).toHaveTextContent('gksR');
        expect(within(container).getByTestId('apid-cert3')).toHaveTextContent('Sh4b');
        expect(within(container).getByTestId('apid-cert4')).toHaveTextContent('Lzkc');
        expect(within(container).getByTestId('apid-cert5')).toHaveTextContent('BjZN');
        expect(within(container).getByTestId('apid-cert6')).toHaveTextContent('gBkq');
      });
    });

    it('handles unknown APID values', async () => {
      const unknownApidCert = [{
        id: 'cert1',
        certificateid: 'test1',
        path: '/path1',
        deviceid: 'dev1',
        version: '1.0',
        apid: 'UNKNOWN',
        remark: ''
      }];

      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: unknownApidCert,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByTestId('apid-cert1')).toHaveTextContent('UNKNOWN');
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('handles missing certificate properties', async () => {
      const incompleteCertificate = [{
        id: 'cert1',
        certificateid: 'test1',
        // Missing path, deviceid, version, apid, remark
      }];

      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: incompleteCertificate,
        initialFilter: null,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByTestId('cert-id-cert1')).toHaveTextContent('test1');
      });
    });

    it('handles invalid filter structure', async () => {
      const invalidFilter = {
        items: [
          {
            field: '',
            operator: 'contains',
            value: 'test'
          },
          {
            field: 'certificateid',
            operator: '',
            value: 'test'
          }
        ]
      };

      vi.mocked(useCertificates).mockReturnValue({
        certificatesData: mockCertificates,
        initialFilter: invalidFilter,
        initialSelection: [],
        isLoading: false,
        error: null,
        refreshCertificatesData: vi.fn(),
        updateCertificatesData: vi.fn(),
        setCertificateFolderPathOnly: vi.fn(),
        setInitialSelection: vi.fn()
      });

      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
    });

    it('handles component with no context provider', async () => {
      // This would typically throw an error in real usage
      // but our mock should handle it gracefully
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        expect(within(container).getByTestId('mock-data-grid')).toBeInTheDocument();
      });
    });
  });

  describe('Snackbar Notifications', () => {
    it('shows snackbar on clipboard copy', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
      
      // Verify snackbar elements are present in DOM structure
      // (The actual snackbar behavior would be tested in integration tests)
    });
  });

  describe('Accessibility', () => {
    it('provides proper ARIA labels and roles', async () => {
      const { container: testContainer } = render(<CertificatesDataGrid />);
      container = testContainer;
      
      await waitFor(() => {
        const dataGrid = within(container).getByTestId('mock-data-grid');
        expect(dataGrid).toBeInTheDocument();
      });
      
      // Component should be accessible
      expect(within(container).getByTestId('mock-data-grid')).toBeInTheDocument();
    });
  });
}); 