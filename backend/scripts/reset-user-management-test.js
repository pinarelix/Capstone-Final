// Guarded reset for the User Management test state only.
//
// Default behavior is a read-only count report. To execute the reset, the
// operator must explicitly pass:
//   npm run db:reset:user-management:test -- --confirm-user-management-reset
//
// This command is intentionally narrower than reset-test-database.js. It
// never deletes users, personnel, teams, schedules, patrol logs, audits, or
// system configuration. Disposable records are archived/deactivated so
// historical foreign-key relationships remain valid.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const { findBinary } = require('../tests/mysqlBin');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dbName = process.env.TEST_DB_NAME || 'brgydata_test';
const host = process.env.DB_HOST || 'localhost';
const port = Number(process.env.DB_PORT || 3306);
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const confirmed = process.argv.includes('--confirm-user-management-reset');

function assertSafeTarget() {
    if (!/^brgydata_test(?:_[a-z0-9_-]+)?$/i.test(dbName) || !['localhost', '127.0.0.1', '::1'].includes(host)) {
        throw new Error(`Refusing reset: ${dbName}@${host} is not an approved local test database.`);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Refusing reset: invalid local database port "${port}".`);
    }
}

async function hasTable(conn, table) {
    const [rows] = await conn.query(
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
        [table]
    );
    return rows.length > 0;
}

async function scalar(conn, sql, params = []) {
    const [rows] = await conn.query(sql, params);
    return Number(rows[0]?.value || 0);
}

async function countIfPresent(conn, table, where = '') {
    if (!(await hasTable(conn, table))) return 0;
    return scalar(conn, `SELECT COUNT(*) AS value FROM \`${table}\` ${where}`);
}

async function readState(conn) {
    const activeUsers = await scalar(conn, 'SELECT COUNT(*) AS value FROM users WHERE is_active = 1');
    const activeExecutives = await scalar(conn, "SELECT COUNT(*) AS value FROM users WHERE is_active = 1 AND role = 'Executive Officer'");
    const activeAdditionalUsers = await scalar(conn, "SELECT COUNT(*) AS value FROM users WHERE is_active = 1 AND role <> 'Executive Officer'");
    const activeTeamLeaders = await scalar(conn, "SELECT COUNT(*) AS value FROM users WHERE is_active = 1 AND role = 'Team Leader'");
    const activeTanods = await countIfPresent(conn, 'tanods', 'WHERE is_active = 1');
    const activeVolunteers = await countIfPresent(conn, 'patrol_volunteers', 'WHERE is_active = 1');
    const activeTeams = await countIfPresent(conn, 'patrol_teams', 'WHERE is_active = 1');
    const activeLegacyMemberships = await countIfPresent(conn, 'patrol_team_tanods', 'WHERE is_active = 1');
    const activeAssignments = await countIfPresent(conn, 'patrol_team_assignments', 'WHERE is_active = 1');

    return {
        active_accounts: activeUsers,
        active_executive_officers: activeExecutives,
        active_additional_users: activeAdditionalUsers,
        active_team_leader_accounts: activeTeamLeaders,
        active_tanods: activeTanods,
        active_volunteers: activeVolunteers,
        active_patrol_teams: activeTeams,
        active_legacy_team_memberships: activeLegacyMemberships,
        active_team_assignments: activeAssignments,
        historical_patrol_logs: await countIfPresent(conn, 'patrol_logs'),
        historical_patrol_schedules: await countIfPresent(conn, 'patrol_schedules'),
        audit_trails: await countIfPresent(conn, 'audit_logs'),
        system_configuration: await countIfPresent(conn, 'system_settings')
    };
}

