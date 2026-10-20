// Pure unit tests for the CART risk-scoring engine — no DB, no HTTP,
// just the exported singleton's analyze() method. The engine uses
// severity-based weights selected from the incident's severity field:
// the base type weight (30%) drops to 20% for Medium-severity crimes
// and 10% for Low-severity ones, with the remaining factors
// redistributed proportionally.
const cartEngine = require('../cart-engine');

describe('CART engine scoring', () => {
    test('a severe, frequent, well-known-hotspot High-severity incident scores into Level 3', () => {
        const incident = {
            incident_type: 'Homicide',   // type score 95
            time_of_day: 'Night',        // time score 90
            is_weekend: true,            // day score 70
            severity: 'High'             // type weight 30%
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
            severity: 'Low'              // type weight 10%
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
});
