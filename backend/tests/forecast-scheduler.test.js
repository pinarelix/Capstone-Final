const { manilaParts } = require('../forecast-scheduler');
test('scheduler formatter exposes Manila timezone parts', () => {
  const parts = manilaParts(new Date('2026-01-05T00:00:00Z'));
  expect(parts.weekday).toBe('Mon');
  expect(parts.hour).toBe('08');
});
