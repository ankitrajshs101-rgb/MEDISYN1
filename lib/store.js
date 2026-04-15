const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const initialDb = {
  users: [],
  doctors: [],
  consultations: [],
  prescriptions: [],
  chatMessages: [],
  reports: [],
  otpChallenges: [],
  deviceReadings: [],
  meta: {
    createdAt: new Date().toISOString()
  }
};

function ensureDbFile() {
  const dir = path.dirname(config.dataFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(config.dataFile)) {
    fs.writeFileSync(config.dataFile, JSON.stringify(initialDb, null, 2), 'utf8');
  }
}

function readLocalDb() {
  ensureDbFile();
  return JSON.parse(fs.readFileSync(config.dataFile, 'utf8'));
}

function writeLocalDb(db) {
  ensureDbFile();
  fs.writeFileSync(config.dataFile, JSON.stringify(db, null, 2), 'utf8');
}

function cleanupExpiredChallenges(db) {
  db.otpChallenges = db.otpChallenges.filter((item) => item.expiresAt > Date.now());
  return db;
}

function getSupabaseHeaders() {
  const key = config.supabaseServiceRoleKey || config.supabaseAnonKey;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
}

async function supabaseRequest(tablePath, options = {}) {
  const baseUrl = `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/${tablePath}`;
  const response = await fetch(baseUrl, {
    method: options.method || 'GET',
    headers: {
      ...getSupabaseHeaders(),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data?.message || data?.error || 'Supabase request failed.';
    throw new Error(message);
  }

  return data;
}

async function supabaseStorageUpload(bucket, filePath, dataUrl, mimeType = 'application/pdf') {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  const buffer = Buffer.from(base64, 'base64');
  const storageUrl = `${config.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${filePath}`;
  const response = await fetch(storageUrl, {
    method: 'POST',
    headers: {
      apikey: config.supabaseServiceRoleKey || config.supabaseAnonKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey || config.supabaseAnonKey}`,
      'Content-Type': mimeType,
      'x-upsert': 'true'
    },
    body: buffer
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data?.message || data?.error || 'Supabase storage upload failed.';
    throw new Error(message);
  }

  return data;
}

async function supabaseStorageCreateSignedUrl(bucket, filePath, expiresInSeconds = 900) {
  const baseUrl = `${config.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/sign/${bucket}/${filePath}`;
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      apikey: config.supabaseServiceRoleKey || config.supabaseAnonKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey || config.supabaseAnonKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expiresIn: expiresInSeconds })
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data?.message || data?.error || 'Supabase signed URL failed.';
    throw new Error(message);
  }

  const relativePath = data?.signedURL || data?.signedUrl || '';
  return relativePath ? `${config.supabaseUrl.replace(/\/$/, '')}/storage/v1${relativePath}` : '';
}

async function supabaseStorageDelete(bucket, filePath) {
  const baseUrl = `${config.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${filePath}`;
  const response = await fetch(baseUrl, {
    method: 'DELETE',
    headers: {
      apikey: config.supabaseServiceRoleKey || config.supabaseAnonKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey || config.supabaseAnonKey}`
    }
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(text || 'Supabase storage delete failed.');
  }
}

function buildReportFilePath(record) {
  const safePatientId = String(record.patientId || 'patient').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeName = String(record.fileName || 'report.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safePatientId}/${record.id}_${safeName}`;
}

function isSupabaseMode() {
  return config.databaseProvider === 'supabase';
}

function ensureSupabaseConfigured() {
  if (!config.supabaseUrl || !(config.supabaseServiceRoleKey || config.supabaseAnonKey)) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
}

async function getApprovedDoctors() {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return db.doctors.filter((doctor) => doctor.status === 'approved');
  }

  ensureSupabaseConfigured();
  return await supabaseRequest('doctors?status=eq.approved&order=created_at.desc');
}

async function findAccountByIdentifier(role, identifier) {
  const normalized = String(identifier || '').trim().toLowerCase();
  if (!normalized) return null;

  if (!isSupabaseMode()) {
    const db = cleanupExpiredChallenges(readLocalDb());
    writeLocalDb(db);
    const collection = role === 'patient' ? db.users : db.doctors;
    return collection.find((item) =>
      String(item.email || '').toLowerCase() === normalized || String(item.mobile || '').trim() === identifier
    ) || null;
  }

  ensureSupabaseConfigured();
  const table = role === 'patient' ? 'patients' : 'doctors';
  const value = encodeURIComponent(normalized);
  const phone = encodeURIComponent(String(identifier || '').trim());
  const rows = await supabaseRequest(`${table}?or=(email.eq.${value},mobile.eq.${phone})&limit=1`);
  if (!rows?.[0]) return null;
  return role === 'patient' ? normalizePatient(rows[0]) : normalizeDoctor(rows[0]);
}

async function createOtpChallenge(challenge) {
  if (!isSupabaseMode()) {
    const db = cleanupExpiredChallenges(readLocalDb());
    db.otpChallenges = db.otpChallenges.filter((item) => !(item.role === challenge.role && item.purpose === challenge.purpose && item.email === challenge.email && item.mobile === challenge.mobile));
    db.otpChallenges.push(challenge);
    writeLocalDb(db);
    return challenge;
  }

  ensureSupabaseConfigured();
  const existing = await supabaseRequest(`otp_challenges?role=eq.${encodeURIComponent(challenge.role)}&purpose=eq.${encodeURIComponent(challenge.purpose)}&email=eq.${encodeURIComponent(challenge.email || '')}&mobile=eq.${encodeURIComponent(challenge.mobile || '')}`);
  await Promise.all((existing || []).map((item) => supabaseRequest(`otp_challenges?id=eq.${item.id}`, { method: 'DELETE' })));
  const [created] = await supabaseRequest('otp_challenges', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      id: challenge.id,
      role: challenge.role,
      purpose: challenge.purpose,
      email: challenge.email,
      mobile: challenge.mobile,
      otp: challenge.otp,
      created_at: challenge.createdAt,
      expires_at: new Date(challenge.expiresAt).toISOString()
    }]
  });
  return created;
}

async function findOtpChallenge(role, purpose, challengeId) {
  if (!isSupabaseMode()) {
    const db = cleanupExpiredChallenges(readLocalDb());
    writeLocalDb(db);
    return db.otpChallenges.find((item) => item.id === challengeId && item.role === role && item.purpose === purpose) || null;
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`otp_challenges?id=eq.${encodeURIComponent(challengeId)}&role=eq.${encodeURIComponent(role)}&purpose=eq.${encodeURIComponent(purpose)}&limit=1`);
  if (!rows?.[0]) return null;
  const row = rows[0];
  return {
    id: row.id,
    role: row.role,
    purpose: row.purpose,
    email: row.email,
    mobile: row.mobile,
    otp: row.otp,
    createdAt: row.created_at,
    expiresAt: new Date(row.expires_at).getTime()
  };
}

async function deleteOtpChallenge(challengeId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    db.otpChallenges = db.otpChallenges.filter((item) => item.id !== challengeId);
    writeLocalDb(db);
    return;
  }

  ensureSupabaseConfigured();
  await supabaseRequest(`otp_challenges?id=eq.${encodeURIComponent(challengeId)}`, { method: 'DELETE' });
}

