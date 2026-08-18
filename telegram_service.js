const fs = require('fs');
const path = require('path');

const TELEGRAM_API_URL = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;

function getTelegramConfig(customConfig = null) {
  const token = String(customConfig?.telegramBotToken || customConfig?.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(customConfig?.telegramChatId || customConfig?.chatId || process.env.TELEGRAM_CHAT_ID || '').trim();
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

async function testTelegramConnection(customConfig = null) {
  const config = getTelegramConfig(customConfig);
  if (!config) {
    throw new Error('Telegram Bot Token and Chat ID are not configured.');
  }

  const botInfo = await telegramRequest(config, 'getMe', { method: 'GET' });
  const testMessage = `✅ HostelFix Alert Connection Test\n\nBot: @${botInfo.username || 'HostelFixBot'}\nStatus: Active & Verified\nTime: ${new Date().toLocaleString('en-IN')}`;

  const message = await telegramRequest(config, 'sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: testMessage,
      disable_notification: false
    })
  });

  return {
    success: true,
    botUsername: botInfo.username || 'HostelFixBot',
    botName: botInfo.first_name || 'HostelFix Bot',
    messageId: message.message_id,
    message: 'Test message delivered to Telegram successfully.'
  };
}

function formatTelegramAnnouncement({ title, message, priority, audience, adminName, createdAt }) {
  const priorityText = String(priority || 'Normal').trim();
  const heading = priorityText === 'Emergency'
    ? 'YOU HAVE A NEW EMERGENCY LIVE ANNOUNCEMENT'
    : 'YOU HAVE A NEW LIVE ANNOUNCEMENT';

  return [
    heading,
    '',
    `Title: ${String(title || 'Untitled Announcement').trim()}`,
    `Message Type: Live Announcement`,
    `Priority: ${priorityText}`,
    `Audience: ${String(audience || 'All Students').trim()}`,
    `Posted By: ${String(adminName || 'Admin').trim()}`,
    `Time: ${new Date(createdAt || Date.now()).toLocaleString('en-IN')}`,
    '',
    'Message Details:',
    String(message || '').trim()
  ].join('\n');
}

async function sendTelegramMessage(text, customConfig = null) {
  const config = getTelegramConfig(customConfig);
  if (!config) throw new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env or Admin Settings.');

  const message = await telegramRequest(config, 'sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: String(text || '').trim(),
      disable_notification: false
    })
  });

  return {
    messageId: message.message_id,
    message: text
  };
}

async function sendTelegramAlert({ alertType, confidence, cameraName, location, imagePath, timestamp, customConfig = null }) {
  const config = getTelegramConfig(customConfig);
  if (!config) throw new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env or Admin Settings.');

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

function formatTelegramWardenApproval({ student, registrationNumber, gatePassId, certificateId, gateDate, returnDate, approvedBy }) {
  return [
    '🎫 GATE PASS APPROVED BY WARDEN',
    '',
    `Student: ${student || 'Student'}`,
    `Register: ${registrationNumber || 'N/A'}`,
    `Pass ID: ${gatePassId || 'N/A'}`,
    certificateId ? `Certificate: ${certificateId}` : '',
    `Approved By: ${approvedBy || 'Hostel Warden'}`,
    `Leave Date: ${gateDate || 'Today'}`,
    `Expected Return: ${returnDate || 'Same Day'}`,
    '',
    'Status: APPROVED (QR Code Generated)',
    'Next Step: Security Gate Exit Verification'
  ].filter(Boolean).join('\n');
}

const formatTelegramAdminApproval = formatTelegramWardenApproval;

function formatTelegramSecurityExit({ student, registrationNumber, exitTime, securityName }) {
  const formattedTime = exitTime ? new Date(exitTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return [
    '🚪 STUDENT EXIT VERIFIED',
    '',
    `Student:\n${student || 'Student'}`,
    '',
    `Register:\n${registrationNumber || 'N/A'}`,
    '',
    `Exit Time:\n${formattedTime}`,
    '',
    `Verified By:\n${securityName || 'Gate Security'}`,
    '',
    'Status:\nOUTSIDE (Gate Crossed)',
    'Next Step: Warden Return Arrival Verification'
  ].join('\n');
}

function formatTelegramSecurityRejection({ student, registrationNumber, securityName, reason }) {
  return [
    '❌ GATE PASS EXIT REJECTED',
    '',
    `Student:\n${student || 'Student'}`,
    '',
    `Register:\n${registrationNumber || 'N/A'}`,
    '',
    `Rejected By:\n${securityName || 'Gate Security'}`,
    '',
    `Reason:\n${reason || 'Unauthorized / Verification failed'}`,
    '',
    'Status:\nSECURITY_REJECTED'
  ].join('\n');
}

function formatTelegramWardenArrival({ student, registrationNumber, hostelArrivalTime, wardenName }) {
  const formattedTime = hostelArrivalTime ? new Date(hostelArrivalTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return [
    '🏨 STUDENT RETURN VERIFIED (COMPLETED)',
    '',
    `Student:\n${student || 'Student'}`,
    '',
    `Register:\n${registrationNumber || 'N/A'}`,
    '',
    `Arrival Time:\n${formattedTime}`,
    '',
    `Confirmed By:\n${wardenName || 'Hostel Warden'}`,
    '',
    'Status:\nCOMPLETED (Safely Returned)'
  ].join('\n');
}

function formatTelegramWardenRejection({ student, registrationNumber, exitTime, wardenName, reason }) {
  const formattedExit = exitTime ? new Date(exitTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'N/A';
  return [
    '⚠️ HOSTEL ARRIVAL NOT VERIFIED',
    '',
    `Student:\n${student || 'Student'}`,
    '',
    `Security Exit:\n${formattedExit}`,
    '',
    `Warden Status:\nREJECTED`,
    '',
    `Reason:\n${reason || 'Student did not arrive at hostel.'}`,
    '',
    'Status:\nOUTSIDE_NOT_RETURNED'
  ].join('\n');
}

module.exports = {
  getTelegramConfig,
  sendTelegramAlert,
  sendTelegramMessage,
  testTelegramConnection,
  formatTelegramAnnouncement,
  formatTelegramWardenApproval,
  formatTelegramAdminApproval,
  formatTelegramSecurityExit,
  formatTelegramSecurityRejection,
  formatTelegramWardenArrival,
  formatTelegramWardenRejection
};
