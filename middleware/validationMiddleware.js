/**
 * Zod Input Validation Middleware for HostelFix
 * Safely validates incoming API payloads and sanitizes error responses.
 */

const { z } = require('zod');

function validateBody(schema) {
    return (req, res, next) => {
        try {
            const parsed = schema.safeParse(req.body);
            if (!parsed.success) {
                const issue = parsed.error.issues[0];
                const field = issue.path.join('.') || 'payload';
                const message = issue.message || 'Invalid input';
                return res.status(400).json({
                    success: false,
                    error: `${field ? `${field}: ` : ''}${message}`
                });
            }
            req.validatedBody = parsed.data;
            next();
        } catch (err) {
            return res.status(400).json({ success: false, error: 'Malformed request payload.' });
        }
    };
}

// 1. Authentication Schemas
const loginSchema = z.object({
    email: z.string().min(1, 'Email or User ID is required'),
    password: z.string().min(1, 'Password is required'),
    role: z.string().optional()
});

const registerSchema = z.object({
    name: z.string().min(1, 'Full name is required'),
    email: z.string().email('Please enter a valid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters long'),
    role: z.enum(['student', 'technician', 'admin', 'warden', 'security'], {
        errorMap: () => ({ message: 'Please select a valid role' })
    }),
    roomNumber: z.string().optional(),
    block: z.string().optional(),
    hostelBlock: z.string().optional(),
    phone: z.string().optional(),
    registrationNumber: z.string().optional()
});

const forgotPasswordSchema = z.object({
    email: z.string().email('Please enter a valid email address')
});

const verifyOtpSchema = z.object({
    email: z.string().email('Please enter a valid email address'),
    otp: z.string().min(4, 'Verification code is required').max(10)
});

const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Reset token is required'),
    newPassword: z.string().min(6, 'Password must be at least 6 characters long')
});

const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(6, 'New password must be at least 6 characters long')
});

// 2. Complaint Schemas
const createComplaintSchema = z.object({
    category: z.string().min(1, 'Category is required'),
    description: z.string().min(1, 'Description is required'),
    priority: z.string().optional(),
    roomNumber: z.string().optional(),
    hostelBlock: z.string().optional()
}).passthrough();

// 3. Gate Pass Schemas
const createGatePassSchema = z.object({
    reason: z.string().min(1, 'Reason for leave is required'),
    gateDate: z.string().min(1, 'Out date/time is required'),
    returnDate: z.string().optional()
}).passthrough();

module.exports = {
    validateBody,
    loginSchema,
    registerSchema,
    forgotPasswordSchema,
    verifyOtpSchema,
    resetPasswordSchema,
    changePasswordSchema,
    createComplaintSchema,
    createGatePassSchema
};
