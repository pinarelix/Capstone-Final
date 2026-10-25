const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

describe('Retired mediation scope and per-user navigation order', () => {
    const password = 'testpass123';
    const users = [
        { username: 'test_scope_admin', role: 'Executive Officer' },
        { username: 'test_scope_viewer', role: 'Kagawad' }
    ];

    beforeAll(async () => {
        const hash = await bcrypt.hash(password, 10);
        for (const user of users) {
            const [result] = await pool.query(
                'INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)',
                [user.username, user.username, hash, user.role]
            );
            user.id = result.insertId;
            const login = await request(app).post('/api/auth/login').send({ username: user.username, password });
            user.token = login.body.session_token;
        }
    });

    afterAll(async () => {
        const ids = users.map(user => user.id);
        const names = users.map(user => user.username);
        await pool.query('DELETE FROM user_navigation_preferences WHERE user_id IN (?)', [ids]);
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (?)', [ids]);
        await pool.query('DELETE FROM login_history WHERE user_id IN (?)', [ids]);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (?)', [ids]);
        await pool.query('DELETE FROM login_attempts WHERE username IN (?)', [names]);
        await pool.query('DELETE FROM users WHERE id IN (?)', [ids]);
        await pool.end();
    });

    test.each([
        ['get', '/api/me/mediation-tasks'],
        ['post', '/api/mediation-tasks']
    ])('mediation endpoint %s %s is retired', async (method, url) => {
        const response = await request(app)[method](url)
            .set('Authorization', `Bearer ${users[0].token}`)
            .send({});
        expect(response.status).toBe(410);
        expect(response.body.error).toMatch(/retired/i);
    });

    test('navigation order remains validated and isolated per account', async () => {
        const order = [
            'settings.html', 'users.html', 'report.html', 'patrol.html',
            'grid-heatmap.html', 'incident-view.html', 'incident.html', 'dashboard.html'
        ];
        const saved = await request(app).put('/api/me/navigation-order')
            .set('Authorization', `Bearer ${users[0].token}`).send({ order });
        expect(saved.status).toBe(200);

        const adminOrder = await request(app).get('/api/me/navigation-order')
            .set('Authorization', `Bearer ${users[0].token}`);
        expect(adminOrder.body.order).toEqual(order);

        const otherOrder = await request(app).get('/api/me/navigation-order')
            .set('Authorization', `Bearer ${users[1].token}`);
        expect(otherOrder.body.order).toEqual([]);
    });
});
