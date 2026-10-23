/**
 * routes/setup.js — hardened setup wizard (H-3)
 *
 * Security model:
 *   Fresh install (setup_completed === false):
 *     - Only localhost requests are allowed (Electron desktop app).
 *     - No auth token required (DB doesn't exist yet).
 *   After initial setup (setup_completed === true):
 *     - Only authenticated Executive Officer can access.
 *     - Localhost restriction lifted (admin may reconfigure remotely).
 *   Recovery mode:
 *     - A file-based, single-use, time-limited recovery token lets a
 *       LOCAL operator regain access when the DB is down.
 *     - Recovery tokens are consumed after the save operation.
 *     - Recovery is restricted to localhost.
 */

const express = require('express');
const mysql   = require('mysql2/promise');
const crypto  = require('crypto');
const { hashToken } = require('../token-utils');
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
    getRecoveryTokenPath,
} = require('../config-manager');

const router = express.Router();

// ── helpers ───────────────────────────────────────────────────────

function isLocalhostRequest(req) {
    const ip = req.ip || req.connection?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function logSetupAccess(req, action, granted, reason) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const msg = `[SETUP-AUDIT] ${action} from ${ip} — ${granted ? 'ALLOWED' : 'DENIED'}: ${reason}`;
    if (granted) {
        console.log(msg);
    } else {
        console.warn(msg);
    }
}

function secretsMatch(candidate, expected) {
    if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
    const candidateBuffer = Buffer.from(candidate);
    const expectedBuffer = Buffer.from(expected);
    return candidateBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

// ── security middleware ───────────────────────────────────────────

async function setupGuard(req, res, next) {
    const setupDone = isSetupCompleted();

    // Electron creates a fresh in-memory token for every launch and passes it
    // only to its setup window. This authorizes the mandatory pre-login setup
    // gate without exposing post-setup configuration to arbitrary localhost
    // requests. Browser access without the token still follows normal auth.
    const bootToken = req.headers['x-setup-boot-token'];
    if (bootToken) {
        if (!isLocalhostRequest(req)) {
            logSetupAccess(req, req.method + ' ' + req.path, false, 'boot token from non-localhost');
            return res.status(403).json({ error: 'Setup boot access is local-only.' });
        }
        if (secretsMatch(bootToken, process.env.SETUP_BOOT_TOKEN)) {
            req.setupBootMode = true;
            logSetupAccess(req, req.method + ' ' + req.path, true, 'valid Electron boot token');
            return next();
        }
        logSetupAccess(req, req.method + ' ' + req.path, false, 'invalid Electron boot token');
        return res.status(401).json({ error: 'Invalid setup boot token.' });
    }

    // ── Recovery token bypass (localhost-only, any setup state) ──
    const recoveryHeader = req.headers['x-recovery-token'];
    if (recoveryHeader) {
        if (!isLocalhostRequest(req)) {
            logSetupAccess(req, req.method + ' ' + req.path, false, 'recovery token from non-localhost');
            return res.status(403).json({ error: 'Recovery is only available from the local machine.' });
        }
        if (validateRecoveryToken(recoveryHeader)) {
            req.recoveryMode = true;
            logSetupAccess(req, req.method + ' ' + req.path, true, 'valid recovery token (localhost)');
            return next();
        }
        logSetupAccess(req, req.method + ' ' + req.path, false, 'invalid or expired recovery token');
        return res.status(401).json({ error: 'Invalid or expired recovery token.' });
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

    // ── Post-setup: require Executive Officer auth ──
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logSetupAccess(req, req.method + ' ' + req.path, false, 'post-setup — no auth token');
        return res.status(401).json({
            error: 'Authentication required. Only the Executive Officer can modify setup after initial configuration.',
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
        const setupTokenHash = hashToken(token);
        const [sessions] = await pool.query(
            `SELECT s.user_id, u.role
             FROM user_sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.session_token = ? AND s.is_active = 1 AND s.logout_time IS NULL AND u.is_active = 1`,
            [setupTokenHash]
        );

        if (sessions.length === 0) {
            logSetupAccess(req, req.method + ' ' + req.path, false, 'post-setup — invalid/expired token');
            return res.status(401).json({ error: 'Invalid or expired session.' });
        }

        const { role } = sessions[0];
        if (!['Executive Officer', 'Deputy Officer'].includes(role)) {
            logSetupAccess(req, req.method + ' ' + req.path, false, `post-setup — role ${role} denied`);
            return res.status(403).json({ error: 'Forbidden: only the Executive Officer can change setup.' });
        }

        req.userId = sessions[0].user_id;
        logSetupAccess(req, req.method + ' ' + req.path, true, 'post-setup — Executive Officer');
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
        const previous = loadConfig();

        if (patch.db && patch.db.password === '__USE_SAVED__') {
            patch.db.password = previous.db.password;
        }

        const validation = validateDbConfig(patch);
        if (!validation.valid) {
            return res.status(400).json({ ok: false, errors: validation.errors });
        }

        const merged = saveConfig(patch);
        applyToProcessEnv(merged);

        const connectionChanged = ['host', 'port', 'user', 'password', 'name']
            .some(key => String(previous.db[key] ?? '') !== String(merged.db[key] ?? ''));

        const wasFirstSetup = !isSetupCompleted();

        if (wasFirstSetup) {
            markSetupCompleted();
            generateRecoveryToken();
            console.log('[SETUP] Initial setup complete. Recovery token written to file system.');
        }

        if (req.recoveryMode) {
            consumeRecoveryToken();
        }

        res.json({ ok: true, firstSetup: wasFirstSetup, restartRequired: connectionChanged });
        if (connectionChanged) {
            setImmediate(() => process.emit('setup-config-changed'));
        }
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
    if (!isLocalhostRequest(req)) {
        logSetupAccess(req, 'generate-recovery', false, 'non-localhost');
        return res.status(403).json({ error: 'Recovery tokens can only be generated from the local machine.' });
    }
    generateRecoveryToken();
    logSetupAccess(req, 'generate-recovery', true, 'new recovery token written to file');
    res.json({ ok: true, message: 'Recovery token written to file system. Check the server data directory.' });
});

// ── POST /api/setup/auto-detect ──────────────────────────────────

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
            generateRecoveryToken();
            console.log('[SETUP] Existing installation detected — setup locked. Recovery token written to file system.');
            res.json({ ok: true, detected: true, userCount: row.cnt });
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
