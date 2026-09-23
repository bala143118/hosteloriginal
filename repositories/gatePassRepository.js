const fs = require('fs');
const path = require('path');
const { getSupabaseClient } = require('./supabaseClient');
const db = require('../db');

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
const DATA_DIR = isVercel ? path.join('/tmp', 'data') : path.join(__dirname, '..', 'data');
const dbPath = path.join(DATA_DIR, 'db.json');

const gatePassLocalCache = new Map();

function readLocalGatePasses() {
    try {
        if (fs.existsSync(dbPath)) {
            const raw = fs.readFileSync(dbPath, 'utf8').replace(/^\uFEFF/, '');
            const parsed = JSON.parse(raw);
            return parsed.gatePasses || [];
        }
    } catch (e) {}
    return [];
}

function writeLocalGatePasses(passes) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        let full = {};
        if (fs.existsSync(dbPath)) {
            const raw = fs.readFileSync(dbPath, 'utf8').replace(/^\uFEFF/, '');
            full = JSON.parse(raw);
        }
        full.gatePasses = passes;
        fs.writeFileSync(dbPath, JSON.stringify(full, null, 2), 'utf8');
    } catch (e) {}
}

class GatePassRepository {
    constructor() {
        this.tableName = 'gate_passes';
    }

    async getAll() {
        try {
            const res = await db.query('SELECT * FROM gate_passes ORDER BY "createdAt" DESC');
            if (res.rows && res.rows.length > 0) {
                const list = res.rows.map(r => this._mapGatePass(r)).filter(Boolean);
                list.forEach(p => gatePassLocalCache.set(p.id, p));
                return list;
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (client) {
            try {
                const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
                if (!error && data && data.length > 0) {
                    const list = data.map(r => this._mapGatePass(r)).filter(Boolean);
                    list.forEach(p => gatePassLocalCache.set(p.id, p));
                    return list;
                }
            } catch (e) {}
        }

        const local = readLocalGatePasses().map(r => this._mapGatePass(r)).filter(Boolean);
        local.forEach(p => {
            if (!gatePassLocalCache.has(p.id)) {
                gatePassLocalCache.set(p.id, p);
            }
        });

        return Array.from(gatePassLocalCache.values()).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }

    async findById(id) {
        if (!id) return null;
        const cleanId = String(id).trim();

        try {
            const res = await db.query('SELECT * FROM gate_passes WHERE id = $1 LIMIT 1', [cleanId]);
            if (res.rows && res.rows.length > 0) {
                const mapped = this._mapGatePass(res.rows[0]);
                gatePassLocalCache.set(cleanId, mapped);
                return mapped;
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (client) {
            try {
                const { data, error } = await client.from(this.tableName).select('*').eq('id', cleanId).maybeSingle();
                if (!error && data) {
                    const mapped = this._mapGatePass(data);
                    gatePassLocalCache.set(cleanId, mapped);
                    return mapped;
                }
            } catch (e) {}
        }

        if (gatePassLocalCache.has(cleanId)) {
            return gatePassLocalCache.get(cleanId);
        }

        const local = readLocalGatePasses().find(p => p.id === cleanId);
        if (local) {
            const mapped = this._mapGatePass(local);
            gatePassLocalCache.set(cleanId, mapped);
            return mapped;
        }

        return null;
    }

    async findByQrToken(token) {
        if (!token) return null;
        const cleanToken = String(token).trim();

        try {
            const res = await db.query('SELECT * FROM gate_passes WHERE "qrCode" = $1 OR id = $1 LIMIT 1', [cleanToken]);
            if (res.rows && res.rows.length > 0) {
                const mapped = this._mapGatePass(res.rows[0]);
                gatePassLocalCache.set(mapped.id, mapped);
                return mapped;
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (client) {
            try {
                const { data, error } = await client.from(this.tableName).select('*').or(`qr_token.eq.${cleanToken},id.eq.${cleanToken}`).maybeSingle();
                if (!error && data) {
                    const mapped = this._mapGatePass(data);
                    gatePassLocalCache.set(mapped.id, mapped);
                    return mapped;
                }
            } catch (e) {}
        }

        for (const p of gatePassLocalCache.values()) {
            if (p.qrToken === cleanToken || p.qrCode === cleanToken || p.id === cleanToken) {
                return p;
            }
        }

        const local = readLocalGatePasses().find(p => p.qrToken === cleanToken || p.qrCode === cleanToken || p.id === cleanToken || p.qr_token === cleanToken);
        if (local) {
            const mapped = this._mapGatePass(local);
            gatePassLocalCache.set(mapped.id, mapped);
            return mapped;
        }

        return null;
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
        const reason = pass.reason || pass.purpose || 'Personal Visit';
        const status = pass.status || 'Pending';
        const qrCode = pass.qrToken || pass.qrCode || ('QR-' + id);
        const depTime = pass.departureTime || pass.time || (pass.fromTime ? pass.fromTime.slice(0, 8) : '09:00:00');
        const retTime = pass.expectedReturnTime || pass.returnTime || (pass.toTime ? pass.toTime.slice(0, 8) : '18:00:00');
        const signature = pass.signature || pass.digitalSignature || '';
        const studentPhoto = pass.studentPhoto || pass.photo || '';
        const parentPhone = pass.parentPhone || pass.parent_phone || '';
        const studentPhone = pass.studentPhone || pass.phone || pass.student_phone || '';

        const localRecord = {
            id,
            student_id: pass.studentId || pass.userId || regNo || 'STU-001',
            student_name: studentName,
            registration_number: regNo,
            email,
            room_number: roomNumber,
            block,
            reason,
            destination: pass.destination || 'Home',
            parent_phone: parentPhone,
            student_phone: studentPhone,
            departure_date: gateDate,
            departure_time: depTime.length === 5 ? depTime + ':00' : depTime,
            expected_return_date: returnDate,
            expected_return_time: retTime.length === 5 ? retTime + ':00' : retTime,
            session,
            status,
            signature,
            qr_token: qrCode,
            student_photo: studentPhoto,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const mapped = this._mapGatePass(localRecord);
        gatePassLocalCache.set(id, mapped);

        // Update db.json
        const currentPasses = readLocalGatePasses().filter(p => p.id !== id);
        currentPasses.unshift(mapped);
        writeLocalGatePasses(currentPasses);

        // 1. Try PostgreSQL
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
                const pgMapped = this._mapGatePass(res.rows[0]);
                gatePassLocalCache.set(id, pgMapped);
                return pgMapped;
            }
        } catch (pgErr) {
            console.error('[GatePassRepository PostgreSQL Create Error]', pgErr.message);
        }

        // 2. Try Supabase
        const client = getSupabaseClient();
        if (client) {
            try {
                const { data, error } = await client.from(this.tableName).insert([localRecord]).select().single();
                if (!error && data) {
                    const sbMapped = this._mapGatePass(data);
                    gatePassLocalCache.set(id, sbMapped);
                    return sbMapped;
                }
            } catch (e) {}
        }

        return mapped;
    }

    async updateStatus(id, status, wardenName = '', notes = '') {
        const exitTime = ['Out', 'OUT', 'OUTSIDE'].includes(status) ? new Date().toISOString() : null;
        const hostelArrivalTime = ['Returned', 'COMPLETED', 'IN'].includes(status) ? new Date().toISOString() : null;

        let pass = gatePassLocalCache.get(id);
        if (!pass) {
            const local = readLocalGatePasses().find(p => p.id === id);
            if (local) pass = this._mapGatePass(local);
        }

        if (pass) {
            pass.status = status;
            if (wardenName) {
                pass.approvedBy = wardenName;
                pass.wardenApprovedBy = wardenName;
                pass.wardenApprovedAt = new Date().toISOString();
            }
            if (notes) pass.wardenNotes = notes;
            if (exitTime) {
                pass.exitTime = exitTime;
                pass.actualExitAt = exitTime;
            }
            if (hostelArrivalTime) {
                pass.hostelArrivalTime = hostelArrivalTime;
                pass.actualEntryAt = hostelArrivalTime;
            }
            pass.updatedAt = new Date().toISOString();
            gatePassLocalCache.set(id, pass);

            const all = readLocalGatePasses().map(p => p.id === id ? pass : p);
            writeLocalGatePasses(all);
        }

        // Try PostgreSQL
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
                const pgMapped = this._mapGatePass(res.rows[0]);
                gatePassLocalCache.set(id, pgMapped);
                return pgMapped;
            }
        } catch (e) {}

        // Try Supabase
        const client = getSupabaseClient();
        if (client) {
            const updates = { status };
            if (wardenName) {
                updates.warden_approved_by = wardenName;
                updates.warden_approved_at = new Date().toISOString();
            }
            if (notes) updates.warden_notes = notes;
            if (exitTime) updates.actual_exit_at = exitTime;
            if (hostelArrivalTime) updates.actual_entry_at = hostelArrivalTime;

            try {
                const { data, error } = await client.from(this.tableName).update(updates).eq('id', id).select().single();
                if (!error && data) {
                    const sbMapped = this._mapGatePass(data);
                    gatePassLocalCache.set(id, sbMapped);
                    return sbMapped;
                }
            } catch (e) {}
        }

        return pass || null;
    }

    _mapGatePass(row) {
        if (!row) return null;
        const studentName = row.student || row.student_name || row.studentName || 'Resident Student';
        const email = row.email || row.student_email || row.studentEmail || '';
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
            studentEmail: email,
            roomNumber: roomNum,
            block: block,
            hostelBlock: block,
            reason: row.reason || row.purpose || '',
            purpose: row.reason || row.purpose || '',
            destination: row.destination || 'Home',
            parentPhone: row.parent_phone || row.parentPhone || '',
            studentPhone: row.student_phone || row.studentPhone || '',
            departureDate: row.gateDate || row.departure_date || row.departureDate || '',
            departureTime: row.departure_time || row.departureTime || row.session || '09:00:00',
            gateDate: row.gateDate || row.departure_date || row.departureDate || '',
            returnDate: row.returnDate || row.expected_return_date || row.expectedReturnDate || '',
            expectedReturnDate: row.returnDate || row.expected_return_date || row.expectedReturnDate || '',
            expectedReturnTime: row.expected_return_time || row.expectedReturnTime || '18:00:00',
            session: row.session || 'Morning',
            status: row.status || 'Pending',
            approvedBy: row.approvedBy || row.warden_approved_by || '',
            wardenApprovedBy: row.approvedBy || row.warden_approved_by || '',
            wardenApprovedAt: row.warden_approved_at || row.wardenApprovedAt || null,
            wardenNotes: row.warden_notes || row.wardenNotes || '',
            exitTime: row.exitTime || row.actual_exit_at || null,
            hostelArrivalTime: row.hostelArrivalTime || row.actual_entry_at || null,
            actualExitAt: row.exitTime || row.actual_exit_at || null,
            actualEntryAt: row.hostelArrivalTime || row.actual_entry_at || null,
            signature: row.signature || row.digitalSignature || '',
            digitalSignature: row.signature || row.digitalSignature || '',
            signatureAlgorithm: row.signatureAlgorithm || row.signature_algorithm || 'ECDSA-P256-SHA256',
            signatureFingerprint: row.signatureFingerprint || row.signature_fingerprint || '',
            signedAt: row.signedAt || row.signed_at || null,
            qrToken: qrCode,
            qrCode: qrCode,
            studentPhoto: row.student_photo || row.studentPhoto || '',
            createdAt: row.createdAt || row.created_at || new Date().toISOString(),
            updatedAt: row.updatedAt || row.updated_at || new Date().toISOString()
        };
    }
}

module.exports = new GatePassRepository();
