const crypto = require('crypto');
const { getSupabaseClient } = require('./supabaseClient');
const wardenScopeRepository = require('./wardenScopeRepository');
const wardenPermissionRepository = require('./wardenPermissionRepository');
const studentRepository = require('./studentRepository');
const db = require('../db');

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
        let data = null;

        try {
            const res = await db.query("SELECT * FROM users WHERE LOWER(role) = 'warden' ORDER BY created_at DESC");
            if (res.rows && res.rows.length > 0) {
                data = res.rows;
            }
        } catch (e) {}

        if (!data) {
            const client = getSupabaseClient();
            if (client) {
                try {
                    const { data: queryData, error } = await client
                        .from(this.tableName)
                        .select('*')
                        .ilike('role', 'warden')
                        .order('created_at', { ascending: false });

                    if (!error && queryData) data = queryData;
                } catch (err) {}
            }
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
        if (!id) return null;
        const cleanId = String(id).trim();

        let rowData = null;

        try {
            const res = await db.query(
                `SELECT * FROM users WHERE LOWER(role) = 'warden' AND (LOWER("userId") = LOWER($1) OR LOWER(email) = LOWER($1)) LIMIT 1`,
                [cleanId]
            );
            if (res.rows && res.rows.length > 0) {
                rowData = res.rows[0];
            }
        } catch (e) {}

        if (!rowData) {
            const client = getSupabaseClient();
            if (client) {
                let query = client.from(this.tableName).select('*').eq('role', 'warden');
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
                if (cleanId.includes('@')) {
                    query = query.ilike('email', cleanId);
                } else if (isUuid) {
                    query = query.or(`user_id.eq.${cleanId},id.eq.${cleanId}`);
                } else {
                    query = query.eq('user_id', cleanId);
                }

                try {
                    const { data, error } = await query.maybeSingle();
                    if (!error && data) rowData = data;
                } catch (err) {}
            }
        }

        if (!rowData) return null;

        const warden = this._mapWarden(rowData);
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
        const userId = wardenData.wardenId || wardenData.customId || wardenData.userId || generateWardenId();
        const email = String(wardenData.email || '').trim().toLowerCase();
        const finalName = String(wardenData.name || wardenData.fullName || '').trim();
        const tempPassword = String(wardenData.password || generateTemporaryPassword());
        const hashedPassword = hashPassword(tempPassword);
        const status = wardenData.status ? (wardenData.status.charAt(0).toUpperCase() + wardenData.status.slice(1).toLowerCase()) : 'Active';

        wardenStatusCache.set(userId, status);
        wardenStatusCache.set(email, status);

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

        const meta = {
            auth_user_id: '',
            must_change_password: true,
            gender: wardenData.gender || '',
            address: wardenData.address || '',
            emergencyContact: wardenData.emergencyContact || '',
            profilePhoto: wardenData.profilePhoto || '',
            hostel: wardenData.hostel || 'Main Hostel',
            adminSignature: adminSignature
        };
        const specialization = JSON.stringify(meta);

        let insertedRow = null;

        try {
            const res = await db.query(
                `INSERT INTO users ("userId", email, password, name, role, status, phone, "hostelBlock", "roomNumber", specialization, must_change_password)
                 VALUES ($1, $2, $3, $4, 'warden', $5, $6, $7, $8, $9, TRUE)
                 ON CONFLICT (email) DO UPDATE SET
                    "userId" = EXCLUDED."userId",
                    name = EXCLUDED.name,
                    status = EXCLUDED.status,
                    phone = EXCLUDED.phone,
                    "hostelBlock" = EXCLUDED."hostelBlock",
                    specialization = EXCLUDED.specialization,
                    must_change_password = EXCLUDED.must_change_password
                 RETURNING *`,
                [userId, email, hashedPassword, finalName, status, String(wardenData.phone || wardenData.mobileNumber || '').trim(), wardenData.hostelBlock || wardenData.block || 'Block A', wardenData.roomNumber || '', specialization]
            );
            if (res.rows && res.rows.length > 0) {
                insertedRow = res.rows[0];
            }
        } catch (pgErr) {
            console.error('[WardenRepository PostgreSQL Create Error]', pgErr.message);
        }

        const client = getSupabaseClient();
        if (!insertedRow && client) {
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
            try {
                const { data } = await client.from(this.tableName).insert([{ ...dbPayload, status }]).select().single();
                if (data) insertedRow = data;
            } catch (e) {}
        }

        if (!insertedRow) {
            insertedRow = { user_id: userId, email, password: hashedPassword, name: finalName, role: 'warden', block: wardenData.hostelBlock || wardenData.block || 'Block A', phone: wardenData.phone || '', status };
        }

        const warden = this._mapWarden(insertedRow);
        warden.temporaryPassword = tempPassword;
        warden.mustChangePassword = true;

        const scopePayload = {
            hostel: wardenData.hostel || 'Main Hostel',
            block: wardenData.hostelBlock || wardenData.block || 'Block A',
            floors: wardenData.floors || 'All',
            rooms: wardenData.rooms || 'All',
            isActive: status !== 'Inactive'
        };
        warden.scope = await wardenScopeRepository.saveWardenScope(userId, scopePayload);

        const perms = Array.isArray(wardenData.permissions) ? wardenData.permissions : wardenPermissionRepository.DEFAULT_WARDEN_PERMISSIONS;
        warden.permissions = await wardenPermissionRepository.setPermissions(userId, perms);

        const assignedStudents = await studentRepository.getByScope(warden.scope);
        warden.studentCount = assignedStudents.length;
        warden.assignedStudentsCount = assignedStudents.length;

        return warden;
    }

    async updateWarden(id, updates) {
        if (!id) return null;
        const warden = await this.getWardenById(id);
        if (!warden) return null;

        const previousUserId = String(warden.userId || id).trim();
        const nextUserId = String(updates.wardenId || updates.userId || previousUserId).trim();

        if (updates.status !== undefined) {
            const normalized = updates.status.charAt(0).toUpperCase() + updates.status.slice(1).toLowerCase();
            wardenStatusCache.set(warden.userId, normalized);
            wardenStatusCache.set(warden.email, normalized);
        }

        try {
            await db.query(
                `UPDATE users SET
                    "userId" = $1,
                    name = COALESCE($2, name),
                    email = COALESCE($3, email),
                    password = CASE WHEN $4::text IS NOT NULL AND $4::text != '' THEN $4::text ELSE password END,
                    phone = COALESCE($5, phone),
                    status = COALESCE($6, status),
                    "hostelBlock" = COALESCE($7, "hostelBlock"),
                    updated_at = NOW()
                 WHERE LOWER("userId") = LOWER($8) OR LOWER(email) = LOWER($8)`,
                [
                    nextUserId,
                    updates.name || updates.fullName || null,
                    updates.email ? updates.email.trim().toLowerCase() : null,
                    updates.password ? hashPassword(String(updates.password).trim()) : null,
                    updates.phone || updates.mobileNumber || null,
                    updates.status || null,
                    updates.hostelBlock || updates.block || null,
                    previousUserId
                ]
            );
        } catch (e) {}

        const client = getSupabaseClient();
        if (client) {
            try {
                const dbPayload = {};
                if (updates.name !== undefined) dbPayload.name = updates.name.trim();
                if (updates.email !== undefined) dbPayload.email = updates.email.trim().toLowerCase();
                if (updates.phone !== undefined) dbPayload.phone = updates.phone.trim();
                if (updates.hostelBlock !== undefined || updates.block !== undefined) {
                    dbPayload.block = updates.hostelBlock || updates.block;
                }
                await client.from(this.tableName).update(dbPayload).eq('user_id', previousUserId);
            } catch (e) {}
        }

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

        if (updates.permissions && Array.isArray(updates.permissions)) {
            warden.permissions = await wardenPermissionRepository.setPermissions(nextUserId, updates.permissions);
        }

        return await this.getWardenById(nextUserId);
    }

    async deleteWarden(id) {
        if (!id) return false;
        const warden = await this.getWardenById(id);
        if (!warden) return false;

        wardenStatusCache.delete(warden.userId);
        wardenStatusCache.delete(warden.email);
        wardenAdminCache.delete(warden.userId);

        try {
            await db.query(`DELETE FROM users WHERE LOWER("userId") = LOWER($1) OR LOWER(email) = LOWER($1)`, [warden.userId]);
        } catch (e) {}

        const client = getSupabaseClient();
        if (client) {
            try {
                await client.from(this.tableName).delete().eq('user_id', warden.userId);
            } catch (e) {}
        }

        return true;
    }

    async updatePassword(idOrEmail, newPassword) {
        if (!idOrEmail || !newPassword) return null;
        const warden = await this.getWardenById(idOrEmail);
        if (!warden) return null;

        const hashedPassword = hashPassword(newPassword);

        try {
            const meta = warden.meta || {};
            meta.mustChangePassword = false;
            meta.must_change_password = false;
            await db.query(
                `UPDATE users SET password = $1, must_change_password = FALSE, specialization = $3, updated_at = NOW() WHERE LOWER("userId") = LOWER($2) OR LOWER(email) = LOWER($2)`,
                [hashedPassword, warden.userId, JSON.stringify(meta)]
            );
        } catch (e) {}

        const client = getSupabaseClient();
        if (client) {
            try {
                await client.from(this.tableName).update({ password: hashedPassword }).eq('user_id', warden.userId);
            } catch (e) {}
        }

        return await this.getWardenById(warden.userId);
    }

    _mapWarden(row) {
        if (!row) return null;
        const userId = row.userId || row.user_id || row.id || ('WRD-' + Math.floor(100000 + Math.random() * 900000));
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
        const block = row.hostelBlock || row.block || row.hostel_block || meta.block || 'Block A';
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
            roomNumber: row.roomNumber || row.room_number || '',
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
            createdAt: row.created_at || row.createdAt || new Date().toISOString(),
            updatedAt: row.updated_at || row.updatedAt || new Date().toISOString()
        };
    }
}

module.exports = new WardenRepository();
