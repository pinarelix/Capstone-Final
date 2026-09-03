# Future Work

Items identified while working through Sections 1-6 that are real, verified gaps but were
deliberately **not** fixed now — either because they're a breaking change, a genuine new
feature rather than a fix, require a resource this project doesn't have (money, months of
data, a code-signing identity), or were an explicit scope decision made along the way. Kept
here as a single reference for what's left, why it's not done, and roughly how big it is.

## Risk scoring (CART engine)

- **Weight editing UI.** The Settings page exposes the two danger-level *thresholds*
  (wired to live scoring as of Section 4B), but not the five factor *weights*
  (type/time/location/day/frequency). `cartEngine.updateWeights()` already exists and
  works — there's just no UI field for it. Small: one more Settings form section plus a
  `system_settings` read, following the exact pattern `applyConfiguredThresholds()`
  (`backend/server.js`) already established for thresholds.
- **Validate against a trained model.** `docs/CART_MODEL.md` already lays out why a
  rule-based model was the right choice for a cold start with no historical labeled data.
  Once enough real incident history accumulates (a realistic bar: at least a full year, to
  cover seasonal variation), it's worth training a real classifier and comparing its
  predictions against the current rule-based scores — not necessarily to replace it, but to
  find out where the hand-picked weights and thresholds diverge from what the data actually
  says. Large: needs a labeled dataset, a training pipeline, and an evaluation methodology
  that doesn't exist yet.
- **`street_id` foreign key.** `incidents.street_name` and `patrol_schedules.location` are
  free text validated against a shared JS array (Section 4A). A proper `streets` lookup
  table with a foreign key would be more robust (rename-safe, supports per-street
  metadata like a fixed lat/long centroid) but is a real schema migration, not a quick
  addition. Medium.
- **Full "CART" rename.** Documented honestly instead (Section 4B) rather than renamed —
  a full rename touches ~14 files (DB table names, `/api/cart/*` routes, `cart.html`/
  `cart.js`, this doc). Worth reconsidering only if a future reviewer specifically objects
  to the name itself rather than the explanation. Medium, and mostly mechanical rather than
  risky.

## Known pre-existing DB debt

- **`vw_incident_details` view.** A broken, unused view left over from an earlier prototype
  schema — it references columns/tables that no longer exist, so anything that touches it
  (like a plain `mysqldump`) fails outright. It's been explicitly excluded from every schema
  operation this project touched (the Jest test DB clone, `database/schema.sql`) rather than
  fixed, since nothing in the running app actually queries it. Small to actually fix
  (`DROP VIEW` or rewrite it against current columns) — flagged repeatedly across sections
  because dropping it wasn't in scope for whatever section surfaced it, not because it's
  hard.

## Security

- **`npm audit`: 3 moderate vulnerabilities** in `backend/`, all from `qs` (via
  `body-parser` via `express@4.22.2`) — a query-string parsing DoS/array-limit issue.
  `npm audit fix --force` resolves it but pulls in **Express 5.x**, a breaking major
  version — real risk of route/middleware behavior changes across every one of `server.js`'s
  routes. Needs its own dedicated regression pass (the existing Jest suite plus a full
  Playwright sweep) before taking it, not a drive-by fix. Medium-Large.
- **2FA.** `system_settings.enable_2fa` and its Settings-page checkbox already honestly
  label themselves "(Future)" — there's no TOTP library, no verification flow, nothing
  pretending to work today. Genuinely a net-new feature if pursued. Large.

## Deployment

- **Code signing.** The Windows installer (`npm run build`) is unsigned — end users will
  see a SmartScreen "Unknown Publisher" warning on first run. A real code-signing
  certificate costs money and ties to a verified publisher identity, which doesn't fit a
  capstone project's budget/scope. Worth a line in the defense presentation ("known,
  accepted limitation") rather than solving it. Not small — this is a cost/process problem,
  not an engineering one.
- **First-run DB setup.** Per Section 6's scope decision, this stays a documented manual
  step (`backend/.env.example` + the README) rather than an in-app wizard. Revisit only if
  this is ever deployed to a non-technical staff member's machine directly, rather than set
  up by whoever's technical enough to run `npm install`. Medium if pursued (a new Electron
  screen that writes `backend/.env`).
- **Auto-update.** No update mechanism exists (no `electron-updater` or equivalent wired
  up) — every future change means manually rebuilding and reinstalling on whatever machine
  runs this. Fine for a single capstone-defense install; would matter if this were ever
  rolled out to multiple barangay hall PCs that need to stay in sync. Medium.
