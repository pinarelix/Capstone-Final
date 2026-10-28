"use strict";

const MIN_ROUTE_STOPS = 3;
const SUGGESTED_MAX_ROUTE_STOPS = 10;
const planner = { map: null, mapReady: false, records: [], routes: [], teams: [], selected: new Set(), routeStops: [], editingRoute: null, mapEditingRoute: null, mapEditingDeploymentId: null, previewRouteKey: null, suggestionRadius: 90, thresholds: { level2: 34, level3: 67 }, motionGeometry: null, motionTimer: null, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, editRouteHandled: false };
const $ = id => document.getElementById(id);
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const esc = value => typeof escapeHTML === 'function' ? escapeHTML(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function openModal(id) { $(id).hidden = false; document.body.classList.add('scheduler-modal-open'); }
function closeModal(id) { $(id).hidden = true; if (![...document.querySelectorAll('.scheduler-modal')].some(node => !node.hidden)) document.body.classList.remove('scheduler-modal-open'); }

function riskColorExpression() {
    return ['step', ['get', 'cart_score'], '#10b981', Number(planner.thresholds.level2), '#f59e0b', Number(planner.thresholds.level3), '#ef4444'];
}
function recordColorExpression() {
    return ['case', ['any', ['get', 'route_preview'], ['>', ['get', 'active_route_count'], 0]], '#7c3aed', ['get', 'selected'], '#38bdf8', riskColorExpression()];
}

function createRouteArrowImage() {
    const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 24;
    const context = canvas.getContext('2d'); context.clearRect(0, 0, 48, 24);
    context.strokeStyle = '#6d28d9'; context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round';
    [5, 17, 29].forEach(offset => { context.beginPath(); context.moveTo(offset, 3); context.lineTo(offset + 10, 12); context.lineTo(offset, 21); context.stroke(); });
    return context.getImageData(0, 0, 48, 24);
}

function initMap() {
    try { planner.map = createMapboxMap('patrolRouteMap'); }
    catch (error) { $('patrolMapStatus').textContent = error.message; return; }
    planner.map.on('style.load', () => {
        planner.map.addSource('patrol-records', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        planner.map.addSource('patrol-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        planner.map.addSource('patrol-route-motion', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        if (!planner.map.hasImage('patrol-route-arrow')) planner.map.addImage('patrol-route-arrow', createRouteArrowImage(), { pixelRatio: 2 });
        planner.map.addLayer({ id: 'patrol-heatmap', type: 'heatmap', source: 'patrol-records', maxzoom: 16, paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'cart_score'], 0, 0.15, 100, 1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 16, 1.8],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 11, 18, 16, 32],
            'heatmap-opacity': 0.55,
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(245,158,11,0)', 0.25, '#fbbf24', 0.55, '#f97316', 0.85, '#dc2626', 1, '#7f1d1d']
        } });
        planner.map.addLayer({ id: 'patrol-route-casing', type: 'line', source: 'patrol-routes', paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': .85 } });
        planner.map.addLayer({ id: 'patrol-route-lines', type: 'line', source: 'patrol-routes', paint: { 'line-color': '#7c3aed', 'line-width': 4, 'line-opacity': .82, 'line-dasharray': [1.5, 1] } });
        planner.map.addLayer({ id: 'patrol-route-arrows', type: 'symbol', source: 'patrol-route-motion', layout: {
            'icon-image': 'patrol-route-arrow', 'icon-size': 1.35, 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true, 'icon-ignore-placement': true
        }, paint: { 'icon-opacity': ['get', 'opacity'] } });
        planner.map.addLayer({ id: 'patrol-record-glow', type: 'circle', source: 'patrol-records', paint: {
            'circle-color': recordColorExpression(),
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 17, 17, 34, 19, 46], 'circle-blur': .82, 'circle-opacity': .58
        } });
        planner.map.addLayer({ id: 'patrol-record-circle', type: 'circle', source: 'patrol-records', paint: {
            'circle-color': recordColorExpression(),
            'circle-radius': ['case', ['get', 'selected'], 9, 7], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5
        } });
        planner.map.addLayer({ id: 'patrol-record-count', type: 'symbol', source: 'patrol-records', layout: {
            'text-field': ['case', ['>', ['get', 'additional_active_route_count'], 0], ['concat', '+', ['to-string', ['get', 'additional_active_route_count']]], ''],
            'text-offset': [1.2, 0], 'text-anchor': 'left', 'text-size': 12, 'text-allow-overlap': true
        }, paint: { 'text-color': '#1e3a8a', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
        planner.map.on('click', event => {
            const recordHit = planner.map.queryRenderedFeatures(event.point, { layers: ['patrol-record-circle'] })[0];
            if (recordHit) {
                if (!planner.mapEditingRoute && recordHit.properties.route_preview) { openDisplayedRouteEditor(); return; }
                const activeRouteId = Number(recordHit.properties.closest_active_route_id);
                if (!planner.mapEditingRoute && activeRouteId) {
                    planner.previewRouteKey = `saved:${activeRouteId}`;
                    const route = routeByKey(planner.previewRouteKey);
                    $('patrolMapStatus').textContent = route ? `Showing ${route.route_name}, the active route scheduled closest to today.` : 'Could not load this active route.';
                    renderPlanner(); renderMap(); return;
                }
                toggleRecord(Number(recordHit.properties.id)); renderPlanner(); renderMap(); return;
            }
            const routeHit = planner.map.queryRenderedFeatures(event.point, { layers: ['patrol-route-arrows', 'patrol-route-lines', 'patrol-route-casing'] })[0];
            if (routeHit && !planner.mapEditingRoute) openDisplayedRouteEditor();
        });
        planner.map.on('mouseenter', 'patrol-record-circle', () => planner.map.getCanvas().style.cursor = 'pointer');
        planner.map.on('mouseleave', 'patrol-record-circle', () => planner.map.getCanvas().style.cursor = '');
        for (const layer of ['patrol-route-arrows', 'patrol-route-lines', 'patrol-route-casing']) {
            planner.map.on('mouseenter', layer, () => planner.map.getCanvas().style.cursor = planner.mapEditingRoute ? 'crosshair' : 'pointer');
            planner.map.on('mouseleave', layer, () => planner.map.getCanvas().style.cursor = '');
        }
        planner.mapReady = true; startRouteMotion(); renderMap();
    });
}

function routeFeature(route) {
    const stopCoordinates = (route.route_stops || []).map(stop => [Number(stop.longitude), Number(stop.latitude)])
        .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude));
    if (stopCoordinates.length === 1) stopCoordinates.push([...stopCoordinates[0]]);
    if (stopCoordinates.length > 1) stopCoordinates.push([...stopCoordinates[0]]);
    const geometry = stopCoordinates.length ? { type: 'LineString', coordinates: stopCoordinates } : null;
    return geometry ? { type: 'Feature', geometry, properties: { id: route.id || `suggested-${route.route_name}`, status: route.status || 'Draft' } } : null;
}

function coordinateDistance(a, b) {
    const latitudeScale = Math.cos(((Number(a[1]) + Number(b[1])) / 2) * Math.PI / 180);
    return Math.hypot((Number(b[0]) - Number(a[0])) * latitudeScale, Number(b[1]) - Number(a[1]));
}

function pointAlongRoute(coordinates, progress) {
    const segments = []; let total = 0;
    for (let index = 0; index < coordinates.length - 1; index += 1) {
        const length = coordinateDistance(coordinates[index], coordinates[index + 1]);
        if (length > 0) { segments.push({ index, length }); total += length; }
    }
    if (!segments.length || !total) return null;
    let target = ((progress % 1) + 1) % 1 * total;
    for (const segment of segments) {
        if (target <= segment.length) {
            const start = coordinates[segment.index]; const end = coordinates[segment.index + 1]; const ratio = target / segment.length;
            const point = [start[0] + ((end[0] - start[0]) * ratio), start[1] + ((end[1] - start[1]) * ratio)];
            const bearing = Math.atan2(-(end[1] - start[1]), (end[0] - start[0]) * Math.cos(point[1] * Math.PI / 180)) * 180 / Math.PI;
            return { point, bearing };
        }
        target -= segment.length;
    }
    return null;
}

function renderRouteMotion(now = performance.now()) {
    if (!planner.mapReady) return;
    const coordinates = planner.motionGeometry?.coordinates || [];
    const progress = planner.reducedMotion ? 0 : (now % 4800) / 4800;
    const phases = [0, .25, .5, .75];
    const features = coordinates.length > 1 ? phases.map((phase, index) => {
        const position = pointAlongRoute(coordinates, progress + phase); if (!position) return null;
        const opacity = planner.reducedMotion ? .9 : .45 + (.55 * ((Math.sin((progress + phase) * Math.PI * 2) + 1) / 2));
        return { type: 'Feature', geometry: { type: 'Point', coordinates: position.point }, properties: { bearing: position.bearing, opacity, index } };
    }).filter(Boolean) : [];
    planner.map.getSource('patrol-route-motion')?.setData({ type: 'FeatureCollection', features });
}

function startRouteMotion() {
    clearInterval(planner.motionTimer); renderRouteMotion();
    if (!planner.reducedMotion) planner.motionTimer = setInterval(() => renderRouteMotion(), 60);
}

function routeKey(route) { return route.id ? `saved:${route.id}` : `suggested:${route.route_name}`; }
function routeByKey(key) { return planner.routes.find(route => routeKey(route) === key); }
function currentRouteDeploymentId(route) { return Number(route?.deployments?.[0]?.id) || null; }
function openDisplayedRouteEditor() {
    const route = routeByKey(planner.previewRouteKey);
    if (route) openRouteEditor(route, currentRouteDeploymentId(route));
}

function renderMap() {
    if (!planner.mapReady) return;
    const previewRoute = planner.previewRouteKey ? routeByKey(planner.previewRouteKey) : null;
    const previewIncidentIds = new Set((previewRoute?.route_stops || []).map(stop => Number(stop.incident_id || stop.id)));
    if (planner.mapEditingRoute) for (const id of planner.selected) previewIncidentIds.add(Number(id));
    const recordFeatures = planner.records.filter(record => Number.isFinite(Number(record.latitude)) && Number.isFinite(Number(record.longitude))).map(record => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [Number(record.longitude), Number(record.latitude)] },
        properties: { id: Number(record.id), cart_score: Number(record.cart_score || 0), active_route_count: Number(record.active_route_count || 0),
            additional_active_route_count: Math.max(0, Number(record.active_route_count || 0) - 1), closest_active_route_id: Number(record.closest_active_route_id || 0),
            selected: planner.selected.has(Number(record.id)), route_preview: previewIncidentIds.has(Number(record.id)) }
    }));
    const manualRoute = !previewRoute && planner.selected.size >= 2 ? { id: 'manual-selection', status: 'Draft', route_stops: selectedRecords() } : null;
    const visibleRoute = previewRoute || manualRoute;
    const routeFeatures = visibleRoute ? [routeFeature(visibleRoute)].filter(Boolean) : [];
    planner.motionGeometry = routeFeatures[0]?.geometry || null;
    planner.map.getSource('patrol-records')?.setData({ type: 'FeatureCollection', features: recordFeatures });
    planner.map.getSource('patrol-routes')?.setData({ type: 'FeatureCollection', features: routeFeatures });
    renderRouteMotion();
}

