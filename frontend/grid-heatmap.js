"use strict";

let map;
let allIncidentsData = [];
let streetAnalysisData = [];
let activePopup = null;

const SEVERITY_HIGH_MIN = 67;
const SEVERITY_MODERATE_MIN = 34;

function getSeverityLabel(avgScore) {
    if (avgScore >= SEVERITY_HIGH_MIN) return 'High Risk';
    if (avgScore >= SEVERITY_MODERATE_MIN) return 'Moderate Risk';
    return 'Low Risk';
}

function getCellAvgSeverity(incidents) {
    const scores = incidents
        .map(i => i.cart_score != null ? parseFloat(i.cart_score) : null)
        .filter(s => s !== null && !isNaN(s));
    if (scores.length === 0) return 30;
    return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

/* ============================================================
   MAP INITIALIZATION
============================================================ */

function initializeMap() {
    map = createMapboxMap('map');

    map.on('load', () => {
        addMapSources();
        addMapLayers();
        setupMapInteraction();
        loadRealData();
        loadStreetAnalysis();
    });

    map.on('error', (e) => {
        console.error('Mapbox error:', e.error || e);
    });
}

function addMapSources() {
    map.addSource('incidents', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addSource('street-analysis', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
}

function addMapLayers() {
    // Soft glow coloured by the SAME severity tier as the dot (green / amber /
    // red), rather than a density heatmap that cycled green -> amber -> red and
    // drew every lower colour as a ring under a hot point. A low-risk area now
    // glows green, a moderate one amber, and only a high-risk one red. Features
    // are fed lowest-tier-first (see renderIncidents), so where two glows
    // overlap the higher tier is drawn on top and its colour wins.
    map.addLayer({
        id: 'incidents-glow',
        type: 'circle',
        source: 'incidents',
        paint: {
            'circle-color': [
                'step', ['get', 'cart_score'],
                '#10b981',        // < 34  -> Low (green)
                34, '#f59e0b',    // 34-66 -> Moderate (amber)
                67, '#ef4444'     // >= 67 -> High (red)
            ],
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                13, 16,
                15, 26,
                17, 40,
                19, 55
            ],
            'circle-blur': 1,
            'circle-opacity': [
                'interpolate', ['linear'], ['zoom'],
                13, 0.5,
                17, 0.4,
                19, 0.3
            ]
        }
    });

    map.addLayer({
        id: 'incidents-circle',
        type: 'circle',
        source: 'incidents',
        paint: {
            'circle-color': [
                // Discrete tiers (step, not interpolate): each incident shows exactly
                // ONE severity colour by its CART score, so a high-score point is pure
                // red rather than a blended orange that reads as several overlapping
                // levels. Thresholds match the 34 / 67 danger bands.
                'step', ['get', 'cart_score'],
                '#10b981',        // < 34  -> Low (green)
                34, '#f59e0b',    // 34-66 -> Moderate (amber)
                67, '#ef4444'     // >= 67 -> High (red)
            ],
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                14, 3,
                16, 5,
                18, 8
            ],
            'circle-opacity': [
                'interpolate', ['linear'], ['zoom'],
                14, 0,
                15.5, 0.5,
                17, 0.85
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': [
                'interpolate', ['linear'], ['zoom'],
                14, 0,
                16, 1,
                18, 1.5
            ],
            'circle-stroke-opacity': [
                'interpolate', ['linear'], ['zoom'],
                14, 0,
                16, 0.6,
                18, 0.9
            ]
        }
    });

    map.addLayer({
        id: 'street-markers',
        type: 'circle',
        source: 'street-analysis',
        layout: { 'visibility': 'visible' },
        paint: {
            'circle-color': [
                'match', ['get', 'risk_tier'],
                'Critical', '#dc2626',
                'High', '#ef4444',
                'Moderate', '#f59e0b',
                'Low', '#10b981',
                '#94a3b8'
            ],
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                14, 6,
                16, 9,
                18, 12
            ],
            'circle-opacity': 0.9,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2
        }
    });

    map.addLayer({
        id: 'street-labels',
        type: 'symbol',
        source: 'street-analysis',
        layout: {
            'visibility': 'visible',
            'text-field': ['get', 'street_name'],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                14, 9,
                16, 11,
                18, 13
            ],
            'text-offset': [0, -1.5],
            'text-anchor': 'bottom',
            'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
            'text-allow-overlap': false,
            'text-ignore-placement': false
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': 'rgba(0,0,0,0.75)',
            'text-halo-width': 1.5
        }
    });
}

