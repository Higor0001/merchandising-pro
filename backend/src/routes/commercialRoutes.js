const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { col, nextId, nowStr, getGridFSBucket } = require('../db/database');
const { authenticate, authorize, logAudit } = require('../middleware/auth');
const { enforceVisitExecutionIntegrity } = require('../middleware/visitIntegrity');
const { upload, uploadDir, saveFileToGridFS, cleanupUploadedFile } = require('../middleware/upload');
const { analyzeShelfImage, generateStoreSummary } = require('../services/aiService');
const { applyAuditWatermark, normalizeAnnotations, renderAnnotatedImage } = require('../services/imageAnnotator');
const { sendPhotoToTelegram, sendMessageToTelegram, deleteTelegramMessage } = require('../services/telegramService');

/**
 * Baixa/recupera a imagem original em HD (Cloudinary HTTPS ou GridFS /uploads/) para um arquivo temporário local
 * para permitir re-renderização após revisão humana 100% e envio duplo ao Telegram.
 */
async function materializeImageToTemp(imageUrl, prefix = 'orig') {
  if (!imageUrl) return null;
  const filename = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
  const targetPath = path.join(uploadDir, filename);

  if (/^https?:\/\//i.test(imageUrl)) {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Não foi possível baixar imagem original (HTTP ${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(targetPath, buf);
    return targetPath;
  }

  if (imageUrl.startsWith('/uploads/')) {
    const safeName = path.basename(imageUrl);
    const localPath = path.join(uploadDir, safeName);
    if (fs.existsSync(localPath)) {
      await fs.promises.copyFile(localPath, targetPath);
      return targetPath;
    }
    const bucket = await getGridFSBucket();
    const files = await bucket.find({ filename: safeName }).limit(1).toArray();
    if (!files.length) throw new Error('Imagem original não encontrada no GridFS.');
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(targetPath);
      bucket.openDownloadStream(files[0]._id).pipe(ws).on('finish', resolve).on('error', reject);
    });
    return targetPath;
  }

  return null;
}

const router = express.Router();
router.use(authenticate);

// --- PRICE CHECKS & COMPETITOR RESEARCH ---
router.get('/prices', async (req, res, next) => {
  try {
    const { store_id, product_id } = req.query;
    const filter = {};
    if (store_id) filter.store_id = Number(store_id);
    if (product_id) filter.product_id = Number(product_id);

    const [rows, stores, products, brands, users] = await Promise.all([
      (await col('price_checks')).find(filter, { projection: { _id: 0 } }).sort({ id: -1 }).limit(120).toArray(),
      (await col('stores')).find({}).toArray(),
      (await col('products')).find({}).toArray(),
      (await col('brands')).find({}).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1, role: 1 } }).toArray(),
    ]);
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const prodMap = Object.fromEntries(products.map((p) => [p.id, p]));
    const brandMap = Object.fromEntries(brands.map((b) => [b.id, b.name]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

    res.json(
      rows.map((pc) => {
        const p = prodMap[pc.product_id] || {};
        return {
          ...pc,
          store_name: storeMap[pc.store_id] || '-',
          product_name: p.name || '-',
          sku: p.sku || '',
          brand_name: brandMap[p.brand_id] || '',
          promoter_name: userMap[pc.promoter_id] || '',
        };
      })
    );
  } catch (err) { next(err); }
});

router.post('/prices', upload.single('photo'), enforceVisitExecutionIntegrity, async (req, res, next) => {
  let wmPath = null;
  try {
    const { visit_id, store_id, product_id, gondola_price, promo_price, has_price_tag, competitor_name, competitor_price, notes } = req.body || {};
    if (!store_id || !product_id) return res.status(400).json({ error: 'Loja e produto são obrigatórios.' });

    const [product, store] = await Promise.all([
      (await col('products')).findOne({ id: Number(product_id) }),
      (await col('stores')).findOne({ id: Number(store_id) }),
    ]);
    const capturedAt = nowStr();
    const sysPrice = product ? Number(product.system_price) : 0;
    const gPrice = gondola_price !== '' && gondola_price !== undefined && gondola_price !== null ? Number(gondola_price) : null;
    const tagPresent = has_price_tag === 'false' || has_price_tag === false || has_price_tag === '0' ? 0 : 1;
    const divergent = tagPresent === 0 || (gPrice !== null && Math.abs(gPrice - sysPrice) > 0.01) ? 1 : 0;

    let persistFile = req.file;
    let tgPath = req.file ? path.join(uploadDir, req.file.filename) : null;
    if (req.file) {
      try {
        const wm = await applyAuditWatermark({
          imagePath: req.file.path,
          outputDir: uploadDir,
          storeName: store?.name,
          area: `Precificação (${product?.name || `SKU #${product_id}`})`,
          promoterName: req.user?.name,
          capturedAt,
        });
        if (wm?.watermarkedPath) {
          wmPath = wm.watermarkedPath;
          persistFile = { path: wm.watermarkedPath, filename: wm.filename, mimetype: wm.mimetype };
          tgPath = wm.watermarkedPath;
        }
      } catch {
        // fallback original
      }
    }
    const photoUrl = persistFile ? await saveFileToGridFS(persistFile) : '';

    const id = await nextId('price_checks');
    await (await col('price_checks')).insertOne({
      id,
      visit_id: visit_id ? Number(visit_id) : null,
      store_id: Number(store_id),
      product_id: Number(product_id),
      promoter_id: req.user.id,
      gondola_price: gPrice,
      system_price: sysPrice,
      promo_price: promo_price ? Number(promo_price) : null,
      has_price_tag: tagPresent,
      price_divergent: divergent,
      competitor_name: competitor_name || '',
      competitor_price: competitor_price ? Number(competitor_price) : null,
      photo_url: photoUrl,
      notes: notes || '',
      created_at: capturedAt,
    });

    if (tagPresent === 0) {
      await (await col('occurrences')).insertOne({
        id: await nextId('occurrences'),
        visit_id: visit_id ? Number(visit_id) : null,
        store_id: Number(store_id),
        product_id: Number(product_id),
        promoter_id: req.user.id,
        type: 'Falta de Preço',
        priority: 'Média',
        description: notes || 'Produto sem etiqueta de preço na gôndola.',
        photo_url: photoUrl,
        status: 'Aberta',
        resolved_at: null,
        created_at: capturedAt,
      });
    }

    if (tgPath) {
      await sendPhotoToTelegram({
        filePath: tgPath,
        reason: 'Precificação / Conferência de Etiqueta',
        storeName: store?.name,
        promoterName: req.user?.name,
        details: `Produto: ${product?.name || product_id} | Preço Gôndola: ${gPrice !== null ? `R$ ${gPrice.toFixed(2)}` : 'Sem etiqueta'}${notes ? ` | Obs: ${notes}` : ''}`,
      });
    }

    await logAudit(req.user, 'CREATE', 'price_checks', id, `Preço conferido produto #${product_id}`);
    res.status(201).json({ id, price_divergent: divergent, photo_url: photoUrl });
  } catch (err) {
    next(err);
  } finally {
    await Promise.all([cleanupUploadedFile(req.file), cleanupUploadedFile(wmPath)]);
  }
});

