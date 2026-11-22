const express = require('express');
const path = require('node:path');
const { col, nextId, nowStr } = require('../db/database');
const { createDefaultChecklist } = require('../db/seed');
const { authenticate, logAudit } = require('../middleware/auth');
const { upload, uploadDir, saveFileToGridFS } = require('../middleware/upload');
const { sendPhotoToTelegram } = require('../services/telegramService');

const router = express.Router();
router.use(authenticate);

const DAYS_PT = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function getTodayDayName() {
  return DAYS_PT[new Date().getDay()];
}

function getTodayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Calcula o resumo operacional consolidado de uma visita específica.
 */
async function buildOperationalSummary(visitId, storeId) {
  const vid = Number(visitId);
  const sid = Number(storeId);

  const [
    replenishments,
    expiries,
    occurrences,
    priceChecks,
    displays,
    planograms,
    checklists,
    evidences,
    diagnostic,
    products,
  ] = await Promise.all([
    (await col('replenishments')).find({ visit_id: vid, store_id: sid }, { projection: { _id: 0 } }).toArray(),
    (await col('expiry_checks')).find({ visit_id: vid, store_id: sid }, { projection: { _id: 0 } }).toArray(),
    (await col('occurrences')).find({ visit_id: vid, store_id: sid }, { projection: { _id: 0 } }).toArray(),
    (await col('price_checks')).find({ visit_id: vid, store_id: sid }, { projection: { _id: 0 } }).toArray(),
    (await col('displays_exposures')).find({ visit_id: vid, store_id: sid }, { projection: { _id: 0 } }).toArray(),
    (await col('planogram_audits')).find({ visit_id: vid, store_id: sid }, { projection: { _id: 0 } }).toArray(),
    (await col('visit_checklists')).find({ visit_id: vid }, { projection: { _id: 0 } }).toArray(),
    (await col('visit_evidences')).find({ visit_id: vid, store_id: sid, is_active: { $ne: 0 } }, { projection: { _id: 0 } }).toArray(),
    (await col('visit_diagnostics')).findOne({ visit_id: vid, store_id: sid }, { projection: { _id: 0 } }),
    (await col('products')).find({}, { projection: { _id: 0, id: 1, name: 1, sku: 1 } }).toArray(),
  ]);

  const prodMap = Object.fromEntries(products.map((p) => [p.id, p]));

  const totalReplenishedQty = replenishments.reduce((acc, r) => acc + Number(r.quantity_replenished || 0), 0);
  const removedQty = expiries
    .filter((e) => e.condition === 'Vencido' || e.removal_requested === 1)
    .reduce((acc, e) => acc + Number(e.quantity || 0), 0);
  const ruptures = occurrences.filter((o) => o.type === 'Ruptura');
  const unresolvedPendencies = occurrences.filter((o) => o.status !== 'Resolvida');
  const checklistDone = checklists.filter((c) => c.completed).length;

  const selfieEntradaPhotos = evidences.filter((e) => e.stage === 'SELFIE_ENTRADA');
  const initialPhotos = evidences.filter((e) => e.stage === 'INICIAL');
  const complementaryPhotos = evidences.filter((e) => e.stage === 'COMPLEMENTAR');
  const finalPhotos = evidences.filter((e) => e.stage === 'FINAL');

  // Agrupar comparação visual Antes x Depois por área
  const areas = new Set([...initialPhotos.map((p) => p.area || 'Geral'), ...finalPhotos.map((p) => p.area || 'Geral')]);
  const visualComparison = Array.from(areas).map((area) => ({
    area,
    before: initialPhotos.filter((p) => (p.area || 'Geral') === area),
    after: finalPhotos.filter((p) => (p.area || 'Geral') === area),
  }));

  return {
    replenished_items_count: replenishments.length,
    total_replenished_qty: totalReplenishedQty,
    replenishments: replenishments.map((r) => ({
      ...r,
      product_name: prodMap[r.product_id]?.name || `Produto #${r.product_id}`,
    })),
    removed_products_qty: removedQty,
    expiries_count: expiries.length,
    expiries: expiries.map((e) => ({
      ...e,
      product_name: prodMap[e.product_id]?.name || `Produto #${e.product_id}`,
    })),
    ruptures_count: ruptures.length,
    occurrences_count: occurrences.length,
    unresolved_pendencies_count: unresolvedPendencies.length,
    unresolved_pendencies: unresolvedPendencies,
    price_checks_count: priceChecks.length,
    displays_count: displays.length,
    planograms_count: planograms.length,
    checklist_total: checklists.length,
    checklist_done: checklistDone,
    evidences: {
      selfie_entrada: selfieEntradaPhotos,
      initial: initialPhotos,
      complementary: complementaryPhotos,
      final: finalPhotos,
    },
    visual_comparison: visualComparison,
    diagnostic,
  };
}

