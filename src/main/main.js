const { app, BrowserWindow, Menu, protocol, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

console.log('═══════════════════════════════════════════════════════');
console.log('🚀 MAIN PROCESS STARTING - LOGGING TEST');
console.log('═══════════════════════════════════════════════════════');

// Initialize OpenAI client in main process
let openaiClient = null;
let openaiApiKey = null;

function loadOpenAIKey() {
  try {
    // Try to load from config file first
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, 'openai-config.json');
    console.log('🔍 Looking for OpenAI config at:', configPath);
    
    if (fs.existsSync(configPath)) {
      console.log('✅ Found config file');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.apiKey) {
        openaiApiKey = config.apiKey;
        console.log('✅ OpenAI API key loaded from config file');
        return true;
      } else {
        console.warn('⚠️ Config file exists but no apiKey found');
      }
    } else {
      console.warn('⚠️ Config file not found at:', configPath);
    }
    
    // Fall back to environment variable
    if (process.env.OPENAI_API_KEY) {
      openaiApiKey = process.env.OPENAI_API_KEY;
      console.log('✅ OpenAI API key loaded from environment variable');
      return true;
    }
    
    console.warn('⚠️ OpenAI API key not found. Create openai-config.json in:', userDataPath);
    console.warn('   Or set OPENAI_API_KEY environment variable');
    return false;
  } catch (error) {
    console.error('❌ Error loading OpenAI key:', error);
    console.error('   Error details:', error.message);
    return false;
  }
}

function initOpenAIClient() {
  try {
    if (!openaiApiKey) {
      if (!loadOpenAIKey()) {
        return false;
      }
    }
    
    const { OpenAI } = require('openai');
    openaiClient = new OpenAI({
      apiKey: openaiApiKey
    });
    console.log('✅ OpenAI client initialized in main process');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize OpenAI in main process:', error);
    return false;
  }
}

// Don't initialize here - wait for app to be ready
// initOpenAIClient() will be called in app.whenReady()

// Pixabay API
let pixabayApiKey = null;

function loadPixabayKey() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🔑 loadPixabayKey() FUNCTION CALLED');
  console.log('═══════════════════════════════════════════════════════');
  try {
    // app.getPath('userData') should be available after app.whenReady()
    const userDataPath = app.getPath('userData');
    console.log('📁 User data path:', userDataPath);
    
    // Check both possible locations (vibe-ide and VIBE IDE)
    const configPath1 = path.join(userDataPath, 'pixabay-config.json');
    const configPath2 = path.join(path.dirname(userDataPath), 'VIBE IDE', 'pixabay-config.json');
    
    let configPath = configPath1;
    // If default path doesn't exist, try the VIBE IDE folder
    if (!fs.existsSync(configPath1)) {
      console.log('⚠️ Config not found in default location, trying VIBE IDE folder...');
      if (fs.existsSync(configPath2)) {
        configPath = configPath2;
        console.log('✅ Found config in VIBE IDE folder');
      }
    }
    
    console.log('🔍 Looking for Pixabay config at:', configPath);
    console.log('   File exists:', fs.existsSync(configPath));
    
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      console.log('   File content length:', fileContent.length);
      console.log('   File content preview:', fileContent.substring(0, 100));
      const config = JSON.parse(fileContent);
      console.log('   Parsed config keys:', Object.keys(config));
      console.log('   apiKey exists:', !!config.apiKey);
      console.log('   apiKey value preview:', config.apiKey ? config.apiKey.substring(0, 10) + '...' : 'null');
      
      if (config.apiKey && config.apiKey.trim()) {
        pixabayApiKey = config.apiKey.trim();
        console.log('✅ Pixabay API key loaded from config file (length:', pixabayApiKey.length, ')');
        console.log('   Key value:', pixabayApiKey);
        console.log('   Global pixabayApiKey variable set:', !!pixabayApiKey);
        return true;
      } else {
        console.warn('⚠️ Config file exists but apiKey is empty or missing');
        console.warn('   Config object:', JSON.stringify(config, null, 2));
      }
    } else {
      console.warn('⚠️ Config file not found at:', configPath);
    }
    
    if (process.env.PIXABAY_API_KEY) {
      pixabayApiKey = process.env.PIXABAY_API_KEY.trim();
      console.log('✅ Pixabay API key loaded from environment variable (length:', pixabayApiKey.length, ')');
      return true;
    }
    
    console.warn('⚠️ Pixabay API key not found. Create pixabay-config.json in:', userDataPath);
    console.log('═══════════════════════════════════════════════════════');
    return false;
  } catch (error) {
    console.error('❌ Error loading Pixabay key:', error);
    console.error('   Error details:', error.message);
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    console.log('═══════════════════════════════════════════════════════');
    return false;
  }
}

