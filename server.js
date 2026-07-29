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
    data.adminSettings = { alertCameraName: 'Hostel CCTV Camera 3', alertCameraLocation: 'Block A - Ground Floor' };
    changed = true;
  }
  if (!data.adminSettings.alertCameraLocation) {
    data.adminSettings.alertCameraLocation = 'Block A - Ground Floor';
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
  data.adminSettings = {
    ...data.adminSettings,
    alertCameraName: String(req.body.alertCameraName || data.adminSettings.alertCameraName || 'Hostel CCTV Camera 3').trim(),
    alertCameraLocation: String(req.body.alertCameraLocation || data.adminSettings.alertCameraLocation || 'Block A - Ground Floor').trim()
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

  if (!['fire', 'smoke'].includes(type) || !Number.isFinite(confidence) || confidence < 80 || !camera || !location) {
    return res.status(400).json({ error: 'type (Fire or Smoke), confidence (80 or higher), camera, and location are required.' });
  }

  const data = readData();
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
      const request = cctvInferenceRequests.shift();
      if (!request) return;
      try {
        const payload = JSON.parse(line);
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

function runCCTVInference(image) {
  const modelPath = getCCTVModelPath();
  const crowdModelPath = getCrowdModelPath();
  if (!modelPath || !crowdModelPath) {
    return Promise.reject(new Error('Inference models are missing. Place best.pt and yolo11n.pt inside /models.'));
  }

  const inferenceProcess = startCCTVInferenceProcess(modelPath, crowdModelPath);
  return new Promise((resolve, reject) => {
    cctvInferenceRequests.push({ resolve, reject });
    inferenceProcess.stdin.write(`${JSON.stringify({ image })}\n`, (error) => {
      if (!error) return;
      const requestIndex = cctvInferenceRequests.findIndex((request) => request.resolve === resolve);
      if (requestIndex >= 0) cctvInferenceRequests.splice(requestIndex, 1);
      reject(error);
    });
  });
}

app.post('/api/cctv-inference', async (req, res) => {
  const image = req.body.image;
  if (!image) {
    return res.status(400).json({ error: 'Image data is required for CCTV inference.' });
  }

  try {
    const result = await runCCTVInference(image);
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