function toggleRecord(id) {
    const numeric = Number(id);
    if (planner.selected.has(numeric)) { planner.selected.delete(numeric); return; }
    planner.selected.add(numeric);
}
function selectedRecords() {
    const routeRecords = (planner.mapEditingRoute?.route_stops || []).map(stop => ({ ...stop, id: Number(stop.incident_id || stop.id), street_name: stop.location || stop.street_name }));
    const byId = new Map([...routeRecords, ...planner.records].map(record => [Number(record.id), record]));
    return [...planner.selected].map(id => byId.get(Number(id))).filter(Boolean);
}

function renderSelected() {
    const rows = selectedRecords();
    const editingOnMap = Boolean(planner.mapEditingRoute);
    $('selectedRecordCount').textContent = `${rows.length} selected`;
    $('kpiSelectedRecords').textContent = rows.length;
    $('newRouteFromSelectedBtn').disabled = rows.length < MIN_ROUTE_STOPS || (typeof isAdmin === 'function' && !isAdmin());
    $('newRouteFromSelectedBtn').innerHTML = editingOnMap ? '<i class="fa-solid fa-pen-to-square"></i> Update route' : '<i class="fa-solid fa-plus"></i> New route';
    $('clearSelectedBtn').textContent = editingOnMap ? 'Reset stops' : 'Clear';
    $('cancelMapRouteEditBtn').hidden = !editingOnMap;
    const remaining = Math.max(0, MIN_ROUTE_STOPS - rows.length);
    $('selectionHint').textContent = editingOnMap
        ? (remaining ? `Choose ${remaining} more incident ${remaining === 1 ? 'record' : 'records'} to update ${planner.mapEditingRoute.route_name}.` : `Editing ${planner.mapEditingRoute.route_name}. Click incidents to add or remove stops; the loop updates live.`)
        : (remaining ? `Click ${remaining} more incident ${remaining === 1 ? 'record' : 'records'} on the map to create a route.` : 'Ready. Select + New route to continue.');
    $('selectedRecordList').innerHTML = rows.length ? rows.map(record => `<div class="selected-record"><div><strong>${esc(record.incident_type || 'Record')}</strong><small>${esc(record.street_name || 'Unknown location')} · ${esc(record.address || 'Address not recorded')}</small></div><div class="selected-record-actions"><span class="record-risk">${Number(record.cart_score || 0).toFixed(0)}</span><button class="icon-btn" type="button" data-remove-selected="${Number(record.id)}" aria-label="Remove ${esc(record.incident_type || 'incident')} from route"><i class="fa-solid fa-xmark"></i></button></div></div>`).join('') : '<p class="empty-state">Click records on the map to begin.</p>';
    $('selectedRecordList').querySelectorAll('[data-remove-selected]').forEach(button => button.addEventListener('click', () => { planner.selected.delete(Number(button.dataset.removeSelected)); renderSelected(); renderMap(); }));
}

