// Seed an initial Executive Officer account.
//
// Usage:
//   node scripts/seed-admin.js
//
// This will create (or reactivate) a user with:
//   username: admin
//   password: admin123
//   role:     Executive Officer
//
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path   = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function seed() {
    const conn = await mysql.createConnection({
        host:     process.env.DB_HOST || 'localhost',
        port:     parseInt(process.env.DB_PORT, 10) || 3306,
        user:     process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'brgydata',
    });

    try {
        const username = 'admin';
        const password = 'admin123';
        const name     = 'Executive Officer';
        const role     = 'Executive Officer';

        const hash = await bcrypt.hash(password, 10);

        const [existing] = await conn.query(
            'SELECT id, is_active FROM users WHERE username = ?',
            [username]
        );

        if (existing.length > 0) {
            await conn.query(
                'UPDATE users SET name = ?, password_hash = ?, role = ?, is_active = 1 WHERE id = ?',
                [name, hash, role, existing[0].id]
            );
            console.log(`✅ Reactivated existing user "${username}" (id=${existing[0].id}) with fresh password.`);
        } else {
            const [result] = await conn.query(
                'INSERT INTO users (name, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)',
                [name, username, hash, role]
            );
            console.log(`✅ Created user "${username}" (id=${result.insertId}).`);
        }

        console.log(`   Login: ${username} / ${password}`);
    } finally {
        await conn.end();
    }
}

seed().catch(err => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
});
