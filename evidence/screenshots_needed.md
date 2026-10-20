# Screenshots Needed for Red Team Assessment

These screenshots should be captured during live testing to supplement the static code review findings.

## Authentication & Login (Criteria 1-3)

1. **SC-01**: Login page showing role-selection auto-fill populating credentials
   - Steps: Open login page → Click "Deputy Officer" role → Capture pre-filled username/password
   - Evidence for: Test 1.5 (hardcoded demo credentials)

2. **SC-02**: Browser DevTools showing login.js source with hardcoded credentials
   - Steps: Open DevTools → Sources → login.js → Lines 36-45
   - Evidence for: Test 1.5

3. **SC-03**: Lockout message after 5 failed login attempts
   - Steps: Enter wrong password 5 times → Capture error message on 6th attempt
   - Evidence for: Test 3.2

4. **SC-04**: Rate limit 429 response in DevTools Network tab
   - Steps: Rapid-fire 9+ login requests → Capture 429 response
   - Evidence for: Test 3.3

## Session Management (Criteria 4-6)

5. **SC-05**: sessionStorage showing token after login (DevTools → Application → Session Storage)
   - Evidence for: Test 4.1, 4.3

6. **SC-06**: localStorage showing duplicated user data (DevTools → Application → Local Storage)
   - Evidence for: Test 4.3

7. **SC-07**: Remember Me checkbox visible on login page
   - Evidence for: Test 2.2

## Security Headers (Criterion 10)

8. **SC-08**: Response headers in DevTools Network tab showing only X-Content-Type-Options
   - Steps: Login → Open any API call → Headers tab → Capture response headers
   - Evidence for: Tests 10.3, 10.4, 10.5 (missing CSP, X-Frame-Options, Referrer-Policy)

## Access Control (Criteria 7-8)

9. **SC-09**: 403 response when Kagawad role attempts admin endpoint
   - Steps: Login as captain → Use DevTools/curl to call POST /api/users → Capture 403
   - Evidence for: Test 7.1, 8.1

10. **SC-10**: Audit log page showing access restricted to Deputy Officer only
    - Evidence for: Test 8.4

## Offline Operation (Criterion 19)

11. **SC-11**: App with broken layout when offline (missing fonts/icons)
    - Steps: Disconnect internet → Launch app → Capture broken UI
    - Evidence for: Test 19.1

12. **SC-12**: DevTools Console showing failed CDN resource loads when offline
    - Evidence for: Test 19.1

## Backup & Recovery (Criterion 20)

13. **SC-13**: Backup directory showing plain SQL files
    - Steps: Run npm run backup → Show file listing with sizes
    - Evidence for: Test 20.2

## Frontend Console Logging (Criterion 21)

14. **SC-14**: Browser console after login showing user name and role logged
    - Steps: Open DevTools Console → Login → Capture console output
    - Evidence for: Test 21.4

## Password Reset Flow (Criterion 15)

15. **SC-15**: Server terminal showing reset token printed to console
    - Steps: Trigger forgot-password → Capture server stdout
    - Evidence for: Test 15.3

16. **SC-16**: Different responses for valid vs invalid username on forgot-password
    - Steps: POST /api/auth/forgot-password with valid then invalid username → Compare responses
    - Evidence for: Test 15.4
