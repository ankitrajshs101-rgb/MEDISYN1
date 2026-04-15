const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      return;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

loadDotEnv();

const rootDir = path.join(__dirname, '..');

const config = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  adminSecret: process.env.ADMIN_SECRET || 'dev-admin-secret-change-me',
  ownerEmail: (process.env.OWNER_EMAIL || 'owner@example.com').toLowerCase(),
  ownerPassword: process.env.OWNER_PASSWORD || 'ChangeMeNow123!',
  databaseProvider: (process.env.DATABASE_PROVIDER || 'local').toLowerCase(),
  dataFile: path.join(rootDir, 'data', 'app.json'),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseSchema: process.env.SUPABASE_SCHEMA || 'public',
  supabaseReportsBucket: process.env.SUPABASE_REPORTS_BUCKET || 'reports',
  otpFromEmail: process.env.OTP_FROM_EMAIL || process.env.EMAIL_USER || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailHost: process.env.EMAIL_HOST || '',
  emailPort: Number(process.env.EMAIL_PORT || 0),
  emailUser: process.env.EMAIL_USER || '',
  emailPass: process.env.EMAIL_PASS || '',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioApiKey: process.env.TWILIO_API_KEY || '',
  twilioApiSecret: process.env.TWILIO_API_SECRET || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromPhone: process.env.TWILIO_FROM_PHONE || '',
  twilioVideoRoomType: process.env.TWILIO_VIDEO_ROOM_TYPE || 'group',
  bleServiceUuid: process.env.BLE_SERVICE_UUID || '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
  bleCharacteristicUuid: process.env.BLE_CHARACTERISTIC_UUID || 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
  isProduction: process.env.NODE_ENV === 'production'
};

module.exports = { config };
