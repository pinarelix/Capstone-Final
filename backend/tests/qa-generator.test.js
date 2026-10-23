const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app,pool } = require('../server');
const { seedRecords } = require('../generate-records');
const { buildPlan,timeBucket } = require('../test-data/scenarios');
const { verifyCart } = require('../verify-cart');
const { CATALOG } = require('../recordTypes');
const { BARANGAY_LOCATIONS } = require('../locationList');
const { contains } = require('../../frontend/barangay-boundary');

function sampleStreets() {
    const points=[];
    for(let lat=14.741;lat<14.758;lat+=.0015)for(let lng=121.068;lng<121.081;lng+=.0015)if(contains(lat,lng))points.push({latitude:lat,longitude:lng});
    return BARANGAY_LOCATIONS.map((location,index)=>({location,...points[index]}));
}
describe('QA scenario design',()=>{
    const options={ streets:sampleStreets(),baseDate:'2026-10-24',seed:179 };
    test('exactly 200 records per source, all types, and all 48 factorial cells',()=>{
        const plan=buildPlan(options);
        expect(plan.filter(row=>row.cls==='incident')).toHaveLength(200);
        expect(plan.filter(row=>row.cls==='blotter')).toHaveLength(200);
        expect(new Set(plan.map(row=>row.case_id)).size).toBe(400);
        expect(plan.filter(row=>row.scenario==='catalog-coverage')).toHaveLength(CATALOG.length);
        const factorial=plan.filter(row=>row.scenario==='factorial-grid');
        expect(new Set(factorial.map(row=>[row.cls,row.severity,row.time_of_day,row.is_weekend].join('|'))).size).toBe(48);
    });
    test('seed is reproducible and all dates/time buckets are internally valid',()=>{
        const plan=buildPlan(options);
        expect(buildPlan(options)).toEqual(plan);
        expect(buildPlan({...options,seed:180})).not.toEqual(plan);
        expect(plan.every(row=>row.date<=options.baseDate && row.time_of_day===timeBucket(row.time))).toBe(true);
    });
    test('location count boundary streets are isolated from filler records',()=>{
        const plan=buildPlan(options);
        for(const cls of ['incident','blotter'])for(let n=1;n<=5;n++) {
            const group=plan.filter(row=>row.cls===cls && row.scenario===`history-count-${n}`);
            expect(group).toHaveLength(n);
            expect(plan.filter(row=>row.street_name===group[0].street_name)).toHaveLength(n);
        }
    });
    test('negative cases are explicit and invalid notes are not inserted as seed data',()=>{
        const plan=buildPlan(options);
        expect(plan.filter(row=>row.is_draft)).toHaveLength(10);
        expect(plan.filter(row=>row.status==='Resolved')).toHaveLength(40);
        expect(plan.filter(row=>row.latitude===null)).toHaveLength(6);
        expect(plan.filter(row=>row.latitude!=null && !contains(row.latitude,row.longitude))).toHaveLength(4);
        expect(plan.every(row=>row.patrol_notes.length<=200)).toBe(true);
    });
});

