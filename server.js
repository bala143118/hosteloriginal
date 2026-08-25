require('dotenv').config();

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
const {
  getTelegramConfig,
  sendTelegramAlert,
  sendTelegramMessage,
  testTelegramConnection,
  sendSurveillanceTelegramAlert,
  formatTelegramWardenApproval,
  formatTelegramAdminApproval,
  formatTelegramSecurityExit, 
  formatTelegramSecurityRejection,
  formatTelegramWardenArrival,
  formatTelegramWardenRejection
} = require('./telegram_service'); 

const { signGatePass, verifyGatePassSignature, getPublicKeyPem } = require('./gatepass_signature');
const { createLeaveAuthorizationCertificate } = require('./gatepass_certificate');
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
const DATA_DIR = isVercel ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
const BUNDLED_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = path.join(DATA_DIR, 'db.json');
const ALERT_IMAGES_DIR = path.join(DATA_DIR, 'alert-images');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAIN_HTML = path.join(__dirname, 'index.html');
const FACE_AUTH_DIR = path.join(__dirname, 'face_auth');
const FACE_AUTH_EMBEDDINGS_DIR = isVercel ? path.join('/tmp', 'face_auth', 'embeddings') : path.join(FACE_AUTH_DIR, 'face_auth', 'embeddings');

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
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('Data directory creation warning:', err.message);
  }

  if (!fs.existsSync(DATA_PATH)) {
    if (BUNDLED_DATA_PATH !== DATA_PATH && fs.existsSync(BUNDLED_DATA_PATH)) {
      try {
        fs.copyFileSync(BUNDLED_DATA_PATH, DATA_PATH);
        return;
      } catch (err) {
        console.warn('Could not copy bundled db.json, generating defaults:', err.message);
      }
    }
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
    try {
      fs.writeFileSync(DATA_PATH, JSON.stringify(initialData, null, 2), 'utf8');
    } catch (err) {
      console.warn('Unable to write initial db.json:', err.message);
    }
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

    // Header Background
    doc.rect(0, 0, doc.page.width, 86).fill('#0f172a');
    doc.rect(0, 84, doc.page.width, 4).fill('#4f46e5');

    // Header Texts
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('HOSTEL RESIDENCE GATE PASS', 32, 20);
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(9).text('Campus Digital Security & Student Movement Authorization', 32, 44);
    doc.fillColor('#38bdf8').font('Helvetica-Bold').fontSize(8).text('OFFICIAL VERIFIED DOCUMENT', 32, 60);

    // Header Right Pass ID & Status
    doc.fillColor('#cbd5e1').font('Helvetica').fontSize(8).text('PASS ID', 380, 22, { width: 180, align: 'right' });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12).text(gatePass.id || 'N/A', 380, 34, { width: 180, align: 'right' });
    doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(10).text(`● ${status.toUpperCase()}`, 380, 52, { width: 180, align: 'right' });

    // Main Content Box
    const leftMargin = 32;
    const contentWidth = 531;

    // Student Info Bar
    doc.roundedRect(leftMargin, 102, contentWidth, 38, 8).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#64748b').font('Helvetica').fontSize(8).text('STUDENT NAME', leftMargin + 14, 110);
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text(gatePass.student || 'N/A', leftMargin + 14, 122);

    doc.fillColor('#64748b').font('Helvetica').fontSize(8).text('REGISTER NUMBER', leftMargin + 200, 110);
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text(gatePass.registrationNumber || 'N/A', leftMargin + 200, 122);

    doc.fillColor('#64748b').font('Helvetica').fontSize(8).text('SUBMITTED DATE', leftMargin + 370, 110);
    doc.fillColor('#0f172a').font('Helvetica').fontSize(10).text(new Date(gatePass.createdAt || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), leftMargin + 370, 122);

    // Details Grid Left Column & Right Photo Box
    const startY = 150;
    const gridFields = [
      ['Hostel Block', gatePass.hostelBlock || 'Block A'],
      ['Room Number', gatePass.roomNumber || 'N/A'],
      ['Gate Pass Date', formatDate(gatePass.gateDate)],
      ['Return Date', formatDate(gatePass.returnDate)],
      ['Session Timing', gatePass.session || 'General'],
      ['Authorized By', gatePass.approvedBy || 'Warden (Pending)']
    ];

    const colWidth = 176;
    const rowHeight = 44;
    gridFields.forEach((field, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = leftMargin + (col * (colWidth + 10));
      const y = startY + (row * (rowHeight + 8));

      doc.roundedRect(x, y, colWidth, rowHeight, 6).fillAndStroke('#ffffff', '#e2e8f0');
      doc.fillColor('#64748b').font('Helvetica').fontSize(7.5).text(field[0].toUpperCase(), x + 10, y + 8);
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10).text(String(field[1]), x + 10, y + 22, { width: colWidth - 20 });
    });

    // Student Photo Box (Right side)
    const photoX = leftMargin + (colWidth * 2) + 24;
    const photoWidth = 145;
    const photoHeight = 148;
    doc.roundedRect(photoX, startY, photoWidth, photoHeight, 8).fillAndStroke('#f8fafc', '#cbd5e1');
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(8).text('STUDENT PHOTO', photoX + 10, startY + 10);

    if (imageBuffer) {
      try {
        doc.image(imageBuffer, photoX + 15, startY + 26, { fit: [115, 110], align: 'center', valign: 'center' });
      } catch (err) {
        doc.fillColor('#94a3b8').font('Helvetica').fontSize(8).text('Photo Verified', photoX + 10, startY + 70, { width: photoWidth - 20, align: 'center' });
      }
    } else {
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(8).text('No Photo Uploaded', photoX + 10, startY + 70, { width: photoWidth - 20, align: 'center' });
    }

    // Reason Box
    const reasonY = startY + (3 * (rowHeight + 8)) + 6;
    doc.roundedRect(leftMargin, reasonY, contentWidth, 54, 8).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(8).text('REASON FOR LEAVE / PURPOSE', leftMargin + 14, reasonY + 10);
    doc.fillColor('#1e293b').font('Helvetica').fontSize(9.5).text(String(gatePass.reason || 'Not specified'), leftMargin + 14, reasonY + 24, { width: contentWidth - 28, lineGap: 2 });

    // QR Verification & Security Section
    const qrSectionY = reasonY + 66;
    const qrBoxHeight = 160;
    doc.roundedRect(leftMargin, qrSectionY, contentWidth, qrBoxHeight, 10).fillAndStroke('#ffffff', '#cbd5e1');

    // Left info in QR Box
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('Digital Security & Verification QR', leftMargin + 20, qrSectionY + 18);
    doc.fillColor('#475569').font('Helvetica').fontSize(8.5).text(
      'Security officers must scan this QR code at campus entry/exit points.\n' +
      'This document is non-transferable and valid only for the approved movement window.',
      leftMargin + 20, qrSectionY + 36, { width: 330, lineGap: 3 }
    );

    doc.roundedRect(leftMargin + 20, qrSectionY + 80, 330, 60, 6).fill('#f1f5f9');
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(7.5).text('OFFICIAL VERIFICATION CODE', leftMargin + 30, qrSectionY + 88);
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text(gatePass.id || 'N/A', leftMargin + 30, qrSectionY + 99);
    doc.fillColor('#4f46e5').font('Helvetica-Bold').fontSize(7.5).text(`CERT: ${gatePass.certificateId || 'CERT-N/A'}`, leftMargin + 30, qrSectionY + 114);
    doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(8).text(`STATUS: ${status.toUpperCase()}`, leftMargin + 30, qrSectionY + 126);

    // QR Code Image on right
    if (qrBuffer) {
      try {
        doc.image(qrBuffer, leftMargin + 375, qrSectionY + 18, { fit: [125, 125] });
      } catch (err) {
        doc.fillColor('#94a3b8').font('Helvetica').fontSize(8).text('QR Code Ready', leftMargin + 375, qrSectionY + 70, { width: 125, align: 'center' });
      }
    } else {
      doc.roundedRect(leftMargin + 375, qrSectionY + 18, 125, 125, 6).fillAndStroke('#f8fafc', '#e2e8f0');
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(8).text('QR Code Generated Upon Approval', leftMargin + 380, qrSectionY + 68, { width: 115, align: 'center' });
    }

    // Security Footer Strip
    const footerY = 574;
    doc.rect(leftMargin, footerY, contentWidth, 1).fill('#e2e8f0');
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(7.5).text('Generated securely via HostelFix Student Residence System • Valid with institutional ID', leftMargin, footerY + 8);
    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(7.5).text(`CONFIDENTIAL • ${new Date().getFullYear()}`, leftMargin, footerY + 8, { width: contentWidth, align: 'right' });

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

  const defaultSeedUsers = [
    { email: 'warden@hostelfix.edu', password: 'warden123', role: 'warden', name: 'Warden Officer' },
    { email: 'security@hostelfix.edu', password: 'security123', role: 'security', name: 'Gate Security Guard' }
  ];

  defaultSeedUsers.forEach((defUser) => {
    if (!data.users.some(u => u.email === defUser.email || u.role === defUser.role)) {
      data.users.push({
        ...defUser,
        userId: generateUserId(data.users)
      });
      changed = true;
    }
  });

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
    relatedGatePassId: gatePass.id, receiverRole: role,
    student: gatePass.student || '',
    registrationNumber: gatePass.registrationNumber || '',
    hostelBlock: gatePass.hostelBlock || '',
    roomNumber: gatePass.roomNumber || '',
    gateDate: gatePass.gateDate || '',
    returnDate: gatePass.returnDate || '',
    status: gatePass.status || 'REQUESTED'
  };
  data.personalNotifications.unshift(notification);
  return notification;
}

function generateCertificateId(gatePassId) {
  const hash = crypto.randomBytes(3).toString('hex').toUpperCase();
  const year = new Date().getFullYear();
  const shortId = (gatePassId || '').replace(/^GP-/, '').slice(-6) || String(Date.now()).slice(-6);
  return `CERT-${year}-${shortId}-${hash}`;
}

