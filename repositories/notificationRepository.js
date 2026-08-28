const { getSupabaseClient } = require('./supabaseClient');

const notificationCache = [];

class NotificationRepository {
    constructor() {
        this.tableName = 'notifications';
    }

    async getForRecipient(recipientId = '', email = '', role = '') {
        const client = getSupabaseClient();
        const normEmail = String(email || '').trim().toLowerCase();
        const normId = String(recipientId || '').trim();
        const normRole = String(role || '').trim().toLowerCase();

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
        const client = getSupabaseClient();
        const payload = {
            id: notification.id || `NOTIF-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
            recipient_id: notification.recipientId || notification.targetUserId || '',
            recipient_email: (notification.recipientEmail || notification.targetEmail || '').trim().toLowerCase(),
            recipient_role: (notification.recipientRole || notification.receiverRole || '').trim().toLowerCase(),
            title: notification.title || 'Hostel Notification',
            message: notification.message || '',
            type: notification.type || 'general',
            priority: ['Normal', 'Important', 'Emergency', 'Low', 'Medium', 'High'].includes(notification.priority)
                ? notification.priority
                : 'Normal',
            read: false,
            metadata: notification.metadata || {}
        };

        notificationCache.push(this._mapNotification(payload));

        if (!client) return this._mapNotification(payload);

        try {
            const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
            if (error) {
                console.warn('[NotificationRepository] Supabase insert warning:', error.message);
                return this._mapNotification(payload);
            }
            return this._mapNotification(data);
        } catch (err) {
            return this._mapNotification(payload);
        }
    }

    async markAsRead(id) {
        const client = getSupabaseClient();
        const found = notificationCache.find(n => n.id === id);
        if (found) found.read = true;

        if (!client || !id) return found;

        try {
            const { data, error } = await client
                .from(this.tableName)
                .update({ read: true })
                .eq('id', id)
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
        // Global broadcasts (no specific recipient or role='all')
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
            recipientId: row.recipient_id,
            recipientEmail: row.recipient_email,
            recipientRole: row.recipient_role,
            title: row.title,
            message: row.message,
            type: row.type,
            priority: row.priority,
            read: Boolean(row.read),
            metadata: row.metadata || {},
            createdAt: row.created_at || new Date().toISOString()
        };
    }
}

module.exports = new NotificationRepository();
