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
let mapPicker;
let marker;
let modalMap = null;
let modalMarker = null;
let isMapModalOpen = false;

/* ============================================================
   🔥 FIXED: Gumamit ng functions mula sa apiHelper.js
   (HINDI NA LOCAL STORAGE)
============================================================ */

// ✅ ITO NA LANG ANG KAILANGAN - WALA NANG CUSTOM FUNCTIONS

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

    initMapPicker();
    loadReporters();
    
    // ✅ Force load incidents with delay
    setTimeout(() => {
        console.log('⏳ Delayed loadIncidents() triggered');
        loadIncidents();
    }, 300);
    
    setupForm();
    setupSearchAndFilters();
    setupRippleEffect();
    setupModalMapClose();
});

/* ============================================================
   MAP PICKER SETUP
============================================================ */

// BARANGAY_CENTER / BARANGAY_BOUNDARY_COORDS / createBarangayMap come
// from mapHelper.js, shared with grid-heatmap.js.

// Real point-in-polygon check against the actual (concave) barangay
// boundary shape via turf.js - a bounding-box check previously accepted
// clicks that fell inside the boundary's rectangular extent but outside
// the true outline (i.e. inside the blurred/masked-out area).
const barangayBoundaryPolygon = turf.polygon([
    [...BARANGAY_BOUNDARY_COORDS.map(coord => [coord[1], coord[0]]), [BARANGAY_BOUNDARY_COORDS[0][1], BARANGAY_BOUNDARY_COORDS[0][0]]]
]);

function isPointInsideBarangay(lat, lng) {
    return turf.booleanPointInPolygon(turf.point([lng, lat]), barangayBoundaryPolygon);
}

function initMapPicker() {
    const container = document.getElementById('mapPicker');
    if (container) {
        container.innerHTML = '';
    }

    const created = createBarangayMap('mapPicker', {
        zoom: 16,
        zoomControl: false,
        minZoom: 13.5,
        maxZoom: 19
    });
    mapPicker = created.map;

    mapPicker.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        if (!isPointInsideBarangay(lat, lng)) {
            document.getElementById('locationPrompt').textContent = "⚠️ Please click inside the barangay boundary!";
            return;
        }

        document.getElementById('incidentLat').value = lat;
        document.getElementById('incidentLng').value = lng;

        if (marker) {
            mapPicker.removeLayer(marker);
        }
        
        const customIcon = L.divIcon({
            className: 'custom-marker',
            html: '<div style="background: #dc2626; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });

        marker = L.marker([lat, lng], { icon: customIcon }).addTo(mapPicker);
        document.getElementById('locationPrompt').textContent = "📍 Location Selected!";
        
        if (isMapModalOpen && modalMap) {
            updateModalMarker(lat, lng);
        }
    });

    setupMapExpand();
}

/* ============================================================
   🗺️ MAP EXPAND / MODAL FUNCTIONALITY
============================================================ */

function createModalMap() {
    const container = document.getElementById('mapModalContainer');
    if (!container) return;
    
    container.innerHTML = '';

    const created = createBarangayMap(container, {
        center: mapPicker.getCenter(),
        zoom: mapPicker.getZoom(),
        zoomControl: true,
        minZoom: 13.5,
        maxZoom: 19
    });
    modalMap = created.map;

    modalMap.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        if (!isPointInsideBarangay(lat, lng)) {
            alert('⚠️ Please click inside the barangay boundary!');
            return;
        }

        document.getElementById('incidentLat').value = lat;
        document.getElementById('incidentLng').value = lng;
        document.getElementById('locationPrompt').textContent = "📍 Location Selected!";

        if (marker) {
            mapPicker.removeLayer(marker);
        }
        
        const customIcon = L.divIcon({
            className: 'custom-marker',
            html: '<div style="background: #dc2626; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });

        marker = L.marker([lat, lng], { icon: customIcon }).addTo(mapPicker);
        mapPicker.setView([lat, lng], 16);
        
        updateModalMarker(lat, lng);
    });

    const lat = document.getElementById('incidentLat').value;
    const lng = document.getElementById('incidentLng').value;
    if (lat && lng) {
        updateModalMarker(parseFloat(lat), parseFloat(lng));
    }
}

