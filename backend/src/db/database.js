const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const dbDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'merchandising_pro.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('promotor', 'supervisor', 'admin')),
      region TEXT DEFAULT 'Centro',
      phone TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Supermercado',
      banner TEXT DEFAULT '',
      network TEXT DEFAULT '',
      address TEXT NOT NULL,
      city TEXT DEFAULT '',
      region TEXT DEFAULT 'Centro',
      route_name TEXT DEFAULT 'Rota A',
      visit_frequency TEXT DEFAULT 'Semanal',
      contact_name TEXT DEFAULT '',
      contact_phone TEXT DEFAULT '',
      lat REAL DEFAULT -23.5505,
      lng REAL DEFAULT -46.6333,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      is_own INTEGER DEFAULT 1,
      color TEXT DEFAULT '#2563eb'
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE NOT NULL,
      ean TEXT NOT NULL,
      name TEXT NOT NULL,
      brand_id INTEGER REFERENCES brands(id),
      category TEXT NOT NULL,
      unit TEXT DEFAULT 'UN',
      system_price REAL NOT NULL DEFAULT 0,
      min_stock INTEGER DEFAULT 10,
      ideal_facings INTEGER DEFAULT 4,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      promoter_id INTEGER REFERENCES users(id),
      day_of_week TEXT NOT NULL,
      store_ids_json TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      promoter_id INTEGER NOT NULL REFERENCES users(id),
      route_id INTEGER REFERENCES routes(id),
      scheduled_date TEXT NOT NULL,
      scheduled_time TEXT DEFAULT '08:00',
      checkin_at TEXT,
      checkout_at TEXT,
      duration_minutes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'Pendente' CHECK(status IN ('Pendente', 'Em Andamento', 'Concluída', 'Não Atendida')),
      checkin_lat REAL,
      checkin_lng REAL,
      notes TEXT DEFAULT '',
      problems_found TEXT DEFAULT '',
      opportunities_found TEXT DEFAULT '',
      photos_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS visit_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
      item_key TEXT NOT NULL,
      label TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      is_custom INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS replenishments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER REFERENCES visits(id),
      store_id INTEGER NOT NULL REFERENCES stores(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      promoter_id INTEGER REFERENCES users(id),
      quantity_replenished INTEGER DEFAULT 0,
      backroom_stock INTEGER DEFAULT 0,
      gondola_stock INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Abastecido',
      increase_exposure_opportunity INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS displays_exposures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER REFERENCES visits(id),
      store_id INTEGER NOT NULL REFERENCES stores(id),
      promoter_id INTEGER REFERENCES users(id),
      category TEXT NOT NULL,
      brand_id INTEGER REFERENCES brands(id),
      exposure_type TEXT NOT NULL,
      facings_actual INTEGER DEFAULT 0,
      facings_expected INTEGER DEFAULT 0,
      planogram_compliant INTEGER DEFAULT 1,
      pos_materials TEXT DEFAULT '',
      photo_before TEXT DEFAULT '',
      photo_after TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS planogram_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER REFERENCES visits(id),
      store_id INTEGER NOT NULL REFERENCES stores(id),
      category TEXT NOT NULL,
      brand_id INTEGER REFERENCES brands(id),
      product_id INTEGER REFERENCES products(id),
      ideal_facings INTEGER DEFAULT 4,
      actual_facings INTEGER DEFAULT 0,
      total_category_facings INTEGER DEFAULT 20,
      competitor_facings INTEGER DEFAULT 0,
      lost_spaces INTEGER DEFAULT 0,
      position_level TEXT DEFAULT 'Olhos',
      share_of_shelf REAL DEFAULT 0,
      compliant INTEGER DEFAULT 1,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS price_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER REFERENCES visits(id),
      store_id INTEGER NOT NULL REFERENCES stores(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      promoter_id INTEGER REFERENCES users(id),
      gondola_price REAL,
      system_price REAL,
      promo_price REAL,
      has_price_tag INTEGER DEFAULT 1,
      price_divergent INTEGER DEFAULT 0,
      competitor_name TEXT DEFAULT '',
      competitor_price REAL,
      photo_url TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS expiry_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER REFERENCES visits(id),
      store_id INTEGER NOT NULL REFERENCES stores(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      promoter_id INTEGER REFERENCES users(id),
      batch_code TEXT DEFAULT '',
      expiry_date TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      fifo_fefo_applied INTEGER DEFAULT 1,
      condition TEXT NOT NULL DEFAULT 'Normal',
      removal_requested INTEGER DEFAULT 0,
      estimated_loss REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS store_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      gondola_qty INTEGER DEFAULT 0,
      backroom_qty INTEGER DEFAULT 0,
      separated_for_merchandising INTEGER DEFAULT 0,
      last_inventory_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(store_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      user_id INTEGER REFERENCES users(id),
      movement_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      product_ids_json TEXT DEFAULT '[]',
      store_ids_json TEXT DEFAULT '[]',
      materials_needed TEXT DEFAULT '',
      checklist_json TEXT DEFAULT '[]',
      status TEXT DEFAULT 'Ativa',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS campaign_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
      store_id INTEGER NOT NULL REFERENCES stores(id),
      visit_id INTEGER REFERENCES visits(id),
      promoter_id INTEGER REFERENCES users(id),
      checklist_status_json TEXT DEFAULT '[]',
      compliant INTEGER DEFAULT 1,
      photo_url TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      executed_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER REFERENCES visits(id),
      store_id INTEGER NOT NULL REFERENCES stores(id),
      product_id INTEGER REFERENCES products(id),
      promoter_id INTEGER REFERENCES users(id),
      type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'Média',
      description TEXT NOT NULL,
      photo_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Aberta',
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS ai_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER REFERENCES visits(id),
      store_id INTEGER REFERENCES stores(id),
      user_id INTEGER REFERENCES users(id),
      image_url TEXT DEFAULT '',
      detected_ruptures_json TEXT DEFAULT '[]',
      detected_brands_json TEXT DEFAULT '[]',
      exposure_issues_json TEXT DEFAULT '[]',
      planogram_score REAL DEFAULT 0,
      suggestions_json TEXT DEFAULT '[]',
      extra_point_opportunities_json TEXT DEFAULT '[]',
      auto_report TEXT DEFAULT '',
      confidence REAL DEFAULT 0,
      human_validation TEXT DEFAULT 'Pendente',
      human_notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);
}

module.exports = {
  db,
  initSchema,
  hashPassword,
  verifyPassword,
};
