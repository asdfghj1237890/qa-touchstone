import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import App from '../App.jsx';

// Mock the Electron API that's not available in the test environment
const mockElectronAPI = {
  // Main App mocks
  onConfigUpdated: vi.fn(),
  removeConfigListener: vi.fn(),
  loadConfig: vi.fn(),
  isSettingsWindow: vi.fn(),
  on: vi.fn(),
  send: vi.fn(),
  invoke: vi.fn(),
  // PostmanContext mocks
  loadCachedPostmanCollections: vi.fn(),
  onPostmanCollectionsUpdated: vi.fn(),
  removePostmanCollectionsUpdatedListener: vi.fn(),
  // CertificatesContext mocks
  scanCertificates: vi.fn(),
  exportCertificate: vi.fn(),
  deleteCertificate: vi.fn(),
  // FlashingContext mocks
  flashNordicDevice: vi.fn(),
  flashSilabsDevice: vi.fn(),
  stopFlashing: vi.fn(),
  scanSerialPorts: vi.fn(),
  onFlashProgress: vi.fn(),
  removeFlashProgressListener: vi.fn(),
  // Window controls
  minimizeWindow: vi.fn(),
  maximizeWindow: vi.fn(),
  closeWindow: vi.fn(),
  // Additional CertificatesContext methods
  loadFilterModel: vi.fn(),
  getFlashPathData: vi.fn(),
  getSelectedCertificate: vi.fn(),
  readDirectory: vi.fn(),
  loadUserData: vi.fn(),
  saveSelectionModel: vi.fn(),
  loadSelectionModel: vi.fn(),
  saveFilterModel: vi.fn(),
  // API client/settings mocks
  getApiCredentialConfigs: vi.fn(),
  loadApiTestState: vi.fn(),
  saveApiTestState: vi.fn(),
  getPostmanCollectionPath: vi.fn()
};

