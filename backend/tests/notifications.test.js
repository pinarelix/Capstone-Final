const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

// Live Server-Sent Events push to staff when a tanod reports a new
// incident. The actual open-stream-and-receive-a-push path isn't
// exercised here - supertest waits for a response to fully end before
// resolving, and /api/notifications/stream never ends on its own (it
// stays open until the client disconnects), so a real streaming
// assertion would hang the test runner. What IS covered: the auth
// rejection paths, which return a normal completed response before the
// handler ever starts streaming, and that reporting an incident still
// succeeds when the broadcast has zero connected listeners.
describe('Live notifications (SSE) - auth boundary', () => {
    const adminUsername = 'test_admin_notif';
    const password = 'testpass123';
    const tanodUsername = 'test_tanod_notif';
    const pin = '7788';
    let adminToken, tanodToken, tanodId;

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Administrator', 1)`,
            ['Test Admin Notif', adminUsername, hash]
        );
        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;

        const pinHash = await bcrypt.hash(pin, 10);
        const [tanodResult] = await pool.query(
            `INSERT INTO tanod_record (name, position, username, pin_code_hash, is_active) VALUES (?, 'Tanod', ?, ?, 1)`,
            ['Test Tanod Notif', tanodUsername, pinHash]
        );
        tanodId = tanodResult.insertId;
        const tanodLogin = await request(app).post('/api/tanod/login').send({ username: tanodUsername, pin_code: pin });
        tanodToken = tanodLogin.body.session_token;
    });

    afterEach(async () => {
        await pool.query('DELETE FROM cart_risk_factors WHERE incident_id IN (SELECT id FROM incidents WHERE reporter_tanod_id = ?)', [tanodId]);
        await pool.query('DELETE FROM incidents WHERE reporter_tanod_id = ?', [tanodId]);
        await pool.query('DELETE FROM area_risk_decay WHERE location = ?', ['Rimas Street']);
        await pool.query('DELETE FROM tanod_audit_logs WHERE tanod_id = ?', [tanodId]);
        await pool.query('DELETE FROM tanod_sessions WHERE tanod_id = ?', [tanodId]);
        await pool.query('DELETE FROM tanod_login_attempts WHERE username = ?', [tanodUsername]);
        await pool.query('DELETE FROM tanod_record WHERE id = ?', [tanodId]);
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [adminUsername]);
        await pool.query('DELETE FROM login_history WHERE username = ?', [adminUsername]);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [adminUsername]);
        await pool.query('DELETE FROM login_attempts WHERE username = ?', [adminUsername]);
        await pool.query('DELETE FROM users WHERE username = ?', [adminUsername]);
    });

    test('no token in the query string is rejected with 401', async () => {
        const res = await request(app).get('/api/notifications/stream');
        expect(res.status).toBe(401);
    });

    test('a tanod session token is rejected (this stream is staff-only)', async () => {
        const res = await request(app).get('/api/notifications/stream').query({ token: tanodToken });
        expect(res.status).toBe(401);
    });

    test('an invalid/made-up token is rejected with 401', async () => {
        const res = await request(app).get('/api/notifications/stream').query({ token: 'not-a-real-token' });
        expect(res.status).toBe(401);
    });

    test('a tanod reporting a new incident still succeeds with zero connected listeners', async () => {
        const res = await request(app)
            .post('/api/tanod/incident')
            .set('Authorization', `Bearer ${tanodToken}`)
            .field('incident_type', 'Theft')
            .field('date', '2026-02-01')
            .field('time', '21:00')
            .field('location', 'Rimas Street');

        expect(res.status).toBe(201);
        expect(res.body.id).toBeTruthy();
    });
});

afterAll(async () => {
    await pool.end();
});
