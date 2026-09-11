const { getSupabaseClient } = require('./supabaseClient');
const db = require('../db');

class AnnouncementRepository {
    constructor() {
        this.tableName = 'announcements';
    }

    async getAll() {
        try {
            const res = await db.query('SELECT * FROM announcements ORDER BY "createdAt" DESC');
            if (res.rows && res.rows.length > 0) {
                return res.rows.map(r => this._mapAnnouncement(r));
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return [];
        try {
            const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
            if (error) return [];
            return data.map(this._mapAnnouncement);
        } catch (e) {
            return [];
        }
    }

    async create(announcement) {
        const id = announcement.id || 'ANN-' + Date.now();
        const title = announcement.title || 'Notice';
        const message = announcement.message || '';
        const priority = announcement.priority || 'Normal';
        const audience = announcement.audience || 'All Students';
        const authorName = announcement.adminName || announcement.authorName || 'Hostel Administration';
        const targetEmail = announcement.targetEmail || announcement.email || '';
        const type = announcement.type || 'general';

        try {
            const res = await db.query(
                `INSERT INTO announcements (id, title, message, audience, priority, "authorName", "createdAt")
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    message = EXCLUDED.message,
                    priority = EXCLUDED.priority,
                    audience = EXCLUDED.audience
                 RETURNING *`,
                [id, title, message, audience, priority, authorName]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapAnnouncement(res.rows[0]);
            }
        } catch (pgErr) {
            console.error('[AnnouncementRepository PostgreSQL Create Error]', pgErr.message);
        }

        const client = getSupabaseClient();
        if (!client) {
            return this._mapAnnouncement({ id, title, message, priority, audience, authorName, targetEmail, type });
        }

        const payload = {
            id,
            title,
            message,
            priority,
            audience,
            admin_name: authorName,
            target_email: targetEmail,
            type
        };

        try {
            const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
            if (error) return this._mapAnnouncement(payload);
            return this._mapAnnouncement(data);
        } catch (e) {
            return this._mapAnnouncement(payload);
        }
    }

    _mapAnnouncement(row) {
        if (!row) return null;
        return {
            id: row.id,
            title: row.title,
            message: row.message,
            priority: row.priority || 'Normal',
            audience: row.audience || 'All',
            adminName: row.authorName || row.admin_name || row.author_name || 'Hostel Administration',
            authorName: row.authorName || row.admin_name || row.author_name || 'Hostel Administration',
            targetEmail: row.target_email || '',
            type: row.type || 'general',
            createdAt: row.createdAt || row.created_at || new Date().toISOString()
        };
    }
}

module.exports = new AnnouncementRepository();
