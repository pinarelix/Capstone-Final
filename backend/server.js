const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const crypto = require('crypto');
const Joi = require('joi');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const NodeCache = require('node-cache');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const expressRateLimit = require('express-rate-limit');
const cartEngine = require('./cart-engine');
const { normalizeRole, LEGACY_EXECUTIVE } = require('./roles');
const { createRecordPatrol, notesSchema, overrideSchema, dateOnlySchema } = require('./recordPatrol');
const { BARANGAY_LOCATIONS } = require('./locationList');
const { createArchive, registerArchiveRoutes } = require('./archive');
const { isSetupCompleted, markSetupCompleted, generateRecoveryToken } = require('./config-manager');
const { hashToken, generateSessionToken, generateResetToken } = require('./token-utils');
const { pagination, validatedSearch, appendDateFilters, registerRecordSummaries } = require('./recordQueries');

// The installed desktop app passes APP_CONFIG_PATH/UPLOADS_DIR (see
// main.js) so settings and uploaded files live in the user's AppData
// folder - the install folder gets wiped on every reinstall/uninstall.
// Running from source (npm start / node server.js) keeps using
// backend/.env and backend/uploads as before.
dotenv.config({ path: process.env.APP_CONFIG_PATH || path.join(__dirname, '.env') });
const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

const app = express();
const PORT = process.env.PORT || 3000;
const SERVER_START_TIME = Date.now();

// Caches GET /api/heatmap/incidents' result — that query re-runs on
// every risk-map load, but the underlying data only changes when an
// incident is created/updated/deleted. stdTTL is just a safety-net
// expiry; the real invalidation is the explicit heatmapCache.del(...)
// calls next to every incident-mutating route below.
const heatmapCache = new NodeCache({ stdTTL: 60 });

// ============================================================
// LIVE NOTIFICATIONS (Server-Sent Events)
// Push-style alerts to connected staff browsers - currently just "a
// new incident was reported". Each open /api/notifications/stream
// connection's `res` object is kept here only in-memory (no DB table,
// no offline queue) - a staff member who isn't actively connected at
// the moment an incident comes in simply doesn't get that alert; it's
// a live heads-up, not a notification inbox.
// ============================================================
const notificationClients = new Set();

function broadcastNotification(payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of notificationClients) {
        client.write(data);
    }
}

// ============================================================
// MIDDLEWARE
// ============================================================
// No CORS middleware — the app converted from a two-port web app
// (frontend on :5500, API on :3000) to a single-origin Electron app
// where Express serves the frontend itself (see express.static below).
// Every request is same-origin now, so a CORS allowlist has nothing
// left to do.

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // OSM requires an identifiable client/referrer. Helmet's no-referrer
    // default removes the origin even though tile requests are permitted.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "font-src 'self'; " +
        "img-src 'self' data: blob: https://tile.openstreetmap.org; " +
        "connect-src 'self' https://tile.openstreetmap.org; " +
        "worker-src 'self' blob:; " +
        "frame-src 'none'"
    );
    next();
});

const apiLimiter = expressRateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again shortly.' }
});
app.use('/api/', apiLimiter);

// Bundled fonts/icons and versioned vendor libraries should be reused during
// navigation. HTML and application scripts retain revalidation on upgrade.
app.use('/vendor', express.static(path.join(__dirname, '..', 'frontend', 'vendor'), { maxAge: '1d' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Gated by a short-lived file token (?ftoken=...) instead of being a
// bare, unauthenticated static mount - see FILE ACCESS TOKENS below.
app.use('/uploads', (req, res, next) => {
    const identity = verifyFileToken(req.query.ftoken);
    if (!identity) {
        return res.status(401).json({ error: 'Unauthorized: missing or expired file token' });
    }
    next();
}, express.static(UPLOADS_ROOT));

// ============================================================
// UPLOADS (incident evidence - admin-attached images/videos)
// ============================================================
const INCIDENT_EVIDENCE_DIR = path.join(UPLOADS_ROOT, 'incident-evidence');
fs.mkdirSync(INCIDENT_EVIDENCE_DIR, { recursive: true });

const EVIDENCE_MIME_EXT = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov'
};

const evidenceUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, INCIDENT_EVIDENCE_DIR),
        filename: (req, file, cb) => {
            const ext = EVIDENCE_MIME_EXT[file.mimetype] || '';
            cb(null, `evidence-${parseInt(req.params.id, 10) || 0}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
        }
    }),
    // Videos need more headroom than a photo - 25MB keeps a short mobile
    // clip usable without letting uploads balloon unreasonably.
    limits: { fileSize: 25 * 1024 * 1024, files: 5 },
    fileFilter: (req, file, cb) => {
        const allowed = Object.keys(EVIDENCE_MIME_EXT);
        cb(allowed.includes(file.mimetype) ? null : new Error('Only JPEG, PNG, WEBP images or MP4, WEBM, MOV videos are allowed.'), allowed.includes(file.mimetype));
    }
});

// Multer reports errors (file too big, wrong type) via a callback, not a
// thrown exception an async route's try/catch would see — this adapts
// it to the same clean-JSON-error style as the rest of the API instead
// of falling through to Express's default HTML error page.
function runMulterMiddleware(middleware) {
    return (req, res, next) => {
        middleware(req, res, (err) => {
            if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
            next();
        });
    };
}

const ALLOWED_MAGIC_MIMES = new Set([
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime'
]);

let fileTypeModulePromise;
function loadFileType() {
    fileTypeModulePromise ||= import('file-type');
    return fileTypeModulePromise;
}

async function validateMagicBytes(req, res, next) {
    const files = req.file ? [req.file] : (req.files || []);
    for (const file of files) {
        try {
            const { fileTypeFromFile } = await loadFileType();
            const type = await fileTypeFromFile(file.path);
            if (!type || !ALLOWED_MAGIC_MIMES.has(type.mime)) {
                fs.unlink(file.path, () => {});
                return res.status(400).json({
                    error: `File "${file.originalname}" failed magic-byte verification. ` +
                           `Expected an image or video but detected: ${type ? type.mime : 'unknown'}.`
                });
            }
        } catch (err) {
            fs.unlink(file.path, () => {});
            return res.status(400).json({ error: `Could not verify file "${file.originalname}".` });
        }
    }
    next();
}

// ============================================================
// DATABASE CONNECTION
// ============================================================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'brgydata',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Pin utf8mb4 end-to-end so names/addresses with ñ, accents and other
    // multibyte characters store and round-trip correctly.
    charset: 'utf8mb4',
    // Return DATE columns as plain 'YYYY-MM-DD' strings instead of JS Date
    // objects. Without this, mysql2 builds the Date at local midnight and
    // res.json() serializes it as UTC, silently shifting the date back one
    // day for any timezone ahead of UTC (e.g. Asia/Manila, UTC+8).
    dateStrings: ['DATE']
});

// ── Idempotency cache (prevents duplicate POST submissions) ────────────────
const _idempotencyCache = new Map();
const IDEMPOTENCY_TTL = 60000;
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _idempotencyCache) { if (now - v.ts > IDEMPOTENCY_TTL) _idempotencyCache.delete(k); }
}, 30000).unref();

setInterval(async () => {
    try {
        const timeoutMin = await getSessionTimeoutMinutes().catch(() => 30);
        await pool.query(
            `UPDATE user_sessions SET is_active = 0, logout_time = NOW()
             WHERE is_active = 1 AND logout_time IS NULL
               AND last_activity < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
            [timeoutMin]
        );
    } catch {}
}, 5 * 60 * 1000).unref();

// ── Option A record routing helpers ─────────────────────────────────────────
// `incidents` is now a compatibility VIEW over blotter_records + incident_records
// (joined through record_registry). Reads use the view unchanged; writes must
// target the correct base table and keep the registry in step. The record id the
// whole app uses (incidents.id, cart_risk_factors.incident_id,
// incident_evidence.incident_id, audit entity_id) is the registry_id.
const { codeFor, isValidType } = require('./recordTypes');

const recordClassFromFormType = ft => (ft === 'crime' ? 'incident' : 'blotter');
const baseTableForClass = cls => (cls === 'incident' ? 'incident_records' : 'blotter_records');
const prefixForClass = cls => (cls === 'incident' ? 'INC' : 'BLT');

// registry_id -> { source, source_id, table } (null if unknown).
async function resolveRegistry(executor, registryId) {
    const [rows] = await executor.query('SELECT source, source_id FROM record_registry WHERE registry_id = ?', [registryId]);
    if (!rows.length) return null;
    return { source: rows[0].source, source_id: rows[0].source_id, table: baseTableForClass(rows[0].source) };
}

// Concurrency-safe next public number {PREFIX}-{CODE}-{NNNN}. Never MAX(id)+1:
// an atomic INSERT ... ON DUPLICATE KEY UPDATE on record_number_counters.
async function allocPublicNumber(conn, prefix, code) {
    const [res] = await conn.query(
        `INSERT INTO record_number_counters (prefix, type_code, next_seq) VALUES (?, ?, 2)
         ON DUPLICATE KEY UPDATE next_seq = LAST_INSERT_ID(next_seq + 1)`,
        [prefix, code]
    );
    let seq;
    if (res.affectedRows === 1) {
        seq = 1; // fresh counter row: allocated seq 1, stored next_seq 2
    } else {
        const [[r]] = await conn.query('SELECT LAST_INSERT_ID() AS v');
        seq = r.v - 1; // v is the new next_seq; the allocated seq is one less
    }
    return `${prefix}-${code}-${String(seq).padStart(4, '0')}`;
}

// Write the computed danger level back onto the base record behind a registry_id
// (the `incidents` view is not updatable).
async function writeDangerLevelToBase(executor, registryId, dangerLevel, timeOfDay) {
    const reg = await resolveRegistry(executor, registryId);
    if (!reg) return;
    if (timeOfDay !== undefined) {
        await executor.query(`UPDATE \`${reg.table}\` SET danger_level = ?, time_of_day = ? WHERE id = ?`,
            [dangerLevel, timeOfDay, reg.source_id]);
    } else {
        await executor.query(`UPDATE \`${reg.table}\` SET danger_level = ? WHERE id = ?`,
            [dangerLevel, reg.source_id]);
    }
}

// Join name parts into one string (null if all empty).
function composeName(first, middle, last) {
    const full = [first, middle, last].map(s => (s || '').trim()).filter(Boolean).join(' ');
    return full || null;
}

// Compose the single legacy address string from the structured parts, falling
// back to any address string the client sent.
function composeStructuredAddress(b) {
    const parts = [];
    if (b.addr_block) parts.push(`Blk ${b.addr_block}`);
    if (b.addr_lot) parts.push(`Lot ${b.addr_lot}`);
    if (b.addr_house_no) parts.push(`House No. ${b.addr_house_no}`);
    if (b.addr_unit) parts.push(`Unit ${b.addr_unit}`);
    if (parts.length === 0 && b.address) return b.address;
    const street = b.addr_street || b.street_name;
    let composed = parts.join(', ');
    if (street) composed = composed ? `${composed}, ${street}` : street;
    return composed || b.address || null;
}

function composeRespondentAddress(b) {
    const parts = [];
    if (b.resp_addr_block) parts.push(`Blk ${b.resp_addr_block}`);
    if (b.resp_addr_lot) parts.push(`Lot ${b.resp_addr_lot}`);
    if (b.resp_addr_house_no) parts.push(`House No. ${b.resp_addr_house_no}`);
    if (b.resp_addr_unit) parts.push(`Unit ${b.resp_addr_unit}`);
    const street = b.resp_addr_street;
    let composed = parts.join(', ');
    if (street) composed = composed ? `${composed}, ${street}` : street;
    return composed || b.respondent_address || null;
}

// Build the full base-table row from the request body (legacy + structured).
// The compatibility view composes the display name from the structured columns
// first, so reported_by_name / respondent_name are stored as a convenience
// fallback. Draft and no-evidence flags are carried through.
function buildIncidentFields(b, derived, typeCode, reporterId) {
    return {
        incident_type: b.incident_type,
        type_code: typeCode,
        date: b.date,
        time: b.time,
        latitude: b.latitude,
        longitude: b.longitude,
        street_name: b.street_name || null,
        addr_block: b.addr_block || null,
        addr_lot: b.addr_lot || null,
        addr_house_no: b.addr_house_no || null,
        addr_street: b.addr_street || b.street_name || null,
        addr_unit: b.addr_unit || null,
        address: composeStructuredAddress(b),
        complainant_first: b.complainant_first || null,
        complainant_middle: b.complainant_middle || null,
        complainant_last: b.complainant_last || null,
        complainant_contact: b.complainant_contact || null,
        respondent_first: b.respondent_first || null,
        respondent_middle: b.respondent_middle || null,
        respondent_last: b.respondent_last || null,
        resp_addr_street: b.resp_addr_street || null,
        resp_addr_block: b.resp_addr_block || null,
        resp_addr_lot: b.resp_addr_lot || null,
        resp_addr_house_no: b.resp_addr_house_no || null,
        resp_addr_unit: b.resp_addr_unit || null,
        respondent_address: composeRespondentAddress(b),
        respondent_age: b.age != null ? b.age : null,
        reporter_first: b.reporter_first || null,
        reporter_middle: b.reporter_middle || null,
        reporter_last: b.reporter_last || null,
        reporter_address: b.reporter_address || null,
        reporter_contact: b.reporter_contact || null,
        reporter_id: reporterId,
        reported_by_name: composeName(b.complainant_first, b.complainant_middle, b.complainant_last)
            || composeName(b.reporter_first, b.reporter_middle, b.reporter_last)
            || b.reported_by_name || null,
        respondent_name: composeName(b.respondent_first, b.respondent_middle, b.respondent_last)
            || b.respondent_name || null,
        severity: b.severity || 'Low',
        priority: b.priority || 'Normal',
        status: b.status || 'Open',
        is_draft: b.is_draft ? 1 : 0,
        description: b.description || '',
        statement: b.statement || null,
        recommended_action: b.recommended_action || '',
        danger_level: 'Calculated by System',
        no_evidence: b.no_evidence ? 1 : 0,
        no_evidence_reason: b.no_evidence_reason || null,
        time_of_day: derived.timeOfDay,
        day_of_week: derived.dayOfWeek,
        is_weekend: derived.isWeekend,
    };
}

const archive = createArchive({ pool, uploadsRoot: UPLOADS_ROOT });

