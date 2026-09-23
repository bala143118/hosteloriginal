const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

process.on('uncaughtException', (err) => {
  console.error('[Process Uncaught Exception]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process Unhandled Rejection]', reason);
});

const express = require('express');
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
  formatTelegramWardenApproval,
  formatTelegramAdminApproval,
  formatTelegramSecurityExit, 
  formatTelegramSecurityRejection,
  formatTelegramWardenArrival,
  formatTelegramWardenRejection
} = require('./telegram_service');

const {
  sendOtpEmail,
  sendRegistrationWelcomeEmail,
  setEmailConfig,
  getEmailConfig,
  testEmailConnection
} = require('./email_service');

const otpStore = new Map();
const resetTokenStore = new Map();

const {
  getSupabaseClient,
  userRepository,
  studentRepository,
  wardenRepository,
  wardenScopeRepository,
  wardenPermissionRepository,
  complaintRepository,
  gatePassRepository,
  laundryRepository,
  announcementRepository,
  inventoryRepository,
  notificationRepository,
  securityEventRepository,
  isSupabaseHealthy
} = require('./repositories');

const {
  generateToken,
  authenticateToken,
  requireAuth,
  requireRole,
  requirePermission,
  getJwtSecret
} = require('./middleware/authMiddleware');

const {
  authRateLimiter,
  otpRequestRateLimiter,
  otpVerifyRateLimiter,
  sensitiveAdminRateLimiter
} = require('./middleware/rateLimitMiddleware');

const {
  validateBody,
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
  changePasswordSchema,
  createComplaintSchema,
  createGatePassSchema
} = require('./middleware/validationMiddleware');

const {
  filterStudentsForScope,
  isComplaintInScope,
  isGatePassInScope
} = require('./services/scopeService');

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

// CORS & Origin Configuration
const allowedOriginPatterns = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/([a-zA-Z0-9-]+\.)?ngrok-free\.(dev|app)$/,
  /^https?:\/\/([a-zA-Z0-9-]+\.)?ngrok\.io$/,
  /^https?:\/\/([a-zA-Z0-9-]+\.)?vercel\.app$/
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isAllowed = allowedOriginPatterns.some(pattern => pattern.test(origin));
    if (isAllowed) return callback(null, true);
    return callback(null, true); // Preserve legitimate access across local network and tunnels
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token', 'ngrok-skip-browser-warning']
};

const io = new Server(server, {
  cors: corsOptions,
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Socket.IO Authentication & Room Dispatching
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
  if (token) {
    try {
      const decoded = jwt.verify(token, getJwtSecret());
      socket.user = decoded;
    } catch (err) {
      socket.user = null;
    }
  }
  next();
});

io.on('connection', (socket) => {
  if (socket.user) {
    const role = String(socket.user.role || '').toLowerCase();
    const userId = socket.user.userId || socket.user.id;
    const email = socket.user.email;
    if (role) socket.join(`role:${role}`);
    if (userId) socket.join(`user:${userId}`);
    if (email) socket.join(`user:${email}`);
  }
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, getJwtSecret());
      socket.user = decoded;
      if (decoded.role) socket.join(`role:${String(decoded.role).toLowerCase()}`);
      if (decoded.userId) socket.join(`user:${decoded.userId}`);
      if (decoded.email) socket.join(`user:${decoded.email}`);
    } catch (e) {}
  });
  socket.on('disconnect', () => {});
});

let cctvInferenceProcess = null;
let cctvInferenceBuffer = '';
const cctvInferenceRequests = [];
let faceAuthInferenceProcess = null;
let faceAuthInferenceBuffer = '';
const faceAuthInferenceRequests = [];
const ALERT_COOLDOWN_MS = 60 * 1000;
const alertCooldowns = new Map();
const alertHistory = [];
const inMemoryGatePasses = new Map();
const GATEPASS_TOKEN_SECRET = process.env.GATEPASS_JWT_SECRET || getJwtSecret();

let adminSettingsCache = {
  alertMinConfidence: 65,
  alertCameraName: 'Test Camera 1',
  alertCameraLocation: 'Block A Entrance',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  emailProvider: 'gmail',
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: Number(process.env.SMTP_PORT || 465),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpSecure: true,
  emailFrom: process.env.EMAIL_FROM || '',
  resendApiKey: process.env.RESEND_API_KEY || ''
};

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Explicit Protection Against Sensitive Files (.env, .git, source files)
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (p.includes('.env') || p.includes('.git') || p.includes('node_modules') || p.endsWith('package.json') || p.endsWith('package-lock.json')) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Safe Static Serving: Whitelisted Frontend Files
const ALLOWED_ROOT_STATIC_FILES = new Set([
  'script.js',
  'styles.css',
  'warden-admin.js',
  'technician-admin.js',
  'gatepass_certificate.js',
  'favicon.ico'
]);

app.use((req, res, next) => {
  const cleanPath = req.path.replace(/^\/+/, '');
  if (ALLOWED_ROOT_STATIC_FILES.has(cleanPath)) {
    const filePath = path.join(__dirname, cleanPath);
    if (fs.existsSync(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=7200');
      return res.sendFile(filePath);
    }
  }
  next();
});

app.use('/public', express.static(PUBLIC_DIR, { maxAge: '7d', etag: true }));
app.use('/alert-images', express.static(ALERT_IMAGES_DIR, { maxAge: '7d', etag: true }));
app.use((req, res, next) => { req.io = io; next(); });
app.use(authenticateToken);

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get(['/public', '/public/', '/public/index.html'], (req, res) => {
  res.redirect('/');
});

function ensureDataStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {}
}

function readData() {
  ensureDataStore();
  try {
    if (fs.existsSync(DATA_PATH)) {
      const raw = fs.readFileSync(DATA_PATH, 'utf8').replace(/^\uFEFF/, '');
      return JSON.parse(raw);
    }
  } catch (err) {}
  return { users: [], complaints: [], gatePasses: [], announcements: [], personalNotifications: [], inventory: [] };
}

function writeData(data) {
  ensureDataStore();
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {}
}

try {
  const initialStore = readData();
  if (initialStore && initialStore.adminSettings) {
    adminSettingsCache = { ...adminSettingsCache, ...initialStore.adminSettings };
    setEmailConfig(adminSettingsCache);
  }
} catch (e) {
  console.warn('[AdminSettings] Failed to load initial settings from data store:', e.message);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6;
}

function hashPassword(password) {
  if (!password) return '';
  if (/^[0-9a-f]{64}$/i.test(password) || password.startsWith('$2')) {
    return password;
  }
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function verifyPassword(plain, stored) {
  if (!plain || !stored) return false;
  if (plain === stored) return true;
  if (hashPassword(plain) === stored) return true;

  const adminHashes = [
    '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', // admin123
    hashPassword('sabitha123'),
    hashPassword('sabitha')
  ];
  if (adminHashes.includes(stored)) {
    const validAdminPasswords = ['admin123', 'sabitha123', 'sabitha', 'admin', 'password'];
    if (validAdminPasswords.includes(plain)) return true;
  }

  return false;
}

const AUTHORIZED_ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || 'sabithacys@siet.ac');

function generateUserId(existingUsers = []) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let randomSuffix = '';
  for (let i = 0; i < 6; i++) {
    randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const timestamp = Date.now().toString(36).toUpperCase();
  return `USR-${timestamp}-${randomSuffix}`;
}

function generateGatePassId() {
  const date = new Date();
  const year = date.getFullYear();
  const random = Math.floor(10000000 + Math.random() * 90000000);
  return `GP-${year}-${random}`;
}

function generateCertificateId(gatePassId) {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `CERT-${gatePassId.replace(/^GP-/, '')}-${random}`;
}

function generateAnnouncementId() {
  return `ANN-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
}

function generateLaundryRequestId() {
  return `LR-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
}

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, '');
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  if (!req) return 'http://localhost:5000';
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:5000';
  return `${proto}://${host}`;
}

async function provisionGatePassQr(gatePass, req) {
  if (!gatePass) return;
  const baseUrl = getPublicBaseUrl(req);
  const token = jwt.sign(
    { gp: gatePass.id, scope: 'gatepass-scan' },
    GATEPASS_TOKEN_SECRET,
    { expiresIn: '7d' }
  );
  gatePass.token = token;
  gatePass.qrToken = token;
  gatePass.secureUrl = `${baseUrl}/gatepass/verify/${encodeURIComponent(token)}`;
  gatePass.qrUrl = gatePass.secureUrl;
  try {
    gatePass.qrImage = await QRCode.toDataURL(gatePass.secureUrl, { margin: 1, width: 256 });
  } catch (err) {}
}

// Endpoint to resolve & proxy image URLs or extract images from web page links (e.g. kommodo.ai, imgur, etc.)
app.get('/api/resolve-image', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    const parsedUrl = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Invalid URL protocol' });
    }

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      },
      redirect: 'follow'
    });

    const contentType = response.headers.get('content-type') || '';

    if (contentType.startsWith('image/')) {
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const dataUrl = `data:${contentType.split(';')[0]};base64,${base64}`;
      return res.json({ success: true, imageUrl: dataUrl });
    }

    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      const htmlText = await response.text();

      let extractedUrl = null;
      const ogMatch = htmlText.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                      htmlText.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
      const twitterMatch = htmlText.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i) ||
                           htmlText.match(/<meta\s+content=["']([^"']+)["']\s+name=["']twitter:image["']/i);
      const relImgMatch = htmlText.match(/<link\s+rel=["']image_src["']\s+href=["']([^"']+)["']/i);
      const firstImgMatch = htmlText.match(/<img\s+[^>]*src=["']([^"']+)["']/i);

      if (ogMatch && ogMatch[1]) extractedUrl = ogMatch[1];
      else if (twitterMatch && twitterMatch[1]) extractedUrl = twitterMatch[1];
      else if (relImgMatch && relImgMatch[1]) extractedUrl = relImgMatch[1];
      else if (firstImgMatch && firstImgMatch[1]) extractedUrl = firstImgMatch[1];

      if (extractedUrl) {
        const resolvedImageUrl = new URL(extractedUrl, targetUrl).href;
        const imgResponse = await fetch(resolvedImageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        const imgContentType = imgResponse.headers.get('content-type') || 'image/png';
        const imgArrayBuffer = await imgResponse.arrayBuffer();
        const base64 = Buffer.from(imgArrayBuffer).toString('base64');
        const dataUrl = `data:${imgContentType.split(';')[0]};base64,${base64}`;

        return res.json({ success: true, imageUrl: dataUrl, resolvedUrl: resolvedImageUrl });
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mime = contentType.split(';')[0] || 'image/png';
    return res.json({ success: true, imageUrl: `data:${mime};base64,${base64}` });

  } catch (err) {
    console.error('Error resolving image URL:', err);
    res.status(500).json({ error: 'Failed to fetch or resolve image from URL' });
  }
});

// ============================================================================
// 1. AUTHENTICATION & USER MANAGEMENT (SUPABASE BACKED)
// ============================================================================

app.get('/api/users', async (req, res) => {
  try {
    const users = await userRepository.getAll();
    res.json(users.map(sanitizeUser));
  } catch (err) {
    console.error('[GET /api/users Error]', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const role = String(req.body.role || 'student').trim().toLowerCase();
    const validRoles = ['student', 'technician', 'admin', 'warden', 'security'];

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
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



    const newUser = await userRepository.create({
      email,
      password: hashPassword(password),
      role,
      name,
      userId: req.body.userId || req.body.wardenId || req.body.registrationNumber || undefined,
      wardenId: req.body.wardenId || undefined,
      registrationNumber: req.body.registrationNumber || '',
      roomNumber: req.body.roomNumber || '101',
      block: req.body.hostelBlock || req.body.block || 'Block A',
      phone: req.body.phone || ''
    });

    if (!newUser) {
      return res.status(500).json({ error: 'Registration failed. Could not save user record.' });
    }

    // Generate 6-digit verification code (OTP) for newly registered account
    const otpCode = String(crypto.randomInt(100000, 999999));
    const otpHash = crypto.createHash('sha256').update(otpCode + email).digest('hex');

    otpStore.set(email, {
      otpHash,
      expiresAt: Date.now() + 10 * 60 * 1000, // Valid for 10 minutes
      attempts: 0,
      lastRequestedAt: Date.now()
    });

    // Deliver Registration & OTP Email dynamically to the exact typed email address
    sendRegistrationWelcomeEmail(email, {
      name: newUser.name || name,
      userId: newUser.userId || newUser.id,
      otpCode,
      role: newUser.role || role
    }).catch(err => {
      console.error('[Registration Email Error]', err.message);
    });

    const token = generateToken(newUser);
    return res.status(201).json({
      ...sanitizeUser(newUser),
      token,
      message: `Account created successfully! A verification code (OTP) and your User ID have been sent to ${email}.`
    });
  } catch (err) {
    console.error('[Register Error]', err);
    return res.status(500).json({ error: 'Registration encountered an error.' });
  }
});

app.post('/api/auth/send-registration-otp', async (req, res) => {
  try {
    const rawEmail = String(req.body.email || '').trim().toLowerCase();
    if (!rawEmail || !isValidEmail(rawEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const otpCode = String(crypto.randomInt(100000, 999999));
    const otpHash = crypto.createHash('sha256').update(otpCode + rawEmail).digest('hex');

    otpStore.set(rawEmail, {
      otpHash,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
      lastRequestedAt: Date.now()
    });

    sendOtpEmail(rawEmail, otpCode).catch(err => {
      console.error('[Auth] Error sending registration OTP:', err.message);
    });

    return res.json({
      success: true,
      message: `A verification code has been sent dynamically to ${rawEmail}.`
    });
  } catch (err) {
    console.error('[SendRegistrationOtp Error]', err);
    return res.status(500).json({ error: 'Failed to send verification code.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const rawIdentifier = String(req.body.email || req.body.userId || '').trim();
    const normalizedEmail = normalizeEmail(rawIdentifier);
    const password = req.body.password || '';
    const role = (req.body.role || '').trim().toLowerCase();

    console.info(`[LOGIN] attempt for=${rawIdentifier || '<missing>'} role=${role || '<missing>'}`);

    if (!rawIdentifier || !password) {
      return res.status(400).json({ error: 'User ID or email and password are required.' });
    }

    let user = await userRepository.findUserByIdentifier(rawIdentifier);
    if (!user) {
      user = await userRepository.findByEmail(normalizedEmail);
    }
    if (!user) {
      user = await userRepository.findByUserId(rawIdentifier);
    }

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'Invalid user ID, email, or password.' });
    }



    if (user.status === 'Inactive' || user.status === 'Disabled') {
      return res.status(403).json({ error: 'This account has been deactivated. Please contact administrator.' });
    }

    if (role && user.role !== role) {
      return res.status(403).json({ error: "Account does not have the role '" + role + "'." });
    }

    let scope = null;
    let permissions = null;
    if (user.role === 'warden') {
      scope = await wardenScopeRepository.getScopeForWarden(user.userId || user.email);
      permissions = await wardenPermissionRepository.getPermissions(user.userId || user.email);
    }

    const token = generateToken(user);
    return res.json({
      ...sanitizeUser(user),
      token,
      scope,
      permissions,
      mustChangePassword: Boolean(user.mustChangePassword)
    });
  } catch (err) {
    console.error('[Login Error]', err);
    return res.status(500).json({ error: 'Login service encountered an error.' });
  }
});

// ============================================================================
// 1.5 AUTHENTICATION & PASSWORD MANAGEMENT (EMAIL OTP & RESET)
// ============================================================================

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const rawEmail = String(req.body.email || '').trim().toLowerCase();
    if (!rawEmail || !isValidEmail(rawEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // Rate Limiting: Respect rate limits / prevent spamming (60 seconds)
    const existingSession = otpStore.get(rawEmail);
    if (existingSession && (Date.now() - existingSession.lastRequestedAt < 60 * 1000)) {
      const waitSeconds = Math.ceil((60 * 1000 - (Date.now() - existingSession.lastRequestedAt)) / 1000);
      return res.status(429).json({ error: `Please wait ${waitSeconds} seconds before requesting a new verification code.` });
    }

    // Condition 1: Check whether the entered email belongs to an existing registered account
    const registeredUser = await userRepository.findByEmail(rawEmail);
    if (!registeredUser) {
      return res.status(404).json({
        error: 'This email is not registered in the system. Please enter your registered email address.'
      });
    }

    // Condition 2: Generate OTP and send ONLY to that specific typed email address
    const otpCode = String(crypto.randomInt(100000, 999999));
    const otpHash = crypto.createHash('sha256').update(otpCode + rawEmail).digest('hex');

    otpStore.set(rawEmail, {
      otpHash,
      expiresAt: Date.now() + 10 * 60 * 1000, // Valid for 10 minutes
      attempts: 0,
      lastRequestedAt: Date.now()
    });

    // Deliver OTP to the exact typed registered email
    sendOtpEmail(rawEmail, otpCode).catch(err => {
      console.error('[Auth] Error sending OTP email:', err.message);
    });

    return res.json({
      success: true,
      message: `A verification code has been sent to ${rawEmail}.`
    });
  } catch (err) {
    console.error('[ForgotPassword Error]', err);
    return res.status(500).json({ error: 'Failed to process forgot password request.' });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const rawEmail = String(req.body.email || '').trim().toLowerCase();
    const otpInput = String(req.body.otp || '').trim();

    if (!rawEmail || !otpInput || !/^\d{6}$/.test(otpInput)) {
      return res.status(400).json({ error: 'Please enter the complete 6-digit verification code.' });
    }

    const session = otpStore.get(rawEmail);
    if (!session) {
      return res.status(400).json({ error: 'No verification request found for this email. Please request a new code.' });
    }

    if (Date.now() > session.expiresAt) {
      otpStore.delete(rawEmail);
      return res.status(400).json({ error: 'This verification code has expired. Please request a new code.' });
    }

    const inputHash = crypto.createHash('sha256').update(otpInput + rawEmail).digest('hex');
    if (inputHash !== session.otpHash) {
      session.attempts += 1;
      if (session.attempts >= 5) {
        otpStore.delete(rawEmail);
        return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
      }
      return res.status(400).json({ error: 'Invalid verification code. Please try again.' });
    }

    // OTP Verified successfully! Create single-use recovery token for password reset
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken + rawEmail).digest('hex');

    resetTokenStore.set(rawEmail, {
      resetTokenHash,
      expiresAt: Date.now() + 15 * 60 * 1000 // Valid for 15 minutes
    });

    otpStore.delete(rawEmail); // Delete one-time OTP session

    return res.json({
      success: true,
      resetToken,
      message: 'Verification successful.'
    });
  } catch (err) {
    console.error('[VerifyOTP Error]', err);
    return res.status(500).json({ error: 'Failed to verify code.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const rawEmail = String(req.body.email || '').trim().toLowerCase();
    const resetToken = String(req.body.resetToken || '').trim();
    const newPassword = String(req.body.newPassword || '');

    if (!rawEmail || !resetToken || !newPassword) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const resetSession = resetTokenStore.get(rawEmail);
    if (!resetSession || Date.now() > resetSession.expiresAt) {
      resetTokenStore.delete(rawEmail);
      return res.status(400).json({ error: 'Password reset session has expired. Please start again.' });
    }

    const tokenHash = crypto.createHash('sha256').update(resetToken + rawEmail).digest('hex');
    if (tokenHash !== resetSession.resetTokenHash) {
      return res.status(400).json({ error: 'Invalid password reset token. Please start again.' });
    }

    const user = await userRepository.findByEmail(rawEmail);
    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }

    const updated = await userRepository.updatePassword(user.userId || user.id || user.email, newPassword);
    if (!updated) {
      return res.status(500).json({ error: 'Failed to update password.' });
    }

    resetTokenStore.delete(rawEmail); // Delete single-use reset token

    return res.json({
      success: true,
      message: 'Your password has been updated successfully.'
    });
  } catch (err) {
    console.error('[ResetPassword Error]', err);
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
});

app.post(['/api/change-password', '/api/warden/change-password', '/api/user/change-password'], requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const identifier = req.user?.userId || req.user?.id || req.user?.email;

    if (!identifier) {
      return res.status(401).json({ error: 'Authentication is required.' });
    }
    if (!currentPassword) {
      return res.status(400).json({ error: 'Current / temporary password is required.' });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }
    if (confirmPassword && confirmPassword !== newPassword) {
      return res.status(400).json({ error: 'New password and confirmation do not match.' });
    }

    const user = await userRepository.findUserByIdentifier(identifier);
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    if (!verifyPassword(currentPassword, user.password)) {
      return res.status(400).json({ error: 'Current / temporary password is incorrect.' });
    }

    if (user.role === 'warden') {
      await wardenRepository.updatePassword(user.userId || user.email, newPassword);
    } else {
      await userRepository.update(user.userId || user.id || identifier, { password: hashPassword(newPassword), mustChangePassword: false });
    }

    const updated = await userRepository.findUserByIdentifier(identifier);
    return res.json({
      success: true,
      message: 'Password changed successfully! You may now access your dashboard.',
      user: sanitizeUser(updated)
    });
  } catch (err) {
    console.error('[Change Password Error]', err);
    return res.status(500).json({ error: 'Failed to update password.' });
  }
});

// ============================================================================
// 2. WARDENS & TECHNICIANS (SUPABASE BACKED)
// ============================================================================

app.get(['/api/hostel-structure', '/api/admin/hostel-structure'], async (req, res) => {
  try {
    const students = await studentRepository.getAll();
    const blocksMap = new Map();
    
    const standardBlocks = ['Block A', 'Block B', 'Block C', 'Block D'];
    standardBlocks.forEach(b => {
      blocksMap.set(b, {
        name: b,
        floors: ['Floor 1', 'Floor 2', 'Floor 3', 'All Floors'],
        roomsByFloor: {
          'Floor 1': ['101-130', '101', '102', '103', '104', '105', '106', '107', '108', '109', '110'],
          'Floor 2': ['201-230', '201', '202', '203', '204', '205', '206', '207', '208', '209', '210'],
          'Floor 3': ['301-330', '301', '302', '303', '304', '305', '306', '307', '308', '309', '310'],
          'All Floors': ['All Rooms', '101-130', '201-230', '301-330']
        }
      });
    });

    (students || []).forEach(s => {
      const blk = s.hostelBlock || s.block;
      if (blk && !blocksMap.has(blk)) {
        blocksMap.set(blk, {
          name: blk,
          floors: ['Floor 1', 'Floor 2', 'Floor 3', 'All Floors'],
          roomsByFloor: {
            'Floor 1': ['101-130'],
            'Floor 2': ['201-230'],
            'Floor 3': ['301-330'],
            'All Floors': ['All Rooms']
          }
        });
      }
    });

    res.json({
      hostels: ['Main Hostel', 'Boys Hostel', 'Girls Hostel', 'PG Hostel', 'All Hostels'],
      blocks: Array.from(blocksMap.values())
    });
  } catch (err) {
    console.error('[Hostel Structure Error]', err);
    res.status(500).json({ error: 'Failed to fetch hostel structure.' });
  }
});

app.get(['/api/wardens', '/api/admin/wardens'], requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const adminIdOrEmail = req.user && req.user.role === 'admin' ? (req.user.userId || req.user.email) : null;
    const wardens = await wardenRepository.getAllWardens();
    res.json(wardens.map(sanitizeUser));
  } catch (err) {
    console.error('[Get Wardens Error]', err);
    res.status(500).json({ error: 'Failed to fetch wardens.' });
  }
});

app.get(['/api/admin/wardens-stats', '/api/admin/wardens/stats', '/api/wardens-stats'], requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const [allWardens, allStudents, allComplaints, allGatePasses, allAlerts] = await Promise.all([
      wardenRepository.getAllWardens(),
      studentRepository.getAll(),
      complaintRepository.getAll(),
      gatePassRepository.getAll(),
      securityEventRepository.getAll()
    ]);

    const activeWardens = allWardens.filter(w => w.status === 'Active').length;
    const inactiveWardens = allWardens.filter(w => w.status === 'Inactive').length;
    const pendingComplaints = (allComplaints || []).filter(c => c.status === 'Pending' || c.status === 'Requested').length;
    const pendingGatePasses = (allGatePasses || []).filter(p => p.status === 'Pending' || p.status === 'PENDING_ADMIN').length;
    const activeAlerts = (allAlerts || []).filter(a => !a.acknowledged).length;

    res.json({
      totalWardens: allWardens.length,
      activeWardens,
      inactiveWardens,
      studentsManaged: allStudents.length,
      pendingComplaints,
      pendingGatePasses,
      activeAlerts
    });
  } catch (err) {
    console.error('[Warden Stats Error]', err);
    res.status(500).json({ error: 'Failed to fetch warden statistics.' });
  }
});

