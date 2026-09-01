const crypto = require('crypto');
const { getSupabaseClient } = require('./supabaseClient');
const wardenScopeRepository = require('./wardenScopeRepository');
const wardenPermissionRepository = require('./wardenPermissionRepository');
const studentRepository = require('./studentRepository');

const wardenStatusCache = new Map();
const wardenAdminCache = new Map();

function hashPassword(password) {
    if (!password) return '';
    if (/^[0-9a-f]{64}$/i.test(password) || password.startsWith('$2')) {
        return password;
    }
    return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function verifyPassword(plain, stored) {
    if (!plain || !stored) return false;
    if (plain === stored) return true;
    return hashPassword(plain) === stored;
}

function generateWardenId() {
    return `WRD-${Math.floor(100000 + Math.random() * 900000)}`;
}

function generateTemporaryPassword() {
    const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lowers = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%&*';
    const all = uppers + lowers + digits + symbols;
    let pwd = 'Wrd_';
    pwd += uppers[Math.floor(Math.random() * uppers.length)];
    pwd += lowers[Math.floor(Math.random() * lowers.length)];
    pwd += digits[Math.floor(Math.random() * digits.length)];
    pwd += symbols[Math.floor(Math.random() * symbols.length)];
    for (let i = 0; i < 4; i++) {
        pwd += all[Math.floor(Math.random() * all.length)];
    }
    return pwd;
}

function generateWardenDigitalSignature(wardenData, adminUser = {}) {
    const signedAt = wardenData.signedAt || new Date().toISOString();
    const adminName = adminUser.name || 'System Administrator';
    const adminEmail = adminUser.adminEmail || adminUser.email || 'admin@hostelfix.edu';
    const cleanId = String(wardenData.wardenId || wardenData.userId || 'WRD').trim();
    const rawData = [
        cleanId,
        wardenData.name || wardenData.fullName || '',
        wardenData.email || '',
        wardenData.phone || wardenData.mobileNumber || '',
        wardenData.hostelBlock || wardenData.block || 'Block A',
        wardenData.hostel || 'Main Hostel',
        adminEmail,
        signedAt
    ].join('|');

    const signatureHash = crypto.createHmac('sha256', process.env.GATEPASS_SIGNING_SECRET || 'hostelfix_warden_secure_admin_signature_key_2026')
        .update(rawData)
        .digest('hex');

    const certId = 'HF-WRD-CERT-' + cleanId.replace(/[^a-zA-Z0-9]/g, '') + '-' + signatureHash.slice(0, 6).toUpperCase();
    const shortFingerprint = signatureHash.slice(0, 32).toUpperCase().match(/.{4}/g).join('-');

    return {
        certificateId: certId,
        signedBy: adminName,
        adminEmail: adminEmail,
        endorsedByRole: 'System Administrator',
        signedAt: signedAt,
        signatureAlgorithm: 'HMAC-SHA256',
        signatureHash: signatureHash,
        fingerprint: shortFingerprint,
        status: 'VERIFIED & APPROVED',
        issuer: 'HostelFix Central Administration Authority',
        approvalStamp: 'OFFICIALLY ENDORSED & DIGITALLY SIGNED',
        verificationUrl: `/api/admin/wardens/${encodeURIComponent(cleanId)}/digital-id`
    };
}

class WardenRepository {
    constructor() {
        this.tableName = 'users';
    }

    generateId() {
        return generateWardenId();
    }

    generateTempPassword() {
        return generateTemporaryPassword();
    }

    generateWardenDigitalSignature(wardenData, adminUser = {}) {
        return generateWardenDigitalSignature(wardenData, adminUser);
    }

    async getAllWardens() {
        const client = getSupabaseClient();
        if (!client) return [];

        let data = null;
        try {
            const { data: queryData, error } = await client
                .from(this.tableName)
                .select('*')
                .ilike('role', 'warden')
                .order('created_at', { ascending: false });

            if (!error && queryData) {
                data = queryData;
            } else if (error) {
                console.warn('[WardenRepository] ilike query failed, trying exact eq query:', error.message);
                const { data: eqData, error: eqErr } = await client
                    .from(this.tableName)
                    .select('*')
                    .eq('role', 'warden')
                    .order('created_at', { ascending: false });
                if (!eqErr && eqData) data = eqData;
            }
        } catch (err) {
            console.error('[WardenRepository] Fetch error:', err);
        }

        if (!data) data = [];

        const wardens = await Promise.all(
            data.map(async (row) => {
                const warden = this._mapWarden(row);
                if (!warden) return null;
                warden.scope = await wardenScopeRepository.getScopeForWarden(warden.userId || warden.email);
                warden.permissions = await wardenPermissionRepository.getPermissions(warden.userId || warden.email);
                const assignedStudents = await studentRepository.getByScope(warden.scope);
                warden.studentCount = assignedStudents.length;
                warden.assignedStudentsCount = assignedStudents.length;
                return warden;
            })
        );

        return wardens.filter(Boolean);
    }

    async getWardensByAdmin(adminIdOrEmail) {
        const wardens = await this.getAllWardens();
        if (!adminIdOrEmail) return wardens;

        const cleanAdmin = String(adminIdOrEmail).trim().toLowerCase();
        return wardens.filter(w => {
            const wAdminId = String(w.adminId || '').trim().toLowerCase();
            const wAdminEmail = String(w.adminEmail || '').trim().toLowerCase();
            return !wAdminId || wAdminId === cleanAdmin || wAdminEmail === cleanAdmin;
        });
    }

    async getWardenById(id) {
        const client = getSupabaseClient();
        if (!client || !id) return null;

        const cleanId = String(id).trim();
        let query = client.from(this.tableName).select('*').eq('role', 'warden');

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
        if (cleanId.includes('@')) {
            query = query.ilike('email', cleanId);
        } else if (isUuid) {
            query = query.or(`user_id.eq.${cleanId},id.eq.${cleanId}`);
        } else {
            query = query.eq('user_id', cleanId);
        }

        const { data, error } = await query.maybeSingle();
        if (error) throw error;
        if (!data) return null;

        const warden = this._mapWarden(data);
        warden.scope = await wardenScopeRepository.getScopeForWarden(warden.userId || warden.email);
        warden.permissions = await wardenPermissionRepository.getPermissions(warden.userId || warden.email);
        const assignedStudents = await studentRepository.getByScope(warden.scope);
        warden.studentCount = assignedStudents.length;
        warden.assignedStudentsCount = assignedStudents.length;
        warden.assignedStudents = assignedStudents;
        return warden;
    }

    async getWardenStudents(id) {
        const warden = await this.getWardenById(id);
        if (!warden) return [];
        return await studentRepository.getByScope(warden.scope);
    }

    async createWarden(wardenData) {
        const client = getSupabaseClient();
        if (!client) return null;

        const userId = wardenData.wardenId || wardenData.customId || wardenData.userId || generateWardenId();
        const email = String(wardenData.email || '').trim().toLowerCase();
        const finalName = String(wardenData.name || wardenData.fullName || '').trim();
        const tempPassword = String(wardenData.password || generateTemporaryPassword());
        const hashedPassword = hashPassword(tempPassword);
        const status = wardenData.status ? (wardenData.status.charAt(0).toUpperCase() + wardenData.status.slice(1).toLowerCase()) : 'Active';

        wardenStatusCache.set(userId, status);
        wardenStatusCache.set(email, status);
        if (wardenData.adminId) wardenAdminCache.set(userId, { adminId: wardenData.adminId, adminEmail: wardenData.adminEmail || '' });

        // Supabase Auth Integration: create auth user
        let authUserId = '';
        if (client && client.auth && client.auth.admin) {
            try {
                const { data: authData, error: authError } = await client.auth.admin.createUser({
                    email: email,
                    password: tempPassword,
                    email_confirm: true,
                    user_metadata: {
                        role: 'warden',
                        name: finalName,
                        wardenId: userId,
                        must_change_password: true
                    }
                });
                if (!authError && authData && authData.user) {
                    authUserId = authData.user.id;
                }
            } catch (authErr) {
                // If user already exists in Auth or service role key has limitations, continue safely
            }
        }

        const adminUser = wardenData.adminUser || {};
        const adminSignature = generateWardenDigitalSignature({
            wardenId: userId,
            name: finalName,
            email: email,
            phone: String(wardenData.phone || wardenData.mobileNumber || '').trim(),
            hostelBlock: wardenData.hostelBlock || wardenData.block || 'Block A',
            hostel: wardenData.hostel || 'Main Hostel',
            gender: wardenData.gender || '',
            status: status
        }, {
            adminId: wardenData.adminId || adminUser.id || '',
            adminEmail: wardenData.adminEmail || adminUser.email || adminUser.adminEmail || 'admin@hostelfix.edu',
            name: wardenData.adminName || adminUser.name || 'System Administrator'
        });

        // Encode optional profile fields and auth metadata
        const meta = {
            auth_user_id: authUserId,
            must_change_password: true,
            gender: wardenData.gender || '',
            address: wardenData.address || '',
            emergencyContact: wardenData.emergencyContact || '',
            profilePhoto: wardenData.profilePhoto || '',
            hostel: wardenData.hostel || 'Main Hostel',
            adminSignature: adminSignature
        };
        const specialization = JSON.stringify(meta);

        const dbPayload = {
            user_id: userId,
            email: email,
            password: hashedPassword,
            name: finalName,
            role: 'warden',
            room_number: wardenData.roomNumber || '',
            block: wardenData.hostelBlock || wardenData.block || 'Block A',
            phone: String(wardenData.phone || wardenData.mobileNumber || '').trim(),
            specialization: specialization
        };

        let insertedData = null;

        // Try with status, admin_id, admin_email columns
        try {
            const { data, error } = await client
                .from(this.tableName)
                .insert([{ ...dbPayload, status, admin_id: wardenData.adminId || '', admin_email: wardenData.adminEmail || '' }])
                .select()
                .single();
            if (!error && data) insertedData = data;
        } catch (e) {}

        // Fallback: try with status only
        if (!insertedData) {
            try {
                const { data, error } = await client
                    .from(this.tableName)
                    .insert([{ ...dbPayload, status }])
                    .select()
                    .single();
                if (!error && data) insertedData = data;
            } catch (e) {}
        }

        // Fallback: basic payload
        if (!insertedData) {
            const { data, error } = await client
                .from(this.tableName)
                .insert([dbPayload])
                .select()
                .single();
            if (error) throw error;
            insertedData = data;
        }

        const warden = this._mapWarden(insertedData);
        warden.temporaryPassword = tempPassword; // Single-use return for admin success modal
        warden.mustChangePassword = true;

        // Create Scope
        const scopePayload = {
            hostel: wardenData.hostel || 'Main Hostel',
            block: wardenData.hostelBlock || wardenData.block || 'Block A',
            floors: wardenData.floors || 'All',
            rooms: wardenData.rooms || 'All',
            isActive: status !== 'Inactive'
        };
        warden.scope = await wardenScopeRepository.saveWardenScope(userId, scopePayload);

        // Create Permissions
        const perms = Array.isArray(wardenData.permissions) ? wardenData.permissions : wardenPermissionRepository.DEFAULT_WARDEN_PERMISSIONS;
        warden.permissions = await wardenPermissionRepository.setPermissions(userId, perms);

        const assignedStudents = await studentRepository.getByScope(warden.scope);
        warden.studentCount = assignedStudents.length;
        warden.assignedStudentsCount = assignedStudents.length;

        return warden;
    }

    async updateWarden(id, updates) {
        const client = getSupabaseClient();
        if (!client || !id) return null;

        const warden = await this.getWardenById(id);
        if (!warden) return null;

        const previousUserId = String(warden.userId || id).trim();
        const nextUserId = String(updates.wardenId || updates.userId || previousUserId).trim();
        if (!nextUserId) return null;

        const dbPayload = {};

        if (updates.status !== undefined) {
            const normalized = updates.status.charAt(0).toUpperCase() + updates.status.slice(1).toLowerCase();
            wardenStatusCache.set(warden.userId, normalized);
            wardenStatusCache.set(warden.email, normalized);
            try {
                const userRepository = require('./userRepository');
                userRepository.setStatus(warden.userId, normalized);
                userRepository.setStatus(warden.email, normalized);
            } catch (e) {}
            dbPayload.status = normalized;
        }
        if (nextUserId !== previousUserId) {
            const { data: conflictingUser } = await client
                .from(this.tableName)
                .select('user_id')
                .eq('user_id', nextUserId)
                .maybeSingle();
            if (conflictingUser) {
                throw new Error(`Warden ID '${nextUserId}' is already assigned to another user.`);
            }
            dbPayload.user_id = nextUserId;
            // Keep scope and RBAC ownership attached to the renamed account.
            try {
                await client.from('warden_scopes').update({ warden_id: nextUserId }).eq('warden_id', previousUserId);
            } catch (e) {}
            try {
                await client.from('warden_permissions').update({ warden_id: nextUserId }).eq('warden_id', previousUserId);
            } catch (e) {}
            wardenStatusCache.set(nextUserId, warden.status || 'Active');
            wardenStatusCache.delete(previousUserId);
        }
        if (updates.name !== undefined) dbPayload.name = updates.name.trim();
        if (updates.fullName !== undefined) dbPayload.name = updates.fullName.trim();
        if (updates.email !== undefined) dbPayload.email = updates.email.trim().toLowerCase();
        if (updates.password !== undefined && updates.password.trim().length > 0) {
            dbPayload.password = hashPassword(String(updates.password).trim());
        }
        if (updates.phone !== undefined) dbPayload.phone = updates.phone.trim();
        if (updates.mobileNumber !== undefined) dbPayload.phone = updates.mobileNumber.trim();
        if (updates.hostelBlock !== undefined || updates.block !== undefined) {
            dbPayload.block = updates.hostelBlock || updates.block;
        }

        const meta = {
            auth_user_id: warden.authUserId || '',
            must_change_password: warden.mustChangePassword,
            gender: updates.gender !== undefined ? updates.gender : (warden.gender || ''),
            address: updates.address !== undefined ? updates.address : (warden.address || ''),
            emergencyContact: updates.emergencyContact !== undefined ? updates.emergencyContact : (warden.emergencyContact || ''),
            profilePhoto: updates.profilePhoto !== undefined ? updates.profilePhoto : (warden.profilePhoto || ''),
            hostel: updates.hostel !== undefined ? updates.hostel : (warden.scope?.hostel || 'Main Hostel'),
            adminSignature: warden.adminSignature || generateWardenDigitalSignature(warden, { adminId: warden.adminId, adminEmail: warden.adminEmail })
        };
        dbPayload.specialization = JSON.stringify(meta);

        if (Object.keys(dbPayload).length > 0) {
            try {
                let { error } = await client.from(this.tableName).update(dbPayload).eq('user_id', previousUserId);
                // Older deployments may not have the optional status column yet.
                if (error && error.code === 'PGRST204' && Object.prototype.hasOwnProperty.call(dbPayload, 'status')) {
                    const withoutStatus = { ...dbPayload };
                    delete withoutStatus.status;
                    ({ error } = await client.from(this.tableName).update(withoutStatus).eq('user_id', previousUserId));
                }
                if (error) throw error;
            } catch (e) {
                console.warn('[WardenRepository] Update warning:', e.message);
                throw e;
            }
        }

        // Keep the Supabase Auth identity in sync when the administrator edits it.
        if (warden.authUserId && client.auth && client.auth.admin && (updates.email || updates.password)) {
            try {
                const authUpdates = {};
                if (updates.email) authUpdates.email = String(updates.email).trim().toLowerCase();
                if (updates.password && String(updates.password).trim()) authUpdates.password = String(updates.password).trim();
                if (Object.keys(authUpdates).length) await client.auth.admin.updateUserById(warden.authUserId, authUpdates);
            } catch (e) {
                console.warn('[WardenRepository] Auth identity update warning:', e.message);
            }
        }

        // Update Scope if provided
        if (updates.scope || updates.hostel || updates.floors || updates.rooms || updates.hostelBlock || updates.block || updates.status) {
            const currentScope = warden.scope || {};
            const scopeUpdates = {
                hostel: updates.hostel || updates.scope?.hostel || currentScope.hostel || 'Main Hostel',
                block: updates.hostelBlock || updates.block || updates.scope?.block || currentScope.block || 'Block A',
                floors: updates.floors || updates.scope?.floors || currentScope.floors || 'All',
                rooms: updates.rooms || updates.scope?.rooms || currentScope.rooms || 'All',
                isActive: updates.status ? updates.status !== 'Inactive' : (updates.scope?.isActive !== false)
            };
            warden.scope = await wardenScopeRepository.saveWardenScope(nextUserId, scopeUpdates);
        }

        // Update Permissions if provided
        if (updates.permissions && Array.isArray(updates.permissions)) {
            warden.permissions = await wardenPermissionRepository.setPermissions(nextUserId, updates.permissions);
        }

        return await this.getWardenById(nextUserId);
    }

    async deleteWarden(id) {
        const client = getSupabaseClient();
        if (!client || !id) return false;

        const warden = await this.getWardenById(id);
        if (!warden) return false;

        wardenStatusCache.delete(warden.userId);
        wardenStatusCache.delete(warden.email);
        wardenAdminCache.delete(warden.userId);
        try {
            const userRepository = require('./userRepository');
            userRepository.deleteStatus(warden.userId);
            userRepository.deleteStatus(warden.email);
        } catch (e) {}

        const { error } = await client
            .from(this.tableName)
            .delete()
            .eq('user_id', warden.userId);

        if (error) throw error;
        return true;
    }

    async updatePassword(idOrEmail, newPassword) {
        const client = getSupabaseClient();
        if (!client || !idOrEmail || !newPassword) return null;

        const warden = await this.getWardenById(idOrEmail);
        if (!warden) return null;

        const hashedPassword = hashPassword(newPassword);

        // Update in Supabase Auth if auth_user_id exists
        if (warden.authUserId && client.auth && client.auth.admin) {
            try {
                await client.auth.admin.updateUserById(warden.authUserId, {
                    password: newPassword,
                    user_metadata: { must_change_password: false }
                });
            } catch (e) {}
        }

        // Update in PostgreSQL
        const meta = {
            auth_user_id: warden.authUserId || '',
            must_change_password: false,
            gender: warden.gender || '',
            address: warden.address || '',
            emergencyContact: warden.emergencyContact || '',
            profilePhoto: warden.profilePhoto || ''
        };

        const dbPayload = {
            password: hashedPassword,
            specialization: JSON.stringify(meta)
        };

        try {
            await client.from(this.tableName).update(dbPayload).eq('user_id', warden.userId);
        } catch (e) {
            console.warn('[WardenRepository] Password update warning:', e.message);
        }

        return await this.getWardenById(warden.userId);
    }

    _mapWarden(row) {
        if (!row) return null;
        const userId = row.user_id || row.userId || row.id || ('WRD-' + Math.floor(100000 + Math.random() * 900000));
        const email = row.email || '';
        const cachedStatus = wardenStatusCache.get(userId) || (email ? wardenStatusCache.get(email) : null);
        const cachedAdmin = wardenAdminCache.get(userId) || {};
        const status = cachedStatus || (row.status ? (row.status.charAt(0).toUpperCase() + row.status.slice(1).toLowerCase()) : 'Active');

        let meta = {};
        try {
            if (row.specialization && typeof row.specialization === 'string' && row.specialization.startsWith('{')) {
                meta = JSON.parse(row.specialization);
            } else if (row.specialization && typeof row.specialization === 'object') {
                meta = row.specialization;
            }
        } catch (e) {}

        const mustChangePassword = Boolean(
            meta.must_change_password === true ||
            meta.mustChangePassword === true ||
            row.must_change_password === true
        );

        const name = row.name || row.full_name || row.fullName || 'Warden';
        const block = row.block || row.hostel_block || row.hostelBlock || meta.block || 'Block A';
        const phone = row.phone || row.mobile_number || row.mobile || row.mobileNumber || '';
        const adminSignature = meta.adminSignature || generateWardenDigitalSignature({
            wardenId: userId,
            name,
            email,
            phone,
            block,
            hostel: meta.hostel || 'Main Hostel',
            signedAt: row.created_at || new Date().toISOString()
        }, {
            adminId: row.admin_id || cachedAdmin.adminId || '',
            adminEmail: row.admin_email || cachedAdmin.adminEmail || 'admin@hostelfix.edu'
        });

        return {
            id: userId,
            userId: userId,
            wardenId: userId,
            email: email,
            password: row.password,
            name: name,
            fullName: name,
            role: 'warden',
            hostelBlock: block,
            block: block,
            phone: phone,
            mobileNumber: phone,
            roomNumber: row.room_number || row.roomNumber || '',
            status: status,
            authUserId: meta.auth_user_id || row.auth_user_id || '',
            mustChangePassword: mustChangePassword,
            gender: row.gender || meta.gender || '',
            address: row.address || meta.address || '',
            emergencyContact: row.emergency_contact || row.emergencyContact || meta.emergencyContact || '',
            profilePhoto: row.profile_photo || row.profilePhoto || meta.profilePhoto || '',
            adminSignature: adminSignature,
            adminId: row.admin_id || cachedAdmin.adminId || '',
            adminEmail: row.admin_email || cachedAdmin.adminEmail || '',
            createdAt: row.created_at || new Date().toISOString(),
            updatedAt: row.updated_at || new Date().toISOString()
        };
    }
}

module.exports = new WardenRepository();
