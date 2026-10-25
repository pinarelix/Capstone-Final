-- Barangay 179 Incident Management System
-- Database Schema (auto-exported from live DB)
-- Generated: 2026-10-25

CREATE DATABASE IF NOT EXISTS brgydata;
USE brgydata;

CREATE TABLE `archived_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity_type` varchar(30) NOT NULL,
  `entity_id` int NOT NULL,
  `label` varchar(255) NOT NULL,
  `data` json NOT NULL,
  `files` json DEFAULT NULL,
  `deleted_by` int DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `restored_by` int DEFAULT NULL,
  `restored_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_archive_entity` (`entity_type`,`entity_id`),
  KEY `idx_archive_restored` (`restored_at`),
  KEY `fk_archive_deleted_by` (`deleted_by`),
  KEY `fk_archive_restored_by` (`restored_by`),
  CONSTRAINT `fk_archive_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_archive_restored_by` FOREIGN KEY (`restored_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=204 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `area_risk_decay` (
  `location` varchar(100) NOT NULL,
  `decay_amount` decimal(5,2) NOT NULL DEFAULT '0.00',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`location`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `entity_type` varchar(50) DEFAULT NULL,
  `entity_id` int DEFAULT NULL,
  `old_data` json DEFAULT NULL,
  `new_data` json DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_entity` (`entity_type`,`entity_id`),
  CONSTRAINT `audit_logs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3018 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `blotter_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_type` varchar(150) NOT NULL,
  `type_code` varchar(12) DEFAULT NULL,
  `date` date NOT NULL,
  `time` time NOT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `street_name` varchar(100) DEFAULT NULL,
  `addr_block` varchar(50) DEFAULT NULL,
  `addr_lot` varchar(50) DEFAULT NULL,
  `addr_house_no` varchar(50) DEFAULT NULL,
  `addr_street` varchar(100) DEFAULT NULL,
  `addr_unit` varchar(50) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `complainant_first` varchar(80) DEFAULT NULL,
  `complainant_middle` varchar(80) DEFAULT NULL,
  `complainant_last` varchar(80) DEFAULT NULL,
  `complainant_contact` varchar(30) DEFAULT NULL,
  `respondent_first` varchar(80) DEFAULT NULL,
  `respondent_middle` varchar(80) DEFAULT NULL,
  `respondent_last` varchar(80) DEFAULT NULL,
  `respondent_address` varchar(500) DEFAULT NULL,
  `respondent_age` int DEFAULT NULL,
  `reporter_first` varchar(80) DEFAULT NULL,
  `reporter_middle` varchar(80) DEFAULT NULL,
  `reporter_last` varchar(80) DEFAULT NULL,
  `reporter_address` varchar(255) DEFAULT NULL,
  `reporter_contact` varchar(30) DEFAULT NULL,
  `reporter_id` int DEFAULT NULL,
  `reported_by_name` varchar(150) DEFAULT NULL,
  `respondent_name` varchar(255) DEFAULT NULL,
  `severity` enum('High','Medium','Low') DEFAULT 'Low',
  `priority` varchar(20) DEFAULT 'Normal',
  `status` varchar(20) DEFAULT 'Open',
  `is_draft` tinyint(1) DEFAULT '0',
  `description` text,
  `statement` text,
  `recommended_action` text,
  `danger_level` varchar(100) DEFAULT 'Calculated by System',
  `no_evidence` tinyint(1) DEFAULT '0',
  `no_evidence_reason` varchar(500) DEFAULT NULL,
  `time_of_day` varchar(20) DEFAULT NULL,
  `day_of_week` varchar(15) DEFAULT NULL,
  `is_weekend` tinyint(1) DEFAULT '0',
  `photo_path` varchar(255) DEFAULT NULL,
  `data_origin` varchar(20) DEFAULT 'real',
  `created_by` int DEFAULT NULL,
  `updated_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `resp_addr_street` varchar(100) DEFAULT NULL,
  `resp_addr_block` varchar(50) DEFAULT NULL,
  `resp_addr_lot` varchar(50) DEFAULT NULL,
  `resp_addr_house_no` varchar(50) DEFAULT NULL,
  `resp_addr_unit` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_blt_street` (`street_name`),
  KEY `idx_blt_date` (`date`),
  KEY `idx_blt_status` (`status`),
  KEY `idx_blt_draft` (`is_draft`),
  KEY `idx_blt_origin` (`data_origin`)
) ENGINE=InnoDB AUTO_INCREMENT=116 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cart_analysis_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `run_timestamp` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `analysis_type` varchar(50) NOT NULL DEFAULT 'risk_prediction',
  `date_range_start` date DEFAULT NULL,
  `date_range_end` date DEFAULT NULL,
  `incident_types_analyzed` text,
  `total_streets_analyzed` int DEFAULT '0',
  `total_incidents_analyzed` int DEFAULT '0',
  `high_risk_count` int DEFAULT '0',
  `moderate_risk_count` int DEFAULT '0',
  `low_risk_count` int DEFAULT '0',
  `execution_time_ms` int DEFAULT NULL,
  `status` varchar(20) DEFAULT 'completed',
  `triggered_by` int DEFAULT NULL,
  `notes` text,
  PRIMARY KEY (`id`),
  KEY `triggered_by` (`triggered_by`),
  KEY `idx_timestamp` (`run_timestamp`),
  KEY `idx_status` (`status`),
  CONSTRAINT `cart_analysis_log_ibfk_1` FOREIGN KEY (`triggered_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=66 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cart_decision_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `rule_name` varchar(100) NOT NULL,
  `rule_type` varchar(50) DEFAULT 'risk_classification',
  `conditions` text NOT NULL,
  `result_risk_level` varchar(20) DEFAULT NULL,
  `result_action` varchar(100) DEFAULT NULL,
  `priority` int DEFAULT '1',
  `times_applied` int DEFAULT '0',
  `success_rate` decimal(5,2) DEFAULT '0.00',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `idx_active` (`is_active`),
  CONSTRAINT `cart_decision_rules_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cart_risk_factors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `time_risk_score` decimal(5,2) DEFAULT '0.00',
  `day_risk_score` decimal(5,2) DEFAULT '0.00',
  `type_risk_score` decimal(5,2) DEFAULT '0.00',
  `location_risk_score` decimal(5,2) DEFAULT '0.00',
  `frequency_risk_score` decimal(5,2) DEFAULT '0.00',
  `total_risk_score` decimal(5,2) DEFAULT '0.00',
  `danger_level` varchar(100) DEFAULT 'Calculated by System',
  `decision_path` text,
  `model_version` varchar(20) DEFAULT 'v1.0',
  `calculated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_incident` (`incident_id`),
  KEY `idx_incident` (`incident_id`),
  KEY `idx_risk` (`total_risk_score`,`danger_level`),
  CONSTRAINT `fk_cart_registry` FOREIGN KEY (`incident_id`) REFERENCES `record_registry` (`registry_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=679 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cart_risk_factors_legacy` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `time_risk_score` decimal(5,2) DEFAULT '0.00',
  `day_risk_score` decimal(5,2) DEFAULT '0.00',
  `type_risk_score` decimal(5,2) DEFAULT '0.00',
  `location_risk_score` decimal(5,2) DEFAULT '0.00',
  `frequency_risk_score` decimal(5,2) DEFAULT '0.00',
  `total_risk_score` decimal(5,2) DEFAULT '0.00',
  `danger_level` varchar(100) DEFAULT 'Calculated by System',
  `decision_path` text,
  `model_version` varchar(20) DEFAULT 'v1.0',
  `calculated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_incident` (`incident_id`),
  KEY `idx_incident` (`incident_id`),
  KEY `idx_risk` (`total_risk_score`,`danger_level`)
) ENGINE=InnoDB AUTO_INCREMENT=3418 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `incident_evidence` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `file_type` enum('image','video') NOT NULL,
  `original_filename` varchar(255) DEFAULT NULL,
  `uploaded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_incident_id` (`incident_id`),
  CONSTRAINT `fk_evidence_registry` FOREIGN KEY (`incident_id`) REFERENCES `record_registry` (`registry_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `incident_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_type` varchar(150) NOT NULL,
  `type_code` varchar(12) DEFAULT NULL,
  `date` date NOT NULL,
  `time` time NOT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `street_name` varchar(100) DEFAULT NULL,
  `addr_block` varchar(50) DEFAULT NULL,
  `addr_lot` varchar(50) DEFAULT NULL,
  `addr_house_no` varchar(50) DEFAULT NULL,
  `addr_street` varchar(100) DEFAULT NULL,
  `addr_unit` varchar(50) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `complainant_first` varchar(80) DEFAULT NULL,
  `complainant_middle` varchar(80) DEFAULT NULL,
  `complainant_last` varchar(80) DEFAULT NULL,
  `complainant_contact` varchar(30) DEFAULT NULL,
  `respondent_first` varchar(80) DEFAULT NULL,
  `respondent_middle` varchar(80) DEFAULT NULL,
  `respondent_last` varchar(80) DEFAULT NULL,
  `respondent_address` varchar(500) DEFAULT NULL,
  `respondent_age` int DEFAULT NULL,
  `reporter_first` varchar(80) DEFAULT NULL,
  `reporter_middle` varchar(80) DEFAULT NULL,
  `reporter_last` varchar(80) DEFAULT NULL,
  `reporter_address` varchar(255) DEFAULT NULL,
  `reporter_contact` varchar(30) DEFAULT NULL,
  `reporter_id` int DEFAULT NULL,
  `reported_by_name` varchar(150) DEFAULT NULL,
  `respondent_name` varchar(255) DEFAULT NULL,
  `severity` enum('High','Medium','Low') DEFAULT 'Low',
  `priority` varchar(20) DEFAULT 'Normal',
  `status` varchar(20) DEFAULT 'Open',
  `is_draft` tinyint(1) DEFAULT '0',
  `description` text,
  `statement` text,
  `recommended_action` text,
  `danger_level` varchar(100) DEFAULT 'Calculated by System',
  `no_evidence` tinyint(1) DEFAULT '0',
  `no_evidence_reason` varchar(500) DEFAULT NULL,
  `time_of_day` varchar(20) DEFAULT NULL,
  `day_of_week` varchar(15) DEFAULT NULL,
  `is_weekend` tinyint(1) DEFAULT '0',
  `photo_path` varchar(255) DEFAULT NULL,
  `data_origin` varchar(20) DEFAULT 'real',
  `created_by` int DEFAULT NULL,
  `updated_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `resp_addr_street` varchar(100) DEFAULT NULL,
  `resp_addr_block` varchar(50) DEFAULT NULL,
  `resp_addr_lot` varchar(50) DEFAULT NULL,
  `resp_addr_house_no` varchar(50) DEFAULT NULL,
  `resp_addr_unit` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_blt_street` (`street_name`),
  KEY `idx_blt_date` (`date`),
  KEY `idx_blt_status` (`status`),
  KEY `idx_blt_draft` (`is_draft`),
  KEY `idx_blt_origin` (`data_origin`)
) ENGINE=InnoDB AUTO_INCREMENT=114 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `incidents` AS select `r`.`registry_id` AS `id`,`b`.`incident_type` AS `incident_type`,`b`.`date` AS `date`,`b`.`time` AS `time`,`b`.`latitude` AS `latitude`,`b`.`longitude` AS `longitude`,`b`.`street_name` AS `street_name`,`b`.`address` AS `address`,`b`.`reporter_id` AS `reporter_id`,`b`.`status` AS `status`,`b`.`description` AS `description`,`b`.`recommended_action` AS `recommended_action`,`b`.`danger_level` AS `danger_level`,`b`.`created_at` AS `created_at`,`b`.`updated_at` AS `updated_at`,`b`.`time_of_day` AS `time_of_day`,`b`.`day_of_week` AS `day_of_week`,`b`.`is_weekend` AS `is_weekend`,`b`.`photo_path` AS `photo_path`,`r`.`public_number` AS `blotter_number`,coalesce(nullif(trim(concat_ws(' ',`b`.`complainant_first`,`b`.`complainant_middle`,`b`.`complainant_last`)),''),`b`.`reported_by_name`) AS `reported_by_name`,`b`.`statement` AS `statement`,NULL AS `persons_involved`,`b`.`priority` AS `priority`,`b`.`severity` AS `severity`,coalesce(nullif(trim(concat_ws(' ',`b`.`respondent_first`,`b`.`respondent_middle`,`b`.`respondent_last`)),''),`b`.`respondent_name`) AS `respondent_name`,`b`.`respondent_address` AS `respondent_address`,`b`.`respondent_age` AS `age`,'blotter' AS `form_type`,`r`.`registry_id` AS `registry_id`,`r`.`source` AS `source`,`r`.`public_number` AS `public_number`,`b`.`type_code` AS `type_code`,`b`.`is_draft` AS `is_draft`,`b`.`data_origin` AS `data_origin`,`b`.`complainant_first` AS `complainant_first`,`b`.`complainant_middle` AS `complainant_middle`,`b`.`complainant_last` AS `complainant_last`,`b`.`complainant_contact` AS `complainant_contact`,`b`.`respondent_first` AS `respondent_first`,`b`.`respondent_middle` AS `respondent_middle`,`b`.`respondent_last` AS `respondent_last`,`b`.`reporter_first` AS `reporter_first`,`b`.`reporter_middle` AS `reporter_middle`,`b`.`reporter_last` AS `reporter_last`,`b`.`reporter_address` AS `reporter_address`,`b`.`reporter_contact` AS `reporter_contact`,`b`.`addr_block` AS `addr_block`,`b`.`addr_lot` AS `addr_lot`,`b`.`addr_house_no` AS `addr_house_no`,`b`.`addr_street` AS `addr_street`,`b`.`addr_unit` AS `addr_unit`,`b`.`no_evidence` AS `no_evidence`,`b`.`no_evidence_reason` AS `no_evidence_reason`,`b`.`resp_addr_street` AS `resp_addr_street`,`b`.`resp_addr_block` AS `resp_addr_block`,`b`.`resp_addr_lot` AS `resp_addr_lot`,`b`.`resp_addr_house_no` AS `resp_addr_house_no`,`b`.`resp_addr_unit` AS `resp_addr_unit` from (`record_registry` `r` join `blotter_records` `b` on(((`r`.`source` = 'blotter') and (`r`.`source_id` = `b`.`id`)))) union all select `r`.`registry_id` AS `registry_id`,`i`.`incident_type` AS `incident_type`,`i`.`date` AS `date`,`i`.`time` AS `time`,`i`.`latitude` AS `latitude`,`i`.`longitude` AS `longitude`,`i`.`street_name` AS `street_name`,`i`.`address` AS `address`,`i`.`reporter_id` AS `reporter_id`,`i`.`status` AS `status`,`i`.`description` AS `description`,`i`.`recommended_action` AS `recommended_action`,`i`.`danger_level` AS `danger_level`,`i`.`created_at` AS `created_at`,`i`.`updated_at` AS `updated_at`,`i`.`time_of_day` AS `time_of_day`,`i`.`day_of_week` AS `day_of_week`,`i`.`is_weekend` AS `is_weekend`,`i`.`photo_path` AS `photo_path`,`r`.`public_number` AS `public_number`,coalesce(nullif(trim(concat_ws(' ',`i`.`complainant_first`,`i`.`complainant_middle`,`i`.`complainant_last`)),''),`i`.`reported_by_name`) AS `Name_exp_80`,`i`.`statement` AS `statement`,NULL AS `NULL`,`i`.`priority` AS `priority`,`i`.`severity` AS `severity`,coalesce(nullif(trim(concat_ws(' ',`i`.`respondent_first`,`i`.`respondent_middle`,`i`.`respondent_last`)),''),`i`.`respondent_name`) AS `Name_exp_85`,`i`.`respondent_address` AS `respondent_address`,`i`.`respondent_age` AS `respondent_age`,'crime' AS `crime`,`r`.`registry_id` AS `registry_id`,`r`.`source` AS `source`,`r`.`public_number` AS `public_number`,`i`.`type_code` AS `type_code`,`i`.`is_draft` AS `is_draft`,`i`.`data_origin` AS `data_origin`,`i`.`complainant_first` AS `complainant_first`,`i`.`complainant_middle` AS `complainant_middle`,`i`.`complainant_last` AS `complainant_last`,`i`.`complainant_contact` AS `complainant_contact`,`i`.`respondent_first` AS `respondent_first`,`i`.`respondent_middle` AS `respondent_middle`,`i`.`respondent_last` AS `respondent_last`,`i`.`reporter_first` AS `reporter_first`,`i`.`reporter_middle` AS `reporter_middle`,`i`.`reporter_last` AS `reporter_last`,`i`.`reporter_address` AS `reporter_address`,`i`.`reporter_contact` AS `reporter_contact`,`i`.`addr_block` AS `addr_block`,`i`.`addr_lot` AS `addr_lot`,`i`.`addr_house_no` AS `addr_house_no`,`i`.`addr_street` AS `addr_street`,`i`.`addr_unit` AS `addr_unit`,`i`.`no_evidence` AS `no_evidence`,`i`.`no_evidence_reason` AS `no_evidence_reason`,`i`.`resp_addr_street` AS `resp_addr_street`,`i`.`resp_addr_block` AS `resp_addr_block`,`i`.`resp_addr_lot` AS `resp_addr_lot`,`i`.`resp_addr_house_no` AS `resp_addr_house_no`,`i`.`resp_addr_unit` AS `resp_addr_unit` from (`record_registry` `r` join `incident_records` `i` on(((`r`.`source` = 'incident') and (`r`.`source_id` = `i`.`id`))));

