/* ============================================================
   INCIDENT.JS
   Barangay 179 Crime BI
   Incident Records Management - With Role-Based Access Control + Audit + Map Expand
============================================================ */

// ✅ API_URL ay naka-define na sa apiHelper.js

let incidents = [];
let currentPage = 1;
let totalPages = 0;
let totalRecords = 0;
const incidentsPerPage = 25;
let locationCoordsMap = new Map();

async function loadLocationCoordinates() {
    try {
        const response = await apiFetch('/location-coordinates');
        const rows = await response.json();
        locationCoordsMap = new Map(rows.map(r => [r.location, r]));
    } catch (error) {
        console.error('Error loading location coordinates:', error);
    }
}

/* ============================================================
   🔥 FIXED: Gumamit ng functions mula sa apiHelper.js
   (HINDI NA LOCAL STORAGE)
============================================================ */

// ✅ ITO NA LANG ANG KAILANGAN - WALA NANG CUSTOM FUNCTIONS

async function generateBlotterNumber() {
    const el = document.getElementById('incidentBlotter');
    if (!el) return;
    try {
        const res = await apiFetch('/incidents/next-blotter');
        const data = await res.json();
        el.value = data.blotter_number;
    } catch {
        const now = new Date();
        const y = now.getFullYear();
        const seq = String(Math.floor(Math.random() * 9000) + 1000);
        el.value = `BLT-${y}-${seq}`;
    }
}

/* ============================================================
   DOM READY
============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOM loaded - initializing incident page');
    
    // Apply role-based UI gamit ang apiHelper
    const user = getCurrentUser();
    
    if (!user && !window.location.pathname.includes('login.html')) {
        window.location.href = 'login.html';
        return;
    }
    
    applyRoleBasedUI(); // mula sa apiHelper.js

    ensureFileToken();

    loadLocationCoordinates();
    setDefaultReporter();
    setupStreetLocationSync();
    
    // ✅ Force load incidents with delay
    setTimeout(() => {
        console.log('⏳ Delayed loadIncidents() triggered');
        loadIncidents();
    }, 300);

    generateBlotterNumber();
    setupForm();
    setupSearchAndFilters();
    setupRippleEffect();
    setupTabs();

    // SSE push for same-device instant refresh; 10s poll covers cross-device
    // updates (Device B won't receive Device A's SSE broadcast directly).
    startLivePolling(loadIncidents, 10000);

    // Deep link from the View page's "Update" button (incident.html?edit=123) -
    // opens straight into the edit popup for that record. editIncident()
    // fetches the record itself if it isn't on the currently loaded table
    // page, so this doesn't need to wait for loadIncidents().
    const editId = new URLSearchParams(window.location.search).get('edit');
    if (editId && (isAdmin() || isDeskOfficer())) {
        editIncident(parseInt(editId, 10));
        history.replaceState({}, '', window.location.pathname);
    }
});

/* ============================================================
   TABS: Incident Records / New Incident
============================================================ */

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            // A stray edit-modal-mode class (shouldn't normally happen -
            // clearForm() always removes it - but cheap to guard here too)
            // would otherwise fight the normal tab layout via its
            // position:fixed !important rules.
            document.getElementById('tab-new-incident')?.classList.remove('edit-modal-mode');

            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            this.classList.add('active');
            const tabId = this.getAttribute('data-tab');
            document.getElementById(`tab-${tabId}`).classList.add('active');

        });
    });

    const closeBtn = document.getElementById('closeEditModalBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeEditModal);

    const modalHost = document.getElementById('tab-new-incident');
    if (modalHost) {
        modalHost.addEventListener('click', function (e) {
            if (e.target === this && this.classList.contains('edit-modal-mode')) {
                closeEditModal();
            }
        });
    }
}

/* ============================================================
   EDIT INCIDENT - POPUP MODE
   "Update" on a record pops the New Incident tab's own form up as a
   modal (see incident.css #tab-new-incident.edit-modal-mode) instead
   of switching to that tab - no DOM nodes move, this just toggles how
   the same element renders, so the map picker/form stay the exact
   same instances either way.
============================================================ */

function openEditModal() {
    const host = document.getElementById('tab-new-incident');
    if (!host) return;
    host.classList.add('edit-modal-mode');

    document.getElementById('statusGroup').style.display = '';
}

function closeEditModal() {
    clearForm();
}

function setupStreetLocationSync() {
    const streetSelect = document.getElementById('incidentStreet');
    if (!streetSelect) return;

    streetSelect.addEventListener('change', () => {
        const street = streetSelect.value;
        if (!street) {
            document.getElementById('incidentLat').value = '';
            document.getElementById('incidentLng').value = '';
            return;
        }

        const pin = locationCoordsMap.get(street);
        if (!pin || pin.latitude == null || pin.longitude == null) {
            document.getElementById('incidentLat').value = '';
            document.getElementById('incidentLng').value = '';
            return;
        }

        document.getElementById('incidentLat').value = parseFloat(pin.latitude);
        document.getElementById('incidentLng').value = parseFloat(pin.longitude);
    });
}

