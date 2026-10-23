/**
 * routes/setup.js — hardened setup wizard (H-3)
 *
 * Security model:
 *   Fresh install (setup_completed === false):
 *     - Only localhost requests are allowed (Electron desktop app).
 *     - No auth token required (DB doesn't exist yet).
 *   After initial setup (setup_completed === true):
 *     - Only authenticated Deputy Officer can access.
 *     - Localhost restriction lifted (admin may reconfigure remotely).
 *   Recovery mode:
 *     - A file-based recovery token lets an operator regain access
 *       if the DB is down or admin credentials are lost.
 */

const express = require('express');
const mysql   = require('mysql2/promise');
const {
    loadConfig,
    saveConfig,
    validateDbConfig,
    applyToProcessEnv,
    isSetupCompleted,
    markSetupCompleted,
    generateRecoveryToken,
    validateRecoveryToken,
    consumeRecoveryToken,
} = require('../config-manager');

const router = express.Router();

// ── helpers ───────────────────────────────────────────────────────

function isLocalhostRequest(req) {
    const ip = req.ip || req.connection?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function logSetupAccess(req, action, granted, reason) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const level = granted ? 'info' : 'warn';
    const msg = `[SETUP-AUDIT] ${action} from ${ip} — ${granted ? 'ALLOWED' : 'DENIED'}: ${reason}`;
    if (level === 'warn') {
        console.warn(msg);
    } else {
        console.log(msg);
    }
}

// ── security middleware ───────────────────────────────────────────

async function setupGuard(req, res, next) {
    const setupDone = isSetupCompleted();

    // ── Recovery token bypass (works in any state) ──
    const recoveryHeader = req.headers['x-recovery-token'];
    if (recoveryHeader) {
        if (validateRecoveryToken(recoveryHeader)) {
            req.recoveryMode = true;
            logSetupAccess(req, req.method + ' ' + req.path, true, 'valid recovery token');
            return next();
        }
        logSetupAccess(req, req.method + ' ' + req.path, false, 'invalid recovery token');
        return res.status(401).json({ error: 'Invalid recovery token.' });
    }

    // ── Fresh install: localhost-only, no auth needed ──
    if (!setupDone) {
        if (!isLocalhostRequest(req)) {
            logSetupAccess(req, req.method + ' ' + req.path, false, 'fresh install — non-localhost');
            return res.status(403).json({
                error: 'Setup is only available from the local machine on first install.',
            });
        }
        logSetupAccess(req, req.method + ' ' + req.path, true, 'fresh install — localhost');
        return next();
    }

    // ── Post-setup: require Deputy Officer auth ──
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logSetupAccess(req, req.method + ' ' + req.path, false, 'post-setup — no auth token');
        return res.status(401).json({
            error: 'Authentication required. Only the Deputy Officer can modify setup after initial configuration.',
        });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        logSetupAccess(req, req.method + ' ' + req.path, false, 'post-setup — empty token');
        return res.status(401).json({ error: 'Authentication required.' });
    }

    let pool;
    try {
        pool = require('../server').pool;
    } catch (_) {
        logSetupAccess(req, req.method + ' ' + req.path, false, 'post-setup — pool unavailable');
        return res.status(503).json({
            error: 'Database unavailable. Use a recovery token to reconfigure.',
        });
    }

    if (!pool) {
        logSetupAccess(req, req.method + ' ' + req.path, false, 'post-setup — pool null');
        return res.status(503).json({
            error: 'Database unavailable. Use a recovery token to reconfigure.',
        });
    }

    try {
        const [sessions] = await pool.query(
            `SELECT s.user_id, u.role
             FROM user_sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.session_token = ? AND s.is_active = 1 AND s.logout_time IS NULL AND u.is_active = 1`,
            [token]
        );

        if (sessions.length === 0) {
            logSetupAccess(req, req.method + ' ' + req.path, false, 'post-setup — invalid/expired token');
            return res.status(401).json({ error: 'Invalid or expired session.' });
        }

        const { role } = sessions[0];
        if (role !== 'Deputy Officer') {
            logSetupAccess(req, req.method + ' ' + req.path, false, `post-setup — role ${role} denied`);
            return res.status(403).json({ error: 'Forbidden: only the Deputy Officer can change setup.' });
        }

        req.userId = sessions[0].user_id;
        logSetupAccess(req, req.method + ' ' + req.path, true, 'post-setup — Deputy Officer');
        return next();
    } catch (err) {
        logSetupAccess(req, req.method + ' ' + req.path, false, `post-setup — DB error: ${err.message}`);
        return res.status(503).json({
            error: 'Database unavailable. Use a recovery token to reconfigure.',
        });
    }
}

