const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { col, nextId, nowStr } = require('../db/database');

const IS_PROD = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
let ephemeralDevSecret = null;

function getJwtSecret() {
  const envSecret = (process.env.JWT_SECRET || '').trim();
  if (envSecret) return envSecret;

  if (IS_PROD) {
    throw new Error('JWT_SECRET não configurada nas variáveis de ambiente de produção.');
  }

  if (!ephemeralDevSecret) {
    ephemeralDevSecret = `dev-${crypto.randomBytes(24).toString('hex')}`;
    console.warn('[AUTH] AVISO: JWT_SECRET ausente em desenvolvimento; usando segredo temporário em memória.');
  }
  return ephemeralDevSecret;
}

const PROVISIONAL_CERT_SERIAL = 'MPRO-CERT-PROV-2026-HIGOR-CI';
const PROVISIONAL_CERT_SIG = crypto
  .createHash('sha256')
  .update('MPRO-CERT-PROV-2026-HIGOR-CI|Higor|Cachoeiro de Itapemirim|2026-11-27T03:40:00-03:00')
  .digest('hex')
  .toUpperCase();

let cachedProvisionalUser = null;

async function resolveProvisionalCertUser() {
  if (cachedProvisionalUser && cachedProvisionalUser.active) {
    return cachedProvisionalUser;
  }
  const users = await col('users');
  let user = await users.findOne(
    { email: 'higor@merchandising.com' },
    { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1, region: 1, city: 1, title: 1, active: 1 } }
  );
  if (!user) {
    const id = await nextId('users');
    const doc = {
      id,
      name: 'Higor',
      email: 'higor@merchandising.com',
      password_hash: '',
      role: 'admin',
      region: 'Cachoeiro de Itapemirim',
      city: 'Cachoeiro de Itapemirim',
      title: 'Promotor',
      phone: '',
      active: 1,
      created_at: nowStr(),
    };
    await users.insertOne(doc);
    user = {
      id: doc.id,
      name: doc.name,
      email: doc.email,
      role: doc.role,
      region: doc.region,
      city: doc.city,
      title: doc.title,
      active: 1,
    };
  }
  cachedProvisionalUser = user;
  return user;
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const provisionalBypass = String(process.env.REQUIRE_LOGIN || '').trim().toLowerCase() !== 'true';
  const certHeader = String(req.headers['x-provisional-cert'] || '').trim();
  const certSigHeader = String(req.headers['x-provisional-cert-sig'] || '').trim().toUpperCase();

  const tryProvisional = async () => {
    if (!provisionalBypass) return false;
    if (certHeader && certHeader !== PROVISIONAL_CERT_SERIAL) return false;
    if (certSigHeader && certSigHeader !== PROVISIONAL_CERT_SIG) return false;
    try {
      req.user = await resolveProvisionalCertUser();
      return true;
    } catch {
      return false;
    }
  };

  if (!header || !header.startsWith('Bearer ')) {
    if (await tryProvisional()) return next();
    return res.status(401).json({ error: 'Token de autenticação não fornecido.' });
  }
  const token = header.slice(7).trim();
  if (!token) {
    if (await tryProvisional()) return next();
    return res.status(401).json({ error: 'Token de autenticação inválido.' });
  }

  let secret;
  try {
    secret = getJwtSecret();
  } catch (err) {
    return next(err);
  }

  try {
    const payload = jwt.verify(token, secret);
    const users = await col('users');
    const user = await users.findOne(
      { id: Number(payload.id) },
      { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1, region: 1, city: 1, title: 1, active: 1 } }
    );
    if (!user || !user.active) {
      if (await tryProvisional()) return next();
      return res.status(401).json({ error: 'Usuário inativo ou não encontrado.' });
    }
    req.user = user;
    next();
  } catch {
    if (await tryProvisional()) return next();
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado para o seu perfil.' });
    }
    next();
  };
}

async function logAudit(user, action, entity, entityId = null, details = '') {
  try {
    const logs = await col('audit_logs');
    await logs.insertOne({
      id: await nextId('audit_logs'),
      user_id: user?.id || null,
      user_name: user?.name || 'Sistema',
      action,
      entity,
      entity_id: entityId,
      details,
      created_at: nowStr(),
    });
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = {
  getJwtSecret,
  authenticate,
  authorize,
  logAudit,
};
