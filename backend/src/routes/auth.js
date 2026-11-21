const express = require('express');
const jwt = require('jsonwebtoken');
const { col, nextId, nowStr, hashPassword, verifyPassword } = require('../db/database');
const { JWT_SECRET, authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }
    const users = await col('users');
    const user = await users.findOne({ email: email.trim().toLowerCase() });
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Credenciais inválidas ou usuário inativo.' });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    await logAudit(user, 'LOGIN', 'users', user.id, `Login realizado (${user.role})`);
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
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

router.get('/users', authenticate, authorize('admin', 'supervisor'), async (_req, res, next) => {
  try {
    const users = await (await col('users'))
      .find({}, { projection: { _id: 0, password_hash: 0 } })
      .sort({ name: 1 })
      .toArray();
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.post('/users', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { name, email, password, role, region, phone } = req.body || {};
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Nome, e-mail, senha e perfil são obrigatórios.' });
    }
    const users = await col('users');
    const cleanEmail = email.trim().toLowerCase();
    const exists = await users.findOne({ email: cleanEmail });
    if (exists) {
      return res.status(400).json({ error: 'E-mail já cadastrado.' });
    }
    const id = await nextId('users');
    await users.insertOne({
      id,
      name,
      email: cleanEmail,
      password_hash: hashPassword(password),
      role,
      region: region || 'Cachoeiro de Itapemirim/ES',
      phone: phone || '',
      active: 1,
      created_at: nowStr(),
    });
    await logAudit(req.user, 'CREATE', 'users', id, `Usuário ${name} (${role}) criado`);
    res.status(201).json({ id, name, email: cleanEmail, role, region, phone });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const uid = Number(req.params.id);
    const { name, role, region, phone, active, password } = req.body || {};
    const users = await col('users');
    const existing = await users.findOne({ id: uid });
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const newHash = password ? hashPassword(password) : existing.password_hash;
    await users.updateOne(
      { id: uid },
      {
        $set: {
          name: name ?? existing.name,
          role: role ?? existing.role,
          region: region ?? existing.region,
          phone: phone ?? existing.phone,
          active: active !== undefined ? (active ? 1 : 0) : existing.active,
          password_hash: newHash,
        },
      }
    );
    await logAudit(req.user, 'UPDATE', 'users', uid, `Usuário ${existing.email} atualizado`);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/audit-logs', authenticate, authorize('admin', 'supervisor'), async (_req, res, next) => {
  try {
    const logs = await (await col('audit_logs'))
      .find({}, { projection: { _id: 0 } })
      .sort({ id: -1 })
      .limit(200)
      .toArray();
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
