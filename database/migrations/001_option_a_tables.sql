-- ============================================================================
-- Migration 001 — Option A: separate Blotter / Incident operational tables
-- ----------------------------------------------------------------------------
-- ADDITIVE ONLY. Creates the new structure alongside the existing `incidents`
-- table so the running app is unaffected until the cutover (migration 002).
--
--   record_registry         one universal id (registry_id) + public record
--                           number per operational record, pointing at either
--                           blotter_records or incident_records (1:1).
--   record_number_counters  concurrency-safe per-(prefix, type acronym) counter
--                           for {INC|BLT}-{ACRONYM}-{NNNN}. Never MAX(id)+1.
--   blotter_records         non-urgent reports (BLT-...).
--   incident_records        urgent / violent-crime reports (INC-...).
--
-- Both operational tables share one column set: structured people (complainant /
-- respondent / reporter, first/middle/last) and structured address (block / lot /
-- house no / street / unit), the fields CART reads (incident_type, severity,
-- time_of_day, is_weekend, street_name, date), draft + no-evidence support, and
-- data_origin so synthetic rows never get mistaken for real ones. Legacy-shaped
-- columns (reported_by_name, respondent_name, address) are kept so the
-- compatibility `incidents` view (migration 002) is a straight projection and no
-- existing read query has to change.
-- ============================================================================

SET NAMES utf8mb4;

-- ── Registry ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `record_registry` (
  `registry_id`        INT NOT NULL AUTO_INCREMENT,
  `source`             ENUM('blotter','incident') NOT NULL,
  `source_id`          INT NOT NULL,
  `public_number`      VARCHAR(40) NOT NULL,
  `type_code`          VARCHAR(12) NOT NULL,
  `legacy_incident_id` INT DEFAULT NULL,
  `created_at`         TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`registry_id`),
  UNIQUE KEY `uq_registry_source` (`source`,`source_id`),
  UNIQUE KEY `uq_registry_public` (`public_number`),
  KEY `idx_registry_source` (`source`),
  KEY `idx_registry_legacy` (`legacy_incident_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── Concurrency-safe sequence counters ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS `record_number_counters` (
  `prefix`    VARCHAR(8)  NOT NULL,   -- INC | BLT
  `type_code` VARCHAR(12) NOT NULL,   -- HMC, R, O, ...
  `next_seq`  INT NOT NULL DEFAULT 1,
  PRIMARY KEY (`prefix`,`type_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── Blotter records (BLT-...) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `blotter_records` (
  `id`                 INT NOT NULL AUTO_INCREMENT,
  `incident_type`      VARCHAR(150) NOT NULL,
  `type_code`          VARCHAR(12) DEFAULT NULL,
  `date`               DATE NOT NULL,
  `time`               TIME NOT NULL,
  `latitude`           DECIMAL(10,8) DEFAULT NULL,
  `longitude`          DECIMAL(11,8) DEFAULT NULL,
  `street_name`        VARCHAR(100) DEFAULT NULL,
  -- structured address (no Landmark, per spec)
  `addr_block`         VARCHAR(50)  DEFAULT NULL,
  `addr_lot`           VARCHAR(50)  DEFAULT NULL,
  `addr_house_no`      VARCHAR(50)  DEFAULT NULL,
  `addr_street`        VARCHAR(100) DEFAULT NULL,
  `addr_unit`          VARCHAR(50)  DEFAULT NULL,
  `address`            VARCHAR(255) DEFAULT NULL,   -- composed / legacy string (compat)
  -- complainant (structured)
  `complainant_first`  VARCHAR(80)  DEFAULT NULL,
  `complainant_middle` VARCHAR(80)  DEFAULT NULL,
  `complainant_last`   VARCHAR(80)  DEFAULT NULL,
  `complainant_contact` VARCHAR(30) DEFAULT NULL,
  -- respondent (structured)
  `respondent_first`   VARCHAR(80)  DEFAULT NULL,
  `respondent_middle`  VARCHAR(80)  DEFAULT NULL,
  `respondent_last`    VARCHAR(80)  DEFAULT NULL,
  `respondent_address` VARCHAR(500) DEFAULT NULL,
  `respondent_age`     INT DEFAULT NULL,
  -- reporter (structured) + staff who logged it
  `reporter_first`     VARCHAR(80)  DEFAULT NULL,
  `reporter_middle`    VARCHAR(80)  DEFAULT NULL,
  `reporter_last`      VARCHAR(80)  DEFAULT NULL,
  `reporter_address`   VARCHAR(255) DEFAULT NULL,
  `reporter_contact`   VARCHAR(30)  DEFAULT NULL,
  `reporter_id`        INT DEFAULT NULL,
  -- legacy combined names (compat with current forms)
  `reported_by_name`   VARCHAR(150) DEFAULT NULL,
  `respondent_name`    VARCHAR(255) DEFAULT NULL,
  -- classification / workflow
  `severity`           ENUM('High','Medium','Low') DEFAULT 'Low',
  `priority`           VARCHAR(20) DEFAULT 'Normal',
  `status`             VARCHAR(20) DEFAULT 'Open',
  `is_draft`           TINYINT(1) DEFAULT 0,
  -- narrative
  `description`        TEXT,
  `statement`          TEXT,
  `recommended_action` TEXT,
  `danger_level`       VARCHAR(100) DEFAULT 'Calculated by System',
  -- evidence exception
  `no_evidence`        TINYINT(1) DEFAULT 0,
  `no_evidence_reason` VARCHAR(500) DEFAULT NULL,
  -- derived time fields (CART inputs)
  `time_of_day`        VARCHAR(20) DEFAULT NULL,
  `day_of_week`        VARCHAR(15) DEFAULT NULL,
  `is_weekend`         TINYINT(1) DEFAULT 0,
  `photo_path`         VARCHAR(255) DEFAULT NULL,
  -- provenance
  `data_origin`        VARCHAR(20) DEFAULT 'real',   -- real | synthetic | migrated
  `created_by`         INT DEFAULT NULL,
  `updated_by`         INT DEFAULT NULL,
  `created_at`         TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_blt_street` (`street_name`),
  KEY `idx_blt_date` (`date`),
  KEY `idx_blt_status` (`status`),
  KEY `idx_blt_draft` (`is_draft`),
  KEY `idx_blt_origin` (`data_origin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── Incident records (INC-...) — identical structure ────────────────────────
CREATE TABLE IF NOT EXISTS `incident_records` LIKE `blotter_records`;
