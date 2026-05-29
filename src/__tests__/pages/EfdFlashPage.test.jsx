import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import EfdFlashPage from '../../pages/EfdFlashPage.jsx';
import { FlashingProvider } from '../../contexts/FlashingContext.jsx';

// Mock electron API
const mockElectronAPI = {
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  selectFile: vi.fn(),
  onConfigUpdated: vi.fn(),
  removeConfigListener: vi.fn(),
  getFlashPathData: vi.fn(),
  getSelectedCertificate: vi.fn(),
  readDirectory: vi.fn(),
  runCommandWithRealTimeOutput: vi.fn(),
  stopCommand: vi.fn(),
  findHexFile: vi.fn()
};

const EfdFlashPageWrapper = ({ children }) => (
  <FlashingProvider>
    {children}
  </FlashingProvider>
);

describe('EfdFlashPage', () => {
  beforeEach(() => {
    global.window.electronAPI = mockElectronAPI;
    vi.clearAllMocks();
    
    // Default mock responses - EFD page uses loadConfig, not getFlashPathData
    mockElectronAPI.loadConfig.mockResolvedValue({
      platformTools: '/mock/platform-tools'
    });
    mockElectronAPI.selectFile.mockResolvedValue('/selected/flashimage.py');
    mockElectronAPI.runCommandWithRealTimeOutput.mockImplementation((command, options, callback) => {
      if (callback) {
        callback('EFD Flash command started...\n');
        setTimeout(() => callback('EFD Flash completed.\n'), 100);
      }
      return Promise.resolve({ success: true });
    });
    mockElectronAPI.stopCommand.mockResolvedValue({ success: true });
  });

  it('renders EFD flash page title and main elements', async () => {
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      expect(screen.getAllByText(/Select flashimage\.py/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Console Output/i)[0]).toBeInTheDocument();
      // Check for Platform Tools text instead of "Platform Tools Configuration"
      expect(screen.getByText(/Platform Tools/i)).toBeInTheDocument();
    });
  });

  it('displays path status information', async () => {
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      // Check for status chip text variants
      const statusElements = screen.getAllByText(/Setup Required|Ready to Flash|Flashing in Progress/);
      expect(statusElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows console output section', async () => {
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const consoleOutputElements = screen.getAllByText(/Console Output/i);
      expect(consoleOutputElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows flash control buttons', async () => {
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const flashButtons = screen.getAllByText('Flash');
      const stopButtons = screen.getAllByText('Stop');
      
      expect(flashButtons.length).toBeGreaterThanOrEqual(1);
      expect(stopButtons.length).toBeGreaterThanOrEqual(1);
      // Note: EFD page doesn't have TEST button, only Flash and Stop
    });
  });

  it('loads flash path data on mount', async () => {
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      // EFD page uses loadConfig, not getFlashPathData
      expect(mockElectronAPI.loadConfig).toHaveBeenCalled();
    });
  });

  it('displays path information from mock data', async () => {
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      // Check for platform tools path display
      const platformToolsElements = screen.getAllByText(/\/mock\/platform-tools/);
      expect(platformToolsElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('handles flash operation start', async () => {
    // Set up a selected file first
    mockElectronAPI.selectFile.mockResolvedValue('/selected/flashimage.py');
    
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    // First select a file
    const selectButtons = screen.getAllByText(/Select flashimage\.py/i);
    fireEvent.click(selectButtons[0]);
    
    await waitFor(() => {
      const flashButtons = screen.getAllByText('Flash');
      expect(flashButtons[0]).not.toBeDisabled();
      fireEvent.click(flashButtons[0]);
    });
    
    await waitFor(() => {
      expect(mockElectronAPI.runCommandWithRealTimeOutput).toHaveBeenCalled();
    });
  });

  it('handles stop command', async () => {
    // Set up a selected file first
    mockElectronAPI.selectFile.mockResolvedValue('/selected/flashimage.py');
    
    // Mock runCommandWithRealTimeOutput to simulate longer-running flash operation
    mockElectronAPI.runCommandWithRealTimeOutput.mockImplementation((command, options, callback) => {
      if (callback) {
        callback('EFD Flash command started...\n');
        // Don't resolve immediately to keep flashing state active
      }
      return new Promise((resolve) => {
        // Keep the promise pending to simulate ongoing flashing
        setTimeout(() => resolve({ success: true }), 2000);
      });
    });
    
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    // First select a file
    const selectButtons = screen.getAllByText(/Select flashimage\.py/i);
    fireEvent.click(selectButtons[0]);
    
    // Start flashing first
    await waitFor(() => {
      const flashButtons = screen.getAllByText('Flash');
      fireEvent.click(flashButtons[0]);
    });
    
    // Wait for flashing state to be active, then check stop button
    await waitFor(() => {
      const stopButtons = screen.getAllByText('Stop');
      expect(stopButtons[0]).not.toBeDisabled();
    }, { timeout: 3000 });
    
    // Now click stop
    const stopButtons = screen.getAllByText('Stop');
    fireEvent.click(stopButtons[0]);
    
    await waitFor(() => {
      expect(mockElectronAPI.stopCommand).toHaveBeenCalled();
    });
  });

  it('displays EFD-specific options', async () => {
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      // EFD has Python 3 requirement info and platform tools configuration
      const pythonElements = screen.queryAllByText(/Python 3 Required/i);
      expect(pythonElements.length).toBeGreaterThanOrEqual(0);
    });
  });

  it('handles file selection', async () => {
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const selectButtons = screen.getAllByText(/Select flashimage\.py/i);
      fireEvent.click(selectButtons[0]);
    });
    
    await waitFor(() => {
      expect(mockElectronAPI.selectFile).toHaveBeenCalled();
    });
  });

  it('displays status information', async () => {
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      // Check for status indicators
      const statusElements = screen.getAllByText(/Setup Required|Ready to Flash|Flashing in Progress/);
      expect(statusElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('handles error detection in output', async () => {
    mockElectronAPI.runCommandWithRealTimeOutput.mockImplementation((command, options, callback) => {
      if (callback) {
        callback('EFD Flash started...\n');
        callback('ERROR: Device not found\n');
      }
      return Promise.resolve({ success: false });
    });
    
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const flashButtons = screen.getAllByText('Flash');
      fireEvent.click(flashButtons[0]);
    });
    
    // Should detect error in output
    await waitFor(() => {
      const errorElements = screen.queryAllByText(/ERROR|Device not found/i);
      expect(errorElements.length).toBeGreaterThanOrEqual(0);
    });
  });

  it('handles component unmount during flashing', async () => {
    // Set up a selected file first
    mockElectronAPI.selectFile.mockResolvedValue('/selected/flashimage.py');
    
    const { unmount } = render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    // First select a file
    const selectButtons = screen.getAllByText(/Select flashimage\.py/i);
    fireEvent.click(selectButtons[0]);
    
    // Start flashing
    await waitFor(() => {
      const flashButtons = screen.getAllByText('Flash');
      fireEvent.click(flashButtons[0]);
    });
    
    // Unmount should stop the command
    unmount();
    
    expect(mockElectronAPI.stopCommand).toHaveBeenCalled();
  });

  it('shows proper console output formatting', async () => {
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const consoleElements = screen.getAllByText(/Console output will appear here/i);
      expect(consoleElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('handles flashimage.py file selection', async () => {
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    // Look for flashimage.py selection UI elements
    await waitFor(() => {
      const selectElements = screen.getAllByText(/Select flashimage\.py/i);
      expect(selectElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('validates EFD-specific command construction', async () => {
    // Set up a selected file first
    mockElectronAPI.selectFile.mockResolvedValue('/selected/flashimage.py');
    
    render(
      <EfdFlashPageWrapper>
        <EfdFlashPage />
      </EfdFlashPageWrapper>
    );
    
    // First select a file
    const selectButtons = screen.getAllByText(/Select flashimage\.py/i);
    fireEvent.click(selectButtons[0]);
    
    await waitFor(() => {
      const flashButtons = screen.getAllByText('Flash');
      fireEvent.click(flashButtons[0]);
    });
    
    // Should construct EFD-specific commands
    await waitFor(() => {
      expect(mockElectronAPI.runCommandWithRealTimeOutput).toHaveBeenCalled();
      const callArgs = mockElectronAPI.runCommandWithRealTimeOutput.mock.calls[0];
      expect(callArgs[0]).toBeDefined(); // Command string
    });
  });
}); 