function routeCard(route, suggested = false) {
    const key = routeKey(route);
    const previewing = planner.previewRouteKey === key;
    return `<article class="route-suggestion${previewing ? ' is-map-selected' : ''}">
        <div class="route-suggestion-head"><div><strong>${esc(route.route_name || 'Patrol route')}</strong><small>${route.route_stops?.length || 0} stops · ${suggested ? `${planner.suggestionRadius}-meter connected incident suggestion` : esc(route.status || 'Draft')}</small></div><span class="record-risk">${route.route_stops?.length || 0}</span></div>
        <small>${route.route_stops?.slice(0, 3).map(stop => esc(stop.location)).join(' · ')}${(route.route_stops?.length || 0) > 3 ? ' · …' : ''}</small>
        <div class="route-suggestion-actions"><button class="btn ${previewing ? 'btn-primary' : 'btn-quiet'}" type="button" data-preview-route="${esc(key)}" aria-pressed="${previewing}"><i class="fa-solid fa-${previewing ? 'eye-slash' : 'route'}"></i> ${previewing ? 'Hide route' : 'Show route'}</button><button class="btn btn-secondary" type="button" data-edit-route="${route.id || ''}" data-suggested="${suggested ? '1' : '0'}">${suggested ? 'Edit suggestion' : 'Edit route'}</button>${route.id ? `<button class="btn btn-quiet" type="button" data-add-deployment="${route.id}">Add team</button>` : ''}</div>
    </article>`;
}