// --- EXPIRY & QUALITY ---
router.get('/expiries', async (_req, res, next) => {
  try {
    const [rows, stores, products, users] = await Promise.all([
      (await col('expiry_checks')).find({}, { projection: { _id: 0 } }).sort({ expiry_date: 1 }).limit(120).toArray(),
      (await col('stores')).find({}).toArray(),
      (await col('products')).find({}).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1, role: 1 } }).toArray(),
    ]);
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const prodMap = Object.fromEntries(products.map((p) => [p.id, p]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

    res.json(
      rows.map((ec) => ({
        ...ec,
        store_name: storeMap[ec.store_id] || '-',
        product_name: prodMap[ec.product_id]?.name || '-',
        sku: prodMap[ec.product_id]?.sku || '',
        promoter_name: userMap[ec.promoter_id] || '',
      }))
    );
  } catch (err) { next(err); }
});

router.post('/expiries', enforceVisitExecutionIntegrity, async (req, res, next) => {
  try {
    const { visit_id, store_id, product_id, batch_code, expiry_date, quantity, fifo_fefo_applied, condition, removal_requested, estimated_loss, notes } = req.body || {};
    if (!store_id || !product_id || !expiry_date) return res.status(400).json({ error: 'Loja, produto e data de validade são obrigatórios.' });

    const id = await nextId('expiry_checks');
    await (await col('expiry_checks')).insertOne({
      id,
      visit_id: visit_id ? Number(visit_id) : null,
      store_id: Number(store_id),
      product_id: Number(product_id),
      promoter_id: req.user.id,
      batch_code: batch_code || '',
      expiry_date,
      quantity: Number(quantity || 1),
      fifo_fefo_applied: fifo_fefo_applied === false ? 0 : 1,
      condition: condition || 'Normal',
      removal_requested: removal_requested ? 1 : 0,
      estimated_loss: Number(estimated_loss || 0),
      notes: notes || '',
      created_at: nowStr(),
    });
    await logAudit(req.user, 'CREATE', 'expiry_checks', id, `Validade ${condition || 'Normal'} registrada`);
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

// --- STORE INVENTORY ---
router.get('/inventory', async (_req, res, next) => {
  try {
    const [stockRows, movRows, stores, products, brands, users] = await Promise.all([
      (await col('store_inventory')).find({}, { projection: { _id: 0 } }).toArray(),
      (await col('inventory_movements')).find({}, { projection: { _id: 0 } }).sort({ id: -1 }).limit(80).toArray(),
      (await col('stores')).find({}).toArray(),
      (await col('products')).find({}).toArray(),
      (await col('brands')).find({}).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1, role: 1 } }).toArray(),
    ]);
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const prodMap = Object.fromEntries(products.map((p) => [p.id, p]));
    const brandMap = Object.fromEntries(brands.map((b) => [b.id, b.name]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

    const stock = stockRows.map((si) => {
      const p = prodMap[si.product_id] || {};
      return {
        ...si,
        store_name: storeMap[si.store_id] || '-',
        product_name: p.name || '-',
        sku: p.sku || '',
        min_stock: p.min_stock ?? 10,
        brand_name: brandMap[p.brand_id] || '',
        category: p.category || '',
      };
    });
    const movements = movRows.map((im) => ({
      ...im,
      store_name: storeMap[im.store_id] || '-',
      product_name: prodMap[im.product_id]?.name || '-',
      user_name: userMap[im.user_id] || '',
    }));

    res.json({ stock, movements });
  } catch (err) { next(err); }
});

router.post('/inventory/movement', async (req, res, next) => {
  try {
    const { store_id, product_id, movement_type, quantity, gondola_qty, backroom_qty, separated_for_merchandising, notes } = req.body || {};
    if (!store_id || !product_id || !movement_type) {
      return res.status(400).json({ error: 'Loja, produto e tipo de movimentação são obrigatórios.' });
    }
    const sid = Number(store_id);
    const pid = Number(product_id);
    const qty = Number(quantity || 0);
    const invCol = await col('store_inventory');
    const existing = await invCol.findOne({ store_id: sid, product_id: pid });

    let newGondola = existing ? existing.gondola_qty : 0;
    let newBackroom = existing ? existing.backroom_qty : 0;
    let newSep = existing ? existing.separated_for_merchandising : 0;

    if (movement_type === 'Entrada') newBackroom += qty;
    else if (movement_type === 'Saída') newGondola = Math.max(0, newGondola - qty);
    else if (movement_type === 'Separação Merchandising') {
      newBackroom = Math.max(0, newBackroom - qty);
      newSep += qty;
    } else if (movement_type === 'Ajuste Inventário') {
      if (gondola_qty !== undefined) newGondola = Number(gondola_qty);
      if (backroom_qty !== undefined) newBackroom = Number(backroom_qty);
      if (separated_for_merchandising !== undefined) newSep = Number(separated_for_merchandising);
    }

    await invCol.updateOne(
      { store_id: sid, product_id: pid },
      {
        $set: {
          gondola_qty: newGondola,
          backroom_qty: newBackroom,
          separated_for_merchandising: newSep,
          last_inventory_at: nowStr(),
          updated_at: nowStr(),
        },
        $setOnInsert: { id: await nextId('store_inventory') },
      },
      { upsert: true }
    );

    await (await col('inventory_movements')).insertOne({
      id: await nextId('inventory_movements'),
      store_id: sid,
      product_id: pid,
      user_id: req.user.id,
      movement_type,
      quantity: qty,
      notes: notes || '',
      created_at: nowStr(),
    });

    await logAudit(req.user, 'MOVEMENT', 'store_inventory', pid, `${movement_type} (${qty}) na loja #${sid}`);
    res.status(201).json({ success: true });
  } catch (err) { next(err); }
});

// --- CAMPAIGNS ---
router.get('/campaigns', async (_req, res, next) => {
  try {
    const [campaigns, execs, stores, users] = await Promise.all([
      (await col('campaigns')).find({}, { projection: { _id: 0 } }).sort({ start_date: -1 }).toArray(),
      (await col('campaign_executions')).find({}, { projection: { _id: 0 } }).sort({ id: -1 }).toArray(),
      (await col('stores')).find({}).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1, role: 1 } }).toArray(),
    ]);
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const campMap = Object.fromEntries(campaigns.map((c) => [c.id, c.title]));

    const executions = execs.map((ce) => ({
      ...ce,
      store_name: storeMap[ce.store_id] || '-',
      promoter_name: userMap[ce.promoter_id] || '',
      campaign_title: campMap[ce.campaign_id] || '-',
    }));
    res.json({ campaigns, executions });
  } catch (err) { next(err); }
});

