/* ============================================================
   USERS.JS
   Barangay 179 Crime BI
   User Management Module - Executive Officer Only + Audit
============================================================ */

// ✅ API_URL ay naka-define na sa apiHelper.js

// Global user data
let users = [];
let userPage = 1;
let userTotalPages = 1;
let userTotal = 0;
const USER_PAGE_SIZE = 10;

function usersUrl() {
    const search = document.getElementById('searchUsers')?.value.trim() || '';
    const role = document.getElementById('userRoleFilter')?.value || '';
    const path = search ? '/users/search' : '/users';
    return `${path}?${new URLSearchParams({
        page: userPage,
        limit: USER_PAGE_SIZE,
        ...(search ? { q: search } : {}),
        ...(role ? { role } : {})
    })}`;
}

function updateUserPagination(response) {
    userTotal = Number(response.headers.get('X-Total-Count')) || 0;
    userTotalPages = Math.max(1, Number(response.headers.get('X-Total-Pages')) || 1);
    const start = userTotal ? (userPage - 1) * USER_PAGE_SIZE + 1 : 0;
    const end = Math.min(userPage * USER_PAGE_SIZE, userTotal);
    const range = document.getElementById('userRangeText');
    if (range) range.textContent = userTotal ? `${start}–${end} of ${userTotal} users` : '0 users';
    const previous = document.getElementById('usersPrevious');
    const next = document.getElementById('usersNext');
    if (previous) previous.disabled = userPage <= 1;
    if (next) next.disabled = userPage >= userTotalPages;
}

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
        let roleDisplay = '<i class="fa-solid fa-chart-column"></i> Kagawad — View & Analytics Access';
        if (user?.role === 'Executive Officer') {
            roleDisplay = '<i class="fa-solid fa-crown"></i> Executive Officer — Full System Access';
        } else if (user?.role === 'Team Leader') {
            roleDisplay = '<i class="fa-solid fa-headset"></i> Team Leader — Records & Patrol Access';
        }
        roleEl.innerHTML = roleDisplay || 'User';
    }
    
    loadUsers();
    setupForm();
    setupAccountModals();
    setupSearch();
    setupPatrolTeamForms();
    setupManagementTabs();
    setupManagementQuickActions();
    loadPatrolTeamData();
    setupNavigation();
    setupPasswordToggle();
    setupRippleEffect();

    document.getElementById('usersPrevious')?.addEventListener('click', () => { if (userPage > 1) { userPage--; loadUsers(); } });
    document.getElementById('usersNext')?.addEventListener('click', () => { if (userPage < userTotalPages) { userPage++; loadUsers(); } });
    document.getElementById('userRoleFilter')?.addEventListener('change', () => { userPage = 1; loadUsers(); });

    startLivePolling(refreshUsersOnly, 15000);
    startLivePolling(loadPatrolTeamData, 15000);
});

/* ============================================================
   LOAD USERS FROM DATABASE
============================================================ */