/* ============================================================
   DEFAULT REPORTER (always the logged-in staff member - no longer a
   user-facing choice, since nothing checked it matched req.userId
   anyway. Editing an existing incident keeps its original reporter_id
   instead of overwriting it - see editIncident()).
============================================================ */

function setDefaultReporter() {
    const field = document.getElementById('reportedBy');
    const user = getCurrentUser();
    if (field && user) field.value = user.id;
}

/* ============================================================
   LOAD INCIDENTS
============================================================ */

async function loadIncidents() {
    const tbody = document.getElementById('fullIncidentTableBody');
    const countSpan = document.getElementById('totalRecordsCount');
    
    console.log('🔍 loadIncidents() called');
    console.log('📋 tbody element:', tbody ? 'found' : 'NOT FOUND');
    
    if (!tbody) {
        console.error('❌ Table body (fullIncidentTableBody) not found!');
        return;
    }

    try {
        // include_resolved: closed cases stay listed here too, so they can
        // still be opened (and reopened by an admin) after resolution.
        const params = new URLSearchParams({ page: currentPage, limit: incidentsPerPage, include_resolved: '1' });

        const searchRaw = document.getElementById('searchInput')?.value.trim();
        // Strip category prefix (e.g. "VC-175" → "175") so the backend
        // can match by numeric ID when user types the formatted display ID.
        const prefixMatch = searchRaw && searchRaw.match(/^[A-Za-z]{2}-(\d+)$/);
        const searchVal = prefixMatch ? prefixMatch[1] : searchRaw;
        const typeVal = document.getElementById('filterType')?.value;
        const dangerVal = document.getElementById('filterDanger')?.value;
        const dateVal = document.getElementById('filterDate')?.value;

        if (searchVal) params.set('search', searchVal);
        if (typeVal) params.set('type', typeVal);
        if (dangerVal) params.set('danger', dangerVal);
        if (dateVal) params.set('date', dateVal);

        console.log('🔄 Fetching incidents from /incidents?' + params.toString());
        const response = await apiFetch(`/incidents?${params.toString()}`);

        console.log('📡 Response status:', response.status);
        console.log('📡 Response ok:', response.ok);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        incidents = data.incidents || [];
        totalPages = data.totalPages || 0;
        totalRecords = data.total || 0;
        currentPage = data.currentPage || 1;
        console.log('✅ Loaded incidents:', incidents.length, 'of', totalRecords);

        if (countSpan) {
            countSpan.textContent = `${totalRecords} total record${totalRecords !== 1 ? 's' : ''}`;
        }

        // ✅ Render table
        renderTable(incidents);
        renderIncidentPagination();
        updateRecordRangeText();

    } catch (error) {
        console.error('❌ Error loading incidents:', error);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; padding: 24px; color: #ef4444;">
                        <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.5rem; display: block; margin-bottom: 8px;"></i>
                        Failed to load incidents.
                        <p style="font-size: 0.75rem; color: #94a3b8; margin-top: 4px;">${error.message}</p>
                    </td>
                </tr>
            `;
        }
        showErrorModal('Error', 'Failed to load incidents. Please check your connection.');
    }
}

/* ============================================================
   PAGINATION (mirrors incident-view.js's renderPagination(), same
   markup/behavior — admin's Incident Records list now paginates
   server-side too instead of loading every row into memory)
============================================================ */

function renderIncidentPagination() {
    const paginationControls = document.getElementById('paginationControls');
    if (!paginationControls) return;

    if (totalPages <= 1) {
        paginationControls.innerHTML = '';
        return;
    }

    let html = `
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${currentPage - 1}">Previous</a>
        </li>
    `;

    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);

    if (startPage > 1) {
        html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
        if (startPage > 2) {
            html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        html += `
            <li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#" data-page="${i}">${i}</a>
            </li>
        `;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
        html += `<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`;
    }

    html += `
        <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${currentPage + 1}">Next</a>
        </li>
    `;

    paginationControls.innerHTML = html;

    paginationControls.querySelectorAll('.page-link').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const page = parseInt(this.dataset.page);
            if (page && page !== currentPage && page >= 1 && page <= totalPages) {
                currentPage = page;
                loadIncidents();
            }
        });
    });
}

function updateRecordRangeText() {
    const rangeEl = document.getElementById('recordRangeText');
    if (!rangeEl) return;
    if (totalRecords === 0) {
        rangeEl.textContent = 'No records';
        return;
    }
    const start = (currentPage - 1) * incidentsPerPage + 1;
    const end = Math.min(currentPage * incidentsPerPage, totalRecords);
    rangeEl.textContent = `Showing ${start}-${end} of ${totalRecords} records`;
}

/* ============================================================
   RENDER TABLE (FIXED - USING DOM MANIPULATION)
============================================================ */

const getStatusClass = (status) => {
    if (status === 'Open') return 'badge-open';
    if (status === 'Monitoring') return 'badge-monitoring';
    return 'badge-resolved';
};

const getDangerClass = (danger) => {
    if (!danger || danger === 'null') return 'badge-danger-low';
    if (danger?.includes('Level 3') || danger?.includes('High')) return 'badge-danger-high';
    if (danger?.includes('Level 2') || danger?.includes('Moderate')) return 'badge-danger-mod';
    return 'badge-danger-low';
};

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        let dateObj;
        
        if (typeof dateStr === 'string') {
            dateObj = new Date(dateStr);
            if (isNaN(dateObj.getTime())) {
                const parts = dateStr.split('T')[0].split('-');
                if (parts.length === 3) {
                    dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
                }
            }
        } else {
            dateObj = new Date(dateStr);
        }
        
        if (isNaN(dateObj.getTime())) {
            console.warn('Invalid date:', dateStr);
            return 'Invalid Date';
        }
        
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        console.error('Date formatting error:', dateStr, e);
        return 'Invalid Date';
    }
}

function formatTime(timeStr) {
    if (!timeStr) return 'N/A';
    try {
        if (typeof timeStr === 'string') {
            const parts = timeStr.split(':');
            if (parts.length >= 2) {
                return `${String(parts[0]).padStart(2, '0')}:${String(parts[1]).padStart(2, '0')}`;
            }
        }
        return timeStr;
    } catch (e) {
        return timeStr;
    }
}

function renderTable(dataToRender) {
    const tbody = document.getElementById('fullIncidentTableBody');
    const countSpan = document.getElementById('totalRecordsCount');
    
    console.log('📊 renderTable() called with:', dataToRender.length, 'records');
    console.log('📋 tbody element:', tbody);
    
    if (!tbody) {
        console.error('❌ Table body not found in renderTable!');
        return;
    }

    if (countSpan) {
        countSpan.textContent = `${dataToRender.length} total record${dataToRender.length !== 1 ? 's' : ''}`;
    }

    const isAdminUser = isAdmin();
    const isDeskOfficerUser = isDeskOfficer();

    // Build all rows in a fragment first, then swap atomically — no blank flash.
    const fragment = document.createDocumentFragment();

    if (dataToRender.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td colspan="10" style="text-align: center; padding: 30px; color: #94a3b8;">
                <i class="fa-regular fa-circle" style="font-size: 1.5rem; display: block; margin-bottom: 8px;"></i>
                No incident records found.
            </td>
        `;
        fragment.appendChild(emptyRow);
    } else {
        for (let i = 0; i < dataToRender.length; i++) {
            const item = dataToRender[i];
            if (!item.id) continue;

            const formattedDate = formatDate(item.date);
            const formattedTime = formatTime(item.time);
            const locationDisplay = item.street_name || `${item.latitude || 'N/A'}, ${item.longitude || 'N/A'}`;

            const actionButtons = (isAdminUser || isDeskOfficerUser) ? `
                <button class="btn-action-edit admin-action" onclick="editIncident(${item.id})"><i class="fa-solid fa-pen"></i> Update</button>
            ` : `<span style="color: #94a3b8; font-size: 0.7rem;">View Only</span>`;

            const reportedByDisplay = item.reported_by_name || item.reporter_name || 'N/A';

            const severityClass = item.severity === 'High' ? 'badge-danger-high' : item.severity === 'Medium' ? 'badge-danger-mod' : 'badge-danger-low';

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="font-bold">${formatIncidentId(item.id, item.incident_type)}</td>
                <td>${escapeHTML(item.incident_type || 'N/A')}</td>
                <td class="text-secondary">${formattedDate} ${formattedTime}</td>
                <td>${escapeHTML(locationDisplay)}</td>
                <td class="text-secondary">${escapeHTML(reportedByDisplay)}</td>
                <td><span class="badge ${severityClass}">${escapeHTML(item.severity || 'N/A')}</span></td>
                <td><span class="badge ${getStatusClass(item.status)}">${escapeHTML(item.status || 'N/A')}</span></td>
                <td><span class="badge ${getDangerClass(item.danger_level)}">${escapeHTML(item.danger_level || 'N/A')}</span></td>
                <td class="cart-only">${item.cart_score != null ? parseFloat(item.cart_score).toFixed(0) : 'N/A'}</td>
                <td>${actionButtons}</td>
            `;
            fragment.appendChild(row);
        }
    }

    // Single atomic swap — the table is never visibly empty between renders.
    tbody.replaceChildren(fragment);
    console.log('✅ Table rendered with', dataToRender.length, 'rows');
}

/* ============================================================
   SETUP FORM - ✅ FIXED: Lowercase latitude/longitude
============================================================ */

function setupForm() {
    const form = document.getElementById('incidentForm');
    if (!form) return;

    const typeSelect = document.getElementById('incidentType');
    const typeOtherInput = document.getElementById('incidentTypeOther');
    if (typeSelect) {
        typeSelect.addEventListener('change', () => {
            if (typeOtherInput) {
                typeOtherInput.style.display = typeSelect.value === '__other__' ? '' : 'none';
                if (typeSelect.value !== '__other__') typeOtherInput.value = '';
            }
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Desk Officer can both add and edit incidents (including
        // evidence) - only deleting a record stays Administrator-only.
        if (!isAdmin() && !isDeskOfficer()) {
            showErrorModal('Access Denied', 'Only administrators and desk officers can add incidents.');
            return;
        }

        const typeSelect = document.getElementById('incidentType');
        const typeOtherInput = document.getElementById('incidentTypeOther');
        const type = typeSelect.value === '__other__' ? (typeOtherInput?.value.trim() || '') : typeSelect.value;
        const date = document.getElementById('incidentDate').value;
        const time = document.getElementById('incidentTime').value;
        const lat = document.getElementById('incidentLat').value;
        const lng = document.getElementById('incidentLng').value;
        const street = document.getElementById('incidentStreet').value;
        const address = document.getElementById('incidentAddress').value.trim();
        const reporterIdRaw = document.getElementById('reportedBy').value;
        const isEdit = !!document.getElementById('editIndex').value;
        const status = isEdit ? document.getElementById('incidentStatus').value : 'Open';
        const desc = document.getElementById('incidentDesc').value;
        const blotter = document.getElementById('incidentBlotter').value.trim();
        const reportedByName = document.getElementById('incidentReportedByName').value.trim();
        const severity = document.getElementById('incidentSeverity').value;
        const priority = severity === 'High' ? 'Urgent' : 'Normal';
        const respondentName = document.getElementById('respondentName').value.trim();
        const respondentAddress = document.getElementById('respondentAddress').value.trim();

        const requiredFields = [
            { id: 'incidentType', label: 'Incident Type' },
            { id: 'incidentDate', label: 'Date' },
            { id: 'incidentTime', label: 'Time' },
            { id: 'incidentStreet', label: 'Street Name' },
            { id: 'incidentSeverity', label: 'Severity Level' },
            { id: 'incidentAddress', label: 'Address' },
            { id: 'incidentReportedByName', label: 'Name of Complainant' },
            { id: 'incidentDesc', label: 'Salaysay / Description' }
        ];

        document.querySelectorAll('.field-missing').forEach(el => el.classList.remove('field-missing'));

        const missingFields = requiredFields.filter(f => !document.getElementById(f.id)?.value);
        if (typeSelect.value === '__other__' && !type) {
            missingFields.unshift({ id: 'incidentTypeOther', label: 'Custom Incident Type' });
        }
        if (missingFields.length > 0) {
            missingFields.forEach(f => document.getElementById(f.id)?.classList.add('field-missing'));
            document.getElementById(missingFields[0].id)?.focus();
            showErrorModal(
                'Missing Required Fields',
                `Please fill in the following before saving:\n\n${missingFields.map(f => `• ${f.label}`).join('\n')}`
            );
            return;
        }

        if (!lat || !lng) {
            showErrorModal('Missing Coordinates', 'This street has no pinned coordinates yet. Pin it on the Barangay Risk Map first, or choose a different street.');
            return;
        }

        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lng);

        const MIN_LAT = 14.73;
        const MAX_LAT = 14.77;
        const MIN_LNG = 121.06;
        const MAX_LNG = 121.09;

        if (isNaN(latNum) || isNaN(lngNum)) {
            showErrorModal('Invalid Coordinates', 'Please select a street to set the incident location.');
            return;
        }

        if (latNum < MIN_LAT || latNum > MAX_LAT || lngNum < MIN_LNG || lngNum > MAX_LNG) {
            showErrorModal('Invalid Coordinates', `Latitude must be between ${MIN_LAT} and ${MAX_LAT}\nLongitude must be between ${MIN_LNG} and ${MAX_LNG}\n\nThis street's pinned coordinates look wrong - check the Barangay Risk Map.`);
            return;
        }


        if (isEdit && window._incidentEditSnapshot) {
            const snap = window._incidentEditSnapshot;
            const nothingChanged =
                snap.type === type &&
                snap.date === date &&
                snap.time === time &&
                snap.street === street &&
                snap.address === address &&
                snap.status === status &&
                snap.desc === desc &&
                snap.blotter === blotter &&
                snap.reportedByName === reportedByName &&
                snap.severity === severity &&
                snap.respondentName === respondentName &&
                snap.respondentAddress === respondentAddress &&
                snap.age === age;
            if (nothingChanged) {
                showErrorModal('No Changes Detected', 'You haven\'t made any changes. Please update the details first before saving.');
                return;
            }
        }

        const parsedRepId = parseInt(reporterIdRaw, 10);
        const repId = Number.isInteger(parsedRepId) && parsedRepId > 0 ? parsedRepId : null;
        if (!isEdit && repId === null) {
            showErrorModal('Session Error', 'Could not determine the logged-in user. Please log out and log back in, then try again.');
            return;
        }

        try {
            const incidentId = document.getElementById('editIndex').value;
            const method = incidentId ? 'PUT' : 'POST';
            const url = incidentId ? `/incidents/${incidentId}` : '/incidents';

            const payload = {
                incident_type: type,
                date,
                time,
                latitude: latNum,
                longitude: lngNum,
                street_name: street,
                address: address,
                reporter_id: repId,
                status,
                description: desc,
                recommended_action: '',
                blotter_number: blotter,
                reported_by_name: reportedByName,
                persons_involved: '',
                statement: '',
                priority: priority,
                severity: severity,
                respondent_name: respondentName,
                respondent_address: respondentAddress
            };

            console.log('📤 Sending payload:', payload);

            const response = await apiFetch(url, {
                method: method,
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorMsg = 'Failed to save incident';
                try {
                    const errorData = await response.json();
                    if (errorData.error) errorMsg = errorData.error;
                    if (errorData.details && errorData.details.length) errorMsg += ': ' + errorData.details.join(', ');
                } catch (e) {}
                throw new Error(errorMsg);
            }

            const savedIncidentId = incidentId || (await response.json()).id;

            // The incident is already saved at this point - an evidence
            // failure must not fall into the catch below, which reports
            // "failed to save" and keeps the form filled (a retry would
            // then create a duplicate incident).
            let evidenceError = null;
            const evidenceInput = document.getElementById('incidentEvidenceInput');
            if ((isAdmin() || isDeskOfficer()) && evidenceInput && evidenceInput.files.length > 0) {
                try {
                    await uploadEvidenceFiles(savedIncidentId, evidenceInput.files);
                } catch (uploadError) {
                    console.error('Evidence upload failed:', uploadError);
                    evidenceError = uploadError.message;
                }
            }

            clearForm();

            incidents = [];
            setTimeout(async () => {
                await loadIncidents();
            }, 200);
            
            if (evidenceError) {
                showErrorModal('Incident Saved - Evidence Not Uploaded', `The incident was saved, but the evidence upload failed: ${evidenceError}

Open the incident with Edit to attach the evidence again.`);
            } else {
                showSuccessModal('Success!', 'Incident saved successfully!');
            }

        } catch (error) {
            console.error('Error saving incident:', error);
            showErrorModal('Error', 'Failed to save incident: ' + error.message);
        }
    });

    const evidenceInput = document.getElementById('incidentEvidenceInput');
    evidenceInput?.addEventListener('change', () => {
        updateEvidenceFileCount();
        renderEvidencePreview(Array.from(evidenceInput.files), currentExistingEvidence, document.getElementById('editIndex').value);
    });

    // Clear the red "missing" highlight on a field as soon as the user
    // fills it in, instead of waiting for the next submit attempt.
    ['incidentType', 'incidentDate', 'incidentTime', 'incidentStreet', 'incidentStatus', 'incidentSeverity'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', function () {
            if (this.value) this.classList.remove('field-missing');
        });
        document.getElementById(id)?.addEventListener('change', function () {
            if (this.value) this.classList.remove('field-missing');
        });
    });
}

