const fs = require('fs');
const path = require('path');
const { DESKTOP_WEB_PREFERENCES, createDesktopPolicy, configureDesktopContents } = require('../../desktop-policy');
const root = path.join(__dirname, '../..');

describe('Electron application shell', () => {
    const policy = createDesktopPolicy('http://localhost:3007');
    test('keeps local dashboards and the actual internal-server port', () => {
        for (const page of ['setup.html?boot_token=fixture','login.html','dashboard.html','grid-heatmap.html','patrol.html?record=1'])
            expect(policy.mayNavigate('http://localhost:3007/' + page)).toBe(true);
        for (const url of ['https://example.com','http://localhost:3000/dashboard.html','http://localhost:3007.evil.example','javascript:alert(1)','file:///C:/private','https://localhost:3007','http://user:password@localhost:3007/'])
            expect(policy.mayNavigate(url)).toBe(false);
    });
    test('allows signed in-house evidence windows, not arbitrary browser tabs', () => {
        expect(policy.mayOpenWindow('http://localhost:3007/uploads/archive/evidence.jpg?ftoken=fixture')).toBe(true);
        for (const url of ['http://localhost:3007/uploads/photo.jpg','http://localhost:3007/dashboard.html?ftoken=fixture','https://example.com/uploads/a.jpg?ftoken=fixture','about:blank'])
            expect(policy.mayOpenWindow(url)).toBe(false);
    });
    test('retains local evidence fullscreen but denies unused browser/device permissions', () => {
        expect(policy.mayUsePermission('fullscreen','http://localhost:3007/incident-view.html')).toBe(true);
        expect(policy.mayUsePermission('fullscreen','https://example.com')).toBe(false);
        for (const permission of ['geolocation','media','notifications','display-capture','usb','serial','hid','openExternal','unknown'])
            expect(policy.mayUsePermission(permission,'http://localhost:3007')).toBe(false);
    });
    function contents() {
        const events = {};
        return { events, on: (name, handler) => { events[name] = handler; }, setWindowOpenHandler: jest.fn(), getURL: () => 'http://localhost:3007/incident.html',
            session: { webRequest:{onBeforeSendHeaders:jest.fn()}, setPermissionCheckHandler: jest.fn(), setPermissionRequestHandler: jest.fn() } };
    }
    test('wires navigation, redirect, webview and permission guards into actual contents hooks', () => {
        const shell = contents(); configureDesktopContents(shell,'http://localhost:3007');
        const event = {preventDefault:jest.fn()};
        shell.events['will-navigate'](event,'https://example.com'); expect(event.preventDefault).toHaveBeenCalledTimes(1);
        shell.events['will-redirect'](event,'http://localhost:3007/login.html'); expect(event.preventDefault).toHaveBeenCalledTimes(1);
        shell.events['will-attach-webview'](event); expect(event.preventDefault).toHaveBeenCalledTimes(2);
        const request = shell.session.setPermissionRequestHandler.mock.calls[0][0], result = jest.fn();
        request(shell,'media',result,{}); expect(result).toHaveBeenLastCalledWith(false);
        request(shell,'fullscreen',result,{}); expect(result).toHaveBeenLastCalledWith(true);
        const child = contents(); shell.events['did-create-window']({webContents:child});
        expect(child.setWindowOpenHandler).toHaveBeenCalled();
        const open = shell.setWindowOpenHandler.mock.calls[0][0];
        expect(open({url:'https://example.com'})).toEqual({action:'deny'});
        expect(open({url:'http://localhost:3007/uploads/a.png?ftoken=fixture'}).overrideBrowserWindowOptions.webPreferences).toEqual(DESKTOP_WEB_PREFERENCES);
    });
    test('Electron remains the only active launcher and its policy is packaged', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
        expect(pkg.scripts.start).toBe('electron .');
        expect(Object.keys(pkg.scripts).some(name=>name.startsWith('native:'))).toBe(false);
        expect(pkg.build.files).toContain('desktop-policy.js');
        expect(pkg.build.files).not.toContain('native/**/*');
        const main = fs.readFileSync(path.join(root,'main.js'),'utf8');
        expect(main).toContain('configureDesktopContents(mainWindow.webContents');
        expect(main).toContain('webPreferences: { ...DESKTOP_WEB_PREFERENCES }');
    });
    test('fonts and map renderers use bundled assets and no unused cloud-style branch', () => {
        const css = fs.readFileSync(path.join(root,'frontend/dashboard.css'),'utf8');
        expect(css).toContain("@import url('./vendor/css/local-fonts.css')"); expect(css).not.toContain('fonts.googleapis.com');
        const local = fs.readFileSync(path.join(root,'frontend/vendor/css/local-fonts.css'),'utf8');
        for (const [,asset] of local.matchAll(/url\('([^']+)'\)/g)) expect(fs.existsSync(path.resolve(root,'frontend/vendor/css',asset))).toBe(true);
        const renderer = fs.readFileSync(path.join(root,'frontend/mapboxHelper.js'),'utf8');
        expect(renderer).not.toContain('MAPBOX_TOKEN'); expect(renderer).not.toContain('mapbox://');
        const picker = fs.readFileSync(path.join(root,'frontend/mapHelper.js'),'utf8');
        expect(picker).toContain('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
        expect(picker).not.toContain('{s}.tile.openstreetmap.org');
    });
});
