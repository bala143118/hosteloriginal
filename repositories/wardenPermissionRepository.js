const { getSupabaseClient } = require('./supabaseClient');
const db = require('../db');

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
        if (!wardenId) return DEFAULT_WARDEN_PERMISSIONS;
        const cleanId = String(wardenId).trim();

        try {
            const res = await db.query(
                `SELECT * FROM warden_permissions WHERE LOWER("wardenId") = LOWER($1) ORDER BY "updatedAt" DESC LIMIT 1`,
                [cleanId]
            );
            if (res.rows && res.rows.length > 0) {
                const row = res.rows[0];
                const perms = [];
                if (row.canApproveComplaints) perms.push('view_complaints', 'manage_complaints');
                if (row.canIssuePasses) perms.push('view_gatepasses', 'approve_gatepasses');
                if (row.canManageInventory) perms.push('view_inventory', 'manage_inventory');
                if (row.canManageStudents) perms.push('view_students', 'manage_students');
                permissionCache.set(cleanId, perms);
                return perms;
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) {
            return permissionCache.get(cleanId) || DEFAULT_WARDEN_PERMISSIONS;
        }

        try {
            const { data, error } = await client
                .from(this.tableName)
                .select('permissions')
                .eq('warden_id', cleanId)
                .maybeSingle();

            if (error || !data) {
                return permissionCache.get(cleanId) || DEFAULT_WARDEN_PERMISSIONS;
            }

            const perms = Array.isArray(data.permissions) ? data.permissions : DEFAULT_WARDEN_PERMISSIONS;
            permissionCache.set(cleanId, perms);
            return perms;
        } catch (err) {
            return permissionCache.get(cleanId) || DEFAULT_WARDEN_PERMISSIONS;
        }
    }

    async setPermissions(wardenId, permissionsArray) {
        const perms = Array.isArray(permissionsArray) ? permissionsArray : DEFAULT_WARDEN_PERMISSIONS;
        const cleanWardenId = String(wardenId).trim();

        permissionCache.set(cleanWardenId, perms);

        try {
            await db.query(
                `INSERT INTO warden_permissions ("wardenId", "canApproveComplaints", "canIssuePasses", "canManageInventory", "canManageStudents", "updatedAt")
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT ("wardenId") DO UPDATE SET
                    "canApproveComplaints" = EXCLUDED."canApproveComplaints",
                    "canIssuePasses" = EXCLUDED."canIssuePasses",
                    "canManageInventory" = EXCLUDED."canManageInventory",
                    "canManageStudents" = EXCLUDED."canManageStudents",
                    "updatedAt" = NOW()`,
                [
                    cleanWardenId,
                    perms.includes('manage_complaints') || perms.includes('view_complaints'),
                    perms.includes('approve_gatepasses') || perms.includes('view_gatepasses'),
                    perms.includes('manage_inventory') || perms.includes('view_inventory'),
                    perms.includes('manage_students') || perms.includes('view_students')
                ]
            );
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return perms;

        try {
            const { data: existing } = await client
                .from(this.tableName)
                .select('id')
                .eq('warden_id', cleanWardenId)
                .maybeSingle();

            if (existing) {
                await client.from(this.tableName).update({ permissions: perms, updated_at: new Date().toISOString() }).eq('id', existing.id);
            } else {
                await client.from(this.tableName).insert([{ warden_id: cleanWardenId, permissions: perms }]);
            }
            return perms;
        } catch (err) {
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
