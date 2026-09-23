/**
 * HostelFix Comprehensive Security & Zero-Trust Hardening Test Suite
 * Validates backend authentication, authorization (RBAC), IDOR protection,
 * token validation, identity spoofing resistance, and rate limiting.
 */

const http = require('http');
const assert = require('assert');
const jwt = require('jsonwebtoken');

const app = require('../server');
const { generateToken, getJwtSecret } = require('../middleware/authMiddleware');
const {
  userRepository,
  studentRepository,
  complaintRepository,
  gatePassRepository,
  notificationRepository
} = require('../repositories');

async function runSecurityTestSuite() {
  console.log('\n============================================================');
  console.log('   🛡️  HOSTELFIX ZERO-TRUST SECURITY REGRESSION TEST SUITE');
  console.log('============================================================\n');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const reqHeaders = { ...(options.headers || {}) };
      if (options.body && !reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      const req = http.request(url, { ...options, headers: reqHeaders }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (e) {}
          resolve({ status: res.statusCode, headers: res.headers, body: data, json });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
      }
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

  const secret = getJwtSecret();

  // Test Identity Fixtures
  const adminPayload = { userId: 'ADM-SEC-01', email: 'admin.sec@hostelfix.edu', role: 'admin', name: 'Security Admin' };
  const wardenPayload = { userId: 'WRD-SEC-01', email: 'warden.sec@hostelfix.edu', role: 'warden', name: 'Hostel Warden' };
  const studentAPayload = { userId: 'STU-SEC-ALICE', email: 'alice.sec@hostelfix.edu', role: 'student', name: 'Alice Student', registrationNumber: 'REG-ALICE-01' };
  const studentBPayload = { userId: 'STU-SEC-BOB', email: 'bob.sec@hostelfix.edu', role: 'student', name: 'Bob Student', registrationNumber: 'REG-BOB-01' };
  const inactivePayload = { userId: 'STU-INACTIVE-01', email: 'inactive.user@hostelfix.edu', role: 'student', name: 'Inactive User' };

  const adminToken = generateToken(adminPayload);
  const wardenToken = generateToken(wardenPayload);
  const studentAToken = generateToken(studentAPayload);
  const studentBToken = generateToken(studentBPayload);

  // Set inactive status in cache
  userRepository.setStatus(inactivePayload.userId, 'Inactive');
  userRepository.setStatus(inactivePayload.email, 'Inactive');
  const inactiveToken = generateToken(inactivePayload);

  // Create test complaint and pass for Bob (victim of potential IDOR)
  let bobComplaintId = 'CMP-BOB-' + Date.now();
  let bobPassId = 'GP-BOB-' + Date.now();
  let aliceComplaintId = 'CMP-ALICE-' + Date.now();

  try {
    const bobComplaint = await complaintRepository.create({
      id: bobComplaintId,
      title: "Bob's Broken Window",
      description: 'Window glass cracked in room B-201',
      studentName: 'Bob Student',
      studentEmail: studentBPayload.email,
      email: studentBPayload.email,
      studentId: studentBPayload.userId,
      roomNumber: 'B-201',
      hostelBlock: 'Block B',
      category: 'Carpentry',
      status: 'Pending'
    });
    if (bobComplaint?.id) bobComplaintId = bobComplaint.id;

    const aliceComplaint = await complaintRepository.create({
      id: aliceComplaintId,
      title: "Alice's Fan Issue",
      description: 'Ceiling fan making noise in room A-101',
      studentName: 'Alice Student',
      studentEmail: studentAPayload.email,
      email: studentAPayload.email,
      studentId: studentAPayload.userId,
      roomNumber: 'A-101',
      hostelBlock: 'Block A',
      category: 'Electrical',
      status: 'Pending'
    });
    if (aliceComplaint?.id) aliceComplaintId = aliceComplaint.id;

    const bobPass = await gatePassRepository.create({
      id: bobPassId,
      student: 'Bob Student',
      studentName: 'Bob Student',
      studentEmail: studentBPayload.email,
      email: studentBPayload.email,
      studentId: studentBPayload.userId,
      registrationNumber: 'REG-BOB-01',
      hostelBlock: 'Block B',
      roomNumber: 'B-201',
      purpose: 'Family Emergency',
      gateDate: '2026-10-01',
      returnDate: '2026-10-03',
      status: 'Pending'
    });
    if (bobPass?.id) bobPassId = bobPass.id;
  } catch (e) {
    console.warn('[Setup Warning]', e.message);
  }

  try {
    // -------------------------------------------------------------
    // GROUP 1: JWT AUTHENTICATION HARDENING & INTEGRITY
    // -------------------------------------------------------------

    await test('1. Calling protected endpoint without JWT returns 401 Unauthorized', async () => {
      const res = await request('/api/complaints');
      assert.strictEqual(res.status, 401);
      assert.ok(res.json?.error);
    });

    await test('2. Calling protected endpoint with malformed/invalid JWT returns 401 Unauthorized', async () => {
      const res = await request('/api/complaints', {
        headers: { Authorization: 'Bearer thisisnotavalidjwttokenatall' }
      });
      assert.strictEqual(res.status, 401);
    });

    await test('3. Calling protected endpoint with tampered JWT signature returns 401 Unauthorized', async () => {
      const tampered = studentAToken.slice(0, -6) + 'xxxxxx';
      const res = await request('/api/complaints', {
        headers: { Authorization: `Bearer ${tampered}` }
      });
      assert.strictEqual(res.status, 401);
    });

    await test('4. Calling protected endpoint with expired JWT returns 401 Unauthorized', async () => {
      const expiredToken = jwt.sign(studentAPayload, secret, { expiresIn: '-10s' });
      const res = await request('/api/complaints', {
        headers: { Authorization: `Bearer ${expiredToken}` }
      });
      assert.strictEqual(res.status, 401);
      assert.ok(res.json?.error?.toLowerCase().includes('expired'));
    });

    await test('5. Inactive / deactivated user JWT is rejected with 403 Forbidden', async () => {
      const res = await request('/api/complaints', {
        headers: { Authorization: `Bearer ${inactiveToken}` }
      });
      assert.strictEqual(res.status, 403);
      assert.ok(res.json?.error?.toLowerCase().includes('deactivated'));
    });

    // -------------------------------------------------------------
    // GROUP 2: ROLE-BASED ACCESS CONTROL (RBAC) ENFORCEMENT
    // -------------------------------------------------------------

    await test('6. Student JWT calling Admin-only endpoint (/api/admin-settings) returns 403 Forbidden', async () => {
      const res = await request('/api/admin-settings', {
        headers: { Authorization: `Bearer ${studentAToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    await test('7. Student JWT calling Warden/Admin endpoint (GET /api/students) returns 403 Forbidden', async () => {
      const res = await request('/api/students', {
        headers: { Authorization: `Bearer ${studentAToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    await test('8. Warden JWT calling Admin-only endpoint (/api/admin-settings) returns 403 Forbidden', async () => {
      const res = await request('/api/admin-settings', {
        headers: { Authorization: `Bearer ${wardenToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    await test('9. Student JWT calling POST /api/technicians returns 403 Forbidden', async () => {
      const res = await request('/api/technicians', {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentAToken}` },
        body: { name: 'Hacker Tech', email: 'hack@test.com' }
      });
      assert.strictEqual(res.status, 403);
    });

    await test('10. Student JWT calling DELETE /api/users/:id returns 403 Forbidden', async () => {
      const res = await request('/api/users/ADM-SEC-01', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${studentAToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    // -------------------------------------------------------------
    // GROUP 3: IDENTITY SPOOFING RESISTANCE (HEADERS & QUERY PARAMS)
    // -------------------------------------------------------------

    await test('11. Forged x-user-role: admin header by Student is ignored (still returns 403)', async () => {
      const res = await request('/api/admin-settings', {
        headers: {
          Authorization: `Bearer ${studentAToken}`,
          'x-user-role': 'admin'
        }
      });
      assert.strictEqual(res.status, 403);
    });

    await test('12. Forged x-user-email: admin@hostelfix.edu header by Student is ignored', async () => {
      const res = await request('/api/admin-settings', {
        headers: {
          Authorization: `Bearer ${studentAToken}`,
          'x-user-email': 'sabithacys@siet.ac',
          'x-user-role': 'admin'
        }
      });
      assert.strictEqual(res.status, 403);
    });

    await test('13. Forged x-user-id: ADM-001 header by Student is ignored', async () => {
      const res = await request('/api/admin-settings', {
        headers: {
          Authorization: `Bearer ${studentAToken}`,
          'x-user-id': 'ADM-SUPER-01'
        }
      });
      assert.strictEqual(res.status, 403);
    });

    await test('14. Student passing query ?role=admin to /api/complaints only sees own complaints', async () => {
      const res = await request('/api/complaints?role=admin', {
        headers: { Authorization: `Bearer ${studentAToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.json));
      // None of Bob's complaints should be in Alice's results
      const hasBobComplaint = res.json.some(c => c.studentEmail === studentBPayload.email || c.id === bobComplaintId);
      assert.strictEqual(hasBobComplaint, false, "Student must NOT see other students' complaints");
    });

    await test('15. Student notifications query ?email=victim is ignored (returns caller notifications only)', async () => {
      const res = await request(`/api/student-notifications?email=${encodeURIComponent(studentBPayload.email)}`, {
        headers: { Authorization: `Bearer ${studentAToken}` }
      });
      assert.strictEqual(res.status, 200);
      // All returned notifications must belong to Alice, not Bob
      if (Array.isArray(res.json)) {
        const hasBobNotif = res.json.some(n => n.recipientEmail === studentBPayload.email);
        assert.strictEqual(hasBobNotif, false);
      }
    });

    // -------------------------------------------------------------
    // GROUP 4: IDOR (INSECURE DIRECT OBJECT REFERENCE) PREVENTION
    // -------------------------------------------------------------

    await test("16. Student A calling GET /api/complaints/:id for Student B's ticket returns 403 Forbidden", async () => {
      const res = await request(`/api/complaints/${encodeURIComponent(bobComplaintId)}`, {
        headers: { Authorization: `Bearer ${studentAToken}` }
      });
      assert.strictEqual(res.status, 403);
      assert.ok(res.json?.error?.toLowerCase().includes('access denied'));
    });

    await test('17. Student calling PUT /api/complaints/:id/status to approve/change status returns 403 Forbidden', async () => {
      const res = await request(`/api/complaints/${encodeURIComponent(aliceComplaintId)}/status`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${studentAToken}` },
        body: { status: 'Resolved' }
      });
      assert.strictEqual(res.status, 403);
    });

    await test("18. Student A calling GET /api/gatepass/:id for Student B's pass returns 403 Forbidden", async () => {
      const res = await request(`/api/gatepass/${encodeURIComponent(bobPassId)}`, {
        headers: { Authorization: `Bearer ${studentAToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    await test('19. Student calling PUT /api/gatepass/:id/status to approve own pass returns 403 Forbidden', async () => {
      const res = await request(`/api/gatepass/${encodeURIComponent(bobPassId)}/status`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${studentAToken}` },
        body: { status: 'Approved' }
      });
      assert.strictEqual(res.status, 403);
    });

    await test("20. Student A calling GET /api/students/:id for Student B returns 403 Forbidden", async () => {
      const res = await request(`/api/students/${encodeURIComponent(studentBPayload.userId)}`, {
        headers: { Authorization: `Bearer ${studentAToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    // -------------------------------------------------------------
    // GROUP 5: LEGITIMATE PRIVILEGES & WORKFLOW INTEGRITY
    // -------------------------------------------------------------

    await test('21. Valid Admin JWT accesses Admin-only endpoints successfully (200 OK)', async () => {
      const res = await request('/api/admin-settings', {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.json !== null);
    });

    await test('22. Valid Warden JWT accesses Warden endpoints successfully (200 OK)', async () => {
      const res = await request('/api/students', {
        headers: { Authorization: `Bearer ${wardenToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.json));
    });

    await test('23. Valid Student JWT accesses own complaints successfully (200 OK)', async () => {
      const res = await request('/api/complaints', {
        headers: { Authorization: `Bearer ${studentAToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.json));
    });

    await test('24. Student creating complaint binds author identity strictly to req.user', async () => {
      const forgedPayload = {
        title: 'Air Filter Broken',
        description: 'Need replacement filter',
        category: 'Electrical',
        studentName: 'Forged Victim Name',
        studentEmail: 'victim@hostelfix.edu',
        studentId: 'VICTIM-999',
        roomNumber: '101'
      };
      const res = await request('/api/complaints', {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentAToken}` },
        body: forgedPayload
      });
      assert.strictEqual(res.status, 201);
      // Backend must have overridden the forged fields with Alice's authenticated credentials
      assert.strictEqual(res.json.studentEmail, studentAPayload.email);
      assert.strictEqual(res.json.studentId, studentAPayload.userId);
    });

    await test('25. Valid user login returns JWT token and sanitize user profile', async () => {
      const res = await request('/api/login', {
        method: 'POST',
        body: {
          email: 'sabithacys@siet.ac',
          password: 'sabitha123',
          role: 'admin'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.token);
      assert.strictEqual(res.json.role, 'admin');
      assert.strictEqual(res.json.password, undefined); // password MUST be stripped
    });

  } finally {
    server.close();
  }

  console.log('\n------------------------------------------------------------');
  console.log(`  🎉 SUMMARY: All ${passed}/${total} security hardening assertions passed!`);
  console.log('------------------------------------------------------------\n');
}

if (require.main === module) {
  runSecurityTestSuite().catch((err) => {
    console.error('\n❌ Security test suite failed:', err);
    process.exit(1);
  });
}

module.exports = runSecurityTestSuite;
