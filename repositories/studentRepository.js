const { getSupabaseClient } = require('./supabaseClient');
const { filterStudentsForScope } = require('../services/scopeService');
const db = require('../db');

class StudentRepository {
    constructor() {
        this.tableName = 'users';
    }

    async getAll() {
        try {
            const res = await db.query("SELECT * FROM users WHERE LOWER(role) = 'student' ORDER BY created_at DESC");
            if (res.rows && res.rows.length > 0) {
                return res.rows.map(r => this._mapStudent(r));
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return [];

        try {
            const { data, error } = await client
                .from(this.tableName)
                .select('*')
                .eq('role', 'student')
                .order('created_at', { ascending: false });

            if (error) return [];
            return data.map(r => this._mapStudent(r));
        } catch (e) {
            return [];
        }
    }

    async getByScope(scope) {
        const allStudents = await this.getAll();
        return filterStudentsForScope(allStudents, scope);
    }

    async findById(id) {
        if (!id) return null;
        const cleanId = String(id).trim();

        try {
            const res = await db.query(
                `SELECT * FROM users WHERE LOWER(role) = 'student' AND (LOWER("userId") = LOWER($1) OR LOWER(email) = LOWER($1)) LIMIT 1`,
                [cleanId]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapStudent(res.rows[0]);
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return null;

        let query = client.from(this.tableName).select('*').eq('role', 'student');
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
        if (cleanId.includes('@')) {
            query = query.ilike('email', cleanId);
        } else if (isUuid) {
            query = query.or(`user_id.eq.${cleanId},id.eq.${cleanId}`);
        } else {
            query = query.eq('user_id', cleanId);
        }

        try {
            const { data, error } = await query.maybeSingle();
            if (error) return null;
            return data ? this._mapStudent(data) : null;
        } catch (e) {
            return null;
        }
    }

    async findByEmail(email) {
        if (!email) return null;
        const cleanEmail = String(email).trim().toLowerCase();

        try {
            const res = await db.query(
                `SELECT * FROM users WHERE LOWER(role) = 'student' AND LOWER(email) = LOWER($1) LIMIT 1`,
                [cleanEmail]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapStudent(res.rows[0]);
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return null;

        try {
            const { data, error } = await client
                .from(this.tableName)
                .select('*')
                .eq('role', 'student')
                .ilike('email', cleanEmail)
                .maybeSingle();

            if (error) return null;
            return data ? this._mapStudent(data) : null;
        } catch (e) {
            return null;
        }
    }

    async create(studentData) {
        const userId = studentData.userId || `STU-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
        const email = String(studentData.email || '').trim().toLowerCase();
        const roomNumber = studentData.roomNumber || studentData.room || '101';
        const block = studentData.hostelBlock || studentData.block || 'Block A';
        const regNo = studentData.registrationNumber || studentData.regNo || '';
        const phone = studentData.phone || '';
        const dept = studentData.department || studentData.specialization || '';

        try {
            const res = await db.query(
                `INSERT INTO users ("userId", email, password, name, role, status, phone, "hostelBlock", "roomNumber", "registrationNumber")
                 VALUES ($1, $2, $3, $4, 'student', 'Active', $5, $6, $7, $8)
                 ON CONFLICT (email) DO UPDATE SET
                    "userId" = EXCLUDED."userId",
                    name = EXCLUDED.name,
                    "hostelBlock" = EXCLUDED."hostelBlock",
                    "roomNumber" = EXCLUDED."roomNumber",
                    "registrationNumber" = EXCLUDED."registrationNumber"
                 RETURNING *`,
                [userId, email, studentData.password || 'student123', studentData.name || 'Student', phone, block, roomNumber, regNo]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapStudent(res.rows[0]);
            }
        } catch (pgErr) {
            console.error('[StudentRepository PostgreSQL Create Error]', pgErr.message);
        }

        const client = getSupabaseClient();
        if (!client) return null;

        const dbPayload = {
            user_id: userId,
            email: email,
            password: studentData.password || 'student123',
            name: studentData.name,
            role: 'student',
            room_number: roomNumber,
            block: block,
            registration_number: regNo,
            phone: phone,
            specialization: dept
        };

        try {
            const { data, error } = await client
                .from(this.tableName)
                .insert([dbPayload])
                .select()
                .single();

            if (error) return this._mapStudent(dbPayload);
            return this._mapStudent(data);
        } catch (e) {
            return this._mapStudent(dbPayload);
        }
    }

    async update(id, updates) {
        if (!id) return null;
        const student = await this.findById(id);
        if (!student) return null;

        try {
            const res = await db.query(
                `UPDATE users SET
                    name = COALESCE($1, name),
                    email = COALESCE($2, email),
                    password = CASE WHEN $3::text IS NOT NULL AND $3::text != '' THEN $3::text ELSE password END,
                    phone = COALESCE($4, phone),
                    "hostelBlock" = COALESCE($5, "hostelBlock"),
                    "roomNumber" = COALESCE($6, "roomNumber"),
                    "registrationNumber" = COALESCE($7, "registrationNumber"),
                    updated_at = NOW()
                 WHERE LOWER("userId") = LOWER($8) OR LOWER(email) = LOWER($8)
                 RETURNING *`,
                [
                    updates.name ? updates.name.trim() : null,
                    updates.email ? updates.email.trim().toLowerCase() : null,
                    updates.password || null,
                    updates.phone ? updates.phone.trim() : null,
                    updates.hostelBlock || updates.block || null,
                    updates.roomNumber || updates.room || null,
                    updates.registrationNumber || updates.regNo || null,
                    student.userId
                ]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapStudent(res.rows[0]);
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return null;

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

        try {
            const { data, error } = await client
                .from(this.tableName)
                .update(dbPayload)
                .eq('user_id', student.userId)
                .select()
                .single();

            if (error) return null;
            return this._mapStudent(data);
        } catch (e) {
            return null;
        }
    }

    async delete(id) {
        if (!id) return false;
        const student = await this.findById(id);
        if (!student) return false;

        try {
            await db.query(`DELETE FROM users WHERE LOWER("userId") = LOWER($1) OR LOWER(email) = LOWER($1)`, [student.userId]);
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return true;

        try {
            await client.from(this.tableName).delete().eq('user_id', student.userId);
        } catch (e) {}

        return true;
    }

    _mapStudent(row) {
        if (!row) return null;
        const userIdVal = row.userId || row.user_id || row.id;
        const roomNum = row.roomNumber || row.room_number || row.room || '';
        const blockVal = row.hostelBlock || row.block || '';
        const regNo = row.registrationNumber || row.registration_number || row.regNo || '';

        return {
            id: userIdVal,
            userId: userIdVal,
            email: row.email,
            password: row.password,
            name: row.name,
            role: 'student',
            roomNumber: roomNum,
            room: roomNum,
            block: blockVal,
            hostelBlock: blockVal,
            registrationNumber: regNo,
            regNo: regNo,
            phone: row.phone || '',
            department: row.specialization || '',
            specialization: row.specialization || '',
            status: row.status || 'Active',
            createdAt: row.created_at || row.createdAt,
            updatedAt: row.updated_at || row.updatedAt
        };
    }
}

module.exports = new StudentRepository();
