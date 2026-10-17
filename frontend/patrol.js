/* =========================================================
   PATROL DECISION SUPPORT - CART ENHANCED
   patrol.js - With CART Risk Integration
   ✅ UPDATED: Uses CART risk scores for recommendations
   ✅ FIXED: Auto-updates when CART analysis is run
============================================================ */

// ============================================================
// 1. ROLE-BASED ACCESS CONTROL
// getCurrentUser / getSessionToken / isAdmin / isDecisionMaker /
// isCaptain / applyRoleBasedUI all come from apiHelper.js, loaded
// before this file — no local copies here anymore (they had drifted
// from apiHelper's versions, e.g. missing the Captain label fix).
// ============================================================

// ✅ EXPORTED FOR LOGOUT
window.logoutUser = function() {
    const sessionToken = getSessionToken();
    if (sessionToken) {
        fetch(`${API_URL}/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_token: sessionToken })
        }).catch(() => {});
    }
    sessionStorage.clear();
    window.location.href = 'login.html';
};

// ============================================================
// 2. GLOBAL DATA STORE
// ============================================================

let allIncidents = [];
let allRiskFactors = []; // 🔥 NEW: CART risk factors
let allTanods = [];
// Includes deactivated tanods - only for showing names on older patrol
// logs; pickers keep using allTanods (active only).
let allTanodsForLookup = [];
let allTeams = [];
let allSchedules = [];
let allLogs = [];
// Per-street risk decay from completed patrols - {location: decay_amount},
// subtracted from that street's CART risk score in recommendations.
let allAreaDecay = {};
let scheduleMapPicker;
let scheduleMarker;

// Latest CART recommendations, kept around so the Schedules tab can
// surface the same "Active Priority Recommendations" without
// recomputing them itself.
let currentRecommendations = [];

// Client-side table pagination — allSchedules/allLogs stay fully loaded
// (other features on this page need the complete list: the "Select
// Schedule" dropdown on the log form, getScheduleName()/getTanodName()
// cross-reference lookups, and the CART recommendations tab), only the
// rendered table rows are paginated.
let schedulePage = 1;
let logPage = 1;
const rowsPerPage = 10;

// ============================================================
// 3. DOM READY
// ============================================================

document.addEventListener("DOMContentLoaded", function () {
    console.log('🚀 Patrol page loading with CART integration...');
    
    const user = getCurrentUser();
    console.log('👤 User from session:', user);
    
    if (!user || !user.id) {
        console.log('❌ No user found, redirecting to login');
        window.location.href = 'login.html';
        return;
    }
    
    const token = getSessionToken();
    if (!token) {
        console.log('❌ No token found, redirecting to login');
        window.location.href = 'login.html';
        return;
    }
    
    applyRoleBasedUI();
    setupTabs();
    loadAllData();
    populateScheduleLocationOptions();
    setupScheduleForm();
    setupLogForm();

    // Keeps all three tabs current without the admin needing to
    // re-login: logs submitted from a tanod's phone, schedules added by
    // another admin, and recommendations reacting to new incidents or a
    // CART re-run triggered elsewhere.
    startLivePolling(refreshPatrolLogsOnly, 15000);
    startLivePolling(refreshSchedulesOnly, 15000);
    startLivePolling(refreshRecommendationsOnly, 15000);

    const scheduleStatusFilter = document.getElementById('scheduleStatusFilter');
    if (scheduleStatusFilter) {
        scheduleStatusFilter.addEventListener('change', () => {
            schedulePage = 1;
            renderSchedules(allSchedules);
            updateCounts();
        });
    }
    
    const monthSelect = document.getElementById('monthSelect');
    if (monthSelect) {
        monthSelect.addEventListener('change', function() {
            updateDashboardWithCartData(this.value);
        });
    }
    
    // 🔥 NEW: Listen for CART data updates from cart.js
    window.addEventListener('cartDataUpdated', function() {
        console.log('📢 CART data updated event received!');
        loadCartDataOnly();
    });
    
    // 🔥 NEW: Refresh CART button
    const refreshCartBtn = document.getElementById('refreshCartBtn');
    if (refreshCartBtn) {
        refreshCartBtn.addEventListener('click', function() {
            loadCartDataOnly();
            showToast('Refreshing CART data...', 'info');
        });
    }
    
    // Check sessionStorage for updates from cart page
    const lastCartUpdate = sessionStorage.getItem('cartUpdated');
    if (lastCartUpdate) {
        console.log('📢 Previous CART update detected:', lastCartUpdate);
        // Clear it so we don't reload on every page load
        sessionStorage.removeItem('cartUpdated');
    }
});

// ============================================================
// 4. TABS FUNCTIONALITY
// ============================================================

function setupTabs() {
    const tabBtns = document.querySelectorAll('.patrol-tab');
    const tabContents = document.querySelectorAll('.patrol-tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            const tabId = this.getAttribute('data-tab');
            
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            this.classList.add('active');
            const targetContent = document.getElementById(`tab-${tabId}`);
            if (targetContent) {
                targetContent.classList.add('active');
            }

            // Leaflet can't measure a hidden (display:none) container, so
            // the schedule map picker is lazy-initialized the first time
            // its tab is actually shown, and re-measured on every
            // subsequent visit in case its size was stale while hidden.
            if (tabId === 'schedules') {
                if (!scheduleMapPicker) {
                    initScheduleMapPicker();
                } else {
                    setTimeout(() => scheduleMapPicker.invalidateSize(), 50);
                }
            }
        });
    });
}

/* ============================================================
   SCHEDULE LOCATION MAP PICKER
   Mirrors incident.js's initMapPicker()/isPointInsideBarangay() pattern —
   same libraries (Leaflet + turf.js), same boundary-check approach.
============================================================ */

function isScheduleLocationInsideBarangay(lat, lng) {
    const boundaryPolygon = turf.polygon([
        [...BARANGAY_BOUNDARY_COORDS.map(coord => [coord[1], coord[0]]), [BARANGAY_BOUNDARY_COORDS[0][1], BARANGAY_BOUNDARY_COORDS[0][0]]]
    ]);
    return turf.booleanPointInPolygon(turf.point([lng, lat]), boundaryPolygon);
}

function populateScheduleLocationOptions() {
    const select = document.getElementById('scheduleLocation');
    if (!select || typeof BARANGAY_LOCATIONS === 'undefined') return;

    BARANGAY_LOCATIONS.forEach(location => {
        const option = document.createElement('option');
        option.value = location;
        option.textContent = location;
        select.appendChild(option);
    });
}

function initScheduleMapPicker() {
    const created = createBarangayMap('scheduleMapPicker', {
        zoom: 16,
        zoomControl: false,
        minZoom: 13.5,
        maxZoom: 19
    });
    scheduleMapPicker = created.map;

    scheduleMapPicker.on('click', function (e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        const prompt = document.getElementById('scheduleMapPrompt');

        if (!isScheduleLocationInsideBarangay(lat, lng)) {
            if (prompt) prompt.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Please click inside the barangay boundary!';
            return;
        }

        document.getElementById('scheduleLat').value = lat;
        document.getElementById('scheduleLng').value = lng;
        placeScheduleMarker(lat, lng);

        if (prompt) prompt.innerHTML = '<i class="fa-solid fa-location-dot"></i> Location pinned!';
    });

    setTimeout(() => scheduleMapPicker.invalidateSize(), 50);
}

function placeScheduleMarker(lat, lng) {
    if (scheduleMarker) {
        scheduleMapPicker.removeLayer(scheduleMarker);
    }
    const customIcon = L.divIcon({
        className: 'custom-marker',
        html: '<div style="background: #dc2626; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
    scheduleMarker = L.marker([lat, lng], { icon: customIcon }).addTo(scheduleMapPicker);
    scheduleMapPicker.setView([lat, lng], 16);
}

function resetScheduleMapPicker() {
    document.getElementById('scheduleLat').value = '';
    document.getElementById('scheduleLng').value = '';
    if (scheduleMarker && scheduleMapPicker) {
        scheduleMapPicker.removeLayer(scheduleMarker);
        scheduleMarker = null;
    }
    const prompt = document.getElementById('scheduleMapPrompt');
    if (prompt) prompt.textContent = 'Click the map to pin this location — incidents tanods report here will inherit this exact point on the risk map.';
}

// ============================================================
// 5. LOAD ALL DATA - WITH CART INTEGRATION
// ============================================================

async function loadAllData() {
    try {
        console.log('📡 Loading patrol data with CART integration...');
        
        // Load incidents — CART recommendations need the full active
        // dataset, not one page of it (see /api/incidents' pagination,
        // added for the admin Incident Records list specifically).
        const incResponse = await window.apiFetch('/incidents?limit=10000');
        if (incResponse.ok) {
            const incData = await incResponse.json();
            allIncidents = incData.incidents || [];
            console.log('✅ Incidents loaded:', allIncidents.length);
        } else {
            console.warn('⚠️ Failed to load incidents:', incResponse.status);
            allIncidents = [];
        }
        
        // 🔥 IMPROVED: Load CART risk factors with better error handling
        await loadAreaDecay();
        await loadCartDataOnly();

        // Load tanods
        const tanodResponse = await window.apiFetch('/tanods');
        if (tanodResponse.ok) {
            allTanods = await tanodResponse.json();
            console.log('✅ Tanods loaded:', allTanods.length);
            const allTanodResponse = await window.apiFetch('/tanods/all');
            allTanodsForLookup = allTanodResponse.ok ? await allTanodResponse.json() : allTanods;
        } else {
            console.warn('⚠️ Failed to load tanods:', tanodResponse.status);
            allTanods = [];
        }

        // Load tanod teams (for the Schedules tab's "Assign by Team" picker)
        const teamResponse = await window.apiFetch('/tanod-teams');
        if (teamResponse.ok) {
            allTeams = await teamResponse.json();
        } else {
            console.warn('⚠️ Failed to load tanod teams:', teamResponse.status);
            allTeams = [];
        }

        // Load schedules
        // /all, not /patrol-schedules (Active only) - otherwise a schedule
        // disappears for good once it's marked Completed or Cancelled.
        const scheduleResponse = await window.apiFetch('/patrol-schedules/all');
        if (scheduleResponse.ok) {
            allSchedules = await scheduleResponse.json();
            console.log('✅ Schedules loaded:', allSchedules.length);
        } else {
            console.warn('⚠️ Failed to load schedules. Using empty array.');
            allSchedules = [];
        }
        
        // Load logs
        const logResponse = await window.apiFetch('/patrol-logs');
        if (logResponse.ok) {
            allLogs = await logResponse.json();
            console.log('✅ Logs loaded:', allLogs.length);
        } else {
            console.warn('⚠️ Failed to load logs. Using empty array.');
            allLogs = [];
        }
        
        populateMonthDropdown(allIncidents);
        
        const monthSelect = document.getElementById('monthSelect');
        if (monthSelect && monthSelect.value) {
            // 🔥 UPDATED: Use CART-enhanced dashboard
            updateDashboardWithCartData(monthSelect.value);
        }
        
        renderSchedules(allSchedules);
        renderLogs(allLogs);
        
        populateScheduleDropdown();
        populateTanodDropdown();
        populateTeamSelect();
        renderTanodChecklist();

        updateCounts();
        
    } catch (error) {
        console.error("❌ Error loading data:", error);
        if (error.message !== 'Session expired. Please login again.' && error.message !== 'No session token') {
            showToast('Failed to load patrol data. Please refresh.', 'error');
        }
    }
}

// ============================================================
// 5a2. 🔥 NEW: Refresh only the Patrol Logs list
// Used for live polling — reloading everything via loadAllData()
// would also rebuild the tanod checklist and schedule/tanod dropdowns,
// wiping out any in-progress selection on the Add Schedule form.
// ============================================================

async function refreshPatrolLogsOnly() {
    try {
        const response = await window.apiFetch('/patrol-logs');
        if (!response.ok) return;

        allLogs = await response.json();
        renderLogs(allLogs);
        updateCounts();
    } catch (error) {
        console.error('❌ Error refreshing patrol logs:', error);
    }
}

// Same idea as refreshPatrolLogsOnly() above - only re-renders the
// Schedules table, not populateScheduleDropdown()/renderTanodChecklist()
// (those wipe whatever's currently selected on the Add Log/Add Schedule
// forms since they rebuild <option>/checkbox lists from scratch).
async function refreshSchedulesOnly() {
    try {
        const response = await window.apiFetch('/patrol-schedules/all');
        if (!response.ok) return;

        allSchedules = await response.json();
        renderSchedules(allSchedules);
        updateCounts();
    } catch (error) {
        console.error('❌ Error refreshing schedules:', error);
    }
}

// Recommendations are computed client-side from allIncidents +
// allRiskFactors (see getCartBasedPatrolRecommendations) - refreshing
// both and recomputing picks up both new incidents and a CART re-run
// triggered by another admin, without touching the Schedules/Logs tabs.
async function refreshRecommendationsOnly() {
    try {
        const incResponse = await window.apiFetch('/incidents?limit=10000');
        if (incResponse.ok) {
            const incData = await incResponse.json();
            allIncidents = incData.incidents || [];
        }
        await loadAreaDecay();
        await loadCartDataOnly();
    } catch (error) {
        console.error('❌ Error refreshing recommendations:', error);
    }
}

// ============================================================
// 5b. 🔥 NEW: Function to reload only CART data
// ============================================================

async function loadCartDataOnly() {
    try {
        console.log('🔄 Reloading CART data only...');
        const cartResponse = await window.apiFetch('/cart/risk-factors');
        if (cartResponse.ok) {
            allRiskFactors = await cartResponse.json();
            console.log('✅ CART risk factors reloaded:', allRiskFactors.length);
            
            if (allRiskFactors.length > 0) {
                console.log('📊 Sample CART data:', allRiskFactors[0]);
            } else {
                console.warn('⚠️ No CART risk factors found. Run CART analysis first.');
            }
            
            // Update dashboard with new data
            const monthSelect = document.getElementById('monthSelect');
            if (monthSelect && monthSelect.value) {
                updateDashboardWithCartData(monthSelect.value);
            }
        } else {
            console.warn('⚠️ Failed to reload CART risk factors. Status:', cartResponse.status);
            allRiskFactors = [];
        }
    } catch (error) {
        console.error('❌ Error reloading CART data:', error);
        if (error.message === 'Session expired. Please login again.') {
            throw error;
        }
        allRiskFactors = [];
        // Don't show error for missing CART data - just use empty array
    }
}

// Loads each street's accumulated patrol-completion decay (see
// backend decayAreaRisk/resetAreaRisk) so recommendations can subtract
// it from the live CART score instead of showing the raw figure.
async function loadAreaDecay() {
    try {
        const response = await window.apiFetch('/patrol/area-decay');
        if (!response.ok) {
            allAreaDecay = {};
            return;
        }
        const rows = await response.json();
        allAreaDecay = {};
        rows.forEach(row => {
            allAreaDecay[row.location] = parseFloat(row.decay_amount) || 0;
        });
    } catch (error) {
        console.error('❌ Error loading area risk decay:', error);
        allAreaDecay = {};
    }
}

// ============================================================
// 6. MONTH DROPDOWN
// ============================================================

function populateMonthDropdown(incidents) {
    const monthSelect = document.getElementById('monthSelect');
    if (!monthSelect) return;

    const monthSet = new Set();
    incidents.forEach(item => {
        if (item.date) {
            const parts = item.date.split('-');
            if (parts.length === 3) {
                const key = `${parts[0]}-${parts[1]}`;
                monthSet.add(key);
            }
        }
    });

    const sorted = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
    monthSelect.innerHTML = "";

    if (sorted.length === 0) {
        const opt = document.createElement('option');
        opt.value = "";
        opt.textContent = "No data available";
        monthSelect.appendChild(opt);
        return;
    }

    // "All Dates" sits above the individual months - a separate sentinel
    // value (not an empty string, which updateDashboardWithCartData()
    // already treats as "nothing selected") that skips the month filter
    // entirely in getCartBasedPatrolRecommendations() below.
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All Dates';
    monthSelect.appendChild(allOpt);

    sorted.forEach(key => {
        const [year, month] = key.split('-');
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${monthNames[parseInt(month) - 1]} ${year}`;
        monthSelect.appendChild(opt);
    });

    // Default to the most recent month (not "All Dates") so the normal,
    // most-common view is unchanged - "All Dates" is there for whoever
    // wants it, one click away.
    if (monthSelect.options.length > 1) {
        monthSelect.value = monthSelect.options[1].value;
        updateDashboardWithCartData(monthSelect.value);
    }
}

