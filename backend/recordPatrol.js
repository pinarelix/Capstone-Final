const Joi = require('joi');
const { patrolDecision, distanceMeters, validCoordinates } = require('./patrolPolicy');
const { isValidType, codeFor } = require('./recordTypes');
const { pagination } = require('./recordQueries');

const notesSchema = Joi.string().max(200).pattern(/^[^<>\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*$/).allow('');
const overrideSchema = Joi.string().valid('auto', 'include', 'exclude');
const dateOnlySchema = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((value, helpers) => {
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : helpers.error('any.invalid');
});
const MAP_PAGE_SIZE = 500;
const mapQuerySchema = Joi.object({
    granularity: Joi.string().valid('day', 'week', 'month'),
    period: dateOnlySchema.default(() => new Date().toISOString().slice(0, 10)),
    page: Joi.number().integer().min(1).max(100000).default(1),
    window_days: Joi.string().valid('90', 'all'),
    limit: Joi.number().integer().min(1).max(1000),
    location: Joi.string().max(100).allow('')
}).unknown(false);

function createRecordPatrol({ pool, cartEngine, configureCart, authenticate, requireRole, validate,
    resolveRegistry, computeCartRiskFactors, computeTimeOfDay, getDayOfWeek, isDateWeekend,
    logAudit, locations }) {
    const readRoles = requireRole(['Executive Officer', 'Kagawad', 'Team Leader']);
    const writeRole = requireRole(['Executive Officer']);

    async function mapRecords(options = {}) {
        await configureCart();
        const paging = pagination({ page: options.page, limit: MAP_PAGE_SIZE }, MAP_PAGE_SIZE, MAP_PAGE_SIZE);
        const where = ["i.is_draft = 0", "TRIM(i.status) != 'Resolved'", 'i.latitude IS NOT NULL', 'i.longitude IS NOT NULL'];
        const values = [];
        if (options.id) {
            if (Array.isArray(options.id)) { where.push('i.id IN (?)'); values.push(options.id); }
            else { where.push('i.id = ?'); values.push(options.id); }
        }
        else {
            if (options.location) { where.push('i.street_name = ?'); values.push(options.location); }
            if (options.window_days === '90') {
                where.push('i.date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)');
            } else if (options.window_days === 'all') {
                // Legacy/report callers may request all dates, but the fixed
                // page boundary above still prevents an unbounded transfer.
            } else if (!options.granularity) {
                // Preserve the existing /api/heatmap/incidents contract for
                // older consumers that do not send the calendar filters.
                where.push('i.date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)');
            } else if (options.granularity === 'day') {
                where.push('i.date = ?'); values.push(options.period);
            } else if (options.granularity === 'week') {
                where.push('i.date BETWEEN ? AND DATE_ADD(?, INTERVAL 6 DAY)'); values.push(options.period, options.period);
            } else {
                where.push("i.date >= DATE_FORMAT(?, '%Y-%m-01') AND i.date < DATE_ADD(DATE_FORMAT(?, '%Y-%m-01'), INTERVAL 1 MONTH)");
                values.push(options.period, options.period);
            }
        }
        const clause = where.join(' AND ');
        const [totals] = await pool.query(`SELECT COUNT(*) AS total FROM incidents i WHERE ${clause}`, values);
        const [rows] = await pool.query(`
            SELECT i.id, i.blotter_number, i.form_type, i.incident_type, i.severity, i.date, i.time,
                   i.time_of_day, i.day_of_week, i.is_weekend, i.street_name, i.address, i.status,
                   i.is_draft, i.data_origin, i.latitude, i.longitude,
                   COALESCE(p.patrol_override, 'auto') AS patrol_override,
                   rf.total_risk_score AS stored_cart_score,
                   (SELECT COUNT(*) FROM patrol_schedule_records pr JOIN patrol_schedules ps ON ps.id = pr.schedule_id
                    WHERE pr.incident_id = i.id AND ps.status = 'Active'
                    AND (pr.scheduled_date IS NULL OR pr.scheduled_date > CURDATE()
                         OR (pr.scheduled_date = CURDATE() AND ps.end_time >= CURTIME()))) AS active_patrol_count
            FROM incidents i
            LEFT JOIN record_patrol_details p ON p.incident_id = i.id
            LEFT JOIN cart_risk_factors rf ON rf.incident_id = i.id
            WHERE ${clause}
            ORDER BY i.date DESC, i.time DESC, i.id DESC LIMIT ? OFFSET ?
        `, [...values, options.id ? (Array.isArray(options.id) ? options.id.length : 1) : paging.limit, options.id ? 0 : paging.offset]);
        const [stats] = await pool.query(`SELECT street_name, COUNT(*) AS total,
            SUM(date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND date <= CURDATE()) AS recent
            FROM incidents WHERE is_draft = 0 AND street_name IS NOT NULL GROUP BY street_name`);
        const byStreet = new Map(stats.map(s => [s.street_name, s]));
        // Count recurrence against ALL qualifying neighbors in SQL, not just
        // this display page. A page boundary must not change patrol eligibility.
        const nearby = new Map();
        if (rows.length) {
            const [counts] = await pool.query(`SELECT c.id, COUNT(n.id) AS nearby
                FROM incidents c JOIN incidents n ON n.incident_type=c.incident_type
                AND n.is_draft=0 AND TRIM(n.status)!='Resolved' AND n.date BETWEEN DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND CURDATE()
                AND n.latitude BETWEEN c.latitude-.001 AND c.latitude+.001
                AND n.longitude BETWEEN c.longitude-.001 AND c.longitude+.001
                AND 12742000 * ASIN(SQRT(LEAST(1,
                    POW(SIN(RADIANS(n.latitude-c.latitude)/2),2) + COS(RADIANS(c.latitude))*COS(RADIANS(n.latitude))*POW(SIN(RADIANS(n.longitude-c.longitude)/2),2)))) <= 100
                WHERE c.id IN (?) GROUP BY c.id`, [rows.map(row=>row.id)]);
            counts.forEach(row=>nearby.set(Number(row.id),Number(row.nearby)));
        }

        const scored = rows.filter(validCoordinates).map(row => {
            const history = byStreet.get(row.street_name) || {};
            const analysis = cartEngine.analyze({ ...row, time_of_day: row.time_of_day || computeTimeOfDay(String(row.time || '')) },
                { street_count: Number(history.total) || 0 }, { recent_count: Number(history.recent) || 0 });
            return { ...row, patrol_notes: row.patrol_notes || '', cart_score: analysis.totalScore,
                danger_level: analysis.dangerDescription, cart_decision_path: analysis.decisionPath.join('\n') };
        });
        const result = scored.map(row => {
            const count = nearby.get(Number(row.id)) || 0;
            return { ...row, ...patrolDecision(row, cartEngine.thresholds, count), nearby_recent_count: count };
        });
        if (!options.withMeta) return result;
        return { records: result.filter(row=>row.eligible), thresholds: {...cartEngine.thresholds},
            pagination: {page:paging.page, pageSize:paging.limit, totalCandidates:Number(totals[0].total), totalPages:Math.ceil(Number(totals[0].total)/paging.limit)} };
    }

    async function metadata(id) {
        const [rows] = await pool.query('SELECT notes AS patrol_notes, patrol_override FROM record_patrol_details WHERE incident_id = ?', [id]);
        return rows[0] || { patrol_notes: '', patrol_override: 'auto' };
    }

    async function saveMetadata(db, id, body, userId) {
        if (body.patrol_notes === undefined) return;
        const current = await metadata(id);
        await db.query(`INSERT INTO record_patrol_details (incident_id, notes, patrol_override, updated_by)
            VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE notes=VALUES(notes), patrol_override=VALUES(patrol_override), updated_by=VALUES(updated_by)`,
        [id, body.patrol_notes ?? current.patrol_notes, current.patrol_override || 'auto', userId]);
    }

    const patchSchema = Joi.object({
        incident_type: Joi.string().max(150),
        date: dateOnlySchema,
        time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        street_name: Joi.string().valid(...locations),
        latitude: Joi.number().min(-90).max(90), longitude: Joi.number().min(-180).max(180),
        address: Joi.string().max(255).allow(''), status: Joi.string().valid('Open', 'Monitoring', 'Resolved'),
        addr_block: Joi.string().max(50).allow(''), addr_lot: Joi.string().max(50).allow(''),
        addr_house_no: Joi.string().max(50).allow(''), addr_unit: Joi.string().max(50).allow(''),
        severity: Joi.string().valid('High', 'Medium', 'Low'),
        description: Joi.string().max(2000).allow(''),
        recommended_action: Joi.string().max(1000).allow(''),
        patrol_notes: notesSchema, patrol_override: Joi.any().strip()
    }).min(1);

    function register(app) {
        app.get('/api/heatmap/config', authenticate, readRoles, async (req, res) => {
            try { await configureCart(); res.json({ thresholds: { ...cartEngine.thresholds }, model: 'Weighted rule-based CART', recurrence_days: 30, recurrence_meters: 100 }); }
            catch { res.status(500).json({ error: 'Failed to load map configuration' }); }
        });
        app.get('/api/heatmap/records', authenticate, readRoles, async (req, res) => {
            try {
                const { value, error } = mapQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: false });
                if (error) return res.status(400).json({ error: 'Invalid map filter', details: error.details.map(item => item.message) });
                res.json(await mapRecords({...value, withMeta:true}));
            } catch (err) { res.status(500).json({ error: 'Failed to load patrol map records' }); }
        });
        app.patch('/api/incidents/:id/patrol-details', authenticate, writeRole, validate(patchSchema), async (req, res) => {
            let conn;
            try {
                const reg = await resolveRegistry(pool, req.params.id);
                if (!reg) return res.status(404).json({ error: 'Record not found' });
                const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [req.params.id]);
                const current = rows[0];
                if (req.body.incident_type && !isValidType(reg.source, req.body.incident_type)) return res.status(400).json({ error: 'Type is not approved for this record form' });
                const { patrol_notes, ...fields } = req.body;
                if (fields.incident_type) fields.type_code = codeFor(reg.source, fields.incident_type);
                if (fields.time) fields.time_of_day = computeTimeOfDay(fields.time);
                if (fields.date) { fields.day_of_week = getDayOfWeek(fields.date); fields.is_weekend = isDateWeekend(fields.date); }
                if (Object.keys(fields).length) fields.updated_by = req.userId;
                conn = await pool.getConnection();
                await conn.beginTransaction();
                if (Object.keys(fields).length) await conn.query(`UPDATE \`${reg.table}\` SET ? WHERE id = ?`, [fields, reg.source_id]);
                await saveMetadata(conn, current.id, { patrol_notes }, req.userId);
                await conn.commit();
                await computeCartRiskFactors(current.id);
                await logAudit(req.userId, 'UPDATE_MAP_RECORD', 'incidents', current.id, current, req.body, req);
                res.json({ success: true });
            } catch (err) {
                if (conn) await conn.rollback();
                res.status(500).json({ error: 'Could not save record changes' });
            } finally { if (conn) conn.release(); }
        });
        app.get('/api/incidents/:id/patrol-prefill', authenticate, writeRole, async (req, res) => {
            try {
                const record = (await mapRecords({id:req.params.id}))[0];
                if (!record) return res.status(409).json({ error: 'Only active geocoded records can be scheduled' });
                const [{ today, tomorrow, now_time }] = (await pool.query('SELECT CURDATE() AS today, DATE_ADD(CURDATE(), INTERVAL 1 DAY) AS tomorrow, CURTIME() AS now_time'))[0];
                const scheduledDate = record.time && String(record.time) <= String(now_time) ? tomorrow : today;
                res.json({ record, scheduled_date: scheduledDate,
                    priority: record.cart_score >= cartEngine.thresholds.level3 ? 'High' : record.cart_score >= cartEngine.thresholds.level2 ? 'Moderate' : 'Low' });
            } catch { res.status(500).json({ error: 'Could not prepare patrol schedule' }); }
        });
        app.get('/api/tanods', authenticate, readRoles, async (req, res) => {
            try { res.json((await pool.query("SELECT id, name, contact_no, address, birth_date, is_active FROM tanods WHERE person_type='Tanod' ORDER BY name"))[0]); }
            catch { res.status(500).json({ error: 'Could not load tanods' }); }
        });
        app.post('/api/tanods', authenticate, writeRole,
            validate(Joi.object({
                name: Joi.string().trim().min(2).max(25).pattern(/^[A-Za-zÀ-ÖØ-öø-ÿ .'-]+$/).required(),
                contact_no: Joi.string().trim().max(16).pattern(/^(?:09|\+639)[0-9 ]{9,13}$/).allow(''),
                address: Joi.string().trim().min(5).max(30).pattern(/^[^<>\x00-\x1F]+$/).allow(''),
                birth_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((value, helpers) => {
                    if (value > new Date().toISOString().slice(0, 10)) return helpers.error('date.max');
                    return value;
                }).allow('', null).messages({ 'date.max': 'Birth date cannot be in the future.' })
            })), async (req, res) => {
                try {
                    const [result] = await pool.query('INSERT INTO tanods (name, contact_no, address, birth_date) VALUES (?, ?, ?, ?)', [
                        req.body.name, req.body.contact_no || '', req.body.address || '', req.body.birth_date || null
                    ]);
                    await logAudit(req.userId, 'CREATE_TANOD', 'tanods', result.insertId, null, req.body, req);
                    res.status(201).json({ id: result.insertId, name: req.body.name, contact_no: req.body.contact_no || '', address: req.body.address || '', birth_date: req.body.birth_date || null, is_active: 1 });
                } catch { res.status(500).json({ error: 'Could not add tanod' }); }
            });

        const personnelSchema = Joi.object({
            name: Joi.string().trim().min(2).max(100).pattern(/^[^<>\x00-\x1F]*$/).required(),
            contact_no: Joi.string().trim().max(30).allow(''),
            address: Joi.string().trim().max(255).allow(''),
            birth_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null),
            is_active: Joi.boolean().default(true),
            primary_team_id: Joi.number().integer().positive().allow(null, '')
        });
        async function savePersonnel(req, res, kind, id = null) {
            const table = kind === 'Volunteer' ? 'patrol_volunteers' : 'tanods';
            const values = [req.body.name, req.body.contact_no || '', req.body.address || '', req.body.birth_date || null, req.body.is_active === false ? 0 : 1];
            try {
                if (id) {
                    const [result] = await pool.query(`UPDATE ${table} SET name=?, contact_no=?, address=?, birth_date=?, is_active=? WHERE id=?${kind === 'Tanod' ? " AND person_type='Tanod'" : ''}`, [...values, id]);
                    if (!result.affectedRows) return res.status(404).json({ error: `${kind} not found` });
                } else {
                    const [result] = await pool.query(`INSERT INTO ${table} (name, contact_no, address, birth_date, is_active) VALUES (?, ?, ?, ?, ?)`, values);
                    id = result.insertId;
                }
                if (kind === 'Tanod' && req.body.primary_team_id) {
                    await pool.query('UPDATE tanods SET primary_team_id=? WHERE id=?', [req.body.primary_team_id, id]);
                }
                await logAudit(req.userId, `${id ? 'UPDATE' : 'CREATE'}_${kind.toUpperCase()}`, table, id, null, req.body, req);
                const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id=?`, [id]);
                res.status(id && req.params.id ? 200 : 201).json(rows[0]);
            } catch (error) { res.status(error.code === 'ER_NO_REFERENCED_ROW_2' ? 400 : 500).json({ error: `Could not save ${kind.toLowerCase()}` }); }
        }
        app.put('/api/tanods/:id', authenticate, writeRole, validate(personnelSchema), (req, res) => savePersonnel(req, res, 'Tanod', req.params.id));
        app.delete('/api/tanods/:id', authenticate, writeRole, async (req, res) => {
            try { const [result] = await pool.query('UPDATE tanods SET is_active=0 WHERE id=?', [req.params.id]); if (!result.affectedRows) return res.status(404).json({ error: 'Tanod not found' }); res.json({ message: 'Tanod archived' }); }
            catch { res.status(500).json({ error: 'Could not archive Tanod' }); }
        });

        app.get('/api/volunteers', authenticate, readRoles, async (req, res) => {
            try { res.json((await pool.query('SELECT id, name, contact_no, address, birth_date, is_active FROM patrol_volunteers ORDER BY name'))[0]); }
            catch { res.status(500).json({ error: 'Could not load volunteers' }); }
        });
        app.post('/api/volunteers', authenticate, writeRole, validate(personnelSchema), (req, res) => savePersonnel(req, res, 'Volunteer'));
        app.put('/api/volunteers/:id', authenticate, writeRole, validate(personnelSchema), (req, res) => savePersonnel(req, res, 'Volunteer', req.params.id));
        app.delete('/api/volunteers/:id', authenticate, writeRole, async (req, res) => {
            try { const [result] = await pool.query('UPDATE patrol_volunteers SET is_active=0 WHERE id=?', [req.params.id]); if (!result.affectedRows) return res.status(404).json({ error: 'Volunteer not found' }); res.json({ message: 'Volunteer archived' }); }
            catch { res.status(500).json({ error: 'Could not archive volunteer' }); }
        });
        app.get('/api/patrol-personnel', authenticate, readRoles, async (req, res) => {
            try {
                const [tanods] = await pool.query("SELECT id, 'Tanod' AS person_type, name, contact_no, address, birth_date, is_active, primary_team_id, NULL AS linked_user_id FROM tanods WHERE person_type='Tanod' ORDER BY name");
                const [volunteers] = await pool.query("SELECT id, 'Volunteer' AS person_type, name, contact_no, address, birth_date, is_active, NULL AS primary_team_id FROM patrol_volunteers ORDER BY name");
                const [leaders] = await pool.query("SELECT id, 'Team Leader' AS person_type, name, contact_no, '' AS address, NULL AS birth_date, is_active, NULL AS primary_team_id, id AS linked_user_id FROM users WHERE role IN ('Team Leader') ORDER BY name");
                res.json([...tanods, ...volunteers, ...leaders]);
            } catch { res.status(500).json({ error: 'Could not load patrol personnel' }); }
        });

        app.get('/api/patrol-teams', authenticate, readRoles, async (req, res) => {
            try {
                const [teams] = await pool.query(`
                    SELECT pt.id, pt.name, pt.leader_user_id, pt.is_active, u.name AS leader_name
                    FROM patrol_teams pt LEFT JOIN users u ON u.id = pt.leader_user_id
                    WHERE pt.is_active = 1 ORDER BY pt.name
                `);
                const [members] = await pool.query(`
                    SELECT ptt.team_id, t.id, 'Tanod' AS person_type, t.name, t.contact_no, t.address, t.birth_date, ptt.role, NULL AS assignment_type
                    FROM patrol_team_tanods ptt JOIN tanods t ON t.id = ptt.tanod_id
                    WHERE t.is_active = 1 AND t.person_type = 'Tanod' AND ptt.is_active = 1 ORDER BY t.name
                `);
                const [assignments] = await pool.query(`SELECT a.id, a.team_id, a.person_type, a.person_id, a.assignment_type,
                        a.starts_on, a.ends_on, a.is_active, COALESCE(t.name, v.name, u.name) AS person_name
                    FROM patrol_team_assignments a
                    LEFT JOIN tanods t ON a.person_type='Tanod' AND t.id=a.person_id
                    LEFT JOIN patrol_volunteers v ON a.person_type='Volunteer' AND v.id=a.person_id
                    LEFT JOIN users u ON a.person_type='Team Leader' AND u.id=a.person_id
                    WHERE a.is_active=1 ORDER BY person_name`);
                const byTeam = new Map(teams.map(team => [team.id, []]));
                members.forEach(member => byTeam.get(member.team_id)?.push(member));
                const assignmentByTeam = new Map(teams.map(team => [team.id, []]));
                assignments.forEach(assignment => assignmentByTeam.get(assignment.team_id)?.push(assignment));
                res.json(teams.map(team => ({ ...team, tanods: byTeam.get(team.id) || [], assignments: assignmentByTeam.get(team.id) || [] })));
            } catch { res.status(500).json({ error: 'Could not load patrol teams' }); }
        });

        const patrolTeamSchema = Joi.object({
            name: Joi.string().trim().min(2).max(100).pattern(/^[^<>\x00-\x1F]*$/).required(),
            leader_user_id: Joi.number().integer().positive().required(),
            tanod_ids: Joi.array().items(Joi.number().integer().positive()).unique().max(4).default([]),
            assignments: Joi.array().items(Joi.object({
                person_type: Joi.string().valid('Tanod', 'Volunteer', 'Team Leader').required(),
                person_id: Joi.number().integer().positive().required(),
                assignment_type: Joi.string().valid('Primary', 'Temporary').default('Primary'),
                starts_on: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null),
                ends_on: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null)
            })).max(4).default([]),
            is_active: Joi.boolean().default(true)
        });

        function normalizedTeamAssignments(body) {
            const assignments = body.assignments?.length ? body.assignments.map(item => ({ ...item })) : (body.tanod_ids || []).map(person_id => ({ person_type: 'Tanod', person_id, assignment_type: 'Primary' }));
            const leaderId = body.leader_user_id === '' ? null : body.leader_user_id || null;
            if (leaderId && !assignments.some(item => item.person_type === 'Team Leader' && Number(item.person_id) === Number(leaderId))) {
                assignments.unshift({ person_type: 'Team Leader', person_id: Number(leaderId), assignment_type: 'Primary' });
            }
            return assignments;
        }

        async function validatePatrolTeamMembers(body) {
            const assignments = normalizedTeamAssignments(body);
            if (assignments.length > 4) return 'A patrol team can have at most four personnel.';
            const memberKeys = assignments.map(person => `${person.person_type}:${person.person_id}`);
            if (new Set(memberKeys).size !== memberKeys.length) return 'A person can only be listed once on a patrol team.';
            const leaderId = body.leader_user_id === '' ? null : body.leader_user_id || null;
            if (leaderId) {
                const [leaders] = await pool.query("SELECT id FROM users WHERE id = ? AND role = 'Team Leader' AND is_active = 1", [leaderId]);
                if (!leaders.length) return 'Choose an active user with the Team Leader role.';
                if (assignments.filter(person => person.person_type === 'Team Leader').some(person => Number(person.person_id) !== Number(leaderId))) return 'A team can have only its selected Team Leader account.';
            }
            if (body.tanod_ids?.length) {
                const [tanods] = await pool.query("SELECT id FROM tanods WHERE is_active = 1 AND person_type='Tanod' AND id IN (?)", [body.tanod_ids]);
                if (tanods.length !== body.tanod_ids.length) return 'Choose only active Tanods.';
            }
            for (const assignment of assignments) {
                if (assignment.person_type === 'Team Leader') {
                    const [people] = await pool.query("SELECT id FROM users WHERE id=? AND role='Team Leader' AND is_active=1", [assignment.person_id]);
                    if (!people.length) return 'Choose only an active Team Leader account.';
                    continue;
                }
                const table = assignment.person_type === 'Volunteer' ? 'patrol_volunteers' : 'tanods';
                const [people] = await pool.query(`SELECT id FROM ${table} WHERE id=? AND is_active=1${assignment.person_type === 'Tanod' ? " AND person_type='Tanod'" : ''}`, [assignment.person_id]);
                if (!people.length) return `Choose only active ${assignment.person_type}s.`;
                if (assignment.ends_on && assignment.starts_on && assignment.ends_on < assignment.starts_on) return 'Temporary assignment end date must be after its start date.';
            }
            return null;
        }

        async function ensureLeaderPersonnel(conn, leaderId) {
            const [users] = await conn.query("SELECT id, name, contact_no FROM users WHERE id=? AND role='Team Leader' AND is_active=1", [leaderId]);
            if (!users.length) return;
            const leader = users[0];
            const [existing] = await conn.query('SELECT id FROM tanods WHERE linked_user_id=? LIMIT 1', [leaderId]);
            if (!existing.length) {
                await conn.query("INSERT INTO tanods (name, contact_no, address, person_type, linked_user_id, is_active) VALUES (?, ?, '', 'Team Leader', ?, 1)", [leader.name, leader.contact_no || '', leader.id]);
            }
        }

        async function savePatrolTeam(req, res, id = null) {
            const error = await validatePatrolTeamMembers(req.body);
            if (error) return res.status(400).json({ error });
            const leaderId = req.body.leader_user_id === '' ? null : req.body.leader_user_id || null;
            let conn;
            try {
                conn = await pool.getConnection();
                await conn.beginTransaction();
                let teamId = id;
                if (id) {
                    const [existing] = await conn.query('SELECT id FROM patrol_teams WHERE id = ? AND is_active = 1', [id]);
                    if (!existing.length) { await conn.rollback(); return res.status(404).json({ error: 'Patrol team not found' }); }
                    await conn.query('UPDATE patrol_teams SET name = ?, leader_user_id = ?, is_active = ? WHERE id = ?', [req.body.name, leaderId, req.body.is_active ? 1 : 0, id]);
                    await conn.query('UPDATE tanods SET primary_team_id = NULL WHERE primary_team_id = ?', [id]);
                    await conn.query('UPDATE patrol_team_tanods SET is_active = 0 WHERE team_id = ?', [id]);
                    await conn.query('UPDATE patrol_team_assignments SET is_active = 0 WHERE team_id = ?', [id]);
                } else {
                    const [created] = await conn.query('INSERT INTO patrol_teams (name, leader_user_id, is_active) VALUES (?, ?, ?)', [req.body.name, leaderId, req.body.is_active ? 1 : 0]);
                    teamId = created.insertId;
                }
                for (const tanodId of req.body.tanod_ids || []) await conn.query(`
                    INSERT INTO patrol_team_tanods (team_id, tanod_id, role, is_active)
                    VALUES (?, ?, 'Tanod', 1)
                    ON DUPLICATE KEY UPDATE is_active = 1, role = 'Tanod'
                `, [teamId, tanodId]);
                const assignments = normalizedTeamAssignments(req.body);
                if (leaderId) {
                    await ensureLeaderPersonnel(conn, leaderId);
                    await conn.query("UPDATE tanods SET primary_team_id=? WHERE linked_user_id=? AND person_type='Team Leader'", [teamId, leaderId]);
                }
                for (const assignment of assignments) await conn.query(`
                    INSERT INTO patrol_team_assignments (team_id, person_type, person_id, assignment_type, starts_on, ends_on, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [teamId, assignment.person_type, assignment.person_id, assignment.assignment_type || 'Primary', assignment.starts_on || null, assignment.ends_on || null, req.userId]);
                for (const assignment of assignments) {
                    if (assignment.person_type === 'Tanod' && (assignment.assignment_type || 'Primary') === 'Primary') {
                        await conn.query('UPDATE tanods SET primary_team_id=? WHERE id=?', [teamId, assignment.person_id]);
                    }
                }
                await conn.commit();
                await logAudit(req.userId, id ? 'UPDATE_PATROL_TEAM' : 'CREATE_PATROL_TEAM', 'patrol_teams', teamId, null, req.body, req);
                const [team] = await pool.query('SELECT id, name, leader_user_id, is_active FROM patrol_teams WHERE id = ?', [teamId]);
                res.status(id ? 200 : 201).json({ ...team[0], tanod_ids: req.body.tanod_ids || [] });
            } catch (error) {
                if (conn) await conn.rollback();
                if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A patrol team with that name already exists.' });
                res.status(500).json({ error: 'Could not save patrol team' });
            } finally { if (conn) conn.release(); }
        }

        app.post('/api/patrol-teams', authenticate, writeRole, validate(patrolTeamSchema), (req, res) => savePatrolTeam(req, res));
        app.put('/api/patrol-teams/:id', authenticate, writeRole, validate(patrolTeamSchema), (req, res) => savePatrolTeam(req, res, req.params.id));
        app.delete('/api/patrol-teams/:id', authenticate, writeRole, async (req, res) => {
            try {
                const [result] = await pool.query('UPDATE patrol_teams SET is_active=0 WHERE id=?', [req.params.id]);
                if (!result.affectedRows) return res.status(404).json({ error: 'Patrol team not found' });
                await pool.query('UPDATE tanods SET primary_team_id=NULL WHERE primary_team_id=?', [req.params.id]);
                await pool.query('UPDATE patrol_team_assignments SET is_active=0 WHERE team_id=?', [req.params.id]);
                res.json({ message: 'Patrol team archived' });
            } catch { res.status(500).json({ error: 'Could not archive patrol team' }); }
        });
        const assignmentSchema = Joi.object({
            team_id: Joi.number().integer().positive().required(),
            person_type: Joi.string().valid('Tanod', 'Volunteer').required(),
            person_id: Joi.number().integer().positive().required(),
            assignment_type: Joi.string().valid('Primary', 'Temporary').default('Temporary'),
            starts_on: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null),
            ends_on: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null)
        });
        app.post('/api/patrol-team-assignments', authenticate, writeRole, validate(assignmentSchema), async (req, res) => {
            try {
                const table = req.body.person_type === 'Volunteer' ? 'patrol_volunteers' : 'tanods';
                const [people] = await pool.query(`SELECT id FROM ${table} WHERE id=? AND is_active=1`, [req.body.person_id]);
                if (!people.length) return res.status(400).json({ error: 'Personnel member is not active.' });
                const [result] = await pool.query(`INSERT INTO patrol_team_assignments (team_id, person_type, person_id, assignment_type, starts_on, ends_on, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`, [req.body.team_id, req.body.person_type, req.body.person_id, req.body.assignment_type, req.body.starts_on || null, req.body.ends_on || null, req.userId]);
                res.status(201).json({ id: result.insertId, ...req.body });
            } catch (error) { res.status(500).json({ error: 'Could not assign personnel to team' }); }
        });
        app.delete('/api/patrol-team-assignments/:id', authenticate, writeRole, async (req, res) => {
            try { const [result] = await pool.query('UPDATE patrol_team_assignments SET is_active=0 WHERE id=?', [req.params.id]); if (!result.affectedRows) return res.status(404).json({ error: 'Assignment not found' }); res.json({ message: 'Assignment ended' }); }
            catch { res.status(500).json({ error: 'Could not end assignment' }); }
        });
    }

    async function validateScheduleContext(req, res, next) {
        try {
            if (req.body.manual_patrol !== undefined) return res.status(400).json({ error: 'Manual patrol overrides are no longer supported.' });
            const sourceIds = [...new Set([...(req.body.source_record_ids || []), ...(req.body.incident_id ? [req.body.incident_id] : [])].map(Number).filter(Boolean))];
            if (sourceIds.length > 1 || (req.method === 'POST' && sourceIds.length !== 1)) return res.status(400).json({ error: 'Choose exactly one active record from Risk Analysis for each patrol schedule.' });
            if (req.body.route_stops?.length || (req.body.routine_type && req.body.routine_type !== 'Incident Response')) return res.status(400).json({ error: 'Each location must be scheduled separately from Risk Analysis.' });
            if (sourceIds.length === 1) req.body.incident_id = sourceIds[0];
            if (sourceIds.length) {
                const records = await mapRecords({ id: sourceIds });
                const record = records[0];
                const [existing] = req.method === 'PUT' ? await pool.query('SELECT incident_id FROM patrol_schedule_records WHERE schedule_id=?', [req.params.id]) : [[]];
                const closingExisting = existing[0]?.incident_id === req.body.incident_id && ['Completed','Cancelled'].includes(req.body.status);
                if ((!records.length || records.some(item => !item.eligible)) && !closingExisting) return res.status(409).json({ error: 'One or more selected records are not eligible for patrol under the automated risk policy.' });
                if (records.length > 1 && !req.body.location) req.body.location = records[0].street_name;
                if (record && req.body.routine_type === 'Incident Response' && record.street_name !== req.body.location) return res.status(400).json({ error: 'Schedule location must match the linked record' });
                // Record pin and address are authoritative for linked patrols.
                if (record) {
                    req.body.location = record.street_name;
                    req.body.latitude = Number(record.latitude);
                    req.body.longitude = Number(record.longitude);
                    req.body.exact_address = record.address || record.street_name;
                    req.body.priority = record.cart_score >= cartEngine.thresholds.level3 ? 'High' : record.cart_score >= cartEngine.thresholds.level2 ? 'Moderate' : 'Low';
                }
            }
            const ids = req.body.tanod_ids || [];
            if (ids.length) {
                const [active] = await pool.query('SELECT id FROM tanods WHERE is_active = 1 AND id IN (?)', [ids]);
                if (active.length !== ids.length) return res.status(400).json({ error: 'Select valid active tanods' });
            }
            for (const person of req.body.personnel || []) {
                const table = person.person_type === 'Volunteer' ? 'patrol_volunteers' : person.person_type === 'Team Leader' ? 'users' : 'tanods';
                const extra = person.person_type === 'Team Leader' ? " AND role='Team Leader'" : person.person_type === 'Tanod' ? " AND person_type='Tanod'" : '';
                const [active] = await pool.query(`SELECT id FROM ${table} WHERE id=? AND is_active=1${extra}`, [person.person_id]);
                if (!active.length) return res.status(400).json({ error: `Select a valid active ${person.person_type}.` });
            }
            if (req.body.scheduled_date) {
                const day = new Date(`${req.body.scheduled_date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
                if (day !== req.body.day_of_week) return res.status(400).json({ error: 'Schedule date and weekday must agree' });
            }
            next();
        } catch { res.status(500).json({ error: 'Could not validate schedule context' }); }
    }

    async function saveScheduleExtras(db, id, body, userId) {
        if (['incident_id', 'scheduled_date', 'priority', 'exact_address', 'team_name'].some(key => body[key] !== undefined)) {
            const teamNameProvided = body.team_name !== undefined;
            const teamNameUpdate = teamNameProvided ? ', team_name=VALUES(team_name)' : '';
            let teamName = body.team_name;
            if (!teamNameProvided) {
                const [existing] = await db.query('SELECT team_name FROM patrol_schedule_records WHERE schedule_id = ?', [id]);
                teamName = existing[0]?.team_name || '';
            }
            await db.query(`INSERT INTO patrol_schedule_records (schedule_id, incident_id, scheduled_date, priority, exact_address, team_name, team_id)
                VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE incident_id=VALUES(incident_id), scheduled_date=VALUES(scheduled_date),
                priority=VALUES(priority), exact_address=VALUES(exact_address), team_id=VALUES(team_id)${teamNameUpdate}`,
            [id, body.incident_id || null, body.scheduled_date || null, body.priority || 'Low', body.exact_address || '', teamName, body.team_id || null]);
        }
        if (body.tanod_ids !== undefined) {
            await db.query('DELETE FROM patrol_schedule_tanods WHERE schedule_id = ?', [id]);
            for (const tanodId of body.tanod_ids) await db.query('INSERT INTO patrol_schedule_tanods (schedule_id, tanod_id) VALUES (?, ?)', [id, tanodId]);
        }
        if (body.personnel !== undefined) {
            await db.query('DELETE FROM patrol_schedule_personnel WHERE schedule_id=?', [id]);
            for (const person of body.personnel) await db.query('INSERT INTO patrol_schedule_personnel (schedule_id, person_type, person_id) VALUES (?, ?, ?)', [id, person.person_type, person.person_id]);
            await db.query('DELETE FROM patrol_schedule_personnel_snapshots WHERE schedule_id=?', [id]);
            for (const person of body.personnel) {
                const table = person.person_type === 'Volunteer' ? 'patrol_volunteers' : person.person_type === 'Team Leader' ? 'users' : 'tanods';
                const [rows] = await db.query(`SELECT name, contact_no, ${person.person_type === 'Team Leader' ? "''" : 'address'} AS address FROM ${table} WHERE id=?`, [person.person_id]);
                if (rows[0]) await db.query(`INSERT INTO patrol_schedule_personnel_snapshots
                    (schedule_id, person_type, person_id, person_name, contact_no, address, team_name, assignment_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, person.person_type, person.person_id, rows[0].name, rows[0].contact_no, rows[0].address, body.team_name || '', person.assignment_type || 'Primary']);
            }
        }
        if (body.source_record_ids !== undefined || body.incident_id !== undefined) {
            const sourceIds = [...new Set([...(body.source_record_ids || []), ...(body.incident_id ? [body.incident_id] : [])].map(Number).filter(Boolean))];
            await db.query('DELETE FROM patrol_schedule_source_records WHERE schedule_id=?', [id]);
            if (sourceIds.length) {
                const [records] = await db.query(`SELECT r.registry_id, CASE WHEN r.source='blotter' THEN 'Blotter' ELSE 'Incident' END AS record_type,
                    i.street_name FROM record_registry r LEFT JOIN incidents i ON i.id=r.registry_id WHERE r.registry_id IN (?)`, [sourceIds]);
                for (const record of records) await db.query(`INSERT INTO patrol_schedule_source_records (schedule_id, incident_id, record_type, selected_area) VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE record_type=VALUES(record_type), selected_area=VALUES(selected_area)`, [id, record.registry_id, record.record_type, record.street_name || '']);
            }
        }
        if (body.route_stops !== undefined || body.route_name !== undefined || body.routine_type !== undefined) {
            await db.query(`INSERT INTO patrol_schedule_routes (schedule_id, route_name, routine_type) VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE route_name=VALUES(route_name), routine_type=VALUES(routine_type)`, [id, body.route_name || '', body.routine_type || 'Incident Response']);
            await db.query('DELETE FROM patrol_schedule_route_stops WHERE schedule_id=?', [id]);
            for (const stop of body.route_stops || []) await db.query(`INSERT INTO patrol_schedule_route_stops
                (schedule_id, stop_order, location, address, latitude, longitude, dwell_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, stop.stop_order, stop.location, stop.address || '', stop.latitude ?? null, stop.longitude ?? null, stop.dwell_minutes || 0]);
        }
        if (body.team_id) {
            const [teamRows] = await db.query(`SELECT pt.name AS team_name, pt.leader_user_id, COALESCE(u.name,'') AS leader_name,
                    t.id AS tanod_id, t.name AS tanod_name, t.contact_no, t.address, ptt.role
                FROM patrol_teams pt LEFT JOIN users u ON u.id=pt.leader_user_id
                JOIN patrol_team_tanods ptt ON ptt.team_id=pt.id AND ptt.is_active=1
                JOIN tanods t ON t.id=ptt.tanod_id AND t.is_active=1 WHERE pt.id=?`, [body.team_id]);
            await db.query('DELETE FROM patrol_schedule_team_snapshots WHERE schedule_id=?', [id]);
            for (const row of teamRows) await db.query(`INSERT INTO patrol_schedule_team_snapshots
                (schedule_id, team_name, leader_user_id, leader_name, tanod_id, tanod_name, contact_no, address, role)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, row.team_name, row.leader_user_id, row.leader_name, row.tanod_id, row.tanod_name, row.contact_no, row.address, row.role || 'Tanod']);
        }
    }

    async function getScheduleConflicts({ tanodIds = [], teamId = null, personnel = [], scheduledDate, startTime, endTime, excludeId = null }) {
        if ((!tanodIds.length && !teamId && !personnel.length) || !scheduledDate) return [];
        const [rows] = await pool.query(`SELECT ps.id, ps.start_time, ps.end_time, ps.status, pr.scheduled_date,
                t.id AS tanod_id, t.name AS tanod_name
            FROM patrol_schedules ps
            JOIN patrol_schedule_records pr ON pr.schedule_id=ps.id
            LEFT JOIN patrol_schedule_tanods st ON st.schedule_id=ps.id
            LEFT JOIN tanods t ON t.id=st.tanod_id
            WHERE ps.status='Active' AND pr.scheduled_date IS NOT NULL
            AND (st.tanod_id IN (?) OR (? IS NOT NULL AND pr.team_id=?) OR EXISTS (
                SELECT 1 FROM patrol_schedule_personnel sp WHERE sp.schedule_id=ps.id AND CONCAT(sp.person_type, ':', sp.person_id) IN (?)
            )) ${excludeId ? 'AND ps.id <> ?' : ''}`,
            [tanodIds.length ? tanodIds : [0], teamId, teamId, personnel.length ? personnel.map(p => `${p.person_type}:${p.person_id}`) : [''], ...(excludeId ? [excludeId] : [])]);
        const toMinutes = value => { const [h, m] = String(value).slice(0, 5).split(':').map(Number); return h * 60 + m; };
        const dateValue = new Date(`${scheduledDate}T00:00:00Z`);
        const previousDate = new Date(dateValue); previousDate.setUTCDate(previousDate.getUTCDate() - 1);
        const previousKey = previousDate.toISOString().slice(0, 10);
        const start = toMinutes(startTime), end = toMinutes(endTime) <= start ? toMinutes(endTime) + 1440 : toMinutes(endTime);
        return rows.filter(row => {
            const rowStart = toMinutes(row.start_time), rowEnd = toMinutes(row.end_time) <= rowStart ? toMinutes(row.end_time) + 1440 : toMinutes(row.end_time);
            const sameDay = String(row.scheduled_date).slice(0, 10) === scheduledDate;
            const previousDay = String(row.scheduled_date).slice(0, 10) === previousKey;
            const rowWindowStart = previousDay ? rowStart - 1440 : rowStart;
            const rowWindowEnd = previousDay ? rowEnd - 1440 : rowEnd;
            const offset = (new Date(`${String(row.scheduled_date).slice(0, 10)}T00:00:00Z`) - dateValue) / 60000;
            return start < offset + rowEnd && offset + rowStart < end;
        }).map(row => ({ schedule_id: row.id, tanod_id: row.tanod_id, tanod_name: row.tanod_name, date: String(row.scheduled_date).slice(0, 10), start_time: String(row.start_time).slice(0, 5), end_time: String(row.end_time).slice(0, 5) }));
    }

    async function scheduleExtras(id) {
        const [rows] = await pool.query('SELECT * FROM patrol_schedule_records WHERE schedule_id = ?', [id]);
        const [tanods] = await pool.query(`SELECT t.id, t.name FROM tanods t JOIN patrol_schedule_tanods st ON st.tanod_id=t.id WHERE st.schedule_id=? ORDER BY t.name`, [id]);
        const [snapshots] = await pool.query('SELECT * FROM patrol_schedule_team_snapshots WHERE schedule_id=? ORDER BY tanod_name', [id]);
        const [personnel] = await pool.query('SELECT * FROM patrol_schedule_personnel_snapshots WHERE schedule_id=? ORDER BY person_name', [id]);
        const [sourceRecords] = await pool.query(`SELECT s.incident_id AS id, s.record_type, s.selected_area, i.blotter_number, i.form_type, i.street_name, i.address
            FROM patrol_schedule_source_records s LEFT JOIN incidents i ON i.id=s.incident_id
            WHERE s.schedule_id=? ORDER BY s.incident_id`, [id]);
        const [route] = await pool.query('SELECT * FROM patrol_schedule_routes WHERE schedule_id=?', [id]);
        const [stops] = await pool.query('SELECT * FROM patrol_schedule_route_stops WHERE schedule_id=? ORDER BY stop_order', [id]);
        return { ...(rows[0] || {}), tanod_ids: tanods.map(t => t.id), tanods, team_snapshot: snapshots, personnel, source_records: sourceRecords, source_record_ids: sourceRecords.map(record => record.id), route: route[0] || null, route_stops: stops };
    }

    return { register, mapRecords, metadata, saveMetadata, validateScheduleContext, saveScheduleExtras, scheduleExtras, getScheduleConflicts };
}
module.exports = { createRecordPatrol, notesSchema, overrideSchema, dateOnlySchema };
