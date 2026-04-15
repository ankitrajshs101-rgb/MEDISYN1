const state = {
    sessionToken: sessionStorage.getItem('medisync_session_token') || '',
    adminToken: sessionStorage.getItem('medisync_admin_token') || '',
    currentUser: JSON.parse(sessionStorage.getItem('medisync_current_user') || 'null'),
    currentRole: sessionStorage.getItem('medisync_current_role') || '',
    ownerEmail: sessionStorage.getItem('medisync_owner_email') || '',
    authFlowMode: 'signin',
    pendingSignup: null,
    pendingReset: null,
    otpBusy: {
        patient: false,
        doctor: false,
        reset: false
    },
    otpCooldownUntil: {
        patient: 0,
        doctor: 0,
        reset: 0
    },
    uploadedFiles: [],
    publicConfig: {
        bleServiceUuid: '',
        bleCharacteristicUuid: '',
        videoProvider: '',
        twilioVideoEnabled: false
    },
    currentBleDevice: null,
    currentBleServer: null,
    currentBleCharacteristic: null,
    vitalsInterval: null,
    localStream: null,
    twilioRoom: null,
    activeCallConsultation: null,
    activeCallMode: '',
    isMicActive: true,
    isCamActive: true,
    selectedDoctor: null,
    selectedConsultation: null,
    doctorsCatalog: [],
    chatAttachment: null,
    chatRefreshTimer: null,
    chatTypingTimer: null,
    portalRefreshTimer: null,
    chatLastMessageAt: '',
    chatLastNotificationAt: '',
    liveEventSource: null,
    liveEventRetryTimer: null,
    aiConsultationMessages: JSON.parse(sessionStorage.getItem('medisync_ai_consultation_messages') || '[]'),
    aiConsultationContext: JSON.parse(sessionStorage.getItem('medisync_ai_consultation_context') || '{"language":"english","age":"","duration":"","severity":"","temperature":"","score":"5"}')
};

const OTP_COOLDOWN_MS = 30000;
const CHAT_REFRESH_MS = 2500;
const PORTAL_REFRESH_MS = 12000;
const PRESCRIPTION_LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect width="120" height="120" rx="22" fill="#ffffff"/>
  <path d="M60 95c-2.4 0-4.7-.9-6.5-2.6L30 69.8c-7.5-7.2-7.7-19.1-.4-26.5 7-7.1 18.2-7.6 25.8-1.4L60 46l4.6-4.1c7.6-6.2 18.8-5.7 25.8 1.4 7.3 7.4 7.1 19.3-.4 26.5L66.5 92.4A9.3 9.3 0 0 1 60 95Z" fill="#3b82f6"/>
  <path d="M27 58h18l6-10 8 23 8-15 4 8h22" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const PRESCRIPTION_WATERMARK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 120 120">
  <path d="M60 95c-2.4 0-4.7-.9-6.5-2.6L30 69.8c-7.5-7.2-7.7-19.1-.4-26.5 7-7.1 18.2-7.6 25.8-1.4L60 46l4.6-4.1c7.6-6.2 18.8-5.7 25.8 1.4 7.3 7.4 7.1 19.3-.4 26.5L66.5 92.4A9.3 9.3 0 0 1 60 95Z" fill="#93c5fd"/>
  <path d="M27 58h18l6-10 8 23 8-15 4 8h22" fill="none" stroke="#dbeafe" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

let prescriptionLogoPromise = null;
let prescriptionWatermarkPromise = null;

function qs(id) {
    return document.getElementById(id);
}

function html(container, value) {
    if (container) container.innerHTML = value;
}

function text(container, value) {
    if (container) container.textContent = value;
}

function syncCurrentUserProfile(profile = {}) {
    if (!profile || !state.currentUser) return;
    state.currentUser = { ...state.currentUser, ...profile };
    sessionStorage.setItem('medisync_current_user', JSON.stringify(state.currentUser));
}

function normalizeSearchTerm(value = '') {
    return value.trim().toLowerCase();
}

function slugStatus(value = '') {
    return String(value || 'requested').trim().toLowerCase().replace(/\s+/g, '-');
}

function canJoinConsultation(consultation = {}) {
    const status = String(consultation.status || 'requested').trim().toLowerCase();
    return !['completed', 'cancelled'].includes(status);
}

function getChatSeenKey(consultationId) {
    return `medisync_chat_seen_${state.currentRole}_${consultationId}`;
}

function getPatientReportsKey(patientId) {
    return `medisync_patient_reports_${patientId}`;
}

function markChatSeen(consultationId) {
    localStorage.setItem(getChatSeenKey(consultationId), new Date().toISOString());
}

function getChatSeenTime(consultationId) {
    return localStorage.getItem(getChatSeenKey(consultationId)) || '';
}

function formatCountdown(dateValue) {
    if (!dateValue) return 'Schedule pending';
    const target = new Date(dateValue);
    if (Number.isNaN(target.getTime())) return 'Schedule pending';
    const diff = target.getTime() - Date.now();
    if (diff <= 0) return 'Starting soon';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h left`;
    if (hours > 0) return `${hours}h ${minutes}m left`;
    return `${minutes}m left`;
}

function getPrescriptionLogoDataUrl() {
    if (prescriptionLogoPromise) return prescriptionLogoPromise;
    prescriptionLogoPromise = new Promise((resolve) => {
        const svgBlob = new Blob([PRESCRIPTION_LOGO_SVG], { type: 'image/svg+xml' });
        const blobUrl = URL.createObjectURL(svgBlob);
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 120;
            canvas.height = 120;
            const context = canvas.getContext('2d');
            if (!context) {
                URL.revokeObjectURL(blobUrl);
                resolve(null);
                return;
            }
            context.drawImage(image, 0, 0, 120, 120);
            URL.revokeObjectURL(blobUrl);
            resolve(canvas.toDataURL('image/png'));
        };
        image.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            resolve(null);
        };
        image.src = blobUrl;
    });
    return prescriptionLogoPromise;
}

function getPrescriptionWatermarkDataUrl() {
    if (prescriptionWatermarkPromise) return prescriptionWatermarkPromise;
    prescriptionWatermarkPromise = new Promise((resolve) => {
        const svgBlob = new Blob([PRESCRIPTION_WATERMARK_SVG], { type: 'image/svg+xml' });
        const blobUrl = URL.createObjectURL(svgBlob);
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 240;
            canvas.height = 240;
            const context = canvas.getContext('2d');
            if (!context) {
                URL.revokeObjectURL(blobUrl);
                resolve(null);
                return;
            }
            context.clearRect(0, 0, 240, 240);
            context.globalAlpha = 0.16;
            context.drawImage(image, 0, 0, 240, 240);
            URL.revokeObjectURL(blobUrl);
            resolve(canvas.toDataURL('image/png'));
        };
        image.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            resolve(null);
        };
        image.src = blobUrl;
    });
    return prescriptionWatermarkPromise;
}

async function resolveReportAccessUrl(report) {
    if (!report) return '';
    if (report.accessUrl) return report.accessUrl;
    if (report.dataUrl) {
        report.accessUrl = report.dataUrl;
        return report.accessUrl;
    }
    if (!report.id) return '';
    const response = await apiRequest(`/api/reports/${report.id}/access`, { auth: 'user' });
    report.accessUrl = response.url || '';
    return report.accessUrl;
}

async function openReportViewerDuplicate(report) {
    if (!report) return;
    state.selectedReport = report;
    text(qs('reportViewerName'), report.fileName || report.name || 'Patient Report');
    text(
        qs('reportViewerDetails'),
        `${report.category || 'Medical Report'} • ${(((report.fileSize ?? report.size) || 0) / 1024).toFixed(1)} KB • ${new Date(report.createdAt || report.uploadedAt || Date.now()).toLocaleString()}`
    );
    const accessUrl = await resolveReportAccessUrl(report);
    if (qs('reportViewerFrame')) qs('reportViewerFrame').src = accessUrl || '';
    if (qs('reportViewerOpenLink')) qs('reportViewerOpenLink').href = accessUrl || '#';
    if (qs('reportViewerDownloadLink')) {
        qs('reportViewerDownloadLink').href = accessUrl || '#';
        qs('reportViewerDownloadLink').download = report.fileName || report.name || 'patient-report.pdf';
    }
    if (qs('reportRenameInput')) qs('reportRenameInput').value = (report.fileName || report.name || '').replace(/\.pdf$/i, '');
    const canRename = state.currentRole === 'doctor';
    if (qs('openReportRenameModalBtn')) qs('openReportRenameModalBtn').style.display = canRename ? 'inline-flex' : 'none';
    openModal('reportViewerModal');
}

async function openReportViewer(report) {
    if (!report) return;
    state.selectedReport = report;
    text(qs('reportViewerName'), report.fileName || report.name || 'Patient Report');
    text(
        qs('reportViewerDetails'),
        `${report.category || 'Medical Report'} • ${(((report.fileSize ?? report.size) || 0) / 1024).toFixed(1)} KB • ${new Date(report.createdAt || report.uploadedAt || Date.now()).toLocaleString()}`
    );
    const accessUrl = await resolveReportAccessUrl(report);
    if (qs('reportViewerFrame')) qs('reportViewerFrame').src = accessUrl || '';
    if (qs('reportViewerOpenLink')) qs('reportViewerOpenLink').href = accessUrl || '#';
    if (qs('reportViewerDownloadLink')) {
        qs('reportViewerDownloadLink').href = accessUrl || '#';
        qs('reportViewerDownloadLink').download = report.fileName || report.name || 'patient-report.pdf';
    }
    if (qs('reportRenameInput')) qs('reportRenameInput').value = (report.fileName || report.name || '').replace(/\.pdf$/i, '');
    const canRename = state.currentRole === 'doctor';
    if (qs('openReportRenameModalBtn')) qs('openReportRenameModalBtn').style.display = canRename ? 'inline-flex' : 'none';
    openModal('reportViewerModal');
}

function openReportRenameModal() {
    if (!state.selectedReport || state.currentRole !== 'doctor') return;
    const currentName = state.selectedReport.fileName || state.selectedReport.name || 'patient-report.pdf';
    if (qs('reportRenameInput')) {
        qs('reportRenameInput').value = currentName.replace(/\.pdf$/i, '');
    }
    text(qs('reportRenameCurrentName'), currentName);
    text(qs('reportRenamePreviewName'), currentName);
    openModal('reportRenameModal');
}

function updateReportRenamePreview() {
    const inputValue = qs('reportRenameInput')?.value.trim() || '';
    const fallbackName = state.selectedReport?.fileName || state.selectedReport?.name || 'patient-report.pdf';
    const previewName = inputValue ? `${inputValue.replace(/\.pdf$/i, '')}.pdf` : fallbackName;
    text(qs('reportRenamePreviewName'), previewName);
}

async function updateConsultationStatus(consultationId, status) {
    const response = await apiRequest(`/api/doctor/consultations/${consultationId}/status`, {
        method: 'POST',
        auth: 'user',
        body: { status }
    });
    showNotification(response.message || `Consultation updated to ${status}.`, 'success');
    await loadDoctorConsultations(qs('doctorPortalSearchInput')?.value || '');
}

function clearChatTimers() {
    if (state.chatRefreshTimer) {
        window.clearInterval(state.chatRefreshTimer);
        state.chatRefreshTimer = null;
    }
    if (state.chatTypingTimer) {
        window.clearTimeout(state.chatTypingTimer);
        state.chatTypingTimer = null;
    }
    state.chatLastMessageAt = '';
    state.chatLastNotificationAt = '';
}

function clearPortalRefreshTimer() {
    if (state.portalRefreshTimer) {
        window.clearInterval(state.portalRefreshTimer);
        state.portalRefreshTimer = null;
    }
}

function closeLiveUpdates() {
    if (state.liveEventSource) {
        state.liveEventSource.close();
        state.liveEventSource = null;
    }
    if (state.liveEventRetryTimer) {
        window.clearTimeout(state.liveEventRetryTimer);
        state.liveEventRetryTimer = null;
    }
}

function queuePortalRefresh() {
    if (qs('patientPortal')?.style.display === 'block' && state.currentRole === 'patient') {
        loadPatientOverview().catch(() => {});
        return;
    }
    if (qs('doctorPortal')?.style.display === 'block' && state.currentRole === 'doctor') {
        loadDoctorConsultations(qs('doctorPortalSearchInput')?.value || '').catch(() => {});
    }
}

function handleLiveEventMessage(payload) {
    if (!payload?.type) return;

    const isChatEvent = payload.consultationId && state.selectedConsultation?.id === payload.consultationId;
    if (isChatEvent) {
        loadChatThread(payload.consultationId).catch(() => {});
    }

    if (payload.type === 'chat.message' && payload.senderRole && payload.senderRole !== state.currentRole) {
        showNotification('New consultation message received.', 'info');
    }

    if (payload.type === 'consultation.scheduled' && state.currentRole === 'patient') {
        showNotification('Your doctor scheduled a consultation update.', 'success');
    }

    if (payload.type === 'prescription.created' && state.currentRole === 'patient') {
        showNotification('A new prescription is now available.', 'success');
    }

    if (payload.type === 'chat.enabled' && state.currentRole === 'patient') {
        showNotification('Doctor enabled secure chat for your consultation.', 'success');
    }

    queuePortalRefresh();
}

function startLiveUpdates() {
    closeLiveUpdates();
    if (!state.sessionToken) return;

    const eventSource = new EventSource(`/api/events?token=${encodeURIComponent(state.sessionToken)}`);
    state.liveEventSource = eventSource;

    eventSource.addEventListener('ready', () => {
        if (state.liveEventRetryTimer) {
            window.clearTimeout(state.liveEventRetryTimer);
            state.liveEventRetryTimer = null;
        }
    });

    eventSource.addEventListener('update', (event) => {
        try {
            const payload = JSON.parse(event.data || '{}');
            handleLiveEventMessage(payload);
        } catch (error) {
            console.error(error);
        }
    });

    eventSource.onerror = () => {
        closeLiveUpdates();
        state.liveEventRetryTimer = window.setTimeout(() => {
            startLiveUpdates();
        }, 3000);
    };
}

function startPortalAutoRefresh() {
    clearPortalRefreshTimer();
    state.portalRefreshTimer = window.setInterval(() => {
        if (qs('patientPortal')?.style.display === 'block' && state.currentRole === 'patient') {
            loadPatientOverview().catch(() => {});
            return;
        }
        if (qs('doctorPortal')?.style.display === 'block' && state.currentRole === 'doctor') {
            loadDoctorConsultations(qs('doctorPortalSearchInput')?.value || '').catch(() => {});
        }
    }, PORTAL_REFRESH_MS);
}

function renderChatAttachmentPreview() {
    const preview = qs('chatAttachmentPreview');
    if (!preview) return;
    if (!state.chatAttachment) {
        preview.style.display = 'none';
        preview.innerHTML = '';
        return;
    }
    preview.style.display = 'flex';
    preview.innerHTML = `
        <div class="chat-attachment-chip">
            <i class="fas fa-paperclip"></i>
            <span>${state.chatAttachment.name}</span>
            <button type="button" id="removeChatAttachmentBtn"><i class="fas fa-times"></i></button>
        </div>
    `;
    qs('removeChatAttachmentBtn')?.addEventListener('click', () => {
        state.chatAttachment = null;
        renderChatAttachmentPreview();
    });
}

async function fileToAttachment(file) {
    return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            dataUrl: reader.result
        });
        reader.readAsDataURL(file);
    });
}

async function updateTypingState(active) {
    if (!state.selectedConsultation?.id) return;
    try {
        await apiRequest(`/api/consultations/${state.selectedConsultation.id}/chat/typing`, {
            method: 'POST',
            auth: 'user',
            body: { active }
        });
    } catch (error) {
        console.error(error);
    }
}

function downloadAllReportsForPatient(reports = []) {
    if (!reports.length) {
        showNotification('No reports available for this patient yet.', 'warning');
        return;
    }

    reports.forEach(async (report, index) => {
        const accessUrl = await resolveReportAccessUrl(report);
        window.setTimeout(() => {
            const link = document.createElement('a');
            link.href = accessUrl || '#';
            link.download = report.fileName || report.name || `patient-report-${index + 1}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
        }, index * 250);
    });

    showNotification(`Downloading ${reports.length} report${reports.length > 1 ? 's' : ''}.`, 'success');
}

function guessReportType(fileName = '') {
    const value = String(fileName).toLowerCase();
    if (value.includes('blood')) return 'Blood Test';
    if (value.includes('xray') || value.includes('scan') || value.includes('mri') || value.includes('ct')) return 'Imaging';
    if (value.includes('prescription')) return 'Prescription';
    if (value.includes('discharge')) return 'Discharge';
    if (value.endsWith('.pdf')) return 'PDF Report';
    return 'Medical Report';
}

function isPdfFile(file) {
    const name = String(file?.name || '').toLowerCase();
    return file?.type === 'application/pdf' || name.endsWith('.pdf');
}

function loadPatientReports() {
    return [];
}

function loadPatientReportsById(patientId) {
    return [];
}

function savePatientReports(reports) {
    return reports;
}

async function filesToReportEntries(files, source = 'Patient Upload') {
    const entries = await Promise.all(files.map((file) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            uploadedAt: new Date().toISOString(),
            source,
            category: guessReportType(file.name),
            dataUrl: reader.result
        });
        reader.readAsDataURL(file);
    })));
    return entries;
}

