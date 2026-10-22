-- ============================================================================
-- Migration 004 — Unified Incident Analytics view (Phase 6)
-- ----------------------------------------------------------------------------
-- Read-only view combining eligible finalized records from both operational
-- tables for CART hotspot analysis. Exposes only analytical fields — no
-- personally identifiable information (complainant, respondent, reporter
-- names, addresses, contact numbers).
--
-- Excludes drafts (is_draft = 1) so incomplete records are never counted
-- in risk analysis. Exposes data_origin so synthetic test records can be
-- identified and excluded from operational statistics when needed.
-- ============================================================================

SET NAMES utf8mb4;

DROP VIEW IF EXISTS `unified_incident_analytics`;

CREATE VIEW `unified_incident_analytics` AS
SELECT
    r.registry_id                       AS id,
    r.source                            AS record_source,
    r.public_number                     AS public_number,
    b.incident_type                     AS incident_type,
    b.type_code                         AS type_code,
    b.`date`                            AS incident_date,
    b.`time`                            AS incident_time,
    b.time_of_day                       AS time_of_day,
    b.day_of_week                       AS day_of_week,
    b.is_weekend                        AS is_weekend,
    b.street_name                       AS street_name,
    b.latitude                          AS latitude,
    b.longitude                         AS longitude,
    b.severity                          AS severity,
    b.priority                          AS priority,
    b.status                            AS status,
    b.danger_level                      AS danger_level,
    b.is_draft                          AS is_draft,
    b.data_origin                       AS data_origin,
    b.created_at                        AS created_at
FROM record_registry r
JOIN blotter_records b ON r.source = 'blotter' AND r.source_id = b.id
WHERE b.is_draft = 0

UNION ALL

SELECT
    r.registry_id,
    r.source,
    r.public_number,
    i.incident_type,
    i.type_code,
    i.`date`,
    i.`time`,
    i.time_of_day,
    i.day_of_week,
    i.is_weekend,
    i.street_name,
    i.latitude,
    i.longitude,
    i.severity,
    i.priority,
    i.status,
    i.danger_level,
    i.is_draft,
    i.data_origin,
    i.created_at
FROM record_registry r
JOIN incident_records i ON r.source = 'incident' AND r.source_id = i.id
WHERE i.is_draft = 0;