router.post('/campaigns', authorize('admin', 'supervisor'), async (req, res, next) => {
  try {
    const { title, description, start_date, end_date, product_ids, store_ids, materials_needed, checklist } = req.body || {};
    if (!title || !start_date || !end_date) return res.status(400).json({ error: 'Título e período são obrigatórios.' });

    const id = await nextId('campaigns');
    await (await col('campaigns')).insertOne({
      id,
      title,
      description: description || '',
      start_date,
      end_date,
      product_ids_json: JSON.stringify(product_ids || []),
      store_ids_json: JSON.stringify(store_ids || []),
      materials_needed: materials_needed || '',
      checklist_json: JSON.stringify(checklist || []),
      status: 'Ativa',
      created_at: nowStr(),
    });
    await logAudit(req.user, 'CREATE', 'campaigns', id, `Campanha ${title} criada`);
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

router.post('/campaigns/:id/execute', upload.single('photo'), enforceVisitExecutionIntegrity, async (req, res, next) => {
  let wmPath = null;
  try {
    const cid = Number(req.params.id);
    const { store_id, visit_id, compliant, checklist_status, notes } = req.body || {};
    if (!store_id) return res.status(400).json({ error: 'Loja é obrigatória.' });

    const [store, camp] = await Promise.all([
      (await col('stores')).findOne({ id: Number(store_id) }),
      (await col('campaigns')).findOne({ id: cid }),
    ]);
    const executedAt = nowStr();
    let persistFile = req.file;
    let tgPath = req.file ? path.join(uploadDir, req.file.filename) : null;
    if (req.file) {
      try {
        const wm = await applyAuditWatermark({
          imagePath: req.file.path,
          outputDir: uploadDir,
          storeName: store?.name,
          area: `Campanha: ${camp?.title || `#${cid}`}`,
          promoterName: req.user?.name,
          capturedAt: executedAt,
        });
        if (wm?.watermarkedPath) {
          wmPath = wm.watermarkedPath;
          persistFile = { path: wm.watermarkedPath, filename: wm.filename, mimetype: wm.mimetype };
          tgPath = wm.watermarkedPath;
        }
      } catch {
        // fallback
      }
    }

    const photoUrl = persistFile ? await saveFileToGridFS(persistFile) : '';
    const id = await nextId('campaign_executions');
    await (await col('campaign_executions')).insertOne({
      id,
      campaign_id: cid,
      store_id: Number(store_id),
      visit_id: visit_id ? Number(visit_id) : null,
      promoter_id: req.user.id,
      checklist_status_json: checklist_status || '[]',
      compliant: compliant === 'false' || compliant === false ? 0 : 1,
      photo_url: photoUrl,
      notes: notes || '',
      executed_at: executedAt,
    });

    if (tgPath) {
      await sendPhotoToTelegram({
        filePath: tgPath,
        reason: `Comprovação de Campanha (${camp?.title || `#${cid}`})`,
        storeName: store?.name,
        promoterName: req.user?.name,
        details: notes || 'Campanha implantada no PDV',
      });
    }

    await logAudit(req.user, 'EXECUTE', 'campaign_executions', id, `Campanha #${cid} executada na loja #${store_id}`);
    res.status(201).json({ id, photo_url: photoUrl });
  } catch (err) {
    next(err);
  } finally {
    await Promise.all([cleanupUploadedFile(req.file), cleanupUploadedFile(wmPath)]);
  }
});

// --- OCCURRENCES ---
router.get('/occurrences', async (req, res, next) => {
  try {
    const { status, type, priority } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (priority) filter.priority = priority;

    const [rows, stores, products, users] = await Promise.all([
      (await col('occurrences')).find(filter, { projection: { _id: 0 } }).sort({ id: -1 }).toArray(),
      (await col('stores')).find({}).toArray(),
      (await col('products')).find({}).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1, role: 1 } }).toArray(),
    ]);
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const prodMap = Object.fromEntries(products.map((p) => [p.id, p.name]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

    const prioOrder = { Alta: 1, Média: 2, Baixa: 3 };
    const enriched = rows
      .map((o) => ({
        ...o,
        store_name: storeMap[o.store_id] || '-',
        product_name: prodMap[o.product_id] || '',
        promoter_name: userMap[o.promoter_id] || '',
      }))
      .sort((a, b) => (prioOrder[a.priority] || 9) - (prioOrder[b.priority] || 9));

    res.json(enriched);
  } catch (err) { next(err); }
});

router.post('/occurrences', upload.single('photo'), enforceVisitExecutionIntegrity, async (req, res, next) => {
  let wmPath = null;
  try {
    const { visit_id, store_id, product_id, type, priority, description } = req.body || {};
    if (!store_id || !type || !description) return res.status(400).json({ error: 'Loja, tipo e descrição são obrigatórios.' });

    const store = await (await col('stores')).findOne({ id: Number(store_id) });
    const createdAt = nowStr();
    let persistFile = req.file;
    let tgPath = req.file ? path.join(uploadDir, req.file.filename) : null;
    if (req.file) {
      try {
        const wm = await applyAuditWatermark({
          imagePath: req.file.path,
          outputDir: uploadDir,
          storeName: store?.name,
          area: `Ocorrência: ${type}`,
          promoterName: req.user?.name,
          capturedAt: createdAt,
        });
        if (wm?.watermarkedPath) {
          wmPath = wm.watermarkedPath;
          persistFile = { path: wm.watermarkedPath, filename: wm.filename, mimetype: wm.mimetype };
          tgPath = wm.watermarkedPath;
        }
      } catch {
        // fallback
      }
    }

    const photoUrl = persistFile ? await saveFileToGridFS(persistFile) : '';
    const id = await nextId('occurrences');
    await (await col('occurrences')).insertOne({
      id,
      visit_id: visit_id ? Number(visit_id) : null,
      store_id: Number(store_id),
      product_id: product_id ? Number(product_id) : null,
      promoter_id: req.user.id,
      type,
      priority: priority || 'Média',
      description,
      photo_url: photoUrl,
      status: 'Aberta',
      resolved_at: null,
      created_at: createdAt,
    });

    if (tgPath) {
      await sendPhotoToTelegram({
        filePath: tgPath,
        reason: `Ocorrência: ${type} (Prioridade ${priority || 'Média'})`,
        storeName: store?.name,
        promoterName: req.user?.name,
        details: description,
      });
    }

    await logAudit(req.user, 'CREATE', 'occurrences', id, `Ocorrência ${type} (${priority || 'Média'})`);
    res.status(201).json({ id, photo_url: photoUrl });
  } catch (err) {
    next(err);
  } finally {
    await Promise.all([cleanupUploadedFile(req.file), cleanupUploadedFile(wmPath)]);
  }
});

router.patch('/occurrences/:id', async (req, res, next) => {
  try {
    const oid = Number(req.params.id);
    const occCol = await col('occurrences');
    const existing = await occCol.findOne({ id: oid });
    if (!existing) return res.status(404).json({ error: 'Ocorrência não encontrada.' });

    const { status, priority } = req.body || {};
    const newStatus = status || existing.status;
    const resolvedAt = newStatus === 'Resolvida' ? nowStr() : existing.resolved_at;
    await occCol.updateOne(
      { id: oid },
      { $set: { status: newStatus, priority: priority || existing.priority, resolved_at: resolvedAt } }
    );
    await logAudit(req.user, 'UPDATE', 'occurrences', oid, `Ocorrência #${oid} alterada para ${newStatus}`);
    res.json(await occCol.findOne({ id: oid }, { projection: { _id: 0 } }));
  } catch (err) { next(err); }
});

// --- AI SHELF ANALYSIS & STORE SUMMARY ---
router.get('/ai/analyses', async (_req, res, next) => {
  try {
    const [rows, stores, users] = await Promise.all([
      (await col('ai_analyses')).find({}, { projection: { _id: 0 } }).sort({ id: -1 }).limit(50).toArray(),
      (await col('stores')).find({}).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1, role: 1 } }).toArray(),
    ]);
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
    res.json(rows.map((a) => ({ ...a, store_name: storeMap[a.store_id] || '', user_name: userMap[a.user_id] || '' })));
  } catch (err) { next(err); }
});