async function testConnection() {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 3000;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const connection = await pool.getConnection();
            console.log('✅ Database connected successfully!');
            console.log(`📁 Using database: ${process.env.DB_NAME || 'brgydata'}`);
            connection.release();
            break;
        } catch (err) {
            if (attempt < MAX_RETRIES) {
                console.warn(`⚠️  DB connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            } else {
                throw new Error(`Could not connect to database after ${MAX_RETRIES} attempts: ${err.message}`);
            }
        }
    }

    // DDL migrations have been extracted to scripts/migrate.js.
    // Run `node scripts/migrate.js` before first startup or after
    // schema changes. The runtime account needs only SIUD privileges.
}

// ============================================================
// 📋 JOI VALIDATION SCHEMAS
// ============================================================

// Incident Schema
const incidentSchema = Joi.object({
    patrol_notes: notesSchema,
    patrol_override: Joi.any().strip(),
    incident_type: Joi.string().max(150).required(),
    date: Joi.date().required(),
    time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    street_name: Joi.string().valid(...BARANGAY_LOCATIONS).required(),
    // Optional: the structured address fields (addr_*) now carry the detail and
    // the server composes this string from them when it is not sent directly.
    address: Joi.string().max(255).allow('', null),
    reporter_id: Joi.any().strip(),
    status: Joi.string().valid('Open', 'Monitoring', 'Resolved').required(),
    description: Joi.string().max(2000).allow('', null),
    recommended_action: Joi.string().max(1000).allow('', null),
    blotter_number: Joi.string().max(50).allow('', null),
    reported_by_name: Joi.string().max(150).allow('', null),
    statement: Joi.string().max(3000).allow('', null),
    persons_involved: Joi.string().max(1000).allow('', null),
    priority: Joi.string().valid('Normal', 'Urgent').required(),
    severity: Joi.string().valid('High', 'Medium', 'Low').required(),
    respondent_name: Joi.string().max(255).allow('', null),
    respondent_address: Joi.string().max(500).allow('', null),
    age: Joi.number().integer().min(0).max(150).allow(null),
    form_type: Joi.string().valid('blotter', 'crime').default('blotter'),

    // ── Phase 3 structured fields (all optional; composed into the legacy
    // *_name / address columns so the compatibility view still reads cleanly) ──
    complainant_first: Joi.string().max(80).allow('', null),
    complainant_middle: Joi.string().max(80).allow('', null),
    complainant_last: Joi.string().max(80).allow('', null),
    complainant_contact: Joi.string().max(30).allow('', null),
    respondent_first: Joi.string().max(80).allow('', null),
    respondent_middle: Joi.string().max(80).allow('', null),
    respondent_last: Joi.string().max(80).allow('', null),
    reporter_first: Joi.string().max(80).allow('', null),
    reporter_middle: Joi.string().max(80).allow('', null),
    reporter_last: Joi.string().max(80).allow('', null),
    reporter_address: Joi.string().max(255).allow('', null),
    reporter_contact: Joi.string().max(30).allow('', null),
    addr_block: Joi.string().max(50).allow('', null),
    addr_lot: Joi.string().max(50).allow('', null),
    addr_house_no: Joi.string().max(50).allow('', null),
    addr_street: Joi.string().max(100).allow('', null),
    addr_unit: Joi.string().max(50).allow('', null),
    resp_addr_street: Joi.string().max(100).allow('', null),
    resp_addr_block: Joi.string().max(50).allow('', null),
    resp_addr_lot: Joi.string().max(50).allow('', null),
    resp_addr_house_no: Joi.string().max(50).allow('', null),
    resp_addr_unit: Joi.string().max(50).allow('', null),
    is_draft: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false', '').default(false),
    no_evidence: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false', '').default(false),
    no_evidence_reason: Joi.string().max(500).allow('', null)
});

// Report Export/Print Schema - the Reports page's Print/Export CSV
// buttons never hit the backend at all today (window.print() and a
// client-built Blob), so there's currently no audit trail of who
// printed or exported what. This is the log-only endpoint for that.
const reportExportSchema = Joi.object({
    action: Joi.string().valid(
        'PRINT_REPORT', 'EXPORT_CSV_REPORT', 'PRINT_PATROL_REPORT',
        'PRINT_PATROL_LOGS_REPORT', 'EXPORT_CSV_PATROL_LOGS'
    ).required(),
    month: Joi.string().pattern(/^\d{4}-\d{2}$/).allow('', null),
    filters: Joi.object({
        dateFrom: Joi.string().allow('', null),
        dateTo: Joi.string().allow('', null),
        status: Joi.string().allow('', null),
        incidentType: Joi.string().allow('', null),
        location: Joi.string().allow('', null)
    }).default({}),
    recordCount: Joi.number().integer().min(0).allow(null)
});

const PASSWORD_POLICY_MESSAGE = 'Must be 8–12 characters with at least one uppercase, one lowercase, one number and one special character.';
const strongPasswordSchema = Joi.string().min(8).max(12)
    .pattern(/[A-Z]/).pattern(/[a-z]/).pattern(/[0-9]/).pattern(/[^A-Za-z0-9]/)
    .messages({
        'string.base': PASSWORD_POLICY_MESSAGE,
        'string.empty': PASSWORD_POLICY_MESSAGE,
        'string.min': PASSWORD_POLICY_MESSAGE,
        'string.max': PASSWORD_POLICY_MESSAGE,
        'string.pattern.base': PASSWORD_POLICY_MESSAGE,
        'any.required': PASSWORD_POLICY_MESSAGE
    });

// User Schema
const userSchema = Joi.object({
    name: Joi.string().max(100).pattern(/^[A-Za-z\s.\-']+$/).required().messages({ 'string.pattern.base': 'Name must contain only letters, spaces, dots, hyphens and apostrophes.' }),
    username: Joi.string().min(3).max(50).pattern(/^[A-Za-z0-9._]+$/).required().messages({ 'string.pattern.base': 'Username must contain only letters, numbers, dots and underscores.' }),
    password: strongPasswordSchema.required(),
    role: Joi.string().valid('Executive Officer', LEGACY_EXECUTIVE, 'Kagawad', 'Team Leader').custom(normalizeRole).required(),
    contact_no: Joi.string().max(20).allow('', null),
    email: Joi.string().email({ tlds: false }).max(100).required()
});

const userEmailSchema = Joi.object({
    email: Joi.string().email({ tlds: false }).allow('', null)
});

// Login Schema
const loginSchema = Joi.object({
    username: Joi.string().max(50).required(),
    password: Joi.string().max(128).required()
});

const forgotPasswordSchema = Joi.object({
    username: Joi.string().max(50).required()
});

const changePasswordSchema = Joi.object({
    current_password: Joi.string().max(128).required(),
    // Passwords for this flow are limited to 8–20 non-whitespace characters,
    // using letters and special characters only (no digits), with at least one
    // letter and one special character.
    new_password: Joi.string().min(8).max(20)
        .pattern(/^[^\d\s]+$/)
        .pattern(/[A-Za-z]/)
        .pattern(/[^A-Za-z\d\s]/)
        .required()
        .messages({ 'string.pattern.base': 'Password must be 8–20 characters and contain only letters and special characters, including at least one of each.' })
});

const resetPasswordSchema = Joi.object({
    username: Joi.string().max(50).required(),
    reset_token: Joi.string().min(8).max(64).required(),
    new_password: strongPasswordSchema.required()
});

// Patrol Schedule Schema
const scheduleSchema = Joi.object({
    incident_id: Joi.number().integer().positive().allow(null),
    source_record_ids: Joi.array().items(Joi.number().integer().positive()).unique().max(1).default([]),
    scheduled_date: dateOnlySchema.allow(null, ''),
    priority: Joi.string().valid('High', 'Moderate', 'Low'),
    exact_address: Joi.string().max(255).allow(''),
    team_name: Joi.string().trim().max(100).allow(''),
    tanod_ids: Joi.array().items(Joi.number().integer().positive()).unique().max(30),
    personnel: Joi.array().items(Joi.object({
        person_type: Joi.string().valid('Tanod', 'Volunteer', 'Team Leader').required(),
        person_id: Joi.number().integer().positive().required(),
        assignment_type: Joi.string().valid('Primary', 'Temporary').default('Primary')
    })).max(40).default([]),
    routine_type: Joi.string().valid('Incident Response', 'Routine Patrol', 'Multi-location Route').default('Incident Response'),
    route_name: Joi.string().trim().max(120).allow(''),
    route_stops: Joi.array().items(Joi.object({
        stop_order: Joi.number().integer().min(1).required(),
        location: Joi.string().valid(...BARANGAY_LOCATIONS).required(),
        address: Joi.string().max(255).allow(''),
        latitude: Joi.number().min(-90).max(90).allow(null),
        longitude: Joi.number().min(-180).max(180).allow(null),
        dwell_minutes: Joi.number().integer().min(0).max(480).default(0)
    })).max(50).default([]),
    location: Joi.string().valid(...BARANGAY_LOCATIONS).allow('').default(''),
    start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    day_of_week: Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday').required(),
    latitude: Joi.number().min(-90).max(90).allow(null),
    longitude: Joi.number().min(-180).max(180).allow(null),
    reason: Joi.string().max(1000).allow('', null),
    status: Joi.string().valid('Active', 'Completed', 'Cancelled').default('Active'),
    team_id: Joi.number().integer().positive().allow(null),
    recurrence_type: Joi.string().valid('single', 'daily', 'weekly', 'custom').default('single'),
    recurrence_interval: Joi.number().integer().min(1).max(30).default(1),
    recurrence_days: Joi.array().items(Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')).max(7).unique().default([]),
    recurrence_end_date: dateOnlySchema.allow(null, ''),
    edit_scope: Joi.string().valid('single', 'future', 'series').default('single'),
    conflict_override: Joi.boolean().default(false),
    override_justification: Joi.string().trim().max(500).allow('')
});

// Patrol Log Schema
const logSchema = Joi.object({
    schedule_id: Joi.number().integer().positive().required(),
    report: Joi.string().max(2000).allow('', null),
    status: Joi.string().valid('Completed', 'Partial', 'Failed').default('Completed'),
    patrol_date: Joi.date().required(),
    attendance: Joi.array().items(Joi.object({
        person_type: Joi.string().valid('Tanod', 'Volunteer', 'Team Leader').required(),
        person_id: Joi.number().integer().positive().required(),
        attendance_status: Joi.string().valid('Present', 'Absent', 'Late', 'Excused').required(),
        notes: Joi.string().max(255).allow('')
    })).max(40).default([])
});

// ============================================================
// 🔧 VALIDATION MIDDLEWARE
// ============================================================

function removeUploadedFiles(req) {
    const files = [...(req.file ? [req.file] : []), ...(Array.isArray(req.files) ? req.files : [])];
    for (const file of files) {
        fs.unlink(file.path, (err) => {
            // silently ignore cleanup errors
        });
    }
}

function validate(schema) {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, { abortEarly: false, allowUnknown: true, stripUnknown: true });
        if (error) {
            // On multipart routes multer has already saved the upload by
            // now - don't leave it orphaned on disk when the form is rejected.
            removeUploadedFiles(req);
            const errors = error.details.map(detail => detail.message);
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: errors 
            });
        }
        req.body = value;
        next();
    };
}

// ============================================================
// RATE LIMITING (auth endpoints only)
// In-memory sliding window - this app runs as a single-process
// Electron/LAN deployment with no shared store (Redis, etc.), so a
// per-process Map is enough. Resets on server restart; that's fine for
// a brute-force/enumeration guard.
// ============================================================
const rateLimitBuckets = new Map();

function rateLimit({ windowMs, max }) {
    return (req, res, next) => {
        // Jest runs --runInBand (one shared process for the whole test
        // run), so this in-memory bucket otherwise accumulates across
        // every test file's requests and starts rejecting calls partway
        // through an unrelated suite. The separate per-username
        // login_attempts lockout (tested in auth.test.js) still applies.
        if (process.env.NODE_ENV === 'test') return next();

        const key = `${req.ip}:${req.path}`;
        const now = Date.now();
        const attempts = (rateLimitBuckets.get(key) || []).filter(t => now - t < windowMs);

        if (attempts.length >= max) {
            const retryAfterSec = Math.ceil((windowMs - (now - attempts[0])) / 1000);
            res.set('Retry-After', String(retryAfterSec));
            return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
        }

        attempts.push(now);
        rateLimitBuckets.set(key, attempts);
        next();
    };
}

const authRateLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 8 });

// ============================================================
// PASSWORD RESET EMAIL (optional - Gmail SMTP)
// Only wired up if EMAIL_USER/EMAIL_APP_PASSWORD are set in .env (a
// Gmail App Password, not the account's normal login password - needs
// 2-Step Verification enabled on that Gmail account first). Without
// them, mailTransporter stays null and forgot-password falls back to
// its existing behavior: the token is still recorded in the Audit
// Trail for an Administrator to relay manually, so the feature never
// hard-fails just because email isn't configured yet.
// ============================================================

let mailTransporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD) {
    mailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_APP_PASSWORD
        }
    });
} else {
}

async function sendPasswordResetEmail(toEmail, name, resetToken) {
    if (!mailTransporter) return false;

    try {
        await mailTransporter.sendMail({
            from: `"Barangay 179 Crime BI" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: 'Password Reset Code - Barangay 179 Crime BI',
            html: `
                <p>Hi ${name},</p>
                <p>We received a request to reset your password for the <strong>Barangay 179 Crime BI</strong> system.</p>
                <p>Your password reset code is:</p>
                <p style="font-size: 18px; font-weight: bold; color: #1d4ed8; text-align: center; margin: 20px 0; padding: 16px; background: #eff6ff; border-radius: 8px; word-break: break-all; font-family: monospace;">${resetToken}</p>
                <p>Copy and paste this code on the password reset screen. <strong>It expires in 10 minutes.</strong></p>
                <p style="color: #6b7280; font-size: 0.9em;">If you didn't request this, you can safely ignore this email. Your password will not be changed.</p>
            `
        });
        return true;
    } catch (error) {
        return false;
    }
}

// ============================================================
// AUDIT LOGGING HELPER
// ============================================================

async function logAudit(userId, action, entityType, entityId, oldData, newData, req) {
    try {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const userAgent = req.headers?.['user-agent'] || '';

        if (!userId) {
            return;
        }

        await pool.query(`
            INSERT INTO audit_logs 
            (user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            userId,
            action,
            entityType || null,
            entityId || null,
            oldData ? JSON.stringify(oldData) : null,
            newData ? JSON.stringify(newData) : null,
            ip,
            userAgent
        ]);

    } catch (error) {
    }
}

// ============================================================
// 🔐 SESSION IDLE TIMEOUT
// ============================================================
async function getSessionTimeoutMinutes() {
    const [rows] = await pool.query(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'session_timeout_minutes'`
    );
    const minutes = parseInt(rows[0]?.setting_value, 10);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
}

// ============================================================
// 🔐 MIDDLEWARE: SESSION-BASED AUTHENTICATION
// ============================================================

async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: No session token provided' });
        }

        const token = authHeader.split(' ')[1];
        const tokenHash = hashToken(token);

        const [sessions] = await pool.query(
            `SELECT user_id, last_activity
             FROM user_sessions
             WHERE session_token = ? AND is_active = 1 AND logout_time IS NULL`,
            [tokenHash]
        );

        if (sessions.length === 0) {
            return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
        }

        const session = sessions[0];
        const timeoutMinutes = await getSessionTimeoutMinutes();
        const idleMinutes = (Date.now() - new Date(session.last_activity).getTime()) / 60000;

        if (idleMinutes > timeoutMinutes) {
            await pool.query(
                'UPDATE user_sessions SET is_active = 0, logout_time = NOW() WHERE session_token = ?',
                [tokenHash]
            );
            return res.status(401).json({ error: 'Unauthorized: Session expired due to inactivity' });
        }

        await pool.query('UPDATE user_sessions SET last_activity = NOW() WHERE session_token = ?', [tokenHash]);

        req.userId = session.user_id;
        next();

    } catch (error) {
        return res.status(500).json({ error: 'Server error during authentication' });
    }
}

// Same session validation as authenticate(), but reads the token from a
// query string instead of an Authorization header - needed for the SSE
// notification stream below, since the browser's EventSource API cannot
// send custom headers at all. Doesn't bump last_activity (a long-lived
// background connection isn't "activity" the idle timeout should reset
// on); authenticate() already does that for the user's real requests.
async function authenticateFromQueryToken(req, res, next) {
    try {
        const token = req.query.token;
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized: No session token provided' });
        }
        const tokenHash = hashToken(token);

        const [sessions] = await pool.query(
            `SELECT user_id, last_activity
             FROM user_sessions
             WHERE session_token = ? AND is_active = 1 AND logout_time IS NULL`,
            [tokenHash]
        );

        if (sessions.length === 0) {
            return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
        }

        const session = sessions[0];
        const timeoutMinutes = await getSessionTimeoutMinutes();
        const idleMinutes = (Date.now() - new Date(session.last_activity).getTime()) / 60000;

        if (idleMinutes > timeoutMinutes) {
            return res.status(401).json({ error: 'Unauthorized: Session expired due to inactivity' });
        }

        req.userId = session.user_id;
        next();

    } catch (error) {
        return res.status(500).json({ error: 'Server error during authentication' });
    }
}

// ============================================================
// 🔐 MIDDLEWARE: ROLE-BASED AUTHORIZATION
// ============================================================

function requireRole(allowedRoles) {
    return async (req, res, next) => {
        try {
            const [users] = await pool.query(
                'SELECT role FROM users WHERE id = ? AND is_active = 1',
                [req.userId]
            );

            if (users.length === 0) {
                return res.status(401).json({ error: 'User not found or inactive' });
            }

            const userRole = normalizeRole(users[0].role);

            if (!allowedRoles.includes(userRole)) {
                return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
            }

            req.userRole = userRole;
            next();

        } catch (error) {
            return res.status(500).json({ error: 'Server error during authorization' });
        }
    };
}

// ── SSE ticket system (M-3) ──
// Short-lived, single-use tickets replace the main session token in SSE
// URLs so that reusable credentials never appear in query strings.
const sseTickets = new Map(); // ticketHash → { userId, sessionHash, createdAt }
const SSE_TICKET_TTL_MS = 30 * 1000; // 30 seconds to connect

app.post('/api/notifications/ticket', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), (req, res) => {
    const ticket = crypto.randomBytes(24).toString('base64url');
    const ticketHash = hashToken(ticket);
    const sessionHash = hashToken(req.headers.authorization.split(' ')[1]);
    sseTickets.set(ticketHash, {
        userId: req.userId,
        sessionHash,
        createdAt: Date.now(),
    });
    // Clean up expired tickets periodically
    for (const [k, v] of sseTickets) {
        if (Date.now() - v.createdAt > SSE_TICKET_TTL_MS * 2) sseTickets.delete(k);
    }
    res.json({ ticket });
});

app.get('/api/notifications/stream', async (req, res) => {
    const ticket = req.query.ticket;
    if (!ticket) {
        return res.status(401).json({ error: 'SSE ticket required' });
    }
    const ticketHash = hashToken(ticket);
    const entry = sseTickets.get(ticketHash);

    if (!entry || (Date.now() - entry.createdAt) > SSE_TICKET_TTL_MS) {
        sseTickets.delete(ticketHash);
        return res.status(401).json({ error: 'Invalid or expired SSE ticket' });
    }
    // Single-use: consume immediately
    sseTickets.delete(ticketHash);

    // Verify the parent session is still active
    const [sessions] = await pool.query(
        `SELECT s.user_id FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.session_token = ? AND s.is_active = 1 AND s.logout_time IS NULL AND u.is_active = 1`,
        [entry.sessionHash]
    );
    if (sessions.length === 0) {
        return res.status(401).json({ error: 'Parent session expired' });
    }

    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    notificationClients.add(res);

    const heartbeat = setInterval(async () => {
        try {
            const [rows] = await pool.query(
                `SELECT s.last_activity FROM user_sessions s
                 JOIN users u ON u.id = s.user_id
                 WHERE s.session_token = ? AND s.is_active = 1 AND s.logout_time IS NULL AND u.is_active = 1`,
                [entry.sessionHash]
            );
            const timeoutMinutes = await getSessionTimeoutMinutes();
            const stillValid = rows.length > 0 &&
                (Date.now() - new Date(rows[0].last_activity).getTime()) / 60000 <= timeoutMinutes;
            if (!stillValid) {
                clearInterval(heartbeat);
                notificationClients.delete(res);
                res.end();
                return;
            }
            res.write(': heartbeat\n\n');
        } catch (error) {
        }
    }, 30000);

    req.on('close', () => {
        clearInterval(heartbeat);
        notificationClients.delete(res);
    });
});


// ============================================================
// FILE ACCESS TOKENS (gate /uploads - see below)
// Uploaded evidence/photos used to be served by a bare express.static
// mount with no auth check at all - anyone with (or guessing) a URL
// could view them, logged in or not. Short-lived (60s) signed tokens
// close that without requiring every <img>/<video> tag to somehow send
// an Authorization header, which they can't. The secret is generated
// fresh at process start and kept in memory only - tokens expire in
// 60s anyway, so there's nothing worth persisting across restarts.
// ============================================================
const FILE_TOKEN_SECRET = crypto.randomBytes(32).toString('hex');
const FILE_TOKEN_TTL_MS = 60 * 1000;

function issueFileToken() {
    const expiry = Date.now() + FILE_TOKEN_TTL_MS;
    const payload = `${expiry}.staff`;
    const sig = crypto.createHmac('sha256', FILE_TOKEN_SECRET).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

function verifyFileToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [expiryStr, kind, sig] = parts;
    const expiry = parseInt(expiryStr, 10);
    if (!expiry || !sig || Date.now() > expiry) return null;

    const payload = `${expiryStr}.${kind}`;
    const expectedSig = crypto.createHmac('sha256', FILE_TOKEN_SECRET).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    return { kind: 'staff' };
}

app.get('/api/uploads/file-token', authenticate, (req, res) => {
    res.json({ token: issueFileToken(), expiresIn: FILE_TOKEN_TTL_MS });
});

// ============================================================
// HELPER FUNCTIONS FOR AUTO-COMPUTE
// ============================================================

function computeTimeOfDay(timeStr) {
    if (!timeStr) return 'Night';
    try {
        const parts = timeStr.split(':');
        const hour = parseInt(parts[0], 10);
        if (isNaN(hour)) return 'Night';
        
        if (hour >= 6 && hour <= 11) return 'Morning';
        if (hour >= 12 && hour <= 17) return 'Afternoon';
        if (hour >= 18 && hour <= 21) return 'Evening';
        return 'Night';
    } catch (e) {
        return 'Night';
    }
}

function getDayOfWeek(dateStr) {
    if (!dateStr) return 'Monday';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Monday';
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    } catch (e) {
        return 'Monday';
    }
}

function isDateWeekend(dateStr) {
    if (!dateStr) return false;
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return false;
        return date.getDay() === 0 || date.getDay() === 6;
    } catch (e) {
        return false;
    }
}

// ============================================================
// AREA RISK DECAY (Patrol Decision Support)
// ============================================================
// Per-street decay applied on top of CART's live-computed risk score:
// each completed patrol there shaves PATROL_COMPLETION_DECAY off the
// street's recommended risk, and a new incident there wipes it back to
// 0 so the street can surface as high-risk again. The underlying CART
// score itself is untouched - this is a display-time offset the
// frontend subtracts (see GET /api/patrol/area-decay).
const PATROL_COMPLETION_DECAY = 3.5;

async function decayAreaRisk(location) {
    if (!location) return;
    await pool.query(`
        INSERT INTO area_risk_decay (location, decay_amount)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE decay_amount = decay_amount + VALUES(decay_amount)
    `, [location, PATROL_COMPLETION_DECAY]);
}

async function resetAreaRisk(location) {
    if (!location) return;
    await pool.query(`
        INSERT INTO area_risk_decay (location, decay_amount)
        VALUES (?, 0)
        ON DUPLICATE KEY UPDATE decay_amount = 0
    `, [location]);
}

// ============================================================
// 🆕 CART ENGINE - APPLY CONFIGURED THRESHOLDS
// ============================================================
// The Settings page lets an Administrator edit "High Risk Threshold" /
// "Moderate Risk Threshold" into system_settings. cartEngine keeps its
// own built-in defaults (67/34) until told otherwise, so every scoring
// call reads the current configured values first - otherwise editing
// the setting in the UI would have no real effect on scoring.
async function applyConfiguredThresholds() {
    const [rows] = await pool.query(
        `SELECT setting_key, setting_value FROM system_settings
         WHERE setting_key IN ('default_danger_threshold_high', 'default_danger_threshold_moderate')`
    );

    const settings = {};
    rows.forEach(row => { settings[row.setting_key] = row.setting_value; });

    const level3 = parseInt(settings.default_danger_threshold_high, 10);
    const level2 = parseInt(settings.default_danger_threshold_moderate, 10);

    cartEngine.updateThresholds({
        level3: Number.isFinite(level3) ? level3 : 67,
        level2: Number.isFinite(level2) ? level2 : 34
    });
}

// ============================================================
// 🆕 CART ENGINE - APPLY CONFIGURED WEIGHTS
// ============================================================
async function applyConfiguredWeights() {
    const [rows] = await pool.query(
        `SELECT setting_key, setting_value FROM system_settings
         WHERE setting_key IN ('cart_weight_time','cart_weight_day','cart_weight_type','cart_weight_location','cart_weight_frequency')`
    );
    const s = {};
    rows.forEach(r => { s[r.setting_key] = r.setting_value; });

    const parse = (key, def) => {
        const v = parseInt(s[key], 10);
        return Number.isFinite(v) ? v / 100 : def;
    };

    cartEngine.updateWeights({
        time:      parse('cart_weight_time',      0.25),
        day:       parse('cart_weight_day',       0.15),
        type:      parse('cart_weight_type',      0.30),
        location:  parse('cart_weight_location',  0.20),
        frequency: parse('cart_weight_frequency', 0.10)
    });
}

async function applyConfiguredSourceWeights() {
    const [rows] = await pool.query(
        `SELECT setting_key, setting_value FROM system_settings
         WHERE setting_key IN ('cart_source_weight_blotter','cart_source_weight_incident')`
    );
    const s = {};
    rows.forEach(r => { s[r.setting_key] = r.setting_value; });
    const parse = (key, def) => { const v = parseFloat(s[key]); return Number.isFinite(v) ? v : def; };
    cartEngine.updateSourceWeights({
        blotter:  parse('cart_source_weight_blotter',  0.85),
        incident: parse('cart_source_weight_incident', 1.0)
    });
}

// ============================================================
// 🆕 CART ENGINE - COMPUTE FOR SINGLE INCIDENT
// ============================================================

