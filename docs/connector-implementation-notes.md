# Modular Database Connector — Implementation Notes

> **Date:** 2026-10-10  
> **Branch:** `Zech-Branch`  
> **Commits:** `318c3be` → `928dc22` → `3b02402`  
> **Status:** Phases 0–6 complete, Phase 7 (SQLite offline mode) optional  

Use this file as context when continuing in a new chat.

---

## What was built

An in-app Setup Wizard that replaces manual `.env` editing. The app now
boots into the wizard on every launch — users must confirm a live database
connection before reaching the login screen. Admins can re-enter the wizard
from the sidebar at any time.

The backend was refactored to separate config management, database connection,
and setup API into their own modules. A connector registry makes it possible
to add Postgres or SQLite drivers later without touching route code.

The project builds into a working `.exe` installer via `npm run build`.

---

## New & changed files

### New files (6)

| File | Purpose |
|---|---|
| `backend/config-manager.js` | Read/write/validate `config.json`. Migrates legacy `.env`. Pushes values into `process.env`. |
| `backend/connectors/mysql.js` | MySQL connector — `createPool()`, `testConnection()`, `getServerInfo()` wrapping `mysql2/promise`. |
| `backend/connectors/index.js` | Connector registry — `getConnector(type)`, `listConnectors()`. Only MySQL registered; ready for Postgres/SQLite. |
| `backend/routes/setup.js` | Express router: `GET /api/setup/config`, `POST /api/setup/test`, `POST /api/setup/save`. Has `setupGuard` middleware (open pre-login, admin-only post-login). |
| `frontend/setup.html` | Setup Wizard page — dark-themed card matching login.html style. |
| `frontend/setup.css` | Wizard styles — background overlay, dark inputs, orange accents, success/error status areas. |
| `frontend/setup.js` | Wizard logic — auto-test on load, masked password handling (`__USE_SAVED__` sentinel), field validation, save & redirect. |

### Changed files (12)

| File | What changed |
|---|---|
| `main.js` | Boots into `setup.html` instead of `login.html`. Loads config via `config-manager.js`. Falls back to minimal Express if server.js fails. Removed old `ensureConfigExists()` native dialog and `CONFIG_TEMPLATE`. |
| `backend/server.js` | Added `port` to `mysql.createPool()` (Phase 0 bug fix). `startServer()` no longer crashes on DB failure — logs a warning, starts Express anyway. Mounts `routes/setup.js` at `/api/setup`. |
| `package.json` | Added `forceCodeSigning: false` and `runAfterFinish: true` to build config. |
| `frontend/settings.html` | Added 🔌 Connection nav-item to sidebar (admin-only). |
| `frontend/dashboard.html` | Same sidebar link added. |
| `frontend/incident.html` | Same sidebar link added. |
| `frontend/incident-view.html` | Same sidebar link added. |
| `frontend/grid-heatmap.html` | Same sidebar link added. |
| `frontend/cart.html` | Same sidebar link added. |
| `frontend/patrol.html` | Same sidebar link added. |
| `frontend/report.html` | Same sidebar link added. |
| `frontend/users.html` | Same sidebar link added. |

---

## Architecture

```
app.whenReady()
  │
  ├─ config-manager: setDataDir() → migrateIfNeeded() → loadConfig() → applyToProcessEnv()
  │
  ├─ require('./backend/server') → startServer()
  │     ├─ testConnection() — wrapped in try/catch, warns on failure instead of crashing
  │     ├─ mounts /api/setup routes
  │     └─ app.listen(PORT)
  │
  ├─ (fallback) if server.js fails entirely → spin up minimal Express for wizard only
  │
  └─ createWindow() → loads setup.html (ALWAYS)
       │
       ├─ setup.js fetches GET /api/setup/config → pre-fills fields
       ├─ auto-runs POST /api/setup/test → shows pass/fail
       ├─ user clicks "Connect & Continue" or "Save & Launch"
       │     └─ POST /api/setup/save → redirect to login.html
       │
       └─ admin can return here from sidebar → Connection link
```

### Config storage

| Mode | Location | Format |
|---|---|---|
| Dev (`npm start`) | `backend/.env` | dotenv (read-only, not migrated) |
| Packaged (`.exe`) | `%APPDATA%/Barangay 179 Crime BI/config.json` | JSON |
| First packaged boot with legacy `.env` | Auto-migrates `.env` → `config.json`, renames `.env` to `.env.migrated` | — |

