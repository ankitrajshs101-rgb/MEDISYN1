create table if not exists patients (
  id text primary key,
  role text not null default 'patient',
  full_name text not null,
  email text not null unique,
  mobile text not null unique,
  gender text,
  age text,
  blood_group text,
  allergies text,
  medical_history text,
  emergency_contact_name text,
  emergency_contact_phone text,
  password_hash text not null,
  created_at timestamptz not null default now()
);

alter table patients add column if not exists blood_group text;
alter table patients add column if not exists allergies text;
alter table patients add column if not exists medical_history text;
alter table patients add column if not exists emergency_contact_name text;
alter table patients add column if not exists emergency_contact_phone text;

create table if not exists doctors (
  id text primary key,
  role text not null default 'doctor',
  full_name text not null,
  email text not null unique,
  mobile text not null unique,
  specialty text,
  license_number text,
  clinic text,
  status text not null default 'pending',
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists otp_challenges (
  id text primary key,
  role text not null,
  purpose text not null,
  email text,
  mobile text,
  otp text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists consultations (
  id text primary key,
  user_id text not null,
  role text not null,
  doctor_id text,
  doctor_name text,
  patient_name text,
  email text,
  phone text,
  consult_type text,
  session_mode text,
  status text not null default 'requested',
  chat_enabled boolean not null default false,
  typing_role text,
  typing_at timestamptz,
  seen_by_doctor_at timestamptz,
  seen_by_patient_at timestamptz,
  date_time text,
  scheduled_at text,
  symptoms text,
  created_at timestamptz not null default now()
);

create table if not exists prescriptions (
  id text primary key,
  consultation_id text,
  patient_id text not null,
  doctor_id text not null,
  doctor_name text,
  patient_name text,
  medicines text,
  dosage text,
  instructions text,
  follow_up_date text,
  created_at timestamptz not null default now()
);

create table if not exists device_readings (
  id text primary key,
  user_id text not null,
  role text not null,
  source text,
  heart_rate text,
  blood_pressure text,
  spo2 text,
  temperature text,
  raw text,
  created_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id text primary key,
  consultation_id text not null,
  sender_role text not null,
  sender_name text,
  message text not null,
  attachment_name text,
  attachment_data_url text,
  attachment_mime_type text,
  created_at timestamptz not null default now()
);

create table if not exists reports (
  id text primary key,
  patient_id text not null,
  patient_name text,
  file_name text not null,
  file_path text,
  file_size bigint,
  mime_type text,
  source text,
  category text,
  data_url text,
  created_at timestamptz not null default now()
);

alter table reports add column if not exists file_path text;

create index if not exists idx_patients_email on patients(email);
create index if not exists idx_patients_mobile on patients(mobile);
create index if not exists idx_doctors_email on doctors(email);
create index if not exists idx_doctors_mobile on doctors(mobile);
create index if not exists idx_doctors_status on doctors(status);
create index if not exists idx_otp_role_purpose on otp_challenges(role, purpose);
create index if not exists idx_device_readings_user on device_readings(user_id, created_at desc);
create index if not exists idx_consultations_doctor on consultations(doctor_id, created_at desc);
create index if not exists idx_consultations_patient on consultations(user_id, created_at desc);
create index if not exists idx_chat_messages_consultation on chat_messages(consultation_id, created_at asc);
create index if not exists idx_reports_patient on reports(patient_id, created_at desc);
create index if not exists idx_prescriptions_patient on prescriptions(patient_id, created_at desc);
create index if not exists idx_prescriptions_doctor on prescriptions(doctor_id, created_at desc);
