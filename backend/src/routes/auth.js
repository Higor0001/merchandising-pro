const express = require('express');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { col, nextId, nowStr, hashPasswordAsync, verifyPasswordAsync } = require('../db/database');
const { getJwtSecret, authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_ROLES = ['promotor', 'supervisor', 'admin'];

const PROVISIONAL_CERT_INFO = {
  serial: 'MPRO-CERT-PROV-2026-HIGOR-CI',
  tipo: 'Certificado Digital Provisório',
  sistema: 'MERCHANDISING PRO',
  promotor: 'Higor',
  cidade: 'Cachoeiro de Itapemirim',
  uf: 'ES',
  email: 'higor@merchandising.com',
  emitido_em: '2026-11-27T03:40:00-03:00',
  status: 'ATIVO (Tela de Login Desativada Provisoriamente)',
};

function isProvisionalLoginBypassEnabled() {
  return String(process.env.REQUIRE_LOGIN || '').trim().toLowerCase() !== 'true';
}

function buildProvisionalCertificate() {
  const payload = `${PROVISIONAL_CERT_INFO.serial}|${PROVISIONAL_CERT_INFO.promotor}|${PROVISIONAL_CERT_INFO.cidade}|${PROVISIONAL_CERT_INFO.emitido_em}`;
  const fingerprint = crypto.createHash('sha256').update(payload).digest('hex').toUpperCase();
  return {
    ...PROVISIONAL_CERT_INFO,
    algoritmo: 'SHA-256',
    assinatura_digital: fingerprint,
  };
}

async function ensureProvisionalHigorUser() {
  const users = await col('users');
  let user = await users.findOne({ email: PROVISIONAL_CERT_INFO.email });
  if (!user) {
    const id = await nextId('users');
    const randomPass = crypto.randomBytes(18).toString('base64url');
    const passwordHash = await hashPasswordAsync(randomPass);
    user = {
      id,
      name: PROVISIONAL_CERT_INFO.promotor,
      email: PROVISIONAL_CERT_INFO.email,
      password_hash: passwordHash,
      role: 'admin',
      region: PROVISIONAL_CERT_INFO.cidade,
      city: PROVISIONAL_CERT_INFO.cidade,
      title: 'Promotor',
      phone: '',
      active: 1,
      created_at: nowStr(),
    };
    await users.insertOne(user);
  } else if (!user.active || user.name !== PROVISIONAL_CERT_INFO.promotor || user.region !== PROVISIONAL_CERT_INFO.cidade) {
    await users.updateOne(
      { id: user.id },
      {
        $set: {
          name: PROVISIONAL_CERT_INFO.promotor,
          region: PROVISIONAL_CERT_INFO.cidade,
          city: PROVISIONAL_CERT_INFO.cidade,
          title: 'Promotor',
          active: 1,
        },
      }
    );
    user = await users.findOne({ id: user.id });
  }
  return user;
}

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

router.get('/provisional-certificate', (_req, res) => {
  res.json({
    login_disabled: isProvisionalLoginBypassEnabled(),
    certificate: buildProvisionalCertificate(),
  });
});

router.post('/provisional', async (_req, res, next) => {
  try {
    if (!isProvisionalLoginBypassEnabled()) {
      return res.status(403).json({ error: 'Acesso provisório desativado. Utilize a tela de login.' });
    }
    const user = await ensureProvisionalHigorUser();
    const certificate = buildProvisionalCertificate();
    const token = jwt.sign(
      { id: user.id, role: user.role, provisional: true, cert_serial: certificate.serial },
      getJwtSecret(),
      { expiresIn: '7d' }
    );
    res.json({
      token,
      login_disabled: true,
      certificate,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        region: user.region || PROVISIONAL_CERT_INFO.cidade,
        city: PROVISIONAL_CERT_INFO.cidade,
        title: 'Promotor',
        phone: user.phone || '',
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
module.exports.PROVISIONAL_CERT_INFO = PROVISIONAL_CERT_INFO;
module.exports.isProvisionalLoginBypassEnabled = isProvisionalLoginBypassEnabled;
module.exports.buildProvisionalCertificate = buildProvisionalCertificate;
module.exports.ensureProvisionalHigorUser = ensureProvisionalHigorUser;
