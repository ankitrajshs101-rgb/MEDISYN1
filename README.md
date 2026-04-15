# MediSync

Production-style healthcare app with:

- owner-only admin access
- OTP signup and reset
- Web Bluetooth support for ESP32
- local development mode
- Supabase production mode

## Run locally

1. Copy [\.env.example](/C:/Users/HP/Downloads/medisyn3/.env.example) to `.env`
2. Keep `DATABASE_PROVIDER=local`
3. Fill `OWNER_EMAIL`, `OWNER_PASSWORD`, `SESSION_SECRET`, and `ADMIN_SECRET`
4. Add Gmail SMTP or Resend email settings for OTP
5. Start:

```bash
node server.js
```

Open `http://localhost:3000`

## Production database

This project now supports:

- `DATABASE_PROVIDER=local`
- `DATABASE_PROVIDER=supabase`

For production, use Supabase.

### Supabase setup

1. Create a Supabase project
2. Open the SQL editor
3. Run [supabase-schema.sql](/C:/Users/HP/Downloads/medisyn3/supabase-schema.sql)
4. In `.env`, set:

```env
DATABASE_PROVIDER=supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SCHEMA=public
```

5. Restart:

```bash
node server.js
```

## OTP providers

Email options:

- Gmail SMTP using `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`
- Resend using `RESEND_API_KEY` and `OTP_FROM_EMAIL`

SMS option:

- Twilio using `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_PHONE`

## ESP32 Bluetooth

The website listens for BLE notifications from ESP32. Example payload:

```json
{
  "heartRate": 78,
  "bloodPressure": "120/80",
  "spo2": 98,
  "temperature": 36.7
}
```

Firmware example:
[esp32_ble_template.ino](/C:/Users/HP/Downloads/medisyn3/firmware/esp32_ble_template.ino)

## GitHub and Vercel

1. Push this folder to GitHub
2. Import the repo into Vercel
3. Add the same `.env` values in Vercel environment settings
4. Deploy

## Beginner recommendation

Do setup in this order:

1. local mode working
2. Supabase schema created
3. switch `.env` to `DATABASE_PROVIDER=supabase`
4. test signup/login/admin
5. deploy to Vercel
