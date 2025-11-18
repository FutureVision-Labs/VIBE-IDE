// Renderer process script
// Handles UI interactions and communicates with main process

console.log('VIBE IDE Renderer Process Loaded');

// Platform detection
if (window.electronAPI) {
    console.log('Platform:', window.electronAPI.platform);
    console.log('App Version:', window.electronAPI.appVersion);
}

// State management
const state = {
    monacoEditor: null,
    openTabs: [],
    activeTab: null,
    currentProject: null,
    genreContext: null, // Store genre-specific AI context
    previewFrame: null,
    previewLoaded: false,
    autoReload: true,
    previewRunning: false,
    autoBundle: true, // prefer bundling for real projects
    theme: localStorage.getItem('vibe-ide-theme') || 'dark',
    leftSidebarWidth: parseInt(localStorage.getItem('vibe-ide-left-sidebar-width') || '260', 10),
    rightSidebarWidth: parseInt(localStorage.getItem('vibe-ide-right-sidebar-width') || '320', 10),
    previewHeight: parseInt(localStorage.getItem('vibe-ide-preview-height') || '250', 10),
    leftSidebarCollapsed: localStorage.getItem('vibe-ide-left-sidebar-collapsed') === 'true',
    rightSidebarCollapsed: localStorage.getItem('vibe-ide-right-sidebar-collapsed') === 'true',
    previewCollapsed: localStorage.getItem('vibe-ide-preview-collapsed') === 'true',
    genreEditor: {
        overlay: null,
        jsonEditor: null,
        genres: [],
        current: null,
        rule: null,
        originalRule: null,
        bundledRule: null,
        isBundled: false,
        hasOverride: false,
        dirty: false,
        jsonDirty: false,
        activeTab: 'form',
        isNew: false,
        codeExamples: [],
        commonBugs: [],
        performanceTips: []
    },
    chatHistory: [] // Store chat messages for persistence
};

// Welcome screen functions
function showNewProject() {
    handleNewProject();
}

function showOpenProject() {
    handleOpenProject();
}

function showAboutDialog() {
    // This will be handled by the Electron menu, but we can also show it here
    // The actual dialog is shown via IPC from the menu
    console.log('About dialog requested');
}

// File Operations (Phase 4)
async function handleNewFile() {
    console.log('handleNewFile called');
    
    if (!window.electronAPI || !window.electronAPI.createFile) {
        console.error('window.electronAPI.createFile not available');
        alert('File operations not available. Please restart the app.');
        return;
    }
    
    if (!state.currentProject) {
        alert('Please open or create a project first!');
        return;
    }
    
    // Use a custom dialog instead of prompt() (not supported in Electron)
    const fileName = await showFileNameDialog();
    if (!fileName) return;
    
    const filePath = state.currentProject.path + (state.currentProject.path.endsWith('/') ? '' : '/') + fileName;
    
    try {
        const result = await window.electronAPI.createFile(filePath, '// New file\n\n');
        if (result.success) {
            // Refresh file tree
            await loadProjectFiles(state.currentProject.path);
            // Open the new file
            openFileFromPath(filePath);
        } else {
            alert('Error creating file: ' + result.error);
        }
    } catch (error) {
        console.error('Error creating file:', error);
        alert('Error creating file: ' + error.message);
    }
}

function showFileNameDialog() {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #2d2d2d;
            border: 2px solid #4a4a4a;
            border-radius: 8px;
            padding: 20px;
            z-index: 10000;
            min-width: 300px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        `;
        
        dialog.innerHTML = `
            <h3 style="margin-top: 0; color: #fff;">New File</h3>
            <input type="text" id="filename-input" placeholder="filename.js" value="newfile.js" style="
                width: 100%;
                padding: 8px;
                margin: 10px 0;
                background: #1e1e1e;
                color: #fff;
                border: 1px solid #666;
                border-radius: 4px;
                box-sizing: border-box;
            ">
            <div style="display: flex; gap: 10px;">
                <button id="filename-ok" style="
                    flex: 1;
                    padding: 8px;
                    background: #4a4a4a;
                    color: #fff;
                    border: 1px solid #666;
                    border-radius: 4px;
                    cursor: pointer;
                ">OK</button>
                <button id="filename-cancel" style="
                    flex: 1;
                    padding: 8px;
                    background: #666;
                    color: #fff;
                    border: 1px solid #888;
                    border-radius: 4px;
                    cursor: pointer;
                ">Cancel</button>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        const input = document.getElementById('filename-input');
        input.focus();
        input.select();
        
        const handleOK = () => {
            const value = input.value.trim();
            document.body.removeChild(dialog);
            resolve(value || null);
        };
        
        const handleCancel = () => {
            document.body.removeChild(dialog);
            resolve(null);
        };
        
        document.getElementById('filename-ok').addEventListener('click', handleOK);
        document.getElementById('filename-cancel').addEventListener('click', handleCancel);
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleOK();
            } else if (e.key === 'Escape') {
                handleCancel();
            }
        });
    });
}

async function handleOpenFile() {
    try {
        console.log('handleOpenFile called');
        console.log('window.electronAPI available:', !!window.electronAPI);
        
        if (!window.electronAPI || !window.electronAPI.openFile) {
            console.error('window.electronAPI.openFile not available');
            alert('File operations not available. Please restart the app.');
            return;
        }
        
        const fileData = await window.electronAPI.openFile();
        console.log('File data received:', fileData);
        if (fileData) {
            createTab(fileData.path, fileData.name, fileData.content);
        }
    } catch (error) {
        console.error('Error in handleOpenFile:', error);
        alert('Error opening file: ' + error.message);
    }
}

async function handleSaveFile() {
    if (!state.activeTab) {
        alert('No file open to save');
        return;
    }
    
    const tab = state.openTabs.find(t => t.id === state.activeTab);
    if (!tab) return;
    
    // Block Save for read-only tabs; redirect to Save As
    if (tab.readOnly) {
        console.warn('Attempted to save read-only tab; redirecting to Save As');
        await handleSaveFileAs();
        return;
    }
    
    const content = state.monacoEditor ? state.monacoEditor.getValue() : tab.content;
    
    // If file has a path (absolute path starting with / or drive letter), save directly
    if (tab.path && (tab.path.startsWith('/') || /^[A-Za-z]:/.test(tab.path))) {
        try {
            const result = await window.electronAPI.writeFile(tab.path, content);
            if (result.success) {
                tab.isDirty = false;
                renderTabs();
                // Don't show alert - just update UI
            } else {
                alert('Error saving file: ' + result.error);
            }
        } catch (error) {
            alert('Error saving file: ' + error.message);
        }
    } else {
        // Save As dialog
        handleSaveFileAs();
    }
}

async function handleSaveFileAs() {
    if (!state.activeTab) {
        alert('No file open to save');
        return;
    }
    
    const tab = state.openTabs.find(t => t.id === state.activeTab);
    if (!tab) return;
    
    const content = state.monacoEditor ? state.monacoEditor.getValue() : tab.content;
    const defaultPath = tab.path || tab.name;
    
    try {
        const result = await window.electronAPI.saveFile(content, defaultPath);
        if (result) {
            // Update tab with new path
            tab.path = result.path;
            tab.name = result.name;
            tab.isDirty = false;
            renderTabs();
            // Don't show alert - just update UI
        }
    } catch (error) {
        alert('Error saving file: ' + error.message);
    }
}

// Project Operations (Phase 4)
async function handleNewProject() {
    console.log('handleNewProject called');
    console.log('window.electronAPI available:', !!window.electronAPI);
    
    if (!window.electronAPI || !window.electronAPI.selectProjectFolder) {
        console.error('window.electronAPI not available');
        alert('Project operations not available. Please restart the app.');
        return;
    }
    
    // Use a simple dialog instead of prompt() (not supported in Electron)
    const templateChoice = await showTemplateDialog();
    if (!templateChoice) return;
    
    const { template, genre } = templateChoice;
    
    try {
        const projectPath = await window.electronAPI.selectProjectFolder();
        if (!projectPath) return;
        
        const result = await window.electronAPI.createProject(template, projectPath, genre);
        if (result.success) {
            await loadProject(projectPath);
            alert('Project created successfully!');
        } else {
            if (!result.cancelled) {
                alert('Error creating project: ' + (result.error || 'Unknown error'));
            }
        }
    } catch (error) {
        console.error('Error creating project:', error);
        alert('Error creating project: ' + error.message);
    }
}

function showTemplateDialog() {
    return new Promise(async (resolve) => {
        // Get available genres
        const genresResult = await window.electronAPI.listAvailableGenres();
        const availableGenres = genresResult.success && Array.isArray(genresResult.genres)
            ? genresResult.genres.map(g => g.name)
            : ['platformer', 'shooter', 'puzzle', 'runner'];
        
        // Template to genre mapping
        const templateToGenre = {
            blank: null,
            platformer: 'platformer',
            shooter: 'shooter',
            puzzle: 'puzzle',
            runner: 'runner'
        };
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #2d2d2d;
            border: 2px solid #4a4a4a;
            border-radius: 8px;
            padding: 20px;
            z-index: 10000;
            min-width: 350px;
            max-width: 500px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        `;
        
        dialog.innerHTML = `
            <h3 style="margin-top: 0; color: #fff;">Create New Project</h3>
            <div style="margin: 15px 0;">
                <label style="display: block; color: #ccc; margin-bottom: 8px;">Template:</label>
                <select id="template-select" style="
                    width: 100%;
                    padding: 8px;
                    background: #3a3a3a;
                    color: #fff;
                    border: 1px solid #666;
                    border-radius: 4px;
                    margin-bottom: 15px;
                ">
                    <option value="blank">Blank Project</option>
                    <option value="platformer">Platformer Template</option>
                </select>
                
                <label style="display: block; color: #ccc; margin-bottom: 8px;">Genre (optional):</label>
                <select id="genre-select" style="
                    width: 100%;
                    padding: 8px;
                    background: #3a3a3a;
                    color: #fff;
                    border: 1px solid #666;
                    border-radius: 4px;
                    margin-bottom: 15px;
                ">
                    <option value="">None (infer from template)</option>
                    ${availableGenres.map(g => `<option value="${g}">${g.charAt(0).toUpperCase() + g.slice(1)}</option>`).join('')}
                </select>
                <small style="color: #888; font-size: 12px;">Genre helps AI provide better suggestions</small>
            </div>
            <div style="display: flex; gap: 10px;">
                <button id="template-create" style="
                    flex: 1;
                    padding: 10px;
                    background: #00a2ff;
                    color: #fff;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                ">Create</button>
                <button id="template-cancel" style="
                    flex: 1;
                    padding: 10px;
                    background: #666;
                    color: #fff;
                    border: 1px solid #888;
                    border-radius: 4px;
                    cursor: pointer;
                ">Cancel</button>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // Auto-select genre based on template
        const templateSelect = document.getElementById('template-select');
        const genreSelect = document.getElementById('genre-select');
        
        templateSelect.addEventListener('change', () => {
            const template = templateSelect.value;
            const inferredGenre = templateToGenre[template];
            if (inferredGenre && genreSelect.value === '') {
                genreSelect.value = inferredGenre;
            }
        });
        
        document.getElementById('template-create').addEventListener('click', () => {
            const template = templateSelect.value;
            const genre = genreSelect.value || null;
            document.body.removeChild(dialog);
            resolve({ template, genre });
        });
        
        document.getElementById('template-cancel').addEventListener('click', () => {
            document.body.removeChild(dialog);
            resolve(null);
        });
    });
}

async function handleOpenProject() {
    console.log('handleOpenProject called');
    console.log('window.electronAPI available:', !!window.electronAPI);
    
    if (!window.electronAPI || !window.electronAPI.openProject) {
        console.error('window.electronAPI not available');
        alert('Project operations not available. Please restart the app.');
        return;
    }
    
    try {
        const projectPath = await window.electronAPI.openProject();
        if (projectPath) {
            await loadProject(projectPath);
        }
    } catch (error) {
        console.error('Error opening project:', error);
        alert('Error opening project: ' + error.message);
    }
}

async function loadProject(projectPath) {
    state.currentProject = { path: projectPath };
    localStorage.setItem('vibe-ide-last-project', projectPath);
    saveToRecentProjects(projectPath);
    
    // Load project config and genre rules
    try {
        const configResult = await window.electronAPI.loadProjectConfig(projectPath);
        if (configResult.success) {
            state.currentProject.config = configResult.config;
            state.currentProject.genre = configResult.config.genre;
            
            // Load genre rule if genre is set
            if (state.currentProject.genre) {
                const genreResult = await window.electronAPI.loadGenreRule(state.currentProject.genre);
                if (genreResult.success) {
                    state.currentProject.genreRule = genreResult.rule;
                    console.log('✅ Loaded genre rule:', state.currentProject.genre);
                    updateAIContextWithGenre();
                } else {
                    console.warn('⚠️ Could not load genre rule:', genreResult.error);
                }
            }
        } else {
            console.log('No project config found, creating default');
            state.currentProject.config = {
                projectName: projectPath.split(/[/\\]/).pop(),
                version: '1.0.0',
                genre: null
            };
        }
    } catch (error) {
        console.error('Error loading project config:', error);
    }
    
    await loadProjectFiles(projectPath);
}

async function loadProjectFiles(projectPath) {
    try {
        const result = await window.electronAPI.readDir(projectPath);
        if (result.success) {
            const files = buildFileTree(result.files);
            renderFileTree(files);
        } else {
            alert('Error loading project files: ' + result.error);
        }
    } catch (error) {
        alert('Error loading project: ' + error.message);
    }
}

function buildFileTree(files) {
    const tree = [];
    const folders = {};
    
    // Normalize project path for comparison
    const projectPath = state.currentProject.path.replace(/\\/g, '/');
    
    files.forEach(file => {
        // Normalize file path
        let relativePath = file.path.replace(/\\/g, '/').replace(projectPath, '');
        if (relativePath.startsWith('/')) {
            relativePath = relativePath.substring(1);
        }
        
        const parts = relativePath.split('/').filter(p => p);
        if (parts.length === 0) return;
        
        if (file.type === 'folder') {
            folders[parts[0]] = { type: 'folder', name: parts[0], path: file.path, children: [] };
        } else {
            if (parts.length === 1) {
                tree.push({ type: 'file', name: parts[0], path: file.path });
            } else {
                // Nested file
                const folderName = parts[0];
                if (!folders[folderName]) {
                    const folderPath = file.path.split(/[/\\]/).slice(0, -1).join('/');
                    folders[folderName] = { type: 'folder', name: folderName, path: folderPath, children: [] };
                }
                folders[folderName].children.push({ type: 'file', name: parts[parts.length - 1], path: file.path });
            }
        }
    });
    
    // Add folders to tree
    Object.values(folders).forEach(folder => {
        tree.push(folder);
    });
    
    return tree;
}

