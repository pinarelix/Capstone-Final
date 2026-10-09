const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, pool } = require('../server');

describe('System Settings + role enforcement', () => {
    const adminUsername = 'test_admin_settings';
    const dmUsername = 'test_dm_settings';
    const password = 'testpass123';
    let adminToken, dmToken;
    const settingKey = 'test_automated_setting';

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Administrator', 1)`,
            ['Test Admin Settings', adminUsername, hash]
        );
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Decision-Maker', 1)`,
            ['Test DM Settings', dmUsername, hash]
        );
        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;
        const dmLogin = await request(app).post('/api/auth/login').send({ username: dmUsername, password });
        dmToken = dmLogin.body.session_token;
    });

    afterEach(async () => {
        await pool.query('DELETE FROM system_settings WHERE setting_key = ?', [settingKey]);
        const usernames = [adminUsername, dmUsername];
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', usernames);
        await pool.query('DELETE FROM login_history WHERE username IN (?, ?)', usernames);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', usernames);
        await pool.query('DELETE FROM login_attempts WHERE username IN (?, ?)', usernames);
        await pool.query('DELETE FROM users WHERE username IN (?, ?)', usernames);
    });

    test('Decision-Maker cannot read settings (Administrator-only)', async () => {
        const res = await request(app).get('/api/settings').set('Authorization', `Bearer ${dmToken}`);
        expect(res.status).toBe(403);
    });

    test('Administrator can create a new setting via POST, then update it via PUT', async () => {
        const createRes = await request(app)
            .post('/api/settings')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ setting_key: settingKey, setting_value: 'first-value' });
        expect(createRes.status).toBe(200);

        const getRes = await request(app).get(`/api/settings/${settingKey}`).set('Authorization', `Bearer ${adminToken}`);
        expect(getRes.body.setting_value).toBe('first-value');

        const updateRes = await request(app)
            .put(`/api/settings/${settingKey}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ setting_value: 'second-value' });
        expect(updateRes.status).toBe(200);

        const getRes2 = await request(app).get(`/api/settings/${settingKey}`).set('Authorization', `Bearer ${adminToken}`);
        expect(getRes2.body.setting_value).toBe('second-value');
    });

    test('an invalid-looking value ("NaN"/"undefined"/"") falls back to the documented default, if one exists', async () => {
        const res = await request(app)
            .post('/api/settings')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ setting_key: 'max_login_attempts', setting_value: 'NaN' });
        expect(res.status).toBe(200);

        const getRes = await request(app).get('/api/settings/max_login_attempts').set('Authorization', `Bearer ${adminToken}`);
        expect(getRes.body.setting_value).toBe('5');

        // Restore in case this key already existed with a different real
        // value before this test ran (SETTINGS_DEFAULTS is the fallback,
        // not necessarily what's live elsewhere).
        await pool.query('DELETE FROM system_settings WHERE setting_key = ?', ['max_login_attempts']);
    });

    test('updating a setting that does not exist yet returns 404', async () => {
        const res = await request(app)
            .put('/api/settings/does_not_exist_key')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ setting_value: 'x' });
        expect(res.status).toBe(404);
    });

    test('missing setting_value on PUT is rejected with 400', async () => {
        await request(app)
            .post('/api/settings')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ setting_key: settingKey, setting_value: 'first-value' });

        const res = await request(app)
            .put(`/api/settings/${settingKey}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({});
        expect(res.status).toBe(400);
    });
});

