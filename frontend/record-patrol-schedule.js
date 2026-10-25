"use strict";

function activeScheduleRecords() {
    const month = selectedPatrolMonth();
    return (window.getPatrolHeatmapRecords?.() || [])
        .filter(record => record.eligible !== false)
        .filter(record => !month || String(record.date || '').startsWith(month));
}

function riskLevelFor(record) {
    const score = Number(record.cart_score) || 0;
    if (score >= Number(patrolThresholds.level3 || 67)) return 'High';
    if (score >= Number(patrolThresholds.level2 || 34)) return 'Moderate';
    return 'Low';
}

function recommendedScheduleDate(record) {
    const now = new Date();
    const date = new Date(now);
    const [hour, minute] = String(record.time || '00:00').slice(0, 5).split(':').map(Number);
    if (Number.isFinite(hour) && (hour * 60 + minute) <= (now.getHours() * 60 + now.getMinutes())) date.setDate(date.getDate() + 1);
    return localPatrolDateKey(date);
}

function setScheduleDayFromDate() {
    const value = document.getElementById('scheduleDate')?.value;
    document.getElementById('scheduleDay').value = value
        ? new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
        : '';
}

window.populateActiveHeatmapRecords = function(selectedId = null) {
    const select = document.getElementById('scheduleRecordSelect');
    if (!select) return;
    const previous = selectedId ?? select.value;
    const records = activeScheduleRecords();
    select.replaceChildren(new Option(records.length ? 'Choose an active risk-map record' : 'No active heatmap records in this month', ''));
    records
        .sort((a, b) => (Number(b.cart_score) || 0) - (Number(a.cart_score) || 0))
        .forEach(record => {
            const level = riskLevelFor(record);
            const label = `${level} risk · ${record.blotter_number || `Record #${record.id}`} · ${record.incident_type} · ${record.street_name}`;
            select.add(new Option(label, record.id));
        });
    if (previous && [...select.options].some(option => option.value === String(previous))) select.value = String(previous);
};

window.selectScheduleRecord = function(recordId, options = {}) {
    const record = activeScheduleRecords().find(item => Number(item.id) === Number(recordId));
    if (!record) return false;
    document.getElementById('scheduleRecordSelect').value = String(record.id);
    document.getElementById('scheduleRecordId').value = record.id;
    document.getElementById('scheduleLocation').value = record.street_name || '';
    document.getElementById('scheduleExactAddress').value = record.address || record.street_name || '';
    document.getElementById('scheduleLat').value = record.latitude ?? '';
    document.getElementById('scheduleLng').value = record.longitude ?? '';
    document.getElementById('schedulePriority').value = riskLevelFor(record);
    document.getElementById('scheduleRecordSummary').textContent =
        `${record.blotter_number || `Record #${record.id}`} · ${record.incident_type} · ${riskLevelFor(record)} risk · ${record.reason || 'Active heatmap record'}`;
    if (!options.keepDate || !document.getElementById('scheduleDate').value) {
        document.getElementById('scheduleDate').value = recommendedScheduleDate(record);
        setScheduleDayFromDate();
    }
    if (!options.keepTime && record.time) document.getElementById('scheduleStart').value = String(record.time).slice(0, 5);
    if (!options.keepReason && !document.getElementById('scheduleReason').value) {
        document.getElementById('scheduleReason').value =
            (`Risk-map deployment for ${record.blotter_number || `record #${record.id}`}: ${record.incident_type}. ${record.recommended_action || record.reason || ''}`).slice(0, 1000);
    }
    return true;
};

window.loadScheduleTanods = async function(selected = []) {
    const response = await apiFetch('/tanods');
    if (!response.ok) throw new Error('Could not load team-member roster');
    const roster = await response.json();
    const select = document.getElementById('scheduleTanods');
    select.replaceChildren();
    roster.filter(member => member.is_active).forEach(member => {
        const option = new Option(member.name, member.id);
        option.selected = selected.includes(Number(member.id));
        select.add(option);
    });
};

async function loadSavedPatrolTeams() {
    const select = document.getElementById('scheduleSavedTeam');
    if (!select) return;
    const response = await apiFetch('/patrol-teams');
    if (!response.ok) return;
    const teams = await response.json();
    select.innerHTML = '<option value="">Choose a saved team (optional)</option>';
    teams.forEach(team => select.add(new Option(`${team.name} — ${team.leader_name || 'No leader'}`, team.id)));
    select.addEventListener('change', async event => {
        const team = teams.find(item => String(item.id) === event.target.value);
        if (!team) return;
        document.getElementById('scheduleTeamName').value = team.name || '';
        await window.loadScheduleTanods((team.tanods || []).map(tanod => Number(tanod.id)));
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const formCard = document.getElementById('scheduleFormCard');
    if (!isAdmin()) { formCard.hidden = true; return; }

    document.getElementById('scheduleDate').addEventListener('change', setScheduleDayFromDate);
    document.getElementById('scheduleRecordSelect').addEventListener('change', event => {
        if (!event.target.value) {
            document.getElementById('scheduleRecordId').value = '';
            document.getElementById('scheduleRecordSummary').textContent = '';
            document.getElementById('scheduleLocation').value = '';
            document.getElementById('scheduleExactAddress').value = '';
            return;
        }
        window.selectScheduleRecord(event.target.value);
    });

    document.getElementById('addTanodBtn').addEventListener('click', async () => {
        const input = document.getElementById('newTanodName');
        const name = input.value.trim();
        if (name.length < 2 || name.length > 100 || /[<>\x00-\x1F]/.test(name)) {
            showToast('Enter a valid member name (2–100 characters).', 'error');
            return;
        }
        try {
            const response = await apiFetch('/tanods', { method: 'POST', body: JSON.stringify({ name }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not add team member');
            const chosen = [...document.getElementById('scheduleTanods').selectedOptions].map(option => Number(option.value));
            await window.loadScheduleTanods([...chosen, result.id]);
            input.value = '';
            showToast(`${name} added to the active roster.`, 'success');
        } catch (error) { showToast(error.message, 'error'); }
    });

    try {
        await window.loadScheduleTanods();
        await loadSavedPatrolTeams();
        window.populateActiveHeatmapRecords();
        const id = new URLSearchParams(window.location.search).get('record');
        if (!id || !/^\d+$/.test(id)) return;
        const response = await apiFetch('/incidents/' + id + '/patrol-prefill');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not prepare record patrol');
        if (data.record?.date) {
            document.getElementById('monthSelect').value = String(data.record.date).slice(0, 10);
            updateDashboardWithCartData(selectedPatrolMonth());
        }
        resetScheduleFormState();
        window.populateActiveHeatmapRecords(id);
        if (!window.selectScheduleRecord(id)) {
            showToast('Could not select the requested active heatmap record.', 'error');
            return;
        }
        openScheduleModal();
        history.replaceState(null, '', 'patrol.html');
    } catch (error) { showToast(error.message, 'error'); }
});
