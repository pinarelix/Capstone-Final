// Safe, explicit reset for the throwaway integration database only.
// Usage: npm run db:reset:test
// The command refuses production-looking database names and creates a dump
// before deleting operational records. It never runs during application boot.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const mysql = require('mysql2/promise');
const { findBinary } = require('../tests/mysqlBin');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dbName = process.env.TEST_DB_NAME || 'brgydata_test';
const host = process.env.DB_HOST || 'localhost';
const port = process.env.DB_PORT || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';

function assertSafeTarget() {
    if (!/^brgydata_test(?:_[a-z0-9_-]+)?$/i.test(dbName) || !['localhost', '127.0.0.1', '::1'].includes(host)) {
        throw new Error(`Refusing reset: ${dbName}@${host} is not an approved local test database.`);
    }
}

async function countRows(conn) {
    const tables = ['record_registry', 'blotter_records', 'incident_records', 'patrol_schedules', 'patrol_logs', 'tanods', 'patrol_teams'];
    const result = {};
    for (const table of tables) {
        try { const [rows] = await conn.query(`SELECT COUNT(*) AS count FROM \`${table}\``); result[table] = Number(rows[0].count); }
        catch { result[table] = 0; }
    }
    return result;
}

async function main() {
    assertSafeTarget();
    const dumpDir = path.join(__dirname, '..', '..', 'database', 'backups', 'test-resets');
    fs.mkdirSync(dumpDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dump = path.join(dumpDir, `${dbName}-${stamp}.sql`);
    const env = { ...process.env, MYSQL_PWD: password };
    const mysqldump = findBinary('mysqldump');
    execSync(`"${mysqldump}" --single-transaction --routines --triggers -h ${host} -P ${port} -u ${user} ${dbName} > "${dump}"`, { shell: true, env, stdio: 'inherit' });
    const conn = await mysql.createConnection({ host, port, user, password, database: dbName, multipleStatements: true });
    try {
        const before = await countRows(conn);
        await conn.beginTransaction();
        for (const table of ['patrol_logs', 'patrol_schedule_team_snapshots', 'patrol_schedule_tanods', 'patrol_schedule_records', 'patrol_schedules', 'patrol_schedule_series', 'patrol_team_tanods', 'patrol_teams', 'tanods', 'record_patrol_details', 'cart_risk_factors', 'record_registry', 'blotter_records', 'incident_records']) {
            try { await conn.query(`DELETE FROM \`${table}\``); } catch (error) { if (!['ER_NO_SUCH_TABLE', 'ER_VIEW_INVALID'].includes(error.code)) throw error; }
        }
        await conn.commit();
        const after = await countRows(conn);
        console.log(JSON.stringify({ database: dbName, backup: dump, before, after }, null, 2));
    } catch (error) { await conn.rollback(); throw error; }
    finally { await conn.end(); }
}

main().catch(error => { console.error(`Test database reset failed: ${error.message}`); process.exit(1); });
