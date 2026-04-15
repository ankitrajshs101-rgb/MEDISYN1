export function qs(id) {
    return document.getElementById(id);
}

export function html(container, value) {
    if (container) container.innerHTML = value;
}

export function text(container, value) {
    if (container) container.textContent = value;
}

export function normalizeSearchTerm(value = '') {
    return value.trim().toLowerCase();
}
