// Jest globalSetup — runs once before the whole test suite. Creates a
// throwaway brgydata_test database with the real brgydata's schema
// (no data), so tests never touch real barangay data.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { findBinary } = require('./mysqlBin');
const { createArchive } = require('../archive');
const { migrateRecordPatrol } = require('../migrations/record-patrol');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const SOURCE_DB = process.env.DB_NAME || 'brgydata';
const TEST_DB = 'brgydata_test';

module.exports = async function globalSetup() {
    const connection = await mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD
    });

    await connection.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await connection.query(`CREATE DATABASE \`${TEST_DB}\``);
    await connection.end();

    const mysqlBin = findBinary('mysql');
    const mysqldumpBin = findBinary('mysqldump');

    // MYSQL_PWD (not -p<password> inline) so the password never appears
    // in a process listing.
    const env = { ...process.env, MYSQL_PWD: DB_PASSWORD };

    // --ignore-table excludes vw_incident_details: a pre-existing, unused
    // leftover view from an earlier prototype schema (references columns/
    // tables — occurred_on, puroks, etc. — that no longer exist), which
    // makes mysqldump fail entirely if left in. Not touched in the real
    // database; only skipped for this throwaway schema clone.
    execSync(
        `"${mysqldumpBin}" --no-data --ignore-table=${SOURCE_DB}.vw_incident_details -h ${DB_HOST} -P ${DB_PORT} -u ${DB_USER} ${SOURCE_DB} | "${mysqlBin}" -h ${DB_HOST} -P ${DB_PORT} -u ${DB_USER} ${TEST_DB}`,
        { shell: true, env, stdio: 'pipe' }
    );

    // The live database can legitimately lag behind repository migrations.
    // Bring only the throwaway clone up to the schema expected by this
    // checkout so test outcomes do not depend on the operator's live DB.
    const testPool = mysql.createPool({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD,
        database: TEST_DB,
        multipleStatements: true
    });

    const [registryTables] = await testPool.query("SHOW FULL TABLES LIKE 'record_registry'");
    if (registryTables.length === 0) {
        for (const migration of [
            '001_option_a_tables.sql',
            '002_cutover_incidents_view.sql',
            '003_record_type_catalog.sql',
            '004_unified_analytics_view.sql'
        ]) {
            const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', migration), 'utf8');
            await testPool.query(sql);
        }
    }

    const taskMigration = fs.readFileSync(
        path.join(__dirname, '..', '..', 'database', 'migrations', '20261023_task_manager.sql'),
        'utf8'
    );
    await testPool.query(taskMigration);
    await migrateRecordPatrol(testPool);
    await testPool.query(`INSERT INTO location_coordinates (location, latitude, longitude, set_by)
        VALUES ('Balite Street', 14.75557925, 121.07745924, NULL)
        ON DUPLICATE KEY UPDATE latitude=VALUES(latitude), longitude=VALUES(longitude)`);
    await testPool.query("ALTER TABLE users MODIFY COLUMN role ENUM('Executive Officer','Deputy Officer','Kagawad','Team Leader') NOT NULL");

    // Runtime-created support tables must also exist in the clone.
    await createArchive({ pool: testPool, uploadsRoot: '' }).ensureArchiveTable();
    await testPool.end();

    console.log(`✅ Test database "${TEST_DB}" created with schema cloned from "${SOURCE_DB}".`);
};
