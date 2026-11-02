const { app, BrowserWindow, Menu, protocol, dialog, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

console.log('═══════════════════════════════════════════════════════');
console.log('🚀 MAIN PROCESS STARTING - LOGGING TEST');
console.log('═══════════════════════════════════════════════════════');

const {
  searchProjectRecall,
  listRecentCmlFiles,
  rebuildChatHistoryFromCml,
  collectRecallChunks,
  buildRecallFingerprint,
  loadRecallIndex,
  saveRecallIndex,
  RECALL_INDEX_VERSION,
} = require('./project-recall');
const {
  runAgentStep,
  proposeSingleFileWrite,
  commitAgentWrite,
  evaluateWriteForApproval,
  DEFAULT_MAX_STEPS,
} = require('./local-agent');
const { enrichShipPlanFromSearch, grepProject, findFiles } = require('./project-search');
const { getGeminiLiveWsUrl } = require('./gemini-live');
const { transcribeLiveAudioBlob } = require('./gemini-live-transcribe');
const { startRendererStaticServer } = require('./renderer-static-server');
const projectCatalog = require('./project-catalog');
const {
  openPreviewPopout,
  sendPreviewPopoutMessage,
  isPreviewPopoutOpen,
  closePreviewPopout,
} = require('./preview-popout');
const { startTestBridge } = require('./test-bridge');

const testBridgeEnabled =
  process.argv.includes('--test-bridge') || process.env.VIBE_TEST_BRIDGE === '1';
let testBridgeServer = null;

// Optional: VIBE_DISABLE_GPU=1 or --disable-gpu when Monaco scroll/repaint glitches on Windows
if (process.argv.includes('--disable-gpu') || process.env.VIBE_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  console.log('[VIBE IDE] Hardware acceleration disabled (Monaco repaint test mode)');
}

const {
  GEMINI_MODEL,
  chatGemini,
  ensureGeminiClient,
  getGeminiStatus,
  saveGeminiApiKey,
} = require('./cloud-llm-client');

// Pixabay API (for images/videos)
let pixabayApiKey = null;

// Freesound API (for music/SFX)
let freesoundApiKey = null;
let freesoundClientId = null;

function loadFreesoundKey() {
  try {
    // Load from project root - this is a built-in feature, not user config
    const projectRoot = path.join(__dirname, '..', '..'); // Go up from src/main to project root
    const configPath = path.join(projectRoot, 'freesound-config.json');
    
    if (fs.existsSync(configPath)) {
      console.log('✅ Found Freesound config at:', configPath);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.apiKey) {
        freesoundApiKey = config.apiKey.trim();
        console.log('✅ Freesound API key loaded (length:', freesoundApiKey.length, ')');
      }
      if (config.clientId) {
        freesoundClientId = config.clientId.trim();
        console.log('✅ Freesound Client ID loaded (length:', freesoundClientId.length, ')');
      }
      if (freesoundApiKey) {
        return true;
      } else {
        console.warn('⚠️ Config file exists but no apiKey found');
      }
    } else {
      console.warn('⚠️ Freesound config not found at:', configPath);
    }
    
    // Fall back to environment variables (for development)
    if (process.env.FREESOUND_API_KEY) {
      freesoundApiKey = process.env.FREESOUND_API_KEY.trim();
      console.log('✅ Freesound API key loaded from environment variable');
    }
    if (process.env.FREESOUND_CLIENT_ID) {
      freesoundClientId = process.env.FREESOUND_CLIENT_ID.trim();
      console.log('✅ Freesound Client ID loaded from environment variable');
    }
    
    if (freesoundApiKey) {
      return true;
    }
    
    console.warn('⚠️ Freesound API key not configured. Create freesound-config.json in project root.');
    return false;
  } catch (error) {
    console.error('❌ Error loading Freesound key:', error);
    console.error('   Error details:', error.message);
    return false;
  }
}