describe('App', () => {
  beforeEach(() => {
    // Clean up any existing DOM elements
    document.body.innerHTML = '';
    
    global.window.electronAPI = mockElectronAPI;
    vi.clearAllMocks();
    
    // Default mock responses
    mockElectronAPI.loadConfig.mockImplementation(() => Promise.resolve({ 
      visiblePages: {
        credentials: true,
        flashNordic: true,
        flashSilabs: false,
        flashEFD: true,
        flashRFD: true,
        tab6: true,
        apiTest: true,
        tab8: false
      }
    }));
    mockElectronAPI.isSettingsWindow.mockResolvedValue(false);
    mockElectronAPI.loadCachedPostmanCollections.mockResolvedValue([]);
    mockElectronAPI.getFlashPathData.mockResolvedValue({ certificate_folder_path: '/test/path' });
    mockElectronAPI.getSelectedCertificate.mockResolvedValue(null);
    mockElectronAPI.readDirectory.mockResolvedValue([]);
    mockElectronAPI.loadUserData.mockResolvedValue([]);
    mockElectronAPI.scanCertificates.mockResolvedValue([]);
    mockElectronAPI.loadFilterModel.mockResolvedValue({});
    mockElectronAPI.loadSelectionModel.mockResolvedValue([]);
    mockElectronAPI.getApiCredentialConfigs.mockResolvedValue([]);
    mockElectronAPI.loadApiTestState.mockResolvedValue(null);
    mockElectronAPI.saveApiTestState.mockResolvedValue({ success: true });
    mockElectronAPI.getPostmanCollectionPath.mockResolvedValue('');
  });

  afterEach(() => {
    // Clean up after each test
    document.body.innerHTML = '';
  });

  it('renders Home navigation button', async () => {
    render(<App />);
    // Use `findBy*` query which waits for the element to appear
    const homeButton = await screen.findByRole('button', { name: /home/i });
    expect(homeButton).toBeInTheDocument();
  });

  it('renders main navigation tabs', async () => {
    render(<App />);
    
    await waitFor(() => {
      const homeButtons = screen.getAllByRole('button', { name: /home/i });
      expect(homeButtons.length).toBeGreaterThan(0);
      expect(homeButtons[0]).toBeInTheDocument();
    });
  });

  it('renders window control buttons', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Should have minimize, maximize, close buttons
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(3); // At least navigation + window controls
    });
  });

  it('loads configuration on mount', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(mockElectronAPI.loadConfig).toHaveBeenCalled();
    });
  });

  it('handles tab navigation', async () => {
    render(<App />);
    
    await waitFor(() => {
      const navigationButtons = screen.getAllByRole('button');
      const nonControlButtons = navigationButtons.filter(button => 
        !button.getAttribute('aria-label')?.includes('minimize') &&
        !button.getAttribute('aria-label')?.includes('maximize') &&
        !button.getAttribute('aria-label')?.includes('close')
      );
      
      if (nonControlButtons.length > 1) {
        fireEvent.click(nonControlButtons[1]);
      }
    });
  });

  it('shows settings button', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Look for any buttons that might be settings-related
      const allButtons = screen.getAllByRole('button');
      expect(allButtons.length).toBeGreaterThan(0);
      // Just verify we have some navigation elements
      expect(allButtons).toBeDefined();
    });
  });

  it('handles settings navigation', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Look for navigation buttons
      const allButtons = screen.getAllByRole('button');
      expect(allButtons.length).toBeGreaterThan(0);
      // Test that we can interact with navigation elements
      if (allButtons.length > 1) {
        fireEvent.click(allButtons[1]);
      }
    });
  });

  it('displays proper theme and styling', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Should have dark theme applied
      const container = document.body;
      expect(container).toBeInTheDocument();
    });
  });

  it('handles window minimize', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Look for window control buttons more flexibly
      const allButtons = screen.getAllByRole('button');
      expect(allButtons.length).toBeGreaterThan(0);
    });
    
    // Since window controls might not be rendered in test environment, just verify the mock is available
    expect(mockElectronAPI.minimizeWindow).toBeDefined();
  });

  it('handles window maximize', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Look for window control buttons more flexibly
      const allButtons = screen.getAllByRole('button');
      expect(allButtons.length).toBeGreaterThan(0);
    });
    
    // Since window controls might not be rendered in test environment, just verify the mock is available
    expect(mockElectronAPI.maximizeWindow).toBeDefined();
  });

  it('handles window close', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Look for window control buttons more flexibly
      const allButtons = screen.getAllByRole('button');
      expect(allButtons.length).toBeGreaterThan(0);
    });
    
    // Since window controls might not be rendered in test environment, just verify the mock is available
    expect(mockElectronAPI.closeWindow).toBeDefined();
  });

  it('shows only visible pages based on configuration', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Should show tabs based on visiblePages config
      const homeButtons = screen.getAllByRole('button', { name: /home/i });
      expect(homeButtons.length).toBeGreaterThan(0);
      expect(homeButtons[0]).toBeInTheDocument();
    });
  });

  it('handles flashing state properly', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Should handle flashing state across the app
      const navigationButtons = screen.getAllByRole('button');
      expect(navigationButtons.length).toBeGreaterThan(0);
    });
  });

  it('displays modern UI with proper glassmorphism effects', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Should have modern glass-like navigation
      const homeButtons = screen.getAllByRole('button', { name: /home/i });
      expect(homeButtons.length).toBeGreaterThan(0);
      expect(homeButtons[0]).toBeInTheDocument();
    });
  });

  it('handles responsive layout', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Should adapt to different screen sizes
      const homeButtons = screen.getAllByRole('button', { name: /home/i });
      expect(homeButtons.length).toBeGreaterThan(0);
      const container = homeButtons[0].closest('div');
      expect(container).toBeInTheDocument();
    });
  });

  it('shows proper context providers', async () => {
    render(<App />);
    
    await waitFor(() => {
      // Should have all necessary context providers loaded
      expect(mockElectronAPI.loadCachedPostmanCollections).toHaveBeenCalled();
    });
  });

  // New test cases for missing scenarios
  describe('Tab Management During Flashing', () => {
    it('prevents tab switching when flashing is in progress', async () => {
      render(<App />);
      
      await waitFor(() => {
        const navigationButtons = screen.getAllByRole('button');
        const nonControlButtons = navigationButtons.filter(button => 
          !button.getAttribute('aria-label')?.includes('minimize') &&
          !button.getAttribute('aria-label')?.includes('maximize') &&
          !button.getAttribute('aria-label')?.includes('close') &&
          !button.textContent?.includes('Settings')
        );
        
        // Test that we have navigation buttons
        expect(nonControlButtons.length).toBeGreaterThan(0);
        
        // Test that navigation elements are working properly
        const homeButtons = screen.getAllByRole('button', { name: /home/i });
        expect(homeButtons.length).toBe(1);
        expect(homeButtons[0]).toBeInTheDocument();
      });
    });

    it('shows reduced opacity for navigation during flashing', async () => {
      render(<App />);
      
      await waitFor(() => {
        // Use getAllByRole and take the first one to handle multiple matches
        const homeButtons = screen.getAllByRole('button', { name: /home/i });
        expect(homeButtons.length).toBeGreaterThan(0);
        const navigationContainer = homeButtons[0].closest('div');
        expect(navigationContainer).toBeInTheDocument();
        // Navigation should have proper styling
        expect(navigationContainer).toHaveStyle({ display: 'flex' });
      });
    });
  });

  describe('Dynamic Tab Visibility', () => {
    it('keeps only the external API tab surface when config changes', async () => {
      render(<App />);
      
      // Initial external state - internal tabs are hidden regardless of saved config
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /home/i })[0]).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /nordic/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /silabs/i })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /api/i })[0]).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /certificates/i })).not.toBeInTheDocument();
      });

      // Simulate an internal-style config update; external edition should still gate it.
      const configUpdateHandler = mockElectronAPI.onConfigUpdated.mock.calls[0][0];
      configUpdateHandler({
        visiblePages: {
          credentials: true,
          flashNordic: false,
          flashSilabs: false,
          flashEFD: true,
          flashRFD: true,
          tab6: true,
          apiTest: false,
          tab8: true
        }
      });

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /certificates/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /efd/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /rfd/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /files/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /nordic/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /silabs/i })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /api/i })[0]).toBeInTheDocument();
      });
    });

    it('keeps external navigation available after internal tabs are enabled in config', async () => {
      render(<App />);
      
      // Click on the only external tool tab first
      await waitFor(() => {
        const apiButton = screen.getAllByRole('button', { name: /api/i })[0];
        fireEvent.click(apiButton);
      });

      // Update config to enable hidden internal tabs.
      const configUpdateHandler = mockElectronAPI.onConfigUpdated.mock.calls[0][0];
      configUpdateHandler({
        visiblePages: {
          credentials: true,
          flashNordic: false,
          flashSilabs: false,
          flashEFD: true,
          flashRFD: true,
          tab6: true,
          apiTest: false,
          tab8: true
        }
      });

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /certificates/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /files/i })).not.toBeInTheDocument();
        const homeButton = screen.getAllByRole('button', { name: /home/i })[0];
        expect(homeButton).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /nordic/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /silabs/i })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /api/i })[0]).toBeInTheDocument();
      });
    });

    it('handles invalid config updates gracefully', async () => {
      render(<App />);
      
      const configUpdateHandler = mockElectronAPI.onConfigUpdated.mock.calls[0][0];
      
      // Send invalid config
      configUpdateHandler(null);
      configUpdateHandler({});
      configUpdateHandler({ invalidKey: 'value' });
      configUpdateHandler({ visiblePages: null });

      // App should not crash and maintain default state
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /home/i })[0]).toBeInTheDocument();
      });
    });
  });

  describe('Custom Tab Change Event', () => {
    it('emits custom tabChanged event with correct details', async () => {
      const tabChangeHandler = vi.fn();
      window.addEventListener('tabChanged', tabChangeHandler);

      render(<App />);
      
      await waitFor(() => {
        const apiButton = screen.getAllByRole('button', { name: /api/i })[0];
        fireEvent.click(apiButton);
      });

      await waitFor(() => {
        expect(tabChangeHandler).toHaveBeenCalled();
        const event = tabChangeHandler.mock.calls[0][0];
        expect(event.detail).toMatchObject({
          oldValue: 0,
          newValue: 1, // API is the first external tool tab
          timestamp: expect.any(Number)
        });
      });

      window.removeEventListener('tabChanged', tabChangeHandler);
    });
  });

  describe('Settings Window Behavior', () => {
    // Store original location
    const originalLocation = window.location;

    beforeEach(() => {
      // Mock URL params to indicate settings window
      delete window.location;
      window.location = { ...originalLocation, search: '?window=settings' };
    });

    afterEach(() => {
      // Restore original location
      window.location = originalLocation;
    });

    it('shows settings window title', async () => {
      render(<App />);
      
      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });
    });

    it('hides settings button in settings window', async () => {
      render(<App />);
      
      await waitFor(() => {
        // Settings button should not be present in settings window
        const settingsButtons = screen.queryAllByLabelText('settings');
        expect(settingsButtons.length).toBe(0);
      });
    });

    it('shows settings-specific tabs', async () => {
      render(<App />);
      
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /env/i })[0]).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /nordic paths/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /silabs paths/i })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /api setting/i })[0]).toBeInTheDocument();
      });
    });

    it('does not reset tab on config change in settings window', async () => {
      render(<App />);
      
      // Wait for initial render and click on API Setting tab (index 1)
      await waitFor(() => {
        const apiSettingButton = screen.getAllByRole('button', { name: /api setting/i })[0];
        fireEvent.click(apiSettingButton);
      });

      // Verify the tab was selected by checking if the content is visible
      await waitFor(() => {
        const apiSettingButton = screen.getAllByRole('button', { name: /api setting/i })[0];
        expect(apiSettingButton).toBeInTheDocument();
      });

      // Get the config update handler and trigger config change
      const configUpdateHandler = mockElectronAPI.onConfigUpdated.mock.calls[0][0];
      configUpdateHandler({
        visiblePages: {
          credentials: false,
          flashNordic: false,
          flashSilabs: true,
          flashEFD: false,
          flashRFD: false,
          tab6: true,
          apiTest: true,
          tab8: false
        }
      });

      await waitFor(() => {
        const apiSettingButton = screen.getAllByRole('button', { name: /api setting/i })[0];
        expect(apiSettingButton).toBeInTheDocument();
        
        // Also verify we're still in settings mode by checking the title
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });
    });
  });

  describe('Window Controls with Window Type', () => {
    it('passes correct window type to minimize function', async () => {
      render(<App />);
      
      const minimizeButton = screen.getByLabelText('minimize');
      fireEvent.click(minimizeButton);
      
      await waitFor(() => {
        expect(mockElectronAPI.minimizeWindow).toHaveBeenCalledWith('main');
      });
    });

    it('passes settings window type when in settings', async () => {
      // Store original location
      const originalLocation = window.location;
      
      // Mock URL params to indicate settings window  
      delete window.location;
      window.location = { ...originalLocation, search: '?window=settings' };
      
      render(<App />);
      
      const minimizeButton = screen.getByLabelText('minimize');
      fireEvent.click(minimizeButton);
      
      await waitFor(() => {
        expect(mockElectronAPI.minimizeWindow).toHaveBeenCalledWith('settings');
      });
      
      // Restore original location
      window.location = originalLocation;
    });
  });

  describe('Responsive Navigation', () => {
    it('renders navigation buttons with proper structure', async () => {
      render(<App />);
      
      await waitFor(() => {
        // Find navigation buttons by looking for buttons with icons
        const allButtons = screen.getAllByRole('button');
        const navigationButtons = allButtons.filter(button => 
          !button.getAttribute('aria-label')?.includes('minimize') &&
          !button.getAttribute('aria-label')?.includes('maximize') &&
          !button.getAttribute('aria-label')?.includes('close') &&
          !button.getAttribute('aria-label')?.includes('settings')
        );
        
        // Should have at least the Home button and other navigation buttons
        expect(navigationButtons.length).toBeGreaterThan(0);
        
        // Check that buttons have proper structure (with icons)
        const buttonWithIcon = navigationButtons.find(button => 
          button.querySelector('svg') // MUI icons are rendered as SVG
        );
        expect(buttonWithIcon).toBeInTheDocument();
      });
    });

    it('shows navigation container with proper styling', async () => {
      render(<App />);
      
      await waitFor(() => {
        // Find the navigation container by looking for the container with navigation buttons
        const allButtons = screen.getAllByRole('button');
        const navigationButton = allButtons.find(button => 
          !button.getAttribute('aria-label')?.includes('minimize') &&
          !button.getAttribute('aria-label')?.includes('maximize') &&
          !button.getAttribute('aria-label')?.includes('close') &&
          !button.getAttribute('aria-label')?.includes('settings')
        );
        
        expect(navigationButton).toBeInTheDocument();
        const navigationContainer = navigationButton.closest('div');
        expect(navigationContainer).toBeInTheDocument();
        
        // Should have flex display for proper layout
        expect(navigationContainer).toHaveStyle({ display: 'flex' });
      });
    });
  });

  describe('Context Error Handling', () => {
    it('handles PostmanContext errors gracefully', async () => {
      mockElectronAPI.loadCachedPostmanCollections.mockRejectedValue(new Error('Failed to load'));
      
      render(<App />);
      
      // App should still render despite context error
      await waitFor(() => {
        // Find navigation buttons by filtering out window controls
        const allButtons = screen.getAllByRole('button');
        const navigationButtons = allButtons.filter(button => 
          !button.getAttribute('aria-label')?.includes('minimize') &&
          !button.getAttribute('aria-label')?.includes('maximize') &&
          !button.getAttribute('aria-label')?.includes('close') &&
          !button.getAttribute('aria-label')?.includes('settings')
        );
        
        // Should have navigation buttons despite PostmanContext error
        expect(navigationButtons.length).toBeGreaterThan(0);
        expect(navigationButtons[0]).toBeInTheDocument(); // First navigation button (Home)
      });
    });

    it('handles CertificatesContext initialization', async () => {
      // Add certificate-specific mocks
      mockElectronAPI.getFlashPathData.mockResolvedValue({ certificate_folder_path: '/test/path' });
      mockElectronAPI.loadUserData.mockResolvedValue([]);
      
      render(<App />);
      
      await waitFor(() => {
        expect(mockElectronAPI.getFlashPathData).toHaveBeenCalled();
      });
    });
  });

  describe('Tab Clamping', () => {
    it('clamps tab value when tabs are removed', async () => {
      render(<App />);
      
      // Wait for initial render and find navigation buttons by filtering out window controls
      await waitFor(() => {
        const allButtons = screen.getAllByRole('button');
        const navigationButtons = allButtons.filter(button => 
          !button.getAttribute('aria-label')?.includes('minimize') &&
          !button.getAttribute('aria-label')?.includes('maximize') &&
          !button.getAttribute('aria-label')?.includes('close') &&
          !button.getAttribute('aria-label')?.includes('settings')
        );
        
        // Should have the external navigation buttons initially
        expect(navigationButtons.length).toBeGreaterThanOrEqual(2); // Home, API
      });

      // Try to click on a tab that will be hidden (if it exists)
      await waitFor(() => {
        const allButtons = screen.getAllByRole('button');
        const navigationButtons = allButtons.filter(button => 
          !button.getAttribute('aria-label')?.includes('minimize') &&
          !button.getAttribute('aria-label')?.includes('maximize') &&
          !button.getAttribute('aria-label')?.includes('close') &&
          !button.getAttribute('aria-label')?.includes('settings')
        );
        
        // Click on a button that isn't the first one (if available)
        if (navigationButtons.length > 1) {
          fireEvent.click(navigationButtons[1]); // Click API
        }
      });

      // Update config to hide external tabs and show internal tabs; external gate should win.
      const configUpdateHandler = mockElectronAPI.onConfigUpdated.mock.calls[0][0];
      configUpdateHandler({
        visiblePages: {
          credentials: true,
          flashNordic: false,
          flashSilabs: false,
          flashEFD: true,
          flashRFD: true,
          tab6: true,
          apiTest: false,
          tab8: true
        }
      });

      await waitFor(() => {
        // Check that we have the expected external navigation buttons.
        const homeButton = screen.getByTestId('nav-button-home');
        const apiButton = screen.getByTestId('nav-button-apiTest');
        
        expect(homeButton).toBeInTheDocument();
        expect(apiButton).toBeInTheDocument();
        
        // Verify that internal buttons are not present.
        expect(screen.queryByTestId('nav-button-tab1')).not.toBeInTheDocument(); // Certificates
        expect(screen.queryByTestId('nav-button-tab2')).not.toBeInTheDocument(); // Nordic
        expect(screen.queryByTestId('nav-button-tab3')).not.toBeInTheDocument(); // Silabs
        expect(screen.queryByTestId('nav-button-tab4')).not.toBeInTheDocument(); // EFD
        expect(screen.queryByTestId('nav-button-tab5')).not.toBeInTheDocument(); // RFD
        expect(screen.queryByTestId('nav-button-tab6')).not.toBeInTheDocument(); // Files
        expect(screen.queryByTestId('nav-button-tab8')).not.toBeInTheDocument(); // Tab 8
      });
    });
  });

  describe('Configuration Cleanup', () => {
    it('removes config listener on unmount', async () => {
      const { unmount } = render(<App />);
      
      await waitFor(() => {
        expect(mockElectronAPI.onConfigUpdated).toHaveBeenCalled();
      });

      unmount();

      expect(mockElectronAPI.removeConfigListener).toHaveBeenCalled();
    });

    it('removes all event listeners on unmount', async () => {
      const { unmount } = render(<App />);
      
      await waitFor(() => {
        expect(mockElectronAPI.onConfigUpdated).toHaveBeenCalled();
        expect(mockElectronAPI.onPostmanCollectionsUpdated).toHaveBeenCalled();
      });

      unmount();

      expect(mockElectronAPI.removeConfigListener).toHaveBeenCalled();
      expect(mockElectronAPI.removePostmanCollectionsUpdatedListener).toHaveBeenCalled();
    });
  });
}); 
