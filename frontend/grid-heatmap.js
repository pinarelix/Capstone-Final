"use strict";

// ✅ API_URL ay naka-define na sa apiHelper.js
// BARANGAY_CENTER / BARANGAY_BOUNDARY_COORDS / createBarangayMap come
// from mapHelper.js, shared with incident.js.

let map;
let boundaryLayer;
let allIncidentsData = [];
let heatmapLayerGroup;

// Density thresholds for a single grid cell (100m x 100m), based on the
// raw number of incidents recorded in that cell. Calibrated to Barangay
// 179's population (~48,600) and per-cell scale (roughly a city block) -
// low enough to differentiate real hotspots as data accumulates, without
// requiring an unrealistic concentration of citywide-scale crime in one cell.
const DENSITY_MODERATE_MIN = 4;
const DENSITY_HIGH_MIN = 10;

function getDensityColor(count) {
    if (count >= DENSITY_HIGH_MIN) return '#ef4444';
    if (count >= DENSITY_MODERATE_MIN) return '#f59e0b';
    return '#10b981';
}

/* ============================================================
   🔥 FIXED: Gumamit ng functions mula sa apiHelper.js
   (HINDI NA LOCAL STORAGE)
============================================================ */

// ✅ ITO NA LANG ANG KAILANGAN - WALA NANG CUSTOM FUNCTIONS

/* ============================================================
   MAP FUNCTIONS
============================================================ */

function initializeMap() {
    console.log("🚀 Initializing Map...");

    const created = createBarangayMap("map", {
        zoom: 15,
        zoomControl: true,
        preferCanvas: true,
        minZoom: 14,
        maxZoom: 19,
        fadeAnimation: true,
        zoomAnimation: true
    });
    map = created.map;
    boundaryLayer = created.boundaryLayer;
    heatmapLayerGroup = L.layerGroup().addTo(map);

    console.log("✅ Map Initialized!");
    loadRealData();
}