async function createPatient(record) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    db.users.push(record);
    writeLocalDb(db);
    return record;
  }

  ensureSupabaseConfigured();
  const [created] = await supabaseRequest('patients', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      id: record.id,
      role: record.role,
      full_name: record.fullName,
      email: record.email,
      mobile: record.mobile,
      gender: record.gender,
      age: record.age,
      blood_group: record.bloodGroup || '',
      allergies: record.allergies || '',
      medical_history: record.medicalHistory || '',
      emergency_contact_name: record.emergencyContactName || '',
      emergency_contact_phone: record.emergencyContactPhone || '',
      password_hash: record.passwordHash,
      created_at: record.createdAt
    }]
  });
  return normalizePatient(created);
}

async function getPatientById(patientId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return db.users.find((user) => user.id === patientId) || null;
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`patients?id=eq.${encodeURIComponent(patientId)}&limit=1`);
  return rows?.[0] ? normalizePatient(rows[0]) : null;
}

async function updatePatientProfile(patientId, updates) {
  const payload = {
    bloodGroup: updates.bloodGroup ?? '',
    allergies: updates.allergies ?? '',
    medicalHistory: updates.medicalHistory ?? '',
    emergencyContactName: updates.emergencyContactName ?? '',
    emergencyContactPhone: updates.emergencyContactPhone ?? ''
  };

  if (!isSupabaseMode()) {
    const db = readLocalDb();
    const patient = db.users.find((user) => user.id === patientId);
    if (!patient) return null;
    patient.bloodGroup = payload.bloodGroup;
    patient.allergies = payload.allergies;
    patient.medicalHistory = payload.medicalHistory;
    patient.emergencyContactName = payload.emergencyContactName;
    patient.emergencyContactPhone = payload.emergencyContactPhone;
    writeLocalDb(db);
    return patient;
  }

  ensureSupabaseConfigured();
  const [updated] = await supabaseRequest(`patients?id=eq.${encodeURIComponent(patientId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: {
      blood_group: payload.bloodGroup,
      allergies: payload.allergies,
      medical_history: payload.medicalHistory,
      emergency_contact_name: payload.emergencyContactName,
      emergency_contact_phone: payload.emergencyContactPhone
    }
  });
  return updated ? normalizePatient(updated) : null;
}

async function createDoctor(record) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    db.doctors.push(record);
    writeLocalDb(db);
    return record;
  }

  ensureSupabaseConfigured();
  const [created] = await supabaseRequest('doctors', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      id: record.id,
      role: record.role,
      full_name: record.fullName,
      email: record.email,
      mobile: record.mobile,
      specialty: record.specialty,
      license_number: record.licenseNumber,
      clinic: record.clinic,
      status: record.status,
      password_hash: record.passwordHash,
      created_at: record.createdAt
    }]
  });
  return normalizeDoctor(created);
}

async function updatePassword(role, accountId, passwordHash) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    const collection = role === 'patient' ? db.users : db.doctors;
    const account = collection.find((item) => item.id === accountId);
    if (!account) return false;
    account.passwordHash = passwordHash;
    writeLocalDb(db);
    return true;
  }

  ensureSupabaseConfigured();
  const table = role === 'patient' ? 'patients' : 'doctors';
  const [updated] = await supabaseRequest(`${table}?id=eq.${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: { password_hash: passwordHash }
  });
  return Boolean(updated);
}

