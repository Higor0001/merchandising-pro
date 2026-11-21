const express = require('express');
const path = require('node:path');
const { db } = require('../db/database');
const { authenticate, logAudit } = require('../middleware/auth');
const { upload, uploadDir } = require('../middleware/upload');
const { analyzeShelfImage, generateStoreSummary } = require('../services/aiService');
const { sendPhotoToTelegram } = require('../services/telegramService');

const router = express.Router();
router.use(authenticate);

// --- PRICE CHECKS & COMPETITOR RESEARCH ---
router.get('/prices', (req, res) => {
  const { store_id, product_id } = req.query;
  let sql = `
    SELECT pc.*, s.name as store_name, p.name as product_name, p.sku, b.name as brand_name, u.name as promoter_name
    FROM price_checks pc
    JOIN stores s ON s.id = pc.store_id
    JOIN products p ON p.id = pc.product_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN users u ON u.id = pc.promoter_id
    WHERE 1=1
  `;
  const params = [];
  if (store_id) { sql += ' AND pc.store_id = ?'; params.push(store_id); }
  if (product_id) { sql += ' AND pc.product_id = ?'; params.push(product_id); }
  sql += ' ORDER BY pc.created_at DESC LIMIT 120';
  res.json(db.prepare(sql).all(...params));
});

