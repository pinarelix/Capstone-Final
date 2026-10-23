// Policy supplied in patrol-prioritization.md. These are decision-support
// rules, not estimates of crime probability or automatic dispatch orders.
const TIER_1 = new Set([
    'Homicide', 'Attempted Murder', 'Robbery', 'Arson', 'Attempted Arson',
    'Illegal Release of Fire Arms', 'Kidnapping', 'Theft', 'Qualified Trespass to Dwelling',
    'Trespassing', 'Vandalism', 'Hit and Run', 'Suspicious Activity', 'Curfew Violation', 'Alarms and Scandals'
]);
const TIER_2 = new Set([
    'Physical Injury', 'Less Serious Physical Injuries', 'Slight Physical Injuries and Maltreatment',
    'Grave Threat', 'Noise Complaint', 'Traffic Obstruction', 'Anti Electricity Pilferage',
    'Altering Boundaries of Landmarks', 'Missing', 'Abandonment of a Person in Danger'
]);
const OVERRIDE = new Set([
    'VAWC', 'Child Abuse', 'Grave Threat', 'Threats', 'Harassment', 'Act of Lasciviousness',
    'Voyeurism Act', 'Suicide', 'Abandoning a Minor', 'Inducing a Minor to Abandon His/her Home',
    'Abandon', 'BCPC', 'Light Threats', 'Oral Defamation'
]);
const NO_PATROL = new Set([
    'Falsification of Documents', 'Scam', 'Swindling of Estafa', 'Estafa', 'Estafa/Debts',
    'Fencing of Stolen Properties', 'Breach of Contract', 'Breach Contact', 'Child Support',
    'Cybercrime Prevention Act 2012 (RA 10175)', 'Cyber Bullying', 'Intriguing Against Honor',
    'Unlawful Use of Means of Publication and Unlawful Utterances',
    'Prohibiting Publication of Acts Referred to in the Proceedings', 'Incriminating Innocent Persons',
    'Threatening to Publish and offer to prevent', 'Safe Special Act', 'Bastos Law', 'Animal Welfare Acts', 'Others'
]);

function distanceMeters(a, b) {
    const rad = n => Number(n) * Math.PI / 180;
    const dLat = rad(b.latitude) - rad(a.latitude);
    const dLng = rad(b.longitude) - rad(a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function validCoordinates(row) {
    return row.latitude != null && row.longitude != null
        && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))
        && Math.abs(Number(row.latitude)) <= 90 && Math.abs(Number(row.longitude)) <= 180;
}

function patrolDecision(row, { level3 = 67 } = {}, nearbyCount = 1) {
    const inactive = Number(row.is_draft) === 1 || String(row.status).trim() === 'Resolved';
    if (inactive || !validCoordinates(row)) return { eligible: false, policy_class: 'INACTIVE', reason: 'Inactive record or missing location' };
    if (row.patrol_override === 'exclude') return { eligible: false, policy_class: 'MANUAL', reason: 'Marked no patrol required' };
    if (row.patrol_override === 'include') return { eligible: true, policy_class: 'MANUAL', reason: 'Executive Officer manual inclusion' };
    const high = Number.isFinite(Number(row.cart_score)) && row.cart_score != null && Number(row.cart_score) >= level3;
    if (TIER_1.has(row.incident_type)) return { eligible: true, policy_class: 'TIER_1', reason: 'Location-based patrol type' };
    if (TIER_2.has(row.incident_type)) return {
        eligible: high || nearbyCount >= 2,
        policy_class: 'TIER_2',
        reason: high ? 'High CART risk' : nearbyCount >= 2 ? 'Repeated nearby incidents within 30 days' : 'Requires recurrence or High CART risk'
    };
    if (OVERRIDE.has(row.incident_type)) return { eligible: high, policy_class: 'SEVERITY_OVERRIDE', reason: high ? 'High CART risk override; coordinate specialist support' : 'Requires High CART risk' };
    if (NO_PATROL.has(row.incident_type)) return { eligible: false, policy_class: 'NO_PATROL', reason: 'Investigation, mediation, or referral' };
    // The catalog combines a location occupation offense and mortgaged-property
    // offense into one name. Do not silently auto-approve that ambiguous type.
    return { eligible: false, policy_class: 'UNCLASSIFIED', reason: 'Executive Officer review required' };
}

module.exports = { patrolDecision, distanceMeters, validCoordinates };
