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
// default 3000) - the window must load that, not a hardcoded 3000.
let serverPort = 3000;

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
        backgroundColor: '#ffffff',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        mainWindow.show();
    });

    mainWindow.loadURL(`http://localhost:${serverPort}/login.html`);
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
        // Required here, not at the top: server.js reads its settings
        // (APP_CONFIG_PATH) the moment it loads.
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
        } else {
            dialog.showErrorBox(
                'Cannot Start Server',
                `The app could not connect to the database.\n\n` +
                `Please make sure MySQL is running, then restart the app.\n\n` +
                (app.isPackaged ? `Database settings: ${CONFIG_PATH}\n\n` : '') +
                `Details: ${error.message}`
            );
        }
        app.quit();
        return;
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
