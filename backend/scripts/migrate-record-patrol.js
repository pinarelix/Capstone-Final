// Upgrade an existing Option A installation without re-running the legacy
// incidents-table cutover. This command never clears or seeds business data.
const mysql = require('mysql2/promise');
const path = require('path');
const { migrateRecordPatrol } = require('../migrations/record-patrol');
require('dotenv').config({ path: process.env.APP_CONFIG_PATH || path.join(__dirname, '..', '.env') });

async function main() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'brgydata'
    });
    try {
        const [objects] = await connection.query(`SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('record_registry','incidents')`);
        if (!objects.some(object => object.TABLE_NAME === 'record_registry') || !objects.some(object => object.TABLE_NAME === 'incidents' && object.TABLE_TYPE === 'VIEW')) {
            throw new Error('This database still uses the legacy record structure. Review and migrate existing records to Option A before this additive patrol upgrade. No changes were made.');
        }
        await migrateRecordPatrol(connection);
        await connection.query("ALTER TABLE users MODIFY COLUMN role ENUM('Executive Officer','Deputy Officer','Kagawad','Team Leader') NOT NULL");
        await connection.query("UPDATE users SET role='Executive Officer' WHERE role='Deputy Officer'");
        console.log('Record patrol upgrade complete. Existing records and narratives were preserved.');
    } finally { await connection.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
