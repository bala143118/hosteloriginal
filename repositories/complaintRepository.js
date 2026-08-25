const { getSupabaseClient } = require('./supabaseClient');

class ComplaintRepository {
    constructor() {
        this.tableName = 'complaints';
    }

    async getAll() {
        const client = getSupabaseClient();
        if (!client) return null;
        const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return data.map(this._mapComplaint);
    }

    async findById(id) {
        const client = getSupabaseClient();
        if (!client || !id) return null;
        const { data, error } = await client.from(this.tableName).select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return data ? this._mapComplaint(data) : null;
    }

    async create(complaint) {
        const client = getSupabaseClient();
        if (!client) return null;
        const payload = {
            id: complaint.id,
            title: complaint.title,
            description: complaint.description,
            category: complaint.category,
            priority: complaint.priority || 'Medium',
            status: complaint.status || 'Pending',
            block: complaint.block,
            room_number: complaint.roomNumber || complaint.room,
            student_id: complaint.studentId || '',
            student_name: complaint.studentName || complaint.name,
            student_email: complaint.studentEmail || complaint.email,
            technician_id: complaint.technicianId || null,
            technician_name: complaint.technicianName || 'Unassigned',
            photo_url: complaint.photoUrl || '',
            notes: complaint.notes || ''
        };
        const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
        if (error) throw error;
        return this._mapComplaint(data);
    }

    async updateStatus(id, status, notes = '') {
        const client = getSupabaseClient();
        if (!client) return null;
        const updates = { status };
        if (notes) updates.notes = notes;
        if (status === 'Completed') updates.resolved_at = new Date().toISOString();

        const { data, error } = await client.from(this.tableName).update(updates).eq('id', id).select().single();
        if (error) throw error;
        return this._mapComplaint(data);
    }

    async assignTechnician(id, techId, techName) {
        const client = getSupabaseClient();
        if (!client) return null;
        const updates = {
            technician_id: techId,
            technician_name: techName || 'Technician',
            status: 'In Progress'
        };
        const { data, error } = await client.from(this.tableName).update(updates).eq('id', id).select().single();
        if (error) throw error;
        return this._mapComplaint(data);
    }

    _mapComplaint(row) {
        if (!row) return null;
        return {
            id: row.id,
            title: row.title,
            description: row.description,
            category: row.category,
            priority: row.priority,
            status: row.status,
            block: row.block,
            roomNumber: row.room_number,
            room: row.room_number,
            studentId: row.student_id,
            studentName: row.student_name,
            name: row.student_name,
            studentEmail: row.student_email,
            email: row.student_email,
            technicianId: row.technician_id,
            technicianName: row.technician_name,
            photoUrl: row.photo_url,
            notes: row.notes,
            resolvedAt: row.resolved_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

module.exports = new ComplaintRepository();