router.post('/ai/analyze-shelf', upload.single('photo'), async (req, res, next) => {
  let annotatedPath = null;
  let watermarkedOrigPath = null;
  try {
    const { store_id, visit_id, notes, area: requestedArea } = req.body || {};
    const imagePath = req.file ? path.join(uploadDir, req.file.filename) : null;
    const store = store_id ? await (await col('stores')).findOne({ id: Number(store_id) }) : null;
    const capturedAt = nowStr();

    const result = await analyzeShelfImage({ storeId: store_id, visitId: visit_id, imagePath, notes });
    const resolvedArea =
      requestedArea && requestedArea !== 'Auto'
        ? String(requestedArea).trim()
        : result.detected_area || 'Gôndola Principal';

    let imageUrl = '';
    let isPanoramic = Boolean(result.is_panoramic);
    if (req.file && imagePath) {
      let origToPersist = req.file;
      try {
        const wm = await applyAuditWatermark({
          imagePath,
          outputDir: uploadDir,
          storeName: store?.name,
          area: resolvedArea,
          promoterName: req.user?.name,
          capturedAt,
        });
        if (wm?.watermarkedPath) {
          watermarkedOrigPath = wm.watermarkedPath;
          origToPersist = { path: wm.watermarkedPath, filename: wm.filename, mimetype: wm.mimetype };
          if (wm.isPanoramic) isPanoramic = true;
        }
      } catch {
        // fallback original
      }
      imageUrl = await saveFileToGridFS(origToPersist);
    }

    let annotatedImageUrl = '';
    let finalAnnotations = result.annotations || [];
    if (imagePath) {
      try {
        const rendered = await renderAnnotatedImage({
          imagePath,
          annotations: finalAnnotations,
          outputDir: uploadDir,
          planogramScore: result.planogram_score,
          storeName: store?.name,
          area: resolvedArea,
          capturedAt,
        });
        if (rendered?.annotatedPath) {
          annotatedPath = rendered.annotatedPath;
          finalAnnotations = rendered.annotations;
          if (rendered.isPanoramic) isPanoramic = true;
          annotatedImageUrl = await saveFileToGridFS({
            path: rendered.annotatedPath,
            filename: rendered.filename,
            mimetype: rendered.mimetype,
          });
        }
      } catch (annotErr) {
        console.error('Erro ao renderizar imagem demarcada pela IA:', annotErr.message);
      }
    }

    const id = await nextId('ai_analyses');
    const doc = {
      id,
      visit_id: visit_id ? Number(visit_id) : null,
      store_id: store_id ? Number(store_id) : null,
      user_id: req.user.id,
      area: resolvedArea,
      is_panoramic: isPanoramic,
      image_url: imageUrl,
      annotated_image_url: annotatedImageUrl,
      annotations_json: JSON.stringify(finalAnnotations),
      detected_ruptures_json: JSON.stringify(result.detected_ruptures),
      detected_brands_json: JSON.stringify(result.detected_brands),
      exposure_issues_json: JSON.stringify(result.exposure_issues),
      planogram_score: result.planogram_score,
      suggestions_json: JSON.stringify(result.suggestions),
      extra_point_opportunities_json: JSON.stringify(result.extra_point_opportunities),
      auto_report: result.auto_report,
      confidence: result.confidence,
      self_verified: Boolean(result.self_verified),
      verification_notes: result.verification_notes || '',
      analysis_mode: result.analysis_mode || 'heuristic_fallback',
      model_used: result.model_used || '',
      human_validation: 'Pendente',
      human_notes: '',
      telegram_sent: false,
      telegram_sent_at: null,
      telegram_original_message_id: null,
      telegram_annotated_message_id: null,
      telegram_chat_id: null,
      created_at: capturedAt,
    };
    await (await col('ai_analyses')).insertOne(doc);

    await logAudit(
      req.user,
      'AI_ANALYZE',
      'ai_analyses',
      id,
      `Análise IA (${doc.analysis_mode}, área=${resolvedArea}) ${finalAnnotations.length} demarcações`
    );
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  } finally {
    await Promise.all([
      cleanupUploadedFile(req.file),
      cleanupUploadedFile(annotatedPath),
      cleanupUploadedFile(watermarkedOrigPath),
    ]);
  }
});

