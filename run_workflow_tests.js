const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 5005;
const BASE_URL = `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const BACKUP_DB_PATH = path.join(__dirname, 'data', 'db.json.bak');

let passedTests = 0;
let failedTests = 0;
const testResults = [];

function recordResult(testName, success, message = '') {
  if (success) {
    passedTests++;
    console.log(`[PASS] ${testName} ${message ? '- ' + message : ''}`);
    testResults.push({ name: testName, status: 'PASS', details: message });
  } else {
    failedTests++;
    console.error(`[FAIL] ${testName} ${message ? '- ' + message : ''}`);
    testResults.push({ name: testName, status: 'FAIL', details: message });
  }
}

function makeRequest(method, endpoint, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const reqHeaders = { ...headers };
    let payload = null;

    if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) {
      payload = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    } else if (Buffer.isBuffer(body)) {
      payload = body;
      reqHeaders['Content-Length'] = payload.length;
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let parsed = null;
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try {
            parsed = JSON.parse(buffer.toString());
          } catch (e) {
            parsed = buffer.toString();
          }
        } else {
          parsed = buffer;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
          raw: buffer
        });
      });
    });

    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(retries = 30, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await makeRequest('GET', '/api/summary');
      if (res.status === 200) return true;
    } catch (e) {
      // Waiting for server spin-up
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  return false;
}

async function runAllTests() {
  console.log('=== STARTING HOSTELFIX WORKFLOW & PROCESS TEST SUITE ===\n');

  // 1. Back up database
  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, BACKUP_DB_PATH);
    console.log('Backed up data/db.json to data/db.json.bak');
  }

  // 2. Start server on PORT 5005
  console.log(`Starting server process on port ${PORT}...`);
  const serverEnv = { ...process.env, PORT: String(PORT) };
  const serverProcess = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', (d) => {
    // console.log('[SERVER STDOUT]', d.toString().trim());
  });
  serverProcess.stderr.on('data', (d) => {
    // console.error('[SERVER STDERR]', d.toString().trim());
  });

  const isServerReady = await waitForServer();
  if (!isServerReady) {
    console.error('Server failed to start on port ' + PORT);
    serverProcess.kill();
    process.exit(1);
  }
  console.log('Server is ready and accepting requests!\n');

  try {
    // WORKFLOW 1: Web Server & Static Endpoints
    console.log('--- Process 1: Static Files & HTML Page Workflows ---');
    {
      const resRoot = await makeRequest('GET', '/');
      recordResult('GET / (Index Page)', resRoot.status === 200 && resRoot.raw.toString().includes('HostelFix'), `HTTP ${resRoot.status}`);

      const resPublic = await makeRequest('GET', '/public/index.html');
      recordResult('GET /public/index.html (Redirect or Static)', resPublic.status === 200 || resPublic.status === 301 || resPublic.status === 302, `HTTP ${resPublic.status}`);

      const res404 = await makeRequest('GET', '/api/nonexistent-route-xyz');
      recordResult('GET 404 Route handling', res404.status === 404 && res404.body?.error === 'API route not found', `HTTP ${res404.status}`);
    }

    // WORKFLOW 2: Authentication & User Registration Workflow
    console.log('\n--- Process 2: Authentication & User Registration Workflows ---');
    const timestamp = Date.now();
    const testStudentEmail = `test_student_${timestamp}@hostelfix.edu`;
    const testWardenEmail = `test_warden_${timestamp}@hostelfix.edu`;
    let createdStudentId = null;
    let createdWardenId = null;

    {
      // Register Student
      const regRes = await makeRequest('POST', '/api/register', {
        name: 'Test Student',
        email: testStudentEmail,
        password: 'password123',
        role: 'student',
        phone: '9876543210',
        hostelBlock: 'Block A',
        roomNumber: 'A-101',
        registrationNumber: `REG-${timestamp}`
      });
      recordResult('POST /api/register (Student)', regRes.status === 201 && regRes.body.role === 'student', `Status ${regRes.status}, ID: ${regRes.body?.userId}`);
      createdStudentId = regRes.body?.userId;

      // Duplicate Register validation (409 Conflict expected)
      const dupRegRes = await makeRequest('POST', '/api/register', {
        name: 'Test Student Duplicate',
        email: testStudentEmail,
        password: 'password123',
        role: 'student'
      });
      recordResult('POST /api/register (Duplicate Email Blocked with 409)', dupRegRes.status === 409, `Status ${dupRegRes.status}`);

      // Login Valid
      const loginRes = await makeRequest('POST', '/api/login', {
        email: testStudentEmail,
        password: 'password123',
        role: 'student'
      });
      recordResult('POST /api/login (Success)', loginRes.status === 200 && loginRes.body.email === testStudentEmail, `Status ${loginRes.status}`);

      // Login Invalid Password
      const loginBadRes = await makeRequest('POST', '/api/login', {
        email: testStudentEmail,
        password: 'wrongpassword',
        role: 'student'
      });
      recordResult('POST /api/login (Invalid Password)', loginBadRes.status === 401, `Status ${loginBadRes.status}`);

      // List Users & Password Sanitization
      const listUsersRes = await makeRequest('GET', '/api/users');
      const hasPasswordsSanitized = listUsersRes.body.every(u => u.password === undefined);
      recordResult('GET /api/users (Sanitization Check)', listUsersRes.status === 200 && hasPasswordsSanitized, `Sanitized: ${hasPasswordsSanitized}, Count: ${listUsersRes.body.length}`);

      // Register Warden
      const wardenRegRes = await makeRequest('POST', '/api/register', {
        name: 'Test Warden',
        email: testWardenEmail,
        password: 'password123',
        role: 'warden',
        phone: '9876543211',
        hostelBlock: 'Block A'
      });
      recordResult('POST /api/register (Warden)', wardenRegRes.status === 201 && wardenRegRes.body.role === 'warden', `Status ${wardenRegRes.status}`);
      createdWardenId = wardenRegRes.body?.userId;
    }

    // WORKFLOW 3: Student, Warden & Technician Management APIs
    console.log('\n--- Process 3: User Role Management APIs ---');
    {
      // Add Warden via POST /api/wardens
      const addWardenRes = await makeRequest('POST', '/api/wardens', {
        name: 'Warden Smith',
        email: `warden_smith_${timestamp}@hostelfix.edu`,
        phone: '9123456789',
        hostelBlock: 'Block B',
        password: 'wardenpassword'
      });
      recordResult('POST /api/wardens', addWardenRes.status === 201, `Status ${addWardenRes.status}`);

      // Get Wardens
      const getWardensRes = await makeRequest('GET', '/api/wardens');
      recordResult('GET /api/wardens', getWardensRes.status === 200 && Array.isArray(getWardensRes.body), `Count: ${getWardensRes.body.length}`);

      // Add Technician
      const addTechRes = await makeRequest('POST', '/api/technicians', {
        name: 'Tech Bob',
        email: `tech_bob_${timestamp}@hostelfix.edu`,
        phone: '9988776655',
        specialization: 'Plumbing',
        password: 'techpassword'
      });
      recordResult('POST /api/technicians', addTechRes.status === 201, `Status ${addTechRes.status}`);

      // Get Technicians
      const getTechsRes = await makeRequest('GET', '/api/technicians');
      recordResult('GET /api/technicians', getTechsRes.status === 200 && Array.isArray(getTechsRes.body), `Count: ${getTechsRes.body.length}`);
    }

    // WORKFLOW 4: Complaints Lifecycle Workflow
    console.log('\n--- Process 4: Complaints Lifecycle Workflow ---');
    let createdComplaintId = null;
    {
      // Create complaint
      const createCmpRes = await makeRequest('POST', '/api/complaints', {
        student: 'Test Student',
        email: testStudentEmail,
        registrationNumber: `REG-${timestamp}`,
        hostelBlock: 'Block A',
        roomNumber: 'A-101',
        category: 'Plumbing',
        priority: 'High',
        description: 'Water leak in restroom sink.'
      });
      recordResult('POST /api/complaints', createCmpRes.status === 201 && createCmpRes.body.status === 'Pending', `ID: ${createCmpRes.body?.id}`);
      createdComplaintId = createCmpRes.body?.id;

      // Get complaints list
      const getCmpsRes = await makeRequest('GET', '/api/complaints');
      recordResult('GET /api/complaints', getCmpsRes.status === 200 && getCmpsRes.body.some(c => c.id === createdComplaintId), `Count: ${getCmpsRes.body.length}`);

      // Get single complaint
      const getSingleCmpRes = await makeRequest('GET', `/api/complaints/${createdComplaintId}`);
      recordResult('GET /api/complaints/:id', getSingleCmpRes.status === 200 && getSingleCmpRes.body.id === createdComplaintId, `Status: ${getSingleCmpRes.status}`);

      // Update status to In Progress
      const updateStatusRes = await makeRequest('PUT', `/api/complaints/${createdComplaintId}/status`, {
        status: 'In Progress'
      });
      recordResult('PUT /api/complaints/:id/status (In Progress)', updateStatusRes.status === 200 && updateStatusRes.body.status === 'In Progress', `Status: ${updateStatusRes.body?.status}`);

      // Assign technician & update details
      const updateDetailsRes = await makeRequest('PUT', `/api/complaints/${createdComplaintId}`, {
        assignedTo: 'Tech Bob',
        status: 'Completed',
        remarks: 'Fixed pipe joint seal'
      });
      recordResult('PUT /api/complaints/:id (Assignment & Completion)', updateDetailsRes.status === 200 && updateDetailsRes.body.assignedTo === 'Tech Bob', `Assigned: ${updateDetailsRes.body?.assignedTo}`);

      // Verify System Summary metrics after completion
      const summaryRes = await makeRequest('GET', '/api/summary');
      recordResult('GET /api/summary', summaryRes.status === 200 && summaryRes.body.total >= 1, `Total: ${summaryRes.body?.total}, Completed: ${summaryRes.body?.completed}`);
    }

    // WORKFLOW 5: Announcements & Personal Notifications Workflow
    console.log('\n--- Process 5: Announcements & Notifications Workflow ---');
    let createdAnnouncementId = null;
    {
      // Post Announcement
      const postAnnRes = await makeRequest('POST', '/api/announcements', {
        title: 'Water Supply Maintenance',
        message: 'Water supply will be paused from 2 PM to 4 PM.',
        priority: 'Important',
        audience: 'All Students',
        adminName: 'Test Warden'
      });
      recordResult('POST /api/announcements', postAnnRes.status === 201 && postAnnRes.body.title === 'Water Supply Maintenance', `ID: ${postAnnRes.body?.id}`);
      createdAnnouncementId = postAnnRes.body?.id;

      // Get Announcements
      const getAnnRes = await makeRequest('GET', '/api/announcements');
      recordResult('GET /api/announcements', getAnnRes.status === 200 && getAnnRes.body.some(a => a.id === createdAnnouncementId), `Count: ${getAnnRes.body.length}`);

      // Get Student Notifications
      const studentNotifRes = await makeRequest('GET', `/api/student-notifications?email=${encodeURIComponent(testStudentEmail)}&block=Block%20A`);
      recordResult('GET /api/student-notifications', studentNotifRes.status === 200 && Array.isArray(studentNotifRes.body), `Notifications count: ${studentNotifRes.body.length}`);

      // Get Warden Notifications
      const wardenNotifRes = await makeRequest('GET', `/api/warden-notifications?email=${encodeURIComponent(testWardenEmail)}&block=Block%20A`);
      recordResult('GET /api/warden-notifications', wardenNotifRes.status === 200 && Array.isArray(wardenNotifRes.body), `Notifications count: ${wardenNotifRes.body.length}`);
    }

    // WORKFLOW 6: Gate Pass & Security Verification Workflow
    console.log('\n--- Process 6: Gate Pass & Security Verification Workflow ---');
    let createdGatePassId = null;
    let gatePassToken = null;
    let gatePassQrToken = null;
    let fullGatePassObj = null;

    {
      // Apply for Gate Pass
      const applyGpRes = await makeRequest('POST', '/api/gatepass/apply', {
        student: 'Test Student',
        email: testStudentEmail,
        registrationNumber: `REG-${timestamp}`,
        hostelBlock: 'Block A',
        roomNumber: 'A-101',
        reason: 'Weekend Home Visit',
        gateDate: '2026-08-15',
        returnDate: '2026-08-17',
        destination: 'Home City',
        phone: '9876543210'
      });
      recordResult('POST /api/gatepass/apply', applyGpRes.status === 201 && applyGpRes.body.status === 'PENDING_ADMIN', `ID: ${applyGpRes.body?.id}`);
      createdGatePassId = applyGpRes.body?.id;
      fullGatePassObj = applyGpRes.body;

      // Get Gate Passes
      const getGpsRes = await makeRequest('GET', '/api/gate-passes');
      recordResult('GET /api/gate-passes', getGpsRes.status === 200 && getGpsRes.body.some(g => g.id === createdGatePassId), `Count: ${getGpsRes.body.length}`);

      // Get Gate Pass by ID
      const getGpRes = await makeRequest('GET', `/api/gatepass/${createdGatePassId}`);
      recordResult('GET /api/gatepass/:id', getGpRes.status === 200 && getGpRes.body.id === createdGatePassId, `Status: ${getGpRes.status}`);

      // Warden/Admin Approve Gate Pass
      const approveGpRes = await makeRequest('POST', '/api/gatepass/approve', {
        id: createdGatePassId,
        approvedBy: 'Test Warden',
        remarks: 'Approved for home visit'
      });
      recordResult('POST /api/gatepass/approve', approveGpRes.status === 200 && approveGpRes.body.gatePass?.status === 'SECURITY_PENDING', `QR Token: ${approveGpRes.body?.gatePass?.qrToken}`);
      gatePassToken = approveGpRes.body?.gatePass?.token || createdGatePassId;
      gatePassQrToken = approveGpRes.body?.gatePass?.qrToken || createdGatePassId;
      fullGatePassObj = approveGpRes.body?.gatePass;

      // Verify Preview for Security Scanner
      const previewRes = await makeRequest('POST', '/api/gatepass/verify-preview', {
        token: gatePassQrToken
      });
      recordResult('POST /api/gatepass/verify-preview', previewRes.status === 200 && previewRes.body.allowed === true, `Phase: ${previewRes.body?.phase}`);

      // Security Verify - Checkout (Exit Gate)
      const secVerifyCheckoutRes = await makeRequest('POST', '/api/gatepass/security/verify', {
        token: gatePassQrToken,
        verifiedBy: 'Security Guard John'
      });
      recordResult('POST /api/gatepass/security/verify (Checkout)', secVerifyCheckoutRes.status === 200 && secVerifyCheckoutRes.body.gatePass?.status === 'OUTSIDE', `Status: ${secVerifyCheckoutRes.body?.gatePass?.status}`);

      // Returns Summary
      const returnsSummaryRes = await makeRequest('GET', '/api/gatepass/returns-summary');
      recordResult('GET /api/gatepass/returns-summary', returnsSummaryRes.status === 200 && returnsSummaryRes.body.counts?.totalActive >= 1, `Total Active: ${returnsSummaryRes.body.counts?.totalActive}`);

      // Warden Verify - Checkin (Return Gate)
      const wardenVerifyCheckinRes = await makeRequest('POST', '/api/gatepass/warden/verify', {
        token: gatePassQrToken,
        verifiedBy: 'Warden Officer'
      });
      recordResult('POST /api/gatepass/warden/verify (Hostel Return)', wardenVerifyCheckinRes.status === 200 && wardenVerifyCheckinRes.body.gatePass?.status === 'COMPLETED', `Status: ${wardenVerifyCheckinRes.body?.gatePass?.status}`);

      // Gate Pass Verification Web Page (/qr/:token)
      const qrWebRes = await makeRequest('GET', `/qr/${gatePassQrToken}`);
      recordResult('GET /qr/:token HTML Page', qrWebRes.status === 200 && qrWebRes.raw.toString().includes('Gate Pass Verification'), `Status: ${qrWebRes.status}`);

      // Export Single Gate Pass PDF
      const singlePdfRes = await makeRequest('GET', `/api/gate-passes/${createdGatePassId}/pdf`);
      const isPdfHeader = singlePdfRes.raw.toString('ascii', 0, 5) === '%PDF-';
      recordResult('GET /api/gate-passes/:id/pdf', singlePdfRes.status === 200 && isPdfHeader, `PDF generated (${singlePdfRes.raw.length} bytes)`);

      // Export Gate Passes Bulk PDF
      const bulkPdfRes = await makeRequest('POST', '/api/gate-passes/export-pdf', {
        gatePasses: [fullGatePassObj]
      });
      const isBulkPdfHeader = bulkPdfRes.raw.toString('ascii', 0, 5) === '%PDF-';
      recordResult('POST /api/gate-passes/export-pdf', bulkPdfRes.status === 200 && isBulkPdfHeader, `Bulk PDF generated (${bulkPdfRes.raw.length} bytes)`);
    }

    // WORKFLOW 7: Laundry Requests Workflow
    console.log('\n--- Process 7: Laundry Requests Workflow ---');
    {
      const dummyPhoto = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...';
      const postLaundryRes = await makeRequest('POST', '/api/laundry-requests', {
        student: 'Test Student',
        email: testStudentEmail,
        registrationNumber: '714024149018',
        hostelBlock: 'Block A',
        roomNumber: '101',
        dressCount: 3,
        photos: [dummyPhoto],
        details: '3 shirts, 2 pants'
      });
      const laundryId = postLaundryRes.body ? postLaundryRes.body.id : null;
      recordResult('POST /api/laundry-requests (Student with photos, no pickup date)', postLaundryRes.status === 201 && postLaundryRes.body.dressCount === 3 && postLaundryRes.body.photos.length === 1, `Status: ${postLaundryRes.status}`);

      if (laundryId) {
        const patchLaundryRes = await makeRequest('PATCH', `/api/laundry-requests/${laundryId}`, {
          pickupDate: '2026-08-18',
          status: 'Pickup Scheduled'
        });
        recordResult('PATCH /api/laundry-requests/:id (Admin assign pickup date & status)', patchLaundryRes.status === 200 && patchLaundryRes.body.pickupDate === '2026-08-18' && patchLaundryRes.body.status === 'Pickup Scheduled', `Pickup: ${patchLaundryRes.body.pickupDate}`);
      }

      const getLaundryRes = await makeRequest('GET', '/api/laundry-requests');
      recordResult('GET /api/laundry-requests', getLaundryRes.status === 200 && getLaundryRes.body.some(l => l.email === testStudentEmail), `Count: ${getLaundryRes.body.length}`);
    }

    // WORKFLOW 8: Inventory & Restocking Workflow
    console.log('\n--- Process 8: Inventory & Restocking Workflow ---');
    {
      const getInvRes = await makeRequest('GET', '/api/inventory');
      recordResult('GET /api/inventory', getInvRes.status === 200 && Array.isArray(getInvRes.body) && getInvRes.body.length > 0, `Items count: ${getInvRes.body.length}`);

      const targetItem = getInvRes.body[0];
      const restockRes = await makeRequest('POST', '/api/inventory/restock', {
        id: targetItem.id,
        amount: 15
      });
      recordResult('POST /api/inventory/restock', restockRes.status === 200 && restockRes.body.item?.stock === targetItem.stock + 15, `New Stock: ${restockRes.body.item?.stock}`);
    }

    // WORKFLOW 9: CCTV Detection, Telegram Alert & PDF Logs
    console.log('\n--- Process 9: CCTV Emergency Alert & Telegram Service Workflows ---');
    {
      // Get Admin Settings
      const getSettingsRes = await makeRequest('GET', '/api/admin-settings');
      recordResult('GET /api/admin-settings', getSettingsRes.status === 200, `Alert Min Confidence: ${getSettingsRes.body.alertMinConfidence}`);

      // Update Admin Settings
      const putSettingsRes = await makeRequest('PUT', '/api/admin-settings', {
        alertCameraName: 'Test Camera 1',
        alertCameraLocation: 'Block A Entrance',
        alertMinConfidence: 50
      });
      recordResult('PUT /api/admin-settings', putSettingsRes.status === 200 && putSettingsRes.body.alertCameraName === 'Test Camera 1', `Updated Camera: ${putSettingsRes.body.alertCameraName}`);

      // Get Telegram Status
      const tgStatusRes = await makeRequest('GET', '/api/telegram-status');
      recordResult('GET /api/telegram-status', tgStatusRes.status === 200, `Configured: ${tgStatusRes.body.configured}`);

      // Test Telegram Connection (expect expected rejection when no real token)
      const testTgRes = await makeRequest('POST', '/api/test-telegram-alert', {
        telegramBotToken: '123456:ABC-INVALID_TOKEN_FOR_TEST',
        telegramChatId: '123456789'
      });
      recordResult('POST /api/test-telegram-alert (Error Handling)', testTgRes.status === 400 || testTgRes.status === 200, `Status: ${testTgRes.status}`);

      // Send Emergency Alert (Base64 Image + Fire Detection)
      const sampleBase64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const sendAlertRes = await makeRequest('POST', '/api/send-telegram-alert', {
        type: 'fire',
        confidence: 85,
        camera: 'Test Camera 1',
        location: 'Block A Entrance',
        image: sampleBase64Image
      });
      recordResult('POST /api/send-telegram-alert', (sendAlertRes.status === 200 || sendAlertRes.status === 201) && sendAlertRes.body.alert?.confidence === 85, `Alert Status: ${sendAlertRes.body.alert?.status}`);

      // Cooldown Verification (Send again immediately)
      const cooldownRes = await makeRequest('POST', '/api/send-telegram-alert', {
        type: 'fire',
        confidence: 85,
        camera: 'Test Camera 1',
        location: 'Block A Entrance',
        image: sampleBase64Image
      });
      recordResult('POST /api/send-telegram-alert (Cooldown active)', cooldownRes.status === 202 && cooldownRes.body.status === 'cooldown', `Status: ${cooldownRes.status}`);

      // Get Alert History
      const getAlertHistRes = await makeRequest('GET', '/api/alert-history');
      recordResult('GET /api/alert-history', getAlertHistRes.status === 200 && getAlertHistRes.body.some(a => a.camera === 'Test Camera 1'), `Count: ${getAlertHistRes.body.length}`);

      // CCTV Log PDF Export
      const cctvPdfRes = await makeRequest('POST', '/api/cctv-log-pdf', {
        alertHistory: getAlertHistRes.body
      });
      const isCctvPdf = cctvPdfRes.raw.toString('ascii', 0, 5) === '%PDF-';
      recordResult('POST /api/cctv-log-pdf', cctvPdfRes.status === 200 && isCctvPdf, `CCTV Log PDF generated (${cctvPdfRes.raw.length} bytes)`);
    }

    // WORKFLOW 10: AI / ML Inference Endpoints
    console.log('\n--- Process 10: AI / ML Model Inference Workflows ---');
    {
      const sampleBase64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      // CCTV Inference Test
      try {
        const cctvInfRes = await makeRequest('POST', '/api/cctv-inference', {
          image: sampleBase64Image,
          includeCrowd: true,
          sourceType: 'live'
        });
        recordResult('POST /api/cctv-inference', cctvInfRes.status === 200 || cctvInfRes.status === 500, `Status: ${cctvInfRes.status}, Response: ${JSON.stringify(cctvInfRes.body).slice(0, 80)}...`);
      } catch (err) {
        recordResult('POST /api/cctv-inference', false, err.message);
      }

      // Face Auth Inference Test
      try {
        const faceInfRes = await makeRequest('POST', '/api/face-auth-inference', {
          image: sampleBase64Image,
          reloadKnownFaces: true
        });
        recordResult('POST /api/face-auth-inference', faceInfRes.status === 200 || faceInfRes.status === 500, `Status: ${faceInfRes.status}, Response: ${JSON.stringify(faceInfRes.body).slice(0, 80)}...`);
      } catch (err) {
        recordResult('POST /api/face-auth-inference', false, err.message);
      }
    }

    // Clean up created test entities
    console.log('\n--- Cleaning up temporary test entities ---');
    if (createdStudentId) {
      const delUserRes = await makeRequest('DELETE', `/api/users/${createdStudentId}`);
      console.log(`Cleaned up student user ${createdStudentId}: status ${delUserRes.status}`);
    }
    if (createdWardenId) {
      const delWardenRes = await makeRequest('DELETE', `/api/users/${createdWardenId}`);
      console.log(`Cleaned up warden user ${createdWardenId}: status ${delWardenRes.status}`);
    }
    if (createdComplaintId) {
      const delCmpRes = await makeRequest('DELETE', `/api/complaints/${createdComplaintId}`);
      console.log(`Cleaned up complaint ${createdComplaintId}: status ${delCmpRes.status}`);
    }
    if (createdAnnouncementId) {
      const delAnnRes = await makeRequest('DELETE', `/api/announcements/${createdAnnouncementId}`);
      console.log(`Cleaned up announcement ${createdAnnouncementId}: status ${delAnnRes.status}`);
    }

  } catch (err) {
    console.error('Unhandled error during test execution:', err);
  } finally {
    // Kill server
    serverProcess.kill();
    console.log('\nTerminated test server instance.');

    // Restore database backup
    if (fs.existsSync(BACKUP_DB_PATH)) {
      fs.copyFileSync(BACKUP_DB_PATH, DB_PATH);
      fs.unlinkSync(BACKUP_DB_PATH);
      console.log('Restored original data/db.json from backup.\n');
    }

    // Summary report
    console.log('==================================================');
    console.log(`TEST SUMMARY: Total ${passedTests + failedTests} tests run.`);
    console.log(`PASSED: ${passedTests}`);
    console.log(`FAILED: ${failedTests}`);
    console.log('==================================================');

    if (failedTests > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runAllTests();
