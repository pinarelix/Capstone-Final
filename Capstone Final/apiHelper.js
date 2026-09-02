/* ============================================================
   API HELPER - Barangay 179 Crime BI
   Centralized API functions with session token management
   ✅ FIXED: Lahat ng storage ay sessionStorage na (consistent sa login)
============================================================ */

// ============================================================
// 1. GLOBAL CONSTANTS
// ============================================================
const API_URL = 'http://localhost:3000/api';

// ============================================================
// 2. SESSION TOKEN MANAGEMENT
// ============================================================

/**
 * Kunin ang session token mula sa sessionStorage
 * @returns {string|null} - Ang session token o null kung wala
 */
function getSessionToken() {
    return sessionStorage.getItem('token');
}

/**
 * I-save ang session token sa sessionStorage
 * @param {string} token - Ang session token na i-save
 */
function setSessionToken(token) {
    sessionStorage.setItem('token', token);
}

/**
 * Kunin ang current user data mula sa sessionStorage
 * @returns {Object|null} - User object o null
 */
function getCurrentUser() {
    try {
        const userData = sessionStorage.getItem('user');
        if (userData) {
            return JSON.parse(userData);
        }
        return null;
    } catch (e) {
        console.error('❌ Error parsing user data:', e);
        return null;
    }
}

/**
 * I-clear ang lahat ng session data (logout)
 */
function clearSession() {
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('username');
    sessionStorage.removeItem('userRole');
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('lastLogin');
    sessionStorage.removeItem('loginHistory');
}

// ============================================================
// 3. MAIN API FETCH FUNCTION
// ============================================================

/**
 * Centralized fetch function na may:
 * - Automatic na pagdagdag ng session token sa headers
 * - Error handling para sa expired session (401) at forbidden (403)
 * 
 * @param {string} path - Ang API endpoint (halimbawa: '/incidents', '/users')
 * @param {Object} options - Fetch options (method, body, headers, etc.)
 * @returns {Promise<Response>} - Ang response mula sa server
 */
async function apiFetch(path, options = {}) {
    // 1. Kunin ang token
    const token = getSessionToken();
    
    // 2. I-set ang default headers
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    // 3. Kung may token, idagdag sa Authorization header
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    // 4. I-execute ang fetch request
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers
    });
    
    // 5. Kung 401 (Unauthorized) - expired session
    if (response.status === 401) {
        console.warn('⚠️ Session expired. Redirecting to login...');
        clearSession();
        window.location.href = 'login.html';
        throw new Error('Session expired. Please login again.');
    }
    
    // 6. Kung 403 (Forbidden) - walang permission
    if (response.status === 403) {
        console.warn('⛔ Forbidden: Insufficient permissions');
        const errorData = await response.json().catch(() => ({}));
        if (typeof showToast === 'function') {
            showToast(errorData.error || 'You do not have permission.', 'error');
        } else {
            alert(errorData.error || 'You do not have permission to perform this action.');
        }
        throw new Error(errorData.error || 'Forbidden');
    }
    
    // 7. Ibalik ang response
    return response;
}

// ============================================================
// 4. TOAST NOTIFICATION HELPER
// ============================================================

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - 'success', 'error', 'warning', 'info'
 */
