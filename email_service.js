const nodemailer = require('nodemailer');
const { getSupabaseClient } = require('./repositories/supabaseClient');

let transporter = null;
let dynamicEmailConfig = {
  provider: 'gmail',
  smtpHost: '',
  smtpPort: 465,
  smtpUser: '',
  smtpPass: '',
  smtpSecure: true,
  emailFrom: '',
  resendApiKey: ''
};

function setEmailConfig(newConfig = {}) {
  if (!newConfig || typeof newConfig !== 'object') return;
  
  dynamicEmailConfig = {
    ...dynamicEmailConfig,
    provider: newConfig.emailProvider || newConfig.provider || dynamicEmailConfig.provider,
    smtpHost: newConfig.smtpHost !== undefined ? String(newConfig.smtpHost).trim() : dynamicEmailConfig.smtpHost,
    smtpPort: newConfig.smtpPort ? Number(newConfig.smtpPort) : dynamicEmailConfig.smtpPort,
    smtpUser: newConfig.smtpUser !== undefined ? String(newConfig.smtpUser).trim() : dynamicEmailConfig.smtpUser,
    smtpPass: newConfig.smtpPass !== undefined ? String(newConfig.smtpPass).trim() : dynamicEmailConfig.smtpPass,
    smtpSecure: newConfig.smtpSecure !== undefined ? Boolean(newConfig.smtpSecure) : dynamicEmailConfig.smtpSecure,
    emailFrom: newConfig.emailFrom !== undefined ? String(newConfig.emailFrom).trim() : dynamicEmailConfig.emailFrom,
    resendApiKey: newConfig.resendApiKey !== undefined ? String(newConfig.resendApiKey).trim() : dynamicEmailConfig.resendApiKey
  };

  // Invalidate previous transporter instance so next call uses updated settings
  transporter = null;
  console.log(`[EmailService] Dynamic email settings updated. Provider: ${dynamicEmailConfig.provider || 'custom'}, Host: ${dynamicEmailConfig.smtpHost || 'none'}, User: ${dynamicEmailConfig.smtpUser || 'none'}`);
}

function getEmailConfig() {
  return {
    provider: dynamicEmailConfig.provider || 'gmail',
    smtpHost: dynamicEmailConfig.smtpHost || process.env.SMTP_HOST || process.env.EMAIL_HOST || '',
    smtpPort: Number(dynamicEmailConfig.smtpPort || process.env.SMTP_PORT || process.env.EMAIL_PORT || 465),
    smtpUser: dynamicEmailConfig.smtpUser || process.env.SMTP_USER || process.env.EMAIL_USER || '',
    hasSmtpPass: Boolean(dynamicEmailConfig.smtpPass || process.env.SMTP_PASS || process.env.EMAIL_PASS),
    smtpSecure: dynamicEmailConfig.smtpSecure !== undefined ? dynamicEmailConfig.smtpSecure : true,
    emailFrom: dynamicEmailConfig.emailFrom || process.env.EMAIL_FROM || '',
    hasResendApiKey: Boolean(dynamicEmailConfig.resendApiKey || process.env.RESEND_API_KEY),
    isConfigured: Boolean(
      (dynamicEmailConfig.smtpHost || process.env.SMTP_HOST || process.env.EMAIL_HOST) &&
      (dynamicEmailConfig.smtpUser || process.env.SMTP_USER || process.env.EMAIL_USER) &&
      (dynamicEmailConfig.smtpPass || process.env.SMTP_PASS || process.env.EMAIL_PASS)
    ) || Boolean(dynamicEmailConfig.resendApiKey || process.env.RESEND_API_KEY)
  };
}

function initTransporter(customConfig = null) {
  if (!customConfig && transporter) return transporter;

  const cfg = customConfig || dynamicEmailConfig;
  const host = cfg.smtpHost || process.env.SMTP_HOST || process.env.EMAIL_HOST;
  const port = Number(cfg.smtpPort || process.env.SMTP_PORT || process.env.EMAIL_PORT || 465);
  const user = cfg.smtpUser || process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = cfg.smtpPass || process.env.SMTP_PASS || process.env.EMAIL_PASS;
  const secure = cfg.smtpSecure !== undefined ? Boolean(cfg.smtpSecure) : (port === 465);

  if (host && user && pass) {
    try {
      const t = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        tls: { rejectUnauthorized: false }
      });
      if (!customConfig) {
        transporter = t;
        console.log(`[EmailService] Configured Nodemailer SMTP via ${host}:${port} (${user})`);
      }
      return t;
    } catch (e) {
      console.warn('[EmailService] SMTP init error:', e.message);
    }
  }

  return null;
}

