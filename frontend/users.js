/* ============================================================
   USERS.JS
   Barangay 179 Crime BI
   User Management Module - Admin & Decision-Maker Only + Audit
============================================================ */

// ✅ API_URL ay naka-define na sa apiHelper.js

// Global user data
let users = [];
let allTanods = [];
let allTeams = [];

/* ============================================================
   🔥 FIXED: Gumamit ng functions mula sa apiHelper.js
   (HINDI NA LOCAL STORAGE)
============================================================ */

// ✅ ITO NA LANG ANG KAILANGAN - WALA NANG CUSTOM FUNCTIONS

/* ============================================================
   DOM READY
============================================================ */

document.addEventListener("DOMContentLoaded", function () {
    // Apply role-based UI gamit ang apiHelper
    const user = getCurrentUser();
    
    if (!user && !window.location.pathname.includes('login.html')) {
        window.location.href = 'login.html';
        return;
    }
    
    applyRoleBasedUI(); // mula sa apiHelper.js
    
    // Update user profile in sidebar
    const nameEl = document.getElementById('userNameDisplay');
    const roleEl = document.getElementById('userRoleDisplay');
    
    if (nameEl) {
        nameEl.textContent = user?.name || 'User';
    }
    
    if (roleEl) {
        let roleDisplay = '<i class="fa-solid fa-chart-column"></i> Decision-Maker — View & Analytics Access';
        if (user?.role === 'Administrator') {
            roleDisplay = '<i class="fa-solid fa-crown"></i> Administrator — Full System Access';
        } else if (user?.role === 'Desk Officer') {
            roleDisplay = '<i class="fa-solid fa-headset"></i> Desk Officer — Records & Patrol Access';
        }
        roleEl.innerHTML = roleDisplay || 'User';
    }
    
    loadUsers();
    loadTanods();
    loadTeams();
    setupForm();
    setupTanodForm();
    setupTeamManagement();
    setupTabs();
    setupSearch();
    setupNavigation();
    setupPasswordToggle();
    setupRippleEffect();

    // Keeps both tables current if another admin adds/edits a user or
    // tanod, without needing to re-login.
    startLivePolling(refreshUsersOnly, 15000);
    startLivePolling(loadTanods, 15000);
});

/* ============================================================
   TABS FUNCTIONALITY
============================================================ */

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            this.classList.add('active');
            const tabId = this.getAttribute('data-tab');
            document.getElementById(`tab-${tabId}`).classList.add('active');
        });
    });
}

/* ============================================================
   LOAD USERS FROM DATABASE
============================================================ */

async function loadUsers() {
    try {
        showLoadingState();
        
        const response = await apiFetch('/users');
        
        if (!response.ok) {
            throw new Error('Failed to fetch users');
        }
        
        users = await response.json();
        renderUsers();
        updateAccountCount();
        
    } catch (error) {
        console.error('Unable to load users:', error);
        showToast('Failed to load users from database.', 'error');
        users = [];
        renderUsers();
        updateAccountCount();
    }
}

// Used for live polling instead of loadUsers() directly - that one
// flashes a loading spinner over the table on every call (fine for a
// one-off page load, jarring every 15s) and would stomp an in-progress
// search (setupSearch() below renders search results without touching
// the `users` array, so a blind refresh+render would replace them with
// the unfiltered list).
async function refreshUsersOnly() {
    try {
        const response = await apiFetch('/users');
        if (!response.ok) return;

        users = await response.json();

        const searchInput = document.getElementById('searchUsers');
        if (searchInput && searchInput.value.trim()) return;

        renderUsers();
        updateAccountCount();
    } catch (error) {
        console.error('❌ Error refreshing users:', error);
    }
}

function showLoadingState() {
    const tableBody = document.getElementById("usersTableBody");
    if (tableBody) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px;">
                    <i class="fa-solid fa-spinner fa-spin" style="font-size: 24px;"></i>
                    <div style="margin-top: 10px;">Loading users...</div>
                </td>
            </tr>
        `;
    }
}

/* ============================================================
   LOAD TANODS
============================================================ */

async function loadTanods() {
    try {
        const response = await apiFetch('/tanods');
        if (!response.ok) throw new Error('Failed to fetch tanods');
        
        allTanods = await response.json();
        renderTanods(allTanods);
        
        const countEl = document.getElementById('tanodCount');
        if (countEl) {
            countEl.textContent = `${allTanods.length} tanods`;
        }
    } catch (error) {
        console.error('Error loading tanods:', error);
        showToast('Failed to load tanods.', 'error');
        const tbody = document.getElementById('tanodTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 24px; color: #ef4444;">
                        Failed to load tanods.
                    </td>
                </tr>
            `;
        }
    }
}