// Confirmar 100% as marcações (após revisão/edição visual no frontend), re-renderizar HD e enviar Original + Demarcada ao Telegram
router.post('/ai/analyses/:id/confirm-and-send', async (req, res, next) => {
  let tempOrigPath = null;
  let tempAnnotPath = null;
  try {
    const aid = Number(req.params.id);
    const aiCol = await col('ai_analyses');
    const existing = await aiCol.findOne({ id: aid });
    if (!existing) return res.status(404).json({ error: 'Análise não encontrada.' });

    const { annotations, human_notes = '', send_to_telegram = true } = req.body || {};
    const parsedExisting = (() => {
      try {
        return JSON.parse(existing.annotations_json || '[]');
      } catch {
        return [];
      }
    })();
    const finalAnnotations = Array.isArray(annotations) ? normalizeAnnotations(annotations) : parsedExisting;
    const store = existing.store_id ? await (await col('stores')).findOne({ id: Number(existing.store_id) }) : null;

    let annotatedImageUrl = existing.annotated_image_url || '';
    if (existing.image_url) {
      tempOrigPath = await materializeImageToTemp(existing.image_url, `ai-orig-${aid}`);
      if (tempOrigPath) {
        const rendered = await renderAnnotatedImage({
          imagePath: tempOrigPath,
          annotations: finalAnnotations,
          outputDir: uploadDir,
          planogramScore: existing.planogram_score,
          storeName: store?.name,
          area: existing.area || 'Gôndola Principal',
          capturedAt: existing.created_at,
        });
        if (rendered?.annotatedPath) {
          tempAnnotPath = rendered.annotatedPath;
          annotatedImageUrl = await saveFileToGridFS({
            path: rendered.annotatedPath,
            filename: rendered.filename,
            mimetype: rendered.mimetype,
          });
        }
      }
    }

    let telegramSent = Boolean(existing.telegram_sent);
    let telegramSentAt = existing.telegram_sent_at || null;
    let telegramOrigMsgId = existing.telegram_original_message_id || null;
    let telegramAnnotMsgId = existing.telegram_annotated_message_id || null;
    let telegramChatId = existing.telegram_chat_id || null;
    let telegramResults = null;

    if (send_to_telegram && tempOrigPath) {
      // Se já havia envio anterior no Telegram, apaga as mensagens antigas automaticamente ao substituir
      if (existing.telegram_original_message_id) {
        await deleteTelegramMessage({
          messageId: existing.telegram_original_message_id,
          chatId: existing.telegram_chat_id,
        });
      }
      if (existing.telegram_annotated_message_id) {
        await deleteTelegramMessage({
          messageId: existing.telegram_annotated_message_id,
          chatId: existing.telegram_chat_id,
        });
      }

      const panoTag = existing.is_panoramic ? ' [Panorâmica]' : '';
      const r1 = await sendPhotoToTelegram({
        filePath: tempOrigPath,
        reason: `Análise IA Validada 100%${panoTag} — Foto ORIGINAL (Score: ${existing.planogram_score}%)`,
        storeName: store?.name,
        promoterName: req.user?.name,
        details: `${existing.area ? `[${existing.area}] ` : ''}${existing.auto_report}${human_notes ? ` | Nota: ${human_notes}` : ''}`,
      });
      let r2 = { sent: false };
      if (tempAnnotPath) {
        const legend = finalAnnotations.length
          ? finalAnnotations.map((a, i) => `#${i + 1} [${a.category}] ${a.label}`).join(' | ')
          : 'Área geral de gôndola destacada';
        r2 = await sendPhotoToTelegram({
          filePath: tempAnnotPath,
          reason: `Análise IA Validada 100%${panoTag} — Foto DEMARCADA (${finalAnnotations.length} área(s))`,
          storeName: store?.name,
          promoterName: req.user?.name,
          details: `${existing.area ? `[${existing.area}] ` : ''}Marcações validadas: ${legend}`,
        });
      }
      telegramResults = { original: r1, annotated: r2 };
      if (r1.sent || r2.sent) {
        telegramSent = true;
        telegramSentAt = nowStr();
        telegramOrigMsgId = r1?.message_id || null;
        telegramAnnotMsgId = r2?.message_id || null;
        telegramChatId = r1?.chat_id || r2?.chat_id || null;
      }
    }

    const updatedFields = {
      annotations_json: JSON.stringify(finalAnnotations),
      annotated_image_url: annotatedImageUrl,
      human_validation: 'Confirmado',
      human_notes: String(human_notes || '').trim(),
      verified_by: req.user.id,
      verified_at: nowStr(),
      telegram_sent: telegramSent,
      telegram_sent_at: telegramSentAt,
      telegram_original_message_id: telegramOrigMsgId,
      telegram_annotated_message_id: telegramAnnotMsgId,
      telegram_chat_id: telegramChatId,
    };

    await aiCol.updateOne({ id: aid }, { $set: updatedFields });
    await logAudit(
      req.user,
      'AI_CONFIRM_SEND',
      'ai_analyses',
      aid,
      `Marcações validadas (${finalAnnotations.length} áreas) | Telegram=${telegramSent}`
    );

    const updated = await aiCol.findOne({ id: aid }, { projection: { _id: 0 } });
    res.json({ analysis: updated, telegram: telegramResults });
  } catch (err) {
    next(err);
  } finally {
    await Promise.all([cleanupUploadedFile(tempOrigPath), cleanupUploadedFile(tempAnnotPath)]);
  }
});

