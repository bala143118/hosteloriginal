const fs = require('fs');
const path = require('path');
const db = require('../db');

async function resetLogins() {
    console.log('[Reset Logins] Connecting to database...');
    const conn = await db.testConnection();
    if (!conn.success) {
        console.error('[Reset Logins] Database connection failed:', conn.error);
        process.exit(1);
    }

    console.log('[Reset Logins] Deleting all old user accounts and warden data...');
    await db.query('DELETE FROM users;');
    await db.query('DELETE FROM warden_scopes;');
    await db.query('DELETE FROM warden_permissions;');

    const newUsers = [
        {
            userId: 'USR-ADMIN-01',
            email: 'sabithacys@siet.ac',
            password: 'admin123',
            name: 'Sabitha (Admin)',
            role: 'admin',
            status: 'Active',
            phone: '+91 98765 00001',
            hostelBlock: 'All',
            roomNumber: '',
            registrationNumber: 'ADMIN-01',
            createdByAdmin: false
        },
        {
            userId: 'WRD-DEEPTHI-01',
            email: 'deepthi123@gmail.com',
            password: 'warden123',
            name: 'Deepthi (Warden)',
            role: 'warden',
            status: 'Active',
            phone: '+91 98765 43210',
            hostelBlock: 'Block A',
            roomNumber: '',
            registrationNumber: 'WRD-01',
            createdByAdmin: false
        },
        {
            userId: 'USR-STUDENT-01',
            email: 'balamar2007@gmail.com',
            password: 'student123',
            name: 'Balamurugan',
            role: 'student',
            status: 'Active',
            phone: '+91 98765 11111',
            hostelBlock: '',
            roomNumber: '',
            registrationNumber: 'REG-2026-001',
            createdByAdmin: true
        },
        {
            userId: 'USR-SECURITY-01',
            email: 'security@gmail.com',
            password: 'security123',
            name: 'Campus Security',
            role: 'security',
            status: 'Active',
            phone: '+91 98765 22222',
            hostelBlock: 'Main Gate',
            roomNumber: '',
            registrationNumber: 'SEC-01',
            createdByAdmin: false
        },
        {
            userId: 'USR-TECH-01',
            email: 'tech@gmail.com',
            password: 'tech123',
            name: 'Hostel Technician',
            role: 'technician',
            status: 'Active',
            phone: '+91 98765 33333',
            hostelBlock: 'Campus',
            roomNumber: '',
            registrationNumber: 'TECH-01',
            createdByAdmin: false
        }
    ];

    console.log('[Reset Logins] Inserting new user accounts...');
    for (const u of newUsers) {
        const queryText = `
            INSERT INTO users ("userId", email, password, name, role, status, phone, "hostelBlock", "roomNumber", "registrationNumber", "createdByAdmin")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
        `;
        await db.query(queryText, [
            u.userId,
            u.email,
            u.password,
            u.name,
            u.role,
            u.status,
            u.phone,
            u.hostelBlock,
            u.roomNumber,
            u.registrationNumber,
            u.createdByAdmin
        ]);
        console.log(` -> Created ${u.role}: ${u.email} (Password: ${u.password})`);
    }

    // Add warden scope and permissions for Deepthi
    console.log('[Reset Logins] Configuring Warden scope and permissions...');
    await db.query(`
        INSERT INTO warden_scopes ("wardenId", "hostelBlock")
        VALUES ($1, $2), ($3, $4);
    `, ['WRD-DEEPTHI-01', 'Block A', 'deepthi123@gmail.com', 'Block A']);

    await db.query(`
        INSERT INTO warden_permissions ("wardenId", "canApproveComplaints", "canIssuePasses", "canManageInventory", "canManageStudents")
        VALUES ($1, true, true, true, true), ($2, true, true, true, true);
    `, ['WRD-DEEPTHI-01', 'deepthi123@gmail.com']);

    // Update data/db.json
    const dbJsonPath = path.join(__dirname, '..', 'data', 'db.json');
    if (fs.existsSync(dbJsonPath)) {
        try {
            const raw = fs.readFileSync(dbJsonPath, 'utf8').replace(/^\uFEFF/, '');
            const parsed = JSON.parse(raw);
            parsed.users = newUsers;
            fs.writeFileSync(dbJsonPath, JSON.stringify(parsed, null, 2), 'utf8');
            console.log('[Reset Logins] Updated data/db.json with new users.');
        } catch (err) {
            console.warn('[Reset Logins] Could not update data/db.json:', err.message);
        }
    }

    console.log('\n[Reset Logins] ALL LOGINS RECREATED SUCCESSFULLY!');
    process.exit(0);
}

resetLogins().catch(err => {
    console.error('[Reset Logins Fatal Error]', err);
    process.exit(1);
});
