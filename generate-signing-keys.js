
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keysDir = path.join(__dirname, 'data', 'keys');

if (fs.existsSync(path.join(keysDir, 'gatepass-private.pem'))) {
  console.log('⚠  Keys already exist at data/keys/. Delete them first if you want to regenerate.');
  console.log('   WARNING: Regenerating invalidates all existing signed gate passes.');
  process.exit(0);
}

fs.mkdirSync(keysDir, { recursive: true });

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
});

fs.writeFileSync(path.join(keysDir, 'gatepass-private.pem'), privateKey, { mode: 0o600 });
fs.writeFileSync(path.join(keysDir, 'gatepass-public.pem'), publicKey);

console.log('✅  Keys generated:');
console.log('   Private: data/keys/gatepass-private.pem  (KEEP SECRET — never commit)');
console.log('   Public:  data/keys/gatepass-public.pem   (safe to share)');
console.log('');
console.log('🔒  Add to .gitignore:');
console.log('   data/keys/gatepass-private.pem');