function setupMapInteraction() {
    map.on('click', 'incidents-circle', (e) => {
        if (!e.features || e.features.length === 0) return;

        const coords = e.features[0].geometry.coordinates.slice();
        const props = e.features[0].properties;

        const lat = coords[1];
        const lng = coords[0];
        const gridKey = `${Number(lat.toFixed(3))},${Number(lng.toFixed(3))}`;

        const cellIncidents = allIncidentsData.filter(item => {
            const iLat = Number(Number(item.latitude).toFixed(3));
            const iLng = Number(Number(item.longitude).toFixed(3));
            return `${iLat},${iLng}` === gridKey;
        });

        if (cellIncidents.length > 0) {
            showIncidentDetails(cellIncidents, lat, lng);
        }
    });

    map.on('click', 'street-markers', (e) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();

        if (activePopup) activePopup.remove();

        const tierColors = { Critical: '#dc2626', High: '#ef4444', Moderate: '#f59e0b', Low: '#10b981' };
        const tierColor = tierColors[props.risk_tier] || '#94a3b8';

        activePopup = new mapboxgl.Popup({ offset: 15, maxWidth: '280px' })
            .setLngLat(coords)
            .setHTML(`
                <div style="font-family: Inter, sans-serif; font-size: 13px; line-height: 1.5;">
                    <div style="font-weight: 800; font-size: 14px; margin-bottom: 6px;">${escapeHTML(props.street_name)}</div>
                    <div style="display: inline-block; padding: 2px 10px; border-radius: 10px; background: ${tierColor}; color: #fff; font-size: 11px; font-weight: 700; margin-bottom: 8px;">${props.risk_tier} Risk</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: 12px; color: #cbd5e1;">
                        <span>Composite Score</span><strong style="color: #fff; text-align: right;">${props.composite_score}</strong>
                        <span>Avg CART Score</span><strong style="color: #fff; text-align: right;">${props.avg_cart_score}</strong>
                        <span>Incidents</span><strong style="color: #fff; text-align: right;">${props.incident_count}</strong>
                        <span>High Severity %</span><strong style="color: #fff; text-align: right;">${props.high_severity_pct}%</strong>
                        <span>Night Incidents %</span><strong style="color: #fff; text-align: right;">${props.night_pct}%</strong>
                        <span>Recency Score</span><strong style="color: #fff; text-align: right;">${props.recency_score}</strong>
                    </div>
                </div>
            `)
            .addTo(map);
    });

    map.on('mouseenter', 'incidents-circle', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'incidents-circle', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'street-markers', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'street-markers', () => { map.getCanvas().style.cursor = ''; });
}

/* ============================================================
   DATA LOADING
============================================================ */

function isInsideBoundary(lat, lng) {
    const poly = typeof MB_BOUNDARY !== 'undefined' ? MB_BOUNDARY : [];
    if (poly.length === 0) return true;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1];
        const xj = poly[j][0], yj = poly[j][1];
        if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi))
            inside = !inside;
    }
    return inside;
}

async function loadRealData() {
    try {
        const response = await apiFetch('/heatmap/incidents');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const incidents = await response.json();
        allIncidentsData = incidents.filter(i =>
            i.latitude != null && i.longitude != null &&
            isInsideBoundary(parseFloat(i.latitude), parseFloat(i.longitude))
        );
        populateIncidentTypeOptions();
        populateHeatmapPeriodOptions();
        applyFilterAndRender();
    } catch (error) {
        console.error('Error loading incidents:', error);
        updateKPIs(0, 0, 0, 0, null);
    }
}

async function loadStreetAnalysis() {
    try {
        const response = await apiFetch('/heatmap/street-analysis');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        streetAnalysisData = await response.json();
        renderStreetAnalysis(streetAnalysisData);
    } catch (error) {
        console.error('Error loading street analysis:', error);
    }
}

/* ============================================================
   INCIDENT CATEGORY FILTER
============================================================ */

