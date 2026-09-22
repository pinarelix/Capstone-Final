/* ============================================================
   DASHBOARD.JS
   Barangay 179 Crime BI
   Dashboard with Role-Based Access Control + Session Token
============================================================ */

// ✅ API_URL ay naka-define na sa apiHelper.js

// Chart Instances
let incidentTypesChart = null;
let dangerLevelChart = null;
let crimeTrendChart = null;
let peakHoursChart = null;

// Raw per-day, per-type trend rows from the last /dashboard/charts load -
// kept around so switching the trend dropdown re-renders instantly from
// data already on hand instead of re-fetching.
let trendRawRows = [];

// Same 6 groupings as the Crime Category Guide legend and the CART
// engine's severity tiers (cart-engine.js) - kept here too since the
// trend filter groups by category, not by the 60+ individual types.
const CRIME_CATEGORIES = [
    'Violent Crimes',
    'Property Crimes',
    'Financial / Fraud Crimes',
    'Social / Public Order Crimes',
    'Special / Child-Related',
    'Other Incidents'
];

const INCIDENT_TYPE_CATEGORY = {
    'Homicide': 'Violent Crimes',
    'Attempted Murder': 'Violent Crimes',
    'Kidnapping': 'Violent Crimes',
    'Child Abuse': 'Violent Crimes',
    'VAWC': 'Violent Crimes',
    'Illegal Release of Fire Arms': 'Violent Crimes',
    'Attempted Arson': 'Violent Crimes',
    'Robbery': 'Violent Crimes',
    'Grave Threat': 'Violent Crimes',
    'Act of Lasciviousness': 'Violent Crimes',
    'Physical Injury': 'Violent Crimes',
    'Threats': 'Violent Crimes',
    'Less Serious Physical Injuries': 'Violent Crimes',
    'Falsification of Documents': 'Violent Crimes',
    'Slight Physical Injuries and Maltreatment': 'Violent Crimes',
    'Light Threats': 'Violent Crimes',

    'Arson': 'Property Crimes',
    'Theft': 'Property Crimes',
    'Fencing of Stolen Properties': 'Property Crimes',
    'Qualified Trespass to Dwelling': 'Property Crimes',
    'Occupation of Real Property or Usurpation of': 'Property Crimes',
    'Removal, Sale or Pledge of Mortgaged Property': 'Property Crimes',
    'Trespassing': 'Property Crimes',
    'Altering Boundaries of Landmarks': 'Property Crimes',
    'Vandalism': 'Property Crimes',

    'Scam': 'Financial / Fraud Crimes',
    'Swindling of Estafa': 'Financial / Fraud Crimes',
    'Estafa': 'Financial / Fraud Crimes',
    'Cybercrime Prevention Act 2012 (RA 10175)': 'Financial / Fraud Crimes',
    'Estafa/Debts': 'Financial / Fraud Crimes',
    'Cyber Bullying': 'Financial / Fraud Crimes',

    'Voyeurism Act': 'Social / Public Order Crimes',
    'Alarms and Scandals': 'Social / Public Order Crimes',
    'Incriminating Innocent Persons': 'Social / Public Order Crimes',
    'Threatening to Publish and offer to prevent': 'Social / Public Order Crimes',
    'Oral Defamation': 'Social / Public Order Crimes',
    'Harassment': 'Social / Public Order Crimes',
    'Intriguing Against Honor': 'Social / Public Order Crimes',
    'Unlawful Use of Means of Publication and Unlaw': 'Social / Public Order Crimes',
    'Prohibiting Publication of Acts Referred to in the': 'Social / Public Order Crimes',

    'BCPC': 'Special / Child-Related',
    'Child Support': 'Special / Child-Related',

    'Hit and Run': 'Other Incidents',
    'Reckless Impudence Resulting to Damage to Property and Physical Injury': 'Other Incidents',
    'Reckless Impudence Resulting Physical Injury': 'Other Incidents',
    'Noise Complaint': 'Other Incidents',
    'Anti Electricity Pilferage': 'Other Incidents',
    'Reckless Impudence Resulting to Damage to Property': 'Other Incidents',
    'Safe Special Act': 'Other Incidents',
    'Bastos Law': 'Other Incidents',
    'Abandoning a Minor': 'Other Incidents',
    'Abandonment of a Person in Danger': 'Other Incidents',
    'Inducing a Minor to Abandon His/her Home': 'Other Incidents',
    'Animal Welfare Acts': 'Other Incidents',
    'Suspicious Activity': 'Other Incidents',
    'Traffic Obstruction': 'Other Incidents',
    'Breach of Contract': 'Other Incidents',
    'Breach Contact': 'Other Incidents',
    'Curfew Violation': 'Other Incidents',
    'Abandon': 'Other Incidents',
    'Missing': 'Other Incidents',
    'Suicide': 'Other Incidents'
};