// --- 1. VISÃO STORE-CENTRIC INICIAL ---
router.get('/stores/overview', async (_req, res, next) => {
  try {
    const today = getTodayDateStr();
    const todayDayName = getTodayDayName();

    const [stores, routes, visits, occurrences, users] = await Promise.all([
      (await col('stores')).find({ active: { $ne: 0 } }, { projection: { _id: 0 } }).sort({ name: 1 }).toArray(),
      (await col('routes')).find({}, { projection: { _id: 0 } }).toArray(),
      (await col('visits')).find({}, { projection: { _id: 0 } }).sort({ id: -1 }).toArray(),
      (await col('occurrences')).find({ status: { $ne: 'Resolvida' } }, { projection: { _id: 0 } }).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray(),
    ]);

    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const dailyRouteStoreIds = new Set();
    for (const r of routes) {
      if (r.day_of_week === todayDayName) {
        try {
          const ids = JSON.parse(r.store_ids_json || '[]');
          ids.forEach((id) => dailyRouteStoreIds.add(Number(id)));
        } catch {
          // ignore malformed json
        }
      }
    }

    const overview = stores.map((store) => {
      const storeVisits = visits.filter((v) => v.store_id === store.id);
      const activeVisit = storeVisits.find((v) => v.status === 'Em Andamento') || null;
      const pendingVisit = storeVisits.find((v) => v.status === 'Pendente') || null;
      const lastCompleted = storeVisits.find((v) => v.status === 'Concluída') || null;
      const visitedToday = storeVisits.some(
        (v) => v.status === 'Concluída' && (v.scheduled_date === today || (v.checkout_at || '').startsWith(today))
      );
      const openOccs = occurrences.filter((o) => o.store_id === store.id);
      const inDailyRoute = dailyRouteStoreIds.has(store.id) || store.visit_frequency === 'Diária';

      let operational_status = 'Cadastrada';
      if (activeVisit) operational_status = 'Em Andamento';
      else if (openOccs.length > 0) operational_status = 'Com Ocorrências';
      else if (pendingVisit || (inDailyRoute && !visitedToday)) operational_status = 'Pendente';
      else if (lastCompleted) operational_status = 'Visitada';

      return {
        ...store,
        in_daily_route: inDailyRoute,
        visited_today: visitedToday,
        operational_status,
        active_visit: activeVisit ? { ...activeVisit, promoter_name: userMap[activeVisit.promoter_id] || 'Promotor' } : null,
        pending_visit: pendingVisit ? { ...pendingVisit, promoter_name: userMap[pendingVisit.promoter_id] || 'Promotor' } : null,
        last_visit: lastCompleted ? { ...lastCompleted, promoter_name: userMap[lastCompleted.promoter_id] || 'Promotor' } : null,
        total_visits_done: storeVisits.filter((v) => v.status === 'Concluída').length,
        open_occurrences_count: openOccs.length,
        high_priority_occurrences: openOccs.filter((o) => o.priority === 'Alta').length,
      };
    });

    res.json({
      today,
      today_day_name: todayDayName,
      stores: overview,
    });
  } catch (err) {
    next(err);
  }
});