// ============================================================
// 7. 🔥 NEW: CART-BASED PATROL RECOMMENDATIONS
// ============================================================

function getCartBasedPatrolRecommendations(incidents, riskFactors, month, areaDecay = {}) {
    console.log('🔍 Generating CART-based recommendations for:', month);
    console.log('📊 Incidents available:', incidents.length);
    console.log('📊 Risk factors available:', riskFactors.length);
    
    // 🔥 ADD: Check if there are any risk factors at all
    if (riskFactors.length === 0) {
        console.warn('⚠️ No CART risk factors available!');
        console.log('💡 Run CART analysis from the CART page first.');
        return [{
            area: 'No CART Data Available',
            priority: 'low',
            level: 'Level 1 — Low Danger / Stable Area',
            time: 'N/A',
            reason: 'Please run CART analysis from the CART Analytics page first.',
            pattern: 'No CART data available',
            tanods: 1,
            action: 'Run CART analysis to generate recommendations.',
            avgRisk: 0,
            maxRisk: 0,
            dominantLevel: 'Level 1',
            riskBadgeColor: '#94a3b8',
            count: 0
        }];
    }
    
    // 1. Filter incidents by month - "all" (the "All Dates" option) skips
    // this entirely and considers every recorded incident.
    const monthIncidents = month === 'all'
        ? incidents
        : incidents.filter(item => item.date && item.date.startsWith(month));

    console.log('📊 Month incidents:', monthIncidents.length);

    if (monthIncidents.length === 0) {
        console.warn('⚠️ No incidents found for month:', month);
        return [{
            area: month === 'all' ? 'No Incidents Recorded' : 'No Incidents This Month',
            priority: 'low',
            level: 'Level 1 — Low Danger / Stable Area',
            time: 'N/A',
            reason: month === 'all' ? 'No incidents recorded yet.' : 'No incidents recorded for this month.',
            pattern: 'No incidents to analyze',
            tanods: 0,
            action: 'No patrol recommendations available.',
            avgRisk: 0,
            maxRisk: 0,
            dominantLevel: 'Level 1',
            riskBadgeColor: '#94a3b8',
            count: 0
        }];
    }
    
    // 2. Create a map of incident_id to risk score
    const riskMap = {};
    riskFactors.forEach(risk => {
        riskMap[risk.incident_id] = {
            totalScore: parseFloat(risk.total_risk_score) || 0,
            dangerLevel: risk.danger_level || 'Level 1 — Low Danger / Stable Area',
            timeScore: parseFloat(risk.time_risk_score) || 0,
            locationScore: parseFloat(risk.location_risk_score) || 0,
            typeScore: parseFloat(risk.type_risk_score) || 0,
            frequencyScore: parseFloat(risk.frequency_risk_score) || 0,
            decisionPath: risk.decision_path || ''
        };
    });
    
    console.log('📊 Risk map created with:', Object.keys(riskMap).length, 'entries');
    
    // 3. Group incidents by location with risk aggregation
    const locationData = {};
    monthIncidents.forEach(incident => {
        const location = incident.street_name || incident.location || 'Unknown';
        if (!locationData[location]) {
            locationData[location] = {
                count: 0,
                totalRisk: 0,
                maxRisk: 0,
                avgRisk: 0,
                dangerLevels: [],
                incidents: [],
                riskScores: []
            };
        }
        
        const risk = riskMap[incident.id] || { 
            totalScore: 0, 
            dangerLevel: 'Level 1 — Low Danger / Stable Area' 
        };
        locationData[location].count++;
        locationData[location].totalRisk += risk.totalScore;
        locationData[location].maxRisk = Math.max(locationData[location].maxRisk, risk.totalScore);
        locationData[location].dangerLevels.push(risk.dangerLevel);
        locationData[location].incidents.push(incident);
        locationData[location].riskScores.push(risk.totalScore);
    });
    
    // 4. Calculate average risk and determine danger level
    Object.keys(locationData).forEach(location => {
        const data = locationData[location];
        data.avgRisk = data.totalRisk / data.count;
        
        // Determine dominant danger level
        const levelCount = {};
        data.dangerLevels.forEach(level => {
            let key = 'Level 1';
            if (level.includes('Level 3') || level.includes('High')) {
                key = 'Level 3';
            } else if (level.includes('Level 2') || level.includes('Moderate')) {
                key = 'Level 2';
            }
            levelCount[key] = (levelCount[key] || 0) + 1;
        });
        
        let dominantLevel = 'Level 1';
        let maxCount = 0;
        Object.keys(levelCount).forEach(level => {
            if (levelCount[level] > maxCount) {
                maxCount = levelCount[level];
                dominantLevel = level;
            }
        });
        data.dominantLevel = dominantLevel;

        // Patrol completions at this street shave decay off its score
        // (see loadAreaDecay); a new incident here resets it to 0 on the
        // backend, so this is always relative to the current live risk.
        const decay = areaDecay[location] || 0;
        if (decay > 0) {
            data.maxRisk = Math.max(0, data.maxRisk - decay);
            data.avgRisk = Math.max(0, data.avgRisk - decay);
        }
    });

    // 5. Sort locations by CART risk score (highest first)
    const sortedLocations = Object.entries(locationData)
        .filter(([_, data]) => data.count > 0)
        .sort((a, b) => {
            // Sort by: maxRisk first, then avgRisk, then count
            if (b[1].maxRisk !== a[1].maxRisk) {
                return b[1].maxRisk - a[1].maxRisk;
            }
            if (b[1].avgRisk !== a[1].avgRisk) {
                return b[1].avgRisk - a[1].avgRisk;
            }
            return b[1].count - a[1].count;
        });
    
    console.log('📍 Sorted locations:', sortedLocations.map(([loc, data]) => 
        `${loc}: maxRisk=${data.maxRisk}, avgRisk=${data.avgRisk.toFixed(1)}, count=${data.count}`
    ));
    
    // 6. Generate recommendations based on CART data (all streets with incidents)
    const recommendations = sortedLocations.map(([location, data]) => {
        const { count, avgRisk, maxRisk, dominantLevel, incidents } = data;
        
        // Determine priority based on CART risk levels
        let priority = 'low';
        let levelText = 'Level 1 — Low Danger / Stable Area';
        let action = 'Maintain standard routine patrols and community visibility.';
        let tanods = Math.max(1, Math.ceil(count / 3));
        let riskBadgeColor = '#10b981';
        
        if (dominantLevel === 'Level 3' || maxRisk >= 67) {
            priority = 'high';
            levelText = 'Level 3 — High Crime / Considerable Danger';
            action = 'PRIORITY: Deploy additional tanods, increase patrol frequency, and coordinate with barangay officials.';
            tanods = Math.min(Math.ceil(count / 1.5) + 2, 8);
            riskBadgeColor = '#dc2626';
        } else if (dominantLevel === 'Level 2' || maxRisk >= 34) {
            priority = 'medium';
            levelText = 'Level 2 — Moderate Danger / Caution Area';
            action = 'Deploy targeted patrols, conduct periodic spot checks, and monitor for escalation.';
            tanods = Math.min(Math.ceil(count / 2) + 1, 5);
            riskBadgeColor = '#f59e0b';
        } else {
            priority = 'low';
            levelText = 'Level 1 — Low Danger / Stable Area';
            action = 'Maintain standard routine patrols and community visibility.';
            tanods = Math.max(1, Math.ceil(count / 3));
            riskBadgeColor = '#10b981';
        }
        
        // Get peak time from incidents at this location
        const hourCounts = {};
        incidents.forEach(item => {
            if (item.time) {
                const hour = item.time.split(':')[0];
                hourCounts[hour] = (hourCounts[hour] || 0) + 1;
            }
        });
        const sortedHours = Object.entries(hourCounts).sort((a, b) => b[1] - a[1]);
        let time = 'Flexible Timing';
        if (sortedHours.length > 0) {
            const peak = parseInt(sortedHours[0][0]);
            const end = (peak + 2) % 24;
            time = `${String(peak).padStart(2, '0')}:00 – ${String(end).padStart(2, '0')}:00`;
        }
        
        // Get risk level distribution for display
        const riskDist = {};
        data.riskScores.forEach(score => {
            const level = score >= 67 ? 'High' : score >= 34 ? 'Moderate' : 'Low';
            riskDist[level] = (riskDist[level] || 0) + 1;
        });
        const riskSummary = Object.entries(riskDist)
            .map(([level, count]) => `${count} ${level}`)
            .join(', ');
        
        return {
            area: location,
            priority: priority,
            level: levelText,
            time: time,
            reason: `CART analysis detected ${dominantLevel} risk with ${count} incident${count > 1 ? 's' : ''} (avg risk score: ${avgRisk.toFixed(1)})`,
            pattern: `${count} incident${count > 1 ? 's' : ''} recorded in this area. Risk distribution: ${riskSummary || 'No risk data available'}`,
            riskDist: riskDist,
            tanods: tanods,
            action: action,
            avgRisk: avgRisk,
            maxRisk: maxRisk,
            dominantLevel: dominantLevel,
            riskBadgeColor: riskBadgeColor,
            count: count,
            // The actual incidents behind this recommendation (this month,
            // this street) - shown as type badges on the card itself and
            // carried over when "Use This" prefills the schedule form.
            incidents: incidents
        };
    });
    
    console.log('✅ Generated', recommendations.length, 'CART-based recommendations');
    return recommendations;
}

