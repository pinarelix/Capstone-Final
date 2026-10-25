-- Patrol calendar and roster history (idempotent companion migration).
-- Runtime migration is also applied by backend/migrations/record-patrol.js.
ALTER TABLE patrol_schedules ADD COLUMN IF NOT EXISTS series_id INT NULL;
ALTER TABLE patrol_schedule_records ADD COLUMN IF NOT EXISTS team_id INT NULL;
ALTER TABLE patrol_team_tanods ADD COLUMN IF NOT EXISTS role VARCHAR(40) NOT NULL DEFAULT 'Tanod';
ALTER TABLE patrol_team_tanods ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE patrol_team_tanods ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE tanods ADD COLUMN IF NOT EXISTS primary_team_id INT NULL;
ALTER TABLE tanods ADD COLUMN IF NOT EXISTS person_type ENUM('Tanod','Team Leader') NOT NULL DEFAULT 'Tanod';
ALTER TABLE tanods ADD COLUMN IF NOT EXISTS linked_user_id INT NULL;
ALTER TABLE patrol_schedules ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila';
ALTER TABLE patrol_schedules ADD COLUMN IF NOT EXISTS start_at DATETIME NULL;
ALTER TABLE patrol_schedules ADD COLUMN IF NOT EXISTS end_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS patrol_volunteers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    contact_no VARCHAR(30) NOT NULL DEFAULT '',
    address VARCHAR(255) NOT NULL DEFAULT '',
    birth_date DATE NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS patrol_team_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    team_id INT NOT NULL,
    person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL,
    person_id INT NOT NULL,
    assignment_type ENUM('Primary','Temporary') NOT NULL DEFAULT 'Primary',
    starts_on DATE NULL,
    ends_on DATE NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
ALTER TABLE patrol_team_assignments MODIFY COLUMN person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL;
CREATE TABLE IF NOT EXISTS patrol_schedule_personnel (
    schedule_id INT NOT NULL,
    person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL,
    person_id INT NOT NULL,
    PRIMARY KEY (schedule_id, person_type, person_id)
);
ALTER TABLE patrol_schedule_personnel MODIFY COLUMN person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL;
CREATE TABLE IF NOT EXISTS patrol_schedule_personnel_snapshots (
    schedule_id INT NOT NULL,
    person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL,
    person_id INT NOT NULL,
    person_name VARCHAR(100) NOT NULL,
    contact_no VARCHAR(30) NOT NULL DEFAULT '',
    address VARCHAR(255) NOT NULL DEFAULT '',
    team_name VARCHAR(100) NOT NULL DEFAULT '',
    assignment_type VARCHAR(20) NOT NULL DEFAULT 'Primary',
    PRIMARY KEY (schedule_id, person_type, person_id)
);
ALTER TABLE patrol_schedule_personnel_snapshots MODIFY COLUMN person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL;
CREATE TABLE IF NOT EXISTS patrol_schedule_routes (
    schedule_id INT PRIMARY KEY,
    route_name VARCHAR(120) NOT NULL DEFAULT '',
    routine_type ENUM('Incident Response','Routine Patrol','Multi-location Route') NOT NULL DEFAULT 'Incident Response'
);
CREATE TABLE IF NOT EXISTS patrol_schedule_route_stops (
    id INT AUTO_INCREMENT PRIMARY KEY,
    schedule_id INT NOT NULL,
    stop_order INT NOT NULL,
    location VARCHAR(100) NOT NULL,
    address VARCHAR(255) NOT NULL DEFAULT '',
    latitude DECIMAL(10,8) NULL,
    longitude DECIMAL(11,8) NULL,
    dwell_minutes INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_patrol_route_stop (schedule_id, stop_order)
);
CREATE TABLE IF NOT EXISTS patrol_log_attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    log_id INT NOT NULL,
    person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL,
    person_id INT NOT NULL,
    attendance_status ENUM('Present','Absent','Late','Excused') NOT NULL DEFAULT 'Present',
    notes VARCHAR(255) NOT NULL DEFAULT '',
    UNIQUE KEY uq_patrol_attendance (log_id, person_type, person_id)
);
ALTER TABLE patrol_log_attendance MODIFY COLUMN person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL;

CREATE TABLE IF NOT EXISTS patrol_schedule_source_records (
    schedule_id INT NOT NULL,
    incident_id INT NOT NULL,
    record_type VARCHAR(30) NOT NULL DEFAULT 'Incident',
    selected_area VARCHAR(100) NOT NULL DEFAULT '',
    PRIMARY KEY (schedule_id, incident_id),
    FOREIGN KEY (schedule_id) REFERENCES patrol_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (incident_id) REFERENCES record_registry(registry_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS patrol_schedule_series (
    id INT AUTO_INCREMENT PRIMARY KEY,
    recurrence_type ENUM('single','daily','weekly','custom') NOT NULL DEFAULT 'single',
    recurrence_interval TINYINT UNSIGNED NOT NULL DEFAULT 1,
    recurrence_days JSON NULL,
    starts_on DATE NOT NULL,
    ends_on DATE NULL,
    created_by INT NULL,
    status ENUM('Active','Cancelled') NOT NULL DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patrol_schedule_team_snapshots (
    schedule_id INT NOT NULL,
    team_name VARCHAR(100) NOT NULL DEFAULT '',
    leader_user_id INT NULL,
    leader_name VARCHAR(100) NOT NULL DEFAULT '',
    tanod_id INT NOT NULL,
    tanod_name VARCHAR(100) NOT NULL,
    contact_no VARCHAR(30) NOT NULL DEFAULT '',
    address VARCHAR(255) NOT NULL DEFAULT '',
    role VARCHAR(40) NOT NULL DEFAULT 'Tanod',
    PRIMARY KEY (schedule_id, tanod_id)
);
