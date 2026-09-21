/* ============================================================
   TANOD.JS — Login + Dashboard logic for the Tanod field portal
   Mirrors apiHelper.js's session/fetch pattern, but with its own
   sessionStorage keys (tanodToken/tanodData) so it never collides
   with an admin/captain session in the same browser.
============================================================ */

const TANOD_API_URL = `${window.location.origin}/api`;

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

// Periodically re-runs fn(), skipping ticks while the tab is in the
// background and refreshing immediately once it's visible again.
function startTanodPolling(fn, intervalMs = 15000) {
    setInterval(() => {
        if (document.visibilityState === 'visible') fn();
    }, intervalMs);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') fn();
    });
}

// ============================================================
// TANOD LOGIN PAGE
// ============================================================

function initTanodLoginPage() {
    const form = document.getElementById('tanodLoginForm');
    if (!form) return;

    const togglePin = document.getElementById('toggleTanodPin');
    const pinInput = document.getElementById('tanodPin');
    if (togglePin && pinInput) {
        togglePin.addEventListener('click', function () {
            const type = pinInput.getAttribute('type') === 'password' ? 'text' : 'password';
            pinInput.setAttribute('type', type);
            this.classList.toggle('fa-eye');
            this.classList.toggle('fa-eye-slash');
        });
    }

    const errorMsg = document.getElementById('errorMsg');
    const errorText = document.getElementById('errorText');
    const loginBtn = form.querySelector('.btn-login');

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const username = document.getElementById('tanodUsername').value.trim();
        const pin_code = document.getElementById('tanodPin').value.trim();
        if (errorMsg) errorMsg.style.display = 'none';

        if (!username || !pin_code) {
            if (errorText) errorText.textContent = 'Please enter your username and PIN.';
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
                body: JSON.stringify({ username, pin_code })
            });

            const data = await response.json();

            if (!response.ok) {
                if (errorText) errorText.textContent = data.error || 'Invalid username or PIN.';
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

    initTanodPanelNav();
    populateAllReportLocations();
    loadProfileDetails(tanod.id);
    initAvatarUpload();
    loadSchedule(tanod.id);
    loadAreaIncidents(tanod.id);
    loadPatrolLogs(tanod.id);
    loadMyReportLogs(tanod.id);
    initIncidentDetailModal();

    // Keeps every panel current without the tanod needing to re-login -
    // mirrors apiHelper.js's startLivePolling(), duplicated locally (see
    // this file's header comment on why tanod.js doesn't just include
    // apiHelper.js) rather than pulling in that whole unrelated file for
    // one small helper.
    startTanodPolling(() => loadAreaIncidents(tanod.id), 15000);
    startTanodPolling(() => loadSchedule(tanod.id), 15000);
    startTanodPolling(() => loadPatrolLogs(tanod.id), 15000);
    startTanodPolling(() => loadMyReportLogs(tanod.id), 15000);

    // Report Incident form defaults
    const dateField = document.getElementById('reportDate');
    const timeField = document.getElementById('reportTime');
    const now = new Date();
    if (dateField) dateField.value = now.toISOString().slice(0, 10);
    if (timeField) timeField.value = now.toTimeString().slice(0, 5);

    const logDateField = document.getElementById('logDate');
    if (logDateField) logDateField.value = now.toISOString().slice(0, 10);

    const logoutModal = document.getElementById('tanodLogoutModal');
    document.getElementById('logoutBtn')?.addEventListener('click', function () {
        logoutModal?.classList.add('active');
    });
    document.getElementById('tanodLogoutCancelBtn')?.addEventListener('click', function () {
        logoutModal?.classList.remove('active');
    });
    document.getElementById('tanodLogoutConfirmBtn')?.addEventListener('click', function () {
        clearTanodSession();
        window.location.href = 'tanod-login.html';
    });
    logoutModal?.addEventListener('click', function (e) {
        if (e.target === logoutModal) logoutModal.classList.remove('active');
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') logoutModal?.classList.remove('active');
    });

    document.getElementById('incidentReportForm')?.addEventListener('submit', (e) => handleIncidentReport(e, tanod));
    document.getElementById('patrolLogForm')?.addEventListener('submit', (e) => handlePatrolLogSubmit(e, tanod));

    initOfflineBanner();
    initGpsCapture();
}