// ============================================================
// 8. 🔥 UPDATED: DASHBOARD WITH CART DATA
// ============================================================

function updateDashboardWithCartData(selectedMonth) {
    if (!selectedMonth) {
        console.warn('No month selected');
        return;
    }
    
    if (!allIncidents || allIncidents.length === 0) {
        console.warn('No incidents available');
        updateMetricsEmptyState();
        currentRecommendations = [];
        renderScheduleSuggestions([]);
        return;
    }
    
    console.log('📊 Updating dashboard with CART data for:', selectedMonth);
    console.log('📊 Risk factors available:', allRiskFactors.length);
    
    // Get CART-based recommendations
    const recommendations = getCartBasedPatrolRecommendations(
        allIncidents,
        allRiskFactors,
        selectedMonth,
        allAreaDecay
    );
    
    // Update metrics
    if (recommendations.length > 0 && recommendations[0].area !== 'No CART Data Available') {
        const topRec = recommendations[0];
        document.getElementById('topArea').textContent = topRec.area;
        document.getElementById('topTime').textContent = topRec.time;
        document.getElementById('topTanods').textContent = topRec.tanods;
        
        // 🔥 NEW: Show CART risk score in metrics
        const riskBadge = document.getElementById('topRiskBadge');
        const riskScoreEl = document.getElementById('topRiskScore');
        if (riskBadge) {
            if (topRec.avgRisk > 0) {
                riskBadge.textContent = `CART Score: ${topRec.avgRisk.toFixed(1)}`;
                riskBadge.style.backgroundColor = topRec.riskBadgeColor;
            } else {
                riskBadge.textContent = 'No CART Score';
                riskBadge.style.backgroundColor = '#94a3b8';
            }
        }
        if (riskScoreEl) {
            riskScoreEl.textContent = topRec.avgRisk > 0 ? topRec.avgRisk.toFixed(1) : '0.0';
        }
    } else {
        updateMetricsEmptyState();
        // Show message about running CART analysis
        if (recommendations.length > 0 && recommendations[0].area === 'No CART Data Available') {
            document.getElementById('topArea').textContent = 'Run CART Analysis First';
            document.getElementById('topTime').textContent = 'N/A';
            document.getElementById('topTanods').textContent = '0';
            const riskBadge = document.getElementById('topRiskBadge');
            if (riskBadge) {
                riskBadge.textContent = 'No CART Data';
                riskBadge.style.backgroundColor = '#94a3b8';
            }
        }
    }
    
    // Render recommendation cards
    const container = document.getElementById('recommendationsContainer');
    renderCartRecommendationCards(recommendations, container);

    // Keep the Schedules tab's suggestions in sync with the same data.
    currentRecommendations = recommendations;
    renderScheduleSuggestions(recommendations);
}