async function openFileFromPath(filePath) {
    try {
        const result = await window.electronAPI.readFile(filePath);
        if (result.success) {
            const fileName = filePath.split(/[/\\]/).pop();
            const tab = createTab(filePath, fileName, result.content);
            // Mark as read-only if file is outside the current project path
            try {
                if (state.currentProject && state.currentProject.path) {
                    const proj = state.currentProject.path.replace(/\\/g, '/').toLowerCase();
                    const fpath = filePath.replace(/\\/g, '/').toLowerCase();
                    if (!fpath.startsWith(proj)) {
                        tab.readOnly = true;
                        tab.name = fileName + ' [RO]';
                        renderTabs();
                        console.warn('Opened external file as read-only:', filePath);
                    }
                } else {
                    // No project loaded -> open as read-only to be safe
                    tab.readOnly = true;
                    tab.name = fileName + ' [RO]';
                    renderTabs();
                    console.warn('Opened file in safe read-only mode (no project loaded):', filePath);
                }
            } catch (e) {
                console.warn('Read-only marking failed:', e.message);
            }
        } else {
            alert('Error reading file: ' + result.error);
        }
    } catch (error) {
        alert('Error opening file: ' + error.message);
    }
}

// Menu event listeners (Phase 4) - Initialize after DOM is ready
function setupMenuHandlers() {
    try {
        // Use nodeRequire to bypass Monaco's AMD loader
        const nodeRequire = window.nodeRequire || require;
        const { ipcRenderer } = nodeRequire('electron');
        
        console.log('Setting up menu handlers...');
        console.log('ipcRenderer available:', !!ipcRenderer);
        
        ipcRenderer.on('menu:newProject', () => {
            console.log('✅ IPC received: menu:newProject');
            handleNewProject();
        });
        
        ipcRenderer.on('menu:openProject', () => {
            console.log('✅ IPC received: menu:openProject');
            handleOpenProject();
        });
        
        ipcRenderer.on('menu:newFile', () => {
            console.log('✅ IPC received: menu:newFile');
            handleNewFile();
        });
        
        ipcRenderer.on('menu:openFile', () => {
            console.log('✅ IPC received: menu:openFile');
            handleOpenFile();
        });
        
        ipcRenderer.on('menu:saveFile', () => {
            console.log('✅ IPC received: menu:saveFile');
            handleSaveFile();
        });
        
        ipcRenderer.on('menu:saveFileAs', () => {
            console.log('✅ IPC received: menu:saveFileAs');
            handleSaveFileAs();
        });
        
        console.log('✅ Menu handlers registered successfully');
        
    } catch (error) {
        console.error('❌ Error setting up menu handlers:', error);
    }
}

// Theme Toggle
function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.body.className = state.theme === 'light' ? 'light-theme' : '';
    localStorage.setItem('vibe-ide-theme', state.theme);
    
    const themeToggle = document.getElementById('themeToggle');
    themeToggle.textContent = state.theme === 'dark' ? '🌙' : '☀️';
    
    // Update Monaco Editor theme
    updateMonacoTheme();
    
    console.log('Theme switched to:', state.theme);
}

// Panel Resizing System
function initResizers() {
    const leftResizer = document.getElementById('leftResizer');
    const rightResizer = document.getElementById('rightResizer');
    const previewResizer = document.getElementById('previewResizer');
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    const previewPane = document.getElementById('previewPane');

    // Left sidebar resizer
    let leftResizing = false;
    leftResizer.addEventListener('mousedown', (e) => {
        leftResizing = true;
        leftResizer.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (leftResizing) {
            const newWidth = e.clientX;
            if (newWidth >= 150 && newWidth <= 600) {
                state.leftSidebarWidth = newWidth;
                leftSidebar.style.width = newWidth + 'px';
            }
        }
    });

    document.addEventListener('mouseup', () => {
        if (leftResizing) {
            leftResizing = false;
            leftResizer.classList.remove('dragging');
            localStorage.setItem('vibe-ide-left-sidebar-width', state.leftSidebarWidth.toString());
        }
    });

    // Right sidebar resizer
    let rightResizing = false;
    rightResizer.addEventListener('mousedown', (e) => {
        rightResizing = true;
        rightResizer.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (rightResizing) {
            const newWidth = window.innerWidth - e.clientX;
            if (newWidth >= 150 && newWidth <= 600) {
                state.rightSidebarWidth = newWidth;
                rightSidebar.style.width = newWidth + 'px';
            }
        }
    });

    document.addEventListener('mouseup', () => {
        if (rightResizing) {
            rightResizing = false;
            rightResizer.classList.remove('dragging');
            localStorage.setItem('vibe-ide-right-sidebar-width', state.rightSidebarWidth.toString());
        }
    });

    // Preview pane resizer
    let previewResizing = false;
    previewResizer.addEventListener('mousedown', (e) => {
        previewResizing = true;
        previewResizer.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (previewResizing) {
            const newHeight = window.innerHeight - e.clientY - 30; // 30px for menu bar
            if (newHeight >= 100 && newHeight <= window.innerHeight - 200) {
                state.previewHeight = newHeight;
                previewPane.style.height = newHeight + 'px';
            }
        }
    });

    document.addEventListener('mouseup', () => {
        if (previewResizing) {
            previewResizing = false;
            previewResizer.classList.remove('dragging');
            localStorage.setItem('vibe-ide-preview-height', state.previewHeight.toString());
        }
    });
}

// Sidebar Toggle Functions
function toggleLeftSidebar() {
    state.leftSidebarCollapsed = !state.leftSidebarCollapsed;
    const sidebar = document.getElementById('leftSidebar');
    const toggle = document.getElementById('toggleLeftSidebar');
    
    if (state.leftSidebarCollapsed) {
        sidebar.classList.add('collapsed');
        toggle.textContent = '▶';
    } else {
        sidebar.classList.remove('collapsed');
        sidebar.style.width = state.leftSidebarWidth + 'px';
        toggle.textContent = '◀';
    }
    
    localStorage.setItem('vibe-ide-left-sidebar-collapsed', state.leftSidebarCollapsed.toString());
}

function toggleRightSidebar() {
    state.rightSidebarCollapsed = !state.rightSidebarCollapsed;
    const sidebar = document.getElementById('rightSidebar');
    const toggle = document.getElementById('toggleRightSidebar');
    const floatToggle = document.getElementById('rightSidebarFloatToggle');
    
    if (state.rightSidebarCollapsed) {
        sidebar.classList.add('collapsed');
        toggle.textContent = '◀';
        if (floatToggle) floatToggle.style.display = 'block'; // Show floating button
    } else {
        sidebar.classList.remove('collapsed');
        sidebar.style.width = state.rightSidebarWidth + 'px';
        toggle.textContent = '▶';
        if (floatToggle) floatToggle.style.display = 'none'; // Hide floating button
    }
    
    localStorage.setItem('vibe-ide-right-sidebar-collapsed', state.rightSidebarCollapsed.toString());
}

function togglePreview() {
    state.previewCollapsed = !state.previewCollapsed;
    const pane = document.getElementById('previewPane');
    const toggle = document.getElementById('togglePreview');
    
    if (state.previewCollapsed) {
        pane.classList.add('collapsed');
        toggle.textContent = '▲';
    } else {
        pane.classList.remove('collapsed');
        pane.style.height = state.previewHeight + 'px';
        toggle.textContent = '▼';
    }
    
    localStorage.setItem('vibe-ide-preview-collapsed', state.previewCollapsed.toString());
}

// Load and display recent projects
function loadRecentProjects() {
    const recentProjects = JSON.parse(localStorage.getItem('vibe-ide-recent-projects') || '[]');
    const recentProjectsDiv = document.getElementById('recentProjects');
    const recentProjectsList = document.getElementById('recentProjectsList');
    
    if (recentProjects.length === 0) {
        recentProjectsDiv.style.display = 'none';
        return;
    }
    
    recentProjectsDiv.style.display = 'block';
    recentProjectsList.innerHTML = '';
    
    // Show last 5 projects
    const projectsToShow = recentProjects.slice(0, 5);
    
    projectsToShow.forEach(projectPath => {
        const projectItem = document.createElement('div');
        projectItem.className = 'recent-project-item';
        projectItem.onclick = () => loadProject(projectPath);
        
        const projectName = document.createElement('div');
        projectName.className = 'project-name';
        projectName.textContent = projectPath.split(/[/\\]/).pop() || projectPath;
        
        const projectPathEl = document.createElement('div');
        projectPathEl.className = 'project-path';
        projectPathEl.textContent = projectPath;
        
        projectItem.appendChild(projectName);
        projectItem.appendChild(projectPathEl);
        recentProjectsList.appendChild(projectItem);
    });
}

// Save project to recent projects list
function saveToRecentProjects(projectPath) {
    let recentProjects = JSON.parse(localStorage.getItem('vibe-ide-recent-projects') || '[]');
    
    // Remove if already exists
    recentProjects = recentProjects.filter(p => p !== projectPath);
    
    // Add to beginning
    recentProjects.unshift(projectPath);
    
    // Keep only last 10
    recentProjects = recentProjects.slice(0, 10);
    
    localStorage.setItem('vibe-ide-recent-projects', JSON.stringify(recentProjects));
    loadRecentProjects();
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    console.log('VIBE IDE UI Ready!');
    
    // Ensure welcome screen is shown on startup
    state.activeTab = null;
    state.openTabs = []; // Clear any tabs
    document.getElementById('welcomeScreen').style.display = 'block';
    document.getElementById('monacoEditor').style.display = 'none';
    
    // Render tabs to show Welcome tab
    renderTabs();
    switchToTab('welcome');
    
    // Load recent projects
    loadRecentProjects();
    
    // Apply saved theme
    if (state.theme === 'light') {
        document.body.className = 'light-theme';
        document.getElementById('themeToggle').textContent = '☀️';
    }
    
    // Apply saved panel sizes
    document.getElementById('leftSidebar').style.width = state.leftSidebarWidth + 'px';
    document.getElementById('rightSidebar').style.width = state.rightSidebarWidth + 'px';
    document.getElementById('previewPane').style.height = state.previewHeight + 'px';
    
    // Apply collapsed states
    if (state.leftSidebarCollapsed) {
        document.getElementById('leftSidebar').classList.add('collapsed');
        document.getElementById('toggleLeftSidebar').textContent = '▶';
    }
    if (state.rightSidebarCollapsed) {
        document.getElementById('rightSidebar').classList.add('collapsed');
        document.getElementById('toggleRightSidebar').textContent = '◀';
        const floatToggle = document.getElementById('rightSidebarFloatToggle');
        if (floatToggle) floatToggle.style.display = 'block';
    }
    if (state.previewCollapsed) {
        document.getElementById('previewPane').classList.add('collapsed');
        document.getElementById('togglePreview').textContent = '▲';
    }
    
    // Initialize resizers
    initResizers();
    
    // Add event listeners
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('toggleLeftSidebar').addEventListener('click', toggleLeftSidebar);
    document.getElementById('toggleRightSidebar').addEventListener('click', toggleRightSidebar);
    
    // Floating toggle button for collapsed right sidebar
    const rightSidebarFloatToggle = document.getElementById('rightSidebarFloatToggle');
    if (rightSidebarFloatToggle) {
        rightSidebarFloatToggle.addEventListener('click', toggleRightSidebar);
    }
    
    document.getElementById('togglePreview').addEventListener('click', togglePreview);
    
    // Window controls
    if (window.electronAPI) {
        document.getElementById('windowMinimize').addEventListener('click', () => {
            window.electronAPI.minimizeWindow();
        });
        
        document.getElementById('windowMaximize').addEventListener('click', () => {
            window.electronAPI.maximizeWindow();
            // Update button text based on maximized state
            setTimeout(() => {
                window.electronAPI.isWindowMaximized().then(maximized => {
                    const btn = document.getElementById('windowMaximize');
                    btn.textContent = maximized ? '❐' : '□';
                });
            }, 100);
        });
        
        document.getElementById('windowClose').addEventListener('click', () => {
            window.electronAPI.closeWindow();
        });
        
        // Update maximize button on window state change
        if (window.electronAPI.isWindowMaximized) {
            window.electronAPI.isWindowMaximized().then(maximized => {
                const btn = document.getElementById('windowMaximize');
                if (btn) btn.textContent = maximized ? '❐' : '□';
            });
        }
    }

    // Journal buttons
    const buildBtn = document.getElementById('btnBuildJournal');
    const exportBtn = document.getElementById('btnExportJournal');
    if (buildBtn) {
        buildBtn.addEventListener('click', async () => {
            if (!window.electronAPI || !window.electronAPI.runNpmScript) return alert('IPC not ready');
            buildBtn.disabled = true; buildBtn.textContent = '⏳ Building...';
            const outDir = (state.currentProject && state.currentProject.path) ? state.currentProject.path : process.cwd();
            const res = await window.electronAPI.runNpmScript('journal:html', outDir);
            buildBtn.disabled = false; buildBtn.textContent = '📝 Build Journal';
            if (res && res.success) alert('Journal HTML generated in: ' + outDir); else alert('Build failed: ' + (res && (res.err||res.error)));
        });
    }
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            if (!window.electronAPI || !window.electronAPI.runNpmScript) return alert('IPC not ready');
            exportBtn.disabled = true; exportBtn.textContent = '⏳ Exporting...';
            const outDir = (state.currentProject && state.currentProject.path) ? state.currentProject.path : process.cwd();
            const res = await window.electronAPI.runNpmScript('journal:pdf', outDir);
            exportBtn.disabled = false; exportBtn.textContent = '📄 Export PDF';
            if (res && res.success) alert('PDF exported to: ' + outDir.replace(/\\/g,'/') + '/exports'); else alert('Export failed: ' + (res && (res.err||res.error)));
        });
    }

    const settingsBtn = document.getElementById('btnJournalSettings');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => showJournalSettingsModal());
    }
    
    const genreBtn = document.getElementById('btnGenreRules');
    if (genreBtn) {
        genreBtn.addEventListener('click', openGenreEditorModal);
    }
    initGenreModal();
    
    // Initialize chat interface
    initChatInterface();
    
    // Load chat history
    loadChatHistory();
    
    // Auto-bundle toggle
    const autoToggle = document.getElementById('autoBundleToggle');
    if (autoToggle) {
        autoToggle.checked = state.autoBundle;
        autoToggle.addEventListener('change', () => {
            state.autoBundle = autoToggle.checked;
            console.log('Auto-bundle set to:', state.autoBundle);
            updatePreview();
        });
    }
    const openExternalBtn = document.getElementById('previewOpenExternal');
    if (openExternalBtn) {
        openExternalBtn.addEventListener('click', async () => {
            try {
                if (!state.lastBundledCode) {
                    setBundleLog('No bundled code available - try reloading with Auto-bundle ON', true);
                    return;
                }
                const baseUrl = 'gf:///' + (state.currentProject?.path || process.cwd()).replace(/\\/g, '/') + '/';
                const html = buildExternalPreviewHtml(state.lastBundledCode, baseUrl);
                const res = await window.electronAPI.previewOpenExternal(html);
                if (!res || !res.success) {
                    setBundleLog('Failed to open external preview: ' + (res && res.error), true);
                } else {
                    setBundleLog('Opened external preview at: ' + res.path);
                }
            } catch (e) {
                setBundleLog('Error opening external preview: ' + e.message, true);
            }
        });
    }
    const logToggle = document.getElementById('bundleLogToggle');
    if (logToggle) {
        logToggle.addEventListener('click', () => {
            const el = document.getElementById('bundleLog');
            if (!el) return;
            const vis = el.style.display !== 'none';
            el.style.display = vis ? 'none' : 'block';
        });
    }

    // Receive runtime errors from iframe and forward to log
    window.addEventListener('message', (evt) => {
        const data = evt.data || {};
        if (data.type === 'runtime-error') {
            const msg = data.message || 'Runtime error';
            const stack = data.stack ? ('\n' + data.stack) : '';
            setBundleLog('Runtime: ' + msg + stack, true);
        }
    });
    
    console.log('✅ Panel resizing initialized');
    console.log('✅ Theme toggle initialized');
    console.log('✅ Window state persistence initialized');
    
    // Initialize Monaco Editor when ready
    window.initMonacoEditor = initMonacoEditor;
    
    // If Monaco is already loaded, initialize it
    if (typeof monaco !== 'undefined') {
        initMonacoEditor();
        setTimeout(() => {
            setupHotReload();
        }, 500);
    }
    
    // Initialize preview system
    initPreview();
    initPreviewControls();
    
    // Setup menu handlers (Phase 4)
    setupMenuHandlers();
    
    // Demo: Load sample file tree (remove in Phase 4 when real file system is implemented)
    // Don't auto-load demo - show welcome screen instead
    // loadDemoFileTree();
});

