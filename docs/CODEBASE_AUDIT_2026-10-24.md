# Codebase Audit and ZIP Merge Report

**Project:** Barangay 179 Crime Intelligence and Patrol Decision Support System  
**Audit date:** 2026-10-24 (Asia/Manila)  
**Archive reviewed:** `Capstone-Final-patrol-final.zip`  
**Git baseline:** `838b625` (`main`, matching `origin/main` at audit time)

## Executive summary

The ZIP was reconstructed as a patch against the repository baseline and merged without copying the archive wholesale. This preserved the large set of pre-existing, uncommitted security, setup, documentation, and test changes already in the workspace.

The archive added three user-visible capabilities:

1. Blotter-mediation assignment and a personal daily mediation queue.
2. Search and deterministic ordering for CART patrol recommendations.
3. Per-user drag-and-drop sidebar ordering.

During integration, the audit found and fixed test-infrastructure, authorization, schema, validation, analytics, and dependency-security defects. The backend now passes **187/187 tests**, all project JavaScript passes syntax validation, local HTML asset references resolve, the migration path succeeds twice against an isolated database, and `npm audit --omit=dev` reports **0 backend production vulnerabilities**. The record patrol map update and additive live-database upgrade are documented in `docs/RECORD_PATROL_MAP.md`; the subsequent 400-record QA batch and map/sidebar fixes are in `docs/QA_DATASET_400.md`.

At the initial audit, the real database still used the legacy structure. A later check found the Option A view and registry installed. The additive patrol upgrade has been applied, followed by the requested 200-blotter/200-incident synthetic QA batch. The 30 legacy rows remain preserved outside the active record view; whether to transfer them is still an owner data decision.

## Merge scope

The archive's meaningful patch contained 19 files and approximately 166 added lines before cleanup and hardening:

- Backend task/navigation API routes.
- One task-manager SQL migration.
- Dashboard mediation widget and update dialog.
- Incident-page assignment form.
- Patrol recommendation search and ordering.
- Shared sidebar drag behavior and styles.
- Implementation notes.

Most other ZIP-versus-worktree differences were line-ending differences. Local files not present in the archive, including seed scripts, test evidence, setup work, and security changes, were retained.

## System feature inventory

### Authentication and security

- Three displayed roles: Executive Officer, Kagawad, and Team Leader; legacy Deputy accounts remain compatible.
- Password hashing, session token hashing, logout, inactivity handling, and password reset.
- Role-based API authorization and role-aware UI controls.
- Login history, audit logging, request rate limiting, security headers, and guarded setup/recovery flows.
- Evidence upload limits, MIME allowlisting, and magic-byte verification.

### Incident and blotter management

- Separate blotter and incident record classes behind a compatibility view.
- Create, read, update, archive/delete, and restore workflows.
- Structured complainant, respondent, reporter, and address data.
- Draft records, evidence attachments, map coordinates, filtering, search, and pagination.
- Public record numbering and a record-type catalog.
- Blotter-mediation assignment to active staff accounts.

### Mediation task management

- Daily queue scoped to the authenticated assignee.
- Priority-first and appointment-time ordering.
- Pending, In Progress, Canceled, and Rescheduled states.
- Notes and immutable task-history entries.
- Owner-only task updates and history access.
- Audit events for task creation and updates.

### Analytics and patrol decision support

- KPI dashboard, charts, recent activity, and system health.
- Rule-based CART risk scoring with configurable weights and thresholds.
- Record-location heatmap with live CART thresholds, patrol eligibility policy, record editing, and shared notes.
- Patrol recommendation generation, client-side search, record-linked scheduling, tanod assignments, coverage, and logs.
- CSV/print/monthly reporting.

### Administration and desktop operation

- User management, settings, audit trail, archive, and backup/restore utilities.
- Per-user sidebar ordering stored in MySQL.
- Electron desktop shell, Windows installer configuration, setup wizard, and LAN deployment documentation.

## Findings and disposition

