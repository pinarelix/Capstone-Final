"use strict";
let selectedMapRecord, lastMapFocus, detailRequest = 0;
let mapRecordTypes = [];

function openRecordGroup(rows, selectedId) {
    if (!rows.length) return;
    lastMapFocus = document.activeElement;
    const group = rows.slice().sort((a, b) => b.cart_score - a.cart_score || a.id - b.id);
    document.body.classList.add('record-map-open');
    mapEl('mapRecordModal').hidden = false;
    mapEl('mapRecordListbox').replaceChildren();
    group.forEach(row => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'record-map-option'; button.setAttribute('role', 'option'); button.dataset.id = row.id;
        button.tabIndex = -1;
        button.setAttribute('aria-selected', 'false');
        button.textContent = row.blotter_number + ' · CART ' + Number(row.cart_score).toFixed(2);
        const subtitle = document.createElement('small');
        subtitle.textContent = row.incident_type + ' · ' + (row.address || row.street_name);
        button.append(subtitle); button.addEventListener('click', () => showMapRecord(row.id));
        mapEl('mapRecordListbox').append(button);
    });
    mapEl('closeMapRecord').focus();
    showMapRecord(group.find(row => Number(row.id) === Number(selectedId))?.id || group[0].id);
}
function mapSection(title, fields) {
    return '<fieldset class="record-map-section"><legend>' + escapeHTML(title) + '</legend><div class="record-map-grid">' + fields.join('') + '</div></fieldset>';
}
function mapPersonDetails(record) {
    const name = prefix => [record[prefix + '_first'], record[prefix + '_middle'], record[prefix + '_last']].filter(Boolean).join(' ');
    // reporter_name is the staff account that encoded the record, NOT the
    // incident reporter. Never relabel complainants/respondents as reporters.
    const people = record.form_type === 'crime' ? [
        ['Reporter', name('reporter') || record.reported_by_name],
        ['Reporter address', record.reporter_address], ['Reporter contact', record.reporter_contact]
    ] : [
        ['Complainant', name('complainant') || record.reported_by_name],
        ['Complainant contact', record.complainant_contact],
        ['Respondent', name('respondent') || record.respondent_name],
        ['Respondent address', record.respondent_address]
    ];
    return '<fieldset class="record-map-section"><legend>' + (record.form_type === 'crime' ? 'Reporter information' : 'Parties involved') +
        '</legend><dl class="record-map-people">' + people.map(([label, value]) => '<div><dt>' + label + '</dt><dd>' + escapeHTML(value || 'Not recorded') + '</dd></div>').join('') +
        (record.reporter_name ? '<div><dt>Encoded by</dt><dd>' + escapeHTML(record.reporter_name) + '</dd></div>' : '') + '</dl></fieldset>';
}
function mapInput(id, label, value, options = {}) {
    const attrs = 'id="' + id + '" ' + (isAdmin() ? '' : 'disabled');
    let control;
    if (options.values) control = '<select ' + attrs + '>' + options.values.map(option => '<option value="' + escapeHTML(option) + '" ' + (option === value ? 'selected' : '') + '>' + escapeHTML(option) + '</option>').join('') + '</select>';
    else if (options.textarea) control = '<textarea ' + attrs + ' maxlength="' + (options.max || 255) + '" rows="3">' + escapeHTML(value || '') + '</textarea>';
    else control = '<input ' + attrs + ' type="' + (options.type || 'text') + '" maxlength="' + (options.max || 255) + '" value="' + escapeHTML(String(value ?? '')) + '" ' + (options.type === 'number' ? 'step="any"' : '') + '>';
    return '<div class="' + (options.wide ? 'wide' : '') + '"><label for="' + id + '">' + escapeHTML(label) + '</label>' + control +
        (id === 'mapNotes' ? '<small id="mapNotesCount" class="record-map-field-help">' + String((value || '').length) + ' / 200 characters</small>' : '') + '</div>';
}
async function showMapRecord(id) {
    const requestNumber = ++detailRequest;
    mapEl('mapRecordDetail').textContent = 'Loading record…';
    try {
        const response = await apiFetch('/incidents/' + encodeURIComponent(id));
        if (!response.ok) throw new Error('Could not load record');
        const detail = await response.json();
        if (requestNumber !== detailRequest) return;
        selectedMapRecord = { ...detail, ...allIncidentsData.find(row => Number(row.id) === Number(id)) };
        const record = selectedMapRecord;
        const syntheticLabel = record.data_origin === 'synthetic' ? '<p class="record-map-synthetic"><strong>SYNTHETIC TEST RECORD</strong> — fictional event and people.</p>' : '';
        mapEl('mapRecordListbox').querySelectorAll('[role=option]').forEach(button => {
            const selected = Number(button.dataset.id) === Number(id);
            button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
        });
        const typeOptions = mapRecordTypes.filter(type => (type.record_class || type.class) === (record.form_type === 'crime' ? 'incident' : 'blotter')).map(type => type.type_name || type.name);
        if (!typeOptions.includes(record.incident_type)) typeOptions.unshift(record.incident_type);
        const linked = (detail.linked_patrols || []).map(schedule => (schedule.scheduled_date || schedule.day_of_week) + ': ' + schedule.status + ' · ' + (schedule.assigned_tanods || 'No tanods assigned')).join('\n');
        const incidentFields = [
            mapInput('mapType', 'Record type', record.incident_type, { values: typeOptions }),
            mapInput('mapSeverity', 'Severity', record.severity, { values: ['Low','Medium','High'] }),
            mapInput('mapDate', 'Incident date', record.date?.slice(0,10), { type: 'date' }),
            mapInput('mapTime', 'Incident time', record.time?.slice(0,5), { type: 'time' }),
            mapInput('mapStatus', 'Case status', record.status, { values: ['Open','Monitoring','Resolved'] })
        ];
        const locationFields = [
            mapInput('mapStreet', 'Street / location', record.street_name, { values: typeof BARANGAY_LOCATIONS !== 'undefined' ? BARANGAY_LOCATIONS : [record.street_name] }),
            mapInput('mapAddress', 'Exact address (house, block, lot, unit)', record.address, { wide: true }),
            ...(record.form_type === 'blotter' ? [
                mapInput('mapBlock', 'Block', record.addr_block, { max: 50 }),
                mapInput('mapLot', 'Lot', record.addr_lot, { max: 50 }),
                mapInput('mapHouse', 'House number', record.addr_house_no, { max: 50 }),
                mapInput('mapUnit', 'Unit', record.addr_unit, { max: 50 })
            ] : []),
            mapInput('mapLat', 'Latitude', record.latitude, { type: 'number' }),
            mapInput('mapLng', 'Longitude', record.longitude, { type: 'number' })
        ];
        const narrativeFields = [
            mapInput('mapDescription', 'Salaysay / description', record.description, { wide: true, textarea: true, max: 2000 }),
            mapInput('mapAction', 'Recommended action', record.recommended_action, { wide: true, textarea: true, max: 1000 })
        ];
        const patrolFields = [
            mapInput('mapNotes', 'Patrol notes (maximum 200 characters)', record.patrol_notes, { wide: true, textarea: true, max: 200 }),
            mapInput('mapOverride', 'Patrol eligibility: auto / manual include / no patrol', record.patrol_override, { values: ['auto','include','exclude'], wide: true })
        ];
        mapEl('mapRecordDetail').innerHTML = syntheticLabel + '<div class="record-map-summary"><div class="record-map-identity"><h3>' + escapeHTML(record.blotter_number || '') + '</h3><span class="record-map-badge">' + (record.form_type === 'crime' ? 'Incident' : 'Blotter') + '</span></div>' +
            '<div class="record-map-score"><span>CART score</span><strong>' + Number(record.cart_score || 0).toFixed(2) + '</strong><span class="record-map-badge">' + escapeHTML(window.HeatmapAnalytics.getSeverityLabel(Number(record.cart_score || 0), mapThresholds)) + ' priority</span></div>' +
            '<p>' + escapeHTML(record.address || record.street_name || 'Address not recorded') + '</p></div>' +
            '<form id="mapRecordForm">' + mapSection('Incident details', incidentFields) + mapSection('Incident location', locationFields) + mapPersonDetails(record) +
            mapSection('Description and recommended action', narrativeFields) + mapSection('Patrol notes and eligibility', patrolFields) +
            '<fieldset class="record-map-section"><legend>Linked patrol schedules</legend><div class="record-map-linked">' + escapeHTML(linked || 'No linked patrol schedules') + '</div></fieldset>' +
            '<div class="record-map-actions" ' + (isAdmin() ? '' : 'hidden') +
            '><button class="btn btn-primary" type="submit">Save changes</button><button class="btn btn-secondary" id="mapSchedulePatrol" type="button">Add to patrol schedule</button></div>' +
            '<div id="mapRecordStatus" class="record-map-status" role="status"></div></form>';
        mapEl('mapNotes').setAttribute('aria-describedby', 'mapNotesCount');
        mapEl('mapNotes').addEventListener('input', () => { mapEl('mapNotesCount').textContent = mapEl('mapNotes').value.length + ' / 200 characters'; });
        if (record.form_type === 'blotter') {
            mapEl('mapAddress').readOnly = true;
            const compose = () => {
                const parts = [['mapBlock','Blk '],['mapLot','Lot '],['mapHouse','House No. '],['mapUnit','Unit ']]
                    .filter(([id]) => mapEl(id).value.trim()).map(([id,prefix]) => prefix + mapEl(id).value.trim());
                parts.push(mapEl('mapStreet').value);
                mapEl('mapAddress').value = parts.join(', ');
            };
            for (const field of ['mapBlock','mapLot','mapHouse','mapUnit','mapStreet']) mapEl(field).addEventListener('change', compose);
        }
        mapEl('mapRecordForm').addEventListener('submit', saveMapRecord);
        mapEl('mapSchedulePatrol').addEventListener('click', () => { window.location.href = 'patrol.html?record=' + encodeURIComponent(record.id); });
    } catch (error) { if (requestNumber === detailRequest) mapEl('mapRecordDetail').textContent = error.message; }
}
async function saveMapRecord(event) {
    event.preventDefault();
    if (!isAdmin() || !selectedMapRecord) return;
    const status = mapEl('mapRecordStatus'), notes = mapEl('mapNotes').value;
    if (!mapEl('mapLat').value.trim() || !mapEl('mapLng').value.trim() || !mapEl('mapDate').value || !mapEl('mapTime').value) {
        status.textContent = 'Incident date, time, latitude, and longitude are required.'; return;
    }
    if (notes.length > 200 || /[<>\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(notes)) { status.textContent = 'Notes must be plain text, at most 200 characters.'; return; }
    const payload = { incident_type: mapEl('mapType').value, severity: mapEl('mapSeverity').value,
        date: mapEl('mapDate').value, time: mapEl('mapTime').value, street_name: mapEl('mapStreet').value,
        address: mapEl('mapAddress').value, status: mapEl('mapStatus').value,
        latitude: Number(mapEl('mapLat').value), longitude: Number(mapEl('mapLng').value),
        description: mapEl('mapDescription').value, recommended_action: mapEl('mapAction').value,
        patrol_notes: notes, patrol_override: mapEl('mapOverride').value };
    if (selectedMapRecord.form_type === 'blotter') Object.assign(payload, {
        addr_block: mapEl('mapBlock').value, addr_lot: mapEl('mapLot').value,
        addr_house_no: mapEl('mapHouse').value, addr_unit: mapEl('mapUnit').value
    });
    const button = event.submitter; if (button) button.disabled = true;
    try {
        const response = await apiFetch('/incidents/' + selectedMapRecord.id + '/patrol-details', { method: 'PATCH', body: JSON.stringify(payload) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.details?.join('; ') || result.error || 'Save failed');
        const id = selectedMapRecord.id;
        await loadRealData(); await showMapRecord(id);
        mapEl('mapRecordStatus').textContent = 'Changes saved. The active map has been refreshed.';
    } catch (error) { status.textContent = error.message; }
    finally { if (button) button.disabled = false; }
}
function closeMapRecord() {
    detailRequest++; mapEl('mapRecordModal').hidden = true; document.body.classList.remove('record-map-open');
    if (lastMapFocus?.isConnected) lastMapFocus.focus();
    else mapEl('mapRecordList').querySelector('[tabindex="0"]')?.focus();
}
document.addEventListener('DOMContentLoaded', async () => {
    mapEl('mapRecordListbox').addEventListener('keydown', event => {
        if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
        const options = [...mapEl('mapRecordListbox').querySelectorAll('[role=option]')];
        const index = options.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
            Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
        event.preventDefault(); options[next]?.focus(); options[next]?.click();
    });
    mapEl('closeMapRecord').addEventListener('click', closeMapRecord);
    mapEl('mapRecordModal').addEventListener('click', event => { if (event.target === event.currentTarget) closeMapRecord(); });
    document.addEventListener('keydown', event => {
        if (mapEl('mapRecordModal').hidden) return;
        if (event.key === 'Escape') closeMapRecord();
        if (event.key === 'Tab') {
            const controls = [...mapEl('mapRecordModal').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')].filter(node => node.offsetParent !== null);
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
    });
    try { const response = await apiFetch('/record-types'); if (response.ok) mapRecordTypes = await response.json(); } catch { /* Current type remains available. */ }
});
