# 🏛️ Barangay 179 Crime Intelligence and Patrol Decision Support System

[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-blue.svg)](https://mysql.com/)
[![Express](https://img.shields.io/badge/Express-4.x-lightgrey.svg)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📋 Overview

The **Barangay 179 Crime Intelligence and Patrol Decision Support System** is a comprehensive web-based application designed to help barangay officials manage, analyze, and respond to crime incidents in Barangay 179, Amparo, Caloocan City.

The system integrates **Business Intelligence (BI)**, **Geospatial Mapping**, and **Predictive Analytics** using a **CART (Classification and Regression Tree) Engine** to provide data-driven patrol recommendations and risk assessments.

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

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18.x | Runtime environment |
| Express.js | 4.x | Web framework |
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
