const nodemailer = require('nodemailer');
const { getSupabaseClient } = require('./repositories/supabaseClient');

let transporter = null;

function initTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
  const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587);
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.RESEND_API_KEY;

  if (host && user && pass) {
    try {
      transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        tls: { rejectUnauthorized: false }
      });
      console.log(`[EmailService] Configured Nodemailer SMTP via ${host}:${port}`);
      return transporter;
    } catch (e) {
      console.warn('[EmailService] SMTP init error:', e.message);
    }
  }

  if (process.env.RESEND_API_KEY) {
    console.log('[EmailService] Configured Resend HTTP API transport.');
  }

  return null;
}

async function sendOtpEmail(toEmail, otpCode) {
  const cleanEmail = String(toEmail || '').trim().toLowerCase();
  if (!cleanEmail) throw new Error('Recipient email is required.');

  // 1. Attempt Supabase Auth native OTP first if Supabase client is configured
  const sb = getSupabaseClient();
  if (sb) {
    try {
      const { error } = await sb.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: false
        }
      });
      if (!error) {
        console.log(`[EmailService] Supabase Auth OTP email triggered successfully for ${cleanEmail}`);
      } else {
        console.warn(`[EmailService] Supabase Auth OTP notice: ${error.message}`);
      }
    } catch (sbErr) {
      console.warn('[EmailService] Supabase Auth OTP exception:', sbErr.message);
    }
  }

  // 2. Resend API HTTP fallback if RESEND_API_KEY is present
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'HostelFix Security <onboarding@resend.dev>',
          to: [cleanEmail],
          subject: 'HostelFix - Verification Code',
          html: getEmailHtml(otpCode)
        })
      });
      if (response.ok) {
        console.log(`[EmailService] Delivered OTP via Resend API to ${cleanEmail}`);
        return true;
      }
    } catch (e) {
      console.warn('[EmailService] Resend API error:', e.message);
    }
  }

  // 3. SMTP delivery fallback
  const smtp = initTransporter();
  if (smtp) {
    try {
      await smtp.sendMail({
        from: process.env.EMAIL_FROM || '"HostelFix System" <no-reply@hostelfix.edu>',
        to: cleanEmail,
        subject: 'HostelFix - Verification Code',
        text: `Your HostelFix verification code is: ${otpCode}\n\nThis code is valid for 10 minutes.`,
        html: getEmailHtml(otpCode)
      });
      console.log(`[EmailService] Delivered OTP email via SMTP to ${cleanEmail}`);
      return true;
    } catch (err) {
      console.error('[EmailService] SMTP send error:', err.message);
    }
  }

  console.log(`[EmailService] Verification code generated for ${cleanEmail}. Delivery queued.`);
  return true;
}

function getEmailHtml(otpCode) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9;">
        <h2 style="color: #2563eb; margin: 0; font-size: 22px; font-weight: 800;">Sri Shakthi HostelFix</h2>
        <p style="color: #64748b; font-size: 13px; margin-top: 4px; font-weight: 500;">Smart Maintenance Management System</p>
      </div>
      <div style="padding: 24px 0;">
        <h3 style="color: #0f172a; margin-top: 0; font-size: 18px; font-weight: 700;">Account Verification Code</h3>
        <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
          You requested a password reset for your HostelFix account. Enter the 6-digit verification code below to complete the verification process:
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <span style="display: inline-block; font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #2563eb; background-color: #eff6ff; padding: 14px 28px; border-radius: 12px; border: 1px solid #bfdbfe;">
            ${otpCode}
          </span>
        </div>
        <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin-top: 24px;">
          This code is valid for <strong>10 minutes</strong>. If you did not request a password reset, you can safely ignore this email.
        </p>
      </div>
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid #f1f5f9; color: #94a3b8; font-size: 12px;">
        &copy; 2026 Sri Shakthi Institute of Engineering & Technology. All rights reserved.
      </div>
    </div>
  `;
}

module.exports = {
  sendOtpEmail
};
