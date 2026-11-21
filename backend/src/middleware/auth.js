const jwt = require('jsonwebtoken');
const { db } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'merchandising-pro-secret-key-2026';

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido.' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, role, region, active FROM users WHERE id = ?').get(payload.id);
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

function logAudit(user, action, entity, entityId = null, details = '') {
  try {
    db.prepare(
      'INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user?.id || null, user?.name || 'Sistema', action, entity, entityId, details);
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