function showToast(message, type = 'success') {
    const existingToast = document.querySelector('.toast-global');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-global';
    
    const colors = {
        success: '#059669',
        error: '#dc2626',
        warning: '#d97706',
        info: '#2563eb'
    };
    
    toast.style.cssText = `
        position: fixed;
        right: 24px;
        bottom: 24px;
        min-width: 280px;
        max-width: 420px;
        padding: 14px 20px;
        border-radius: 12px;
        background-color: ${colors[type] || '#0f172a'};
        color: #ffffff;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25);
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 0.85rem;
        font-weight: 600;
        font-family: 'Inter', sans-serif;
        transform: translateY(30px);
        opacity: 0;
        transition: all 0.3s ease;
        z-index: 99999;
        pointer-events: none;
    `;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    toast.innerHTML = `
        <span style="font-size: 1.2rem;">${icons[type] || 'ℹ️'}</span>
        <span>${message}</span>
    `;

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.transform = 'translateY(30px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================
// 5. ROLE-BASED ACCESS CONTROL HELPERS
// ============================================================

/**
 * Check if user is logged in
 * @returns {boolean}
 */
function isLoggedIn() {
    const user = getCurrentUser();
    return user && user.id;
}

/**
 * Check if user is Admin
 * @returns {boolean}
 */
function isAdmin() {
    const user = getCurrentUser();
    return user && user.role === 'Administrator';
}

/**
 * Check if user is Captain
 * @returns {boolean}
 */
function isCaptain() {
    const user = getCurrentUser();
    return user && user.role === 'Captain';
}

/**
 * Check if user is Decision-Maker
 * @returns {boolean}
 */
function isDecisionMaker() {
    const user = getCurrentUser();
    return user && user.role === 'Decision-Maker';
}

// ============================================================
// 🔥 NEW: APPLY ROLE-BASED UI
// ============================================================

/**
 * Apply role-based UI changes:
 * - Hide admin-only elements for non-admin users
 * - Add role class to body
 * - Update user profile in sidebar
 */
function applyRoleBasedUI() {
    const user = getCurrentUser();
    if (!user) {
        console.log('⚠️ No user found, skipping role-based UI');
        return;
    }
    
    console.log('👤 Current user role:', user.role);
    
    // Add role class to body
    if (user.role === 'Decision-Maker' || user.role === 'Captain') {
        document.body.classList.add('role-decision-maker');
        console.log('🔒 Decision-Maker/Captain mode enabled');
    } else if (user.role === 'Administrator') {
        document.body.classList.add('role-admin');
        console.log('👑 Admin mode enabled');
    }
    
    // Hide admin-only elements for non-admin users
    if (user.role === 'Decision-Maker' || user.role === 'Captain') {
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = 'none';
        });
        document.querySelectorAll('.admin-action').forEach(el => {
            el.style.display = 'none';
        });
        document.querySelectorAll('.admin-section').forEach(el => {
            el.style.display = 'none';
        });
        console.log('🔒 Admin-only elements hidden');
    }
    
    // Update user profile in sidebar (if elements exist)
    const nameEl = document.getElementById('userNameDisplay');
    const roleEl = document.getElementById('userRoleDisplay');
    
    if (nameEl) {
        nameEl.textContent = user.name || 'User';
    }
    
    if (roleEl) {
        let roleDisplay = 'User';
        if (user.role === 'Administrator') {
            roleDisplay = '👑 Administrator — Full System Access';
        } else if (user.role === 'Decision-Maker') {
            roleDisplay = '📊 Decision-Maker — View & Analytics Access';
        } else if (user.role === 'Captain') {
            roleDisplay = '📊 Captain — View & Analytics Access';
        }
        roleEl.textContent = roleDisplay;
    }
}

// ============================================================
// 6. SPECIALIZED API FUNCTIONS
// ============================================================

/**
 * API para sa Incident Management
 */
const IncidentsAPI = {
    getAll: () => apiFetch('/incidents'),
    getViewOnly: (page = 1, limit = 10, search = '', type = '', status = '') => {
        let url = `/incidents/view-only?page=${page}&limit=${limit}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (type) url += `&type=${encodeURIComponent(type)}`;
        if (status) url += `&status=${encodeURIComponent(status)}`;
        return apiFetch(url);
    },
    getById: (id) => apiFetch(`/incidents/${id}`),
    create: (payload) => apiFetch('/incidents', {
        method: 'POST',
        body: JSON.stringify(payload)
    }),
    update: (id, payload) => apiFetch(`/incidents/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
    }),
    delete: (id) => apiFetch(`/incidents/${id}`, {
        method: 'DELETE'
    })
};

/**
 * API para sa User Management
 */
const UsersAPI = {
    getAll: () => apiFetch('/users'),
    getById: (id) => apiFetch(`/users/${id}`),
    create: (payload) => apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify(payload)
    }),
    delete: (id) => apiFetch(`/users/${id}`, {
        method: 'DELETE'
    }),
    search: (query) => apiFetch(`/users/search?q=${encodeURIComponent(query)}`)
};

