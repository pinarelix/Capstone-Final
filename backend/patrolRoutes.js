const { distanceMeters, validCoordinates } = require('./patrolPolicy');

const READ_ROLES = ['Executive Officer', 'Kagawad', 'Team Leader'];
const WRITE_ROLES = ['Executive Officer'];
const SHIFTS = new Set(['AM', 'PM']);
const ROUTE_STATUSES = new Set(['Suggested', 'Draft', 'Active', 'Completed', 'Cancelled']);
const LOG_STATUSES = new Set(['Completed', 'Partial', 'Failed']);
const MIN_ROUTE_STOPS = 3;
const SUGGESTED_MAX_ROUTE_STOPS = 10;
const SUGGESTION_RADIUS_METERS = 90;
const PATROL_RISK_RETAINED_FACTOR = 0.85;
const MIN_ARCHIVE_COMPLETIONS = 3;

function exceedsSuggestedStopLimit(sourceType, stopCount, routeId = null) {
    return !routeId && sourceType === 'Suggested' && stopCount > SUGGESTED_MAX_ROUTE_STOPS;
}

function adjustedPatrolRisk(baseScore, completedPatrolCount) {
    if (baseScore === null || baseScore === undefined || baseScore === '') return null;
    const base = Number(baseScore); const count = Math.max(0, Number(completedPatrolCount) || 0);
    if (!Number.isFinite(base)) return null;
    return Math.round(base * (PATROL_RISK_RETAINED_FACTOR ** count) * 100) / 100;
}

function shouldArchivePatrolRisk(baseScore, completedPatrolCount, lowThreshold) {
    const adjusted = adjustedPatrolRisk(baseScore, completedPatrolCount);
    return Number(completedPatrolCount) >= MIN_ARCHIVE_COMPLETIONS && adjusted !== null && adjusted < Number(lowThreshold);
}

function dateOnly(value) {
    const text = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}

function routeFallback(stops) {
    const coordinates = stops.map(stop => [Number(stop.longitude), Number(stop.latitude)]);
    if (coordinates.length === 1) coordinates.push([...coordinates[0]]);
    if (coordinates.length > 1) coordinates.push([...coordinates[0]]);
    return { type: 'LineString', coordinates };
}

async function roadGeometry(stops) {
    return routeFallback(stops);
}

function orderRouteStops(records) {
    if (!records.length) return [];
    const remaining = records.slice().sort((a, b) => Number(b.cart_score || 0) - Number(a.cart_score || 0) || Number(a.id) - Number(b.id));
    const ordered = [remaining.shift()];
    while (remaining.length) {
        const current = ordered[ordered.length - 1];
        remaining.sort((a, b) => distanceMeters(current, a) - distanceMeters(current, b)
            || Number(b.cart_score || 0) - Number(a.cart_score || 0)
            || Number(a.id) - Number(b.id));
        ordered.push(remaining.shift());
    }
    return ordered;
}

function isConnectedWithinRadius(stops, radius = SUGGESTION_RADIUS_METERS) {
    if (!stops.length) return false;
    const visited = new Set([0]); const queue = [0];
    while (queue.length) {
        const currentIndex = queue.shift();
        for (let index = 0; index < stops.length; index += 1) {
            if (!visited.has(index) && distanceMeters(stops[currentIndex], stops[index]) <= radius) {
                visited.add(index); queue.push(index);
            }
        }
    }
    return visited.size === stops.length;
}

function normalizeStops(stops) {
    return (Array.isArray(stops) ? stops : []).map((stop, index) => ({
        incident_id: Number(stop.incident_id),
        stop_order: Number(stop.stop_order || index + 1),
        location: String(stop.location || '').trim().slice(0, 100),
        address: String(stop.address || '').trim().slice(0, 255),
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
        dwell_minutes: Math.max(0, Math.min(480, Number(stop.dwell_minutes || 0)))
    })).filter(stop => Number.isInteger(stop.incident_id) && stop.incident_id > 0 && stop.location && validCoordinates(stop));
}

