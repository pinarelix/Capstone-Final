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
        if (options.id) { where.push('i.id = ?'); values.push(options.id); }
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
        `, [...values, options.id ? 1 : paging.limit, options.id ? 0 : paging.offset]);
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
            try { res.json((await pool.query('SELECT id, name, contact_no, address, birth_date, is_active FROM tanods ORDER BY name'))[0]); }
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

        app.get('/api/patrol-teams', authenticate, readRoles, async (req, res) => {
            try {
                const [teams] = await pool.query(`
                    SELECT pt.id, pt.name, pt.leader_user_id, pt.is_active, u.name AS leader_name
                    FROM patrol_teams pt LEFT JOIN users u ON u.id = pt.leader_user_id
                    WHERE pt.is_active = 1 ORDER BY pt.name
                `);
                const [members] = await pool.query(`
                    SELECT ptt.team_id, t.id, t.name, t.contact_no, t.address, t.birth_date, ptt.role
                    FROM patrol_team_tanods ptt JOIN tanods t ON t.id = ptt.tanod_id
                    WHERE t.is_active = 1 AND ptt.is_active = 1 ORDER BY t.name
                `);
                const byTeam = new Map(teams.map(team => [team.id, []]));
                members.forEach(member => byTeam.get(member.team_id)?.push(member));
                res.json(teams.map(team => ({ ...team, tanods: byTeam.get(team.id) || [] })));
            } catch { res.status(500).json({ error: 'Could not load patrol teams' }); }
        });

        const patrolTeamSchema = Joi.object({
            name: Joi.string().trim().min(2).max(100).pattern(/^[^<>\x00-\x1F]*$/).required(),
            leader_user_id: Joi.number().integer().positive().allow(null, ''),
            tanod_ids: Joi.array().items(Joi.number().integer().positive()).unique().max(30).default([]),
            is_active: Joi.boolean().default(true)
        });

        async function validatePatrolTeamMembers(body) {
            const leaderId = body.leader_user_id === '' ? null : body.leader_user_id || null;
            if (leaderId) {
                const [leaders] = await pool.query("SELECT id FROM users WHERE id = ? AND role = 'Team Leader' AND is_active = 1", [leaderId]);
                if (!leaders.length) return 'Choose an active user with the Team Leader role.';
            }
            if (body.tanod_ids?.length) {
                const [tanods] = await pool.query('SELECT id FROM tanods WHERE is_active = 1 AND id IN (?)', [body.tanod_ids]);
                if (tanods.length !== body.tanod_ids.length) return 'Choose only active Tanods.';
            }
            return null;
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
                    await conn.query('UPDATE patrol_team_tanods SET is_active = 0 WHERE team_id = ?', [id]);
                } else {
                    const [created] = await conn.query('INSERT INTO patrol_teams (name, leader_user_id, is_active) VALUES (?, ?, ?)', [req.body.name, leaderId, req.body.is_active ? 1 : 0]);
                    teamId = created.insertId;
                }
                for (const tanodId of req.body.tanod_ids || []) await conn.query(`
                    INSERT INTO patrol_team_tanods (team_id, tanod_id, role, is_active)
                    VALUES (?, ?, 'Tanod', 1)
                    ON DUPLICATE KEY UPDATE is_active = 1, role = 'Tanod'
                `, [teamId, tanodId]);
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
    }

    async function validateScheduleContext(req, res, next) {
        try {
            if (req.body.manual_patrol !== undefined) return res.status(400).json({ error: 'Manual patrol overrides are no longer supported.' });
            if (req.body.incident_id) {
                const record = (await mapRecords({id:req.body.incident_id}))[0];
                const [existing] = req.method === 'PUT' ? await pool.query('SELECT incident_id FROM patrol_schedule_records WHERE schedule_id=?', [req.params.id]) : [[]];
                const closingExisting = existing[0]?.incident_id === req.body.incident_id && ['Completed','Cancelled'].includes(req.body.status);
                if ((!record || !record.eligible) && !closingExisting) return res.status(409).json({ error: 'Record is not eligible for patrol under the automated risk policy.' });
                if (record && record.street_name !== req.body.location) return res.status(400).json({ error: 'Schedule location must match the linked record' });
                // Record pin and address are authoritative for linked patrols.
                if (record) {
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

    async function getScheduleConflicts({ tanodIds = [], scheduledDate, startTime, endTime, excludeId = null }) {
        if (!tanodIds.length || !scheduledDate) return [];
        const [rows] = await pool.query(`SELECT ps.id, ps.start_time, ps.end_time, ps.status, pr.scheduled_date,
                t.id AS tanod_id, t.name AS tanod_name
            FROM patrol_schedules ps
            JOIN patrol_schedule_records pr ON pr.schedule_id=ps.id
            JOIN patrol_schedule_tanods st ON st.schedule_id=ps.id
            JOIN tanods t ON t.id=st.tanod_id
            WHERE ps.status='Active' AND pr.scheduled_date IS NOT NULL AND st.tanod_id IN (?) ${excludeId ? 'AND ps.id <> ?' : ''}`,
            excludeId ? [tanodIds, excludeId] : [tanodIds]);
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
            return (sameDay || previousDay) && start < rowWindowEnd && rowStart < end;
        }).map(row => ({ schedule_id: row.id, tanod_id: row.tanod_id, tanod_name: row.tanod_name, date: String(row.scheduled_date).slice(0, 10), start_time: String(row.start_time).slice(0, 5), end_time: String(row.end_time).slice(0, 5) }));
    }

    async function scheduleExtras(id) {
        const [rows] = await pool.query('SELECT * FROM patrol_schedule_records WHERE schedule_id = ?', [id]);
        const [tanods] = await pool.query(`SELECT t.id, t.name FROM tanods t JOIN patrol_schedule_tanods st ON st.tanod_id=t.id WHERE st.schedule_id=? ORDER BY t.name`, [id]);
        const [snapshots] = await pool.query('SELECT * FROM patrol_schedule_team_snapshots WHERE schedule_id=? ORDER BY tanod_name', [id]);
        return { ...(rows[0] || {}), tanod_ids: tanods.map(t => t.id), tanods, team_snapshot: snapshots };
    }

    return { register, mapRecords, metadata, saveMetadata, validateScheduleContext, saveScheduleExtras, scheduleExtras, getScheduleConflicts };
}
module.exports = { createRecordPatrol, notesSchema, overrideSchema, dateOnlySchema };
