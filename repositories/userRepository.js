const crypto = require('crypto');
const { getSupabaseClient } = require('./supabaseClient');

const userStatusCache = new Map();

function hashPassword(password) {
    if (!password) return '';
    if (/^[0-9a-f]{64}$/i.test(password) || password.startsWith('$2')) {
        return password;
    }
    return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(plainPassword, storedPassword) {
    if (!plainPassword || !storedPassword) return false;
    if (plainPassword === storedPassword) return true;
    const hashed = hashPassword(plainPassword);
    return hashed === storedPassword;
}

class UserRepository {
    constructor() {
        this.tableName = 'users';
    }

    async getAll() {
        const client = getSupabaseClient();
        if (!client) return [];
        const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map((u) => this._mapUser(u));
    }

    async getByRole(role) {
        const client = getSupabaseClient();
        if (!client || !role) return [];
        const { data, error } = await client
            .from(this.tableName)
            .select('*')
            .eq('role', role.trim().toLowerCase())
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map((u) => this._mapUser(u));
    }

    async findByEmail(email) {
        const client = getSupabaseClient();
        if (!client || !email) return null;
        const { data, error } = await client
            .from(this.tableName)
            .select('*')
            .ilike('email', email.trim())
            .maybeSingle();
        if (error) throw error;
        return data ? this._mapUser(data) : null;
    }

    async findByUserId(userId) {
        const client = getSupabaseClient();
        if (!client || !userId) return null;
        const cleanId = String(userId).trim();
        let { data, error } = await client
            .from(this.tableName)
            .select('*')
            .eq('user_id', cleanId)
            .maybeSingle();
        // Login identifiers are case-insensitive, including generated WRD-/STU- IDs.
        if (!data && !error) {
            const fallback = await client
                .from(this.tableName)
                .select('*')
                .ilike('user_id', cleanId)
                .maybeSingle();
            data = fallback.data;
            error = fallback.error;
        }
        if (error) throw error;
        return data ? this._mapUser(data) : null;
    }

    async findUserByIdentifier(identifier) {
        if (!identifier) return null;
        const clean = String(identifier).trim();
        if (clean.includes('@')) {
            return await this.findByEmail(clean);
        }
        const byId = await this.findByUserId(clean);
        if (byId) return byId;
        return await this.findByEmail(clean);
    }

    async create(userData) {
        const client = getSupabaseClient();
        if (!client) return null;
        const userId = userData.technicianId || userData.userId || userData.id || `TECH-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
        const status = userData.status || 'Active';

        userStatusCache.set(String(userId).trim(), status);
        if (userData.email) {
            userStatusCache.set(String(userData.email).trim().toLowerCase(), status);
        }

        const dbPayload = {
            user_id: String(userId).trim(),
            email: String(userData.email).trim().toLowerCase(),
            password: userData.password,
            name: String(userData.name || '').trim(),
            role: String(userData.role || 'technician').trim().toLowerCase(),
            room_number: userData.roomNumber || userData.room || '',
            block: userData.block || userData.hostelBlock || '',
            registration_number: userData.registrationNumber || userData.regNo || '',
            phone: String(userData.phone || '').trim(),
            specialization: userData.specialization || userData.department || 'General Maintenance'
        };

        try {
            const { data, error } = await client
                .from(this.tableName)
                .insert([{ ...dbPayload, status }])
                .select()
                .single();
            if (!error && data) return this._mapUser(data);
        } catch (e) {}

        // Fallback without status column if schema doesn't have status
        const { data, error } = await client
            .from(this.tableName)
            .insert([dbPayload])
            .select()
            .single();
        if (error) throw error;
        return this._mapUser(data);
    }

    async update(userId, updates) {
        const client = getSupabaseClient();
        if (!client || !userId) return null;
        const cleanId = String(userId).trim();

        if (updates.status !== undefined) {
            userStatusCache.set(cleanId, updates.status);
            if (updates.email) userStatusCache.set(String(updates.email).trim().toLowerCase(), updates.status);
        }

        const dbPayload = {};
        if (updates.name !== undefined) dbPayload.name = String(updates.name).trim();
        if (updates.email !== undefined) dbPayload.email = String(updates.email).trim().toLowerCase();
        if (updates.password !== undefined && updates.password) dbPayload.password = updates.password;
        if (updates.phone !== undefined) dbPayload.phone = String(updates.phone).trim();
        if (updates.roomNumber !== undefined || updates.room !== undefined) {
            dbPayload.room_number = updates.roomNumber || updates.room;
        }
        if (updates.block !== undefined || updates.hostelBlock !== undefined) {
            dbPayload.block = updates.block || updates.hostelBlock;
        }
        if (updates.registrationNumber !== undefined || updates.regNo !== undefined) {
            dbPayload.registration_number = updates.registrationNumber || updates.regNo;
        }
        if (updates.specialization !== undefined) {
            dbPayload.specialization = updates.specialization;
        }
        if (updates.department !== undefined && !dbPayload.specialization) {
            dbPayload.specialization = updates.department;
        }

        // If only status was updated, return current record with new status
        if (Object.keys(dbPayload).length === 0) {
            const current = await this.findUserByIdentifier(cleanId);
            if (!current) return null;
            return { ...current, status: updates.status || current.status };
        }

        let { data, error } = await client
            .from(this.tableName)
            .update(dbPayload)
            .eq('user_id', cleanId)
            .select()
            .maybeSingle();

        if (!data) {
            const { data: byEmail, error: err2 } = await client
                .from(this.tableName)
                .update(dbPayload)
                .ilike('email', cleanId)
                .select()
                .maybeSingle();
            if (err2) throw err2;
            data = byEmail;
        }

        if (error && !data) throw error;
        return data ? this._mapUser(data) : null;
    }

    setStatus(idOrEmail, status) {
        if (!idOrEmail) return;
        userStatusCache.set(String(idOrEmail).trim(), status);
    }

    deleteStatus(idOrEmail) {
        if (!idOrEmail) return;
        userStatusCache.delete(String(idOrEmail).trim());
    }

    async updateStatus(userId, status) {
        this.setStatus(userId, status);
        return this.update(userId, { status });
    }

    async delete(userId) {
        const client = getSupabaseClient();
        if (!client || !userId) return false;
        const cleanId = String(userId).trim();
        
        userStatusCache.delete(cleanId);

        let { error } = await client
            .from(this.tableName)
            .delete()
            .eq('user_id', cleanId);

        if (error) {
            const { error: emailErr } = await client
                .from(this.tableName)
                .delete()
                .ilike('email', cleanId);
            if (emailErr) throw error;
        }
        return true;
    }

    _mapUser(row) {
        if (!row) return null;
        const cachedStatus = userStatusCache.get(row.user_id) || userStatusCache.get(row.email);
        const isTech = String(row.role || '').toLowerCase() === 'technician';
        
        let meta = {};
        try {
            if (row.specialization && row.specialization.startsWith('{')) {
                meta = JSON.parse(row.specialization);
            }
        } catch (e) {}

        const mustChangePassword = Boolean(
            meta.must_change_password === true ||
            meta.mustChangePassword === true ||
            row.must_change_password === true
        );

        return {
            id: row.user_id,
            userId: row.user_id,
            technicianId: row.user_id,
            email: row.email,
            password: row.password,
            name: row.name,
            role: row.role,
            roomNumber: row.room_number,
            room: row.room_number,
            block: row.block,
            hostelBlock: row.block,
            registrationNumber: row.registration_number,
            phone: row.phone,
            specialization: row.specialization || (isTech ? 'General Maintenance' : ''),
            department: row.specialization || (isTech ? 'Maintenance Department' : ''),
            status: row.status || cachedStatus || 'Active',
            authUserId: meta.auth_user_id || row.auth_user_id || '',
            mustChangePassword: mustChangePassword,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

module.exports = new UserRepository();
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
