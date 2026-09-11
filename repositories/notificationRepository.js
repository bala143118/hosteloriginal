const { getSupabaseClient } = require('./supabaseClient');
const db = require('../db');

const notificationCache = [];

class NotificationRepository {
    constructor() {
        this.tableName = 'notifications';
    }

    async getForRecipient(recipientId = '', email = '', role = '') {
        const normEmail = String(email || '').trim().toLowerCase();
        const normId = String(recipientId || '').trim();
        const normRole = String(role || '').trim().toLowerCase();

        try {
            const res = await db.query('SELECT * FROM personal_notifications ORDER BY "createdAt" DESC');
            if (res.rows && res.rows.length > 0) {
                const mapped = res.rows.map(r => this._mapNotification(r));
                return mapped.filter(n => this._matches(n, normId, normEmail, normRole));
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) {
            return notificationCache
                .filter(n => this._matches(n, normId, normEmail, normRole))
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        try {
            const { data, error } = await client
                .from(this.tableName)
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                return notificationCache
                    .filter(n => this._matches(n, normId, normEmail, normRole))
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            }

            return data
                .map(this._mapNotification)
                .filter(n => this._matches(n, normId, normEmail, normRole));
        } catch (err) {
            return notificationCache
                .filter(n => this._matches(n, normId, normEmail, normRole))
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
    }

    async create(notification) {
        const id = notification.id || `NOTIF-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
        const recipientId = notification.recipientId || notification.targetUserId || '';
        const recipientEmail = (notification.recipientEmail || notification.targetEmail || '').trim().toLowerCase();
        const recipientRole = (notification.recipientRole || notification.receiverRole || '').trim().toLowerCase();
        const title = notification.title || 'Hostel Notification';
        const message = notification.message || '';
        const type = notification.type || 'general';
        const priority = ['Normal', 'Important', 'Emergency', 'Low', 'Medium', 'High'].includes(notification.priority)
            ? notification.priority
            : 'Normal';
        const targetName = notification.recipientName || notification.targetName || '';

        const payloadObj = {
            id,
            recipient_id: recipientId,
            recipient_email: recipientEmail,
            recipient_role: recipientRole,
            title,
            message,
            type,
            priority,
            read: false,
            metadata: notification.metadata || {}
        };

        notificationCache.push(this._mapNotification(payloadObj));

        try {
            const res = await db.query(
                `INSERT INTO personal_notifications (id, type, title, message, audience, "targetEmail", "targetName", priority, read, "createdAt")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    message = EXCLUDED.message
                 RETURNING *`,
                [id, type, title, message, recipientRole || 'All', recipientEmail, targetName, priority]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapNotification(res.rows[0]);
            }
        } catch (pgErr) {
            console.error('[NotificationRepository PostgreSQL Create Error]', pgErr.message);
        }

        const client = getSupabaseClient();
        if (!client) return this._mapNotification(payloadObj);

        try {
            const { data, error } = await client.from(this.tableName).insert([payloadObj]).select().single();
            if (error) return this._mapNotification(payloadObj);
            return this._mapNotification(data);
        } catch (err) {
            return this._mapNotification(payloadObj);
        }
    }

    async markAsRead(id) {
        if (!id) return null;
        const cleanId = String(id).trim();

        const found = notificationCache.find(n => n.id === cleanId);
        if (found) found.read = true;

        try {
            const res = await db.query(
                `UPDATE personal_notifications SET read = TRUE WHERE id = $1 RETURNING *`,
                [cleanId]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapNotification(res.rows[0]);
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return found;

        try {
            const { data, error } = await client
                .from(this.tableName)
                .update({ read: true })
                .eq('id', cleanId)
                .select()
                .single();

            if (error) return found;
            return this._mapNotification(data);
        } catch (err) {
            return found;
        }
    }

    _matches(n, id, email, role) {
        if (!n) return false;
        if (!n.recipientId && !n.recipientEmail && (!n.recipientRole || n.recipientRole === 'all')) return true;
        if (role && n.recipientRole && (n.recipientRole === role || n.recipientRole === 'all')) return true;
        if (email && n.recipientEmail && n.recipientEmail.toLowerCase() === email) return true;
        if (id && n.recipientId && n.recipientId === id) return true;
        return false;
    }

    _mapNotification(row) {
        if (!row) return null;
        return {
            id: row.id,
            recipientId: row.recipient_id || row.targetUserId || '',
            recipientEmail: row.targetEmail || row.recipient_email || '',
            recipientRole: row.audience || row.recipient_role || '',
            title: row.title,
            message: row.message,
            type: row.type || 'general',
            priority: row.priority || 'Normal',
            read: Boolean(row.read),
            metadata: row.metadata || {},
            createdAt: row.createdAt || row.created_at || new Date().toISOString()
        };
    }
}

module.exports = new NotificationRepository();
