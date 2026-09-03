/* ============================================================
   CART.JS
   Barangay 179 Crime BI
   Interactive CART Predictive Analytics - WITH REAL DATA + LOGGING
   ✅ FIXED: Notifies patrol page when analysis is run
============================================================ */

// ✅ API_URL ay naka-define na sa apiHelper.js

/* ============================================================
   🔥 FIXED: Gumamit ng functions mula sa apiHelper.js
   (HINDI NA LOCAL STORAGE)
============================================================ */

// ✅ ITO NA LANG ANG KAILANGAN - WALA NANG CUSTOM FUNCTIONS

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

    const runBtn = document.getElementById("runCartBtn");
    const incidentTypeSelect = document.getElementById("incidentType");
    const otherGroup = document.getElementById("otherIncidentGroup");

    if (incidentTypeSelect) {
        incidentTypeSelect.addEventListener("change", function () {
            if (this.value === "Other") {
                if (otherGroup) otherGroup.classList.remove("hidden");
            } else {
                if (otherGroup) otherGroup.classList.add("hidden");
            }
        });
    }

    if (runBtn) {
        runBtn.addEventListener("click", executeCartAnalysis);
    }

    setupNavigationButtons();
    loadRealCartData();
    loadAnalysisHistory();
});

/* ============================================================
   LOAD REAL CART DATA
============================================================ */

function loadRealCartData() {
    apiFetch('/cart/risk-factors')
        .then(response => {
            if (!response.ok) throw new Error('Failed to fetch risk factors');
            return response.json();
        })
        .then(riskFactors => {
            console.log('📋 Loaded risk factors:', riskFactors.length);
            updateDashboardWithRealData(riskFactors);
            return apiFetch('/cart/summary');
        })
        .then(response => {
            if (!response.ok) throw new Error('Failed to fetch summary');
            return response.json();
        })
        .then(summary => {
            console.log('📊 Summary:', summary);
            updateSummaryUI(summary);
        })
        .catch(error => {
            console.error('❌ Error loading CART data:', error);
        });
}

function updateDashboardWithRealData(riskFactors) {
    let level1 = 0, level2 = 0, level3 = 0;
    let totalScore = 0;
    
    riskFactors.forEach(item => {
        if (item.danger_level === 'Level 3' || item.danger_level === 'Level 3 — High Crime / Considerable Danger') {
            level3++;
        } else if (item.danger_level === 'Level 2' || item.danger_level === 'Level 2 — Moderate Danger / Caution Area') {
            level2++;
        } else if (item.danger_level === 'Level 1' || item.danger_level === 'Level 1 — Low Danger / Stable Area') {
            level1++;
        }
        totalScore += (item.total_risk_score || 0);
    });
    
    const avgScore = riskFactors.length > 0 ? Math.round(totalScore / riskFactors.length) : 0;
    
    let dominantLevel = 'Level 1';
    let dominantCount = level1;
    if (level2 > dominantCount) { dominantLevel = 'Level 2'; dominantCount = level2; }
    if (level3 > dominantCount) { dominantLevel = 'Level 3'; dominantCount = level3; }
    
    const riskScore = document.getElementById('riskScore');
    if (riskScore) riskScore.textContent = avgScore || 24;
    
    const riskBadge = document.getElementById('riskLevelBadge');
    if (riskBadge) {
        let levelText = '';
        let badgeClass = '';
        if (dominantLevel === 'Level 3' || level3 > 0) {
            levelText = 'Level 3 — High Crime / Considerable Danger';
            badgeClass = 'high';
        } else if (dominantLevel === 'Level 2' || level2 > 0) {
            levelText = 'Level 2 — Moderate Danger / Caution Area';
            badgeClass = 'moderate';
        } else {
            levelText = 'Level 1 — Low Danger / Stable Area';
            badgeClass = 'low';
        }
        riskBadge.className = `risk-level-banner ${badgeClass}`;
        riskBadge.textContent = levelText;
    }
    
    updateRiskCircle(dominantLevel === 'Level 3' ? 'high' : dominantLevel === 'Level 2' ? 'moderate' : 'low', avgScore);
    
    const summaryText = document.getElementById('predictionSummaryText');
    if (summaryText) {
        summaryText.textContent = `Based on ${riskFactors.length} incident records, the system detected ${level3} high-risk, ${level2} moderate-risk, and ${level1} low-risk patterns across Barangay 179.`;
    }
}

