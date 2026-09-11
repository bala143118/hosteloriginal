const { getSupabaseClient } = require('./supabaseClient');
const db = require('../db');

class SecurityEventRepository {
    constructor() {
        this.tableName = 'security_events';
    }

    async getAll() {
        try {
            const res = await db.query('SELECT * FROM security_events ORDER BY created_at DESC');
            if (res.rows && res.rows.length > 0) {
                return res.rows.map(r => this._mapEvent(r));
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return [];
        try {
            const { data, error } = await client.from(this.tableName).select('*').order('timestamp', { ascending: false });
            if (error) return [];
            return data.map(this._mapEvent);
        } catch (e) {
            return [];
        }
    }

    async create(event) {
        const id = event.id || event.event_id || event.eventId || 'EVT-' + Date.now();
        const eventType = event.event_type || event.type || 'UNAUTHORIZED_ACCESS';
        const description = event.description || event.reason || 'Curfew restriction triggered';
        const location = event.location || event.cameraId || 'CCTV-01';
        const severity = event.severity || 'High';

        try {
            const res = await db.query(
                `INSERT INTO security_events (id, event_type, description, location, severity, created_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    description = EXCLUDED.description,
                    severity = EXCLUDED.severity
                 RETURNING *`,
                [id, eventType, description, location, severity]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapEvent(res.rows[0]);
            }
        } catch (pgErr) {
            console.error('[SecurityEventRepository PostgreSQL Create Error]', pgErr.message);
        }

        const client = getSupabaseClient();
        if (!client) {
            return this._mapEvent({ id, event_type: eventType, description, location, severity });
        }

        const payload = {
            event_id: id,
            camera_id: location,
            student_id: event.student_id || event.studentId || '',
            student_name: event.student_name || event.studentName || 'Unknown person',
            timestamp: event.timestamp || new Date().toISOString(),
            image_url: event.image_url || event.imageUrl || '',
            status: event.status || 'UNAUTHORIZED',
            reason: description,
            acknowledged: Boolean(event.acknowledged)
        };

        try {
            const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
            if (error) return this._mapEvent(payload);
            return this._mapEvent(data);
        } catch (e) {
            return this._mapEvent(payload);
        }
    }

    async acknowledge(eventId, acknowledgedBy) {
        if (!eventId) return null;
        const cleanId = String(eventId).trim();

        try {
            const res = await db.query(
                `UPDATE security_events SET description = description || ' (Acknowledged by ' || $1 || ')' WHERE id = $2 RETURNING *`,
                [acknowledgedBy || 'Warden', cleanId]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapEvent(res.rows[0]);
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return null;
        try {
            const { data, error } = await client
                .from(this.tableName)
                .update({ acknowledged: true, acknowledged_by: acknowledgedBy || 'Warden' })
                .eq('event_id', cleanId)
                .select()
                .single();

            if (error) return null;
            return this._mapEvent(data);
        } catch (e) {
            return null;
        }
    }

    _mapEvent(row) {
        if (!row) return null;
        const idVal = row.id || row.event_id || 'EVT-001';
        return {
            id: idVal,
            eventId: idVal,
            event_id: idVal,
            cameraId: row.location || row.camera_id || 'CCTV-01',
            camera_id: row.location || row.camera_id || 'CCTV-01',
            studentId: row.student_id || '',
            student_id: row.student_id || '',
            studentName: row.student_name || 'Unknown person',
            student_name: row.student_name || 'Unknown person',
            timestamp: row.created_at || row.timestamp || new Date().toISOString(),
            imageUrl: row.image_url || '',
            image_url: row.image_url || '',
            status: row.status || 'UNAUTHORIZED',
            reason: row.description || row.reason || '',
            acknowledged: Boolean(row.acknowledged),
            acknowledgedBy: row.acknowledged_by || '',
            acknowledged_by: row.acknowledged_by || '',
            createdAt: row.created_at || new Date().toISOString()
        };
    }
}

module.exports = new SecurityEventRepository();
