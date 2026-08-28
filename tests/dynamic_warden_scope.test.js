const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const {
    userRepository,
    studentRepository,
    wardenRepository,
    wardenScopeRepository,
    wardenPermissionRepository,
    complaintRepository,
    gatePassRepository,
    inventoryRepository
} = require('../repositories');

const {
    isStudentInScope,
    filterStudentsForScope,
    isComplaintInScope,
    isGatePassInScope
} = require('../services/scopeService');

const { generateToken } = require('../middleware/authMiddleware');

async function runDynamicWardenScopeTests() {
    console.log('\n============================================================');
    console.log('   🧪 DYNAMIC WARDEN MANAGEMENT & SCOPE RBAC TESTS');
    console.log('============================================================\n');

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.log(`  ❌ [FAIL] ${name}: ${err.message}`);
            failed++;
        }
    }

    // 1. Admin Authentication & Token Test
    await test('Admin user loads from Supabase and generates valid JWT token', async () => {
        const adminUser = await userRepository.findByEmail('sabithacys@siet.ac');
        if (!adminUser) throw new Error('Admin sabithacys@siet.ac not found in database');
        if (adminUser.role !== 'admin') throw new Error(`Expected role 'admin', got '${adminUser.role}'`);
        const token = generateToken(adminUser);
        if (!token || typeof token !== 'string') throw new Error('Failed to generate JWT token');
    });

    // 2. Dynamic Warden Creation with Scope & Permissions
    const testWardenEmail = `testwarden_${Date.now()}@hostelfix.edu`;
    let createdWarden = null;

    await test('Admin dynamically creates Warden with Block A, Floor 1-2 scope', async () => {
        createdWarden = await wardenRepository.createWarden({
            name: 'Prof. Ramesh',
            email: testWardenEmail,
            password: 'wardenpassword123',
            hostelBlock: 'Block A',
            phone: '+91 98765 11223',
            hostel: 'Boys Hostel',
            floors: '1,2',
            rooms: '101-130, 201-230',
            permissions: ['view_students', 'view_gatepasses', 'approve_gatepasses', 'view_complaints']
        });

        if (!createdWarden || !createdWarden.userId) throw new Error('Warden creation returned empty record');
        if (!createdWarden.scope) throw new Error('Warden scope was not initialized');
        if (createdWarden.scope.block !== 'Block A') throw new Error(`Expected scope block 'Block A', got '${createdWarden.scope.block}'`);
    });

    // 3. Warden Scope Matching Tests
    await test('Warden Scope Service accurately isolates in-scope and out-of-scope students', async () => {
        const scope = createdWarden.scope;

        const studentInScope1 = { name: 'Student 1', hostelBlock: 'Block A', roomNumber: '105', floor: '1' };
        const studentInScope2 = { name: 'Student 2', hostelBlock: 'Block A', roomNumber: '210', floor: '2' };
        const studentOutOfScopeBlock = { name: 'Student 3', hostelBlock: 'Block B', roomNumber: '105', floor: '1' };
        const studentOutOfScopeFloor = { name: 'Student 4', hostelBlock: 'Block A', roomNumber: '305', floor: '3' };

        if (!isStudentInScope(studentInScope1, scope)) throw new Error('Student 1 should be IN SCOPE');
        if (!isStudentInScope(studentInScope2, scope)) throw new Error('Student 2 should be IN SCOPE');
        if (isStudentInScope(studentOutOfScopeBlock, scope)) throw new Error('Student 3 should be OUT OF SCOPE (Wrong Block)');
        if (isStudentInScope(studentOutOfScopeFloor, scope)) throw new Error('Student 4 should be OUT OF SCOPE (Wrong Floor)');

        const allMock = [studentInScope1, studentInScope2, studentOutOfScopeBlock, studentOutOfScopeFloor];
        const filtered = filterStudentsForScope(allMock, scope);
        if (filtered.length !== 2) throw new Error(`Expected 2 filtered students, got ${filtered.length}`);
    });

    // 4. Warden Scope on Complaints & Gate Passes
    await test('Warden Scope Service filters complaints and gate passes by block and room', async () => {
        const scope = createdWarden.scope;

        const compInScope = { id: 'C1', block: 'Block A', roomNumber: '105' };
        const compOutOfScope = { id: 'C2', block: 'Block C', roomNumber: '105' };

        if (!isComplaintInScope(compInScope, scope)) throw new Error('Complaint in Block A should be in scope');
        if (isComplaintInScope(compOutOfScope, scope)) throw new Error('Complaint in Block C should NOT be in scope');

        const gpInScope = { id: 'G1', block: 'Block A', roomNumber: '205' };
        const gpOutOfScope = { id: 'G2', block: 'Block B', roomNumber: '101' };

        if (!isGatePassInScope(gpInScope, scope)) throw new Error('Gate pass in Block A should be in scope');
        if (isGatePassInScope(gpOutOfScope, scope)) throw new Error('Gate pass in Block B should NOT be in scope');
    });

    // 5. Granular RBAC Permissions Verification
    await test('Granular RBAC checks allow permitted actions and deny unassigned permissions', async () => {
        const wardenId = createdWarden.userId;

        const canViewStudents = await wardenPermissionRepository.hasPermission(wardenId, 'view_students');
        const canApproveGatePass = await wardenPermissionRepository.hasPermission(wardenId, 'approve_gatepasses');
        const canManageInventory = await wardenPermissionRepository.hasPermission(wardenId, 'manage_inventory');

        if (!canViewStudents) throw new Error('Warden should have view_students permission');
        if (!canApproveGatePass) throw new Error('Warden should have approve_gatepasses permission');
        if (canManageInventory) throw new Error('Warden should NOT have manage_inventory permission');
    });

    // 6. Dynamic Admin Permission Update
    await test('Admin dynamically updates warden permissions and scopes in database', async () => {
        const wardenId = createdWarden.userId;

        // Add manage_inventory permission
        const newPerms = ['view_students', 'view_gatepasses', 'approve_gatepasses', 'manage_inventory'];
        await wardenPermissionRepository.setPermissions(wardenId, newPerms);

        const canManageInventoryNow = await wardenPermissionRepository.hasPermission(wardenId, 'manage_inventory');
        if (!canManageInventoryNow) throw new Error('Permission update failed');

        // Update scope to Block B
        await wardenScopeRepository.saveWardenScope(wardenId, {
            hostel: 'All',
            block: 'Block B',
            floors: 'All',
            rooms: 'All'
        });

        const updatedScope = await wardenScopeRepository.getScopeForWarden(wardenId);
        if (updatedScope.block !== 'Block B') throw new Error(`Scope update failed, got '${updatedScope.block}'`);
    });

    // 7. Cleanup test warden
    await test('Admin deletes test warden from database', async () => {
        const deleted = await wardenRepository.deleteWarden(createdWarden.userId);
        if (!deleted) throw new Error('Failed to delete test warden');
    });

    console.log('\n------------------------------------------------------------');
    console.log(`  🎉 SUMMARY: ${passed}/${passed + failed} dynamic warden scope & RBAC tests passed!`);
    console.log('------------------------------------------------------------\n');

    if (failed > 0) process.exit(1);
}

runDynamicWardenScopeTests().catch(console.error);
