// ============================================================
// ARCHIVE - nothing a user deletes is gone for good.
//
// Every delete route snapshots what it removes into `archived_records`
// (the row plus anything that would otherwise be lost with it - e.g. an
// incident's evidence rows) and moves any uploaded files into
// <uploads>/archive/ instead of unlinking them. The Executive Officer can
// browse the archive in Settings > Archive and restore a record exactly
// as it was.
//
// Users were already soft-deleted (is_active = 0); they get an archive
// row too so the Archive is the one place to find anything removed, and
// "restore" for them simply reactivates the account.
// ============================================================
const fs = require('fs');
const path = require('path');

const ENTITY_TABLES = {
    incident: 'incidents',
    incident_evidence: 'incident_evidence',
    patrol_schedule: 'patrol_schedules',
    patrol_log: 'patrol_logs',
    user: 'users'
};

function createArchive({ pool, uploadsRoot }) {
    const archiveRoot = path.join(uploadsRoot, 'archive');

    async function ensureArchiveTable() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS archived_records (
                id INT AUTO_INCREMENT PRIMARY KEY,
                entity_type VARCHAR(30) NOT NULL,
                entity_id INT NOT NULL,
                label VARCHAR(255) NOT NULL,
                data JSON NOT NULL,
                files JSON NULL,
                deleted_by INT NULL,
                deleted_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                restored_by INT NULL,
                restored_at TIMESTAMP NULL,
                KEY idx_archive_entity (entity_type, entity_id),
                KEY idx_archive_restored (restored_at),
                CONSTRAINT fk_archive_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL,
                CONSTRAINT fk_archive_restored_by FOREIGN KEY (restored_by) REFERENCES users (id) ON DELETE SET NULL
            )
        `);

        // Users deactivated before the archive existed - give each one an
        // entry so they show up (and can be reactivated) there too.
        await pool.query(`
            INSERT INTO archived_records (entity_type, entity_id, label, data, deleted_at)
            SELECT 'user', u.id, CONCAT('User: ', u.name, ' (', u.role, ')'),
                   JSON_OBJECT('row', JSON_OBJECT('id', u.id, 'name', u.name, 'username', u.username, 'role', u.role,
                                                  'contact_no', u.contact_no, 'email', u.email)),
                   u.updated_at
            FROM users u
            WHERE u.is_active = 0 AND NOT EXISTS (
                SELECT 1 FROM archived_records a WHERE a.entity_type = 'user' AND a.entity_id = u.id AND a.restored_at IS NULL)
        `);
    }

    // Moves an uploaded file (path relative to the uploads root, e.g.
    // "incident-evidence/x.png") into the archive folder. Returns the
    // archived relative path, or null if the file was already missing.
    function archiveFile(relPath) {
        if (!relPath) return null;
        const safeRel = path.normalize(relPath).replace(/^(\.\.[\/\\])+/, '');
        const from = path.join(uploadsRoot, safeRel);
        const to = path.join(archiveRoot, safeRel);
        try {
            if (!fs.existsSync(from)) return null;
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.renameSync(from, to);
            return path.join('archive', safeRel).replace(/\\/g, '/');
        } catch (error) {
            console.error('❌ Error archiving file:', relPath, error.message);
            return null;
        }
    }

    function restoreFile(archivedRel, originalRel) {
        if (!archivedRel || !originalRel) return;
        const from = path.join(uploadsRoot, archivedRel);
        const to = path.join(uploadsRoot, originalRel);
        try {
            if (!fs.existsSync(from)) return;
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.renameSync(from, to);
        } catch (error) {
            console.error('❌ Error restoring archived file:', archivedRel, error.message);
        }
    }

    // Writes one archive entry. `conn` may be a transaction connection.
    async function archiveRecord(conn, { entityType, entityId, label, data, files = [], deletedBy }) {
        const [result] = await conn.query(
            `INSERT INTO archived_records (entity_type, entity_id, label, data, files, deleted_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [entityType, entityId, label.slice(0, 255), JSON.stringify(data), JSON.stringify(files), deletedBy || null]
        );
        return result.insertId;
    }

    // Marks the open archive entry for a user as restored - used when
    // the account comes back by being re-added rather than via the Archive.
    async function markEntityRestored(entityType, entityId, restoredBy) {
        await pool.query(
            `UPDATE archived_records SET restored_at = NOW(), restored_by = ?
             WHERE entity_type = ? AND entity_id = ? AND restored_at IS NULL`,
            [restoredBy || null, entityType, entityId]
        );
    }

    return { ensureArchiveTable, archiveFile, restoreFile, archiveRecord, markEntityRestored };
}

