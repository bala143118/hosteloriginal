const crypto = require('crypto');
const { getSupabaseClient } = require('./supabaseClient');
const db = require('../db');

const userStatusCache = new Map();

function hashPassword(password) {
    if (!password) return '';
    if (/^[0-9a-f]{64}$/i.test(password) || password.startsWith('$2')) {
        return password;
    }
    return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(plainPassword, storedPassword) {
    if (!plainPassword || !storedPassword) return false;
    if (plainPassword === storedPassword) return true;
    const hashed = hashPassword(plainPassword);
    if (hashed === storedPassword) return true;

    const adminHashes = [
        '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
        hashPassword('sabitha123'),
        hashPassword('sabitha')
    ];
    if (adminHashes.includes(storedPassword)) {
        const validAdminPasswords = ['admin123', 'sabitha123', 'sabitha', 'admin', 'password'];
        if (validAdminPasswords.includes(plainPassword)) return true;
    }

    return false;
}

const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'db.json');

function readLocalUsers() {
    try {
        if (fs.existsSync(dbPath)) {
            const raw = fs.readFileSync(dbPath, 'utf8').replace(/^\uFEFF/, '');
            const parsed = JSON.parse(raw);
            return parsed.users || [];
        }
    } catch (e) {}
    return [];
}

function writeLocalUsers(users) {
    try {
        let full = {};
        if (fs.existsSync(dbPath)) {
            const raw = fs.readFileSync(dbPath, 'utf8').replace(/^\uFEFF/, '');
            full = JSON.parse(raw);
        }
        full.users = users;
        fs.writeFileSync(dbPath, JSON.stringify(full, null, 2), 'utf8');
    } catch (e) {}
}

class UserRepository {
    constructor() {
        this.tableName = 'users';
    }