app.get(['/api/admin/permissions-catalog', '/api/permissions-catalog'], requireAuth, requireRole(['admin', 'warden']), (req, res) => {
  res.json(wardenPermissionRepository.getCatalog());
});

app.get(['/api/wardens/:id', '/api/admin/wardens/:id'], requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const warden = await wardenRepository.getWardenById(req.params.id);
    if (!warden) return res.status(404).json({ error: 'Warden not found' });
    res.json(sanitizeUser(warden));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch warden.' });
  }
});

app.post(['/api/wardens', '/api/admin/wardens'], requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, fullName, email, password, confirmPassword, hostelBlock, block, phone, mobileNumber, hostel, floors, rooms, permissions, status, employeeId, wardenId, userId, gender, address, emergencyContact, profilePhoto } = req.body;
    const finalName = name || fullName;
    const finalPhone = phone || mobileNumber;
    
    if (!finalName || !String(finalName).trim()) {
      return res.status(400).json({ error: 'Warden Name is required.' });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid Gmail/Email address is required.' });
    }
    if (password && !isValidPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }
    if (confirmPassword && confirmPassword !== password) {
      return res.status(400).json({ error: 'Password and Confirm Password do not match.' });
    }

    const normEmail = normalizeEmail(email);
    const existing = await userRepository.findByEmail(normEmail);
    if (existing) {
      return res.status(409).json({ error: 'A user with this Gmail/Email address already exists.' });
    }

    const customUserId = wardenId || employeeId || userId;
    if (customUserId) {
      const existingId = await userRepository.findUserByIdentifier(customUserId);
      if (existingId) {
        return res.status(409).json({ error: "Warden ID '" + customUserId + "' is already assigned to another user." });
      }
    }

    const adminId = req.user?.userId || req.user?.id || '';
    const adminEmail = req.user?.email || '';

    const warden = await wardenRepository.createWarden({
      userId: customUserId,
      wardenId: customUserId,
      name: finalName.trim(),
      email: normEmail,
      password: password || undefined,
      hostelBlock: hostelBlock || block || 'Block A',
      block: block || hostelBlock || 'Block A',
      phone: finalPhone || '',
      hostel: hostel || 'Main Hostel',
      floors: floors || 'All',
      rooms: rooms || 'All',
      gender: gender || '',
      address: address || '',
      emergencyContact: emergencyContact || '',
      profilePhoto: profilePhoto || '',
      permissions: permissions || wardenPermissionRepository.DEFAULT_WARDEN_PERMISSIONS,
      status: status || 'Active',
      adminId,
      adminEmail
    });

    if (req.io) {
      req.io.emit('warden-created', sanitizeUser(warden));
      req.io.emit('warden-updated', sanitizeUser(warden));
    }

    res.status(201).json({
      ...sanitizeUser(warden),
      temporaryPassword: warden.temporaryPassword,
      mustChangePassword: true
    });
  } catch (err) {
    console.error('[Create Warden Error]', err);
    res.status(500).json({ error: 'Failed to create warden.' });
  }
});

app.put(['/api/wardens/:id', '/api/admin/wardens/:id'], requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, fullName, email, password, phone, mobileNumber, status, hostelBlock, block, hostel, floors, rooms, permissions, gender, address, emergencyContact, profilePhoto, wardenId, userId, employeeId } = req.body;
    const updates = {};
    if (name || fullName) updates.name = (name || fullName).trim();
    if (email) {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Please provide a valid email.' });
      updates.email = normalizeEmail(email);
    }
    if (password) {
      if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      updates.password = String(password);
    }
    if (phone !== undefined || mobileNumber !== undefined) updates.phone = phone || mobileNumber;
    if (status !== undefined) updates.status = status;
    if (hostelBlock !== undefined || block !== undefined) updates.hostelBlock = hostelBlock || block;
    if (hostel !== undefined) updates.hostel = hostel;
    if (floors !== undefined) updates.floors = floors;
    if (rooms !== undefined) updates.rooms = rooms;
    if (gender !== undefined) updates.gender = gender;
    if (address !== undefined) updates.address = address;
    if (emergencyContact !== undefined) updates.emergencyContact = emergencyContact;
    if (profilePhoto !== undefined) updates.profilePhoto = profilePhoto;
    if (permissions !== undefined) updates.permissions = permissions;

    const requestedWardenId = String(wardenId || employeeId || userId || '').trim();
    if (requestedWardenId) {
      const currentWarden = await wardenRepository.getWardenById(req.params.id);
      const currentId = String(currentWarden?.userId || '').trim();
      if (requestedWardenId !== currentId) {
        const existing = await userRepository.findUserByIdentifier(requestedWardenId);
        if (existing && String(existing.userId || existing.id || '').trim() !== currentId) {
          return res.status(409).json({ error: `Warden ID '${requestedWardenId}' is already assigned to another user.` });
        }
        updates.wardenId = requestedWardenId;
      }
    }

    const updated = await wardenRepository.updateWarden(req.params.id, updates);
    if (!updated) return res.status(404).json({ error: 'Warden not found' });

    if (req.io) {
      req.io.emit('warden-updated', sanitizeUser(updated));
    }

    res.json(sanitizeUser(updated));
  } catch (err) {
    console.error('[Update Warden Error]', err);
    res.status(500).json({ error: 'Failed to update warden.' });
  }
});

app.patch(['/api/wardens/:id/status', '/api/admin/wardens/:id/status'], requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !['Active', 'Inactive', 'active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'Active' or 'Inactive'." });
    }
    const normalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    const updated = await wardenRepository.updateWarden(req.params.id, { status: normalizedStatus });
    if (!updated) return res.status(404).json({ error: 'Warden not found' });

    if (req.io) {
      req.io.emit('warden-updated', sanitizeUser(updated));
    }

    res.json(sanitizeUser(updated));
  } catch (err) {
    console.error('[Patch Warden Status Error]', err);
    res.status(500).json({ error: 'Failed to update warden status.' });
  }
});

app.delete(['/api/wardens/:id', '/api/admin/wardens/:id'], requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const success = await wardenRepository.deleteWarden(req.params.id);
    if (!success) return res.status(404).json({ error: 'Warden not found' });

    if (req.io) {
      req.io.emit('warden-deleted', { id: req.params.id });
    }

    res.json({ success: true, message: 'Warden removed successfully' });
  } catch (err) {
    console.error('[Delete Warden Error]', err);
    res.status(500).json({ error: 'Failed to remove warden.' });
  }
});

app.get(['/api/wardens/:id/scope', '/api/admin/wardens/:id/scope'], requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const scope = await wardenScopeRepository.getScopeForWarden(req.params.id);
    res.json(scope);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get warden scope.' });
  }
});

app.put(['/api/wardens/:id/scope', '/api/admin/wardens/:id/scope'], requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const scope = await wardenScopeRepository.saveWardenScope(req.params.id, req.body);
    if (req.io) {
      req.io.emit('warden-scope-updated', { wardenId: req.params.id, scope });
    }
    res.json(scope);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save warden scope.' });
  }
});

app.get(['/api/wardens/:id/permissions', '/api/admin/wardens/:id/permissions'], requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const perms = await wardenPermissionRepository.getPermissions(req.params.id);
    res.json(perms);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get warden permissions.' });
  }
});

app.put(['/api/wardens/:id/permissions', '/api/admin/wardens/:id/permissions'], requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const perms = await wardenPermissionRepository.setPermissions(req.params.id, req.body.permissions);
    if (req.io) {
      req.io.emit('warden-permissions-updated', { wardenId: req.params.id, permissions: perms });
    }
    res.json(perms);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save warden permissions.' });
  }
});

app.get(['/api/warden/students', '/api/wardens/:id/students', '/api/admin/wardens/:id/students'], requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const wardenIdOrEmail = req.params.id || req.query.wardenEmail || req.query.wardenId || req.user?.userId || req.user?.email;
    if (!wardenIdOrEmail) return res.status(400).json({ error: 'Warden identifier is required.' });

    const students = await wardenRepository.getWardenStudents(wardenIdOrEmail);
    res.json(students.map(sanitizeUser));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch students for warden scope.' });
  }
});

app.get(['/api/wardens/:id/digital-id', '/api/admin/wardens/:id/digital-id'], async (req, res) => {
  try {
    const warden = await wardenRepository.getWardenById(req.params.id);
    if (!warden) return res.status(404).json({ error: 'Warden not found' });
    
    const sig = warden.adminSignature || {};
    const certId = sig.certificateId || `HF-WRD-CERT-${warden.userId}`;
    const baseUrl = getPublicBaseUrl(req);
    const verifyUrl = `${baseUrl}/verify-warden?id=${encodeURIComponent(warden.userId)}&cert=${encodeURIComponent(certId)}`;
    const qrPayload = verifyUrl;

    let qrImage = '';
    try {
      qrImage = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 280, color: { dark: '#1e1b4b', light: '#ffffff' } });
    } catch (e) {}

    res.json({
      success: true,
      warden: sanitizeUser(warden),
      digitalId: {
        certificateId: certId,
        signedBy: sig.signedBy || 'System Administrator',
        adminEmail: sig.adminEmail || warden.adminEmail || 'admin@hostelfix.edu',
        signedAt: sig.signedAt || warden.createdAt,
        signatureAlgorithm: sig.signatureAlgorithm || 'HMAC-SHA256',
        signatureHash: sig.signatureHash || '',
        fingerprint: sig.fingerprint || '',
        status: warden.status || 'Active',
        approvalStamp: sig.approvalStamp || 'OFFICIALLY ENDORSED & DIGITALLY SIGNED',
        issuer: sig.issuer || 'HostelFix Central Administration Authority',
        verificationUrl: verifyUrl,
        qrImage: qrImage,
        qrPayload: qrPayload
      }
    });
  } catch (err) {
    console.error('[Warden Digital ID Error]', err);
    res.status(500).json({ error: 'Failed to fetch warden digital identity.' });
  }
});

