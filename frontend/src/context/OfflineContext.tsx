import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  discardFailedOfflineItems,
  getOfflineQueueSummary,
  retryFailedOfflineItems,
  syncOfflineQueue,
} from '../services/api';

interface OfflineContextType {
  isOnline: boolean;
  pendingCount: number;
  failedCount: number;
  syncNow: () => Promise<void>;
  retryFailed: () => Promise<void>;
  clearFailed: () => Promise<void>;
  syncing: boolean;
}

const OfflineContext = createContext<OfflineContextType>({} as OfflineContextType);

export const OfflineProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refreshCounts = useCallback(async () => {
    const summary = await getOfflineQueueSummary();
    setPendingCount(summary.pending);
    setFailedCount(summary.failed);
  }, []);

  const syncNow = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      await syncOfflineQueue();
      await refreshCounts();
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refreshCounts]);

  const retryFailed = useCallback(async () => {
    await retryFailedOfflineItems();
    await refreshCounts();
    await syncNow();
  }, [refreshCounts, syncNow]);

  const clearFailed = useCallback(async () => {
    await discardFailedOfflineItems();
    await refreshCounts();
  }, [refreshCounts]);

  useEffect(() => {
    void refreshCounts();

    const onOnline = () => {
      setIsOnline(true);
      void syncNow();
    };
    const onOffline = () => setIsOnline(false);
    const onQueueChanged = () => {
      void refreshCounts();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('offline-queue-changed', onQueueChanged);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('offline-queue-changed', onQueueChanged);
    };
  }, [refreshCounts, syncNow]);

  return (
    <OfflineContext.Provider
      value={{ isOnline, pendingCount, failedCount, syncNow, retryFailed, clearFailed, syncing }}
    >
      {children}
    </OfflineContext.Provider>
  );
};

export const useOffline = () => useContext(OfflineContext);
