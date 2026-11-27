const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { col, nextId, nowStr, getGridFSBucket } = require('../db/database');

let _sharp = null;
function getSharp() {
  if (!_sharp) _sharp = require('sharp');
  return _sharp;
}
const { createDefaultChecklist } = require('../db/seed');
const { authenticate, logAudit } = require('../middleware/auth');
const { upload, uploadDir, saveFileToGridFS, cleanupUploadedFile } = require('../middleware/upload');
const { sendPhotoToTelegram, deleteTelegramMessage } = require('../services/telegramService');
const { applyAuditWatermark } = require('../services/imageAnnotator');
const { canOperateVisit, getBrazilDateStr, getBrazilTimeStr, getBrazilDayName } = require('../utils/security');

const router = express.Router();
router.use(authenticate);

function getTodayDayName() {
  return getBrazilDayName();
}

function getTodayDateStr() {
  return getBrazilDateStr();
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
    (await col('visit_evidences')).find({ visit_id: vid, is_active: { $ne: 0 } }, { projection: { _id: 0 } }).sort({ id: 1 }).toArray(),
    (await col('visit_diagnostics')).findOne({ visit_id: vid, store_id: sid }, { projection: { _id: 0 } }),
    (await col('products')).find({}, { projection: { _id: 0, id: 1, name: 1, sku: 1, ean: 1, weight: 1 } }).toArray(),
  ]);

  const prodMap = Object.fromEntries(products.map((p) => [p.id, p]));

  const totalReplenishedQty = replenishments.reduce((acc, r) => acc + Number(r.quantity_replenished || 0), 0);
  const removedQty = expiries
    .filter((e) => e.condition === 'Vencido' || e.removal_requested === 1)
    .reduce((acc, e) => acc + Number(e.quantity || 0), 0);
  const ruptures = occurrences.filter((o) => o.type === 'Ruptura');
  const unresolvedPendencies = occurrences.filter((o) => o.status !== 'Resolvida');
  const checklistDone = checklists.filter((c) => c.completed).length;

  const normStage = (e) => String(e?.stage || '').toUpperCase().trim();
  const selfieEntradaPhotos = evidences.filter((e) => normStage(e) === 'SELFIE_ENTRADA');
  const initialPhotos = evidences.filter((e) => normStage(e) === 'INICIAL');
  const complementaryPhotos = evidences.filter((e) => normStage(e) === 'COMPLEMENTAR');
  const finalPhotos = evidences.filter((e) => normStage(e) === 'FINAL');

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
      product_weight: prodMap[r.product_id]?.weight || '',
      product_ean: prodMap[r.product_id]?.ean || '',
    })),
    removed_products_qty: removedQty,
    expiries_count: expiries.length,
    expiries: expiries.map((e) => ({
      ...e,
      product_name: prodMap[e.product_id]?.name || `Produto #${e.product_id}`,
      product_weight: prodMap[e.product_id]?.weight || '',
    })),
    ruptures_count: ruptures.length,
    occurrences_count: occurrences.length,
    occurrences: occurrences.map((o) => ({
      ...o,
      product_name: o.product_id ? prodMap[o.product_id]?.name || `Produto #${o.product_id}` : '',
    })),
    unresolved_pendencies_count: unresolvedPendencies.length,
    unresolved_pendencies: unresolvedPendencies,
    price_checks_count: priceChecks.length,
    price_checks: priceChecks.map((p) => ({
      ...p,
      product_name: prodMap[p.product_id]?.name || `Produto #${p.product_id}`,
      product_weight: prodMap[p.product_id]?.weight || '',
    })),
    displays_count: displays.length,
    displays,
    planograms_count: planograms.length,
    planograms,
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
      (await col('visits'))
        .find(
          {},
          {
            projection: {
              _id: 0,
              id: 1,
              store_id: 1,
              promoter_id: 1,
              status: 1,
              scheduled_date: 1,
              scheduled_time: 1,
              checkin_at: 1,
              checkout_at: 1,
              workflow_stage: 1,
            },
          }
        )
        .sort({ id: -1 })
        .toArray(),
      (await col('occurrences'))
        .find({ status: { $ne: 'Resolvida' } }, { projection: { _id: 0, store_id: 1, priority: 1 } })
        .toArray(),
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
      scheduled_time: getBrazilTimeStr(),
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

