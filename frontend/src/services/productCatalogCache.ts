import { apiFetch } from './api';
import {
  clearCatalogAndSearchCaches,
  getCatalogRecord,
  setCatalogRecord,
} from './offlineDb';

const CATALOG_STORE_KEY = 'si5_catalog_v7';
const SEARCH_CACHE_STORE_KEY = 'si5_search_cache_v7';
const LEGACY_CATALOG_KEY = 'merchpro_si5_catalog_v3';

export interface CachedProduct {
  id: number;
  sku: string;
  ean: string;
  name: string;
  brand_id?: number | null;
  brand_name?: string;
  category?: string;
  unit?: string;
  weight?: string;
  system_price?: number;
  image_url?: string;
  ncm?: string;
  cest_codigo?: string;
  cest_descricao?: string;
  source?: string;
  si5_raw?: any;
}

let memoryCatalog: CachedProduct[] = [];
let memorySyncedAt: string | null = null;
let memorySearchCache: Record<string, number[]> = {};

export function clearAllSearchAndCatalogCache() {
  memoryCatalog = [];
  memorySyncedAt = null;
  memorySearchCache = {};
  void clearCatalogAndSearchCaches();
}

export function getDeviceCatalog(): CachedProduct[] {
  return memoryCatalog.filter((p) => p.ean && p.ean !== 'A CONFERIR');
}

export function getDeviceCatalogSyncedAt(): string | null {
  return memorySyncedAt;
}

export function saveDeviceCatalog(products: CachedProduct[]) {
  const clean = products.filter((p) => p.ean && p.ean !== 'A CONFERIR');
  memoryCatalog = clean;
  memorySyncedAt = new Date().toISOString();
  void setCatalogRecord(CATALOG_STORE_KEY, clean);
  try {
    localStorage.removeItem(LEGACY_CATALOG_KEY);
  } catch {
    // ignore
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
 * Carrega o catálogo priorizando IndexedDB (sem estourar a cota de 5MB do localStorage).
 */
export async function loadProductsWithDeviceCache(forceServer = false): Promise<CachedProduct[]> {
  if (!forceServer) {
    if (memoryCatalog.length > 0) return getDeviceCatalog();
    const idbRec = await getCatalogRecord<CachedProduct[]>(CATALOG_STORE_KEY);
    if (idbRec && Array.isArray(idbRec.data) && idbRec.data.length > 0) {
      memoryCatalog = idbRec.data;
      memorySyncedAt = idbRec.updatedAt;
      return getDeviceCatalog();
    }
    // Migrar cache legado do localStorage se existir
    try {
      const legacy = localStorage.getItem(LEGACY_CATALOG_KEY);
      if (legacy) {
        const parsed: CachedProduct[] = JSON.parse(legacy);
        if (Array.isArray(parsed) && parsed.length > 0) {
          saveDeviceCatalog(parsed);
          return getDeviceCatalog();
        }
      }
    } catch {
      // ignore
    }
  }

  const fresh = await apiFetch<CachedProduct[]>('/products');
  if (Array.isArray(fresh) && fresh.length > 0) {
    saveDeviceCatalog(fresh);
  }
  return fresh || [];
}

export async function syncFullCatalogFromSi5(
  query = ''
): Promise<{ products: CachedProduct[]; inserted: number; updated: number; pages_fetched: number }> {
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

export async function pullPepsicoFromOpenFoodFacts(): Promise<{
  products: CachedProduct[];
  inserted: number;
  updated: number;
  brands_processed: number;
}> {
  const res = await apiFetch<{ inserted: number; updated: number; brands_processed: number }>(
    '/openfoodfacts/pull-pepsico',
    { method: 'POST' }
  );
  const all = await apiFetch<CachedProduct[]>('/products');
  saveDeviceCatalog(all);
  return {
    products: all,
    inserted: res.inserted || 0,
    updated: res.updated || 0,
    brands_processed: res.brands_processed || 0,
  };
}

export async function searchOrResolveSi5WithDeviceCache(
  query: string,
  currentProducts: CachedProduct[]
): Promise<{ matched: CachedProduct[]; allProducts: CachedProduct[]; fromCache: boolean }> {
  const q = query.trim();
  const qLower = q.toLowerCase();

  if (/^\d{8,14}$/.test(q)) {
    const exactLocal = currentProducts.find((p) => p.ean === q || p.sku === q);
    if (exactLocal) {
      return { matched: [exactLocal], allProducts: currentProducts, fromCache: true };
    }
  }

  if (Object.keys(memorySearchCache).length === 0) {
    const rec = await getCatalogRecord<Record<string, number[]>>(SEARCH_CACHE_STORE_KEY);
    if (rec?.data) memorySearchCache = rec.data;
  }

  if (memorySearchCache[qLower]?.length) {
    const ids = new Set(memorySearchCache[qLower]);
    const localMatches = currentProducts.filter((p) => ids.has(p.id));
    if (localMatches.length > 0) {
      return { matched: localMatches, allProducts: currentProducts, fromCache: true };
    }
  }

  const res = await apiFetch<{ products: CachedProduct[] }>('/si5/search-and-cache', {
    method: 'POST',
    body: JSON.stringify({ q, per_page: 20 }),
  });

  const returned = res.products || [];
  const updatedCatalog = upsertProductsInDeviceCache(returned);

  if (returned.length > 0) {
    memorySearchCache = { ...memorySearchCache, [qLower]: returned.map((p) => p.id) };
    void setCatalogRecord(SEARCH_CACHE_STORE_KEY, memorySearchCache);
  }

  return { matched: returned, allProducts: updatedCatalog, fromCache: false };
}
