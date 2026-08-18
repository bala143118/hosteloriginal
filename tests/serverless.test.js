/**
 * HostelFix Serverless & Integration Test Suite
 * Validates Express routes, Vercel Serverless Function compatibility,
 * Cryptographic ECDSA signatures, PDF certificate generation, and Database Operations.
 */

const http = require('http');
const assert = require('assert');

// Force Vercel Serverless Mode for testing
process.env.VERCEL = '1';

const app = require('../api/index.js');
const { signGatePass, verifyGatePassSignature, getPublicKeyPem } = require('../gatepass_signature');

async function runTestSuite() {
  console.log('============================================================');
  console.log('   🧪 HOSTELFIX AUTOMATED INTEGRATION & SERVERLESS TESTS   ');
  console.log('============================================================\n');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`Serverless test instance running at: ${baseUrl}\n`);

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const reqHeaders = { ...(options.headers || {}) };
      if (options.body && !reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      const req = http.request(url, { ...options, headers: reqHeaders }, (res) => {
        let data = '';
        const isBinary = (res.headers['content-type'] || '').includes('application/pdf');
        const chunks = [];
        res.on('data', chunk => {
          if (isBinary) chunks.push(chunk);
          else data += chunk;
        });
        res.on('end', () => {
          let json = null;
          if (!isBinary) {
            try { json = JSON.parse(data); } catch (e) {}
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: isBinary ? Buffer.concat(chunks) : data,
            json
          });
        });
      });
      req.on('error', reject);
      if (options.body) req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
      req.end();
    });
  }

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  try {
    // 1. Static & SPA Routing
    await test('GET / serves index.html single-page dashboard', async () => {
      const res = await request('/');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('HostelFix') || res.body.includes('<!DOCTYPE html>'));
    });

    // 2. Metrics Summary API
    await test('GET /api/summary returns dashboard metrics', async () => {
      const res = await request('/api/summary');
      assert.strictEqual(res.status, 200);
      assert.ok(typeof res.json === 'object');
    });

    // 3. User Directory API
    await test('GET /api/users returns registered resident and staff accounts', async () => {
      const res = await request('/api/users');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.json));
      assert.ok(res.json.length > 0);
    });

    // 4. Complaints Workflow
    let createdComplaintId = '';
    await test('POST /api/complaints creates a new maintenance ticket', async () => {
      const payload = {
        title: 'Air Conditioner Filter Cleaning',
        description: 'Room A-204 AC airflow is restricted and needs filter cleaning.',
        category: 'Electrical',
        studentName: 'John Doe',
        roomNumber: 'A-204',
        hostelBlock: 'Block A',
        priority: 'Medium'
      };
      const res = await request('/api/complaints', { method: 'POST', body: payload });
      assert.strictEqual(res.status, 201);
      assert.ok(res.json.id);
      createdComplaintId = res.json.id;
    });

    // 5. Gate Pass Lifecycle & Application
    let createdPassId = '';
    await test('POST /api/gate-passes registers a new student leave request', async () => {
      const payload = {
        student: 'John Doe',
        registrationNumber: 'REG2024001',
        roomNumber: 'A-204',
        hostelBlock: 'Block A',
        purpose: 'Weekend Home Visit',
        gateDate: '2026-08-20',
        returnDate: '2026-08-22',
        session: 'Morning',
        parentPhone: '9876543210'
      };
      const res = await request('/api/gate-passes', { method: 'POST', body: payload });
      assert.strictEqual(res.status, 201);
      assert.ok(res.json.id);
      createdPassId = res.json.id;
    });

    // 6. PDF Certificate Generation
    await test('GET /api/gate-passes/:id/pdf generates cryptographic PDF certificate', async () => {
      const res = await request(`/api/gate-passes/${createdPassId}/pdf`);
      assert.strictEqual(res.status, 200);
      assert.ok((res.headers['content-type'] || '').includes('application/pdf'));
      assert.ok(res.body.length > 1000);
    });

    // 7. Cryptographic Public Key Distribution
    await test('GET /api/gatepass/public-key returns ECDSA public key in PEM format', async () => {
      const res = await request('/api/gatepass/public-key');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('BEGIN PUBLIC KEY'));
    });

    // 8. Gate Pass Tamper-Proof Cryptographic Verification
    await test('ECDSA P-256 digital signature signing & verification against tampering', async () => {
      const samplePass = {
        id: 'GP-2026-TEST01',
        certificateId: 'CERT-2026-TEST01',
        student: 'Balamurugan S',
        registrationNumber: 'REG2024999',
        hostelBlock: 'Block A',
        roomNumber: 'A-204',
        gateDate: '2026-08-20',
        returnDate: '2026-08-22',
        session: 'Morning',
        approvedBy: 'Chief Warden',
        approvedAt: new Date().toISOString()
      };
      const { signature, fingerprint } = signGatePass(samplePass);
      assert.ok(signature, 'Signature should be present');
      assert.ok(fingerprint, 'Fingerprint should be present');

      // Valid pass verification
      const validCheck = verifyGatePassSignature(samplePass);
      assert.strictEqual(validCheck.valid, true);

      // Tampered pass verification
      const tamperedPass = { ...samplePass, student: 'Malicious Actor' };
      const tamperedCheck = verifyGatePassSignature(tamperedPass);
      assert.strictEqual(tamperedCheck.valid, false);
    });

    // 9. QR Code Verification Portal
    await test('GET /qr/:token renders standalone mobile-responsive verification portal', async () => {
      const res = await request('/qr/SAMPLE_VALIDATION_TOKEN');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('HostelFix Smart Gate Pass') || res.body.includes('<!doctype html>'));
    });

    // 10. Smart Laundry Booking
    await test('POST /api/laundry-requests reserves a smart laundry slot', async () => {
      const payload = {
        studentName: 'John Doe',
        roomNumber: 'A-204',
        machineNumber: 'Washer 02',
        date: '2026-08-19',
        timeSlot: '04:00 PM - 05:00 PM'
      };
      const res = await request('/api/laundry-requests', { method: 'POST', body: payload });
      assert.strictEqual(res.status, 201);
    });

    // 11. 404 Error Handling
    await test('GET /api/nonexistent-endpoint returns structured 404 JSON response', async () => {
      const res = await request('/api/nonexistent-endpoint');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.json.error, 'API route not found');
    });

    console.log('\n------------------------------------------------------------');
    console.log(`  🎉 SUMMARY: All ${passed}/${total} integration tests passed successfully!`);
    console.log('------------------------------------------------------------\n');
  } finally {
    server.close();
  }
}

runTestSuite().catch((err) => {
  console.error('\n❌ Test Suite Aborted with Error:', err);
  process.exit(1);
});
