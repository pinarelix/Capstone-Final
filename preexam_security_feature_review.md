# IT403-P | GROUP PRE-EXAMINATION ACTIVITY
## Security Feature Finalization & Change Review
### CAPSTONE 04 OF 38 — Barangay 179 Crime CART

---

## Filled-Out Security Feature Inventory

> Transfer these entries to the PDF form. Each row maps to the form's columns:
> **Student decision** | **Reason / justification** | **Planned live test or evidence reference**

---

### LOGIN AND ACCOUNT SECURITY

**#1 — Account provisioning and status checks: Central authentication on the trusted local server.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. All authentication is handled centrally by the Express backend (server.js) running on the local machine. Staff login via POST /api/auth/login and tanod login via POST /api/tanod/login both validate credentials against the MySQL database on the same host. Session tokens (crypto.randomBytes 256-bit) are created server-side and stored in user_sessions / tanod_sessions tables. The authenticate middleware checks every protected request against the DB. No external authentication service is used. |
| **Planned live test or evidence** | 1) Open the app and attempt login — confirm authentication is handled by localhost:3000. 2) Inspect network traffic in DevTools — confirm no requests leave the local machine for authentication. 3) Call a protected endpoint (GET /api/incidents) without a token — confirm 401 Unauthorized. 4) Code reference: backend/server.js lines 730–815 (authenticate middleware), lines 1820–1935 (login route). |

---

**#2 — Secure password handling: salted password hashing; masked password entry; disabled remember-me and default passwords.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Partially implemented. Salted hashing: bcryptjs with salt rounds = 10 used for all passwords (users) and PINs (tanods). Masked entry: password field uses type="password" (login.html line 108). HOWEVER, two sub-controls are NOT yet met: (a) Remember Me checkbox is still present on the login form (login.html lines 127–132), and (b) default demo credentials are hardcoded in frontend/login.js (lines 36–45: admin/admin123, captain/captain123, deskofficer/deskofficer123) and in database/schema.sql (lines 681–684). These must be removed before the final examination to fully satisfy this criterion. |
| **Planned live test or evidence** | 1) Verify hashing: query the users table — confirm password_hash column stores $2b$10$ bcrypt hashes, not plaintext. 2) Verify masked entry: inspect the password input element — confirm type="password". 3) Verify remember-me disabled: inspect login.html — confirm the checkbox is removed. 4) Verify no default passwords: inspect login.js — confirm no hardcoded credentials in role-selection logic. 5) Attempt login with "admin" / "admin123" — confirm it fails after defaults are removed. 6) Code references: backend/server.js line 1877 (bcrypt.compare), login.html line 108, login.js lines 36–45 (to remove). |

---

**#3 — Login abuse prevention: lockout.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. Two-layer protection: (1) Database-tracked lockout — login_attempts table records each attempt with timestamp; after 5 failed attempts within 15 minutes, the account is locked and returns HTTP 429 with a "locked" flag. (2) In-memory rate limiter — sliding window of 8 requests per 5 minutes per IP:path applied to all auth endpoints (login, forgot-password, reset-password). Both staff and tanod login paths have identical lockout logic. |
| **Planned live test or evidence** | 1) Enter wrong password 5 times for the same username — confirm the 6th attempt returns 429 "Too many failed login attempts." 2) Wait 15 minutes — confirm the account unlocks. 3) Send 9 rapid requests to /api/auth/login — confirm rate limiter returns 429 before the 9th. 4) Verify the lockout message is user-friendly and does not leak internal details. 5) Code references: backend/server.js lines 1841–1853 (staff lockout), lines 3535–3543 (tanod lockout), lines 568–596 (rate limiter). |

---

### SESSION SECURITY

**#4 — Session identifiers and renewal: Session ID renewal on re-authentication.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. Each successful login generates a brand-new session token via crypto.randomBytes(32) (256-bit CSPRNG). The token is stored in the user_sessions table with is_active = 1. On password reset, all existing sessions for that user are invalidated (is_active set to 0) before the new password is saved, forcing re-authentication with a fresh token. On logout, the specific session token is deactivated. There is no token reuse across authentication events. |
| **Planned live test or evidence** | 1) Login and record the session token from sessionStorage. 2) Logout and login again — confirm a different token is issued. 3) Reset password — confirm all prior tokens return 401 on the next API call. 4) Code references: backend/server.js line 1907 (crypto.randomBytes for new token), line 2045 (all sessions invalidated on password reset). |

