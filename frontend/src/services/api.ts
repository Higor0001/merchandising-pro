import {
  deleteOfflineQueueItem,
  enqueueOfflineItem,
  getApiCache,
  getOfflineQueueItems,
  setApiCache,
  updateOfflineQueueItem,
  type OfflineFormFile,
  type OfflineQueueItem,
} from './offlineDb';

export type { OfflineFormFile, OfflineQueueItem };

const PERMANENT_HTTP_ERRORS = new Set([400, 403, 404, 409, 422]);

export async function getOfflineQueueSummary(): Promise<{
  pending: number;
  failed: number;
  items: OfflineQueueItem[];
}> {
  const items = await getOfflineQueueItems();
  const pending = items.filter((i) => i.status === 'pending').length;
  const failed = items.filter((i) => i.status === 'failed_permanent').length;
  return { pending, failed, items };
}

export async function retryFailedOfflineItems(): Promise<void> {
  const items = await getOfflineQueueItems();
  for (const item of items) {
    if (item.status === 'failed_permanent') {
      await updateOfflineQueueItem({ ...item, status: 'pending', lastError: undefined });
    }
  }
}

export async function discardFailedOfflineItems(): Promise<void> {
  const items = await getOfflineQueueItems();
  for (const item of items) {
    if (item.status === 'failed_permanent') {
      await deleteOfflineQueueItem(item.id);
    }
  }
}

export async function syncOfflineQueue(): Promise<{
  synced: number;
  failed: number;
  permanentFailed: number;
}> {
  const queue = (await getOfflineQueueItems()).filter((i) => i.status === 'pending');
  if (queue.length === 0) {
    const all = await getOfflineQueueItems();
    return {
      synced: 0,
      failed: 0,
      permanentFailed: all.filter((i) => i.status === 'failed_permanent').length,
    };
  }

  const token = localStorage.getItem('merchpro_token');
  let synced = 0;
  let failed = 0;
  let permanentFailed = 0;

  for (const item of queue) {
    try {
      let fetchBody: BodyInit | null = item.body;
      const headers: Record<string, string> = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      if (item.formFields || item.formFiles) {
        const fd = new FormData();
        for (const f of item.formFields || []) fd.append(f.key, f.value);
        for (const file of item.formFiles || []) {
          fd.append(file.field, file.blob, file.name);
        }
        fetchBody = fd;
      } else {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(item.url, {
        method: item.method,
        headers,
        body: fetchBody,
      });

      if (res.status === 401) {
        localStorage.removeItem('merchpro_token');
        localStorage.removeItem('merchpro_user');
        window.dispatchEvent(new Event('auth-expired'));
        failed++;
        break;
      }

      if (res.ok) {
        await deleteOfflineQueueItem(item.id);
        synced++;
      } else if (PERMANENT_HTTP_ERRORS.has(res.status)) {
        const errData = await res.json().catch(() => ({}));
        await updateOfflineQueueItem({
          ...item,
          status: 'failed_permanent',
          attempts: (item.attempts || 0) + 1,
          lastError: errData.error || `Erro HTTP ${res.status}`,
        });
        permanentFailed++;
      } else {
        await updateOfflineQueueItem({
          ...item,
          attempts: (item.attempts || 0) + 1,
          lastError: `Erro temporário HTTP ${res.status}`,
        });
        failed++;
      }
    } catch {
      await updateOfflineQueueItem({
        ...item,
        attempts: (item.attempts || 0) + 1,
        lastError: 'Sem conexão ao sincronizar',
      });
      failed++;
      if (!navigator.onLine) break;
    }
  }

  window.dispatchEvent(new Event('offline-queue-changed'));
  return { synced, failed, permanentFailed };
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('/api') ? path : `/api${path}`;
  const token = localStorage.getItem('merchpro_token');
  const isFormData = options.body instanceof FormData;
  const method = (options.method || 'GET').toUpperCase();

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  try {
    const res = await fetch(url, { ...options, method, headers });
    if (res.status === 401) {
      localStorage.removeItem('merchpro_token');
      localStorage.removeItem('merchpro_user');
      window.dispatchEvent(new Event('auth-expired'));
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erro ${res.status}`);
    }
    if (method === 'GET') {
      void setApiCache(url, data);
    }
    return data as T;
  } catch (err: any) {
    // Offline fallback for GET via IndexedDB
    if (method === 'GET') {
      const cached = await getApiCache<T>(url);
      if (cached !== null) return cached;
    }
    // Offline queue for JSON mutations & FormData (photos/evidences) stored as native Blobs in IndexedDB
    if (!navigator.onLine && method !== 'GET') {
      if (isFormData && options.body instanceof FormData) {
        const formFields: Array<{ key: string; value: string }> = [];
        const formFiles: OfflineFormFile[] = [];
        for (const [k, v] of options.body.entries()) {
          if (v instanceof File) {
            formFiles.push({
              field: k,
              name: v.name || 'photo.jpg',
              type: v.type || 'image/jpeg',
              blob: v,
            });
          } else {
            formFields.push({ key: k, value: String(v) });
          }
        }
        await enqueueOfflineItem({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          url,
          method,
          body: null,
          formFields,
          formFiles,
          status: 'pending',
          attempts: 0,
          createdAt: new Date().toISOString(),
        });
      } else {
        await enqueueOfflineItem({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          url,
          method,
          body: typeof options.body === 'string' ? options.body : null,
          status: 'pending',
          attempts: 0,
          createdAt: new Date().toISOString(),
        });
      }
      return { offlineQueued: true } as T;
    }
    throw err;
  }
}