function buildRenamedPdfName(originalName, customName) {
    const trimmed = String(customName || '').trim();
    if (!trimmed) return originalName;
    return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

function requestReportRename(originalName) {
    const baseName = String(originalName || '').replace(/\.pdf$/i, '');
    const renamed = window.prompt('Change file name before upload', baseName);
    if (renamed === null) {
        return null;
    }
    return buildRenamedPdfName(originalName, renamed);
}

function renderPatientReports(reports = []) {
    const container = qs('patientReportsList');
    if (!container) return;
    if (!reports.length) {
        html(container, '<div class="patient-report-empty"><h4>No reports uploaded yet</h4><p>Upload blood tests, scans, prescriptions, or discharge summaries here for quick access.</p></div>');
        return;
    }

    html(container, reports.sort((a, b) => new Date(b.createdAt || b.uploadedAt) - new Date(a.createdAt || a.uploadedAt)).map((report) => `
        <article class="patient-report-card">
            <div class="patient-report-top">
                <div class="patient-report-icon"><i class="fas fa-file-pdf"></i></div>
                <div class="patient-report-meta">
                    <h4>${report.fileName || report.name}</h4>
                    <p>${report.category} • ${(((report.fileSize ?? report.size) || 0) / 1024).toFixed(1)} KB</p>
                </div>
            </div>
            <div class="patient-report-filename">File name: ${report.fileName || report.name}</div>
            <div class="patient-report-tags">
                <span>${report.source}</span>
                <span>${new Date(report.createdAt || report.uploadedAt).toLocaleDateString()}</span>
            </div>
            <div class="patient-report-actions">
                <button type="button" class="btn-primary patient-report-view-btn" data-id="${report.id}">View PDF</button>
                <button type="button" class="btn-outline patient-report-download-btn" data-id="${report.id}">Download</button>
                <button type="button" class="btn-outline patient-report-delete-btn" data-id="${report.id}">Delete</button>
            </div>
        </article>
    `).join(''));

    container.querySelectorAll('.patient-report-view-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            const report = reports.find((item) => item.id === button.dataset.id);
            await openReportViewer(report);
        });
    });
    container.querySelectorAll('.patient-report-download-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            const report = reports.find((item) => item.id === button.dataset.id);
            if (!report) return;
            const accessUrl = await resolveReportAccessUrl(report);
            if (!accessUrl) {
                showNotification('Unable to prepare this PDF right now.', 'error');
                return;
            }
            const link = document.createElement('a');
            link.href = accessUrl;
            link.download = report.fileName || report.name || 'patient-report.pdf';
            document.body.appendChild(link);
            link.click();
            link.remove();
        });
    });
    container.querySelectorAll('.patient-report-delete-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            const report = reports.find((item) => item.id === button.dataset.id);
            if (!report) return;
            const shouldDelete = window.confirm(`Delete "${report.fileName || report.name}"?`);
            if (!shouldDelete) return;
            try {
                await apiRequest(`/api/reports/${report.id}`, {
                    method: 'DELETE',
                    auth: 'user'
                });
                if (state.selectedReport?.id === report.id) {
                    closeModal('reportViewerModal');
                    closeModal('reportRenameModal');
                    state.selectedReport = null;
                }
                await loadPatientOverview();
                showNotification('Report deleted successfully.', 'success');
            } catch (error) {
                showNotification(error.message, 'error');
            }
        });
    });
}

function renderPatientProfileSummary(profile = {}) {
    const container = qs('patientProfileSummary');
    if (!container) return;
    const summaryCards = [
        {
            icon: 'fa-droplet',
            label: 'Blood Group',
            value: profile.bloodGroup || 'Add your blood group',
            support: 'Useful for emergencies and hospital coordination.'
        },
        {
            icon: 'fa-user',
            label: 'Basic Profile',
            value: `${profile.gender || 'Gender not set'} • ${profile.age || 'Age not set'}`,
            support: `Primary contact: ${profile.mobile || 'Not available'}`
        },
        {
            icon: 'fa-user-shield',
            label: 'Emergency Contact',
            value: profile.emergencyContactName || 'Add emergency contact name',
            support: profile.emergencyContactPhone || 'Add emergency contact phone number'
        },
        {
            icon: 'fa-allergies',
            label: 'Allergies',
            value: profile.allergies || 'No allergies added yet',
            support: 'Share food, medicine, or environmental sensitivities.'
        },
        {
            icon: 'fa-notes-medical',
            label: 'Medical History',
            value: profile.medicalHistory || 'No medical history added yet',
            support: 'Include chronic conditions, surgeries, or active treatment.',
            wide: true
        }
    ];

    html(container, summaryCards.map((card) => `
        <article class="patient-profile-card ${card.wide ? 'patient-profile-card-wide' : ''}">
            <span class="patient-profile-label"><i class="fas ${card.icon}"></i> ${card.label}</span>
            <div class="patient-profile-value">${card.value}</div>
            <p class="patient-profile-support">${card.support}</p>
        </article>
    `).join(''));
}