router.post('/prices', upload.single('photo'), async (req, res) => {
  const { visit_id, store_id, product_id, gondola_price, promo_price, has_price_tag, competitor_name, competitor_price, notes } = req.body || {};
  if (!store_id || !product_id) return res.status(400).json({ error: 'Loja e produto são obrigatórios.' });

  const product = db.prepare('SELECT name, system_price FROM products WHERE id = ?').get(product_id);
  const sysPrice = product ? Number(product.system_price) : 0;
  const gPrice = gondola_price !== '' && gondola_price !== undefined && gondola_price !== null ? Number(gondola_price) : null;
  const tagPresent = has_price_tag === 'false' || has_price_tag === false || has_price_tag === '0' ? 0 : 1;
  const divergent = tagPresent === 0 || (gPrice !== null && Math.abs(gPrice - sysPrice) > 0.01) ? 1 : 0;
  const photoUrl = req.file ? `/uploads/${req.file.filename}` : '';

  const r = db.prepare(`
    INSERT INTO price_checks (visit_id, store_id, product_id, promoter_id, gondola_price, system_price, promo_price, has_price_tag, price_divergent, competitor_name, competitor_price, photo_url, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    visit_id || null,
    store_id,
    product_id,
    req.user.id,
    gPrice,
    sysPrice,
    promo_price ? Number(promo_price) : null,
    tagPresent,
    divergent,
    competitor_name || '',
    competitor_price ? Number(competitor_price) : null,
    photoUrl,
    notes || ''
  );

  if (tagPresent === 0) {
    db.prepare(`
      INSERT INTO occurrences (visit_id, store_id, product_id, promoter_id, type, priority, description, photo_url, status)
      VALUES (?, ?, ?, ?, 'Falta de Preço', 'Média', ?, ?, 'Aberta')
    `).run(visit_id || null, store_id, product_id, req.user.id, notes || 'Produto sem etiqueta de preço na gôndola.', photoUrl);
  }

  if (req.file) {
    const store = db.prepare('SELECT name FROM stores WHERE id = ?').get(store_id);
    await sendPhotoToTelegram({
      filePath: path.join(uploadDir, req.file.filename),
      reason: 'Precificação / Conferência de Etiqueta',
      storeName: store?.name,
      promoterName: req.user?.name,
      details: `Produto: ${product?.name || product_id} | Preço Gôndola: ${gPrice !== null ? `R$ ${gPrice.toFixed(2)}` : 'Sem etiqueta'}${notes ? ` | Obs: ${notes}` : ''}`,
    });
  }

  logAudit(req.user, 'CREATE', 'price_checks', r.lastInsertRowid, `Preço conferido produto #${product_id}`);
  res.status(201).json({ id: r.lastInsertRowid, price_divergent: divergent, photo_url: photoUrl });
});

// --- EXPIRY & QUALITY ---
router.get('/expiries', (_req, res) => {
  const rows = db.prepare(`
    SELECT ec.*, s.name as store_name, p.name as product_name, p.sku, u.name as promoter_name
    FROM expiry_checks ec
    JOIN stores s ON s.id = ec.store_id
    JOIN products p ON p.id = ec.product_id
    LEFT JOIN users u ON u.id = ec.promoter_id
    ORDER BY ec.expiry_date ASC LIMIT 120
  `).all();
  res.json(rows);
});

router.post('/expiries', (req, res) => {
  const { visit_id, store_id, product_id, batch_code, expiry_date, quantity, fifo_fefo_applied, condition, removal_requested, estimated_loss, notes } = req.body || {};
  if (!store_id || !product_id || !expiry_date) return res.status(400).json({ error: 'Loja, produto e data de validade são obrigatórios.' });

  const r = db.prepare(`
    INSERT INTO expiry_checks (visit_id, store_id, product_id, promoter_id, batch_code, expiry_date, quantity, fifo_fefo_applied, condition, removal_requested, estimated_loss, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    visit_id || null,
    store_id,
    product_id,
    req.user.id,
    batch_code || '',
    expiry_date,
    Number(quantity || 1),
    fifo_fefo_applied === false ? 0 : 1,
    condition || 'Normal',
    removal_requested ? 1 : 0,
    Number(estimated_loss || 0),
    notes || ''
  );
  logAudit(req.user, 'CREATE', 'expiry_checks', r.lastInsertRowid, `Validade ${condition || 'Normal'} registrada`);
  res.status(201).json({ id: r.lastInsertRowid });
});

// --- STORE INVENTORY (SUPPORT FOR MERCHANDISING) ---
router.get('/inventory', (_req, res) => {
  const stock = db.prepare(`
    SELECT si.*, s.name as store_name, p.name as product_name, p.sku, p.min_stock, b.name as brand_name, p.category
    FROM store_inventory si
    JOIN stores s ON s.id = si.store_id
    JOIN products p ON p.id = si.product_id
    LEFT JOIN brands b ON b.id = p.brand_id
    ORDER BY s.name, p.name
  `).all();
  const movements = db.prepare(`
    SELECT im.*, s.name as store_name, p.name as product_name, u.name as user_name
    FROM inventory_movements im
    JOIN stores s ON s.id = im.store_id
    JOIN products p ON p.id = im.product_id
    LEFT JOIN users u ON u.id = im.user_id
    ORDER BY im.created_at DESC LIMIT 80
  `).all();
  res.json({ stock, movements });
});

router.post('/inventory/movement', (req, res) => {
  const { store_id, product_id, movement_type, quantity, gondola_qty, backroom_qty, separated_for_merchandising, notes } = req.body || {};
  if (!store_id || !product_id || !movement_type) {
    return res.status(400).json({ error: 'Loja, produto e tipo de movimentação são obrigatórios.' });
  }
  const qty = Number(quantity || 0);
  const existing = db.prepare('SELECT * FROM store_inventory WHERE store_id = ? AND product_id = ?').get(store_id, product_id);

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

  db.prepare(`
    INSERT INTO store_inventory (store_id, product_id, gondola_qty, backroom_qty, separated_for_merchandising, last_inventory_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    ON CONFLICT(store_id, product_id) DO UPDATE SET
      gondola_qty = excluded.gondola_qty,
      backroom_qty = excluded.backroom_qty,
      separated_for_merchandising = excluded.separated_for_merchandising,
      last_inventory_at = datetime('now', 'localtime'),
      updated_at = datetime('now', 'localtime')
  `).run(store_id, product_id, newGondola, newBackroom, newSep);

  db.prepare(`
    INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(store_id, product_id, req.user.id, movement_type, qty, notes || '');

  logAudit(req.user, 'MOVEMENT', 'store_inventory', product_id, `${movement_type} (${qty}) na loja #${store_id}`);
  res.status(201).json({ success: true });
});

// --- CAMPAIGNS ---
router.get('/campaigns', (_req, res) => {
  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY start_date DESC').all();
  const executions = db.prepare(`
    SELECT ce.*, s.name as store_name, u.name as promoter_name, c.title as campaign_title
    FROM campaign_executions ce
    JOIN stores s ON s.id = ce.store_id
    JOIN campaigns c ON c.id = ce.campaign_id
    LEFT JOIN users u ON u.id = ce.promoter_id
    ORDER BY ce.executed_at DESC
  `).all();
  res.json({ campaigns, executions });
});

router.post('/campaigns', (req, res) => {
  const { title, description, start_date, end_date, product_ids, store_ids, materials_needed, checklist } = req.body || {};
  if (!title || !start_date || !end_date) return res.status(400).json({ error: 'Título e período são obrigatórios.' });

  const r = db.prepare(`
    INSERT INTO campaigns (title, description, start_date, end_date, product_ids_json, store_ids_json, materials_needed, checklist_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, description || '', start_date, end_date, JSON.stringify(product_ids || []), JSON.stringify(store_ids || []), materials_needed || '', JSON.stringify(checklist || []));
  logAudit(req.user, 'CREATE', 'campaigns', r.lastInsertRowid, `Campanha ${title} criada`);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.post('/campaigns/:id/execute', upload.single('photo'), async (req, res) => {
  const { id } = req.params;
  const { store_id, visit_id, compliant, checklist_status, notes } = req.body || {};
  if (!store_id) return res.status(400).json({ error: 'Loja é obrigatória.' });

  const photoUrl = req.file ? `/uploads/${req.file.filename}` : '';
  const r = db.prepare(`
    INSERT INTO campaign_executions (campaign_id, store_id, visit_id, promoter_id, checklist_status_json, compliant, photo_url, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, store_id, visit_id || null, req.user.id, checklist_status || '[]', compliant === 'false' || compliant === false ? 0 : 1, photoUrl, notes || '');

  if (req.file) {
    const store = db.prepare('SELECT name FROM stores WHERE id = ?').get(store_id);
    const camp = db.prepare('SELECT title FROM campaigns WHERE id = ?').get(id);
    await sendPhotoToTelegram({
      filePath: path.join(uploadDir, req.file.filename),
      reason: `Comprovação de Campanha (${camp?.title || `#${id}`})`,
      storeName: store?.name,
      promoterName: req.user?.name,
      details: notes || 'Campanha implantada no PDV',
    });
  }

  logAudit(req.user, 'EXECUTE', 'campaign_executions', r.lastInsertRowid, `Campanha #${id} executada na loja #${store_id}`);
  res.status(201).json({ id: r.lastInsertRowid, photo_url: photoUrl });
});

// --- OCCURRENCES (RUPTURES & OPPORTUNITIES) ---
router.get('/occurrences', (req, res) => {
  const { status, type, priority } = req.query;
  let sql = `
    SELECT o.*, s.name as store_name, p.name as product_name, u.name as promoter_name
    FROM occurrences o
    JOIN stores s ON s.id = o.store_id
    LEFT JOIN products p ON p.id = o.product_id
    LEFT JOIN users u ON u.id = o.promoter_id
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND o.status = ?'; params.push(status); }
  if (type) { sql += ' AND o.type = ?'; params.push(type); }
  if (priority) { sql += ' AND o.priority = ?'; params.push(priority); }
  sql += ' ORDER BY CASE o.priority WHEN "Alta" THEN 1 WHEN "Média" THEN 2 ELSE 3 END, o.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/occurrences', upload.single('photo'), async (req, res) => {
  const { visit_id, store_id, product_id, type, priority, description } = req.body || {};
  if (!store_id || !type || !description) return res.status(400).json({ error: 'Loja, tipo e descrição são obrigatórios.' });

  const photoUrl = req.file ? `/uploads/${req.file.filename}` : '';
  const r = db.prepare(`
    INSERT INTO occurrences (visit_id, store_id, product_id, promoter_id, type, priority, description, photo_url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Aberta')
  `).run(visit_id || null, store_id, product_id || null, req.user.id, type, priority || 'Média', description, photoUrl);

  if (req.file) {
    const store = db.prepare('SELECT name FROM stores WHERE id = ?').get(store_id);
    await sendPhotoToTelegram({
      filePath: path.join(uploadDir, req.file.filename),
      reason: `Ocorrência: ${type} (Prioridade ${priority || 'Média'})`,
      storeName: store?.name,
      promoterName: req.user?.name,
      details: description,
    });
  }

  logAudit(req.user, 'CREATE', 'occurrences', r.lastInsertRowid, `Ocorrência ${type} (${priority || 'Média'})`);
  res.status(201).json({ id: r.lastInsertRowid, photo_url: photoUrl });
});

router.patch('/occurrences/:id', (req, res) => {
  const { id } = req.params;
  const { status, priority } = req.body || {};
  const existing = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Ocorrência não encontrada.' });

  const newStatus = status || existing.status;
  const resolvedAt = newStatus === 'Resolvida' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : existing.resolved_at;
  db.prepare('UPDATE occurrences SET status = ?, priority = ?, resolved_at = ? WHERE id = ?')
    .run(newStatus, priority || existing.priority, resolvedAt, id);

  logAudit(req.user, 'UPDATE', 'occurrences', Number(id), `Ocorrência #${id} alterada para ${newStatus}`);
  res.json(db.prepare('SELECT * FROM occurrences WHERE id = ?').get(id));
});

// --- AI SHELF ANALYSIS & STORE SUMMARY ---
router.get('/ai/analyses', (_req, res) => {
  const rows = db.prepare(`
    SELECT a.*, s.name as store_name, u.name as user_name
    FROM ai_analyses a
    LEFT JOIN stores s ON s.id = a.store_id
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC LIMIT 50
  `).all();
  res.json(rows);
});

router.post('/ai/analyze-shelf', upload.single('photo'), async (req, res) => {
  const { store_id, visit_id, notes } = req.body || {};
  const imagePath = req.file ? path.join(uploadDir, req.file.filename) : null;
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : '';

  const result = analyzeShelfImage({ storeId: store_id, visitId: visit_id, imagePath, notes });
  const r = db.prepare(`
    INSERT INTO ai_analyses (visit_id, store_id, user_id, image_url, detected_ruptures_json, detected_brands_json, exposure_issues_json, planogram_score, suggestions_json, extra_point_opportunities_json, auto_report, confidence, human_validation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendente')
  `).run(
    visit_id || null,
    store_id || null,
    req.user.id,
    imageUrl,
    JSON.stringify(result.detected_ruptures),
    JSON.stringify(result.detected_brands),
    JSON.stringify(result.exposure_issues),
    result.planogram_score,
    JSON.stringify(result.suggestions),
    JSON.stringify(result.extra_point_opportunities),
    result.auto_report,
    result.confidence
  );

  if (imagePath) {
    const store = store_id ? db.prepare('SELECT name FROM stores WHERE id = ?').get(store_id) : null;
    await sendPhotoToTelegram({
      filePath: imagePath,
      reason: `Análise de Gôndola com IA (Score: ${result.planogram_score}% | Confiança: ${result.confidence}%)`,
      storeName: store?.name,
      promoterName: req.user?.name,
      details: `${result.auto_report}${notes ? ` | Contexto: ${notes}` : ''}`,
    });
  }

  logAudit(req.user, 'AI_ANALYZE', 'ai_analyses', r.lastInsertRowid, `Análise IA de gôndola (confiança ${result.confidence}%)`);
  res.status(201).json(db.prepare('SELECT * FROM ai_analyses WHERE id = ?').get(r.lastInsertRowid));
});

router.patch('/ai/analyses/:id/validate', (req, res) => {
  const { id } = req.params;
  const { human_validation, human_notes } = req.body || {};
  db.prepare('UPDATE ai_analyses SET human_validation = ?, human_notes = ? WHERE id = ?')
    .run(human_validation || 'Confirmado', human_notes || '', id);
  logAudit(req.user, 'AI_VALIDATE', 'ai_analyses', Number(id), `Validação humana: ${human_validation}`);
  res.json(db.prepare('SELECT * FROM ai_analyses WHERE id = ?').get(id));
});

router.get('/ai/store-summary/:storeId', (req, res) => {
  const summary = generateStoreSummary(req.params.storeId);
  if (!summary) return res.status(404).json({ error: 'Loja não encontrada.' });
  res.json(summary);
});

// --- DASHBOARD KPIs ---
router.get('/dashboard', (_req, res) => {
  const storesVisited = db.prepare("SELECT COUNT(DISTINCT store_id) as c FROM visits WHERE status IN ('Concluída', 'Em Andamento')").get().c;
  const visitsDone = db.prepare("SELECT COUNT(*) as c FROM visits WHERE status = 'Concluída'").get().c;
  const visitsPending = db.prepare("SELECT COUNT(*) as c FROM visits WHERE status IN ('Pendente', 'Em Andamento')").get().c;
  const productsReplenished = db.prepare('SELECT COALESCE(SUM(quantity_replenished), 0) as c FROM replenishments').get().c;
  const rupturesIdentified = db.prepare("SELECT COUNT(*) as c FROM occurrences WHERE type = 'Ruptura'").get().c;
  const rupturesSolved = db.prepare("SELECT COUNT(*) as c FROM occurrences WHERE type = 'Ruptura' AND status = 'Resolvida'").get().c;

  const checklistStats = db.prepare('SELECT COUNT(*) as total, SUM(completed) as done FROM visit_checklists').get();
  const checklistPct = checklistStats.total ? Number(((checklistStats.done / checklistStats.total) * 100).toFixed(1)) : 0;

  const productsWithoutPrice = db.prepare('SELECT COUNT(*) as c FROM price_checks WHERE has_price_tag = 0').get().c;
  const nearExpiry = db.prepare("SELECT COUNT(*) as c FROM expiry_checks WHERE condition IN ('Próximo Vencimento', 'Vencido')").get().c;
  const extraPoints = db.prepare("SELECT COUNT(*) as c FROM displays_exposures WHERE exposure_type IN ('Ponto Extra', 'Ilha Promocional', 'Display', 'Ponta de Gôndola')").get().c;
  const campaignsExecuted = db.prepare('SELECT COUNT(*) as c FROM campaign_executions WHERE compliant = 1').get().c;
  const avgShareRow = db.prepare('SELECT AVG(share_of_shelf) as avg_share FROM planogram_audits').get();
  const shareOfShelf = avgShareRow.avg_share ? Number(avgShareRow.avg_share.toFixed(1)) : 0;
  const openOccurrences = db.prepare("SELECT COUNT(*) as c FROM occurrences WHERE status != 'Resolvida'").get().c;
  const avgDurationRow = db.prepare("SELECT AVG(duration_minutes) as avg_dur FROM visits WHERE status = 'Concluída' AND duration_minutes > 0").get();
  const avgVisitMinutes = avgDurationRow.avg_dur ? Math.round(avgDurationRow.avg_dur) : 0;

  const recentVisits = db.prepare(`
    SELECT v.*, s.name as store_name, u.name as promoter_name
    FROM visits v JOIN stores s ON s.id = v.store_id JOIN users u ON u.id = v.promoter_id
    ORDER BY v.scheduled_date DESC, v.id DESC LIMIT 6
  `).all();

  const criticalOccurrences = db.prepare(`
    SELECT o.*, s.name as store_name
    FROM occurrences o JOIN stores s ON s.id = o.store_id
    WHERE o.status != 'Resolvida'
    ORDER BY CASE o.priority WHEN 'Alta' THEN 1 WHEN 'Média' THEN 2 ELSE 3 END, o.created_at DESC LIMIT 5
  `).all();

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
});

// --- REPORTS DATA ---
router.get('/reports/:type', (req, res) => {
  const { type } = req.params;
  switch (type) {
    case 'lojas':
      return res.json(db.prepare('SELECT name as Loja, type as Tipo, banner as Bandeira, network as Rede, region as Região, visit_frequency as Frequência, contact_name as Contato FROM stores').all());
    case 'visitas':
      return res.json(db.prepare('SELECT v.scheduled_date as Data, s.name as Loja, u.name as Promotor, v.status as Status, v.checkin_at as CheckIn, v.checkout_at as CheckOut, v.duration_minutes as Minutos FROM visits v JOIN stores s ON s.id=v.store_id JOIN users u ON u.id=v.promoter_id').all());
    case 'rupturas':
      return res.json(db.prepare('SELECT o.created_at as Data, s.name as Loja, o.type as Tipo, o.priority as Prioridade, o.status as Status, o.description as Descrição FROM occurrences o JOIN stores s ON s.id=o.store_id').all());
    case 'abastecimento':
      return res.json(db.prepare('SELECT r.created_at as Data, s.name as Loja, p.name as Produto, r.quantity_replenished as Abastecido, r.gondola_stock as Gôndola, r.backroom_stock as Retaguarda, r.status as Status FROM replenishments r JOIN stores s ON s.id=r.store_id JOIN products p ON p.id=r.product_id').all());
    case 'validade':
      return res.json(db.prepare('SELECT ec.expiry_date as Validade, s.name as Loja, p.name as Produto, ec.batch_code as Lote, ec.quantity as Qtd, ec.condition as Condição, ec.estimated_loss as Perda_Estimada FROM expiry_checks ec JOIN stores s ON s.id=ec.store_id JOIN products p ON p.id=ec.product_id').all());
    case 'precificacao':
    case 'concorrencia':
      return res.json(db.prepare('SELECT pc.created_at as Data, s.name as Loja, p.name as Produto, pc.gondola_price as Preço_Gôndola, pc.system_price as Preço_Sistema, pc.promo_price as Promocional, pc.competitor_name as Concorrente, pc.competitor_price as Preço_Concorrente FROM price_checks pc JOIN stores s ON s.id=pc.store_id JOIN products p ON p.id=pc.product_id').all());
    case 'planograma':
      return res.json(db.prepare('SELECT pa.created_at as Data, s.name as Loja, pa.category as Categoria, b.name as Marca, pa.ideal_facings as Ideal, pa.actual_facings as Real, pa.share_of_shelf as Share_Pct, pa.lost_spaces as Espaços_Perdidos FROM planogram_audits pa JOIN stores s ON s.id=pa.store_id LEFT JOIN brands b ON b.id=pa.brand_id').all());
    case 'campanhas':
      return res.json(db.prepare('SELECT c.title as Campanha, s.name as Loja, ce.compliant as Cumprida, ce.executed_at as Executada_Em, ce.notes as Observações FROM campaign_executions ce JOIN campaigns c ON c.id=ce.campaign_id JOIN stores s ON s.id=ce.store_id').all());
    case 'fotografico':
      return res.json(db.prepare('SELECT d.created_at as Data, s.name as Loja, d.exposure_type as Tipo, d.category as Categoria, d.photo_before as Foto_Antes, d.photo_after as Foto_Depois, d.notes as Observações FROM displays_exposures d JOIN stores s ON s.id=d.store_id').all());
    case 'produtividade':
      return res.json(db.prepare("SELECT u.name as Promotor, COUNT(v.id) as Total_Visitas, SUM(CASE WHEN v.status='Concluída' THEN 1 ELSE 0 END) as Concluídas, ROUND(AVG(CASE WHEN v.duration_minutes>0 THEN v.duration_minutes END), 1) as Tempo_Médio_Min FROM users u LEFT JOIN visits v ON v.promoter_id=u.id WHERE u.role='promotor' GROUP BY u.id").all());
    default:
      return res.json(db.prepare('SELECT v.scheduled_date as Data, s.name as Loja, v.status as Visita_Status, v.duration_minutes as Duração_Min, v.notes as Notas FROM visits v JOIN stores s ON s.id=v.store_id').all());
  }
});

module.exports = router;
