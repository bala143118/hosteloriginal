const jwt = require('jsonwebtoken');
const { wardenPermissionRepository, userRepository } = require('../repositories');

const JWT_SECRET = process.env.JWT_SECRET || process.env.GATEPASS_JWT_SECRET || 'hostelfix-secure-jwt-token-secret-2026';

function generateToken(user) {
    const payload = {
        id: user.userId || user.id,
        userId: user.userId || user.id,
        email: user.email,
        name: user.name,
        role: user.role
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
    let token = null;

    if (authHeader) {
        token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            return next();
        } catch (err) {
            // Invalid token
            console.debug('[AuthMiddleware] Token invalid/expired:', err.message);
        }
    }

    // Fallback: Check if user identity passed in headers/query for backward compatibility
    const headerEmail = req.headers['x-user-email'] || req.query.wardenEmail || req.query.email;
    const headerRole = req.headers['x-user-role'] || req.query.role;

    if (headerEmail) {
        req.user = {
            email: String(headerEmail).trim().toLowerCase(),
            role: headerRole ? String(headerRole).trim().toLowerCase() : 'user',
            userId: req.query.userId || req.headers['x-user-id'] || ''
        };
    } else {
        req.user = null;
    }

    next();
}

function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required. Please login.' });
    }
    next();
}

function requireRole(allowedRoles) {
    const roles = Array.isArray(allowedRoles) ? allowedRoles.map(r => r.toLowerCase()) : [allowedRoles.toLowerCase()];
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Authentication required. Please login.' });
        }
        const userRole = (req.user.role || '').toLowerCase();
        if (!roles.includes(userRole) && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: `Forbidden: role '${userRole}' not authorized.` });
        }
        next();
    };
}

function requirePermission(permissionName) {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Authentication required. Please login.' });
        }
        const userRole = (req.user.role || '').toLowerCase();
        if (userRole === 'admin') return next(); // Admin has all permissions

        if (userRole === 'warden') {
            const wardenId = req.user.userId || req.user.id || req.user.email;
            const hasPerm = await wardenPermissionRepository.hasPermission(wardenId, permissionName);
            if (!hasPerm) {
                return res.status(403).json({
                    success: false,
                    error: `Forbidden: Missing required permission '${permissionName}'`
                });
            }
            return next();
        }

        return res.status(403).json({ success: false, error: 'Forbidden: Insufficient privileges.' });
    };
}

module.exports = {
    JWT_SECRET,
    generateToken,
    authenticateToken,
    requireAuth,
    requireRole,
    requirePermission
};
