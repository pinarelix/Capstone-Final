-- ============================================================================
-- Migration 002 — Cutover: retire the legacy `incidents` table (non-destructive)
-- ----------------------------------------------------------------------------
-- Run AFTER 001. Makes blotter_records + incident_records (via the registry) the
-- single source of truth and turns `incidents` into a READ-ONLY compatibility
-- VIEW (id = registry_id) so every existing SELECT keeps working.
--
-- Non-destructive by design: the 129 legacy sample rows are NOT deleted, they
-- are RENAMED aside to `incidents_legacy` / `cart_risk_factors_legacy` (still
-- queryable, extra rollback safety on top of the scratchpad dump). They no
-- longer appear in the live app, which satisfies "clear the 129 samples"; they
-- can be dropped for good later once the new data is confirmed.
-- ============================================================================

SET NAMES utf8mb4;

-- 1. Drop the broken leftover view (no data; references missing tables/columns).
DROP VIEW IF EXISTS `vw_incident_details`;

-- 2. Detach CART + evidence from the legacy table so it can be renamed.
ALTER TABLE `cart_risk_factors` DROP FOREIGN KEY `cart_risk_factors_ibfk_1`;
ALTER TABLE `incident_evidence` DROP FOREIGN KEY `incident_evidence_ibfk_1`;

-- 3. Park the legacy data aside (preserved, not deleted); frees the `incidents`
--    name for the compatibility view.
RENAME TABLE `incidents` TO `incidents_legacy`,
             `cart_risk_factors` TO `cart_risk_factors_legacy`;

-- 4. Fresh CART table, same shape, now keyed to the registry (registry_id is the
--    new universal record id). incident_evidence had 0 rows, so just re-point it.
CREATE TABLE `cart_risk_factors` LIKE `cart_risk_factors_legacy`;
ALTER TABLE `cart_risk_factors`
  ADD CONSTRAINT `fk_cart_registry`
  FOREIGN KEY (`incident_id`) REFERENCES `record_registry` (`registry_id`) ON DELETE CASCADE;
ALTER TABLE `incident_evidence`
  ADD CONSTRAINT `fk_evidence_registry`
  FOREIGN KEY (`incident_id`) REFERENCES `record_registry` (`registry_id`) ON DELETE CASCADE;

-- 5. Compatibility view: legacy `incidents` column shape over both operational
--    tables. id = registry_id; blotter_number = public_number; form_type derived
--    from source; combined names composed from the structured fields, falling
--    back to the legacy combined columns. Extra trailing columns are additive
--    and harmless to existing readers.
CREATE VIEW `incidents` AS
SELECT
    r.registry_id                                   AS id,
    b.incident_type                                 AS incident_type,
    b.`date`                                        AS `date`,
    b.`time`                                         AS `time`,
    b.latitude                                      AS latitude,
    b.longitude                                     AS longitude,
    b.street_name                                   AS street_name,
    b.address                                       AS address,
    b.reporter_id                                   AS reporter_id,
    b.status                                        AS status,
    b.description                                   AS description,
    b.recommended_action                            AS recommended_action,
    b.danger_level                                  AS danger_level,
    b.created_at                                    AS created_at,
    b.updated_at                                    AS updated_at,
    b.time_of_day                                   AS time_of_day,
    b.day_of_week                                   AS day_of_week,
    b.is_weekend                                    AS is_weekend,
    b.photo_path                                    AS photo_path,
    r.public_number                                 AS blotter_number,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', b.complainant_first, b.complainant_middle, b.complainant_last)), ''), b.reported_by_name) AS reported_by_name,
    b.statement                                     AS statement,
    NULL                                            AS persons_involved,
    b.priority                                      AS priority,
    b.severity                                      AS severity,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', b.respondent_first, b.respondent_middle, b.respondent_last)), ''), b.respondent_name) AS respondent_name,
    b.respondent_address                            AS respondent_address,
    b.respondent_age                                AS age,
    'blotter'                                       AS form_type,
    r.registry_id                                   AS registry_id,
    r.source                                        AS source,
    r.public_number                                 AS public_number,
    b.type_code                                     AS type_code,
    b.is_draft                                      AS is_draft,
    b.data_origin                                   AS data_origin
FROM record_registry r
JOIN blotter_records b ON r.source = 'blotter' AND r.source_id = b.id
UNION ALL
SELECT
    r.registry_id,
    i.incident_type,
    i.`date`,
    i.`time`,
    i.latitude,
    i.longitude,
    i.street_name,
    i.address,
    i.reporter_id,
    i.status,
    i.description,
    i.recommended_action,
    i.danger_level,
    i.created_at,
    i.updated_at,
    i.time_of_day,
    i.day_of_week,
    i.is_weekend,
    i.photo_path,
    r.public_number,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', i.complainant_first, i.complainant_middle, i.complainant_last)), ''), i.reported_by_name),
    i.statement,
    NULL,
    i.priority,
    i.severity,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', i.respondent_first, i.respondent_middle, i.respondent_last)), ''), i.respondent_name),
    i.respondent_address,
    i.respondent_age,
    'crime',
    r.registry_id,
    r.source,
    r.public_number,
    i.type_code,
    i.is_draft,
    i.data_origin
FROM record_registry r
JOIN incident_records i ON r.source = 'incident' AND r.source_id = i.id;
