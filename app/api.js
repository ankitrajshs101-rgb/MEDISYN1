import { state } from './state.js';

export async function apiRequest(path, options = {}) {
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