---

**#5 — Session and cookie protection: Secure and HttpOnly cookies.**

| Field | Entry |
|-------|-------|
| **Student decision** | **REMOVE** |
| **Reason / justification** | Not applicable to our architecture. The system does not use cookies for session management. Instead, it uses Bearer tokens sent via the Authorization HTTP header. No Set-Cookie headers are ever issued by the server (confirmed: grep for "cookie" / "Set-Cookie" in server.js returns zero matches; no cookie-parser dependency in package.json). The Bearer token approach provides equivalent or better security: tokens are not automatically attached to cross-origin requests (natural CSRF resistance), and are stored in sessionStorage (cleared when the browser tab closes). Since no cookies exist, Secure and HttpOnly cookie attributes have no surface to apply to. |
| **Planned live test or evidence** | 1) Open DevTools → Network tab during login — confirm no Set-Cookie response header on any endpoint. 2) Open DevTools → Application → Cookies — confirm no cookies are stored for localhost. 3) Confirm the Authorization: Bearer header is used for all API calls (inspect any request in Network tab). 4) Code reference: backend/server.js lines 730–815 (authenticate middleware reads Authorization header, not cookies). |

---

**#6 — Session expiry and revocation: periodic termination, inactivity logout and no identifiers in URLs or logs.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. Idle timeout: the authenticate middleware checks last_active_at against the configurable session_timeout_minutes setting (default 30 minutes). If the session has been idle beyond the threshold, it is automatically deactivated and returns 401. The timeout is refreshed on each authenticated request (sliding window). Revocation: logout explicitly sets is_active = 0 on the session record. Password reset revokes all sessions for the user. No session identifiers appear in URLs (tokens are in the Authorization header only). Session tokens are not written to audit logs (audit entries record user_id, not the token itself). |
| **Planned live test or evidence** | 1) Login and remain idle for longer than the configured timeout — confirm the next API call returns 401. 2) Change session_timeout_minutes to a short value (e.g., 1 minute) via Settings — confirm timeout applies. 3) Inspect audit_logs table — confirm no session_token values are stored. 4) Inspect all API URLs — confirm no token appears in query strings. 5) Code references: backend/server.js lines 710–724, 750–760 (idle check), lines 2108–2140 (logout), line 2045 (revoke all on reset). |

---

### ACCESS CONTROL

**#7 — Role-based authorization: Least-privilege RBAC; central authorization.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. A centralized requireRole() middleware (server.js lines 818–844) checks req.userRole against an allowed-roles array on every protected route. Three staff roles enforce least privilege: Deputy Officer (admin — full CRUD, settings, users, audit logs), Team Leader (CRUD on incidents and schedules, no settings/users), Kagawad (read-only access to incidents, schedules, and CART analytics). Tanods have a separate authentication path (authenticateTanod) with requireOwnTanodId enforcing object-level access to only their own data. All 80+ API routes have server-side role checks. Client-side UI hiding (apiHelper.js) supplements but does not replace server enforcement. |
| **Planned live test or evidence** | 1) Login as Kagawad (captain) → attempt POST /api/incidents via DevTools or curl — confirm 403 Forbidden. 2) Login as Team Leader → attempt DELETE /api/users/1 — confirm 403. 3) Login as Deputy Officer → confirm all operations succeed. 4) Authenticate as Tanod A → request GET /api/tanod/dashboard/[tanodB_id] — confirm 403. 5) Code reference: backend/server.js lines 818–844 (requireRole), all route definitions with role arrays. |

---

