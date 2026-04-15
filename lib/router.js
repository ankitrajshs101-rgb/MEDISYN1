const crypto = require('crypto');
const url = require('url');
const { config } = require('./config');
const {
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
  getPatientPrescriptions,
  createChatMessage,
  getConsultationMessages,
  createReport,
  getPatientReports,
  getReportById,
  getReportAccessUrl,
  updateReport,
  deleteReport
} = require('./store');
const { hashPassword, verifyPassword, createSignedToken, createTwilioVideoAccessToken, verifySignedToken, randomId, generateOtp } = require('./security');
const { deliverOtp } = require('./otp');
const liveClients = new Map();

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length);
}

function getJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function normalizePhone(value = '') {
  return value.trim();
}

function publicUser(user) {
  return {
    id: user.id,
    role: user.role,
    fullName: user.fullName,
    email: user.email,
    mobile: user.mobile,
    gender: user.gender,
    age: user.age,
    bloodGroup: user.bloodGroup || '',
    allergies: user.allergies || '',
    medicalHistory: user.medicalHistory || '',
    emergencyContactName: user.emergencyContactName || '',
    emergencyContactPhone: user.emergencyContactPhone || '',
    createdAt: user.createdAt
  };
}

function publicDoctor(doctor) {
  return {
    id: doctor.id,
    role: doctor.role,
    fullName: doctor.fullName,
    email: doctor.email,
    mobile: doctor.mobile,
    specialty: doctor.specialty,
    licenseNumber: doctor.licenseNumber,
    clinic: doctor.clinic,
    status: doctor.status,
    createdAt: doctor.createdAt
  };
}

function requireAdmin(req) {
  const token = getBearerToken(req);
  const payload = verifySignedToken(token, config.adminSecret);
  if (!payload || payload.type !== 'admin') {
    return null;
  }
  return payload;
}

function requireUser(req) {
  const token = getBearerToken(req);
  const payload = verifySignedToken(token, config.sessionSecret);
  if (!payload || payload.type !== 'session') {
    return null;
  }
  return payload;
}

function verifySessionToken(token) {
  const payload = verifySignedToken(token, config.sessionSecret);
  if (!payload || payload.type !== 'session') {
    return null;
  }
  return payload;
}

