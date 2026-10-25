# DFD Review — submitted Level 1 drawing

Review of the Level 1 data flow diagram supplied as three screenshots (processes
`1.0`–`7.0`, data stores `T1`–`T8`, external entities User, Team Leader, Executive
Officer and Kagawad), plus the corrected rebuild in this folder.

| | |
|---|---|
| Reviewed input | 3 screenshots of the submitted Gane–Sarson-style drawing |
| Corrected output | [`diagrams/dfd-level-1-reviewed.svg`](diagrams/dfd-level-1-reviewed.svg) · [`diagrams/dfd-level-1-reviewed.png`](diagrams/dfd-level-1-reviewed.png) |
| Generator | [`diagrams/build-dfd-level1.cjs`](diagrams/build-dfd-level1.cjs) (edit + `node`, then re-render) |
| Source of truth for behaviour | `backend/server.js`, `backend/cart-engine.js`, `backend/archive.js`, `database/schema.sql` |
| Related | [`DFD.md`](DFD.md) — the code-derived Level 0/1/2 set already used elsewhere in this repo |

---

## 1. Verdict

The decomposition is a reasonable first cut and the process names match the app's
modules. As a *data flow diagram*, though, the drawing is not yet complete:

- **none of the eight data stores is connected to anything** — they float on the
  left as a list;
- **CART risk is never computed** — `T3 Cart Risk Factor` has no writing process, yet
  two processes consume it;
- several flows carry **duplicate or missing labels**, so the same arrow can mean
  two different things;
- at least one **actor/process pairing is wrong** (User Management is drawn against
  the Team Leader, but it is administrator-only);
- the right-hand connectors run off the canvas, so some destinations cannot be seen.

The corrected diagram fixes the first four and redraws the layout so every flow is
visible and labelled. Items 5–7 below are modelling choices you may still want to
decide before submitting.

---

## 2. Findings

Severity: **C** = makes the diagram incorrect, **H** = ambiguous, **M** = style /
completeness, **L** = polish.

### C1 — Data stores are decorative (all of `T1`–`T8`)
Every store is drawn, but no process reads or writes any of them. A DFD store that
has no flow is not part of the model; a marker would mark the diagram wrong on
"stores must be connected" alone.

*Fix:* every store now has at least one read and one write where the schema
supports it (T7 Sessions is read/written only by 1.0; the rest are in the matrix in
§5). Audit writes are drawn individually; see §5 for the rows not drawn.

### C2 — `T3 Cart Risk Factor` has no producer
`4.0 Geospatial Heatmap` and `5.0 Dashboard & Analytics` both read the risk factor,
but no process computes it. In the code, `computeCartRiskFactors()` runs on every
record save via `cart-engine.js`, and `danger_level` is written back to the record.

*Fix:* inserted **`4.0 CART Risk Scoring`** (loads the record and street history,
applies weights/thresholds from `T6`, writes `T3`, writes the danger level back to
`T2`, logs the run). Old `4.0`–`7.0` shift down by one (§4). This is the only
process that could not be fixed by re-wiring.

### C3 — Duplicate flow names
The drawing repeats `Authentication Status` three times, `Login Credentials` twice,
`Interactive Heatmap Data` twice and `Aggregated Statistical Analytics` twice, with
no indication of which entity or store each belongs to. Two-way exchanges are also
drawn as one unbounded pair, so the direction of each label is unclear.

*Fix:* each exchange is now a labelled pair at the process end
(`incident forms & evidence` in / `saved record + number` out), and the four
authentication pairs share one annotation instead of eight near-identical labels.
Different actors still legitimately exchange the same data type; the labels now sit
where the reader needs them.

### C4 — Many unlabelled arrows
Most connectors on the right (entity ↔ process) and all store connectors have no
label at all, and some enter a process without a visible source.

