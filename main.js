const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Fixes the AppData folder name (%APPDATA%\Barangay 179 Crime BI)
// regardless of how the app was launched.
app.setName('Barangay 179 Crime BI');

// ── Config Manager ──────────────────────────────────────────────────
// Centralised config lives in config-manager.js. In packaged builds the
// JSON config goes into %APPDATA%; in dev mode the module falls back to
// backend/.env automatically.
const {
    setDataDir,
    loadConfig,
    migrateIfNeeded,
    applyToProcessEnv,
    getConfigPath,
} = require('./backend/config-manager');

const DATA_DIR = app.getPath('userData');
if (app.isPackaged) {
    setDataDir(DATA_DIR);
    process.env.UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
}

// Migrate a legacy .env → config.json on first boot after the upgrade.
// No-ops when there's nothing to migrate.
migrateIfNeeded();

// Load config and push values into process.env so existing code in
// server.js keeps working without changes.
const cfg = loadConfig();
applyToProcessEnv(cfg);

// Tell server.js where .env lives (for any remaining dotenv.config()
// call — it will read the same values we just set on process.env, so
// this is a no-op in practice, but avoids a "file not found" warning).
if (app.isPackaged) {
    process.env.APP_CONFIG_PATH = path.join(DATA_DIR, '.env');
}

let mainWindow;
// The port the backend actually listened on (PORT in backend/.env,
// default 3000) — the window must load that, not a hardcoded 3000.
let serverPort = 3000;

// ── Window creation ─────────────────────────────────────────────────
// Always opens setup.html first (the mandatory connection gate).
// setup.js navigates to login.html once a live DB connection is confirmed.

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        // Starts hidden and maximizes before showing, so the window
        // never flashes at its smaller default size first.
        show: false,
        icon: path.join(__dirname, 'frontend', 'icons', 'icon-512.png'),
        backgroundColor: '#0b1c3c',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        mainWindow.show();
    });

    // ── Mandatory gate: always land on the setup wizard first ────────
    // The wizard auto-tests the saved config. If it passes, the user
    // clicks "Connect & Continue" (one click) and setup.js navigates
    // to login.html. On first run or a broken connection they stay in
    // the wizard until they fix it.
    mainWindow.loadURL(`http://localhost:${serverPort}/setup.html`);
}

Menu.setApplicationMenu(null);

// Double-clicking the desktop icon again should bring the open window
// forward, not start a second server that fails with "port in use".
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

app.whenReady().then(async () => {
    if (!gotSingleInstanceLock) return;

    try {
        // Start the Express server so /api/setup/* endpoints are available
        // for the wizard. If the DB is down the server still starts — the
        // setup routes don't need a live pool; they test connections on
        // demand. startServer() is modified to not crash on DB failure.
        const { startServer } = require('./backend/server');
        const server = await startServer();
        serverPort = server.address().port;
    } catch (error) {
        if (error.code === 'EADDRINUSE') {
            dialog.showErrorBox(
                'Port Already in Use',
                `Port ${error.port || serverPort} is already being used by another program. ` +
                'Close any other running copy of this app (or dev server) and try again.'
            );
            app.quit();
            return;
        }
        // For any other error (including DB failures), still try to show
        // the wizard — the user can fix the connection from there.
        console.error('⚠️ Server start error (will show wizard):', error.message);

        // Fall back: start a minimal Express just to serve static files
        // and the setup API so the wizard can work.
        try {
            const express = require('express');
            const fallbackApp = express();
            fallbackApp.use(express.json());
            fallbackApp.use(express.static(path.join(__dirname, 'frontend')));

            // Mount the setup routes so the wizard can test/save config
            const setupRouter = require('./backend/routes/setup');
            fallbackApp.use('/api/setup', setupRouter);

            const fallbackServer = await new Promise((resolve, reject) => {
                const s = fallbackApp.listen(cfg.server.port || 3000, () => resolve(s));
                s.on('error', reject);
            });
            serverPort = fallbackServer.address().port;
            console.log(`🔧 Fallback server on port ${serverPort} (setup wizard only)`);
        } catch (fallbackErr) {
            dialog.showErrorBox(
                'Cannot Start',
                `The app could not start.\n\n` +
                `Details: ${fallbackErr.message}`
            );
            app.quit();
            return;
        }
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

process.on('uncaughtException', (error) => {
    if (error.code === 'EADDRINUSE') {
        dialog.showErrorBox(
            'Port Already in Use',
            `Port ${error.port || serverPort} is already being used by another program. ` +
            'Close any other running copy of this app (or dev server) and try again.'
        );
    } else {
        dialog.showErrorBox('Unexpected Error', error.message);
    }
    app.quit();
});

process.on('unhandledRejection', (error) => {
    dialog.showErrorBox('Unexpected Error', error instanceof Error ? error.message : String(error));
});
