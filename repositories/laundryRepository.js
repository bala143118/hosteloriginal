const { getSupabaseClient } = require('./supabaseClient');
const userRepository = require('./userRepository');

const inMemoryLaundry = new Map();

class LaundryRepository {
    constructor() {
        this.tableName = 'laundry_requests';
    }

    async getAll() {
        const client = getSupabaseClient();
        if (!client) return Array.from(inMemoryLaundry.values());
        try {
            const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
            if (error) throw error;
            const fromDb = data.map(this._mapLaundry);
            const combined = [...fromDb];
            for (const item of inMemoryLaundry.values()) {
                if (!combined.some(c => c.id === item.id)) combined.push(item);
            }
            return combined;
        } catch (err) {
            return Array.from(inMemoryLaundry.values());
        }
    }

    async findById(id) {
        if (inMemoryLaundry.has(id)) return inMemoryLaundry.get(id);
        const client = getSupabaseClient();
        if (!client || !id) return null;
        try {
            const { data, error } = await client.from(this.tableName).select('*').eq('id', id).maybeSingle();
            if (error) throw error;
            return data ? this._mapLaundry(data) : inMemoryLaundry.get(id) || null;
        } catch (err) {
            return inMemoryLaundry.get(id) || null;
        }
    }

    async create(req) {
        const validStatuses = ['Requested', 'Scheduled', 'Pickup Scheduled', 'In Progress', 'Ready for Delivery', 'Completed', 'Cancelled'];
        let status = req.status || 'Requested';

        const id = req.id || 'LR-' + Date.now();
        const studentEmail = req.studentEmail || req.email || 'student@hostelfix.edu';
        const studentName = req.studentName || req.student || req.name || 'Resident Student';
        const clothCount = parseInt(req.clothCount || req.dressCount || req.count || 1, 10);
        const photos = req.photos || (req.photoUrl ? [req.photoUrl] : []);

        const localObj = {
            id,
            studentId: req.studentId || req.userId || req.registrationNumber || 'STU-001',
            studentName,
            student: studentName,
            studentEmail,
            email: studentEmail,
            roomNumber: req.roomNumber || req.room || '101',
            block: req.block || req.hostelBlock || 'Block A',
            hostelBlock: req.block || req.hostelBlock || 'Block A',
            clothCount,
            dressCount: clothCount,
            clothTypes: req.clothTypes || [],
            notes: req.notes || req.details || '',
            details: req.notes || req.details || '',
            photos,
            photoUrl: photos[0] || req.photoUrl || '',
            status,
            pickupDate: req.pickupDate || null,
            deliveryDate: req.deliveryDate || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        inMemoryLaundry.set(id, localObj);

        const client = getSupabaseClient();
        if (!client) return localObj;

        try {
            let studentUuid = null;
            if (req.studentId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.studentId)) {
                studentUuid = req.studentId;
            } else {
                const user = await userRepository.findByEmail(studentEmail);
                if (user && user.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) {
                    studentUuid = user.id;
                }
            }

            const payload = {
                id,
                student_id: studentUuid,
                student_name: studentName,
                student_email: studentEmail,
                room_number: localObj.roomNumber,
                block: localObj.block,
                cloth_count: clothCount,
                cloth_types: localObj.clothTypes,
                notes: localObj.notes,
                photo_url: localObj.photoUrl,
                status,
                pickup_date: req.pickupDate || null,
                delivery_date: req.deliveryDate || null
            };

            const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
            if (!error && data) {
                const mapped = this._mapLaundry(data);
                mapped.photos = photos;
                mapped.dressCount = clothCount;
                inMemoryLaundry.set(id, mapped);
                return mapped;
            }
        } catch (err) {
            console.warn('[LaundryRepository] fallback to memory for create:', err.message);
        }

        return localObj;
    }

    async updateStatus(id, status, pickupDate = null, deliveryDate = null) {
        if (inMemoryLaundry.has(id)) {
            const item = inMemoryLaundry.get(id);
            if (status) item.status = status;
            if (pickupDate) item.pickupDate = pickupDate;
            if (deliveryDate) item.deliveryDate = deliveryDate;
            item.updatedAt = new Date().toISOString();
        }

        const client = getSupabaseClient();
        if (!client) return inMemoryLaundry.get(id) || null;

        try {
            const updates = {};
            if (status) updates.status = status;
            if (pickupDate) updates.pickup_date = pickupDate;
            if (deliveryDate) updates.delivery_date = deliveryDate;

            const { data, error } = await client.from(this.tableName).update(updates).eq('id', id).select().single();
            if (!error && data) {
                const mapped = this._mapLaundry(data);
                inMemoryLaundry.set(id, mapped);
                return mapped;
            }
        } catch (err) {}

        return inMemoryLaundry.get(id) || null;
    }

    _mapLaundry(row) {
        if (!row) return null;
        return {
            id: row.id,
            studentId: row.student_id,
            studentName: row.student_name,
            student: row.student_name,
            studentEmail: row.student_email,
            email: row.student_email,
            roomNumber: row.room_number,
            block: row.block,
            hostelBlock: row.block,
            clothCount: row.cloth_count,
            dressCount: row.cloth_count,
            clothTypes: row.cloth_types,
            notes: row.notes,
            details: row.notes,
            photos: row.photo_url ? [row.photo_url] : [],
            photoUrl: row.photo_url,
            status: row.status,
            pickupDate: row.pickup_date,
            deliveryDate: row.delivery_date,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

module.exports = new LaundryRepository();