function renderPatientHistoryTimeline(consultations = [], prescriptions = [], reports = []) {
    const container = qs('patientHistoryTimeline');
    if (!container) return;

    const timelineItems = [
        ...consultations.map((item) => ({
            type: 'consultation',
            createdAt: item.createdAt || item.scheduledAt || item.dateTime || new Date().toISOString(),
            title: item.doctorName ? `Consultation with ${item.doctorName}` : 'Consultation requested',
            description: item.symptoms || 'No symptoms shared yet.',
            meta: [
                item.sessionMode || item.consultType || 'Consultation',
                item.status || 'requested',
                item.scheduledAt || item.dateTime || 'Awaiting schedule'
            ],
            icon: 'fa-calendar-check'
        })),
        ...prescriptions.map((item) => ({
            type: 'prescription',
            createdAt: item.createdAt || new Date().toISOString(),
            title: `Prescription from ${item.doctorName || 'Doctor'}`,
            description: item.medicines || 'Prescription generated.',
            meta: [
                'Medication plan',
                item.followUpDate ? `Follow-up ${item.followUpDate}` : 'Follow-up as advised'
            ],
            icon: 'fa-file-prescription'
        })),
        ...reports.map((item) => ({
            type: 'report',
            createdAt: item.createdAt || item.uploadedAt || new Date().toISOString(),
            title: item.fileName || item.name || 'Medical report uploaded',
            description: `${item.category || 'Medical Report'} added to your report library.`,
            meta: [
                item.source || 'Patient Upload',
                `${(((item.fileSize ?? item.size) || 0) / 1024).toFixed(1)} KB`
            ],
            icon: 'fa-file-pdf'
        }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (!timelineItems.length) {
        html(container, '<div class="patient-history-empty">Your medical timeline will appear here as soon as you book consultations, receive prescriptions, or upload reports.</div>');
        return;
    }

    html(container, timelineItems.map((item) => `
        <article class="patient-history-item">
            <div class="patient-history-icon ${item.type}"><i class="fas ${item.icon}"></i></div>
            <div class="patient-history-card">
                <div class="patient-history-top">
                    <div>
                        <h4>${item.title}</h4>
                        <p>${item.description}</p>
                    </div>
                    <span class="patient-history-date"><i class="fas fa-clock"></i> ${new Date(item.createdAt).toLocaleString()}</span>
                </div>
                <div class="patient-history-meta">
                    ${item.meta.filter(Boolean).map((entry) => `<span>${entry}</span>`).join('')}
                </div>
            </div>
        </article>
    `).join(''));
}

function renderDoctorPatientHistory(history = {}) {
    const profile = history.patient || {};
    const consultations = history.consultations || [];
    const prescriptions = history.prescriptions || [];
    const reports = history.reports || [];

    const timelineItems = [
        ...consultations.map((item) => ({
            type: 'consultation',
            createdAt: item.createdAt || item.scheduledAt || item.dateTime || new Date().toISOString(),
            title: item.sessionMode || item.consultType || 'Consultation',
            description: item.symptoms || 'No symptoms shared by the patient yet.',
            meta: [item.status || 'requested', item.scheduledAt || item.dateTime || 'Awaiting schedule'],
            icon: 'fa-calendar-check'
        })),
        ...prescriptions.map((item) => ({
            type: 'prescription',
            createdAt: item.createdAt || new Date().toISOString(),
            title: `Prescription by ${item.doctorName || 'Doctor'}`,
            description: item.medicines || 'Medication plan created.',
            meta: [item.followUpDate ? `Follow-up ${item.followUpDate}` : 'Follow-up as advised'],
            icon: 'fa-file-prescription'
        })),
        ...reports.map((item) => ({
            type: 'report',
            createdAt: item.createdAt || item.uploadedAt || new Date().toISOString(),
            title: item.fileName || item.name || 'Uploaded medical report',
            description: `${item.category || 'Medical Report'} shared with the doctor.`,
            meta: [item.source || 'Patient Upload'],
            icon: 'fa-file-pdf'
        }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);

    return `
        <section class="doctor-history-panel">
            <div class="doctor-history-header">
                <div>
                    <h4>Patient History Snapshot</h4>
                    <p>Quick access to profile basics, recent reports, prescriptions, and consultation events.</p>
                </div>
            </div>
            <div class="doctor-history-profile">
                <article class="doctor-history-profile-card">
                    <span>Blood Group</span>
                    <strong>${profile.bloodGroup || 'Not added yet'}</strong>
                </article>
                <article class="doctor-history-profile-card">
                    <span>Allergies</span>
                    <strong>${profile.allergies || 'No allergies shared'}</strong>
                </article>
                <article class="doctor-history-profile-card">
                    <span>Emergency Contact</span>
                    <strong>${profile.emergencyContactName || 'Not added'}${profile.emergencyContactPhone ? ` • ${profile.emergencyContactPhone}` : ''}</strong>
                </article>
                <article class="doctor-history-profile-card">
                    <span>Medical History</span>
                    <strong>${profile.medicalHistory || 'No medical history added yet'}</strong>
                </article>
            </div>
            <div class="doctor-history-timeline">
                ${timelineItems.length ? timelineItems.map((item) => `
                    <article class="doctor-history-row">
                        <div class="doctor-history-row-icon ${item.type}"><i class="fas ${item.icon}"></i></div>
                        <div class="doctor-history-row-card">
                            <div class="doctor-history-row-top">
                                <div>
                                    <h5>${item.title}</h5>
                                    <p>${item.description}</p>
                                </div>
                                <span class="doctor-history-row-date"><i class="fas fa-clock"></i> ${new Date(item.createdAt).toLocaleDateString()}</span>
                            </div>
                            <div class="doctor-history-row-meta">
                                ${item.meta.filter(Boolean).map((entry) => `<span>${entry}</span>`).join('')}
                            </div>
                        </div>
                    </article>
                `).join('') : '<div class="doctor-history-empty">This patient history will populate as reports, prescriptions, and consultation updates build over time.</div>'}
            </div>
        </section>
    `;
}

function renderAdminProgressStack(container, items = []) {
    if (!container) return;
    html(container, items.map((item) => `
        <article class="admin-progress-card">
            <div class="admin-progress-head">
                <span class="admin-progress-title">${item.label}</span>
                <span class="admin-progress-value">${item.value} • ${item.percent}%</span>
            </div>
            <div class="admin-progress-track">
                <div class="admin-progress-fill ${item.tone}" style="width:${item.percent}%;"></div>
            </div>
        </article>
    `).join(''));
}

function renderAdminVisuals(stats = {}) {
    const doctorTotal = Math.max(1, Number(stats.totalDoctors || 0));
    const consultationTotal = Math.max(1, Number(stats.totalConsultations || 0));

    renderAdminProgressStack(qs('adminDoctorPipeline'), [
        {
            label: 'Pending Approvals',
            value: Number(stats.pendingDoctors || 0),
            percent: Math.round((Number(stats.pendingDoctors || 0) / doctorTotal) * 100),
            tone: 'pending'
        },
        {
            label: 'Approved Doctors',
            value: Number(stats.approvedDoctors || 0),
            percent: Math.round((Number(stats.approvedDoctors || 0) / doctorTotal) * 100),
            tone: 'approved'
        },
        {
            label: 'Rejected Doctors',
            value: Number(stats.rejectedDoctors || 0),
            percent: Math.round((Number(stats.rejectedDoctors || 0) / doctorTotal) * 100),
            tone: 'rejected'
        }
    ]);

    renderAdminProgressStack(qs('adminCareFlow'), [
        {
            label: 'Scheduled Sessions',
            value: Number(stats.scheduledConsultations || 0),
            percent: Math.round((Number(stats.scheduledConsultations || 0) / consultationTotal) * 100),
            tone: 'scheduled'
        },
        {
            label: 'Active Care',
            value: Number(stats.activeConsultations || 0),
            percent: Math.round((Number(stats.activeConsultations || 0) / consultationTotal) * 100),
            tone: 'active'
        },
        {
            label: 'Completed Care',
            value: Number(stats.completedConsultations || 0),
            percent: Math.round((Number(stats.completedConsultations || 0) / consultationTotal) * 100),
            tone: 'completed'
        }
    ]);

    text(
        qs('adminDoctorPipelineCaption'),
        `${Number(stats.approvedDoctors || 0)} approved out of ${Number(stats.totalDoctors || 0)} doctors`
    );
    text(
        qs('adminCareFlowCaption'),
        `${Number(stats.completedConsultations || 0)} completed from ${Number(stats.totalConsultations || 0)} consultations`
    );
}

function openPatientProfileModal(profile = {}) {
    qs('patientBloodGroup').value = profile.bloodGroup || '';
    qs('patientAllergies').value = profile.allergies || '';
    qs('patientMedicalHistory').value = profile.medicalHistory || '';
    qs('patientEmergencyContactName').value = profile.emergencyContactName || '';
    qs('patientEmergencyContactPhone').value = profile.emergencyContactPhone || '';
    openModal('patientProfileModal');
}

async function submitPatientProfile(event) {
    event.preventDefault();
    const response = await apiRequest('/api/patient/profile', {
        method: 'PATCH',
        auth: 'user',
        body: {
            bloodGroup: qs('patientBloodGroup')?.value.trim() || '',
            allergies: qs('patientAllergies')?.value.trim() || '',
            medicalHistory: qs('patientMedicalHistory')?.value.trim() || '',
            emergencyContactName: qs('patientEmergencyContactName')?.value.trim() || '',
            emergencyContactPhone: qs('patientEmergencyContactPhone')?.value.trim() || ''
        }
    });
    syncCurrentUserProfile(response.profile);
    closeModal('patientProfileModal');
    await loadPatientOverview();
    showNotification(response.message || 'Profile updated successfully.', 'success');
}

async function addReportsToLibrary(files, source) {
    if (!files.length || !state.currentUser?.id) return [];
    const invalidFiles = files.filter((file) => !isPdfFile(file));
    if (invalidFiles.length) {
        throw new Error('Only PDF files are allowed in this reports section.');
    }
    const renamedFiles = [];
    for (const file of files) {
        const renamedFileName = requestReportRename(file.name);
        if (!renamedFileName) {
            continue;
        }
        renamedFiles.push({ file, renamedFileName });
    }
    if (!renamedFiles.length) {
        return [];
    }
    const newEntries = await filesToReportEntries(renamedFiles.map((item) => item.file), source);
    const preparedEntries = newEntries.map((entry, index) => ({
        ...entry,
        name: renamedFiles[index].renamedFileName
    }));
    const response = await apiRequest('/api/patient/reports', {
        method: 'POST',
        auth: 'user',
        body: {
            patientName: state.currentUser.fullName,
            reports: preparedEntries.map((report) => ({
                fileName: report.name,
                fileSize: report.size,
                mimeType: report.mimeType,
                source: report.source,
                category: report.category,
                dataUrl: report.dataUrl
            }))
        }
    });
    return response.reports || [];
}

function saveSession(role, user, token) {
    state.currentRole = role;
    state.currentUser = user;
    state.sessionToken = token;
    sessionStorage.setItem('medisync_current_role', role);
    sessionStorage.setItem('medisync_current_user', JSON.stringify(user));
    sessionStorage.setItem('medisync_session_token', token);
    startLiveUpdates();
}

function clearSession() {
    state.currentRole = '';
    state.currentUser = null;
    state.sessionToken = '';
    sessionStorage.removeItem('medisync_current_role');
    sessionStorage.removeItem('medisync_current_user');
    sessionStorage.removeItem('medisync_session_token');
    closeLiveUpdates();
}

function saveAdminSession(email, token) {
    state.ownerEmail = email;
    state.adminToken = token;
    sessionStorage.setItem('medisync_owner_email', email);
    sessionStorage.setItem('medisync_admin_token', token);
}

function clearAdminSession() {
    state.ownerEmail = '';
    state.adminToken = '';
    sessionStorage.removeItem('medisync_owner_email');
    sessionStorage.removeItem('medisync_admin_token');
}

async function apiRequest(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (options.auth === 'user' && state.sessionToken) {
        headers.Authorization = `Bearer ${state.sessionToken}`;
    }

    if (options.auth === 'admin' && state.adminToken) {
        headers.Authorization = `Bearer ${state.adminToken}`;
    }

    const response = await fetch(path, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Request failed.');
    }
    return data;
}

function showNotification(message, type = 'info') {
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    const el = document.createElement('div');
    el.className = 'notification';
    el.textContent = message;
    el.style.background = colors[type] || colors.info;
    el.style.animation = 'slideIn 0.3s ease';
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => el.remove(), 300);
    }, 3200);
}

function saveAiConsultationMessages() {
    sessionStorage.setItem('medisync_ai_consultation_messages', JSON.stringify(state.aiConsultationMessages));
}

function saveAiConsultationContext() {
    sessionStorage.setItem('medisync_ai_consultation_context', JSON.stringify(state.aiConsultationContext));
}

function normalizeAiContextDefaults() {
    state.aiConsultationContext = {
        language: 'english',
        age: '',
        duration: '',
        severity: '',
        temperature: '',
        score: '5',
        ...(state.aiConsultationContext || {})
    };
}

function ensureAiConsultationIntro() {
    if (state.aiConsultationMessages.length) return;
    normalizeAiContextDefaults();
    state.aiConsultationMessages = [
        {
            role: 'ai',
            title: 'Welcome to MediSync AI Care Guide',
            careLevel: 'Guidance',
            summary: 'Tell me your symptoms, age group, and how long you have been feeling unwell. I can provide first-step guidance, but I do not replace a licensed doctor.',
            actions: [
                'Describe your main symptom clearly',
                'Mention age group like child, adult, or older adult',
                'Tell me how long the problem has been present'
            ],
            followUp: 'What symptom is bothering you most right now?'
        }
    ];
    saveAiConsultationMessages();
}

function getAiCareLevelClass(level = '') {
    const safeLevel = String(level).toLowerCase();
    if (safeLevel.includes('emergency')) return 'emergency';
    if (safeLevel.includes('urgent')) return 'urgent';
    if (safeLevel.includes('doctor')) return 'doctor';
    if (safeLevel.includes('home')) return 'home';
    return 'guidance';
}

function renderAiConsultationGuidedChips() {
    normalizeAiContextDefaults();
    document.querySelectorAll('.ai-guided-chip').forEach((chip) => {
        const type = chip.dataset.type;
        const value = chip.dataset.value;
        chip.classList.toggle('active', state.aiConsultationContext?.[type] === value);
    });
    if (qs('aiTemperatureInput')) {
        qs('aiTemperatureInput').value = state.aiConsultationContext.temperature || '';
    }
    if (qs('aiSeverityScoreInput')) {
        qs('aiSeverityScoreInput').value = state.aiConsultationContext.score || '5';
    }
    text(qs('aiSeverityScoreValue'), `${state.aiConsultationContext.score || '5'}/10`);
}

function buildAiContextSummary() {
    normalizeAiContextDefaults();
    const parts = [];
    if (state.aiConsultationContext.language && state.aiConsultationContext.language !== 'english') parts.push(`reply in ${state.aiConsultationContext.language}`);
    if (state.aiConsultationContext.age) parts.push(`age group ${state.aiConsultationContext.age}`);
    if (state.aiConsultationContext.duration) parts.push(state.aiConsultationContext.duration);
    if (state.aiConsultationContext.severity) parts.push(`severity ${state.aiConsultationContext.severity}`);
    if (state.aiConsultationContext.temperature) parts.push(`temperature ${state.aiConsultationContext.temperature}`);
    if (state.aiConsultationContext.score) parts.push(`symptom score ${state.aiConsultationContext.score} out of 10`);
    return parts.join(', ');
}

function suggestDoctorSpecialty(textValue = '') {
    if (/(cough|sore throat|cold|ear|nose|sinus)/.test(textValue)) return 'ENT Specialist';
    if (/(skin|rash|itch|allergy)/.test(textValue)) return 'Dermatologist';
    if (/(stomach|vomit|loose motion|diarrhea|acidity|gas)/.test(textValue)) return 'Gastroenterologist';
    if (/(headache|dizziness|migraine)/.test(textValue)) return 'General Physician';
    if (/(fever|body pain|weakness|infection)/.test(textValue)) return 'General Physician';
    return 'General Physician';
}

function getAiNextStepLabel(item = {}) {
    const level = String(item.careLevel || '').toLowerCase();
    if (level.includes('emergency')) return 'Emergency help now';
    if (level.includes('urgent')) return 'Same-day medical review';
    if (level.includes('doctor')) return 'Book a doctor consultation';
    return 'Start with home care and symptom tracking';
}

function getAiRiskScore(item = {}) {
    const level = String(item.careLevel || '').toLowerCase();
    const score = Number(state.aiConsultationContext?.score || 5);
    if (level.includes('emergency') || score >= 9) return { label: 'Critical', className: 'critical' };
    if (level.includes('urgent') || score >= 7) return { label: 'High', className: 'high' };
    if (level.includes('doctor') || score >= 5) return { label: 'Medium', className: 'medium' };
    return { label: 'Low', className: 'low' };
}

function adaptAiText(text = '') {
    const language = String(state.aiConsultationContext?.language || 'english').toLowerCase();
    const raw = String(text || '');
    if (!raw) return raw;
    if (language === 'simple') {
        return raw
            .replace(/immediately/gi, 'right away')
            .replace(/monitor/gi, 'check')
            .replace(/symptoms/gi, 'problems')
            .replace(/consultation/gi, 'doctor visit');
    }
    if (language === 'hindi') {
        const translations = new Map([
            ['Emergency care is recommended', 'Emergency care ki zarurat ho sakti hai'],
            ['General first-step guidance', 'Pehle step ki basic guidance'],
            ['Fever guidance', 'Bukhar ke liye guidance'],
            ['Cough and sore throat guidance', 'Khansi aur gala dard guidance'],
            ['Stomach and dehydration guidance', 'Pet aur dehydration guidance'],
            ['Headache and dizziness guidance', 'Sir dard aur chakkar guidance'],
            ['Skin rash guidance', 'Skin rash guidance'],
            ['Book a doctor consultation', 'Doctor consultation book karein'],
            ['Same-day medical review', 'Aaj hi doctor review karayein'],
            ['Emergency help now', 'Abhi emergency madad lein'],
            ['Start with home care and symptom tracking', 'Abhi home care aur symptom tracking se start karein']
        ]);
        return translations.get(raw) || raw;
    }
    return raw;
}

function renderAiConsultationSummary() {
    const container = qs('aiConsultationSummary');
    if (!container) return;
    const latestAiMessage = [...state.aiConsultationMessages].reverse().find((item) => item.role === 'ai');
    const riskScore = getAiRiskScore(latestAiMessage || {});
    if (!latestAiMessage) {
        html(container, '');
        return;
    }

    html(container, latestAiMessage.title ? `
        <div class="ai-summary-card">
            <div class="ai-summary-top">
                <div>
                    <span class="ai-care-badge ${getAiCareLevelClass(latestAiMessage.careLevel)}">${latestAiMessage.careLevel || 'Guidance'}</span>
                    <h4>${adaptAiText(latestAiMessage.title || 'AI care summary')}</h4>
                    <p>${adaptAiText(latestAiMessage.summary || 'Tell me more about your symptoms so I can guide you.')}</p>
                </div>
                <div class="ai-risk-score ${riskScore.className}"><i class="fas fa-signal"></i> Risk ${riskScore.label}</div>
            </div>
            <div class="ai-summary-grid">
                <div class="ai-summary-tile">
                    <span>Recommended next step</span>
                    <strong>${adaptAiText(latestAiMessage.nextStep || getAiNextStepLabel(latestAiMessage))}</strong>
                </div>
                <div class="ai-summary-tile">
                    <span>Suggested specialty</span>
                    <strong>${adaptAiText(latestAiMessage.specialty || 'General Physician')}</strong>
                </div>
                <div class="ai-summary-tile">
                    <span>Follow-up focus</span>
                    <strong>${adaptAiText(latestAiMessage.followUp || 'Share more symptom details for a better next step.')}</strong>
                </div>
                <div class="ai-summary-tile">
                    <span>Temperature</span>
                    <strong>${state.aiConsultationContext.temperature || 'Not shared'}</strong>
                </div>
                <div class="ai-summary-tile">
                    <span>Symptom score</span>
                    <strong>${state.aiConsultationContext.score || '5'}/10</strong>
                </div>
            </div>
            <div class="ai-summary-actions">
                ${latestAiMessage.offerDoctor ? `<button type="button" class="btn-primary ai-summary-book-btn">Book Doctor Now</button>` : ''}
                <button type="button" class="btn-outline ai-summary-refine-btn">Refine my symptoms</button>
            </div>
        </div>
    ` : `
        <div class="ai-summary-placeholder">
            Start with a symptom or choose a category below. The AI will build a simple care summary with next step, care level, and recommended specialist.
        </div>
    `);

    container.querySelector('.ai-summary-book-btn')?.addEventListener('click', () => {
        closeModal('aiConsultationModal');
        if (state.sessionToken) {
            state.selectedDoctor = null;
            updateConsultDoctorFields();
            openModal('consultModal');
        } else {
            state.authFlowMode = 'signin';
            openModal('roleSelectModal');
            showNotification('Sign in to continue with doctor booking.', 'info');
        }
    });

    container.querySelector('.ai-summary-refine-btn')?.addEventListener('click', () => {
        qs('aiConsultationInput')?.focus();
    });
}

function enhanceAiReplyWithContext(reply, textValue = '') {
    const age = String(state.aiConsultationContext?.age || '').toLowerCase();
    const duration = String(state.aiConsultationContext?.duration || '').toLowerCase();
    const severity = String(state.aiConsultationContext?.severity || '').toLowerCase();
    const safeReply = { ...reply };

    if (!safeReply.nextStep) {
        safeReply.nextStep = getAiNextStepLabel(safeReply);
    }

    const vulnerableAge = age === 'child' || age === 'older adult';
    const longDuration = duration.includes('week');
    const severeSymptoms = severity === 'severe' || /severe|worsening|very painful|high fever/.test(textValue);

    if (vulnerableAge) {
        safeReply.summary = `${safeReply.summary} Extra caution is needed because this age group can worsen faster.`;
        safeReply.foods = [
            ...(safeReply.foods || []),
            'Offer small frequent sips rather than large amounts at once'
        ];
    }

    if (longDuration && !String(safeReply.careLevel || '').toLowerCase().includes('emergency')) {
        safeReply.careLevel = 'Book Doctor';
        safeReply.nextStep = 'Book a doctor review because symptoms have lasted longer than expected';
        safeReply.offerDoctor = true;
        safeReply.seeDoctor = `${safeReply.seeDoctor || 'A doctor review is recommended.'} Ongoing symptoms for more than a week should be reviewed by a clinician.`;
    }

    if (severeSymptoms && !String(safeReply.careLevel || '').toLowerCase().includes('emergency')) {
        safeReply.careLevel = 'Urgent Care';
        safeReply.nextStep = 'Arrange same-day medical review if symptoms feel severe';
        safeReply.offerDoctor = true;
        safeReply.seeDoctor = `${safeReply.seeDoctor || 'A doctor review is recommended.'} Because symptoms sound severe, do not rely on home care alone.`;
    }

    if (age === 'child') {
        safeReply.childGuidance = 'For children, use only child-labelled medicines and confirm dosing by age/weight with a clinician or pharmacist.';
    } else if (age === 'older adult') {
        safeReply.childGuidance = 'For older adults, dehydration and medicine side effects can happen faster, so seek review earlier if symptoms are not improving.';
    } else {
        safeReply.childGuidance = '';
    }

    return safeReply;
}

function renderAiConsultationThread() {
    const thread = qs('aiConsultationThread');
    if (!thread) return;
    ensureAiConsultationIntro();
    renderAiConsultationSummary();
    html(thread, state.aiConsultationMessages.map((item) => `
        <div class="ai-chat-message ${item.role === 'ai' ? 'ai' : 'user'}">
            <strong>${item.role === 'ai' ? 'MediSync AI' : 'You'}</strong>
            ${item.role === 'ai'
                ? `
                    <div class="ai-chat-structured">
                        ${item.careLevel ? `<span class="ai-care-badge ${getAiCareLevelClass(item.careLevel)}">${item.careLevel}</span>` : ''}
                        ${item.title ? `<h4>${adaptAiText(item.title)}</h4>` : ''}
                        ${item.summary ? `<p>${adaptAiText(item.summary)}</p>` : ''}
                        ${item.actions?.length ? `
                            <div class="ai-chat-block">
                                <span>What to do now</span>
                                <ul>${item.actions.map((action) => `<li>${adaptAiText(action)}</li>`).join('')}</ul>
                            </div>
                        ` : ''}
                        ${item.medicines?.length ? `
                            <div class="ai-chat-block">
                                <span>Suggested relief options</span>
                                <ul>${item.medicines.map((medicine) => `<li>${adaptAiText(medicine)}</li>`).join('')}</ul>
                            </div>
                        ` : ''}
                        ${item.foods?.length ? `
                            <div class="ai-chat-block">
                                <span>Food and fluids for now</span>
                                <ul>${item.foods.map((food) => `<li>${adaptAiText(food)}</li>`).join('')}</ul>
                            </div>
                        ` : ''}
                        ${item.childGuidance ? `
                            <div class="ai-chat-block">
                                <span>Age-specific caution</span>
                                <p>${adaptAiText(item.childGuidance)}</p>
                            </div>
                        ` : ''}
                        ${item.avoid?.length ? `
                            <div class="ai-chat-block">
                                <span>What to avoid</span>
                                <ul>${item.avoid.map((entry) => `<li>${adaptAiText(entry)}</li>`).join('')}</ul>
                            </div>
                        ` : ''}
                        ${item.seeDoctor ? `
                            <div class="ai-chat-block">
                                <span>When to see a doctor</span>
                                <p>${adaptAiText(item.seeDoctor)}</p>
                            </div>
                        ` : ''}
                        ${item.emergency ? `
                            <div class="ai-chat-block emergency">
                                <span>Emergency warning</span>
                                <p>${adaptAiText(item.emergency)}</p>
                            </div>
                        ` : ''}
                        ${item.followUp ? `
                            <div class="ai-chat-followup">
                                <i class="fas fa-stethoscope"></i>
                                <span>${adaptAiText(item.followUp)}</span>
                            </div>
                        ` : ''}
                        ${item.specialty ? `
                            <div class="ai-chat-specialty">
                                <i class="fas fa-user-doctor"></i>
                                <span>Suggested specialist: <strong>${adaptAiText(item.specialty)}</strong></span>
                            </div>
                        ` : ''}
                        ${item.offerDoctor ? `
                            <div class="ai-chat-actions">
                                <button type="button" class="btn-primary ai-book-doctor-btn">Book Doctor Now</button>
                            </div>
                        ` : ''}
                    </div>
                `
                : `<div>${item.message}</div>`}
        </div>
    `).join(''));
    thread.querySelectorAll('.ai-book-doctor-btn').forEach((button) => {
        button.addEventListener('click', () => {
            closeModal('aiConsultationModal');
            if (state.sessionToken) {
                state.selectedDoctor = null;
                updateConsultDoctorFields();
                openModal('consultModal');
            } else {
                state.authFlowMode = 'signin';
                openModal('roleSelectModal');
                showNotification('Sign in to continue with doctor booking.', 'info');
            }
        });
    });
    thread.scrollTop = thread.scrollHeight;
}

function getAiConsultationReply(message) {
    const textValue = String(message || '').toLowerCase();
    const emergencyTerms = ['chest pain', 'severe breathing', 'can\'t breathe', 'unable to breathe', 'stroke', 'fainted', 'unconscious', 'heavy bleeding', 'seizure'];
    if (emergencyTerms.some((term) => textValue.includes(term))) {
        return enhanceAiReplyWithContext({
            careLevel: 'Emergency',
            title: 'Emergency care is recommended',
            summary: 'Your message includes symptoms that can be dangerous and should not wait for routine online guidance.',
            actions: [
                'Seek emergency medical care immediately',
                'Call local emergency services now',
                'Do not drive yourself if you feel faint or unstable'
            ],
            medicines: [
                'Do not depend on online medicine advice for these symptoms',
                'Emergency clinicians should assess you before any treatment is chosen'
            ],
            foods: [
                'If fully conscious, small sips of water may help while waiting for emergency care',
                'Do not force food or drink if swallowing is difficult'
            ],
            avoid: [
                'Do not delay care while trying home remedies',
                'Do not drive yourself if you feel weak, dizzy, or short of breath'
            ],
            emergency: 'Chest pain, severe breathing trouble, stroke symptoms, unconsciousness, seizure, or heavy bleeding can be life-threatening.',
            followUp: 'If you are safe right now, tell me whether help is already on the way.',
            specialty: 'Emergency Care',
            offerDoctor: false,
            nextStep: 'Go to emergency care immediately'
        }, textValue);
    }
    if (textValue.includes('fever') || textValue.includes('body pain')) {
        return enhanceAiReplyWithContext({
            careLevel: 'Home Care',
            title: 'Fever guidance',
            summary: 'Fever with body pain often happens with viral infection or another infection. Early hydration, rest, and temperature tracking are important.',
            actions: [
                'Drink water or oral fluids regularly',
                'Rest and monitor temperature every few hours',
                'Use medicine only if already safe and appropriate for you'
            ],
            medicines: [
                'Paracetamol/acetaminophen-style fever relief may help if it is usually safe for you',
                'Ibuprofen-style fever relief may help some adults if it is safe for them and taken with food',
                'Follow the pack label carefully and avoid combining multiple fever medicines without advice',
                'If you are pregnant, have liver disease, kidney disease, or stomach ulcer history, check with a clinician or pharmacist first'
            ],
            foods: [
                'Drink water, coconut water, soup, or oral fluids in small frequent amounts',
                'Choose light foods like khichdi, toast, rice, banana, or curd if tolerated'
            ],
            avoid: [
                'Avoid dehydration, alcohol, and very oily or heavy meals',
                'Avoid self-starting antibiotics unless a doctor has prescribed them'
            ],
            seeDoctor: 'Book a doctor if fever stays high for more than 2 to 3 days, you cannot eat or drink well, or breathing trouble appears.',
            followUp: 'What is the age group, and how high is the fever if you measured it?',
            specialty: suggestDoctorSpecialty(textValue),
            offerDoctor: true,
            nextStep: 'Hydrate, rest, and track temperature for the next few hours'
        }, textValue);
    }
    if (textValue.includes('cough') || textValue.includes('sore throat') || textValue.includes('cold')) {
        return enhanceAiReplyWithContext({
            careLevel: 'Book Doctor',
            title: 'Cough and sore throat guidance',
            summary: 'Cough or sore throat can happen with viral infection, allergy, or irritation. Most mild cases improve with rest and fluids, but breathing symptoms should not be ignored.',
            actions: [
                'Drink warm fluids and rest',
                'Monitor whether cough is dry or with mucus',
                'Notice any wheezing or shortness of breath'
            ],
            medicines: [
                'Throat lozenges or soothing syrups may help if they are normally safe for you',
                'Saline nasal spray or steam inhalation may help congestion',
                'Some OTC cough and cold products may help symptoms, but check the label carefully',
                'Avoid giving adult cold medicines to children unless approved by a clinician'
            ],
            foods: [
                'Warm water, soup, honey with warm water if appropriate, and soft foods may feel soothing',
                'Keep fluids up even if appetite is low'
            ],
            avoid: [
                'Avoid smoking, dust exposure, and very cold drinks if they worsen symptoms',
                'Avoid unnecessary antibiotics for simple cold symptoms without doctor advice'
            ],
            seeDoctor: 'Book a doctor if symptoms are worsening, lasting several days, or causing chest tightness, wheezing, or poor sleep.',
            followUp: 'Do you also have fever, breathing difficulty, or chest tightness?',
            specialty: suggestDoctorSpecialty(textValue),
            offerDoctor: true,
            nextStep: 'Plan a doctor review if breathing symptoms, chest tightness, or ongoing cough are present'
        }, textValue);
    }
    if (textValue.includes('stomach') || textValue.includes('vomit') || textValue.includes('loose motion') || textValue.includes('diarrhea')) {
        return enhanceAiReplyWithContext({
            careLevel: 'Urgent Care',
            title: 'Stomach and dehydration guidance',
            summary: 'Stomach pain, vomiting, or loose motion can lead to dehydration quickly, especially in children and older adults.',
            actions: [
                'Sip water or oral rehydration solution slowly',
                'Avoid oily or very spicy food',
                'Watch for weakness, low urine, or dizziness'
            ],
            medicines: [
                'ORS is usually the most important first-step support for loose motion or vomiting',
                'Simple antacid-style relief may help acidity in some adults if it is safe for them',
                'Some OTC digestive relief products may help, but avoid medicines that can hide serious symptoms',
                'Children, older adults, and pregnant patients should be more cautious and seek advice earlier'
            ],
            foods: [
                'Take ORS, water, rice, banana, toast, curd, or other bland foods if tolerated',
                'Use small frequent sips if vomiting is present'
            ],
            avoid: [
                'Avoid oily food, alcohol, very spicy meals, and dehydration',
                'Avoid random antibiotics or strong anti-diarrheal medicines without doctor advice when fever, blood, or severe pain is present'
            ],
            seeDoctor: 'Get medical help promptly if vomiting continues, pain becomes severe, blood appears, or dehydration symptoms develop.',
            followUp: 'Is there vomiting, loose motion, fever, or severe stomach pain?',
            specialty: suggestDoctorSpecialty(textValue),
            offerDoctor: true,
            nextStep: 'Focus on hydration and arrange prompt medical review if symptoms continue'
        }, textValue);
    }
    if (textValue.includes('headache') || textValue.includes('dizziness')) {
        return enhanceAiReplyWithContext({
            careLevel: 'Book Doctor',
            title: 'Headache and dizziness guidance',
            summary: 'Headache or dizziness can happen with dehydration, stress, infection, lack of sleep, or blood pressure changes.',
            actions: [
                'Rest in a quiet and cool place',
                'Drink water and avoid skipping meals',
                'Notice if symptoms get worse when standing up'
            ],
            medicines: [
                'Paracetamol/acetaminophen-style relief may help some headaches if it is usually safe for you',
                'Ibuprofen-style relief may help some adults if it is safe for them and taken with food',
                'Avoid frequent painkiller use if headaches are repeating often',
                'If you have migraine history, uncontrolled blood pressure, or other medical conditions, check with a clinician first'
            ],
            foods: [
                'Drink water, have a light meal, and avoid long gaps without food',
                'Electrolyte fluids may help if dehydration is possible'
            ],
            avoid: [
                'Avoid alcohol, sleep deprivation, and too much screen exposure if they worsen symptoms',
                'Avoid ignoring repeated headaches with visual change, weakness, or vomiting'
            ],
            seeDoctor: 'Speak to a doctor if symptoms keep returning, are severe, or come with weakness, vomiting, or visual change.',
            emergency: 'Seek urgent care immediately if there is confusion, fainting, severe weakness, stroke-like symptoms, or the worst headache of your life.',
            followUp: 'How long has the headache or dizziness been going on, and is it mild, moderate, or severe?',
            specialty: suggestDoctorSpecialty(textValue),
            offerDoctor: true,
            nextStep: 'Rest, hydrate, and plan a doctor review if symptoms keep returning'
        }, textValue);
    }
    if (textValue.includes('skin') || textValue.includes('rash') || textValue.includes('itch')) {
        return enhanceAiReplyWithContext({
            careLevel: 'Home Care',
            title: 'Skin rash guidance',
            summary: 'Skin rash or itching can happen because of allergy, irritation, or infection. It is important to watch whether it is spreading or linked to swelling.',
            actions: [
                'Avoid any new product or medicine that may have triggered it',
                'Keep the area clean and dry',
                'Do not scratch aggressively'
            ],
            medicines: [
                'A simple soothing lotion or anti-itch OTC option may help if it is usually safe for you',
                'A gentle antihistamine-type allergy tablet may help some adults if it is safe for them',
                'If rash began after a medicine, do not repeat that medicine until a clinician reviews it'
            ],
            foods: [
                'Drink enough fluids and keep meals simple if you also feel unwell',
                'If you suspect a food trigger, avoid that trigger until reviewed'
            ],
            avoid: [
                'Avoid harsh creams, new cosmetics, or unverified home chemicals on the rash',
                'Avoid scratching, which can make the skin more inflamed or infected'
            ],
            seeDoctor: 'Book a doctor if rash spreads, becomes painful, lasts more than a few days, or comes with fever.',
            emergency: 'Get urgent help immediately if rash comes with breathing trouble, swelling of lips, or severe facial swelling.',
            followUp: 'Where is the rash, and did it start after food, medicine, or a skin product?',
            specialty: suggestDoctorSpecialty(textValue),
            offerDoctor: true,
            nextStep: 'Avoid triggers and monitor whether the rash is spreading or swelling'
        }, textValue);
    }
    return enhanceAiReplyWithContext({
        careLevel: 'Guidance',
        title: 'General first-step guidance',
        summary: 'Based on what you shared, the safest next step is to monitor symptoms, rest, stay hydrated, and decide whether home care is enough or a doctor should review you.',
        actions: [
            'Track the main symptom and how severe it is',
            'Rest and drink fluids regularly',
            'Note if symptoms are worsening or spreading'
        ],
        medicines: [
            'If needed, use only simple OTC symptom relief that is usually safe for you',
            'Use products meant for the correct age group and symptom type',
            'Check label directions and avoid mixing multiple products without advice'
        ],
        foods: [
            'Choose light food and regular fluids while monitoring symptoms',
            'If appetite is low, take small frequent amounts instead of heavy meals'
        ],
        avoid: [
            'Avoid self-starting antibiotics or strong medicines without a clinician review',
            'Avoid ignoring symptoms that are worsening or lasting longer than expected'
        ],
        seeDoctor: 'Book a doctor if symptoms are worsening, lasting longer than expected, or making daily activity difficult.',
        followUp: 'Tell me the main symptom, age group, and how many hours or days this has been happening.',
        specialty: suggestDoctorSpecialty(textValue),
        offerDoctor: true,
        nextStep: 'Share a little more detail so the recommendation can be narrowed down'
    }, textValue);
}

function openAiConsultationModal(prefill = '') {
    normalizeAiContextDefaults();
    ensureAiConsultationIntro();
    renderAiConsultationThread();
    renderAiConsultationGuidedChips();
    if (qs('aiConsultationInput')) {
        qs('aiConsultationInput').value = prefill;
    }
    openModal('aiConsultationModal');
}

function sendAiConsultationMessage(prefillMessage = '') {
    const input = qs('aiConsultationInput');
    let rawMessage = String(prefillMessage || input?.value || '').trim();
    const contextSummary = buildAiContextSummary();
    if (contextSummary && rawMessage && !prefillMessage) {
        rawMessage = `${rawMessage}. ${contextSummary}.`;
    } else if (!rawMessage && contextSummary) {
        rawMessage = `I need guidance. ${contextSummary}.`;
    }
    if (!rawMessage) return;
    state.aiConsultationMessages.push({ role: 'user', message: rawMessage });
    state.aiConsultationMessages.push({ role: 'ai', ...getAiConsultationReply(rawMessage) });
    saveAiConsultationMessages();
    renderAiConsultationThread();
    if (input) input.value = '';
}

function togglePassword(fieldId) {
    const field = qs(fieldId);
    if (!field) return;
    field.type = field.type === 'password' ? 'text' : 'password';
}

function configureRoleModal(mode = 'signin') {
    state.authFlowMode = mode;
    const title = qs('roleModalTitle');
    const patientButton = qs('patientRoleBtn');
    const doctorButton = qs('doctorRoleBtn');
    if (!title || !patientButton || !doctorButton) return;

    if (mode === 'signup') {
        title.innerHTML = '<i class="fas fa-user-plus"></i> Create Your Account';
        patientButton.innerHTML = '<i class="fas fa-user"></i> Create Patient Account';
        doctorButton.innerHTML = '<i class="fas fa-user-md"></i> Create Doctor Account';
    } else {
        title.innerHTML = '<i class="fas fa-user-circle"></i> Select Your Role';
        patientButton.innerHTML = '<i class="fas fa-user"></i> Patient Sign In';
        doctorButton.innerHTML = '<i class="fas fa-user-md"></i> Doctor Sign In';
    }
}

function openModal(id) {
    if (id === 'roleSelectModal') configureRoleModal(state.authFlowMode);
    const modal = qs(id);
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeModal(id) {
    const modal = qs(id);
    if (!modal) return;
    if (id === 'videoModal' && (state.twilioRoom || state.localStream)) {
        endCall(true);
    }
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
}

function closeAllModals() {
    ['roleSelectModal', 'patientSignInModal', 'patientSignUpModal', 'patientOtpModal', 'doctorSignInModal', 'doctorSignUpModal', 'doctorOtpModal', 'adminLoginModal', 'consultModal', 'videoModal', 'iotModal', 'forgotPasswordModal', 'forgotOtpModal', 'resetPasswordModal', 'scheduleConsultationModal', 'prescriptionModal', 'chatModal', 'aiConsultationModal', 'reportViewerModal', 'reportRenameModal']
        .forEach((id) => closeModal(id));
    clearChatTimers();
    state.chatAttachment = null;
    renderChatAttachmentPreview();
}

function updateBottomCtaVisibility() {
    const ctaSection = document.querySelector('.cta-section');
    if (!ctaSection) return;
    ctaSection.style.display = state.sessionToken ? 'none' : '';
}

function resetPortalViews() {
    const mainSite = qs('mainSiteContent');
    const adminPanel = qs('adminPanel');
    const doctorPortal = qs('doctorPortal');
    const patientPortal = qs('patientPortal');
    if (mainSite) mainSite.style.display = 'block';
    if (adminPanel) adminPanel.style.display = 'none';
    if (doctorPortal) doctorPortal.style.display = 'none';
    if (patientPortal) patientPortal.style.display = 'none';
    clearPortalRefreshTimer();
}

function updateLoggedOutNav(onLogout) {
    const nav = document.querySelector('.nav-buttons');
    if (!nav) return;
    nav.innerHTML = `
        <button class="btn-outline" id="adminPortalBtn"><i class="fas fa-user-shield"></i> Admin</button>
        <button class="btn-outline" id="signInBtn">Sign In</button>
        <button class="btn-primary" id="signUpBtn">Create Account</button>
    `;
    qs('adminPortalBtn')?.addEventListener('click', () => openModal('adminLoginModal'));
    qs('signInBtn')?.addEventListener('click', () => { state.authFlowMode = 'signin'; openModal('roleSelectModal'); });
    qs('signUpBtn')?.addEventListener('click', () => { state.authFlowMode = 'signup'; openModal('roleSelectModal'); });
    if (onLogout) clearSession();
    updateBottomCtaVisibility();
}

function updateLoggedInNav(logoutHandler) {
    const nav = document.querySelector('.nav-buttons');
    if (!nav || !state.currentUser) return;
    const firstName = state.currentUser.fullName.split(' ')[0];
    const label = state.currentRole === 'doctor' ? `Dr. ${firstName}` : firstName;
    const quickAction = state.currentRole === 'patient'
        ? '<button class="btn-outline" id="myConsultationsBtn"><i class="fas fa-notes-medical"></i> My Consultations</button>'
        : '<button class="btn-outline" id="doctorWorkspaceBtn"><i class="fas fa-stethoscope"></i> Doctor Workspace</button>';
    nav.innerHTML = `
        <button class="btn-outline" id="adminPortalBtn"><i class="fas fa-user-shield"></i> Admin</button>
        ${quickAction}
        <div class="user-badge">
            <div class="user-avatar">${firstName.charAt(0).toUpperCase()}</div>
            <span class="user-name">${label}</span>
            <button class="logout-btn" id="logoutBtn"><i class="fas fa-sign-out-alt"></i></button>
        </div>
    `;
    qs('adminPortalBtn')?.addEventListener('click', () => openModal('adminLoginModal'));
    qs('myConsultationsBtn')?.addEventListener('click', () => openPatientPortal().catch((error) => showNotification(error.message, 'error')));
    qs('doctorWorkspaceBtn')?.addEventListener('click', () => openDoctorPortal().catch((error) => showNotification(error.message, 'error')));
    qs('logoutBtn')?.addEventListener('click', logoutHandler);
    updateBottomCtaVisibility();
}

function updateConsultDoctorFields() {
    const doctorIdInput = qs('consultDoctorId');
    const doctorNameInput = qs('consultDoctorName');
    if (doctorIdInput) doctorIdInput.value = state.selectedDoctor?.id || '';
    if (doctorNameInput) doctorNameInput.value = state.selectedDoctor?.name || '';
}

function applyVitals(reading = {}) {
    if (reading.heartRate !== undefined) text(qs('heartRate'), reading.heartRate);
    if (reading.bloodPressure !== undefined) text(qs('bloodPressure'), reading.bloodPressure);
    if (reading.spo2 !== undefined) text(qs('spo2'), reading.spo2);
    if (reading.temperature !== undefined) text(qs('temperature'), reading.temperature);
    if (reading.heartRate !== undefined) text(qs('patientHeartRate'), `${reading.heartRate} bpm`);
    if (reading.bloodPressure !== undefined) text(qs('patientBloodPressure'), reading.bloodPressure);
    if (reading.spo2 !== undefined) text(qs('patientSpo2'), `${reading.spo2}%`);
    if (reading.temperature !== undefined) text(qs('patientTemperature'), `${reading.temperature} C`);

    const insight = qs('aiInsight');
    const patientInsight = qs('patientVitalsInsight');
    if (!insight) return;
    const heartRate = Number(reading.heartRate || qs('heartRate')?.textContent || 0);
    insight.classList.remove('warning');
    if (heartRate > 100 || heartRate < 55) {
        insight.classList.add('warning');
        insight.innerHTML = '<i class="fas fa-exclamation-triangle"></i><span>AI Alert: Vital signs need review</span>';
        if (patientInsight) patientInsight.textContent = 'Your recent vitals need attention. Consider contacting your doctor if symptoms continue.';
    } else {
        insight.innerHTML = '<i class="fas fa-check-circle"></i><span>AI Insight: All vitals within normal range</span>';
        if (patientInsight) patientInsight.textContent = 'Your latest vitals are currently within a healthy range.';
    }
}

function updateSimulatedVitals() {
    applyVitals({
        heartRate: Math.floor(Math.random() * 20) + 68,
        bloodPressure: `${Math.floor(Math.random() * 12) + 114}/${Math.floor(Math.random() * 8) + 72}`,
        spo2: Math.floor(Math.random() * 4) + 96,
        temperature: (Math.random() * 0.8 + 36.2).toFixed(1)
    });
}

function renderHospitalMap(searchTerm = '') {
    const container = qs('hospitalMapContainer');
    if (!container) return;
    if (!searchTerm) {
        container.className = 'map-placeholder';
        html(container, '<i class="fas fa-map-marked-alt"></i><p>Search hospitals by pincode</p><span>Enter your pincode or city to load live map results.</span>');
        return;
    }
    const mapQuery = encodeURIComponent(`hospitals near ${searchTerm}`);
    container.className = '';
    html(container, `<iframe class="hospital-map-frame" title="Hospital map" src="https://www.google.com/maps?q=${mapQuery}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`);
}

function setupOtpInputs(prefix) {
    for (let i = 1; i <= 6; i += 1) {
        const input = qs(`${prefix}${i}`);
        if (!input) continue;
        input.addEventListener('input', (event) => {
            event.target.value = event.target.value.replace(/[^0-9]/g, '').slice(0, 1);
            if (event.target.value && i < 6) qs(`${prefix}${i + 1}`)?.focus();
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Backspace' && !event.target.value && i > 1) qs(`${prefix}${i - 1}`)?.focus();
        });
    }
}

function parseOtpInputs(prefix) {
    return Array.from({ length: 6 }, (_, index) => qs(`${prefix}${index + 1}`)?.value || '').join('');
}

function setOtpModalState(role, isLoading, email = '') {
    const prefix = role === 'patient' ? 'patientOtp' : 'doctorOtp';
    const info = qs(role === 'patient' ? 'patientOtpEmailDisplay' : 'doctorOtpEmailDisplay');
    const verifyButton = qs(role === 'patient' ? 'patientVerifyOtpBtn' : 'doctorVerifyOtpBtn');
    const resendLink = qs(role === 'patient' ? 'patientResendOtpBtn' : 'doctorResendOtpBtn');

    text(info, email);
    for (let i = 1; i <= 6; i += 1) {
        const input = qs(`${prefix}${i}`);
        if (!input) continue;
        input.disabled = isLoading;
        if (isLoading) input.value = '';
    }

    if (verifyButton) {
        verifyButton.disabled = isLoading;
        verifyButton.textContent = isLoading ? 'Preparing OTP...' : 'Verify & Create Account';
    }

    if (resendLink) {
        resendLink.style.pointerEvents = isLoading ? 'none' : '';
        resendLink.style.opacity = isLoading ? '0.5' : '1';
    }
}

function setupFileUpload() {
    const dropZone = qs('fileDropZone');
    const input = qs('medicalReports');
    if (!dropZone || !input) return;

    dropZone.addEventListener('click', () => input.click());
    input.addEventListener('change', (event) => {
        state.uploadedFiles = Array.from(event.target.files || []);
        renderUploadedFiles();
    });
}

function renderUploadedFiles() {
    const container = qs('uploadedFilesList');
    if (!container) return;
    html(container, state.uploadedFiles.map((file) => `
        <div class="file-item">
            <span>${file.name}</span>
            <span>${(file.size / 1024).toFixed(1)} KB</span>
        </div>
    `).join(''));
}

function searchHospitals() {
    const term = normalizeSearchTerm(qs('hospitalSearch')?.value || '');
    const results = qs('hospitalResults');
    if (!results) return;

    if (!term) {
        html(results, '<div class="hospital-item"><h4>Search hospitals</h4><p>Enter a pincode or city to view live nearby hospitals on the map.</p></div>');
        renderHospitalMap('');
        return;
    }

    renderHospitalMap(term);
    html(results, `
        <div class="hospital-item">
            <h4>Live map search</h4>
            <p><strong>Query:</strong> Hospitals near ${term}</p>
            <p>The map on the right is loading real nearby results for this pincode or city.</p>
            <p><a href="https://www.google.com/maps/search/hospitals+near+${encodeURIComponent(term)}" target="_blank" rel="noopener noreferrer">Open full map</a></p>
        </div>
    `);
}

function parseBlePayload(rawValue) {
    try {
        return JSON.parse(rawValue);
    } catch (error) {
        const [heartRate, bloodPressure, spo2, temperature] = rawValue.split(',');
        return { heartRate, bloodPressure, spo2, temperature, raw: rawValue };
    }
}

async function connectBluetoothDevice() {
    if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth is not supported in this browser.');
    }

    const serviceUuid = qs('bleServiceUuid')?.value.trim() || state.publicConfig.bleServiceUuid;
    const characteristicUuid = qs('bleCharacteristicUuid')?.value.trim() || state.publicConfig.bleCharacteristicUuid;
    qs('deviceStatus').textContent = 'Searching for BLE devices...';

    state.currentBleDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [serviceUuid]
    });
    state.currentBleServer = await state.currentBleDevice.gatt.connect();
    const service = await state.currentBleServer.getPrimaryService(serviceUuid);
    state.currentBleCharacteristic = await service.getCharacteristic(characteristicUuid);
    await state.currentBleCharacteristic.startNotifications();
    state.currentBleCharacteristic.addEventListener('characteristicvaluechanged', handleBleNotification);
    qs('deviceStatus').textContent = `Connected to ${state.currentBleDevice.name || 'ESP32 device'}`;
    showNotification('ESP32 connected successfully.', 'success');
}