async function computeCartRiskFactors(incidentId) {
    try {

        // 1. Get incident data (skip drafts — they aren't scored)
        const [incidents] = await pool.query(`
            SELECT id, incident_type, time_of_day, is_weekend, street_name, severity, is_draft, form_type
            FROM incidents WHERE id = ?
        `, [incidentId]);

        if (incidents.length > 0 && incidents[0].is_draft) {
            await pool.query('DELETE FROM cart_risk_factors WHERE incident_id = ?', [incidentId]);
            return;
        }

        if (incidents.length === 0) {
            return;
        }

        const incident = incidents[0];

        // 2. Get location statistics (exclude drafts)
        let locationData = null;
        if (incident.street_name) {
            const [result] = await pool.query(`
                SELECT street_name, COUNT(*) as street_count
                FROM incidents
                WHERE street_name = ? AND street_name IS NOT NULL AND is_draft = 0
                GROUP BY street_name
            `, [incident.street_name]);
            locationData = result[0] || null;
        }

        // 3. Get frequency statistics (last 30 days, exclude drafts)
        let frequencyData = null;
        if (incident.street_name) {
            const [result] = await pool.query(`
                SELECT street_name, COUNT(*) as recent_count
                FROM incidents
                WHERE street_name = ?
                AND street_name IS NOT NULL
                AND is_draft = 0
                AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                GROUP BY street_name
            `, [incident.street_name]);
            frequencyData = result[0] || null;
        }

        // 4. Analyze using CART Engine
        await applyConfiguredThresholds();
        await applyConfiguredWeights();
        await applyConfiguredSourceWeights();
        const result = cartEngine.analyze(
            incident,
            locationData,
            frequencyData
        );


        // 5. Delete existing risk factors
        await pool.query('DELETE FROM cart_risk_factors WHERE incident_id = ?', [incidentId]);

        // 6. Save to database
        await pool.query(`
            INSERT INTO cart_risk_factors (
                incident_id, 
                time_risk_score, 
                day_risk_score, 
                type_risk_score,
                location_risk_score, 
                frequency_risk_score, 
                total_risk_score, 
                danger_level,
                decision_path,
                model_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            incidentId,
            result.scores.time || 0,
            result.scores.day || 0,
            result.scores.type || 0,
            result.scores.location || 0,
            result.scores.frequency || 0,
            result.totalScore || 0,
            result.dangerDescription || 'Level 1 — Low Danger / Stable Area',
            result.decisionPath ? result.decisionPath.join('\n') : 'No decision path',
            'v1.0'
        ]);

        // 7. Reflect the real computed level back onto the incident itself -
        // incidents.danger_level was otherwise left as the literal placeholder
        // 'Calculated by System' forever, even though the real Level 1/2/3
        // result was sitting in cart_risk_factors the whole time.
        await writeDangerLevelToBase(
            pool, incidentId,
            result.dangerDescription || 'Level 1 — Low Danger / Stable Area'
        );


    } catch (error) {
        throw error;
    }
}

// ============================================================
// RECOMPUTE ALL CART RISK FACTORS
// ============================================================

// Writes exactly one cart_analysis_log row per run and returns its id.
async function recomputeAllCartRiskFactors({ triggeredBy = null } = {}) {
    const startTime = Date.now();
    let conn;
    try {

        // 1. Get all incidents with valid data. time_of_day can be NULL on
        // imported rows - derive it from `time` instead of skipping them,
        // since the old risk rows are wiped below.
        const [rawIncidents] = await pool.query(`
            SELECT id, incident_type, time, time_of_day, is_weekend, street_name, date, severity, form_type
            FROM incidents
            WHERE id IS NOT NULL
            AND incident_type IS NOT NULL
            AND is_draft = 0
        `);
        const incidents = rawIncidents.map(i => ({
            ...i,
            time_of_day: i.time_of_day || computeTimeOfDay(i.time ? String(i.time) : null)
        }));

        if (incidents.length === 0) {
            await pool.query('DELETE FROM cart_risk_factors');
            const [emptyLog] = await pool.query(`
                INSERT INTO cart_analysis_log (
                    analysis_type,
                    total_incidents_analyzed,
                    execution_time_ms,
                    status,
                    triggered_by,
                    notes
                ) VALUES (?, ?, ?, ?, ?, ?)
            `, ['risk_prediction', 0, Date.now() - startTime, 'completed', triggeredBy, 'No incidents found to analyze']);
            return emptyLog.insertId;
        }


        // 2. Get location statistics for all streets (exclude drafts)
        const [locationStats] = await pool.query(`
            SELECT street_name, COUNT(*) as street_count
            FROM incidents
            WHERE street_name IS NOT NULL AND street_name != '' AND is_draft = 0
            GROUP BY street_name
        `);

        // 3. Get frequency statistics for all streets (last 30 days, exclude drafts)
        const [frequencyStats] = await pool.query(`
            SELECT street_name, COUNT(*) as recent_count
            FROM incidents
            WHERE street_name IS NOT NULL
            AND street_name != ''
            AND is_draft = 0
            AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY street_name
        `);

        // Create lookup maps
        const locationMap = {};
        locationStats.forEach(item => {
            locationMap[item.street_name] = item.street_count;
        });

        const frequencyMap = {};
        frequencyStats.forEach(item => {
            frequencyMap[item.street_name] = item.recent_count;
        });


        // 4. Replace all existing risk factors inside one transaction, so
        // readers keep seeing the previous results until the new set is
        // complete (TRUNCATE would commit immediately and leave the table
        // empty mid-run).
        conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.query('DELETE FROM cart_risk_factors');

        // 5. Process each incident
        let processed = 0;
        let errors = 0;
        let highRisk = 0;
        let moderateRisk = 0;
        let lowRisk = 0;

        await applyConfiguredThresholds();
        await applyConfiguredWeights();
        await applyConfiguredSourceWeights();

        for (const incident of incidents) {
            try {
                const locationData = incident.street_name ? {
                    street_count: locationMap[incident.street_name] || 0
                } : null;

                const frequencyData = incident.street_name ? {
                    recent_count: frequencyMap[incident.street_name] || 0
                } : null;

                const result = cartEngine.analyze(
                    incident,
                    locationData,
                    frequencyData
                );

                if (result.dangerLevel === 'Level 3') highRisk++;
                else if (result.dangerLevel === 'Level 2') moderateRisk++;
                else lowRisk++;

                await conn.query(`
                    INSERT INTO cart_risk_factors (
                        incident_id, 
                        time_risk_score, 
                        day_risk_score, 
                        type_risk_score,
                        location_risk_score, 
                        frequency_risk_score, 
                        total_risk_score, 
                        danger_level,
                        decision_path,
                        model_version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    incident.id,
                    result.scores.time || 0,
                    result.scores.day || 0,
                    result.scores.type || 0,
                    result.scores.location || 0,
                    result.scores.frequency || 0,
                    result.totalScore || 0,
                    result.dangerDescription || 'Level 1 — Low Danger / Stable Area',
                    result.decisionPath ? result.decisionPath.join('\n') : 'No decision path',
                    'v1.0'
                ]);

                // Keep incidents.danger_level in sync with the real result,
                // same as the single-incident path in computeCartRiskFactors.
                await writeDangerLevelToBase(
                    conn, incident.id,
                    result.dangerDescription || 'Level 1 — Low Danger / Stable Area',
                    incident.time_of_day
                );

                processed++;
                
                if (processed % 10 === 0) {
                }
            } catch (incidentError) {
                errors++;
            }
        }

        await conn.commit();
        conn.release();
        conn = null;

        // 6. Log the analysis
        const incidentTypes = [...new Set(incidents.map(i => i.incident_type).filter(Boolean))];
        const streets = [...new Set(incidents.map(i => i.street_name).filter(Boolean))];
        const dates = incidents.map(i => i.date).filter(Boolean).sort((a, b) => new Date(a) - new Date(b));

        const [logResult] = await pool.query(`
            INSERT INTO cart_analysis_log (
                analysis_type,
                date_range_start,
                date_range_end,
                incident_types_analyzed,
                total_streets_analyzed,
                total_incidents_analyzed,
                high_risk_count,
                moderate_risk_count,
                low_risk_count,
                execution_time_ms,
                status,
                triggered_by,
                notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'risk_prediction',
            dates[0] || null,
            dates[dates.length - 1] || null,
            incidentTypes.join(', ') || 'None',
            streets.length || 0,
            processed,
            highRisk,
            moderateRisk,
            lowRisk,
            Date.now() - startTime,
            'completed',
            triggeredBy,
            `Processed ${processed} incidents with ${errors} errors`
        ]);

        return logResult.insertId;

    } catch (error) {

        if (conn) {
            try { await conn.rollback(); } catch (rollbackError) { /* already logged above */ }
            conn.release();
        }

        try {
            await pool.query(`
                INSERT INTO cart_analysis_log (
                    analysis_type,
                    status,
                    triggered_by,
                    notes
                ) VALUES (?, ?, ?, ?)
            `, ['risk_prediction', 'failed', triggeredBy, `Error: ${error.message}`]);
        } catch (logError) {
        }

        throw error;
    }
}

// ============================================================
// USER MANAGEMENT API ROUTES
// ============================================================

const recordPatrol = createRecordPatrol({
    pool, cartEngine, authenticate, requireRole, validate, resolveRegistry,
    computeCartRiskFactors, computeTimeOfDay, getDayOfWeek, isDateWeekend,
    logAudit, locations: BARANGAY_LOCATIONS,
    configureCart: async () => {
        await applyConfiguredThresholds();
        await applyConfiguredWeights();
        await applyConfiguredSourceWeights();
    }
});
recordPatrol.register(app);

app.get('/api/users', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const { limit, offset, page } = pagination(req.query, 10);
        const role = req.query.role ? normalizeRole(req.query.role) : '';
        if (role && !['Executive Officer', 'Kagawad', 'Team Leader'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role filter.' });
        }
        const roleClause = role === 'Executive Officer' ? ' AND u.role IN (?, ?)' : role ? ' AND u.role = ?' : '';
        const params = role === 'Executive Officer' ? [role, LEGACY_EXECUTIVE] : role ? [role] : [];
        const where = `WHERE u.is_active = 1${roleClause}`;
        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
        const [rows] = await pool.query(`
            SELECT
                u.id, u.name, u.username, u.role,
                u.contact_no, u.email, u.is_active, u.last_login_at, u.created_at, u.updated_at
            FROM users u
            ${where}
            ORDER BY u.id
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);
        res.set({'X-Total-Count':String(total),'X-Total-Pages':String(Math.ceil(total/limit)),'X-Current-Page':String(page)});
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Registered before /api/users/:id - Express matches routes in
// registration order, and "search" would otherwise match :id first
// (as a literal id value, 404ing instead of ever reaching this handler).
app.get('/api/users/search', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const q = validatedSearch(req.query.q);
        const { limit, offset, page } = pagination(req.query, 10);
        const role = req.query.role ? normalizeRole(req.query.role) : '';
        if (role && !['Executive Officer', 'Kagawad', 'Team Leader'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role filter.' });
        }

        if (!q) {
            const roleClause = role === 'Executive Officer' ? ' AND u.role IN (?, ?)' : role ? ' AND u.role = ?' : '';
            const params = role === 'Executive Officer' ? [role, LEGACY_EXECUTIVE] : role ? [role] : [];
            const where = `WHERE u.is_active = 1${roleClause}`;
            const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
            const [rows] = await pool.query(`
                SELECT
                    u.id, u.name, u.username, u.role,
                    u.contact_no, u.email, u.is_active, u.last_login_at
                FROM users u
                ${where}
                ORDER BY u.id
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);
            res.set({'X-Total-Count':String(total),'X-Total-Pages':String(Math.ceil(total/limit)),'X-Current-Page':String(page)});
            return res.json(rows);
        }

        const searchTerm = `%${q}%`;
        const roleClause = role === 'Executive Officer' ? ' AND u.role IN (?, ?)' : role ? ' AND u.role = ?' : '';
        const roleParams = role === 'Executive Officer' ? [role, LEGACY_EXECUTIVE] : role ? [role] : [];
        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u
            WHERE u.is_active = 1 AND (u.name LIKE ? OR u.username LIKE ? OR u.role LIKE ?)${roleClause}`,
            [searchTerm, searchTerm, searchTerm, ...roleParams]);
        const [rows] = await pool.query(`
            SELECT
                u.id, u.name, u.username, u.role,
                u.contact_no, u.email, u.is_active, u.last_login_at
            FROM users u
            WHERE u.is_active = 1
              AND (u.name LIKE ?
               OR u.username LIKE ?
               OR u.role LIKE ?)${roleClause}
            ORDER BY u.id
            LIMIT ? OFFSET ?
        `, [searchTerm, searchTerm, searchTerm, ...roleParams, limit, offset]);

        res.set({'X-Total-Count':String(total),'X-Total-Pages':String(Math.ceil(total/limit)),'X-Current-Page':String(page)});
        res.json(rows);

    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        res.status(500).json({ error: 'Search failed' });
    }
});