async function getAdminOverview() {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return {
      totalDoctors: db.doctors.length,
      pendingDoctors: db.doctors.filter((doctor) => doctor.status === 'pending').length,
      approvedDoctors: db.doctors.filter((doctor) => doctor.status === 'approved').length,
      rejectedDoctors: db.doctors.filter((doctor) => doctor.status === 'rejected').length,
      totalPatients: db.users.length,
      totalConsultations: db.consultations.length,
      scheduledConsultations: db.consultations.filter((consultation) => consultation.status === 'scheduled').length,
      activeConsultations: db.consultations.filter((consultation) => consultation.status === 'active').length,
      completedConsultations: db.consultations.filter((consultation) => consultation.status === 'completed').length,
      totalReports: db.reports.length,
      totalPrescriptions: db.prescriptions.length
    };
  }

  ensureSupabaseConfigured();
  const [doctors, patients, consultations, reports, prescriptions] = await Promise.all([
    supabaseRequest('doctors?select=id,status'),
    supabaseRequest('patients?select=id'),
    supabaseRequest('consultations?select=id,status'),
    supabaseRequest('reports?select=id'),
    supabaseRequest('prescriptions?select=id')
  ]);
  return {
    totalDoctors: doctors.length,
    pendingDoctors: doctors.filter((doctor) => doctor.status === 'pending').length,
    approvedDoctors: doctors.filter((doctor) => doctor.status === 'approved').length,
    rejectedDoctors: doctors.filter((doctor) => doctor.status === 'rejected').length,
    totalPatients: patients.length,
    totalConsultations: consultations.length,
    scheduledConsultations: consultations.filter((consultation) => consultation.status === 'scheduled').length,
    activeConsultations: consultations.filter((consultation) => consultation.status === 'active').length,
    completedConsultations: consultations.filter((consultation) => consultation.status === 'completed').length,
    totalReports: reports.length,
    totalPrescriptions: prescriptions.length
  };
}

