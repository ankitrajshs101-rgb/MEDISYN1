export const state = {
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
        bleCharacteristicUuid: ''
    },
    currentBleDevice: null,
    currentBleServer: null,
    currentBleCharacteristic: null,
    vitalsInterval: null,
    localStream: null,
    isMicActive: true,
    isCamActive: true
};

export function saveSession(role, user, token) {
    state.currentRole = role;
    state.currentUser = user;
    state.sessionToken = token;
    sessionStorage.setItem('medisync_current_role', role);
    sessionStorage.setItem('medisync_current_user', JSON.stringify(user));
    sessionStorage.setItem('medisync_session_token', token);
}

export function clearSession() {
    state.currentRole = '';
    state.currentUser = null;
    state.sessionToken = '';
    sessionStorage.removeItem('medisync_current_role');
    sessionStorage.removeItem('medisync_current_user');
    sessionStorage.removeItem('medisync_session_token');
}

export function saveAdminSession(email, token) {
    state.ownerEmail = email;
    state.adminToken = token;
    sessionStorage.setItem('medisync_owner_email', email);
    sessionStorage.setItem('medisync_admin_token', token);
}

export function clearAdminSession() {
    state.ownerEmail = '';
    state.adminToken = '';
    sessionStorage.removeItem('medisync_owner_email');
    sessionStorage.removeItem('medisync_admin_token');
}
