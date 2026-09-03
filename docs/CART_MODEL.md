# The "CART" Risk Scoring Model

## What it actually is

The system calls this the "CART Engine" throughout the UI, database (`cart_risk_factors`,
`cart_analysis_log` tables), and API routes (`/api/cart/*`). The name is kept for
consistency across the whole system, but it's worth being precise about what the engine
actually does, because "CART" formally refers to a specific machine-learning technique
(Classification and Regression Trees) that this is **not**.

This is a **transparent, weighted rule-based scoring model**:

1. Each incident is scored independently on 5 factors.
2. Each factor's score comes from a fixed lookup table (below).
3. The 5 factor scores are combined by fixed percentage weights into one 0–100 total.
4. The total is bucketed into a danger level by fixed thresholds.

There is no training step, no recursive splitting of a decision tree, no training dataset,
and no accuracy/precision/recall metric — because none of those apply to a rule-based
model. Every score a user sees can be traced back to a specific row in a specific table
below; nothing is learned or inferred from patterns the system discovered on its own.

## Why rule-based, not a trained model

At this stage of deployment there are only a few months of real incident data — not enough
to train a model without it overfitting to whatever happened to occur first, and a trained
model's reasoning would be opaque to the barangay officials who need to trust and act on its
output. A rule-based model is:

- **Auditable** — every score traces back to a documented weight and table entry, not a
  black box.
- **Explainable in the field** — an official can be told exactly why an incident scored
  "High Risk" (e.g. "Robbery, at night, on a street with 6 prior incidents").
- **Immediately usable** — it doesn't need months of accumulated data before it produces
  meaningful output.
- **A sensible baseline** — once enough labeled incident history exists, a trained model's
  output can be validated against this one, rather than trusted blind.

## Weights

| Factor | Weight | Rationale |
|---|---|---|
| Incident type | 30% | The single strongest predictor of severity — a robbery and a noise complaint are not comparable regardless of when/where they happen. |
| Time of day | 25% | Night-time incidents carry materially higher risk (less foot traffic, slower response). |
| Location history | 20% | A street with a documented history of incidents is a meaningfully higher-risk location than one with none. |
| Day of week | 15% | Weekends show a measurable but secondary risk shift versus weekdays. |
| Recent frequency | 10% | A recent spike at a location matters, but least of the five — it's a secondary signal on top of type/time/location. |

Weights sum to 100% (`backend/cart-engine.js`, `this.weights`). They are configurable via
`cartEngine.updateWeights()`, though the Settings UI currently exposes no field to edit them
(only the two thresholds below are user-configurable).

## Thresholds

| Total score | Danger level |
|---|---|
| ≥ 67 | Level 3 — High Risk |
| ≥ 34 and < 67 | Level 2 — Moderate Risk |
| < 34 | Level 1 — Low Risk |

These are editable by an Administrator on the Settings page ("High Risk Threshold" /
"Moderate Risk Threshold", stored in `system_settings` as `default_danger_threshold_high` /
`default_danger_threshold_moderate`). Every scoring call — creating/editing an incident,
recomputing all incidents, and the CART Analytics "what-if" predictor — reads the current
configured values before scoring (`applyConfiguredThresholds()` in `backend/server.js`), so
changes take effect immediately without a restart.

## Per-factor score tables

See `backend/cart-engine.js`, `this.scores`, for the exact lookup tables (incident type,
time of day, day of week, location-history buckets, frequency buckets). Each factor's raw
score (0–100) is multiplied by its weight above, and the five weighted scores are summed
into the final 0–100 total.
