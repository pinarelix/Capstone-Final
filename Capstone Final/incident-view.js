// incident-view.js - Read-only incident viewer for Captain
// FIXED: Proper column names matching database schema

document.addEventListener('DOMContentLoaded', function() {
    // =========================================================
    // 1. CHECK USER SESSION
    // =========================================================
    
    // Try to get user data from sessionStorage first, then localStorage
    let userData = sessionStorage.getItem('user') || localStorage.getItem('user');
    let token = sessionStorage.getItem('token') || localStorage.getItem('session_token');
    
    console.log('🔍 User data from storage:', userData);
    console.log('🔍 Token from storage:', token);
    
    // Parse user data
    let user = null;
    try {
        user = JSON.parse(userData);
    } catch (e) {
        console.error('❌ Failed to parse user data:', e);
        window.location.href = 'login.html';
        return;
    }
    
    // Check if user exists and has valid data
    if (!user || !user.id) {
        console.log('❌ No valid user found, redirecting to login');
        window.location.href = 'login.html';
        return;
    }
    
    if (!token) {
        console.log('❌ No token found, redirecting to login');
        window.location.href = 'login.html';
        return;
    }
    
    // Check role - allow Captain, Administrator, Decision-Maker
    const allowedRoles = ['Captain', 'Administrator', 'Decision-Maker'];
    if (!allowedRoles.includes(user.role)) {
        console.log(`❌ Access denied. User role: ${user.role}`);
        alert('Access denied. This page is for Captain and above.');
        window.location.href = 'dashboard.html';
        return;
    }
    
    console.log(`✅ Access granted for ${user.role}: ${user.name || user.username}`);
    
    // =========================================================
    // 2. DISPLAY USER INFO
    // =========================================================
    const userNameDisplay = document.getElementById('userNameDisplay');
    const userRoleDisplay = document.getElementById('userRoleDisplay');
    
    if (userNameDisplay) {
        userNameDisplay.textContent = user.name || user.username || 'Captain';
    }
    
    if (userRoleDisplay) {
        const roleMap = {
            'Administrator': 'Administrator — Full Access',
            'Decision-Maker': 'Decision-Maker — View & Analytics Access',
            'Captain': 'Captain — View & Analytics Access'
        };
        userRoleDisplay.textContent = roleMap[user.role] || user.role || 'Captain';
    }
    
    // =========================================================
    // 3. STATE VARIABLES
    // =========================================================
    let currentPage = 1;
    const limit = 10;
    let totalPages = 0;
    let totalRecords = 0;
    
    // =========================================================
    // 4. DOM ELEMENTS
    // =========================================================
    const tableBody = document.getElementById('incidentTableBody');
    const searchInput = document.getElementById('searchIncident');
    const filterType = document.getElementById('filterType');
    const filterStatus = document.getElementById('filterStatus');
    const paginationControls = document.getElementById('paginationControls');
    const refreshBtn = document.getElementById('refreshBtn');
    const recordCount = document.getElementById('recordCount');
    
    // =========================================================
    // 5. TOAST NOTIFICATIONS
    // =========================================================
    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast-custom ${type}`;
        
        const iconMap = {
            'error': 'fa-circle-exclamation',
            'success': 'fa-circle-check',
            'info': 'fa-circle-info'
        };
        const icon = iconMap[type] || 'fa-circle-info';
        
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <i class="fa-solid ${icon}" style="color: ${type === 'error' ? '#dc2626' : type === 'success' ? '#059669' : '#2563eb'}; font-size: 1.2rem;"></i>
                <span style="font-size: 0.9rem; color: #0f172a;">${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; margin-left: auto; color: #94a3b8; cursor: pointer;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 5000);
    }
    
    // =========================================================
    // 5b. LOAD STATS (Total / Open / Monitoring / Resolved)
    // Independent of the table's search/filter/pagination state -
    // always reflects the true counts across every visible record.
    // =========================================================
    function loadStats() {
        fetch(`${API_URL}/incidents/view-only?page=1&limit=1000`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then(data => {
                const list = data.incidents || [];
                const counts = { Open: 0, Monitoring: 0, Resolved: 0 };
                list.forEach(item => {
                    if (counts[item.status] !== undefined) counts[item.status]++;
                });

                const statTotal = document.getElementById('statTotal');
                const statOpen = document.getElementById('statOpen');
                const statMonitoring = document.getElementById('statMonitoring');
                const statResolved = document.getElementById('statResolved');

                if (statTotal) statTotal.textContent = data.total ?? list.length;
                if (statOpen) statOpen.textContent = counts.Open;
                if (statMonitoring) statMonitoring.textContent = counts.Monitoring;
                if (statResolved) statResolved.textContent = counts.Resolved;
            })
            .catch(error => {
                console.error('❌ Error loading stats:', error);
            });
    }

    // =========================================================
    // 6. LOAD INCIDENTS
    // =========================================================
    function loadIncidents() {
        const search = searchInput.value.trim();
        const type = filterType.value;
        const status = filterStatus.value;
        
        let url = `${API_URL}/incidents/view-only?page=${currentPage}&limit=${limit}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (type) url += `&type=${encodeURIComponent(type)}`;
        if (status) url += `&status=${encodeURIComponent(status)}`;
        
        console.log('📡 Fetching:', url);
        
        // Show loading state
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-4 text-muted">
                    <i class="fa-solid fa-spinner fa-spin me-2"></i> Loading incidents...
                </td>
            </tr>
        `;
        
        fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => {
            console.log('📡 Response status:', response.status);
            if (response.status === 401) {
                console.log('❌ Session expired, redirecting to login');
                sessionStorage.clear();
                localStorage.removeItem('user');
                localStorage.removeItem('session_token');
                window.location.href = 'login.html';
                throw new Error('Session expired');
            }
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('📊 Incidents loaded:', data);
            const incidents = data.incidents || [];
            totalPages = data.totalPages || 0;
            totalRecords = data.total || 0;
            
            renderTable(incidents);
            renderPagination();
            updateRecordCount();
        })
        .catch(error => {
            console.error('❌ Error loading incidents:', error);
            if (error.message === 'Session expired') {
                return;
            }
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center py-4 text-danger">
                        <i class="fa-solid fa-circle-exclamation me-2"></i>
                        Failed to load incidents. Please try again.
                        <br>
                        <small class="text-muted">${error.message}</small>
                    </td>
                </tr>
            `;
            showToast('Failed to load incidents: ' + error.message, 'error');
        });
    }
    
    // =========================================================
    // 7. RENDER TABLE - FIXED: Tamang column names
    // =========================================================
    function renderTable(incidents) {
        if (!incidents || incidents.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center py-5">
                        <div class="empty-state">
                            <i class="fa-regular fa-inbox"></i>
                            <h4>No Incidents Found</h4>
                            <p>No incidents match your search criteria.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }
        
        tableBody.innerHTML = incidents.map((incident, index) => {
            // Status badge class - matches the real DB values (Open,
            // Monitoring, Resolved) and dashboard.css's shared badge colors
            const statusClass = {
                'Open': 'badge-open',
                'Monitoring': 'badge-monitoring',
                'Resolved': 'badge-resolved'
            }[incident.status] || 'badge-open';

            // Danger level badge class - same thresholds as dashboard.js
            const danger = incident.danger_level || '';
            let dangerClass = 'badge-danger-low';
            if (danger.includes('Level 3') || danger.includes('High')) {
                dangerClass = 'badge-danger-high';
            } else if (danger.includes('Level 2') || danger.includes('Moderate')) {
                dangerClass = 'badge-danger-mod';
            }

            // Format date - using date and time fields from MySQL
            let formattedDate = 'N/A';
            if (incident.date) {
                try {
                    const dateObj = new Date(incident.date + ' ' + (incident.time || '00:00:00'));
                    if (!isNaN(dateObj)) {
                        formattedDate = dateObj.toLocaleDateString('en-PH', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    }
                } catch (e) {
                    formattedDate = incident.date || 'N/A';
                }
            }
            
            // Get reporter name - FIXED: gumamit ng reporter_name mula sa JOIN
            const reporterName = incident.reporter_name || 'N/A';
            
            // Get location - FIXED: gumamit ng street_name
            const location = incident.street_name || 'N/A';
            
            // ✅ FIXED: gumamit ng incident.id (hindi _id)
            // ✅ FIXED: gumamit ng incident.incident_type (hindi type)
            return `
                <tr>
                    <td>${(currentPage - 1) * limit + index + 1}</td>
                    <td><strong>${escapeHTML(incident.incident_type || 'N/A')}</strong></td>
                    <td>${escapeHTML(location)}</td>
                    <td>${formattedDate}</td>
                    <td><span class="badge ${statusClass}">${escapeHTML(incident.status || 'Open')}</span></td>
                    <td><span class="badge ${dangerClass}">${escapeHTML(danger || 'Not assessed')}</span></td>
                    <td>${escapeHTML(reporterName)}</td>
                    <td>
                        <button class="btn-view" data-id="${incident.id}">
                            <i class="fa-regular fa-eye me-1"></i> View
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Add event listeners to view buttons
        document.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', function() {
                const id = this.dataset.id;
                viewIncident(id);
            });
        });
    }
    
    // =========================================================
    // 8. VIEW INCIDENT DETAILS - FIXED: Tamang column names
    // =========================================================
    const INCIDENT_TYPE_ICONS = {
        'Theft': 'fa-user-secret',
        'Robbery': 'fa-mask',
        'Assault': 'fa-hand-fist',
        'Vandalism': 'fa-spray-can',
        'Drug Related': 'fa-pills',
        'Physical Injury': 'fa-truck-medical',
        'Noise Complaint': 'fa-volume-high',
        'Suspicious Activity': 'fa-magnifying-glass',
        'Traffic Obstruction': 'fa-car-burst',
        'Curfew Violation': 'fa-moon'
    };

    function getIncidentIcon(type) {
        return INCIDENT_TYPE_ICONS[type] || 'fa-triangle-exclamation';
    }

    function viewIncident(id) {
        const modalBody = document.getElementById('viewIncidentBody');
        modalBody.innerHTML = `
            <div class="text-center py-4">
                <i class="fa-solid fa-spinner fa-spin me-2"></i> Loading incident details...
            </div>
        `;
        
        const modal = new bootstrap.Modal(document.getElementById('viewIncidentModal'));
        modal.show();
        
        fetch(`${API_URL}/incidents/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => {
            if (response.status === 401) {
                sessionStorage.clear();
                localStorage.removeItem('user');
                localStorage.removeItem('session_token');
                window.location.href = 'login.html';
                throw new Error('Session expired');
            }
            if (!response.ok) {
                throw new Error('Failed to fetch incident details');
            }
            return response.json();
        })
        .then(incident => {
            console.log('📋 Incident details:', incident);
            
            // Format date - FIXED: gumamit ng date at time fields
            let formattedDate = 'N/A';
            let formattedCreated = 'N/A';
            
            if (incident.date) {
                try {
                    const dateObj = new Date(incident.date + ' ' + (incident.time || '00:00:00'));
                    if (!isNaN(dateObj)) {
                        formattedDate = dateObj.toLocaleDateString('en-PH', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    }
                } catch (e) {
                    formattedDate = incident.date || 'N/A';
                }
            }
            
            if (incident.created_at) {
                try {
                    const created = new Date(incident.created_at);
                    if (!isNaN(created)) {
                        formattedCreated = created.toLocaleString('en-PH');
                    }
                } catch (e) {}
            }
            
            const statusClass = {
                'Open': 'badge-open',
                'Monitoring': 'badge-monitoring',
                'Resolved': 'badge-resolved'
            }[incident.status] || 'badge-open';

            const modalDanger = incident.danger_level || '';
            let dangerTier = 'low';
            if (modalDanger.includes('Level 3') || modalDanger.includes('High')) {
                dangerTier = 'high';
            } else if (modalDanger.includes('Level 2') || modalDanger.includes('Moderate')) {
                dangerTier = 'mod';
            }
            const modalDangerClass = `badge-danger-${dangerTier}`;

            // ✅ FIXED: gumamit ng tamang column names
            modalBody.innerHTML = `
                <div class="incident-hero danger-${dangerTier}">
                    <div class="incident-hero-icon">
                        <i class="fa-solid ${getIncidentIcon(incident.incident_type)}"></i>
                    </div>
                    <div>
                        <p class="incident-hero-id">Incident #${incident.id}</p>
                        <h3 class="incident-hero-title">${escapeHTML(incident.incident_type || 'N/A')}</h3>
                        <div class="incident-hero-badges">
                            <span class="badge ${statusClass}">${escapeHTML(incident.status || 'Open')}</span>
                            <span class="badge ${modalDangerClass}">${escapeHTML(incident.danger_level || 'Not assessed')}</span>
                        </div>
                    </div>
                </div>

                <div class="incident-detail-grid">
                    <div class="incident-detail-card">
                        <div class="incident-detail-icon"><i class="fa-solid fa-location-dot"></i></div>
                        <div>
                            <div class="detail-label">Location</div>
                            <div class="detail-value">${escapeHTML(incident.street_name || 'N/A')}</div>
                        </div>
                    </div>
                    <div class="incident-detail-card">
                        <div class="incident-detail-icon"><i class="fa-solid fa-calendar-day"></i></div>
                        <div>
                            <div class="detail-label">Date &amp; Time</div>
                            <div class="detail-value">${formattedDate}</div>
                        </div>
                    </div>
                    <div class="incident-detail-card">
                        <div class="incident-detail-icon"><i class="fa-solid fa-user"></i></div>
                        <div>
                            <div class="detail-label">Reported By</div>
                            <div class="detail-value">${escapeHTML(incident.reporter_name || 'N/A')}</div>
                        </div>
                    </div>
                    <div class="incident-detail-card">
                        <div class="incident-detail-icon"><i class="fa-solid fa-map-pin"></i></div>
                        <div>
                            <div class="detail-label">Coordinates</div>
                            <div class="detail-value">${incident.latitude ? `${incident.latitude}, ${incident.longitude}` : 'N/A'}</div>
                        </div>
                    </div>
                    <div class="incident-detail-card">
                        <div class="incident-detail-icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
                        <div>
                            <div class="detail-label">Reported On</div>
                            <div class="detail-value">${formattedCreated}</div>
                        </div>
                    </div>
                </div>

                <div class="incident-text-card">
                    <div class="incident-text-card-header"><i class="fa-solid fa-align-left"></i> Description</div>
                    <div class="incident-text-card-body">${escapeHTML(incident.description || 'No description provided.')}</div>
                </div>
                <div class="incident-text-card">
                    <div class="incident-text-card-header"><i class="fa-solid fa-shield-halved"></i> Recommended Action</div>
                    <div class="incident-text-card-body">${escapeHTML(incident.recommended_action || 'No action recommended.')}</div>
                </div>
            `;
        })
        .catch(error => {
            console.error('❌ Error loading incident details:', error);
            if (error.message === 'Session expired') return;
            modalBody.innerHTML = `
                <div class="text-center py-4 text-danger">
                    <i class="fa-solid fa-circle-exclamation me-2"></i>
                    Failed to load incident details.
                    <br>
                    <small class="text-muted">${error.message}</small>
                </div>
            `;
            showToast('Failed to load incident details', 'error');
        });
    }
    
    // =========================================================
    // 9. RENDER PAGINATION
    // =========================================================
    function renderPagination() {
        if (totalPages <= 1) {
            paginationControls.innerHTML = '';
            return;
        }
        
        let html = '';
        
        html += `
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
            html += `
                <li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>
            `;
        }
        
        html += `
            <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
                <a class="page-link" href="#" data-page="${currentPage + 1}">Next</a>
            </li>
        `;
        
        paginationControls.innerHTML = html;
        
        document.querySelectorAll('.page-link').forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const page = parseInt(this.dataset.page);
                if (page && page !== currentPage && page >= 1 && page <= totalPages) {
                    currentPage = page;
                    loadIncidents();
                }
            });
        });
    }
    
    // =========================================================
    // 10. UPDATE RECORD COUNT
    // =========================================================
    function updateRecordCount() {
        if (recordCount) {
            const start = (currentPage - 1) * limit + 1;
            const end = Math.min(currentPage * limit, totalRecords);
            recordCount.textContent = `Showing ${start}-${end} of ${totalRecords} records`;
        }
    }
    
    // =========================================================
    // 11. EVENT LISTENERS
    // =========================================================
    searchInput.addEventListener('input', () => {
        currentPage = 1;
        loadIncidents();
    });
    
    filterType.addEventListener('change', () => {
        currentPage = 1;
        loadIncidents();
    });
    
    filterStatus.addEventListener('change', () => {
        currentPage = 1;
        loadIncidents();
    });
    
    refreshBtn.addEventListener('click', () => {
        loadIncidents();
        loadStats();
        showToast('Refreshed successfully!', 'success');
    });

    // =========================================================
    // 12. LOAD INITIAL DATA
    // =========================================================
    loadIncidents();
    loadStats();
});