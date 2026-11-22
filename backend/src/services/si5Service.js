const { col, nextId, nowStr } = require('../db/database');

const SI5_BASE_URL = 'https://global.si5.com.br/api';

function getToken() {
  return (process.env.SI5_API_TOKEN || '').trim();
}

function isSi5Configured() {
  return Boolean(getToken());
}

async function si5Request(path) {
  const token = getToken();
  if (!token) {
    throw new Error('SI5_API_TOKEN não configurado nas variáveis de ambiente do servidor.');
  }

  const res = await fetch(`${SI5_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401) throw new Error('Token SI5 Global inválido ou expirado.');
  if (res.status === 404) throw new Error('Produto não encontrado na base SI5 Global.');
  if (res.status === 429) throw new Error('Limite diário de consultas da API SI5 Global atingido.');
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Erro na API SI5 Global (HTTP ${res.status}): ${txt.slice(0, 200)}`);
  }

  return res.json();
}

async function searchSi5Products({ q = '', page = 1, per_page = 20 }) {
  const params = new URLSearchParams({
    q: String(q || ''),
    page: String(page || 1),
    per_page: String(Math.min(100, Number(per_page || 20))),
  });
  return si5Request(`/produtos?${params.toString()}`);
}

async function getSi5ProductByBarcode(codbar) {
  const clean = String(codbar || '').trim();
  if (!clean) throw new Error('Código de barras (GTIN/EAN) é obrigatório.');
  return si5Request(`/produtos/${encodeURIComponent(clean)}`);
}

/**
 * Normaliza e faz upsert de uma lista de itens da API SI5 na coleção `products`.
 */
async function upsertSi5ItemsToCatalog(items = []) {
  const productsCol = await col('products');
  const brandsCol = await col('brands');
  const existingBrands = await brandsCol.find({}).toArray();
  const brandByLower = new Map(existingBrands.map((b) => [String(b.name || '').trim().toLowerCase(), b.id]));

  let inserted = 0;
  let updated = 0;
  const savedProducts = [];

  for (const raw of items) {
    const ean = String(raw?.codbar || raw?.gtin || raw?.ean || '').trim();
    const name = String(raw?.produto || raw?.nome || raw?.descricao || '').trim();
    if (!ean || !name) continue;

    let brandId = null;
    const brandName = String(raw?.marca || '').trim();
    if (brandName) {
      const key = brandName.toLowerCase();
      if (brandByLower.has(key)) {
        brandId = brandByLower.get(key);
      } else {
        brandId = await nextId('brands');
        await brandsCol.insertOne({ id: brandId, name: brandName, is_own: 1, color: '#1d4ed8' });
        brandByLower.set(key, brandId);
      }
    }

    const existing = await productsCol.findOne({ ean });
    const price = Number(raw?.preco_medio || raw?.preco || 0);
    const category = String(raw?.categoria || 'Geral').trim() || 'Geral';
    const unit = String(raw?.embalagem || 'UN').trim() || 'UN';
    const imageUrl = String(raw?.imagem_url || '').trim();
    const ncm = String(raw?.ncm || '').trim();
    const cestCodigo = String(raw?.cest_codigo || '').trim();
    const cestDescricao = String(raw?.cest_descricao || '').trim();

    if (existing) {
      await productsCol.updateOne(
        { id: existing.id },
        {
          $set: {
            name,
            brand_id: brandId ?? existing.brand_id,
            category,
            unit,
            system_price: price > 0 ? price : existing.system_price,
            image_url: imageUrl || existing.image_url || '',
            ncm: ncm || existing.ncm || '',
            cest_codigo: cestCodigo || existing.cest_codigo || '',
            cest_descricao: cestDescricao || existing.cest_descricao || '',
            si5_raw: raw,
            source: 'si5',
            active: 1,
            updated_at: nowStr(),
          },
        }
      );
      updated++;
      savedProducts.push(await productsCol.findOne({ id: existing.id }, { projection: { _id: 0 } }));
    } else {
      const id = await nextId('products');
      const doc = {
        id,
        sku: `SI5-${ean}`,
        ean,
        name,
        brand_id: brandId,
        category,
        unit,
        system_price: price,
        image_url: imageUrl,
        ncm,
        cest_codigo: cestCodigo,
        cest_descricao: cestDescricao,
        si5_raw: raw,
        min_stock: 10,
        ideal_facings: 4,
        source: 'si5',
        active: 1,
        created_at: nowStr(),
      };
      await productsCol.insertOne(doc);
      inserted++;
      savedProducts.push(doc);
    }
  }

  // Ocultar itens legados sem EAN ('A CONFERIR') das listas ativas quando houver produtos reais da SI5
  if (savedProducts.length > 0) {
    await productsCol.updateMany(
      { ean: 'A CONFERIR', active: { $ne: 0 } },
      { $set: { active: 0, deactivated_reason: 'Substituído por catálogo SI5' } }
    );
  }

  return { inserted, updated, total: savedProducts.length, products: savedProducts };
}

/**
 * Sincroniza o catálogo local de produtos diretamente a partir da API SI5 Global.
 */
async function syncSi5Catalog({ q = '', pages = 1, per_page = 50 } = {}) {
  const allItems = [];
  for (let p = 1; p <= pages; p++) {
    const res = await searchSi5Products({ q, page: p, per_page });
    const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
    if (list.length === 0) break;
    allItems.push(...list);
    if (list.length < per_page) break;
  }
  return upsertSi5ItemsToCatalog(allItems);
}

/**
 * Busca um EAN no catálogo local; se não existir, consulta na API SI5 e importa automaticamente.
 */
async function resolveAndImportSi5Barcode(codbar) {
  const clean = String(codbar || '').trim();
  if (!clean) throw new Error('Código EAN é obrigatório.');

  const productsCol = await col('products');
  const local = await productsCol.findOne({ ean: clean }, { projection: { _id: 0 } });
  if (local) return { product: local, from_si5: false };

  const res = await getSi5ProductByBarcode(clean);
  const item = res?.data || res;
  if (!item || (!item.codbar && !item.produto)) {
    throw new Error('Produto não encontrado na base SI5 Global.');
  }

  const syncRes = await upsertSi5ItemsToCatalog([{ ...item, codbar: item.codbar || clean }]);
  if (!syncRes.products.length) {
    throw new Error('Não foi possível importar o produto da SI5 Global.');
  }
  return { product: syncRes.products[0], from_si5: true };
}

module.exports = {
  isSi5Configured,
  searchSi5Products,
  getSi5ProductByBarcode,
  upsertSi5ItemsToCatalog,
  syncSi5Catalog,
  resolveAndImportSi5Barcode,
};
