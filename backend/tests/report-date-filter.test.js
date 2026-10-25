const {
    monthBounds,
    normalizeRange,
    effectiveRange
} = require('../../frontend/report-date-filter');

describe('report date filter', () => {
    test('calculates selected-month boundaries, including leap years', () => {
        expect(monthBounds('2024-02')).toEqual({
            firstDay: '2024-02-01',
            lastDay: '2024-02-29'
        });
    });

    test('treats a Date From selection by itself as an exact date', () => {
        expect(normalizeRange('2026-10', '2026-10-15', '', 'from')).toMatchObject({
            dateFrom: '2026-10-15',
            dateTo: '2026-10-15'
        });
    });

    test('treats a Date To selection by itself as an exact date', () => {
        expect(normalizeRange('2026-10', '', '2026-10-15', 'to')).toMatchObject({
            dateFrom: '2026-10-15',
            dateTo: '2026-10-15'
        });
    });

    test('preserves a valid inclusive date range', () => {
        expect(normalizeRange('2026-10', '2026-10-10', '2026-10-20')).toMatchObject({
            dateFrom: '2026-10-10',
            dateTo: '2026-10-20'
        });
    });

    test('keeps the edited endpoint when a range would become invalid', () => {
        expect(normalizeRange('2026-10', '2026-10-21', '2026-10-20', 'from')).toMatchObject({
            dateFrom: '2026-10-21',
            dateTo: '2026-10-21'
        });
        expect(normalizeRange('2026-10', '2026-10-21', '2026-10-20', 'to')).toMatchObject({
            dateFrom: '2026-10-20',
            dateTo: '2026-10-20'
        });
    });

    test('allows a date range to span months and years', () => {
        expect(normalizeRange('2026-10', '2026-09-30', '2026-11-01')).toMatchObject({
            dateFrom: '2026-09-30',
            dateTo: '2026-11-01'
        });
    });

    test('an explicit cross-month range overrides the selected month', () => {
        expect(effectiveRange('2026-10', '2025-12-15', '2026-01-10')).toEqual({
            dateFrom: '2025-12-15',
            dateTo: '2026-01-10'
        });
    });

    test('uses the complete selected month when both inputs are empty', () => {
        expect(effectiveRange('2026-10')).toEqual({
            dateFrom: '2026-10-01',
            dateTo: '2026-10-31'
        });
    });
});
