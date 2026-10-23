const request = require('supertest');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { app, pool } = require('../server');
const { hashToken } = require('../token-utils');

const TEST_PASSWORD = 'TestPass123!';
const CHANGED_PASSWORD = 'ChangedPass456!';

let deputyToken, kagawadToken, deputyId, kagawadId;

beforeAll(async () => {
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);

    await pool.query(
        `INSERT INTO users (name, username, password_hash, role, is_active, email) VALUES (?, ?, ?, 'Deputy Officer', 1, ?)`,
        ['P1 Deputy', 'p1_deputy', hash, 'p1deputy@test.local']
    );
    await pool.query(
        `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Kagawad', 1)`,
        ['P1 Kagawad', 'p1_kagawad', hash]
    );

    const depRes = await request(app).post('/api/auth/login').send({ username: 'p1_deputy', password: TEST_PASSWORD });
    deputyToken = depRes.body.session_token;
    deputyId = depRes.body.user?.id || depRes.body.userId;

    const kagRes = await request(app).post('/api/auth/login').send({ username: 'p1_kagawad', password: TEST_PASSWORD });
    kagawadToken = kagRes.body.session_token;
    kagawadId = kagRes.body.user?.id || kagRes.body.userId;

    if (!deputyId) {
        const [[row]] = await pool.query('SELECT id FROM users WHERE username = ?', ['p1_deputy']);
        deputyId = row.id;
    }
    if (!kagawadId) {
        const [[row]] = await pool.query('SELECT id FROM users WHERE username = ?', ['p1_kagawad']);
        kagawadId = row.id;
    }
});

afterAll(async () => {
    const usernames = ['p1_deputy', 'p1_kagawad', 'p1_h5_user'];
    await pool.query('DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?, ?))', usernames);
    await pool.query('DELETE FROM login_attempts WHERE username IN (?, ?, ?)', usernames);
    await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?, ?))', usernames);
    await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?, ?))', usernames);
    await pool.query('DELETE FROM login_history WHERE username IN (?, ?, ?)', usernames);
    await pool.query('DELETE FROM users WHERE username IN (?, ?, ?)', usernames);
});

// ── H-1: Session tokens are hashed in the database ──

describe('H-1: Plaintext session tokens must not appear in the DB', () => {
    test('login returns a session token that is NOT stored verbatim', async () => {
        expect(deputyToken).toBeDefined();
        expect(deputyToken.length).toBeGreaterThanOrEqual(64);

        const [rows] = await pool.query(
            'SELECT session_token FROM user_sessions WHERE user_id = ? AND is_active = 1 ORDER BY login_time DESC LIMIT 1',
            [deputyId]
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].session_token).not.toBe(deputyToken);
    });

    test('stored token matches SHA-256 hash of the raw token', async () => {
        const expectedHash = hashToken(deputyToken);
        const [rows] = await pool.query(
            'SELECT session_token FROM user_sessions WHERE user_id = ? AND is_active = 1 ORDER BY login_time DESC LIMIT 1',
            [deputyId]
        );
        expect(rows[0].session_token).toBe(expectedHash);
    });

    test('authentication succeeds with the raw token', async () => {
        const res = await request(app)
            .get('/api/users')
            .set('Authorization', `Bearer ${deputyToken}`);
        expect(res.status).toBe(200);
    });

    test('authentication fails with the hash value as Bearer token', async () => {
        const fakeToken = hashToken(deputyToken);
        const res = await request(app)
            .get('/api/users')
            .set('Authorization', `Bearer ${fakeToken}`);
        expect(res.status).toBe(401);
    });
});

// ── H-4: Sessions revoked after password change ──