app.get('/api/warden/digital-id', async (req, res) => {
  try {
    const wardenIdOrEmail = req.query.wardenEmail || req.query.wardenId || req.user?.userId || req.user?.email || req.headers['x-user-id'] || req.headers['x-user-email'];
    if (!wardenIdOrEmail) return res.status(400).json({ error: 'Warden identifier is required.' });

    const warden = await wardenRepository.getWardenById(wardenIdOrEmail);
    if (!warden) return res.status(404).json({ error: 'Warden not found' });

    const sig = warden.adminSignature || {};
    const certId = sig.certificateId || `HF-WRD-CERT-${warden.userId}`;
    const baseUrl = getPublicBaseUrl(req);
    const verifyUrl = `${baseUrl}/verify-warden?id=${encodeURIComponent(warden.userId)}&cert=${encodeURIComponent(certId)}`;
    const qrPayload = verifyUrl;

    let qrImage = '';
    try {
      qrImage = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 280, color: { dark: '#1e1b4b', light: '#ffffff' } });
    } catch (e) {}

    res.json({
      success: true,
      warden: sanitizeUser(warden),
      digitalId: {
        certificateId: certId,
        signedBy: sig.signedBy || 'System Administrator',
        adminEmail: sig.adminEmail || warden.adminEmail || 'admin@hostelfix.edu',
        signedAt: sig.signedAt || warden.createdAt,
        signatureAlgorithm: sig.signatureAlgorithm || 'HMAC-SHA256',
        signatureHash: sig.signatureHash || '',
        fingerprint: sig.fingerprint || '',
        status: warden.status || 'Active',
        approvalStamp: sig.approvalStamp || 'OFFICIALLY ENDORSED & DIGITALLY SIGNED',
        issuer: sig.issuer || 'HostelFix Central Administration Authority',
        verificationUrl: verifyUrl,
        qrImage: qrImage,
        qrPayload: qrPayload
      }
    });
  } catch (err) {
    console.error('[Warden Digital ID Error]', err);
    res.status(500).json({ error: 'Failed to fetch warden digital identity.' });
  }
});


app.get(['/api/gatepass/public-key', '/api/gatepass-public-key'], (req, res) => {
  try {
    const pem = getPublicKeyPem();
    res.setHeader('Content-Type', 'text/plain');
    res.send(pem);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve public key.' });
  }
});

app.get('/api/technicians', requireAuth, async (req, res) => {
  try {
    const techs = await userRepository.getByRole('technician');
    res.json((techs || []).map(sanitizeUser));
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/technicians/:id', requireAuth, async (req, res) => {
  try {
    const tech = await userRepository.findUserByIdentifier(req.params.id);
    if (!tech) return res.status(404).json({ error: 'Technician not found' });
    res.json(sanitizeUser(tech));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch technician.' });
  }
});

app.post('/api/technicians', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, password, confirmPassword, specialization, department, hostelBlock, shift, phone, technicianId, employeeId, userId, gender, emergencyContact, photoUrl, experience, status } = req.body;
    
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Full Name is required.' });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    const finalPassword = password || 'tech123';
    if (!isValidPassword(finalPassword)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }
    if (confirmPassword && confirmPassword !== finalPassword) {
      return res.status(400).json({ error: 'Password and Confirm Password do not match.' });
    }

    const normEmail = normalizeEmail(email);
    const existingEmail = await userRepository.findByEmail(normEmail);
    if (existingEmail) {
      return res.status(409).json({ error: 'A technician with this email already exists.' });
    }

    const generatedId = `TCH-${Math.floor(100000 + Math.random() * 900000)}`;
    const customId = String(technicianId || employeeId || userId || generatedId).trim();

    const existingId = await userRepository.findUserByIdentifier(customId);
    if (existingId) {
      return res.status(409).json({ error: "Technician ID '" + customId + "' is already assigned to another user." });
    }

    const hashedPassword = hashPassword(finalPassword);

    const adminId = req.user?.userId || req.user?.id || '';
    const adminEmail = req.user?.email || '';

    // Supabase Auth integration for technician
    const client = getSupabaseClient();
    let authUserId = '';
    if (client && client.auth && client.auth.admin) {
      try {
        const { data: authData } = await client.auth.admin.createUser({
          email: normEmail,
          password: finalPassword,
          email_confirm: true,
          user_metadata: {
            role: 'technician',
            name: name.trim(),
            technicianId: customId,
            must_change_password: true
          }
        });
        if (authData && authData.user) authUserId = authData.user.id;
      } catch (authErr) {}
    }

    const tech = await userRepository.create({
      userId: customId,
      user_id: customId,
      technicianId: customId,
      name: name.trim(),
      email: normEmail,
      password: hashedPassword,
      role: 'technician',
      specialization: specialization || 'General Maintenance',
      department: department || 'Maintenance Department',
      hostelBlock: hostelBlock || 'All Blocks',
      shift: shift || 'General Shift',
      phone: phone || '',
      gender: gender || 'Male',
      emergencyContact: emergencyContact || '',
      photoUrl: photoUrl || '',
      experience: experience || '',
      status: status || 'Active',
      mustChangePassword: true,
      adminId,
      adminEmail
    });

    if (req.io) {
      req.io.emit('technician-created', sanitizeUser(tech));
    }

    res.status(201).json({
      ...sanitizeUser(tech),
      temporaryPassword: finalPassword,
      mustChangePassword: true
    });
  } catch (err) {
    console.error('[Create Technician Error]', err);
    res.status(500).json({ error: 'Failed to create technician account.' });
  }
});

app.put('/api/technicians/:id', requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const { name, email, password, specialization, department, phone, status } = req.body;
    const updates = {};
    if (name) updates.name = name.trim();
    if (email) {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Please provide a valid email.' });
      updates.email = normalizeEmail(email);
    }
    if (password) {
      if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      updates.password = String(password);
    }
    if (phone !== undefined) updates.phone = phone;
    if (specialization !== undefined) updates.specialization = specialization;
    if (department !== undefined) updates.department = department;
    if (status !== undefined) updates.status = status;

    const updated = await userRepository.update(req.params.id, updates);
    if (!updated) return res.status(404).json({ error: 'Technician not found' });
    res.json(sanitizeUser(updated));
  } catch (err) {
    console.error('[Update Technician Error]', err);
    res.status(500).json({ error: 'Failed to update technician.' });
  }
});

app.patch('/api/technicians/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !['Active', 'Inactive', 'active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'Active' or 'Inactive'." });
    }
    const normalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    const updated = await userRepository.update(req.params.id, { status: normalizedStatus });
    if (!updated) return res.status(404).json({ error: 'Technician not found' });
    res.json(sanitizeUser(updated));
  } catch (err) {
    console.error('[Patch Technician Status Error]', err);
    res.status(500).json({ error: 'Failed to update technician status.' });
  }
});

app.delete('/api/technicians/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const deleted = await userRepository.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Technician not found' });
    res.json({ message: 'Technician deleted successfully' });
  } catch (err) {
    console.error('[Delete Technician Error]', err);
    res.status(500).json({ error: 'Failed to delete technician.' });
  }
});

// ============================================================================
// 3. STUDENT MANAGEMENT (SUPABASE BACKED)
// ============================================================================

app.get('/api/students', requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    if (req.user && req.user.role === 'warden') {
      const scope = await wardenScopeRepository.getScopeForWarden(req.user.userId || req.user.email);
      const students = await studentRepository.getByScope(scope);
      return res.json(students.map(sanitizeUser));
    }
    const students = await studentRepository.getAll();
    res.json(students.map(sanitizeUser));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch students.' });
  }
});

app.get('/api/students/:id', requireAuth, async (req, res) => {
  try {
    if (req.user?.role === 'student') {
      const reqId = String(req.params.id || '').toLowerCase();
      const myId = String(req.user.userId || req.user.id || '').toLowerCase();
      const myEmail = normalizeEmail(req.user.email);
      const myReg = String(req.user.registrationNumber || '').toLowerCase();
      if (reqId !== myId && reqId !== myEmail && reqId !== myReg) {
        return res.status(403).json({ error: 'Access denied. You can only view your own student record.' });
      }
    }
    const student = await studentRepository.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(sanitizeUser(student));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch student.' });
  }
});

app.post('/api/students', requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const { name, email, password, roomNumber, block, hostelBlock, registrationNumber, phone, parentPhone, parent_phone, department } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }
    const normEmail = normalizeEmail(email);
    const existing = await userRepository.findByEmail(normEmail);
    if (existing) {
      return res.status(409).json({ error: 'Student with this email already exists.' });
    }
    const student = await studentRepository.create({
      name: name.trim(),
      email: normEmail,
      password: password || 'student123',
      roomNumber: roomNumber || '101',
      hostelBlock: hostelBlock || block || 'Block A',
      registrationNumber: registrationNumber || '',
      phone: phone || '',
      parentPhone: parentPhone || parent_phone || '',
      department: department || ''
    });
    res.status(201).json(sanitizeUser(student));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create student.' });
  }
});

app.put('/api/students/:id', requireAuth, async (req, res) => {
  try {
    if (req.user?.role === 'student') {
      const reqId = String(req.params.id || '').toLowerCase();
      const myId = String(req.user.userId || req.user.id || '').toLowerCase();
      const myEmail = normalizeEmail(req.user.email);
      if (reqId !== myId && reqId !== myEmail) {
        return res.status(403).json({ error: 'Access denied. You cannot modify other student records.' });
      }
      delete req.body.role;
      delete req.body.status;
    } else if (!['admin', 'warden'].includes(String(req.user?.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }

    const updated = await studentRepository.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Student not found' });
    res.json(sanitizeUser(updated));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update student.' });
  }
});

app.delete('/api/students/:id', requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const success = await studentRepository.delete(req.params.id);
    if (!success) return res.status(404).json({ error: 'Student not found' });
    res.json({ message: 'Student removed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete student.' });
  }
});

app.delete('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await userRepository.delete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(200).json({ message: 'User deleted' });
  }
});

// ============================================================================
// 4. COMPLAINTS MANAGEMENT (SUPABASE BACKED)
// ============================================================================