/* ============================================================
   GET POSITION BADGE CLASS & ICON
============================================================ */

// Exact-match table for the ranks in the Position dropdown (Dispatcher,
// Team Leader, Assistant Team Leader, Head Tanod / EXO). "Desk Officer"
// and "Tanod" are no longer offered but stay here so older records
// still render with a proper badge -
// previously a keyword guess (pos.includes('head')/'deputy'/etc.) since
// Position used to be free text; now it's a closed dropdown so every
// value is known up front and can get its own badge instead of being
// bucketed into a generic one.
const POSITION_BADGES = {
    'Dispatcher': { class: 'position-dispatcher', icon: '<i class="fa-solid fa-walkie-talkie"></i>' },
    'Desk Officer': { class: 'position-desk-officer', icon: '<i class="fa-solid fa-clipboard-list"></i>' },
    'Team Leader': { class: 'position-team-leader', icon: '<i class="fa-solid fa-star"></i>' },
    'Assistant Team Leader': { class: 'position-assistant-leader', icon: '<i class="fa-solid fa-shield-halved"></i>' },
    'Head Tanod / EXO': { class: 'position-head-exo', icon: '<i class="fa-solid fa-crown"></i>' },
    'Tanod': { class: 'position-tanod', icon: '<i class="fa-solid fa-user-shield"></i>' }
};

function getPositionBadge(position) {
    const match = POSITION_BADGES[position];
    if (match) {
        return { class: `position-badge ${match.class}`, icon: match.icon, text: position };
    }

    // Legacy records saved before this rank list existed (e.g. the old
    // free-text "Deputy Tanod") - keep them readable instead of showing
    // an unstyled badge until the record is next edited and resaved.
    return {
        class: 'position-badge position-tanod',
        icon: '<i class="fa-solid fa-user-shield"></i>',
        text: position || 'Tanod'
    };
}

/* ============================================================
   RENDER TANODS
============================================================ */

function renderTanods(tanods) {
    const tbody = document.getElementById('tanodTableBody');
    if (!tbody) return;

    updateUnassignedTanodBanner(tanods);

    if (tanods.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="6">
                    <div class="empty-content">
                        <i class="fa-solid fa-users-slash"></i>
                        <span>No tanod records found.</span>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = tanods.map(tanod => {
        const positionBadge = getPositionBadge(tanod.position);
        const unassigned = !tanod.has_active_schedule;

        return `
        <tr>
            <td>
                <span class="font-bold" style="color: #0f172a;">${escapeHTML(tanod.name)}</span>
                ${unassigned ? '<i class="fa-solid fa-triangle-exclamation" style="color:#d97706; margin-left:6px;" title="No active patrol assignment"></i>' : ''}
            </td>
            <td>
                <span class="${positionBadge.class}">
                    ${positionBadge.icon} ${escapeHTML(positionBadge.text)}
                </span>
            </td>
            <td style="color: #475569;">${tanod.team_name ? escapeHTML(tanod.team_name) : '<span style="color:#94a3b8;">No Team</span>'}</td>
            <td style="color: #475569;">${escapeHTML(tanod.contact_no || 'N/A')}</td>
            <td style="color: #475569;">${escapeHTML(tanod.username || 'N/A')}</td>
            <td>
                <button type="button" class="btn-action-edit admin-action" onclick="editTanod(${tanod.id})">
                    <i class="fa-solid fa-pen"></i> Edit
                </button>
                <button type="button" class="btn-action-delete admin-action" onclick="deleteTanod(${tanod.id})">
                    <i class="fa-solid fa-trash"></i> Delete
                </button>
            </td>
        </tr>
    `;
    }).join('');
}

function updateUnassignedTanodBanner(tanods) {
    const banner = document.getElementById('unassignedTanodBanner');
    const text = document.getElementById('unassignedTanodText');
    if (!banner || !text) return;

    const unassignedCount = tanods.filter(t => !t.has_active_schedule).length;

    if (unassignedCount === 0) {
        banner.style.display = 'none';
        return;
    }

    banner.style.display = 'flex';
    text.textContent = `${unassignedCount} of ${tanods.length} tanod${tanods.length !== 1 ? 's' : ''} ${unassignedCount === 1 ? 'has' : 'have'} no active patrol assignment. Assign them via Patrol Decision Support → Schedules.`;
}

/* ============================================================
   SETUP USER FORM
============================================================ */

function setupForm() {
    const form = document.getElementById("userForm");
    if (!form) return;

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        addUser();
    });
}

