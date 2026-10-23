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
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_NAME = process.env.DB_NAME || 'brgydata';

async function migrate() {
    const conn = await mysql.createConnection({
        host:     process.env.DB_HOST || 'localhost',
        port:     parseInt(process.env.DB_PORT, 10) || 3306,
        user:     process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: DB_NAME,
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
            await conn.query(`UPDATE users SET role = 'Deputy Officer' WHERE role = 'Administrator'`);
            await conn.query(`UPDATE users SET role = 'Kagawad' WHERE role IN ('Decision-Maker', 'Captain')`);
            await conn.query(`UPDATE users SET role = 'Team Leader' WHERE role = 'Desk Officer'`);
        } catch { /* ignore if already migrated */ }

        await conn.query(`
            ALTER TABLE users
            MODIFY COLUMN role ENUM('Deputy Officer', 'Kagawad', 'Team Leader') NOT NULL
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

        // 7. Respondent structured address columns
        for (const tbl of ['blotter_records', 'incident_records']) {
            for (const col of [
                "ADD COLUMN resp_addr_street VARCHAR(100) DEFAULT NULL",
                "ADD COLUMN resp_addr_block VARCHAR(50) DEFAULT NULL",
                "ADD COLUMN resp_addr_lot VARCHAR(50) DEFAULT NULL",
                "ADD COLUMN resp_addr_house_no VARCHAR(50) DEFAULT NULL",
                "ADD COLUMN resp_addr_unit VARCHAR(50) DEFAULT NULL",
            ]) {
                try { await conn.query(`ALTER TABLE \`${tbl}\` ${col}`); }
                catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; }
            }
        }
        console.log('  ✓ respondent structured address columns');

        // Recreate the incidents VIEW to include the new columns
        await conn.query('DROP VIEW IF EXISTS incidents');
        await conn.query(`
            CREATE VIEW incidents AS
            SELECT
                r.registry_id AS id,
                b.incident_type, b.\`date\`, b.\`time\`, b.latitude, b.longitude,
                b.street_name, b.address, b.reporter_id, b.status, b.description,
                b.recommended_action, b.danger_level, b.created_at, b.updated_at,
                b.time_of_day, b.day_of_week, b.is_weekend, b.photo_path,
                r.public_number AS blotter_number,
                COALESCE(NULLIF(TRIM(CONCAT_WS(' ', b.complainant_first, b.complainant_middle, b.complainant_last)), ''), b.reported_by_name) AS reported_by_name,
                b.statement, NULL AS persons_involved, b.priority, b.severity,
                COALESCE(NULLIF(TRIM(CONCAT_WS(' ', b.respondent_first, b.respondent_middle, b.respondent_last)), ''), b.respondent_name) AS respondent_name,
                b.respondent_address, b.respondent_age AS age, 'blotter' AS form_type,
                r.registry_id, r.source, r.public_number, b.type_code, b.is_draft, b.data_origin,
                b.complainant_first, b.complainant_middle, b.complainant_last, b.complainant_contact,
                b.respondent_first, b.respondent_middle, b.respondent_last,
                b.reporter_first, b.reporter_middle, b.reporter_last, b.reporter_address, b.reporter_contact,
                b.addr_block, b.addr_lot, b.addr_house_no, b.addr_street, b.addr_unit,
                b.no_evidence, b.no_evidence_reason,
                b.resp_addr_street, b.resp_addr_block, b.resp_addr_lot, b.resp_addr_house_no, b.resp_addr_unit
            FROM record_registry r
            JOIN blotter_records b ON r.source = 'blotter' AND r.source_id = b.id
            UNION ALL
            SELECT
                r.registry_id,
                i.incident_type, i.\`date\`, i.\`time\`, i.latitude, i.longitude,
                i.street_name, i.address, i.reporter_id, i.status, i.description,
                i.recommended_action, i.danger_level, i.created_at, i.updated_at,
                i.time_of_day, i.day_of_week, i.is_weekend, i.photo_path,
                r.public_number,
                COALESCE(NULLIF(TRIM(CONCAT_WS(' ', i.complainant_first, i.complainant_middle, i.complainant_last)), ''), i.reported_by_name),
                i.statement, NULL, i.priority, i.severity,
                COALESCE(NULLIF(TRIM(CONCAT_WS(' ', i.respondent_first, i.respondent_middle, i.respondent_last)), ''), i.respondent_name),
                i.respondent_address, i.respondent_age, 'crime',
                r.registry_id, r.source, r.public_number, i.type_code, i.is_draft, i.data_origin,
                i.complainant_first, i.complainant_middle, i.complainant_last, i.complainant_contact,
                i.respondent_first, i.respondent_middle, i.respondent_last,
                i.reporter_first, i.reporter_middle, i.reporter_last, i.reporter_address, i.reporter_contact,
                i.addr_block, i.addr_lot, i.addr_house_no, i.addr_street, i.addr_unit,
                i.no_evidence, i.no_evidence_reason,
                i.resp_addr_street, i.resp_addr_block, i.resp_addr_lot, i.resp_addr_house_no, i.resp_addr_unit
            FROM record_registry r
            JOIN incident_records i ON r.source = 'incident' AND r.source_id = i.id
        `);
        console.log('  ✓ incidents VIEW updated with resp_addr + structured fields');

        console.log('✅ All migrations complete.');
    } finally {
        await conn.end();
    }
}

migrate().catch(err => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
