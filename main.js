const { app, BrowserWindow, Menu, dialog } = require('electron');
const { startServer } = require('./backend/server');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadURL('http://localhost:3000/login.html');
}

Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
    try {
        await startServer();
    } catch (error) {
        dialog.showErrorBox(
            'Cannot Start Server',
            `The app could not connect to the database.\n\n` +
            `Please make sure MySQL is running, then restart the app.\n\n` +
            `Details: ${error.message}`
        );
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
            'Port 3000 is already being used by another program. ' +
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
