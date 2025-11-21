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
  
  // OpenAI (Phase 2)
  openaiChat: (messages, systemPrompt, maxTokens) => ipcRenderer.invoke('openai:chat', { messages, systemPrompt, maxTokens }),
  openaiCheckStatus: () => ipcRenderer.invoke('openai:checkStatus')
};

console.log('VIBE IDE Preload Script Loaded');

