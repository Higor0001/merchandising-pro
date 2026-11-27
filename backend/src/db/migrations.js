const { col, nextId, nowStr } = require('./database');

let cachedCatalog = null;
function getPepsicoCatalog() {
  if (!cachedCatalog) {
    cachedCatalog = require('./pepsico_catalog_si5.json');
  }
  return cachedCatalog;
}

let migrationPromise = null;

/**
 * Executa migrations incrementais no MongoDB de forma idempotente,
 * preservando 100% dos dados e estruturas existentes.
 */
async function runIncrementalMigrations() {
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    const countersCol = await col('counters');
    const doneFlags = await countersCol
      .find({
        _id: {
          $in: [
            'migration_indexes_v1',
            'migration_pepsico_si5_clean_v1',
            'migration_pepsico_catalog_v2',
            'migration_dedup_pepsico_v3',
            'migration_clear_history_site_only_v1',
            'migration_clean_pack_names_v4',
            'migration_uppercase_products_v5',
          ],
        },
      })
      .toArray();
    const doneSet = new Set(doneFlags.map((d) => d._id));

    // 1. Índices para integridade referencial lógica e performance store-centric (1 única vez)
    if (!doneSet.has('migration_indexes_v1')) {
      await Promise.all([
        (await col('users')).createIndex({ id: 1 }, { unique: true }),
        (await col('users')).createIndex({ email: 1 }, { unique: true }),
        (await col('brands')).createIndex({ id: 1 }, { unique: true }),
        (await col('products')).createIndex({ id: 1 }, { unique: true }),
        (await col('products')).createIndex({ ean: 1 }),
        (await col('products')).createIndex({ active: 1, name: 1 }),
        (await col('stores')).createIndex({ id: 1 }, { unique: true }),
        (await col('visits')).createIndex({ id: 1 }, { unique: true }),
        (await col('visits')).createIndex({ store_id: 1, status: 1 }),
        (await col('visits')).createIndex({ store_id: 1, scheduled_date: -1 }),
        (await col('visit_checklists')).createIndex({ visit_id: 1 }),
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
        (await col('store_inventory')).createIndex({ store_id: 1, product_id: 1 }),
      ]);

      // 2. Backfill incremental em visitas antigas sem workflow_stage
      const visitsCol = await col('visits');
      await Promise.all([
        visitsCol.updateMany(
          { workflow_stage: { $exists: false }, status: 'Concluída' },
          { $set: { workflow_stage: 'CONCLUIDA' } }
        ),
        visitsCol.updateMany(
          { workflow_stage: { $exists: false }, status: 'Em Andamento' },
          { $set: { workflow_stage: 'EXECUCAO' } }
        ),
        visitsCol.updateMany(
          { workflow_stage: { $exists: false }, status: { $in: ['Pendente', 'Não Atendida'] } },
          { $set: { workflow_stage: 'IDENTIFICACAO' } }
        ),
        visitsCol.updateMany(
          { workflow_stage: { $exists: false }, status: 'Cancelada' },
          { $set: { workflow_stage: 'CANCELADA' } }
        ),
      ]);

      await countersCol.updateOne(
        { _id: 'migration_indexes_v1' },
        { $set: { seq: 1, migrated_at: nowStr() } },
        { upsert: true }
      );
    }

    // 3. Substituir catálogo antigo pelos itens limpos da planilha SI5 (executado uma única vez)
    const alreadyReplaced = doneSet.has('migration_pepsico_si5_clean_v1');
    if (!alreadyReplaced) {
      const pepsicoCatalog = getPepsicoCatalog();
      if (Array.isArray(pepsicoCatalog) && pepsicoCatalog.length > 0) {
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
    }

    // 4. Atualização do catálogo PepsiCo v2 em lote (bulkWrite < 1s): padroniza marcas/categorias, preenche gramaturas e adiciona novos SKUs recentes preservando IDs existentes
    const alreadyUpdatedV2 = doneSet.has('migration_pepsico_catalog_v2');
    if (!alreadyUpdatedV2) {
      const pepsicoCatalog = getPepsicoCatalog();
      if (Array.isArray(pepsicoCatalog) && pepsicoCatalog.length > 0) {
      const productsCol = await col('products');
      const brandsCol = await col('brands');
      const migratedAt = nowStr();

      const existingBrands = await brandsCol.find({}).toArray();
      const brandByLower = new Map(existingBrands.map((b) => [String(b.name || '').trim().toLowerCase(), b]));

      const ensureBrand = async (brandName) => {
        const cleanName = String(brandName || 'PepsiCo').trim();
        const key = cleanName.toLowerCase();
        const found = brandByLower.get(key);
        if (found) return found.id;
        const id = await nextId('brands');
        const doc = { id, name: cleanName, is_own: 1, color: '#1d4ed8' };
        await brandsCol.insertOne(doc);
        brandByLower.set(key, doc);
        return id;
      };

      // Unificar grafias antigas de marcas (Lays -> Lay’s, Pingo dOuro -> Pingo d’Ouro)
      const brandAliases = [
        ['lays', 'Lay’s'],
        ["lay's", 'Lay’s'],
        ['pingo douro', 'Pingo d’Ouro'],
        ["pingo d'ouro", 'Pingo d’Ouro'],
      ];
      for (const [oldLower, canonicalName] of brandAliases) {
        const oldBrand = brandByLower.get(oldLower);
        if (oldBrand && oldBrand.name !== canonicalName) {
          const canonicalId = await ensureBrand(canonicalName);
          if (canonicalId !== oldBrand.id) {
            await productsCol.updateMany({ brand_id: oldBrand.id }, { $set: { brand_id: canonicalId } });
            await brandsCol.deleteOne({ id: oldBrand.id });
            brandByLower.delete(oldLower);
          }
        }
      }

      // Garantir todas as marcas necessárias antes do bulkWrite (no máximo ~24 marcas)
      const uniqueBrandNames = [...new Set(pepsicoCatalog.map((i) => String(i.brand || 'PepsiCo').trim()))];
      for (const bName of uniqueBrandNames) {
        await ensureBrand(bName);
      }

      // 1 única consulta para mapear todos os produtos existentes por EAN
      const existingProducts = await productsCol
        .find(
          {},
          { projection: { _id: 0, id: 1, ean: 1, name: 1, category: 1, unit: 1, weight: 1, ncm: 1, cest_codigo: 1, image_url: 1 } }
        )
        .toArray();
      const existingByEan = new Map(existingProducts.map((p) => [String(p.ean || '').trim(), p]));

      const validItems = pepsicoCatalog.filter((item) => {
        const ean = String(item.ean || '').trim();
        return Boolean(ean && ean !== 'A CONFERIR');
      });

      const newItems = validItems.filter((item) => !existingByEan.has(String(item.ean || '').trim()));

      // Reservar bloco contínuo de IDs em 1 única operação atômica
      let nextNewId = 1;
      if (newItems.length > 0) {
        const maxExistingId = existingProducts.reduce((acc, p) => Math.max(acc, Number(p.id || 0)), 0);
        const curCounter = await countersCol.findOne({ _id: 'products' });
        const baseSeq = Math.max(maxExistingId, Number(curCounter?.seq || 0));
        const newEndSeq = baseSeq + newItems.length;
        await countersCol.updateOne({ _id: 'products' }, { $set: { seq: newEndSeq } }, { upsert: true });
        nextNewId = baseSeq + 1;
      }

      const bulkOps = [];
      for (const item of validItems) {
        const ean = String(item.ean || '').trim();
        const brandName = String(item.brand || 'PepsiCo').trim();
        const brandId = brandByLower.get(brandName.toLowerCase())?.id ?? null;
        const existing = existingByEan.get(ean);

        if (existing) {
          bulkOps.push({
            updateOne: {
              filter: { id: existing.id },
              update: {
                $set: {
                  name: item.name || existing.name,
                  brand_id: brandId,
                  category: item.category || existing.category || 'SNACKS & SALGADINHOS',
                  unit: item.unit || existing.unit || 'UN',
                  weight: item.weight || existing.weight || '',
                  ncm: item.ncm || existing.ncm || '',
                  cest_codigo: item.cest_codigo || existing.cest_codigo || '',
                  image_url: item.image_url || existing.image_url || '',
                  active: 1,
                  updated_at: migratedAt,
                },
              },
            },
          });
        } else {
          const id = nextNewId++;
          bulkOps.push({
            insertOne: {
              document: {
                id,
                sku: `PEP-${ean}`,
                ean,
                name: item.name,
                brand_id: brandId,
                category: item.category || 'SNACKS & SALGADINHOS',
                unit: item.unit || 'UN',
                weight: item.weight || '',
                system_price: Number(item.system_price || 0),
                ncm: item.ncm || '',
                cest_codigo: item.cest_codigo || '',
                image_url: item.image_url || '',
                min_stock: 10,
                ideal_facings: 4,
                source: item.source || 'pepsico_catalog_v2',
                active: 1,
                created_at: migratedAt,
                updated_at: migratedAt,
              },
            },
          });
        }
      }

      if (bulkOps.length > 0) {
        await productsCol.bulkWrite(bulkOps, { ordered: false });
      }

      await productsCol.updateMany(
        { ean: 'A CONFERIR', active: { $ne: 0 } },
        { $set: { active: 0, deactivated_reason: 'Substituído pelo catálogo PepsiCo v2' } }
      );

      await countersCol.updateOne(
        { _id: 'migration_pepsico_catalog_v2' },
        { $set: { seq: bulkOps.length, migrated_at: migratedAt } },
        { upsert: true }
      );
      }
    }

    // 5. Remoção de produtos repetidos / kits / DUN-14 duplicados no MongoDB em lote (< 0.5s), preservando IDs dos itens canônicos
    const alreadyDedupedV3 = doneSet.has('migration_dedup_pepsico_v3');
    if (!alreadyDedupedV3) {
      const pepsicoCatalog = getPepsicoCatalog();
      if (Array.isArray(pepsicoCatalog) && pepsicoCatalog.length > 0) {
      const productsCol = await col('products');
      const migratedAt = nowStr();
      const canonicalByEan = new Map(pepsicoCatalog.map((item) => [String(item.ean || '').trim(), item]));

      const allActive = await productsCol
        .find(
          { active: { $ne: 0 } },
          { projection: { _id: 0, id: 1, ean: 1, name: 1, brand_id: 1, weight: 1, source: 1 } }
        )
        .toArray();

      const seenEans = new Set();
      const seenNameKey = new Set();
      const bulkOps = [];
      let deactivatedCount = 0;

      // Ordenar para priorizar registros que batem com o catálogo canônico e IDs menores (mais antigos/referenciados)
      allActive.sort((a, b) => {
        const aCanon = canonicalByEan.has(String(a.ean || '').trim()) ? 1 : 0;
        const bCanon = canonicalByEan.has(String(b.ean || '').trim()) ? 1 : 0;
        if (bCanon !== aCanon) return bCanon - aCanon;
        return Number(a.id || 0) - Number(b.id || 0);
      });

      const normSimple = (s) =>
        String(s || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

      for (const prod of allActive) {
        const ean = String(prod.ean || '').trim();
        const canonical = canonicalByEan.get(ean);
        const isCatalogSource = !prod.source || ['si5', 'pepsico_catalog_v2', 'pepsico_2026', 'openfoodfacts'].includes(prod.source);
        const nameKey = `${prod.brand_id || 0}||${normSimple(prod.name)}||${normSimple(prod.weight)}`;

        // Desativar se: EAN duplicado no banco, OU item de catálogo removido na deduplicação, OU nome+marca+gramatura idênticos
        if ((ean && seenEans.has(ean)) || (isCatalogSource && !canonical) || seenNameKey.has(nameKey)) {
          bulkOps.push({
            updateOne: {
              filter: { id: prod.id },
              update: {
                $set: {
                  active: 0,
                  deactivated_reason: 'Produto duplicado removido (limpeza v3)',
                  updated_at: migratedAt,
                },
              },
            },
          });
          deactivatedCount++;
          continue;
        }

        if (ean) seenEans.add(ean);
        seenNameKey.add(nameKey);

        if (canonical && (canonical.weight !== prod.weight || canonical.name !== prod.name)) {
          bulkOps.push({
            updateOne: {
              filter: { id: prod.id },
              update: {
                $set: {
                  name: canonical.name,
                  weight: canonical.weight || prod.weight || '',
                  updated_at: migratedAt,
                },
              },
            },
          });
        }
      }

      if (bulkOps.length > 0) {
        await productsCol.bulkWrite(bulkOps, { ordered: false });
      }

      await countersCol.updateOne(
        { _id: 'migration_dedup_pepsico_v3' },
        { $set: { seq: deactivatedCount, migrated_at: migratedAt } },
        { upsert: true }
      );
      }
    }

    // 6. Limpeza pontual do histórico operacional e fotos APENAS no site/MongoDB (mantendo 100% no Telegram)
    const alreadyClearedHistoryV1 = doneSet.has('migration_clear_history_site_only_v1');
    if (!alreadyClearedHistoryV1) {
      const clearedAt = nowStr();
      const collectionsToClear = [
        'visits',
        'visit_evidences',
        'visit_diagnostics',
        'visit_checklists',
        'replenishments',
        'occurrences',
        'price_checks',
        'expiry_checks',
        'displays_exposures',
        'planogram_audits',
        'campaign_executions',
        'store_inventory',
        'inventory_movements',
        'ai_analyses',
        'uploads.files',
        'uploads.chunks',
      ];
      await Promise.all(
        collectionsToClear.map(async (name) => {
          try {
            await (await col(name)).deleteMany({});
          } catch {
            // ignorar se coleção ainda não existir
          }
        })
      );
      await countersCol.updateOne(
        { _id: 'migration_clear_history_site_only_v1' },
        { $set: { seq: collectionsToClear.length, migrated_at: clearedAt } },
        { upsert: true }
      );
    }

    // 7. Remoção de combos/kits/caixas/fardos com quantitativo no nome e padronização para apenas produto + gramatura (bulkWrite < 0.3s)
    const alreadyCleanedPacksV4 = doneSet.has('migration_clean_pack_names_v4');
    if (!alreadyCleanedPacksV4) {
      const pepsicoCatalog = getPepsicoCatalog();
      if (Array.isArray(pepsicoCatalog) && pepsicoCatalog.length > 0) {
        const productsCol = await col('products');
        const migratedAt = nowStr();
        const canonicalByEan = new Map(pepsicoCatalog.map((item) => [String(item.ean || '').trim(), item]));

        const allActive = await productsCol
          .find({ active: { $ne: 0 } }, { projection: { _id: 0, id: 1, ean: 1, name: 1, weight: 1, source: 1 } })
          .toArray();

        const bulkOps = [];
        let affected = 0;

        for (const prod of allActive) {
          const ean = String(prod.ean || '').trim();
          const canonical = canonicalByEan.get(ean);
          const isCatalogSource =
            !prod.source || ['si5', 'pepsico_catalog_v2', 'pepsico_2026', 'openfoodfacts'].includes(prod.source);

          if (isCatalogSource && !canonical) {
            bulkOps.push({
              updateOne: {
                filter: { id: prod.id },
                update: {
                  $set: {
                    active: 0,
                    deactivated_reason: 'Combo/Kit/Caixa de atacado removido (limpeza v4)',
                    updated_at: migratedAt,
                  },
                },
              },
            });
            affected++;
          } else if (canonical && (canonical.name !== prod.name || (canonical.weight || '') !== (prod.weight || ''))) {
            bulkOps.push({
              updateOne: {
                filter: { id: prod.id },
                update: {
                  $set: {
                    name: canonical.name,
                    weight: canonical.weight || prod.weight || '',
                    updated_at: migratedAt,
                  },
                },
              },
            });
            affected++;
          }
        }

        if (bulkOps.length > 0) {
          await productsCol.bulkWrite(bulkOps, { ordered: false });
        }

        await countersCol.updateOne(
          { _id: 'migration_clean_pack_names_v4' },
          { $set: { seq: affected, migrated_at: migratedAt } },
          { upsert: true }
        );
      }
    }

    // 8. Padronização de todos os nomes de produtos em CAIXA ALTA (bulkWrite < 0.3s)
    const alreadyUpperV5 = doneSet.has('migration_uppercase_products_v5');
    if (!alreadyUpperV5) {
      const productsCol = await col('products');
      const migratedAt = nowStr();
      const allProducts = await productsCol
        .find({}, { projection: { _id: 0, id: 1, name: 1 } })
        .toArray();

      const bulkOps = [];
      for (const prod of allProducts) {
        const cleanUpper = String(prod.name || '')
          .trim()
          .replace(/\s+/g, ' ')
          .toLocaleUpperCase('pt-BR');
        if (cleanUpper && cleanUpper !== prod.name) {
          bulkOps.push({
            updateOne: {
              filter: { id: prod.id },
              update: {
                $set: {
                  name: cleanUpper,
                  updated_at: migratedAt,
                },
              },
            },
          });
        }
      }

      if (bulkOps.length > 0) {
        await productsCol.bulkWrite(bulkOps, { ordered: false });
      }

      await countersCol.updateOne(
        { _id: 'migration_uppercase_products_v5' },
        { $set: { seq: bulkOps.length, migrated_at: migratedAt } },
        { upsert: true }
      );
    }
  })().catch((err) => {
    migrationPromise = null;
    console.error('Erro ao executar migrations incrementais:', err.message);
    throw err;
  });

  return migrationPromise;
}

module.exports = { runIncrementalMigrations };
