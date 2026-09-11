const fs = require('fs');
const path = require('path');
const db = require('../db');

async function runMigration() {
    console.log('[PostgreSQL Migration] Starting schema migration and data import...');

    // 1. Test PostgreSQL Connection
    const conn = await db.testConnection();
    if (!conn.success) {
        console.error('[PostgreSQL Migration] Database connection failed:', conn.error);
        process.exit(1);
    }

    // 2. Read and Execute SQL Schema Migration
    const sqlPath = path.join(__dirname, '..', 'migrations', '001_initial_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('[PostgreSQL Migration] Creating schema tables & indexes...');
    await db.query(sql);
    console.log('[PostgreSQL Migration] Schema tables created successfully!');

    // 3. Read data/db.json for seeding
    const dbJsonPath = path.join(__dirname, '..', 'data', 'db.json');
    if (!fs.existsSync(dbJsonPath)) {
        console.log('[PostgreSQL Migration] No db.json found for seeding. Schema migration complete.');
        process.exit(0);
    }

    const raw = fs.readFileSync(dbJsonPath, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);

    // --- Migrate Users ---
    const users = data.users || [];
    let usersMigrated = 0;
    for (const u of users) {
        const queryText = `
            INSERT INTO users ("userId", email, password, name, role, status, phone, "hostelBlock", "roomNumber", "registrationNumber", "createdByAdmin")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (email) DO UPDATE SET
                "userId" = EXCLUDED."userId",
                name = EXCLUDED.name,
                role = EXCLUDED.role,
                status = EXCLUDED.status,
                phone = EXCLUDED.phone,
                "hostelBlock" = EXCLUDED."hostelBlock",
                "roomNumber" = EXCLUDED."roomNumber",
                "registrationNumber" = EXCLUDED."registrationNumber";
        `;
        await db.query(queryText, [
            u.userId || u.id || `USR-${Date.now()}`,
            u.email,
            u.password || '',
            u.name || u.email.split('@')[0],
            u.role || 'student',
            u.status || 'Active',
            u.phone || '',
            u.hostelBlock || '',
            u.roomNumber || '',
            u.registrationNumber || '',
            Boolean(u.createdByAdmin)
        ]);
        usersMigrated++;
    }
    console.log(`[PostgreSQL Migration] Migrated ${usersMigrated} users.`);

    // --- Migrate Complaints ---
    const complaints = data.complaints || [];
    let complaintsMigrated = 0;
    for (const c of complaints) {
        const queryText = `
            INSERT INTO complaints (id, student, email, "registrationNumber", "hostelBlock", "roomNumber", category, priority, description, status, "assignedTo", "resolutionNotes", "beforePhotoUrl", "afterPhotoUrl", timeline)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (id) DO NOTHING;
        `;
        await db.query(queryText, [
            c.id || `CMP-${Date.now()}`,
            c.student || '',
            c.email || '',
            c.registrationNumber || '',
            c.hostelBlock || '',
            c.roomNumber || '',
            c.category || 'general',
            c.priority || 'Low',
            c.description || '',
            c.status || 'Pending',
            c.assignedTo || '',
            c.resolutionNotes || '',
            c.beforePhotoUrl || '',
            c.afterPhotoUrl || '',
            JSON.stringify(c.timeline || [])
        ]);
        complaintsMigrated++;
    }
    console.log(`[PostgreSQL Migration] Migrated ${complaintsMigrated} complaints.`);

    // --- Migrate Gate Passes ---
    const gatePasses = data.gatePasses || [];
    let passesMigrated = 0;
    for (const p of gatePasses) {
        const queryText = `
            INSERT INTO gate_passes (id, student, email, "registrationNumber", "hostelBlock", "roomNumber", "gateDate", "returnDate", session, reason, status, "exitTime", "hostelArrivalTime", "approvedBy", "qrCode")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (id) DO NOTHING;
        `;
        await db.query(queryText, [
            p.id || `GP-${Date.now()}`,
            p.student || '',
            p.email || '',
            p.registrationNumber || '',
            p.hostelBlock || '',
            p.roomNumber || '',
            p.gateDate || '',
            p.returnDate || '',
            p.session || '',
            p.reason || '',
            p.status || 'Pending',
            p.exitTime || '',
            p.hostelArrivalTime || '',
            p.approvedBy || '',
            p.qrCode || ''
        ]);
        passesMigrated++;
    }
    console.log(`[PostgreSQL Migration] Migrated ${passesMigrated} gate passes.`);

    // --- Migrate Laundry Requests ---
    const laundry = data.laundryRequests || [];
    let laundryMigrated = 0;
    for (const l of laundry) {
        const queryText = `
            INSERT INTO laundry_requests (id, "studentName", email, "hostelBlock", "roomNumber", "clothCount", "pickupDate", status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO NOTHING;
        `;
        await db.query(queryText, [
            l.id || `LND-${Date.now()}`,
            l.studentName || '',
            l.email || '',
            l.hostelBlock || '',
            l.roomNumber || '',
            parseInt(l.clothCount || '0', 10),
            l.pickupDate || '',
            l.status || 'Requested'
        ]);
        laundryMigrated++;
    }
    console.log(`[PostgreSQL Migration] Migrated ${laundryMigrated} laundry requests.`);

    // --- Migrate Announcements ---
    const announcements = data.announcements || [];
    let announcementsMigrated = 0;
    for (const a of announcements) {
        const queryText = `
            INSERT INTO announcements (id, title, message, audience, priority, "authorName")
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING;
        `;
        await db.query(queryText, [
            a.id || `ANC-${Date.now()}`,
            a.title || '',
            a.message || '',
            a.audience || 'All',
            a.priority || 'Normal',
            a.authorName || 'Admin'
        ]);
        announcementsMigrated++;
    }
    console.log(`[PostgreSQL Migration] Migrated ${announcementsMigrated} announcements.`);

    // --- Migrate Inventory ---
    const inventory = data.inventory || [];
    let inventoryMigrated = 0;
    for (const i of inventory) {
        const queryText = `
            INSERT INTO inventory (id, item_name, category, quantity, min_threshold, unit)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING;
        `;
        await db.query(queryText, [
            i.id || `INV-${Date.now()}`,
            i.item_name || i.name || '',
            i.category || 'General',
            parseInt(i.quantity || '0', 10),
            parseInt(i.min_threshold || '5', 10),
            i.unit || 'pcs'
        ]);
        inventoryMigrated++;
    }
    console.log(`[PostgreSQL Migration] Migrated ${inventoryMigrated} inventory items.`);

    // --- Migrate Personal Notifications ---
    const notifications = data.personalNotifications || [];
    let notifsMigrated = 0;
    for (const n of notifications) {
        const queryText = `
            INSERT INTO personal_notifications (id, type, title, message, audience, "targetEmail", "targetName", priority, read)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO NOTHING;
        `;
        await db.query(queryText, [
            n.id || `NTF-${Date.now()}`,
            n.type || 'info',
            n.title || '',
            n.message || '',
            n.audience || 'All',
            n.targetEmail || '',
            n.targetName || '',
            n.priority || 'Normal',
            Boolean(n.read)
        ]);
        notifsMigrated++;
    }
    console.log(`[PostgreSQL Migration] Migrated ${notifsMigrated} personal notifications.`);

    console.log('[PostgreSQL Migration] All database tables initialized & data migrated successfully!');
    process.exit(0);
}

runMigration().catch(err => {
    console.error('[PostgreSQL Migration Fatal Error]', err);
    process.exit(1);
});
