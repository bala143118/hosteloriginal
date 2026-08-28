const { getSupabaseClient } = require('./supabaseClient');
const wardenScopeRepository = require('./wardenScopeRepository');
const wardenPermissionRepository = require('./wardenPermissionRepository');

class WardenRepository {
    constructor() {
        this.tableName = 'users';
    }

    async getAllWardens() {
        const client = getSupabaseClient();
        if (!client) return [];

        const { data, error } = await client
            .from(this.tableName)
            .select('*')
            .eq('role', 'warden')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const wardens = await Promise.all(
            data.map(async (row) => {
                const warden = this._mapWarden(row);
                warden.scope = await wardenScopeRepository.getScopeForWarden(warden.userId || warden.email);
                warden.permissions = await wardenPermissionRepository.getPermissions(warden.userId || warden.email);
                return warden;
            })
        );

        return wardens;
    }

    async getWardenById(id) {
        const client = getSupabaseClient();
        if (!client || !id) return null;

        const cleanId = String(id).trim();
        let query = client.from(this.tableName).select('*').eq('role', 'warden');

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
        if (cleanId.includes('@')) {
            query = query.ilike('email', cleanId);
        } else if (isUuid) {
            query = query.or(`user_id.eq.${cleanId},id.eq.${cleanId}`);
        } else {
            query = query.eq('user_id', cleanId);
        }

        const { data, error } = await query.maybeSingle();
        if (error) throw error;
        if (!data) return null;

        const warden = this._mapWarden(data);
        warden.scope = await wardenScopeRepository.getScopeForWarden(warden.userId || warden.email);
        warden.permissions = await wardenPermissionRepository.getPermissions(warden.userId || warden.email);
        return warden;
    }

    async createWarden(wardenData) {
        const client = getSupabaseClient();
        if (!client) return null;

        const userId = wardenData.userId || `W-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
        const email = String(wardenData.email || '').trim().toLowerCase();

        const dbPayload = {
            user_id: userId,
            email: email,
            password: wardenData.password,
            name: wardenData.name,
            role: 'warden',
            room_number: wardenData.roomNumber || '',
            block: wardenData.hostelBlock || wardenData.block || 'Block A',
            phone: wardenData.phone || '',
            specialization: wardenData.specialization || ''
        };

        const { data, error } = await client
            .from(this.tableName)
            .insert([dbPayload])
            .select()
            .single();

        if (error) throw error;

        const warden = this._mapWarden(data);

        // Create Scope
        const scopePayload = {
            hostel: wardenData.hostel || 'All',
            block: wardenData.hostelBlock || wardenData.block || 'Block A',
            floors: wardenData.floors || 'All',
            rooms: wardenData.rooms || 'All',
            isActive: wardenData.status !== 'Inactive'
        };
        warden.scope = await wardenScopeRepository.saveWardenScope(userId, scopePayload);

        // Create Permissions
        const perms = wardenData.permissions || wardenPermissionRepository.DEFAULT_WARDEN_PERMISSIONS;
        warden.permissions = await wardenPermissionRepository.setPermissions(userId, perms);

        return warden;
    }

    async updateWarden(id, updates) {
        const client = getSupabaseClient();
        if (!client || !id) return null;

        const warden = await this.getWardenById(id);
        if (!warden) return null;

        const dbPayload = {};
        if (updates.name !== undefined) dbPayload.name = updates.name.trim();
        if (updates.email !== undefined) dbPayload.email = updates.email.trim().toLowerCase();
        if (updates.password !== undefined) dbPayload.password = updates.password;
        if (updates.phone !== undefined) dbPayload.phone = updates.phone.trim();
        if (updates.hostelBlock !== undefined || updates.block !== undefined) {
            dbPayload.block = updates.hostelBlock || updates.block;
        }
        if (updates.specialization !== undefined) dbPayload.specialization = updates.specialization;

        if (Object.keys(dbPayload).length > 0) {
            const { error } = await client
                .from(this.tableName)
                .update(dbPayload)
                .eq('user_id', warden.userId);
            if (error) throw error;
        }

        // Update Scope if provided
        if (updates.scope || updates.hostel || updates.floors || updates.rooms || updates.hostelBlock || updates.block) {
            const currentScope = warden.scope || {};
            const scopeUpdates = {
                hostel: updates.hostel || updates.scope?.hostel || currentScope.hostel || 'All',
                block: updates.hostelBlock || updates.block || updates.scope?.block || currentScope.block || 'Block A',
                floors: updates.floors || updates.scope?.floors || currentScope.floors || 'All',
                rooms: updates.rooms || updates.scope?.rooms || currentScope.rooms || 'All',
                isActive: updates.status ? updates.status !== 'Inactive' : (updates.scope?.isActive !== false)
            };
            warden.scope = await wardenScopeRepository.saveWardenScope(warden.userId, scopeUpdates);
        }

        // Update Permissions if provided
        if (updates.permissions && Array.isArray(updates.permissions)) {
            warden.permissions = await wardenPermissionRepository.setPermissions(warden.userId, updates.permissions);
        }

        return await this.getWardenById(warden.userId);
    }

    async deleteWarden(id) {
        const client = getSupabaseClient();
        if (!client || !id) return false;

        const warden = await this.getWardenById(id);
        if (!warden) return false;

        const { error } = await client
            .from(this.tableName)
            .delete()
            .eq('user_id', warden.userId);

        if (error) throw error;
        return true;
    }

    _mapWarden(row) {
        if (!row) return null;
        return {
            id: row.user_id,
            userId: row.user_id,
            email: row.email,
            password: row.password,
            name: row.name,
            role: 'warden',
            hostelBlock: row.block || 'Block A',
            block: row.block || 'Block A',
            phone: row.phone || '',
            roomNumber: row.room_number || '',
            status: row.status || 'Active',
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

module.exports = new WardenRepository();
