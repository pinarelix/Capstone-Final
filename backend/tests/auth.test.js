const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

describe('Deputy Officer login', () => {
    const username = 'test_admin_auth';
    const password = 'testpass123';

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Deputy Officer', 1)`,
            ['Test Admin', username, hash]
        );
    });

    afterEach(async () => {
        await pool.query('DELETE FROM login_attempts WHERE username = ?', [username]);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [username]);
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [username]);
        await pool.query('DELETE FROM login_history WHERE username = ?', [username]);
        await pool.query('DELETE FROM users WHERE username = ?', [username]);
    });

    test('correct credentials succeed and return a session token', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ username, password });

        expect(res.status).toBe(200);
        expect(res.body.session_token).toBeTruthy();
        expect(res.body.user.username).toBe(username);
    });

    test('wrong password is rejected', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ username, password: 'wrongpassword' });

        expect(res.status).toBe(401);
    });

    test('5 failed attempts lock the account, even against the correct password on the 6th try', async () => {
        for (let i = 0; i < 5; i++) {
            await request(app).post('/api/auth/login').send({ username, password: 'wrongpassword' });
        }

        const res = await request(app).post('/api/auth/login').send({ username, password });

        expect(res.status).toBe(429);
        expect(res.body.locked).toBe(true);
    });
});

afterAll(async () => {
    await pool.end();
});
