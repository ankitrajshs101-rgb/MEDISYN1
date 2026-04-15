import { apiRequest } from './api.js';
import { qs } from './dom.js';
import { state, clearSession } from './state.js';
import { openModal, closeModal, closeAllModals, togglePassword, updateLoggedInNav, updateLoggedOutNav, updateSimulatedVitals, renderHospitalMap, showNotification } from './ui.js';
import { setupOtpInputs, setupFileUpload, renderUploadedFiles, searchHospitals } from './inputs.js';
import { handleLogin, sendSignupOtp, verifySignupOtp, requestPasswordReset, verifyForgotOtp, submitResetPassword } from './auth.js';
import { loginAdmin, openAdminPanel, exitAdminMode, loadAdminDoctors, loadAdminPatients, loadAdminOverview } from './admin.js';
import { connectBluetoothDevice, disconnectBluetoothDevice } from './bluetooth.js';
import { startVideoConsultation, toggleMicrophone, toggleCamera, endCall } from './video.js';

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
            <button class="btn-primary consult-doctor-btn" data-name="${doctor.fullName}">Consult -></button>
        </div>
    `).join('');
    document.querySelectorAll('.consult-doctor-btn').forEach((button) => {
        button.addEventListener('click', () => {
            if (!state.sessionToken) {
                showNotification('Please sign in first.', 'warning');
                openModal('roleSelectModal');
                return;
            }
            startVideoConsultation(`Dr. ${button.dataset.name}`);
        });
    });
}

async function submitConsultation(event) {
    event.preventDefault();
    await apiRequest('/api/consultations', {
        method: 'POST',
        auth: 'user',
        body: {
            patientName: qs('consultPatientName')?.value,
            email: qs('consultEmail')?.value,
            phone: qs('consultPhone')?.value,
            consultType: qs('consultType')?.value,
            dateTime: qs('consultDateTime')?.value,
            symptoms: qs('symptoms')?.value
        }
    });
    showNotification('Consultation booked successfully.', 'success');
    closeModal('consultModal');
    event.target.reset();
    state.uploadedFiles = [];
    renderUploadedFiles();
}

function logoutUser() {
    clearSession();
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
    qs('startConsultBtn')?.addEventListener('click', () => {
        if (state.sessionToken) {
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
            updateLoggedInNav(logoutUser);
        }
    } catch (error) {
        showNotification(`Startup error: ${error.message}`, 'error');
    }
});