// Anything not in the map above (a new/unlisted incident_type) falls
// back to "Other Incidents" rather than disappearing from every filter.
function getCrimeCategory(incidentType) {
    return INCIDENT_TYPE_CATEGORY[incidentType] || 'Other Incidents';
}

/* ============================================================
   🔥 FIXED: Gumamit ng functions mula sa apiHelper.js
   (HINDI NA LOCAL STORAGE)
============================================================ */

// ✅ ITO NA LANG ANG KAILANGAN - WALA NANG CUSTOM FUNCTIONS

/* ============================================================
   DOM READY
============================================================ */

document.addEventListener("DOMContentLoaded", () => {

    // ============================================================
    // 🔥 STEP 1: Apply role-based UI - gamit ang apiHelper
    // ============================================================
    const user = getCurrentUser(); // mula sa apiHelper.js
    
    if (!user && !window.location.pathname.includes('login.html')) {
        window.location.href = 'login.html';
        return;
    }
    
    // applyRoleBasedUI() (from apiHelper.js) already updates the sidebar
    // name/role labels for every role, Captain included — no need to
    // redo it here (a previous re-implementation only branched
    // Administrator vs. everyone else, which mislabeled Captain as
    // "Decision-Maker").
    applyRoleBasedUI(); // mula sa apiHelper.js

    // ============================================================
    // 🔥 STEP 2: Check if logged in
    // ============================================================
    if (!isLoggedIn() && !window.location.pathname.includes('login.html')) {
        window.location.href = 'login.html';
        return;
    }

    // ============================================================
    // 🔥 STEP 3: Load dashboard data
    // ============================================================
    loadDashboardStats();
    loadIncidentsTable();
    loadHotspots();
    loadCharts();

    // Keeps the dashboard current with incidents reported from the
    // field (e.g. a tanod's phone) without needing to re-login.
    startLivePolling(() => {
        loadDashboardStats();
        loadIncidentsTable();
        loadHotspots();
        loadCharts();
    }, 15000);

    // ============================================================
    // 🔥 STEP 4: Sidebar ripple effect
    // ============================================================
    setupRippleEffect();

    // ============================================================
    // CRIME CATEGORY LEGEND TOGGLE
    // ============================================================
    const legendToggle = document.getElementById("crimeLegendToggle");
    const legendPanel = document.getElementById("crimeLegendPanel");
    if (legendToggle && legendPanel) {
        legendToggle.addEventListener("click", () => {
            legendPanel.classList.toggle("open");
            legendToggle.classList.toggle("active");
        });
    }

    // ============================================================
    // 🔥 STEP 5: Setup logout button
    // ============================================================
    setupLogoutButton();
});