// Holds the tanod's captured GPS fix for the report currently being
// filled out - read by handleIncidentReport(), cleared after a
// successful submit (or a fresh capture) so a stale fix from a previous
// report never silently attaches to the next one.
let capturedGpsCoords = null;

function initGpsCapture() {
    const btn = document.getElementById('captureGpsBtn');
    const status = document.getElementById('gpsStatus');
    if (!btn || !status) return;

    btn.addEventListener('click', () => {
        if (!navigator.geolocation) {
            status.textContent = 'GPS is not supported on this device.';
            status.className = 'tanod-form-status tanod-status-error';
            return;
        }

        btn.disabled = true;
        status.textContent = 'Getting your location...';
        status.className = 'tanod-form-status';

        navigator.geolocation.getCurrentPosition(
            (position) => {
                capturedGpsCoords = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                status.textContent = `📍 Location attached (accurate to ~${Math.round(position.coords.accuracy)}m).`;
                status.className = 'tanod-form-status tanod-status-success';
                btn.disabled = false;
            },
            (error) => {
                capturedGpsCoords = null;
                status.textContent = error.code === error.PERMISSION_DENIED
                    ? 'Location permission denied. The report will use the area\'s general location instead.'
                    : 'Could not get your location. The report will use the area\'s general location instead.';
                status.className = 'tanod-form-status tanod-status-error';
                btn.disabled = false;
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

// A tanod is out in the field on mobile data, so losing signal mid-patrol
// is a real scenario - surfaces it instead of silently failing form
// submissions with no explanation.
function initOfflineBanner() {
    const banner = document.getElementById('tanodOfflineBanner');
    if (!banner) return;

    const update = () => banner.classList.toggle('active', !navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
}

// The tanod object cached at login only carries id/name/position (see
// /api/tanod/login's SELECT) - the Profile panel needs the fuller
// record (username, contact number, picture), so it fetches that
// separately rather than bloating what every login response returns.
async function loadProfileDetails(tanodId) {
    try {
        const response = await tanodFetch(`/tanod/dashboard/${tanodId}`);
        const data = await response.json();
        renderProfile(data);
    } catch (error) {
        console.error('Error loading profile details:', error);
    }
}

function renderProfile(tanod) {
    document.getElementById('profileName').textContent = tanod.name || '—';
    document.getElementById('profileUsername').textContent = tanod.username ? `@${tanod.username}` : '—';
    document.getElementById('profilePosition').textContent = tanod.position || 'Tanod';
    document.getElementById('profileContact').textContent = tanod.contact_no || '—';
    renderAvatar(tanod.profile_picture);
}

function renderAvatar(profilePicture) {
    const img = document.getElementById('profileAvatarImg');
    const fallback = document.getElementById('profileAvatarFallback');
    if (!img || !fallback) return;

    if (profilePicture) {
        img.src = `/uploads/${profilePicture}`;
        img.style.display = 'block';
        fallback.style.display = 'none';
    } else {
        img.style.display = 'none';
        fallback.style.display = 'flex';
    }
}

function initAvatarUpload() {
    const avatarBtn = document.getElementById('avatarBtn');
    const avatarInput = document.getElementById('avatarInput');
    const avatarStatus = document.getElementById('avatarStatus');
    if (!avatarBtn || !avatarInput) return;

    avatarBtn.addEventListener('click', () => avatarInput.click());

    avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files[0];
        if (!file) return;

        if (file.size > 3 * 1024 * 1024) {
            avatarStatus.textContent = 'Image must be 3MB or smaller.';
            avatarStatus.className = 'tanod-form-status tanod-status-error';
            avatarInput.value = '';
            return;
        }

        avatarStatus.textContent = 'Uploading...';
        avatarStatus.className = 'tanod-form-status';

        // Raw fetch, not tanodFetch - FormData needs the browser to set its
        // own multipart Content-Type (with boundary), which tanodFetch's
        // hardcoded 'application/json' header would break.
        const formData = new FormData();
        formData.append('avatar', file);

        try {
            const token = getTanodToken();
            const response = await fetch(`${TANOD_API_URL}/tanod/profile-picture`, {
                method: 'POST',
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                body: formData
            });

            if (response.status === 401) {
                clearTanodSession();
                window.location.href = 'tanod-login.html';
                return;
            }

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to upload photo.');
            }

            renderAvatar(data.profile_picture);
            avatarStatus.textContent = '✅ Profile picture updated.';
            avatarStatus.className = 'tanod-form-status tanod-status-success';
        } catch (error) {
            console.error('Error uploading avatar:', error);
            avatarStatus.textContent = error.message || 'Failed to upload photo.';
            avatarStatus.className = 'tanod-form-status tanod-status-error';
        } finally {
            avatarInput.value = '';
        }
    });
}

// ============================================================
// BOTTOM NAV — PANEL SWITCHING
// ============================================================

function initTanodPanelNav() {
    const navBtns = document.querySelectorAll('.tanod-nav-btn');
    const panels = document.querySelectorAll('.tanod-panel');

    navBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            const target = this.getAttribute('data-panel');

            navBtns.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));

            this.classList.add('active');
            document.querySelector(`.tanod-panel[data-panel="${target}"]`)?.classList.add('active');

            window.scrollTo({ top: 0, behavior: 'instant' });
        });
    });
}

