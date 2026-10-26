"use strict";
let map;
let allIncidentsData = [], visibleIncidents = [];
let mapThresholds = { level2: 34, level3: 67 };
let mapRefreshBusy = false;
let mapLayersReady = false;
let basemapWarning = '';
const mapEl = id => document.getElementById(id);
const { INCIDENT_CATEGORIES, filterIncidents, getMondayOfWeek, calculatePointKPIs } = window.HeatmapAnalytics;
const MAP_PAGE = '1';
const targetLocation = typeof window !== 'undefined' && window.location
    ? new URLSearchParams(window.location.search || '').get('location') || ''
    : '';
let targetLocationOpened = false;

function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function periodRequestValue() {
    const granularity = mapEl('heatmapGranularity').value;
    const value = mapEl('heatmapPeriod').value || localDateKey();
    if (granularity === 'month') return `${value.slice(0, 7)}-01`;
    return granularity === 'week' ? getMondayOfWeek(value) : value;
}

function periodLabel() {
    const granularity = mapEl('heatmapGranularity').value;
    const selected = new Date(periodRequestValue() + 'T00:00:00');
    if (granularity === 'day') return selected.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    if (granularity === 'month') return selected.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const end = new Date(selected); end.setDate(end.getDate() + 6);
    return `${selected.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function configureCalendar(preserveDate = true) {
    const input = mapEl('heatmapPeriod');
    input.type = 'date';
    if (!preserveDate || !input.value) input.value = localDateKey();
    input.setAttribute('aria-label', mapEl('heatmapGranularity').value === 'month'
        ? 'Choose a date in the month'
        : mapEl('heatmapGranularity').value === 'week'
            ? 'Choose a date in the week'
            : 'Choose a date');
}

function stepPeriod(direction) {
    const granularity = mapEl('heatmapGranularity').value;
    const date = new Date(periodRequestValue() + 'T00:00:00');
    if (granularity === 'month') date.setMonth(date.getMonth() + direction);
    else date.setDate(date.getDate() + direction * (granularity === 'week' ? 7 : 1));
    mapEl('heatmapPeriod').value = localDateKey(date);
    loadRealData();
}

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
        basemapWarning = 'Basemap tiles are unavailable. Please check the network connection.';
        mapEl('mapLoadStatus').textContent = basemapWarning;
        console.error(event.error || event);
    });
}
async function loadRealData() {
    if (mapRefreshBusy) return;
    mapRefreshBusy = true;
    try {
        const query = targetLocation
            ? { window_days: 'all', location: targetLocation, limit: '1000' }
            : { granularity: mapEl('heatmapGranularity').value, period: periodRequestValue(), page: MAP_PAGE };
        const response = await apiFetch('/heatmap/records?' + new URLSearchParams(query));
        if (!response.ok) throw new Error('Unable to load map records');
        const data = await response.json();
        mapThresholds = data.thresholds;
        allIncidentsData = data.records.filter(row => isInsideBoundary(Number(row.latitude), Number(row.longitude)));
        if (mapLayersReady) for (const layer of ['incidents-glow', 'incidents-circle']) map.setPaintProperty(layer, 'circle-color', scoreColors());
        mapEl('highCellDescription').textContent = targetLocation ? `All active records at ${targetLocation}.` : 'High-risk locations in the selected period.';
        const hasAdditionalPages = Number(data.pagination?.totalPages) > 1;
        mapEl('mapLoadStatus').textContent = hasAdditionalPages
            ? `Map updated for ${periodLabel()}. Showing the first page only; additional records are not displayed.`
            : basemapWarning || `Map updated for ${periodLabel()}.`;
        applyFilterAndRender();
        if (targetLocation && !targetLocationOpened && allIncidentsData.length) {
            targetLocationOpened = true;
            const first = allIncidentsData[0];
            if (map?.flyTo) map.flyTo({ center: [Number(first.longitude), Number(first.latitude)], zoom: 16 });
            openRecordGroup(allIncidentsData);
        }
    } catch (error) {
        mapEl('mapLoadStatus').textContent = 'Could not refresh records. Please check the server connection.';
        console.error(error);
    } finally { mapRefreshBusy = false; }
}
function applyFilterAndRender() {
    visibleIncidents = filterIncidents(allIncidentsData, {
        granularity: 'all',
        category: mapEl('heatmapIncidentType').value,
        riskLevel: mapEl('heatmapRiskLevel').value
    });
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
}
document.addEventListener('DOMContentLoaded', () => {
    if (!getCurrentUser()) { window.location.href = 'login.html'; return; }
    applyRoleBasedUI();
    Object.keys(INCIDENT_CATEGORIES).forEach(category => mapEl('heatmapIncidentType').add(new Option(category, category)));
    configureCalendar(false);
    mapEl('heatmapIncidentType').addEventListener('change', applyFilterAndRender);
    mapEl('heatmapRiskLevel').addEventListener('change', applyFilterAndRender);
    mapEl('heatmapPeriod').addEventListener('change', loadRealData);
    mapEl('heatmapGranularity').addEventListener('change', () => { configureCalendar(); loadRealData(); });
    mapEl('heatmapPreviousPeriod').addEventListener('click', () => stepPeriod(-1));
    mapEl('heatmapNextPeriod').addEventListener('click', () => stepPeriod(1));
    initializeMap();
    loadRealData();
    startLivePolling(loadRealData, 15000);
});
