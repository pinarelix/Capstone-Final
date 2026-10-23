"use strict";
let map;
let allIncidentsData = [], visibleIncidents = [];
let mapThresholds = { level2: 34, level3: 67 };
let mapRefreshBusy = false;
let mapLayersReady = false;
let basemapWarning = '';
let mapRecordPage = 1;
let mapPageInfo = {page:1,totalPages:1};
const mapEl = id => document.getElementById(id);
const { INCIDENT_CATEGORIES, filterIncidents, getMondayOfWeek, calculatePointKPIs } = window.HeatmapAnalytics;

function isInsideBoundary(lat, lng) {
    return window.BarangayGeometry.contains(lat, lng);
}
function scoreColors() {
    return ['step', ['get', 'cart_score'], '#10b981', Number(mapThresholds.level2), '#f59e0b', Number(mapThresholds.level3), '#ef4444'];
}
function initializeMap() {
    try { map = createMapboxMap('map'); }
    catch (error) { basemapWarning = error.message; mapEl('mapLoadStatus').textContent = basemapWarning; return; }
    // style.load does not wait for external raster tiles. Record data and
    // overlays must remain available when the basemap network is slow.
    map.on('style.load', () => {
        map.addSource('incidents', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'incidents-glow', type: 'circle', source: 'incidents', paint: {
            'circle-color': scoreColors(), 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 17, 17, 36, 19, 48],
            'circle-blur': .85, 'circle-opacity': .55
        } });
        map.addLayer({ id: 'incidents-circle', type: 'circle', source: 'incidents', paint: {
            'circle-color': scoreColors(), 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5
        } });
        map.on('click', event => {
            const hits = map.queryRenderedFeatures([[event.point.x - 12, event.point.y - 12], [event.point.x + 12, event.point.y + 12]], { layers: ['incidents-glow', 'incidents-circle'] });
            const ids = new Set(hits.map(hit => Number(hit.properties.id)));
            const group = visibleIncidents.filter(row => ids.has(Number(row.id)));
            if (group.length) openRecordGroup(group);
        });
        map.on('mouseenter', 'incidents-glow', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'incidents-glow', () => { map.getCanvas().style.cursor = ''; });
        mapLayersReady = true;
        for (const layer of ['incidents-glow','incidents-circle']) map.setPaintProperty(layer, 'circle-color', scoreColors());
        applyFilterAndRender();
    });
    map.on('error', event => {
        basemapWarning = 'Basemap tiles are unavailable; record highlights and the record list remain usable.';
        mapEl('mapLoadStatus').textContent = basemapWarning;
        console.error(event.error || event);
    });
}
async function loadRealData() {
    if (mapRefreshBusy) return;
    mapRefreshBusy = true;
    try {
        const days = mapEl('mapWindowDays')?.value || '90';
        const response = await apiFetch('/heatmap/records?' + new URLSearchParams({window_days:days, page:mapRecordPage, limit:500}));
        if (!response.ok) throw new Error('Unable to load map records');
        const data = await response.json();
        mapThresholds = data.thresholds;
        mapPageInfo = data.pagination || {page:1,totalPages:1};
        mapEl('mapPreviousPage').disabled = mapRecordPage <= 1;
        mapEl('mapNextPage').disabled = mapRecordPage >= mapPageInfo.totalPages;
        allIncidentsData = data.records.filter(row => isInsideBoundary(Number(row.latitude), Number(row.longitude)));
        if (mapLayersReady) for (const layer of ['incidents-glow', 'incidents-circle']) map.setPaintProperty(layer, 'circle-color', scoreColors());
        mapEl('legendHigh').textContent = 'High: score ≥ ' + mapThresholds.level3;
        mapEl('legendModerate').textContent = 'Moderate: ' + mapThresholds.level2 + ' to < ' + mapThresholds.level3;
        mapEl('legendLow').textContent = 'Low: score < ' + mapThresholds.level2;
        mapEl('highCellDescription').textContent = 'Cells with average CART score ≥ ' + mapThresholds.level3 + '.';
        const synthetic = allIncidentsData.filter(row => row.data_origin === 'synthetic').length;
        mapEl('mapLoadStatus').textContent = allIncidentsData.length + ' patrol-eligible records on page ' + mapRecordPage + ' of ' + Math.max(1,mapPageInfo.totalPages) +
            (days === 'all' ? ' (all dates).' : ' (last ' + days + ' days).') + ' Map KPIs describe this page, not the entire database. Colors follow current CART thresholds. ' +
            (synthetic ? synthetic + ' are SYNTHETIC TEST records. ' : '') + basemapWarning;
        populateHeatmapPeriodOptions();
        applyFilterAndRender();
    } catch (error) {
        mapEl('mapLoadStatus').textContent = 'Could not refresh records. Please check the server connection.';
        console.error(error);
    } finally { mapRefreshBusy = false; }
}
function populateHeatmapPeriodOptions() {
    const granularity = mapEl('heatmapGranularity').value;
    const select = mapEl('heatmapPeriod'), previous = select.value;
    select.replaceChildren();
    mapEl('heatmapPeriodChip').style.display = granularity === 'all' ? 'none' : '';
    if (granularity === 'all') return;
    const keys = new Set(allIncidentsData.filter(row => row.date).map(row => granularity === 'week' ? getMondayOfWeek(row.date) : granularity === 'month' ? row.date.slice(0, 7) : row.date));
    [...keys].sort().reverse().forEach(key => select.add(new Option(granularity === 'week' ? 'Week of ' + key : key, key)));
    if (!keys.size) select.add(new Option('No records', ''));
    if (keys.has(previous)) select.value = previous;
}
function applyFilterAndRender() {
    visibleIncidents = filterIncidents(allIncidentsData, { granularity: mapEl('heatmapGranularity').value,
        period: mapEl('heatmapPeriod').value, category: mapEl('heatmapIncidentType').value });
    const features = visibleIncidents.slice().sort((a, b) => a.cart_score - b.cart_score).map(row => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)] },
        properties: { id: row.id, cart_score: Number(row.cart_score) }
    }));
    if (mapLayersReady) map.getSource('incidents')?.setData({ type: 'FeatureCollection', features });
    const kpi = calculatePointKPIs(visibleIncidents, mapThresholds);
    mapEl('kpi-incidents').textContent = kpi.totalIncidents;
    mapEl('kpi-cells').textContent = kpi.activeCells;
    mapEl('kpi-peak').textContent = kpi.peakCount;
    mapEl('kpi-high').textContent = kpi.highRiskCells;
    mapEl('kpi-hotspot').textContent = visibleIncidents.filter(row => Number(row.active_patrol_count) > 0).length + ' records have active patrol schedules';
    renderRecordBrowser();
}
function renderRecordBrowser() {
    const list = mapEl('mapRecordList');
    const previous = [...list.querySelectorAll('[role=option]')].find(option => option.getAttribute('aria-selected') === 'true');
    const focused = list.contains(document.activeElement), scrollTop = list.scrollTop;
    const rows = visibleIncidents.slice().sort((a, b) => b.cart_score - a.cart_score || a.id - b.id);
    const selected = rows.find(row => String(row.id) === previous?.dataset.id) || rows[0];
    list.replaceChildren();
    mapEl('mapRecordCount').textContent = rows.length + (rows.length === 1 ? ' record' : ' records');
    mapEl('mapRecordEmpty').hidden = rows.length > 0;
    rows.forEach(row => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'record-map-option'; button.dataset.id = String(row.id);
        button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(row.id === selected.id));
        button.tabIndex = row.id === selected.id ? 0 : -1;
        button.textContent = row.blotter_number + ' · CART ' + Number(row.cart_score).toFixed(2) + ' · ' + row.incident_type;
        const address = document.createElement('small');
        address.textContent = (row.form_type === 'crime' ? 'Incident' : 'Blotter') + ' · ' + (row.address || row.street_name || 'Address not recorded');
        button.append(address);
        button.addEventListener('click', () => { selectBrowserRecord(button); openRecordGroup(rows, row.id); });
        button.addEventListener('keydown', event => {
            if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
            const options = [...list.querySelectorAll('[role=option]')], index = options.indexOf(button);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            event.preventDefault(); selectBrowserRecord(options[next]); options[next].focus();
        });
        list.append(button);
    });
    list.scrollTop = scrollTop;
    if (focused) [...list.querySelectorAll('[role=option]')].find(option => option.tabIndex === 0)?.focus();
}
function selectBrowserRecord(selected) {
    mapEl('mapRecordList').querySelectorAll('[role=option]').forEach(option => {
        option.setAttribute('aria-selected', String(option === selected)); option.tabIndex = option === selected ? 0 : -1;
    });
}
document.addEventListener('DOMContentLoaded', () => {
    if (!getCurrentUser()) { window.location.href = 'login.html'; return; }
    applyRoleBasedUI();
    mapEl('mapWindowDays').addEventListener('change', () => { mapRecordPage = 1; loadRealData(); });
    mapEl('mapPreviousPage').addEventListener('click', () => { if(mapRecordPage>1){mapRecordPage--;loadRealData();} });
    mapEl('mapNextPage').addEventListener('click', () => { if(mapRecordPage<mapPageInfo.totalPages){mapRecordPage++;loadRealData();} });
    Object.keys(INCIDENT_CATEGORIES).forEach(category => mapEl('heatmapIncidentType').add(new Option(category, category)));
    mapEl('heatmapIncidentType').addEventListener('change', applyFilterAndRender);
    mapEl('heatmapPeriod').addEventListener('change', applyFilterAndRender);
    mapEl('heatmapGranularity').addEventListener('change', () => { mapEl('heatmapPeriod').value = ''; populateHeatmapPeriodOptions(); applyFilterAndRender(); });
    initializeMap();
    loadRealData();
    startLivePolling(loadRealData, 15000);
});
