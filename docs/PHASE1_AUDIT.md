# Phase 1 — Codebase Audit & Migration Proposal

**Barangay 179 Crime Intelligence / Incident Management System**
**Scope:** Separate Blotter and urgent Incident workflows; structured people & address data; unified rule-based CART analysis across both sources.
**Status:** Phase 1 (audit only). **No code or production data was modified.** This document ends at the Phase 1 **Approval Gate** — Phase 2 (database restructuring) must not start without explicit authorization.

> Method note: findings were produced by inspecting the actual source (`backend/server.js`, `backend/cart-engine.js`, `backend/archive.js`, the `frontend/` forms) **and by read-only queries against the live `brgydata` database** — not from `schema.sql` alone, which is proven stale below.

---

## 0. Headline findings (read these first)

1. **`schema.sql` does NOT match the live database.** The live `incidents` table has **5 columns absent from `schema.sql`** — `severity ENUM('High','Medium','Low')`, `respondent_name`, `respondent_address`, `age`, and **`form_type ENUM('blotter','crime')`**. The live DB also contains an **18th object, a broken view `vw_incident_details`**, not in `schema.sql`. Rule 3 confirmed: treat `schema.sql` as a baseline reference only.

2. **A blotter/crime split is already partly built — in a single table, not two.** The frontend already has a **"Blotter Form" vs "Crime Form" radio toggle**, severity Low/Medium/High, and respondent fields. The proposal is therefore **not** "split one combined form"; it is "finish and formalize a half-done, single-table split into clean independent tables."

