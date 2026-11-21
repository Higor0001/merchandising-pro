import React, { createContext, useContext, useEffect, useState } from 'react';
import { getOfflineQueue, syncOfflineQueue } from '../services/api';

interface OfflineContextType {
  isOnline: boolean;
  pendingCount: number;
  syncNow: () => Promise<void>;
  syncing: boolean;
}

const OfflineContext = createContext<OfflineContextType>({} as OfflineContextType);

export const OfflineProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(() => getOfflineQueue().length);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = () => setPendingCount(getOfflineQueue().length);

  const syncNow = async () => {
    if (!navigator.onLine || syncing) return;
    setSyncing(true);
    try {
      await syncOfflineQueue();
      refreshCount();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      syncNow();
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('offline-queue-changed', refreshCount);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('offline-queue-changed', refreshCount);
    };
  }, []);

  return (
    <OfflineContext.Provider value={{ isOnline, pendingCount, syncNow, syncing }}>
      {children}
    </OfflineContext.Provider>
  );
};

export const useOffline = () => useContext(OfflineContext);
