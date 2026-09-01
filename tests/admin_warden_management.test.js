const assert = require('assert');
const path = require('path');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = require('../server');
const { userRepository, wardenRepository, studentRepository } = require('../repositories');

let server;
let baseUrl;
const testPort = 5092;

function makeRequest(method, endpoint, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runWardenManagementTests() {
  console.log('\n============================================================');
  console.log('   🧪 DYNAMIC ADMIN → WARDEN MANAGEMENT TEST SUITE');
  console.log('============================================================\n');

  let passed = 0;
  let total = 0;

  function record(desc, ok, details = '') {
    total++;
    if (ok) {
      passed++;
      console.log(`  ✅ [PASS] ${desc}`);
    } else {
      console.error(`  ❌ [FAIL] ${desc} - ${details}`);
    }
  }

  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;

  let adminToken = '';
  let testWardenId = '';
  let createdStudentId = '';
  const testWardenEmail = `ravi.warden.${Date.now()}@hostelfix.edu`;
  const testStudentEmail = `student.scope.${Date.now()}@hostelfix.edu`;

  try {
    const { generateToken } = require('../middleware/authMiddleware');

    // 1. Admin authentication
    if (!adminToken) {
      adminToken = generateToken({
        userId: 'ADM-SUPER-01',
        email: 'admin@hostelfix.edu',
        role: 'admin',
        name: 'Chief Administrator'
      });
    }
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    record('Admin has valid JWT authentication token', Boolean(adminToken));

    // 2. Pre-create a student in Block A, Room 101 for scope matching
    try {
      const testStudent = await studentRepository.create({
        name: 'Scope Test Student',
        email: testStudentEmail,
        password: 'password123',
        roomNumber: '101',
        hostelBlock: 'Block A',
        registrationNumber: 'REG-SCOPE-101',
        phone: '+91 99999 11111'
      });
      if (testStudent) createdStudentId = testStudent.userId;
    } catch (e) {
      console.warn('Student pre-create notice:', e.message);
    }

    // 3. Validation: Reject missing name
    const failName = await makeRequest('POST', '/api/admin/wardens', {
      name: '',
      email: 'invalid@hostelfix.edu',
      password: 'password123'
    }, adminHeaders);
    record('POST /api/admin/wardens rejects empty name with 400', failName.status === 400);

    // 4. Validation: Reject invalid email
    const failEmail = await makeRequest('POST', '/api/admin/wardens', {
      name: 'Test Warden',
      email: 'notanemail',
      password: 'password123'
    }, adminHeaders);
    record('POST /api/admin/wardens rejects invalid email with 400', failEmail.status === 400);

    // 5. GET /api/hostel-structure returns dynamic blocks and floors
    const structRes = await makeRequest('GET', '/api/hostel-structure', null, adminHeaders);
    record('GET /api/hostel-structure returns dynamic hostel blocks & floors hierarchy', structRes.status === 200 && Array.isArray(structRes.body.blocks) && structRes.body.blocks.length > 0);

    // 6. Create dynamic Warden WITHOUT manual password (server auto-generates temporary password)
    const createRes = await makeRequest('POST', '/api/admin/wardens', {
      name: 'Ravi Kumar',
      email: testWardenEmail,
      phone: '+91 98765 43210',
      hostel: 'Boys Hostel',
      block: 'Block A',
      floors: 'Floor 1',
      rooms: '101-130',
      status: 'Active',
      permissions: ['view_students', 'manage_students', 'view_complaints', 'approve_gatepasses']
    }, adminHeaders);
    testWardenId = createRes.body.userId || createRes.body.id;
    const generatedTempPassword = createRes.body.temporaryPassword;
    record('POST /api/admin/wardens auto-generates secure temporary password & sets mustChangePassword=true', 
      createRes.status === 201 && Boolean(testWardenId) && Boolean(generatedTempPassword) && createRes.body.mustChangePassword === true
    );

    // 7. Verify Duplicate Email is blocked
    const duplicateRes = await makeRequest('POST', '/api/admin/wardens', {
      name: 'Duplicate Warden',
      email: testWardenEmail
    }, adminHeaders);
    record('POST /api/admin/wardens blocks duplicate email with 409 Conflict', duplicateRes.status === 409);

    // 8. GET /api/admin/wardens dynamically lists created warden
    const listRes = await makeRequest('GET', '/api/admin/wardens', null, adminHeaders);
    const foundWarden = Array.isArray(listRes.body) && listRes.body.find(w => w.email === testWardenEmail);
    record('GET /api/admin/wardens dynamically lists created warden from Supabase', listRes.status === 200 && Boolean(foundWarden));

    // 9. GET /api/admin/wardens/:id fetches complete details with permissions & scope
    const singleRes = await makeRequest('GET', `/api/admin/wardens/${encodeURIComponent(testWardenId)}`, null, adminHeaders);
    record('GET /api/admin/wardens/:id fetches warden profile and scope details', singleRes.status === 200 && singleRes.body.email === testWardenEmail && Boolean(singleRes.body.scope));

    // 10. GET /api/admin/wardens/:id/students resolves in-scope students
    const studentsRes = await makeRequest('GET', `/api/admin/wardens/${encodeURIComponent(testWardenId)}/students`, null, adminHeaders);
    const hasStudent = Array.isArray(studentsRes.body) && studentsRes.body.some(s => s.email === testStudentEmail);
    record('GET /api/admin/wardens/:id/students dynamically resolves in-scope students', studentsRes.status === 200 && hasStudent);

    // 11. Warden login with temporary password returns mustChangePassword: true
    const tempLogin = await makeRequest('POST', '/api/login', {
      email: testWardenEmail,
      password: generatedTempPassword,
      role: 'warden'
    });
    const wardenToken = tempLogin.body.token;
    record('Warden logs in with temporary password and receives mustChangePassword: true', tempLogin.status === 200 && Boolean(wardenToken) && tempLogin.body.mustChangePassword === true);

    // 12. Mandatory first-login: POST /api/change-password sets permanent password
    const changePassRes = await makeRequest('POST', '/api/change-password', {
      currentPassword: generatedTempPassword,
      newPassword: 'NewPermanentPassword123!',
      confirmPassword: 'NewPermanentPassword123!',
      email: testWardenEmail
    }, { Authorization: `Bearer ${wardenToken}` });
    record('POST /api/change-password updates password and clears mustChangePassword flag', changePassRes.status === 200 && changePassRes.body.success === true);

    // 13. Warden logs in with new permanent password and receives mustChangePassword: false
    const permanentLogin = await makeRequest('POST', '/api/login', {
      email: testWardenEmail,
      password: 'NewPermanentPassword123!',
      role: 'warden'
    });
    record('Warden logs in with new permanent password without mustChangePassword restriction', permanentLogin.status === 200 && permanentLogin.body.mustChangePassword === false);

    // 13.5. GET /api/admin/wardens/:id/digital-id generates QR and cryptographic signature
    const digitalIdRes = await makeRequest('GET', `/api/admin/wardens/${encodeURIComponent(testWardenId)}/digital-id`, null, adminHeaders);
    record('GET /api/admin/wardens/:id/digital-id returns digital ID card, QR code & signature',
      digitalIdRes.status === 200 &&
      Boolean(digitalIdRes.body.digitalId?.certificateId) &&
      Boolean(digitalIdRes.body.digitalId?.qrImage)
    );

    // 14. PUT /api/admin/wardens/:id updates warden details
    const updateRes = await makeRequest('PUT', `/api/admin/wardens/${encodeURIComponent(testWardenId)}`, {
      name: 'Ravi Kumar Updated',
      phone: '+91 98765 00000',
      hostelBlock: 'Block A',
      floors: '1-3'
    }, adminHeaders);
    record('PUT /api/admin/wardens/:id updates warden details and scope', updateRes.status === 200 && updateRes.body.name === 'Ravi Kumar Updated');

    // 15. PUT /api/admin/wardens/:id/permissions updates RBAC permissions
    const permsRes = await makeRequest('PUT', `/api/admin/wardens/${encodeURIComponent(testWardenId)}/permissions`, {
      permissions: ['view_students', 'view_complaints', 'view_inventory', 'view_cctv']
    }, adminHeaders);
    record('PUT /api/admin/wardens/:id/permissions dynamically updates permissions', permsRes.status === 200 && Array.isArray(permsRes.body) && permsRes.body.includes('view_cctv'));

    // 16. PATCH /api/admin/wardens/:id/status updates status to Inactive
    const deactRes = await makeRequest('PATCH', `/api/admin/wardens/${encodeURIComponent(testWardenId)}/status`, {
      status: 'Inactive'
    }, adminHeaders);
    record('PATCH /api/admin/wardens/:id/status deactivates warden to Inactive', deactRes.status === 200 && deactRes.body.status === 'Inactive');

    // 17. Inactive Warden cannot log in
    const inactiveLogin = await makeRequest('POST', '/api/login', {
      email: testWardenEmail,
      password: 'NewPermanentPassword123!',
      role: 'warden'
    });
    record('Inactive warden is blocked from logging in with 403 Forbidden', inactiveLogin.status === 403);

    // 18. PATCH /api/admin/wardens/:id/status updates status back to Active
    const actRes = await makeRequest('PATCH', `/api/admin/wardens/${encodeURIComponent(testWardenId)}/status`, {
      status: 'Active'
    }, adminHeaders);
    record('PATCH /api/admin/wardens/:id/status reactivates warden to Active', actRes.status === 200 && actRes.body.status === 'Active');

    // 19. GET /api/admin/wardens-stats returns aggregated metrics
    const statsRes = await makeRequest('GET', '/api/admin/wardens-stats', null, adminHeaders);
    record('GET /api/admin/wardens-stats returns dynamic metrics from Supabase', statsRes.status === 200 && statsRes.body.totalWardens >= 1);

    // 20. DELETE /api/admin/wardens/:id permanently deletes warden
    const deleteRes = await makeRequest('DELETE', `/api/admin/wardens/${encodeURIComponent(testWardenId)}`, null, adminHeaders);
    record('DELETE /api/admin/wardens/:id removes warden from database', deleteRes.status === 200 && deleteRes.body.success === true);

    // 21. Confirm warden is 404 deleted
    const confirmDelete = await makeRequest('GET', `/api/admin/wardens/${encodeURIComponent(testWardenId)}`, null, adminHeaders);
    record('GET /api/admin/wardens/:id confirms warden is deleted (404 Not Found)', confirmDelete.status === 404);

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    try {
      if (testWardenId) await wardenRepository.deleteWarden(testWardenId);
      if (createdStudentId) await studentRepository.delete(createdStudentId);
    } catch (e) {}
    server.close();
  }

  console.log('\n------------------------------------------------------------');
  console.log(`  🎉 SUMMARY: ${passed}/${total} admin warden management tests passed!`);
  console.log('------------------------------------------------------------\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runWardenManagementTests();
