# Code Review Evidence

All evidence collected via static code analysis. Credentials and secrets are redacted with [REDACTED].

---

## E1. Hardcoded Demo Credentials (Test 1.5)

**File:** `frontend/login.js` lines 36-45
```javascript
if (role === 'deputy') {
    usernameInput.value = 'admin';
    passwordField.value = 'admin123';
} else if (role === 'kagawad') {
    usernameInput.value = 'captain';
    passwordField.value = 'captain123';
} else if (role === 'teamleader') {
    usernameInput.value = 'deskofficer';
    passwordField.value = 'deskofficer123';
}
```

---

## E2. Demo Accounts in Schema (Test 1.6)

**File:** `database/schema.sql` lines 681-684
```sql
INSERT INTO users (name, username, password_hash, role) VALUES
('Admin User', 'admin', '$2b$10$...', 'Deputy Officer'),
('Captain User', 'captain', '$2b$10$...', 'Kagawad'),
('Desk Officer', 'deskofficer', '$2b$10$...', 'Team Leader');
```
*Hashes correspond to admin123, captain123, deskofficer123 respectively*

---

## E3. Root Database User (Test 14.1)

**File:** `backend/server.js` line 218
```javascript
user: process.env.DB_USER || 'root',
```

**File:** `backend/.env`
```
DB_USER=root
DB_PASSWORD=[REDACTED]
```

**File:** `backend/connectors/mysql.js` (fallback)
```javascript
user: 'root',
password: '',
```

---

## E4. Missing Security Headers (Tests 10.3-10.5)

**File:** `backend/server.js` lines 70-73
```javascript
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});
```
**Missing:** Content-Security-Policy, X-Frame-Options, Referrer-Policy, Strict-Transport-Security, Permissions-Policy

**Grep confirmation:**
```
$ grep -n "Content-Security-Policy\|X-Frame-Options\|Referrer-Policy\|Strict-Transport\|Permissions-Policy" backend/server.js
(no results)
```

---

## E5. localStorage Data Duplication (Test 4.3)

**File:** `frontend/login.js` lines 339-350
```javascript
// Also save to localStorage for backward compatibility (optional)
try {
    localStorage.setItem('user', JSON.stringify({
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        is_active: user.is_active,
        last_login_at: user.last_login_at || new Date().toISOString()
    }));
    localStorage.setItem('isLoggedIn', 'true');
} catch (e) {}
```

---

## E6. Remember Me Checkbox (Test 2.2)

**File:** `frontend/login.html` lines 126-136
```html
<label class="remember-me">
    <input type="checkbox" id="remember" name="remember">
    <span>Remember me</span>
</label>
```

---

## E7. Password Reset Token Console Logging (Test 15.3)

**File:** `backend/server.js` lines ~2004-2008 (forgot-password route)
The reset token is logged to the server console via console.log. Email delivery is not configured (EMAIL_USER and EMAIL_APP_PASSWORD are empty in .env).

---

## E8. Username Enumeration (Test 15.4)

**File:** `backend/server.js` lines ~1988-1995
```javascript
// Returns 404 for invalid username vs 200 for valid username
// This reveals whether a username exists in the system
```

---

## E9. External CDN Dependencies (Test 19.1)

**External resources loaded across frontend HTML files:**

| Resource | Files |
|----------|-------|
| Google Fonts (Inter) | dashboard.html, incident-view.html, login.html, patrol.html, settings.html |
| Font Awesome 6.5.2 (cdnjs) | dashboard.html, grid-heatmap.html, incident.html, patrol.html, settings.html |
| Font Awesome 6.4.0 (cdnjs) | login.html |
| Chart.js 4.4.1 (jsdelivr) | dashboard.html |
| chartjs-plugin-datalabels 2.2.0 (jsdelivr) | dashboard.html |
| Bootstrap 5.3.0 (jsdelivr) | incident-view.html |
| Mapbox GL JS 2.15.0 (api.mapbox.com) | grid-heatmap.html |
| Leaflet 1.9.4 (unpkg) | patrol.html |
| Turf.js 7.2.0 (jsdelivr) | patrol.html |
| via.placeholder.com | login.html, settings.html |

**Total: 10+ distinct external dependencies across 7+ HTML files**

---

## E10. Unencrypted Backups (Test 20.2)

**File:** `backend/scripts/backup-database.js`
- Uses `mysqldump --single-transaction` to produce plain SQL text files
- Output to `database/backups/` directory
- No encryption step after dump
- Retention: 14 most recent files kept

---

## E11. Console.log Count (Tests 16.3, 21.2)

```
$ grep -c "console.log\|console.error" backend/server.js
92
```

---

## E12. No CSRF Protection Needed (Test 21.5)

```
$ grep -rn "cookie\|Cookie\|set-cookie\|Set-Cookie" backend/server.js
(no results)

$ grep -rn "csrf\|CSRF\|xsrf\|XSRF" .
(no results)
```
Bearer token auth via Authorization header provides natural CSRF resistance.

---

## E13. .gitignore Configuration

**File:** `.gitignore` (relevant sections)
```
.env
.env.local
.env.*.local
```
*.env is listed in .gitignore. However `git status` shows `backend/.env` as modified, suggesting it may have been tracked historically.*

---

## E14. Electron Security Configuration (Test 21.3)

**File:** `main.js` lines 52-67
```javascript
mainWindow = new BrowserWindow({
    // ...
    webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
    }
});
```

---

## E15. Parameterized Query Verification (Test 11.1)

All SQL queries use the `pool.query('... ? ...', [params])` pattern. Representative sample:

```javascript
// Login (line 1862)
await pool.query('SELECT * FROM users WHERE username = ?', [username]);

// Incident creation (line 2538)
await pool.query('INSERT INTO incidents (...) VALUES (?, ?, ?, ...)', [...]);

// Audit log query with dynamic WHERE (line 4670-4708)
// Uses parameterized ? for all user-supplied values
query += ' AND action = ?';
params.push(action);
```

No string concatenation found in any SQL query across the entire codebase.

---

## E16. Rate Limiter Configuration (Test 3.3)

**File:** `backend/server.js` lines 568-596
```javascript
// In-memory sliding window: 8 requests per 5 minutes per IP:path
```

Applied to: POST /api/auth/login, POST /api/auth/forgot-password, POST /api/auth/reset-password, POST /api/tanod/login

---

*All evidence collected 2026-10-20 via static code analysis. No live exploitation performed.*
