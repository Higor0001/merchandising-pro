const test = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeRegex,
  isManager,
  canOperateVisit,
  getBrazilDateStr,
  getBrazilDayName,
  parseUtcTimestamp,
} = require('../src/utils/security');
const { hashPasswordAsync, verifyPasswordAsync } = require('../src/db/database');
const { authorize } = require('../src/middleware/auth');
const { imageFileFilter } = require('../src/middleware/upload');
const { buildHeuristicFallback, extractJsonObject, normalizeVisionPayload } = require('../src/services/aiService');
const { applyAuditWatermark, detectPanoramic, normalizeAnnotations, renderAnnotatedImage } = require('../src/services/imageAnnotator');
const { deleteTelegramMessage } = require('../src/services/telegramService');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

test('escapeRegex escapa metacaracteres para evitar Regex Injection / ReDoS', () => {
  assert.equal(escapeRegex('Doritos (100g) [promo].*+?^${}|\\'), 'Doritos \\(100g\\) \\[promo\\]\\.\\*\\+\\?\\^\\$\\{\\}\\|\\\\');
  const re = new RegExp(escapeRegex('((a+)+)$'));
  assert.equal(re.test('((a+)+)$'), true);
});

test('getBrazilDateStr e getBrazilDayName respeitam fuso America/Sao_Paulo à noite', () => {
  // 2026-11-27 01:30:00Z = 2026-11-26 22:30:00 BRT (Quinta-feira)
  const lateNightBrazil = new Date('2026-11-27T01:30:00Z');
  assert.equal(getBrazilDateStr(lateNightBrazil), '2026-11-26');
  assert.equal(getBrazilDayName(lateNightBrazil), 'Quinta-feira');
});

test('parseUtcTimestamp interpreta ISO-8601 e formato legado sem desvio de fuso', () => {
  const legacy = parseUtcTimestamp('2026-11-26 14:00:00');
  const iso = parseUtcTimestamp('2026-11-26T14:00:00.000Z');
  assert.equal(legacy.getTime(), iso.getTime());
});

test('hashPasswordAsync e verifyPasswordAsync validam senhas corretamente', async () => {
  const hash = await hashPasswordAsync('SenhaForte!2026');
  assert.equal(await verifyPasswordAsync('SenhaForte!2026', hash), true);
  assert.equal(await verifyPasswordAsync('SenhaErrada', hash), false);
});

test('RBAC: canOperateVisit e authorize bloqueiam promotor em recursos administrativos e de terceiros', () => {
  const promotorA = { id: 1, role: 'promotor' };
  const promotorB = { id: 2, role: 'promotor' };
  const supervisor = { id: 3, role: 'supervisor' };
  const visitOfA = { id: 10, promoter_id: 1 };

  assert.equal(isManager(promotorA), false);
  assert.equal(isManager(supervisor), true);
  assert.equal(canOperateVisit(promotorA, visitOfA), true);
  assert.equal(canOperateVisit(promotorB, visitOfA), false);
  assert.equal(canOperateVisit(supervisor, visitOfA), true);

  let statusCode = 200;
  let calledNext = false;
  const mw = authorize('admin', 'supervisor');
  mw(
    { user: promotorA },
    { status: (c) => { statusCode = c; return { json: () => {} }; } },
    () => { calledNext = true; }
  );
  assert.equal(statusCode, 403);
  assert.equal(calledNext, false);

  mw({ user: supervisor }, { status: () => ({ json: () => {} }) }, () => { calledNext = true; });
  assert.equal(calledNext, true);
});

test('imageFileFilter aceita apenas JPG/PNG/WebP e bloqueia HTML/SVG/JS (Stored XSS)', () => {
  const check = (mimetype, originalname) =>
    new Promise((resolve) => {
      imageFileFilter({}, { mimetype, originalname }, (err, accepted) => resolve({ err, accepted }));
    });

  return Promise.all([
    check('image/jpeg', 'foto.jpg').then((r) => assert.equal(r.accepted, true)),
    check('image/png', 'foto.png').then((r) => assert.equal(r.accepted, true)),
    check('image/webp', 'foto.webp').then((r) => assert.equal(r.accepted, true)),
    check('text/html', 'xss.html').then((r) => { assert.ok(r.err); assert.equal(r.accepted, false); }),
    check('image/svg+xml', 'xss.svg').then((r) => { assert.ok(r.err); assert.equal(r.accepted, false); }),
    check('application/javascript', 'evil.js').then((r) => { assert.ok(r.err); assert.equal(r.accepted, false); }),
  ]);
});

