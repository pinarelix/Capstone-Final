"use strict";

const logPage = { rows: [], searchTimer: null };
const $ = id => document.getElementById(id);
const esc = value => typeof escapeHTML === 'function' ? escapeHTML(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const statusClass = status => `status-${String(status || '').toLowerCase()}`;

function openModal(id) { $(id).hidden = false; document.body.classList.add('scheduler-modal-open'); }
function closeModal(id) { $(id).hidden = true; if (![...document.querySelectorAll('.scheduler-modal')].some(node => !node.hidden)) document.body.classList.remove('scheduler-modal-open'); }

function visibleLogs() {
    const status = $('logStatusFilter').value;
    return status ? logPage.rows.filter(row => row.status === status) : logPage.rows;
}

function renderLogs() {
    const rows = visibleLogs();
    $('logCount').textContent = `${rows.length} ${rows.length === 1 ? 'log' : 'logs'}`;
    $('routeLogTableBody').innerHTML = rows.length ? rows.map(row => `<tr>
        <td>${esc(String(row.patrol_date || '').slice(0, 10))}</td><td><strong>${esc(row.route_name || 'Patrol route')}</strong></td><td>${esc(row.shift || '—')}</td>
        <td>${esc(row.team_name || 'Unassigned')}</td><td><span class="badge-subtle ${statusClass(row.status)}">${esc(row.status)}</span></td>
        <td class="log-report-cell">${esc(row.report || '—')}</td><td><button class="btn btn-secondary" type="button" data-view-log="${row.id}">View</button></td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty-state">No patrol logs match these filters.</td></tr>';
    $('routeLogTableBody').querySelectorAll('[data-view-log]').forEach(button => button.addEventListener('click', () => viewLog(button.dataset.viewLog)));
}

async function loadLogs() {
    $('logLoadStatus').textContent = 'Loading patrol logs…';
    const search = $('logSearch').value.trim();
    const response = await apiFetch(`/patrol-route-logs?limit=100&search=${encodeURIComponent(search)}`);
    if (!response.ok) { $('logLoadStatus').textContent = 'Could not load patrol logs.'; return; }
    logPage.rows = await response.json();
    renderLogs();
    $('logLoadStatus').textContent = logPage.rows.length === 100 ? 'Showing the latest 100 matching records.' : `Loaded ${logPage.rows.length} matching records.`;
}

async function viewLog(id) {
    const response = await apiFetch(`/patrol-route-logs/${id}`);
    if (!response.ok) { if (typeof showToast === 'function') showToast('Could not load this patrol log.', 'error'); return; }
    const row = await response.json();
    $('logDetailsTitle').textContent = row.route_name || 'Patrol log details';
    const fields = [
        ['Patrol date', String(row.patrol_date || '').slice(0, 10)], ['Schedule', `${row.shift || '—'} block`],
        ['Team', row.team_name || 'Unassigned'], ['Outcome', row.status || '—'], ['Report', row.report || 'No report recorded.']
    ];
    $('logDetails').innerHTML = fields.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
    openModal('logDetailsModal');
}

function setupEvents() {
    $('logSearch').addEventListener('input', () => { clearTimeout(logPage.searchTimer); logPage.searchTimer = setTimeout(loadLogs, 250); });
    $('logStatusFilter').addEventListener('change', renderLogs);
    $('refreshLogsBtn').addEventListener('click', loadLogs);
    $('closeLogDetailsBtn').addEventListener('click', () => closeModal('logDetailsModal'));
    $('doneLogDetailsBtn').addEventListener('click', () => closeModal('logDetailsModal'));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('.scheduler-modal:not([hidden])').forEach(node => closeModal(node.id)); });
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!getCurrentUser()) { window.location.href = 'login.html'; return; }
    applyRoleBasedUI(); setupEvents(); await loadLogs(); startLivePolling(loadLogs, 30000);
});