function clusterRecords(records, radius = SUGGESTION_RADIUS_METERS) {
    const eligible = records.filter(record => record.eligible && validCoordinates(record))
        .sort((a, b) => Number(b.cart_score || 0) - Number(a.cart_score || 0) || Number(a.id) - Number(b.id));
    const remaining = new Set(eligible.map(record => Number(record.id)));
    const byId = new Map(eligible.map(record => [Number(record.id), record]));
    const clusters = [];
    while (remaining.size) {
        const seedId = [...remaining][0];
        const cluster = []; const queue = [byId.get(seedId)];
        remaining.delete(seedId);
        while (queue.length && cluster.length < SUGGESTED_MAX_ROUTE_STOPS) {
            const current = queue.shift(); cluster.push(current);
            for (const candidateId of [...remaining]) {
                if (cluster.length + queue.length >= SUGGESTED_MAX_ROUTE_STOPS) break;
                const candidate = byId.get(candidateId);
                if (distanceMeters(current, candidate) <= radius) {
                    remaining.delete(candidateId); queue.push(candidate);
                }
            }
        }
        if (cluster.length >= MIN_ROUTE_STOPS) clusters.push(orderRouteStops(cluster));
    }
    return clusters;
}

function requireId(value, label) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} is required.`);
    return id;
}

function normalizeDeployment(input = {}) {
    const scheduled_date = dateOnly(input.scheduled_date);
    if (!scheduled_date) throw new Error('A valid patrol date is required.');
    const shift = String(input.shift || '').toUpperCase();
    if (!SHIFTS.has(shift)) throw new Error('Choose an AM or PM patrol block.');
    const status = input.status || 'Draft';
    if (!ROUTE_STATUSES.has(status)) throw new Error('Invalid patrol route status.');
    return { scheduled_date, shift, status, team_id: input.team_id ? requireId(input.team_id, 'Team') : null, notes: String(input.notes || '').trim().slice(0, 1000) };
}

function registerPatrolRouteRoutes({ app, pool, authenticate, requireRole, mapRecords, getThresholds = () => ({ level2: 34, level3: 67 }) }) {
    const readRole = requireRole(READ_ROLES);
    const writeRole = requireRole(WRITE_ROLES);

    async function teamName(teamId) {
        if (!teamId) return '';
        const [rows] = await pool.query('SELECT name FROM patrol_teams WHERE id=? AND is_active=1', [teamId]);
        if (!rows.length) throw new Error('Choose an active saved patrol team.');
        return rows[0].name;
    }

    async function routeDetails(id, date = null) {
        const [routeRows] = await pool.query('SELECT * FROM patrol_routes WHERE id=?', [id]);
        if (!routeRows.length) return null;
        const [stops] = await pool.query(`SELECT s.*, i.incident_type, COALESCE(prs.adjusted_risk_score, rf.total_risk_score) AS cart_score,
                rf.total_risk_score AS base_cart_score, COALESCE(prs.completed_patrol_count, 0) AS completed_patrol_count, i.form_type
            FROM patrol_route_stops s LEFT JOIN incidents i ON i.id=s.incident_id
            LEFT JOIN cart_risk_factors rf ON rf.incident_id=i.id
            LEFT JOIN incident_patrol_risk_state prs ON prs.incident_id=i.id
            WHERE s.route_id=? ORDER BY s.stop_order`, [id]);
        const params = [id];
        const dateFilter = date ? ' AND d.scheduled_date=?' : '';
        if (date) params.push(date);
        const [deployments] = await pool.query(`SELECT d.*, COALESCE(NULLIF(d.team_name,''), t.name, 'Unassigned') AS display_team_name,
                l.id AS log_id, l.patrol_date AS log_date, l.status AS log_status, l.report AS log_report
            FROM patrol_route_deployments d LEFT JOIN patrol_teams t ON t.id=d.team_id
            LEFT JOIN patrol_route_logs l ON l.id=(SELECT latest.id FROM patrol_route_logs latest WHERE latest.deployment_id=d.id ORDER BY latest.patrol_date DESC, latest.id DESC LIMIT 1)
            WHERE d.route_id=?${dateFilter} ORDER BY d.scheduled_date, d.shift, d.id`, params);
        return { ...routeRows[0], geometry: routeRows[0].geometry_json ? JSON.parse(routeRows[0].geometry_json) : null, route_stops: stops, deployments };
    }

    async function routeList(date) {
        const [rows] = await pool.query(`SELECT id, status FROM patrol_routes
            WHERE status='Active' OR (status <> 'Cancelled' AND (suggested_for_date=? OR EXISTS
                (SELECT 1 FROM patrol_route_deployments d WHERE d.route_id=patrol_routes.id AND d.scheduled_date=?))
            )
            ORDER BY FIELD(status,'Active','Draft','Suggested','Completed'), id DESC`, [date, date]);
        return Promise.all(rows.map(row => routeDetails(row.id, row.status === 'Active' ? null : date)));
    }

    async function activeRouteMemberships() {
        const [rows] = await pool.query(`SELECT DISTINCT s.incident_id, r.id AS route_id, d.scheduled_date
            FROM patrol_route_stops s JOIN patrol_routes r ON r.id=s.route_id
            JOIN patrol_route_deployments d ON d.route_id=r.id
            WHERE r.status='Active' AND d.status='Active'
            ORDER BY s.incident_id, ABS(DATEDIFF(d.scheduled_date, CURDATE())), d.scheduled_date DESC, r.id DESC`);
        const memberships = new Map();
        for (const row of rows) {
            const incidentId = Number(row.incident_id); const routeId = Number(row.route_id);
            if (!memberships.has(incidentId)) memberships.set(incidentId, { routeIds: new Set(), closestRouteId: routeId });
            memberships.get(incidentId).routeIds.add(routeId);
        }
        return new Map([...memberships].map(([incidentId, value]) => [incidentId, { activeRouteCount: value.routeIds.size, closestActiveRouteId: value.closestRouteId }]));
    }

    async function refreshPatrolRiskForDeployment(db, deploymentId, updatedBy = null) {
        const [deploymentRows] = await db.query('SELECT route_id FROM patrol_route_deployments WHERE id=?', [deploymentId]);
        if (!deploymentRows.length) return;
        const [stops] = await db.query('SELECT DISTINCT incident_id FROM patrol_route_stops WHERE route_id=?', [deploymentRows[0].route_id]);
        const lowThreshold = Number(getThresholds().level2) || 34;
        for (const stop of stops) {
            const incidentId = Number(stop.incident_id);
            const [[summary]] = await db.query(`SELECT COUNT(DISTINCT d.id) AS completed_count
                FROM patrol_route_stops s JOIN patrol_route_deployments d ON d.route_id=s.route_id
                JOIN patrol_route_logs l ON l.deployment_id=d.id AND l.status='Completed'
                WHERE s.incident_id=?`, [incidentId]);
            const [[risk]] = await db.query('SELECT total_risk_score FROM cart_risk_factors WHERE incident_id=?', [incidentId]);
            const [[current]] = await db.query('SELECT is_monitoring_archived, reactivated_completed_count FROM incident_patrol_risk_state WHERE incident_id=?', [incidentId]);
            const completedCount = Number(summary?.completed_count) || 0;
            const baseScore = risk?.total_risk_score == null ? null : Number(risk.total_risk_score);
            const adjustedScore = adjustedPatrolRisk(baseScore, completedCount);
            const baseArchiveEligible = shouldArchivePatrolRisk(baseScore, completedCount, lowThreshold);
            const reactivatedAtCount = Number(current?.reactivated_completed_count) || 0;
            const remainsArchived = Boolean(current?.is_monitoring_archived) && baseArchiveEligible;
            const newlyArchived = baseArchiveEligible && completedCount > reactivatedAtCount;
            const archived = remainsArchived || newlyArchived;
            await db.query(`INSERT INTO incident_patrol_risk_state
                (incident_id, completed_patrol_count, risk_multiplier, base_cart_score, adjusted_risk_score, is_monitoring_archived, archived_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE completed_patrol_count=VALUES(completed_patrol_count), risk_multiplier=VALUES(risk_multiplier),
                    base_cart_score=VALUES(base_cart_score), adjusted_risk_score=VALUES(adjusted_risk_score),
                    is_monitoring_archived=VALUES(is_monitoring_archived),
                    archived_at=CASE WHEN VALUES(is_monitoring_archived)=1 THEN COALESCE(archived_at, VALUES(archived_at)) ELSE NULL END,
                    updated_at=CURRENT_TIMESTAMP`, [incidentId, completedCount, PATROL_RISK_RETAINED_FACTOR ** completedCount, baseScore, adjustedScore, archived ? 1 : 0, archived ? new Date() : null]);
        }
    }

    app.get('/api/patrol-route-planner', authenticate, readRole, async (req, res) => {
        try {
            const selectedDate = dateOnly(req.query.date) || new Date().toISOString().slice(0, 10);
            const records = await mapRecords({ window_days: 'all' });
            const memberships = await activeRouteMemberships();
            const enriched = records.map(record => {
                const membership = memberships.get(Number(record.id)) || { activeRouteCount: 0, closestActiveRouteId: null };
                return { ...record, active_route_count: membership.activeRouteCount, closest_active_route_id: membership.closestActiveRouteId,
                    patrol_schedule_count: Math.max(0, membership.activeRouteCount - 1) };
            });
            const savedRoutes = await routeList(selectedDate);
            const assignedIncidentIds = new Set(savedRoutes.filter(route => !['Completed', 'Cancelled'].includes(route.status)).flatMap(route => route.route_stops.map(stop => Number(stop.incident_id))));
            const suggestedRoutes = clusterRecords(enriched.filter(record => !assignedIncidentIds.has(Number(record.id))))
                .map((cluster, index) => ({
                    id: null,
                    route_name: `Suggested route ${index + 1} · ${cluster[0]?.street_name || 'Hotspot cluster'}`,
                    source_type: 'Suggested', status: 'Suggested', suggested_for_date: selectedDate,
                    route_stops: cluster.map((record, stopIndex) => ({
                        incident_id: Number(record.id), stop_order: stopIndex + 1, location: record.street_name || 'Unknown location',
                        address: record.address || '', latitude: Number(record.latitude), longitude: Number(record.longitude),
                        incident_type: record.incident_type, cart_score: Number(record.cart_score || 0), form_type: record.form_type
                    })), geometry: null, deployments: []
                }));
            res.json({ date: selectedDate, radius_meters: SUGGESTION_RADIUS_METERS, thresholds: getThresholds(), records: enriched, routes: [...savedRoutes, ...suggestedRoutes] });
        } catch (error) { res.status(500).json({ error: error.message || 'Failed to load patrol route planner' }); }
    });

    app.get('/api/patrol-routes/:id', authenticate, readRole, async (req, res) => {
        try { const route = await routeDetails(requireId(req.params.id, 'Route')); if (!route) return res.status(404).json({ error: 'Patrol route not found.' }); res.json(route); }
        catch (error) { res.status(400).json({ error: error.message }); }
    });

    async function saveRoute(req, res, id = null) {
        let conn;
        try {
            const body = req.body || {};
            const stops = normalizeStops(body.route_stops);
            const sourceType = body.source_type === 'Suggested' ? 'Suggested' : 'Manual';
            if (stops.length < MIN_ROUTE_STOPS || exceedsSuggestedStopLimit(sourceType, stops.length, id)) return res.status(400).json({ error: `Routes require at least ${MIN_ROUTE_STOPS} incident records. New suggested routes may contain at most ${SUGGESTED_MAX_ROUTE_STOPS} stops; saved routes may be expanded manually.` });
            if (new Set(stops.map(stop => stop.incident_id)).size !== stops.length) return res.status(400).json({ error: 'A record can only appear once in a route.' });
            const status = body.status || 'Draft';
            if (!ROUTE_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid route status.' });
            const deployment = body.deployment ? normalizeDeployment(body.deployment) : null;
            const geometry = await roadGeometry(stops);
            conn = await pool.getConnection();
            await conn.beginTransaction();
            let routeId = id;
            if (routeId) {
                const [existing] = await conn.query('SELECT id FROM patrol_routes WHERE id=?', [routeId]);
                if (!existing.length) { await conn.rollback(); return res.status(404).json({ error: 'Patrol route not found.' }); }
                await conn.query(`UPDATE patrol_routes SET route_name=?, source_type=?, status=?, suggested_for_date=?, geometry_json=?, notes=?, updated_by=? WHERE id=?`,
                    [String(body.route_name || 'Patrol route').trim().slice(0, 120), sourceType, status, dateOnly(body.suggested_for_date), JSON.stringify(geometry), String(body.notes || '').trim().slice(0, 1000), req.userId, routeId]);
                await conn.query('DELETE FROM patrol_route_stops WHERE route_id=?', [routeId]);
            } else {
                const [result] = await conn.query(`INSERT INTO patrol_routes (route_name, source_type, status, suggested_for_date, geometry_json, notes, created_by, updated_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [String(body.route_name || 'Patrol route').trim().slice(0, 120), sourceType, status, dateOnly(body.suggested_for_date), JSON.stringify(geometry), String(body.notes || '').trim().slice(0, 1000), req.userId, req.userId]);
                routeId = result.insertId;
            }
            for (const [index, stop] of stops.entries()) await conn.query(`INSERT INTO patrol_route_stops
                (route_id, stop_order, incident_id, location, address, latitude, longitude, dwell_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [routeId, index + 1, stop.incident_id, stop.location, stop.address, stop.latitude, stop.longitude, stop.dwell_minutes]);
            if (deployment) {
                const name = await teamName(deployment.team_id);
                const deploymentId = body.deployment.id ? requireId(body.deployment.id, 'Deployment') : null;
                if (deploymentId) {
                    await conn.query(`UPDATE patrol_route_deployments SET scheduled_date=?, shift=?, team_id=?, team_name=?, status=?, notes=?, updated_by=? WHERE id=? AND route_id=?`,
                        [deployment.scheduled_date, deployment.shift, deployment.team_id, name, deployment.status, deployment.notes, req.userId, deploymentId, routeId]);
                } else {
                    await conn.query(`INSERT INTO patrol_route_deployments (route_id, scheduled_date, shift, team_id, team_name, status, notes, created_by, updated_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [routeId, deployment.scheduled_date, deployment.shift, deployment.team_id, name, deployment.status, deployment.notes, req.userId, req.userId]);
                }
            }
            await conn.commit();
            res.status(id ? 200 : 201).json({ message: 'Patrol route saved.', route: await routeDetails(routeId, deployment?.scheduled_date || null) });
        } catch (error) {
            if (conn) await conn.rollback().catch(() => {});
            res.status(error.statusCode || 400).json({ error: error.message || 'Could not save patrol route.' });
        } finally { if (conn) conn.release(); }
    }

    app.post('/api/patrol-routes', authenticate, writeRole, (req, res) => saveRoute(req, res));
    app.put('/api/patrol-routes/:id', authenticate, writeRole, (req, res) => saveRoute(req, res, requireId(req.params.id, 'Route')));

    app.post('/api/patrol-routes/:id/deployments', authenticate, writeRole, async (req, res) => {
        try {
            const routeId = requireId(req.params.id, 'Route');
            const deployment = normalizeDeployment(req.body);
            const name = await teamName(deployment.team_id);
            const [exists] = await pool.query('SELECT id FROM patrol_routes WHERE id=? AND status<>"Cancelled"', [routeId]);
            if (!exists.length) return res.status(404).json({ error: 'Patrol route not found.' });
            const [result] = await pool.query(`INSERT INTO patrol_route_deployments (route_id, scheduled_date, shift, team_id, team_name, status, notes, created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [routeId, deployment.scheduled_date, deployment.shift, deployment.team_id, name, deployment.status, deployment.notes, req.userId, req.userId]);
            res.status(201).json({ deployment_id: result.insertId, route: await routeDetails(routeId, deployment.scheduled_date) });
        } catch (error) { res.status(400).json({ error: error.message }); }
    });

    app.put('/api/patrol-route-deployments/:id', authenticate, writeRole, async (req, res) => {
        try {
            const deploymentId = requireId(req.params.id, 'Deployment');
            const deployment = normalizeDeployment(req.body);
            const name = await teamName(deployment.team_id);
            const [result] = await pool.query(`UPDATE patrol_route_deployments SET scheduled_date=?, shift=?, team_id=?, team_name=?, status=?, notes=?, updated_by=? WHERE id=?`,
                [deployment.scheduled_date, deployment.shift, deployment.team_id, name, deployment.status, deployment.notes, req.userId, deploymentId]);
            if (!result.affectedRows) return res.status(404).json({ error: 'Deployment not found.' });
            const [rows] = await pool.query('SELECT route_id FROM patrol_route_deployments WHERE id=?', [deploymentId]);
            res.json({ route: await routeDetails(rows[0].route_id, deployment.scheduled_date) });
        } catch (error) { res.status(400).json({ error: error.message }); }
    });

    app.delete('/api/patrol-routes/:id', authenticate, writeRole, async (req, res) => {
        try {
            const routeId = requireId(req.params.id, 'Route');
            const [result] = await pool.query("UPDATE patrol_routes SET status='Cancelled', updated_by=? WHERE id=?", [req.userId, routeId]);
            if (!result.affectedRows) return res.status(404).json({ error: 'Patrol route not found.' });
            await pool.query("UPDATE patrol_route_deployments SET status='Cancelled', updated_by=? WHERE route_id=? AND status NOT IN ('Completed','Cancelled')", [req.userId, routeId]);
            res.json({ message: 'Patrol route cancelled.' });
        } catch (error) { res.status(400).json({ error: error.message }); }
    });

    app.get('/api/patrol-route-logs', authenticate, readRole, async (req, res) => {
        try {
            const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
            const search = String(req.query.search || '').trim();
            const params = [];
            const filters = search ? ' AND (r.route_name LIKE ? OR d.team_name LIKE ? OR l.report LIKE ?)' : '';
            if (search) { const term = `%${search}%`; params.push(term, term, term); }
            const [rows] = await pool.query(`SELECT l.*, d.id AS deployment_id, d.scheduled_date, d.shift, d.team_name,
                    r.id AS route_id, r.route_name, r.geometry_json
                FROM patrol_route_logs l JOIN patrol_route_deployments d ON d.id=l.deployment_id
                JOIN patrol_routes r ON r.id=d.route_id WHERE 1=1${filters}
                ORDER BY l.patrol_date DESC, l.id DESC LIMIT ?`, [...params, limit]);
            res.json(rows);
        } catch (error) { res.status(500).json({ error: 'Could not load patrol route logs.' }); }
    });

    app.post('/api/patrol-route-logs', authenticate, writeRole, async (req, res) => {
        let conn;
        try {
            const deploymentId = requireId(req.body.deployment_id, 'Deployment');
            const patrolDate = dateOnly(req.body.patrol_date);
            if (!patrolDate) throw new Error('A valid patrol date is required.');
            const status = req.body.status || 'Completed';
            if (!LOG_STATUSES.has(status)) throw new Error('Invalid patrol log status.');
            const [deployment] = await pool.query('SELECT * FROM patrol_route_deployments WHERE id=?', [deploymentId]);
            if (!deployment.length) return res.status(404).json({ error: 'Deployment not found.' });
            const [existingLog] = await pool.query('SELECT id FROM patrol_route_logs WHERE deployment_id=? LIMIT 1', [deploymentId]);
            if (existingLog.length) return res.status(409).json({ error: 'A patrol log already exists for this deployment. Edit the existing log instead.', log_id: existingLog[0].id });
            conn = await pool.getConnection(); await conn.beginTransaction();
            const [result] = await conn.query(`INSERT INTO patrol_route_logs (deployment_id, patrol_date, status, report) VALUES (?, ?, ?, ?)`, [deploymentId, patrolDate, status, String(req.body.report || '').trim().slice(0, 2000) || null]);
            await saveAttendance(conn, result.insertId, deploymentId, req.body.attendance || []);
            if (status === 'Completed') await conn.query("UPDATE patrol_route_deployments SET status='Completed', updated_by=? WHERE id=? AND status<>'Cancelled'", [req.userId, deploymentId]);
            await refreshPatrolRiskForDeployment(conn, deploymentId, req.userId);
            await conn.commit();
            res.status(201).json({ log_id: result.insertId });
        } catch (error) { if (conn) await conn.rollback().catch(() => {}); res.status(400).json({ error: error.message || 'Could not save patrol log.' }); }
        finally { if (conn) conn.release(); }
    });

    app.put('/api/patrol-route-logs/:id', authenticate, writeRole, async (req, res) => {
        let conn;
        try {
            const logId = requireId(req.params.id, 'Log');
            const patrolDate = dateOnly(req.body.patrol_date);
            if (!patrolDate) throw new Error('A valid patrol date is required.');
            const status = req.body.status || 'Completed';
            if (!LOG_STATUSES.has(status)) throw new Error('Invalid patrol log status.');
            const [existing] = await pool.query('SELECT deployment_id FROM patrol_route_logs WHERE id=?', [logId]);
            if (!existing.length) return res.status(404).json({ error: 'Patrol route log not found.' });
            conn = await pool.getConnection(); await conn.beginTransaction();
            await conn.query('UPDATE patrol_route_logs SET patrol_date=?, status=?, report=? WHERE id=?', [patrolDate, status, String(req.body.report || '').trim().slice(0, 2000) || null, logId]);
            await saveAttendance(conn, logId, existing[0].deployment_id, req.body.attendance || []);
            await conn.query("UPDATE patrol_route_deployments SET status=?, updated_by=? WHERE id=? AND status<>'Cancelled'", [status === 'Completed' ? 'Completed' : 'Draft', req.userId, existing[0].deployment_id]);
            await refreshPatrolRiskForDeployment(conn, existing[0].deployment_id, req.userId);
            await conn.commit(); res.json({ log_id: logId });
        } catch (error) { if (conn) await conn.rollback().catch(() => {}); res.status(400).json({ error: error.message || 'Could not update patrol log.' }); }
        finally { if (conn) conn.release(); }
    });

    async function saveAttendance(db, logId, deploymentId, attendance) {
        // The new scheduler keeps saved teams as the source of truth. Attendance
        // is accepted from the visible team roster and remains auditable by ID.
        const normalized = Array.isArray(attendance) ? attendance : [];
        for (const row of normalized) {
            if (!['Tanod', 'Volunteer', 'Team Leader'].includes(row.person_type)) continue;
            const personId = Number(row.person_id); if (!Number.isInteger(personId) || personId <= 0) continue;
            const attendanceStatus = ['Present', 'Absent', 'Late', 'Excused'].includes(row.attendance_status) ? row.attendance_status : 'Present';
            await db.query(`INSERT INTO patrol_route_log_attendance (log_id, person_type, person_id, attendance_status, notes) VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE attendance_status=VALUES(attendance_status), notes=VALUES(notes)`, [logId, row.person_type, personId, attendanceStatus, String(row.notes || '').slice(0, 255)]);
        }
    }

    app.get('/api/patrol-route-logs/:id', authenticate, readRole, async (req, res) => {
        try {
            const id = requireId(req.params.id, 'Log');
            const [rows] = await pool.query(`SELECT l.*, d.scheduled_date, d.shift, d.team_id, d.team_name, r.route_name, r.id AS route_id
                FROM patrol_route_logs l JOIN patrol_route_deployments d ON d.id=l.deployment_id JOIN patrol_routes r ON r.id=d.route_id WHERE l.id=?`, [id]);
            if (!rows.length) return res.status(404).json({ error: 'Patrol route log not found.' });
            const [attendance] = await pool.query('SELECT person_type, person_id, attendance_status, notes FROM patrol_route_log_attendance WHERE log_id=?', [id]);
            res.json({ ...rows[0], attendance });
        } catch (error) { res.status(400).json({ error: error.message }); }
    });
}

module.exports = { registerPatrolRouteRoutes, roadGeometry, routeFallback, orderRouteStops, isConnectedWithinRadius, clusterRecords, exceedsSuggestedStopLimit,
    adjustedPatrolRisk, shouldArchivePatrolRisk, MIN_ROUTE_STOPS, SUGGESTED_MAX_ROUTE_STOPS, SUGGESTION_RADIUS_METERS, PATROL_RISK_RETAINED_FACTOR, MIN_ARCHIVE_COMPLETIONS };
