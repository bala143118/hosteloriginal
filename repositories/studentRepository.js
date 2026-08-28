const { getSupabaseClient } = require('./supabaseClient');
const { filterStudentsForScope } = require('../services/scopeService');

class StudentRepository {
    constructor() {
        this.tableName = 'users';
    }

    async getAll() {
        const client = getSupabaseClient();
        if (!client) return [];

        const { data, error } = await client
            .from(this.tableName)
            .select('*')
            .eq('role', 'student')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data.map(this._mapStudent);
    }

    async getByScope(scope) {
        const allStudents = await this.getAll();
        return filterStudentsForScope(allStudents, scope);
    }

    async findById(id) {
        const client = getSupabaseClient();
        if (!client || !id) return null;

        const cleanId = String(id).trim();
        let query = client.from(this.tableName).select('*').eq('role', 'student');

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
        return data ? this._mapStudent(data) : null;
    }

    async findByEmail(email) {
        const client = getSupabaseClient();
        if (!client || !email) return null;

        const { data, error } = await client
            .from(this.tableName)
            .select('*')
            .eq('role', 'student')
            .ilike('email', String(email).trim())
            .maybeSingle();

        if (error) throw error;
        return data ? this._mapStudent(data) : null;
    }

    async create(studentData) {
        const client = getSupabaseClient();
        if (!client) return null;

        const userId = studentData.userId || `STU-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
        const email = String(studentData.email || '').trim().toLowerCase();

        const dbPayload = {
            user_id: userId,
            email: email,
            password: studentData.password || 'student123',
            name: studentData.name,
            role: 'student',
            room_number: studentData.roomNumber || studentData.room || '101',
            block: studentData.hostelBlock || studentData.block || 'Block A',
            registration_number: studentData.registrationNumber || studentData.regNo || '',
            phone: studentData.phone || '',
            specialization: studentData.department || studentData.specialization || ''
        };

        const { data, error } = await client
            .from(this.tableName)
            .insert([dbPayload])
            .select()
            .single();

        if (error) throw error;
        return this._mapStudent(data);
    }

    async update(id, updates) {
        const client = getSupabaseClient();
        if (!client || !id) return null;

        const student = await this.findById(id);
        if (!student) return null;

        const dbPayload = {};
        if (updates.name !== undefined) dbPayload.name = updates.name.trim();
        if (updates.email !== undefined) dbPayload.email = updates.email.trim().toLowerCase();
        if (updates.password !== undefined) dbPayload.password = updates.password;
        if (updates.phone !== undefined) dbPayload.phone = updates.phone.trim();
        if (updates.roomNumber !== undefined || updates.room !== undefined) {
            dbPayload.room_number = updates.roomNumber || updates.room;
        }
        if (updates.hostelBlock !== undefined || updates.block !== undefined) {
            dbPayload.block = updates.hostelBlock || updates.block;
        }
        if (updates.registrationNumber !== undefined || updates.regNo !== undefined) {
            dbPayload.registration_number = updates.registrationNumber || updates.regNo;
        }
        if (updates.department !== undefined || updates.specialization !== undefined) {
            dbPayload.specialization = updates.department || updates.specialization;
        }

        const { data, error } = await client
            .from(this.tableName)
            .update(dbPayload)
            .eq('user_id', student.userId)
            .select()
            .single();

        if (error) throw error;
        return this._mapStudent(data);
    }

    async delete(id) {
        const client = getSupabaseClient();
        if (!client || !id) return false;

        const student = await this.findById(id);
        if (!student) return false;

        const { error } = await client
            .from(this.tableName)
            .delete()
            .eq('user_id', student.userId);

        if (error) throw error;
        return true;
    }

    _mapStudent(row) {
        if (!row) return null;
        return {
            id: row.user_id,
            userId: row.user_id,
            email: row.email,
            password: row.password,
            name: row.name,
            role: 'student',
            roomNumber: row.room_number,
            room: row.room_number,
            block: row.block,
            hostelBlock: row.block,
            registrationNumber: row.registration_number,
            regNo: row.registration_number,
            phone: row.phone,
            department: row.specialization,
            specialization: row.specialization,
            status: row.status || 'Active',
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

module.exports = new StudentRepository();