async function loadPhotoBufferForPdf(photoUrl) {
  if (!photoUrl || typeof photoUrl !== 'string') return null;
  try {
    if (/^https?:\/\//i.test(photoUrl)) {
      const resp = await fetch(photoUrl, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return null;
      return Buffer.from(await resp.arrayBuffer());
    }
    if (photoUrl.startsWith('/uploads/')) {
      const safeName = path.basename(photoUrl);
      const localPath = path.join(uploadDir, safeName);
      if (fs.existsSync(localPath)) {
        return await fs.promises.readFile(localPath);
      }
      const bucket = await getGridFSBucket();
      const files = await bucket.find({ filename: safeName }).limit(1).toArray();
      if (!files.length) return null;
      const chunks = [];
      await new Promise((resolve, reject) => {
        bucket
          .openDownloadStream(files[0]._id)
          .on('data', (c) => chunks.push(c))
          .on('end', resolve)
          .on('error', reject);
      });
      return Buffer.concat(chunks);
    }
  } catch (err) {
    console.warn('Aviso ao carregar foto para PDF:', err.message);
  }
  return null;
}

async function embedPhotoAsDataUrl(photoUrl, maxWidth = 760, quality = 76) {
  const raw = await loadPhotoBufferForPdf(photoUrl);
  if (!raw || raw.length === 0) return null;
  try {
    const sharp = getSharp();
    const pipeline = sharp(raw).rotate();
    const meta = await pipeline.metadata();
    const isPano = Number(meta.width) > 0 && Number(meta.height) > 0 && meta.width / meta.height >= 2.0;
    const targetW = isPano ? Math.min(1200, maxWidth + 320) : maxWidth;
    const resized = await pipeline
      .resize({ width: targetW, height: targetW, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return {
      data_url: `data:image/jpeg;base64,${resized.data.toString('base64')}`,
      width: resized.info.width,
      height: resized.info.height,
      is_panoramic: isPano,
    };
  } catch (err) {
    console.warn('Aviso ao converter foto para PDF:', err.message);
    return null;
  }
}

// --- 4B. DOSSIÊ COMPLETO DA VISITA PARA DOWNLOAD (PDF / EXCEL) ---
router.get('/visits/:id/report', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const includeImages = req.query.include_images === '1' || req.query.include_images === 'true';
    const visit = await (await col('visits')).findOne({ id: vid }, { projection: { _id: 0 } });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });

    const [store, promoter, checklist, summary, aiAnalyses, campExecs] = await Promise.all([
      (await col('stores')).findOne({ id: visit.store_id }, { projection: { _id: 0 } }),
      (await col('users')).findOne({ id: visit.promoter_id }, { projection: { _id: 0, id: 1, name: 1, role: 1 } }),
      (await col('visit_checklists')).find({ visit_id: vid }, { projection: { _id: 0 } }).sort({ id: 1 }).toArray(),
      buildOperationalSummary(vid, visit.store_id),
      (await col('ai_analyses')).find({ visit_id: vid }, { projection: { _id: 0 } }).toArray(),
      (await col('campaign_executions')).find({ visit_id: vid }, { projection: { _id: 0 } }).toArray(),
    ]);

    // Consolidar TODAS as fotos da visita (evidências, legado photos_json, exposições, preços, ocorrências, campanhas e IA)
    const seenUrls = new Set();
    const gallery = [];
    const addPhoto = (item) => {
      const url = String(item?.photo_url || '').trim();
      if (!url || seenUrls.has(url)) return;
      seenUrls.add(url);
      gallery.push({
        photo_url: url,
        stage: item.stage || 'REGISTRO',
        stage_label: item.stage_label || item.stage || 'Registro Fotográfico',
        area: item.area || 'PDV',
        caption: item.caption || '',
        captured_at: item.captured_at || '',
        is_panoramic: Boolean(item.is_panoramic),
      });
    };

    const evs = summary.evidences || {};
    (evs.selfie_entrada || []).forEach((p) => addPhoto({ ...p, stage_label: 'Selfie na Entrada' }));
    (evs.initial || []).forEach((p) => addPhoto({ ...p, stage_label: 'Foto Inicial (Antes)' }));
    (evs.complementary || []).forEach((p) => addPhoto({ ...p, stage_label: 'Foto Complementar' }));
    (evs.final || []).forEach((p) => addPhoto({ ...p, stage_label: 'Foto Final (Depois)' }));

    try {
      const legacyPhotos = JSON.parse(visit.photos_json || '[]');
      if (Array.isArray(legacyPhotos)) {
        legacyPhotos.forEach((p) =>
          addPhoto({
            photo_url: p.url,
            stage: 'VISITA',
            stage_label: 'Foto da Visita',
            area: p.area || 'PDV',
            caption: p.caption || '',
            captured_at: p.created_at || '',
            is_panoramic: Boolean(p.is_panoramic),
          })
        );
      }
    } catch {
      // ignore malformed photos_json
    }

    (summary.displays || []).forEach((d) => {
      if (d.photo_before) {
        addPhoto({
          photo_url: d.photo_before,
          stage: 'EXPOSICAO_ANTES',
          stage_label: 'Exposição (Antes)',
          area: d.exposure_type || d.category || 'Exposição',
          caption: d.notes || '',
          captured_at: d.created_at || '',
        });
      }
      if (d.photo_after) {
        addPhoto({
          photo_url: d.photo_after,
          stage: 'EXPOSICAO_DEPOIS',
          stage_label: 'Exposição (Depois)',
          area: d.exposure_type || d.category || 'Exposição',
          caption: d.notes || '',
          captured_at: d.created_at || '',
        });
      }
    });

    (summary.price_checks || []).forEach((p) => {
      if (p.photo_url) {
        addPhoto({
          photo_url: p.photo_url,
          stage: 'PRECO',
          stage_label: 'Precificação',
          area: p.product_name || 'Etiqueta',
          caption: p.notes || '',
          captured_at: p.created_at || '',
        });
      }
    });

    (summary.occurrences || []).forEach((o) => {
      if (o.photo_url) {
        addPhoto({
          photo_url: o.photo_url,
          stage: 'OCORRENCIA',
          stage_label: `Ocorrência (${o.type || 'PDV'})`,
          area: o.product_name || o.type || 'Ocorrência',
          caption: o.description || '',
          captured_at: o.created_at || '',
        });
      }
    });

    campExecs.forEach((c) => {
      if (c.photo_url) {
        addPhoto({
          photo_url: c.photo_url,
          stage: 'CAMPANHA',
          stage_label: 'Comprovação de Campanha',
          area: 'Campanha',
          caption: c.notes || '',
          captured_at: c.executed_at || '',
        });
      }
    });

    aiAnalyses.forEach((a) => {
      if (a.image_url) {
        addPhoto({
          photo_url: a.image_url,
          stage: 'IA_ORIGINAL',
          stage_label: 'Auditoria IA (Original)',
          area: a.area || 'Gôndola',
          caption: a.auto_report || '',
          captured_at: a.created_at || '',
          is_panoramic: Boolean(a.is_panoramic),
        });
      }
      if (a.annotated_image_url) {
        addPhoto({
          photo_url: a.annotated_image_url,
          stage: 'IA_DEMARCADA',
          stage_label: 'Auditoria IA (Demarcada)',
          area: a.area || 'Gôndola',
          caption: a.auto_report || '',
          captured_at: a.created_at || '',
          is_panoramic: Boolean(a.is_panoramic),
        });
      }
    });

    // Embutir imagens em base64 direto no servidor (zero CORS, garantido no PDF no celular e desktop)
    // Prioriza Selfie, Fotos Finais e Fotos Iniciais, ajustando compressão para caber 100% das fotos no PDF
    if (includeImages && gallery.length > 0) {
      const count = gallery.length;
      const maxW = count <= 12 ? 760 : count <= 24 ? 580 : count <= 40 ? 460 : 380;
      const qual = count <= 12 ? 78 : count <= 24 ? 70 : count <= 40 ? 62 : 55;
      const MAX_TOTAL_BYTES = 3_400_000;
      let usedBytes = 0;

      const stagePriority = (s) => {
        const u = String(s || '').toUpperCase();
        if (u === 'FINAL') return 0;
        if (u === 'INICIAL') return 1;
        if (u === 'SELFIE_ENTRADA') return 2;
        if (u === 'EXPOSICAO_DEPOIS' || u === 'EXPOSICAO_ANTES') return 3;
        return 4;
      };
      const embedOrder = [...gallery].sort((a, b) => stagePriority(a.stage) - stagePriority(b.stage));

      // Processar em lotes de 5 em paralelo para rapidez
      for (let i = 0; i < embedOrder.length; i += 5) {
        const batch = embedOrder.slice(i, i + 5);
        const embedded = await Promise.all(
          batch.map((item) => embedPhotoAsDataUrl(item.photo_url, maxW, qual))
        );
        embedded.forEach((emb, idx) => {
          if (!emb?.data_url) return;
          if (usedBytes + emb.data_url.length > MAX_TOTAL_BYTES) return;
          usedBytes += emb.data_url.length;
          batch[idx].data_url = emb.data_url;
          batch[idx].width = emb.width;
          batch[idx].height = emb.height;
          if (emb.is_panoramic) batch[idx].is_panoramic = true;
        });
      }
    }

    res.json({
      generated_at: nowStr(),
      visit,
      store,
      promoter,
      checklist,
      summary,
      photos: gallery,
    });
  } catch (err) {
    next(err);
  }
});