const INCIDENT_CATEGORIES = {
    "Violent Crimes": [
        "Homicide", "Attempted Murder", "Kidnapping", "Child Abuse", "VAWC",
        "Illegal Release of Fire Arms", "Attempted Arson", "Robbery", "Grave Threat",
        "Act of Lasciviousness", "Physical Injury", "Threats", "Less Serious Physical Injuries",
        "Falsification of Documents", "Slight Physical Injuries and Maltreatment", "Light Threats"
    ],
    "Property Crimes": [
        "Arson", "Theft", "Fencing of Stolen Properties", "Qualified Trespass to Dwelling",
        "Occupation of Real Property or Usurpation of", "Removal, Sale or Pledge of Mortgaged Property",
        "Trespassing", "Altering Boundaries of Landmarks", "Vandalism"
    ],
    "Financial / Fraud Crimes": [
        "Scam", "Swindling of Estafa", "Estafa", "Cybercrime Prevention Act 2012 (RA 10175)",
        "Estafa/Debts", "Cyber Bullying"
    ],
    "Social / Public Order Crimes": [
        "Voyeurism Act", "Alarms and Scandals", "Incriminating Innocent Persons",
        "Threatening to Publish and offer to prevent", "Oral Defamation", "Harassment",
        "Intriguing Against Honor", "Unlawful Use of Means of Publication and Unlaw",
        "Prohibiting Publication of Acts Referred to in the"
    ],
    "Special / Child-Related": ["BCPC", "Child Support"],
    "Other Incidents": [
        "Hit and Run", "Reckless Impudence Resulting to Damage to Property and Physical Injury",
        "Reckless Impudence Resulting Physical Injury", "Noise Complaint", "Anti Electricity Pilferage",
        "Reckless Impudence Resulting to Damage to Property", "Safe Special Act", "Bastos Law",
        "Abandoning a Minor", "Abandonment of a Person in Danger", "Inducing a Minor to Abandon His/her Home",
        "Animal Welfare Acts", "Suspicious Activity", "Traffic Obstruction", "Breach of Contract",
        "Breach Contact", "Curfew Violation", "Abandon", "Missing", "Suicide"
    ]
};

const TYPE_TO_CATEGORY = {};
Object.entries(INCIDENT_CATEGORIES).forEach(([category, types]) => {
    types.forEach(type => { TYPE_TO_CATEGORY[type] = category; });
});

function getIncidentCategory(incidentType) {
    return TYPE_TO_CATEGORY[incidentType] || "Other Incidents";
}

function populateIncidentTypeOptions() {
    const typeSelect = document.getElementById('heatmapIncidentType');
    if (!typeSelect) return;
    const previousValue = typeSelect.value || 'all';
    typeSelect.innerHTML = '<option value="all">All Categories</option>';
    Object.keys(INCIDENT_CATEGORIES).forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        typeSelect.appendChild(option);
    });
    typeSelect.value = Object.keys(INCIDENT_CATEGORIES).includes(previousValue) ? previousValue : 'all';
}

/* ============================================================
   DATE FILTER
============================================================ */

function getMondayOfWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatWeekLabel(mondayStr) {
    const start = new Date(mondayStr + 'T00:00:00');
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function formatMonthLabel(yearMonth) {
    const [year, month] = yearMonth.split('-');
    const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${names[parseInt(month, 10) - 1]} ${year}`;
}

function populateHeatmapPeriodOptions() {
    const granularitySelect = document.getElementById('heatmapGranularity');
    const periodSelect = document.getElementById('heatmapPeriod');
    const periodChip = document.getElementById('heatmapPeriodChip');
    if (!granularitySelect || !periodSelect) return;

    const granularity = granularitySelect.value;
    periodSelect.innerHTML = '';

    if (granularity === 'all') {
        if (periodChip) periodChip.style.display = 'none';
        return;
    }

    const keySet = new Set();
    allIncidentsData.filter(item => item.date).forEach(item => {
        if (granularity === 'day') keySet.add(item.date);
        else if (granularity === 'week') keySet.add(getMondayOfWeek(item.date));
        else if (granularity === 'month') keySet.add(item.date.substring(0, 7));
    });

    const sorted = Array.from(keySet).sort((a, b) => b.localeCompare(a));
    if (sorted.length === 0) {
        periodSelect.innerHTML = '<option value="">No incidents found</option>';
        if (periodChip) periodChip.style.display = '';
        return;
    }

    sorted.forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        if (granularity === 'day') option.textContent = formatDateLabel(key);
        else if (granularity === 'week') option.textContent = formatWeekLabel(key);
        else option.textContent = formatMonthLabel(key);
        periodSelect.appendChild(option);
    });

    periodSelect.value = sorted[0];
    if (periodChip) periodChip.style.display = '';
}

/* ============================================================
   FILTER + RENDER
============================================================ */

function applyFilterAndRender() {
    const granularity = document.getElementById('heatmapGranularity')?.value || 'all';
    const period = document.getElementById('heatmapPeriod')?.value || '';
    const category = document.getElementById('heatmapIncidentType')?.value || 'all';

    let filtered = allIncidentsData;

    if (granularity === 'day') filtered = filtered.filter(i => i.date === period);
    else if (granularity === 'week') filtered = filtered.filter(i => i.date && getMondayOfWeek(i.date) === period);
    else if (granularity === 'month') filtered = filtered.filter(i => i.date && i.date.substring(0, 7) === period);

    if (category !== 'all') filtered = filtered.filter(i => getIncidentCategory(i.incident_type) === category);

    const badge = document.getElementById('selectedLocationBadge');
    if (badge) { badge.textContent = 'Click a point on the map'; badge.classList.remove('active'); }
    const tbody = document.getElementById('detailsTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><i class="fa-regular fa-circle"></i><p>Click on a map point to view incident details</p></div></td></tr>`;
    }

    renderIncidents(filtered);

    const isFiltered = granularity !== 'all' || category !== 'all';
    if (isFiltered) {
        renderStreetAnalysisFromIncidents(filtered);
    } else {
        renderStreetAnalysis(streetAnalysisData);
    }
}

