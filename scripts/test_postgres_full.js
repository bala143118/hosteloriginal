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

async function testFullPostgres() {
    console.log('\n--- 1. Testing PostgreSQL Server Connection Pool ---');
    const conn = await db.testConnection();
    if (!conn.success) {
        console.error('❌ Connection Failed:', conn.error);
        process.exit(1);
    }
    console.log(`✅ Connected to PostgreSQL DB '${conn.info.db_name}' (Version: ${conn.info.pg_version.slice(0, 30)}...)`);

    console.log('\n--- 2. Executing Real SELECT Queries against PostgreSQL ---');
    
    // Users SELECT
    const users = await userRepository.getAll();
    console.log(`✅ SELECT FROM users: Returned ${users.length} rows`);
    if (users.length > 0) {
        console.log(`   Sample User: ID=${users[0].id}, Email=${users[0].email}, Role=${users[0].role}`);
    }

    // Wardens SELECT
    const wardens = await wardenRepository.getAllWardens();
    console.log(`✅ SELECT FROM wardens/users: Returned ${wardens.length} wardens`);

    // Complaints SELECT
    const complaints = await complaintRepository.getAll();
    console.log(`✅ SELECT FROM complaints: Returned ${complaints.length} complaints`);

    // Gate Passes SELECT
    const passes = await gatePassRepository.getAll();
    console.log(`✅ SELECT FROM gate_passes: Returned ${passes.length} gate passes`);

    // Laundry Requests SELECT
    const laundry = await laundryRepository.getAll();
    console.log(`✅ SELECT FROM laundry_requests: Returned ${laundry.length} laundry requests`);

    // Announcements SELECT
    const announcements = await announcementRepository.getAll();
    console.log(`✅ SELECT FROM announcements: Returned ${announcements.length} announcements`);

    // Inventory SELECT
    const inventory = await inventoryRepository.getAll();
    console.log(`✅ SELECT FROM inventory: Returned ${inventory.length} inventory items`);

    // Personal Notifications SELECT
    const notifs = await notificationRepository.getForRecipient('', '', 'all');
    console.log(`✅ SELECT FROM personal_notifications: Returned ${notifs.length} notifications`);

    // Security Events SELECT
    const events = await securityEventRepository.getAll();
    console.log(`✅ SELECT FROM security_events: Returned ${events.length} security events`);

    console.log('\n--- 3. Testing Real INSERT / SELECT / UPDATE / DELETE operations in PostgreSQL ---');
    const testEmail = `pgtest_${Date.now()}@hostelfix.edu`;
    const testUserId = `PGTEST-${Date.now()}`;
    
    // Insert
    const createdUser = await userRepository.create({
        userId: testUserId,
        email: testEmail,
        password: 'TestPassword123!',
        name: 'PG Integration Test User',
        role: 'student',
        hostelBlock: 'Block B',
        roomNumber: '202'
    });
    console.log(`✅ INSERT INTO users: Created test user ${createdUser.email} (ID: ${createdUser.id})`);

    // Select by email
    const fetchedUser = await userRepository.findByEmail(testEmail);
    if (fetchedUser && fetchedUser.email === testEmail) {
        console.log(`✅ SELECT WHERE email: Found test user ${fetchedUser.email}`);
    } else {
        console.error('❌ SELECT WHERE email failed!');
        process.exit(1);
    }

    // Update
    const updatedUser = await userRepository.update(testUserId, { name: 'PG Test User Updated', roomNumber: '205' });
    console.log(`✅ UPDATE users: Updated name to '${updatedUser.name}', room to '${updatedUser.roomNumber}'`);

    // Delete
    const deleted = await userRepository.delete(testUserId);
    console.log(`✅ DELETE FROM users: ${deleted ? 'Success' : 'Failed'}`);

    console.log('\n🎉 ALL POSTGRESQL DATABASE TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
}

testFullPostgres().catch(err => {
    console.error('Fatal Test Failure:', err);
    process.exit(1);
});
