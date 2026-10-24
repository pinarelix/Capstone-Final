const request = require('supertest');
const bcrypt  = require('bcryptjs');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const { app, pool } = require('../server');
const {
    loadConfig,
    saveConfig,
    getConfigPath,
    isSetupCompleted,
    markSetupCompleted,
    generateRecoveryToken,
    getRecoveryTokenPath,
    setDataDir,
} = require('../config-manager');

let originalConfig, originalConfigPath, setupTestDir;

beforeAll(() => {
    originalConfigPath = getConfigPath();
    originalConfig = fs.existsSync(originalConfigPath) ? fs.readFileSync(originalConfigPath, 'utf8') : null;
    setupTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brgy179-setup-test-'));
    setDataDir(setupTestDir);
    // Use only the disposable test DB, and never write to the running app's
    // config/recovery-token paths. Windows may hold those real files open.
    saveConfig({ db: {
        host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', name: 'brgydata_test'
    }, setup_completed: false });
});

afterAll(() => {
    for (const file of [getConfigPath(), getConfigPath() + '.tmp', getRecoveryTokenPath()]) {
        if (path.dirname(path.resolve(file)) !== path.resolve(setupTestDir)) throw new Error('Unsafe test cleanup path');
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    // Non-recursive: unexpected files cause a test failure, not broad deletion.
    fs.rmdirSync(setupTestDir);
    setDataDir(null);
    const current = fs.existsSync(originalConfigPath) ? fs.readFileSync(originalConfigPath, 'utf8') : null;
    expect(current === originalConfig).toBe(true);
});

function setSetupCompleted(val) {
    saveConfig({ setup_completed: val });
}

// ── Fresh install (setup_completed = false) ──

describe('Setup guard — fresh install', () => {
    beforeEach(() => setSetupCompleted(false));
    afterEach(() => setSetupCompleted(true));

    test('localhost request is allowed', async () => {
        const res = await request(app).get('/api/setup/config');
        expect(res.status).toBe(200);
        expect(res.body.db).toBeDefined();
    });

    test('GET /config masks the password', async () => {
        const res = await request(app).get('/api/setup/config');
        expect(res.status).toBe(200);
        if (res.body.db.password) {
            expect(res.body.db.password).toBe('••••••');
        }
    });
});

// ── Post-setup (setup_completed = true) ──

describe('Setup guard — post-setup', () => {
    const username = 'test_setup_admin';
    const password = 'setuptest123';
    const normalUser = 'test_setup_normal';

    let adminToken;
    let normalToken;
    const bootToken = 'test-electron-boot-token-0123456789abcdef';
    let originalBootToken;

    beforeAll(async () => {
        originalBootToken = process.env.SETUP_BOOT_TOKEN;
        process.env.SETUP_BOOT_TOKEN = bootToken;
        setSetupCompleted(true);

        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Deputy Officer', 1)`,
            ['Setup Admin', username, hash]
        );
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Kagawad', 1)`,
            ['Setup Normal', normalUser, hash]
        );

        const adminRes = await request(app)
            .post('/api/auth/login')
            .send({ username, password });
        adminToken = adminRes.body.session_token;

        const normalRes = await request(app)
            .post('/api/auth/login')
            .send({ username: normalUser, password });
        normalToken = normalRes.body.session_token;
    });

    afterAll(async () => {
        await pool.query('DELETE FROM login_attempts WHERE username IN (?, ?)', [username, normalUser]);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', [username, normalUser]);
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', [username, normalUser]);
        await pool.query('DELETE FROM login_history WHERE username IN (?, ?)', [username, normalUser]);
        await pool.query('DELETE FROM users WHERE username IN (?, ?)', [username, normalUser]);
        if (originalBootToken === undefined) delete process.env.SETUP_BOOT_TOKEN;
        else process.env.SETUP_BOOT_TOKEN = originalBootToken;
    });

    test('unauthenticated request is rejected with 401', async () => {
        const res = await request(app).get('/api/setup/config');
        expect(res.status).toBe(401);
    });

    test('Deputy Officer can access setup', async () => {
        const res = await request(app)
            .get('/api/setup/config')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
    });

    test('non-admin role is rejected with 403', async () => {
        const res = await request(app)
            .get('/api/setup/config')
            .set('Authorization', `Bearer ${normalToken}`);
        expect(res.status).toBe(403);
    });

    test('invalid token is rejected with 401', async () => {
        const res = await request(app)
            .get('/api/setup/config')
            .set('Authorization', 'Bearer totally-invalid-token-123');
        expect(res.status).toBe(401);
    });

    test('Electron setup window can access setup with its per-launch boot token', async () => {
        const res = await request(app)
            .get('/api/setup/config')
            .set('X-Setup-Boot-Token', bootToken);
        expect(res.status).toBe(200);
        expect(res.body.db.password).not.toBe(loadConfig().db.password);
    });

    test('Electron setup window can test the configured database before login', async () => {
        const config = loadConfig();
        const res = await request(app)
            .post('/api/setup/test')
            .set('X-Setup-Boot-Token', bootToken)
            .send({
                host: process.env.DB_HOST,
                port: Number(process.env.DB_PORT),
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                database: process.env.DB_NAME
            });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.tables).toBeGreaterThan(0);
        expect(config.db.password).toBeTruthy();
    });

    test('unchanged setup config can continue without restarting the app', async () => {
        const config = loadConfig();
        const res = await request(app)
            .post('/api/setup/save')
            .set('X-Setup-Boot-Token', bootToken)
            .send({
                db: {
                    host: config.db.host,
                    port: config.db.port,
                    user: config.db.user,
                    password: '__USE_SAVED__',
                    name: config.db.name
                }
            });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, restartRequired: false });
    });

    test('invalid Electron boot token is rejected', async () => {
        const res = await request(app)
            .get('/api/setup/config')
            .set('X-Setup-Boot-Token', 'wrong-electron-boot-token');
        expect(res.status).toBe(401);
    });
});

