# IT403-P | Group Pre-Examination Activity
## Security Feature Review — Barangay 179 Crime BI (CART)

This is our updated review for the current build. The Tanod accounts, pages, routes, tables, and audit code have already been removed. The system now has three staff roles only: **Deputy Officer**, **Kagawad**, and **Team Leader**.

**Legend:** **RETAIN** = already in the system and we will keep it; **REMOVE** = not applicable to our setup; **ADD** = still needs to be added.

| # | Security feature / control | Student decision<br>(Retain / Remove / Add) | Reason / justification for the decision | Planned live test or evidence reference |
|---|----------------------------|---------------------------------------------|------------------------------------------|----------------------------------------|
| | **LOGIN AND ACCOUNT SECURITY** | | | |
| 1 | Central authentication | **RETAIN** | All logins go through our local Express backend using `POST /api/auth/login`. It checks the MySQL `users` table and creates a 256-bit session token saved in `user_sessions`. We do not use an external login service. | Log in at `localhost:3000`; call `GET /api/incidents` without a token and confirm 401. Check DevTools that authentication requests stay local. |
| 2 | Secure password handling | **RETAIN** | Passwords are hashed with bcrypt (10 rounds), password fields are masked, and the old Remember Me checkbox is gone. The demo accounts still use known passwords, so we plan to remove or change them before deployment. | Check that `password_hash` starts with `$2b$10$`; inspect the password input; try the demo login and note that it is only for testing. |
| 3 | Login abuse prevention | **RETAIN** | After 5 failed attempts within 15 minutes, the account is locked and returns 429. Auth routes also allow only 8 requests per 5 minutes per IP/path. | Enter a wrong password 6 times and confirm 429; send 9 rapid login requests and confirm the rate limiter blocks them. |
| | **SESSION SECURITY** | | | |
| 4 | Session ID renewal | **RETAIN** | Every successful login creates a new token using `crypto.randomBytes(32)`. Logout deactivates the current token, and password reset deactivates all sessions for that user. | Log in twice and compare the tokens; reset the password and reuse an old token, which should return 401. |
| 5 | Secure/HttpOnly cookies | **REMOVE** | We do not use cookies. The frontend keeps the Bearer token in `sessionStorage` and sends it in the `Authorization` header, so Secure and HttpOnly cookie flags do not apply. | DevTools → Network shows no `Set-Cookie` header, and Application → Cookies is empty. |
| 6 | Session expiry and revocation | **RETAIN** | Sessions expire after 30 idle minutes by default, and the timeout can be changed in Settings. Logout and password reset revoke sessions. Tokens are normally sent in headers, not URLs. The exception is the live notification stream, which uses `?token=` because `EventSource` cannot send headers. | Set the timeout to 1 minute, wait, and confirm the next API call returns 401. Check that only the notification stream uses a query token. |
| | **ACCESS CONTROL** | | | |
| 7 | Role-based authorization | **RETAIN** | We have three roles: Deputy Officer (full access), Team Leader (incidents and patrol, but no delete/settings/users), and Kagawad (view-only analytics). `requireRole()` checks the role from the database on every role-protected route. | As Kagawad, `POST /api/incidents` returns 403; as Team Leader, `DELETE /api/users/1` returns 403; as Deputy Officer, the same actions succeed. |
| 8 | Privileged actions and account governance | **RETAIN** | Only the Deputy Officer can manage users, settings, CART weights, and audit logs. Deletes are archived instead of permanently removed. Invalid tokens return 401, and the wrong role returns 403. | As Kagawad, `POST /api/users` returns 403; delete an incident and confirm it appears in Settings → Archive. |
| | **INPUT AND QUERY SECURITY** | | | |
| 9 | Input validation | **RETAIN** | Joi schemas validate request bodies, remove unknown fields, check latitude/longitude ranges, use a fixed location list, and enforce maximum text lengths. | Submit an incident with latitude `999` or an invalid location and confirm it returns 400; confirm extra fields are stripped. |
| 10 | Browser output protection | **RETAIN** | User text is passed through `escapeHTML()` before being inserted into the page. The server also sends `Content-Security-Policy` and `X-Content-Type-Options: nosniff` headers. The CSP still allows inline scripts and styles, so it is not as strict as it could be. | Save `<script>alert(1)</script>` in a description and confirm it displays as text. |
| 11 | Database and injection protection | **RETAIN** | Backend queries use `mysql2` placeholders (`?`) with parameter arrays. We did not find SQL built by concatenating user input. | Try `admin' OR '1'='1` at login and confirm it does not bypass authentication; use SQL characters in search and confirm normal results. |
| 12 | Upload and file protection | **RETAIN** | Uploads use a MIME allow-list, a magic-byte check with the `file-type` library, server-generated filenames, a 25 MB / 5-file limit, and a 60-second HMAC file token. | Rename an HTML file to `.jpg` and upload it; it should be rejected. Opening `/uploads/...` without an `ftoken` should return 403. |
| | **DATA PROTECTION AND PRIVACY** | | | |
| 13 | Encrypted network communication | **REMOVE** | The normal deployment is a single-PC Electron app, so the server and client are on the same machine and TLS is not needed. If we use the LAN setup in `docs/LAN_SETUP.md`, traffic between devices is plain HTTP, so HTTPS should be added for that setup. | Confirm the normal app uses `http://localhost:3000`; treat the LAN setup as an accepted risk or add TLS. |
| 14 | Least-privilege MySQL account | **RETAIN** | Not done yet: the app still connects as `root`, which has too many privileges. `backend/scripts/setup-db-user.js` can create `brgyapp` with only SELECT, INSERT, UPDATE, and DELETE. We need to run it and update `DB_USER` in `.env`. | After switching, run `DROP TABLE users` as `brgyapp` and confirm it is denied. |
| 15 | Sensitive data encryption and key protection | **RETAIN** | Passwords use bcrypt, session tokens use a secure random generator, and file tokens use HMAC-SHA256. `.env` is gitignored but stored in plaintext on disk, and backup encryption is optional through `BACKUP_ENCRYPTION_KEY`. Reset codes are emailed when configured; otherwise the code is placed in the audit trail for the admin, which we should remove later. | Confirm `.env` is not tracked; check bcrypt hashes; confirm file tokens expire; test password reset with and without email configured. |
| 16 | Personal-data minimization | **RETAIN** | User APIs do not return `password_hash`, error responses are generic, archive access is limited to the Deputy Officer, and Tanod PINs no longer exist. | `GET /api/users` should not contain password hashes; force an error and confirm there is no stack trace. |
| | **AUDIT LOGGING AND SAFE ERRORS** | | | |
| 17 | Security and activity audit trail | **RETAIN** | `logAudit()` records logins, failed logins, password changes, record create/update/delete, settings changes, CART updates, and report exports. Each entry stores the user, action, entity, old/new data, IP address, user agent, and timestamp. Tanod audit code is removed. | Log in, create/update/delete an incident, then check Settings → Audit Logs as the Deputy Officer. |
| 18 | Log security and monitoring | **RETAIN** | Only the Deputy Officer can call `GET /api/audit-logs`, and there are no API routes that update or delete audit entries. The remaining weakness is the root database account (see #14), which could modify the table directly. | As Kagawad, request `/api/audit-logs` and confirm 403; confirm no audit PUT/DELETE route exists. |
| | **AVAILABILITY, BACKUP AND RECOVERY** | | | |
| 19 | Offline operation | **RETAIN** | Fonts, Font Awesome, Chart.js, Bootstrap, Leaflet, Mapbox GL JS, and Turf are now local vendor files, so the pages no longer depend on CDNs. The map tiles still come from Mapbox, so the map itself needs internet. | Disconnect Wi-Fi and open the dashboard and reports; the core pages should load, but the map may be blank until we add offline tiles. |
| 20 | Backup and recovery | **RETAIN** | `npm run backup` creates a timestamped `mysqldump`, keeps the 14 newest backups, and encrypts with AES-256-CBC when `BACKUP_ENCRYPTION_KEY` is set. `npm run restore` can restore plain or encrypted backups. Backups are still manual. | Run `npm run backup` and check the file in `database/backups/`; restore a test database. |
| | **SECURE OPERATIONS AND CONFIGURATION** | | | |
| 21 | Production hardening | **RETAIN** | Electron uses `contextIsolation: true` and `nodeIntegration: false`; 404 and 500 responses are generic; server logging is minimal; and the login page no longer logs user details. Demo accounts still need to be removed, and the CSP could be stricter. | Request `/api/nonexistent` and confirm `{"error":"Not found"}`; trigger a server error and confirm `{"error":"Server error"}`. |

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
