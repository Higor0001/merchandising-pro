const { col } = require('../db/database');

const EXECUTION_ALLOWED_STAGES = new Set(['EXECUCAO', 'FOTO_FINAL', 'CHECKOUT']);

/**
 * Valida integridade de vínculo entre atividade operacional, visita e loja.
 * Quando visit_id é omitido (lançamentos avulsos legados), não bloqueia,
 * mas garante que se houver visit_id, todas as regras de segurança sejam respeitadas.
 */
async function validateVisitExecutionContext(visitId, storeId) {
  if (!visitId) return { ok: true, visit: null };

  const vid = Number(visitId);
  const sid = Number(storeId);
  const visit = await (await col('visits')).findOne({ id: vid });

  if (!visit) {
    return { ok: false, status: 404, error: 'Visita informada não encontrada.' };
  }
  if (sid && Number(visit.store_id) !== sid) {
    return { ok: false, status: 400, error: 'Divergência de integridade: a visita não pertence à loja selecionada.' };
  }
  if (visit.status === 'Concluída' || visit.status === 'Cancelada' || visit.workflow_stage === 'CONCLUIDA') {
    return { ok: false, status: 403, error: 'Visita já encerrada não pode ser alterada.' };
  }

  const stage = visit.workflow_stage || (visit.status === 'Em Andamento' ? 'EXECUCAO' : 'IDENTIFICACAO');
  if (!EXECUTION_ALLOWED_STAGES.has(stage)) {
    return {
      ok: false,
      status: 400,
      error: 'Execução bloqueada: conclua a Fotografia Inicial obrigatória e o Diagnóstico Inicial antes de registrar atividades.',
    };
  }

  return { ok: true, visit };
}

/**
 * Middleware Express opcional para rotas que recebem visit_id e store_id no req.body.
 */
async function enforceVisitExecutionIntegrity(req, res, next) {
  try {
    const { visit_id, store_id } = req.body || {};
    if (!visit_id) return next();
    const check = await validateVisitExecutionContext(visit_id, store_id);
    if (!check.ok) {
      return res.status(check.status).json({ error: check.error });
    }
    req.activeVisit = check.visit;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  EXECUTION_ALLOWED_STAGES,
  validateVisitExecutionContext,
  enforceVisitExecutionIntegrity,
};