describe('Audit Logs + role enforcement', () => {
    const adminUsername = 'test_admin_audit';
    const dmUsername = 'test_dm_audit';
    const password = 'testpass123';
    let adminToken, dmToken;

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Administrator', 1)`,
            ['Test Admin Audit', adminUsername, hash]
        );
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Decision-Maker', 1)`,
            ['Test DM Audit', dmUsername, hash]
        );
        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;
        const dmLogin = await request(app).post('/api/auth/login').send({ username: dmUsername, password });
        dmToken = dmLogin.body.session_token;
    });

    afterEach(async () => {
        const usernames = [adminUsername, dmUsername];
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', usernames);
        await pool.query('DELETE FROM login_history WHERE username IN (?, ?)', usernames);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', usernames);
        await pool.query('DELETE FROM login_attempts WHERE username IN (?, ?)', usernames);
        await pool.query('DELETE FROM users WHERE username IN (?, ?)', usernames);
    });

    test('Decision-Maker cannot read the audit trail (Administrator-only)', async () => {
        const res = await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${dmToken}`);
        expect(res.status).toBe(403);
    });

    test('a logged-in action (login itself) shows up in the audit trail', async () => {
        const res = await request(app)
            .get('/api/audit-logs')
            .query({ action: 'LOGIN', limit: 10 })
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.some(row => row.username === adminUsername && row.action === 'LOGIN')).toBe(true);
    });
});

describe('CART HTTP endpoints', () => {
    const adminUsername = 'test_admin_cart_http';
    const password = 'testpass123';
    let adminToken;

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Administrator', 1)`,
            ['Test Admin Cart Http', adminUsername, hash]
        );
        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;
    });

    afterEach(async () => {
        await pool.query('DELETE FROM cart_analysis_log WHERE triggered_by IN (SELECT id FROM users WHERE username = ?)', [adminUsername]);
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [adminUsername]);
        await pool.query('DELETE FROM login_history WHERE username = ?', [adminUsername]);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [adminUsername]);
        await pool.query('DELETE FROM login_attempts WHERE username = ?', [adminUsername]);
        await pool.query('DELETE FROM users WHERE username = ?', [adminUsername]);
    });

    test('POST /api/cart/predict requires incident_type, time, and day', async () => {
        const res = await request(app)
            .post('/api/cart/predict')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ incident_type: 'Theft' });
        expect(res.status).toBe(400);
    });

    test('POST /api/cart/predict returns a danger level and logs itself as a simulation run', async () => {
        const res = await request(app)
            .post('/api/cart/predict')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ incident_type: 'Theft', time: '22:00', day: 'Saturday', location: 'Balite Street' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(['Level 1', 'Level 2', 'Level 3']).toContain(res.body.dangerLevel);

        const [logRows] = await pool.query(
            `SELECT analysis_type FROM cart_analysis_log WHERE triggered_by = (SELECT id FROM users WHERE username = ?) ORDER BY id DESC LIMIT 1`,
            [adminUsername]
        );
        expect(logRows[0].analysis_type).toBe('simulation');
    });

    test('POST /api/cart/analyze runs a full recompute and logs it as risk_prediction', async () => {
        const res = await request(app)
            .post('/api/cart/analyze')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.log_id).toBeTruthy();

        const [logRows] = await pool.query('SELECT analysis_type FROM cart_analysis_log WHERE id = ?', [res.body.log_id]);
        expect(logRows[0].analysis_type).toBe('risk_prediction');
    });

    test('a request with no token is rejected with 401', async () => {
        const res = await request(app).post('/api/cart/predict').send({ incident_type: 'Theft', time: '22:00', day: 'Saturday' });
        expect(res.status).toBe(401);
    });
});

describe('Report export audit logging', () => {
    const adminUsername = 'test_admin_reports';
    const password = 'testpass123';
    let adminToken;

    beforeEach(async () => {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Administrator', 1)`,
            ['Test Admin Reports', adminUsername, hash]
        );
        const adminLogin = await request(app).post('/api/auth/login').send({ username: adminUsername, password });
        adminToken = adminLogin.body.session_token;
    });

    afterEach(async () => {
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [adminUsername]);
        await pool.query('DELETE FROM login_history WHERE username = ?', [adminUsername]);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [adminUsername]);
        await pool.query('DELETE FROM login_attempts WHERE username = ?', [adminUsername]);
        await pool.query('DELETE FROM users WHERE username = ?', [adminUsername]);
    });

    test('logging a CSV export records an audit_logs row with the right action', async () => {
        const res = await request(app)
            .post('/api/reports/log-export')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ action: 'EXPORT_CSV_REPORT', month: '2026-01', recordCount: 12 });
        expect(res.status).toBe(200);

        const [rows] = await pool.query(
            `SELECT action FROM audit_logs WHERE user_id = (SELECT id FROM users WHERE username = ?) AND action = 'EXPORT_CSV_REPORT'`,
            [adminUsername]
        );
        expect(rows.length).toBe(1);
    });

    test('an unrecognized export action is rejected with 400', async () => {
        const res = await request(app)
            .post('/api/reports/log-export')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ action: 'NOT_A_REAL_ACTION' });
        expect(res.status).toBe(400);
    });
});

afterAll(async () => {
    await pool.end();
});
