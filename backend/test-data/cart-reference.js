// Independent arithmetic based on the documented model. The type lookup is
// approved reference data; this module does not call cartEngine.analyze().
async function readModelConfiguration(db) {
    const [rows] = await db.query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key LIKE 'cart_%' OR setting_key LIKE 'default_danger_threshold%'");
    const settings = Object.fromEntries(rows.map(row => [row.setting_key,row.setting_value]));
    const number = (key, fallback) => Number.isFinite(parseFloat(settings[key])) ? parseFloat(settings[key]) : fallback;
    return {
        weights: { time: number('cart_weight_time',25)/100, day: number('cart_weight_day',15)/100,
            type: number('cart_weight_type',30)/100, location: number('cart_weight_location',20)/100, frequency: number('cart_weight_frequency',10)/100 },
        thresholds: { level3: number('default_danger_threshold_high',67), level2: number('default_danger_threshold_moderate',34) },
        sourceWeights: { incident: number('cart_source_weight_incident',1), blotter: number('cart_source_weight_blotter',.85) }
    };
}
function referenceAssessment(row, counts, config, typeRaw) {
    const n = counts.total || 0, recent = counts.recent || 0;
    const scores = { type: typeRaw, time: { Morning:20,Afternoon:40,Evening:70,Night:90 }[row.time_of_day] ?? 20,
        day: Number(row.is_weekend) ? 70 : 40,
        location: n>=5 ? 90 : n>=3 ? 70 : n>=2 ? 50 : n>=1 ? 30 : 10,
        frequency: recent>=5 ? 95 : recent>=3 ? 75 : recent>=2 ? 50 : recent>=1 ? 25 : 5 };
    const typeWeight = row.severity === 'High' ? .3 : row.severity === 'Medium' ? .2 : .1;
    const others = ['time','day','location','frequency'];
    const denominator = others.reduce((sum,key) => sum+config.weights[key],0);
    let raw = scores.type * typeWeight;
    for (const key of others) raw += scores[key]*(1-typeWeight)*config.weights[key]/denominator;
    const source = row.form_type === 'crime' || row.cls === 'incident' || row.source === 'incident' ? 'incident' : 'blotter';
    // Round decimal digits directly so the independent oracle is not subject
    // to the same binary half-cent multiplication problem as the engine.
    const [whole,fraction] = (raw*config.sourceWeights[source]).toFixed(8).split('.');
    const cents = Number(whole)*100+Number(fraction.slice(0,2))+(fraction[2]>='5' ? 1 : 0);
    const total = cents/100;
    return { scores, total, level: total>=config.thresholds.level3 ? 'Level 3' : total>=config.thresholds.level2 ? 'Level 2' : 'Level 1' };
}
module.exports = { readModelConfiguration, referenceAssessment };
