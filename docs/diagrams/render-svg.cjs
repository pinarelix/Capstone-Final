/**
 * Rasterises an SVG to PNG using Electron's offscreen Chromium.
 * Usage: set SVG_FILE / PNG_FILE / W / H env vars, then `npx electron render-svg.cjs`.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = process.env.SVG_FILE;
const png = process.env.PNG_FILE;
const width = Number(process.env.W || 2820);
const height = Number(process.env.H || 2080);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false,
      width,
      height,
      frame: false,
      useContentSize: true,
      webPreferences: { offscreen: true },
    });
    win.setContentSize(width, height);
    const html = `<!doctype html><html><body style="margin:0;background:#fff">
      <img src="${path.basename(svg)}" width="${width}" height="${height}" style="display:block">
    </body></html>`;
    const tmp = path.join(path.dirname(svg), '_render.html');
    fs.writeFileSync(tmp, html);
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 900));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    fs.writeFileSync(png, img.toPNG());
    fs.unlinkSync(tmp);
    console.log('wrote', png, img.getSize());
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  app.quit();
});
