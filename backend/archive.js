// ============================================================
// ARCHIVE - nothing a user deletes is gone for good.
//
// Every delete route snapshots what it removes into `archived_records`
// (the row plus anything that would otherwise be lost with it - e.g. an
// incident's evidence rows, a schedule's assigned tanods) and moves any
// uploaded files into <uploads>/archive/ instead of unlinking them. An
// Administrator can browse the archive in Settings > Archive and restore
// a record exactly as it was.
//
// Users and tanods were already soft-deleted (is_active = 0); they get an
// archive row too so the Archive is the one place to find anything
// removed, and "restore" for them simply reactivates the account.
// ============================================================
const fs = require('fs');
const path = require('path');

const ENTITY_TABLES = {
    incident: 'incidents',
    incident_evidence: 'incident_evidence',
    patrol_schedule: 'patrol_schedules',
    patrol_log: 'patrol_logs',
    tanod_team: 'tanod_teams',
    user: 'users',
    tanod: 'tanod_record'
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

        // Users/tanods deactivated before the archive existed - give each
        // one an entry so they show up (and can be reactivated) there too.
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
        await pool.query(`
            INSERT INTO archived_records (entity_type, entity_id, label, data, deleted_at)
            SELECT 'tanod', t.id, CONCAT('Tanod: ', t.name, IF(t.position IS NULL, '', CONCAT(' (', t.position, ')'))),
                   JSON_OBJECT('row', JSON_OBJECT('id', t.id, 'name', t.name, 'username', t.username, 'position', t.position,
                                                  'contact_no', t.contact_no, 'team_id', t.team_id)),
                   t.updated_at
            FROM tanod_record t
            WHERE t.is_active = 0 AND NOT EXISTS (
                SELECT 1 FROM archived_records a WHERE a.entity_type = 'tanod' AND a.entity_id = t.id AND a.restored_at IS NULL)
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

    // Marks the open archive entry for a user/tanod as restored - used when
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
    app.get('/api/archive', authenticate, requireRole(['Administrator']), async (req, res) => {
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

    app.post('/api/archive/:id/restore', authenticate, requireRole(['Administrator']), async (req, res) => {
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
                    if (await exists('incidents', row.id)) throw new RestoreConflict(`Incident #${row.id} already exists.`);
                    await insertRow(conn, 'incidents', row);
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
                    const tanodIds = data.tanod_ids || [];
                    if (tanodIds.length) {
                        const [living] = await conn.query('SELECT id FROM tanod_record WHERE id IN (?)', [tanodIds]);
                        const values = living.map(t => [row.id, t.id]);
                        if (values.length) await conn.query('INSERT IGNORE INTO patrol_schedule_tanods (schedule_id, tanod_id) VALUES ?', [values]);
                        await conn.query('UPDATE patrol_schedules SET assigned_tanods = ? WHERE id = ?', [values.length, row.id]);
                    }
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
                case 'tanod_team': {
                    if (await exists('tanod_teams', row.id)) throw new RestoreConflict(`Team #${row.id} already exists.`);
                    const [sameName] = await conn.query('SELECT 1 FROM tanod_teams WHERE name = ?', [row.name]);
                    if (sameName.length) throw new RestoreConflict(`A team named "${row.name}" already exists.`);
                    await insertRow(conn, 'tanod_teams', row);
                    if ((data.member_ids || []).length) {
                        await conn.query('UPDATE tanod_record SET team_id = ? WHERE id IN (?) AND team_id IS NULL', [row.id, data.member_ids]);
                    }
                    break;
                }
                case 'user':
                    await conn.query('UPDATE users SET is_active = 1 WHERE id = ?', [entry.entity_id]);
                    break;
                case 'tanod':
                    await conn.query('UPDATE tanod_record SET is_active = 1 WHERE id = ?', [entry.entity_id]);
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
