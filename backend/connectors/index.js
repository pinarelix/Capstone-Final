/**
 * connectors/index.js
 * -------------------
 * Registry of database connectors.  Currently only MySQL/MariaDB is
 * supported; the structure is ready for postgres/sqlite later — just
 * drop a new module into this folder and register it below.
 */

const mysqlConnector = require('./mysql');

// ── registry ───────────────────────────────────────────────────────
const connectors = {
    mysql: mysqlConnector,
    // postgres: require('./postgres'),   // future
    // sqlite:   require('./sqlite'),     // future
};

/**
 * Return a connector by type name.
 * @param {string} type  e.g. 'mysql'
 * @returns {object|null}
 */
function getConnector(type) {
    return connectors[type] || null;
}

/**
 * Return an array of { name, label, defaultPort } for every registered
 * connector — useful for a UI dropdown in the setup wizard.
 */
function listConnectors() {
    return Object.values(connectors).map((c) => ({
        name: c.name,
        label: c.label,
        defaultPort: c.defaultPort,
    }));
}

module.exports = { getConnector, listConnectors };