async function loadRealData() {
    try {
        const url = '/heatmap/incidents';
        console.log(`⏳ Fetching: ${url}`);

        const response = await apiFetch(url);
        console.log(`📡 Response Status: ${response.status}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const incidents = await response.json();
        console.log(`✅ Loaded ${incidents.length} incidents from API`);

        allIncidentsData = incidents;

        if (incidents.length > 0) {
            console.log("📋 INCIDENT STATUSES FROM API:");
            incidents.forEach(item => {
                console.log(`   ID: ${item.id} | Status: "${item.status}" | Lat: ${item.latitude} | Lng: ${item.longitude} | Street: ${item.street_name || 'N/A'}`);
            });
        }

        populateIncidentTypeOptions();
        populateHeatmapPeriodOptions();
        applyFilterAndRender();

    } catch (error) {
        console.error("❌ Error:", error.message);
        updateKPIs(0, 0, 0, 0);
        showErrorState();
    }
}

/* ============================================================
   INCIDENT CATEGORY FILTER
   (mirrors the optgroups on the Add Incident form - incident.html)
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
    "Special / Child-Related": [
        "BCPC", "Child Support"
    ],
    "Other Incidents": [
        "Hit and Run", "Reckless Impudence Resulting to Damage to Property and Physical Injury",
        "Reckless Impudence Resulting Physical Injury", "Noise Complaint", "Anti Electricity Pilferage",
        "Reckless Impudence Resulting to Damage to Property", "Safe Special Act", "Bastos Law",
        "Abandoning a Minor", "Abandonment of a Person in Danger", "Inducing a Minor to Abandon His/her Home",
        "Animal Welfare Acts", "Suspicious Activity", "Traffic Obstruction", "Breach of Contract",
        "Breach Contact", "Curfew Violation", "Abandon", "Missing", "Suicide"
    ]
};

// Reverse lookup: incident_type -> category. Anything not listed above
// (e.g. legacy/free-text data) falls back to "Other Incidents".
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
   DATE FILTER (Day / Week / Month / All Time)
============================================================ */

// Monday of the ISO week containing dateStr (YYYY-MM-DD), also as YYYY-MM-DD.
function getMondayOfWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? -6 : 1 - day; // shift Sunday back to the prior Monday
    d.setDate(d.getDate() + diff);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const date = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${date}`;
}

function formatDateLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatWeekLabel(mondayStr) {
    const start = new Date(mondayStr + 'T00:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `Week of ${startLabel} – ${endLabel}`;
}

function formatMonthLabel(yearMonth) {
    const [year, month] = yearMonth.split('-');
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
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

    const datedIncidents = allIncidentsData.filter(item => item.date);
    const keySet = new Set();

    datedIncidents.forEach(item => {
        if (granularity === 'day') {
            keySet.add(item.date);
        } else if (granularity === 'week') {
            keySet.add(getMondayOfWeek(item.date));
        } else if (granularity === 'month') {
            keySet.add(item.date.substring(0, 7));
        }
    });

    const sortedKeys = Array.from(keySet).sort((a, b) => b.localeCompare(a));

    if (sortedKeys.length === 0) {
        periodSelect.innerHTML = '<option value="">No incidents found</option>';
        if (periodChip) periodChip.style.display = '';
        return;
    }

    sortedKeys.forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        if (granularity === 'day') option.textContent = formatDateLabel(key);
        else if (granularity === 'week') option.textContent = formatWeekLabel(key);
        else option.textContent = formatMonthLabel(key);
        periodSelect.appendChild(option);
    });

    periodSelect.value = sortedKeys[0];
    if (periodChip) periodChip.style.display = '';
}

function applyFilterAndRender() {
    const granularity = document.getElementById('heatmapGranularity')?.value || 'all';
    const period = document.getElementById('heatmapPeriod')?.value || '';
    const category = document.getElementById('heatmapIncidentType')?.value || 'all';

    let filtered = allIncidentsData;

    if (granularity === 'day') {
        filtered = filtered.filter(item => item.date === period);
    } else if (granularity === 'week') {
        filtered = filtered.filter(item => item.date && getMondayOfWeek(item.date) === period);
    } else if (granularity === 'month') {
        filtered = filtered.filter(item => item.date && item.date.substring(0, 7) === period);
    }

    if (category !== 'all') {
        filtered = filtered.filter(item => getIncidentCategory(item.incident_type) === category);
    }

    // A previously-selected circle's details no longer necessarily apply
    // to the new filtered set - reset to the prompt state.
    const badge = document.getElementById('selectedLocationBadge');
    if (badge) {
        badge.textContent = 'Click a circle on the map';
        badge.classList.remove('active');
    }
    const tbody = document.getElementById('detailsTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i class="fa-regular fa-circle"></i>
                        <p>Click on a heatmap circle to view incident details</p>
                    </div>
                </td>
            </tr>
        `;
    }

    if (filtered.length === 0) {
        console.warn("⚠️ No incidents match the current filter.");
        heatmapLayerGroup.clearLayers();
        updateKPIs(0, 0, 0, 0);
        showEmptyState();
        return;
    }

    renderGrid(filtered);
}

function renderGrid(incidents) {
    console.log("🔄 Rendering grid with glowing circles...");

    heatmapLayerGroup.clearLayers();

    let totalIncidents = 0;
    let activeCells = 0;
    let peakCount = 0;
    let highRiskCells = 0;

    const gridSize = 3;
    const locationMap = {};

    const validIncidents = incidents.filter(item => {
        if (!item.latitude || !item.longitude) {
            console.warn(`⚠️ Skipping ID ${item.id} - missing coordinates`);
            return false;
        }
        return true;
    });

    console.log(`✅ ${validIncidents.length} incidents with valid coordinates`);

    if (validIncidents.length === 0) {
        console.warn("⚠️ No valid incidents with coordinates.");
        updateKPIs(0, 0, 0, 0);
        showEmptyState();
        return;
    }

    validIncidents.forEach(item => {
        const lat = Number(Number(item.latitude).toFixed(gridSize));
        const lng = Number(Number(item.longitude).toFixed(gridSize));
        const key = `${lat},${lng}`;
        
        if (!locationMap[key]) {
            locationMap[key] = { lat, lng, count: 0, incidents: [] };
        }
        locationMap[key].count++;
        locationMap[key].incidents.push(item);
    });

    const cells = Object.values(locationMap);
    console.log(`📍 ${cells.length} grid cells created`);

    if (cells.length === 0) {
        console.warn("⚠️ No cells created.");
        updateKPIs(0, 0, 0, 0);
        showEmptyState();
        return;
    }

    clearEmptyState();

    cells.forEach(cell => {
        const count = cell.count;
        const cellIncidents = cell.incidents;

        totalIncidents += count;
        if (count > 0) activeCells++;
        if (count > peakCount) peakCount = count;
        if (count >= DENSITY_HIGH_MIN) highRiskCells++;

        const color = getDensityColor(count);

        const baseRadius = 100;
        const radius = baseRadius + (count * 8);

        const circle = L.circle([cell.lat, cell.lng], {
            radius: radius,
            color: color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.7,
            interactive: true,
            className: 'heatmap-circle'
        }).addTo(heatmapLayerGroup);

        const glow = L.circle([cell.lat, cell.lng], {
            radius: radius * 1.8,
            color: 'transparent',
            fillColor: color,
            fillOpacity: 0.08,
            interactive: false,
            className: 'heatmap-glow'
        }).addTo(heatmapLayerGroup);

        circle.bindTooltip(`${count} incident${count > 1 ? 's' : ''}`, {
            permanent: false,
            direction: 'center',
            className: 'cell-tooltip'
        });

        circle.on('click', function() {
            showIncidentDetails(cellIncidents, cell.lat, cell.lng);
            
            this.setStyle({
                weight: 4,
                opacity: 1
            });
            
            setTimeout(() => {
                this.setStyle({
                    weight: 2,
                    opacity: 0.7
                });
            }, 2000);
        });
    });

    updateKPIs(totalIncidents, activeCells, peakCount, highRiskCells);
    console.log(`📊 KPI: Total=${totalIncidents}, Cells=${activeCells}, Peak=${peakCount}, HighRisk=${highRiskCells}`);
    console.log("✅ Rendering Complete!");
}

function showIncidentDetails(incidents, lat, lng) {
    const tbody = document.getElementById('detailsTableBody');
    const badge = document.getElementById('selectedLocationBadge');
    
    if (!tbody) return;

    if (badge) {
        badge.textContent = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)} (${incidents.length} incidents)`;
        badge.classList.add('active');
    }

    if (!incidents || incidents.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i class="fa-regular fa-circle"></i>
                        <p>No incident details available for this location</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = incidents.map(item => {
        let statusClass = 'badge-status';
        if (item.status === 'Open') statusClass += ' open';
        else if (item.status === 'Monitoring') statusClass += ' monitoring';
        else if (item.status === 'Resolved') statusClass += ' resolved';
        else statusClass += ' open';

        let dangerClass = 'badge-danger';
        const danger = item.danger_level || '';
        if (danger.includes('Level 3') || danger.includes('High')) {
            dangerClass += ' high';
        } else if (danger.includes('Level 2') || danger.includes('Moderate')) {
            dangerClass += ' moderate';
        } else if (danger.includes('Level 1') || danger.includes('Low')) {
            dangerClass += ' low';
        } else {
            dangerClass += ' calculated';
        }

        let dateStr = 'N/A';
        let timeStr = 'N/A';
        if (item.date) {
            const d = new Date(item.date);
            if (!isNaN(d.getTime())) {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                dateStr = `${year}-${month}-${day}`;
            }
        }
        if (item.time) {
            timeStr = item.time.substring(0, 5);
        }

        const streetName = item.street_name || 'N/A';

        return `
            <tr>
                <td class="font-bold">${item.id || 'N/A'}</td>
                <td>${escapeHTML(item.incident_type || 'N/A')}</td>
                <td>${dateStr} ${timeStr}</td>
                <td><span class="${statusClass}">${escapeHTML(item.status || 'Open')}</span></td>
                <td><span class="${dangerClass}">${escapeHTML(danger || 'Calculated by System')}</span></td>
                <td>${escapeHTML(item.recommended_action || 'Scheduled patrol and risk monitoring')}</td>
                <td><strong>${escapeHTML(streetName)}</strong></td>
            </tr>
        `;
    }).join('');
}

function showEmptyState() {
    const tbody = document.getElementById('detailsTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i class="fa-regular fa-circle"></i>
                        <p>No incident records found in the database.</p>
                        <p style="font-size: 0.8rem; margin-top: 4px; color: #94a3b8;">Add an incident to see it on the map.</p>
                    </div>
                </td>
            </tr>
        `;
    }
    
    const badge = document.getElementById('selectedLocationBadge');
    if (badge) {
        badge.textContent = 'No data available';
        badge.classList.remove('active');
    }
}

function showErrorState() {
    const tbody = document.getElementById('detailsTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state" style="color: #ef4444;">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <p>Failed to load incident data.</p>
                        <p style="font-size: 0.8rem; margin-top: 4px; color: #94a3b8;">Please check your connection and try again.</p>
                    </div>
                </td>
            </tr>
        `;
    }
}

function clearEmptyState() {}

function updateKPIs(total, cells, peak, high) {
    document.getElementById("kpi-incidents").textContent = total;
    document.getElementById("kpi-cells").textContent = cells;
    document.getElementById("kpi-peak").textContent = peak;
    document.getElementById("kpi-high").textContent = high;
}

document.addEventListener("DOMContentLoaded", function() {
    // ✅ Apply role-based UI gamit ang apiHelper
    const user = getCurrentUser();
    
    if (!user && !window.location.pathname.includes('login.html')) {
        window.location.href = 'login.html';
        return;
    }
    
    applyRoleBasedUI(); // mula sa apiHelper.js

    const granularitySelect = document.getElementById('heatmapGranularity');
    const periodSelect = document.getElementById('heatmapPeriod');
    const incidentTypeSelect = document.getElementById('heatmapIncidentType');

    if (incidentTypeSelect) {
        incidentTypeSelect.addEventListener('change', function() {
            applyFilterAndRender();
        });
    }

    if (granularitySelect) {
        granularitySelect.addEventListener('change', function() {
            populateHeatmapPeriodOptions();
            applyFilterAndRender();
        });
    }

    if (periodSelect) {
        periodSelect.addEventListener('change', function() {
            applyFilterAndRender();
        });
    }

    console.log("🚀 Grid Heatmap page loaded");
    initializeMap();
});

console.log('✅ grid-heatmap.js loaded successfully');