/* ============================================================
   EVIDENCE (images/videos attached to an incident)
============================================================ */

// Raw fetch, not apiFetch - FormData needs the browser to set its own
// multipart Content-Type (with boundary), same reasoning as the tanod
// portal's photo/avatar uploads.
async function uploadEvidenceFiles(incidentId, fileList) {
    const formData = new FormData();
    Array.from(fileList).forEach(file => formData.append('evidence', file));

    const token = getSessionToken();
    const response = await fetch(`${API_URL}/incidents/${incidentId}/evidence`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData
    });

    if (!response.ok) {
        let errorMsg = 'Failed to upload evidence';
        try {
            const errorData = await response.json();
            if (errorData.error) errorMsg = errorData.error;
        } catch (e) {}
        throw new Error(errorMsg);
    }

    return (await response.json()).evidence;
}

async function deleteEvidenceFile(incidentId, evidenceId) {
    const response = await apiFetch(`/incidents/${incidentId}/evidence/${evidenceId}`, { method: 'DELETE' });
    if (!response.ok) {
        showErrorModal('Error', 'Failed to remove evidence file.');
        return;
    }
    currentExistingEvidence = currentExistingEvidence.filter(ev => ev.id !== evidenceId);
    document.querySelector(`.evidence-item[data-evidence-id="${evidenceId}"]`)?.remove();
}

