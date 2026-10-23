const request = require('supertest');
const bcrypt  = require('bcryptjs');
const { app, pool } = require('../server');

// ── M-7: audit_logs and login_history must not CASCADE-delete on user removal ──

describe('M-7: Audit trail preserved when user is deleted', () => {
    let userId;
    const username = 'p2_m7_test';
    const password = 'M7TestPass!';

    beforeAll(async () => {
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            `INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, 'Kagawad', 1)`,
            ['P2 M7 Test', username, hash]
        );
        userId = result.insertId;

        // Create a login to generate audit_logs and login_history entries
        await request(app).post('/api/auth/login').send({ username, password });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM login_attempts WHERE username = ?', [username]);
        await pool.query('DELETE FROM password_resets WHERE user_id = ?', [userId]);
        await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
        await pool.query('DELETE FROM audit_logs WHERE user_id = ?', [userId]);
        await pool.query('DELETE FROM audit_logs WHERE user_id IS NULL AND new_data LIKE ?', [`%${username}%`]);
        await pool.query('DELETE FROM login_history WHERE user_id = ?', [userId]);
        await pool.query('DELETE FROM login_history WHERE user_id IS NULL AND username = ?', [username]);
        await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    });

    test('audit_logs FK is ON DELETE SET NULL, not CASCADE', async () => {
        const [fks] = await pool.query(`
            SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE()
              AND TABLE_NAME = 'audit_logs'
              AND CONSTRAINT_NAME = 'audit_logs_ibfk_1'
        `);
        expect(fks.length).toBe(1);
        expect(fks[0].DELETE_RULE).toBe('SET NULL');
    });

    test('login_history FK is ON DELETE SET NULL, not CASCADE', async () => {
        const [fks] = await pool.query(`
            SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE()
              AND TABLE_NAME = 'login_history'
              AND CONSTRAINT_NAME = 'login_history_ibfk_1'
        `);
        expect(fks.length).toBe(1);
        expect(fks[0].DELETE_RULE).toBe('SET NULL');
    });

    test('hard-deleting a user preserves audit_logs rows with user_id set to NULL', async () => {
        // Confirm audit log entries exist for this user
        const [beforeAudit] = await pool.query(
            'SELECT COUNT(*) AS cnt FROM audit_logs WHERE user_id = ?', [userId]
        );
        expect(beforeAudit[0].cnt).toBeGreaterThan(0);

        const [beforeHistory] = await pool.query(
            'SELECT COUNT(*) AS cnt FROM login_history WHERE user_id = ?', [userId]
        );
        expect(beforeHistory[0].cnt).toBeGreaterThan(0);

        // Hard-delete the user
        await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
        await pool.query('DELETE FROM password_resets WHERE user_id = ?', [userId]);
        await pool.query('DELETE FROM users WHERE id = ?', [userId]);

        // Audit logs should still exist but with user_id = NULL
        const [afterAudit] = await pool.query(
            "SELECT COUNT(*) AS cnt FROM audit_logs WHERE user_id IS NULL AND new_data LIKE ?",
            [`%${username}%`]
        );
        expect(afterAudit[0].cnt).toBeGreaterThan(0);

        const [afterHistory] = await pool.query(
            'SELECT COUNT(*) AS cnt FROM login_history WHERE user_id IS NULL AND username = ?',
            [username]
        );
        expect(afterHistory[0].cnt).toBeGreaterThan(0);

        // Re-insert user so afterAll cleanup doesn't error
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            `INSERT INTO users (id, name, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, 'Kagawad', 1)`,
            [userId, 'P2 M7 Test', username, hash]
        );
    });
});

// ── T-8: MySQL bind-address check ──

describe('T-8: MySQL bind-address visibility', () => {
    test('bind_address variable is queryable', async () => {
        const [rows] = await pool.query("SHOW VARIABLES LIKE 'bind_address'");
        expect(rows.length).toBe(1);
        expect(rows[0].Variable_name).toBe('bind_address');
        // We don't assert the value because it's infrastructure config,
        // but the startup check in server.js warns if it's not localhost
    });
});
