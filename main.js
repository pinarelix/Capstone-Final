const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Fixes the AppData folder name (%APPDATA%\Barangay 179 Crime BI)
// regardless of how the app was launched.
app.setName('Barangay 179 Crime BI');

// Installed app: settings (.env) and uploaded photos/evidence live in
// the user's AppData folder, because the install folder is replaced on
// every reinstall/update and backend/.env is deliberately not shipped
// (it holds the database password). Running from source (npm start)
// keeps using backend/.env and backend/uploads.
const DATA_DIR = app.getPath('userData');
const CONFIG_PATH = path.join(DATA_DIR, '.env');
if (app.isPackaged) {
    process.env.APP_CONFIG_PATH = CONFIG_PATH;
    process.env.UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
}

const CONFIG_TEMPLATE = [
    '# Barangay 179 Crime BI - database settings',
    '# Fill in DB_PASSWORD with this PC\'s MySQL root password, save,',
    '# then open the app again.',
    '',
    'DB_HOST=localhost',
    'DB_USER=root',
    'DB_PASSWORD=',
    'DB_NAME=brgydata',
    'PORT=3000',
    '',
    '# Optional: Gmail address + App Password for password-reset emails.',
    'EMAIL_USER=',
    'EMAIL_APP_PASSWORD=',
    ''
].join('\r\n');

// First run on a new PC: create the settings file and point the user at
// it, instead of failing with a database error they can't act on.
async function ensureConfigExists() {
    if (!app.isPackaged || fs.existsSync(CONFIG_PATH)) return true;

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, CONFIG_TEMPLATE);

    const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Set Up Database Connection',
        message: 'Almost ready - the app needs this PC\'s MySQL password.',
        detail: `A settings file was created at:\n${CONFIG_PATH}\n\n` +
            'Open it, type the MySQL root password after DB_PASSWORD=, save it, ' +
            'then open the app again.',
        buttons: ['Open Settings File', 'Close'],
        defaultId: 0
    });
    if (response === 0) await shell.openPath(CONFIG_PATH);
    return false;
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

    if (!(await ensureConfigExists())) {
        app.quit();
        return;
    }

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
