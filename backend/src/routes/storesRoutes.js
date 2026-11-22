const express = require('express');
const path = require('node:path');
const { col, nextId, nowStr } = require('../db/database');
const { createDefaultChecklist } = require('../db/seed');
const { authenticate, logAudit } = require('../middleware/auth');
const { upload, uploadDir, saveFileToGridFS } = require('../middleware/upload');
const { sendPhotoToTelegram } = require('../services/telegramService');

const router = express.Router();
router.use(authenticate);

// --- STORES ---
router.get('/stores', async (_req, res, next) => {
  try {
    const stores = await (await col('stores')).find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
    res.json(stores);
  } catch (err) { next(err); }
});

router.post('/stores', async (req, res, next) => {
  try {
    const { name, type, banner, network, address, city, region, route_name, visit_frequency, contact_name, contact_phone } = req.body || {};
    if (!name || !address) return res.status(400).json({ error: 'Nome e endereço da loja são obrigatórios.' });

    const id = await nextId('stores');
    const doc = {
      id,
      name,
      type: type || 'Supermercado',
      banner: banner || '',
      network: network || '',
      address,
      city: city || '',
      region: region || 'Centro',
      route_name: route_name || 'Rota Padrão',
      visit_frequency: visit_frequency || 'Semanal',
      contact_name: contact_name || '',
      contact_phone: contact_phone || '',
      active: 1,
      created_at: nowStr(),
    };
    await (await col('stores')).insertOne(doc);
    await logAudit(req.user, 'CREATE', 'stores', id, `Loja ${name} cadastrada`);
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

router.put('/stores/:id', async (req, res, next) => {
  try {
    const sid = Number(req.params.id);
    const stores = await col('stores');
    const existing = await stores.findOne({ id: sid });
    if (!existing) return res.status(404).json({ error: 'Loja não encontrada.' });

    const b = req.body || {};
    const updated = {
      name: b.name ?? existing.name,
      type: b.type ?? existing.type,
      banner: b.banner ?? existing.banner,
      network: b.network ?? existing.network,
      address: b.address ?? existing.address,
      city: b.city ?? existing.city,
      region: b.region ?? existing.region,
      route_name: b.route_name ?? existing.route_name,
      visit_frequency: b.visit_frequency ?? existing.visit_frequency,
      contact_name: b.contact_name ?? existing.contact_name,
      contact_phone: b.contact_phone ?? existing.contact_phone,
      active: b.active !== undefined ? (b.active ? 1 : 0) : existing.active,
    };
    await stores.updateOne({ id: sid }, { $set: updated });
    await logAudit(req.user, 'UPDATE', 'stores', sid, `Loja ${existing.name} atualizada`);
    res.json(await stores.findOne({ id: sid }, { projection: { _id: 0 } }));
  } catch (err) { next(err); }
});

router.get('/stores/:id/history', async (req, res, next) => {
  try {
    const sid = Number(req.params.id);
    const store = await (await col('stores')).findOne({ id: sid }, { projection: { _id: 0 } });
    if (!store) return res.status(404).json({ error: 'Loja não encontrada.' });

    const users = await (await col('users')).find({}).toArray();
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const products = await (await col('products')).find({}).toArray();
    const prodMap = Object.fromEntries(products.map((p) => [p.id, p.name]));

    const visits = (await (await col('visits')).find({ store_id: sid }, { projection: { _id: 0 } }).sort({ scheduled_date: -1, id: -1 }).limit(30).toArray())
      .map((v) => ({ ...v, promoter_name: userMap[v.promoter_id] || 'Promotor' }));
    const occurrences = await (await col('occurrences')).find({ store_id: sid }, { projection: { _id: 0 } }).sort({ id: -1 }).limit(30).toArray();
    const replenishments = (await (await col('replenishments')).find({ store_id: sid }, { projection: { _id: 0 } }).sort({ id: -1 }).limit(30).toArray())
      .map((r) => ({ ...r, product_name: prodMap[r.product_id] || '-' }));
    const displays = await (await col('displays_exposures')).find({ store_id: sid }, { projection: { _id: 0 } }).sort({ id: -1 }).limit(20).toArray();

    res.json({ store, visits, occurrences, replenishments, displays });
  } catch (err) { next(err); }
});

// --- ROUTES ---
router.get('/routes', async (_req, res, next) => {
  try {
    const users = await (await col('users')).find({}).toArray();
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const routes = (await (await col('routes')).find({}, { projection: { _id: 0 } }).sort({ day_of_week: 1, name: 1 }).toArray())
      .map((r) => ({ ...r, promoter_name: userMap[r.promoter_id] || '' }));
    res.json(routes);
  } catch (err) { next(err); }
});

router.post('/routes', async (req, res, next) => {
  try {
    const { name, region, promoter_id, day_of_week, store_ids, notes } = req.body || {};
    if (!name || !day_of_week) return res.status(400).json({ error: 'Nome da rota e dia da semana são obrigatórios.' });

    const id = await nextId('routes');
    const doc = {
      id,
      name,
      region: region || 'Centro',
      promoter_id: promoter_id || req.user.id,
      day_of_week,
      store_ids_json: JSON.stringify(store_ids || []),
      notes: notes || '',
      created_at: nowStr(),
    };
    await (await col('routes')).insertOne(doc);
    await logAudit(req.user, 'CREATE', 'routes', id, `Rota ${name} criada`);
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

// --- VISITS & CHECKLISTS ---
router.get('/visits', async (req, res, next) => {
  try {
    const { status, store_id, promoter_id } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (store_id) filter.store_id = Number(store_id);
    if (promoter_id) filter.promoter_id = Number(promoter_id);

    const [visits, stores, users, checklists] = await Promise.all([
      (await col('visits')).find(filter, { projection: { _id: 0 } }).sort({ scheduled_date: -1, scheduled_time: 1 }).toArray(),
      (await col('stores')).find({}).toArray(),
      (await col('users')).find({}).toArray(),
      (await col('visit_checklists')).find({}).toArray(),
    ]);

    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

    const enriched = visits.map((v) => {
      const s = storeMap[v.store_id] || {};
      const items = checklists.filter((c) => c.visit_id === v.id);
      return {
        ...v,
        store_name: s.name || '-',
        store_type: s.type || '-',
        store_address: s.address || '-',
        store_region: s.region || '-',
        promoter_name: userMap[v.promoter_id] || '-',
        checklist_total: items.length,
        checklist_done: items.filter((i) => i.completed).length,
      };
    });
    res.json(enriched);
  } catch (err) { next(err); }
});

router.post('/visits', async (req, res, next) => {
  try {
    const { store_id, promoter_id, route_id, scheduled_date, scheduled_time, notes } = req.body || {};
    if (!store_id || !scheduled_date) return res.status(400).json({ error: 'Loja e data são obrigatórias.' });

    const id = await nextId('visits');
    const doc = {
      id,
      store_id: Number(store_id),
      promoter_id: Number(promoter_id || req.user.id),
      route_id: route_id ? Number(route_id) : null,
      scheduled_date,
      scheduled_time: scheduled_time || '08:00',
      checkin_at: null,
      checkout_at: null,
      duration_minutes: 0,
      status: 'Pendente',
      checkin_lat: null,
      checkin_lng: null,
      notes: notes || '',
      problems_found: '',
      opportunities_found: '',
      photos_json: '[]',
      created_at: nowStr(),
    };
    await (await col('visits')).insertOne(doc);
    await createDefaultChecklist(id, 0);
    await logAudit(req.user, 'CREATE', 'visits', id, `Visita agendada para loja #${store_id}`);
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

router.post('/visits/:id/checkin', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const visitsCol = await col('visits');
    const visit = await visitsCol.findOne({ id: vid });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });
    if (visit.status === 'Concluída' || visit.status === 'Cancelada') {
      return res.status(403).json({ error: 'Visita já encerrada não pode receber novo check-in.' });
    }

    const otherActive = await visitsCol.findOne({
      store_id: visit.store_id,
      status: 'Em Andamento',
      id: { $ne: vid },
    });
    if (otherActive) {
      return res.status(409).json({
        error: `Já existe uma visita em andamento (#${otherActive.id}) para esta loja. Conclua ou cancele antes de iniciar outra.`,
      });
    }

    const { lat, lng } = req.body || {};
    const nextStage = visit.workflow_stage && visit.workflow_stage !== 'IDENTIFICACAO'
      ? visit.workflow_stage
      : 'FOTO_INICIAL';

    await visitsCol.updateOne(
      { id: vid },
      {
        $set: {
          checkin_at: visit.checkin_at || nowStr(),
          status: 'Em Andamento',
          workflow_stage: nextStage,
          checkin_lat: lat || null,
          checkin_lng: lng || null,
        },
      }
    );
    await (await col('visit_checklists')).updateOne(
      { visit_id: vid, item_key: 'loja_visitada' },
      { $set: { completed: 1, updated_at: nowStr() } }
    );
    await logAudit(req.user, 'CHECKIN', 'visits', vid, `Check-in realizado na visita #${vid}`);
    res.json(await visitsCol.findOne({ id: vid }, { projection: { _id: 0 } }));
  } catch (err) { next(err); }
});

router.post('/visits/:id/checkout', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const visitsCol = await col('visits');
    const visit = await visitsCol.findOne({ id: vid });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });
    if (visit.status === 'Concluída') {
      return res.status(403).json({ error: 'Esta visita já foi finalizada e não pode ser alterada.' });
    }
    if (visit.status === 'Cancelada') {
      return res.status(403).json({ error: 'Visita cancelada não pode receber check-out.' });
    }

    // Regra obrigatória: exigir fotografia inicial, diagnóstico e fotografia final antes de concluir
    const evidencesCol = await col('visit_evidences');
    const [initialCount, finalCount, diag] = await Promise.all([
      evidencesCol.countDocuments({ visit_id: vid, stage: 'INICIAL', is_active: { $ne: 0 } }),
      evidencesCol.countDocuments({ visit_id: vid, stage: 'FINAL', is_active: { $ne: 0 } }),
      (await col('visit_diagnostics')).findOne({ visit_id: vid }),
    ]);

    if (initialCount < 1) {
      return res.status(400).json({ error: 'Check-out bloqueado: fotografia inicial obrigatória não registrada.' });
    }
    if (!diag) {
      return res.status(400).json({ error: 'Check-out bloqueado: diagnóstico inicial obrigatório não realizado.' });
    }
    if (finalCount < 1) {
      return res.status(400).json({ error: 'Check-out bloqueado: registre pelo menos uma fotografia final (após intervenção) antes de finalizar a visita.' });
    }

    const { notes, problems_found, opportunities_found, operational_summary } = req.body || {};

    const nowDate = new Date();
    let duration = 1;
    if (visit.checkin_at) {
      const start = new Date(visit.checkin_at.replace(' ', 'T'));
      const diff = Math.round((nowDate - start) / 60000);
      if (!Number.isNaN(diff) && diff >= 1) duration = diff;
    }

    const checkoutAt = nowStr();
    await visitsCol.updateOne(
      { id: vid },
      {
        $set: {
          checkout_at: checkoutAt,
          duration_minutes: duration,
          status: 'Concluída',
          workflow_stage: 'CONCLUIDA',
          notes: notes ?? visit.notes,
          problems_found: problems_found ?? visit.problems_found,
          opportunities_found: opportunities_found ?? visit.opportunities_found,
          checkout_summary_json: operational_summary ? JSON.stringify(operational_summary) : (visit.checkout_summary_json || null),
        },
      }
    );
    await (await col('visit_checklists')).updateOne(
      { visit_id: vid, item_key: 'fotos_antes_depois' },
      { $set: { completed: 1, updated_at: checkoutAt } }
    );
    await logAudit(req.user, 'CHECKOUT', 'visits', vid, `Check-out realizado (${duration} min)`);
    res.json(await visitsCol.findOne({ id: vid }, { projection: { _id: 0 } }));
  } catch (err) { next(err); }
});

router.post('/visits/:id/cancel', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const visitsCol = await col('visits');
    const visit = await visitsCol.findOne({ id: vid });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });

    const { reason } = req.body || {};
    const cancelNote = reason ? `Cancelada: ${reason}` : 'Visita cancelada pelo usuário';
    const newNotes = visit.notes ? `${visit.notes} | ${cancelNote}` : cancelNote;

    await visitsCol.updateOne(
      { id: vid },
      { $set: { status: 'Cancelada', notes: newNotes } }
    );
    await logAudit(req.user, 'CANCEL', 'visits', vid, cancelNote);
    res.json(await visitsCol.findOne({ id: vid }, { projection: { _id: 0 } }));
  } catch (err) { next(err); }
});