router.patch('/ai/analyses/:id/validate', async (req, res, next) => {
  try {
    const aid = Number(req.params.id);
    const { human_validation, human_notes } = req.body || {};
    const aiCol = await col('ai_analyses');
    const existing = await aiCol.findOne({ id: aid });
    if (!existing) return res.status(404).json({ error: 'Análise não encontrada.' });

    const updateSet = {
      human_validation: human_validation || 'Confirmado',
      human_notes: human_notes || '',
    };

    let telegramDeleted = false;
    if (updateSet.human_validation === 'Rejeitado') {
      if (existing.telegram_original_message_id) {
        const d1 = await deleteTelegramMessage({
          messageId: existing.telegram_original_message_id,
          chatId: existing.telegram_chat_id,
        });
        if (d1?.deleted) telegramDeleted = true;
      }
      if (existing.telegram_annotated_message_id) {
        const d2 = await deleteTelegramMessage({
          messageId: existing.telegram_annotated_message_id,
          chatId: existing.telegram_chat_id,
        });
        if (d2?.deleted) telegramDeleted = true;
      }
      updateSet.telegram_sent = false;
      updateSet.telegram_original_message_id = null;
      updateSet.telegram_annotated_message_id = null;
    }

    await aiCol.updateOne({ id: aid }, { $set: updateSet });
    await logAudit(
      req.user,
      'AI_VALIDATE',
      'ai_analyses',
      aid,
      `Validação humana: ${human_validation}${telegramDeleted ? ' | TG_DELETED=true' : ''}`
    );
    const updated = await aiCol.findOne({ id: aid }, { projection: { _id: 0 } });
    res.json({ ...updated, telegram_deleted: telegramDeleted });
  } catch (err) { next(err); }
});

router.get('/ai/store-summary/:storeId', async (req, res, next) => {
  try {
    const summary = await generateStoreSummary(req.params.storeId);
    if (!summary) return res.status(404).json({ error: 'Loja não encontrada.' });
    res.json(summary);
  } catch (err) { next(err); }
});