// Any tanod can report an incident from any barangay location, not just
// one they're currently assigned to patrol (see /api/tanod/incident) —
// this just lists every location, with the tanod's own assigned area(s)
// grouped first as a convenience since that's the common case.
function populateAllReportLocations(assignedLocations = []) {
    const locationSelect = document.getElementById('reportLocation');
    if (!locationSelect || typeof BARANGAY_LOCATIONS === 'undefined') return;

    const previousValue = locationSelect.value;
    const assignedSet = new Set(assignedLocations);
    const otherLocations = BARANGAY_LOCATIONS.filter(loc => !assignedSet.has(loc));

    let optionsHtml = '<option value="" disabled selected>Select a location</option>';

    if (assignedLocations.length > 0) {
        optionsHtml += '<optgroup label="My Assigned Areas">' +
            assignedLocations.map(loc => `<option value="${escapeHTML(loc)}">${escapeHTML(loc)}</option>`).join('') +
            '</optgroup>';
        optionsHtml += `<optgroup label="All Other Areas">${otherLocations.map(loc => `<option value="${escapeHTML(loc)}">${escapeHTML(loc)}</option>`).join('')}</optgroup>`;
    } else {
        optionsHtml += otherLocations.map(loc => `<option value="${escapeHTML(loc)}">${escapeHTML(loc)}</option>`).join('');
    }

    locationSelect.innerHTML = optionsHtml;

    if (previousValue && BARANGAY_LOCATIONS.includes(previousValue)) {
        locationSelect.value = previousValue;
    }
}

// Populated by loadSchedule() and read by renderScheduleList() - kept
// separate from the fetch so it can also be re-rendered from
// loadAreaIncidents() (see below), since either one can finish loading
// last and both are needed for the incident-type breakdown per schedule.
let currentSchedules = [];

async function loadSchedule(tanodId) {
    const logScheduleSelect = document.getElementById('logSchedule');

    try {
        const response = await tanodFetch(`/tanod/schedules/${tanodId}`);
        const schedules = await response.json();
        currentSchedules = Array.isArray(schedules) ? schedules : [];

        const assignedLocations = [...new Set(currentSchedules.map(s => s.location))];
        populateAllReportLocations(assignedLocations);

        renderScheduleList();

        if (logScheduleSelect) {
            // Preserved across live-polling refreshes - without this,
            // a poll firing mid-way through filling out the Add Patrol
            // Log form would silently reset whatever schedule was picked.
            const previousScheduleValue = logScheduleSelect.value;
            logScheduleSelect.innerHTML = '<option value="" disabled selected>Select a schedule</option>' +
                currentSchedules.map(s => `<option value="${s.id}">${escapeHTML(s.location)} — ${escapeHTML(s.day_of_week)} (${escapeHTML(s.start_time)}–${escapeHTML(s.end_time)})</option>`).join('');
            if (previousScheduleValue && currentSchedules.some(s => String(s.id) === previousScheduleValue)) {
                logScheduleSelect.value = previousScheduleValue;
            }
        }
    } catch (error) {
        console.error('Error loading schedule:', error);
        const list = document.getElementById('scheduleList');
        if (list) list.innerHTML = '<p class="tanod-empty">Failed to load schedule.</p>';
    }
}

