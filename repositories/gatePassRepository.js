const { getSupabaseClient } = require('./supabaseClient');

class GatePassRepository {
    constructor() {
        this.tableName = 'gate_passes';
    }

    async getAll() {
        const client = getSupabaseClient();
        if (!client) return null;
        const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return data.map(this._mapGatePass);
    }

    async findById(id) {
        const client = getSupabaseClient();
        if (!client || !id) return null;
        const { data, error } = await client.from(this.tableName).select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return data ? this._mapGatePass(data) : null;
    }

    async findByQrToken(token) {
        const client = getSupabaseClient();
        if (!client || !token) return null;
        const { data, error } = await client.from(this.tableName).select('*').eq('qr_token', token).maybeSingle();
        if (error) throw error;
        return data ? this._mapGatePass(data) : null;
    }

    async create(pass) {
        const client = getSupabaseClient();
        if (!client) return null;
        const payload = {
            id: pass.id,
            student_id: pass.studentId || pass.userId,
            student_name: pass.studentName || pass.name,
            registration_number: pass.registrationNumber || '',
            email: pass.email || pass.studentEmail,
            room_number: pass.roomNumber || pass.room,
            block: pass.block,
            reason: pass.reason,
            destination: pass.destination,
            parent_phone: pass.parentPhone || '',
            student_phone: pass.studentPhone || '',
            departure_date: pass.departureDate || pass.date,
            departure_time: pass.departureTime || pass.time,
            expected_return_date: pass.expectedReturnDate || pass.returnDate,
            expected_return_time: pass.expectedReturnTime || pass.returnTime,
            status: pass.status || 'Pending',
            signature: pass.signature || '',
            qr_token: pass.qrToken || '',
            student_photo: pass.studentPhoto || ''
        };
        const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
        if (error) throw error;
        return this._mapGatePass(data);
    }

    async updateStatus(id, status, wardenName = '', notes = '') {
        const client = getSupabaseClient();
        if (!client) return null;
        const updates = { status };
        if (wardenName) {
            updates.warden_approved_by = wardenName;
            updates.warden_approved_at = new Date().toISOString();
        }
        if (notes) updates.warden_notes = notes;
        if (status === 'Out') updates.actual_exit_at = new Date().toISOString();
        if (status === 'Returned') updates.actual_entry_at = new Date().toISOString();

        const { data, error } = await client.from(this.tableName).update(updates).eq('id', id).select().single();
        if (error) throw error;
        return this._mapGatePass(data);
    }

    _mapGatePass(row) {
        if (!row) return null;
        return {
            id: row.id,
            studentId: row.student_id,
            studentName: row.student_name,
            registrationNumber: row.registration_number,
            email: row.email,
            roomNumber: row.room_number,
            block: row.block,
            reason: row.reason,
            destination: row.destination,
            parentPhone: row.parent_phone,
            studentPhone: row.student_phone,
            departureDate: row.departure_date,
            departureTime: row.departure_time,
            expectedReturnDate: row.expected_return_date,
            expectedReturnTime: row.expected_return_time,
            status: row.status,
            wardenApprovedBy: row.warden_approved_by,
            wardenApprovedAt: row.warden_approved_at,
            wardenNotes: row.warden_notes,
            actualExitAt: row.actual_exit_at,
            actualEntryAt: row.actual_entry_at,
            signature: row.signature,
            qrToken: row.qr_token,
            studentPhoto: row.student_photo,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

module.exports = new GatePassRepository();
