# Data Flow Diagrams — Level 0 and Level 1

Data flow diagrams for the **Barangay 179 Crime Intelligence and Patrol Decision
Support System**, derived from the running code (`backend/server.js`,
`backend/cart-engine.js`, `backend/archive.js`, `backend/recordTypes.js`) and the
current database (`database/schema.sql` + `database/migrations/`).

The Level 0 context diagram is a static SVG/PNG because its three role-specific
external entities need a wider manual layout than Mermaid produces cleanly. Levels
1 and 2 are Mermaid flowcharts: GitHub renders them inline, and each block can be
pasted into the [Mermaid Live Editor](https://mermaid.live) for export. Pre-exported
files are in [`diagrams/`](diagrams/) and linked with each diagram below.

> **Reading note.** `incidents` is a database **view** over `blotter_records` +
> `incident_records`, joined through `record_registry` (`server.js`, "Option A record
> routing helpers"). Throughout the app, the record identifier is `registry_id`, and
> that is the id used by `cart_risk_factors`, `incident_evidence` and audit rows.

---

## 1. Notation

| Symbol | Meaning |
|---|---|
| Rectangle | External entity — a person, role, or system outside the boundary |
| Circle (Levels 1–2) or rounded rectangle (Level 0) | Process — work the system performs |
| Open-ended cylinder | Data store — tables or files at rest |
| Solid arrow | Data flow |
| Dashed arrow | Out-of-band flow (delivery that happens outside the system) |

---

## 2. Level 0 — Context Diagram

The whole system is a single process. Its external entities are the three
authenticated staff roles, shown separately because each role sends and receives a
different subset of the system's data. The optional SMTP mail service is omitted
from this view for readability; it carries only the password-reset code.

![Level 0 context diagram — Deputy Officer, Team Leader, and Kagawad as separate external entities](diagrams/dfd-level-0-context.png)

**Figure 2.** Level 0 Context Diagram of the Barangay 179 Crime BI and Patrol
Decision Support System.

**Export:** [PNG](diagrams/dfd-level-0-context.png) · [SVG](diagrams/dfd-level-0-context.svg)

**Role flows**

- **Deputy Officer (Administrator)** — *sends:* login credentials; blotter /
  incident details; evidence; patrol schedules and logs; CART weights and
  thresholds; user accounts; settings; archive/restore selections; analysis,
  view, and report requests. *Receives:* session token; record confirmations and
  lists; risk scores and decision paths; dashboards, maps, and reports; patrol
  recommendations; restored records and audit trail; live alerts.
- **Team Leader** — *sends:* login credentials; blotter / incident details;
  evidence; patrol schedules and logs; analysis, view, and report requests.
  *Receives:* session token; record confirmations and lists; risk scores and
  decision paths; dashboards, maps, and reports; patrol recommendations; live
  alerts.
- **Kagawad** — *sends:* login credentials; record and patrol search criteria;
  what-if analysis inputs; analysis, view, and report requests. *Receives:*
  session token; read-only records and patrol data; risk scores and decision
  paths; dashboards, maps, and reports; live alerts.

**Control parameters.** Dashboard filters and map viewport are included under
"analysis / view / report requests". They select which already-authorized data is
displayed and are applied in the browser; they are not separate data stores or
record flows.

**Boundary decisions**

- **No citizen-facing interface.** Residents/complainants transact in person or on
  paper; a staff member transcribes their report. Citizens are therefore *not* an
  external entity on this diagram — adding one would imply a data flow the system
  does not have.
- **Map tiles are not a system flow.** Mapbox is called directly by the browser to
  render basemap tiles; no barangay data leaves the system through it.
- **Email is optional.** If `EMAIL_USER` is not configured, the reset flow still
  records the request but no mail is sent. The SMTP service is omitted from this
  role-specific view to keep the three actors readable; the password-reset code is
  the only flow that would cross to it.
- **Roles are not cosmetic.** Administrator-only actions (users, settings, archive,
  CART weights, audit) belong to the Deputy Officer; Kagawad is read-only for
  records and patrol data; Team Leader can create records, upload evidence, and
  maintain patrol schedules/logs. These restrictions are enforced in `server.js`,
  not just hidden in the UI.

---

## 3. Level 1 — Decomposition

Level 1 splits process 0 into the eight processes the code actually implements.
`E1` covers normal use by any authenticated role; `E2` is the same Deputy Officer
account acting in its **administrator** capacity, shown separately because those
flows (users, settings, archive, audit) are role-restricted. Login is drawn once
against `E1` to avoid duplicating the same flow for every role. The three Level 0
actors are therefore re-aggregated into `E1` here; the only internal split that
matters is normal use versus the Deputy Officer's administrator capacity (`E2`).

```mermaid
flowchart LR
    E1["E1 · Barangay Staff<br/>(Deputy Officer · Kagawad · Team Leader)"]
    E2["E2 · Deputy Officer<br/>(administrator role)"]
    E3["E3 · SMTP Mail Service<br/>(optional)"]

    P1(("1.0<br/>Authenticate &amp;<br/>Manage Sessions"))
    P2(("2.0<br/>Capture &amp;<br/>Maintain Records"))
    P3(("3.0<br/>Store &amp;<br/>Serve Evidence"))
    P4(("4.0<br/>Compute<br/>CART Risk"))
    P5(("5.0<br/>Plan &amp;<br/>Log Patrols"))
    P6(("6.0<br/>Analyse, Map<br/>&amp; Report"))
    P7(("7.0<br/>Administer Users,<br/>Settings &amp; Archive"))
    P8(("8.0<br/>Broadcast<br/>Live Alerts"))

    D1[("D1 · Staff &amp; Session Store")]
    D2[("D2 · Record Store")]
    D3[("D3 · Evidence Store")]
    D4[("D4 · CART Store")]
    D5[("D5 · Patrol Store")]
    D6[("D6 · Configuration Store")]
    D7[("D7 · Audit &amp; Archive Store")]

    %% ── 1.0 Authentication ───────────────────────────────────────
    E1 -->|"credentials"| P1
    P1 -->|"session token · role"| E1
    P1 -->|"reset code"| E3
    P1 <-->|"accounts · sessions"| D1
    P1 -->|"login events"| D7

    %% ── 2.0 Records ──────────────────────────────────────────────
    E1 -->|"record details"| P2
    P2 -->|"confirmation · record list"| E1
    P2 <-->|"records · registry"| D2
    P2 -->|"deleted record snapshot"| D7

    %% ── 3.0 Evidence ─────────────────────────────────────────────
    E1 -->|"evidence files"| P3
    P3 -->|"file token · evidence list"| E1
    P3 <-->|"evidence rows · files"| D3
    D2 -->|"record link"| P3
    P3 -->|"evidence audit · archived file"| D7

    %% ── 4.0 CART ─────────────────────────────────────────────────
    E1 -->|"analysis request"| P4
    P4 -->|"score · danger level"| E1
    P4 <-->|"scores · runs"| D4
    D2 -->|"record inputs"| P4
    P4 -->|"write-back"| D2
    D6 -->|"weights · thresholds"| P4
    P4 -->|"analysis audit"| D7

    %% ── 5.0 Patrol ───────────────────────────────────────────────
    E1 -->|"schedule · log"| P5
    P5 -->|"patrol plan · log list"| E1
    P5 <-->|"schedules · logs"| D5
    D2 -->|"open incidents"| P5
    P5 -->|"patrol audit · deleted schedule / log"| D7

    %% ── 6.0 Analytics & reporting ────────────────────────────────
    E1 -->|"dashboard · report"| P6
    P6 -->|"stats · charts · output"| E1
    D2 -->|"records · levels"| P6
    D4 -->|"risk factors"| P6
    D5 -->|"patrol coverage"| P6
    P6 -->|"export audit"| D7

    %% ── 7.0 Administration ───────────────────────────────────────
    E2 -->|"admin requests"| P7
    P7 -->|"users · settings · archive"| E2
    P7 <-->|"accounts"| D1
    P7 <-->|"settings"| D6
    P7 <-->|"audit · user archive"| D7
    P7 -->|"restore records"| D2
    P7 -->|"restore files"| D3
    P7 -->|"restore patrol data"| D5

    %% ── 8.0 Live alerts ──────────────────────────────────────────
    P2 -->|"record saved"| P8
    D1 -->|"validate session"| P8
    P8 -->|"live alert"| E1

    classDef entity fill:#FCF4E4,stroke:#B7791F,stroke-width:1.5px,color:#3A2A0A;
    classDef process fill:#E8F1FB,stroke:#2B6CB0,stroke-width:1.5px,color:#12283F;
    classDef store fill:#EAF5EA,stroke:#2F7D32,stroke-width:1.5px,color:#17321A;
    class E1,E2,E3 entity;
    class P1,P2,P3,P4,P5,P6,P7,P8 process;
    class D1,D2,D3,D4,D5,D6,D7 store;
```

**Export:** [PNG](diagrams/dfd-level-1-decomposition.png) · [SVG](diagrams/dfd-level-1-decomposition.svg)

**Session checks are omitted from most processes.** Every route except the SSE
stream is wrapped in `authenticate` + `requireRole`, which re-queries `D1` on each
call. Drawing that arrow from all eight processes back to `D1` would obscure the
data movement the diagram is meant to show; process 1.0 owns the flow instead.

---

## 4. Level 2 — Decomposition

Two Level 1 processes carry enough internal branching to justify a Level 2. Child
numbering follows the parent (`2.1`, `2.2`, …). The double-bordered processes are
Level 1 processes outside the decomposition, shown only as interfaces.

### 4.1 Process 2.0 — Capture & Maintain Records

```mermaid
flowchart LR
    E1["E1 · Barangay Staff"]
    P21(("2.1<br/>Validate &amp;<br/>Derive Fields"))
    P22(("2.2<br/>Allocate Public<br/>Record Number"))
    P23(("2.3<br/>Persist Registry<br/>&amp; Base Record"))
    P24(("2.4<br/>Search &amp;<br/>View Records"))
    P25(("2.5<br/>Delete &amp;<br/>Archive Record"))
    P4[["4.0<br/>Compute CART Risk"]]
    P8[["8.0<br/>Broadcast Live Alerts"]]
    D2[("D2 · Record Store")]
    D7[("D7 · Audit &amp; Archive Store")]

    E1 -->|"create form"| P21
    P21 -->|"validated create fields"| P22
    P22 <-->|"type catalog · counter"| D2
    P22 -->|"public number"| P23
    P21 -->|"validated update fields"| P23
    P23 <-->|"registry + base row"| D2
    P23 -->|"saved registry id"| P4
    P23 -->|"record saved"| P8
    P23 -->|"confirmation · number on create"| E1

    E1 -->|"search / filter"| P24
    P24 <-->|"paged records · detail"| D2
    P24 -->|"edit form"| P21

    E1 -->|"delete request (DO only)"| P25
    P25 -->|"snapshot + files"| D7
    P25 -->|"remove row"| D2
    P25 -->|"deleted"| E1

    classDef entity fill:#FCF4E4,stroke:#B7791F,stroke-width:1.5px,color:#3A2A0A;
    classDef process fill:#E8F1FB,stroke:#2B6CB0,stroke-width:1.5px,color:#12283F;
    classDef store fill:#EAF5EA,stroke:#2F7D32,stroke-width:1.5px,color:#17321A;
    classDef other fill:#F4F4F4,stroke:#777,stroke-width:1.2px,stroke-dasharray:4 3,color:#333;
    class E1 entity;
    class P21,P22,P23,P24,P25 process;
    class D2,D7 store;
    class P4,P8 other;
```

**Export:** [PNG](diagrams/dfd-level-2-records.png) · [SVG](diagrams/dfd-level-2-records.svg)

**Notes**

- Every create gets a public number, including drafts; drafts differ only in the
  relaxed respondent-required rule and in being excluded from scoring, dashboards
  and alerts.
- An update keeps the existing public number and record class. Changing a record from
  blotter to incident after creation is rejected, so `2.2` runs only on create.
- `2.3` writes the base table and `record_registry` in one transaction; the returned
  `registry_id` is the id used everywhere else.

### 4.2 Process 4.0 — Compute CART Risk

```mermaid
flowchart LR
    E1["E1 · Barangay Staff"]
    P41(("4.1<br/>Load Record &amp;<br/>Street History"))
    P42(("4.2<br/>Load Active<br/>Configuration"))
    P43(("4.3<br/>Score Five<br/>Risk Factors"))
    P44(("4.4<br/>Combine &amp;<br/>Classify"))
    P45(("4.5<br/>Persist or<br/>Log Result"))
    P46(("4.6<br/>Present<br/>Decision Path"))
    D2[("D2 · Record Store")]
    D4[("D4 · CART Store")]
    D6[("D6 · Configuration Store")]

    E1 -->|"analyse record ·<br/>what-if inputs"| P41
    D2 -->|"record · location count ·<br/>30-day street frequency"| P41
    D6 -->|"weights · thresholds ·<br/>source multipliers"| P42
    P41 -->|"prepared inputs"| P43
    P42 -->|"active configuration"| P43
    P43 -->|"factor scores"| P44
    P44 -->|"weighted total · Level 1/2/3"| P45
    P45 <-->|"risk factors · analysis /<br/>simulation log"| D4
    P45 -->|"danger-level write-back<br/>(record analysis only)"| D2
    P45 -->|"scores · level · path"| P46
    P46 -->|"score breakdown"| E1
    P45 -.->|"what-if result<br/>(no write-back)"| E1

    classDef entity fill:#FCF4E4,stroke:#B7791F,stroke-width:1.5px,color:#3A2A0A;
    classDef process fill:#E8F1FB,stroke:#2B6CB0,stroke-width:1.5px,color:#12283F;
    classDef store fill:#EAF5EA,stroke:#2F7D32,stroke-width:1.5px,color:#17321A;
    class E1 entity;
    class P41,P42,P43,P44,P45,P46 process;
    class D2,D4,D6 store;
```

**Export:** [PNG](diagrams/dfd-level-2-cart.png) · [SVG](diagrams/dfd-level-2-cart.svg)

**Notes**

- `4.3` is not a plain weighted sum: the submitted subjective severity indication (High/Medium/Low) resets the
  **type** weight (30/20/10 %) and re-proportions the other four factors. The
  configured base weights apply to the other four and to non-typed paths.
- `4.4` multiplies the weighted total by the record **source** multiplier
  (`blotter` vs `incident`) before bucketing.
- The auto path (after save/edit) persists; the what-if path (`/api/cart/predict`)
  scores supplied inputs, logs a `simulation` row, and returns without writing
  `cart_risk_factors` or `danger_level`.
- Draft records are refused/cleared in `4.1`, which is why a draft never appears in
  the CART store.

---

## 5. Data dictionary

### 5.1 External entities

| ID | Entity | Description |
|---|---|---|
| E1 | Barangay Staff | Any authenticated role (Deputy Officer, Kagawad, Team Leader) using the system operationally: login, records, evidence, CART, patrols, dashboards and reports. |
| E2 | Deputy Officer | The Deputy Officer acting in the **administrator** role only: user management, settings/CART weights, archive/restore, audit logs and the gated location-coordinate setup. Operational flows for this same person are covered by E1. |
| E3 | SMTP Mail Service | Optional Nodemailer transport used only to deliver password-reset codes. |

### 5.2 Processes

| ID | Process | Responsibility | Main code / routes |
|---|---|---|---|
| 1.0 | Authenticate & Manage Sessions | Verify credentials, issue and expire session tokens, enforce lockout, handle password reset/change/logout. Runs the 5-minute idle-session sweep. | `/api/auth/*`, `authenticate`, `requireRole`, `user_sessions`, `login_attempts` |
| 2.0 | Capture & Maintain Records | Create, read, update and soft-delete blotter/incident records; allocate public record numbers; keep registry and base tables in step; draft handling. | `/api/incidents*`, `/api/record-types`, `record_registry`, `blotter_records`, `incident_records` |
| 3.0 | Store & Serve Evidence | Accept up to 5 image/video files, validate magic bytes, store paths, issue 60-second HMAC file tokens, serve gated `/uploads`. | `/api/incidents/:id/evidence`, `/api/uploads/*`, `incident_evidence` |
| 4.0 | Compute CART Risk | Apply the rule-based weighted model to a record or a set of records; write factor scores and danger level; log the run. | `/api/cart/*`, `cart-engine.js`, `cart_risk_factors`, `cart_analysis_log` |
| 5.0 | Plan & Log Patrols | Manage schedules and completed/partial patrol logs, compute area risk decay, summarise patrol needs from open incidents. | `/api/patrol-schedules`, `/api/patrol-logs`, `/api/patrol/*` |
| 6.0 | Analyse, Map & Report | Dashboard KPIs, charts, heatmaps/street hotspots, and monthly report preparation (CSV/print generated client-side). | `/api/dashboard/*`, `/api/heatmap/*`, `/api/reports/log-export` |
| 7.0 | Administer Users, Settings & Archive | User CRUD/deactivation, system and CART settings, archive browsing/restore, audit-log viewing, location coordinates. | `/api/users*`, `/api/settings*`, `/api/archive*`, `/api/audit-logs` |
| 8.0 | Broadcast Live Alerts | Push `new_incident` / `incident_updated` events to currently connected staff browsers over Server-Sent Events, using single-use 30-second tickets. | `/api/notifications/ticket`, `/api/notifications/stream` |

### 5.3 Data stores

| ID | Store | Physical tables / files |
|---|---|---|
| D1 | Staff & Session Store | `users`, `user_sessions`, `login_attempts`, `login_history`, `password_resets` |
| D2 | Record Store | `record_registry`, `blotter_records`, `incident_records`, `record_type_catalog`, `record_number_counters`; read-only `incidents` view |
| D3 | Evidence Store | `incident_evidence` + `uploads/` (`incident-evidence/`, `incident-photos/`, `archive/`) |
| D4 | CART Store | `cart_risk_factors`, `cart_analysis_log`, `cart_decision_rules` |
| D5 | Patrol Store | `patrol_schedules`, `patrol_logs`, `location_coordinates`, `area_risk_decay` |
| D6 | Configuration Store | `system_settings` (CART weights, source multipliers, thresholds, session timeout) |
| D7 | Audit & Archive Store | `audit_logs`, `archived_records` |

### 5.4 Selected flows

| From → To | Data |
|---|---|
| E1 → 1.0 | Username + password; forgot-password username/email |
| 1.0 → E1 | Bearer session token, role, expiry |
| 2.0 → E1 | Public record number (`BLT-…`/`INC-…`), saved record, paged list, validation errors |
| E1 → 3.0 | Multipart evidence (≤5 images/videos), evidence view request |
| 3.0 → E1 | Evidence metadata and short-lived `?ftoken=` URL for `<img>`/`<video>` |
| 2.0 → 4.0 | Incident type, time, day, street, severity, 30-day street frequency |
| 4.0 → D2 | Computed danger level written back to the base table behind the registry id |
| 4.0 → E1 | Factor scores, total 0–100, Level 1/2/3, decision path |
| D2/D4/D5 → 6.0 | Aggregates for KPIs, charts, heatmap and reports |
| E2 ↔ 7.0 | User CRUD, settings, archive/restore requests and their results |
| 2.0 / 3.0 / 5.0 / 7.0 → D7 | Deleted-record, evidence, patrol and user snapshots (row + files) for later restore |
| 7.0 → D2/D3/D5 | Restored rows and files, original ids preserved |
| 2.0 → 8.0 | Record-saved event payload (create or update) |
| 8.0 → E1 | `text/event-stream` alert; best-effort only — no offline queue |

### 5.5 Level 2 — process 2.0 subprocesses

| ID | Subprocess | Responsibility |
|---|---|---|
| 2.1 | Validate & Derive Fields | Enforce the Joi schema and approved type list; derive `time_of_day`, `day_of_week`, `is_weekend`; compose the structured address and display names. |
| 2.2 | Allocate Public Record Number | Map form type to record class, resolve the type acronym from the catalog, bump the counter atomically, and format `{BLT\|INC}-{CODE}-{NNNN}`. |
| 2.3 | Persist Registry & Base Record | Insert or update the base row and `record_registry` in one transaction; return the `registry_id` used by every downstream table. |
| 2.4 | Search & View Records | Server-side paging, filtering, search and detail lookup over the `incidents` view; drafts are excluded unless requested. |
| 2.5 | Delete & Archive Record | Snapshot the row, its evidence rows and any files into D7, then remove the row. Restricted to the Deputy Officer. |

### 5.6 Level 2 — process 4.0 subprocesses

| ID | Subprocess | Responsibility |
|---|---|---|
| 4.1 | Load Record & Street History | Read the record fields, the street's incident count and its 30-day frequency; skip/clear drafts. What-if mode uses the supplied inputs instead. |
| 4.2 | Load Active Configuration | Load CART weights, danger thresholds and source multipliers from `system_settings`, falling back to documented defaults. |
| 4.3 | Score Five Risk Factors | Score time, day, type (severity-adaptive), location and frequency against the fixed score tables. |
| 4.4 | Combine & Classify | Weighted sum × blotter/incident source multiplier, then bucket into Level 1/2/3 at the configured thresholds. |
| 4.5 | Persist or Log Result | Upsert `cart_risk_factors`, write `danger_level` back to the base record, and log the analysis or simulation run. |
| 4.6 | Present Decision Path | Return factor scores, the 0–100 total, the level and a human-readable rule trace for the dashboard/detail view. |

---

## 6. Assumptions and scope notes

1. **Internal storage is logical, not one-table-per-store.** A store may span several
   physical tables that always change together; the mapping is in §5.3.
2. **Drafts are records too.** They live in D2 with `is_draft = 1`, are excluded from
   CART scoring, dashboards, alerts and list views.
3. **Deletion is never destructive.** `2.0`, `3.0`, `5.0` and `7.0` move the row
   snapshot and any files into D7, which is why D7 receives both audit and archive
   flows.
4. **CART is rule-based, not machine learning.** See `docs/CART_MODEL.md`. The
   "CART" name is retained from the project's terminology.
5. **The SSE alert channel is deliberately lossy.** Clients not connected when a
   record is saved miss that alert; there is no notification inbox table.
6. **Reports are composed client-side.** The backend supplies JSON and records an
   audit entry; CSV/print generation happens in `frontend/report.js`.

## 7. Exported files

| Diagram | Vector | Raster |
|---|---|---|
| Level 0 — context | [SVG](diagrams/dfd-level-0-context.svg) | [PNG](diagrams/dfd-level-0-context.png) |
| Level 1 — decomposition | [SVG](diagrams/dfd-level-1-decomposition.svg) | [PNG](diagrams/dfd-level-1-decomposition.png) |
| Level 2 — process 2.0 | [SVG](diagrams/dfd-level-2-records.svg) | [PNG](diagrams/dfd-level-2-records.png) |
| Level 2 — process 4.0 | [SVG](diagrams/dfd-level-2-cart.svg) | [PNG](diagrams/dfd-level-2-cart.png) |

PNGs are 2400 px wide on a white background; SVGs scale without loss in Word or
LaTeX. Re-export after editing a block by pasting it into the Mermaid Live Editor.
