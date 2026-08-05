const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const cors = require('cors');
const compression = require('compression');
const { spawn } = require('child_process');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
require('dotenv').config();
const { getTelegramConfig, sendTelegramAlert, sendTelegramMessage, formatTelegramAnnouncement } = require('./telegram_service');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'db.json');
const ALERT_IMAGES_DIR = path.join(DATA_DIR, 'alert-images');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAIN_HTML = path.join(__dirname, 'index.html');
const FACE_AUTH_DIR = path.join(__dirname, 'face_auth');
const FACE_AUTH_EMBEDDINGS_DIR = path.join(FACE_AUTH_DIR, 'face_auth', 'embeddings');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let cctvInferenceProcess = null;
let cctvInferenceBuffer = '';
const cctvInferenceRequests = [];
let faceAuthInferenceProcess = null;
let faceAuthInferenceBuffer = '';
const faceAuthInferenceRequests = [];
const ALERT_COOLDOWN_MS = 60 * 1000;
const FIRE_ALERT_MIN_CONFIDENCE = 40;
const SMOKE_ALERT_MIN_CONFIDENCE = 65;
const alertCooldowns = new Map();
const gatePassScanAttempts = new Map();
const GATEPASS_TOKEN_SECRET = process.env.GATEPASS_JWT_SECRET || 'hostelfix-local-gatepass-secret-change-in-production';
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(__dirname, { maxAge: 0, index: false }));
app.use('/public', express.static(PUBLIC_DIR, { maxAge: '7d' }));
app.use('/alert-images', express.static(ALERT_IMAGES_DIR, { maxAge: '7d' }));
app.use((req, res, next) => { req.io = io; next(); });

app.get(['/public', '/public/', '/public/index.html', '/public/*'], (req, res) => {
  res.redirect('/');
});

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_PATH)) {
    const initialData = {
      users: [
        {
          email: 'student@hostelfix.edu',
          password: 'student123',
          role: 'student',
          name: 'John Doe',
          registrationNumber: 'REG2024001',
          hostelBlock: 'Block A',
          roomNumber: 'A-204'
        },
        {
          email: 'tech@hostelfix.edu',
          password: 'tech123',
          role: 'technician',
          name: 'Mike Johnson'
        },
        {
          email: 'admin@hostelfix.edu',
          password: 'admin123',
          role: 'admin',
          name: 'Admin User'
        }
      ],
      complaints: [],
      gatePasses: [],
      announcements: [],
      personalNotifications: []
    };
    fs.writeFileSync(DATA_PATH, JSON.stringify(initialData, null, 2), 'utf8');
  }
}

function readData() {
  ensureDataStore();
  const raw = fs.readFileSync(DATA_PATH, 'utf8').replace(/^\uFEFF/, '');
  const data = JSON.parse(raw);

  if (ensureUserIds(data) || ensureAlertData(data) || ensureGatePassData(data)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  }

  return data;
}

function writeData(data) {
  ensureDataStore();
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function escapePdfText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapPdfText(text, width, fontSize) {
  const maxChars = Math.max(12, Math.floor(width / Math.max(fontSize * 0.52, 1)));
  const lines = [];
  String(text ?? '').split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (!line) {
      lines.push('');
      return;
    }
    let remaining = line;
    while (remaining.length > maxChars) {
      let splitAt = remaining.lastIndexOf(' ', maxChars);
      if (splitAt <= 0) splitAt = maxChars;
      lines.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    lines.push(remaining);
  });
  return lines;
}

function summarizeDetectionEntries(entries) {
  const filtered = entries.filter((entry) => {
    const predictions = Array.isArray(entry.predictions) ? entry.predictions : [];
    return predictions.length > 0 || /detected|alert|error|stopped/i.test(String(entry.summary || ''));
  });

  const deduped = [];
  let previousFingerprint = '';
  filtered.forEach((entry) => {
    const predictions = Array.isArray(entry.predictions) ? entry.predictions : [];
    const topPredictions = predictions
      .slice()
      .sort((first, second) => (Number(second.confidence) || 0) - (Number(first.confidence) || 0))
      .slice(0, 3)
      .map((prediction) => `${prediction.label}:${Math.round((Number(prediction.confidence) || 0) * 100)}`)
      .join('|');
    const fingerprint = `${entry.summary}|${entry.personCount}|${topPredictions}`;
    if (fingerprint !== previousFingerprint) {
      deduped.push(entry);
      previousFingerprint = fingerprint;
    }
  });

  return deduped.slice(-80);
}