function updateModalMarker(lat, lng) {
    if (!modalMap) return;
    
    if (modalMarker) {
        modalMap.removeLayer(modalMarker);
    }
    
    const customIcon = L.divIcon({
        className: 'custom-marker',
        html: '<div style="background: #dc2626; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
    
    modalMarker = L.marker([lat, lng], { icon: customIcon }).addTo(modalMap);
    modalMap.setView([lat, lng], 16);
}

function openMapModal() {
    const modal = document.getElementById('mapModal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    isMapModalOpen = true;
    document.body.style.overflow = 'hidden';
    
    setTimeout(() => {
        createModalMap();
    }, 100);
}

function closeMapModal() {
    const modal = document.getElementById('mapModal');
    if (!modal) return;
    
    modal.style.display = 'none';
    isMapModalOpen = false;
    document.body.style.overflow = '';
    
    if (modalMap) {
        modalMap.remove();
        modalMap = null;
        modalMarker = null;
    }
}

function setupMapExpand() {
    const mapContainer = document.getElementById('mapPicker');
    if (!mapContainer) return;
    
    mapContainer.addEventListener('click', function(e) {
        if (e.target.closest('.leaflet-marker-pane') || 
            e.target.closest('.leaflet-popup') ||
            e.target.closest('.leaflet-control') ||
            e.target.closest('.leaflet-control-zoom')) {
            return;
        }
        openMapModal();
    });
    
    mapContainer.style.cursor = 'pointer';
    mapContainer.style.position = 'relative';
    
    const oldHint = mapContainer.querySelector('.map-expand-hint');
    if (oldHint) oldHint.remove();
    
    const hint = document.createElement('div');
    hint.className = 'map-expand-hint';
    hint.style.cssText = `
        position: absolute;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.8);
        color: white;
        font-size: 0.65rem;
        padding: 4px 12px;
        border-radius: 20px;
        backdrop-filter: blur(4px);
        z-index: 1000;
        pointer-events: none;
        opacity: 0.8;
        transition: opacity 0.5s ease;
        white-space: nowrap;
    `;
    hint.textContent = '🖱️ Click to expand map';
    mapContainer.appendChild(hint);
    
    setTimeout(() => {
        hint.style.opacity = '0';
        setTimeout(() => {
            if (hint.parentNode) {
                hint.parentNode.removeChild(hint);
            }
        }, 500);
    }, 5000);
}

function setupModalMapClose() {
    const closeBtns = [
        document.getElementById('closeMapModal'),
        document.getElementById('closeMapModalBtn')
    ];
    
    closeBtns.forEach(btn => {
        if (btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                closeMapModal();
            });
        }
    });
    
    const modal = document.getElementById('mapModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeMapModal();
            }
        });
    }
}

/* ============================================================
   LOAD REPORTERS
============================================================ */

