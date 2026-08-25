const { getSupabaseClient } = require('./supabaseClient');

class SecurityEventRepository {
    constructor() {
        this.tableName = 'security_events';
    }

    async getAll() {
        const client = getSupabaseClient();
        if (!client) return null;
        const { data, error } = await client.from(this.tableName).select('*').order('timestamp', { ascending: false });
        if (error) throw error;
        return data.map(this._mapEvent);
    }

    async create(event) {
        const client = getSupabaseClient();
        if (!client) return null;
        const payload = {
            event_id: event.event_id || event.eventId || 'EVT-' + Date.now(),
            camera_id: event.camera_id || event.cameraId || 'CCTV-01',
            student_id: event.student_id || event.studentId || '',
            student_name: event.student_name || event.studentName || 'Unknown person',
            timestamp: event.timestamp || new Date().toISOString(),
            image_url: event.image_url || event.imageUrl || '',
            status: event.status || 'UNAUTHORIZED',
            reason: event.reason || 'Curfew restriction triggered',
            acknowledged: Boolean(event.acknowledged)
        };
        const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
        if (error) throw error;
        return this._mapEvent(data);
    }

    async acknowledge(eventId, acknowledgedBy) {
        const client = getSupabaseClient();
        if (!client) return null;
        const { data, error } = await client
            .from(this.tableName)
            .update({ acknowledged: true, acknowledged_by: acknowledgedBy || 'Warden' })
            .eq('event_id', eventId)
            .select()
            .single();
        if (error) throw error;
        return this._mapEvent(data);
    }

    _mapEvent(row) {
        if (!row) return null;
        return {
            id: row.id,
            eventId: row.event_id,
            event_id: row.event_id,
            cameraId: row.camera_id,
            camera_id: row.camera_id,
            studentId: row.student_id,
            student_id: row.student_id,
            studentName: row.student_name,
            student_name: row.student_name,
            timestamp: row.timestamp,
            imageUrl: row.image_url,
            image_url: row.image_url,
            status: row.status,
            reason: row.reason,
            acknowledged: row.acknowledged,
            acknowledgedBy: row.acknowledged_by,
            acknowledged_by: row.acknowledged_by,
            createdAt: row.created_at
        };
    }
}

module.exports = new SecurityEventRepository();
