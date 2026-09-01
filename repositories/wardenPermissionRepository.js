const { getSupabaseClient } = require('./supabaseClient');

const WARDEN_PERMISSION_CATALOG = [
    { id: 'view_students', label: 'View Students', group: 'Students', description: 'View student directory and profiles in assigned scope' },
    { id: 'manage_students', label: 'Manage Students', group: 'Students', description: 'Add, edit, and update student room assignments' },
    { id: 'view_complaints', label: 'View Complaints', group: 'Complaints', description: 'View maintenance issues reported by students in scope' },
    { id: 'manage_complaints', label: 'Manage Complaints', group: 'Complaints', description: 'Assign technicians and update complaint progress/resolution' },
    { id: 'view_gatepasses', label: 'View Gate Passes', group: 'Gate Passes', description: 'Review student outing, transit, and leave requests' },
    { id: 'approve_gatepasses', label: 'Approve Gate Passes', group: 'Gate Passes', description: 'Approve or reject gate passes and verify hostel return QR codes' },
    { id: 'view_laundry', label: 'View Laundry', group: 'Laundry', description: 'View washing machine requests and status' },
    { id: 'manage_laundry', label: 'Manage Laundry', group: 'Laundry', description: 'Update laundry slot bookings and batch completions' },
    { id: 'view_announcements', label: 'View Announcements', group: 'Announcements', description: 'Read official campus notices and notices feed' },
    { id: 'create_announcements', label: 'Create Announcements', group: 'Announcements', description: 'Publish hostel block broadcast announcements to students' },
    { id: 'view_inventory', label: 'View Inventory', group: 'Inventory', description: 'View maintenance spare parts, tools, and stock status' },
    { id: 'manage_inventory', label: 'Manage Inventory', group: 'Inventory', description: 'Request restocks and log parts consumption' },
    { id: 'view_alerts', label: 'View Security Alerts', group: 'Security', description: 'View late return, night curfew, and safety alerts' },
    { id: 'view_cctv', label: 'View CCTV Surveillance', group: 'Security', description: 'Access live camera monitoring feeds and AI detection logs' },
    { id: 'receive_security_alerts', label: 'Receive Emergency Alerts', group: 'Security', description: 'Receive instant Telegram and in-app emergency broadcast notifications' }
];

const DEFAULT_WARDEN_PERMISSIONS = WARDEN_PERMISSION_CATALOG.map(p => p.id);

const permissionCache = new Map();

class WardenPermissionRepository {
    constructor() {
        this.tableName = 'warden_permissions';
    }

    getCatalog() {
        return WARDEN_PERMISSION_CATALOG;
    }

    async getPermissions(wardenId) {
        const client = getSupabaseClient();
        if (!client || !wardenId) {
            return permissionCache.get(wardenId) || DEFAULT_WARDEN_PERMISSIONS;
        }

        try {
            const { data, error } = await client
                .from(this.tableName)
                .select('permissions')
                .eq('warden_id', String(wardenId).trim())
                .maybeSingle();

            if (error || !data) {
                return permissionCache.get(wardenId) || DEFAULT_WARDEN_PERMISSIONS;
            }

            const perms = Array.isArray(data.permissions) ? data.permissions : DEFAULT_WARDEN_PERMISSIONS;
            permissionCache.set(wardenId, perms);
            return perms;
        } catch (err) {
            return permissionCache.get(wardenId) || DEFAULT_WARDEN_PERMISSIONS;
        }
    }

    async setPermissions(wardenId, permissionsArray) {
        const client = getSupabaseClient();
        const perms = Array.isArray(permissionsArray) ? permissionsArray : DEFAULT_WARDEN_PERMISSIONS;
        const cleanWardenId = String(wardenId).trim();

        permissionCache.set(cleanWardenId, perms);

        if (!client) return perms;

        try {
            const { data: existing } = await client
                .from(this.tableName)
                .select('id')
                .eq('warden_id', cleanWardenId)
                .maybeSingle();

            if (existing) {
                const { error } = await client
                    .from(this.tableName)
                    .update({ permissions: perms, updated_at: new Date().toISOString() })
                    .eq('id', existing.id);
                if (error) throw error;
            } else {
                const { error } = await client
                    .from(this.tableName)
                    .insert([{ warden_id: cleanWardenId, permissions: perms }]);
                if (error) throw error;
            }
            return perms;
        } catch (err) {
            console.warn('[WardenPermissionRepository] Supabase save fallback to cache:', err.message);
            return perms;
        }
    }

    async hasPermission(wardenId, permissionName) {
        const perms = await this.getPermissions(wardenId);
        return perms.includes(permissionName);
    }
}

module.exports = new WardenPermissionRepository();
module.exports.DEFAULT_WARDEN_PERMISSIONS = DEFAULT_WARDEN_PERMISSIONS;
module.exports.WARDEN_PERMISSION_CATALOG = WARDEN_PERMISSION_CATALOG;
