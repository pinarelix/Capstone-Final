const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

describe('Users CRUD + role enforcement', () => {
    const adminUsername = 'test_admin_users';
    const dmUsername = 'test_dm_users';
    const password = 'testpass123';
    let adminToken, dmToken;
    let createdUserId;
    const newUsername = 'test_created_user';

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Administrator', 1)`,
            ['Test Admin Users', adminUsername, hash]
        );
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Decision-Maker', 1)`,
            ['Test DM Users', dmUsername, hash]
        );

        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;
        const dmLogin = await request(app).post('/api/auth/login').send({ username: dmUsername, password });
        dmToken = dmLogin.body.session_token;
    });

    afterEach(async () => {
        if (createdUserId) {
            await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [createdUserId]);
            await pool.query('DELETE FROM audit_logs WHERE entity_type = "users" AND entity_id = ?', [createdUserId]);
            await pool.query('DELETE FROM users WHERE id = ?', [createdUserId]);
            createdUserId = null;
        }
        await pool.query('DELETE FROM users WHERE username = ?', [newUsername]);
        const usernames = [adminUsername, dmUsername];
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', usernames);
        await pool.query('DELETE FROM login_history WHERE username IN (?, ?)', usernames);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', usernames);
        await pool.query('DELETE FROM login_attempts WHERE username IN (?, ?)', usernames);
        await pool.query('DELETE FROM users WHERE username IN (?, ?)', usernames);
    });

    const newUserPayload = () => ({
        name: 'Created By Test',
        username: newUsername,
        password: 'brandnewpass123',
        role: 'Desk Officer'
    });

    test('Administrator can create a user', async () => {
        const res = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(newUserPayload());

        expect(res.status).toBe(201);
        expect(res.body.user.username).toBe(newUsername);
        expect(res.body.user.password_hash).toBeUndefined();
        createdUserId = res.body.user.id;
    });

    test('Decision-Maker cannot create a user (Administrator-only route)', async () => {
        const res = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${dmToken}`)
            .send(newUserPayload());
        expect(res.status).toBe(403);
    });

    test('creating a duplicate active username is rejected with 400', async () => {
        const res = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...newUserPayload(), username: adminUsername });
        expect(res.status).toBe(400);
    });

    test('deleting a user soft-deactivates it and ends its active sessions, instead of a hard delete', async () => {
        const createRes = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(newUserPayload());
        createdUserId = createRes.body.user.id;

        const loginRes = await request(app).post('/api/auth/login').send({ username: newUsername, password: 'brandnewpass123' });
        expect(loginRes.status).toBe(200);

        const deleteRes = await request(app)
            .delete(`/api/users/${createdUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(deleteRes.status).toBe(200);

        const [rows] = await pool.query('SELECT is_active FROM users WHERE id = ?', [createdUserId]);
        expect(rows[0].is_active).toBe(0);

        const [sessionRows] = await pool.query('SELECT is_active FROM user_sessions WHERE user_id = ?', [createdUserId]);
        expect(sessionRows.every(r => r.is_active === 0)).toBe(true);
    });

    test('re-adding a previously deactivated username reactivates the same account', async () => {
        const createRes = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(newUserPayload());
        createdUserId = createRes.body.user.id;

        await request(app).delete(`/api/users/${createdUserId}`).set('Authorization', `Bearer ${adminToken}`);

        const recreateRes = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...newUserPayload(), name: 'Reactivated User' });

        expect(recreateRes.status).toBe(201);
        expect(recreateRes.body.user.id).toBe(createdUserId);
        expect(recreateRes.body.user.name).toBe('Reactivated User');
        expect(recreateRes.body.user.is_active).toBe(1);
    });

    test('the primary "admin" account cannot be deleted even by another Administrator', async () => {
        const hash = await bcrypt.hash('adminpass123', 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, 'admin', ?, 'Administrator', 1)
             ON DUPLICATE KEY UPDATE id = id`,
            ['Primary Admin', hash]
        );
        const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', ['admin']);
        const primaryAdminId = rows[0].id;

        const res = await request(app)
            .delete(`/api/users/${primaryAdminId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(403);
    });

    test('a request with no token is rejected with 401', async () => {
        const res = await request(app).get('/api/users');
        expect(res.status).toBe(401);
    });
});

