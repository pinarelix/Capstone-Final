// Pure unit tests for the CART risk-scoring engine — no DB, no HTTP,
// just the exported singleton's analyze() method. The engine uses
// severity-based weights selected from the incident's severity field:
// the base type weight (30%) drops to 20% for Medium-severity crimes
// and 10% for Low-severity ones, with the remaining factors
// redistributed proportionally.
const cartEngine = require('../cart-engine');

describe('CART engine scoring', () => {
    beforeEach(() => {
        // cartEngine is a singleton and API tests can update it at runtime.
        // Reset the analytical baseline so every case is deterministic.
        cartEngine.updateWeights({ time: 0.25, day: 0.15, type: 0.30, location: 0.20, frequency: 0.10 });
        cartEngine.updateThresholds({ level3: 67, level2: 34 });
        cartEngine.updateSourceWeights({ incident: 1.0, blotter: 0.85 });
    });

    test('a severe, frequent, well-known-hotspot High-severity incident scores into Level 3', () => {
        const incident = {
            incident_type: 'Homicide',   // type score 95
            time_of_day: 'Night',        // time score 90
            is_weekend: true,            // day score 70
            severity: 'High',            // type weight 30%
            form_type: 'crime'           // source weight 1.0
        };
        const locationData = { street_count: 6 };   // >=5 -> location 'critical' = 90
        const frequencyData = { recent_count: 6 };  // >=5 -> frequency 'very_high' = 95

        const result = cartEngine.analyze(incident, locationData, frequencyData);

        // High severity: type=30%, remaining 70% split proportionally
        // 95*.30 + 90*.25 + 70*.15 + 90*.20 + 95*.10 = 89.0
        expect(result.totalScore).toBeCloseTo(89.0, 1);
        expect(result.dangerLevel).toBe('Level 3');
        expect(result.dangerDescription).toContain('High Crime');
        expect(result.effectiveWeights.tier).toBe('High');
    });

    test('a minor, rare, no-history Low-severity incident scores into Level 1', () => {
        const incident = {
            incident_type: 'Missing',    // type score 35
            time_of_day: 'Morning',      // time score 20
            is_weekend: false,           // day score 40
            severity: 'Low',             // type weight 10%
            form_type: 'crime'           // source weight 1.0
        };

        // no prior incidents at this location / in the last 30 days
        const result = cartEngine.analyze(incident, null, null);

        // Low severity: type=10%, remaining 90% split proportionally
        // 35*.10 + 20*(0.90*25/70) + 40*(0.90*15/70) + 10*(0.90*20/70) + 5*(0.90*10/70) ≈ 20.86
        expect(result.totalScore).toBeCloseTo(20.86, 1);
        expect(result.dangerLevel).toBe('Level 1');
        expect(result.dangerDescription).toContain('Low Danger');
        expect(result.effectiveWeights.tier).toBe('Low');
    });

    test('an unrecognized incident type falls back to the default type score (30) rather than throwing', () => {
        const incident = {
            incident_type: 'Something Not In The List',
            time_of_day: 'Afternoon',
            is_weekend: false
        };

        expect(() => cartEngine.analyze(incident, null, null)).not.toThrow();
        const result = cartEngine.analyze(incident, null, null);
        expect(result.scores.type).toBe(30);
    });

    test('every factor score is included in the breakdown', () => {
        const incident = { incident_type: 'Theft', time_of_day: 'Evening', is_weekend: true };
        const result = cartEngine.analyze(incident, { street_count: 2 }, { recent_count: 1 });

        expect(result.scores).toEqual({
            time: 70,       // Evening
            day: 70,        // weekend
            type: 85,       // Theft
            location: 50,   // street_count 2 -> 'moderate'
            frequency: 25   // recent_count 1 -> 'low'
        });
    });

    test('severity-adaptive weights shift type weight based on the selected severity', () => {
        const high   = cartEngine.getSeverityWeight('High');
        const medium = cartEngine.getSeverityWeight('Medium');
        const low    = cartEngine.getSeverityWeight('Low');

        expect(high.typeWeight).toBe(0.30);
        expect(medium.typeWeight).toBe(0.20);
        expect(low.typeWeight).toBe(0.10);
    });

    test('adaptive weights always sum to 1.0', () => {
        for (const severity of ['High', 'Medium', 'Low']) {
            const ew = cartEngine.getAdaptiveWeights(50, severity);
            const sum = ew.type + ew.time + ew.day + ew.location + ew.frequency;
            expect(sum).toBeCloseTo(1.0, 10);
        }
    });

    test('effectiveWeights are included in the analysis result', () => {
        const incident = { incident_type: 'Robbery', time_of_day: 'Night', is_weekend: false, severity: 'Medium' };
        const result = cartEngine.analyze(incident, { street_count: 3 }, { recent_count: 2 });

        expect(result.effectiveWeights).toBeDefined();
        expect(result.effectiveWeights.tier).toBe('Medium');
        expect(result.effectiveWeights.type).toBe(0.20);
    });

    test.each([
        ['Morning', 20],
        ['Afternoon', 40],
        ['Evening', 70],
        ['Night', 90],
        ['Unknown', 20],
        [null, 20]
    ])('time bucket %p maps to %i points', (bucket, expected) => {
        expect(cartEngine.getTimeScore(bucket)).toBe(expected);
    });

    test.each([
        [0, 10], [1, 30], [2, 50], [3, 70], [4, 70], [5, 90], [20, 90]
    ])('location count %i maps to %i points at every boundary', (count, expected) => {
        expect(cartEngine.getLocationScore(count)).toBe(expected);
    });

    test.each([
        [0, 5], [1, 25], [2, 50], [3, 75], [4, 75], [5, 95], [20, 95]
    ])('30-day frequency count %i maps to %i points at every boundary', (count, expected) => {
        expect(cartEngine.getFrequencyScore(count)).toBe(expected);
    });

    test.each([
        [33.99, 'Level 1'], [34, 'Level 2'], [66.99, 'Level 2'], [67, 'Level 3']
    ])('danger threshold edge %p is classified as %s', (score, expected) => {
        expect(cartEngine.getDangerLevel(score)).toBe(expected);
    });

    test('medium-severity total matches an independently calculated weighted score', () => {
        const result = cartEngine.analyze({
            incident_type: 'Robbery', // 90
            time_of_day: 'Evening',   // 70
            is_weekend: false,         // 40
            severity: 'Medium',
            form_type: 'crime'
        }, { street_count: 3 }, { recent_count: 2 }); // 70 and 50

        // Medium gives type 20%. The remaining 80% follows the original
        // 25:15:20:10 ratio, independently yielding the weights below.
        const expected = 90 * 0.20
            + 70 * (0.80 * 25 / 70)
            + 40 * (0.80 * 15 / 70)
            + 70 * (0.80 * 20 / 70)
            + 50 * (0.80 * 10 / 70);
        expect(result.totalScore).toBe(Math.round(expected * 100) / 100);
    });

    test('high-severity example exposes the exact five-factor contributions', () => {
        const result = cartEngine.analyze({
            incident_type: 'Physical Injury', time_of_day: 'Night',
            is_weekend: false, severity: 'High', form_type: 'crime'
        }, { street_count: 5 }, { recent_count: 5 });

        expect(result.contributions).toEqual({
            type: 25.5, time: 22.5, day: 6, location: 18, frequency: 9.5
        });
        expect(result.rawTotal).toBe(81.5);
        expect(result.totalScore).toBe(81.5);
        expect(result.sourceMultiplier).toBe(1);
    });

    test('blotter source multiplier discounts the same raw case by exactly 15%', () => {
        const common = {
            incident_type: 'Theft', time_of_day: 'Night', is_weekend: true, severity: 'High'
        };
        const incident = cartEngine.analyze({ ...common, form_type: 'crime' }, { street_count: 3 }, { recent_count: 3 });
        const blotter = cartEngine.analyze({ ...common, form_type: 'blotter' }, { street_count: 3 }, { recent_count: 3 });
        expect(blotter.totalScore).toBe(Math.round(incident.totalScore * 0.85 * 100) / 100);
    });

    test('configured thresholds take effect exactly and can be restored', () => {
        cartEngine.updateThresholds({ level2: 50, level3: 80 });
        expect(cartEngine.getDangerLevel(49.99)).toBe('Level 1');
        expect(cartEngine.getDangerLevel(50)).toBe('Level 2');
        expect(cartEngine.getDangerLevel(80)).toBe('Level 3');
    });
    test('mathematical half-cent rounding is stable after the blotter multiplier', () => {
        const result=cartEngine.analyze({ incident_type:'Others',time_of_day:'Evening',is_weekend:true,severity:'High',form_type:'blotter' },
            { street_count:5 },{ recent_count:1 });
        // (30*.30 + 70*.25 + 70*.15 + 90*.20 + 25*.10) * .85
        // = 57.5 * .85 = 48.875 -> 48.88.
        expect(result.totalScore).toBe(48.88);
    });

    test('analysis is deterministic and always stays within the 0-100 score scale', () => {
        const input = { incident_type: 'Homicide', time_of_day: 'Night', is_weekend: true, severity: 'High', form_type: 'crime' };
        const first = cartEngine.analyze(input, { street_count: 99 }, { recent_count: 99 });
        const second = cartEngine.analyze(input, { street_count: 99 }, { recent_count: 99 });
        expect(second).toEqual(first);
        expect(first.totalScore).toBeGreaterThanOrEqual(0);
        expect(first.totalScore).toBeLessThanOrEqual(100);
    });

    test('decision path exposes all five factors and the final classification for auditability', () => {
        const result = cartEngine.analyze(
            { incident_type: 'Theft', time_of_day: 'Night', is_weekend: true, severity: 'High', form_type: 'crime', street_name: 'Balite Street' },
            { street_count: 5 },
            { recent_count: 3 }
        );
        expect(result.decisionPath).toHaveLength(8);
        expect(result.decisionPath.join('\n')).toEqual(expect.stringContaining('Incident Type'));
        expect(result.decisionPath.join('\n')).toEqual(expect.stringContaining('Recent Frequency'));
        expect(result.decisionPath.join('\n')).toEqual(expect.stringContaining('Final Classification'));
    });
});