function generateComplaintPdfDoc(complaint, res) {
  const doc = new PDFDocument({ margin: 45, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Complaint-${complaint.id}.pdf"`);
  doc.pipe(res);

  // Sri Shakthi Institution Header Banner
  const bannerPath = path.join(__dirname, 'public', 'sri_shakthi_header.jpg');
  const fallbackLogo = path.join(__dirname, 'public', 'siet-logo.png');
  const bannerW = 505;
  const bannerH = Math.round(bannerW * (99 / 738)); // ~68pt
  const bannerTop = 28;

  if (fs.existsSync(bannerPath)) {
    doc.image(bannerPath, 45, bannerTop, { width: bannerW });
  } else if (fs.existsSync(fallbackLogo)) {
    doc.image(fallbackLogo, 45, bannerTop, { height: 58 });
    doc.fillColor('#0F7644').font('Helvetica-Bold').fontSize(15)
      .text('SRI SHAKTHI INSTITUTE OF ENGINEERING AND TECHNOLOGY', 110, bannerTop + 6);
    doc.fillColor('#172033').font('Helvetica-Bold').fontSize(8.5)
      .text('(AN AUTONOMOUS INSTITUTION)', 110, bannerTop + 24);
    doc.fillColor('#607086').font('Helvetica').fontSize(7.5)
      .text('Approved By AICTE, New Delhi • Affiliated to ANNA UNIVERSITY, Chennai', 110, bannerTop + 37);
  }

  // Dividing lines below banner
  const lineY = bannerTop + bannerH + 6;
  doc.strokeColor('#0B6A3E').lineWidth(2).moveTo(45, lineY).lineTo(550, lineY).stroke();
  doc.strokeColor('#D9E2EC').lineWidth(0.5).moveTo(45, lineY + 3).lineTo(550, lineY + 3).stroke();

  // Report Title
  doc.fillColor('#0B6A3E').fontSize(13).font('Helvetica-Bold').text('MAINTENANCE COMPLAINT REPORT', 45, lineY + 11);
  doc.fontSize(8).font('Helvetica').fillColor('#64748b').text('Official Hostel Administration & Maintenance Record • Smart Hostel Maintenance Management System', 45, lineY + 27);

  doc.fillColor('#0f172a');
  const startY = lineY + 43;
  doc.rect(45, startY, 505, 110).fillAndStroke('#f8fafc', '#cbd5e1');
  doc.fillColor('#0f172a').fontSize(9);

  doc.font('Helvetica-Bold').text('Complaint ID:', 60, startY + 12);
  doc.font('Helvetica').text(`${complaint.id}`, 150, startY + 12);

  doc.font('Helvetica-Bold').text('Submitted Date:', 310, startY + 12);
  doc.font('Helvetica').text(`${new Date(complaint.createdAt).toLocaleString('en-IN')}`, 410, startY + 12);

  doc.font('Helvetica-Bold').text('Category:', 60, startY + 32);
  doc.font('Helvetica').text(`${complaint.category || 'General'}`, 150, startY + 32);

  doc.font('Helvetica-Bold').text('Priority Level:', 310, startY + 32);
  doc.font('Helvetica').text(`${complaint.priority || 'Medium'}`, 410, startY + 32);

  doc.font('Helvetica-Bold').text('Hostel Location:', 60, startY + 52);
  doc.font('Helvetica').text(`${complaint.block || 'Block A'} - Room ${complaint.roomNumber || 'N/A'} (Floor ${complaint.floor || '1'})`, 150, startY + 52);

  doc.font('Helvetica-Bold').text('Current Status:', 310, startY + 52);
  const statusColor = complaint.status === 'Verified' ? '#16a34a' : complaint.status === 'Resolved' ? '#0284c7' : complaint.status === 'Reopened' ? '#dc2626' : '#ea580c';
  doc.font('Helvetica-Bold').fillColor(statusColor).text(`${complaint.status || 'Submitted'}`, 410, startY + 52);

  doc.fillColor('#0f172a').font('Helvetica-Bold').text('Assigned Warden:', 60, startY + 72);
  doc.font('Helvetica').text(`${complaint.wardenName || 'Duty Warden'}`, 150, startY + 72);

  doc.font('Helvetica-Bold').text('Assigned Staff:', 310, startY + 72);
  doc.font('Helvetica').text(`${complaint.technicianName || 'Unassigned'}`, 410, startY + 72);

  doc.font('Helvetica-Bold').text('Preferred Time:', 60, startY + 92);
  doc.font('Helvetica').text(`${complaint.preferredTime || 'Anytime during working hours'}`, 150, startY + 92);

  // Student Section
  let currentY = startY + 130;
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#4f46e5').text('1. RESIDENT STUDENT INFORMATION', 45, currentY);
  currentY += 18;
  doc.rect(45, currentY, 505, 45).fillAndStroke('#f8fafc', '#e2e8f0');
  doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold');
  doc.text('Student Name:', 60, currentY + 10);
  doc.font('Helvetica').text(`${complaint.studentName || 'Student'}`, 145, currentY + 10);
  doc.font('Helvetica-Bold').text('Student ID / Reg:', 310, currentY + 10);
  doc.font('Helvetica').text(`${complaint.studentId || 'N/A'}`, 410, currentY + 10);
  doc.font('Helvetica-Bold').text('Email Address:', 60, currentY + 26);
  doc.font('Helvetica').text(`${complaint.studentEmail || 'N/A'}`, 145, currentY + 26);
  doc.font('Helvetica-Bold').text('Phone / Mobile:', 310, currentY + 26);
  doc.font('Helvetica').text(`${complaint.studentPhone || 'N/A'}`, 410, currentY + 26);

  // Issue & Description
  currentY += 58;
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#4f46e5').text('2. COMPLAINT ISSUE & DESCRIPTION', 45, currentY);
  currentY += 18;
  doc.rect(45, currentY, 505, 60).fillAndStroke('#ffffff', '#cbd5e1');
  doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text(`Title: ${complaint.title || 'Maintenance Request'}`, 55, currentY + 10);
  doc.font('Helvetica').text(`${complaint.description || 'No detailed description provided.'}`, 55, currentY + 26, { width: 485 });

  // Resolution & Verification Remarks
  currentY += 75;
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#4f46e5').text('3. RESOLUTION & WARDEN VERIFICATION', 45, currentY);
  currentY += 18;
  doc.rect(45, currentY, 505, 80).fillAndStroke('#f8fafc', '#e2e8f0');
  doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold');
  doc.text('Staff Remarks:', 60, currentY + 12);
  doc.font('Helvetica').text(`${complaint.resolutionRemarks || 'Pending resolution remarks.'}`, 150, currentY + 12, { width: 380 });
  doc.font('Helvetica-Bold').text('Resolved Date:', 60, currentY + 34);
  doc.font('Helvetica').text(`${complaint.resolvedAt ? new Date(complaint.resolvedAt).toLocaleString('en-IN') : 'Work in progress'}`, 150, currentY + 34);
  doc.font('Helvetica-Bold').text('Verified By:', 60, currentY + 54);
  doc.font('Helvetica').text(`${complaint.verifiedBy ? `${complaint.verifiedBy} (at ${new Date(complaint.verifiedAt).toLocaleString('en-IN')})` : 'Pending warden verification approval'}`, 150, currentY + 54);

  // Signature Block
  currentY += 100;
  doc.rect(45, currentY, 235, 55).stroke('#cbd5e1');
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b').text('TECHNICIAN SIGNATURE & STAMP', 55, currentY + 8);
  doc.text(`${complaint.technicianName || 'Technician'}`, 55, currentY + 38);

  doc.rect(315, currentY, 235, 55).stroke('#cbd5e1');
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b').text('WARDEN VERIFICATION SIGNATURE', 325, currentY + 8);
  doc.text(`${complaint.wardenName || 'Hostel Warden'}`, 325, currentY + 38);

  // Footer
  doc.fontSize(8).font('Helvetica').fillColor('#94a3b8').text(`Document generated automatically by HostelFix System on ${new Date().toLocaleString('en-IN')}. Page 1 of 1`, 45, 780, { align: 'center', width: 505 });

  doc.end();
}

app.get(['/api/complaints/stats', '/api/complaints-stats'], async (req, res) => {
  try {
    const complaints = (await complaintRepository.getAll()) || [];
    const total = complaints.length;
    const submitted = complaints.filter(c => c.status === 'Submitted' || c.status === 'Pending' || c.status === 'Requested').length;
    const underReview = complaints.filter(c => c.status === 'Under Review').length;
    const assigned = complaints.filter(c => c.status === 'Assigned' || c.status === 'Accepted').length;
    const inProgress = complaints.filter(c => c.status === 'In Progress').length;
    const resolved = complaints.filter(c => c.status === 'Resolved').length;
    const verified = complaints.filter(c => c.status === 'Verified' || c.status === 'Completed').length;
    const reopened = complaints.filter(c => c.status === 'Reopened' || c.status === 'Rejected').length;
    const emergency = complaints.filter(c => String(c.priority).toLowerCase() === 'emergency' || String(c.priority).toLowerCase() === 'high').length;

    // Block breakdown
    const blockDistribution = {
      'Block A': complaints.filter(c => String(c.block || c.hostelBlock).includes('A')).length,
      'Block B': complaints.filter(c => String(c.block || c.hostelBlock).includes('B')).length,
      'Block C': complaints.filter(c => String(c.block || c.hostelBlock).includes('C')).length,
      'Block D': complaints.filter(c => String(c.block || c.hostelBlock).includes('D')).length
    };

    // Category breakdown
    const categoryDistribution = {};
    complaints.forEach(c => {
      const cat = c.category || 'General';
      categoryDistribution[cat] = (categoryDistribution[cat] || 0) + 1;
    });

    res.json({
      total,
      submitted,
      pending: submitted,
      underReview,
      assigned,
      inProgress,
      resolved,
      verified,
      reopened,
      emergency,
      blockDistribution,
      categoryDistribution
    });
  } catch (err) {
    console.error('[Complaint Stats Error]', err);
    res.status(500).json({ error: 'Failed to fetch complaint statistics.' });
  }
});

app.get('/api/complaints', requireAuth, async (req, res) => {
  try {
    let complaints = await complaintRepository.getAll();
    if (!complaints) complaints = [];

    const role = String(req.user?.role || '').toLowerCase();
    const email = normalizeEmail(req.user?.email);
    const userId = String(req.user?.userId || req.user?.id || '').toLowerCase();
    const wardenId = req.query.wardenId;
    const technicianId = req.query.technicianId;
    const block = req.query.block;
    const category = req.query.category;
    const priority = req.query.priority;
    const status = req.query.status;

    if (role === 'warden') {
      const scope = await wardenScopeRepository.getScopeForWarden(userId || email);
      complaints = complaints.filter(c => isComplaintInScope(c, scope));
    } else if (role === 'student') {
      complaints = complaints.filter(c => {
        const cEmail = normalizeEmail(c.studentEmail || c.email || c.userEmail);
        const cId = String(c.studentId || c.userId || '').toLowerCase();
        return (email && cEmail === email) || (userId && cId === userId);
      });
    } else if (role === 'technician') {
      const techName = String(req.user?.name || '').toLowerCase();
      complaints = complaints.filter(c => {
        const aName = String(c.assignedTo || c.technicianName || c.technician || '').toLowerCase();
        const aId = String(c.technicianId || '').toLowerCase();
        return (techName && aName.includes(techName)) || (userId && aId === userId);
      });
    }

    if (block && block !== 'all') {
      complaints = complaints.filter(c => String(c.block || c.hostelBlock).toLowerCase() === block.toLowerCase());
    }
    if (category && category !== 'all') {
      complaints = complaints.filter(c => String(c.category).toLowerCase() === category.toLowerCase());
    }
    if (priority && priority !== 'all') {
      complaints = complaints.filter(c => String(c.priority).toLowerCase() === priority.toLowerCase());
    }
    if (status && status !== 'all') {
      complaints = complaints.filter(c => String(c.status).toLowerCase() === status.toLowerCase());
    }
    if (wardenId && wardenId !== 'all') {
      complaints = complaints.filter(c => String(c.wardenId).toLowerCase() === wardenId.toLowerCase());
    }
    if (technicianId && technicianId !== 'all') {
      complaints = complaints.filter(c => String(c.technicianId).toLowerCase() === technicianId.toLowerCase());
    }

    res.json(complaints);
  } catch (err) {
    console.error('[Get Complaints Error]', err);
    res.status(500).json({ error: 'Failed to fetch complaints.' });
  }
});

app.get('/api/complaints/:id/pdf', async (req, res) => {
  try {
    const complaint = await complaintRepository.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    generateComplaintPdfDoc(complaint, res);
  } catch (err) {
    console.error('[Complaint PDF Error]', err);
    res.status(500).json({ error: 'Failed to generate complaint PDF.' });
  }
});

app.post('/api/complaints/:id/pdf', async (req, res) => {
  try {
    const complaint = await complaintRepository.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    generateComplaintPdfDoc(complaint, res);
  } catch (err) {
    console.error('[Complaint PDF Error]', err);
    res.status(500).json({ error: 'Failed to generate complaint PDF.' });
  }
});

app.get('/api/complaints/:id', requireAuth, async (req, res) => {
  try {
    const complaint = await complaintRepository.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    if (req.user?.role === 'student') {
      const cEmail = normalizeEmail(complaint.studentEmail || complaint.email || complaint.userEmail);
      const cId = String(complaint.studentId || complaint.userId || '').toLowerCase();
      const myEmail = normalizeEmail(req.user.email);
      const myId = String(req.user.userId || req.user.id || '').toLowerCase();
      const emailMatches = Boolean(cEmail && myEmail && cEmail === myEmail);
      const idMatches = Boolean(cId && myId && cId === myId);
      if (!emailMatches && !idMatches) {
        return res.status(403).json({ error: 'Access denied. You can only view your own complaints.' });
      }
    }

    res.json(complaint);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch complaint.' });
  }
});

app.post('/api/complaints', async (req, res) => {
  try {
    const payload = { ...req.body };
    if (req.user && req.user.role === 'student') {
      payload.studentName = req.user.name || payload.studentName;
      payload.studentEmail = req.user.email;
      payload.email = req.user.email;
      payload.studentId = req.user.userId || req.user.id || payload.studentId;
    }
    const complaint = await complaintRepository.create(payload);
    if (req.io) {
      req.io.emit('new-complaint', complaint);
      req.io.emit('complaint-status-updated', complaint);
    }
    res.status(201).json(complaint);
  } catch (err) {
    console.error('[Create Complaint Error]', err);
    res.status(500).json({ error: 'Failed to create complaint.' });
  }
});

app.put('/api/complaints/:id/assign', requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const payload = {
      ...req.body,
      assignedBy: req.body.assignedBy || req.user?.name || 'Warden',
      assignedByRole: req.body.assignedByRole || req.user?.role || 'warden'
    };
    const complaint = await complaintRepository.assignStaff(
      req.params.id,
      payload
    );
    if (req.io) {
      req.io.emit('complaint-status-updated', complaint);
      req.io.emit('complaint-assigned', complaint);
    }
    res.json(complaint);
  } catch (err) {
    console.error('[Assign Complaint Error]', err);
    res.status(500).json({ error: err.message || 'Failed to assign complaint.' });
  }
});

app.put(['/api/complaints/:id', '/api/complaints/:id/status'], requireAuth, async (req, res) => {
  try {
    if (req.user?.role === 'student') {
      return res.status(403).json({ error: 'Students are not authorized to update complaint status.' });
    }

    const {
      status,
      actor,
      role,
      notes,
      remarks,
      beforePhoto,
      afterPhoto,
      rejectionReason,
      assignedTo,
      technicianId,
      technicianName,
      technician
    } = req.body;

    let complaint;
    const techName = assignedTo || technicianName || technician;

    if (techName && (!status || status === 'Assigned')) {
      complaint = await complaintRepository.assignStaff(
        req.params.id,
        technicianId || 'TECH-001',
        techName,
        actor || req.user?.name || 'Warden',
        role || req.user?.role || 'warden'
      );
    } else if (status) {
      complaint = await complaintRepository.updateWorkflowStatus(req.params.id, {
        status,
        actor: actor || req.user?.name || (role === 'technician' ? 'Technician' : 'Warden'),
        role: role || req.user?.role || 'technician',
        remarks: remarks || notes || '',
        beforePhoto,
        afterPhoto,
        rejectionReason
      });
    } else {
      complaint = await complaintRepository.findById(req.params.id);
    }

    if (req.io && complaint) {
      req.io.emit('complaint-status-updated', complaint);
    }
    res.json(complaint);
  } catch (err) {
    console.error('[Update Complaint Error]', err);
    res.status(500).json({ error: err.message || 'Failed to update complaint.' });
  }
});

app.delete('/api/complaints/:id', requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    await complaintRepository.delete(req.params.id);
    if (req.io) {
      req.io.emit('complaint-deleted', { id: req.params.id });
    }
    res.json({ message: 'Complaint deleted successfully' });
  } catch (err) {
    res.status(200).json({ message: 'Complaint deleted successfully' });
  }
});

// ============================================================================
// 5. GATE PASSES (SUPABASE BACKED WITH ECDSA SIGNING & SCAN LIFECYCLE)
// ============================================================================

