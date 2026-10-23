"use strict";
window.loadScheduleTanods = async function(selected = []) {
    const response = await apiFetch('/tanods');
    if (!response.ok) throw new Error('Could not load tanod roster');
    const roster = await response.json();
    const select = document.getElementById('scheduleTanods');
    select.replaceChildren();
    roster.filter(tanod => tanod.is_active).forEach(tanod => {
        const option = new Option(tanod.name, tanod.id);
        option.selected = selected.includes(Number(tanod.id));
        select.add(option);
    });
};

document.addEventListener('DOMContentLoaded', async () => {
    const formCard = document.getElementById('scheduleFormCard');
    if (!isAdmin()) { formCard.hidden = true; return; }
    const dateInput = document.getElementById('scheduleDate');
    dateInput.addEventListener('change', () => {
        if (dateInput.value) document.getElementById('scheduleDay').value = new Date(dateInput.value + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    });
    document.getElementById('addTanodBtn').addEventListener('click', async () => {
        const input = document.getElementById('newTanodName');
        const name = input.value.trim();
        if (name.length < 2 || name.length > 100 || /[<>\x00-\x1F]/.test(name)) { showToast('Enter a valid tanod name (2–100 characters).', 'error'); return; }
        try {
            const response = await apiFetch('/tanods', { method: 'POST', body: JSON.stringify({ name }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not add tanod');
            const chosen = [...document.getElementById('scheduleTanods').selectedOptions].map(option => Number(option.value));
            await window.loadScheduleTanods([...chosen, result.id]);
            input.value = '';
        } catch (error) { showToast(error.message, 'error'); }
    });
    try {
        await window.loadScheduleTanods();
        const id = new URLSearchParams(window.location.search).get('record');
        if (!id || !/^\d+$/.test(id)) return;
        const response = await apiFetch('/incidents/' + id + '/patrol-prefill');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not prepare record patrol');
        const record = data.record;
        resetScheduleFormState();
        document.getElementById('scheduleRecordId').value = record.id;
        document.getElementById('scheduleRecordSummary').textContent = record.blotter_number + ' · ' + record.incident_type + ' · CART ' + record.cart_score + ' · ' + record.reason;
        document.getElementById('scheduleLocation').value = record.street_name;
        document.getElementById('scheduleExactAddress').value = record.address || record.street_name;
        document.getElementById('scheduleDate').value = data.scheduled_date;
        document.getElementById('schedulePriority').value = data.priority;
        dateInput.dispatchEvent(new Event('change'));
        document.getElementById('scheduleReason').value = ('Record ' + record.blotter_number + ': ' + record.incident_type + '. ' + (record.patrol_notes || record.recommended_action || '')).slice(0, 1000);
        document.getElementById('scheduleStart').value = record.time ? record.time.slice(0,5) : '';
        document.getElementById('manualPatrolLabel').hidden = Boolean(record.eligible);
        document.getElementById('scheduleManualPatrol').checked = false;
        updateScheduleLocationIncidents();
        openScheduleModal();
        if (!scheduleMapPicker) initScheduleMapPicker();
        document.getElementById('scheduleLat').value = record.latitude;
        document.getElementById('scheduleLng').value = record.longitude;
        if (scheduleMapPicker) placeScheduleMarker(Number(record.latitude), Number(record.longitude));
        history.replaceState(null, '', 'patrol.html');
    } catch (error) { showToast(error.message, 'error'); }
});