// Tracks the evidence already saved for whichever incident is currently
// loaded in the form, so picking new files (which re-renders the whole
// preview list) doesn't wipe out those already-uploaded thumbnails.
let currentExistingEvidence = [];

// Renders both already-uploaded evidence (existingEvidence, with a
// working delete button) and newly-picked files still waiting to be
// uploaded on save (pendingFiles, name/type preview only).
function renderEvidencePreview(pendingFiles, existingEvidence, incidentId) {
    currentExistingEvidence = existingEvidence;

    const container = document.getElementById('evidencePreviewList');
    if (!container) return;

    const existingHtml = existingEvidence.map(ev => `
        <div class="evidence-item" data-evidence-id="${ev.id}">
            ${ev.file_type === 'video'
                ? `<video src="${buildUploadUrl(`incident-evidence/${escapeHTML(ev.file_path)}`)}" controls></video>`
                : `<img src="${buildUploadUrl(`incident-evidence/${escapeHTML(ev.file_path)}`)}" alt="Evidence">`}
            <button type="button" class="evidence-remove-btn" onclick="deleteEvidenceFile(${incidentId}, ${ev.id})" title="Remove">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `).join('');

    // Free the previous render's local previews before making new ones.
    pendingPreviewUrls.forEach(url => URL.revokeObjectURL(url));
    pendingPreviewUrls = [];

    const pendingHtml = pendingFiles.map((f, index) => {
        const isImage = f.type && f.type.startsWith('image/');
        let preview;
        if (isImage) {
            const url = URL.createObjectURL(f);
            pendingPreviewUrls.push(url);
            preview = `<img src="${url}" alt="${escapeHTML(f.name)}">`;
        } else {
            preview = `<i class="fa-solid fa-file-video"></i><span class="evidence-pending-name">${escapeHTML(f.name)}</span>`;
        }
        return `
            <div class="evidence-item evidence-item-pending${isImage ? ' has-thumb' : ''}" title="${escapeHTML(f.name)} - will be uploaded when you save">
                ${preview}
                <span class="evidence-new-tag">New</span>
                <button type="button" class="evidence-remove-btn" onclick="removePendingEvidence(${index})" title="Remove">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
    }).join('');

    container.innerHTML = existingHtml + pendingHtml;
}

// Object URLs for the current pending-file thumbnails (revoked on re-render).
let pendingPreviewUrls = [];

function updateEvidenceFileCount() {
    const input = document.getElementById('incidentEvidenceInput');
    const fileCount = document.getElementById('evidenceFileCount');
    if (!input || !fileCount) return;
    fileCount.textContent = input.files.length === 0
        ? 'No file chosen'
        : input.files.length === 1
            ? input.files[0].name
            : `${input.files.length} files selected`;
}

// Drops one not-yet-uploaded file. A FileList is read-only, so the input's
// files are rebuilt through a DataTransfer without that entry.
function removePendingEvidence(index) {
    const input = document.getElementById('incidentEvidenceInput');
    if (!input) return;
    const dt = new DataTransfer();
    Array.from(input.files).forEach((file, i) => { if (i !== index) dt.items.add(file); });
    input.files = dt.files;
    updateEvidenceFileCount();
    renderEvidencePreview(Array.from(input.files), currentExistingEvidence, document.getElementById('editIndex').value);
}

// Clears any picked-but-unsaved files (e.g. left over from the New
// Incident form) so they can't get uploaded to a different incident.
function resetPendingEvidence() {
    const input = document.getElementById('incidentEvidenceInput');
    if (input) input.value = '';
    updateEvidenceFileCount();
}

window.removePendingEvidence = removePendingEvidence;

window.deleteEvidenceFile = deleteEvidenceFile;

/* ============================================================
   CLEAR FORM
============================================================ */

function clearForm() {
    // Closes the edit popup too, if it was open - a no-op otherwise
    // since removing an absent class does nothing.
    document.getElementById('tab-new-incident')?.classList.remove('edit-modal-mode');

    const form = document.getElementById('incidentForm');
    if (form) form.reset();
    document.getElementById('editIndex').value = '';
    window._incidentEditSnapshot = null;
    document.getElementById('formTitle').textContent = "Add New Incident";
    document.getElementById('saveBtn').innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Incident`;
    const archiveBtn = document.getElementById('archiveIncidentBtn');
    if (archiveBtn) archiveBtn.style.display = 'none';
    setDefaultReporter();
    document.getElementById('incidentStreet').value = '';
    document.getElementById('incidentLat').value = '';
    document.getElementById('incidentLng').value = '';

    const evidencePreview = document.getElementById('evidencePreviewList');
    if (evidencePreview) evidencePreview.innerHTML = '';
    currentExistingEvidence = [];

    const fileCount = document.getElementById('evidenceFileCount');
    if (fileCount) fileCount.textContent = 'No file chosen';

    const typeOther = document.getElementById('incidentTypeOther');
    if (typeOther) { typeOther.value = ''; typeOther.style.display = 'none'; }

    document.getElementById('statusGroup').style.display = 'none';
    document.getElementById('incidentStatus').value = 'Open';

    const respondentNameEl = document.getElementById('respondentName');
    if (respondentNameEl) respondentNameEl.value = '';
    const respondentAddressEl = document.getElementById('respondentAddress');
    if (respondentAddressEl) respondentAddressEl.value = '';
    const severityEl = document.getElementById('incidentSeverity');
    if (severityEl) severityEl.value = '';

    generateBlotterNumber();
}

document.getElementById('clearBtn').addEventListener('click', clearForm);

/* ============================================================
   DELETE INCIDENT
============================================================ */

window.requestDeleteIncident = function(id) {
    if (!isAdmin()) { // mula sa apiHelper.js
        showErrorModal('Access Denied', 'Only administrators can delete incidents.');
        return;
    }

    const record = incidents.find(item => item.id === id);
    if (!record) {
        showErrorModal('Error', 'Record not found!');
        return;
    }
    
    if (typeof showDeleteModal === 'function') {
        showDeleteModal(`Are you sure you want to archive incident #${id}? It will be moved to the Archive (Settings > Archive), where an Administrator can restore it.`, id);
    } else {
        if (confirm(`Are you sure you want to delete incident record #${id}? It will be moved to the Archive (Settings > Archive), where an Administrator can restore it.`)) {
            confirmDeleteIncident(id);
        }
    }
};

window.confirmDeleteIncident = async function(id) {
    try {
        const response = await apiFetch(`/incidents/${id}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error('Failed to delete');
        
        // ✅ Force refresh after delete
        incidents = [];
        setTimeout(async () => {
            await loadIncidents();
        }, 200);

        clearForm();
        showSuccessModal('Archived!', `Incident #${id} has been moved to the Archive.`);
    } catch (error) {
        console.error('Error deleting incident:', error);
        showErrorModal('Error', 'Failed to delete incident.');
    }
};

/* ============================================================
   EDIT INCIDENT
============================================================ */

window.editIncident = async (id) => {
    if (!isAdmin() && !isDeskOfficer()) { // mula sa apiHelper.js
        showErrorModal('Access Denied', 'Only administrators and desk officers can edit incidents.');
        return;
    }

    try {
        let record = incidents.find(item => item.id === id);
        if (!record) {
            // Not on the currently loaded table page (e.g. opened via a
            // ?edit= deep link from the View page) - fetch it directly
            // instead of failing just because it isn't in memory yet.
            const response = await apiFetch(`/incidents/${id}`);
            if (response.ok) record = await response.json();
        }
        if (!record) {
            showErrorModal('Error', 'Record not found!');
            return;
        }

        // Pop the form up as a modal over whichever tab is currently
        // showing, instead of switching to the New Incident tab - the
        // Incident Records tab stays active underneath.
        openEditModal();

        document.getElementById('editIndex').value = record.id;
        const typeEl = document.getElementById('incidentType');
        const typeOtherEl = document.getElementById('incidentTypeOther');
        typeEl.value = record.incident_type || '';
        if (typeEl.value !== (record.incident_type || '')) {
            typeEl.value = '__other__';
            if (typeOtherEl) { typeOtherEl.value = record.incident_type || ''; typeOtherEl.style.display = ''; }
        } else {
            if (typeOtherEl) { typeOtherEl.value = ''; typeOtherEl.style.display = 'none'; }
        }
        document.getElementById('incidentDate').value = record.date ? record.date.split('T')[0] : '';
        document.getElementById('incidentTime').value = record.time ? record.time.substring(0, 5) : '';
        document.getElementById('incidentLat').value = record.latitude || '';
        document.getElementById('incidentLng').value = record.longitude || '';
        document.getElementById('incidentStreet').value = record.street_name || '';
        document.getElementById('incidentAddress').value = record.address || '';

        document.getElementById('reportedBy').value = record.reporter_id || '';
        document.getElementById('incidentStatus').value = record.status || 'Open';
        document.getElementById('incidentDesc').value = record.description || '';
        document.getElementById('incidentBlotter').value = record.blotter_number || '';
        document.getElementById('incidentReportedByName').value = record.reported_by_name || '';
        document.getElementById('incidentSeverity').value = record.severity || 'Low';
        document.getElementById('respondentName').value = record.respondent_name || '';
        document.getElementById('respondentAddress').value = record.respondent_address || '';

        document.getElementById('formTitle').textContent = `Edit Incident (${formatIncidentId(record.id, record.incident_type)})`;
        document.getElementById('saveBtn').innerHTML = `<i class="fa-solid fa-pen"></i> Update Incident`;

        window._incidentEditSnapshot = {
            type: record.incident_type || '',
            date: record.date ? record.date.split('T')[0] : '',
            time: record.time ? record.time.substring(0, 5) : '',
            street: record.street_name || '',
            address: record.address || '',
            status: record.status || 'Open',
            desc: record.description || '',
            blotter: record.blotter_number || '',
            reportedByName: record.reported_by_name || '',
            severity: record.severity || 'Low',
            respondentName: record.respondent_name || '',
            respondentAddress: record.respondent_address || '',
            age: record.age != null ? record.age : null
        };

        const archiveBtn = document.getElementById('archiveIncidentBtn');
        if (archiveBtn && isAdmin()) {
            archiveBtn.style.display = 'inline-flex';
            archiveBtn.onclick = () => requestDeleteIncident(record.id);
        }

        // Evidence isn't in the list payload (only the single-incident
        // detail route joins it) - fetch it separately for the preview.
        resetPendingEvidence();
        renderEvidencePreview([], [], id);
        try {
            await ensureFileToken();
            const detailResponse = await apiFetch(`/incidents/${id}`);
            if (detailResponse.ok) {
                const detail = await detailResponse.json();
                renderEvidencePreview([], detail.evidence || [], id);
            }
        } catch (evidenceError) {
            console.error('Error loading evidence for edit:', evidenceError);
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        console.error('Error loading incident for edit:', error);
        showErrorModal('Error', 'Failed to load incident details.');
    }
};

/* ============================================================
   SEARCH AND FILTERS
============================================================ */

function setupSearchAndFilters() {
    const searchInput = document.getElementById('searchInput');
    const filterType = document.getElementById('filterType');
    const filterDanger = document.getElementById('filterDanger');
    const filterDate = document.getElementById('filterDate');

    // Search/filter now happens server-side (see loadIncidents()) so it
    // searches the whole dataset, not just whichever page is currently
    // loaded in memory — any change resets back to page 1 and re-fetches.
    const filterFunction = () => {
        currentPage = 1;
        loadIncidents();
    };

    if (searchInput) searchInput.addEventListener('input', filterFunction);
    if (filterType) filterType.addEventListener('change', filterFunction);
    if (filterDanger) filterDanger.addEventListener('change', filterFunction);
    if (filterDate) filterDate.addEventListener('change', filterFunction);
}

/* ============================================================
   SIDEBAR RIPPLE EFFECT
============================================================ */

function setupRippleEffect() {
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            if (href && href !== '#') return;
            e.preventDefault();
            const circle = document.createElement('span');
            const diameter = Math.max(this.clientWidth, this.clientHeight);
            const radius = diameter / 2;
            const rect = this.getBoundingClientRect();
            circle.style.width = circle.style.height = `${diameter}px`;
            circle.style.left = `${e.clientX - rect.left - radius}px`;
            circle.style.top = `${e.clientY - rect.top - radius}px`;
            circle.classList.add('ripple');
            const existingRipple = this.querySelector('.ripple');
            if (existingRipple) existingRipple.remove();
            this.appendChild(circle);
        });
    });
}

