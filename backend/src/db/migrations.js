const { col } = require('./database');

let migrationPromise = null;

/**
 * Executa migrations incrementais no MongoDB de forma idempotente,
 * preservando 100% dos dados e estruturas existentes.
 */
async function runIncrementalMigrations() {
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    // 1. Índices para integridade referencial lógica e performance store-centric
    await Promise.all([
      (await col('stores')).createIndex({ id: 1 }, { unique: true }),
      (await col('visits')).createIndex({ id: 1 }, { unique: true }),
      (await col('visits')).createIndex({ store_id: 1, status: 1 }),
      (await col('visits')).createIndex({ store_id: 1, scheduled_date: -1 }),
      (await col('visit_evidences')).createIndex({ id: 1 }, { unique: true }),
      (await col('visit_evidences')).createIndex({ visit_id: 1, stage: 1 }),
      (await col('visit_evidences')).createIndex({ store_id: 1, captured_at: -1 }),
      (await col('visit_diagnostics')).createIndex({ id: 1 }, { unique: true }),
      (await col('visit_diagnostics')).createIndex({ visit_id: 1 }, { unique: true }),
      (await col('visit_diagnostics')).createIndex({ store_id: 1, created_at: -1 }),
      (await col('occurrences')).createIndex({ store_id: 1, status: 1 }),
      (await col('occurrences')).createIndex({ visit_id: 1 }),
      (await col('replenishments')).createIndex({ store_id: 1, visit_id: 1 }),
      (await col('price_checks')).createIndex({ store_id: 1, visit_id: 1 }),
      (await col('expiry_checks')).createIndex({ store_id: 1, visit_id: 1 }),
      (await col('displays_exposures')).createIndex({ store_id: 1, visit_id: 1 }),
    ]);

    // 2. Backfill incremental em visitas antigas sem workflow_stage
    const visitsCol = await col('visits');
    await visitsCol.updateMany(
      { workflow_stage: { $exists: false }, status: 'Concluída' },
      { $set: { workflow_stage: 'CONCLUIDA' } }
    );
    await visitsCol.updateMany(
      { workflow_stage: { $exists: false }, status: 'Em Andamento' },
      { $set: { workflow_stage: 'EXECUCAO' } }
    );
    await visitsCol.updateMany(
      { workflow_stage: { $exists: false }, status: { $in: ['Pendente', 'Não Atendida'] } },
      { $set: { workflow_stage: 'IDENTIFICACAO' } }
    );
    await visitsCol.updateMany(
      { workflow_stage: { $exists: false }, status: 'Cancelada' },
      { $set: { workflow_stage: 'CANCELADA' } }
    );
  })().catch((err) => {
    migrationPromise = null;
    console.error('Erro ao executar migrations incrementais:', err.message);
  });

  return migrationPromise;
}

module.exports = { runIncrementalMigrations };