**#8 — Privileged actions and account governance: administrative data entry and account management separated from official view-only analytics; fail-secure decisions.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. User/account management (POST/PUT/DELETE /api/users) is restricted exclusively to Deputy Officer. System settings, CART weight configuration, and audit log access are also Deputy Officer–only. The Kagawad role provides view-only analytics access (GET on incidents, heatmap, CART summary, dashboard stats) without any data mutation capability. Fail-secure: the authenticate middleware returns 401 on any token failure, and requireRole returns 403 on role mismatch — both default to denial. Delete operations use soft-delete with an archive system (records are deactivated and archived, not permanently destroyed). |
| **Planned live test or evidence** | 1) Login as Kagawad — confirm the UI shows no edit/delete buttons (client-side check). 2) As Kagawad, use curl/DevTools to call POST /api/users — confirm 403 (server-side check). 3) Inspect a delete operation — confirm it creates an archive entry and sets is_active = 0 rather than permanently removing the record. 4) Send a request with an invalid/expired token — confirm 401 (fail-secure). 5) Code references: backend/server.js lines 1525–1800 (user CRUD — Deputy Officer only), lines 4661–4717 (audit logs — Deputy Officer only). |

---

### INPUT AND QUERY SECURITY

**#9 — Input validation and safe transaction processing: Server-side allow-list validation of coordinates and text.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. All POST/PUT endpoints use Joi schema validation via a validate() middleware (server.js lines 530–540) with stripUnknown: true to reject unexpected fields. Coordinates: latitude validated as number min(-90) max(90), longitude as number min(-180) max(180). Location fields validated against a BARANGAY_LOCATIONS allow-list using Joi.valid(). Text fields have explicit max-length constraints (username: 50, password: 128, name: 100, description: 5000). Enums validated with Joi.valid() (day_of_week, danger levels). CART weights validated as integers min(1) max(98) summing to 100. |
| **Planned live test or evidence** | 1) Send a POST /api/incidents with latitude = 999 — confirm 400 validation error. 2) Send a request with location = "InvalidPlace" — confirm rejection against allow-list. 3) Send a request with extra unexpected fields — confirm they are stripped. 4) Send username longer than 50 characters — confirm 400. 5) Code references: backend/server.js lines 372–528 (Joi schemas), lines 530–540 (validate middleware), line 4891–4895 (coordinate schema). |

---

**#10 — Browser output and request protections: contextual encoding for Leaflet/HTML.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. An escapeHTML() utility function (apiHelper.js lines 22–29) escapes &, <, >, double-quote, and single-quote before DOM insertion. Used 164 times across 11 frontend files against 171 innerHTML assignments across 12 files (near 1:1 coverage). Remaining innerHTML usages verified as either numeric-only (lat/lng coordinates) or static text. Server sets X-Content-Type-Options: nosniff to prevent MIME-sniffing attacks on uploaded files. Note: Content-Security-Policy header is not yet set — this is an area for improvement but does not negate the encoding protections. |
| **Planned live test or evidence** | 1) Create an incident with description containing `<script>alert('xss')</script>` — confirm the script tags render as text, not executable code. 2) Inspect the rendered HTML in DevTools — confirm angle brackets are escaped as &lt; &gt;. 3) Check response headers — confirm X-Content-Type-Options: nosniff is present. 4) Code references: frontend/apiHelper.js lines 22–29 (escapeHTML), backend/server.js line 71 (nosniff header). |

---

**#11 — Database and injection protections: parameterized queries.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. All 100+ database queries across the entire backend use mysql2/promise parameterized queries with ? placeholders and array parameters. No SQL string concatenation exists anywhere in the codebase (verified via grep). Even the dynamic audit-log query (lines 4670–4708), which builds WHERE clauses conditionally, uses parameterized ? for every user-supplied value — the dynamic portions are fixed SQL fragments only. This provides complete protection against SQL injection. |
| **Planned live test or evidence** | 1) Attempt login with username = `admin' OR '1'='1` — confirm it fails with "Invalid username or password" (not a successful bypass). 2) Search incidents with a filter containing SQL metacharacters — confirm normal error or no results, not injected behavior. 3) Grep the codebase: `grep -n "pool.query" backend/server.js` — confirm every call uses (?, [params]) pattern. 4) Code references: backend/server.js (all pool.query calls), e.g., line 1862 (login query), line 2538 (incident insert). |

