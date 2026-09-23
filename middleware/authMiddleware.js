const jwt = require('jsonwebtoken');
const { wardenPermissionRepository, userRepository } = require('../repositories');

const JWT_SECRET = process.env.JWT_SECRET || process.env.GATEPASS_JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'hostelfix-secure-jwt-token-secret-2026');

function getJwtSecret() {
    if (!JWT_SECRET) {
        throw new Error('[FATAL] JWT_SECRET is not configured in production environment.');
    }
    return JWT_SECRET;
}

function generateToken(user) {
    const payload = {
        id: user.userId || user.id,
        userId: user.userId || user.id,
        email: String(user.email || '').trim().toLowerCase(),
        name: user.name,
        role: String(user.role || 'student').trim().toLowerCase(),
        hostelBlock: user.hostelBlock || user.block || '',
        roomNumber: user.roomNumber || ''
    };
    return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
    let token = null;

    if (authHeader) {
        token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    }

    req.user = null;
    req.tokenAuthFailed = false;
    req.tokenAuthError = null;

    if (token) {
        try {
            const decoded = jwt.verify(token, getJwtSecret());
            req.user = decoded;
            return next();
        } catch (err) {
            req.tokenAuthFailed = true;
            req.tokenAuthError = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid or tampered token';
            console.debug('[AuthMiddleware] Token invalid/expired:', err.message);
        }
    }

    // Security Hardening: Attacker-controlled headers (x-user-email, x-user-role, x-user-id)
    // and query parameters (?email=, ?role=, ?userId=, ?wardenEmail=) MUST NEVER establish
    // authenticated identity. req.user remains null if no valid JWT is present.
    next();
}

async function requireAuth(req, res, next) {
    if (!req.user) {
        const errorMsg = req.tokenAuthError
            ? `Authentication failed: ${req.tokenAuthError}. Please login again.`
            : 'Authentication required. Please login.';
        return res.status(401).json({ success: false, error: errorMsg });
    }

    // Account Status Validation: Inactive or Disabled accounts cannot perform operations
    try {
        const userIdOrEmail = req.user.userId || req.user.id || req.user.email;
        if (userIdOrEmail && userRepository && typeof userRepository.checkUserActive === 'function') {
            const isActive = await userRepository.checkUserActive(userIdOrEmail);
            if (!isActive) {
                return res.status(403).json({
                    success: false,
                    error: 'This account has been deactivated. Please contact administrator.'
                });
            }
        }
    } catch (err) {
        console.warn('[requireAuth] Status check notice:', err.message);
    }

    next();
}

function requireRole(allowedRoles) {
    const roles = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]).map(r => String(r).toLowerCase());
    return async (req, res, next) => {
        if (!req.user) {
            const errorMsg = req.tokenAuthError
                ? `Authentication failed: ${req.tokenAuthError}. Please login again.`
                : 'Authentication required. Please login.';
            return res.status(401).json({ success: false, error: errorMsg });
        }

        // Account status validation
        try {
            const userIdOrEmail = req.user.userId || req.user.id || req.user.email;
            if (userIdOrEmail && userRepository && typeof userRepository.checkUserActive === 'function') {
                const isActive = await userRepository.checkUserActive(userIdOrEmail);
                if (!isActive) {
                    return res.status(403).json({
                        success: false,
                        error: 'This account has been deactivated. Please contact administrator.'
                    });
                }
            }
        } catch (err) {}

        const userRole = String(req.user.role || '').toLowerCase();
        if (!roles.includes(userRole) && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: `Forbidden: role '${userRole}' not authorized.` });
        }
        next();
    };
}

function requirePermission(permissionName) {
    return async (req, res, next) => {
        if (!req.user) {
            const errorMsg = req.tokenAuthError
                ? `Authentication failed: ${req.tokenAuthError}. Please login again.`
                : 'Authentication required. Please login.';
            return res.status(401).json({ success: false, error: errorMsg });
        }

        // Account status validation
        try {
            const userIdOrEmail = req.user.userId || req.user.id || req.user.email;
            if (userIdOrEmail && userRepository && typeof userRepository.checkUserActive === 'function') {
                const isActive = await userRepository.checkUserActive(userIdOrEmail);
                if (!isActive) {
                    return res.status(403).json({
                        success: false,
                        error: 'This account has been deactivated. Please contact administrator.'
                    });
                }
            }
        } catch (err) {}

        const userRole = String(req.user.role || '').toLowerCase();
        if (userRole === 'admin') return next(); // Admin possesses all permissions

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
    getJwtSecret,
    generateToken,
    authenticateToken,
    requireAuth,
    requireRole,
    requirePermission
};
