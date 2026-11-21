const express = require('express');
const { db } = require('../db/database');
const { authenticate, logAudit } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();
router.use(authenticate);

// --- BRANDS ---
router.get('/brands', (_req, res) => {
  res.json(db.prepare('SELECT * FROM brands ORDER BY is_own DESC, name').all());
});

router.post('/brands', (req, res) => {
  const { name, is_own, color } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nome da marca é obrigatório.' });
  try {
    const r = db.prepare('INSERT INTO brands (name, is_own, color) VALUES (?, ?, ?)').run(name, is_own ? 1 : 0, color || '#2563eb');
    res.status(201).json(db.prepare('SELECT * FROM brands WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(400).json({ error: 'Marca já cadastrada.' });
  }
});

// --- PRODUCTS ---
router.get('/products', (req, res) => {
  const { ean, category, brand_id } = req.query;
  let sql = `
    SELECT p.*, b.name as brand_name, b.is_own, b.color as brand_color
    FROM products p LEFT JOIN brands b ON b.id = p.brand_id
    WHERE 1=1
  `;
  const params = [];
  if (ean) { sql += ' AND p.ean = ?'; params.push(ean); }
  if (category) { sql += ' AND p.category = ?'; params.push(category); }
  if (brand_id) { sql += ' AND p.brand_id = ?'; params.push(brand_id); }
  sql += ' ORDER BY p.name';
  res.json(db.prepare(sql).all(...params));
});

router.post('/products', (req, res) => {
  const { sku, ean, name, brand_id, category, unit, system_price, min_stock, ideal_facings } = req.body || {};
  if (!sku || !ean || !name || !category) {
    return res.status(400).json({ error: 'SKU, EAN, nome e categoria são obrigatórios.' });
  }
  try {
    const r = db.prepare(`
      INSERT INTO products (sku, ean, name, brand_id, category, unit, system_price, min_stock, ideal_facings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sku, ean, name, brand_id || null, category, unit || 'UN', Number(system_price || 0), Number(min_stock || 10), Number(ideal_facings || 4));
    logAudit(req.user, 'CREATE', 'products', r.lastInsertRowid, `Produto ${name} (${sku}) cadastrado`);
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(400).json({ error: 'SKU já cadastrado ou dados inválidos.' });
  }
});

// --- REPLENISHMENTS ---
router.get('/replenishments', (req, res) => {
  const { store_id, status } = req.query;
  let sql = `
    SELECT r.*, s.name as store_name, p.name as product_name, p.sku, p.ean, b.name as brand_name, u.name as promoter_name
    FROM replenishments r
    JOIN stores s ON s.id = r.store_id
    JOIN products p ON p.id = r.product_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN users u ON u.id = r.promoter_id
    WHERE 1=1
  `;
  const params = [];
  if (store_id) { sql += ' AND r.store_id = ?'; params.push(store_id); }
  if (status) { sql += ' AND r.status = ?'; params.push(status); }
  sql += ' ORDER BY r.created_at DESC LIMIT 100';
  res.json(db.prepare(sql).all(...params));
});

router.post('/replenishments', (req, res) => {
  const { visit_id, store_id, product_id, quantity_replenished, backroom_stock, gondola_stock, status, increase_exposure_opportunity, notes } = req.body || {};
  if (!store_id || !product_id) return res.status(400).json({ error: 'Loja e produto são obrigatórios.' });

  const finalStatus = status || 'Abastecido';
  const r = db.prepare(`
    INSERT INTO replenishments (visit_id, store_id, product_id, promoter_id, quantity_replenished, backroom_stock, gondola_stock, status, increase_exposure_opportunity, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    visit_id || null,
    store_id,
    product_id,
    req.user.id,
    Number(quantity_replenished || 0),
    Number(backroom_stock || 0),
    Number(gondola_stock || 0),
    finalStatus,
    increase_exposure_opportunity ? 1 : 0,
    notes || ''
  );

  // Sync store_inventory snapshot
  db.prepare(`
    INSERT INTO store_inventory (store_id, product_id, gondola_qty, backroom_qty, updated_at)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(store_id, product_id) DO UPDATE SET
      gondola_qty = excluded.gondola_qty,
      backroom_qty = excluded.backroom_qty,
      updated_at = datetime('now', 'localtime')
  `).run(store_id, product_id, Number(gondola_stock || 0), Number(backroom_stock || 0));

  // If Ruptura, auto-create occurrence if not already open
  if (finalStatus === 'Ruptura') {
    db.prepare(`
      INSERT INTO occurrences (visit_id, store_id, product_id, promoter_id, type, priority, description, status)
      VALUES (?, ?, ?, ?, 'Ruptura', 'Alta', ?, 'Aberta')
    `).run(visit_id || null, store_id, product_id, req.user.id, notes || 'Ruptura identificada no abastecimento.');
  }

  logAudit(req.user, 'CREATE', 'replenishments', r.lastInsertRowid, `Abastecimento ${finalStatus} loja #${store_id}`);
  res.status(201).json({ id: r.lastInsertRowid });
});

// --- DISPLAYS & EXPOSURES ---
router.get('/displays', (req, res) => {
  const { store_id, exposure_type } = req.query;
  let sql = `
    SELECT d.*, s.name as store_name, b.name as brand_name, u.name as promoter_name
    FROM displays_exposures d
    JOIN stores s ON s.id = d.store_id
    LEFT JOIN brands b ON b.id = d.brand_id
    LEFT JOIN users u ON u.id = d.promoter_id
    WHERE 1=1
  `;
  const params = [];
  if (store_id) { sql += ' AND d.store_id = ?'; params.push(store_id); }
  if (exposure_type) { sql += ' AND d.exposure_type = ?'; params.push(exposure_type); }
  sql += ' ORDER BY d.created_at DESC LIMIT 100';
  res.json(db.prepare(sql).all(...params));
});

router.post(
  '/displays',
  upload.fields([{ name: 'photo_before', maxCount: 1 }, { name: 'photo_after', maxCount: 1 }]),
  (req, res) => {
    const { visit_id, store_id, category, brand_id, exposure_type, facings_actual, facings_expected, planogram_compliant, pos_materials, notes } = req.body || {};
    if (!store_id || !category || !exposure_type) {
      return res.status(400).json({ error: 'Loja, categoria e tipo de exposição são obrigatórios.' });
    }
    const photoBefore = req.files?.photo_before?.[0] ? `/uploads/${req.files.photo_before[0].filename}` : '';
    const photoAfter = req.files?.photo_after?.[0] ? `/uploads/${req.files.photo_after[0].filename}` : '';

    const r = db.prepare(`
      INSERT INTO displays_exposures (visit_id, store_id, promoter_id, category, brand_id, exposure_type, facings_actual, facings_expected, planogram_compliant, pos_materials, photo_before, photo_after, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      visit_id || null,
      store_id,
      req.user.id,
      category,
      brand_id || null,
      exposure_type,
      Number(facings_actual || 0),
      Number(facings_expected || 0),
      planogram_compliant === 'false' || planogram_compliant === false || planogram_compliant === '0' ? 0 : 1,
      pos_materials || '',
      photoBefore,
      photoAfter,
      notes || ''
    );
    logAudit(req.user, 'CREATE', 'displays_exposures', r.lastInsertRowid, `Exposição ${exposure_type} registrada`);
    res.status(201).json({ id: r.lastInsertRowid, photo_before: photoBefore, photo_after: photoAfter });
  }
);

// --- PLANOGRAMS & SHARE OF SHELF ---
router.get('/planograms', (_req, res) => {
  const rows = db.prepare(`
    SELECT pa.*, s.name as store_name, b.name as brand_name, b.is_own, p.name as product_name
    FROM planogram_audits pa
    JOIN stores s ON s.id = pa.store_id
    LEFT JOIN brands b ON b.id = pa.brand_id
    LEFT JOIN products p ON p.id = pa.product_id
    ORDER BY pa.created_at DESC LIMIT 100
  `).all();

  const byBrand = db.prepare(`
    SELECT b.name as brand_name, b.is_own, ROUND(AVG(pa.share_of_shelf), 1) as avg_share,
           SUM(pa.actual_facings) as total_facings, SUM(pa.lost_spaces) as total_lost
    FROM planogram_audits pa
    LEFT JOIN brands b ON b.id = pa.brand_id
    GROUP BY pa.brand_id
  `).all();

  const byCategory = db.prepare(`
    SELECT pa.category, ROUND(AVG(pa.share_of_shelf), 1) as avg_share,
           SUM(pa.actual_facings) as total_facings, SUM(pa.competitor_facings) as competitor_facings
    FROM planogram_audits pa
    GROUP BY pa.category
  `).all();

  const byStore = db.prepare(`
    SELECT s.name as store_name, ROUND(AVG(pa.share_of_shelf), 1) as avg_share,
           ROUND(AVG(pa.compliant) * 100, 1) as compliance_pct
    FROM planogram_audits pa
    JOIN stores s ON s.id = pa.store_id
    GROUP BY pa.store_id
  `).all();

  res.json({ rows, indicators: { byBrand, byCategory, byStore } });
});

router.post('/planograms', (req, res) => {
  const { visit_id, store_id, category, brand_id, product_id, ideal_facings, actual_facings, total_category_facings, competitor_facings, position_level, notes } = req.body || {};
  if (!store_id || !category) return res.status(400).json({ error: 'Loja e categoria são obrigatórias.' });

  const ideal = Number(ideal_facings || 4);
  const actual = Number(actual_facings || 0);
  const total = Math.max(1, Number(total_category_facings || actual + Number(competitor_facings || 0) || 1));
  const share = Number(((actual / total) * 100).toFixed(1));
  const lost = Math.max(0, ideal - actual);
  const compliant = actual >= ideal ? 1 : 0;

  const r = db.prepare(`
    INSERT INTO planogram_audits (visit_id, store_id, category, brand_id, product_id, ideal_facings, actual_facings, total_category_facings, competitor_facings, lost_spaces, position_level, share_of_shelf, compliant, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(visit_id || null, store_id, category, brand_id || null, product_id || null, ideal, actual, total, Number(competitor_facings || 0), lost, position_level || 'Olhos', share, compliant, notes || '');

  logAudit(req.user, 'CREATE', 'planogram_audits', r.lastInsertRowid, `Planograma ${category} share=${share}%`);
  res.status(201).json({ id: r.lastInsertRowid, share_of_shelf: share, lost_spaces: lost, compliant });
});

module.exports = router;