---

**#12 — Upload and file-processing protections: disabled execution in upload directories.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. File uploads use multer with: (a) MIME type allow-list (image/jpeg, image/png, image/gif, image/webp, video/mp4) — non-allowed types rejected with 400. (b) Server-generated filenames (Date.now + random suffix) — original filename not used, preventing path traversal. (c) 10 MB size limit per file. (d) Upload directory is NOT served as a static directory — files are gated behind HMAC-signed file tokens (?ftoken=) with 60-second TTL, generated per-session via /api/uploads/file-token. (e) X-Content-Type-Options: nosniff prevents browsers from executing an uploaded file as a different type. Note: MIME-type checking alone is spoofable (client-supplied header); magic-byte verification would strengthen this further but the existing controls provide substantial protection. |
| **Planned live test or evidence** | 1) Upload a .txt file renamed to .jpg — confirm rejection by the MIME filter. 2) Attempt to access an uploaded file at /uploads/[filename] without a valid ftoken — confirm 403. 3) Access with an expired ftoken (after 60 seconds) — confirm 403. 4) Inspect uploaded filenames on disk — confirm server-generated names (no original filenames). 5) Code references: backend/server.js multer config (fileFilter, limits), lines 1026–1061 (HMAC file token system). |

---

### DATA PROTECTION AND PRIVACY

**#13 — Encrypted network communication: TLS between frontend and local server.**

| Field | Entry |
|-------|-------|
| **Student decision** | **REMOVE** |
| **Reason / justification** | Not applicable to the deployed architecture. The system runs as an Electron desktop application where the Express backend and the Chromium frontend operate on the same machine, communicating over localhost (127.0.0.1:3000). TLS encrypts data in transit between separate network hosts — when both endpoints are the same machine, the traffic never leaves the loopback interface and cannot be intercepted over a network. Implementing TLS for localhost would add certificate-management complexity (self-signed cert warnings, annual renewals) with no security benefit for the actual deployment. If the system were ever deployed as a web application accessible over a LAN or internet, TLS would become critical — but that is outside the current capstone scope of a single-machine Electron desktop app. |
| **Planned live test or evidence** | 1) Confirm the Electron app loads from http://localhost:3000 (main.js line 79). 2) Confirm the Express server binds to localhost only. 3) Open Windows Resource Monitor → Network — confirm no external network connections during normal operation (all traffic is loopback). 4) Document this as an accepted risk with the constraint: "TLS required if deployment scope changes to multi-machine or network-accessible." |

---

**#14 — Confidential record access and storage: least-privilege MySQL account.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Partially implemented — requires remediation. Currently, the application connects to MySQL as the root user (server.js line 218: `process.env.DB_USER || 'root'`, .env: DB_USER=root). Root has full database privileges (DROP, GRANT, FILE, etc.) far exceeding application needs. The application only requires SELECT, INSERT, UPDATE, and DELETE on the brgydata schema. A dedicated least-privilege MySQL user must be created before the final examination. The connection infrastructure (mysql2/promise pool, .env-based config) is correct and ready — only the privilege level needs to change. |
| **Planned live test or evidence** | 1) Create a MySQL user: `CREATE USER 'brgyapp'@'localhost' IDENTIFIED BY '[strong password]'; GRANT SELECT, INSERT, UPDATE, DELETE ON brgydata.* TO 'brgyapp'@'localhost';` 2) Update .env: DB_USER=brgyapp. 3) Restart the app — confirm all features work normally. 4) Connect as brgyapp and attempt `DROP TABLE users` — confirm "Access denied" (privilege restriction works). 5) Code references: backend/.env (DB_USER), backend/server.js line 218. |

---

