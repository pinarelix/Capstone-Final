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
        const roleDisplay = user?.role === 'Administrator' 
            ? '👑 Administrator — Full System Access' 
            : '📊 Decision-Maker — View & Analytics Access';
        roleEl.textContent = roleDisplay || 'User';
    }
    
    const monthSelect = document.getElementById("reportMonthSelect");
    const monthBadge = document.getElementById("reportMonthBadge");
    const tableBody = document.getElementById("reportTableBody");
    const printBtn = document.getElementById("printPdfBtn");
    const exportCsvBtn = document.getElementById("exportCsvBtn");
    const viewPatrolBtn = document.getElementById("viewPatrolBtn");

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

        if (monthSelect.options.length > 0) {
            monthSelect.value = monthSelect.options[0].value;
        }
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

    function updateReportView(monthKey, allData) {
        if (!monthKey || !allData) return;

        const filteredIncidents = allData.filter(item => {
            if (!item.date) return false;
            return item.date.startsWith(monthKey);
        });

        if (monthBadge) {
            const [year, month] = monthKey.split('-');
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            monthBadge.textContent = `${monthNames[parseInt(month) - 1]} ${year}`;
        }

        if (tableBody) {
            tableBody.innerHTML = "";
            if (filteredIncidents.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #94a3b8;">No incident records found for this month.</td></tr>`;
            } else {
                filteredIncidents.forEach(item => {
                    const tr = document.createElement("tr");
                    
                    const statusClass = getStatusBadgeClass(item.status);
                    const dangerClass = getDangerBadgeClass(item.danger_level);
                    
                    const formattedDate = formatDate(item.date);
                    const formattedTime = formatTime(item.time);
                    
                    const location = item.street_name || item.location || (item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : 'N/A');

                    tr.innerHTML = `
                        <td class="font-bold">${item.id || 'N/A'}</td>
                        <td>${escapeHTML(item.incident_type || 'N/A')}</td>
                        <td>${formattedDate} ${formattedTime}</td>
                        <td>${escapeHTML(location)}</td>
                        <td><span class="${statusClass}">${escapeHTML(item.status || 'Open')}</span></td>
                        <td><span class="${dangerClass}">${escapeHTML(item.danger_level || 'Calculated by System')}</span></td>
                        <td>${escapeHTML(item.recommended_action || 'Scheduled patrol and risk monitoring')}</td>
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

        const monthData = currentIncidentData.filter(item => item.date?.startsWith(currentMonth));
        const highRiskCount = monthData.filter(item => item.danger_level?.includes("Level 3") || item.danger_level?.includes("High")).length;
        const moderateRiskCount = monthData.filter(item => item.danger_level?.includes("Level 2") || item.danger_level?.includes("Moderate")).length;

        const locations = [...new Set(monthData.map(item => item.street_name || item.location || (item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : null)).filter(Boolean))];
        const hotspots = locations.length > 0 ? locations.join(', ') : 'General Coverage Area';

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
            summary = `⚠️ High crime intensity detected. Heavy tanod deployment advised across ${hotspots}.`;
            directives = [
                `🚨 Deploy stationary Tanod Outpost in ${locations[0] || 'Priority Zones'} between 7:00 PM and 11:00 PM.`,
                "🛵 Mobile motorcycle patrol every 30 minutes.",
                "📞 Mandatory coordination with Caloocan Police Station 12 for high-risk zones."
            ];
        } else if (moderateRiskCount > 2) {
            summary = `⚡ Moderate disturbance risk. Increase evening foot patrols around ${hotspots}.`;
            directives = [
                `👮 Deploy 4 Barangay Tanods at ${locations[0] || 'designated areas'} during closing hours (6 PM - 9 PM).`,
                "🚗 Regular patrol drive for traffic decongestion.",
                "💪 Maintain active presence to prevent late-night altercations."
            ];
        } else if (monthData.length > 0) {
            summary = `✅ Low risk level detected. Standard patrol procedures recommended.`;
            directives = [
                "🚶 Regular foot patrol in designated areas.",
                "📋 Monitor and report any suspicious activities.",
                "🤝 Maintain community engagement and visibility."
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

    // =========================================================
    // EVENT LISTENERS
    // =========================================================
    
    if (monthSelect) {
        monthSelect.addEventListener("change", (e) => {
            updateReportView(e.target.value, currentIncidentData);
        });
    }

    if (printBtn) {
        printBtn.addEventListener("click", () => {
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
            
            const filteredData = currentIncidentData.filter(item => item.date?.startsWith(currentMonth));
            
            if (filteredData.length === 0) {
                alert("No data available to export for this month.");
                return;
            }
            
            const csvField = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

            let csvContent = "Incident ID,Type,Date,Time,Location,Status,Danger Level,Recommended Action,Reporter Name,Reporter Contact\n";

            filteredData.forEach(item => {
                const location = item.street_name || item.location || (item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : 'N/A');

                const reporterName = item.reporter_name || 'N/A';
                const reporterContact = item.reporter_contact_no || 'N/A';

                csvContent += [
                    item.id || '', item.incident_type || '', item.date || '', item.time || '',
                    location, item.status || '', item.danger_level || '',
                    item.recommended_action || '', reporterName, reporterContact
                ].map(csvField).join(',') + '\n';
            });

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

    await loadIncidents();
});

console.log('✅ report.js loaded successfully');