function disconnectBluetoothDevice() {
    if (state.currentBleCharacteristic) {
        state.currentBleCharacteristic.removeEventListener('characteristicvaluechanged', handleBleNotification);
    }
    if (state.currentBleDevice?.gatt?.connected) {
        state.currentBleDevice.gatt.disconnect();
    }
    state.currentBleDevice = null;
    state.currentBleServer = null;
    state.currentBleCharacteristic = null;
    qs('deviceStatus').textContent = 'Device disconnected.';
}

async function handleBleNotification(event) {
    const raw = new TextDecoder().decode(event.target.value);
    const reading = parseBlePayload(raw);
    applyVitals(reading);
    qs('deviceStatus').textContent = `Live reading received at ${new Date().toLocaleTimeString()}`;

    if (state.sessionToken) {
        try {
            await apiRequest('/api/device/readings', {
                method: 'POST',
                auth: 'user',
                body: { ...reading, raw, source: 'esp32-bluetooth' }
            });
        } catch (error) {
            console.error(error);
        }
    }
}

function getTwilioVideoSdk() {
    return window.Twilio?.Video || null;
}

function setVideoSessionNote(message) {
    text(qs('videoSessionNote'), message || 'Secure consultation room is preparing...');
}

function resetVideoControlButtons() {
    state.isMicActive = true;
    state.isCamActive = true;
    if (qs('toggleMicBtn')) qs('toggleMicBtn').innerHTML = '<i class="fas fa-microphone"></i>';
    if (qs('toggleCamBtn')) qs('toggleCamBtn').innerHTML = '<i class="fas fa-video"></i>';
}

function clearParticipantStage(stageId, emptyId) {
    const stage = qs(stageId);
    if (!stage) return;
    stage.querySelectorAll('.twilio-media-tile, .twilio-audio-state').forEach((element) => element.remove());
    const emptyState = qs(emptyId);
    if (emptyState) emptyState.style.display = 'flex';
}

