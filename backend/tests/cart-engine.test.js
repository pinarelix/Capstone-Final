// Pure unit tests for the CART risk-scoring engine — no DB, no HTTP,
// just the exported singleton's analyze() method. Doubles as a runnable,
// checkable record of exactly how a score is calculated (weights:
// type 30%, time 25%, day 15%, location 20%, frequency 10% — see
// cart-engine.js's own constructor comments for the "expert-defined"
// weight values these numbers assume).
const cartEngine = require('../cart-engine');

describe('CART engine scoring', () => {
    test('a severe, frequent, well-known-hotspot incident scores into Level 3', () => {
        const incident = {
            incident_type: 'Homicide',   // type score 95
            time_of_day: 'Night',        // time score 90
            is_weekend: true             // day score 70
        };
        const locationData = { street_count: 6 };   // >=5 -> location 'critical' = 90
        const frequencyData = { recent_count: 6 };  // >=5 -> frequency 'very_high' = 95

        const result = cartEngine.analyze(incident, locationData, frequencyData);

        // 90*.25 + 70*.15 + 95*.30 + 90*.20 + 95*.10 = 89.0
        expect(result.totalScore).toBeCloseTo(89.0, 1);
        expect(result.dangerLevel).toBe('Level 3');
        expect(result.dangerDescription).toContain('High Crime');
    });

    test('a minor, rare, no-history incident scores into Level 1', () => {
        const incident = {
            incident_type: 'Missing',    // type score 35
            time_of_day: 'Morning',      // time score 20
            is_weekend: false            // day score 40
        };

        // no prior incidents at this location / in the last 30 days
        const result = cartEngine.analyze(incident, null, null);

        // 20*.25 + 40*.15 + 35*.30 + 10*.20 + 5*.10 = 24.0
        expect(result.totalScore).toBeCloseTo(24.0, 1);
        expect(result.dangerLevel).toBe('Level 1');
        expect(result.dangerDescription).toContain('Low Danger');
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

    test('every factor score is included in the breakdown, matching the documented weights', () => {
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
});
