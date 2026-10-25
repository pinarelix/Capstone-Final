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
let patrolThresholds = { level2: 34, level3: 67 };
let allSchedules = [];
let allLogs = [];
// Per-street risk decay from completed patrols - {location: decay_amount},
// subtracted from that street's CART risk score in recommendations.
let allAreaDecay = {};

// Latest CART suggestions are rendered as unsaved rows in the same table
// as confirmed schedules. This keeps planning in one place and leaves the
// data model ready for the future Kanban workflow.
let currentRecommendations = [];
window.getPatrolHeatmapRecords = () => allIncidents;

function localPatrolDateKey(date = new Date()) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function selectedPatrolMonth() {
    return document.getElementById('monthSelect')?.value.slice(0, 7) || '';
}

function stepPatrolMonth(direction) {
    const input = document.getElementById('monthSelect');
    if (!input) return;
    const base = input.value ? new Date(input.value + 'T12:00:00') : new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + direction);
    input.value = localPatrolDateKey(base);
    updateDashboardWithCartData(selectedPatrolMonth());
    window.populateActiveHeatmapRecords?.();
}

// Schedule and log records are loaded in server-backed result windows.
// scheduleChoices separately supplies the log form's schedule selector.
let schedulePage = 1;
let logPage = 1;
let scheduleTotal = 0, logTotal = 0;
let scheduleChoices = [];
function scheduleListUrl() { return '/patrol-schedules/all?' + new URLSearchParams({
    page: schedulePage,
    limit: 10,
    status: document.getElementById('scheduleStatusFilter')?.value === 'Suggested'
        ? ''
        : document.getElementById('scheduleStatusFilter')?.value || '',
    search: document.getElementById('scheduleSearch')?.value.trim() || ''
}); }
function logListUrl() { return '/patrol-logs?' + new URLSearchParams({
    page: logPage,
    limit: 10,
    search: document.getElementById('logSearch')?.value.trim() || ''
}); }
const rowsPerPage = 10;

// ============================================================
// 3. DOM READY
// ============================================================

document.addEventListener("DOMContentLoaded", function () {
    console.log('🚀 Patrol page loading with CART integration...');
    
    const user = getCurrentUser();
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
    setupScheduleForm();
    setupLogForm();

    // Keeps all three tabs current without the admin needing to
    // re-login: logs submitted from the field, schedules added by
    // another admin, and recommendations reacting to new incidents or a
    // CART re-run triggered elsewhere.
    startLivePolling(refreshPatrolLogsOnly, 15000);
    startLivePolling(refreshSchedulesOnly, 15000);
    startLivePolling(refreshRecommendationsOnly, 15000);

    const scheduleStatusFilter = document.getElementById('scheduleStatusFilter');
    if (scheduleStatusFilter) {
        scheduleStatusFilter.addEventListener('change', () => {
            schedulePage = 1;
            refreshSchedulesOnly();
            updateCounts();
        });
    }

    document.getElementById('newScheduleBtn')?.addEventListener('click', openNewScheduleModal);

    for (const [id, refresh, resetPage] of [
        ['scheduleSearch', refreshSchedulesOnly, () => { schedulePage = 1; }],
        ['logSearch', refreshPatrolLogsOnly, () => { logPage = 1; }]
    ]) {
        const input = document.getElementById(id);
        if (!input) continue;
        let debounce;
        input.addEventListener('input', () => {
            clearTimeout(debounce);
            resetPage();
            debounce = setTimeout(refresh, 250);
        });
    }
    
    const monthSelect = document.getElementById('monthSelect');
    if (monthSelect) {
        monthSelect.addEventListener('change', function() {
            updateDashboardWithCartData(selectedPatrolMonth());
            window.populateActiveHeatmapRecords?.();
        });
    }
    document.getElementById('patrolPreviousMonth')?.addEventListener('click', () => stepPatrolMonth(-1));
    document.getElementById('patrolNextMonth')?.addEventListener('click', () => stepPatrolMonth(1));
    
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

        });
    });
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
        const incResponse = await window.apiFetch('/heatmap/records?window_days=90&limit=500');
        if (incResponse.ok) {
            const incData = await incResponse.json();
            allIncidents = incData.records || [];
            patrolThresholds = incData.thresholds;
            window.populateActiveHeatmapRecords?.();
            console.log('✅ Incidents loaded:', allIncidents.length);
        } else {
            console.warn('⚠️ Failed to load incidents:', incResponse.status);
            allIncidents = [];
        }
        
        // 🔥 IMPROVED: Load CART risk factors with better error handling
        await loadAreaDecay();
        await loadCartDataOnly();

        // Load schedules
        // /all, not /patrol-schedules (Active only) - otherwise a schedule
        // disappears for good once it's marked Completed or Cancelled.
        const scheduleResponse = await window.apiFetch(scheduleListUrl());
        if (scheduleResponse.ok) {
            allSchedules = await scheduleResponse.json();
            scheduleTotal = Number(scheduleResponse.headers.get('X-Total-Count'));
            console.log('✅ Schedules loaded:', allSchedules.length);
        } else {
            console.warn('⚠️ Failed to load schedules. Using empty array.');
            allSchedules = [];
        }
        
        // Load logs
        const logResponse = await window.apiFetch(logListUrl());
        if (logResponse.ok) {
            allLogs = await logResponse.json();
            logTotal = Number(logResponse.headers.get('X-Total-Count'));
            console.log('✅ Logs loaded:', allLogs.length);
        } else {
            console.warn('⚠️ Failed to load logs. Using empty array.');
            allLogs = [];
        }
        
        populateMonthDropdown(allIncidents);
        window.populateActiveHeatmapRecords?.();
        
        const monthSelect = document.getElementById('monthSelect');
        if (monthSelect && monthSelect.value) {
            // 🔥 UPDATED: Use CART-enhanced dashboard
            updateDashboardWithCartData(selectedPatrolMonth());
        }
        
        renderSchedules(allSchedules);
        renderLogs(allLogs);
        
        await loadScheduleChoices();

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
// would also rebuild the schedule dropdown, wiping out any in-progress
// selection on the Add Schedule form.
// ============================================================