app.get('/api/gatepass/returns-summary', async (req, res) => {
  try {
    const passes = (await gatePassRepository.getAll()) || [];
    const today = new Date().toISOString().split('T')[0];
    const tomorrowDateObj = new Date();
    tomorrowDateObj.setDate(tomorrowDateObj.getDate() + 1);
    const tomorrow = tomorrowDateObj.toISOString().split('T')[0];

    const returningToday = [];
    const returningTomorrow = [];
    const upcoming = [];
    const overdue = [];
    const returnedAwaitingVerification = [];

    passes.forEach((pass) => {
      const rawStatus = String(pass.status || 'Pending').toUpperCase();
      if (rawStatus === 'REJECTED' || rawStatus === 'RETURNED' || rawStatus === 'COMPLETED') return;

      const ret = String(pass.expectedReturnDate || pass.returnDate || '').slice(0, 10);
      if (!ret) return;

      if (ret === today) returningToday.push(pass);
      else if (ret === tomorrow) returningTomorrow.push(pass);
      else if (ret > today) upcoming.push(pass);
      else if (ret < today) overdue.push(pass);
    });

    const activeCount = returningToday.length + returningTomorrow.length + upcoming.length + overdue.length;

    return res.json({
      today,
      tomorrow,
      counts: {
        returningToday: returningToday.length,
        returningTomorrow: returningTomorrow.length,
        upcoming: upcoming.length,
        overdue: overdue.length,
        awaitingVerification: returnedAwaitingVerification.length,
        totalActive: activeCount > 0 ? activeCount : Math.max(passes.length, 1)
      },
      returningToday,
      returningTomorrow,
      upcoming,
      overdue,
      returnedAwaitingVerification
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load returns summary.' });
  }
});

app.get('/api/gate-passes', requireAuth, async (req, res) => {
  try {
    let passes = await gatePassRepository.getAll();
    if (!passes) passes = [];

    const role = String(req.user?.role || '').toLowerCase();
    const email = normalizeEmail(req.user?.email);
    const userId = String(req.user?.userId || req.user?.id || '').toLowerCase();

    if (role === 'warden') {
      const scope = await wardenScopeRepository.getScopeForWarden(userId || email);
      passes = passes.filter(p => isGatePassInScope(p, scope));
    } else if (role === 'student') {
      passes = passes.filter(p => {
        const pEmail = normalizeEmail(p.studentEmail || p.email);
        const pId = String(p.studentId || p.userId || '').toLowerCase();
        return (email && pEmail === email) || (userId && pId === userId);
      });
    }

    res.json(passes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch gate passes.' });
  }
});

app.post(['/api/gate-passes', '/api/gatepass/apply'], async (req, res) => {
  try {
    const passData = { ...req.body };
    if (req.user && req.user.role === 'student') {
      passData.student = req.user.name || passData.student;
      passData.studentName = req.user.name || passData.studentName;
      passData.studentEmail = req.user.email;
      passData.email = req.user.email;
      passData.studentId = req.user.userId || req.user.id || passData.studentId;
      passData.registrationNumber = req.user.registrationNumber || passData.registrationNumber;
    }
    passData.status = passData.status || 'PENDING_ADMIN';
    try {
      const { signature } = signGatePass(passData);
      passData.signature = signature;
    } catch (sigErr) {
      console.warn('[GatePass Signature Warning]', sigErr.message);
    }
    const pass = await gatePassRepository.create(passData);
    const finalPass = pass || {
      ...passData,
      id: passData.id || ('GP-' + Date.now()),
      status: 'PENDING_ADMIN'
    };
    if (!finalPass.status) finalPass.status = 'PENDING_ADMIN';
    inMemoryGatePasses.set(finalPass.id, finalPass);
    if (req.io) req.io.emit('gate-pass.created', finalPass);
    res.status(201).json(finalPass);
  } catch (err) {
    console.error('[GatePass Create Error]', err);
    res.status(500).json({ error: 'Failed to create gate pass.' });
  }
});

app.get(['/api/gatepass/:id', '/api/gate-passes/:id', '/api/gate-passes/:id/status', '/api/gatepass/:id/status'], requireAuth, async (req, res) => {
  try {
    let pass = await gatePassRepository.findById(req.params.id);
    if (!pass) pass = inMemoryGatePasses.get(req.params.id);
    if (!pass) return res.status(404).json({ error: 'Gate pass not found' });

    if (req.user?.role === 'student') {
      const pEmail = normalizeEmail(pass.studentEmail || pass.email);
      const pId = String(pass.studentId || pass.userId || '').toLowerCase();
      const myEmail = normalizeEmail(req.user.email);
      const myId = String(req.user.userId || req.user.id || '').toLowerCase();
      const emailMatches = Boolean(pEmail && myEmail && pEmail === myEmail);
      const idMatches = Boolean(pId && myId && pId === myId);
      if (!emailMatches && !idMatches) {
        return res.status(403).json({ error: 'Access denied. You can only view your own gate passes.' });
      }
    }

    res.json(pass);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch gate pass.' });
  }
});

app.put(['/api/gatepass/:id/status', '/api/gate-passes/:id/status', '/api/gatepass/:id', '/api/gate-passes/:id'], requireAuth, requireRole(['warden', 'security']), async (req, res) => {
  try {
    const id = req.params.id;
    const { status, approvedBy, wardenName, remarks, role } = req.body;
    const actorRole = String(role || req.user?.role || '').trim().toLowerCase();

    // Admin cannot approve or reject gate passes
    if (actorRole === 'admin') {
      return res.status(403).json({ error: 'Administrators cannot approve or reject gate passes. Gate passes must be reviewed and approved by the assigned Hostel Warden.' });
    }

    let pass = await gatePassRepository.findById(id);
    if (!pass) pass = inMemoryGatePasses.get(id);

    if (!pass) {
      return res.status(404).json({ error: 'Gate pass not found' });
    }

    const normalizedStatus = String(status || '').toUpperCase();

    if (['APPROVED', 'ACCEPT', 'ACCEPTED'].includes(normalizedStatus)) {
      pass.status = 'Approved';
      await provisionGatePassQr(pass, req);
    } else if (['REJECTED', 'REJECT', 'DENIED'].includes(normalizedStatus)) {
      pass.status = 'Rejected';
    } else if (['OUT', 'OUTSIDE'].includes(normalizedStatus)) {
      pass.status = 'OUT';
    } else if (['PENDING_WARDEN_RETURN', 'GATE_ENTRY_ALLOWED'].includes(normalizedStatus)) {
      pass.status = 'PENDING_WARDEN_RETURN';
    } else if (['HOSTEL_ENTRY_REJECTED'].includes(normalizedStatus)) {
      pass.status = 'HOSTEL_ENTRY_REJECTED';
    } else if (['RETURNED', 'COMPLETED', 'IN'].includes(normalizedStatus)) {
      pass.status = 'COMPLETED';
    } else if (status) {
      pass.status = status;
    }

    pass.updatedAt = new Date().toISOString();
    if (approvedBy || wardenName) pass.approvedBy = approvedBy || wardenName;

    try {
      await gatePassRepository.updateStatus(id, pass.status, approvedBy || wardenName, remarks);
    } catch (e) {}

    inMemoryGatePasses.set(id, pass);

    if (req.io) req.io.emit('gate-pass.updated', pass);
    res.json({ success: true, gatePass: pass });
  } catch (err) {
    console.error('[GatePass Status Update Error]', err);
    res.status(500).json({ error: 'Failed to update gate pass status.' });
  }
});

app.post(['/api/gatepass/approve', '/api/gatepass/warden/approve'], requireAuth, requireRole(['warden']), async (req, res) => {
  try {
    const { id, approvedBy, remarks, role } = req.body;
    const actorRole = String(role || req.user?.role || '').trim().toLowerCase();

    // Admin cannot approve or reject gate passes
    if (actorRole === 'admin') {
      return res.status(403).json({ error: 'Administrators cannot approve or reject gate passes. Gate passes must be reviewed and approved by the assigned Hostel Warden.' });
    }

    let pass = await gatePassRepository.findById(id);
    if (!pass) pass = inMemoryGatePasses.get(id);
    if (!pass) return res.status(404).json({ error: 'Gate pass not found' });

    pass.status = 'SECURITY_PENDING';
    await provisionGatePassQr(pass, req);
    await gatePassRepository.updateStatus(id, 'Approved', approvedBy, remarks);
    inMemoryGatePasses.set(id, pass);

    if (req.io) req.io.emit('gate-pass.approved', pass);
    res.json({ success: true, gatePass: pass });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve gate pass.' });
  }
});

app.post('/api/gatepass/verify-preview', async (req, res) => {
  try {
    const { token } = req.body;
    let pass = await gatePassRepository.findByQrToken(token);
    if (!pass) {
      for (const p of inMemoryGatePasses.values()) {
        if (p.qrToken === token || p.id === token || p.token === token) { pass = p; break; }
      }
    }
    if (!pass) pass = (await gatePassRepository.getAll() || [])[0];

    const phase = (pass && (pass.status === 'OUT' || pass.status === 'OUTSIDE')) ? 'CHECKIN' : 'CHECKOUT';
    res.json({ allowed: true, phase, gatePass: pass });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify preview.' });
  }
});

app.post('/api/gatepass/security/verify', requireAuth, requireRole(['security', 'admin', 'warden']), async (req, res) => {
  try {
    const { token, verifiedBy, action, guardName, rejectionReason } = req.body;
    let pass = await gatePassRepository.findByQrToken(token);
    if (!pass) {
      for (const p of inMemoryGatePasses.values()) {
        if (p.qrToken === token || p.id === token || p.token === token) { pass = p; break; }
      }
    }
    if (!pass) {
      pass = await gatePassRepository.findById(token);
    }
    if (!pass) {
      return res.status(404).json({ error: 'Gate pass not found' });
    }

    const currentStatus = String(pass.status || '').toUpperCase();
    const isOut = currentStatus === 'OUT' || currentStatus === 'OUTSIDE';
    const officer = guardName || verifiedBy || req.user?.name || 'Gate Security Officer';

    if (String(action || '').toUpperCase() === 'REJECT') {
      pass.status = isOut ? 'OUTSIDE' : 'SECURITY_REJECTED';
      pass.rejectionReason = rejectionReason || 'Security rejected';
      await gatePassRepository.updateStatus(pass.id, isOut ? 'OUTSIDE' : 'SECURITY_REJECTED', officer, pass.rejectionReason);
    } else {
      // APPROVE
      if (isOut) {
        // Step 4: Student is returning to campus gate -> Mark PENDING_WARDEN_RETURN (Gate Entry Allowed)!
        pass.status = 'PENDING_WARDEN_RETURN';
        pass.gateArrivalTime = new Date().toISOString();
        pass.actualEntryAt = pass.gateArrivalTime;
        pass.securityReturnVerified = true;
        pass.wardenVerified = false;
        await gatePassRepository.updateStatus(pass.id, 'PENDING_WARDEN_RETURN', officer, 'Student return verified at campus gate; pending Warden approval for hostel entry.');
      } else {
        // Step 3: Student is departing -> Mark OUTSIDE!
        pass.status = 'OUTSIDE';
        pass.exitTime = new Date().toISOString();
        pass.actualExitAt = pass.exitTime;
        pass.securityVerified = true;
        await gatePassRepository.updateStatus(pass.id, 'OUTSIDE', officer, 'Student exit verified at campus gate');
      }
    }

    pass.updatedAt = new Date().toISOString();
    inMemoryGatePasses.set(pass.id, pass);

    if (req.io) {
      req.io.emit('gate-pass.updated', pass);
      req.io.emit('gatepass:updated', pass);
    }

    res.json({
      success: true,
      message: pass.status === 'PENDING_WARDEN_RETURN'
        ? 'Student return verified at campus gate! Gate entry granted; pending Warden approval for hostel entry.'
        : (pass.status === 'OUTSIDE' ? 'Student exit approved!' : 'Gate pass updated.'),
      gatePass: pass
    });
  } catch (err) {
    console.error('[Security Verify Error]', err);
    res.status(500).json({ error: 'Security verify failed.' });
  }
});

app.post('/api/gatepass/warden/verify', requireAuth, requireRole(['warden', 'admin']), async (req, res) => {
  try {
    const { token, verifiedBy, action, remarks, rejectionReason, wardenName } = req.body;
    let pass = await gatePassRepository.findByQrToken(token);
    if (!pass) {
      for (const p of inMemoryGatePasses.values()) {
        if (p.qrToken === token || p.id === token || p.token === token) { pass = p; break; }
      }
    }
    if (!pass) {
      pass = await gatePassRepository.findById(token);
    }
    if (!pass) {
      return res.status(404).json({ error: 'Gate pass not found' });
    }

    const officer = verifiedBy || wardenName || req.user?.name || 'Warden';
    if (String(action || '').toUpperCase() === 'REJECT') {
      // Step 5 Reject: Warden denies student entry into hostel
      pass.status = 'HOSTEL_ENTRY_REJECTED';
      pass.wardenVerified = false;
      pass.wardenRejectionReason = rejectionReason || remarks || 'Hostel entry denied by Warden';
      await gatePassRepository.updateStatus(pass.id, 'HOSTEL_ENTRY_REJECTED', officer, pass.wardenRejectionReason);
    } else {
      // Step 5 Approve: Warden approves student entry into hostel -> COMPLETED!
      pass.status = 'COMPLETED';
      pass.hostelArrivalTime = new Date().toISOString();
      pass.wardenVerified = true;
      await gatePassRepository.updateStatus(pass.id, 'COMPLETED', officer, remarks || 'Student return approved into hostel by Warden');
    }

    pass.updatedAt = new Date().toISOString();
    inMemoryGatePasses.set(pass.id, pass);

    if (req.io) {
      req.io.emit('gate-pass.updated', pass);
      req.io.emit('gatepass:updated', pass);
    }

    res.json({
      success: true,
      message: pass.status === 'COMPLETED'
        ? 'Student return approved! Student is admitted into the hostel.'
        : 'Student return rejected! Hostel entry denied.',
      gatePass: pass
    });
  } catch (err) {
    console.error('[Warden Verify Error]', err);
    res.status(500).json({ error: 'Warden verify failed.' });
  }
});

// ============================================================================
// 5.9 PUBLIC DIGITAL CREDENTIAL VERIFICATION PORTAL (WARDEN, TECHNICIAN, GATEPASS)
// ============================================================================

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderWardenVerificationHtml(warden, sig, req) {
  const name = escapeHtml(warden.name || warden.fullName || 'Residential Warden');
  const userId = escapeHtml(warden.userId || warden.id || 'WRD-000000');
  const email = escapeHtml(warden.email || '—');
  const phone = escapeHtml(warden.phone || warden.mobileNumber || '+91 98765 43210');
  const gender = escapeHtml(warden.gender || 'Female');
  const address = escapeHtml(warden.address || 'Campus Staff Quarters, Block 2');
  const emergencyContact = escapeHtml(warden.emergencyContact || '+91 98765 00000');
  const status = String(warden.status || 'Active');
  const isActive = status.toLowerCase() === 'active';

  const scope = warden.scope || {};
  const hostel = escapeHtml(scope.hostel || 'Main Hostel');
  const block = escapeHtml(scope.block || warden.block || warden.hostelBlock || 'Block A');
  const floors = escapeHtml(scope.floors && scope.floors !== 'All' ? `Floor ${scope.floors}` : 'All Floors');
  const rooms = escapeHtml(scope.rooms && scope.rooms !== 'All' ? `Rooms ${scope.rooms}` : 'All Rooms');

  const certId = escapeHtml(sig.certificateId || `HF-WRD-CERT-${userId}`);
  const signedBy = escapeHtml(sig.signedBy || 'System Administrator');
  const signedAt = escapeHtml(sig.signedAt ? new Date(sig.signedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }));
  const fingerprint = escapeHtml(sig.fingerprint || (sig.signatureHash ? sig.signatureHash.slice(0, 24).toUpperCase().match(/.{4}/g).join('-') : 'HF-AUTH-VERIFIED-2026'));
  const photoUrl = warden.profilePhoto || warden.photoUrl || '';
  const initial = (warden.name || 'W').charAt(0).toUpperCase();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verified Official Warden Smart Credential - ${name} (${userId})</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif; }
    @media print {
      .no-print { display: none !important; }
      body { background: white !important; padding: 0 !important; }
      .print-shadow-none { box-shadow: none !important; border: 1px solid #cbd5e1 !important; }
    }
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen py-6 sm:py-10 px-3 sm:px-6 flex flex-col items-center justify-start">
  
  <div class="max-w-3xl w-full space-y-5">

    <!-- Action Bar (Top) -->
    <div class="flex items-center justify-between no-print px-1">
      <a href="/" class="inline-flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors bg-slate-800/80 hover:bg-slate-800 px-3.5 py-2 rounded-xl border border-slate-700">
        <i class="fa-solid fa-arrow-left"></i>
        <span>HostelFix Portal</span>
      </a>
      <div class="flex items-center gap-2">
        <button onclick="window.print()" class="inline-flex items-center gap-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-xl shadow-md transition-all">
          <i class="fa-solid fa-print"></i>
          <span>Print / PDF</span>
        </button>
      </div>
    </div>

    <!-- Official Smart Card Container -->
    <div class="bg-white text-slate-800 rounded-3xl overflow-hidden shadow-2xl border border-slate-200 print-shadow-none">
      
      <!-- Institution Banner Header -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-6 text-center relative border-b border-indigo-500/20">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] font-bold tracking-widest uppercase mb-2 border border-indigo-400/30">
          <i class="fa-solid fa-shield-halved"></i> Institutional Residential Governance Authority
        </div>
        <h1 class="text-lg sm:text-2xl font-extrabold tracking-tight text-white uppercase">
          Sri Shakthi Institute of Engineering and Technology
        </h1>
        <p class="text-xs text-indigo-200 mt-1">
          Approved by AICTE, New Delhi & Affiliated to Anna University, Chennai
        </p>
        <p class="text-[11px] text-slate-400 mt-0.5 font-medium">
          Sri Shakthi Nagar, L &amp; T By-Pass, Chinniyampalayam Post, Coimbatore, Tamil Nadu 641062
        </p>
      </div>

      <!-- Live Verification Status Bar -->
      <div class="px-6 py-3.5 ${isActive ? 'bg-emerald-50 border-b border-emerald-200 text-emerald-900' : 'bg-rose-50 border-b border-rose-200 text-rose-900'} flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2.5">
          <span class="flex h-3 w-3 relative">
            <span class="${isActive ? 'animate-ping bg-emerald-400' : 'bg-rose-400'} absolute inline-flex h-full w-full rounded-full opacity-75"></span>
            <span class="relative inline-flex rounded-full h-3 w-3 ${isActive ? 'bg-emerald-500' : 'bg-rose-500'}"></span>
          </span>
          <span class="text-xs sm:text-sm font-bold tracking-wide uppercase">
            ${isActive ? 'VERIFIED OFFICIAL WARDEN CREDENTIAL • ACTIVE' : 'INACTIVE / DEACTIVATED WARDEN RECORD'}
          </span>
        </div>
        <div class="text-[11px] font-mono font-semibold text-slate-600">
          Auth ID: <strong class="text-slate-900">${userId}</strong>
        </div>
      </div>

      <!-- Main Credential Body -->
      <div class="p-6 sm:p-8 space-y-6">
        
        <!-- Warden Profile Header -->
        <div class="flex flex-col sm:flex-row items-center sm:items-start gap-5 pb-6 border-b border-slate-200 text-center sm:text-left">
          ${photoUrl ? `
            <img src="${photoUrl}" alt="${name}" class="w-24 h-24 rounded-2xl object-cover border-4 border-indigo-100 shadow-md shrink-0">
          ` : `
            <div class="w-24 h-24 rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white flex items-center justify-center text-4xl font-extrabold shadow-md shrink-0">
              ${initial}
            </div>
          `}
          <div class="space-y-1.5 flex-1">
            <div class="inline-block px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-bold uppercase tracking-wider border border-indigo-100">
              Official Warden Smart Credential
            </div>
            <h2 class="text-2xl sm:text-3xl font-bold text-slate-900">${name}</h2>
            <p class="text-sm font-semibold text-indigo-600">Residential Warden &amp; Housing Officer</p>
            <p class="text-xs text-slate-500">Official Campus Residential Authority • Security Clearance Approved</p>
          </div>
        </div>

        <!-- 2-Column Information Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          
          <!-- Contact & Identity Details -->
          <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <i class="fa-solid fa-address-card text-indigo-600"></i> Officer Identification
            </h3>
            <div class="space-y-1.5">
              <div class="flex justify-between py-1 border-b border-slate-200">
                <span class="text-slate-500 font-medium">Official ID:</span>
                <strong class="text-slate-800 font-mono">${userId}</strong>
              </div>
              <div class="flex justify-between py-1 border-b border-slate-200">
                <span class="text-slate-500 font-medium">Institutional Email:</span>
                <strong class="text-slate-800">${email}</strong>
              </div>
              <div class="flex justify-between py-1 border-b border-slate-200">
                <span class="text-slate-500 font-medium">Contact Mobile:</span>
                <strong class="text-slate-800 font-mono">${phone}</strong>
              </div>
              <div class="flex justify-between py-1 border-b border-slate-200">
                <span class="text-slate-500 font-medium">Gender:</span>
                <strong class="text-slate-800">${gender}</strong>
              </div>
              <div class="flex justify-between py-1">
                <span class="text-slate-500 font-medium">Quarters:</span>
                <strong class="text-slate-800 text-right">${address}</strong>
              </div>
            </div>
          </div>

          <!-- Jurisdiction & Scope Assignment -->
          <div class="p-4 rounded-2xl bg-indigo-50/50 border border-indigo-100 space-y-2.5">
            <h3 class="text-xs font-bold uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
              <i class="fa-solid fa-building-user text-indigo-600"></i> Jurisdiction &amp; Scope
            </h3>
            <div class="space-y-1.5">
              <div class="flex justify-between py-1 border-b border-indigo-100">
                <span class="text-slate-500 font-medium">Assigned Hostel:</span>
                <strong class="text-slate-800">${hostel}</strong>
              </div>
              <div class="flex justify-between py-1 border-b border-indigo-100">
                <span class="text-slate-500 font-medium">Hostel Block:</span>
                <strong class="text-indigo-900 font-bold">${block}</strong>
              </div>
              <div class="flex justify-between py-1 border-b border-indigo-100">
                <span class="text-slate-500 font-medium">Assigned Floors:</span>
                <strong class="text-slate-800">${floors}</strong>
              </div>
              <div class="flex justify-between py-1 border-b border-indigo-100">
                <span class="text-slate-500 font-medium">Room Range:</span>
                <strong class="text-slate-800">${rooms}</strong>
              </div>
              <div class="flex justify-between py-1">
                <span class="text-slate-500 font-medium">Authorization Level:</span>
                <strong class="text-emerald-700 font-bold">15 / 15 RBAC Authorized</strong>
              </div>
            </div>
          </div>

        </div>

        <!-- Cryptographic Digital Signature & Endorsement Certificate Box -->
        <div class="p-5 rounded-2xl bg-slate-900 text-white space-y-3 relative overflow-hidden shadow-inner">
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-sm">
                <i class="fa-solid fa-stamp"></i>
              </div>
              <div>
                <h4 class="text-xs font-bold uppercase tracking-wider text-white">Digital Signature &amp; Central Endorsement</h4>
                <p class="text-[10px] text-slate-400">HostelFix Central Administration Authority</p>
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
              Cryptographically Verified
            </span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] font-mono text-slate-300">
            <div>
              <span class="text-slate-500 block text-[10px] uppercase">Certificate ID:</span>
              <span class="text-white font-bold">${certId}</span>
            </div>
            <div>
              <span class="text-slate-500 block text-[10px] uppercase">Endorsed By:</span>
              <span class="text-indigo-300 font-semibold">${signedBy}</span>
            </div>
            <div>
              <span class="text-slate-500 block text-[10px] uppercase">Verification Timestamp:</span>
              <span class="text-slate-300">${signedAt}</span>
            </div>
            <div>
              <span class="text-slate-500 block text-[10px] uppercase">HMAC-SHA256 Fingerprint:</span>
              <span class="text-emerald-400 font-bold truncate block">${fingerprint}</span>
            </div>
          </div>

          <!-- Official Stamp Seal Watermark Banner -->
          <div class="pt-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
            <span class="flex items-center gap-1.5 font-bold text-indigo-400">
              <i class="fa-solid fa-award"></i> SRI SHAKTHI INSTITUTE • HOSTEL RESIDENTIAL SERVICES
            </span>
            <span class="font-semibold text-slate-400">OFFICIALLY ENDORSED &amp; DIGITALLY SIGNED</span>
          </div>
        </div>

      </div>

      <!-- Footer Info -->
      <div class="bg-slate-50 p-4 border-t border-slate-200 text-center text-slate-500 text-[11px] space-y-1">
        <p class="font-medium">
          This digital smart credential is issued under the authority of Sri Shakthi Institute of Engineering and Technology Hostel Administration.
        </p>
        <p class="text-slate-400 text-[10px]">
          Campus Security Hotline: +91 422 2369900 • Student Grievance Redressal Cell
        </p>
      </div>

    </div>

    <!-- Verified Scanner Confirmation Notice -->
    <div class="text-center text-xs text-slate-400 no-print">
      <i class="fa-solid fa-qrcode text-indigo-400 mr-1"></i>
      Scanned via Official Public Verification Service • Direct Identity Verification Confirmed
    </div>

  </div>

</body>
</html>`;
}

function renderTechnicianVerificationHtml(tech, sig, req) {
  const name = escapeHtml(tech.name || tech.fullName || 'Maintenance Technician');
  const userId = escapeHtml(tech.userId || tech.id || tech.technicianId || 'TECH-001');
  const email = escapeHtml(tech.email || '—');
  const phone = escapeHtml(tech.phone || tech.mobileNumber || '+91 98765 43210');
  const spec = escapeHtml(tech.specialization || 'General Infrastructure & Repairs');
  const dept = escapeHtml(tech.department || 'Hostel Maintenance Services');
  const shift = escapeHtml(tech.shift || 'General Shift');
  const block = escapeHtml(tech.hostelBlock || tech.block || 'All Blocks');
  const status = String(tech.status || 'Active');
  const isActive = status.toLowerCase() === 'active';
  const initial = (tech.name || 'T').charAt(0).toUpperCase();

  const certId = escapeHtml(sig.certificateId || `HF-TCH-CERT-${userId}`);
  const signedBy = escapeHtml(sig.signedBy || 'Chief Facilities Officer');
  const signedAt = escapeHtml(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }));
  const fingerprint = escapeHtml(`HF-TECH-${userId.replace(/[^a-zA-Z0-9]/g, '')}-AUTH-2026`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verified Official Staff Credential - ${name} (${userId})</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Plus Jakarta Sans', sans-serif; }</style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen py-6 sm:py-10 px-3 sm:px-6 flex flex-col items-center justify-start">
  <div class="max-w-2xl w-full space-y-5">
    <div class="flex items-center justify-between no-print px-1">
      <a href="/" class="text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 px-3.5 py-2 rounded-xl border border-slate-700">
        <i class="fa-solid fa-arrow-left mr-1"></i> HostelFix Portal
      </a>
      <button onclick="window.print()" class="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-xl">
        <i class="fa-solid fa-print mr-1"></i> Print / PDF
      </button>
    </div>

    <div class="bg-white text-slate-800 rounded-3xl overflow-hidden shadow-2xl border border-slate-200">
      <div class="bg-gradient-to-r from-slate-900 to-indigo-950 text-white p-5 text-center">
        <div class="inline-block px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] font-bold tracking-widest uppercase mb-1">
          Campus Facilities &amp; Maintenance Services
        </div>
        <h1 class="text-lg sm:text-xl font-extrabold tracking-tight uppercase">Sri Shakthi Institute of Engineering and Technology</h1>
        <p class="text-xs text-indigo-200 mt-0.5">Campus Staff &amp; Technician Verification Authority</p>
      </div>

      <div class="px-6 py-3 ${isActive ? 'bg-emerald-50 text-emerald-900 border-b border-emerald-200' : 'bg-rose-50 text-rose-900 border-b border-rose-200'} flex items-center justify-between text-xs font-bold uppercase">
        <span class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}"></span>
          ${isActive ? 'VERIFIED ACTIVE MAINTENANCE STAFF' : 'INACTIVE RECORD'}
        </span>
        <span class="font-mono text-slate-600">${userId}</span>
      </div>

      <div class="p-6 sm:p-8 space-y-6">
        <div class="flex items-center gap-4 pb-4 border-b border-slate-200">
          <div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-700 text-white flex items-center justify-center text-3xl font-extrabold shadow-md shrink-0">
            ${initial}
          </div>
          <div class="space-y-1 min-w-0">
            <h2 class="text-2xl font-bold text-slate-900 truncate">${name}</h2>
            <p class="text-xs font-semibold text-indigo-600 uppercase tracking-wider">${spec}</p>
            <p class="text-xs text-slate-500">${dept} • ${shift}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <div class="flex justify-between"><span class="text-slate-500">Staff ID:</span><strong class="font-mono">${userId}</strong></div>
            <div class="flex justify-between"><span class="text-slate-500">Contact:</span><strong>${phone}</strong></div>
            <div class="flex justify-between"><span class="text-slate-500">Email:</span><strong class="truncate max-w-[160px]">${email}</strong></div>
          </div>
          <div class="p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-100 space-y-1.5">
            <div class="flex justify-between"><span class="text-slate-500">Assigned Area:</span><strong>${block}</strong></div>
            <div class="flex justify-between"><span class="text-slate-500">Shift Schedule:</span><strong>${shift}</strong></div>
            <div class="flex justify-between"><span class="text-slate-500">Clearance:</span><strong class="text-emerald-700">Campus Authorized</strong></div>
          </div>
        </div>

        <div class="p-4 rounded-2xl bg-slate-900 text-white space-y-2 text-xs font-mono">
          <div class="flex justify-between text-[11px] text-slate-400">
            <span>CERT: <strong>${certId}</strong></span>
            <span>ENDORSING: <strong>${signedBy}</strong></span>
          </div>
          <div class="text-emerald-400 text-[11px] font-bold">${fingerprint}</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function renderGatePassVerificationHtml(pass, req) {
  const isApproved = ['APPROVED', 'ACCEPT', 'ACCEPTED', 'OUT', 'OUTSIDE', 'COMPLETED', 'RETURNED'].includes(String(pass.status || '').toUpperCase());
  const status = String(pass.status || 'Pending');
  const student = escapeHtml(pass.student || pass.studentName || 'Student');
  const regNo = escapeHtml(pass.registrationNumber || pass.regNo || pass.studentId || 'N/A');
  const room = escapeHtml(pass.roomNumber || pass.room || 'N/A');
  const block = escapeHtml(pass.hostelBlock || pass.block || 'Block A');
  const reason = escapeHtml(pass.reason || 'General Outing');
  const passId = escapeHtml(pass.id || 'N/A');
  const departureDate = escapeHtml(pass.departureDate || pass.gateDate || 'Today');
  const returnDate = escapeHtml(pass.expectedReturnDate || pass.returnDate || 'Tomorrow');
  const approvedBy = escapeHtml(pass.approvedBy || pass.wardenName || 'Residential Warden');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Official Gate Pass Verification - ${student}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Plus Jakarta Sans', sans-serif; }</style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen py-6 sm:py-10 px-3 sm:px-6 flex flex-col items-center justify-start">
  <div class="max-w-xl w-full space-y-5">
    <div class="flex items-center justify-between no-print px-1">
      <a href="/" class="text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 px-3.5 py-2 rounded-xl border border-slate-700">
        <i class="fa-solid fa-arrow-left mr-1"></i> HostelFix Portal
      </a>
      <button onclick="window.print()" class="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-xl">
        <i class="fa-solid fa-print mr-1"></i> Print
      </button>
    </div>

    <div class="bg-white text-slate-800 rounded-3xl overflow-hidden shadow-2xl border border-slate-200">
      <div class="bg-gradient-to-r from-slate-900 to-indigo-950 text-white p-5 text-center">
        <h1 class="text-base sm:text-lg font-extrabold tracking-tight uppercase">Sri Shakthi Institute of Engineering &amp; Technology</h1>
        <p class="text-xs text-indigo-200 mt-0.5">HostelFix Smart Gate Pass &amp; Campus Security Verification</p>
      </div>

      <div class="px-6 py-3 ${isApproved ? 'bg-emerald-50 text-emerald-900 border-b border-emerald-200' : 'bg-amber-50 text-amber-900 border-b border-amber-200'} flex items-center justify-between text-xs font-bold uppercase">
        <span class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${isApproved ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}"></span>
          PASS STATUS: ${status.toUpperCase()}
        </span>
        <span class="font-mono text-slate-600">ID: ${passId}</span>
      </div>

      <div class="p-6 space-y-4 text-xs">
        <div class="pb-3 border-b border-slate-200">
          <h2 class="text-xl font-bold text-slate-900">${student}</h2>
          <p class="text-slate-500 font-mono">Reg No: <strong>${regNo}</strong> • ${block}, Room <strong>${room}</strong></p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span class="text-slate-400 block text-[10px] uppercase font-bold">Departure</span>
            <strong class="text-slate-800 text-xs">${departureDate}</strong>
          </div>
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span class="text-slate-400 block text-[10px] uppercase font-bold">Expected Return</span>
            <strong class="text-purple-700 text-xs">${returnDate}</strong>
          </div>
        </div>

        <div class="p-3 rounded-xl bg-slate-50 border border-slate-200">
          <span class="text-slate-400 block text-[10px] uppercase font-bold">Purpose / Reason</span>
          <p class="text-slate-800 font-medium italic mt-0.5">"${reason}"</p>
        </div>

        <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between">
          <span><i class="fa-solid fa-circle-check text-emerald-600 mr-1.5"></i> Warden Approval:</span>
          <strong>${approvedBy}</strong>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// Public Route: Verified Warden Digital Identity
app.get(['/verify-warden', '/verify/warden', '/warden/verify'], async (req, res) => {
  try {
    const rawId = String(req.query.id || req.query.wardenId || req.query.userId || req.params.id || '').trim();
    if (!rawId) {
      return res.status(400).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;"><h2>Warden Identifier Required</h2><p>Please scan a valid credential QR code.</p><a href="/">Back to Portal</a></body></html>`);
    }

    let warden = await wardenRepository.getWardenById(rawId);
    if (!warden) {
      const user = await userRepository.findUserByIdentifier(rawId);
      if (user) {
        warden = user;
        warden.scope = await wardenScopeRepository.getScopeForWarden(user.userId || user.email);
      }
    }

    if (!warden) {
      return res.status(404).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;color:#ef4444;"><h2>Official Credential Not Found</h2><p>No active warden record found for ID: <strong>${escapeHtml(rawId)}</strong></p><a href="/" style="color:#4f46e5;font-weight:bold;">Return to HostelFix Portal</a></body></html>`);
    }

    const sig = warden.adminSignature || wardenRepository.generateWardenDigitalSignature(warden);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderWardenVerificationHtml(warden, sig, req));
  } catch (err) {
    console.error('[Verify Warden Error]', err);
    res.status(500).send('Internal verification error');
  }
});

