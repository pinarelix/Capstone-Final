// Creates least-privilege MySQL users for the application.
//
// Runtime user (brgyapp): DML + DDL needed by testConnection() migrations.
// Backup user (brgybackup): read-only + LOCK TABLES for safe dumps.
//
// Run ONCE with root credentials:
//   node scripts/setup-db-user.js
//
// Accepts optional env vars to override the generated passwords:
//   BRGYAPP_PASSWORD=xxx BRGYBACKUP_PASSWORD=yyy node scripts/setup-db-user.js
//
const mysql  = require('mysql2/promise');
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_NAME = process.env.DB_NAME || 'brgydata';

const APP_USER    = 'brgyapp';
const BACKUP_USER = 'brgybackup';

function generatePassword() {
    return crypto.randomBytes(24).toString('base64url');
}

async function main() {
    const rootPassword = process.env.DB_PASSWORD;
    if (!rootPassword) {
        console.error('❌ DB_PASSWORD (root) must be set in .env');
        process.exit(1);
    }

    const conn = await mysql.createConnection({
        host:     process.env.DB_HOST || 'localhost',
        port:     parseInt(process.env.DB_PORT, 10) || 3306,
        user:     'root',
        password: rootPassword,
    });

    const appPass    = process.env.BRGYAPP_PASSWORD    || generatePassword();
    const backupPass = process.env.BRGYBACKUP_PASSWORD || generatePassword();

    try {
        // ── Runtime user ──
        // DML only — DDL migrations run separately via scripts/migrate.js
        // using root or a dedicated migration account.
        await conn.query(
            `CREATE USER IF NOT EXISTS '${APP_USER}'@'localhost' IDENTIFIED BY ?`,
            [appPass]
        );
        await conn.query(
            `ALTER USER '${APP_USER}'@'localhost' IDENTIFIED BY ?`,
            [appPass]
        );
        await conn.query(
            `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO '${APP_USER}'@'localhost'`
        );

        // ── Backup user ──
        await conn.query(
            `CREATE USER IF NOT EXISTS '${BACKUP_USER}'@'localhost' IDENTIFIED BY ?`,
            [backupPass]
        );
        await conn.query(
            `ALTER USER '${BACKUP_USER}'@'localhost' IDENTIFIED BY ?`,
            [backupPass]
        );
        await conn.query(
            `GRANT SELECT, LOCK TABLES ON \`${DB_NAME}\`.* TO '${BACKUP_USER}'@'localhost'`
        );

        await conn.query('FLUSH PRIVILEGES');

        // ── Verify the runtime user cannot do dangerous operations ──
        const verifyConn = await mysql.createConnection({
            host:     process.env.DB_HOST || 'localhost',
            port:     parseInt(process.env.DB_PORT, 10) || 3306,
            user:     APP_USER,
            password: appPass,
            database: DB_NAME,
        });

        const checks = [
            { label: 'DROP TABLE',    sql: 'DROP TABLE IF EXISTS __priv_test_nonexistent__' },
            { label: 'CREATE TABLE',  sql: 'CREATE TABLE __priv_test_verify__ (id INT PRIMARY KEY)' },
            { label: 'GRANT',         sql: `GRANT SELECT ON \`${DB_NAME}\`.* TO '${APP_USER}'@'localhost'` },
        ];

        let allBlocked = true;
        for (const { label, sql } of checks) {
            try {
                await verifyConn.query(sql);
                console.warn(`⚠️  ${APP_USER} was NOT blocked from ${label} — review grants!`);
                allBlocked = false;
                // Clean up test table if it was created
                if (label === 'CREATE TABLE') {
                    try { await verifyConn.query('DROP TABLE IF EXISTS __priv_test_verify__'); } catch {}
                }
            } catch {
                console.log(`✅ ${APP_USER} correctly blocked from ${label}`);
            }
        }

        await verifyConn.end();

        console.log('\n══════════════════════════════════════════════════════');
        console.log(`  Runtime user: ${APP_USER}@localhost`);
        console.log(`  Privileges:   SELECT, INSERT, UPDATE, DELETE on ${DB_NAME}`);
        console.log(`  Password:     ${appPass}`);
        console.log('');
        console.log(`  Backup user:  ${BACKUP_USER}@localhost`);
        console.log(`  Privileges:   SELECT, LOCK TABLES on ${DB_NAME}`);
        console.log(`  Password:     ${backupPass}`);
        console.log('══════════════════════════════════════════════════════');
        console.log('\nUpdate backend/.env:');
        console.log(`  DB_USER=${APP_USER}`);
        console.log(`  DB_PASSWORD=${appPass}`);
        console.log('');
        console.log('For backups, use:');
        console.log(`  mysqldump -u ${BACKUP_USER} -p${backupPass} ${DB_NAME}`);
        console.log('');
        if (allBlocked) {
            console.log('✅ Privilege verification passed — dangerous operations are blocked.');
        } else {
            console.log('⚠️  Some privilege checks failed — review output above.');
        }
    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('❌ Failed:', err.message);
    process.exit(1);
});