// --- DASHBOARD KPIs (projeções mínimas e contagens diretas no MongoDB) ---
router.get('/dashboard', async (_req, res, next) => {
  try {
    const [
      visits,
      checklistTotal,
      checklistDone,
      replenishments,
      occurrences,
      productsWithoutPrice,
      nearExpiry,
      extraPoints,
      campaignsExecuted,
      planograms,
      stores,
      users,
    ] = await Promise.all([
      (await col('visits'))
        .find(
          {},
          {
            projection: {
              _id: 0,
              id: 1,
              store_id: 1,
              promoter_id: 1,
              scheduled_date: 1,
              scheduled_time: 1,
              status: 1,
              duration_minutes: 1,
            },
          }
        )
        .toArray(),
      (await col('visit_checklists')).countDocuments({}),
      (await col('visit_checklists')).countDocuments({ completed: 1 }),
      (await col('replenishments')).find({}, { projection: { _id: 0, quantity_replenished: 1 } }).toArray(),
      (await col('occurrences'))
        .find({}, { projection: { _id: 0, id: 1, store_id: 1, type: 1, priority: 1, status: 1, description: 1 } })
        .toArray(),
      (await col('price_checks')).countDocuments({ has_price_tag: 0 }),
      (await col('expiry_checks')).countDocuments({ condition: { $in: ['Próximo Vencimento', 'Vencido'] } }),
      (await col('displays_exposures')).countDocuments({
        exposure_type: { $in: ['Ponto Extra', 'Ilha Promocional', 'Display', 'Ponta de Gôndola'] },
      }),
      (await col('campaign_executions')).countDocuments({ compliant: 1 }),
      (await col('planogram_audits')).find({}, { projection: { _id: 0, share_of_shelf: 1 } }).toArray(),
      (await col('stores')).find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray(),
    ]);

    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

    const storesVisited = new Set(visits.filter((v) => v.status === 'Concluída' || v.status === 'Em Andamento').map((v) => v.store_id)).size;
    const visitsDone = visits.filter((v) => v.status === 'Concluída').length;
    const visitsPending = visits.filter((v) => v.status === 'Pendente' || v.status === 'Em Andamento').length;
    const productsReplenished = replenishments.reduce((acc, r) => acc + Number(r.quantity_replenished || 0), 0);
    const rupturesIdentified = occurrences.filter((o) => o.type === 'Ruptura').length;
    const rupturesSolved = occurrences.filter((o) => o.type === 'Ruptura' && o.status === 'Resolvida').length;

    const checklistPct = checklistTotal ? Number(((checklistDone / checklistTotal) * 100).toFixed(1)) : 0;

    const shareOfShelf = planograms.length
      ? Number((planograms.reduce((acc, p) => acc + Number(p.share_of_shelf || 0), 0) / planograms.length).toFixed(1))
      : 0;
    const openOccurrences = occurrences.filter((o) => o.status !== 'Resolvida').length;

    const completedWithDur = visits.filter((v) => v.status === 'Concluída' && v.duration_minutes > 0);
    const avgVisitMinutes = completedWithDur.length
      ? Math.round(completedWithDur.reduce((acc, v) => acc + v.duration_minutes, 0) / completedWithDur.length)
      : 0;

    const recentVisits = [...visits]
      .sort((a, b) => b.id - a.id)
      .slice(0, 6)
      .map((v) => ({ ...v, store_name: storeMap[v.store_id] || '-', promoter_name: userMap[v.promoter_id] || '-' }));

    const prioOrder = { Alta: 1, Média: 2, Baixa: 3 };
    const criticalOccurrences = occurrences
      .filter((o) => o.status !== 'Resolvida')
      .sort((a, b) => (prioOrder[a.priority] || 9) - (prioOrder[b.priority] || 9) || b.id - a.id)
      .slice(0, 5)
      .map((o) => ({ ...o, store_name: storeMap[o.store_id] || '-' }));

    res.json({
      kpis: {
        storesVisited,
        visitsDone,
        visitsPending,
        productsReplenished,
        rupturesIdentified,
        rupturesSolved,
        checklistPct,
        productsWithoutPrice,
        nearExpiry,
        extraPoints,
        campaignsExecuted,
        shareOfShelf,
        openOccurrences,
        avgVisitMinutes,
      },
      recentVisits,
      criticalOccurrences,
    });
  } catch (err) { next(err); }
});