| Severity | Finding | Disposition |
|---|---|---|
| Critical | A local post-setup bypass allowed unauthenticated access to setup routes and incorrectly included `/save` as "read-only." Removing it outright then prevented Electron's mandatory pre-login setup gate from loading the saved configuration. | **Fixed.** Post-setup browser requests require Deputy Officer/recovery authorization, while the Electron setup window receives a random per-launch, localhost-only boot token. Changed database settings trigger an application restart so the connection pool is rebuilt. |
| High | The test harness connected to configured MySQL port 3307 initially, then silently used the default port 3306 for its pool, causing a misleading authentication failure against a second MariaDB service. | **Fixed.** The configured port is now used consistently. |
| High | The task migration declared a foreign key to `incidents`, which becomes a view after migration 002; MySQL cannot enforce a foreign key to a view. | **Fixed.** It now references `record_registry.registry_id`. |
| High | The merged task API accepted any numbered incident, including crime records, despite being a blotter-mediation workflow. | **Fixed.** Assignment verifies a `record_registry` source of `blotter`. |
| High | Kagawad is documented as read-focused but the archive allowed that role to create mediation assignments. | **Fixed.** Assignment is limited to Deputy Officer and Team Leader in both API and UI. |
| High | Backend dependencies contained 1 critical, 1 high, and 4 moderate advisories. | **Fixed.** Non-breaking packages were updated; `file-type` was migrated to the fixed Node-20-compatible 21.3.x ESM API. Production audit is clean. |
| High | The initial live database used a legacy schema incompatible with current record routing. | **Structure now upgraded.** The later check found the Option A view/registry; the guarded additive patrol upgrade has been applied. |
| High | Migration 002 preserves legacy incidents in `incidents_legacy` but does not copy them into the new operational tables, so existing rows disappear from the normal application view after cutover. | **Open data decision.** Confirm the 30 rows are disposable/synthetic or build a data-transfer migration before production cutover. |
| Medium | The test database depended on whatever schema happened to be installed in the live database. | **Fixed.** The disposable clone now applies repository migrations before tests. |
| Medium | Task IDs and assignee/incident IDs allowed zero or negative safe integers, and invalid calendar dates could normalize silently in JavaScript. | **Fixed.** IDs must be positive; local date/time values are component-validated. |
| Medium | Task creation had no initial history row or audit event. | **Fixed.** Creation and updates now write history/audit records. |
| Medium | The documented migration command did not run the numbered SQL files. | **Fixed.** `npm run db:migrate` applies them in dependency order and is idempotent on the isolated validation database. |
| Low | Sidebar reordering is pointer/drag based and has no keyboard reordering control. | **Open accessibility improvement.** Server-side validation and per-account isolation are present. |
| Low | No manual Electron end-to-end interaction was performed during this audit. | **Open verification step.** API, schema, syntax, link, and integration checks passed. |

## Verification performed

| Check | Result |
|---|---|
| Backend Jest integration/security/analytics suite | **17 suites, 187 tests passed** |
| New mediation/navigation tests | **6 tests passed** |
| JavaScript syntax validation | **69 files passed** |
| Local HTML asset-reference scan | **Passed** |
| Backend production dependency audit | **0 vulnerabilities** |
| Root production dependency audit | **0 vulnerabilities** |
| Fresh baseline schema to current migrations | **Passed in isolated database** |
| Second/idempotent migration run | **Passed in isolated database** |
| Real database mutation | **Guarded additive patrol upgrade applied; no incident rows deleted** |
| Manual Electron UI test | **Not performed** |

## Safe deployment sequence

1. Create and verify a MySQL backup.
2. Review the 30 preserved `incidents_legacy` rows and decide whether they are samples or must be transferred.
3. If they must appear in the active application, add and test a legacy-to-Option-A data transfer; rerunning the cutover does not import them.
4. For an already-upgraded installation, use `npm run db:migrate:record-patrol` with a DDL-capable account. This additive upgrade has already been applied to the connected database.
5. Run `npm test --prefix backend -- --runInBand --detectOpenHandles`.
6. Launch Electron and manually verify login, incident CRUD, mediation assignment/update/history, patrol search, sidebar ordering, role visibility, reports, and logout.

Do not rerun `database/schema.sql` on the populated real database; it is a baseline for a fresh database, not an in-place upgrade mechanism.
