/**
 * config-manager.js
 * -----------------
 * Centralised read / write / validate for the app's runtime config.
 *
 * Packaged (.exe) builds store a JSON file in %APPDATA%:
 *   %APPDATA%\Barangay 179 Crime BI\config.json
 *
 * Dev mode (npm start / node server.js) keeps using backend/.env as
 * before — loadConfig() reads whichever source is appropriate and
 * returns the same shape either way.
 *
 * On first packaged boot, if a legacy .env exists but no config.json,
 * the .env is auto-migrated.
 */

const fs   = require('fs');
const path = require('path');

// ── defaults ────────────────────────────────────────────────────────
const CONFIG_DEFAULTS = {
    db: {
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: '',
        name: 'brgydata',
    },
    server: {
        port: 3000,
    },
    email: {
        user: '',
        appPassword: '',
    },
};

// ── paths ───────────────────────────────────────────────────────────

/**
 * Where the JSON config lives when the app is packaged.
 * Electron's main.js should call setDataDir() early so we know the
 * right folder; otherwise we fall back to a sensible default.
 */
let _dataDir = null;

function setDataDir(dir) {
    _dataDir = dir;
}

function getDataDir() {
    if (_dataDir) return _dataDir;
    // Fallback: next to this file (backend/)
    return __dirname;
}

function getConfigPath() {
    return path.join(getDataDir(), 'config.json');
}

function getLegacyEnvPath() {
    // The legacy .env that older installs / dev mode uses
    if (_dataDir) return path.join(_dataDir, '.env');
    return path.join(__dirname, '.env');
}

// ── deep merge helper ───────────────────────────────────────────────

function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (
            source[key] !== null &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key]) &&
            typeof target[key] === 'object' &&
            target[key] !== null
        ) {
            result[key] = deepMerge(target[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

// ── .env → JSON migration ───────────────────────────────────────────

/**
 * Parse a dotenv-style file and return a config object matching our
 * CONFIG_DEFAULTS shape.
 */
function parseEnvToConfig(envText) {
    const vars = {};
    for (const line of envText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const val = trimmed.slice(eqIndex + 1).trim();
        vars[key] = val;
    }

    return {
        db: {
            host:     vars.DB_HOST     || CONFIG_DEFAULTS.db.host,
            port:     Number(vars.DB_PORT) || CONFIG_DEFAULTS.db.port,
            user:     vars.DB_USER     || CONFIG_DEFAULTS.db.user,
            password: vars.DB_PASSWORD !== undefined ? vars.DB_PASSWORD : CONFIG_DEFAULTS.db.password,
            name:     vars.DB_NAME     || CONFIG_DEFAULTS.db.name,
        },
        server: {
            port: Number(vars.PORT) || CONFIG_DEFAULTS.server.port,
        },
        email: {
            user:        vars.EMAIL_USER        || CONFIG_DEFAULTS.email.user,
            appPassword: vars.EMAIL_APP_PASSWORD || CONFIG_DEFAULTS.email.appPassword,
        },
    };
}

// ── load ────────────────────────────────────────────────────────────

/**
 * Load the config from config.json (packaged) or .env (dev).
 * Always returns a full object merged with defaults so callers never
 * have to null-check nested keys.
 */
function loadConfig() {
    const jsonPath = getConfigPath();

    // 1. Prefer config.json if it exists
    if (fs.existsSync(jsonPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            return deepMerge(CONFIG_DEFAULTS, raw);
        } catch {
            // Corrupted JSON — fall through to .env or defaults
        }
    }

    // 2. Try legacy .env
    const envPath = getLegacyEnvPath();
    if (fs.existsSync(envPath)) {
        try {
            const envText = fs.readFileSync(envPath, 'utf8');
            return parseEnvToConfig(envText);
        } catch {
            // Unreadable — fall through to defaults
        }
    }

    // 3. Nothing found — return bare defaults
    return { ...CONFIG_DEFAULTS };
}

// ── save ────────────────────────────────────────────────────────────

/**
 * Deep-merge `patch` into the existing config and write atomically.
 * Creates the data directory if needed.
 */
function saveConfig(patch) {
    const current  = loadConfig();
    const merged   = deepMerge(current, patch);
    const jsonPath = getConfigPath();
    const dir      = path.dirname(jsonPath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Atomic write: tmp → rename
    const tmpPath = jsonPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf8');
    fs.renameSync(tmpPath, jsonPath);
    return merged;
}

// ── validate ────────────────────────────────────────────────────────

/**
 * Quick structural validation of the db section.
 * Returns { valid: boolean, errors: string[] }.
 */
function validateDbConfig(cfg) {
    const errors = [];
    if (!cfg)          { return { valid: false, errors: ['No config provided'] }; }
    if (!cfg.db)       { return { valid: false, errors: ['Missing "db" section'] }; }

    const { host, port, user, name } = cfg.db;
    if (!host || typeof host !== 'string') errors.push('db.host is required');
    if (!Number.isFinite(port) || port < 1 || port > 65535) errors.push('db.port must be 1-65535');
    if (!user || typeof user !== 'string') errors.push('db.user is required');
    if (!name || typeof name !== 'string') errors.push('db.name is required');
    // password is allowed to be empty (some local MySQL installs have no password)

    return { valid: errors.length === 0, errors };
}

// ── migrate ─────────────────────────────────────────────────────────

/**
 * If a legacy .env exists in the data directory but no config.json,
 * convert it and rename the .env so it isn't read again.
 * Safe to call on every boot — it no-ops when there's nothing to do.
 */
function migrateIfNeeded() {
    const jsonPath = getConfigPath();
    if (fs.existsSync(jsonPath)) return; // already migrated

    const envPath = getLegacyEnvPath();
    if (!fs.existsSync(envPath)) return; // nothing to migrate

    try {
        const envText = fs.readFileSync(envPath, 'utf8');
        const config  = parseEnvToConfig(envText);
        saveConfig(config);
        // Rename so we don't migrate again
        fs.renameSync(envPath, envPath + '.migrated');
        console.log(`✅ Migrated ${envPath} → ${jsonPath}`);
    } catch (err) {
        console.warn('⚠️  .env migration failed, will use defaults:', err.message);
    }
}

// ── apply config to process.env ─────────────────────────────────────

/**
 * Writes the loaded config back into process.env so existing code that
 * reads process.env.DB_HOST etc. keeps working without changes.
 * Call this once at boot, after loadConfig().
 */
function applyToProcessEnv(cfg) {
    process.env.DB_HOST         = cfg.db.host;
    process.env.DB_PORT         = String(cfg.db.port);
    process.env.DB_USER         = cfg.db.user;
    process.env.DB_PASSWORD     = cfg.db.password;
    process.env.DB_NAME         = cfg.db.name;
    process.env.PORT            = String(cfg.server.port);
    process.env.EMAIL_USER      = cfg.email.user;
    process.env.EMAIL_APP_PASSWORD = cfg.email.appPassword;
}

// ── public API ──────────────────────────────────────────────────────

module.exports = {
    CONFIG_DEFAULTS,
    setDataDir,
    getDataDir,
    getConfigPath,
    loadConfig,
    saveConfig,
    validateDbConfig,
    migrateIfNeeded,
    applyToProcessEnv,
    parseEnvToConfig,
};
