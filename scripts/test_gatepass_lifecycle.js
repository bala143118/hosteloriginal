const assert = require('assert');
const http = require('http');
const app = require('../server');

let server;
const PORT = 5099;

function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: 'localhost',
            port: PORT,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function runTests() {
    console.log('--- Starting Gate Pass Lifecycle & Role-Based Approval Tests ---');
    server = app.listen(PORT);

    try {
        // 1. Step 1: Student applies for Gate Pass
        console.log('\n[Test 1] Student applies for Gate Pass...');
        const createRes = await makeRequest('POST', '/api/gate-passes', {
            studentName: 'Balamurugan S',
            email: 'balamar2007@gmail.com',
            registrationNumber: 'REG-2026-001',
            hostelBlock: 'Block A',
            roomNumber: '101',
            gateDate: '2026-09-22',
            returnDate: '2026-09-22',
            session: 'Morning',
            reason: 'Attending technical hackathon'
        });
        assert.ok([200, 201].includes(createRes.status), `Student gate pass creation failed with status ${createRes.status}`);
        const passId = createRes.body.id || createRes.body.gatePass?.id;
        assert.ok(passId, 'Gate pass ID not returned');
        console.log(`✅ Gate pass created with ID: ${passId}`);

        // 2. Admin cannot approve or reject
        console.log('\n[Test 2] Admin attempt to approve gate pass (must be blocked)...');
        const adminApproveRes = await makeRequest('PUT', `/api/gate-passes/${passId}/status`, {
            status: 'Approved',
            role: 'admin'
        });
        assert.strictEqual(adminApproveRes.status, 403, 'Admin should be forbidden from approving gate pass');
        console.log('✅ Admin approve was blocked with 403 Forbidden:', adminApproveRes.body.error);

        console.log('\n[Test 3] Admin attempt to reject gate pass (must be blocked)...');
        const adminRejectRes = await makeRequest('PUT', `/api/gate-passes/${passId}/status`, {
            status: 'Rejected',
            role: 'admin'
        });
        assert.strictEqual(adminRejectRes.status, 403, 'Admin should be forbidden from rejecting gate pass');
        console.log('✅ Admin reject was blocked with 403 Forbidden:', adminRejectRes.body.error);

        // 3. Step 2: Warden confirms student details and approves departure
        console.log('\n[Test 4] Step 2: Warden reviews student Name & ID and approves departure...');
        const wardenApproveRes = await makeRequest('PUT', `/api/gate-passes/${passId}/status`, {
            status: 'Approved',
            role: 'warden',
            approvedBy: 'Deepthi (Warden)',
            wardenName: 'Deepthi (Warden)'
        });
        assert.strictEqual(wardenApproveRes.status, 200, 'Warden approval failed');
        assert.strictEqual(wardenApproveRes.body.gatePass.status, 'Approved');
        console.log('✅ Step 2 complete: Warden approved departure, QR generated!');

        // 4. Step 3: Security verifies student exit at campus gate
        console.log('\n[Test 5] Step 3: Security scans/verifies student exit at campus gate...');
        const secExitRes = await makeRequest('POST', '/api/gatepass/security/verify', {
            token: passId,
            action: 'APPROVE',
            guardName: 'Main Gate Security Officer'
        });
        assert.strictEqual(secExitRes.status, 200, 'Security exit verification failed');
        assert.strictEqual(secExitRes.body.gatePass.status, 'OUTSIDE');
        assert.ok(secExitRes.body.gatePass.exitTime, 'Exit time must be recorded');
        console.log(`✅ Step 3 complete: Student exit approved at ${secExitRes.body.gatePass.exitTime}, status is OUTSIDE.`);

        // 5. Step 4: Student returns at return time, Security verifies at gate and allows gate entry
        console.log('\n[Test 6] Step 4: Student returns at gate, Security verifies return time and grants gate entry...');
        const secReturnRes = await makeRequest('POST', '/api/gatepass/security/verify', {
            token: passId,
            action: 'APPROVE',
            guardName: 'Main Gate Security Officer'
        });
        assert.strictEqual(secReturnRes.status, 200, 'Security return verification failed');
        assert.strictEqual(secReturnRes.body.gatePass.status, 'PENDING_WARDEN_RETURN', 'Status must be PENDING_WARDEN_RETURN, not COMPLETED yet');
        assert.ok(secReturnRes.body.gatePass.gateArrivalTime, 'Gate arrival time must be recorded');
        assert.strictEqual(secReturnRes.body.gatePass.wardenVerified, false, 'Warden has not verified yet');
        console.log(`✅ Step 4 complete: Student granted gate entry at ${secReturnRes.body.gatePass.gateArrivalTime}, status is PENDING_WARDEN_RETURN.`);

        // 6. Step 5: Warden reviews return and approves student back into hostel
        console.log('\n[Test 7] Step 5: Warden reviews student return and approves hostel entry...');
        const wardenReturnRes = await makeRequest('POST', '/api/gatepass/warden/verify', {
            token: passId,
            action: 'APPROVE',
            wardenName: 'Deepthi (Warden)',
            remarks: 'Student safely returned to Room 101 on time'
        });
        assert.strictEqual(wardenReturnRes.status, 200, 'Warden return verification failed');
        assert.strictEqual(wardenReturnRes.body.gatePass.status, 'COMPLETED');
        assert.strictEqual(wardenReturnRes.body.gatePass.wardenVerified, true);
        assert.ok(wardenReturnRes.body.gatePass.hostelArrivalTime, 'Hostel arrival time must be recorded');
        console.log(`✅ Step 5 complete: Student accepted into hostel at ${wardenReturnRes.body.gatePass.hostelArrivalTime}, status is COMPLETED.`);

        // 7. Test Step 5 rejection scenario (Warden denies hostel entry)
        console.log('\n[Test 8] Testing Step 5 Rejection scenario (Warden denies hostel entry)...');
        const pass2Res = await makeRequest('POST', '/api/gate-passes', {
            studentName: 'Test Student',
            email: 'test@gmail.com',
            registrationNumber: 'REG-TEST-002',
            hostelBlock: 'Block A',
            roomNumber: '102',
            gateDate: '2026-09-22',
            returnDate: '2026-09-22'
        });
        const pass2Id = pass2Res.body.id;
        await makeRequest('PUT', `/api/gate-passes/${pass2Id}/status`, { status: 'Approved', role: 'warden' });
        await makeRequest('POST', '/api/gatepass/security/verify', { token: pass2Id, action: 'APPROVE' }); // Exit
        await makeRequest('POST', '/api/gatepass/security/verify', { token: pass2Id, action: 'APPROVE' }); // Gate Return

        const wardenDenyRes = await makeRequest('POST', '/api/gatepass/warden/verify', {
            token: pass2Id,
            action: 'REJECT',
            wardenName: 'Deepthi (Warden)',
            rejectionReason: 'Late return beyond curfew without permission'
        });
        assert.strictEqual(wardenDenyRes.status, 200);
        assert.strictEqual(wardenDenyRes.body.gatePass.status, 'HOSTEL_ENTRY_REJECTED');
        assert.strictEqual(wardenDenyRes.body.gatePass.wardenVerified, false);
        console.log('✅ Step 5 rejection verified: Status is HOSTEL_ENTRY_REJECTED, student denied hostel entry.');

        console.log('\n🎉 ALL 8 TESTS PASSED SUCCESSFULLY! The 5-step lifecycle and admin restrictions are 100% verified.');
    } catch (err) {
        console.error('❌ Test failed:', err);
        process.exitCode = 1;
    } finally {
        server.close();
        process.exit(process.exitCode || 0);
    }
}

runTests();