function resetVideoModalUi() {
    clearParticipantStage('localParticipantStage', 'localParticipantEmpty');
    clearParticipantStage('remoteParticipantStage', 'remoteParticipantEmpty');
    if (qs('localVideo')) {
        qs('localVideo').srcObject = null;
        qs('localVideo').style.display = 'none';
    }
    const localEmpty = qs('localParticipantEmpty');
    if (localEmpty) {
        localEmpty.innerHTML = '<i class="fas fa-user-circle"></i><p>Preparing your camera and microphone...</p>';
        localEmpty.style.display = 'flex';
    }
    text(qs('remoteDoctorName'), 'Doctor');
    html(qs('videoModalTitle'), '<i class="fas fa-video"></i> Video Consultation');
    setVideoSessionNote('Secure Twilio consultation room is preparing...');
    resetVideoControlButtons();
}

function renderAudioState(stageId, label, sublabel = 'Audio consultation is active') {
    const stage = qs(stageId);
    if (!stage) return;
    const card = document.createElement('div');
    card.className = 'twilio-audio-state';
    card.innerHTML = `<i class="fas fa-phone-volume"></i><strong>${label}</strong><span>${sublabel}</span>`;
    stage.appendChild(card);
}

function setRemoteWaitingState(label = 'Participant', role = 'doctor') {
    const emptyState = qs('remoteParticipantEmpty');
    if (!emptyState) return;
    const iconClass = role === 'patient' ? 'fa-user-injured' : 'fa-user-md';
    emptyState.innerHTML = `<i class="fas ${iconClass}"></i><p>Waiting for ${label}...</p>`;
    emptyState.style.display = 'flex';
}

function attachTrackToStage(stageId, emptyId, track, { muted = false } = {}) {
    const stage = qs(stageId);
    if (!stage || !track) return;

    const mediaElement = track.attach();
    mediaElement.autoplay = true;
    mediaElement.playsInline = true;
    if (muted || track.kind === 'audio') mediaElement.muted = muted;

    if (track.kind === 'audio') {
        mediaElement.className = 'twilio-hidden-audio';
        stage.appendChild(mediaElement);
        return;
    }

    const emptyState = qs(emptyId);
    if (emptyState) emptyState.style.display = 'none';

    const tile = document.createElement('div');
    tile.className = 'twilio-media-tile';
    tile.dataset.trackSid = track.sid || `${track.kind}-${Date.now()}`;
    tile.appendChild(mediaElement);
    stage.appendChild(tile);
}

function iterateParticipantTracks(participant, callback) {
    if (!participant?.tracks) return;
    participant.tracks.forEach((publication) => {
        if (publication?.track) callback(publication.track);
    });
}

function renderTwilioRoomParticipants() {
    const room = state.twilioRoom;
    clearParticipantStage('localParticipantStage', 'localParticipantEmpty');
    clearParticipantStage('remoteParticipantStage', 'remoteParticipantEmpty');
    if (qs('localVideo')) {
        qs('localVideo').srcObject = null;
        qs('localVideo').style.display = 'none';
    }
    if (!room) return;

    const remoteParticipant = Array.from(room.participants.values())[0] || null;
    const remoteName = state.activeCallConsultation
        ? (state.currentRole === 'doctor'
            ? (state.activeCallConsultation.patientName || 'Patient')
            : (state.activeCallConsultation.doctorName || 'Doctor'))
        : 'Participant';
    const remoteRole = state.currentRole === 'doctor' ? 'patient' : 'doctor';
    text(qs('remoteDoctorName'), remoteName);
    setRemoteWaitingState(remoteName, remoteRole);
    html(
        qs('videoModalTitle'),
        `<i class="fas ${state.activeCallMode === 'audio' ? 'fa-phone-volume' : 'fa-video'}"></i> ${state.activeCallMode === 'audio' ? 'Audio' : 'Video'} Consultation`
    );

    let localHasVideo = false;
    let localHasAudio = false;
    iterateParticipantTracks(room.localParticipant, (track) => {
        if (track.kind === 'video') {
            localHasVideo = true;
            attachTrackToStage('localParticipantStage', 'localParticipantEmpty', track, { muted: true });
        }
        if (track.kind === 'audio') {
            localHasAudio = true;
            attachTrackToStage('localParticipantStage', 'localParticipantEmpty', track, { muted: true });
        }
    });
    if (localHasAudio && !localHasVideo) {
        renderAudioState('localParticipantStage', 'You are connected', 'Camera is off. Audio consultation is active.');
    } else if (!localHasAudio && !localHasVideo) {
        renderAudioState('localParticipantStage', 'You', 'Camera is off or still loading.');
    }

    let remoteHasVideo = false;
    let remoteHasAudio = false;
    if (remoteParticipant) {
        iterateParticipantTracks(remoteParticipant, (track) => {
            if (track.kind === 'video') {
                remoteHasVideo = true;
                attachTrackToStage('remoteParticipantStage', 'remoteParticipantEmpty', track);
            }
            if (track.kind === 'audio') {
                remoteHasAudio = true;
                attachTrackToStage('remoteParticipantStage', 'remoteParticipantEmpty', track);
            }
        });
    }

    if (remoteHasAudio && !remoteHasVideo) {
        renderAudioState('remoteParticipantStage', `${remoteName} joined with audio`, 'Audio consultation is active.');
    }

    if (!remoteParticipant) {
        setVideoSessionNote(`Secure ${state.activeCallMode || 'video'} room ready. Waiting for ${remoteName} to join.`);
        return;
    }

    setVideoSessionNote(`${remoteName} is connected in the secure Twilio consultation room.`);
}

function bindParticipantEvents(participant) {
    if (!participant) return;
    participant.on('trackSubscribed', renderTwilioRoomParticipants);
    participant.on('trackUnsubscribed', renderTwilioRoomParticipants);
    participant.on('trackEnabled', renderTwilioRoomParticipants);
    participant.on('trackDisabled', renderTwilioRoomParticipants);
}

function bindTwilioRoomEvents(room) {
    bindParticipantEvents(room.localParticipant);
    room.participants.forEach((participant) => bindParticipantEvents(participant));
    room.on('participantConnected', (participant) => {
        bindParticipantEvents(participant);
        renderTwilioRoomParticipants();
        showNotification('The other participant joined the consultation room.', 'success');
    });
    room.on('participantDisconnected', () => {
        renderTwilioRoomParticipants();
        showNotification('The other participant left the consultation room.', 'info');
    });
    room.on('disconnected', () => {
        renderTwilioRoomParticipants();
    });
}

async function joinTwilioConsultation(target, mode = 'video') {
    const consultation = typeof target === 'object' && target ? target : state.selectedConsultation;
    if (!consultation?.id) {
        showNotification('Please open a consultation card first.', 'warning');
        return;
    }
    if (!canJoinConsultation(consultation)) {
        showNotification(`This consultation is already ${consultation.status || 'closed'}, so the room cannot be joined.`, 'warning');
        return;
    }
    if (!state.publicConfig.twilioVideoEnabled) {
        showNotification('Twilio consultation is not configured on the server yet.', 'error');
        return;
    }
    const TwilioVideo = getTwilioVideoSdk();
    if (!TwilioVideo?.connect) {
        showNotification('Twilio Video SDK did not load in this browser. Refresh once and try again.', 'error');
        return;
    }

    resetVideoModalUi();
    state.selectedConsultation = consultation;
    state.activeCallConsultation = consultation;
    state.activeCallMode = mode;
    text(
        qs('remoteDoctorName'),
        state.currentRole === 'doctor'
            ? (consultation.patientName || 'Patient')
            : (consultation.doctorName || 'Doctor')
    );
    html(
        qs('videoModalTitle'),
        `<i class="fas ${mode === 'audio' ? 'fa-phone-volume' : 'fa-video'}"></i> ${mode === 'audio' ? 'Audio' : 'Video'} Consultation`
    );
    setVideoSessionNote('Connecting to your secure Twilio consultation room...');
    openModal('videoModal');

    try {
        if (state.twilioRoom) {
            state.twilioRoom.disconnect();
            state.twilioRoom = null;
        }

        const response = await apiRequest(`/api/consultations/${consultation.id}/video-token`, {
            method: 'POST',
            auth: 'user',
            body: { mode }
        });

        const room = await TwilioVideo.connect(response.token, {
            name: response.roomName,
            audio: true,
            video: mode === 'video',
            dominantSpeaker: true,
            networkQuality: { local: 1, remote: 1 }
        });

        state.twilioRoom = room;
        bindTwilioRoomEvents(room);
        renderTwilioRoomParticipants();
    } catch (error) {
        console.error('Twilio consultation connect failed', error);
        resetVideoModalUi();
        state.twilioRoom = null;
        state.activeCallConsultation = null;
        state.activeCallMode = '';
        closeModal('videoModal');
        const friendlyMessage = error.code
            ? `${error.message || 'Unable to connect to the consultation room.'} (code ${error.code})`
            : (error.message || 'Unable to connect to the consultation room.');
        showNotification(friendlyMessage, 'error');
    }
}

async function startVideoConsultation(target = null) {
    await joinTwilioConsultation(target, 'video');
}

async function startAudioConsultation(target = null) {
    await joinTwilioConsultation(target, 'audio');
}

function toggleMicrophone() {
    const room = state.twilioRoom;
    if (!room?.localParticipant) return;
    state.isMicActive = !state.isMicActive;
    iterateParticipantTracks(room.localParticipant, (track) => {
        if (track.kind !== 'audio') return;
        if (state.isMicActive) track.enable();
        else track.disable();
    });
    qs('toggleMicBtn').innerHTML = state.isMicActive ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    setVideoSessionNote(state.isMicActive ? 'Microphone is live.' : 'Microphone muted.');
}

function toggleCamera() {
    const room = state.twilioRoom;
    if (!room?.localParticipant) return;
    if (state.activeCallMode === 'audio') {
        showNotification('Camera is disabled for audio consultations.', 'info');
        return;
    }
    state.isCamActive = !state.isCamActive;
    iterateParticipantTracks(room.localParticipant, (track) => {
        if (track.kind !== 'video') return;
        if (state.isCamActive) track.enable();
        else track.disable();
    });
    qs('toggleCamBtn').innerHTML = state.isCamActive ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    setVideoSessionNote(state.isCamActive ? 'Camera is live.' : 'Camera paused.');
}

function endCall(skipModalClose = false) {
    const modal = qs('videoModal');
    if (!skipModalClose && modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
    if (state.twilioRoom) {
        state.twilioRoom.localParticipant?.tracks?.forEach((publication) => {
            publication.track?.stop?.();
        });
        try {
            state.twilioRoom.disconnect();
        } catch (error) {
            console.error('Twilio room disconnect failed', error);
        }
        state.twilioRoom = null;
    }
    if (state.localStream) {
        state.localStream.getTracks().forEach((track) => track.stop());
        state.localStream = null;
    }
    state.activeCallConsultation = null;
    state.activeCallMode = '';
    resetVideoModalUi();
    if (skipModalClose && modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

async function loginAdmin() {
    const response = await apiRequest('/api/admin/login', {
        method: 'POST',
        body: {
            email: qs('adminEmail')?.value.trim().toLowerCase(),
            password: qs('adminPassword')?.value
        }
    });
    saveAdminSession(response.ownerEmail, response.token);
    showNotification('Owner console unlocked.', 'success');
}

async function loadAdminOverview() {
    const response = await apiRequest('/api/admin/overview', { auth: 'admin' });
    qs('adminTotalDoctors').textContent = response.stats.totalDoctors;
    qs('adminPendingDoctors').textContent = response.stats.pendingDoctors;
    qs('adminApprovedDoctors').textContent = response.stats.approvedDoctors;
    qs('adminRejectedDoctors').textContent = response.stats.rejectedDoctors;
    qs('adminTotalPatients').textContent = response.stats.totalPatients;
    text(qs('adminTotalConsultations'), String(response.stats.totalConsultations ?? 0));
    text(qs('adminScheduledConsultations'), String(response.stats.scheduledConsultations ?? 0));
    text(qs('adminActiveConsultations'), String(response.stats.activeConsultations ?? 0));
    text(qs('adminCompletedConsultations'), String(response.stats.completedConsultations ?? 0));
    text(qs('adminTotalReports'), String(response.stats.totalReports ?? 0));
    text(qs('adminTotalPrescriptions'), String(response.stats.totalPrescriptions ?? 0));
    renderAdminVisuals(response.stats || {});
}

async function loadAdminDoctors(query = '') {
    const response = await apiRequest(`/api/admin/doctors?q=${encodeURIComponent(query)}`, { auth: 'admin' });
    const container = qs('adminDoctorsList');
    if (!response.doctors.length) {
        html(container, '<div class="admin-doctor-card"><p>No doctors found.</p></div>');
        return;
    }
    html(container, response.doctors.map((doctor) => `
        <div class="admin-doctor-card ${doctor.status}">
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;">
                <div>
                    <h3>Dr. ${doctor.fullName}</h3>
                    <p><strong>Email:</strong> ${doctor.email} | <strong>Phone:</strong> ${doctor.mobile}</p>
                    <p><strong>Specialty:</strong> ${doctor.specialty || 'N/A'} | <strong>License:</strong> ${doctor.licenseNumber || 'N/A'}</p>
                    <p><strong>Status:</strong> <span class="status-badge-${doctor.status}">${doctor.status.toUpperCase()}</span></p>
                </div>
                <div>
                    ${doctor.status === 'pending' ? `<button class="btn-approve" onclick="approveDoctor('${doctor.id}')">Approve</button>` : ''}
                    ${doctor.status !== 'rejected' ? `<button class="btn-outline" onclick="rejectDoctor('${doctor.id}')">Reject</button>` : ''}
                    <button class="btn-delete" onclick="deleteDoctorAccount('${doctor.id}')">Delete</button>
                </div>
            </div>
        </div>
    `).join(''));
}

async function loadAdminPatients(query = '') {
    const response = await apiRequest(`/api/admin/patients?q=${encodeURIComponent(query)}`, { auth: 'admin' });
    const container = qs('adminPatientsList');
    if (!response.patients.length) {
        html(container, '<div class="admin-patient-card"><p>No patients found.</p></div>');
        return;
    }
    html(container, response.patients.map((patient) => `
        <div class="admin-patient-card">
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;">
                <div>
                    <h3>${patient.fullName}</h3>
                    <p><strong>Email:</strong> ${patient.email} | <strong>Phone:</strong> ${patient.mobile}</p>
                    <p><strong>Age:</strong> ${patient.age || 'N/A'} | <strong>Gender:</strong> ${patient.gender || 'N/A'}</p>
                    <p><strong>Registered:</strong> ${new Date(patient.createdAt).toLocaleString()}</p>
                </div>
                <div>
                    <button class="btn-delete" onclick="deletePatientAccount('${patient.id}')">Delete Patient</button>
                </div>
            </div>
        </div>
    `).join(''));
}

async function openAdminPanel() {
    closeAllModals();
    resetPortalViews();
    qs('mainSiteContent').style.display = 'none';
    qs('adminPanel').style.display = 'block';
    await Promise.all([loadAdminOverview(), loadAdminDoctors(), loadAdminPatients()]);
}

function exitAdminMode() {
    clearAdminSession();
    resetPortalViews();
    showNotification('Exited owner console.', 'info');
}

async function loadDoctorConsultations(query = '') {
    const response = await apiRequest('/api/doctor/consultations', { auth: 'user' });
    const reportsByPatient = new Map();
    const historyByPatient = new Map();
    await Promise.all((response.consultations || []).map(async (consultation) => {
        if (!consultation.userId || reportsByPatient.has(consultation.userId)) return;
        try {
            const [reportResponse, historyResponse] = await Promise.all([
                apiRequest(`/api/doctor/patients/${consultation.userId}/reports`, { auth: 'user' }),
                apiRequest(`/api/doctor/patients/${consultation.userId}/history`, { auth: 'user' })
            ]);
            reportsByPatient.set(consultation.userId, reportResponse.reports || []);
            historyByPatient.set(consultation.userId, historyResponse || {});
        } catch (error) {
            reportsByPatient.set(consultation.userId, []);
            historyByPatient.set(consultation.userId, {});
        }
    }));
    const reportFilter = (qs('doctorReportFilter')?.value || 'all').toLowerCase();
    const reportSearch = normalizeSearchTerm(qs('doctorReportSearchInput')?.value || '');
    const reportSort = (qs('doctorReportSort')?.value || 'latest').toLowerCase();
    const search = String(query || '').trim().toLowerCase();
    const consultations = response.consultations.filter((item) => {
        const reports = reportsByPatient.get(item.userId) || [];
        const matchesReportSearch = !reportSearch || reports.some((report) =>
            String(report.fileName || report.name || '').toLowerCase().includes(reportSearch)
        );
        const matchesReportFilter = reportFilter === 'all' || reports.some((report) => {
            const category = String(report.category || '').toLowerCase();
            if (reportFilter === 'pdf') return String(report.mimeType || '').includes('pdf');
            return category.includes(reportFilter);
        });
        if (!search) return true;
        return (matchesReportSearch && matchesReportFilter) && [
            item.patientName,
            item.email,
            item.phone,
            item.symptoms,
            item.consultType,
            item.status,
            item.sessionMode
        ].some((value) => String(value || '').toLowerCase().includes(search));
    }).filter((item) => {
        const reports = reportsByPatient.get(item.userId) || [];
        const matchesReportSearch = !reportSearch || reports.some((report) =>
            String(report.fileName || report.name || '').toLowerCase().includes(reportSearch)
        );
        const matchesReportFilter = reportFilter === 'all' || reports.some((report) => {
            const category = String(report.category || '').toLowerCase();
            if (reportFilter === 'pdf') return String(report.mimeType || '').includes('pdf');
            return category.includes(reportFilter);
        });
        return matchesReportSearch && matchesReportFilter;
    });

    const uniquePatients = new Set(consultations.map((item) => item.email || item.phone || item.patientName)).size;
    text(qs('doctorConsultationCount'), String(consultations.length));
    text(qs('doctorPatientCount'), String(uniquePatients));

    const container = qs('doctorConsultationsList');
    if (!container) return;

    if (!consultations.length) {
        html(container, '<div class="doctor-patient-card"><div class="doctor-patient-id"><h3>No consultations yet</h3><p>When patients book with this doctor, their details will appear here.</p></div></div>');
        return;
    }

    html(container, consultations.map((item) => `
        <article class="doctor-patient-card premium-doctor-consult-card">
            <div class="doctor-patient-head">
                <div class="doctor-patient-brand">
                    <div class="doctor-patient-avatar"><i class="fas fa-user-injured"></i></div>
                    <div class="doctor-patient-id">
                        <span class="doctor-card-label">Patient Consultation</span>
                        <h3>${item.patientName || 'Patient'}</h3>
                        <p>${item.email || 'No email provided'}</p>
                    </div>
                </div>
                <div class="doctor-head-status">
                    <div class="doctor-consult-type"><i class="fas fa-video"></i><span>${item.sessionMode || item.consultType || 'Consultation'}</span></div>
                    <span class="patient-status-pill status-${slugStatus(item.status)}">${item.status || 'requested'}</span>
                </div>
            </div>
            <div class="doctor-consult-highlights">
                <span><i class="fas fa-phone-alt"></i> ${item.phone || 'Phone not provided'}</span>
                <span><i class="fas fa-calendar-alt"></i> ${item.scheduledAt || item.dateTime || 'Requested as soon as possible'}</span>
                <span><i class="fas fa-hourglass-half"></i> ${formatCountdown(item.scheduledAt || item.dateTime)}</span>
            </div>
            <div class="doctor-patient-meta doctor-consult-grid">
                <div class="doctor-detail-card">
                    <span class="doctor-detail-label">Symptoms</span>
                    <p>${item.symptoms || 'Symptoms not provided yet'}</p>
                </div>
                <div class="doctor-detail-card">
                    <span class="doctor-detail-label">Consultation Status</span>
                    <p>${item.status || 'requested'}</p>
                </div>
            </div>
            <div class="doctor-report-strip premium-doctor-report-strip">
                ${(() => {
                    const reports = [...(reportsByPatient.get(item.userId) || [])]
                        .filter((report) => {
                            if (reportFilter !== 'all') {
                                const category = String(report.category || '').toLowerCase();
                                if (reportFilter === 'pdf' && !String(report.mimeType || '').includes('pdf')) return false;
                                if (reportFilter !== 'pdf' && !category.includes(reportFilter)) return false;
                            }
                            if (reportSearch && !String(report.fileName || report.name || '').toLowerCase().includes(reportSearch)) return false;
                            return true;
                        })
                        .sort((a, b) => {
                            const left = new Date(a.createdAt || a.uploadedAt || 0).getTime();
                            const right = new Date(b.createdAt || b.uploadedAt || 0).getTime();
                            return reportSort === 'oldest' ? left - right : right - left;
                        });
                    if (!reports.length) {
                        return '<div class="doctor-report-empty"><i class="fas fa-folder-open"></i><span>No patient reports uploaded yet</span></div>';
                    }
                    return `
                        <div class="doctor-report-strip-top">
                            <div class="doctor-report-title"><i class="fas fa-file-medical"></i><span>${reports.length} uploaded report${reports.length > 1 ? 's' : ''}</span></div>
                            <div class="doctor-report-actions">
                            <button
                                type="button"
                                class="btn-outline doctor-download-all-btn"
                                data-patient-id="${item.userId}"
                            >
                                Download All
                            </button>
                        </div>
                        </div>
                        <div class="doctor-report-list">
                            ${reports.slice(0, 4).map((report) => `
                                <button
                                    type="button"
                                    class="doctor-report-pill doctor-report-link doctor-report-preview-btn"
                                    data-patient-id="${item.userId}"
                                    data-report-id="${report.id}"
                                >
                                    ${report.fileName || report.name}
                                </button>
                            `).join('')}
                        </div>
                    `;
                })()}
            </div>
            ${renderDoctorPatientHistory(historyByPatient.get(item.userId) || {})}
            <div class="doctor-action-row premium-doctor-action-row">
                <button class="btn-primary doctor-action-btn" data-action="prescription" data-id="${item.id}">Prescription</button>
                <button class="btn-outline doctor-action-btn" data-action="schedule" data-id="${item.id}">Schedule</button>
                ${canJoinConsultation(item)
                    ? `<button class="btn-outline doctor-action-btn" data-action="video" data-id="${item.id}">Video</button>
                <button class="btn-outline doctor-action-btn" data-action="audio" data-id="${item.id}">Audio</button>`
                    : `<button class="btn-outline doctor-action-btn" disabled>Call Closed</button>`}
                <button class="btn-outline doctor-action-btn" data-action="chat-enable" data-id="${item.id}">${item.chatEnabled ? 'Chat Enabled' : 'Enable Chat'}</button>
                <button class="btn-outline doctor-action-btn" data-action="chat" data-id="${item.id}">Open Chat</button>
                ${item.status !== 'active' && item.status !== 'completed' && item.status !== 'cancelled' ? `<button class="btn-outline doctor-action-btn" data-action="active" data-id="${item.id}">Mark Active</button>` : ''}
                ${item.status !== 'completed' && item.status !== 'cancelled' ? `<button class="btn-outline doctor-action-btn" data-action="complete" data-id="${item.id}">Complete</button>` : ''}
                ${item.status !== 'cancelled' && item.status !== 'completed' ? `<button class="btn-outline doctor-action-btn doctor-cancel-btn" data-action="cancel" data-id="${item.id}">Cancel</button>` : ''}
            </div>
            <div class="doctor-consult-time"><i class="fas fa-history"></i> Booked on ${new Date(item.createdAt).toLocaleString()}</div>
        </article>
    `).join(''));

    container.querySelectorAll('.doctor-action-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            const consultation = consultations.find((item) => item.id === button.dataset.id);
            if (!consultation) return;
            state.selectedConsultation = consultation;
            const action = button.dataset.action;
            if (action === 'prescription') {
                openPrescriptionModal(consultation);
                return;
            }
            if (action === 'schedule') {
                openScheduleModal(consultation);
                return;
            }
            if (action === 'video') {
                await startVideoConsultation(consultation);
                return;
            }
            if (action === 'audio') {
                await startAudioConsultation(consultation);
                return;
            }
            if (action === 'chat-enable') {
                await enableChatForConsultation(consultation);
                return;
            }
            if (action === 'active') {
                await updateConsultationStatus(consultation.id, 'active');
                return;
            }
            if (action === 'complete') {
                await updateConsultationStatus(consultation.id, 'completed');
                return;
            }
            if (action === 'cancel') {
                const shouldCancel = window.confirm(`Cancel consultation for ${consultation.patientName || 'this patient'}?`);
                if (!shouldCancel) return;
                await updateConsultationStatus(consultation.id, 'cancelled');
                return;
            }
            if (action === 'chat') {
                await openChatModal(consultation);
            }
        });
    });
    container.querySelectorAll('.doctor-report-preview-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            const reports = reportsByPatient.get(button.dataset.patientId) || [];
            const report = reports.find((item) => item.id === button.dataset.reportId);
            await openReportViewer(report);
        });
    });
    container.querySelectorAll('.doctor-download-all-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const reports = reportsByPatient.get(button.dataset.patientId) || [];
            downloadAllReportsForPatient(reports);
        });
    });
}