// --- 2. PÁGINA OPERACIONAL E HISTÓRICO EVOLUTIVO POR LOJA ---
router.get('/stores/:id/operational', async (req, res, next) => {
  try {
    const sid = Number(req.params.id);
    const store = await (await col('stores')).findOne({ id: sid }, { projection: { _id: 0 } });
    if (!store) return res.status(404).json({ error: 'Loja não encontrada.' });

    const [
      visits,
      evidences,
      diagnostics,
      replenishments,
      occurrences,
      expiries,
      priceChecks,
      displays,
      planograms,
      users,
      products,
    ] = await Promise.all([
      (await col('visits')).find({ store_id: sid }, { projection: { _id: 0 } }).sort({ id: -1 }).toArray(),
      (await col('visit_evidences')).find({ store_id: sid, is_active: { $ne: 0 } }, { projection: { _id: 0 } }).sort({ id: 1 }).toArray(),
      (await col('visit_diagnostics')).find({ store_id: sid }, { projection: { _id: 0 } }).toArray(),
      (await col('replenishments')).find({ store_id: sid }, { projection: { _id: 0 } }).sort({ id: -1 }).toArray(),
      (await col('occurrences')).find({ store_id: sid }, { projection: { _id: 0 } }).sort({ id: -1 }).toArray(),
      (await col('expiry_checks')).find({ store_id: sid }, { projection: { _id: 0 } }).sort({ id: -1 }).toArray(),
      (await col('price_checks')).find({ store_id: sid }, { projection: { _id: 0 } }).sort({ id: -1 }).toArray(),
      (await col('displays_exposures')).find({ store_id: sid }, { projection: { _id: 0 } }).sort({ id: -1 }).toArray(),
      (await col('planogram_audits')).find({ store_id: sid }, { projection: { _id: 0 } }).sort({ id: -1 }).toArray(),
      (await col('users')).find({}, { projection: { _id: 0, id: 1, name: 1, role: 1 } }).toArray(),
      (await col('products')).find({}, { projection: { _id: 0, id: 1, name: 1, sku: 1 } }).toArray(),
    ]);

    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const prodMap = Object.fromEntries(products.map((p) => [p.id, p.name]));
    const diagMap = Object.fromEntries(diagnostics.map((d) => [d.visit_id, d]));

    const activeVisit = visits.find((v) => v.status === 'Em Andamento') || visits.find((v) => v.status === 'Pendente') || null;

    // Montar linha do tempo evolutiva por visita (independente do promotor)
    const timeline = visits.map((v) => {
      const vEvs = evidences.filter((e) => e.visit_id === v.id);
      const vReps = replenishments.filter((r) => r.visit_id === v.id).map((r) => ({ ...r, product_name: prodMap[r.product_id] || '-' }));
      const vOccs = occurrences.filter((o) => o.visit_id === v.id).map((o) => ({ ...o, product_name: prodMap[o.product_id] || '' }));
      const vExps = expiries.filter((e) => e.visit_id === v.id).map((e) => ({ ...e, product_name: prodMap[e.product_id] || '-' }));
      const vPrices = priceChecks.filter((p) => p.visit_id === v.id).map((p) => ({ ...p, product_name: prodMap[p.product_id] || '-' }));
      const vDisplays = displays.filter((d) => d.visit_id === v.id);
      const vPlanograms = planograms.filter((pa) => pa.visit_id === v.id);

      return {
        ...v,
        promoter_name: userMap[v.promoter_id] || 'Promotor',
        diagnostic: diagMap[v.id] || null,
        evidences: {
          selfie_entrada: vEvs.filter((e) => e.stage === 'SELFIE_ENTRADA'),
          initial: vEvs.filter((e) => e.stage === 'INICIAL'),
          complementary: vEvs.filter((e) => e.stage === 'COMPLEMENTAR'),
          final: vEvs.filter((e) => e.stage === 'FINAL'),
        },
        replenishments: vReps,
        occurrences: vOccs,
        expiries: vExps,
        price_checks: vPrices,
        displays: vDisplays,
        planograms: vPlanograms,
        total_replenished_qty: vReps.reduce((acc, r) => acc + Number(r.quantity_replenished || 0), 0),
      };
    });

    // Detectar problemas recorrentes nesta loja
    const occTypeCounts = {};
    for (const o of occurrences) {
      occTypeCounts[o.type] = (occTypeCounts[o.type] || 0) + 1;
    }
    const recurringIssues = Object.entries(occTypeCounts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));

    res.json({
      store,
      active_visit: activeVisit ? { ...activeVisit, promoter_name: userMap[activeVisit.promoter_id] || 'Promotor' } : null,
      open_occurrences: occurrences.filter((o) => o.status !== 'Resolvida').map((o) => ({ ...o, product_name: prodMap[o.product_id] || '' })),
      recurring_issues: recurringIssues,
      timeline,
    });
  } catch (err) {
    next(err);
  }
});

