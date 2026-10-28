// Clear prototype patrol operations while preserving saved teams, team rosters,
// incident records, CART data, and audit history.
// Usage: PATROL_RESET_CONFIRM=YES node backend/scripts/reset-patrol-operations.js
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dbName = process.env.DB_NAME || 'brgydata';
const host = process.env.DB_HOST || 'localhost';
const port = Number(process.env.DB_PORT || 3306);
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';

const operationalTables = [
    'patrol_route_log_attendance', 'patrol_route_logs', 'patrol_route_deployments',
    'patrol_route_stops', 'patrol_routes',
    'patrol_log_attendance', 'patrol_schedule_personnel_snapshots', 'patrol_schedule_personnel',
    'patrol_schedule_route_stops', 'patrol_schedule_routes', 'patrol_schedule_source_records',
    'patrol_logs', 'patrol_schedule_team_snapshots', 'patrol_schedule_tanods',
    'patrol_schedule_records', 'patrol_schedules', 'patrol_schedule_series'
];

function assertConfirmed() {
    if (process.env.PATROL_RESET_CONFIRM !== 'YES') {
        throw new Error('Refusing reset. Set PATROL_RESET_CONFIRM=YES to confirm the operational patrol wipe.');
    }
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
        throw new Error(`Refusing reset against non-local database host: ${host}`);
    }
}

async function tableCount(conn, table) {
    try {
        const [rows] = await conn.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
        return Number(rows[0].count);
    } catch (error) {
        if (['ER_NO_SUCH_TABLE', 'ER_VIEW_INVALID'].includes(error.code)) return null;
        throw error;
    }
}

async function main() {
    assertConfirmed();
    const conn = await mysql.createConnection({ host, port, user, password, database: dbName });
    try {
        const before = {};
        for (const table of operationalTables) before[table] = await tableCount(conn, table);
        await conn.beginTransaction();
        for (const table of operationalTables) {
            if (before[table] !== null) await conn.query(`DELETE FROM \`${table}\``);
        }
        await conn.commit();
        const after = {};
        for (const table of operationalTables) after[table] = await tableCount(conn, table);
        console.log(JSON.stringify({ database: dbName, preserved: ['patrol_teams', 'patrol_team_tanods', 'patrol_team_assignments', 'tanods', 'patrol_volunteers', 'record_registry', 'incident_records', 'blotter_records', 'cart_risk_factors'], before, after }, null, 2));
    } catch (error) {
        await conn.rollback().catch(() => {});
        throw error;
    } finally {
        await conn.end();
    }
}

main().catch(error => { console.error(`Patrol operation reset failed: ${error.message}`); process.exit(1); });
