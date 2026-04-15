import { qs, html, normalizeSearchTerm } from './dom.js';
import { state } from './state.js';
import { renderHospitalMap } from './ui.js';

export function setupOtpInputs(prefix) {
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

export function parseOtpInputs(prefix) {
    return Array.from({ length: 6 }, (_, index) => qs(`${prefix}${index + 1}`)?.value || '').join('');
}

export function setupFileUpload() {
    const dropZone = qs('fileDropZone');
    const input = qs('medicalReports');
    if (!dropZone || !input) return;

    dropZone.addEventListener('click', () => input.click());
    input.addEventListener('change', (event) => {
        state.uploadedFiles = Array.from(event.target.files || []);
        renderUploadedFiles();
    });
}

export function renderUploadedFiles() {
    const container = qs('uploadedFilesList');
    if (!container) return;
    html(container, state.uploadedFiles.map((file) => `
        <div class="file-item">
            <span>${file.name}</span>
            <span>${(file.size / 1024).toFixed(1)} KB</span>
        </div>
    `).join(''));
}

export function searchHospitals() {
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