async function sendOtpEmail(toEmail, otpCode) {
  const cleanEmail = String(toEmail || '').trim().toLowerCase();
  if (!cleanEmail) throw new Error('Recipient email is required.');

  const resendKey = dynamicEmailConfig.resendApiKey || process.env.RESEND_API_KEY;
  const fromAddress = dynamicEmailConfig.emailFrom || process.env.EMAIL_FROM || (dynamicEmailConfig.smtpUser ? `"Sri Shakthi HostelFix" <${dynamicEmailConfig.smtpUser}>` : '"Sri Shakthi HostelFix" <no-reply@hostelfix.edu>');

  // 1. Resend API HTTP delivery if configured
  if (resendKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromAddress.includes('@resend.dev') ? fromAddress : 'HostelFix Security <onboarding@resend.dev>',
          to: [cleanEmail],
          subject: 'HostelFix - Verification Code',
          html: getEmailHtml(otpCode)
        })
      });
      if (response.ok) {
        console.log(`[EmailService] ✅ Delivered OTP via Resend API to ${cleanEmail}`);
        return true;
      } else {
        const errData = await response.text();
        console.warn('[EmailService] Resend API error response:', errData);
      }
    } catch (e) {
      console.warn('[EmailService] Resend API error:', e.message);
    }
  }

  // 2. SMTP delivery (Gmail, Outlook, custom SMTP)
  const smtp = initTransporter();
  if (smtp) {
    try {
      await smtp.sendMail({
        from: fromAddress,
        to: cleanEmail,
        subject: 'HostelFix - Verification Code',
        text: `Your HostelFix verification code is: ${otpCode}\n\nThis code is valid for 10 minutes.`,
        html: getEmailHtml(otpCode)
      });
      console.log(`[EmailService] ✅ Delivered OTP email via SMTP to ${cleanEmail}`);
      return true;
    } catch (err) {
      console.error('[EmailService] ❌ SMTP send error:', err.message);
    }
  }

  // 3. Supabase Auth fallback if configured
  const sb = getSupabaseClient();
  if (sb) {
    try {
      const { error } = await sb.auth.signInWithOtp({
        email: cleanEmail,
        options: { shouldCreateUser: false }
      });
      if (!error) {
        console.log(`[EmailService] Supabase Auth OTP email triggered for ${cleanEmail}`);
        return true;
      } else {
        console.warn(`[EmailService] Supabase Auth OTP notice: ${error.message}`);
      }
    } catch (sbErr) {
      console.warn('[EmailService] Supabase Auth OTP exception:', sbErr.message);
    }
  }

  // If no email service is configured or deliveries failed, log DEV OTP clearly
  console.log('\n======================================================');
  console.log(`[EmailService] ⚠️  NO EMAIL CREDENTIALS CONFIGURED!`);
  console.log(`[EmailService] 📬 Recipient: ${cleanEmail}`);
  console.log(`[EmailService] 🔑 VERIFICATION CODE (OTP):  ${otpCode}`);
  console.log(`[EmailService] 👉 Enter the code above in the verification screen.`);
  console.log(`[EmailService] 👉 Configure Dynamic Mail Settings in Admin Settings to send real emails.`);
  console.log('======================================================\n');
  return true;
}