function filterByQuery(items, query, fields) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => fields.some((field) => String(item[field] || '').toLowerCase().includes(q)));
}

async function searchDoctors(query = '') {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return filterByQuery(db.doctors, query, ['fullName', 'email', 'mobile', 'specialty', 'licenseNumber', 'status']);
  }

  ensureSupabaseConfigured();
  const doctors = await supabaseRequest('doctors?order=created_at.desc');
  return filterByQuery(doctors.map(normalizeDoctor), query, ['fullName', 'email', 'mobile', 'specialty', 'licenseNumber', 'status']);
}

async function searchPatients(query = '') {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return filterByQuery(db.users, query, ['fullName', 'email', 'mobile', 'gender', 'age']);
  }

  ensureSupabaseConfigured();
  const patients = await supabaseRequest('patients?order=created_at.desc');
  return filterByQuery(patients.map(normalizePatient), query, ['fullName', 'email', 'mobile', 'gender', 'age']);
}

async function updateDoctorStatus(doctorId, status) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    const doctor = db.doctors.find((item) => item.id === doctorId);
    if (!doctor) return null;
    doctor.status = status;
    writeLocalDb(db);
    return doctor;
  }

  ensureSupabaseConfigured();
  const [updated] = await supabaseRequest(`doctors?id=eq.${encodeURIComponent(doctorId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: { status }
  });
  return updated ? normalizeDoctor(updated) : null;
}

async function deleteDoctor(doctorId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    const before = db.doctors.length;
    db.doctors = db.doctors.filter((doctor) => doctor.id !== doctorId);
    writeLocalDb(db);
    return db.doctors.length !== before;
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`doctors?id=eq.${encodeURIComponent(doctorId)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });
  return Boolean(rows?.length);
}

async function deletePatient(patientId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    const before = db.users.length;
    db.users = db.users.filter((user) => user.id !== patientId);
    writeLocalDb(db);
    return db.users.length !== before;
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`patients?id=eq.${encodeURIComponent(patientId)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });
  return Boolean(rows?.length);
}

async function createConsultation(record) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    db.consultations.push(record);
    writeLocalDb(db);
    return record;
  }

  ensureSupabaseConfigured();
  const [created] = await supabaseRequest('consultations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      id: record.id,
      user_id: record.userId,
      role: record.role,
      doctor_id: record.doctorId,
      doctor_name: record.doctorName,
      patient_name: record.patientName,
      email: record.email,
      phone: record.phone,
      consult_type: record.consultType,
      session_mode: record.sessionMode,
      status: record.status,
      chat_enabled: Boolean(record.chatEnabled),
      typing_role: record.typingRole || null,
      typing_at: record.typingAt || null,
      seen_by_doctor_at: record.seenByDoctorAt || null,
      seen_by_patient_at: record.seenByPatientAt || null,
      date_time: record.dateTime,
      scheduled_at: record.scheduledAt,
      symptoms: record.symptoms,
      created_at: record.createdAt
    }]
  });
  return normalizeConsultation(created);
}

async function getDoctorConsultations(doctorId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return db.consultations
      .filter((consultation) => consultation.doctorId === doctorId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`consultations?doctor_id=eq.${encodeURIComponent(doctorId)}&order=created_at.desc`);
  return rows.map(normalizeConsultation);
}

async function getPatientConsultations(patientId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return db.consultations
      .filter((consultation) => consultation.userId === patientId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`consultations?user_id=eq.${encodeURIComponent(patientId)}&order=created_at.desc`);
  return rows.map(normalizeConsultation);
}

async function updateConsultation(consultationId, updates) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    const consultation = db.consultations.find((item) => item.id === consultationId);
    if (!consultation) return null;
    Object.assign(consultation, updates);
    writeLocalDb(db);
    return consultation;
  }

  ensureSupabaseConfigured();
  const body = {};
  if ('dateTime' in updates) body.date_time = updates.dateTime;
  if ('scheduledAt' in updates) body.scheduled_at = updates.scheduledAt;
  if ('status' in updates) body.status = updates.status;
  if ('sessionMode' in updates) body.session_mode = updates.sessionMode;
  if ('symptoms' in updates) body.symptoms = updates.symptoms;
  if ('chatEnabled' in updates) body.chat_enabled = Boolean(updates.chatEnabled);
  if ('typingRole' in updates) body.typing_role = updates.typingRole;
  if ('typingAt' in updates) body.typing_at = updates.typingAt;
  if ('seenByDoctorAt' in updates) body.seen_by_doctor_at = updates.seenByDoctorAt;
  if ('seenByPatientAt' in updates) body.seen_by_patient_at = updates.seenByPatientAt;
  const [updated] = await supabaseRequest(`consultations?id=eq.${encodeURIComponent(consultationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body
  });
  return updated ? normalizeConsultation(updated) : null;
}

