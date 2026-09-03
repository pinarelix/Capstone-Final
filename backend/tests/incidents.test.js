const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

describe('Incident CRUD + role enforcement', () => {
    const adminUsername = 'test_admin_incidents';
    const dmUsername = 'test_dm_incidents';
    const password = 'testpass123';
    let adminToken;
    let dmToken;
    let createdIncidentId;

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Administrator', 1)`,
            ['Test Admin', adminUsername, hash]
        );
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Decision-Maker', 1)`,
            ['Test Decision-Maker', dmUsername, hash]
        );

        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;

        const dmLogin = await request(app).post('/api/auth/login').send({ username: dmUsername, password });
        dmToken = dmLogin.body.session_token;
    });

    afterEach(async () => {
        if (createdIncidentId) {
            await pool.query('DELETE FROM cart_risk_factors WHERE incident_id = ?', [createdIncidentId]);
            await pool.query('DELETE FROM incidents WHERE id = ?', [createdIncidentId]);
            createdIncidentId = null;
        }
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', [adminUsername, dmUsername]);
        await pool.query('DELETE FROM login_history WHERE username IN (?, ?)', [adminUsername, dmUsername]);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', [adminUsername, dmUsername]);
        await pool.query('DELETE FROM login_attempts WHERE username IN (?, ?)', [adminUsername, dmUsername]);
        await pool.query('DELETE FROM users WHERE username IN (?, ?)', [adminUsername, dmUsername]);
    });

    const validIncidentPayload = {
        incident_type: 'Theft',
        date: '2026-01-15',
        time: '14:30',
        latitude: 14.75,
        longitude: 121.07,
        street_name: 'Balite Street',
        status: 'Open',
        description: 'created by an automated test'
    };

    test('Administrator can create an incident, and it appears in the list', async () => {
        const createRes = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(validIncidentPayload);

        expect(createRes.status).toBe(201);
        createdIncidentId = createRes.body.id;

        const listRes = await request(app)
            .get('/api/incidents')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(listRes.status).toBe(200);
        expect(listRes.body.incidents.some(i => i.id === createdIncidentId)).toBe(true);
    });

    test('Decision-Maker cannot create an incident (Administrator-only route)', async () => {
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

    test('Administrator can update and then delete an incident', async () => {
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

        createdIncidentId = null; // already deleted, nothing left for afterEach to clean up
    });

    test('a request with no token is rejected with 401', async () => {
        const res = await request(app).get('/api/incidents');
        expect(res.status).toBe(401);
    });
});

afterAll(async () => {
    await pool.end();
});
