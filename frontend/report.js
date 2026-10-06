/* =========================================================
   REPORT.JS
   Barangay 179 Crime BI
   Reports Module - With Role-Based Access Control
============================================================ */

// ✅ API_URL ay naka-define na sa apiHelper.js

/* ============================================================
   🔥 FIXED: Gumamit ng functions mula sa apiHelper.js
   (HINDI NA LOCAL STORAGE)
============================================================ */

// ✅ ITO NA LANG ANG KAILANGAN - WALA NANG CUSTOM FUNCTIONS

/* =========================================================
   DOM READY
============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
    // Apply role-based UI gamit ang apiHelper
    const user = getCurrentUser();
    
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
        let roleDisplay = '<i class="fa-solid fa-chart-column"></i> Decision-Maker — View & Analytics Access';
        if (user?.role === 'Administrator') {
            roleDisplay = '<i class="fa-solid fa-crown"></i> Administrator — Full System Access';
        } else if (user?.role === 'Desk Officer') {
            roleDisplay = '<i class="fa-solid fa-headset"></i> Desk Officer — Patrol Scheduling Access';
        }
        roleEl.innerHTML = roleDisplay || 'User';
    }
    
    const monthSelect = document.getElementById("reportMonthSelect");
    const monthBadge = document.getElementById("reportMonthBadge");
    const tableBody = document.getElementById("reportTableBody");
    const printBtn = document.getElementById("printPdfBtn");
    const exportCsvBtn = document.getElementById("exportCsvBtn");
    const viewPatrolBtn = document.getElementById("viewPatrolBtn");

    // Refine-within-the-month filters - all optional, combined with the
    // month filter (and each other) as AND conditions.
    const filterDateFrom = document.getElementById("filterDateFrom");
    const filterDateTo = document.getElementById("filterDateTo");
    const filterStatus = document.getElementById("filterStatus");
    const filterType = document.getElementById("filterType");
    const filterLocation = document.getElementById("filterLocation");
    const clearFiltersBtn = document.getElementById("clearFiltersBtn");

    // Patrol Logs tab
    const patrolLogTableBody = document.getElementById("patrolLogTableBody");
    const patrolLogCount = document.getElementById("patrolLogCount");
    const printPatrolLogBtn = document.getElementById("printPatrolLogBtn");
    const exportPatrolLogCsvBtn = document.getElementById("exportPatrolLogCsvBtn");
    const filterPatrolDateFrom = document.getElementById("filterPatrolDateFrom");
    const filterPatrolDateTo = document.getElementById("filterPatrolDateTo");
    const filterPatrolStatus = document.getElementById("filterPatrolStatus");
    const filterPatrolTanod = document.getElementById("filterPatrolTanod");
    const filterPatrolLocation = document.getElementById("filterPatrolLocation");
    const clearPatrolFiltersBtn = document.getElementById("clearPatrolFiltersBtn");

    const patrolModal = document.getElementById("patrolModal");
    const closeModalBtn = document.getElementById("closeModalBtn");
    const modalCloseActionBtn = document.getElementById("modalCloseActionBtn");
    const modalMonthSubtitle = document.getElementById("modalMonthSubtitle");
    const modalPatrolSummary = document.getElementById("modalPatrolSummary");
    const modalPatrolHotspots = document.getElementById("modalPatrolHotspots");
    const modalPatrolHours = document.getElementById("modalPatrolHours");
    const modalPatrolDirectives = document.getElementById("modalPatrolDirectives");
    const modalPrintBtn = document.getElementById("modalPrintBtn");
    const modalGoToPatrolPage = document.getElementById("modalGoToPatrolPage");

    let currentIncidentData = [];
    let currentPatrolLogData = [];

    async function loadIncidents() {
        try {
            // Reports need the full active-incidents dataset (month-based
            // filtering happens client-side across all of it), not one
            // page of it — request a high limit rather than the (now
            // paginated) default of 25.
            const response = await apiFetch('/incidents?limit=10000');
            if (!response.ok) throw new Error('Failed to load incidents');

            const responseData = await response.json();
            const data = responseData.incidents || [];
            currentIncidentData = data;

            populateMonthDropdown(data);
            populateLocationDropdown();

            const initialMonth = monthSelect.value;
            updateReportView(initialMonth, data);

        } catch (error) {
            console.error('Error loading reports data:', error);
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #ef4444;">Error loading data from server.</td></tr>`;
            }
        }
    }

    function populateMonthDropdown(allIncidents) {
        if (!allIncidents || allIncidents.length === 0) {
            monthSelect.innerHTML = `<option value="">No incidents found</option>`;
            return;
        }

        // Preserved across live-polling refreshes below - without this,
        // every poll would silently jump whoever's reviewing an older
        // month's report back to the newest month.
        const previousValue = monthSelect.value;

        const monthSet = new Set();
        allIncidents.forEach(item => {
            if (item.date) {
                const dateParts = item.date.split('-');
                if (dateParts.length === 3) {
                    const yearMonth = `${dateParts[0]}-${dateParts[1]}`;
                    monthSet.add(yearMonth);
                }
            }
        });

        const sortedMonths = Array.from(monthSet).sort((a, b) => b.localeCompare(a));

        monthSelect.innerHTML = '';

        sortedMonths.forEach(yearMonth => {
            const [year, month] = yearMonth.split('-');
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const monthName = monthNames[parseInt(month) - 1];
            
            const option = document.createElement('option');
            option.value = yearMonth;
            option.textContent = `${monthName} ${year}`;
            monthSelect.appendChild(option);
        });

        if (previousValue && sortedMonths.includes(previousValue)) {
            monthSelect.value = previousValue;
        } else if (monthSelect.options.length > 0) {
            monthSelect.value = monthSelect.options[0].value;
        }
    }

    // BARANGAY_LOCATIONS comes from locationList.js.
    function populateLocationDropdown() {
        if (!filterLocation || typeof BARANGAY_LOCATIONS === 'undefined') return;
        if (filterLocation.options.length > 1) return; // already populated

        BARANGAY_LOCATIONS.forEach(loc => {
            const option = document.createElement('option');
            option.value = loc;
            option.textContent = loc;
            filterLocation.appendChild(option);
        });
    }

    // =========================================================
    // PATROL LOGS TAB
    // =========================================================

    async function loadPatrolLogs() {
        try {
            // No pagination/limit support on this endpoint (unlike
            // /incidents) - it already returns every row.
            const response = await apiFetch('/patrol-logs');
            if (!response.ok) throw new Error('Failed to load patrol logs');

            currentPatrolLogData = await response.json();
            populatePatrolFilterDropdowns(currentPatrolLogData);
            updatePatrolLogView();
        } catch (error) {
            console.error('Error loading patrol logs:', error);
            if (patrolLogTableBody) {
                patrolLogTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: #ef4444;">Error loading patrol logs from server.</td></tr>`;
            }
        }
    }

    // Tanod/location options aren't a fixed list the way BARANGAY_LOCATIONS
    // is for incidents - derived from whichever tanods/locations actually
    // have a logged patrol, so an empty dropdown never shows a name with
    // zero matching records.
    function populatePatrolFilterDropdowns(data) {
        if (filterPatrolTanod && filterPatrolTanod.options.length <= 1) {
            const tanods = [...new Set(data.map(d => d.tanod_name).filter(Boolean))].sort();
            tanods.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                filterPatrolTanod.appendChild(option);
            });
        }

        if (filterPatrolLocation && filterPatrolLocation.options.length <= 1) {
            const locations = [...new Set(data.map(d => d.schedule_location).filter(Boolean))].sort();
            locations.forEach(loc => {
                const option = document.createElement('option');
                option.value = loc;
                option.textContent = loc;
                filterPatrolLocation.appendChild(option);
            });
        }
    }

    function applyPatrolLogFilters(allData) {
        if (!allData) return [];

        const dateFrom = filterPatrolDateFrom?.value || '';
        const dateTo = filterPatrolDateTo?.value || '';
        const status = filterPatrolStatus?.value || '';
        const tanod = filterPatrolTanod?.value || '';
        const location = filterPatrolLocation?.value || '';

        return allData.filter(item => {
            if (dateFrom && item.patrol_date < dateFrom) return false;
            if (dateTo && item.patrol_date > dateTo) return false;
            if (status && item.status !== status) return false;
            if (tanod && item.tanod_name !== tanod) return false;
            if (location && item.schedule_location !== location) return false;
            return true;
        });
    }

    function getPatrolStatusBadgeClass(status) {
        if (!status) return 'badge-status completed';
        const statusLower = status.toLowerCase();
        if (statusLower === 'completed') return 'badge-status completed';
        if (statusLower === 'partial') return 'badge-status partial';
        if (statusLower === 'failed') return 'badge-status failed';
        return 'badge-status completed';
    }

    function updatePatrolLogView() {
        const filtered = applyPatrolLogFilters(currentPatrolLogData);

        if (patrolLogCount) {
            patrolLogCount.textContent = `${filtered.length} record${filtered.length !== 1 ? 's' : ''}`;
        }

        if (!patrolLogTableBody) return;

        patrolLogTableBody.innerHTML = "";
        if (filtered.length === 0) {
            patrolLogTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: #94a3b8;">No patrol log records match the selected filters.</td></tr>`;
            return;
        }

        filtered.forEach(item => {
            const tr = document.createElement("tr");
            const statusClass = getPatrolStatusBadgeClass(item.status);

            tr.innerHTML = `
                <td class="font-bold">${item.id || 'N/A'}</td>
                <td>${escapeHTML(item.tanod_name || 'N/A')}</td>
                <td>${escapeHTML(item.schedule_location || 'N/A')}</td>
                <td>${formatDate(item.patrol_date)}</td>
                <td><span class="${statusClass}">${escapeHTML(item.status || 'Completed')}</span></td>
                <td>${escapeHTML(item.report || 'No report notes.')}</td>
            `;
            patrolLogTableBody.appendChild(tr);
        });
    }

    // Same fire-and-forget audit pattern as logReportAction() below, kept
    // separate since the two tabs log different filter shapes/record
    // counts - conflating them would mislabel what was actually printed.
    function logPatrolReportAction(action) {
        try {
            apiFetch('/reports/log-export', {
                method: 'POST',
                body: JSON.stringify({
                    action,
                    filters: {
                        dateFrom: filterPatrolDateFrom?.value || '',
                        dateTo: filterPatrolDateTo?.value || '',
                        status: filterPatrolStatus?.value || '',
                        tanod: filterPatrolTanod?.value || '',
                        location: filterPatrolLocation?.value || ''
                    },
                    recordCount: applyPatrolLogFilters(currentPatrolLogData).length
                })
            }).catch(err => console.error('Error logging patrol report action:', err));
        } catch (err) {
            console.error('Error logging patrol report action:', err);
        }
    }

    // =========================================================
    // TABS
    // =========================================================
    function setupTabs() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));

                this.classList.add('active');
                const tabId = this.getAttribute('data-tab');
                document.getElementById(`tab-${tabId}`).classList.add('active');
            });
        });
    }

    // Applies the month filter plus every optional refine-within-month
    // filter (date range, status, type, location) as AND conditions.
    // Shared by the table, CSV export, and the Patrol Recommendation
    // modal so all three always agree on what's "in view".
    function applyFilters(monthKey, allData) {
        if (!monthKey || !allData) return [];

        const dateFrom = filterDateFrom?.value || '';
        const dateTo = filterDateTo?.value || '';
        const status = filterStatus?.value || '';
        const type = filterType?.value || '';
        const location = filterLocation?.value || '';

        return allData.filter(item => {
            if (!item.date || !item.date.startsWith(monthKey)) return false;
            if (dateFrom && item.date < dateFrom) return false;
            if (dateTo && item.date > dateTo) return false;

            if (status && item.status !== status) return false;
            if (type && item.incident_type !== type) return false;
            if (location && item.street_name !== location) return false;

            return true;
        });
    }

    function getStatusBadgeClass(status) {
        if (!status) return 'badge-status open';
        
        const statusLower = status.toLowerCase();
        if (statusLower === 'open') return 'badge-status open';
        if (statusLower === 'monitoring') return 'badge-status monitoring';
        if (statusLower === 'resolved') return 'badge-status resolved';
        return 'badge-status open';
    }

    function getDangerBadgeClass(dangerLevel) {
        if (!dangerLevel) return 'badge-danger calculated';
        
        const danger = dangerLevel.toLowerCase();
        if (danger.includes('level 3') || danger.includes('high')) {
            return 'badge-danger high';
        } else if (danger.includes('level 2') || danger.includes('moderate')) {
            return 'badge-danger moderate';
        } else if (danger.includes('level 1') || danger.includes('low')) {
            return 'badge-danger low';
        }
        return 'badge-danger calculated';
    }

    // Almost every incident's recommended_action is left at its default
    // placeholder text regardless of severity (admins rarely customize it
    // per-incident), so the report table/CSV showed the identical generic
    // line next to a Level 3 incident and a Level 1 one. Falls back to a
    // severity-derived recommendation - same wording patrol.js already
    // uses for its own recommendations - whenever the field is empty or
    // still just the default, but still honors a real custom value.
    const DEFAULT_ACTION_TEXT = 'Scheduled patrol and risk monitoring';

    function getRecommendedAction(item) {
        const custom = (item.recommended_action || '').trim();
        if (custom && custom !== DEFAULT_ACTION_TEXT) return custom;

        const danger = item.danger_level || '';
        if (danger.includes('Level 3') || danger.includes('High')) {
            return 'PRIORITY: Deploy additional tanods, increase patrol frequency, and coordinate with barangay officials.';
        } else if (danger.includes('Level 2') || danger.includes('Moderate')) {
            return 'Deploy targeted patrols, conduct periodic spot checks, and monitor for escalation.';
        } else if (danger.includes('Level 1') || danger.includes('Low')) {
            return 'Maintain standard routine patrols and community visibility.';
        }
        return custom || DEFAULT_ACTION_TEXT;
    }

    function updateReportView(monthKey, allData) {
        if (!monthKey || !allData) return;

        const filteredIncidents = applyFilters(monthKey, allData);

        if (monthBadge) {
            const [year, month] = monthKey.split('-');
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            monthBadge.textContent = `${monthNames[parseInt(month) - 1]} ${year}`;
        }

        if (tableBody) {
            tableBody.innerHTML = "";
            if (filteredIncidents.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #94a3b8;">No incident records match the selected filters.</td></tr>`;
            } else {
                filteredIncidents.forEach(item => {
                    const tr = document.createElement("tr");
                    
                    const statusClass = getStatusBadgeClass(item.status);
                    const dangerClass = getDangerBadgeClass(item.danger_level);
                    
                    const formattedDate = formatDate(item.date);
                    const formattedTime = formatTime(item.time);
                    
                    const location = item.street_name || (item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : 'N/A');

                    tr.innerHTML = `
                        <td class="font-bold">${item.id || 'N/A'}</td>
                        <td>${escapeHTML(item.incident_type || 'N/A')}</td>
                        <td>${formattedDate} ${formattedTime}</td>
                        <td>${escapeHTML(location)}</td>
                        <td><span class="${statusClass}">${escapeHTML(item.status || 'Open')}</span></td>
                        <td><span class="${dangerClass}">${escapeHTML(item.danger_level || 'Calculated by System')}</span></td>
                        <td>${escapeHTML(getRecommendedAction(item))}</td>
                    `;
                    tableBody.appendChild(tr);
                });
            }
        }
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        try {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
            return dateStr;
        } catch (e) {
            return dateStr;
        }
    }

    function formatTime(timeStr) {
        if (!timeStr) return 'N/A';
        try {
            if (timeStr.includes(':')) {
                return timeStr.substring(0, 5);
            }
            return timeStr;
        } catch (e) {
            return timeStr;
        }
    }

    function openPatrolModal() {
        const currentMonth = monthSelect.value;
        if (!currentMonth) {
            alert('Please select a valid month first.');
            return;
        }

        const [year, month] = currentMonth.split('-');
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const monthName = `${monthNames[parseInt(month) - 1]} ${year}`;

        // Reflects the same refine-within-month filters as the table/CSV -
        // filtering to just "Theft" incidents, say, should mean the patrol
        // guidance is about those Theft incidents too, not the whole month.
        const monthData = applyFilters(currentMonth, currentIncidentData);
        const highRiskCount = monthData.filter(item => item.danger_level?.includes("Level 3") || item.danger_level?.includes("High")).length;
        const moderateRiskCount = monthData.filter(item => item.danger_level?.includes("Level 2") || item.danger_level?.includes("Moderate")).length;

        // Rank locations by incident count instead of just listing every
        // distinct street that had any incident at all - previously this
        // dumped every location from the whole month into "Priority
        // Hotspots", which isn't a priority list, just the full list.
        // Mirrors the same group-count-sort pattern dashboard.js's "Top
        // Hotspot Areas" widget already uses.
        const locationCounts = {};
        monthData.forEach(item => {
            const loc = item.street_name || (item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : null);
            if (loc) locationCounts[loc] = (locationCounts[loc] || 0) + 1;
        });
        const rankedLocations = Object.entries(locationCounts).sort((a, b) => b[1] - a[1]);
        const topLocations = rankedLocations.slice(0, 3);
        const topLocationName = topLocations.length > 0 ? topLocations[0][0] : null;
        const hotspots = topLocations.length > 0
            ? topLocations.map(([loc, count]) => `${loc} (${count} incident${count > 1 ? 's' : ''})`).join(', ')
            : 'General Coverage Area';

        let peakHour = "N/A";
        if (monthData.length > 0) {
            const hourCounts = {};
            monthData.forEach(item => {
                if (item.time) {
                    const hour = item.time.split(':')[0];
                    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
                }
            });
            const sortedHours = Object.entries(hourCounts).sort((a, b) => b[1] - a[1]);
            if (sortedHours.length > 0) {
                const hour = parseInt(sortedHours[0][0]);
                peakHour = `${String(hour).padStart(2, '0')}:00 - ${String(hour + 2).padStart(2, '0')}:00`;
            }
        }

        let summary = "Routine patrol schedule in effect.";
        let directives = ["Maintain routine tanod roving patrol."];
        
        if (highRiskCount > 2) {
            summary = `High crime intensity detected. Heavy tanod deployment advised across ${hotspots}.`;
            directives = [
                `Deploy stationary Tanod Outpost in ${topLocationName || 'Priority Zones'} between 7:00 PM and 11:00 PM.`,
                "Mobile motorcycle patrol every 30 minutes.",
                "Mandatory coordination with Caloocan Police Station 12 for high-risk zones."
            ];
        } else if (moderateRiskCount > 2) {
            summary = `Moderate disturbance risk. Increase evening foot patrols around ${hotspots}.`;
            directives = [
                `Deploy 4 Barangay Tanods at ${topLocationName || 'designated areas'} during closing hours (6 PM - 9 PM).`,
                "Regular patrol drive for traffic decongestion.",
                "Maintain active presence to prevent late-night altercations."
            ];
        } else if (monthData.length > 0) {
            summary = `Low risk level detected. Standard patrol procedures recommended.`;
            directives = [
                "Regular foot patrol in designated areas.",
                "Monitor and report any suspicious activities.",
                "Maintain community engagement and visibility."
            ];
        }

        if (modalMonthSubtitle) modalMonthSubtitle.textContent = `Target Month: ${monthName}`;
        if (modalPatrolSummary) modalPatrolSummary.textContent = summary;
        if (modalPatrolHotspots) modalPatrolHotspots.textContent = hotspots;
        if (modalPatrolHours) modalPatrolHours.textContent = peakHour;

        if (modalPatrolDirectives) {
            modalPatrolDirectives.innerHTML = "";
            directives.forEach(dir => {
                const li = document.createElement("li");
                li.textContent = dir;
                modalPatrolDirectives.appendChild(li);
            });
        }

        try {
            sessionStorage.setItem("selectedPatrolMonth", currentMonth);
        } catch (e) {}

        if (patrolModal) {
            patrolModal.style.display = 'flex';
        }
    }

    function closePatrolModal() {
        if (patrolModal) {
            patrolModal.style.display = 'none';
        }
    }

    // Records who printed or exported what, with which filters, in the
    // audit trail - window.print() and the CSV Blob never touch the
    // backend on their own, so without this call neither action would
    // ever show up there. Fire-and-forget: a logging hiccup should never
    // block the actual print/export the admin asked for.
    function logReportAction(action) {
        try {
            apiFetch('/reports/log-export', {
                method: 'POST',
                body: JSON.stringify({
                    action,
                    month: monthSelect?.value || null,
                    filters: {
                        dateFrom: filterDateFrom?.value || '',
                        dateTo: filterDateTo?.value || '',
                        status: filterStatus?.value || '',
                        incidentType: filterType?.value || '',
                        location: filterLocation?.value || ''
                    },
                    recordCount: applyFilters(monthSelect?.value, currentIncidentData).length
                })
            }).catch(err => console.error('Error logging report action:', err));
        } catch (err) {
            console.error('Error logging report action:', err);
        }
    }

    // =========================================================
    // EVENT LISTENERS
    // =========================================================
    
    if (monthSelect) {
        monthSelect.addEventListener("change", (e) => {
            updateReportView(e.target.value, currentIncidentData);
        });
    }

    // Every refine-within-month filter re-renders the same table on
    // change - no separate "Apply" step.
    [filterDateFrom, filterDateTo, filterStatus, filterType, filterLocation]
        .filter(Boolean)
        .forEach(field => {
            field.addEventListener("change", () => {
                updateReportView(monthSelect.value, currentIncidentData);
            });
        });

    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener("click", () => {
            [filterDateFrom, filterDateTo, filterStatus, filterType, filterLocation]
                .filter(Boolean)
                .forEach(field => { field.value = ""; });
            updateReportView(monthSelect.value, currentIncidentData);
        });
    }

    // Patrol Logs tab filters - every change re-renders, same as the
    // Incident Reports tab above.
    [filterPatrolDateFrom, filterPatrolDateTo, filterPatrolStatus, filterPatrolTanod, filterPatrolLocation]
        .filter(Boolean)
        .forEach(field => {
            field.addEventListener("change", updatePatrolLogView);
        });

    if (clearPatrolFiltersBtn) {
        clearPatrolFiltersBtn.addEventListener("click", () => {
            [filterPatrolDateFrom, filterPatrolDateTo, filterPatrolStatus, filterPatrolTanod, filterPatrolLocation]
                .filter(Boolean)
                .forEach(field => { field.value = ""; });
            updatePatrolLogView();
        });
    }

    if (printPatrolLogBtn) {
        printPatrolLogBtn.addEventListener("click", () => {
            logPatrolReportAction('PRINT_PATROL_LOGS_REPORT');
            window.print();
        });
    }

    if (exportPatrolLogCsvBtn) {
        exportPatrolLogCsvBtn.addEventListener("click", (e) => {
            e.preventDefault();
            const filteredData = applyPatrolLogFilters(currentPatrolLogData);

            if (filteredData.length === 0) {
                alert("No patrol log data available to export for the selected filters.");
                return;
            }

            const csvField = (value) => {
                let str = String(value ?? '');
                if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
                return `"${str.replace(/"/g, '""')}"`;
            };

            let csvContent = "Log ID,Tanod,Location,Patrol Date,Status,Report\n";

            filteredData.forEach(item => {
                csvContent += [
                    item.id || '', item.tanod_name || '', item.schedule_location || '',
                    item.patrol_date || '', item.status || '', item.report || ''
                ].map(csvField).join(',') + '\n';
            });

            logPatrolReportAction('EXPORT_CSV_PATROL_LOGS');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            const today = new Date().toISOString().slice(0, 10);
            link.setAttribute("href", url);
            link.setAttribute("download", `Barangay179_Patrol_Logs_${today}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        });
    }

    if (printBtn) {
        printBtn.addEventListener("click", () => {
            logReportAction('PRINT_REPORT');
            window.print();
        });
    }

    if (exportCsvBtn) {
        exportCsvBtn.addEventListener("click", (e) => {
            e.preventDefault();
            const currentMonth = monthSelect.value;
            if (!currentMonth) {
                alert("Please select a month first.");
                return;
            }
            
            const filteredData = applyFilters(currentMonth, currentIncidentData);

            if (filteredData.length === 0) {
                alert("No data available to export for the selected filters.");
                return;
            }
            
            // CSV/formula injection guard (OWASP): a cell that starts with
            // =, +, -, @, tab, or CR gets opened as a live formula by
            // Excel/Sheets - prefixing it with a bare apostrophe forces
            // those apps to treat it as plain text instead. Address is
            // free-typed by an admin, so this isn't just a theoretical
            // input source.
            const csvField = (value) => {
                let str = String(value ?? '');
                if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
                return `"${str.replace(/"/g, '""')}"`;
            };

            let csvContent = "Incident ID,Type,Date,Time,Location,Address,Status,Danger Level,Recommended Action,Reporter Name,Reporter Contact\n";

            filteredData.forEach(item => {
                const location = item.street_name || (item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : 'N/A');

                const reporterName = item.reporter_name || 'N/A';
                const reporterContact = item.reporter_contact_no || 'N/A';

                csvContent += [
                    item.id || '', item.incident_type || '', item.date || '', item.time || '',
                    location, item.address || '', item.status || '', item.danger_level || '',
                    getRecommendedAction(item), reporterName, reporterContact
                ].map(csvField).join(',') + '\n';
            });

            logReportAction('EXPORT_CSV_REPORT');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `Barangay179_Crime_Report_${currentMonth}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        });
    }

    if (viewPatrolBtn) {
        viewPatrolBtn.addEventListener("click", openPatrolModal);
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener("click", closePatrolModal);
    }
    if (modalCloseActionBtn) {
        modalCloseActionBtn.addEventListener("click", closePatrolModal);
    }
    
    window.addEventListener("click", (e) => {
        if (e.target === patrolModal) {
            closePatrolModal();
        }
    });

    if (modalPrintBtn) {
        modalPrintBtn.addEventListener("click", () => {
            logReportAction('PRINT_PATROL_REPORT');
            closePatrolModal();
            setTimeout(() => window.print(), 300);
        });
    }

    if (modalGoToPatrolPage) {
        modalGoToPatrolPage.addEventListener("click", () => {
            const currentMonth = monthSelect.value;
            try {
                sessionStorage.setItem("selectedPatrolMonth", currentMonth);
            } catch (e) {}
            window.location.href = "patrol.html";
        });
    }

    setupTabs();

    await loadIncidents();
    await loadPatrolLogs();

    // Keeps the report current with incidents reported from the field
    // (e.g. a tanod's phone) without needing to re-login.
    startLivePolling(loadIncidents, 15000);
    startLivePolling(loadPatrolLogs, 15000);
});

console.log('✅ report.js loaded successfully');