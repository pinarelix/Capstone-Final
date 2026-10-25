// Upgrade an existing Option A installation without re-running the legacy
// incidents-table cutover. This command never clears or seeds business data.
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { loadConfig } = require('../config-manager');
const { findBinary } = require('../tests/mysqlBin');
const { migrateRecordPatrol } = require('../migrations/record-patrol');
require('dotenv').config({ path: process.env.APP_CONFIG_PATH || path.join(__dirname, '..', '.env') });

async function main() {
    const cfg = loadConfig().db;
    if (!['localhost', '127.0.0.1', '::1'].includes(cfg.host)) throw new Error('This migration command requires a local database.');
    const connection = await mysql.createConnection({
        host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.name
    });
    try {
        const [objects] = await connection.query(`SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('record_registry','incidents')`);
        if (!objects.some(object => object.TABLE_NAME === 'record_registry') || !objects.some(object => object.TABLE_NAME === 'incidents' && object.TABLE_TYPE === 'VIEW')) {
            throw new Error('This database still uses the legacy record structure. Review and migrate existing records to Option A before this additive patrol upgrade. No changes were made.');
        }
        const backupDir = path.resolve(__dirname, '../../database/backups');
        fs.mkdirSync(backupDir, { recursive: true });
        const backup = path.join(backupDir, `before-patrol-upgrade-${Date.now()}.sql`);
        execFileSync(findBinary('mysqldump'), ['--single-transaction', '--routines', '--triggers', '--ignore-table=' + cfg.name + '.vw_incident_details', '-h', cfg.host, '-P', String(cfg.port), '-u', cfg.user, '--result-file=' + backup, cfg.name], { env: { ...process.env, MYSQL_PWD: cfg.password }, stdio: 'pipe' });
        console.log(`Backup saved: ${backup}`);
        await migrateRecordPatrol(connection);
        await connection.query("ALTER TABLE users MODIFY COLUMN role ENUM('Executive Officer','Deputy Officer','Kagawad','Team Leader') NOT NULL");
        await connection.query("UPDATE users SET role='Executive Officer' WHERE role='Deputy Officer'");
        console.log('Record patrol upgrade complete. Existing records and narratives were preserved.');
    } finally { await connection.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