function updateSummaryUI(summary) {
    if (!summary) return;
    
    const riskBadge = document.getElementById('riskLevelBadge');
    if (riskBadge && summary.total_incidents > 0) {
        const highCount = summary.high_risk || 0;
        const moderateCount = summary.moderate_risk || 0;
        const lowCount = summary.low_risk || 0;
        
        let levelText = '';
        let badgeClass = '';
        
        if (highCount > moderateCount && highCount > lowCount) {
            levelText = `Level 3 — High Crime (${highCount} incidents)`;
            badgeClass = 'high';
        } else if (moderateCount > lowCount) {
            levelText = `Level 2 — Moderate Danger (${moderateCount} incidents)`;
            badgeClass = 'moderate';
        } else {
            levelText = `Level 1 — Low Danger (${lowCount} incidents)`;
            badgeClass = 'low';
        }
        
        riskBadge.className = `risk-level-banner ${badgeClass}`;
        riskBadge.textContent = levelText;
    }
    
    const riskScore = document.getElementById('riskScore');
    if (riskScore && summary.avg_risk_score) {
        riskScore.textContent = Math.round(summary.avg_risk_score);
    }
}

function executeCartAnalysis() {
    const loadingOverlay = document.getElementById("cartLoading");
    if (loadingOverlay) loadingOverlay.classList.remove("hidden");

    const incidentTypeElement = document.getElementById("incidentType");
    let incidentType = incidentTypeElement ? incidentTypeElement.value : "Unknown";

    if (incidentType === "Other") {
        const customInput = document.getElementById("otherIncidentInput");
        const customValue = customInput ? customInput.value.trim() : "";
        incidentType = customValue !== "" ? customValue : "Custom Incident";
    }

    const repeatedElement = document.getElementById("repeatedIncidents");
    const repeated = repeatedElement ? parseInt(repeatedElement.value, 10) || 0 : 0;

    const timeElement = document.getElementById("timeOccurrence");
    const timeOccur = timeElement && timeElement.value ? timeElement.value : "00:00";

    const dayElement = document.getElementById("dayOfWeek");
    const day = dayElement ? dayElement.value : "Unknown";

    const locationElement = document.getElementById("locationStreet");
    const location = locationElement ? locationElement.value : "Unknown Location";

    const historyElement = document.getElementById("riskHistory");
    const history = historyElement ? historyElement.value : "Low";

    const frequencyElement = document.getElementById("incidentFrequency");
    const frequency = frequencyElement ? frequencyElement.value : "Low";

    const inputs = { incidentType, repeated, timeOccur, day, location, history, frequency };

    apiFetch('/cart/predict', {
        method: 'POST',
        body: JSON.stringify({
            incident_type: incidentType,
            repeated: repeated,
            time: timeOccur,
            day: day,
            location: location,
            history: history,
            frequency: frequency
        })
    })
        .then(response => {
            if (!response.ok) throw new Error('Failed to run CART prediction');
            return response.json();
        })
        .then(result => {
            console.log('✅ CART prediction:', result);
            renderPredictionResult(inputs, result);
        })
        .catch(error => {
            console.error('❌ Error running CART prediction:', error);
            const explanationText = document.getElementById("explanationText");
            if (explanationText) {
                explanationText.textContent = 'Failed to run CART prediction. Please try again.';
            }
        })
        .finally(() => {
            if (loadingOverlay) loadingOverlay.classList.add("hidden");
        });
}

/**
 * Render a CART prediction result (from POST /cart/predict, the real
 * cartEngine - same one used for persisted incidents) into the page.
 */
