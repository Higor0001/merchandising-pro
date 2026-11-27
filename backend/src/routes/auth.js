const express = require('express');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { col, nextId, nowStr, hashPasswordAsync, verifyPasswordAsync } = require('../db/database');
const { getJwtSecret, authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_ROLES = ['promotor', 'supervisor', 'admin'];

const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido.'),
  password: z.string().min(1, 'Senha é obrigatória.'),
});

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Nome deve ter pelo menos 2 caracteres.').max(120),
  email: z.string().trim().email('E-mail inválido.'),
  password: z.string().min(6, 'A senha deve ter no mínimo 6 caracteres.').max(128),
  role: z.enum(ALLOWED_ROLES, { errorMap: () => ({ message: 'Perfil inválido.' }) }),
  region: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(ALLOWED_ROLES).optional(),
  region: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  active: z.union([z.boolean(), z.number()]).optional(),
  password: z.string().min(6, 'A senha deve ter no mínimo 6 caracteres.').max(128).optional(),
});

router.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'E-mail e senha são obrigatórios.' });
    }
    const { email, password } = parsed.data;
    const users = await col('users');
    const user = await users.findOne({ email: email.toLowerCase() });
    if (!user || !user.active || !(await verifyPasswordAsync(password, user.password_hash))) {
      return res.status(401).json({ error: 'Credenciais inválidas ou usuário inativo.' });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, getJwtSecret(), { expiresIn: '24h' });
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
    const parsed = createUserSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' });
    }
    const { name, email, password, role, region, phone } = parsed.data;
    const users = await col('users');
    const cleanEmail = email.toLowerCase();
    const exists = await users.findOne({ email: cleanEmail });
    if (exists) {
      return res.status(400).json({ error: 'E-mail já cadastrado.' });
    }
    const id = await nextId('users');
    const passwordHash = await hashPasswordAsync(password);
    await users.insertOne({
      id,
      name,
      email: cleanEmail,
      password_hash: passwordHash,
      role,
      region: region || 'Cachoeiro de Itapemirim/ES',
      phone: phone || '',
      active: 1,
      created_at: nowStr(),
    });
    await logAudit(req.user, 'CREATE', 'users', id, `Usuário ${name} (${role}) criado`);
    res.status(201).json({ id, name, email: cleanEmail, role, region: region || 'Cachoeiro de Itapemirim/ES', phone: phone || '' });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const uid = Number(req.params.id);
    const parsed = updateUserSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' });
    }
    const { name, role, region, phone, active, password } = parsed.data;
    const users = await col('users');
    const existing = await users.findOne({ id: uid });
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const newHash = password ? await hashPasswordAsync(password) : existing.password_hash;
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