router.post('/visits/:id/photos', upload.single('photo'), async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const visitsCol = await col('visits');
    const visit = await visitsCol.findOne({ id: vid });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });
    if (!req.file) return res.status(400).json({ error: 'Nenhuma foto enviada.' });

    const store = await (await col('stores')).findOne({ id: visit.store_id });
    const photos = JSON.parse(visit.photos_json || '[]');
    const photoUrl = await saveFileToGridFS(req.file);
    const caption = req.body?.caption || 'Foto da visita';
    photos.push({ url: photoUrl, caption, created_at: new Date().toISOString() });
    await visitsCol.updateOne({ id: vid }, { $set: { photos_json: JSON.stringify(photos) } });

    await sendPhotoToTelegram({
      filePath: path.join(uploadDir, req.file.filename),
      reason: `Registro de Visita (#${vid})`,
      storeName: store?.name,
      promoterName: req.user?.name,
      details: caption,
    });

    res.json({ photoUrl, photos });
  } catch (err) { next(err); }
});

router.get('/visits/:id/checklist', async (req, res, next) => {
  try {
    const items = await (await col('visit_checklists'))
      .find({ visit_id: Number(req.params.id) }, { projection: { _id: 0 } })
      .sort({ id: 1 })
      .toArray();
    res.json(items);
  } catch (err) { next(err); }
});

router.patch('/visits/:id/checklist/:itemId', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const { completed, notes } = req.body || {};
    const checkCol = await col('visit_checklists');
    const update = { completed: completed ? 1 : 0, updated_at: nowStr() };
    if (notes !== undefined) update.notes = notes;
    await checkCol.updateOne({ id: itemId, visit_id: vid }, { $set: update });
    res.json(await checkCol.find({ visit_id: vid }, { projection: { _id: 0 } }).sort({ id: 1 }).toArray());
  } catch (err) { next(err); }
});

router.post('/visits/:id/checklist', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const { label } = req.body || {};
    if (!label) return res.status(400).json({ error: 'Descrição do item é obrigatória.' });
    const checkCol = await col('visit_checklists');
    await checkCol.insertOne({
      id: await nextId('visit_checklists'),
      visit_id: vid,
      item_key: `custom_${Date.now()}`,
      label,
      completed: 0,
      notes: '',
      is_custom: 1,
      updated_at: nowStr(),
    });
    res.status(201).json(await checkCol.find({ visit_id: vid }, { projection: { _id: 0 } }).sort({ id: 1 }).toArray());
  } catch (err) { next(err); }
});

module.exports = router;