function buildStyledPdfReport(report) {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 42;
  const pages = [];
  let commands = [];
  let y = 0;

  const newPage = () => {
    if (commands.length) pages.push(commands.join('\n'));
    commands = [];
    y = margin;
  };

  const ensureSpace = (heightNeeded) => {
    if (!commands.length) newPage();
    if (y + heightNeeded > pageHeight - margin) newPage();
  };

  const rgb = (color) => color.map((value) => (value / 255).toFixed(3)).join(' ');
  const drawRect = (x, top, width, height, fillColor, strokeColor = null, lineWidth = 1) => {
    const bottom = pageHeight - top - height;
    if (fillColor) commands.push(`${rgb(fillColor)} rg`);
    if (strokeColor) commands.push(`${rgb(strokeColor)} RG`);
    if (strokeColor) commands.push(`${lineWidth} w`);
    commands.push(`${x} ${bottom} ${width} ${height} re ${fillColor && strokeColor ? 'B' : fillColor ? 'f' : 'S'}`);
  };
  const drawText = (text, x, top, options = {}) => {
    const {
      font = 'F1',
      size = 12,
      color = [15, 23, 42]
    } = options;
    const baseline = pageHeight - top - size;
    commands.push('BT');
    commands.push(`/${font} ${size} Tf`);
    commands.push(`${rgb(color)} rg`);
    commands.push(`1 0 0 1 ${x} ${baseline} Tm`);
    commands.push(`(${escapePdfText(text)}) Tj`);
    commands.push('ET');
  };
  const drawWrappedTextBlock = (text, x, top, width, options = {}) => {
    const {
      font = 'F1',
      size = 12,
      color = [15, 23, 42],
      lineHeight = size + 4
    } = options;
    const lines = wrapPdfText(text, width, size);
    lines.forEach((line, index) => {
      drawText(line, x, top + (index * lineHeight), { font, size, color });
    });
    return lines.length * lineHeight;
  };

  newPage();
  drawRect(0, 0, pageWidth, 108, [15, 23, 42]);
  drawText(report.title, margin, 28, { font: 'F2', size: 24, color: [255, 255, 255] });
  drawText('Fire, smoke, crowd, and alert activity summary', margin, 62, { size: 11, color: [191, 219, 254] });
  y = 128;

  const cardWidth = (pageWidth - (margin * 2) - 18) / 2;
  const summaryCards = [
    { title: 'Generated', value: report.generatedAt },
    { title: 'Session Started', value: report.sessionStartedAt },
    { title: 'Current Status', value: report.currentStatus },
    { title: 'Current Confidence', value: report.currentConfidence },
    { title: 'Current Speed', value: report.currentSpeed },
    { title: 'Current Crowd', value: report.currentCrowdCount }
  ];
  summaryCards.forEach((card, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const top = y + (row * 82);
    const x = margin + (column * (cardWidth + 18));
    drawRect(x, top, cardWidth, 64, [248, 250, 252], [203, 213, 225], 0.8);
    drawText(card.title, x + 16, top + 14, { font: 'F2', size: 11, color: [71, 85, 105] });
    drawWrappedTextBlock(card.value || 'N/A', x + 16, top + 32, cardWidth - 32, { font: 'F2', size: 14, color: [15, 23, 42], lineHeight: 16 });
  });
  y += 266;

  const chips = report.metrics;
  const chipWidth = (pageWidth - (margin * 2) - 24) / 4;
  chips.forEach((chip, index) => {
    const x = margin + (index * (chipWidth + 8));
    drawRect(x, y, chipWidth, 68, chip.color, null);
    drawText(chip.title, x + 14, y + 15, { font: 'F2', size: 10, color: [255, 255, 255] });
    drawText(String(chip.value), x + 14, y + 34, { font: 'F2', size: 19, color: [255, 255, 255] });
  });
  y += 96;

  drawText('Key Detection Events', margin, y, { font: 'F2', size: 18, color: [15, 23, 42] });
  y += 28;

  report.events.forEach((entry, index) => {
    const predictions = Array.isArray(entry.predictions) ? entry.predictions : [];
    const topDetections = predictions.length
      ? predictions
        .slice()
        .sort((first, second) => (Number(second.confidence) || 0) - (Number(first.confidence) || 0))
        .slice(0, 4)
        .map((prediction) => `${prediction.label} ${Math.round((Number(prediction.confidence) || 0) * 100)}%`)
        .join('  |  ')
      : 'No fire or smoke detections recorded.';
    const crowdLine = entry.personCount > 0 ? `${entry.personCount} people detected` : 'No crowd';
    const metaLines = [
      `Time: ${entry.timestamp || 'N/A'}`,
      `Source: ${entry.sourceLabel || 'N/A'}`,
      `Confidence: ${entry.confidenceText || 'N/A'}   Speed: ${entry.speedText || 'N/A'}   Crowd: ${crowdLine}`
    ];
    const statusLines = wrapPdfText(String(entry.summary || 'N/A'), pageWidth - (margin * 2) - 32, 12);
    const detectionLines = wrapPdfText(`Detections: ${topDetections}`, pageWidth - (margin * 2) - 32, 11);
    const cardHeight = 74 + (statusLines.length * 16) + (detectionLines.length * 14);
    ensureSpace(cardHeight + 14);

    const cardTop = y;
    drawRect(margin, cardTop, pageWidth - (margin * 2), cardHeight, [255, 255, 255], [203, 213, 225], 0.8);
    drawText(`Event ${index + 1}`, margin + 16, cardTop + 14, { font: 'F2', size: 12, color: [37, 99, 235] });
    metaLines.forEach((line, metaIndex) => {
      drawText(line, margin + 16, cardTop + 34 + (metaIndex * 14), { size: 10, color: [71, 85, 105] });
    });
    drawWrappedTextBlock(String(entry.summary || 'N/A'), margin + 16, cardTop + 80, pageWidth - (margin * 2) - 32, { font: 'F2', size: 12, color: [15, 23, 42], lineHeight: 16 });
    drawWrappedTextBlock(`Detections: ${topDetections}`, margin + 16, cardTop + 102 + (statusLines.length * 16), pageWidth - (margin * 2) - 32, { size: 11, color: [51, 65, 85], lineHeight: 14 });
    y += cardHeight + 14;
  });

  pages.push(commands.join('\n'));

  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };
  const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageObjectIds = [];

  pages.forEach((streamContent, pageIndex) => {
    const footer = [
      'BT',
      `/F1 10 Tf`,
      `${rgb([100, 116, 139])} rg`,
      `1 0 0 1 ${pageWidth - margin - 56} ${24} Tm`,
      `(Page ${pageIndex + 1} of ${pages.length}) Tj`,
      'ET'
    ].join('\n');
    const stream = `${streamContent}\n${footer}`;
    const contentObjectId = addObject(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
    const pageObjectId = addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjectId} 0 R /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`);
    pageObjectIds.push(pageObjectId);
  });

  const pagesObjectId = addObject(`<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  pageObjectIds.forEach((pageObjectId) => {
    objects[pageObjectId - 1] = objects[pageObjectId - 1].replace('/Parent 0 0 R', `/Parent ${pagesObjectId} 0 R`);
  });
  const catalogObjectId = addObject(`<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function createCCTVLogPdfBuffer(payload) {
  const rawEntries = Array.isArray(payload.entries) ? payload.entries : [];
  const events = summarizeDetectionEntries(rawEntries);
  const fireEvents = events.filter((entry) => Array.isArray(entry.predictions) && entry.predictions.some((prediction) => /fire/i.test(String(prediction.label || '')))).length;
  const smokeEvents = events.filter((entry) => Array.isArray(entry.predictions) && entry.predictions.some((prediction) => /smoke/i.test(String(prediction.label || '')))).length;
  const alertEvents = events.filter((entry) => /detected|alert/i.test(String(entry.summary || ''))).length;

  return buildStyledPdfReport({
    title: payload.title || 'Hostel CCTV Detection Report',
    generatedAt: payload.generatedAt || new Date().toISOString(),
    sessionStartedAt: payload.sessionStartedAt || 'N/A',
    currentStatus: payload.currentStatus || 'N/A',
    currentConfidence: payload.currentConfidence || 'N/A',
    currentSpeed: payload.currentSpeed || 'N/A',
    currentCrowdCount: payload.currentCrowdCount || 'No crowd',
    metrics: [
      { title: 'Meaningful Events', value: events.length, color: [37, 99, 235] },
      { title: 'Alert States', value: alertEvents, color: [220, 38, 38] },
      { title: 'Fire Labels', value: fireEvents, color: [234, 88, 12] },
      { title: 'Smoke Labels', value: smokeEvents, color: [71, 85, 105] }
    ],
    events
  });
}

function createGatePassPdfBuffer(payload) {
  const gatePasses = Array.isArray(payload.gatePasses) ? payload.gatePasses : [];
  const generatedAt = payload.generatedAt || new Date().toISOString();
  const title = payload.title || 'Gate Pass Requests Report';
  const subtitle = payload.subtitle || 'Student gate pass request summary';
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 32;
  const pages = [];
  let commands = [];
  let y = 0;

  const newPage = () => {
    if (commands.length) pages.push(commands.join('\n'));
    commands = [];
    y = margin;
  };

  const ensureSpace = (heightNeeded) => {
    if (!commands.length) newPage();
    if (y + heightNeeded > pageHeight - margin - 34) newPage();
  };

  const rgb = (color) => color.map((value) => (value / 255).toFixed(3)).join(' ');
  const drawRect = (x, top, width, height, fillColor, strokeColor = null, lineWidth = 1) => {
    const bottom = pageHeight - top - height;
    if (fillColor) commands.push(`${rgb(fillColor)} rg`);
    if (strokeColor) commands.push(`${rgb(strokeColor)} RG`);
    if (strokeColor) commands.push(`${lineWidth} w`);
    commands.push(`${x} ${bottom} ${width} ${height} re ${fillColor && strokeColor ? 'B' : fillColor ? 'f' : 'S'}`);
  };
  const drawText = (text, x, top, options = {}) => {
    const {
      font = 'F1',
      size = 12,
      color = [15, 23, 42]
    } = options;
    const baseline = pageHeight - top - size;
    commands.push('BT');
    commands.push(`/${font} ${size} Tf`);
    commands.push(`${rgb(color)} rg`);
    commands.push(`1 0 0 1 ${x} ${baseline} Tm`);
    commands.push(`(${escapePdfText(text)}) Tj`);
    commands.push('ET');
  };
  const drawWrappedText = (text, x, top, width, options = {}) => {
    const {
      font = 'F1',
      size = 11,
      color = [15, 23, 42],
      lineHeight = size + 3
    } = options;
    const lines = wrapPdfText(text, width, size);
    lines.forEach((line, index) => {
      drawText(line, x, top + (index * lineHeight), { font, size, color });
    });
    return lines.length * lineHeight;
  };

  const columns = [
    { key: 'id', title: 'ID', width: 112 },
    { key: 'student', title: 'STUDENT', width: 88 },
    { key: 'registrationNumber', title: 'REG. NO', width: 82 },
    { key: 'reason', title: 'REASON', width: 140 },
    { key: 'session', title: 'SESSION', width: 76 },
    { key: 'gateDate', title: 'OUT DATE', width: 76 },
    { key: 'returnDate', title: 'RETURN', width: 76 },
    { key: 'status', title: 'STATUS', width: 70 }
  ];

  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const getStatusColor = (status) => {
    const lower = String(status || '').toLowerCase();
    if (lower.includes('approved')) return [22, 163, 74];
    if (lower.includes('rejected')) return [220, 38, 38];
    return [202, 138, 4];
  };

  newPage();
  drawRect(0, 0, pageWidth, 86, [37, 99, 235]);
  drawText(title, margin, 24, { font: 'F2', size: 24, color: [255, 255, 255] });
  drawText(subtitle, margin, 54, { size: 11, color: [219, 234, 254] });
  drawText(`Generated: ${new Date(generatedAt).toLocaleString('en-IN')}`, pageWidth - 220, 30, { size: 10, color: [219, 234, 254] });
  y = 104;

  drawRect(margin, y, pageWidth - (margin * 2), 46, [248, 250, 252], [203, 213, 225], 0.8);
  let x = margin + 10;
  columns.forEach((column) => {
    drawText(column.title, x, y + 15, { font: 'F2', size: 9, color: [71, 85, 105] });
    x += column.width;
  });
  y += 58;

  gatePasses.forEach((entry, index) => {
    const rowValues = {
      id: entry.id || 'N/A',
      student: entry.student || 'Anonymous',
      registrationNumber: entry.registrationNumber || 'N/A',
      reason: entry.reason || 'General',
      session: entry.session || 'Morning',
      gateDate: formatDate(entry.gateDate),
      returnDate: formatDate(entry.returnDate),
      status: entry.status || 'Pending'
    };

    const rowHeights = columns.map((column) => wrapPdfText(String(rowValues[column.key]), column.width - 10, 10).length);
    const rowHeight = Math.max(30, (Math.max(...rowHeights) * 14) + 16);
    ensureSpace(rowHeight + 8);

    const fillColor = index % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
    drawRect(margin, y, pageWidth - (margin * 2), rowHeight, fillColor, [226, 232, 240], 0.6);

    x = margin + 10;
    columns.forEach((column) => {
      const value = String(rowValues[column.key]);
      const color = column.key === 'status' ? getStatusColor(value) : [15, 23, 42];
      drawWrappedText(value, x, y + 12, column.width - 10, {
        size: 10,
        color,
        font: column.key === 'status' ? 'F2' : 'F1',
        lineHeight: 14
      });
      x += column.width;
    });

    y += rowHeight;
  });

  if (!gatePasses.length) {
    drawRect(margin, y, pageWidth - (margin * 2), 64, [255, 255, 255], [203, 213, 225], 0.8);
    drawText('No gate pass records available for this export.', margin + 20, y + 24, { size: 12, color: [100, 116, 139] });
    y += 76;
  }

  pages.push(commands.join('\n'));

  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };
  const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageObjectIds = [];

  pages.forEach((streamContent, pageIndex) => {
    const footer = [
      'BT',
      '/F1 10 Tf',
      `${rgb([100, 116, 139])} rg`,
      `1 0 0 1 ${pageWidth - margin - 78} 18 Tm`,
      `(Page ${pageIndex + 1} of ${pages.length}) Tj`,
      'ET'
    ].join('\n');
    const stream = `${streamContent}\n${footer}`;
    const contentObjectId = addObject(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
    const pageObjectId = addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjectId} 0 R /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`);
    pageObjectIds.push(pageObjectId);
  });

  const pagesObjectId = addObject(`<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  pageObjectIds.forEach((pageObjectId) => {
    objects[pageObjectId - 1] = objects[pageObjectId - 1].replace('/Parent 0 0 R', `/Parent ${pagesObjectId} 0 R`);
  });
  const catalogObjectId = addObject(`<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function createSingleGatePassPdfBuffer(gatePass) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 28 });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const status = String(gatePass.status || 'Pending');
    const statusLower = status.toLowerCase();
    const statusColor = (statusLower.includes('approved') || statusLower.includes('generated'))
      ? '#15803d'
      : statusLower.includes('rejected')
        ? '#dc2626'
        : '#ca8a04';

    const formatDate = (value) => {
      if (!value) return 'N/A';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      });
    };

    const imageMatch = String(gatePass.studentPhoto || '').match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i);
    const imageBuffer = imageMatch ? Buffer.from(imageMatch[2], 'base64') : null;
    const qrMatch = String(gatePass.qrImage || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/i);
    const qrBuffer = qrMatch ? Buffer.from(qrMatch[1], 'base64') : null;

    doc.rect(0, 0, doc.page.width, 74).fill('#2563eb');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('HOSTEL GATE PASS', 28, 18);
    doc.fillColor('#dbeafe').font('Helvetica').fontSize(10).text('Submitted request details', 28, 44);

    doc.roundedRect(28, 92, 539, 54, 10).fillAndStroke('#f8fafc', '#cbd5e1');
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(8).text('Gate Pass ID', 40, 105);
    doc.fillColor('#0f172a').fontSize(12).text(gatePass.id || 'N/A', 40, 118, { width: 300 });
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(8).text('Status', 430, 105);
    doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(12).text(status, 430, 118);
    doc.fillColor('#64748b').font('Helvetica').fontSize(8).text(`Submitted on ${new Date(gatePass.createdAt || Date.now()).toLocaleString('en-IN')}`, 40, 133);

    const fields = [
      ['Student Name', gatePass.student || 'N/A'],
      ['Register Number', gatePass.registrationNumber || 'N/A'],
      ['Hostel Block', gatePass.hostelBlock || 'N/A'],
      ['Room Number', gatePass.roomNumber || 'N/A'],
      ['Gate Pass Date', formatDate(gatePass.gateDate)],
      ['Return Date', formatDate(gatePass.returnDate)],
      ['Session', gatePass.session || 'N/A'],
      ['Approved By', gatePass.approvedBy || 'Pending']
    ];

    const cardWidth = 254;
    const cardHeight = 48;
    const startY = 164;
    fields.forEach((field, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = 28 + (col * 285);
      const y = startY + (row * 58);
      doc.roundedRect(x, y, cardWidth, cardHeight, 9).fillAndStroke('#ffffff', '#d9e5fb');
      doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(8).text(field[0], x + 10, y + 8, { width: cardWidth - 20 });
      doc.fillColor('#14213d').font('Helvetica-Bold').fontSize(10).text(String(field[1]), x + 10, y + 22, { width: cardWidth - 20 });
    });

    doc.roundedRect(28, 404, 312, 82, 9).fillAndStroke('#ffffff', '#d9e5fb');
    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(8).text('Reason for Gate Pass', 40, 416);
    doc.fillColor('#14213d').font('Helvetica').fontSize(10).text(String(gatePass.reason || 'N/A'), 40, 431, {
      width: 288,
      lineGap: 1
    });

    doc.roundedRect(360, 404, 207, 82, 9).fillAndStroke('#ffffff', '#d9e5fb');
    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(8).text('Student Photo', 372, 416);
    if (imageBuffer) {
      try {
        doc.image(imageBuffer, 396, 430, { fit: [132, 44], align: 'center', valign: 'center' });
      } catch (error) {
        doc.fillColor('#94a3b8').font('Helvetica').fontSize(9).text('Unable to render photo', 394, 448, { width: 136, align: 'center' });
      }
    } else {
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(9).text('No photo uploaded', 394, 448, { width: 136, align: 'center' });
    }

    if (qrBuffer) {
      doc.roundedRect(28, 500, 539, 148, 9).fillAndStroke('#ffffff', '#d9e5fb');
      doc.fillColor('#475569').font('Helvetica-Bold').fontSize(10).text('Secure Gate Pass QR Code', 44, 516);
      doc.fillColor('#64748b').font('Helvetica').fontSize(8).text('Show this code to security at exit and return. It is valid until the return date.', 44, 535, { width: 310 });
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9).text(`Gate Pass: ${gatePass.id}`, 44, 575);
      try { doc.image(qrBuffer, 422, 514, { fit: [120, 120] }); } catch (error) { doc.fillColor('#94a3b8').font('Helvetica').fontSize(9).text('Unable to render QR', 420, 570, { width: 124, align: 'center' }); }
      doc.roundedRect(28, 666, 539, 28, 9).fillAndStroke('#f8fafc', '#d9e5fb');
      doc.fillColor('#64748b').font('Helvetica').fontSize(8).text('Downloaded from HostelFix', 40, 676);
      doc.fillColor(statusColor).font('Helvetica-Bold').text(`Status: ${status}`, 455, 676, { width: 92, align: 'right' });
    } else {
      doc.roundedRect(28, 500, 539, 28, 9).fillAndStroke('#f8fafc', '#d9e5fb');
      doc.fillColor('#64748b').font('Helvetica').fontSize(8).text('QR code will be generated after approval.', 40, 510);
      doc.fillColor(statusColor).font('Helvetica-Bold').text(`Status: ${status}`, 455, 510, { width: 92, align: 'right' });
    }

    doc.end();
  });
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function normalizeImageDataUrl(value) {
  const trimmed = String(value || '').trim();
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(trimmed) ? trimmed : '';
}

