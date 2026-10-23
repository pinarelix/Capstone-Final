// Verify stored CART results with independently implemented documented
// arithmetic. A clean run checks implementation, not forecast accuracy.
const mysql = require('mysql2/promise');
const { loadConfig } = require('./config-manager');
const { CATALOG } = require('./recordTypes');
const cartEngine = require('./cart-engine');
const { readModelConfiguration, referenceAssessment } = require('./test-data/cart-reference');

function documentedTime(time) {
    const hour = Number(String(time).slice(0,2));
    return hour<6 || hour>=22 ? 'Night' : hour<12 ? 'Morning' : hour<18 ? 'Afternoon' : 'Evening';
}
function level(text) {
    return /Level 3|High/i.test(text||'') ? 'Level 3' : /Level 2|Moderate/i.test(text||'') ? 'Level 2' : 'Level 1';
}
async function verifyCart(db, { batchKey } = {}) {
    const model = await readModelConfiguration(db);
    const [rows] = await db.query(`SELECT i.*,rf.total_risk_score,rf.time_risk_score,rf.day_risk_score,rf.type_risk_score,
        rf.location_risk_score,rf.frequency_risk_score,rf.danger_level AS stored_danger
        FROM incidents i LEFT JOIN cart_risk_factors rf ON rf.incident_id=i.id
        ${batchKey ? 'JOIN qa_record_cases qa ON qa.incident_id=i.id WHERE qa.batch_key=?' : ''}
        ORDER BY i.id`, batchKey ? [batchKey] : []);
    const [history] = await db.query(`SELECT street_name,COUNT(*) AS total,
        SUM(date>=DATE_SUB(CURDATE(),INTERVAL 30 DAY) AND date<=CURDATE()) AS recent
        FROM incidents WHERE is_draft=0 AND street_name IS NOT NULL GROUP BY street_name`);
    const counts = new Map(history.map(row=>[row.street_name,row]));
    const mismatches = [];
    const distribution = { 'Level 1':0,'Level 2':0,'Level 3':0 };
    let scored=0,drafts=0;
    for(const row of rows) {
        if(Number(row.is_draft)) {
            drafts++;
            if(row.total_risk_score != null) mismatches.push({ id:row.id,field:'draft should not have a CART row' });
            continue;
        }
        const actualTime = documentedTime(row.time);
        const weekday = new Date(row.date+'T12:00:00Z').getUTCDay();
        const weekend = weekday===0 || weekday===6 ? 1 : 0;
        if(row.time_of_day!==actualTime) mismatches.push({ id:row.id,field:'time_of_day',expected:actualTime,actual:row.time_of_day });
        if(Number(row.is_weekend)!==weekend) mismatches.push({ id:row.id,field:'is_weekend',expected:weekend,actual:row.is_weekend });
        const raw = cartEngine.scores.type[row.incident_type] ?? 30;
        const expected = referenceAssessment({ ...row,time_of_day:actualTime,is_weekend:weekend },counts.get(row.street_name)||{},model,raw);
        scored++; distribution[expected.level]++;
        for(const [factor,value] of Object.entries(expected.scores)) if(row[`${factor}_risk_score`]==null || Number(row[`${factor}_risk_score`])!==value) {
            mismatches.push({ id:row.id,field:factor,expected:value,actual:row[`${factor}_risk_score`] });
        }
        if(row.total_risk_score==null || Number(row.total_risk_score)!==expected.total) mismatches.push({ id:row.id,field:'total',expected:expected.total,actual:row.total_risk_score });
        if(level(row.stored_danger)!==expected.level) mismatches.push({ id:row.id,field:'danger_level',expected:expected.level,actual:row.stored_danger });
    }
    const missingTypeMappings = [...new Set(CATALOG.map(type=>type.name))].filter(name=>cartEngine.scores.type[name]===undefined);
    return { batchKey:batchKey||null, records:rows.length,scored,drafts,distribution,
        mismatchCount:mismatches.length,mismatches: mismatches.slice(0,25),missingTypeMappings,
        passed: rows.length>0 && mismatches.length===0 && missingTypeMappings.length===0,model };
}
async function main() {
    const index=process.argv.indexOf('--batch'); const batchKey=index<0 ? undefined : process.argv[index+1];
    const config=loadConfig();
    const pool=mysql.createPool({ host:config.db.host,port:config.db.port,user:config.db.user,password:config.db.password,database:config.db.name,
        charset:'utf8mb4',dateStrings:['DATE'],connectionLimit:2 });
    try {
        const result=await verifyCart(pool,{batchKey});
        console.log(JSON.stringify(result,null,2)); if(!result.passed) process.exitCode=1;
    } finally { await pool.end(); }
}
if(require.main===module)main().catch(error=>{console.error('VERIFICATION FAILED: '+error.message);process.exitCode=1;});
module.exports={ verifyCart,documentedTime };