/* ============================================================
   SETUP TANOD FORM
============================================================ */

function setupTanodForm() {
    const form = document.getElementById("tanodForm");
    if (!form) return;

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        addTanod();
    });
}

/* ============================================================
   TANOD TEAMS - lets a schedule assign a whole team at once
   (see frontend/patrol.js) instead of checking tanods one by one.
============================================================ */

async function loadTeams() {
    try {
        const response = await apiFetch('/tanod-teams');
        if (!response.ok) throw new Error('Failed to fetch teams');

        allTeams = await response.json();
        populateTeamDropdown();
        renderTeamChips();
    } catch (error) {
        console.error('Error loading tanod teams:', error);
        allTeams = [];
    }
}

function populateTeamDropdown() {
    const select = document.getElementById('tanodTeam');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '<option value="">No Team</option>' +
        allTeams.map(team => `<option value="${team.id}">${escapeHTML(team.name)}</option>`).join('');
    select.value = currentValue;
}

function renderTeamChips() {
    const list = document.getElementById('teamChipList');
    if (!list) return;

    if (allTeams.length === 0) {
        list.innerHTML = '<span style="font-size: 0.78rem; color: #94a3b8;">No teams yet - add one above.</span>';
        return;
    }

    list.innerHTML = allTeams.map(team => `
        <span style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; background: #e0e7ff; color: #4338ca; border-radius: 16px; font-size: 0.78rem; font-weight: 600;">
            ${escapeHTML(team.name)} (${team.member_count})
            <button type="button" onclick="deleteTeam(${team.id}, ${escapeHTML(JSON.stringify(team.name))})" style="background: none; border: none; color: #4338ca; cursor: pointer; padding: 0; display: flex; align-items: center;" title="Delete team">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </span>
    `).join('');
}

function setupTeamManagement() {
    const manageBtn = document.getElementById('manageTeamsBtn');
    const panel = document.getElementById('teamManagePanel');
    const addBtn = document.getElementById('addTeamBtn');
    const nameInput = document.getElementById('newTeamName');

    if (manageBtn && panel) {
        manageBtn.addEventListener('click', () => {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        });
    }

    if (addBtn && nameInput) {
        addBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) {
                showToast('Please enter a team name.', 'error');
                return;
            }
            try {
                const response = await apiFetch('/tanod-teams', {
                    method: 'POST',
                    body: JSON.stringify({ name })
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || 'Failed to add team');

                nameInput.value = '';
                await loadTeams();
                showToast('Team added successfully.', 'success');
            } catch (error) {
                showToast(error.message || 'Failed to add team.', 'error');
            }
        });
    }
}