function loadPixabayKey() {
  try {
    // Try to load from config file first
    const userDataPath = app.getPath('userData');
    
    // Check both possible paths (vibe-ide and VIBE IDE)
    const possiblePaths = [
      path.join(userDataPath, 'pixabay-config.json'),
      path.join(path.dirname(userDataPath), 'VIBE IDE', 'pixabay-config.json')
    ];
    
    // Also check if userDataPath itself might be different case
    if (userDataPath.toLowerCase().includes('vibe')) {
      const altPath = userDataPath.replace(/vibe-ide/i, 'VIBE IDE');
      if (altPath !== userDataPath) {
        possiblePaths.push(path.join(altPath, 'pixabay-config.json'));
      }
    }
    
    console.log('🔍 Looking for Pixabay config in possible paths:');
    possiblePaths.forEach(p => console.log('   -', p));
    
    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        console.log('✅ Found config file at:', configPath);
        let raw = fs.readFileSync(configPath, 'utf-8');
        if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
        const config = JSON.parse(raw);
        if (config.apiKey) {
          pixabayApiKey = config.apiKey.trim();
          console.log('✅ Pixabay API key loaded from config file (length:', pixabayApiKey.length, ')');
          return true;
        } else {
          console.warn('⚠️ Config file exists but no apiKey found');
        }
      }
    }
    
    console.warn('⚠️ Config file not found in any of the checked paths');
    
    // Fall back to environment variable
    if (process.env.PIXABAY_API_KEY) {
      pixabayApiKey = process.env.PIXABAY_API_KEY.trim();
      console.log('✅ Pixabay API key loaded from environment variable');
      return true;
    }
    
    console.warn('⚠️ Pixabay API key not found. Create pixabay-config.json in:', userDataPath);
    return false;
  } catch (error) {
    console.error('❌ Error loading Pixabay key:', error);
    console.error('   Error details:', error.message);
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
  // Redirect to Freesound for actual audio search
  return await searchFreesoundAudio(query, options);
}

