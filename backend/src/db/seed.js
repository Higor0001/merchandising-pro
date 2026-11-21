const { db, hashPassword } = require('./database');

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

function createDefaultChecklist(visitId, completedCount = 0) {
  const stmt = db.prepare(
    'INSERT INTO visit_checklists (visit_id, item_key, label, completed) VALUES (?, ?, ?, ?)'
  );
  DEFAULT_CHECKLIST_ITEMS.forEach((item, idx) => {
    stmt.run(visitId, item.key, item.label, idx < completedCount ? 1 : 0);
  });
}

function seedIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount > 0) return;

  // Usuários padrão de acesso (Promotor, Supervisor, Administrador)
  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, region, phone) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertUser.run('Promotor', 'promotor@merchandising.com', hashPassword('123456'), 'promotor', 'Cachoeiro de Itapemirim/ES', '');
  insertUser.run('Supervisor', 'supervisor@merchandising.com', hashPassword('123456'), 'supervisor', 'Cachoeiro de Itapemirim/ES', '');
  insertUser.run('Administrador', 'admin@merchandising.com', hashPassword('123456'), 'admin', 'Cachoeiro de Itapemirim/ES', '');

  // Lojas reais extraídas de: Manifesto de Circuito PepsiCo - Google Gemini.pdf
  const insertStore = db.prepare(
    'INSERT INTO stores (name, type, banner, network, address, city, region, route_name, visit_frequency, contact_name, contact_phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertStore.run('27.473.669 | CASAGRANDE - GUANDU', 'Supermercado', 'Casagrande', 'Grupo Casagrande', 'Rua Bernardo Horta, 269 e 299 – Guandu', 'Cachoeiro de Itapemirim/ES', 'Guandu', 'Circuito Guandu', 'Semanal', '', '');
  insertStore.run('33.014.556 | LASA - GUANDU', 'Rede Varejista', 'LASA', 'Lojas Americanas', 'Rua Bernardo Horta, 227, loja 227 – Guandu', 'Cachoeiro de Itapemirim/ES', 'Guandu', 'Circuito Guandu', 'Semanal', '', '');
  insertStore.run('27.735.448 | OSVALDO PERIM - GUANDU', 'Supermercado', 'Perim', 'Supermercados Perim', 'Rua Bernardo Horta, 322 – Guandu', 'Cachoeiro de Itapemirim/ES', 'Guandu', 'Circuito Guandu', 'Semanal', '', '');
  insertStore.run('28.129.260 | DRIFT - INDEPENDÊNCIA', 'Supermercado', 'Drift', 'Drift Supermercados', 'Rua Moreira, 281 – Independência', 'Cachoeiro de Itapemirim/ES', 'Independência', 'Circuito Centro', 'Semanal', '', '');
  insertStore.run('33.014.556 | LASA - CACHOEIRO DE ITAPEMIRIM CENTRO', 'Rede Varejista', 'LASA', 'Lojas Americanas', 'Rua 25 de Março, 33, loja 209 – Centro', 'Cachoeiro de Itapemirim/ES', 'Centro', 'Circuito Centro', 'Semanal', '', '');
  insertStore.run('27.735.448 | OSVALDO PERIM - CAIÇARA', 'Supermercado', 'Perim', 'Supermercados Perim', 'Av. Jones dos Santos Neves, 1371 – Caiçara', 'Cachoeiro de Itapemirim/ES', 'Caiçara', 'Circuito Caiçara', 'Semanal', '', '');
  insertStore.run('33.014.556 | LASA - PARAÍSO', 'Rede Varejista', 'LASA', 'Lojas Americanas', 'Av. Francisco Lacerda de Aguiar, 382 (Shopping Sul) – Paraíso', 'Cachoeiro de Itapemirim/ES', 'Paraíso', 'Circuito Paraíso', 'Semanal', '', '');

  // Marcas oficiais PepsiCo Brasil (extraídas de merchandising_pro_pepsico.sql)
  const pepsicoBrands = [
    'Baconzitos', 'Cebolitos', 'Cheetos', 'Doritos', 'eQlibri', 'Fandangos',
    'Fofura', 'Gatorade', 'H2OH!', 'Kero Coco', 'Lay’s', 'Lipton',
    'Pepsi', 'Pingo d’Ouro', 'PopCorners', 'Quaker', 'Ruffles', 'Skiny',
    'Stiksy', 'Toddy', 'Toddynho', 'Torcida', 'Tostitos',
  ];

  const insertBrand = db.prepare('INSERT INTO brands (name, is_own, color) VALUES (?, 1, ?)');
  const brandIdMap = {};
  pepsicoBrands.forEach((bName) => {
    const res = insertBrand.run(bName, '#1d4ed8');
    brandIdMap[bName] = res.lastInsertRowid;
  });

  // Produtos de referência PepsiCo Brasil (extraídos de merchandising_pro_pepsico.sql)
  // EANs mantidos como 'A CONFERIR' para preenchimento oficial após conferência da embalagem.
  const pepsicoProducts = [
    ['PEP-001', 'Baconzitos', 'Salgadinhos', 'Baconzitos 36 g', 'Pacote'],
    ['PEP-002', 'Cebolitos', 'Salgadinhos', 'Cebolitos 35 g', 'Pacote'],
    ['PEP-003', 'Cheetos', 'Snacks de milho', 'Cheetos Onda Requeijão 40 g', 'Pacote'],
    ['PEP-004', 'Cheetos', 'Snacks de milho', 'Cheetos Lua Parmesão 35 g', 'Pacote'],
    ['PEP-005', 'Doritos', 'Snacks de milho', 'Doritos Queijo Nacho 32 g', 'Pacote'],
    ['PEP-006', 'Doritos', 'Snacks de milho', 'Doritos Queijo Nacho 75 g', 'Pacote'],
    ['PEP-007', 'Doritos', 'Snacks de milho', 'Doritos Queijo Nacho 120 g', 'Pacote'],
    ['PEP-008', 'Fandangos', 'Snacks de milho', 'Fandangos Presunto 35 g', 'Pacote'],
    ['PEP-009', 'Fandangos', 'Snacks de milho', 'Fandangos Queijo 35 g', 'Pacote'],
    ['PEP-010', 'Lay’s', 'Batatas chips', 'Lay’s Clássica 62 g', 'Pacote'],
    ['PEP-011', 'Lay’s', 'Batatas chips', 'Lay’s Sour Cream 62 g', 'Pacote'],
    ['PEP-012', 'Ruffles', 'Batatas chips', 'Ruffles Original 68 g', 'Pacote'],
    ['PEP-013', 'Ruffles', 'Batatas chips', 'Ruffles Original 115 g', 'Pacote'],
    ['PEP-014', 'Torcida', 'Snacks de trigo', 'Torcida Pimenta Mexicana 35 g', 'Pacote'],
    ['PEP-015', 'Torcida', 'Snacks de trigo', 'Torcida Pimenta Mexicana 100 g', 'Pacote'],
    ['PEP-016', 'Quaker', 'Aveias e cereais', 'Aveia em Flocos Finos 165 g', 'Pacote'],
    ['PEP-017', 'Quaker', 'Aveias e cereais', 'Aveia em Flocos Finos 450 g', 'Pacote'],
    ['PEP-018', 'Gatorade', 'Bebidas esportivas', 'Gatorade Laranja 500 ml', 'Garrafa'],
    ['PEP-019', 'Gatorade', 'Bebidas esportivas', 'Gatorade Limão 500 ml', 'Garrafa'],
    ['PEP-020', 'Gatorade', 'Bebidas esportivas', 'Gatorade Uva 500 ml', 'Garrafa'],
    ['PEP-021', 'Pepsi', 'Refrigerantes', 'Pepsi Lata 350 ml', 'Lata'],
    ['PEP-022', 'Pepsi', 'Refrigerantes', 'Pepsi 2 L', 'Garrafa PET'],
    ['PEP-023', 'H2OH!', 'Refrigerantes', 'H2OH! Limoneto 500 ml', 'Garrafa'],
    ['PEP-024', 'Toddynho', 'Bebidas lácteas', 'Toddynho Chocolate 200 ml', 'Caixinha'],
    ['PEP-025', 'Toddy', 'Achocolatados', 'Toddy Original 370 g', 'Pote/Pacote'],
  ];

  const insertProduct = db.prepare(
    'INSERT INTO products (sku, ean, name, brand_id, category, unit, system_price, min_stock, ideal_facings) VALUES (?, ?, ?, ?, ?, ?, 0, 10, 4)'
  );
  pepsicoProducts.forEach(([sku, brand, category, name, unit]) => {
    insertProduct.run(sku, 'A CONFERIR', name, brandIdMap[brand], category, unit);
  });
}

module.exports = {
  seedIfEmpty,
  DEFAULT_CHECKLIST_ITEMS,
  createDefaultChecklist,
};
