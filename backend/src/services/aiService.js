const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { col } = require('../db/database');
const { detectPanoramic, normalizeAnnotations, renderAnnotatedImage } = require('./imageAnnotator');

const DEFAULT_GROQ_VISION_MODEL = 'qwen/qwen3.8-27b';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Normaliza orientação EXIF e gera versão nítida (até 1536px JPEG 85%) para envio à API de Visão,
 * garantindo que as coordenadas box_2d batam 100% com a imagem HD rotacionada no anotador.
 */
async function prepareImageForVision(imagePath, maxDim = 1536, quality = 85) {
  const buffer = await sharp(imagePath)
    .rotate()
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
  return {
    mime: 'image/jpeg',
    base64: buffer.toString('base64'),
  };
}

function buildVisionPrompt({ storeLabel, ownBrands, planogramRef, notes, openIssues, isPanoramic = false }) {
  return [
    'Você é um auditor sênior de trade marketing e merchandising de varejo no Brasil (foco em marcas PepsiCo: Doritos, Cheetos, Ruffles, Lay’s, Fandangos, Pepsi, Gatorade, H2OH!, Quaker, Toddy, Toddynho, Torcida, Kero Coco, Lipton).',
    `Contexto: Loja "${storeLabel}".`,
    ownBrands.length ? `Marcas cadastradas: ${ownBrands.slice(0, 12).join(', ')}.` : null,
    planogramRef.length ? `Referência de planograma da loja: ${planogramRef.slice(0, 5).join('; ')}.` : null,
    openIssues.length ? `Ocorrências abertas na loja: ${openIssues.slice(0, 5).join('; ')}.` : null,
    notes ? `Observação do promotor: "${String(notes).slice(0, 300)}".` : null,
    isPanoramic
      ? 'ATENÇÃO — IMAGEM PANORÂMICA DETECTADA: Esta fotografia cobre um amplo ângulo horizontal de corredor/gôndola. Varra cuidadosamente DA ESQUERDA PARA A DIREITA por toda a extensão (xmin de 0 até 1000) e demarque entre 3 e 10 áreas reais ao longo do corredor/gôndola, mantendo caixas ajustadas proporcionalmente à largura panorâmica.'
      : 'Analise SOMENTE o que é claramente visível na fotografia da gôndola e demarque com precisão entre 2 e 6 áreas reais (rupturas/espaços vazios, blocos de marcas visíveis, etiquetas ausentes/problemas de exposição ou espaços de oportunidade).',
    'Identifique também o tipo de área do PDV em detected_area (escolha exatamente uma: "Corredor Principal", "Gôndola Principal", "Ponta de Gôndola", "Ilha Promocional", "Checkout", "Ponto Extra", "Display" ou "Estoque/Retaguarda").',
    'NÃO invente produtos ou marcas que não consiga ler claramente na foto.',
    'Use coordenadas normalizadas de 0 a 1000 em box_2d no formato [ymin, xmin, ymax, xmax] (0,0 = topo esquerdo; 1000,1000 = base direita), ajustando as bordas exatamente ao redor do objeto/buraco.',
    'Responda EXCLUSIVAMENTE em JSON válido (sem markdown) no formato exato:',
    '{"detected_area":"Gôndola Principal","detected_ruptures":["string"],"detected_brands":[{"brand":"string","facings":4,"confidence":85}],"exposure_issues":["string"],"planogram_score":80,"suggestions":["string"],"extra_point_opportunities":["string"],"auto_report":"resumo objetivo em português (máx 2 frases)","confidence":85,"annotations":[{"label":"Ruptura: Espaço vazio","category":"rupture","box_2d":[300,200,520,450]}]}',
    'Valores permitidos em annotations[].category: "rupture", "brand", "exposure", "opportunity".',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildVerificationPrompt(annotations) {
  const list = annotations
    .map((a, i) => `#${i + 1} [${a.category}] "${a.label}" box_2d=${JSON.stringify(a.box_2d)}`)
    .join('\n');

  return [
    'Esta imagem já contém caixas numeradas (#1, #2, ...) desenhadas na primeira passagem de análise de gôndola.',
    'Sua tarefa é AUDITAR VISUALMENTE cada caixa desenhada sobre a foto com rigor máximo:',
    list,
    'Para cada caixa: (1) se estiver deslocada, corrija exatamente o box_2d [ymin, xmin, ymax, xmax] (escala 0..1000); (2) se for falso positivo ou rótulo errado, remova ou renomeie; (3) se houver ruptura/buraco muito evidente sem marcação, adicione.',
    'Responda EXCLUSIVAMENTE em JSON válido (sem markdown):',
    '{"verified_annotations":[{"label":"string","category":"rupture|brand|exposure|opportunity","box_2d":[ymin,xmin,ymax,xmax]}],"verification_notes":"resumo curto do que foi confirmado ou corrigido"}',
  ].join('\n');
}

function normalizeVisionPayload(parsed, fallbackReport) {
  const toStrArray = (arr, fallback = []) =>
    Array.isArray(arr) ? arr.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8) : fallback;

  const detectedBrands = Array.isArray(parsed?.detected_brands)
    ? parsed.detected_brands
        .filter((b) => b && b.brand)
        .map((b) => ({
          brand: String(b.brand).trim(),
          facings: Math.max(0, Math.round(Number(b.facings || 0))),
          confidence: Math.min(100, Math.max(0, Number(Number(b.confidence || 75).toFixed(1)))),
        }))
        .slice(0, 10)
    : [];

  const planogramScore = Math.min(100, Math.max(0, Number(Number(parsed?.planogram_score ?? 75).toFixed(1))));
  const confidence = Math.min(100, Math.max(0, Number(Number(parsed?.confidence ?? 75).toFixed(1))));
  const annotations = normalizeAnnotations(parsed?.annotations);

  return {
    detected_area: String(parsed?.detected_area || '').trim(),
    detected_ruptures: toStrArray(parsed?.detected_ruptures, ['Nenhuma ruptura evidente detectada na imagem.']),
    detected_brands: detectedBrands,
    exposure_issues: toStrArray(parsed?.exposure_issues, ['Sem desvios graves de exposição identificados.']),
    planogram_score: Number.isNaN(planogramScore) ? 75 : planogramScore,
    suggestions: toStrArray(parsed?.suggestions, ['Manter frenteamento e conferência de etiquetas de preço.']),
    extra_point_opportunities: toStrArray(parsed?.extra_point_opportunities, []),
    auto_report: String(parsed?.auto_report || fallbackReport).trim(),
    confidence: Number.isNaN(confidence) ? 75 : confidence,
    annotations,
  };
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Resposta vazia do modelo de visão.');
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('JSON não encontrado na resposta do modelo.');
  }
  return JSON.parse(stripped.slice(start, end + 1));
}