**#15 — Sensitive data encryption and key protection: separate encrypted connection configuration.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Partially implemented. Password/PIN hashing: bcryptjs with salt rounds = 10 (irreversible — strong). Session tokens: crypto.randomBytes(32) CSPRNG. File access tokens: HMAC-SHA256 with ephemeral secret regenerated on each server start. Configuration: .env file stores database credentials in plaintext and is listed in .gitignore. Config-manager.js (used in packaged builds) migrates to a config.json in %APPDATA%. However: (a) .env contains the DB password in plaintext on disk. (b) The reset-password token is a 6-digit numeric code logged to the server console (low entropy, visible in logs). (c) Email delivery for reset tokens is not configured. These issues should be addressed for full compliance. |
| **Planned live test or evidence** | 1) Verify .env is in .gitignore — confirm `git status` does not show it as tracked in fresh clone. 2) Verify bcrypt hashes in DB: `SELECT password_hash FROM users LIMIT 1` — confirm $2b$10$ prefix. 3) Verify file token expiry: request a file, wait 60+ seconds, re-request with same ftoken — confirm 403. 4) Verify reset token is NOT logged to console after fix. 5) Code references: backend/server.js line 1907 (bcrypt), lines 1026–1035 (HMAC secret), backend/.env. |

---

**#16 — Personal-data minimization and lifecycle: secure handling and disposal of printed patrol routes.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented at the application layer. API responses exclude sensitive fields: user queries omit password_hash, tanod queries use TANOD_PUBLIC_COLUMNS which excludes pin_code_hash, audit log old_data strips PIN hashes. Error responses return generic messages without stack traces or internal details (custom 404 and global error handlers). The soft-delete/archive pattern means records are deactivated rather than permanently exposed, and the archive is restricted to Deputy Officer access. For printed patrol routes specifically: the application provides on-screen data — physical document handling (printing, shredding) is an operational procedure outside application scope but should be covered in an operational policy document. |
| **Planned live test or evidence** | 1) Call GET /api/users — confirm no password_hash field in response JSON. 2) Call GET /api/tanods — confirm no pin_code_hash in response. 3) Trigger a server error (e.g., malformed request) — confirm no stack trace in the response body. 4) Check audit_logs for a tanod update — confirm pin_code_hash is not stored in old_data/new_data. 5) Code references: backend/server.js TANOD_PUBLIC_COLUMNS definition, lines 4993–4995 (404 handler), lines 5030–5033 (global error handler). |

---

### AUDIT LOGGING AND SAFE ERRORS

**#17 — Security and activity audit trail: Authentication, validation failure, record modification and security-configuration logs.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. Comprehensive audit logging via logAudit() and logTanodAudit() functions. Covered events: LOGIN, LOGOUT, FORGOT_PASSWORD, RESET_PASSWORD, CHANGE_PASSWORD (authentication); CREATE/UPDATE/DELETE on users, incidents, tanods, schedules, patrol logs, settings, CART weights (record modification); RUN_CART_ANALYSIS, UPDATE_SETTINGS, SET_LOCATION_COORDINATES (security configuration). Each entry captures: user_id, action, entity_type, entity_id, old_data (before snapshot), new_data (after snapshot), ip_address, user_agent, created_at. Staff and tanod audit trails are combined in the admin view via UNION ALL query. Login attempts (both successful and failed) are tracked in login_attempts and tanod_login_attempts tables. |
| **Planned live test or evidence** | 1) Login → create an incident → update it → delete it — check audit_logs for all four actions with correct old_data/new_data. 2) Change a system setting — confirm UPDATE_SETTINGS audit entry with the setting key and value. 3) Fail a login attempt — confirm login_attempts table records the failure with timestamp and IP. 4) View audit logs as Deputy Officer via Settings → Audit Logs — confirm all events are displayed with who/what/when. 5) Code references: backend/server.js logAudit function, all route handlers with logAudit calls. |

---

**#18 — Log security and monitoring: access restricted to the Security Admin.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Implemented. GET /api/audit-logs requires requireRole(['Deputy Officer']) — only the admin role can view audit entries. No PUT or DELETE endpoints exist for audit logs, making them append-only at the application layer. The combined staff + tanod audit view (UNION ALL query) ensures complete visibility for the admin. Note: since the database user is currently root (see #14), a database-level user with direct DB access could modify logs — this is mitigated by fixing #14 (least-privilege user cannot DELETE/UPDATE on audit_logs if restricted via GRANT). |
| **Planned live test or evidence** | 1) Login as Kagawad or Team Leader → attempt GET /api/audit-logs — confirm 403 Forbidden. 2) Login as Deputy Officer → confirm audit logs are accessible. 3) Attempt to find any API endpoint that modifies or deletes audit entries — confirm none exists. 4) After fixing #14: connect as the application DB user and attempt DELETE FROM audit_logs — confirm "Access denied." 5) Code reference: backend/server.js line 4661 (requireRole(['Deputy Officer'])). |

