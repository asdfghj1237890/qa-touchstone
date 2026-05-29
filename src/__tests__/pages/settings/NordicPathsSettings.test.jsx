import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import NordicPathsSettings from '../../../pages/settings/NordicPathsSettings.jsx';

describe('NordicPathsSettings Page', () => {
  let mockElectronAPI;

  beforeEach(() => {
    mockElectronAPI = {
      getFlashPathData: vi.fn(),
      updateFlashPathData: vi.fn(),
      selectFile: vi.fn(),
      onConfigUpdated: vi.fn(),
      removeConfigListener: vi.fn()
    };

    // Ensure window.electronAPI is available
    global.window.electronAPI = mockElectronAPI;
    
    // Setup default mock responses
    mockElectronAPI.getFlashPathData.mockResolvedValue({
      current_used_paths: {
        softDevicePath: '/mock/soft-device.hex',
        testAppPath: '/mock/test-app.hex'
      },
      saved_paths: [
        {
          id: 1,
          version: 'v1.0',
          soft_device_path: '/mock/saved/soft-device.hex',
          test_app_path: '/mock/saved/test-app.hex'
        }
      ]
    });
    mockElectronAPI.updateFlashPathData.mockResolvedValue({ success: true });
    mockElectronAPI.selectFile.mockResolvedValue('/selected/file.hex');

    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  it('renders Nordic flash paths configuration section', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      expect(screen.getByText(/Select Soft Device/i)).toBeInTheDocument();
      expect(screen.getByText(/Select Test App/i)).toBeInTheDocument();
    });
  });

  it('loads flash path data on mount', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('nordic');
    });
  });

  it('displays soft device path configuration', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      const softDeviceElements = screen.getAllByText(/Select Soft Device/i);
      expect(softDeviceElements.length).toBeGreaterThan(0);
    });
  });

  it('displays test app path configuration', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      const testAppElements = screen.getAllByText(/Select Test App/i);
      expect(testAppElements.length).toBeGreaterThan(0);
    });
  });

  it('displays path management section', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      const pathMgmtElements = screen.getAllByText(/Path Management/i);
      expect(pathMgmtElements.length).toBeGreaterThan(0);
    });
  });

  it('displays saved path configurations table', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      const savedConfigElements = screen.getAllByText(/Saved Path Configurations/i);
      expect(savedConfigElements.length).toBeGreaterThan(0);
    });
  });

  it('handles soft device file selection', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      const softDeviceButtons = screen.getAllByText(/Select Soft Device/i);
      expect(softDeviceButtons.length).toBeGreaterThan(0);
    });

    const softDeviceButtons = screen.getAllByText(/Select Soft Device/i);
    fireEvent.click(softDeviceButtons[0]);
    
    await waitFor(() => {
      expect(mockElectronAPI.selectFile).toHaveBeenCalled();
    });
  });

  it('handles test app file selection', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      const testAppButtons = screen.getAllByText(/Select Test App/i);
      expect(testAppButtons.length).toBeGreaterThan(0);
    });

    const testAppButtons = screen.getAllByText(/Select Test App/i);
    fireEvent.click(testAppButtons[0]);
    
    await waitFor(() => {
      expect(mockElectronAPI.selectFile).toHaveBeenCalled();
    });
  });

  it('updates flash path data when path is selected', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      const softDeviceButtons = screen.getAllByText(/Select Soft Device/i);
      expect(softDeviceButtons.length).toBeGreaterThan(0);
    });

    const softDeviceButtons = screen.getAllByText(/Select Soft Device/i);
    fireEvent.click(softDeviceButtons[0]);
    
    await waitFor(() => {
      expect(mockElectronAPI.updateFlashPathData).toHaveBeenCalledWith({
        path_type: 'nordic',
        current_used_paths: {
          softDevicePath: '/selected/file.hex'
        }
      });
    });
  });

  it('displays current paths when loaded', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      // Should display the mock paths (may be truncated)
      const pathElements = screen.getAllByText(/soft-device\.hex|test-app\.hex/);
      expect(pathElements.length).toBeGreaterThan(0);
    });
  });

  it('shows no path selected message when paths are empty', async () => {
    mockElectronAPI.getFlashPathData.mockResolvedValue({
      current_used_paths: {
        softDevicePath: '',
        testAppPath: ''
      },
      saved_paths: []
    });
    
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      const noPathElements = screen.getAllByText(/No path selected/i);
      expect(noPathElements.length).toBeGreaterThan(0);
    });
  });

  it('handles update errors gracefully', async () => {
    mockElectronAPI.updateFlashPathData.mockResolvedValue({ success: false, error: 'Update failed' });
    
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      const softDeviceButtons = screen.getAllByText(/Select Soft Device/i);
      expect(softDeviceButtons.length).toBeGreaterThan(0);
    });

    const softDeviceButtons = screen.getAllByText(/Select Soft Device/i);
    fireEvent.click(softDeviceButtons[0]);
    
    // Should not crash when update fails
    await waitFor(() => {
      expect(mockElectronAPI.updateFlashPathData).toHaveBeenCalled();
    });
  });

  it('shows proper form layout with buttons and path displays', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      // Should have buttons for selecting paths
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      
      // Should show current path values
      const pathTexts = screen.getAllByText(/\/mock\//);
      expect(pathTexts.length).toBeGreaterThan(0);
    });
  });

  it('validates flash path configuration', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      // Both soft device and test app paths should be displayed (may be truncated)
      const pathElements = screen.getAllByText(/soft-device\.hex|test-app\.hex/);
      expect(pathElements.length).toBeGreaterThan(0);
    });
  });

  it('handles file selection appropriately', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      // Both path selectors should be present
      const softDeviceElements = screen.getAllByText(/Select Soft Device/i);
      const testAppElements = screen.getAllByText(/Select Test App/i);
      expect(softDeviceElements.length).toBeGreaterThan(0);
      expect(testAppElements.length).toBeGreaterThan(0);
    });
  });

  it('provides clear labeling for each path type', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      // Should have clear labels for what each path is for
      const softDeviceElements = screen.getAllByText(/Select Soft Device/i);
      const testAppElements = screen.getAllByText(/Select Test App/i);
      expect(softDeviceElements.length).toBeGreaterThan(0);
      expect(testAppElements.length).toBeGreaterThan(0);
    });
  });

  it('shows proper visual hierarchy with sections', async () => {
    render(<NordicPathsSettings />);
    
    await waitFor(() => {
      // Should have path management and saved configurations sections
      const pathMgmtElements = screen.getAllByText(/Path Management/i);
      const savedConfigElements = screen.getAllByText(/Saved Path Configurations/i);
      expect(pathMgmtElements.length).toBeGreaterThan(0);
      expect(savedConfigElements.length).toBeGreaterThan(0);
    });
  });
}); 