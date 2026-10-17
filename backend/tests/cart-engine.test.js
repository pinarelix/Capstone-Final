// Pure unit tests for the CART risk-scoring engine — no DB, no HTTP,
// just the exported singleton's analyze() method. The engine uses
// severity-adaptive weights: the base type weight (30%) shifts up for
// Critical-severity crimes (40%) and down for Low-severity ones (20%),
// with the remaining factors redistributed proportionally.
const cartEngine = require('../cart-engine');

describe('CART engine scoring', () => {
    test('a severe, frequent, well-known-hotspot incident scores into Level 3', () => {
        const incident = {
            incident_type: 'Homicide',   // type score 95 → Critical tier (40% weight)
            time_of_day: 'Night',        // time score 90
            is_weekend: true             // day score 70
        };
        const locationData = { street_count: 6 };   // >=5 -> location 'critical' = 90
        const frequencyData = { recent_count: 6 };  // >=5 -> frequency 'very_high' = 95

        const result = cartEngine.analyze(incident, locationData, frequencyData);

        // Critical tier: type=40%, remaining 60% split proportionally
        // 95*.40 + 90*(0.60*25/70) + 70*(0.60*15/70) + 90*(0.60*20/70) + 95*(0.60*10/70) ≈ 89.86
        expect(result.totalScore).toBeCloseTo(89.86, 1);
        expect(result.dangerLevel).toBe('Level 3');
        expect(result.dangerDescription).toContain('High Crime');
        expect(result.effectiveWeights.tier).toBe('Critical');
    });

    test('a minor, rare, no-history incident scores into Level 1', () => {
        const incident = {
            incident_type: 'Missing',    // type score 35 → Low tier (20% weight)
            time_of_day: 'Morning',      // time score 20
            is_weekend: false            // day score 40
        };

        // no prior incidents at this location / in the last 30 days
        const result = cartEngine.analyze(incident, null, null);

        // Low tier: type=20%, remaining 80% split proportionally
        // 35*.20 + 20*(0.80*25/70) + 40*(0.80*15/70) + 10*(0.80*20/70) + 5*(0.80*10/70) ≈ 22.43
        expect(result.totalScore).toBeCloseTo(22.43, 1);
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

    test('severity-adaptive weights shift type weight based on crime severity', () => {
        const critical = cartEngine.getSeverityTier(95);
        const high     = cartEngine.getSeverityTier(70);
        const moderate = cartEngine.getSeverityTier(50);
        const low      = cartEngine.getSeverityTier(35);

        expect(critical.typeWeight).toBe(0.40);
        expect(high.typeWeight).toBe(0.35);
        expect(moderate.typeWeight).toBe(0.30);
        expect(low.typeWeight).toBe(0.20);
    });

    test('adaptive weights always sum to 1.0', () => {
        for (const score of [95, 70, 50, 35]) {
            const ew = cartEngine.getAdaptiveWeights(score);
            const sum = ew.type + ew.time + ew.day + ew.location + ew.frequency;
            expect(sum).toBeCloseTo(1.0, 10);
        }
    });

    test('effectiveWeights are included in the analysis result', () => {
        const incident = { incident_type: 'Robbery', time_of_day: 'Night', is_weekend: false };
        const result = cartEngine.analyze(incident, { street_count: 3 }, { recent_count: 2 });

        expect(result.effectiveWeights).toBeDefined();
        expect(result.effectiveWeights.tier).toBe('Critical');
        expect(result.effectiveWeights.type).toBe(0.40);
    });
});