router.use(setupGuard);

// ── GET /api/setup/config ────────────────────────────────────────

router.get('/config', (req, res) => {
    try {
        const config = loadConfig();

        const masked = JSON.parse(JSON.stringify(config));
        if (masked.db) {
            masked.db.password = masked.db.password ? '••••••' : '';
        }

        res.json(masked);
    } catch (err) {
        console.error('Setup /config error:', err.message);
        res.status(500).json({ error: 'Failed to load configuration.' });
    }
});

// ── POST /api/setup/test ─────────────────────────────────────────

router.post('/test', async (req, res) => {
    const { host, port, user, password, database } = req.body;

    let realPassword = password;
    if (password === '__USE_SAVED__') {
        const saved = loadConfig();
        realPassword = saved.db.password;
    }

    let conn;
    try {
        conn = await mysql.createConnection({
            host:     host     || 'localhost',
            port:     Number(port) || 3306,
            user:     user     || 'root',
            password: realPassword || '',
            database: database || 'brgydata',
        });

        const [[versionRow]] = await conn.query('SELECT VERSION() AS version');
        const version = versionRow.version;

        const [[tableRow]] = await conn.query(
            'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ?',
            [database || 'brgydata']
        );
        const tables = tableRow.count;

        res.json({ ok: true, version, tables });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    } finally {
        if (conn) {
            try { conn.destroy(); } catch (_) { /* ignore */ }
        }
    }
});

// ── POST /api/setup/save ─────────────────────────────────────────

router.post('/save', async (req, res) => {
    try {
        const patch = req.body;

        if (patch.db && patch.db.password === '__USE_SAVED__') {
            const saved = loadConfig();
            patch.db.password = saved.db.password;
        }

        const validation = validateDbConfig(patch);
        if (!validation.valid) {
            return res.status(400).json({ ok: false, errors: validation.errors });
        }

        const merged = saveConfig(patch);
        applyToProcessEnv(merged);

        const wasFirstSetup = !isSetupCompleted();

        if (wasFirstSetup) {
            markSetupCompleted();
            const token = generateRecoveryToken();
            console.log('═══════════════════════════════════════════════════');
            console.log('  SETUP COMPLETE — Recovery token generated.');
            console.log('  Store this token securely for emergency access:');
            console.log(`  ${token}`);
            console.log('═══════════════════════════════════════════════════');
        }

        if (req.recoveryMode) {
            consumeRecoveryToken();
        }

        res.json({ ok: true, firstSetup: wasFirstSetup });
    } catch (err) {
        console.error('Setup /save error:', err.message);
        res.status(500).json({ error: 'Failed to save configuration.' });
    }
});

// ── POST /api/setup/generate-recovery ────────────────────────────

router.post('/generate-recovery', (req, res) => {
    if (!isSetupCompleted()) {
        return res.status(400).json({ error: 'Setup not yet completed.' });
    }
    const token = generateRecoveryToken();
    logSetupAccess(req, 'generate-recovery', true, 'new recovery token issued');
    res.json({ ok: true, token });
});

// ── POST /api/setup/auto-detect ──────────────────────────────────
// On first boot, check if this is an existing installation (DB has
// users) and auto-set setup_completed = true so the wizard locks.

router.post('/auto-detect', async (req, res) => {
    if (isSetupCompleted()) {
        return res.json({ ok: true, detected: false, message: 'Already configured.' });
    }

    const config = loadConfig();
    let conn;
    try {
        conn = await mysql.createConnection({
            host:     config.db.host,
            port:     config.db.port,
            user:     config.db.user,
            password: config.db.password,
            database: config.db.name,
        });

        const [[row]] = await conn.query('SELECT COUNT(*) AS cnt FROM users WHERE is_active = 1');
        if (row.cnt > 0) {
            markSetupCompleted();
            const token = generateRecoveryToken();
            console.log('[SETUP] Existing installation detected — setup locked. Recovery token generated.');
            res.json({ ok: true, detected: true, userCount: row.cnt, recoveryToken: token });
        } else {
            res.json({ ok: true, detected: false, message: 'No users found — fresh install.' });
        }
    } catch (err) {
        res.json({ ok: true, detected: false, message: `DB not reachable: ${err.message}` });
    } finally {
        if (conn) {
            try { conn.destroy(); } catch (_) { /* ignore */ }
        }
    }
});

module.exports = router;