// Demo File Tree (Phase 2 - will be replaced with real file system in Phase 4)
function loadDemoFileTree() {
    const demoFiles = [
        { type: 'folder', name: 'src', path: '/src' },
        { type: 'file', name: 'main.js', path: '/src/main.js' },
        { type: 'file', name: 'game.js', path: '/src/game.js' },
        { type: 'folder', name: 'scenes', path: '/src/scenes' },
        { type: 'file', name: 'PreloadScene.js', path: '/src/scenes/PreloadScene.js' },
        { type: 'file', name: 'GameScene.js', path: '/src/scenes/GameScene.js' },
        { type: 'file', name: 'index.html', path: '/index.html' },
        { type: 'file', name: 'style.css', path: '/style.css' },
        { type: 'file', name: 'package.json', path: '/package.json' }
    ];
    
    renderFileTree(demoFiles);
    
    // Auto-open game.js with sample Phaser code
    setTimeout(() => {
        const gameContent = `// Sample Phaser.js Game
// Try editing this code and watch the preview update!

// This code will be merged with the default Phaser template

// Example: Change player color
function preload() {
    // Custom player sprite
    this.add.graphics()
        .fillStyle(0x00a2ff)  // Try changing this color!
        .fillRect(0, 0, 64, 64)
        .generateTexture('player', 64, 64);
}

// Example: Add custom behavior
function create() {
    // Create a sprite to see something!
    var playerSprite = this.add.sprite(400, 300, 'player');
    
    // Add some text
    this.add.text(400, 50, 'VIBE IDE Preview', {
        fontSize: '32px',
        fill: '#ffffff',
        fontFamily: 'Arial'
    }).setOrigin(0.5);
    
    this.add.text(400, 550, 'Edit your code above to see changes!', {
        fontSize: '16px',
        fill: '#888888',
        fontFamily: 'Arial'
    }).setOrigin(0.5);
    
    console.log('Game created!');
}

// Example: Custom movement
function update() {
    // Your custom update logic here
    // Try adding: player.setRotation(player.rotation + 0.01);
}`;
        
        createTab('/src/game.js', 'game.js', gameContent);
    }, 1000);
}

// Monaco Editor Initialization
function initMonacoEditor() {
    if (state.monacoEditor) {
        console.log('Monaco Editor already initialized');
        return;
    }
    
    const editorContainer = document.getElementById('monacoEditor');
    if (!editorContainer) {
        console.error('Monaco Editor container not found');
        return;
    }
    
    if (typeof monaco === 'undefined') {
        console.error('Monaco Editor library not loaded');
        editorContainer.innerHTML = '<div style="padding: 20px; color: #f48771;">Monaco Editor failed to load. Please refresh the app.</div>';
        return;
    }
    
    try {
        // Don't show editor container - it will be shown when a tab is opened
        // editorContainer.style.display = 'block'; // Only show when tab is active
        editorContainer.style.width = '100%';
        editorContainer.style.height = '100%';
        
        // Create Monaco Editor instance
        state.monacoEditor = monaco.editor.create(editorContainer, {
            value: '// Welcome to VIBE IDE!\n// Start coding your project here...\n\nconsole.log("Hello, VIBE IDE!");',
            language: 'javascript',
            theme: state.theme === 'dark' ? 'vs-dark' : 'vs',
            fontSize: 14,
            lineNumbers: 'on',
            minimap: { enabled: true },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            formatOnPaste: true,
            formatOnType: true,
            tabSize: 2
        });
        
        console.log('✅ Monaco Editor initialized successfully');
        
        // Initial layout
        setTimeout(() => {
            if (state.monacoEditor) {
                state.monacoEditor.layout();
                setupHotReload();
            }
        }, 100);
    } catch (error) {
        console.error('Error initializing Monaco Editor:', error);
        editorContainer.innerHTML = `<div style="padding: 20px; color: #f48771;">Error initializing Monaco Editor: ${error.message}</div>`;
    }
}

// Tab System
function createTab(filePath, fileName, content = '') {
    const tabId = `tab-${Date.now()}`;
    const tab = {
        id: tabId,
        path: filePath,
        name: fileName,
        content: content,
        isDirty: false
    };
    
    state.openTabs.push(tab);
    renderTabs();
    switchToTab(tabId);
    
    return tab;
}

function renderTabs() {
    const tabsContainer = document.getElementById('editorTabs');
    tabsContainer.innerHTML = '';
    
    state.openTabs.forEach(tab => {
        const tabElement = document.createElement('div');
        tabElement.className = `tab ${tab.id === state.activeTab ? 'active' : ''}`;
        tabElement.setAttribute('data-tab-id', tab.id);
        tabElement.innerHTML = `
            <span class="tab-title">${tab.name}${tab.isDirty ? ' *' : ''}</span>
            <span class="tab-close" data-tab-close="${tab.id}">×</span>
        `;
        
        tabElement.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                switchToTab(tab.id);
            }
        });
        
        const closeBtn = tabElement.querySelector('.tab-close');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tab.id);
        });
        
        tabsContainer.appendChild(tabElement);
    });
    
    // Add Welcome tab if no tabs open
    if (state.openTabs.length === 0) {
        const welcomeTab = document.createElement('div');
        welcomeTab.className = 'tab active';
        welcomeTab.setAttribute('data-tab', 'welcome');
        welcomeTab.textContent = 'Welcome';
        tabsContainer.appendChild(welcomeTab);
    }
}

function switchToTab(tabId) {
    if (tabId === 'welcome') {
        state.activeTab = null;
        document.getElementById('welcomeScreen').style.display = 'block';
        loadRecentProjects(); // Refresh recent projects when showing welcome screen
        document.getElementById('monacoEditor').style.display = 'none';
        renderTabs();
        return;
    }
    
    const tab = state.openTabs.find(t => t.id === tabId);
    if (!tab) return;
    
    state.activeTab = tabId;
    
    // Show editor, hide welcome
    document.getElementById('welcomeScreen').style.display = 'none';
    const editorContainer = document.getElementById('monacoEditor');
    editorContainer.style.display = 'block';
    
    // Ensure Monaco Editor is initialized
    if (!state.monacoEditor) {
        console.log('Monaco Editor not initialized, attempting to initialize...');
        if (typeof monaco !== 'undefined') {
            initMonacoEditor();
        } else {
            console.warn('Monaco Editor library not loaded yet, will retry...');
            // Retry initialization after a delay
            setTimeout(() => {
                if (typeof monaco !== 'undefined' && !state.monacoEditor) {
                    initMonacoEditor();
                } else if (!state.monacoEditor) {
                    editorContainer.innerHTML = '<div style="padding: 20px; color: #f48771;">Monaco Editor is still loading... Please wait or refresh.</div>';
                }
            }, 2000);
            renderTabs();
            return;
        }
    }
    
    // Update Monaco editor content
    if (state.monacoEditor && tab.content !== undefined) {
        state.monacoEditor.setValue(tab.content);
        // Set language based on file extension
        const language = getLanguageFromFileName(tab.name);
        monaco.editor.setModelLanguage(state.monacoEditor.getModel(), language);
        
        // Trigger layout update
        setTimeout(() => {
            if (state.monacoEditor) {
                state.monacoEditor.layout();
            }
        }, 100);
        
        // Update preview if it's a JS or HTML file
        if (tab.name.endsWith('.js') || tab.name.endsWith('.html')) {
            setTimeout(() => {
                updatePreview();
            }, 500);
        }
    }
    
    renderTabs();
    
    // Update file tree selection
    updateFileTreeSelection(tab.path);
}

function closeTab(tabId) {
    const tabIndex = state.openTabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;
    
    const tab = state.openTabs[tabIndex];
    
    // Save content before closing
    if (state.monacoEditor && state.activeTab === tabId) {
        tab.content = state.monacoEditor.getValue();
    }
    
    state.openTabs.splice(tabIndex, 1);
    
    // Switch to another tab or welcome screen
    if (state.openTabs.length > 0) {
        const nextTab = state.openTabs[Math.min(tabIndex, state.openTabs.length - 1)];
        switchToTab(nextTab.id);
    } else {
        switchToTab('welcome');
    }
}

function getLanguageFromFileName(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const languageMap = {
        'js': 'javascript',
        'json': 'json',
        'html': 'html',
        'css': 'css',
        'md': 'markdown',
        'ts': 'typescript',
        'py': 'python',
        'php': 'php',
        'xml': 'xml',
        'yaml': 'yaml',
        'yml': 'yaml'
    };
    return languageMap[ext] || 'plaintext';
}

// File Tree Functions
function renderFileTree(files) {
    const fileTreeContainer = document.querySelector('.file-tree');
    fileTreeContainer.innerHTML = '';
    
    if (!files || files.length === 0) {
        fileTreeContainer.innerHTML = '<div class="tree-item folder"><span class="tree-icon">📁</span><span class="tree-label">No project loaded</span></div>';
        return;
    }
    
    files.forEach(file => {
        const treeItem = createTreeItem(file);
        fileTreeContainer.appendChild(treeItem);
    });
}

function createTreeItem(file) {
    const item = document.createElement('div');
    item.className = `tree-item ${file.type}`;
    item.setAttribute('data-path', file.path);
    
    const icon = file.type === 'folder' ? '📁' : getFileIcon(file.name);
    
    item.innerHTML = `
        <span class="tree-icon">${icon}</span>
        <span class="tree-label">${file.name}</span>
    `;
    
    if (file.type === 'file') {
        item.addEventListener('click', () => {
            openFile(file.path, file.name);
        });
    } else if (file.type === 'folder') {
        item.addEventListener('click', () => {
            toggleFolder(item);
        });
    }
    
    return item;
}

function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const iconMap = {
        'js': '📄',
        'json': '📋',
        'html': '🌐',
        'css': '🎨',
        'md': '📝',
        'png': '🖼️',
        'jpg': '🖼️',
        'jpeg': '🖼️',
        'gif': '🖼️',
        'svg': '🖼️',
        'mp3': '🔊',
        'wav': '🔊',
        'ogg': '🔊'
    };
    return iconMap[ext] || '📄';
}

function toggleFolder(item) {
    item.classList.toggle('expanded');
    // TODO: Load folder contents when expanded
}

async function openFile(filePath, fileName) {
    // Check if file is already open
    const existingTab = state.openTabs.find(t => t.path === filePath);
    if (existingTab) {
        switchToTab(existingTab.id);
        return;
    }
    
    // Load file content from file system (Phase 4)
    await openFileFromPath(filePath);
}

function updateFileTreeSelection(filePath) {
    document.querySelectorAll('.tree-item').forEach(item => {
        item.classList.remove('selected');
        if (item.getAttribute('data-path') === filePath) {
            item.classList.add('selected');
        }
    });
}

// Update theme for Monaco Editor
function updateMonacoTheme() {
    if (state.monacoEditor) {
        monaco.editor.setTheme(state.theme === 'dark' ? 'vs-dark' : 'vs');
    }
    if (state.genreEditor && state.genreEditor.jsonEditor) {
        state.genreEditor.jsonEditor.updateOptions({
            theme: state.theme === 'dark' ? 'vs-dark' : 'vs'
        });
    }
}

// Preview System (Phase 3)
function initPreview() {
    const previewFrame = document.getElementById('previewFrame');
    const previewLoading = document.getElementById('previewLoading');
    
    if (!previewFrame) return;
    
    // Load Phaser and inject into preview HTML
    loadPreviewWithPhaser();
}

function loadPreviewWithPhaser() {
    const previewFrame = document.getElementById('previewFrame');
    const previewLoading = document.getElementById('previewLoading');
    
    try {
        // Use Node.js require (stored before Monaco replaced it)
        const nodeRequire = window.nodeRequire || require;
        
        // Load Phaser code from file system
        const fs = nodeRequire('fs');
        const path = nodeRequire('path');
        const appPath = process.cwd();
        const phaserPath = path.join(appPath, 'node_modules', 'phaser', 'dist', 'phaser.min.js');
        
        if (!fs.existsSync(phaserPath)) {
            console.error('Phaser.js not found at:', phaserPath);
            previewLoading.innerHTML = '<p style="color: #f48771;">❌ Phaser.js not found</p>';
            return;
        }
        
        console.log('Loading Phaser from:', phaserPath);
        const phaserCode = fs.readFileSync(phaserPath, 'utf-8');
        
        // Load preview template - use relative path from renderer directory
        const previewTemplatePath = path.join(appPath, 'src', 'renderer', 'preview-templates', 'preview.html');
        console.log('Loading preview template from:', previewTemplatePath);
        
        if (!fs.existsSync(previewTemplatePath)) {
            console.error('Preview template not found at:', previewTemplatePath);
            previewLoading.innerHTML = '<p style="color: #f48771;">❌ Preview template not found</p>';
            return;
        }
        
        let previewHtml = fs.readFileSync(previewTemplatePath, 'utf-8');
        
        // Inject Phaser code where the placeholder is - wrap in IIFE to avoid scope issues
        previewHtml = previewHtml.replace(
            '<!-- Phaser code injected here -->',
            `<script>
                (function() {
                    try {
                        ${phaserCode}
                        console.log('✅ Phaser.js loaded successfully');
                    } catch (e) {
                        console.error('Error loading Phaser:', e);
                    }
                })();
            </script>`
        );
        
        // Create blob URL from modified HTML
        const blob = new Blob([previewHtml], { type: 'text/html' });
        const blobUrl = URL.createObjectURL(blob);
        
        console.log('Loading preview with injected Phaser...');
        previewFrame.src = blobUrl;
        
        previewFrame.onload = () => {
            state.previewFrame = previewFrame.contentWindow;
            state.previewLoaded = true;
            previewLoading.style.display = 'none';
            previewFrame.style.display = 'block';
            console.log('✅ Preview frame loaded with Phaser');
            
            // Check if Phaser is available
            setTimeout(() => {
                try {
                    // Check Phaser in the iframe's window context
                    const iframeWindow = previewFrame.contentWindow;
                    if (iframeWindow && typeof iframeWindow.Phaser !== 'undefined') {
                        console.log('✅ Phaser available in preview frame');
                    } else {
                        console.warn('⚠️ Phaser not found in preview frame window');
                        // Try checking global scope
                        if (typeof Phaser !== 'undefined') {
                            console.log('✅ Phaser found in global scope');
                        }
                    }
                    updatePreview();
                } catch (e) {
                    console.error('Error checking Phaser:', e);
                    updatePreview(); // Try anyway
                }
            }, 1000); // Wait longer for Phaser to initialize
        };
        
        previewFrame.onerror = () => {
            previewLoading.innerHTML = '<p style="color: #f48771;">❌ Failed to load preview</p>';
            console.error('Failed to load preview template');
        };
    } catch (error) {
        console.error('Error loading preview with Phaser:', error);
        previewLoading.innerHTML = '<p style="color: #f48771;">❌ Error: ' + error.message + '</p>';
    }
}