*Fix:* every connector is labelled at the end that owns the data: reads at the
process, writes at the store, entity exchanges at the process. Only the
authentication bundle is described by a single annotation.

### H1 — Wrong actor for User Management
`2.0 User Management` is drawn bidirectionally with **Team Leader**, but user CRUD,
role changes and deactivation are `requireRole(['Deputy Officer'])` in `server.js`.
A Team Leader cannot manage accounts.

*Fix:* `2.0` pairs with **Executive Officer** only.

### H2 — The entity "User" overlaps the three roles
"User" is drawn as a peer of Team Leader / Executive Officer / Kagawad, but in the
schema there is no such role: every session is one of the three. As drawn, the same
person appears twice and the reader cannot tell what "User" is allowed to do.

*Fix (partial):* `E1` is kept — the drawing clearly wants a front-desk actor — and
defined as "the front-desk User account, any authenticated staff session". The
cleaner long-term fix is to delete `E1` and attach record-entry flows to
`E2`/`E3`; that is a modelling decision, not a drawing error, so it is left visible
(see §6).

### M1 — Missing CART write-back, archive and session flows
The drawing has no arrow for `danger_level` returning to the record, no deletion →
`T8 Archive` flow, and no session/audit persistence. All three exist in the code.

*Fix:* `4.0 → T3` is drawn plus the `3.0 → 4.0` trigger; the others are listed in
the matrix and covered by the reading notes, because drawing every archive write
would add four more long lines without changing the story.

### M2 — "Report & Audit trails, System Settings and Archive Management" is four processes in a trench coat
`7.0` in the original bundles report export, audit viewing, settings/CART weights,
and archive/restore. That is four independent responsibilities with different
actors (reports are readable by all roles; settings and audit are Deputy
Officer-only).

*Kept* in the rebuild as `8.0` so the numbering still matches your chapter, but if
you have room for one more process, split settings+archive (admin) from
reports+audit (read/export). The data dictionary in `DFD.md §5.2` already treats
them separately (`6.0` and `7.0`).

### M3 — Store names do not match the schema
`T1 User` stores accounts **and** `login_attempts`/`password_resets`;
`T4 Patrol Schedules` also holds patrol **logs** and area decay; `T3 Cart Risk
Factor` is one row per record per run, not a single value. Renamed in the rebuild
only where it helps (`T1 User` stays, but its flows are labelled with the actual
content).

### L1 — Direction and layout
The same label (`Incident Records`) appears on flows both into and out of `3.0`.
Not wrong per se, but combined with the missing verb it reads as a loop. The
corrected drawing uses distinct labels for the inbound form/evidence and the
outbound record/list, and routes every line orthogonally so no connector leaves the
canvas.

---

## 3. What changed, visually

| Submitted | Corrected |
|---|---|
| 7 processes, `1.0`–`7.0` | 8 processes, `1.0`–`8.0` (CART added) |
| Stores listed, unconnected | Every store wired; full matrix in §5 |
| Entity boxes on the left and right | Four entities in one right-hand column |
| Lines routed off-canvas | All routing inside a 2700 × 2160 frame, orthogonal, rounded corners |
| Duplicate/wandering labels | One label per flow, at the destination; authentication annotated once |
| No legend / no reading notes | Legend + four reading notes in the drawing |

---

## 4. Renumbering map

| Submitted | Corrected | Why |
|---|---|---|
| `1.0 Authentication & Session` | `1.0` | unchanged |
| `2.0 User Management` | `2.0` | unchanged |
| `3.0 Incident Record Management` | `3.0` | unchanged |
| — | **`4.0 CART Risk Scoring`** | new; `T3` otherwise has no writer |
| `4.0 Geospatial Heatmap` | `5.0` | shifted |
| `5.0 Dashboard & Analytics` | `6.0` | shifted |
| `6.0 Patrol Management` | `7.0` | shifted |
| `7.0 Reports, Audit trails, Settings, Archive` | `8.0` | shifted |

