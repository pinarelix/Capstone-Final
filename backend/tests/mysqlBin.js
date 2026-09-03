// Finds a working mysql/mysqldump binary — tries PATH first, then this
// machine's known MySQL install location as a fallback (mirrors how
// this project's own dev workflow already needed the full path since
// mysql/mysqldump aren't on PATH in every shell on this machine).
const { execSync } = require('child_process');

const CANDIDATES = {
    mysql: ['mysql', 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe'],
    mysqldump: ['mysqldump', 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe']
};

function findBinary(name) {
    for (const candidate of CANDIDATES[name]) {
        try {
            execSync(`"${candidate}" --version`, { stdio: 'ignore' });
            return candidate;
        } catch (e) {
            // try the next candidate
        }
    }
    throw new Error(
        `Could not find a working "${name}" binary on PATH or at the known MySQL install location. ` +
        `Set it explicitly by editing tests/mysqlBin.js if MySQL is installed elsewhere.`
    );
}

module.exports = { findBinary };
