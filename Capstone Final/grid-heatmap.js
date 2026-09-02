"use strict";

// ✅ API_URL ay naka-define na sa apiHelper.js

const BARANGAY_CENTER = [14.7468, 121.0789];

let map;
let boundaryLayer;
let allIncidentsData = [];

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
    
    const boundaryCoords = [
        [14.759055, 121.068181],
        [14.758775, 121.081208],
        [14.754012, 121.081317],
        [14.753785, 121.084781],
        [14.751778, 121.084528],
        [14.749692, 121.083159],
        [14.749858, 121.081282],
        [14.746963, 121.081271],
        [14.745345, 121.078353],
        [14.742305, 121.077591],
        [14.740230, 121.075112],
        [14.741330, 121.073074],
        [14.740354, 121.072044],
        [14.740365, 121.068793],
        [14.739151, 121.068825],
        [14.739182, 121.067227],
        [14.758127, 121.067320],
        [14.758158, 121.067813]
    ];

    const latLngs = boundaryCoords.map(coord => L.latLng(coord[0], coord[1]));
    const polygonBounds = L.latLngBounds(latLngs);

    map = L.map("map", {
        center: BARANGAY_CENTER,
        zoom: 15,
        zoomControl: true,
        preferCanvas: true,
        minZoom: 14,
        maxZoom: 19,
        maxBounds: polygonBounds,
        maxBoundsViscosity: 1.0,
        fadeAnimation: true,
        zoomAnimation: true
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const outerMaskCoords = [
        [90, -180], [90, 180], [-90, 180], [-90, -180], [90, -180]
    ];
    const holeCoords = boundaryCoords.map(coord => [coord[0], coord[1]]);

    const blurMask = L.polygon([outerMaskCoords, holeCoords], {
        color: "transparent",
        weight: 0,
        fillColor: "rgba(0, 0, 0, 0.65)",
        fillOpacity: 0.65,
        interactive: false,
        className: "blur-mask",
        pane: "overlayPane"
    }).addTo(map);

    boundaryLayer = L.polygon(boundaryCoords, {
        color: "#111111",
        weight: 4,
        opacity: 1,
        fillColor: "transparent",
        interactive: false
    }).addTo(map);

    const glowBorder = L.polygon(boundaryCoords, {
        color: "#0ea5e9",
        weight: 8,
        opacity: 0.15,
        fillColor: "transparent",
        interactive: false,
        className: "boundary-glow"
    }).addTo(map);

    map.fitBounds(polygonBounds, { padding: [40, 40] });

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

        if (incidents.length === 0) {
            console.warn("⚠️ No active incidents found in database.");
            updateKPIs(0, 0, 0, 0);
            showEmptyState();
            return;
        }

        renderGrid(incidents);

    } catch (error) {
        console.error("❌ Error:", error.message);
        updateKPIs(0, 0, 0, 0);
        showErrorState();
    }
}

function renderGrid(incidents) {
    console.log("🔄 Rendering grid with glowing circles...");
    
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
        if (count >= 5) highRiskCells++;

        let color = '#10b981';
        if (count >= 5) {
            color = '#ef4444';
        } else if (count >= 3) {
            color = '#f59e0b';
        }

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
        }).addTo(map);

        const glow = L.circle([cell.lat, cell.lng], {
            radius: radius * 1.8,
            color: 'transparent',
            fillColor: color,
            fillOpacity: 0.08,
            interactive: false,
            className: 'heatmap-glow'
        }).addTo(map);

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
                <td>${item.incident_type || 'N/A'}</td>
                <td>${dateStr} ${timeStr}</td>
                <td><span class="${statusClass}">${item.status || 'Open'}</span></td>
                <td><span class="${dangerClass}">${danger || 'Calculated by System'}</span></td>
                <td>${item.recommended_action || 'Scheduled patrol and risk monitoring'}</td>
                <td><strong>${streetName}</strong></td>
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
    
    console.log("🚀 Grid Heatmap page loaded");
    initializeMap();
});

console.log('✅ grid-heatmap.js loaded successfully');