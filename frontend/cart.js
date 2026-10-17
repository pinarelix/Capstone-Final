/* ============================================================
   CART.JS
   Barangay 179 Crime BI
   CART Decision Tree Analytics - WITH REAL DATA + LOGGING
============================================================ */

/* ============================================================
   DOM READY
============================================================ */

document.addEventListener("DOMContentLoaded", function () {
    // Apply role-based UI gamit ang apiHelper
    const user = getCurrentUser();
    
    if (!user && !window.location.pathname.includes('login.html')) {
        window.location.href = 'login.html';
        return;
    }
    
    applyRoleBasedUI(); // mula sa apiHelper.js

    const fullAnalysisBtn = document.getElementById("runFullAnalysisBtn");
    if (fullAnalysisBtn) {
        fullAnalysisBtn.addEventListener("click", runFullAnalysis);
    }

    const refreshHistoryBtn = document.getElementById("refreshAnalysisHistoryBtn");
    if (refreshHistoryBtn) {
        refreshHistoryBtn.addEventListener("click", loadAnalysisHistory);
    }

    setupNavigationButtons();
    setupTabs();
    loadAnalysisHistory();

    startLivePolling(() => {
        loadAnalysisHistory();
    }, 15000);
});

// Full re-analysis (POST /cart/analyze): re-scores every incident and
// writes one row to Recent CART Analysis Runs - unlike executeCartAnalysis
// above, which is a stateless what-if prediction for the form inputs.
async function runFullAnalysis() {
    const btn = document.getElementById("runFullAnalysisBtn");
    const status = document.getElementById("fullAnalysisStatus");
    const originalHtml = btn ? btn.innerHTML : '';

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
    }
    if (status) {
        status.style.color = '#64748b';
        status.textContent = 'Running CART analysis on all recorded incidents...';
    }

    try {
        const response = await apiFetch('/cart/analyze', { method: 'POST', body: JSON.stringify({}) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Analysis failed');

        if (status) {
            status.style.color = '#15803d';
            status.textContent = `✅ Analysis completed in ${data.execution_time_ms} ms - see the newest run below.`;
        }
        loadAnalysisHistory();
    } catch (error) {
        console.error('❌ Error running full CART analysis:', error);
        if (status) {
            status.style.color = '#b91c1c';
            status.textContent = `❌ ${error.message}. Please try again.`;
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

function loadAnalysisHistory() {
    const tbody = document.getElementById('analysisHistoryBody');
    if (!tbody) return;

    apiFetch('/cart/analysis-logs')
        .then(response => {
            if (!response.ok) throw new Error('Failed to fetch analysis history');
            return response.json();
        })
        .then(logs => {
            console.log('📋 Analysis History:', logs);
            
            if (logs.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" style="text-align: center; padding: 24px; color: #888;">
                            No CART analysis runs yet.
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = logs.map(log => {
                const date = new Date(log.run_timestamp);
                const formattedDate = date.toLocaleString('en-PH', {
                    month: 'short',
                    day: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                const statusClass = log.status === 'completed' ? 'badge-open' : 'badge-resolved';
                const statusText = log.status === 'completed' ? '✅ Completed' : '❌ Failed';

                const isSimulation = log.analysis_type === 'simulation';
                const typeBadge = isSimulation
                    ? '<span class="badge-subtle">Simulation</span>'
                    : '<span class="badge-subtle" title="Full system-wide re-score">Full Analysis</span>';
                const incidentsCell = isSimulation ? '—' : (log.total_incidents_analyzed ?? 0);

                return `
                    <tr>
                        <td>${formattedDate}</td>
                        <td>${typeBadge}</td>
                        <td><strong>${incidentsCell}</strong></td>
                        <td><span class="badge badge-danger-high">${log.high_risk_count || 0}</span></td>
                        <td><span class="badge badge-danger-mod">${log.moderate_risk_count || 0}</span></td>
                        <td><span class="badge badge-danger-low">${log.low_risk_count || 0}</span></td>
                        <td><span class="badge ${statusClass}">${statusText}</span></td>
                        <td>${escapeHTML(log.triggered_by_name || 'System')}</td>
                    </tr>
                `;
            }).join('');
        })
        .catch(error => {
            console.error('❌ Error loading analysis history:', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 24px; color: #888;">
                        Failed to load analysis history.
                    </td>
                </tr>
            `;
        });
}

function setupNavigationButtons() {
    const homeBtn = document.getElementById("homeBtn");
    if (homeBtn) {
        homeBtn.addEventListener("click", function (e) {
            e.preventDefault();
            window.location.href = "dashboard.html";
        });
    }
}

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            this.classList.add('active');
            const tabId = this.getAttribute('data-tab');
            document.getElementById(`tab-${tabId}`).classList.add('active');
        });
    });
}

console.log('✅ cart.js loaded successfully');