describe('400-record generator and independent CART verification',()=>{
    const batchKey='jest-qa-400';
    let summary,token,userId;
    beforeAll(async()=>{
        for(const street of sampleStreets())await pool.query('INSERT INTO location_coordinates (location,latitude,longitude) VALUES (?,?,?) ON DUPLICATE KEY UPDATE latitude=VALUES(latitude),longitude=VALUES(longitude)',[street.location,street.latitude,street.longitude]);
        summary=await seedRecords(pool,{batchKey});
        const [user]=await pool.query("INSERT INTO users (name,username,password_hash,role,is_active) VALUES ('QA fixture verifier','qa_fixture_verifier',?,'Executive Officer',1)",[await bcrypt.hash('testpass123',10)]);
        userId=user.insertId;
        token=(await request(app).post('/api/auth/login').send({username:'qa_fixture_verifier',password:'testpass123'})).body.session_token;
    });
    afterAll(async()=>{
        const [records]=await pool.query('SELECT r.* FROM record_registry r JOIN qa_record_cases qa ON qa.incident_id=r.registry_id WHERE qa.batch_key=?',[batchKey]);
        for(const record of records){
            await pool.query('DELETE FROM record_registry WHERE registry_id=?',[record.registry_id]);
            await pool.query(`DELETE FROM ${record.source==='incident' ? 'incident_records' : 'blotter_records'} WHERE id=?`,[record.source_id]);
        }
        await pool.query('DELETE FROM qa_record_batches WHERE batch_key=?',[batchKey]);
        if(userId){await pool.query('DELETE FROM cart_analysis_log WHERE triggered_by=?',[userId]);await pool.query('DELETE FROM audit_logs WHERE user_id=?',[userId]);await pool.query('DELETE FROM login_history WHERE user_id=?',[userId]);await pool.query('DELETE FROM user_sessions WHERE user_id=?',[userId]);await pool.query('DELETE FROM users WHERE id=?',[userId]);}
        await pool.end();
    });
    test('counts, draft exclusions, and all three CART levels match the fixture design',()=>{
        expect(summary.total).toBe(400); expect(summary.incidents).toBe(200);expect(summary.blotters).toBe(200);
        expect(summary.scored).toBe(390);expect(summary.drafts).toBe(10);expect(summary.resolved).toBe(40);
        for(const count of Object.values(summary.riskLevels))expect(count).toBeGreaterThan(0);
    });
    test('independent verifier checks every scored record without arithmetic or input-derivation mismatches',async()=>{
        const result=await verifyCart(pool,{batchKey});
        expect(result.passed).toBe(true);expect(result.mismatchCount).toBe(0);expect(result.records).toBe(400);
    });
    test('threshold probe records straddle the live Moderate and High boundaries for both sources',async()=>{
        const [rows]=await pool.query(`SELECT i.form_type,qa.scenario,rf.total_risk_score FROM qa_record_cases qa
            JOIN incidents i ON i.id=qa.incident_id JOIN cart_risk_factors rf ON rf.incident_id=i.id
            WHERE qa.batch_key=? AND qa.scenario LIKE 'threshold-%'`,[batchKey]);
        expect(rows).toHaveLength(8);
        for(const row of rows){
            const [,band,side]=row.scenario.split('-'),threshold=band==='high' ? summary.model.thresholds.level3 : summary.model.thresholds.level2;
            if(side==='below')expect(Number(row.total_risk_score)).toBeLessThan(threshold);
            else expect(Number(row.total_risk_score)).toBeGreaterThanOrEqual(threshold);
        }
    });
    test('map route returns the expected eligible population and preserves source scores',async()=>{
        const response=await request(app).get('/api/heatmap/records?window_days=all&limit=1000').set('Authorization',`Bearer ${token}`);
        expect(response.status).toBe(200);
        const visible=response.body.records.filter(row=>contains(row.latitude,row.longitude));
        expect(visible).toHaveLength(summary.mapEligible);
        expect(visible.every(row=>row.data_origin==='synthetic' && !row.is_draft && row.status!=='Resolved')).toBe(true);
        for(const row of visible)expect(Number(row.stored_cart_score)).toBe(row.cart_score);
    });
    test('re-running a named batch reuses the 400 records rather than appending another set',async()=>{
        const second=await seedRecords(pool,{batchKey});
        expect(second.reused).toBe(true);
        expect((await pool.query('SELECT COUNT(*) AS count FROM qa_record_cases WHERE batch_key=?',[batchKey]))[0][0].count).toBe(400);
    });
    test('what-if prediction matches a real fixture with the same severity, source, and location context',async()=>{
        const [rows]=await pool.query(`SELECT i.*,rf.total_risk_score FROM incidents i JOIN cart_risk_factors rf ON rf.incident_id=i.id
            JOIN qa_record_cases qa ON qa.incident_id=i.id WHERE qa.batch_key=? AND i.source='incident' AND i.street_name IS NOT NULL LIMIT 1`,[batchKey]);
        const record=rows[0];
        const response=await request(app).post('/api/cart/predict').set('Authorization',`Bearer ${token}`).send({
            incident_type:record.incident_type,severity:record.severity,form_type:record.form_type,
            time:record.time.slice(0,5),day:record.day_of_week,location:record.street_name
        });
        expect(response.status).toBe(200);
        expect(response.body.totalScore).toBe(Number(record.total_risk_score));
        expect((await pool.query('SELECT COUNT(*) AS count FROM qa_record_cases WHERE batch_key=?',[batchKey]))[0][0].count).toBe(400);
        expect((await request(app).post('/api/cart/predict').set('Authorization',`Bearer ${token}`).send({ incident_type:'Theft',time:'22:00',day:'Saturday',repeated:'invalid count' })).status).toBe(400);
    });
    test('record form source filters still work against the generated dataset',async()=>{
        for(const formType of ['crime','blotter']){
            const response=await request(app).get('/api/incidents?limit=200&form_type='+formType).set('Authorization',`Bearer ${token}`);
            expect(response.status).toBe(200);
            expect(response.body.total).toBe(175);
            expect(response.body.incidents.every(row=>row.form_type===formType)).toBe(true);
        }
    });
});
