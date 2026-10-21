/**
 * Stratified test-data generator for the Option A schema (blotter_records /
 * incident_records / record_registry).
 *
 *   node generate-records.js                 -> seed catalog + 224 records (default)
 *   node generate-records.js --records-only  -> skip catalog seed
 *   node generate-records.js --seed 123      -> set RNG seed (default 179)
 *
 * It does NOT delete anything. It is written to run against a schema where the
 * legacy `incidents` table has already been retired to a view (migrations
 * 001-003). Re-running appends; use a fresh DB (or truncate the new tables)
 * for a clean set.
 *
 * Design (why these records, not 224 random rows): the set is stratified so
 * every rung of every CART factor table is exercised and checkable —
 *   - a few hotspot streets carry many recent records (location + frequency
 *     tiers fire, and blotter + incident share streets so the UNIFIED analysis
 *     is proven), most streets stay quiet;
 *   - a 24-record "lab grid" covers every severity x time-of-day x weekend
 *     combination so each lookup-table entry has at least one record;
 *   - some names/addresses carry N/n, accents, apostrophes and hyphens to prove
 *     utf8mb4 round-trips (Phase 4).
 * verify-cart.js then recomputes every record's expected score independently.
 */

const mysql = require('mysql2/promise');
const path = require('path');
const config = require(path.join(__dirname, 'config.json'));
const cartEngine = require(path.join(__dirname, 'cart-engine.js'));
const { INCIDENT_TYPES, BLOTTER_TYPES, CATALOG } = require(path.join(__dirname, 'recordTypes.js'));

const SEED = (() => {
    const i = process.argv.indexOf('--seed');
    return i !== -1 ? parseInt(process.argv[i + 1], 10) || 179 : 179;
})();
const RECORDS_ONLY = process.argv.includes('--records-only');

// ── Deterministic RNG (mulberry32) so the whole dataset is reproducible ──────
let _s = SEED >>> 0;
function rng() {
    _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
    let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = a => a[Math.floor(rng() * a.length)];
const randInt = (lo, hi) => Math.floor(rng() * (hi - lo + 1)) + lo;
const jitter = (v, r) => v + (rng() - 0.5) * r * 2;

// ── Names (some with N/n, accents, apostrophes, hyphens for utf8mb4 tests) ───
const FIRST = ['Juan', 'María', 'José', 'Ana', 'Niño', 'Rosa', 'Carlos', 'Lita', 'Ramón', 'Elena',
    'Miguel', 'Teresa', 'Roberto', 'Carmen', 'Antonio', 'Gloria', 'Francisco', 'Lucía',
    'Eduardo', 'Patricia', 'Anne-Marie', 'Nora', 'Manuel', 'Rosario', 'Fernando', 'Isabel'];
const LAST = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Gonzales', 'Peña', "O'Brien", 'Mendoza',
    'Dela Cruz', 'Rivera', 'Flores', 'Ramos', 'Diaz', 'Castillo', 'Hernández', 'Villanueva',
    'Aquino', 'San-Juan', 'Manalo', 'Soriano', 'Navarro', 'Pascual', 'Enríquez', 'Ong'];
const person = () => ({ first: pick(FIRST), middle: pick(LAST), last: pick(LAST) });
const contact = () => `09${randInt(10, 99)}${randInt(1000000, 9999999)}`;

// ── Salaysay templates ──────────────────────────────────────────────────────
const TEMPLATES = [
    'Naganap ang insidente sa nasabing lokasyon. Ayon sa nagsumbong, may pangyayaring nangangailangan ng aksyon.',
    'Dumating ang reklamo sa barangay. Kinumpirma ng mga saksi ang pangyayari.',
    'Ang nagsumbong ay nagbigay ng salaysay. Nais niyang maisaayos ang problema.',
    'Base sa ulat, humingi ng tulong ang biktima sa barangay.',
    'Naiulat ang insidente. Iminungkahi ang pagpapatawag sa mga sangkot.',
];

// ── Time helpers (must match server computeTimeOfDay buckets) ────────────────
function timeOfDayFromHour(h) {
    if (h >= 6 && h <= 11) return 'Morning';
    if (h >= 12 && h <= 17) return 'Afternoon';
    if (h >= 18 && h <= 21) return 'Evening';
    return 'Night';
}
const HOUR_FOR_BUCKET = { Morning: 9, Afternoon: 14, Evening: 19, Night: 2 };
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function fmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// A date `daysAgo` before today (today = 2026-10-21 at run time).
function dateDaysAgo(daysAgo) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    return d;
}
function dayMeta(dateObj) {
    const dow = DOW[dateObj.getDay()];
    return { day_of_week: dow, is_weekend: (dateObj.getDay() === 0 || dateObj.getDay() === 6) ? 1 : 0 };
}

