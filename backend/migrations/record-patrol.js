// Additive and idempotent. Operational records and their original narratives
// remain untouched; notes/eligibility and record-linked schedules live here.
async function migrateRecordPatrol(conn) {
    await conn.query(`CREATE TABLE IF NOT EXISTS record_patrol_details (
        incident_id INT PRIMARY KEY,
        notes VARCHAR(200) NOT NULL DEFAULT '',
        patrol_override ENUM('auto','include','exclude') NOT NULL DEFAULT 'auto',
        updated_by INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (incident_id) REFERENCES record_registry(registry_id) ON DELETE CASCADE
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS tanods (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_schedule_records (
        schedule_id INT PRIMARY KEY,
        incident_id INT NULL,
        scheduled_date DATE NULL,
        priority ENUM('High','Moderate','Low') NOT NULL DEFAULT 'Low',
        exact_address VARCHAR(255) NOT NULL DEFAULT '',
        FOREIGN KEY (schedule_id) REFERENCES patrol_schedules(id) ON DELETE CASCADE,
        FOREIGN KEY (incident_id) REFERENCES record_registry(registry_id) ON DELETE SET NULL,
        INDEX idx_patrol_record (incident_id)
    )`);
    const [teamNameColumns] = await conn.query(`
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'patrol_schedule_records' AND COLUMN_NAME = 'team_name'
    `);
    if (teamNameColumns.length === 0) {
        await conn.query("ALTER TABLE patrol_schedule_records ADD COLUMN team_name VARCHAR(100) NOT NULL DEFAULT '' AFTER exact_address");
    }
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_schedule_tanods (
        schedule_id INT NOT NULL,
        tanod_id INT NOT NULL,
        PRIMARY KEY (schedule_id, tanod_id),
        FOREIGN KEY (schedule_id) REFERENCES patrol_schedules(id) ON DELETE CASCADE,
        FOREIGN KEY (tanod_id) REFERENCES tanods(id)
    )`);
}
module.exports = { migrateRecordPatrol };