async function updatePreview() {
    if (!state.previewLoaded) {
        showPreviewMessage('📝 Preview not ready. Click Play to start!');
        return;
    }
    
    const activeTab = state.openTabs.find(t => t.id === state.activeTab);
    const jsFiles = state.openTabs.filter(tab => tab.name.endsWith('.js'));
    const htmlFiles = state.openTabs.filter(tab => tab.name.endsWith('.html'));
    
    // If a project is open and autoBundle enabled, bundle first regardless of active file
    if (state.autoBundle && state.currentProject && state.currentProject.path) {
        try {
            const projectRoot = state.currentProject.path;
            
            // Try src/main.js first (for complex projects like TFA), fall back to game.js (for simple templates)
            let entryPath = projectRoot.replace(/\\/g, '/') + '/src/main.js';
            const mainJsPath = entryPath;
            const gameJsPath = projectRoot.replace(/\\/g, '/') + '/game.js';
            
            // Check if src/main.js exists, fall back to game.js if not
            const mainExists = await window.electronAPI.fileExists(mainJsPath);
            if (!mainExists.success || !mainExists.exists) {
                const gameExists = await window.electronAPI.fileExists(gameJsPath);
                if (gameExists.success && gameExists.exists) {
                    entryPath = gameJsPath;
                    console.log('📝 Using game.js as entry point (src/main.js not found)');
                } else {
                    setBundleLog(`⚠️ No entry point found (checked src/main.js and game.js)`);
                    console.warn('⚠️ No entry point found for bundling');
                    return; // Don't try to bundle if no entry point exists
                }
            }
            
            console.log('🔧 [Auto-bundle] entry:', entryPath);
            
            // For simple game.js templates, skip bundling and use raw file content
            const isSimpleTemplate = entryPath.endsWith('/game.js');
            let codeToWrap = null;
            
            if (isSimpleTemplate) {
                // Read raw file content instead of bundling
                console.log('📄 [Simple Template] Reading raw game.js content (skipping bundling)');
                try {
                    const fileResult = await window.electronAPI.readFile(entryPath);
                    if (fileResult.success && fileResult.content) {
                        codeToWrap = fileResult.content;
                        console.log('✅ [Simple Template] Read game.js, length:', codeToWrap.length);
                    } else {
                        setBundleLog(`⚠️ Could not read game.js: ${fileResult.error || 'unknown error'}`);
                        return;
                    }
                } catch (error) {
                    setBundleLog(`⚠️ Error reading game.js: ${error.message}`);
                    return;
                }
            } else {
                // Bundle complex projects (src/main.js)
                if (window.electronAPI && window.electronAPI.bundleEsbuild) {
                    const res = await window.electronAPI.bundleEsbuild(entryPath, projectRoot);
                    if (res && res.success && res.code) {
                        codeToWrap = res.code;
                        console.log('✅ [Bundle] esbuild succeeded, size:', codeToWrap.length);
                    } else {
                        const msg = 'Auto-bundle failed: ' + (res && res.error ? res.error : 'unknown error');
                        setBundleLog(msg, true);
                        console.warn('[Auto-bundle] failed:', res && res.error);
                        showPreviewMessage('❌ ' + msg);
                        return;
                    }
                } else {
                    setBundleLog('⚠️ esbuild not available');
                    return;
                }
            }
            
            // Wrap code in Phaser config if needed
            if (codeToWrap) {
                const hasPreload = /function\s+preload\s*\(/i.test(codeToWrap);
                const hasCreate = /function\s+create\s*\(/i.test(codeToWrap);
                const hasUpdate = /function\s+update\s*\(/i.test(codeToWrap);
                const hasConfig = /var\s+config\s*=|const\s+config\s*=|let\s+config\s*=/i.test(codeToWrap);
                
                console.log('🔍 [Wrap] Checking code structure:', {
                    hasPreload,
                    hasCreate,
                    hasUpdate,
                    hasConfig,
                    isSimpleTemplate,
                    codeLength: codeToWrap.length
                });
                
                // Wrap if it's a simple template OR has lifecycle functions but no config
                let wrappedCode = codeToWrap;
                if (isSimpleTemplate || ((hasPreload || hasCreate || hasUpdate) && !hasConfig)) {
                    wrappedCode = `// VIBE IDE - Phaser.js Game${isSimpleTemplate ? ' (Simple Template)' : ' (Bundled)'}
// Auto-wrapped code

console.log('📦 [VIBE IDE] Executing code wrapper...');

// Phaser configuration (functions will be hoisted)
var config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    backgroundColor: '#2d2d2d',
    scene: {
        preload: preload,
        create: create,
        update: update
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 300 },
            debug: false
        }
    }
};

console.log('📦 [VIBE IDE] Config created, executing code...');

// Execute code (defines preload, create, update functions)
${codeToWrap}

console.log('📦 [VIBE IDE] Code executed, checking functions:', {
    preload: typeof preload,
    create: typeof create,
    update: typeof update,
    config: typeof config
});

// Start the game
console.log('📦 [VIBE IDE] Creating Phaser.Game instance...');
window.gameInstance = new Phaser.Game(config);
console.log('📦 [VIBE IDE] Phaser.Game instance created:', !!window.gameInstance);
`;
                    console.log('📦 Wrapped code in Phaser config' + (isSimpleTemplate ? ' (simple template)' : ''));
                }
                
                state.lastBundledCode = wrappedCode;
                setBundleLog(`${isSimpleTemplate ? 'Read' : 'Bundle'} OK (size ${wrappedCode.length} bytes) for ${entryPath}`);
                console.log(`✅ ${isSimpleTemplate ? 'Read' : 'Bundle'} succeeded, size:`, wrappedCode.length);
                const previewFrame = document.getElementById('previewFrame');
                if (previewFrame && previewFrame.contentWindow) {
                    try {
                        const baseUrl = 'gf:///' + projectRoot.replace(/\\/g, '/') + '/';
                        previewFrame.contentWindow.postMessage({ type: 'set-base-url', baseUrl }, '*');
                        console.log('Sent base URL to preview:', baseUrl);
                    } catch (e) { console.warn('Failed sending base URL:', e.message); }
                    
                    previewFrame.contentWindow.postMessage({ type: 'update-code', code: wrappedCode }, '*');
                    const previewLoading = document.getElementById('previewLoading');
                    previewLoading.style.display = 'none';
                    previewFrame.style.display = 'block';
                    state.previewRunning = true;
                    updatePreviewControls();
                    return;
                }
            }
        } catch (e) {
            setBundleLog('Auto-bundle error: ' + e.message, true);
            console.error('[Auto-bundle] error:', e);
            showPreviewMessage('❌ Auto-bundle error: ' + e.message);
        }
    }
    
    // Otherwise, HTML preview if HTML file is active
    if (activeTab && activeTab.name.endsWith('.html')) {
        // Prefer reading from disk if we have a real path
        let diskValue = '';
        if (activeTab.path) {
            try {
                const res = await window.electronAPI.readFile(activeTab.path);
                if (res && res.success) {
                    diskValue = res.content || '';
                }
            } catch (e) {
                console.warn('ReadFile failed for HTML preview:', e.message);
            }
        }
        const editorValue = state.monacoEditor ? state.monacoEditor.getValue() : '';
        const fallbackValue = (activeTab.content || '');
        const chosen = diskValue || (state.monacoEditor ? editorValue : fallbackValue);
        
        console.log('📄 HTML Preview - Active tab:', activeTab.name);
        console.log('📄 Active tab path:', activeTab.path || '(no path)');
        console.log('📄 Disk value length:', diskValue.length);
        console.log('📄 Monaco value length:', editorValue ? editorValue.length : 0);
        console.log('📄 Tab.content length:', fallbackValue.length);
        console.log('📄 HTML Content length (used):', chosen.length);
        console.log('📄 HTML Has body tag:', chosen.includes('<body'));
        console.log('📄 HTML Has closing body tag:', chosen.includes('</body>'));
        
        // Directly set iframe srcdoc to replace the entire document (avoid nested iframe)
        const previewFrameEl = document.getElementById('previewFrame');
        if (previewFrameEl) {
            try {
                previewFrameEl.onload = () => {
                    state.previewFrame = previewFrameEl.contentWindow;
                    state.previewRunning = true;
                    document.getElementById('previewLoading').style.display = 'none';
                    previewFrameEl.style.display = 'block';
                    console.log('✅ HTML srcdoc loaded into preview iframe');
                };
                previewFrameEl.srcdoc = chosen;
                return;
            } catch (error) {
                console.error('Error setting iframe srcdoc:', error);
                showPreviewMessage('❌ Error updating preview: ' + error.message);
                return;
            }
        }
    }
    
    // Legacy JS glue fallback
    if (jsFiles.length === 0) {
        showPreviewMessage('📝 No JavaScript files open. Create a game file to see preview!');
        return;
    }
    let gameCode = generateGameCode(jsFiles);
    if (state.previewFrame) {
        try {
            state.previewFrame.postMessage({ type: 'update-code', code: gameCode }, '*');
            state.previewRunning = true;
            updatePreviewControls();
            const previewLoading = document.getElementById('previewLoading');
            const previewFrame = document.getElementById('previewFrame');
            previewLoading.style.display = 'none';
            previewFrame.style.display = 'block';
            console.log('✅ Game code sent to preview');
        } catch (error) {
            console.error('Error sending code to preview:', error);
            showPreviewMessage('❌ Error updating preview: ' + error.message);
        }
    }
}

function generateGameCode(files) {
    // Check if user code defines the Phaser lifecycle functions
    const userCode = files.map(f => f.content || '').join('\n\n');
    const hasPreload = /function\s+preload\s*\(/i.test(userCode) || /preload\s*:\s*function/i.test(userCode);
    const hasCreate = /function\s+create\s*\(/i.test(userCode) || /create\s*:\s*function/i.test(userCode);
    const hasUpdate = /function\s+update\s*\(/i.test(userCode) || /update\s*:\s*function/i.test(userCode);
    const hasConfig = /var\s+config\s*=|const\s+config\s*=|let\s+config\s*=/i.test(userCode);
    
    let code = `// VIBE IDE - Phaser.js Game
// Auto-generated from your code files

`;

    // Only add default template if user hasn't defined config
    if (!hasConfig) {
        code += `// Phaser configuration
var config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    backgroundColor: '#2d2d2d',
    scene: {
        preload: preload,
        create: create,
        update: update
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 300 },
            debug: false
        }
    }
};

// Game instance variables
var game;
var player;

`;
    }

    // Add default functions only if user hasn't defined them
    if (!hasPreload) {
        code += `function preload() {
    // Create a simple colored rectangle as placeholder
    this.add.graphics()
        .fillStyle(0x00ff00)
        .fillRect(0, 0, 64, 64)
        .generateTexture('player', 64, 64);
}

`;
    }

    if (!hasCreate) {
        code += `function create() {
    // Create game objects
    player = this.physics.add.sprite(400, 300, 'player');
    player.setCollideWorldBounds(true);
    
    // Add text
    this.add.text(400, 50, 'VIBE IDE Preview', {
        fontSize: '32px',
        fill: '#ffffff',
        fontFamily: 'Arial'
    }).setOrigin(0.5);
    
    this.add.text(400, 550, 'Edit your code above to see changes!', {
        fontSize: '16px',
        fill: '#888888',
        fontFamily: 'Arial'
    }).setOrigin(0.5);
    
    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
}

`;
    }

    if (!hasUpdate) {
        code += `function update() {
    // Player movement
    if (this.cursors && this.cursors.left.isDown) {
        player.setVelocityX(-200);
    } else if (this.cursors && this.cursors.right.isDown) {
        player.setVelocityX(200);
    } else {
        if (player) player.setVelocityX(0);
    }
    
    if (this.cursors && this.cursors.up.isDown && player && player.body && player.body.touching.down) {
        player.setVelocityY(-400);
    }
}

`;
    }

    // Add user code from files
    files.forEach(file => {
        if (file.content && file.content.trim()) {
            code += `\n\n// === ${file.name} ===\n`;
            code += file.content;
        }
    });

    // Start the game if config exists
    if (!hasConfig) {
        code += `\n\n// Start the game
window.gameInstance = new Phaser.Game(config);
`;
    } else {
        // User defined config, but might not have started the game
        code += `\n\n// Start the game (if not already started)
if (!window.gameInstance && typeof config !== 'undefined') {
    window.gameInstance = new Phaser.Game(config);
}
`;
    }
    
    return code;
}

function showPreviewMessage(message) {
    const previewLoading = document.getElementById('previewLoading');
    const previewFrame = document.getElementById('previewFrame');
    
    if (previewLoading) {
        previewLoading.innerHTML = `<p>${message}</p>`;
        previewLoading.style.display = 'block';
    }
    if (previewFrame) {
        previewFrame.style.display = 'none';
    }
}

function updatePreviewControls() {
    const playBtn = document.getElementById('previewPlay');
    const pauseBtn = document.getElementById('previewPause');
    
    if (playBtn && pauseBtn) {
        if (state.previewRunning) {
            playBtn.style.display = 'none';
            pauseBtn.style.display = 'inline-block';
        } else {
            playBtn.style.display = 'inline-block';
            pauseBtn.style.display = 'none';
        }
    }
}

// Preview Controls
function initPreviewControls() {
    const playBtn = document.getElementById('previewPlay');
    const pauseBtn = document.getElementById('previewPause');
    const restartBtn = document.getElementById('previewRestart');
    const reloadBtn = document.getElementById('previewReload');
    
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            if (!state.previewLoaded) {
                initPreview();
            } else {
                updatePreview();
            }
        });
    }
    
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            if (state.previewFrame) {
                state.previewFrame.postMessage({ type: 'pause' }, '*');
            }
        });
    }
    
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            if (state.previewFrame) {
                state.previewFrame.postMessage({ type: 'reload-game' }, '*');
            }
        });
    }
    
    if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
            updatePreview();
        });
    }
}

