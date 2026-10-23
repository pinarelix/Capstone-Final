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

function createRecordPatrol({ pool, cartEngine, configureCart, authenticate, requireRole, validate,
    resolveRegistry, computeCartRiskFactors, computeTimeOfDay, getDayOfWeek, isDateWeekend,
    logAudit, locations }) {
    const readRoles = requireRole(['Executive Officer', 'Kagawad', 'Team Leader']);
    const writeRole = requireRole(['Executive Officer']);

    async function mapRecords(options = {}) {
        await configureCart();
        const windowDays = options.window_days === 'all' ? null : Math.min(3650, Math.max(1, Number(options.window_days) || 90));
        const paging = pagination(options, 500, 1000);
        const where = ["i.is_draft = 0", "TRIM(i.status) != 'Resolved'", 'i.latitude IS NOT NULL', 'i.longitude IS NOT NULL'];
        const values = [];
        if (options.id) { where.push('i.id = ?'); values.push(options.id); }
        else if (windowDays) { where.push('i.date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)'); values.push(windowDays); }
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
        return { records: result.filter(row=>row.eligible), thresholds: {...cartEngine.thresholds}, window_days: windowDays,
            pagination: {page:paging.page, pageSize:paging.limit, totalCandidates:Number(totals[0].total), totalPages:Math.ceil(Number(totals[0].total)/paging.limit)} };
    }

    async function metadata(id) {
        const [rows] = await pool.query('SELECT notes AS patrol_notes, patrol_override FROM record_patrol_details WHERE incident_id = ?', [id]);
        return rows[0] || { patrol_notes: '', patrol_override: 'auto' };
    }

    async function saveMetadata(db, id, body, userId) {
        if (body.patrol_notes === undefined && body.patrol_override === undefined) return;
        const current = await metadata(id);
        await db.query(`INSERT INTO record_patrol_details (incident_id, notes, patrol_override, updated_by)
            VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE notes=VALUES(notes), patrol_override=VALUES(patrol_override), updated_by=VALUES(updated_by)`,
        [id, body.patrol_notes ?? current.patrol_notes, body.patrol_override ?? current.patrol_override, userId]);
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
        patrol_notes: notesSchema, patrol_override: overrideSchema
    }).min(1);

    function register(app) {
        app.get('/api/heatmap/config', authenticate, readRoles, async (req, res) => {
            try { await configureCart(); res.json({ thresholds: { ...cartEngine.thresholds }, model: 'Weighted rule-based CART', recurrence_days: 30, recurrence_meters: 100 }); }
            catch { res.status(500).json({ error: 'Failed to load map configuration' }); }
        });
        app.get('/api/heatmap/records', authenticate, readRoles, async (req, res) => {
            try {
                res.json(await mapRecords({...req.query, withMeta:true}));
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
                const { patrol_notes, patrol_override, ...fields } = req.body;
                if (fields.incident_type) fields.type_code = codeFor(reg.source, fields.incident_type);
                if (fields.time) fields.time_of_day = computeTimeOfDay(fields.time);
                if (fields.date) { fields.day_of_week = getDayOfWeek(fields.date); fields.is_weekend = isDateWeekend(fields.date); }
                if (Object.keys(fields).length) fields.updated_by = req.userId;
                conn = await pool.getConnection();
                await conn.beginTransaction();
                if (Object.keys(fields).length) await conn.query(`UPDATE \`${reg.table}\` SET ? WHERE id = ?`, [fields, reg.source_id]);
                await saveMetadata(conn, current.id, { patrol_notes, patrol_override }, req.userId);
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
            try { res.json((await pool.query('SELECT id, name, is_active FROM tanods ORDER BY name'))[0]); }
            catch { res.status(500).json({ error: 'Could not load tanods' }); }
        });
        app.post('/api/tanods', authenticate, writeRole,
            validate(Joi.object({ name: Joi.string().trim().min(2).max(100).pattern(/^[^<>\x00-\x1F]*$/).required() })), async (req, res) => {
                try {
                    const [result] = await pool.query('INSERT INTO tanods (name) VALUES (?)', [req.body.name]);
                    await logAudit(req.userId, 'CREATE_TANOD', 'tanods', result.insertId, null, req.body, req);
                    res.status(201).json({ id: result.insertId, name: req.body.name, is_active: 1 });
                } catch { res.status(500).json({ error: 'Could not add tanod' }); }
            });
    }

    async function validateScheduleContext(req, res, next) {
        try {
            if (req.body.incident_id) {
                const record = (await mapRecords({id:req.body.incident_id}))[0];
                const [existing] = req.method === 'PUT' ? await pool.query('SELECT incident_id FROM patrol_schedule_records WHERE schedule_id=?', [req.params.id]) : [[]];
                const closingExisting = existing[0]?.incident_id === req.body.incident_id && ['Completed','Cancelled'].includes(req.body.status);
                if ((!record || (!record.eligible && !req.body.manual_patrol)) && !closingExisting) return res.status(409).json({ error: 'Record is not patrol eligible; use the manual patrol override for an active record' });
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
            const minutes = time => { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; };
            if (minutes(req.body.end_time) <= minutes(req.body.start_time)) return res.status(400).json({ error: 'End time must be later than start time; split overnight patrols into two schedules' });
            next();
        } catch { res.status(500).json({ error: 'Could not validate schedule context' }); }
    }

    async function saveScheduleExtras(db, id, body, userId) {
        if (['incident_id', 'scheduled_date', 'priority', 'exact_address'].some(key => body[key] !== undefined)) {
            await db.query(`INSERT INTO patrol_schedule_records (schedule_id, incident_id, scheduled_date, priority, exact_address)
                VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE incident_id=VALUES(incident_id), scheduled_date=VALUES(scheduled_date),
                priority=VALUES(priority), exact_address=VALUES(exact_address)`,
            [id, body.incident_id || null, body.scheduled_date || null, body.priority || 'Low', body.exact_address || '']);
        }
        if (body.tanod_ids !== undefined) {
            await db.query('DELETE FROM patrol_schedule_tanods WHERE schedule_id = ?', [id]);
            for (const tanodId of body.tanod_ids) await db.query('INSERT INTO patrol_schedule_tanods (schedule_id, tanod_id) VALUES (?, ?)', [id, tanodId]);
        }
        if (body.incident_id && body.manual_patrol) await saveMetadata(db, body.incident_id, { patrol_override: 'include' }, userId);
    }

    async function scheduleExtras(id) {
        const [rows] = await pool.query('SELECT * FROM patrol_schedule_records WHERE schedule_id = ?', [id]);
        const [tanods] = await pool.query(`SELECT t.id, t.name FROM tanods t JOIN patrol_schedule_tanods st ON st.tanod_id=t.id WHERE st.schedule_id=? ORDER BY t.name`, [id]);
        return { ...(rows[0] || {}), tanod_ids: tanods.map(t => t.id), tanods };
    }

    return { register, mapRecords, metadata, saveMetadata, validateScheduleContext, saveScheduleExtras, scheduleExtras };
}
module.exports = { createRecordPatrol, notesSchema, overrideSchema, dateOnlySchema };
