-- Patrol Scheduler route/deployment model.
-- Runtime migration is also applied by backend/migrations/record-patrol.js.
-- This migration intentionally does not delete saved patrol teams.

CREATE TABLE IF NOT EXISTS patrol_routes (
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
);

CREATE TABLE IF NOT EXISTS patrol_route_stops (
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
);

CREATE TABLE IF NOT EXISTS patrol_route_deployments (
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
);

CREATE TABLE IF NOT EXISTS patrol_route_logs (
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
);

CREATE TABLE IF NOT EXISTS patrol_route_log_attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    log_id INT NOT NULL,
    person_type ENUM('Tanod','Volunteer','Team Leader') NOT NULL,
    person_id INT NOT NULL,
    attendance_status ENUM('Present','Absent','Late','Excused') NOT NULL DEFAULT 'Present',
    notes VARCHAR(255) NOT NULL DEFAULT '',
    UNIQUE KEY uq_patrol_route_attendance (log_id, person_type, person_id),
    FOREIGN KEY (log_id) REFERENCES patrol_route_logs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS incident_patrol_risk_state (
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
);

SET @patrol_low_threshold = COALESCE((SELECT CAST(setting_value AS DECIMAL(5,2)) FROM system_settings WHERE setting_key='default_danger_threshold_moderate' LIMIT 1), 34);
INSERT IGNORE INTO incident_patrol_risk_state
    (incident_id, completed_patrol_count, risk_multiplier, base_cart_score, adjusted_risk_score, is_monitoring_archived, archived_at)
SELECT s.incident_id, COUNT(DISTINCT d.id), POW(0.85, COUNT(DISTINCT d.id)), rf.total_risk_score,
       ROUND(rf.total_risk_score * POW(0.85, COUNT(DISTINCT d.id)), 2),
       CASE WHEN COUNT(DISTINCT d.id) >= 3 AND rf.total_risk_score * POW(0.85, COUNT(DISTINCT d.id)) < @patrol_low_threshold THEN 1 ELSE 0 END,
       CASE WHEN COUNT(DISTINCT d.id) >= 3 AND rf.total_risk_score * POW(0.85, COUNT(DISTINCT d.id)) < @patrol_low_threshold THEN NOW() ELSE NULL END
FROM patrol_route_stops s
JOIN patrol_route_deployments d ON d.route_id=s.route_id
JOIN patrol_route_logs l ON l.deployment_id=d.id AND l.status='Completed'
LEFT JOIN cart_risk_factors rf ON rf.incident_id=s.incident_id
GROUP BY s.incident_id, rf.total_risk_score;
