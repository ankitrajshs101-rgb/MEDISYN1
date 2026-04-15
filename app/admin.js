import { apiRequest } from './api.js';
import { qs, html } from './dom.js';
import { saveAdminSession, clearAdminSession } from './state.js';
import { closeAllModals, showNotification } from './ui.js';

export async function loginAdmin() {
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

export async function loadAdminOverview() {
    const response = await apiRequest('/api/admin/overview', { auth: 'admin' });
    qs('adminTotalDoctors').textContent = response.stats.totalDoctors;
    qs('adminPendingDoctors').textContent = response.stats.pendingDoctors;
    qs('adminApprovedDoctors').textContent = response.stats.approvedDoctors;
    qs('adminRejectedDoctors').textContent = response.stats.rejectedDoctors;
    qs('adminTotalPatients').textContent = response.stats.totalPatients;
}

export async function loadAdminDoctors(query = '') {
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

export async function loadAdminPatients(query = '') {
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

export async function openAdminPanel() {
    closeAllModals();
    qs('mainSiteContent').style.display = 'none';
    qs('adminPanel').style.display = 'block';
    await Promise.all([loadAdminOverview(), loadAdminDoctors(), loadAdminPatients()]);
}

export function exitAdminMode() {
    clearAdminSession();
    qs('adminPanel').style.display = 'none';
    qs('mainSiteContent').style.display = 'block';
    showNotification('Exited owner console.', 'info');
}
