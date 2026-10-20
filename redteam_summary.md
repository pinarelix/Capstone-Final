# Red Team Security Assessment Summary

## Barangay 179 Crime Heatmap Decision Support System

**Assessment Date:** 2026-10-20
**Assessor:** Static Code Review (Non-destructive)
**Scope:** Full application — backend, frontend, database, Electron shell
**Method:** Code review, grep analysis, configuration audit (no live exploitation)

---

## 1. System Map

### Technology Stack
| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Electron (desktop) + Node.js | — |
| Backend | Express.js | 4.22.2 |
| Database | MySQL 2 (mysql2/promise) | 3.24.2 |
| Auth | Custom session-token (crypto.randomBytes) | — |
| Password Hashing | bcryptjs | 3.0.3 (salt=10) |
| Input Validation | Joi | 18.2.5 |
| File Uploads | multer | 2.4.0 |
| Frontend | Static HTML/CSS/JS (no framework) | — |
| Maps | Mapbox GL JS + Leaflet | 2.15.0 / 1.9.4 |
| Charts | Chart.js | 4.4.1 |
| CART Engine | Custom classification/regression tree | v1.0 |

### Architecture Overview
```
┌─────────────────────────────────────────────────────┐
│                 Electron Shell (main.js)             │
│  contextIsolation: true │ nodeIntegration: false     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐       ┌──────────────────────┐    │
│  │  Frontend     │ HTTP  │  Express Backend     │    │
│  │  (Static JS)  │──────>│  server.js (5108 ln) │    │
│  │  sessionStorage│      │  80+ API routes      │    │
│  │  Bearer token │      │  Joi validation       │    │
│  └──────────────┘       │  authenticate MW      │    │
│                         │  requireRole MW       │    │
│                         │  Rate limiter         │    │
│                         └──────┬───────────────┘    │
│                                │                     │
│                         ┌──────▼───────────────┐    │
│                         │  MySQL (brgydata)     │    │
│                         │  15+ tables           │    │
│                         │  Parameterized queries│    │
│                         └──────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### Authentication Paths
1. **Staff Login** → POST /api/auth/login → user_sessions → Bearer token
2. **Tanod Login** → POST /api/tanod/login → tanod_sessions → Bearer token
3. **File Access** → HMAC-signed ftoken (60s TTL) for /uploads/*

### Role Hierarchy
- **Deputy Officer** (admin): Full CRUD + settings + users + audit logs
- **Team Leader**: CRUD on incidents/schedules, no settings/users
- **Kagawad** (captain): Read-only access to incidents/schedules/CART
- **Tanod**: Self-service only (own dashboard/schedule/incident reporting)

---

## 2. Test Results Summary

| Metric | Count |
|--------|-------|
| **Total Test Cases** | 56 |
| **Pass** | 35 |
| **Fail** | 21 |
| **Criteria Covered** | 21 / 21 |

### By Severity (Failures Only)

| Severity | Count | Test IDs |
|----------|-------|----------|
| **Critical** | 4 | 1.5, 1.6, 14.1, 14.2 |
| **High** | 4 | 13.1, 15.3, 19.1, 20.2 |
| **Medium** | 9 | 2.2, 2.3, 4.3, 9.3, 10.3, 12.1, 15.4, 18.1, 20.1 |
| **Low** | 4 | 10.4, 10.5, 16.3, 18.2, 19.2, 21.2, 21.4, 21.6 |

### By Decision

| Decision | Count | Description |
|----------|-------|-------------|
| **Retain** | 35 | Existing controls are adequate |
| **Remove** | 10 | Existing insecure practices to eliminate |
| **Add** | 11 | Missing controls to implement |

---

## 3. Top Findings

### CRITICAL (Immediate Action Required)

**F1. Hardcoded Demo Credentials in Frontend (1.5, 1.6)**
- login.js auto-fills admin/admin123, captain/captain123, deskofficer/deskofficer123 on role click
- schema.sql ships demo accounts with these weak passwords
- **Impact:** Any user inspecting page source obtains valid admin credentials
- **Fix:** Remove auto-fill logic; remove demo inserts from schema; enforce strong password policy

**F2. Database Root User (14.1)**
- Application connects as MySQL `root` user (server.js line 218, .env DB_USER=root)
- **Impact:** Application compromise grants full DB control (DROP, GRANT, FILE privileges)
- **Fix:** Create dedicated least-privilege MySQL user with SELECT/INSERT/UPDATE/DELETE only

**F3. Database Credentials in .env (14.2)**
- backend/.env contains DB_PASSWORD=[REDACTED] in plaintext
- File is in .gitignore but appears as modified in git status (may have been committed historically)
- mysql.js has fallback default of empty password
- **Impact:** Credential exposure via file system access, git history, or backup theft
- **Fix:** Rotate password; scrub git history; use OS keychain or encrypted vault

### HIGH

**F4. No TLS/HTTPS (13.1)**
- HTTP only on localhost:3000. Acceptable for localhost Electron desktop deployment only
- **Risk increases to Critical** if system is ever deployed on a LAN or network

**F5. Password Reset Token Insecurity (15.3)**
- 6-digit numeric token (1M combinations) logged to server console
- Email delivery not configured (EMAIL_USER empty)
- Brute-forceable within rate limit window

**F6. External CDN Dependencies Break Offline Operation (19.1)**
- 30+ external CDN references across HTML files (Google Fonts, Font Awesome, Chart.js, Mapbox, Bootstrap, Leaflet, Turf.js)
- **Impact:** App non-functional without internet — unacceptable for law enforcement field tool

**F7. Unencrypted Database Backups (20.2)**
- Plain SQL dumps containing all PII written to disk without encryption
- Manual-only backup (no schedule)

---

## 4. Retain List (Controls Working Correctly)

| # | Control | Notes |
|---|---------|-------|
| 1 | bcrypt password hashing (salt=10) | Meets OWASP minimum |
| 2 | CSPRNG session tokens (256-bit) | crypto.randomBytes(32) |
| 3 | Joi input validation on all mutations | stripUnknown: true |
| 4 | 100% parameterized SQL queries | No string concatenation in SQL |
| 5 | Server-side RBAC (requireRole middleware) | All 80+ routes checked |
| 6 | Tanod self-service scope enforcement | requireOwnTanodId middleware |
| 7 | Login lockout (5 fails / 15 min) | Both staff and tanod |
| 8 | Rate limiting on auth endpoints | 8 req / 5 min per IP:path |
| 9 | Configurable idle session timeout | Default 30 min |
| 10 | Session invalidation on logout | DB-backed is_active flag |
| 11 | All sessions revoked on password reset | Proper forced re-auth |
| 12 | HMAC-signed file tokens (60s TTL) | Prevents unauthorized file access |
| 13 | X-Content-Type-Options: nosniff | Prevents MIME sniffing |
| 14 | Server-generated upload filenames | Prevents path traversal |
| 15 | Upload size limits (10MB) | DoS prevention |
| 16 | Sensitive fields excluded from API responses | No password_hash leakage |
| 17 | Custom error handlers (no stack traces) | 404 + global error handler |
| 18 | Comprehensive audit logging | All CRUD + auth events |
| 19 | Audit log captures who/what/when/where | IP, user-agent, old/new data |
| 20 | Electron contextIsolation + no nodeIntegration | Proper sandbox |
| 21 | Single instance lock | Prevents duplicate servers |
| 22 | Soft-delete with archive | Reversible destructive actions |
| 23 | No cookies used (Bearer token auth) | Natural CSRF resistance |
| 24 | Ephemeral HMAC file token secret | Regenerated on restart |

---

## 5. Remove List (Insecure Practices to Eliminate)

| # | Item | Test ID | Priority |
|---|------|---------|----------|
| 1 | Hardcoded demo credentials in login.js | 1.5 | P0 |
| 2 | Demo account inserts in schema.sql | 1.6 | P0 |
| 3 | Root database user | 14.1 | P0 |
| 4 | Plaintext credentials in .env (rotate + scrub history) | 14.2 | P0 |
| 5 | Remember Me checkbox | 2.2 | P1 |
| 6 | localStorage backup of user data | 4.3 | P1 |
| 7 | Username enumeration in forgot-password | 15.4 | P1 |
| 8 | Reset token logged to console | 15.3 | P1 |
| 9 | External placeholder fallback URLs | 19.2 | P2 |
| 10 | Frontend console.log of user details | 21.4 | P2 |

---

## 6. Add List (Missing Controls to Implement)

| # | Control | Test ID | Priority |
|---|---------|---------|----------|
| 1 | Least-privilege MySQL user | 14.1 | P0 |
| 2 | Password complexity enforcement (server-side) | 2.3 | P1 |
| 3 | Content-Security-Policy header | 10.3 | P1 |
| 4 | Magic byte file upload verification | 9.3, 12.1 | P1 |
| 5 | Local bundling of all CDN dependencies | 19.1 | P1 |
| 6 | Encrypted database backups | 20.2 | P1 |
| 7 | Automated backup scheduling | 20.1 | P1 |
| 8 | Restore procedure and script | 20.3 | P1 |
| 9 | X-Frame-Options + Referrer-Policy headers | 10.4, 10.5 | P2 |
| 10 | Structured logging (replace console.log) | 16.3, 21.2 | P2 |
| 11 | Audit log integrity (hash chain / external forwarding) | 18.1 | P2 |
| 12 | Audit log retention enforcement | 18.2 | P2 |
| 13 | HTTPS/TLS + HSTS (for any network deployment) | 13.1, 13.2 | P2 |
| 14 | npm audit / dependency vulnerability scanning | 21.6 | P2 |

---

## 7. Untested Items / Limitations

| Item | Reason |
|------|--------|
| Live brute-force testing | Non-destructive assessment; rate limiter and lockout verified via code review only |
| Network traffic interception | Localhost-only Electron app; no network traffic to intercept |
| npm audit results | Requires npm install which was not performed to avoid modifying the project |
| MySQL privilege verification | No live database connection; verified configuration in code only |
| Cross-browser XSS testing | Electron uses Chromium; no cross-browser testing needed |
| Real file upload exploitation | Non-destructive assessment; MIME bypass verified via code review |
| Session timeout live verification | Would require running server with database; verified via code analysis |
| Concurrent session limits | Not configurable; no limit on parallel sessions per user (potential add) |
| API fuzzing | Out of scope for static code review assessment |

---

## 8. Remediation Roadmap

### Phase 1: Critical (Week 1) — P0 Items
- [ ] **Remove hardcoded credentials** from login.js (lines 36-45)
- [ ] **Remove demo account inserts** from schema.sql (lines 681-684)
- [ ] **Create least-privilege MySQL user** (only SELECT/INSERT/UPDATE/DELETE on brgydata)
- [ ] **Rotate database password** and update .env
- [ ] **Scrub .env from git history** using git filter-repo
- [ ] **Change all demo passwords** to strong unique values

### Phase 2: High (Weeks 2-3) — P1 Items
- [ ] **Bundle CDN dependencies locally** (Font Awesome, Chart.js, Bootstrap, Leaflet, Turf.js, Mapbox GL, Google Fonts)
- [ ] **Implement proper email delivery** for password reset tokens
- [ ] **Increase reset token entropy** (replace 6-digit with crypto.randomBytes)
- [ ] **Remove console.log of reset token** from server.js
- [ ] **Add Content-Security-Policy header** with appropriate directives
- [ ] **Add password complexity enforcement** in Joi schemas
- [ ] **Add magic byte verification** for file uploads (file-type library)
- [ ] **Encrypt database backups** (GPG or AES-256)
- [ ] **Schedule automated backups** (node-cron or OS scheduler)
- [ ] **Create and test restore procedure**
- [ ] **Remove Remember Me checkbox** from login.html
- [ ] **Remove localStorage user data backup** from login.js
- [ ] **Fix forgot-password username enumeration** (generic response)

### Phase 3: Hardening (Week 4) — P2 Items
- [ ] **Add X-Frame-Options: DENY header**
- [ ] **Add Referrer-Policy: strict-origin-when-cross-origin header**
- [ ] **Replace console.log with structured logger** (winston or pino)
- [ ] **Implement audit log integrity** (hash chain or SIEM forwarding)
- [ ] **Implement audit log retention enforcement** (cleanup job)
- [ ] **Remove external placeholder URLs** from login.html and settings.html
- [ ] **Remove frontend console.log statements** from login.js
- [ ] **Set up npm audit** in CI/CD pipeline
- [ ] **Add HTTPS/TLS** if any network deployment planned
- [ ] **Add HSTS header** after TLS implementation

### Phase 4: Ongoing
- [ ] Regular dependency audits (monthly npm audit)
- [ ] Periodic penetration testing
- [ ] Security training for development team
- [ ] Backup restore testing (quarterly)

---

## 9. Positive Security Observations

The system demonstrates strong security engineering in several areas:

1. **Zero SQL injection surface** — 100% parameterized queries across 100+ database calls
2. **Solid authentication architecture** — CSPRNG tokens, bcrypt hashing, DB-backed sessions
3. **Comprehensive RBAC** — Every route has server-side role enforcement
4. **Good audit trail** — All mutations logged with before/after snapshots, IP, user-agent
5. **File access control** — HMAC-signed ephemeral tokens gate all uploaded file access
6. **Proper Electron hardening** — contextIsolation, no nodeIntegration, single instance lock
7. **Input validation** — Joi schemas with stripUnknown on all mutation endpoints
8. **Defense in depth** — Rate limiter + DB lockout + session timeout layered protections
9. **Soft-delete pattern** — Archive system preserves data integrity with restore capability

---

*Assessment conducted as static code review per Rules of Engagement. No destructive testing performed. All credentials redacted with [REDACTED] in this report.*
