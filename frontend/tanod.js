/* ============================================================
   TANOD.JS — Login + Dashboard logic for the Tanod field portal
   Mirrors apiHelper.js's session/fetch pattern, but with its own
   sessionStorage keys (tanodToken/tanodData) so it never collides
   with an admin/captain session in the same browser.
============================================================ */

const TANOD_API_URL = 'http://localhost:3000/api';

function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getTanodToken() {
    return sessionStorage.getItem('tanodToken');
}

function getTanodData() {
    try {
        const data = sessionStorage.getItem('tanodData');
        return data ? JSON.parse(data) : null;
    } catch (e) {
        return null;
    }
}

function clearTanodSession() {
    sessionStorage.removeItem('tanodToken');
    sessionStorage.removeItem('tanodData');
}

async function tanodFetch(path, options = {}) {
    const token = getTanodToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${TANOD_API_URL}${path}`, { ...options, headers });

    if (response.status === 401) {
        clearTanodSession();
        window.location.href = 'tanod-login.html';
        throw new Error('Session expired. Please login again.');
    }

    return response;
}

// ============================================================
// TANOD LOGIN PAGE
// ============================================================

function initTanodLoginPage() {
    const form = document.getElementById('tanodLoginForm');
    if (!form) return;

    const errorMsg = document.getElementById('errorMsg');
    const errorText = document.getElementById('errorText');
    const loginBtn = form.querySelector('.btn-login');

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const name = document.getElementById('tanodName').value.trim();
        if (errorMsg) errorMsg.style.display = 'none';

        if (!name) {
            if (errorText) errorText.textContent = 'Please enter your name.';
            if (errorMsg) errorMsg.style.display = 'flex';
            return;
        }

        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Logging in...';
        }

        try {
            const response = await fetch(`${TANOD_API_URL}/tanod/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });

            const data = await response.json();

            if (!response.ok) {
                if (errorText) errorText.textContent = data.error || 'Tanod not found.';
                if (errorMsg) errorMsg.style.display = 'flex';
                if (loginBtn) {
                    loginBtn.disabled = false;
                    loginBtn.innerHTML = 'Tanod Login <i class="fa-solid fa-arrow-right"></i>';
                }
                return;
            }

            sessionStorage.setItem('tanodToken', data.session_token);
            sessionStorage.setItem('tanodData', JSON.stringify(data.tanod));

            window.location.href = 'tanod-dashboard.html';

        } catch (error) {
            console.error('Tanod login error:', error);
            if (errorText) errorText.textContent = 'Unable to connect to server. Please try again.';
            if (errorMsg) errorMsg.style.display = 'flex';
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.innerHTML = 'Tanod Login <i class="fa-solid fa-arrow-right"></i>';
            }
        }
    });
}

// ============================================================
// TANOD DASHBOARD PAGE
// ============================================================

function initTanodDashboardPage() {
    const profileCard = document.getElementById('profileCard');
    if (!profileCard) return;

    const tanod = getTanodData();
    if (!tanod || !getTanodToken()) {
        window.location.href = 'tanod-login.html';
        return;
    }

    renderProfile(tanod);
    loadSchedule(tanod.id);
    loadAreaIncidents(tanod.id);
    loadPatrolLogs(tanod.id);

    // Report Incident form defaults
    const dateField = document.getElementById('reportDate');
    const timeField = document.getElementById('reportTime');
    const now = new Date();
    if (dateField) dateField.value = now.toISOString().slice(0, 10);
    if (timeField) timeField.value = now.toTimeString().slice(0, 5);
    const locationField = document.getElementById('reportLocation');
    if (locationField) locationField.textContent = tanod.assigned_area || 'Not assigned';

    const logDateField = document.getElementById('logDate');
    if (logDateField) logDateField.value = now.toISOString().slice(0, 10);

    document.getElementById('logoutBtn')?.addEventListener('click', function () {
        clearTanodSession();
        window.location.href = 'tanod-login.html';
    });

    document.getElementById('incidentReportForm')?.addEventListener('submit', (e) => handleIncidentReport(e, tanod));
    document.getElementById('patrolLogForm')?.addEventListener('submit', (e) => handlePatrolLogSubmit(e, tanod));
}

function renderProfile(tanod) {
    document.getElementById('profileName').textContent = tanod.name || '—';
    document.getElementById('profilePosition').textContent = tanod.position || 'Tanod';
    document.getElementById('profileArea').textContent = tanod.assigned_area || 'Not assigned';

    const shiftStart = tanod.shift_start || null;
    const shiftEnd = tanod.shift_end || null;
    const shiftText = (shiftStart && shiftEnd) ? `${shiftStart} — ${shiftEnd}` : 'Not set';
    document.getElementById('profileShift').textContent = shiftText;
}

