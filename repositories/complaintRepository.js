const { getSupabaseClient } = require('./supabaseClient');
const wardenRepository = require('./wardenRepository');
const wardenScopeRepository = require('./wardenScopeRepository');
const notificationRepository = require('./notificationRepository');

// In-memory fallback cache for complaints if Supabase is temporarily unreachable or offline
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
                console.warn('[ComplaintRepository] GetAll fallback:', error.message);
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

    /**
     * Automatic Warden Resolution for a given Block / Floor / Room
     */
    async resolveResponsibleWarden(block = 'Block A', floor = '', room = '') {
        try {
            const allWardens = await wardenRepository.getAllWardens();
            const activeWardens = allWardens.filter(w => w.status !== 'Inactive');
            if (!activeWardens.length) return null;

            const cleanBlock = String(block || 'Block A').trim().toLowerCase().replace(/^block-?/, '');

            // 1. Check wardens with matching block in their scope
            for (const warden of activeWardens) {
                const scope = warden.scope || {};
                const scopeBlock = String(scope.block || warden.hostelBlock || warden.block || 'All').trim().toLowerCase().replace(/^block-?/, '');
                if (scopeBlock === cleanBlock || scopeBlock === 'all') {
                    return warden;
                }
            }

            // 2. Direct block property match
            const directMatch = activeWardens.find(w => {
                const wBlock = String(w.hostelBlock || w.block || '').trim().toLowerCase().replace(/^block-?/, '');
                return wBlock === cleanBlock;
            });
            if (directMatch) return directMatch;

            // 3. Fallback to first active warden
            return activeWardens[0];
        } catch (e) {
            console.warn('[ComplaintRepository] Warden resolution warning:', e.message);
            return null;
        }
    }

    async create(complaintData) {
        const client = getSupabaseClient();
        const id = complaintData.id || generateComplaintId();
        const now = new Date().toISOString();

        const block = complaintData.block || complaintData.hostelBlock || 'Block A';
        const roomNumber = complaintData.roomNumber || complaintData.room || '101';
        const floor = complaintData.floor || (roomNumber.length >= 3 ? roomNumber.slice(0, -2) : '1');
        const category = complaintData.category || 'General';
        const priority = complaintData.priority ? (complaintData.priority.charAt(0).toUpperCase() + complaintData.priority.slice(1).toLowerCase()) : 'Medium';
        const title = complaintData.title || `${category} issue in ${block}, Room ${roomNumber}`;
        const description = complaintData.description || title;
        const studentId = complaintData.studentId || complaintData.userId || '';
        const studentName = complaintData.studentName || complaintData.student || complaintData.name || 'Resident Student';
        const studentEmail = (complaintData.studentEmail || complaintData.email || '').trim().toLowerCase();
        const studentPhone = complaintData.studentPhone || complaintData.phone || '';
        const photoUrl = complaintData.photoUrl || complaintData.photo || complaintData.evidenceUrl || '';
        const preferredTime = complaintData.preferredTime || complaintData.preferred_time || '';

        // Auto-resolve responsible block warden
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

        const meta = {
            preferred_time: preferredTime,
            student_phone: studentPhone,
            floor: floor,
            warden_id: wardenId,
            warden_name: wardenName,
            warden_email: wardenEmail,
            before_photo_url: '',
            after_photo_url: '',
            resolution_remarks: '',
            verified_by: '',
            verified_at: '',
            rejection_reason: '',
            status_history: initialHistory
        };

        const dbPayload = {
            id,
            title,
            description,
            category,
            priority,
            status: 'Submitted',
            block,
            room_number: roomNumber,
            student_id: studentId,
            student_name: studentName,
            student_email: studentEmail,
            technician_id: null,
            technician_name: 'Unassigned',
            photo_url: photoUrl,
            notes: JSON.stringify(meta)
        };

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

        if (client) {
            try {
                const { data, error } = await client
                    .from(this.tableName)
                    .insert([dbPayload])
                    .select()
                    .single();

                if (!error && data) {
                    const mapped = this._mapComplaint(data);
                    complaintLocalCache.set(id, mapped);
                }
            } catch (err) {
                console.warn('[ComplaintRepository] Supabase insert fallback to cache:', err.message);
            }
        }

        // Send automatic notification to responsible Warden
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
            } catch (notifErr) {
                console.warn('[Notification Error]', notifErr);
            }
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

        const meta = {
            preferred_time: complaint.preferredTime || '',
            student_phone: complaint.studentPhone || '',
            floor: complaint.floor || '',
            warden_id: complaint.wardenId || '',
            warden_name: complaint.wardenName || '',
            warden_email: complaint.wardenEmail || '',
            technician_phone: techPhone,
            technician_specialization: techSpecialization,
            instructions: instructions,
            estimated_completion: estimatedCompletion,
            before_photo_url: complaint.beforePhotoUrl || '',
            after_photo_url: complaint.afterPhotoUrl || '',
            resolution_remarks: complaint.resolutionRemarks || '',
            verified_by: complaint.verifiedBy || '',
            verified_at: complaint.verifiedAt || '',
            rejection_reason: '',
            status_history: history
        };

        const updates = {
            technician_id: techId,
            technician_name: techName,
            status: 'Assigned',
            notes: JSON.stringify(meta),
            updated_at: now
        };

        complaint.technicianId = techId;
        complaint.technicianName = techName;
        complaint.technician = techName;
        complaint.assignedTo = techName;
        complaint.technicianPhone = techPhone;
        complaint.technicianSpecialization = techSpecialization;
        complaint.instructions = instructions;
        complaint.estimatedCompletion = estimatedCompletion;
        complaint.status = 'Assigned';
        complaint.statusHistory = history;
        complaint.updatedAt = now;
        complaintLocalCache.set(complaintId, complaint);

        const client = getSupabaseClient();
        if (client) {
            try {
                const { data, error } = await client
                    .from(this.tableName)
                    .update(updates)
                    .eq('id', complaintId)
                    .select()
                    .single();

                if (!error && data) {
                    const mapped = this._mapComplaint(data);
                    complaintLocalCache.set(complaintId, mapped);
                }
            } catch (err) {
                console.warn('[ComplaintRepository] Supabase assignStaff update warning:', err.message);
            }
        }

        // Notify assigned staff / technician
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
        const resolvedAt = status === 'Resolved' || status === 'Verified' ? (complaint.resolvedAt || now) : (status === 'Reopened' ? null : complaint.resolvedAt);
        const verifiedBy = status === 'Verified' ? actor : (status === 'Reopened' ? '' : complaint.verifiedBy);
        const verifiedAt = status === 'Verified' ? now : (status === 'Reopened' ? '' : complaint.verifiedAt);
        const finalRejectionReason = rejectionReason || (status === 'Verified' ? '' : complaint.rejectionReason);

        const meta = {
            preferred_time: complaint.preferredTime || '',
            student_phone: complaint.studentPhone || '',
            floor: complaint.floor || '',
            warden_id: complaint.wardenId || '',
            warden_name: complaint.wardenName || '',
            warden_email: complaint.wardenEmail || '',
            before_photo_url: beforePhotoUrl,
            after_photo_url: afterPhotoUrl,
            resolution_remarks: resolutionRemarks,
            verified_by: verifiedBy,
            verified_at: verifiedAt,
            rejection_reason: finalRejectionReason,
            status_history: history
        };

        const updates = {
            status,
            notes: JSON.stringify(meta),
            resolved_at: resolvedAt,
            updated_at: now
        };

        complaint.status = status;
        complaint.beforePhotoUrl = beforePhotoUrl;
        complaint.afterPhotoUrl = afterPhotoUrl;
        complaint.resolutionRemarks = resolutionRemarks;
        complaint.verifiedBy = verifiedBy;
        complaint.verifiedAt = verifiedAt;
        complaint.rejectionReason = finalRejectionReason;
        complaint.resolvedAt = resolvedAt;
        complaint.statusHistory = history;
        complaint.updatedAt = now;
        complaintLocalCache.set(complaintId, complaint);

        const client = getSupabaseClient();
        if (client) {
            try {
                const { data, error } = await client
                    .from(this.tableName)
                    .update(updates)
                    .eq('id', complaintId)
                    .select()
                    .single();

                if (!error && data) {
                    const mapped = this._mapComplaint(data);
                    complaintLocalCache.set(complaintId, mapped);
                }
            } catch (err) {
                console.warn('[ComplaintRepository] Supabase updateWorkflowStatus warning:', err.message);
            }
        }

        // Trigger dynamic workflow notifications
        try {
            if (status === 'Accepted') {
                // Notify warden
                if (complaint.wardenEmail || complaint.wardenId) {
                    await notificationRepository.create({
                        recipientId: complaint.wardenId,
                        recipientEmail: complaint.wardenEmail,
                        recipientRole: 'warden',
                        title: `Job Accepted: ${complaint.id}`,
                        message: `Technician ${complaint.technicianName} accepted complaint for ${complaint.block} Room ${complaint.roomNumber}.`,
                        type: 'complaint_accepted',
                        priority: 'Normal',
                        metadata: { complaintId }
                    });
                }
            } else if (status === 'In Progress') {
                // Notify Student and Warden
                if (complaint.studentEmail || complaint.studentId) {
                    await notificationRepository.create({
                        recipientId: complaint.studentId,
                        recipientEmail: complaint.studentEmail,
                        recipientRole: 'student',
                        title: `Work In Progress: Complaint ${complaint.id}`,
                        message: `Technician ${complaint.technicianName} has started maintenance work for your issue.`,
                        type: 'complaint_in_progress',
                        priority: 'Normal',
                        metadata: { complaintId }
                    });
                }
                if (complaint.wardenEmail || complaint.wardenId) {
                    await notificationRepository.create({
                        recipientId: complaint.wardenId,
                        recipientEmail: complaint.wardenEmail,
                        recipientRole: 'warden',
                        title: `Work Started: ${complaint.id}`,
                        message: `Technician ${complaint.technicianName} started work at ${complaint.block} Room ${complaint.roomNumber}.`,
                        type: 'complaint_in_progress',
                        priority: 'Normal',
                        metadata: { complaintId }
                    });
                }
            } else if (status === 'Resolved') {
                // Notify Warden to verify resolution
                if (complaint.wardenEmail || complaint.wardenId) {
                    await notificationRepository.create({
                        recipientId: complaint.wardenId,
                        recipientEmail: complaint.wardenEmail,
                        recipientRole: 'warden',
                        title: `Verification Needed: Complaint ${complaint.id}`,
                        message: `Technician ${complaint.technicianName} resolved the issue with photos. Please verify.`,
                        type: 'complaint_resolved',
                        priority: 'Important',
                        metadata: { complaintId }
                    });
                }
            } else if (status === 'Verified') {
                // Notify Student of final resolution
                if (complaint.studentEmail || complaint.studentId) {
                    await notificationRepository.create({
                        recipientId: complaint.studentId,
                        recipientEmail: complaint.studentEmail,
                        recipientRole: 'student',
                        title: `Complaint Closed & Verified: ${complaint.id}`,
                        message: `Your complaint (${complaint.title}) has been resolved and verified by Warden ${complaint.wardenName || actor}.`,
                        type: 'complaint_verified',
                        priority: 'Normal',
                        metadata: { complaintId }
                    });
                }
            } else if (status === 'Reopened') {
                // Notify Assigned Staff
                if (complaint.technicianId) {
                    await notificationRepository.create({
                        recipientId: complaint.technicianId,
                        recipientRole: 'technician',
                        title: `Resolution Rejected: Complaint ${complaint.id}`,
                        message: `Warden rejected the resolution: "${rejectionReason || 'Requires rework'}". Please re-inspect.`,
                        type: 'complaint_reopened',
                        priority: 'Emergency',
                        metadata: { complaintId, rejectionReason }
                    });
                }
            }
        } catch (notifErr) {
            console.warn('[Notification Workflow Error]', notifErr);
        }

        return complaintLocalCache.get(complaintId) || complaint;
    }

    async delete(id) {
        if (!id) return false;
        const cleanId = String(id).trim();
        complaintLocalCache.delete(cleanId);

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

        const roomNumber = row.room_number || row.roomNumber || row.room || '';
        const block = row.block || row.hostelBlock || row.hostel_block || 'Block A';
        const floor = meta.floor || (roomNumber.length >= 3 ? roomNumber.slice(0, -2) : '1');

        const initialHistory = [
            {
                action: 'Complaint Created',
                status: row.status || 'Submitted',
                actor: row.student_name || 'Student',
                role: 'student',
                timestamp: row.created_at || new Date().toISOString(),
                notes: row.description || 'Initial submission'
            }
        ];

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
            studentId: row.student_id || row.studentId || '',
            studentName: row.student_name || row.studentName || row.name || 'Resident Student',
            student: row.student_name || row.studentName || row.name || 'Resident Student',
            name: row.student_name || row.studentName || row.name || 'Resident Student',
            studentEmail: row.student_email || row.studentEmail || row.email || '',
            email: row.student_email || row.studentEmail || row.email || '',
            studentPhone: meta.student_phone || row.phone || row.student_phone || '',
            wardenId: meta.warden_id || row.warden_id || row.wardenId || '',
            wardenName: meta.warden_name || row.warden_name || row.wardenName || 'Duty Warden',
            wardenEmail: meta.warden_email || row.warden_email || row.wardenEmail || '',
            technicianId: row.technician_id || row.technicianId || null,
            technicianName: row.technician_name || row.technicianName || row.technician || 'Unassigned',
            technician: row.technician_name || row.technicianName || row.technician || 'Unassigned',
            assignedTo: row.technician_name || row.technicianName || row.technician || 'Unassigned',
            technicianPhone: meta.technician_phone || row.technician_phone || '',
            technicianSpecialization: meta.technician_specialization || row.technician_specialization || '',
            instructions: meta.instructions || row.instructions || '',
            estimatedCompletion: meta.estimated_completion || row.estimated_completion || '',
            photoUrl: row.photo_url || row.photoUrl || row.photo || '',
            evidenceUrl: row.photo_url || row.photoUrl || row.photo || '',
            beforePhotoUrl: meta.before_photo_url || row.before_photo_url || '',
            afterPhotoUrl: meta.after_photo_url || row.after_photo_url || '',
            resolutionRemarks: meta.resolution_remarks || row.resolution_remarks || '',
            preferredTime: meta.preferred_time || row.preferred_time || '',
            verifiedBy: meta.verified_by || row.verified_by || '',
            verifiedAt: meta.verified_at || row.verified_at || '',
            rejectionReason: meta.rejection_reason || row.rejection_reason || '',
            statusHistory: Array.isArray(meta.status_history) && meta.status_history.length ? meta.status_history : initialHistory,
            notes: (typeof row.notes === 'string' && !row.notes.startsWith('{')) ? row.notes : (row.description || ''),
            resolvedAt: row.resolved_at || row.resolvedAt || null,
            createdAt: row.created_at || row.createdAt || new Date().toISOString(),
            updatedAt: row.updated_at || row.updatedAt || new Date().toISOString()
        };
    }
}

module.exports = new ComplaintRepository();

