const jwt = require('jsonwebtoken');
const { col, nextId, nowStr } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'merchandising-pro-secret-key-2026';

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido.' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const users = await col('users');
    const user = await users.findOne(
      { id: Number(payload.id) },
      { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1, region: 1, active: 1 } }
    );
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Usuário inativo ou não encontrado.' });
    }
    req.user = user;
    next();
  } catch {
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
  JWT_SECRET,
  authenticate,
  authorize,
  logAudit,
};
