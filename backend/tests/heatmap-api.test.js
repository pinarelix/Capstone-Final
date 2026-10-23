const request = require('supertest');
const { app, pool } = require('../server');

describe('Map API authentication', () => {
    afterAll(async () => { await pool.end(); });
    test.each(['/api/heatmap/config', '/api/heatmap/records', '/api/heatmap/incidents', '/api/heatmap/street-analysis'])(
        '%s requires authentication', async path => {
            expect((await request(app).get(path)).status).toBe(401);
        }
    );
});