function updateMetricsEmptyState() {
    document.getElementById('topArea').textContent = 'No Data';
    document.getElementById('topTime').textContent = 'N/A';
    document.getElementById('topTanods').textContent = '0';
    const riskBadge = document.getElementById('topRiskBadge');
    const riskScoreEl = document.getElementById('topRiskScore');
    if (riskBadge) {
        riskBadge.textContent = 'No CART Data';
        riskBadge.style.backgroundColor = '#94a3b8';
    }
    if (riskScoreEl) {
        riskScoreEl.textContent = '0.0';
    }
}

// ============================================================
// 9. 🔥 NEW: RENDER CART RECOMMENDATION CARDS
// ============================================================

function renderCartRecommendationCards(recs, container) {
    if (!container) return;
    container.innerHTML = "";

    // "All Dates" means the incidents behind each card span every recorded
    // month, not just one - the label should say so instead of claiming
    // "This Month" for data that isn't scoped to a month at all.
    const isAllDates = document.getElementById('monthSelect')?.value === 'all';
    const incidentsLabel = isAllDates ? 'Incidents Here:' : 'Incidents Here This Month:';

    if (!recs || recs.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #94a3b8;">
                <i class="fa-regular fa-circle" style="font-size: 2rem; display: block; margin-bottom: 12px;"></i>
                <p>No CART-based recommendations available for this month.</p>
                <p style="font-size: 0.8rem; margin-top: 8px;">Run CART analysis on incidents to generate recommendations.</p>
            </div>
        `;
        return;
    }
    
    recs.forEach((rec, index) => {
        const card = document.createElement("div");
        card.className = `rec-card rec-card-clickable ${rec.priority} fade-transition`;
        card.style.animationDelay = `${index * 0.08}s`;
        
        // 🔥 NEW: CART risk score badge
        const riskBadge = rec.avgRisk !== undefined && rec.avgRisk > 0 ? 
            `<span class="cart-risk-badge" style="background: ${rec.riskBadgeColor || '#0f172a'}; color: white; padding: 2px 10px; border-radius: 12px; font-size: 0.65rem; font-weight: 700; display: inline-block;">
                CART Score: ${rec.avgRisk.toFixed(1)}
            </span>` : 
            `<span class="cart-risk-badge" style="background: #94a3b8; color: white; padding: 2px 10px; border-radius: 12px; font-size: 0.65rem; font-weight: 700; display: inline-block;">
                No CART Score
            </span>`;
        
        card.innerHTML = `
            <div class="rec-card-header">
                <h3>
                    ${escapeHTML(rec.area)}
                    <span style="font-size: 0.7rem; color: #94a3b8; font-weight: normal; margin-left: 8px;">
                        (${rec.count} incident${rec.count > 1 ? 's' : ''})
                    </span>
                </h3>
                <span class="priority-badge ${rec.priority}">${rec.priority.toUpperCase()} PRIORITY</span>
            </div>
            <div class="danger-level ${rec.priority}">${escapeHTML(rec.level)}</div>
            <div style="margin: 6px 0;">
                ${riskBadge}
                ${rec.maxRisk > 0 ? `<span class="cart-risk-badge" style="background: #1e293b; color: #e2e8f0; padding: 2px 10px; border-radius: 12px; font-size: 0.65rem; font-weight: 700; display: inline-block; margin-left: 6px;">
                    Peak: ${rec.maxRisk}
                </span>` : ''}
            </div>
            <div class="rec-details">
                <div><i class="fa-solid fa-clock rec-detail-icon"></i><strong>Recommended Patrol Time:</strong> ${escapeHTML(rec.time)}</div>
                <div><i class="fa-solid fa-magnifying-glass-chart rec-detail-icon"></i><strong>Reason:</strong> ${escapeHTML(rec.reason)}</div>
                <div><i class="fa-solid fa-chart-pie rec-detail-icon"></i><strong>Incident Pattern:</strong> ${escapeHTML(rec.pattern)}</div>
                ${riskDistBadgeHtml(rec.riskDist)}
                <div style="margin-top: 6px;"><i class="fa-solid fa-tags rec-detail-icon"></i><strong>${incidentsLabel}</strong><br>
                    ${typeCountsToBadgeHtml(countIncidentTypesIn(rec.incidents), 4)}
                </div>
                ${incidentListItemsHtml(rec.incidents, 4)}
                <div><i class="fa-solid fa-user-shield rec-detail-icon"></i><strong>Suggested Tanods:</strong> ${escapeHTML(rec.tanods)}</div>
                <div><i class="fa-solid fa-bullhorn rec-detail-icon"></i><strong>Suggested Action:</strong> ${escapeHTML(rec.action)}</div>
            </div>
            <div class="rec-card-view-hint"><i class="fa-solid fa-expand"></i> Click for full street details</div>
        `;
        card.addEventListener('click', () => showStreetDetailModal(rec));
        container.appendChild(card);
    });
}

// ============================================================
// 9a2. STREET DETAIL MODAL - full breakdown for one recommendation,
// opened by clicking its card. Shows every incident behind the
// recommendation (the card itself only shows the first 4).
// ============================================================

function fullIncidentListHtml(incidents) {
    if (!incidents || incidents.length === 0) {
        return '<p style="color: #94a3b8; font-size: 0.8rem; text-align: center; padding: 16px 0;">No incidents recorded.</p>';
    }

    const statusClassMap = { Open: 'badge-open', Monitoring: 'badge-monitoring', Resolved: 'badge-resolved' };
    const sorted = [...incidents].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const rows = sorted.map(inc => {
        const statusClass = statusClassMap[inc.status] || 'badge-open';
        const cartScore = inc.cart_score != null ? `<span class="badge-subtle cart-score-chip" style="font-size: 0.62rem;">CART ${parseFloat(inc.cart_score).toFixed(0)}</span>` : '';
        return `
            <div class="street-modal-incident-row">
                <div class="street-modal-incident-main">
                    <span class="street-modal-incident-date">${escapeHTML(inc.date || 'N/A')}${inc.time ? ' · ' + escapeHTML(inc.time.slice(0, 5)) : ''}</span>
                    <span class="street-modal-incident-type">${escapeHTML(inc.incident_type || 'N/A')}</span>
                </div>
                <div class="street-modal-incident-badges">
                    ${cartScore}
                    <span class="badge ${statusClass}" style="font-size: 0.62rem;">${escapeHTML(inc.status || 'Open')}</span>
                </div>
            </div>
        `;
    }).join('');

    return `<div class="street-modal-incident-list">${rows}</div>`;
}

function showStreetDetailModal(rec) {
    const modal = document.getElementById('streetDetailModal');
    const content = document.getElementById('streetDetailModalContent');
    if (!modal || !content || !rec) return;

    const riskBadge = rec.avgRisk > 0
        ? `<span class="cart-risk-badge" style="background: ${rec.riskBadgeColor || '#0f172a'}; color: white;">CART Score: ${rec.avgRisk.toFixed(1)}</span>`
        : `<span class="cart-risk-badge" style="background: #94a3b8; color: white;">No CART Score</span>`;

    content.innerHTML = `
        <div class="rec-card-header" style="margin-bottom: 4px;">
            <h3 style="font-size: 1.15rem;">
                ${escapeHTML(rec.area)}
                <span style="font-size: 0.75rem; color: #94a3b8; font-weight: normal; margin-left: 8px;">
                    (${rec.count} incident${rec.count > 1 ? 's' : ''})
                </span>
            </h3>
            <span class="priority-badge ${rec.priority}">${rec.priority.toUpperCase()} PRIORITY</span>
        </div>
        <div class="danger-level ${rec.priority}" style="margin-bottom: 10px;">${escapeHTML(rec.level)}</div>
        <div style="margin-bottom: 10px;">
            ${riskBadge}
            ${rec.maxRisk > 0 ? `<span class="cart-risk-badge" style="background: #1e293b; color: #e2e8f0; margin-left: 6px;">Peak: ${rec.maxRisk}</span>` : ''}
        </div>
        <div class="rec-details">
            <div><i class="fa-solid fa-clock rec-detail-icon"></i><strong>Recommended Patrol Time:</strong> ${escapeHTML(rec.time)}</div>
            <div><i class="fa-solid fa-magnifying-glass-chart rec-detail-icon"></i><strong>Reason:</strong> ${escapeHTML(rec.reason)}</div>
            <div><i class="fa-solid fa-chart-pie rec-detail-icon"></i><strong>Incident Pattern:</strong> ${escapeHTML(rec.pattern)}</div>
            ${riskDistBadgeHtml(rec.riskDist)}
            <div><i class="fa-solid fa-user-shield rec-detail-icon"></i><strong>Suggested Tanods:</strong> ${escapeHTML(rec.tanods)}</div>
            <div><i class="fa-solid fa-bullhorn rec-detail-icon"></i><strong>Suggested Action:</strong> ${escapeHTML(rec.action)}</div>
        </div>
        <div class="street-modal-section-label"><i class="fa-solid fa-list-ul"></i> All Incidents at This Location (${rec.incidents?.length || 0})</div>
        ${fullIncidentListHtml(rec.incidents)}
    `;

    modal.classList.add('active');
}

function closeStreetDetailModal() {
    document.getElementById('streetDetailModal')?.classList.remove('active');
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('streetDetailCloseBtn')?.addEventListener('click', closeStreetDetailModal);
    document.getElementById('streetDetailModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'streetDetailModal') closeStreetDetailModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeStreetDetailModal();
    });
});

// ============================================================
// 9b. 🔥 NEW: SURFACE RECOMMENDATIONS ON THE SCHEDULES TAB
// Compact version of the same CART recommendations, shown above the
// "Add Patrol Schedule" form so admins see the priority areas without
// switching back to the Recommendations tab. "Use This" prefills the
// form below instead of building the schedule from scratch.
// ============================================================

function renderScheduleSuggestions(recs) {
    const section = document.getElementById('scheduleSuggestionsSection');
    const container = document.getElementById('scheduleSuggestionsContainer');
    if (!section || !container) return;

    // Placeholder entries (no CART data / no incidents this month) carry
    // count: 0 — real recommendations always have at least one incident.
    const validRecs = (recs || []).filter(rec => rec.count > 0);

    if (validRecs.length === 0) {
        section.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    section.style.display = '';
    container.innerHTML = '';

    validRecs.forEach(rec => {
        const idx = recs.indexOf(rec);
        const card = document.createElement('div');
        card.className = `rec-card ${rec.priority}`;

        card.innerHTML = `
            <div class="rec-card-header">
                <h3>${escapeHTML(rec.area)}</h3>
                <span class="priority-badge ${rec.priority}">${rec.priority.toUpperCase()} PRIORITY</span>
            </div>
            <div class="danger-level ${rec.priority}">${escapeHTML(rec.level)}</div>
            <div class="rec-details">
                <div><strong>Recommended Patrol Time:</strong> ${escapeHTML(rec.time)}</div>
                <div style="margin-top: 4px;"><strong>Incidents Here:</strong><br>
                    ${typeCountsToBadgeHtml(countIncidentTypesIn(rec.incidents), 2)}
                </div>
                <div><strong>Suggested Tanods:</strong> ${escapeHTML(rec.tanods)}</div>
            </div>
            <button type="button" class="use-this-btn" onclick="applyRecommendationToScheduleForm(${idx})">
                <i class="fa-solid fa-arrow-turn-down"></i> Use This
            </button>
        `;
        container.appendChild(card);
    });
}

// Prefills the Add Patrol Schedule form from a recommendation card.
// Only location, time, and reason are inferable from CART's monthly
// aggregate — day of week and which tanods to assign are still a human
// call, so those fields are left for the admin to set.
function applyRecommendationToScheduleForm(idx) {
    const rec = currentRecommendations[idx];
    if (!rec) return;

    // Applying a suggestion always starts a fresh schedule, not an edit.
    document.getElementById('editScheduleId').value = '';
    document.getElementById('scheduleFormTitle').textContent = 'Add Patrol Schedule';
    document.getElementById('scheduleSubmitBtn').innerHTML = '<i class="fa-solid fa-save"></i> Save Schedule';
    document.getElementById('scheduleFormCard')?.classList.remove('edit-modal-mode');
    dockScheduleFormCard();

    const locationSelect = document.getElementById('scheduleLocation');
    if ([...locationSelect.options].some(opt => opt.value === rec.area)) {
        locationSelect.value = rec.area;
    }
    updateScheduleLocationIncidents();

    const timeParts = rec.time.split(' – ');
    if (timeParts.length === 2) {
        document.getElementById('scheduleStart').value = timeParts[0];
        document.getElementById('scheduleEnd').value = timeParts[1];
    }

    document.getElementById('scheduleReason').value =
        `Suggested from CART priority recommendation: ${rec.reason}. ${rec.action}`;

    document.getElementById('scheduleFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`Prefilled from "${rec.area}" — suggested ${rec.tanods} tanod(s). Review day and assignment before saving.`, 'info');
}

// ============================================================
// 10. SCHEDULES CRUD
// ============================================================

// Shared by the schedule and log forms below - both just wire a submit
// handler to their own save function.
function setupFormSubmit(formId, saveFn) {
    const form = document.getElementById(formId);
    if (!form) return;

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        saveFn();
    });
}

// Shared empty-state row for the schedule/log tables.
function emptyTableRow(colspan, icon, message) {
    return `
        <tr class="empty-row">
            <td colspan="${colspan}">
                <div class="empty-content">
                    <i class="fa-solid ${icon}"></i>
                    <span>${message}</span>
                </div>
            </td>
        </tr>
    `;
}

// Shared delete-confirmation dispatch: show the styled modal if it's on
// the page, otherwise fall back to a plain confirm() + direct call.
function requestDelete(message, id, type, onConfirmFallback) {
    if (typeof showDeleteModal === 'function') {
        showDeleteModal(message, id, type);
    } else if (confirm(message)) {
        onConfirmFallback(id);
    }
}

// Shared DELETE + reload + toast, used by both confirmDeleteSchedule and
// confirmDeleteLog - only the endpoint and messages differ.
async function confirmDelete(endpoint, id, successMsg, errorMsg) {
    try {
        const response = await window.apiFetch(`${endpoint}/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(errorMsg);

        await loadAllData();
        showToast(successMsg, 'success');
    } catch (error) {
        console.error(`${errorMsg}:`, error);
        showToast(`${errorMsg}.`, 'error');
    }
}

