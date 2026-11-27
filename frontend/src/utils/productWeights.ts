import type { CachedProduct } from '../services/productCatalogCache';

const WEIGHT_TOKEN_RE =
  /(?:^|[\s\-–—(/])(\d+(?:[.,]\d+)?)\s*(KG|GRS?|G|ML|LTS?|L)(?=$|[\s\-–—)/.,])/gi;

/**
 * Normaliza a string de gramatura (ex: "140g" -> "140 g", "1,5L" -> "1,5 L").
 */
export function normalizeWeightLabel(raw?: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(kg|grs?|g|ml|lts?|l)\b/i);
  if (!m) return s.toLocaleUpperCase('pt-BR');
  const num = m[1].replace('.', ',');
  const unitRaw = m[2].toLowerCase();
  const unit =
    unitRaw === 'gr' || unitRaw === 'grs' || unitRaw === 'g'
      ? 'g'
      : unitRaw === 'lt' || unitRaw === 'lts' || unitRaw === 'l'
        ? 'L'
        : unitRaw === 'ml'
          ? 'ml'
          : unitRaw === 'kg'
            ? 'kg'
            : unitRaw;
  return `${num} ${unit}`;
}

/**
 * Converte gramatura para valor numérico comparável em gramas/ml para ordenação crescente.
 */
export function weightSortValue(weight: string): number {
  const m = String(weight || '').match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (!m) return 999999;
  const val = parseFloat(m[1].replace(',', '.'));
  const unit = m[2].toLowerCase();
  if (unit === 'kg' || unit === 'l') return val * 1000;
  return val;
}

/**
 * Extrai a gramatura de um produto (campo `weight` ou do próprio nome).
 */
export function extractProductWeight(p?: Pick<CachedProduct, 'name' | 'weight'> | null): string {
  if (!p) return '';
  if (p.weight && String(p.weight).trim()) {
    return normalizeWeightLabel(p.weight);
  }
  const matches = Array.from(String(p.name || '').matchAll(WEIGHT_TOKEN_RE));
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    return normalizeWeightLabel(`${last[1]} ${last[2]}`);
  }
  return '';
}

/**
 * Remove a gramatura do nome do produto para exibição limpa na lista de itens
 * (a gramatura passa a ser atribuída pela caixa de seleção dedicada).
 */
export function stripWeightFromProductName(name?: string): string {
  const raw = String(name || '').trim();
  if (!raw) return '';
  let cleaned = raw
    .replace(/\(\s*\d+(?:[.,]\d+)?\s*(?:KG|GRS?|G|ML|LTS?|L)\s*\)/gi, ' ')
    .replace(WEIGHT_TOKEN_RE, ' ')
    .replace(/\s*[-–—/]+\s*$/g, '')
    .replace(/^\s*[-–—/]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) cleaned = raw;
  return cleaned.toLocaleUpperCase('pt-BR');
}

export interface ProductBaseGroup {
  baseName: string;
  items: CachedProduct[];
  weights: string[];
}

/**
 * Agrupa SKUs pelo nome base SEM gramatura, consolidando todas as gramaturas disponíveis.
 */
export function groupProductsWithoutWeight(products: CachedProduct[]): ProductBaseGroup[] {
  const map = new Map<string, ProductBaseGroup>();

  for (const p of products) {
    const baseName = stripWeightFromProductName(p.name);
    if (!baseName) continue;
    let group = map.get(baseName);
    if (!group) {
      group = { baseName, items: [], weights: [] };
      map.set(baseName, group);
    }
    group.items.push(p);
    const w = extractProductWeight(p);
    if (w && !group.weights.includes(w)) {
      group.weights.push(w);
    }
  }

  return Array.from(map.values())
    .map((g) => ({
      ...g,
      weights: [...g.weights].sort((a, b) => weightSortValue(a) - weightSortValue(b)),
    }))
    .sort((a, b) => a.baseName.localeCompare(b.baseName, 'pt-BR'));
}

/**
 * Lista todas as gramaturas disponíveis em um conjunto de produtos (ordenadas).
 */
export function collectAvailableWeights(products: CachedProduct[]): string[] {
  const set = new Set<string>();
  for (const p of products) {
    const w = extractProductWeight(p);
    if (w) set.add(w);
  }
  return Array.from(set).sort((a, b) => weightSortValue(a) - weightSortValue(b));
}

/**
 * Resolve qual product_id melhor representa o nome base + gramatura atribuída.
 */
export function resolveProductIdByBaseAndWeight(
  groups: ProductBaseGroup[],
  baseName: string,
  weight: string
): string {
  if (!baseName) return '';
  const group = groups.find((g) => g.baseName === baseName);
  if (!group || group.items.length === 0) return '';
  if (weight) {
    const normW = normalizeWeightLabel(weight);
    const exact = group.items.find((item) => extractProductWeight(item) === normW);
    if (exact) return String(exact.id);
  }
  return String(group.items[0].id);
}