// Journal Settings Modal
async function showJournalSettingsModal() {
    const nodeRequire = window.nodeRequire || require;
    const path = nodeRequire('path');
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:520px;max-width:95vw;background:#1e1e1e;color:#e6f7ff;border:1px solid #3a3f47;border-radius:10px;box-shadow:0 6px 28px rgba(0,0,0,.6);padding:16px;';
    modal.innerHTML = `
      <h3 style="margin:0 0 10px;">Journal Settings</h3>
      <label style="display:block;margin:8px 0 4px;">Preset</label>
      <select id="js-preset" style="width:100%;padding:6px;background:#121417;color:#e6f7ff;border:1px solid #3a3f47;border-radius:6px;">
        <option value="neon">Neon Blue</option>
        <option value="synth">Synth Purple</option>
        <option value="sunset">Sunset Orange</option>
        <option value="mint">Mint Green</option>
        <option value="custom">Custom</option>
      </select>
      <label style="display:block;margin:8px 0 4px;">Base Color</label>
      <input id="js-base" type="color" value="#00a2ff" style="width:100%;height:36px;border:1px solid #3a3f47;border-radius:6px;background:#121417;">
      <label style="display:block;margin:8px 0 4px;">Tagline</label>
      <input id="js-tag" type="text" style="width:100%;padding:6px;background:#121417;color:#e6f7ff;border:1px solid #3a3f47;border-radius:6px;" placeholder="Create at the speed of imagination — without losing the pen.">
      <label style="display:block;margin:8px 0 4px;">Logo</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="js-logo" type="text" style="flex:1;padding:6px;background:#121417;color:#e6f7ff;border:1px solid #3a3f47;border-radius:6px;" placeholder="logo.jpg">
        <button id="js-choose" class="btn-small">Choose…</button>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button id="js-cancel" class="btn-small">Cancel</button>
        <button id="js-save" class="btn-small">Save</button>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Load existing config
    const projectPath = state.currentProject?.path || process.cwd();
    const cfgPath = path.join(projectPath, 'journal.config.json');
    try {
        const res = await window.electronAPI.readFile(cfgPath);
        if (res && res.success) {
            const cfg = JSON.parse(res.content);
            modal.querySelector('#js-base').value = cfg.base || '#00a2ff';
            modal.querySelector('#js-tag').value = cfg.coverTagline || '';
            modal.querySelector('#js-logo').value = cfg.logoPath || 'logo.jpg';
        }
    } catch {}

    const presetEl = modal.querySelector('#js-preset');
    const baseEl = modal.querySelector('#js-base');
    presetEl.addEventListener('change', () => {
        const p = presetEl.value;
        const map = { neon:'#00a2ff', synth:'#a000ff', sunset:'#ff7a00', mint:'#00e1a0' };
        if (map[p]) baseEl.value = map[p];
    });

    modal.querySelector('#js-choose').addEventListener('click', async () => {
        const picked = await window.electronAPI.openFile();
        if (picked && picked.path) {
            modal.querySelector('#js-logo').value = picked.path; // Original simple method
        }
    });
    modal.querySelector('#js-cancel').addEventListener('click', () => document.body.removeChild(overlay));
    modal.querySelector('#js-save').addEventListener('click', async () => {
        const cfg = {
            base: baseEl.value,
            logoPath: modal.querySelector('#js-logo').value || 'logo.jpg',
            coverTagline: modal.querySelector('#js-tag').value || '',
            pdf: { fullBleed: true }
        };
        try {
            await window.electronAPI.writeFile(cfgPath, JSON.stringify(cfg, null, 2));
            alert('Settings saved. Use Export PDF to apply.');
            document.body.removeChild(overlay);
        } catch (e) {
            alert('Failed to save: ' + e.message);
        }
    });
}

// Watch Monaco Editor for changes (hot reload)
function setupHotReload() {
    if (!state.monacoEditor) return;
    
    state.monacoEditor.onDidChangeModelContent(() => {
        // Save content to current tab
        if (state.activeTab) {
            const tab = state.openTabs.find(t => t.id === state.activeTab);
            if (tab) {
                tab.content = state.monacoEditor.getValue();
                tab.isDirty = true;
                renderTabs();
            }
        }
        
        // Auto-reload preview if enabled and JS file is open
        if (state.autoReload && state.previewLoaded) {
            const tab = state.openTabs.find(t => t.id === state.activeTab);
            if (tab && tab.name.endsWith('.js')) {
                // Debounce reload
                clearTimeout(state.reloadTimeout);
                state.reloadTimeout = setTimeout(() => {
                    updatePreview();
                }, 1000); // Wait 1 second after last change
            }
        }
    });
}

function setBundleLog(message, isError = false) {
    const logEl = document.getElementById('bundleLog');
    if (!logEl) return;
    logEl.style.display = 'block';
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.style.whiteSpace = 'pre-wrap';
    line.style.color = isError ? '#f48771' : '#9fe0ff';
    line.textContent = `[${time}] ${message}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
}