function renderRoutes() {
    const newSuggestions = planner.routes.filter(route => route.status === 'Suggested' && !route.id);
    const savedUnassigned = planner.routes.filter(route => route.id && route.status !== 'Cancelled' && !(route.deployments || []).length);
    const suggestions = [...newSuggestions, ...savedUnassigned];
    $('suggestedRouteCount').textContent = `${suggestions.length} routes`;
    $('kpiSuggestedRoutes').textContent = newSuggestions.length;
    $('suggestedRouteList').innerHTML = suggestions.length ? suggestions.map(route => routeCard(route, !route.id)).join('') : '<p class="empty-state">No new hotspot suggestions for this map.</p>';
    $('suggestedRouteList').querySelectorAll('[data-edit-route]').forEach(button => button.addEventListener('click', () => openRouteEditor(button.dataset.suggested === '1' ? planner.routes.find(route => !route.id && route.route_name === button.closest('.route-suggestion').querySelector('strong').textContent) : findRoute(button.dataset.editRoute))));
    $('suggestedRouteList').querySelectorAll('[data-add-deployment]').forEach(button => button.addEventListener('click', () => openRouteEditor(findRoute(button.dataset.addDeployment), null, true)));
    $('suggestedRouteList').querySelectorAll('[data-preview-route]').forEach(button => button.addEventListener('click', () => {
        planner.previewRouteKey = planner.previewRouteKey === button.dataset.previewRoute ? null : button.dataset.previewRoute;
        const route = routeByKey(planner.previewRouteKey);
        $('patrolMapStatus').textContent = route
            ? `Showing ${route.route_name}. The route is one continuous loop with one incoming and one outgoing connection per stop.`
            : 'Route hidden. Select Show route on a suggestion to preview it.';
        renderRoutes(); renderMap();
    }));
    const planned = allDeployments().filter(item => ['Suggested', 'Draft', 'Active'].includes(item.status) && item.scheduled_date >= todayKey());
    $('kpiPlannedDeployments').textContent = planned.length;
}

