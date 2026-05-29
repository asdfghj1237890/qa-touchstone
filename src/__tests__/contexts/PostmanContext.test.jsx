import React from 'react';
import { render, screen, waitFor, renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostmanProvider, usePostman } from '../../contexts/PostmanContext.jsx';

// Mock electron API
const mockElectronAPI = {
  loadCachedPostmanCollections: vi.fn(),
  onPostmanCollectionsUpdated: vi.fn(),
  removePostmanCollectionsUpdatedListener: vi.fn(),
  scanPostmanCollections: vi.fn()
};

describe('PostmanContext', () => {
  beforeEach(() => {
    global.window.electronAPI = mockElectronAPI;
    vi.clearAllMocks();
    
    // Default mock responses
    mockElectronAPI.loadCachedPostmanCollections.mockResolvedValue([
      {
        name: 'Test Collection',
        filePath: '/path/to/collection.json',
        info: { name: 'Test Collection', schema: '2.1.0' },
        item: []
      }
    ]);
  });

  it('provides default state', async () => {
    const { result } = renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    await waitFor(() => {
      expect(result.current.collections).toBeDefined();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isCacheLoading).toBe(false);
      expect(result.current.error).toBe(null);
      expect(typeof result.current.scanCollections).toBe('function');
    });
  });

  it('loads cached collections on mount', async () => {
    renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    await waitFor(() => {
      expect(mockElectronAPI.loadCachedPostmanCollections).toHaveBeenCalled();
    });
  });

  it('handles collection loading success', async () => {
    const mockCollections = [
      {
        name: 'API Collection',
        filePath: '/collections/api.json',
        info: { name: 'API Collection', schema: '2.1.0' },
        item: [{ name: 'Request 1' }]
      }
    ];
    
    mockElectronAPI.loadCachedPostmanCollections.mockResolvedValue(mockCollections);
    
    const { result } = renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    await waitFor(() => {
      expect(result.current.collections).toEqual(mockCollections);
      expect(result.current.isCacheLoading).toBe(false);
    });
  });

  it('handles collection loading error', async () => {
    const errorMessage = 'Failed to load collections';
    mockElectronAPI.loadCachedPostmanCollections.mockRejectedValue(new Error(errorMessage));
    
    const { result } = renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    await waitFor(() => {
      expect(result.current.error).toBe('Failed to load cached collections.');
      expect(result.current.isCacheLoading).toBe(false);
    });
  });

  it('scans for new collections', async () => {
    const mockNewCollections = [
      {
        name: 'New Collection',
        filePath: '/new/collection.json',
        info: { name: 'New Collection', schema: '2.1.0' },
        item: []
      }
    ];
    
    mockElectronAPI.scanPostmanCollections.mockResolvedValue(mockNewCollections);
    
    const { result } = renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    await act(async () => {
      await result.current.scanCollections('/test/path');
    });
    
    expect(mockElectronAPI.scanPostmanCollections).toHaveBeenCalledWith('/test/path');
    expect(result.current.collections).toEqual(mockNewCollections);
  });

  it('handles scan error gracefully', async () => {
    mockElectronAPI.scanPostmanCollections.mockRejectedValue(new Error('Scan failed'));
    
    const { result } = renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    await act(async () => {
      await result.current.scanCollections('/test/path');
    });
    
    expect(result.current.error).toBe('Failed to scan collections: Scan failed');
    expect(result.current.isLoading).toBe(false);
  });

  it('listens for collection updates', async () => {
    renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    await waitFor(() => {
      expect(mockElectronAPI.onPostmanCollectionsUpdated).toHaveBeenCalled();
    });
  });

  it('handles collection update events', async () => {
    let updateHandler;
    mockElectronAPI.onPostmanCollectionsUpdated.mockImplementation((handler) => {
      updateHandler = handler;
    });
    
    const { result } = renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    // Wait for initial load to complete
    await waitFor(() => {
      expect(result.current.isCacheLoading).toBe(false);
    });
    
    // Verify initial state has the default mock collection
    expect(result.current.collections).toEqual([
      {
        name: 'Test Collection',
        filePath: '/path/to/collection.json',
        info: { name: 'Test Collection', schema: '2.1.0' },
        item: []
      }
    ]);
    
    // Mock the loadCachedPostmanCollections to return updated collections when called again
    const updatedCollections = [
      {
        name: 'Updated Collection',
        filePath: '/updated/collection.json',
        info: { name: 'Updated Collection', schema: '2.1.0' },
        item: []
      }
    ];
    mockElectronAPI.loadCachedPostmanCollections.mockResolvedValue(updatedCollections);
    
    // Trigger the update event
    act(() => {
      updateHandler();
    });
    
    await waitFor(() => {
      expect(result.current.collections).toEqual(updatedCollections);
    });
  });

  it('cleans up listeners on unmount', async () => {
    const { unmount } = renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    unmount();
    
    expect(mockElectronAPI.removePostmanCollectionsUpdatedListener).toHaveBeenCalled();
  });

  it('throws error when used outside provider', () => {
    // Suppress console.error for this test
    const originalError = console.error;
    console.error = vi.fn();
    
    expect(() => {
      renderHook(() => usePostman());
    }).toThrow('usePostman must be used within a PostmanProvider');
    
    console.error = originalError;
  });

  it('manages loading states correctly', async () => {
    const { result } = renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    // Initial cache loading
    expect(result.current.isCacheLoading).toBe(true);
    
    await waitFor(() => {
      expect(result.current.isCacheLoading).toBe(false);
    });
    
    // Scanning loading state
    mockElectronAPI.scanPostmanCollections.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve([]), 100))
    );
    
    act(() => {
      result.current.scanCollections('/test/path');
    });
    
    expect(result.current.isLoading).toBe(true);
    
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('provides collections to child components', async () => {
    const TestComponent = () => {
      const { collections } = usePostman();
      return (
        <div>
          {collections.map((col, index) => (
            <div key={index}>{col.name}</div>
          ))}
        </div>
      );
    };
    
    render(
      <PostmanProvider>
        <TestComponent />
      </PostmanProvider>
    );
    
    await waitFor(() => {
      expect(screen.getByText('Test Collection')).toBeInTheDocument();
    });
  });

  it('handles empty collections gracefully', async () => {
    mockElectronAPI.loadCachedPostmanCollections.mockResolvedValue([]);
    
    const { result } = renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    await waitFor(() => {
      expect(result.current.collections).toEqual([]);
      expect(result.current.error).toBe(null);
    });
  });

  it('preserves collection structure', async () => {
    const complexCollection = {
      name: 'Complex Collection',
      filePath: '/complex/collection.json',
      info: { 
        name: 'Complex Collection', 
        schema: '2.1.0',
        description: 'A complex collection with folders'
      },
      item: [
        {
          name: 'Folder 1',
          item: [
            { name: 'Request 1.1' },
            { name: 'Request 1.2' }
          ]
        },
        { name: 'Request 2' }
      ],
      variable: [
        { key: 'baseUrl', value: 'https://api.example.com' }
      ]
    };
    
    mockElectronAPI.loadCachedPostmanCollections.mockResolvedValue([complexCollection]);
    
    const { result } = renderHook(() => usePostman(), {
      wrapper: PostmanProvider
    });
    
    await waitFor(() => {
      expect(result.current.collections[0]).toEqual(complexCollection);
      expect(result.current.collections[0].item[0].item).toHaveLength(2);
      expect(result.current.collections[0].variable).toHaveLength(1);
    });
  });
}); 