async function createPrescription(record) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    db.prescriptions.push(record);
    writeLocalDb(db);
    return record;
  }

  ensureSupabaseConfigured();
  const [created] = await supabaseRequest('prescriptions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      id: record.id,
      consultation_id: record.consultationId,
      patient_id: record.patientId,
      doctor_id: record.doctorId,
      doctor_name: record.doctorName,
      patient_name: record.patientName,
      medicines: record.medicines,
      dosage: record.dosage,
      instructions: record.instructions,
      follow_up_date: record.followUpDate,
      created_at: record.createdAt
    }]
  });
  return normalizePrescription(created);
}

async function getConsultationById(consultationId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return db.consultations.find((item) => item.id === consultationId) || null;
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`consultations?id=eq.${encodeURIComponent(consultationId)}&limit=1`);
  return rows?.[0] ? normalizeConsultation(rows[0]) : null;
}

async function createChatMessage(record) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    db.chatMessages.push(record);
    writeLocalDb(db);
    return record;
  }

  ensureSupabaseConfigured();
  const [created] = await supabaseRequest('chat_messages', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      id: record.id,
      consultation_id: record.consultationId,
      sender_role: record.senderRole,
      sender_name: record.senderName,
      message: record.message,
      attachment_name: record.attachmentName || null,
      attachment_data_url: record.attachmentDataUrl || null,
      attachment_mime_type: record.attachmentMimeType || null,
      created_at: record.createdAt
    }]
  });
  return normalizeChatMessage(created);
}

async function getConsultationMessages(consultationId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return db.chatMessages
      .filter((item) => item.consultationId === consultationId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`chat_messages?consultation_id=eq.${encodeURIComponent(consultationId)}&order=created_at.asc`);
  return rows.map(normalizeChatMessage);
}

async function createReport(record) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    db.reports.push(record);
    writeLocalDb(db);
    return record;
  }

  ensureSupabaseConfigured();
  let filePath = record.filePath || null;
  if (record.dataUrl) {
    filePath = buildReportFilePath(record);
    await supabaseStorageUpload(config.supabaseReportsBucket, filePath, record.dataUrl, record.mimeType || 'application/pdf');
  }
  const [created] = await supabaseRequest('reports', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      id: record.id,
      patient_id: record.patientId,
      patient_name: record.patientName,
      file_name: record.fileName,
      file_path: filePath,
      file_size: record.fileSize,
      mime_type: record.mimeType,
      source: record.source,
      category: record.category,
      data_url: null,
      created_at: record.createdAt
    }]
  });
  return normalizeReport(created);
}

async function getPatientReports(patientId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return db.reports
      .filter((item) => item.patientId === patientId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`reports?patient_id=eq.${encodeURIComponent(patientId)}&order=created_at.desc`);
  return rows.map(normalizeReport);
}

