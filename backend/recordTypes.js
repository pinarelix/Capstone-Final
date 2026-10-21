/**
 * Record type catalog — the approved Blotter and Incident type lists with the
 * acronym used in the public record number ({INC|BLT}-{ACRONYM}-{NNNN}) and
 * shown next to the type name in the searchable dropdown.
 *
 * Single source of truth: the generator, the backend catalog endpoint /
 * validation, and (via that endpoint) the frontend dropdown all read this.
 *
 * `class`:  'incident' -> incident_records (INC-...),
 *           'blotter'  -> blotter_records  (BLT-...).
 * Both lists end with the shared "Others" exception type (code O).
 */

// Incident (urgent / violent-crime) catalog. Codes HMC..QTD were supplied by
// the project owner; the rest were filled to match and approved.
const INCIDENT_TYPES = [
    { name: 'Homicide', code: 'HMC' },
    { name: 'Attempted Murder', code: 'AM' },
    { name: 'Kidnapping', code: 'KDP' },
    { name: 'Child Abuse', code: 'CA' },
    { name: 'VAWC', code: 'VAWC' },
    { name: 'Illegal Release of Fire Arms', code: 'IRFA' },
    { name: 'Attempted Arson', code: 'AA' },
    { name: 'Robbery', code: 'R' },
    { name: 'Grave Threat', code: 'GT' },
    { name: 'Physical Injury', code: 'PI' },
    { name: 'Falsification of Documents', code: 'FD' },
    { name: 'Arson', code: 'AR' },
    { name: 'Theft', code: 'T' },
    { name: 'Fencing of Stolen Properties', code: 'FSP' },
    { name: 'Qualified Trespass to Dwelling', code: 'QTD' },
    { name: 'Altering Boundaries of Landmarks', code: 'ABL' },
    { name: 'Hit and Run', code: 'HR' },
    { name: 'Reckless Impudence Resulting to Damage to Property and Physical Injury', code: 'RIDPPI' },
    { name: 'Reckless Impudence Resulting Physical Injury', code: 'RIPI' },
    { name: 'Reckless Impudence Resulting to Damage to Property', code: 'RIDP' },
    { name: 'Abandoning a Minor', code: 'ABM' },
    { name: 'Abandonment of a Person in Danger', code: 'APD' },
    { name: 'Curfew Violation', code: 'CV' },
    { name: 'Abandon', code: 'ABN' },
    { name: 'Missing', code: 'MIS' },
    { name: 'Suicide', code: 'SCD' },
    { name: 'Others', code: 'O' },
];

// Blotter (non-urgent) catalog. "Crime Type" from the source list was a stray
// placeholder and is intentionally omitted. "Breach of Contract" and "Breach
// Contact" are kept as distinct labels on purpose.
const BLOTTER_TYPES = [
    { name: 'Act of Lasciviousness', code: 'AOL' },
    { name: 'Slight Physical Injuries and Maltreatment', code: 'SPIM' },
    { name: 'Light Threats', code: 'LT' },
    { name: 'Less Serious Physical Injuries', code: 'LSPI' },
    { name: 'Occupation of Real Property or Usurpation of Removal, Sale or Pledge of Mortgaged Property', code: 'ORP' },
    { name: 'Vandalism', code: 'V' },
    { name: 'Trespassing', code: 'TRP' },
    { name: 'Threats', code: 'THR' },
    { name: 'Scam', code: 'SCM' },
    { name: 'Swindling of Estafa', code: 'SOE' },
    { name: 'Estafa', code: 'EST' },
    { name: 'Cybercrime Prevention Act 2012 (RA 10175)', code: 'CPA' },
    { name: 'Estafa/Debts', code: 'ESD' },
    { name: 'Cyber Bullying', code: 'CB' },
    { name: 'Voyeurism Act', code: 'VA' },
    { name: 'Alarms and Scandals', code: 'AS' },
    { name: 'Incriminating Innocent Persons', code: 'IIP' },
    { name: 'Threatening to Publish and offer to prevent', code: 'TPP' },
    { name: 'Oral Defamation', code: 'OD' },
    { name: 'Harassment', code: 'HRS' },
    { name: 'Intriguing Against Honor', code: 'IAH' },
    { name: 'Unlawful Use of Means of Publication and Unlawful Utterances', code: 'UMP' },
    { name: 'Prohibiting Publication of Acts Referred to in the Proceedings', code: 'PPA' },
    { name: 'BCPC', code: 'BCPC' },
    { name: 'Child Support', code: 'CS' },
    { name: 'Noise Complaint', code: 'NC' },
    { name: 'Anti Electricity Pilferage', code: 'AEP' },
    { name: 'Safe Special Act', code: 'SSA' },
    { name: 'Bastos Law', code: 'BL' },
    { name: 'Inducing a Minor to Abandon His/her Home', code: 'IMA' },
    { name: 'Animal Welfare Acts', code: 'AWA' },
    { name: 'Suspicious Activity', code: 'SA' },
    { name: 'Traffic Obstruction', code: 'TO' },
    { name: 'Breach of Contract', code: 'BOC' },
    { name: 'Breach Contact', code: 'BC' },
    { name: 'Others', code: 'O' },
];

const CATALOG = [
    ...INCIDENT_TYPES.map(t => ({ ...t, class: 'incident' })),
    ...BLOTTER_TYPES.map(t => ({ ...t, class: 'blotter' })),
];

function codeFor(recordClass, typeName) {
    const list = recordClass === 'incident' ? INCIDENT_TYPES : BLOTTER_TYPES;
    const hit = list.find(t => t.name.toLowerCase() === String(typeName || '').toLowerCase());
    return hit ? hit.code : 'O'; // unknown type falls back to the Others code
}

module.exports = { INCIDENT_TYPES, BLOTTER_TYPES, CATALOG, codeFor };
