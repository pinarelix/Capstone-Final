# IT403-P | Group Pre-Examination Activity
## Security Feature Review — Barangay 179 Crime BI (CART)

This is our updated review for the current build. The Tanod accounts, pages, routes, tables, and audit code have already been removed. The system now has three staff roles only: **Deputy Officer**, **Kagawad**, and **Team Leader**.

**Legend:** **RETAIN** = already in the system and we will keep it; **REMOVE** = not applicable to our setup; **ADD** = still needs to be added.

| # | Security feature / control | Student decision<br>(Retain / Remove / Add) | Reason / justification for the decision | Planned live test or evidence reference |
|---|----------------------------|---------------------------------------------|------------------------------------------|----------------------------------------|
| | **LOGIN AND ACCOUNT SECURITY** | | | |
| 1 | Central authentication | **RETAIN** | All logins are checked by our own server and the local database. After a successful login, the server gives the user a session token. We do not rely on Google, Facebook, or any outside login service. | Open the app and log in. Then try opening a protected page without logging in; it should be blocked. We can also check that the login request only goes to our local server. |
| 2 | Secure password handling | **RETAIN** | Passwords are stored as hashes, not plain text, and the password field is hidden while typing. The old Remember Me option is already removed. The demo accounts still have known passwords, so we plan to change or remove them before the final deployment. | Check the database and confirm the password is not readable. Try the demo account to show that it works for testing only. |
| 3 | Login abuse prevention | **RETAIN** | The system temporarily locks an account after five failed logins within 15 minutes. It also limits repeated login requests from the same computer. | Enter a wrong password six times and show the lock message. Send many login requests quickly and show that the system blocks them. |
| | **SESSION SECURITY** | | | |
| 4 | Session ID renewal | **RETAIN** | A new session token is created every time a user logs in. Logging out cancels the current token, and resetting a password cancels all active sessions. | Log in twice and compare the tokens. Reset a password and try using the old session; it should no longer work. |
| 5 | Secure/HttpOnly cookies | **REMOVE** | We do not use browser cookies for login. The token is kept in the browser tab and sent with each request, so cookie security settings do not apply. | Open the browser developer tools and show that no login cookies are saved. |
| 6 | Session expiry and revocation | **RETAIN** | Sessions expire after 30 minutes of inactivity by default, and the time can be changed in Settings. Logging out or resetting a password revokes the session. The only exception is the live notification connection, which places the token in the link because the browser cannot attach a login header to it. | Set the timeout to one minute, wait, and show that the next action logs the user out. Confirm the token is not normally visible in page links. |
| | **ACCESS CONTROL** | | | |
| 7 | Role-based authorization | **RETAIN** | There are three roles with different permissions: Deputy Officer has full access, Team Leader can manage incidents and patrol records, and Kagawad can only view reports and analytics. The server checks the role, not just the hidden buttons. | Log in as Kagawad and try to add an incident; it should be denied. Log in as Team Leader and try to delete a user; it should also be denied. |
| 8 | Privileged actions and account governance | **RETAIN** | Only the Deputy Officer can manage users, settings, and audit logs. Deleted records go to the Archive first. Requests without a valid login are rejected, and users with the wrong role are also rejected. | As Kagawad, try to open user management or send a user request; it should be blocked. Delete an incident and show it in the Archive. |
| | **INPUT AND QUERY SECURITY** | | | |
| 9 | Input validation | **RETAIN** | The system checks the data entered in forms. It validates coordinates, uses a fixed list of locations, limits text length, and ignores unexpected fields. | Try saving an incident with an invalid latitude or location; the system should show a validation error. |
| 10 | Browser output protection | **RETAIN** | Text entered by users is displayed as text, not as HTML or JavaScript. The server also adds browser security headers, although the policy can still be stricter. | Enter a script-like text in a description and show that it appears as plain text instead of running. |
| 11 | Database and injection protection | **RETAIN** | Database queries treat user input as data, not as part of the query. This prevents users from injecting their own database commands. | Try a common SQL injection text in the login or search field; it should be treated as normal input and should not bypass login. |
| 12 | Upload and file protection | **RETAIN** | Uploaded files are checked by type and actual content, renamed by the server, limited in size and count, and opened only with a temporary access token. | Rename a non-image file to .jpg and try to upload it; the system should reject it. Try opening an uploaded file without permission; access should be denied. |
| | **DATA PROTECTION AND PRIVACY** | | | |
| 13 | Encrypted network communication | **REMOVE** | The normal setup runs the app and server on one computer, so network encryption is not needed there. If the LAN setup is used, the data travels over the local network without HTTPS, so we should add it for that setup. | Show that the normal app runs on the local computer. For LAN use, document that HTTPS is still a recommended fix. |
| 14 | Least-privilege MySQL account | **RETAIN** | The app still uses the main database account, which has more permissions than needed. We have a script that can create a limited account that can only read and change records, not drop tables or manage users. We still need to apply it. | After switching accounts, try to drop a table using the app account; it should be denied. |
| 15 | Sensitive data encryption and key protection | **RETAIN** | Passwords are hashed, session and file tokens are randomly generated, and the environment file is not included in Git. The database password is still stored as plain text on the computer, and backup encryption is optional. Password reset codes are emailed when possible; if not, they go to the audit trail, which we should remove later. | Check that the environment file is not in the repository. Test password reset with and without an email address. |
| 16 | Personal-data minimization | **RETAIN** | The system does not return password hashes or detailed error messages. Archived records can only be viewed by the Deputy Officer. Tanod PINs are already removed. | Open the user list and confirm there are no passwords. Force an error and confirm it does not show internal details. |
| | **AUDIT LOGGING AND SAFE ERRORS** | | | |
| 17 | Security and activity audit trail | **RETAIN** | The system records important actions such as logins, failed logins, password changes, record changes, settings changes, and report exports. Each log shows who did it, what happened, and when. | Log in, add or edit an incident, then open the Audit Logs and show the entries. |
| 18 | Log security and monitoring | **RETAIN** | Only the Deputy Officer can view the audit logs, and there is no feature for editing or deleting them in the app. The remaining risk is that the app still uses the main database account, which could change the logs directly. | As Kagawad, try to open the audit logs; access should be denied. Confirm there is no delete or edit button. |
| | **AVAILABILITY, BACKUP AND RECOVERY** | | | |
| 19 | Offline operation | **RETAIN** | The fonts, icons, charts, and map libraries are saved locally, so the pages load without internet. The map background still comes from an online map service, so the map needs internet unless we add offline map files. | Disconnect the internet and open the dashboard and reports; they should load. Show that the map may not load without internet. |
| 20 | Backup and recovery | **RETAIN** | The backup command creates a copy of the database, keeps the 14 newest copies, and can encrypt them. The restore command can bring back a normal or encrypted backup. Backups are still done manually. | Run the backup command and show the new file. Restore a test database from the backup. |
| | **SECURE OPERATIONS AND CONFIGURATION** | | | |
| 21 | Production hardening | **RETAIN** | The desktop app separates the web page from system access, error messages do not reveal internal details, and the login page no longer prints user information in the console. The demo accounts still need to be removed, and the browser security policy can be stricter. | Open a wrong page and show the generic error. Check the browser console after login and confirm no user details are printed. |