// --- 3. INICIAR / RETOMAR VISITA NA LOJA (ETAPA 1: IDENTIFICAÇÃO) ---
router.post('/visits/start-for-store', async (req, res, next) => {
  try {
    const { store_id, lat, lng, notes } = req.body || {};
    if (!store_id) return res.status(400).json({ error: 'Identificação da loja é obrigatória.' });

    const sid = Number(store_id);
    const store = await (await col('stores')).findOne({ id: sid });
    if (!store) return res.status(404).json({ error: 'Loja não encontrada.' });

    const visitsCol = await col('visits');

    // Impedir duplicidade: se já existe visita Em Andamento para esta loja, retorna ela
    const existingActive = await visitsCol.findOne({ store_id: sid, status: 'Em Andamento' }, { projection: { _id: 0 } });
    if (existingActive) {
      return res.json({ visit: existingActive, resumed: true });
    }

    // Se existir visita Pendente para hoje nesta loja, promove para Em Andamento no Check-in
    const today = getTodayDateStr();
    const pendingToday = await visitsCol.findOne(
      { store_id: sid, status: 'Pendente', scheduled_date: today },
      { projection: { _id: 0 } }
    );

    const checkinTime = nowStr();
    if (pendingToday) {
      await visitsCol.updateOne(
        { id: pendingToday.id },
        {
          $set: {
            promoter_id: req.user.id,
            checkin_at: pendingToday.checkin_at || checkinTime,
            checkin_lat: lat ?? pendingToday.checkin_lat ?? null,
            checkin_lng: lng ?? pendingToday.checkin_lng ?? null,
            status: 'Em Andamento',
            workflow_stage: 'FOTO_INICIAL',
          },
        }
      );
      await (await col('visit_checklists')).updateOne(
        { visit_id: pendingToday.id, item_key: 'loja_visitada' },
        { $set: { completed: 1, updated_at: checkinTime } }
      );
      await logAudit(req.user, 'CHECKIN', 'visits', pendingToday.id, `Check-in na loja ${store.name}`);
      const updated = await visitsCol.findOne({ id: pendingToday.id }, { projection: { _id: 0 } });
      return res.json({ visit: updated, resumed: false });
    }

    // Caso contrário, cria nova visita já iniciada na Etapa 1 -> pronta para Foto Inicial
    const id = await nextId('visits');
    const doc = {
      id,
      store_id: sid,
      promoter_id: req.user.id,
      route_id: null,
      scheduled_date: today,
      scheduled_time: new Date().toTimeString().slice(0, 5),
      checkin_at: checkinTime,
      checkout_at: null,
      duration_minutes: 0,
      status: 'Em Andamento',
      workflow_stage: 'FOTO_INICIAL',
      checkin_lat: lat ?? null,
      checkin_lng: lng ?? null,
      notes: notes || '',
      problems_found: '',
      opportunities_found: '',
      photos_json: '[]',
      created_at: checkinTime,
    };
    await visitsCol.insertOne(doc);
    await createDefaultChecklist(id, 1);
    await logAudit(req.user, 'START_VISIT', 'visits', id, `Visita iniciada na loja ${store.name}`);
    res.status(201).json({ visit: doc, resumed: false });
  } catch (err) {
    next(err);
  }
});

