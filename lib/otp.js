const { execFile } = require('child_process');
const { promisify } = require('util');
const { config } = require('./config');

const execFileAsync = promisify(execFile);

function escapeForPowerShell(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function buildOtpEmailTemplate({ otp, purpose }) {
  const purposeLabel = purpose === 'reset' ? 'Password Reset' : 'Account Verification';
  return `
    <div style="margin:0;padding:32px 16px;background:#f4f7fb;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.12);">
        <div style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:28px 32px;color:#ffffff;">
          <div style="font-size:28px;font-weight:700;letter-spacing:0.4px;">MediSync</div>
          <div style="margin-top:6px;font-size:14px;opacity:0.95;">AI-Powered Healthcare Platform</div>
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 12px;font-size:14px;color:#475569;text-transform:uppercase;letter-spacing:1.2px;">${purposeLabel}</p>
          <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2;color:#0f172a;">Your One-Time Password</h1>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:#475569;">Use the OTP below to continue securely with your MediSync account.</p>
          <div style="margin:0 0 24px;padding:18px 20px;border-radius:16px;background:#eff6ff;border:1px solid #bfdbfe;text-align:center;">
            <div style="font-size:13px;color:#1d4ed8;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">Verification Code</div>
            <div style="font-size:36px;font-weight:700;letter-spacing:10px;color:#0f172a;">${otp}</div>
          </div>
          <div style="margin:0 0 24px;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
            <p style="margin:0 0 8px;font-size:15px;color:#334155;"><strong>Expires in:</strong> 10 minutes</p>
            <p style="margin:0;font-size:15px;color:#dc2626;"><strong>Security notice:</strong> Never share this OTP with anyone.</p>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#64748b;">If you did not request this code, you can safely ignore this email.</p>
        </div>
        <div style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">This is an automated email from MediSync. Please do not reply directly to this message.</p>
        </div>
      </div>
    </div>
  `.trim();
}

async function sendSmtpOtp({ email, otp, purpose }) {
  if (!email || !config.emailHost || !config.emailPort || !config.emailUser || !config.emailPass) {
    return { status: 'skipped' };
  }

  const subject = `MediSync ${purpose} OTP`;
  const body = buildOtpEmailTemplate({ otp, purpose });
  const securePort = config.emailPort === 465 || config.emailPort === 587 ? '$true' : '$false';
  const script = [
    `$smtpHost = '${escapeForPowerShell(config.emailHost)}'`,
    `$smtpPort = ${config.emailPort}`,
    `$smtpUser = '${escapeForPowerShell(config.emailUser)}'`,
    `$smtpPass = '${escapeForPowerShell(config.emailPass)}'`,
    `$mailFrom = '${escapeForPowerShell(config.otpFromEmail || config.emailUser)}'`,
    `$mailTo = '${escapeForPowerShell(email)}'`,
    `$mailSubject = '${escapeForPowerShell(subject)}'`,
    `$mailBody = '${escapeForPowerShell(body)}'`,
    `$securePass = ConvertTo-SecureString $smtpPass -AsPlainText -Force`,
    `$credential = New-Object System.Management.Automation.PSCredential($smtpUser, $securePass)`,
    `$message = New-Object System.Net.Mail.MailMessage($mailFrom, $mailTo, $mailSubject, $mailBody)`,
    `$message.IsBodyHtml = $true`,
    `$client = New-Object System.Net.Mail.SmtpClient($smtpHost, $smtpPort)`,
    `$client.EnableSsl = ${securePort}`,
    `$client.Credentials = $credential`,
    `$client.Send($message)`
  ].join('; ');

  try {
    await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
      windowsHide: true
    });
  } catch (error) {
    const stderr = error.stderr ? ` ${String(error.stderr).trim()}` : '';
    throw new Error(`Email OTP failed: SMTP send failed.${stderr}`.trim());
  }

  return { status: 'sent', provider: 'smtp' };
}

async function sendEmailOtp({ email, otp, purpose }) {
  const smtpResult = await sendSmtpOtp({ email, otp, purpose });
  if (smtpResult.status === 'sent') {
    return smtpResult;
  }

  if (!email || !config.resendApiKey || !config.otpFromEmail) {
    return { status: 'skipped' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: config.otpFromEmail,
      to: [email],
      subject: `MediSync ${purpose} OTP`,
      html: buildOtpEmailTemplate({ otp, purpose })
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Email OTP failed: ${message}`);
  }

  return { status: 'sent', provider: 'resend' };
}

async function sendSmsOtp({ mobile, otp, purpose }) {
  if (!mobile || !config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFromPhone) {
    return { status: 'skipped' };
  }

  const body = new URLSearchParams({
    To: mobile,
    From: config.twilioFromPhone,
    Body: `Your MediSync ${purpose} OTP is ${otp}. It expires in 10 minutes.`
  });

  const basicToken = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicToken}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`SMS OTP failed: ${message}`);
  }

  return { status: 'sent' };
}

async function deliverOtp(payload) {
  const result = {
    email: { status: 'skipped' },
    sms: { status: 'skipped' },
    devPreviewOtp: null
  };

  try {
    result.email = await sendEmailOtp(payload);
  } catch (error) {
    result.email = { status: 'failed', error: error.message };
  }

  try {
    result.sms = await sendSmsOtp(payload);
  } catch (error) {
    result.sms = { status: 'failed', error: error.message };
  }

  if (!config.isProduction && result.email.status !== 'sent' && result.sms.status !== 'sent') {
    result.devPreviewOtp = payload.otp;
  }

  return result;
}

module.exports = { deliverOtp };
