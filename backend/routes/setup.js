/**
 * routes/setup.js
 * ---------------
 * Express router for the first-run setup wizard.  These endpoints let
 * the frontend read / test / save the database configuration before the
 * app has ever connected to MySQL (and therefore before any user table
 * or session table exists).
 *
 * Security: a `setupGuard` middleware allows access in two cases:
 *   1. No session token present (pre-login / first boot) — open.
 *   2. A valid admin session — open.
 * Non-admin logged-in users are rejected with 403.
 */

const express = require('express');
const mysql   = require('mysql2/promise');
const {
    loadConfig,
    saveConfig,
    validateDbConfig,
    applyToProcessEnv,
} = require('../config-manager');

const router = express.Router();

// ── security middleware ────────────────────────────────────────────
/**
 * setupGuard
 * ----------
 * If the request carries a Bearer token:
 *   - Try to look up a matching active session + user.
 *   - If the user is an Administrator → allow.
 *   - If the user is any other role  → 403 Forbidden.
 *   - If the token is invalid / expired → allow (treat as "no session",
 *     i.e. pre-login mode — the setup wizard must work before any DB is
 *     available, so we can't hard-fail on a bad token here).
 * If no token is present → allow (pre-login mode).
 *
 * The pool import is late-bound: at require-time the pool may not exist
 * yet (the setup wizard runs precisely because the DB isn't configured).
 */
async function setupGuard(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // No token — pre-login mode, allow through.
        return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) return next();

    // Late-require: the main server.js exports `pool`; it may be null
    // or the DB may be unreachable on first boot.
    let pool;
    try {
        pool = require('../server').pool;
    } catch (_) {
        // server.js hasn't finished loading yet (circular require) or
        // pool is unavailable — treat as pre-login.
        return next();
    }

    if (!pool) return next();

    try {
        const [sessions] = await pool.query(
            `SELECT s.user_id, u.role
             FROM user_sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.session_token = ? AND s.is_active = 1 AND s.logout_time IS NULL AND u.is_active = 1`,
            [token]
        );

        if (sessions.length === 0) {
            // Invalid / expired token — treat as pre-login.
            return next();
        }

        const { role } = sessions[0];
        if (role === 'Administrator') {
            req.userId = sessions[0].user_id;
            return next();
        }

        // Non-admin with a valid session — blocked.
        return res.status(403).json({ error: 'Forbidden: only administrators can change setup.' });
    } catch (_) {
        // DB query failed (e.g. tables don't exist yet) — treat as pre-login.
        return next();
    }
}

// Apply the guard to every route on this router.
router.use(setupGuard);

// ── GET /api/setup/config ──────────────────────────────────────────
/**
 * Return the current config with the DB password masked.
 * No auth required (runs before login).
 */
router.get('/config', (req, res) => {
    try {
        const config = loadConfig();

        // Mask the password for the response.
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

// ── POST /api/setup/test ───────────────────────────────────────────
/**
 * Test a database connection with the supplied credentials.
 * Creates a one-off mysql2 connection (NOT from the pool).
 */
router.post('/test', async (req, res) => {
    const { host, port, user, password, database } = req.body;

    // If the frontend sends '__USE_SAVED__', the user hasn't changed the
    // password — read the real one from the persisted config.
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

// ── POST /api/setup/save ──────────────────────────────────────────
/**
 * Validate, persist and apply a new database configuration.
 * Body: { db: { host, port, user, password, name } }
 */
router.post('/save', (req, res) => {
    try {
        const patch = req.body;

        // If the password was not changed (still masked), carry forward
        // the real saved password so we don't overwrite it with the mask.
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

        res.json({ ok: true });
    } catch (err) {
        console.error('Setup /save error:', err.message);
        res.status(500).json({ error: 'Failed to save configuration.' });
    }
});

module.exports = router;
