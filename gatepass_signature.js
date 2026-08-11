const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, 'data', 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'gatepass-private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'gatepass-public.pem');

// Load keys once at startup
let _privateKey = null;
let _publicKey = null;

function loadKeys() {
  if (!_privateKey) {
    if (!fs.existsSync(PRIVATE_KEY_PATH)) {
      throw new Error(
        'Gate pass signing keys not found. Run: node generate-signing-keys.js\n' +
        `Expected at: ${PRIVATE_KEY_PATH}`
      );
    }
    _privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
    _publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
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