// --- 5. EVIDÊNCIAS FOTOGRÁFICAS (INICIAL / COMPLEMENTAR / FINAL) ---
router.post('/visits/:id/evidences', upload.single('photo'), async (req, res, next) => {
  let watermarkedPath = null;
  try {
    const vid = Number(req.params.id);
    const visit = await (await col('visits')).findOne({ id: vid });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });
    if (!canOperateVisit(req.user, visit)) {
      return res.status(403).json({ error: 'Você não tem permissão para registrar evidências nesta visita.' });
    }
    if (visit.status === 'Concluída' || visit.status === 'Cancelada') {
      return res.status(403).json({ error: 'Não é permitido alterar evidências de uma visita encerrada.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Captura de fotografia obrigatória. Fotos antigas não são aceitas.' });
    }

    const stage = ['SELFIE_ENTRADA', 'INICIAL', 'COMPLEMENTAR', 'FINAL'].includes(req.body?.stage) ? req.body.stage : 'COMPLEMENTAR';
    const area = req.body?.area || 'Gôndola Principal';
    const caption = req.body?.caption || `Foto ${stage} — ${area}`;
    const replaceEvidenceId = req.body?.replace_evidence_id ? Number(req.body.replace_evidence_id) : null;
    const capturedAt = nowStr();
    const store = await (await col('stores')).findOne({ id: visit.store_id });

    // Aplicar marca d'água discreta (loja auditada + área/tipo + data/hora Brasília) em HD
    let fileToPersist = req.file;
    let fileForTelegram = path.join(uploadDir, req.file.filename);
    let isPanoramic = false;
    try {
      const wm = await applyAuditWatermark({
        imagePath: req.file.path,
        outputDir: uploadDir,
        storeName: store?.name,
        area,
        stage,
        promoterName: req.user?.name,
        capturedAt,
      });
      if (wm?.watermarkedPath) {
        watermarkedPath = wm.watermarkedPath;
        fileToPersist = { path: wm.watermarkedPath, filename: wm.filename, mimetype: wm.mimetype };
        fileForTelegram = wm.watermarkedPath;
        isPanoramic = Boolean(wm.isPanoramic);
      }
    } catch (wmErr) {
      console.error('Aviso ao aplicar marca d\'água na evidência:', wmErr.message);
    }

    const photoUrl = await saveFileToGridFS(fileToPersist);

    // Se for substituição direta de foto errada, apaga a anterior do site e do Telegram automaticamente
    let replacedTelegramDeleted = false;
    const evCol = await col('visit_evidences');
    let replacedOldUrl = null;
    if (replaceEvidenceId) {
      const oldEv = await evCol.findOne({ id: replaceEvidenceId, visit_id: vid, is_active: { $ne: 0 } });
      if (oldEv) {
        replacedOldUrl = oldEv.photo_url || null;
        if (oldEv.telegram_message_id) {
          const delRes = await deleteTelegramMessage({
            messageId: oldEv.telegram_message_id,
            chatId: oldEv.telegram_chat_id,
          });
          replacedTelegramDeleted = Boolean(delRes?.deleted);
        }
        await evCol.updateOne(
          { id: oldEv.id },
          {
            $set: {
              is_active: 0,
              replaced_at: capturedAt,
              replaced_by: req.user.id,
              telegram_deleted: replacedTelegramDeleted,
            },
          }
        );
        await logAudit(
          req.user,
          'REPLACE_EVIDENCE',
          'visit_evidences',
          oldEv.id,
          `Foto #${oldEv.id} substituída | TG_DELETED=${replacedTelegramDeleted}`
        );
      }
    }

    const tgRes = await sendPhotoToTelegram({
      filePath: fileForTelegram,
      stage,
      area,
      visitId: vid,
      isPanoramic,
      storeName: store?.name,
      promoterName: req.user?.name,
      details: caption,
    });

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
      is_panoramic: isPanoramic,
      telegram_message_id: tgRes?.message_id || null,
      telegram_chat_id: tgRes?.chat_id || null,
      captured_at: capturedAt,
      is_active: 1,
    };
    await evCol.insertOne(doc);

    // Sincronizar também em photos_json para compatibilidade legada
    const photos = JSON.parse(visit.photos_json || '[]').filter((p) => !replacedOldUrl || p.url !== replacedOldUrl);
    photos.push({
      photo_id: id,
      url: photoUrl,
      area,
      is_panoramic: isPanoramic,
      telegram_message_id: tgRes?.message_id || null,
      telegram_chat_id: tgRes?.chat_id || null,
      caption: `[${stage}] ${area}: ${caption}`,
      created_at: new Date().toISOString(),
    });
    await (await col('visits')).updateOne({ id: vid }, { $set: { photos_json: JSON.stringify(photos) } });

    await logAudit(
      req.user,
      'UPLOAD_EVIDENCE',
      'visit_evidences',
      id,
      `Foto ${stage} (${area}${isPanoramic ? ', Panorâmica' : ''}) na visita #${vid} | TG=${Boolean(tgRes?.sent)}`
    );
    res.status(201).json({
      ...doc,
      telegram_sent: Boolean(tgRes?.sent),
      replaced_telegram_deleted: replacedTelegramDeleted,
    });
  } catch (err) {
    next(err);
  } finally {
    await Promise.all([cleanupUploadedFile(req.file), cleanupUploadedFile(watermarkedPath)]);
  }
});

