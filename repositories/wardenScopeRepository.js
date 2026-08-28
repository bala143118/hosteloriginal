const { getSupabaseClient } = require('./supabaseClient');

// In-memory fallback cache for scopes if table migration is pending in Supabase
const scopeCache = new Map();

class WardenScopeRepository {
    constructor() {
        this.tableName = 'warden_scopes';
    }

    async getScopeForWarden(wardenId) {
        const client = getSupabaseClient();
        if (!client || !wardenId) {
            return scopeCache.get(wardenId) || this._defaultScope(wardenId);
        }

        try {
            const { data, error } = await client
                .from(this.tableName)
                .select('*')
                .eq('warden_id', String(wardenId).trim())
                .eq('is_active', true)
                .maybeSingle();

            if (error) {
                // If table doesn't exist yet or query fails, check in-memory cache
                return scopeCache.get(wardenId) || this._defaultScope(wardenId);
            }

            if (data) {
                const mapped = this._mapScope(data);
                scopeCache.set(wardenId, mapped);
                return mapped;
            }

            return scopeCache.get(wardenId) || this._defaultScope(wardenId);
        } catch (err) {
            return scopeCache.get(wardenId) || this._defaultScope(wardenId);
        }
    }

    async saveWardenScope(wardenId, scopeData) {
        const client = getSupabaseClient();
        const payload = {
            warden_id: String(wardenId).trim(),
            hostel: scopeData.hostel || 'All',
            block: scopeData.block || 'All',
            floors: scopeData.floors || 'All',
            rooms: scopeData.rooms || 'All',
            is_active: scopeData.isActive !== false
        };
        const mappedLocal = {
            id: `SCOPE-${wardenId}`,
            wardenId: String(wardenId).trim(),
            hostel: payload.hostel,
            block: payload.block,
            floors: payload.floors,
            rooms: payload.rooms,
            isActive: payload.is_active,
            is_active: payload.is_active,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        scopeCache.set(wardenId, mappedLocal);

        if (!client) return mappedLocal;

        try {
            // Check if scope already exists
            const { data: existing } = await client
                .from(this.tableName)
                .select('id')
                .eq('warden_id', String(wardenId).trim())
                .maybeSingle();

            if (existing) {
                const { data, error } = await client
                    .from(this.tableName)
                    .update({
                        hostel: payload.hostel,
                        block: payload.block,
                        floors: payload.floors,
                        rooms: payload.rooms,
                        is_active: payload.is_active,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existing.id)
                    .select()
                    .single();

                if (error) throw error;
                const mapped = this._mapScope(data);
                scopeCache.set(wardenId, mapped);
                return mapped;
            } else {
                const { data, error } = await client
                    .from(this.tableName)
                    .insert([payload])
                    .select()
                    .single();

                if (error) throw error;
                const mapped = this._mapScope(data);
                scopeCache.set(wardenId, mapped);
                return mapped;
            }
        } catch (err) {
            console.warn('[WardenScopeRepository] Supabase save fallback to cache:', err.message);
            return scopeCache.get(wardenId);
        }
    }

    async getAllScopes() {
        const client = getSupabaseClient();
        if (!client) return Array.from(scopeCache.values());

        try {
            const { data, error } = await client.from(this.tableName).select('*');
            if (error) throw error;
            return data.map(this._mapScope);
        } catch (err) {
            return Array.from(scopeCache.values());
        }
    }

    _defaultScope(wardenId) {
        return {
            id: `SCOPE-DEF-${wardenId}`,
            wardenId: wardenId,
            hostel: 'All',
            block: 'All',
            floors: 'All',
            rooms: 'All',
            isActive: true,
            createdAt: new Date().toISOString()
        };
    }

    _mapScope(row) {
        if (!row) return null;
        return {
            id: row.id,
            wardenId: row.warden_id,
            hostel: row.hostel,
            block: row.block,
            floors: row.floors,
            rooms: row.rooms,
            isActive: row.is_active,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

module.exports = new WardenScopeRepository();