async function searchFreesoundAudio(query, options = {}) {
  console.log('🔍 searchFreesoundAudio called with query:', query, 'options:', options);
  if (!freesoundApiKey) {
    console.log('⚠️ Freesound key not loaded, attempting to load...');
    const loaded = loadFreesoundKey();
    if (!loaded || !freesoundApiKey) {
      console.error('❌ Failed to load Freesound key');
      return { success: false, error: 'Freesound API key not configured. Create freesound-config.json in your user data folder. Get your API key from https://freesound.org/apiv2/apply/' };
    }
  }
  console.log('✅ Using Freesound key (length:', freesoundApiKey.length, ')');
  
  try {
    const https = require('https');
    // Freesound API v2 search endpoint
    const url = new URL('https://freesound.org/apiv2/search/text/');
    url.searchParams.set('query', query);
    url.searchParams.set('token', freesoundApiKey);
    url.searchParams.set('page_size', options.perPage || 20);
    url.searchParams.set('page', options.page || 1);
    url.searchParams.set('fields', 'id,name,tags,description,username,previews,duration,download,license,type');
    
    // Build filter string
    let filterParts = [];
    
    // Filter by category if specified
    if (options.category === 'music') {
      filterParts.push('tag:music OR tag:ambient OR tag:background');
    } else if (options.category === 'soundEffects' || options.category === 'sfx') {
      filterParts.push('tag:sfx OR tag:sound-effect OR tag:effect');
    }
    
    // Add duration filter if specified (minDuration in seconds)
    if (options.minDuration) {
      filterParts.push(`duration:[${options.minDuration} TO *]`);
    }
    
    // Set filter if we have any filter parts
    if (filterParts.length > 0) {
      url.searchParams.set('filter', filterParts.join(' AND '));
    }
    
    return new Promise((resolve, reject) => {
      // Freesound API uses token in query params, not Authorization header
      const requestOptions = {
        hostname: 'freesound.org',
        path: url.pathname + '?' + url.searchParams.toString(),
        method: 'GET'
      };
      
      https.get(requestOptions, (res) => {
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
            if (json.detail) {
              // Freesound returns errors in 'detail' field
              resolve({ success: false, error: json.detail });
            } else if (json.results) {
              // Convert Freesound results to our audio format
              const audioHits = (json.results || []).map(sound => {
                // Get preview URL (MP3 preview)
                const previews = sound.previews || {};
                const previewUrl = previews['preview-hq-mp3'] || previews['preview-lq-mp3'] || previews['preview-hq-ogg'] || previews['preview-lq-ogg'] || '';
                
                return {
                  id: sound.id,
                  tags: sound.tags ? sound.tags.join(', ') : '',
                  duration: sound.duration || 0,
                  url: previewUrl, // Preview URL (MP3)
                  audio_url: previewUrl, // Same as url for compatibility
                  download_url: sound.download || '', // Full download URL (requires OAuth for some)
                  type: sound.type || 'audio/mpeg',
                  user: sound.username || 'Unknown',
                  title: sound.name || 'Untitled',
                  description: sound.description || '',
                  format: sound.type || 'mp3',
                  license: sound.license || '',
                  // Freesound-specific fields
                  sound_id: sound.id,
                  freesound_url: `https://freesound.org/people/${sound.username}/sounds/${sound.id}/`
                };
              });
              resolve({ 
                success: true, 
                hits: audioHits, 
                total: json.count || 0,
                next: json.next || null,
                previous: json.previous || null
              });
            } else {
              resolve({ success: false, error: 'Unexpected response format from Freesound API' });
            }
          } catch (parseError) {
            console.error('❌ Error parsing Freesound response:', parseError);
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
/** Main UI: file:// (Monaco). Mic bridge: http://127.0.0.1 (voice-mic-bridge.html). */
let rendererStaticServer = null;
/** Full shell on localhost — debug only (--renderer-http). */
let rendererIndexUrl = null;
/** Always-on when server starts — mic bridge path. */
let rendererHttpBase = null;

function preferHttpRenderer() {
  return process.env.VIBE_RENDERER_HTTP === '1' || process.argv.includes('--renderer-http');
}
const windowStateFile = path.join(app.getPath('userData'), 'window-state.json');

function cursyChatHistoryPath() {
  return path.join(app.getPath('userData'), 'cursy-chat-history.json');
}

function loadCursyChatHistoryFromDisk() {
  try {
    const file = cursyChatHistoryPath();
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed to load cursy chat history from disk:', err.message);
    return [];
  }
}

function saveCursyChatHistoryToDisk(messages) {
  try {
    const file = cursyChatHistoryPath();
    const list = Array.isArray(messages) ? messages : [];
    fs.writeFileSync(file, JSON.stringify(list), 'utf-8');
    return true;
  } catch (err) {
    console.warn('Failed to save cursy chat history:', err.message);
    return false;
  }
}

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
      nodeIntegrationInSubFrames: true, // editor/monaco-frame.html loads Monaco via require
      backgroundThrottling: false,
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

  if (preferHttpRenderer() && rendererIndexUrl) {
    mainWindow.loadURL(rendererIndexUrl);
    console.log('[VIBE IDE] Main window origin (legacy HTTP shell):', rendererIndexUrl);
  } else {
    const indexPath = path.join(__dirname, '../renderer/index.html');
    mainWindow.loadFile(indexPath);
    console.log('[VIBE IDE] Main window: file:// (Monaco) + voice bridge:', rendererHttpBase || '(none)');
  }

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(1);
  });

  // Show main window when ready (but splash will still be on top)
  mainWindow.once('ready-to-show', () => {
    // Main window is ready, but we'll show it after splash closes
  });

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.setAudioMuted(false);
    if (testBridgeEnabled && !testBridgeServer) {
      const cdpArg = process.argv.find((a) => a.startsWith('--remote-debugging-port='));
      const cdpPort = cdpArg ? parseInt(cdpArg.split('=')[1], 10) : 9223;
      testBridgeServer = startTestBridge(() => mainWindow, { cdpPort });
    }
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
    detail:
            `Version ${packageJson.version}\n\n` +
            `${packageJson.description}\n\n` +
            `Team DC · My First Agentic IDE\n` +
            `Ship receipt (alpha):\n` +
            `• Gemini Flash chat + agent (BYOK)\n` +
            `• Project Recall v1 (keyword + MiniLM)\n` +
            `• @agent bounded steps + diff approve\n` +
            `• CML episodic memory · provide_code_block tools\n\n` +
            `Built with ❤️ by FutureVision Labs\n` +
            `Part of the Forge Family\n\n` +
            `itch.io · GitHub · vibeide.net\n\n` +
            `© 2025–2026 FutureVision Labs`,
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

// Fetch audio as buffer (for playback, bypasses CORS)
ipcMain.handle('audio:fetchAsBuffer', async (event, url) => {
  try {
    const https = require('https');
    const http = require('http');
    const urlModule = require('url');
    
    const parsedUrl = urlModule.parse(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    return new Promise((resolve) => {
      protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          resolve({ success: false, error: `HTTP ${response.statusCode}: ${response.statusMessage || 'Request failed'}` });
          return;
        }
        
        const chunks = [];
        response.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const contentType = response.headers['content-type'] || 'audio/mpeg';
          resolve({ 
            success: true, 
            buffer: buffer, 
            contentType: contentType,
            // Convert to base64 for transfer
            base64: buffer.toString('base64')
          });
        });
        
        response.on('error', (error) => {
          resolve({ success: false, error: error.message });
        });
      }).on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
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

ipcMain.handle('project:listTemplates', async () => {
  try {
    return {
      success: true,
      templates: projectCatalog.listTemplateMeta(),
      categoryLabels: projectCatalog.CATEGORY_LABELS,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project:create', async (event, template, projectPath, genre = null) => {
  try {
    const selectedGenre = genre || projectCatalog.inferGenre(template) || null;
    const selectedTemplate = projectCatalog.getTemplate(template);

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

    const packageJson = projectCatalog.getPackageJson(template, path.basename(projectPath));

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

ipcMain.handle('preview:openPopout', async () => {
  try {
    return openPreviewPopout(mainWindow, app);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('preview:popoutMessage', async (event, payload) => {
  return sendPreviewPopoutMessage(payload);
});

ipcMain.handle('preview:isPopoutOpen', async () => ({
  open: isPreviewPopoutOpen(),
}));

ipcMain.handle('preview:closePopout', async () => {
  closePreviewPopout();
  return { success: true };
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

// AI chat IPC — Gemini Flash (BYOK) + provide_code_block tool
ipcMain.handle('live:getWsUrl', async () => {
  try {
    const userDataPath = app.getPath('userData');
    return getGeminiLiveWsUrl(userDataPath, fs);
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('vibe:getVoiceBridgeUrl', async () => {
  if (!rendererHttpBase) {
    return { success: false, error: 'Local HTTP server not running (live mic unavailable)' };
  }
  return { success: true, url: `${rendererHttpBase}/voice-mic-bridge.html` };
});

ipcMain.handle('live:transcribeBlob', async (_event, { base64, mimeType }) => {
  try {
    const userDataPath = app.getPath('userData');
    return await transcribeLiveAudioBlob(userDataPath, fs, { base64, mimeType });
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('ai:chat', async (event, { messages, systemPrompt, maxTokens, useTools, forceProvideCodeBlock }) => {
  try {
    const userDataPath = app.getPath('userData');
    const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
    const hasImages = !!(last?.images && last.images.length);
    const toolsOn = useTools !== false && !hasImages;
    const forceTools = !!(forceProvideCodeBlock && toolsOn);
    let result = await chatGemini(userDataPath, fs, {
      messages,
      systemPrompt,
      maxTokens,
      useTools: toolsOn,
      forceProvideCodeBlock: forceTools,
    });
    if (!result.success && toolsOn && !forceTools) {
      result = await chatGemini(userDataPath, fs, {
        messages,
        systemPrompt,
        maxTokens,
        useTools: false,
      });
    }
    return result;
  } catch (error) {
    console.error('Gemini API error:', error);
    const status = error.status || error.statusCode || error.code || 500;
    return {
      success: false,
      error: error.message || String(error),
      status,
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
  // Redirect to Freesound for actual audio (Pixabay doesn't have audio API)
  return await searchFreesoundAudio(query, options);
});

ipcMain.handle('freesound:searchAudio', async (event, { query, options }) => {
  return await searchFreesoundAudio(query, options);
});

ipcMain.handle('pixabay:checkStatus', async () => {
  // Always try to load if not already loaded
  if (!pixabayApiKey) {
    const loaded = loadPixabayKey();
    if (!loaded) {
      console.warn('⚠️ Failed to load Pixabay key in checkStatus handler');
    }
  }
  
  const userDataPath = app.getPath('userData');
  const configPath = path.join(userDataPath, 'pixabay-config.json');
  
  return {
    available: !!pixabayApiKey,
    hasKey: !!pixabayApiKey,
    keyLength: pixabayApiKey ? pixabayApiKey.length : 0,
    userDataPath: userDataPath,
    configPath: configPath
  };
});

ipcMain.handle('freesound:checkStatus', async () => {
  // Always try to load if not already loaded
  if (!freesoundApiKey) {
    const loaded = loadFreesoundKey();
    if (!loaded) {
      console.warn('⚠️ Failed to load Freesound key in checkStatus handler');
    }
  }
  
  const projectRoot = path.join(__dirname, '..', '..');
  const configPath = path.join(projectRoot, 'freesound-config.json');
  
  return {
    available: !!freesoundApiKey,
    hasKey: !!freesoundApiKey,
    hasClientId: !!freesoundClientId,
    keyLength: freesoundApiKey ? freesoundApiKey.length : 0,
    clientIdLength: freesoundClientId ? freesoundClientId.length : 0,
    configPath: configPath
  };
});

ipcMain.handle('ai:checkStatus', async () => {
  const userDataPath = app.getPath('userData');
  let initialized = false;
  try {
    initialized = !!ensureGeminiClient(userDataPath, fs);
  } catch {
    initialized = false;
  }
  const status = getGeminiStatus(userDataPath, fs);
  return {
    ...status,
    initialized,
    userDataPath,
  };
});

ipcMain.handle('google:saveConfig', async (event, { apiKey }) => {
  try {
    const userDataPath = app.getPath('userData');
    const saved = saveGeminiApiKey(userDataPath, fs, apiKey);
    if (!saved.success) return saved;
    ensureGeminiClient(userDataPath, fs);
    return { success: true, configPath: saved.configPath, model: GEMINI_MODEL };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:step', async (event, payload) => {
  try {
    const userDataPath = app.getPath('userData');
    const result = await runAgentStep(userDataPath, fs, payload || {});
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:proposeWrite', async (event, payload) => {
  try {
    const userDataPath = app.getPath('userData');
    const result = await proposeSingleFileWrite(userDataPath, fs, payload || {});
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:commitWrite', async (event, { projectPath, path: relPath, content }) => {
  try {
    if (!projectPath || !relPath) {
      return { success: false, error: 'Missing projectPath or path' };
    }
    const toolResult = commitAgentWrite(projectPath, relPath, content ?? '', fs);
    if (!toolResult.ok) {
      return {
        success: false,
        error: toolResult.error,
        incomplete: toolResult.incomplete,
        truncated: toolResult.truncated,
      };
    }
    return { success: true, toolResult };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:validateWrite', async (event, { projectPath, path: relPath, content }) => {
  try {
    if (!projectPath || !relPath) {
      return { success: false, error: 'Missing projectPath or path' };
    }
    const ev = evaluateWriteForApproval(projectPath, relPath, content ?? '', fs, {});
    return { success: true, ...ev };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:maxSteps', async () => ({ maxSteps: DEFAULT_MAX_STEPS }));

ipcMain.handle('project:planShipFiles', async (event, { projectPath, goal, sessionBrief, plan }) => {
  try {
    if (!projectPath) return { success: false, error: 'No project path', plan: plan || [] };
    const enriched = enrichShipPlanFromSearch(projectPath, goal || '', sessionBrief || '', plan || [], fs);
    return { success: true, plan: enriched };
  } catch (error) {
    return { success: false, error: error.message, plan: plan || [] };
  }
});

ipcMain.handle('project:grep', async (event, { projectPath, pattern }) => {
  try {
    if (!projectPath) return { success: false, error: 'No project path' };
    return { success: true, ...grepProject(projectPath, pattern || '', fs) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project:findFiles', async (event, { projectPath, query }) => {
  try {
    if (!projectPath) return { success: false, error: 'No project path' };
    return { success: true, ...findFiles(projectPath, query || '', fs) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chat:loadHistory', async () => {
  try {
    const messages = loadCursyChatHistoryFromDisk();
    return { success: true, messages };
  } catch (error) {
    return { success: false, error: error.message, messages: [] };
  }
});

ipcMain.handle('chat:saveHistory', async (event, { messages }) => {
  try {
    const ok = saveCursyChatHistoryToDisk(messages);
    return ok ? { success: true } : { success: false, error: 'Write failed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chat:importFromCml', async (event, { projectPath, limit }) => {
  try {
    if (!projectPath) return { success: false, error: 'No project path', messages: [] };
    return rebuildChatHistoryFromCml(projectPath, fs, limit || 120);
  } catch (error) {
    return { success: false, error: error.message, messages: [] };
  }
});

ipcMain.handle('ai:chatStream', async () => {
  return {
    success: false,
    error: 'Streaming chat disabled — use standard chat (Gemini Flash BYOK).',
  };
});

ipcMain.handle('recall:stats', async (event, { projectPath }) => {
  try {
    if (!projectPath) return { success: false, count: 0 };
    const idx = loadRecallIndex(projectPath, fs);
    return {
      success: true,
      count: idx?.entries?.length || 0,
      builtAt: idx?.builtAt || null,
      fingerprint: idx?.fingerprint || null,
    };
  } catch (error) {
    return { success: false, count: 0, error: error.message };
  }
});

ipcMain.handle('recall:search', async (event, { projectPath, query, queryEmbedding }) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'No project path', snippets: [] };
    }
    return searchProjectRecall(projectPath, query || '', fs, queryEmbedding || null);
  } catch (error) {
    return { success: false, error: error.message, snippets: [] };
  }
});

ipcMain.handle('recall:chunks', async (event, { projectPath }) => {
  try {
    if (!projectPath) return { success: false, chunks: [] };
    const { chunks, scannedFiles } = collectRecallChunks(projectPath, fs);
    const fingerprint = buildRecallFingerprint(projectPath, fs);
    const existing = loadRecallIndex(projectPath, fs);
    return {
      success: true,
      chunks,
      scannedFiles,
      fingerprint,
      needsRebuild: !existing || existing.fingerprint !== fingerprint,
      indexPath: existing ? 'loaded' : null,
    };
  } catch (error) {
    return { success: false, error: error.message, chunks: [] };
  }
});

ipcMain.handle('recall:saveIndex', async (event, { projectPath, fingerprint, entries }) => {
  try {
    if (!projectPath || !Array.isArray(entries)) {
      return { success: false, error: 'Invalid index payload' };
    }
    const payload = {
      version: RECALL_INDEX_VERSION,
      fingerprint,
      builtAt: new Date().toISOString(),
      entries,
    };
    return saveRecallIndex(projectPath, fs, payload);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('recall:recentCml', async (event, { projectPath, limit }) => {
  try {
    if (!projectPath) {
      return { success: false, files: [] };
    }
    const listed = listRecentCmlFiles(projectPath, fs, limit || 5);
    const previews = [];
    for (const f of listed.files || []) {
      try {
        const text = fs.readFileSync(f.path, 'utf-8');
        previews.push({
          name: f.name,
          path: f.path,
          text: text.length > 4000 ? text.slice(0, 4000) + '\n…' : text,
        });
      } catch {
        /* skip */
      }
    }
    return { success: true, files: previews, count: previews.length };
  } catch (error) {
    return { success: false, error: error.message, files: [] };
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

// Open folder in system file manager
ipcMain.handle('fs:openFolder', async (event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) {
      return { success: false, error: 'Folder does not exist' };
    }
    await shell.openPath(folderPath);
    return { success: true };
  } catch (error) {
    console.error('Error opening folder:', error);
    return { success: false, error: error.message };
  }
});

function setupLiveVoiceMediaPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media' || permission === 'microphone' || permission === 'audioCapture';
  });
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission !== 'media' && permission !== 'microphone' && permission !== 'audioCapture') {
      callback(false);
      return;
    }
    const win = BrowserWindow.fromWebContents(webContents) || BrowserWindow.getFocusedWindow();
    dialog
      .showMessageBox(win || undefined, {
        type: 'question',
        buttons: ['Allow microphone', 'Deny'],
        defaultId: 0,
        cancelId: 1,
        title: 'Cursy Live voice',
        message: 'Allow VIBE IDE to use your microphone?',
        detail:
          'Needed for Gemini Live voice with Cursy. On Windows, also check Settings → Privacy → Microphone for desktop apps.',
      })
      .then(({ response }) => callback(response === 0))
      .catch(() => callback(false));
  });
}

// Register protocol to serve static files from node_modules
app.whenReady().then(async () => {
  setupLiveVoiceMediaPermissions();

  try {
    const rendererDir = path.join(__dirname, '../renderer');
    const started = await startRendererStaticServer(rendererDir);
    rendererStaticServer = started.server;
    rendererHttpBase = started.indexUrl.replace(/\/index\.html$/i, '');
    rendererIndexUrl = preferHttpRenderer() ? started.indexUrl : null;
    console.log('✅ Voice bridge HTTP origin:', rendererHttpBase);
    if (preferHttpRenderer()) {
      console.log('✅ Full UI on HTTP (debug):', started.indexUrl);
    } else {
      console.log('✅ Main UI on file:// — Monaco scroll + localhost mic bridge');
    }
  } catch (err) {
    console.warn('⚠️ Renderer HTTP server failed — live mic bridge unavailable', err.message);
    rendererIndexUrl = null;
    rendererHttpBase = null;
  }

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
  
  try {
    const userDataPath = app.getPath('userData');
    if (ensureGeminiClient(userDataPath, fs)) {
      console.log('✅ Gemini client ready (model:', GEMINI_MODEL + ')');
    } else {
      console.warn('⚠️ No Gemini API key yet — add one in User Settings for Cursy chat.');
    }
  } catch (e) {
    console.warn('⚠️ Gemini init skipped:', e.message);
  }
  
  // Load API keys now that app is ready
  loadPixabayKey();
  loadFreesoundKey();
  
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

