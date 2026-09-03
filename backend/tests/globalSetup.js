// Jest globalSetup — runs once before the whole test suite. Creates a
// throwaway brgydata_test database with the real brgydata's schema
// (no data), so tests never touch real barangay data.
const path = require('path');
const { execSync } = require('child_process');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { findBinary } = require('./mysqlBin');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const SOURCE_DB = process.env.DB_NAME || 'brgydata';
const TEST_DB = 'brgydata_test';

module.exports = async function globalSetup() {
    const connection = await mysql.createConnection({
        host: DB_HOST,
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
        `"${mysqldumpBin}" --no-data --ignore-table=${SOURCE_DB}.vw_incident_details -h ${DB_HOST} -u ${DB_USER} ${SOURCE_DB} | "${mysqlBin}" -h ${DB_HOST} -u ${DB_USER} ${TEST_DB}`,
        { shell: true, env, stdio: 'pipe' }
    );

    console.log(`✅ Test database "${TEST_DB}" created with schema cloned from "${SOURCE_DB}".`);
};
