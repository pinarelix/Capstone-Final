const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

describe('Incident CRUD + role enforcement', () => {
    const adminUsername = 'test_admin_incidents';
    const dmUsername = 'test_dm_incidents';
    const password = 'testpass123';
    let adminToken;
    let adminUserId;
    let dmToken;
    let createdIncidentId;

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Deputy Officer', 1)`,
            ['Test Admin', adminUsername, hash]
        );
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Kagawad', 1)`,
            ['Test Decision-Maker', dmUsername, hash]
        );

        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;
        adminUserId = adminLogin.body.user.id;

        const dmLogin = await request(app).post('/api/auth/login').send({ username: dmUsername, password });
        dmToken = dmLogin.body.session_token;
    });

    afterEach(async () => {
        if (createdIncidentId) {
            await pool.query('DELETE FROM cart_risk_factors WHERE incident_id = ?', [createdIncidentId]);
            const [reg] = await pool.query('SELECT source, source_id FROM record_registry WHERE registry_id = ?', [createdIncidentId]);
            if (reg.length > 0) {
                const table = reg[0].source === 'incident' ? 'incident_records' : 'blotter_records';
                await pool.query(`DELETE FROM ${table} WHERE id = ?`, [reg[0].source_id]);
                await pool.query('DELETE FROM record_registry WHERE registry_id = ?', [createdIncidentId]);
            }
            createdIncidentId = null;
        }
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', [adminUsername, dmUsername]);
        await pool.query('DELETE FROM login_history WHERE username IN (?, ?)', [adminUsername, dmUsername]);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', [adminUsername, dmUsername]);
        await pool.query('DELETE FROM login_attempts WHERE username IN (?, ?)', [adminUsername, dmUsername]);
        await pool.query('DELETE FROM users WHERE username IN (?, ?)', [adminUsername, dmUsername]);
    });

    const validIncidentPayload = {
        form_type: 'crime',
        incident_type: 'Theft',
        date: '2026-01-15',
        time: '14:30',
        latitude: 14.75,
        longitude: 121.07,
        street_name: 'Balite Street',
        status: 'Open',
        description: 'created by an automated test',
        address: 'House 5, Balite Street',
        complainant_first: 'Test',
        complainant_last: 'Complainant',
        statement: 'Saw the incident happen',
        recommended_action: 'Scheduled patrol and monitoring',
        priority: 'Normal',
        severity: 'High'
    };

    const validBlotterPayload = {
        form_type: 'blotter',
        incident_type: 'Harassment',
        date: '2026-01-15',
        time: '10:00',
        latitude: 14.75,
        longitude: 121.07,
        street_name: 'Balite Street',
        status: 'Open',
        description: 'blotter test',
        complainant_first: 'Blotter',
        complainant_last: 'Reporter',
        respondent_first: 'Resp',
        respondent_last: 'Ondent',
        statement: 'Statement here',
        priority: 'Normal',
        severity: 'Medium'
    };

    test('Deputy Officer can create an incident, and it appears in the list', async () => {
        const createRes = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validIncidentPayload);

        expect(createRes.status).toBe(201);
        createdIncidentId = createRes.body.id;

        const listRes = await request(app)
            .get('/api/incidents?limit=200&include_resolved=1')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(listRes.status).toBe(200);
        expect(listRes.body.incidents.some(i => i.id === createdIncidentId)).toBe(true);
    });

    test('Kagawad cannot create an incident (Deputy Officer-only route)', async () => {
        const res = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${dmToken}`)
            .send(validIncidentPayload);

        expect(res.status).toBe(403);
    });

    test('missing a required field is rejected with 400', async () => {
        const { incident_type, ...incomplete } = validIncidentPayload;
        const res = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(incomplete);

        expect(res.status).toBe(400);
    });

    test('type catalog enforcement rejects cross-catalog types', async () => {
        const res = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validIncidentPayload, form_type: 'blotter', incident_type: 'Theft', respondent_first: 'X', respondent_last: 'Y' });

        expect(res.status).toBe(400);
    });

    test('Deputy Officer can update and then delete an incident', async () => {
        const createRes = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validIncidentPayload);
        createdIncidentId = createRes.body.id;

        const updateRes = await request(app)
            .put(`/api/incidents/${createdIncidentId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validIncidentPayload, status: 'Monitoring' });
        expect(updateRes.status).toBe(200);

        const deleteRes = await request(app)
            .delete(`/api/incidents/${createdIncidentId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(deleteRes.status).toBe(200);

        createdIncidentId = null;
    });

    test('a request with no token is rejected with 401', async () => {
        const res = await request(app).get('/api/incidents');
        expect(res.status).toBe(401);
    });

    test('reporter_id always follows the authenticated user, never the request body', async () => {
        const createRes = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validIncidentPayload, reporter_id: 999999 });
        expect(createRes.status).toBe(201);
        createdIncidentId = createRes.body.id;

        const afterCreate = await request(app)
            .get(`/api/incidents/${createdIncidentId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(afterCreate.body.reporter_id).toBe(adminUserId);

        const updateRes = await request(app)
            .put(`/api/incidents/${createdIncidentId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validIncidentPayload, reporter_id: 888888, status: 'Monitoring' });
        expect(updateRes.status).toBe(200);

        const afterUpdate = await request(app)
            .get(`/api/incidents/${createdIncidentId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(afterUpdate.body.reporter_id).toBe(adminUserId);
    });

    test('blotter requires respondent for non-draft', async () => {
        const { respondent_first, respondent_last, ...noResp } = validBlotterPayload;
        const res = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(noResp);
        expect(res.status).toBe(400);
    });

    test('draft blotter can be saved without respondent', async () => {
        const { respondent_first, respondent_last, ...noResp } = validBlotterPayload;
        const res = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...noResp, is_draft: true });
        expect(res.status).toBe(201);
        createdIncidentId = res.body.id;
    });

    test('form_type classification change on update is rejected', async () => {
        const createRes = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validIncidentPayload);
        createdIncidentId = createRes.body.id;

        const updateRes = await request(app)
            .put(`/api/incidents/${createdIncidentId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validIncidentPayload, form_type: 'blotter', status: 'Open' });
        expect(updateRes.status).toBe(400);
        expect(updateRes.body.error).toMatch(/classification/i);
    });

    test('drafts are excluded from the default incidents list', async () => {
        const draftRes = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...validIncidentPayload, is_draft: true });
        createdIncidentId = draftRes.body.id;

        const listRes = await request(app)
            .get('/api/incidents?limit=200')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(listRes.body.incidents.some(i => i.id === createdIncidentId)).toBe(false);
    });
});

afterAll(async () => {
    await pool.end();
});