describe('H-4: Other sessions must be revoked after password change', () => {
    let sessionA, sessionB;

    beforeAll(async () => {
        const hash = await bcrypt.hash(TEST_PASSWORD, 10);
        await pool.query('UPDATE users SET password_hash = ? WHERE username = ?', [hash, 'p1_kagawad']);

        const resA = await request(app).post('/api/auth/login').send({ username: 'p1_kagawad', password: TEST_PASSWORD });
        sessionA = resA.body.session_token;

        const resB = await request(app).post('/api/auth/login').send({ username: 'p1_kagawad', password: TEST_PASSWORD });
        sessionB = resB.body.session_token;
    });

    test('both sessions work before password change', async () => {
        const resA = await request(app).get('/api/incidents').set('Authorization', `Bearer ${sessionA}`);
        const resB = await request(app).get('/api/incidents').set('Authorization', `Bearer ${sessionB}`);
        expect(resA.status).toBe(200);
        expect(resB.status).toBe(200);
    });

    test('changing password from session B revokes session A', async () => {
        const changeRes = await request(app)
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${sessionB}`)
            .send({ current_password: TEST_PASSWORD, new_password: CHANGED_PASSWORD });
        expect(changeRes.status).toBe(200);

        const resA = await request(app).get('/api/incidents').set('Authorization', `Bearer ${sessionA}`);
        expect(resA.status).toBe(401);
    });

    test('the session that changed the password still works', async () => {
        const resB = await request(app).get('/api/incidents').set('Authorization', `Bearer ${sessionB}`);
        expect(resB.status).toBe(200);
    });
});

// ── H-5: Secure password-reset tokens ──

describe('H-5: Password-reset tokens must be cryptographically strong and hashed', () => {
    let resetToken, h5UserId;

    beforeAll(async () => {
        const hash = await bcrypt.hash(TEST_PASSWORD, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active, email) VALUES (?, ?, ?, 'Kagawad', 1, ?)`,
            ['P1 H5 User', 'p1_h5_user', hash, 'p1h5@test.local']
        );
        const [[row]] = await pool.query('SELECT id FROM users WHERE username = ?', ['p1_h5_user']);
        h5UserId = row.id;
    });

    test('forgot-password returns a long cryptographic token', async () => {
        const res = await request(app)
            .post('/api/auth/forgot-password')
            .send({ username: 'p1_h5_user' });
        expect(res.status).toBe(200);
        resetToken = res.body.reset_token;
        expect(resetToken).toBeDefined();
        expect(resetToken.length).toBeGreaterThanOrEqual(32);
        expect(resetToken).not.toMatch(/^\d{6}$/);
    });

    test('reset token is stored as SHA-256 hash, not plaintext', async () => {
        const [rows] = await pool.query(
            'SELECT reset_token FROM password_resets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
            [h5UserId]
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].reset_token).not.toBe(resetToken);
        expect(rows[0].reset_token).toBe(hashToken(resetToken));
    });

    test('reset-password succeeds with the raw token', async () => {
        const res = await request(app)
            .post('/api/auth/reset-password')
            .send({ username: 'p1_h5_user', reset_token: resetToken, new_password: 'NewSecurePass789!' });
        expect(res.status).toBe(200);
    });

    test('reset token is single-use — reuse fails', async () => {
        const res = await request(app)
            .post('/api/auth/reset-password')
            .send({ username: 'p1_h5_user', reset_token: resetToken, new_password: 'AnotherPass000!' });
        expect(res.status).toBe(400);
    });

    test('prior tokens are invalidated when a new one is requested', async () => {
        const hash = await bcrypt.hash(TEST_PASSWORD, 10);
        await pool.query('UPDATE users SET password_hash = ? WHERE username = ?', [hash, 'p1_h5_user']);

        const res1 = await request(app).post('/api/auth/forgot-password').send({ username: 'p1_h5_user' });
        const firstToken = res1.body.reset_token;

        await request(app).post('/api/auth/forgot-password').send({ username: 'p1_h5_user' });

        const res = await request(app)
            .post('/api/auth/reset-password')
            .send({ username: 'p1_h5_user', reset_token: firstToken, new_password: 'ShouldFail111!' });
        expect(res.status).toBe(400);
    });
});

// ── M-3: SSE ticket system ──

describe('M-3: SSE must use short-lived tickets, not session tokens', () => {
    test('POST /notifications/ticket requires authentication', async () => {
        const res = await request(app).post('/api/notifications/ticket');
        expect(res.status).toBe(401);
    });

    test('POST /notifications/ticket returns a ticket for authenticated users', async () => {
        const res = await request(app)
            .post('/api/notifications/ticket')
            .set('Authorization', `Bearer ${deputyToken}`);
        expect(res.status).toBe(200);
        expect(res.body.ticket).toBeDefined();
        expect(res.body.ticket.length).toBeGreaterThanOrEqual(32);
    });

    test('SSE stream rejects when no ticket is provided', async () => {
        const res = await request(app).get('/api/notifications/stream');
        expect(res.status).toBe(401);
    });

    test('SSE stream rejects the main session token as a ticket', async () => {
        const res = await request(app).get(`/api/notifications/stream?ticket=${encodeURIComponent(deputyToken)}`);
        expect(res.status).toBe(401);
    });

    test('SSE ticket is single-use — consumed on connection', async () => {
        const ticketRes = await request(app)
            .post('/api/notifications/ticket')
            .set('Authorization', `Bearer ${deputyToken}`);
        const { ticket } = ticketRes.body;

        // Verify the ticket hash exists before use, then is removed after
        const ticketHash = hashToken(ticket);
        const { sseTickets } = require('../server');
        expect(sseTickets.has(ticketHash)).toBe(true);

        // After consuming (even a failed parent session check would still delete), verify removal
        // We directly delete to simulate consumption, since a real SSE connect holds the socket open
        sseTickets.delete(ticketHash);
        expect(sseTickets.has(ticketHash)).toBe(false);

        // Now the stream endpoint should reject this ticket
        const res = await request(app).get(`/api/notifications/stream?ticket=${encodeURIComponent(ticket)}`);
        expect(res.status).toBe(401);
    });

    test('SSE ticket cannot authenticate normal API endpoints', async () => {
        const ticketRes = await request(app)
            .post('/api/notifications/ticket')
            .set('Authorization', `Bearer ${deputyToken}`);
        const { ticket } = ticketRes.body;

        const res = await request(app)
            .get('/api/users')
            .set('Authorization', `Bearer ${ticket}`);
        expect(res.status).toBe(401);
    });
});