// Refazer foto antes da conclusão (soft-delete com auditoria)
router.delete('/visits/:id/evidences/:evId', async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const evId = Number(req.params.evId);
    const visit = await (await col('visits')).findOne({ id: vid });
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });
    if (!canOperateVisit(req.user, visit)) {
      return res.status(403).json({ error: 'Você não tem permissão para remover evidências nesta visita.' });
    }
    if (visit.status === 'Concluída' || visit.status === 'Cancelada') {
      return res.status(403).json({ error: 'Proibido excluir evidências de visita encerrada.' });
    }

    const evCol = await col('visit_evidences');
    const ev = await evCol.findOne({ id: evId, visit_id: vid });
    if (!ev) return res.status(404).json({ error: 'Evidência não encontrada.' });

    // Apagar automaticamente a mensagem/foto enviada anteriormente pelo bot no Telegram
    let telegramDeleted = false;
    if (ev.telegram_message_id) {
      const delRes = await deleteTelegramMessage({
        messageId: ev.telegram_message_id,
        chatId: ev.telegram_chat_id,
      });
      telegramDeleted = Boolean(delRes?.deleted);
    }

    await evCol.updateOne(
      { id: evId },
      {
        $set: {
          is_active: 0,
          replaced_at: nowStr(),
          replaced_by: req.user.id,
          telegram_deleted: telegramDeleted,
        },
      }
    );

    if (ev.photo_url) {
      try {
        const photos = JSON.parse(visit.photos_json || '[]').filter((p) => p.url !== ev.photo_url);
        await (await col('visits')).updateOne({ id: vid }, { $set: { photos_json: JSON.stringify(photos) } });
      } catch {
        // ignore malformed photos_json
      }
    }

    await logAudit(
      req.user,
      'RETAKE_EVIDENCE',
      'visit_evidences',
      evId,
      `Foto #${evId} apagada/refeita | TG_DELETED=${telegramDeleted}`
    );
    res.json({ success: true, telegram_deleted: telegramDeleted });
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
    if (!canOperateVisit(req.user, visit)) {
      return res.status(403).json({ error: 'Você não tem permissão para operar esta visita.' });
    }
    if (visit.status === 'Concluída' || visit.status === 'Cancelada') {
      return res.status(403).json({ error: 'Visita já encerrada.' });
    }

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
    if (!canOperateVisit(req.user, visit)) {
      return res.status(403).json({ error: 'Você não tem permissão para registrar diagnóstico nesta visita.' });
    }
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

    // Idempotência: remover ocorrências automáticas abertas geradas em envio anterior do diagnóstico desta visita
    const occCol = await col('occurrences');
    await occCol.deleteMany({
      visit_id: vid,
      source: { $in: ['diagnostico', 'diagnostico_complementar'] },
      status: 'Aberta',
    });

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
    if (!canOperateVisit(req.user, visit)) {
      return res.status(403).json({ error: 'Você não tem permissão para operar esta visita.' });
    }
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
