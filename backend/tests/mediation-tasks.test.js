const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

describe('Mediation tasks and per-user navigation order', () => {
    const password = 'testpass123';
    const users = {
        admin: { username: 'test_mediation_admin', role: 'Deputy Officer' },
        leader: { username: 'test_mediation_leader', role: 'Team Leader' },
        assignee: { username: 'test_mediation_assignee', role: 'Kagawad' },
        other: { username: 'test_mediation_other', role: 'Kagawad' }
    };

    let blotterId;
    let crimeId;

    const recordPayload = formType => ({
        form_type: formType,
        incident_type: formType === 'blotter' ? 'Harassment' : 'Theft',
        date: '2026-10-24',
        time: '10:00',
        latitude: 14.75,
        longitude: 121.07,
        street_name: 'Balite Street',
        status: 'Open',
        description: 'mediation feature test',
        complainant_first: 'Test',
        complainant_last: 'Reporter',
        respondent_first: 'Test',
        respondent_last: 'Respondent',
        statement: 'Automated test statement',
        priority: formType === 'blotter' ? 'Urgent' : 'Normal',
        severity: 'Medium'
    });

    function todayAt(hour, minute = 0) {
        const now = new Date();
        const pad = value => String(value).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(hour)}:${pad(minute)}`;
    }

    beforeAll(async () => {
        const hash = await bcrypt.hash(password, 10);
        for (const [key, user] of Object.entries(users)) {
            const [result] = await pool.query(
                `INSERT INTO users (name, username, password_hash, role, is_active)
                 VALUES (?, ?, ?, ?, 1)`,
                [`Mediation ${key}`, user.username, hash, user.role]
            );
            user.id = result.insertId;

            const login = await request(app)
                .post('/api/auth/login')
                .send({ username: user.username, password });
            user.token = login.body.session_token;
        }

        const blotter = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${users.admin.token}`)
            .send(recordPayload('blotter'));
        expect(blotter.status).toBe(201);
        blotterId = blotter.body.id;

        const crime = await request(app)
            .post('/api/incidents')
            .set('Authorization', `Bearer ${users.admin.token}`)
            .send(recordPayload('crime'));
        expect(crime.status).toBe(201);
        crimeId = crime.body.id;
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM mediation_task_history');
        await pool.query('DELETE FROM mediation_tasks');
        await pool.query('DELETE FROM user_navigation_preferences WHERE user_id IN (?, ?, ?, ?)', [
            users.admin.id,
            users.leader.id,
            users.assignee.id,
            users.other.id
        ]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM mediation_task_history');
        await pool.query('DELETE FROM mediation_tasks');
        await pool.query('DELETE FROM user_navigation_preferences WHERE user_id IN (?, ?, ?, ?)', [
            users.admin.id,
            users.leader.id,
            users.assignee.id,
            users.other.id
        ]);

        for (const recordId of [blotterId, crimeId]) {
            if (!recordId) continue;
            await pool.query('DELETE FROM cart_risk_factors WHERE incident_id = ?', [recordId]);
            await pool.query('DELETE FROM incident_evidence WHERE incident_id = ?', [recordId]);
            const [registry] = await pool.query(
                'SELECT source, source_id FROM record_registry WHERE registry_id = ?',
                [recordId]
            );
            if (registry.length > 0) {
                const table = registry[0].source === 'incident' ? 'incident_records' : 'blotter_records';
                await pool.query(`DELETE FROM ${table} WHERE id = ?`, [registry[0].source_id]);
                await pool.query('DELETE FROM record_registry WHERE registry_id = ?', [recordId]);
            }
        }

        const usernames = Object.values(users).map(user => user.username);
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?, ?, ?))', usernames);
        await pool.query('DELETE FROM login_history WHERE username IN (?, ?, ?, ?)', usernames);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?, ?, ?))', usernames);
        await pool.query('DELETE FROM login_attempts WHERE username IN (?, ?, ?, ?)', usernames);
        await pool.query('DELETE FROM users WHERE username IN (?, ?, ?, ?)', usernames);
    });

    async function createTask(overrides = {}, token = users.admin.token) {
        return request(app)
            .post('/api/mediation-tasks')
            .set('Authorization', `Bearer ${token}`)
            .send({
                incident_id: blotterId,
                assigned_user_id: users.assignee.id,
                scheduled_at: todayAt(12),
                ...overrides
            });
    }

    test('Deputy Officer can assign a blotter task and the assignee sees it today', async () => {
        const created = await createTask();
        expect(created.status).toBe(201);

        const list = await request(app)
            .get('/api/me/mediation-tasks')
            .set('Authorization', `Bearer ${users.assignee.token}`);
        expect(list.status).toBe(200);
        expect(list.body).toHaveLength(1);
        expect(list.body[0].id).toBe(created.body.id);
        expect(list.body[0].incident_id).toBe(blotterId);
    });

    test('Team Leader can assign, but read-focused Kagawad cannot', async () => {
        const leaderCreate = await createTask({}, users.leader.token);
        expect(leaderCreate.status).toBe(201);

        const kagawadCreate = await createTask({}, users.assignee.token);
        expect(kagawadCreate.status).toBe(403);
    });

    test('assignment rejects crime records, inactive users and invalid IDs', async () => {
        const crime = await createTask({ incident_id: crimeId });
        expect(crime.status).toBe(400);

        await pool.query('UPDATE users SET is_active = 0 WHERE id = ?', [users.other.id]);
        const inactive = await createTask({ assigned_user_id: users.other.id });
        expect(inactive.status).toBe(400);
        await pool.query('UPDATE users SET is_active = 1 WHERE id = ?', [users.other.id]);

        const invalid = await createTask({ incident_id: 0, assigned_user_id: -1 });
        expect(invalid.status).toBe(400);
    });

    test('only the assignee can update a task or read its history', async () => {
        const created = await createTask();

        const otherUpdate = await request(app)
            .patch(`/api/me/mediation-tasks/${created.body.id}`)
            .set('Authorization', `Bearer ${users.other.token}`)
            .send({ status: 'In Progress', note: 'Not my task' });
        expect(otherUpdate.status).toBe(404);

        const ownerUpdate = await request(app)
            .patch(`/api/me/mediation-tasks/${created.body.id}`)
            .set('Authorization', `Bearer ${users.assignee.token}`)
            .send({ status: 'In Progress', note: 'Parties contacted' });
        expect(ownerUpdate.status).toBe(200);

        const history = await request(app)
            .get(`/api/me/mediation-tasks/${created.body.id}/history`)
            .set('Authorization', `Bearer ${users.assignee.token}`);
        expect(history.status).toBe(200);
        expect(history.body).toHaveLength(2);
        expect(history.body[0]).toMatchObject({ status: 'In Progress', note: 'Parties contacted' });

        const otherHistory = await request(app)
            .get(`/api/me/mediation-tasks/${created.body.id}/history`)
            .set('Authorization', `Bearer ${users.other.token}`);
        expect(otherHistory.status).toBe(404);
    });

    test('rescheduling requires a valid calendar date', async () => {
        const created = await createTask();
        const invalid = await request(app)
            .patch(`/api/me/mediation-tasks/${created.body.id}`)
            .set('Authorization', `Bearer ${users.assignee.token}`)
            .send({ status: 'Rescheduled', note: '', scheduled_at: '2026-02-31T12:00' });
        expect(invalid.status).toBe(400);
    });

    test('navigation order is validated and isolated per account', async () => {
        const order = [
            'settings.html',
            'users.html',
            'report.html',
            'patrol.html',
            'grid-heatmap.html',
            'incident-view.html',
            'incident.html',
            'dashboard.html'
        ];

        const saved = await request(app)
            .put('/api/me/navigation-order')
            .set('Authorization', `Bearer ${users.admin.token}`)
            .send({ order });
        expect(saved.status).toBe(200);

        const adminOrder = await request(app)
            .get('/api/me/navigation-order')
            .set('Authorization', `Bearer ${users.admin.token}`);
        expect(adminOrder.body.order).toEqual(order);

        const otherOrder = await request(app)
            .get('/api/me/navigation-order')
            .set('Authorization', `Bearer ${users.other.token}`);
        expect(otherOrder.body.order).toEqual([]);

        const invalid = await request(app)
            .put('/api/me/navigation-order')
            .set('Authorization', `Bearer ${users.admin.token}`)
            .send({ order: ['dashboard.html', 'dashboard.html'] });
        expect(invalid.status).toBe(400);
    });
});
