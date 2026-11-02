// Preload script - runs in renderer process before page loads
// Bridge between main process and renderer process

const { ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
// Note: With contextIsolation: false, we can use window directly
window.electronAPI = {
  // File operations (Phase 4)
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (content, defaultPath) => ipcRenderer.invoke('dialog:saveFile', content, defaultPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  copyFile: (srcPath, destPath) => ipcRenderer.invoke('fs:copyFile', srcPath, destPath),
  createFile: (filePath, content) => ipcRenderer.invoke('fs:createFile', filePath, content),
  createFolder: (folderPath) => ipcRenderer.invoke('fs:createFolder', folderPath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  deleteFile: (filePath) => ipcRenderer.invoke('fs:delete', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  
  // Project operations (Phase 4)
  openProject: () => ipcRenderer.invoke('dialog:openProject'),
  selectProjectFolder: () => ipcRenderer.invoke('dialog:selectProjectFolder'),
  createProject: (template, projectPath, genre) => ipcRenderer.invoke('project:create', template, projectPath, genre),
  listProjectTemplates: () => ipcRenderer.invoke('project:listTemplates'),
  loadProjectConfig: (projectPath) => ipcRenderer.invoke('project:loadConfig', projectPath),
  saveProjectConfig: (projectPath, config) => ipcRenderer.invoke('project:saveConfig', projectPath, config),
  
  // Genre Rules
  loadGenreRule: (genreName, options) => ipcRenderer.invoke('genre:loadRule', genreName, options || {}),
  listAvailableGenres: () => ipcRenderer.invoke('genre:listAvailable'),
  saveGenreRule: (genreName, ruleData) => ipcRenderer.invoke('genre:saveRule', genreName, ruleData),
  deleteGenreRule: (genreName) => ipcRenderer.invoke('genre:deleteRule', genreName),
  
  // Bundling
  bundleEsbuild: (entryPath, projectRoot) => ipcRenderer.invoke('bundle:esbuild', { entryPath, projectRoot }),
  previewOpenExternal: (htmlContent) => ipcRenderer.invoke('preview:openExternal', { htmlContent }),
  previewOpenPopout: () => ipcRenderer.invoke('preview:openPopout'),
  previewPopoutMessage: (payload) => ipcRenderer.invoke('preview:popoutMessage', payload),
  previewIsPopoutOpen: () => ipcRenderer.invoke('preview:isPopoutOpen'),
  previewClosePopout: () => ipcRenderer.invoke('preview:closePopout'),
  onPreviewPopoutClosed: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on('preview:popout-closed', handler);
    return () => ipcRenderer.removeListener('preview:popout-closed', handler);
  },
  runNpmScript: (script, outDir) => ipcRenderer.invoke('run:npmScript', { script, outDir }),
  
  // Platform info
  platform: process.platform,
  
  // Version info
  appVersion: process.env.npm_package_version || '1.0.0',
  
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  
  // AI backend (Gemini) — neutral IPC names
  aiChat: (messages, systemPrompt, maxTokens, chatOptions = {}) =>
    ipcRenderer.invoke('ai:chat', { messages, systemPrompt, maxTokens, ...chatOptions }),
  aiChatStream: (messages, systemPrompt, maxTokens, onChunk) =>
    new Promise((resolve, reject) => {
      const handler = (_event, payload) => {
        if (!payload) return;
        if (payload.type === 'chunk' && typeof onChunk === 'function') {
          onChunk(payload.delta);
        } else if (payload.type === 'done') {
          ipcRenderer.removeListener('ai:chat-stream', handler);
          resolve(payload.result || { success: true });
        } else if (payload.type === 'error') {
          ipcRenderer.removeListener('ai:chat-stream', handler);
          reject(new Error(payload.error || 'Stream failed'));
        }
      };
      ipcRenderer.on('ai:chat-stream', handler);
      ipcRenderer
        .invoke('ai:chatStream', { messages, systemPrompt, maxTokens })
        .then((result) => {
          if (result && result.success === false && !result.streamed) {
            ipcRenderer.removeListener('ai:chat-stream', handler);
            resolve(result);
          }
        })
        .catch((err) => {
          ipcRenderer.removeListener('ai:chat-stream', handler);
          reject(err);
        });
    }),
  recallStats: (projectPath) => ipcRenderer.invoke('recall:stats', { projectPath }),
  aiCheckStatus: () => ipcRenderer.invoke('ai:checkStatus'),
  googleSaveConfig: (apiKey) => ipcRenderer.invoke('google:saveConfig', { apiKey }),
  liveGetWsUrl: () => ipcRenderer.invoke('live:getWsUrl'),
  getVoiceBridgeUrl: () => ipcRenderer.invoke('vibe:getVoiceBridgeUrl'),
  liveTranscribeBlob: (payload) => ipcRenderer.invoke('live:transcribeBlob', payload),
  recallSearch: (projectPath, query, queryEmbedding) =>
    ipcRenderer.invoke('recall:search', { projectPath, query, queryEmbedding }),
  recallChunks: (projectPath) => ipcRenderer.invoke('recall:chunks', { projectPath }),
  recallSaveIndex: (projectPath, fingerprint, entries) =>
    ipcRenderer.invoke('recall:saveIndex', { projectPath, fingerprint, entries }),
  recallRecentCml: (projectPath, limit) =>
    ipcRenderer.invoke('recall:recentCml', { projectPath, limit }),
  agentStep: (payload) => ipcRenderer.invoke('agent:step', payload),
  agentProposeWrite: (payload) => ipcRenderer.invoke('agent:proposeWrite', payload),
  agentCommitWrite: (projectPath, relPath, content) =>
    ipcRenderer.invoke('agent:commitWrite', { projectPath, path: relPath, content }),
  agentValidateWrite: (projectPath, relPath, content) =>
    ipcRenderer.invoke('agent:validateWrite', { projectPath, path: relPath, content }),
  agentMaxSteps: () => ipcRenderer.invoke('agent:maxSteps'),
  projectPlanShipFiles: (projectPath, goal, sessionBrief, plan) =>
    ipcRenderer.invoke('project:planShipFiles', { projectPath, goal, sessionBrief, plan }),
  projectGrep: (projectPath, pattern) => ipcRenderer.invoke('project:grep', { projectPath, pattern }),
  projectFindFiles: (projectPath, query) => ipcRenderer.invoke('project:findFiles', { projectPath, query }),
  chatLoadHistory: () => ipcRenderer.invoke('chat:loadHistory'),
  chatSaveHistory: (messages) => ipcRenderer.invoke('chat:saveHistory', { messages }),
  chatImportFromCml: (projectPath, limit) =>
    ipcRenderer.invoke('chat:importFromCml', { projectPath, limit }),
  
  // Pixabay API (Cursy's Corner - for images/videos)
  pixabaySearchImages: (query, options) => ipcRenderer.invoke('pixabay:searchImages', { query, options }),
  pixabaySearchVideos: (query, options) => ipcRenderer.invoke('pixabay:searchVideos', { query, options }),
  pixabaySearchAudio: (query, options) => ipcRenderer.invoke('pixabay:searchAudio', { query, options }), // Redirects to Freesound
  pixabayCheckStatus: () => ipcRenderer.invoke('pixabay:checkStatus'),
  
  // Freesound API (for music/SFX - the real audio API!)
  freesoundSearchAudio: (query, options) => ipcRenderer.invoke('freesound:searchAudio', { query, options }),
  freesoundCheckStatus: () => ipcRenderer.invoke('freesound:checkStatus'),
  
  // File download
  downloadFile: (url, filePath) => ipcRenderer.invoke('fs:downloadFile', url, filePath),
  
  // Fetch audio as blob (for playback, bypasses CORS)
  fetchAudioAsBlob: (url) => ipcRenderer.invoke('audio:fetchAsBuffer', url),
  
  // Open folder in system file manager
  openFolder: (folderPath) => ipcRenderer.invoke('fs:openFolder', folderPath)
};

console.log('VIBE IDE Preload Script Loaded');