async function openDoctorPortal() {
    closeAllModals();
    resetPortalViews();
    qs('mainSiteContent').style.display = 'none';
    qs('doctorPortal').style.display = 'block';
    text(qs('doctorPortalTitle'), `Welcome, Dr. ${state.currentUser?.fullName || 'Doctor'}`);
    text(qs('doctorPortalSubtitle'), 'Review patient requests, follow up on symptoms, and prepare for upcoming consultations from one focused workspace.');
    await loadDoctorConsultations(qs('doctorPortalSearchInput')?.value || '');
    startPortalAutoRefresh();
}

async function loadPatientOverview() {
    const response = await apiRequest('/api/patient/overview', { auth: 'user' });
    const consultations = response.consultations || [];
    const prescriptions = response.prescriptions || [];
    const reports = response.reports || [];
    const profile = response.profile || state.currentUser || {};
    syncCurrentUserProfile(profile);
    const chatSummaries = await Promise.all(consultations.filter((item) => item.chatEnabled).map(async (item) => {
        try {
            const chatResponse = await apiRequest(`/api/consultations/${item.id}/chat`, { auth: 'user' });
            const lastSeen = getChatSeenTime(item.id);
            const newDoctorMessages = (chatResponse.messages || []).filter((message) =>
                message.senderRole === 'doctor' && (!lastSeen || new Date(message.createdAt) > new Date(lastSeen))
            ).length;
            return { consultationId: item.id, messages: chatResponse.messages || [], newDoctorMessages };
        } catch (error) {
            return { consultationId: item.id, messages: [], newDoctorMessages: 0 };
        }
    }));
    const chatMap = new Map(chatSummaries.map((item) => [item.consultationId, item]));
    text(qs('patientConsultationCount'), String(consultations.length));
    text(qs('patientPrescriptionCount'), String(prescriptions.length));
    renderPatientProfileSummary(profile);
    renderPatientHistoryTimeline(consultations, prescriptions, reports);
    const nextConsult = consultations.find((item) => item.status === 'scheduled' && item.scheduledAt) || consultations[0];
    text(qs('patientNextVisit'), nextConsult?.scheduledAt ? formatCountdown(nextConsult.scheduledAt) : 'No visit');

    const spotlightDoctor = nextConsult ? state.doctorsCatalog.find((doctor) => doctor.id === nextConsult.doctorId) : null;
    html(qs('patientSpotlightCard'), nextConsult ? `
        <div class="patient-spotlight-main">
            <div class="patient-spotlight-copy">
                <div class="patient-spotlight-badge"><i class="fas fa-user-md"></i> Your Care Team</div>
                <h3>${nextConsult.doctorName || 'Assigned Doctor'}</h3>
                <p>${spotlightDoctor?.specialty || 'Specialist care'}${spotlightDoctor?.clinic ? ` at ${spotlightDoctor.clinic}` : ''}</p>
                <div class="patient-spotlight-meta">
                    <span><i class="fas fa-clock"></i> ${formatCountdown(nextConsult.scheduledAt || nextConsult.dateTime)}</span>
                    <span><i class="fas fa-video"></i> ${nextConsult.sessionMode || nextConsult.consultType || 'Consultation'}</span>
                </div>
            </div>
            <div class="patient-spotlight-side">
                <div class="patient-mini-card">
                    <strong>Next consultation</strong>
                    <span>${nextConsult.scheduledAt || nextConsult.dateTime || 'Awaiting schedule'}</span>
                </div>
                <div class="patient-mini-card">
                    <strong>Chat updates</strong>
                    <span>${chatSummaries.reduce((sum, item) => sum + item.newDoctorMessages, 0)} new doctor messages</span>
                </div>
            </div>
        </div>
    ` : '<div class="patient-spotlight-empty"><h3>Your care dashboard is ready</h3><p>Once you book a consultation, your doctor profile, next visit, and chat updates will appear here.</p></div>');

    html(qs('patientConsultationsList'), consultations.length ? consultations.map((item) => {
        const modeLabel = item.sessionMode || item.consultType || 'Consultation';
        const doctorProfile = state.doctorsCatalog.find((doctor) => doctor.id === item.doctorId);
        const chatUpdates = chatMap.get(item.id)?.newDoctorMessages || 0;
        const scheduleLabel = item.scheduledAt || item.dateTime || 'Awaiting schedule';
        return `
        <article class="patient-summary-card consultation-card premium-consultation-card">
            <div class="consultation-card-top">
                <div class="consultation-doctor-brand">
                    <div class="consultation-doctor-avatar"><i class="fas fa-user-md"></i></div>
                    <div class="consultation-doctor-copy">
                        <span class="consultation-card-label">Consultation Care Plan</span>
                        <h4>${item.doctorName || 'Assigned Doctor'}</h4>
                        <p>${doctorProfile?.specialty || 'Specialist consultation'}${doctorProfile?.clinic ? ` • ${doctorProfile.clinic}` : ''}</p>
                    </div>
                </div>
                <span class="patient-status-pill status-${slugStatus(item.status)}">${item.status || 'requested'}</span>
            </div>
            <div class="consultation-card-highlights">
                <span><i class="fas fa-headset"></i> ${modeLabel}</span>
                <span><i class="fas fa-calendar-day"></i> ${scheduleLabel}</span>
                <span><i class="fas fa-hourglass-half"></i> ${formatCountdown(item.scheduledAt || item.dateTime)}</span>
            </div>
            <div class="consultation-card-body">
                <div class="consultation-detail-tile">
                    <span class="consultation-detail-label">Symptoms Shared</span>
                    <p>${item.symptoms || 'No symptoms shared yet'}</p>
                </div>
                <div class="consultation-detail-tile">
                    <span class="consultation-detail-label">Chat Access</span>
                    <p>${item.chatEnabled ? 'Doctor has opened secure chat for this consultation.' : 'Chat is locked until the doctor enables it.'}</p>
                </div>
            </div>
            <div class="patient-action-row consultation-action-row">
                ${canJoinConsultation(item)
                    ? `<button class="btn-primary patient-join-btn" data-id="${item.id}" data-mode="${modeLabel}" data-name="${item.doctorName || 'Doctor'}">Join ${(modeLabel).split(' ')[0]}</button>`
                    : `<button class="btn-primary patient-join-btn" disabled>Consultation Closed</button>`}
                <button class="btn-outline patient-chat-btn" data-id="${item.id}" ${item.chatEnabled ? '' : 'disabled'}>${item.chatEnabled ? 'Chat with Doctor' : 'Chat locked by doctor'}</button>
                ${item.chatEnabled ? `<span class="patient-chat-badge"><i class="fas fa-comment-dots"></i> ${chatUpdates} new</span>` : ''}
            </div>
            <div class="consultation-card-footer">
                <span><i class="fas fa-history"></i> Booked ${new Date(item.createdAt || Date.now()).toLocaleString()}</span>
                <span><i class="fas fa-id-badge"></i> Ref ${String(item.id || '').slice(-8)}</span>
            </div>
        </article>
    `;
    }).join('') : '<div class="patient-summary-card"><h4>No consultations yet</h4><p>Your doctor bookings will appear here.</p></div>');

    html(qs('patientPrescriptionsList'), prescriptions.length ? prescriptions.map((item) => `
        <article class="patient-summary-card prescription-card premium-prescription-card">
            <div class="prescription-card-top">
                <div class="prescription-card-brand">
                    <div class="prescription-card-icon"><i class="fas fa-prescription-bottle-medical"></i></div>
                    <div>
                        <span class="prescription-card-label">Digital Prescription</span>
                        <h4>${item.doctorName || 'Doctor prescription'}</h4>
                    </div>
                </div>
                <span class="patient-status-pill">Prescription</span>
            </div>
            <div class="prescription-card-meta">
                <span><i class="fas fa-calendar-alt"></i> Issued ${new Date(item.createdAt || Date.now()).toLocaleDateString()}</span>
                <span><i class="fas fa-clock"></i> Follow-up ${item.followUpDate || 'As advised by doctor'}</span>
            </div>
            <div class="prescription-card-grid">
                <div class="prescription-block">
                    <span class="prescription-block-label">Medicines</span>
                    <p>${item.medicines || 'Not provided'}</p>
                </div>
                <div class="prescription-block">
                    <span class="prescription-block-label">Dosage Plan</span>
                    <p>${item.dosage || 'Follow doctor instructions'}</p>
                </div>
                <div class="prescription-block prescription-block-wide">
                    <span class="prescription-block-label">Doctor Instructions</span>
                    <p>${item.instructions || 'No special instructions'}</p>
                </div>
            </div>
            <div class="patient-action-row prescription-card-actions">
                <button class="btn-primary prescription-download-btn" data-id="${item.id}"><i class="fas fa-file-download"></i> Download PDF</button>
            </div>
        </article>
    `).join('') : '<div class="patient-summary-card"><h4>No prescriptions yet</h4><p>Doctor prescriptions will be available here after consultation.</p></div>');

    qs('patientConsultationsList')?.querySelectorAll('.patient-chat-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            const consultation = consultations.find((item) => item.id === button.dataset.id);
            if (!consultation) return;
            await openChatModal(consultation);
        });
    });
    qs('patientConsultationsList')?.querySelectorAll('.patient-join-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            const mode = String(button.dataset.mode || '').toLowerCase();
            const doctorName = button.dataset.name || 'Doctor';
            const consultation = consultations.find((item) => item.id === button.dataset.id);
            if (mode.includes('audio')) {
                await startAudioConsultation(consultation);
                return;
            }
            if (mode.includes('chat')) {
                if (consultation?.chatEnabled) {
                    await openChatModal(consultation);
                } else {
                    showNotification('Doctor needs to enable chat first.', 'warning');
                }
                return;
            }
            await startVideoConsultation(consultation);
        });
    });
    qs('patientPrescriptionsList')?.querySelectorAll('.prescription-download-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            const prescription = prescriptions.find((item) => item.id === button.dataset.id);
            if (!prescription) return;
            try {
                await downloadPrescriptionPdf(prescription);
            } catch (error) {
                showNotification('Unable to generate prescription PDF right now.', 'error');
            }
        });
    });
    renderPatientReports(reports);
}

async function openPatientPortal() {
    closeAllModals();
    resetPortalViews();
    qs('mainSiteContent').style.display = 'none';
    qs('patientPortal').style.display = 'block';
    text(qs('patientPortalTitle'), `Welcome, ${state.currentUser?.fullName || 'Patient'}`);
    await loadPatientOverview();
    startPortalAutoRefresh();
}

function openScheduleModal(consultation) {
    qs('scheduleConsultationId').value = consultation.id;
    qs('schedulePatientName').value = consultation.patientName || '';
    qs('scheduleDateTime').value = consultation.scheduledAt ? String(consultation.scheduledAt).slice(0, 16) : '';
    qs('scheduleMode').value = consultation.sessionMode || consultation.consultType || 'Video Consultation';
    openModal('scheduleConsultationModal');
}

function openPrescriptionModal(consultation) {
    qs('prescriptionConsultationId').value = consultation.id;
    qs('prescriptionPatientId').value = consultation.userId || '';
    qs('prescriptionPatientName').value = consultation.patientName || '';
    openModal('prescriptionModal');
}

async function openChatModal(consultation) {
    clearChatTimers();
    state.selectedConsultation = consultation;
    state.chatAttachment = null;
    const counterparty = state.currentRole === 'doctor' ? (consultation.patientName || 'patient') : (consultation.doctorName || 'your doctor');
    text(qs('chatPatientLabel'), `Chat with ${counterparty} about ${consultation.symptoms || 'this consultation'}.`);
    text(qs('chatRoleHint'), state.currentRole === 'doctor' ? 'You are replying as the consulting doctor.' : 'You are chatting from your patient consultation room.');
    if (qs('chatMessageInput')) qs('chatMessageInput').value = '';
    renderChatAttachmentPreview();
    text(qs('chatStatusBanner'), consultation.chatEnabled ? 'Secure consultation chat is active.' : 'Chat is waiting for doctor approval.');
    openModal('chatModal');
    await loadChatThread(consultation.id);
    state.chatRefreshTimer = window.setInterval(() => {
        if (state.selectedConsultation?.id) {
            loadChatThread(state.selectedConsultation.id).catch(() => {});
        }
    }, CHAT_REFRESH_MS);
}

