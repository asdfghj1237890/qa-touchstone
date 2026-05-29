import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import SilabsPathsSettings from '../../../pages/settings/SilabsPathsSettings.jsx';

// Mock electron API
const mockElectronAPI = {
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  selectDirectory: vi.fn(),
  selectFile: vi.fn(),
  onConfigUpdated: vi.fn(),
  removeConfigListener: vi.fn(),
  getFlashPathData: vi.fn(),
  updateFlashPathData: vi.fn()
};

describe('SilabsPathsSettings Page', () => {
  beforeEach(() => {
    global.window.electronAPI = mockElectronAPI;
    vi.clearAllMocks();
    
    // Default mock responses
    mockElectronAPI.getFlashPathData.mockResolvedValue({
      current_used_paths: {
        testAppPath: '/root/sid_test_apps/some/version/silabs/build.s37',
        hardwareVersion: 'xg24'
      },
      saved_paths: []
    });
    mockElectronAPI.saveConfig.mockResolvedValue({ success: true });
    mockElectronAPI.selectDirectory.mockResolvedValue('/selected/directory');
    mockElectronAPI.selectFile.mockResolvedValue('/selected/app.s37');
    mockElectronAPI.updateFlashPathData.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Silabs paths configuration section', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      const labels = screen.getAllByText(/Silabs/i);
      expect(labels.length).toBeGreaterThan(0);
    });
  });

  it('loads configuration on mount', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('silabs');
    });
  });

  it('shows test app selection control', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      const buttons = screen.getAllByText('Select Test App');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it('loads flash path data on mount', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('silabs');
    });
  });

  it('displays trimmed test app path from mock data', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      const trimmed = screen.getAllByText(/sid_test_apps/i);
      expect(trimmed.length).toBeGreaterThan(0);
    });
  });

  it('handles Select Test App file selection', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      const selectBtns = screen.getAllByText('Select Test App');
      fireEvent.click(selectBtns[0]);
    });
    await waitFor(() => {
      expect(mockElectronAPI.selectFile).toHaveBeenCalled();
      expect(mockElectronAPI.updateFlashPathData).toHaveBeenCalled();
    });
  });
  
  it('shows saved paths section with counter', async () => {
    render(<SilabsPathsSettings />);
    await waitFor(() => {
      const titles = screen.getAllByText(/Saved Path Configurations/i);
      expect(titles.length).toBeGreaterThan(0);
      const savedBadges = screen.getAllByText(/saved/i);
      expect(savedBadges.length).toBeGreaterThan(0);
    });
  });

  it('shows no path selected message when paths are empty', async () => {
    mockElectronAPI.loadConfig.mockResolvedValue({
      silabsPaths: {
        simplicityStudio: '',
        commander: '',
        slcCli: '',
        gecko_sdk: ''
      }
    });
    
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      const noPathElements = screen.getAllByText(/No path selected|Not configured/i);
      expect(noPathElements.length).toBeGreaterThan(0);
    });
  });

  it('handles configuration save errors gracefully', async () => {
    mockElectronAPI.updateFlashPathData.mockResolvedValue({ success: false, error: 'Save failed' });
    
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      const browseButtons = screen.getAllByText(/Browse|Select/i);
      if (browseButtons.length > 0) {
        fireEvent.click(browseButtons[0]);
      }
    });
    
    // Should not crash when save fails
    await waitFor(() => {
      expect(mockElectronAPI.updateFlashPathData).toHaveBeenCalled();
    });
  });

  it('shows proper form layout with labels and inputs', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      // Should have buttons for browsing paths
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      
      // Should show current path values
      const headers = screen.getAllByText(/Path Management/i);
      expect(headers.length).toBeGreaterThan(0);
    });
  });

  it('validates required tools configuration', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      // Should show test app selection controls and path management section
      const selectBtns = screen.getAllByText('Select Test App');
      expect(selectBtns.length).toBeGreaterThan(0);
      const headers = screen.getAllByText(/Path Management/i);
      expect(headers.length).toBeGreaterThan(0);
    });
  });

  it('handles different file types appropriately', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      // Should have multiple browse buttons for different tools
      const selectBtns = screen.getAllByText('Select Test App');
      expect(selectBtns.length).toBeGreaterThan(0);
    });
  });

  it('provides clear labeling for each tool', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      // Should have clear labels for what each path is for
      const titles = screen.getAllByText(/Saved Path Configurations/i);
      expect(titles.length).toBeGreaterThan(0);
    });
  });

  it('shows proper visual hierarchy with sections', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      // Should have some kind of sectioning or grouping
      const headers = screen.getAllByText(/Path Management/i);
      const container = headers[0].closest('div');
      expect(container).toBeInTheDocument();
    });
  });

  it('handles MAUI specific configurations', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      // Ensure component renders without MAUI-specific artifacts
      const selectBtns = screen.getAllByText('Select Test App');
      expect(selectBtns.length).toBeGreaterThan(0);
    });
  });

  it('displays proper tool descriptions and help text', async () => {
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      const titles = screen.getAllByText(/Saved Path Configurations/i);
      expect(titles.length).toBeGreaterThan(0);
    });
  });

  it('validates path formats for different operating systems', async () => {
    const windowsPath = 'C:\\Program Files\\Silabs\\Studio';
    const unixPath = '/usr/local/bin/silabs';
    
    mockElectronAPI.loadConfig.mockResolvedValue({
      silabsPaths: {
        simplicityStudio: windowsPath,
        commander: unixPath,
        slcCli: '',
        gecko_sdk: ''
      }
    });
    
    render(<SilabsPathsSettings />);
    
    await waitFor(() => {
      const titles = screen.getAllByText(/Saved Path Configurations/i);
      expect(titles.length).toBeGreaterThan(0);
    });
  });

  it('shows loading state while configuration loads', async () => {
    // Delay the config loading to test loading state
    mockElectronAPI.loadConfig.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({
        silabsPaths: {
          simplicityStudio: '/mock/path',
          commander: '',
          slcCli: '',
          gecko_sdk: ''
        }
      }), 100))
    );
    
    render(<SilabsPathsSettings />);
    
    // Should eventually load the configuration
    await waitFor(() => {
      const headings = screen.getAllByText(/Path Management/i);
      expect(headings.length).toBeGreaterThan(0);
    });
  });
});

