const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

// Deletes move records into archived_records; an Administrator can list
// and restore them from Settings > Archive.
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
            ['Test Admin', adminUsername, 'Administrator'],
            ['Test DM', dmUsername, 'Decision-Maker'],
            ['Test Desk', deskUsername, 'Desk Officer']
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
        if (cleanup.incidents.length) {
            await pool.query('DELETE FROM cart_risk_factors WHERE incident_id IN (?)', [cleanup.incidents]);
            await pool.query('DELETE FROM incidents WHERE id IN (?)', [cleanup.incidents]);
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

    const archiveEntry = async (type, id) => {
        const res = await request(app).get(`/api/archive?type=${type}&state=all`).set('Authorization', `Bearer ${adminToken}`);
        return res.body.find(e => e.entity_id === id);
    };

    test('only Administrators can view or restore the archive', async () => {
        for (const token of [dmToken, deskToken]) {
            const list = await request(app).get('/api/archive').set('Authorization', `Bearer ${token}`);
            expect(list.status).toBe(403);
            const restore = await request(app).post('/api/archive/1/restore').set('Authorization', `Bearer ${token}`);
            expect(restore.status).toBe(403);
        }
    });

    test('deleting an incident archives it with its evidence, and restore brings both back with the same id', async () => {
        const created = await request(app).post('/api/incidents').set('Authorization', `Bearer ${adminToken}`).send({
            incident_type: 'Theft', date: '2026-01-15', time: '21:30', latitude: 14.755, longitude: 121.077,
            street_name: 'Balite Street', status: 'Open', description: 'archive test', blotter_number: 'BLT-ARCHIVE',
            address: 'House 1, Balite Street', reported_by_name: 'Juan Dela Cruz', persons_involved: 'Suspect: Unknown',
            statement: 'Witnessed theft', recommended_action: 'Scheduled patrol', priority: 'Normal'
        });
        const incidentId = created.body.id;
        cleanup.incidents.push(incidentId);
        const [ev] = await pool.query(
            `INSERT INTO incident_evidence (incident_id, file_path, file_type, original_filename) VALUES (?, 'evidence-test-missing.png', 'image', 'scene.png')`,
            [incidentId]
        );

        const del = await request(app).delete(`/api/incidents/${incidentId}`).set('Authorization', `Bearer ${adminToken}`);
        expect(del.status).toBe(200);
        const [gone] = await pool.query('SELECT id FROM incidents WHERE id = ?', [incidentId]);
        expect(gone).toHaveLength(0);

        const entry = await archiveEntry('incident', incidentId);
        expect(entry).toBeDefined();
        expect(entry.restored_at).toBeNull();
        expect(entry.deleted_by_name).toBe('Test Admin');
        expect(entry.data.row.blotter_number).toBe('BLT-ARCHIVE');
        expect(entry.data.evidence).toHaveLength(1);

        const restore = await request(app).post(`/api/archive/${entry.id}/restore`).set('Authorization', `Bearer ${adminToken}`);
        expect(restore.status).toBe(200);

        const [back] = await pool.query('SELECT id, blotter_number, date FROM incidents WHERE id = ?', [incidentId]);
        expect(back).toHaveLength(1);
        expect(back[0].blotter_number).toBe('BLT-ARCHIVE');
        expect(back[0].date).toBe('2026-01-15');
        const [evBack] = await pool.query('SELECT id FROM incident_evidence WHERE id = ?', [ev.insertId]);
        expect(evBack).toHaveLength(1);
        const [cart] = await pool.query('SELECT incident_id FROM cart_risk_factors WHERE incident_id = ?', [incidentId]);
        expect(cart).toHaveLength(1);

        const again = await request(app).post(`/api/archive/${entry.id}/restore`).set('Authorization', `Bearer ${adminToken}`);
        expect(again.status).toBe(409);
    });

    test('archived evidence cannot be restored while its incident is still archived', async () => {
        const created = await request(app).post('/api/incidents').set('Authorization', `Bearer ${adminToken}`).send({
            incident_type: 'Theft', date: '2026-01-16', time: '10:00', latitude: 14.755, longitude: 121.077,
            street_name: 'Balite Street', status: 'Open', description: 'evidence archive test', blotter_number: 'BLT-EV-ARCHIVE',
            address: 'House 2, Balite Street', reported_by_name: 'Maria Santos', persons_involved: 'Suspect: Unknown',
            statement: 'Saw suspicious activity', recommended_action: 'Investigate area', priority: 'Normal'
        });
        const incidentId = created.body.id;
        cleanup.incidents.push(incidentId);
        const [ev] = await pool.query(
            `INSERT INTO incident_evidence (incident_id, file_path, file_type, original_filename) VALUES (?, 'evidence-test-2.png', 'image', 'x.png')`,
            [incidentId]
        );

        // Desk Officers may remove evidence; it is archived, not erased.
        const delEv = await request(app).delete(`/api/incidents/${incidentId}/evidence/${ev.insertId}`).set('Authorization', `Bearer ${deskToken}`);
        expect(delEv.status).toBe(200);
        const evEntry = await archiveEntry('incident_evidence', ev.insertId);
        expect(evEntry.deleted_by_name).toBe('Test Desk');

        await request(app).delete(`/api/incidents/${incidentId}`).set('Authorization', `Bearer ${adminToken}`);
        const blocked = await request(app).post(`/api/archive/${evEntry.id}/restore`).set('Authorization', `Bearer ${adminToken}`);
        expect(blocked.status).toBe(409);
        expect(blocked.body.error).toMatch(/restore the incident first/);

        const incEntry = await archiveEntry('incident', incidentId);
        await request(app).post(`/api/archive/${incEntry.id}/restore`).set('Authorization', `Bearer ${adminToken}`);
        const ok = await request(app).post(`/api/archive/${evEntry.id}/restore`).set('Authorization', `Bearer ${adminToken}`);
        expect(ok.status).toBe(200);
        const [evBack] = await pool.query('SELECT id FROM incident_evidence WHERE id = ?', [ev.insertId]);
        expect(evBack).toHaveLength(1);
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

        // A patrol log on its own archives and restores too.
        await request(app).delete(`/api/patrol-logs/${logId}`).set('Authorization', `Bearer ${adminToken}`);
        const logEntry = await archiveEntry('patrol_log', logId);
        expect((await request(app).post(`/api/archive/${logEntry.id}/restore`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
        const [logBack] = await pool.query('SELECT schedule_id FROM patrol_logs WHERE id = ?', [logId]);
        expect(logBack[0].schedule_id).toBe(scheduleId);
    });

    test('deactivated users are archived and restore reactivates them (no secrets in the snapshot)', async () => {
        const created = await request(app).post('/api/users').set('Authorization', `Bearer ${adminToken}`).send({
            name: 'Archive User', username: 'test_archive_user', password: 'pass1234', role: 'Desk Officer', email: 'archive.user@example.com'
        });
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
