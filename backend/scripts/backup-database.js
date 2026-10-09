// Backs up the live `brgydata` database to database/backups/ as a
// timestamped .sql dump, and prunes old backups beyond a retention count.
//
// Usage:
//   npm run backup                 (from backend/)
//   node scripts/backup-database.js
//
// This is a MANUAL step, not a cron job - the project has no server
// infrastructure to schedule one against. Run it before anything risky
// (a schema change, a bulk data edit, before a demo) and keep a copy
// of the backups/ folder somewhere off this machine periodically -
// these dumps are gitignored (database/backups/) and never leave disk
// on their own.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'brgydata';

// How many of the most recent backups to keep - older ones are deleted
// automatically after a successful new backup. Override with
// BACKUP_RETENTION_COUNT in .env if 14 isn't the right number.
const RETENTION_COUNT = parseInt(process.env.BACKUP_RETENTION_COUNT, 10) || 14;

const BACKUP_DIR = path.join(__dirname, '..', '..', 'database', 'backups');

function findMysqldump() {
    const candidates = ['mysqldump', 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe'];
    for (const candidate of candidates) {
        try {
            execSync(`"${candidate}" --version`, { stdio: 'ignore' });
            return candidate;
        } catch (e) {
            // try the next candidate
        }
    }
    throw new Error(
        'Could not find a working "mysqldump" binary on PATH or at the known MySQL install location. ' +
        'Set MYSQLDUMP_PATH in backend/.env to the full path if MySQL is installed elsewhere.'
    );
}

function timestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function pruneOldBackups() {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.sql'))
        .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);

    const toDelete = files.slice(RETENTION_COUNT);
    toDelete.forEach(f => {
        fs.unlinkSync(path.join(BACKUP_DIR, f.name));
        console.log(`🗑️  Pruned old backup: ${f.name}`);
    });
}

function main() {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const mysqldumpBin = process.env.MYSQLDUMP_PATH || findMysqldump();
    const outFile = path.join(BACKUP_DIR, `${DB_NAME}-${timestamp()}.sql`);

    // MYSQL_PWD (not -p<password> inline) so the password never appears in
    // a process listing - same convention as backend/tests/globalSetup.js.
    const env = { ...process.env, MYSQL_PWD: DB_PASSWORD };

    console.log(`📦 Backing up "${DB_NAME}" from ${DB_HOST}...`);
    // --single-transaction avoids LOCK TABLES entirely (a consistent
    // InnoDB snapshot instead) - needed because this DB has a pre-existing,
    // unused leftover view (vw_incident_details, see FUTURE_WORK.md) that
    // references columns which no longer exist, and LOCK TABLES fails
    // trying to resolve it. --ignore-table skips it for good measure too.
    execSync(
        `"${mysqldumpBin}" --single-transaction --routines --triggers ` +
        `--ignore-table=${DB_NAME}.vw_incident_details ` +
        `-h ${DB_HOST} -u ${DB_USER} ${DB_NAME} > "${outFile}"`,
        { shell: true, env, stdio: 'inherit' }
    );

    const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
    console.log(`✅ Backup saved: ${outFile} (${sizeKb} KB)`);

    pruneOldBackups();
}

main();