// Severity skew: incidents lean High/Medium, blotters lean Low/Medium.
function severityFor(cls) {
    const r = rng();
    if (cls === 'incident') return r < 0.5 ? 'High' : r < 0.8 ? 'Medium' : 'Low';
    return r < 0.5 ? 'Low' : r < 0.85 ? 'Medium' : 'High';
}
const priorityFor = sev => (sev === 'High' ? 'Urgent' : 'Normal');

// ── In-memory sequence counters (single-threaded generation) ─────────────────
const seqMap = {};
function nextPublicNumber(prefix, code) {
    const key = `${prefix}-${code}`;
    seqMap[key] = (seqMap[key] || 0) + 1;
    return { number: `${prefix}-${code}-${String(seqMap[key]).padStart(4, '0')}`, seq: seqMap[key] };
}

function structuredAddress(streetName) {
    const blk = randInt(1, 20), lot = randInt(1, 40), house = randInt(1, 300);
    const unit = rng() < 0.3 ? `${randInt(1, 4)}-${pick(['A', 'B', 'C'])}` : null;
    const composed = `Blk ${blk} Lot ${lot}, House No. ${house}${unit ? ', Unit ' + unit : ''}, ${streetName}, Barangay 179, Caloocan City`;
    return { addr_block: `${blk}`, addr_lot: `${lot}`, addr_house_no: `${house}`, addr_street: streetName, addr_unit: unit, address: composed };
}