CREATE TABLE `incidents_legacy` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_type` varchar(150) NOT NULL,
  `date` date NOT NULL,
  `time` time NOT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `street_name` varchar(100) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `reporter_id` int DEFAULT NULL,
  `status` varchar(20) DEFAULT 'Open',
  `description` text,
  `recommended_action` text,
  `danger_level` varchar(100) DEFAULT 'Calculated by System',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `time_of_day` varchar(20) DEFAULT NULL,
  `day_of_week` varchar(15) DEFAULT NULL,
  `is_weekend` tinyint(1) DEFAULT '0',
  `photo_path` varchar(255) DEFAULT NULL,
  `blotter_number` varchar(50) DEFAULT NULL,
  `reported_by_name` varchar(150) DEFAULT NULL,
  `statement` text,
  `persons_involved` text,
  `priority` varchar(20) DEFAULT 'Normal',
  `severity` enum('High','Medium','Low') DEFAULT 'Low',
  `respondent_name` varchar(255) DEFAULT NULL,
  `respondent_address` varchar(500) DEFAULT NULL,
  `age` int DEFAULT NULL,
  `form_type` enum('blotter','crime') DEFAULT 'blotter',
  PRIMARY KEY (`id`),
  KEY `reporter_id` (`reporter_id`),
  KEY `idx_street_name` (`street_name`),
  KEY `idx_date` (`date`),
  KEY `idx_status` (`status`),
  CONSTRAINT `incidents_legacy_ibfk_1` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1064 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `location_coordinates` (
  `location` varchar(100) NOT NULL,
  `latitude` decimal(10,8) NOT NULL,
  `longitude` decimal(11,8) NOT NULL,
  `set_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`location`),
  KEY `set_by` (`set_by`),
  CONSTRAINT `fk_location_coordinates_set_by` FOREIGN KEY (`set_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `login_attempts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(100) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `attempt_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `success` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_username` (`username`),
  KEY `idx_ip_address` (`ip_address`),
  KEY `idx_attempt_time` (`attempt_time`)
) ENGINE=InnoDB AUTO_INCREMENT=1887 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `login_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `username` varchar(50) NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  `login_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_username` (`username`),
  KEY `idx_login_time` (`login_time`),
  CONSTRAINT `login_history_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1717 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `mediation_task_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int NOT NULL,
  `actor_id` int NOT NULL,
  `status` varchar(20) NOT NULL,
  `note` text,
  `scheduled_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `task_id` (`task_id`),
  KEY `actor_id` (`actor_id`),
  CONSTRAINT `mediation_task_history_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `mediation_tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `mediation_task_history_ibfk_2` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `mediation_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `assigned_user_id` int NOT NULL,
  `scheduled_at` datetime NOT NULL,
  `status` enum('Pending','In Progress','Canceled','Rescheduled') NOT NULL DEFAULT 'Pending',
  `created_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_assignee_date` (`assigned_user_id`,`scheduled_at`),
  KEY `fk_mediation_registry` (`incident_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `fk_mediation_registry` FOREIGN KEY (`incident_id`) REFERENCES `record_registry` (`registry_id`) ON DELETE CASCADE,
  CONSTRAINT `mediation_tasks_ibfk_1` FOREIGN KEY (`assigned_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `mediation_tasks_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `password_resets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `reset_token` varchar(255) NOT NULL,
  `expires_at` timestamp NOT NULL,
  `used_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reset_token` (`reset_token`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `password_resets_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `patrol_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `schedule_id` int DEFAULT NULL,
  `report` text,
  `status` varchar(20) DEFAULT 'Completed',
  `patrol_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `schedule_id` (`schedule_id`),
  KEY `idx_patrol_date` (`patrol_date`),
  CONSTRAINT `patrol_logs_ibfk_1` FOREIGN KEY (`schedule_id`) REFERENCES `patrol_schedules` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=30 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `patrol_schedule_records` (
  `schedule_id` int NOT NULL,
  `incident_id` int DEFAULT NULL,
  `scheduled_date` date DEFAULT NULL,
  `priority` enum('High','Moderate','Low') NOT NULL DEFAULT 'Low',
  `exact_address` varchar(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`schedule_id`),
  KEY `idx_patrol_record` (`incident_id`),
  CONSTRAINT `patrol_schedule_records_ibfk_1` FOREIGN KEY (`schedule_id`) REFERENCES `patrol_schedules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `patrol_schedule_records_ibfk_2` FOREIGN KEY (`incident_id`) REFERENCES `record_registry` (`registry_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `patrol_schedule_tanods` (
  `schedule_id` int NOT NULL,
  `tanod_id` int NOT NULL,
  PRIMARY KEY (`schedule_id`,`tanod_id`),
  KEY `tanod_id` (`tanod_id`),
  CONSTRAINT `patrol_schedule_tanods_ibfk_1` FOREIGN KEY (`schedule_id`) REFERENCES `patrol_schedules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `patrol_schedule_tanods_ibfk_2` FOREIGN KEY (`tanod_id`) REFERENCES `tanods` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `patrol_schedules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `location` varchar(100) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `day_of_week` varchar(15) NOT NULL,
  `reason` text,
  `status` varchar(20) DEFAULT 'Active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_location` (`location`)
) ENGINE=InnoDB AUTO_INCREMENT=78 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `record_number_counters` (
  `prefix` varchar(8) NOT NULL,
  `type_code` varchar(12) NOT NULL,
  `next_seq` int NOT NULL DEFAULT '1',
  PRIMARY KEY (`prefix`,`type_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `record_patrol_details` (
  `incident_id` int NOT NULL,
  `notes` varchar(200) NOT NULL DEFAULT '',
  `patrol_override` enum('auto','include','exclude') NOT NULL DEFAULT 'auto',
  `updated_by` int DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`incident_id`),
  CONSTRAINT `record_patrol_details_ibfk_1` FOREIGN KEY (`incident_id`) REFERENCES `record_registry` (`registry_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `record_registry` (
  `registry_id` int NOT NULL AUTO_INCREMENT,
  `source` enum('blotter','incident') NOT NULL,
  `source_id` int NOT NULL,
  `public_number` varchar(40) NOT NULL,
  `type_code` varchar(12) NOT NULL,
  `legacy_incident_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`registry_id`),
  UNIQUE KEY `uq_registry_source` (`source`,`source_id`),
  UNIQUE KEY `uq_registry_public` (`public_number`),
  KEY `idx_registry_source` (`source`),
  KEY `idx_registry_legacy` (`legacy_incident_id`)
) ENGINE=InnoDB AUTO_INCREMENT=229 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `record_type_catalog` (
  `id` int NOT NULL AUTO_INCREMENT,
  `record_class` enum('blotter','incident') NOT NULL,
  `type_name` varchar(200) NOT NULL,
  `type_code` varchar(12) NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_class_name` (`record_class`,`type_name`),
  KEY `idx_catalog_class` (`record_class`)
) ENGINE=InnoDB AUTO_INCREMENT=64 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `system_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text,
  `description` text,
  `updated_by` int DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`),
  KEY `updated_by` (`updated_by`),
  KEY `idx_setting_key` (`setting_key`),
  CONSTRAINT `system_settings_ibfk_1` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tanods` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `unified_incident_analytics` AS select `r`.`registry_id` AS `id`,`r`.`source` AS `record_source`,`r`.`public_number` AS `public_number`,`b`.`incident_type` AS `incident_type`,`b`.`type_code` AS `type_code`,`b`.`date` AS `incident_date`,`b`.`time` AS `incident_time`,`b`.`time_of_day` AS `time_of_day`,`b`.`day_of_week` AS `day_of_week`,`b`.`is_weekend` AS `is_weekend`,`b`.`street_name` AS `street_name`,`b`.`latitude` AS `latitude`,`b`.`longitude` AS `longitude`,`b`.`severity` AS `severity`,`b`.`priority` AS `priority`,`b`.`status` AS `status`,`b`.`danger_level` AS `danger_level`,`b`.`is_draft` AS `is_draft`,`b`.`data_origin` AS `data_origin`,`b`.`created_at` AS `created_at` from (`record_registry` `r` join `blotter_records` `b` on(((`r`.`source` = 'blotter') and (`r`.`source_id` = `b`.`id`)))) where (`b`.`is_draft` = 0) union all select `r`.`registry_id` AS `registry_id`,`r`.`source` AS `source`,`r`.`public_number` AS `public_number`,`i`.`incident_type` AS `incident_type`,`i`.`type_code` AS `type_code`,`i`.`date` AS `date`,`i`.`time` AS `time`,`i`.`time_of_day` AS `time_of_day`,`i`.`day_of_week` AS `day_of_week`,`i`.`is_weekend` AS `is_weekend`,`i`.`street_name` AS `street_name`,`i`.`latitude` AS `latitude`,`i`.`longitude` AS `longitude`,`i`.`severity` AS `severity`,`i`.`priority` AS `priority`,`i`.`status` AS `status`,`i`.`danger_level` AS `danger_level`,`i`.`is_draft` AS `is_draft`,`i`.`data_origin` AS `data_origin`,`i`.`created_at` AS `created_at` from (`record_registry` `r` join `incident_records` `i` on(((`r`.`source` = 'incident') and (`r`.`source_id` = `i`.`id`)))) where (`i`.`is_draft` = 0);

CREATE TABLE `user_navigation_preferences` (
  `user_id` int NOT NULL,
  `icon_order` json NOT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `user_navigation_preferences_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `session_token` varchar(255) NOT NULL,
  `login_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_activity` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `logout_time` timestamp NULL DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  `is_active` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_token` (`session_token`),
  KEY `idx_session_token` (`session_token`),
  KEY `idx_user_active` (`user_id`,`is_active`),
  KEY `idx_last_activity` (`last_activity`),
  CONSTRAINT `user_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1768 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('Executive Officer','Deputy Officer','Kagawad','Team Leader') NOT NULL,
  `contact_no` varchar(20) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `last_login_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `email` varchar(150) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=154 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

