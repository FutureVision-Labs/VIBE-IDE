const { app, BrowserWindow, Menu, protocol, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let splashWindow;
const windowStateFile = path.join(app.getPath('userData'), 'window-state.json');

// Load window state
function loadWindowState() {
  try {
    if (fs.existsSync(windowStateFile)) {
      const data = fs.readFileSync(windowStateFile, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading window state:', error);
  }
  return {
    width: 1400,
    height: 900,
    x: undefined,
    y: undefined,
    maximized: false
  };
}

// Save window state
function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  try {
    const bounds = mainWindow.getBounds();
    const state = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: mainWindow.isMaximized()
    };
    
    fs.writeFileSync(windowStateFile, JSON.stringify(state, null, 2));
  } catch (error) {
    // Silently fail - window state saving is not critical
    // console.error('Error saving window state:', error);
  }
}

// Store splash image path globally so IPC handler can access it
let currentSplashImagePath = null;

function createSplashWindow() {
  // Get list of splash images
  const splashDir = path.join(__dirname, '../renderer/assets/splash');
  const splashFiles = [
    'VIBE IDE Splash 1.jpg',
    'VIBE IDE Splash 2.jpg',
    'VIBE IDE Splash 3.jpg',
    'VIBE IDE Splash 4.jpg',
    'VIBE IDE Splash 5.jpg',
    'VIBE IDE Splash 6.jpg',
    'VIBE IDE Splash 7.jpg',
    'VIBE IDE Splash 8.jpg'
  ];
  
  // Pick a random splash image
  const randomSplash = splashFiles[Math.floor(Math.random() * splashFiles.length)];
  currentSplashImagePath = path.join(splashDir, randomSplash);
  
  // Create splash window (centered, no frame, always on top)
  splashWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    show: false // Don't show until ready
  });
  
  // Center the window
  splashWindow.center();
  
  // Load splash HTML
  splashWindow.loadFile(path.join(__dirname, '../renderer/splash.html'));
  
  // Show when ready
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });
  
  splashWindow.on('closed', () => {
    splashWindow = null;
    currentSplashImagePath = null;
  });
}

function createWindow() {
  // Load saved window state
  const windowState = loadWindowState();
  
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 800,
    minHeight: 600,
    show: false, // Don't show until ready (splash will close first)
    frame: false, // Remove Windows chrome - custom window controls
    titleBarStyle: 'hidden', // For macOS
    titleBarOverlay: false,
    webPreferences: {
      nodeIntegration: true, // Needed for Monaco Editor's AMD loader
      contextIsolation: false, // Temporarily disabled for Monaco compatibility
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1e1e1e'
  });

  // Restore maximized state
  if (windowState.maximized) {
    mainWindow.maximize();
  }

  // Save window state on move/resize
  mainWindow.on('moved', saveWindowState);
  mainWindow.on('resized', saveWindowState);
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);

  // Load the index.html file
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show main window when ready (but splash will still be on top)
  mainWindow.once('ready-to-show', () => {
    // Main window is ready, but we'll show it after splash closes
  });

  // Open DevTools by default for debugging
  mainWindow.webContents.openDevTools();

  // Create application menu (after window is created)
  createMenu();

  // Save state when window is about to close (before it's destroyed)
  mainWindow.on('close', (event) => {
    saveWindowState();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createMenu() {
  if (!mainWindow) {
    console.error('Cannot create menu: mainWindow not initialized');
    return;
  }
  
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            console.log('Menu click: New Project');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu:newProject');
            }
          }
        },
        {
          label: 'Open Project',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            console.log('Menu click: Open Project');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu:openProject');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            console.log('Menu click: New File');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu:newFile');
            }
          }
        },
        {
          label: 'Open File',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            console.log('Menu click: Open File');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu:openFile');
            }
          }
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            console.log('Menu click: Save');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu:saveFile');
            }
          }
        },
        {
          label: 'Save As',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            console.log('Menu click: Save As');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu:saveFileAs');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'forceReload', label: 'Force Reload' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Fullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About VIBE IDE',
          click: () => {
            showAboutDialog();
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  
  console.log('✅ Application menu created and set');
}

// Show About Dialog
function showAboutDialog() {
  const packageJson = require('../../package.json');
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About VIBE IDE',
    message: 'VIBE IDE',
    detail: `Version ${packageJson.version}\n\n` +
            `${packageJson.description}\n\n` +
            `Built with ❤️ by FutureVision Labs\n\n` +
            `Part of the Forge Family\n\n` +
            `Visit us:\n` +
            `• itch.io: futurevisionlabs.itch.io/vibe-ide\n` +
            `• GitHub: github.com/FutureVision-Labs/VIBE-IDE\n` +
            `• Medium: medium.com/@caynesd\n\n` +
            `© 2025 FutureVision Labs`,
    buttons: ['OK'],
    defaultId: 0
  });
}

