const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const compression = require('compression');
const { spawn } = require('child_process');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const { getTelegramConfig, sendTelegramAlert } = require('./telegram_service');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'db.json');
const ALERT_IMAGES_DIR = path.join(DATA_DIR, 'alert-images');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAIN_HTML = path.join(__dirname, 'index.html');

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
const ALERT_COOLDOWN_MS = 60 * 1000;
const alertCooldowns = new Map();
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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
      announcements: []
    };
    fs.writeFileSync(DATA_PATH, JSON.stringify(initialData, null, 2), 'utf8');
  }
}

function readData() {
  ensureDataStore();
  const raw = fs.readFileSync(DATA_PATH, 'utf8').replace(/^\uFEFF/, '');
  const data = JSON.parse(raw);

  if (ensureUserIds(data) || ensureAlertData(data)) {
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

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
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
  return changed;
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
  return `GP-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
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

app.post('/api/announcements', (req, res) => {
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

  if (req.io) {
    req.io.emit('announcement.created', announcement);
  }

  res.status(201).json(announcement);
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

app.get('/api/gate-passes', (req, res) => {
  const data = readData();
  res.json(data.gatePasses || []);
});

app.post('/api/gate-passes', (req, res) => {
  const data = readData();
  const gatePass = {
    id: generateGatePassId(),
    student: req.body.student || 'Anonymous',
    email: normalizeEmail(req.body.email),
    registrationNumber: req.body.registrationNumber || '',
    hostelBlock: req.body.hostelBlock || 'Unknown',
    roomNumber: req.body.roomNumber || 'Unknown',
    reason: req.body.reason || 'General',
    session: req.body.session || 'Morning',
    gateDate: req.body.gateDate || new Date().toISOString().split('T')[0],
    status: 'Pending',
    createdAt: new Date().toISOString(),
    approvedBy: '',
    approvedAt: null
  };

  data.gatePasses = Array.isArray(data.gatePasses) ? data.gatePasses : [];
  data.gatePasses.unshift(gatePass);
  writeData(data);
  res.status(201).json(gatePass);
});

app.put('/api/gate-passes/:id/status', (req, res) => {
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

  gatePass.status = status;
  gatePass.approvedBy = req.body.approvedBy || 'Admin';
  gatePass.approvedAt = new Date().toISOString();
  writeData(data);
  res.json(gatePass);
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
  complaint.timeline = Array.from(new Set([...complaint.timeline, status]));
  writeData(data);
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

async function sendTelegramEmergencyAlert(req, res) {
  const type = String(req.body.type || '').trim().toLowerCase();
  const confidenceValue = Number(req.body.confidence);
  const confidence = confidenceValue <= 1 ? Math.round(confidenceValue * 100) : Math.round(confidenceValue);
  const camera = String(req.body.camera || 'Hostel CCTV Camera 3').trim();
  const location = String(req.body.location || 'Hostel CCTV Location').trim();
  const data = readData();
  const minConfidence = Math.min(99, Math.max(1, Math.round(Number(data.adminSettings?.alertMinConfidence ?? 50) || 50)));

  if (!['fire', 'smoke'].includes(type) || !Number.isFinite(confidence) || confidence < minConfidence || !camera || !location) {
    return res.status(400).json({ error: `type (Fire or Smoke), confidence (${minConfidence} or higher), camera, and location are required.` });
  }

  const cooldownKey = camera.toLowerCase();
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
    detectionType: type === 'fire' ? 'Fire' : 'Smoke',
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