function findRoute(id) { return planner.routes.find(route => Number(route.id) === Number(id)); }
function allDeployments() { return planner.routes.flatMap(route => (route.deployments || []).map(deployment => ({ ...deployment, route }))); }

function renderStopEditor() {
    $('routeStopCount').textContent = `${planner.routeStops.length} stops`;
    $('routeStopList').innerHTML = planner.routeStops.map((stop, index) => `<div class="route-stop-row"><span class="route-stop-number">${index + 1}</span><div><strong>${esc(stop.incident_type || 'Record')} · ${esc(stop.location)}</strong><small>${esc(stop.address || 'Address not recorded')} · CART ${Number(stop.cart_score || 0).toFixed(0)}</small></div><div class="stop-actions"><button type="button" data-stop-up="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Move stop up"><i class="fa-solid fa-chevron-up"></i></button><button type="button" data-stop-down="${index}" ${index === planner.routeStops.length - 1 ? 'disabled' : ''} aria-label="Move stop down"><i class="fa-solid fa-chevron-down"></i></button><button type="button" data-stop-remove="${index}" aria-label="Remove stop"><i class="fa-solid fa-xmark"></i></button></div></div>`).join('');
    $('routeStopList').querySelectorAll('[data-stop-up]').forEach(button => button.addEventListener('click', () => moveStop(Number(button.dataset.stopUp), -1)));
    $('routeStopList').querySelectorAll('[data-stop-down]').forEach(button => button.addEventListener('click', () => moveStop(Number(button.dataset.stopDown), 1)));
    $('routeStopList').querySelectorAll('[data-stop-remove]').forEach(button => button.addEventListener('click', () => { planner.routeStops.splice(Number(button.dataset.stopRemove), 1); renderStopEditor(); }));
}
function moveStop(index, direction) { const target = index + direction; if (target < 0 || target >= planner.routeStops.length) return; [planner.routeStops[index], planner.routeStops[target]] = [planner.routeStops[target], planner.routeStops[index]]; renderStopEditor(); }

