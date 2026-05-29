import React from 'react';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import EnvSettings from '../../../pages/settings/EnvSettings.jsx';

// Mock electron API
const mockElectronAPI = {
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  saveVisiblePages: vi.fn(),
  selectDirectory: vi.fn(),
  scanCertificates: vi.fn()
};

describe('EnvSettings Page', () => {
  beforeEach(() => {
    global.window.electronAPI = mockElectronAPI;
    vi.clearAllMocks();
    
    // Default mock responses
    mockElectronAPI.loadConfig.mockResolvedValue({
      platformTools: '/mock/platform/tools',
      credentials: '/mock/credentials',
      postmanCollectionPath: '/mock/postman',
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
    });
    mockElectronAPI.saveConfig.mockResolvedValue({ success: true });
    mockElectronAPI.saveVisiblePages.mockResolvedValue({ success: true });
    mockElectronAPI.selectDirectory.mockResolvedValue('/selected/path');
    mockElectronAPI.scanCertificates.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders environment paths section with all path selectors', async () => {
    render(<EnvSettings />);
    
    await waitFor(() => {
      const sections = screen.getAllByTestId('env-paths-section');
      expect(sections).toHaveLength(1);
      const section = sections[0];
      expect(section).toBeInTheDocument();
      expect(within(section).getByText('Platform Tools')).toBeInTheDocument();
      expect(within(section).getByText('Certificates')).toBeInTheDocument();
      expect(within(section).getByText('Postman Collections')).toBeInTheDocument();
    });
  });

  it('hides page visibility controls in the external edition', async () => {
    render(<EnvSettings />);
    
    await waitFor(() => {
      expect(screen.queryByTestId('visible-pages-section')).not.toBeInTheDocument();
      expect(screen.queryByText('Flash Nordic')).not.toBeInTheDocument();
      expect(screen.queryByText('Flash Silabs')).not.toBeInTheDocument();
    });
  });

  it('loads configuration on mount', async () => {
    render(<EnvSettings />);
    
    await waitFor(() => {
      expect(mockElectronAPI.loadConfig).toHaveBeenCalledTimes(1);
    });
  });

  it('displays loaded paths correctly', async () => {
    render(<EnvSettings />);
    
    const sections = await screen.findAllByTestId('env-paths-section');
    expect(sections).toHaveLength(1);
    const section = sections[0];
    await waitFor(() => {
      expect(within(section).getByText('/mock/platform/tools')).toBeInTheDocument();
      expect(within(section).getByText('/mock/credentials')).toBeInTheDocument();
      expect(within(section).getByText('/mock/postman')).toBeInTheDocument();
    });
  });

  describe('Path Selection', () => {
    const testCases = [
      {
        buttonName: 'Platform Tools',
        configKey: 'platformTools',
        shouldScan: false
      },
      {
        buttonName: 'Certificates',
        configKey: 'credentials',
        shouldScan: true
      },
      {
        buttonName: 'Postman Collections',
        configKey: 'postmanCollectionPath',
        shouldScan: false
      }
    ];

    testCases.forEach(({ buttonName, configKey, shouldScan }) => {
      it(`handles ${buttonName} folder selection`, async () => {
        render(<EnvSettings />);
        
        const sections = await screen.findAllByTestId('env-paths-section');
        expect(sections).toHaveLength(1);
        const section = sections[0];
        await waitFor(() => {
          const button = within(section).getByRole('button', { name: buttonName });
          fireEvent.click(button);
        });
        
        await waitFor(() => {
          expect(mockElectronAPI.selectDirectory).toHaveBeenCalledTimes(1);
          if (shouldScan) {
            expect(mockElectronAPI.scanCertificates).toHaveBeenCalledWith('/selected/path');
          } else {
            expect(mockElectronAPI.scanCertificates).not.toHaveBeenCalled();
          }
          expect(mockElectronAPI.saveConfig).toHaveBeenCalledWith({
            [configKey]: '/selected/path'
          });
        });
      });
    });
  });

  it('does not expose page visibility toggles in the external edition', async () => {
    render(<EnvSettings />);
    
    await waitFor(() => {
      expect(screen.queryByTestId('visible-pages-section')).not.toBeInTheDocument();
    });

    expect(mockElectronAPI.saveVisiblePages).not.toHaveBeenCalled();
  });

  it('does not display internal page status chips in the external edition', async () => {
    render(<EnvSettings />);
    
    await waitFor(() => {
      expect(screen.queryByText('Not Ready')).not.toBeInTheDocument();
    });
  });

  it('does not display internal visibility checkbox states in the external edition', async () => {
    render(<EnvSettings />);
    
    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: /Flash Nordic/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: /Flash Silabs/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: /API Testing/i })).not.toBeInTheDocument();
    });
  });

  it('handles invalid config gracefully by displaying placeholders', async () => {
    mockElectronAPI.loadConfig.mockResolvedValue(null);
    
    render(<EnvSettings />);
    
    const sections = await screen.findAllByTestId('env-paths-section');
    expect(sections).toHaveLength(1);
    const section = sections[0];
    await waitFor(() => {
      const placeholders = within(section).getAllByText('No path selected');
      expect(placeholders).toHaveLength(3);
    });
  });

  it('handles save config errors gracefully', async () => {
    // Mock a failed save and spy on console.error
    mockElectronAPI.saveConfig.mockResolvedValue({ success: false, error: 'Save failed' });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<EnvSettings />);
    
    const sections = await screen.findAllByTestId('env-paths-section');
    expect(sections).toHaveLength(1);
    const section = sections[0];
    await waitFor(() => {
      const platformToolsButton = within(section).getByRole('button', { name: /Platform Tools/i });
      fireEvent.click(platformToolsButton);
    });
    
    await waitFor(() => {
      expect(mockElectronAPI.saveConfig).toHaveBeenCalled();
      // Check that an error was logged to the console
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to save config:', 'Save failed');
    });
    
    consoleErrorSpy.mockRestore();
  });

  it('displays paths with proper truncation for long paths', async () => {
    const longPath = '/very/long/path/that/should/be/truncated/in/the/ui/display';
    mockElectronAPI.loadConfig.mockResolvedValue({
      platformTools: longPath,
      credentials: longPath,
      postmanCollectionPath: longPath,
      visiblePages: {}
    });
    
    render(<EnvSettings />);
    
    const sections = await screen.findAllByTestId('env-paths-section');
    expect(sections).toHaveLength(1);
    const section = sections[0];
    await waitFor(() => {
      // The full path should be present in the title attribute for tooltips
      const pathDisplays = within(section).getAllByTitle(longPath);
      expect(pathDisplays).toHaveLength(3);
    });
  });
});