function buildExternalPreviewHtml(bundledCode, baseUrl) {
    return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VIBE IDE Preview</title>
<style>html,body{height:100%;margin:0;background:#000}#game-container{width:100%;height:100%}</style>
<script>window.GF_BASE_URL = ${JSON.stringify(baseUrl || '')};</script>
<script src="https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.min.js"></script>
</head><body><div id="game-container"></div>
<script>(function(){\ntry{${bundledCode}\n}catch(e){document.body.innerHTML='<pre style=\'color:#f48771\'>'+e.message+'</pre>';}})();</script>
</body></html>`;
}

// ============================================
// Genre Rule Editor
// ============================================

function deepClone(obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : null;
}

function initGenreModal() {
    const overlay = document.getElementById('genreModalOverlay');
    if (!overlay) return;
    state.genreEditor.overlay = overlay;

    const closeBtn = document.getElementById('genreModalClose');
    if (closeBtn) closeBtn.addEventListener('click', () => closeGenreEditorModal());

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeGenreEditorModal();
        }
    });

    const saveBtn = document.getElementById('genreSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', handleGenreSave);

    const exportBtn = document.getElementById('genreExportBtn');
    if (exportBtn) exportBtn.addEventListener('click', handleGenreExport);

    const deleteBtn = document.getElementById('genreDeleteBtn');
    if (deleteBtn) deleteBtn.addEventListener('click', handleGenreDelete);

    const resetBtn = document.getElementById('genreResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', handleGenreReset);

    const loadBundledBtn = document.getElementById('genreReloadBundledBtn');
    if (loadBundledBtn) loadBundledBtn.addEventListener('click', handleGenreLoadBundled);

    const newBtn = document.getElementById('genreNewBtn');
    if (newBtn) newBtn.addEventListener('click', handleGenreNew);

    const tabs = document.querySelectorAll('.genre-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchGenreTab(tab.dataset.tab));
    });

    // Watch form inputs for change detection
    const formIds = [
        'genreFieldName',
        'genreFieldVersion',
        'genreFieldPhaserVersion',
        'genreFieldAuthor',
        'genreFieldDescription',
        'genreFieldContext',
        'genreFieldValidation'
    ];
    formIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => setGenreDirty(true));
        }
    });
}

async function openGenreEditorModal() {
    const overlay = document.getElementById('genreModalOverlay');
    if (!overlay) return;

    overlay.style.display = 'flex';
    state.genreEditor.overlay = overlay;
    state.genreEditor.dirty = false;
    state.genreEditor.jsonDirty = false;
    state.genreEditor.activeTab = 'form';
    setGenreStatus('', 'info');
    switchGenreTab('form');

    await loadGenreListForEditor();

    // Prefer active project genre, otherwise first in list
    let initialGenre = state.currentProject?.genre || null;
    if (initialGenre && !state.genreEditor.genres.some(g => g.name === initialGenre)) {
        initialGenre = null;
    }
    if (!initialGenre && state.genreEditor.genres.length > 0) {
        initialGenre = state.genreEditor.genres[0].name;
    }

    if (initialGenre) {
        await selectGenreForEditor(initialGenre);
    } else {
        setGenreStatus('No genre rules found. Create a new rule to get started.', 'warning');
    }

    setTimeout(() => {
        ensureGenreJsonEditor(true);
        refreshGenreButtons();
    }, 200);
}

function closeGenreEditorModal(force = false) {
    if (!force && state.genreEditor.dirty) {
        const shouldClose = window.confirm('You have unsaved changes. Close without saving?');
        if (!shouldClose) return;
    }
    const overlay = state.genreEditor.overlay;
    if (overlay) {
        overlay.style.display = 'none';
    }
    state.genreEditor.current = null;
    state.genreEditor.rule = null;
    state.genreEditor.originalRule = null;
    state.genreEditor.bundledRule = null;
    state.genreEditor.isBundled = false;
    state.genreEditor.hasOverride = false;
    state.genreEditor.dirty = false;
    state.genreEditor.jsonDirty = false;
    setGenreStatus('', 'info');
}

async function loadGenreListForEditor() {
    try {
        const res = await window.electronAPI.listAvailableGenres();
        if (res && res.success) {
            state.genreEditor.genres = res.genres || [];
        } else {
            state.genreEditor.genres = [];
            setGenreStatus('Failed to load genre list: ' + (res && res.error ? res.error : 'unknown error'), 'error');
        }
    } catch (error) {
        state.genreEditor.genres = [];
        setGenreStatus('Error loading genre list: ' + error.message, 'error');
    }
    renderGenreListForEditor();
}

function renderGenreListForEditor() {
    const listEl = document.getElementById('genreList');
    if (!listEl) return;

    listEl.innerHTML = '';
    let genresToShow = Array.isArray(state.genreEditor.genres) ? [...state.genreEditor.genres] : [];

    if (state.genreEditor.isNew && state.genreEditor.current && !genresToShow.some(g => g.name === state.genreEditor.current)) {
        genresToShow.push({
            name: state.genreEditor.current,
            isBundled: false,
            hasOverride: false,
            source: 'custom'
        });
    }

    if (genresToShow.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'genre-list-empty';
        empty.textContent = 'No genre rules available. Create a new rule to get started.';
        listEl.appendChild(empty);
        return;
    }

    genresToShow.sort((a, b) => a.name.localeCompare(b.name));

    genresToShow.forEach(genre => {
        const item = document.createElement('div');
        item.className = 'genre-item' + (state.genreEditor.current === genre.name ? ' active' : '');

        const name = document.createElement('div');
        name.className = 'genre-name';
        name.textContent = genre.name;
        item.appendChild(name);

        const metaRow = document.createElement('div');
        metaRow.className = 'genre-meta';

        const basePill = document.createElement('span');
        basePill.className = 'genre-pill' + (genre.isBundled ? '' : ' custom');
        basePill.textContent = genre.isBundled ? 'Bundled' : 'Custom';
        metaRow.appendChild(basePill);

        if (genre.hasOverride) {
            const overridePill = document.createElement('span');
            overridePill.className = 'genre-pill custom';
            overridePill.textContent = 'Override';
            metaRow.appendChild(overridePill);
        }

        item.appendChild(metaRow);
        item.addEventListener('click', () => selectGenreForEditor(genre.name));
        listEl.appendChild(item);
    });
}

async function selectGenreForEditor(genreName, options = {}) {
    if (state.genreEditor.dirty && !options.force) {
        const proceed = window.confirm('You have unsaved changes. Discard and switch to another rule?');
        if (!proceed) {
            return;
        }
    }

    setGenreStatus('Loading rule…', 'info');

    try {
        const res = await window.electronAPI.loadGenreRule(genreName);
        if (!res || !res.success) {
            setGenreStatus('Failed to load genre rule: ' + (res && res.error ? res.error : 'unknown error'), 'error');
            return;
        }

        state.genreEditor.current = genreName;
        state.genreEditor.rule = deepClone(res.rule) || {};
        state.genreEditor.originalRule = deepClone(res.rule) || {};
        state.genreEditor.isBundled = res.source !== 'user';
        state.genreEditor.hasOverride = !!res.userExists && res.source === 'user';
        state.genreEditor.bundledRule = null;
        state.genreEditor.isNew = false;
        state.genreEditor.dirty = false;
        state.genreEditor.jsonDirty = false;

        if (res.bundledExists) {
            const bundledRes = await window.electronAPI.loadGenreRule(genreName, { source: 'bundled' });
            if (bundledRes && bundledRes.success) {
                state.genreEditor.bundledRule = deepClone(bundledRes.rule);
            }
        }

        populateGenreForm(state.genreEditor.rule);
        updateGenreJsonEditor(state.genreEditor.rule);
        updateGenreHeader();
        renderGenreListForEditor();
        refreshGenreButtons();
        setGenreStatus('Loaded rule "' + genreName + '"' + (state.genreEditor.hasOverride ? ' (override)' : ''), 'success');
    } catch (error) {
        setGenreStatus('Error loading genre rule: ' + error.message, 'error');
    }
}

function populateGenreForm(rule) {
    if (!rule) return;
    document.getElementById('genreFieldName').value = rule.genre || '';
    document.getElementById('genreFieldVersion').value = rule.version || '';
    document.getElementById('genreFieldPhaserVersion').value = rule.phaserVersion || '';
    document.getElementById('genreFieldAuthor').value = rule.author || '';
    document.getElementById('genreFieldDescription').value = rule.description || '';

    const aiSuggestions = rule.aiSuggestions || {};
    document.getElementById('genreFieldContext').value = aiSuggestions.context || '';
    state.genreEditor.codeExamples = deepClone(aiSuggestions.codeExamples || []);
    state.genreEditor.commonBugs = Array.isArray(aiSuggestions.commonBugs) ? [...aiSuggestions.commonBugs] : [];
    state.genreEditor.performanceTips = Array.isArray(aiSuggestions.performanceTips) ? [...aiSuggestions.performanceTips] : [];
    renderGenreCodeExamples();
    renderGenreTagList('commonBugs');
    renderGenreTagList('performanceTips');

    applyStructuredPatterns(rule.commonPatterns || {});

    document.getElementById('genreFieldValidation').value = JSON.stringify(rule.validationRules || {}, null, 2);

    const nameField = document.getElementById('genreFieldName');
    if (nameField) {
        nameField.disabled = !state.genreEditor.isNew;
    }
}

function ensureGenreJsonEditor(forceLayout = false) {
    if (typeof monaco === 'undefined') return;
    const container = document.getElementById('genreJsonEditor');
    if (!container) return;

    if (!state.genreEditor.jsonEditor) {
        state.genreEditor.jsonEditor = monaco.editor.create(container, {
            value: '',
            language: 'json',
            theme: state.theme === 'dark' ? 'vs-dark' : 'vs',
            fontSize: 13,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: 'on'
        });
        state.genreEditor.jsonEditor.onDidChangeModelContent(() => {
            state.genreEditor.jsonDirty = true;
            setGenreDirty(true);
        });
    } else if (forceLayout) {
        setTimeout(() => {
            state.genreEditor.jsonEditor.layout();
        }, 60);
    }
}

function updateGenreJsonEditor(rule) {
    ensureGenreJsonEditor();
    if (state.genreEditor.jsonEditor) {
        state.genreEditor.jsonEditor.setValue(JSON.stringify(rule || {}, null, 2));
        state.genreEditor.jsonDirty = false;
    }
}

function applyStructuredPatterns(patterns) {
    const safePatterns = patterns && typeof patterns === 'object' ? patterns : {};
    const playerPattern = safePatterns.player && typeof safePatterns.player === 'object' ? safePatterns.player : {};
    const playerPhysics = playerPattern.physics && typeof playerPattern.physics === 'object' ? playerPattern.physics : {};

    applyPatternInput('player.movement', playerPattern.movement || '');
    applyPatternInput('player.physics.gravity', playerPhysics.gravity);
    applyPatternInput('player.physics.jumpSpeed', playerPhysics.jumpSpeed);
    applyPatternInput('player.physics.maxSpeed', playerPhysics.maxSpeed);
    applyPatternInput('player.physics.friction', playerPhysics.friction);
    applyPatternInput('player.physics.bounce', playerPhysics.bounce);

    initPatternTags('enemies.types', getNested(safePatterns, ['enemies', 'types']));
    applyPatternInput('enemies.spawnLogic', getNested(safePatterns, ['enemies', 'spawnLogic']) || '');

    applyPatternInput('camera.follow', getNested(safePatterns, ['camera', 'follow']) || '');
    applyPatternInput('camera.deadzone', getNested(safePatterns, ['camera', 'deadzone']));
    applyPatternInput('camera.bounds', getNested(safePatterns, ['camera', 'bounds']) || '');

    initPatternTags('collectibles.types', getNested(safePatterns, ['collectibles', 'types']));
    applyPatternInput('collectibles.collectionPattern', getNested(safePatterns, ['collectibles', 'collectionPattern']) || '');
}

function applyPatternInput(path, value) {
    const input = document.querySelector(`[data-pattern-input="${path}"]`);
    if (!input) return;
    if (value === undefined || value === null) {
        input.value = '';
        return;
    }
    input.value = value;
}

function collectStructuredPatterns() {
    const result = {};

    const movementVal = getPatternInputValue('player.movement');
    if (movementVal) {
        setNested(result, ['player', 'movement'], movementVal);
    }
    const physicsObj = {};
    ['gravity', 'jumpSpeed', 'maxSpeed', 'friction', 'bounce'].forEach(field => {
        const raw = getPatternInputValue(`player.physics.${field}`);
        if (raw !== '' && raw !== null) {
            physicsObj[field] = Number.isNaN(Number(raw)) ? raw : parseFloat(raw);
        }
    });
    if (Object.keys(physicsObj).length) {
        setNested(result, ['player', 'physics'], physicsObj);
    }

    const enemyTypes = getPatternTagArray('enemies.types');
    if (enemyTypes.length) {
        setNested(result, ['enemies', 'types'], enemyTypes);
    }
    const spawnLogic = getPatternInputValue('enemies.spawnLogic');
    if (spawnLogic) {
        setNested(result, ['enemies', 'spawnLogic'], spawnLogic);
    }

    const follow = getPatternInputValue('camera.follow');
    const deadzoneRaw = getPatternInputValue('camera.deadzone');
    const bounds = getPatternInputValue('camera.bounds');
    if (follow) setNested(result, ['camera', 'follow'], follow);
    if (deadzoneRaw !== '' && deadzoneRaw !== null) {
        const parsed = Number(deadzoneRaw);
        setNested(result, ['camera', 'deadzone'], Number.isNaN(parsed) ? deadzoneRaw : parsed);
    }
    if (bounds) setNested(result, ['camera', 'bounds'], bounds);

    const collectibleTypes = getPatternTagArray('collectibles.types');
    if (collectibleTypes.length) {
        setNested(result, ['collectibles', 'types'], collectibleTypes);
    }
    const collectionPattern = getPatternInputValue('collectibles.collectionPattern');
    if (collectionPattern) {
        setNested(result, ['collectibles', 'collectionPattern'], collectionPattern);
    }

    return result;
}

function mergePatternsJSON(basePatterns, structured) {
    const merged = basePatterns && typeof basePatterns === 'object' ? deepClone(basePatterns) : {};
    ['player', 'enemies', 'camera', 'collectibles'].forEach(section => {
        if (structured[section] && Object.keys(structured[section]).length) {
            merged[section] = { ...(merged[section] || {}), ...structured[section] };
        }
    });
    return { value: merged };
}

function getPatternInputValue(path) {
    const input = document.querySelector(`[data-pattern-input="${path}"]`);
    if (!input) return null;
    return input.value;
}

function initPatternTags(path, values) {
    if (!state.genreEditor.patternTags) state.genreEditor.patternTags = {};
    state.genreEditor.patternTags[path] = Array.isArray(values) ? [...values] : [];
    renderPatternTagList(path);
}

function getPatternTagArray(path) {
    return getNested(state.genreEditor, ['patternTags', path]) || [];
}

function setPatternTagArray(path, arr) {
    if (!state.genreEditor.patternTags) state.genreEditor.patternTags = {};
    state.genreEditor.patternTags[path] = arr;
}

function renderPatternTagList(path) {
    const container = document.querySelector(`[data-pattern-tags="${path}"]`);
    if (!container) return;
    const listEl = container.querySelector('[data-tag-list]');
    if (!listEl) return;
    const input = container.querySelector('[data-tag-input]');

    const tags = getPatternTagArray(path);
    listEl.innerHTML = '';

    if (!tags.length) {
        const placeholder = document.createElement('span');
        placeholder.className = 'tag-placeholder';
        placeholder.textContent = 'No entries';
        listEl.appendChild(placeholder);
    } else {
        tags.forEach((tag, index) => {
            const item = document.createElement('span');
            item.className = 'tag-item';
            item.textContent = tag;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'tag-remove';
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', () => {
                removePatternTag(path, index);
            });

            item.appendChild(removeBtn);
            listEl.appendChild(item);
        });
    }

    if (input && !input.dataset.tagHandler) {
        input.dataset.tagHandler = 'true';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const value = input.value.trim();
                if (value) {
                    addPatternTag(path, value);
                    input.value = '';
                }
            } else if (e.key === 'Backspace' && !input.value) {
                const arr = getPatternTagArray(path);
                if (arr.length) {
                    removePatternTag(path, arr.length - 1);
                }
            }
        });
    }
}

function addPatternTag(path, value) {
    const arr = getPatternTagArray(path);
    if (!arr.includes(value)) {
        arr.push(value);
        renderPatternTagList(path);
        setGenreDirty(true);
    }
}

function removePatternTag(path, index) {
    const arr = getPatternTagArray(path);
    if (index >= 0 && index < arr.length) {
        arr.splice(index, 1);
        renderPatternTagList(path);
        setGenreDirty(true);
    }
}

function getNested(obj, path) {
    return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function setNested(obj, path, value) {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[path[path.length - 1]] = value;
}
function renderGenreCodeExamples() {
    const container = document.getElementById('genreCodeExamplesList');
    if (!container) return;

    const examples = Array.isArray(state.genreEditor.codeExamples) ? state.genreEditor.codeExamples : [];
    container.innerHTML = '';

    if (!examples.length) {
        const empty = document.createElement('div');
        empty.className = 'genre-list-empty';
        empty.textContent = 'No code examples yet.';
        container.appendChild(empty);
        return;
    }

    examples.forEach((example, index) => {
        const card = document.createElement('div');
        card.className = 'genre-code-example-card';

        const headerGrid = document.createElement('div');
        headerGrid.className = 'genre-card-grid';

        const titleField = document.createElement('div');
        titleField.className = 'form-field';
        const titleLabel = document.createElement('label');
        titleLabel.textContent = 'Title';
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = example.title || '';
        titleInput.placeholder = 'e.g. Basic Jump Mechanics';
        titleInput.addEventListener('input', (e) => {
            handleCodeExampleFieldChange(index, 'title', e.target.value);
        });
        titleField.appendChild(titleLabel);
        titleField.appendChild(titleInput);

        const docField = document.createElement('div');
        docField.className = 'form-field';
        const docLabel = document.createElement('label');
        docLabel.textContent = 'Documentation Link';
        const docInput = document.createElement('input');
        docInput.type = 'text';
        docInput.value = example.docLink || '';
        docInput.placeholder = 'https://...';
        docInput.addEventListener('input', (e) => {
            handleCodeExampleFieldChange(index, 'docLink', e.target.value);
        });
        docField.appendChild(docLabel);
        docField.appendChild(docInput);

        headerGrid.appendChild(titleField);
        headerGrid.appendChild(docField);

        const descField = document.createElement('div');
        descField.className = 'form-field full';
        const descLabel = document.createElement('label');
        descLabel.textContent = 'Description';
        const descInput = document.createElement('textarea');
        descInput.rows = 2;
        descInput.value = example.description || '';
        descInput.placeholder = 'Short explanation of what this snippet demonstrates';
        descInput.addEventListener('input', (e) => {
            handleCodeExampleFieldChange(index, 'description', e.target.value);
        });
        descField.appendChild(descLabel);
        descField.appendChild(descInput);

        const codeField = document.createElement('div');
        codeField.className = 'form-field full';
        const codeLabel = document.createElement('label');
        codeLabel.textContent = 'Code';
        const codeInput = document.createElement('textarea');
        codeInput.className = 'code-textarea';
        codeInput.rows = 4;
        codeInput.value = example.code || '';
        codeInput.placeholder = '// Phaser example snippet';
        codeInput.addEventListener('input', (e) => {
            handleCodeExampleFieldChange(index, 'code', e.target.value);
        });
        codeField.appendChild(codeLabel);
        codeField.appendChild(codeInput);

        const actions = document.createElement('div');
        actions.className = 'genre-code-example-actions';
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-small';
        removeBtn.textContent = 'Delete';
        removeBtn.title = 'Remove this example';
        removeBtn.addEventListener('click', () => {
            removeGenreCodeExample(index);
        });
        actions.appendChild(removeBtn);

        card.appendChild(headerGrid);
        card.appendChild(descField);
        card.appendChild(codeField);
        card.appendChild(actions);

        container.appendChild(card);
    });
}

function handleCodeExampleFieldChange(index, field, value) {
    if (!Array.isArray(state.genreEditor.codeExamples)) {
        state.genreEditor.codeExamples = [];
    }
    if (!state.genreEditor.codeExamples[index]) {
        state.genreEditor.codeExamples[index] = {};
    }
    state.genreEditor.codeExamples[index][field] = value;
    setGenreDirty(true);
}

function addGenreCodeExample(example = null) {
    if (!Array.isArray(state.genreEditor.codeExamples)) {
        state.genreEditor.codeExamples = [];
    }
    state.genreEditor.codeExamples.push(example || {
        title: '',
        description: '',
        code: '',
        docLink: ''
    });
    renderGenreCodeExamples();
    setGenreDirty(true);
}

function removeGenreCodeExample(index) {
    if (!Array.isArray(state.genreEditor.codeExamples)) return;
    state.genreEditor.codeExamples.splice(index, 1);
    renderGenreCodeExamples();
    setGenreDirty(true);
}

function initGenreTagInput(elementId, type) {
    const container = document.getElementById(elementId);
    if (!container || container.dataset.initialized === 'true') return;
    container.dataset.initialized = 'true';

    const input = container.querySelector('[data-tag-input]');
    const listEl = container.querySelector('[data-tag-list]');

    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const value = input.value.trim();
                if (value) {
                    addGenreTag(type, value);
                    input.value = '';
                }
            } else if (e.key === 'Backspace' && !input.value) {
                const arr = getGenreTagArray(type);
                if (arr.length > 0) {
                    removeGenreTag(type, arr.length - 1);
                }
            }
        });
    }

    if (listEl) {
        listEl.addEventListener('click', (e) => {
            if (e.target && e.target.matches('[data-tag-remove]')) {
                const idx = Number(e.target.getAttribute('data-tag-remove'));
                if (!Number.isNaN(idx)) {
                    removeGenreTag(type, idx);
                }
            }
        });
    }

    renderGenreTagList(type);
}

function getGenreTagArray(type) {
    if (type === 'commonBugs') return state.genreEditor.commonBugs || (state.genreEditor.commonBugs = []);
    if (type === 'performanceTips') return state.genreEditor.performanceTips || (state.genreEditor.performanceTips = []);
    return [];
}

function renderGenreTagList(type) {
    const containerId = type === 'commonBugs' ? 'genreCommonBugs' : 'genrePerformanceTips';
    const container = document.getElementById(containerId);
    if (!container) return;

    const listEl = container.querySelector('[data-tag-list]');
    if (!listEl) return;

    const tags = getGenreTagArray(type);
    listEl.innerHTML = '';

    if (!tags.length) {
        const placeholder = document.createElement('span');
        placeholder.className = 'tag-placeholder';
        placeholder.textContent = 'No entries yet';
        listEl.appendChild(placeholder);
        return;
    }

    tags.forEach((tag, index) => {
        const item = document.createElement('span');
        item.className = 'tag-item';
        item.textContent = tag;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'tag-remove';
        removeBtn.setAttribute('data-tag-remove', String(index));
        removeBtn.textContent = '×';

        item.appendChild(removeBtn);
        listEl.appendChild(item);
    });
}

function addGenreTag(type, value) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const arr = getGenreTagArray(type);
    if (arr.includes(trimmed)) return;
    arr.push(trimmed);
    renderGenreTagList(type);
    setGenreDirty(true);
}

function removeGenreTag(type, index) {
    const arr = getGenreTagArray(type);
    if (index < 0 || index >= arr.length) return;
    arr.splice(index, 1);
    renderGenreTagList(type);
    setGenreDirty(true);
}

function setGenreStatus(message, type = 'info') {
    const statusEl = document.getElementById('genreStatus');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.remove('success', 'error', 'warning');
    if (type === 'success') statusEl.classList.add('success');
    if (type === 'error') statusEl.classList.add('error');
    if (type === 'warning') statusEl.classList.add('warning');
}

function setGenreDirty(isDirty) {
    const wasDirty = state.genreEditor.dirty;
    state.genreEditor.dirty = !!isDirty;
    if (!wasDirty && state.genreEditor.dirty) {
        setGenreStatus('Unsaved changes', 'warning');
    }
    refreshGenreButtons();
}

function getRuleFromForm() {
    const name = document.getElementById('genreFieldName').value.trim();
    const version = document.getElementById('genreFieldVersion').value.trim();
    const phaserVersion = document.getElementById('genreFieldPhaserVersion').value.trim();
    const author = document.getElementById('genreFieldAuthor').value.trim();
    const description = document.getElementById('genreFieldDescription').value.trim();

    if (!name) {
        return { error: 'Genre name is required.' };
    }

    const context = document.getElementById('genreFieldContext').value;
    const validationText = document.getElementById('genreFieldValidation').value;

    const structuredPatterns = collectStructuredPatterns();
    const existingPatterns = deepClone(state.genreEditor.rule?.commonPatterns || {});
    const mergedPatterns = mergePatternsJSON(existingPatterns, structuredPatterns);
    if (mergedPatterns.error) return { error: mergedPatterns.error };

    const validationRules = parseJSONArea(validationText, {}, 'Validation Rules');
    if (validationRules.error) return { error: validationRules.error };

    const codeExamples = deepClone(Array.isArray(state.genreEditor.codeExamples) ? state.genreEditor.codeExamples : []);
    const commonBugs = Array.isArray(state.genreEditor.commonBugs) ? [...state.genreEditor.commonBugs] : [];
    const performanceTips = Array.isArray(state.genreEditor.performanceTips) ? [...state.genreEditor.performanceTips] : [];

    const baseRule = deepClone(state.genreEditor.rule) || {};

    const newRule = {
        ...baseRule,
        genre: name,
        version: version || baseRule.version || '1.0.0',
        phaserVersion: phaserVersion || baseRule.phaserVersion || '3.x',
        description: description || '',
        author: author || '',
        isBundled: false,
        commonPatterns: mergedPatterns.value,
        aiSuggestions: {
            ...(baseRule.aiSuggestions || {}),
            context: context || '',
            codeExamples,
            commonBugs,
            performanceTips
        },
        validationRules: validationRules.value
    };

    return { rule: newRule };
}

function parseJSONArea(text, fallback, label) {
    const trimmed = (text || '').trim();
    if (!trimmed) return { value: fallback };

    try {
        const parsed = JSON.parse(trimmed);
        return { value: parsed };
    } catch (error) {
        return { error: `${label || 'JSON'} is invalid: ${error.message}` };
    }
}

function switchGenreTab(tabName) {
    if (!tabName || state.genreEditor.activeTab === tabName) return;

    if (tabName === 'form' && state.genreEditor.activeTab === 'json' && state.genreEditor.jsonDirty) {
        const parsed = parseJSONArea(state.genreEditor.jsonEditor.getValue(), {}, 'Rule JSON');
        if (parsed.error) {
            setGenreStatus(parsed.error, 'error');
            return;
        }
        state.genreEditor.rule = parsed.value;
        populateGenreForm(state.genreEditor.rule);
        state.genreEditor.jsonDirty = false;
    }

    if (tabName === 'json') {
        const result = getRuleFromForm();
        if (result.error) {
            setGenreStatus(result.error, 'error');
            return;
        }
        state.genreEditor.rule = result.rule;
        updateGenreJsonEditor(state.genreEditor.rule);
    }

    state.genreEditor.activeTab = tabName;

    const addExampleBtn = document.getElementById('genreAddCodeExample');
    if (addExampleBtn && !addExampleBtn.dataset.bound) {
        addExampleBtn.dataset.bound = 'true';
        addExampleBtn.addEventListener('click', () => {
            addGenreCodeExample();
        });
    }

    initGenreTagInput('genreCommonBugs', 'commonBugs');
    initGenreTagInput('genrePerformanceTips', 'performanceTips');

    const tabs = document.querySelectorAll('.genre-tab');
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    const formSection = document.getElementById('genreFormSection');
    const jsonSection = document.getElementById('genreJsonSection');
    if (formSection && jsonSection) {
        if (tabName === 'form') {
            formSection.style.display = 'block';
            jsonSection.style.display = 'none';
        } else {
            formSection.style.display = 'none';
            jsonSection.style.display = 'block';
            ensureGenreJsonEditor(true);
        }
    }
}

async function handleGenreSave() {
    let ruleData = null;
    if (state.genreEditor.activeTab === 'json' && state.genreEditor.jsonEditor) {
        const parsed = parseJSONArea(state.genreEditor.jsonEditor.getValue(), {}, 'Rule JSON');
        if (parsed.error) {
            setGenreStatus(parsed.error, 'error');
            return;
        }
        ruleData = parsed.value;
        populateGenreForm(ruleData);
        state.genreEditor.jsonDirty = false;
    } else {
        const result = getRuleFromForm();
        if (result.error) {
            setGenreStatus(result.error, 'error');
            return;
        }
        ruleData = result.rule;
    }

    const rule = ruleData;
    const genreName = rule.genre;

    if (!genreName) {
        setGenreStatus('Genre name is required.', 'error');
        return;
    }

    try {
        const response = await window.electronAPI.saveGenreRule(genreName, rule);
        if (!response || !response.success) {
            setGenreStatus('Failed to save rule: ' + (response && response.error ? response.error : 'unknown error'), 'error');
            return;
        }

        state.genreEditor.current = genreName;
        state.genreEditor.rule = deepClone(rule);
        state.genreEditor.originalRule = deepClone(rule);
        state.genreEditor.isBundled = false;
        state.genreEditor.hasOverride = true;
        state.genreEditor.dirty = false;
        state.genreEditor.jsonDirty = false;
        state.genreEditor.isNew = false;

        await loadGenreListForEditor();
        renderGenreListForEditor();
        updateGenreHeader();
        refreshGenreButtons();
        setGenreStatus('Override saved to ' + response.path, 'success');
    } catch (error) {
        setGenreStatus('Error saving rule: ' + error.message, 'error');
    }
}

async function handleGenreExport() {
    if (!state.genreEditor.rule) {
        setGenreStatus('Nothing to export.', 'error');
        return;
    }
    const json = JSON.stringify(state.genreEditor.rule, null, 2);
    try {
        const result = await window.electronAPI.saveFile(json, `${state.genreEditor.current || 'genre-rule'}.json`);
        if (result) {
            setGenreStatus('Exported to ' + result.path, 'success');
        }
    } catch (error) {
        setGenreStatus('Export failed: ' + error.message, 'error');
    }
}

async function handleGenreDelete() {
    if (!state.genreEditor.current) return;
    if (!state.genreEditor.hasOverride && !state.genreEditor.isNew && state.genreEditor.isBundled) {
        setGenreStatus('Nothing to delete. This rule only exists as a bundled default.', 'warning');
        return;
    }

    const confirmDelete = window.confirm('Delete the custom override for "' + state.genreEditor.current + '"?');
    if (!confirmDelete) return;

    if (state.genreEditor.isNew) {
        // Just close without saving
        await loadGenreListForEditor();
        if (state.genreEditor.genres.length > 0) {
            await selectGenreForEditor(state.genreEditor.genres[0].name, { force: true });
        } else {
            closeGenreEditorModal(true);
        }
        return;
    }

    try {
        const res = await window.electronAPI.deleteGenreRule(state.genreEditor.current);
        if (!res || !res.success) {
            setGenreStatus('Delete failed: ' + (res && res.error ? res.error : 'unknown error'), 'error');
            return;
        }
        setGenreStatus('Override deleted', 'success');
        await loadGenreListForEditor();
        if (state.genreEditor.bundledRule) {
            // Reload bundled version
            await selectGenreForEditor(state.genreEditor.current, { force: true });
        } else if (state.genreEditor.genres.length > 0) {
            await selectGenreForEditor(state.genreEditor.genres[0].name, { force: true });
        } else {
            closeGenreEditorModal(true);
        }
    } catch (error) {
        setGenreStatus('Delete failed: ' + error.message, 'error');
    }
}

function handleGenreReset() {
    if (!state.genreEditor.originalRule) return;
    populateGenreForm(state.genreEditor.originalRule);
    updateGenreJsonEditor(state.genreEditor.originalRule);
    state.genreEditor.rule = deepClone(state.genreEditor.originalRule);
    state.genreEditor.dirty = false;
    state.genreEditor.jsonDirty = false;
    refreshGenreButtons();
    setGenreStatus('Reverted to last saved version.', 'info');
}

async function handleGenreLoadBundled() {
    if (!state.genreEditor.current) return;
    try {
        const res = await window.electronAPI.loadGenreRule(state.genreEditor.current, { source: 'bundled' });
        if (!res || !res.success) {
            setGenreStatus('Bundled version not available for this genre.', 'warning');
            return;
        }
        state.genreEditor.bundledRule = deepClone(res.rule);
        state.genreEditor.rule = deepClone(res.rule);
        state.genreEditor.originalRule = deepClone(res.rule);
        state.genreEditor.isBundled = true;
        state.genreEditor.hasOverride = false;
        state.genreEditor.dirty = false;
        state.genreEditor.jsonDirty = false;
        populateGenreForm(res.rule);
        updateGenreJsonEditor(res.rule);
        updateGenreHeader();
        refreshGenreButtons();
        setGenreStatus('Loaded bundled default.', 'info');
    } catch (error) {
        setGenreStatus('Error loading bundled version: ' + error.message, 'error');
    }
}

function refreshGenreButtons() {
    const saveBtn = document.getElementById('genreSaveBtn');
    const deleteBtn = document.getElementById('genreDeleteBtn');
    const resetBtn = document.getElementById('genreResetBtn');
    const defaultBtn = document.getElementById('genreReloadBundledBtn');

    if (saveBtn) {
        saveBtn.disabled = !state.genreEditor.dirty;
    }
    if (deleteBtn) {
        deleteBtn.disabled = !(state.genreEditor.hasOverride || (!state.genreEditor.isBundled && !state.genreEditor.isNew));
    }
    if (resetBtn) {
        resetBtn.disabled = !state.genreEditor.originalRule;
    }
    if (defaultBtn) {
        defaultBtn.disabled = !state.genreEditor.bundledRule;
    }
}

function updateGenreHeader() {
    const title = document.getElementById('genreModalTitle');
    const subtitle = document.getElementById('genreModalSubtitle');
    if (!title || !subtitle) return;

    if (state.genreEditor.current) {
        title.textContent = `Genre Rule — ${state.genreEditor.current}`;
        if (state.genreEditor.isNew) {
            subtitle.textContent = 'New custom rule. Fill in details and save to create an override.';
        } else if (state.genreEditor.hasOverride) {
            subtitle.textContent = 'Editing custom override. Click "Load Default" to view bundled guidance.';
        } else if (state.genreEditor.isBundled) {
            subtitle.textContent = 'Viewing bundled rule. Modify and save to create a custom override.';
        } else {
            subtitle.textContent = 'Editing custom rule.';
        }
    } else {
        title.textContent = 'Genre Rule Editor';
        subtitle.textContent = 'Inspect and customize genre guidance';
    }
}

async function handleGenreNew() {
    const modalResult = await showGenreCreateDialog(state.genreEditor.genres);
    if (!modalResult) return;

    const { name, base } = modalResult;
    let baseRule = null;

    if (base && base !== '__blank__') {
        try {
            const res = await window.electronAPI.loadGenreRule(base, { source: 'bundled' });
            if (res && res.success) {
                baseRule = deepClone(res.rule);
            }
        } catch (error) {
            console.warn('Failed to load base rule:', error.message);
        }
    }

    if (!baseRule) {
        baseRule = {
            genre: name,
            version: '1.0.0',
            phaserVersion: '3.x',
            description: '',
            author: '',
            isBundled: false,
            commonPatterns: {},
            aiSuggestions: {
                context: '',
                codeExamples: [],
                commonBugs: [],
                performanceTips: []
            },
            validationRules: {}
        };
    } else {
        baseRule.genre = name;
        baseRule.isBundled = false;
    }

    state.genreEditor.current = name;
    state.genreEditor.rule = deepClone(baseRule);
    state.genreEditor.originalRule = deepClone(baseRule);
    state.genreEditor.bundledRule = null;
    state.genreEditor.isBundled = false;
    state.genreEditor.hasOverride = false;
    state.genreEditor.isNew = true;
    state.genreEditor.dirty = true;
    state.genreEditor.jsonDirty = false;

    populateGenreForm(baseRule);
    updateGenreJsonEditor(baseRule);
    updateGenreHeader();

    if (!state.genreEditor.genres.some(g => g.name === name)) {
        state.genreEditor.genres.push({
            name,
            isBundled: false,
            hasOverride: false,
            source: 'custom'
        });
    }

    renderGenreListForEditor();
    refreshGenreButtons();
    setGenreStatus('New rule "' + name + '" created. Complete the fields and save to persist.', 'info');
}

function showGenreCreateDialog(existingGenres) {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #21232c;
            border: 1px solid #2c313d;
            border-radius: 10px;
            padding: 16px;
            z-index: 25000;
            width: 340px;
            box-shadow: 0 18px 60px rgba(0,0,0,0.45);
        `;

        const baseOptions = ['__blank__', ...(existingGenres || []).map(g => g.name)];

        dialog.innerHTML = `
            <h3 style="margin:0 0 10px;color:#9fe0ff;">Create New Genre Rule</h3>
            <label style="display:block;font-size:12px;color:#9fb0c6;margin-bottom:4px;">New Genre Name</label>
            <input id="genre-new-name" type="text" placeholder="roguelike" style="
                width:100%;padding:8px;border-radius:6px;border:1px solid #2c313d;
                background:#14161c;color:#e7f3ff;margin-bottom:12px;">
            <label style="display:block;font-size:12px;color:#9fb0c6;margin-bottom:4px;">Base</label>
            <select id="genre-new-base" style="
                width:100%;padding:8px;border-radius:6px;border:1px solid #2c313d;
                background:#14161c;color:#e7f3ff;margin-bottom:14px;">
                ${baseOptions.map(opt => `<option value="${opt}">${opt === '__blank__' ? 'Blank Template' : opt}</option>`).join('')}
            </select>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button id="genre-new-cancel" class="btn-small">Cancel</button>
                <button id="genre-new-create" class="btn-small primary">Create</button>
            </div>
        `;

        document.body.appendChild(dialog);

        const input = dialog.querySelector('#genre-new-name');
        const baseSelect = dialog.querySelector('#genre-new-base');
        const cancelBtn = dialog.querySelector('#genre-new-cancel');
        const createBtn = dialog.querySelector('#genre-new-create');
        const closeDialog = () => {
            if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
        };

        cancelBtn.addEventListener('click', () => {
            closeDialog();
            resolve(null);
        });

        createBtn.addEventListener('click', () => {
            const nameValue = (input.value || '').trim();
            if (!nameValue) {
                alert('Please enter a genre name.');
                return;
            }
            closeDialog();
            resolve({
                name: nameValue,
                base: baseSelect.value || '__blank__'
            });
        });

        input.focus();
    });
}

