"use strict";

const plannedState = { routes: [] };
const $ = id => document.getElementById(id);
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const esc = value => typeof escapeHTML === 'function' ? escapeHTML(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const statusClass = status => `status-${String(status || 'draft').toLowerCase()}`;

function openModal(id) { $(id).hidden = false; document.body.classList.add('scheduler-modal-open'); }
function closeModal(id) { $(id).hidden = true; if (![...document.querySelectorAll('.scheduler-modal')].some(node => !node.hidden)) document.body.classList.remove('scheduler-modal-open'); }
function allDeployments() { return plannedState.routes.flatMap(route => (route.deployments || []).map(deployment => ({ ...deployment, route }))).filter(item => !['Completed', 'Cancelled'].includes(item.status)); }

function renderPlannedRoutes() {
    const query = $('plannedSearch').value.trim().toLowerCase(); const status = $('plannedStatusFilter').value;
    const deployments = allDeployments().filter(item => (!status || item.status === status)
        && [item.route.route_name, item.display_team_name, item.team_name, item.shift, item.status].join(' ').toLowerCase().includes(query));
    $('plannedCount').textContent = `${deployments.length} ${deployments.length === 1 ? 'deployment' : 'deployments'}`;
    $('plannedRouteList').innerHTML = deployments.length ? deployments.map(item => `<article class="deployment-card">
        <div class="deployment-card-head"><div><strong>${esc(item.route.route_name)}</strong><small>${esc(item.scheduled_date)} · ${esc(item.display_team_name || item.team_name || 'Unassigned')}</small></div><span class="deployment-meta"><span class="${statusClass(item.status)}">${esc(item.status)}</span><span>${esc(item.shift)}</span></span></div>
        <div class="route-stops-summary">${item.route.route_stops?.length || 0} stops · ${item.route.route_stops?.map(stop => esc(stop.location)).join(' → ')}</div>
        <div class="deployment-actions"><a class="btn btn-secondary admin-action" href="patrol.html?date=${encodeURIComponent(item.scheduled_date)}&edit_route=${item.route.id}&deployment=${item.id}"><i class="fa-solid fa-pen"></i> ${item.status === 'Draft' ? 'Edit draft' : 'Edit route'}</a><button class="btn btn-primary admin-action" type="button" data-log-deployment="${item.id}" data-log-id="${item.log_id || ''}" data-date="${esc(item.scheduled_date)}"><i class="fa-solid fa-clipboard-check"></i> ${item.log_id ? 'Edit log' : 'Record log'}</button></div>
    </article>`).join('') : '<p class="empty-state">No deployments match this date and filter.</p>';
    $('plannedRouteList').querySelectorAll('[data-log-deployment]').forEach(button => button.addEventListener('click', () => openLogEditor(Number(button.dataset.logDeployment), button.dataset.date, Number(button.dataset.logId) || null)));
    if (typeof applyRoleBasedUI === 'function') applyRoleBasedUI();
}

async function loadPlannedRoutes() {
    const date = $('plannedRouteDate').value || todayKey(); $('plannedRouteDate').value = date;
    $('plannedRouteStatus').textContent = 'Loading planned routes…';
    const response = await apiFetch(`/patrol-route-planner?date=${encodeURIComponent(date)}`);
    if (!response.ok) { $('plannedRouteStatus').textContent = 'Could not load planned routes.'; return; }
    const data = await response.json(); plannedState.routes = (data.routes || []).filter(route => route.id);
    renderPlannedRoutes(); $('plannedRouteStatus').textContent = `Showing deployments scheduled for ${date}.`;
}

function setFormStatus(text, error = false) { $('logFormStatus').textContent = text; $('logFormStatus').className = `form-status${error ? ' error' : ' success'}`; }
async function openLogEditor(deploymentId, date, logId = null) {
    $('logId').value = logId || ''; $('logDeploymentId').value = deploymentId; $('logPatrolDate').value = date; $('logStatus').value = 'Completed'; $('logReport').value = ''; setFormStatus('');
    $('logModalTitle').textContent = logId ? 'Edit patrol outcome' : 'Record patrol outcome';
    openModal('logModal');
    if (logId) {
        const response = await apiFetch(`/patrol-route-logs/${logId}`);
        if (!response.ok) { setFormStatus('Could not load this patrol log.', true); return; }
        const log = await response.json(); $('logPatrolDate').value = String(log.patrol_date || date).slice(0, 10); $('logStatus').value = log.status; $('logReport').value = log.report || '';
    }
}
async function saveLog(event) {
    event.preventDefault();
    const logId = Number($('logId').value) || null;
    const response = await apiFetch(logId ? `/patrol-route-logs/${logId}` : '/patrol-route-logs', { method: logId ? 'PUT' : 'POST', body: JSON.stringify({ deployment_id: Number($('logDeploymentId').value), patrol_date: $('logPatrolDate').value, status: $('logStatus').value, report: $('logReport').value.trim() }) });
    if (!response.ok) { const error = await response.json().catch(() => ({})); setFormStatus(error.error || 'Could not save log.', true); return; }
    closeModal('logModal'); await loadPlannedRoutes(); showToast('Patrol log saved.', 'success');
}

function setupEvents() {
    const params = new URLSearchParams(window.location.search); $('plannedRouteDate').value = params.get('date') || todayKey();
    $('plannedRouteDate').addEventListener('change', loadPlannedRoutes); $('refreshPlannedBtn').addEventListener('click', loadPlannedRoutes);
    $('plannedSearch').addEventListener('input', renderPlannedRoutes); $('plannedStatusFilter').addEventListener('change', renderPlannedRoutes);
    $('cancelLogBtn').addEventListener('click', () => closeModal('logModal')); $('closeLogModalBtn').addEventListener('click', () => closeModal('logModal')); $('routeLogForm').addEventListener('submit', saveLog);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('.scheduler-modal:not([hidden])').forEach(node => closeModal(node.id)); });
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!getCurrentUser()) { window.location.href = 'login.html'; return; }
    applyRoleBasedUI(); setupEvents(); await loadPlannedRoutes(); startLivePolling(loadPlannedRoutes, 30000);
});