async function refreshPatrolLogsOnly() {
    try {
        const response = await window.apiFetch(logListUrl());
        if (!response.ok) return;

        allLogs = await response.json();
        logTotal = Number(response.headers.get('X-Total-Count'));
        renderLogs(allLogs);
        updateCounts();
    } catch (error) {
        console.error('❌ Error refreshing patrol logs:', error);
    }
}

// Same idea as refreshPatrolLogsOnly() above - only re-renders the
// Schedules table, not populateScheduleDropdown()
// (those wipe whatever's currently selected on the Add Log/Add Schedule
// forms since they rebuild <option>/checkbox lists from scratch).
async function refreshSchedulesOnly() {
    try {
        const response = await window.apiFetch(scheduleListUrl());
        if (!response.ok) return;

        allSchedules = await response.json();
        scheduleTotal = Number(response.headers.get('X-Total-Count'));
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
        const incResponse = await window.apiFetch('/heatmap/records?window_days=90&limit=500');
        if (incResponse.ok) {
            const incData = await incResponse.json();
            allIncidents = incData.records || [];
            patrolThresholds = incData.thresholds;
            window.populateActiveHeatmapRecords?.();
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
        {
            // Recommendations use the same current, policy-filtered records
            // and scores as the map, including records not yet persisted by a
            // full CART recomputation.
            allRiskFactors = allIncidents.map(record => ({
                incident_id: record.id, total_risk_score: record.cart_score,
                danger_level: record.danger_level, decision_path: record.cart_decision_path
            }));
            console.log('✅ CART risk factors reloaded:', allRiskFactors.length);
            
            if (allRiskFactors.length > 0) {
                console.log('📊 Sample CART data:', allRiskFactors[0]);
            } else {
                console.warn('⚠️ No CART risk factors found. Run CART analysis first.');
            }
            
            // Update dashboard with new data
            const monthSelect = document.getElementById('monthSelect');
            if (monthSelect && monthSelect.value) {
                updateDashboardWithCartData(selectedPatrolMonth());
            }
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
    const calendar = document.getElementById('monthSelect');
    if (!calendar) return;
    if (!calendar.value) {
        const newestRecordDate = incidents
            .map(item => String(item.date || '').slice(0, 10))
            .filter(Boolean)
            .sort((a, b) => b.localeCompare(a))[0];
        calendar.value = newestRecordDate || localPatrolDateKey();
    }
    updateDashboardWithCartData(selectedPatrolMonth());
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
            personnel: 1,
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
            personnel: 0,
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

        // Coverage is operational context; retain the actual CART score.
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
        let personnel = Math.max(1, Math.ceil(count / 3));
        let riskBadgeColor = '#10b981';

        if (dominantLevel === 'Level 3' || maxRisk >= patrolThresholds.level3) {
            priority = 'high';
            levelText = 'Level 3 — High Crime / Considerable Danger';
            action = 'PRIORITY: Deploy additional personnel, increase patrol frequency, and coordinate with barangay officials.';
            personnel = Math.min(Math.ceil(count / 1.5) + 2, 8);
            riskBadgeColor = '#dc2626';
        } else if (dominantLevel === 'Level 2' || maxRisk >= patrolThresholds.level2) {
            priority = 'medium';
            levelText = 'Level 2 — Moderate Danger / Caution Area';
            action = 'Deploy targeted patrols, conduct periodic spot checks, and monitor for escalation.';
            personnel = Math.min(Math.ceil(count / 2) + 1, 5);
            riskBadgeColor = '#f59e0b';
        } else {
            priority = 'low';
            levelText = 'Level 1 — Low Danger / Stable Area';
            action = 'Maintain standard routine patrols and community visibility.';
            personnel = Math.max(1, Math.ceil(count / 3));
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
            const level = score >= patrolThresholds.level3 ? 'High' : score >= patrolThresholds.level2 ? 'Moderate' : 'Low';
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
            personnel: personnel,
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
        renderSchedules(allSchedules);
        updateCounts();
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
        document.getElementById('topPersonnel').textContent = topRec.personnel;
        
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
            document.getElementById('topPersonnel').textContent = '0';
            const riskBadge = document.getElementById('topRiskBadge');
            if (riskBadge) {
                riskBadge.textContent = 'No CART Data';
                riskBadge.style.backgroundColor = '#94a3b8';
            }
        }
    }
    
    // Recommendations and saved schedules now share the planning table.
    currentRecommendations = recommendations;
    renderSchedules(allSchedules);
    updateCounts();
}

function updateMetricsEmptyState() {
    document.getElementById('topArea').textContent = 'No Data';
    document.getElementById('topTime').textContent = 'N/A';
    document.getElementById('topPersonnel').textContent = '0';
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
    
    // Severity first, then newest incident date. Recommendations are not
    // appointments, so incident dates are used only as a recency tie-breaker.
    const severity = { high: 3, medium: 2, low: 1 };
    const latestIncident = rec => (rec.incidents || []).reduce((latest, inc) => {
        const date = String(inc.date || inc.incident_date || '').slice(0, 10);
        return date > latest ? date : latest;
    }, '');
    const ordered = [...recs].sort((a, b) =>
        (severity[b.priority] || 0) - (severity[a.priority] || 0) ||
        latestIncident(b).localeCompare(latestIncident(a)) ||
        (b.maxRisk || 0) - (a.maxRisk || 0));
    ordered.forEach((rec, index) => {
        const card = document.createElement("div");
        card.className = `rec-card rec-card-clickable ${rec.priority}`;
        card.setAttribute('role','option'); card.setAttribute('aria-selected','false'); card.tabIndex = index === 0 ? 0 : -1;
        
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
                <div><i class="fa-solid fa-user-shield rec-detail-icon"></i><strong>Suggested Personnel:</strong> ${escapeHTML(rec.personnel)}</div>
                <div><i class="fa-solid fa-bullhorn rec-detail-icon"></i><strong>Suggested Action:</strong> ${escapeHTML(rec.action)}</div>
            </div>
            <div class="rec-card-view-hint"><i class="fa-solid fa-expand"></i> Click for full street details</div>
        `;
        const select = () => container.querySelectorAll('[role="option"]').forEach(option => {
            option.setAttribute('aria-selected',String(option === card)); option.tabIndex = option === card ? 0 : -1;
        });
        card.addEventListener('click', () => { select(); showStreetDetailModal(rec); });
        card.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); return; }
            if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
            const options = [...container.querySelectorAll('[role="option"]')].filter(option=>!option.hidden);
            const index = options.indexOf(card), next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length-1 : Math.max(0,Math.min(options.length-1,index+(event.key === 'ArrowDown' ? 1 : -1)));
            event.preventDefault(); options[next]?.focus();
        });
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
            <div><i class="fa-solid fa-user-shield rec-detail-icon"></i><strong>Suggested Personnel:</strong> ${escapeHTML(rec.personnel)}</div>
            <div><i class="fa-solid fa-bullhorn rec-detail-icon"></i><strong>Suggested Action:</strong> ${escapeHTML(rec.action)}</div>
        </div>
        <div class="street-modal-section-label"><i class="fa-solid fa-list-ul"></i> All Incidents at This Location (${rec.incidents?.length || 0})</div>
        ${fullIncidentListHtml(rec.incidents)}
        <div style="text-align: center; margin-top: 18px; padding-top: 14px; border-top: 1px solid #e2e8f0;">
            <button type="button" id="modalAddScheduleBtn" class="btn btn-primary" style="padding: 10px 28px; font-size: 0.95rem; border-radius: 8px; cursor: pointer;">
                <i class="fa-solid fa-calendar-plus"></i> Add Patrol Schedule
            </button>
        </div>
    `;

    document.getElementById('modalAddScheduleBtn')?.addEventListener('click', () => {
        closeStreetDetailModal();
        const idx = currentRecommendations.indexOf(rec);
        if (idx !== -1) {
            applyRecommendationToScheduleForm(idx);
        } else {
            applyRecommendationToScheduleForm(0);
        }
    });

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

// Prefills the Add Patrol Schedule form from a recommendation card.
// Only location, time, and reason are inferable from CART's monthly
// aggregate — day of week is still a human call, so that field is left
// for the admin to set.
function applyRecommendationToScheduleForm(idx) {
    const rec = currentRecommendations[idx];
    if (!rec) return;

    // Applying a suggestion always starts a fresh schedule, not an edit.
    document.getElementById('editScheduleId').value = '';
    document.getElementById('scheduleFormTitle').innerHTML = '<i class="fa-solid fa-plus-circle"></i> Add Patrol Schedule';
    document.getElementById('scheduleSubmitBtn').innerHTML = '<i class="fa-solid fa-save"></i> Save Schedule';

    const sourceRecord = [...(rec.incidents || [])]
        .filter(record => allIncidents.some(active => Number(active.id) === Number(record.id)))
        .sort((a, b) => (Number(b.cart_score) || 0) - (Number(a.cart_score) || 0))[0];
    if (!sourceRecord) {
        showToast('This suggestion no longer has an active heatmap record.', 'error');
        return;
    }
    window.populateActiveHeatmapRecords?.(sourceRecord.id);
    window.selectScheduleRecord?.(sourceRecord.id, { keepReason: true });

    const timeParts = rec.time.split(' – ');
    if (timeParts.length === 2) {
        document.getElementById('scheduleStart').value = timeParts[0];
        document.getElementById('scheduleEnd').value = timeParts[1];
    }

    if (rec.priority === 'high') {
        document.getElementById('schedulePriority').value = 'High';
    } else if (rec.priority === 'medium') {
        document.getElementById('schedulePriority').value = 'Moderate';
    } else {
        document.getElementById('schedulePriority').value = 'Low';
    }

    document.getElementById('scheduleReason').value =
        `Suggested from CART priority recommendation: ${rec.reason}. ${rec.action}`;

    openScheduleModal();
    showToast(`Prepared from the highest-risk active record in ${rec.area}. Assign a team before saving.`, 'info');
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
    const incidentId = Number(document.getElementById('scheduleRecordId').value);
    const location = document.getElementById('scheduleLocation').value.trim();
    const day_of_week = document.getElementById('scheduleDay').value;
    const start_time = document.getElementById('scheduleStart').value;
    const end_time = document.getElementById('scheduleEnd').value;
    const reason = document.getElementById('scheduleReason').value.trim();
    const status = document.getElementById('scheduleStatus').value;
    const teamName = document.getElementById('scheduleTeamName').value.trim();
    const memberIds = [...document.getElementById('scheduleTanods').selectedOptions].map(option => Number(option.value));
    const latRaw = document.getElementById('scheduleLat').value;
    const lngRaw = document.getElementById('scheduleLng').value;

    if (!incidentId || !location) {
        showToast('Choose an active heatmap record for this patrol.', 'error');
        return;
    }
    if (!teamName || memberIds.length === 0) {
        showToast('Enter a team name and select at least one team member.', 'error');
        return;
    }
    if (!document.getElementById('scheduleDate').value || !start_time || !end_time || !day_of_week) {
        showToast('Complete the patrol date and time window.', 'error');
        return;
    }

    const payload = {
        incident_id: incidentId,
        scheduled_date: document.getElementById('scheduleDate').value || null,
        priority: document.getElementById('schedulePriority').value,
        exact_address: document.getElementById('scheduleExactAddress').value,
        team_name: teamName,
        tanod_ids: memberIds,
        location,
        start_time,
        end_time,
        day_of_week,
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

        if (!response.ok) { const data = await response.json(); throw new Error(data.details?.join('; ') || data.error || 'Failed to save schedule'); }

        resetScheduleFormState();

        await loadAllData();
        showToast('Schedule saved successfully!', 'success');
    } catch (error) {
        console.error('Error saving schedule:', error);
        showToast(error.message, 'error');
    }
}

// Resets the Add/Edit Patrol Schedule form back to its "Add" state and,
// if it was popped up as a modal to edit an existing schedule, closes
// that modal too - shared by a successful save, the close (X) button,
// and a backdrop click.
function resetScheduleFormState() {
    document.getElementById('scheduleForm').reset();
    document.getElementById('editScheduleId').value = '';
    document.getElementById('scheduleRecordId').value = '';
    document.getElementById('scheduleRecordSummary').textContent = '';
    document.getElementById('scheduleLocation').value = '';
    document.getElementById('scheduleExactAddress').value = '';
    document.getElementById('scheduleLat').value = '';
    document.getElementById('scheduleLng').value = '';
    document.getElementById('scheduleFormTitle').textContent = 'Add Patrol Schedule';
    document.getElementById('scheduleSubmitBtn').innerHTML = '<i class="fa-solid fa-save"></i> Save Schedule';
    window.populateActiveHeatmapRecords?.();
    const card = document.getElementById('scheduleFormCard');
    card?.classList.remove('edit-modal-mode');
    if (card) card.hidden = true;
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
    card.hidden = false;
    card.classList.add('edit-modal-mode');
}

function openNewScheduleModal() {
    resetScheduleFormState();
    document.getElementById('scheduleFormTitle').innerHTML = '<i class="fa-solid fa-plus-circle"></i> Add Patrol Schedule';
    openScheduleModal();
}

function closeScheduleModal() {
    resetScheduleFormState();
}

// Shared client-side paginator for a table body: renders one page's
// worth of rows (via rowRenderFn) and a Prev/Next/numbered control list
// (reusing the same .pagination-controls/.page-item/.page-link markup
// and CSS as the server-paginated Incident Records table).
function renderPaginatedTable(items, page, controlsId, onPageChange, serverTotal) {
    const totalPages = Math.max(1, Math.ceil((serverTotal ?? items.length) / rowsPerPage));
    const clampedPage = Math.min(Math.max(1, page), totalPages);
    const start = (clampedPage - 1) * rowsPerPage;
    const pageItems = serverTotal === undefined ? items.slice(start, start + rowsPerPage) : items;

    const controls = document.getElementById(controlsId);
    if (controls) {
        if (totalPages <= 1) {
            controls.innerHTML = '';
        } else {
            let html = `<li class="page-item ${clampedPage === 1 ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${clampedPage - 1}">Previous</a></li>`;
            for (let i = Math.max(1,clampedPage-2); i <= Math.min(totalPages,clampedPage+2); i++) {
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

function getVisibleRecommendations() {
    const status = document.getElementById('scheduleStatusFilter')?.value || '';
    if (status && status !== 'Suggested') return [];
    const search = document.getElementById('scheduleSearch')?.value.trim().toLowerCase() || '';
    return (currentRecommendations || [])
        .filter(rec => rec.count > 0)
        .filter(rec => !search || [rec.area, rec.priority, rec.level, rec.reason, rec.action, rec.time]
            .some(value => String(value || '').toLowerCase().includes(search)))
        .sort((a, b) => (b.maxRisk || 0) - (a.maxRisk || 0));
}

function recommendationRow(rec) {
    const index = currentRecommendations.indexOf(rec);
    const priority = rec.priority === 'high' ? 'High' : rec.priority === 'medium' ? 'Medium' : 'Low';
    return `
        <tr class="schedule-suggestion-row">
            <td><span class="source-chip"><i class="fa-solid fa-wand-magic-sparkles"></i> Suggested</span></td>
            <td><strong>${escapeHTML(rec.area)}</strong><br><small>${escapeHTML(rec.reason)}</small></td>
            <td><span class="text-muted">Choose date</span></td>
            <td>${escapeHTML(rec.time)}</td>
            <td><span class="text-muted">Assign team</span></td>
            <td><span class="priority-badge ${escapeHTML(rec.priority)}">${priority} priority</span></td>
            <td class="schedule-row-actions">
                <button type="button" class="btn-action-view" onclick="showRecommendationDetails(${index})"><i class="fa-regular fa-eye"></i> Details</button>
                <button type="button" class="btn-action-edit admin-action" onclick="applyRecommendationToScheduleForm(${index})"><i class="fa-solid fa-calendar-plus"></i> Schedule</button>
            </td>
        </tr>`;
}

window.showRecommendationDetails = function(index) {
    const recommendation = currentRecommendations[Number(index)];
    if (recommendation) showStreetDetailModal(recommendation);
};

function renderSchedules(schedules) {
    const tbody = document.getElementById('scheduleTableBody');
    if (!tbody) return;

    const statusFilter = document.getElementById('scheduleStatusFilter')?.value || '';
    const visible = statusFilter === 'Suggested' ? [] : getVisibleSchedules(schedules);
    const suggestions = getVisibleRecommendations();

    if (visible.length === 0 && suggestions.length === 0) {
        const filter = document.getElementById('scheduleStatusFilter')?.value;
        tbody.innerHTML = emptyTableRow(7, 'fa-calendar-times', filter ? `No ${filter.toLowerCase()} patrol schedules.` : 'No patrol schedules found.');
        document.getElementById('schedulePaginationControls').innerHTML = '';
        return;
    }

    const suggestionOnly = statusFilter === 'Suggested';
    const { pageItems } = renderPaginatedTable(
        suggestionOnly ? suggestions : visible,
        schedulePage,
        'schedulePaginationControls',
        (p) => { schedulePage = p; suggestionOnly ? renderSchedules(allSchedules) : refreshSchedulesOnly(); },
        suggestionOnly ? undefined : scheduleTotal
    );

    const groupCounts = {};
    visible.forEach(s => { const st = s.status || 'Active'; groupCounts[st] = (groupCounts[st] || 0) + 1; });
    const groupIcons = { Active: 'fa-person-walking', Completed: 'fa-circle-check', Cancelled: 'fa-ban' };

    // A divider row starts each status group (and repeats at the top of a
    // page that continues a group), so Active and Completed never blend.
    let previousStatus = null;
    const suggestionRows = suggestionOnly
        ? pageItems.map(recommendationRow).join('')
        : schedulePage === 1 && suggestions.length
            ? `<tr class="schedule-group-row schedule-suggested-group"><td colspan="7"><i class="fa-solid fa-wand-magic-sparkles"></i> Suggested patrols<span class="schedule-group-count">(${suggestions.length})</span></td></tr>` + suggestions.slice(0, 5).map(recommendationRow).join('')
            : '';

    const savedRows = (suggestionOnly ? [] : pageItems).map(schedule => {
        const status = schedule.status || 'Active';
        const groupRow = status !== previousStatus
            ? `<tr class="schedule-group-row"><td colspan="7"><i class="fa-solid ${groupIcons[status] || 'fa-list'}"></i> ${escapeHTML(status)} schedules<span class="schedule-group-count">(${groupCounts[status]})</span></td></tr>`
            : '';
        previousStatus = status;
        const statusClass = schedule.status === 'Active' ? 'badge-open' :
                           schedule.status === 'Completed' ? 'badge-resolved' : 'badge-monitoring';
        const timeDisplay = `${schedule.start_time ? schedule.start_time.substring(0,5) : 'N/A'} - ${schedule.end_time ? schedule.end_time.substring(0,5) : 'N/A'}`;

        return groupRow + `
            <tr>
                <td class="font-bold">${schedule.id}</td>
                <td>${escapeHTML(schedule.location)}${schedule.exact_address ? '<br><small>' + escapeHTML(schedule.exact_address) + '</small>' : ''}${schedule.incident_id ? '<br><small>Record #' + Number(schedule.incident_id) + ' · ' + escapeHTML(schedule.priority || '') + ' risk</small>' : ''}</td>
                <td>${escapeHTML(schedule.scheduled_date || schedule.day_of_week)}</td>
                <td>${timeDisplay}</td>
                <td><strong>${escapeHTML(schedule.team_name || 'Unassigned')}</strong>${schedule.tanods?.length ? '<br><small>' + schedule.tanods.map(t => escapeHTML(t.name)).join(', ') + '</small>' : '<br><small>No members assigned</small>'}</td>
                <td><span class="badge ${statusClass}">${schedule.status || 'Active'}</span></td>
                <td>
                    <button type="button" class="btn-action-edit admin-action" onclick="editSchedule(${schedule.id})"><i class="fa-solid fa-pen"></i> Update</button>
                </td>
            </tr>
        `;
    }).join('');
    tbody.innerHTML = suggestionRows + savedRows;
}

window.editSchedule = async function(id) {
    try {
        const response = await window.apiFetch(`/patrol-schedules/${id}`);
        if (!response.ok) throw new Error('Failed to fetch schedule');
        
        const schedule = await response.json();
        await window.loadScheduleTanods(schedule.tanod_ids || []);
        window.populateActiveHeatmapRecords?.(schedule.incident_id);
        const sourceSelect = document.getElementById('scheduleRecordSelect');
        if (schedule.incident_id && ![...sourceSelect.options].some(option => option.value === String(schedule.incident_id))) {
            sourceSelect.add(new Option(`Linked historical record #${schedule.incident_id}`, schedule.incident_id));
        }
        sourceSelect.value = schedule.incident_id || '';
        document.getElementById('scheduleRecordId').value = schedule.incident_id || '';
        document.getElementById('scheduleDate').value = schedule.scheduled_date || '';
        document.getElementById('schedulePriority').value = schedule.priority || 'Low';
        document.getElementById('scheduleExactAddress').value = schedule.exact_address || '';
        document.getElementById('scheduleRecordSummary').textContent = schedule.incident_id ? 'Linked record #' + schedule.incident_id : '';
        document.getElementById('scheduleTeamName').value = schedule.team_name || '';
        
        document.getElementById('editScheduleId').value = schedule.id;
        document.getElementById('scheduleLocation').value = schedule.location || '';
        document.getElementById('scheduleDay').value = schedule.day_of_week || 'Monday';
        document.getElementById('scheduleStart').value = schedule.start_time ? schedule.start_time.substring(0,5) : '';
        document.getElementById('scheduleEnd').value = schedule.end_time ? schedule.end_time.substring(0,5) : '';
        document.getElementById('scheduleStatus').value = schedule.status || 'Active';
        document.getElementById('scheduleReason').value = schedule.reason || '';

        openScheduleModal();
        document.getElementById('scheduleLat').value = schedule.latitude ?? '';
        document.getElementById('scheduleLng').value = schedule.longitude ?? '';

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
        ? `Are you sure you want to delete the schedule for "${schedule.location}"? It will be moved to the Archive (Settings > Archive), where the Executive Officer can restore it.`
        : 'Are you sure you want to delete this schedule? It will be moved to the Archive (Settings > Archive), where the Executive Officer can restore it.';
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
    const patrol_date = document.getElementById('logDate').value;
    const status = document.getElementById('logStatus').value;
    const report = document.getElementById('logReport').value.trim();

    if (!schedule_id || !patrol_date) {
        showToast('Please fill in all required fields.', 'error');
        return;
    }

    const payload = { 
        schedule_id, 
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
        tbody.innerHTML = emptyTableRow(7, 'fa-clipboard-list', 'No patrol logs found.');
        document.getElementById('logPaginationControls').innerHTML = '';
        return;
    }

    const { pageItems } = renderPaginatedTable(
        logs, logPage, 'logPaginationControls',
        (p) => { logPage = p; refreshPatrolLogsOnly(); }, logTotal
    );

    tbody.innerHTML = pageItems.map(log => {
        const statusClass = log.status === 'Completed' ? 'badge-open' :
                           log.status === 'Partial' ? 'badge-monitoring' : 'badge-resolved';
        const scheduleName = log.schedule_location || getScheduleName(log.schedule_id);

        return `
            <tr>
                <td class="font-bold">${log.id}</td>
                <td>${escapeHTML(scheduleName)}</td>
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

window.editLog = async function(id) {
    try {
        const response = await window.apiFetch(`/patrol-logs/${id}`);
        if (!response.ok) throw new Error('Failed to fetch log');
        
        const log = await response.json();
        await ensureScheduleOption(log.schedule_id);
        
        document.getElementById('editLogId').value = log.id;
        document.getElementById('logSchedule').value = log.schedule_id || '';
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
        ? `Are you sure you want to delete the patrol log for "${getScheduleName(log.schedule_id)}" (${log.patrol_date || 'no date'})? It will be moved to the Archive (Settings > Archive), where the Executive Officer can restore it.`
        : 'Are you sure you want to delete this log? It will be moved to the Archive (Settings > Archive), where the Executive Officer can restore it.';
    requestDelete(message, id, 'log', confirmDeleteLog);
};

window.confirmDeleteLog = function(id) {
    return confirmDelete('/patrol-logs', id, 'Log deleted successfully.', 'Failed to delete log');
};

// ============================================================
// 12. DROPDOWN POPULATORS
// ============================================================

async function ensureScheduleOption(id) {
    const select=document.getElementById('logSchedule');
    if(!id || !select || [...select.options].some(option=>Number(option.value)===Number(id))) return;
    const response=await window.apiFetch('/patrol-schedules/'+encodeURIComponent(id)); if(!response.ok) return;
    const schedule=await response.json();
    select.add(new Option(`${schedule.location} (${schedule.day_of_week} ${schedule.start_time?.slice(0,5)||''})`,String(schedule.id)));
}
let scheduleChoiceRequest=0;
async function loadScheduleChoices(search=document.getElementById('logScheduleSearch')?.value||'') {
    const request=++scheduleChoiceRequest;
    const response=await window.apiFetch('/patrol-schedules/options?search='+encodeURIComponent(search));
    if(!response.ok) return;
    const choices=await response.json(); if(request!==scheduleChoiceRequest) return;
    scheduleChoices=choices; const selected=document.getElementById('logSchedule')?.value;
    populateScheduleDropdown();
    if(selected){await ensureScheduleOption(selected);document.getElementById('logSchedule').value=selected;}
}
function populateScheduleDropdown() {
    const select = document.getElementById('logSchedule');
    if (!select) return;
    if(!document.getElementById('logScheduleSearch')) {
        const input=document.createElement('input'); input.id='logScheduleSearch';input.type='search';input.className='form-control';input.placeholder='Search schedule location (up to 50 results)';input.setAttribute('aria-label','Search schedule locations');
        let timer; input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>loadScheduleChoices(input.value).catch(()=>showToast('Could not search schedules','error')),250);});
        select.before(input);
    }

    select.innerHTML = '<option value="">Select Schedule</option>';
    
    if (!scheduleChoices || scheduleChoices.length === 0) {
        const opt = document.createElement('option');
        opt.value = "";
        opt.textContent = "No schedules available";
        opt.disabled = true;
        select.appendChild(opt);
        return;
    }
    
    scheduleChoices.forEach(schedule => {
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

// ============================================================
// 13. UPDATE COUNTS
// ============================================================

function updateCounts() {
    const scheduleCount = document.getElementById('scheduleCount');
    const logCount = document.getElementById('logCount');

    if (scheduleCount) {
        const total = scheduleTotal;
        const filter = document.getElementById('scheduleStatusFilter')?.value;
        const suggested = getVisibleRecommendations().length;
        scheduleCount.textContent = filter === 'Suggested'
            ? `${suggested} suggestion${suggested === 1 ? '' : 's'}`
            : filter
            ? `${total} ${filter.toLowerCase()} schedules (paged)`
            : `${total} saved · ${suggested} suggested`;
    }

    if (logCount) {
        logCount.textContent = `${logTotal} logs (paged)`;
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