async function loadReporters() {
    try {
        const response = await apiFetch('/users-list');
        
        if (!response.ok) {
            throw new Error('Failed to load reporters');
        }
        
        const users = await response.json();
        const select = document.getElementById('reportedBy');
        
        if (!select) return;
        
        select.innerHTML = '<option value="">Select Reporter</option>';
        
        if (users.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "⚠️ No users available - add a user first";
            option.disabled = true;
            select.appendChild(option);
            return;
        }
        
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading reporters:', error);
        showErrorModal('Error', 'Failed to load reporters. Please check your connection.');
    }
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
        const params = new URLSearchParams({ page: currentPage, limit: incidentsPerPage });

        const searchVal = document.getElementById('searchInput')?.value.trim();
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
                    <td colspan="8" style="text-align: center; padding: 24px; color: #ef4444;">
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

    // ✅ Clear table first
    tbody.innerHTML = '';

    if (dataToRender.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 30px; color: #94a3b8;">
                    <i class="fa-regular fa-circle" style="font-size: 1.5rem; display: block; margin-bottom: 8px;"></i>
                    No incident records found.
                </td>
            </tr>
        `;
        console.log('✅ Table rendered: empty state');
        return;
    }

    const isAdminUser = isAdmin(); // mula sa apiHelper.js
    console.log('👑 Is Admin:', isAdminUser);

    // ✅ Use for loop with DOM manipulation para sigurado
    let rowCount = 0;
    
    for (let i = 0; i < dataToRender.length; i++) {
        const item = dataToRender[i];
        
        if (!item.id) continue;
        
        const formattedDate = formatDate(item.date);
        const formattedTime = formatTime(item.time);
        const locationDisplay = item.street_name || `${item.latitude || 'N/A'}, ${item.longitude || 'N/A'}`;
        
        const actionButtons = isAdminUser ? `
            <button class="btn-action-edit admin-action" onclick="editIncident(${item.id})">Edit</button>
            <button class="btn-action-delete admin-action" onclick="requestDeleteIncident(${item.id})">Delete</button>
        ` : `<span style="color: #94a3b8; font-size: 0.7rem;">View Only</span>`;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="font-bold">${item.id}</td>
            <td>${escapeHTML(item.incident_type || 'N/A')}</td>
            <td class="text-secondary">${formattedDate} ${formattedTime}</td>
            <td>${escapeHTML(locationDisplay)}</td>
            <td><span class="badge ${getStatusClass(item.status)}">${escapeHTML(item.status || 'N/A')}</span></td>
            <td><span class="badge ${getDangerClass(item.danger_level)}">${escapeHTML(item.danger_level || 'N/A')}</span></td>
            <td class="text-secondary" style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(item.recommended_action || '')}">${escapeHTML(item.recommended_action || 'N/A')}</td>
            <td>${actionButtons}</td>
        `;
        
        tbody.appendChild(row);
        rowCount++;
    }
    
    console.log('✅ Table rendered with', rowCount, 'rows');
    console.log('📋 tbody innerHTML length:', tbody.innerHTML.length);
    console.log('📋 First row HTML:', tbody.querySelector('tr') ? tbody.querySelector('tr').outerHTML : 'No rows');
}

/* ============================================================
   SETUP FORM - ✅ FIXED: Lowercase latitude/longitude
============================================================ */

function setupForm() {
    const form = document.getElementById('incidentForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!isAdmin()) { // mula sa apiHelper.js
            showErrorModal('Access Denied', 'Only administrators can add or edit incidents.');
            return;
        }

        const type = document.getElementById('incidentType').value;
        const date = document.getElementById('incidentDate').value;
        const time = document.getElementById('incidentTime').value;
        const lat = document.getElementById('incidentLat').value;
        const lng = document.getElementById('incidentLng').value;
        const street = document.getElementById('incidentStreet').value;
        const reporterIdRaw = document.getElementById('reportedBy').value; 
        const status = document.getElementById('incidentStatus').value;
        const desc = document.getElementById('incidentDesc').value;
        const action = document.getElementById('recommendedAction').value;

        if (!type || !date || !time || !lat || !lng || !street) {
            showErrorModal('Validation Error', 'Please fill in all required fields including street name.');
            return;
        }

        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lng);
        
        const MIN_LAT = 14.73;
        const MAX_LAT = 14.77;
        const MIN_LNG = 121.06;
        const MAX_LNG = 121.09;
        
        if (isNaN(latNum) || isNaN(lngNum)) {
            showErrorModal('Invalid Coordinates', 'Please click on the map to select a valid location.');
            return;
        }
        
        if (latNum < MIN_LAT || latNum > MAX_LAT || lngNum < MIN_LNG || lngNum > MAX_LNG) {
            showErrorModal('Invalid Coordinates', `Latitude must be between ${MIN_LAT} and ${MAX_LAT}\nLongitude must be between ${MIN_LNG} and ${MAX_LNG}\n\nPlease click on the map again.`);
            return;
        }

        const repId = parseInt(reporterIdRaw, 10);
        if (isNaN(repId) || repId <= 0) {
            showErrorModal('Validation Error', 'Please select a valid Reporter from the list.');
            return;
        }

        try {
            const incidentId = document.getElementById('editIndex').value;
            const method = incidentId ? 'PUT' : 'POST';
            const url = incidentId ? `/incidents/${incidentId}` : '/incidents';

            // ✅ FIXED: lowercase latitude at longitude
            const payload = {
                incident_type: type, 
                date, 
                time, 
                latitude: latNum,      // ✅ lowercase
                longitude: lngNum,     // ✅ lowercase
                street_name: street,
                reporter_id: repId, 
                status, 
                description: desc, 
                recommended_action: action
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
                } catch (e) {}
                throw new Error(errorMsg);
            }

            clearForm();
            
            // ✅ FORCE REFRESH: Clear and reload incidents
            incidents = [];
            console.log('🔄 Reloading incidents after save...');
            
            // ✅ Use timeout to ensure DOM is ready
            setTimeout(async () => {
                await loadIncidents();
                console.log('✅ Incidents reloaded after save');
            }, 200);
            
            closeMapModal();
            
            showSuccessModal('Success!', 'Incident saved successfully!');

        } catch (error) {
            console.error('Error saving incident:', error);
            showErrorModal('Error', 'Failed to save incident: ' + error.message);
        }
    });
}