// IPC Handlers for File Operations (Phase 4)
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'JavaScript', extensions: ['js'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (result.canceled) {
    return null;
  }
  
  const filePath = result.filePaths[0];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      path: filePath,
      content: content,
      name: path.basename(filePath)
    };
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
});

ipcMain.handle('dialog:saveFile', async (event, content, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath,
    filters: [
      { name: 'JavaScript', extensions: ['js'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (result.canceled) {
    return null;
  }
  
  const filePath = result.filePath;
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return {
      path: filePath,
      name: path.basename(filePath)
    };
  } catch (error) {
    console.error('Error saving file:', error);
    return null;
  }
});

ipcMain.handle('dialog:openProject', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
});

ipcMain.handle('dialog:selectProjectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
});

ipcMain.handle('fs:readFile', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content: content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
  try {
    // Create timestamped backup if file exists
    if (fs.existsSync(filePath)) {
      try {
        const dir = path.dirname(filePath);
        const base = path.basename(filePath);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const bakPath = path.join(dir, `${base}.${ts}.bak`);
        const existing = fs.readFileSync(filePath);
        fs.writeFileSync(bakPath, existing);
        console.log('🗂️ Backup created:', bakPath);
      } catch (bakErr) {
        console.warn('Backup failed (continuing with write):', bakErr.message);
      }
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs:copyFile', async (event, srcPath, destPath) => {
  try {
    fs.copyFileSync(srcPath, destPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs:readDir', async (event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = [];
    
    entries.forEach(entry => {
      files.push({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        type: entry.isDirectory() ? 'folder' : 'file'
      });
    });
    
    return { success: true, files: files };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs:exists', async (event, filePath) => {
  try {
    return { success: true, exists: fs.existsSync(filePath) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs:createFile', async (event, filePath, content = '') => {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // If file exists, confirm overwrite and create backup
    if (fs.existsSync(filePath)) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Overwrite File?',
        message: `The file already exists:\n${filePath}\n\nDo you want to overwrite it? A .bak backup will be created.`,
        buttons: ['Overwrite', 'Cancel'],
        cancelId: 1,
        defaultId: 0,
        noLink: true
      });
      if (response !== 0) {
        return { success: false, cancelled: true };
      }

      // Backup existing
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const bakPath = path.join(dir, `${path.basename(filePath)}.${ts}.bak`);
        const existing = fs.readFileSync(filePath);
        fs.writeFileSync(bakPath, existing);
        console.log('🗂️ Backup created (createFile):', bakPath);
      } catch (e) {
        console.warn('Backup failed on createFile:', e.message);
      }
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs:createFolder', async (event, folderPath) => {
  try {
    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs:delete', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      fs.rmdirSync(filePath, { recursive: true });
    } else {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project:create', async (event, template, projectPath, genre = null) => {
  try {
    // Template to genre mapping (infer genre from template if not specified)
    const templateToGenre = {
      blank: null,
      platformer: 'platformer',
      shooter: 'shooter',
      puzzle: 'puzzle',
      runner: 'runner'
    };
    
    // Use provided genre or infer from template
    const selectedGenre = genre || templateToGenre[template] || null;
    
    // Create project structure based on template
    const templates = {
      blank: {
        files: {
          'game.js': `// Your Phaser.js game code here\nfunction preload() {\n    // Load assets\n}\n\nfunction create() {\n    // Initialize game objects\n}\n\nfunction update() {\n    // Game loop\n}`
        }
      },
      platformer: {
        files: {
          'game.js': `// Platformer Template\nfunction preload() {\n    this.add.graphics()\n        .fillStyle(0x00ff00)\n        .fillRect(0, 0, 64, 64)\n        .generateTexture('player', 64, 64);\n}\n\nfunction create() {\n    this.player = this.physics.add.sprite(400, 300, 'player');\n    this.player.setCollideWorldBounds(true);\n    this.player.setGravityY(800);\n    \n    this.cursors = this.input.keyboard.createCursorKeys();\n}\n\nfunction update() {\n    if (this.cursors.left.isDown) {\n        this.player.setVelocityX(-200);\n    } else if (this.cursors.right.isDown) {\n        this.player.setVelocityX(200);\n    } else {\n        this.player.setVelocityX(0);\n    }\n    \n    if (this.cursors.up.isDown && this.player.body.touching.down) {\n        this.player.setVelocityY(-600);\n    }\n}`
        }
      }
    };

    const selectedTemplate = templates[template] || templates.blank;

    // Create project directory
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    // If target folder contains files that would be overwritten, confirm
    const potentialWrites = Object.keys(selectedTemplate.files).map(f => path.join(projectPath, f));
    const conflicts = potentialWrites.filter(p => fs.existsSync(p));
    if (conflicts.length > 0) {
      const display = conflicts.map(p => `• ${path.basename(p)}`).join('\n');
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Overwrite Existing Files?',
        message: `The selected folder contains files that would be overwritten:\n\n${display}\n\nProceed? .bak backups will be created.`,
        buttons: ['Proceed', 'Cancel'],
        cancelId: 1,
        defaultId: 0,
        noLink: true
      });
      if (response !== 0) {
        return { success: false, cancelled: true };
      }
    }

    // Create/overwrite template files with backups when necessary
    for (const [fileName, content] of Object.entries(selectedTemplate.files)) {
      const filePath = path.join(projectPath, fileName);
      if (fs.existsSync(filePath)) {
        try {
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const bakPath = path.join(projectPath, `${fileName}.${ts}.bak`);
          const existing = fs.readFileSync(filePath);
          fs.writeFileSync(bakPath, existing);
          console.log('🗂️ Backup created (project:create):', bakPath);
        } catch (e) {
          console.warn('Backup failed during project:create:', e.message);
        }
      }
      fs.writeFileSync(filePath, content, 'utf-8');
    }

    // Create package.json
    const packageJson = {
      name: path.basename(projectPath),
      version: '1.0.0',
      description: 'Project created with VIBE IDE',
      main: 'game.js',
      scripts: {
        start: 'npx http-server -p 8080'
      },
      dependencies: {
        phaser: '^3.90.0'
      }
    };

    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const bakPath = path.join(projectPath, `package.json.${ts}.bak`);
        const existing = fs.readFileSync(pkgPath);
        fs.writeFileSync(bakPath, existing);
        console.log('🗂️ Backup created (package.json):', bakPath);
      } catch (e) {
        console.warn('Backup failed for package.json:', e.message);
      }
    }

    fs.writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2), 'utf-8');

    // Create .vibeide directory and config.json
    const vibeideDir = path.join(projectPath, '.vibeide');
    if (!fs.existsSync(vibeideDir)) {
      fs.mkdirSync(vibeideDir, { recursive: true });
    }
    
    const configJson = {
      projectName: path.basename(projectPath),
      version: '1.0.0',
      template: template,
      genre: selectedGenre,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString()
    };
    
    const configPath = path.join(vibeideDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(configJson, null, 2), 'utf-8');
    console.log('✅ Created .vibeide/config.json with genre:', selectedGenre);

    return { success: true, path: projectPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('bundle:esbuild', async (event, { entryPath, projectRoot }) => {
  try {
    let esbuild;
    try {
      esbuild = require('esbuild');
    } catch (e) {
      return { success: false, error: 'esbuild not installed. Run: npm i -D esbuild' };
    }

    const absRoot = projectRoot || process.cwd();
    const absEntry = path.isAbsolute(entryPath) ? entryPath : path.join(absRoot, entryPath);

    // Build a virtual entry that ensures config.js (if present) is loaded first (for projects relying on globals)
    let combined = '';
    try {
      const configPath = path.join(absRoot, 'src', 'config.js');
      if (fs.existsSync(configPath)) {
        combined += `import "./src/config.js";\n`;
      }
    } catch {}
    combined += `import "${absEntry.replace(/\\/g, '/')}";\n`;

    const result = await esbuild.build({
      absWorkingDir: absRoot,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      sourcemap: 'inline',
      write: false,
      stdin: {
        contents: combined,
        loader: 'js',
        resolveDir: absRoot,
        sourcefile: '__gf_entry__.js'
      },
      loader: {
        '.png': 'dataurl',
        '.jpg': 'dataurl',
        '.jpeg': 'dataurl',
        '.svg': 'text',
        '.mp3': 'dataurl',
        '.ogg': 'dataurl',
        '.wav': 'dataurl',
        '.json': 'json'
      }
    });

    const outFile = result.outputFiles && result.outputFiles[0];
    if (!outFile) {
      return { success: false, error: 'No output from esbuild' };
    }

    return { success: true, code: outFile.text };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('preview:openExternal', async (event, { htmlContent }) => {
  try {
    const tempDir = app.getPath('temp');
    const filePath = path.join(tempDir, `gameforge-preview-${Date.now()}.html`);
    fs.writeFileSync(filePath, htmlContent, 'utf-8');
    const { shell } = require('electron');
    await shell.openPath(filePath);
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Run npm scripts (journal:html, journal:pdf)
ipcMain.handle('run:npmScript', async (event, { script, outDir }) => {
  return new Promise((resolve) => {
    try {
      const cwd = process.cwd();
      const args = ['run', script, '--silent', '--', `--outDir=${outDir||''}`];
      const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, shell: false });
      let out = '';
      let err = '';
      child.stdout.on('data', d => out += d.toString());
      child.stderr.on('data', d => err += d.toString());
      child.on('close', code => {
        resolve({ success: code === 0, code, out, err });
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
});

// Genre Rules and Project Config IPC Handlers
ipcMain.handle('project:loadConfig', async (event, projectPath) => {
  try {
    const configPath = path.join(projectPath, '.vibeide', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return { success: true, config };
    }
    return { success: false, error: 'Config file not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project:saveConfig', async (event, projectPath, config) => {
  try {
    const vibeideDir = path.join(projectPath, '.vibeide');
    if (!fs.existsSync(vibeideDir)) {
      fs.mkdirSync(vibeideDir, { recursive: true });
    }
    const configPath = path.join(vibeideDir, 'config.json');
    config.lastModified = new Date().toISOString();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('genre:loadRule', async (event, genreName, options = {}) => {
  try {
    // Try user folder first (~/.vibeide/genre-rules/)
    const os = require('os');
    const userRulesPath = path.join(os.homedir(), '.vibeide', 'genre-rules', `${genreName}.json`);
    
    // Try bundled rules (app/templates/genre-rules/)
    const appPath = app.getAppPath();
    const bundledRulesPath = path.join(appPath, 'templates', 'genre-rules', `${genreName}.json`);
    
    const source = options && options.source ? options.source : 'auto';
    const userExists = fs.existsSync(userRulesPath);
    const bundledExists = fs.existsSync(bundledRulesPath);
    
    let rulePath = null;
    if (source === 'user') {
      if (userExists) rulePath = userRulesPath;
    } else if (source === 'bundled') {
      if (bundledExists) rulePath = bundledRulesPath;
    } else {
      if (userExists) rulePath = userRulesPath;
      else if (bundledExists) rulePath = bundledRulesPath;
    }
    
    if (rulePath) {
      const rule = JSON.parse(fs.readFileSync(rulePath, 'utf-8'));
      const sourceType = rulePath === userRulesPath ? 'user' : 'bundled';
      return { success: true, rule, source: sourceType, userExists, bundledExists };
    }
    
    return { success: false, error: 'Genre rule not found', userExists, bundledExists };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('genre:listAvailable', async () => {
  try {
    const os = require('os');
    const appPath = app.getAppPath();
    const bundledRulesPath = path.join(appPath, 'templates', 'genre-rules');
    const userRulesPath = path.join(os.homedir(), '.vibeide', 'genre-rules');
    
    const genreMap = new Map();
    
    // Load bundled genres
    if (fs.existsSync(bundledRulesPath)) {
      const files = fs.readdirSync(bundledRulesPath);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          const name = file.replace('.json', '');
          genreMap.set(name, {
            name,
            isBundled: true,
            hasOverride: false,
            source: 'bundled'
          });
        }
      });
    }
    
    // Load user genres
    if (fs.existsSync(userRulesPath)) {
      const files = fs.readdirSync(userRulesPath);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          const name = file.replace('.json', '');
          const existing = genreMap.get(name) || { name, isBundled: false, hasOverride: false };
          existing.hasOverride = true;
          existing.source = existing.isBundled ? 'bundled+override' : 'custom';
          genreMap.set(name, existing);
        }
      });
    }
    
    const genres = Array.from(genreMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    
    return { success: true, genres };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('genre:saveRule', async (event, genreName, ruleData) => {
  try {
    const os = require('os');
    const userRulesDir = path.join(os.homedir(), '.vibeide', 'genre-rules');
    if (!fs.existsSync(userRulesDir)) {
      fs.mkdirSync(userRulesDir, { recursive: true });
    }
    const targetPath = path.join(userRulesDir, `${genreName}.json`);
    
    // backup existing override
    if (fs.existsSync(targetPath)) {
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(targetPath, `${targetPath}.${ts}.bak`);
      } catch (bakErr) {
        console.warn('Failed to backup genre rule:', bakErr.message);
      }
    }
    
    const serialized = typeof ruleData === 'string' ? ruleData : JSON.stringify(ruleData, null, 2);
    fs.writeFileSync(targetPath, serialized, 'utf-8');
    return { success: true, path: targetPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('genre:deleteRule', async (event, genreName) => {
  try {
    const os = require('os');
    const userRulesPath = path.join(os.homedir(), '.vibeide', 'genre-rules', `${genreName}.json`);
    if (fs.existsSync(userRulesPath)) {
      fs.unlinkSync(userRulesPath);
      return { success: true };
    }
    return { success: false, error: 'Override not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handler for splash screen image path request
ipcMain.on('splash:request-path', (event) => {
  if (currentSplashImagePath) {
    event.sender.send('splash:image-path', currentSplashImagePath);
  }
});

// IPC handler for splash screen close
ipcMain.on('splash:close', () => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  // Show main window after splash closes
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
});

// Window control IPC handlers
ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('window:isMaximized', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.isMaximized();
  }
  return false;
});

// Register protocol to serve static files from node_modules
app.whenReady().then(() => {
  // Register protocol handler for node_modules
  protocol.registerFileProtocol('node', (request, callback) => {
    const url = request.url.substr(7); // Remove 'node://' prefix
    const filePath = path.join(__dirname, '../', url);
    callback(filePath);
  });

  // Register gf:// to serve files directly from disk using absolute paths
  try {
    protocol.registerFileProtocol('gf', (request, callback) => {
      try {
        const raw = request.url.substring('gf://'.length); // everything after scheme
        const decoded = decodeURIComponent(raw);
        // If starts with / or drive letter, use as absolute
        const absPath = decoded.match(/^\/[A-Za-z]:\//) ? decoded.slice(1) : decoded; // handle gf:///C:/...
        callback(absPath);
      } catch (e) {
        console.error('gf protocol error:', e);
        callback({ error: -2 });
      }
    });
    console.log('✅ gf:// protocol registered');
  } catch (e) {
    console.warn('Failed to register gf protocol:', e.message);
  }
  
  // Create splash window first, then main window
  createSplashWindow();
  createWindow(); // Create main window in background (hidden)

  app.on('activate', () => {
    // On macOS re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