async function createBackup() {
    const backupDir = path.join(__dirname, '..', '..', 'database', 'backups', 'test-user-management-resets');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `${dbName}-${stamp}.sql`);
    const dumpFile = fs.openSync(backupPath, 'w');
    try {
        const mysqldump = findBinary('mysqldump');
        execFileSync(mysqldump, [
            '--single-transaction', '--routines', '--triggers',
            '-h', host, '-P', String(port), '-u', user, dbName
        ], {
            env: { ...process.env, MYSQL_PWD: password },
            stdio: ['ignore', dumpFile, 'inherit']
        });
    } finally {
        fs.closeSync(dumpFile);
    }
    return backupPath;
}

async function findBootstrapAccount(conn) {
    const [rows] = await conn.query(`
        SELECT id, username, role, password_hash, is_active
        FROM users
        WHERE is_active = 1 AND role IN ('Executive Officer', 'Deputy Officer')
        ORDER BY (username = 'admin') DESC, (role = 'Executive Officer') DESC, id
        LIMIT 1
    `);
    if (!rows.length) {
        throw new Error('No active Executive Officer bootstrap account was found. Reset aborted; no records were changed.');
    }
    return rows[0];
}

async function updateIfPresent(conn, table, sql, params = []) {
    if (await hasTable(conn, table)) await conn.query(sql, params);
}

async function findBrokenActiveReferences(conn) {
    const result = {};
    if (await hasTable(conn, 'patrol_team_tanods')) {
        result.legacy_team_memberships = await scalar(conn, `
            SELECT COUNT(*) AS value
            FROM patrol_team_tanods m
            LEFT JOIN patrol_teams t ON t.id = m.team_id
            LEFT JOIN tanods p ON p.id = m.tanod_id
            WHERE m.is_active = 1 AND (t.id IS NULL OR p.id IS NULL OR t.is_active = 0 OR p.is_active = 0)
        `);
    } else result.legacy_team_memberships = 0;
    if (await hasTable(conn, 'patrol_team_assignments')) {
        result.team_assignments = await scalar(conn, `
            SELECT COUNT(*) AS value
            FROM patrol_team_assignments a
            LEFT JOIN patrol_teams t ON t.id = a.team_id
            LEFT JOIN tanods p ON a.person_type = 'Tanod' AND p.id = a.person_id
            LEFT JOIN patrol_volunteers v ON a.person_type = 'Volunteer' AND v.id = a.person_id
            WHERE a.is_active = 1 AND (t.id IS NULL OR t.is_active = 0 OR (a.person_type = 'Tanod' AND p.id IS NULL) OR (a.person_type = 'Volunteer' AND v.id IS NULL))
        `);
    } else result.team_assignments = 0;
    if (await hasTable(conn, 'patrol_logs')) {
        result.patrol_logs = await scalar(conn, `
            SELECT COUNT(*) AS value
            FROM patrol_logs l
            LEFT JOIN patrol_schedules s ON s.id = l.schedule_id
            WHERE l.schedule_id IS NOT NULL AND s.id IS NULL
        `);
    } else result.patrol_logs = 0;
    return result;
}

function assertResult(before, after, keeper, keeperAfter, broken) {
    const failures = [];
    if (after.active_accounts !== 1) failures.push(`expected 1 active account, found ${after.active_accounts}`);
    if (after.active_executive_officers !== 1) failures.push(`expected 1 active Executive Officer, found ${after.active_executive_officers}`);
    if (after.active_additional_users !== 0) failures.push(`expected 0 additional active users, found ${after.active_additional_users}`);
    if (after.active_team_leader_accounts !== 0) failures.push(`expected 0 active Team Leader accounts, found ${after.active_team_leader_accounts}`);
    if (after.active_tanods !== 0) failures.push(`expected 0 active Tanods, found ${after.active_tanods}`);
    if (after.active_volunteers !== 0) failures.push(`expected 0 active Volunteers, found ${after.active_volunteers}`);
    if (after.active_patrol_teams !== 0) failures.push(`expected 0 active patrol teams, found ${after.active_patrol_teams}`);
    if (after.active_legacy_team_memberships !== 0) failures.push(`expected 0 active legacy team memberships, found ${after.active_legacy_team_memberships}`);
    if (after.active_team_assignments !== 0) failures.push(`expected 0 active team assignments, found ${after.active_team_assignments}`);
    for (const key of ['historical_patrol_logs', 'historical_patrol_schedules', 'audit_trails', 'system_configuration']) {
        if (before[key] !== after[key]) failures.push(`${key} changed from ${before[key]} to ${after[key]}`);
    }
    if (!keeperAfter || keeperAfter.is_active !== 1 || keeperAfter.password_hash !== keeper.password_hash) {
        failures.push('the Executive Officer bootstrap account was not preserved');
    }
    if (broken.legacy_team_memberships || broken.team_assignments || broken.patrol_logs) {
        failures.push(`broken references detected: ${JSON.stringify(broken)}`);
    }
    if (failures.length) throw new Error(`Post-reset verification failed: ${failures.join('; ')}`);
}

