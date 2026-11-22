const express = require('express');
const path = require('node:path');
const { col, nextId, nowStr } = require('../db/database');
const { authenticate, logAudit } = require('../middleware/auth');
const { enforceVisitExecutionIntegrity } = require('../middleware/visitIntegrity');
const { upload, uploadDir, saveFileToGridFS } = require('../middleware/upload');
const { analyzeShelfImage, generateStoreSummary } = require('../services/aiService');
const { sendPhotoToTelegram, sendMessageToTelegram } = require('../services/telegramService');

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
      (await col('users')).find({}).toArray(),
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
  try {
    const { visit_id, store_id, product_id, gondola_price, promo_price, has_price_tag, competitor_name, competitor_price, notes } = req.body || {};
    if (!store_id || !product_id) return res.status(400).json({ error: 'Loja e produto são obrigatórios.' });

    const product = await (await col('products')).findOne({ id: Number(product_id) });
    const sysPrice = product ? Number(product.system_price) : 0;
    const gPrice = gondola_price !== '' && gondola_price !== undefined && gondola_price !== null ? Number(gondola_price) : null;
    const tagPresent = has_price_tag === 'false' || has_price_tag === false || has_price_tag === '0' ? 0 : 1;
    const divergent = tagPresent === 0 || (gPrice !== null && Math.abs(gPrice - sysPrice) > 0.01) ? 1 : 0;
    const photoUrl = req.file ? await saveFileToGridFS(req.file) : '';

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
      created_at: nowStr(),
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
        created_at: nowStr(),
      });
    }

    if (req.file) {
      const store = await (await col('stores')).findOne({ id: Number(store_id) });
      await sendPhotoToTelegram({
        filePath: path.join(uploadDir, req.file.filename),
        reason: 'Precificação / Conferência de Etiqueta',
        storeName: store?.name,
        promoterName: req.user?.name,
        details: `Produto: ${product?.name || product_id} | Preço Gôndola: ${gPrice !== null ? `R$ ${gPrice.toFixed(2)}` : 'Sem etiqueta'}${notes ? ` | Obs: ${notes}` : ''}`,
      });
    }

    await logAudit(req.user, 'CREATE', 'price_checks', id, `Preço conferido produto #${product_id}`);
    res.status(201).json({ id, price_divergent: divergent, photo_url: photoUrl });
  } catch (err) { next(err); }
});

// --- EXPIRY & QUALITY ---
router.get('/expiries', async (_req, res, next) => {
  try {
    const [rows, stores, products, users] = await Promise.all([
      (await col('expiry_checks')).find({}, { projection: { _id: 0 } }).sort({ expiry_date: 1 }).limit(120).toArray(),
      (await col('stores')).find({}).toArray(),
      (await col('products')).find({}).toArray(),
      (await col('users')).find({}).toArray(),
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
      (await col('users')).find({}).toArray(),
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
      (await col('users')).find({}).toArray(),
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

router.post('/campaigns', async (req, res, next) => {
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
  try {
    const cid = Number(req.params.id);
    const { store_id, visit_id, compliant, checklist_status, notes } = req.body || {};
    if (!store_id) return res.status(400).json({ error: 'Loja é obrigatória.' });

    const photoUrl = req.file ? await saveFileToGridFS(req.file) : '';
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
      executed_at: nowStr(),
    });

    if (req.file) {
      const store = await (await col('stores')).findOne({ id: Number(store_id) });
      const camp = await (await col('campaigns')).findOne({ id: cid });
      await sendPhotoToTelegram({
        filePath: path.join(uploadDir, req.file.filename),
        reason: `Comprovação de Campanha (${camp?.title || `#${cid}`})`,
        storeName: store?.name,
        promoterName: req.user?.name,
        details: notes || 'Campanha implantada no PDV',
      });
    }

    await logAudit(req.user, 'EXECUTE', 'campaign_executions', id, `Campanha #${cid} executada na loja #${store_id}`);
    res.status(201).json({ id, photo_url: photoUrl });
  } catch (err) { next(err); }
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
      (await col('users')).find({}).toArray(),
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
  try {
    const { visit_id, store_id, product_id, type, priority, description } = req.body || {};
    if (!store_id || !type || !description) return res.status(400).json({ error: 'Loja, tipo e descrição são obrigatórios.' });

    const photoUrl = req.file ? await saveFileToGridFS(req.file) : '';
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
      created_at: nowStr(),
    });

    if (req.file) {
      const store = await (await col('stores')).findOne({ id: Number(store_id) });
      await sendPhotoToTelegram({
        filePath: path.join(uploadDir, req.file.filename),
        reason: `Ocorrência: ${type} (Prioridade ${priority || 'Média'})`,
        storeName: store?.name,
        promoterName: req.user?.name,
        details: description,
      });
    }

    await logAudit(req.user, 'CREATE', 'occurrences', id, `Ocorrência ${type} (${priority || 'Média'})`);
    res.status(201).json({ id, photo_url: photoUrl });
  } catch (err) { next(err); }
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
      (await col('users')).find({}).toArray(),
    ]);
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
    res.json(rows.map((a) => ({ ...a, store_name: storeMap[a.store_id] || '', user_name: userMap[a.user_id] || '' })));
  } catch (err) { next(err); }
});

