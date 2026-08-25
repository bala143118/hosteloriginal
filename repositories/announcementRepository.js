const { getSupabaseClient } = require('./supabaseClient');

class AnnouncementRepository {
    constructor() {
        this.tableName = 'announcements';
    }

    async getAll() {
        const client = getSupabaseClient();
        if (!client) return null;
        const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return data.map(this._mapAnnouncement);
    }

    async create(announcement) {
        const client = getSupabaseClient();
        if (!client) return null;
        const payload = {
            id: announcement.id || 'ANN-' + Date.now(),
            title: announcement.title,
            message: announcement.message,
            priority: announcement.priority || 'Normal',
            audience: announcement.audience || 'All Students',
            admin_name: announcement.adminName || 'Hostel Administration',
            target_email: announcement.targetEmail || announcement.email || '',
            type: announcement.type || 'general'
        };
        const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
        if (error) throw error;
        return this._mapAnnouncement(data);
    }

    _mapAnnouncement(row) {
        if (!row) return null;
        return {
            id: row.id,
            title: row.title,
            message: row.message,
            priority: row.priority,
            audience: row.audience,
            adminName: row.admin_name,
            targetEmail: row.target_email,
            type: row.type,
            createdAt: row.created_at
        };
    }
}

module.exports = new AnnouncementRepository();