Data stores keep their submitted IDs: `T1` User, `T2` Incident Records, `T3` Cart
Risk Factor, `T4` Patrol Schedules, `T5` Audit Logs, `T6` Settings, `T7` Sessions,
`T8` Archive.

---

## 5. Store access matrix (R = read, W = write)

| Process | T1 User | T2 Incident | T3 CART | T4 Patrol | T5 Audit | T6 Settings | T7 Sessions | T8 Archive |
|---|---|---|---|---|---|---|---|---|
| 1.0 Authentication & Session | R | | | | W | | R/W | |
| 2.0 User Management | R/W | | | | W | | | |
| 3.0 Incident Record Management | | R/W | | | W | | | W¹ |
| 4.0 CART Risk Scoring | | R/W² | R/W | | | R | | |
| 5.0 Geospatial Heatmap | | R | R | | | R³ | | |
| 6.0 Dashboard & Analytics | | R | R | R | | R | | |
| 7.0 Patrol Management | | R | | R/W | W | | | W¹ |
| 8.0 Reports, Audit, Settings, Archive | R⁴ | R | R | R | R/W | R/W | | R/W |

¹ Deleting a record or a schedule snapshots the row and its files into `T8`.
² `4.0` also writes the computed `danger_level` back to the record.
³ Heatmap/dashboard display thresholds; not drawn separately from the `T6↔8.0` pair.
⁴ Restoring a user archive; ordinary reports do not read credentials.

Flows deliberately **not** drawn, to keep the drawing readable (all are in the
matrix above): `4.0 → T2` danger-level write-back, `3.0/7.0 → T8` deletion
snapshots, `1.0 → T1` lockout counters, and per-process session re-checks
(every route calls `authenticate`/`requireRole` against `T7`).

---

## 6. Open modelling decisions

1. **Does "User" deserve to be an entity?** The schema has exactly three roles.
   Keeping `E1` implies a fourth actor. Two clean options:
   - drop `E1` and let `E2` (Team Leader) own record entry — matches the database;
   - keep `E1` and rename it "Barangay Staff (any role)" — matches the UI's shared
     screens, but then `E2`–`E4` become privileged variants of the same actor.
   The rebuild keeps `E1` because that is what the submitted drawing shows.
2. **Executive Officer vs Deputy Officer.** The code's administrator role is
   `Deputy Officer`. The drawing's "Executive Officer" is presumably the same
   person; if the panel compares diagram with schema, add a note or rename.
3. **Split `8.0`?** See M2. Reports/audit are readable; settings/archive are
   admin-only. One process for both is acceptable at Level 1 but hides the
   permission boundary.
4. **Heatmap vs Dashboard.** `5.0` and `6.0` both read `T2`/`T3`/`T6` and differ
   only in presentation. Keeping them separate is fine; merging them into one
   "Analytics" process is also defensible and would remove eight connectors.

---

## 7. Reproducing the output

```powershell
node docs/diagrams/build-dfd-level1.cjs

$env:SVG_FILE = "$PWD\docs\diagrams\dfd-level-1-reviewed.svg"
$env:PNG_FILE = "$PWD\docs\diagrams\dfd-level-1-reviewed.png"
$env:W = "2700"; $env:H = "2160"
npx electron docs/diagrams/render-svg.cjs
```

The SVG is the editable artefact; the PNG is rendered at 1:1 (2700 × 2160) on a
white background for Word/LaTeX. Both live next to this file in `docs/diagrams/`.

### Drawing conventions used

- Rounded rectangle with a number compartment = process; the number is the Level 1
  process ID.
- Square-cornered rectangle = external entity.
- Rectangle with a left ID compartment = data store (`T1`–`T8`).
- Solid arrow = data flow; arrowhead points at the receiver.
- Label position = at the receiver's end (process for reads and entity exchanges,
  store for writes), so a label never floats in the middle of a long trunk.