async function testEmailConnection({ smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure, emailFrom, targetEmail, resendApiKey }) {
  const recipient = String(targetEmail || smtpUser || '').trim();
  if (!recipient) {
    throw new Error('Please provide a recipient email address to send the test email to.');
  }

  const host = String(smtpHost || '').trim();
  const port = Number(smtpPort || 465);
  const user = String(smtpUser || '').trim();
  const pass = String(smtpPass || '').trim();
  const from = String(emailFrom || `\"Sri Shakthi HostelFix\" <${user}>`).trim();

  // Test Resend API if provided
  if (resendApiKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'HostelFix Security <onboarding@resend.dev>',
        to: [recipient],
        subject: 'HostelFix - Test Email (Resend API)',
        html: `<div style="font-family: sans-serif; padding: 20px;"><h3>✅ Email Configuration Successful!</h3><p>Your HostelFix email service is configured and delivering emails via Resend API.</p></div>`
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Resend API Error: ${errText}`);
    }
    return { success: true, message: `Test email sent successfully to ${recipient} via Resend API.` };
  }

  // Test SMTP
  if (!host || !user || !pass) {
    throw new Error('SMTP Host, Username/Email, and Password are all required.');
  }

  const testTransport = nodemailer.createTransport({
    host,
    port,
    secure: smtpSecure !== undefined ? Boolean(smtpSecure) : (port === 465),
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });

  // Verify connection first
  await testTransport.verify();

  // Send the test email
  await testTransport.sendMail({
    from,
    to: recipient,
    subject: 'HostelFix - SMTP Configuration Test',
    text: `Hello,\n\nThis is a test email confirming that your dynamic SMTP settings in Sri Shakthi HostelFix are working properly!\n\nDelivered via: ${host}:${port}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <div style="text-align: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; margin-bottom: 20px;">
          <h2 style="color: #2563eb; margin: 0;">Sri Shakthi HostelFix</h2>
          <p style="color: #64748b; font-size: 13px; margin: 4px 0 0;">Email Configuration Test</p>
        </div>
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <h3 style="color: #166534; margin: 0 0 6px; font-size: 16px;">✅ Email Service Connected!</h3>
          <p style="color: #15803d; margin: 0; font-size: 13px;">Your dynamic SMTP email configuration is active and working properly.</p>
        </div>
        <p style="color: #475569; font-size: 13px; line-height: 1.6;">
          <strong>SMTP Host:</strong> ${host}<br>
          <strong>Port:</strong> ${port}<br>
          <strong>Sender:</strong> ${from}<br>
          <strong>Recipient:</strong> ${recipient}
        </p>
        <p style="color: #94a3b8; font-size: 11px; margin-top: 24px; text-align: center;">
          Sent from Sri Shakthi HostelFix Smart Management System
        </p>
      </div>
    `
  });

  return { success: true, message: `Test email sent successfully to ${recipient} via ${host}:${port}!` };
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

function getRegistrationEmailHtml({ name, userId, otpCode, role }) {
  const roleName = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Student';
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9;">
        <h2 style="color: #2563eb; margin: 0; font-size: 22px; font-weight: 800;">Sri Shakthi HostelFix</h2>
        <p style="color: #64748b; font-size: 13px; margin-top: 4px; font-weight: 500;">Smart Maintenance Management System</p>
      </div>
      <div style="padding: 24px 0;">
        <h3 style="color: #0f172a; margin-top: 0; font-size: 18px; font-weight: 700;">Welcome to HostelFix, ${name || 'Student'}!</h3>
        <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
          Your ${roleName} account has been registered successfully. Below are your account credentials and verification code:
        </p>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
          <div style="margin-bottom: 8px;">
            <span style="color: #64748b; font-size: 12px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">User ID / Login ID:</span>
            <div style="color: #0f172a; font-size: 16px; font-weight: 700; font-family: monospace;">${userId || 'Generated on login'}</div>
          </div>
          <div>
            <span style="color: #64748b; font-size: 12px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Account Role:</span>
            <div style="color: #2563eb; font-size: 14px; font-weight: 600;">${roleName}</div>
          </div>
        </div>

        <div style="text-align: center; margin: 24px 0 16px;">
          <p style="color: #475569; font-size: 13px; font-weight: 600; margin-bottom: 8px;">Your 6-Digit Verification Code (OTP):</p>
          <span style="display: inline-block; font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 800; letter-spacing: 10px; color: #2563eb; background-color: #eff6ff; padding: 12px 24px; border-radius: 12px; border: 1px solid #bfdbfe;">
            ${otpCode}
          </span>
        </div>

        <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin-top: 20px;">
          This verification code is valid for <strong>10 minutes</strong>. You can use your User ID or Email to sign in to the portal.
        </p>
      </div>
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid #f1f5f9; color: #94a3b8; font-size: 12px;">
        &copy; 2026 Sri Shakthi Institute of Engineering & Technology. All rights reserved.
      </div>
    </div>
  `;
}

async function sendRegistrationWelcomeEmail(toEmail, { name, userId, otpCode, role }) {
  const cleanEmail = String(toEmail || '').trim().toLowerCase();
  if (!cleanEmail) throw new Error('Recipient email is required.');

  const resendKey = dynamicEmailConfig.resendApiKey || process.env.RESEND_API_KEY;
  const fromAddress = dynamicEmailConfig.emailFrom || process.env.EMAIL_FROM || (dynamicEmailConfig.smtpUser ? `"Sri Shakthi HostelFix" <${dynamicEmailConfig.smtpUser}>` : '"Sri Shakthi HostelFix" <no-reply@hostelfix.edu>');
  const htmlContent = getRegistrationEmailHtml({ name, userId, otpCode, role });

  // 1. Resend API HTTP delivery if configured
  if (resendKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromAddress.includes('@resend.dev') ? fromAddress : 'HostelFix Security <onboarding@resend.dev>',
          to: [cleanEmail],
          subject: 'HostelFix - Welcome & Account Verification Code',
          html: htmlContent
        })
      });
      if (response.ok) {
        console.log(`[EmailService] ✅ Delivered Registration OTP email via Resend API to ${cleanEmail}`);
        return true;
      }
    } catch (e) {
      console.warn('[EmailService] Resend API error:', e.message);
    }
  }

  // 2. SMTP delivery
  const smtp = initTransporter();
  if (smtp) {
    try {
      await smtp.sendMail({
        from: fromAddress,
        to: cleanEmail,
        subject: 'HostelFix - Welcome & Account Verification Code',
        text: `Welcome to HostelFix, ${name}!\n\nYour User ID: ${userId}\nYour Verification Code (OTP): ${otpCode}\n\nValid for 10 minutes.`,
        html: htmlContent
      });
      console.log(`[EmailService] ✅ Delivered Registration OTP email via SMTP to dynamic email: ${cleanEmail}`);
      return true;
    } catch (err) {
      console.error('[EmailService] ❌ SMTP send error on registration:', err.message);
    }
  }

  console.log('\n======================================================');
  console.log(`[EmailService] ⚠️  REGISTRATION OTP FOR: ${cleanEmail}`);
  console.log(`[EmailService] 👤 Name: ${name} | User ID: ${userId}`);
  console.log(`[EmailService] 🔑 VERIFICATION CODE (OTP): ${otpCode}`);
  console.log('======================================================\n');
  return true;
}

module.exports = {
  sendOtpEmail,
  sendRegistrationWelcomeEmail,
  setEmailConfig,
  getEmailConfig,
  testEmailConnection
};