function emitLiveEvent(matchFn, payload) {
  for (const client of liveClients.values()) {
    if (!matchFn(client)) continue;
    try {
      client.res.write(`event: update\n`);
      client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (error) {
      try {
        client.res.end();
      } catch (endError) {
        // noop
      }
      liveClients.delete(client.id);
    }
  }
}

function emitSessionEvent(session, payload) {
  emitLiveEvent(
    (client) => client.userId === session.userId && client.role === session.role,
    payload
  );
}

function emitConsultationEvent(consultation, payload) {
  emitLiveEvent(
    (client) => (
      (consultation.userId && client.userId === consultation.userId && client.role === 'patient')
      || (consultation.doctorId && client.userId === consultation.doctorId && client.role === 'doctor')
    ),
    payload
  );
}

async function handleEventStream(req, res, token) {
  const session = verifySessionToken(token);
  if (!session) {
    sendJson(res, 401, { error: 'Login required.' });
    return;
  }

  const clientId = randomId('stream');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  res.write(`event: ready\n`);
  res.write(`data: ${JSON.stringify({ ok: true, role: session.role, userId: session.userId })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 20000);

  liveClients.set(clientId, {
    id: clientId,
    userId: session.userId,
    role: session.role,
    res
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    liveClients.delete(clientId);
  });
}

async function handleRequestOtp(req, res) {
  const body = await getJsonBody(req);
  const { role, purpose, email, mobile, identifier } = body;
  const resolvedEmail = (email || identifier || '').trim().toLowerCase();
  const resolvedMobile = normalizePhone(mobile || identifier || '');

  if (!role || !purpose) {
    sendJson(res, 400, { error: 'Role and purpose are required.' });
    return;
  }

  if (purpose === 'signup') {
    if (!resolvedEmail || !resolvedMobile) {
      sendJson(res, 400, { error: 'Email and mobile are required for signup OTP.' });
      return;
    }

    const existingByEmail = await findAccountByIdentifier(role, resolvedEmail);
    const existingByMobile = await findAccountByIdentifier(role, resolvedMobile);
    if (existingByEmail || existingByMobile) {
      sendJson(res, 409, { error: 'Account already exists.' });
      return;
    }
  }

  if (purpose === 'reset') {
    const existing = await findAccountByIdentifier(role, resolvedEmail || identifier || '') || await findAccountByIdentifier(role, resolvedMobile || identifier || '');
    if (!existing) {
      sendJson(res, 404, { error: 'No account found for this user.' });
      return;
    }
  }

  const challenge = {
    id: randomId('otp'),
    role,
    purpose,
    email: resolvedEmail,
    mobile: resolvedMobile,
    otp: generateOtp(),
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + 10 * 60 * 1000
  };

  const delivery = await deliverOtp({
    email: resolvedEmail,
    mobile: resolvedMobile,
    otp: challenge.otp,
    purpose
  });

  await createOtpChallenge(challenge);

  sendJson(res, 200, {
    challengeId: challenge.id,
    delivery,
    message: 'OTP dispatched.'
  });
}

async function handleRegister(req, res) {
  const body = await getJsonBody(req);
  const { role, challengeId, otp, user } = body;
  if (!role || !challengeId || !otp || !user) {
    sendJson(res, 400, { error: 'Missing registration fields.' });
    return;
  }

  const challenge = await findOtpChallenge(role, 'signup', challengeId);
  if (!challenge || challenge.expiresAt < Date.now() || challenge.otp !== otp) {
    sendJson(res, 400, { error: 'OTP invalid or expired.' });
    return;
  }

  let createdRecord = null;

  if (role === 'patient') {
    createdRecord = await createPatient({
      id: randomId('patient'),
      role: 'patient',
      fullName: user.fullName,
      email: challenge.email,
      mobile: challenge.mobile,
      gender: user.gender || '',
      age: user.age || '',
      passwordHash: hashPassword(user.password),
      createdAt: new Date().toISOString()
    });
  } else {
    createdRecord = await createDoctor({
      id: randomId('doctor'),
      role: 'doctor',
      fullName: user.fullName,
      email: challenge.email,
      mobile: challenge.mobile,
      specialty: user.specialty || '',
      licenseNumber: user.licenseNumber || '',
      clinic: user.clinic || '',
      status: 'pending',
      passwordHash: hashPassword(user.password),
      createdAt: new Date().toISOString()
    });
  }

  await deleteOtpChallenge(challengeId);

  if (role === 'doctor') {
    sendJson(res, 201, {
      role,
      user: publicDoctor(createdRecord),
      message: 'Doctor account created and pending owner approval.'
    });
    return;
  }

  const token = createSignedToken(
    { type: 'session', role: 'patient', userId: createdRecord.id },
    config.sessionSecret
  );

  sendJson(res, 201, {
    role,
    token,
    user: publicUser(createdRecord),
    message: 'Account created successfully.'
  });
}

async function handleLogin(req, res) {
  const body = await getJsonBody(req);
  const { role, identifier, password } = body;
  const account = await findAccountByIdentifier(role, identifier || '');

  if (!account || !verifyPassword(password || '', account.passwordHash)) {
    sendJson(res, 401, { error: 'Invalid credentials.' });
    return;
  }

  if (role === 'doctor' && account.status !== 'approved') {
    sendJson(res, 403, { error: `Doctor account is ${account.status}.` });
    return;
  }

  const token = createSignedToken(
    { type: 'session', role, userId: account.id },
    config.sessionSecret
  );

  sendJson(res, 200, {
    token,
    role,
    user: role === 'doctor' ? publicDoctor(account) : publicUser(account)
  });
}

async function handleResetPassword(req, res) {
  const body = await getJsonBody(req);
  const { role, challengeId, otp, newPassword } = body;

  const challenge = await findOtpChallenge(role, 'reset', challengeId);
  if (!challenge || challenge.expiresAt < Date.now() || challenge.otp !== otp) {
    sendJson(res, 400, { error: 'OTP invalid or expired.' });
    return;
  }

  const account = await findAccountByIdentifier(role, challenge.email || challenge.mobile);
  if (!account) {
    sendJson(res, 404, { error: 'No account found for this user.' });
    return;
  }

  const updated = await updatePassword(role, account.id, hashPassword(newPassword));
  if (!updated) {
    sendJson(res, 400, { error: 'Password update failed.' });
    return;
  }

  await deleteOtpChallenge(challengeId);
  sendJson(res, 200, { message: 'Password reset successfully.' });
}

async function handleAdminLogin(req, res) {
  const body = await getJsonBody(req);
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (email !== config.ownerEmail || password !== config.ownerPassword) {
    sendJson(res, 401, { error: 'Owner credentials are invalid.' });
    return;
  }

  const token = createSignedToken(
    { type: 'admin', email: config.ownerEmail },
    config.adminSecret
  );

  sendJson(res, 200, {
    token,
    ownerEmail: config.ownerEmail
  });
}

async function handleConsultation(req, res, session) {
  const body = await getJsonBody(req);
  const consultation = await createConsultation({
    id: randomId('consult'),
    userId: session.userId,
    role: session.role,
    doctorId: body.doctorId || '',
    doctorName: body.doctorName || '',
    patientName: body.patientName,
    email: body.email,
    phone: body.phone,
    consultType: body.consultType,
    sessionMode: body.sessionMode || body.consultType || 'Video Consultation',
    status: 'requested',
    chatEnabled: false,
    dateTime: body.dateTime,
    scheduledAt: body.dateTime,
    symptoms: body.symptoms,
    createdAt: new Date().toISOString()
  });

  emitConsultationEvent(consultation, {
    type: 'consultation.created',
    consultationId: consultation.id,
    doctorId: consultation.doctorId,
    patientId: consultation.userId
  });
  sendJson(res, 201, { message: 'Consultation booked.', consultation });
}

async function handleDoctorConsultations(req, res, session) {
  if (session.role !== 'doctor') {
    sendJson(res, 403, { error: 'Doctor access required.' });
    return;
  }

  const consultations = await getDoctorConsultations(session.userId);
  sendJson(res, 200, { consultations });
}

async function handlePatientOverview(req, res, session) {
  if (session.role !== 'patient') {
    sendJson(res, 403, { error: 'Patient access required.' });
    return;
  }

  const [consultations, prescriptions, patient] = await Promise.all([
    getPatientConsultations(session.userId),
    getPatientPrescriptions(session.userId),
    getPatientById(session.userId)
  ]);

  const reports = await getPatientReports(session.userId);
  sendJson(res, 200, {
    consultations,
    prescriptions,
    reports,
    profile: patient ? publicUser(patient) : null
  });
}

async function handlePatientProfileUpdate(req, res, session) {
  if (session.role !== 'patient') {
    sendJson(res, 403, { error: 'Patient access required.' });
    return;
  }

  const body = await getJsonBody(req);
  const updated = await updatePatientProfile(session.userId, {
    bloodGroup: body.bloodGroup,
    allergies: body.allergies,
    medicalHistory: body.medicalHistory,
    emergencyContactName: body.emergencyContactName,
    emergencyContactPhone: body.emergencyContactPhone
  });

  if (!updated) {
    sendJson(res, 404, { error: 'Patient profile not found.' });
    return;
  }

  sendJson(res, 200, {
    message: 'Profile updated successfully.',
    profile: publicUser(updated)
  });
  emitSessionEvent(session, {
    type: 'patient.profile.updated',
    patientId: session.userId
  });
}

async function handlePatientReports(req, res, session) {
  if (session.role !== 'patient') {
    sendJson(res, 403, { error: 'Patient access required.' });
    return;
  }

  if (req.method === 'GET') {
    const reports = await getPatientReports(session.userId);
    sendJson(res, 200, { reports });
    return;
  }

  const body = await getJsonBody(req);
  if (!Array.isArray(body.reports) || !body.reports.length) {
    sendJson(res, 400, { error: 'At least one report is required.' });
    return;
  }

  const createdReports = [];
  for (const report of body.reports) {
    createdReports.push(await createReport({
      id: randomId('report'),
      patientId: session.userId,
      patientName: session.role === 'patient' ? (body.patientName || '') : '',
      fileName: report.fileName,
      fileSize: report.fileSize,
      mimeType: report.mimeType,
      source: report.source || 'Patient Upload',
      category: report.category || 'Medical Report',
      dataUrl: report.dataUrl,
      createdAt: new Date().toISOString()
    }));
  }

  const consultations = await getPatientConsultations(session.userId);
  const doctorIds = [...new Set(consultations.map((item) => item.doctorId).filter(Boolean))];
  emitLiveEvent(
    (client) => (client.role === 'patient' && client.userId === session.userId) || (client.role === 'doctor' && doctorIds.includes(client.userId)),
    {
      type: 'reports.updated',
      patientId: session.userId
    }
  );
  sendJson(res, 201, { message: 'Reports uploaded.', reports: createdReports });
}

async function handleDoctorPatientReports(req, res, session, patientId) {
  if (session.role !== 'doctor') {
    sendJson(res, 403, { error: 'Doctor access required.' });
    return;
  }

  const consultations = await getDoctorConsultations(session.userId);
  const hasAccess = consultations.some((item) => item.userId === patientId);
  if (!hasAccess) {
    sendJson(res, 403, { error: 'Doctor cannot access reports for this patient.' });
    return;
  }

  const reports = await getPatientReports(patientId);
  sendJson(res, 200, { reports });
}

async function handleDoctorPatientHistory(req, res, session, patientId) {
  if (session.role !== 'doctor') {
    sendJson(res, 403, { error: 'Doctor access required.' });
    return;
  }

  const consultations = await getDoctorConsultations(session.userId);
  const patientConsultations = consultations.filter((item) => item.userId === patientId);
  if (!patientConsultations.length) {
    sendJson(res, 403, { error: 'Doctor cannot access history for this patient.' });
    return;
  }

  const [patient, reports, prescriptions] = await Promise.all([
    getPatientById(patientId),
    getPatientReports(patientId),
    getPatientPrescriptions(patientId)
  ]);

  sendJson(res, 200, {
    patient: patient ? publicUser(patient) : null,
    consultations: patientConsultations,
    reports,
    prescriptions: prescriptions.filter((item) => item.doctorId === session.userId)
  });
}

async function handleReportUpdate(req, res, session, reportId) {
  const report = await getReportById(reportId);
  if (!report) {
    sendJson(res, 404, { error: 'Report not found.' });
    return;
  }

  if (session.role === 'patient') {
    if (report.patientId !== session.userId) {
      sendJson(res, 403, { error: 'Not allowed to update this report.' });
      return;
    }
  } else if (session.role === 'doctor') {
    const consultations = await getDoctorConsultations(session.userId);
    const hasAccess = consultations.some((item) => item.userId === report.patientId);
    if (!hasAccess) {
      sendJson(res, 403, { error: 'Doctor cannot update this report.' });
      return;
    }
  } else {
    sendJson(res, 403, { error: 'Not allowed to update this report.' });
    return;
  }

  const body = await getJsonBody(req);
  if (!body.fileName || !String(body.fileName).trim()) {
    sendJson(res, 400, { error: 'File name is required.' });
    return;
  }

  const safeName = String(body.fileName).trim().toLowerCase().endsWith('.pdf')
    ? String(body.fileName).trim()
    : `${String(body.fileName).trim()}.pdf`;

  const updated = await updateReport(reportId, { fileName: safeName });
  emitLiveEvent(
    (client) => (
      (client.role === 'patient' && client.userId === report.patientId)
      || (session.role === 'doctor' && client.role === 'doctor' && client.userId === session.userId)
    ),
    {
      type: 'report.updated',
      patientId: report.patientId,
      reportId
    }
  );
  sendJson(res, 200, { message: 'Report updated.', report: updated || report });
}

async function handleReportDelete(req, res, session, reportId) {
  const report = await getReportById(reportId);
  if (!report) {
    sendJson(res, 404, { error: 'Report not found.' });
    return;
  }

  if (session.role !== 'patient' || report.patientId !== session.userId) {
    sendJson(res, 403, { error: 'Only the patient who uploaded this report can delete it.' });
    return;
  }

  await deleteReport(reportId);
  const consultations = await getPatientConsultations(report.patientId);
  const doctorIds = [...new Set(consultations.map((item) => item.doctorId).filter(Boolean))];
  emitLiveEvent(
    (client) => (client.role === 'patient' && client.userId === report.patientId) || (client.role === 'doctor' && doctorIds.includes(client.userId)),
    {
      type: 'report.deleted',
      patientId: report.patientId,
      reportId
    }
  );
  sendJson(res, 200, { message: 'Report deleted successfully.' });
}

async function handleReportAccess(req, res, session, reportId) {
  const report = await getReportById(reportId);
  if (!report) {
    sendJson(res, 404, { error: 'Report not found.' });
    return;
  }

  if (session.role === 'patient') {
    if (report.patientId !== session.userId) {
      sendJson(res, 403, { error: 'Not allowed to access this report.' });
      return;
    }
  } else if (session.role === 'doctor') {
    const consultations = await getDoctorConsultations(session.userId);
    const hasAccess = consultations.some((item) => item.userId === report.patientId);
    if (!hasAccess) {
      sendJson(res, 403, { error: 'Doctor cannot access this report.' });
      return;
    }
  } else {
    sendJson(res, 403, { error: 'Not allowed to access this report.' });
    return;
  }

  const url = await getReportAccessUrl(report);
  if (!url) {
    sendJson(res, 400, { error: 'No accessible file is available for this report yet.' });
    return;
  }

  sendJson(res, 200, {
    url,
    fileName: report.fileName,
    filePath: report.filePath || '',
    mimeType: report.mimeType || 'application/pdf'
  });
}

async function handleDoctorSchedule(req, res, session, consultationId) {
  if (session.role !== 'doctor') {
    sendJson(res, 403, { error: 'Doctor access required.' });
    return;
  }

  const body = await getJsonBody(req);
  if (!body.scheduledAt) {
    sendJson(res, 400, { error: 'Scheduled date and time are required.' });
    return;
  }

  const updated = await updateConsultation(consultationId, {
    scheduledAt: body.scheduledAt,
    dateTime: body.scheduledAt,
    sessionMode: body.sessionMode || body.consultType || 'Video Consultation',
    status: 'scheduled'
  });

  if (!updated) {
    sendJson(res, 404, { error: 'Consultation not found.' });
    return;
  }

  emitConsultationEvent(updated, {
    type: 'consultation.scheduled',
    consultationId: updated.id,
    patientId: updated.userId,
    doctorId: updated.doctorId
  });
  sendJson(res, 200, { message: 'Consultation scheduled.', consultation: updated });
}

async function handleDoctorStatusUpdate(req, res, session, consultationId) {
  if (session.role !== 'doctor') {
    sendJson(res, 403, { error: 'Doctor access required.' });
    return;
  }

  const consultation = await getConsultationById(consultationId);
  if (!consultation || consultation.doctorId !== session.userId) {
    sendJson(res, 404, { error: 'Consultation not found.' });
    return;
  }

  const body = await getJsonBody(req);
  const nextStatus = String(body.status || '').trim().toLowerCase();
  const allowedStatuses = new Set(['requested', 'scheduled', 'active', 'completed', 'cancelled']);
  if (!allowedStatuses.has(nextStatus)) {
    sendJson(res, 400, { error: 'Invalid consultation status.' });
    return;
  }

  const updates = { status: nextStatus };
  if (nextStatus === 'active' && !consultation.scheduledAt && consultation.dateTime) {
    updates.scheduledAt = consultation.dateTime;
  }
  if (nextStatus === 'cancelled') {
    updates.typingRole = null;
    updates.typingAt = null;
  }

  const updated = await updateConsultation(consultationId, updates);
  if (!updated) {
    sendJson(res, 404, { error: 'Consultation not found.' });
    return;
  }

  emitConsultationEvent(updated, {
    type: 'consultation.status',
    consultationId: updated.id,
    status: updated.status,
    patientId: updated.userId,
    doctorId: updated.doctorId
  });
  sendJson(res, 200, {
    message: `Consultation marked as ${nextStatus}.`,
    consultation: updated
  });
}

async function handleDoctorPrescription(req, res, session) {
  if (session.role !== 'doctor') {
    sendJson(res, 403, { error: 'Doctor access required.' });
    return;
  }

  const body = await getJsonBody(req);
  if (!body.patientId || !body.consultationId || !body.medicines) {
    sendJson(res, 400, { error: 'Patient, consultation, and medicines are required.' });
    return;
  }

  const prescription = await createPrescription({
    id: randomId('rx'),
    consultationId: body.consultationId,
    patientId: body.patientId,
    doctorId: session.userId,
    doctorName: body.doctorName || '',
    patientName: body.patientName || '',
    medicines: body.medicines,
    dosage: body.dosage || '',
    instructions: body.instructions || '',
    followUpDate: body.followUpDate || '',
    createdAt: new Date().toISOString()
  });

  const consultation = await getConsultationById(body.consultationId);
  if (consultation) {
    emitConsultationEvent(consultation, {
      type: 'prescription.created',
      consultationId: consultation.id,
      patientId: consultation.userId,
      doctorId: consultation.doctorId
    });
  }
  sendJson(res, 201, { message: 'Prescription saved.', prescription });
}

async function handleDoctorChatEnable(req, res, session, consultationId) {
  if (session.role !== 'doctor') {
    sendJson(res, 403, { error: 'Doctor access required.' });
    return;
  }

  const consultation = await getConsultationById(consultationId);
  if (!consultation || consultation.doctorId !== session.userId) {
    sendJson(res, 404, { error: 'Consultation not found.' });
    return;
  }

  const updated = await updateConsultation(consultationId, { chatEnabled: true });
  if (updated) {
    emitConsultationEvent(updated, {
      type: 'chat.enabled',
      consultationId: updated.id,
      patientId: updated.userId,
      doctorId: updated.doctorId
    });
  }
  sendJson(res, 200, { message: 'Chat enabled for patient.', consultation: updated });
}

async function handleConsultationMessages(req, res, session, consultationId) {
  const consultation = await getConsultationById(consultationId);
  if (!consultation) {
    sendJson(res, 404, { error: 'Consultation not found.' });
    return;
  }

  const isDoctorOwner = session.role === 'doctor' && consultation.doctorId === session.userId;
  const isPatientOwner = session.role === 'patient' && consultation.userId === session.userId;
  if (!isDoctorOwner && !isPatientOwner) {
    sendJson(res, 403, { error: 'Not allowed to access this chat.' });
    return;
  }

  if (!consultation.chatEnabled && !isDoctorOwner) {
    sendJson(res, 403, { error: 'Doctor has not enabled chat for this consultation yet.' });
    return;
  }

  if (req.method === 'GET') {
    const seenUpdate = session.role === 'doctor'
      ? { seenByDoctorAt: new Date().toISOString(), typingRole: null, typingAt: null }
      : { seenByPatientAt: new Date().toISOString(), typingRole: null, typingAt: null };
    const updatedConsultation = await updateConsultation(consultationId, seenUpdate);
    const messages = await getConsultationMessages(consultationId);
    sendJson(res, 200, { consultation: updatedConsultation || consultation, messages });
    return;
  }

  const body = await getJsonBody(req);
  if ((!body.message || !String(body.message).trim()) && !body.attachmentDataUrl) {
    sendJson(res, 400, { error: 'Message or attachment is required.' });
    return;
  }

  const message = await createChatMessage({
    id: randomId('chat'),
    consultationId,
    senderRole: session.role,
    senderName: session.role === 'doctor' ? `Dr. ${consultation.doctorName || ''}`.trim() : (consultation.patientName || 'Patient'),
    message: String(body.message || '').trim(),
    attachmentName: body.attachmentName || null,
    attachmentDataUrl: body.attachmentDataUrl || null,
    attachmentMimeType: body.attachmentMimeType || null,
    createdAt: new Date().toISOString()
  });

  const updatedConsultation = await updateConsultation(consultationId, {
    typingRole: null,
    typingAt: null
  });

  emitConsultationEvent(updatedConsultation || consultation, {
    type: 'chat.message',
    consultationId: consultation.id,
    patientId: consultation.userId,
    doctorId: consultation.doctorId,
    senderRole: session.role
  });
  sendJson(res, 201, { message: 'Chat message sent.', chatMessage: message, consultation: updatedConsultation || consultation });
}

async function handleChatTyping(req, res, session, consultationId) {
  const consultation = await getConsultationById(consultationId);
  if (!consultation) {
    sendJson(res, 404, { error: 'Consultation not found.' });
    return;
  }

  const isDoctorOwner = session.role === 'doctor' && consultation.doctorId === session.userId;
  const isPatientOwner = session.role === 'patient' && consultation.userId === session.userId;
  if (!isDoctorOwner && !isPatientOwner) {
    sendJson(res, 403, { error: 'Not allowed to access this chat.' });
    return;
  }

  const body = await getJsonBody(req);
  const active = Boolean(body.active);
  const updated = await updateConsultation(consultationId, {
    typingRole: active ? session.role : null,
    typingAt: active ? new Date().toISOString() : null
  });

  emitConsultationEvent(updated || consultation, {
    type: 'chat.typing',
    consultationId: consultation.id,
    patientId: consultation.userId,
    doctorId: consultation.doctorId,
    senderRole: session.role,
    active
  });
  sendJson(res, 200, { consultation: updated || consultation });
}

async function handleDeviceReading(req, res, session) {
  const body = await getJsonBody(req);
  const reading = await createDeviceReading({
    id: randomId('reading'),
    userId: session.userId,
    role: session.role,
    source: body.source || 'esp32-bluetooth',
    heartRate: body.heartRate ?? null,
    bloodPressure: body.bloodPressure ?? null,
    spo2: body.spo2 ?? null,
    temperature: body.temperature ?? null,
    raw: body.raw || null,
    createdAt: new Date().toISOString()
  });

  sendJson(res, 201, { message: 'Reading stored.', reading });
}

async function handleConsultationVideoToken(req, res, session, consultationId) {
  if (!config.twilioAccountSid || !config.twilioApiKey || !config.twilioApiSecret) {
    sendJson(res, 503, { error: 'Twilio video credentials are not configured on the server.' });
    return;
  }

  const consultation = await getConsultationById(consultationId);
  if (!consultation) {
    sendJson(res, 404, { error: 'Consultation not found.' });
    return;
  }

  const isDoctorOwner = session.role === 'doctor' && consultation.doctorId === session.userId;
  const isPatientOwner = session.role === 'patient' && consultation.userId === session.userId;
  if (!isDoctorOwner && !isPatientOwner) {
    sendJson(res, 403, { error: 'You cannot join this consultation room.' });
    return;
  }

  if (['completed', 'cancelled'].includes(String(consultation.status || '').toLowerCase())) {
    sendJson(res, 400, { error: `This consultation is already ${consultation.status}.` });
    return;
  }

  const identityBase = session.role === 'doctor'
    ? `doctor-${session.userId}`
    : `patient-${session.userId}`;
  const identity = `${identityBase}-${crypto.randomBytes(4).toString('hex')}`;
  const roomName = `consult_${consultation.id}`;
  const token = createTwilioVideoAccessToken({
    accountSid: config.twilioAccountSid,
    apiKey: config.twilioApiKey,
    apiSecret: config.twilioApiSecret,
    identity,
    roomName
  });

  if (!token) {
    sendJson(res, 500, { error: 'Unable to generate a Twilio room token right now.' });
    return;
  }

  const otherParticipantName = isDoctorOwner
    ? (consultation.patientName || 'Patient')
    : (consultation.doctorName || 'Doctor');

  sendJson(res, 200, {
    token,
    roomName,
    identity,
    roomType: config.twilioVideoRoomType,
    consultationId: consultation.id,
    consultationStatus: consultation.status || 'requested',
    otherParticipantName
  });
}

async function handleApiRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/events') {
      await handleEventStream(req, res, parsedUrl.query.token || '');
      return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'medisync-api',
        databaseProvider: config.databaseProvider
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/config/public') {
      sendJson(res, 200, {
        bleServiceUuid: config.bleServiceUuid,
        bleCharacteristicUuid: config.bleCharacteristicUuid,
        videoProvider: config.twilioAccountSid && config.twilioApiKey && config.twilioApiSecret ? 'twilio' : '',
        twilioVideoEnabled: Boolean(config.twilioAccountSid && config.twilioApiKey && config.twilioApiSecret),
        ownerAdminOnly: true
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/doctors') {
      const doctors = await getApprovedDoctors();
      sendJson(res, 200, {
        doctors: doctors.map(publicDoctor)
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/request-otp') {
      await handleRequestOtp(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/register') {
      await handleRegister(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      await handleLogin(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/reset-password') {
      await handleResetPassword(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/admin/login') {
      await handleAdminLogin(req, res);
      return;
    }

    if (pathname.startsWith('/api/admin/')) {
      const admin = requireAdmin(req);
      if (!admin) {
        sendJson(res, 401, { error: 'Owner authorization required.' });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/overview') {
        const stats = await getAdminOverview();
        sendJson(res, 200, { stats });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/doctors') {
        const doctors = await searchDoctors(parsedUrl.query.q);
        sendJson(res, 200, { doctors: doctors.map(publicDoctor) });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/patients') {
        const patients = await searchPatients(parsedUrl.query.q);
        sendJson(res, 200, { patients: patients.map(publicUser) });
        return;
      }

      const approveMatch = pathname.match(/^\/api\/admin\/doctors\/([^/]+)\/(approve|reject)$/);
      if (req.method === 'POST' && approveMatch) {
        const [, doctorId, action] = approveMatch;
        const updatedDoctor = await updateDoctorStatus(doctorId, action === 'approve' ? 'approved' : 'rejected');
        if (!updatedDoctor) {
          sendJson(res, 404, { error: 'Doctor not found.' });
          return;
        }
        sendJson(res, 200, { doctor: publicDoctor(updatedDoctor) });
        return;
      }

      const deleteDoctorMatch = pathname.match(/^\/api\/admin\/doctors\/([^/]+)$/);
      if (req.method === 'DELETE' && deleteDoctorMatch) {
        const removed = await deleteDoctor(deleteDoctorMatch[1]);
        sendJson(res, removed ? 200 : 404, removed ? { message: 'Doctor deleted.' } : { error: 'Doctor not found.' });
        return;
      }

      const deletePatientMatch = pathname.match(/^\/api\/admin\/patients\/([^/]+)$/);
      if (req.method === 'DELETE' && deletePatientMatch) {
        const removed = await deletePatient(deletePatientMatch[1]);
        sendJson(res, removed ? 200 : 404, removed ? { message: 'Patient deleted.' } : { error: 'Patient not found.' });
        return;
      }
    }

    if (pathname.startsWith('/api/')) {
      const session = requireUser(req);

      if (req.method === 'POST' && pathname === '/api/consultations') {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleConsultation(req, res, session);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/device/readings') {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleDeviceReading(req, res, session);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/doctor/consultations') {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleDoctorConsultations(req, res, session);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/patient/overview') {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handlePatientOverview(req, res, session);
        return;
      }

      if ((req.method === 'PATCH' || req.method === 'POST') && pathname === '/api/patient/profile') {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handlePatientProfileUpdate(req, res, session);
        return;
      }

      if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/patient/reports') {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handlePatientReports(req, res, session);
        return;
      }

      const doctorReportsMatch = pathname.match(/^\/api\/doctor\/patients\/([^/]+)\/reports$/);
      if (req.method === 'GET' && doctorReportsMatch) {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleDoctorPatientReports(req, res, session, doctorReportsMatch[1]);
        return;
      }

      const doctorHistoryMatch = pathname.match(/^\/api\/doctor\/patients\/([^/]+)\/history$/);
      if (req.method === 'GET' && doctorHistoryMatch) {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleDoctorPatientHistory(req, res, session, doctorHistoryMatch[1]);
        return;
      }

      const reportMatch = pathname.match(/^\/api\/reports\/([^/]+)$/);
      const reportAccessMatch = pathname.match(/^\/api\/reports\/([^/]+)\/access$/);
      if (req.method === 'GET' && reportAccessMatch) {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleReportAccess(req, res, session, reportAccessMatch[1]);
        return;
      }
      if (req.method === 'PATCH' && reportMatch) {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleReportUpdate(req, res, session, reportMatch[1]);
        return;
      }
      if (req.method === 'DELETE' && reportMatch) {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleReportDelete(req, res, session, reportMatch[1]);
        return;
      }

      const scheduleMatch = pathname.match(/^\/api\/doctor\/consultations\/([^/]+)\/schedule$/);
      if (req.method === 'POST' && scheduleMatch) {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleDoctorSchedule(req, res, session, scheduleMatch[1]);
        return;
      }

      const doctorStatusMatch = pathname.match(/^\/api\/doctor\/consultations\/([^/]+)\/status$/);
      if (req.method === 'POST' && doctorStatusMatch) {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleDoctorStatusUpdate(req, res, session, doctorStatusMatch[1]);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/doctor/prescriptions') {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleDoctorPrescription(req, res, session);
        return;
      }

      const chatEnableMatch = pathname.match(/^\/api\/doctor\/consultations\/([^/]+)\/chat-enable$/);
      if (req.method === 'POST' && chatEnableMatch) {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleDoctorChatEnable(req, res, session, chatEnableMatch[1]);
        return;
      }

      const chatMatch = pathname.match(/^\/api\/consultations\/([^/]+)\/chat$/);
      if ((req.method === 'GET' || req.method === 'POST') && chatMatch) {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleConsultationMessages(req, res, session, chatMatch[1]);
        return;
      }

      const typingMatch = pathname.match(/^\/api\/consultations\/([^/]+)\/chat\/typing$/);
      if (req.method === 'POST' && typingMatch) {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleChatTyping(req, res, session, typingMatch[1]);
        return;
      }

      const videoTokenMatch = pathname.match(/^\/api\/consultations\/([^/]+)\/video-token$/);
      if (req.method === 'POST' && videoTokenMatch) {
        if (!session) {
          sendJson(res, 401, { error: 'Login required.' });
          return;
        }
        await handleConsultationVideoToken(req, res, session, videoTokenMatch[1]);
        return;
      }
    }

    sendJson(res, 404, { error: 'Endpoint not found.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
}

module.exports = { handleApiRequest };
