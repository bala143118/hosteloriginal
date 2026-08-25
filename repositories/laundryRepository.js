const { getSupabaseClient } = require('./supabaseClient');

class LaundryRepository {
    constructor() {
        this.tableName = 'laundry_requests';
    }

    async getAll() {
        const client = getSupabaseClient();
        if (!client) return null;
        const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return data.map(this._mapLaundry);
    }

    async findById(id) {
        const client = getSupabaseClient();
        if (!client || !id) return null;
        const { data, error } = await client.from(this.tableName).select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return data ? this._mapLaundry(data) : null;
    }

    async create(req) {
        const client = getSupabaseClient();
        if (!client) return null;

        const validStatuses = ['Requested', 'Scheduled', 'In Progress', 'Ready for Delivery', 'Completed', 'Cancelled'];
        let status = req.status || 'Requested';
        if (!validStatuses.includes(status)) {
            status = status.includes('Scheduled') ? 'Scheduled' : 'Requested';
        }

        const payload = {
            id: req.id || 'LR-' + Date.now(),
            student_id: req.studentId || req.userId || req.registrationNumber || 'STU-001',
            student_name: req.studentName || req.student || req.name || 'Resident Student',
            student_email: req.studentEmail || req.email || 'student@hostelfix.edu',
            room_number: req.roomNumber || req.room || '101',
            block: req.block || req.hostelBlock || 'Block A',
            cloth_count: parseInt(req.clothCount || req.dressCount || req.count || 1, 10),
            cloth_types: req.clothTypes || [],
            notes: req.notes || req.details || '',
            photo_url: req.photoUrl || req.photo || '',
            status: status,
            pickup_date: req.pickupDate || null,
            delivery_date: req.deliveryDate || null
        };
        const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
        if (error) throw error;
        return this._mapLaundry(data);
    }

    async updateStatus(id, status, pickupDate = null, deliveryDate = null) {
        const client = getSupabaseClient();
        if (!client) return null;
        const updates = { status };
        if (pickupDate) updates.pickup_date = pickupDate;
        if (deliveryDate) updates.delivery_date = deliveryDate;

        const { data, error } = await client.from(this.tableName).update(updates).eq('id', id).select().single();
        if (error) throw error;
        return this._mapLaundry(data);
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
