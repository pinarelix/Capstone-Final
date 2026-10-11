# Modular Database Connector & Standalone Build Plan

> **Goal:** Turn the Capstone-Final project into a self-contained `.exe` that
> ships with an in-app Setup Wizard — no terminal, no manual `.env` editing.
> The wizard lets the user pick a database server, test the connection, and
> persist settings, all from inside the Electron window.

---

## Table of Contents

1. [Current State & Gaps](#1-current-state--gaps)
2. [Architecture Overview](#2-architecture-overview)
3. [Module 1 — Config Manager (backend)](#3-module-1--config-manager-backend)
4. [Module 2 — Setup Wizard (frontend)](#4-module-2--setup-wizard-frontend)
5. [Module 3 — Connector Registry (future multi-DB)](#5-module-3--connector-registry-future-multi-db)
6. [Module 4 — Electron Bootstrap Changes](#6-module-4--electron-bootstrap-changes)
7. [Module 5 — Build & Packaging](#7-module-5--build--packaging)
8. [File Tree (new/changed files)](#8-file-tree-newchanged-files)
9. [Implementation Order](#9-implementation-order)
10. [Risk & Mitigation](#10-risk--mitigation)

---

## 1. Current State & Gaps

| What exists | What's missing |
|---|---|
| `mysql2/promise` pool in `server.js` (lines 215-228) reads `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` from `.env` | `DB_PORT` is declared in `.env.example` but **never passed** to `createPool()` — the pool always hits port 3306 |
| `main.js` has a minimal first-run check (`ensureConfigExists`, lines 40-58): writes a template `.env` in `%APPDATA%` and shows a native dialog telling the user to edit it manually, then quits | No in-app UI for entering or testing DB credentials |
| `electron-builder` config in `package.json` can produce an NSIS `.exe` installer | Build has not been tested recently; `backend/node_modules` is not bundled by default (relies on `extraResources`) |
| Backend is loaded **in-process** via `require('./backend/server')` — not a child process | If the DB connection fails, the whole app crashes with a console error the user never sees |

### Bug to fix first

`DB_PORT` is ignored. The pool config must include `port`:

```js
const pool = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 3306,   // ← add this
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'brgydata',
    ...
});
```

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                 Electron main.js                 │
│  ┌────────────┐   ┌──────────────────────────┐   │
│  │ Config Mgr │◄──│ Setup Wizard (HTML page)  │   │
│  │ read/write │   │ rendered in BrowserWindow │   │
│  │ config.json│   └──────────────────────────┘   │
│  └─────┬──────┘                                  │
│        │ provides DB creds at boot               │
│  ┌─────▼──────────────────────────────────────┐  │
│  │          backend/server.js                  │  │
│  │  ┌──────────────┐  ┌────────────────────┐  │  │
│  │  │ Connector    │  │ Express routes     │  │  │
│  │  │ Registry     │  │ (existing API)     │  │  │
│  │  │ • mysql      │  └────────────────────┘  │  │
│  │  │ • (postgres) │                          │  │
│  │  │ • (sqlite)   │                          │  │
│  │  └──────────────┘                          │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**Key idea:** separate *reading/writing config* from *creating the DB pool*.
Today both are tangled inside `server.js`. After this plan they live in
dedicated modules that `server.js` and `main.js` both consume.

---

## 3. Module 1 — Config Manager (backend)

> **New file:** `backend/config-manager.js`

### Responsibilities

| Concern | Detail |
|---|---|
| **Storage location** | `%APPDATA%/Barangay 179 Crime BI/config.json` (packaged) or `backend/.env` (dev). JSON preferred for the packaged build because it's easier to read/write programmatically than dotenv. |
| **Read** | `loadConfig()` → returns a plain object `{ db: { host, port, user, password, name }, server: { port }, email: { user, appPassword } }` |
| **Write** | `saveConfig(partialObj)` → deep-merges into the existing file and writes atomically (write to `.tmp`, then rename) |
| **Defaults** | Hard-coded fallback values so the app can at least *start* the wizard even with no config file |
| **Validation** | `validateDbConfig(cfg)` → returns `{ valid: boolean, errors: string[] }` |

### API sketch

```js
// backend/config-manager.js
const CONFIG_DEFAULTS = {
  db: { host: 'localhost', port: 3306, user: 'root', password: '', name: 'brgydata' },
  server: { port: 3000 },
  email: { user: '', appPassword: '' },
};

function getConfigPath()   { /* %APPDATA% when packaged, else backend/.env */ }
function loadConfig()      { /* read JSON, merge with defaults */ }
function saveConfig(patch) { /* deep-merge + atomic write */ }
function validateDbConfig(cfg) { /* check required fields, port range, etc. */ }

module.exports = { loadConfig, saveConfig, validateDbConfig, getConfigPath };
```

### Migration from `.env`

- On first boot, if a legacy `backend/.env` exists but no `config.json`,
  auto-convert and write `config.json`.
- After migration, rename `.env` → `.env.migrated` so it's not used again.

---

## 4. Module 2 — Setup Wizard (frontend)

> **New files:** `frontend/setup.html`, `frontend/setup.js`, `frontend/setup.css`

### When it appears

The wizard is a **mandatory gate** — no one reaches the login screen until a
live database connection is established.

| Trigger | Behaviour |
|---|---|
| **Every cold start** | Electron loads `setup.html` first. The wizard pre-fills the last saved config (if any) and auto-runs a connection test. If the test passes instantly, the user clicks one button ("Connect & Continue") to proceed to `login.html`. If it fails, they stay in the wizard to fix it. |
| **First run** — no `config.json` exists | Same wizard, but fields start at defaults and no auto-test runs. The user must fill in credentials, test, and save before they can continue. |
| **Connection failure mid-session** — the DB goes down while the app is running | The backend detects the broken pool and emits an IPC event. Electron navigates back to `setup.html` with an error banner: "Lost connection to the database." |
| **Manual re-entry** — admin clicks ⚙ **Connection Settings** in the sidebar | Opens `setup.html` in the same window so the admin can point the app at a different server without restarting. |

#### Why gate every launch?

Barangay staff are not developers. Showing a login form that silently fails
because the DB is down teaches them nothing. The wizard costs one extra click
when everything is healthy ("Connect & Continue") but prevents every
"I can't log in and I don't know why" support call.

### Wizard Layout (single-page, two states)

#### State A — Returning user (config exists, auto-test runs on load)

```
┌──────────────────────────────────────────────────┐
│          🔌 Database Connection                  │
│                                                  │
│  Host  [localhost     ]   Port  [3306      ]     │
│  User  [root          ]   Pass  [••••••    ]     │
│  Database [brgydata   ]                          │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  ● Testing connection…                   │    │
│  │  ✅ Connected — MySQL 8.0.36             │    │
│  │     12 tables · schema up to date        │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│              [ Connect & Continue → ]            │
└──────────────────────────────────────────────────┘
```

If the auto-test passes, the user clicks one button and reaches the login screen.

#### State B — First run or failed connection

```
┌──────────────────────────────────────────────────┐
│          🔌 Database Connection                  │
│                                                  │
│  Host  [localhost     ]   Port  [3306      ]     │
│  User  [root          ]   Pass  [           ]    │
│  Database [brgydata   ]                          │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  ❌ Connection failed                    │    │
│  │     ECONNREFUSED — is MySQL running?     │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│   [ Test Connection ]    [ Save & Launch → ]     │
│                          (disabled until pass)   │
└──────────────────────────────────────────────────┘
```

"Save & Launch" stays disabled until "Test Connection" succeeds.

### Backend API endpoints (added to `server.js` or a new `backend/routes/setup.js`)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/setup/config` | Return current config (passwords masked) |
| `POST` | `/api/setup/test` | Accept `{ host, port, user, password, name }`, attempt a one-off `mysql.createConnection()`, return success/failure + server version |
| `POST` | `/api/setup/save` | Validate → write `config.json` → respond OK |
| `POST` | `/api/setup/restart` | Tell Electron to reload the backend with new config (via IPC or process signal) |

### Security notes

- These endpoints must be **localhost-only** (they already are — Express binds to 127.0.0.1).
- The `/api/setup/*` routes run in two modes:
  - **Pre-login (wizard is the gate):** routes are open — the backend isn't even
    connected to a DB yet, there's nothing to protect.
  - **Post-login (admin clicks Connection Settings):** routes require
    `authenticateToken` + `authorizeRoles('admin')` middleware. Regular users
    never see the Connection Settings link.
- The wizard page itself has no skip button. The only way past it is a successful
  connection test.

---

## 5. Module 3 — Connector Registry (future multi-DB)

> **New file:** `backend/connectors/index.js`  
> **Per-driver files:** `backend/connectors/mysql.js`, (later) `postgres.js`, `sqlite.js`

This module is the forward-looking piece. Today the app only needs MySQL, but
wrapping the pool behind a uniform interface lets you swap or add engines later
without touching route code.

### Interface each connector must export

```js
// backend/connectors/mysql.js
module.exports = {
  name: 'mysql',
  label: 'MySQL / MariaDB',
  defaultPort: 3306,

  /** Create and return a pool-like object with .query() and .getConnection() */
  async createPool(cfg) { /* uses mysql2/promise */ },

  /** Quick connectivity check — resolve true or throw */
  async testConnection(cfg) { /* one-off createConnection, then destroy */ },

  /** Return server version string */
  async getServerInfo(pool) { /* SELECT VERSION() */ },
};
```

### Registry (`backend/connectors/index.js`)

```js
const connectors = {
  mysql: require('./mysql'),
  // postgres: require('./postgres'),  // future
  // sqlite:   require('./sqlite'),    // future — good for offline/demo mode
};

function getConnector(type) { return connectors[type]; }
function listConnectors()   { return Object.values(connectors).map(c => ({ name: c.name, label: c.label, defaultPort: c.defaultPort })); }

module.exports = { getConnector, listConnectors };
```

### How `server.js` uses it

```js
const { loadConfig }    = require('./config-manager');
const { getConnector }  = require('./connectors');

const cfg       = loadConfig();
const connector = getConnector(cfg.db.type || 'mysql');
const pool      = await connector.createPool(cfg.db);

// All existing route code keeps calling pool.query() — no change.
```

### Why SQLite matters (optional but valuable)

A bundled SQLite connector would let the `.exe` run in **demo / offline mode**
with zero external dependencies — no MySQL install required. Useful for:
- Thesis defense demos on a laptop with no MySQL
- Distributing a preview to panelists

---

## 6. Module 4 — Electron Bootstrap Changes

> **Changed file:** `main.js`

### New boot sequence

The wizard is always the first screen. The login page is never loaded until
a live DB connection is confirmed.

```
app.whenReady()
  │
  ├─ loadConfig()
  │    ├─ config.json exists & valid?
  │    │     └─ load setup.html (pre-filled, auto-test fires)
  │    │          ├─ auto-test PASS ──► show "Connect & Continue" button
  │    │          └─ auto-test FAIL ──► show error, user edits & retests
  │    │
  │    └─ no config.json / invalid
  │         └─ load setup.html (defaults, no auto-test)
  │              └─ user fills fields → Test Connection → Save
  │
  └─ "Connect & Continue" / "Save & Launch" clicked
       └─ IPC message → main.js startBackend(config)
            └─ create pool → verify → load login.html ✅
```

#### Mid-session reconnect

```
backend detects pool error (ECONNREFUSED / PROTOCOL_CONNECTION_LOST / ER_ACCESS_DENIED)
  │
  └─ emits IPC 'db:connection-lost'
       └─ main.js navigates BrowserWindow → setup.html (error mode)
            └─ user fixes config → "Reconnect" → backend restarts pool
                 └─ success → load login.html
```

### IPC channels to add

| Channel | Direction | Payload |
|---|---|---|
| `config:load` | renderer → main | *(none)* — returns saved config (passwords masked) |
| `config:save` | renderer → main | `{ db, server, email }` |
| `config:test` | renderer → main | `{ host, port, user, password, name }` |
| `config:test-result` | main → renderer | `{ ok, version?, tables?, error? }` |
| `app:start-backend` | renderer → main | *(none)* — called after wizard passes |
| `db:connection-lost` | main → renderer | `{ error }` — triggers redirect to setup.html |

### Removing the old `ensureConfigExists()` dialog

The native `dialog.showMessageBoxSync()` at lines 40-58 is replaced entirely by
the HTML wizard. Delete the function and its call.

---

## 7. Module 5 — Build & Packaging

### Getting `npm run build` to produce a working `.exe`

| Task | Detail |
|---|---|
| **Bundle backend deps** | The current `extraResources` block copies `backend/node_modules` into the installer. Verify it includes native modules (`mysql2` has no native addon, so this should be fine). Run `npx electron-builder --win --x64` and test the output. |
| **Exclude dev-only files** | Already handled by the `files` array in `package.json`. Add `!backend/connectors/*.test.js` if connector tests are written. |
| **Code-sign (optional)** | Without a code-signing certificate, Windows SmartScreen will warn "Unknown publisher." For a thesis project this is acceptable — add a note in the README. |
| **Auto-update (optional)** | `electron-updater` can poll a GitHub release for new versions. Low priority for a capstone, but trivial to add later. |
| **Installer customisation** | The NSIS config already sets name, icon, and install-dir picker. Add a "Launch after install" checkbox: `"runAfterFinish": true` in the `nsis` block. |

### Build command

```bash
# From project root
npm run build          # runs: electron-builder --win --x64
# Output: dist/Barangay179-CrimeBI-Setup-1.0.0.exe
```

---

## 8. File Tree (new/changed files)

```
Capstone-Final/
│
├── main.js                          # CHANGED — new boot sequence, IPC, remove old dialog
│
├── backend/
│   ├── config-manager.js            # NEW — read/write/validate config.json
│   ├── connectors/
│   │   ├── index.js                 # NEW — connector registry
│   │   └── mysql.js                 # NEW — MySQL pool wrapper
│   ├── routes/
│   │   └── setup.js                 # NEW — /api/setup/* endpoints
│   └── server.js                    # CHANGED — use config-manager + connector registry,
│                                    #           add DB_PORT to pool, mount setup routes
│
├── frontend/
│   ├── setup.html                   # NEW — Setup Wizard page
│   ├── setup.js                     # NEW — wizard logic, IPC calls
│   └── setup.css                    # NEW — wizard styling
│
└── docs/
    └── modular-connector-plan.md    # THIS FILE
```

---

## 9. Implementation Order

Each phase is independently deployable — the app works after every step.

| Phase | Scope | Effort |
|---|---|---|
| **Phase 0** | Fix `DB_PORT` bug in `server.js` pool config | 5 min |
| **Phase 1** | Create `config-manager.js` — read/write/validate `config.json`, auto-migrate legacy `.env`, keep `.env` fallback for dev mode | ~2 hrs |
| **Phase 2** | Build `setup.html` wizard (single-page, two states) + `/api/setup/*` routes | ~3 hrs |
| **Phase 3** | Wire the wizard as a **mandatory boot gate** in `main.js` — every launch shows setup.html first, auto-tests saved config, blocks login until connected. Remove old `ensureConfigExists()` dialog. Add mid-session `db:connection-lost` handler that redirects back to the wizard. | ~3 hrs |
| **Phase 4** | Add admin-only ⚙ **Connection Settings** link in the sidebar so an admin can re-enter the wizard without restarting the app | ~1 hr |
| **Phase 5** | Extract the MySQL pool into `connectors/mysql.js` + connector registry | ~2 hrs |
| **Phase 6** | Test `npm run build` end-to-end, fix packaging issues, verify the `.exe` installer launches into the wizard | ~2 hrs |
| **Phase 7** *(optional)* | Add SQLite connector for offline demo mode | ~3 hrs |

**Total estimated effort:** ~13 hrs (phases 0–6), ~16 hrs with SQLite.

---

## 10. Risk & Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| `electron-builder` fails on native modules | Build produces a broken `.exe` | `mysql2` is pure JS — no native addon. Test build early (Phase 4). |
| User enters wrong DB creds, app seems "broken" | Frustration | The wizard's **Test Connection** button gives instant feedback before saving. On failure at boot, the app re-opens the wizard instead of crashing. |
| Config file permissions on shared machines | Another Windows user could read the DB password in `%APPDATA%` | Acceptable for a LAN-only barangay system. Document it. For production, encrypt the password at rest with `dpapi` (Windows Data Protection API). |
| Adding a second DB engine (Postgres/SQLite) breaks existing queries | SQL dialect differences | The connector registry only swaps the *pool* — the SQL stays MySQL-flavoured. A future Postgres connector would need query translation or an ORM. Flag this as out-of-scope for the capstone. |
| Backend restart after config change drops in-flight requests | Data loss on save | The wizard triggers a restart only after confirmation. The backend serves only localhost, so there's at most one user during setup. |

---

*End of plan.*
