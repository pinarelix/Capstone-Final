-- ============================================================================
-- Migration 003 — Record type catalog table
-- ----------------------------------------------------------------------------
-- Backing store for the approved Blotter / Incident type lists and their public-
-- number acronyms. Seeded from backend/recordTypes.js (the code source of truth)
-- by backend/generate-records.js. The searchable type dropdown reads this so the
-- acronym shows next to each name and typing either the name or the acronym
-- filters the list.
-- ============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `record_type_catalog` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `record_class` ENUM('blotter','incident') NOT NULL,
  `type_name`    VARCHAR(200) NOT NULL,
  `type_code`    VARCHAR(12) NOT NULL,
  `is_active`    TINYINT(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_class_name` (`record_class`,`type_name`),
  KEY `idx_catalog_class` (`record_class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