function renderIncidents(incidents) {
    const valid = incidents.filter(i => i.latitude && i.longitude);

    const features = valid.map(item => ({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [Number(item.longitude), Number(item.latitude)]
        },
        properties: {
            id: item.id,
            cart_score: item.cart_score != null ? parseFloat(item.cart_score) : 30,
            incident_type: item.incident_type || 'Unknown',
            street_name: item.street_name || 'Unknown',
            status: item.status || 'Open',
            date: item.date || '',
            time: item.time || ''
        }
    }));

    // Draw lowest-risk first so a higher-tier glow/dot always paints over a lower
    // one where they overlap - the highest severity colour stays on top.
    features.sort((a, b) => a.properties.cart_score - b.properties.cart_score);

    if (map.getSource('incidents')) {
        map.getSource('incidents').setData({
            type: 'FeatureCollection',
            features: features
        });
    }

    // KPI computation
    let totalIncidents = valid.length;
    let activeCells = 0;
    let peakCount = 0;
    let highRiskCells = 0;

    const locationMap = {};
    valid.forEach(item => {
        const lat = Number(Number(item.latitude).toFixed(3));
        const lng = Number(Number(item.longitude).toFixed(3));
        const key = `${lat},${lng}`;
        if (!locationMap[key]) locationMap[key] = { incidents: [] };
        locationMap[key].incidents.push(item);
    });

    Object.values(locationMap).forEach(cell => {
        activeCells++;
        if (cell.incidents.length > peakCount) peakCount = cell.incidents.length;
        if (getCellAvgSeverity(cell.incidents) >= SEVERITY_HIGH_MIN) highRiskCells++;
    });

    const streetTally = {};
    valid.forEach(item => {
        const s = item.street_name || 'Unknown';
        streetTally[s] = (streetTally[s] || 0) + 1;
    });
    const topStreets = Object.entries(streetTally).sort((a, b) => b[1] - a[1]).slice(0, 3);

    updateKPIs(totalIncidents, activeCells, peakCount, highRiskCells, topStreets);
}

function renderStreetAnalysis(streets) {
    const features = streets.map(s => ({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [Number(s.center_lng), Number(s.center_lat)]
        },
        properties: {
            street_name: s.street_name,
            risk_tier: s.risk_tier,
            composite_score: s.composite_score,
            avg_cart_score: s.avg_cart_score,
            incident_count: s.incident_count,
            high_severity_pct: s.high_severity_pct,
            night_pct: s.night_pct,
            recency_score: s.recency_score
        }
    }));

    if (map.getSource('street-analysis')) {
        map.getSource('street-analysis').setData({
            type: 'FeatureCollection',
            features: features
        });
    }
}

