// Jest globalTeardown — runs once after the whole test suite finishes.
// Drops the throwaway test database; the real brgydata is never touched.
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = async function globalTeardown() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || ''
    });

    await connection.query('DROP DATABASE IF EXISTS `brgydata_test`');
    await connection.end();

    console.log('✅ Test database "brgydata_test" dropped.');
};
