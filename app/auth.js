import { apiRequest } from './api.js';
import { qs, text } from './dom.js';
import { state, saveSession } from './state.js';
import { openModal, closeModal, updateLoggedInNav, showNotification } from './ui.js';
import { parseOtpInputs, renderUploadedFiles } from './inputs.js';

const OTP_COOLDOWN_MS = 30000;

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

export async function handleLogin(role, navUpdater) {
    const identifier = role === 'patient' ? qs('patientLoginIdentifier')?.value.trim() : qs('doctorLoginIdentifier')?.value.trim();
    const password = role === 'patient' ? qs('patientLoginPassword')?.value : qs('doctorLoginPassword')?.value;
    const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { role, identifier, password }
    });
    saveSession(role, response.user, response.token);
    navUpdater();
    closeModal(role === 'patient' ? 'patientSignInModal' : 'doctorSignInModal');
    showNotification(`Welcome ${response.user.fullName}!`, 'success');
}

export async function sendSignupOtp(role) {
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
        const result = await apiRequest('/api/auth/request-otp', {
            method: 'POST',
            body: { role, purpose: 'signup', email: payload.email, mobile: payload.mobile }
        });

        state.pendingSignup = { role, challengeId: result.challengeId, user: payload };
        if (role === 'patient') {
            text(qs('patientOtpEmailDisplay'), payload.email);
            closeModal('patientSignUpModal');
            openModal('patientOtpModal');
        } else {
            text(qs('doctorOtpEmailDisplay'), payload.email);
            closeModal('doctorSignUpModal');
            openModal('doctorOtpModal');
        }
        const deliveryMessage = buildDeliveryMessage(result.delivery);
        if (result.delivery?.email?.status === 'failed' && result.delivery?.sms?.status !== 'sent' && !result.delivery?.devPreviewOtp) {
            throw new Error(deliveryMessage || 'OTP delivery failed.');
        }
        startOtpCooldown(role);
        showNotification(deliveryMessage || 'OTP sent successfully.', 'success');
    } finally {
        state.otpBusy[role] = false;
    }
}

export async function verifySignupOtp(role, navUpdater, doctorsLoader) {
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

export async function requestPasswordReset() {
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

export function verifyForgotOtp() {
    if (!state.pendingReset) throw new Error('No password reset session found.');
    state.pendingReset.otp = parseOtpInputs('forgotOtp');
    closeModal('forgotOtpModal');
    openModal('resetPasswordModal');
}

export async function submitResetPassword() {
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
