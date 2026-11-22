import { apiFetch } from './api';

const CATALOG_KEY = 'merchpro_si5_catalog_v2';
const CATALOG_SYNC_AT_KEY = 'merchpro_si5_catalog_synced_at_v2';
const SEARCH_CACHE_KEY = 'merchpro_si5_search_cache_v2';

export function clearAllSearchAndCatalogCache() {
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

export interface CachedProduct {
  id: number;
  sku: string;
  ean: string;
  name: string;
  brand_id?: number | null;
  brand_name?: string;
  category?: string;
  unit?: string;
  system_price?: number;
  image_url?: string;
  ncm?: string;
  cest_codigo?: string;
  cest_descricao?: string;
  source?: string;
  si5_raw?: any;
}

export function getDeviceCatalog(): CachedProduct[] {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    const list: CachedProduct[] = raw ? JSON.parse(raw) : [];
    return list.filter((p) => p.ean && p.ean !== 'A CONFERIR');
  } catch {
    return [];
  }
}

export function getDeviceCatalogSyncedAt(): string | null {
  return localStorage.getItem(CATALOG_SYNC_AT_KEY);
}

export function saveDeviceCatalog(products: CachedProduct[]) {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(products));
    localStorage.setItem(CATALOG_SYNC_AT_KEY, new Date().toISOString());
  } catch {
    // ignore storage quota errors
  }
}

export function upsertProductsInDeviceCache(newProducts: CachedProduct[]): CachedProduct[] {
  const current = getDeviceCatalog();
  const byId = new Map<number, CachedProduct>(current.map((p) => [p.id, p]));
  for (const p of newProducts) {
    if (p && p.id) byId.set(p.id, { ...byId.get(p.id), ...p });
  }
  const merged = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  saveDeviceCatalog(merged);
  return merged;
}

/**
 * Carrega o catálogo priorizando o cache salvo no dispositivo para não gastar tokens da SI5 à toa.
 * Só busca no servidor se o cache do dispositivo estiver vazio ou se forceServer=true.
 */
export async function loadProductsWithDeviceCache(forceServer = false): Promise<CachedProduct[]> {
  const cached = getDeviceCatalog();
  if (!forceServer && cached.length > 0) {
    return cached;
  }
  const fresh = await apiFetch<CachedProduct[]>('/products');
  if (Array.isArray(fresh) && fresh.length > 0) {
    saveDeviceCatalog(fresh);
  }
  return fresh || [];
}

/**
 * Puxada completa explícita da API SI5 Global (todas as páginas), salvando no banco de dados e no dispositivo.
 * Só é executada quando o usuário solicita explicitamente.
 */
export async function syncFullCatalogFromSi5(query = ''): Promise<{ products: CachedProduct[]; inserted: number; updated: number; pages_fetched: number }> {
  const res = await apiFetch<{ inserted: number; updated: number; pages_fetched: number }>('/si5/full-pull', {
    method: 'POST',
    body: JSON.stringify({ q: query }),
  });
  const all = await apiFetch<CachedProduct[]>('/products');
  saveDeviceCatalog(all);
  return {
    products: all,
    inserted: res.inserted || 0,
    updated: res.updated || 0,
    pages_fetched: res.pages_fetched || 1,
  };
}

/**
 * Busca por nome ou EAN: verifica primeiro no cache do dispositivo e no histórico de buscas;
 * só consulta a API SI5 se não estiver salvo localmente, salvando o retorno completo no dispositivo.
 */
export async function searchOrResolveSi5WithDeviceCache(
  query: string,
  currentProducts: CachedProduct[]
): Promise<{ matched: CachedProduct[]; allProducts: CachedProduct[]; fromCache: boolean }> {
  const q = query.trim();
  const qLower = q.toLowerCase();

  // 1. Verificar se já existe no dispositivo por EAN exato
  if (/^\d{8,14}$/.test(q)) {
    const exactLocal = currentProducts.find((p) => p.ean === q || p.sku === q);
    if (exactLocal) {
      return { matched: [exactLocal], allProducts: currentProducts, fromCache: true };
    }
  }

  // 2. Verificar cache de buscas anteriores no dispositivo para não repetir chamadas à SI5
  try {
    const searchCache: Record<string, number[]> = JSON.parse(localStorage.getItem(SEARCH_CACHE_KEY) || '{}');
    if (searchCache[qLower]?.length) {
      const ids = new Set(searchCache[qLower]);
      const localMatches = currentProducts.filter((p) => ids.has(p.id));
      if (localMatches.length > 0) {
        return { matched: localMatches, allProducts: currentProducts, fromCache: true };
      }
    }
  } catch {
    // ignore
  }

  // 3. Consultar na API SI5 via backend (que também persiste tudo no MongoDB)
  const res = await apiFetch<{ products: CachedProduct[] }>('/si5/search-and-cache', {
    method: 'POST',
    body: JSON.stringify({ q, per_page: 20 }),
  });

  const returned = res.products || [];
  const updatedCatalog = upsertProductsInDeviceCache(returned);

  // Salvar índice da busca no dispositivo
  if (returned.length > 0) {
    try {
      const searchCache: Record<string, number[]> = JSON.parse(localStorage.getItem(SEARCH_CACHE_KEY) || '{}');
      searchCache[qLower] = returned.map((p) => p.id);
      localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(searchCache));
    } catch {
      // ignore
    }
  }

  return { matched: returned, allProducts: updatedCatalog, fromCache: false };
}