async function loadChatThread(consultationId) {
    const response = await apiRequest(`/api/consultations/${consultationId}/chat`, { auth: 'user' });
    const consultation = response.consultation || state.selectedConsultation || {};
    state.selectedConsultation = consultation;
    markChatSeen(consultationId);
    const messages = response.messages || [];
    const latestMessage = messages[messages.length - 1] || null;
    const latestMessageAt = latestMessage?.createdAt || '';
    const incomingNewMessage = latestMessage
        && latestMessage.senderRole !== state.currentRole
        && latestMessageAt
        && (!state.chatLastMessageAt || new Date(latestMessageAt) > new Date(state.chatLastMessageAt));
    let statusText = consultation.chatEnabled ? 'Secure consultation chat is live now.' : 'Chat is waiting for doctor approval.';
    const seenByOther = state.currentRole === 'doctor' ? consultation.seenByPatientAt : consultation.seenByDoctorAt;
    if (seenByOther) {
        statusText += ` Last seen ${new Date(seenByOther).toLocaleTimeString()}.`;
    } else {
        statusText += ' Live sync is active.';
    }
    if (incomingNewMessage && latestMessageAt !== state.chatLastNotificationAt) {
        showNotification(`New ${latestMessage.senderRole} message received.`, 'info');
        state.chatLastNotificationAt = latestMessageAt;
    }
    text(qs('chatStatusBanner'), statusText);
    const typingIndicator = qs('chatTypingIndicator');
    const otherTyping = consultation.typingRole && consultation.typingRole !== state.currentRole && consultation.typingAt && (Date.now() - new Date(consultation.typingAt).getTime() < 6000);
    if (typingIndicator) {
        typingIndicator.style.display = otherTyping ? 'block' : 'none';
        typingIndicator.textContent = consultation.typingRole === 'doctor' ? 'Doctor is typing...' : 'Patient is typing...';
    }
    html(qs('chatThread'), messages.length ? messages.map((item) => {
        const ownMessage = item.senderRole === state.currentRole;
        return `
            <div class="chat-row ${ownMessage ? 'chat-row-own' : 'chat-row-other'}">
                <div class="chat-bubble ${item.senderRole === 'doctor' ? 'doctor' : 'patient'} ${ownMessage ? 'chat-bubble-own' : ''}">
                    <div class="chat-bubble-head">
                        <strong>${item.senderName || item.senderRole}</strong>
                        <span>${item.senderRole === 'doctor' ? 'Doctor' : 'Patient'}</span>
                    </div>
                    <div class="chat-message-body">${item.message}</div>
                    ${item.attachmentDataUrl ? `<a class="chat-attachment-link" href="${item.attachmentDataUrl}" target="_blank" rel="noopener noreferrer" download="${item.attachmentName || 'attachment'}"><i class="fas fa-paperclip"></i> ${item.attachmentName || 'Attachment'}</a>` : ''}
                    <small>${new Date(item.createdAt).toLocaleString()}</small>
                </div>
            </div>
        `;
    }).join('') : '<div class="chat-empty-state"><i class="fas fa-comments"></i><h4>No messages yet</h4><p>Start the consultation conversation here. This chat is private between doctor and patient.</p></div>');
    state.chatLastMessageAt = latestMessageAt;
    qs('chatThread')?.scrollTo({ top: qs('chatThread').scrollHeight, behavior: 'smooth' });
}

async function enableChatForConsultation(consultation) {
    await apiRequest(`/api/doctor/consultations/${consultation.id}/chat-enable`, {
        method: 'POST',
        auth: 'user'
    });
    showNotification('Chat enabled for this patient.', 'success');
    await loadDoctorConsultations(qs('doctorPortalSearchInput')?.value || '');
}

function buildDeliveryMessage(delivery) {
    const parts = [];
    if (delivery?.email?.status === 'sent') parts.push('Email OTP sent');
    if (delivery?.sms?.status === 'sent') parts.push('SMS OTP sent');
    if (delivery?.email?.status === 'failed') parts.push(`Email failed: ${delivery.email.error}`);
    if (delivery?.sms?.status === 'failed') parts.push(`SMS failed: ${delivery.sms.error}`);
    return parts.join(' | ');
}

function buildSignupPayload(role) {
    if (role === 'patient') {
        return {
            fullName: qs('patientFullName')?.value.trim(),
            email: qs('patientEmail')?.value.trim().toLowerCase(),
            mobile: qs('patientMobile')?.value.trim(),
            gender: qs('patientGender')?.value,
            age: qs('patientAge')?.value.trim(),
            password: qs('patientPassword')?.value,
            confirmPassword: qs('patientConfirmPassword')?.value
        };
    }

    return {
        fullName: qs('doctorFullName')?.value.trim(),
        email: qs('doctorEmail')?.value.trim().toLowerCase(),
        mobile: qs('doctorMobile')?.value.trim(),
        specialty: qs('doctorSpecialty')?.value.trim(),
        licenseNumber: qs('doctorLicense')?.value.trim(),
        clinic: qs('doctorClinic')?.value.trim(),
        password: qs('doctorPassword')?.value,
        confirmPassword: qs('doctorConfirmPassword')?.value
    };
}

function getOtpButton(role) {
    if (role === 'patient') return qs('patientSendOtpBtn');
    if (role === 'doctor') return qs('doctorSendOtpBtn');
    return qs('forgotResendOtpBtn');
}

function setOtpButtonState(role, { disabled, label }) {
    const button = getOtpButton(role);
    if (!button) return;
    if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.textContent.trim();
    }
    button.disabled = disabled;
    button.textContent = label || button.dataset.defaultLabel;
}

function ensureOtpCooldown(role) {
    const remainingMs = state.otpCooldownUntil[role] - Date.now();
    if (remainingMs > 0) {
        throw new Error(`Please wait ${Math.ceil(remainingMs / 1000)} seconds before requesting OTP again.`);
    }
}

function startOtpCooldown(role) {
    state.otpCooldownUntil[role] = Date.now() + OTP_COOLDOWN_MS;
    const button = getOtpButton(role);
    if (!button) return;

    const tick = () => {
        const remainingMs = state.otpCooldownUntil[role] - Date.now();
        if (remainingMs <= 0) {
            button.disabled = false;
            button.textContent = button.dataset.defaultLabel || 'Send OTP';
            return;
        }
        button.disabled = true;
        button.textContent = `Resend in ${Math.ceil(remainingMs / 1000)}s`;
        window.setTimeout(tick, 1000);
    };

    tick();
}

async function handleLogin(role, navUpdater) {
    const identifier = role === 'patient' ? qs('patientLoginIdentifier')?.value.trim() : qs('doctorLoginEmail')?.value.trim();
    const password = role === 'patient' ? qs('patientLoginPassword')?.value : qs('doctorLoginPassword')?.value;
    const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { role, identifier, password }
    });
    saveSession(role, response.user, response.token);
    navUpdater();
    closeModal(role === 'patient' ? 'patientSignInModal' : 'doctorSignInModal');
    showNotification(`Welcome ${response.user.fullName}!`, 'success');
    if (role === 'doctor') {
        await openDoctorPortal();
    } else {
        await openPatientPortal();
    }
}

async function sendSignupOtp(role) {
    if (state.otpBusy[role]) {
        throw new Error('OTP is already being sent. Please wait.');
    }
    ensureOtpCooldown(role);
    const payload = buildSignupPayload(role);
    if (!payload.fullName || !payload.email || !payload.mobile || !payload.password) {
        throw new Error('Please complete all required fields.');
    }
    if (payload.password !== payload.confirmPassword) {
        throw new Error('Passwords do not match.');
    }
    state.otpBusy[role] = true;
    setOtpButtonState(role, { disabled: true, label: 'Sending OTP...' });

    try {
        if (role === 'patient') {
            closeModal('patientSignUpModal');
            setOtpModalState('patient', true, payload.email);
            openModal('patientOtpModal');
        } else {
            closeModal('doctorSignUpModal');
            setOtpModalState('doctor', true, payload.email);
            openModal('doctorOtpModal');
        }

        const result = await apiRequest('/api/auth/request-otp', {
            method: 'POST',
            body: { role, purpose: 'signup', email: payload.email, mobile: payload.mobile }
        });

        state.pendingSignup = { role, challengeId: result.challengeId, user: payload };
        if (role === 'patient') {
            text(qs('patientOtpEmailDisplay'), payload.email);
            setOtpModalState('patient', false, payload.email);
        } else {
            text(qs('doctorOtpEmailDisplay'), payload.email);
            setOtpModalState('doctor', false, payload.email);
        }
        const deliveryMessage = buildDeliveryMessage(result.delivery);
        if (result.delivery?.email?.status === 'failed' && result.delivery?.sms?.status !== 'sent' && !result.delivery?.devPreviewOtp) {
            throw new Error(deliveryMessage || 'OTP delivery failed.');
        }
        startOtpCooldown(role);
        showNotification(deliveryMessage || 'OTP sent successfully.', 'success');
        qs(`${role === 'patient' ? 'patientOtp1' : 'doctorOtp1'}`)?.focus();
    } catch (error) {
        closeModal(role === 'patient' ? 'patientOtpModal' : 'doctorOtpModal');
        openModal(role === 'patient' ? 'patientSignUpModal' : 'doctorSignUpModal');
        throw error;
    } finally {
        state.otpBusy[role] = false;
    }
}

async function verifySignupOtp(role, navUpdater, doctorsLoader) {
    if (!state.pendingSignup) throw new Error('No signup session found.');
    const otp = parseOtpInputs(role === 'patient' ? 'patientOtp' : 'doctorOtp');
    const response = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: {
            role,
            challengeId: state.pendingSignup.challengeId,
            otp,
            user: state.pendingSignup.user
        }
    });

    state.pendingSignup = null;
    closeModal(role === 'patient' ? 'patientOtpModal' : 'doctorOtpModal');
    if (response.token) {
        saveSession(role, response.user, response.token);
        navUpdater();
        showNotification('Account created successfully.', 'success');
    } else {
        showNotification('Doctor account created. Waiting for owner approval.', 'success');
    }
    await doctorsLoader();
}

async function requestPasswordReset() {
    if (state.otpBusy.reset) {
        throw new Error('Reset OTP is already being sent. Please wait.');
    }
    ensureOtpCooldown('reset');
    const role = qs('forgotRole')?.value;
    const identifier = qs('forgotIdentifier')?.value.trim();
    const isEmail = identifier.includes('@');
    state.otpBusy.reset = true;
    setOtpButtonState('reset', { disabled: true, label: 'Sending OTP...' });
    try {
        const response = await apiRequest('/api/auth/request-otp', {
            method: 'POST',
            body: {
                role,
                purpose: 'reset',
                email: isEmail ? identifier.toLowerCase() : '',
                mobile: isEmail ? '' : identifier,
                identifier
            }
        });
        state.pendingReset = { role, identifier, challengeId: response.challengeId };
        text(qs('forgotOtpIdentifierDisplay'), identifier);
        closeModal('forgotPasswordModal');
        openModal('forgotOtpModal');
        const deliveryMessage = buildDeliveryMessage(response.delivery);
        if (response.delivery?.email?.status === 'failed' && response.delivery?.sms?.status !== 'sent' && !response.delivery?.devPreviewOtp) {
            throw new Error(deliveryMessage || 'Reset OTP delivery failed.');
        }
        startOtpCooldown('reset');
        showNotification(deliveryMessage || 'Reset OTP sent successfully.', 'success');
    } finally {
        state.otpBusy.reset = false;
    }
}

function verifyForgotOtp() {
    if (!state.pendingReset) throw new Error('No password reset session found.');
    state.pendingReset.otp = parseOtpInputs('forgotOtp');
    closeModal('forgotOtpModal');
    openModal('resetPasswordModal');
}

async function submitResetPassword() {
    if (!state.pendingReset) throw new Error('Reset session expired.');
    const newPassword = qs('newPassword')?.value;
    const confirmPassword = qs('confirmNewPassword')?.value;
    if (!newPassword || newPassword !== confirmPassword) {
        throw new Error('Passwords do not match.');
    }
    await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: {
            role: state.pendingReset.role,
            challengeId: state.pendingReset.challengeId,
            otp: state.pendingReset.otp,
            newPassword
        }
    });
    const role = state.pendingReset.role;
    state.pendingReset = null;
    qs('resetPasswordForm')?.reset();
    renderUploadedFiles();
    closeModal('resetPasswordModal');
    openModal(role === 'patient' ? 'patientSignInModal' : 'doctorSignInModal');
    showNotification('Password reset successfully.', 'success');
}

async function loadPublicConfig() {
    const response = await apiRequest('/api/config/public');
    state.publicConfig = response;
    if (qs('bleServiceUuid')) qs('bleServiceUuid').value = response.bleServiceUuid;
    if (qs('bleCharacteristicUuid')) qs('bleCharacteristicUuid').value = response.bleCharacteristicUuid;
}

async function loadApprovedDoctors() {
    const response = await apiRequest('/api/doctors');
    const container = qs('doctorsGrid');
    if (!container) return;
    if (!response.doctors.length) {
        container.innerHTML = '<div class="doctor-card"><h3>No approved doctors yet</h3><p>The owner can approve doctor accounts from the admin console.</p></div>';
        return;
    }
    container.innerHTML = response.doctors.map((doctor) => `
        <div class="doctor-card">
            <div class="doctor-avatar"><i class="fas fa-user-md"></i></div>
            <h3>Dr. ${doctor.fullName}</h3>
            <p>${doctor.specialty || 'General Practice'}</p>
            <div class="doctor-rating"><span>Status: ${doctor.status}</span></div>
            <button class="btn-primary consult-doctor-btn" data-id="${doctor.id}" data-name="${doctor.fullName}">Consult -></button>
        </div>
    `).join('');
    document.querySelectorAll('.consult-doctor-btn').forEach((button) => {
        button.addEventListener('click', () => {
            if (!state.sessionToken) {
                showNotification('Please sign in first.', 'warning');
                openModal('roleSelectModal');
                return;
            }
            state.selectedDoctor = {
                id: button.dataset.id,
                name: `Dr. ${button.dataset.name}`
            };
            updateConsultDoctorFields();
            openModal('consultModal');
        });
    });
}

async function submitConsultation(event) {
    event.preventDefault();
    const reportFiles = [...state.uploadedFiles];
    await apiRequest('/api/consultations', {
        method: 'POST',
        auth: 'user',
        body: {
            patientName: qs('consultPatientName')?.value,
            email: qs('consultEmail')?.value,
            phone: qs('consultPhone')?.value,
            doctorId: qs('consultDoctorId')?.value,
            doctorName: qs('consultDoctorName')?.value,
            consultType: qs('consultType')?.value,
            sessionMode: qs('consultType')?.value,
            dateTime: qs('consultDateTime')?.value,
            symptoms: qs('symptoms')?.value
        }
    });
    showNotification('Consultation booked successfully.', 'success');
    closeModal('consultModal');
    event.target.reset();
    state.selectedDoctor = null;
    updateConsultDoctorFields();
    state.uploadedFiles = [];
    renderUploadedFiles();
    if (state.currentRole === 'patient') {
        await addReportsToLibrary(reportFiles, 'Consultation Upload');
    }
    if (state.currentRole === 'patient') {
        await loadPatientOverview();
    }
}

async function submitScheduleConsultation(event) {
    event.preventDefault();
    const consultationId = qs('scheduleConsultationId')?.value;
    await apiRequest(`/api/doctor/consultations/${consultationId}/schedule`, {
        method: 'POST',
        auth: 'user',
        body: {
            scheduledAt: qs('scheduleDateTime')?.value,
            sessionMode: qs('scheduleMode')?.value
        }
    });
    closeModal('scheduleConsultationModal');
    showNotification('Consultation scheduled successfully.', 'success');
    await loadDoctorConsultations(qs('doctorPortalSearchInput')?.value || '');
}

async function submitPrescription(event) {
    event.preventDefault();
    await apiRequest('/api/doctor/prescriptions', {
        method: 'POST',
        auth: 'user',
        body: {
            consultationId: qs('prescriptionConsultationId')?.value,
            patientId: qs('prescriptionPatientId')?.value,
            patientName: qs('prescriptionPatientName')?.value,
            doctorName: `Dr. ${state.currentUser?.fullName || ''}`,
            medicines: qs('prescriptionMedicines')?.value,
            dosage: qs('prescriptionDosage')?.value,
            instructions: qs('prescriptionInstructions')?.value,
            followUpDate: qs('prescriptionFollowUpDate')?.value
        }
    });
    closeModal('prescriptionModal');
    qs('prescriptionForm')?.reset();
    showNotification('Prescription saved for the patient.', 'success');
}

async function submitChatMessage() {
    if (!state.selectedConsultation?.id) {
        throw new Error('No consultation selected for chat.');
    }
    const input = qs('chatMessageInput');
    const sendButton = qs('sendChatMessageBtn');
    const message = input?.value.trim();
    if (!message && !state.chatAttachment) {
        throw new Error('Please type a message or attach a file.');
    }
    if (sendButton) {
        sendButton.disabled = true;
        sendButton.textContent = 'Sending...';
    }
    try {
        await apiRequest(`/api/consultations/${state.selectedConsultation.id}/chat`, {
            method: 'POST',
            auth: 'user',
            body: {
                message,
                attachmentName: state.chatAttachment?.name || null,
                attachmentMimeType: state.chatAttachment?.mimeType || null,
                attachmentDataUrl: state.chatAttachment?.dataUrl || null
            }
        });
        if (input) input.value = '';
        state.chatAttachment = null;
        renderChatAttachmentPreview();
        await updateTypingState(false);
        await loadChatThread(state.selectedConsultation.id);
    } finally {
        if (sendButton) {
            sendButton.disabled = false;
            sendButton.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
        }
    }
}

async function renameSelectedReport() {
    if (!state.selectedReport?.id) {
        throw new Error('No report selected.');
    }
    const nextName = qs('reportRenameInput')?.value.trim();
    if (!nextName) {
        throw new Error('Enter a report name first.');
    }
    const response = await apiRequest(`/api/reports/${state.selectedReport.id}`, {
        method: 'PATCH',
        auth: 'user',
        body: { fileName: nextName }
    });
    state.selectedReport = response.report;
    await openReportViewer(response.report);
    if (state.currentRole === 'doctor') {
        await loadDoctorConsultations(qs('doctorPortalSearchInput')?.value || '');
    } else {
        await loadPatientOverview();
    }
    showNotification('Report name updated.', 'success');
}