/* ============================================================
   HELPER: DATE / TIME FORMATTING
============================================================ */

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[1]}/${parts[2]}/${parts[0]}`;
    }
    return dateStr;
}

function formatTime(timeStr) {
    if (!timeStr) return '';
    return timeStr.substring(0, 5);
}

function formatHour(hour) {
    hour = Number(hour);
    const suffix = hour >= 12 ? "PM" : "AM";
    let displayHour = hour % 12;
    if (displayHour === 0) displayHour = 12;
    return `${displayHour}:00 ${suffix}`;
}

/* ============================================================
   LOAD DASHBOARD STATS (KPI CARDS)
============================================================ */

async function loadDashboardStats() {
    try {
        const response = await apiFetch('/dashboard/stats');
        if (!response.ok) throw new Error('Failed to fetch stats');
        
        const data = await response.json();
        updateKPIs(data);
        
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

/* ============================================================
   UPDATE KPI VALUES
============================================================ */

function updateKPIs(data) {
    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };

    setText("kpi-incidents", data.incidents);
    setText("kpi-incidents-desc", `Total recorded incidents in database.`);
    setText("kpi-today-incidents", data.todayIncidents);

    const changeEl = document.getElementById("kpi-change");
    if (changeEl) {
        const arrowIcon = data.change >= 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down";
        changeEl.innerHTML = `${data.change > 0 ? "+" : ""}${data.change} <i class="fa-solid ${arrowIcon}"></i>`;
        changeEl.style.color = data.change > 0 ? "var(--status-high)" : "var(--status-low)";
    }

    setText("kpi-zones", data.zones);
    setText("kpi-common", data.common);
    setText("kpi-area", data.area);
    setText("kpi-peak", data.peak);
    setText("kpi-risk-streets", data.riskStreets);
    setText("kpi-risk-streets-desc", `Streets with at least one Level 3 (high-risk) incident: ${data.riskStreets}.`);
}

/* ============================================================
   LOAD INCIDENT TABLE
============================================================ */

async function loadIncidentsTable() {
    try {
        // /api/incidents now returns {incidents, total, totalPages,
        // currentPage} (server-side pagination added for the admin
        // Incident Records page) — this widget only ever shows 5 rows,
        // so it asks the server for exactly that instead of fetching
        // everything and slicing client-side.
        const response = await apiFetch('/incidents?limit=5');
        if (!response.ok) throw new Error('Failed to fetch incidents');

        const data = await response.json();
        renderTable(data.incidents || []);

    } catch (error) {
        console.error('Error loading incidents for table:', error);
    }
}

function renderTable(rows) {
    const tbody = document.getElementById("incidentTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    const recentRows = rows.slice(0, 5);

    if (recentRows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#888;">No incidents recorded yet.</td></tr>`;
        return;
    }

    recentRows.forEach((row, index) => {
        let statusClass = "badge-resolved";
        if (row.status === "Open") statusClass = "badge-open";
        if (row.status === "Monitoring") statusClass = "badge-monitoring";

        let dangerClass = "badge-danger-low";
        let dangerShort = "Low";
        if (row.danger_level?.includes('High') || row.danger_level?.includes('Level 3')) {
            dangerClass = "badge-danger-high";
            dangerShort = "High";
        } else if (row.danger_level?.includes('Moderate') || row.danger_level?.includes('Level 2')) {
            dangerClass = "badge-danger-mod";
            dangerShort = "Moderate";
        }

        const tr = document.createElement("tr");
        tr.style.animation = `tableRowIn 0.45s ease ${index * 0.08}s both`;

        tr.innerHTML = `
            <td class="font-bold">${row.id}</td>
            <td>${escapeHTML(row.incident_type)}</td>
            <td class="text-secondary">${formatDate(row.date)} ${formatTime(row.time)}</td>
            <td>${escapeHTML(row.location || row.street_name || 'N/A')}</td>
            <td><span class="badge ${statusClass}">${escapeHTML(row.status)}</span></td>
            <td><span class="badge ${dangerClass}" title="${escapeHTML(row.danger_level || '')}">${dangerShort}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

/* ============================================================
   LOAD HOTSPOTS
============================================================ */

async function loadHotspots() {
    try {
        // Hotspot aggregation needs the full active-incidents dataset, not
        // one page of it — request a high limit rather than the (now
        // paginated) default of 25.
        const response = await apiFetch('/incidents?limit=10000');
        if (!response.ok) throw new Error('Failed to fetch hotspots');

        const data = await response.json();
        const incidents = data.incidents || [];

        const locationMap = {};
        incidents.forEach(item => {
            const location = item.street_name || item.location || 'Unknown';
            if (!locationMap[location]) {
                locationMap[location] = { count: 0, danger: item.danger_level };
            }
            locationMap[location].count++;
        });

        const hotspots = Object.entries(locationMap)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 3)
            .map(([location, data], index) => {
                let dangerLevel = 'Low';
                let levelClass = 'badge-danger-low';
                let tagClass = 'tag-soft-yellow';
                if (data.danger?.includes('High') || data.danger?.includes('Level 3')) {
                    dangerLevel = 'High';
                    levelClass = 'badge-danger-high';
                    tagClass = 'tag-soft-red';
                } else if (data.danger?.includes('Moderate') || data.danger?.includes('Level 2')) {
                    dangerLevel = 'Moderate';
                    levelClass = 'badge-danger-mod';
                    tagClass = 'tag-soft-yellow';
                }
                return {
                    title: `#${index + 1} ${location}`,
                    danger: dangerLevel,
                    levelClass: levelClass,
                    tagClass: tagClass,
                    count: data.count
                };
            });

        renderHotspots(hotspots);
        
    } catch (error) {
        console.error('Error loading hotspots:', error);
    }
}