function addGatePassTimelineEvent(gatePass, stage, title, description, actor = 'System', role = 'system', extra = {}) {
  gatePass.timeline = Array.isArray(gatePass.timeline) ? gatePass.timeline : [];
  gatePass.timeline.push({
    id: `TL-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
    stage,
    title,
    description,
    actor: actor?.name || (typeof actor === 'string' ? actor : 'System'),
    role: actor?.role || (typeof role === 'string' ? role : 'system'),
    timestamp: new Date().toISOString(),
    ...extra
  });
}

function gatePassExpiry(returnDate) {
  const expiry = new Date(`${returnDate}T23:59:59.999`);
  return Number.isNaN(expiry.getTime()) ? new Date(Date.now() + 24 * 60 * 60 * 1000) : expiry;
}


async function provisionGatePassQr(gatePass, req) {
  if (!gatePass.certificateId) {
    gatePass.certificateId = generateCertificateId(gatePass.id);
  }
  signGatePass(gatePass);
  const expiresAt = gatePassExpiry(gatePass.returnDate);
  const token = jwt.sign({
    gp: gatePass.id,
    cert: gatePass.certificateId,
    jti: crypto.randomUUID(),
    scope: 'gatepass-scan'
  }, GATEPASS_TOKEN_SECRET, { expiresIn: Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const secureUrl = `${baseUrl}/qr/${encodeURIComponent(token)}`;
  gatePass.token = token;
  gatePass.qrToken = token;
  gatePass.secureUrl = secureUrl;
  gatePass.qrUrl = secureUrl;
  gatePass.qrImage = await QRCode.toDataURL(secureUrl, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 420,
    color: { dark: '#0f172a', light: '#ffffff' }
  });
  gatePass.qrGeneratedAt = new Date().toISOString();
  gatePass.expiryDate = expiresAt.toISOString();
}

async function backfillApprovedGatePassQrs(data, req) {
  const missingQrPasses = (data.gatePasses || []).filter((gatePass) => (
    /^(approved|qr generated|security_pending|outside|warden_pending)$/i.test(String(gatePass.status || '')) && !gatePass.qrImage
  ));
  if (!missingQrPasses.length) return false;
  for (const gatePass of missingQrPasses) {
    await provisionGatePassQr(gatePass, req);
    if (!gatePass.certificateId) gatePass.certificateId = generateCertificateId(gatePass.id);
    addGatePassAudit(data, gatePass, 'QR Generated for Existing Approved Pass', { role: 'system', ip: req.ip });
  }
  return true;
}

function validateGatePassToken(token, data) {
  if (!token) return { error: 'A QR token or Gate Pass ID is required.' };
  const rawToken = String(token).trim();

  let gatePass = (data.gatePasses || []).find((item) => item.id === rawToken || item.token === rawToken || item.qrToken === rawToken);

  let payload = null;
  if (!gatePass) {
    try {
      payload = jwt.verify(rawToken, GATEPASS_TOKEN_SECRET);
    } catch (error) {
      return { error: error.name === 'TokenExpiredError' ? 'This QR code has expired.' : 'Invalid or modified QR code.' };
    }
    if (!payload || payload.scope !== 'gatepass-scan' || !payload.gp) return { error: 'Invalid QR code.' };
    gatePass = (data.gatePasses || []).find((item) => item.id === payload.gp);
  }

  if (!gatePass) return { error: 'This QR code is no longer valid or Gate Pass was not found.' };
  if (gatePass.status === 'COMPLETED' || gatePass.currentStatus === 'COMPLETED') {
    return { error: 'Gate Pass Already Completed.', gatePass, isCompleted: true };
  }
  if (gatePass.status === 'REJECTED' || gatePass.status === 'CANCELLED') {
    return { error: 'This gate pass is not active (Rejected/Cancelled).' };
  }
  if (gatePass.expiryDate && new Date(gatePass.expiryDate) < new Date()) {
    return { error: 'This QR code has expired.' };
  }
  return { gatePass, payload };
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
  const validRoles = ['student', 'technician', 'admin', 'warden', 'security'];

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
  const validRoles = ['student', 'technician', 'admin', 'warden', 'security'];

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

app.get('/api/warden-notifications', (req, res) => {
  const data = readData();
  const notifications = (Array.isArray(data.personalNotifications) ? data.personalNotifications : [])
    .filter((n) => !n.receiverRole || n.receiverRole.toLowerCase() === 'warden' || n.audience === 'Warden' || n.audience === 'All')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(notifications);
});

app.get('/api/gatepass/returns-summary', (req, res) => {
  const data = readData();
  const today = new Date().toISOString().split('T')[0];
  const passes = Array.isArray(data.gatePasses) ? data.gatePasses : [];

  const returningToday = [];
  const returningTomorrow = [];
  const upcoming = [];
  const overdue = [];
  const returnedAwaitingVerification = [];

  const tomorrowDateObj = new Date();
  tomorrowDateObj.setDate(tomorrowDateObj.getDate() + 1);
  const tomorrow = tomorrowDateObj.toISOString().split('T')[0];

  passes.forEach((pass) => {
    const rawStatus = String(pass.status || 'REQUESTED').toUpperCase();
    if (rawStatus === 'REJECTED' || rawStatus === 'COMPLETED' || rawStatus === 'WARDEN VERIFICATION REJECTED') {
      return;
    }

    if (rawStatus === 'RETURNED' || (pass.inTime && !pass.wardenVerified)) {
      returnedAwaitingVerification.push(pass);
      return;
    }

    const ret = String(pass.returnDate || '').slice(0, 10);
    if (!ret) return;

    if (ret === today) {
      returningToday.push(pass);
    } else if (ret === tomorrow) {
      returningTomorrow.push(pass);
    } else if (ret > today) {
      upcoming.push(pass);
    } else if (ret < today) {
      overdue.push(pass);
    }
  });

  res.json({
    today,
    tomorrow,
    counts: {
      returningToday: returningToday.length,
      returningTomorrow: returningTomorrow.length,
      upcoming: upcoming.length,
      overdue: overdue.length,
      awaitingVerification: returnedAwaitingVerification.length,
      totalActive: returningToday.length + returningTomorrow.length + upcoming.length + overdue.length + returnedAwaitingVerification.length
    },
    returningToday,
    returningTomorrow,
    upcoming,
    overdue,
    returnedAwaitingVerification
  });
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
    certificateId: '',
    userId: req.body.userId || '',
    student: req.body.student || 'Anonymous',
    email: normalizeEmail(req.body.email),
    registrationNumber: req.body.registrationNumber || '',
    hostelBlock: req.body.hostelBlock || 'Unknown',
    roomNumber: req.body.roomNumber || 'Unknown',
    reason: req.body.reason || 'General',
    destination: req.body.destination || req.body.reason || 'Home / Out of campus',
    session: req.body.session || 'Morning',
    gateDate,
    returnDate,
    studentPhoto: normalizeImageDataUrl(req.body.studentPhoto || req.body.photo || req.body.studentImage || ''),
    status: 'PENDING_WARDEN',
    workflowStatus: 'PENDING_WARDEN',
    currentStatus: 'PENDING_WARDEN',
    wardenApproval: { status: 'PENDING', approvedBy: '', approvedAt: null, remarks: '' },
    adminApproval: { status: 'PENDING', approvedBy: '', approvedAt: null, remarks: '' },
    securityVerification: { status: 'PENDING', verifiedBy: '', verifiedAt: null, rejectionReason: '' },
    wardenVerification: { status: 'PENDING', verifiedBy: '', verifiedAt: null, rejectionReason: '' },
    securityVerified: false,
    wardenVerified: false,
    gateCrossed: false,
    hostelArrivalConfirmed: false,
    exitTime: null,
    hostelArrivalTime: null,
    outTime: null,
    inTime: null,
    qrUsedForSecurity: false,
    qrUsedForWarden: false,
    token: null,
    qrToken: null,
    secureUrl: null,
    qrUrl: null,
    qrImage: null,
    qrGeneratedAt: null,
    expiryDate: null,
    timeline: [
      {
        id: `TL-${Date.now()}-01`,
        stage: 'APPLIED',
        title: 'Gate Pass Applied',
        description: `Student applied for Gate Pass (${gateDate} to ${returnDate})`,
        actor: req.body.student || 'Student',
        role: 'student',
        timestamp: new Date().toISOString()
      }
    ],
    createdAt: new Date().toISOString(),
    approvedBy: '',
    approvedAt: null
  };

  data.gatePasses = Array.isArray(data.gatePasses) ? data.gatePasses : [];
  data.gatePasses.unshift(gatePass);

  const wardenNotification = createGatePassNotification(
    data,
    gatePass,
    'gate-pass-scheduled-return',
    `Expected Return: ${gatePass.student} (${returnDate})`,
    `Student ${gatePass.student} (${gatePass.registrationNumber || 'N/A'}, Room ${gatePass.roomNumber}, ${gatePass.hostelBlock}) applied for a gate pass from ${gateDate} to ${returnDate}. Expected return date: ${returnDate}. Reason: "${gatePass.reason}".`,
    'Warden'
  );

  addGatePassAudit(data, gatePass, 'Student Applied', { id: gatePass.userId, role: 'student', ip: req.ip });
  writeData(data);
  if (req.io) {
    req.io.emit('gate-pass.created', gatePass);
    req.io.emit('warden-notification.created', wardenNotification);
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
  const validStatuses = ['Pending', 'Approved', 'Rejected', 'SECURITY_PENDING', 'REJECTED'];
  if (!status || !validStatuses.map(s => s.toLowerCase()).includes(status.toLowerCase())) {
    return res.status(400).json({ error: `Status is required and must be one of: Pending, Approved, Rejected` });
  }

  const isApproval = /^(approved|security_pending)$/i.test(status);
  const isRejection = /^rejected$/i.test(status);

  gatePass.approvedBy = req.body.approvedBy || req.body.wardenName || (req.body.role === 'admin' ? (req.body.adminName || 'Admin') : 'Hostel Warden');
  gatePass.approvedAt = new Date().toISOString();
  gatePass.facultyId = req.body.facultyId || '';
  gatePass.facultyRemarks = String(req.body.remarks || '').trim();

  let createdNotification = null;
  if (isApproval) {
    gatePass.status = 'SECURITY_PENDING';
    gatePass.workflowStatus = 'SECURITY_PENDING';
    gatePass.currentStatus = 'SECURITY_PENDING';
    gatePass.certificateId = gatePass.certificateId || generateCertificateId(gatePass.id);
    gatePass.wardenApproval = {
      status: 'APPROVED',
      approvedBy: gatePass.approvedBy,
      approvedAt: gatePass.approvedAt,
      remarks: gatePass.facultyRemarks
    };
    gatePass.adminApproval = gatePass.wardenApproval;
    gatePass.securityVerification = gatePass.securityVerification || { status: 'PENDING', verifiedBy: '', verifiedAt: null, rejectionReason: '' };
    gatePass.wardenVerification = gatePass.wardenVerification || { status: 'PENDING', verifiedBy: '', verifiedAt: null, rejectionReason: '' };

    await provisionGatePassQr(gatePass, req);

    addGatePassTimelineEvent(gatePass, 'WARDEN_APPROVED', 'Warden Approved', `Gate Pass approved by ${gatePass.approvedBy}. Secure QR Certificate ${gatePass.certificateId} generated.`, gatePass.approvedBy, 'warden');
    addGatePassAudit(data, gatePass, 'Warden Approved & QR Generated', { name: gatePass.approvedBy, role: 'warden', ip: req.ip }, gatePass.facultyRemarks);

    createdNotification = createGatePassNotification(data, gatePass, 'gate-pass-approved', 'Gate Pass Approved by Warden — QR Ready', `Your gate pass ${gatePass.id} has been approved by the Warden. Your secure QR code is ready for gate security exit scanning.`);

    // Dispatch Telegram Alert if configured
    if (getTelegramConfig()) {
      try {
        const msg = formatTelegramWardenApproval({
          student: gatePass.student,
          registrationNumber: gatePass.registrationNumber,
          gatePassId: gatePass.id,
          certificateId: gatePass.certificateId,
          gateDate: gatePass.gateDate,
          returnDate: gatePass.returnDate,
          approvedBy: gatePass.approvedBy
        });
        sendTelegramMessage(msg).catch((e) => console.warn('Telegram approval alert warning:', e.message));
      } catch (err) {
        console.warn('Telegram format error:', err.message);
      }
    }
  } else if (isRejection) {
    gatePass.status = 'REJECTED';
    gatePass.workflowStatus = 'REJECTED';
    gatePass.currentStatus = 'REJECTED';
    gatePass.wardenApproval = {
      status: 'REJECTED',
      approvedBy: gatePass.approvedBy,
      approvedAt: gatePass.approvedAt,
      remarks: gatePass.facultyRemarks
    };
    gatePass.adminApproval = gatePass.wardenApproval;
    gatePass.qrImage = null;
    gatePass.token = null;
    gatePass.qrToken = null;
    gatePass.secureUrl = null;
    gatePass.qrUrl = null;
    gatePass.qrGeneratedAt = null;
    gatePass.expiryDate = null;

    addGatePassTimelineEvent(gatePass, 'WARDEN_REJECTED', 'Warden Rejected', gatePass.facultyRemarks || 'Gate pass request was rejected by warden.', gatePass.approvedBy, 'warden');
    addGatePassAudit(data, gatePass, 'Warden Rejected', { name: gatePass.approvedBy, role: 'warden', ip: req.ip }, gatePass.facultyRemarks);
    createdNotification = createGatePassNotification(data, gatePass, 'gate-pass-rejected', 'Gate Pass Request Rejected', `Your gate pass ${gatePass.id} was rejected by the Warden.${gatePass.facultyRemarks ? ` Remarks: ${gatePass.facultyRemarks}` : ''}`);
  } else {
    gatePass.status = 'PENDING_WARDEN';
    gatePass.workflowStatus = 'PENDING_WARDEN';
    gatePass.currentStatus = 'PENDING_WARDEN';
  }

  writeData(data);

  if (req.io) {
    req.io.emit('gate-pass.updated', gatePass);
    if (createdNotification) req.io.emit('student-notification.created', createdNotification);
  }

  res.json(gatePass);
});

// API names used by the QR gate-pass workflow specification.
app.post('/api/gatepass/apply', (req, res) => {
  req.url = '/api/gate-passes';
  app.handle(req, res);
});

app.post('/api/gatepass/approve', async (req, res) => {
  const id = String(req.body.id || req.body.gatePassId || req.body.passId || '').trim();
  if (!id) return res.status(400).json({ error: 'A gate pass id is required.' });

  const data = readData();
  const gatePass = (data.gatePasses || []).find((entry) => entry.id === id || String(entry.id).toLowerCase() === id.toLowerCase());
  if (!gatePass) return res.status(404).json({ error: 'Gate pass not found.' });

  gatePass.approvedBy = req.body.approvedBy || req.body.wardenName || (req.body.role === 'admin' ? (req.body.adminName || 'Admin') : 'Hostel Warden');
  gatePass.approvedAt = new Date().toISOString();
  gatePass.facultyId = req.body.facultyId || '';
  gatePass.facultyRemarks = String(req.body.remarks || '').trim();

  gatePass.status = 'SECURITY_PENDING';
  gatePass.workflowStatus = 'SECURITY_PENDING';
  gatePass.currentStatus = 'SECURITY_PENDING';
  gatePass.certificateId = gatePass.certificateId || generateCertificateId(gatePass.id);
  gatePass.wardenApproval = {
    status: 'APPROVED',
    approvedBy: gatePass.approvedBy,
    approvedAt: gatePass.approvedAt,
    remarks: gatePass.facultyRemarks
  };
  gatePass.adminApproval = gatePass.wardenApproval;
  gatePass.securityVerification = gatePass.securityVerification || { status: 'PENDING', verifiedBy: '', verifiedAt: null, rejectionReason: '' };
  gatePass.wardenVerification = gatePass.wardenVerification || { status: 'PENDING', verifiedBy: '', verifiedAt: null, rejectionReason: '' };

  await provisionGatePassQr(gatePass, req);

  addGatePassTimelineEvent(gatePass, 'WARDEN_APPROVED', 'Warden Approved', `Gate Pass approved by ${gatePass.approvedBy}. Secure QR Certificate ${gatePass.certificateId} generated.`, gatePass.approvedBy, 'warden');
  addGatePassAudit(data, gatePass, 'Warden Approved & QR Generated', { name: gatePass.approvedBy, role: 'warden', ip: req.ip }, gatePass.facultyRemarks);

  const createdNotification = createGatePassNotification(data, gatePass, 'gate-pass-approved', 'Gate Pass Approved by Warden — QR Ready', `Your gate pass ${gatePass.id} has been approved by the Warden. Your secure QR code is ready for gate security exit scanning.`);

  if (getTelegramConfig()) {
    try {
      const msg = formatTelegramWardenApproval({
        student: gatePass.student,
        registrationNumber: gatePass.registrationNumber,
        gatePassId: gatePass.id,
        certificateId: gatePass.certificateId,
        gateDate: gatePass.gateDate,
        returnDate: gatePass.returnDate,
        approvedBy: gatePass.approvedBy
      });
      sendTelegramMessage(msg).catch((e) => console.warn('Telegram approval alert warning:', e.message));
    } catch (err) {
      console.warn('Telegram format error:', err.message);
    }
  }

  writeData(data);

  if (req.io) {
    req.io.emit('gate-pass.updated', gatePass);
    if (createdNotification) req.io.emit('student-notification.created', createdNotification);
  }

  res.json({ success: true, gatePass });
});

// Unified Preview for Security or Warden QR Scan
app.post('/api/gatepass/verify-preview', (req, res) => {
  const token = String(req.body.token || req.body.qrToken || req.body.gatePassId || req.body.id || '').trim();
  const role = String(req.body.role || req.body.user?.role || 'security').toLowerCase();
  const data = readData();

  const validation = validateGatePassToken(token, data);
  if (validation.error && !validation.gatePass) {
    return res.status(400).json({ error: validation.error });
  }

  const gatePass = validation.gatePass;
  const isApproved = /^(approved|qr generated|security_pending|outside|warden_pending|outside_not_returned|completed)$/i.test(String(gatePass.status || ''));

  if (!isApproved) {
    return res.status(400).json({
      error: 'GATE_PASS_NOT_APPROVED',
      message: 'This gate pass has not been approved by the hostel warden yet.',
      gatePass
    });
  }

  if (role === 'security') {
    return res.json({
      success: true,
      phase: 'SECURITY',
      allowed: true,
      gatePass,
      message: 'Gate pass verified and ready for Security Exit review.'
    });
  }

  if (role === 'warden') {
    return res.json({
      success: true,
      phase: 'WARDEN',
      allowed: true,
      gatePass,
      message: 'Student gate pass verified. Ready for Warden Hostel Return confirmation.'
    });
  }

  res.json({ success: true, phase: 'GENERAL', allowed: true, gatePass });
});

// Security Scan Verification (Approve Exit / Reject Exit)
app.post('/api/gatepass/security/verify', (req, res) => {
  const callerRole = String(req.body.role || req.body.user?.role || '').toLowerCase();
  if (callerRole && !['security', 'admin'].includes(callerRole)) {
    return res.status(403).json({ error: 'Forbidden. Only Security Officers or Admins can perform security exit verification.' });
  }

  const token = String(req.body.token || req.body.gatePassId || req.body.id || '').trim();
  const data = readData();
  const validation = validateGatePassToken(token, data);
  if (validation.error && !validation.gatePass) {
    return res.status(400).json({ error: validation.error });
  }

  const gatePass = validation.gatePass;
  const action = String(req.body.action || 'APPROVE').toUpperCase();
  const guardName = String(req.body.guardName || req.body.securityName || req.body.user?.name || 'Gate Security Guard').trim();
  const guardId = String(req.body.guardId || req.body.user?.userId || 'SEC-001');
  const location = String(req.body.location || 'Main Campus Gate').trim();

  if (action === 'APPROVE') {
    const timestamp = new Date().toISOString();
    const isCurrentlyOut = String(gatePass.status || '').toUpperCase() === 'OUTSIDE' || String(gatePass.status || '').toUpperCase() === 'OUT';

    if (isCurrentlyOut) {
      // 🛬 STEP 4: STUDENT IS RETURNING TO COLLEGE GATE (SECURITY RETURN APPROVAL)
      gatePass.securityReturnVerified = true;
      gatePass.securityReturnVerifiedBy = guardName;
      gatePass.securityReturnVerifiedAt = timestamp;
      gatePass.returnTime = timestamp;
      gatePass.status = 'RETURNED';
      gatePass.workflowStatus = 'RETURNED';
      gatePass.currentStatus = 'RETURNED';
      gatePass.securityReturnVerification = {
        status: 'APPROVED',
        verifiedBy: guardName,
        verifiedAt: timestamp,
        rejectionReason: ''
      };

      addGatePassTimelineEvent(gatePass, 'SECURITY_RETURN_APPROVED', 'Security Gate Entry Verified', `Student entered campus gate at ${location} and verified by security. Awaiting warden hostel arrival approval.`, guardName, 'security');
      addGatePassAudit(data, gatePass, 'Security Approved Gate Entry', { id: guardId, name: guardName, role: 'security', ip: req.ip }, location);

      data.gatePassScanLogs = Array.isArray(data.gatePassScanLogs) ? data.gatePassScanLogs : [];
      data.gatePassScanLogs.unshift({
        id: `GPS-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        gatePassId: gatePass.id,
        guardId,
        guardName,
        scanTime: timestamp,
        scanType: 'IN',
        location,
        device: String(req.body.device || '').slice(0, 100),
        remarks: 'Campus gate entry verified by security officer'
      });

      createGatePassNotification(data, gatePass, 'gate-pass-returned', 'Gate Entry Verified by Security', `Your return through the campus gate was verified at ${location}. Please report to hostel warden to complete pass.`);
      createGatePassNotification(data, gatePass, 'student-returned-gate', `Student Returned to Campus: ${gatePass.student}`, `Student ${gatePass.student} (Room ${gatePass.roomNumber}) has entered through campus gate at ${new Date(timestamp).toLocaleTimeString('en-IN')}. Please verify hostel arrival.`, 'Warden');

      writeData(data);
      if (req.io) req.io.emit('gate-pass.updated', gatePass);

      return res.json({
        success: true,
        message: 'GATE ENTRY VERIFIED BY SECURITY. Student has entered campus gate. Awaiting warden hostel approval.',
        gatePass
      });
    } else {
      // 🛫 STUDENT IS LEAVING COLLEGE GATE (SECURITY EXIT APPROVAL)
      gatePass.securityVerified = true;
      gatePass.securityStatus = 'APPROVED';
      gatePass.securityName = guardName;
      gatePass.securityVerifiedAt = timestamp;
      gatePass.exitTime = timestamp;
      gatePass.outTime = timestamp;
      gatePass.gateCrossed = true;
      gatePass.qrUsedForSecurity = true;
      gatePass.status = 'OUTSIDE';
      gatePass.workflowStatus = 'OUTSIDE';
      gatePass.currentStatus = 'OUTSIDE';
      gatePass.securityVerification = {
        status: 'APPROVED',
        verifiedBy: guardName,
        verifiedAt: timestamp,
        rejectionReason: ''
      };

      addGatePassTimelineEvent(gatePass, 'SECURITY_APPROVED', 'Security Exit Approved', `Student confirmed as having crossed gate to leave college at ${location}.`, guardName, 'security');
      addGatePassAudit(data, gatePass, 'Security Approved Exit', { id: guardId, name: guardName, role: 'security', ip: req.ip }, location);

      data.gatePassScanLogs = Array.isArray(data.gatePassScanLogs) ? data.gatePassScanLogs : [];
      data.gatePassScanLogs.unshift({
        id: `GPS-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        gatePassId: gatePass.id,
        guardId,
        guardName,
        scanTime: timestamp,
        scanType: 'OUT',
        location,
        device: String(req.body.device || '').slice(0, 100),
        remarks: 'Exit verified by security officer'
      });

      createGatePassNotification(data, gatePass, 'gate-pass-out', 'Exit Verified by Security', `Your campus exit was verified at ${location}. Please return by ${gatePass.returnDate}.`);
      createGatePassNotification(data, gatePass, 'student-outside', `Student Outside: ${gatePass.student}`, `Student ${gatePass.student} (Room ${gatePass.roomNumber}) has crossed the gate at ${new Date(timestamp).toLocaleTimeString('en-IN')}.`, 'Warden');

      // Telegram Notification
      if (getTelegramConfig()) {
        try {
          const msg = formatTelegramSecurityExit({
            student: gatePass.student,
            registrationNumber: gatePass.registrationNumber,
            exitTime: timestamp,
            securityName: guardName
          });
          sendTelegramMessage(msg).catch((e) => console.warn('Telegram security exit send warning:', e.message));
        } catch (err) {
          console.warn('Telegram security format error:', err.message);
        }
      }

      writeData(data);
      if (req.io) req.io.emit('gate-pass.updated', gatePass);

      return res.json({
        success: true,
        message: 'GATE EXIT APPROVED. Student crossed gate and is now OUTSIDE campus.',
        gatePass
      });
    }
  } else {
    // REJECT EXIT
    const timestamp = new Date().toISOString();
    const rejectionReason = String(req.body.rejectionReason || req.body.reason || 'Verification rejected at security gate').trim();
    gatePass.securityVerified = false;
    gatePass.securityStatus = 'REJECTED';
    gatePass.securityName = guardName;
    gatePass.securityRejectedAt = timestamp;
    gatePass.securityRejectionReason = rejectionReason;
    gatePass.gateCrossed = false;
    gatePass.status = 'SECURITY_REJECTED';
    gatePass.workflowStatus = 'SECURITY_REJECTED';
    gatePass.currentStatus = 'SECURITY_REJECTED';
    gatePass.securityVerification = {
      status: 'REJECTED',
      verifiedBy: guardName,
      verifiedAt: timestamp,
      rejectionReason
    };

    addGatePassTimelineEvent(gatePass, 'SECURITY_REJECTED', 'Security Exit Rejected', rejectionReason, guardName, 'security');
    addGatePassAudit(data, gatePass, 'Security Rejected Exit', { id: guardId, name: guardName, role: 'security', ip: req.ip }, rejectionReason);

    createGatePassNotification(data, gatePass, 'gate-pass-rejected', 'Gate Exit Rejected', `Security rejected your gate exit. Reason: "${rejectionReason}".`);

    // Telegram Notification
    if (getTelegramConfig()) {
      try {
        const msg = formatTelegramSecurityRejection({
          student: gatePass.student,
          registrationNumber: gatePass.registrationNumber,
          securityName: guardName,
          reason: rejectionReason
        });
        sendTelegramMessage(msg).catch((e) => console.warn('Telegram security rejection send warning:', e.message));
      } catch (err) {
        console.warn('Telegram rejection format error:', err.message);
      }
    }

    writeData(data);
    if (req.io) req.io.emit('gate-pass.updated', gatePass);

    return res.json({
      success: true,
      message: 'EXIT REJECTED. Student is not permitted to cross the gate.',
      gatePass
    });
  }
});

// Warden Scan Verification (Approve Hostel Arrival / Reject Hostel Arrival)
app.post(['/api/gatepass/warden/verify', '/api/gatepass/warden/approve'], (req, res) => {
  const callerRole = String(req.body.role || req.body.user?.role || '').toLowerCase();
  if (callerRole && !['warden', 'admin'].includes(callerRole)) {
    return res.status(403).json({ error: 'Forbidden. Only Wardens or Admins can perform hostel arrival verification.' });
  }

  const token = String(req.body.token || req.body.gatePassId || req.body.id || '').trim();
  const data = readData();
  const validation = validateGatePassToken(token, data);
  if (validation.error && !validation.gatePass) {
    return res.status(400).json({ error: validation.error });
  }

  const gatePass = validation.gatePass;
  // Direct Warden return verification on approved student gate pass
  if (!gatePass.status || ['REJECTED', 'CANCELLED'].includes(String(gatePass.status).toUpperCase())) {
    return res.status(400).json({
      error: 'INVALID_GATE_PASS_STATUS',
      message: 'This gate pass is not active or has been rejected.'
    });
  }

  const action = String(req.body.action || (req.body.approved === false ? 'REJECT' : 'APPROVE')).toUpperCase();
  const wardenName = String(req.body.wardenName || req.body.user?.name || 'Hostel Warden').trim();
  const wardenId = String(req.body.wardenId || req.body.user?.userId || 'WRD-001');

  if (action === 'APPROVE') {
    const timestamp = new Date().toISOString();
    gatePass.wardenVerified = true;
    gatePass.wardenStatus = 'APPROVED';
    gatePass.wardenName = wardenName;
    gatePass.wardenVerifiedAt = timestamp;
    gatePass.hostelArrivalTime = timestamp;
    gatePass.inTime = timestamp;
    gatePass.hostelArrivalConfirmed = true;
    gatePass.qrUsedForWarden = true;
    gatePass.status = 'COMPLETED';
    gatePass.workflowStatus = 'COMPLETED';
    gatePass.currentStatus = 'COMPLETED';
    gatePass.wardenVerification = {
      status: 'APPROVED',
      verifiedBy: wardenName,
      verifiedAt: timestamp,
      remarks: String(req.body.remarks || '').trim(),
      rejectionReason: ''
    };

    addGatePassTimelineEvent(gatePass, 'WARDEN_APPROVED', 'Hostel Arrival Verified', `Student confirmed as having reached hostel block ${gatePass.hostelBlock}.`, wardenName, 'warden');
    addGatePassAudit(data, gatePass, 'Warden Approved Arrival', { id: wardenId, name: wardenName, role: 'warden', ip: req.ip }, gatePass.wardenVerification.remarks);

    createGatePassNotification(data, gatePass, 'gate-pass-completed', 'Hostel Arrival Confirmed', `Warden ${wardenName} has verified your safe arrival at hostel. Gate pass completed.`);

    // Telegram Notification
    if (getTelegramConfig()) {
      try {
        const msg = formatTelegramWardenArrival({
          student: gatePass.student,
          registrationNumber: gatePass.registrationNumber,
          arrivalTime: timestamp,
          wardenName
        });
        sendTelegramMessage(msg).catch((e) => console.warn('Telegram warden arrival send warning:', e.message));
      } catch (err) {
        console.warn('Telegram warden arrival format error:', err.message);
      }
    }

    writeData(data);
    if (req.io) req.io.emit('gate-pass.updated', gatePass);

    return res.json({
      success: true,
      message: 'HOSTEL ARRIVAL VERIFIED. Student has successfully reached the hostel.',
      gatePass
    });
  } else {
    // REJECT HOSTEL ARRIVAL -> OUTSIDE_NOT_RETURNED
    const timestamp = new Date().toISOString();
    const rejectionReason = String(req.body.rejectionReason || req.body.reason || 'Student did not arrive at hostel.').trim();
    gatePass.wardenVerified = false;
    gatePass.wardenStatus = 'REJECTED';
    gatePass.wardenName = wardenName;
    gatePass.wardenRejectedAt = timestamp;
    gatePass.hostelArrivalConfirmed = false;
    gatePass.wardenRejectionReason = rejectionReason;
    gatePass.status = 'OUTSIDE_NOT_RETURNED';
    gatePass.workflowStatus = 'OUTSIDE_NOT_RETURNED';
    gatePass.currentStatus = 'OUTSIDE_NOT_RETURNED';
    gatePass.wardenVerification = {
      status: 'REJECTED',
      verifiedBy: wardenName,
      verifiedAt: timestamp,
      rejectionReason
    };

    addGatePassTimelineEvent(gatePass, 'WARDEN_REJECTED', 'Hostel Arrival Not Confirmed', `Student crossed gate but not confirmed at hostel. Reason: ${rejectionReason}`, wardenName, 'warden');
    addGatePassAudit(data, gatePass, 'Warden Rejected Arrival', { id: wardenId, name: wardenName, role: 'warden', ip: req.ip }, rejectionReason);

    createGatePassNotification(data, gatePass, 'warden-arrival-rejected', 'Hostel Arrival Not Verified', `Hostel arrival not confirmed by warden. Please report to Warden immediately.`);

    // Telegram Notification
    if (getTelegramConfig()) {
      try {
        const msg = formatTelegramWardenRejection({
          student: gatePass.student,
          registrationNumber: gatePass.registrationNumber,
          exitTime: gatePass.exitTime || gatePass.outTime,
          wardenName,
          reason: rejectionReason
        });
        sendTelegramMessage(msg).catch((e) => console.warn('Telegram warden rejection send warning:', e.message));
      } catch (err) {
        console.warn('Telegram warden rejection format error:', err.message);
      }
    }

    writeData(data);
    if (req.io) req.io.emit('gate-pass.updated', gatePass);

    return res.json({
      success: true,
      message: 'HOSTEL ARRIVAL NOT VERIFIED. Student marked as OUTSIDE_NOT_RETURNED.',
      gatePass
    });
  }
});

// Admin Monitoring for Two-Step Gate Pass Verification
app.get('/api/gatepass/verification-monitoring', (req, res) => {
  const data = readData();
  const list = (data.gatePasses || []).map((pass) => ({
    id: pass.id,
    certificateId: pass.certificateId || '',
    student: pass.student,
    registrationNumber: pass.registrationNumber,
    hostelBlock: pass.hostelBlock,
    roomNumber: pass.roomNumber,
    reason: pass.reason,
    gateDate: pass.gateDate,
    returnDate: pass.returnDate,
    studentPhoto: pass.studentPhoto || '',
    adminStatus: pass.adminApproval?.status || (/^(approved|qr generated|security_pending|outside|warden_pending|outside_not_returned|completed)$/i.test(pass.status) ? 'APPROVED' : pass.status === 'REJECTED' ? 'REJECTED' : 'PENDING'),
    adminApprovedAt: pass.approvedAt || pass.adminApproval?.approvedAt || null,
    adminApprovedBy: pass.approvedBy || 'Admin',
    securityStatus: pass.securityVerification?.status || (pass.securityVerified ? 'APPROVED' : pass.securityStatus || 'PENDING'),
    securityVerifiedAt: pass.securityVerifiedAt || pass.exitTime || null,
    securityName: pass.securityName || pass.guardExitId || '',
    securityRejectionReason: pass.securityRejectionReason || '',
    exitTime: pass.exitTime || pass.outTime || null,
    wardenStatus: pass.wardenVerification?.status || (pass.wardenVerified ? 'APPROVED' : pass.status === 'OUTSIDE_NOT_RETURNED' ? 'REJECTED' : 'PENDING'),
    wardenVerifiedAt: pass.wardenVerifiedAt || pass.hostelArrivalTime || null,
    wardenName: pass.wardenName || '',
    wardenRejectionReason: pass.wardenRejectionReason || '',
    hostelArrivalTime: pass.hostelArrivalTime || pass.inTime || null,
    finalStatus: pass.currentStatus || pass.status || 'PENDING_ADMIN',
    gateCrossed: Boolean(pass.gateCrossed || pass.exitTime),
    hostelArrivalConfirmed: Boolean(pass.hostelArrivalConfirmed || pass.hostelArrivalTime),
    timeline: pass.timeline || []
  }));

  const metrics = {
    total: list.length,
    pendingAdmin: list.filter(p => p.adminStatus === 'PENDING').length,
    securityPending: list.filter(p => p.adminStatus === 'APPROVED' && p.securityStatus === 'PENDING').length,
    outside: list.filter(p => p.securityStatus === 'APPROVED' && p.finalStatus === 'OUTSIDE').length,
    outsideNotReturned: list.filter(p => p.finalStatus === 'OUTSIDE_NOT_RETURNED').length,
    completed: list.filter(p => p.finalStatus === 'COMPLETED').length,
    rejected: list.filter(p => ['REJECTED', 'SECURITY_REJECTED'].includes(p.finalStatus)).length
  };

  res.json({ metrics, stats: metrics, passes: list });
});

app.get('/api/gatepass/public-key', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(getPublicKeyPem());
});

app.get('/api/gatepass/history', (req, res) => {
  const data = readData();
  const userId = String(req.query.userId || '');
  res.json(userId ? (data.gatePasses || []).filter((item) => item.userId === userId) : (data.gatePasses || []));
});

app.get('/api/gatepass/verify/:id', (req, res) => {
  const data = readData();
  const gatePass = (data.gatePasses || []).find(item => item.id === req.params.id);
  if (!gatePass) return res.status(404).json({ valid: false, error: 'Gate pass not found' });
  const result = verifyGatePassSignature(gatePass);
  res.json({
    gatePassId: gatePass.id,
    certificateId: gatePass.certificateId,
    student: gatePass.student,
    valid: result.valid,
    reason: result.reason,
    signedAt: gatePass.signedAt,
    signatureFingerprint: gatePass.signatureFingerprint,
    approvedBy: gatePass.approvedBy,
    status: gatePass.status
  });
});

app.get('/api/gatepass/:id', (req, res) => {
  const data = readData();
  const gatePass = (data.gatePasses || []).find((item) => item.id === req.params.id || item.token === req.params.id);
  if (!gatePass) return res.status(404).json({ error: 'Gate pass not found.' });
  res.json({
    ...gatePass,
    scanLogs: (data.gatePassScanLogs || []).filter((log) => log.gatePassId === gatePass.id),
    auditLogs: (data.auditLogs || []).filter((log) => log.gatePassId === gatePass.id)
  });
});

// Standalone Web Verification Page (for Phone / QR Scan)
app.get(['/qr/:token', '/gatepass/verify/:token'], (req, res) => {
  const token = String(req.params.token || '').replace(/['"]/g, '');
  const data = readData();
  const validation = validateGatePassToken(token, data);
  const pass = validation.gatePass || {};
  const studentName = pass.student || 'Student';
  const regNo = pass.registrationNumber || '';
  const room = (pass.hostelBlock ? pass.hostelBlock + ' • Room ' : 'Room ') + (pass.roomNumber || 'N/A');

  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HostelFix • Two-Step Gate Pass Verification</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; }
    .glass-card { background: rgba(30, 41, 59, 0.85); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.1); }
  </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
  <div class="glass-card rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-6">
    <div class="flex items-center justify-between border-b border-slate-700/60 pb-4">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
          <i class="fa-solid fa-shield-halved"></i>
        </div>
        <div>
          <h1 class="text-lg font-bold">HostelFix Smart Gate Pass</h1>
          <p class="text-xs text-slate-400">Two-Step Gate Pass Verification Portal</p>
        </div>
      </div>
      <span id="headerBadge" class="px-3 py-1 rounded-full text-xs font-bold ${pass.id ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-300'}">${pass.status || 'Validating...'}</span>
    </div>

    <div id="loadingState" class="${pass.id ? 'hidden' : ''} py-12 text-center space-y-3">
      <i class="fa-solid fa-circle-notch fa-spin text-3xl text-indigo-400"></i>
      <p class="text-sm text-slate-400">Verifying secure QR cryptographic token...</p>
    </div>

    <div id="errorState" class="hidden py-8 text-center space-y-4">
      <div class="w-16 h-16 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto text-2xl">
        <i class="fa-solid fa-triangle-exclamation"></i>
      </div>
      <h2 id="errorTitle" class="text-base font-bold text-rose-400">Invalid or Expired QR</h2>
      <p id="errorMsg" class="text-xs text-slate-400"></p>
    </div>

    <div id="passDetails" class="${pass.id ? '' : 'hidden'} space-y-5">
      <div class="flex items-center gap-4 bg-slate-800/80 p-4 rounded-2xl border border-slate-700/50">
        <div id="studentPhotoContainer" class="w-16 h-16 rounded-2xl bg-slate-700 overflow-hidden shrink-0 border border-slate-600 flex items-center justify-center">
          ${pass.studentPhoto ? `<img src="${pass.studentPhoto}" class="w-full h-full object-cover">` : '<i class="fa-solid fa-user text-2xl text-slate-400"></i>'}
        </div>
        <div class="min-w-0 flex-1">
          <h2 id="studentName" class="text-base font-bold text-white truncate">${studentName}</h2>
          <p id="studentReg" class="text-xs text-indigo-300 font-mono">${regNo}</p>
          <p id="studentRoom" class="text-xs text-slate-400">${room}</p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="bg-slate-800/50 p-3 rounded-xl border border-slate-700/40">
          <span class="text-slate-400 block text-[10px]">Pass ID</span>
          <span id="passIdText" class="font-mono font-bold text-white">${pass.id || ''}</span>
        </div>
        <div class="bg-slate-800/50 p-3 rounded-xl border border-slate-700/40">
          <span class="text-slate-400 block text-[10px]">Certificate ID</span>
          <span id="certIdText" class="font-mono font-bold text-emerald-400 text-[11px] truncate block">${pass.certificateId || ''}</span>
        </div>
        <div class="bg-slate-800/50 p-3 rounded-xl border border-slate-700/40">
          <span class="text-slate-400 block text-[10px]">Leave Date</span>
          <span id="gateDateText" class="font-semibold text-white">${pass.gateDate || ''}</span>
        </div>
        <div class="bg-slate-800/50 p-3 rounded-xl border border-slate-700/40">
          <span class="text-slate-400 block text-[10px]">Expected Return</span>
          <span id="returnDateText" class="font-semibold text-amber-400">${pass.returnDate || ''}</span>
        </div>
      </div>

      <div id="twoStepStatusBox" class="p-3.5 rounded-2xl bg-slate-800/90 border border-slate-700 space-y-2 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-slate-400 flex items-center gap-1.5"><i class="fa-solid fa-user-shield text-indigo-400"></i> Warden Approval:</span>
          <span id="adminStatusBadge" class="font-bold text-emerald-400">Approved</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-slate-400 flex items-center gap-1.5"><i class="fa-solid fa-door-open text-blue-400"></i> Security Exit:</span>
          <span id="securityStatusBadge" class="font-bold">Pending</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-slate-400 flex items-center gap-1.5"><i class="fa-solid fa-hotel text-purple-400"></i> Warden Arrival:</span>
          <span id="wardenStatusBadge" class="font-bold">Pending</span>
        </div>
      </div>

      <div class="space-y-3 pt-2">
        <div class="flex gap-2">
          <button id="roleSecurityBtn" onclick="selectRole('security')" class="flex-1 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white shadow-sm transition-all">
            <i class="fa-solid fa-person-military-safety mr-1"></i> Security Gate Mode
          </button>
          <button id="roleWardenBtn" onclick="selectRole('warden')" class="flex-1 py-2 rounded-xl text-xs font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all">
            <i class="fa-solid fa-building-user mr-1"></i> Warden Mode
          </button>
        </div>

        <div id="securityActions" class="space-y-2">
          <button onclick="submitVerification('security', 'APPROVE')" class="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all">
            <i class="fa-solid fa-check"></i> APPROVE EXIT (Student Crossing Gate)
          </button>
          <button onclick="submitVerification('security', 'REJECT')" class="w-full py-2.5 rounded-2xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 font-semibold text-xs border border-rose-500/30 flex items-center justify-center gap-2 transition-all">
            <i class="fa-solid fa-xmark"></i> REJECT EXIT
          </button>
        </div>

        <div id="wardenActions" class="hidden space-y-2">
          <div id="wardenBlockedAlert" class="hidden p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-semibold text-center">
            <i class="fa-solid fa-triangle-exclamation mr-1"></i> Security Verification Required: Student has not been verified as having crossed the gate yet.
          </div>
          <button id="wardenApproveBtn" onclick="submitVerification('warden', 'APPROVE')" class="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all">
            <i class="fa-solid fa-hotel"></i> APPROVE HOSTEL ARRIVAL
          </button>
          <button id="wardenRejectBtn" onclick="submitVerification('warden', 'REJECT')" class="w-full py-2.5 rounded-2xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 font-semibold text-xs border border-amber-500/30 flex items-center justify-center gap-2 transition-all">
            <i class="fa-solid fa-circle-xmark"></i> REJECT HOSTEL ARRIVAL (OUTSIDE_NOT_RETURNED)
          </button>
        </div>

        <div id="completedMessage" class="hidden p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-center space-y-1">
          <i class="fa-solid fa-circle-check text-2xl text-emerald-400"></i>
          <p class="font-bold text-emerald-300 text-sm">Gate Pass Already Completed</p>
          <p class="text-xs text-slate-400">Both Security exit and Warden arrival have been successfully verified.</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    const token = '${token}';
    let currentPass = null;
    let selectedMode = 'security';

    async function loadPassPreview() {
      try {
        const res = await fetch('/api/gatepass/verify-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, role: selectedMode })
        });
        const data = await res.json();
        document.getElementById('loadingState').classList.add('hidden');

        if (!res.ok || !data.gatePass) {
          showError(data.message || data.error || 'Gate Pass not found.');
          return;
        }

        currentPass = data.gatePass;
        renderPassUI(currentPass);
      } catch (err) {
        document.getElementById('loadingState').classList.add('hidden');
        showError('Network error connecting to verification server.');
      }
    }

    function renderPassUI(pass) {
      document.getElementById('passDetails').classList.remove('hidden');
      document.getElementById('errorState').classList.add('hidden');

      document.getElementById('studentName').textContent = pass.student || 'Student';
      document.getElementById('studentReg').textContent = pass.registrationNumber || 'REG-N/A';
      document.getElementById('studentRoom').textContent = (pass.hostelBlock || 'Block A') + ' • Room ' + (pass.roomNumber || 'N/A');
      document.getElementById('passIdText').textContent = pass.id;
      document.getElementById('certIdText').textContent = pass.certificateId || 'CERT-N/A';
      document.getElementById('gateDateText').textContent = pass.gateDate || '—';
      document.getElementById('returnDateText').textContent = pass.returnDate || '—';

      if (pass.studentPhoto) {
        document.getElementById('studentPhotoContainer').innerHTML = '<img src="' + pass.studentPhoto + '" class="w-full h-full object-cover rounded-2xl">';
      }

      const secDone = pass.securityVerified || /^(outside|warden_pending|outside_not_returned|completed)$/i.test(pass.status);
      const warDone = pass.wardenVerified || pass.status === 'COMPLETED';

      document.getElementById('securityStatusBadge').innerHTML = secDone
        ? '<span class="text-emerald-400"><i class="fa-solid fa-circle-check mr-1"></i>Exit Approved</span>'
        : pass.securityStatus === 'REJECTED'
          ? '<span class="text-rose-400"><i class="fa-solid fa-circle-xmark mr-1"></i>Exit Rejected</span>'
          : '<span class="text-amber-400"><i class="fa-solid fa-clock mr-1"></i>Pending</span>';

      document.getElementById('wardenStatusBadge').innerHTML = warDone
        ? '<span class="text-emerald-400"><i class="fa-solid fa-circle-check mr-1"></i>Arrival Confirmed</span>'
        : pass.status === 'OUTSIDE_NOT_RETURNED'
          ? '<span class="text-amber-400"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Not Returned</span>'
          : '<span class="text-slate-400"><i class="fa-solid fa-clock mr-1"></i>Pending</span>';

      const headerBadge = document.getElementById('headerBadge');
      headerBadge.textContent = pass.status;
      if (pass.status === 'COMPLETED') {
        headerBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        document.getElementById('securityActions').classList.add('hidden');
        document.getElementById('wardenActions').classList.add('hidden');
        document.getElementById('completedMessage').classList.remove('hidden');
      } else if (pass.status === 'OUTSIDE') {
        headerBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30';
      }

      updateModeUI();
    }

    function selectRole(role) {
      selectedMode = role;
      const secBtn = document.getElementById('roleSecurityBtn');
      const warBtn = document.getElementById('roleWardenBtn');
      if (role === 'security') {
        secBtn.className = 'flex-1 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white shadow-sm transition-all';
        warBtn.className = 'flex-1 py-2 rounded-xl text-xs font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all';
      } else {
        warBtn.className = 'flex-1 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white shadow-sm transition-all';
        secBtn.className = 'flex-1 py-2 rounded-xl text-xs font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all';
      }
      updateModeUI();
    }

    function updateModeUI() {
      if (!currentPass || currentPass.status === 'COMPLETED') return;
      const secActions = document.getElementById('securityActions');
      const warActions = document.getElementById('wardenActions');
      const warBlock = document.getElementById('wardenBlockedAlert');
      const warApprove = document.getElementById('wardenApproveBtn');
      const warReject = document.getElementById('wardenRejectBtn');

      if (selectedMode === 'security') {
        secActions.classList.remove('hidden');
        warActions.classList.add('hidden');
      } else {
        secActions.classList.add('hidden');
        warActions.classList.remove('hidden');

        const secDone = currentPass.securityVerified || /^(outside|warden_pending|outside_not_returned|completed)$/i.test(currentPass.status);
        if (!secDone) {
          warBlock.classList.remove('hidden');
          warApprove.disabled = true;
          warApprove.classList.add('opacity-50', 'cursor-not-allowed');
          warReject.disabled = true;
          warReject.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
          warBlock.classList.add('hidden');
          warApprove.disabled = false;
          warApprove.classList.remove('opacity-50', 'cursor-not-allowed');
          warReject.disabled = false;
          warReject.classList.remove('opacity-50', 'cursor-not-allowed');
        }
      }
    }

    async function submitVerification(role, action) {
      let reason = '';
      if (action === 'REJECT') {
        reason = prompt('Please enter the reason for rejection:', role === 'security' ? 'Student details mismatch / Unauthorized' : 'Student did not arrive at hostel.');
        if (reason === null) return;
      }

      const endpoint = role === 'security' ? '/api/gatepass/security/verify' : '/api/gatepass/warden/verify';
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            action,
            role,
            rejectionReason: reason,
            guardName: 'Gate Security Guard',
            wardenName: 'Hostel Warden'
          })
        });
        const data = await res.json();
        if (!res.ok) {
          alert('Error: ' + (data.message || data.error || 'Verification failed.'));
          return;
        }
        alert(data.message || 'Verification updated successfully!');
        if (data.gatePass) {
          currentPass = data.gatePass;
          renderPassUI(currentPass);
        }
      } catch (err) {
        alert('Network error submitting verification.');
      }
    }

    function showError(msg) {
      document.getElementById('errorState').classList.remove('hidden');
      document.getElementById('errorMsg').textContent = msg;
    }

    loadPassPreview();
  </script>
</body>
</html>`);
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

app.post('/api/technicians', (req, res) => {
  const data = readData();
  const { name, email, password, specialization, phone } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  const normEmail = normalizeEmail(email);
  if (data.users.some(u => normalizeEmail(u.email) === normEmail)) {
    return res.status(409).json({ error: 'User with this email already exists' });
  }
  const technician = {
    id: `T-${Date.now().toString().slice(-4)}`,
    name: name.trim(),
    email: normEmail,
    password: password || 'tech123',
    role: 'technician',
    specialization: specialization || 'General Maintenance',
    phone: phone || '+91 98765 12345',
    status: 'Active',
    completedCount: 0,
    rating: 5.0,
    avgRepairTime: '2.5h',
    createdAt: new Date().toISOString()
  };
  data.users.push(technician);
  writeData(data);
  res.status(201).json(sanitizeUser(technician));
});

app.delete('/api/technicians/:id', (req, res) => {
  const data = readData();
  const index = data.users.findIndex(u => u.id === req.params.id && u.role === 'technician');
  if (index === -1) {
    return res.status(404).json({ error: 'Technician not found' });
  }
  data.users.splice(index, 1);
  writeData(data);
  res.json({ message: 'Technician removed successfully' });
});

app.get('/api/wardens', (req, res) => {
  const data = readData();
  const wardens = data.users.filter((user) => user.role === 'warden').map(sanitizeUser);
  res.json(wardens);
});

app.post('/api/wardens', (req, res) => {
  const data = readData();
  const { name, email, password, hostelBlock, phone } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  const normEmail = normalizeEmail(email);
  if (data.users.some(u => normalizeEmail(u.email) === normEmail)) {
    return res.status(409).json({ error: 'User with this email already exists' });
  }
  const warden = {
    id: `W-${Date.now().toString().slice(-4)}`,
    name: name.trim(),
    email: normEmail,
    password: password || 'warden123',
    role: 'warden',
    hostelBlock: hostelBlock || 'Block A',
    phone: phone || '+91 98765 43210',
    status: 'Active',
    createdAt: new Date().toISOString()
  };
  data.users.push(warden);
  writeData(data);
  res.status(201).json(sanitizeUser(warden));
});

app.put('/api/wardens/:id', (req, res) => {
  const data = readData();
  const warden = data.users.find(u => (u.id === req.params.id || normalizeEmail(u.email) === normalizeEmail(req.params.id)) && u.role === 'warden');
  if (!warden) {
    return res.status(404).json({ error: 'Warden not found' });
  }
  const { name, email, password, hostelBlock, phone, status } = req.body;
  if (name) warden.name = name.trim();
  if (email) warden.email = normalizeEmail(email);
  if (password) warden.password = password;
  if (hostelBlock) warden.hostelBlock = hostelBlock;
  if (phone) warden.phone = phone.trim();
  if (status) warden.status = status;
  
  writeData(data);
  res.json(sanitizeUser(warden));
});

app.delete('/api/wardens/:id', (req, res) => {
  const data = readData();
  const index = data.users.findIndex(u => (u.id === req.params.id || normalizeEmail(u.email) === normalizeEmail(req.params.id)) && u.role === 'warden');
  if (index === -1) {
    return res.status(404).json({ error: 'Warden not found' });
  }
  data.users.splice(index, 1);
  writeData(data);
  res.json({ message: 'Warden removed successfully' });
});

app.put('/api/technicians/:id', (req, res) => {
  const data = readData();
  const technician = data.users.find(u => (u.id === req.params.id || normalizeEmail(u.email) === normalizeEmail(req.params.id)) && u.role === 'technician');
  if (!technician) {
    return res.status(404).json({ error: 'Technician not found' });
  }
  const { name, email, password, specialization, phone, status } = req.body;
  if (name) technician.name = name.trim();
  if (email) technician.email = normalizeEmail(email);
  if (password) technician.password = password;
  if (specialization) technician.specialization = specialization;
  if (phone) technician.phone = phone.trim();
  if (status) technician.status = status;

  writeData(data);
  res.json(sanitizeUser(technician));
});

// Full Complaint Dynamic Update
app.put('/api/complaints/:id', (req, res) => {
  const data = readData();
  const complaint = data.complaints.find((c) => c.id === req.params.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  const { title, description, category, priority, roomNumber, hostelBlock, assignedTo, technician, status, notes } = req.body;
  if (title) complaint.title = title.trim();
  if (description) complaint.description = description.trim();
  if (category) complaint.category = category.trim();
  if (priority) complaint.priority = priority.trim();
  if (roomNumber) complaint.roomNumber = roomNumber.trim();
  if (hostelBlock) complaint.hostelBlock = hostelBlock.trim();
  if (assignedTo !== undefined) complaint.assignedTo = assignedTo;
  if (technician !== undefined) complaint.technician = technician;
  if (notes !== undefined) complaint.notes = notes;
  if (status) {
    complaint.status = status;
    complaint.timeline = Array.from(new Set([...(complaint.timeline || []), status]));
  }

  writeData(data);
  if (req.io) {
    req.io.emit('complaint.updated', complaint);
  }
  res.json(complaint);
});

// Dynamic Student Management
app.post('/api/students', (req, res) => {
  const data = readData();
  const { name, email, password, registrationNumber, hostelBlock, roomNumber, phone } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  const normEmail = normalizeEmail(email);
  if (data.users.some(u => normalizeEmail(u.email) === normEmail)) {
    return res.status(409).json({ error: 'Student with this email already exists' });
  }
  const student = {
    userId: generateUserId(data.users),
    name: name.trim(),
    email: normEmail,
    password: password || 'student123',
    role: 'student',
    registrationNumber: registrationNumber || `REG-${Date.now().toString().slice(-4)}`,
    hostelBlock: hostelBlock || 'Block A',
    roomNumber: roomNumber || '101',
    phone: phone || '+91 98765 00000',
    createdAt: new Date().toISOString()
  };
  data.users.push(student);
  writeData(data);
  res.status(201).json(sanitizeUser(student));
});

app.put('/api/students/:id', (req, res) => {
  const data = readData();
  const student = data.users.find(u => (u.userId === req.params.id || u.id === req.params.id || normalizeEmail(u.email) === normalizeEmail(req.params.id)) && u.role === 'student');
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  const { name, email, password, registrationNumber, hostelBlock, roomNumber, phone } = req.body;
  if (name) student.name = name.trim();
  if (email) student.email = normalizeEmail(email);
  if (password) student.password = password;
  if (registrationNumber) student.registrationNumber = registrationNumber.trim();
  if (hostelBlock) student.hostelBlock = hostelBlock.trim();
  if (roomNumber) student.roomNumber = roomNumber.trim();
  if (phone) student.phone = phone.trim();

  writeData(data);
  res.json(sanitizeUser(student));
});

app.delete('/api/students/:id', (req, res) => {
  const data = readData();
  const index = data.users.findIndex(u => (u.userId === req.params.id || u.id === req.params.id || normalizeEmail(u.email) === normalizeEmail(req.params.id)) && u.role === 'student');
  if (index === -1) {
    return res.status(404).json({ error: 'Student not found' });
  }
  data.users.splice(index, 1);
  writeData(data);
  res.json({ message: 'Student removed successfully' });
});

// Generic User Dynamic Update & Delete
app.put('/api/users/:id', (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.userId === req.params.id || u.id === req.params.id || normalizeEmail(u.email) === normalizeEmail(req.params.id));
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  const fields = ['name', 'email', 'phone', 'hostelBlock', 'roomNumber', 'registrationNumber', 'specialization', 'status', 'role', 'password'];
  fields.forEach(f => {
    if (req.body[f] !== undefined) {
      if (f === 'email') user.email = normalizeEmail(req.body.email);
      else user[f] = req.body[f];
    }
  });
  writeData(data);
  res.json(sanitizeUser(user));
});

app.delete('/api/users/:id', (req, res) => {
  const data = readData();
  const index = data.users.findIndex(u => u.userId === req.params.id || u.id === req.params.id || normalizeEmail(u.email) === normalizeEmail(req.params.id));
  if (index === -1) {
    return res.status(404).json({ error: 'User not found' });
  }
  data.users.splice(index, 1);
  writeData(data);
  res.json({ message: 'User deleted successfully' });
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
  const config = getTelegramConfig(data.adminSettings);
  res.json({
    ...data.adminSettings,
    telegramConfigured: Boolean(config),
    telegramChatId: data.adminSettings?.telegramChatId || process.env.TELEGRAM_CHAT_ID || '',
    telegramBotToken: data.adminSettings?.telegramBotToken ? (data.adminSettings.telegramBotToken.slice(0, 6) + '...' + data.adminSettings.telegramBotToken.slice(-4)) : (process.env.TELEGRAM_BOT_TOKEN ? (process.env.TELEGRAM_BOT_TOKEN.slice(0, 6) + '...' + process.env.TELEGRAM_BOT_TOKEN.slice(-4)) : '')
  });
});

app.put('/api/admin-settings', (req, res) => {
  const data = readData();
  const alertMinConfidence = Math.min(99, Math.max(1, Math.round(Number(req.body.alertMinConfidence ?? data.adminSettings.alertMinConfidence ?? 50) || 50)));
  const updatedSettings = {
    ...data.adminSettings,
    alertCameraName: String(req.body.alertCameraName || data.adminSettings.alertCameraName || 'Hostel CCTV Camera 3').trim(),
    alertCameraLocation: String(req.body.alertCameraLocation || data.adminSettings.alertCameraLocation || 'Block A - Ground Floor').trim(),
    alertMinConfidence
  };

  if (req.body.telegramBotToken !== undefined && !String(req.body.telegramBotToken).includes('...')) {
    updatedSettings.telegramBotToken = String(req.body.telegramBotToken || '').trim();
  }
  if (req.body.telegramChatId !== undefined) {
    updatedSettings.telegramChatId = String(req.body.telegramChatId || '').trim();
  }

  data.adminSettings = updatedSettings;
  writeData(data);

  const config = getTelegramConfig(data.adminSettings);
  res.json({
    ...data.adminSettings,
    telegramConfigured: Boolean(config),
    telegramChatId: data.adminSettings?.telegramChatId || process.env.TELEGRAM_CHAT_ID || '',
    telegramBotToken: data.adminSettings?.telegramBotToken ? (data.adminSettings.telegramBotToken.slice(0, 6) + '...' + data.adminSettings.telegramBotToken.slice(-4)) : (process.env.TELEGRAM_BOT_TOKEN ? (process.env.TELEGRAM_BOT_TOKEN.slice(0, 6) + '...' + process.env.TELEGRAM_BOT_TOKEN.slice(-4)) : '')
  });
});

app.post('/api/test-telegram-alert', async (req, res) => {
  try {
    const data = readData();
    const testConfig = {
      telegramBotToken: req.body.telegramBotToken && !req.body.telegramBotToken.includes('...') ? req.body.telegramBotToken : data.adminSettings?.telegramBotToken,
      telegramChatId: req.body.telegramChatId || data.adminSettings?.telegramChatId
    };
    const result = await testTelegramConnection(testConfig);
    res.json(result);
  } catch (error) {
    console.error('Telegram test failed:', error.message);
    res.status(400).json({ error: error.message || 'Telegram test failed. Please verify Bot Token and Chat ID.' });
  }
});

app.get('/api/alert-history', (req, res) => {
  const data = readData();
  const history = Array.isArray(data.alertHistory) ? data.alertHistory : [];
  res.json(history.slice().sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt)));
});

