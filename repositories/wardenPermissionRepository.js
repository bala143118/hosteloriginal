const { getSupabaseClient } = require('./supabaseClient');

const DEFAULT_WARDEN_PERMISSIONS = [
    'view_students',
    'manage_students',
    'view_gatepasses',
    'approve_gatepasses',
    'view_complaints',
    'manage_complaints',
    'view_laundry',
    'manage_laundry',
    'view_announcements',
    'create_announcements',
    'view_inventory',
    'manage_inventory',
    'view_alerts',
    'view_cctv',
    'receive_security_alerts'
];

const permissionCache = new Map();

class WardenPermissionRepository {
    constructor() {
        this.tableName = 'warden_permissions';
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