function renderHotspots(hotspots) {
    const container = document.getElementById("hotspotList");
    if (!container) return;

    container.innerHTML = "";

    if (hotspots.length === 0) {
        container.innerHTML = `<p style="color:#888; text-align:center; padding:20px;">No hotspots identified yet.</p>`;
        return;
    }

    hotspots.forEach((item, index) => {
        const div = document.createElement("div");
        div.className = "hotspot-item";
        div.style.animation = `hotspotIn 0.5s ease ${index * 0.12}s both`;

        div.innerHTML = `
            <div class="hotspot-header">
                <span class="hotspot-title">${escapeHTML(item.title)}</span>
                <span class="badge ${item.levelClass}">${item.danger} Risk</span>
            </div>
            <p class="hotspot-desc">
                ${item.count} reported incident${item.count > 1 ? 's' : ''} in this area.
            </p>
            <div class="hotspot-tags">
                <span class="tag ${item.tagClass}">${item.count} record${item.count > 1 ? 's' : ''}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

/* ============================================================
   LOAD CHARTS DATA
============================================================ */

async function loadCharts() {
    try {
        const response = await apiFetch('/dashboard/charts');
        if (!response.ok) throw new Error('Failed to fetch charts data');
        
        const data = await response.json();
        renderCharts(data);
        
    } catch (error) {
        console.error('Error loading charts:', error);
    }
}

/* ============================================================
   RENDER CHARTS
============================================================ */

function renderCharts(data) {
    // 1. INCIDENT TYPES (Bar Chart)
    const typesCanvas = document.getElementById("incidentTypesChart");
    if (typesCanvas) {
        if (incidentTypesChart) incidentTypesChart.destroy();
        
        const labels = data.types.map(item => item.incident_type);
        const values = data.types.map(item => item.count);

        // Cycles through the palette so any number of incident types gets a
        // distinct-looking color instead of running out after 6.
        const TYPE_COLORS = [
            "#0ea5e9", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#06b6d4",
            "#f43f5e", "#22c55e", "#a855f7", "#eab308", "#14b8a6", "#3b82f6",
            "#ec4899", "#84cc16", "#f97316", "#6366f1", "#059669", "#d946ef",
            "#0891b2", "#dc2626", "#65a30d"
        ];
        const barColors = labels.map((_, i) => TYPE_COLORS[i % TYPE_COLORS.length]);

        const typesInner = document.getElementById("incidentTypesChartInner");
        if (typesInner) {
            typesInner.style.height = Math.max(280, labels.length * 28) + "px";
        }

        incidentTypesChart = new Chart(typesCanvas, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "Incident Records",
                    data: values,
                    backgroundColor: barColors,
                    borderRadius: 8,
                    borderSkipped: false,
                    barThickness: 20
                }]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, grid: { display: false }, ticks: { color: "#0f172a", stepSize: 1 } },
                    y: { grid: { display: false }, ticks: { color: "#0f172a", font: { weight: "600" } } }
                }
            }
        });
    }

    // 2. DANGER LEVEL (Doughnut Chart)
    const dangerCanvas = document.getElementById("dangerLevelChart");
    if (dangerCanvas) {
        if (dangerLevelChart) dangerLevelChart.destroy();

        dangerLevelChart = new Chart(dangerCanvas, {
            type: "doughnut",
            data: {
                labels: [
                    `High Risk — ${data.danger.high}`,
                    `Moderate Risk — ${data.danger.moderate}`,
                    `Low Risk — ${data.danger.low}`
                ],
                datasets: [{
                    data: [data.danger.high, data.danger.moderate, data.danger.low],
                    backgroundColor: ["#ef4444", "#f59e0b", "#10b981"],
                    borderColor: "#e2e8f0",
                    borderWidth: 4,
                    hoverOffset: 15
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "66%",
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { usePointStyle: true, pointStyle: "circle", padding: 15, font: { size: 11, weight: "600" } }
                    }
                }
            }
        });
    }

    // 3. CRIME TREND (Line Chart - Last 7 Days, filterable by crime category)
    trendRawRows = data.trend;

    const trendFilter = document.getElementById("trendTypeFilter");
    if (trendFilter) {
        // Fixed set of 6 categories - only needs populating once, unlike
        // the old per-incident-type list which depended on the data.
        if (!trendFilter.dataset.wired) {
            trendFilter.innerHTML = '<option value="">All Types</option>' +
                CRIME_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
            trendFilter.addEventListener("change", () => renderTrendChart(trendFilter.value));
            trendFilter.dataset.wired = "true";
        }
    }

    renderTrendChart(trendFilter ? trendFilter.value : "");

    // 4. PEAK HOURS (Area Chart)
    const peakCanvas = document.getElementById("peakHoursChart");
    if (peakCanvas) {
        if (peakHoursChart) peakHoursChart.destroy();

        const labels = data.hourly.map(item => formatHour(item.hour));
        const values = data.hourly.map(item => item.count);

        peakHoursChart = new Chart(peakCanvas, {
            type: "line",
            data: {
                labels: labels,
                datasets: [{
                    label: "Incident Activity",
                    data: values,
                    borderColor: "#f59e0b",
                    backgroundColor: "rgba(245,158,11,0.25)",
                    pointBackgroundColor: "#f59e0b",
                    pointBorderColor: "#ffffff",
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 8,
                    borderWidth: 2,
                    tension: 0.45,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: "#0f172a", maxRotation: 45, minRotation: 45 } },
                    y: { beginAtZero: true, grid: { color: "#cbd5e1" }, ticks: { color: "#0f172a", stepSize: 1 } }
                }
            }
        });
    }
}

// Renders the Crime Trend line chart from trendRawRows, either summed
// across all incident types ("" / All Types) or filtered to one.
function renderTrendChart(selectedCategory) {
    const trendCanvas = document.getElementById("crimeTrendChart");
    if (!trendCanvas) return;
    if (crimeTrendChart) crimeTrendChart.destroy();

    const rows = selectedCategory
        ? trendRawRows.filter(r => getCrimeCategory(r.incident_type) === selectedCategory)
        : trendRawRows;

    // Sums duplicate-day rows together (multiple types per day, when
    // showing "All Types") while keeping days in date order.
    const byDay = new Map();
    rows.forEach(r => byDay.set(r.day_date, (byDay.get(r.day_date) || 0) + r.count));
    const sortedDays = [...byDay.keys()].sort();

    const labels = sortedDays.map(d => formatDate(d));
    const values = sortedDays.map(d => byDay.get(d));

    crimeTrendChart = new Chart(trendCanvas, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: selectedCategory || "Incident Activity",
                data: values,
                borderColor: "#0ea5e9",
                backgroundColor: "rgba(14,165,233,0.12)",
                pointBackgroundColor: "#0ea5e9",
                pointBorderColor: "#ffffff",
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 8,
                borderWidth: 2,
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: "#0f172a" } },
                y: { beginAtZero: true, grid: { color: "#cbd5e1" }, ticks: { color: "#0f172a", stepSize: 1 } }
            }
        }
    });
}

/* ============================================================
   SIDEBAR RIPPLE EFFECT
============================================================ */

function setupRippleEffect() {
    const navItems = document.querySelectorAll(".sidebar-nav .nav-item");
    navItems.forEach(item => {
        item.addEventListener("click", function(event) {
            const href = this.getAttribute("href");
            if (href && href !== "#") return;
            event.preventDefault();
            
            const circle = document.createElement("span");
            const diameter = Math.max(this.clientWidth, this.clientHeight);
            const radius = diameter / 2;
            const rect = this.getBoundingClientRect();
            
            circle.style.width = `${diameter}px`;
            circle.style.height = `${diameter}px`;
            circle.style.left = `${event.clientX - rect.left - radius}px`;
            circle.style.top = `${event.clientY - rect.top - radius}px`;
            circle.classList.add("ripple");
            
            const oldRipple = this.querySelector(".ripple");
            if (oldRipple) oldRipple.remove();
            this.appendChild(circle);
            
            navItems.forEach(nav => nav.classList.remove("active"));
            this.classList.add("active");
        });
    });
}

/* ============================================================
   🔥 SETUP LOGOUT BUTTON - GAMIT ANG clearSession() mula sa apiHelper
============================================================ */

function setupLogoutButton() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const logoutModal = document.getElementById('logoutModal');
            if (logoutModal) {
                logoutModal.style.display = 'flex';
            } else {
                if (confirm('Are you sure you want to logout?')) {
                    const token = getSessionToken();
                    if (token) {
                        fetch(`${API_URL}/auth/logout`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ session_token: token })
                        }).catch(() => {});
                    }
                    clearSession();
                    window.location.href = 'login.html';
                }
            }
        });
    }
}

console.log('✅ dashboard.js loaded successfully');