window.deleteTeam = async function(id, name) {
    if (!confirm(`Delete "${name}"? Tanods on this team will become unassigned, not deleted.`)) return;

    try {
        const response = await apiFetch(`/tanod-teams/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to delete team');
        }
        await loadTeams();
        await loadTanods();
        showToast('Team deleted successfully.', 'success');
    } catch (error) {
        showToast(error.message || 'Failed to delete team.', 'error');
    }
};

/* ============================================================
   ADD USER
============================================================ */

async function addUser() {
    const nameInput = document.getElementById("userName");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const roleInput = document.getElementById("role");
    const emailInput = document.getElementById("userEmail");

    const name = nameInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const role = roleInput.value;
    const email = emailInput ? emailInput.value.trim() : '';

    if (!name || !username || !password || !role) {
        showToast("Please complete all required fields.", "error");
        return;
    }

    if (username.length < 3) {
        showToast("Username must contain at least 3 characters.", "error");
        usernameInput.focus();
        return;
    }

    if (password.length < 6) {
        showToast("Password must contain at least 6 characters.", "error");
        passwordInput.focus();
        return;
    }

    try {
        const response = await apiFetch('/users', {
            method: 'POST',
            body: JSON.stringify({
                name,
                username,
                password,
                role,
                contact_no: '',
                email
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to add user');
        }

        await loadUsers();
        document.getElementById("userForm").reset();
        showToast("User account added successfully.", "success");

    } catch (error) {
        console.error('Error adding user:', error);
        showToast(error.message || 'Failed to add user.', 'error');
    }
}

/* ============================================================
   ADD TANOD
============================================================ */

async function addTanod() {
    const id = document.getElementById('editTanodId').value;
    const name = document.getElementById('tanodName').value.trim();
    const position = document.getElementById('tanodPosition').value;
    const contact_no = document.getElementById('tanodContact').value.trim();
    const username = document.getElementById('tanodUsername').value.trim();
    const pin_code = document.getElementById('tanodPin').value.trim();
    const teamSelect = document.getElementById('tanodTeam').value;
    const team_id = teamSelect ? parseInt(teamSelect, 10) : null;

    if (!name || !username) {
        showToast('Please enter tanod name and username.', 'error');
        return;
    }

    if (!position) {
        showToast('Please select a position.', 'error');
        return;
    }

    if (!id && !pin_code) {
        showToast('Please set a 4-digit PIN for this tanod.', 'error');
        return;
    }

    if (pin_code && !/^\d{4}$/.test(pin_code)) {
        showToast('PIN must be exactly 4 digits.', 'error');
        return;
    }

    // Editing (id set) updates the existing record via PUT; adding
    // (id blank) creates a new one via POST — this was previously always
    // POST regardless, silently duplicating the record on every "edit".
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/tanods/${id}` : '/tanods';

    try {
        const response = await apiFetch(url, {
            method,
            body: JSON.stringify({
                name,
                position,
                contact_no,
                username,
                pin_code,
                team_id
            })
        });

        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to save tanod');
        }

        document.getElementById('tanodForm').reset();
        document.getElementById('editTanodId').value = '';
        document.getElementById('tanodFormTitle').textContent = 'Add New Tanod';
        document.getElementById('tanodSubmitBtn').innerHTML = '<i class="fa-solid fa-user-plus"></i> Add Tanod';
        document.getElementById('tanodPinHint').style.display = 'none';
        await loadTanods();
        showToast(id ? 'Tanod updated successfully!' : 'Tanod added successfully!', 'success');
    } catch (error) {
        console.error('Error saving tanod:', error);
        showToast(error.message || 'Failed to save tanod.', 'error');
    }
}

/* ============================================================
   EDIT TANOD
============================================================ */

window.editTanod = async function(id) {
    try {
        const response = await apiFetch(`/tanods/${id}`);
        if (!response.ok) throw new Error('Failed to fetch tanod');

        const tanod = await response.json();

        document.getElementById('editTanodId').value = tanod.id;
        document.getElementById('tanodName').value = tanod.name;
        // Records saved under a retired position (old "Tanod"/"Desk
        // Officer") match no option, so the select falls back to the
        // "Select position" placeholder and a current one must be picked.
        document.getElementById('tanodPosition').value = tanod.position || '';
        document.getElementById('tanodContact').value = tanod.contact_no || '';
        document.getElementById('tanodTeam').value = tanod.team_id || '';
        document.getElementById('tanodUsername').value = tanod.username || '';
        document.getElementById('tanodPin').value = '';
        document.getElementById('tanodPinHint').style.display = 'block';

        document.getElementById('tanodFormTitle').textContent = 'Edit Tanod';
        document.getElementById('tanodSubmitBtn').innerHTML = '<i class="fa-solid fa-pen"></i> Update Tanod';

        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        console.error('Error fetching tanod:', error);
        showToast('Failed to load tanod details.', 'error');
    }
};

/* ============================================================
   DELETE TANOD
============================================================ */

window.deleteTanod = async function(id) {
    const tanod = allTanods.find(t => t.id === id);
    if (!tanod) return;

    showDeleteModal(`Are you sure you want to deactivate tanod "${tanod.name}"?`, id, 'tanod');
};

window.confirmDeleteTanod = async function(id) {
    try {
        const response = await apiFetch(`/tanods/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete tanod');

        await loadTanods();
        showToast('Tanod deactivated successfully.', 'success');
    } catch (error) {
        console.error('Error deleting tanod:', error);
        showToast('Failed to delete tanod.', 'error');
    }
};

/* ============================================================
   RENDER USERS
============================================================ */

function renderUsers(filteredUsers = users) {
    const tableBody = document.getElementById("usersTableBody");
    const accountCount = document.getElementById("accountCount");

    if (!tableBody) return;

    tableBody.innerHTML = "";

    if (filteredUsers.length === 0) {
        tableBody.innerHTML = `
            <tr class="empty-row">
                <td colspan="6">
                    <div class="empty-content">
                        <i class="fa-solid fa-users-slash"></i>
                        <span>No users found.</span>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    filteredUsers.forEach(function (users) {
        const row = document.createElement("tr");
        
        let roleClass = 'role-badge role-field-user';
        let roleDisplay = users.role || 'User';
        
        if (users.role === 'Administrator') {
            roleClass = 'role-badge role-admin';
        } else if (users.role === 'Decision-Maker') {
            roleClass = 'role-badge role-decision-maker';
        } else if (users.role === 'Desk Officer') {
            roleClass = 'role-badge role-desk-officer';
        }

        row.innerHTML = `
            <td>
                <span class="font-bold" style="color: #0f172a;">${escapeHTML(users.name)}</span>
            </td>
            <td style="color: #475569;">${escapeHTML(users.username)}</td>
            <td>
                <span class="${roleClass}">
                    ${getRoleIcon(users.role)}
                    ${escapeHTML(roleDisplay)}
                </span>
            </td>
            <td class="email-cell" id="emailCell-${users.id}">
                <span class="email-display" style="color: #475569;">${escapeHTML(users.email || '—')}</span>
                <button type="button" class="btn-icon-circle btn-edit-email" title="Edit email" onclick="startEditEmail(${users.id}, ${escapeHTML(JSON.stringify(users.email || ''))})">
                    <i class="fa-solid fa-pen"></i>
                </button>
            </td>
            <td>
                <div class="password-cell">
                    <span class="password-text" title="Passwords are not retrievable">
                        ••••••••
                    </span>
                </div>
            </td>
            <td>
                <button type="button" class="btn-delete" data-delete-id="${users.id}">
                    <i class="fa-solid fa-trash"></i>
                    Delete
                </button>
            </td>
        `;

        tableBody.appendChild(row);
    });

    setupDeleteButtons();
}

/* ============================================================
   INLINE EDIT: USER EMAIL
   Scoped to just this one field since there's no general "edit user"
   endpoint yet - needed so an Administrator can set an email on
   existing accounts (the Add User form only covers new ones), which
   the forgot-password flow uses to actually send a reset code.
============================================================ */

function startEditEmail(userId, currentEmail) {
    const cell = document.getElementById(`emailCell-${userId}`);
    if (!cell) return;

    cell.innerHTML = `
        <input type="email" id="emailInput-${userId}" class="email-input" value="${escapeHTML(currentEmail)}" placeholder="name@gmail.com"
            onkeydown="if(event.key==='Enter'){saveEmail(${userId});} else if(event.key==='Escape'){renderUsers();}">
        <button type="button" class="btn-icon-circle btn-save-email" onclick="saveEmail(${userId})" title="Save">
            <i class="fa-solid fa-check"></i>
        </button>
        <button type="button" class="btn-icon-circle btn-cancel-email" onclick="renderUsers()" title="Cancel">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;

    const input = document.getElementById(`emailInput-${userId}`);
    if (input) input.focus();
}

async function saveEmail(userId) {
    const input = document.getElementById(`emailInput-${userId}`);
    if (!input) return;

    const email = input.value.trim();

    try {
        const response = await apiFetch(`/users/${userId}/email`, {
            method: 'PUT',
            body: JSON.stringify({ email })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to update email');

        const user = users.find(u => u.id === userId);
        if (user) user.email = email;

        renderUsers();
        showToast('Email updated.', 'success');
    } catch (error) {
        console.error('Error updating email:', error);
        showToast(error.message || 'Failed to update email.', 'error');
    }
}
window.startEditEmail = startEditEmail;
window.saveEmail = saveEmail;

function updateAccountCount() {
    const accountCount = document.getElementById("accountCount");
    if (accountCount) {
        const count = users.length;
        accountCount.textContent = `${count} account${count === 1 ? "" : "s"}`;
    }
}

/* ============================================================
   DELETE USER
============================================================ */

async function deleteUser(id) {
    const user = users.find(function (item) {
        return item.id === id;
    });

    if (!user) return;

    if (user.username.toLowerCase() === "admin") {
        showToast("The primary administrator account cannot be deleted.", "error");
        return;
    }

    showDeleteModal(`Are you sure you want to deactivate user "${user.name}"?`, id, 'user');
}

window.confirmDeleteUser = async function(id) {
    try {
        const response = await apiFetch(`/users/${id}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to delete user');
        }

        await loadUsers();
        showToast("User account deactivated successfully.", "success");

    } catch (error) {
        console.error('Error deleting user:', error);
        showToast(error.message || 'Failed to deactivate user.', 'error');
    }
};

function setupDeleteButtons() {
    const deleteButtons = document.querySelectorAll("[data-delete-id]");

    deleteButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            const id = Number(this.getAttribute("data-delete-id"));
            deleteUser(id);
        });
    });
}