/* ============================================================
   MODAL FUNCTIONS
============================================================ */

function showSuccessModal(title, message) {
    const modal = document.getElementById('successModal');
    const titleEl = document.getElementById('successTitle');
    const msgEl = document.getElementById('successMessage');
    
    titleEl.textContent = title || 'Success!';
    msgEl.textContent = message || 'Operation completed successfully!';
    modal.style.display = 'flex';
}

function showErrorModal(title, message) {
    const modal = document.getElementById('errorModal');
    const titleEl = document.getElementById('errorTitle');
    const msgEl = document.getElementById('errorMessage');

    titleEl.textContent = title || 'Error!';
    msgEl.textContent = message || 'Something went wrong.';
    msgEl.style.textAlign = (message || '').includes('\n') ? 'left' : 'center';
    modal.style.display = 'flex';
}

function showDeleteModal(message, id) {
    const modal = document.getElementById('deleteModal');
    const msgEl = document.getElementById('deleteMessage');
    
    msgEl.textContent = message || 'Are you sure you want to delete this incident record?';
    pendingDeleteId = id;
    modal.style.display = 'flex';
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.getElementById('successModal').style.display = 'none';
        document.getElementById('errorModal').style.display = 'none';
        document.getElementById('deleteModal').style.display = 'none';
    }
});

console.log('✅ incident.js loaded successfully');