/* ============================================================
   CLEAR FORM
============================================================ */

function clearForm() {
    const form = document.getElementById('incidentForm');
    if (form) form.reset();
    document.getElementById('editIndex').value = '';
    document.getElementById('formTitle').textContent = "Add New Incident";
    document.getElementById('saveBtn').innerHTML = `💾 Save Incident`;
    document.getElementById('reportedBy').value = '';
    document.getElementById('incidentStreet').value = '';
    document.getElementById('incidentLat').value = '';
    document.getElementById('incidentLng').value = '';
    document.getElementById('locationPrompt').textContent = "Click on the map to mark the exact incident location.";
    
    if (marker) {
        mapPicker.removeLayer(marker);
        marker = null;
    }
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
        showDeleteModal(`Are you sure you want to delete incident #${id}?`, id);
    } else {
        if (confirm(`Are you sure you want to delete incident record #${id}?`)) {
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
        
        showSuccessModal('Deleted!', `Incident #${id} deleted successfully!`);
    } catch (error) {
        console.error('Error deleting incident:', error);
        showErrorModal('Error', 'Failed to delete incident.');
    }
};

/* ============================================================
   EDIT INCIDENT
============================================================ */

window.editIncident = async (id) => {
    if (!isAdmin()) { // mula sa apiHelper.js
        showErrorModal('Access Denied', 'Only administrators can edit incidents.');
        return;
    }

    try {
        const record = incidents.find(item => item.id === id);
        if (!record) {
            showErrorModal('Error', 'Record not found!');
            return;
        }

        document.getElementById('editIndex').value = record.id;
        document.getElementById('incidentType').value = record.incident_type || '';
        document.getElementById('incidentDate').value = record.date ? record.date.split('T')[0] : '';
        document.getElementById('incidentTime').value = record.time ? record.time.substring(0, 5) : '';
        document.getElementById('incidentLat').value = record.latitude || '';
        document.getElementById('incidentLng').value = record.longitude || '';
        document.getElementById('incidentStreet').value = record.street_name || '';
        
        if (record.latitude && record.longitude) {
            if (marker) mapPicker.removeLayer(marker);
            marker = L.marker([record.latitude, record.longitude]).addTo(mapPicker);
            mapPicker.setView([record.latitude, record.longitude], 16);
        }

        document.getElementById('reportedBy').value = record.reporter_id || '';
        document.getElementById('incidentStatus').value = record.status || 'Open';
        document.getElementById('incidentDesc').value = record.description || '';
        document.getElementById('recommendedAction').value = record.recommended_action || '';

        document.getElementById('formTitle').textContent = `Edit Incident (#${record.id})`;
        document.getElementById('saveBtn').innerHTML = `✏️ Update Incident`;
        
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
    modal.style.display = 'flex';
}

function showDeleteModal(message, id) {
    const modal = document.getElementById('deleteModal');
    const msgEl = document.getElementById('deleteMessage');
    
    msgEl.textContent = message || 'Are you sure you want to delete this incident record?';
    pendingDeleteId = id;
    modal.style.display = 'flex';
}

// Close modals on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.getElementById('successModal').style.display = 'none';
        document.getElementById('errorModal').style.display = 'none';
        document.getElementById('deleteModal').style.display = 'none';
        closeMapModal();
    }
});

console.log('✅ incident.js loaded successfully');