-- Patrol calendar and roster history (idempotent companion migration).
-- Runtime migration is also applied by backend/migrations/record-patrol.js.
ALTER TABLE patrol_schedules ADD COLUMN IF NOT EXISTS series_id INT NULL;
ALTER TABLE patrol_schedule_records ADD COLUMN IF NOT EXISTS team_id INT NULL;
ALTER TABLE patrol_team_tanods ADD COLUMN IF NOT EXISTS role VARCHAR(40) NOT NULL DEFAULT 'Tanod';
ALTER TABLE patrol_team_tanods ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE patrol_team_tanods ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

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
