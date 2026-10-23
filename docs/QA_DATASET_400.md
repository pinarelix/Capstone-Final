# 400-record CART and geospatial QA dataset

Created on 2026-10-24 in `brgydata`, batch `qa-cart-map-400-v1`, seed 179.
The batch contains **200 incident records and 200 blotter records**. Every record has
`data_origin = synthetic`, fictional QA names/addresses, and an explicit synthetic narrative.
No live records, users, schedules, or the 30 preserved legacy rows were deleted.

This is a deliberately balanced software test set, not a representative sample of crime.
It checks rules, analytics, filters, and workflows. It cannot measure real-world forecast
accuracy, calibration, or patrol effectiveness.

## Coverage design

| Purpose | Records | What to verify |
|---|---:|---|
| Approved catalog | 63 | Every approved type/source combination, including excluded and review-only types |
| Severity × time × weekday/weekend | 48 | All 24 combinations for each source; correct lookup and adaptive weighting |
| Isolated location counts 1/2/3/4/5 | 30 | Exact location buckets, zero recent frequency, quiet-area low scores |
| Recency boundaries | 20 | Today, 1/29/30/31/89/90/91/180/365 days ago; correct 30-day inclusion |
| Time boundaries | 20 | Midnight and the 05:59/06:00, 11:59/12:00, 17:59/18:00, 21:59/22:00 transitions |
| Spatial pairs | 16 | Same pin, within 100 m, beyond 100 m, and distant points on one street |
| Patrol decisions | 16 | Manual include/exclude, High-only overrides, NO_PATROL, and review-only types |
| Resolved history | 40 | Hidden from the active map but retained in historical/scoring context |
| Drafts | 10 | Excluded from CART rows and the active map |
| Missing/outside locations | 10 | Six missing pins and four deliberately outside the barangay boundary |
| Notes and text handling | 16 | Empty, 199/200 characters, apostrophes, accents, multiline text, and SQL-shaped literal prose |
| Threshold probes | 8 | Real model scores immediately below and at/above the configured Moderate and High thresholds, per source |
| Background history | 103 | Additional dates, streets, incident types, and risk combinations |
| **Total** | **400** | **200 per source** |

The nearest attainable threshold probes are found by searching valid type, severity, time,
and day combinations under the actual location/frequency context. Stored CART scores are
never fabricated to force a color. Exact 34/67 classification boundaries also have direct
unit tests. Invalid HTML/control characters and 201-character notes are tested through the
API rather than inserted into the dataset as valid records.

Spatial labels describe pair distances, not a guarantee that no other incident is nearby.
Tier 2 eligibility correctly considers all same-type active neighbors in the full dataset.
Pins are jittered only inside the shared barangay polygon, except for the four explicitly
labeled outside-boundary negative cases.

## Observed baseline

At generation with thresholds 34/67 and source multipliers incident 1.0 / blotter 0.85:

| Check | Result |
|---|---:|
| Incident base records | 200 |
| Blotter base records | 200 |
| Scored records | 390 |
| Unscored drafts | 10 |
| Low / Moderate / High among scored records | 21 / 295 / 74 |
| Expected patrol-map records after all exclusions | 156 |
| Independent verification mismatches | 0 |

Actual near-threshold probe scores were:

| Source | Below Moderate | At/above Moderate | Below High | At/above High |
|---|---:|---:|---:|---:|
| Incident | 33.64 | 34.57 | 66.86 | 67.00 |
| Blotter | 33.94 | 34.00 | 66.73 | 67.03 |

Resolved records are part of the scored history, so the resolved count is not added to the
scored count. The active record list contains 175 records per source by default; resolved
records and drafts account for the difference from 200. The map intentionally shows a
smaller subset because it also enforces patrol eligibility and geography. Counts can change
when records age, thresholds change, or officers edit cases.

## How to use it

In Records, search descriptions for scenario names such as `factorial-grid`, `time-boundary`,
`threshold-high-below`, `severity-override-high`, `manual-include`, `same-pin`, or
`notes-validation`. Select incident versus blotter to compare source weighting. Use the map's
date/category filters and record popup to inspect coordinates, notes, policy reasons, and
patrol prefill. All generated events and people are fictional; do not dispatch patrols based
on these fixtures.

Examples from this batch:

- `INC-T-0004`: isolated quiet street, CART 31.00.
- `INC-PI-0005` / `INC-PI-0006`: same-pin incidents, CART 58.00 each.
- `INC-VAWC-0004`: High-only patrol override, CART 83.00.
- `BLT-NC-0002` / `BLT-NC-0003`: same-pin blotters, CART 46.33 each.
- `BLT-AOL-0003`: High-only patrol override, CART 69.28.

From the repository root:

```powershell
npm run db:generate:qa -- --dry-run
npm run db:generate:qa
npm run db:verify:qa
npm run test:analytics
```

The default named batch is idempotent: rerunning it reuses the 400 records. Use an explicit
new `--batch` only when another batch is intentional. The old destructive `--reset` option
has been removed. `qa_record_batches` stores the seed, base date, model configuration, and
summary; `qa_record_cases` links each record to its scenario and generation-time expectation.
Reproducibility requires the same seed, base date, street pins, and model settings. Frozen
expectations are a generation snapshot; the verifier recomputes against current settings and
current history, so changes may legitimately require a CART recomputation.

## Defects exposed and fixed

- The old generator produced 224 records and failed to populate `time_of_day` correctly.
- Its scoring omitted the incident source, applying the blotter multiplier to incident rows.
- Binary floating-point half-cent rounding could change a CART result by 0.01.
- What-if prediction omitted explicit severity/source context, included drafts in history,
  and could use stale source multipliers. It now uses the same inputs as persisted scoring.
- Filtering the compatibility view's literal `form_type` could cause a MySQL collation error.
  Source filters now use the registry's actual source column.

## Map and navigation fixes

The CSP now explicitly permits the OpenStreetMap raster host used when no Mapbox public token
is configured. Mapbox GL remains the renderer. No access token is required for that fallback.
Record data loads independently of basemap tiles, and overlays initialize at `style.load`.
A local background, readable status message, and record list remain available if tiles fail.

The sidebar no longer replays its reveal/logo/menu entrance animations. A small head script
restores collapse state, role visibility, and per-account order before paint. Navigation order
is cached for five minutes instead of being fetched/reapplied on every page, and bundled icon
fonts have a one-day cache lifetime. The app retains normal multi-page navigation; it has not
been converted into a single-page application.

The currently running server was observed to still have the old CSP loaded. **Close and restart
the app once** to activate backend changes. Installed builds also need rebuilding to include
the new source files. Automated tests cover resource policy, map loading contracts, ordering
cache behavior, and data correctness. Rendered browser acceptance remains pending because no
browser automation surface is available in this session.

Final automated checks: **17 suites / 187 tests passed**, **69 JavaScript files passed syntax
checks**, and **no missing static local HTML assets**. Live record totals and all 30 preserved
legacy rows were rechecked after the disposable-database tests completed.
