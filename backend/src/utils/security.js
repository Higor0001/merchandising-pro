const DAYS_PT = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];

const BRAZIL_TZ = 'America/Sao_Paulo';

/**
 * Escapa metacaracteres de expressão regular para prevenir Regex Injection / ReDoS no MongoDB.
 */
function escapeRegex(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isManager(user) {
  return Boolean(user && (user.role === 'admin' || user.role === 'supervisor'));
}

/**
 * Verifica se o usuário autenticado tem permissão para operar uma visita específica.
 * Promotores só operam suas próprias visitas; supervisores e admins operam qualquer visita.
 */
function canOperateVisit(user, visit) {
  if (!user || !visit) return false;
  if (isManager(user)) return true;
  return Number(visit.promoter_id) === Number(user.id);
}

/**
 * Retorna a data YYYY-MM-DD no fuso oficial de Brasília (America/Sao_Paulo).
 */
function getBrazilDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRAZIL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

/**
 * Retorna a hora HH:mm no fuso oficial de Brasília (America/Sao_Paulo).
 */
function getBrazilTimeStr(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: BRAZIL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Retorna o nome do dia da semana em português no fuso de Brasília.
 */
function getBrazilDayName(date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: BRAZIL_TZ,
    weekday: 'short',
  }).format(date);
  const idxMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return DAYS_PT[idxMap[weekday] ?? date.getDay()];
}

/**
 * Interpreta timestamps ISO-8601 (com Z/offset) ou formato legado "YYYY-MM-DD HH:mm:ss" como UTC,
 * evitando distorções de fuso horário entre servidores locais (BRT) e Vercel (UTC).
 */
function parseUtcTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  // Se já tem Z ou offset (+00:00 / -03:00), interpreta diretamente
  if (/Z$|[+-]\d{2}:?\d{2}$/i.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Formato legado "YYYY-MM-DD HH:mm:ss" gerado originalmente via toISOString() em UTC
  const normalized = raw.includes('T') ? `${raw}Z` : `${raw.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = {
  DAYS_PT,
  BRAZIL_TZ,
  escapeRegex,
  isManager,
  canOperateVisit,
  getBrazilDateStr,
  getBrazilTimeStr,
  getBrazilDayName,
  parseUtcTimestamp,
};
