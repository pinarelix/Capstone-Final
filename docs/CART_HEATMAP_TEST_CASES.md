# CART and record patrol map test cases

Run `npm run test:analytics` from the repository root. Jest creates a disposable
`brgydata_test` database and never changes the live barangay records.

The CART model is a transparent weighted scoring model. Tests check its arithmetic and
workflow correctness; passing tests do not establish forecast accuracy or patrol effectiveness.
Implementation policy and the proposed forecasting approach are documented in
[RECORD_PATROL_MAP.md](RECORD_PATROL_MAP.md).

The generated 200-blotter/200-incident scenario design, observed counts, and generator/verification
commands are documented in [QA_DATASET_400.md](QA_DATASET_400.md). Generator, prediction,
source-filter, map-loading, and sidebar-cache regression checks are now part of the suite.

## Automated coverage

| IDs | Subject | Expected result | Test file |
|---|---|---|---|
| CART-01–03 | Factor score tables and counts at bucket boundaries | Time, location, and recent-frequency lookups match documented values | `backend/tests/cart-engine.test.js` |
| CART-04 | Default danger boundaries | 33.99/34/66.99/67 map to Levels 1/2/2/3 | `cart-engine.test.js` |
| CART-05–06 | Independently calculated high/low examples | Scores 89.00 and 20.86 | `cart-engine.test.js` |
| CART-07–09 | Unknown types, severity, weight totals | Default type score 30; adaptive type weights 30/20/10%; all weights sum to one | `cart-engine.test.js` |
| CART-10–12 | Medium weighted calculation, source multiplier, reproducibility | Independent arithmetic, 0.85 blotter multiplier, deterministic bounded scores | `cart-engine.test.js` |
| CART-13–15 | Configured thresholds, explanation, API prediction/recompute | Live boundaries, factor trace, simulation versus risk-prediction logs | CART and settings test files |
| MAP-01 | Configured thresholds reach both layers, legend, and high-cell KPI | All consume the response's Level 2/3 thresholds | `map-ui-contract.test.js` |
| MAP-02 | Category and day/week/month filters | Expected population; weeks start on Monday, including cross-month Sunday | `heatmap-analytics.test.js` |
| MAP-03 | Exact incident pins and rounded KPI cells | Coordinates are retained; 3-decimal cells affect KPIs only | Heatmap helper and record-patrol tests |
| MAP-04 | Clicking filtered locations | Only currently visible records reach the selection popup | `map-ui-contract.test.js` |
| MAP-05 | Authentication and local assets | All map endpoints require login; scripts resolve to real assets | Map API and UI contract tests |
| POLICY-01 | Tier 1, Tier 2, severity override, NO_PATROL, unknown | Inclusion follows the configured policy and live High threshold | `record-patrol.test.js` |
| POLICY-02 | Resolved/draft/missing-location/manual exclude | Manual inclusion cannot bypass inactive or missing-location exclusions | `record-patrol.test.js` |
| POLICY-03 | Live threshold update | High-only types change eligibility immediately without cache delay | `record-patrol.test.js` |
| POLICY-04 | Ambiguous combined property offense | Supervisor review, no automatic decision | `record-patrol.test.js` |
| NOTE-01 | 200 versus 201 characters, markup, control characters | 200 accepted; invalid input rejected by the server | `record-patrol.test.js` |
| NOTE-02 | SQL-shaped prose and apostrophes | Stored literally through parameters; no SQL execution | `record-patrol.test.js` |
| NOTE-03 | Notes during encoding and map editing | Shared short field, original narrative retained, exact address retained | `record-patrol.test.js` |
| ROLE-01 | Executive and legacy Deputy accounts | Canonical label is Executive Officer; both retain authorized access | `record-patrol.test.js` |
| ROLE-02 | Team Leader/Kagawad mutation attempts | Record editing, notes, scheduling, and roster changes return 403 | Record-patrol and patrol tests |
| PATROL-01 | Excluded record scheduling | Requires an explicit manual decision; no silent automatic inclusion | `record-patrol.test.js` |
| PATROL-02 | Schedule record, pin, address, date, priority, and tanods | Authoritative record location and assignments persist | `record-patrol.test.js` |
| PATROL-03 | Archive and restore | Notes, eligibility, linked schedules, and tanod assignments survive | `record-patrol.test.js` |
| RESOLVE-01 | Resolve a patrol record | Removed from active map; historical CART row retained | `record-patrol.test.js` |
| MIGRATE-01 | Repeated additive migration | No fixture loss and no duplicate support tables | `record-patrol.test.js` |

## Manual browser acceptance checks

These remain pending a rendered browser session. The DOM/Mapbox contract double verifies
bindings and filtering but does not establish visual acceptance.

| ID | Procedure | Expected result |
|---|---|---|
| UI-01 | Open Risk Map and inspect multiple records | Exact incident pins; no street-analysis markers or controls |
| UI-02 | Change CART thresholds in Settings and return to the map | Colors, legend, eligibility, and KPI update on the next refresh (within 15 seconds) |
| UI-03 | Click overlapping highlights | Popup list contains the visible records, ordered by descending score |
| UI-04 | Select a record | Exact address, people, narrative, notes, assessment, evidence, and linked patrols are visible |
| UI-05 | Edit an address, status, or notes as Executive Officer | Valid changes save; invalid notes show a validation message; map refreshes |
| UI-06 | Select Add to patrol schedule | Existing form opens with record, exact location, CART priority, and date; no schedule saved yet |
| UI-07 | Assign tanods and save | Schedule list shows the record/address/priority, date, and assigned tanods |
| UI-08 | Browse as Team Leader or Kagawad | Details remain readable; record/schedule mutation actions are absent |
| UI-09 | Change filters, then click a location | Popup contains no records excluded by the active filters |
| UI-10 | Resolve a case or mark no patrol required | Record disappears from the active map, remains in historical records |
| UI-11 | Manually include a normally excluded active case from Records | Case appears; inactive or missing-coordinate cases remain excluded |
| UI-12 | Reopen a resolved case | Eligibility and current CART assessment are reevaluated |

## Database upgrade status

`npm run db:migrate:record-patrol` applies only to an already-upgraded Option A database
and refuses the legacy structure. It was applied successfully to the connected installation
after its Option A structure was verified. A subsequent requested QA batch added 400 synthetic
records; 30 earlier rows remain preserved in `incidents_legacy` pending the owner's import
decision. No legacy record import was performed.