// ============================================
// Chat Interface - Emojibar & Formatting
// ============================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Simple lightweight markdown parser for chat
function parseSimpleMarkdown(text) {
    // Escape HTML first to prevent XSS
    let html = escapeHtml(text);
    
    // Code blocks (```code```) - must be done before inline code
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    
    // Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Bold (**text**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Italic (*text*) - but not if it's part of bold (process after bold)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Strikethrough (~~text~~)
    html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    
    // Line breaks (double newline = paragraph, single = <br>)
    html = html.split(/\n\n+/).map(para => {
        if (para.trim().startsWith('<pre') || para.trim().startsWith('<code')) {
            return para; // Don't wrap code blocks
        }
        return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
    }).join('');
    
    return html;
}

function initChatInterface() {
    try {
        const chatInput = document.getElementById('chatInput');
        const chatSendBtn = document.getElementById('chatSendBtn');
        const emojiPickerBtn = document.getElementById('emojiPickerBtn');
        const emojiPicker = document.getElementById('emojiPicker');
        const formatBtns = document.querySelectorAll('.format-btn');
        const emoticonConvert = document.getElementById('emoticonConvert');
        
        if (!chatInput || !chatSendBtn) {
            console.warn('Chat interface elements not found');
            return;
        }
        
        // Ensure input is enabled and can receive focus
        chatInput.disabled = false;
        chatInput.readOnly = false;
        
        // Emoji picker toggle
        if (emojiPickerBtn && emojiPicker) {
            emojiPickerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'block' : 'none';
            });
            
            // Close emoji picker when clicking outside
            document.addEventListener('click', (e) => {
                if (!emojiPicker.contains(e.target) && e.target !== emojiPickerBtn) {
                    emojiPicker.style.display = 'none';
                }
            });
            
            // Emoji selection
            emojiPicker.querySelectorAll('.emoji-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const emoji = btn.dataset.emoji;
                    insertTextAtCursor(chatInput, emoji);
                    emojiPicker.style.display = 'none';
                    chatInput.focus();
                });
            });
        }
        
        // Formatting buttons
        formatBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const format = btn.dataset.format;
                applyFormatting(chatInput, format);
                chatInput.focus();
            });
        });
        
        // Keyboard shortcuts
        chatInput.addEventListener('keydown', (e) => {
            // Enter to send, Shift+Enter for new line
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
            
            // Formatting shortcuts
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'b') {
                    e.preventDefault();
                    applyFormatting(chatInput, 'bold');
                } else if (e.key === 'i') {
                    e.preventDefault();
                    applyFormatting(chatInput, 'italic');
                } else if (e.key === '`') {
                    e.preventDefault();
                    applyFormatting(chatInput, 'code');
                }
            }
        });
        
        // Send button
        chatSendBtn.addEventListener('click', sendChatMessage);
        
        // Clear chat button
        const clearChatBtn = document.getElementById('clearChatBtn');
        if (clearChatBtn) {
            clearChatBtn.addEventListener('click', () => {
                if (confirm('Clear all chat history? This cannot be undone.')) {
                    state.chatHistory = [];
                    saveChatHistory();
                    renderChatHistory();
                }
            });
        }
        
        // Update welcome message with genre context if available
        updateChatWelcomeMessage();
        
        console.log('Chat interface initialized successfully');
    } catch (e) {
        console.error('Error initializing chat interface:', e);
    }
}