app.get('/api/users/:id', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                u.id, u.name, u.username, u.role,
                u.contact_no, u.email, u.is_active, u.last_login_at, u.created_at, u.updated_at
            FROM users u
            WHERE u.id = ?
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

app.post('/api/users', authenticate, requireRole(['Executive Officer']), validate(userSchema), async (req, res) => {
    try {
        const { name, username, password, role, contact_no, email } = req.body;

        const [existing] = await pool.query(
            'SELECT id, is_active FROM users WHERE username = ?',
            [username]
        );

        if (existing.length > 0 && existing[0].is_active) {
            return res.status(400).json({
                error: 'Username already exists.'
            });
        }

        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);

        // "Deleting" a user only deactivates them (their audit history is
        // kept), so re-adding the same username brings that account back
        // with the new details instead of being blocked forever.
        let result;
        if (existing.length > 0) {
            await pool.query(
                `UPDATE users SET name = ?, password_hash = ?, role = ?, contact_no = ?, email = ?, is_active = 1
                 WHERE id = ?`,
                [name, password_hash, role, contact_no || null, email || null, existing[0].id]
            );
            result = { insertId: existing[0].id };
            await archive.markEntityRestored('user', existing[0].id, req.userId);
        } else {
            [result] = await pool.query(
                `INSERT INTO users (name, username, password_hash, role, contact_no, email)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [name, username, password_hash, role, contact_no || null, email || null]
            );
        }

        const [newUser] = await pool.query(`
            SELECT
                u.id, u.name, u.username, u.role,
                u.contact_no, u.email, u.is_active, u.created_at, u.updated_at
            FROM users u
            WHERE u.id = ?
        `, [result.insertId]);
        
        const userId = req.userId;
        
        if (userId) {
            await logAudit(
                userId,
                'CREATE_USER',
                'users',
                result.insertId,
                null,
                { name, username, role },
                req
            );
        }
        
        res.status(201).json({
            message: 'User account added successfully.',
            user: newUser[0]
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Full user update (name, username, role, email, optional password)
const userUpdateSchema = Joi.object({
    name: Joi.string().max(100).pattern(/^[A-Za-z\s.\-']+$/).required().messages({ 'string.pattern.base': 'Name must contain only letters, spaces, dots, hyphens and apostrophes.' }),
    username: Joi.string().min(3).max(50).pattern(/^[A-Za-z0-9._]+$/).required().messages({ 'string.pattern.base': 'Username must contain only letters, numbers, dots and underscores.' }),
    role: Joi.string().valid('Executive Officer', LEGACY_EXECUTIVE, 'Kagawad', 'Team Leader').custom(normalizeRole).required(),
    email: Joi.string().email({ tlds: false }).max(100).required(),
    password: Joi.string().min(8).max(12)
        .pattern(/[A-Z]/, 'uppercase').message('Password must contain at least one uppercase letter.')
        .pattern(/[a-z]/, 'lowercase').message('Password must contain at least one lowercase letter.')
        .pattern(/[0-9]/, 'digit').message('Password must contain at least one number.')
        .pattern(/[^A-Za-z0-9]/, 'special').message('Password must contain at least one special character.')
        .allow('', null).optional(),
    is_active: Joi.boolean().default(true)
});

app.put('/api/users/:id', authenticate, requireRole(['Executive Officer']), validate(userUpdateSchema), async (req, res) => {
    try {
        const { name, username, role, email, password, is_active } = req.body;
        const userId = req.params.id;

        const [existing] = await pool.query('SELECT id, username FROM users WHERE id = ?', [userId]);
        if (existing.length === 0) return res.status(404).json({ error: 'User not found' });
        if (!req.body.is_active && Number(userId) === Number(req.userId)) return res.status(400).json({ error: 'You cannot deactivate your own active session.' });
        if (!req.body.is_active && role === 'Executive Officer') {
            const [[{ activeExecutives }]] = await pool.query("SELECT COUNT(*) AS activeExecutives FROM users WHERE is_active=1 AND role IN ('Executive Officer','Deputy Officer') AND id <> ?", [userId]);
            if (Number(activeExecutives) === 0) return res.status(400).json({ error: 'At least one active Executive Officer account must remain.' });
        }

        const [dupCheck] = await pool.query(
            'SELECT id FROM users WHERE username = ? AND id != ?', [username, userId]
        );
        if (dupCheck.length > 0) return res.status(409).json({ error: 'Username already taken.' });

        if (password) {
            const bcryptjs = require('bcryptjs');
            const hashed = await bcryptjs.hash(password, 10);
            await pool.query(
                'UPDATE users SET name=?, username=?, role=?, email=?, password_hash=?, is_active=? WHERE id=?',
                [name, username, role, email, hashed, is_active ? 1 : 0, userId]
            );
        } else {
            await pool.query(
                'UPDATE users SET name=?, username=?, role=?, email=?, is_active=? WHERE id=?',
                [name, username, role, email, is_active ? 1 : 0, userId]
            );
        }

        await logAudit(req.userId, 'UPDATE_USER', 'users', userId, existing[0], { name, username, role, email }, req);
        res.json({ message: 'User updated successfully.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update user' });
    }
});

app.put('/api/users/:id/email', authenticate, requireRole(['Executive Officer']), validate(userEmailSchema), async (req, res) => {
    try {
        const { email } = req.body;
        const [result] = await pool.query(
            'UPDATE users SET email = ? WHERE id = ?',
            [email || null, req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        await logAudit(req.userId, 'UPDATE_USER_EMAIL', 'users', req.params.id, null, { email }, req);

        res.json({ message: 'Email updated successfully.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update email' });
    }
});

app.delete('/api/users/:id', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const userId = req.params.id;
        const loggedInUserId = req.userId;
        
        const [user] = await pool.query(
            'SELECT id, username FROM users WHERE id = ?',
            [userId]
        );
        
        if (user.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (user[0].username.toLowerCase() === 'admin') {
            return res.status(403).json({ 
                error: 'The primary administrator account cannot be deleted.' 
            });
        }
        
        if (loggedInUserId) {
            await logAudit(
                loggedInUserId,
                'DELETE_USER',
                'users',
                userId,
                user[0],
                null,
                req
            );
        }
        
        // Soft-delete only - a hard DELETE here would cascade and wipe this
        // user's own audit_logs/login_history rows (ON DELETE CASCADE),
        // erasing the accountability trail of what they did while active.
        await pool.query(
            'UPDATE users SET is_active = 0 WHERE id = ?',
            [userId]
        );
        await pool.query(
            'UPDATE user_sessions SET is_active = 0, logout_time = NOW() WHERE user_id = ? AND is_active = 1',
            [userId]
        );

        const [userRow] = await pool.query(
            'SELECT id, name, username, role, contact_no, email, created_at FROM users WHERE id = ?',
            [userId]
        );
        await archive.archiveRecord(pool, {
            entityType: 'user',
            entityId: Number(userId),
            label: `User: ${userRow[0].name} (${userRow[0].role})`,
            data: { row: userRow[0] },
            deletedBy: loggedInUserId
        });

        res.json({ message: 'User account moved to the Archive.' });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.get('/api/users-list', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const role = req.query.role ? normalizeRole(req.query.role) : '';
        if (role && !['Executive Officer', 'Kagawad', 'Team Leader'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role filter.' });
        }
        const roleClause = role === 'Executive Officer' ? ' AND role IN (?, ?)' : role ? ' AND role = ?' : '';
        const params = role === 'Executive Officer' ? [role, LEGACY_EXECUTIVE] : role ? [role] : [];
        const [rows] = await pool.query(
            `SELECT id, name, role FROM users WHERE is_active = 1${roleClause} ORDER BY name`,
            params
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// ============================================================
// 🔥 AUTH - LOGIN (WITH LOGIN HISTORY)
// ============================================================

app.post('/api/auth/login', authRateLimit, validate(loginSchema), async (req, res) => {
    try {
        const { username, password } = req.body;
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        
        
        const [attempts] = await pool.query(
            `SELECT COUNT(*) as count FROM login_attempts 
             WHERE username = ? AND success = 0 AND attempt_time > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
            [username]
        );
        
        const failedCount = attempts[0]?.count || 0;
        
        if (failedCount >= 5) {
            return res.status(429).json({
                error: 'Too many failed login attempts. Please wait 15 minutes.',
                locked: true
            });
        }
        
        const [users] = await pool.query(`
            SELECT id, name, username, password_hash, role, is_active, last_login_at
            FROM users 
            WHERE username = ? AND is_active = 1
        `, [username]);
        
        if (users.length === 0) {
            await pool.query(
                'INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
                [username, ip, false]
            );
            return res.status(401).json({ error: 'Invalid username or password.' });
        }
        
        const user = users[0];
        const match = await bcrypt.compare(password, user.password_hash);
        
        if (!match) {
            await pool.query(
                'INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
                [username, ip, false]
            );
            return res.status(401).json({ error: 'Invalid username or password.' });
        }
        
        
        await pool.query(
            'INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
            [username, ip, true]
        );
        
        const sessionToken = generateSessionToken();
        const sessionTokenHash = hashToken(sessionToken);
        await pool.query(`
            INSERT INTO user_sessions
            (user_id, session_token, ip_address, user_agent, is_active)
            VALUES (?, ?, ?, ?, ?)
        `, [user.id, sessionTokenHash, ip, req.headers['user-agent'] || '', true]);
        
        
        try {
            const [historyResult] = await pool.query(`
                INSERT INTO login_history 
                (user_id, username, ip_address, user_agent, login_time)
                VALUES (?, ?, ?, ?, NOW())
            `, [
                user.id,
                user.username,
                ip,
                req.headers['user-agent'] || ''
            ]);
            
            
        } catch (historyError) {
        }
        
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
        
        await logAudit(user.id, 'LOGIN', 'users', user.id, null, { username: user.username, role: user.role }, req);
        
        const { password_hash, ...userData } = user;
        userData.role = normalizeRole(userData.role);
        
        
        res.json({
            message: 'Login successful.',
            user: userData,
            session_token: sessionToken
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

// ============================================================
// 📋 GET LOGIN HISTORY - PUBLIC (NO AUTH REQUIRED)
// ============================================================

app.get('/api/login-history', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        
        const [rows] = await pool.query(`
            SELECT 
                lh.id,
                lh.user_id,
                lh.username,
                lh.ip_address,
                lh.user_agent,
                lh.login_time,
                u.name as user_name,
                u.role as user_role
            FROM login_history lh
            LEFT JOIN users u ON lh.user_id = u.id
            ORDER BY lh.login_time DESC
            LIMIT 50
        `);
        
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch login history' });
    }
});

// ============================================================
// AUTH - FORGOT PASSWORD
// ============================================================

app.post('/api/auth/forgot-password', authRateLimit, validate(forgotPasswordSchema), async (req, res) => {
    try {
        const { username } = req.body;

        const [users] = await pool.query(
            'SELECT id, username, name, email FROM users WHERE username = ? AND is_active = 1',
            [username]
        );

        if (users.length === 0) {
            return res.json({ message: 'If that account exists, a reset code has been generated. Contact your administrator if you did not receive it.' });
        }

        const user = users[0];

        // Invalidate any prior outstanding reset tokens for this user
        await pool.query(
            'UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
            [user.id]
        );

        const resetToken = generateResetToken();
        const resetTokenHash = hashToken(resetToken);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(`
            INSERT INTO password_resets (user_id, reset_token, expires_at)
            VALUES (?, ?, ?)
        `, [user.id, resetTokenHash, expiresAt]);

        const emailSent = user.email ? await sendPasswordResetEmail(user.email, user.name, resetToken) : false;

        await logAudit(user.id, 'PASSWORD_RESET_REQUESTED', 'users', user.id, null,
            { username: user.username, expires_at: expiresAt, emailed_to: emailSent ? user.email : null }, req);

        res.json({
            message: emailSent
                ? 'A password reset code has been sent to your registered email. It expires in 10 minutes.'
                : 'Reset code generated. Please contact your administrator for the code.',
            ...(emailSent ? {} : { reset_token: resetToken })
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// ============================================================
// AUTH - RESET PASSWORD
// ============================================================

app.post('/api/auth/reset-password', authRateLimit, validate(resetPasswordSchema), async (req, res) => {
    try {
        const { username, reset_token, new_password } = req.body;

        const resetTokenHash = hashToken(reset_token);
        const [resetRecords] = await pool.query(`
            SELECT pr.user_id FROM password_resets pr
            JOIN users u ON u.id = pr.user_id
            WHERE pr.reset_token = ? AND pr.used_at IS NULL AND pr.expires_at > NOW()
              AND u.username = ? AND u.is_active = 1
        `, [resetTokenHash, username]);

        if (resetRecords.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const userId = resetRecords[0].user_id;
        const saltRounds = 10;
        const password_hash = await bcrypt.hash(new_password, saltRounds);

        await pool.query(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [password_hash, userId]
        );

        // Burn this code AND any other outstanding codes for the user, and
        // end every existing session - if the old password was
        // compromised, whoever had it shouldn't stay logged in.
        await pool.query(
            'UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
            [userId]
        );
        await pool.query(
            'UPDATE user_sessions SET is_active = 0, logout_time = NOW() WHERE user_id = ? AND is_active = 1',
            [userId]
        );

        res.json({ message: 'Password reset successful!' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// ============================================================
// AUTH - CHANGE PASSWORD (logged-in user changing their own)
// ============================================================

app.post('/api/auth/change-password', authenticate, validate(changePasswordSchema), async (req, res) => {
    try {
        const { current_password, new_password } = req.body;

        const [rows] = await pool.query(
            'SELECT id, password_hash FROM users WHERE id = ? AND is_active = 1',
            [req.userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const valid = await bcrypt.compare(current_password, rows[0].password_hash);
        if (!valid) {
            return res.status(400).json({ error: 'Current password is incorrect.' });
        }

        const password_hash = await bcrypt.hash(new_password, 10);

        // Get the current session's hash so we can preserve it
        const currentTokenHash = hashToken(req.headers.authorization.split(' ')[1]);

        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, req.userId]);

        // Revoke all OTHER sessions for this user (H-4)
        await pool.query(
            'UPDATE user_sessions SET is_active = 0, logout_time = NOW() WHERE user_id = ? AND is_active = 1 AND session_token != ?',
            [req.userId, currentTokenHash]
        );

        await logAudit(req.userId, 'CHANGE_PASSWORD', 'users', req.userId, null,
            { other_sessions_revoked: true }, req);

        res.json({ message: 'Password updated successfully. Other sessions have been signed out.' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to update password.' });
    }
});

// ============================================================
// AUTH - LOGOUT
// ============================================================

app.post('/api/auth/logout', async (req, res) => {
    try {
        const { session_token } = req.body;

        if (!session_token) {
            return res.status(400).json({ error: 'Session token required' });
        }

        const logoutTokenHash = hashToken(session_token);
        const [sessions] = await pool.query(
            'SELECT user_id FROM user_sessions WHERE session_token = ? AND is_active = 1',
            [logoutTokenHash]
        );

        if (sessions.length > 0) {
            const userId = sessions[0].user_id;

            await pool.query(
                'UPDATE user_sessions SET logout_time = NOW(), is_active = 0 WHERE session_token = ?',
                [logoutTokenHash]
            );

            await logAudit(
                userId,
                'LOGOUT',
                'users',
                userId,
                null,
                null,
                req
            );
        }

        res.json({ message: 'Logout successful' });
    } catch (error) {
        res.status(500).json({ error: 'Logout failed' });
    }
});

// ============================================================
// ✅ FIXED: INCIDENT MANAGEMENT API ROUTES
// ============================================================

// Approved Blotter / Incident type catalog for the searchable dropdown
// (each entry carries the acronym used in the record number).
app.get('/api/record-types', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT record_class, type_name, type_code
             FROM record_type_catalog WHERE is_active = 1
             ORDER BY record_class, type_name`
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load record types' });
    }
});

// Preview of the next public record number for a given form/type. The real
// number is allocated atomically at save time (this does NOT consume the
// sequence), so it is only a best-effort preview for display in the form.
app.get('/api/incidents/next-blotter', authenticate, async (req, res) => {
    try {
        const { form_type = 'blotter', incident_type = '' } = req.query;
        const cls = recordClassFromFormType(form_type);
        const prefix = prefixForClass(cls);
        const code = codeFor(cls, incident_type);
        const [rows] = await pool.query(
            'SELECT next_seq FROM record_number_counters WHERE prefix = ? AND type_code = ?',
            [prefix, code]
        );
        const seq = rows.length ? rows[0].next_seq : 1;
        res.json({ blotter_number: `${prefix}-${code}-${String(seq).padStart(4, '0')}`, preview: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate record number' });
    }
});

registerRecordSummaries(app, { pool, authenticate, readRoles: requireRole(['Executive Officer', 'Kagawad', 'Team Leader']) });

app.get('/api/incidents', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const { page, limit, offset: skip } = pagination(req.query);
        const { type = '', danger = '', date = '', status = '', include_resolved = '', form_type = '' } = req.query;
        const search = validatedSearch(req.query.search);

        // Search/filter moved server-side (was previously done client-side
        // over the whole loaded array) so real pagination doesn't silently
        // break search-outside-the-current-page — mirrors the same
        // pattern /api/incidents/view-only already uses successfully.
        // Active cases only by default; Resolved ones come back when asked
        // for explicitly (status=Resolved) or with include_resolved=1
        // (Reports, which needs every case in the period).
        let filter = ['incidents.is_draft = 0'];
        let params = [];
        if (status) {
            filter.push('TRIM(incidents.status) = ?');
            params.push(status);
        } else if (include_resolved !== '1') {
            filter.push("TRIM(incidents.status) != 'Resolved'");
        }

        if (search) {
            filter.push("(CAST(incidents.id AS CHAR) LIKE ? OR incidents.incident_type LIKE ? OR incidents.street_name LIKE ? OR incidents.description LIKE ?)");
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        if (type) {
            filter.push('incidents.incident_type = ?');
            params.push(type);
        }
        if (danger) {
            filter.push('incidents.danger_level LIKE ?');
            params.push(`%${danger}%`);
        }
        if (date) {
            filter.push('incidents.date = ?');
            params.push(date);
        }
        if (form_type) {
            if (!['crime','blotter'].includes(form_type)) return res.status(400).json({ error: 'Invalid record form type' });
            filter.push('incidents.source = ?');
            params.push(form_type === 'crime' ? 'incident' : 'blotter');
        }

        appendDateFilters(req.query, filter, params, 'incidents');
        const whereClause = filter.length > 0 ? `WHERE ${filter.join(' AND ')}` : '';

        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total FROM incidents ${whereClause}`,
            params
        );
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / parseInt(limit));

        const [rows] = await pool.query(`
            SELECT
                incidents.*,
                users.name as reporter_name,
                users.contact_no as reporter_contact_no,
                rf.total_risk_score as cart_score
            FROM incidents
            LEFT JOIN users ON incidents.reporter_id = users.id
            LEFT JOIN cart_risk_factors rf ON incidents.id = rf.incident_id
            ${whereClause}
            ORDER BY incidents.date DESC, incidents.time DESC, incidents.id DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), skip]);

        res.json({ incidents: rows, total, totalPages, currentPage: parseInt(page) });
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        res.status(500).json({ error: 'Failed to fetch incidents' });
    }
});

// ✅ VIEW-ONLY INCIDENTS (FOR CAPTAIN)
app.get('/api/incidents/view-only', authenticate, async (req, res) => {
    try {
        
        const [users] = await pool.query(
            'SELECT role FROM users WHERE id = ? AND is_active = 1',
            [req.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        const userRole = normalizeRole(users[0].role);

        if (!['Kagawad', 'Executive Officer', 'Kagawad', 'Team Leader'].includes(userRole)) {
            return res.status(403).json({ error: 'Access denied. View-only for Captain and above.' });
        }

        const { page, limit, offset: skip } = pagination(req.query, 10);
        const { type = '', status = '', include_resolved = '', form_type = '' } = req.query;
        const search = validatedSearch(req.query.search);

        let filter = ['incidents.is_draft = 0'];
        let params = [];

        if (!status && include_resolved !== '1') {
            filter.push("TRIM(incidents.status) != 'Resolved'");
        }

        if (search) {
            filter.push("(CAST(incidents.id AS CHAR) LIKE ? OR incidents.incident_type LIKE ? OR incidents.street_name LIKE ? OR incidents.description LIKE ?)");
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        if (type) {
            filter.push("incidents.incident_type = ?");
            params.push(type);
        }

        if (status) {
            filter.push("incidents.status = ?");
            params.push(status);
        }

        if (form_type) {
            if (!['crime','blotter'].includes(form_type)) return res.status(400).json({ error: 'Invalid record form type' });
            filter.push('incidents.source = ?');
            params.push(form_type === 'crime' ? 'incident' : 'blotter');
        }

        appendDateFilters(req.query, filter, params, 'incidents');
        const whereClause = filter.length > 0 ? `WHERE ${filter.join(' AND ')}` : '';

        const [countResult] = await pool.query(`
            SELECT COUNT(*) as total
            FROM incidents
            ${whereClause}
        `, params);

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / parseInt(limit));

        params.push(parseInt(limit), skip);

        const [rows] = await pool.query(`
            SELECT
                incidents.*,
                users.name as reporter_name,
                users.contact_no as reporter_contact_no,
                rf.total_risk_score as cart_score
            FROM incidents
            LEFT JOIN users ON incidents.reporter_id = users.id
            LEFT JOIN cart_risk_factors rf ON incidents.id = rf.incident_id
            ${whereClause}
            ORDER BY incidents.date DESC, incidents.time DESC, incidents.id DESC
            LIMIT ? OFFSET ?
        `, params);


        res.json({
            incidents: rows,
            total,
            totalPages,
            currentPage: parseInt(page)
        });

    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        res.status(500).json({ error: 'Failed to fetch incidents' });
    }
});

// ✅ GET SINGLE INCIDENT (VIEW-ONLY)
app.get('/api/incidents/:id', authenticate, async (req, res) => {
    try {
        
        const [users] = await pool.query(
            'SELECT role FROM users WHERE id = ? AND is_active = 1',
            [req.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        const userRole = normalizeRole(users[0].role);

        if (!['Kagawad', 'Executive Officer', 'Kagawad', 'Team Leader'].includes(userRole)) {
            return res.status(403).json({ error: 'Access denied. View-only for Captain and above.' });
        }

        const [rows] = await pool.query(`
            SELECT
                incidents.*,
                users.name as reporter_name,
                users.contact_no as reporter_contact_no,
                rf.total_risk_score as cart_score,
                rf.decision_path as cart_decision_path
            FROM incidents
            LEFT JOIN users ON incidents.reporter_id = users.id
            LEFT JOIN cart_risk_factors rf ON incidents.id = rf.incident_id
            WHERE incidents.id = ?
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        const row = rows[0];

        // Fetch structured fields from the base table (not exposed by the view)
        const reg = await resolveRegistry(pool, row.id);
        let structured = {};
        if (reg) {
            const [base] = await pool.query(
                `SELECT complainant_first, complainant_middle, complainant_last,
                        respondent_first, respondent_middle, respondent_last,
                        reporter_first, reporter_middle, reporter_last, reporter_address, reporter_contact,
                        complainant_contact,
                        addr_block, addr_lot, addr_house_no, addr_street, addr_unit,
                        no_evidence, no_evidence_reason
                 FROM \`${reg.table}\` WHERE id = ?`, [reg.source_id]);
            if (base.length) structured = base[0];
        }

        const [evidence] = await pool.query(
            'SELECT id, file_path, file_type, original_filename, uploaded_at FROM incident_evidence WHERE incident_id = ? ORDER BY uploaded_at ASC',
            [req.params.id]
        );

        const patrol = await recordPatrol.metadata(row.id);
        const [linkedPatrols] = await pool.query(`SELECT ps.*, pr.scheduled_date, pr.priority, pr.exact_address,
            (SELECT GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ', ') FROM patrol_schedule_tanods st
             JOIN tanods t ON t.id = st.tanod_id WHERE st.schedule_id = ps.id) AS assigned_tanods
            FROM patrol_schedules ps JOIN patrol_schedule_records pr ON pr.schedule_id=ps.id
            WHERE pr.incident_id=? ORDER BY pr.scheduled_date DESC, ps.id DESC`, [row.id]);
        res.json({ ...row, ...structured, ...patrol, evidence, linked_patrols: linkedPatrols });

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch incident' });
    }
});

// Legacy clients receive the same record-level eligibility as the current map.
app.get('/api/heatmap/incidents', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try { res.json((await recordPatrol.mapRecords()).filter(record => record.eligible)); }
    catch { res.status(500).json({ error: 'Failed to fetch patrol map records' }); }
});

app.get('/api/heatmap/street-analysis', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), (req, res) => {
    res.status(410).json({ error: 'Street analysis has been retired. Use /api/heatmap/records for individual record locations and CART scores.' });
});

async function validatePinnedLocation(streetName, latitude, longitude) {
    const [pins] = await pool.query('SELECT latitude, longitude FROM location_coordinates WHERE location = ?', [streetName]);
    if (!pins.length) return { valid: false, reason: 'This street has not been pinned on the Risk Map yet.' };
    const pin = pins[0];
    // The saved street pin represents the valid street area, not one exact
    // household. Keep a small barangay-scale envelope for house/lot detail
    // while still rejecting coordinates outside the pinned street area.
    const valid = Math.abs(Number(pin.latitude) - Number(latitude)) <= 0.01 &&
        Math.abs(Number(pin.longitude) - Number(longitude)) <= 0.01;
    return valid ? { valid: true } : { valid: false, reason: 'The incident location must match the saved street pin.' };
}

app.post('/api/incidents', authenticate, requireRole(['Executive Officer', 'Team Leader']), validate(incidentSchema), async (req, res) => {
    if (req.userRole !== 'Executive Officer' && (req.body.patrol_notes !== undefined || req.body.patrol_override !== undefined)) {
        return res.status(403).json({ error: 'Only the Executive Officer can edit patrol notes or eligibility' });
    }
    const idemKey = req.headers['idempotency-key'];
    if (idemKey) {
        const cached = _idempotencyCache.get(idemKey);
        if (cached) return res.status(cached.status).json(cached.body);
    }

    try {
        const {
            incident_type, date, time, latitude, longitude, street_name, address,
            status, description, recommended_action,
            blotter_number, reported_by_name, statement, persons_involved, priority,
            severity, respondent_name, respondent_address, age, form_type
        } = req.body;

        const finalStreetName = street_name || null;
        const finalAddress = address || null;
        const finalReporterId = req.userId || null;

        const pin = await validatePinnedLocation(finalStreetName, latitude, longitude);
        if (!pin.valid) return res.status(400).json({ error: 'A valid pinned location is required.', details: [pin.reason] });

        if (form_type === 'blotter' && !req.body.is_draft) {
            const missing = [];
            if (!req.body.respondent_first) missing.push('respondent_first');
            if (!req.body.respondent_last) missing.push('respondent_last');
            if (missing.length) return res.status(400).json({ error: 'Validation failed', details: missing.map(f => `"${f}" is required for non-draft blotter records`) });
        }

        const timeOfDay = computeTimeOfDay(time);
        const dayOfWeek = getDayOfWeek(date);
        const isWeekend = isDateWeekend(date);

        const cls = recordClassFromFormType(form_type);
        if (!isValidType(cls, incident_type)) {
            return res.status(400).json({ error: 'Validation failed', details: [`"${incident_type}" is not an approved ${cls} type`] });
        }

        const table = baseTableForClass(cls);
        const typeCode = codeFor(cls, incident_type);

        let registryId, publicNumber;
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            publicNumber = await allocPublicNumber(conn, prefixForClass(cls), typeCode);
            const baseFields = buildIncidentFields(req.body, { timeOfDay, dayOfWeek, isWeekend }, typeCode, finalReporterId);
            baseFields.data_origin = 'real';
            const [ins] = await conn.query(`INSERT INTO \`${table}\` SET ?`, [baseFields]);
            const [reg] = await conn.query(
                `INSERT INTO record_registry (source, source_id, public_number, type_code) VALUES (?, ?, ?, ?)`,
                [cls, ins.insertId, publicNumber, typeCode]
            );
            registryId = reg.insertId;
            await recordPatrol.saveMetadata(conn, registryId, req.body, req.userId);
            await conn.commit();
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        } finally {
            conn.release();
        }

        await computeCartRiskFactors(registryId);
        heatmapCache.del('incidents'); heatmapCache.del('street-analysis');

        // A new incident here means this street is active again - clear
        // any patrol decay so it isn't still suppressed below its real
        // (freshly recomputed) CART risk score.
        await resetAreaRisk(finalStreetName);

        const userId = req.userId;

        if (userId) {
            await logAudit(
                userId,
                'CREATE_INCIDENT',
                'incidents',
                registryId,
                null,
                req.body,
                req
            );
        }

        broadcastNotification({
            type: 'new_incident',
            incidentId: registryId,
            incidentType: incident_type,
            location: finalStreetName || address || 'unknown location',
            timestamp: new Date().toISOString()
        });

        const responseBody = { message: 'Incident saved successfully.', id: registryId, blotter_number: publicNumber };
        if (idemKey) _idempotencyCache.set(idemKey, { status: 201, body: responseBody, ts: Date.now() });
        res.status(201).json(responseBody);

    } catch (error) {
        res.status(500).json({ error: 'Failed to create incident' });
    }
});

app.put('/api/incidents/:id', authenticate, requireRole(['Executive Officer']), validate(incidentSchema), async (req, res) => {
    if (req.userRole !== 'Executive Officer' && (req.body.patrol_notes !== undefined || req.body.patrol_override !== undefined)) {
        return res.status(403).json({ error: 'Only the Executive Officer can edit patrol notes or eligibility' });
    }
    try {
        const {
            incident_type, date, time, latitude, longitude, street_name, address,
            status, description, recommended_action,
            blotter_number, reported_by_name, statement, persons_involved, priority,
            severity, respondent_name, respondent_address, age, form_type
        } = req.body;
        const id = req.params.id;

        const [oldData] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);

        const finalStreetName = street_name || null;
        const finalAddress = address || null;
        const finalReporterId = oldData[0]?.reporter_id ?? null;

        const pin = await validatePinnedLocation(finalStreetName, latitude, longitude);
        if (!pin.valid) return res.status(400).json({ error: 'A valid pinned location is required.', details: [pin.reason] });

        const timeOfDay = computeTimeOfDay(time);
        const dayOfWeek = getDayOfWeek(date);
        const isWeekend = isDateWeekend(date);

        const reg = await resolveRegistry(pool, id);
        if (!reg) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        const expectedFormType = reg.source === 'incident' ? 'crime' : 'blotter';
        if (form_type && form_type !== expectedFormType) {
            return res.status(400).json({ error: 'Record classification cannot be changed after creation' });
        }

        if (!isValidType(reg.source, incident_type)) {
            return res.status(400).json({ error: 'Validation failed', details: [`"${incident_type}" is not an approved ${reg.source} type`] });
        }

        if (reg.source === 'blotter' && !req.body.is_draft) {
            const missing = [];
            if (!req.body.respondent_first) missing.push('respondent_first');
            if (!req.body.respondent_last) missing.push('respondent_last');
            if (missing.length) return res.status(400).json({ error: 'Validation failed', details: missing.map(f => `"${f}" is required for non-draft blotter records`) });
        }

        const typeCode = codeFor(reg.source, incident_type);
        const updFields = buildIncidentFields(req.body, { timeOfDay, dayOfWeek, isWeekend }, typeCode, finalReporterId);
        const [result] = await pool.query(`UPDATE \`${reg.table}\` SET ? WHERE id = ?`, [updFields, reg.source_id]);
        await recordPatrol.saveMetadata(pool, id, req.body, req.userId);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        await computeCartRiskFactors(id);
        heatmapCache.del('incidents'); heatmapCache.del('street-analysis');

        const userId = req.userId;

        if (userId) {
            await logAudit(
                userId,
                'UPDATE_INCIDENT',
                'incidents',
                id,
                oldData[0] || null,
                req.body,
                req
            );
        }

        broadcastNotification({
            type: 'incident_updated',
            incidentId: id,
            timestamp: new Date().toISOString()
        });

        res.json({ message: 'Incident updated successfully.' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to update incident' });
    }
});

app.delete('/api/incidents/:id', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.userId;

        const [oldData] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
        if (oldData.length === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }
        const [evidenceRows] = await pool.query('SELECT * FROM incident_evidence WHERE incident_id = ?', [id]);

        // Archived, not erased: snapshot the incident with its evidence rows
        // (which cascade-delete with it), then remove it - one transaction.
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const files = [];
            // Snapshot enough to rebuild Option A exactly: the view row (for the
            // label / back-compat), the base row and the registry row.
            const reg = await resolveRegistry(conn, id);
            let baseRow = null;
            if (reg) {
                const [br] = await conn.query(`SELECT * FROM \`${reg.table}\` WHERE id = ?`, [reg.source_id]);
                baseRow = br[0] || null;
            }
            const [rr] = await conn.query('SELECT * FROM record_registry WHERE registry_id = ?', [id]);
            const [patrolMetadata] = await conn.query('SELECT * FROM record_patrol_details WHERE incident_id=?', [id]);
            const [linkedScheduleRecords] = await conn.query('SELECT schedule_id FROM patrol_schedule_records WHERE incident_id=?', [id]);
            await archive.archiveRecord(conn, {
                entityType: 'incident',
                entityId: Number(id),
                label: `Incident #${id}: ${oldData[0].incident_type} - ${oldData[0].street_name || 'no street'} (${oldData[0].date})`,
                data: { row: oldData[0], baseRow, registry: rr[0] || null, source: reg ? reg.source : null, evidence: evidenceRows,
                    patrol_metadata: patrolMetadata[0] || null, linked_schedule_ids: linkedScheduleRecords.map(record => record.schedule_id) },
                files,
                deletedBy: userId
            });
            await conn.query('DELETE FROM cart_risk_factors WHERE incident_id = ?', [id]);
            if (reg) await conn.query(`DELETE FROM \`${reg.table}\` WHERE id = ?`, [reg.source_id]);
            await conn.query('DELETE FROM record_registry WHERE registry_id = ?', [id]);
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        // Move the files into the archive folder (kept, not deleted) and
        // record where they went so a restore can put them back.
        const movedFiles = [];
        evidenceRows.forEach(row => {
            const original = `incident-evidence/${row.file_path}`;
            const archived = archive.archiveFile(original);
            if (archived) movedFiles.push({ original, archived });
        });
        // Incidents reported with a field photo keep it in the archive too.
        if (oldData[0].photo_path) {
            const original = `incident-photos/${path.basename(oldData[0].photo_path)}`;
            const archived = archive.archiveFile(original);
            if (archived) movedFiles.push({ original, archived });
        }
        if (movedFiles.length) {
            await pool.query(
                `UPDATE archived_records SET files = ? WHERE entity_type = 'incident' AND entity_id = ? AND restored_at IS NULL`,
                [JSON.stringify(movedFiles), id]
            );
        }

        heatmapCache.del('incidents'); heatmapCache.del('street-analysis');

        if (userId) {
            await logAudit(
                userId,
                'DELETE_INCIDENT',
                'incidents',
                id,
                oldData[0] || null,
                null,
                req
            );
        }

        res.json({ message: 'Incident moved to the Archive.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete incident' });
    }
});

// ============================================================
// INCIDENT EVIDENCE (images/videos attached to an incident record)
// ============================================================

// Runs BEFORE multer writes anything to disk: the incident id ends up in
// the evidence filename, so it must be a plain number (a URL-decoded
// "../" would otherwise let the file land outside the evidence folder),
// and the incident must exist so a bad id doesn't leave a stray file.
async function requireExistingIncident(req, res, next) {
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid incident id' });
    }
    try {
        const [rows] = await pool.query('SELECT id FROM incidents WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }
        next();
    } catch (error) {
        res.status(500).json({ error: 'Failed to upload evidence' });
    }
}

app.post('/api/incidents/:id/evidence', authenticate, requireRole(['Executive Officer', 'Team Leader']), requireExistingIncident, runMulterMiddleware(evidenceUpload.array('evidence', 5)), validateMagicBytes, async (req, res) => {
    try {
        const id = req.params.id;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No evidence files uploaded.' });
        }

        const inserted = [];
        for (const file of req.files) {
            const fileType = file.mimetype.startsWith('video/') ? 'video' : 'image';
            const [result] = await pool.query(
                `INSERT INTO incident_evidence (incident_id, file_path, file_type, original_filename)
                 VALUES (?, ?, ?, ?)`,
                [id, file.filename, fileType, file.originalname]
            );
            inserted.push({ id: result.insertId, incident_id: Number(id), file_path: file.filename, file_type: fileType, original_filename: file.originalname });
        }

        const userId = req.userId;
        if (userId) {
            await logAudit(userId, 'ADD_INCIDENT_EVIDENCE', 'incidents', id, null, { files: inserted.map(f => f.file_path) }, req);
        }

        res.status(201).json({ message: 'Evidence uploaded successfully.', evidence: inserted });
    } catch (error) {
        res.status(500).json({ error: 'Failed to upload evidence' });
    }
});

app.delete('/api/incidents/:id/evidence/:evidenceId', authenticate, requireRole(['Executive Officer', 'Team Leader']), async (req, res) => {
    try {
        const { id, evidenceId } = req.params;

        const [rows] = await pool.query(
            'SELECT * FROM incident_evidence WHERE id = ? AND incident_id = ?',
            [evidenceId, id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Evidence file not found' });
        }

        const userId = req.userId;
        const original = `incident-evidence/${rows[0].file_path}`;
        const archiveId = await archive.archiveRecord(pool, {
            entityType: 'incident_evidence',
            entityId: Number(evidenceId),
            label: `Evidence for incident #${id}: ${rows[0].original_filename || rows[0].file_path}`,
            data: { row: rows[0] },
            deletedBy: userId
        });
        await pool.query('DELETE FROM incident_evidence WHERE id = ?', [evidenceId]);

        // Kept in the archive folder (not deleted) so it can be restored.
        const archived = archive.archiveFile(original);
        if (archived) {
            await pool.query('UPDATE archived_records SET files = ? WHERE id = ?', [JSON.stringify([{ original, archived }]), archiveId]);
        }

        if (userId) {
            await logAudit(userId, 'DELETE_INCIDENT_EVIDENCE', 'incidents', id, rows[0], null, req);
        }

        res.json({ message: 'Evidence moved to the Archive.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete evidence' });
    }
});

// ============================================================
// 🆕 CART PATROL INTEGRATION - Get CART data for patrol
// ============================================================

app.get('/api/patrol/cart-summary', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const { month } = req.query;
        
        if (!month) {
            return res.status(400).json({ error: 'Month parameter required (YYYY-MM)' });
        }
        
        
        // Get incidents with CART risk factors for the month
        const [results] = await pool.query(`
            SELECT 
                i.id,
                i.incident_type,
                i.date,
                i.time,
                i.street_name,
                i.status,
                i.danger_level as incident_danger,
                rf.time_risk_score,
                rf.day_risk_score,
                rf.type_risk_score,
                rf.location_risk_score,
                rf.frequency_risk_score,
                rf.total_risk_score,
                rf.danger_level as cart_danger_level,
                rf.decision_path,
                rf.calculated_at
            FROM incidents i
            LEFT JOIN cart_risk_factors rf ON i.id = rf.incident_id
            WHERE i.date LIKE ?
            AND TRIM(i.status) != 'Resolved' AND i.is_draft = 0
            ORDER BY rf.total_risk_score DESC
        `, [`${month}%`]);
        
        
        // Group by location
        const locationMap = {};
        results.forEach(incident => {
            const location = incident.street_name || 'Unknown';
            if (!locationMap[location]) {
                locationMap[location] = {
                    incidents: [],
                    totalRisk: 0,
                    maxRisk: 0,
                    avgRisk: 0,
                    count: 0,
                    levels: [],
                    riskScores: []
                };
            }
            const data = locationMap[location];
            data.incidents.push(incident);
            data.count++;
            const riskScore = parseFloat(incident.total_risk_score) || 0;
            data.totalRisk += riskScore;
            data.maxRisk = Math.max(data.maxRisk, riskScore);
            data.riskScores.push(riskScore);
            if (incident.cart_danger_level) {
                data.levels.push(incident.cart_danger_level);
            }
        });
        
        // Calculate averages and determine dominant danger level
        const summary = Object.entries(locationMap).map(([location, data]) => {
            const avgRisk = data.totalRisk / data.count;
            
            // Determine dominant danger level
            const levelCount = {};
            data.levels.forEach(level => {
                let key = 'Level 1';
                if (level.includes('Level 3') || level.includes('High')) {
                    key = 'Level 3';
                } else if (level.includes('Level 2') || level.includes('Moderate')) {
                    key = 'Level 2';
                }
                levelCount[key] = (levelCount[key] || 0) + 1;
            });
            
            let dominantLevel = 'Level 1';
            let maxCount = 0;
            Object.keys(levelCount).forEach(level => {
                if (levelCount[level] > maxCount) {
                    maxCount = levelCount[level];
                    dominantLevel = level;
                }
            });
            
            // Determine priority
            let priority = 'low';
            if (dominantLevel === 'Level 3' || data.maxRisk >= 67) {
                priority = 'high';
            } else if (dominantLevel === 'Level 2' || data.maxRisk >= 34) {
                priority = 'medium';
            }
            
            return {
                location,
                incidentCount: data.count,
                avgRiskScore: parseFloat(avgRisk.toFixed(2)),
                maxRiskScore: parseFloat(data.maxRisk.toFixed(2)),
                dangerLevel: dominantLevel,
                priority: priority,
                riskScores: data.riskScores
            };
        });
        
        // Sort by risk (highest first)
        summary.sort((a, b) => b.maxRiskScore - a.maxRiskScore);
        
        // Get top 5 recommendations
        const recommendations = summary.slice(0, 5).map(item => ({
            location: item.location,
            incidentCount: item.incidentCount,
            avgRiskScore: item.avgRiskScore,
            maxRiskScore: item.maxRiskScore,
            dangerLevel: item.dangerLevel,
            priority: item.priority
        }));
        
        res.json({
            success: true,
            month: month,
            totalIncidents: results.length,
            locations: summary,
            recommendations: recommendations,
            hasCartData: results.some(r => r.total_risk_score !== null)
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: 'Failed to get CART patrol summary' 
        });
    }
});


// ============================================================
// DASHBOARD STATISTICS API ROUTE
// ============================================================

app.get('/api/dashboard/stats', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        // "Total Active Incidents" card: Open + Monitoring only, same basis
        // as the risk KPIs below. Incident View's Total counts every record
        // (with Resolved shown as its own card).
        const [totalResult] = await pool.query("SELECT COUNT(*) as total FROM incidents WHERE TRIM(status) != 'Resolved' AND is_draft = 0");
        const totalIncidents = totalResult[0].total;

        // Incidents actually logged today, not just "whatever date last had
        // activity" - the old query could silently show a stale prior date's
        // count under a label that said "latest active day".
        const [todayResult] = await pool.query(
            'SELECT COUNT(*) as count FROM incidents WHERE TRIM(status) != "Resolved" AND is_draft = 0 AND DATE(date) = CURDATE()'
        );
        const todayIncidents = todayResult[0].count;

        // Compares against calendar-month date ranges rather than a bare
        // MONTH(date) equality - the old MONTH(CURDATE()) - 1 check broke
        // every January (evaluates to 0, matching nothing) and the old
        // YEAR(date) = YEAR(CURDATE()) filter would have excluded last
        // December anyway even if the month math were fixed.
        const [changeResult] = await pool.query(`
            SELECT
                SUM(CASE WHEN date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN 1 ELSE 0 END) as current_month,
                SUM(CASE WHEN date >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01')
                          AND date < DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN 1 ELSE 0 END) as prev_month
            FROM incidents
            WHERE date >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01')
              AND TRIM(status) != 'Resolved' AND is_draft = 0
        `);
        const current = changeResult[0].current_month || 0;
        const prev = changeResult[0].prev_month || 0;
        const change = current - prev;

        const [zonesResult] = await pool.query(
            "SELECT COUNT(DISTINCT latitude, longitude) as zones FROM incidents WHERE TRIM(status) != 'Resolved' AND is_draft = 0"
        );
        const zones = zonesResult[0].zones;

        const [commonResult] = await pool.query(`
            SELECT incident_type, COUNT(*) as count
            FROM incidents
            WHERE TRIM(status) != 'Resolved' AND is_draft = 0
            GROUP BY incident_type
            ORDER BY count DESC
            LIMIT 1
        `);
        const common = commonResult.length > 0 ? commonResult[0].incident_type : "N/A";

        const [areaResult] = await pool.query(`
            SELECT COALESCE(street_name, CONCAT(latitude, ', ', longitude)) as location, COUNT(*) as count
            FROM incidents
            WHERE TRIM(status) != 'Resolved' AND is_draft = 0
            GROUP BY COALESCE(street_name, CONCAT(latitude, ', ', longitude))
            ORDER BY count DESC
            LIMIT 1
        `);
        const area = areaResult.length > 0 ? areaResult[0].location : "N/A";

        const [peakResult] = await pool.query(`
            SELECT HOUR(time) as hour, COUNT(*) as count
            FROM incidents
            WHERE TRIM(status) != 'Resolved' AND is_draft = 0
            GROUP BY HOUR(time)
            ORDER BY count DESC
            LIMIT 1
        `);
        const peakHour = peakResult.length > 0 ? peakResult[0].hour : 0;
        // Counted per single clock hour (GROUP BY HOUR), so label that hour.
        const peak = `${String(peakHour).padStart(2, '0')}:00 - ${String((peakHour + 1) % 24).padStart(2, '0')}:00`;

        // Distinct streets carrying at least one Level 3 (high-risk)
        // incident, not a raw incident count - tells patrol planning how
        // many different locations need attention, not how many reports
        // piled up at the same one.
        const [riskStreetsResult] = await pool.query(
            "SELECT COUNT(DISTINCT street_name) as riskStreets FROM incidents WHERE danger_level LIKE '%Level 3%' AND TRIM(status) != 'Resolved' AND is_draft = 0 AND street_name IS NOT NULL"
        );
        const riskStreets = riskStreetsResult[0].riskStreets;

        const [formTypeCounts] = await pool.query(
            "SELECT COALESCE(form_type, 'blotter') as form_type, COUNT(*) as count FROM incidents WHERE TRIM(status) != 'Resolved' AND is_draft = 0 GROUP BY COALESCE(form_type, 'blotter')"
        );
        const blotterCount = formTypeCounts.find(r => r.form_type === 'blotter')?.count || 0;
        const crimeCount = formTypeCounts.find(r => r.form_type === 'crime')?.count || 0;

        res.json({
            incidents: totalIncidents,
            todayIncidents: todayIncidents,
            change: change,
            zones: zones,
            common: common,
            area: area,
            peak: peak,
            riskStreets: riskStreets,
            blotterCount: blotterCount,
            crimeCount: crimeCount
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

app.get('/api/dashboard/charts', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const [typesResult] = await pool.query(`
            SELECT incident_type, COUNT(*) as count
            FROM incidents
            WHERE TRIM(status) != 'Resolved' AND is_draft = 0
            GROUP BY incident_type
            ORDER BY count DESC
        `);

        let low = 0, moderate = 0, high = 0;
        const [dangerResult] = await pool.query('SELECT danger_level, COUNT(*) AS count FROM incidents WHERE TRIM(status) != "Resolved" AND is_draft = 0 GROUP BY danger_level');
        dangerResult.forEach(row => {
            const level = row.danger_level || '';
            if (level.includes('Level 3') || level.includes('High')) high += Number(row.count);
            else if (level.includes('Level 2') || level.includes('Moderate')) moderate += Number(row.count);
            else low += Number(row.count);
        });

        // Anchored to the most recent incident date rather than the
        // server's real clock - a barangay system's "today" and its
        // latest logged incident can easily drift apart (backfilled data,
        // a quiet reporting day, a demo dataset), which would otherwise
        // leave this widget silently empty despite having 7 days of data.
        // Broken out per incident_type (not just a daily total) so the
        // dashboard can plot the trend for one crime type at a time -
        // the frontend aggregates these rows into the "All Types" total
        // itself instead of a second query.
        const [trendResult] = await pool.query(`
            SELECT DATE(date) as day_date, incident_type, COUNT(*) as count
            FROM incidents
            WHERE TRIM(status) != 'Resolved' AND is_draft = 0
              AND date >= DATE_SUB((SELECT MAX(date) FROM incidents WHERE TRIM(status) != 'Resolved' AND is_draft = 0), INTERVAL 6 DAY)
            GROUP BY DATE(date), incident_type
            ORDER BY day_date ASC
        `);

        const [hourlyResult] = await pool.query(`
            SELECT HOUR(time) as hour, COUNT(*) as count
            FROM incidents
            WHERE TRIM(status) != 'Resolved' AND is_draft = 0
            GROUP BY HOUR(time)
            ORDER BY hour ASC
        `);

        res.json({
            types: typesResult,
            danger: { low, moderate, high },
            trend: trendResult,
            hourly: hourlyResult
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch charts data' });
    }
});

// Per-street risk decay accumulated from completed patrols (see
// decayAreaRisk/resetAreaRisk) - the frontend subtracts this from each
// street's live CART risk score when building patrol recommendations.
app.get('/api/patrol/area-decay', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT location, decay_amount FROM area_risk_decay WHERE decay_amount > 0'
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch area risk decay' });
    }
});

// ---------- PATROL SCHEDULES ----------

const NAVIGATION_PAGES = [
    'dashboard.html',
    'incident.html',
    'incident-view.html',
    'grid-heatmap.html',
    'patrol.html',
    'report.html',
    'users.html',
    'settings.html'
];
const MEDIATION_STATUSES = ['Pending', 'In Progress', 'Canceled', 'Rescheduled'];
const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function isPositiveId(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0;
}

function toMysqlLocalDateTime(value) {
    const match = LOCAL_DATE_TIME_RE.exec(value || '');
    if (!match) return null;

    const [, year, month, day, hour, minute] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    const isExact = parsed.getFullYear() === Number(year)
        && parsed.getMonth() === Number(month) - 1
        && parsed.getDate() === Number(day)
        && parsed.getHours() === Number(hour)
        && parsed.getMinutes() === Number(minute);

    return isExact ? `${year}-${month}-${day} ${hour}:${minute}:00` : null;
}

// Personal navigation preferences; always scoped to the authenticated account.
app.get('/api/me/navigation-order', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT icon_order FROM user_navigation_preferences WHERE user_id = ?',
            [req.userId]
        );

        if (rows.length === 0) return res.json({ order: [] });

        const stored = typeof rows[0].icon_order === 'string'
            ? JSON.parse(rows[0].icon_order)
            : rows[0].icon_order;
        const valid = Array.isArray(stored)
            && stored.length === NAVIGATION_PAGES.length
            && new Set(stored).size === NAVIGATION_PAGES.length
            && stored.every(page => NAVIGATION_PAGES.includes(page));

        res.json({ order: valid ? stored : [] });
    } catch (error) {
        res.status(500).json({ error: 'Could not load navigation preferences' });
    }
});

app.put('/api/me/navigation-order', authenticate, async (req, res) => {
    const order = req.body.order;
    const valid = Array.isArray(order)
        && order.length === NAVIGATION_PAGES.length
        && new Set(order).size === NAVIGATION_PAGES.length
        && order.every(page => NAVIGATION_PAGES.includes(page));

    if (!valid) return res.status(400).json({ error: 'Invalid navigation order' });

    try {
        await pool.query(
            `INSERT INTO user_navigation_preferences (user_id, icon_order)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE icon_order = VALUES(icon_order)`,
            [req.userId, JSON.stringify(order)]
        );
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: 'Could not save navigation preferences' });
    }
});

// Blotter mediation is outside this project's early-warning and patrol scope.
// Keep a clear retired response for stale clients instead of silently falling
// through to the former assignment handlers below.
app.use([
    '/api/mediation-tasks', '/api/mediation-tasks/*',
    '/api/me/mediation-tasks', '/api/me/mediation-tasks/*'
], authenticate, (_req, res) => res.status(410).json({ error: 'Blotter mediation has been retired.' }));

// Legacy handlers below are unreachable and retained temporarily for safe
// deployments whose databases still contain historical mediation records.
app.get('/api/me/mediation-tasks', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT t.*, i.blotter_number, i.incident_type, i.priority, i.street_name
            FROM mediation_tasks t
            JOIN incidents i ON i.id = t.incident_id
            WHERE t.assigned_user_id = ?
              AND t.scheduled_at >= CURDATE()
              AND t.scheduled_at < CURDATE() + INTERVAL 1 DAY
            ORDER BY CASE LOWER(i.priority)
                WHEN 'critical' THEN 0
                WHEN 'urgent' THEN 1
                WHEN 'high' THEN 2
                WHEN 'medium' THEN 3
                WHEN 'normal' THEN 4
                WHEN 'low' THEN 5
                ELSE 6
            END, t.scheduled_at ASC
        `, [req.userId]);
        res.json(rows);
    } catch (error) {
        console.error('Could not load mediation tasks:', error.message);
        res.status(500).json({ error: 'Could not load mediation tasks' });
    }
});

app.get('/api/me/mediation-tasks/:id/history', authenticate, async (req, res) => {
    if (!isPositiveId(req.params.id)) {
        return res.status(400).json({ error: 'Invalid task id' });
    }

    try {
        const [owned] = await pool.query(
            'SELECT id FROM mediation_tasks WHERE id = ? AND assigned_user_id = ?',
            [req.params.id, req.userId]
        );
        if (owned.length === 0) return res.status(404).json({ error: 'Task not found' });

        const [rows] = await pool.query(`
            SELECT h.status, h.note, h.scheduled_at, h.created_at, u.name AS author
            FROM mediation_task_history h
            JOIN users u ON u.id = h.actor_id
            WHERE h.task_id = ?
            ORDER BY h.id DESC
        `, [req.params.id]);
        res.json(rows);
    } catch (error) {
        console.error('Could not load mediation task history:', error.message);
        res.status(500).json({ error: 'Could not load task history' });
    }
});

app.post('/api/mediation-tasks', authenticate, requireRole(['Executive Officer', 'Team Leader']), async (req, res) => {
    const incidentId = Number(req.body.incident_id);
    const assignedUserId = Number(req.body.assigned_user_id);
    const scheduledAt = toMysqlLocalDateTime(req.body.scheduled_at);

    if (!isPositiveId(incidentId) || !isPositiveId(assignedUserId) || !scheduledAt) {
        return res.status(400).json({ error: 'Valid incident, assignee and date/time required' });
    }

    let conn;
    try {
        const [records] = await pool.query(
            "SELECT registry_id FROM record_registry WHERE registry_id = ? AND source = 'blotter'",
            [incidentId]
        );
        const [users] = await pool.query(
            "SELECT id FROM users WHERE id = ? AND is_active = 1 AND role = 'Kagawad'",
            [assignedUserId]
        );
        if (records.length === 0 || users.length === 0) {
            return res.status(400).json({ error: 'Active Kagawad and blotter incident required' });
        }

        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [result] = await conn.query(
            `INSERT INTO mediation_tasks (incident_id, assigned_user_id, scheduled_at, created_by)
             VALUES (?, ?, ?, ?)`,
            [incidentId, assignedUserId, scheduledAt, req.userId]
        );
        await conn.query(
            `INSERT INTO mediation_task_history (task_id, actor_id, status, note, scheduled_at)
             VALUES (?, ?, 'Pending', ?, ?)`,
            [result.insertId, req.userId, 'Task assigned.', scheduledAt]
        );
        await conn.commit();

        await logAudit(req.userId, 'CREATE_MEDIATION_TASK', 'mediation_tasks', result.insertId, null, {
            incident_id: incidentId,
            assigned_user_id: assignedUserId,
            scheduled_at: scheduledAt
        }, req);

        res.status(201).json({ id: result.insertId });
    } catch (error) {
        if (conn) await conn.rollback().catch(() => {});
        console.error('Could not create mediation task:', error.message);
        res.status(500).json({ error: 'Could not create task' });
    } finally {
        if (conn) conn.release();
    }
});

app.patch('/api/me/mediation-tasks/:id', authenticate, async (req, res) => {
    if (!isPositiveId(req.params.id)) {
        return res.status(400).json({ error: 'Invalid task id' });
    }

    const { status, scheduled_at: requestedDate } = req.body;
    const note = typeof req.body.note === 'string' ? req.body.note.trim() : null;
    const rescheduledAt = status === 'Rescheduled' ? toMysqlLocalDateTime(requestedDate) : null;

    if (!MEDIATION_STATUSES.includes(status) || note === null || note.length > 4000) {
        return res.status(400).json({ error: 'Invalid status or note' });
    }
    if (status === 'Rescheduled' && !rescheduledAt) {
        return res.status(400).json({ error: 'New date/time required' });
    }

    let conn;
    let previous;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [rows] = await conn.query(
            'SELECT * FROM mediation_tasks WHERE id = ? AND assigned_user_id = ? FOR UPDATE',
            [req.params.id, req.userId]
        );
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Task not found' });
        }

        previous = rows[0];
        const scheduledAt = rescheduledAt || previous.scheduled_at;
        await conn.query(
            'UPDATE mediation_tasks SET status = ?, scheduled_at = ? WHERE id = ?',
            [status, scheduledAt, req.params.id]
        );
        await conn.query(
            `INSERT INTO mediation_task_history (task_id, actor_id, status, note, scheduled_at)
             VALUES (?, ?, ?, ?, ?)`,
            [req.params.id, req.userId, status, note, scheduledAt]
        );
        await conn.commit();

        await logAudit(req.userId, 'UPDATE_MEDIATION_TASK', 'mediation_tasks', req.params.id, previous, {
            status,
            note,
            scheduled_at: scheduledAt
        }, req);

        res.json({ ok: true });
    } catch (error) {
        if (conn) await conn.rollback().catch(() => {});
        console.error('Could not update mediation task:', error.message);
        res.status(500).json({ error: 'Could not update task' });
    } finally {
        if (conn) conn.release();
    }
});

function scheduleDateKey(date) {
    return new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10);
}
function addScheduleDays(date, days) {
    const result = new Date(`${date}T12:00:00Z`);
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
}
function scheduleDayName(date) {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}
function scheduleOccurrences(body) {
    const type = body.recurrence_type || 'single';
    if (type === 'single') return [body.scheduled_date ? scheduleDateKey(body.scheduled_date) : null];
    const start = scheduleDateKey(body.scheduled_date);
    if (!body.recurrence_end_date) throw Object.assign(new Error('A recurrence end date is required.'), { statusCode: 400 });
    const end = scheduleDateKey(body.recurrence_end_date);
    if (end < start) throw Object.assign(new Error('Recurrence end date must be on or after the start date.'), { statusCode: 400 });
    const days = new Set((body.recurrence_days || []).map(String));
    const result = [];
    for (let current = start; current <= end && result.length <= 366; current = addScheduleDays(current, 1)) {
        const matches = type === 'daily'
            ? Math.floor((new Date(`${current}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000) % (body.recurrence_interval || 1) === 0
            : type === 'weekly'
                ? Math.floor((new Date(`${current}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000 / 7) % (body.recurrence_interval || 1) === 0 && (!days.size || days.has(scheduleDayName(current)))
                : days.has(scheduleDayName(current));
        if (matches) result.push(current);
    }
    if (result.length > 366) throw Object.assign(new Error('Recurring schedules are limited to 366 occurrences.'), { statusCode: 400 });
    return result;
}
async function scheduleConflictsOrNull(req, scheduleId = null) {
    if (!req.body.scheduled_date || req.body.status === 'Cancelled') return [];
    const conflicts = [];
    for (const date of scheduleOccurrences(req.body)) {
        conflicts.push(...await recordPatrol.getScheduleConflicts({
            tanodIds: req.body.tanod_ids || [], teamId: req.body.team_id, personnel: req.body.personnel || [], scheduledDate: date,
            startTime: req.body.start_time, endTime: req.body.end_time, excludeId: scheduleId
        }));
    }
    return [...new Map(conflicts.map(item => [`${item.schedule_id}:${item.tanod_id}:${item.date}`, item])).values()];
}

app.get('/api/patrol-calendar', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const date = scheduleDateKey(req.query.date || new Date().toISOString().slice(0, 10));
        const view = ['day', 'week', 'month'].includes(req.query.view) ? req.query.view : 'week';
        const start = view === 'day' ? date : view === 'week' ? addScheduleDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay() + 1) : `${date.slice(0, 7)}-01`;
        const end = view === 'day' ? date : view === 'week' ? addScheduleDays(start, 6) : addScheduleDays(addScheduleDays(start, 32).slice(0, 8) + '01', -1);
        const [rows] = await pool.query(`SELECT ps.*, pr.incident_id, pr.scheduled_date, pr.priority, pr.exact_address, pr.team_name,
                i.blotter_number, i.form_type, i.street_name, i.address
            FROM patrol_schedules ps LEFT JOIN patrol_schedule_records pr ON pr.schedule_id=ps.id
            LEFT JOIN incidents i ON i.id=pr.incident_id
            WHERE pr.scheduled_date BETWEEN ? AND ? ORDER BY pr.scheduled_date, ps.start_time, ps.id`, [start, end]);
        res.json(await Promise.all(rows.map(async row => ({ ...row, ...await recordPatrol.scheduleExtras(row.id) }))));
    } catch (error) { res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load patrol calendar' }); }
});

app.get('/api/patrol-schedules', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const {limit,offset} = pagination(req.query,100);
        const [rows] = await pool.query(`
            SELECT * FROM patrol_schedules 
            WHERE status = 'Active' 
            ORDER BY day_of_week, start_time, id LIMIT ? OFFSET ?
        `,[limit,offset]);
        res.json(await Promise.all(rows.map(async row => ({ ...row, ...await recordPatrol.scheduleExtras(row.id) }))));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch schedules' });
    }
});

app.get('/api/patrol-schedules/all', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const {limit,offset,page} = pagination(req.query,10);
        const search = validatedSearch(req.query.search);
        const conditions = [], params = [];
        if (req.query.status) { conditions.push('ps.status = ?'); params.push(req.query.status); }
        if (search) {
            conditions.push('(ps.location LIKE ? OR ps.day_of_week LIKE ? OR ps.reason LIKE ? OR pr.team_name LIKE ?)');
            const term = `%${search}%`;
            params.push(term, term, term, term);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const joins = 'FROM patrol_schedules ps LEFT JOIN patrol_schedule_records pr ON pr.schedule_id = ps.id LEFT JOIN incidents i ON i.id = pr.incident_id';
        const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total ${joins} ${where}`,params);
        const [rows] = await pool.query(`
            SELECT ps.*, pr.incident_id, pr.scheduled_date, pr.priority, pr.exact_address, pr.team_name,
                   i.blotter_number, i.form_type, i.address, i.street_name
                   ${joins} ${where}
            ORDER BY FIELD(ps.status,'Active','Completed','Cancelled'), ps.day_of_week, ps.start_time, ps.id LIMIT ? OFFSET ?
        `,[...params,limit,offset]);
        res.set({'X-Total-Count':String(total),'X-Total-Pages':String(Math.ceil(total/limit)),'X-Current-Page':String(page)});
        res.json(await Promise.all(rows.map(async row => ({ ...row, ...await recordPatrol.scheduleExtras(row.id) }))));
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        res.status(500).json({ error: 'Failed to fetch schedules' });
    }
});

app.get('/api/patrol-schedules/options', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req,res) => {
    try {
        const search = validatedSearch(req.query.search);
        const [rows] = await pool.query(`SELECT id, location, day_of_week, start_time, end_time, status FROM patrol_schedules
            WHERE location LIKE ? ORDER BY status='Active' DESC, id DESC LIMIT 50`, [`%${search}%`]);
        res.json(rows);
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        res.status(500).json({error:'Could not load schedule choices'});
    }
});

app.get('/api/patrol-schedules/:id', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM patrol_schedules WHERE id = ?',
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Schedule not found' });
        }

        res.json({ ...rows[0], ...await recordPatrol.scheduleExtras(rows[0].id) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch schedule' });
    }
});

app.post('/api/patrol-schedules', authenticate, requireRole(['Executive Officer']), validate(scheduleSchema), recordPatrol.validateScheduleContext, async (req, res) => {
    let conn;
    try {
        const { location, start_time, end_time, day_of_week, latitude, longitude, reason } = req.body;
        const effectiveLocation = location || req.body.route_stops?.[0]?.location || '';
        if (!effectiveLocation) return res.status(400).json({ error: 'Choose a patrol location or add at least one route stop.' });
        if (req.body.conflict_override && (!req.body.override_justification || req.body.override_justification.trim().length < 10)) {
            return res.status(400).json({ error: 'A conflict override justification of at least 10 characters is required.' });
        }
        const conflicts = await scheduleConflictsOrNull(req);
        if (conflicts.length) return res.status(409).json({ error: 'Team or personnel schedule conflict. Choose a separate time window.', conflicts });
        const occurrenceDates = scheduleOccurrences(req.body);

        conn = await pool.getConnection();
        await conn.beginTransaction();
        let seriesId = null;
        if ((req.body.recurrence_type || 'single') !== 'single') {
            const [series] = await conn.query(`INSERT INTO patrol_schedule_series
                (recurrence_type, recurrence_interval, recurrence_days, starts_on, ends_on, created_by)
                VALUES (?, ?, ?, ?, ?, ?)`, [req.body.recurrence_type, req.body.recurrence_interval || 1,
                JSON.stringify(req.body.recurrence_days || []), occurrenceDates[0], req.body.recurrence_end_date || null, req.userId]);
            seriesId = series.insertId;
        }
        const created = [];
        for (const occurrenceDate of occurrenceDates) {
            const [result] = await conn.query(`INSERT INTO patrol_schedules
                (location, start_time, end_time, day_of_week, latitude, longitude, reason, series_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [effectiveLocation, start_time, end_time, occurrenceDate ? scheduleDayName(occurrenceDate) : day_of_week, latitude ?? null, longitude ?? null, reason || null, seriesId]);
            await recordPatrol.saveScheduleExtras(conn, result.insertId, { ...req.body, scheduled_date: occurrenceDate, day_of_week: occurrenceDate ? scheduleDayName(occurrenceDate) : req.body.day_of_week }, req.userId);
            created.push(result.insertId);
        }
        await conn.commit();
        const [newSchedule] = await pool.query('SELECT * FROM patrol_schedules WHERE id IN (?) ORDER BY id', [created]);

        const userId = req.userId;

        if (userId) {
            await logAudit(
                userId,
                'CREATE_SCHEDULE',
                'patrol_schedules',
                created[0],
                null,
                { location: effectiveLocation, day_of_week, start_time, end_time },
                req
            );
        }
        if (conflicts.length) await logAudit(req.userId, 'OVERRIDE_PATROL_CONFLICT', 'patrol_schedules', created[0], null, { conflicts, justification: req.body.override_justification }, req);

        res.status(201).json({
            message: 'Patrol schedule created successfully',
            schedule: { ...newSchedule[0], ...await recordPatrol.scheduleExtras(created[0]) },
            occurrence_ids: created
        });
    } catch (error) {
        if (conn) await conn.rollback();
        res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create schedule' });
    } finally { if (conn) conn.release(); }
});

app.put('/api/patrol-schedules/:id', authenticate, requireRole(['Executive Officer']), validate(scheduleSchema), recordPatrol.validateScheduleContext, async (req, res) => {
    let conn;
    try {
        const { location, start_time, end_time, day_of_week, latitude, longitude, reason, status } = req.body;
        const id = req.params.id;
        const effectiveLocation = location || req.body.route_stops?.[0]?.location || '';
        if (!effectiveLocation) return res.status(400).json({ error: 'Choose a patrol location or add at least one route stop.' });

        if (req.body.conflict_override && (!req.body.override_justification || req.body.override_justification.trim().length < 10)) {
            return res.status(400).json({ error: 'A conflict override justification of at least 10 characters is required.' });
        }
        const conflicts = await scheduleConflictsOrNull(req, id);
         if (conflicts.length) return res.status(409).json({ error: 'Team or personnel schedule conflict. Choose a separate time window.', conflicts });

        const [oldData] = await pool.query('SELECT * FROM patrol_schedules WHERE id = ?', [id]);

        if (oldData.length === 0) {
            return res.status(404).json({ error: 'Schedule not found' });
        }

        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [sourceRecord] = await conn.query('SELECT * FROM patrol_schedule_records WHERE schedule_id = ?', [id]);
        const seriesEdit = ['future', 'series'].includes(req.body.edit_scope) && oldData[0].series_id;
        const sourceDate = String(sourceRecord[0]?.scheduled_date || req.body.scheduled_date || '').slice(0, 10);
        const [seriesRows] = seriesEdit
            ? await conn.query(`SELECT ps.id, pr.scheduled_date
                FROM patrol_schedules ps LEFT JOIN patrol_schedule_records pr ON pr.schedule_id = ps.id
                WHERE ps.series_id = ? AND ps.status <> 'Completed'
                  ${req.body.edit_scope === 'future' ? 'AND (pr.scheduled_date IS NULL OR pr.scheduled_date >= ?)' : ''}
                ORDER BY pr.scheduled_date, ps.id`, req.body.edit_scope === 'future' ? [oldData[0].series_id, sourceDate] : [oldData[0].series_id])
            : [[{ id, scheduled_date: sourceRecord[0]?.scheduled_date || req.body.scheduled_date }]];

        for (const occurrence of seriesRows) {
            await conn.query(`
                UPDATE patrol_schedules
                SET location = ?, start_time = ?, end_time = ?,
                    day_of_week = ?, latitude = ?, longitude = ?, reason = ?, status = ?
                WHERE id = ?
            `, [
                effectiveLocation, start_time, end_time,
                seriesEdit && occurrence.scheduled_date
                    ? scheduleDayName(String(occurrence.scheduled_date).slice(0, 10))
                    : day_of_week,
                latitude ?? null, longitude ?? null, reason || null, status || 'Active', occurrence.id
            ]);

            // Preserve each occurrence's date when editing an entire series.
            const occurrenceBody = seriesEdit
                ? { ...req.body, scheduled_date: occurrence.scheduled_date || req.body.scheduled_date }
                : req.body;
            await recordPatrol.saveScheduleExtras(conn, occurrence.id, occurrenceBody, req.userId);
        }
        await conn.commit();

        // Only the Active/Cancelled -> Completed transition counts - not
        // every re-save of a schedule that was already Completed.
        if (status === 'Completed' && oldData[0].status !== 'Completed') {
            await decayAreaRisk(effectiveLocation);
        }

        const [updatedSchedule] = await pool.query(
            'SELECT * FROM patrol_schedules WHERE id = ?',
            [id]
        );

        const userId = req.userId;

        if (userId) {
            await logAudit(
                userId,
                'UPDATE_SCHEDULE',
                'patrol_schedules',
                id,
                oldData[0] || null,
                req.body,
                req
            );
        }
        if (conflicts.length) await logAudit(req.userId, 'OVERRIDE_PATROL_CONFLICT', 'patrol_schedules', id, oldData[0], { conflicts, justification: req.body.override_justification }, req);

        res.json({
            message: 'Patrol schedule updated successfully',
            schedule: { ...updatedSchedule[0], ...await recordPatrol.scheduleExtras(id) }
        });
    } catch (error) {
        if (conn) await conn.rollback();
        res.status(500).json({ error: 'Failed to update schedule' });
    } finally { if (conn) conn.release(); }
});

app.delete('/api/patrol-schedules/:id', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.userId;
        
        const [oldData] = await pool.query('SELECT * FROM patrol_schedules WHERE id = ?', [id]);
        if (oldData.length === 0) {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        const [linkedLogs] = await pool.query('SELECT id FROM patrol_logs WHERE schedule_id = ?', [id]);
        const [scheduleRecord] = await pool.query('SELECT * FROM patrol_schedule_records WHERE schedule_id=?', [id]);
        const [scheduleTanods] = await pool.query('SELECT * FROM patrol_schedule_tanods WHERE schedule_id=?', [id]);

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            await archive.archiveRecord(conn, {
                entityType: 'patrol_schedule',
                entityId: Number(id),
                label: `Patrol schedule #${id}: ${oldData[0].location}, ${oldData[0].day_of_week} ${String(oldData[0].start_time).slice(0, 5)}-${String(oldData[0].end_time).slice(0, 5)}`,
                data: { row: oldData[0], log_ids: linkedLogs.map(l => l.id), record_link: scheduleRecord[0] || null, tanod_links: scheduleTanods },
                deletedBy: userId
            });
            // Detach (don't delete) historical patrol logs — deleting a schedule
            // shouldn't erase the real patrol reports that were filed against it.
            // The archive remembers them so a restore re-links them.
            await conn.query('UPDATE patrol_logs SET schedule_id = NULL WHERE schedule_id = ?', [id]);
            await conn.query('DELETE FROM patrol_schedules WHERE id = ?', [id]);
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
        
        if (userId) {
            await logAudit(
                userId,
                'DELETE_SCHEDULE',
                'patrol_schedules',
                id,
                oldData[0] || null,
                null,
                req
            );
        }
        
        res.json({ message: 'Patrol schedule moved to the Archive.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete schedule' });
    }
});

// ---------- PATROL LOGS ----------

app.get('/api/patrol-logs', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const {limit,offset,page} = pagination(req.query,25);
        const conditions = ['1=1'], params=[];
        for (const [name,field,operator] of [['date_from','pl.patrol_date','>='],['date_to','pl.patrol_date','<='],['status','pl.status','='],['location','ps.location','=']]) {
            if(req.query[name]){conditions.push(`${field} ${operator} ?`);params.push(req.query[name]);}
        }
        const search = validatedSearch(req.query.search);
        if (search) {
            conditions.push('(ps.location LIKE ? OR pl.report LIKE ? OR pl.status LIKE ?)');
            const term = `%${search}%`;
            params.push(term, term, term);
        }
        const where=conditions.join(' AND ');
        const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM patrol_logs pl LEFT JOIN patrol_schedules ps ON pl.schedule_id=ps.id WHERE ${where}`,params);
        const [rows] = await pool.query(`
            SELECT 
                pl.*,
                ps.location as schedule_location,
                ps.start_time as schedule_start,
                ps.end_time as schedule_end
            FROM patrol_logs pl
            LEFT JOIN patrol_schedules ps ON pl.schedule_id = ps.id
            WHERE ${where} ORDER BY pl.created_at DESC, pl.id DESC LIMIT ? OFFSET ?
        `,[...params,limit,offset]);
        res.set({'X-Total-Count':String(total),'X-Total-Pages':String(Math.ceil(total/limit)),'X-Current-Page':String(page)});
        res.json(rows);
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        res.status(500).json({ error: 'Failed to fetch patrol logs' });
    }
});

app.get('/api/patrol-logs/:id', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM patrol_logs WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Patrol log not found' });
        const [attendance] = await pool.query('SELECT person_type, person_id, attendance_status, notes FROM patrol_log_attendance WHERE log_id=?', [req.params.id]);
        res.json({ ...rows[0], attendance });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch patrol log' });
    }
});

app.get('/api/patrol-analytics', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 366);
        const windowSql = `INTERVAL ${days} DAY`;
        const [[summary]] = await pool.query(`SELECT COUNT(*) AS scheduled,
                SUM(status='Completed') AS completed, SUM(status='Cancelled') AS cancelled
            FROM patrol_schedules WHERE created_at >= DATE_SUB(CURDATE(), ${windowSql})`);
        const [[attendance]] = await pool.query(`SELECT COUNT(*) AS attendance_rows,
                SUM(attendance_status='Present') AS present, SUM(attendance_status='Absent') AS absent,
                SUM(attendance_status='Late') AS late, SUM(attendance_status='Excused') AS excused
            FROM patrol_log_attendance a JOIN patrol_logs l ON l.id=a.log_id
            WHERE l.patrol_date >= DATE_SUB(CURDATE(), ${windowSql})`);
        const [workload] = await pool.query(`SELECT COALESCE(NULLIF(pr.team_name,''),'Unassigned') AS team_name,
                COUNT(*) AS assigned_schedules, SUM(ps.status='Completed') AS completed_schedules
            FROM patrol_schedules ps LEFT JOIN patrol_schedule_records pr ON pr.schedule_id=ps.id
            WHERE ps.created_at >= DATE_SUB(CURDATE(), ${windowSql})
            GROUP BY COALESCE(NULLIF(pr.team_name,''),'Unassigned') ORDER BY assigned_schedules DESC`);
        const [coverage] = await pool.query(`SELECT pr.scheduled_date, COUNT(DISTINCT ps.id) AS schedule_count,
                COUNT(DISTINCT CASE WHEN ps.status='Completed' THEN ps.id END) AS completed_count
            FROM patrol_schedule_records pr JOIN patrol_schedules ps ON ps.id=pr.schedule_id
            WHERE pr.scheduled_date >= DATE_SUB(CURDATE(), ${windowSql})
            GROUP BY pr.scheduled_date ORDER BY pr.scheduled_date`);
        res.json({ window_days: days, summary: { scheduled: Number(summary.scheduled || 0), completed: Number(summary.completed || 0), cancelled: Number(summary.cancelled || 0), completion_rate: summary.scheduled ? Number(summary.completed || 0) / Number(summary.scheduled) : 0 }, attendance: Object.fromEntries(Object.entries(attendance).map(([key, value]) => [key, Number(value || 0)])), workload, coverage });
    } catch { res.status(500).json({ error: 'Failed to load patrol analytics' }); }
});

async function persistPatrolAttendance(db, logId, scheduleId, attendance) {
    const [assigned] = await db.query(`
        SELECT person_type, person_id FROM patrol_schedule_personnel WHERE schedule_id=?
        UNION
        SELECT 'Tanod' AS person_type, tanod_id AS person_id FROM patrol_schedule_tanods WHERE schedule_id=?
    `, [scheduleId, scheduleId]);
    const allowed = new Set(assigned.map(person => `${person.person_type}:${person.person_id}`));
    const normalized = [];
    const seen = new Set();
    for (const person of attendance) {
        const key = `${person.person_type}:${person.person_id}`;
        if (allowed.has(key) && !seen.has(key)) {
            seen.add(key);
            normalized.push(person);
        }
    }
    for (const person of assigned) {
        const key = `${person.person_type}:${person.person_id}`;
        if (!seen.has(key)) normalized.push({ ...person, attendance_status: 'Absent', notes: '' });
    }
    for (const person of normalized) await db.query(`INSERT INTO patrol_log_attendance
        (log_id, person_type, person_id, attendance_status, notes) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE attendance_status=VALUES(attendance_status), notes=VALUES(notes)`, [logId, person.person_type, person.person_id, person.attendance_status, person.notes || '']);
    return normalized;
}

async function insertCompletionAudit(db, userId, action, entityId, oldData, newData, req) {
    if (!userId) return;
    await db.query(`INSERT INTO audit_logs
        (user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent)
        VALUES (?, ?, 'patrol_log', ?, ?, ?, ?, ?)`, [
        userId, action, entityId,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        req.ip || req.connection?.remoteAddress || 'unknown',
        req.headers?.['user-agent'] || ''
    ]);
}

app.post('/api/patrol-logs', authenticate, requireRole(['Executive Officer']), validate(logSchema), async (req, res) => {
    let conn;
    try {
        const { schedule_id, report, status, patrol_date, attendance = [] } = req.body;
        const [existing] = await pool.query('SELECT id FROM patrol_logs WHERE schedule_id=? ORDER BY id DESC LIMIT 1', [schedule_id]);
        if (existing.length) return res.status(409).json({ error: 'This patrol occurrence already has a completion log.', log_id: existing[0].id });
        const [schedule] = await pool.query('SELECT * FROM patrol_schedules WHERE id=?', [schedule_id]);
        if (!schedule.length) return res.status(404).json({ error: 'Patrol schedule not found' });

        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [result] = await conn.query(`
            INSERT INTO patrol_logs 
            (schedule_id, report, status, patrol_date) 
            VALUES (?, ?, ?, ?)
        `, [
            schedule_id, report || null, 
            status || 'Completed', patrol_date || null
        ]);
        
        const normalizedAttendance = await persistPatrolAttendance(conn, result.insertId, schedule_id, attendance);
        if (status === 'Completed') await conn.query("UPDATE patrol_schedules SET status='Completed' WHERE id=? AND status <> 'Cancelled'", [schedule_id]);
        await insertCompletionAudit(conn, req.userId, 'CREATE_LOG', result.insertId, null, {
            schedule_id, status, attendance_count: normalizedAttendance.length
        }, req);
        await conn.commit();

        const [newLog] = await pool.query(
            'SELECT * FROM patrol_logs WHERE id = ?',
            [result.insertId]
        );
        res.status(201).json({ 
            message: 'Patrol log saved successfully', 
            log: { ...newLog[0], attendance: normalizedAttendance }
        });
    } catch (error) {
        if (conn) await conn.rollback().catch(() => {});
        res.status(500).json({ error: 'Failed to save patrol log' });
    } finally { if (conn) conn.release(); }
});

app.put('/api/patrol-logs/:id', authenticate, requireRole(['Executive Officer']), validate(logSchema), async (req, res) => {
    let conn;
    try {
        const { schedule_id, report, status, patrol_date, attendance = [] } = req.body;
        const id = req.params.id;

        const [oldData] = await pool.query('SELECT * FROM patrol_logs WHERE id = ?', [id]);
        if (!oldData.length) return res.status(404).json({ error: 'Patrol log not found' });
        const [schedule] = await pool.query('SELECT id FROM patrol_schedules WHERE id=?', [schedule_id]);
        if (!schedule.length) return res.status(404).json({ error: 'Patrol schedule not found' });

        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [result] = await conn.query(`
            UPDATE patrol_logs
            SET schedule_id = ?, report = ?, status = ?, patrol_date = ?
            WHERE id = ?
        `, [schedule_id, report || null, status || 'Completed', patrol_date, id]);
        
        if (result.affectedRows === 0) { await conn.rollback(); return res.status(404).json({ error: 'Patrol log not found' }); }
        await conn.query('DELETE FROM patrol_log_attendance WHERE log_id=?', [id]);
        const normalizedAttendance = await persistPatrolAttendance(conn, id, schedule_id, attendance);
        if (status === 'Completed') await conn.query("UPDATE patrol_schedules SET status='Completed' WHERE id=? AND status <> 'Cancelled'", [schedule_id]);
        await insertCompletionAudit(conn, req.userId, 'UPDATE_LOG', id, oldData[0], req.body, req);
        await conn.commit();
        
        const [updatedLog] = await pool.query(
            'SELECT * FROM patrol_logs WHERE id = ?',
            [id]
        );
        
        res.json({ 
            message: 'Patrol log updated successfully', 
            log: { ...updatedLog[0], attendance: normalizedAttendance }
        });
    } catch (error) {
        if (conn) await conn.rollback().catch(() => {});
        res.status(500).json({ error: 'Failed to update patrol log' });
    } finally { if (conn) conn.release(); }
});

app.delete('/api/patrol-logs/:id', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.userId;
        
        const [oldData] = await pool.query('SELECT * FROM patrol_logs WHERE id = ?', [id]);
        if (oldData.length === 0) {
            return res.status(404).json({ error: 'Patrol log not found' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            await archive.archiveRecord(conn, {
                entityType: 'patrol_log',
                entityId: Number(id),
                label: `Patrol log #${id}: ${oldData[0].status} on ${oldData[0].patrol_date ? String(oldData[0].patrol_date).slice(0, 10) : 'unknown date'}`,
                data: { row: oldData[0] },
                deletedBy: userId
            });
            await conn.query('DELETE FROM patrol_logs WHERE id = ?', [id]);
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
        
        if (userId) {
            await logAudit(
                userId,
                'DELETE_LOG',
                'patrol_logs',
                id,
                oldData[0] || null,
                null,
                req
            );
        }
        
        res.json({ message: 'Patrol log moved to the Archive.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete patrol log' });
    }
});