async function searchPixabayImages(query, options = {}) {
  console.log('🔍 searchPixabayImages called with query:', query);
  if (!pixabayApiKey) {
    console.log('⚠️ Pixabay key not loaded, attempting to load...');
    const loaded = loadPixabayKey();
    if (!loaded || !pixabayApiKey) {
      console.error('❌ Failed to load Pixabay key');
      return { success: false, error: 'Pixabay API key not configured. Check main process console for details.' };
    }
  }
  console.log('✅ Using Pixabay key (length:', pixabayApiKey.length, ')');
  
  try {
    const https = require('https');
    const url = new URL('https://pixabay.com/api/');
    url.searchParams.set('key', pixabayApiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('image_type', options.imageType || 'all');
    url.searchParams.set('orientation', options.orientation || 'all');
    url.searchParams.set('safesearch', options.safesearch !== false ? 'true' : 'false');
    url.searchParams.set('per_page', options.perPage || 20);
    url.searchParams.set('page', options.page || 1);
    
    return new Promise((resolve, reject) => {
      https.get(url.toString(), (res) => {
        let data = '';
        
        // Check for HTTP errors
        if (res.statusCode !== 200) {
          res.on('data', () => {}); // Drain response
          res.on('end', () => {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${res.statusMessage || 'Request failed'}` });
          });
          return;
        }
        
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            // Check if Pixabay returned an error
            if (result.error) {
              resolve({ success: false, error: result.error });
            } else {
              resolve({ success: true, data: result });
            }
          } catch (error) {
            console.error('❌ Error parsing Pixabay response:', error);
            console.error('Response data:', data.substring(0, 500));
            resolve({ success: false, error: `Parse error: ${error.message}` });
          }
        });
      }).on('error', (error) => {
        console.error('❌ HTTPS request error:', error);
        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function searchPixabayVideos(query, options = {}) {
  console.log('🔍 searchPixabayVideos called with query:', query);
  if (!pixabayApiKey) {
    console.log('⚠️ Pixabay key not loaded, attempting to load...');
    const loaded = loadPixabayKey();
    if (!loaded || !pixabayApiKey) {
      console.error('❌ Failed to load Pixabay key');
      return { success: false, error: 'Pixabay API key not configured. Check main process console for details.' };
    }
  }
  console.log('✅ Using Pixabay key (length:', pixabayApiKey.length, ')');
  
  try {
    const https = require('https');
    const url = new URL('https://pixabay.com/api/videos/');
    url.searchParams.set('key', pixabayApiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('video_type', options.videoType || 'all');
    url.searchParams.set('safesearch', options.safesearch !== false ? 'true' : 'false');
    url.searchParams.set('per_page', options.perPage || 20);
    url.searchParams.set('page', options.page || 1);
    
    return new Promise((resolve, reject) => {
      https.get(url.toString(), (res) => {
        let data = '';
        
        if (res.statusCode !== 200) {
          res.on('data', () => {});
          res.on('end', () => {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${res.statusMessage || 'Request failed'}` });
          });
          return;
        }
        
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              resolve({ success: false, error: json.error });
            } else {
              resolve({ success: true, hits: json.hits || [], total: json.total || 0 });
            }
          } catch (parseError) {
            resolve({ success: false, error: `Failed to parse response: ${parseError.message}` });
          }
        });
      }).on('error', (error) => {
        resolve({ success: false, error: `Network error: ${error.message}` });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function searchPixabayAudio(query, options = {}) {
  console.log('🔍 searchPixabayAudio called with query:', query, 'options:', options);
  if (!pixabayApiKey) {
    console.log('⚠️ Pixabay key not loaded, attempting to load...');
    const loaded = loadPixabayKey();
    if (!loaded || !pixabayApiKey) {
      console.error('❌ Failed to load Pixabay key');
      return { success: false, error: 'Pixabay API key not configured. Check main process console for details.' };
    }
  }
  console.log('✅ Using Pixabay key (length:', pixabayApiKey.length, ')');
  
  try {
    const https = require('https');
    // Pixabay Audio API endpoint
    const url = new URL('https://pixabay.com/api/');
    url.searchParams.set('key', pixabayApiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('audio_type', options.category === 'music' ? 'music' : 'all'); // 'music' or 'all' (includes sound effects)
    url.searchParams.set('safesearch', options.safesearch !== false ? 'true' : 'false');
    url.searchParams.set('per_page', options.perPage || 20);
    url.searchParams.set('page', options.page || 1);
    
    return new Promise((resolve, reject) => {
      https.get(url.toString(), (res) => {
        let data = '';
        
        if (res.statusCode !== 200) {
          res.on('data', () => {});
          res.on('end', () => {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${res.statusMessage || 'Request failed'}` });
          });
          return;
        }
        
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              resolve({ success: false, error: json.error });
            } else {
              // Pixabay audio API returns hits with audio-specific fields
              const audioHits = (json.hits || []).map(audio => ({
                id: audio.id,
                tags: audio.tags,
                duration: audio.duration || 0,
                url: audio.url || audio.audio_url || audio.preview_url,
                type: audio.type || 'mpeg',
                user: audio.user,
                title: audio.title || audio.tags,
                format: audio.format || 'mp3',
                bitrate: audio.bitrate || 0,
                sample_rate: audio.sample_rate || 0
              }));
              resolve({ success: true, hits: audioHits, total: json.total || 0 });
            }
          } catch (parseError) {
            console.error('❌ Error parsing Pixabay audio response:', parseError);
            console.error('Response data:', data.substring(0, 500));
            resolve({ success: false, error: `Failed to parse response: ${parseError.message}` });
          }
        });
      }).on('error', (error) => {
        console.error('❌ HTTPS request error:', error);
        resolve({ success: false, error: `Network error: ${error.message}` });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

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

ipcMain.handle('fs:rename', async (event, oldPath, newPath) => {
  try {
    // Check if new path already exists
    if (fs.existsSync(newPath)) {
      return { success: false, error: 'A file or folder with that name already exists' };
    }
    
    // Ensure parent directory exists
    const parentDir = path.dirname(newPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    
    fs.renameSync(oldPath, newPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Download file from URL
ipcMain.handle('fs:downloadFile', async (event, url, filePath) => {
  try {
    const https = require('https');
    const http = require('http');
    const urlModule = require('url');
    
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const parsedUrl = urlModule.parse(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    return new Promise((resolve) => {
      const file = fs.createWriteStream(filePath);
      
      protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          file.close();
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath); // Delete the file on error
          }
          resolve({ success: false, error: `HTTP ${response.statusCode}: ${response.statusMessage || 'Download failed'}` });
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve({ success: true, path: filePath });
        });
      }).on('error', (error) => {
        file.close();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project:create', async (event, template, projectPath, genre = null) => {
  try {
    // Template to genre mapping (infer genre from template if not specified)
    const templateToGenre = {
      blank: null,
      'web-app': null,
      'python-beginner': null,
      'data-analysis': null,
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
        name: 'Blank Project',
        description: 'Start from scratch with a clean slate',
        icon: '📄',
        files: {
          'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Project</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: #1e1e1e;
            color: #fff;
        }
    </style>
</head>
<body>
    <h1>Hello, World!</h1>
    <p>Start coding here!</p>
    <script>
        console.log('Welcome to VIBE IDE!');
    </script>
</body>
</html>`
        }
      },
      'web-app': {
        name: 'Web App',
        description: 'HTML, CSS, and JavaScript web application',
        icon: '🌐',
        files: {
          'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Web App</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>Welcome to My Web App!</h1>
        <button id="myButton">Click Me!</button>
        <p id="output"></p>
    </div>
    <script src="script.js"></script>
</body>
</html>`,
          'styles.css': `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
}

.container {
    background: white;
    padding: 40px;
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    text-align: center;
}

h1 {
    color: #333;
    margin-bottom: 20px;
}

button {
    background: #667eea;
    color: white;
    border: none;
    padding: 12px 24px;
    font-size: 16px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.3s;
}

button:hover {
    background: #5568d3;
}

#output {
    margin-top: 20px;
    color: #666;
}`,
          'script.js': `// Your JavaScript code here
document.getElementById('myButton').addEventListener('click', function() {
    const output = document.getElementById('output');
    output.textContent = 'Button clicked! 🎉';
    output.style.color = '#667eea';
});`
        }
      },
      'python-beginner': {
        name: 'Python Beginner',
        description: 'Simple Python script to learn the basics',
        icon: '🐍',
        files: {
          'main.py': `# Welcome to Python!
# This is a comment - Python ignores these lines

# Variables store information
name = "World"
age = 10

# Print to the console
print(f"Hello, {name}!")
print(f"You are {age} years old!")

# Functions are reusable blocks of code
def greet(name):
    return f"Hello, {name}! Welcome to Python!"

# Call the function
message = greet("Cursy")
print(message)

# Lists store multiple items
fruits = ["apple", "banana", "orange"]
print("My favorite fruits:", fruits)

# Loops repeat code
print("\\nCounting to 5:")
for i in range(1, 6):
    print(i)

# Conditionals make decisions
number = 7
if number > 5:
    print(f"{number} is greater than 5!")
else:
    print(f"{number} is not greater than 5!")`
        }
      },
      platformer: {
        name: 'Platformer Game',
        description: '2D platformer game with Phaser.js',
        icon: '🎮',
        files: {
          'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Platformer Game</title>
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js"></script>
</head>
<body>
    <script src="game.js"></script>
</body>
</html>`,
          'game.js': `// Platformer Template
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 800 },
            debug: false
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

function preload() {
    // Create a simple colored rectangle as player sprite
    this.add.graphics()
        .fillStyle(0x00ff00)
        .fillRect(0, 0, 64, 64)
        .generateTexture('player', 64, 64);
    
    // Create platform sprite
    this.add.graphics()
        .fillStyle(0x8b4513)
        .fillRect(0, 0, 200, 32)
        .generateTexture('platform', 200, 32);
}

function create() {
    // Add player
    this.player = this.physics.add.sprite(100, 100, 'player');
    this.player.setCollideWorldBounds(true);
    
    // Add platforms
    this.platforms = this.physics.add.staticGroup();
    this.platforms.create(400, 500, 'platform');
    this.platforms.create(200, 400, 'platform');
    this.platforms.create(600, 300, 'platform');
    
    // Collision between player and platforms
    this.physics.add.collider(this.player, this.platforms);
    
    // Keyboard controls
    this.cursors = this.input.keyboard.createCursorKeys();
}

function update() {
    // Left/Right movement
    if (this.cursors.left.isDown) {
        this.player.setVelocityX(-200);
    } else if (this.cursors.right.isDown) {
        this.player.setVelocityX(200);
    } else {
        this.player.setVelocityX(0);
    }
    
    // Jump (only when touching ground)
    if (this.cursors.up.isDown && this.player.body.touching.down) {
        this.player.setVelocityY(-600);
    }
}`
        }
      },
      'data-analysis': {
        name: 'Data Analysis',
        description: 'Python project for analyzing data',
        icon: '📊',
        files: {
          'main.py': `# Data Analysis Project
import json

# Sample data
data = [
    {"name": "Alice", "age": 25, "score": 85},
    {"name": "Bob", "age": 30, "score": 92},
    {"name": "Charlie", "age": 28, "score": 78},
    {"name": "Diana", "age": 35, "score": 95}
]

# Calculate average score
total_score = sum(person["score"] for person in data)
average_score = total_score / len(data)

print(f"Average Score: {average_score:.2f}")

# Find highest scorer
highest = max(data, key=lambda x: x["score"])
print(f"\\nHighest Scorer: {highest['name']} with {highest['score']} points")

# Group by age ranges
age_groups = {"20-29": [], "30-39": []}
for person in data:
    if 20 <= person["age"] < 30:
        age_groups["20-29"].append(person)
    elif 30 <= person["age"] < 40:
        age_groups["30-39"].append(person)

print("\\nAge Groups:")
for group, people in age_groups.items():
    print(f"{group}: {len(people)} people")`
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

    // Create package.json (only for web-based projects)
    let packageJson = null;
    if (template === 'platformer' || template === 'web-app' || template === 'blank') {
      packageJson = {
        name: path.basename(projectPath),
        version: '1.0.0',
        description: 'Project created with VIBE IDE',
        main: template === 'platformer' ? 'game.js' : 'index.html',
        scripts: {
          start: 'npx http-server -p 8080'
        }
      };
      
      // Only add Phaser for game templates
      if (template === 'platformer') {
        packageJson.dependencies = {
          phaser: '^3.90.0'
        };
      }
    }

    // Only create package.json for web-based projects
    if (packageJson) {
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
    }

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

    // Copy Agent_Persona.md to new project (if source exists)
    const personaSourcePath = path.join(__dirname, '..', '..', '..', 'Phaser', 'The Final Attack - Resurgence', 'Agent_Persona.md');
    const personaDestPath = path.join(projectPath, 'Agent_Persona.md');
    if (fs.existsSync(personaSourcePath)) {
      try {
        const personaContent = fs.readFileSync(personaSourcePath, 'utf-8');
        fs.writeFileSync(personaDestPath, personaContent, 'utf-8');
        console.log('✅ Copied Agent_Persona.md to project');
      } catch (error) {
        console.warn('⚠️ Failed to copy Agent_Persona.md:', error.message);
      }
    } else {
      // Create a default Agent_Persona.md if source doesn't exist
      const defaultPersona = `# Agent Persona — "Cursy"

## Snapshot
- **Role:** Hyper-enthusiastic copilot for the FutureVision / Forge universe
- **Vibe:** Futurist arcade DJ meets collaborative project lead
- **Mission:** Keep momentum high, surface smart trade-offs, celebrate wins

## Voice & Tone
- Energetic, emoji-friendly, but always actionable (\`Let's rocket 🛠️🚀\`)
- Mirrors the user's hype; matches informality without losing clarity
- Drops quick summaries before diving into detail; confident but never bossy

## Interaction Principles
1. **Momentum First** – Offer the next micro-step ("Here's the tweak + quick test idea").
2. **Context Glue** – Cross-reference previous work so decisions feel connected.
3. **Default Optimism** – Assume the build can be awesome; flag risks calmly.
4. **Transparent Reasoning** – Share the "why," especially when making judgement calls.
5. **Celebrate Progress** – Highlight shiny wins ("Boss launch looks savage now!").

## Signature Moves & Phrases
- "gooooooooooooo!" / "Let's rocket!" for launch moments
- "Small tweak time!" for incremental changes
- "Vibe check:" to introduce quick status bullets
- Emojis as seasoning, not filler (sparingly in technical blocks)

Keep this page updated whenever the tone evolves so future sessions keep the same co-op groove.
`;
      fs.writeFileSync(personaDestPath, defaultPersona, 'utf-8');
      console.log('✅ Created default Agent_Persona.md in project');
    }

    // Create PROJECT_JOURNAL.md template
    const journalPath = path.join(projectPath, 'PROJECT_JOURNAL.md');
    const projectName = path.basename(projectPath);
    const journalTemplate = `# 🚀 Project Journal

> **Purpose:** This file maintains context across AI assistant sessions. Cursy can read and update this automatically!

---

## 📋 Project Information

**Project Name:** ${projectName}

**Developer(s):** [Your name(s)]

**Project Type:** ${selectedTemplate.name || 'Custom Project'}

**Tech Stack:** [Languages, frameworks, libraries]

**Start Date:** ${new Date().toLocaleDateString()}

**Repository:** [Git URL if applicable]

---

## 🎯 Project Overview

**What does this project do?**
[Brief description of the project's purpose and goals]

**Key Features:**
- [ ] Feature 1
- [ ] Feature 2
- [ ] Feature 3

**Target Audience/Platform:**
[Who/what is this for? Desktop, mobile, specific users?]

---

## 📅 Recent Work Sessions

### Session: ${new Date().toLocaleDateString()}

**What we accomplished:**
- ✅ Project created with ${selectedTemplate.name || template} template

**Key decisions made:**
1. [Decision and reasoning]

**Problems encountered:**
- [None yet]

**Code changes:**
- [Initial project setup]

---

## 🔴 Current Status & Blockers

### Active Issues
[None yet]

### Working Features
- ✅ Project structure created
- ✅ Template files initialized

### Known Bugs
[None yet]

---

## 🎯 Next Steps

**Immediate priorities:**
1. [ ] [Next task]
2. [ ] [Next task]
3. [ ] [Next task]

**Future enhancements:**
- [ ] [Nice-to-have feature]
- [ ] [Nice-to-have feature]

**Questions to resolve:**
- ❓ [Question or decision needed]

---

## 📁 Project Structure

**Key Files:**
${Object.keys(selectedTemplate.files).map(file => `- \`${file}\` - [What this file does]`).join('\n')}

**Key Directories:**
- [Directory structure will be documented as project grows]

---

## ⚙️ Setup & Running

**Initial Setup:**
\`\`\`bash
# Installation commands
${packageJson ? 'npm install' : '# Add setup instructions here'}
\`\`\`

**Development:**
\`\`\`bash
# How to run in dev mode
${packageJson ? 'npm start' : '# Add dev commands here'}
\`\`\`

---

## 🔧 Technical Notes

**Important Patterns/Conventions:**
- [Coding style or pattern we're using]
- [Naming conventions]
- [Architecture decisions]

**Dependencies to know:**
${packageJson && packageJson.dependencies ? Object.keys(packageJson.dependencies).map(dep => `- \`${dep}\` - [Why we use this]`).join('\n') : '- [Dependencies will be documented here]'}

---

## 🎓 Instructions for AI Assistants

**When starting a session:**
1. ✅ Read this file completely
2. ✅ Check "Current Status & Blockers" 
3. ✅ Review "Next Steps"
4. ✅ Ask developer what they want to work on
5. ✅ Update this file as work progresses

**When ending a session:**
1. ✅ Update "Recent Work Sessions" with today's work
2. ✅ Update "Current Status & Blockers"
3. ✅ Update "Next Steps" 
4. ✅ Note any new technical details in relevant sections

**Remember:**
- This file is the project's memory
- Keep it updated and accurate
- Be specific about file paths and changes
- Document WHY decisions were made, not just WHAT was done
`;
    fs.writeFileSync(journalPath, journalTemplate, 'utf-8');
    console.log('✅ Created PROJECT_JOURNAL.md in project');

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

// OpenAI IPC Handler (Phase 2)
ipcMain.handle('openai:chat', async (event, { messages, systemPrompt, maxTokens }) => {
  try {
    if (!openaiClient) {
      // Try to initialize if not already done
      if (!initOpenAIClient()) {
        return { success: false, error: 'OpenAI client not initialized' };
      }
    }

    // Build messages array with system prompt
    const chatMessages = [
      {
        role: 'system',
        content: systemPrompt || 'You are Cursy, a friendly and enthusiastic AI coding assistant for VIBE IDE.'
      },
      ...messages
    ];

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: maxTokens || 1000
    });

    const aiResponse = response.choices[0].message.content;
    return { success: true, content: aiResponse };
  } catch (error) {
    console.error('OpenAI API error:', error);
    return { 
      success: false, 
      error: error.message,
      status: error.status || 500
    };
  }
});

// Pixabay API IPC handlers
console.log('📝 Registering Pixabay IPC handlers...');
ipcMain.handle('pixabay:searchImages', async (event, { query, options }) => {
  return await searchPixabayImages(query, options);
});

ipcMain.handle('pixabay:searchVideos', async (event, { query, options }) => {
  return await searchPixabayVideos(query, options);
});

ipcMain.handle('pixabay:searchAudio', async (event, { query, options }) => {
  return await searchPixabayAudio(query, options);
});

ipcMain.handle('pixabay:checkStatus', async () => {
  try {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔍 PIXABAY STATUS CHECK CALLED');
    console.log('═══════════════════════════════════════════════════════');
    console.log('Current key state:', !!pixabayApiKey);
    console.log('Key variable type:', typeof pixabayApiKey);
    
    // Always try to load the key if it's not already loaded
    if (!pixabayApiKey) {
      console.log('⚠️ Key not loaded, attempting to load...');
      const loaded = loadPixabayKey();
      console.log('🔍 loadPixabayKey() returned:', loaded);
      console.log('🔍 Key exists after load:', !!pixabayApiKey);
      if (loaded && pixabayApiKey) {
        console.log('✅ Key loaded successfully, length:', pixabayApiKey.length);
      } else {
        console.error('❌ Failed to load key');
      }
    } else {
      console.log('✅ Key already loaded, length:', pixabayApiKey.length);
    }
    
    // Get paths (ensure app is ready)
    let userDataPath = 'unknown';
    let configPath = 'unknown';
    try {
      userDataPath = app.getPath('userData');
      configPath = path.join(userDataPath, 'pixabay-config.json');
      console.log('📁 User data path:', userDataPath);
      console.log('📁 Config path:', configPath);
      console.log('📁 Config file exists:', fs.existsSync(configPath));
    } catch (error) {
      console.error('❌ Error getting paths:', error);
      console.error('   Error message:', error.message);
      console.error('   Error stack:', error.stack);
    }
    
    const result = { 
      available: !!pixabayApiKey,
      hasKey: !!pixabayApiKey,
      keyLength: pixabayApiKey ? pixabayApiKey.length : 0,
      userDataPath: userDataPath,
      configPath: configPath,
      fileExists: fs.existsSync ? fs.existsSync(configPath) : false
    };
    
    console.log('Returning result:', JSON.stringify(result, null, 2));
    console.log('═══════════════════════════════════════════════════════');
    
    return result;
  } catch (error) {
    console.error('❌ ERROR in pixabay:checkStatus handler:', error);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    return {
      available: false,
      hasKey: false,
      keyLength: 0,
      userDataPath: 'error',
      configPath: 'error',
      error: error.message
    };
  }
});

ipcMain.handle('openai:checkStatus', async () => {
  const userDataPath = app.getPath('userData');
  const configPath = path.join(userDataPath, 'openai-config.json');
  const configExists = fs.existsSync(configPath);
  
  return {
    initialized: !!openaiClient,
    hasApiKey: !!openaiApiKey,
    userDataPath: userDataPath,
    configPath: configPath,
    configExists: configExists,
    hasEnvVar: !!process.env.OPENAI_API_KEY
  };
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
  
  // Initialize OpenAI client now that app is ready
  initOpenAIClient();
  
  // Load Pixabay API key now that app is ready
  console.log('═══════════════════════════════════════════════════════');
  console.log('🚀 APP READY - Loading Pixabay key on startup');
  console.log('═══════════════════════════════════════════════════════');
  console.log('BEFORE loadPixabayKey() - pixabayApiKey:', pixabayApiKey);
  const pixabayLoaded = loadPixabayKey();
  console.log('Pixabay key loaded on startup:', pixabayLoaded);
  console.log('AFTER loadPixabayKey() - pixabayApiKey:', pixabayApiKey);
  console.log('Key exists after startup load:', !!pixabayApiKey);
  console.log('Key length:', pixabayApiKey ? pixabayApiKey.length : 0);
  console.log('═══════════════════════════════════════════════════════');
  
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

