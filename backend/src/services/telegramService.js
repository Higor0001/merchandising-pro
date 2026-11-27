const fs = require('node:fs');
const path = require('node:path');

function detectMimeType(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Envia evidência fotográfica ao Telegram.
 * Por padrão usa `sendDocument` (modo HD sem recomprimir no servidor do Telegram),
 * preservando a resolução HD completa da fotografia.
 * Caso deseje envio comprimido como foto comum, defina TELEGRAM_PHOTO_MODE=compressed.
 */
async function sendPhotoToTelegram({ filePath, reason, storeName, promoterName, details }) {
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

    const lines = [
      useCompressedPhoto
        ? '📸 MERCHANDISING PRO — Evidência Fotográfica'
        : '📸 MERCHANDISING PRO — Evidência Fotográfica (HD)',
      `📌 Motivo: ${reason || 'Registro no PDV'}`,
      storeName ? `🏪 Loja: ${storeName}` : null,
      promoterName ? `👤 Promotor: ${promoterName}` : null,
      details ? `📝 Descrição: ${details}` : null,
      `🕒 Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    ].filter(Boolean);

    const caption = lines.join('\n').slice(0, 1020);

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

module.exports = { sendPhotoToTelegram, sendMessageToTelegram, deleteTelegramMessage };
