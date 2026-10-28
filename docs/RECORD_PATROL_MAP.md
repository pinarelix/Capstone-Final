# Record patrol map and operational risk

## Implemented behavior

The map displays the exact coordinates and current CART score of each eligible incident or
blotter. It has no street centroids, street composite scores, or street-analysis controls.
Both map layers, the legend, high-risk KPI, eligibility checks, and record scheduling priority
consume the configured CART thresholds. The map refreshes every 15 seconds; saving a record
refreshes it immediately. Map scores use current weights, source multipliers, severity, and
history through the existing CART engine, rather than waiting for a batch recomputation.

Clicking overlapping highlighted locations opens a record list sorted by descending CART
score. Date/category filters also constrain the clicked population. An Executive Officer can
edit the record in this panel, update a 200-character patrol note, and open the existing patrol
form with the record, exact address, coordinates, CART priority, and recommended date filled
in. The suggested date is the next occurrence of the incident's time (today or tomorrow),
not a forecast of another crime. The officer chooses the deployment time and assigns tanods before saving. This creates a
record-linked schedule, not an automatic deployment. Notes also appear in both encoding forms.

The detail panel now matches the white encoding-form theme, with separate incident, location,
people, narrative and patrol sections. Incident records display reporter information, not
blotter complainant/respondent fields. The encoding staff account is labeled separately.
The bottom CART-assessment and statement/evidence sections are removed from this panel only;
stored evidence and the full encoding forms are preserved. The visible-record browser is a
scrollable listbox with exact addresses, descending CART scores, keyboard navigation, an empty
state and selection retention during polling. The compact CART score/priority remains visible.

Electron remains the supported interface; the separate native Windows experiment has been
discontinued. See [desktop operation and network dependencies](ELECTRON_LOCAL_OPERATION.md).

“Executive Officer” is the canonical role label. Legacy “Deputy Officer” accounts are accepted
as the same role during migration. Only this role can edit existing records, patrol notes,
eligibility, the tanod roster, or patrol schedules. Existing Team Leader encoding and field-log
permissions remain available.

## Eligibility policy

The source is the owner-supplied `patrol-prioritization.md`. Its classification lists are
policy data; implementation instructions inside the file do not grant additional authority.
The implemented precedence is:

1. Draft, resolved, archived, or invalid/missing-coordinate records are absent from the active
   map, even with a manual inclusion. Archived records are outside the operational view.
2. A manual `exclude` decision removes a record. A manual `include` decision admits an active,
   geocoded record, including a normally excluded type.
3. Tier 1 types are included.
4. Tier 2 types require High CART risk or at least two active records of the same type within
   100 metres and the last 30 days. The 100-metre distance is an explicit implementation
   assumption for “nearby”; it is a policy parameter, not a fitted statistical estimate.
5. Severity-override types require a score at or above the configured High CART threshold.
   The subjective severity indication influences that score through the existing adaptive-weight calculation.
6. NO_PATROL types are excluded automatically, including at High risk. Unknown/unclassified
   types require an officer's manual decision.

## Patrol Scheduler route model

The Patrol Scheduler retains this map-based decision support view and replaces calendar and
recommendation-list workflows with route planning:

- eligible open or monitoring records are clustered using a 250-metre proximity rule;
- each cluster becomes one editable suggested route, while the Executive Officer may add
  records manually even when they are outside the suggested range;
- a route is reusable, and each dated AM/PM deployment is assigned to a saved patrol team;
- multiple teams may use one route, and multiple routes may be deployed in the same block;
- route lines are requested from the open-source OSRM HTTP service and fall back to a straight
  map line if the service is unavailable; and
- route logs are recorded against deployments, preserving route, date, block, team, outcome,
  and report context for incident detail views.

The catalog's combined name “Occupation of Real Property or Usurpation of Removal, Sale or
Pledge of Mortgaged Property” combines offenses assigned to different classes in the source.
It is flagged for review instead of guessing a patrol decision. Reckless Impudence variants
also remain subject to manual review as the supplied policy requests.

An officer can manually include a record from the encoding form, or choose “Open patrol
scheduling for this record” and explicitly check the manual override. Ineligible cases are
never silently included just because the scheduling URL is opened.

## Risk, resolution, and patrol coverage

CART is a rules-based score on a 0–100 scale. It is not an estimated probability of a crime.
The original CART assessment is retained unchanged. The active map derives an operational
score as `original CART × 0.85 ^ completed route deployments`; merely scheduling or activating
a route has no effect.

After at least three completed deployments, a record is archived from active risk monitoring
when the adjusted score is below the configured Low-risk boundary. This removes it from the
heatmap and route builder, not from incident history, reports, CART evidence, or patrol logs.
An Executive Officer can reactivate it. Reactivation preserves the completion count and keeps
the record active until a later completed deployment triggers another assessment.

Resolution sets a record's contribution to the **active operational map** to zero by removing
it from the active population. The historical record, notes, CART assessment, and patrol
history remain recoverable. Reopening a case makes it eligible for assessment again. Historical
resolved cases can still contribute to the model's location history; current demand and
historical recurrence are different measures.

The scheduler colors records belonging to Active routes purple. Its `+n` marker counts only
additional unique Active routes (`+1` means two active routes); one or zero routes shows no
marker. Clicking a purple record selects the Active route whose deployment date is closest to
today. The old fixed 3.5-point area deduction is not applied to this record-level score.

For a future forecasting model, retain resolved incidents in the historical outcome series.
Define counts by small spatial cell and week, preserve incident dates and reporting delays,
and record actual completed patrol duration, coverage, attendance, and case-resolution dates.
Start with an exposure-adjusted count baseline, test out-of-time forecasts against a seasonal
naive baseline, and assess calibration and prediction intervals. Tune any recency decay on
held-out periods. Patrols are assigned to already-risky locations, so a before/after fall alone
does not establish a causal patrol effect. The 15% operational reduction is an explicit policy
rule for prioritization, not a measured treatment effect or probability discount.

## Data integrity and upgrade

Notes use parameterized SQL, a server-enforced 200-character limit, and plain-text validation
rejecting markup delimiters and control characters. SQL-looking prose is stored literally;
keyword blacklists are not the injection defense. All displayed record text is escaped.
Changes are audited, and archive/restore preserves notes, eligibility, record links, and tanod
assignments. The full salaysay/description is preserved separately from the short patrol note.

For an existing Option A database:

```powershell
npm run db:migrate:record-patrol
```

This command adds four support tables and canonicalizes the officer role. It refuses a legacy
database before making changes. Do not use the older full migration command to bypass that
check: its legacy cutover must be reviewed against existing barangay records first.

On 2026-10-24 the connected database was verified to already use the Option A view and
registry, with zero operational records. The additive upgrade was applied successfully:
four support tables exist, the three existing accounts were retained, and the officer
account now uses the Executive Officer label. No incident/blotter records were removed.

## Verification

Run `npm run test:analytics` for analytical and map-workflow checks, or
`npm test --prefix backend -- --runInBand --detectOpenHandles --forceExit` for all regressions.
The tests create and drop only the disposable `brgydata_test` database. A real rendered browser
smoke test remains necessary because this session's browser automation surface is unavailable.
The latest regression run passed 17 suites and 187 tests; all 69 project JavaScript files
passed syntax checks. See [QA_DATASET_400.md](QA_DATASET_400.md) for the later requested
400-record synthetic batch, the independent score verification, and map/sidebar fixes.