---

### AVAILABILITY BACKUP AND RECOVERY

**#19 — Service continuity and availability: Operation without external cloud connectivity.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Partially implemented — requires remediation. The core architecture is correct for offline operation: Electron desktop app with local Express backend and local MySQL database — no cloud services required for data processing. HOWEVER, the frontend HTML files load 10+ external CDN resources (Google Fonts, Font Awesome, Chart.js, Bootstrap, Leaflet, Mapbox GL JS, Turf.js) which will fail without internet, breaking the UI layout, icons, charts, and maps. Additionally, two image fallback URLs point to via.placeholder.com (login.html, settings.html). All external dependencies must be bundled locally before the final examination to ensure full offline capability — critical for a law enforcement tool used during outages. |
| **Planned live test or evidence** | 1) Disconnect the machine from the internet (disable Wi-Fi/Ethernet). 2) Launch the Electron app — confirm it opens and all pages render correctly (fonts, icons, charts, maps). 3) Create an incident, view the dashboard, open the heatmap — confirm all core features work offline. 4) Reconnect — confirm no behavioral difference. 5) After fix: grep all HTML files for "http://" and "https://" — confirm zero external CDN references remain. |

---

**#20 — Backup and recovery controls: routine local backups, including automated encrypted backups in the mitigation table.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Partially implemented — requires remediation. A backup script exists (backend/scripts/backup-database.js) that performs mysqldump with --single-transaction for InnoDB consistency, outputs to database/backups/, and retains the 14 most recent files. Password is passed via MYSQL_PWD env var (not visible in process listing). However: (a) Backups are MANUAL only (npm run backup) — no automated scheduling. (b) Backup files are plain SQL text — no encryption. (c) No restore script or documented restore procedure exists. For the final examination, automated scheduling (node-cron or OS task scheduler) and backup encryption (GPG or AES-256) should be implemented, plus a tested restore procedure. |
| **Planned live test or evidence** | 1) Run `npm run backup` — confirm a .sql file is created in database/backups/ with the correct timestamp. 2) Verify the backup contains all tables: grep for CREATE TABLE statements in the backup file. 3) After adding encryption: confirm the backup file is not readable as plain SQL. 4) Test restore: drop a test table, restore from backup, confirm the table is recovered. 5) After adding scheduling: confirm backup runs automatically at the configured interval. 6) Code reference: backend/scripts/backup-database.js. |

---

### SECURE OPERATIONS AND CONFIGURATION

**#21 — Production hardening and secrets: Removal of unnecessary functions, test code and directory listings.**

| Field | Entry |
|-------|-------|
| **Student decision** | **RETAIN** |
| **Reason / justification** | Partially implemented. Positive: Electron is configured securely (contextIsolation: true, nodeIntegration: false, application menu removed, single-instance lock). Custom 404 and global error handlers prevent Express stack trace leakage. No debug endpoints found. However: (a) 92 console.log/console.error statements in server.js including route listing on startup (lines 5049–5096). (b) Frontend login.js logs user name, role, and "Session Token Saved" to browser console (lines 352–354). (c) The hardcoded demo credentials in login.js and schema.sql are development artifacts (covered in #2). These should be cleaned up or gated behind a NODE_ENV check for the final examination. |
| **Planned live test or evidence** | 1) Set NODE_ENV=production and start the server — confirm minimal startup logging (no full route listing). 2) Open browser DevTools → Console after login — confirm no sensitive data logged (no username, role, or token references). 3) Trigger a 404 by requesting /api/nonexistent — confirm JSON response {"error":"Not found"} with no stack trace. 4) Trigger a 500 error — confirm JSON response {"error":"Server error"} with no internal details. 5) Code references: main.js lines 52–67 (Electron config), backend/server.js lines 4993–5033 (error handlers). |