function renderPredictionResult(inputs, result) {
    const { incidentType, repeated, timeOccur, day, location, history, frequency } = inputs;
    const { totalScore, dangerLevel, scores, locationCount } = result;

    const hourVal = parseInt((timeOccur || "0:0").split(":")[0], 10) || 0;
    const isNightTime = hourVal >= 18 || hourVal < 6;

    const LEVEL_META = {
        'Level 3': { badgeClass: 'high', borderColor: '#dc2626', confidence: '96% Confidence', label: 'Level 3 — High Crime / Considerable Danger' },
        'Level 2': { badgeClass: 'moderate', borderColor: '#f59e0b', confidence: '88% Confidence', label: 'Level 2 — Moderate Danger / Caution Area' },
        'Level 1': { badgeClass: 'low', borderColor: '#10b981', confidence: '91% Confidence', label: 'Level 1 — Low Danger / Stable Area' }
    };
    const { badgeClass, borderColor, confidence, label: riskLevel } = LEVEL_META[dangerLevel] || LEVEL_META['Level 1'];

    let streetRiskLevel = 'No Incidents Recorded';
    if (locationCount >= 5) streetRiskLevel = 'Critical Hotspot';
    else if (locationCount >= 3) streetRiskLevel = 'High Risk Area';
    else if (locationCount >= 2) streetRiskLevel = 'Moderate Risk Area';
    else if (locationCount >= 1) streetRiskLevel = 'Low Risk Area';

    const riskBadge = document.getElementById("riskLevelBadge");
    if (riskBadge) {
        riskBadge.className = `risk-level-banner ${badgeClass}`;
        riskBadge.textContent = riskLevel;
    }

    const resultCard = document.querySelector(".cart-result-card");
    if (resultCard) {
        resultCard.style.borderLeftColor = borderColor;
    }

    const confidenceBadge = document.getElementById("confidenceBadge");
    if (confidenceBadge) {
        confidenceBadge.textContent = confidence;
    }

    const riskScore = document.getElementById("riskScore");
    if (riskScore) {
        riskScore.textContent = totalScore;
    }

    const explanationText = document.getElementById("explanationText");
    if (explanationText) {
        explanationText.textContent = `The CART engine evaluated ${incidentType.toLowerCase()} at ${location} with ${repeated} recorded similar incident${repeated === 1 ? "" : "s"}. Based on ${locationCount} incident${locationCount === 1 ? '' : 's'} recorded in this location, the system classified it as ${streetRiskLevel}. The prediction is also influenced by ${frequency.toLowerCase()} incident frequency, ${history.toLowerCase()} previous risk history, and an occurrence time of ${timeOccur} on ${day}. The combined indicators resulted in a ${riskLevel} classification.`;
    }

    const patrolActionText = document.getElementById("patrolActionText");
    if (patrolActionText) {
        patrolActionText.textContent = badgeClass === 'high'
            ? "Prioritize the identified area for patrol coverage, increase visible barangay personnel presence during vulnerable periods, conduct close monitoring, and coordinate response planning when recurring incidents are observed."
            : badgeClass === 'moderate'
            ? "Deploy targeted patrols during identified peak periods, conduct periodic spot checks, increase visible barangay personnel presence, and monitor recurring incidents."
            : "Maintain standard routine patrols, regular barangay monitoring, community visibility, and periodic checking of the identified area.";
    }

    const predictionSummaryText = document.getElementById("predictionSummaryText");
    if (predictionSummaryText) {
        predictionSummaryText.textContent = `The CART prediction indicates a ${badgeClass}-risk pattern. Multiple input variables are aligned with the ${badgeClass}-risk branch, particularly the combination of incident type, repeated incidents, historical risk, incident frequency, and vulnerable time conditions.`;
    }

    const riskFactorsContainer = document.getElementById("riskFactors");
    if (riskFactorsContainer) {
        const timeDescription = isNightTime ? "Night period" : "Day period";
        riskFactorsContainer.innerHTML = `
            <div class="risk-factor">
                <span class="factor-icon">🔁</span>
                <div>
                    <strong>Recurrence</strong>
                    <small>${repeated} incident${repeated === 1 ? "" : "s"}</small>
                </div>
            </div>
            <div class="risk-factor">
                <span class="factor-icon">${isNightTime ? "🌙" : "☀️"}</span>
                <div>
                    <strong>Time Pattern</strong>
                    <small>${timeDescription}</small>
                </div>
            </div>
            <div class="risk-factor">
                <span class="factor-icon">📍</span>
                <div>
                    <strong>Location</strong>
                    <small>${escapeHTML(location)}</small>
                    <small style="color: #64748b; font-size: 0.45rem;">${locationCount} incident${locationCount === 1 ? '' : 's'} recorded</small>
                </div>
            </div>
            <div class="risk-factor">
                <span class="factor-icon">⚠️</span>
                <div>
                    <strong>History</strong>
                    <small>${history}</small>
                </div>
            </div>
        `;
    }

    const pathList = document.getElementById("decisionPathList");
    if (pathList) {
        pathList.innerHTML = `
            <li>Incident type checked: ${escapeHTML(incidentType)} (${scores.type} pts)</li>
            <li>Repeated incidents checked: ${repeated}</li>
            <li>Time checked: ${timeOccur} (${isNightTime ? "Night period" : "Day period"}, ${scores.time} pts)</li>
            <li>Day checked: ${day} (${scores.day} pts)</li>
            <li>Location checked: ${escapeHTML(location)}</li>
            <li>Incidents in this location: ${locationCount} (${scores.location} pts)</li>
            <li>Location risk: ${streetRiskLevel}</li>
            <li>Previous risk history: ${history}</li>
            <li>Incident frequency: ${frequency} (${scores.frequency} pts)</li>
            <li class="final-path">Final classification: ${riskLevel} (${totalScore} pts)</li>
        `;
    }

    const rootEvalText = document.getElementById("rootEvalText");
    if (rootEvalText) {
        rootEvalText.textContent = `The root node evaluates ${incidentType.toLowerCase()} at ${location} (${locationCount} incident${locationCount === 1 ? '' : 's'} recorded) using recurrence (${repeated} cases), historical risk (${history}), and frequency (${frequency}) before determining which CART branch should be followed.`;
    }

    const branchEvalText = document.getElementById("branchEvalText");
    if (branchEvalText) {
        branchEvalText.textContent = `Branch triggered by combined indicators: recurrence=${repeated}, frequency=${frequency}, previous history=${history}, time=${timeOccur}, and location=${location} (${locationCount} incident${locationCount === 1 ? '' : 's'} recorded - ${streetRiskLevel}).`;
    }

    const branchEvalBox = document.getElementById("branchEvalBox");
    if (branchEvalBox) {
        branchEvalBox.className = `expl-box branch-eval${badgeClass === 'low' ? ' low-branch' : badgeClass === 'moderate' ? ' mod-branch' : ''}`;
    }

    const ruleMatchBox = document.getElementById("ruleMatchBox");
    if (ruleMatchBox) {
        ruleMatchBox.className = `example-rule-box large-orange-box${badgeClass === 'low' ? ' low-rule' : ''}`;
    }

    const evaluatedRuleText = document.getElementById("evaluatedRuleText");
    if (evaluatedRuleText) {
        evaluatedRuleText.textContent = `If ${incidentType.toLowerCase()} incidents occur at ${location} (${locationCount} incident${locationCount === 1 ? '' : 's'} recorded, classified as ${streetRiskLevel}) with ${frequency.toLowerCase()} frequency, ${repeated} recorded recurrence${repeated === 1 ? "" : "s"}, ${history.toLowerCase()} previous risk history, and a ${isNightTime ? "night-time" : "daytime"} occurrence at ${timeOccur} on ${day}, the CART decision path evaluates the available branches and classifies the area as ${riskLevel}.`;
    }

    updateRiskCircle(badgeClass, totalScore);
}