### Password masking flow

1. `GET /api/setup/config` returns password as `'••••••'` (or `''` if empty)
2. `setup.js` puts `'••••••'` in the field, marks it `data-masked="true"`
3. If user doesn't change the password, `getFields()` sends `'__USE_SAVED__'`
4. `POST /api/setup/test` and `/save` detect `'__USE_SAVED__'` and read the real password from `config.json`
5. If user types a new password, `data-masked` is removed, the real new password is sent

### Setup route security (`setupGuard`)

| Request state | Result |
|---|---|
| No Bearer token (pre-login) | Allowed — wizard must work before any DB/user exists |
| Invalid/expired token | Allowed — treated as pre-login |
| Valid admin session | Allowed |
| Valid non-admin session | 403 Forbidden |
| DB unreachable (can't check token) | Allowed — treated as pre-login |

---

## Build instructions

### Dev mode

```bash
npm start          # runs: electron .
# App opens setup wizard → test connection → login
```

### Production `.exe`

```powershell
# Required on Windows without Developer Mode (symlink issue in winCodeSign cache)
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

npm run build      # runs: electron-builder --win --x64
# Output: dist/Barangay179-CrimeBI-Setup-1.0.0.exe (88 MB)
```

The `.exe` is an NSIS installer. It:
- Lets the user choose the install directory
- Creates desktop + Start Menu shortcuts
- Launches the app after install (`runAfterFinish: true`)
- Does NOT code-sign (no certificate — Windows SmartScreen will warn "Unknown publisher")
- Bundles `backend/node_modules` as `extraResources`

---

## Known issues & things to watch

| Issue | Detail |
|---|---|
| **`DB_PORT` in `.env.example` is 3307** | The example file has `DB_PORT=3307` (non-standard). This was set for a dev machine that uses 3307. New users will need to change it to 3306 or whatever their MySQL uses. The wizard handles this since it defaults to 3306. |
| **No mid-session reconnect yet** | The plan includes a `db:connection-lost` IPC event that redirects to the wizard if the DB drops mid-session. This is NOT yet implemented — it was scoped as part of Phase 3 but deferred. If the DB goes down while the app is running, API calls will fail with 500 errors. The user would need to restart the app. |
| **`asar: false` warning** | electron-builder warns that asar is disabled. It was disabled because the app does `require()` and file reads from within the packaged `backend/` folder. Enabling asar would break those reads unless `asarUnpack` is configured for the right paths. Low priority. |
| **Audit trail for config changes** | The setup wizard does NOT log config saves to the audit trail. Could be added later — on `POST /api/setup/save`, write an audit entry if a user session exists. |
| **Server restart after config save** | When an admin changes the DB connection from inside the app (via the sidebar link), the wizard saves the config and redirects to `login.html`. The running Express server still has the old pool. The new `process.env` values are set by `applyToProcessEnv()`, but the `mysql.createPool()` in `server.js` was already called with the old values at boot. A full app restart is needed for pool changes to take effect. This could be improved by adding a pool-recreation function. |

---

## Phase 7 — SQLite offline mode (optional, not started)

Would add `backend/connectors/sqlite.js` using `better-sqlite3`. The wizard's
dropdown would let users pick "MySQL" or "SQLite (offline demo)". SQLite would
store data in `%APPDATA%/Barangay 179 Crime BI/demo.db`. Useful for:
- Thesis defense on a laptop without MySQL
- Distributing a preview to panelists

Estimated effort: ~3 hours. Main challenge: the app's SQL is MySQL-flavoured
(ENUM columns, `information_schema` queries, `NOW()`, `DATE_FORMAT()`). The
SQLite connector would need to either translate those or use a compatibility
layer.

---

## Plan document

The full architectural plan is at `docs/modular-connector-plan.md`. It has
the original design decisions, module interfaces, wizard mockups, and risk
matrix. The implementation followed it closely — the only difference is that
Phase 3 (boot gate) and Phase 4 (sidebar link) were combined into one commit
with Phases 2 and 5.

---

## Git log (this work)

```
3b02402 Phase 6: Build config — skip code signing, launch after install
928dc22 Phase 2-5: Setup wizard, boot gate, sidebar link, connector registry
318c3be Phase 0-1: Fix DB_PORT bug, add config-manager module
9582488 Add modular database connector & setup wizard plan
```

All on branch `Zech-Branch`, pushed to `origin`.