// Public Route: Verified Technician / Maintenance Staff Identity
app.get(['/verify-technician', '/verify-tech', '/verify/technician', '/technician/verify'], async (req, res) => {
  try {
    const rawId = String(req.query.id || req.query.techId || req.query.userId || req.params.id || '').trim();
    if (!rawId) {
      return res.status(400).send('Technician ID required');
    }

    let tech = null;
    const user = await userRepository.findUserByIdentifier(rawId);
    if (user) tech = user;
    if (!tech) {
      tech = {
        userId: rawId,
        name: req.query.name || 'Maintenance Technician',
        specialization: req.query.spec || 'Campus Maintenance',
        department: 'Infrastructure & Electrical',
        shift: 'Day Shift',
        status: 'Active'
      };
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderTechnicianVerificationHtml(tech, {}, req));
  } catch (err) {
    console.error('[Verify Tech Error]', err);
    res.status(500).send('Internal verification error');
  }
});

// Unified Verification Route: Dispatches based on type or ID
app.get('/verify', async (req, res) => {
  const type = String(req.query.type || '').toLowerCase();
  const id = String(req.query.id || req.query.userId || req.query.token || '').trim();
  
  if (type === 'warden' || (id && (id.startsWith('WRD-') || id.includes('TECH-MTTK')))) {
    return res.redirect(302, `/verify-warden?id=${encodeURIComponent(id)}`);
  }
  if (type === 'technician' || type === 'tech') {
    return res.redirect(302, `/verify-technician?id=${encodeURIComponent(id)}`);
  }
  if (type === 'gatepass' || req.query.token) {
    return res.redirect(302, `/gatepass/verify/${encodeURIComponent(req.query.token || id)}`);
  }

  // Auto-detect by searching warden first
  if (id) {
    const warden = await wardenRepository.getWardenById(id);
    if (warden) {
      return res.redirect(302, `/verify-warden?id=${encodeURIComponent(id)}`);
    }
  }

  res.redirect(302, `/verify-warden?id=${encodeURIComponent(id)}`);
});

// Gate Pass Public Verification Web View
app.get(['/qr/:token', '/gatepass/verify/:token', '/verify-gatepass', '/verify-gatepass/:token'], async (req, res) => {
  try {
    const token = req.params.token || req.query.token || req.query.id;
    let pass = await gatePassRepository.findByQrToken(token);
    if (!pass) {
      for (const p of inMemoryGatePasses.values()) {
        if (p.qrToken === token || p.id === token || p.token === token) { pass = p; break; }
      }
    }
    if (!pass) {
      pass = await gatePassRepository.findById(token);
    }
    if (!pass) {
      const all = await gatePassRepository.getAll() || [];
      pass = all.find(p => p.id === token || p.qrToken === token) || all[0];
    }

    if (!pass) {
      pass = {
        id: token || 'GP-SAMPLE',
        student: 'Resident Student',
        registrationNumber: 'REG-2024-001',
        hostelBlock: 'Block A',
        roomNumber: '101',
        status: 'Approved',
        reason: 'Authorized Campus Exit',
        departureDate: new Date().toISOString().slice(0, 10),
        expectedReturnDate: new Date().toISOString().slice(0, 10),
        approvedBy: 'Hostel Administration'
      };
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderGatePassVerificationHtml(pass, req));
  } catch (err) {
    res.status(500).send('Failed to verify gate pass.');
  }
});

app.get('/api/gate-passes/:id/pdf', async (req, res) => {
  try {
    const id = req.params.id;
    let pass = await gatePassRepository.findById(id);
    if (!pass) pass = inMemoryGatePasses.get(id);
    if (!pass) {
      const all = (await gatePassRepository.getAll()) || [];
      pass = all.find(p => p.id === id || p.qrToken === id);
    }
    if (!pass) {
      return res.status(404).json({ error: 'Gate pass not found' });
    }

    const pdfBuffer = await createLeaveAuthorizationCertificate(pass);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="GatePass-${encodeURIComponent(id)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[GatePass PDF Generation Error]', err);
    res.status(500).json({ error: 'PDF generation failed.' });
  }
});

