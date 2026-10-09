const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

// Regression coverage for the ownership-isolation guard added in the
// original Tanod Interface build (requireOwnTanodId in server.js) —
// previously only ever verified by hand.
describe('Tanod session ownership isolation', () => {
    const usernameA = 'test_tanod_a';
    const usernameB = 'test_tanod_b';
    const pin = '1122';
    let tanodAId, tanodBId, tokenA;

    beforeEach(async () => {
        const hash = await bcrypt.hash(pin, 10);

        const [resultA] = await pool.query(
            `INSERT INTO tanod_record (name, position, username, pin_code_hash, is_active) VALUES (?, 'Tanod', ?, ?, 1)`,
            ['Test Tanod A', usernameA, hash]
        );
        tanodAId = resultA.insertId;

        const [resultB] = await pool.query(
            `INSERT INTO tanod_record (name, position, username, pin_code_hash, is_active) VALUES (?, 'Tanod', ?, ?, 1)`,
            ['Test Tanod B', usernameB, hash]
        );
        tanodBId = resultB.insertId;

        const loginRes = await request(app).post('/api/tanod/login').send({ username: usernameA, pin_code: pin });
        tokenA = loginRes.body.session_token;
    });

    afterEach(async () => {
        await pool.query('DELETE FROM tanod_audit_logs WHERE tanod_id IN (?, ?)', [tanodAId, tanodBId]);
        await pool.query('DELETE FROM tanod_sessions WHERE tanod_id IN (?, ?)', [tanodAId, tanodBId]);
        await pool.query('DELETE FROM tanod_login_attempts WHERE username IN (?, ?)', [usernameA, usernameB]);
        await pool.query('DELETE FROM tanod_record WHERE id IN (?, ?)', [tanodAId, tanodBId]);
    });

    test('a tanod can access their own dashboard', async () => {
        const res = await request(app)
            .get(`/api/tanod/dashboard/${tanodAId}`)
            .set('Authorization', `Bearer ${tokenA}`);

        expect(res.status).toBe(200);
        expect(res.body.id).toBe(tanodAId);
    });

    test("a tanod's token cannot access another tanod's dashboard", async () => {
        const res = await request(app)
            .get(`/api/tanod/dashboard/${tanodBId}`)
            .set('Authorization', `Bearer ${tokenA}`);

        expect(res.status).toBe(403);
    });

    test('an invalid session token is rejected with 401', async () => {
        const res = await request(app)
            .get(`/api/tanod/dashboard/${tanodAId}`)
            .set('Authorization', 'Bearer not-a-real-token');

        expect(res.status).toBe(401);
    });
});

// Regression coverage for the file-token identity scoping added to the
// /uploads gate - a tanod's token used to work for ANY file path (staff
// avatars, other tanods' photos, admin-attached incident evidence),
// since the token only ever encoded an expiry, never who it was issued to.
describe('/uploads file-token identity scoping', () => {
    const tanodUsername = 'test_tanod_files_a';
    const otherTanodUsername = 'test_tanod_files_b';
    const adminUsername = 'test_admin_files';
    const pin = '3344';
    const password = 'testpass123';
    let tanodId, otherTanodId, tanodToken, adminToken;

    beforeEach(async () => {
        const pinHash = await bcrypt.hash(pin, 10);
        const [resultA] = await pool.query(
            `INSERT INTO tanod_record (name, position, username, pin_code_hash, is_active) VALUES (?, 'Tanod', ?, ?, 1)`,
            ['Test Tanod Files A', tanodUsername, pinHash]
        );
        tanodId = resultA.insertId;

        const [resultB] = await pool.query(
            `INSERT INTO tanod_record (name, position, username, pin_code_hash, is_active) VALUES (?, 'Tanod', ?, ?, 1)`,
            ['Test Tanod Files B', otherTanodUsername, pinHash]
        );
        otherTanodId = resultB.insertId;

        const tanodLogin = await request(app).post('/api/tanod/login').send({ username: tanodUsername, pin_code: pin });
        tanodToken = tanodLogin.body.session_token;

        const passwordHash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Administrator', 1)`,
            ['Test Admin Files', adminUsername, passwordHash]
        );
        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;
    });

    afterEach(async () => {
        await pool.query('DELETE FROM tanod_audit_logs WHERE tanod_id IN (?, ?)', [tanodId, otherTanodId]);
        await pool.query('DELETE FROM tanod_sessions WHERE tanod_id IN (?, ?)', [tanodId, otherTanodId]);
        await pool.query('DELETE FROM tanod_login_attempts WHERE username IN (?, ?)', [tanodUsername, otherTanodUsername]);
        await pool.query('DELETE FROM tanod_record WHERE id IN (?, ?)', [tanodId, otherTanodId]);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [adminUsername]);
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [adminUsername]);
        await pool.query('DELETE FROM login_history WHERE username = ?', [adminUsername]);
        await pool.query('DELETE FROM login_attempts WHERE username = ?', [adminUsername]);
        await pool.query('DELETE FROM users WHERE username = ?', [adminUsername]);
    });

    async function getFileToken(token) {
        const res = await request(app).get('/api/uploads/file-token').set('Authorization', `Bearer ${token}`);
        return res.body.token;
    }

    test("a tanod's file-token can reach its own avatar path (not blocked by identity scoping)", async () => {
        const ftoken = await getFileToken(tanodToken);
        const res = await request(app).get(`/uploads/tanod-avatars/tanod-${tanodId}-whatever.jpg?ftoken=${ftoken}`);
        // The file doesn't actually exist on disk, so express.static 404s -
        // what matters is the identity gate let it through (not 401/403).
        expect(res.status).toBe(404);
    });

    test("a tanod's file-token cannot reach another tanod's avatar", async () => {
        const ftoken = await getFileToken(tanodToken);
        const res = await request(app).get(`/uploads/tanod-avatars/tanod-${otherTanodId}-whatever.jpg?ftoken=${ftoken}`);
        expect(res.status).toBe(403);
    });

    test("a tanod's file-token cannot reach admin-attached incident evidence at all", async () => {
        const ftoken = await getFileToken(tanodToken);
        const res = await request(app).get(`/uploads/incident-evidence/evidence-1-whatever.jpg?ftoken=${ftoken}`);
        expect(res.status).toBe(403);
    });

    test("a staff file-token can reach incident evidence (role-gated, not ownership-scoped)", async () => {
        const ftoken = await getFileToken(adminToken);
        const res = await request(app).get(`/uploads/incident-evidence/evidence-1-whatever.jpg?ftoken=${ftoken}`);
        expect(res.status).toBe(404); // same reasoning - file absent, but not forbidden
    });
});

afterAll(async () => {
    await pool.end();
});
