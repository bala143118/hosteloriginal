/**
 * Adaptive Rate Limiting Middleware for HostelFix
 * Provides memory-safe sliding window rate limiting for authentication and sensitive operations.
 */

function createRateLimiter({ windowMs = 60 * 1000, max = 10, message = 'Too many requests. Please try again later.' }) {
    const hits = new Map();

    // Periodic cleanup of expired windows every 2 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [key, record] of hits.entries()) {
            if (now - record.startTime > windowMs * 2) {
                hits.delete(key);
            }
        }
    }, 2 * 60 * 1000).unref();

    return (req, res, next) => {
        // Skip rate limiting during automated test suite execution
        if (process.env.NODE_ENV === 'test' || process.env.SKIP_RATE_LIMIT === 'true') {
            return next();
        }

        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
        const key = `${ip}:${req.path}`;
        const now = Date.now();

        let record = hits.get(key);
        if (!record || now - record.startTime > windowMs) {
            record = { count: 1, startTime: now };
            hits.set(key, record);
            return next();
        }

        record.count++;
        if (record.count > max) {
            const retryAfterSeconds = Math.ceil((windowMs - (now - record.startTime)) / 1000);
            res.setHeader('Retry-After', retryAfterSeconds);
            return res.status(429).json({
                success: false,
                error: message || `Too many requests. Please wait ${retryAfterSeconds} seconds before trying again.`,
                retryAfter: retryAfterSeconds
            });
        }

        next();
    };
}

const authRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 15,
    message: 'Too many login attempts. Please wait 1 minute before trying again.'
});

const otpRequestRateLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 5,
    message: 'Too many OTP requests. Please wait a few minutes before trying again.'
});

const otpVerifyRateLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: 'Too many verification attempts. Please wait 5 minutes before trying again.'
});

const sensitiveAdminRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    message: 'Rate limit exceeded for admin operations. Please slow down.'
});

module.exports = {
    createRateLimiter,
    authRateLimiter,
    otpRequestRateLimiter,
    otpVerifyRateLimiter,
    sensitiveAdminRateLimiter
};
