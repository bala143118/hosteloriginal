const { getSupabaseClient } = require('./supabaseClient');

class UserRepository {
    constructor() {
        this.tableName = 'users';
    }

    async getAll() {
        const client = getSupabaseClient();
        if (!client) return null;
        const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return data.map(this._mapUser);
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
        const { data, error } = await client
            .from(this.tableName)
            .select('*')
            .eq('user_id', userId.trim())
            .maybeSingle();
        if (error) throw error;
        return data ? this._mapUser(data) : null;
    }

    async create(userData) {
        const client = getSupabaseClient();
        if (!client) return null;
        const dbPayload = {
            user_id: userData.userId || userData.id,
            email: userData.email,
            password: userData.password,
            name: userData.name,
            role: userData.role,
            room_number: userData.roomNumber || userData.room || '',
            block: userData.block || '',
            registration_number: userData.registrationNumber || '',
            phone: userData.phone || '',
            specialization: userData.specialization || ''
        };
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
        if (!client) return null;
        const dbPayload = {};
        if (updates.name !== undefined) dbPayload.name = updates.name;
        if (updates.email !== undefined) dbPayload.email = updates.email;
        if (updates.password !== undefined) dbPayload.password = updates.password;
        if (updates.phone !== undefined) dbPayload.phone = updates.phone;
        if (updates.roomNumber !== undefined) dbPayload.room_number = updates.roomNumber;
        if (updates.block !== undefined) dbPayload.block = updates.block;
        if (updates.specialization !== undefined) dbPayload.specialization = updates.specialization;

        const { data, error } = await client
            .from(this.tableName)
            .update(dbPayload)
            .eq('user_id', userId)
            .select()
            .single();
        if (error) throw error;
        return this._mapUser(data);
    }

    _mapUser(row) {
        if (!row) return null;
        return {
            id: row.user_id,
            userId: row.user_id,
            email: row.email,
            password: row.password,
            name: row.name,
            role: row.role,
            roomNumber: row.room_number,
            block: row.block,
            registrationNumber: row.registration_number,
            phone: row.phone,
            specialization: row.specialization,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

module.exports = new UserRepository();
