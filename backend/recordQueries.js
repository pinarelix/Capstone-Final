// Bounds raw record transfers. Aggregate queries remain complete for their
// declared filters; pagination must never turn a partial page into a total.
function pagination(query, defaultLimit = 25, maximum = 100) {
    const integer = (value, fallback) => /^\d+$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) ? Number(value) : fallback;
    const page = Math.min(100000, Math.max(1, integer(query.page, 1)));
    const limit = Math.min(maximum, Math.max(1, integer(query.limit, defaultLimit)));
    return { page, limit, offset: (page - 1) * limit };
}

const SEARCH_TERM_PATTERN = /^[\p{L}\p{N}\s.,'#()\/-]*$/u;
function validatedSearch(value, maximumLength = 100) {
    const term = String(value ?? '').trim();
    if (term.length > maximumLength || !SEARCH_TERM_PATTERN.test(term)) {
        const error = new Error(`Search may contain only letters, numbers, spaces, and common name/address punctuation (maximum ${maximumLength} characters).`);
        error.statusCode = 400;
        throw error;
    }
    return term;
}
function appendDateFilters(query, filters, params, alias = 'i') {
    for (const [key, operator] of [['date_from','>='],['date_to','<=']]) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(query[key] || ''))) { filters.push(`${alias}.date ${operator} ?`); params.push(query[key]); }
    }
    if (!query.date_from && !query.date_to && /^\d+$/.test(String(query.window_days || ''))) {
        filters.push(`${alias}.date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`); params.push(Math.min(3650, Math.max(1, Number(query.window_days))));
    }
    if (query.location) { filters.push(`${alias}.street_name = ?`); params.push(query.location); }
}
function summaryFilters(query) {
    const filters = [
        'i.is_draft = 0',
        `NOT EXISTS (
            SELECT 1 FROM archived_records a
            WHERE a.entity_type = 'incident' AND a.entity_id = i.id AND a.restored_at IS NULL
        )`
    ], params = [];
    const search = validatedSearch(query.search);
    if (query.status) { filters.push('TRIM(i.status) = ?'); params.push(query.status); }
    else if (query.include_resolved !== '1') filters.push("TRIM(i.status) IN ('Open', 'Monitoring')");
    if (query.type) { filters.push('i.incident_type = ?'); params.push(query.type); }
    if (query.form_type && ['crime','blotter'].includes(query.form_type)) { filters.push('i.source = ?'); params.push(query.form_type === 'crime' ? 'incident' : 'blotter'); }
    if (search) {
        filters.push('(CAST(i.id AS CHAR) LIKE ? OR i.incident_type LIKE ? OR i.street_name LIKE ? OR i.description LIKE ?)');
        const term = `%${search}%`;
        params.push(term, term, term, term);
    }
    appendDateFilters(query, filters, params);
    return { where: filters.join(' AND '), params };
}
function registerRecordSummaries(app, {pool, authenticate, readRoles}) {
    app.get('/api/incidents/metadata', authenticate, readRoles, async (_req,res) => {
        try {
            const [months] = await pool.query("SELECT DATE_FORMAT(date,'%Y-%m') AS month, COUNT(*) AS count FROM incidents WHERE is_draft=0 GROUP BY month ORDER BY month DESC LIMIT 120");
            const [patrolLocations] = await pool.query('SELECT DISTINCT location FROM patrol_schedules ORDER BY location LIMIT 100');
            res.json({months,patrolLocations});
        } catch { res.status(500).json({error:'Could not load record periods'}); }
    });
    app.get('/api/incidents/summary', authenticate, readRoles, async (req,res) => {
        try {
            const {where,params} = summaryFilters(req.query);
            const [counts] = await pool.query(`SELECT COUNT(*) AS total,
                COALESCE(SUM(TRIM(i.status)='Open'),0) AS open, COALESCE(SUM(TRIM(i.status)='Monitoring'),0) AS monitoring,
                COALESCE(SUM(TRIM(i.status)='Resolved'),0) AS resolved,
                COALESCE(SUM(i.danger_level LIKE '%Level 3%' OR i.danger_level LIKE '%High%'),0) AS high,
                COALESCE(SUM(i.danger_level LIKE '%Level 2%' OR i.danger_level LIKE '%Moderate%'),0) AS moderate
                FROM incidents i WHERE ${where}`, params);
            const [locations] = await pool.query(`SELECT i.street_name AS location, COUNT(*) AS count,
                MAX(CASE WHEN i.danger_level LIKE '%Level 3%' OR i.danger_level LIKE '%High%' THEN 3
                WHEN i.danger_level LIKE '%Level 2%' OR i.danger_level LIKE '%Moderate%' THEN 2 ELSE 1 END) AS danger_rank
                FROM incidents i WHERE ${where} GROUP BY i.street_name ORDER BY count DESC, location LIMIT 100`,params);
            const [hours] = await pool.query(`SELECT HOUR(i.time) AS hour, COUNT(*) AS count FROM incidents i WHERE ${where} GROUP BY hour ORDER BY count DESC, hour LIMIT 24`,params);
            res.json({...counts[0],locations,hours});
        } catch (error) {
            if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
            res.status(500).json({error:'Could not summarize records'});
        }
    });
}
module.exports = {pagination, validatedSearch, appendDateFilters, registerRecordSummaries};