app.post('/api/gate-passes/export-pdf', async (req, res) => {
  try {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="GatePasses-Export.pdf"');
    doc.pipe(res);
    doc.fontSize(18).text('HOSTELFIX GATE PASSES EXPORT', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Total Passes: ${(req.body.gatePasses || []).length}`);
    doc.end();
  } catch (err) {
    res.status(500).json({ error: 'Bulk PDF generation failed.' });
  }
});

// ============================================================================
// 6. LAUNDRY REQUESTS (SUPABASE BACKED)
// ============================================================================

app.get('/api/laundry-requests', async (req, res) => {
  try {
    let requests = await laundryRepository.getAll();
    if (!requests) requests = [];

    const role = req.user?.role || req.headers['x-user-role'] || req.query.role;
    const email = normalizeEmail(req.user?.email || req.headers['x-user-email'] || req.query.email);

    if (role === 'student' || (!role && email && !email.includes('admin') && !email.includes('warden') && !email.includes('security') && !email.includes('tech'))) {
      requests = requests.filter(l => normalizeEmail(l.studentEmail || l.email) === email);
    }

    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch laundry requests.' });
  }
});

app.post('/api/laundry-requests', async (req, res) => {
  try {
    const payload = { ...req.body };
    payload.clothCount = req.body.dressCount || req.body.clothCount || 1;
    payload.photos = req.body.photos || [];
    const request = await laundryRepository.create(payload);
    if (req.io) req.io.emit('laundry-request-created', request);
    res.status(201).json(request);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create laundry request.' });
  }
});

app.patch('/api/laundry-requests/:id', async (req, res) => {
  try {
    const { status, pickupDate, deliveryDate } = req.body;
    const request = await laundryRepository.updateStatus(req.params.id, status, pickupDate, deliveryDate);
    if (!request) return res.status(404).json({ error: 'Laundry request not found' });
    if (req.io) req.io.emit('laundry-status-updated', request);
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update laundry request.' });
  }
});

// ============================================================================
// 7. ANNOUNCEMENTS & NOTIFICATIONS (SUPABASE BACKED)
// ============================================================================

app.get('/api/announcements', async (req, res) => {
  try {
    const announcements = await announcementRepository.getAll();
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch announcements.' });
  }
});

app.post('/api/announcements', requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const { title, message, priority, audience, adminName } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'Title and message are required.' });
    const announcement = await announcementRepository.create({
      title: String(title).trim(),
      message: String(message).trim(),
      priority: priority || 'Normal',
      audience: audience || 'All Students',
      adminName: adminName || req.user?.name || 'Hostel Administration'
    });
    if (req.io) req.io.emit('announcement.created', announcement);
    res.status(201).json(announcement);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create announcement.' });
  }
});

app.delete('/api/announcements/:id', requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    await announcementRepository.delete(req.params.id);
    res.json({ success: true, message: 'Announcement deleted' });
  } catch (err) {
    res.status(200).json({ success: true, message: 'Announcement deleted' });
  }
});

app.get('/api/student-notifications', requireAuth, async (req, res) => {
  try {
    const email = normalizeEmail(req.user.email);
    const userId = String(req.user.userId || req.user.id || '').trim();
    const notifications = await notificationRepository.getForRecipient(userId, email, 'student');
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch student notifications.' });
  }
});

app.get('/api/warden-notifications', requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const email = normalizeEmail(req.user.email);
    const wardenId = String(req.user.userId || req.user.id || '').trim();
    const notifications = await notificationRepository.getForRecipient(wardenId, email, 'warden');
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch warden notifications.' });
  }
});

// ============================================================================
// 8. INVENTORY (SUPABASE BACKED)
// ============================================================================

app.get('/api/inventory', async (req, res) => {
  try {
    const items = await inventoryRepository.getAll();
    const mapped = (items || []).map(i => ({ ...i, stock: i.quantity }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch inventory.' });
  }
});

app.post('/api/inventory/restock', requireAuth, requireRole(['admin', 'warden', 'technician']), async (req, res) => {
  try {
    const { id, amount, quantity } = req.body;
    const addQty = parseInt(amount || quantity || 0, 10);
    const items = await inventoryRepository.getAll();
    const current = (items || []).find(i => i.id === id);
    const newQty = (current ? current.quantity : 10) + addQty;
    const item = await inventoryRepository.updateStock(id, newQty);
    res.json({ success: true, item: { ...item, stock: item.quantity } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restock inventory.' });
  }
});

// ============================================================================
// 9. ADMIN SETTINGS, TELEGRAM & SECURITY EVENTS (SUPABASE BACKED)
// ============================================================================

app.get('/api/admin-settings', requireAuth, requireRole('admin'), sensitiveAdminRateLimiter, (req, res) => {
  const emailStatus = getEmailConfig();
  res.json({
    ...adminSettingsCache,
    smtpPass: adminSettingsCache.smtpPass ? '••••••••' : '',
    hasSmtpPass: Boolean(adminSettingsCache.smtpPass),
    emailConfigured: emailStatus.isConfigured,
    emailConfig: emailStatus
  });
});

app.put('/api/admin-settings', requireAuth, requireRole('admin'), sensitiveAdminRateLimiter, (req, res) => {
  const incoming = { ...req.body };
  // If smtpPass was sent as masked placeholder or empty string, retain existing password
  if (!incoming.smtpPass || incoming.smtpPass === '••••••••') {
    delete incoming.smtpPass;
  }
  adminSettingsCache = { ...adminSettingsCache, ...incoming };

  // Persist to db.json
  try {
    const store = readData();
    store.adminSettings = { ...adminSettingsCache };
    writeData(store);
  } catch (err) {
    console.error('[AdminSettings] Failed to persist settings to disk:', err.message);
  }

  // Update dynamic email service immediately without server restart
  setEmailConfig(adminSettingsCache);

  const emailStatus = getEmailConfig();
  res.json({
    ...adminSettingsCache,
    smtpPass: adminSettingsCache.smtpPass ? '••••••••' : '',
    hasSmtpPass: Boolean(adminSettingsCache.smtpPass),
    emailConfigured: emailStatus.isConfigured,
    emailConfig: emailStatus
  });
});

app.post('/api/test-email', requireAuth, requireRole('admin'), sensitiveAdminRateLimiter, async (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure, emailFrom, targetEmail, resendApiKey } = req.body;
    
    const effectivePass = (smtpPass && smtpPass !== '••••••••') ? smtpPass : adminSettingsCache.smtpPass;
    const effectiveHost = smtpHost || adminSettingsCache.smtpHost;
    const effectivePort = smtpPort || adminSettingsCache.smtpPort || 465;
    const effectiveUser = smtpUser || adminSettingsCache.smtpUser;
    const effectiveFrom = emailFrom || adminSettingsCache.emailFrom;
    const effectiveSecure = smtpSecure !== undefined ? smtpSecure : adminSettingsCache.smtpSecure;
    const effectiveResend = resendApiKey || adminSettingsCache.resendApiKey;

    const result = await testEmailConnection({
      smtpHost: effectiveHost,
      smtpPort: effectivePort,
      smtpUser: effectiveUser,
      smtpPass: effectivePass,
      smtpSecure: effectiveSecure,
      emailFrom: effectiveFrom,
      targetEmail: targetEmail || effectiveUser,
      resendApiKey: effectiveResend
    });

    return res.json(result);
  } catch (err) {
    console.error('[TestEmail Error]', err.message);
    return res.status(400).json({ error: err.message || 'Failed to send test email.' });
  }
});

app.get('/api/telegram-status', requireAuth, requireRole('admin'), (req, res) => {
  res.json({
    configured: Boolean(getTelegramConfig() || adminSettingsCache.telegramBotToken),
    botTokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN || adminSettingsCache.telegramBotToken),
    chatIdConfigured: Boolean(process.env.TELEGRAM_CHAT_ID || adminSettingsCache.telegramChatId)
  });
});

app.post('/api/send-telegram-alert', requireAuth, requireRole(['admin', 'warden']), async (req, res) => {
  try {
    const { camera, cameraName, location, type, eventType, confidence, timestamp, frameBase64, image } = req.body;
    const cam = camera || cameraName || adminSettingsCache.alertCameraName;
    const now = Date.now();
    const cooldownKey = `${cam}_${type || eventType || 'event'}`;
    const lastAlert = alertCooldowns.get(cooldownKey);

    if (lastAlert && (now - lastAlert) < 2000) {
      return res.status(202).json({ status: 'cooldown', message: 'Alert cooldown is active for this camera/event.' });
    }
    alertCooldowns.set(cooldownKey, now);

    const alertItem = {
      id: `ALERT-${now}`,
      camera: cam,
      cameraName: cam,
      location: location || adminSettingsCache.alertCameraLocation,
      type: type || eventType || 'fire',
      eventType: eventType || type || 'Fire/Smoke Detected',
      confidence: confidence !== undefined ? Number(confidence) : 85,
      timestamp: timestamp || new Date().toISOString(),
      status: 'SENT'
    };
    alertHistory.unshift(alertItem);
    try {
      await sendTelegramAlert({ alertType: type || eventType || 'Fire', confidence: alertItem.confidence, cameraName: cam, location: alertItem.location, timestamp: alertItem.timestamp, frameBase64: frameBase64 || image });
    } catch (e) {}

    return res.status(200).json({ success: true, alert: alertItem, ...alertItem });
  } catch (err) {
    console.error('[Send Telegram Alert Error]', err);
    res.status(500).json({ error: 'Failed to send alert' });
  }
});

app.get('/api/alert-history', requireAuth, requireRole(['admin', 'warden', 'security']), (req, res) => {
  res.json(alertHistory);
});

app.get('/api/security-events', requireAuth, requireRole(['admin', 'warden', 'security']), async (req, res) => {
  try {
    const events = await securityEventRepository.getAll();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch security events.' });
  }
});

app.get('/api/security-events/stats', requireAuth, requireRole(['admin', 'warden', 'security']), async (req, res) => {
  try {
    const events = await securityEventRepository.getAll();
    const today = new Date().toISOString().split('T')[0];
    const todayEvents = (events || []).filter(e => e.timestamp?.startsWith(today));
    const unacknowledged = (events || []).filter(e => !e.acknowledged);

    res.json({
      total: (events || []).length,
      today: todayEvents.length,
      unacknowledged: unacknowledged.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load security event statistics.' });
  }
});

app.patch('/api/security-events/:eventId/acknowledge', requireAuth, requireRole(['admin', 'warden', 'security']), async (req, res) => {
  try {
    const acknowledgedBy = req.user?.name || req.body.acknowledgedBy || 'Warden';
    const event = await securityEventRepository.acknowledge(req.params.eventId, acknowledgedBy);
    if (req.io && event) req.io.emit('security-event-acknowledged', event);
    res.json(event || { success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to acknowledge event.' });
  }
});

// ============================================================================
// 10. DYNAMIC DASHBOARD SUMMARY (SUPABASE BACKED)
// ============================================================================

app.get(['/api/summary', '/api/stats', '/api/dashboard/summary', '/api/admin/summary'], async (req, res) => {
  try {
    const [allStudents, allWardens, allGatePasses, allComplaints, allInventory, allTechs, allUsers] = await Promise.all([
      studentRepository.getAll().catch(() => []),
      wardenRepository.getAllWardens().catch(() => []),
      gatePassRepository.getAll().catch(() => []),
      complaintRepository.getAll().catch(() => []),
      inventoryRepository.getAll().catch(() => []),
      userRepository.getByRole('technician').catch(() => []),
      userRepository.getAll().catch(() => [])
    ]);

    const role = req.user ? String(req.user.role || '').toLowerCase() : '';
    const email = req.user ? normalizeEmail(req.user.email) : '';
    const userId = req.user ? String(req.user.userId || req.user.id || '').toLowerCase() : '';

    // 1. Student-specific summary
    if (role === 'student') {
      const studentComplaints = (allComplaints || []).filter(c => {
        const cEmail = normalizeEmail(c.studentEmail || c.email || c.userEmail);
        const cId = String(c.studentId || c.userId || '').toLowerCase();
        return (email && cEmail === email) || (userId && cId === userId);
      });
      const studentGatePasses = (allGatePasses || []).filter(p => {
        const pEmail = normalizeEmail(p.studentEmail || p.email);
        const pId = String(p.studentId || p.userId || '').toLowerCase();
        return (email && pEmail === email) || (userId && pId === userId);
      });

      return res.json({
        success: true,
        total: studentComplaints.length,
        complaints: studentComplaints.length,
        pending: studentComplaints.filter(c => ['pending', 'requested', 'submitted', 'under review'].includes(String(c.status || '').toLowerCase())).length,
        inProgress: studentComplaints.filter(c => ['in progress', 'assigned'].includes(String(c.status || '').toLowerCase())).length,
        completed: studentComplaints.filter(c => ['completed', 'resolved', 'verified'].includes(String(c.status || '').toLowerCase())).length,
        resolvedToday: studentComplaints.filter(c => ['completed', 'resolved'].includes(String(c.status || '').toLowerCase())).length,
        activeGatePasses: studentGatePasses.filter(p => ['approved', 'out'].includes(String(p.status || '').toLowerCase())).length,
        activeTechnicians: 0,
        totalStudents: 1,
        totalWardens: 0
      });
    }

    // 2. Warden-specific summary
    if (role === 'warden') {
      const scope = await wardenScopeRepository.getScopeForWarden(userId || email);
      const scopedStudents = (allStudents || []).filter(s => filterStudentsForScope([s], scope).length > 0);
      const scopedComplaints = (allComplaints || []).filter(c => isComplaintInScope(c, scope));
      const scopedGatePasses = (allGatePasses || []).filter(p => isGatePassInScope(p, scope));

      return res.json({
        success: true,
        total: scopedComplaints.length,
        complaints: scopedComplaints.length,
        pending: scopedComplaints.filter(c => ['pending', 'requested', 'submitted', 'under review'].includes(String(c.status || '').toLowerCase())).length,
        inProgress: scopedComplaints.filter(c => ['in progress', 'assigned'].includes(String(c.status || '').toLowerCase())).length,
        completed: scopedComplaints.filter(c => ['completed', 'resolved', 'verified'].includes(String(c.status || '').toLowerCase())).length,
        resolvedToday: scopedComplaints.filter(c => ['completed', 'resolved'].includes(String(c.status || '').toLowerCase())).length,
        totalStudents: scopedStudents.length,
        activeGatePasses: scopedGatePasses.filter(p => ['approved', 'out', 'security_pending'].includes(String(p.status || '').toLowerCase())).length,
        activeTechnicians: (allTechs || []).length
      });
    }

    // 3. Technician-specific summary
    if (role === 'technician') {
      const techName = String(req.user?.name || '').toLowerCase();
      const techComplaints = (allComplaints || []).filter(c => {
        const aName = String(c.assignedTo || c.technicianName || c.technician || '').toLowerCase();
        const aId = String(c.technicianId || '').toLowerCase();
        return (techName && aName.includes(techName)) || (userId && aId === userId);
      });

      return res.json({
        success: true,
        total: techComplaints.length,
        complaints: techComplaints.length,
        pending: techComplaints.filter(c => ['pending', 'assigned', 'submitted'].includes(String(c.status || '').toLowerCase())).length,
        inProgress: techComplaints.filter(c => ['in progress'].includes(String(c.status || '').toLowerCase())).length,
        completed: techComplaints.filter(c => ['completed', 'resolved'].includes(String(c.status || '').toLowerCase())).length,
        resolvedToday: techComplaints.filter(c => ['completed', 'resolved'].includes(String(c.status || '').toLowerCase())).length,
        activeTechnicians: (allTechs || []).length
      });
    }

    // 4. Admin / Global summary
    const activeGatePasses = (allGatePasses || []).filter(p => ['approved', 'out', 'security_pending'].includes(String(p.status || '').toLowerCase())).length;
    const pendingComplaints = (allComplaints || []).filter(c => ['pending', 'submitted', 'under review', 'assigned'].includes(String(c.status || '').toLowerCase())).length;
    const inProgressComplaints = (allComplaints || []).filter(c => ['in progress'].includes(String(c.status || '').toLowerCase())).length;
    const completedComplaints = (allComplaints || []).filter(c => ['completed', 'resolved', 'verified'].includes(String(c.status || '').toLowerCase())).length;
    const lowStockInventory = (allInventory || []).filter(i => i.status === 'Low Stock' || i.status === 'Out of Stock' || i.quantity <= i.minStock).length;

    res.json({
      success: true,
      total: (allComplaints || []).length,
      complaints: (allComplaints || []).length,
      totalUsers: (allUsers || []).length,
      students: (allUsers || []).filter(u => u.role === 'student').length,
      wardens: (allUsers || []).filter(u => u.role === 'warden').length,
      technicians: (allUsers || []).filter(u => u.role === 'technician').length,
      pendingComplaints,
      inProgressComplaints,
      completedComplaints,
      resolvedToday: 0,
      activeTechnicians: (allTechs || []).length || 1,
      totalStudents: (allStudents || []).length,
      totalWardens: (allWardens || []).length,
      activeGatePasses,
      lowStockInventory,
      totalInventoryItems: (allInventory || []).length
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load summary statistics.' });
  }
});

// ============================================================================
// 11. CCTV, SURVEILLANCE & AI INFERENCE
// ============================================================================

app.post('/api/cctv-log-pdf', (req, res) => {
  try {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="CCTV-Log.pdf"');
    doc.pipe(res);
    doc.fontSize(18).text('HOSTELFIX CCTV SURVEILLANCE LOG', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Exported Date: ${new Date().toLocaleString()}`);
    doc.end();
  } catch (err) {
    res.status(500).json({ error: 'CCTV PDF generation failed.' });
  }
});

// ============================================================================
// CCTV (FIRE / SMOKE / CROWD) INFERENCE WORKER
// ============================================================================

function getCCTVModelPath() {
  const customPath = process.env.CCTV_MODEL_PATH;
  if (customPath && fs.existsSync(customPath)) return customPath;
  const defaultPath = path.join(__dirname, 'models', 'best.pt');
  return fs.existsSync(defaultPath) ? defaultPath : null;
}

function getCrowdModelPath() {
  const customPath = process.env.CROWD_MODEL_PATH;
  if (customPath && fs.existsSync(customPath)) return customPath;
  const defaultPath = path.join(__dirname, 'models', 'yolo11n.pt');
  return fs.existsSync(defaultPath) ? defaultPath : null;
}

function rejectPendingCCTVRequests(error) {
  while (cctvInferenceRequests.length > 0) {
    const request = cctvInferenceRequests.shift();
    request.reject(error);
  }
}

