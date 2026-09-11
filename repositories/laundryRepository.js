const { getSupabaseClient } = require('./supabaseClient');
const userRepository = require('./userRepository');
const db = require('../db');

const inMemoryLaundry = new Map();

class LaundryRepository {
    constructor() {
        this.tableName = 'laundry_requests';
    }

    async getAll() {
        try {
            const res = await db.query('SELECT * FROM laundry_requests ORDER BY "createdAt" DESC');
            if (res.rows && res.rows.length > 0) {
                return res.rows.map(r => this._mapLaundry(r));
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return Array.from(inMemoryLaundry.values());
        try {
            const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
            if (error) return Array.from(inMemoryLaundry.values());
            return data.map(this._mapLaundry);
        } catch (err) {
            return Array.from(inMemoryLaundry.values());
        }
    }

    async findById(id) {
        if (!id) return null;
        const cleanId = String(id).trim();

        try {
            const res = await db.query('SELECT * FROM laundry_requests WHERE id = $1 LIMIT 1', [cleanId]);
            if (res.rows && res.rows.length > 0) {
                return this._mapLaundry(res.rows[0]);
            }
        } catch (e) {}

        if (inMemoryLaundry.has(cleanId)) return inMemoryLaundry.get(cleanId);
        const client = getSupabaseClient();
        if (!client) return null;
        try {
            const { data, error } = await client.from(this.tableName).select('*').eq('id', cleanId).maybeSingle();
            if (error) return null;
            return data ? this._mapLaundry(data) : null;
        } catch (err) {
            return null;
        }
    }

    async create(req) {
        const id = req.id || 'LR-' + Date.now();
        const studentEmail = (req.studentEmail || req.email || 'student@hostelfix.edu').trim().toLowerCase();
        const studentName = req.studentName || req.student || req.name || 'Resident Student';
        const clothCount = parseInt(req.clothCount || req.dressCount || req.count || 1, 10);
        const photos = req.photos || (req.photoUrl ? [req.photoUrl] : []);
        const block = req.block || req.hostelBlock || 'Block A';
        const roomNumber = req.roomNumber || req.room || '101';
        const pickupDate = req.pickupDate || new Date().toISOString().slice(0, 10);
        const status = req.status || 'Requested';

        const localObj = {
            id,
            studentId: req.studentId || req.userId || req.registrationNumber || 'STU-001',
            studentName,
            student: studentName,
            studentEmail,
            email: studentEmail,
            roomNumber,
            block,
            hostelBlock: block,
            clothCount,
            dressCount: clothCount,
            clothTypes: req.clothTypes || [],
            notes: req.notes || req.details || '',
            details: req.notes || req.details || '',
            photos,
            photoUrl: photos[0] || req.photoUrl || '',
            status,
            pickupDate,
            deliveryDate: req.deliveryDate || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        inMemoryLaundry.set(id, localObj);

        try {
            const res = await db.query(
                `INSERT INTO laundry_requests (id, "studentName", email, "hostelBlock", "roomNumber", "clothCount", "pickupDate", status, "createdAt")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    "studentName" = EXCLUDED."studentName",
                    email = EXCLUDED.email,
                    "clothCount" = EXCLUDED."clothCount",
                    status = EXCLUDED.status
                 RETURNING *`,
                [id, studentName, studentEmail, block, roomNumber, clothCount, pickupDate, status]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapLaundry(res.rows[0]);
            }
        } catch (pgErr) {
            console.error('[LaundryRepository PostgreSQL Create Error]', pgErr.message);
        }

        const client = getSupabaseClient();
        if (!client) return localObj;

        try {
            const payload = {
                id,
                student_name: studentName,
                student_email: studentEmail,
                room_number: roomNumber,
                block: block,
                cloth_count: clothCount,
                status,
                pickup_date: pickupDate
            };
            const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
            if (!error && data) return this._mapLaundry(data);
        } catch (err) {}

        return localObj;
    }

    async updateStatus(id, status, pickupDate = null, deliveryDate = null) {
        if (!id) return null;
        const cleanId = String(id).trim();

        if (inMemoryLaundry.has(cleanId)) {
            const item = inMemoryLaundry.get(cleanId);
            if (status) item.status = status;
            if (pickupDate) item.pickupDate = pickupDate;
            if (deliveryDate) item.deliveryDate = deliveryDate;
            item.updatedAt = new Date().toISOString();
        }

        try {
            const res = await db.query(
                `UPDATE laundry_requests SET
                    status = COALESCE($1, status),
                    "pickupDate" = COALESCE($2, "pickupDate")
                 WHERE id = $3
                 RETURNING *`,
                [status, pickupDate, cleanId]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapLaundry(res.rows[0]);
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return inMemoryLaundry.get(cleanId) || null;

        try {
            const updates = {};
            if (status) updates.status = status;
            if (pickupDate) updates.pickup_date = pickupDate;

            const { data, error } = await client.from(this.tableName).update(updates).eq('id', cleanId).select().single();
            if (!error && data) return this._mapLaundry(data);
        } catch (err) {}

        return inMemoryLaundry.get(cleanId) || null;
    }

    _mapLaundry(row) {
        if (!row) return null;
        const studentName = row.studentName || row.student_name || row.student || 'Resident Student';
        const email = row.email || row.student_email || '';
        const block = row.hostelBlock || row.block || 'Block A';
        const roomNum = row.roomNumber || row.room_number || '';
        const clothCount = row.clothCount || row.cloth_count || 1;

        return {
            id: row.id,
            studentId: row.student_id || row.id,
            studentName: studentName,
            student: studentName,
            studentEmail: email,
            email: email,
            roomNumber: roomNum,
            block: block,
            hostelBlock: block,
            clothCount: clothCount,
            dressCount: clothCount,
            clothTypes: row.cloth_types || [],
            notes: row.notes || '',
            details: row.notes || '',
            photos: row.photo_url ? [row.photo_url] : [],
            photoUrl: row.photo_url || '',
            status: row.status || 'Requested',
            pickupDate: row.pickupDate || row.pickup_date || '',
            deliveryDate: row.deliveryDate || row.delivery_date || '',
            createdAt: row.createdAt || row.created_at || new Date().toISOString(),
            updatedAt: row.updated_at || new Date().toISOString()
        };
    }
}

module.exports = new LaundryRepository();
