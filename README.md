# 🏛️ Barangay 179 Crime Intelligence and Patrol Decision Support System

[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-31.x-9feaf9.svg)](https://www.electronjs.org/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-blue.svg)](https://mysql.com/)
[![Express](https://img.shields.io/badge/Express-4.x-lightgrey.svg)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📋 Overview

The **Barangay 179 Crime Intelligence and Patrol Decision Support System** is a standalone desktop application designed to help barangay officials manage, analyze, and respond to crime incidents in Barangay 179, Amparo, Caloocan City.

It runs as a native Windows desktop app (built with Electron) backed by a local MySQL database — no browser or separate servers required. The system integrates **Business Intelligence (BI)**, **Geospatial Mapping**, and **Predictive Analytics** using a **CART (Classification and Regression Tree) Engine** to provide data-driven patrol recommendations and risk assessments.

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
- Rule-based decision tree engine
- Risk classification (Level 1, 2, 3)
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

### 📄 Reports Module
- Printable incident summaries
- CSV export functionality
- Monthly report generation

### 👥 User Management
- Role-based access control (Admin, Decision-Maker)
- Secure authentication with session management
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
| Joi | 17.x | Data validation |
| bcryptjs | 2.x | Password hashing |
| dotenv | 16.x | Environment variables |

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| HTML5 | - | Structure |
| CSS3 | - | Styling |
| JavaScript (ES6) | - | Interactivity |
| Leaflet.js | 1.9.x | Interactive maps |
| Chart.js | 4.x | Data visualization |

### Key Libraries
- **CART Engine** - Custom decision tree algorithm
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
│   ├── cart-engine.js       # CART decision tree logic
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
│   ├── apiHelper.js          # Shared API/session/role helper functions
│   └── ...                   # Page-specific JS, CSS, images
│
├── brgydata.session.sql     # Database dump for (re)seeding the `brgydata` schema
└── .claude/skills/          # Dev tooling (Playwright driver for automated UI checks)
```

The app is a **single-server architecture**: `backend/server.js` runs the Express API *and* serves the frontend directly via `express.static`, all on `http://localhost:3000`. There's no separate frontend dev server — `main.js` just opens an Electron window pointed at that same URL.

---

## 🖥️ Getting Started

### Prerequisites
- **Node.js** 18.x or later
- **MySQL** 8.0, running locally, with the `brgydata` database created and seeded (see `brgydata.session.sql`)

### Installation

```powershell
# Install desktop shell dependencies (Electron, electron-builder)
npm install

# Install backend dependencies
cd backend
npm install
cd ..
```

Create `backend/.env` with your local database credentials:

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

**Demo accounts** (seeded via `brgydata.session.sql`):
- Admin — `admin` / `admin123`
- Barangay Captain (Decision-Maker) — `captain` / `captain123`

### Building a distributable installer

```powershell
npm run build
```

Produces a Windows installer via `electron-builder`, output to `dist/`.

---

## 🔐 Security Notes

- `backend/.env` holds real database credentials and is **git-ignored** — never commit it.
- Passwords are hashed with `bcryptjs`; sessions use server-issued tokens with expiry.
- Role-based UI restrictions (Admin vs. Decision-Maker) are enforced both in the frontend nav and on the backend API routes.