async function loadUsers() {
    try {
        showLoadingState();
        
        const response = await apiFetch(usersUrl());
        
        if (!response.ok) {
            throw new Error('Failed to fetch users');
        }
        
        users = (await response.json()).map(user => ({ ...user, role: user.role === 'Deputy Officer' ? 'Executive Officer' : user.role }));
        updateUserPagination(response);
        if (userTotal > 0 && userPage > userTotalPages) {
            userPage = userTotalPages;
            await loadUsers();
            return;
        }
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
        const response = await apiFetch(usersUrl());
        if (!response.ok) return;

        users = (await response.json()).map(user => ({ ...user, role: user.role === 'Deputy Officer' ? 'Executive Officer' : user.role }));
        updateUserPagination(response);

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
   SETUP USER FORM
============================================================ */

function setupForm() {
    const form = document.getElementById("userForm");
    if (!form) return;

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        addUser();
    });

    function stripInvalid(input, regex) {
        input.addEventListener('input', function () {
            const cleaned = this.value.replace(regex, '');
            if (cleaned !== this.value) this.value = cleaned;
        });
    }
    stripInvalid(document.getElementById('userName'), /[^A-Za-z\s.\-']/g);
    stripInvalid(document.getElementById('username'), /[^A-Za-z0-9._]/g);

    const editName = document.getElementById('editUserName');
    const editUsername = document.getElementById('editUserUsername');
    if (editName) stripInvalid(editName, /[^A-Za-z\s.\-']/g);
    if (editUsername) stripInvalid(editUsername, /[^A-Za-z0-9._]/g);
}

let addUserReturnFocus = null;
function setupAccountModals() {
    const modal = document.getElementById('addUserModal');
    if (modal) document.body.appendChild(modal);
    const openButton = document.getElementById('addUserBtn');
    const closeButton = document.getElementById('closeAddUserBtn');
    const closeAdd = () => {
        if (!modal) return;
        modal.hidden = true;
        addUserReturnFocus?.focus();
    };
    openButton?.addEventListener('click', () => {
        addUserReturnFocus = openButton;
        document.getElementById('userForm')?.reset();
        modal.hidden = false;
        document.getElementById('userName')?.focus();
    });
    closeButton?.addEventListener('click', closeAdd);
    modal?.addEventListener('click', event => { if (event.target === modal) closeAdd(); });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (modal && !modal.hidden) closeAdd();
        const edit = document.getElementById('editUserModal');
        if (edit?.style.display === 'flex') edit.style.display = 'none';
    });
}

/* ============================================================
   ADD USER
============================================================ */

async function addUser() {
    const nameInput = document.getElementById("userName");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const roleInput = document.getElementById("role");
    const emailInput = document.getElementById("userEmail");

    const name = nameInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput?.value.trim() || '';
    const role = roleInput.value;
    const email = emailInput ? emailInput.value.trim() : '';

    if (!name || !username || !password || !role || !email) {
        showToast("Please complete all required fields.", "error");
        return;
    }
    if (password !== confirmPassword) {
        showToast('Password and confirmation must match.', 'error');
        confirmPasswordInput?.focus();
        return;
    }

    const nameRegex = /^[A-Za-z\s.\-']+$/;
    if (!nameRegex.test(name)) {
        showToast("Name must contain only letters, spaces, dots, hyphens and apostrophes.", "error");
        nameInput.focus();
        return;
    }

    const usernameRegex = /^[A-Za-z0-9._]+$/;
    if (!usernameRegex.test(username)) {
        showToast("Username must contain only letters, numbers, dots and underscores — no spaces.", "error");
        usernameInput.focus();
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showToast("Please enter a valid email address.", "error");
        emailInput.focus();
        return;
    }

    if (username.length < 3) {
        showToast("Username must contain at least 3 characters.", "error");
        usernameInput.focus();
        return;
    }

    if (password.length < 8) {
        showToast("Password must be at least 8 characters.", "error");
        passwordInput.focus();
        return;
    }
    if (password.length > 12) {
        showToast("Password must not exceed 12 characters.", "error");
        passwordInput.focus();
        return;
    }
    if (!/[A-Z]/.test(password)) {
        showToast("Password must contain at least one uppercase letter.", "error");
        passwordInput.focus();
        return;
    }
    if (!/[a-z]/.test(password)) {
        showToast("Password must contain at least one lowercase letter.", "error");
        passwordInput.focus();
        return;
    }
    if (!/[0-9]/.test(password)) {
        showToast("Password must contain at least one number.", "error");
        passwordInput.focus();
        return;
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        showToast("Password must contain at least one special character (e.g. !@#$%^&*).", "error");
        passwordInput.focus();
        return;
    }

    const saveBtn = document.getElementById('userSubmitBtn');
    const originalLabel = saveBtn?.innerHTML;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...'; }
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
        document.getElementById('addUserModal').hidden = true;
        showToast("User account added successfully.", "success");

    } catch (error) {
        console.error('Error adding user:', error);
        showToast(error.message || 'Failed to add user.', 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = originalLabel; }
    }
}

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
                        <td colspan="5">
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
        
        if (users.role === 'Executive Officer') {
            roleClass = 'role-badge role-admin';
        } else if (users.role === 'Kagawad') {
            roleClass = 'role-badge role-decision-maker';
        } else if (users.role === 'Team Leader') {
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
            <td><span class="status-pill ${users.is_active === false ? 'inactive' : 'active'}">${users.is_active === false ? 'Inactive' : 'Active'}</span></td>
            <td>
                <button type="button" class="btn-action-edit" onclick="openEditUserModal(${users.id})">
                    <i class="fa-solid fa-pen"></i> Edit
                </button>
            </td>
        `;

        const actionsCell = row.lastElementChild;
        if (actionsCell && users.username.toLowerCase() !== 'admin') actionsCell.insertAdjacentHTML('beforeend', ` <button type="button" class="btn-action-delete" onclick="deleteUser(${users.id})"><i class="fa-solid fa-user-slash"></i> Deactivate</button>`);
        tableBody.appendChild(row);
    });

    setupDeleteButtons();
}

/* ============================================================
   INLINE EDIT: USER EMAIL
   Scoped to just this one field since there's no general "edit user"
   endpoint yet - needed so the Executive Officer can set an email on
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

/* ============================================================
   EDIT USER MODAL
============================================================ */
function openEditUserModal(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    document.getElementById('editUserId').value = userId;
    document.getElementById('editUserName').value = user.name || '';
    document.getElementById('editUserUsername').value = user.username || '';
    document.getElementById('editUserRole').value = user.role || 'Team Leader';
    document.getElementById('editUserEmail').value = user.email || '';
    document.getElementById('editUserPassword').value = '';
    document.getElementById('editUserStatus').value = user.is_active === 0 ? '0' : '1';

    document.getElementById('editUserModal').style.display = 'flex';
}
window.openEditUserModal = openEditUserModal;

async function saveEditUser() {
    const id = document.getElementById('editUserId').value;
    const name = document.getElementById('editUserName').value.trim();
    const username = document.getElementById('editUserUsername').value.trim();
    const role = document.getElementById('editUserRole').value;
    const email = document.getElementById('editUserEmail').value.trim();
    const password = document.getElementById('editUserPassword').value;
    const is_active = document.getElementById('editUserStatus').value === '1';

    if (!name || !username || !role || !email) {
        showToast('Name, Username, Role, and Email are required.', 'error');
        return;
    }
    const nameRegex = /^[A-Za-z\s.\-']+$/;
    if (!nameRegex.test(name)) {
        showToast('Name must contain only letters, spaces, dots, hyphens and apostrophes.', 'error');
        return;
    }
    const usernameRegex = /^[A-Za-z0-9._]+$/;
    if (!usernameRegex.test(username)) {
        showToast('Username must contain only letters, numbers, dots and underscores — no spaces.', 'error');
        return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showToast('Please enter a valid email address.', 'error');
        return;
    }
    if (password && password.length < 8) {
        showToast('New password must be at least 8 characters.', 'error');
        return;
    }
    if (password && password.length > 12) {
        showToast('New password must not exceed 12 characters.', 'error');
        return;
    }
    if (password && !/[A-Z]/.test(password)) {
        showToast('New password must contain at least one uppercase letter.', 'error');
        return;
    }
    if (password && !/[a-z]/.test(password)) {
        showToast('New password must contain at least one lowercase letter.', 'error');
        return;
    }
    if (password && !/[0-9]/.test(password)) {
        showToast('New password must contain at least one number.', 'error');
        return;
    }
    if (password && !/[^A-Za-z0-9]/.test(password)) {
        showToast('New password must contain at least one special character (e.g. !@#$%^&*).', 'error');
        return;
    }

    const saveBtn = document.getElementById('editUserSaveBtn');
    const orig = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    try {
        const body = { name, username, role, email, is_active };
        if (password) body.password = password;

        const response = await apiFetch(`/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Failed to update user');

        showToast('User updated successfully.', 'success');
        document.getElementById('editUserModal').style.display = 'none';
        await loadUsers();
    } catch (error) {
        showToast(error.message || 'Failed to update user.', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = orig;
    }
}
window.saveEditUser = saveEditUser;

function updateAccountCount() {
    const accountCount = document.getElementById("accountCount");
    if (accountCount) {
        const count = userTotal;
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

    showDeleteModal(`Are you sure you want to deactivate user "${user.name}"? It will be moved to the Archive (Settings > Archive), where the Executive Officer can restore it.`, id, 'user');
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
        userPage = 1;
        
        searchTimeout = setTimeout(async function() {
            try {
                await loadUsers();
                
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

let patrolTeams = [];
let tanodRoster = [];
let volunteerRoster = [];
let teamLeaderRoster = [];

function setupManagementTabs() {
    const tabs = document.querySelectorAll('[data-management-tab]');
    const views = document.querySelectorAll('[data-management-view]');
    tabs.forEach(tab => tab.addEventListener('click', () => {
        const view = tab.dataset.managementTab;
        tabs.forEach(item => item.classList.toggle('active', item === tab));
        views.forEach(item => item.classList.toggle('active', item.dataset.managementView === view));
    }));
}

function setupManagementQuickActions() {
    document.getElementById('addPersonnelBtn')?.addEventListener('click', () => {
        document.getElementById('tanodName')?.focus();
        document.getElementById('tanodForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    document.getElementById('createPatrolTeamBtn')?.addEventListener('click', () => {
        document.getElementById('patrolTeamName')?.focus();
        document.getElementById('patrolTeamForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

async function loadPatrolTeamData() {
    const chosen = [...document.querySelectorAll('#patrolTeamTanods input:checked')].map(input => input.value);
    const endpoints = ['/patrol-teams', '/tanods', '/users-list', '/volunteers'];
    const results = await Promise.allSettled(endpoints.map(async endpoint => {
        const response = await apiFetch(endpoint);
        if (!response.ok) throw new Error('Could not load ' + endpoint.slice(1) + '. Check the database migration and try again.');
        return response.json();
    }));
    if (results[0].status === 'fulfilled') patrolTeams = results[0].value;
    if (results[1].status === 'fulfilled') tanodRoster = results[1].value.filter(person => Number(person.is_active) === 1);
    if (results[3].status === 'fulfilled') volunteerRoster = results[3].value.filter(person => Number(person.is_active) === 1);
    if (results[2].status === 'fulfilled') {
        teamLeaderRoster = results[2].value.filter(user => user.role === 'Team Leader');
        const select = document.getElementById('patrolTeamLeader');
        const selected = select.value;
        select.replaceChildren(new Option('Select a Team Leader account', ''));
        teamLeaderRoster.forEach(user => select.add(new Option(user.name, user.id)));
        select.value = selected;
    }
    renderTanodOptions(chosen);
    renderPatrolTeams();
    renderPersonnelRoster();
    const failure = results.find(result => result.status === 'rejected');
    if (failure) showToast(failure.reason.message, 'error');
}


// Checkbox-based picker: avoids Ctrl/Command multi-selection and keeps the
// authenticated Team Leader separate because the backend auto-includes that
// stable account identity in the saved four-person roster.
function renderTanodOptions(selected = []) {
    const picker = document.getElementById('patrolTeamTanods');
    if (!picker) return;
    const chosen = new Set(selected.map(item => typeof item === 'string' ? item : `Tanod:${item}`));
    const people = [...tanodRoster.map(person => ({ ...person, person_type: 'Tanod' })), ...volunteerRoster.map(person => ({ ...person, person_type: 'Volunteer' }))];
    picker.innerHTML = people.length
        ? people.map(person => `<label><input type="checkbox" name="patrol-team-person" value="${person.person_type}:${person.id}" ${chosen.has(`${person.person_type}:${person.id}`) ? 'checked' : ''}><span>${escapeHTML(person.name)} <small>(${person.person_type})${person.contact_no ? ` — ${escapeHTML(person.contact_no)}` : ''}</small></span></label>`).join('')
        : '<span class="text-muted">No active personnel in the roster yet</span>';
}

function renderPatrolTeams() {
    const list = document.getElementById('patrolTeamsList');
    const count = document.getElementById('patrolTeamCount');
    if (!list) return;
    if (count) count.textContent = `${patrolTeams.length} team${patrolTeams.length === 1 ? '' : 's'}`;
    if (!patrolTeams.length) {
        list.innerHTML = '<div class="patrol-teams-empty">No patrol teams created yet.</div>';
        return;
    }
    list.innerHTML = patrolTeams.map(team => `
        <article class="patrol-team-item">
            <h3>${escapeHTML(team.name)}</h3>
            <p><i class="fa-solid fa-user-shield"></i> Leader: <strong>${escapeHTML(team.leader_name || 'Not assigned')}</strong></p>
            <div class="team-member-list"><strong>${team.assignments?.length || team.tanods?.length || 0} personnel</strong><br>${team.assignments?.length ? team.assignments.map(person => `${escapeHTML(person.person_name)} <small>(${person.person_type}, ${person.assignment_type})</small>`).join('<br>') : team.tanods?.length ? team.tanods.map(tanod => escapeHTML(tanod.name)).join('<br>') : 'No personnel assigned'}</div>
            <button type="button" class="btn btn-secondary team-edit-btn" onclick="editPatrolTeam(${team.id})"><i class="fa-solid fa-pen"></i> Edit team</button>
        </article>
    `).join('');
}

function renderPersonnelRoster() {
    const list = document.getElementById('personnelList');
    const count = document.getElementById('personnelCount');
    const people = [
        ...tanodRoster.map(person => ({ ...person, person_type: 'Tanod' })),
        ...volunteerRoster.map(person => ({ ...person, person_type: 'Volunteer' })),
        ...teamLeaderRoster.map(person => ({ ...person, person_type: 'Team Leader', contact_no: person.email || person.contact_no }))
    ].sort((a, b) => a.name.localeCompare(b.name));
    if (count) count.textContent = `${people.length} personnel`;
    if (!list) return;
    list.innerHTML = people.length ? people.map(person => `<article class="personnel-item"><h3>${escapeHTML(person.name)}</h3><p><strong>${person.person_type}</strong></p><p>${escapeHTML(person.contact_no || 'No contact number')}</p><p>${escapeHTML(person.address || 'System account identity')}</p><div class="personnel-actions">${person.person_type === 'Team Leader' ? '<span class="text-muted">Managed in System Accounts</span>' : `<button type="button" class="btn btn-link" onclick="editPatrolPersonnel('${person.person_type}', ${person.id})">Edit</button><button type="button" class="btn btn-link danger" onclick="archivePatrolPersonnel('${person.person_type}', ${person.id})">Archive</button>`}</div></article>`).join('') : '<p class="empty-content">No personnel registered yet.</p>';
}

function setupPatrolTeamForms() {
    const teamForm = document.getElementById('patrolTeamForm');
    const tanodForm = document.getElementById('tanodForm');
    if (teamForm) teamForm.addEventListener('submit', savePatrolTeam);
    if (tanodForm) tanodForm.addEventListener('submit', addPatrolTanod);
    document.getElementById('volunteerForm')?.addEventListener('submit', addVolunteer);
    document.getElementById('tanodCancelBtn')?.addEventListener('click', () => resetPersonnelForm('Tanod'));
    document.getElementById('volunteerCancelBtn')?.addEventListener('click', () => resetPersonnelForm('Volunteer'));
    document.getElementById('patrolTeamCancelBtn')?.addEventListener('click', resetPatrolTeamForm);
}

async function addVolunteer(event) {
    event.preventDefault();
    const id = document.getElementById('volunteerId').value;
    const payload = {
        name: document.getElementById('volunteerName').value.trim(),
        contact_no: document.getElementById('volunteerContact').value.trim(),
        address: document.getElementById('volunteerAddress').value.trim(),
        birth_date: document.getElementById('volunteerBirthDate').value || null
    };
    if (!payload.name) return showToast('Enter the volunteer\'s full name.', 'error');
    try {
        const response = await apiFetch(id ? `/volunteers/${id}` : '/volunteers', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not add volunteer');
        resetPersonnelForm('Volunteer'); await loadPatrolTeamData(); showToast(id ? 'Volunteer updated.' : 'Volunteer added to the active roster.', 'success');
    } catch (error) { showToast(error.message, 'error'); }
}

async function addPatrolTanod(event) {
    event.preventDefault();
    const id = document.getElementById('tanodId').value;
    const payload = {
        name: document.getElementById('tanodName').value.trim(),
        contact_no: document.getElementById('tanodContact').value.trim(),
        address: document.getElementById('tanodAddress').value.trim(),
        birth_date: document.getElementById('tanodBirthDate').value || null
    };
    if (!payload.name) return showToast('Enter the Tanod’s full name.', 'error');
    try {
        const response = await apiFetch(id ? `/tanods/${id}` : '/tanods', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not add Tanod');
        resetPersonnelForm('Tanod');
        await loadPatrolTeamData();
        showToast(id ? 'Tanod updated.' : 'Tanod added to the active roster.', 'success');
    } catch (error) { showToast(error.message, 'error'); }
}

function resetPersonnelForm(kind) {
    const prefix = kind.toLowerCase();
    document.getElementById(`${prefix}Form`)?.reset();
    document.getElementById(`${prefix}Id`).value = '';
    document.getElementById(`${prefix}SubmitBtn`).innerHTML = `<i class="fa-solid fa-user-plus"></i> Add ${kind}`;
    document.getElementById(`${prefix}CancelBtn`).hidden = true;
}

window.editPatrolPersonnel = function(kind, id) {
    const roster = kind === 'Volunteer' ? volunteerRoster : tanodRoster;
    const person = roster.find(item => Number(item.id) === Number(id));
    if (!person) return;
    const prefix = kind.toLowerCase();
    document.getElementById(`${prefix}Id`).value = person.id;
    document.getElementById(`${prefix}Name`).value = person.name || '';
    document.getElementById(`${prefix}Contact`).value = person.contact_no || '';
    document.getElementById(`${prefix}Address`).value = person.address || '';
    document.getElementById(`${prefix}BirthDate`).value = person.birth_date ? String(person.birth_date).slice(0, 10) : '';
    document.getElementById(`${prefix}SubmitBtn`).innerHTML = '<i class="fa-solid fa-save"></i> Update ' + kind;
    document.getElementById(`${prefix}CancelBtn`).hidden = false;
    document.getElementById(`${prefix}Name`).focus();
};

window.archivePatrolPersonnel = async function(kind, id) {
    if (!confirm(`Archive this ${kind.toLowerCase()} from the active roster?`)) return;
    try {
        const response = await apiFetch(`/${kind === 'Volunteer' ? 'volunteers' : 'tanods'}/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Could not archive ${kind.toLowerCase()}`);
        await loadPatrolTeamData();
        showToast(`${kind} archived from the active roster.`, 'success');
    } catch (error) { showToast(error.message, 'error'); }
};

async function savePatrolTeam(event) {
    event.preventDefault();
    const id = document.getElementById('patrolTeamId').value;
    const payload = {
        name: document.getElementById('patrolTeamName').value.trim(),
        leader_user_id: Number(document.getElementById('patrolTeamLeader').value) || null,
        assignments: [...document.querySelectorAll('#patrolTeamTanods input[name="patrol-team-person"]:checked')].map(option => { const [person_type, id] = option.value.split(':'); return { person_type, person_id: Number(id), assignment_type: 'Primary' }; }),
        tanod_ids: [...document.querySelectorAll('#patrolTeamTanods input[name="patrol-team-person"]:checked')].filter(option => option.value.startsWith('Tanod:')).map(option => Number(option.value.split(':')[1])),
        is_active: document.getElementById('patrolTeamActive')?.checked !== false
    };
    if (!payload.name || !payload.leader_user_id) return showToast('Enter a team name and select one Team Leader.', 'error');
    if (payload.assignments.length > 3) return showToast('Select up to three personnel plus the Team Leader.', 'error');
    try {
        const response = await apiFetch(id ? `/patrol-teams/${id}` : '/patrol-teams', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not save patrol team');
        resetPatrolTeamForm();
        await loadPatrolTeamData();
        showToast(id ? 'Patrol team updated.' : 'Patrol team created.', 'success');
    } catch (error) { showToast(error.message, 'error'); }
}

function resetPatrolTeamForm() {
    document.getElementById('patrolTeamForm')?.reset();
    const id = document.getElementById('patrolTeamId');
    if (id) id.value = '';
    const button = document.getElementById('patrolTeamSubmitBtn');
    if (button) button.innerHTML = '<i class="fa-solid fa-people-group"></i> Save Patrol Team';
    const cancel = document.getElementById('patrolTeamCancelBtn');
    if (cancel) cancel.hidden = true;
    renderTanodOptions();
}

function editPatrolTeam(id) {
    const team = patrolTeams.find(item => Number(item.id) === Number(id));
    if (!team) return;
    document.getElementById('patrolTeamId').value = team.id;
    document.getElementById('patrolTeamName').value = team.name || '';
    document.getElementById('patrolTeamLeader').value = team.leader_user_id || '';
    document.getElementById('patrolTeamActive').checked = Boolean(team.is_active);
    renderTanodOptions((team.assignments || []).map(assignment => `${assignment.person_type}:${assignment.person_id}`));
    document.getElementById('patrolTeamSubmitBtn').innerHTML = '<i class="fa-solid fa-save"></i> Update Patrol Team';
    document.getElementById('patrolTeamCancelBtn').hidden = false;
    document.getElementById('patrolTeamName').focus();
}
window.editPatrolTeam = editPatrolTeam;

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
        case "Executive Officer": return "admin";
        case "Kagawad": return "decision-maker";
        case "Team Leader": return "desk-officer";
        default: return "field-user";
    }
}

function getRoleIcon(role) {
    switch (role) {
        case "Executive Officer": return '<i class="fa-solid fa-user-shield"></i>';
        case "Kagawad": return '<i class="fa-solid fa-user-tie"></i>';
        case "Team Leader": return '<i class="fa-solid fa-headset"></i>';
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