describe('Tanods CRUD + role enforcement', () => {
    const adminUsername = 'test_admin_tanods';
    const dmUsername = 'test_dm_tanods';
    const password = 'testpass123';
    let adminToken, dmToken;
    let createdTanodId;
    const newTanodUsername = 'test_created_tanod';

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Administrator', 1)`,
            ['Test Admin Tanods', adminUsername, hash]
        );
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Decision-Maker', 1)`,
            ['Test DM Tanods', dmUsername, hash]
        );

        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;
        const dmLogin = await request(app).post('/api/auth/login').send({ username: dmUsername, password });
        dmToken = dmLogin.body.session_token;
    });

    afterEach(async () => {
        if (createdTanodId) {
            await pool.query('DELETE FROM tanod_audit_logs WHERE tanod_id = ?', [createdTanodId]);
            await pool.query('DELETE FROM tanod_record WHERE id = ?', [createdTanodId]);
            createdTanodId = null;
        }
        await pool.query('DELETE FROM tanod_record WHERE username = ?', [newTanodUsername]);
        const usernames = [adminUsername, dmUsername];
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', usernames);
        await pool.query('DELETE FROM login_history WHERE username IN (?, ?)', usernames);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', usernames);
        await pool.query('DELETE FROM login_attempts WHERE username IN (?, ?)', usernames);
        await pool.query('DELETE FROM users WHERE username IN (?, ?)', usernames);
    });

    const newTanodPayload = () => ({
        name: 'Created Tanod',
        position: 'Dispatcher',
        username: newTanodUsername,
        pin_code: '1234'
    });

    test('Desk Officer-equivalent roles (Administrator here) can create a tanod with a PIN', async () => {
        const res = await request(app)
            .post('/api/tanods')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(newTanodPayload());

        expect(res.status).toBe(201);
        expect(res.body.tanod.username).toBe(newTanodUsername);
        expect(res.body.tanod.pin_code_hash).toBeUndefined();
        createdTanodId = res.body.tanod.id;
    });

    test('creating a tanod without a PIN is rejected with 400', async () => {
        const { pin_code, ...payload } = newTanodPayload();
        const res = await request(app)
            .post('/api/tanods')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(payload);
        expect(res.status).toBe(400);
    });

    test('a duplicate active tanod username is rejected with 409', async () => {
        const createRes = await request(app)
            .post('/api/tanods')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(newTanodPayload());
        createdTanodId = createRes.body.tanod.id;

        const dupRes = await request(app)
            .post('/api/tanods')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...newTanodPayload(), name: 'Someone Else' });
        expect(dupRes.status).toBe(409);
    });

    test('Decision-Maker can edit a tanod but cannot reset its PIN', async () => {
        const createRes = await request(app)
            .post('/api/tanods')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(newTanodPayload());
        createdTanodId = createRes.body.tanod.id;

        const editRes = await request(app)
            .put(`/api/tanods/${createdTanodId}`)
            .set('Authorization', `Bearer ${dmToken}`)
            .send({ name: 'Edited By DM', position: 'Dispatcher', username: newTanodUsername });
        expect(editRes.status).toBe(200);
        expect(editRes.body.tanod.name).toBe('Edited By DM');

        const pinResetRes = await request(app)
            .put(`/api/tanods/${createdTanodId}`)
            .set('Authorization', `Bearer ${dmToken}`)
            .send({ name: 'Edited By DM', position: 'Dispatcher', username: newTanodUsername, pin_code: '9999' });
        expect(pinResetRes.status).toBe(403);
    });

    test('Administrator can reset a tanod PIN', async () => {
        const createRes = await request(app)
            .post('/api/tanods')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(newTanodPayload());
        createdTanodId = createRes.body.tanod.id;

        const pinResetRes = await request(app)
            .put(`/api/tanods/${createdTanodId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'Created Tanod', position: 'Dispatcher', username: newTanodUsername, pin_code: '9999' });
        expect(pinResetRes.status).toBe(200);
    });

    test('Decision-Maker cannot delete a tanod (Administrator-only route)', async () => {
        const createRes = await request(app)
            .post('/api/tanods')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(newTanodPayload());
        createdTanodId = createRes.body.tanod.id;

        const deleteRes = await request(app)
            .delete(`/api/tanods/${createdTanodId}`)
            .set('Authorization', `Bearer ${dmToken}`);
        expect(deleteRes.status).toBe(403);
    });

    test('Administrator deleting a tanod soft-deactivates it', async () => {
        const createRes = await request(app)
            .post('/api/tanods')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(newTanodPayload());
        createdTanodId = createRes.body.tanod.id;

        const deleteRes = await request(app)
            .delete(`/api/tanods/${createdTanodId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(deleteRes.status).toBe(200);

        const [rows] = await pool.query('SELECT is_active FROM tanod_record WHERE id = ?', [createdTanodId]);
        expect(rows[0].is_active).toBe(0);
    });
});

describe('Tanod Teams CRUD', () => {
    const adminUsername = 'test_admin_teams';
    const password = 'testpass123';
    let adminToken;
    let createdTeamId;
    const teamName = 'Test Automated Team';

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Administrator', 1)`,
            ['Test Admin Teams', adminUsername, hash]
        );
        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;
    });

    afterEach(async () => {
        if (createdTeamId) {
            await pool.query('DELETE FROM tanod_teams WHERE id = ?', [createdTeamId]);
            createdTeamId = null;
        }
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [adminUsername]);
        await pool.query('DELETE FROM login_history WHERE username = ?', [adminUsername]);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [adminUsername]);
        await pool.query('DELETE FROM login_attempts WHERE username = ?', [adminUsername]);
        await pool.query('DELETE FROM users WHERE username = ?', [adminUsername]);
    });

    test('can create, list, update, and delete a tanod team', async () => {
        const createRes = await request(app)
            .post('/api/tanod-teams')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: teamName });
        expect(createRes.status).toBe(201);
        createdTeamId = createRes.body.team.id;

        const listRes = await request(app)
            .get('/api/tanod-teams')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(listRes.body.some(t => t.id === createdTeamId)).toBe(true);

        const updateRes = await request(app)
            .put(`/api/tanod-teams/${createdTeamId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'Renamed Team' });
        expect(updateRes.status).toBe(200);

        const deleteRes = await request(app)
            .delete(`/api/tanod-teams/${createdTeamId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(deleteRes.status).toBe(200);
        createdTeamId = null;
    });

    test('a team name shorter than 2 characters is rejected with 400', async () => {
        const res = await request(app)
            .post('/api/tanod-teams')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'A' });
        expect(res.status).toBe(400);
    });
});

afterAll(async () => {
    await pool.end();
});
