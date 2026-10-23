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
    let createdScheduleId;
    let createdLogId;

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Deputy Officer', 1)`,
            ['Test Admin Patrol', adminUsername, hash]
        );
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Kagawad', 1)`,
            ['Test DM Patrol', dmUsername, hash]
        );
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Team Leader', 1)`,
            ['Test Desk Patrol', deskUsername, hash]
        );

        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;
        const dmLogin = await request(app).post('/api/auth/login').send({ username: dmUsername, password });
        dmToken = dmLogin.body.session_token;
        const deskLogin = await request(app).post('/api/auth/login').send({ username: deskUsername, password });
        deskToken = deskLogin.body.session_token;
    });

    afterEach(async () => {
        if (createdLogId) {
            await pool.query('DELETE FROM patrol_logs WHERE id = ?', [createdLogId]);
            createdLogId = null;
        }
        if (createdScheduleId) {
            await pool.query('DELETE FROM patrol_schedules WHERE id = ?', [createdScheduleId]);
            createdScheduleId = null;
        }
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
        reason: 'created by an automated test'
    });

    test('Deputy Officer can create a patrol schedule', async () => {
        const res = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validSchedulePayload());

        expect(res.status).toBe(201);
        expect(res.body.schedule.location).toBe('Balite Street');
        createdScheduleId = res.body.schedule.id;

        const getRes = await request(app)
            .get(`/api/patrol-schedules/${createdScheduleId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(getRes.body.id).toBe(createdScheduleId);
        expect(getRes.body.location).toBe('Balite Street');
    });

    // Schedule create/update is Deputy Officer + Team Leader only (db54b1b);
    // the Kagawad's Patrol page has no schedule form.
    test('Kagawad cannot create or update a schedule', async () => {
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

    test('Team Leader cannot create or update a schedule', async () => {
        const createRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${deskToken}`)
            .send(validSchedulePayload());
        expect(createRes.status).toBe(403);
        const adminCreate = await request(app).post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`).send(validSchedulePayload());
        createdScheduleId = adminCreate.body.schedule.id;

        const updateRes = await request(app)
            .put(`/api/patrol-schedules/${createdScheduleId}`)
            .set('Authorization', `Bearer ${deskToken}`)
            .send({ ...validSchedulePayload(), reason: 'updated by Team Leader' });
        expect(updateRes.status).toBe(403);
    });

    test('Kagawad cannot delete a schedule (Deputy Officer-only route)', async () => {
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

    test('Team Leader can create a patrol log against a real schedule', async () => {
        const scheduleRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validSchedulePayload());
        createdScheduleId = scheduleRes.body.schedule.id;

        const logRes = await request(app)
            .post('/api/patrol-logs')
            .set('Authorization', `Bearer ${deskToken}`)
            .send({
                schedule_id: createdScheduleId,
                report: 'created by an automated test',
                status: 'Completed',
                patrol_date: '2026-01-20'
            });

        expect(logRes.status).toBe(201);
        expect(logRes.body.log.report).toBe('created by an automated test');
        createdLogId = logRes.body.log.id;
    });

    // The Kagawad's Patrol page has no log form, so the API rejects it too.
    test('Kagawad cannot create a patrol log', async () => {
        const scheduleRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validSchedulePayload());
        createdScheduleId = scheduleRes.body.schedule.id;

        const logRes = await request(app)
            .post('/api/patrol-logs')
            .set('Authorization', `Bearer ${dmToken}`)
            .send({
                schedule_id: createdScheduleId,
                report: 'should be rejected',
                status: 'Completed',
                patrol_date: '2026-01-20'
            });

        expect(logRes.status).toBe(403);
    });

    test('Team Leader cannot edit or delete a patrol log (Deputy Officer-only routes)', async () => {
        const scheduleRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validSchedulePayload());
        createdScheduleId = scheduleRes.body.schedule.id;

        const logRes = await request(app)
            .post('/api/patrol-logs')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ schedule_id: createdScheduleId, status: 'Completed', patrol_date: '2026-01-20' });
        createdLogId = logRes.body.log.id;

        const editRes = await request(app)
            .put(`/api/patrol-logs/${createdLogId}`)
            .set('Authorization', `Bearer ${deskToken}`)
            .send({ schedule_id: createdScheduleId, status: 'Partial', patrol_date: '2026-01-20' });
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
            .send({ status: 'Completed', patrol_date: '2026-01-20' });
        expect(res.status).toBe(400);
    });
});

afterAll(async () => {
    await pool.end();
});