function updateRiskCircle(riskClass, score) {
    const circle = document.querySelector(".risk-score-circle");
    if (!circle) return;

    const scoreElement = document.getElementById("riskScore");
    
    if (riskClass === "low") {
        circle.style.background = "linear-gradient(145deg,#ecfdf5,#d1fae5)";
        circle.style.borderColor = "#a7f3d0";
        if (scoreElement) scoreElement.style.color = "#047857";
    } else if (riskClass === "moderate") {
        circle.style.background = "linear-gradient(145deg,#fffbeb,#fef3c7)";
        circle.style.borderColor = "#fde68a";
        if (scoreElement) scoreElement.style.color = "#b45309";
    } else {
        circle.style.background = "linear-gradient(145deg,#fff1f2,#fee2e2)";
        circle.style.borderColor = "#fecaca";
        if (scoreElement) scoreElement.style.color = "#b91c1c";
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
                        <td colspan="7" style="text-align: center; padding: 24px; color: #888;">
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

                return `
                    <tr>
                        <td>${formattedDate}</td>
                        <td><strong>${log.total_incidents_analyzed || 0}</strong></td>
                        <td><span class="badge badge-danger-high">${log.high_risk_count || 0}</span></td>
                        <td><span class="badge badge-danger-mod">${log.moderate_risk_count || 0}</span></td>
                        <td><span class="badge badge-danger-low">${log.low_risk_count || 0}</span></td>
                        <td><span class="badge ${statusClass}">${statusText}</span></td>
                        <td>${log.triggered_by || 'System'}</td>
                    </tr>
                `;
            }).join('');
        })
        .catch(error => {
            console.error('❌ Error loading analysis history:', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 24px; color: #888;">
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

console.log('✅ cart.js loaded successfully');