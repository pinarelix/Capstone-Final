# IT403-P | Group Pre-Examination Activity
## Security Feature Review — Barangay 179 Crime BI (CART)

This is our updated review for the current build. The biggest change is that we already removed the Tanod accounts, pages, routes, tables, and audit code. The system now has three staff roles only: **Deputy Officer**, **Kagawad**, and **Team Leader**.

The table follows the same 21 security features from the activity. **RETAIN** means we already have the control and will keep it, **REMOVE** means it does not apply to our setup, and **ADD** means we still need to add it.

---

### Login and Account Security

| # | Feature | Decision | Reason and evidence |
|---|---------|----------|---------------------|
| 1 | Central authentication | **RETAIN** | All logins go through `POST /api/auth/login` on our local Express server. It checks the MySQL `users` table and creates a 256-bit session token stored in `user_sessions`. We do not use any external login service. **Test:** in the normal setup, login is handled by our local server at `localhost:3000`; calling `/api/incidents` without a token returns 401. |
| 2 | Secure password handling | **RETAIN** | Passwords are hashed with bcrypt (10 rounds), password fields are masked, and the old Remember Me checkbox is gone. The demo accounts in `database/schema.sql` still use known passwords, so we should change or remove them before the real deployment. **Test:** check that `password_hash` starts with `$2b$10$`; inspect the password input; try the demo login. |
| 3 | Login abuse prevention | **RETAIN** | After 5 failed attempts within 15 minutes the account is locked and returns 429. Auth routes also have an in-memory limit of 8 requests per 5 minutes per IP/path. **Test:** enter a wrong password 6 times and check for the lockout message; send rapid login requests and check for 429. |
| 4 | Session ID renewal | **RETAIN** | Every successful login creates a new token using `crypto.randomBytes(32)`. Logout deactivates the current token, and password reset deactivates all sessions for that user. **Test:** login twice and compare the tokens; reset the password and reuse an old token, which should return 401. |

---

### Session Security

| # | Feature | Decision | Reason and evidence |
|---|---------|----------|---------------------|
| 5 | Secure/HttpOnly cookies | **REMOVE** | We do not use cookies. The frontend stores the Bearer token in `sessionStorage` and sends it through the `Authorization` header, so Secure and HttpOnly cookie flags do not apply. **Test:** DevTools → Network shows no `Set-Cookie` header, and Application → Cookies is empty. |
| 6 | Session expiry and revocation | **RETAIN** | Sessions expire after 30 idle minutes by default, and the timeout can be changed in Settings. Logout and password reset revoke sessions. Normal API calls send the token in the header, not the URL. The only exception is the live notification stream, which uses `?token=` because `EventSource` cannot send headers. **Test:** set the timeout to 1 minute, wait, and confirm the next request returns 401. |

---

### Access Control

| # | Feature | Decision | Reason and evidence |
|---|---------|----------|---------------------|
| 7 | Role-based authorization | **RETAIN** | We have three roles: Deputy Officer (full access), Team Leader (incidents and patrol, but no delete/settings/users), and Kagawad (view-only analytics). The `requireRole()` middleware checks the user's role from the database on every role-protected route. **Test:** as Kagawad, `POST /api/incidents` returns 403; as Team Leader, `DELETE /api/users/1` returns 403. |
| 8 | Privileged actions and account governance | **RETAIN** | Only the Deputy Officer can manage users, settings, CART weights, and audit logs. Deletes are archived instead of permanently removed. The system fails secure: missing or invalid tokens return 401, and the wrong role returns 403. **Test:** as Kagawad, `POST /api/users` returns 403; delete an incident and confirm it appears in Settings → Archive. |

---

### Input and Query Security

| # | Feature | Decision | Reason and evidence |
|---|---------|----------|---------------------|
| 9 | Input validation | **RETAIN** | Joi schemas validate request bodies, remove unknown fields, check latitude/longitude ranges, use a fixed location list, and enforce maximum text lengths. **Test:** submit an incident with latitude `999` or an invalid location and confirm it returns 400. |
| 10 | Browser output protection | **RETAIN** | User text is passed through `escapeHTML()` before being inserted into the page. The server also sends `Content-Security-Policy` and `X-Content-Type-Options: nosniff` headers. The CSP still allows inline scripts and styles, so it is not as strict as it could be. **Test:** save `<script>alert(1)</script>` in a description and confirm it displays as text. |
| 11 | Database and injection protection | **RETAIN** | Backend queries use `mysql2` placeholders (`?`) with parameter arrays. We did not find SQL built by concatenating user input. **Test:** try `admin' OR '1'='1` at login and confirm it does not bypass authentication. |
| 12 | Upload and file protection | **RETAIN** | Uploads use a MIME allow-list, a magic-byte check with the `file-type` library, server-generated filenames, a 25 MB / 5-file limit, and a 60-second HMAC file token. **Test:** rename an HTML file to `.jpg` and upload it; it should be rejected. Opening `/uploads/...` without an `ftoken` should return 403. |

