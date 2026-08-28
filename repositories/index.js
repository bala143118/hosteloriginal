const { getSupabaseClient, isSupabaseHealthy } = require('./supabaseClient');
const userRepository = require('./userRepository');
const studentRepository = require('./studentRepository');
const wardenRepository = require('./wardenRepository');
const wardenScopeRepository = require('./wardenScopeRepository');
const wardenPermissionRepository = require('./wardenPermissionRepository');
const complaintRepository = require('./complaintRepository');
const gatePassRepository = require('./gatePassRepository');
const laundryRepository = require('./laundryRepository');
const announcementRepository = require('./announcementRepository');
const inventoryRepository = require('./inventoryRepository');
const notificationRepository = require('./notificationRepository');
const securityEventRepository = require('./securityEventRepository');

module.exports = {
    getSupabaseClient,
    isSupabaseHealthy,
    userRepository,
    studentRepository,
    wardenRepository,
    wardenScopeRepository,
    wardenPermissionRepository,
    complaintRepository,
    gatePassRepository,
    laundryRepository,
    announcementRepository,
    inventoryRepository,
    notificationRepository,
    securityEventRepository
};