function setupScheduleForm() {
    setupFormSubmit('scheduleForm', saveSchedule);

    const locationSelect = document.getElementById('scheduleLocation');
    if (locationSelect) {
        locationSelect.addEventListener('change', updateScheduleLocationIncidents);
    }

    const teamSelect = document.getElementById('scheduleTeamSelect');
    if (teamSelect) {
        teamSelect.addEventListener('change', () => {
            applyTeamToChecklist(teamSelect.value);
            teamSelect.value = '';
        });
    }

    const closeBtn = document.getElementById('closeScheduleModalBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeScheduleModal);

    const modalHost = document.getElementById('scheduleFormCard');
    if (modalHost) {
        modalHost.addEventListener('click', function (e) {
            if (e.target === this && this.classList.contains('edit-modal-mode')) {
                closeScheduleModal();
            }
        });
    }
}

async function saveSchedule() {
    const id = document.getElementById('editScheduleId').value;
    const location = document.getElementById('scheduleLocation').value.trim();
    const day_of_week = document.getElementById('scheduleDay').value;
    const start_time = document.getElementById('scheduleStart').value;
    const end_time = document.getElementById('scheduleEnd').value;
    const tanod_ids = getCheckedTanodIds();
    const reason = document.getElementById('scheduleReason').value.trim();
    const status = document.getElementById('scheduleStatus').value;
    const latRaw = document.getElementById('scheduleLat').value;
    const lngRaw = document.getElementById('scheduleLng').value;

    if (!location || !start_time || !end_time || !day_of_week) {
        showToast('Please fill in all required fields.', 'error');
        return;
    }

    const payload = {
        location,
        start_time,
        end_time,
        day_of_week,
        tanod_ids,
        latitude: latRaw ? parseFloat(latRaw) : null,
        longitude: lngRaw ? parseFloat(lngRaw) : null,
        reason,
        status
    };

    const method = id ? 'PUT' : 'POST';
    const url = id ? `/patrol-schedules/${id}` : '/patrol-schedules';

    try {
        const response = await window.apiFetch(url, {
            method: method,
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to save schedule');

        resetScheduleFormState();

        await loadAllData();
        showToast('Schedule saved successfully!', 'success');
    } catch (error) {
        console.error('Error saving schedule:', error);
        showToast('Failed to save schedule.', 'error');
    }
}

// Resets the Add/Edit Patrol Schedule form back to its "Add" state and,
// if it was popped up as a modal to edit an existing schedule, closes
// that modal too - shared by a successful save, the close (X) button,
// and a backdrop click.
function resetScheduleFormState() {
    document.getElementById('scheduleForm').reset();
    document.getElementById('editScheduleId').value = '';
    document.getElementById('scheduleFormTitle').textContent = 'Add Patrol Schedule';
    document.getElementById('scheduleSubmitBtn').innerHTML = '<i class="fa-solid fa-save"></i> Save Schedule';
    updateScheduleLocationIncidents();
    resetScheduleMapPicker();
    document.getElementById('scheduleFormCard')?.classList.remove('edit-modal-mode');
    dockScheduleFormCard();
}

// The schedules table lives in its own "Patrol Schedules" tab, but the
// Add/Edit form card lives in the "Schedules" tab. A fixed-position popup
// still disappears while its tab is display:none, so for editing the card
// is moved to <body> and put back in its tab spot when the popup closes.
let scheduleFormCardHome = null;

function undockScheduleFormCard() {
    const card = document.getElementById('scheduleFormCard');
    if (!card || card.parentNode === document.body) return;
    if (!scheduleFormCardHome) {
        scheduleFormCardHome = document.createComment('scheduleFormCard home');
    }
    card.parentNode.insertBefore(scheduleFormCardHome, card);
    document.body.appendChild(card);
}

function dockScheduleFormCard() {
    const card = document.getElementById('scheduleFormCard');
    if (!card || !scheduleFormCardHome || !scheduleFormCardHome.parentNode) return;
    scheduleFormCardHome.parentNode.insertBefore(card, scheduleFormCardHome);
    scheduleFormCardHome.remove();
}

// Pops the Add/Edit Patrol Schedule form card up as a centered modal
// over the Schedules table - used only when editing an existing
// schedule (see editSchedule()). Creating a new one leaves the form in
// its normal in-page position.
function openScheduleModal() {
    const card = document.getElementById('scheduleFormCard');
    if (!card) return;
    undockScheduleFormCard();
    card.classList.add('edit-modal-mode');
    if (scheduleMapPicker) {
        setTimeout(() => scheduleMapPicker.invalidateSize(), 50);
    }
}

function closeScheduleModal() {
    resetScheduleFormState();
}

// Shared client-side paginator for a table body: renders one page's
// worth of rows (via rowRenderFn) and a Prev/Next/numbered control list
// (reusing the same .pagination-controls/.page-item/.page-link markup
// and CSS as the server-paginated Incident Records table).
function renderPaginatedTable(items, page, controlsId, onPageChange, rowRenderFn, emptyColspan, emptyIcon, emptyText) {
    const totalPages = Math.max(1, Math.ceil(items.length / rowsPerPage));
    const clampedPage = Math.min(Math.max(1, page), totalPages);
    const start = (clampedPage - 1) * rowsPerPage;
    const pageItems = items.slice(start, start + rowsPerPage);

    const controls = document.getElementById(controlsId);
    if (controls) {
        if (totalPages <= 1) {
            controls.innerHTML = '';
        } else {
            let html = `<li class="page-item ${clampedPage === 1 ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${clampedPage - 1}">Previous</a></li>`;
            for (let i = 1; i <= totalPages; i++) {
                html += `<li class="page-item ${i === clampedPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
            }
            html += `<li class="page-item ${clampedPage === totalPages ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${clampedPage + 1}">Next</a></li>`;
            controls.innerHTML = html;

            controls.querySelectorAll('.page-link').forEach(link => {
                link.addEventListener('click', function (e) {
                    e.preventDefault();
                    const p = parseInt(this.dataset.page);
                    if (p && p !== clampedPage && p >= 1 && p <= totalPages) {
                        onPageChange(p);
                    }
                });
            });
        }
    }

    return { pageItems, clampedPage, totalPages, isEmpty: items.length === 0 };
}

// Groups allIncidents by street_name so a Schedules/Logs row can show
// what's actually been happening at that location at a glance, instead
// of admins having to cross-reference Incident Records by hand to tell
// otherwise-identical rows (same day/time pattern, different location)
// apart.
// Shared core for every "what incidents happened here" badge display -
// the Patrol Schedules/Logs tables (all-time, by location), the CART
// recommendation cards (this month only, by recommendation), and the
// Add Schedule form's location info panel (all-time, by location) all
// render the same count-per-type pill style from a plain incidents array.
function countIncidentTypesIn(incidents) {
    const counts = {};
    (incidents || []).forEach(inc => {
        counts[inc.incident_type] = (counts[inc.incident_type] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function typeCountsToBadgeHtml(typeCounts, maxShown = 2) {
    if (typeCounts.length === 0) {
        return '<span style="font-size: 0.72rem; color: #94a3b8;">No incidents recorded</span>';
    }

    const shown = typeCounts.slice(0, maxShown);
    const remaining = typeCounts.length - shown.length;
    const badges = shown.map(([type, count]) =>
        `<span class="badge-subtle" style="font-size: 0.65rem; padding: 2px 8px; white-space: nowrap;">${escapeHTML(type)} (${count})</span>`
    ).join(' ');
    const moreBadge = remaining > 0
        ? `<span class="badge-subtle" style="font-size: 0.65rem; padding: 2px 8px;" title="${escapeHTML(typeCounts.slice(maxShown).map(([t, c]) => `${t} (${c})`).join(', '))}">+${remaining} more</span>`
        : '';

    return `<div style="display: flex; flex-wrap: wrap; gap: 4px; max-width: 220px;">${badges}${moreBadge}</div>`;
}

function getIncidentTypesForLocation(location) {
    return countIncidentTypesIn((allIncidents || []).filter(inc => inc.street_name === location));
}

// Colored High/Moderate/Low chips for a recommendation's riskDist (e.g.
// {High: 3, Moderate: 1}), reusing the .risk-tag classes already defined
// in patrol.css.
function riskDistBadgeHtml(riskDist) {
    if (!riskDist) return '';
    const order = [['High', 'high'], ['Moderate', 'medium'], ['Low', 'low']];
    const chips = order
        .filter(([level]) => riskDist[level])
        .map(([level, cls]) => `<span class="risk-tag ${cls}">${riskDist[level]} ${level}</span>`)
        .join('');
    return chips ? `<div class="risk-distribution">${chips}</div>` : '';
}

// Individual incidents behind a recommendation (date, type, status) -
// more specific than the aggregated type-count badges above, which only
// say "how many of each type" without saying when or what happened to them.
function incidentListItemsHtml(incidents, maxShown = 4) {
    if (!incidents || incidents.length === 0) return '';

    const statusClassMap = { Open: 'badge-open', Monitoring: 'badge-monitoring', Resolved: 'badge-resolved' };
    const sorted = [...incidents].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const shown = sorted.slice(0, maxShown);
    const remaining = sorted.length - shown.length;

    const rows = shown.map(inc => {
        const dateDisplay = inc.date ? inc.date.slice(5).replace('-', '/') : 'N/A';
        const statusClass = statusClassMap[inc.status] || 'badge-open';
        return `
            <div class="incident-mini-row">
                <span class="incident-mini-date">${escapeHTML(dateDisplay)}</span>
                <span class="incident-mini-type">${escapeHTML(inc.incident_type || 'N/A')}</span>
                <span class="badge ${statusClass}" style="font-size: 0.6rem; padding: 1px 7px;">${escapeHTML(inc.status || 'Open')}</span>
            </div>
        `;
    }).join('');

    const more = remaining > 0
        ? `<div class="incident-mini-more">+${remaining} more incident${remaining > 1 ? 's' : ''}</div>`
        : '';

    return `<div class="incident-mini-list">${rows}${more}</div>`;
}

function renderIncidentTypeBadges(location, maxShown = 2) {
    return typeCountsToBadgeHtml(getIncidentTypesForLocation(location), maxShown);
}

// Updates the Add/Edit Schedule form's "Incidents Reported At This
// Location" panel to match whatever the Location dropdown currently
// holds - called on manual selection, and explicitly after any script
// that sets scheduleLocation.value directly (which doesn't fire 'change').
function updateScheduleLocationIncidents() {
    const group = document.getElementById('scheduleLocationIncidentsGroup');
    const container = document.getElementById('scheduleLocationIncidents');
    if (!group || !container) return;

    const location = document.getElementById('scheduleLocation')?.value;
    if (!location) {
        group.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.innerHTML = renderIncidentTypeBadges(location, 6);
    group.style.display = '';
}

// Active schedules first, then Completed, then Cancelled - each group in
// weekday then start-time order - narrowed by the Status dropdown.
const SCHEDULE_STATUS_ORDER = { Active: 0, Completed: 1, Cancelled: 2 };
const WEEKDAY_ORDER = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };

function getVisibleSchedules(schedules) {
    const filter = document.getElementById('scheduleStatusFilter')?.value || '';
    return (schedules || [])
        .filter(s => !filter || (s.status || 'Active') === filter)
        .sort((a, b) =>
            ((SCHEDULE_STATUS_ORDER[a.status || 'Active'] ?? 3) - (SCHEDULE_STATUS_ORDER[b.status || 'Active'] ?? 3)) ||
            ((WEEKDAY_ORDER[a.day_of_week] ?? 7) - (WEEKDAY_ORDER[b.day_of_week] ?? 7)) ||
            String(a.start_time || '').localeCompare(String(b.start_time || '')) ||
            (a.id - b.id)
        );
}

function renderSchedules(schedules) {
    const tbody = document.getElementById('scheduleTableBody');
    if (!tbody) return;

    const visible = getVisibleSchedules(schedules);

    if (visible.length === 0) {
        const filter = document.getElementById('scheduleStatusFilter')?.value;
        tbody.innerHTML = emptyTableRow(8, 'fa-calendar-times', filter ? `No ${filter.toLowerCase()} patrol schedules.` : 'No patrol schedules found.');
        document.getElementById('schedulePaginationControls').innerHTML = '';
        return;
    }

    const { pageItems } = renderPaginatedTable(
        visible, schedulePage, 'schedulePaginationControls',
        (p) => { schedulePage = p; renderSchedules(allSchedules); }
    );

    const groupCounts = {};
    visible.forEach(s => { const st = s.status || 'Active'; groupCounts[st] = (groupCounts[st] || 0) + 1; });
    const groupIcons = { Active: 'fa-person-walking', Completed: 'fa-circle-check', Cancelled: 'fa-ban' };

    // A divider row starts each status group (and repeats at the top of a
    // page that continues a group), so Active and Completed never blend.
    let previousStatus = null;
    tbody.innerHTML = pageItems.map(schedule => {
        const status = schedule.status || 'Active';
        const groupRow = status !== previousStatus
            ? `<tr class="schedule-group-row"><td colspan="8"><i class="fa-solid ${groupIcons[status] || 'fa-list'}"></i> ${escapeHTML(status)} schedules<span class="schedule-group-count">(${groupCounts[status]})</span></td></tr>`
            : '';
        previousStatus = status;
        const statusClass = schedule.status === 'Active' ? 'badge-open' :
                           schedule.status === 'Completed' ? 'badge-resolved' : 'badge-monitoring';
        const timeDisplay = `${schedule.start_time ? schedule.start_time.substring(0,5) : 'N/A'} - ${schedule.end_time ? schedule.end_time.substring(0,5) : 'N/A'}`;

        return groupRow + `
            <tr>
                <td class="font-bold">${schedule.id}</td>
                <td>${escapeHTML(schedule.location)}</td>
                <td>${escapeHTML(schedule.day_of_week)}</td>
                <td>${timeDisplay}</td>
                <td>${schedule.assigned_tanods || 0}</td>
                <td>${renderIncidentTypeBadges(schedule.location)}</td>
                <td><span class="badge ${statusClass}">${schedule.status || 'Active'}</span></td>
                <td>
                    <button type="button" class="btn-action-edit admin-action" onclick="editSchedule(${schedule.id})"><i class="fa-solid fa-pen"></i> Update</button>
                </td>
            </tr>
        `;
    }).join('');
}

window.editSchedule = async function(id) {
    try {
        const response = await window.apiFetch(`/patrol-schedules/${id}`);
        if (!response.ok) throw new Error('Failed to fetch schedule');
        
        const schedule = await response.json();
        
        document.getElementById('editScheduleId').value = schedule.id;
        document.getElementById('scheduleLocation').value = schedule.location || '';
        updateScheduleLocationIncidents();
        document.getElementById('scheduleDay').value = schedule.day_of_week || 'Monday';
        document.getElementById('scheduleStart').value = schedule.start_time ? schedule.start_time.substring(0,5) : '';
        document.getElementById('scheduleEnd').value = schedule.end_time ? schedule.end_time.substring(0,5) : '';
        renderTanodChecklist(schedule.tanod_ids || []);
        document.getElementById('scheduleStatus').value = schedule.status || 'Active';
        document.getElementById('scheduleReason').value = schedule.reason || '';

        // Show the popup first: the map picker can only be created (or
        // measured) once its container is visible - and when editing from
        // the Patrol Schedules tab the Schedules tab may never have opened.
        openScheduleModal();
        if (!scheduleMapPicker) initScheduleMapPicker();

        if (scheduleMapPicker) {
            if (schedule.latitude != null && schedule.longitude != null) {
                document.getElementById('scheduleLat').value = schedule.latitude;
                document.getElementById('scheduleLng').value = schedule.longitude;
                placeScheduleMarker(parseFloat(schedule.latitude), parseFloat(schedule.longitude));
                const prompt = document.getElementById('scheduleMapPrompt');
                if (prompt) prompt.innerHTML = '<i class="fa-solid fa-location-dot"></i> Location pinned! Click elsewhere on the map to move it.';
            } else {
                resetScheduleMapPicker();
            }
            setTimeout(() => scheduleMapPicker.invalidateSize(), 50);
        }

        document.getElementById('scheduleFormTitle').textContent = 'Edit Patrol Schedule';
        document.getElementById('scheduleSubmitBtn').innerHTML = '<i class="fa-solid fa-pen"></i> Update Schedule';
    } catch (error) {
        console.error('Error fetching schedule:', error);
        showToast('Failed to load schedule details.', 'error');
    }
};

window.requestDeleteSchedule = function(id) {
    const schedule = allSchedules.find(s => s.id === id);
    const message = schedule
        ? `Are you sure you want to delete the schedule for "${schedule.location}"? It will be moved to the Archive (Settings > Archive), where an Administrator can restore it.`
        : 'Are you sure you want to delete this schedule? It will be moved to the Archive (Settings > Archive), where an Administrator can restore it.';
    requestDelete(message, id, 'schedule', confirmDeleteSchedule);
};

window.confirmDeleteSchedule = function(id) {
    return confirmDelete('/patrol-schedules', id, 'Schedule deleted successfully.', 'Failed to delete schedule');
};

// ============================================================
// 11. LOGS CRUD
// ============================================================

function setupLogForm() {
    setupFormSubmit('logForm', saveLog);
}

async function saveLog() {
    const id = document.getElementById('editLogId').value;
    const schedule_id = parseInt(document.getElementById('logSchedule').value);
    const tanod_id = parseInt(document.getElementById('logTanod').value);
    const patrol_date = document.getElementById('logDate').value;
    const status = document.getElementById('logStatus').value;
    const report = document.getElementById('logReport').value.trim();

    if (!schedule_id || !tanod_id || !patrol_date) {
        showToast('Please fill in all required fields.', 'error');
        return;
    }

    const payload = { 
        schedule_id, 
        tanod_id, 
        patrol_date, 
        status, 
        report
    };

    const method = id ? 'PUT' : 'POST';
    const url = id ? `/patrol-logs/${id}` : '/patrol-logs';

    try {
        const response = await window.apiFetch(url, {
            method: method,
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to save log');

        document.getElementById('logForm').reset();
        document.getElementById('editLogId').value = '';
        document.getElementById('logFormTitle').textContent = 'Add Patrol Log';
        document.getElementById('logSubmitBtn').innerHTML = '<i class="fa-solid fa-save"></i> Save Log';

        await loadAllData();
        showToast('Log saved successfully!', 'success');
    } catch (error) {
        console.error('Error saving log:', error);
        showToast('Failed to save log.', 'error');
    }
}

function renderLogs(logs) {
    const tbody = document.getElementById('logTableBody');
    if (!tbody) return;

    if (!logs || logs.length === 0) {
        tbody.innerHTML = emptyTableRow(8, 'fa-clipboard-list', 'No patrol logs found.');
        document.getElementById('logPaginationControls').innerHTML = '';
        return;
    }

    const { pageItems } = renderPaginatedTable(
        logs, logPage, 'logPaginationControls',
        (p) => { logPage = p; renderLogs(allLogs); }
    );

    tbody.innerHTML = pageItems.map(log => {
        const statusClass = log.status === 'Completed' ? 'badge-open' :
                           log.status === 'Partial' ? 'badge-monitoring' : 'badge-resolved';
        const scheduleName = getScheduleName(log.schedule_id);
        const tanodName = getTanodName(log.tanod_id);

        return `
            <tr>
                <td class="font-bold">${log.id}</td>
                <td>${escapeHTML(scheduleName)}</td>
                <td>${escapeHTML(tanodName)}</td>
                <td>${log.patrol_date || 'N/A'}</td>
                <td>${renderIncidentTypeBadges(scheduleName)}</td>
                <td><span class="badge ${statusClass}">${log.status || 'Completed'}</span></td>
                <td style="max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(log.report || '')}">${escapeHTML(log.report || 'N/A')}</td>
                <td>
                    <button type="button" class="btn-action-edit admin-action" onclick="editLog(${log.id})"><i class="fa-solid fa-pen"></i> Edit</button>
                </td>
            </tr>
        `;
    }).join('');
}

function getScheduleName(id) {
    if (!id) return 'N/A';
    const schedule = allSchedules.find(s => s.id === id);
    return schedule ? schedule.location : 'Unknown Schedule';
}

function getTanodName(id) {
    if (!id) return 'N/A';
    const tanod = allTanodsForLookup.find(t => t.id === id) || allTanods.find(t => t.id === id);
    return tanod ? tanod.name : 'Unknown Tanod';
}

window.editLog = async function(id) {
    try {
        const response = await window.apiFetch(`/patrol-logs/${id}`);
        if (!response.ok) throw new Error('Failed to fetch log');
        
        const log = await response.json();
        
        document.getElementById('editLogId').value = log.id;
        document.getElementById('logSchedule').value = log.schedule_id || '';
        document.getElementById('logTanod').value = log.tanod_id || '';
        document.getElementById('logDate').value = log.patrol_date || '';
        document.getElementById('logStatus').value = log.status || 'Completed';
        document.getElementById('logReport').value = log.report || '';
        
        document.getElementById('logFormTitle').textContent = 'Edit Patrol Log';
        document.getElementById('logSubmitBtn').innerHTML = '<i class="fa-solid fa-pen"></i> Update Log';
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        console.error('Error fetching log:', error);
        showToast('Failed to load log details.', 'error');
    }
};

window.requestDeleteLog = function(id) {
    const log = allLogs.find(l => l.id === id);
    const message = log
        ? `Are you sure you want to delete the patrol log for "${getScheduleName(log.schedule_id)}" (${getTanodName(log.tanod_id)})? It will be moved to the Archive (Settings > Archive), where an Administrator can restore it.`
        : 'Are you sure you want to delete this log? It will be moved to the Archive (Settings > Archive), where an Administrator can restore it.';
    requestDelete(message, id, 'log', confirmDeleteLog);
};

window.confirmDeleteLog = function(id) {
    return confirmDelete('/patrol-logs', id, 'Log deleted successfully.', 'Failed to delete log');
};

// ============================================================
// 12. DROPDOWN POPULATORS
// ============================================================

function populateScheduleDropdown() {
    const select = document.getElementById('logSchedule');
    if (!select) return;

    select.innerHTML = '<option value="">Select Schedule</option>';
    
    if (!allSchedules || allSchedules.length === 0) {
        const opt = document.createElement('option');
        opt.value = "";
        opt.textContent = "No schedules available";
        opt.disabled = true;
        select.appendChild(opt);
        return;
    }
    
    allSchedules.forEach(schedule => {
        const option = document.createElement('option');
        option.value = schedule.id;
        const timeDisplay = schedule.start_time && schedule.end_time 
            ? `${schedule.start_time.substring(0,5)}-${schedule.end_time.substring(0,5)}` 
            : '';
        const statusTag = schedule.status && schedule.status !== 'Active' ? ` — ${schedule.status}` : '';
        option.textContent = `${schedule.location} (${schedule.day_of_week} ${timeDisplay})${statusTag}`;
        select.appendChild(option);
    });
}

function populateTanodDropdown() {
    const select = document.getElementById('logTanod');
    if (!select) return;

    select.innerHTML = '<option value="">Select Tanod</option>';
    
    if (!allTanods || allTanods.length === 0) {
        const opt = document.createElement('option');
        opt.value = "";
        opt.textContent = "No tanods available";
        opt.disabled = true;
        select.appendChild(opt);
        return;
    }
    
    allTanods.forEach(tanod => {
        const option = document.createElement('option');
        option.value = tanod.id;
        option.textContent = tanod.name;
        select.appendChild(option);
    });
}

// Populates the "Assign by Team" dropdown above the tanod checklist -
// choosing a team checks all of its members' boxes in one click instead
// of finding each one individually. Managed from User & Tanod
// Management's Tanod List tab (frontend/users.js).
function populateTeamSelect() {
    const select = document.getElementById('scheduleTeamSelect');
    if (!select) return;

    select.innerHTML = '<option value="">— Select a team to auto-check its members —</option>' +
        allTeams.map(team => `<option value="${team.id}">${escapeHTML(team.name)} (${team.member_count})</option>`).join('');
}

// Checks (doesn't uncheck) every tanod belonging to the selected team,
// leaving the admin free to add/remove individuals afterward rather
// than forcing the checklist to exactly match the team roster.
function applyTeamToChecklist(teamId) {
    if (!teamId) return;

    const memberIds = new Set(
        allTanods.filter(t => String(t.team_id) === String(teamId)).map(t => String(t.id))
    );

    document.querySelectorAll('#scheduleTanodsChecklist input[type="checkbox"]').forEach(checkbox => {
        if (memberIds.has(checkbox.value)) {
            checkbox.checked = true;
        }
    });
}

function renderTanodChecklist(checkedIds = []) {
    const container = document.getElementById('scheduleTanodsChecklist');
    if (!container) return;

    if (!allTanods || allTanods.length === 0) {
        container.innerHTML = '<p class="tanod-checklist-empty">No active tanods available. Add tanods in User Management first.</p>';
        return;
    }

    const checkedSet = new Set(checkedIds.map(id => String(id)));

    container.innerHTML = allTanods.map(tanod => `
        <label class="tanod-checklist-item">
            <input type="checkbox" value="${tanod.id}" ${checkedSet.has(String(tanod.id)) ? 'checked' : ''}>
            <span>${escapeHTML(tanod.name)}${tanod.position ? ` <span style="color:#64748b;">(${escapeHTML(tanod.position)})</span>` : ''}</span>
        </label>
    `).join('');
}

function getCheckedTanodIds() {
    const container = document.getElementById('scheduleTanodsChecklist');
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => parseInt(cb.value, 10));
}

// ============================================================
// 13. UPDATE COUNTS
// ============================================================

function updateCounts() {
    const scheduleCount = document.getElementById('scheduleCount');
    const logCount = document.getElementById('logCount');

    if (scheduleCount) {
        const total = allSchedules ? allSchedules.length : 0;
        const filter = document.getElementById('scheduleStatusFilter')?.value;
        scheduleCount.textContent = filter
            ? `${getVisibleSchedules(allSchedules).length} of ${total} schedules`
            : `${total} schedules`;
    }

    if (logCount) {
        logCount.textContent = `${allLogs ? allLogs.length : 0} logs`;
    }
}

// ============================================================
// 14. HELPERS
// ============================================================

function escapeHTML(value) {
    if (!value) return "";
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showToast(message, type = "success") {
    const existingToast = document.querySelector(".toast");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.style.cssText = `
        position: fixed;
        right: 28px;
        bottom: 28px;
        min-width: 280px;
        max-width: 400px;
        padding: 14px 18px;
        border-radius: 10px;
        background-color: ${type === 'success' ? '#059669' : '#dc2626'};
        color: #ffffff;
        box-shadow: 0 10px 25px rgba(15, 23, 42, 0.25);
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 0.8rem;
        font-weight: 600;
        transform: translateY(30px);
        opacity: 0;
        pointer-events: none;
        transition: all 0.3s ease;
        z-index: 9999;
    `;

    const icon = type === "success" ? "fa-circle-check" : "fa-circle-exclamation";

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${escapeHTML(message)}</span>
    `;

    document.body.appendChild(toast);

    requestAnimationFrame(function () {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    });

    setTimeout(function () {
        toast.style.transform = 'translateY(30px)';
        toast.style.opacity = '0';
        setTimeout(function () {
            toast.remove();
        }, 300);
    }, 2500);
}

console.log('✅ patrol.js loaded successfully with CART integration');