app.get('/api/telegram-status', (req, res) => {
  const data = readData();
  res.json({ configured: Boolean(getTelegramConfig(data.adminSettings)) });
});

// ==========================================
// ANNOUNCEMENTS & STUDENT NOTIFICATIONS API (SUPABASE BACKED)
// ==========================================
app.get('/api/announcements', async (req, res) => {
  try {
    const { announcementRepository } = require('./repositories');
    const announcements = await announcementRepository.getAll();
    if (announcements && announcements.length > 0) {
      return res.json(announcements);
    }
  } catch (err) {
    console.warn('[Announcements] Supabase fetch fallback to local:', err.message);
  }
  const data = readData();
  const list = Array.isArray(data.announcements) ? data.announcements : [];
  res.json(list.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
});

app.get('/api/student-notifications', async (req, res) => {
  const { email, block, targetEmail } = req.query;
  const filterEmail = String(email || targetEmail || '').trim().toLowerCase();
  const filterBlock = String(block || '').trim().toLowerCase();

  try {
    const { announcementRepository } = require('./repositories');
    const all = await announcementRepository.getAll();
    if (all && all.length > 0) {
      const filtered = all.filter(a => {
        const aud = String(a.audience || '').toLowerCase();
        if (aud === 'all students' || aud === 'all') return true;
        if (filterBlock && aud.includes(filterBlock)) return true;
        if (filterEmail && a.targetEmail && a.targetEmail.toLowerCase() === filterEmail) return true;
        return false;
      });
      return res.json(filtered);
    }
  } catch (err) {
    console.warn('[Student Notifications] Supabase fetch fallback to local:', err.message);
  }

  const data = readData();
  const list = Array.isArray(data.announcements) ? data.announcements : [];
  const filtered = list.filter(a => {
    const aud = String(a.audience || '').toLowerCase();
    if (aud === 'all students' || aud === 'all') return true;
    if (filterBlock && aud.includes(filterBlock)) return true;
    if (filterEmail && a.targetEmail && a.targetEmail.toLowerCase() === filterEmail) return true;
    return false;
  });
  res.json(filtered.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
});

app.post('/api/announcements', async (req, res) => {
  const { title, message, priority, audience, adminName, targetEmail } = req.body;
  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required.' });
  }

  const announcementPayload = {
    id: `ANN-${Date.now()}`,
    title: String(title).trim(),
    message: String(message).trim(),
    priority: ['Normal', 'Important', 'Emergency'].includes(priority) ? priority : 'Normal',
    audience: audience || 'All Students',
    adminName: adminName || 'Hostel Administration',
    targetEmail: targetEmail || '',
    createdAt: new Date().toISOString()
  };

  // 1. Persist to Supabase
  let savedAnnouncement = null;
  try {
    const { announcementRepository } = require('./repositories');
    savedAnnouncement = await announcementRepository.create(announcementPayload);
  } catch (err) {
    console.warn('[Announcements] Supabase insert fallback to local:', err.message);
  }

  // 2. Persist to local db.json for backup
  const data = readData();
  data.announcements = Array.isArray(data.announcements) ? data.announcements : [];
  data.announcements.unshift(savedAnnouncement || announcementPayload);
  writeData(data);

  const finalAnnouncement = savedAnnouncement || announcementPayload;

  // 3. Emit real-time Socket.IO event to all connected clients
  io.emit('announcement.created', finalAnnouncement);

  res.status(201).json(finalAnnouncement);
});

app.delete('/api/announcements/:id', async (req, res) => {
  const data = readData();
  const id = req.params.id;
  const idx = (data.announcements || []).findIndex(a => a.id === id);
  if (idx !== -1) {
    data.announcements.splice(idx, 1);
    writeData(data);
  }
  try {
    const { getSupabaseClient } = require('./repositories/supabaseClient');
    const client = getSupabaseClient();
    if (client) {
      await client.from('announcements').delete().eq('id', id);
    }
  } catch (e) {
    // silent
  }
  res.json({ success: true, message: 'Announcement deleted successfully' });
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

  // Always set cooldown to prevent tight loop retries from frontend frames
  alertCooldowns.set(cooldownKey, Date.now());

  const createdAt = new Date();
  const timestamp = createdAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const alertId = `ALT-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
  let snapshot;
  try {
    snapshot = saveAlertSnapshot(req.body.image, alertId);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const telegramConfig = getTelegramConfig(data.adminSettings);
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
    telegramStatus: telegramConfig ? 'Pending' : 'Not Configured',
    telegramMessageId: null,
    status: telegramConfig ? 'Pending' : 'Logged'
  };

  if (!telegramConfig) {
    data.alertHistory = Array.isArray(data.alertHistory) ? data.alertHistory : [];
    data.alertHistory.push(alert);
    writeData(data);
    io.emit('emergency-alert', alert);
    return res.status(200).json({
      success: true,
      message: 'Emergency alert logged locally. Telegram is not configured in Admin Settings.',
      alert,
      telegramConfigured: false
    });
  }

  try {
    const telegram = await sendTelegramAlert({
      alertType: alert.detectionType,
      confidence,
      cameraName: camera,
      location,
      imagePath: snapshot.diskPath,
      timestamp,
      customConfig: data.adminSettings
    });
    alert.telegramStatus = 'Sent';
    alert.telegramMessageId = telegram.messageId;
    alert.status = 'Sent';
    alert.message = telegram.message;
    data.alertHistory = Array.isArray(data.alertHistory) ? data.alertHistory : [];
    data.alertHistory.push(alert);
    writeData(data);
    io.emit('emergency-alert', alert);
    return res.status(201).json({ message: 'Telegram emergency alert sent successfully.', alert, telegramConfigured: true });
  } catch (error) {
    alert.telegramStatus = 'Failed';
    alert.status = 'Failed';
    alert.error = error.message;
    data.alertHistory = Array.isArray(data.alertHistory) ? data.alertHistory : [];
    data.alertHistory.push(alert);
    writeData(data);
    io.emit('emergency-alert', alert);
    console.error('Telegram emergency alert delivery failed:', error.message);
    return res.status(200).json({
      success: false,
      warning: `Alert logged locally, but Telegram delivery failed: ${error.message}`,
      alert,
      telegramConfigured: true
    });
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
  const data = readData();
  const gatePass = (data.gatePasses || []).find(item => item.id === req.params.id);
  if (!gatePass) return res.status(404).json({ error: 'Gate pass not found' });
  try {
    const pdfBuffer = await createLeaveAuthorizationCertificate(gatePass);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Leave-Auth-${gatePass.id}.pdf"`);
    res.end(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate certificate' });
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

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Image payload is too large. Please try again with a smaller frame.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

const port = process.env.PORT || 5000;

if (require.main === module) {
  server.listen(port, async () => {
    console.log(`HostelFix Server is running at http://localhost:${port}`);
    try {
      const { isSupabaseHealthy } = require('./repositories/supabaseClient');
      const connected = await isSupabaseHealthy();
      console.log(connected ? '✅ Supabase connected' : 'ℹ️ Using local data storage');
    } catch (e) {
      // safe fallback
    }
  });
}

module.exports = app;
module.exports.server = server;
module.exports.io = io;