async function downloadPrescriptionPdf(prescription) {
    const jsPdfApi = window.jspdf?.jsPDF;
    if (!jsPdfApi) {
        showNotification('PDF library is not available yet. Refresh once and try again.', 'error');
        return;
    }

    const doc = new jsPdfApi({ unit: 'mm', format: 'a4' });
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 16;
    const contentWidth = pageWidth - margin * 2;
    const issuedDate = new Date(prescription.createdAt || Date.now()).toLocaleDateString();
    const followUp = prescription.followUpDate || 'As advised by doctor';
    const doctorName = prescription.doctorName || 'Doctor';
    const patientName = prescription.patientName || state.currentUser?.fullName || 'Patient';
    const logoDataUrl = await getPrescriptionLogoDataUrl();
    const watermarkDataUrl = await getPrescriptionWatermarkDataUrl();
    const clinicName = prescription.clinicName || 'MediSync Virtual Care Clinic';
    const clinicAddress = prescription.clinicAddress || 'Healthcare Avenue, Digital Care Block, India';
    const clinicContact = prescription.clinicContact || '';

    let y = 0;
    const drawSection = (title, body, accent = [37, 99, 235]) => {
        const safeBody = body || 'Not provided';
        const lines = doc.splitTextToSize(safeBody, contentWidth - 12);
        const boxHeight = Math.max(28, 16 + (lines.length * 6));
        const titleChipWidth = Math.max(38, Math.min(64, (title.length * 3.2) + 12));
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.35);
        doc.roundedRect(margin, y, contentWidth, boxHeight, 3, 3, 'S');
        doc.setFillColor(accent[0], accent[1], accent[2]);
        doc.roundedRect(margin + 4, y + 4, titleChipWidth, 8, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text(title.toUpperCase(), margin + 4 + (titleChipWidth / 2), y + 9.8, { align: 'center' });
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11.5);
        doc.text(lines, margin + 6, y + 20);
        y += boxHeight + 8;
    };

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 38, 'F');
    if (logoDataUrl) {
        doc.addImage(logoDataUrl, 'PNG', margin, 7, 24, 24);
    } else {
        doc.setFillColor(37, 99, 235);
        doc.circle(margin + 10, 19, 9, 'F');
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(margin + 8.2, 14, 3.6, 10, 1, 1, 'F');
        doc.roundedRect(margin + 5, 17.2, 10, 3.6, 1, 1, 'F');
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(19);
    doc.text('MediSync', margin + 30, 17);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.text('Connected Care Prescription', margin + 30, 24);
    doc.setFontSize(8.6);
    doc.setTextColor(191, 219, 254);
    doc.text('Confidential medical document', pageWidth - margin, 15, { align: 'right' });
    doc.text(`Prescription ID: ${prescription.id || 'N/A'}`, pageWidth - margin, 21, { align: 'right' });
    doc.text(`Generated: ${issuedDate}`, pageWidth - margin, 27, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, 44, contentWidth, 20, 5, 5, 'FD');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('Prescription Overview', margin + 6, 52);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text('This prescription has been generated digitally for secure patient care follow-up.', margin + 6, 58);

    y = 70;
    doc.setDrawColor(191, 219, 254);
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(margin, y, contentWidth, 38, 5, 5, 'FD');
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Patient Details', margin + 6, y + 8);
    doc.text('Prescription Timeline', margin + 108, y + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.text(`Patient Name: ${patientName}`, margin + 6, y + 17);
    doc.text(`Doctor: ${doctorName}`, margin + 6, y + 24);
    doc.text(`Platform: MediSync`, margin + 6, y + 31);
    doc.text(`Issued On: ${issuedDate}`, margin + 108, y + 17);
    doc.text(`Follow-up: ${followUp}`, margin + 108, y + 24);
    doc.text(`Mode: Digital Prescription`, margin + 108, y + 31);

    if (watermarkDataUrl) {
        doc.addImage(watermarkDataUrl, 'PNG', pageWidth / 2 - 38, 118, 76, 76);
    }

    y += 46;
    drawSection('Medicines', prescription.medicines, [22, 163, 74]);
    drawSection('Dosage Plan', prescription.dosage || 'Follow doctor instructions', [14, 165, 233]);
    drawSection('Doctor Instructions', prescription.instructions || 'No special instructions', [249, 115, 22]);

    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 42, pageWidth - margin, pageHeight - 42);
    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.8);
    doc.text(clinicName, margin, pageHeight - 34);
    doc.text(clinicAddress, margin, pageHeight - 28);
    if (clinicContact) {
        doc.text(clinicContact, margin, pageHeight - 22);
        doc.text('Please take medicines exactly as prescribed. Contact your doctor if symptoms worsen or you experience side effects.', margin, pageHeight - 14);
    } else {
        doc.text('Please take medicines exactly as prescribed. Contact your doctor if symptoms worsen or you experience side effects.', margin, pageHeight - 20);
    }

    doc.save(`MediSync-Prescription-${prescription.id}.pdf`);
}

function logoutUser() {
    clearSession();
    state.selectedDoctor = null;
    updateConsultDoctorFields();
    resetPortalViews();
    updateLoggedOutNav();
    showNotification('Logged out successfully.', 'info');
}

function bindEvents() {
    setupOtpInputs('patientOtp');
    setupOtpInputs('doctorOtp');
    setupOtpInputs('forgotOtp');
    setupFileUpload();
    updateLoggedOutNav();
    renderHospitalMap('');
    updateSimulatedVitals();
    state.vitalsInterval = setInterval(updateSimulatedVitals, 5000);

    qs('watchDemoBtn')?.addEventListener('click', () => showNotification('Bluetooth and OTP demo ready to test locally.', 'info'));
    qs('openAiConsultationBtn')?.addEventListener('click', () => openAiConsultationModal());
    qs('startAiTriageBtn')?.addEventListener('click', () => openAiConsultationModal());
    document.querySelectorAll('.ai-home-category').forEach((button) => {
        button.addEventListener('click', () => {
            openAiConsultationModal(button.dataset.aiPrompt || '');
            sendAiConsultationMessage(button.dataset.aiPrompt || '');
        });
    });
    qs('startConsultBtn')?.addEventListener('click', () => {
        if (state.sessionToken) {
            state.selectedDoctor = null;
            updateConsultDoctorFields();
            openModal('consultModal');
        } else {
            state.authFlowMode = 'signin';
            openModal('roleSelectModal');
        }
    });
    qs('finalCtaBtn')?.addEventListener('click', () => {
        state.authFlowMode = 'signup';
        openModal('roleSelectModal');
    });

    qs('patientSignInForm')?.addEventListener('submit', async (event) => { event.preventDefault(); try { await handleLogin('patient', () => updateLoggedInNav(logoutUser)); } catch (error) { showNotification(error.message, 'error'); } });
    qs('doctorSignInForm')?.addEventListener('submit', async (event) => { event.preventDefault(); try { await handleLogin('doctor', () => updateLoggedInNav(logoutUser)); } catch (error) { showNotification(error.message, 'error'); } });
    qs('patientSendOtpBtn')?.addEventListener('click', async () => { try { await sendSignupOtp('patient'); } catch (error) { showNotification(error.message, 'error'); } });
    qs('doctorSendOtpBtn')?.addEventListener('click', async () => { try { await sendSignupOtp('doctor'); } catch (error) { showNotification(error.message, 'error'); } });
    qs('patientVerifyOtpBtn')?.addEventListener('click', async () => { try { await verifySignupOtp('patient', () => updateLoggedInNav(logoutUser), loadApprovedDoctors); } catch (error) { showNotification(error.message, 'error'); } });
    qs('doctorVerifyOtpBtn')?.addEventListener('click', async () => { try { await verifySignupOtp('doctor', () => updateLoggedInNav(logoutUser), loadApprovedDoctors); } catch (error) { showNotification(error.message, 'error'); } });
    qs('patientResendOtpBtn')?.addEventListener('click', async (event) => { event.preventDefault(); try { await sendSignupOtp('patient'); } catch (error) { showNotification(error.message, 'error'); } });
    qs('doctorResendOtpBtn')?.addEventListener('click', async (event) => { event.preventDefault(); try { await sendSignupOtp('doctor'); } catch (error) { showNotification(error.message, 'error'); } });
    qs('adminLoginForm')?.addEventListener('submit', async (event) => { event.preventDefault(); try { await loginAdmin(); closeModal('adminLoginModal'); await openAdminPanel(); } catch (error) { showNotification(error.message, 'error'); } });
    qs('adminLogoutBtn')?.addEventListener('click', exitAdminMode);
    qs('doctorPortalBackBtn')?.addEventListener('click', () => {
        resetPortalViews();
    });
    qs('patientPortalBackBtn')?.addEventListener('click', () => {
        resetPortalViews();
    });
    qs('patientUploadReportBtn')?.addEventListener('click', () => {
        qs('patientReportUploader')?.click();
    });
    qs('patientEditProfileBtn')?.addEventListener('click', () => {
        openPatientProfileModal(state.currentUser || {});
    });
    qs('patientProfileForm')?.addEventListener('submit', async (event) => {
        try {
            await submitPatientProfile(event);
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
    qs('patientReportUploader')?.addEventListener('change', async (event) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;
        try {
            await addReportsToLibrary(files, 'Patient Upload');
            await loadPatientOverview();
            showNotification('Reports added to your library.', 'success');
        } catch (error) {
            showNotification(error.message, 'error');
        } finally {
            event.target.value = '';
        }
    });
    qs('doctorPortalSearchInput')?.addEventListener('input', () => loadDoctorConsultations(qs('doctorPortalSearchInput')?.value || '').catch((error) => showNotification(error.message, 'error')));
    qs('doctorReportSearchInput')?.addEventListener('input', () => loadDoctorConsultations(qs('doctorPortalSearchInput')?.value || '').catch((error) => showNotification(error.message, 'error')));
    qs('doctorReportFilter')?.addEventListener('change', () => loadDoctorConsultations(qs('doctorPortalSearchInput')?.value || '').catch((error) => showNotification(error.message, 'error')));
    qs('doctorReportSort')?.addEventListener('change', () => loadDoctorConsultations(qs('doctorPortalSearchInput')?.value || '').catch((error) => showNotification(error.message, 'error')));
    qs('doctorSearchInput')?.addEventListener('input', () => loadAdminDoctors(qs('doctorSearchInput').value).catch((error) => showNotification(error.message, 'error')));
    qs('patientSearchInput')?.addEventListener('input', () => loadAdminPatients(qs('patientSearchInput').value).catch((error) => showNotification(error.message, 'error')));
    document.querySelectorAll('.admin-tab-btn').forEach((button) => button.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab-btn').forEach((tab) => tab.classList.remove('active'));
        button.classList.add('active');
        qs('adminDoctorsSection').classList.toggle('active', button.dataset.tab === 'doctors');
        qs('adminPatientsSection').classList.toggle('active', button.dataset.tab === 'patients');
    }));
    document.querySelectorAll('.admin-stat-card.clickable').forEach((card) => {
        card.addEventListener('click', async () => {
            const filter = card.dataset.filter || '';
            const type = card.dataset.type || '';
            try {
                if (type === 'doctor') {
                    document.querySelectorAll('.admin-tab-btn').forEach((tab) => tab.classList.remove('active'));
                    document.querySelector('.admin-tab-btn[data-tab="doctors"]')?.classList.add('active');
                    qs('adminDoctorsSection').classList.add('active');
                    qs('adminPatientsSection').classList.remove('active');
                    if (qs('doctorSearchInput')) {
                        qs('doctorSearchInput').value = filter === 'all' ? '' : filter;
                    }
                    await loadAdminDoctors(filter === 'all' ? '' : filter);
                }

                if (type === 'patient') {
                    document.querySelectorAll('.admin-tab-btn').forEach((tab) => tab.classList.remove('active'));
                    document.querySelector('.admin-tab-btn[data-tab="patients"]')?.classList.add('active');
                    qs('adminPatientsSection').classList.add('active');
                    qs('adminDoctorsSection').classList.remove('active');
                    if (qs('patientSearchInput')) {
                        qs('patientSearchInput').value = '';
                    }
                    await loadAdminPatients('');
                }
            } catch (error) {
                showNotification(error.message, 'error');
            }
        });
    });
    qs('searchHospitalsBtn')?.addEventListener('click', searchHospitals);
    qs('hospitalSearch')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); searchHospitals(); } });
    qs('scanDevicesBtn')?.addEventListener('click', () => connectBluetoothDevice().catch((error) => showNotification(error.message, 'error')));
    qs('disconnectDeviceBtn')?.addEventListener('click', disconnectBluetoothDevice);
    qs('toggleMicBtn')?.addEventListener('click', toggleMicrophone);
    qs('toggleCamBtn')?.addEventListener('click', toggleCamera);
    qs('endCallBtn')?.addEventListener('click', endCall);
    qs('consultForm')?.addEventListener('submit', submitConsultation);
    qs('scheduleConsultationForm')?.addEventListener('submit', async (event) => { try { await submitScheduleConsultation(event); } catch (error) { showNotification(error.message, 'error'); } });
    qs('prescriptionForm')?.addEventListener('submit', async (event) => { try { await submitPrescription(event); } catch (error) { showNotification(error.message, 'error'); } });
    qs('sendChatMessageBtn')?.addEventListener('click', async () => {
        try {
            await submitChatMessage();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
    qs('sendAiConsultationBtn')?.addEventListener('click', () => {
        sendAiConsultationMessage();
    });
    document.querySelectorAll('.ai-guided-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const type = chip.dataset.type;
            const value = chip.dataset.value;
            if (!type || !value) return;
            state.aiConsultationContext[type] = value;
            saveAiConsultationContext();
            renderAiConsultationGuidedChips();
            renderAiConsultationSummary();
        });
    });
    qs('aiTemperatureInput')?.addEventListener('input', (event) => {
        state.aiConsultationContext.temperature = String(event.target.value || '').trim();
        saveAiConsultationContext();
        renderAiConsultationSummary();
    });
    qs('aiSeverityScoreInput')?.addEventListener('input', (event) => {
        state.aiConsultationContext.score = String(event.target.value || '5');
        text(qs('aiSeverityScoreValue'), `${state.aiConsultationContext.score}/10`);
        saveAiConsultationContext();
        renderAiConsultationSummary();
    });
    qs('aiConsultationInput')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        sendAiConsultationMessage();
    });
    qs('aiSymptomCategories')?.querySelectorAll('.ai-symptom-card').forEach((button) => {
        button.addEventListener('click', () => {
            openAiConsultationModal(button.dataset.prompt || '');
            sendAiConsultationMessage(button.dataset.prompt || '');
        });
    });
    qs('aiQuickPrompts')?.querySelectorAll('.ai-quick-chip').forEach((button) => {
        button.addEventListener('click', () => {
            openAiConsultationModal(button.dataset.prompt || '');
            sendAiConsultationMessage(button.dataset.prompt || '');
        });
    });
    qs('reportViewerViewOnlyBtn')?.addEventListener('click', async () => {
        if (state.selectedReport) await openReportViewer(state.selectedReport);
    });
    qs('openReportRenameModalBtn')?.addEventListener('click', () => {
        openReportRenameModal();
    });
    qs('saveReportRenameBtn')?.addEventListener('click', async () => {
        try {
            await renameSelectedReport();
            closeModal('reportRenameModal');
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
    qs('reportRenameInput')?.addEventListener('input', updateReportRenamePreview);
    qs('chatAttachBtn')?.addEventListener('click', () => {
        qs('chatAttachmentInput')?.click();
    });
    qs('chatAttachmentInput')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            state.chatAttachment = await fileToAttachment(file);
            renderChatAttachmentPreview();
        } catch (error) {
            showNotification('Unable to attach this file.', 'error');
        } finally {
            event.target.value = '';
        }
    });
    qs('chatMessageInput')?.addEventListener('keydown', async (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        try {
            await submitChatMessage();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
    qs('chatMessageInput')?.addEventListener('input', () => {
        updateTypingState(true);
        if (state.chatTypingTimer) window.clearTimeout(state.chatTypingTimer);
        state.chatTypingTimer = window.setTimeout(() => {
            updateTypingState(false);
        }, 1500);
    });
    qs('forgotPasswordForm')?.addEventListener('submit', async (event) => { event.preventDefault(); try { await requestPasswordReset(); } catch (error) { showNotification(error.message, 'error'); } });
    qs('forgotVerifyOtpBtn')?.addEventListener('click', () => { try { verifyForgotOtp(); } catch (error) { showNotification(error.message, 'error'); } });
    qs('forgotResendOtpBtn')?.addEventListener('click', async (event) => { event.preventDefault(); try { await requestPasswordReset(); } catch (error) { showNotification(error.message, 'error'); } });
    qs('resetPasswordForm')?.addEventListener('submit', async (event) => { event.preventDefault(); try { await submitResetPassword(); } catch (error) { showNotification(error.message, 'error'); } });
    document.querySelectorAll('.close-modal').forEach((button) => button.addEventListener('click', closeAllModals));
    window.addEventListener('click', (event) => { if (event.target.classList?.contains('modal')) closeAllModals(); });
}

window.openModal = openModal;
window.closeModal = closeModal;
window.togglePassword = togglePassword;
window.startVideoConsultation = startVideoConsultation;
window.toggleMicrophone = toggleMicrophone;
window.toggleCamera = toggleCamera;
window.endCall = endCall;
window.searchHospitals = searchHospitals;
window.approveDoctor = (id) => apiRequest(`/api/admin/doctors/${id}/approve`, { method: 'POST', auth: 'admin' }).then(() => Promise.all([loadAdminOverview(), loadAdminDoctors(qs('doctorSearchInput')?.value || ''), loadApprovedDoctors()])).catch((error) => showNotification(error.message, 'error'));
window.rejectDoctor = (id) => apiRequest(`/api/admin/doctors/${id}/reject`, { method: 'POST', auth: 'admin' }).then(() => Promise.all([loadAdminOverview(), loadAdminDoctors(qs('doctorSearchInput')?.value || '')])).catch((error) => showNotification(error.message, 'error'));
window.deleteDoctorAccount = (id) => apiRequest(`/api/admin/doctors/${id}`, { method: 'DELETE', auth: 'admin' }).then(() => Promise.all([loadAdminOverview(), loadAdminDoctors(qs('doctorSearchInput')?.value || ''), loadApprovedDoctors()])).catch((error) => showNotification(error.message, 'error'));
window.deletePatientAccount = (id) => apiRequest(`/api/admin/patients/${id}`, { method: 'DELETE', auth: 'admin' }).then(() => Promise.all([loadAdminOverview(), loadAdminPatients(qs('patientSearchInput')?.value || '')])).catch((error) => showNotification(error.message, 'error'));
window.selectRole = (role) => { closeModal('roleSelectModal'); openModal(state.authFlowMode === 'signup' ? (role === 'patient' ? 'patientSignUpModal' : 'doctorSignUpModal') : (role === 'patient' ? 'patientSignInModal' : 'doctorSignInModal')); };
window.showPatientSignUp = () => { state.authFlowMode = 'signup'; closeModal('patientSignInModal'); openModal('patientSignUpModal'); };
window.showDoctorSignUp = () => { state.authFlowMode = 'signup'; closeModal('doctorSignInModal'); openModal('doctorSignUpModal'); };
window.openForgotPasswordModal = (role) => { qs('forgotRole').value = role; openModal('forgotPasswordModal'); };

document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    try {
        await loadPublicConfig();
        await loadApprovedDoctors();
        if (state.sessionToken && state.currentUser) {
            startLiveUpdates();
            updateLoggedInNav(logoutUser);
            if (state.currentRole === 'doctor') {
                await openDoctorPortal();
            } else if (state.currentRole === 'patient') {
                await openPatientPortal();
            }
        }
    } catch (error) {
        showNotification(`Startup error: ${error.message}`, 'error');
    }
});