(async () => {
    const pool = mysql.createPool({
        host: config.db.host, port: config.db.port, user: config.db.user,
        password: config.db.password, database: config.db.name,
        waitForConnections: true, connectionLimit: 5, charset: 'utf8mb4',
    });

    // Optional reset of the new tables (synthetic data only) so the generator
    // can be re-run cleanly. Done on one connection with FK checks off.
    if (process.argv.includes('--reset')) {
        const conn = await pool.getConnection();
        try {
            await conn.query('SET FOREIGN_KEY_CHECKS=0');
            for (const t of ['cart_risk_factors', 'incident_evidence', 'record_registry',
                'blotter_records', 'incident_records', 'record_number_counters', 'record_type_catalog']) {
                await conn.query(`TRUNCATE TABLE \`${t}\``);
            }
            await conn.query('SET FOREIGN_KEY_CHECKS=1');
        } finally { conn.release(); }
        console.log('Reset: truncated the new (synthetic) tables.');
    }

    // Canonical streets (+coords) from the live location_coordinates table.
    const [streetRows] = await pool.query('SELECT location, latitude, longitude FROM location_coordinates ORDER BY location');
    const STREETS = streetRows.map(r => ({ name: r.location, lat: Number(r.latitude), lng: Number(r.longitude) }));
    if (STREETS.length === 0) throw new Error('No streets in location_coordinates — cannot generate.');

    // ── Seed the type catalog (unless --records-only) ───────────────────────
    if (!RECORDS_ONLY) {
        for (const t of CATALOG) {
            await pool.query(
                `INSERT INTO record_type_catalog (record_class, type_name, type_code)
                 VALUES (?,?,?)
                 ON DUPLICATE KEY UPDATE type_code = VALUES(type_code), is_active = 1`,
                [t.class, t.name, t.code]
            );
        }
        console.log(`Seeded record_type_catalog: ${CATALOG.length} types.`);
    }

    // ── Build the record plan ───────────────────────────────────────────────
    // Hotspot streets get many recent records (location + frequency tiers);
    // quiet streets get few; the lab grid covers every factor combination.
    const hotspots = STREETS.slice(0, 3);      // many recent High records
    const warm = STREETS.slice(3, 9);          // ~3 records each
    const quiet = STREETS.slice(9);            // few records each

    // High-scoring violent types for the hotspot clusters (so totals reach the
    // High tier), and calm blotter types for the Low-tier cold cases.
    const HIGH_NAMES = ['Homicide', 'Kidnapping', 'Robbery', 'Physical Injury', 'VAWC', 'Arson', 'Grave Threat'];
    const HIGH_TYPES = INCIDENT_TYPES.filter(t => HIGH_NAMES.includes(t.name));
    const CALM_NAMES = ['Noise Complaint', 'Vandalism', 'Alarms and Scandals', 'Traffic Obstruction', 'Trespassing'];
    const CALM_TYPES = BLOTTER_TYPES.filter(t => CALM_NAMES.includes(t.name));

    const plan = [];  // {cls, street, type, severity, dateObj, hour, tag}

    function addRecord(cls, street, opts = {}) {
        const list = cls === 'incident' ? INCIDENT_TYPES : BLOTTER_TYPES;
        const type = opts.type || pick(list);
        const severity = opts.severity || severityFor(cls);
        const dateObj = opts.dateObj || dateDaysAgo(randInt(0, 200));
        const hour = opts.hour != null ? opts.hour : randInt(0, 23);
        plan.push({ cls, street, type, severity, dateObj, hour, tag: opts.tag || 'realistic' });
    }

    // Hotspots: 12 records each, recent (<25 days so frequency fires), High
    // severity, violent types, evening/night — a clear red cluster, mixing
    // incident + blotter on the same street to exercise the UNIFIED analysis.
    for (const s of hotspots) {
        for (let k = 0; k < 12; k++) {
            const cls = k % 3 === 0 ? 'blotter' : 'incident';
            addRecord(cls, s, {
                type: cls === 'incident' ? pick(HIGH_TYPES) : undefined,
                severity: 'High', dateObj: dateDaysAgo(randInt(0, 24)),
                hour: pick([20, 21, 22, 23, 1, 2]), tag: 'hotspot',
            });
        }
    }
    // Warm streets: 3 each, Medium-ish, spread over ~4 months.
    for (const s of warm) {
        for (let k = 0; k < 3; k++) addRecord(k === 0 ? 'incident' : 'blotter', s, { severity: 'Medium' });
    }
    // Cold Low cases: old (>30 days, so frequency = 5), Low severity, daytime,
    // on quiet streets -> land in the Low tier for a real spread.
    for (let k = 0; k < 45; k++) {
        addRecord('blotter', pick(quiet), {
            type: pick(CALM_TYPES), severity: 'Low',
            dateObj: dateDaysAgo(randInt(45, 200)), hour: pick([9, 10, 13, 14, 15]), tag: 'cold',
        });
    }
    // Fill to 100 incident + 100 blotter across quiet streets, realistic mix.
    const countCls = cls => plan.filter(p => p.cls === cls).length;
    while (countCls('incident') < 100) addRecord('incident', pick(quiet), {});
    while (countCls('blotter') < 100) addRecord('blotter', pick(quiet), {});

    // ── Lab grid: every severity x time-of-day x weekend combination (24) ────
    // Placed on two dedicated lab streets, dated recently so they are easy to
    // find and each factor cell is covered exactly.
    const labStreets = [STREETS[STREETS.length - 1], STREETS[STREETS.length - 2]];
    const buckets = ['Morning', 'Afternoon', 'Evening', 'Night'];
    const sevs = ['Low', 'Medium', 'High'];
    let labN = 0;
    for (const sev of sevs) {
        for (const b of buckets) {
            for (const wk of [0, 1]) {
                // find a recent date matching the desired weekend-ness
                let d = dateDaysAgo(randInt(1, 20));
                for (let g = 0; g < 7 && ((d.getDay() === 0 || d.getDay() === 6) ? 1 : 0) !== wk; g++) d = dateDaysAgo(randInt(1, 20));
                const cls = labN % 2 === 0 ? 'incident' : 'blotter';
                addRecord(cls, labStreets[labN % 2], {
                    severity: sev, dateObj: d, hour: HOUR_FOR_BUCKET[b], tag: 'lab',
                });
                labN++;
            }
        }
    }

    console.log(`Planned ${plan.length} records (incident ${countCls('incident')}, blotter ${countCls('blotter')}; lab ${labN}).`);

    // ── Insert base records + registry rows ─────────────────────────────────
    const registryIds = [];
    for (const p of plan) {
        const table = p.cls === 'incident' ? 'incident_records' : 'blotter_records';
        const prefix = p.cls === 'incident' ? 'INC' : 'BLT';
        const sev = p.severity;
        const hour = p.hour;
        const time = `${String(hour).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}:00`;
        const dateStr = fmtDate(p.dateObj);
        const meta = dayMeta(p.dateObj);
        const comp = person(), resp = person(), rep = person();
        const addr = structuredAddress(p.street.name);
        const { number, seq } = nextPublicNumber(prefix, p.type.code);

        const [ins] = await pool.query(
            `INSERT INTO ${table}
                (incident_type, type_code, date, time, latitude, longitude, street_name,
                 addr_block, addr_lot, addr_house_no, addr_street, addr_unit, address,
                 complainant_first, complainant_middle, complainant_last, complainant_contact,
                 respondent_first, respondent_middle, respondent_last, respondent_address, respondent_age,
                 reporter_first, reporter_middle, reporter_last, reporter_address, reporter_contact,
                 reported_by_name, respondent_name,
                 severity, priority, status, is_draft, description, statement, recommended_action,
                 time_of_day, day_of_week, is_weekend, data_origin)
             VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?, 'Open', 0, ?, ?, '', ?,?,?, 'synthetic')`,
            [
                p.type.name, p.type.code, dateStr, time,
                jitter(p.street.lat, 0.0006).toFixed(8), jitter(p.street.lng, 0.0006).toFixed(8), p.street.name,
                addr.addr_block, addr.addr_lot, addr.addr_house_no, addr.addr_street, addr.addr_unit, addr.address,
                comp.first, comp.middle, comp.last, contact(),
                resp.first, resp.middle, resp.last, structuredAddress(pick(STREETS).name).address, randInt(18, 70),
                rep.first, rep.middle, rep.last, addr.address, contact(),
                `${comp.first} ${comp.middle} ${comp.last}`, `${resp.first} ${resp.middle} ${resp.last}`,
                sev, priorityFor(sev),
                pick(TEMPLATES), '',
                meta.time_of_day, meta.day_of_week, meta.is_weekend,
            ]
        );
        const sourceId = ins.insertId;

        const [reg] = await pool.query(
            `INSERT INTO record_registry (source, source_id, public_number, type_code) VALUES (?,?,?,?)`,
            [p.cls, sourceId, number, p.type.code]
        );
        registryIds.push({ registry_id: reg.insertId, source: p.cls, source_id: sourceId, table, street: p.street.name, dateStr });
    }

    // Persist sequence counters so the server continues numbering correctly.
    for (const key of Object.keys(seqMap)) {
        const [prefix, code] = key.split('-');
        await pool.query(
            `INSERT INTO record_number_counters (prefix, type_code, next_seq) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE next_seq = GREATEST(next_seq, VALUES(next_seq))`,
            [prefix, code, seqMap[key] + 1]
        );
    }

    console.log(`Inserted ${registryIds.length} records. Running CART...`);

    // ── CART pass (same inputs the server's computeCartRiskFactors uses) ─────
    for (const r of registryIds) {
        const [[rec]] = await pool.query(
            `SELECT incident_type, time_of_day, is_weekend, street_name, severity, date FROM ${r.table} WHERE id = ?`,
            [r.source_id]
        );
        const [[loc]] = await pool.query('SELECT COUNT(*) AS street_count FROM incidents WHERE street_name = ?', [rec.street_name]);
        const [[freq]] = await pool.query(
            'SELECT COUNT(*) AS recent_count FROM incidents WHERE street_name = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)',
            [rec.street_name]
        );
        const result = cartEngine.analyze(
            { incident_type: rec.incident_type, time_of_day: rec.time_of_day, is_weekend: !!rec.is_weekend, street_name: rec.street_name, severity: rec.severity },
            { street_count: loc.street_count },
            { recent_count: freq.recent_count }
        );
        await pool.query(
            `INSERT INTO cart_risk_factors
                (incident_id, time_risk_score, day_risk_score, type_risk_score,
                 location_risk_score, frequency_risk_score, total_risk_score,
                 danger_level, decision_path, model_version)
             VALUES (?,?,?,?,?,?,?,?,?,'v1.0')`,
            [
                r.registry_id,
                result.scores.time || 0, result.scores.day || 0, result.scores.type || 0,
                result.scores.location || 0, result.scores.frequency || 0, result.totalScore || 0,
                result.dangerDescription || 'Level 1 — Low Danger / Stable Area',
                Array.isArray(result.decisionPath) ? result.decisionPath.join('\n') : '',
            ]
        );
        await pool.query(`UPDATE ${r.table} SET danger_level = ? WHERE id = ?`, [result.dangerDescription, r.source_id]);
    }

    const [[bc]] = await pool.query('SELECT COUNT(*) t FROM blotter_records');
    const [[ic]] = await pool.query('SELECT COUNT(*) t FROM incident_records');
    const [[cc]] = await pool.query('SELECT COUNT(*) t FROM cart_risk_factors');
    const [[vc]] = await pool.query('SELECT COUNT(*) t FROM incidents');
    console.log(`\nDone. blotter_records=${bc.t} incident_records=${ic.t} cart_risk_factors=${cc.t} incidents(view)=${vc.t}`);

    await pool.end();
})().catch(e => { console.error('GENERATOR FAILED:', e.message); process.exit(1); });
