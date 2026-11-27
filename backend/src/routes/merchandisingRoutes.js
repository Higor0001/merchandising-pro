const express = require('express');
const path = require('node:path');
const { col, nextId, nowStr } = require('../db/database');
const { authenticate, authorize, logAudit } = require('../middleware/auth');
const { enforceVisitExecutionIntegrity } = require('../middleware/visitIntegrity');
const { upload, uploadDir, saveFileToGridFS, cleanupUploadedFile } = require('../middleware/upload');
const { sendPhotoToTelegram } = require('../services/telegramService');
const { applyAuditWatermark } = require('../services/imageAnnotator');
const { escapeRegex } = require('../utils/security');
const {
  isSi5Configured,
  searchSi5Products,
  getSi5ProductByBarcode,
  syncSi5Catalog,
  resolveAndImportSi5Barcode,
} = require('../services/si5Service');
const { pullPepsicoFromOpenFoodFacts } = require('../services/openFoodFactsService');

const router = express.Router();
router.use(authenticate);

// --- BRANDS ---
router.get('/brands', async (_req, res, next) => {
  try {
    const brands = await (await col('brands')).find({}, { projection: { _id: 0 } }).sort({ is_own: -1, name: 1 }).toArray();
    res.json(brands);
  } catch (err) { next(err); }
});

