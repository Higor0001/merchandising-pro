const express = require('express');
const { db } = require('../db/database');
const { createDefaultChecklist } = require('../db/seed');
const { authenticate, logAudit } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();
router.use(authenticate);

// --- STORES ---
router.get('/stores', (_req, res) => {
  const stores = db.prepare('SELECT * FROM stores ORDER BY name').all();
  res.json(stores);
});

router.post('/stores', (req, res) => {
  const { name, type, banner, network, address, city, region, route_name, visit_frequency, contact_name, contact_phone } = req.body || {};
  if (!name || !address) return res.status(400).json({ error: 'Nome e endereço da loja são obrigatórios.' });

  const r = db.prepare(`
    INSERT INTO stores (name, type, banner, network, address, city, region, route_name, visit_frequency, contact_name, contact_phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    type || 'Supermercado',
    banner || '',
    network || '',
    address,
    city || '',
    region || 'Centro',
    route_name || 'Rota Padrão',
    visit_frequency || 'Semanal',
    contact_name || '',
    contact_phone || ''
  );
  logAudit(req.user, 'CREATE', 'stores', r.lastInsertRowid, `Loja ${name} cadastrada`);
  res.status(201).json(db.prepare('SELECT * FROM stores WHERE id = ?').get(r.lastInsertRowid));
});

router.put('/stores/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Loja não encontrada.' });

  const b = req.body || {};
  db.prepare(`
    UPDATE stores SET name=?, type=?, banner=?, network=?, address=?, city=?, region=?, route_name=?, visit_frequency=?, contact_name=?, contact_phone=?, active=?
    WHERE id=?
  `).run(
    b.name ?? existing.name,
    b.type ?? existing.type,
    b.banner ?? existing.banner,
    b.network ?? existing.network,
    b.address ?? existing.address,
    b.city ?? existing.city,
    b.region ?? existing.region,
    b.route_name ?? existing.route_name,
    b.visit_frequency ?? existing.visit_frequency,
    b.contact_name ?? existing.contact_name,
    b.contact_phone ?? existing.contact_phone,
    b.active !== undefined ? (b.active ? 1 : 0) : existing.active,
    id
  );
  logAudit(req.user, 'UPDATE', 'stores', Number(id), `Loja ${existing.name} atualizada`);
  res.json(db.prepare('SELECT * FROM stores WHERE id = ?').get(id));
});

router.get('/stores/:id/history', (req, res) => {
  const { id } = req.params;
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' });

  const visits = db.prepare(`
    SELECT v.*, u.name as promoter_name
    FROM visits v JOIN users u ON u.id = v.promoter_id
    WHERE v.store_id = ? ORDER BY v.scheduled_date DESC, v.id DESC LIMIT 30
  `).all(id);
  const occurrences = db.prepare('SELECT * FROM occurrences WHERE store_id = ? ORDER BY created_at DESC LIMIT 30').all(id);
  const replenishments = db.prepare(`
    SELECT r.*, p.name as product_name FROM replenishments r JOIN products p ON p.id = r.product_id
    WHERE r.store_id = ? ORDER BY r.created_at DESC LIMIT 30
  `).all(id);
  const displays = db.prepare('SELECT * FROM displays_exposures WHERE store_id = ? ORDER BY created_at DESC LIMIT 20').all(id);

  res.json({ store, visits, occurrences, replenishments, displays });
});

// --- ROUTES ---
router.get('/routes', (_req, res) => {
  const routes = db.prepare(`
    SELECT r.*, u.name as promoter_name
    FROM routes r LEFT JOIN users u ON u.id = r.promoter_id
    ORDER BY r.day_of_week, r.name
  `).all();
  res.json(routes);
});

router.post('/routes', (req, res) => {
  const { name, region, promoter_id, day_of_week, store_ids, notes } = req.body || {};
  if (!name || !day_of_week) return res.status(400).json({ error: 'Nome da rota e dia da semana são obrigatórios.' });

  const r = db.prepare(`
    INSERT INTO routes (name, region, promoter_id, day_of_week, store_ids_json, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, region || 'Centro', promoter_id || req.user.id, day_of_week, JSON.stringify(store_ids || []), notes || '');
  logAudit(req.user, 'CREATE', 'routes', r.lastInsertRowid, `Rota ${name} criada`);
  res.status(201).json(db.prepare('SELECT * FROM routes WHERE id = ?').get(r.lastInsertRowid));
});

// --- VISITS & CHECKLISTS ---
router.get('/visits', (req, res) => {
  const { status, store_id, promoter_id } = req.query;
  let sql = `
    SELECT v.*, s.name as store_name, s.type as store_type, s.address as store_address, s.region as store_region,
           u.name as promoter_name,
           (SELECT COUNT(*) FROM visit_checklists vc WHERE vc.visit_id = v.id) as checklist_total,
           (SELECT COUNT(*) FROM visit_checklists vc WHERE vc.visit_id = v.id AND vc.completed = 1) as checklist_done
    FROM visits v
    JOIN stores s ON s.id = v.store_id
    JOIN users u ON u.id = v.promoter_id
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND v.status = ?'; params.push(status); }
  if (store_id) { sql += ' AND v.store_id = ?'; params.push(store_id); }
  if (promoter_id) { sql += ' AND v.promoter_id = ?'; params.push(promoter_id); }
  sql += ' ORDER BY v.scheduled_date DESC, v.scheduled_time ASC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/visits', (req, res) => {
  const { store_id, promoter_id, route_id, scheduled_date, scheduled_time, notes } = req.body || {};
  if (!store_id || !scheduled_date) return res.status(400).json({ error: 'Loja e data são obrigatórias.' });

  const r = db.prepare(`
    INSERT INTO visits (store_id, promoter_id, route_id, scheduled_date, scheduled_time, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(store_id, promoter_id || req.user.id, route_id || null, scheduled_date, scheduled_time || '08:00', notes || '');
  createDefaultChecklist(r.lastInsertRowid, 0);
  logAudit(req.user, 'CREATE', 'visits', r.lastInsertRowid, `Visita agendada para loja #${store_id}`);
  res.status(201).json(db.prepare('SELECT * FROM visits WHERE id = ?').get(r.lastInsertRowid));
});

router.post('/visits/:id/checkin', (req, res) => {
  const { id } = req.params;
  const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
  if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const { lat, lng } = req.body || {};
  db.prepare(`
    UPDATE visits SET checkin_at = COALESCE(checkin_at, ?), status = 'Em Andamento', checkin_lat = ?, checkin_lng = ?
    WHERE id = ?
  `).run(now, lat || null, lng || null, id);
  db.prepare("UPDATE visit_checklists SET completed = 1 WHERE visit_id = ? AND item_key = 'loja_visitada'").run(id);

  logAudit(req.user, 'CHECKIN', 'visits', Number(id), `Check-in realizado na visita #${id}`);
  res.json(db.prepare('SELECT * FROM visits WHERE id = ?').get(id));
});

router.post('/visits/:id/checkout', (req, res) => {
  const { id } = req.params;
  const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
  if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });

  const nowDate = new Date();
  const now = nowDate.toISOString().replace('T', ' ').slice(0, 19);
  let duration = 45;
  if (visit.checkin_at) {
    const start = new Date(visit.checkin_at.replace(' ', 'T'));
    const diff = Math.round((nowDate - start) / 60000);
    if (!Number.isNaN(diff) && diff >= 1) duration = diff;
  }

  const { notes, problems_found, opportunities_found } = req.body || {};
  db.prepare(`
    UPDATE visits SET checkout_at = ?, duration_minutes = ?, status = 'Concluída',
      notes = COALESCE(?, notes), problems_found = COALESCE(?, problems_found), opportunities_found = COALESCE(?, opportunities_found)
    WHERE id = ?
  `).run(now, duration, notes ?? null, problems_found ?? null, opportunities_found ?? null, id);

  logAudit(req.user, 'CHECKOUT', 'visits', Number(id), `Check-out realizado (${duration} min)`);
  res.json(db.prepare('SELECT * FROM visits WHERE id = ?').get(id));
});