// ---------- restore helpers ----------

const columnCache = new Map();
async function tableColumns(conn, table) {
    if (!columnCache.has(table)) {
        const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
        columnCache.set(table, new Set(cols.map(c => c.Field)));
    }
    return columnCache.get(table);
}

// JSON turned DATETIME/TIMESTAMP values into ISO strings; turn them back
// into Date objects so mysql2 writes them in the connection's own format
// (DATE columns were already plain 'YYYY-MM-DD' strings and stay as-is).
function reviveRow(row) {
    const out = {};
    for (const [key, value] of Object.entries(row || {})) {
        out[key] = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)
            ? new Date(value)
            : value;
    }
    return out;
}

async function insertRow(conn, table, row) {
    const cols = await tableColumns(conn, table);
    const clean = {};
    for (const [key, value] of Object.entries(reviveRow(row))) {
        if (cols.has(key)) clean[key] = value;
    }
    await conn.query(`INSERT INTO \`${table}\` SET ?`, [clean]);
}

class RestoreConflict extends Error {}

function registerArchiveRoutes(app, { pool, archive, authenticate, requireRole, logAudit, computeCartRiskFactors, heatmapCache }) {
    app.get('/api/archive', authenticate, requireRole(['Executive Officer']), async (req, res) => {
        try {
            const { type = '', state = 'archived' } = req.query;
            const where = [];
            const params = [];
            if (type) { where.push('a.entity_type = ?'); params.push(type); }
            if (state === 'archived') where.push('a.restored_at IS NULL');
            else if (state === 'restored') where.push('a.restored_at IS NOT NULL');

            const [rows] = await pool.query(`
                SELECT a.id, a.entity_type, a.entity_id, a.label, a.data, a.files,
                       a.deleted_at, a.restored_at,
                       du.name AS deleted_by_name, ru.name AS restored_by_name
                FROM archived_records a
                LEFT JOIN users du ON du.id = a.deleted_by
                LEFT JOIN users ru ON ru.id = a.restored_by
                ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                ORDER BY COALESCE(a.restored_at, a.deleted_at) DESC, a.id DESC
                LIMIT 500
            `, params);
            res.json(rows);
        } catch (error) {
            console.error('❌ Error fetching archive:', error);
            res.status(500).json({ error: 'Failed to fetch archive' });
        }
    });

    app.post('/api/archive/:id/restore', authenticate, requireRole(['Executive Officer']), async (req, res) => {
        const [found] = await pool.query('SELECT * FROM archived_records WHERE id = ?', [req.params.id]);
        const entry = found[0];
        if (!entry) return res.status(404).json({ error: 'Archive entry not found' });
        if (entry.restored_at) return res.status(409).json({ error: 'This record was already restored.' });

        const data = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
        const files = (typeof entry.files === 'string' ? JSON.parse(entry.files) : entry.files) || [];
        const row = data.row || {};
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const exists = async (table, id) => (await conn.query(`SELECT 1 FROM \`${table}\` WHERE id = ?`, [id]))[0].length > 0;

            switch (entry.entity_type) {
                case 'incident': {
                    // Option A: rebuild the base row + registry entry with their
                    // original ids (the `incidents` view is not insertable).
                    const reg = data.registry, baseRow = data.baseRow, source = data.source;
                    if (!reg || !baseRow || !source) {
                        throw new RestoreConflict('This record predates the Blotter/Incident split and cannot be auto-restored.');
                    }
                    const [[regExists]] = await conn.query('SELECT 1 AS x FROM record_registry WHERE registry_id = ?', [reg.registry_id]);
                    if (regExists) throw new RestoreConflict(`Record #${reg.registry_id} already exists.`);
                    const baseTable = source === 'incident' ? 'incident_records' : 'blotter_records';
                    await insertRow(conn, baseTable, baseRow);
                    await insertRow(conn, 'record_registry', reg);
                    if (data.patrol_metadata) await insertRow(conn, 'record_patrol_details', data.patrol_metadata);
                    if (data.linked_schedule_ids?.length) await conn.query(
                        'UPDATE patrol_schedule_records SET incident_id=? WHERE schedule_id IN (?) AND incident_id IS NULL',
                        [reg.registry_id, data.linked_schedule_ids]);
                    for (const ev of data.evidence || []) {
                        if (!(await exists('incident_evidence', ev.id))) await insertRow(conn, 'incident_evidence', ev);
                    }
                    break;
                }
                case 'incident_evidence': {
                    if (!(await exists('incidents', row.incident_id))) {
                        throw new RestoreConflict(`Its incident (#${row.incident_id}) is not active - restore the incident first.`);
                    }
                    if (await exists('incident_evidence', row.id)) throw new RestoreConflict('This evidence file already exists.');
                    await insertRow(conn, 'incident_evidence', row);
                    break;
                }
                case 'patrol_schedule': {
                    if (await exists('patrol_schedules', row.id)) throw new RestoreConflict(`Schedule #${row.id} already exists.`);
                    await insertRow(conn, 'patrol_schedules', row);
                    if (data.record_link) {
                        const link = { ...data.record_link };
                        if (link.incident_id && !(await exists('incidents', link.incident_id))) link.incident_id = null;
                        await insertRow(conn, 'patrol_schedule_records', link);
                    }
                    for (const link of data.tanod_links || []) if (await exists('tanods', link.tanod_id)) await insertRow(conn, 'patrol_schedule_tanods', link);
                    if ((data.log_ids || []).length) {
                        await conn.query('UPDATE patrol_logs SET schedule_id = ? WHERE id IN (?) AND schedule_id IS NULL', [row.id, data.log_ids]);
                    }
                    break;
                }
                case 'patrol_log': {
                    if (await exists('patrol_logs', row.id)) throw new RestoreConflict(`Patrol log #${row.id} already exists.`);
                    const logRow = { ...row };
                    if (logRow.schedule_id && !(await exists('patrol_schedules', logRow.schedule_id))) logRow.schedule_id = null;
                    await insertRow(conn, 'patrol_logs', logRow);
                    break;
                }
                case 'user':
                    await conn.query('UPDATE users SET is_active = 1 WHERE id = ?', [entry.entity_id]);
                    break;
                default:
                    throw new RestoreConflict(`Unknown archive type: ${entry.entity_type}`);
            }

            await conn.query('UPDATE archived_records SET restored_at = NOW(), restored_by = ? WHERE id = ?', [req.userId || null, entry.id]);
            await conn.commit();
        } catch (error) {
            await conn.rollback();
            conn.release();
            if (error instanceof RestoreConflict) return res.status(409).json({ error: error.message });
            console.error('❌ Error restoring archive entry:', error);
            return res.status(500).json({ error: 'Failed to restore record' });
        }
        conn.release();

        for (const f of files) archive.restoreFile(f.archived, f.original);

        if (entry.entity_type === 'incident') {
            try { await computeCartRiskFactors(row.id); } catch (e) { /* logged inside; record itself is back */ }
            heatmapCache.del('incidents');
        }

        if (req.userId) {
            await logAudit(req.userId, 'RESTORE_RECORD', ENTITY_TABLES[entry.entity_type] || entry.entity_type,
                entry.entity_id, null, { archive_id: entry.id, label: entry.label }, req);
        }
        res.json({ message: `${entry.label} restored.` });
    });
}

module.exports = { createArchive, registerArchiveRoutes };
