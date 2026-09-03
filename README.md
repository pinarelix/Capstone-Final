# 🏛️ Barangay 179 Crime Intelligence and Patrol Decision Support System

[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-31.x-9feaf9.svg)](https://www.electronjs.org/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-blue.svg)](https://mysql.com/)
[![Express](https://img.shields.io/badge/Express-4.x-lightgrey.svg)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📋 Overview

The **Barangay 179 Crime Intelligence and Patrol Decision Support System** is a standalone desktop application designed to help barangay officials manage, analyze, and respond to crime incidents in Barangay 179, Amparo, Caloocan City.

It runs as a native Windows desktop app (built with Electron) backed by a local MySQL database — no browser or separate servers required. The system integrates **Business Intelligence (BI)**, **Geospatial Mapping**, and a **transparent, weighted risk-scoring engine** (referred to throughout the system as the "CART Engine" — see the [naming note](#-about-the-cart-engine-naming) below) to provide data-driven patrol recommendations and risk assessments.

---

## 🚀 Key Features

### 📊 BI Dashboard
- Real-time incident statistics and KPIs
- Interactive charts (incident types, danger levels, trends)
- Recent incident table with status tracking

### 📁 Incident Management
- Full CRUD operations for incident records
- Map-based location picker with barangay boundary
- Auto-computation of time of day and day of week
- CART risk factor generation per incident

### 🗺️ Barangay Risk Map (Heatmap)
- Grid-based quadrat analysis
- Visual representation of incident density
- Click to view incident details per location

### 📈 CART Predictive Analytics
- Transparent, weighted rule-based scoring engine (not a trained decision tree — see
  [`docs/CART_MODEL.md`](docs/CART_MODEL.md))
- Risk classification (Level 1, 2, 3), thresholds configurable from Settings
- Weighted scoring based on:
  - Incident Type (30%)
  - Time of Day (25%)
  - Location History (20%)
  - Day Type (15%)
  - Frequency (10%)

### 🛡️ Patrol Decision Support
- CART-based patrol recommendations
- Priority area identification
- Suggested tanod deployment
- Patrol scheduling and logging
- Separate Tanod-facing login and dashboard (`tanod-login.html` / `tanod-dashboard.html`) —
  field tanods view their own assigned schedules and file incident reports from a
  simplified interface, independent of the Admin/Decision-Maker desktop views

### 📄 Reports Module
- Printable incident summaries
- CSV export functionality
- Monthly report generation

### 👥 User Management
- Role-based access control — three roles: **Administrator** (full CRUD access),
  **Decision-Maker** (barangay captain; read-focused oversight views), and **Tanod**
  (field patrol staff; separate PIN-based login, own dashboard, no access to the
  admin desktop views)
- Secure authentication with session management (separate session systems for
  Admin/Decision-Maker vs. Tanod)
- Password reset functionality

### ⚙️ System Settings
- Configurable thresholds and weights
- Audit trail logging
- System health monitoring

---

## 🛠️ Technology Stack

### Desktop Shell
| Technology | Version | Purpose |
|------------|---------|---------|
| Electron | 31.x | Native desktop app shell (Chromium + Node.js) |
| electron-builder | 24.x | Packaging into a Windows installer |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18.x | Runtime environment |
| Express.js | 4.x | Web framework (also serves the frontend as static files) |
| MySQL | 8.0 | Database |
| mysql2 | 3.x | MySQL driver (promise-based) |
| Joi | 18.x | Data validation |
| bcryptjs | 3.x | Password hashing |
| dotenv | 16.x | Environment variables |
| node-cache | 5.x | In-memory caching for the risk-map heatmap query |
| papaparse | 5.x | CSV parsing/export for the Reports module |
| Jest / Supertest | 30.x / 7.x | Automated backend test suite (dev dependency) |

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| HTML5 | - | Structure |
| CSS3 | - | Styling |
| JavaScript (ES6) | - | Interactivity |
| Leaflet.js | 1.9.x | Interactive maps |
| Chart.js | 4.x | Data visualization |

### Key Libraries
- **CART Engine** - Custom weighted rule-based risk scoring module (`backend/cart-engine.js`)
- **Leaflet** - Map rendering and heatmap
- **Chart.js** - Dashboard charts

---

## 📂 Project Structure

```
Capstone Final/
├── main.js                  # Electron main process — starts the backend, opens the app window
├── package.json             # Electron app manifest, build config, root scripts
│
├── backend/                 # Express API + database layer
│   ├── server.js            # API routes, also serves frontend/ as static files
│   ├── cart-engine.js       # Risk scoring engine logic (see naming note below)
│   ├── locationList.js      # Canonical street/area list, shared with frontend/locationList.js
│   ├── tests/                # Jest + Supertest automated test suite
│   ├── package.json         # Backend dependencies (own node_modules)
│   └── .env                 # DB credentials (local only, not committed)
│
├── frontend/                 # Static HTML/CSS/JS UI
│   ├── login.html
│   ├── dashboard.html
│   ├── incident.html         # Incident Records (admin)
│   ├── incident-view.html    # Incident View (read-only)
│   ├── grid-heatmap.html     # Barangay Risk Map
│   ├── cart.html             # CART Analytics
│   ├── patrol.html           # Patrol Decision Support
│   ├── report.html           # Reports Module
│   ├── users.html            # User Management
│   ├── settings.html
│   ├── tanod-login.html      # Tanod field-staff login (separate from admin login)
│   ├── tanod-dashboard.html  # Tanod field-staff dashboard
│   ├── apiHelper.js          # Shared API/session/role helper functions
│   ├── locationList.js       # Canonical street/area list (see backend/locationList.js)
│   └── ...                   # Page-specific JS, CSS, images
│
├── database/
│   └── schema.sql            # Structure + demo-account seed for (re)creating the `brgydata` schema
│
├── docs/
│   └── CART_MODEL.md         # Full explanation of the risk-scoring engine's weights/thresholds
│
└── .claude/skills/          # Dev tooling (Playwright driver for automated UI checks)
```

The app is a **single-server architecture**: `backend/server.js` runs the Express API *and* serves the frontend directly via `express.static`, all on `http://localhost:3000`. There's no separate frontend dev server — `main.js` just opens an Electron window pointed at that same URL.

---

## 🖥️ Getting Started

### Prerequisites
- **Node.js** 18.x or later
- **MySQL** 8.0, running locally

### Installation

```powershell
# Install desktop shell dependencies (Electron, electron-builder)
npm install

# Install backend dependencies
cd backend
npm install
cd ..
```

Create the `brgydata` database and load the schema (creates all tables plus the two demo
accounts below):

```powershell
mysql -u root -p -e "CREATE DATABASE brgydata"
mysql -u root -p brgydata < database/schema.sql
```

Copy `backend/.env.example` to `backend/.env` and fill in your local database credentials:

```powershell
cp backend/.env.example backend/.env
```

```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=brgydata
PORT=3000
```

### Running the app

```powershell
npm start
```

This launches the desktop app: it starts the Express/MySQL backend in-process, then opens a native window loading the login screen. If MySQL isn't running, you'll get a clear error dialog instead of a silent crash — start MySQL and relaunch.

**Demo accounts** (seeded by `database/schema.sql`):
- Admin — `admin` / `admin123`
- Barangay Captain (Decision-Maker) — `captain` / `captain123`

No demo Tanod account is seeded — create one from the Admin desktop's User Management
page (Tanods use a username + 4-digit PIN, not a password).

### Running tests

The backend has a Jest + Supertest suite that runs against a throwaway `brgydata_test`
database (created and dropped automatically — it never touches real data):

```powershell
cd backend
npm test
```

### Building a distributable installer

```powershell
npm run build
```

Produces a Windows installer via `electron-builder`, output to `dist/`.

---

## 📈 About the "CART Engine" naming

The risk-scoring module is called the "CART Engine" throughout the UI, database tables
(`cart_risk_factors`, `cart_analysis_log`), and API routes (`/api/cart/*`) — but it is
**not** a trained Classification and Regression Tree. It's a transparent, weighted
rule-based scoring model: five factors are each scored from a fixed lookup table, combined
by fixed percentage weights into a 0–100 total, then bucketed into a danger level by
configurable thresholds. There's no training step and no accuracy metric, because a
rule-based model doesn't have either — every score traces back to a documented weight and
table entry instead. See [`docs/CART_MODEL.md`](docs/CART_MODEL.md) for the full weight
table, thresholds, and the reasoning behind choosing a rule-based model over a trained one
at this stage of deployment.

---

## 🔐 Security Notes

- `backend/.env` holds real database credentials and is **git-ignored** — never commit it.
- Passwords are hashed with `bcryptjs`; sessions use server-issued tokens with expiry.
- Role-based UI restrictions (Administrator vs. Decision-Maker vs. Tanod) are enforced both in the frontend nav and on the backend API routes.

---

## 🗺️ Future Work

Known gaps and deferred improvements — see [`docs/FUTURE_WORK.md`](docs/FUTURE_WORK.md)
for the full list with context on why each one isn't done yet (CART weight-editing UI,
a `street_id` foreign key, the pending Express 5 security upgrade, code signing for the
installer, and more).
