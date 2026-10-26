# CART Forecast Data Audit

## Baseline (2026-10-26)

The repository contains a separate weighted rule-based engine in `backend/cart-engine.js`. It is retained as the operational baseline and is not a trained decision tree. The canonical registered street list contains 71 streets. Actual records remain in the incident/blotter tables joined through `record_registry`; forecast records must never be written there.

The existing backend regression run recorded 20 suites: 16 passed and 4 failed, with 203 tests passing and 15 failing. The failures are existing archive, patrol, password/security, and patrol markup contracts and are not attributed to the forecasting subsystem.

## Data limitations

The audit must be executed against the configured MySQL database before real promotion. It must report date ranges, source counts, provenance, valid street/date percentages, drafts, duplicates, coordinates, reporting delays, and complete street-week coverage. The current repository does not establish 36 months of genuine Barangay 179 history; therefore the initial implementation is explicitly a synthetic prototype and cannot be labelled validated real.

## Label policy

Qualifying observations are non-draft incident/blotter records with a valid occurrence date and registered street. The target is at least one qualifying record in a Monday-to-Monday Asia/Manila week. Shared real-world duplicates must be deduplicated by registry/source linkage before labels are built. Negative weeks require complete reporting coverage; unknown coverage is not silently treated as zero.
