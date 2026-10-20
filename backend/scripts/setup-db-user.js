// Creates a least-privilege MySQL user for the application.
// Run ONCE with root credentials, then update .env to use the new user.
//
// Usage:
//   node scripts/setup-db-user.js
//
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const APP_USER = 'brgyapp';
const APP_PASS = process.env.DB_PASSWORD || 'changeme';
const DB_NAME = process.env.DB_NAME || 'brgydata';

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        user: 'root',
        password: process.env.DB_PASSWORD
    });

    try {
        await conn.query(`CREATE USER IF NOT EXISTS '${APP_USER}'@'localhost' IDENTIFIED BY ?`, [APP_PASS]);
        await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO '${APP_USER}'@'localhost'`);
        await conn.query(`FLUSH PRIVILEGES`);

        console.log(`✅ MySQL user '${APP_USER}'@'localhost' created with SELECT/INSERT/UPDATE/DELETE on ${DB_NAME}`);
        console.log(`\nUpdate your backend/.env:`);
        console.log(`  DB_USER=${APP_USER}`);
        console.log(`  DB_PASSWORD=${APP_PASS}`);
        console.log(`\nThen restart the server to use the new user.`);
    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('❌ Failed:', err.message);
    process.exit(1);
});