---

### ADDITIONAL SECURITY FEATURES (OPTIONAL)

**#A1 — Content-Security-Policy (CSP) response header**

| Field | Entry |
|-------|-------|
| **Student decision** | **ADD** |
| **Reason / justification** | Currently only X-Content-Type-Options: nosniff is set. Adding a Content-Security-Policy header would restrict script/style sources to trusted origins and block inline script injection, significantly reducing XSS impact even if an encoding gap is found. This is a standard security header recommended by OWASP and is straightforward to implement as a single middleware line. |
| **Planned live test or evidence** | 1) After implementation: inspect any API response headers in DevTools — confirm Content-Security-Policy header is present with appropriate directives (default-src 'self'; script-src 'self' [bundled sources]; style-src 'self' 'unsafe-inline'). 2) Inject a `<script>` tag via a test input — confirm the browser blocks it due to CSP. |

**#A2 — File upload magic-byte verification**

| Field | Entry |
|-------|-------|
| **Student decision** | **ADD** |
| **Reason / justification** | The current multer file filter checks only the client-supplied MIME type header, which can be spoofed. Adding magic-byte verification (using the file-type npm library) validates the actual binary content of uploaded files matches the declared type. This closes the gap where a malicious file (e.g., HTML with embedded script) could be uploaded with a spoofed image/jpeg MIME type. |
| **Planned live test or evidence** | 1) After implementation: create a .html file, rename to .jpg — attempt upload — confirm rejection with "Invalid file content" error. 2) Upload a genuine JPEG — confirm it succeeds. 3) Code reference: add file-type check after multer processes the file but before saving. |

---

## Summary of Decisions

| # | Feature | Decision | Key Issue (if any) |
|---|---------|----------|--------------------|
| 1 | Central authentication | RETAIN | Fully implemented |
| 2 | Password handling | RETAIN | Must remove remember-me checkbox and demo credentials |
| 3 | Login lockout | RETAIN | Fully implemented (5 attempts / 15 min + rate limiter) |
| 4 | Session ID renewal | RETAIN | Fully implemented (new token each login) |
| 5 | Secure/HttpOnly cookies | **REMOVE** | System uses Bearer tokens, not cookies |
| 6 | Session expiry/revocation | RETAIN | Fully implemented (configurable idle timeout) |
| 7 | RBAC | RETAIN | Fully implemented (4 roles, 80+ routes) |
| 8 | Privileged actions | RETAIN | Fully implemented (Deputy Officer gated) |
| 9 | Input validation | RETAIN | Fully implemented (Joi schemas on all endpoints) |
| 10 | Output encoding | RETAIN | Fully implemented (escapeHTML + nosniff) |
| 11 | SQL injection protection | RETAIN | Fully implemented (100% parameterized queries) |
| 12 | Upload protections | RETAIN | Implemented (MIME filter + signed tokens + size limit) |
| 13 | TLS/HTTPS | **REMOVE** | Localhost Electron app — TLS not applicable |
| 14 | Least-privilege MySQL | RETAIN | Must change from root to dedicated user |
| 15 | Encryption/key protection | RETAIN | Must fix reset token logging and email delivery |
| 16 | Data minimization | RETAIN | Fully implemented (field exclusion + safe errors) |
| 17 | Audit trail | RETAIN | Fully implemented (comprehensive logging) |
| 18 | Log security | RETAIN | Implemented (Deputy Officer–only access, append-only) |
| 19 | Offline operation | RETAIN | Must bundle CDN dependencies locally |
| 20 | Backup/recovery | RETAIN | Must add encryption, scheduling, and restore procedure |
| 21 | Production hardening | RETAIN | Must reduce console logging, remove dev artifacts |
| A1 | CSP header | **ADD** | Defense-in-depth against XSS |
| A2 | Magic-byte file verification | **ADD** | Closes MIME-spoofing gap in uploads |

**Totals: 17 RETAIN, 2 REMOVE, 2 ADD**
