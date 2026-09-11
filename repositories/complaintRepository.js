const { getSupabaseClient } = require('./supabaseClient');
const wardenRepository = require('./wardenRepository');
const wardenScopeRepository = require('./wardenScopeRepository');
const notificationRepository = require('./notificationRepository');
const db = require('../db');

// In-memory fallback cache for complaints
const complaintLocalCache = new Map();

function generateComplaintId() {
    const year = new Date().getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `CMP-${year}-${rand}`;
}

class ComplaintRepository {
    constructor() {
        this.tableName = 'complaints';
    }

    generateId() {
        return generateComplaintId();
    }

    async getAll() {
        try {
            const res = await db.query('SELECT * FROM complaints ORDER BY "createdAt" DESC');
            if (res.rows && res.rows.length > 0) {
                const mapped = res.rows.map(row => this._mapComplaint(row)).filter(Boolean);
                mapped.forEach(c => complaintLocalCache.set(c.id, c));
                return mapped;
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) {
            return Array.from(complaintLocalCache.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        try {
            const { data, error } = await client
                .from(this.tableName)
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                return Array.from(complaintLocalCache.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            }

            const mapped = (data || []).map(row => this._mapComplaint(row)).filter(Boolean);
            mapped.forEach(c => complaintLocalCache.set(c.id, c));
            return mapped;
        } catch (err) {
            return Array.from(complaintLocalCache.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
    }

    async findById(id) {
        if (!id) return null;
        const cleanId = String(id).trim();

        try {
            const res = await db.query('SELECT * FROM complaints WHERE id = $1 LIMIT 1', [cleanId]);
            if (res.rows && res.rows.length > 0) {
                const mapped = this._mapComplaint(res.rows[0]);
                complaintLocalCache.set(cleanId, mapped);
                return mapped;
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) {
            return complaintLocalCache.get(cleanId) || null;
        }

        try {
            const { data, error } = await client
                .from(this.tableName)
                .select('*')
                .eq('id', cleanId)
                .maybeSingle();

            if (!error && data) {
                const mapped = this._mapComplaint(data);
                complaintLocalCache.set(cleanId, mapped);
                return mapped;
            }
            return complaintLocalCache.get(cleanId) || null;
        } catch (err) {
            return complaintLocalCache.get(cleanId) || null;
        }
    }

    async resolveResponsibleWarden(block = 'Block A', floor = '', room = '') {
        try {
            const allWardens = await wardenRepository.getAllWardens();
            const activeWardens = allWardens.filter(w => w.status !== 'Inactive');
            if (!activeWardens.length) return null;

            const cleanBlock = String(block || 'Block A').trim().toLowerCase().replace(/^block-?/, '');

            for (const warden of activeWardens) {
                const scope = warden.scope || {};
                const scopeBlock = String(scope.block || warden.hostelBlock || warden.block || 'All').trim().toLowerCase().replace(/^block-?/, '');
                if (scopeBlock === cleanBlock || scopeBlock === 'all') {
                    return warden;
                }
            }

            const directMatch = activeWardens.find(w => {
                const wBlock = String(w.hostelBlock || w.block || '').trim().toLowerCase().replace(/^block-?/, '');
                return wBlock === cleanBlock;
            });
            if (directMatch) return directMatch;

            return activeWardens[0];
        } catch (e) {
            return null;
        }
    }

    async create(complaintData) {
        const id = complaintData.id || generateComplaintId();
        const now = new Date().toISOString();

        const block = complaintData.block || complaintData.hostelBlock || 'Block A';
        const roomNumber = complaintData.roomNumber || complaintData.room || '101';
        const floor = complaintData.floor || (roomNumber.length >= 3 ? roomNumber.slice(0, -2) : '1');
        const category = complaintData.category || 'General Maintenance';
        const priority = complaintData.priority ? (complaintData.priority.charAt(0).toUpperCase() + complaintData.priority.slice(1).toLowerCase()) : 'Medium';
        const title = complaintData.title || `${category} issue in ${block}, Room ${roomNumber}`;
        const description = complaintData.description || title;
        const studentId = complaintData.studentId || complaintData.userId || '';
        const studentName = complaintData.studentName || complaintData.student || complaintData.name || 'Resident Student';
        const studentEmail = (complaintData.studentEmail || complaintData.email || '').trim().toLowerCase();
        const studentPhone = complaintData.studentPhone || complaintData.phone || '';
        const photoUrl = complaintData.photoUrl || complaintData.photo || complaintData.evidenceUrl || '';
        const preferredTime = complaintData.preferredTime || complaintData.preferred_time || '';
        const regNo = complaintData.registrationNumber || complaintData.regNo || '';

        let warden = null;
        if (complaintData.wardenId) {
            warden = await wardenRepository.getWardenById(complaintData.wardenId);
        }
        if (!warden) {
            warden = await this.resolveResponsibleWarden(block, floor, roomNumber);
        }

        const wardenId = warden?.userId || warden?.id || complaintData.wardenId || '';
        const wardenName = warden?.name || complaintData.wardenName || 'Duty Warden';
        const wardenEmail = warden?.email || complaintData.wardenEmail || '';

        const initialHistory = [
            {
                action: 'Complaint Created',
                status: 'Submitted',
                actor: studentName,
                role: 'student',
                actorEmail: studentEmail,
                timestamp: now,
                notes: `Complaint reported for ${block} - Room ${roomNumber}. Auto-routed to Warden ${wardenName}.`
            }
        ];

        const mappedRecord = {
            id,
            title,
            description,
            category,
            priority,
            status: 'Submitted',
            block,
            hostelBlock: block,
            floor,
            roomNumber,
            room: roomNumber,
            registrationNumber: regNo,
            studentId,
            studentName,
            student: studentName,
            name: studentName,
            studentEmail,
            email: studentEmail,
            studentPhone,
            wardenId,
            wardenName,
            wardenEmail,
            technicianId: null,
            technicianName: 'Unassigned',
            technician: 'Unassigned',
            assignedTo: 'Unassigned',
            photoUrl,
            evidenceUrl: photoUrl,
            beforePhotoUrl: '',
            afterPhotoUrl: '',
            resolutionRemarks: '',
            preferredTime,
            verifiedBy: '',
            verifiedAt: '',
            rejectionReason: '',
            statusHistory: initialHistory,
            notes: description,
            resolvedAt: null,
            createdAt: now,
            updatedAt: now
        };

        complaintLocalCache.set(id, mappedRecord);

        // 1. Try PostgreSQL
        try {
            const res = await db.query(
                `INSERT INTO complaints (id, student, email, "registrationNumber", "hostelBlock", "roomNumber", category, priority, description, status, "assignedTo", timeline, "createdAt", "updatedAt")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW(), NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    student = EXCLUDED.student,
                    email = EXCLUDED.email,
                    category = EXCLUDED.category,
                    priority = EXCLUDED.priority,
                    description = EXCLUDED.description,
                    status = EXCLUDED.status,
                    "updatedAt" = NOW()
                 RETURNING *`,
                [
                    id, studentName, studentEmail, regNo, block, roomNumber,
                    category, priority, description, 'Submitted', 'Unassigned',
                    JSON.stringify(initialHistory)
                ]
            );
            if (res.rows && res.rows.length > 0) {
                const mapped = this._mapComplaint(res.rows[0]);
                complaintLocalCache.set(id, mapped);
            }
        } catch (pgErr) {
            console.error('[ComplaintRepository PostgreSQL Create Error]', pgErr.message);
        }

        // 2. Try Supabase fallback
        const client = getSupabaseClient();
        if (client) {
            try {
                const dbPayload = {
                    id, title, description, category, priority, status: 'Submitted',
                    block, room_number: roomNumber, student_id: studentId, student_name: studentName,
                    student_email: studentEmail, technician_id: null, technician_name: 'Unassigned',
                    photo_url: photoUrl, notes: JSON.stringify({ preferred_time: preferredTime, student_phone: studentPhone, floor, warden_id: wardenId, warden_name: wardenName, warden_email: wardenEmail, status_history: initialHistory })
                };
                const { data, error } = await client.from(this.tableName).insert([dbPayload]).select().single();
                if (!error && data) {
                    const mapped = this._mapComplaint(data);
                    complaintLocalCache.set(id, mapped);
                }
            } catch (err) {}
        }

        if (wardenEmail || wardenId) {
            try {
                await notificationRepository.create({
                    recipientId: wardenId,
                    recipientEmail: wardenEmail,
                    recipientRole: 'warden',
                    title: `New Complaint: ${category} (${priority} Priority)`,
                    message: `${studentName} from ${block} Room ${roomNumber} reported: "${title}". Action required.`,
                    type: 'complaint_created',
                    priority: priority === 'Emergency' || priority === 'High' ? 'Emergency' : 'Important',
                    metadata: { complaintId: id, category, priority, block, roomNumber }
                });
            } catch (notifErr) {}
        }

        return complaintLocalCache.get(id) || mappedRecord;
    }

    async assignStaff(complaintId, technicianIdOrOptions, legacyName = null, legacyAssignedBy = 'Warden', legacyAssignedByRole = 'warden') {
        const complaint = await this.findById(complaintId);
        if (!complaint) throw new Error('Complaint not found.');

        const now = new Date().toISOString();
        let techId, techName, techPhone, techSpecialization, instructions, estimatedCompletion, assignedBy, assignedByRole;

        if (typeof technicianIdOrOptions === 'object' && technicianIdOrOptions !== null) {
            techId = technicianIdOrOptions.technicianId || technicianIdOrOptions.id || `TECH-${Date.now()}`;
            techName = technicianIdOrOptions.technicianName || technicianIdOrOptions.name || technicianIdOrOptions.staffName || 'Technician';
            techPhone = technicianIdOrOptions.technicianPhone || technicianIdOrOptions.phone || technicianIdOrOptions.staffPhone || '';
            techSpecialization = technicianIdOrOptions.technicianSpecialization || technicianIdOrOptions.specialization || technicianIdOrOptions.staffRole || '';
            instructions = technicianIdOrOptions.instructions || technicianIdOrOptions.notes || technicianIdOrOptions.wardenNotes || '';
            estimatedCompletion = technicianIdOrOptions.estimatedCompletion || technicianIdOrOptions.targetTime || '';
            assignedBy = technicianIdOrOptions.assignedBy || legacyAssignedBy || 'Warden';
            assignedByRole = technicianIdOrOptions.assignedByRole || legacyAssignedByRole || 'warden';
        } else {
            techId = technicianIdOrOptions || 'TECH-001';
            techName = legacyName || 'Technician';
            techPhone = '';
            techSpecialization = '';
            instructions = '';
            estimatedCompletion = '';
            assignedBy = legacyAssignedBy || 'Warden';
            assignedByRole = legacyAssignedByRole || 'warden';
        }

        const history = Array.isArray(complaint.statusHistory) ? [...complaint.statusHistory] : [];
        const historyNotes = `Assigned to staff ${techName}${techSpecialization ? ` (${techSpecialization})` : ''}${techPhone ? ` • Contact: ${techPhone}` : ''}.${instructions ? ` Instructions: "${instructions}"` : ''}${estimatedCompletion ? ` Target: ${estimatedCompletion}` : ''}`;
        
        history.push({
            action: 'Staff Assigned',
            status: 'Assigned',
            actor: assignedBy,
            role: assignedByRole,
            timestamp: now,
            notes: historyNotes
        });

        complaint.technicianId = techId;
        complaint.technicianName = techName;
        complaint.technician = techName;
        complaint.assignedTo = techName;
        complaint.status = 'Assigned';
        complaint.statusHistory = history;
        complaint.updatedAt = now;
        complaintLocalCache.set(complaintId, complaint);

        try {
            await db.query(
                `UPDATE complaints SET status = 'Assigned', "assignedTo" = $1, timeline = $2::jsonb, "updatedAt" = NOW() WHERE id = $3`,
                [techName, JSON.stringify(history), complaintId]
            );
        } catch (pgErr) {}

        const client = getSupabaseClient();
        if (client) {
            try {
                await client
                    .from(this.tableName)
                    .update({ technician_id: techId, technician_name: techName, status: 'Assigned', updated_at: now })
                    .eq('id', complaintId);
            } catch (err) {}
        }

        try {
            await notificationRepository.create({
                recipientId: techId,
                recipientRole: 'technician',
                title: `New Job Assigned: ${complaint.category} (${complaint.priority})`,
                message: `You have been assigned complaint ${complaint.id} at ${complaint.block} Room ${complaint.roomNumber}.${instructions ? ` Notes: ${instructions}` : ''}`,
                type: 'complaint_assigned',
                priority: complaint.priority === 'Emergency' || complaint.priority === 'High' ? 'Emergency' : 'Important',
                metadata: { complaintId, category: complaint.category, priority: complaint.priority, instructions, phone: techPhone }
            });
        } catch (e) {}

        return complaintLocalCache.get(complaintId) || complaint;
    }

    async updateWorkflowStatus(complaintId, options = {}) {
        const {
            status,
            actor = 'Staff',
            role = 'technician',
            remarks = '',
            beforePhoto = '',
            afterPhoto = '',
            rejectionReason = ''
        } = options;

        const complaint = await this.findById(complaintId);
        if (!complaint) throw new Error('Complaint not found.');

        const now = new Date().toISOString();
        const history = Array.isArray(complaint.statusHistory) ? [...complaint.statusHistory] : [];

        let actionLabel = `Status changed to ${status}`;
        if (status === 'Accepted') actionLabel = 'Staff Accepted';
        if (status === 'In Progress') actionLabel = 'Work Started';
        if (status === 'Resolved') actionLabel = 'Complaint Resolved';
        if (status === 'Verified') actionLabel = 'Resolution Verified';
        if (status === 'Reopened') actionLabel = 'Resolution Rejected & Reopened';

        history.push({
            action: actionLabel,
            status,
            actor,
            role,
            timestamp: now,
            notes: remarks || rejectionReason || actionLabel,
            beforePhoto: beforePhoto || complaint.beforePhotoUrl || '',
            afterPhoto: afterPhoto || complaint.afterPhotoUrl || ''
        });

        const beforePhotoUrl = beforePhoto || complaint.beforePhotoUrl || '';
        const afterPhotoUrl = afterPhoto || complaint.afterPhotoUrl || '';
        const resolutionRemarks = remarks || complaint.resolutionRemarks || '';

        complaint.status = status;
        complaint.beforePhotoUrl = beforePhotoUrl;
        complaint.afterPhotoUrl = afterPhotoUrl;
        complaint.resolutionRemarks = resolutionRemarks;
        complaint.statusHistory = history;
        complaint.updatedAt = now;
        complaintLocalCache.set(complaintId, complaint);

        try {
            await db.query(
                `UPDATE complaints SET status = $1, "resolutionNotes" = $2, "beforePhotoUrl" = $3, "afterPhotoUrl" = $4, timeline = $5::jsonb, "updatedAt" = NOW() WHERE id = $6`,
                [status, resolutionRemarks, beforePhotoUrl, afterPhotoUrl, JSON.stringify(history), complaintId]
            );
        } catch (pgErr) {}

        const client = getSupabaseClient();
        if (client) {
            try {
                await client.from(this.tableName).update({ status, updated_at: now }).eq('id', complaintId);
            } catch (err) {}
        }

        return complaintLocalCache.get(complaintId) || complaint;
    }

    async delete(id) {
        if (!id) return false;
        const cleanId = String(id).trim();
        complaintLocalCache.delete(cleanId);

        try {
            await db.query('DELETE FROM complaints WHERE id = $1', [cleanId]);
        } catch (e) {}

        const client = getSupabaseClient();
        if (client) {
            try {
                await client.from(this.tableName).delete().eq('id', cleanId);
            } catch (e) {}
        }
        return true;
    }

    _mapComplaint(row) {
        if (!row) return null;

        let meta = {};
        try {
            if (row.notes && typeof row.notes === 'string' && row.notes.startsWith('{')) {
                meta = JSON.parse(row.notes);
            } else if (row.notes && typeof row.notes === 'object') {
                meta = row.notes;
            }
        } catch (e) {}

        const roomNumber = row.roomNumber || row.room_number || row.room || '';
        const block = row.hostelBlock || row.block || row.hostel_block || 'Block A';
        const floor = meta.floor || (roomNumber.length >= 3 ? roomNumber.slice(0, -2) : '1');

        const initialHistory = [
            {
                action: 'Complaint Created',
                status: row.status || 'Submitted',
                actor: row.student || row.student_name || 'Student',
                role: 'student',
                timestamp: row.createdAt || row.created_at || new Date().toISOString(),
                notes: row.description || 'Initial submission'
            }
        ];

        let timeline = [];
        if (Array.isArray(row.timeline)) {
            timeline = row.timeline;
        } else if (typeof row.timeline === 'string' && row.timeline.startsWith('[')) {
            try { timeline = JSON.parse(row.timeline); } catch (e) {}
        } else if (Array.isArray(meta.status_history) && meta.status_history.length) {
            timeline = meta.status_history;
        } else {
            timeline = initialHistory;
        }

        const studentName = row.student || row.student_name || row.studentName || row.name || 'Resident Student';
        const studentEmail = row.email || row.student_email || row.studentEmail || '';
        const regNo = row.registrationNumber || row.registration_number || '';
        const assignedTo = row.assignedTo || row.technician_name || row.technicianName || row.technician || 'Unassigned';

        return {
            id: row.id,
            title: row.title || `${row.category || 'General'} Issue in ${block} Room ${roomNumber}`,
            description: row.description || row.title || 'Hostel maintenance issue',
            category: row.category || 'General Maintenance',
            priority: row.priority || 'Medium',
            status: row.status || 'Submitted',
            block: block,
            hostelBlock: block,
            floor: floor,
            roomNumber: roomNumber,
            room: roomNumber,
            registrationNumber: regNo,
            studentId: row.student_id || row.studentId || '',
            studentName: studentName,
            student: studentName,
            name: studentName,
            studentEmail: studentEmail,
            email: studentEmail,
            studentPhone: meta.student_phone || row.phone || row.student_phone || '',
            wardenId: meta.warden_id || row.warden_id || row.wardenId || '',
            wardenName: meta.warden_name || row.warden_name || row.wardenName || 'Duty Warden',
            wardenEmail: meta.warden_email || row.warden_email || row.wardenEmail || '',
            technicianId: row.technician_id || row.technicianId || null,
            technicianName: assignedTo,
            technician: assignedTo,
            assignedTo: assignedTo,
            technicianPhone: meta.technician_phone || row.technician_phone || '',
            technicianSpecialization: meta.technician_specialization || row.technician_specialization || '',
            instructions: meta.instructions || row.instructions || '',
            estimatedCompletion: meta.estimated_completion || row.estimated_completion || '',
            photoUrl: row.photo_url || row.photoUrl || row.photo || '',
            evidenceUrl: row.photo_url || row.photoUrl || row.photo || '',
            beforePhotoUrl: row.beforePhotoUrl || meta.before_photo_url || '',
            afterPhotoUrl: row.afterPhotoUrl || meta.after_photo_url || '',
            resolutionRemarks: row.resolutionNotes || meta.resolution_remarks || '',
            preferredTime: meta.preferred_time || row.preferred_time || '',
            verifiedBy: meta.verified_by || row.verified_by || '',
            verifiedAt: meta.verified_at || row.verified_at || '',
            rejectionReason: meta.rejection_reason || row.rejection_reason || '',
            statusHistory: timeline,
            notes: (typeof row.notes === 'string' && !row.notes.startsWith('{')) ? row.notes : (row.description || ''),
            resolvedAt: row.resolved_at || row.resolvedAt || null,
            createdAt: row.createdAt || row.created_at || new Date().toISOString(),
            updatedAt: row.updatedAt || row.updated_at || new Date().toISOString()
        };
    }
}

module.exports = new ComplaintRepository();
