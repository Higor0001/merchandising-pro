export interface OfflineQueueItem {
  id: string;
  url: string;
  method: string;
  body: string | null;
  createdAt: string;
}

const QUEUE_KEY = 'merchpro_offline_queue';
const CACHE_PREFIX = 'merchpro_cache_';

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
      const res = await fetch(item.url, {
        method: item.method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: item.body,
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
    // Offline queue for JSON mutations
    if (!navigator.onLine && !isFormData && options.method && options.method !== 'GET') {
      const queue = getOfflineQueue();
      queue.push({
        id: `${Date.now()}-${Math.random()}`,
        url,
        method: options.method,
        body: typeof options.body === 'string' ? options.body : null,
        createdAt: new Date().toISOString(),
      });
      setOfflineQueue(queue);
      return { offlineQueued: true } as T;
    }
    throw err;
  }
}