/**
 * API para sa Tanod & Patrol
 */
const PatrolAPI = {
    getTanods: () => apiFetch('/tanods'),
    getTanodsAll: () => apiFetch('/tanods/all'),
    getTanodById: (id) => apiFetch(`/tanods/${id}`),
    createTanod: (payload) => apiFetch('/tanods', {
        method: 'POST',
        body: JSON.stringify(payload)
    }),
    updateTanod: (id, payload) => apiFetch(`/tanods/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
    }),
    deleteTanod: (id) => apiFetch(`/tanods/${id}`, {
        method: 'DELETE'
    }),
    getSchedules: () => apiFetch('/patrol-schedules'),
    getSchedulesAll: () => apiFetch('/patrol-schedules/all'),
    getScheduleById: (id) => apiFetch(`/patrol-schedules/${id}`),
    createSchedule: (payload) => apiFetch('/patrol-schedules', {
        method: 'POST',
        body: JSON.stringify(payload)
    }),
    updateSchedule: (id, payload) => apiFetch(`/patrol-schedules/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
    }),
    deleteSchedule: (id) => apiFetch(`/patrol-schedules/${id}`, {
        method: 'DELETE'
    }),
    getLogs: () => apiFetch('/patrol-logs'),
    getLogById: (id) => apiFetch(`/patrol-logs/${id}`),
    createLog: (payload) => apiFetch('/patrol-logs', {
        method: 'POST',
        body: JSON.stringify(payload)
    }),
    updateLog: (id, payload) => apiFetch(`/patrol-logs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
    }),
    deleteLog: (id) => apiFetch(`/patrol-logs/${id}`, {
        method: 'DELETE'
    })
};

/**
 * API para sa CART Analytics
 */
const CartAPI = {
    getRiskFactors: () => apiFetch('/cart/risk-factors'),
    getSummary: () => apiFetch('/cart/summary'),
    getDecisionRules: () => apiFetch('/cart/decision-rules'),
    getAnalysisLogs: () => apiFetch('/cart/analysis-logs'),
    runAnalysis: () => apiFetch('/cart/analyze', {
        method: 'POST',
        body: JSON.stringify({})
    })
};

/**
 * API para sa Dashboard
 */
const DashboardAPI = {
    getStats: () => apiFetch('/dashboard/stats'),
    getCharts: () => apiFetch('/dashboard/charts')
};

/**
 * API para sa Heatmap
 */
const HeatmapAPI = {
    getIncidents: () => apiFetch('/heatmap/incidents')
};

/**
 * API para sa Reports
 */
const ReportsAPI = {
    getIncidents: () => apiFetch('/incidents')
};

/**
 * API para sa Login History
 */
const LoginHistoryAPI = {
    getAll: () => apiFetch('/login-history'),
    getUser: (userId) => apiFetch(`/login-history/user/${userId}`)
};

// ============================================================
// 7. EXPORT (Ginagawang global para magamit sa HTML)
// ============================================================
window.apiFetch = apiFetch;
window.getSessionToken = getSessionToken;
window.setSessionToken = setSessionToken;
window.getCurrentUser = getCurrentUser;
window.clearSession = clearSession;
window.showToast = showToast;
window.isLoggedIn = isLoggedIn;
window.isAdmin = isAdmin;
window.isCaptain = isCaptain;
window.isDecisionMaker = isDecisionMaker;
window.applyRoleBasedUI = applyRoleBasedUI; // 🔥 NEW
window.IncidentsAPI = IncidentsAPI;
window.UsersAPI = UsersAPI;
window.PatrolAPI = PatrolAPI;
window.CartAPI = CartAPI;
window.DashboardAPI = DashboardAPI;
window.HeatmapAPI = HeatmapAPI;
window.ReportsAPI = ReportsAPI;
window.LoginHistoryAPI = LoginHistoryAPI;

console.log('✅ apiHelper.js loaded successfully (sessionStorage version)');