import { qs } from './dom.js';
import { state } from './state.js';
import { openModal, closeModal, showNotification } from './ui.js';

export async function startVideoConsultation(doctorName = 'Doctor') {
    if (!navigator.mediaDevices?.getUserMedia) {
        showNotification('Camera and microphone are not available in this browser.', 'error');
        return;
    }
    try {
        state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        qs('localVideo').srcObject = state.localStream;
        qs('remoteDoctorName').textContent = doctorName;
        openModal('videoModal');
    } catch (error) {
        showNotification('Camera or microphone permission denied.', 'error');
    }
}

export function toggleMicrophone() {
    if (!state.localStream) return;
    const track = state.localStream.getAudioTracks()[0];
    if (!track) return;
    state.isMicActive = !state.isMicActive;
    track.enabled = state.isMicActive;
    qs('toggleMicBtn').innerHTML = state.isMicActive ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
}

export function toggleCamera() {
    if (!state.localStream) return;
    const track = state.localStream.getVideoTracks()[0];
    if (!track) return;
    state.isCamActive = !state.isCamActive;
    track.enabled = state.isCamActive;
    qs('toggleCamBtn').innerHTML = state.isCamActive ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
}

export function endCall() {
    if (state.localStream) {
        state.localStream.getTracks().forEach((track) => track.stop());
        state.localStream = null;
    }
    closeModal('videoModal');
}
