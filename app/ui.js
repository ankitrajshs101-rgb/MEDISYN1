import { qs, html, text } from './dom.js';
import { state, clearSession } from './state.js';

export function showNotification(message, type = 'info') {
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

export function togglePassword(fieldId) {
    const field = qs(fieldId);
    if (!field) return;
    field.type = field.type === 'password' ? 'text' : 'password';
}

export function configureRoleModal(mode = 'signin') {
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

export function openModal(id) {
    if (id === 'roleSelectModal') configureRoleModal(state.authFlowMode);
    const modal = qs(id);
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

export function closeModal(id) {
    const modal = qs(id);
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
}

export function closeAllModals() {
    ['roleSelectModal', 'patientSignInModal', 'patientSignUpModal', 'patientOtpModal', 'doctorSignInModal', 'doctorSignUpModal', 'doctorOtpModal', 'adminLoginModal', 'consultModal', 'videoModal', 'iotModal', 'forgotPasswordModal', 'forgotOtpModal', 'resetPasswordModal']
        .forEach((id) => closeModal(id));
}

export function updateLoggedOutNav(onLogout) {
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
}

export function updateLoggedInNav(logoutHandler) {
    const nav = document.querySelector('.nav-buttons');
    if (!nav || !state.currentUser) return;
    const firstName = state.currentUser.fullName.split(' ')[0];
    const label = state.currentRole === 'doctor' ? `Dr. ${firstName}` : firstName;
    nav.innerHTML = `
        <button class="btn-outline" id="adminPortalBtn"><i class="fas fa-user-shield"></i> Admin</button>
        <div class="user-badge">
            <div class="user-avatar">${firstName.charAt(0).toUpperCase()}</div>
            <span class="user-name">${label}</span>
            <button class="logout-btn" id="logoutBtn"><i class="fas fa-sign-out-alt"></i></button>
        </div>
    `;
    qs('adminPortalBtn')?.addEventListener('click', () => openModal('adminLoginModal'));
    qs('logoutBtn')?.addEventListener('click', logoutHandler);
}

export function applyVitals(reading = {}) {
    if (reading.heartRate !== undefined) text(qs('heartRate'), reading.heartRate);
    if (reading.bloodPressure !== undefined) text(qs('bloodPressure'), reading.bloodPressure);
    if (reading.spo2 !== undefined) text(qs('spo2'), reading.spo2);
    if (reading.temperature !== undefined) text(qs('temperature'), reading.temperature);

    const insight = qs('aiInsight');
    if (!insight) return;
    const heartRate = Number(reading.heartRate || qs('heartRate')?.textContent || 0);
    insight.classList.remove('warning');
    if (heartRate > 100 || heartRate < 55) {
        insight.classList.add('warning');
        insight.innerHTML = '<i class="fas fa-exclamation-triangle"></i><span>AI Alert: Vital signs need review</span>';
    } else {
        insight.innerHTML = '<i class="fas fa-check-circle"></i><span>AI Insight: All vitals within normal range</span>';
    }
}

export function updateSimulatedVitals() {
    applyVitals({
        heartRate: Math.floor(Math.random() * 20) + 68,
        bloodPressure: `${Math.floor(Math.random() * 12) + 114}/${Math.floor(Math.random() * 8) + 72}`,
        spo2: Math.floor(Math.random() * 4) + 96,
        temperature: (Math.random() * 0.8 + 36.2).toFixed(1)
    });
}

export function renderHospitalMap(searchTerm = '') {
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
