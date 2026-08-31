const assert = require('assert');
const path = require('path');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = require('../server');
const { userRepository, complaintRepository, studentRepository } = require('../repositories');

let server;
let baseUrl;
const testPort = 5077;

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

async function runIsolationTests() {
  console.log('\n============================================================');
  console.log('   🧪 MULTI-TENANT ROLE & DASHBOARD DATA ISOLATION TESTS');
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

  server = app.listen(testPort);
  baseUrl = `http://localhost:${testPort}`;

  const student1Email = `isolated.student1.${Date.now()}@hostelfix.edu`;
  const student2Email = `isolated.student2.${Date.now()}@hostelfix.edu`;
  let student1Token = '';
  let student2Token = '';
  let adminToken = '';
  let createdComplaintId = '';

  try {
    // 1. Create Student 1 and Student 2 in DB
    const s1 = await studentRepository.create({
      name: 'Isolated Student 1',
      email: student1Email,
      password: 'password123',
      roomNumber: '101',
      hostelBlock: 'Block A',
      registrationNumber: 'REG-ISO-1'
    });
    const s2 = await studentRepository.create({
      name: 'Isolated Student 2',
      email: student2Email,
      password: 'password123',
      roomNumber: '202',
      hostelBlock: 'Block B',
      registrationNumber: 'REG-ISO-2'
    });

    // 2. Authenticate Student 1
    const s1Login = await makeRequest('POST', '/api/login', { email: student1Email, password: 'password123', role: 'student' });
    student1Token = s1Login.body.token || '';
    const s1Headers = { Authorization: `Bearer ${student1Token}` };
    record('Student 1 logs in and receives JWT token', s1Login.status === 200 && Boolean(student1Token));

    // 3. Authenticate Student 2
    const s2Login = await makeRequest('POST', '/api/login', { email: student2Email, password: 'password123', role: 'student' });
    student2Token = s2Login.body.token || '';
    const s2Headers = { Authorization: `Bearer ${student2Token}` };
    record('Student 2 logs in and receives JWT token', s2Login.status === 200 && Boolean(student2Token));

    // 4. Check initial summary for Student 1 (should be 0 total complaints)
    const s1SummaryBefore = await makeRequest('GET', '/api/summary', null, s1Headers);
    record('Student 1 initial dashboard summary is 0 complaints', s1SummaryBefore.status === 200 && s1SummaryBefore.body.total === 0);

    // 5. Check initial complaints list for Student 1 (should be empty [])
    const s1ComplaintsBefore = await makeRequest('GET', '/api/complaints', null, s1Headers);
    record('Student 1 initial complaints list is empty', s1ComplaintsBefore.status === 200 && Array.isArray(s1ComplaintsBefore.body) && s1ComplaintsBefore.body.length === 0);

    // 6. Student 1 submits a complaint
    const createRes = await makeRequest('POST', '/api/complaints', {
      studentName: 'Isolated Student 1',
      studentEmail: student1Email,
      studentId: s1.userId,
      hostelBlock: 'Block A',
      roomNumber: '101',
      category: 'Plumbing',
      description: 'Leaking tap in bathroom',
      priority: 'High'
    }, s1Headers);
    createdComplaintId = createRes.body.id;
    record('Student 1 creates a complaint successfully', createRes.status === 201 && Boolean(createdComplaintId));

    // 7. Student 1 summary now reflects 1 complaint
    const s1SummaryAfter = await makeRequest('GET', '/api/summary', null, s1Headers);
    record('Student 1 summary updates to total: 1, pending: 1', s1SummaryAfter.status === 200 && s1SummaryAfter.body.total === 1 && s1SummaryAfter.body.pending === 1);

    // 8. Student 1 complaints list contains their complaint
    const s1ComplaintsAfter = await makeRequest('GET', '/api/complaints', null, s1Headers);
    record('Student 1 complaints list returns their 1 complaint', s1ComplaintsAfter.status === 200 && s1ComplaintsAfter.body.length === 1 && s1ComplaintsAfter.body[0].id === createdComplaintId);

    // 9. DATA ISOLATION CHECK: Student 2 MUST NOT see Student 1's complaint
    const s2Summary = await makeRequest('GET', '/api/summary', null, s2Headers);
    record('ISOLATION: Student 2 summary remains 0 (does not share Student 1 stats)', s2Summary.status === 200 && s2Summary.body.total === 0);

    // 10. DATA ISOLATION CHECK: Student 2 complaints list MUST be empty
    const s2Complaints = await makeRequest('GET', '/api/complaints', null, s2Headers);
    record('ISOLATION: Student 2 complaints list is empty (does not see Student 1 complaints)', s2Complaints.status === 200 && s2Complaints.body.length === 0);

    // 11. Admin login sees global summary
    const adminLogin = await makeRequest('POST', '/api/login', { email: 'sabithacys@siet.ac', password: 'sabitha123', role: 'admin' });
    adminToken = adminLogin.body.token || '';
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const adminSummary = await makeRequest('GET', '/api/summary', null, adminHeaders);
    record('Admin summary includes global metrics across all students', adminSummary.status === 200 && adminSummary.body.total >= 1);

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    // Cleanup
    try {
      if (createdComplaintId) await complaintRepository.delete(createdComplaintId);
      await studentRepository.delete(student1Email);
      await studentRepository.delete(student2Email);
    } catch (e) {}
    server.close();
  }

  console.log('\n------------------------------------------------------------');
  console.log(`  🎉 SUMMARY: ${passed}/${total} data isolation tests passed!`);
  console.log('------------------------------------------------------------\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runIsolationTests();
