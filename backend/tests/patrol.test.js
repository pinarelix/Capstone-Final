const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

// Patrol Schedules + Patrol Logs had zero test coverage before this file -
// these are the two tables behind the system's actual title feature
// ("Patrol Decision Support"), so correctness here matters more than most.
describe('Patrol Schedules + Patrol Logs CRUD + role enforcement', () => {
    const adminUsername = 'test_admin_patrol';
    const dmUsername = 'test_dm_patrol';
    const deskUsername = 'test_desk_patrol';
    const password = 'testpass123';
    let adminToken, dmToken, deskToken;
    let tanodId;
    let createdScheduleId;
    let createdLogId;

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Administrator', 1)`,
            ['Test Admin Patrol', adminUsername, hash]
        );
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Decision-Maker', 1)`,
            ['Test DM Patrol', dmUsername, hash]
        );
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Desk Officer', 1)`,
            ['Test Desk Patrol', deskUsername, hash]
        );

        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;
        const dmLogin = await request(app).post('/api/auth/login').send({ username: dmUsername, password });
        dmToken = dmLogin.body.session_token;
        const deskLogin = await request(app).post('/api/auth/login').send({ username: deskUsername, password });
        deskToken = deskLogin.body.session_token;

        const pinHash = await bcrypt.hash('5566', 10);
        const [tanodResult] = await pool.query(
            `INSERT INTO tanod_record (name, position, username, pin_code_hash, is_active) VALUES (?, 'Tanod', ?, ?, 1)`,
            ['Test Patrol Tanod', 'test_patrol_tanod', pinHash]
        );
        tanodId = tanodResult.insertId;
    });

    afterEach(async () => {
        if (createdLogId) {
            await pool.query('DELETE FROM patrol_logs WHERE id = ?', [createdLogId]);
            createdLogId = null;
        }
        if (createdScheduleId) {
            await pool.query('DELETE FROM patrol_schedule_tanods WHERE schedule_id = ?', [createdScheduleId]);
            await pool.query('DELETE FROM patrol_schedules WHERE id = ?', [createdScheduleId]);
            createdScheduleId = null;
        }
        await pool.query('DELETE FROM tanod_record WHERE id = ?', [tanodId]);
        const usernames = [adminUsername, dmUsername, deskUsername];
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?, ?))', usernames);
        await pool.query('DELETE FROM login_history WHERE username IN (?, ?, ?)', usernames);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?, ?))', usernames);
        await pool.query('DELETE FROM login_attempts WHERE username IN (?, ?, ?)', usernames);
        await pool.query('DELETE FROM users WHERE username IN (?, ?, ?)', usernames);
    });

    const validSchedulePayload = () => ({
        location: 'Balite Street',
        start_time: '20:00',
        end_time: '22:00',
        day_of_week: 'Monday',
        tanod_ids: [],
        reason: 'created by an automated test'
    });

    test('Administrator can create a patrol schedule with a real tanod assigned', async () => {
        const res = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validSchedulePayload(), tanod_ids: [tanodId] });

        expect(res.status).toBe(201);
        expect(res.body.schedule.assigned_tanods).toBe(1);
        createdScheduleId = res.body.schedule.id;

        const getRes = await request(app)
            .get(`/api/patrol-schedules/${createdScheduleId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(getRes.body.tanod_ids).toEqual([tanodId]);
    });

    test('an unknown/inactive tanod id is rejected with 400, not a raw FK error', async () => {
        const res = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validSchedulePayload(), tanod_ids: [999999] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Unknown or inactive tanod/);
    });

    // Schedule create/update is Administrator + Desk Officer only (db54b1b);
    // the Captain's Patrol page has no schedule form.
    test('Decision-Maker (Captain) cannot create or update a schedule', async () => {
        const dmCreateRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${dmToken}`)
            .send(validSchedulePayload());
        expect(dmCreateRes.status).toBe(403);

        const createRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validSchedulePayload());
        createdScheduleId = createRes.body.schedule.id;

        const updateRes = await request(app)
            .put(`/api/patrol-schedules/${createdScheduleId}`)
            .set('Authorization', `Bearer ${dmToken}`)
            .send({ ...validSchedulePayload(), reason: 'updated by DM' });
        expect(updateRes.status).toBe(403);
    });

    test('Desk Officer can create and update a schedule', async () => {
        const createRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${deskToken}`)
            .send(validSchedulePayload());
        expect(createRes.status).toBe(201);
        createdScheduleId = createRes.body.schedule.id;

        const updateRes = await request(app)
            .put(`/api/patrol-schedules/${createdScheduleId}`)
            .set('Authorization', `Bearer ${deskToken}`)
            .send({ ...validSchedulePayload(), reason: 'updated by Desk Officer' });
        expect(updateRes.status).toBe(200);
    });

    test('Decision-Maker cannot delete a schedule (Administrator-only route)', async () => {
        const createRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validSchedulePayload());
        createdScheduleId = createRes.body.schedule.id;

        const deleteRes = await request(app)
            .delete(`/api/patrol-schedules/${createdScheduleId}`)
            .set('Authorization', `Bearer ${dmToken}`);
        expect(deleteRes.status).toBe(403);
    });

    test('completing a schedule triggers area risk decay exactly once (not on every re-save)', async () => {
        const createRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validSchedulePayload());
        createdScheduleId = createRes.body.schedule.id;

        await pool.query('DELETE FROM area_risk_decay WHERE location = ?', ['Balite Street']);

        const completeRes = await request(app)
            .put(`/api/patrol-schedules/${createdScheduleId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validSchedulePayload(), status: 'Completed' });
        expect(completeRes.status).toBe(200);

        const [decayRows] = await pool.query('SELECT decay_amount FROM area_risk_decay WHERE location = ?', ['Balite Street']);
        expect(decayRows.length).toBe(1);
        const firstDecay = parseFloat(decayRows[0].decay_amount);
        expect(firstDecay).toBeGreaterThan(0);

        // Re-saving an already-Completed schedule must not decay it again.
        const resaveRes = await request(app)
            .put(`/api/patrol-schedules/${createdScheduleId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validSchedulePayload(), status: 'Completed', reason: 'resaved' });
        expect(resaveRes.status).toBe(200);

        const [decayRowsAfter] = await pool.query('SELECT decay_amount FROM area_risk_decay WHERE location = ?', ['Balite Street']);
        expect(parseFloat(decayRowsAfter[0].decay_amount)).toBe(firstDecay);

        await pool.query('DELETE FROM area_risk_decay WHERE location = ?', ['Balite Street']);
    });

    test('a request with no token is rejected with 401', async () => {
        const res = await request(app).get('/api/patrol-schedules');
        expect(res.status).toBe(401);
    });

    // ------------------------------------------------------------
    // Patrol Logs
    // ------------------------------------------------------------

    test('Desk Officer can create a patrol log against a real schedule and tanod', async () => {
        const scheduleRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validSchedulePayload(), tanod_ids: [tanodId] });
        createdScheduleId = scheduleRes.body.schedule.id;

        const logRes = await request(app)
            .post('/api/patrol-logs')
            .set('Authorization', `Bearer ${deskToken}`)
            .send({
                schedule_id: createdScheduleId,
                tanod_id: tanodId,
                report: 'created by an automated test',
                status: 'Completed',
                patrol_date: '2026-01-20'
            });

        expect(logRes.status).toBe(201);
        expect(logRes.body.log.tanod_name).toBe('Test Patrol Tanod');
        createdLogId = logRes.body.log.id;
    });

    // The Captain's Patrol page has no log form, so the API rejects it too.
    test('Decision-Maker (Captain) cannot create a patrol log', async () => {
        const scheduleRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validSchedulePayload(), tanod_ids: [tanodId] });
        createdScheduleId = scheduleRes.body.schedule.id;

        const logRes = await request(app)
            .post('/api/patrol-logs')
            .set('Authorization', `Bearer ${dmToken}`)
            .send({
                schedule_id: createdScheduleId,
                tanod_id: tanodId,
                report: 'should be rejected',
                status: 'Completed',
                patrol_date: '2026-01-20'
            });

        expect(logRes.status).toBe(403);
    });

    test('Desk Officer cannot edit or delete a patrol log (Administrator-only routes)', async () => {
        const scheduleRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validSchedulePayload(), tanod_ids: [tanodId] });
        createdScheduleId = scheduleRes.body.schedule.id;

        const logRes = await request(app)
            .post('/api/patrol-logs')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ schedule_id: createdScheduleId, tanod_id: tanodId, status: 'Completed', patrol_date: '2026-01-20' });
        createdLogId = logRes.body.log.id;

        const editRes = await request(app)
            .put(`/api/patrol-logs/${createdLogId}`)
            .set('Authorization', `Bearer ${deskToken}`)
            .send({ schedule_id: createdScheduleId, tanod_id: tanodId, status: 'Partial', patrol_date: '2026-01-20' });
        expect(editRes.status).toBe(403);

        const deleteRes = await request(app)
            .delete(`/api/patrol-logs/${createdLogId}`)
            .set('Authorization', `Bearer ${deskToken}`);
        expect(deleteRes.status).toBe(403);
    });

    test('missing a required log field is rejected with 400', async () => {
        const res = await request(app)
            .post('/api/patrol-logs')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ tanod_id: tanodId, status: 'Completed', patrol_date: '2026-01-20' });
        expect(res.status).toBe(400);
    });
});

afterAll(async () => {
    await pool.end();
});