async function loadSchedule(tanodId) {
    const list = document.getElementById('scheduleList');
    const logScheduleSelect = document.getElementById('logSchedule');

    try {
        const response = await tanodFetch(`/tanod/schedules/${tanodId}`);
        const schedules = await response.json();

        if (!Array.isArray(schedules) || schedules.length === 0) {
            list.innerHTML = '<p class="tanod-empty">No schedules currently match your assigned area.</p>';
            return;
        }

        list.innerHTML = schedules.map(s => `
            <div class="tanod-list-item">
                <div class="tanod-list-item-main">
                    <strong>${escapeHTML(s.location)}</strong>
                    <span class="tanod-badge">${escapeHTML(s.day_of_week)}</span>
                </div>
                <div class="tanod-list-item-sub">
                    <i class="fa-regular fa-clock"></i> ${escapeHTML(s.start_time)} – ${escapeHTML(s.end_time)}
                    ${s.reason ? `<br><span class="tanod-muted">${escapeHTML(s.reason)}</span>` : ''}
                </div>
            </div>
        `).join('');

        if (logScheduleSelect) {
            logScheduleSelect.innerHTML = '<option value="" disabled selected>Select a schedule</option>' +
                schedules.map(s => `<option value="${s.id}">${escapeHTML(s.location)} — ${escapeHTML(s.day_of_week)} (${escapeHTML(s.start_time)}–${escapeHTML(s.end_time)})</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading schedule:', error);
        list.innerHTML = '<p class="tanod-empty">Failed to load schedule.</p>';
    }
}

async function loadAreaIncidents(tanodId) {
    const list = document.getElementById('areaIncidentsList');
    try {
        const response = await tanodFetch(`/tanod/incidents/${tanodId}`);
        const incidents = await response.json();

        if (!Array.isArray(incidents) || incidents.length === 0) {
            list.innerHTML = '<p class="tanod-empty">No recent incidents recorded in your area.</p>';
            return;
        }

        list.innerHTML = incidents.map(inc => `
            <div class="tanod-list-item">
                <div class="tanod-list-item-main">
                    <strong>${escapeHTML(inc.incident_type)}</strong>
                    <span class="tanod-badge tanod-badge-${(inc.status || '').toLowerCase()}">${escapeHTML(inc.status)}</span>
                </div>
                <div class="tanod-list-item-sub">
                    <i class="fa-regular fa-calendar"></i> ${escapeHTML(inc.date)} ${escapeHTML(inc.time)}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading area incidents:', error);
        list.innerHTML = '<p class="tanod-empty">Failed to load incidents.</p>';
    }
}

async function loadPatrolLogs(tanodId) {
    const list = document.getElementById('logsList');
    try {
        const response = await tanodFetch(`/tanod/patrol-logs/${tanodId}`);
        const logs = await response.json();

        if (!Array.isArray(logs) || logs.length === 0) {
            list.innerHTML = '<p class="tanod-empty">No patrol logs yet.</p>';
            return;
        }

        list.innerHTML = logs.map(log => `
            <div class="tanod-list-item">
                <div class="tanod-list-item-main">
                    <strong>${escapeHTML(log.patrol_date)}</strong>
                    <span class="tanod-badge">${escapeHTML(log.status)}</span>
                </div>
                ${log.report ? `<div class="tanod-list-item-sub">${escapeHTML(log.report)}</div>` : ''}
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading patrol logs:', error);
        list.innerHTML = '<p class="tanod-empty">Failed to load patrol logs.</p>';
    }
}

async function handleIncidentReport(e, tanod) {
    e.preventDefault();
    const statusEl = document.getElementById('reportStatus');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    const payload = {
        incident_type: document.getElementById('reportType').value,
        date: document.getElementById('reportDate').value,
        time: document.getElementById('reportTime').value,
        description: document.getElementById('reportDescription').value.trim()
    };

    if (!payload.incident_type || !payload.date || !payload.time) {
        statusEl.textContent = 'Please fill in all required fields.';
        statusEl.className = 'tanod-form-status tanod-status-error';
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
    }

    try {
        const response = await tanodFetch('/tanod/incident', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to submit report.');
        }

        statusEl.textContent = '✅ Incident reported successfully.';
        statusEl.className = 'tanod-form-status tanod-status-success';
        e.target.reset();

        const now = new Date();
        document.getElementById('reportDate').value = now.toISOString().slice(0, 10);
        document.getElementById('reportTime').value = now.toTimeString().slice(0, 5);

        loadAreaIncidents(tanod.id);
    } catch (error) {
        console.error('Error reporting incident:', error);
        statusEl.textContent = error.message || 'Failed to submit report.';
        statusEl.className = 'tanod-form-status tanod-status-error';
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Report';
        }
    }
}

async function handlePatrolLogSubmit(e, tanod) {
    e.preventDefault();
    const statusEl = document.getElementById('logStatusMsg');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    const payload = {
        schedule_id: parseInt(document.getElementById('logSchedule').value, 10),
        patrol_date: document.getElementById('logDate').value,
        status: document.getElementById('logStatus').value,
        report: document.getElementById('logReport').value.trim()
    };

    if (!payload.schedule_id || !payload.patrol_date) {
        statusEl.textContent = 'Please select a schedule and date.';
        statusEl.className = 'tanod-form-status tanod-status-error';
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    }

    try {
        const response = await tanodFetch('/tanod/patrol-log', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to add patrol log.');
        }

        statusEl.textContent = '✅ Patrol log added.';
        statusEl.className = 'tanod-form-status tanod-status-success';
        e.target.reset();
        document.getElementById('logDate').value = new Date().toISOString().slice(0, 10);

        loadPatrolLogs(tanod.id);
    } catch (error) {
        console.error('Error adding patrol log:', error);
        statusEl.textContent = error.message || 'Failed to add patrol log.';
        statusEl.className = 'tanod-form-status tanod-status-error';
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Patrol Log';
        }
    }
}

document.addEventListener('DOMContentLoaded', function () {
    initTanodLoginPage();
    initTanodDashboardPage();
});