router.post('/brands', authorize('admin', 'supervisor'), async (req, res, next) => {
  try {
    const { name, is_own, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nome da marca é obrigatório.' });
    const brandsCol = await col('brands');
    const exists = await brandsCol.findOne({ name });
    if (exists) return res.status(400).json({ error: 'Marca já cadastrada.' });
    const doc = { id: await nextId('brands'), name, is_own: is_own ? 1 : 0, color: color || '#2563eb' };
    await brandsCol.insertOne(doc);
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

// --- PRODUCTS (Somente leitura do banco local; SI5 só é chamada quando solicitada) ---
router.get('/products', async (req, res, next) => {
  try {
    const { ean, category, brand_id, q, include_inactive } = req.query;
    const productsCol = await col('products');

    const filter = {};
    if (include_inactive !== 'true') filter.active = { $ne: 0 };
    if (ean) filter.ean = ean;
    if (category) filter.category = category;
    if (brand_id) filter.brand_id = Number(brand_id);
    if (q && String(q).trim()) {
      const regex = { $regex: escapeRegex(String(q).trim()), $options: 'i' };
      filter.$or = [{ name: regex }, { ean: regex }, { sku: regex }, { category: regex }, { weight: regex }];
    }

    const [products, brands] = await Promise.all([
      productsCol.find(filter, { projection: { _id: 0 } }).sort({ name: 1 }).toArray(),
      (await col('brands')).find({}).toArray(),
    ]);
    const brandMap = Object.fromEntries(brands.map((b) => [b.id, b]));
    res.json(
      products.map((p) => ({
        ...p,
        brand_name: brandMap[p.brand_id]?.name || '',
        is_own: brandMap[p.brand_id]?.is_own ?? 1,
        brand_color: brandMap[p.brand_id]?.color || '#1d4ed8',
      }))
    );
  } catch (err) { next(err); }
});

router.post('/products', authorize('admin', 'supervisor'), async (req, res, next) => {
  try {
    const { sku, ean, name, brand_id, category, unit, weight, system_price, min_stock, ideal_facings } = req.body || {};
    if (!sku || !ean || !name || !category) {
      return res.status(400).json({ error: 'SKU, EAN, nome e categoria são obrigatórios.' });
    }
    const productsCol = await col('products');
    if (await productsCol.findOne({ $or: [{ sku }, { ean, active: { $ne: 0 } }] })) {
      return res.status(400).json({ error: 'Já existe um produto ativo cadastrado com este SKU ou EAN.' });
    }
    const id = await nextId('products');
    const doc = {
      id,
      sku,
      ean,
      name,
      brand_id: brand_id ? Number(brand_id) : null,
      category,
      unit: unit || 'UN',
      weight: String(weight || '').trim(),
      system_price: Number(system_price || 0),
      min_stock: Number(min_stock || 10),
      ideal_facings: Number(ideal_facings || 4),
      active: 1,
      created_at: nowStr(),
    };
    await productsCol.insertOne(doc);
    await logAudit(req.user, 'CREATE', 'products', id, `Produto ${name} (${sku}) cadastrado`);
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

// --- REPLENISHMENTS ---
router.get('/replenishments', async (req, res, next) => {
  try {
    const { store_id, status } = req.query;
    const filter = {};
    if (store_id) filter.store_id = Number(store_id);
    if (status) filter.status = status;

    const [rows, stores, products, brands, users] = await Promise.all([
      (await col('replenishments')).find(filter, { projection: { _id: 0 } }).sort({ id: -1 }).limit(100).toArray(),
      (await col('stores')).find({}).toArray(),
      (await col('products')).find({}).toArray(),
      (await col('brands')).find({}).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray(),
    ]);
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const prodMap = Object.fromEntries(products.map((p) => [p.id, p]));
    const brandMap = Object.fromEntries(brands.map((b) => [b.id, b.name]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

    res.json(
      rows.map((r) => {
        const p = prodMap[r.product_id] || {};
        return {
          ...r,
          store_name: storeMap[r.store_id] || '-',
          product_name: p.name || '-',
          sku: p.sku || '',
          ean: p.ean || '',
          brand_name: brandMap[p.brand_id] || '',
          promoter_name: userMap[r.promoter_id] || '',
        };
      })
    );
  } catch (err) { next(err); }
});

router.post('/replenishments', enforceVisitExecutionIntegrity, async (req, res, next) => {
  try {
    const { visit_id, store_id, product_id, quantity_replenished, backroom_stock, gondola_stock, status, increase_exposure_opportunity, notes } = req.body || {};
    if (!store_id || !product_id) return res.status(400).json({ error: 'Loja e produto são obrigatórios.' });

    const finalStatus = status || 'Abastecido';
    const id = await nextId('replenishments');
    await (await col('replenishments')).insertOne({
      id,
      visit_id: visit_id ? Number(visit_id) : null,
      store_id: Number(store_id),
      product_id: Number(product_id),
      promoter_id: req.user.id,
      quantity_replenished: Number(quantity_replenished || 0),
      backroom_stock: Number(backroom_stock || 0),
      gondola_stock: Number(gondola_stock || 0),
      status: finalStatus,
      increase_exposure_opportunity: increase_exposure_opportunity ? 1 : 0,
      notes: notes || '',
      created_at: nowStr(),
    });

    const invCol = await col('store_inventory');
    await invCol.updateOne(
      { store_id: Number(store_id), product_id: Number(product_id) },
      {
        $set: {
          gondola_qty: Number(gondola_stock || 0),
          backroom_qty: Number(backroom_stock || 0),
          updated_at: nowStr(),
        },
        $setOnInsert: {
          id: await nextId('store_inventory'),
          separated_for_merchandising: 0,
          last_inventory_at: nowStr(),
        },
      },
      { upsert: true }
    );

    if (finalStatus === 'Ruptura') {
      await (await col('occurrences')).insertOne({
        id: await nextId('occurrences'),
        visit_id: visit_id ? Number(visit_id) : null,
        store_id: Number(store_id),
        product_id: Number(product_id),
        promoter_id: req.user.id,
        type: 'Ruptura',
        priority: 'Alta',
        description: notes || 'Ruptura identificada no abastecimento.',
        photo_url: '',
        status: 'Aberta',
        resolved_at: null,
        created_at: nowStr(),
      });
    }

    await logAudit(req.user, 'CREATE', 'replenishments', id, `Abastecimento ${finalStatus} loja #${store_id}`);
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

// --- DISPLAYS & EXPOSURES ---
router.get('/displays', async (req, res, next) => {
  try {
    const { store_id, exposure_type } = req.query;
    const filter = {};
    if (store_id) filter.store_id = Number(store_id);
    if (exposure_type) filter.exposure_type = exposure_type;

    const [rows, stores, brands, products, users] = await Promise.all([
      (await col('displays_exposures')).find(filter, { projection: { _id: 0 } }).sort({ id: -1 }).limit(100).toArray(),
      (await col('stores')).find({}).toArray(),
      (await col('brands')).find({}).toArray(),
      (await col('products')).find({}, { projection: { _id: 0, id: 1, name: 1, weight: 1 } }).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray(),
    ]);
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const brandMap = Object.fromEntries(brands.map((b) => [b.id, b.name]));
    const prodMap = Object.fromEntries(products.map((p) => [p.id, p]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

    res.json(
      rows.map((d) => ({
        ...d,
        store_name: storeMap[d.store_id] || '-',
        brand_name: d.brand_id ? brandMap[d.brand_id] || '' : 'Todas',
        product_name: d.product_id ? prodMap[d.product_id]?.name || '' : 'Todos',
        promoter_name: userMap[d.promoter_id] || '',
      }))
    );
  } catch (err) { next(err); }
});

router.post(
  '/displays',
  upload.fields([{ name: 'photo_before', maxCount: 1 }, { name: 'photo_after', maxCount: 1 }]),
  enforceVisitExecutionIntegrity,
  async (req, res, next) => {
    let wmBeforePath = null;
    let wmAfterPath = null;
    try {
      const { visit_id, store_id, category, brand_id, product_id, exposure_type, facings_actual, facings_expected, planogram_compliant, pos_materials, notes } = req.body || {};
      if (!store_id || !category || !exposure_type) {
        return res.status(400).json({ error: 'Loja, categoria e tipo de exposição são obrigatórios.' });
      }
      const store = await (await col('stores')).findOne({ id: Number(store_id) });
      const capturedAt = nowStr();
      const beforeFile = req.files?.photo_before?.[0];
      const afterFile = req.files?.photo_after?.[0];

      let persistBefore = beforeFile;
      let tgBeforePath = beforeFile ? path.join(uploadDir, beforeFile.filename) : null;
      if (beforeFile) {
        try {
          const wm = await applyAuditWatermark({
            imagePath: beforeFile.path,
            outputDir: uploadDir,
            storeName: store?.name,
            area: exposure_type,
            stage: 'INICIAL',
            promoterName: req.user?.name,
            capturedAt,
          });
          if (wm?.watermarkedPath) {
            wmBeforePath = wm.watermarkedPath;
            persistBefore = { path: wm.watermarkedPath, filename: wm.filename, mimetype: wm.mimetype };
            tgBeforePath = wm.watermarkedPath;
          }
        } catch {
          // fallback original
        }
      }

      let persistAfter = afterFile;
      let tgAfterPath = afterFile ? path.join(uploadDir, afterFile.filename) : null;
      if (afterFile) {
        try {
          const wm = await applyAuditWatermark({
            imagePath: afterFile.path,
            outputDir: uploadDir,
            storeName: store?.name,
            area: exposure_type,
            stage: 'FINAL',
            promoterName: req.user?.name,
            capturedAt,
          });
          if (wm?.watermarkedPath) {
            wmAfterPath = wm.watermarkedPath;
            persistAfter = { path: wm.watermarkedPath, filename: wm.filename, mimetype: wm.mimetype };
            tgAfterPath = wm.watermarkedPath;
          }
        } catch {
          // fallback original
        }
      }

      const photoBefore = persistBefore ? await saveFileToGridFS(persistBefore) : '';
      const photoAfter = persistAfter ? await saveFileToGridFS(persistAfter) : '';

      const id = await nextId('displays_exposures');
      await (await col('displays_exposures')).insertOne({
        id,
        visit_id: visit_id ? Number(visit_id) : null,
        store_id: Number(store_id),
        promoter_id: req.user.id,
        category,
        brand_id: brand_id ? Number(brand_id) : null,
        product_id: product_id ? Number(product_id) : null,
        exposure_type,
        facings_actual: Number(facings_actual || 0),
        facings_expected: Number(facings_expected || 0),
        planogram_compliant: planogram_compliant === 'false' || planogram_compliant === false || planogram_compliant === '0' ? 0 : 1,
        pos_materials: pos_materials || '',
        photo_before: photoBefore,
        photo_after: photoAfter,
        notes: notes || '',
        created_at: capturedAt,
      });

      const details = `Categoria: ${category} | Frentes: ${facings_actual || 0}/${facings_expected || 0}${pos_materials ? ` | Materiais: ${pos_materials}` : ''}${notes ? ` | Obs: ${notes}` : ''}`;

      if (tgBeforePath) {
        await sendPhotoToTelegram({
          filePath: tgBeforePath,
          reason: `Exposição (${exposure_type}) — Foto ANTES`,
          storeName: store?.name,
          promoterName: req.user?.name,
          details,
        });
      }
      if (tgAfterPath) {
        await sendPhotoToTelegram({
          filePath: tgAfterPath,
          reason: `Exposição (${exposure_type}) — Foto DEPOIS`,
          storeName: store?.name,
          promoterName: req.user?.name,
          details,
        });
      }

      await logAudit(req.user, 'CREATE', 'displays_exposures', id, `Exposição ${exposure_type} registrada`);
      res.status(201).json({ id, photo_before: photoBefore, photo_after: photoAfter });
    } catch (err) {
      next(err);
    } finally {
      await Promise.all([
        cleanupUploadedFile(req.files?.photo_before?.[0]),
        cleanupUploadedFile(req.files?.photo_after?.[0]),
        cleanupUploadedFile(wmBeforePath),
        cleanupUploadedFile(wmAfterPath),
      ]);
    }
  }
);

// --- PLANOGRAMS & SHARE OF SHELF ---
router.get('/planograms', async (_req, res, next) => {
  try {
    const [audits, stores, brands, products] = await Promise.all([
      (await col('planogram_audits')).find({}, { projection: { _id: 0 } }).sort({ id: -1 }).limit(100).toArray(),
      (await col('stores')).find({}).toArray(),
      (await col('brands')).find({}).toArray(),
      (await col('products')).find({}).toArray(),
    ]);
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const brandMap = Object.fromEntries(brands.map((b) => [b.id, b]));
    const prodMap = Object.fromEntries(products.map((p) => [p.id, p.name]));

    const rows = audits.map((pa) => ({
      ...pa,
      store_name: storeMap[pa.store_id] || '-',
      brand_name: brandMap[pa.brand_id]?.name || '-',
      is_own: brandMap[pa.brand_id]?.is_own ?? 1,
      product_name: prodMap[pa.product_id] || '-',
    }));

    const brandAgg = {};
    const catAgg = {};
    const storeAgg = {};
    for (const r of rows) {
      if (!brandAgg[r.brand_name]) brandAgg[r.brand_name] = { brand_name: r.brand_name, is_own: r.is_own, sum: 0, count: 0, total_facings: 0, total_lost: 0 };
      brandAgg[r.brand_name].sum += Number(r.share_of_shelf || 0);
      brandAgg[r.brand_name].count++;
      brandAgg[r.brand_name].total_facings += Number(r.actual_facings || 0);
      brandAgg[r.brand_name].total_lost += Number(r.lost_spaces || 0);

      if (!catAgg[r.category]) catAgg[r.category] = { category: r.category, sum: 0, count: 0, total_facings: 0, competitor_facings: 0 };
      catAgg[r.category].sum += Number(r.share_of_shelf || 0);
      catAgg[r.category].count++;
      catAgg[r.category].total_facings += Number(r.actual_facings || 0);
      catAgg[r.category].competitor_facings += Number(r.competitor_facings || 0);

      if (!storeAgg[r.store_name]) storeAgg[r.store_name] = { store_name: r.store_name, sum: 0, compSum: 0, count: 0 };
      storeAgg[r.store_name].sum += Number(r.share_of_shelf || 0);
      storeAgg[r.store_name].compSum += Number(r.compliant || 0);
      storeAgg[r.store_name].count++;
    }

    const byBrand = Object.values(brandAgg).map((b) => ({
      brand_name: b.brand_name,
      is_own: b.is_own,
      avg_share: Number((b.sum / b.count).toFixed(1)),
      total_facings: b.total_facings,
      total_lost: b.total_lost,
    }));
    const byCategory = Object.values(catAgg).map((c) => ({
      category: c.category,
      avg_share: Number((c.sum / c.count).toFixed(1)),
      total_facings: c.total_facings,
      competitor_facings: c.competitor_facings,
    }));
    const byStore = Object.values(storeAgg).map((s) => ({
      store_name: s.store_name,
      avg_share: Number((s.sum / s.count).toFixed(1)),
      compliance_pct: Number(((s.compSum / s.count) * 100).toFixed(1)),
    }));

    res.json({ rows, indicators: { byBrand, byCategory, byStore } });
  } catch (err) { next(err); }
});

router.post('/planograms', enforceVisitExecutionIntegrity, async (req, res, next) => {
  try {
    const { visit_id, store_id, category, brand_id, product_id, ideal_facings, actual_facings, total_category_facings, competitor_facings, position_level, notes } = req.body || {};
    if (!store_id || !category) return res.status(400).json({ error: 'Loja e categoria são obrigatórias.' });

    const ideal = Number(ideal_facings || 4);
    const actual = Number(actual_facings || 0);
    const total = Math.max(1, Number(total_category_facings || actual + Number(competitor_facings || 0) || 1));
    const share = Number(((actual / total) * 100).toFixed(1));
    const lost = Math.max(0, ideal - actual);
    const compliant = actual >= ideal ? 1 : 0;

    const id = await nextId('planogram_audits');
    await (await col('planogram_audits')).insertOne({
      id,
      visit_id: visit_id ? Number(visit_id) : null,
      store_id: Number(store_id),
      category,
      brand_id: brand_id ? Number(brand_id) : null,
      product_id: product_id ? Number(product_id) : null,
      ideal_facings: ideal,
      actual_facings: actual,
      total_category_facings: total,
      competitor_facings: Number(competitor_facings || 0),
      lost_spaces: lost,
      position_level: position_level || 'Olhos',
      share_of_shelf: share,
      compliant,
      notes: notes || '',
      created_at: nowStr(),
    });

    await logAudit(req.user, 'CREATE', 'planogram_audits', id, `Planograma ${category} share=${share}%`);
    res.status(201).json({ id, share_of_shelf: share, lost_spaces: lost, compliant });
  } catch (err) { next(err); }
});

// --- SI5 GLOBAL API INTEGRATION ---
router.get('/si5/search', async (req, res) => {
  try {
    const { q = '', page = 1, per_page = 12 } = req.query;
    const result = await searchSi5Products({ q, page, per_page });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/si5/barcode/:codbar', async (req, res) => {
  try {
    const result = await getSi5ProductByBarcode(req.params.codbar);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/si5/sync', authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { q = '', pages = 2, per_page = 100, full = false } = req.body || {};
    const result = await syncSi5Catalog({
      q: String(q),
      pages: Math.min(100, Math.max(1, Number(pages || 2))),
      per_page: Math.min(100, Math.max(10, Number(per_page || 100))),
      full: Boolean(full),
    });
    await logAudit(req.user, 'SI5_SYNC', 'products', null, `Sincronização SI5 (${result.pages_fetched} pág): ${result.inserted} novos, ${result.updated} atualizados`);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/si5/full-pull', authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { q = '' } = req.body || {};
    const result = await syncSi5Catalog({ q: String(q), full: true, per_page: 100 });
    await logAudit(req.user, 'SI5_FULL_PULL', 'products', null, `Puxada completa SI5 (${result.pages_fetched} páginas): ${result.inserted} novos, ${result.updated} atualizados`);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/si5/resolve-ean', async (req, res) => {
  try {
    const { ean } = req.body || {};
    const result = await resolveAndImportSi5Barcode(ean);
    if (result.from_si5) {
      await logAudit(req.user, 'SI5_RESOLVE_EAN', 'products', result.product.id, `Produto ${result.product.name} (${ean}) importado via SI5`);
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Busca na SI5 por texto ou EAN, já salva tudo no banco local e retorna os produtos completos
router.post('/si5/search-and-cache', async (req, res) => {
  try {
    const { q = '', per_page = 20 } = req.body || {};
    const query = String(q).trim();
    if (!query) return res.status(400).json({ error: 'Informe um nome ou código EAN para buscar na SI5.' });

    if (/^\d{8,14}$/.test(query)) {
      const resolved = await resolveAndImportSi5Barcode(query);
      return res.json({ products: [resolved.product], from_si5: resolved.from_si5 });
    }

    const result = await syncSi5Catalog({ q: query, pages: 1, per_page: Math.min(50, Number(per_page || 20)) });
    res.json({ products: result.products, inserted: result.inserted, updated: result.updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- OPEN FOOD FACTS (CARGA GRATUITA CATÁLOGO PEPSICO) ---
router.post('/openfoodfacts/pull-pepsico', authorize('admin', 'supervisor'), async (req, res, next) => {
  try {
    const result = await pullPepsicoFromOpenFoodFacts();
    await logAudit(req.user, 'OFF_PULL_PEPSICO', 'products', null, `Carga Open Food Facts PepsiCo: ${result.inserted} novos, ${result.updated} atualizados`);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/si5/import', async (req, res, next) => {
  try {
    const { codbar, produto, marca, categoria, embalagem, preco_medio, target_product_id } = req.body || {};
    if (!codbar || !produto) {
      return res.status(400).json({ error: 'Código de barras (codbar) e nome do produto são obrigatórios.' });
    }

    const productsCol = await col('products');
    if (target_product_id) {
      const tid = Number(target_product_id);
      const existing = await productsCol.findOne({ id: tid });
      if (!existing) return res.status(404).json({ error: 'Produto destino não encontrado.' });
      await productsCol.updateOne(
        { id: tid },
        {
          $set: {
            ean: String(codbar),
            system_price: Number(preco_medio || 0) || existing.system_price,
          },
        }
      );
      await logAudit(req.user, 'SI5_UPDATE_EAN', 'products', tid, `EAN ${codbar} vinculado via SI5 Global`);
      return res.json(await productsCol.findOne({ id: tid }, { projection: { _id: 0 } }));
    }

    const brandsCol = await col('brands');
    let brandId = null;
    if (marca) {
      const existingBrand = await brandsCol.findOne({ name: { $regex: `^${escapeRegex(marca.trim())}$`, $options: 'i' } });
      if (existingBrand) {
        brandId = existingBrand.id;
      } else {
        brandId = await nextId('brands');
        await brandsCol.insertOne({ id: brandId, name: marca.trim(), is_own: 1, color: '#1d4ed8' });
      }
    }

    if (await productsCol.findOne({ ean: String(codbar) })) {
      return res.status(400).json({ error: 'Já existe um produto cadastrado com este EAN.' });
    }

    const id = await nextId('products');
    const doc = {
      id,
      sku: `SI5-${String(codbar)}`,
      ean: String(codbar),
      name: produto,
      brand_id: brandId,
      category: categoria || 'Geral',
      unit: embalagem || 'UN',
      system_price: Number(preco_medio || 0),
      min_stock: 10,
      ideal_facings: 4,
      active: 1,
      created_at: nowStr(),
    };
    await productsCol.insertOne(doc);
    await logAudit(req.user, 'SI5_IMPORT', 'products', id, `Produto ${produto} (${codbar}) importado via SI5 Global`);
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

module.exports = router;
