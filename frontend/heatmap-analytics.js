"use strict";

// Pure heatmap calculations shared by the browser and Jest. Keeping the
// analytical rules here makes date/category filtering, spatial cells, KPIs,
// and filtered street scores testable without Mapbox or a DOM.
(function exposeHeatmapAnalytics(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.HeatmapAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHeatmapAnalytics() {
    const SEVERITY_HIGH_MIN = 67;
    const SEVERITY_MODERATE_MIN = 34;

    const INCIDENT_CATEGORIES = {
        'Violent Crimes': [
            'Homicide', 'Attempted Murder', 'Kidnapping', 'Child Abuse', 'VAWC',
            'Illegal Release of Fire Arms', 'Attempted Arson', 'Robbery', 'Grave Threat',
            'Act of Lasciviousness', 'Physical Injury', 'Threats', 'Less Serious Physical Injuries',
            'Falsification of Documents', 'Slight Physical Injuries and Maltreatment', 'Light Threats'
        ],
        'Property Crimes': [
            'Arson', 'Theft', 'Fencing of Stolen Properties', 'Qualified Trespass to Dwelling',
            'Occupation of Real Property or Usurpation of Removal, Sale or Pledge of Mortgaged Property',
            'Trespassing', 'Altering Boundaries of Landmarks', 'Vandalism'
        ],
        'Financial / Fraud Crimes': [
            'Scam', 'Swindling of Estafa', 'Estafa', 'Cybercrime Prevention Act 2012 (RA 10175)',
            'Estafa/Debts', 'Cyber Bullying'
        ],
        'Social / Public Order Crimes': [
            'Voyeurism Act', 'Alarms and Scandals', 'Incriminating Innocent Persons',
            'Threatening to Publish and offer to prevent', 'Oral Defamation', 'Harassment',
            'Intriguing Against Honor', 'Unlawful Use of Means of Publication and Unlawful Utterances',
            'Prohibiting Publication of Acts Referred to in the Proceedings'
        ],
        'Special / Child-Related': ['BCPC', 'Child Support'],
        'Other Incidents': [
            'Hit and Run', 'Reckless Impudence Resulting to Damage to Property and Physical Injury',
            'Reckless Impudence Resulting Physical Injury', 'Noise Complaint', 'Anti Electricity Pilferage',
            'Reckless Impudence Resulting to Damage to Property', 'Safe Special Act', 'Bastos Law',
            'Abandoning a Minor', 'Abandonment of a Person in Danger', 'Inducing a Minor to Abandon His/her Home',
            'Animal Welfare Acts', 'Suspicious Activity', 'Traffic Obstruction', 'Breach of Contract',
            'Breach Contact', 'Curfew Violation', 'Abandon', 'Missing', 'Suicide', 'Others'
        ]
    };

    const TYPE_TO_CATEGORY = {};
    Object.entries(INCIDENT_CATEGORIES).forEach(([category, types]) => {
        types.forEach(type => { TYPE_TO_CATEGORY[type] = category; });
    });

    function getSeverityLabel(avgScore, thresholds = { level3: 67, level2: 34 }) {
        if (avgScore >= thresholds.level3) return 'High Risk';
        if (avgScore >= thresholds.level2) return 'Moderate Risk';
        return 'Low Risk';
    }

    function getCellAvgSeverity(incidents) {
        const scores = (incidents || [])
            .map(i => i.cart_score != null ? Number(i.cart_score) : null)
            .filter(Number.isFinite);
        if (scores.length === 0) return 30;
        return scores.reduce((sum, score) => sum + score, 0) / scores.length;
    }

    function getIncidentCategory(incidentType) {
        return TYPE_TO_CATEGORY[incidentType] || 'Other Incidents';
    }

    function getMondayOfWeek(dateStr) {
        const d = new Date(`${dateStr}T00:00:00`);
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function filterIncidents(incidents, { granularity = 'all', period = '', category = 'all', riskLevel = 'all' } = {}) {
        let filtered = Array.isArray(incidents) ? incidents.slice() : [];
        if (granularity === 'day') filtered = filtered.filter(i => i.date === period);
        else if (granularity === 'week') filtered = filtered.filter(i => i.date && getMondayOfWeek(i.date) === period);
        else if (granularity === 'month') filtered = filtered.filter(i => i.date && i.date.substring(0, 7) === period);
        if (category !== 'all') filtered = filtered.filter(i => getIncidentCategory(i.incident_type) === category);
        if (riskLevel !== 'all') filtered = filtered.filter(i => {
            const score = Number(i.cart_score ?? i.stored_cart_score ?? i.total_risk_score);
            const level = Number.isFinite(score) ? (score >= 67 ? 'high' : score >= 34 ? 'medium' : 'low') : String(i.danger_level || '').toLowerCase().includes('level 3') ? 'high' : String(i.danger_level || '').toLowerCase().includes('level 2') ? 'medium' : 'low';
            return level === riskLevel;
        });
        return filtered;
    }

    function hasValidCoordinates(item) {
        return item && item.latitude != null && item.longitude != null
            && Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude));
    }

    function calculatePointKPIs(incidents, thresholds = { level3: 67, level2: 34 }) {
        const valid = (incidents || []).filter(hasValidCoordinates);
        const cells = new Map();
        const streetTally = new Map();

        valid.forEach(item => {
            const key = `${Number(Number(item.latitude).toFixed(3))},${Number(Number(item.longitude).toFixed(3))}`;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(item);
            const street = item.street_name || 'Unknown';
            streetTally.set(street, (streetTally.get(street) || 0) + 1);
        });

        let peakCount = 0;
        let highRiskCells = 0;
        cells.forEach(items => {
            peakCount = Math.max(peakCount, items.length);
            if (getCellAvgSeverity(items) >= thresholds.level3) highRiskCells++;
        });

        const topStreets = Array.from(streetTally.entries())
            .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
            .slice(0, 3);

        return {
            valid,
            totalIncidents: valid.length,
            activeCells: cells.size,
            peakCount,
            highRiskCells,
            topStreets
        };
    }


    return {
        SEVERITY_HIGH_MIN,
        SEVERITY_MODERATE_MIN,
        INCIDENT_CATEGORIES,
        getSeverityLabel,
        getCellAvgSeverity,
        getIncidentCategory,
        getMondayOfWeek,
        filterIncidents,
        hasValidCoordinates,
        calculatePointKPIs
    };
});
