// The Electron window is an application shell, not a general-purpose browser.
// Keep in-house pages and signed evidence viewing; reject unrelated navigation
// and unused device/location/website-notification permissions.
const DESKTOP_WEB_PREFERENCES = Object.freeze({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false
});
const tileSessions = new WeakSet();
function configureTileRequests(session) {
    if (tileSessions.has(session)) return;
    tileSessions.add(session);
    session.webRequest.onBeforeSendHeaders({urls:['https://tile.openstreetmap.org/*']}, (details, callback) => {
        const headers = {...details.requestHeaders};
        const key = Object.keys(headers).find(name=>name.toLowerCase() === 'user-agent');
        const userAgent = key ? headers[key] : '';
        if(key) delete headers[key];
        headers['User-Agent'] = userAgent + ' Barangay179CrimeBI/' + require('./package.json').version;
        callback({requestHeaders:headers});
    });
}

function createDesktopPolicy(appOrigin) {
    const origin = new URL(appOrigin).origin;
    function localUrl(value) {
        try {
            const url = new URL(value);
            return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && !url.username && !url.password ? url : null;
        } catch { return null; }
    }
    return {
        mayNavigate: value => Boolean(localUrl(value)),
        mayOpenWindow(value) {
            const url = localUrl(value);
            // Archive evidence links already use signed same-server URLs.
            return Boolean(url && url.pathname.startsWith('/uploads/') && url.searchParams.get('ftoken'));
        },
        mayUsePermission: (permission, requestingUrl) => permission === 'fullscreen' && Boolean(localUrl(requestingUrl))
    };
}

function configureDesktopContents(contents, appOrigin) {
    configureTileRequests(contents.session);
    const policy = createDesktopPolicy(appOrigin);
    const stopExternalNavigation = (event, url) => { if (!policy.mayNavigate(url)) event.preventDefault(); };
    contents.on('will-navigate', stopExternalNavigation);
    contents.on('will-redirect', stopExternalNavigation);
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => policy.mayOpenWindow(url) ? {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { ...DESKTOP_WEB_PREFERENCES } }
    } : { action: 'deny' });
    contents.on('did-create-window', window => configureDesktopContents(window.webContents, appOrigin));
    contents.session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => policy.mayUsePermission(permission, requestingOrigin));
    contents.session.setPermissionRequestHandler((requestingContents, permission, callback, details) => {
        callback(policy.mayUsePermission(permission, details.requestingUrl || requestingContents.getURL()));
    });
}

module.exports = { DESKTOP_WEB_PREFERENCES, createDesktopPolicy, configureDesktopContents, configureTileRequests };
