const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');
const { patrolDecision } = require('../patrolPolicy');
const { migrateRecordPatrol } = require('../migrations/record-patrol');

describe('Record patrol policy', () => {
    const record = { incident_type: 'Theft', cart_score: 25, status: 'Open', is_draft: 0, latitude: 14.75, longitude: 121.07 };
    test('Tier 1 is eligible without a High score', () => expect(patrolDecision(record).eligible).toBe(true));
    test('Tier 2 requires recurrence or High CART risk', () => {
        const conditional = { ...record, incident_type: 'Noise Complaint' };
        expect(patrolDecision(conditional, { level3: 67 }, 1).eligible).toBe(false);
        expect(patrolDecision(conditional, { level3: 67 }, 2).eligible).toBe(true);
        expect(patrolDecision({ ...conditional, cart_score: 67 }).eligible).toBe(true);
    });
    test('override types use live CART threshold; NO_PATROL needs a manual decision', () => {
        const threat = { ...record, incident_type: 'Harassment', cart_score: 60 };
        expect(patrolDecision(threat, { level3: 67 }).eligible).toBe(false);
        expect(patrolDecision(threat, { level3: 60 }).eligible).toBe(true);
        expect(patrolDecision({ ...record, incident_type: 'Scam', cart_score: 99 }).eligible).toBe(false);
        expect(patrolDecision({ ...record, incident_type: 'Scam', patrol_override: 'include' }).eligible).toBe(true);
    });
    test.each([
        { status: 'Resolved' }, { is_draft: 1 }, { latitude: null }, { patrol_override: 'exclude' }
    ])('inactive and excluded records cannot be forced onto the map: %j', override => {
        expect(patrolDecision({ ...record, patrol_override: 'include', ...override }).eligible).toBe(false);
    });
    test('ambiguous combined property type and unknown types require review', () => {
        expect(patrolDecision({ ...record, incident_type: 'Occupation of Real Property or Usurpation of Removal, Sale or Pledge of Mortgaged Property', cart_score: 99 }).policy_class).toBe('UNCLASSIFIED');
    });
});

