import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import RfdFlashPage from '../../pages/RfdFlashPage.jsx';
import { FlashingProvider } from '../../contexts/FlashingContext.jsx';

// Mock electron API
const mockElectronAPI = {
  loadConfig: vi.fn(),
  selectFile: vi.fn(),
  runCommandWithRealTimeOutput: vi.fn(),
  stopCommand: vi.fn()
};

const RfdFlashPageWrapper = ({ children }) => (
  <FlashingProvider>
    {children}
  </FlashingProvider>
);

describe('RfdFlashPage', () => {
  beforeEach(() => {
    global.window.electronAPI = mockElectronAPI;
    vi.clearAllMocks();
    
    // Default mock responses
    mockElectronAPI.loadConfig.mockResolvedValue({
      platformTools: '/mock/platform-tools'
    });
    mockElectronAPI.selectFile.mockResolvedValue(null); // No file selected by default
    mockElectronAPI.runCommandWithRealTimeOutput.mockImplementation((command, options, callback) => {
      if (callback) {
        callback('Flash command started...\n');
        setTimeout(() => callback('Flash completed.\n'), 100);
      }
      return Promise.resolve({ success: true });
    });
    mockElectronAPI.stopCommand.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    // Clean up any DOM elements after each test
    document.body.innerHTML = '';
  });

  it('renders RFD flash page title and main elements', async () => {
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      // Use button roles for better test reliability
      const buttons = screen.getAllByRole('button');
      const selectFlashBinButtons = buttons.filter(btn => btn.textContent.includes('Select flash-bin'));
      const flashButtons = buttons.filter(btn => btn.textContent === 'Flash');
      const stopButtons = buttons.filter(btn => btn.textContent === 'Stop');
      
      expect(selectFlashBinButtons.length).toBeGreaterThan(0);
      expect(flashButtons.length).toBeGreaterThan(0);
      expect(stopButtons.length).toBeGreaterThan(0);
      expect(screen.getByText('Console Output')).toBeInTheDocument();
    });
  });

  it('displays path status information', async () => {
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      // The status should be "Setup Required" initially since no file is selected
      expect(screen.getByText('Setup Required')).toBeInTheDocument();
      // The component shows a warning message about platform tools setup
      expect(screen.getByText(/Ensure you have setup your platform tools path/i)).toBeInTheDocument();
    });
  });

  it('shows console output section', async () => {
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const consoleOutputElements = screen.getAllByText(/Console Output/i);
      expect(consoleOutputElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows flash control buttons', async () => {
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const buttonTexts = buttons.map(btn => btn.textContent);
      
      expect(buttonTexts.some(text => text === 'Flash')).toBe(true);
      expect(buttonTexts.some(text => text === 'Stop')).toBe(true);
      expect(buttonTexts.some(text => text.includes('Select flash-bin'))).toBe(true);
    });
  });

  it('loads configuration on mount', async () => {
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      expect(mockElectronAPI.loadConfig).toHaveBeenCalled();
    });
  });

  it('displays fastboot setup information', async () => {
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      expect(screen.getByText(/Fastboot Approach/i)).toBeInTheDocument();
      expect(screen.getByText(/setup your platform tools path/i)).toBeInTheDocument();
    });
  });

  it('handles file selection', async () => {
    mockElectronAPI.selectFile.mockResolvedValue('/test/flash-without-bld-12345.bin');
    
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const selectButton = buttons.find(btn => btn.textContent.includes('Select flash-bin'));
      fireEvent.click(selectButton);
    });
    
    await waitFor(() => {
      expect(mockElectronAPI.selectFile).toHaveBeenCalled();
    });
  });

  it('disables flash button when no file selected', async () => {
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const flashButton = buttons.find(btn => btn.textContent === 'Flash');
      expect(flashButton).toBeDisabled();
    });
  });

  it('shows valid file selection message', async () => {
    mockElectronAPI.selectFile.mockResolvedValue('/test/flash-without-bld-12345.bin');
    
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const selectButton = buttons.find(btn => btn.textContent.includes('Select flash-bin'));
      fireEvent.click(selectButton);
    });
    
    await waitFor(() => {
      expect(screen.getByText('Ready to Flash')).toBeInTheDocument();
    });
  });

  it('shows invalid file selection message', async () => {
    mockElectronAPI.selectFile.mockResolvedValue('/test/invalid-file.txt');
    
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const selectButton = buttons.find(btn => btn.textContent.includes('Select flash-bin'));
      fireEvent.click(selectButton);
    });
    
    // Invalid file should not change status from "Setup Required"
    await waitFor(() => {
      expect(screen.getByText('Setup Required')).toBeInTheDocument();
    });
  });

  it('shows proper console output formatting', async () => {
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      expect(screen.getByText(/Console output will appear here/i)).toBeInTheDocument();
    });
  });

  it('displays file path when valid file is selected', async () => {
    mockElectronAPI.selectFile.mockResolvedValue('/test/path/flash-without-bld-12345.bin');
    
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const selectButton = buttons.find(btn => btn.textContent.includes('Select flash-bin'));
      fireEvent.click(selectButton);
    });
    
    await waitFor(() => {
      expect(screen.getByText('Selected File')).toBeInTheDocument();
      expect(screen.getByText(/flash-without-bld-12345\.bin/)).toBeInTheDocument();
    });
  });

  it('disables stop button when not flashing', async () => {
    render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const stopButton = buttons.find(btn => btn.textContent === 'Stop');
      expect(stopButton).toBeDisabled();
    });
  });

  it('handles component unmount cleanup', async () => {
    const { unmount } = render(
      <RfdFlashPageWrapper>
        <RfdFlashPage />
      </RfdFlashPageWrapper>
    );
    
    // Component should clean up on unmount
    unmount();
    
    // No specific assertions needed - just ensure no errors during unmount
    expect(true).toBe(true);
  });
}); 