// ── Recovery token ──

describe('Setup guard — recovery token', () => {
    beforeAll(() => setSetupCompleted(true));

    test('valid recovery token grants access even without auth', async () => {
        const token = generateRecoveryToken();
        const res = await request(app)
            .get('/api/setup/config')
            .set('X-Recovery-Token', token);
        expect(res.status).toBe(200);
    });

    test('invalid recovery token is rejected', async () => {
        generateRecoveryToken();
        const res = await request(app)
            .get('/api/setup/config')
            .set('X-Recovery-Token', 'wrong-token-value');
        expect(res.status).toBe(401);
    });
});

// ── Returning-install endpoints (pre-guard, localhost only) ──

describe('Setup — returning install', () => {
    beforeAll(() => setSetupCompleted(true));

    test('status reports completed setup without exposing the password', async () => {
        const res = await request(app).get('/api/setup/status');
        expect(res.status).toBe(200);
        expect(res.body.setup_completed).toBe(true);
        expect(res.body.db).toBeDefined();
        expect(res.body.db.password).toBeUndefined();
        expect(res.body.db.name).toBeTruthy();
    });

    test('test-saved verifies the saved config without a session', async () => {
        const res = await request(app).post('/api/setup/test-saved');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.version).toBeTruthy();
    });

    test('test-saved is rejected before setup is complete', async () => {
        setSetupCompleted(false);
        const res = await request(app).post('/api/setup/test-saved');
        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
        setSetupCompleted(true);
    });
});

// ── Config-manager unit tests ──

describe('config-manager setup helpers', () => {
    test('setup tests use isolated files and the disposable database', () => {
        expect(path.dirname(getConfigPath())).toBe(setupTestDir);
        expect(getConfigPath()).not.toBe(originalConfigPath);
        expect(loadConfig().db.name).toBe('brgydata_test');
    });
    test('isSetupCompleted reads the flag', () => {
        saveConfig({ setup_completed: false });
        expect(isSetupCompleted()).toBe(false);
        saveConfig({ setup_completed: true });
        expect(isSetupCompleted()).toBe(true);
    });

    test('markSetupCompleted sets the flag', () => {
        saveConfig({ setup_completed: false });
        markSetupCompleted();
        expect(isSetupCompleted()).toBe(true);
    });

    test('generateRecoveryToken creates a file with JSON payload', () => {
        const token = generateRecoveryToken();
        expect(token).toHaveLength(64);
        expect(fs.existsSync(getRecoveryTokenPath())).toBe(true);
        const raw = fs.readFileSync(getRecoveryTokenPath(), 'utf8');
        const parsed = JSON.parse(raw);
        expect(parsed.token).toBe(token);
        expect(typeof parsed.created).toBe('number');
    });

    test('wrong-length token is rejected without throwing', () => {
        generateRecoveryToken();
        const { validateRecoveryToken } = require('../config-manager');
        expect(validateRecoveryToken('short')).toBe(false);
        expect(validateRecoveryToken('')).toBe(false);
        expect(validateRecoveryToken('a'.repeat(128))).toBe(false);
    });

    test('expired token is rejected', () => {
        const { validateRecoveryToken } = require('../config-manager');
        const token = generateRecoveryToken();
        // Manually backdate the token file
        const raw = JSON.parse(fs.readFileSync(getRecoveryTokenPath(), 'utf8'));
        raw.created = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
        fs.writeFileSync(getRecoveryTokenPath(), JSON.stringify(raw), 'utf8');
        expect(validateRecoveryToken(token)).toBe(false);
        // Token file should be cleaned up
        expect(fs.existsSync(getRecoveryTokenPath())).toBe(false);
    });

    test('token is consumed after use', () => {
        const token = generateRecoveryToken();
        const { validateRecoveryToken, consumeRecoveryToken } = require('../config-manager');
        expect(validateRecoveryToken(token)).toBe(true);
        consumeRecoveryToken();
        expect(validateRecoveryToken(token)).toBe(false);
    });
});

// ── Token not leaked in responses ──

describe('Setup — token security', () => {
    test('/auto-detect does not return recovery token in response body', async () => {
        setSetupCompleted(false);
        const res = await request(app).post('/api/setup/auto-detect');
        expect(res.body.recoveryToken).toBeUndefined();
        // Restore
        setSetupCompleted(true);
    });

    test('/generate-recovery does not return token value over HTTP', async () => {
        setSetupCompleted(true);
        const bcrypt2 = require('bcryptjs');
        const hash = await bcrypt2.hash('genrecovtest', 10);
        await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Deputy Officer', 1)`,
            ['Recovery Gen Test', 'test_gen_recovery', hash]
        );
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ username: 'test_gen_recovery', password: 'genrecovtest' });

        const res = await request(app)
            .post('/api/setup/generate-recovery')
            .set('Authorization', `Bearer ${loginRes.body.session_token}`);

        expect(res.body.token).toBeUndefined();
        expect(res.body.message).toContain('file system');

        // Cleanup
        await pool.query('DELETE FROM login_attempts WHERE username = ?', ['test_gen_recovery']);
        await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', ['test_gen_recovery']);
        await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)', ['test_gen_recovery']);
        await pool.query('DELETE FROM login_history WHERE username = ?', ['test_gen_recovery']);
        await pool.query('DELETE FROM users WHERE username = ?', ['test_gen_recovery']);
    });
});
