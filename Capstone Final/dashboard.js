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
    
    applyRoleBasedUI(); // mula sa apiHelper.js
    
    // Update user profile in sidebar
    const nameEl = document.getElementById('userNameDisplay');
    const roleEl = document.getElementById('userRoleDisplay');
    
    if (nameEl) {
        nameEl.textContent = user?.name || 'User';
    }
    
    if (roleEl) {
        const roleDisplay = user?.role === 'Administrator' 
            ? '👑 Administrator — Full System Access' 
            : '📊 Decision-Maker — View & Analytics Access';
        roleEl.textContent = roleDisplay || 'User';
    }

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

    // ============================================================
    // 🔥 STEP 4: Sidebar ripple effect
    // ============================================================
    setupRippleEffect();

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
    setText("kpi-active-day", data.activeDay);

    const changeEl = document.getElementById("kpi-change");
    if (changeEl) {
        const arrow = data.change >= 0 ? "↗" : "↘";
        changeEl.textContent = `${data.change > 0 ? "+" : ""}${data.change} ${arrow}`;
        changeEl.style.color = data.change > 0 ? "var(--status-high)" : "var(--status-low)";
    }

    setText("kpi-zones", data.zones);
    setText("kpi-common", data.common);
    setText("kpi-area", data.area);
    setText("kpi-peak", data.peak);
    setText("kpi-risk", data.risk);
    setText("kpi-risk-desc", `Level 3 high-risk indicators recorded: ${data.risk}.`);

    const progress = document.getElementById("incidentProgress");
    if (progress) {
        const percentage = Math.min((data.incidents / 30) * 100, 100);
        progress.style.width = `${percentage}%`;
    }
}

/* ============================================================
   LOAD INCIDENT TABLE
============================================================ */

async function loadIncidentsTable() {
    try {
        const response = await apiFetch('/incidents');
        if (!response.ok) throw new Error('Failed to fetch incidents');
        
        const incidents = await response.json();
        renderTable(incidents);
        
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
        if (row.danger_level?.includes('High') || row.danger_level?.includes('Level 3')) dangerClass = "badge-danger-high";
        if (row.danger_level?.includes('Moderate') || row.danger_level?.includes('Level 2')) dangerClass = "badge-danger-mod";

        const tr = document.createElement("tr");
        tr.style.animation = `tableRowIn 0.45s ease ${index * 0.08}s both`;

        tr.innerHTML = `
            <td class="font-bold">${row.id}</td>
            <td>${row.incident_type}</td>
            <td class="text-secondary">${formatDate(row.date)} ${formatTime(row.time)}</td>
            <td>${row.location || row.street_name || 'N/A'}</td>
            <td><span class="badge ${statusClass}">${row.status}</span></td>
            <td><span class="badge ${dangerClass}">${row.danger_level}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

/* ============================================================
   LOAD HOTSPOTS
============================================================ */

async function loadHotspots() {
    try {
        const response = await apiFetch('/incidents');
        if (!response.ok) throw new Error('Failed to fetch hotspots');
        
        const incidents = await response.json();
        
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
                <span class="hotspot-title">${item.title}</span>
                <span class="badge ${item.levelClass}">${item.danger} Risk</span>
            </div>
            <p class="hotspot-desc">
                ${item.count} reported incident${item.count > 1 ? 's' : ''} in this area.
            </p>
            <div class="hotspot-tags">
                <span class="tag ${item.tagClass}">${item.count} records</span>
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

        incidentTypesChart = new Chart(typesCanvas, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "Incident Records",
                    data: values,
                    backgroundColor: ["#0ea5e9", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#06b6d4"],
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

    // 3. CRIME TREND (Line Chart - Last 7 Days)
    const trendCanvas = document.getElementById("crimeTrendChart");
    if (trendCanvas) {
        if (crimeTrendChart) crimeTrendChart.destroy();

        const labels = data.trend.map(item => formatDate(item.day_date));
        const values = data.trend.map(item => item.count);

        crimeTrendChart = new Chart(trendCanvas, {
            type: "line",
            data: {
                labels: labels,
                datasets: [{
                    label: "Incident Activity",
                    data: values,
                    borderColor: "#0ea5e9",
                    backgroundColor: "rgba(14,165,233,0.12)",
                    pointBackgroundColor: "#0ea5e9",
                    pointBorderColor: "#ffffff",
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    borderWidth: 3,
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
                    borderWidth: 3,
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
                        fetch('http://localhost:3000/api/auth/logout', {
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