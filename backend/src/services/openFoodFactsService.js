const { col, nextId, nowStr } = require('../db/database');

const PEPSICO_BRAND_SLUGS = [
  { slug: 'doritos', label: 'Doritos' },
  { slug: 'cheetos', label: 'Cheetos' },
  { slug: 'ruffles', label: 'Ruffles' },
  { slug: 'lays', label: 'Lay’s' },
  { slug: 'fandangos', label: 'Fandangos' },
  { slug: 'pepsi', label: 'Pepsi' },
  { slug: 'gatorade', label: 'Gatorade' },
  { slug: 'h2oh', label: 'H2OH!' },
  { slug: 'toddynho', label: 'Toddynho' },
  { slug: 'toddy', label: 'Toddy' },
  { slug: 'quaker', label: 'Quaker' },
  { slug: 'kero-coco', label: 'Kero Coco' },
  { slug: 'lipton', label: 'Lipton' },
  { slug: 'torcida', label: 'Torcida' },
  { slug: 'baconzitos', label: 'Baconzitos' },
  { slug: 'cebolitos', label: 'Cebolitos' },
  { slug: 'eqlibri', label: 'eQlibri' },
  { slug: 'popcorners', label: 'PopCorners' },
  { slug: 'tostitos', label: 'Tostitos' },
];

async function fetchOpenFoodFactsByBrand(slug) {
  const fields = 'code,product_name,product_name_pt,brands,categories,quantity,image_front_url,image_url';
  const urls = [
    `https://br.openfoodfacts.org/api/v2/search?brands_tags=${encodeURIComponent(slug)}&page_size=50&fields=${fields}`,
    `https://world.openfoodfacts.org/api/v2/search?brands_tags=${encodeURIComponent(slug)}&countries_tags_en=brazil&page_size=50&fields=${fields}`,
  ];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'MerchandisingPro/1.0 (merchandising-pro)' },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data?.products) && data.products.length > 0) {
        return data.products;
      }
    } catch {
      // try next url
    }
  }
  return [];
}

/**
 * Importa gratuitamente o catálogo PepsiCo a partir do Open Food Facts (Brasil / Global)
 * e salva todos os produtos no MongoDB sem gastar tokens da SI5.
 */
async function pullPepsicoFromOpenFoodFacts() {
  const productsCol = await col('products');
  const brandsCol = await col('brands');
  const existingBrands = await brandsCol.find({}).toArray();
  const brandByLower = new Map(existingBrands.map((b) => [String(b.name || '').trim().toLowerCase(), b.id]));

  let inserted = 0;
  let updated = 0;
  let brandsProcessed = 0;
  const seenEans = new Set();

  for (const brandDef of PEPSICO_BRAND_SLUGS) {
    const items = await fetchOpenFoodFactsByBrand(brandDef.slug);
    brandsProcessed++;
    if (!items.length) continue;

    // Garantir marca no catálogo
    const brandKey = brandDef.label.toLowerCase();
    let brandId = brandByLower.get(brandKey);
    if (!brandId) {
      brandId = await nextId('brands');
      await brandsCol.insertOne({ id: brandId, name: brandDef.label, is_own: 1, color: '#1d4ed8' });
      brandByLower.set(brandKey, brandId);
    }

    for (const raw of items) {
      const ean = String(raw?.code || '').trim();
      const name = String(raw?.product_name_pt || raw?.product_name || '').trim();
      if (!ean || !name || seenEans.has(ean)) continue;
      seenEans.add(ean);

      const imageUrl = String(raw?.image_front_url || raw?.image_url || '').trim();
      const weight = String(raw?.quantity || '').trim();
      const unit = 'UN';
      const categoryRaw = String(raw?.categories || '').split(',')[0].trim();
      const category = categoryRaw ? categoryRaw.replace(/^en:|^pt:/i, '') : 'PepsiCo';

      const existing = await productsCol.findOne({ ean });
      if (existing) {
        await productsCol.updateOne(
          { id: existing.id },
          {
            $set: {
              name: existing.source === 'si5' ? existing.name : name,
              brand_id: existing.brand_id ?? brandId,
              category: existing.category || category,
              unit: existing.unit || unit,
              weight: existing.weight || weight,
              image_url: existing.image_url || imageUrl,
              active: 1,
              updated_at: nowStr(),
            },
          }
        );
        updated++;
      } else {
        const id = await nextId('products');
        await productsCol.insertOne({
          id,
          sku: `OFF-${ean}`,
          ean,
          name,
          brand_id: brandId,
          category,
          unit,
          weight,
          system_price: 0,
          image_url: imageUrl,
          min_stock: 10,
          ideal_facings: 4,
          source: 'openfoodfacts',
          active: 1,
          created_at: nowStr(),
        });
        inserted++;
      }
    }
  }

  if (inserted + updated > 0) {
    await productsCol.updateMany(
      { ean: 'A CONFERIR', active: { $ne: 0 } },
      { $set: { active: 0, deactivated_reason: 'Substituído por catálogo Open Food Facts' } }
    );
  }

  return { inserted, updated, total: inserted + updated, brands_processed: brandsProcessed };
}

module.exports = { pullPepsicoFromOpenFoodFacts };