describe('Record map, notes, roles, and linked patrol scheduling', () => {
    const userIds = [], registryIds = [], scheduleIds = [], tanodIds = [];
    const tokens = {};
    let today;
    let settings;
    let theftId, scamId, harassmentId;

    async function createRecord(type, formType = 'crime', extra = {}) {
        const response = await request(app).post('/api/incidents').set('Authorization', `Bearer ${tokens.executive}`).send({
            form_type: formType, incident_type: type, date: today, time: '10:00', latitude: 14.75, longitude: 121.07,
            street_name: 'Balite Street', status: 'Open', severity: 'Low', priority: 'Normal',
            address: 'House 7, Block 2, Balite Street', complainant_first: 'QA', complainant_last: 'Resident',
            respondent_first: 'Test', respondent_last: 'Respondent', description: 'Original narrative must survive patrol notes.', ...extra
        });
        expect(response.status).toBe(201);
        registryIds.push(response.body.id);
        return response.body.id;
    }
    const auth = role => ({ Authorization: `Bearer ${tokens[role]}` });

    beforeAll(async () => {
        const [{ day }] = (await pool.query('SELECT CURDATE() AS day'))[0]; today = day;
        [settings] = await pool.query("SELECT * FROM system_settings WHERE setting_key IN ('default_danger_threshold_high','default_danger_threshold_moderate')");
        for (const [key, value] of [['default_danger_threshold_high','67'], ['default_danger_threshold_moderate','34']]) {
            await pool.query('INSERT INTO system_settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [key, value]);
        }
        const hash = await bcrypt.hash('testpass123', 10);
        for (const [key, role] of [['executive','Executive Officer'], ['legacy','Deputy Officer'], ['leader','Team Leader'], ['viewer','Kagawad']]) {
            const username = 'record_map_' + key;
            const [user] = await pool.query('INSERT INTO users (name,username,password_hash,role,is_active) VALUES (?,?,?,?,1)', [username, username, hash, role]);
            userIds.push(user.insertId);
            const login = await request(app).post('/api/auth/login').send({ username, password: 'testpass123' });
            expect(login.status).toBe(200);
            if (key === 'legacy') expect(login.body.user.role).toBe('Executive Officer');
            tokens[key] = login.body.session_token;
        }
        theftId = await createRecord('Theft');
        scamId = await createRecord('Scam', 'blotter');
        harassmentId = await createRecord('Harassment', 'blotter');
    });
    afterAll(async () => {
        for (const id of scheduleIds) await pool.query('DELETE FROM patrol_schedules WHERE id=?', [id]);
        for (const id of tanodIds) await pool.query('DELETE FROM tanods WHERE id=?', [id]);
        for (const id of registryIds) {
            const [rows] = await pool.query('SELECT source,source_id FROM record_registry WHERE registry_id=?', [id]);
            await pool.query('DELETE FROM record_registry WHERE registry_id=?', [id]);
            if (rows[0]) await pool.query(`DELETE FROM ${rows[0].source === 'incident' ? 'incident_records' : 'blotter_records'} WHERE id=?`, [rows[0].source_id]);
        }
        await pool.query("DELETE FROM system_settings WHERE setting_key IN ('default_danger_threshold_high','default_danger_threshold_moderate')");
        for (const row of settings || []) await pool.query('INSERT INTO system_settings SET ?', [row]);
        for (const id of userIds) {
            await pool.query('DELETE FROM archived_records WHERE deleted_by=?', [id]);
            await pool.query('DELETE FROM audit_logs WHERE user_id=?', [id]);
            await pool.query('DELETE FROM login_history WHERE user_id=?', [id]);
            await pool.query('DELETE FROM user_sessions WHERE user_id=?', [id]);
            await pool.query('DELETE FROM users WHERE id=?', [id]);
        }
        await pool.end();
    });

    test('additive migration can run again without removing records or notes', async () => {
        await migrateRecordPatrol(pool);
        expect((await pool.query('SELECT id FROM incidents WHERE id=?', [theftId]))[0]).toHaveLength(1);
    });
    test('map returns individual eligible records with exact coordinates and live thresholds', async () => {
        const response = await request(app).get('/api/heatmap/records').set(auth('executive'));
        expect(response.status).toBe(200);
        expect(response.body.thresholds).toEqual({ level3: 67, level2: 34 });
        const row = response.body.records.find(item => item.id === theftId);
        expect(row).toBeDefined();
        expect(Number(row.latitude)).toBe(14.75);
        expect(typeof row.cart_score).toBe('number');
        expect(response.body.records.some(item => item.id === scamId)).toBe(false);
        expect(response.body.records.some(item => item.id === harassmentId)).toBe(false);
    });
    test('threshold changes immediately change override eligibility without a cache delay', async () => {
        await pool.query("UPDATE system_settings SET setting_value='10' WHERE setting_key='default_danger_threshold_moderate'");
        await pool.query("UPDATE system_settings SET setting_value='20' WHERE setting_key='default_danger_threshold_high'");
        const response = await request(app).get('/api/heatmap/records').set(auth('viewer'));
        expect(response.body.thresholds).toEqual({ level3: 20, level2: 10 });
        expect(response.body.records.some(item => item.id === harassmentId)).toBe(true);
        expect(response.body.records.some(item => item.id === scamId)).toBe(false);
        await pool.query("UPDATE system_settings SET setting_value='34' WHERE setting_key='default_danger_threshold_moderate'");
        await pool.query("UPDATE system_settings SET setting_value='67' WHERE setting_key='default_danger_threshold_high'");
    });
    test('notes have a 200-character boundary and reject markup', async () => {
        for (const notes of ['x'.repeat(201), '<script>alert(1)</script>', 'hidden\u0000control']) {
            expect((await request(app).patch(`/api/incidents/${theftId}/patrol-details`).set(auth('executive')).send({ patrol_notes: notes })).status).toBe(400);
        }
        const notes = 'x'.repeat(200);
        expect((await request(app).patch(`/api/incidents/${theftId}/patrol-details`).set(auth('executive')).send({ patrol_notes: notes })).status).toBe(200);
        const detail = await request(app).get(`/api/incidents/${theftId}`).set(auth('executive'));
        expect(detail.body.patrol_notes).toBe(notes);
        expect(detail.body.description).toBe('Original narrative must survive patrol notes.');
    });
    test('SQL-looking notes are safely stored as literal text, never executed', async () => {
        const notes = "Patrol near O'Brien; '); DROP TABLE users; --";
        const response = await request(app).patch(`/api/incidents/${theftId}/patrol-details`).set(auth('executive')).send({ patrol_notes: notes });
        expect(response.status).toBe(200);
        expect((await request(app).get(`/api/incidents/${theftId}`).set(auth('executive'))).body.patrol_notes).toBe(notes);
        expect(Number((await pool.query('SELECT COUNT(*) AS total FROM users'))[0][0].total)).toBeGreaterThan(0);
    });
    test.each(['leader','viewer'])('%s cannot change map records, add tanods, or schedule patrols', async role => {
        expect((await request(app).patch(`/api/incidents/${theftId}/patrol-details`).set(auth(role)).send({ patrol_notes: 'unauthorized' })).status).toBe(403);
        expect((await request(app).post('/api/tanods').set(auth(role)).send({ name: 'Unauthorized Tanod' })).status).toBe(403);
        expect((await request(app).post('/api/patrol-schedules').set(auth(role)).send({})).status).toBe(403);
    });
    test('legacy officer can edit notes and exact address through the same endpoint', async () => {
        const response = await request(app).patch(`/api/incidents/${theftId}/patrol-details`).set(auth('legacy')).send({ address: 'House 19, Block 8, Balite Street', patrol_notes: 'Use the north gate.' });
        expect(response.status).toBe(200);
        const detail = await request(app).get(`/api/incidents/${theftId}`).set(auth('legacy'));
        expect(detail.body.address).toBe('House 19, Block 8, Balite Street');
    });
    test('notes entered during encoding are shared by the form and map detail', async () => {
        const id = await createRecord('Theft', 'crime', { patrol_notes: 'Watch the side gate.', patrol_override: 'include' });
        const detail = await request(app).get(`/api/incidents/${id}`).set(auth('executive'));
        expect(detail.body.patrol_notes).toBe('Watch the side gate.');
        expect(detail.body.address).toBe('House 7, Block 2, Balite Street');
        expect((await request(app).put(`/api/incidents/${id}`).set(auth('leader')).send({})).status).toBe(403);
    });
    test('excluded type requires a manual schedule decision; tanods and record linkage persist', async () => {
        const tanod = await request(app).post('/api/tanods').set(auth('executive')).send({ name: 'QA Tanod One' });
        expect(tanod.status).toBe(201); tanodIds.push(tanod.body.id);
        const prefill = await request(app).get(`/api/incidents/${scamId}/patrol-prefill`).set(auth('executive'));
        expect(prefill.status).toBe(200);
        expect(prefill.body.record.eligible).toBe(false);
        const day = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
        const payload = { incident_id: scamId, location: 'Balite Street', start_time: '20:00', end_time: '23:59', day_of_week: day,
            scheduled_date: today, tanod_ids: [tanod.body.id], reason: 'Manual visibility follow-up', latitude: 0, longitude: 0 };
        expect((await request(app).post('/api/patrol-schedules').set(auth('executive')).send(payload)).status).toBe(409);
        const created = await request(app).post('/api/patrol-schedules').set(auth('executive')).send({ ...payload, manual_patrol: true });
        expect(created.status).toBe(201); scheduleIds.push(created.body.schedule.id);
        expect(created.body.schedule.incident_id).toBe(scamId);
        expect(Number(created.body.schedule.latitude)).toBe(14.75);
        expect(created.body.schedule.tanod_ids).toEqual([tanod.body.id]);
        const detail = await request(app).get(`/api/incidents/${scamId}`).set(auth('executive'));
        expect(detail.body.patrol_override).toBe('include');
        expect(detail.body.linked_patrols[0].assigned_tanods).toBe('QA Tanod One');
        const map = await request(app).get('/api/heatmap/records').set(auth('executive'));
        expect(map.body.records.find(row => row.id === scamId).active_patrol_count).toBe(1);
    });
    test('archiving/restoring preserves notes, tanod assignments, and schedule links', async () => {
        const id = scheduleIds[0];
        await request(app).patch(`/api/incidents/${scamId}/patrol-details`).set(auth('executive')).send({ patrol_notes: 'Keep this note after archive.' });
        expect((await request(app).delete(`/api/patrol-schedules/${id}`).set(auth('executive'))).status).toBe(200);
        const [schedules] = await pool.query("SELECT id FROM archived_records WHERE entity_type='patrol_schedule' AND entity_id=? ORDER BY id DESC", [id]);
        expect((await request(app).post(`/api/archive/${schedules[0].id}/restore`).set(auth('executive'))).status).toBe(200);
        const restored = await request(app).get(`/api/patrol-schedules/${id}`).set(auth('executive'));
        expect(restored.body.tanod_ids).toEqual(tanodIds);
        expect(restored.body.incident_id).toBe(scamId);
        expect((await request(app).delete(`/api/incidents/${scamId}`).set(auth('executive'))).status).toBe(200);
        const [records] = await pool.query("SELECT id FROM archived_records WHERE entity_type='incident' AND entity_id=? ORDER BY id DESC", [scamId]);
        expect((await request(app).post(`/api/archive/${records[0].id}/restore`).set(auth('executive'))).status).toBe(200);
        const detail = await request(app).get(`/api/incidents/${scamId}`).set(auth('executive'));
        expect(detail.body.patrol_notes).toBe('Keep this note after archive.');
        expect(detail.body.linked_patrols[0].id).toBe(id);
    });
    test('a linked patrol can be closed after its incident is resolved', async () => {
        expect((await request(app).patch(`/api/incidents/${scamId}/patrol-details`).set(auth('executive')).send({ status: 'Resolved' })).status).toBe(200);
        const schedule = (await request(app).get(`/api/patrol-schedules/${scheduleIds[0]}`).set(auth('executive'))).body;
        const response = await request(app).put(`/api/patrol-schedules/${schedule.id}`).set(auth('executive')).send({
            incident_id: scamId, location: schedule.location, start_time: schedule.start_time.slice(0,5),
            end_time: schedule.end_time.slice(0,5), day_of_week: schedule.day_of_week,
            scheduled_date: schedule.scheduled_date, status: 'Completed', tanod_ids: schedule.tanod_ids
        });
        expect(response.status).toBe(200);
    });
    test('resolution removes active contribution while retaining historical CART assessment', async () => {
        expect((await request(app).patch(`/api/incidents/${theftId}/patrol-details`).set(auth('executive')).send({ status: 'Resolved', patrol_override: 'include' })).status).toBe(200);
        const map = await request(app).get('/api/heatmap/records').set(auth('executive'));
        expect(map.body.records.some(row => row.id === theftId)).toBe(false);
        expect((await pool.query('SELECT total_risk_score FROM cart_risk_factors WHERE incident_id=?', [theftId]))[0]).toHaveLength(1);
        expect((await request(app).get(`/api/incidents/${theftId}/patrol-prefill`).set(auth('executive'))).status).toBe(409);
    });
});