/* ============================================================
   SEARCH
============================================================ */

function setupSearch() {
    const searchInput = document.getElementById("searchUsers");
    if (!searchInput) return;

    let searchTimeout;

    searchInput.addEventListener("input", function () {
        clearTimeout(searchTimeout);
        
        const searchTerm = this.value.trim();
        
        searchTimeout = setTimeout(async function() {
            try {
                if (!searchTerm) {
                    await loadUsers();
                    return;
                }

                const response = await apiFetch(`/users/search?q=${encodeURIComponent(searchTerm)}`);
                
                if (!response.ok) {
                    throw new Error('Search failed');
                }
                
                const results = await response.json();
                renderUsers(results);
                
            } catch (error) {
                console.error('Error searching:', error);
                showToast('Search failed.', 'error');
            }
        }, 300);
    });
}

/* ============================================================
   PASSWORD TOGGLE & VISIBILITY
============================================================ */

function setupPasswordToggle() {
    const passwordToggle = document.getElementById("passwordToggle");
    const passwordInput = document.getElementById("password");

    if (!passwordToggle || !passwordInput) return;

    passwordToggle.addEventListener("click", function () {
        if (passwordInput.type === "password") {
            passwordInput.type = "text";
            this.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
        } else {
            passwordInput.type = "password";
            this.innerHTML = '<i class="fa-solid fa-eye"></i>';
        }
    });
}