function openRouteEditor(route = null, deploymentId = null, addDeployment = false, stopsOverride = null) {
    planner.editingRoute = route;
    const deployment = addDeployment ? null : (deploymentId && route ? (route.deployments || []).find(item => Number(item.id) === Number(deploymentId)) : route?.deployments?.[0]);
    planner.routeStops = (stopsOverride || route?.route_stops || (route ? [] : selectedRecords())).map((stop, index) => ({
        ...stop, incident_id: Number(stop.incident_id || stop.id), stop_order: index + 1,
        location: stop.location || stop.street_name || 'Unknown location', address: stop.address || '',
        latitude: Number(stop.latitude), longitude: Number(stop.longitude)
    }));
    $('routeId').value = route?.id || '';
    $('deploymentId').value = deployment?.id || '';
    $('routeName').value = route?.route_name || `Patrol route ${new Date().toLocaleDateString()}`;
    $('routeDate').value = deployment?.scheduled_date ? String(deployment.scheduled_date).slice(0, 10) : (route?.suggested_for_date || $('routePlannerDate').value || todayKey());
    $('routeShift').value = deployment?.shift || 'AM';
    $('routeTeam').value = deployment?.team_id || '';
    $('routeStatus').value = route?.status === 'Suggested' ? 'Draft' : (route?.status || 'Draft');
    $('routeNotes').value = deployment?.notes || route?.notes || '';
    $('routeModalTitle').textContent = route?.id ? 'Edit patrol route' : 'Create patrol route';
    $('routeModalHelp').textContent = route?.source_type === 'Suggested'
        ? (route?.id ? `This saved suggested route may be manually expanded beyond ${SUGGESTED_MAX_ROUTE_STOPS} stops.` : `New suggested routes may contain ${MIN_ROUTE_STOPS} to ${SUGGESTED_MAX_ROUTE_STOPS} stops.`)
        : `Manual routes require at least ${MIN_ROUTE_STOPS} incidents and have no maximum.`;
    document.querySelector('.route-stop-editor .scheduler-card-head p').textContent = 'Reorder stops before saving. The direct point-to-point loop is recalculated automatically.';
    $('addStopsFromMapBtn').hidden = !route?.id || (typeof isAdmin === 'function' && !isAdmin());
    setFormStatus('routeFormStatus', '');
    renderStopEditor(); openModal('routeModal');
}

function seedMapEditingStops(route) {
    planner.selected = new Set((route?.route_stops || []).map(stop => Number(stop.incident_id || stop.id)).filter(Number.isFinite));
}

function startMapRouteEdit() {
    const route = planner.editingRoute;
    if (!route?.id) return;
    const deploymentId = Number($('deploymentId').value) || currentRouteDeploymentId(route);
    const draftDeployment = { id: deploymentId || undefined, scheduled_date: $('routeDate').value, shift: $('routeShift').value, team_id: Number($('routeTeam').value) || null, status: $('routeStatus').value, notes: $('routeNotes').value.trim() };
    const deployments = [...(route.deployments || [])];
    const deploymentIndex = deployments.findIndex(item => Number(item.id) === Number(deploymentId));
    if (deploymentIndex >= 0) deployments[deploymentIndex] = { ...deployments[deploymentIndex], ...draftDeployment };
    else deployments.unshift(draftDeployment);
    planner.mapEditingRoute = { ...route, route_name: $('routeName').value.trim(), suggested_for_date: $('routeDate').value, status: $('routeStatus').value, notes: $('routeNotes').value.trim(), route_stops: planner.routeStops.map(stop => ({ ...stop })), deployments };
    planner.mapEditingDeploymentId = deploymentId;
    seedMapEditingStops(planner.mapEditingRoute);
    planner.previewRouteKey = null;
    closeModal('routeModal'); renderPlanner(); renderMap();
    $('patrolMapStatus').textContent = `Editing ${route.route_name}. Click incident points to add or remove stops; the loop updates immediately.`;
}