---

## Additional Security Features (Optional)

These two controls were proposed in the previous review and are now already implemented in the current build, so we marked them as **RETAIN**.

| # | Security feature / control | Student decision<br>(Retain / Remove / Add) | Reason / justification for the decision | Planned live test or evidence reference |
|---|----------------------------|---------------------------------------------|------------------------------------------|----------------------------------------|
| A1 | Content-Security-Policy (CSP) response header | **RETAIN** | We already added this. It tells the browser to load scripts and styles only from allowed sources, which gives another layer of protection against injected scripts. The current policy still allows inline scripts and styles, so it can be made stricter. | Open the browser developer tools and check the response headers for the security policy. Try entering a script in a form; it should not run. |
| A2 | File upload magic-byte verification | **RETAIN** | We already added this. The system now checks the actual content of the file, not just the file extension or declared type, so a renamed malicious file is rejected. | Rename an HTML or text file to `.jpg` and upload it; it should be rejected. Upload a real image; it should be accepted. |

---

## Summary

**Totals: 21 RETAIN, 2 REMOVE, 0 ADD.**

The two optional controls from the previous review are now implemented and listed in the additional section above. They are also related to #10 and #12.

### Remaining fixes

1. Use a limited database account instead of the main account (#14).
2. Remove or change the demo accounts before deployment (#2 and #21).
3. Stop storing password reset codes in the audit trail, or require email delivery (#15).
4. Add automatic backup scheduling (#20).
5. Add HTTPS if the LAN setup will be used (#13).
6. Add offline map files if the map must work without internet (#19).
7. Tighten the browser security policy if possible (#10).