function generateUserId(users) {
  let userId;
  do {
    const timestamp = Date.now().toString(36).toUpperCase();
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    userId = `USR-${timestamp}-${randomPart}`;
  } while (users.some((user) => normalizeEmail(user.userId) === normalizeEmail(userId)));

  return userId;
}

function ensureUserIds(data) {
  let changed = false;

  data.users.forEach((user) => {
    if (!user.userId) {
      user.userId = generateUserId(data.users);
      changed = true;
    }

    if (user.loginId) {
      delete user.loginId;
      changed = true;
    }
  });

  return changed;
}

function ensureAlertData(data) {
  let changed = false;
  if (!data.adminSettings || typeof data.adminSettings !== 'object') {
    data.adminSettings = {
      alertCameraName: 'Hostel CCTV Camera 3',
      alertCameraLocation: 'Block A - Ground Floor',
      alertMinConfidence: 50
    };
    changed = true;
  }
  if (!data.adminSettings.alertCameraLocation) {
    data.adminSettings.alertCameraLocation = 'Block A - Ground Floor';
    changed = true;
  }
  if (Number(data.adminSettings.alertMinConfidence) === 70 || Number(data.adminSettings.alertMinConfidence) === 60) {
    data.adminSettings.alertMinConfidence = 50;
    changed = true;
  }
  if (!Number.isFinite(Number(data.adminSettings.alertMinConfidence))) {
    data.adminSettings.alertMinConfidence = 50;
    changed = true;
  }
  if (!Array.isArray(data.alertHistory)) {
    data.alertHistory = [];
    changed = true;
  }
  if (!Array.isArray(data.personalNotifications)) {
    data.personalNotifications = [];
    changed = true;
  }
  return changed;
}

