const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('node-integration-in-subframes', 'true');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'shell-harness.html'));
});
