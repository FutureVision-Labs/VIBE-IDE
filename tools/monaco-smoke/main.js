/**
 * Minimal Electron + Monaco — repro scroll/repaint without VIBE shell.
 * Run: npm run monaco:smoke
 * Add: --disable-gpu to test GPU off
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

if (process.argv.includes('--disable-gpu') || process.env.VIBE_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  console.log('[monaco-smoke] GPU disabled');
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
});
