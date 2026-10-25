// Restores the database from a backup file (plain .sql or encrypted .sql.enc).
//
// Usage:
//   npm run restore                          (restores the latest backup)
//   npm run restore -- --file <filename>     (restores a specific file)
//   node scripts/restore-database.js
//   node scripts/restore-database.js --file brgydata-20261020-120000.sql.enc
//
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { loadConfig } = require('../config-manager');
const config = loadConfig();
const DB_HOST = config.db.host;
const DB_USER = config.db.user;
const DB_PASSWORD = config.db.password;
const DB_NAME = config.db.name;
const BACKUP_KEY = process.env.BACKUP_ENCRYPTION_KEY || '';

const BACKUP_DIR = path.join(__dirname, '..', '..', 'database', 'backups');

function findMysql() {
    const candidates = ['mysql', 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe'];
    for (const c of candidates) {
        try {
            execSync(`"${c}" --version`, { stdio: 'ignore' });
            return c;
        } catch (e) { /* next */ }
    }
    throw new Error('Could not find "mysql" binary on PATH or at the known install location.');
}

function decryptFile(encPath) {
    if (!BACKUP_KEY) {
        throw new Error('BACKUP_ENCRYPTION_KEY is not set in .env — cannot decrypt.');
    }
    const data = fs.readFileSync(encPath);
    const iv = data.subarray(0, 16);
    const encrypted = data.subarray(16);
    const key = crypto.scryptSync(BACKUP_KEY, 'brgydata-salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function getLatestBackup() {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.sql') || f.endsWith('.sql.enc'))
        .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
    if (files.length === 0) throw new Error('No backup files found in ' + BACKUP_DIR);
    return files[0].name;
}

function main() {
    const fileArg = process.argv.indexOf('--file');
    const fileName = fileArg !== -1 ? process.argv[fileArg + 1] : getLatestBackup();
    const filePath = path.join(BACKUP_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        throw new Error(`Backup file not found: ${filePath}`);
    }

    console.log(`🔄 Restoring "${DB_NAME}" from ${fileName}...`);

    const mysqlBin = process.env.MYSQL_PATH || findMysql();
    const env = { ...process.env, MYSQL_PWD: DB_PASSWORD };

    let sqlPath = filePath;
    let tempFile = null;

    if (fileName.endsWith('.enc')) {
        console.log('🔓 Decrypting backup...');
        const decrypted = decryptFile(filePath);
        tempFile = path.join(BACKUP_DIR, `_restore-temp-${Date.now()}.sql`);
        fs.writeFileSync(tempFile, decrypted);
        sqlPath = tempFile;
    }

    try {
        execSync(
            `"${mysqlBin}" -h ${DB_HOST} -u ${DB_USER} ${DB_NAME} < "${sqlPath}"`,
            { shell: true, env, stdio: 'inherit' }
        );
        console.log(`✅ Database restored successfully from ${fileName}`);
    } finally {
        if (tempFile) fs.rmSync(tempFile, { force: true });
    }
}

main();