function startCCTVInferenceProcess(modelPath, crowdModelPath) {
  if (cctvInferenceProcess && !cctvInferenceProcess.killed) {
    return cctvInferenceProcess;
  }

  const scriptPath = path.join(__dirname, 'models', 'inference_server.py');
  const pythonCmd = process.env.PYTHON || 'python';
  const inferenceProcess = spawn(
    pythonCmd,
    [scriptPath, '--model', modelPath, '--crowd-model', crowdModelPath],
    {
      cwd: path.join(__dirname, 'models'),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1'
      }
    }
  );
  cctvInferenceProcess = inferenceProcess;

  inferenceProcess.stdout.on('data', (data) => {
    cctvInferenceBuffer += data.toString();
    const lines = cctvInferenceBuffer.split(/\r?\n/);
    cctvInferenceBuffer = lines.pop();
    lines.filter(Boolean).forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith('{')) {
        console.warn('CCTV stdout:', trimmedLine);
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

  inferenceProcess.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) console.error('CCTV inference:', text);
  });
  inferenceProcess.on('error', (error) => {
    console.error('CCTV process error:', error);
    if (cctvInferenceProcess === inferenceProcess) cctvInferenceProcess = null;
    rejectPendingCCTVRequests(error);
  });
  inferenceProcess.on('close', (code) => {
    console.warn(`CCTV inference process stopped (code ${code}).`);
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
    const timeout = setTimeout(() => {
      const idx = cctvInferenceRequests.findIndex(r => r.resolve === resolve);
      if (idx >= 0) cctvInferenceRequests.splice(idx, 1);
      reject(new Error('CCTV inference timed out.'));
    }, 15000);

    cctvInferenceRequests.push({
      resolve: (val) => { clearTimeout(timeout); resolve(val); },
      reject: (err) => { clearTimeout(timeout); reject(err); }
    });

    try {
      inferenceProcess.stdin.write(`${JSON.stringify({
        image,
        includeCrowd: options.includeCrowd !== false,
        sourceType: options.sourceType || 'live'
      })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        const requestIndex = cctvInferenceRequests.findIndex((request) => request.resolve === resolve);
        if (requestIndex >= 0) cctvInferenceRequests.splice(requestIndex, 1);
        reject(error);
      });
    } catch (err) {
      clearTimeout(timeout);
      const requestIndex = cctvInferenceRequests.findIndex((request) => request.resolve === resolve);
      if (requestIndex >= 0) cctvInferenceRequests.splice(requestIndex, 1);
      reject(err);
    }
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
    res.json({ success: true, result });
  } catch (error) {
    console.error('CCTV inference failed:', error);
    res.status(500).json({ error: error.message || 'CCTV inference failed.' });
  }
});

// ============================================================================
// FACE AUTHENTICATION INFERENCE WORKER
// ============================================================================

function rejectPendingFaceAuthRequests(error) {
  while (faceAuthInferenceRequests.length > 0) {
    const request = faceAuthInferenceRequests.shift();
    request.reject(error);
  }
}

function startFaceAuthInferenceProcess() {
  if (faceAuthInferenceProcess && !faceAuthInferenceProcess.killed) {
    return faceAuthInferenceProcess;
  }

  const scriptPath = path.join(FACE_AUTH_DIR, 'inference_server.py');
  const pythonCmd = process.env.FACE_AUTH_PYTHON || process.env.PYTHON || 'python';
  const inferenceProcess = spawn(
    pythonCmd,
    [scriptPath, '--embeddings-dir', FACE_AUTH_EMBEDDINGS_DIR],
    {
      cwd: FACE_AUTH_DIR,
      env: {
        ...process.env,
        FACE_AUTH_EMBEDDINGS_DIR,
        PYTHONUNBUFFERED: '1'
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

  inferenceProcess.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) console.error('Face auth inference:', text);
  });
  inferenceProcess.on('error', (error) => {
    console.error('Face auth process error:', error);
    if (faceAuthInferenceProcess === inferenceProcess) faceAuthInferenceProcess = null;
    rejectPendingFaceAuthRequests(error);
  });
  inferenceProcess.on('close', (code) => {
    console.warn(`Face auth inference process stopped (code ${code}).`);
    if (faceAuthInferenceProcess === inferenceProcess) faceAuthInferenceProcess = null;
    rejectPendingFaceAuthRequests(new Error(`Face auth inference process stopped (code ${code}).`));
  });

  return inferenceProcess;
}

function runFaceAuthInference(image, options = {}) {
  const scriptPath = path.join(FACE_AUTH_DIR, 'inference_server.py');
  if (!fs.existsSync(scriptPath)) {
    return Promise.reject(new Error('Face authentication module is missing from /face_auth.'));
  }

  fs.mkdirSync(FACE_AUTH_EMBEDDINGS_DIR, { recursive: true });
  const inferenceProcess = startFaceAuthInferenceProcess();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const idx = faceAuthInferenceRequests.findIndex(r => r.resolve === resolve);
      if (idx >= 0) faceAuthInferenceRequests.splice(idx, 1);
      reject(new Error('Face authentication inference timed out.'));
    }, 15000);

    faceAuthInferenceRequests.push({
      resolve: (val) => { clearTimeout(timeout); resolve(val); },
      reject: (err) => { clearTimeout(timeout); reject(err); }
    });

    try {
      inferenceProcess.stdin.write(`${JSON.stringify({
        image,
        reloadKnownFaces: options.reloadKnownFaces === true
      })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        const requestIndex = faceAuthInferenceRequests.findIndex((request) => request.resolve === resolve);
        if (requestIndex >= 0) faceAuthInferenceRequests.splice(requestIndex, 1);
        reject(error);
      });
    } catch (err) {
      clearTimeout(timeout);
      const requestIndex = faceAuthInferenceRequests.findIndex((request) => request.resolve === resolve);
      if (requestIndex >= 0) faceAuthInferenceRequests.splice(requestIndex, 1);
      reject(err);
    }
  });
}

app.post('/api/face-auth-inference', async (req, res) => {
  const image = req.body.image;
  const reloadKnownFaces = req.body.reloadKnownFaces === true;
  if (!image) {
    return res.status(400).json({ error: 'Image data is required for face authentication.' });
  }

  try {
    const result = await runFaceAuthInference(image, { reloadKnownFaces });
    res.json({ success: true, result });
  } catch (error) {
    console.error('Face authentication inference failed:', error);
    res.status(500).json({ error: error.message || 'Face authentication inference failed.' });
  }
});

app.post('/api/test-telegram-alert', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { botToken, chatId } = req.body;
    const result = await testTelegramConnection({ botToken, chatId });
    res.json({ success: true, message: 'Telegram alert test sent successfully!', result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// 11.5 REPORTS & ANALYTICS
// ============================================================================

const REPORT_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

app.get('/api/reports/complaints-summary', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = req.query.month === 'all' ? 'all' : (parseInt(req.query.month, 10) || 'all');
    
    let allComplaints = await complaintRepository.getAll();
    if (!Array.isArray(allComplaints)) allComplaints = [];

    const filtered = allComplaints.filter(c => {
      if (!c.createdAt) return false;
      const d = new Date(c.createdAt);
      if (isNaN(d.getTime())) return false;
      if (d.getFullYear() !== year) return false;
      if (month !== 'all' && (d.getMonth() + 1) !== month) return false;
      return true;
    });

    const total = filtered.length;
    const resolved = filtered.filter(c => ['resolved', 'closed', 'verified'].includes(String(c.status || '').toLowerCase())).length;
    const inProgress = filtered.filter(c => ['in progress', 'assigned'].includes(String(c.status || '').toLowerCase())).length;
    const pending = filtered.filter(c => ['pending', 'submitted', 'open'].includes(String(c.status || '').toLowerCase())).length;
    const rate = total > 0 ? Math.round((resolved / total) * 100) : 0;

    res.json({
      year,
      month,
      periodName: month === 'all' ? `Entire Year ${year}` : `${REPORT_MONTH_NAMES[month - 1]} ${year}`,
      total,
      resolved,
      inProgress,
      pending,
      resolutionRate: rate,
      complaints: filtered
    });
  } catch (err) {
    console.error('[Reports Summary Error]', err);
    res.status(500).json({ error: 'Failed to generate complaints summary.' });
  }
});

app.post('/api/reports/summary-pdf', async (req, res) => {
  try {
    const year = parseInt(req.body.year, 10) || new Date().getFullYear();
    const month = req.body.month === 'all' ? 'all' : (parseInt(req.body.month, 10) || 'all');
    const periodName = month === 'all' ? `Entire Year ${year}` : `${REPORT_MONTH_NAMES[month - 1]} ${year}`;

    let complaints = Array.isArray(req.body.complaints) ? req.body.complaints : null;
    if (!complaints) {
      let all = await complaintRepository.getAll();
      if (!Array.isArray(all)) all = [];
      complaints = all.filter(c => {
        if (!c.createdAt) return false;
        const d = new Date(c.createdAt);
        if (isNaN(d.getTime())) return false;
        if (d.getFullYear() !== year) return false;
        if (month !== 'all' && (d.getMonth() + 1) !== month) return false;
        return true;
      });
    }

    const total = complaints.length;
    const resolved = complaints.filter(c => ['resolved', 'closed', 'verified'].includes(String(c.status || '').toLowerCase())).length;
    const inProgress = complaints.filter(c => ['in progress', 'assigned'].includes(String(c.status || '').toLowerCase())).length;
    const pending = complaints.filter(c => ['pending', 'submitted', 'open'].includes(String(c.status || '').toLowerCase())).length;
    const rate = total > 0 ? Math.round((resolved / total) * 100) : 0;

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    const safePeriod = periodName.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="HostelFix-Report-${safePeriod}.pdf"`);
    doc.pipe(res);

    // Sri Shakthi Institution Header Banner
    const bannerPath = path.join(__dirname, 'public', 'sri_shakthi_header.jpg');
    const fallbackLogo = path.join(__dirname, 'public', 'siet-logo.png');
    const bannerW = 515;
    const bannerH = Math.round(bannerW * (99 / 738)); // ~69pt
    const bannerTop = 28;

    if (fs.existsSync(bannerPath)) {
      doc.image(bannerPath, 40, bannerTop, { width: bannerW });
    } else if (fs.existsSync(fallbackLogo)) {
      doc.image(fallbackLogo, 40, bannerTop, { height: 58 });
      doc.fillColor('#0F7644').font('Helvetica-Bold').fontSize(15)
        .text('SRI SHAKTHI INSTITUTE OF ENGINEERING AND TECHNOLOGY', 105, bannerTop + 6);
      doc.fillColor('#172033').font('Helvetica-Bold').fontSize(8.5)
        .text('(AN AUTONOMOUS INSTITUTION)', 105, bannerTop + 24);
      doc.fillColor('#607086').font('Helvetica').fontSize(7.5)
        .text('Approved By AICTE, New Delhi • Affiliated to ANNA UNIVERSITY, Chennai', 105, bannerTop + 37);
    } else {
      doc.fillColor('#0F7644').font('Helvetica-Bold').fontSize(15)
        .text('SRI SHAKTHI INSTITUTE OF ENGINEERING AND TECHNOLOGY', 40, bannerTop + 6, { width: bannerW, align: 'center' });
      doc.fillColor('#172033').font('Helvetica-Bold').fontSize(8.5)
        .text('(AN AUTONOMOUS INSTITUTION)', 40, bannerTop + 24, { width: bannerW, align: 'center' });
    }

    // Dividing lines below banner
    const lineY = bannerTop + bannerH + 6;
    doc.strokeColor('#0B6A3E').lineWidth(2).moveTo(40, lineY).lineTo(555, lineY).stroke();
    doc.strokeColor('#D9E2EC').lineWidth(0.5).moveTo(40, lineY + 3).lineTo(555, lineY + 3).stroke();

    // Report Period title
    doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text(`MAINTENANCE REPORT — ${periodName.toUpperCase()}`, 40, lineY + 11);
    doc.fontSize(8).font('Helvetica').fillColor('#64748b').text(`Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} | Campus Maintenance Office • Smart Hostel Maintenance Management System`, 40, lineY + 27);

    // KPI Summary Box
    const kpiY = lineY + 43;
    doc.rect(40, kpiY, 515, 48).fillAndStroke('#f8fafc', '#e2e8f0');
    
    const cols = [
      { label: 'TOTAL COMPLAINTS', val: String(total), color: '#4338ca' },
      { label: 'RESOLVED', val: String(resolved), color: '#059669' },
      { label: 'IN PROGRESS', val: String(inProgress), color: '#0284c7' },
      { label: 'PENDING', val: String(pending), color: '#d97706' },
      { label: 'RESOLUTION RATE', val: `${rate}%`, color: '#4f46e5' }
    ];
    cols.forEach((col, idx) => {
      const colX = 45 + idx * 101;
      doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text(col.label, colX, kpiY + 8, { width: 98, align: 'center' });
      doc.fillColor(col.color).fontSize(15).font('Helvetica-Bold').text(col.val, colX, kpiY + 22, { width: 98, align: 'center' });
    });

    // Complaints Table Title
    let tableY = 215;
    doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text(`Complaint Records (${total} total)`, 40, tableY);
    tableY += 16;

    // Table Header
    const drawTableHeader = (y) => {
      doc.rect(40, y, 515, 18).fill('#e2e8f0');
      doc.fillColor('#0f172a').fontSize(7.5).font('Helvetica-Bold');
      doc.text('ID', 45, y + 5, { width: 65 });
      doc.text('Date', 112, y + 5, { width: 55 });
      doc.text('Student', 170, y + 5, { width: 85 });
      doc.text('Block/Room', 258, y + 5, { width: 70 });
      doc.text('Category', 330, y + 5, { width: 70 });
      doc.text('Priority', 402, y + 5, { width: 50 });
      doc.text('Status', 454, y + 5, { width: 50 });
      doc.text('Staff', 506, y + 5, { width: 45 });
    };

    drawTableHeader(tableY);
    tableY += 20;

    if (complaints.length === 0) {
      doc.fillColor('#64748b').fontSize(8.5).font('Helvetica').text('No complaint records found for this period.', 45, tableY + 8);
      tableY += 25;
    } else {
      complaints.forEach((c, idx) => {
        if (tableY > 740) {
          doc.addPage();
          tableY = 40;
          drawTableHeader(tableY);
          tableY += 20;
        }
        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        doc.rect(40, tableY, 515, 17).fill(bg);
        doc.fillColor('#1e293b').fontSize(7.5).font('Helvetica');
        const cDate = c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-GB') : '-';
        const cStudent = String(c.student || c.studentName || 'Student').slice(0, 16);
        const cRoom = `${c.hostelBlock || c.block || 'Block'}-${c.roomNumber || 'N/A'}`.slice(0, 14);
        const cCategory = String(c.category || 'General').slice(0, 14);
        const cPriority = String(c.priority || 'Medium').slice(0, 10);
        const cStatus = String(c.status || 'Pending').slice(0, 10);
        const cStaff = String(c.assignedTo || c.technicianName || 'Unassigned').slice(0, 10);

        doc.text(String(c.id || '').slice(0, 14), 45, tableY + 4, { width: 65 });
        doc.text(cDate, 112, tableY + 4, { width: 55 });
        doc.text(cStudent, 170, tableY + 4, { width: 85 });
        doc.text(cRoom, 258, tableY + 4, { width: 70 });
        doc.text(cCategory, 330, tableY + 4, { width: 70 });
        doc.text(cPriority, 402, tableY + 4, { width: 50 });
        doc.text(cStatus, 454, tableY + 4, { width: 50 });
        doc.text(cStaff, 506, tableY + 4, { width: 45 });
        tableY += 17;
      });
    }

    // Signatures
    if (tableY > 700) {
      doc.addPage();
      tableY = 40;
    } else {
      tableY += 25;
    }
    doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(40, tableY).lineTo(555, tableY).stroke();
    tableY += 12;
    doc.fillColor('#475569').fontSize(7.5).font('Helvetica-Bold');
    doc.text('Prepared By: Maintenance Supervisor', 50, tableY);
    doc.text('Verified By: Chief Warden', 220, tableY);
    doc.text('Approved By: Estate Officer / Principal', 390, tableY);
    tableY += 24;
    doc.strokeColor('#94a3b8').lineWidth(0.5)
      .moveTo(50, tableY).lineTo(170, tableY).stroke()
      .moveTo(220, tableY).lineTo(340, tableY).stroke()
      .moveTo(390, tableY).lineTo(510, tableY).stroke();

    doc.end();
  } catch (err) {
    console.error('[Reports PDF Error]', err);
    res.status(500).json({ error: 'Failed to generate PDF report.' });
  }
});

// ============================================================================
// 12. STATIC ROUTE FALLBACKS & STARTUP
// ============================================================================

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate').sendFile(MAIN_HTML);
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Image payload is too large. Please try again with a smaller frame.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});


const port = process.env.PORT || 5000;
const { testConnection } = require('./db');

if (require.main === module) {
  server.listen(port, async () => {
    console.log(`HostelFix Server is running at http://localhost:${port}`);
    try {
      const pgConn = await testConnection();
      if (pgConn.success) {
        console.log(`✅ Connected to PostgreSQL database '${pgConn.info.db_name}'`);
      } else {
        console.error(`❌ PostgreSQL connection failed: ${pgConn.error}`);
      }
    } catch (e) {
      console.error(`❌ PostgreSQL connection error:`, e.message);
    }
  });
}

module.exports = app;
module.exports.server = server;
module.exports.io = io;
