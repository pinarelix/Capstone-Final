const { INCIDENT_TYPES, BLOTTER_TYPES } = require('../recordTypes');
const { contains } = require('../../frontend/barangay-boundary');
const { referenceAssessment } = require('./cart-reference');

function makeRng(seed) {
    let state = seed >>> 0;
    return () => {
        state |= 0; state = (state + 0x6D2B79F5) | 0;
        let n = Math.imul(state ^ state >>> 15, 1 | state);
        n = (n + Math.imul(n ^ n >>> 7, 61 | n)) ^ n;
        return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
}
function dateBefore(baseDate, days) {
    const date = new Date(baseDate + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0,10);
}
function dayMeta(day) {
    const index = new Date(day + 'T12:00:00Z').getUTCDay();
    return { day_of_week: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][index], is_weekend: index === 0 || index === 6 ? 1 : 0 };
}
function timeBucket(time) {
    const hour = Number(time.slice(0,2));
    return hour >= 6 && hour < 12 ? 'Morning' : hour >= 12 && hour < 18 ? 'Afternoon' : hour >= 18 && hour < 22 ? 'Evening' : 'Night';
}

function buildPlan({ streets, baseDate, seed = 179, incidents = 200, blotters = 200 }) {
    if (streets.length < 20) throw new Error('At least 20 mapped streets are required for isolated factor buckets.');
    const rng = makeRng(seed), pick = items => items[Math.floor(rng() * items.length)];
    const good = streets.filter(street => contains(street.latitude, street.longitude));
    if (good.length < 22) throw new Error('At least 22 street pins must be inside Barangay 179.');
    const plan = [];
    const reserved = new Set(good.slice(10,22).map(street => street.location));
    const general = good.filter(street => !reserved.has(street.location));
    function jitter(street) {
        for (let attempt=0; attempt<30; attempt++) {
            const latitude = Number(street.latitude) + (rng()-.5)*.0008;
            const longitude = Number(street.longitude) + (rng()-.5)*.0008;
            if (contains(latitude, longitude)) return { latitude: Number(latitude.toFixed(8)), longitude: Number(longitude.toFixed(8)) };
        }
        return { latitude: Number(street.latitude), longitude: Number(street.longitude) };
    }
    for (const [cls, types, target, offset] of [['incident',INCIDENT_TYPES,incidents,0],['blotter',BLOTTER_TYPES,blotters,5]]) {
        const own = [];
        function add(scenario, options = {}) {
            const n = own.length + 1;
            const street = options.street || pick(general);
            const date = options.date || dateBefore(baseDate, options.daysAgo ?? Math.floor(rng()*180));
            const type = options.type || pick(types).name;
            const time = options.time || pick(['09:00','14:00','19:00','23:00']);
            const severity = options.severity || pick(['Low','Medium','High']);
            const address = `QA ONLY - Blk ${1+n%20}, Lot ${1+n%30}, House No. ${n}${n%4===0 ? ', Unit 2-A' : ''}, ${street.location}`;
            const row = {
                cls, case_id: `${cls}-${String(n).padStart(3,'0')}`, scenario,
                incident_type: type, date, time, time_of_day: timeBucket(time), ...dayMeta(date),
                street_name: street.location, ...jitter(street), severity,
                priority: severity === 'High' ? 'Urgent' : 'Normal', status: 'Open', is_draft: 0,
                patrol_override: 'auto', patrol_notes: '', address,
                addr_block: String(1+n%20), addr_lot: String(1+n%30), addr_house_no: String(n),
                addr_street: street.location, addr_unit: n%4===0 ? '2-A' : null,
                complainant_first: n%13===0 ? 'QA Niño' : 'QA Resident',
                complainant_last: n%13===0 ? "O'Brien-Peña" : `Fixture ${n}`,
                respondent_first: 'QA Respondent', respondent_last: `Fixture ${n}`,
                reporter_first: 'QA Reporter', reporter_last: `Fixture ${n}`,
                description: `SYNTHETIC QA ONLY | ${scenario} | ${cls}-${String(n).padStart(3,'0')} | Fictional event and people; not an actual complaint.`,
                no_evidence: 1, no_evidence_reason: 'Synthetic QA fixture; no actual evidence.',
                ...options
            };
            delete row.street; delete row.daysAgo;
            own.push(row); return row;
        }
        // Every approved catalog type, including types excluded from patrol.
        types.forEach(type => add('catalog-coverage', { type: type.name }));
        // Full factorial, per source: 3 severities x 4 time buckets x 2 day types.
        for (const severity of ['Low','Medium','High']) for (const time of ['09:00','14:00','19:00','23:00']) for (const weekend of [0,1]) {
            let age = 1; while (dayMeta(dateBefore(baseDate, age)).is_weekend !== weekend) age++;
            add('factorial-grid', { severity, time, daysAgo: age, street: good[offset] });
        }
        // Isolated streets produce exact location totals 1,2,3,4,5 and zero
        // recent counts. Filler records must never use these reserved streets.
        for (let count=1; count<=5; count++) for (let n=0; n<count; n++) add(`history-count-${count}`, {
            street: good[10+offset+count-1], daysAgo: 100+n, severity: 'Low', time: '09:00',
            type: cls === 'incident' ? 'Theft' : 'Vandalism'
        });
        for (const daysAgo of [0,1,29,30,31,89,90,91,180,365]) add('recency-boundary', { daysAgo, street: good[2+offset] });
        for (const time of ['00:00','05:59','06:00','11:59','12:00','17:59','18:00','21:59','22:00','23:59']) add('time-boundary', { time });
        // Nearby pairs test overlap and the 100-metre recurrence boundary.
        const conditional = cls === 'incident' ? 'Physical Injury' : 'Noise Complaint';
        for (const [label,lat,lng,gap] of [
            ['same-pin',14.751,121.070,0],['within-100m',14.752,121.076,.00085],
            ['outside-100m',14.745,121.069,.00095],['same-street-distant',14.749,121.079,.003]
        ]) for (let n=0;n<2;n++) add(label, { type: conditional, severity: 'Low', time: '09:00', daysAgo: 2+n,
            street: good[3+offset], latitude: lat+n*gap, longitude: lng });
        const routine = cls === 'incident' ? 'Theft' : 'Vandalism';
        const excluded = cls === 'incident' ? 'Falsification of Documents' : 'Scam';
        const override = cls === 'incident' ? 'VAWC' : 'Act of Lasciviousness';
        const review = cls === 'incident' ? 'Reckless Impudence Resulting Physical Injury' : 'Occupation of Real Property or Usurpation of Removal, Sale or Pledge of Mortgaged Property';
        for (const [scenario,type,patrol_override,severity,time] of [
            ['manual-exclude',routine,'exclude','High','23:00'],['routine-auto',routine,'auto','Low','09:00'],
            ['manual-include',excluded,'include','High','23:00'],['no-patrol-high',excluded,'auto','High','23:00'],
            ['severity-override-high',override,'auto','High','23:00'],['severity-override-low',override,'auto','Low','09:00'],
            ['review-auto',review,'auto','Medium','14:00'],['review-manual',review,'include','Medium','14:00']
        ]) add(scenario, { type, patrol_override, severity, time, street: good[offset], daysAgo: 1 });
        for(let n=0;n<20;n++) add('resolved-history', { status: 'Resolved', daysAgo: 40+n });
        for(let n=0;n<5;n++) add('draft-excluded', { is_draft: 1, daysAgo: n });
        for(let n=0;n<3;n++) add('missing-location-excluded', { latitude: null, longitude: null, street_name: null, daysAgo: 7 });
        for(let n=0;n<2;n++) add('outside-boundary-excluded', { latitude: 14.765+n*.001, longitude: 121.090, daysAgo: 7 });
        for(const notes of ['', 'N'.repeat(199), 'N'.repeat(200), "Gate near O'Brien-Peña residence.",
            "QA literal text: '); DROP TABLE users; --", 'Observe gate.\nReport access issues.', 'QA welfare check; coordinate support.', 'QA repeat-location follow-up.']) add('notes-validation', { patrol_notes: notes });
        for (const band of ['moderate','high']) for (const side of ['below','above']) add(`threshold-${band}-${side}`, {
            street: band==='moderate' ? good[20+(cls==='incident' ? 0 : 1)] : good[offset],
            daysAgo: band==='moderate' ? 100 : 1, patrol_override: 'include'
        });
        if (own.length > target) throw new Error(`${cls} minimum scenario coverage requires ${own.length} records; requested ${target}.`);
        while (own.length < target) add('background-history');
        plan.push(...own);
    }
    return plan;
}
function tuneThresholdProbes(plan, model, typeScores, existingCounts, asOf) {
    const cutoff = dateBefore(asOf,30);
    const counts = new Map(existingCounts.map(row=>[row.street_name,{ total:Number(row.total),recent:Number(row.recent) }]));
    for (const row of plan.filter(row=>!row.is_draft && row.street_name)) {
        const value = counts.get(row.street_name) || { total:0,recent:0 };
        value.total++; if(row.date>=cutoff && row.date<=asOf)value.recent++;
        counts.set(row.street_name,value);
    }
    for(const row of plan.filter(row=>row.scenario.startsWith('threshold-'))) {
        const [,band,side] = row.scenario.split('-');
        const threshold = band==='high' ? model.thresholds.level3 : model.thresholds.level2;
        const types = row.cls==='incident' ? INCIDENT_TYPES : BLOTTER_TYPES;
        let best;
        for(const type of types)for(const severity of ['Low','Medium','High'])for(const time of ['09:00','14:00','19:00','23:00'])for(const weekend of [0,1]) {
            let age = band==='moderate' ? 100 : 1;
            while(dayMeta(dateBefore(asOf,age)).is_weekend!==weekend)age++;
            const date=dateBefore(asOf,age);
            const candidate={...row,incident_type:type.name,severity,time,time_of_day:timeBucket(time),date,...dayMeta(date)};
            const score=referenceAssessment(candidate,counts.get(row.street_name)||{},model,typeScores[type.name]??30).total;
            if((side==='below' ? score<threshold : score>=threshold) && (!best || Math.abs(score-threshold)<best.distance)) best={candidate,distance:Math.abs(score-threshold)};
        }
        if(!best)throw new Error(`Cannot construct ${row.cls} ${row.scenario} under the current CART configuration without fabricating a score.`);
        Object.assign(row,best.candidate);
    }
    return plan;
}
module.exports = { buildPlan, tuneThresholdProbes, dateBefore, dayMeta, timeBucket };