router.post('/visits/:id/photos', upload.single('photo'), (req, res) => {
  const { id } = req.params;
  const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
  if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });
  if (!req.file) return res.status(400).json({ error: 'Nenhuma foto enviada.' });

  const photos = JSON.parse(visit.photos_json || '[]');
  const photoUrl = `/uploads/${req.file.filename}`;
  photos.push({ url: photoUrl, caption: req.body?.caption || 'Foto da visita', created_at: new Date().toISOString() });
  db.prepare('UPDATE visits SET photos_json = ? WHERE id = ?').run(JSON.stringify(photos), id);
  res.json({ photoUrl, photos });
});

router.get('/visits/:id/checklist', (req, res) => {
  const items = db.prepare('SELECT * FROM visit_checklists WHERE visit_id = ? ORDER BY id').all(req.params.id);
  res.json(items);
});

router.patch('/visits/:id/checklist/:itemId', (req, res) => {
  const { id, itemId } = req.params;
  const { completed, notes } = req.body || {};
  db.prepare(
    "UPDATE visit_checklists SET completed = ?, notes = COALESCE(?, notes), updated_at = datetime('now', 'localtime') WHERE id = ? AND visit_id = ?"
  ).run(completed ? 1 : 0, notes ?? null, itemId, id);
  res.json(db.prepare('SELECT * FROM visit_checklists WHERE visit_id = ? ORDER BY id').all(id));
});

router.post('/visits/:id/checklist', (req, res) => {
  const { id } = req.params;
  const { label } = req.body || {};
  if (!label) return res.status(400).json({ error: 'Descrição do item é obrigatória.' });
  const key = `custom_${Date.now()}`;
  db.prepare('INSERT INTO visit_checklists (visit_id, item_key, label, completed, is_custom) VALUES (?, ?, ?, 0, 1)').run(id, key, label);
  res.status(201).json(db.prepare('SELECT * FROM visit_checklists WHERE visit_id = ? ORDER BY id').all(id));
});

module.exports = router;
