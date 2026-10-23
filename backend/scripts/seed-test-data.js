// Seed realistic test data for development/demo.
//
// Usage:  node scripts/seed-test-data.js
//
// Assumes schema.sql has already been imported (tables + demo users exist).
// Safe to re-run — it skips inserts when data already exists.

const mysql  = require('mysql2/promise');
const path   = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function seed() {
    const conn = await mysql.createConnection({
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT, 10) || 3306,
        user:     process.env.DB_USER     || 'root',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME     || 'brgydata',
    });

    try {
        // ── Check if data already exists ──────────────────────────
        const [existing] = await conn.query('SELECT COUNT(*) as c FROM incidents');
        if (existing[0].c > 0) {
            console.log('⏭  Test data already present — skipping.');
            return;
        }

        // ── System settings (CART weights, session config) ────────
        const settings = [
            ['cart_time_weight',       '0.20', 'CART time-of-day weight'],
            ['cart_day_weight',        '0.15', 'CART day-of-week weight'],
            ['cart_type_weight',       '0.25', 'CART incident-type weight'],
            ['cart_location_weight',   '0.25', 'CART location-frequency weight'],
            ['cart_frequency_weight',  '0.15', 'CART recency weight'],
            ['session_timeout',        '30',   'Session timeout in minutes'],
            ['max_login_attempts',     '5',    'Max failed logins before lockout'],
            ['lockout_duration',       '15',   'Lockout duration in minutes'],
        ];
        for (const [key, val, desc] of settings) {
            await conn.query(
                `INSERT IGNORE INTO system_settings (setting_key, setting_value, description)
                 VALUES (?, ?, ?)`,
                [key, val, desc]
            );
        }
        console.log('✅ System settings seeded.');

        // ── Street list (from location_coordinates already in schema) ─
        const [streets] = await conn.query('SELECT location FROM location_coordinates');
        const streetNames = streets.map(s => s.location);
        console.log(`   ${streetNames.length} streets available from location_coordinates.`);

        // ── Incidents (30 realistic records) ──────────────────────
        const incidentTypes = [
            'Theft', 'Robbery', 'Physical Assault', 'Verbal Assault',
            'Vandalism', 'Noise Complaint', 'Trespassing', 'Drug-related',
            'Domestic Violence', 'Public Intoxication', 'Snatching',
            'Alarm Response', 'Illegal Parking', 'Suspicious Person',
        ];
        const statuses = ['Open', 'Under Investigation', 'Resolved', 'Closed'];
        const priorities = ['Low', 'Normal', 'High', 'Critical'];
        const names = [
            'Maria Santos', 'Juan Dela Cruz', 'Ana Reyes', 'Pedro Garcia',
            'Rosa Mendoza', 'Carlos Cruz', 'Elena Torres', 'Miguel Ramos',
            'Lorna Bautista', 'Roberto Flores', 'Teresa Villanueva',
        ];

        const incidents = [];
        for (let i = 0; i < 30; i++) {
            const street = streetNames[i % streetNames.length];
            const type   = incidentTypes[i % incidentTypes.length];
            const month  = String(((i % 6) + 5)).padStart(2, '0');   // May–Oct 2026
            const day    = String((i % 28) + 1).padStart(2, '0');
            const hour   = (6 + (i * 3) % 18);                       // 06:00–23:00
            const date   = `2026-${month}-${day}`;
            const time   = `${String(hour).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00`;

            const timeOfDay = hour < 6 ? 'Dawn' : hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Night';
            const dow       = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i % 7];
            const isWeekend = (dow === 'Saturday' || dow === 'Sunday') ? 1 : 0;

            incidents.push([
                type, date, time, street,
                `Near ${street}`, null, statuses[i % statuses.length],
                `Test incident: ${type} reported at ${street}.`,
                null, 'Calculated by System',
                timeOfDay, dow, isWeekend, null, null,
                names[i % names.length],
                `Witness statement for incident #${i + 1}.`,
                null, priorities[i % priorities.length],
            ]);
        }

        await conn.query(
            `INSERT INTO incidents
             (incident_type, date, time, street_name,
              address, reporter_id, status, description,
              recommended_action, danger_level,
              time_of_day, day_of_week, is_weekend, photo_path, blotter_number,
              reported_by_name, statement, persons_involved, priority)
             VALUES ?`,
            [incidents]
        );
        console.log('✅ 30 incidents seeded.');

        // ── CART risk factors for each incident ───────────────────
        const [insertedIncidents] = await conn.query('SELECT id FROM incidents ORDER BY id');
        const riskLevels = ['Low Risk', 'Moderate Risk', 'High Risk'];
        for (const row of insertedIncidents) {
            const t = +(Math.random() * 10).toFixed(2);
            const d = +(Math.random() * 10).toFixed(2);
            const ty = +(Math.random() * 10).toFixed(2);
            const l = +(Math.random() * 10).toFixed(2);
            const f = +(Math.random() * 10).toFixed(2);
            const total = +((t + d + ty + l + f) / 5).toFixed(2);
            const level = total > 6 ? 'High Risk' : total > 3.5 ? 'Moderate Risk' : 'Low Risk';
            await conn.query(
                `INSERT INTO cart_risk_factors
                 (incident_id, time_risk_score, day_risk_score, type_risk_score,
                  location_risk_score, frequency_risk_score, total_risk_score,
                  danger_level, decision_path)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [row.id, t, d, ty, l, f, total, level,
                 `time(${t}) → day(${d}) → type(${ty}) → location(${l}) → freq(${f})`]
            );
        }
        console.log('✅ CART risk factors seeded for all incidents.');

        // ── Look up admin user ID for FK references ───────────────
        const [admins] = await conn.query("SELECT id FROM users WHERE username = 'admin' LIMIT 1");
        const adminId = admins.length ? admins[0].id : null;

        // ── CART decision rules ───────────────────────────────────
        const rules = [
            ['High frequency + Night', 'risk_classification', 'frequency > 5 AND time_of_day = Night', 'High Risk', 'Increase patrol frequency', 1],
            ['Weekend + Drug-related',  'risk_classification', 'is_weekend = 1 AND type = Drug-related',  'High Risk', 'Joint PNP operation',       2],
            ['Low frequency + Morning', 'risk_classification', 'frequency <= 2 AND time_of_day = Morning','Low Risk',  'Routine patrol',            3],
            ['Moderate baseline',       'risk_classification', 'total_score BETWEEN 3.5 AND 6',           'Moderate Risk','Standard patrol',         4],
            ['Theft hotspot',           'risk_classification', 'type = Theft AND location_score > 7',     'High Risk', 'Dedicated foot patrol',     5],
            ['Resolved follow-up',      'follow_up',          'status = Resolved AND days_since < 7',    null,        'Follow-up visit',           6],
            ['New area alert',          'risk_classification', 'location_score < 2 AND frequency > 3',    'Moderate Risk','New hotspot monitoring',  7],
        ];
        for (const [name, rtype, cond, level, action, prio] of rules) {
            await conn.query(
                `INSERT INTO cart_decision_rules
                 (rule_name, rule_type, conditions, result_risk_level, result_action, priority, is_active, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
                [name, rtype, cond, level, action, prio, adminId]
            );
        }
        console.log('✅ 7 CART decision rules seeded.');

        // ── CART analysis log ─────────────────────────────────────
        await conn.query(
            `INSERT INTO cart_analysis_log
             (analysis_type, date_range_start, date_range_end,
              total_streets_analyzed, total_incidents_analyzed,
              high_risk_count, moderate_risk_count, low_risk_count,
              execution_time_ms, status, triggered_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ['risk_prediction', '2026-05-01', '2026-10-23',
             streetNames.length, 30, 8, 14, 8, 342, 'completed', adminId]
        );
        console.log('✅ CART analysis log seeded.');

        // ── Patrol schedules (10) ─────────────────────────────────
        const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
        for (let i = 0; i < 10; i++) {
            const street = streetNames[i * 3 % streetNames.length];
            const [coords] = await conn.query(
                'SELECT latitude, longitude FROM location_coordinates WHERE location = ?', [street]
            );
            const lat = coords.length ? coords[0].latitude  : null;
            const lng = coords.length ? coords[0].longitude : null;
            const startH = 6 + (i * 2) % 18;
            const endH   = startH + 2;
            await conn.query(
                `INSERT INTO patrol_schedules
                 (location, start_time, end_time, day_of_week, reason, status, latitude, longitude)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [street,
                 `${String(startH).padStart(2,'0')}:00:00`,
                 `${String(endH).padStart(2,'0')}:00:00`,
                 days[i % 7],
                 `CART-recommended patrol for ${street}`,
                 i < 8 ? 'Active' : 'Completed',
                 lat, lng]
            );
        }
        console.log('✅ 10 patrol schedules seeded.');

        // ── Patrol logs (6) ───────────────────────────────────────
        const [schedules] = await conn.query('SELECT id FROM patrol_schedules LIMIT 6');
        for (let i = 0; i < schedules.length; i++) {
            const day = String((i % 28) + 1).padStart(2, '0');
            await conn.query(
                `INSERT INTO patrol_logs (schedule_id, report, status, patrol_date)
                 VALUES (?, ?, ?, ?)`,
                [schedules[i].id,
                 `Patrol completed. Area was ${i % 2 === 0 ? 'quiet' : 'had minor activity'}. No escalation needed.`,
                 'Completed',
                 `2026-${String(((i % 3) + 8)).padStart(2,'0')}-${day}`]
            );
        }
        console.log('✅ 6 patrol logs seeded.');

        // ── Area risk decay ───────────────────────────────────────
        for (let i = 0; i < 15; i++) {
            const street = streetNames[i * 4 % streetNames.length];
            await conn.query(
                `INSERT IGNORE INTO area_risk_decay (location, decay_amount)
                 VALUES (?, ?)`,
                [street, +(Math.random() * 3).toFixed(2)]
            );
        }
        console.log('✅ Area risk decay data seeded.');

        console.log('\n🎉 All test data seeded successfully!');
        console.log('   Demo logins:');
        console.log('     admin / admin123       (Executive Officer)');
        console.log('     captain / captain123   (Kagawad)');
        console.log('     deskofficer / desk123  (Team Leader)');

    } finally {
        await conn.end();
    }
}

seed().catch(err => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
});
