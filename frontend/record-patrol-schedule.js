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

window.populateActiveHeatmapRecords = function() {};

window.selectScheduleRecord = function(recordId, options = {}) {
    const record = activeScheduleRecords().find(item => Number(item.id) === Number(recordId));
    if (!record) return false;
    document.getElementById('scheduleRecordId').value = record.id;
    document.getElementById('scheduleLocation').value = record.street_name || '';
    document.getElementById('scheduleExactAddress').value = record.address || record.street_name || '';
    document.getElementById('scheduleLat').value = record.latitude ?? '';
    document.getElementById('scheduleLng').value = record.longitude ?? '';
    document.getElementById('schedulePriority').value = riskLevelFor(record);
    document.getElementById('scheduleRecordSummary').textContent =
        `${record.blotter_number || `Record #${record.id}`} · ${record.incident_type} · ${riskLevelFor(record)} risk · ${record.reason || 'Active heatmap record'}`;
    if (!options.keepSources) window.setSelectedPatrolSourceIds?.([record.id]);
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
    const response = await apiFetch('/patrol-personnel');
    if (!response.ok) throw new Error('Could not load team-member roster');
    const roster = await response.json();
    const select = document.getElementById('scheduleTanods');
    select.replaceChildren();
    roster.filter(member => member.is_active).forEach(member => {
        const key = `${member.person_type}:${member.id}`;
        const label = document.createElement('label');
        label.className = 'schedule-personnel-check';
        const input = document.createElement('input');
        input.type = 'checkbox'; input.name = 'schedule-personnel'; input.value = key;
        input.checked = selected.some(item => String(item) === key || (member.person_type === 'Tanod' && Number(item) === Number(member.id)));
        const text = document.createElement('span'); text.textContent = `${member.name} (${member.person_type})`;
        label.append(input, text); select.append(label);
    });
};


async function loadSavedPatrolTeams() {
    const select = document.getElementById('scheduleSavedTeam');
    if (!select) return;
    const response = await apiFetch('/patrol-teams');
    if (!response.ok) return;
    const teams = await response.json();
     select.innerHTML = '<option value="">Choose a saved team</option>';
    teams.forEach(team => select.add(new Option(`${team.name} — ${team.leader_name || 'No leader'}`, team.id)));
    select.addEventListener('change', async event => {
        const team = teams.find(item => String(item.id) === event.target.value);
        if (!team) return;
        document.getElementById('scheduleTeamName').value = team.name || '';
        await window.loadScheduleTanods((team.assignments || []).map(person => `${person.person_type}:${person.person_id}`));
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const formCard = document.getElementById('scheduleFormCard');
    if (!isAdmin()) { formCard.hidden = true; return; }

    document.getElementById('scheduleDate').addEventListener('change', setScheduleDayFromDate);

    try {
        await window.loadScheduleTanods();
        await loadSavedPatrolTeams();
        window.populateActiveHeatmapRecords();
        const id = new URLSearchParams(window.location.search).get('record');
        if (!id || !/^\d+$/.test(id)) return;
        const response = await apiFetch('/incidents/' + id + '/patrol-prefill');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not prepare record patrol');
        if (data.record) {
            allIncidents = [
                data.record,
                ...allIncidents.filter(record => Number(record.id) !== Number(data.record.id))
            ];
        }
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
