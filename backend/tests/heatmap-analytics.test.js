const analytics = require('../../frontend/heatmap-analytics');

describe('Heatmap analytical helpers', () => {
    test.each([
        [33.99, 'Low Risk'], [34, 'Moderate Risk'], [66.99, 'Moderate Risk'], [67, 'High Risk']
    ])('point severity threshold edge %p is %s', (score, expected) => {
        expect(analytics.getSeverityLabel(score)).toBe(expected);
    });

    test('cell severity averages valid CART scores and uses 30 only when all scores are missing', () => {
        expect(analytics.getCellAvgSeverity([{ cart_score: '80' }, { cart_score: 40 }, { cart_score: null }])).toBe(60);
        expect(analytics.getCellAvgSeverity([{ cart_score: null }, { cart_score: 'not-a-number' }])).toBe(30);
    });

    test('all approved long-form incident names map to the intended category', () => {
        expect(analytics.getIncidentCategory('Occupation of Real Property or Usurpation of Removal, Sale or Pledge of Mortgaged Property')).toBe('Property Crimes');
        expect(analytics.getIncidentCategory('Unlawful Use of Means of Publication and Unlawful Utterances')).toBe('Social / Public Order Crimes');
        expect(analytics.getIncidentCategory('Prohibiting Publication of Acts Referred to in the Proceedings')).toBe('Social / Public Order Crimes');
        expect(analytics.getIncidentCategory('Unknown future type')).toBe('Other Incidents');
    });

    test('week buckets start on Monday, including a Sunday and a cross-month week', () => {
        expect(analytics.getMondayOfWeek('2026-10-19')).toBe('2026-10-19');
        expect(analytics.getMondayOfWeek('2026-10-25')).toBe('2026-10-19');
        expect(analytics.getMondayOfWeek('2026-11-01')).toBe('2026-10-26');
    });

    test('day, week, month, and category filters return the expected analytical population', () => {
        const incidents = [
            { id: 1, date: '2026-10-19', incident_type: 'Theft' },
            { id: 2, date: '2026-10-25', incident_type: 'Robbery' },
            { id: 3, date: '2026-11-01', incident_type: 'Noise Complaint' }
        ];
        expect(analytics.filterIncidents(incidents, { granularity: 'day', period: '2026-10-19' }).map(i => i.id)).toEqual([1]);
        expect(analytics.filterIncidents(incidents, { granularity: 'week', period: '2026-10-19' }).map(i => i.id)).toEqual([1, 2]);
        expect(analytics.filterIncidents(incidents, { granularity: 'month', period: '2026-10' }).map(i => i.id)).toEqual([1, 2]);
        expect(analytics.filterIncidents(incidents, { category: 'Violent Crimes' }).map(i => i.id)).toEqual([2]);
    });

    test('point KPIs use 3-decimal spatial cells, calculate the peak, and rank hotspot streets', () => {
        const result = analytics.calculatePointKPIs([
            { latitude: 14.75040, longitude: 121.07040, cart_score: 80, street_name: 'Alpha' },
            { latitude: 14.75049, longitude: 121.07049, cart_score: 60, street_name: 'Alpha' },
            { latitude: 14.75110, longitude: 121.07110, cart_score: null, street_name: 'Beta' },
            { latitude: null, longitude: 121.07, cart_score: 99, street_name: 'Excluded' }
        ]);
        expect(result.totalIncidents).toBe(3);
        expect(result.activeCells).toBe(2);
        expect(result.peakCount).toBe(2);
        expect(result.highRiskCells).toBe(1); // (80 + 60) / 2 = 70
        expect(result.topStreets).toEqual([['Alpha', 2], ['Beta', 1]]);
    });

    test('zero-valued coordinates are valid data rather than being treated as missing', () => {
        expect(analytics.calculatePointKPIs([{ latitude: 0, longitude: 0, street_name: 'Origin' }]).totalIncidents).toBe(1);
    });

    test('point severity and high-cell KPI respond to configured CART thresholds', () => {
        expect(analytics.getSeverityLabel(60, { level2: 40, level3: 60 })).toBe('High Risk');
        expect(analytics.getSeverityLabel(60, { level2: 40, level3: 80 })).toBe('Moderate Risk');
        const points = [{ latitude: 14.75, longitude: 121.07, cart_score: 60 }];
        expect(analytics.calculatePointKPIs(points, { level3: 60 }).highRiskCells).toBe(1);
        expect(analytics.calculatePointKPIs(points, { level3: 80 }).highRiskCells).toBe(0);
    });
});
