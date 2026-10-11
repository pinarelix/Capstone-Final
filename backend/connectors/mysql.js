/**
 * connectors/mysql.js
 * -------------------
 * Connector module that wraps mysql2/promise for the setup wizard and
 * runtime pool creation.  Each connector in the registry exposes the
 * same interface so the rest of the app stays database-agnostic.
 */

const mysql = require('mysql2/promise');

module.exports = {
    name: 'mysql',
    label: 'MySQL / MariaDB',
    defaultPort: 3306,

    /**
     * Create a long-lived connection pool for runtime use.
     * @param {object} cfg  { host, port, user, password, database }
     * @returns {import('mysql2/promise').Pool}
     */
    async createPool(cfg) {
        const pool = mysql.createPool({
            host: cfg.host || 'localhost',
            port: Number(cfg.port) || 3306,
            user: cfg.user || 'root',
            password: cfg.password || '',
            database: cfg.database || cfg.name || 'brgydata',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            dateStrings: ['DATE'],
        });
        return pool;
    },

    /**
     * One-off connection test used by the setup wizard.
     * Creates its own throwaway connection (NOT from a pool) so it
     * never interferes with the running app's pool.
     *
     * @param {object} cfg  { host, port, user, password, database }
     * @returns {{ ok: boolean, version?: string, tables?: number, error?: string }}
     */
    async testConnection(cfg) {
        let conn;
        try {
            conn = await mysql.createConnection({
                host: cfg.host || 'localhost',
                port: Number(cfg.port) || 3306,
                user: cfg.user || 'root',
                password: cfg.password || '',
                database: cfg.database || cfg.name || 'brgydata',
            });

            const [[versionRow]] = await conn.query('SELECT VERSION() AS version');
            const version = versionRow.version;

            const [[tableRow]] = await conn.query(
                'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ?',
                [cfg.database || cfg.name || 'brgydata']
            );
            const tables = tableRow.count;

            return { ok: true, version, tables };
        } catch (err) {
            return { ok: false, error: err.message };
        } finally {
            if (conn) {
                try { await conn.destroy(); } catch (_) { /* ignore */ }
            }
        }
    },

    /**
     * Retrieve the server version string from an existing pool.
     * @param {import('mysql2/promise').Pool} pool
     * @returns {string}
     */
    async getServerInfo(pool) {
        const [[row]] = await pool.query('SELECT VERSION() AS version');
        return row.version;
    },
};
