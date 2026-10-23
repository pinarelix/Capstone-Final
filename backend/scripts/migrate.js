// Schema migration script — runs DDL with elevated privileges.
//
// Usage (before starting the server):
//   node scripts/migrate.js
//
// This script requires CREATE and ALTER privileges. The runtime
// application account (brgyapp) should have only SIUD after this
// script has been run at least once.
//
const mysql = require('mysql2/promise');
const path  = require('path');
const fs    = require('fs');
const { migrateRecordPatrol } = require('../migrations/record-patrol');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_NAME = process.env.DB_NAME || 'brgydata';
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'database', 'migrations');

async function runSqlMigration(conn, filename) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    await conn.query(sql);
    console.log(`  ✓ ${filename}`);
}

async function migrate() {
    const conn = await mysql.createConnection({
        host:     process.env.DB_HOST || 'localhost',
        port:     parseInt(process.env.DB_PORT, 10) || 3306,
        user:     process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: DB_NAME,
        multipleStatements: true,
    });

    try {
        console.log(`Running migrations on ${DB_NAME}...`);

        // 1. area_risk_decay table
        await conn.query(`
            CREATE TABLE IF NOT EXISTS area_risk_decay (
                location VARCHAR(100) PRIMARY KEY,
                decay_amount DECIMAL(5,2) NOT NULL DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log('  ✓ area_risk_decay');

        // 2. Role migration: old names → new ENUM
        try {
            await conn.query(`ALTER TABLE users MODIFY COLUMN role VARCHAR(50) NOT NULL`);
            await conn.query(`UPDATE users SET role = 'Executive Officer' WHERE role IN ('Administrator', 'Deputy Officer', 'Executive Officer')`);
            await conn.query(`UPDATE users SET role = 'Kagawad' WHERE role IN ('Decision-Maker', 'Captain')`);
            await conn.query(`UPDATE users SET role = 'Team Leader' WHERE role = 'Desk Officer'`);
        } catch { /* ignore if already migrated */ }

        await conn.query(`
            ALTER TABLE users
            MODIFY COLUMN role ENUM('Executive Officer', 'Deputy Officer', 'Kagawad', 'Team Leader') NOT NULL
        `);
        console.log('  ✓ users.role ENUM');

        // 3. users.email column
        try {
            await conn.query(`ALTER TABLE users ADD COLUMN email VARCHAR(150) DEFAULT NULL`);
            console.log('  ✓ users.email added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log('  ✓ users.email (already exists)');
            } else {
                throw err;
            }
        }

        // 4. Legacy incidents table migrations (only if it's a base table)
        const [incMetaRows] = await conn.query(
            "SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents'"
        );
        if (incMetaRows[0] && incMetaRows[0].TABLE_TYPE === 'BASE TABLE') {
            for (const col of [
                "ADD COLUMN severity ENUM('High','Medium','Low') DEFAULT 'Low'",
                "ADD COLUMN respondent_name VARCHAR(255) DEFAULT NULL",
                "ADD COLUMN respondent_address VARCHAR(500) DEFAULT NULL",
                "ADD COLUMN age INT DEFAULT NULL",
            ]) {
                try { await conn.query(`ALTER TABLE incidents ${col}`); }
                catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; }
            }

            try { await conn.query("ALTER TABLE incidents ADD COLUMN form_type ENUM('blotter','crime') DEFAULT 'blotter'"); }
            catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; }

            await conn.query("UPDATE incidents SET form_type = 'crime' WHERE form_type = 'blotter' AND (blotter_number IS NULL OR blotter_number = '') AND (description IS NULL OR description = '')");
            console.log('  ✓ incidents columns');
        } else {
            console.log('  ✓ incidents (VIEW — skipping base-table migrations)');
        }

        // 5. archived_records table
        await conn.query(`
            CREATE TABLE IF NOT EXISTS archived_records (
                id INT AUTO_INCREMENT PRIMARY KEY,
                record_type VARCHAR(50) NOT NULL,
                original_id INT NOT NULL,
                data JSON NOT NULL,
                archived_by INT DEFAULT NULL,
                archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reason VARCHAR(500) DEFAULT NULL,
                INDEX idx_record_type (record_type),
                INDEX idx_original_id (original_id)
            )
        `);
        console.log('  ✓ archived_records');

        // 6. M-7: Change audit_logs and login_history FKs from CASCADE to SET NULL
        for (const table of ['audit_logs', 'login_history']) {
            const fkName = `${table}_ibfk_1`;
            try {
                await conn.query(`ALTER TABLE ${table} MODIFY COLUMN user_id INT DEFAULT NULL`);
                await conn.query(`ALTER TABLE ${table} DROP FOREIGN KEY ${fkName}`);
                await conn.query(`ALTER TABLE ${table} ADD CONSTRAINT ${fkName} FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`);
                console.log(`  ✓ ${table} FK → SET NULL`);
            } catch (err) {
                if (err.message.includes('check that column/key exists')) {
                    console.log(`  ✓ ${table} FK (already migrated)`);
                } else {
                    throw err;
                }
            }
        }

        // 7. Apply the checked-in architecture migrations in dependency order.
        // Migration 002 is intentionally non-idempotent, so only run the
        // Option A cutover while `incidents` is still the legacy base table.
        const [registryRows] = await conn.query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'record_registry'"
        );
        if (registryRows.length === 0) {
            await runSqlMigration(conn, '001_option_a_tables.sql');
        } else {
            console.log('  ✓ 001_option_a_tables.sql (already applied)');
        }

        const [incidentObjectRows] = await conn.query(
            "SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents'"
        );
        if (incidentObjectRows[0]?.TABLE_TYPE === 'BASE TABLE') {
            await runSqlMigration(conn, '002_cutover_incidents_view.sql');
        } else if (incidentObjectRows[0]?.TABLE_TYPE === 'VIEW') {
            console.log('  ✓ 002_cutover_incidents_view.sql (already applied)');
        } else {
            throw new Error('Cannot apply migration 002: the incidents table/view is missing.');
        }

        // These migrations are safe to re-run: 003 uses IF NOT EXISTS, 004
        // replaces its view, and the task-manager migration uses IF NOT EXISTS.
        await runSqlMigration(conn, '003_record_type_catalog.sql');
        await runSqlMigration(conn, '004_unified_analytics_view.sql');
        await runSqlMigration(conn, '20261023_task_manager.sql');
        await migrateRecordPatrol(conn);

        console.log('✅ All migrations complete.');
    } finally {
        await conn.end();
    }
}

migrate().catch(err => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