function insertTextAtCursor(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    
    textarea.value = value.substring(0, start) + text + value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
}

function applyFormatting(textarea, format) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    
    let formattedText = '';
    let newCursorPos = start;
    
    switch (format) {
        case 'bold':
            formattedText = `**${selectedText || 'bold text'}**`;
            newCursorPos = selectedText ? end + 4 : start + 2;
            break;
        case 'italic':
            formattedText = `*${selectedText || 'italic text'}*`;
            newCursorPos = selectedText ? end + 2 : start + 1;
            break;
        case 'code':
            formattedText = `\`${selectedText || 'code'}\``;
            newCursorPos = selectedText ? end + 2 : start + 1;
            break;
        case 'codeblock':
            formattedText = `\`\`\`\n${selectedText || 'code here'}\n\`\`\``;
            newCursorPos = selectedText ? end + 7 : start + 4;
            break;
        case 'strikethrough':
            formattedText = `~~${selectedText || 'strikethrough'}~~`;
            newCursorPos = selectedText ? end + 4 : start + 2;
            break;
    }
    
    const value = textarea.value;
    textarea.value = value.substring(0, start) + formattedText + value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = newCursorPos;
}

function convertEmoticons(text) {
    const emoticonMap = {
        ':)': '😊',
        ':-)': '😊',
        ':D': '😄',
        ':-D': '😄',
        ':P': '😜',
        ':-P': '😜',
        ':p': '😜',
        ':-p': '😜',
        ';)': '😉',
        ';-)': '😉',
        ':(': '😢',
        ':-(': '😢',
        ':o': '😮',
        ':-o': '😮',
        ':O': '😮',
        ':-O': '😮',
        ':*': '😘',
        ':-*': '😘',
        '<3': '❤️',
        '</3': '💔',
        ':3': '😊',
        'xD': '😆',
        'XD': '😆'
    };
    
    let converted = text;
    for (const [emoticon, emoji] of Object.entries(emoticonMap)) {
        const regex = new RegExp(emoticon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        converted = converted.replace(regex, emoji);
    }
    return converted;
}

function updateAIContextWithGenre() {
    if (!state.currentProject || !state.currentProject.genreRule) {
        state.genreContext = null;
        updateChatWelcomeMessage();
        return;
    }
    
    const rule = state.currentProject.genreRule;
    state.genreContext = rule.aiSuggestions?.context || null;
    
    // Update chat welcome message to show active genre
    updateChatWelcomeMessage();
    
    console.log('✅ AI context updated with genre:', state.currentProject.genre);
}

function updateChatWelcomeMessage() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    const welcomeDiv = chatMessages.querySelector('.chat-welcome');
    if (welcomeDiv) {
        if (state.currentProject && state.currentProject.genre) {
            const genreName = state.currentProject.genre.charAt(0).toUpperCase() + state.currentProject.genre.slice(1);
            welcomeDiv.innerHTML = `
                <p>👋 Hey! I'm <strong>Cursy</strong>, your AI coding buddy!</p>
                <p>🎮 <strong>Active Project Type:</strong> ${genreName}</p>
                <p>I'm currently in <strong>offline mode</strong> - but I can still help with code explanations, debugging, and learning the basics! 😊</p>
                <p style="font-size: 0.9em; opacity: 0.7; margin-top: 10px;">💡 Full AI chat coming soon when API credits are configured!</p>
            `;
        } else {
            // Default welcome message (already set in HTML, but update if needed)
            welcomeDiv.innerHTML = `
                <p>👋 Hey! I'm <strong>Cursy</strong>, your AI coding buddy!</p>
                <p>I'm currently in <strong>offline mode</strong> - but I can still help with:</p>
                <ul style="text-align: left; margin: 10px 0; padding-left: 20px;">
                    <li>Code explanations (functions, variables, loops, arrays)</li>
                    <li>Debugging tips</li>
                    <li>Getting started with projects</li>
                    <li>Learning the basics</li>
                </ul>
                <p>Try asking: <em>"How do I create a function?"</em> or <em>"What is a variable?"</em> 😊</p>
                <p style="font-size: 0.9em; opacity: 0.7; margin-top: 10px;">💡 Full AI chat coming soon when API credits are configured!</p>
            `;
        }
    }
}

// Mock AI Response System (Offline Mode)
function getMockResponse(message) {
    const lowerMessage = message.toLowerCase();
    
    // Greetings
    if (lowerMessage.match(/\b(hi|hello|hey|howdy|greetings)\b/)) {
        return {
            text: "👋 Hey there! I'm Cursy, your AI coding buddy! I'm here to help you learn and code. What would you like to work on today?",
            emoji: "👋"
        };
    }
    
    // Help requests
    if (lowerMessage.match(/\b(help|how do i|how to|can you help|what is|what's)\b/)) {
        if (lowerMessage.match(/\b(function|create function|make function|write function)\b/)) {
            return {
                text: "💡 **Creating Functions:**\n\nIn JavaScript, you can create functions like this:\n\n```javascript\nfunction myFunction() {\n    // Your code here\n    console.log('Hello!');\n}\n\n// Or as an arrow function:\nconst myFunction = () => {\n    console.log('Hello!');\n};\n```\n\nFunctions are reusable blocks of code! Want to see more examples?",
                emoji: "💡"
            };
        }
        if (lowerMessage.match(/\b(variable|var|let|const|declare)\b/)) {
            return {
                text: "📝 **Variables:**\n\nVariables store data:\n\n```javascript\nlet name = 'VIBE IDE';  // Can be changed\nconst version = '0.1.0'; // Cannot be changed\nvar oldWay = 'avoid this'; // Old style\n```\n\nUse `let` for values that change, `const` for values that don't!",
                emoji: "📝"
            };
        }
        if (lowerMessage.match(/\b(loop|for|while|iterate)\b/)) {
            return {
                text: "🔄 **Loops:**\n\nLoops repeat code:\n\n```javascript\n// For loop\nfor (let i = 0; i < 10; i++) {\n    console.log(i);\n}\n\n// While loop\nlet i = 0;\nwhile (i < 10) {\n    console.log(i);\n    i++;\n}\n```\n\nLoops are great for repeating actions!",
                emoji: "🔄"
            };
        }
        if (lowerMessage.match(/\b(array|list|collection)\b/)) {
            return {
                text: "📦 **Arrays:**\n\nArrays store multiple values:\n\n```javascript\nconst fruits = ['apple', 'banana', 'orange'];\n\n// Access items\nconsole.log(fruits[0]); // 'apple'\n\n// Add items\nfruits.push('grape');\n\n// Loop through\nfruits.forEach(fruit => {\n    console.log(fruit);\n});\n```\n\nArrays are super useful for lists of data!",
                emoji: "📦"
            };
        }
        return {
            text: "🤔 I'd love to help! Could you be more specific? Try asking:\n\n• \"How do I create a function?\"\n• \"What is a variable?\"\n• \"How do I use a loop?\"\n• \"Explain arrays\"\n\nOr just describe what you're trying to build! 😊",
            emoji: "🤔"
        };
    }
    
    // Error/debugging
    if (lowerMessage.match(/\b(error|bug|broken|not working|doesn't work|why|fix)\b/)) {
        return {
            text: "🐛 **Debugging Tips:**\n\n1. **Check the console** - Press F12 to see error messages\n2. **Read the error** - It usually tells you what's wrong!\n3. **Check your syntax** - Missing brackets, quotes, or semicolons?\n4. **Use console.log()** - Add `console.log('here!')` to see where your code runs\n\nPaste your error message here and I can help more! 🔍",
            emoji: "🐛"
        };
    }
    
    // Code explanation
    if (lowerMessage.match(/\b(explain|what does|mean|understand|confused)\b/)) {
        return {
            text: "📚 I'd be happy to explain! Try:\n\n• Select some code in the editor\n• Click \"Explain this code\"\n• Or paste the code here and ask me to explain it\n\nI can break down functions, loops, variables, and more! 😊",
            emoji: "📚"
        };
    }
    
    // Project/template questions
    if (lowerMessage.match(/\b(project|template|start|begin|new project|create)\b/)) {
        return {
            text: "🚀 **Starting a Project:**\n\n1. Click **\"New Project\"** on the welcome screen\n2. Choose a template:\n   • **Web App** - HTML/CSS/JavaScript\n   • **Python Beginner** - Simple Python scripts\n   • **Game (Phaser.js)** - Make games!\n   • **Data Analysis** - Python data science\n3. Pick a folder and start coding!\n\nNeed help with a specific template? Just ask! 😊",
            emoji: "🚀"
        };
    }
    
    // Thank you
    if (lowerMessage.match(/\b(thanks|thank you|ty|appreciate|cheers)\b/)) {
        return {
            text: "😊 You're welcome! Happy to help! Keep coding and learning - you're doing great! 💪\n\nNeed anything else? Just ask!",
            emoji: "😊"
        };
    }
    
    // Default response
    return {
        text: `🤖 I'm Cursy, your AI coding assistant! I'm currently in **offline mode** (AI integration coming soon!).\n\nI can help with:\n• **Code explanations** - Ask "what does this do?"\n• **Learning basics** - Functions, variables, loops, arrays\n• **Debugging** - Share errors and I'll help!\n• **Getting started** - Project templates and setup\n\nTry asking: "How do I create a function?" or "What is a variable?"\n\n*Note: Full AI chat will be available when API credits are configured!* 🚀`,
        emoji: "🤖"
    };
}

function saveChatHistory() {
    try {
        localStorage.setItem('vibe-ide-chat-history', JSON.stringify(state.chatHistory));
    } catch (e) {
        console.warn('Failed to save chat history:', e);
    }
}

function loadChatHistory() {
    try {
        const saved = localStorage.getItem('vibe-ide-chat-history');
        if (saved) {
            state.chatHistory = JSON.parse(saved);
            renderChatHistory();
        }
    } catch (e) {
        console.warn('Failed to load chat history:', e);
        state.chatHistory = [];
    }
}

function renderChatHistory() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    // Clear existing messages (except welcome)
    const welcome = chatMessages.querySelector('.chat-welcome');
    chatMessages.innerHTML = '';
    if (welcome) {
        chatMessages.appendChild(welcome);
    }
    
    // Render saved messages
    state.chatHistory.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${msg.role}`;
        messageDiv.innerHTML = parseSimpleMarkdown(msg.content);
        chatMessages.appendChild(messageDiv);
    });
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addMessageToHistory(role, content) {
    state.chatHistory.push({
        role: role,
        content: content,
        timestamp: new Date().toISOString()
    });
    
    // Keep only last 100 messages
    if (state.chatHistory.length > 100) {
        state.chatHistory = state.chatHistory.slice(-100);
    }
    
    saveChatHistory();
}

// Insert selected code into chat
function insertCodeContext() {
    const chatInput = document.getElementById('chatInput');
    if (!chatInput) return;
    
    if (state.monacoEditor) {
        const selection = state.monacoEditor.getSelection();
        const selectedText = state.monacoEditor.getModel().getValueInRange(selection);
        
        if (selectedText.trim()) {
            // Insert code block into chat
            const codeBlock = `\`\`\`javascript\n${selectedText}\n\`\`\`\n\nCan you explain this code?`;
            insertTextAtCursor(chatInput, codeBlock);
            chatInput.focus();
        } else {
            // No selection - get current line or all code
            const position = state.monacoEditor.getPosition();
            const line = state.monacoEditor.getModel().getLineContent(position.lineNumber);
            if (line.trim()) {
                const codeBlock = `\`\`\`javascript\n${line}\n\`\`\`\n\nCan you explain this code?`;
                insertTextAtCursor(chatInput, codeBlock);
                chatInput.focus();
            } else {
                alert('No code selected. Select some code in the editor first!');
            }
        }
    } else {
        alert('Editor not available. Open a file first!');
    }
}

// Insert quick message template (exposed globally for onclick handlers)
window.insertQuickMessage = function(message) {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.value = message;
        chatInput.focus();
    }
};

function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    const emoticonConvert = document.getElementById('emoticonConvert');
    
    if (!chatInput || !chatMessages) return;
    
    let message = chatInput.value.trim();
    if (!message) return;
    
    // Convert emoticons if enabled
    if (emoticonConvert && emoticonConvert.checked) {
        message = convertEmoticons(message);
    }
    
    // Render markdown to HTML using simple parser
    const messageHtml = parseSimpleMarkdown(message);
    
    // Create user message element
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message user';
    messageDiv.innerHTML = messageHtml;
    chatMessages.appendChild(messageDiv);
    
    // Add to history
    addMessageToHistory('user', message);
    
    // Clear input
    chatInput.value = '';
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Get mock response
    const mockResponse = getMockResponse(message);
    
    // Show typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message assistant typing';
    typingDiv.innerHTML = '<p>🤖 Cursy is typing...</p>';
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Simulate AI thinking time (300-800ms)
    const delay = 300 + Math.random() * 500;
    
    setTimeout(() => {
        // Remove typing indicator
        typingDiv.remove();
        
        // Create assistant response
        const responseDiv = document.createElement('div');
        responseDiv.className = 'chat-message assistant';
        responseDiv.innerHTML = parseSimpleMarkdown(mockResponse.text);
        chatMessages.appendChild(responseDiv);
        
        // Add to history
        addMessageToHistory('assistant', mockResponse.text);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, delay);
}