function generatePersonalNotificationId() {
  return `NTF-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function normalizeComparableValue(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesStudentNotification(notification, identifiers = {}) {
  if (!notification || typeof notification !== 'object') return false;
  const email = normalizeComparableValue(identifiers.email);
  const name = normalizeComparableValue(identifiers.name);
  const registrationNumber = normalizeComparableValue(identifiers.registrationNumber);
  const userId = normalizeComparableValue(identifiers.userId);

  return (
    (email && normalizeComparableValue(notification.targetEmail) === email)
    || (name && normalizeComparableValue(notification.targetName) === name)
    || (registrationNumber && normalizeComparableValue(notification.targetRegistrationNumber) === registrationNumber)
    || (userId && normalizeComparableValue(notification.targetUserId) === userId)
  );
}

function saveAlertSnapshot(imageDataUrl, alertId) {
  if (!imageDataUrl) return { publicPath: null, diskPath: null };
  const match = String(imageDataUrl).match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Alert screenshot must be a JPEG or PNG image.');
  const image = Buffer.from(match[2], 'base64');
  if (!image.length || image.length > 5 * 1024 * 1024) throw new Error('Alert screenshot must be smaller than 5 MB.');
  fs.mkdirSync(ALERT_IMAGES_DIR, { recursive: true });
  const extension = match[1] === 'png' ? 'png' : 'jpg';
  const filename = `${alertId}.${extension}`;
  const diskPath = path.join(ALERT_IMAGES_DIR, filename);
  fs.writeFileSync(diskPath, image);
  return { publicPath: `/alert-images/${filename}`, diskPath };
}

function generateComplaintId() {
  return `CMP-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
}

function generateGatePassId() {
  return `GP-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
}

function ensureGatePassData(data) {
  let changed = false;
  if (!Array.isArray(data.gatePasses)) { data.gatePasses = []; changed = true; }
  if (!Array.isArray(data.gatePassScanLogs)) { data.gatePassScanLogs = []; changed = true; }
  if (!Array.isArray(data.auditLogs)) { data.auditLogs = []; changed = true; }
  return changed;
}

function addGatePassAudit(data, gatePass, action, actor = {}, remarks = '') {
  data.auditLogs.unshift({
    id: `AUD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    gatePassId: gatePass.id,
    user: actor.name || actor.id || 'System',
    role: actor.role || 'system',
    action,
    remarks,
    ipAddress: actor.ip || '',
    timestamp: new Date().toISOString()
  });
}

function createGatePassNotification(data, gatePass, type, title, message, role = 'Student') {
  data.personalNotifications = Array.isArray(data.personalNotifications) ? data.personalNotifications : [];
  const notification = {
    id: generatePersonalNotificationId(), type, title, message, priority: 'Important', audience: role,
    adminName: 'Gate Pass System', createdAt: new Date().toISOString(),
    targetEmail: role === 'Student' ? gatePass.email || '' : '', targetName: role === 'Student' ? gatePass.student || '' : '',
    targetRegistrationNumber: role === 'Student' ? gatePass.registrationNumber || '' : '', targetUserId: role === 'Student' ? gatePass.userId || '' : '',
    relatedGatePassId: gatePass.id, receiverRole: role
  };
  data.personalNotifications.unshift(notification);
  return notification;
}

function gatePassExpiry(returnDate) {
  const expiry = new Date(`${returnDate}T23:59:59.999`);
  return Number.isNaN(expiry.getTime()) ? new Date(Date.now() + 24 * 60 * 60 * 1000) : expiry;
}

async function provisionGatePassQr(gatePass, req) {
  const expiresAt = gatePassExpiry(gatePass.returnDate);
  const token = jwt.sign({ gp: gatePass.id, jti: crypto.randomUUID(), scope: 'gatepass-scan' }, GATEPASS_TOKEN_SECRET, { expiresIn: Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) });
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const secureUrl = `${baseUrl}/qr/${encodeURIComponent(token)}`;
  gatePass.token = token;
  gatePass.secureUrl = secureUrl;
  gatePass.qrUrl = secureUrl;
  gatePass.qrImage = await QRCode.toDataURL(secureUrl, { errorCorrectionLevel: 'H', margin: 2, width: 420, color: { dark: '#0f172a', light: '#ffffff' } });
  gatePass.qrGeneratedAt = new Date().toISOString();
  gatePass.expiryDate = expiresAt.toISOString();
}

async function backfillApprovedGatePassQrs(data, req) {
  const missingQrPasses = (data.gatePasses || []).filter((gatePass) => (
    /^(approved|qr generated)$/i.test(String(gatePass.status || '')) && !gatePass.qrImage
  ));
  if (!missingQrPasses.length) return false;
  for (const gatePass of missingQrPasses) {
    await provisionGatePassQr(gatePass, req);
    gatePass.status = 'QR GENERATED';
    gatePass.workflowStatus = 'QR GENERATED';
    addGatePassAudit(data, gatePass, 'QR Generated for Existing Approved Pass', { role: 'system', ip: req.ip });
  }
  return true;
}

function validateGatePassToken(token, data) {
  let payload;
  try { payload = jwt.verify(token, GATEPASS_TOKEN_SECRET); } catch (error) { return { error: error.name === 'TokenExpiredError' ? 'This QR code has expired.' : 'Invalid or modified QR code.' }; }
  if (!payload || payload.scope !== 'gatepass-scan' || !payload.gp) return { error: 'Invalid QR code.' };
  const gatePass = data.gatePasses.find((item) => item.id === payload.gp && item.token === token);
  if (!gatePass) return { error: 'This QR code is no longer valid.' };
  if (gatePass.status === 'COMPLETED') return { error: 'Gate Pass Already Completed.', gatePass };
  if (gatePass.status === 'REJECTED' || gatePass.status === 'CANCELLED') return { error: 'This gate pass is not active.' };
  if (!gatePass.expiryDate || new Date(gatePass.expiryDate) < new Date()) return { error: 'This QR code has expired.' };
  return { gatePass };
}

function generateLaundryRequestId() {
  return `LR-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
}

function generateAnnouncementId() {
  return `ANN-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
}

function findUser(identifier) {
  const data = readData();
  const normalizedIdentifier = normalizeEmail(identifier);
  return data.users.find((user) => (
    normalizeEmail(user.email) === normalizedIdentifier
    || normalizeEmail(user.userId) === normalizedIdentifier
  ));
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

app.get('/api/users', (req, res) => {
  const data = readData();
  res.json(data.users.map(sanitizeUser));
});

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6;
}

app.post('/api/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const role = String(req.body.role || '').trim().toLowerCase();
  const validRoles = ['student', 'technician', 'admin'];

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password, and role are required.' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please use a valid email address.' });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Please select a valid role.' });
  }

  const existingUser = findUser(email);
  if (existingUser) {
    return res.status(409).json({ error: 'This email is already registered. Please login instead.' });
  }

  const data = readData();
  const newUser = {
    userId: generateUserId(data.users),
    email,
    password,
    role,
    name
  };

  data.users.push(newUser);
  writeData(data);

  return res.status(201).json(sanitizeUser(newUser));
});

