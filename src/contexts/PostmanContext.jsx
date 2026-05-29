import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';

const PostmanContext = createContext();

export const usePostman = () => {
  const context = useContext(PostmanContext);
  if (!context) {
    throw new Error('usePostman must be used within a PostmanProvider');
  }
  return context;
};

export const PostmanProvider = ({ children }) => {
  const [collections, setCollections] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCacheLoading, setIsCacheLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadCachedCollections = useCallback(async () => {
    console.log('[PostmanContext] Attempting to load cached collections...');
    setIsCacheLoading(true);
    setError(null);
    try {
      const cachedCollections = await window.electronAPI.loadCachedPostmanCollections();
      if (cachedCollections && Array.isArray(cachedCollections)) {
          setCollections(cachedCollections);
          console.log(`[PostmanContext] Loaded ${cachedCollections.length} collections from cache.`);
      } else {
          setCollections([]);
          console.log('[PostmanContext] Cache was empty or invalid.');
      }
    } catch (err) {
      console.error('Error loading cached collections:', err);
      setError('Failed to load cached collections.');
      setCollections([]);
    } finally {
      setIsCacheLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCachedCollections();
  }, [loadCachedCollections]);

  useEffect(() => {
    const handleUpdate = () => {
      console.log('[PostmanContext] Received collections update notification. Reloading cache...');
      loadCachedCollections();
    };

    console.log('[PostmanContext] Setting up IPC listener for collection updates.');
    window.electronAPI.onPostmanCollectionsUpdated(handleUpdate);

    return () => {
      console.log('[PostmanContext] Cleaning up IPC listener for collection updates.');
      window.electronAPI.removePostmanCollectionsUpdatedListener(handleUpdate);
    };
  }, [loadCachedCollections]);

  const scanCollections = useCallback(async (folderPath) => {
    if (!folderPath) {
      console.warn('Cannot scan Postman collections: folder path is not provided.');
      setError('Postman collection folder path is not set in Settings.');
      setCollections([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    console.log(`[PostmanContext] Starting scan for path: ${folderPath}`);
    try {
      const scannedCollections = await window.electronAPI.scanPostmanCollections(folderPath);
      setCollections(scannedCollections || []);
      console.log(`[PostmanContext] Scan complete. Found ${scannedCollections?.length || 0} collections.`);
    } catch (err) {
      console.error('Error scanning collections:', err);
      setError(`Failed to scan collections: ${err.message}`);
      setCollections([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const value = {
    collections,
    isLoading,
    isCacheLoading,
    error,
    scanCollections,
    loadCachedCollections
  };

  return (
    <PostmanContext.Provider value={value}>
      {children}
    </PostmanContext.Provider>
  );
}; 