// Reproducible, additive QA fixtures. Default: 200 blotters + 200 incidents.
// No reset/truncate mode: existing business records are never deleted.
const mysql = require('mysql2/promise');
const { loadConfig } = require('./config-manager');
const cartEngine = require('./cart-engine');
const { CATALOG, codeFor } = require('./recordTypes');
const { buildPlan,tuneThresholdProbes } = require('./test-data/scenarios');
const { readModelConfiguration, referenceAssessment } = require('./test-data/cart-reference');
const { contains } = require('../frontend/barangay-boundary');
const { patrolDecision, distanceMeters } = require('./patrolPolicy');

async function ensureQaTables(db) {
    await db.query(`CREATE TABLE IF NOT EXISTS qa_record_batches (
        batch_key VARCHAR(80) PRIMARY KEY, seed INT NOT NULL, base_date DATE NOT NULL,
        incident_count INT NOT NULL, blotter_count INT NOT NULL, summary JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4`);
    await db.query(`CREATE TABLE IF NOT EXISTS qa_record_cases (
        incident_id INT PRIMARY KEY, batch_key VARCHAR(80) NOT NULL, case_id VARCHAR(40) NOT NULL,
        scenario VARCHAR(80) NOT NULL, expected JSON NOT NULL,
        UNIQUE KEY uq_qa_case (batch_key,case_id),
        FOREIGN KEY (incident_id) REFERENCES record_registry(registry_id) ON DELETE CASCADE,
        FOREIGN KEY (batch_key) REFERENCES qa_record_batches(batch_key)
    ) CHARACTER SET utf8mb4`);
}
async function allocateNumber(db, source, typeCode) {
    const prefix = source === 'incident' ? 'INC' : 'BLT';
    const [result] = await db.query(`INSERT INTO record_number_counters (prefix,type_code,next_seq)
        VALUES (?,?,2) ON DUPLICATE KEY UPDATE next_seq=LAST_INSERT_ID(next_seq+1)`, [prefix,typeCode]);
    const number = result.affectedRows === 1 ? 1 : Number((await db.query('SELECT LAST_INSERT_ID() AS n'))[0][0].n)-1;
    return `${prefix}-${typeCode}-${String(number).padStart(4,'0')}`;
}
async function synchronizeCounters(db) {
    const [rows] = await db.query(`SELECT source,type_code,MAX(CAST(SUBSTRING_INDEX(public_number,'-',-1) AS UNSIGNED)) AS last_number
        FROM record_registry GROUP BY source,type_code`);
    for (const row of rows) await db.query(`INSERT INTO record_number_counters (prefix,type_code,next_seq) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE next_seq=GREATEST(next_seq,VALUES(next_seq))`,
    [row.source === 'incident' ? 'INC' : 'BLT',row.type_code,Number(row.last_number)+1]);
}