router.post('/ai/analyze-shelf', upload.single('photo'), async (req, res, next) => {
  try {
    const { store_id, visit_id, notes } = req.body || {};
    const imagePath = req.file ? path.join(uploadDir, req.file.filename) : null;
    const imageUrl = req.file ? await saveFileToGridFS(req.file) : '';

    const result = await analyzeShelfImage({ storeId: store_id, visitId: visit_id, imagePath, notes });
    const id = await nextId('ai_analyses');
    const doc = {
      id,
      visit_id: visit_id ? Number(visit_id) : null,
      store_id: store_id ? Number(store_id) : null,
      user_id: req.user.id,
      image_url: imageUrl,
      detected_ruptures_json: JSON.stringify(result.detected_ruptures),
      detected_brands_json: JSON.stringify(result.detected_brands),
      exposure_issues_json: JSON.stringify(result.exposure_issues),
      planogram_score: result.planogram_score,
      suggestions_json: JSON.stringify(result.suggestions),
      extra_point_opportunities_json: JSON.stringify(result.extra_point_opportunities),
      auto_report: result.auto_report,
      confidence: result.confidence,
      human_validation: 'Pendente',
      human_notes: '',
      created_at: nowStr(),
    };
    await (await col('ai_analyses')).insertOne(doc);

    if (imagePath) {
      const store = store_id ? await (await col('stores')).findOne({ id: Number(store_id) }) : null;
      await sendPhotoToTelegram({
        filePath: imagePath,
        reason: `Análise de Gôndola com IA (Score: ${result.planogram_score}% | Confiança: ${result.confidence}%)`,
        storeName: store?.name,
        promoterName: req.user?.name,
        details: `${result.auto_report}${notes ? ` | Contexto: ${notes}` : ''}`,
      });
    }

    await logAudit(req.user, 'AI_ANALYZE', 'ai_analyses', id, `Análise IA de gôndola (confiança ${result.confidence}%)`);
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

router.patch('/ai/analyses/:id/validate', async (req, res, next) => {
  try {
    const aid = Number(req.params.id);
    const { human_validation, human_notes } = req.body || {};
    const aiCol = await col('ai_analyses');
    await aiCol.updateOne(
      { id: aid },
      { $set: { human_validation: human_validation || 'Confirmado', human_notes: human_notes || '' } }
    );
    await logAudit(req.user, 'AI_VALIDATE', 'ai_analyses', aid, `Validação humana: ${human_validation}`);
    res.json(await aiCol.findOne({ id: aid }, { projection: { _id: 0 } }));
  } catch (err) { next(err); }
});

router.get('/ai/store-summary/:storeId', async (req, res, next) => {
  try {
    const summary = await generateStoreSummary(req.params.storeId);
    if (!summary) return res.status(404).json({ error: 'Loja não encontrada.' });
    res.json(summary);
  } catch (err) { next(err); }
});

// --- DASHBOARD KPIs ---
router.get('/dashboard', async (_req, res, next) => {
  try {
    const [visits, checklists, replenishments, occurrences, priceChecks, expiries, displays, campExecs, planograms, stores, users] =
      await Promise.all([
        (await col('visits')).find({}, { projection: { _id: 0 } }).toArray(),
        (await col('visit_checklists')).find({}, { projection: { _id: 0 } }).toArray(),
        (await col('replenishments')).find({}, { projection: { _id: 0 } }).toArray(),
        (await col('occurrences')).find({}, { projection: { _id: 0 } }).toArray(),
        (await col('price_checks')).find({}, { projection: { _id: 0 } }).toArray(),
        (await col('expiry_checks')).find({}, { projection: { _id: 0 } }).toArray(),
        (await col('displays_exposures')).find({}, { projection: { _id: 0 } }).toArray(),
        (await col('campaign_executions')).find({}, { projection: { _id: 0 } }).toArray(),
        (await col('planogram_audits')).find({}, { projection: { _id: 0 } }).toArray(),
        (await col('stores')).find({}).toArray(),
        (await col('users')).find({}).toArray(),
      ]);

    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

    const storesVisited = new Set(visits.filter((v) => v.status === 'Concluída' || v.status === 'Em Andamento').map((v) => v.store_id)).size;
    const visitsDone = visits.filter((v) => v.status === 'Concluída').length;
    const visitsPending = visits.filter((v) => v.status === 'Pendente' || v.status === 'Em Andamento').length;
    const productsReplenished = replenishments.reduce((acc, r) => acc + Number(r.quantity_replenished || 0), 0);
    const rupturesIdentified = occurrences.filter((o) => o.type === 'Ruptura').length;
    const rupturesSolved = occurrences.filter((o) => o.type === 'Ruptura' && o.status === 'Resolvida').length;

    const checklistDone = checklists.filter((c) => c.completed).length;
    const checklistPct = checklists.length ? Number(((checklistDone / checklists.length) * 100).toFixed(1)) : 0;

    const productsWithoutPrice = priceChecks.filter((p) => p.has_price_tag === 0).length;
    const nearExpiry = expiries.filter((e) => e.condition === 'Próximo Vencimento' || e.condition === 'Vencido').length;
    const extraPoints = displays.filter((d) => ['Ponto Extra', 'Ilha Promocional', 'Display', 'Ponta de Gôndola'].includes(d.exposure_type)).length;
    const campaignsExecuted = campExecs.filter((c) => c.compliant === 1).length;
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
router.get('/reports/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    const [stores, users, products, brands] = await Promise.all([
      (await col('stores')).find({}).toArray(),
      (await col('users')).find({}).toArray(),
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
        const rows = await (await col('visits')).find({}).toArray();
        return res.json(rows.map((v) => ({ Data: v.scheduled_date, Loja: storeMap[v.store_id], Promotor: userMap[v.promoter_id], Status: v.status, CheckIn: v.checkin_at, CheckOut: v.checkout_at, Minutos: v.duration_minutes })));
      }
      case 'rupturas': {
        const rows = await (await col('occurrences')).find({}).toArray();
        return res.json(rows.map((o) => ({ Data: o.created_at, Loja: storeMap[o.store_id], Tipo: o.type, Prioridade: o.priority, Status: o.status, Descrição: o.description })));
      }
      case 'abastecimento': {
        const rows = await (await col('replenishments')).find({}).toArray();
        return res.json(rows.map((r) => ({ Data: r.created_at, Loja: storeMap[r.store_id], Produto: prodMap[r.product_id], Abastecido: r.quantity_replenished, Gôndola: r.gondola_stock, Retaguarda: r.backroom_stock, Status: r.status })));
      }
      case 'validade': {
        const rows = await (await col('expiry_checks')).find({}).toArray();
        return res.json(rows.map((e) => ({ Validade: e.expiry_date, Loja: storeMap[e.store_id], Produto: prodMap[e.product_id], Lote: e.batch_code, Qtd: e.quantity, Condição: e.condition, Perda_Estimada: e.estimated_loss })));
      }
      case 'precificacao':
      case 'concorrencia': {
        const rows = await (await col('price_checks')).find({}).toArray();
        return res.json(rows.map((p) => ({ Data: p.created_at, Loja: storeMap[p.store_id], Produto: prodMap[p.product_id], Preço_Gôndola: p.gondola_price, Preço_Sistema: p.system_price, Promocional: p.promo_price, Concorrente: p.competitor_name, Preço_Concorrente: p.competitor_price })));
      }
      case 'planograma': {
        const rows = await (await col('planogram_audits')).find({}).toArray();
        return res.json(rows.map((pa) => ({ Data: pa.created_at, Loja: storeMap[pa.store_id], Categoria: pa.category, Marca: brandMap[pa.brand_id], Ideal: pa.ideal_facings, Real: pa.actual_facings, Share_Pct: pa.share_of_shelf, Espaços_Perdidos: pa.lost_spaces })));
      }
      case 'campanhas': {
        const [execs, camps] = await Promise.all([(await col('campaign_executions')).find({}).toArray(), (await col('campaigns')).find({}).toArray()]);
        const campMap = Object.fromEntries(camps.map((c) => [c.id, c.title]));
        return res.json(execs.map((ce) => ({ Campanha: campMap[ce.campaign_id], Loja: storeMap[ce.store_id], Cumprida: ce.compliant, Executada_Em: ce.executed_at, Observações: ce.notes })));
      }
      case 'fotografico': {
        const rows = await (await col('displays_exposures')).find({}).toArray();
        return res.json(rows.map((d) => ({ Data: d.created_at, Loja: storeMap[d.store_id], Tipo: d.exposure_type, Categoria: d.category, Foto_Antes: d.photo_before, Foto_Depois: d.photo_after, Observações: d.notes })));
      }
      case 'produtividade': {
        const visits = await (await col('visits')).find({}).toArray();
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
        const rows = await (await col('visits')).find({}).toArray();
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
