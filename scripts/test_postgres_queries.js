const db = require('../db');
const userRepository = require('../repositories/userRepository');
const complaintRepository = require('../repositories/complaintRepository');
const gatePassRepository = require('../repositories/gatePassRepository');
const laundryRepository = require('../repositories/laundryRepository');
const announcementRepository = require('../repositories/announcementRepository');
const inventoryRepository = require('../repositories/inventoryRepository');
const notificationRepository = require('../repositories/notificationRepository');
const securityEventRepository = require('../repositories/securityEventRepository');
const wardenRepository = require('../repositories/wardenRepository');

async function testAll() {
    console.log('--- Testing PostgreSQL Connection and Repositories ---');

    const conn = await db.testConnection();
    if (!conn.success) {
        console.error('PostgreSQL Connection Test Failed:', conn.error);
        process.exit(1);
    }

    try {
        const users = await userRepository.getAll();
        console.log(`[Users] Retrieved ${users.length} users from PostgreSQL.`);
        if (users.length > 0) {
            console.log(`   Sample User: ID=${users[0].id}, Email=${users[0].email}, Role=${users[0].role}`);
        }

        const wardens = await wardenRepository.getAllWardens();
        console.log(`[Wardens] Retrieved ${wardens.length} wardens.`);

        const complaints = await complaintRepository.getAll();
        console.log(`[Complaints] Retrieved ${complaints.length} complaints.`);

        const passes = await gatePassRepository.getAll();
        console.log(`[GatePasses] Retrieved ${passes.length} gate passes.`);

        const laundry = await laundryRepository.getAll();
        console.log(`[Laundry] Retrieved ${laundry.length} laundry requests.`);

        const announcements = await announcementRepository.getAll();
        console.log(`[Announcements] Retrieved ${announcements.length} announcements.`);

        const inventory = await inventoryRepository.getAll();
        console.log(`[Inventory] Retrieved ${inventory.length} inventory items.`);

        const notifications = await notificationRepository.getForRecipient('', '', 'all');
        console.log(`[Notifications] Retrieved ${notifications.length} notifications.`);

        const events = await securityEventRepository.getAll();
        console.log(`[SecurityEvents] Retrieved ${events.length} security events.`);

        console.log('\nSUCCESS: All PostgreSQL repository queries executed cleanly without errors!');
        process.exit(0);
    } catch (err) {
        console.error('Repository Test Error:', err);
        process.exit(1);
    }
}

testAll();
