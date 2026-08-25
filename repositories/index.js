const { getSupabaseClient, isSupabaseHealthy } = require('./supabaseClient');
const userRepository = require('./userRepository');
const complaintRepository = require('./complaintRepository');
const gatePassRepository = require('./gatePassRepository');
const laundryRepository = require('./laundryRepository');
const announcementRepository = require('./announcementRepository');
const inventoryRepository = require('./inventoryRepository');
const securityEventRepository = require('./securityEventRepository');

module.exports = {
    getSupabaseClient,
    isSupabaseHealthy,
    userRepository,
    complaintRepository,
    gatePassRepository,
    laundryRepository,
    announcementRepository,
    inventoryRepository,
    securityEventRepository
};
