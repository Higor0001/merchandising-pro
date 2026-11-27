const fs = require('node:fs');
const path = require('node:path');

function detectMimeType(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

const STAGE_LABELS = {
  SELFIE_ENTRADA: 'SELFIE NA ENTRADA',
  INICIAL: 'FOTO INICIAL (ANTES)',
  COMPLEMENTAR: 'FOTO COMPLEMENTAR',
  FINAL: 'FOTO FINAL (DEPOIS)',
  EXPOSICAO_ANTES: 'EXPOSIÇÃO — ANTES',
  EXPOSICAO_DEPOIS: 'EXPOSIÇÃO — DEPOIS',
  PRECIFICACAO: 'PRECIFICAÇÃO / ETIQUETA',
  OCORRENCIA: 'OCORRÊNCIA NO PDV',
  CAMPANHA: 'COMPROVAÇÃO DE CAMPANHA',
  IA_ORIGINAL: 'AUDITORIA IA — ORIGINAL',
  IA_DEMARCADA: 'AUDITORIA IA — DEMARCADA',
  VISITA: 'REGISTRO DE VISITA',
};

function formatTelegramTimestamp(dateInput) {
  const dt = dateInput ? new Date(dateInput) : new Date();
  const valid = Number.isNaN(dt.getTime()) ? new Date() : dt;
  return valid.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function buildTelegramPhotoCaption({
  reason,
  storeName,
  promoterName,
  details,
  stage,
  area,
  visitId,
  isPanoramic = false,
  mode = 'hd',
  capturedAt,
} = {}) {
  const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const stageKey = clean(stage).toUpperCase();
  const stageLabel = STAGE_LABELS[stageKey] || (stageKey ? stageKey : '');
  const cleanStore = clean(storeName);
  const cleanArea = clean(area);
  const cleanReason = clean(reason);
  const cleanPromoter = clean(promoterName);
  const cleanDetails = clean(details);
  const headerTag = mode === 'compressed' ? 'EVIDÊNCIA PDV' : 'EVIDÊNCIA HD';
  const divider = '━━━━━━━━━━━━━━━━━━━━';

  const lines = [
    `📸 MERCHANDISING PRO • ${headerTag}`,
    divider,
    `🏪 Loja: ${cleanStore || 'Não informada'}`,
    stageLabel ? `📍 Etapa: ${stageLabel}` : null,
    cleanArea
      ? `🗂️ Área: ${cleanArea}${isPanoramic ? ' [PANORÂMICA]' : ''}`
      : isPanoramic
        ? '🗂️ Formato: PANORÂMICA'
        : null,
    cleanReason ? `🎯 Registro: ${cleanReason}` : null,
    visitId ? `🧾 Visita: #${visitId}` : null,
    `👤 Promotor: ${cleanPromoter || 'Não informado'}`,
    `🕒 Data/Hora: ${formatTelegramTimestamp(capturedAt)}`,
  ].filter(Boolean);

  if (cleanDetails) {
    lines.push(divider);
    lines.push(`📝 Detalhes: ${cleanDetails}`);
  }

  const full = lines.join('\n');
  if (full.length <= 1020) return full;
  return `${full.slice(0, 1017)}...`;
}

/**
 * Envia evidência fotográfica ao Telegram.
 * Por padrão usa `sendDocument` (modo HD sem recomprimir no servidor do Telegram),
 * preservando a resolução HD completa da fotografia.
 * Caso deseje envio comprimido como foto comum, defina TELEGRAM_PHOTO_MODE=compressed.
 */
async function sendPhotoToTelegram({
  filePath,
  reason,
  storeName,
  promoterName,
  details,
  stage,
  area,
  visitId,
  isPanoramic = false,
  capturedAt,
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId || !filePath || !fs.existsSync(filePath)) {
    return { sent: false, reason: 'Telegram não configurado ou arquivo ausente' };
  }

  try {
    const buffer = await fs.promises.readFile(filePath);
    const filename = path.basename(filePath);
    const mimeType = detectMimeType(filePath);
    const blob = new Blob([buffer], { type: mimeType });

    const useCompressedPhoto = (process.env.TELEGRAM_PHOTO_MODE || 'hd').trim().toLowerCase() === 'compressed';
    const endpoint = useCompressedPhoto ? 'sendPhoto' : 'sendDocument';
    const fieldName = useCompressedPhoto ? 'photo' : 'document';

    const caption = buildTelegramPhotoCaption({
      reason,
      storeName,
      promoterName,
      details,
      stage,
      area,
      visitId,
      isPanoramic,
      mode: useCompressedPhoto ? 'compressed' : 'hd',
      capturedAt,
    });

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('caption', caption);
    formData.append(fieldName, blob, filename);

    const response = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Telegram ${endpoint} erro:`, response.status, errText);
      return { sent: false, error: errText };
    }

    const data = await response.json().catch(() => ({}));
    const messageId = data?.result?.message_id ?? null;

    return {
      sent: true,
      mode: useCompressedPhoto ? 'compressed' : 'hd',
      message_id: messageId,
      chat_id: chatId,
    };
  } catch (err) {
    console.error('Erro ao enviar foto para o Telegram:', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Apaga automaticamente uma mensagem/foto enviada anteriormente pelo bot no Telegram
 * (usado quando o promotor exclui ou substitui uma foto errada no PDV).
 */
async function deleteTelegramMessage({ messageId, chatId }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const targetChatId = chatId || process.env.TELEGRAM_CHAT_ID;

  if (!token || !targetChatId || !messageId) {
    return { deleted: false, reason: 'Telegram não configurado ou message_id ausente' };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        message_id: Number(messageId),
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn('Telegram deleteMessage aviso:', response.status, errText);
      return { deleted: false, error: errText };
    }

    const data = await response.json().catch(() => ({}));
    return { deleted: Boolean(data?.ok ?? true), message_id: Number(messageId) };
  } catch (err) {
    console.error('Erro ao apagar mensagem no Telegram:', err.message);
    return { deleted: false, error: err.message };
  }
}

async function sendMessageToTelegram({ text }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { sent: false, error: 'TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados.' };
  }
  if (!text || !text.trim()) {
    return { sent: false, error: 'Texto da mensagem está vazio.' };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4096),
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Telegram sendMessage erro:', response.status, errText);
      return { sent: false, error: errText };
    }
    return { sent: true };
  } catch (err) {
    console.error('Erro ao enviar texto para o Telegram:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = {
  buildTelegramPhotoCaption,
  sendPhotoToTelegram,
  sendMessageToTelegram,
  deleteTelegramMessage,
};