async function getReportById(reportId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return db.reports.find((item) => item.id === reportId) || null;
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`reports?id=eq.${encodeURIComponent(reportId)}&limit=1`);
  return rows?.[0] ? normalizeReport(rows[0]) : null;
}

async function updateReport(reportId, updates) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    const report = db.reports.find((item) => item.id === reportId);
    if (!report) return null;
    Object.assign(report, updates);
    writeLocalDb(db);
    return report;
  }

  ensureSupabaseConfigured();
  const body = {};
  if ('fileName' in updates) body.file_name = updates.fileName;
  if ('category' in updates) body.category = updates.category;
  if ('source' in updates) body.source = updates.source;
  const [updated] = await supabaseRequest(`reports?id=eq.${encodeURIComponent(reportId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body
  });
  return updated ? normalizeReport(updated) : null;
}

async function deleteReport(reportId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    const index = db.reports.findIndex((item) => item.id === reportId);
    if (index === -1) return false;
    db.reports.splice(index, 1);
    writeLocalDb(db);
    return true;
  }

  ensureSupabaseConfigured();
  const report = await getReportById(reportId);
  if (report?.filePath) {
    await supabaseStorageDelete(config.supabaseReportsBucket, report.filePath);
  }
  await supabaseRequest(`reports?id=eq.${encodeURIComponent(reportId)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
  return true;
}

async function getReportAccessUrl(report, expiresInSeconds = 900) {
  if (!report) return '';
  if (report.dataUrl) return report.dataUrl;
  if (!isSupabaseMode()) return '';
  if (!report.filePath) return '';
  ensureSupabaseConfigured();
  return await supabaseStorageCreateSignedUrl(config.supabaseReportsBucket, report.filePath, expiresInSeconds);
}

async function getDoctorPrescriptions(doctorId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return db.prescriptions
      .filter((item) => item.doctorId === doctorId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`prescriptions?doctor_id=eq.${encodeURIComponent(doctorId)}&order=created_at.desc`);
  return rows.map(normalizePrescription);
}

async function getPatientPrescriptions(patientId) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    return db.prescriptions
      .filter((item) => item.patientId === patientId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  ensureSupabaseConfigured();
  const rows = await supabaseRequest(`prescriptions?patient_id=eq.${encodeURIComponent(patientId)}&order=created_at.desc`);
  return rows.map(normalizePrescription);
}

async function createDeviceReading(record) {
  if (!isSupabaseMode()) {
    const db = readLocalDb();
    db.deviceReadings.push(record);
    db.deviceReadings = db.deviceReadings.slice(-1000);
    writeLocalDb(db);
    return record;
  }

  ensureSupabaseConfigured();
  const [created] = await supabaseRequest('device_readings', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      id: record.id,
      user_id: record.userId,
      role: record.role,
      source: record.source,
      heart_rate: record.heartRate,
      blood_pressure: record.bloodPressure,
      spo2: record.spo2,
      temperature: record.temperature,
      raw: record.raw,
      created_at: record.createdAt
    }]
  });
  return normalizeReading(created);
}

function normalizePatient(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role || 'patient',
    fullName: row.full_name ?? row.fullName,
    email: row.email,
    mobile: row.mobile,
    gender: row.gender,
    age: row.age,
    bloodGroup: row.blood_group ?? row.bloodGroup ?? '',
    allergies: row.allergies ?? '',
    medicalHistory: row.medical_history ?? row.medicalHistory ?? '',
    emergencyContactName: row.emergency_contact_name ?? row.emergencyContactName ?? '',
    emergencyContactPhone: row.emergency_contact_phone ?? row.emergencyContactPhone ?? '',
    passwordHash: row.password_hash ?? row.passwordHash,
    createdAt: row.created_at ?? row.createdAt
  };
}

function normalizeDoctor(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role || 'doctor',
    fullName: row.full_name ?? row.fullName,
    email: row.email,
    mobile: row.mobile,
    specialty: row.specialty,
    licenseNumber: row.license_number ?? row.licenseNumber,
    clinic: row.clinic,
    status: row.status,
    passwordHash: row.password_hash ?? row.passwordHash,
    createdAt: row.created_at ?? row.createdAt
  };
}

