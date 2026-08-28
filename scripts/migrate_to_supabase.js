const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSupabaseClient } = require('../repositories/supabaseClient');

async function migrateData() {
    console.log('====================================================');
    console.log('🚀 HOSTELFIX SUPABASE COMPREHENSIVE MIGRATION');
    console.log('====================================================\n');

    const sb = getSupabaseClient();
    if (!sb) {
        console.error('❌ Could not connect to Supabase. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
        process.exit(1);
    }

    const localDbPath = path.join(__dirname, '../data/db.json');
    if (!fs.existsSync(localDbPath)) {
        console.log('ℹ️ No local db.json found to migrate.');
        return;
    }

    const raw = fs.readFileSync(localDbPath, 'utf8').replace(/^\uFEFF/, '');
    const localData = JSON.parse(raw);

    // 1. Migrate Users
    console.log('➡️ Migrating Users...');
    const localUsers = Array.isArray(localData.users) ? localData.users : [];
    let usersMigrated = 0;
    for (const u of localUsers) {
        if (!u.email) continue;
        const normEmail = u.email.trim().toLowerCase();
        
        // Check if user already exists in Supabase
        const { data: existing, error: findErr } = await sb
            .from('users')
            .select('id, email')
            .ilike('email', normEmail)
            .maybeSingle();

        if (findErr) {
            console.warn(`  ⚠️ Warning checking user ${normEmail}:`, findErr.message);
        }

        const userPayload = {
            user_id: u.userId || u.id || `USR-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
            email: normEmail,
            password: u.password || 'password123',
            name: u.name || 'User',
            role: u.role || 'student',
            room_number: u.roomNumber || u.room || '',
            block: u.block || u.hostelBlock || '',
            registration_number: u.registrationNumber || '',
            phone: u.phone || '',
            specialization: u.specialization || ''
        };

        if (!existing) {
            const { error: insertErr } = await sb.from('users').insert([userPayload]);
            if (insertErr) {
                console.error(`  ❌ Failed to insert user ${normEmail}:`, insertErr.message);
            } else {
                usersMigrated++;
                console.log(`  ✅ Inserted user ${normEmail} (${userPayload.role})`);
            }
        } else {
            // Ensure password and role are updated if needed
            const { error: updateErr } = await sb
                .from('users')
                .update(userPayload)
                .eq('id', existing.id);
            if (updateErr) {
                console.warn(`  ⚠️ Update warning for user ${normEmail}:`, updateErr.message);
            } else {
                console.log(`  🔄 Updated user ${normEmail} (${userPayload.role})`);
            }
        }
    }
    console.log(`✨ Users migration finished. Total processed: ${localUsers.length}\n`);

    // 2. Migrate Complaints
    console.log('➡️ Migrating Complaints...');
    const localComplaints = Array.isArray(localData.complaints) ? localData.complaints : [];
    let complaintsMigrated = 0;
    for (const c of localComplaints) {
        if (!c.id) continue;
        const complaintPayload = {
            id: c.id,
            title: c.title || (c.description ? c.description.slice(0, 45) : 'Hostel Maintenance'),
            description: c.description || c.title || 'Hostel maintenance issue',
            category: ['Electrical', 'Plumbing', 'Carpentry', 'HVAC', 'Cleaning', 'Appliance', 'General Maintenance', 'Other'].includes(c.category)
                ? c.category
                : 'General Maintenance',
            priority: ['Low', 'Medium', 'High', 'Emergency'].includes(c.priority) ? c.priority : 'Medium',
            status: ['Pending', 'In Progress', 'Completed', 'Rejected'].includes(c.status) ? c.status : 'Pending',
            block: c.block || c.hostelBlock || 'Block A',
            room_number: c.roomNumber || c.room || '101',
            student_id: c.studentId || c.userId || '',
            student_name: c.studentName || c.student || c.name || 'Resident Student',
            student_email: c.studentEmail || c.email || 'student@hostelfix.edu',
            technician_id: c.technicianId || null,
            technician_name: c.technicianName || c.technician || 'Unassigned',
            photo_url: c.photoUrl || c.photo || '',
            notes: c.notes || '',
            resolved_at: c.resolvedAt || null
        };

        const { error: cmpErr } = await sb.from('complaints').upsert([complaintPayload]);
        if (cmpErr) {
            console.error(`  ❌ Failed to upsert complaint ${c.id}:`, cmpErr.message);
        } else {
            complaintsMigrated++;
        }
    }
    console.log(`✨ Complaints migration finished. Processed: ${complaintsMigrated}\n`);

    // 3. Migrate Gate Passes
    console.log('➡️ Migrating Gate Passes...');
    const localGatePasses = Array.isArray(localData.gatePasses) ? localData.gatePasses : [];
    let gatePassesMigrated = 0;
    for (const g of localGatePasses) {
        if (!g.id) continue;
        const depDate = g.departureDate || g.date || (g.fromDate ? g.fromDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
        const depTime = g.departureTime || g.time || (g.fromTime ? g.fromTime.slice(0, 8) : '09:00:00');
        const retDate = g.expectedReturnDate || g.returnDate || (g.toDate ? g.toDate.slice(0, 10) : depDate);
        const retTime = g.expectedReturnTime || g.returnTime || (g.toTime ? g.toTime.slice(0, 8) : '18:00:00');

        const gpPayload = {
            id: g.id,
            student_id: g.studentId || g.userId || g.registrationNumber || 'STU-001',
            student_name: g.studentName || g.student || g.name || 'Resident Student',
            registration_number: g.registrationNumber || '',
            email: g.email || g.studentEmail || 'student@hostelfix.edu',
            room_number: g.roomNumber || g.room || '101',
            block: g.block || g.hostelBlock || 'Block A',
            reason: g.reason || 'Personal Visit',
            destination: g.destination || 'Home',
            parent_phone: g.parentPhone || '',
            student_phone: g.studentPhone || g.phone || '',
            departure_date: depDate,
            departure_time: depTime.length === 5 ? depTime + ':00' : depTime,
            expected_return_date: retDate,
            expected_return_time: retTime.length === 5 ? retTime + ':00' : retTime,
            status: ['Pending', 'Approved', 'Rejected', 'Out', 'Returned', 'Overdue'].includes(g.status) ? g.status : 'Pending',
            warden_approved_by: g.wardenApprovedBy || g.approvedBy || '',
            warden_approved_at: g.wardenApprovedAt || null,
            warden_notes: g.wardenNotes || '',
            actual_exit_at: g.actualExitAt || null,
            actual_entry_at: g.actualEntryAt || null,
            signature: g.signature || g.digitalSignature || '',
            qr_token: g.qrToken || g.qrCode || `QR-${g.id}`,
            student_photo: g.studentPhoto || g.photo || ''
        };

        const { error: gpErr } = await sb.from('gate_passes').upsert([gpPayload]);
        if (gpErr) {
            console.error(`  ❌ Failed to upsert gate pass ${g.id}:`, gpErr.message);
        } else {
            gatePassesMigrated++;
        }
    }
    console.log(`✨ Gate passes migration finished. Processed: ${gatePassesMigrated}\n`);

    // 4. Migrate Inventory
    console.log('➡️ Migrating Inventory...');
    const localInventory = Array.isArray(localData.inventory) ? localData.inventory : [];
    let inventoryMigrated = 0;
    for (const inv of localInventory) {
        if (!inv.id) continue;
        const invPayload = {
            id: inv.id,
            item_name: inv.itemName || inv.name || 'Maintenance Supply',
            category: inv.category || 'General',
            quantity: parseInt(inv.quantity || 0, 10),
            unit: inv.unit || 'units',
            min_stock: parseInt(inv.minStock || 5, 10),
            location: inv.location || 'Central Maintenance Store',
            status: ['In Stock', 'Low Stock', 'Out of Stock'].includes(inv.status) ? inv.status : 'In Stock',
            last_restocked_at: inv.lastRestockedAt || new Date().toISOString()
        };

        const { error: invErr } = await sb.from('inventory').upsert([invPayload]);
        if (invErr) {
            console.error(`  ❌ Failed to upsert inventory item ${inv.id}:`, invErr.message);
        } else {
            inventoryMigrated++;
        }
    }
    console.log(`✨ Inventory migration finished. Processed: ${inventoryMigrated}\n`);

    // 5. Migrate Announcements
    console.log('➡️ Migrating Announcements...');
    const localAnnouncements = Array.isArray(localData.announcements) ? localData.announcements : [];
    let announcementsMigrated = 0;
    for (const ann of localAnnouncements) {
        if (!ann.id) continue;
        const annPayload = {
            id: ann.id,
            title: ann.title || 'Hostel Announcement',
            message: ann.message || 'Hostel update',
            priority: ['Normal', 'Important', 'Emergency'].includes(ann.priority) ? ann.priority : 'Normal',
            audience: ['All Students', 'Boys Hostel', 'Girls Hostel', 'Specific Block', 'Individual'].includes(ann.audience)
                ? ann.audience
                : 'All Students',
            admin_name: ann.adminName || 'Hostel Administration',
            target_email: ann.targetEmail || '',
            type: ann.type || 'general'
        };

        const { error: annErr } = await sb.from('announcements').upsert([annPayload]);
        if (annErr) {
            console.error(`  ❌ Failed to upsert announcement ${ann.id}:`, annErr.message);
        } else {
            announcementsMigrated++;
        }
    }
    console.log(`✨ Announcements migration finished. Processed: ${announcementsMigrated}\n`);

    console.log('====================================================');
    console.log('🎉 MIGRATION TO SUPABASE COMPLETED SUCCESSFULLY');
    console.log('====================================================');
}

migrateData().catch(console.error);
