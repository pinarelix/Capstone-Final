// Import the synthetic personnel/team fixture into an isolated test DB only.
// Usage: node scripts/import-patrol-fixture.js path/to/Barangay179_Patrol_Test_Fixture.json
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dbName = process.env.TEST_DB_NAME || 'brgydata_test';
const host = process.env.DB_HOST || 'localhost';
if (!/^brgydata_test(?:_[a-z0-9_-]+)?$/i.test(dbName) || !['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing fixture import into ${dbName}@${host}; use a local brgydata_test database.`);
}
const fixturePath = process.argv[2];
if (!fixturePath) throw new Error('Fixture path is required.');
const fixture = JSON.parse(fs.readFileSync(path.resolve(fixturePath), 'utf8'));

function list(...keys) {
    for (const key of keys) if (Array.isArray(fixture[key])) return fixture[key];
    return [];
}

async function main() {
    const conn = await mysql.createConnection({ host, port: process.env.DB_PORT || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: dbName });
    const tanods = list('tanods').concat(list('personnel').filter(person => String(person.type || person.person_type || 'Tanod').toLowerCase() === 'tanod'));
    const volunteers = list('volunteers').concat(list('personnel').filter(person => String(person.type || person.person_type || '').toLowerCase() === 'volunteer'));
    const teamRows = list('teams', 'patrol_teams');
    const ids = { tanods: [], volunteers: [], teams: [] };
    try {
        for (const person of tanods) {
            const [result] = await conn.query('INSERT INTO tanods (name, contact_no, address, birth_date) VALUES (?, ?, ?, ?)', [person.name, person.contact_no || person.contact || '', person.address || '', person.birth_date || person.birthDate || null]);
            ids.tanods.push(result.insertId);
        }
        for (const person of volunteers) {
            const [result] = await conn.query('INSERT INTO patrol_volunteers (name, contact_no, address, birth_date) VALUES (?, ?, ?, ?)', [person.name, person.contact_no || person.contact || '', person.address || '', person.birth_date || person.birthDate || null]);
            ids.volunteers.push(result.insertId);
        }
        for (const team of teamRows) {
            const leader = team.leader_user_id || team.leaderUserId || null;
            const [result] = await conn.query('INSERT INTO patrol_teams (name, leader_user_id) VALUES (?, ?)', [team.name, leader]);
            ids.teams.push(result.insertId);
            for (const member of team.members || team.personnel || []) {
                const type = String(member.person_type || member.type || 'Tanod').toLowerCase() === 'volunteer' ? 'Volunteer' : 'Tanod';
                const sourceId = Number(member.person_id || member.id);
                const mappedId = type === 'Volunteer' ? ids.volunteers[sourceId - 1] || sourceId : ids.tanods[sourceId - 1] || sourceId;
                await conn.query('INSERT INTO patrol_team_assignments (team_id, person_type, person_id, assignment_type, starts_on, ends_on) VALUES (?, ?, ?, ?, ?, ?)', [result.insertId, type, mappedId, member.assignment_type || 'Primary', member.starts_on || null, member.ends_on || null]);
                if (type === 'Tanod' && (member.assignment_type || 'Primary') === 'Primary') await conn.query('UPDATE tanods SET primary_team_id=? WHERE id=?', [result.insertId, mappedId]);
            }
        }
        console.log(JSON.stringify({ database: dbName, imported: { tanods: ids.tanods.length, volunteers: ids.volunteers.length, teams: ids.teams.length } }, null, 2));
    } finally { await conn.end(); }
}
main().catch(error => { console.error(`Fixture import failed: ${error.message}`); process.exit(1); });