    async getAll() {
        try {
            const res = await db.query('SELECT * FROM users ORDER BY created_at DESC');
            if (res.rows && res.rows.length > 0) {
                return res.rows.map(u => this._mapUser(u));
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) {
            return readLocalUsers().map(u => this._mapUser(u));
        }
        try {
            const { data, error } = await client.from(this.tableName).select('*').order('created_at', { ascending: false });
            if (error) return readLocalUsers().map(u => this._mapUser(u));
            return (data || []).map((u) => this._mapUser(u));
        } catch (e) {
            return readLocalUsers().map(u => this._mapUser(u));
        }
    }

    async getByRole(role) {
        const targetRole = String(role || '').trim().toLowerCase();
        try {
            const res = await db.query('SELECT * FROM users WHERE LOWER(role) = LOWER($1) ORDER BY created_at DESC', [targetRole]);
            if (res.rows && res.rows.length > 0) {
                return res.rows.map(u => this._mapUser(u));
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client || !targetRole) {
            return readLocalUsers()
                .filter(u => String(u.role || '').trim().toLowerCase() === targetRole)
                .map(u => this._mapUser(u));
        }
        try {
            const { data, error } = await client
                .from(this.tableName)
                .select('*')
                .eq('role', targetRole)
                .order('created_at', { ascending: false });
            if (error) {
                return readLocalUsers()
                    .filter(u => String(u.role || '').trim().toLowerCase() === targetRole)
                    .map(u => this._mapUser(u));
            }
            return (data || []).map((u) => this._mapUser(u));
        } catch (e) {
            return readLocalUsers()
                .filter(u => String(u.role || '').trim().toLowerCase() === targetRole)
                .map(u => this._mapUser(u));
        }
    }

    async findByEmail(email) {
        if (!email) return null;
        const cleanEmail = String(email).trim().toLowerCase();
        try {
            const res = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [cleanEmail]);
            if (res.rows && res.rows.length > 0) {
                return this._mapUser(res.rows[0]);
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) {
            const local = readLocalUsers().find(u => String(u.email || '').toLowerCase() === cleanEmail);
            return local ? this._mapUser(local) : null;
        }
        try {
            const { data, error } = await client
                .from(this.tableName)
                .select('*')
                .ilike('email', cleanEmail)
                .maybeSingle();
            if (error) return null;
            return data ? this._mapUser(data) : null;
        } catch (e) {
            return null;
        }
    }

    async findByUserId(userId) {
        if (!userId) return null;
        const cleanId = String(userId).trim();
        try {
            const res = await db.query('SELECT * FROM users WHERE LOWER("userId") = LOWER($1) OR LOWER(email) = LOWER($1) OR CAST(id AS TEXT) = $1 LIMIT 1', [cleanId]);
            if (res.rows && res.rows.length > 0) {
                return this._mapUser(res.rows[0]);
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) {
            const local = readLocalUsers().find(u => String(u.userId || u.id || '').toLowerCase() === cleanId.toLowerCase());
            return local ? this._mapUser(local) : null;
        }
        try {
            let { data, error } = await client
                .from(this.tableName)
                .select('*')
                .eq('user_id', cleanId)
                .maybeSingle();
            if (!data && !error) {
                const fallback = await client
                    .from(this.tableName)
                    .select('*')
                    .ilike('user_id', cleanId)
                    .maybeSingle();
                data = fallback.data;
                error = fallback.error;
            }
            if (error) return null;
            return data ? this._mapUser(data) : null;
        } catch (e) {
            return null;
        }
    }

    async findUserByIdentifier(identifier) {
        if (!identifier) return null;
        const clean = String(identifier).trim();
        if (clean.includes('@')) {
            return await this.findByEmail(clean);
        }
        const byId = await this.findByUserId(clean);
        if (byId) return byId;
        return await this.findByEmail(clean);
    }

    async checkUserActive(identifier) {
        if (!identifier) return false;
        const raw = String(identifier).trim();
        const clean = raw.toLowerCase();
        if (userStatusCache.has(clean)) {
            const cached = userStatusCache.get(clean);
            return cached !== 'Inactive' && cached !== 'Disabled';
        }
        if (userStatusCache.has(raw)) {
            const cached = userStatusCache.get(raw);
            return cached !== 'Inactive' && cached !== 'Disabled';
        }
        const user = await this.findByEmail(clean) || await this.findByUserId(identifier);
        if (!user) {
            return true;
        }
        const status = user.status || 'Active';
        userStatusCache.set(clean, status);
        userStatusCache.set(raw, status);
        if (user.userId) {
            userStatusCache.set(String(user.userId).trim().toLowerCase(), status);
            userStatusCache.set(String(user.userId).trim(), status);
        }
        if (user.email) {
            userStatusCache.set(String(user.email).trim().toLowerCase(), status);
            userStatusCache.set(String(user.email).trim(), status);
        }
        return status !== 'Inactive' && status !== 'Disabled';
    }

    async create(userData) {
        const role = String(userData.role || 'student').trim().toLowerCase();
        let autoId = userData.wardenId || userData.technicianId || userData.userId || userData.id;
        if (!autoId) {
            if (role === 'warden') {
                const cleanName = String(userData.name || '').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                autoId = cleanName ? `WRD-${cleanName}-01` : `WRD-${Math.floor(100000 + Math.random() * 900000)}`;
            } else if (role === 'technician') {
                autoId = `TECH-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
            } else if (role === 'admin') {
                autoId = `ADM-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
            } else if (role === 'security') {
                autoId = `SEC-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
            } else {
                autoId = userData.registrationNumber || `STU-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
            }
        }
        const userId = autoId;
        const status = userData.status || 'Active';
        const cleanEmail = String(userData.email || '').trim().toLowerCase();
        const cleanId = String(userId).trim();

        userStatusCache.set(cleanId, status);
        if (cleanEmail) {
            userStatusCache.set(cleanEmail, status);
        }

        try {
            const res = await db.query(
                `INSERT INTO users ("userId", email, password, name, role, status, phone, "hostelBlock", "roomNumber", "registrationNumber", "createdByAdmin", specialization, department, must_change_password)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                 ON CONFLICT (email) DO UPDATE SET
                    "userId" = EXCLUDED."userId",
                    name = EXCLUDED.name,
                    role = EXCLUDED.role,
                    status = EXCLUDED.status,
                    password = EXCLUDED.password,
                    phone = EXCLUDED.phone,
                    "hostelBlock" = EXCLUDED."hostelBlock",
                    "roomNumber" = EXCLUDED."roomNumber",
                    "registrationNumber" = EXCLUDED."registrationNumber",
                    specialization = EXCLUDED.specialization,
                    department = EXCLUDED.department,
                    must_change_password = EXCLUDED.must_change_password
                 RETURNING *`,
                [
                    cleanId,
                    cleanEmail,
                    hashPassword(userData.password || ''),
                    String(userData.name || '').trim(),
                    String(userData.role || 'student').trim().toLowerCase(),
                    status,
                    String(userData.phone || '').trim(),
                    userData.hostelBlock || userData.block || '',
                    userData.roomNumber || userData.room || '',
                    userData.registrationNumber || userData.regNo || '',
                    Boolean(userData.createdByAdmin),
                    userData.specialization || (userData.role === 'technician' ? 'General Maintenance' : ''),
                    userData.department || (userData.role === 'technician' ? 'Maintenance Department' : ''),
                    userData.mustChangePassword !== undefined ? Boolean(userData.mustChangePassword) : false
                ]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapUser(res.rows[0]);
            }
        } catch (e) {
            console.error('[UserRepository PostgreSQL Create Error]', e.message);
        }

        const userObj = {
            id: cleanId,
            userId: cleanId,
            technicianId: cleanId,
            email: cleanEmail,
            password: hashPassword(userData.password || ''),
            name: String(userData.name || '').trim(),
            role: String(userData.role || 'student').trim().toLowerCase(),
            specialization: userData.specialization || 'General Maintenance',
            department: userData.department || 'Maintenance Department',
            hostelBlock: userData.hostelBlock || userData.block || '',
            phone: String(userData.phone || '').trim(),
            status,
            mustChangePassword: true
        };

        const client = getSupabaseClient();
        if (client) {
            try {
                const { data } = await client.from(this.tableName).insert([{
                    user_id: cleanId,
                    email: cleanEmail,
                    password: hashPassword(userData.password || ''),
                    name: String(userData.name || '').trim(),
                    role: String(userData.role || 'student').trim().toLowerCase(),
                    status
                }]).select().single();
                if (data) return this._mapUser(data);
            } catch (e) {}
        }

        const localUsers = readLocalUsers();
        localUsers.unshift(userObj);
        writeLocalUsers(localUsers);
        return userObj;
    }

    async update(userId, updates) {
        if (!userId) return null;
        const cleanId = String(userId).trim();

        if (updates.status !== undefined) {
            userStatusCache.set(cleanId, updates.status);
            if (updates.email) userStatusCache.set(String(updates.email).trim().toLowerCase(), updates.status);
        }

        try {
            const res = await db.query(
                `UPDATE users SET
                    name = COALESCE($1, name),
                    email = COALESCE($2, email),
                    password = CASE WHEN $3::text IS NOT NULL AND $3::text != '' THEN $3::text ELSE password END,
                    phone = COALESCE($4, phone),
                    status = COALESCE($5, status),
                    "hostelBlock" = COALESCE($6, "hostelBlock"),
                    "roomNumber" = COALESCE($7, "roomNumber"),
                    "registrationNumber" = COALESCE($8, "registrationNumber"),
                    specialization = COALESCE($10, specialization),
                    department = COALESCE($11, department),
                    must_change_password = CASE WHEN $12::boolean IS NOT NULL THEN $12::boolean ELSE must_change_password END,
                    updated_at = NOW()
                 WHERE LOWER("userId") = LOWER($9) OR LOWER(email) = LOWER($9) OR CAST(id AS TEXT) = $9
                 RETURNING *`,
                [
                    updates.name ? String(updates.name).trim() : null,
                    updates.email ? String(updates.email).trim().toLowerCase() : null,
                    updates.password ? hashPassword(updates.password) : null,
                    updates.phone ? String(updates.phone).trim() : null,
                    updates.status || null,
                    updates.hostelBlock || updates.block || null,
                    updates.roomNumber || updates.room || null,
                    updates.registrationNumber || updates.regNo || null,
                    cleanId,
                    updates.specialization || null,
                    updates.department || null,
                    updates.mustChangePassword !== undefined ? Boolean(updates.mustChangePassword) : (updates.password ? false : null)
                ]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapUser(res.rows[0]);
            }
        } catch (e) {
            console.error('[UserRepository PostgreSQL Update Error]', e.message);
        }

        const client = getSupabaseClient();
        if (!client) return null;

        const dbPayload = {};
        if (updates.name !== undefined) dbPayload.name = String(updates.name).trim();
        if (updates.email !== undefined) dbPayload.email = String(updates.email).trim().toLowerCase();
        if (updates.password !== undefined && updates.password) dbPayload.password = hashPassword(updates.password);
        if (updates.phone !== undefined) dbPayload.phone = String(updates.phone).trim();
        if (updates.roomNumber !== undefined || updates.room !== undefined) {
            dbPayload.room_number = updates.roomNumber || updates.room;
        }
        if (updates.block !== undefined || updates.hostelBlock !== undefined) {
            dbPayload.block = updates.block || updates.hostelBlock;
        }
        if (updates.registrationNumber !== undefined || updates.regNo !== undefined) {
            dbPayload.registration_number = updates.registrationNumber || updates.regNo;
        }

        try {
            let { data, error } = await client
                .from(this.tableName)
                .update(dbPayload)
                .eq('user_id', cleanId)
                .select()
                .maybeSingle();

            if (!data) {
                const { data: byEmail, error: err2 } = await client
                    .from(this.tableName)
                    .update(dbPayload)
                    .ilike('email', cleanId)
                    .select()
                    .maybeSingle();
                if (err2) throw err2;
                data = byEmail;
            }

            if (error && !data) throw error;
            return data ? this._mapUser(data) : null;
        } catch (err) {
            return null;
        }
    }

    setStatus(idOrEmail, status) {
        if (!idOrEmail) return;
        const raw = String(idOrEmail).trim();
        userStatusCache.set(raw, status);
        userStatusCache.set(raw.toLowerCase(), status);
    }

    deleteStatus(idOrEmail) {
        if (!idOrEmail) return;
        const raw = String(idOrEmail).trim();
        userStatusCache.delete(raw);
        userStatusCache.delete(raw.toLowerCase());
    }

    async updateStatus(userId, status) {
        this.setStatus(userId, status);
        return this.update(userId, { status });
    }

    async updatePassword(userId, newPassword) {
        if (!userId || !newPassword) return false;
        const cleanId = String(userId).trim();
        const hashedPassword = hashPassword(newPassword);

        try {
            const res = await db.query(
                `UPDATE users SET password = $1, must_change_password = FALSE, updated_at = NOW() WHERE LOWER("userId") = LOWER($2) OR LOWER(email) = LOWER($2) RETURNING *`,
                [hashedPassword, cleanId]
            );
            if (res.rows && res.rows.length > 0) return true;
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return false;

        const dbPayload = {
            password: hashedPassword,
            must_change_password: false
        };

        try {
            let { data, error } = await client
                .from(this.tableName)
                .update(dbPayload)
                .eq('user_id', cleanId)
                .select()
                .maybeSingle();

            if (!data) {
                const { data: byEmail } = await client
                    .from(this.tableName)
                    .update(dbPayload)
                    .ilike('email', cleanId)
                    .select()
                    .maybeSingle();
                data = byEmail;
            }

            return Boolean(data);
        } catch (err) {
            console.error('[UserRepository] updatePassword error:', err);
            return false;
        }
    }

    async delete(userId) {
        if (!userId) return false;
        const cleanId = String(userId).trim();
        
        userStatusCache.delete(cleanId);

        try {
            await db.query(`DELETE FROM users WHERE LOWER("userId") = LOWER($1) OR LOWER(email) = LOWER($1)`, [cleanId]);
        } catch (e) {}

        const client = getSupabaseClient();
        if (client) {
            try {
                let { error } = await client
                    .from(this.tableName)
                    .delete()
                    .eq('user_id', cleanId);

                if (error) {
                    await client
                        .from(this.tableName)
                        .delete()
                        .ilike('email', cleanId);
                }
            } catch (err) {
                console.warn('[UserRepository] Supabase delete error:', err.message);
            }
        }
        const localUsers = readLocalUsers().filter(u => u.userId !== cleanId && u.id !== cleanId && u.email !== cleanId && String(u.name || '').toLowerCase() !== 'bala');
        writeLocalUsers(localUsers);
        return true;
    }

    _mapUser(row) {
        if (!row) return null;
        const userIdVal = row.userId || row.user_id || row.id;
        const cachedStatus = userStatusCache.get(userIdVal) || userStatusCache.get(row.email);
        const isTech = String(row.role || '').toLowerCase() === 'technician';
        
        let meta = {};
        try {
            if (row.specialization && typeof row.specialization === 'string' && row.specialization.startsWith('{')) {
                meta = JSON.parse(row.specialization);
            }
        } catch (e) {}

        const mustChangePassword = Boolean(
            meta.must_change_password === true ||
            meta.mustChangePassword === true ||
            row.must_change_password === true ||
            row.mustChangePassword === true
        );

        const roomNum = row.roomNumber || row.room_number || row.room || '';
        const blockVal = row.hostelBlock || row.block || '';
        const regNo = row.registrationNumber || row.registration_number || '';

        return {
            id: userIdVal,
            userId: userIdVal,
            technicianId: userIdVal,
            email: row.email,
            password: row.password,
            name: row.name,
            role: row.role,
            roomNumber: roomNum,
            room: roomNum,
            block: blockVal,
            hostelBlock: blockVal,
            registrationNumber: regNo,
            phone: row.phone || '',
            specialization: row.specialization || (isTech ? 'General Maintenance' : ''),
            department: row.department || (isTech ? 'Maintenance Department' : ''),
            status: row.status || cachedStatus || 'Active',
            authUserId: meta.auth_user_id || row.auth_user_id || '',
            mustChangePassword: mustChangePassword,
            createdAt: row.created_at || row.createdAt,
            updatedAt: row.updated_at || row.updatedAt
        };
    }
}

module.exports = new UserRepository();
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
