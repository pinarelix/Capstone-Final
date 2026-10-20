const request = require('supertest');
const { app, pool } = require('../server');

// Live Server-Sent Events push to staff when a new incident is reported.
// The actual open-stream-and-receive-a-push path isn't exercised here -
// supertest waits for a response to fully end before resolving, and
// /api/notifications/stream never ends on its own (it stays open until
// the client disconnects), so a real streaming assertion would hang the
// test runner. What IS covered: the auth rejection paths, which return a
// normal completed response before the handler ever starts streaming.
describe('Live notifications (SSE) - auth boundary', () => {
    test('no token in the query string is rejected with 401', async () => {
        const res = await request(app).get('/api/notifications/stream');
        expect(res.status).toBe(401);
    });

    test('an invalid/made-up token is rejected with 401', async () => {
        const res = await request(app).get('/api/notifications/stream').query({ token: 'not-a-real-token' });
        expect(res.status).toBe(401);
    });
});

afterAll(async () => {
    await pool.end();
});
