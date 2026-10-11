/* ============================================================
   SETUP WIZARD JS - Barangay 179 Crime BI
   Database connection setup (pre-login gate)
============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    // =========================================================
    // API URL (same logic as apiHelper.js)
    // =========================================================
    const API_URL = window.location.protocol.startsWith('http')
        ? window.location.origin + '/api'
        : 'http://localhost:3000/api';

    // =========================================================
    // DOM REFERENCES
    // =========================================================
    const dbHost     = document.getElementById('dbHost');
    const dbPort     = document.getElementById('dbPort');
    const dbUser     = document.getElementById('dbUser');
    const dbPassword = document.getElementById('dbPassword');
    const dbName     = document.getElementById('dbName');

    const btnTest    = document.getElementById('btnTest');
    const btnLaunch  = document.getElementById('btnLaunch');
    const btnLabel   = document.getElementById('btnLaunchLabel');

    const statusArea    = document.getElementById('statusArea');
    const statusContent = document.getElementById('statusContent');

    const togglePw = document.getElementById('togglePassword');

    // =========================================================
    // STATE
    // =========================================================
    let hasPassedTest  = false;   // true once a test succeeds
    let isConfigLoaded = false;   // true when config was fetched from server
    let configChanged  = false;   // true when user edits a pre-filled field

    // Snapshot of the loaded config so we can detect edits
    let loadedSnapshot = null;

    // =========================================================
    // PASSWORD TOGGLE
    // =========================================================
    if (togglePw && dbPassword) {
        togglePw.addEventListener('click', function () {
            var type = dbPassword.getAttribute('type') === 'password' ? 'text' : 'password';
            dbPassword.setAttribute('type', type);
            this.classList.toggle('fa-eye');
            this.classList.toggle('fa-eye-slash');
        });
    }

    // =========================================================
    // HELPERS
    // =========================================================

    function escapeHTML(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** Gather current field values */
    function getFields() {
        // If the password is still the masked placeholder ('••••••')
        // and the user hasn't typed in the field, send a sentinel so
        // the backend knows to use the real saved password.
        var isMasked = dbPassword.getAttribute('data-masked') === 'true';
        var pw = isMasked ? '__USE_SAVED__' : dbPassword.value;

        return {
            host:     (dbHost.value || '').trim(),
            port:     parseInt(dbPort.value, 10) || 3306,
            user:     (dbUser.value || '').trim(),
            password: pw,
            database: (dbName.value || '').trim()
        };
    }

    /** Check whether required fields are filled */
    function requiredFilled() {
        var f = getFields();
        return f.host !== '' && f.port > 0 && f.user !== '' && f.database !== '';
    }

    /** Refresh button states after every change */
    function refreshButtons() {
        // Test button always available when fields are filled
        btnTest.disabled = !requiredFilled();

        // Launch button available only after a successful test
        btnLaunch.disabled = !hasPassedTest;

        // Label: "Connect & Continue" for an existing config, "Save & Launch" otherwise
        if (isConfigLoaded && !configChanged) {
            btnLabel.textContent = 'Connect & Continue';
        } else {
            btnLabel.textContent = 'Save & Launch';
        }
    }

    /** Detect if user changed anything from the loaded config */
    function checkConfigChanged() {
        if (!loadedSnapshot) {
            configChanged = false;
            return;
        }
        var f = getFields();
        configChanged = (
            f.host     !== loadedSnapshot.host     ||
            f.port     !== loadedSnapshot.port     ||
            f.user     !== loadedSnapshot.user     ||
            f.database !== loadedSnapshot.database ||
            f.password !== loadedSnapshot.password
        );
    }

    // =========================================================
    // STATUS DISPLAY
    // =========================================================

    function showStatus(type, title, detail) {
        statusArea.className = 'status-area status-' + type;
        statusArea.style.display = 'block';

        var iconClass = '';
        if (type === 'testing') iconClass = 'fa-solid fa-spinner fa-spin';
        else if (type === 'success') iconClass = 'fa-solid fa-circle-check';
        else if (type === 'error') iconClass = 'fa-solid fa-circle-xmark';

        statusContent.innerHTML =
            '<div class="status-content">' +
                '<div class="status-icon"><i class="' + iconClass + '"></i></div>' +
                '<div class="status-text">' +
                    '<div class="status-title">' + escapeHTML(title) + '</div>' +
                    (detail ? '<div class="status-detail">' + detail + '</div>' : '') +
                '</div>' +
            '</div>';
    }

    function hideStatus() {
        statusArea.style.display = 'none';
        statusArea.className = 'status-area';
    }

    // =========================================================
    // TEST CONNECTION
    // =========================================================

    async function runTest() {
        if (!requiredFilled()) return;

        var fields = getFields();
        hasPassedTest = false;
        refreshButtons();

        showStatus('testing', 'Testing connection...', null);
        btnTest.disabled = true;
        btnTest.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing...';

        try {
            var response = await fetch(API_URL + '/setup/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields)
            });

            var data = await response.json();

            if (data.ok) {
                hasPassedTest = true;

                var details = '';
                if (data.version) {
                    details += '<strong>MySQL Version:</strong> ' + escapeHTML(data.version);
                }
                if (data.tables !== undefined) {
                    if (details) details += ' &nbsp;&bull;&nbsp; ';
                    details += '<strong>Tables:</strong> ' + escapeHTML(data.tables);
                }

                showStatus('success', 'Connection successful', details);
            } else {
                showStatus(
                    'error',
                    'Connection failed',
                    escapeHTML(data.error || 'Unable to connect to the database.')
                );
            }
        } catch (err) {
            showStatus(
                'error',
                'Connection failed',
                escapeHTML(err.message || 'Could not reach the server.')
            );
        }

        btnTest.disabled = false;
        btnTest.innerHTML = '<i class="fa-solid fa-vial"></i> Test Connection';
        refreshButtons();
    }

    // =========================================================
    // SAVE & LAUNCH
    // =========================================================

    async function saveAndLaunch() {
        if (!hasPassedTest) return;

        var fields = getFields();

        btnLaunch.disabled = true;
        btnLaunch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        try {
            var response = await fetch(API_URL + '/setup/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    db: {
                        host:     fields.host,
                        port:     fields.port,
                        user:     fields.user,
                        password: fields.password,
                        name:     fields.database
                    }
                })
            });

            var data = await response.json();

            if (data.ok) {
                // Redirect to login page
                window.location.href = 'login.html';
            } else {
                showStatus(
                    'error',
                    'Save failed',
                    escapeHTML(data.error || 'Could not save configuration.')
                );
                btnLaunch.disabled = false;
                btnLaunch.innerHTML =
                    '<span id="btnLaunchLabel">' +
                    (isConfigLoaded && !configChanged ? 'Connect &amp; Continue' : 'Save &amp; Launch') +
                    '</span> <i class="fa-solid fa-arrow-right"></i>';
            }
        } catch (err) {
            showStatus(
                'error',
                'Save failed',
                escapeHTML(err.message || 'Could not reach the server.')
            );
            btnLaunch.disabled = false;
            btnLaunch.innerHTML =
                '<span id="btnLaunchLabel">' +
                (isConfigLoaded && !configChanged ? 'Connect &amp; Continue' : 'Save &amp; Launch') +
                '</span> <i class="fa-solid fa-arrow-right"></i>';
        }
    }

    // =========================================================
    // EVENT LISTENERS
    // =========================================================

    btnTest.addEventListener('click', runTest);
    btnLaunch.addEventListener('click', saveAndLaunch);

    // On any field change: invalidate the test, detect config change
    var allFields = [dbHost, dbPort, dbUser, dbPassword, dbName];
    allFields.forEach(function (field) {
        field.addEventListener('input', function () {
            // Clear the masked-password flag when the user types a new password
            if (field === dbPassword) {
                dbPassword.removeAttribute('data-masked');
            }
            hasPassedTest = false;
            checkConfigChanged();
            refreshButtons();
            hideStatus();
        });
    });

    // =========================================================
    // LOAD EXISTING CONFIG ON PAGE LOAD
    // =========================================================

    async function loadConfig() {
        try {
            var response = await fetch(API_URL + '/setup/config');

            if (!response.ok) {
                // No saved config (404 or error) — keep defaults
                isConfigLoaded = false;
                refreshButtons();
                return;
            }

            var data = await response.json();

            // data may contain { host, port, user, password, name/database }
            var cfg = data.db || data;

            if (cfg.host) dbHost.value = cfg.host;
            if (cfg.port) dbPort.value = cfg.port;
            if (cfg.user) dbUser.value = cfg.user;
            // Password comes masked ('••••••') from the server — show it
            // masked in the field but mark it as unchanged so the test
            // endpoint knows to use the real saved password.
            if (cfg.password) {
                dbPassword.value = cfg.password;
                dbPassword.setAttribute('data-masked', 'true');
            }
            if (cfg.name)     dbName.value = cfg.name;
            if (cfg.database) dbName.value = cfg.database;

            // Take a snapshot for change-detection
            loadedSnapshot = getFields();
            isConfigLoaded = true;
            configChanged  = false;

            refreshButtons();

            // Auto-test for returning users
            await runTest();

        } catch (err) {
            // Server unreachable or parse error — stay on defaults
            console.error('Setup: could not load config:', err);
            isConfigLoaded = false;
            refreshButtons();
        }
    }

    // Initial state
    refreshButtons();
    loadConfig();
});
