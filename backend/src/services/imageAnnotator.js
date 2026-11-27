const path = require('node:path');
const fs = require('node:fs');

let _sharp = null;
function getSharp() {
  if (!_sharp) _sharp = require('sharp');
  return _sharp;
}

const CATEGORY_STYLE = {
  rupture: { color: '#ef4444', label: 'Ruptura' },
  brand: { color: '#2563eb', label: 'Marca' },
  exposure: { color: '#f59e0b', label: 'Exposição' },
  opportunity: { color: '#9333ea', label: 'Oportunidade' },
};

const STAGE_LABELS = {
  SELFIE_ENTRADA: 'Selfie Entrada',
  INICIAL: 'Foto Inicial (Antes)',
  COMPLEMENTAR: 'Foto Complementar',
  FINAL: 'Foto Final (Depois)',
};

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatBrazilDateTime(input) {
  const date = input ? new Date(input) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeCategory(raw) {
  const v = String(raw || '').toLowerCase().trim();
  if (v.includes('ruptur') || v.includes('falta') || v.includes('vazio') || v.includes('empty')) return 'rupture';
  if (v.includes('brand') || v.includes('marca') || v.includes('produt')) return 'brand';
  if (v.includes('expos') || v.includes('prec') || v.includes('preç') || v.includes('issue') || v.includes('etiquet')) return 'exposure';
  if (v.includes('oport') || v.includes('extra') || v.includes('display')) return 'opportunity';
  return 'exposure';
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function detectPanoramic(width, height) {
  return Number(width) > 0 && Number(height) > 0 && Number(width) / Number(height) >= 2.0;
}

/**
 * Aplica uma marca d'água discreta de auditoria no canto inferior direito da foto em HD:
 * Loja auditada • Área/Tipo da foto • Data e hora (Brasília).
 * Suporta imagens normais e panorâmicas preservando 100% da resolução original (HD) e orientação EXIF.
 */
async function applyAuditWatermark({
  imagePath,
  outputDir,
  storeName,
  area,
  stage,
  promoterName,
  capturedAt,
}) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;

  const sharp = getSharp();
  const baseBuffer = await sharp(imagePath).rotate().toBuffer();
  const meta = await sharp(baseBuffer).metadata();
  const width = meta.width || 1280;
  const height = meta.height || 720;
  const isPanoramic = detectPanoramic(width, height);

  const scale = isPanoramic
    ? Math.max(0.65, Math.min(1.6, height / 900))
    : Math.max(0.65, Math.min(2.0, width / 1400));
  const fontPrimary = Math.max(13, Math.round(20 * scale));
  const fontSecondary = Math.max(11, Math.round(16 * scale));
  const padX = Math.round(14 * scale);
  const padY = Math.round(10 * scale);
  const margin = Math.round(16 * scale);

  const dateLabel = formatBrazilDateTime(capturedAt);
  const stageLabel = stage ? STAGE_LABELS[stage] || stage : '';
  const areaLabel = area
    ? `${area}${isPanoramic && !String(area).toLowerCase().includes('panorâm') ? ' (Panorâmica)' : ''}`
    : isPanoramic
    ? 'Panorâmica'
    : '';
  const areaPart = [areaLabel, stageLabel].filter(Boolean).join(' • ');
  const line1 = `${storeName || 'Loja Auditada'}${areaPart ? `  •  ${areaPart}` : ''}`.slice(0, 96);
  const line2 = `${dateLabel}${promoterName ? `  •  ${promoterName}` : ''}  •  MERCHANDISING PRO`.slice(0, 96);

  const estW1 = Math.round(line1.length * fontPrimary * 0.56);
  const estW2 = Math.round(line2.length * fontSecondary * 0.56);
  const boxW = Math.min(width - margin * 2, Math.max(estW1, estW2) + padX * 2);
  const boxH = Math.round(fontPrimary * 1.35 + fontSecondary * 1.35 + padY * 1.9);
  const boxX = Math.max(margin, width - boxW - margin);
  const boxY = Math.max(margin, height - boxH - margin);
  const radius = Math.round(10 * scale);

  const svgOverlay = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${radius}" fill="#0f172a" fill-opacity="0.62" stroke="#ffffff" stroke-opacity="0.22" stroke-width="${Math.max(1, Math.round(1.5 * scale))}"/>
      <text x="${boxX + padX}" y="${boxY + padY + fontPrimary}" fill="#ffffff" fill-opacity="0.95" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${fontPrimary}" font-weight="700">${escapeXml(line1)}</text>
      <text x="${boxX + padX}" y="${boxY + padY + Math.round(fontPrimary * 1.35) + fontSecondary}" fill="#cbd5e1" fill-opacity="0.92" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${fontSecondary}" font-weight="500">${escapeXml(line2)}</text>
    </svg>
  `);

  const baseName = path.basename(imagePath, path.extname(imagePath));
  const filename = `wm-${baseName}.jpg`;
  const targetDir = outputDir || path.dirname(imagePath);
  const watermarkedPath = path.join(targetDir, filename);

  await sharp(baseBuffer)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .jpeg({ quality: 96, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(watermarkedPath);

  return {
    watermarkedPath,
    filename,
    mimetype: 'image/jpeg',
    width,
    height,
    isPanoramic,
    watermarkText: `${line1} | ${line2}`,
  };
}

/**
 * Normaliza caixas de demarcação para o padrão [ymin, xmin, ymax, xmax] em escala 0..1000.
 * Aceita box_2d em 0..1000, 0..100 (porcentagem), 0..1 (fração) ou { x, y, width, height }.
 */
function normalizeAnnotations(rawList) {
  if (!Array.isArray(rawList)) return [];

  const result = [];
  for (const item of rawList.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    let ymin, xmin, ymax, xmax;

    if (Array.isArray(item.box_2d) && item.box_2d.length === 4) {
      [ymin, xmin, ymax, xmax] = item.box_2d.map(Number);
    } else if (Array.isArray(item.bbox) && item.bbox.length === 4) {
      [ymin, xmin, ymax, xmax] = item.bbox.map(Number);
    } else if (item.x !== undefined && item.y !== undefined && item.width !== undefined && item.height !== undefined) {
      xmin = Number(item.x);
      ymin = Number(item.y);
      xmax = xmin + Number(item.width);
      ymax = ymin + Number(item.height);
    } else {
      continue;
    }

    if ([ymin, xmin, ymax, xmax].some((n) => Number.isNaN(n))) continue;

    const maxCoord = Math.max(ymin, xmin, ymax, xmax);
    if (maxCoord <= 1.0) {
      ymin *= 1000;
      xmin *= 1000;
      ymax *= 1000;
      xmax *= 1000;
    } else if (maxCoord <= 100) {
      ymin *= 10;
      xmin *= 10;
      ymax *= 10;
      xmax *= 10;
    }

    if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
    if (xmin > xmax) [xmin, xmax] = [xmax, xmin];

    ymin = Math.round(clamp(ymin, 0, 970));
    xmin = Math.round(clamp(xmin, 0, 970));
    ymax = Math.round(clamp(ymax, ymin + 30, 1000));
    xmax = Math.round(clamp(xmax, xmin + 30, 1000));

    const category = normalizeCategory(item.category || item.type || item.label);
    const label = String(item.label || CATEGORY_STYLE[category].label).trim().slice(0, 48);

    result.push({
      label,
      category,
      box_2d: [ymin, xmin, ymax, xmax],
    });
  }

  return result;
}

/**
 * Desenha as áreas demarcadas pela IA em alta definição sobre uma cópia da imagem original,
 * incluindo a marca d'água discreta de data/hora, loja e área auditada.
 */
async function renderAnnotatedImage({ imagePath, annotations = [], outputDir, planogramScore, storeName, area, capturedAt }) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;

  const sharp = getSharp();
  const baseBuffer = await sharp(imagePath).rotate().toBuffer();
  const meta = await sharp(baseBuffer).metadata();
  const width = meta.width || 1280;
  const height = meta.height || 720;
  const isPanoramic = detectPanoramic(width, height);

  const scale = isPanoramic
    ? Math.max(0.7, Math.min(1.65, height / 850))
    : Math.max(0.75, Math.min(2.2, width / 1200));
  const strokeW = Math.max(3, Math.round(5 * scale));
  const fontSize = Math.max(16, Math.round(24 * scale));
  const headerH = Math.max(44, Math.round(56 * scale));
  const footerH = Math.max(36, Math.round(44 * scale));
  const padX = Math.round(14 * scale);

  const normalized = normalizeAnnotations(annotations);
  const dateLabel = formatBrazilDateTime(capturedAt);
  const svgParts = [];

  const headerText = `${storeName || 'PDV'}${area ? ` • ${area}` : ''}${isPanoramic ? ' • PANORÂMICA' : ''} • ${dateLabel} • Planograma ${planogramScore ?? '-'}% (${normalized.length} área(s))`;
  svgParts.push(`
    <rect x="0" y="0" width="${width}" height="${headerH}" fill="#0f172a" fill-opacity="0.72"/>
    <text x="${padX}" y="${Math.round(headerH * 0.66)}" fill="#ffffff" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${Math.round(fontSize * 0.78)}" font-weight="700">${escapeXml(headerText.slice(0, 105))}</text>
  `);

  normalized.forEach((ann, idx) => {
    const [ymin, xmin, ymax, xmax] = ann.box_2d;
    const x = Math.round((xmin / 1000) * width);
    const y = Math.round((ymin / 1000) * height);
    const w = Math.max(24, Math.round(((xmax - xmin) / 1000) * width));
    const h = Math.max(24, Math.round(((ymax - ymin) / 1000) * height));
    const style = CATEGORY_STYLE[ann.category] || CATEGORY_STYLE.exposure;
    const color = style.color;

    const pillText = `#${idx + 1} ${ann.label}`;
    const pillH = Math.round(fontSize * 1.55);
    const pillW = Math.min(width - 16, Math.max(Math.round(fontSize * 5), Math.round(pillText.length * fontSize * 0.62 + padX * 1.6)));
    const pillX = clamp(x, 8, Math.max(8, width - pillW - 8));
    const pillY = y - pillH - 4 >= headerH ? y - pillH - 4 : Math.min(height - footerH - pillH - 4, y + 6);

    const cornerLen = Math.min(Math.round(w * 0.25), Math.round(h * 0.25), Math.round(28 * scale));

    svgParts.push(`
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="${strokeW}" rx="${Math.round(8 * scale)}"/>
      <path d="M ${x} ${y + cornerLen} L ${x} ${y} L ${x + cornerLen} ${y}
               M ${x + w - cornerLen} ${y} L ${x + w} ${y} L ${x + w} ${y + cornerLen}
               M ${x} ${y + h - cornerLen} L ${x} ${y + h} L ${x + cornerLen} ${y + h}
               M ${x + w - cornerLen} ${y + h} L ${x + w} ${y + h} L ${x + w} ${y + h - cornerLen}"
            fill="none" stroke="#ffffff" stroke-width="${Math.max(2, Math.round(strokeW * 0.6))}" stroke-linecap="round"/>
      <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" fill="${color}" rx="${Math.round(6 * scale)}"/>
      <text x="${pillX + Math.round(padX * 0.7)}" y="${pillY + Math.round(pillH * 0.7)}" fill="#ffffff" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${Math.round(fontSize * 0.82)}" font-weight="700">${escapeXml(pillText)}</text>
    `);
  });

  if (normalized.length === 0) {
    const mx = Math.round(width * 0.12);
    const my = Math.round(height * 0.18);
    const mw = Math.round(width * 0.76);
    const mh = Math.round(height * 0.64);
    svgParts.push(`
      <rect x="${mx}" y="${my}" width="${mw}" height="${mh}" fill="#f59e0b" fill-opacity="0.08" stroke="#f59e0b" stroke-width="${strokeW}" stroke-dasharray="${Math.round(14 * scale)},${Math.round(10 * scale)}" rx="${Math.round(10 * scale)}"/>
      <rect x="${mx}" y="${my}" width="${Math.min(mw, Math.round(fontSize * 18))}" height="${Math.round(fontSize * 1.6)}" fill="#f59e0b" rx="${Math.round(6 * scale)}"/>
      <text x="${mx + padX}" y="${my + Math.round(fontSize * 1.12)}" fill="#0f172a" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${Math.round(fontSize * 0.8)}" font-weight="700">Área geral de gôndola analisada</text>
    `);
  }

  const legendY = height - footerH;
  svgParts.push(`
    <rect x="0" y="${legendY}" width="${width}" height="${footerH}" fill="#0f172a" fill-opacity="0.72"/>
    <text x="${padX}" y="${legendY + Math.round(footerH * 0.65)}" fill="#e2e8f0" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${Math.round(fontSize * 0.72)}" font-weight="600">Legenda: [Vermelho] Ruptura  •  [Azul] Marca/Produto  •  [Amarelo] Exposição/Preço  •  [Roxo] Oportunidade</text>
  `);

  const svgOverlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgParts.join('\n')}</svg>`
  );

  const baseName = path.basename(imagePath, path.extname(imagePath));
  const filename = `annotated-${baseName}.jpg`;
  const targetDir = outputDir || path.dirname(imagePath);
  const annotatedPath = path.join(targetDir, filename);

  await sharp(baseBuffer)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .jpeg({ quality: 96, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(annotatedPath);

  return {
    annotatedPath,
    filename,
    mimetype: 'image/jpeg',
    width,
    height,
    isPanoramic,
    annotations: normalized,
  };
}

module.exports = {
  applyAuditWatermark,
  detectPanoramic,
  normalizeAnnotations,
  renderAnnotatedImage,
  formatBrazilDateTime,
  CATEGORY_STYLE,
};