async function main() {
    assertSafeTarget();
    const conn = await mysql.createConnection({ host, port, user, password, database: dbName });
    let backupPath = null;
    try {
        const before = await readState(conn);
        const keeper = await findBootstrapAccount(conn);

        if (!confirmed) {
            console.log(JSON.stringify({
                database: dbName,
                mode: 'dry-run',
                message: 'No changes made. Re-run with --confirm-user-management-reset to archive disposable User Management records.',
                bootstrap_account: { id: keeper.id, username: keeper.username, role: keeper.role },
                before
            }, null, 2));
            return;
        }

        backupPath = await createBackup();
        await conn.beginTransaction();
        try {
            // Keep the selected account's password, identity, and audit links.
            // Normalize the legacy role label only; credentials are untouched.
            if (keeper.role === 'Deputy Officer') {
                await conn.query("UPDATE users SET role = 'Executive Officer' WHERE id = ?", [keeper.id]);
            }
            await conn.query('UPDATE users SET is_active = 0 WHERE is_active = 1 AND id <> ?', [keeper.id]);
            await updateIfPresent(conn, 'user_sessions', 'UPDATE user_sessions SET is_active = 0, logout_time = COALESCE(logout_time, CURRENT_TIMESTAMP) WHERE user_id <> ?', [keeper.id]);

            // Archive/deactivate disposable roster and team data. Do not
            // delete it: historical schedules, logs, snapshots, and reports
            // may still refer to the original identities.
            await updateIfPresent(conn, 'patrol_team_tanods', 'UPDATE patrol_team_tanods SET is_active = 0');
            await updateIfPresent(conn, 'patrol_team_assignments', 'UPDATE patrol_team_assignments SET is_active = 0');
            await updateIfPresent(conn, 'patrol_teams', 'UPDATE patrol_teams SET is_active = 0');
            await updateIfPresent(conn, 'tanods', 'UPDATE tanods SET is_active = 0, primary_team_id = NULL');
            await updateIfPresent(conn, 'patrol_volunteers', 'UPDATE patrol_volunteers SET is_active = 0');
            await conn.commit();
        } catch (error) {
            await conn.rollback();
            throw error;
        }

        const after = await readState(conn);
        const [keeperRows] = await conn.query('SELECT id, username, role, password_hash, is_active FROM users WHERE id = ?', [keeper.id]);
        const broken = await findBrokenActiveReferences(conn);
        assertResult(before, after, keeper, keeperRows[0], broken);
        console.log(JSON.stringify({
            database: dbName,
            mode: 'reset',
            backup: backupPath,
            bootstrap_account: { id: keeper.id, username: keeper.username, role: keeperRows[0].role },
            before,
            after,
            broken_references: broken,
            verification: 'passed'
        }, null, 2));
    } finally {
        await conn.end();
    }
}

main().catch(error => {
    console.error(`User Management test reset failed: ${error.message}`);
    process.exit(1);
});
