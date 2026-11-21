const express = require('express');
const jwt = require('jsonwebtoken');
const { db, hashPassword, verifyPassword } = require('../db/database');
const { JWT_SECRET, authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciais inválidas ou usuário inativo.' });
  }
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  logAudit(user, 'LOGIN', 'users', user.id, `Login realizado (${user.role})`);
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      region: user.region,
      phone: user.phone,
    },
  });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

router.get('/users', authenticate, authorize('admin', 'supervisor'), (_req, res) => {
  const users = db
    .prepare('SELECT id, name, email, role, region, phone, active, created_at FROM users ORDER BY name')
    .all();
  res.json(users);
});

router.post('/users', authenticate, authorize('admin'), (req, res) => {
  const { name, email, password, role, region, phone } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Nome, e-mail, senha e perfil são obrigatórios.' });
  }
  try {
    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, role, region, phone) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, email.trim().toLowerCase(), hashPassword(password), role, region || 'Centro', phone || '');
    logAudit(req.user, 'CREATE', 'users', result.lastInsertRowid, `Usuário ${name} (${role}) criado`);
    res.status(201).json({ id: result.lastInsertRowid, name, email, role, region, phone });
  } catch (err) {
    res.status(400).json({ error: 'Erro ao criar usuário: e-mail já cadastrado ou dados inválidos.' });
  }
});

router.patch('/users/:id', authenticate, authorize('admin'), (req, res) => {
  const { id } = req.params;
  const { name, role, region, phone, active, password } = req.body || {};
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const newHash = password ? hashPassword(password) : existing.password_hash;
  db.prepare(
    'UPDATE users SET name = ?, role = ?, region = ?, phone = ?, active = ?, password_hash = ? WHERE id = ?'
  ).run(
    name ?? existing.name,
    role ?? existing.role,
    region ?? existing.region,
    phone ?? existing.phone,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    newHash,
    id
  );
  logAudit(req.user, 'UPDATE', 'users', Number(id), `Usuário ${existing.email} atualizado`);
  res.json({ success: true });
});

router.get('/audit-logs', authenticate, authorize('admin', 'supervisor'), (_req, res) => {
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all();
  res.json(logs);
});

module.exports = router;