---

### Data Protection and Privacy

| # | Feature | Decision | Reason and evidence |
|---|---------|----------|---------------------|
| 13 | Encrypted network communication | **REMOVE** | For the normal single-PC Electron setup, the server and client are on the same machine, so TLS is not needed. If we use the LAN setup in `docs/LAN_SETUP.md`, traffic between devices is plain HTTP, so HTTPS should be added for that setup. **Test:** confirm the normal app uses `http://localhost:3000`; treat the LAN setup as an accepted risk or add TLS. |
| 14 | Least-privilege MySQL account | **RETAIN** | Not done yet: the app currently connects as `root`, which has too many privileges. We already have `backend/scripts/setup-db-user.js`, which creates `brgyapp` with only SELECT, INSERT, UPDATE, and DELETE. We need to run it and change `DB_USER` in `.env`. **Test:** after switching, run `DROP TABLE users` as `brgyapp` and confirm it is denied. |
| 15 | Sensitive data encryption and key protection | **RETAIN** | Passwords use bcrypt, session tokens use a secure random generator, and file tokens use HMAC-SHA256. `.env` is gitignored but stored in plaintext on disk, and backup encryption is optional through `BACKUP_ENCRYPTION_KEY`. Password-reset codes are emailed when configured; if email is not available, the code is placed in the audit trail for the admin, which we should remove later. **Test:** confirm `.env` is not tracked, check the bcrypt hashes, and confirm file tokens expire. |
| 16 | Personal-data minimization | **RETAIN** | User APIs do not return `password_hash`, error responses are generic, and archive access is limited to the Deputy Officer. Tanod PINs no longer exist in the system. **Test:** `GET /api/users` should not contain password hashes; force an error and confirm there is no stack trace. |

---

### Audit Logging and Safe Errors

| # | Feature | Decision | Reason and evidence |
|---|---------|----------|---------------------|
| 17 | Security and activity audit trail | **RETAIN** | `logAudit()` records logins, failed logins, password changes, record create/update/delete, settings changes, CART updates, and report exports. Each entry stores the user, action, entity, old/new data, IP address, user agent, and timestamp. The old Tanod audit code is gone. **Test:** login, create/update/delete an incident, then check Settings → Audit Logs as the Deputy Officer. |
| 18 | Log security and monitoring | **RETAIN** | Only the Deputy Officer can call `GET /api/audit-logs`, and there are no API routes that update or delete audit entries. The remaining weakness is the root database account (see #14), which could modify the table directly. **Test:** as Kagawad, request `/api/audit-logs` and confirm 403; confirm no audit PUT/DELETE route exists. |

---

### Availability, Backup, and Configuration

| # | Feature | Decision | Reason and evidence |
|---|---------|----------|---------------------|
| 19 | Offline operation | **RETAIN** | Fonts, Font Awesome, Chart.js, Bootstrap, Leaflet, Mapbox GL JS, and Turf are now local vendor files, so the pages no longer depend on CDNs. The map tiles still come from Mapbox, so the map itself needs internet. **Test:** disconnect Wi-Fi and open the dashboard and reports; the core pages should load, but the map may be blank until we add offline tiles. |
| 20 | Backup and recovery | **RETAIN** | `npm run backup` creates a timestamped `mysqldump`, keeps the 14 newest backups, and encrypts with AES-256-CBC when `BACKUP_ENCRYPTION_KEY` is set. `npm run restore` can restore plain or encrypted backups. Backups are still manual. **Test:** run `npm run backup`, check the file in `database/backups/`, and restore a test database. |
| 21 | Production hardening | **RETAIN** | Electron uses `contextIsolation: true` and `nodeIntegration: false`; 404 and 500 responses are generic; server logging is minimal; and the login page no longer logs user details. Demo accounts still need to be removed, and the CSP could be stricter. **Test:** request `/api/nonexistent` and confirm `{"error":"Not found"}`; trigger a server error and confirm `{"error":"Server error"}`. |

---

## Summary

**Totals: 19 RETAIN, 2 REMOVE, 0 ADD.**

The two optional features from the previous review are now already implemented, so they are included in the main list instead of being separate ADD items:

- **CSP header** — now in `backend/server.js` (covered in #10).
- **Magic-byte upload check** — now using `file-type` (covered in #12).

### Remaining fixes

1. Switch the MySQL connection from `root` to the `brgyapp` user (#14).
2. Remove or change the demo accounts before deployment (#2 and #21).
3. Stop storing password-reset codes in the audit trail, or require email delivery (#15).
4. Add automatic backup scheduling (#20).
5. Use HTTPS if the LAN setup will be used (#13).
6. Add offline map tiles if the map must work without internet (#19).
7. Tighten the CSP by removing `unsafe-inline` and `unsafe-eval` if possible (#10).