3. **No existing field reliably classifies urgent vs non-urgent.** `priority` is **derived** from `severity` (High→Urgent, else Normal) in the frontend — not independent. `form_type` is **99% default**: of 129 records, **128 = `blotter`, 1 = `crime`** (and that one is `Normal`). So migration classification **cannot be automated safely** and requires an owner-reviewed manual queue (matches the prompt's Rule).

4. **Evidence migration is a non-issue for existing data** — `incident_evidence` has **0 rows** and all 129 `photo_path` values are NULL. But the relational redesign still matters for *new* records.

5. **CART weights and thresholds already exist and are configurable** (`system_settings`). These are the approved values — no need to invent any. One subtlety: CART already applies a **severity-adaptive** override to the type weight.

---

## 1. Codebase architecture summary

Single Node.js process (`backend/server.js`, ~3,800 lines) that **both** serves the static `frontend/` and exposes the REST API on port 3000. Electron (`main.js`) is an optional desktop wrapper around the same process. MySQL 8.0 `brgydata`. (Confirmed by `docs/ARCHITECTURE.md`.)

| Layer | Location | Notes |
|---|---|---|
| Static + API | `backend/server.js` | monolith; all incident/CART/dashboard/settings routes |
| Risk engine | `backend/cart-engine.js` | rule-based weighted scoring (not ML) |
| Archive/restore | `backend/archive.js` | snapshot-to-`archived_records`, id-preserving restore |
| DB pool | `backend/server.js` (pool) + `backend/connectors/mysql.js` | mysql2, parameterized queries |
| Config | `backend/.env`, `backend/config.json`, `config-manager.js` | **`config.json` holds a plaintext DB password and is not gitignored** (see §6) |
| Frontend forms | `frontend/incident.html` / `incident.js` | the one entry form, with blotter/crime toggle |
| Frontend read | `report.*`, `incident-view.*`, `dashboard.*`, `grid-heatmap.*` | listing / analytics / export (client-side CSV) |

**AuthZ model (verified in code):** session-token auth (`user_sessions`, 30-min idle timeout), `requireRole([...])` re-checks the DB each call. Roles ENUM is exactly `('Deputy Officer','Kagawad','Team Leader')`.

| Action | Deputy Officer | Team Leader | Kagawad |
|---|---|---|---|
| Create / Edit incident | ✅ | ✅ | ❌ (read-only) |
| Delete incident | ✅ | ❌ | ❌ |
| Add/Delete evidence | ✅ | ✅ | ❌ |
| Read / list / heatmap | ✅ | ✅ | ✅ |
| Edit CART weights, view audit logs | ✅ | ❌ | ❌ |

> Note: the display labels in the README ("Barangay Captain", "Desk Officer") do **not** map 1:1 to DB roles — the demo `captain` account is DB role `Kagawad`, `deskofficer` is `Team Leader`. Preserve the DB enum; do not rename roles.

---

## 2. Current database relationship map (live, reconciled)

**18 objects live** (17 tables + 1 broken view). Core incident subsystem:

```
users(id) ──reporter_id(SET NULL)──> incidents(id)
incidents(id) ──1:0..1 (UNIQUE, CASCADE)──> cart_risk_factors(incident_id)
incidents(id) ──1:0..* (CASCADE)──> incident_evidence(incident_id)
users(id) ──triggered_by(SET NULL)──> cart_analysis_log
archived_records(entity_type, entity_id)  -- polymorphic, NO FK by design
audit_logs(entity_type, entity_id)        -- polymorphic, NO FK by design
location_coordinates(location PK)  area_risk_decay(location PK)  -- key off free-text street name
```

**Live `incidents` columns (authoritative — from `SHOW COLUMNS`):**
`id, incident_type, date, time, latitude, longitude, street_name, address, reporter_id, status, description, recommended_action, danger_level, created_at, updated_at, time_of_day, day_of_week, is_weekend, photo_path, blotter_number, reported_by_name, statement, persons_involved, priority,` **`severity, respondent_name, respondent_address, age, form_type`** (last 5 not in `schema.sql`).

**Live data profile (129 incidents):**

| Signal | Distribution | Implication for migration |
|---|---|---|
| `form_type` | 128 `blotter`, 1 `crime` | intended discriminator, but effectively unused/default |
| `priority` | 93 Normal, 36 Urgent | **derived from severity**, not independent |
| `severity` | 36 High, 49 Medium, 44 Low | High ⇔ Urgent 1:1 (confirms derivation) |
| `blotter_number` | 128 `BLT-2026-NNNN`, 1 NULL | **all 36 urgent rows also carry a BLT- number** → blotter_number ≠ non-urgent |
| `reported_by_name` | 129 populated, combined "First Last" | legacy combined name to structure |
| `respondent_name`/`address` | 128 populated, combined strings | legacy combined to structure |
| `statement`, `persons_involved` | 0 populated (always empty) | dead columns in practice |
| `photo_path` / `incident_evidence` | 0 / 0 rows | **no evidence exists to migrate** |
| `status` | 129 `Open` | no Resolved/Monitoring in current data |

**Dead object:** `vw_incident_details` references `occurred_on`, `occurred_at`, `location_label`, `lat`, `lng`, `purok_id` and a `puroks` table — **none exist**. `SELECT` from it returns `ERROR 1356`. It is a leftover from an abandoned schema iteration; safe to drop (flagged, not actioned).

---

## 3. Existing form data flow

One form, `frontend/incident.html` (`#incidentForm`), toggles Blotter vs Crime via `name="formType"` radios; `applyFormType()` shows/hides field groups. Submit handler `setupForm()` in `incident.js` builds a JSON payload → `POST /api/incidents` (or `PUT /:id`), then a **separate** multipart `POST /api/incidents/:id/evidence`.

| UI field | Payload key | Backend |
|---|---|---|
| Incident Type (plain grouped `<select>`, ~65 options, inline in HTML; `__other__` reveals free text) | `incident_type` | Joi string required |
| Date / Time | `date` / `time` | required; `time_of_day`, `day_of_week`, `is_weekend` derived server-side |
| Street (`<select>`, ~69 streets from `locationList.js`) | `street_name` | whitelisted to `BARANGAY_LOCATIONS` |
| hidden lat/lng (auto-filled from `/location-coordinates`) | `latitude`/`longitude` | required |
| Severity (High/Medium/Low) | `severity` | also derives `priority` (High→Urgent) client-side |
| Blotter: House/Blk/Lot free-text + **Landmark** | joined into one `address` string | single `VARCHAR(255)` |
| Crime: Address free-text | `address` | — |
| Complainant name (blotter) / Reporter name (crime), single field | `reported_by_name` | `VARCHAR(150)` |
| Respondent name / address, single fields | `respondent_name` / `respondent_address` | — |
| Blotter number (readonly, auto-gen) | `blotter_number` | stored as-sent |
| Evidence (multiple, ≤5) | separate multipart | `incident_evidence` rows |

**Gap vs the target spec (what's new work):** Crime→Incident rename; structured first/middle/last names; structured block/lot/house/street/unit address; "Same as Complainant"; draft / unknown-respondent; searchable incident-type dropdown; "No Evidence Available" + explanation; Clear-Form confirmation. **Already present:** severity Low/Medium/High; complainant & respondent concepts; 5-file evidence; input preservation on failure (form only resets after a *successful* save).

**A Landmark field currently exists** (blotter path) and the spec says to remove it from the new forms — a deliberate change, flagged.

---

## 4. CART processing flow

Rule-based weighted scoring (`cart-engine.js`; `docs/CART_MODEL.md`). Reads the `incidents` table directly; **never distinguishes blotter vs crime.**

- **Inputs consumed:** `incident_type`, `time_of_day` (falls back to deriving from `time`), `is_weekend`, `street_name`, `severity`, and `date` (30-day frequency window only). **Not used:** `status`, `day_of_week` (name), `priority`, `form_type`.
- **Five factors → weighted sum → 0–100 → bucket.** Base weights (configurable in `system_settings` as `cart_weight_*`): **type 30, time 25, location 20, day 15, frequency 10**.
- **Severity-adaptive override (important):** `severity` resets the *type* weight (High 0.30 / Medium 0.20 / Low 0.10) and re-proportions the other four. So configured base weights are not applied verbatim.
- **Thresholds** (`system_settings`): `≥67` Level 3 High, `≥34` Level 2 Moderate, `<34` Level 1 Low.
- **Outputs:** one row per incident in `cart_risk_factors` (**hard FK + UNIQUE on `incident_id`, CASCADE**); one row per run in `cart_analysis_log`. Writes resolved level back to `incidents.danger_level`.
- **Geography:** "location" = `COUNT(*)` of incidents sharing the free-text `street_name` (no grid/zone in scoring). `location_coordinates` feeds the map only; `area_risk_decay` is a display-time subtracted offset (patrol decay 3.5/patrol). A separate hotspot query (`/api/heatmap/street-analysis`) computes a composite and ranks streets.
- **No "source weight" (blotter vs incident) concept exists.** This is the net-new CART work in Phase 6, and the owner must supply the source weights and how they combine with the existing (already severity-adaptive) formula.

---

## 5. Affected modules & dependencies (compatibility surface for a table split)

Every consumer that does `FROM incidents` / `FROM incident_evidence` or joins `cart_risk_factors` is code a `blotter_records`/`incident_records` split would have to bridge. Heaviest consumers:

- **CART:** `computeCartRiskFactors` (server.js ~876/890/902), `recomputeAll` (~981/1009/1017), `cart/predict` (~3305/3311).
- **Incident CRUD + list/search:** `/api/incidents` (~1793), `/view-only` (~1866), `/:id` (~1959), heatmap (~2006/2038), create/edit/delete (~2115/2208/2286), evidence (~2385/2415), `next-blotter` (~1771).
- **Dashboard:** `/api/dashboard/stats` and `/charts` aggregation block (~2601–2760): GROUP BY `incident_type`, `HOUR(time)`, `street_name`, `COALESCE(form_type,'blotter')`, `DATE(date)`; danger bucketed in JS.
- **Archive/restore:** `backend/archive.js` **hardcodes** table names in `ENTITY_TABLES` (`'incident'→incidents`, `'incident_evidence'→incident_evidence`) and the restore `switch`. Restore **preserves original id** and 409s on conflict.
- **Reports/export:** **no server-side CSV/PDF** — built client-side in `report.js`; backend only audit-logs the export action.

Approx. **40 query sites** total across these; enumerated in the working notes. A repository/compatibility layer (not DB triggers) is the lower-risk way to bridge them.

---

## 6. Identified technical debt / risks found during audit

| # | Finding | Severity | Phase to address |
|---|---|---|---|
| D1 | `schema.sql` stale (missing 5 columns; includes broken `vw_incident_details`) | High (misleads planning) | Phase 2 (regenerate from live) |
| D2 | Classification signals conflict (`priority` derived, `form_type` unused) | High | Phase 2.10 (manual review) |
| D3 | `blotter_number` generation races: `ORDER BY id DESC +1`, client-supplied, no uniqueness/lock | High | Phase 2.5 / Phase 5 |
| D4 | DB connection **does not pin `utf8mb4`** charset explicitly | Medium (Ñ/ñ, accents — Phase 4 risk) | Phase 4/5 |
| D5 | No idempotency on `POST /api/incidents` → duplicate submissions create duplicate rows | Medium (Scenario H) | Phase 4/5 |
| D6 | No server-side output encoding on free-text fields → stored-XSS depends on frontend escaping | Medium | Phase 8 |
| D7 | `config.json` contains a plaintext DB password and is **not** in `.gitignore` (currently untracked, but one `git add .` from exposure) | Medium | Phase 8 |
| D8 | `statement`, `persons_involved`, `age` columns largely unused / no form input | Low | Phase 3 cleanup |
| D9 | `view-only`/`:id` inline role arrays have a duplicated `'Kagawad'` (harmless) | Low | opportunistic |

(SQL injection is **not** a current risk — all incident queries are parameterized via mysql2 `?`.)

---

## 7. Migration risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mis-classifying the 36 urgent-ish records | High | High (wrong table, wrong CART weighting) | **Manual review queue**; do not auto-split on `priority`/`form_type`/`severity` alone |
| Breaking the ~40 `incidents` query sites | Med | High | Repository/compat layer + read view; keep legacy `incidents` as source during migration |
| Breaking archive/restore (hardcoded table names) | Med | High | Extend `ENTITY_TABLES` + restore switch together; test id-preserving restore for both new types |
| Breaking `cart_risk_factors` FK (points only at `incidents.id`) | Med | High | Registry or per-table risk tables; preserve existing 129 CART rows |
| ID sequence collision on cutover | Med | Med | Concurrency-safe sequence seeded from existing max per type/location code |
| Name/address split corrupting data | Med | Med | Preserve original combined strings; never auto-split ambiguous names |
| utf8mb4 mojibake on Ñ/accents | Low-Med | Med | Pin charset before any re-write of text data |
| Evidence link loss | Low | Low | 0 rows today; design registry FK for new records |

---

## 8. Proposed architecture (for approval — not yet built)

Options evaluated; recommendation stated. **All pending owner approval.**

**8a. Table design — recommend `record_registry` + two operational tables.**
- `record_registry(registry_id PK, source ENUM('blotter','incident'), source_id, public_number, legacy_incident_id, created_at)`, one-to-one with each operational row; gives evidence, CART, audit, archive a **single stable reference** instead of an ambiguous dual FK.
- `blotter_records` and `incident_records` with the structured fields (people, address, draft flag, data-origin, legacy mapping).
- `incident_evidence` and `cart_risk_factors` re-point to `registry_id` (not `incidents.id`).
- Alternative (lighter) = keep one `incidents` table + a strict `form_type` discriminator. **Rejected** because it does not satisfy "independent tables / independent BLT & INC sequences" and perpetuates the current ambiguity — but it is the fastest path if the owner prefers minimal change; decision needed.

**8b. ID scheme.** Target `{PREFIX}-{LOCATION_CODE}-{SEQUENCE}` (e.g. `INC-VC-1063`, `BLT-VC-1063`). Current scheme is `BLT-{YEAR}-{NNNN}` with **no location code** — so the location code (`VC`?) and whether sequences are global or per-location must be confirmed. Use a concurrency-safe counter table (not `MAX(id)+1`). Legacy `BLT-2026-NNNN` numbers are preserved in `legacy_incident_id`/`public_number` for traceability.

**8c. People & address.** New `persons`/role structure (complainant, respondent, reporter) with first/middle/last; structured address (block/lot/house/street/unit; **no Landmark**). **Preserve** the legacy combined `reported_by_name` / `respondent_*` strings; do not auto-split ambiguous names.

**8d. CART.** Add `source` as an input; add owner-approved **source weights** (blotter vs incident) to the existing formula; build read-only `unified_incident_analytics` view over finalized records from both tables; **exclude drafts**; preserve the 129 existing CART rows.

**8e. Compatibility.** Repository abstraction + read-only compatibility view named `incidents` (or routed in app code). **Avoid triggers / dual-writes** unless explicitly approved.

---

## 9. Rollback proposal (for Phase 2+)

- Full `mysqldump` of `brgydata` + copy of `uploads/` **before** any DDL (scripts already exist: `backend/scripts/backup-database.js`, `restore-database.js`).
- All migration in a **transaction per batch**, writing a migration-outcome log; retryable and idempotent (skip already-migrated `legacy_incident_id`).
- New tables are **additive**; legacy `incidents` stays intact and readable throughout → rollback = stop using new tables, no destructive step.
- Never roll back by dropping new tables blindly; preserve rows created after cutover.

---

## 10. Proposed phase sequence (gated)

1. **Phase 1 (this doc) — audit.** ✅ complete; awaiting approval.
2. **Phase 2 — DB restructuring** (registry + 2 tables + sequences + migration with manual-review queue + reconciliation). *Needs: classification rules, location code, approval to run on a DB copy first.*
3. **Phase 3 — forms** (rename, structured names/address, searchable dropdown, Same-as-Complainant, draft, No-Evidence). *Needs: approved urgent + normal type catalogs.*
4. **Phase 4 — validation & utf8mb4 & error preservation & idempotency.**
5. **Phase 5 — backend/API split + concurrency-safe IDs.**
6. **Phase 6 — unified CART.** *Needs: source weights + historical testing records.*
7. **Phase 7 — dashboard/report/archive compatibility.**
8. **Phase 8 — security/privacy** (incl. D6, D7).
9. **Phase 9 — tests + red-team.**
10. **Phase 10 — deploy/rollback/handoff.**

---

## 11. Clarifications required before Phase 2 (owner to supply)

1. **Classification rules** for the 129 legacy records — since `priority`/`form_type`/`severity` don't agree, how should each be routed to `blotter_records` vs `incident_records` (and which go to manual review)?
2. **Approved urgent Incident type catalog** and **approved normal Blotter type catalog** (the Incident Form must show only approved urgent types).
3. **Location code** — is `VC` correct for Barangay 179? Are sequences global or per-location?
4. **Table strategy** — approve `record_registry` + two tables (recommended) vs. single-table discriminator (lighter)?
5. **CART source weights** (blotter vs incident) and how they combine with the existing severity-adaptive formula; keep or retire the severity-adaptive override.
6. **Historical testing records** for CART verification (synthetic + real, keeping origin tags).

---

**Approval Gate:** Phase 1 is complete and no production data was touched. **Do not proceed to Phase 2 (database restructuring) until the above is approved.**
