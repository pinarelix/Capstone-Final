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
        contact_no VARCHAR(30) NOT NULL DEFAULT '',
        address VARCHAR(255) NOT NULL DEFAULT '',
        birth_date DATE NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    for (const statement of [
        "ALTER TABLE tanods ADD COLUMN contact_no VARCHAR(30) NOT NULL DEFAULT '' AFTER name",
        "ALTER TABLE tanods ADD COLUMN address VARCHAR(255) NOT NULL DEFAULT '' AFTER contact_no",
        "ALTER TABLE tanods ADD COLUMN birth_date DATE NULL AFTER address",
        "ALTER TABLE tanods ADD COLUMN person_type ENUM('Tanod','Team Leader') NOT NULL DEFAULT 'Tanod' AFTER name",
        "ALTER TABLE tanods ADD COLUMN linked_user_id INT NULL AFTER person_type"
    ]) {
        try { await conn.query(statement); } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
    }
    try { await conn.query("ALTER TABLE tanods ADD UNIQUE KEY uq_tanod_linked_user (linked_user_id)"); }
    catch (error) { if (error.code !== 'ER_DUP_KEYNAME') throw error; }
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_teams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        leader_user_id INT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_patrol_team_name (name),
        CONSTRAINT fk_patrol_team_leader FOREIGN KEY (leader_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_volunteers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        contact_no VARCHAR(30) NOT NULL DEFAULT '',
        address VARCHAR(255) NOT NULL DEFAULT '',
        birth_date DATE NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    try { await conn.query("ALTER TABLE tanods ADD COLUMN primary_team_id INT NULL"); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_team_tanods (
        team_id INT NOT NULL,
        tanod_id INT NOT NULL,
        role VARCHAR(40) NOT NULL DEFAULT 'Tanod',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (team_id, tanod_id),
        FOREIGN KEY (team_id) REFERENCES patrol_teams(id) ON DELETE CASCADE,
        FOREIGN KEY (tanod_id) REFERENCES tanods(id) ON DELETE CASCADE
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_team_assignments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        team_id INT NOT NULL,
        person_type ENUM('Tanod','Volunteer') NOT NULL,
        person_id INT NOT NULL,
        assignment_type ENUM('Primary','Temporary') NOT NULL DEFAULT 'Primary',
        starts_on DATE NULL,
        ends_on DATE NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (team_id) REFERENCES patrol_teams(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_patrol_assignment_person (person_type, person_id, is_active),
        INDEX idx_patrol_assignment_team (team_id, is_active)
    )`);
    try { await conn.query("ALTER TABLE patrol_team_assignments MODIFY COLUMN person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL"); }
    catch (error) { if (!['ER_DUP_FIELDNAME', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD'].includes(error.code)) throw error; }
    for (const statement of [
        "ALTER TABLE patrol_team_tanods ADD COLUMN role VARCHAR(40) NOT NULL DEFAULT 'Tanod'",
        "ALTER TABLE patrol_team_tanods ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1",
        "ALTER TABLE patrol_team_tanods ADD COLUMN assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
    ]) {
        try { await conn.query(statement); } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
    }
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
    try { await conn.query("ALTER TABLE patrol_schedule_records ADD COLUMN team_id INT NULL AFTER team_name"); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_schedule_tanods (
        schedule_id INT NOT NULL,
        tanod_id INT NOT NULL,
        PRIMARY KEY (schedule_id, tanod_id),
        FOREIGN KEY (schedule_id) REFERENCES patrol_schedules(id) ON DELETE CASCADE,
        FOREIGN KEY (tanod_id) REFERENCES tanods(id)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_schedule_personnel (
        schedule_id INT NOT NULL,
        person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL,
        person_id INT NOT NULL,
        PRIMARY KEY (schedule_id, person_type, person_id),
        FOREIGN KEY (schedule_id) REFERENCES patrol_schedules(id) ON DELETE CASCADE
    )`);
    try { await conn.query("ALTER TABLE patrol_schedule_personnel MODIFY COLUMN person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL"); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
    for (const statement of [
        "ALTER TABLE patrol_schedules ADD COLUMN series_id INT NULL",
        "ALTER TABLE patrol_schedules ADD INDEX idx_patrol_schedule_series (series_id)"
    ]) {
        try { await conn.query(statement); } catch (error) {
            if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(error.code)) throw error;
        }
    }
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_schedule_series (
        id INT AUTO_INCREMENT PRIMARY KEY,
        recurrence_type ENUM('single','daily','weekly','custom') NOT NULL DEFAULT 'single',
        recurrence_interval TINYINT UNSIGNED NOT NULL DEFAULT 1,
        recurrence_days JSON NULL,
        starts_on DATE NOT NULL,
        ends_on DATE NULL,
        created_by INT NULL,
        status ENUM('Active','Cancelled') NOT NULL DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_schedule_team_snapshots (
        schedule_id INT NOT NULL,
        team_name VARCHAR(100) NOT NULL DEFAULT '',
        leader_user_id INT NULL,
        leader_name VARCHAR(100) NOT NULL DEFAULT '',
        tanod_id INT NOT NULL,
        tanod_name VARCHAR(100) NOT NULL,
        contact_no VARCHAR(30) NOT NULL DEFAULT '',
        address VARCHAR(255) NOT NULL DEFAULT '',
        role VARCHAR(40) NOT NULL DEFAULT 'Tanod',
        PRIMARY KEY (schedule_id, tanod_id),
        FOREIGN KEY (schedule_id) REFERENCES patrol_schedules(id) ON DELETE CASCADE
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_schedule_personnel_snapshots (
        schedule_id INT NOT NULL,
        person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL,
        person_id INT NOT NULL,
        person_name VARCHAR(100) NOT NULL,
        contact_no VARCHAR(30) NOT NULL DEFAULT '',
        address VARCHAR(255) NOT NULL DEFAULT '',
        team_name VARCHAR(100) NOT NULL DEFAULT '',
        assignment_type VARCHAR(20) NOT NULL DEFAULT 'Primary',
        PRIMARY KEY (schedule_id, person_type, person_id),
        FOREIGN KEY (schedule_id) REFERENCES patrol_schedules(id) ON DELETE CASCADE
    )`);
    try { await conn.query("ALTER TABLE patrol_schedule_personnel_snapshots MODIFY COLUMN person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL"); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_schedule_routes (
        schedule_id INT PRIMARY KEY,
        route_name VARCHAR(120) NOT NULL DEFAULT '',
        routine_type ENUM('Incident Response','Routine Patrol','Multi-location Route') NOT NULL DEFAULT 'Incident Response',
        FOREIGN KEY (schedule_id) REFERENCES patrol_schedules(id) ON DELETE CASCADE
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_schedule_route_stops (
        id INT AUTO_INCREMENT PRIMARY KEY,
        schedule_id INT NOT NULL,
        stop_order INT NOT NULL,
        location VARCHAR(100) NOT NULL,
        address VARCHAR(255) NOT NULL DEFAULT '',
        latitude DECIMAL(10,8) NULL,
        longitude DECIMAL(11,8) NULL,
        dwell_minutes INT NOT NULL DEFAULT 0,
        FOREIGN KEY (schedule_id) REFERENCES patrol_schedules(id) ON DELETE CASCADE,
        UNIQUE KEY uq_patrol_route_stop (schedule_id, stop_order)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_log_attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        log_id INT NOT NULL,
        person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL,
        person_id INT NOT NULL,
        attendance_status ENUM('Present','Absent','Late','Excused') NOT NULL DEFAULT 'Present',
        notes VARCHAR(255) NOT NULL DEFAULT '',
        FOREIGN KEY (log_id) REFERENCES patrol_logs(id) ON DELETE CASCADE,
        UNIQUE KEY uq_patrol_attendance (log_id, person_type, person_id)
    )`);
    try { await conn.query("ALTER TABLE patrol_log_attendance MODIFY COLUMN person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL"); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }

    // Route planner rewrite: a reusable route is separate from each team's
    // dated AM/PM deployment. The legacy calendar tables remain in place for
    // backward-compatible API consumers, while the new scheduler uses these
    // tables exclusively.
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_routes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        route_name VARCHAR(120) NOT NULL,
        source_type ENUM('Suggested','Manual') NOT NULL DEFAULT 'Manual',
        status ENUM('Suggested','Draft','Active','Completed','Cancelled') NOT NULL DEFAULT 'Draft',
        suggested_for_date DATE NULL,
        geometry_json LONGTEXT NULL,
        notes VARCHAR(1000) NOT NULL DEFAULT '',
        created_by INT NULL,
        updated_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_patrol_route_status (status),
        INDEX idx_patrol_route_suggested_date (suggested_for_date),
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_route_stops (
        id INT AUTO_INCREMENT PRIMARY KEY,
        route_id INT NOT NULL,
        stop_order INT NOT NULL,
        incident_id INT NOT NULL,
        location VARCHAR(100) NOT NULL,
        address VARCHAR(255) NOT NULL DEFAULT '',
        latitude DECIMAL(10,8) NOT NULL,
        longitude DECIMAL(11,8) NOT NULL,
        dwell_minutes INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_patrol_route_stop_order (route_id, stop_order),
        UNIQUE KEY uq_patrol_route_stop_record (route_id, incident_id),
        INDEX idx_patrol_route_stop_record (incident_id),
        FOREIGN KEY (route_id) REFERENCES patrol_routes(id) ON DELETE CASCADE,
        FOREIGN KEY (incident_id) REFERENCES record_registry(registry_id) ON DELETE RESTRICT
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_route_deployments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        route_id INT NOT NULL,
        scheduled_date DATE NOT NULL,
        shift ENUM('AM','PM') NOT NULL,
        team_id INT NULL,
        team_name VARCHAR(100) NOT NULL DEFAULT '',
        status ENUM('Suggested','Draft','Active','Completed','Cancelled') NOT NULL DEFAULT 'Draft',
        notes VARCHAR(1000) NOT NULL DEFAULT '',
        created_by INT NULL,
        updated_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_patrol_deployment_date (scheduled_date, shift),
        INDEX idx_patrol_deployment_status (status),
        FOREIGN KEY (route_id) REFERENCES patrol_routes(id) ON DELETE CASCADE,
        FOREIGN KEY (team_id) REFERENCES patrol_teams(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_route_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deployment_id INT NOT NULL,
        patrol_date DATE NOT NULL,
        status ENUM('Completed','Partial','Failed') NOT NULL DEFAULT 'Completed',
        report TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_patrol_route_log_deployment (deployment_id),
        INDEX idx_patrol_route_log_date (patrol_date),
        FOREIGN KEY (deployment_id) REFERENCES patrol_route_deployments(id) ON DELETE CASCADE
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_route_log_attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        log_id INT NOT NULL,
        person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL,
        person_id INT NOT NULL,
        attendance_status ENUM('Present','Absent','Late','Excused') NOT NULL DEFAULT 'Present',
        notes VARCHAR(255) NOT NULL DEFAULT '',
        UNIQUE KEY uq_patrol_route_attendance (log_id, person_type, person_id),
        FOREIGN KEY (log_id) REFERENCES patrol_route_logs(id) ON DELETE CASCADE
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS incident_patrol_risk_state (
        incident_id INT PRIMARY KEY,
        completed_patrol_count INT NOT NULL DEFAULT 0,
        risk_multiplier DECIMAL(10,6) NOT NULL DEFAULT 1.000000,
        base_cart_score DECIMAL(5,2) NULL,
        adjusted_risk_score DECIMAL(5,2) NULL,
        is_monitoring_archived TINYINT(1) NOT NULL DEFAULT 0,
        archived_at DATETIME NULL,
        reactivated_at DATETIME NULL,
        reactivated_by INT NULL,
        reactivated_completed_count INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_patrol_risk_archive (is_monitoring_archived),
        FOREIGN KEY (incident_id) REFERENCES record_registry(registry_id) ON DELETE CASCADE,
        FOREIGN KEY (reactivated_by) REFERENCES users(id) ON DELETE SET NULL
    )`);
    const [thresholdRows] = await conn.query("SELECT setting_value FROM system_settings WHERE setting_key='default_danger_threshold_moderate' LIMIT 1");
    const lowThreshold = Number(thresholdRows[0]?.setting_value) || 34;
    await conn.query(`INSERT IGNORE INTO incident_patrol_risk_state
        (incident_id, completed_patrol_count, risk_multiplier, base_cart_score, adjusted_risk_score, is_monitoring_archived, archived_at)
        SELECT s.incident_id, COUNT(DISTINCT d.id), POW(0.85, COUNT(DISTINCT d.id)), rf.total_risk_score,
               ROUND(rf.total_risk_score * POW(0.85, COUNT(DISTINCT d.id)), 2),
               CASE WHEN COUNT(DISTINCT d.id) >= 3 AND rf.total_risk_score * POW(0.85, COUNT(DISTINCT d.id)) < ? THEN 1 ELSE 0 END,
               CASE WHEN COUNT(DISTINCT d.id) >= 3 AND rf.total_risk_score * POW(0.85, COUNT(DISTINCT d.id)) < ? THEN NOW() ELSE NULL END
        FROM patrol_route_stops s
        JOIN patrol_route_deployments d ON d.route_id=s.route_id
        JOIN patrol_route_logs l ON l.deployment_id=d.id AND l.status='Completed'
        LEFT JOIN cart_risk_factors rf ON rf.incident_id=s.incident_id
        GROUP BY s.incident_id, rf.total_risk_score`, [lowThreshold, lowThreshold]);

    await conn.query(`CREATE TABLE IF NOT EXISTS patrol_schedule_source_records (
        schedule_id INT NOT NULL,
        incident_id INT NOT NULL,
        record_type VARCHAR(30) NOT NULL DEFAULT 'Incident',
        selected_area VARCHAR(100) NOT NULL DEFAULT '',
        PRIMARY KEY (schedule_id, incident_id),
        FOREIGN KEY (schedule_id) REFERENCES patrol_schedules(id) ON DELETE CASCADE,
        FOREIGN KEY (incident_id) REFERENCES record_registry(registry_id) ON DELETE RESTRICT
    )`);
    await conn.query(`INSERT IGNORE INTO patrol_schedule_source_records (schedule_id, incident_id, record_type, selected_area)
        SELECT psr.schedule_id, psr.incident_id, CASE WHEN r.source='blotter' THEN 'Blotter' ELSE 'Incident' END, COALESCE(i.street_name, ps.location)
        FROM patrol_schedule_records psr
        JOIN patrol_schedules ps ON ps.id = psr.schedule_id
        LEFT JOIN record_registry r ON r.registry_id = psr.incident_id
        LEFT JOIN incidents i ON i.id = psr.incident_id
        WHERE psr.incident_id IS NOT NULL`);
    for (const statement of [
        "ALTER TABLE patrol_schedules ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila'",
        "ALTER TABLE patrol_schedules ADD COLUMN start_at DATETIME NULL",
        "ALTER TABLE patrol_schedules ADD COLUMN end_at DATETIME NULL"
    ]) {
        try { await conn.query(statement); } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
    }
}
module.exports = { migrateRecordPatrol };