// ============================================================
// CART WEIGHTS API ROUTES
// ============================================================

app.get('/api/cart/weights', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key IN ('cart_weight_time','cart_weight_day','cart_weight_type','cart_weight_location','cart_weight_frequency')`
        );
        const defaults = { time: 25, day: 15, type: 30, location: 20, frequency: 10 };
        rows.forEach(r => {
            const key = r.setting_key.replace('cart_weight_', '');
            defaults[key] = parseInt(r.setting_value, 10);
        });
        res.json(defaults);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch CART weights' });
    }
});

const cartWeightsSchema = Joi.object({
    time:      Joi.number().integer().min(1).max(98).required(),
    day:       Joi.number().integer().min(1).max(98).required(),
    type:      Joi.number().integer().min(1).max(98).required(),
    location:  Joi.number().integer().min(1).max(98).required(),
    frequency: Joi.number().integer().min(1).max(98).required()
});

const cartPredictSchema = Joi.object({
    incident_type: Joi.string().max(150).required(),
    severity: Joi.string().valid('Low','Medium','High').default('Low'),
    form_type: Joi.string().valid('crime','blotter').default('blotter'),
    time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    day: Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday').required(),
    location: Joi.string().valid(...BARANGAY_LOCATIONS).allow('', null),
    repeated: Joi.number().integer().min(0).max(100000).empty('').allow(null),
    history: Joi.string().valid('High', 'Moderate', 'Low').allow('', null),
    frequency: Joi.string().valid('High', 'Moderate', 'Low').allow('', null)
});

app.put('/api/cart/weights', authenticate, requireRole(['Executive Officer']), validate(cartWeightsSchema), async (req, res) => {
    try {
        const { time, day, type, location, frequency } = req.body;
        const total = time + day + type + location + frequency;
        if (total !== 100) {
            return res.status(400).json({ error: `Weights must sum to 100%. Current total: ${total}%` });
        }

        const userId = req.userId;
        const entries = { time, day, type, location, frequency };

        for (const [key, val] of Object.entries(entries)) {
            const settingKey = `cart_weight_${key}`;
            const [existing] = await pool.query('SELECT id FROM system_settings WHERE setting_key = ?', [settingKey]);
            if (existing.length > 0) {
                await pool.query('UPDATE system_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?',
                    [String(val), userId, settingKey]);
            } else {
                await pool.query('INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)',
                    [settingKey, String(val), userId]);
            }
        }

        await logAudit(userId, 'UPDATE_CART_WEIGHTS', 'system_settings', null, null, entries, req);
        await applyConfiguredWeights();

        res.json({ message: 'CART weights updated successfully.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update CART weights' });
    }
});

app.get('/api/cart/source-weights', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key IN ('cart_source_weight_blotter','cart_source_weight_incident')`
        );
        const defaults = { blotter: 0.85, incident: 1.0 };
        rows.forEach(r => {
            const key = r.setting_key.replace('cart_source_weight_', '');
            defaults[key] = parseFloat(r.setting_value);
        });
        res.json(defaults);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch source weights' });
    }
});

