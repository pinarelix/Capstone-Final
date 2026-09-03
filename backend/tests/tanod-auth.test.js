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

afterAll(async () => {
    await pool.end();
});
