import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface OfflineFormFile {
  field: string;
  name: string;
  type: string;
  blob: Blob;
}

export interface OfflineQueueItem {
  id: string;
  url: string;
  method: string;
  body: string | null;
  formFields?: Array<{ key: string; value: string }>;
  formFiles?: OfflineFormFile[];
  status: 'pending' | 'failed_permanent';
  attempts: number;
  lastError?: string;
  createdAt: string;
}

interface MerchProDB extends DBSchema {
  offline_queue: {
    key: string;
    value: OfflineQueueItem;
    indexes: { 'by-status': string };
  };
  api_cache: {
    key: string;
    value: { url: string; data: any; updatedAt: string };
  };
  catalog: {
    key: string;
    value: { key: string; data: any; updatedAt: string };
  };
}

const DB_NAME = 'merchandising_pro_db';
const DB_VERSION = 1;
const LEGACY_QUEUE_KEY = 'merchpro_offline_queue';

let dbPromise: Promise<IDBPDatabase<MerchProDB>> | null = null;
let migratedLegacy = false;

function dataUrlToBlob(dataUrl: string, mimeType: string): Blob {
  const parts = dataUrl.split(',');
  const bstr = atob(parts[1] || '');
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mimeType || 'image/jpeg' });
}

export async function getOfflineDb(): Promise<IDBPDatabase<MerchProDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MerchProDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('offline_queue')) {
          const store = db.createObjectStore('offline_queue', { keyPath: 'id' });
          store.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('api_cache')) {
          db.createObjectStore('api_cache', { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains('catalog')) {
          db.createObjectStore('catalog', { keyPath: 'key' });
        }
      },
    });
  }
  const db = await dbPromise;
  if (!migratedLegacy) {
    migratedLegacy = true;
    await migrateLegacyQueue(db);
  }
  return db;
}

async function migrateLegacyQueue(db: IDBPDatabase<MerchProDB>) {
  try {
    const raw = localStorage.getItem(LEGACY_QUEUE_KEY);
    if (!raw) return;
    const legacyItems = JSON.parse(raw);
    if (Array.isArray(legacyItems) && legacyItems.length > 0) {
      for (const item of legacyItems) {
        const files: OfflineFormFile[] | undefined = Array.isArray(item.formFiles)
          ? item.formFiles.map((f: any) => ({
              field: f.field,
              name: f.name || 'photo.jpg',
              type: f.type || 'image/jpeg',
              blob: f.dataUrl ? dataUrlToBlob(f.dataUrl, f.type) : new Blob(),
            }))
          : undefined;
        await db.put('offline_queue', {
          id: item.id || `${Date.now()}-${Math.random()}`,
          url: item.url,
          method: item.method,
          body: item.body ?? null,
          formFields: item.formFields,
          formFiles: files,
          status: 'pending',
          attempts: 0,
          createdAt: item.createdAt || new Date().toISOString(),
        });
      }
    }
    localStorage.removeItem(LEGACY_QUEUE_KEY);
  } catch {
    // ignore migration errors
  }
}

export async function getOfflineQueueItems(): Promise<OfflineQueueItem[]> {
  try {
    const db = await getOfflineDb();
    const items = await db.getAll('offline_queue');
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export async function enqueueOfflineItem(item: OfflineQueueItem): Promise<void> {
  const db = await getOfflineDb();
  await db.put('offline_queue', item);
  window.dispatchEvent(new Event('offline-queue-changed'));
}

export async function updateOfflineQueueItem(item: OfflineQueueItem): Promise<void> {
  const db = await getOfflineDb();
  await db.put('offline_queue', item);
  window.dispatchEvent(new Event('offline-queue-changed'));
}

export async function deleteOfflineQueueItem(id: string): Promise<void> {
  const db = await getOfflineDb();
  await db.delete('offline_queue', id);
  window.dispatchEvent(new Event('offline-queue-changed'));
}

export async function getApiCache<T = any>(url: string): Promise<T | null> {
  try {
    const db = await getOfflineDb();
    const entry = await db.get('api_cache', url);
    return entry ? (entry.data as T) : null;
  } catch {
    return null;
  }
}

export async function setApiCache(url: string, data: any): Promise<void> {
  try {
    const db = await getOfflineDb();
    await db.put('api_cache', { url, data, updatedAt: new Date().toISOString() });
  } catch {
    // ignore storage errors
  }
}

export async function getCatalogRecord<T = any>(key: string): Promise<{ data: T; updatedAt: string } | null> {
  try {
    const db = await getOfflineDb();
    const entry = await db.get('catalog', key);
    return entry ? { data: entry.data as T, updatedAt: entry.updatedAt } : null;
  } catch {
    return null;
  }
}

export async function setCatalogRecord(key: string, data: any): Promise<void> {
  try {
    const db = await getOfflineDb();
    await db.put('catalog', { key, data, updatedAt: new Date().toISOString() });
  } catch {
    // ignore storage errors
  }
}

export async function clearCatalogAndSearchCaches(): Promise<void> {
  try {
    const db = await getOfflineDb();
    await db.clear('catalog');
  } catch {
    // ignore
  }
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('merchpro_si5_') || k.startsWith('merchpro_cache_'))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

/**
 * Limpa caches autenticados (IndexedDB api_cache, localStorage e CacheStorage do Service Worker) no logout.
 */
export async function clearAuthCaches(): Promise<void> {
  try {
    const db = await getOfflineDb();
    await db.clear('api_cache');
  } catch {
    // ignore
  }
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('merchpro_cache_')) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.includes('api')).map((k) => caches.delete(k)));
    }
  } catch {
    // ignore
  }
}
