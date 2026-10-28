const { orderRouteStops, roadGeometry, routeFallback, clusterRecords, isConnectedWithinRadius, exceedsSuggestedStopLimit,
    adjustedPatrolRisk, shouldArchivePatrolRisk } = require('../patrolRoutes');

describe('patrol route geometry', () => {
    test('orders every record once as a nearest-neighbor chain starting at the highest risk stop', () => {
        const records = [
            { id: 1, latitude: 14.7500, longitude: 121.0500, cart_score: 100 },
            { id: 2, latitude: 14.7501, longitude: 121.0501, cart_score: 30 },
            { id: 3, latitude: 14.7600, longitude: 121.0600, cart_score: 80 },
            { id: 4, latitude: 14.7601, longitude: 121.0601, cart_score: 40 }
        ];
        expect(orderRouteStops(records).map(row => row.id)).toEqual([1, 2, 3, 4]);
    });

    test('creates one closed LineString so every stop has one incoming and one outgoing connection', () => {
        const geometry = routeFallback([
            { latitude: 14.75, longitude: 121.05 },
            { latitude: 14.76, longitude: 121.06 },
            { latitude: 14.77, longitude: 121.07 }
        ]);
        expect(geometry.type).toBe('LineString');
        expect(geometry.coordinates).toHaveLength(4);
        expect(geometry.coordinates[0]).toEqual(geometry.coordinates.at(-1));
    });

    test('builds saved geometry directly from ordered stops without calling a road router', async () => {
        const originalFetch = global.fetch; global.fetch = jest.fn();
        const stops = [{ latitude: 14.75, longitude: 121.05 }, { latitude: 14.76, longitude: 121.06 }, { latitude: 14.77, longitude: 121.07 }];
        await expect(roadGeometry(stops)).resolves.toEqual(routeFallback(stops));
        expect(global.fetch).not.toHaveBeenCalled(); global.fetch = originalFetch;
    });

    test('splits connected 90-meter suggestions into routes of at most 10 stops', () => {
        const records = Array.from({ length: 15 }, (_, index) => ({
            id: index + 1, eligible: true, cart_score: 100 - index,
            latitude: 14.75, longitude: 121.05 + (index * 0.0002)
        }));
        const clusters = clusterRecords(records, 90);
        expect(clusters).toHaveLength(2);
        expect(clusters.map(cluster => cluster.length)).toEqual([10, 5]);
        expect(clusters.every(cluster => isConnectedWithinRadius(cluster, 90))).toBe(true);
    });

    test('allows saved suggested routes to exceed 10 stops when manually updated', () => {
        expect(exceedsSuggestedStopLimit('Suggested', 11)).toBe(true);
        expect(exceedsSuggestedStopLimit('Suggested', 11, 42)).toBe(false);
        expect(exceedsSuggestedStopLimit('Manual', 25, 42)).toBe(false);
    });

    test('compounds a 15% reduction per completed patrol without changing the base score', () => {
        expect(adjustedPatrolRisk(100, 0)).toBe(100);
        expect(adjustedPatrolRisk(100, 1)).toBe(85);
        expect(adjustedPatrolRisk(100, 3)).toBe(61.41);
        expect(adjustedPatrolRisk(null, 3)).toBeNull();
        expect(shouldArchivePatrolRisk(50, 2, 34)).toBe(false);
        expect(shouldArchivePatrolRisk(50, 3, 34)).toBe(true);
        expect(shouldArchivePatrolRisk(60, 3, 34)).toBe(false);
    });
});