app.post('/api/login', (req, res) => {
  const identifier = normalizeEmail(req.body.email);
  const password = req.body.password || '';
  const role = (req.body.role || '').trim().toLowerCase();
  const validRoles = ['student', 'technician', 'admin'];

  console.info(`[LOGIN] attempt for=${identifier || '<missing>'} role=${role || '<missing>'}`);

  if (!identifier || !password || !validRoles.includes(role)) {
    return res.status(400).json({ error: 'User ID or email, password, and valid role are required.' });
  }

  const user = findUser(identifier);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid user ID, email, or password.' });
  }

  if (user.role !== role) {
    return res.status(403).json({ error: `Account does not have the role '${role}'.` });
  }

  return res.json(sanitizeUser(user));
});

app.get('/api/complaints', (req, res) => {
  const data = readData();
  res.json(data.complaints);
});

app.get('/api/announcements', (req, res) => {
  const data = readData();
  const announcements = Array.isArray(data.announcements) ? data.announcements : [];
  res.json(announcements.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/student-notifications', (req, res) => {
  const data = readData();
  const identifiers = {
    email: normalizeEmail(req.query.email),
    name: req.query.name,
    registrationNumber: req.query.registrationNumber,
    userId: req.query.userId
  };

  const hasIdentifier = Object.values(identifiers).some((value) => String(value || '').trim());
  if (!hasIdentifier) {
    return res.status(400).json({ error: 'A student identifier is required.' });
  }

  const notifications = (Array.isArray(data.personalNotifications) ? data.personalNotifications : [])
    .filter((notification) => matchesStudentNotification(notification, identifiers))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return res.json(notifications);
});

app.post('/api/announcements', async (req, res) => {
  const data = readData();
  const { title, message, priority, audience, adminName } = req.body;

  if (!title || !message || !audience || !adminName) {
    return res.status(400).json({ error: 'Title, message, audience, and admin name are required.' });
  }

  const announcement = {
    id: generateAnnouncementId(),
    title: String(title).trim(),
    message: String(message).trim(),
    priority: ['Normal', 'Important', 'Emergency'].includes(priority) ? priority : 'Normal',
    audience: String(audience).trim(),
    adminName: String(adminName).trim(),
    createdAt: new Date().toISOString()
  };

  data.announcements = Array.isArray(data.announcements) ? data.announcements : [];
  data.announcements.unshift(announcement);
  writeData(data);

  let telegramDelivered = false;
  const telegramConfigured = Boolean(getTelegramConfig());
  if (getTelegramConfig()) {
    try {
      const telegramMessage = formatTelegramAnnouncement(announcement);
      await sendTelegramMessage(telegramMessage);
      telegramDelivered = true;
    } catch (error) {
      console.warn('Telegram live announcement delivery failed:', error.message);
    }
  }

  if (req.io) {
    req.io.emit('announcement.created', announcement);
  }

  res.status(201).json({
    ...announcement,
    telegramConfigured,
    telegramDelivered
  });
});

app.delete('/api/announcements/:id', (req, res) => {
  const data = readData();
  data.announcements = Array.isArray(data.announcements) ? data.announcements : [];
  const index = data.announcements.findIndex((item) => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Announcement not found.' });
  }

  data.announcements.splice(index, 1);
  writeData(data);
  res.json({ success: true });
});

app.get('/api/gate-passes', async (req, res) => {
  const data = readData();
  if (await backfillApprovedGatePassQrs(data, req)) writeData(data);
  res.json(data.gatePasses || []);
});

app.post('/api/gate-passes', (req, res) => {
  const data = readData();
  const gateDate = req.body.gateDate || new Date().toISOString().split('T')[0];
  const returnDate = req.body.returnDate || '';

  if (!returnDate) {
    return res.status(400).json({ error: 'Return date is required.' });
  }

  if (returnDate < gateDate) {
    return res.status(400).json({ error: 'Return date must be the same day or later than the gate pass date.' });
  }

  const gatePass = {
    id: generateGatePassId(),
    userId: req.body.userId || '',
    student: req.body.student || 'Anonymous',
    email: normalizeEmail(req.body.email),
    registrationNumber: req.body.registrationNumber || '',
    hostelBlock: req.body.hostelBlock || 'Unknown',
    roomNumber: req.body.roomNumber || 'Unknown',
    reason: req.body.reason || 'General',
    session: req.body.session || 'Morning',
    gateDate,
    returnDate,
    studentPhoto: normalizeImageDataUrl(req.body.studentPhoto || req.body.photo || req.body.studentImage || ''),
    status: 'REQUESTED',
    workflowStatus: 'REQUESTED',
    wardenVerified: false,
    createdAt: new Date().toISOString(),
    approvedBy: '',
    approvedAt: null
  };

  data.gatePasses = Array.isArray(data.gatePasses) ? data.gatePasses : [];
  data.gatePasses.unshift(gatePass);
  addGatePassAudit(data, gatePass, 'Student Applied', { id: gatePass.userId, role: 'student', ip: req.ip });
  writeData(data);
  if (req.io) {
    req.io.emit('gate-pass.created', gatePass);
  }
  res.status(201).json(gatePass);
});

app.put('/api/gate-passes/:id/status', async (req, res) => {
  const data = readData();
  const gatePass = (data.gatePasses || []).find((item) => item.id === req.params.id);
  if (!gatePass) {
    return res.status(404).json({ error: 'Gate pass not found' });
  }

  const status = (req.body.status || '').trim();
  const validStatuses = ['Pending', 'Approved', 'Rejected'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status is required and must be one of: ${validStatuses.join(', ')}` });
  }

  gatePass.status = status === 'Approved' ? 'QR GENERATED' : status === 'Rejected' ? 'REJECTED' : 'REQUESTED';
  gatePass.workflowStatus = gatePass.status;
  gatePass.approvedBy = req.body.approvedBy || 'Admin';
  gatePass.approvedAt = new Date().toISOString();
  gatePass.facultyId = req.body.facultyId || '';
  gatePass.facultyRemarks = String(req.body.remarks || '').trim();

  let createdNotification = null;
  if (status === 'Approved') {
    await provisionGatePassQr(gatePass, req);
    createdNotification = createGatePassNotification(data, gatePass, 'gate-pass-approved', 'Gate Pass Approved — QR Ready', `Your gate pass ${gatePass.id} has been approved. Your secure QR code is ready for gate scanning.`);
    addGatePassAudit(data, gatePass, 'Faculty Approved & QR Generated', { name: gatePass.approvedBy, role: 'faculty', ip: req.ip }, gatePass.facultyRemarks);
  } else {
    createdNotification = createGatePassNotification(data, gatePass, 'gate-pass-rejected', 'Gate Pass Request Rejected', `Your gate pass ${gatePass.id} was rejected.${gatePass.facultyRemarks ? ` Remarks: ${gatePass.facultyRemarks}` : ''}`);
    addGatePassAudit(data, gatePass, 'Faculty Rejected', { name: gatePass.approvedBy, role: 'faculty', ip: req.ip }, gatePass.facultyRemarks);
  }

  writeData(data);

  if (req.io && createdNotification) {
    req.io.emit('student-notification.created', createdNotification);
  }

  res.json(gatePass);
});

// API names used by the QR gate-pass workflow specification.
app.post('/api/gatepass/apply', (req, res) => {
  req.url = '/api/gate-passes';
  app.handle(req, res);
});

app.post('/api/gatepass/approve', (req, res) => {
  const id = String(req.body.id || req.body.gatePassId || '');
  if (!id) return res.status(400).json({ error: 'A gate pass id is required.' });
  req.method = 'PUT';
  req.url = `/api/gate-passes/${encodeURIComponent(id)}/status`;
  req.body.status = req.body.status || 'Approved';
  app.handle(req, res);
});

app.get('/api/gatepass/:id', (req, res) => {
  const data = readData();
  const gatePass = data.gatePasses.find((item) => item.id === req.params.id);
  if (!gatePass) return res.status(404).json({ error: 'Gate pass not found.' });
  res.json({ ...gatePass, scanLogs: data.gatePassScanLogs.filter((log) => log.gatePassId === gatePass.id), auditLogs: data.auditLogs.filter((log) => log.gatePassId === gatePass.id) });
});

app.get('/api/gatepass/history', (req, res) => {
  const data = readData();
  const userId = String(req.query.userId || '');
  res.json(userId ? data.gatePasses.filter((item) => item.userId === userId) : data.gatePasses);
});

app.post('/api/gatepass/scan', (req, res) => {
  const token = String(req.body.token || '');
  const key = `${req.ip}:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 12)}`;
  const recent = (gatePassScanAttempts.get(key) || []).filter((time) => Date.now() - time < 60000);
  if (recent.length >= 12) return res.status(429).json({ error: 'Too many scan attempts. Please wait a minute.' });
  recent.push(Date.now()); gatePassScanAttempts.set(key, recent);
  const data = readData(); const validation = validateGatePassToken(token, data);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const gatePass = validation.gatePass;
  const guard = { id: String(req.body.guardId || 'guard'), name: String(req.body.guardName || req.body.guardId || 'Security Guard'), role: 'guard', ip: req.ip };
  const log = { id: `GPS-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, gatePassId: gatePass.id, guardId: guard.id, guardName: guard.name, scanTime: new Date().toISOString(), device: String(req.body.device || '').slice(0, 120), ipAddress: req.ip, location: String(req.body.location || 'Main Gate').slice(0, 120), remarks: '' };
  let message;
  if (!gatePass.outTime) {
    gatePass.outTime = log.scanTime; gatePass.guardExitId = guard.id; gatePass.status = 'OUT'; gatePass.workflowStatus = 'OUT';
    data.gatePassScanLogs.unshift({ ...log, scanType: 'OUT' }); addGatePassAudit(data, gatePass, 'Exit Scan', guard, log.location);
    createGatePassNotification(data, gatePass, 'gate-pass-out', 'Exit Recorded', `Your exit at ${log.location} has been recorded.`); message = 'Exit Successfully Recorded.';
  } else if (!gatePass.inTime) {
    gatePass.inTime = log.scanTime; gatePass.guardEntryId = guard.id; gatePass.status = 'RETURNED'; gatePass.workflowStatus = 'RETURNED';
    data.gatePassScanLogs.unshift({ ...log, scanType: 'IN' }); addGatePassAudit(data, gatePass, 'Return Scan', guard, log.location);
    createGatePassNotification(data, gatePass, 'gate-pass-returned', 'Return Recorded', 'Your return has been recorded. Waiting for warden verification.');
    createGatePassNotification(data, gatePass, 'warden-verification-required', 'Student Returned — Verification Required', `${gatePass.student} has returned and needs hostel-arrival verification.`, 'Warden');
    message = 'Return Successfully Recorded. Waiting for Warden Verification.';
  } else return res.status(409).json({ error: 'Return has already been recorded. Waiting for warden verification.' });
  writeData(data);
  res.json({ message, gatePass: { id: gatePass.id, student: gatePass.student, registrationNumber: gatePass.registrationNumber, hostelBlock: gatePass.hostelBlock, roomNumber: gatePass.roomNumber, status: gatePass.status, outTime: gatePass.outTime, inTime: gatePass.inTime } });
});

