/**
 * Dedicated game preview window (Phaser shell) — sync via postMessage injection.
 */

const path = require('path');
const fs = require('fs');
const { BrowserWindow } = require('electron');

let previewWindow = null;
let previewShellPath = null;

function getAppRoot() {
  return path.join(__dirname, '..', '..');
}

function buildPreviewShellHtml() {
  const appPath = getAppRoot();
  const phaserPath = path.join(appPath, 'node_modules', 'phaser', 'dist', 'phaser.min.js');
  const templatePath = path.join(appPath, 'src', 'renderer', 'preview-templates', 'preview.html');

  if (!fs.existsSync(phaserPath) || !fs.existsSync(templatePath)) {
    throw new Error('Preview template or Phaser not found');
  }

  const phaserCode = fs.readFileSync(phaserPath, 'utf-8');
  let previewHtml = fs.readFileSync(templatePath, 'utf-8');
  previewHtml = previewHtml.replace(
    '<!-- Phaser code injected here -->',
    `<script>
      (function() {
        try {
          ${phaserCode}
        } catch (e) {
          console.error('Phaser load error:', e);
        }
      })();
    </script>`
  );
  return previewHtml;
}

function openPreviewPopout(mainWindow, app) {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.focus();
    return Promise.resolve({ success: true, alreadyOpen: true });
  }

  const html = buildPreviewShellHtml();
  const tempDir = app.getPath('temp');
  previewShellPath = path.join(tempDir, 'vibe-ide-preview-shell.html');
  fs.writeFileSync(previewShellPath, html, 'utf-8');

  previewWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 400,
    minHeight: 300,
    title: 'VIBE IDE — Game Preview',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  previewWindow.on('closed', () => {
    previewWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('preview:popout-closed');
    }
  });

  return new Promise((resolve) => {
    previewWindow.webContents.once('did-finish-load', () => {
      previewWindow.show();
      previewWindow.focus();
      resolve({ success: true, path: previewShellPath });
    });
    previewWindow.loadFile(previewShellPath).catch((err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

function sendPreviewPopoutMessage(payload) {
  if (!previewWindow || previewWindow.isDestroyed()) {
    return { success: false, error: 'Preview window not open' };
  }
  const json = JSON.stringify(payload ?? {});
  return previewWindow.webContents
    .executeJavaScript(`window.postMessage(${json}, '*');`, true)
    .then(() => ({ success: true }))
    .catch((err) => ({ success: false, error: err.message }));
}

function isPreviewPopoutOpen() {
  return !!(previewWindow && !previewWindow.isDestroyed());
}

function closePreviewPopout() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.close();
  }
  previewWindow = null;
}

module.exports = {
  openPreviewPopout,
  sendPreviewPopoutMessage,
  isPreviewPopoutOpen,
  closePreviewPopout,
};
