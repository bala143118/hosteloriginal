const fs = require('fs');
const path = require('path');

const TELEGRAM_API_URL = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;

function getTelegramConfig() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  return token && chatId ? { token, chatId } : null;
}

function formatTelegramAlert({ alertType, confidence, cameraName, location, timestamp }) {
  const icon = alertType === 'Fire' ? '🔥' : '💨';
  return `🚨 HOSTEL EMERGENCY ALERT 🚨\n\n${icon} ${alertType} Detected\n\n📍 Location:\n${location}\n\n📷 Camera:\n${cameraName}\n\n🎯 Confidence:\n${confidence}%\n\n🕒 Time:\n${timestamp}\n\n⚠ Please verify immediately.`;
}

async function telegramRequest(config, method, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${TELEGRAM_API_URL}/bot${config.token}/${method}`, {
      ...options,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.description || `Telegram request failed (${response.status}).`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTelegramAlert({ alertType, confidence, cameraName, location, imagePath, timestamp }) {
  const config = getTelegramConfig();
  if (!config) throw new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.');

  const messageText = formatTelegramAlert({ alertType, confidence, cameraName, location, timestamp });
  const message = await telegramRequest(config, 'sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.chatId, text: messageText, disable_notification: false })
  });

  if (imagePath && fs.existsSync(imagePath)) {
    try {
      const image = fs.readFileSync(imagePath);
      const form = new FormData();
      form.append('chat_id', config.chatId);
      form.append('caption', messageText);
      form.append('disable_notification', 'false');
      form.append('photo', new Blob([image], { type: 'image/jpeg' }), path.basename(imagePath));
      const photoMessage = await telegramRequest(config, 'sendPhoto', { method: 'POST', body: form });
      return {
        messageId: message.message_id,
        photoMessageId: photoMessage.message_id,
        message: messageText,
        delivery: 'text+photo'
      };
    } catch (error) {
      console.warn(`Telegram photo upload failed for ${path.basename(imagePath)}. Text alert was already delivered.`, error.message);
    }
  }

  return { messageId: message.message_id, message: messageText, delivery: 'text' };
}

module.exports = { getTelegramConfig, sendTelegramAlert };