app.post('/api/gatepass/warden/approve', (req, res) => {
  const data = readData(); const gatePass = data.gatePasses.find((item) => item.id === (req.body.id || req.body.gatePassId));
  if (!gatePass) return res.status(404).json({ error: 'Gate pass not found.' });
  if (!gatePass.inTime) return res.status(400).json({ error: 'The student has not returned through the gate yet.' });
  const approved = req.body.approved !== false;
  gatePass.wardenId = String(req.body.wardenId || ''); gatePass.wardenName = String(req.body.wardenName || 'Warden'); gatePass.wardenRemarks = String(req.body.remarks || ''); gatePass.wardenVerified = approved; gatePass.verifiedTime = new Date().toISOString();
  gatePass.status = approved ? 'COMPLETED' : 'WARDEN VERIFICATION REJECTED'; gatePass.workflowStatus = gatePass.status;
  addGatePassAudit(data, gatePass, approved ? 'Warden Approved Arrival' : 'Warden Rejected Verification', { id: gatePass.wardenId, name: gatePass.wardenName, role: 'warden', ip: req.ip }, gatePass.wardenRemarks);
  createGatePassNotification(data, gatePass, 'gate-pass-completed', approved ? 'Gate Pass Completed' : 'Warden Verification Rejected', approved ? 'Your gate pass workflow is complete.' : 'Your hostel arrival verification was rejected. Please contact the warden.');
  writeData(data); res.json(gatePass);
});

