/**
 * Independent CART verification.
 *
 *   node verify-cart.js
 *
 * Recomputes every record's expected risk score from the DOCUMENTED model
 * (docs/CART_MODEL.md: fixed factor tables, severity-adaptive weights,
 * thresholds) WITHOUT calling cart-engine.js, then diffs against what the engine
 * actually stored in cart_risk_factors. A clean run means the implementation
 * matches its own documented spec. It also reports the danger-level
 * distribution, hotspot behaviour, and — the real finding for the paper — which
 * approved catalog types have no entry in the engine's type-score table and so
 * silently fall to the default score.
 *
 * The type raw-score table is reference data (the approved weights the owner
 * supplied), so it is read from the engine; everything else (bucketing, the
 * weighted-sum formula, the severity-adaptive redistribution, the thresholds) is
 * reimplemented here from the documentation so the check is genuinely
 * independent of the engine's arithmetic.
 */

const mysql = require('mysql2/promise');
const path = require('path');
const config = require(path.join(__dirname, 'config.json'));
const cartEngine = require(path.join(__dirname, 'cart-engine.js'));
const { CATALOG } = require(path.join(__dirname, 'recordTypes.js'));

// ── Documented model (docs/CART_MODEL.md) ───────────────────────────────────
const TIME = { Night: 90, Evening: 70, Afternoon: 40, Morning: 20 };
const timeScore = t => (t in TIME ? TIME[t] : 20);
const dayScore = isWeekend => (isWeekend ? 70 : 40);
const locScore = n => (n >= 5 ? 90 : n >= 3 ? 70 : n >= 2 ? 50 : n >= 1 ? 30 : 10);
const freqScore = n => (n >= 5 ? 95 : n >= 3 ? 75 : n >= 2 ? 50 : n >= 1 ? 25 : 5);
const typeWeightFor = sev => (sev === 'High' ? 0.30 : sev === 'Medium' ? 0.20 : 0.10);
// Base weights (defaults; cart-engine runs with these when called directly).
const BASE = { time: 0.25, day: 0.15, location: 0.20, frequency: 0.10 };
const BASE_OTHER = BASE.time + BASE.day + BASE.location + BASE.frequency; // 0.70
const HIGH_MIN = 67, MOD_MIN = 34;

function expectedTotal({ timeOfDay, isWeekend, typeRaw, street_count, recent_count, severity }) {
    const tw = typeWeightFor(severity);
    const remaining = 1 - tw;
    const w = {
        type: tw,
        time: remaining * (BASE.time / BASE_OTHER),
        day: remaining * (BASE.day / BASE_OTHER),
        location: remaining * (BASE.location / BASE_OTHER),
        frequency: remaining * (BASE.frequency / BASE_OTHER),
    };
    const total =
        typeRaw * w.type +
        timeScore(timeOfDay) * w.time +
        dayScore(isWeekend) * w.day +
        locScore(street_count) * w.location +
        freqScore(recent_count) * w.frequency;
    return Math.round(total * 100) / 100;
}
const tierOf = s => (s >= HIGH_MIN ? 'High' : s >= MOD_MIN ? 'Moderate' : 'Low');
function storedTier(dangerLevel) {
    if (/Level 3|High/i.test(dangerLevel)) return 'High';
    if (/Level 2|Moderate/i.test(dangerLevel)) return 'Moderate';
    return 'Low';
}

(async () => {
    const pool = mysql.createPool({
        host: config.db.host, port: config.db.port, user: config.db.user,
        password: config.db.password, database: config.db.name,
        waitForConnections: true, connectionLimit: 5, charset: 'utf8mb4',
    });

    const [rows] = await pool.query(`
        SELECT i.id, i.incident_type, i.time_of_day, i.is_weekend, i.street_name, i.severity,
               c.total_risk_score, c.type_risk_score, c.danger_level
        FROM incidents i JOIN cart_risk_factors c ON c.incident_id = i.id
    `);

    // Street counts (total + recent 30d) as the engine sees them via the view.
    const [locRows] = await pool.query('SELECT street_name, COUNT(*) n FROM incidents GROUP BY street_name');
    const [freqRows] = await pool.query(
        'SELECT street_name, COUNT(*) n FROM incidents WHERE date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY street_name');
    const locMap = Object.fromEntries(locRows.map(r => [r.street_name, r.n]));
    const freqMap = Object.fromEntries(freqRows.map(r => [r.street_name, r.n]));

    let mismatches = 0, tierMismatch = 0;
    const dist = { High: 0, Moderate: 0, Low: 0 };
    const examples = [];
    for (const r of rows) {
        const typeRaw = Number(r.type_risk_score); // engine's looked-up type score (reference data)
        const exp = expectedTotal({
            timeOfDay: r.time_of_day, isWeekend: !!r.is_weekend, typeRaw,
            street_count: locMap[r.street_name] || 0, recent_count: freqMap[r.street_name] || 0,
            severity: r.severity,
        });
        const got = Number(r.total_risk_score);
        if (Math.abs(exp - got) > 0.02) {
            mismatches++;
            if (examples.length < 8) examples.push(`#${r.id} ${r.incident_type} sev=${r.severity}: expected ${exp}, stored ${got}`);
        }
        if (tierOf(got) !== storedTier(r.danger_level)) tierMismatch++;
        dist[tierOf(got)]++;
    }

    // Type-score coverage: which approved catalog types have no engine entry
    // (fall to the default type score)?
    const typeTable = cartEngine.scores && cartEngine.scores.type ? cartEngine.scores.type : {};
    const defaultType = typeTable.default;
    const usedTypes = [...new Set(rows.map(r => r.incident_type))];
    const missing = usedTypes.filter(t => !(t in typeTable)).sort();
    const catalogMissing = CATALOG.map(c => c.name).filter(n => !(n in typeTable)).sort();

    // utf8mb4 round-trip spot check.
    const [[uni]] = await pool.query(
        `SELECT COUNT(*) n FROM incidents WHERE reported_by_name REGEXP '[ñÑáéíóúÁÉ]' OR reported_by_name LIKE '%\\'%' OR reported_by_name LIKE '%-%'`);

    console.log('\n================ CART VERIFICATION ================');
    console.log(`Records checked:            ${rows.length}`);
    console.log(`Total-score mismatches:     ${mismatches}   (engine vs documented formula)`);
    console.log(`Danger-tier mismatches:     ${tierMismatch}`);
    console.log(`Danger distribution:        High ${dist.High} | Moderate ${dist.Moderate} | Low ${dist.Low}`);
    console.log(`utf8mb4 names (ñ/accent/'/-): ${uni.n} records round-tripped`);
    if (examples.length) { console.log('\nExample mismatches:'); examples.forEach(e => console.log('  ' + e)); }
    console.log(`\nType-score default is ${defaultType}. Types in the data with NO engine entry (scored at default):`);
    console.log('  ' + (missing.length ? missing.join(', ') : '(none)'));
    console.log(`\nApproved catalog types (all ${CATALOG.length}) with NO engine type-score entry: ${catalogMissing.length}`);
    console.log('  ' + (catalogMissing.length ? catalogMissing.join(', ') : '(none)'));
    console.log('===================================================\n');

    await pool.end();
    process.exit(mismatches === 0 && tierMismatch === 0 ? 0 : 1);
})().catch(e => { console.error('VERIFY FAILED:', e.message); process.exit(2); });
