const fs = require('node:fs');
const path = require('node:path');

async function sendPhotoToTelegram({ filePath, reason, storeName, promoterName, details }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId || !filePath || !fs.existsSync(filePath)) {
    return { sent: false, reason: 'Telegram não configurado ou arquivo ausente' };
  }

  try {
    const buffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const blob = new Blob([buffer], { type: 'image/jpeg' });

    const lines = [
      '📸 MERCHANDISING PRO — Evidência Fotográfica',
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
    formData.append('photo', blob, filename);

    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Telegram API erro:', response.status, errText);
      return { sent: false, error: errText };
    }

    return { sent: true };
  } catch (err) {
    console.error('Erro ao enviar foto para o Telegram:', err.message);
    return { sent: false, error: err.message };
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

module.exports = { sendPhotoToTelegram, sendMessageToTelegram };