app.get('/qr/:token', (req, res) => {
  const token = String(req.params.token || '').replace(/'/g, '');
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gate Pass Scan</title><style>body{font-family:system-ui;background:#f1f5f9;display:grid;place-items:center;min-height:100vh;margin:0;color:#0f172a}.card{max-width:420px;background:white;border-radius:20px;padding:28px;box-shadow:0 12px 30px #0f172a20}button{width:100%;border:0;border-radius:10px;padding:14px;background:#0f766e;color:white;font-weight:700;font-size:16px}.muted{color:#64748b}.result{margin-top:16px;padding:14px;border-radius:10px;background:#f8fafc}</style><main class="card"><h1>Hostel Gate Pass</h1><p class="muted">Security scan verification. The action is recorded securely.</p><button id="scan">Record scan</button><div id="result" class="result">Ready to validate QR code.</div></main><script>document.getElementById('scan').onclick=async()=>{const r=document.getElementById('result');r.textContent='Validating…';const x=await fetch('/api/gatepass/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'${token}',guardId:'QR Guard',location:'Main Gate',device:navigator.userAgent})});const d=await x.json();r.textContent=d.message||d.error||'Unable to scan.';if(d.gatePass)r.innerHTML+='<br><br><b>'+d.gatePass.student+'</b> · '+d.gatePass.status;};</script>`);
});

app.get('/api/laundry-requests', (req, res) => {
  const data = readData();
  res.json(data.laundryRequests || []);
});

app.post('/api/laundry-requests', (req, res) => {
  const data = readData();
  const laundryRequest = {
    id: generateLaundryRequestId(),
    student: req.body.student || 'Anonymous',
    email: normalizeEmail(req.body.email),
    registrationNumber: req.body.registrationNumber || '',
    hostelBlock: req.body.hostelBlock || 'Unknown',
    roomNumber: req.body.roomNumber || 'Unknown',
    dressCount: Number(req.body.dressCount) || 0,
    pickupDate: req.body.pickupDate || new Date().toISOString().split('T')[0],
    details: req.body.details || '',
    status: 'Pending',
    createdAt: new Date().toISOString()
  };

  data.laundryRequests = Array.isArray(data.laundryRequests) ? data.laundryRequests : [];
  data.laundryRequests.unshift(laundryRequest);
  writeData(data);
  res.status(201).json(laundryRequest);
});

app.get('/api/complaints/:id', (req, res) => {
  const data = readData();
  const complaint = data.complaints.find((item) => item.id === req.params.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }
  res.json(complaint);
});

app.post('/api/complaints', (req, res) => {
  const data = readData();
  const complaint = {
    id: generateComplaintId(),
    student: req.body.student || 'Anonymous',
    email: normalizeEmail(req.body.email),
    registrationNumber: req.body.registrationNumber || '',
    hostelBlock: req.body.hostelBlock || 'Unknown',
    roomNumber: req.body.roomNumber || 'Unknown',
    category: req.body.category || 'General',
    priority: req.body.priority || 'Low',
    description: req.body.description || '',
    status: 'Pending',
    assignedTo: req.body.assignedTo || 'Unassigned',
    createdAt: new Date().toISOString(),
    timeline: ['Submitted']
  };

  data.complaints.unshift(complaint);
  writeData(data);
  if (req.io) {
    req.io.emit('complaint.created', complaint);
  }
  res.status(201).json(complaint);
});

app.delete('/api/complaints/:id', (req, res) => {
  const data = readData();
  const complaintIndex = data.complaints.findIndex((item) => item.id === req.params.id);
  if (complaintIndex === -1) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  data.complaints.splice(complaintIndex, 1);
  writeData(data);
  res.json({ message: 'Complaint deleted successfully' });
});

app.put('/api/complaints/:id/status', (req, res) => {
  const data = readData();
  const complaint = data.complaints.find((item) => item.id === req.params.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  const status = req.body.status;
  const validStatuses = ['Pending', 'Assigned', 'Accepted', 'In Progress', 'Completed'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status is required and must be one of: ${validStatuses.join(', ')}` });
  }

  complaint.status = status;
  if (req.body.technician) {
    complaint.technician = req.body.technician;
  }
  complaint.timeline = Array.from(new Set([...complaint.timeline, status]));
  writeData(data);
  if (req.io) {
    req.io.emit('complaint.updated', complaint);
  }
  res.json(complaint);
});

app.patch('/api/complaints/:id', (req, res) => {
  const data = readData();
  const complaint = data.complaints.find((item) => item.id === req.params.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  const allowedUpdates = ['description', 'priority', 'assignedTo', 'status'];
  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) {
      complaint[field] = req.body[field];
    }
  });

  if (req.body.status) {
    complaint.timeline = Array.from(new Set([...complaint.timeline, req.body.status]));
  }

  writeData(data);
  res.json(complaint);
});

app.get('/api/technicians', (req, res) => {
  const data = readData();
  const technicians = data.users.filter((user) => user.role === 'technician').map(sanitizeUser);
  res.json(technicians);
});

app.get('/api/summary', (req, res) => {
  const data = readData();
  const complaints = data.complaints;
  const today = new Date().toISOString().split('T')[0];
  const resolvedToday = complaints.filter((item) => item.status === 'Completed' && item.createdAt?.startsWith(today)).length;
  const activeTechnicians = data.users.filter((user) => user.role === 'technician').length;

  res.json({
    total: complaints.length,
    pending: complaints.filter((item) => item.status === 'Pending').length,
    inProgress: complaints.filter((item) => item.status === 'In Progress').length,
    completed: complaints.filter((item) => item.status === 'Completed').length,
    resolvedToday,
    activeTechnicians
  });
});

app.get('/api/admin-settings', (req, res) => {
  const data = readData();
  res.json(data.adminSettings);
});

app.put('/api/admin-settings', (req, res) => {
  const data = readData();
  const alertMinConfidence = Math.min(99, Math.max(1, Math.round(Number(req.body.alertMinConfidence ?? data.adminSettings.alertMinConfidence ?? 50) || 50)));
  data.adminSettings = {
    ...data.adminSettings,
    alertCameraName: String(req.body.alertCameraName || data.adminSettings.alertCameraName || 'Hostel CCTV Camera 3').trim(),
    alertCameraLocation: String(req.body.alertCameraLocation || data.adminSettings.alertCameraLocation || 'Block A - Ground Floor').trim(),
    alertMinConfidence
  };
  writeData(data);
  res.json(data.adminSettings);
});

app.get('/api/alert-history', (req, res) => {
  const data = readData();
  res.json(data.alertHistory.slice().sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt)));
});

app.get('/api/telegram-status', (req, res) => {
  res.json({ configured: Boolean(getTelegramConfig()) });
});

app.get('/api/inventory', (req, res) => {
  const data = readData();
  const defaultInventory = [
    { id: 'INV-101', name: 'Power Outlets', category: 'Electrical', stock: 24, status: 'In Stock', icon: 'fa-plug' },
    { id: 'INV-102', name: 'Faucet Washers', category: 'Plumbing', stock: 18, status: 'In Stock', icon: 'fa-faucet' },
    { id: 'INV-103', name: 'LED Bulbs 20W', category: 'Lighting', stock: 45, status: 'In Stock', icon: 'fa-lightbulb' },
    { id: 'INV-104', name: 'Wi-Fi Routers', category: 'Network', stock: 6, status: 'Low Stock', icon: 'fa-wifi' },
    { id: 'INV-105', name: 'Door Lock Cylinders', category: 'Security', stock: 12, status: 'In Stock', icon: 'fa-key' },
    { id: 'INV-106', name: 'AC Filters', category: 'HVAC', stock: 3, status: 'Critical', icon: 'fa-snowflake' }
  ];
  if (!Array.isArray(data.inventory) || !data.inventory.length) {
    data.inventory = defaultInventory;
    writeData(data);
  }
  res.json(data.inventory);
});

app.post('/api/inventory/restock', (req, res) => {
  const data = readData();
  const id = String(req.body.id || '');
  const amount = Number(req.body.amount || 10);
  const item = (data.inventory || []).find((i) => i.id === id);
  if (!item) return res.status(404).json({ error: 'Inventory item not found.' });
  item.stock += amount;
  item.status = item.stock > 10 ? 'In Stock' : item.stock > 4 ? 'Low Stock' : 'Critical';
  writeData(data);
  res.json({ success: true, item });
});

async function sendTelegramEmergencyAlert(req, res) {
  const type = String(req.body.type || '').trim().toLowerCase();
  const confidenceValue = Number(req.body.confidence);
  const confidence = confidenceValue <= 1 ? Math.round(confidenceValue * 100) : Math.round(confidenceValue);
  const camera = String(req.body.camera || 'Hostel CCTV Camera 3').trim();
  const location = String(req.body.location || 'Hostel CCTV Location').trim();
  const data = readData();
  const normalizedType = ['fire', 'smoke', 'fire and smoke'].includes(type) ? type : '';
  const configuredMinConfidence = Math.min(99, Math.max(1, Math.round(Number(data.adminSettings?.alertMinConfidence ?? 50) || 50)));
  const minConfidence = normalizedType === 'fire'
    ? Math.min(configuredMinConfidence, FIRE_ALERT_MIN_CONFIDENCE)
    : normalizedType === 'smoke'
      ? Math.max(configuredMinConfidence, SMOKE_ALERT_MIN_CONFIDENCE)
      : FIRE_ALERT_MIN_CONFIDENCE;

  if (!normalizedType || !Number.isFinite(confidence) || confidence < minConfidence || !camera || !location) {
    return res.status(400).json({ error: `type (Fire, Smoke, or Fire and Smoke), confidence (${minConfidence} or higher), camera, and location are required.` });
  }

  const cooldownKey = `${camera.toLowerCase()}::${normalizedType}`;
  const lastSentAt = alertCooldowns.get(cooldownKey) || 0;
  const elapsed = Date.now() - lastSentAt;
  if (elapsed < ALERT_COOLDOWN_MS) {
    return res.status(202).json({ status: 'cooldown', message: 'Alert already sent for this detection event.', retryAfterSeconds: Math.ceil((ALERT_COOLDOWN_MS - elapsed) / 1000) });
  }

  const createdAt = new Date();
  const timestamp = createdAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const alertId = `ALT-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
  let snapshot;
  try {
    snapshot = saveAlertSnapshot(req.body.image, alertId);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const alert = {
    id: alertId,
    detectionType: normalizedType === 'fire'
      ? 'Fire'
      : normalizedType === 'smoke'
        ? 'Smoke'
        : 'Fire and Smoke',
    confidence,
    cameraName: camera,
    camera,
    location,
    date: createdAt.toISOString().slice(0, 10),
    time: createdAt.toTimeString().slice(0, 8),
    createdAt: createdAt.toISOString(),
    imagePath: snapshot.publicPath,
    telegramStatus: 'Failed',
    telegramMessageId: null,
    status: 'Failed'
  };

  try {
    const telegram = await sendTelegramAlert({
      alertType: alert.detectionType,
      confidence,
      cameraName: camera,
      location,
      imagePath: snapshot.diskPath,
      timestamp
    });
    alert.telegramStatus = 'Sent';
    alert.telegramMessageId = telegram.messageId;
    alert.status = 'Sent';
    alert.message = telegram.message;
    data.alertHistory.push(alert);
    writeData(data);
    alertCooldowns.set(cooldownKey, Date.now());
    io.emit('emergency-alert', alert);
    return res.status(201).json({ message: 'Telegram emergency alert sent successfully.', alert });
  } catch (error) {
    alert.error = error.message;
    data.alertHistory.push(alert);
    writeData(data);
    io.emit('emergency-alert', alert);
    console.error('Telegram emergency alert failed:', error.message);
    return res.status(502).json({ error: 'Unable to send Telegram emergency alert.', alert });
  }
}

app.post('/api/send-telegram-alert', sendTelegramEmergencyAlert);
app.post('/api/send-emergency-alert', sendTelegramEmergencyAlert);
app.post('/api/cctv-log-pdf', (req, res) => {
  try {
    const pdfBuffer = createCCTVLogPdfBuffer(req.body || {});
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cctv-detection-log-${stamp}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('CCTV log PDF generation failed:', error);
    res.status(500).json({ error: 'Unable to generate the CCTV detection log PDF.' });
  }
});

app.post('/api/gate-passes/export-pdf', (req, res) => {
  try {
    const pdfBuffer = createGatePassPdfBuffer(req.body || {});
    const fileName = `gate-pass-requests-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Gate pass PDF export failed:', error);
    res.status(500).json({ error: 'Unable to generate the gate pass PDF.' });
  }
});

app.get('/api/gate-passes/:id/pdf', async (req, res) => {
  try {
    const data = readData();
    const gatePass = (data.gatePasses || []).find((item) => item.id === req.params.id);
    if (!gatePass) {
      return res.status(404).json({ error: 'Gate pass not found.' });
    }

    if (await backfillApprovedGatePassQrs(data, req)) writeData(data);

    const pdfBuffer = await createSingleGatePassPdfBuffer(gatePass);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${gatePass.id || 'gate-pass'}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Single gate pass PDF generation failed:', error);
    res.status(500).json({ error: 'Unable to generate the gate pass PDF.' });
  }
});

function getCCTVModelPath() {
  const modelCandidates = [
    path.join(__dirname, 'models', 'best.pt'),
    path.join(__dirname, 'public', 'best.pt'),
    path.join(__dirname, 'best.pt')
  ];
  return modelCandidates.find((candidate) => fs.existsSync(candidate));
}

function getCrowdModelPath() {
  const modelPath = path.join(__dirname, 'models', 'yolo11n.pt');
  return fs.existsSync(modelPath) ? modelPath : null;
}

function rejectPendingCCTVRequests(error) {
  while (cctvInferenceRequests.length) {
    cctvInferenceRequests.shift().reject(error);
  }
}

function rejectPendingFaceAuthRequests(error) {
  while (faceAuthInferenceRequests.length) {
    faceAuthInferenceRequests.shift().reject(error);
  }
}

function startCCTVInferenceProcess(modelPath, crowdModelPath) {
  if (cctvInferenceProcess) {
    return cctvInferenceProcess;
  }

  const scriptPath = path.join(__dirname, 'models', 'inference_server.py');
  const venvPython = process.platform === 'win32'
    ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '.venv', 'bin', 'python');
  const pythonCmd = process.env.PYTHON || (fs.existsSync(venvPython) ? venvPython : 'python');
  const inferenceProcess = spawn(pythonCmd, [scriptPath, '--model', modelPath, '--crowd-model', crowdModelPath]);
  cctvInferenceProcess = inferenceProcess;

  inferenceProcess.stdout.on('data', (data) => {
    cctvInferenceBuffer += data.toString();
    const lines = cctvInferenceBuffer.split(/\r?\n/);
    cctvInferenceBuffer = lines.pop();
    lines.filter(Boolean).forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith('{')) {
        console.warn('CCTV inference stdout:', trimmedLine);
        return;
      }
      const request = cctvInferenceRequests.shift();
      if (!request) return;
      try {
        const payload = JSON.parse(trimmedLine);
        if (payload.success) {
          request.resolve(payload.result);
        } else {
          request.reject(new Error(payload.error || 'CCTV inference failed.'));
        }
      } catch (error) {
        request.reject(new Error(`Invalid inference output: ${error.message}`));
      }
    });
  });

  inferenceProcess.stderr.on('data', (data) => console.error('CCTV inference:', data.toString().trim()));
  inferenceProcess.on('error', (error) => {
    if (cctvInferenceProcess === inferenceProcess) cctvInferenceProcess = null;
    rejectPendingCCTVRequests(error);
  });
  inferenceProcess.on('close', (code) => {
    if (cctvInferenceProcess === inferenceProcess) cctvInferenceProcess = null;
    rejectPendingCCTVRequests(new Error(`CCTV inference process stopped (code ${code}).`));
  });

  return inferenceProcess;
}

function startFaceAuthInferenceProcess() {
  if (faceAuthInferenceProcess) {
    return faceAuthInferenceProcess;
  }

  const scriptPath = path.join(FACE_AUTH_DIR, 'inference_server.py');
  const venvPython = process.platform === 'win32'
    ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '.venv', 'bin', 'python');
  const pythonCmd = process.env.FACE_AUTH_PYTHON || process.env.PYTHON || 'python';
  const inferenceProcess = spawn(
    pythonCmd,
    [scriptPath, '--embeddings-dir', FACE_AUTH_EMBEDDINGS_DIR],
    {
      cwd: FACE_AUTH_DIR,
      env: {
        ...process.env,
        FACE_AUTH_EMBEDDINGS_DIR,
        PYTHONUNBUFFERED: '1',
        FACE_AUTH_PYTHON: pythonCmd,
        FACE_AUTH_FALLBACK_PYTHON: fs.existsSync(venvPython) ? venvPython : ''
      }
    }
  );
  faceAuthInferenceProcess = inferenceProcess;

  inferenceProcess.stdout.on('data', (data) => {
    faceAuthInferenceBuffer += data.toString();
    const lines = faceAuthInferenceBuffer.split(/\r?\n/);
    faceAuthInferenceBuffer = lines.pop();
    lines.filter(Boolean).forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith('{')) {
        console.warn('Face auth stdout:', trimmedLine);
        return;
      }
      const request = faceAuthInferenceRequests.shift();
      if (!request) return;
      try {
        const payload = JSON.parse(trimmedLine);
        if (payload.success) {
          request.resolve(payload.result);
        } else {
          request.reject(new Error(payload.error || 'Face authentication inference failed.'));
        }
      } catch (error) {
        request.reject(new Error(`Invalid face authentication output: ${error.message}`));
      }
    });
  });

  inferenceProcess.stderr.on('data', (data) => console.error('Face auth inference:', data.toString().trim()));
  inferenceProcess.on('error', (error) => {
    if (faceAuthInferenceProcess === inferenceProcess) faceAuthInferenceProcess = null;
    rejectPendingFaceAuthRequests(error);
  });
  inferenceProcess.on('close', (code) => {
    if (faceAuthInferenceProcess === inferenceProcess) faceAuthInferenceProcess = null;
    rejectPendingFaceAuthRequests(new Error(`Face auth inference process stopped (code ${code}).`));
  });

  return inferenceProcess;
}

function runCCTVInference(image, options = {}) {
  const modelPath = getCCTVModelPath();
  const crowdModelPath = getCrowdModelPath();
  if (!modelPath || !crowdModelPath) {
    return Promise.reject(new Error('Inference models are missing. Place best.pt and yolo11n.pt inside /models.'));
  }

  const inferenceProcess = startCCTVInferenceProcess(modelPath, crowdModelPath);
  return new Promise((resolve, reject) => {
    cctvInferenceRequests.push({ resolve, reject });
    inferenceProcess.stdin.write(`${JSON.stringify({
      image,
      includeCrowd: options.includeCrowd !== false,
      sourceType: options.sourceType || 'live'
    })}\n`, (error) => {
      if (!error) return;
      const requestIndex = cctvInferenceRequests.findIndex((request) => request.resolve === resolve);
      if (requestIndex >= 0) cctvInferenceRequests.splice(requestIndex, 1);
      reject(error);
    });
  });
}

function runFaceAuthInference(image, options = {}) {
  const scriptPath = path.join(FACE_AUTH_DIR, 'inference_server.py');
  if (!fs.existsSync(scriptPath)) {
    return Promise.reject(new Error('Face authentication module is missing from /face_auth.'));
  }

  fs.mkdirSync(FACE_AUTH_EMBEDDINGS_DIR, { recursive: true });
  const inferenceProcess = startFaceAuthInferenceProcess();
  return new Promise((resolve, reject) => {
    faceAuthInferenceRequests.push({ resolve, reject });
    inferenceProcess.stdin.write(`${JSON.stringify({
      image,
      reloadKnownFaces: options.reloadKnownFaces === true
    })}\n`, (error) => {
      if (!error) return;
      const requestIndex = faceAuthInferenceRequests.findIndex((request) => request.resolve === resolve);
      if (requestIndex >= 0) faceAuthInferenceRequests.splice(requestIndex, 1);
      reject(error);
    });
  });
}

app.post('/api/cctv-inference', async (req, res) => {
  const image = req.body.image;
  const includeCrowd = req.body.includeCrowd !== false;
  const sourceType = req.body.sourceType === 'upload' ? 'upload' : 'live';
  if (!image) {
    return res.status(400).json({ error: 'Image data is required for CCTV inference.' });
  }

  try {
    const result = await runCCTVInference(image, { includeCrowd, sourceType });
    res.json(result);
  } catch (error) {
    console.error('CCTV inference failed:', error);
    res.status(500).json({ error: error.message || 'CCTV inference failed.' });
  }
});

app.post('/api/face-auth-inference', async (req, res) => {
  const image = req.body.image;
  const reloadKnownFaces = req.body.reloadKnownFaces === true;
  if (!image) {
    return res.status(400).json({ error: 'Image data is required for face authentication.' });
  }

  try {
    const result = await runFaceAuthInference(image, { reloadKnownFaces });
    res.json(result);
  } catch (error) {
    console.error('Face authentication inference failed:', error);
    res.status(500).json({ error: error.message || 'Face authentication inference failed.' });
  }
});

app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store').sendFile(MAIN_HTML);
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-store').sendFile(MAIN_HTML);
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

const port = process.env.PORT || 5000;
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port} and http://127.0.0.1:${port}`);
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Image payload is too large. Please try again with a smaller frame.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