// --- REPORTS DATA ---
router.get('/reports/:type', authorize('admin', 'supervisor'), async (req, res, next) => {
  try {
    const { type } = req.params;
    const { start_date, end_date } = req.query;
    const inPeriod = (dateStr) => {
      if (!start_date && !end_date) return true;
      const day = String(dateStr || '').slice(0, 10);
      if (!day) return false;
      if (start_date && day < String(start_date)) return false;
      if (end_date && day > String(end_date)) return false;
      return true;
    };

    const [stores, users, products, brands] = await Promise.all([
      (await col('stores')).find({}).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1, role: 1 } }).toArray(),
      (await col('products')).find({}).toArray(),
      (await col('brands')).find({}).toArray(),
    ]);
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const prodMap = Object.fromEntries(products.map((p) => [p.id, p.name]));
    const brandMap = Object.fromEntries(brands.map((b) => [b.id, b.name]));

    switch (type) {
      case 'lojas':
        return res.json(stores.map((s) => ({ Loja: s.name, Tipo: s.type, Bandeira: s.banner, Rede: s.network, Região: s.region, Frequência: s.visit_frequency, Contato: s.contact_name })));
      case 'visitas': {
        const rows = (await (await col('visits')).find({}).toArray()).filter((v) => inPeriod(v.scheduled_date || v.created_at));
        return res.json(rows.map((v) => ({ Data: v.scheduled_date, Loja: storeMap[v.store_id], Promotor: userMap[v.promoter_id], Status: v.status, CheckIn: v.checkin_at, CheckOut: v.checkout_at, Minutos: v.duration_minutes })));
      }
      case 'rupturas': {
        const rows = (await (await col('occurrences')).find({}).toArray()).filter((o) => inPeriod(o.created_at));
        return res.json(rows.map((o) => ({ Data: o.created_at, Loja: storeMap[o.store_id], Produto: prodMap[o.product_id] || '-', Tipo: o.type, Prioridade: o.priority, Status: o.status, Descrição: o.description })));
      }
      case 'abastecimento': {
        const rows = (await (await col('replenishments')).find({}).toArray()).filter((r) => inPeriod(r.created_at));
        return res.json(rows.map((r) => ({ Data: r.created_at, Loja: storeMap[r.store_id], Produto: prodMap[r.product_id], Abastecido: r.quantity_replenished, Gôndola: r.gondola_stock, Retaguarda: r.backroom_stock, Status: r.status })));
      }
      case 'validade': {
        const rows = (await (await col('expiry_checks')).find({}).toArray()).filter((e) => inPeriod(e.created_at || e.expiry_date));
        return res.json(rows.map((e) => ({ Validade: e.expiry_date, Loja: storeMap[e.store_id], Produto: prodMap[e.product_id], Lote: e.batch_code, Qtd: e.quantity, Condição: e.condition, Perda_Estimada: e.estimated_loss })));
      }
      case 'precificacao':
      case 'concorrencia': {
        const rows = (await (await col('price_checks')).find({}).toArray()).filter((p) => inPeriod(p.created_at));
        return res.json(rows.map((p) => ({ Data: p.created_at, Loja: storeMap[p.store_id], Produto: prodMap[p.product_id], Preço_Gôndola: p.gondola_price, Preço_Sistema: p.system_price, Promocional: p.promo_price, Concorrente: p.competitor_name, Preço_Concorrente: p.competitor_price })));
      }
      case 'planograma': {
        const rows = (await (await col('planogram_audits')).find({}).toArray()).filter((pa) => inPeriod(pa.created_at));
        return res.json(rows.map((pa) => ({ Data: pa.created_at, Loja: storeMap[pa.store_id], Categoria: pa.category, Marca: brandMap[pa.brand_id], Ideal: pa.ideal_facings, Real: pa.actual_facings, Share_Pct: pa.share_of_shelf, Espaços_Perdidos: pa.lost_spaces })));
      }
      case 'campanhas': {
        const [execs, camps] = await Promise.all([(await col('campaign_executions')).find({}).toArray(), (await col('campaigns')).find({}).toArray()]);
        const campMap = Object.fromEntries(camps.map((c) => [c.id, c.title]));
        return res.json(execs.filter((ce) => inPeriod(ce.executed_at)).map((ce) => ({ Campanha: campMap[ce.campaign_id], Loja: storeMap[ce.store_id], Cumprida: ce.compliant, Executada_Em: ce.executed_at, Observações: ce.notes })));
      }
      case 'fotografico': {
        const [evidences, displays] = await Promise.all([
          (await col('visit_evidences')).find({ is_active: { $ne: 0 } }).sort({ id: -1 }).toArray(),
          (await col('displays_exposures')).find({}).sort({ id: -1 }).toArray(),
        ]);
        const evRows = evidences
          .filter((e) => inPeriod(e.captured_at))
          .map((e) => ({
            Data: e.captured_at,
            Loja: storeMap[e.store_id],
            Origem: `Visita #${e.visit_id} (${e.stage})`,
            Área_Categoria: e.area || '-',
            Foto: e.photo_url,
            Observações: e.caption || '',
          }));
        const dispRows = displays
          .filter((d) => inPeriod(d.created_at))
          .map((d) => ({
            Data: d.created_at,
            Loja: storeMap[d.store_id],
            Origem: `Exposição (${d.exposure_type})`,
            Área_Categoria: d.category || '-',
            Foto: [d.photo_before, d.photo_after].filter(Boolean).join(' | '),
            Observações: d.notes || '',
          }));
        return res.json([...evRows, ...dispRows]);
      }
      case 'produtividade': {
        const visits = (await (await col('visits')).find({}).toArray()).filter((v) => inPeriod(v.scheduled_date || v.created_at));
        const promoters = users.filter((u) => u.role === 'promotor');
        return res.json(promoters.map((u) => {
          const pv = visits.filter((v) => v.promoter_id === u.id);
          const done = pv.filter((v) => v.status === 'Concluída');
          const durs = done.filter((v) => v.duration_minutes > 0).map((v) => v.duration_minutes);
          const avg = durs.length ? Number((durs.reduce((a, b) => a + b, 0) / durs.length).toFixed(1)) : 0;
          return { Promotor: u.name, Total_Visitas: pv.length, Concluídas: done.length, Tempo_Médio_Min: avg };
        }));
      }
      default: {
        const rows = (await (await col('visits')).find({}).toArray()).filter((v) => inPeriod(v.scheduled_date || v.created_at));
        return res.json(rows.map((v) => ({ Data: v.scheduled_date, Loja: storeMap[v.store_id], Visita_Status: v.status, Duração_Min: v.duration_minutes, Notas: v.notes })));
      }
    }
  } catch (err) { next(err); }
});

// --- TELEGRAM TEXT DISPATCH ---
router.post('/telegram/send-message', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Texto da mensagem é obrigatório.' });
  }
  const result = await sendMessageToTelegram({ text });
  if (!result.sent) {
    return res.status(400).json({ error: result.error || 'Falha ao enviar para o Telegram.' });
  }
  await logAudit(req.user, 'TELEGRAM_TEXT', 'telegram', null, 'Lista de produtos enviada ao Telegram');
  res.json({ sent: true });
});

module.exports = router;