// --- 4. ESTADO COMPLETO DO WORKFLOW DA VISITA ---
router.get('/visits/:id/workflow-state', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const visit = await (await col('visits')).findOne({ id: vid }, { projection: { _id: 0 } });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });

    const [store, promoter, checklist, summary] = await Promise.all([
      (await col('stores')).findOne({ id: visit.store_id }, { projection: { _id: 0 } }),
      (await col('users')).findOne({ id: visit.promoter_id }, { projection: { _id: 0, id: 1, name: 1, role: 1 } }),
      (await col('visit_checklists')).find({ visit_id: vid }, { projection: { _id: 0 } }).sort({ id: 1 }).toArray(),
      buildOperationalSummary(vid, visit.store_id),
    ]);

    res.json({
      visit,
      store,
      promoter,
      checklist,
      summary,
    });
  } catch (err) {
    next(err);
  }
});

// --- 5. EVIDÊNCIAS FOTOGRÁFICAS (INICIAL / COMPLEMENTAR / FINAL) ---
router.post('/visits/:id/evidences', upload.single('photo'), async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const visit = await (await col('visits')).findOne({ id: vid });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });
    if (visit.status === 'Concluída' || visit.status === 'Cancelada') {
      return res.status(403).json({ error: 'Não é permitido alterar evidências de uma visita encerrada.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Captura de fotografia obrigatória. Fotos antigas não são aceitas.' });
    }

    const stage = ['SELFIE_ENTRADA', 'INICIAL', 'COMPLEMENTAR', 'FINAL'].includes(req.body?.stage) ? req.body.stage : 'COMPLEMENTAR';
    const area = req.body?.area || 'Gôndola Principal';
    const caption = req.body?.caption || `Foto ${stage} — ${area}`;
    const capturedAt = nowStr();

    const photoUrl = await saveFileToGridFS(req.file);
    const id = await nextId('visit_evidences');
    const doc = {
      id,
      visit_id: vid,
      store_id: visit.store_id,
      promoter_id: req.user.id,
      stage,
      area,
      caption,
      photo_url: photoUrl,
      captured_at: capturedAt,
      is_active: 1,
    };
    await (await col('visit_evidences')).insertOne(doc);

    // Sincronizar também em photos_json para compatibilidade legada
    const photos = JSON.parse(visit.photos_json || '[]');
    photos.push({ url: photoUrl, caption: `[${stage}] ${area}: ${caption}`, created_at: new Date().toISOString() });
    await (await col('visits')).updateOne({ id: vid }, { $set: { photos_json: JSON.stringify(photos) } });

    const store = await (await col('stores')).findOne({ id: visit.store_id });
    await sendPhotoToTelegram({
      filePath: path.join(uploadDir, req.file.filename),
      reason: `Evidência ${stage} — ${area} (Visita #${vid})`,
      storeName: store?.name,
      promoterName: req.user?.name,
      details: caption,
    });

    await logAudit(req.user, 'UPLOAD_EVIDENCE', 'visit_evidences', id, `Foto ${stage} (${area}) na visita #${vid}`);
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

// Refazer foto antes da conclusão (soft-delete com auditoria)
router.delete('/visits/:id/evidences/:evId', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const evId = Number(req.params.evId);
    const visit = await (await col('visits')).findOne({ id: vid });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });
    if (visit.status === 'Concluída' || visit.status === 'Cancelada') {
      return res.status(403).json({ error: 'Proibido excluir evidências de visita encerrada.' });
    }

    const evCol = await col('visit_evidences');
    const ev = await evCol.findOne({ id: evId, visit_id: vid });
    if (!ev) return res.status(404).json({ error: 'Evidência não encontrada.' });

    await evCol.updateOne({ id: evId }, { $set: { is_active: 0, replaced_at: nowStr(), replaced_by: req.user.id } });
    await logAudit(req.user, 'RETAKE_EVIDENCE', 'visit_evidences', evId, `Foto #${evId} refeita antes da confirmação`);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Confirmar Fotografia Inicial e liberar Diagnóstico
