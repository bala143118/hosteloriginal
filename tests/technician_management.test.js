const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { userRepository } = require('../repositories');
const app = require('../server');
const http = require('http');

let server;
let baseUrl;
const testPort = 5066;

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

async function runTechnicianTests() {
  console.log('\n============================================================');
  console.log('   🧪 DYNAMIC TECHNICIAN MANAGEMENT TEST SUITE');
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

  // Start test server
  server = app.listen(testPort);
  baseUrl = `http://localhost:${testPort}`;

  const testEmail = `tech.test.${Date.now()}@hostelfix.edu`;
  const testId = `TECH-TEST-${Date.now()}`;
  let adminToken = '';

  try {
    // 1. Authenticate Admin
    const loginRes = await makeRequest('POST', '/api/login', {
      email: 'sabithacys@siet.ac',
      password: 'sabitha123',
      role: 'admin'
    });
    adminToken = loginRes.body.token || '';
    const adminHeaders = adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
    record('Admin logs in and receives JWT authentication token', loginRes.status === 200 && Boolean(adminToken));

    // 2. Validate Required Fields (Missing Name)
    const invalidNameRes = await makeRequest('POST', '/api/technicians', {
      email: testEmail,
      password: 'password123'
    }, adminHeaders);
    record('POST /api/technicians rejects missing name with 400', invalidNameRes.status === 400);

    // 3. Validate Password mismatch
    const mismatchRes = await makeRequest('POST', '/api/technicians', {
      name: 'Test Technician',
      email: testEmail,
      password: 'password123',
      confirmPassword: 'wrongpassword'
    }, adminHeaders);
    record('POST /api/technicians rejects mismatched passwords with 400', mismatchRes.status === 400);

    // 4. Create Technician Successfully
    const createRes = await makeRequest('POST', '/api/technicians', {
      name: 'Dave Wilson',
      email: testEmail,
      phone: '+91 98765 11223',
      technicianId: testId,
      specialization: 'HVAC / AC Specialist',
      department: 'Facility Management',
      password: 'password123',
      confirmPassword: 'password123',
      status: 'Active'
    }, adminHeaders);
    record('POST /api/technicians creates technician with custom ID and specialization', 
      createRes.status === 201 && createRes.body.name === 'Dave Wilson' && (createRes.body.userId === testId || createRes.body.id === testId));

    // 5. Prevent Duplicate Email
    const duplicateEmailRes = await makeRequest('POST', '/api/technicians', {
      name: 'Dave Wilson Duplicate',
      email: testEmail,
      phone: '+91 98765 11223',
      password: 'password123'
    }, adminHeaders);
    record('POST /api/technicians blocks duplicate email with 409 Conflict', duplicateEmailRes.status === 409);

    // 6. Prevent Duplicate Technician ID
    const duplicateIdRes = await makeRequest('POST', '/api/technicians', {
      name: 'Another Tech',
      email: `other.${Date.now()}@hostelfix.edu`,
      technicianId: testId,
      phone: '+91 98765 11223',
      password: 'password123'
    }, adminHeaders);
    record('POST /api/technicians blocks duplicate Technician ID with 409 Conflict', duplicateIdRes.status === 409);

    // 7. Get Technician List and Find Created Technician
    const listRes = await makeRequest('GET', '/api/technicians', null, adminHeaders);
    const foundInList = Array.isArray(listRes.body) && listRes.body.some(t => t.email === testEmail);
    record('GET /api/technicians dynamically lists created technician from database', listRes.status === 200 && foundInList);

    // 8. Get Single Technician by ID
    const getSingleRes = await makeRequest('GET', `/api/technicians/${encodeURIComponent(testId)}`, null, adminHeaders);
    record('GET /api/technicians/:id fetches single technician profile', getSingleRes.status === 200 && getSingleRes.body.email === testEmail);

    // 9. Update Technician (Edit)
    const updateRes = await makeRequest('PUT', `/api/technicians/${encodeURIComponent(testId)}`, {
      name: 'Dave Wilson Senior',
      specialization: 'Senior HVAC Specialist',
      department: 'Engineering Services',
      phone: '+91 98765 99887'
    }, adminHeaders);
    record('PUT /api/technicians/:id updates technician details in database', 
      updateRes.status === 200 && updateRes.body.name === 'Dave Wilson Senior');

    // 10. Toggle Status (Active -> Inactive)
    const statusRes = await makeRequest('PATCH', `/api/technicians/${encodeURIComponent(testId)}/status`, {
      status: 'Inactive'
    }, adminHeaders);
    record('PATCH /api/technicians/:id/status updates status to Inactive', 
      statusRes.status === 200 && statusRes.body.status === 'Inactive');

    // 11. Toggle Status back to Active
    const statusActiveRes = await makeRequest('PATCH', `/api/technicians/${encodeURIComponent(testId)}/status`, {
      status: 'Active'
    }, adminHeaders);
    record('PATCH /api/technicians/:id/status updates status back to Active', 
      statusActiveRes.status === 200 && statusActiveRes.body.status === 'Active');

    // 12. Delete Technician
    const deleteRes = await makeRequest('DELETE', `/api/technicians/${encodeURIComponent(testId)}`, null, adminHeaders);
    record('DELETE /api/technicians/:id permanently deletes technician from database', deleteRes.status === 200);

    // 13. Verify Deleted
    const verifyDeletedRes = await makeRequest('GET', `/api/technicians/${encodeURIComponent(testId)}`, null, adminHeaders);
    record('GET /api/technicians/:id confirms technician is deleted (404 Not Found)', verifyDeletedRes.status === 404);

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    // Cleanup if technician wasn't deleted
    try {
      await userRepository.delete(testId);
    } catch (e) {}
    server.close();
  }

  console.log('\n------------------------------------------------------------');
  console.log(`  🎉 SUMMARY: ${passed}/${total} technician management tests passed!`);
  console.log('------------------------------------------------------------\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTechnicianTests();
