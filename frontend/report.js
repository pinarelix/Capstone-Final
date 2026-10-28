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
        let roleDisplay = '<i class="fa-solid fa-chart-column"></i> Kagawad — View & Analytics Access';
        if (user?.role === 'Executive Officer') {
            roleDisplay = '<i class="fa-solid fa-crown"></i> Executive Officer — Full System Access';
        } else if (user?.role === 'Team Leader') {
            roleDisplay = '<i class="fa-solid fa-headset"></i> Team Leader — Records & Patrol Access';
        }
        roleEl.innerHTML = roleDisplay || 'User';
    }
    
    const monthSelect = document.getElementById("reportMonthSelect");
    const monthBadge = document.getElementById("reportMonthBadge");
    const tableBody = document.getElementById("reportTableBody");
    const printBtn = document.getElementById("printPdfBtn");
    const exportCsvBtn = document.getElementById("exportCsvBtn");
    const viewPatrolBtn = document.getElementById("viewPatrolBtn");

    // The month is the default report period. An explicit date selection
    // overrides it and may span any month or year.
    const filterDateFrom = document.getElementById("filterDateFrom");
    const reportSearch = document.getElementById("reportSearch");
    const filterDateTo = document.getElementById("filterDateTo");
    const filterStatus = document.getElementById("filterStatus");
    const filterType = document.getElementById("filterType");
    const filterFormType = document.getElementById("filterFormType");
    const filterLocation = document.getElementById("filterLocation");
    const clearFiltersBtn = document.getElementById("clearFiltersBtn");

    function syncReportDateInputs(changedField = '') {
        if (!filterDateFrom || !filterDateTo) return;
        const range = ReportDateFilter.normalizeRange(
            monthSelect.value,
            filterDateFrom.value,
            filterDateTo.value,
            changedField
        );

        filterDateFrom.removeAttribute('min');
        filterDateFrom.removeAttribute('max');
        filterDateTo.removeAttribute('min');
        filterDateTo.removeAttribute('max');
        filterDateFrom.value = range.dateFrom;
        filterDateTo.value = range.dateTo;
    }

    // Patrol Logs tab
    const patrolLogTableBody = document.getElementById("patrolLogTableBody");
    const patrolLogCount = document.getElementById("patrolLogCount");
    const printPatrolLogBtn = document.getElementById("printPatrolLogBtn");
    const exportPatrolLogCsvBtn = document.getElementById("exportPatrolLogCsvBtn");
    const filterPatrolDateFrom = document.getElementById("filterPatrolDateFrom");
    const patrolReportSearch = document.getElementById("patrolReportSearch");
    const filterPatrolDateTo = document.getElementById("filterPatrolDateTo");
    const filterPatrolStatus = document.getElementById("filterPatrolStatus");
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
    let reportPage = 1, reportTotal = 0, reportSummary = {}, reportRequest = 0;
    let reportPeriodsLoaded = false;
    function updateReportSummary(monthKey) {
        const total = Number(reportSummary.total || reportTotal), high = Number(reportSummary.high || 0), moderate = Number(reportSummary.moderate || 0);
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        set('summaryTotal', total); set('summaryHigh', high); set('summaryModerate', moderate); set('summaryLow', Math.max(0, total - high - moderate));
        set('reportSummaryPeriod', monthKey ? `Period: ${monthKey}` : 'Selected period');
        const types = (reportSummary.types || []).slice(0, 3).map(item => `${item.type || 'Unclassified'} (${item.count})`).join(' · ');
        const location = reportSummary.locations?.[0];
        const hour = reportSummary.hours?.[0];
        set('summaryTypes', types || 'No reports yet');
        set('summaryLocation', location ? `${location.location || 'Unlisted'} (${location.count})` : 'No reports yet');
        set('summaryHour', hour ? `${String(hour.hour).padStart(2, '0')}:00–${String((Number(hour.hour) + 1) % 24).padStart(2, '0')}:00` : 'No reports yet');
    }
    const reportPager = document.createElement('div');
    reportPager.className = 'report-pagination'; reportPager.setAttribute('role','navigation'); reportPager.setAttribute('aria-label','Report record pages');
    tableBody?.closest('table')?.after(reportPager);
    function reportParams(page = reportPage, limit = 10) {
        const month = monthSelect.value;
        const range = ReportDateFilter.effectiveRange(month, filterDateFrom?.value, filterDateTo?.value);
        const params = new URLSearchParams({page,limit,include_resolved:'1',
            date_from:range.dateFrom,
            date_to:range.dateTo});
        for (const [key,field] of [['status',filterStatus],['type',filterType],['form_type',filterFormType],['location',filterLocation]]) if(field?.value) params.set(key,field.value);
        if (reportSearch?.value.trim()) params.set('search', reportSearch.value.trim());
        return params;
    }
    function renderReportPager(totalPages) {
        reportPager.replaceChildren();
        const label = document.createElement('span'); label.textContent = `${reportTotal} matching records · Page ${reportPage} of ${Math.max(1,totalPages)} · 10 records per page`;
        for (const [text,delta,disabled] of [['Previous',-1,reportPage<=1],['Next',1,reportPage>=totalPages]]) {
            const button = document.createElement('button'); button.type='button'; button.className='btn btn-secondary'; button.textContent=text; button.disabled=disabled;
            button.addEventListener('click',()=>{reportPage+=delta;loadIncidents();}); reportPager.append(button);
        }
        reportPager.append(label);
    }
    async function exportRecords() {
        const params = reportParams(1,100), records = new Map(); let pages=1, expected;
        for(let page=1;page<=pages;page++) {
            params.set('page',page);
            const response = await apiFetch('/incidents?' + params); if(!response.ok) throw new Error('Could not load the complete selected report.');
            const data = await response.json();
            if(expected !== undefined && Number(data.total)!==expected) throw new Error('Records changed during export. Please retry.');
            expected=Number(data.total);pages=data.totalPages;
            data.incidents.forEach(record=>records.set(record.id,record));
        }
        if(records.size!==expected) throw new Error('Records changed during export. Please retry.');
        return [...records.values()];
    }

    async function loadIncidents() {
        const request = ++reportRequest;
        try {
            if(!reportPeriodsLoaded) {
                const response = await apiFetch('/incidents/metadata'); if(!response.ok) throw new Error('Could not load periods');
                const metadata = await response.json();
                populateMonthDropdown(metadata.months.map(item=>({date:item.month+'-01'})));
                if(filterPatrolLocation) {
                    metadata.patrolLocations.forEach(item=>filterPatrolLocation.add(new Option(item.location,item.location)));
                }
                populateLocationDropdown(); reportPeriodsLoaded=true;
            }
            if(!monthSelect.value) { reportTotal=0;renderReportPager(0);return; }
            syncReportDateInputs();
            const params = reportParams();
            const [response,summary] = await Promise.all([apiFetch('/incidents?' + params),apiFetch('/incidents/summary?' + params)]);
            if (!response.ok) throw new Error('Failed to load incidents');
            const responseData = await response.json();
            if(!summary.ok) throw new Error('Could not load report totals');
            const totals = await summary.json();
            if(request !== reportRequest) return;
            const data = responseData.incidents || [];
            currentIncidentData = data;
            reportSummary=totals; reportTotal=Number(responseData.total);
            const initialMonth = monthSelect.value;
            updateReportSummary(initialMonth);
            renderReportPager(responseData.totalPages);
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

    let patrolReportPage=1, patrolReportTotal=0;
    const patrolReportPager=document.createElement('div');
    patrolReportPager.className='report-pagination';patrolReportPager.setAttribute('role','navigation');patrolReportPager.setAttribute('aria-label','Patrol log report pages');
    patrolLogTableBody?.closest('table')?.after(patrolReportPager);
    function patrolReportParams(page=patrolReportPage,limit=10) {
        const params=new URLSearchParams({page,limit});
        for(const [name,field] of [['date_from',filterPatrolDateFrom],['date_to',filterPatrolDateTo],['status',filterPatrolStatus],['location',filterPatrolLocation]]) if(field?.value) params.set(name,field.value);
        if (patrolReportSearch?.value.trim()) params.set('search', patrolReportSearch.value.trim());
        return params;
    }
    async function exportPatrolRecords() {
        const params=patrolReportParams(1,100), records=new Map();let pages=1,expected;
        for(let page=1;page<=pages;page++) {
            params.set('page',page); const response=await apiFetch('/patrol-logs?'+params); if(!response.ok) throw new Error('Could not load patrol log export.');
            const total=Number(response.headers.get('X-Total-Count'));
            if(expected!==undefined&&total!==expected) throw new Error('Patrol logs changed during export. Please retry.');
            expected=total; pages=Number(response.headers.get('X-Total-Pages'));
            (await response.json()).forEach(record=>records.set(record.id,record));
        }
        if(records.size!==expected) throw new Error('Patrol logs changed during export. Please retry.');
        return [...records.values()];
    }
    let patrolReportRequest=0;
    async function loadPatrolLogs() {
        const request=++patrolReportRequest;
        try {
            // The API performs the search/filtering and returns one bounded
            // page, matching the incident report table.
            const response = await apiFetch('/patrol-logs?'+patrolReportParams());
            if (!response.ok) throw new Error('Failed to load patrol logs');

            const rows=await response.json(); if(request!==patrolReportRequest) return;
            currentPatrolLogData = rows;
            patrolReportTotal=Number(response.headers.get('X-Total-Count'));
            const pages=Number(response.headers.get('X-Total-Pages'));
            patrolReportPager.replaceChildren();
            const text=document.createElement('span');text.textContent=`${patrolReportTotal} matching logs · Page ${patrolReportPage} of ${Math.max(1,pages)}`;
            for(const [label,delta,disabled] of [['Previous',-1,patrolReportPage<=1],['Next',1,patrolReportPage>=pages]]) {
                const button=document.createElement('button');button.type='button';button.className='btn btn-secondary';button.textContent=label;button.disabled=disabled;
                button.addEventListener('click',()=>{patrolReportPage+=delta;loadPatrolLogs();});patrolReportPager.append(button);
            }
            patrolReportPager.append(text);
            populatePatrolFilterDropdowns(currentPatrolLogData);
            updatePatrolLogView();
        } catch (error) {
            console.error('Error loading patrol logs:', error);
            if (patrolLogTableBody) {
                patrolLogTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px; color: #ef4444;">Error loading patrol logs from server.</td></tr>`;
            }
        }
    }

    // Patrol locations aren't a fixed list the way BARANGAY_LOCATIONS is
    // for incidents - derived from whichever locations actually have a
    // logged patrol, so an empty dropdown never shows a location with
    // zero matching records.
    function populatePatrolFilterDropdowns(data) {
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
        const location = filterPatrolLocation?.value || '';

        return allData.filter(item => {
            if (dateFrom && item.patrol_date < dateFrom) return false;
            if (dateTo && item.patrol_date > dateTo) return false;
            if (status && item.status !== status) return false;
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
            patrolLogCount.textContent = `${patrolReportTotal} matching logs (paged)`;
        }

        if (!patrolLogTableBody) return;

        patrolLogTableBody.innerHTML = "";
        if (filtered.length === 0) {
            patrolLogTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px; color: #94a3b8;">No patrol log records match the selected filters.</td></tr>`;
            return;
        }

        filtered.forEach(item => {
            const tr = document.createElement("tr");
            const statusClass = getPatrolStatusBadgeClass(item.status);

            tr.innerHTML = `
                <td class="font-bold">${item.id || 'N/A'}</td>
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
                        location: filterPatrolLocation?.value || ''
                    },
                    recordCount: patrolReportTotal
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

    // Applies either the explicit date range or the default month, plus
    // every other optional filter as AND conditions.
    // Shared by the table, CSV export, and the Patrol Recommendation
    // modal so all three always agree on what's "in view".
    function applyFilters(monthKey, allData) {
        if (!monthKey || !allData) return [];

        const dateFrom = filterDateFrom?.value || '';
        const dateTo = filterDateTo?.value || '';
        const status = filterStatus?.value || '';
        const type = filterType?.value || '';
        const formType = filterFormType?.value || '';
        const location = filterLocation?.value || '';
        const hasExplicitDateRange = Boolean(dateFrom || dateTo);

        return allData.filter(item => {
            if (!item.date || (!hasExplicitDateRange && !item.date.startsWith(monthKey))) return false;
            if (dateFrom && item.date < dateFrom) return false;
            if (dateTo && item.date > dateTo) return false;

            if (status && item.status !== status) return false;
            if (type && item.incident_type !== type) return false;
            if (formType && (item.form_type || 'blotter') !== formType) return false;
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
            return 'PRIORITY: Deploy additional personnel, increase patrol frequency, and coordinate with barangay officials.';
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
            const dateFrom = filterDateFrom?.value || '';
            const dateTo = filterDateTo?.value || '';
            if (dateFrom && dateTo) {
                monthBadge.textContent = dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`;
            } else {
                const [year, month] = monthKey.split('-');
                const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                monthBadge.textContent = `${monthNames[parseInt(month) - 1]} ${year}`;
            }
        }

        if (tableBody) {
            tableBody.innerHTML = "";
            if (filteredIncidents.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 24px; color: #94a3b8;">No incident records match the selected filters.</td></tr>`;
            } else {
                filteredIncidents.forEach(item => {
                    const tr = document.createElement("tr");
                    
                    const statusClass = getStatusBadgeClass(item.status);
                    const dangerClass = getDangerBadgeClass(item.danger_level);
                    
                    const formattedDate = formatDate(item.date);
                    const formattedTime = formatTime(item.time);
                    
                    const location = item.street_name || (item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : 'N/A');
                    const address = item.address || 'N/A';

                    const formBadge = item.form_type === 'crime'
                        ? '<span class="badge" style="background:#3b82f6;color:#fff;font-size:0.65rem;">Incident</span>'
                        : '<span class="badge" style="background:#f59e0b;color:#fff;font-size:0.65rem;">Blotter</span>';

                    tr.innerHTML = `
                        <td class="font-bold">${item.id || 'N/A'}</td>
                        <td>${formBadge}</td>
                        <td>${escapeHTML(item.incident_type || 'N/A')}</td>
                        <td>${formattedDate} ${formattedTime}</td>
                        <td>${escapeHTML(location)}</td>
                        <td>${escapeHTML(address)}</td>
                        <td><span class="${statusClass}">${escapeHTML(item.status || 'Open')}</span></td>
                        <td><span class="${dangerClass}">${escapeHTML(item.danger_level || 'Calculated by System')}</span></td>
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
        return window.formatDisplayTime ? (window.formatDisplayTime(timeStr) || 'N/A') : (timeStr || 'N/A');
    }

    function openPatrolModal() {
        const currentMonth = monthSelect.value;
        if (!currentMonth) {
            showToast('Please select a valid month first.', 'error');
            return;
        }

        const [year, month] = currentMonth.split('-');
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const monthName = `${monthNames[parseInt(month) - 1]} ${year}`;

        // Reflects the same refine-within-month filters as the table/CSV -
        // filtering to just "Theft" incidents, say, should mean the patrol
        // guidance is about those Theft incidents too, not the whole month.
        const monthData = applyFilters(currentMonth, currentIncidentData);
        const highRiskCount = Number(reportSummary.high)||0;
        const moderateRiskCount = Number(reportSummary.moderate)||0;

        // Rank locations by incident count instead of just listing every
        // distinct street that had any incident at all - previously this
        // dumped every location from the whole month into "Priority
        // Hotspots", which isn't a priority list, just the full list.
        // Mirrors the same group-count-sort pattern dashboard.js's "Top
        // Hotspot Areas" widget already uses.
        const locationCounts = {};
        (reportSummary.locations || []).forEach(item=>{if(item.location)locationCounts[item.location]=Number(item.count);});
        const rankedLocations = Object.entries(locationCounts).sort((a, b) => b[1] - a[1]);
        const topLocations = rankedLocations.slice(0, 3);
        const topLocationName = topLocations.length > 0 ? topLocations[0][0] : null;
        const hotspots = topLocations.length > 0
            ? topLocations.map(([loc, count]) => `${loc} (${count} incident${count > 1 ? 's' : ''})`).join(', ')
            : 'General Coverage Area';

        let peakHour = "N/A";
        if (reportTotal > 0) {
            const hourCounts = {};
            (reportSummary.hours || []).forEach(item=>{hourCounts[item.hour]=Number(item.count);});
            const sortedHours = Object.entries(hourCounts).sort((a, b) => b[1] - a[1]);
            if (sortedHours.length > 0) {
                const hour = parseInt(sortedHours[0][0]);
                peakHour = `${String(hour).padStart(2, '0')}:00 - ${String((hour + 1) % 24).padStart(2, '0')}:00`;
            }
        }

        let summary = "Routine patrol schedule in effect.";
        let directives = ["Maintain routine roving patrol."];
        
        if (highRiskCount > 2) {
            summary = `High crime intensity detected. Heavy patrol deployment advised across ${hotspots}.`;
            directives = [
                `Deploy a stationary Patrol Outpost in ${topLocationName || 'Priority Zones'} between 7:00 PM and 11:00 PM.`,
                "Mobile motorcycle patrol every 30 minutes.",
                "Mandatory coordination with Caloocan Police Station 12 for high-risk zones."
            ];
        } else if (moderateRiskCount > 2) {
            summary = `Moderate disturbance risk. Increase evening foot patrols around ${hotspots}.`;
            directives = [
                `Deploy 4 barangay personnel at ${topLocationName || 'designated areas'} during closing hours (6 PM - 9 PM).`,
                "Regular patrol drive for traffic decongestion.",
                "Maintain active presence to prevent late-night altercations."
            ];
        } else if (reportTotal > 0) {
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
                        formType: filterFormType?.value || '',
                        location: filterLocation?.value || ''
                    },
                    recordCount: reportTotal
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
            if (filterDateFrom) filterDateFrom.value = '';
            if (filterDateTo) filterDateTo.value = '';
            syncReportDateInputs();
            reportPage=1;loadIncidents();
        });
    }

    // Every refine-within-month filter re-renders the same table on
    // change - no separate "Apply" step.
    [[filterDateFrom, 'from'], [filterDateTo, 'to']]
        .filter(([field]) => Boolean(field))
        .forEach(([field, changedField]) => {
            field.addEventListener("change", () => {
                syncReportDateInputs(changedField);
                reportPage=1;loadIncidents();
            });
        });

    [filterStatus, filterType, filterFormType, filterLocation]
        .filter(Boolean)
        .forEach(field => {
            field.addEventListener("change", () => {
                reportPage=1;loadIncidents();
            });
        });

    for (const [field, reset, load] of [
        [reportSearch, () => { reportPage = 1; }, loadIncidents],
        [patrolReportSearch, () => { patrolReportPage = 1; }, loadPatrolLogs]
    ]) {
        if (!field) continue;
        let debounce;
        field.addEventListener('input', () => {
            clearTimeout(debounce);
            reset();
            debounce = setTimeout(load, 250);
        });
    }

    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener("click", () => {
            [reportSearch, filterDateFrom, filterDateTo, filterStatus, filterType, filterFormType, filterLocation]
                .filter(Boolean)
                .forEach(field => { field.value = ""; });
            reportPage=1;loadIncidents();
        });
    }

    // Patrol Logs tab filters - every change re-renders, same as the
    // Incident Reports tab above.
    [filterPatrolDateFrom, filterPatrolDateTo, filterPatrolStatus, filterPatrolLocation]
        .filter(Boolean)
        .forEach(field => {
            field.addEventListener("change", ()=>{patrolReportPage=1;loadPatrolLogs();});
        });

    if (clearPatrolFiltersBtn) {
        clearPatrolFiltersBtn.addEventListener("click", () => {
            [patrolReportSearch, filterPatrolDateFrom, filterPatrolDateTo, filterPatrolStatus, filterPatrolLocation]
                .filter(Boolean)
                .forEach(field => { field.value = ""; });
            patrolReportPage=1;loadPatrolLogs();
        });
    }

    if (printPatrolLogBtn) {
        printPatrolLogBtn.addEventListener("click", async () => {
            printPatrolLogBtn.disabled=true;const page=currentPatrolLogData;
            try {currentPatrolLogData=await exportPatrolRecords();updatePatrolLogView();logPatrolReportAction('PRINT_PATROL_LOGS_REPORT');window.print();}
            catch(error){showToast(error.message,'error');}
            finally{currentPatrolLogData=page;updatePatrolLogView();printPatrolLogBtn.disabled=false;}
        });
    }

    if (exportPatrolLogCsvBtn) {
        exportPatrolLogCsvBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            let filteredData;exportPatrolLogCsvBtn.disabled=true;
            try{filteredData=await exportPatrolRecords();}catch(error){showToast(error.message,'error');return;}finally{exportPatrolLogCsvBtn.disabled=false;}

            if (filteredData.length === 0) {
                showToast("No patrol log data available to export for the selected filters.", "error");
                return;
            }

            const csvField = (value) => {
                let str = String(value ?? '');
                if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
                return `"${str.replace(/"/g, '""')}"`;
            };

            // BOM + CRLF makes the file open cleanly in Excel, including
            // names/locations containing Filipino characters.
            const csvRows = [
                ['Log ID', 'Patrol Date', 'Location', 'Status', 'Report']
            ];

            filteredData.forEach(item => {
                csvRows.push([
                    item.id || '', item.patrol_date || '', item.schedule_location || '',
                    item.status || '', item.report || ''
                ]);
            });

            const csvContent = '\uFEFF' + csvRows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';

            logPatrolReportAction('EXPORT_CSV_PATROL_LOGS');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; // local date, not UTC
            link.setAttribute("href", url);
            link.setAttribute("download", `Barangay179_Patrol_Logs_${today}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        });
    }

    if (printBtn) {
        printBtn.addEventListener("click", async () => {
            printBtn.disabled=true;
            try { const rows=await exportRecords(); updateReportView(monthSelect.value,rows); logReportAction('PRINT_REPORT'); window.print(); }
            catch(error){showToast(error.message,'error');}
            finally {updateReportView(monthSelect.value,currentIncidentData);printBtn.disabled=false;}
        });
    }

    if (exportCsvBtn) {
        exportCsvBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            const currentMonth = monthSelect.value;
            if (!currentMonth) {
                showToast("Please select a month first.", "error");
                return;
            }
            
            let filteredData;
            exportCsvBtn.disabled=true;
            try { filteredData = await exportRecords(); }
            catch(error){showToast(error.message,'error');return;}
            finally {exportCsvBtn.disabled=false;}

            if (filteredData.length === 0) {
                showToast("No data available to export for the selected filters.", "error");
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

            // Keep a stable, descriptive schema so the export is useful for
            // both human review and later analysis. BOM/CRLF improve Excel
            // compatibility without changing the CSV data model.
            const csvRows = [[
                'Incident ID', 'Public Number', 'Form Type', 'Incident Type',
                'Occurrence Date', 'Occurrence Time', 'Day', 'Time of Day',
                'Location', 'Address', 'Status', 'Priority', 'Severity',
                'Danger Level', 'Recommended Action', 'Reporter Name',
                'Reporter Contact', 'Description'
            ]];

            filteredData.forEach(item => {
                const location = item.street_name || (item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : 'N/A');

                const reporterName = item.reporter_name || 'N/A';
                const reporterContact = item.reporter_contact_no || 'N/A';

                csvRows.push([
                    item.id || '', item.public_number || item.blotter_number || '',
                    item.form_type || 'blotter', item.incident_type || '',
                    item.date || '', item.time || '', item.day_of_week || '',
                    item.time_of_day || '', location, item.address || '',
                    item.status || '', item.priority || '', item.severity || '',
                    item.danger_level || '', getRecommendedAction(item),
                    reporterName, reporterContact, item.description || ''
                ]);
            });

            const csvContent = '\uFEFF' + csvRows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';

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
    // without needing to re-login.
    startLivePolling(loadIncidents, 15000);
    startLivePolling(loadPatrolLogs, 15000);
});

console.log('✅ report.js loaded successfully');
