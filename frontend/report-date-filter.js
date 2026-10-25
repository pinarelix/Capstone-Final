(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReportDateFilter = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
    const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

    function monthBounds(monthKey) {
        const match = MONTH_PATTERN.exec(String(monthKey || ''));
        if (!match) return null;

        const year = Number(match[1]);
        const month = Number(match[2]);
        if (month < 1 || month > 12) return null;

        const lastDayNumber = new Date(year, month, 0).getDate();
        return {
            firstDay: `${match[1]}-${match[2]}-01`,
            lastDay: `${match[1]}-${match[2]}-${String(lastDayNumber).padStart(2, '0')}`
        };
    }

    function dateWithinBounds(value, bounds) {
        return DATE_PATTERN.test(String(value || '')) &&
            value >= bounds.firstDay && value <= bounds.lastDay;
    }

    function normalizeRange(monthKey, dateFrom = '', dateTo = '', changedField = '') {
        const bounds = monthBounds(monthKey);
        if (!bounds) return { firstDay: '', lastDay: '', dateFrom: '', dateTo: '' };

        let normalizedFrom = dateWithinBounds(dateFrom, bounds) ? dateFrom : '';
        let normalizedTo = dateWithinBounds(dateTo, bounds) ? dateTo : '';

        // A single selected date means an exact-day filter. The user can
        // subsequently change the other endpoint to expand it into a range.
        if (normalizedFrom && !normalizedTo) normalizedTo = normalizedFrom;
        if (normalizedTo && !normalizedFrom) normalizedFrom = normalizedTo;

        // Keep the range valid while the user edits either endpoint.
        if (normalizedFrom > normalizedTo) {
            if (changedField === 'to') normalizedFrom = normalizedTo;
            else normalizedTo = normalizedFrom;
        }

        return { ...bounds, dateFrom: normalizedFrom, dateTo: normalizedTo };
    }

    function effectiveRange(monthKey, dateFrom = '', dateTo = '') {
        const range = normalizeRange(monthKey, dateFrom, dateTo);
        return {
            dateFrom: range.dateFrom || range.firstDay,
            dateTo: range.dateTo || range.lastDay
        };
    }

    return { monthBounds, normalizeRange, effectiveRange };
});