function resetMapRouteStops() {
    if (!planner.mapEditingRoute) return;
    seedMapEditingStops(planner.mapEditingRoute); renderPlanner(); renderMap();
}

function cancelMapRouteEdit() {
    const route = planner.mapEditingRoute;
    planner.mapEditingRoute = null; planner.mapEditingDeploymentId = null; planner.selected.clear();
    if (route?.id) planner.previewRouteKey = `saved:${route.id}`;
    renderPlanner(); renderMap();
    $('patrolMapStatus').textContent = route ? `Showing ${route.route_name}. Route changes were discarded.` : 'Route editing cancelled.';
}

async function saveRoute(event) {
    event.preventDefault();
    const status = $('routeStatus').value;
    const teamId = Number($('routeTeam').value) || null;
    const deploymentId = Number($('deploymentId').value) || null;
    const id = $('routeId').value;
    const payload = { route_name: $('routeName').value.trim(), source_type: planner.editingRoute?.source_type === 'Suggested' ? 'Suggested' : 'Manual', status, suggested_for_date: $('routeDate').value, notes: $('routeNotes').value.trim(), route_stops: planner.routeStops.map((stop, index) => ({ ...stop, stop_order: index + 1 })), deployment: { id: deploymentId || undefined, scheduled_date: $('routeDate').value, shift: $('routeShift').value, team_id: teamId, status, notes: $('routeNotes').value.trim() } };
    if (payload.route_stops.length < MIN_ROUTE_STOPS || (!id && payload.source_type === 'Suggested' && payload.route_stops.length > SUGGESTED_MAX_ROUTE_STOPS)) { setFormStatus('routeFormStatus', `Choose at least ${MIN_ROUTE_STOPS} incidents. New suggested routes may contain at most ${SUGGESTED_MAX_ROUTE_STOPS} stops.`, true); return; }
    if (!teamId) { setFormStatus('routeFormStatus', 'Choose a saved patrol team before scheduling this route.', true); return; }
    const response = await apiFetch(id ? `/patrol-routes/${id}` : '/patrol-routes', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    if (!response.ok) { const error = await response.json().catch(() => ({})); setFormStatus('routeFormStatus', error.error || 'Could not save route.', true); return; }
    const saved = await response.json(); const savedRouteId = Number(saved.route?.id);
    planner.selected.clear(); planner.mapEditingRoute = null; planner.mapEditingDeploymentId = null; closeModal('routeModal'); await loadPlanner();
    if (savedRouteId) { planner.previewRouteKey = `saved:${savedRouteId}`; renderPlanner(); renderMap(); $('patrolMapStatus').textContent = `Showing saved route ${saved.route.route_name}.`; }
    showToast('Patrol route saved.', 'success');
}

function setFormStatus(id, text, error = false) { const node = $(id); node.textContent = text; node.className = `form-status${error ? ' error' : ' success'}`; }

async function loadTeams() {
    const response = await apiFetch('/patrol-teams'); if (!response.ok) return;
    planner.teams = await response.json(); $('routeTeam').innerHTML = '<option value="">Choose a saved team</option>' + planner.teams.map(team => `<option value="${team.id}">${esc(team.name)}${team.leader_name ? ` · ${esc(team.leader_name)}` : ''}</option>`).join('');
}

async function loadPlanner() {
    const date = $('routePlannerDate').value || todayKey(); $('routePlannerDate').value = date;
    $('patrolMapStatus').textContent = 'Loading route map…';
    const response = await apiFetch(`/patrol-route-planner?date=${encodeURIComponent(date)}`);
    if (!response.ok) { $('patrolMapStatus').textContent = 'Could not load patrol route data.'; return; }
    const data = await response.json(); planner.records = data.records || []; planner.routes = data.routes || []; planner.suggestionRadius = Number(data.radius_meters) || 90; planner.thresholds = data.thresholds || planner.thresholds;
    if (planner.mapReady) for (const layer of ['patrol-record-glow', 'patrol-record-circle']) planner.map.setPaintProperty(layer, 'circle-color', recordColorExpression());
    if (planner.previewRouteKey && !routeByKey(planner.previewRouteKey)) planner.previewRouteKey = null;
    $('kpiVisibleRecords').textContent = planner.records.length; $('patrolMapStatus').textContent = planner.previewRouteKey
        ? `Showing ${routeByKey(planner.previewRouteKey)?.route_name || 'selected route'}.`
        : `Map updated for ${date}. Select Show route on a suggestion to preview one continuous route.`;
    renderPlanner(); renderMap();
    if (!planner.editRouteHandled) {
        const params = new URLSearchParams(window.location.search); const editRouteId = params.get('edit_route');
        if (editRouteId) {
            planner.editRouteHandled = true; const route = findRoute(editRouteId);
            const cleanUrl = `patrol.html?date=${encodeURIComponent(date)}`; history.replaceState(null, '', cleanUrl);
            if (route) openRouteEditor(route, Number(params.get('deployment')) || null);
        }
    }
}

function renderPlanner() { renderSelected(); renderRoutes(); }

function ensureRouteEditControls() {
    if (!$('cancelMapRouteEditBtn')) {
        const button = document.createElement('button'); button.id = 'cancelMapRouteEditBtn'; button.className = 'btn btn-quiet'; button.type = 'button'; button.hidden = true; button.textContent = 'Cancel editing';
        document.querySelector('.planner-actions')?.insertBefore(button, $('clearSelectedBtn'));
    }
    if (!$('addStopsFromMapBtn')) {
        const button = document.createElement('button'); button.id = 'addStopsFromMapBtn'; button.className = 'btn btn-secondary admin-action'; button.type = 'button'; button.hidden = true; button.innerHTML = '<i class="fa-solid fa-map-location-dot"></i> Add stops from map';
        document.querySelector('#routeForm .modal-actions')?.insertBefore(button, $('cancelRouteBtn'));
    }
}

function setupEvents() {
    ensureRouteEditControls();
    $('routePlannerDate').value = new URLSearchParams(window.location.search).get('date') || todayKey(); $('refreshPlannerBtn').addEventListener('click', loadPlanner); $('routePlannerDate').addEventListener('change', loadPlanner);
    $('clearSelectedBtn').addEventListener('click', () => { if (planner.mapEditingRoute) resetMapRouteStops(); else { planner.selected.clear(); renderPlanner(); renderMap(); } });
    $('cancelMapRouteEditBtn').addEventListener('click', cancelMapRouteEdit);
    $('newRouteFromSelectedBtn').addEventListener('click', () => planner.mapEditingRoute
        ? openRouteEditor(planner.mapEditingRoute, planner.mapEditingDeploymentId, false, selectedRecords())
        : openRouteEditor());
    $('addStopsFromMapBtn').addEventListener('click', startMapRouteEdit); $('routeForm').addEventListener('submit', saveRoute);
    $('cancelRouteBtn').addEventListener('click', () => closeModal('routeModal')); $('closeRouteModalBtn').addEventListener('click', () => closeModal('routeModal'));
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    motionPreference.addEventListener('change', event => { planner.reducedMotion = event.matches; startRouteMotion(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearInterval(planner.motionTimer); else startRouteMotion(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('.scheduler-modal:not([hidden])').forEach(node => closeModal(node.id)); });
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!getCurrentUser()) { window.location.href = 'login.html'; return; }
    applyRoleBasedUI(); setupEvents(); initMap(); await loadTeams(); await loadPlanner(); startLivePolling(loadPlanner, 30000);
});
