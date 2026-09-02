---
name: run-capstone-final
description: Build, run, and drive the Barangay 179 Crime BI web app (Express+MySQL backend, static HTML/JS frontend). Use when asked to start/run the app, launch the backend or frontend, log in, screenshot a page (login, dashboard, CART Analytics, etc.), or click through the UI to verify a change.
---

This is a two-process local web app: an Express API (`BACKEND/server.js`,
port 3000) backed by MySQL, and a static HTML/CSS/JS frontend
(`Capstone Final/*.html` — a folder literally named `Capstone Final`
nested inside the repo root) served on port 5500. The frontend calls
the API via `fetch` (see `Capstone Final/apiHelper.js`), so both must
be running. Drive it with the Playwright REPL driver at
`.claude/skills/run-capstone-final/driver.mjs` (chromium-cli is not
available in this environment, so this driver was hand-built to give
the same nav/click/fill/screenshot vocabulary).

All paths below are relative to the repo root (the folder containing
`BACKEND/` and the nested `Capstone Final/`).

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

  `BACKEND/.env` has the connection details (`DB_HOST`, `DB_USER`,
  `DB_PASSWORD`, `DB_NAME=brgydata`, `PORT=3000`). The database already
  has seeded data (11 incidents, 3 users as of this writing) — there is
  a `brgydata.session.sql` at the repo root if it ever needs
  reimporting, but it wasn't needed here.

## Setup

Dependencies are already installed in this repo (`BACKEND/node_modules`
and this skill's own `node_modules` for Playwright). If starting from
a clean checkout:

```powershell
cd BACKEND; npm install; cd ..
cd ".claude/skills/run-capstone-final"; npm install; npx playwright install chromium; cd ../../..
```

No separate build step — the frontend is plain HTML/CSS/JS, no bundler.

## Run (agent path)

**1. Start the backend** (port 3000). It calls `process.exit(1)` at
boot if it can't reach MySQL, so make sure the DB is up first (see
Prerequisites).

```powershell
cd BACKEND
node server.js
```

If this immediately errors with `EADDRINUSE :::3000`, the backend is
already running (common during active dev, e.g. under `nodemon`) —
just skip this step and move on.

**2. Serve the frontend on port 5500** — the exact port, since the
backend's CORS allowlist (`BACKEND/server.js`, `allowedOrigins`) only
accepts `http://localhost:5500` / `http://127.0.0.1:5500`. Any other
port makes every `fetch` call fail with a CORS error.

```powershell
node ".claude/skills/run-capstone-final/static-server.mjs" "Capstone Final" 5500
```

**3. Drive it** with the Playwright REPL driver. Pipe a script to
stdin, one command per line:

```powershell
cd ".claude/skills/run-capstone-final"
@'
nav http://localhost:5500/login.html
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

**Stop the frontend static server:**

```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 5500 -State Listen | Select-Object -First 1 -ExpandProperty OwningProcess) -Force
```

## Run (human path)

Backend: `cd BACKEND; npm run dev` (nodemon) or `npm start`. Frontend:
open `Capstone Final/login.html` via the VS Code "Live Server"
extension (which is why CORS is pinned to port 5500) — not by
double-clicking the file, since `file://` origins can't call the API.

## Gotchas

- **Protected pages redirect to `login.html` if not logged in, silently.**
  `dashboard.html`, `cart.html`, etc. read a session token from
  `sessionStorage` on load and bounce to the login page if it's
  missing — there's no error, `wait-for` just times out looking for
  dashboard text because you're actually still looking at the login
  screen. Since `driver.mjs` starts a new browser context every
  invocation, you must log in at the top of *every* script that needs
  an authenticated page.
- **CORS is hard-pinned to port 5500.** Serving the frontend on any
  other port (e.g. Node's common default 3000/8080) makes every
  `apiHelper.js` fetch call fail silently with a CORS error in the
  console, while the page itself still loads fine — check
  `console --errors` if a page looks static/empty of data.
- **The backend may already be running.** It's common to have it up
  already (dev workflow); `EADDRINUSE` on `node server.js` means it's
  fine, not broken — proceed to the frontend/driver steps.
- **Don't guess-brute-force the login form.** There's a failed-attempt
  lockout (`login_attempts` table, HTTP 429 after repeated failures).
  Use the seeded demo accounts above via the role-button autofill.

## Troubleshooting

- **`Error: listen EADDRINUSE: address already in use :::3000`** on
  `node server.js`: the backend is already running elsewhere. Skip
  starting it and go straight to serving the frontend / driving it.
- **`Database connection failed` then the process exits** on backend
  startup: MySQL80 service isn't running, or `brgydata` doesn't exist
  yet. `Start-Service MySQL80` and confirm `BACKEND/.env` credentials.
- **`locator.waitFor: Timeout ... getByText('...')` right after
  `nav`-ing straight to a page like `dashboard.html`**: you weren't
  logged in in that browser context — see the first Gotcha. Log in
  first in the same script.
