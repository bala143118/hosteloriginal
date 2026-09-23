const { getSupabaseClient } = require('./supabaseClient');
const db = require('../db');

const scopeCache = new Map();

class WardenScopeRepository {
    constructor() {
        this.tableName = 'warden_scopes';
    }

    async getScopeForWarden(wardenId) {
        if (!wardenId) return this._defaultScope('default');
        const cleanId = String(wardenId).trim();

        try {
            const res = await db.query(
                `SELECT * FROM warden_scopes WHERE LOWER("wardenId") = LOWER($1) ORDER BY id DESC LIMIT 1`,
                [cleanId]
            );
            if (res.rows && res.rows.length > 0) {
                const mapped = this._mapScope(res.rows[0]);
                scopeCache.set(cleanId, mapped);
                return mapped;
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) {
            return scopeCache.get(cleanId) || this._defaultScope(cleanId);
        }

        try {
            const { data, error } = await client
                .from(this.tableName)
                .select('*')
                .eq('warden_id', cleanId)
                .eq('is_active', true)
                .maybeSingle();

            if (!error && data) {
                const mapped = this._mapScope(data);
                scopeCache.set(cleanId, mapped);
                return mapped;
            }

            return scopeCache.get(cleanId) || this._defaultScope(cleanId);
        } catch (err) {
            return scopeCache.get(cleanId) || this._defaultScope(cleanId);
        }
    }

    async saveWardenScope(wardenId, scopeData) {
        const cleanId = String(wardenId).trim();
        const hostelBlock = scopeData.block || scopeData.hostelBlock || 'All';
        const hostel = scopeData.hostel || 'Main Hostel';
        const floors = scopeData.floors || 'All';
        const rooms = scopeData.rooms || 'All';
        const isActive = scopeData.isActive !== false;

        const mappedLocal = {
            id: `SCOPE-${cleanId}`,
            wardenId: cleanId,
            hostel: hostel,
            block: hostelBlock,
            hostelBlock: hostelBlock,
            floors: floors,
            rooms: rooms,
            isActive: isActive,
            createdAt: new Date().toISOString()
        };

        scopeCache.set(cleanId, mappedLocal);

        try {
            await db.query(
                `INSERT INTO warden_scopes ("wardenId", "hostelBlock", "assignedAt")
                 VALUES ($1, $2, NOW())`,
                [cleanId, hostelBlock]
            );
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return mappedLocal;

        try {
            const payload = {
                warden_id: cleanId,
                hostel: hostel,
                block: hostelBlock,
                floors: floors,
                rooms: rooms,
                is_active: isActive
            };
            const { data: existing } = await client
                .from(this.tableName)
                .select('id')
                .eq('warden_id', cleanId)
                .maybeSingle();

            if (existing) {
                const { data } = await client.from(this.tableName).update(payload).eq('id', existing.id).select().single();
                if (data) return this._mapScope(data);
            } else {
                const { data } = await client.from(this.tableName).insert([payload]).select().single();
                if (data) return this._mapScope(data);
            }
        } catch (err) {}

        return mappedLocal;
    }

    async getAllScopes() {
        try {
            const res = await db.query('SELECT * FROM warden_scopes');
            if (res.rows && res.rows.length > 0) {
                return res.rows.map(r => this._mapScope(r));
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return Array.from(scopeCache.values());

        try {
            const { data, error } = await client.from(this.tableName).select('*');
            if (error) return Array.from(scopeCache.values());
            return data.map(r => this._mapScope(r));
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
            hostelBlock: 'All',
            floors: 'All',
            rooms: 'All',
            isActive: true,
            createdAt: new Date().toISOString()
        };
    }

    _mapScope(row) {
        if (!row) return null;
        const wardenIdVal = row.wardenId || row.warden_id || '';
        const blockVal = row.hostelBlock || row.block || 'All';
        return {
            id: row.id,
            wardenId: wardenIdVal,
            hostel: row.hostel || 'Main Hostel',
            block: blockVal,
            hostelBlock: blockVal,
            floors: row.floors || 'All',
            rooms: row.rooms || 'All',
            isActive: row.isActive !== undefined ? row.isActive : (row.is_active !== undefined ? row.is_active : true),
            createdAt: row.assignedAt || row.created_at || new Date().toISOString()
        };
    }
}

module.exports = new WardenScopeRepository();