app.put('/api/cart/source-weights', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const { blotter, incident } = req.body;
        if (typeof blotter !== 'number' || typeof incident !== 'number' ||
            blotter < 0 || blotter > 2 || incident < 0 || incident > 2) {
            return res.status(400).json({ error: 'Source weights must be numbers between 0 and 2' });
        }

        const userId = req.userId;
        for (const [key, val] of Object.entries({ blotter, incident })) {
            const settingKey = `cart_source_weight_${key}`;
            const [existing] = await pool.query('SELECT id FROM system_settings WHERE setting_key = ?', [settingKey]);
            if (existing.length > 0) {
                await pool.query('UPDATE system_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?',
                    [String(val), userId, settingKey]);
            } else {
                await pool.query('INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)',
                    [settingKey, String(val), userId]);
            }
        }

        await logAudit(userId, 'UPDATE_CART_SOURCE_WEIGHTS', 'system_settings', null, null, { blotter, incident }, req);
        await applyConfiguredSourceWeights();
        res.json({ message: 'Source weights updated successfully.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update source weights' });
    }
});

// ============================================================
// CART ANALYTICS API ROUTES
// ============================================================

app.get('/api/cart/risk-factors', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                i.id,
                rf.incident_id,
                i.incident_type,
                i.date,
                i.time,
                i.street_name,
                i.status,
                rf.time_risk_score,
                rf.day_risk_score,
                rf.type_risk_score,
                rf.location_risk_score,
                rf.frequency_risk_score,
                rf.total_risk_score,
                rf.danger_level,
                rf.calculated_at
            FROM incidents i
            JOIN cart_risk_factors rf ON i.id = rf.incident_id
            ORDER BY rf.total_risk_score DESC
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch risk factors' });
    }
});