function renderStreetAnalysisFromIncidents(incidents) {
    const valid = incidents.filter(i => i.latitude && i.longitude && i.street_name && i.street_name.trim());

    const streetMap = {};
    valid.forEach(item => {
        const name = item.street_name.trim();
        if (!streetMap[name]) streetMap[name] = [];
        streetMap[name].push(item);
    });

    const streets = Object.entries(streetMap)
        .filter(([, items]) => items.length >= 1)
        .map(([name, items]) => {
            const scores = items.map(i => i.cart_score != null ? parseFloat(i.cart_score) : 30);
            const avgCart = scores.reduce((a, b) => a + b, 0) / scores.length;
            const highCount = scores.filter(s => s >= SEVERITY_HIGH_MIN).length;
            const highPct = Math.round(highCount / items.length * 1000) / 10;

            const nightItems = items.filter(i => {
                if (i.time_of_day === 'Night' || i.time_of_day === 'Late Night') return true;
                if (i.time) {
                    const h = parseInt(i.time.substring(0, 2), 10);
                    return h >= 18 || h < 6;
                }
                return false;
            });
            const nightPct = Math.round(nightItems.length / items.length * 1000) / 10;

            const centerLat = items.reduce((s, i) => s + Number(i.latitude), 0) / items.length;
            const centerLng = items.reduce((s, i) => s + Number(i.longitude), 0) / items.length;

            return { street_name: name, incident_count: items.length, avg_cart_score: avgCart,
                     high_severity_pct: highPct, night_pct: nightPct,
                     center_lat: centerLat, center_lng: centerLng };
        });

    const maxCount = streets.length > 0 ? Math.max(...streets.map(s => s.incident_count)) : 1;

    streets.forEach(s => {
        const densityNorm = (s.incident_count / maxCount) * 100;
        const composite = (s.avg_cart_score || 0) * 0.35
            + (s.avg_cart_score || 0) * 0.25
            + densityNorm * 0.20
            + (s.high_severity_pct || 0) * 0.10
            + (s.night_pct || 0) * 0.10;
        s.composite_score = Math.round(composite * 100) / 100;
        if (composite >= 75) s.risk_tier = 'Critical';
        else if (composite >= 55) s.risk_tier = 'High';
        else if (composite >= 35) s.risk_tier = 'Moderate';
        else s.risk_tier = 'Low';
        s.recency_score = s.avg_cart_score;
    });

    renderStreetAnalysis(streets);
}

/* ============================================================
   STREET ANALYSIS TOGGLE
============================================================ */

function toggleStreetAnalysis() {
    if (!map) return;
    const btn = document.getElementById('toggleStreetBtn');
    const currentVis = map.getLayoutProperty('street-markers', 'visibility');
    const newVis = currentVis === 'visible' ? 'none' : 'visible';
    map.setLayoutProperty('street-markers', 'visibility', newVis);
    map.setLayoutProperty('street-labels', 'visibility', newVis);

    if (btn) {
        btn.classList.toggle('active', newVis === 'visible');
    }
}

/* ============================================================
   INCIDENT DETAILS TABLE
============================================================ */

let currentDetailIncidents = [];

function showIncidentDetails(incidents, lat, lng) {
    currentDetailIncidents = incidents || [];
    const filterInput = document.getElementById('blotterNumberFilter');
    if (filterInput) filterInput.value = '';
    const tbody = document.getElementById('detailsTableBody');
    const badge = document.getElementById('selectedLocationBadge');
    if (!tbody) return;

    if (badge) {
        badge.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${lat.toFixed(4)}, ${lng.toFixed(4)} (${incidents.length} incidents)`;
        badge.classList.add('active');
    }

    if (!incidents || incidents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><i class="fa-regular fa-circle"></i><p>No incident details available</p></div></td></tr>`;
        return;
    }

    renderIncidentRows(incidents, tbody);
}