test('aiService extrai JSON de markdown e rotula fallback heurístico corretamente', () => {
  const parsed = extractJsonObject('```json\n{"planogram_score": 88, "confidence": 92, "detected_brands": [{"brand":"Doritos","facings":5,"confidence":90}]}\n```');
  const norm = normalizeVisionPayload(parsed, 'Fallback');
  assert.equal(norm.planogram_score, 88);
  assert.equal(norm.confidence, 92);
  assert.equal(norm.detected_brands[0].brand, 'Doritos');

  const heur = buildHeuristicFallback({
    storeLabel: 'Loja Teste',
    products: [],
    brandMap: {},
    recentReplenishments: [],
    recentOccurrences: [],
    notes: '',
    fallbackReason: 'sem chave',
  });
  assert.equal(heur.analysis_mode, 'heuristic_fallback');
  assert.equal(heur.confidence, 0);
  assert.match(heur.auto_report, /Modo Heurístico/);
});

test('imageAnnotator normaliza box_2d e gera imagem HD demarcada válida', async () => {
  const norm = normalizeAnnotations([
    { label: 'Ruptura Doritos', category: 'rupture', box_2d: [200, 150, 500, 480] },
    { label: 'Bloco Cheetos', category: 'brand', box_2d: [10, 60, 40, 95] }, // escala 0..100
  ]);
  assert.equal(norm.length, 2);
  assert.deepEqual(norm[0].box_2d, [200, 150, 500, 480]);
  assert.deepEqual(norm[1].box_2d, [100, 600, 400, 950]);

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'merchpro-annot-'));
  const srcPath = path.join(tmpDir, 'shelf.jpg');
  await sharp({
    create: { width: 1280, height: 720, channels: 3, background: { r: 40, g: 55, b: 80 } },
  })
    .jpeg({ quality: 90 })
    .toFile(srcPath);

  const rendered = await renderAnnotatedImage({
    imagePath: srcPath,
    annotations: norm,
    outputDir: tmpDir,
    planogramScore: 84,
    storeName: 'Loja Teste',
  });

  assert.ok(rendered && fs.existsSync(rendered.annotatedPath));
  const meta = await sharp(rendered.annotatedPath).metadata();
  assert.equal(meta.width, 1280);
  assert.equal(meta.height, 720);
  assert.equal(meta.format, 'jpeg');

  const wm = await applyAuditWatermark({
    imagePath: srcPath,
    outputDir: tmpDir,
    storeName: 'CASAGRANDE - GUANDU',
    area: 'Ilha Promocional',
    stage: 'INICIAL',
    promoterName: 'Higor',
  });
  assert.ok(wm && fs.existsSync(wm.watermarkedPath));
  const wmMeta = await sharp(wm.watermarkedPath).metadata();
  assert.equal(wmMeta.width, 1280);
  assert.equal(wmMeta.height, 720);
  assert.match(wm.watermarkText, /CASAGRANDE - GUANDU/);
  assert.match(wm.watermarkText, /Ilha Promocional/);
  assert.equal(wm.isPanoramic, false);

  // Teste específico de imagem panorâmica (3200x900, aspect ratio ~3.55)
  assert.equal(detectPanoramic(3200, 900), true);
  assert.equal(detectPanoramic(1280, 720), false);
  const panoSrcPath = path.join(tmpDir, 'panorama.jpg');
  await sharp({
    create: { width: 3200, height: 900, channels: 3, background: { r: 28, g: 45, b: 68 } },
  })
    .jpeg({ quality: 90 })
    .toFile(panoSrcPath);

  const panoWm = await applyAuditWatermark({
    imagePath: panoSrcPath,
    outputDir: tmpDir,
    storeName: 'CASAGRANDE - GUANDU',
    area: 'Corredor Principal',
    stage: 'INICIAL',
    promoterName: 'Higor',
  });
  assert.ok(panoWm && fs.existsSync(panoWm.watermarkedPath));
  assert.equal(panoWm.isPanoramic, true);
  assert.match(panoWm.watermarkText, /Panorâmica/);
  const panoWmMeta = await sharp(panoWm.watermarkedPath).metadata();
  assert.equal(panoWmMeta.width, 3200);
  assert.equal(panoWmMeta.height, 900);

  const panoAnnot = await renderAnnotatedImage({
    imagePath: panoSrcPath,
    annotations: norm,
    outputDir: tmpDir,
    planogramScore: 91,
    storeName: 'CASAGRANDE - GUANDU',
    area: 'Corredor Principal',
  });
  assert.ok(panoAnnot && fs.existsSync(panoAnnot.annotatedPath));
  assert.equal(panoAnnot.isPanoramic, true);

  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

test('telegramService.deleteTelegramMessage trata ausência de configuração/messageId com segurança', async () => {
  const res = await deleteTelegramMessage({ messageId: null });
  assert.equal(res.deleted, false);
});
