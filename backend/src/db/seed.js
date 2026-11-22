const { col, nextId, nowStr, hashPassword } = require('./database');
const { isSi5Configured, syncSi5Catalog } = require('../services/si5Service');

const DEFAULT_CHECKLIST_ITEMS = [
  { key: 'loja_visitada', label: 'Loja visitada (Check-in realizado)' },
  { key: 'abastecimento_realizado', label: 'Abastecimento realizado' },
  { key: 'rupturas_verificadas', label: 'Rupturas verificadas' },
  { key: 'validades_conferidas', label: 'Validades conferidas (FIFO/FEFO)' },
  { key: 'precos_conferidos', label: 'Preços e etiquetas conferidos' },
  { key: 'planograma_executado', label: 'Planograma executado' },
  { key: 'gondolas_organizadas', label: 'Gôndolas organizadas' },
  { key: 'pontos_extras_montados', label: 'Pontos extras montados' },
  { key: 'displays_instalados', label: 'Displays instalados' },
  { key: 'campanhas_implantadas', label: 'Campanhas implantadas' },
  { key: 'concorrencia_monitorada', label: 'Concorrência monitorada' },
  { key: 'ocorrencias_registradas', label: 'Ocorrências registradas' },
  { key: 'fotos_antes_depois', label: 'Fotos antes e depois registradas' },
];

async function createDefaultChecklist(visitId, completedCount = 0) {
  const checklists = await col('visit_checklists');
  const docs = [];
  for (let idx = 0; idx < DEFAULT_CHECKLIST_ITEMS.length; idx++) {
    const item = DEFAULT_CHECKLIST_ITEMS[idx];
    docs.push({
      id: await nextId('visit_checklists'),
      visit_id: Number(visitId),
      item_key: item.key,
      label: item.label,
      completed: idx < completedCount ? 1 : 0,
      notes: '',
      is_custom: 0,
      updated_at: nowStr(),
    });
  }
  if (docs.length) await checklists.insertMany(docs);
}

let seedPromise = null;

async function seedIfEmpty() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const usersCol = await col('users');
    const count = await usersCol.countDocuments();
    if (count > 0) return;

    const createdAt = nowStr();
    const users = [
      { id: await nextId('users'), name: 'Promotor', email: 'promotor@merchandising.com', password_hash: hashPassword('123456'), role: 'promotor', region: 'Cachoeiro de Itapemirim/ES', phone: '', active: 1, created_at: createdAt },
      { id: await nextId('users'), name: 'Supervisor', email: 'supervisor@merchandising.com', password_hash: hashPassword('123456'), role: 'supervisor', region: 'Cachoeiro de Itapemirim/ES', phone: '', active: 1, created_at: createdAt },
      { id: await nextId('users'), name: 'Administrador', email: 'admin@merchandising.com', password_hash: hashPassword('123456'), role: 'admin', region: 'Cachoeiro de Itapemirim/ES', phone: '', active: 1, created_at: createdAt },
    ];
    await usersCol.insertMany(users);

    // Lojas reais extraídas de: Manifesto de Circuito PepsiCo - Google Gemini.pdf
    const storesCol = await col('stores');
    const rawStores = [
      ['27.473.669 | CASAGRANDE - GUANDU', 'Supermercado', 'Casagrande', 'Grupo Casagrande', 'Rua Bernardo Horta, 269 e 299 – Guandu', 'Cachoeiro de Itapemirim/ES', 'Guandu', 'Circuito Guandu', 'Semanal'],
      ['33.014.556 | LASA - GUANDU', 'Rede Varejista', 'LASA', 'Lojas Americanas', 'Rua Bernardo Horta, 227, loja 227 – Guandu', 'Cachoeiro de Itapemirim/ES', 'Guandu', 'Circuito Guandu', 'Semanal'],
      ['27.735.448 | OSVALDO PERIM - GUANDU', 'Supermercado', 'Perim', 'Supermercados Perim', 'Rua Bernardo Horta, 322 – Guandu', 'Cachoeiro de Itapemirim/ES', 'Guandu', 'Circuito Guandu', 'Semanal'],
      ['28.129.260 | DRIFT - INDEPENDÊNCIA', 'Supermercado', 'Drift', 'Drift Supermercados', 'Rua Moreira, 281 – Independência', 'Cachoeiro de Itapemirim/ES', 'Independência', 'Circuito Centro', 'Semanal'],
      ['33.014.556 | LASA - CACHOEIRO DE ITAPEMIRIM CENTRO', 'Rede Varejista', 'LASA', 'Lojas Americanas', 'Rua 25 de Março, 33, loja 209 – Centro', 'Cachoeiro de Itapemirim/ES', 'Centro', 'Circuito Centro', 'Semanal'],
      ['27.735.448 | OSVALDO PERIM - CAIÇARA', 'Supermercado', 'Perim', 'Supermercados Perim', 'Av. Jones dos Santos Neves, 1371 – Caiçara', 'Cachoeiro de Itapemirim/ES', 'Caiçara', 'Circuito Caiçara', 'Semanal'],
      ['33.014.556 | LASA - PARAÍSO', 'Rede Varejista', 'LASA', 'Lojas Americanas', 'Av. Francisco Lacerda de Aguiar, 382 (Shopping Sul) – Paraíso', 'Cachoeiro de Itapemirim/ES', 'Paraíso', 'Circuito Paraíso', 'Semanal'],
    ];
    const storeDocs = [];
    for (const [name, type, banner, network, address, city, region, route_name, visit_frequency] of rawStores) {
      storeDocs.push({
        id: await nextId('stores'),
        name, type, banner, network, address, city, region, route_name, visit_frequency,
        contact_name: '', contact_phone: '', active: 1, created_at: createdAt,
      });
    }
    await storesCol.insertMany(storeDocs);

    // 23 Marcas oficiais PepsiCo Brasil
    const pepsicoBrands = [
      'Baconzitos', 'Cebolitos', 'Cheetos', 'Doritos', 'eQlibri', 'Fandangos',
      'Fofura', 'Gatorade', 'H2OH!', 'Kero Coco', 'Lay’s', 'Lipton',
      'Pepsi', 'Pingo d’Ouro', 'PopCorners', 'Quaker', 'Ruffles', 'Skiny',
      'Stiksy', 'Toddy', 'Toddynho', 'Torcida', 'Tostitos',
    ];
    const brandsCol = await col('brands');
    const brandIdMap = {};
    const brandDocs = [];
    for (const name of pepsicoBrands) {
      const id = await nextId('brands');
      brandIdMap[name] = id;
      brandDocs.push({ id, name, is_own: 1, color: '#1d4ed8' });
    }
    await brandsCol.insertMany(brandDocs);

    // Catálogo de produtos alimentado exclusivamente pela API SI5 Global
    if (isSi5Configured()) {
      try {
        await syncSi5Catalog({ q: '', pages: 1, per_page: 50 });
      } catch (err) {
        console.warn('Aviso ao sincronizar catálogo inicial da SI5:', err.message);
      }
    }
  })().catch((err) => {
    seedPromise = null;
    throw err;
  });
  return seedPromise;
}

module.exports = {
  seedIfEmpty,
  DEFAULT_CHECKLIST_ITEMS,
  createDefaultChecklist,
};