app.get('/api/cart/summary', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const [summary] = await pool.query(`
            SELECT 
                COUNT(*) as total_incidents,
                SUM(CASE WHEN danger_level LIKE 'Level 3%' THEN 1 ELSE 0 END) as high_risk,
                SUM(CASE WHEN danger_level LIKE 'Level 2%' THEN 1 ELSE 0 END) as moderate_risk,
                SUM(CASE WHEN danger_level LIKE 'Level 1%' THEN 1 ELSE 0 END) as low_risk,
                ROUND(AVG(total_risk_score), 2) as avg_risk_score,
                MAX(total_risk_score) as max_risk_score,
                MIN(total_risk_score) as min_risk_score
            FROM cart_risk_factors
        `);
        res.json(summary[0]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch CART summary' });
    }
});

app.get('/api/cart/decision-rules', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM cart_decision_rules 
            WHERE is_active = TRUE 
            ORDER BY priority ASC
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch decision rules' });
    }
});

app.get('/api/cart/analysis-logs', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT l.*, u.name AS triggered_by_name
            FROM cart_analysis_log l
            LEFT JOIN users u ON u.id = l.triggered_by
            ORDER BY l.run_timestamp DESC
            LIMIT 10
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch analysis logs' });
    }
});

// ============================================================
// 🆕 CART PREDICT - Stateless what-if prediction for the
// CART Analytics prototype form. Runs the real cartEngine (the
// same engine used for persisted incidents) against the submitted
// field values plus real location/frequency stats for the chosen
// street - but never writes to incidents or cart_risk_factors.
// ============================================================
app.post('/api/cart/predict', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), validate(cartPredictSchema), async (req, res) => {
    const startTime = Date.now();
    try {
        const { incident_type, time, day, location, repeated, history, frequency, severity, form_type } = req.body;

        if (!incident_type || !time || !day) {
            return res.status(400).json({ error: 'incident_type, time, and day are required' });
        }

        const timeOfDay = computeTimeOfDay(time);
        const isWeekend = ['Saturday', 'Sunday'].includes(day);

        let streetCount = 0;
        let recentCount = 0;
        if (location) {
            const [locationRows] = await pool.query(
                'SELECT COUNT(*) as street_count FROM incidents WHERE street_name = ? AND is_draft = 0',
                [location]
            );
            streetCount = locationRows[0]?.street_count || 0;

            const [frequencyRows] = await pool.query(
                `SELECT COUNT(*) as recent_count FROM incidents
                 WHERE street_name = ? AND is_draft = 0 AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND date <= CURDATE()`,
                [location]
            );
            recentCount = frequencyRows[0]?.recent_count || 0;
        }

        // The prototype form's "Repeated Incidents" / "Previous Risk
        // History" / "Incident Frequency" inputs don't map onto their own
        // axes in the real 5-factor model (time/day/type/location/
        // frequency) - blend them into the location/frequency counts so
        // every field on the form still meaningfully affects the result,
        // computed through the same scoring functions as real incidents.
        const BUCKET_COUNT = { High: 5, Moderate: 2, Low: 1 };
        const effectiveLocationCount = Math.max(streetCount, BUCKET_COUNT[history] || 0);
        const effectiveRecentCount = Math.max(recentCount, parseInt(repeated) || 0, BUCKET_COUNT[frequency] || 0);

        await applyConfiguredThresholds();
        await applyConfiguredWeights();
        await applyConfiguredSourceWeights();
        const result = cartEngine.analyze(
            { incident_type, time_of_day: timeOfDay, is_weekend: isWeekend, street_name: location || null, severity, form_type },
            { street_count: effectiveLocationCount },
            { recent_count: effectiveRecentCount }
        );

        // Logged as its own analysis_type ('simulation') so the Recent CART
        // Analysis Runs tab can show what-if runs alongside real full-system
        // ones - this never touched incidents/cart_risk_factors (see the
        // comment above this route), so "incidents analyzed" doesn't apply;
        // the one risk-level count that's set just reflects this run's own
        // predicted level. A logging failure must not fail the prediction
        // itself, which the user is actively waiting on.
        try {
            await pool.query(`
                INSERT INTO cart_analysis_log (
                    analysis_type, date_range_start, date_range_end, incident_types_analyzed,
                    total_streets_analyzed, total_incidents_analyzed, high_risk_count,
                    moderate_risk_count, low_risk_count, execution_time_ms, status, triggered_by, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                'simulation', null, null, incident_type,
                location ? 1 : 0, null,
                result.dangerLevel === 'Level 3' ? 1 : 0,
                result.dangerLevel === 'Level 2' ? 1 : 0,
                result.dangerLevel === 'Level 1' ? 1 : 0,
                Date.now() - startTime, 'completed', req.userId,
                `Simulation: ${incident_type} on ${day} at ${time}${location ? ` near ${location}` : ''}`
            ]);
        } catch (logError) {
        }

        res.json({
            success: true,
            ...result,
            locationCount: effectiveLocationCount,
            frequencyCount: effectiveRecentCount
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to run CART prediction' });
    }
});

app.post('/api/cart/analyze', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const startTime = Date.now();
        const triggered_by = req.userId;

        // recomputeAllCartRiskFactors writes the (single) analysis log row
        // itself, with the real per-level counts.
        const logId = await recomputeAllCartRiskFactors({ triggeredBy: triggered_by || null });

        const executionTime = Date.now() - startTime;
        const logResult = { insertId: logId };

        if (triggered_by) {
            await logAudit(
                triggered_by,
                'RUN_CART_ANALYSIS',
                'cart_analysis_log',
                logResult.insertId,
                null,
                { execution_time_ms: executionTime },
                req
            );
        }

        res.json({ 
            success: true, 
            message: 'CART analysis completed',
            execution_time_ms: executionTime,
            log_id: logResult.insertId
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to run CART analysis' });
    }
});

// ============================================================
// REPORTS - PRINT/EXPORT AUDIT LOGGING
// ============================================================

app.post('/api/reports/log-export', authenticate, validate(reportExportSchema), async (req, res) => {
    try {
        const { action, month, filters, recordCount } = req.body;
        await logAudit(req.userId, action, 'reports', null, null, { month, filters, recordCount }, req);
        res.json({ message: 'Logged.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to log report export' });
    }
});

// ============================================================
// AUDIT LOGS - GET
// ============================================================

app.get('/api/audit-logs', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const { action, entity_type, user_id } = req.query;
        const { page, limit, offset } = pagination(req.query, 10);
        const search = validatedSearch(req.query.search);

        const conditions = ['1=1'];
        const params = [];
        if (action) { conditions.push('al.action = ?'); params.push(action); }
        if (entity_type) { conditions.push('al.entity_type = ?'); params.push(entity_type); }
        if (user_id) { conditions.push('u.id = ?'); params.push(user_id); }
        if (search) {
            conditions.push('(u.name LIKE ? OR u.username LIKE ? OR al.action LIKE ? OR al.entity_type LIKE ?)');
            const term = `%${search}%`;
            params.push(term, term, term, term);
        }
        const where = conditions.join(' AND ');
        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id WHERE ${where}`, params);

        const query = `
            SELECT
                al.id, al.action, al.entity_type, al.entity_id,
                al.ip_address, al.created_at, al.old_data, al.new_data,
                u.name as user_name, u.username, 'staff' as actor_type
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE ${where}
            ORDER BY al.created_at DESC LIMIT ? OFFSET ?
        `;
        const [rows] = await pool.query(query, [...params, limit, offset]);
        res.set({'X-Total-Count':String(total),'X-Total-Pages':String(Math.ceil(total/limit)),'X-Current-Page':String(page)});
        res.json(rows);

    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// ============================================================
// SYSTEM SETTINGS
// ============================================================

app.get('/api/settings', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM system_settings ORDER BY setting_key');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

app.get('/api/settings/:key', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM system_settings WHERE setting_key = ?',
            [req.params.key]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Setting not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch setting' });
    }
});

const SETTINGS_DEFAULTS = {
    session_timeout_minutes: '30',
    max_login_attempts: '5',
    audit_log_retention_days: '90',
    enable_audit_logging: 'true',
    require_strong_password: 'true',
    enable_2fa: 'false',
    maintenance_mode: 'false',
    cart_model_version: 'v1.0',
    default_danger_threshold_high: '67',
    default_danger_threshold_moderate: '34',
    cart_weight_time: '25',
    cart_weight_day: '15',
    cart_weight_type: '30',
    cart_weight_location: '20',
    cart_weight_frequency: '10'
};

app.post('/api/settings', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const { setting_key, setting_value } = req.body;
        const userId = req.userId;

        if (!setting_key || setting_value === undefined || setting_value === null) {
            return res.status(400).json({ error: 'setting_key and setting_value are required' });
        }

        if (!Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, setting_key)) {
            return res.status(400).json({ error: `Unknown setting key: ${setting_key}` });
        }

        let valueToStore = String(setting_value).trim();

        if (valueToStore === '' || valueToStore === 'NaN' || valueToStore === 'undefined' || valueToStore === 'null') {
            valueToStore = SETTINGS_DEFAULTS[setting_key] || '';
        }

        const [existing] = await pool.query(
            'SELECT id FROM system_settings WHERE setting_key = ?',
            [setting_key]
        );

        let entityId;
        if (existing.length > 0) {
            entityId = existing[0].id;
            await pool.query(
                'UPDATE system_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?',
                [valueToStore, userId || null, setting_key]
            );
        } else {
            const [insertResult] = await pool.query(`
                INSERT INTO system_settings (setting_key, setting_value, updated_by)
                VALUES (?, ?, ?)
            `, [setting_key, valueToStore, userId || null]);
            entityId = insertResult.insertId;
        }

        if (userId) {
            await logAudit(
                userId,
                'UPDATE_SETTINGS',
                'system_settings',
                entityId,
                null,
                { setting_key, setting_value: valueToStore },
                req
            );
        }

        res.json({ message: 'Setting saved successfully' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to save setting' });
    }
});

app.put('/api/settings/:key', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    try {
        const { setting_value } = req.body;
        const { key } = req.params;
        const userId = req.userId;

        if (setting_value === undefined || setting_value === null) {
            return res.status(400).json({ error: 'setting_value is required' });
        }

        if (!Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, key)) {
            return res.status(400).json({ error: `Unknown setting key: ${key}` });
        }

        let valueToStore = String(setting_value).trim();

        if (valueToStore === '' || valueToStore === 'NaN' || valueToStore === 'undefined' || valueToStore === 'null') {
            valueToStore = SETTINGS_DEFAULTS[key] || '';
        }

        const [oldData] = await pool.query(
            'SELECT * FROM system_settings WHERE setting_key = ?',
            [key]
        );

        if (oldData.length === 0) {
            return res.status(404).json({ error: 'Setting not found' });
        }

        await pool.query(`
            UPDATE system_settings
            SET setting_value = ?, updated_by = ?
            WHERE setting_key = ?
        `, [valueToStore, userId || null, key]);

        if (userId) {
            await logAudit(
                userId,
                'UPDATE_SETTINGS',
                'system_settings',
                oldData[0].id,
                oldData[0] || null,
                { setting_key: key, setting_value: valueToStore },
                req
            );
        }

        res.json({ message: 'Setting updated successfully' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to update setting' });
    }
});

// ============================================================
// LOCATION COORDINATES
// One-time fixed pin per canonical location - lets an incident reported
// anywhere in the barangay always
// have coordinates for the Risk Map heatmap, not just locations that
// happen to already have an active patrol schedule pinned.
// ============================================================

const locationCoordinateSchema = Joi.object({
    location: Joi.string().valid(...BARANGAY_LOCATIONS).required(),
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required()
});

app.get('/api/location-coordinates', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT location, latitude, longitude FROM location_coordinates');
        const byLocation = new Map(rows.map(r => [r.location, r]));

        const result = BARANGAY_LOCATIONS.map(location => ({
            location,
            latitude: byLocation.get(location)?.latitude ?? null,
            longitude: byLocation.get(location)?.longitude ?? null
        }));

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch location coordinates' });
    }
});