router.post('/visits/:id/confirm-initial-photo', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const visitsCol = await col('visits');
    const visit = await visitsCol.findOne({ id: vid });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });

    const evCol = await col('visit_evidences');
    const [selfieCount, initialCount] = await Promise.all([
      evCol.countDocuments({ visit_id: vid, stage: 'SELFIE_ENTRADA', is_active: { $ne: 0 } }),
      evCol.countDocuments({ visit_id: vid, stage: 'INICIAL', is_active: { $ne: 0 } }),
    ]);
    if (selfieCount < 1 || initialCount < 1) {
      return res.status(400).json({
        error: 'O sistema não libera o diagnóstico sem a selfie em frente ao estabelecimento e a fotografia inicial da gôndola registradas.',
      });
    }

    const nextStage = visit.workflow_stage === 'IDENTIFICACAO' || visit.workflow_stage === 'FOTO_INICIAL'
      ? 'DIAGNOSTICO'
      : visit.workflow_stage;

    await visitsCol.updateOne(
      { id: vid },
      { $set: { workflow_stage: nextStage, initial_photo_confirmed_at: nowStr() } }
    );
    await logAudit(req.user, 'CONFIRM_INITIAL_PHOTO', 'visits', vid, 'Foto inicial confirmada; diagnóstico liberado');
    res.json(await visitsCol.findOne({ id: vid }, { projection: { _id: 0 } }));
  } catch (err) {
    next(err);
  }
});

