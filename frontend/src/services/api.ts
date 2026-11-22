export interface OfflineFormFile {
  field: string;
  name: string;
  type: string;
  dataUrl: string;
}

export interface OfflineQueueItem {
  id: string;
  url: string;
  method: string;
  body: string | null;
  formFields?: Array<{ key: string; value: string }>;
  formFiles?: OfflineFormFile[];
  createdAt: string;
}

const QUEUE_KEY = 'merchpro_offline_queue';
const CACHE_PREFIX = 'merchpro_cache_';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl: string, mimeType: string): Blob {
  const parts = dataUrl.split(',');
  const bstr = atob(parts[1] || '');
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mimeType || 'image/jpeg' });
}

export function getOfflineQueue(): OfflineQueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function setOfflineQueue(items: OfflineQueueItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event('offline-queue-changed'));
}

export async function syncOfflineQueue(): Promise<{ synced: number; failed: number }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  const token = localStorage.getItem('merchpro_token');
  const remaining: OfflineQueueItem[] = [];
  let synced = 0;

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
          fd.append(file.field, dataUrlToBlob(file.dataUrl, file.type), file.name);
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
      if (res.ok) synced++;
      else remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }

  setOfflineQueue(remaining);
  return { synced, failed: remaining.length };
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('/api') ? path : `/api${path}`;
  const token = localStorage.getItem('merchpro_token');
  const isFormData = options.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  try {
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      localStorage.removeItem('merchpro_token');
      localStorage.removeItem('merchpro_user');
      window.dispatchEvent(new Event('auth-expired'));
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erro ${res.status}`);
    }
    if (!options.method || options.method === 'GET') {
      try {
        localStorage.setItem(`${CACHE_PREFIX}${url}`, JSON.stringify(data));
      } catch {
        // ignore quota errors
      }
    }
    return data as T;
  } catch (err: any) {
    // Offline fallback for GET
    if (!options.method || options.method === 'GET') {
      const cached = localStorage.getItem(`${CACHE_PREFIX}${url}`);
      if (cached) return JSON.parse(cached) as T;
    }
    // Offline queue for JSON mutations & FormData (photos/evidences)
    if (!navigator.onLine && options.method && options.method !== 'GET') {
      const queue = getOfflineQueue();
      if (isFormData && options.body instanceof FormData) {
        const formFields: Array<{ key: string; value: string }> = [];
        const formFiles: OfflineFormFile[] = [];
        for (const [k, v] of options.body.entries()) {
          if (v instanceof File) {
            const dataUrl = await fileToDataUrl(v);
            formFiles.push({ field: k, name: v.name || 'photo.jpg', type: v.type || 'image/jpeg', dataUrl });
          } else {
            formFields.push({ key: k, value: String(v) });
          }
        }
        queue.push({
          id: `${Date.now()}-${Math.random()}`,
          url,
          method: options.method,
          body: null,
          formFields,
          formFiles,
          createdAt: new Date().toISOString(),
        });
      } else {
        queue.push({
          id: `${Date.now()}-${Math.random()}`,
          url,
          method: options.method,
          body: typeof options.body === 'string' ? options.body : null,
          createdAt: new Date().toISOString(),
        });
      }
      setOfflineQueue(queue);
      return { offlineQueued: true } as T;
    }
    throw err;
  }
}
