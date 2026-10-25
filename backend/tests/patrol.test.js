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
    let createdTeamId;
    const createdTanodIds = [];
    const createdVolunteerIds = [];

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
        if (createdTeamId) {
            await pool.query('DELETE FROM patrol_teams WHERE id = ?', [createdTeamId]);
            createdTeamId = null;
        }
        if (createdTanodIds.length) {
            await pool.query('DELETE FROM tanods WHERE id IN (?)', [createdTanodIds.splice(0)]);
        }
        if (createdVolunteerIds.length) {
            await pool.query('DELETE FROM patrol_volunteers WHERE id IN (?)', [createdVolunteerIds.splice(0)]);
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
        team_name: 'Night Patrol Team A',
        reason: 'created by an automated test'
    });

    test('Deputy Officer can create a patrol schedule', async () => {
        const res = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validSchedulePayload());

        expect(res.status).toBe(201);
        expect(res.body.schedule.location).toBe('Balite Street');
        expect(res.body.schedule.team_name).toBe('Night Patrol Team A');
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

    test('Team Leader cannot create attendance or completion logs', async () => {
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

        expect(logRes.status).toBe(403);
    });

    test('Executive Officer can create a patrol log against a real schedule', async () => {
        const scheduleRes = await request(app)
            .post('/api/patrol-schedules')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validSchedulePayload());
        createdScheduleId = scheduleRes.body.schedule.id;

        const logRes = await request(app)
            .post('/api/patrol-logs')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ schedule_id: createdScheduleId, report: 'created by an automated test', status: 'Completed', patrol_date: '2026-01-20' });

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

    test('Tanod and volunteer roster CRUD, four-person teams, route schedules, attendance, and analytics work together', async () => {
        const leader = (await pool.query('SELECT id FROM users WHERE username=?', [deskUsername]))[0][0];
        const tanodResponse = await request(app).post('/api/tanods').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Fixture Tanod One', contact_no: '09170000001', address: '1 Balite Street', birth_date: '1990-01-01' });
        const volunteerResponse = await request(app).post('/api/volunteers').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Fixture Volunteer One', contact_no: '09170000002', address: '2 Balite Street', birth_date: '1991-02-02' });
        expect(tanodResponse.status).toBe(201);
        expect(volunteerResponse.status).toBe(201);
        createdTanodIds.push(tanodResponse.body.id);
        createdVolunteerIds.push(volunteerResponse.body.id);

        const teamResponse = await request(app).post('/api/patrol-teams').set('Authorization', `Bearer ${adminToken}`).send({
            name: 'Fixture Mixed Team', leader_user_id: leader.id,
            assignments: [
                { person_type: 'Tanod', person_id: tanodResponse.body.id, assignment_type: 'Primary' },
                { person_type: 'Volunteer', person_id: volunteerResponse.body.id, assignment_type: 'Temporary', starts_on: '2026-01-19', ends_on: '2026-01-31' }
            ]
        });
        expect(teamResponse.status).toBe(201);
        createdTeamId = teamResponse.body.id;
        const teams = await request(app).get('/api/patrol-teams').set('Authorization', `Bearer ${adminToken}`);
        const team = teams.body.find(item => item.id === createdTeamId);
        expect(team.assignments).toEqual(expect.arrayContaining([
            expect.objectContaining({ person_type: 'Tanod', assignment_type: 'Primary' }),
            expect.objectContaining({ person_type: 'Volunteer', assignment_type: 'Temporary' })
        ]));

        const tooMany = await request(app).post('/api/patrol-teams').set('Authorization', `Bearer ${adminToken}`).send({
            name: 'Too Many Members', leader_user_id: leader.id,
            assignments: [1, 2, 3, 4, 5].map(person_id => ({ person_type: 'Tanod', person_id }))
        });
        expect(tooMany.status).toBe(400);

        const scheduleResponse = await request(app).post('/api/patrol-schedules').set('Authorization', `Bearer ${adminToken}`).send({
            ...validSchedulePayload(), location: '', scheduled_date: '2026-01-19', day_of_week: 'Monday',
            routine_type: 'Multi-location Route', route_name: 'Fixture route',
            route_stops: [{ stop_order: 1, location: 'Balite Street', address: '1 Balite Street' }, { stop_order: 2, location: 'Balite Street', address: '2 Balite Street' }],
            personnel: [{ person_type: 'Tanod', person_id: tanodResponse.body.id, assignment_type: 'Primary' }, { person_type: 'Volunteer', person_id: volunteerResponse.body.id, assignment_type: 'Temporary' }],
            tanod_ids: [tanodResponse.body.id]
        });
        expect(scheduleResponse.status).toBe(201);
        createdScheduleId = scheduleResponse.body.schedule.id;
        expect(scheduleResponse.body.schedule.route_stops).toHaveLength(2);
        expect(scheduleResponse.body.schedule.personnel).toHaveLength(2);

        const logResponse = await request(app).post('/api/patrol-logs').set('Authorization', `Bearer ${adminToken}`).send({
            schedule_id: createdScheduleId, report: 'mixed roster completed', status: 'Completed', patrol_date: '2026-01-19',
            attendance: [{ person_type: 'Tanod', person_id: tanodResponse.body.id, attendance_status: 'Present' }]
        });
        expect(logResponse.status).toBe(201);
        createdLogId = logResponse.body.log.id;
        const logDetails = await request(app).get(`/api/patrol-logs/${createdLogId}`).set('Authorization', `Bearer ${adminToken}`);
        expect(logDetails.body.attendance).toEqual(expect.arrayContaining([
            expect.objectContaining({ person_type: 'Tanod', attendance_status: 'Present' }),
            expect.objectContaining({ person_type: 'Volunteer', attendance_status: 'Absent' })
        ]));

        const analytics = await request(app).get('/api/patrol-analytics?days=366').set('Authorization', `Bearer ${adminToken}`);
        expect(analytics.status).toBe(200);
        expect(analytics.body.summary).toHaveProperty('scheduled');
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
