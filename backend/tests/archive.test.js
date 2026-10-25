const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

describe('Archive: deleted records can be listed and restored', () => {
    const adminUsername = 'test_admin_archive';
    const dmUsername = 'test_dm_archive';
    const deskUsername = 'test_desk_archive';
    const password = 'testpass123';
    let adminToken, dmToken, deskToken, adminUserId;
    const cleanup = { incidents: [], schedules: [], logs: [], users: [] };

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        for (const [name, username, role] of [
            ['Test Admin', adminUsername, 'Deputy Officer'],
            ['Test DM', dmUsername, 'Kagawad'],
            ['Test Desk', deskUsername, 'Team Leader']
        ]) {
            await pool.query(
                'INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)',
                [name, username, hash, role]
            );
        }
        const login = async (username) => (await request(app).post('/api/auth/login').send({ username, password })).body;
        const adminLogin = await login(adminUsername);
        adminToken = adminLogin.session_token;
        adminUserId = adminLogin.user.id;
        dmToken = (await login(dmUsername)).session_token;
        deskToken = (await login(deskUsername)).session_token;
    });

    afterEach(async () => {
        if (cleanup.logs.length) await pool.query('DELETE FROM patrol_logs WHERE id IN (?)', [cleanup.logs]);
        if (cleanup.schedules.length) {
            await pool.query('DELETE FROM patrol_schedules WHERE id IN (?)', [cleanup.schedules]);
        }
        for (const incId of cleanup.incidents) {
            await pool.query('DELETE FROM cart_risk_factors WHERE incident_id = ?', [incId]);
            await pool.query('DELETE FROM incident_evidence WHERE incident_id = ?', [incId]);
            const [reg] = await pool.query('SELECT source, source_id FROM record_registry WHERE registry_id = ?', [incId]);
            if (reg.length > 0) {
                const table = reg[0].source === 'incident' ? 'incident_records' : 'blotter_records';
                await pool.query(`DELETE FROM ${table} WHERE id = ?`, [reg[0].source_id]);
                await pool.query('DELETE FROM record_registry WHERE registry_id = ?', [incId]);
            }
        }
        if (cleanup.users.length) await pool.query('DELETE FROM users WHERE id IN (?)', [cleanup.users]);
        await pool.query('DELETE FROM archived_records WHERE deleted_by = ? OR restored_by = ? OR (entity_type = ? AND entity_id IN (?))',
            [adminUserId, adminUserId, 'user', cleanup.users.length ? cleanup.users : [0]]);
        for (const key of Object.keys(cleanup)) cleanup[key] = [];

        const usernames = [adminUsername, dmUsername, deskUsername];
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?))', [usernames]);
        await pool.query('DELETE FROM login_history WHERE username IN (?)', [usernames]);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?))', [usernames]);
        await pool.query('DELETE FROM login_attempts WHERE username IN (?)', [usernames]);
        await pool.query('DELETE FROM users WHERE username IN (?)', [usernames]);
    });

    const incidentPayload = {
        form_type: 'crime',
        incident_type: 'Theft',
        date: '2026-01-15',
        time: '21:30',
        latitude: 14.755,
        longitude: 121.077,
        street_name: 'Balite Street',
        status: 'Open',
        description: 'archive test',
        address: 'House 1, Balite Street',
        complainant_first: 'Juan',
        complainant_last: 'Dela Cruz',
        statement: 'Witnessed theft',
        recommended_action: 'Scheduled patrol',
        priority: 'Normal',
        severity: 'High'
    };

    const archiveEntry = async (type, id) => {
        const res = await request(app).get(`/api/archive?type=${type}&state=all`).set('Authorization', `Bearer ${adminToken}`);
        return res.body.find(e => e.entity_id === id);
    };

    test('only the Deputy Officer can view or restore the archive', async () => {
        for (const token of [dmToken, deskToken]) {
            const list = await request(app).get('/api/archive').set('Authorization', `Bearer ${token}`);
            expect(list.status).toBe(403);
            const restore = await request(app).post('/api/archive/1/restore').set('Authorization', `Bearer ${token}`);
            expect(restore.status).toBe(403);
        }
    });

    test('deleting an incident archives it, and restore brings it back', async () => {
        const created = await request(app).post('/api/incidents').set('Authorization', `Bearer ${adminToken}`).send(incidentPayload);
        const incidentId = created.body.id;
        cleanup.incidents.push(incidentId);

        const del = await request(app).delete(`/api/incidents/${incidentId}`).set('Authorization', `Bearer ${adminToken}`);
        expect(del.status).toBe(200);
        const [gone] = await pool.query('SELECT id FROM incidents WHERE id = ?', [incidentId]);
        expect(gone).toHaveLength(0);

        const entry = await archiveEntry('incident', incidentId);
        expect(entry).toBeDefined();
        expect(entry.restored_at).toBeNull();
        expect(entry.deleted_by_name).toBe('Test Admin');

        const restore = await request(app).post(`/api/archive/${entry.id}/restore`).set('Authorization', `Bearer ${adminToken}`);
        expect(restore.status).toBe(200);

        const [back] = await pool.query('SELECT id FROM incidents WHERE id = ?', [incidentId]);
        expect(back).toHaveLength(1);

        const again = await request(app).post(`/api/archive/${entry.id}/restore`).set('Authorization', `Bearer ${adminToken}`);
        expect(again.status).toBe(409);
    });

    test('restoring a schedule re-links its patrol logs', async () => {
        const sched = await request(app).post('/api/patrol-schedules').set('Authorization', `Bearer ${adminToken}`).send({
            location: 'Balite Street', start_time: '20:00', end_time: '22:00', day_of_week: 'Friday'
        });
        const scheduleId = sched.body.schedule.id;
        cleanup.schedules.push(scheduleId);
        const log = await request(app).post('/api/patrol-logs').set('Authorization', `Bearer ${adminToken}`).send({
            schedule_id: scheduleId, report: 'archive test', status: 'Completed', patrol_date: '2026-01-17'
        });
        const logId = log.body.log.id;
        cleanup.logs.push(logId);

        await request(app).delete(`/api/patrol-schedules/${scheduleId}`).set('Authorization', `Bearer ${adminToken}`);
        const [detached] = await pool.query('SELECT schedule_id FROM patrol_logs WHERE id = ?', [logId]);
        expect(detached[0].schedule_id).toBeNull();

        const entry = await archiveEntry('patrol_schedule', scheduleId);
        const restore = await request(app).post(`/api/archive/${entry.id}/restore`).set('Authorization', `Bearer ${adminToken}`);
        expect(restore.status).toBe(200);

        const [relinked] = await pool.query('SELECT schedule_id FROM patrol_logs WHERE id = ?', [logId]);
        expect(relinked[0].schedule_id).toBe(scheduleId);

        await request(app).delete(`/api/patrol-logs/${logId}`).set('Authorization', `Bearer ${adminToken}`);
        const logEntry = await archiveEntry('patrol_log', logId);
        expect((await request(app).post(`/api/archive/${logEntry.id}/restore`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
        const [logBack] = await pool.query('SELECT schedule_id FROM patrol_logs WHERE id = ?', [logId]);
        expect(logBack[0].schedule_id).toBe(scheduleId);
    });

    test('deactivated users are archived and restore reactivates them (no secrets in the snapshot)', async () => {
        const created = await request(app).post('/api/users').set('Authorization', `Bearer ${adminToken}`).send({
            name: 'Archive User', username: 'test_archive_user', password: 'Pass1234!', role: 'Team Leader', email: 'archive.user@example.com'
        });
        expect(created.status).toBe(201);
        const userId = created.body.user?.id || (await pool.query("SELECT id FROM users WHERE username = 'test_archive_user'"))[0][0].id;
        cleanup.users.push(userId);

        await request(app).delete(`/api/users/${userId}`).set('Authorization', `Bearer ${adminToken}`);
        const entry = await archiveEntry('user', userId);
        expect(entry).toBeDefined();
        expect(entry.data.row.password_hash).toBeUndefined();

        expect((await request(app).post(`/api/archive/${entry.id}/restore`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
        const [active] = await pool.query('SELECT is_active FROM users WHERE id = ?', [userId]);
        expect(active[0].is_active).toBe(1);
    });
});

afterAll(async () => {
    await pool.end();
});