async function seedRecords(db, { seed = 179, incidents = 200, blotters = 200,
    batchKey = 'qa-cart-map-400-v1', baseDate, dryRun = false } = {}) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(batchKey)) throw new Error('Use a batch key containing 1–80 letters, digits, underscores, or hyphens.');
    if (![incidents,blotters,seed].every(Number.isInteger) || incidents<1 || blotters<1 || incidents+blotters>10000) throw new Error('Record counts must be positive integers, at most 10,000 combined.');
    const [{ today }] = (await db.query('SELECT CURDATE() AS today'))[0];
    baseDate = baseDate || String(today).slice(0,10);
    const parsedBaseDate = new Date(baseDate+'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || !Number.isFinite(parsedBaseDate.getTime()) || parsedBaseDate.toISOString().slice(0,10)!==baseDate) throw new Error('Invalid base date.');
    const [streets] = await db.query('SELECT location,latitude,longitude FROM location_coordinates ORDER BY location');
    const plan = buildPlan({ streets, baseDate, seed, incidents, blotters });
    if (dryRun) return { dryRun: true, batchKey, seed, baseDate, incidents, blotters,
        scenarios: plan.reduce((counts,row) => ({ ...counts, [row.scenario]: (counts[row.scenario]||0)+1 }), {}) };
    await ensureQaTables(db);
    const connection = db.getConnection ? await db.getConnection() : db;
    try {
        await connection.beginTransaction();
        const [batches] = await connection.query('SELECT * FROM qa_record_batches WHERE batch_key=? FOR UPDATE', [batchKey]);
        if (batches[0]) {
            const batch = batches[0];
            const [{ count }] = (await connection.query('SELECT COUNT(*) AS count FROM qa_record_cases WHERE batch_key=?', [batchKey]))[0];
            if (Number(count) !== incidents+blotters || batch.seed !== seed || batch.incident_count !== incidents || batch.blotter_count !== blotters) {
                throw new Error('Existing QA batch differs or has archived/deleted records. Use a different --batch key to add another intentional batch.');
            }
            await connection.rollback();
            const summary = typeof batch.summary === 'string' ? JSON.parse(batch.summary) : batch.summary;
            return { ...summary, reused: true };
        }
        await connection.query('INSERT INTO qa_record_batches (batch_key,seed,base_date,incident_count,blotter_count) VALUES (?,?,?,?,?)', [batchKey,seed,baseDate,incidents,blotters]);
        for (const type of CATALOG) await connection.query(`INSERT INTO record_type_catalog (record_class,type_name,type_code) VALUES (?,?,?)
            ON DUPLICATE KEY UPDATE type_code=VALUES(type_code),is_active=1`, [type.class,type.name,type.code]);
        await synchronizeCounters(connection);
        const model = await readModelConfiguration(connection);
        const [previousHistory] = await connection.query(`SELECT street_name,COUNT(*) AS total,
            SUM(date>=DATE_SUB(CURDATE(),INTERVAL 30 DAY) AND date<=CURDATE()) AS recent
            FROM incidents WHERE is_draft=0 AND street_name IS NOT NULL GROUP BY street_name`);
        tuneThresholdProbes(plan,model,cartEngine.scores.type,previousHistory,String(today).slice(0,10));
        const inserted = [];
        for (const row of plan) {
            const { cls,case_id,scenario,patrol_override,patrol_notes,type, ...fields } = row;
            const typeCode = codeFor(cls,row.incident_type);
            fields.type_code = typeCode;
            fields.data_origin = 'synthetic';
            fields.description = `[${batchKey}] ${fields.description}`;
            const table = cls === 'incident' ? 'incident_records' : 'blotter_records';
            const number = await allocateNumber(connection,cls,typeCode);
            const [base] = await connection.query(`INSERT INTO ${table} SET ?`, [fields]);
            const [registry] = await connection.query('INSERT INTO record_registry (source,source_id,public_number,type_code) VALUES (?,?,?,?)', [cls,base.insertId,number,typeCode]);
            await connection.query('INSERT INTO record_patrol_details (incident_id,notes,patrol_override) VALUES (?,?,?)', [registry.insertId,patrol_notes,patrol_override]);
            inserted.push({ ...row, id: registry.insertId, source_id: base.insertId, public_number: number, table });
        }
        cartEngine.updateWeights(model.weights); cartEngine.updateThresholds(model.thresholds); cartEngine.updateSourceWeights(model.sourceWeights);
        const [history] = await connection.query(`SELECT street_name,COUNT(*) AS total,
            SUM(date>=DATE_SUB(CURDATE(),INTERVAL 30 DAY) AND date<=CURDATE()) AS recent
            FROM incidents WHERE is_draft=0 AND street_name IS NOT NULL GROUP BY street_name`);
        const stats = new Map(history.map(row => [row.street_name,row]));
        const summary = { batchKey, seed, baseDate, incidents, blotters, total: plan.length,
            model, scored: 0, drafts: 0, resolved: 0, mapEligible: 0,
            riskLevels: { 'Level 1':0,'Level 2':0,'Level 3':0 }, scenarios: {}, examples: [] };
        for (const row of inserted) {
            summary.scenarios[row.scenario] = (summary.scenarios[row.scenario]||0)+1;
            if (row.status === 'Resolved') summary.resolved++;
            let assessment;
            if (row.is_draft) summary.drafts++;
            else {
                const counts = stats.get(row.street_name) || {};
                const input = { ...row, form_type: row.cls === 'incident' ? 'crime' : 'blotter' };
                assessment = cartEngine.analyze(input,{ street_count: Number(counts.total)||0 },{ recent_count: Number(counts.recent)||0 });
                const expected = referenceAssessment(input,counts,model,cartEngine.getTypeScore(row.incident_type));
                if (assessment.totalScore !== expected.total || assessment.dangerLevel !== expected.level) throw new Error('Independent CART arithmetic mismatch at '+row.case_id);
                row.cart_score = assessment.totalScore;
                summary.scored++; summary.riskLevels[assessment.dangerLevel]++;
                await connection.query(`INSERT INTO cart_risk_factors (incident_id,time_risk_score,day_risk_score,type_risk_score,
                    location_risk_score,frequency_risk_score,total_risk_score,danger_level,decision_path,model_version)
                    VALUES (?,?,?,?,?,?,?,?,?,'qa-current-rules')`,
                [row.id,assessment.scores.time,assessment.scores.day,assessment.scores.type,assessment.scores.location,assessment.scores.frequency,
                    assessment.totalScore,assessment.dangerDescription,assessment.decisionPath.join('\n')]);
                await connection.query(`UPDATE ${row.table} SET danger_level=? WHERE id=?`, [assessment.dangerDescription,row.source_id]);
            }
            const cutoff = new Date(baseDate+'T12:00:00Z'); cutoff.setUTCDate(cutoff.getUTCDate()-30);
            const nearby = inserted.filter(other => !other.is_draft && other.status!=='Resolved' && other.incident_type===row.incident_type
                && other.date>=cutoff.toISOString().slice(0,10) && other.date<=baseDate && distanceMeters(row,other)<=100).length;
            const eligible = patrolDecision(row,model.thresholds,nearby).eligible && contains(row.latitude,row.longitude);
            if (eligible) summary.mapEligible++;
            const expected = { cart_score: assessment?.totalScore ?? null, danger_level: assessment?.dangerLevel ?? null,
                inside_boundary: contains(row.latitude,row.longitude), map_eligible_at_generation: eligible,
                counts: stats.get(row.street_name) || { total:0,recent:0 } };
            await connection.query('INSERT INTO qa_record_cases (incident_id,batch_key,case_id,scenario,expected) VALUES (?,?,?,?,?)', [row.id,batchKey,row.case_id,row.scenario,JSON.stringify(expected)]);
            if (['manual-include','severity-override-high','same-pin','history-count-1','notes-validation'].includes(row.scenario) && summary.examples.length<30) summary.examples.push({ id:row.id,number:row.public_number,scenario:row.scenario,score:expected.cart_score });
        }
        await connection.query('UPDATE qa_record_batches SET summary=? WHERE batch_key=?', [JSON.stringify(summary),batchKey]);
        await connection.commit();
        return summary;
    } catch (error) { await connection.rollback(); throw error; }
    finally { if (connection !== db) connection.release(); }
}

async function main() {
    if (process.argv.includes('--reset')) throw new Error('--reset has been removed: this generator never deletes business records.');
    const arg = (name,fallback) => { const index=process.argv.indexOf(name); return index<0 ? fallback : process.argv[index+1]; };
    const config=loadConfig();
    const pool=mysql.createPool({ host:config.db.host,port:config.db.port,user:config.db.user,password:config.db.password,database:config.db.name,
        charset:'utf8mb4',dateStrings:['DATE'],connectionLimit:3 });
    try {
        const summary=await seedRecords(pool,{ seed:Number(arg('--seed',179)),incidents:Number(arg('--incidents',200)),blotters:Number(arg('--blotters',200)),
            batchKey:arg('--batch','qa-cart-map-400-v1'),baseDate:arg('--base-date',undefined),dryRun:process.argv.includes('--dry-run') });
        console.log(JSON.stringify(summary,null,2));
    } finally { await pool.end(); }
}
if (require.main===module) main().catch(error=>{console.error('GENERATOR FAILED: '+error.message);process.exitCode=1;});
module.exports={ seedRecords,ensureQaTables };
