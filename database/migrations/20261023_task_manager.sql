-- Apply after migrations 001 and 002. The `incidents` name is a compatibility
-- view after cutover, so relational integrity must target record_registry.
CREATE TABLE IF NOT EXISTS user_navigation_preferences (
 user_id INT NOT NULL PRIMARY KEY, icon_order JSON NOT NULL,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS mediation_tasks (
 id INT AUTO_INCREMENT PRIMARY KEY,
 incident_id INT NOT NULL, assigned_user_id INT NOT NULL,
 scheduled_at DATETIME NOT NULL,
 status ENUM('Pending','In Progress','Canceled','Rescheduled') NOT NULL DEFAULT 'Pending',
 created_by INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_assignee_date (assigned_user_id,scheduled_at),
 CONSTRAINT fk_mediation_registry
   FOREIGN KEY (incident_id) REFERENCES record_registry(registry_id) ON DELETE CASCADE,
 FOREIGN KEY (assigned_user_id) REFERENCES users(id),
 FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS mediation_task_history (
 id INT AUTO_INCREMENT PRIMARY KEY, task_id INT NOT NULL, actor_id INT NOT NULL,
 status VARCHAR(20) NOT NULL, note TEXT, scheduled_at DATETIME NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (task_id) REFERENCES mediation_tasks(id) ON DELETE CASCADE,
 FOREIGN KEY (actor_id) REFERENCES users(id)
);