/* ============================================================
   NAVIGATION
============================================================ */

function setupNavigation() {
    const homeBtn = document.getElementById("homeBtn");
    if (homeBtn) {
        homeBtn.addEventListener("click", function () {
            window.location.href = "dashboard.html";
        });
    }
}

/* ============================================================
   RIPPLE EFFECT
============================================================ */

function setupRippleEffect() {
    const navItems = document.querySelectorAll(".nav-item");

    navItems.forEach(function (item) {
        item.addEventListener("click", function (event) {
            const ripple = document.createElement("span");
            ripple.classList.add("ripple");

            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = event.clientX - rect.left - size / 2;
            const y = event.clientY - rect.top - size / 2;

            ripple.style.width = `${size}px`;
            ripple.style.height = `${size}px`;
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;

            this.appendChild(ripple);

            setTimeout(function () {
                ripple.remove();
            }, 600);
        });
    });
}

/* ============================================================
   HELPERS
============================================================ */

function escapeHTML(value) {
    return String(value || '')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getRoleClass(role) {
    switch (role) {
        case "Administrator": return "admin";
        case "Decision-Maker": return "decision-maker";
        case "Desk Officer": return "desk-officer";
        default: return "field-user";
    }
}

function getRoleIcon(role) {
    switch (role) {
        case "Administrator": return '<i class="fa-solid fa-user-shield"></i>';
        case "Decision-Maker": return '<i class="fa-solid fa-user-tie"></i>';
        case "Desk Officer": return '<i class="fa-solid fa-headset"></i>';
        default: return '<i class="fa-solid fa-user"></i>';
    }
}

function showToast(message, type = "success") {
    const existingToast = document.querySelector(".toast");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.style.cssText = `
        position: fixed;
        right: 28px;
        bottom: 28px;
        min-width: 280px;
        max-width: 400px;
        padding: 14px 18px;
        border-radius: 10px;
        background-color: ${type === 'success' ? '#059669' : '#dc2626'};
        color: #ffffff;
        box-shadow: 0 10px 25px rgba(15, 23, 42, 0.25);
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 0.8rem;
        font-weight: 600;
        transform: translateY(30px);
        opacity: 0;
        pointer-events: none;
        transition: all 0.3s ease;
        z-index: 9999;
    `;

    const icon = type === "success" ? "fa-circle-check" : "fa-circle-exclamation";

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${escapeHTML(message)}</span>
    `;

    document.body.appendChild(toast);

    requestAnimationFrame(function () {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    });

    setTimeout(function () {
        toast.style.transform = 'translateY(30px)';
        toast.style.opacity = '0';
        setTimeout(function () {
            toast.remove();
        }, 300);
    }, 2500);
}

console.log('✅ users.js loaded successfully');