const { col, nextId, nowStr } = require('./database');
const pepsicoCatalog = require('./pepsico_catalog_si5.json');

let migrationPromise = null;

/**
 * Executa migrations incrementais no MongoDB de forma idempotente,
 * preservando 100% dos dados e estruturas existentes.
 */
async function runIncrementalMigrations() {
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    // 1. Índices para integridade referencial lógica e performance store-centric
    await Promise.all([
      (await col('stores')).createIndex({ id: 1 }, { unique: true }),
      (await col('visits')).createIndex({ id: 1 }, { unique: true }),
      (await col('visits')).createIndex({ store_id: 1, status: 1 }),
      (await col('visits')).createIndex({ store_id: 1, scheduled_date: -1 }),
      (await col('visit_evidences')).createIndex({ id: 1 }, { unique: true }),
      (await col('visit_evidences')).createIndex({ visit_id: 1, stage: 1 }),
      (await col('visit_evidences')).createIndex({ store_id: 1, captured_at: -1 }),
      (await col('visit_diagnostics')).createIndex({ id: 1 }, { unique: true }),
      (await col('visit_diagnostics')).createIndex({ visit_id: 1 }, { unique: true }),
      (await col('visit_diagnostics')).createIndex({ store_id: 1, created_at: -1 }),
      (await col('occurrences')).createIndex({ store_id: 1, status: 1 }),
      (await col('occurrences')).createIndex({ visit_id: 1 }),
      (await col('replenishments')).createIndex({ store_id: 1, visit_id: 1 }),
      (await col('price_checks')).createIndex({ store_id: 1, visit_id: 1 }),
      (await col('expiry_checks')).createIndex({ store_id: 1, visit_id: 1 }),
      (await col('displays_exposures')).createIndex({ store_id: 1, visit_id: 1 }),
    ]);

    // 2. Backfill incremental em visitas antigas sem workflow_stage
    const visitsCol = await col('visits');
    await visitsCol.updateMany(
      { workflow_stage: { $exists: false }, status: 'Concluída' },
      { $set: { workflow_stage: 'CONCLUIDA' } }
    );
    await visitsCol.updateMany(
      { workflow_stage: { $exists: false }, status: 'Em Andamento' },
      { $set: { workflow_stage: 'EXECUCAO' } }
    );
    await visitsCol.updateMany(
      { workflow_stage: { $exists: false }, status: { $in: ['Pendente', 'Não Atendida'] } },
      { $set: { workflow_stage: 'IDENTIFICACAO' } }
    );
    await visitsCol.updateMany(
      { workflow_stage: { $exists: false }, status: 'Cancelada' },
      { $set: { workflow_stage: 'CANCELADA' } }
    );

    // 3. Substituir catálogo antigo pelos 409 itens limpos da planilha SI5 (executado uma única vez)
    const countersCol = await col('counters');
    const alreadyReplaced = await countersCol.findOne({ _id: 'migration_pepsico_si5_clean_v1' });
    if (!alreadyReplaced && Array.isArray(pepsicoCatalog) && pepsicoCatalog.length > 0) {
      const productsCol = await col('products');
      const brandsCol = await col('brands');

      await productsCol.deleteMany({});

      const existingBrands = await brandsCol.find({}).toArray();
      const brandByLower = new Map(existingBrands.map((b) => [String(b.name || '').trim().toLowerCase(), b.id]));
      const createdAt = nowStr();
      const docs = [];

      for (const item of pepsicoCatalog) {
        const brandName = String(item.brand || 'PepsiCo').trim();
        const bKey = brandName.toLowerCase();
        let brandId = brandByLower.get(bKey);
        if (!brandId) {
          brandId = await nextId('brands');
          await brandsCol.insertOne({ id: brandId, name: brandName, is_own: 1, color: '#1d4ed8' });
          brandByLower.set(bKey, brandId);
        }

        const id = await nextId('products');
        docs.push({
          id,
          sku: `SI5-${item.ean}`,
          ean: item.ean,
          name: item.name,
          brand_id: brandId,
          category: item.category || 'MERCEARIA',
          unit: item.unit || 'UN',
          weight: item.weight || '',
          system_price: Number(item.system_price || 0),
          ncm: item.ncm || '',
          cest_codigo: item.cest_codigo || '',
          image_url: item.image_url || '',
          min_stock: 10,
          ideal_facings: 4,
          source: 'si5',
          active: 1,
          created_at: createdAt,
        });
      }

      if (docs.length > 0) {
        await productsCol.insertMany(docs);
      }
      await countersCol.insertOne({ _id: 'migration_pepsico_si5_clean_v1', seq: docs.length, migrated_at: createdAt });
    }
  })().catch((err) => {
    migrationPromise = null;
    console.error('Erro ao executar migrations incrementais:', err.message);
  });

  return migrationPromise;
}

module.exports = { runIncrementalMigrations };
