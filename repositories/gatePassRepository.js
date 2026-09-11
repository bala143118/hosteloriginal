const { getSupabaseClient } = require('./supabaseClient');
const db = require('../db');

class GatePassRepository {
    constructor() {
        this.tableName = 'gate_passes';
    }

    async getAll() {
        try {
            const res = await db.query('SELECT * FROM gate_passes ORDER BY "createdAt" DESC');
            if (res.rows && res.rows.length > 0) {
                return res.rows.map(r => this._mapGatePass(r));
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return [];
        try {
            const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
            if (error) return [];
            return data.map(this._mapGatePass);
        } catch (e) {
            return [];
        }
    }

    async findById(id) {
        if (!id) return null;
        const cleanId = String(id).trim();

        try {
            const res = await db.query('SELECT * FROM gate_passes WHERE id = $1 LIMIT 1', [cleanId]);
            if (res.rows && res.rows.length > 0) {
                return this._mapGatePass(res.rows[0]);
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return null;
        try {
            const { data, error } = await client.from(this.tableName).select('*').eq('id', cleanId).maybeSingle();
            if (error) return null;
            return data ? this._mapGatePass(data) : null;
        } catch (e) {
            return null;
        }
    }

    async findByQrToken(token) {
        if (!token) return null;
        const cleanToken = String(token).trim();

        try {
            const res = await db.query('SELECT * FROM gate_passes WHERE "qrCode" = $1 OR id = $1 LIMIT 1', [cleanToken]);
            if (res.rows && res.rows.length > 0) {
                return this._mapGatePass(res.rows[0]);
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return null;
        try {
            const { data, error } = await client.from(this.tableName).select('*').eq('qr_token', cleanToken).maybeSingle();
            if (error) return null;
            return data ? this._mapGatePass(data) : null;
        } catch (e) {
            return null;
        }
    }

    async create(pass) {
        const id = pass.id || 'GP-' + Date.now();
        const studentName = pass.studentName || pass.student || pass.name || 'Resident Student';
        const email = (pass.email || pass.studentEmail || 'student@hostelfix.edu').trim().toLowerCase();
        const regNo = pass.registrationNumber || '';
        const block = pass.block || pass.hostelBlock || 'Block A';
        const roomNumber = pass.roomNumber || pass.room || '101';
        const gateDate = pass.departureDate || pass.gateDate || pass.date || (pass.fromDate ? pass.fromDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
        const returnDate = pass.expectedReturnDate || pass.returnDate || (pass.toDate ? pass.toDate.slice(0, 10) : gateDate);
        const session = pass.session || pass.departureTime || 'Morning';
        const reason = pass.reason || 'Personal Visit';
        const status = ['Pending', 'Approved', 'Rejected', 'Out', 'Returned', 'Overdue'].includes(pass.status) ? pass.status : 'Pending';
        const qrCode = pass.qrToken || pass.qrCode || ('QR-' + id);

        try {
            const res = await db.query(
                `INSERT INTO gate_passes (id, student, email, "registrationNumber", "hostelBlock", "roomNumber", "gateDate", "returnDate", session, reason, status, "qrCode", "createdAt")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    student = EXCLUDED.student,
                    email = EXCLUDED.email,
                    status = EXCLUDED.status,
                    reason = EXCLUDED.reason
                 RETURNING *`,
                [id, studentName, email, regNo, block, roomNumber, gateDate, returnDate, session, reason, status, qrCode]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapGatePass(res.rows[0]);
            }
        } catch (pgErr) {
            console.error('[GatePassRepository PostgreSQL Create Error]', pgErr.message);
        }

        const client = getSupabaseClient();
        if (!client) return null;

        const depTime = pass.departureTime || pass.time || (pass.fromTime ? pass.fromTime.slice(0, 8) : '09:00:00');
        const retTime = pass.expectedReturnTime || pass.returnTime || (pass.toTime ? pass.toTime.slice(0, 8) : '18:00:00');

        const payload = {
            id,
            student_id: pass.studentId || pass.userId || regNo || 'STU-001',
            student_name: studentName,
            registration_number: regNo,
            email: email,
            room_number: roomNumber,
            block: block,
            reason: reason,
            destination: pass.destination || 'Home',
            parent_phone: pass.parentPhone || '',
            student_phone: pass.studentPhone || pass.phone || '',
            departure_date: gateDate,
            departure_time: depTime.length === 5 ? depTime + ':00' : depTime,
            expected_return_date: returnDate,
            expected_return_time: retTime.length === 5 ? retTime + ':00' : retTime,
            status,
            signature: pass.signature || pass.digitalSignature || '',
            qr_token: qrCode,
            student_photo: pass.studentPhoto || pass.photo || ''
        };
        try {
            const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
            if (error) throw error;
            return this._mapGatePass(data);
        } catch (e) {
            return this._mapGatePass(payload);
        }
    }

    async updateStatus(id, status, wardenName = '', notes = '') {
        const exitTime = status === 'Out' ? new Date().toISOString() : null;
        const hostelArrivalTime = status === 'Returned' ? new Date().toISOString() : null;

        try {
            const res = await db.query(
                `UPDATE gate_passes SET
                    status = $1,
                    "approvedBy" = COALESCE(NULLIF($2, ''), "approvedBy"),
                    "exitTime" = COALESCE($3, "exitTime"),
                    "hostelArrivalTime" = COALESCE($4, "hostelArrivalTime")
                 WHERE id = $5
                 RETURNING *`,
                [status, wardenName, exitTime, hostelArrivalTime, id]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapGatePass(res.rows[0]);
            }
        } catch (e) {}

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

        try {
            const { data, error } = await client.from(this.tableName).update(updates).eq('id', id).select().single();
            if (error) throw error;
            return this._mapGatePass(data);
        } catch (e) {
            return null;
        }
    }

    _mapGatePass(row) {
        if (!row) return null;
        const studentName = row.student || row.student_name || row.studentName || 'Resident Student';
        const email = row.email || row.student_email || '';
        const regNo = row.registrationNumber || row.registration_number || '';
        const block = row.hostelBlock || row.block || 'Block A';
        const roomNum = row.roomNumber || row.room_number || '';
        const qrCode = row.qrCode || row.qr_token || row.qr_code || ('QR-' + row.id);

        return {
            id: row.id,
            studentId: row.student_id || row.studentId || regNo || row.id,
            studentName: studentName,
            student: studentName,
            registrationNumber: regNo,
            email: email,
            roomNumber: roomNum,
            block: block,
            hostelBlock: block,
            reason: row.reason || '',
            destination: row.destination || 'Home',
            parentPhone: row.parent_phone || '',
            studentPhone: row.student_phone || '',
            departureDate: row.gateDate || row.departure_date || '',
            departureTime: row.departure_time || row.session || '09:00:00',
            expectedReturnDate: row.returnDate || row.expected_return_date || '',
            expectedReturnTime: row.expected_return_time || '18:00:00',
            status: row.status || 'Pending',
            approvedBy: row.approvedBy || row.warden_approved_by || '',
            wardenApprovedBy: row.approvedBy || row.warden_approved_by || '',
            wardenApprovedAt: row.warden_approved_at || null,
            wardenNotes: row.warden_notes || '',
            exitTime: row.exitTime || row.actual_exit_at || null,
            hostelArrivalTime: row.hostelArrivalTime || row.actual_entry_at || null,
            actualExitAt: row.exitTime || row.actual_exit_at || null,
            actualEntryAt: row.hostelArrivalTime || row.actual_entry_at || null,
            signature: row.signature || '',
            digitalSignature: row.signature || '',
            qrToken: qrCode,
            qrCode: qrCode,
            studentPhoto: row.student_photo || '',
            createdAt: row.createdAt || row.created_at || new Date().toISOString(),
            updatedAt: row.updated_at || new Date().toISOString()
        };
    }
}

module.exports = new GatePassRepository();