function normalizeConsultation(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? row.userId,
    role: row.role,
    doctorId: row.doctor_id ?? row.doctorId,
    doctorName: row.doctor_name ?? row.doctorName,
    patientName: row.patient_name ?? row.patientName,
    email: row.email,
    phone: row.phone,
    consultType: row.consult_type ?? row.consultType,
    sessionMode: row.session_mode ?? row.sessionMode ?? row.consult_type ?? row.consultType,
    status: row.status ?? 'requested',
    chatEnabled: row.chat_enabled ?? row.chatEnabled ?? false,
    typingRole: row.typing_role ?? row.typingRole ?? null,
    typingAt: row.typing_at ?? row.typingAt ?? null,
    seenByDoctorAt: row.seen_by_doctor_at ?? row.seenByDoctorAt ?? null,
    seenByPatientAt: row.seen_by_patient_at ?? row.seenByPatientAt ?? null,
    dateTime: row.date_time ?? row.dateTime,
    scheduledAt: row.scheduled_at ?? row.scheduledAt ?? row.date_time ?? row.dateTime,
    symptoms: row.symptoms,
    createdAt: row.created_at ?? row.createdAt
  };
}

function normalizePrescription(row) {
  if (!row) return null;
  return {
    id: row.id,
    consultationId: row.consultation_id ?? row.consultationId,
    patientId: row.patient_id ?? row.patientId,
    doctorId: row.doctor_id ?? row.doctorId,
    doctorName: row.doctor_name ?? row.doctorName,
    patientName: row.patient_name ?? row.patientName,
    medicines: row.medicines,
    dosage: row.dosage,
    instructions: row.instructions,
    followUpDate: row.follow_up_date ?? row.followUpDate,
    createdAt: row.created_at ?? row.createdAt
  };
}

function normalizeReading(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? row.userId,
    role: row.role,
    source: row.source,
    heartRate: row.heart_rate ?? row.heartRate,
    bloodPressure: row.blood_pressure ?? row.bloodPressure,
    spo2: row.spo2,
    temperature: row.temperature,
    raw: row.raw,
    createdAt: row.created_at ?? row.createdAt
  };
}

function normalizeChatMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    consultationId: row.consultation_id ?? row.consultationId,
    senderRole: row.sender_role ?? row.senderRole,
    senderName: row.sender_name ?? row.senderName,
    message: row.message,
    attachmentName: row.attachment_name ?? row.attachmentName ?? null,
    attachmentDataUrl: row.attachment_data_url ?? row.attachmentDataUrl ?? null,
    attachmentMimeType: row.attachment_mime_type ?? row.attachmentMimeType ?? null,
    createdAt: row.created_at ?? row.createdAt
  };
}

function normalizeReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id ?? row.patientId,
    patientName: row.patient_name ?? row.patientName,
    fileName: row.file_name ?? row.fileName,
    filePath: row.file_path ?? row.filePath ?? '',
    fileSize: row.file_size ?? row.fileSize,
    mimeType: row.mime_type ?? row.mimeType,
    source: row.source,
    category: row.category,
    dataUrl: row.data_url ?? row.dataUrl,
    createdAt: row.created_at ?? row.createdAt
  };
}

module.exports = {
  isSupabaseMode,
  getApprovedDoctors,
  findAccountByIdentifier,
  createOtpChallenge,
  findOtpChallenge,
  deleteOtpChallenge,
  createPatient,
  getPatientById,
  updatePatientProfile,
  createDoctor,
  updatePassword,
  getAdminOverview,
  searchDoctors,
  searchPatients,
  updateDoctorStatus,
  deleteDoctor,
  deletePatient,
  createConsultation,
  createDeviceReading,
  getDoctorConsultations,
  getPatientConsultations,
  updateConsultation,
  getConsultationById,
  createPrescription,
  getDoctorPrescriptions,
  getPatientPrescriptions,
  createChatMessage,
  getConsultationMessages,
  createReport,
  getPatientReports,
  getReportById,
  getReportAccessUrl,
  updateReport,
  deleteReport
};