// --- 6. DIAGNÓSTICO INICIAL (ETAPA 3) ---
router.post('/visits/:id/diagnostic', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const visitsCol = await col('visits');
    const visit = await visitsCol.findOne({ id: vid });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });
    if (visit.status === 'Concluída' || visit.status === 'Cancelada') {
      return res.status(403).json({ error: 'Visita encerrada não pode ter diagnóstico alterado.' });
    }

    // Regra rígida: exigir selfie na entrada e foto inicial antes do diagnóstico
    const evCol = await col('visit_evidences');
    const [selfieCount, initialCount] = await Promise.all([
      evCol.countDocuments({ visit_id: vid, stage: 'SELFIE_ENTRADA', is_active: { $ne: 0 } }),
      evCol.countDocuments({ visit_id: vid, stage: 'INICIAL', is_active: { $ne: 0 } }),
    ]);
    if (selfieCount < 1 || initialCount < 1) {
      return res.status(400).json({
        error: 'Bloqueio de segurança: registre a Selfie em frente ao estabelecimento e a Fotografia Inicial obrigatória antes de realizar o Diagnóstico.',
      });
    }

    const a = req.body?.answers || {};
    const complementaryItems = Array.isArray(req.body?.complementary_items) ? req.body.complementary_items : [];
    const createdAt = nowStr();

    // Gerar ocorrências/pendências automáticas a partir das respostas
    const autoIssues = [];
    if (a.exposicao === 'Ruim' || a.exposicao === 'Regular') {
      autoIssues.push({ type: 'Baixa Visibilidade', priority: a.exposicao === 'Ruim' ? 'Alta' : 'Média', description: `Diagnóstico inicial: Exposição avaliada como ${a.exposicao}. ${a.obs_exposicao || ''}`.trim() });
    }
    if (a.organizacao_gondola === 'Ruim') {
      autoIssues.push({ type: 'Mal Posicionado', priority: 'Média', description: `Diagnóstico inicial: Organização da gôndola avaliada como Ruim. ${a.obs_gondola || ''}`.trim() });
    }
    if (a.abastecimento === 'Ruim' || a.abastecimento === 'Crítico') {
      autoIssues.push({ type: 'Baixo Estoque', priority: 'Alta', description: `Diagnóstico inicial: Abastecimento avaliado como ${a.abastecimento}. ${a.obs_abastecimento || ''}`.trim() });
    }
    if (a.tem_rupturas) {
      autoIssues.push({ type: 'Ruptura', priority: 'Alta', description: `Ruptura identificada no diagnóstico inicial. ${a.detalhes_rupturas || ''}`.trim() });
    }
    if (a.tem_vencidos) {
      autoIssues.push({ type: 'Produto Vencido', priority: 'Alta', description: `Produtos vencidos identificados no diagnóstico inicial. ${a.detalhes_vencidos || ''}`.trim() });
    }
    if (a.tem_proximo_vencimento) {
      autoIssues.push({ type: 'Próximo do Vencimento', priority: 'Média', description: `Produtos próximos do vencimento identificados no diagnóstico. ${a.detalhes_proximo_vencimento || ''}`.trim() });
    }
    if (a.tem_sem_preco) {
      autoIssues.push({ type: 'Falta de Preço', priority: 'Média', description: `Produtos sem etiqueta de preço identificados no diagnóstico. ${a.detalhes_sem_preco || ''}`.trim() });
    }
    if (a.tem_divergencia_preco) {
      autoIssues.push({ type: 'Divergência de Preço', priority: 'Média', description: `Divergência de preço identificada no diagnóstico. ${a.detalhes_divergencia_preco || ''}`.trim() });
    }
    if (a.tem_concorrencia_espaco) {
      autoIssues.push({ type: 'Concorrente Espaço Estratégico', priority: 'Média', description: `Concorrência ocupando espaço da marca no PDV. ${a.detalhes_concorrencia || ''}`.trim() });
    }

    const occCol = await col('occurrences');
    for (const issue of autoIssues) {
      await occCol.insertOne({
        id: await nextId('occurrences'),
        visit_id: vid,
        store_id: visit.store_id,
        product_id: null,
        promoter_id: req.user.id,
        type: issue.type,
        priority: issue.priority,
        description: issue.description,
        source: 'diagnostico',
        photo_url: '',
        status: 'Aberta',
        resolved_at: null,
        created_at: createdAt,
      });
    }

    // Registrar itens complementares específicos por produto (se informados)
    for (const item of complementaryItems) {
      if (!item?.description) continue;
      await occCol.insertOne({
        id: await nextId('occurrences'),
        visit_id: vid,
        store_id: visit.store_id,
        product_id: item.product_id ? Number(item.product_id) : null,
        promoter_id: req.user.id,
        type: item.type || 'Ruptura',
        priority: item.priority || 'Alta',
        description: item.description,
        source: 'diagnostico_complementar',
        photo_url: '',
        status: 'Aberta',
        resolved_at: null,
        created_at: createdAt,
      });
    }

    const diagCol = await col('visit_diagnostics');
    const existingDiag = await diagCol.findOne({ visit_id: vid });
    const diagDoc = {
      id: existingDiag ? existingDiag.id : await nextId('visit_diagnostics'),
      visit_id: vid,
      store_id: visit.store_id,
      promoter_id: req.user.id,
      answers: a,
      complementary_items: complementaryItems,
      generated_occurrences_count: autoIssues.length + complementaryItems.length,
      completed_at: createdAt,
      created_at: existingDiag ? existingDiag.created_at : createdAt,
    };

    await diagCol.updateOne({ visit_id: vid }, { $set: diagDoc }, { upsert: true });
    await visitsCol.updateOne(
      { id: vid },
      {
        $set: {
          workflow_stage: 'EXECUCAO',
          diagnostic_completed_at: createdAt,
          problems_found: autoIssues.map((i) => `${i.type}: ${i.description}`).join(' | ') || visit.problems_found,
        },
      }
    );

    await logAudit(req.user, 'SAVE_DIAGNOSTIC', 'visit_diagnostics', diagDoc.id, `Diagnóstico salvo (${autoIssues.length} pendências geradas)`);
    res.status(201).json({ diagnostic: diagDoc, generated_occurrences: autoIssues.length + complementaryItems.length });
  } catch (err) {
    next(err);
  }
});

// Avançar da Execução para Foto Final
router.post('/visits/:id/ready-for-final-photo', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const visitsCol = await col('visits');
    const visit = await visitsCol.findOne({ id: vid });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });
    if (visit.status === 'Concluída' || visit.status === 'Cancelada') {
      return res.status(403).json({ error: 'Visita já encerrada.' });
    }
    const diag = await (await col('visit_diagnostics')).findOne({ visit_id: vid });
    if (!diag) {
      return res.status(400).json({ error: 'Realize o Diagnóstico Inicial antes de avançar para a Fotografia Final.' });
    }
    await visitsCol.updateOne({ id: vid }, { $set: { workflow_stage: 'FOTO_FINAL' } });
    res.json(await visitsCol.findOne({ id: vid }, { projection: { _id: 0 } }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
