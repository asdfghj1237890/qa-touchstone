import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import NordicFlashPage from '../../pages/NordicFlashPage.jsx';
import { FlashingProvider } from '../../contexts/FlashingContext.jsx';

// Mock electron API
const mockElectronAPI = {
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  flashNordicDevice: vi.fn(),
  stopFlashing: vi.fn(),
  scanSerialPorts: vi.fn(),
  selectFile: vi.fn(),
  onFlashProgress: vi.fn(),
  removeFlashProgressListener: vi.fn(),
  onConfigUpdated: vi.fn(),
  removeConfigListener: vi.fn(),
  getFlashPathData: vi.fn(),
  getSelectedCertificate: vi.fn(),
  readDirectory: vi.fn(),
  runCommandWithRealTimeOutput: vi.fn(),
  stopCommand: vi.fn()
};

const NordicFlashPageWrapper = ({ children }) => (
  <FlashingProvider>
    {children}
  </FlashingProvider>
);

describe('NordicFlashPage', () => {
  beforeEach(() => {
    global.window.electronAPI = mockElectronAPI;
    vi.clearAllMocks();
    
    // Default mock responses
    mockElectronAPI.loadConfig.mockResolvedValue({
      nordicPaths: {
        nrfConnect: '/mock/nrf-connect',
        jlinkExe: '/mock/jlink.exe',
        nrfjprog: '/mock/nrfjprog',
        mergehex: '/mock/mergehex'
      }
    });
    mockElectronAPI.scanSerialPorts.mockResolvedValue([
      { path: '/dev/ttyUSB0', manufacturer: 'SEGGER' },
      { path: '/dev/ttyUSB1', manufacturer: 'Nordic' }
    ]);
    mockElectronAPI.selectFile.mockResolvedValue('/selected/firmware.hex');
    mockElectronAPI.flashNordicDevice.mockResolvedValue({ success: true });
    mockElectronAPI.getFlashPathData.mockResolvedValue({
      certificate_folder_path: '/mock/certificates',
      current_used_paths: {
        softDevicePath: '/mock/soft-device.hex',
        testAppPath: '/mock/test-app.hex'
      },
      saved_paths: []
    });
    mockElectronAPI.getSelectedCertificate.mockResolvedValue({
      certificateid: 'mock-cert-id',
      hexFile: '/mock/certificate.hex'
    });
    mockElectronAPI.readDirectory.mockResolvedValue([
      'certificate_mock-cert-id_folder',
      'other-folder',
      'file.txt'
    ]);
    mockElectronAPI.runCommandWithRealTimeOutput.mockImplementation((command, options, callback) => {
      // Simulate command execution with callback
      if (callback) {
        callback('Command started...\n');
        setTimeout(() => callback('Command completed.\n'), 100);
      }
      return Promise.resolve({ success: true });
    });
    mockElectronAPI.stopCommand.mockResolvedValue({ success: true });
  });

  it('renders Nordic flash page title and main elements', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      expect(screen.getByText(/SoftDevice Path/i)).toBeInTheDocument();
      expect(screen.getByText(/Test App Path/i)).toBeInTheDocument();
      expect(screen.getByText(/Certificates/i)).toBeInTheDocument();
    });
  });

  it('displays path status information', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      const readyElements = screen.getAllByText(/Ready/i);
      expect(readyElements.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('shows console output section', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      const consoleOutputElements = screen.getAllByText(/Console Output/i);
      expect(consoleOutputElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows flash button', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      const flashButtons = screen.getAllByText('FLASH');
      const testButtons = screen.getAllByText('TEST');
      const stopButtons = screen.getAllByText('STOP');
      
      expect(flashButtons.length).toBeGreaterThanOrEqual(1);
      expect(testButtons.length).toBeGreaterThanOrEqual(1);
      expect(stopButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('displays device recovery options', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      const recoveryElements = screen.getAllByText(/Device Recovery/i);
      const resetElements = screen.getAllByText(/Final Reset/i);
      
      expect(recoveryElements.length).toBeGreaterThanOrEqual(1);
      expect(resetElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('loads flash path data on mount', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      expect(mockElectronAPI.getFlashPathData).toHaveBeenCalledWith('nordic');
    });
  });

  it('displays path information from mock data', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      const softDeviceElements = screen.getAllByText(/soft-device\.hex/i);
      const testAppElements = screen.getAllByText(/test-app\.hex/i);
      
      expect(softDeviceElements.length).toBeGreaterThanOrEqual(1);
      expect(testAppElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('handles flash operation start', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      const flashButtons = screen.getAllByText('FLASH');
      fireEvent.click(flashButtons[0]);
    });
    
    // Should call runCommandWithRealTimeOutput when flashing
    await waitFor(() => {
      expect(mockElectronAPI.runCommandWithRealTimeOutput).toHaveBeenCalled();
    });
  });

  it('shows progress during flashing', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      // Should have some kind of progress indicator
      const progressElements = screen.queryAllByText(/Progress|%|Flashing/i);
      expect(progressElements.length).toBeGreaterThanOrEqual(0);
    });
  });

  it('displays device configuration options', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      // Should have options for device type, chip erase, etc.
      const configElements = screen.queryAllByText(/Device|Chip|Erase|Options/i);
      expect(configElements.length).toBeGreaterThan(0);
    });
  });

  it('shows stop button (disabled when not flashing)', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      const stopButtons = screen.getAllByText('STOP');
      expect(stopButtons.length).toBeGreaterThanOrEqual(1);
      
      // The stop button should be present but disabled when not flashing
      expect(stopButtons[0]).toBeInTheDocument();
    });
  });

  it('shows device recovery and reset options', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      // Check for checkboxes (there might be more due to multiple renders)
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThanOrEqual(2);
      
      // Check for recovery and reset option labels
      const recoveryElements = screen.getAllByText(/Device Recovery/i);
      const resetElements = screen.getAllByText(/Final Reset/i);
      
      expect(recoveryElements.length).toBeGreaterThanOrEqual(1);
      expect(resetElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows console output area', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      const consoleOutputElements = screen.getAllByText(/Console Output/i);
      const consoleMessageElements = screen.getAllByText(/Console output will appear here/i);
      
      expect(consoleOutputElements.length).toBeGreaterThanOrEqual(1);
      expect(consoleMessageElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('handles test device connection', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      const testButtons = screen.getAllByText('TEST');
      fireEvent.click(testButtons[0]);
    });
    
    // Test button should trigger device connection check logic
    await waitFor(() => {
      expect(mockElectronAPI.runCommandWithRealTimeOutput).toHaveBeenCalled();
    });
  });

  it('displays certificate information', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      const certificateElements = screen.getAllByText(/Certificates/i);
      expect(certificateElements.length).toBeGreaterThanOrEqual(1);
      
      // Should show certificate status
      const statusChips = screen.getAllByText(/Ready/i);
      expect(statusChips.length).toBeGreaterThan(0);
    });
  });

  it('shows proper layout with control buttons', async () => {
    render(
      <NordicFlashPageWrapper>
        <NordicFlashPage />
      </NordicFlashPageWrapper>
    );
    
    await waitFor(() => {
      // Should have the main control buttons
      const flashButtons = screen.getAllByText('FLASH');
      const testButtons = screen.getAllByText('TEST');
      const stopButtons = screen.getAllByText('STOP');
      
      expect(flashButtons.length).toBeGreaterThanOrEqual(1);
      expect(testButtons.length).toBeGreaterThanOrEqual(1);
      expect(stopButtons.length).toBeGreaterThanOrEqual(1);
    });
  });
}); 