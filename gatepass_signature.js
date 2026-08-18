const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
const KEYS_DIR = isVercel ? path.join('/tmp', 'data', 'keys') : path.join(__dirname, 'data', 'keys');
const BUNDLED_KEYS_DIR = path.join(__dirname, 'data', 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'gatepass-private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'gatepass-public.pem');

// Load keys once at startup
let _privateKey = null;
let _publicKey = null;

function loadKeys() {
  if (!_privateKey) {
    if (process.env.GATEPASS_PRIVATE_KEY && process.env.GATEPASS_PUBLIC_KEY) {
      _privateKey = process.env.GATEPASS_PRIVATE_KEY.replace(/\\n/g, '\n');
      _publicKey = process.env.GATEPASS_PUBLIC_KEY.replace(/\\n/g, '\n');
      return { privateKey: _privateKey, publicKey: _publicKey };
    }

    if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
      _privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
      _publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
      return { privateKey: _privateKey, publicKey: _publicKey };
    }

    const bundledPrivate = path.join(BUNDLED_KEYS_DIR, 'gatepass-private.pem');
    const bundledPublic = path.join(BUNDLED_KEYS_DIR, 'gatepass-public.pem');
    if (fs.existsSync(bundledPrivate) && fs.existsSync(bundledPublic)) {
      _privateKey = fs.readFileSync(bundledPrivate, 'utf8');
      _publicKey = fs.readFileSync(bundledPublic, 'utf8');
      return { privateKey: _privateKey, publicKey: _publicKey };
    }

    // Auto-generate ECDSA keypair if none exists
    const keyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    _privateKey = keyPair.privateKey;
    _publicKey = keyPair.publicKey;

    try {
      if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });
      fs.writeFileSync(PRIVATE_KEY_PATH, _privateKey, { mode: 0o600 });
      fs.writeFileSync(PUBLIC_KEY_PATH, _publicKey);
    } catch (e) {
      // In read-only serverless, keeping in-memory keypair is fine
    }
  }
  return { privateKey: _privateKey, publicKey: _publicKey };
}

/**
 * Canonical payload — the exact set of fields that are "locked in" after approval.
 * If any of these fields change after signing, signature verification will fail.
 */
function buildSigningPayload(gatePass) {
  return [
    gatePass.id || '',
    gatePass.certificateId || '',
    gatePass.student || '',
    gatePass.registrationNumber || '',
    gatePass.hostelBlock || '',
    gatePass.roomNumber || '',
    gatePass.gateDate || '',
    gatePass.returnDate || '',
    gatePass.session || '',
    gatePass.approvedBy || '',
    gatePass.approvedAt || ''
  ].join('|');
}

/**
 * Sign a gate pass after approval.
 * Adds digitalSignature, signedAt, signatureAlgorithm, and a short fingerprint
 * to the gatePass object (which is then saved to db.json).
 */
function signGatePass(gatePass) {
  const { privateKey } = loadKeys();
  const payload = buildSigningPayload(gatePass);

  const signer = crypto.createSign('SHA256');
  signer.update(payload, 'utf8');
  signer.end();
  const signature = signer.sign(privateKey, 'base64');

  // Short fingerprint for printing on the certificate (first 32 hex chars of SHA-256 of the signature)
  const fingerprint = crypto
    .createHash('sha256')
    .update(signature)
    .digest('hex')
    .slice(0, 32)
    .toUpperCase()
    .match(/.{4}/g)
    .join('-'); // e.g. A3F1-BC90-...

  gatePass.digitalSignature = signature;
  gatePass.signatureAlgorithm = 'ECDSA-P256-SHA256';
  gatePass.signedAt = new Date().toISOString();
  gatePass.signatureFingerprint = fingerprint;

  return { signature, fingerprint };
}

/**
 * Verify a gate pass signature.
 * Returns { valid: boolean, reason: string }
 */
function verifyGatePassSignature(gatePass) {
  if (!gatePass) return { valid: false, reason: 'Gate pass not found' };
  if (!gatePass.digitalSignature) return { valid: false, reason: 'No digital signature present on this record' };

  try {
    const { publicKey } = loadKeys();
    const payload = buildSigningPayload(gatePass);

    const verifier = crypto.createVerify('SHA256');
    verifier.update(payload, 'utf8');
    verifier.end();
    const valid = verifier.verify(publicKey, gatePass.digitalSignature, 'base64');

    return {
      valid,
      reason: valid
        ? 'Signature valid — document is authentic and untampered'
        : 'SIGNATURE MISMATCH — this record may have been altered after signing'
    };
  } catch (err) {
    return { valid: false, reason: `Verification error: ${err.message}` };
  }
}

/**
 * Get the public key as PEM string (safe to share publicly for independent verification)
 */
function getPublicKeyPem() {
  const { publicKey } = loadKeys();
  return publicKey;
}

module.exports = { signGatePass, verifyGatePassSignature, getPublicKeyPem };