function renderIncidentRows(incidents, tbody) {
    tbody.innerHTML = incidents.map(item => {
        let statusClass = 'badge-status';
        if (item.status === 'Open') statusClass += ' open';
        else if (item.status === 'Monitoring') statusClass += ' monitoring';
        else if (item.status === 'Resolved') statusClass += ' resolved';
        else statusClass += ' open';

        let dangerClass = 'badge-danger';
        const danger = item.danger_level || '';
        if (danger.includes('Level 3') || danger.includes('High')) dangerClass += ' high';
        else if (danger.includes('Level 2') || danger.includes('Moderate')) dangerClass += ' moderate';
        else if (danger.includes('Level 1') || danger.includes('Low')) dangerClass += ' low';
        else dangerClass += ' calculated';

        let dateStr = 'N/A', timeStr = 'N/A';
        if (item.date) {
            const d = new Date(item.date);
            if (!isNaN(d.getTime())) dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
        if (item.time) timeStr = item.time.substring(0, 5);

        const formBadge = item.form_type === 'crime'
            ? '<span style="background:#3b82f6;color:#fff;font-size:0.6rem;padding:2px 7px;border-radius:4px;">Incident</span>'
            : '<span style="background:#f59e0b;color:#fff;font-size:0.6rem;padding:2px 7px;border-radius:4px;">Blotter</span>';

        return `
            <tr>
                <td>${escapeHTML(item.blotter_number || '—')}</td>
                <td>${formBadge}</td>
                <td class="font-bold">${item.id || 'N/A'}</td>
                <td>${escapeHTML(item.incident_type || 'N/A')}</td>
                <td>${dateStr} ${timeStr}</td>
                <td><span class="${statusClass}">${escapeHTML(item.status || 'Open')}</span></td>
                <td>
                    <span class="${dangerClass}">${escapeHTML(danger || 'Calculated by System')}</span>
                    ${item.cart_score != null ? `<div class="cart-only" style="font-size: 0.65rem; color: #64748b; margin-top: 2px;">CART Score: ${parseFloat(item.cart_score).toFixed(0)}</div>` : ''}
                </td>
                <td>${escapeHTML(item.recommended_action || 'Scheduled patrol and risk monitoring')}</td>
                <td><strong>${escapeHTML(item.street_name || 'N/A')}</strong></td>
                <td>${escapeHTML(item.address || 'N/A')}</td>
            </tr>
        `;
    }).join('');
}

function renderFilteredDetails(filterText) {
    const filtered = filterText
        ? currentDetailIncidents.filter(i => (i.blotter_number || '').toLowerCase().includes(filterText.toLowerCase()))
        : currentDetailIncidents;
    const tbody = document.getElementById('detailsTableBody');
    if (!tbody) return;
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><i class="fa-regular fa-filter-circle-xmark"></i><p>No incidents match blotter number "${escapeHTML(filterText)}"</p></div></td></tr>`;
        return;
    }
    renderIncidentRows(filtered, tbody);
}

document.addEventListener('DOMContentLoaded', () => {
    const filterInput = document.getElementById('blotterNumberFilter');
    if (filterInput) {
        filterInput.addEventListener('input', () => renderFilteredDetails(filterInput.value.trim()));
    }
});

/* ============================================================
   KPIs
============================================================ */

function updateKPIs(total, cells, peak, high, topStreets) {
    const el = (id) => document.getElementById(id);
    if (el("kpi-incidents")) el("kpi-incidents").textContent = total;
    if (el("kpi-cells")) el("kpi-cells").textContent = cells;
    if (el("kpi-peak")) el("kpi-peak").textContent = peak;
    if (el("kpi-high")) el("kpi-high").textContent = high;

    const hotspotList = el("kpi-hotspot");
    if (hotspotList) {
        if (topStreets && topStreets.length > 0) {
            hotspotList.innerHTML = topStreets.map(([name, count], i) => `
                <div class="hotspot-rank-row">
                    <span class="hotspot-rank-badge">${i + 1}</span>
                    <span class="hotspot-rank-name">${escapeHTML(name)}</span>
                    <span class="hotspot-rank-count">${count}</span>
                </div>
            `).join('');
        } else {
            hotspotList.innerHTML = '<div class="hotspot-rank-row"><span class="hotspot-rank-name">N/A</span></div>';
        }
    }
}

/* ============================================================
   DOM READY
============================================================ */

document.addEventListener("DOMContentLoaded", function () {
    const user = getCurrentUser();
    if (!user && !window.location.pathname.includes('login.html')) {
        window.location.href = 'login.html';
        return;
    }
    applyRoleBasedUI();

    const granularitySelect = document.getElementById('heatmapGranularity');
    const periodSelect = document.getElementById('heatmapPeriod');
    const incidentTypeSelect = document.getElementById('heatmapIncidentType');
    const streetToggle = document.getElementById('toggleStreetBtn');

    if (incidentTypeSelect) incidentTypeSelect.addEventListener('change', applyFilterAndRender);
    if (granularitySelect) granularitySelect.addEventListener('change', () => { populateHeatmapPeriodOptions(); applyFilterAndRender(); });
    if (periodSelect) periodSelect.addEventListener('change', applyFilterAndRender);
    if (streetToggle) streetToggle.addEventListener('click', toggleStreetAnalysis);

    initializeMap();
});
