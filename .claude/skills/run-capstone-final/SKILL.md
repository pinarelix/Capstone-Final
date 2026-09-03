---
name: run-capstone-final
description: Build, run, and drive the Barangay 179 Crime BI app (Express+MySQL backend, now also serving the frontend as static files — same codebase also ships as an Electron desktop app). Use when asked to start/run the app, launch the backend, log in, screenshot a page (login, dashboard, CART Analytics, etc.), or click through the UI to verify a change.
---

This is now a single-process local web app: an Express API
(`backend/server.js`, port 3000) backed by MySQL, which also serves the
static HTML/CSS/JS frontend (`frontend/*.html`) directly via
`express.static`. The frontend calls the API via `fetch` (see
`frontend/apiHelper.js`), same-origin, so there's no CORS to worry
about. Drive it with the Playwright REPL driver at
`.claude/skills/run-capstone-final/driver.mjs` (chromium-cli is not
available in this environment, so this driver was hand-built to give
the same nav/click/fill/screenshot vocabulary).

The same codebase also ships as an Electron desktop app (`main.js` at
the repo root, `npm start` from the repo root) — see "Run (human
path)" below. `driver.mjs` uses Playwright's plain `chromium.launch()`,
which can drive all page content/logic (identical either way, since
Electron's `BrowserWindow` is just a thin Chromium wrapper around the
same URL) but cannot exercise the Electron shell itself (window
chrome, native dialogs, absent menu bar) — that needs a human running
`npm start`.

All paths below are relative to the repo root (the folder containing
`backend/`, `frontend/`, and `main.js`).

## Prerequisites

- Node.js (tested with v24.19.0). No OS packages needed — Playwright's
  bundled Chromium runs without xvfb on Windows.
- **MySQL must already be running with the `brgydata` database
  populated.** On this machine that's the `MySQL80` Windows service.
  Check/start it:

```powershell
Get-Service MySQL80          # Status should be Running
Start-Service MySQL80        # if it isn't
```

  `backend/.env` has the connection details (`DB_HOST`, `DB_USER`,
  `DB_PASSWORD`, `DB_NAME=brgydata`, `PORT=3000`). The database already
  has seeded data (11 incidents, 3 users as of this writing) — there is
  a `database/schema.sql` at the repo root if the schema (plus the two
  demo accounts) ever needs reimporting, but it wasn't needed here.

## Setup

Dependencies are already installed in this repo (`backend/node_modules`
and this skill's own `node_modules` for Playwright). If starting from
a clean checkout:

```powershell
cd backend; npm install; cd ..
cd ".claude/skills/run-capstone-final"; npm install; npx playwright install chromium; cd ../../..
```

No separate build step — the frontend is plain HTML/CSS/JS, no bundler.

## Run (agent path — fast iteration)

**1. Start the backend** (port 3000). It now fails gracefully (logs an
error, doesn't crash the whole process) if it can't reach MySQL, so
make sure the DB is up first (see Prerequisites).

```powershell
cd backend
node server.js
```

If this immediately errors with `EADDRINUSE :::3000`, the backend is
already running (common during active dev) — just skip this step and
move on. The backend now also serves the frontend directly, so there
is nothing separate to start for the UI.

**2. Drive it** with the Playwright REPL driver, straight against port
3000. Pipe a script to stdin, one command per line:

```powershell
cd ".claude/skills/run-capstone-final"
@'
nav http://localhost:3000/login.html
click [data-role="admin"]
click text=Login to System
wait-for text=Business Intelligence Dashboard
screenshot 01-dashboard
click text=CART Analytics
wait-for text=Danger Level
click text=Run CART Analysis
sleep 1500
screenshot 02-cart-result
console --errors
quit
'@ | node driver.mjs
```

Screenshots land in `.claude/skills/run-capstone-final/screenshots/`.

| command | what it does |
|---|---|
| `nav <url>` | navigate |
| `wait-for text=Foo` or `wait-for <css-selector>` | wait until visible |
| `click text=Foo` or `click <css-selector>` | click |
| `fill <selector> <value...>` | fill an input |
| `press <key>` | keyboard key (e.g. `Enter`) |
| `screenshot [name]` | full-page PNG to `screenshots/` |
| `eval <js>` | run JS in the page, prints the result |
| `console` / `console --errors` | dump captured console/page-error messages |
| `sleep <ms>` | pause |
| `quit` | close the browser and exit |

Each `node driver.mjs` invocation is a **fresh browser context** — no
sessionStorage carries over between runs. Log in as part of the same
script before hitting a protected page (see Gotchas).

**Demo accounts** (seeded in the DB, and auto-filled by the login
page's role buttons):
- Admin: click `[data-role="admin"]`, or type `admin` / `admin123`.
- Captain: click `[data-role="captain"]`, or type `captain` / `captain123`.

## Run (human path — real desktop app)

From the repo root:

```powershell
npm start
```

This launches the actual Electron desktop shell (`main.js`): it starts
the same Express server in-process, then opens a native window loading
`http://localhost:3000/login.html`. If MySQL isn't running, a native
error dialog appears instead of a silent crash — start MySQL and
relaunch. There's no separate frontend server to start.

To build a distributable Windows installer (not needed for routine
dev/testing): `npm run build` (electron-builder; output goes to
`dist/`).

## Gotchas

- **Protected pages redirect to `login.html` if not logged in, silently.**
  `dashboard.html`, `cart.html`, etc. read a session token from
  `sessionStorage` on load and bounce to the login page if it's
  missing — there's no error, `wait-for` just times out looking for
  dashboard text because you're actually still looking at the login
  screen. Since `driver.mjs` starts a new browser context every
  invocation, you must log in at the top of *every* script that needs
  an authenticated page.
- **The backend may already be running.** It's common to have it up
  already (dev workflow); `EADDRINUSE` on `node server.js` means it's
  fine, not broken — proceed straight to driving it.
- **Don't guess-brute-force the login form.** There's a failed-attempt
  lockout (`login_attempts` table, HTTP 429 after repeated failures).
  Use the seeded demo accounts above via the role-button autofill.

## Troubleshooting

- **`Error: listen EADDRINUSE: address already in use :::3000`** on
  `node server.js`: the backend is already running elsewhere. Skip
  starting it and go straight to driving it.
- **`Database connection failed`** on backend startup: MySQL80 service
  isn't running, or `brgydata` doesn't exist yet. `Start-Service
  MySQL80` and confirm `backend/.env` credentials.
- **`locator.waitFor: Timeout ... getByText('...')` right after
  `nav`-ing straight to a page like `dashboard.html`**: you weren't
  logged in in that browser context — see the first Gotcha. Log in
  first in the same script.