// Groups currentAreaIncidents by location -> incident type counts, so a
// tanod sees at a glance what's actually been happening in an area
// they're assigned to (e.g. "5 incidents: Theft (3), Vandalism (2)")
// instead of five otherwise-identical-looking schedule cards for the
// same location.
function getIncidentTypesForArea(location) {
    const counts = {};
    currentAreaIncidents.forEach(inc => {
        if (inc.street_name === location) {
            counts[inc.incident_type] = (counts[inc.incident_type] || 0) + 1;
        }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// Re-run from both loadSchedule() and loadAreaIncidents() (whichever
// finishes last) since it needs data from both.
function renderScheduleList() {
    const list = document.getElementById('scheduleList');
    if (!list) return;

    if (currentSchedules.length === 0) {
        list.innerHTML = '<p class="tanod-empty">You have not been assigned to any patrol schedule yet.</p>';
        return;
    }

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    // Today's patrol(s) first, so the one thing a tanod actually needs
    // before heading out isn't buried under other days of the week.
    const sortedSchedules = [...currentSchedules].sort((a, b) => {
        if (a.day_of_week === today && b.day_of_week !== today) return -1;
        if (b.day_of_week === today && a.day_of_week !== today) return 1;
        return 0;
    });

    list.innerHTML = sortedSchedules.map(s => {
        const types = getIncidentTypesForArea(s.location);
        const total = types.reduce((sum, [, count]) => sum + count, 0);
        const typesSummary = types.length > 0
            ? `${total} incident${total > 1 ? 's' : ''}: ${types.map(([type, count]) => `${type} (${count})`).join(', ')}`
            : 'No recorded incidents in this area yet';
        const isToday = s.day_of_week === today;

        return `
            <div class="tanod-list-item${isToday ? ' tanod-list-item-today' : ''}">
                <div class="tanod-list-item-main">
                    <strong>${escapeHTML(s.location)}</strong>
                    <span class="tanod-badge${isToday ? ' tanod-badge-today' : ''}">${isToday ? 'Today' : escapeHTML(s.day_of_week)}</span>
                </div>
                <div class="tanod-list-item-sub">
                    <i class="fa-regular fa-clock"></i> ${escapeHTML(s.start_time)} – ${escapeHTML(s.end_time)}
                    ${s.reason ? `<br><span class="tanod-muted">${escapeHTML(s.reason)}</span>` : ''}
                </div>
                <div class="tanod-list-item-sub" style="margin-top: 6px;">
                    <i class="fa-solid fa-triangle-exclamation"></i> ${escapeHTML(typesSummary)}
                </div>
            </div>
        `;
    }).join('');
}

// Populated by loadAreaIncidents() and read by the click handler below -
// avoids a second fetch just to know what was in the list item tapped.
let currentAreaIncidents = [];

async function loadAreaIncidents(tanodId) {
    const list = document.getElementById('areaIncidentsList');
    try {
        const response = await tanodFetch(`/tanod/incidents/${tanodId}`);
        const incidents = await response.json();

        currentAreaIncidents = Array.isArray(incidents) ? incidents : [];
        // Re-render the schedule cards too - they show an incident-type
        // breakdown per location that depends on this same data (see
        // getIncidentTypesForArea), and this fetch can finish after
        // loadSchedule()'s.
        renderScheduleList();

        if (currentAreaIncidents.length === 0) {
            list.innerHTML = '<p class="tanod-empty">No recent incidents recorded in your area.</p>';
            return;
        }

        list.innerHTML = currentAreaIncidents.map(inc => `
            <div class="tanod-list-item tanod-list-item-clickable" data-incident-id="${inc.id}">
                <div class="tanod-list-item-main">
                    <strong>${escapeHTML(inc.incident_type)}</strong>
                    <span class="tanod-badge tanod-badge-${(inc.status || '').toLowerCase()}">${escapeHTML(inc.status)}</span>
                </div>
                <div class="tanod-list-item-sub">
                    <i class="fa-regular fa-calendar"></i> ${escapeHTML(inc.date)} ${escapeHTML(inc.time)}
                    ${inc.street_name ? ` &middot; <i class="fa-solid fa-location-dot"></i> ${escapeHTML(inc.street_name)}` : ''}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading area incidents:', error);
        list.innerHTML = '<p class="tanod-empty">Failed to load incidents.</p>';
    }
}

// Populated by loadMyReportLogs() and read by the click handler wired
// up in initIncidentDetailModal() - same pattern as currentAreaIncidents
// above, just for reports this tanod personally submitted.
let currentMyReports = [];

async function loadMyReportLogs(tanodId) {
    const list = document.getElementById('myReportLogsList');
    if (!list) return;
    try {
        const response = await tanodFetch(`/tanod/my-reports/${tanodId}`);
        const reports = await response.json();

        currentMyReports = Array.isArray(reports) ? reports : [];

        if (currentMyReports.length === 0) {
            list.innerHTML = '<p class="tanod-empty">You haven\'t submitted any incident reports yet.</p>';
            return;
        }

        list.innerHTML = currentMyReports.map(inc => `
            <div class="tanod-list-item tanod-list-item-clickable" data-incident-id="${inc.id}">
                <div class="tanod-list-item-main">
                    <strong>${escapeHTML(inc.incident_type)}</strong>
                    <span class="tanod-badge tanod-badge-${(inc.status || '').toLowerCase()}">${escapeHTML(inc.status)}</span>
                </div>
                <div class="tanod-list-item-sub">
                    <i class="fa-regular fa-calendar"></i> ${escapeHTML(inc.date)} ${escapeHTML(inc.time)}
                    ${inc.street_name ? ` &middot; <i class="fa-solid fa-location-dot"></i> ${escapeHTML(inc.street_name)}` : ''}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading my report logs:', error);
        list.innerHTML = '<p class="tanod-empty">Failed to load your report logs.</p>';
    }
}

// Wires one list container's delegated click-to-open-detail behavior.
// Delegated on the container (not per-item) since both lists are fully
// re-rendered on every load/poll - per-item listeners would just get
// thrown away and re-added on each refresh.
function wireIncidentListClicks(listId, getIncidents) {
    const list = document.getElementById(listId);
    if (!list) return;

    list.addEventListener('click', function (e) {
        const item = e.target.closest('.tanod-list-item-clickable');
        if (!item) return;
        const id = parseInt(item.getAttribute('data-incident-id'), 10);
        const incident = getIncidents().find(inc => inc.id === id);
        if (incident) openIncidentDetailModal(incident);
    });
}

function initIncidentDetailModal() {
    const modal = document.getElementById('tanodIncidentModal');
    if (!modal) return;

    wireIncidentListClicks('areaIncidentsList', () => currentAreaIncidents);
    wireIncidentListClicks('myReportLogsList', () => currentMyReports);

    document.getElementById('tanodIncidentModalClose')?.addEventListener('click', function () {
        modal.classList.remove('active');
    });
    modal.addEventListener('click', function (e) {
        if (e.target === modal) modal.classList.remove('active');
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') modal.classList.remove('active');
    });
}

function openIncidentDetailModal(incident) {
    const modal = document.getElementById('tanodIncidentModal');
    if (!modal) return;

    document.getElementById('incidentModalType').textContent = incident.incident_type || 'Incident';

    const statusClass = (incident.status || '').toLowerCase();
    document.getElementById('incidentModalBadges').innerHTML = `
        <span class="tanod-badge tanod-badge-${statusClass}">${escapeHTML(incident.status || 'N/A')}</span>
    `;

    const photoEl = document.getElementById('incidentModalPhoto');
    if (photoEl) {
        if (incident.photo_path) {
            photoEl.src = `/uploads/incident-photos/${incident.photo_path}`;
            photoEl.style.display = 'block';
        } else {
            photoEl.style.display = 'none';
        }
    }

    const rows = [
        ['Location', incident.street_name],
        ['Date & Time', incident.date && incident.time ? `${incident.date} ${incident.time}` : null],
        ['Danger Level', incident.danger_level],
        ['Description', incident.description],
        ['Recommended Action', incident.recommended_action]
    ].filter(([, value]) => value);

    document.getElementById('incidentModalDetails').innerHTML = (rows.map(([label, value]) => `
        <div class="tanod-modal-detail-row">
            <span class="tanod-label">${escapeHTML(label)}</span>
            <p class="tanod-value" style="font-size: 15px; font-weight: 500;">${escapeHTML(value)}</p>
        </div>
    `).join('')) || '<p class="tanod-empty">No additional details available.</p>';

    modal.classList.add('active');
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
                    <span class="tanod-badge tanod-badge-log-${(log.status || '').toLowerCase()}">${escapeHTML(log.status)}</span>
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

    const incident_type = document.getElementById('reportType').value;
    const date = document.getElementById('reportDate').value;
    const time = document.getElementById('reportTime').value;
    const location = document.getElementById('reportLocation').value;
    const photoFile = document.getElementById('reportPhoto')?.files[0];

    if (!incident_type || !date || !time || !location) {
        statusEl.textContent = 'Please fill in all required fields.';
        statusEl.className = 'tanod-form-status tanod-status-error';
        return;
    }

    if (photoFile && photoFile.size > 5 * 1024 * 1024) {
        statusEl.textContent = 'Photo must be 5MB or smaller.';
        statusEl.className = 'tanod-form-status tanod-status-error';
        return;
    }

    // FormData, not JSON - the photo (when attached) has to travel as
    // multipart/form-data, so every field rides along the same way for
    // one consistent submit path rather than branching on whether a
    // photo was picked.
    const formData = new FormData();
    formData.append('incident_type', incident_type);
    formData.append('date', date);
    formData.append('time', time);
    formData.append('location', location);
    formData.append('address', document.getElementById('reportAddress').value.trim());
    formData.append('description', document.getElementById('reportDescription').value.trim());
    if (capturedGpsCoords) {
        formData.append('latitude', capturedGpsCoords.latitude);
        formData.append('longitude', capturedGpsCoords.longitude);
    }
    if (photoFile) {
        formData.append('photo', photoFile);
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
    }

    try {
        // Raw fetch, not tanodFetch - FormData needs the browser to set its
        // own multipart Content-Type (with boundary), same reasoning as
        // the avatar upload above.
        const token = getTanodToken();
        const response = await fetch(`${TANOD_API_URL}/tanod/incident`, {
            method: 'POST',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            body: formData
        });

        if (response.status === 401) {
            clearTanodSession();
            window.location.href = 'tanod-login.html';
            return;
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to submit report.');
        }

        statusEl.textContent = '✅ Incident reported successfully.';
        statusEl.className = 'tanod-form-status tanod-status-success';
        e.target.reset();

        capturedGpsCoords = null;
        const gpsStatus = document.getElementById('gpsStatus');
        if (gpsStatus) {
            gpsStatus.textContent = '';
            gpsStatus.className = 'tanod-form-status';
        }

        const now = new Date();
        document.getElementById('reportDate').value = now.toISOString().slice(0, 10);
        document.getElementById('reportTime').value = now.toTimeString().slice(0, 5);

        loadAreaIncidents(tanod.id);
        loadMyReportLogs(tanod.id);
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

// PWA install support - scoped to "/tanod" (matches tanod-manifest.json's
// own scope) so this service worker only ever controls tanod-login.html/
// tanod-dashboard.html and their assets, never the admin/captain pages.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/tanod-sw.js', { scope: '/tanod' })
            .catch((error) => console.error('Tanod service worker registration failed:', error));
    });
}