async function callGroqVisionJson({ imagePath, prompt, maxDim = 1536, maxTokens = 1200 }) {
  const apiKey = (process.env.GROQ_API_KEY || '').trim();
  if (!apiKey || !imagePath || !fs.existsSync(imagePath)) return null;

  const model = (process.env.GROQ_VISION_MODEL || DEFAULT_GROQ_VISION_MODEL).trim();
  const { mime, base64 } = await prepareImageForVision(imagePath, maxDim, 85);

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq Vision HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = extractJsonObject(content);
  return { parsed, model };
}

async function callGeminiVisionJson({ imagePath, prompt, maxDim = 1536 }) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || !imagePath || !fs.existsSync(imagePath)) return null;

  const model = (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const { mime, base64 } = await prepareImageForVision(imagePath, maxDim, 85);

  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mime, data: base64 } },
        ],
      },
    ],
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  });

  const parsed = extractJsonObject(response?.text);
  return { parsed, model };
}

/**
 * 2ª passagem de auto-verificação visual:
 * Desenha as caixas da 1ª passagem sobre a imagem e pede à IA para conferir e corrigir desvios.
 */
async function runSecondPassVerification({ provider, imagePath, annotations, planogramScore, storeName, isPanoramic = false }) {
  if (!annotations || annotations.length === 0) {
    return { annotations: [], selfVerified: false, verificationNotes: '' };
  }

  let tmpDir = null;
  try {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'merchpro-verify-'));
    const draft = await renderAnnotatedImage({
      imagePath,
      annotations,
      outputDir: tmpDir,
      planogramScore,
      storeName,
    });
    if (!draft?.annotatedPath) {
      return { annotations, selfVerified: false, verificationNotes: '' };
    }

    const verifyPrompt = buildVerificationPrompt(draft.annotations);
    const verifyMaxDim = isPanoramic ? 1600 : 1280;
    const res =
      provider === 'groq_vision'
        ? await callGroqVisionJson({ imagePath: draft.annotatedPath, prompt: verifyPrompt, maxDim: verifyMaxDim, maxTokens: 1100 })
        : await callGeminiVisionJson({ imagePath: draft.annotatedPath, prompt: verifyPrompt, maxDim: verifyMaxDim });

    const verifiedList = normalizeAnnotations(res?.parsed?.verified_annotations);
    const notes = String(res?.parsed?.verification_notes || 'Caixas auditadas automaticamente na 2ª passagem.').trim();
    return {
      annotations: verifiedList.length > 0 ? verifiedList : annotations,
      selfVerified: true,
      verificationNotes: notes,
    };
  } catch (err) {
    console.warn('2ª passagem de verificação IA ignorada (mantendo 1ª passagem):', err.message);
    return {
      annotations,
      selfVerified: false,
      verificationNotes: '1ª passagem mantida (verificação adicional indisponível no momento).',
    };
  } finally {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function buildHeuristicFallback({ storeLabel, products, brandMap, recentReplenishments, recentOccurrences, notes, fallbackReason }) {
  const prodMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const ruptures = recentReplenishments
    .filter((r) => r.status === 'Ruptura' || r.status === 'Indisponível')
    .map((r) => {
      const p = prodMap[r.product_id];
      const b = p ? brandMap[p.brand_id] : null;
      return `Ruptura registrada no histórico da loja: ${p?.name || `Produto #${r.product_id}`} (${b?.name || 'PepsiCo'})`;
    });

  if (ruptures.length === 0) {
    ruptures.push('Sem rupturas recentes registradas no histórico — confirme visualmente na gôndola.');
  }

  const ownBrands = [...new Set(products.map((p) => brandMap[p.brand_id]?.name).filter(Boolean))].slice(0, 4);
  const detectedBrands = ownBrands.map((brand) => ({
    brand,
    facings: 0,
    confidence: 0,
  }));

  const exposureIssues = [];
  if (recentOccurrences.some((o) => o.type === 'Falta de Preço')) {
    exposureIssues.push('Histórico aponta etiqueta de preço ausente em item prioritário da loja.');
  }
  if (notes && notes.toLowerCase().includes('concorrente')) {
    exposureIssues.push('Observação do promotor indica pressão/espaço ocupado por concorrente.');
  }
  if (exposureIssues.length === 0) {
    exposureIssues.push('Verifique frenteamento, etiquetas de preço e alinhamento ao planograma.');
  }

  const penalty = Math.min(35, ruptures.length * 6 + recentOccurrences.length * 3);
  const planogramScore = Number(Math.max(50, 90 - penalty).toFixed(1));

  const suggestions = [
    'Realizar frenteamento puxando os produtos para a borda da prateleira',
    'Confirmar etiqueta de preço e aplicar faixa de gôndola oficial',
    'Validar estoque de retaguarda para itens com baixo giro/ruptura',
  ];
  const extraPointOpportunities = [
    `Avaliar ponto extra ou display próximo ao corredor principal (${storeLabel})`,
    'Verificar oportunidade de cross-merchandising no checkout para itens de impulso',
  ];

  const reasonNote = fallbackReason ? ` (${fallbackReason})` : '';
  const autoReport =
    `[Modo Heurístico — sem visão computacional ativa${reasonNote}] ` +
    `Resumo baseado no histórico de ${storeLabel}: ${recentOccurrences.length} ocorrência(s) em aberto. ` +
    `Use o editor visual abaixo para demarcar manualmente ou configure GROQ_API_KEY / GEMINI_API_KEY.`;

  return {
    detected_ruptures: ruptures,
    detected_brands: detectedBrands,
    exposure_issues: exposureIssues,
    planogram_score: planogramScore,
    suggestions,
    extra_point_opportunities: extraPointOpportunities,
    auto_report: autoReport,
    confidence: 0,
    annotations: [],
    self_verified: false,
    verification_notes: '',
    analysis_mode: 'heuristic_fallback',
    model_used: 'heuristic-history-v1',
  };
}

async function analyzeShelfImage({ storeId, imagePath, notes }) {
  const storesCol = await col('stores');
  const productsCol = await col('products');
  const brandsCol = await col('brands');
  const repCol = await col('replenishments');
  const occCol = await col('occurrences');
  const planCol = await col('planogram_audits');

  const sid = storeId ? Number(storeId) : null;
  const [store, products, brands, recentReplenishments, recentOccurrences, recentPlanograms] = await Promise.all([
    sid ? storesCol.findOne({ id: sid }) : Promise.resolve(null),
    productsCol.find({ active: 1 }, { projection: { _id: 0, id: 1, name: 1, brand_id: 1 } }).toArray(),
    brandsCol.find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray(),
    sid ? repCol.find({ store_id: sid }).sort({ id: -1 }).limit(10).toArray() : Promise.resolve([]),
    sid ? occCol.find({ store_id: sid, status: { $ne: 'Resolvida' } }).sort({ id: -1 }).limit(10).toArray() : Promise.resolve([]),
    sid ? planCol.find({ store_id: sid }).sort({ id: -1 }).limit(8).toArray() : Promise.resolve([]),
  ]);

  const brandMap = Object.fromEntries(brands.map((b) => [b.id, b]));
  const ownBrands = [...new Set(products.map((p) => brandMap[p.brand_id]?.name).filter(Boolean))];
  const storeLabel = store ? `${store.name} (${store.type})` : 'Loja selecionada';
  const openIssues = recentOccurrences.map((o) => `${o.type}: ${o.description}`);
  const planogramRef = recentPlanograms.map(
    (p) => `${p.category} (${brandMap[p.brand_id]?.name || 'Marca'}): ideal ${p.ideal_facings} frentes`
  );

  let fallbackReason = '';
  let isPanoramic = false;

  if (imagePath && fs.existsSync(imagePath)) {
    try {
      const rotatedBuf = await sharp(imagePath).rotate().toBuffer();
      const meta = await sharp(rotatedBuf).metadata();
      isPanoramic = detectPanoramic(meta.width, meta.height);
    } catch {
      isPanoramic = false;
    }

    const visionMaxDim = isPanoramic ? 2048 : 1536;
    const prompt = buildVisionPrompt({ storeLabel, ownBrands, planogramRef, notes, openIssues, isPanoramic });

    // 1. Prioridade: Groq Vision (plano gratuito, 2 passos de auto-verificação)
    if ((process.env.GROQ_API_KEY || '').trim()) {
      try {
        const res = await callGroqVisionJson({ imagePath, prompt, maxDim: visionMaxDim, maxTokens: isPanoramic ? 1500 : 1200 });
        if (res?.parsed) {
          const base = normalizeVisionPayload(res.parsed, `Análise visual${isPanoramic ? ' panorâmica' : ''} concluída para ${storeLabel}.`);
          const verified = await runSecondPassVerification({
            provider: 'groq_vision',
            imagePath,
            annotations: base.annotations,
            planogramScore: base.planogram_score,
            storeName: store?.name,
            isPanoramic,
          });
          return {
            ...base,
            annotations: verified.annotations,
            self_verified: verified.selfVerified,
            verification_notes: verified.verificationNotes,
            is_panoramic: isPanoramic,
            analysis_mode: 'groq_vision',
            model_used: res.model,
          };
        }
      } catch (err) {
        console.error('Groq Vision erro (tentando próximo provedor):', err.message);
        fallbackReason = 'falha temporária no Groq Vision';
      }
    }

    // 2. Fallback gratuito: Google Gemini Vision (2 passos de auto-verificação)
    if ((process.env.GEMINI_API_KEY || '').trim()) {
      try {
        const res = await callGeminiVisionJson({ imagePath, prompt, maxDim: visionMaxDim });
        if (res?.parsed) {
          const base = normalizeVisionPayload(res.parsed, `Análise visual${isPanoramic ? ' panorâmica' : ''} concluída para ${storeLabel}.`);
          const verified = await runSecondPassVerification({
            provider: 'gemini_vision',
            imagePath,
            annotations: base.annotations,
            planogramScore: base.planogram_score,
            storeName: store?.name,
            isPanoramic,
          });
          return {
            ...base,
            annotations: verified.annotations,
            self_verified: verified.selfVerified,
            verification_notes: verified.verificationNotes,
            is_panoramic: isPanoramic,
            analysis_mode: 'gemini_vision',
            model_used: res.model,
          };
        }
      } catch (err) {
        console.error('Gemini Vision erro (usando fallback heurístico):', err.message);
        fallbackReason = fallbackReason ? 'falha no Groq e Gemini Vision' : 'falha temporária no Gemini Vision';
      }
    }
  } else {
    fallbackReason = 'nenhuma imagem enviada';
  }

  return {
    ...buildHeuristicFallback({
      storeLabel,
      products,
      brandMap,
      recentReplenishments,
      recentOccurrences,
      notes,
      fallbackReason,
    }),
    is_panoramic: isPanoramic,
  };
}

async function generateStoreSummary(storeId) {
  const sid = Number(storeId);
  const store = await (await col('stores')).findOne({ id: sid });
  if (!store) return null;

  const [openOccurrences, priceIssues, expiryAlerts, audits] = await Promise.all([
    (await col('occurrences')).find({ store_id: sid, status: { $ne: 'Resolvida' } }).toArray(),
    (await col('price_checks')).countDocuments({ store_id: sid, $or: [{ has_price_tag: 0 }, { price_divergent: 1 }] }),
    (await col('expiry_checks')).countDocuments({
      store_id: sid,
      condition: { $in: ['Próximo Vencimento', 'Vencido', 'Avaria', 'Embalagem Danificada'] },
    }),
    (await col('planogram_audits')).find({ store_id: sid }).toArray(),
  ]);

  const avgShare = audits.length
    ? audits.reduce((acc, a) => acc + Number(a.share_of_shelf || 0), 0) / audits.length
    : 0;

  return {
    store_name: store.name,
    open_occurrences_count: openOccurrences.length,
    price_issues_count: priceIssues,
    expiry_alerts_count: expiryAlerts,
    avg_share_of_shelf: Number(avgShare.toFixed(1)),
    summary:
      `Resumo Inteligente — ${store.name}: ${openOccurrences.length} ocorrência(s) em aberto, ` +
      `${priceIssues} divergência(s)/falta de preço, ${expiryAlerts} alerta(s) de validade/qualidade e ` +
      `Share of Shelf médio de ${avgShare.toFixed(1)}%.`,
    top_problems: openOccurrences.slice(0, 5),
  };
}

module.exports = {
  analyzeShelfImage,
  generateStoreSummary,
  buildHeuristicFallback,
  normalizeVisionPayload,
  extractJsonObject,
};