app.post('/api/location-coordinates', authenticate, requireRole(['Executive Officer']), validate(locationCoordinateSchema), async (req, res) => {
    try {
        const { location, latitude, longitude } = req.body;
        const userId = req.userId;

        await pool.query(`
            INSERT INTO location_coordinates (location, latitude, longitude, set_by)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE latitude = VALUES(latitude), longitude = VALUES(longitude), set_by = VALUES(set_by)
        `, [location, latitude, longitude, userId || null]);

        // Backfills existing incidents at this location that had no pin
        // at report time (e.g. reported before this location was pinned,
        // or before any schedule had a pin here) - without this, pinning
        // a location only helps *future* reports there, and anything
        // already reported today would stay permanently absent from the
        // heatmap even after the admin pins the street.
        // `incidents` is a view; backfill the underlying base tables instead.
        const [bBlt] = await pool.query(
            `UPDATE blotter_records SET latitude = ?, longitude = ?
             WHERE street_name = ? AND latitude IS NULL AND longitude IS NULL`,
            [latitude, longitude, location]
        );
        const [bInc] = await pool.query(
            `UPDATE incident_records SET latitude = ?, longitude = ?
             WHERE street_name = ? AND latitude IS NULL AND longitude IS NULL`,
            [latitude, longitude, location]
        );
        const backfillResult = { affectedRows: (bBlt.affectedRows || 0) + (bInc.affectedRows || 0) };
        if (backfillResult.affectedRows > 0) {
            heatmapCache.del('incidents'); heatmapCache.del('street-analysis');
        }

        if (userId) {
            await logAudit(userId, 'SET_LOCATION_COORDINATES', 'location_coordinates', null, null,
                { location, latitude, longitude, backfilled_incidents: backfillResult.affectedRows }, req);
        }

        res.json({
            message: 'Location coordinates saved.',
            location, latitude, longitude,
            backfilled_incidents: backfillResult.affectedRows
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save location coordinates' });
    }
});

// ============================================================
// ROOT ENDPOINT
// ============================================================

app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// ============================================================
// START SERVER
// ============================================================

app.get('/api/system/status', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), (req, res) => {
    res.json({ uptimeSeconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000) });
});

// ============================================================
// 404 + GLOBAL ERROR HANDLER
// Must be registered after every route. Without these, a request to
// an unknown path falls through to Express's default 404 HTML page,
// and an uncaught error (e.g. a malformed JSON body, which
// express.json() rejects before any route handler even runs) falls
// through to Express's default error page - both render a full stack
// trace to the client, which is an information leak.
// ============================================================

// Settings > Archive (see archive.js)
registerArchiveRoutes(app, { pool, archive, authenticate, requireRole, logAudit, computeCartRiskFactors, heatmapCache });

// ── Setup Wizard API ────────────────────────────────────────────────
// These routes let the in-app wizard test DB connections and save
// config without touching a terminal. Mounted before the 404 catch-all
// so they work even when the rest of the app hasn't loaded yet.
const setupRouter = require('./routes/setup');
app.use('/api/setup', setupRouter);

// ============================================================
// 🩺 SYSTEM HEALTH CHECK
// ============================================================
app.get('/api/health', authenticate, requireRole(['Executive Officer', 'Kagawad', 'Team Leader']), async (req, res) => {
    try {
        await pool.query('SELECT 1');
        const [[{ staff_sessions }]] = await pool.query(
            'SELECT COUNT(*) as staff_sessions FROM user_sessions WHERE is_active = 1'
        );
        res.json({
            status: 'ok',
            db: 'connected',
            uptime_seconds: Math.floor(process.uptime()),
            active_staff_sessions: staff_sessions,
            cart_engine: cartEngine ? 'loaded' : 'error',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'error',
            db: 'disconnected',
            uptime_seconds: Math.floor(process.uptime()),
            cart_engine: cartEngine ? 'loaded' : 'error',
            error: 'Database unreachable',
            timestamp: new Date().toISOString()
        });
    }
});

// ============================================================
// DATABASE BACKUP & RESTORE (Settings page)
// ============================================================
const archiver = require('archiver');

const BACKUP_DIR = path.join(__dirname, '..', 'database', 'backups');

function findMysqlBin(name) {
    const { execSync } = require('child_process');
    const candidates = [name, `C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\${name}.exe`];
    for (const c of candidates) {
        try { execSync(`"${c}" --version`, { stdio: 'ignore' }); return c; } catch {}
    }
    return null;
}

app.get('/api/backup/list', authenticate, requireRole(['Executive Officer']), (req, res) => {
    try {
        const fs = require('fs');
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.zip') || f.endsWith('.sql') || f.endsWith('.sql.enc'))
            .map(f => {
                const stat = fs.statSync(path.join(BACKUP_DIR, f));
                return { name: f, size: stat.size, created: stat.mtime.toISOString() };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created));
        res.json({ backups: files, backupDir: BACKUP_DIR });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list backups' });
    }
});

app.post('/api/backup/create', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const mysqldump = findMysqlBin('mysqldump');
    if (!mysqldump) return res.status(500).json({ error: 'mysqldump not found. Ensure MySQL Server 8.0 is installed.' });

    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || '3306';
    const dbUser = process.env.DB_USER || 'root';
    const dbPass = process.env.DB_PASSWORD || '';
    const dbName = process.env.DB_NAME || 'brgydata';
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const sqlFile = path.join(BACKUP_DIR, `${dbName}-${ts}.sql`);
    const zipFile = path.join(BACKUP_DIR, `${dbName}-${ts}.zip`);

    try {
        const env = { ...process.env, MYSQL_PWD: dbPass };
        execSync(
            `"${mysqldump}" --single-transaction --routines --triggers -h ${dbHost} -P ${dbPort} -u ${dbUser} ${dbName} > "${sqlFile}"`,
            { shell: true, env, stdio: 'pipe' }
        );

        await new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipFile);
            const archive = archiver('zip', { zlib: { level: 9 } });
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            archive.file(sqlFile, { name: `${dbName}-${ts}.sql` });
            archive.finalize();
        });

        fs.unlinkSync(sqlFile);

        const stat = fs.statSync(zipFile);
        await logAudit(req.userId, 'BACKUP_DATABASE', `Created backup: ${dbName}-${ts}.zip (${(stat.size/1024).toFixed(1)} KB)`);

        res.json({
            message: 'Backup created successfully',
            file: `${dbName}-${ts}.zip`,
            size: stat.size,
            path: zipFile
        });
    } catch (err) {
        fs.rmSync(sqlFile, { force: true });
        fs.rmSync(zipFile, { force: true });
        res.status(500).json({ error: 'Backup failed: ' + err.message });
    }
});

app.get('/api/backup/download/:filename', (req, res, next) => {
    if (req.query.token) req.headers.authorization = 'Bearer ' + req.query.token;
    next();
}, authenticate, requireRole(['Executive Officer']), (req, res) => {
    const fs = require('fs');
    const filename = path.basename(req.params.filename);
    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup file not found' });
    res.download(filePath, filename);
});

app.post('/api/backup/restore/:filename', authenticate, requireRole(['Executive Officer']), async (req, res) => {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const AdmZip = (() => { try { return require('adm-zip'); } catch { return null; } })();

    const filename = path.basename(req.params.filename);
    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup file not found' });

    const mysqlBin = findMysqlBin('mysql');
    if (!mysqlBin) return res.status(500).json({ error: 'mysql client not found. Ensure MySQL Server 8.0 is installed.' });

    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || '3306';
    const dbUser = process.env.DB_USER || 'root';
    const dbPass = process.env.DB_PASSWORD || '';
    const dbName = process.env.DB_NAME || 'brgydata';
    let sqlPath = filePath;
    let tempFile = null;

    try {
        if (filename.endsWith('.zip')) {
            const extract = require('extract-zip');
            const tempDir = path.join(BACKUP_DIR, '_restore-temp-' + Date.now());
            fs.mkdirSync(tempDir, { recursive: true });
            await extract(filePath, { dir: tempDir });
            const sqlFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.sql'));
            if (sqlFiles.length === 0) { fs.rmSync(tempDir, { recursive: true, force: true }); return res.status(400).json({ error: 'No .sql file found inside zip' }); }
            sqlPath = path.join(tempDir, sqlFiles[0]);
            tempFile = tempDir;
        }

        const env = { ...process.env, MYSQL_PWD: dbPass };
        execSync(
            `"${mysqlBin}" -h ${dbHost} -P ${dbPort} -u ${dbUser} ${dbName} < "${sqlPath}"`,
            { shell: true, env, stdio: 'pipe' }
        );

        await logAudit(req.userId, 'RESTORE_DATABASE', `Restored from: ${filename}`);
        res.json({ message: 'Database restored successfully from ' + filename });
    } catch (err) {
        res.status(500).json({ error: 'Restore failed: ' + err.message });
    } finally {
        if (tempFile) fs.rmSync(tempFile, { recursive: true, force: true });
    }
});

app.delete('/api/backup/:filename', authenticate, requireRole(['Executive Officer']), (req, res) => {
    const fs = require('fs');
    const filename = path.basename(req.params.filename);
    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup file not found' });
    fs.unlinkSync(filePath);
    res.json({ message: 'Backup deleted: ' + filename });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
    res.status(err.status || err.statusCode || 500).json({ error: 'Server error' });
});

async function ensureSchema() {
    const conn = await pool.getConnection();
    try {
        const { migrateRecordPatrol } = require('./migrations/record-patrol');
        await migrateRecordPatrol(conn);

        const safeTables = [
            [`area_risk_decay`, `CREATE TABLE IF NOT EXISTS area_risk_decay (
                location VARCHAR(100) PRIMARY KEY,
                decay_amount DECIMAL(5,2) NOT NULL DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`],
            [`archived_records`, `CREATE TABLE IF NOT EXISTS archived_records (
                id INT AUTO_INCREMENT PRIMARY KEY,
                record_type VARCHAR(50) NOT NULL,
                original_id INT NOT NULL,
                data JSON NOT NULL,
                archived_by INT DEFAULT NULL,
                archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reason VARCHAR(500) DEFAULT NULL,
                INDEX idx_record_type (record_type),
                INDEX idx_original_id (original_id)
            )`],
        ];
        for (const [name, ddl] of safeTables) {
            try { await conn.query(ddl); } catch (_) {}
        }
        console.log('✅ Schema check passed — all required tables present.');
    } catch (err) {
        console.warn('⚠️  Auto-migration warning:', err.message);
    } finally {
        conn.release();
    }
}

async function startServer() {
    // Try to connect to the DB and run migrations, but don't crash if it
    // fails — the setup wizard needs the Express server running so it can
    // serve setup.html and the /api/setup/* endpoints.
    try {
        await testConnection();
        await ensureSchema();
        // Auto-detect existing installation and lock setup wizard
        if (!isSetupCompleted()) {
            try {
                const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE is_active = 1');
                if (rows[0].cnt > 0) {
                    markSetupCompleted();
                    generateRecoveryToken();
                    console.log('[SETUP] Existing installation detected — setup wizard locked.');
                }
            } catch (_) { /* users table may not exist yet */ }
        }
        // T-8: Warn if MySQL accepts remote connections
        try {
            const [bindRows] = await pool.query("SHOW VARIABLES LIKE 'bind_address'");
            const bindAddr = bindRows[0]?.Value;
            if (bindAddr && bindAddr !== '127.0.0.1' && bindAddr !== '::1' && bindAddr !== 'localhost') {
                console.warn(`⚠️  [SECURITY] MySQL bind-address is "${bindAddr}" — remote connections possible. Set bind-address=127.0.0.1 in my.ini for production.`);
            }
        } catch (_) { /* non-critical check */ }
    } catch (dbErr) {
        console.warn('⚠️  Database not reachable at startup — the setup wizard will handle it.');
    }

    return new Promise((resolve, reject) => {
        const server = app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
            resolve(server);
        });
        server.on('error', reject);
    });
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    });
}

module.exports = { app, startServer, pool, sseTickets };
