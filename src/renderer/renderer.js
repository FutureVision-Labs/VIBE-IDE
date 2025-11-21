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
    mdPreviewMode: false, // Track if markdown preview is active
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
    chatHistory: [], // Store chat messages for persistence
    undoStack: [], // Store last file operation for undo (rename/delete)
    giphyApiKey: 'aYiZhypI5Grja4m0hgYobklPHipQI98e', // GIPHY API key (100 calls/hour limit)
    openaiApiKey: null, // OpenAI API key - loaded from config file or env var
    openaiClient: null, // OpenAI client instance
    useOpenAI: true, // Toggle between OpenAI and mock responses
    conversationContext: [], // Store conversation context for OpenAI
    agentPersona: null, // Agent_Persona.md content
    projectJournal: null // PROJECT_JOURNAL.md content
};

// Welcome screen functions (exposed globally for HTML onclick handlers)
// Expose these immediately so HTML onclick handlers can access them
// Note: These will call handleNewProject/handleOpenProject which are defined later
window.showNewProject = function() {
    console.log('showNewProject called');
    if (typeof handleNewProject === 'function') {
        handleNewProject();
    } else {
        console.error('handleNewProject not yet defined');
        // Retry after a short delay
        setTimeout(() => {
            if (typeof handleNewProject === 'function') {
                handleNewProject();
            } else {
                alert('Please wait for the app to finish loading...');
            }
        }, 100);
    }
};

window.showOpenProject = function() {
    console.log('showOpenProject called');
    if (typeof handleOpenProject === 'function') {
        handleOpenProject();
    } else {
        console.error('handleOpenProject not yet defined');
        // Retry after a short delay
        setTimeout(() => {
            if (typeof handleOpenProject === 'function') {
                handleOpenProject();
            } else {
                alert('Please wait for the app to finish loading...');
            }
        }, 100);
    }
};

// Also expose initMonacoEditor early (will be redefined later, but this prevents errors)
window.initMonacoEditor = function() {
    // This will be replaced by the actual function when it loads
    console.log('initMonacoEditor called but not yet loaded');
};

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
                showToast(`File saved: ${tab.name}`, 'success', 2000);
            } else {
                showToast('Error saving file: ' + result.error, 'error');
            }
        } catch (error) {
            showToast('Error saving file: ' + error.message, 'error');
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
            showToast(`File saved: ${result.name}`, 'success', 2000);
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
            showToast('Project created successfully!', 'success');
        } else {
            if (!result.cancelled) {
                showToast('Error creating project: ' + (result.error || 'Unknown error'), 'error');
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
            'web-app': null,
            'python-beginner': null,
            'data-analysis': null,
            platformer: 'platformer',
            shooter: 'shooter',
            puzzle: 'puzzle',
            runner: 'runner'
        };
        
        // Template metadata (for display)
        const templateMetadata = {
            blank: { name: 'Blank Project', description: 'Start from scratch with a clean slate', icon: '📄' },
            'web-app': { name: 'Web App', description: 'HTML, CSS, and JavaScript web application', icon: '🌐' },
            'python-beginner': { name: 'Python Beginner', description: 'Simple Python script to learn the basics', icon: '🐍' },
            'data-analysis': { name: 'Data Analysis', description: 'Python project for analyzing data', icon: '📊' },
            platformer: { name: 'Platformer Game', description: '2D platformer game with Phaser.js', icon: '🎮' }
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
        
        // Build template options HTML
        const templateOptions = Object.entries(templateMetadata).map(([key, meta]) => 
            `<option value="${key}">${meta.icon} ${meta.name}</option>`
        ).join('');
        
        dialog.innerHTML = `
            <h3 style="margin-top: 0; color: #fff;">Create New Project</h3>
            <div style="margin: 15px 0;">
                <label style="display: block; color: #ccc; margin-bottom: 8px;">Template:</label>
                <select id="template-select" style="
                    width: 100%;
                    padding: 10px;
                    background: #3a3a3a;
                    color: #fff;
                    border: 1px solid #666;
                    border-radius: 4px;
                    margin-bottom: 10px;
                    font-size: 14px;
                    cursor: pointer;
                ">
                    ${templateOptions}
                </select>
                <div id="template-description" style="
                    background: #2a2a2a;
                    padding: 10px;
                    border-radius: 4px;
                    color: #aaa;
                    font-size: 12px;
                    margin-bottom: 15px;
                    min-height: 20px;
                ">${templateMetadata.blank.description}</div>
                
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
                    transition: background 0.2s;
                ">Create</button>
                <button id="template-cancel" style="
                    flex: 1;
                    padding: 10px;
                    background: #666;
                    color: #fff;
                    border: 1px solid #888;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background 0.2s;
                ">Cancel</button>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // Auto-select genre based on template
        const templateSelect = document.getElementById('template-select');
        const genreSelect = document.getElementById('genre-select');
        
        // Update description when template changes
        const descriptionDiv = document.getElementById('template-description');
        templateSelect.addEventListener('change', () => {
            const template = templateSelect.value;
            const meta = templateMetadata[template];
            if (meta && descriptionDiv) {
                descriptionDiv.textContent = meta.description;
            }
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

function showKeyboardShortcuts() {
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #2d2d2d;
        border: 2px solid #4a4a4a;
        border-radius: 8px;
        padding: 25px;
        z-index: 10000;
        min-width: 500px;
        max-width: 700px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    `;
    
    const shortcuts = [
        { category: 'General', items: [
            { key: 'Ctrl+N / Cmd+N', desc: 'New Project' },
            { key: 'Ctrl+O / Cmd+O', desc: 'Open Project' },
            { key: 'Ctrl+S / Cmd+S', desc: 'Save File' },
            { key: 'Ctrl+Shift+S / Cmd+Shift+S', desc: 'Save As' },
            { key: 'Ctrl+W / Cmd+W', desc: 'Close Tab' },
            { key: 'Ctrl+, / Cmd+,', desc: 'Settings (Coming Soon)' }
        ]},
        { category: 'Editor', items: [
            { key: 'Ctrl+Z / Cmd+Z', desc: 'Undo' },
            { key: 'Ctrl+Y / Cmd+Y', desc: 'Redo' },
            { key: 'Ctrl+X / Cmd+X', desc: 'Cut' },
            { key: 'Ctrl+C / Cmd+C', desc: 'Copy' },
            { key: 'Ctrl+V / Cmd+V', desc: 'Paste' },
            { key: 'Ctrl+A / Cmd+A', desc: 'Select All' },
            { key: 'Ctrl+F / Cmd+F', desc: 'Find' },
            { key: 'Ctrl+H / Cmd+H', desc: 'Replace' },
            { key: 'Ctrl+/ / Cmd+/', desc: 'Toggle Comment' },
            { key: 'Ctrl+` / Cmd+`', desc: 'Toggle Terminal (Coming Soon)' }
        ]},
        { category: 'View', items: [
            { key: 'Ctrl+B / Cmd+B', desc: 'Toggle Left Sidebar' },
            { key: 'Ctrl+Shift+B / Cmd+Shift+B', desc: 'Toggle Right Sidebar' },
            { key: 'Ctrl+\\ / Cmd+\\', desc: 'Toggle Preview' },
            { key: 'F11', desc: 'Toggle Fullscreen' },
            { key: 'Ctrl+R / Cmd+R', desc: 'Reload Window' }
        ]},
        { category: 'Chat', items: [
            { key: 'Enter', desc: 'Send Message' },
            { key: 'Shift+Enter', desc: 'New Line' },
            { key: 'Ctrl+B / Cmd+B', desc: 'Bold Text' },
            { key: 'Ctrl+I / Cmd+I', desc: 'Italic Text' },
            { key: 'Ctrl+` / Cmd+`', desc: 'Inline Code' }
        ]},
        { category: 'Navigation', items: [
            { key: 'Ctrl+Tab / Cmd+Tab', desc: 'Next Tab' },
            { key: 'Ctrl+Shift+Tab / Cmd+Shift+Tab', desc: 'Previous Tab' },
            { key: 'Ctrl+1-9 / Cmd+1-9', desc: 'Switch to Tab Number' }
        ]}
    ];
    
    const shortcutsHtml = shortcuts.map(cat => `
        <div style="margin-bottom: 25px;">
            <h4 style="color: #00a2ff; margin: 0 0 12px 0; font-size: 16px; border-bottom: 1px solid #444; padding-bottom: 5px;">
                ${cat.category}
            </h4>
            ${cat.items.map(item => `
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #333;">
                    <span style="color: #ccc; flex: 1;">${item.desc}</span>
                    <kbd style="
                        background: #1a1a1a;
                        border: 1px solid #555;
                        border-radius: 4px;
                        padding: 4px 8px;
                        font-family: 'Courier New', monospace;
                        font-size: 12px;
                        color: #fff;
                        margin-left: 15px;
                    ">${item.key}</kbd>
                </div>
            `).join('')}
        </div>
    `).join('');
    
    dialog.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="margin: 0; color: #fff; font-size: 20px;">⌨️ Keyboard Shortcuts</h3>
            <button id="shortcuts-close" style="
                background: transparent;
                border: none;
                color: #ccc;
                font-size: 24px;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
                line-height: 1;
            ">×</button>
        </div>
        <div style="color: #aaa; font-size: 13px; margin-bottom: 20px;">
            Press these key combinations to quickly access features
        </div>
        ${shortcutsHtml}
        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #444; text-align: center;">
            <button id="shortcuts-ok" style="
                padding: 10px 30px;
                background: #00a2ff;
                color: #fff;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                transition: background 0.2s;
            ">Got it!</button>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    const closeDialog = () => {
        if (dialog.parentNode) {
            document.body.removeChild(dialog);
        }
    };
    
    document.getElementById('shortcuts-close').addEventListener('click', closeDialog);
    document.getElementById('shortcuts-ok').addEventListener('click', closeDialog);
    
    // Close on Escape key
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeDialog();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Close on background click
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            closeDialog();
        }
    });
}

// Expose globally for onclick handler
window.showKeyboardShortcuts = showKeyboardShortcuts;

// ============================================
// Cursy Visualization State Management
// ============================================

let cursyState = 'idle'; // idle, thinking, typing, error, celebrating
let cursyAnimationInterval = null;
let cursyCurrentFrame = 0;

// Character animation frames configuration
// These paths will be set up once assets are copied to the project
const cursyAnimations = {
    idle: {
        frames: [
            'assets/cursy-office/characters/dad_computer_idle_01.png',
            'assets/cursy-office/characters/dad_computer_idle_02.png',
            'assets/cursy-office/characters/dad_computer_idle_03.png',
            'assets/cursy-office/characters/dad_computer_idle_04.png',
            'assets/cursy-office/characters/dad_computer_idle_05.png',
            'assets/cursy-office/characters/dad_computer_idle_06.png',
            'assets/cursy-office/characters/dad_computer_idle_07.png',
            'assets/cursy-office/characters/dad_computer_idle_08.png',
            'assets/cursy-office/characters/dad_computer_idle_09.png',
            'assets/cursy-office/characters/dad_computer_idle_10.png',
            'assets/cursy-office/characters/dad_computer_idle_11.png',
            'assets/cursy-office/characters/dad_computer_idle_12.png',
            'assets/cursy-office/characters/dad_computer_idle_13.png',
            'assets/cursy-office/characters/dad_computer_idle_14.png'
        ],
        fps: 2 // frames per second
    },
    thinking: {
        frames: [
            'assets/cursy-office/characters/dad_computer_idle_01.png',
            'assets/cursy-office/characters/dad_computer_idle_02.png'
        ],
        fps: 1
    },
    typing: {
        frames: [
            'assets/cursy-office/characters/dad_computer_working_01.png',
            'assets/cursy-office/characters/dad_computer_working_02.png',
            'assets/cursy-office/characters/dad_computer_working_03.png',
            'assets/cursy-office/characters/dad_computer_working_04.png',
            'assets/cursy-office/characters/dad_computer_working_05.png',
            'assets/cursy-office/characters/dad_computer_working_06.png',
            'assets/cursy-office/characters/dad_computer_working_07.png',
            'assets/cursy-office/characters/dad_computer_working_08.png',
            'assets/cursy-office/characters/dad_computer_working_09.png',
            'assets/cursy-office/characters/dad_computer_working_10.png',
            'assets/cursy-office/characters/dad_computer_working_11.png',
            'assets/cursy-office/characters/dad_computer_working_12.png',
            'assets/cursy-office/characters/dad_computer_working_13.png',
            'assets/cursy-office/characters/dad_computer_working_14.png',
            'assets/cursy-office/characters/dad_computer_working_15.png',
            'assets/cursy-office/characters/dad_computer_working_16.png',
            'assets/cursy-office/characters/dad_computer_working_17.png',
            'assets/cursy-office/characters/dad_computer_working_18.png',
            'assets/cursy-office/characters/dad_computer_working_19.png',
            'assets/cursy-office/characters/dad_computer_working_20.png',
            'assets/cursy-office/characters/dad_computer_working_21.png',
            'assets/cursy-office/characters/dad_computer_working_22.png',
            'assets/cursy-office/characters/dad_computer_working_23.png',
            'assets/cursy-office/characters/dad_computer_working_24.png',
            'assets/cursy-office/characters/dad_computer_working_25.png',
            'assets/cursy-office/characters/dad_computer_working_26.png',
            'assets/cursy-office/characters/dad_computer_working_27.png',
            'assets/cursy-office/characters/dad_computer_working_28.png',
            'assets/cursy-office/characters/dad_computer_working_29.png',
            'assets/cursy-office/characters/dad_computer_working_30.png',
            'assets/cursy-office/characters/dad_computer_working_31.png'
        ],
        fps: 4
    },
    celebrating: {
        frames: [
            'assets/cursy-office/characters/dad_computer_idle_01.png',
            'assets/cursy-office/characters/dad_computer_idle_02.png',
            'assets/cursy-office/characters/dad_computer_idle_03.png',
            'assets/cursy-office/characters/dad_computer_idle_04.png',
            'assets/cursy-office/characters/dad_computer_idle_05.png',
            'assets/cursy-office/characters/dad_computer_idle_06.png',
            'assets/cursy-office/characters/dad_computer_idle_07.png',
            'assets/cursy-office/characters/dad_computer_idle_08.png',
            'assets/cursy-office/characters/dad_computer_idle_09.png',
            'assets/cursy-office/characters/dad_computer_idle_10.png',
            'assets/cursy-office/characters/dad_computer_idle_11.png',
            'assets/cursy-office/characters/dad_computer_idle_12.png',
            'assets/cursy-office/characters/dad_computer_idle_13.png',
            'assets/cursy-office/characters/dad_computer_idle_14.png'
        ],
        fps: 6
    }
};

function stopCursyAnimation() {
    if (cursyAnimationInterval) {
        clearInterval(cursyAnimationInterval);
        cursyAnimationInterval = null;
    }
    cursyCurrentFrame = 0;
}

function startCursyAnimation(state) {
    stopCursyAnimation();
    
    const character = document.getElementById('cursyCharacter');
    if (!character) return;
    
    const animation = cursyAnimations[state];
    if (!animation || !animation.frames.length) {
        // Fallback: show first frame if available
        if (animation && animation.frames[0]) {
            character.src = animation.frames[0];
            character.style.display = 'block';
        }
        return;
    }
    
    // Show character
    character.style.display = 'block';
    
    // Cycle through frames
    const frameDelay = 1000 / animation.fps;
    cursyAnimationInterval = setInterval(() => {
        cursyCurrentFrame = (cursyCurrentFrame + 1) % animation.frames.length;
        const framePath = animation.frames[cursyCurrentFrame];
        
        // Try to load the frame, with fallback
        character.src = framePath;
        character.onerror = () => {
            // If frame doesn't exist, try first frame as fallback
            if (animation.frames[0]) {
                character.src = animation.frames[0];
            }
        };
    }, frameDelay);
    
    // Set initial frame
    if (animation.frames[0]) {
        character.src = animation.frames[0];
    }
}

function updateCursyState(newState, statusText = null) {
    console.log('🔵 updateCursyState called:', newState, statusText);
    
    const character = document.getElementById('cursyCharacter');
    const roomPropsLayer = document.getElementById('roomPropsLayer');
    const characterLayer = document.getElementById('roomCharacterLayer');
    const roomContainer = document.querySelector('.room-container');
    
    console.log('🔍 Elements found:', {
        character: !!character,
        characterLayer: !!characterLayer,
        roomContainer: !!roomContainer
    });
    
    if (!character || !characterLayer || !roomContainer) {
        console.error('❌ Missing required elements!', {
            character: !!character,
            characterLayer: !!characterLayer,
            roomContainer: !!roomContainer
        });
        return;
    }
    
    // Remove all state classes
    character.className = 'cursy-character';
    
    // Remove any existing bubbles (check both characterLayer and roomContainer)
    const existingBubbles = document.querySelectorAll('.cursy-bubble');
    console.log('🗑️ Removing', existingBubbles.length, 'existing bubbles');
    existingBubbles.forEach(bubble => bubble.remove());
    
    // Don't clear props - keep wall decorations visible!
    // Props are part of the room, not the character state
    
    cursyState = newState;
    
    switch (newState) {
        case 'idle':
            character.classList.add('idle');
            startCursyAnimation('idle');
            break;
            
        case 'thinking':
            character.classList.add('thinking');
            startCursyAnimation('idle'); // Use idle animation for thinking
            
            // Add thought bubble with animated dots
            if (roomContainer && character) {
                console.log('💭 Creating thought bubble...');
                const thoughtBubble = document.createElement('div');
                thoughtBubble.className = 'cursy-bubble thought';
                const thinkingDots = document.createElement('div');
                thinkingDots.className = 'thinking-dots';
                thinkingDots.innerHTML = '<span></span><span></span><span></span>';
                thoughtBubble.appendChild(thinkingDots);
                roomContainer.appendChild(thoughtBubble);
                
                // Position bubble after a small delay to ensure character is rendered
                setTimeout(() => {
                    const charRect = character.getBoundingClientRect();
                    const containerRect = roomContainer.getBoundingClientRect();
                    const visualizationRect = document.querySelector('.cursy-visualization')?.getBoundingClientRect();
                    
                    if (charRect.width > 0 && containerRect.width > 0) {
                        // Position relative to the visualization container, not room-container
                        // This ensures bubbles can appear above the room
                        const charCenterX = charRect.left - (visualizationRect?.left || containerRect.left) + (charRect.width / 2);
                        const charTop = charRect.top - (visualizationRect?.top || containerRect.top);
                        
                        // Position relative to visualization container
                        const vizContainer = document.querySelector('.cursy-visualization') || roomContainer;
                        thoughtBubble.style.position = 'absolute';
                        thoughtBubble.style.left = (charCenterX - 40) + 'px';
                        thoughtBubble.style.top = (charTop - 60) + 'px';
                        thoughtBubble.style.zIndex = '1000'; // Much higher z-index
                        thoughtBubble.style.opacity = '1';
                        thoughtBubble.style.visibility = 'visible';
                        thoughtBubble.style.display = 'flex';
                        thoughtBubble.style.pointerEvents = 'none'; // Don't block clicks
                        
                        // Move bubble to visualization container if it's in room-container
                        if (thoughtBubble.parentElement === roomContainer && vizContainer !== roomContainer) {
                            vizContainer.appendChild(thoughtBubble);
                        }
                        
                        console.log('✅ Thought bubble positioned:', { 
                            left: thoughtBubble.style.left, 
                            top: thoughtBubble.style.top,
                            zIndex: thoughtBubble.style.zIndex,
                            display: window.getComputedStyle(thoughtBubble).display,
                            visibility: window.getComputedStyle(thoughtBubble).visibility,
                            opacity: window.getComputedStyle(thoughtBubble).opacity,
                            parent: thoughtBubble.parentElement?.className
                        });
                    } else {
                        console.warn('⚠️ Character or container not properly sized, using fallback positioning');
                        thoughtBubble.style.left = '50%';
                        thoughtBubble.style.top = '20%';
                        thoughtBubble.style.position = 'absolute';
                        thoughtBubble.style.zIndex = '1000';
                        thoughtBubble.style.opacity = '1';
                        thoughtBubble.style.visibility = 'visible';
                        thoughtBubble.style.display = 'flex';
                    }
                }, 150);
                
                console.log('✅ Thought bubble appended');
            } else {
                console.error('❌ roomContainer or character not found for thought bubble!', { roomContainer: !!roomContainer, character: !!character });
            }
            break;
            
        case 'typing':
            character.classList.add('typing');
            startCursyAnimation('typing');
            break;
            
        case 'celebrating':
            character.classList.add('celebrating');
            startCursyAnimation('idle'); // Use idle animation for celebrating
            
            // Add green speech bubble with animated "YES!!!"
            if (roomContainer && character) {
                console.log('🎉 Creating celebrate bubble...');
                const celebrateBubble = document.createElement('div');
                celebrateBubble.className = 'cursy-bubble speech celebrate';
                const celebrateText = document.createElement('div');
                celebrateText.className = 'celebrate-exclamations';
                celebrateText.innerHTML = '<span>Y</span><span>E</span><span>S</span><span>!</span><span>!</span><span>!</span>';
                celebrateBubble.appendChild(celebrateText);
                roomContainer.appendChild(celebrateBubble);
                
                // Position bubble after a small delay
                setTimeout(() => {
                    const charRect = character.getBoundingClientRect();
                    const containerRect = roomContainer.getBoundingClientRect();
                    const visualizationRect = document.querySelector('.cursy-visualization')?.getBoundingClientRect();
                    
                    if (charRect.width > 0 && containerRect.width > 0) {
                        const charCenterX = charRect.left - (visualizationRect?.left || containerRect.left) + (charRect.width / 2);
                        const charTop = charRect.top - (visualizationRect?.top || containerRect.top);
                        
                        const vizContainer = document.querySelector('.cursy-visualization') || roomContainer;
                        celebrateBubble.style.position = 'absolute';
                        celebrateBubble.style.left = (charCenterX - 35) + 'px';
                        celebrateBubble.style.top = (charTop - 60) + 'px';
                        celebrateBubble.style.zIndex = '1000';
                        celebrateBubble.style.opacity = '1';
                        celebrateBubble.style.visibility = 'visible';
                        celebrateBubble.style.display = 'flex';
                        celebrateBubble.style.pointerEvents = 'none';
                        
                        if (celebrateBubble.parentElement === roomContainer && vizContainer !== roomContainer) {
                            vizContainer.appendChild(celebrateBubble);
                        }
                        
                        console.log('✅ Celebrate bubble positioned');
                    } else {
                        celebrateBubble.style.left = '50%';
                        celebrateBubble.style.top = '20%';
                        celebrateBubble.style.position = 'absolute';
                        celebrateBubble.style.zIndex = '1000';
                        celebrateBubble.style.opacity = '1';
                        celebrateBubble.style.visibility = 'visible';
                        celebrateBubble.style.display = 'flex';
                    }
                }, 150);
                
                console.log('✅ Celebrate bubble appended');
            } else {
                console.error('❌ roomContainer or character not found for celebrate bubble!');
            }
            // Auto-return to idle after celebration
            setTimeout(() => {
                updateCursyState('idle', 'Ready to help!');
            }, 2000);
            break;
            
        case 'error':
            character.classList.add('error');
            startCursyAnimation('typing'); // Use typing animation for error
            
            // Add red speech bubble with animated exclamation marks
            if (roomContainer && character) {
                console.log('🚨 Creating error bubble...');
                const errorBubble = document.createElement('div');
                errorBubble.className = 'cursy-bubble speech';
                const errorExclamations = document.createElement('div');
                errorExclamations.className = 'error-exclamations';
                errorExclamations.innerHTML = '<span>!</span><span>!</span><span>!</span>';
                errorBubble.appendChild(errorExclamations);
                roomContainer.appendChild(errorBubble);
                
                // Position bubble after a small delay
                setTimeout(() => {
                    const charRect = character.getBoundingClientRect();
                    const containerRect = roomContainer.getBoundingClientRect();
                    const visualizationRect = document.querySelector('.cursy-visualization')?.getBoundingClientRect();
                    
                    if (charRect.width > 0 && containerRect.width > 0) {
                        const charCenterX = charRect.left - (visualizationRect?.left || containerRect.left) + (charRect.width / 2);
                        const charTop = charRect.top - (visualizationRect?.top || containerRect.top);
                        
                        const vizContainer = document.querySelector('.cursy-visualization') || roomContainer;
                        errorBubble.style.position = 'absolute';
                        errorBubble.style.left = (charCenterX - 35) + 'px';
                        errorBubble.style.top = (charTop - 60) + 'px';
                        errorBubble.style.zIndex = '1000';
                        errorBubble.style.opacity = '1';
                        errorBubble.style.visibility = 'visible';
                        errorBubble.style.display = 'flex';
                        errorBubble.style.pointerEvents = 'none';
                        
                        if (errorBubble.parentElement === roomContainer && vizContainer !== roomContainer) {
                            vizContainer.appendChild(errorBubble);
                        }
                        
                        console.log('✅ Error bubble positioned');
                    } else {
                        errorBubble.style.left = '50%';
                        errorBubble.style.top = '20%';
                        errorBubble.style.position = 'absolute';
                        errorBubble.style.zIndex = '1000';
                        errorBubble.style.opacity = '1';
                        errorBubble.style.visibility = 'visible';
                        errorBubble.style.display = 'flex';
                    }
                }, 150);
                
                console.log('✅ Error bubble appended');
            } else {
                console.error('❌ roomContainer or character not found for error bubble!');
            }
            break;
    }
}

// Build Cursy's Office Room
// ============================================

function buildCursyOffice() {
    console.log('🔨 buildCursyOffice() called');
    const floorLayer = document.getElementById('roomFloorLayer');
    const wallLayer = document.getElementById('roomWallLayer');
    const furnitureLayer = document.getElementById('roomFurnitureLayer');
    const propsLayer = document.getElementById('roomPropsLayer');
    
    console.log('Layers:', { floorLayer, wallLayer, furnitureLayer, propsLayer });
    
    if (!floorLayer || !wallLayer || !furnitureLayer || !propsLayer) {
        console.error('❌ Missing layers!', { floorLayer, wallLayer, furnitureLayer, propsLayer });
        return;
    }
    
    console.log('✅ All layers found, building office...');
    
    // Clear existing content
    floorLayer.innerHTML = '';
    wallLayer.innerHTML = '';
    furnitureLayer.innerHTML = '';
    propsLayer.innerHTML = '';
    
    // Use larger corner piece (lvngroom_wall02_COL03 - 150x135px, larger than COL02)
    // This single image includes both walls and floor, perfectly aligned
    // Since it includes the floor, put it in the floor layer
    const roomCorner = document.createElement('img');
    roomCorner.src = 'assets/cursy-office/room/lvngroom_wall02_COL03.png';
    roomCorner.alt = 'Room Corner';
    // Use natural size and scale up 2x for bigger room
    roomCorner.style.position = 'absolute';
    roomCorner.style.bottom = '0';
    roomCorner.style.left = '50%';
    roomCorner.style.transform = 'translateX(-50%)';
    roomCorner.style.width = '300px'; // 2x the 150px original
    roomCorner.style.height = 'auto'; // Maintain aspect ratio
    roomCorner.onerror = () => {
        // Fallback: create a colored div if image doesn't exist
        roomCorner.style.display = 'none';
        const fallback = document.createElement('div');
        fallback.style.width = '100%';
        fallback.style.height = '100%';
        fallback.style.background = 'linear-gradient(to bottom, #f5f4f2 0%, #f5f4f2 60%, #8b6f47 60%, #8b6f47 100%)';
        floorLayer.appendChild(fallback);
    };
    floorLayer.appendChild(roomCorner);
    console.log('✅ Room corner added to floor layer');
    
    // Rug on the floor (double sized: 60x30 → 120x60)
    const rug = document.createElement('img');
    rug.src = 'assets/cursy-office/furniture/hmoff_rug01.png';
    rug.alt = 'Rug';
    rug.style.position = 'absolute';
    rug.style.bottom = '40px'; // Positioned on the floor
    rug.style.left = '50%'; // Center horizontally
    rug.style.transform = 'translateX(-50%)'; // Center it
    rug.style.width = '120px'; // Double size
    rug.style.height = '60px'; // Double size
    rug.onerror = () => {
        rug.style.display = 'none';
    };
    floorLayer.appendChild(rug);
    console.log('✅ Rug added to floor layer');
    
    // Bookcase in top right corner
    const bookcase = document.createElement('img');
    bookcase.src = 'assets/cursy-office/furniture/hmoff_bookshelf05.png';
    bookcase.alt = 'Bookcase';
    bookcase.style.position = 'absolute';
    bookcase.style.top = '79px'; // User specified
    bookcase.style.right = '120px'; // User specified
    bookcase.onerror = () => {
        bookcase.style.display = 'none';
    };
    furnitureLayer.appendChild(bookcase);
    console.log('✅ Bookcase added to furniture layer');
    
    // Second desk with laptop and printer on the right side
    const desk2 = document.createElement('img');
    desk2.src = 'assets/cursy-office/furniture/hmoff_COL02.png';
    desk2.alt = 'Desk with Laptop and Printer';
    desk2.style.position = 'absolute';
    desk2.style.top = '138px'; // User specified
    desk2.style.right = '20px'; // User specified
    desk2.onerror = () => {
        desk2.style.display = 'none';
    };
    furnitureLayer.appendChild(desk2);
    console.log('✅ Second desk added to furniture layer');
    
    // Gaming chair for the second desk
    const gamingChair = document.createElement('img');
    gamingChair.src = 'assets/cursy-office/furniture/hmoff_officeChair02.png';
    gamingChair.alt = 'Gaming Chair';
    gamingChair.style.position = 'absolute';
    gamingChair.style.top = '147px'; // User specified
    gamingChair.style.right = '56px'; // User specified
    gamingChair.onerror = () => {
        gamingChair.style.display = 'none';
    };
    furnitureLayer.appendChild(gamingChair);
    console.log('✅ Gaming chair added to furniture layer');
    
    // First armchair - right wall next to the bookcase
    const armchair1 = document.createElement('img');
    armchair1.src = 'assets/cursy-office/furniture/hmoff_armchair.png';
    armchair1.alt = 'Armchair';
    armchair1.style.position = 'absolute';
    armchair1.style.top = '116px'; // User specified
    armchair1.style.right = '91px'; // User specified
    armchair1.onerror = () => {
        armchair1.style.display = 'none';
    };
    furnitureLayer.appendChild(armchair1);
    console.log('✅ First armchair added to furniture layer');
    
    // Second armchair - bottom on the back wall (invisible wall)
    const armchair2 = document.createElement('img');
    armchair2.src = 'assets/cursy-office/furniture/hmoff_armchair_bCOL.png';
    armchair2.alt = 'Armchair Back Wall';
    armchair2.style.position = 'absolute';
    armchair2.style.bottom = '10px'; // User specified
    armchair2.style.left = '55%'; // User specified
    armchair2.style.transform = 'translateX(-50%)'; // Center it
    armchair2.onerror = () => {
        armchair2.style.display = 'none';
    };
    furnitureLayer.appendChild(armchair2);
    console.log('✅ Second armchair added to furniture layer');
    
    // Couch for the back wall
    const couch = document.createElement('img');
    couch.src = 'assets/cursy-office/furniture/lvngroom_couch_b.png';
    couch.alt = 'Couch';
    couch.style.position = 'absolute';
    couch.style.bottom = '30px'; // User specified
    couch.style.left = '61%'; // User specified
    couch.onerror = () => {
        couch.style.display = 'none';
    };
    furnitureLayer.appendChild(couch);
    console.log('✅ Couch added to furniture layer');
    
    // Record player/entertainment system next to Cursy (on the left side)
    const recordPlayer = document.createElement('img');
    recordPlayer.src = 'assets/cursy-office/furniture/lvngroom_rack06.png';
    recordPlayer.alt = 'Record Player Entertainment System';
    recordPlayer.style.position = 'absolute';
    recordPlayer.style.bottom = '25%'; // User specified
    recordPlayer.style.left = '1%'; // User specified
    recordPlayer.onerror = () => {
        recordPlayer.style.display = 'none';
    };
    furnitureLayer.appendChild(recordPlayer);
    console.log('✅ Record player added to furniture layer');
    
    // Table in the middle of the room
    const table = document.createElement('img');
    table.src = 'assets/cursy-office/furniture/lvngroom_rack05.png';
    table.alt = 'Table';
    table.style.position = 'absolute';
    table.style.bottom = '43px'; // User specified
    table.style.left = '55%'; // User specified
    table.style.transform = 'translateX(-50%)'; // Center it
    table.onerror = () => {
        table.style.display = 'none';
    };
    furnitureLayer.appendChild(table);
    console.log('✅ Table added to furniture layer');
    
    // Old TV on the table (or next to it)
    const oldTV = document.createElement('img');
    oldTV.src = 'assets/cursy-office/furniture/lvngroom_oldtv2.png';
    oldTV.alt = 'Old TV';
    oldTV.style.position = 'absolute';
    oldTV.style.bottom = '67px'; // User specified
    oldTV.style.left = '55%'; // User specified
    oldTV.style.transform = 'translateX(-50%)'; // Center it
    oldTV.onerror = () => {
        oldTV.style.display = 'none';
    };
    furnitureLayer.appendChild(oldTV);
    console.log('✅ Old TV added to furniture layer');
    
    // Note: Main desk/computer is part of the character animation sprites, no separate asset needed
    
    // Add wall decorations on the left wall - positions adjusted for 270px room height (was 400px)
    // Corkboard with pinned notes
    const corkboard = document.createElement('img');
    corkboard.src = 'assets/cursy-office/props/pinnednote03.png';
    corkboard.alt = 'Corkboard';
    corkboard.style.position = 'absolute';
    corkboard.style.top = '95px'; // Adjusted for 270px room height
    corkboard.style.left = '10px'; // User specified
    corkboard.onerror = () => {
        corkboard.style.display = 'none';
    };
    propsLayer.appendChild(corkboard);
    
    // Abstract poster
    const poster = document.createElement('img');
    poster.src = 'assets/cursy-office/props/assortedposters01.png';
    poster.alt = 'Poster';
    poster.style.position = 'absolute';
    poster.style.top = '81px'; // Adjusted for 270px room height
    poster.style.left = '40px'; // User specified
    poster.onerror = () => {
        poster.style.display = 'none';
    };
    propsLayer.appendChild(poster);
    
    // Framed painting - wallFrame03 (double sized: 12x24 → 24x48)
    const wallFrame = document.createElement('img');
    wallFrame.src = 'assets/cursy-office/props/wallFrame03.png';
    wallFrame.alt = 'Framed Painting';
    wallFrame.style.position = 'absolute';
    wallFrame.style.top = '64px'; // Adjusted for 270px room height
    wallFrame.style.left = '82px'; // User specified
    wallFrame.style.width = '24px'; // Double size (12x24 → 24x48)
    wallFrame.style.height = '48px';
    wallFrame.onerror = () => {
        wallFrame.style.display = 'none';
    };
    propsLayer.appendChild(wallFrame);
    
    // Framed painting - caretakerframe03
    const caretakerFrame = document.createElement('img');
    caretakerFrame.src = 'assets/cursy-office/props/caretakerframe03.png';
    caretakerFrame.alt = 'Framed Art';
    caretakerFrame.style.position = 'absolute';
    caretakerFrame.style.top = '61px'; // Adjusted for 270px room height
    caretakerFrame.style.left = '119px'; // User specified
    caretakerFrame.onerror = () => {
        caretakerFrame.style.display = 'none';
    };
    propsLayer.appendChild(caretakerFrame);
    
    // Add wall decorations on the right wall - positions adjusted for 270px room height (was 400px)
    // LOVE Poster (swapped - should be where I < U Banner was)
    const lovePoster = document.createElement('img');
    lovePoster.src = 'assets/cursy-office/props/wallFrame09.png';
    lovePoster.alt = 'LOVE Poster';
    lovePoster.style.position = 'absolute';
    lovePoster.style.top = '90px'; // Adjusted for 270px room height
    lovePoster.style.right = '10px'; // User specified
    lovePoster.onerror = () => {
        lovePoster.style.display = 'none';
    };
    propsLayer.appendChild(lovePoster);
    
    // Clock
    const clock = document.createElement('img');
    clock.src = 'assets/cursy-office/props/clock02.png';
    clock.alt = 'Clock';
    clock.style.position = 'absolute';
    clock.style.top = '78px'; // Adjusted for 270px room height
    clock.style.right = '66px'; // User specified
    clock.onerror = () => {
        clock.style.display = 'none';
    };
    propsLayer.appendChild(clock);
    
    // Vintage mirror (double sized: 8x22 → 16x44)
    const mirror = document.createElement('img');
    mirror.src = 'assets/cursy-office/props/mirrorvintage02.png';
    mirror.alt = 'Mirror';
    mirror.style.position = 'absolute';
    mirror.style.top = '95px'; // Adjusted for 270px room height
    mirror.style.right = '44px'; // User specified
    mirror.style.width = '16px'; // Double size (8x22 → 16x44)
    mirror.style.height = '44px';
    mirror.onerror = () => {
        mirror.style.display = 'none';
    };
    propsLayer.appendChild(mirror);
    
    // I < U Banner (swapped - should be where LOVE Poster was)
    const iLoveUBanner = document.createElement('img');
    iLoveUBanner.src = 'assets/cursy-office/props/wallFrame11.png';
    iLoveUBanner.alt = 'I < U Banner';
    iLoveUBanner.style.position = 'absolute';
    iLoveUBanner.style.top = '105px'; // Adjusted for 270px room height
    iLoveUBanner.style.right = '18px'; // User specified
    iLoveUBanner.onerror = () => {
        iLoveUBanner.style.display = 'none';
    };
    propsLayer.appendChild(iLoveUBanner);
    
    // New right wall decorations (flipped in MS Paint for right wall)
    // Wall Frame 12
    const wallFrame12 = document.createElement('img');
    wallFrame12.src = 'assets/cursy-office/props/wallFrame12COL.png';
    wallFrame12.alt = 'Wall Frame 12';
    wallFrame12.style.position = 'absolute';
    wallFrame12.style.top = '112px'; // User specified
    wallFrame12.style.right = '5px'; // User specified
    wallFrame12.onerror = () => {
        wallFrame12.style.display = 'none';
    };
    propsLayer.appendChild(wallFrame12);
    
    // Assorted Posters 02
    const assortedPosters02 = document.createElement('img');
    assortedPosters02.src = 'assets/cursy-office/props/assortedposters02.png';
    assortedPosters02.alt = 'Assorted Posters 02';
    assortedPosters02.style.position = 'absolute';
    assortedPosters02.style.top = '58px'; // User specified
    assortedPosters02.style.right = '50px'; // User specified
    assortedPosters02.onerror = () => {
        assortedPosters02.style.display = 'none';
    };
    propsLayer.appendChild(assortedPosters02);
    
    // Caretaker Frame 05
    const caretakerFrame05 = document.createElement('img');
    caretakerFrame05.src = 'assets/cursy-office/props/caretakerframe05.png';
    caretakerFrame05.alt = 'Caretaker Frame 05';
    caretakerFrame05.style.position = 'absolute';
    caretakerFrame05.style.top = '96px'; // User specified
    caretakerFrame05.style.right = '70px'; // User specified
    caretakerFrame05.onerror = () => {
        caretakerFrame05.style.display = 'none';
    };
    propsLayer.appendChild(caretakerFrame05);
    
    // Pinned Note 01
    const pinnedNote01 = document.createElement('img');
    pinnedNote01.src = 'assets/cursy-office/props/pinnednote01.png';
    pinnedNote01.alt = 'Pinned Note 01';
    pinnedNote01.style.position = 'absolute';
    pinnedNote01.style.top = '58px'; // User specified
    pinnedNote01.style.right = '90px'; // User specified
    pinnedNote01.onerror = () => {
        pinnedNote01.style.display = 'none';
    };
    propsLayer.appendChild(pinnedNote01);
    
    console.log('✅ Props added:', propsLayer.children.length);
}

// Initialize Cursy to idle state
function initCursyVisualization() {
    const cursyVisualization = document.getElementById('cursyVisualization');
    // Rebuild office if visualization is visible on load
    if (cursyVisualization && cursyVisualization.style.display !== 'none') {
        buildCursyOffice();
    }
    updateCursyState('idle', 'Ready to help!');
}

// ============================================
// Toast Notification System
// ============================================

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    container.appendChild(toast);
    
    // Auto-remove after duration
    if (duration > 0) {
        setTimeout(() => {
            toast.classList.add('slide-out');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, duration);
    }
}

// Expose globally for easy access
window.showToast = showToast;

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
    // Clear undo stack when loading a new project
    state.undoStack = [];
    updateUndoUI();
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
    
    // Load Agent_Persona.md if it exists
    await loadAgentPersona(projectPath);
    
    // Load PROJECT_JOURNAL.md if it exists
    await loadProjectJournal(projectPath);
    
    await loadProjectFiles(projectPath);
}

async function loadProjectFiles(projectPath) {
    try {
        const result = await window.electronAPI.readDir(projectPath);
        if (result.success) {
            const files = buildFileTree(result.files);
            renderFileTree(files);
            const projectName = projectPath.split(/[/\\]/).pop();
            showToast(`Project loaded: ${projectName}`, 'success', 2000);
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
        // Check if file is already open in a tab
        const existingTab = state.openTabs.find(t => t.path === filePath || t.path.replace(/\\/g, '/') === filePath.replace(/\\/g, '/'));
        if (existingTab) {
            // File is already open, refresh it from disk
            console.log('📄 File already open, refreshing from disk:', filePath);
            const result = await window.electronAPI.readFile(filePath);
            if (result.success) {
                existingTab.content = result.content;
                existingTab.isDirty = false;
                // If it's the active tab, update the editor
                if (existingTab.id === state.activeTab && state.monacoEditor) {
                    state.monacoEditor.setValue(result.content);
                }
                renderTabs();
                switchToTab(existingTab.id);
                return;
            }
        }
        
        const result = await window.electronAPI.readFile(filePath);
        if (result.success) {
            console.log('📄 Opened file from disk:', filePath, 'content length:', result.content.length);
            console.log('📄 First 200 chars:', result.content.substring(0, 200));
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
    
    // Initialize OpenAI client
    setTimeout(() => {
        initOpenAI();
    }, 500);
    
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
    
    // Undo button
    const undoBtn = document.getElementById('btnUndo');
    if (undoBtn) {
        undoBtn.addEventListener('click', undoLastOperation);
        updateUndoUI(); // Initialize UI state
    }
    
    // Keyboard shortcut for undo (Ctrl+Z / Cmd+Z)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            // Only trigger if not in an input/textarea (to avoid interfering with editor undo)
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                // Check if it's the chat input - allow undo for file operations
                if (activeElement.id === 'chatInput') {
                    e.preventDefault();
                    undoLastOperation();
                }
                // Otherwise let the default editor undo work
            } else {
                e.preventDefault();
                undoLastOperation();
            }
        }
    });
    
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
        
        // Check if there's a pending tab with content to load
        const activeTab = state.openTabs.find(t => t.id === state.activeTab);
        const initialValue = activeTab?.pendingContent || activeTab?.content || '// Welcome to VIBE IDE!\n// Start coding your project here...\n\nconsole.log("Hello, VIBE IDE!");';
        const initialLanguage = activeTab ? getLanguageFromFileName(activeTab.name) : 'javascript';
        
        // Create Monaco Editor instance
        state.monacoEditor = monaco.editor.create(editorContainer, {
            value: initialValue,
            language: initialLanguage,
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
        
        // If there was pending content, clear it now that it's set
        if (activeTab && activeTab.pendingContent) {
            activeTab.pendingContent = undefined;
            console.log('✅ Set pending content in Monaco Editor');
        }
        
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
        tabElement.setAttribute('title', tab.path); // Tooltip with full path
        const fileIcon = getFileIcon(tab.name);
        tabElement.innerHTML = `
            <span class="tab-icon">${fileIcon}</span>
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

async function switchToTab(tabId) {
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
        console.log('Monaco Editor not initialized, checking if Monaco library is loaded...');
        
        // Wait for Monaco library to load
        let monacoLoaded = typeof monaco !== 'undefined';
        if (!monacoLoaded) {
            console.log('⏳ Waiting for Monaco library to load...');
            let retries = 0;
            const maxRetries = 50; // Wait up to 10 seconds
            while (!monacoLoaded && retries < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 200));
                monacoLoaded = typeof monaco !== 'undefined';
                retries++;
            }
        }
        
        if (monacoLoaded) {
            console.log('✅ Monaco library loaded, initializing editor...');
            // Initialize Monaco directly - don't rely on window.initMonacoEditor which might be placeholder
            try {
                const editorContainer = document.getElementById('monacoEditor');
                if (!editorContainer) {
                    console.error('❌ Monaco Editor container not found');
                    return;
                }
                
                if (state.monacoEditor) {
                    console.log('Monaco Editor already initialized');
                } else {
                    // Create Monaco Editor instance directly
                    state.monacoEditor = monaco.editor.create(editorContainer, {
                        value: '',
                        language: 'plaintext',
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
                }
            } catch (err) {
                console.error('❌ Error initializing Monaco Editor:', err);
            }
        } else {
            console.error('❌ Monaco library failed to load after waiting');
            editorContainer.innerHTML = '<div style="padding: 20px; color: #f48771;">Monaco Editor failed to load. Please refresh the app.</div>';
            renderTabs();
            return;
        }
    }
    
    // Double-check Monaco is ready before proceeding
    if (!state.monacoEditor) {
        console.warn('⚠️ Monaco Editor still not ready after initialization attempt');
        editorContainer.innerHTML = '<div style="padding: 20px; color: #f48771;">Monaco Editor is still initializing... Please wait.</div>';
        renderTabs();
        return;
    }
    
    // Re-read file from disk ONLY if file is not dirty (hasn't been modified)
    // This prevents stale cached content while preserving unsaved changes
    if (tab.path && window.electronAPI && window.electronAPI.readFile && !tab.isDirty) {
        try {
            console.log('📄 Re-reading file from disk (file is clean):', tab.path);
            const result = await window.electronAPI.readFile(tab.path);
            if (result.success) {
                // Update tab content with fresh content from disk
                const oldLength = tab.content ? tab.content.length : 0;
                tab.content = result.content;
                console.log('✅ Refreshed tab content from disk:', tab.name, 'old length:', oldLength, 'new length:', result.content.length);
                console.log('📄 First 200 chars of file:', result.content.substring(0, 200));
            } else {
                console.error('❌ Failed to read file from disk:', result.error);
            }
        } catch (err) {
            console.error('❌ Error reading file from disk:', err);
        }
    } else if (tab.isDirty) {
        console.log('📝 File is dirty (has unsaved changes), skipping disk refresh:', tab.name);
    } else {
        console.warn('⚠️ Cannot refresh file - missing path or electronAPI');
    }
    
    // Update Monaco editor content - wait for Monaco to be ready
    if (tab.content !== undefined) {
        // Wait for Monaco to be ready if it's not yet
        let monacoReady = false;
        let retries = 0;
        while (!state.monacoEditor && retries < 20) {
            await new Promise(resolve => setTimeout(resolve, 100));
            retries++;
        }
        
        if (state.monacoEditor) {
            console.log('✅ Monaco Editor ready, setting content for:', tab.name);
            state.monacoEditor.setValue(tab.content);
            // Set language based on file extension
            const language = getLanguageFromFileName(tab.name);
            monaco.editor.setModelLanguage(state.monacoEditor.getModel(), language);
            
            // Setup markdown preview listener
            setupMarkdownPreviewListener();
            
            // Handle markdown preview mode - DEFAULT TO PREVIEW for .md files!
            const isMarkdown = tab.name.endsWith('.md') || tab.name.endsWith('.markdown');
            if (isMarkdown) {
                // Default to preview mode for markdown files (unless explicitly set to edit)
                if (state.mdPreviewMode === undefined || state.mdPreviewMode === null) {
                    state.mdPreviewMode = true; // Default to preview for 10-year-olds!
                }
                
                // Show toolbar
                const toolbar = document.getElementById('mdToolbar');
                if (toolbar) {
                    toolbar.style.display = 'flex';
                    setupMarkdownToolbar();
                    // Double-check preview toggle button exists and is visible
                    const previewToggle = document.getElementById('mdPreviewToggle');
                    if (!previewToggle) {
                        console.warn('⚠️ Preview toggle button missing, recreating...');
                        // Recreate button if missing
                        const separator = toolbar.querySelector('.md-toolbar-separator:last-of-type');
                        if (separator && separator.nextSibling) {
                            const btn = document.createElement('button');
                            btn.id = 'mdPreviewToggle';
                            btn.className = 'md-toolbar-btn';
                            btn.title = 'Toggle Preview/Editor';
                            btn.innerHTML = '👁️ Preview';
                            toolbar.insertBefore(btn, separator.nextSibling);
                            setupMarkdownToolbar(); // Re-setup to attach event listener
                        }
                    }
                }
                
                if (state.mdPreviewMode) {
                    // Show preview, hide editor
                    document.getElementById('monacoEditor').style.display = 'none';
                    document.getElementById('mdPreview').style.display = 'block';
                    updateMarkdownPreview();
                } else {
                    // Show editor, hide preview
                    document.getElementById('monacoEditor').style.display = 'block';
                    document.getElementById('mdPreview').style.display = 'none';
                }
                // Update toggle button state
                updatePreviewToggleButton();
            } else {
                // Hide toolbar for non-markdown files
                const toolbar = document.getElementById('mdToolbar');
                if (toolbar) toolbar.style.display = 'none';
                
                // Show editor, hide preview
                document.getElementById('monacoEditor').style.display = 'block';
                document.getElementById('mdPreview').style.display = 'none';
            }
            
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
        } else {
            console.error('❌ Monaco Editor not ready after waiting, content will be set when editor initializes');
            // Store content to set later when Monaco is ready
            tab.pendingContent = tab.content;
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
    const fileTreeContainer = document.getElementById('fileTreeContainer') || document.querySelector('.file-tree');
    if (!fileTreeContainer) return;
    
    fileTreeContainer.innerHTML = '';
    
    if (!files || files.length === 0) {
        fileTreeContainer.innerHTML = '<div class="tree-item folder"><span class="tree-icon">📁</span><span class="tree-label">No project loaded</span></div>';
        return;
    }
    
    files.forEach(file => {
        const treeItem = createTreeItem(file);
        fileTreeContainer.appendChild(treeItem);
    });
    
    // Initialize search and context menu
    initFileTreeFeatures();
}

function createTreeItem(file, level = 0) {
    const item = document.createElement('div');
    item.className = `tree-item ${file.type}`;
    item.setAttribute('data-path', file.path);
    item.setAttribute('data-name', file.name);
    item.setAttribute('data-level', level);
    
    const icon = file.type === 'folder' ? '📁' : getFileIcon(file.name);
    
    item.innerHTML = `
        <span class="tree-icon">${icon}</span>
        <span class="tree-label">${file.name}</span>
    `;
    
    // Add children container if folder has children
    if (file.type === 'folder' && file.children && file.children.length > 0) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children';
        file.children.forEach(child => {
            const childItem = createTreeItem(child, level + 1);
            childrenContainer.appendChild(childItem);
        });
        item.appendChild(childrenContainer);
        item.classList.add('collapsed');
    }
    
    // Left click handlers
    if (file.type === 'file') {
        item.addEventListener('click', (e) => {
            if (!e.ctrlKey && !e.metaKey) {
                openFile(file.path, file.name);
            }
        });
    } else if (file.type === 'folder') {
        item.addEventListener('click', (e) => {
            if (!e.ctrlKey && !e.metaKey) {
                toggleFolder(item);
            }
        });
    }
    
    // Right click for context menu
    item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, file);
    });
    
    return item;
}

function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const iconMap = {
        // Code files
        'js': '📜',
        'jsx': '⚛️',
        'ts': '📘',
        'tsx': '⚛️',
        'json': '📋',
        'html': '🌐',
        'htm': '🌐',
        'css': '🎨',
        'scss': '🎨',
        'sass': '🎨',
        'less': '🎨',
        'md': '📝',
        'mdx': '📝',
        'py': '🐍',
        'java': '☕',
        'cpp': '⚙️',
        'c': '⚙️',
        'cs': '🔷',
        'php': '🐘',
        'rb': '💎',
        'go': '🐹',
        'rs': '🦀',
        'swift': '🐦',
        'kt': '🔷',
        'sh': '💻',
        'bat': '💻',
        'ps1': '💻',
        // Images
        'png': '🖼️',
        'jpg': '🖼️',
        'jpeg': '🖼️',
        'gif': '🖼️',
        'svg': '🖼️',
        'webp': '🖼️',
        'ico': '🖼️',
        // Audio
        'mp3': '🔊',
        'wav': '🔊',
        'ogg': '🔊',
        'flac': '🔊',
        // Video
        'mp4': '🎬',
        'avi': '🎬',
        'mov': '🎬',
        'webm': '🎬',
        // Documents
        'pdf': '📕',
        'doc': '📘',
        'docx': '📘',
        'txt': '📄',
        'rtf': '📄',
        // Data
        'xml': '📄',
        'yaml': '📄',
        'yml': '📄',
        'toml': '📄',
        'ini': '⚙️',
        'config': '⚙️',
        // Archives
        'zip': '📦',
        'rar': '📦',
        '7z': '📦',
        'tar': '📦',
        'gz': '📦',
        // Other
        'lock': '🔒',
        'gitignore': '🚫',
        'env': '🔐',
        'log': '📋'
    };
    return iconMap[ext] || '📄';
}

function toggleFolder(item) {
    item.classList.toggle('expanded');
    item.classList.toggle('collapsed');
    
    // Update icon rotation
    const icon = item.querySelector('.tree-icon');
    if (icon) {
        if (item.classList.contains('expanded')) {
            icon.style.transform = 'rotate(90deg)';
        } else {
            icon.style.transform = 'rotate(0deg)';
        }
    }
}

// File Tree Features: Search and Context Menu
let currentContextFile = null;

function initFileTreeFeatures() {
    // File tree search
    const searchInput = document.getElementById('fileTreeSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterFileTree(e.target.value);
        });
        
        // Clear search on Escape
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.target.value = '';
                filterFileTree('');
            }
        });
    }
    
    // Close context menu on click outside
    document.addEventListener('click', (e) => {
        const contextMenu = document.getElementById('fileTreeContextMenu');
        if (contextMenu && !contextMenu.contains(e.target)) {
            contextMenu.style.display = 'none';
            currentContextFile = null;
        }
    });
    
    // Context menu actions
    setupContextMenuActions();
}

function filterFileTree(searchTerm) {
    const items = document.querySelectorAll('.tree-item');
    const term = searchTerm.toLowerCase().trim();
    
    if (!term) {
        items.forEach(item => {
            item.classList.remove('hidden');
            // Show parent folders if child matches
            let parent = item.parentElement;
            while (parent && parent.classList.contains('tree-children')) {
                parent.style.display = '';
                parent = parent.parentElement;
            }
        });
        return;
    }
    
    items.forEach(item => {
        const name = (item.getAttribute('data-name') || '').toLowerCase();
        const matches = name.includes(term);
        
        if (matches) {
            item.classList.remove('hidden');
            // Show parent folders
            let parent = item.parentElement;
            while (parent && parent.classList.contains('tree-children')) {
                parent.style.display = '';
                const parentItem = parent.parentElement;
                if (parentItem && parentItem.classList.contains('tree-item')) {
                    parentItem.classList.add('expanded');
                    parentItem.classList.remove('collapsed');
                    const icon = parentItem.querySelector('.tree-icon');
                    if (icon) icon.style.transform = 'rotate(90deg)';
                }
                parent = parent.parentElement;
            }
        } else {
            // Check if any children match
            const children = item.querySelectorAll('.tree-item');
            const hasMatchingChild = Array.from(children).some(child => {
                const childName = (child.getAttribute('data-name') || '').toLowerCase();
                return childName.includes(term);
            });
            
            if (hasMatchingChild) {
                item.classList.remove('hidden');
                item.classList.add('expanded');
                item.classList.remove('collapsed');
                const icon = item.querySelector('.tree-icon');
                if (icon) icon.style.transform = 'rotate(90deg)';
            } else {
                item.classList.add('hidden');
            }
        }
    });
}

function showContextMenu(e, file) {
    const contextMenu = document.getElementById('fileTreeContextMenu');
    if (!contextMenu) return;
    
    currentContextFile = file;
    
    // Position menu
    contextMenu.style.display = 'block';
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
    
    // Show/hide menu items based on file type
    const newFileBtn = document.getElementById('ctxNewFile');
    const newFolderBtn = document.getElementById('ctxNewFolder');
    const renameBtn = document.getElementById('ctxRename');
    const deleteBtn = document.getElementById('ctxDelete');
    const copyPathBtn = document.getElementById('ctxCopyPath');
    
    if (file.type === 'folder') {
        // For folders, show new file/folder options
        if (newFileBtn) newFileBtn.style.display = 'flex';
        if (newFolderBtn) newFolderBtn.style.display = 'flex';
    } else {
        // For files, hide new file/folder options
        if (newFileBtn) newFileBtn.style.display = 'none';
        if (newFolderBtn) newFolderBtn.style.display = 'none';
    }
}

function setupContextMenuActions() {
    const ctxNewFile = document.getElementById('ctxNewFile');
    const ctxNewFolder = document.getElementById('ctxNewFolder');
    const ctxRename = document.getElementById('ctxRename');
    const ctxDelete = document.getElementById('ctxDelete');
    const ctxCopyPath = document.getElementById('ctxCopyPath');
    
    if (ctxNewFile) {
        ctxNewFile.addEventListener('click', () => {
            handleNewFile();
        });
    }
    
    if (ctxNewFolder) {
        ctxNewFolder.addEventListener('click', () => {
            handleNewFolder();
        });
    }
    
    if (ctxRename) {
        ctxRename.addEventListener('click', () => {
            handleRenameFile();
        });
    }
    
    if (ctxDelete) {
        ctxDelete.addEventListener('click', () => {
            handleDeleteFile();
        });
    }
    
    if (ctxCopyPath) {
        ctxCopyPath.addEventListener('click', () => {
            handleCopyPath();
        });
    }
}

async function handleNewFile() {
    if (!currentContextFile || !state.currentProject) return;
    const folderPath = currentContextFile.type === 'folder' ? currentContextFile.path : 
                      currentContextFile.path.split(/[/\\]/).slice(0, -1).join('/');
    
    const fileName = prompt('Enter file name:');
    if (!fileName) return;
    
    // Normalize path separators
    const normalizedFolderPath = folderPath.replace(/\\/g, '/');
    const filePath = normalizedFolderPath + (normalizedFolderPath.endsWith('/') ? '' : '/') + fileName;
    
    try {
        const result = await window.electronAPI.createFile(filePath, '');
        if (result.success) {
            showToast(`File "${fileName}" created!`, 'success');
            // Refresh file tree
            await loadProjectFiles(state.currentProject.path);
        } else {
            showToast(result.error || 'Failed to create file', 'error');
        }
    } catch (error) {
        showToast('Failed to create file: ' + error.message, 'error');
    }
}

async function handleNewFolder() {
    if (!currentContextFile || !state.currentProject) return;
    const folderPath = currentContextFile.type === 'folder' ? currentContextFile.path : 
                      currentContextFile.path.split(/[/\\]/).slice(0, -1).join('/');
    
    const folderName = prompt('Enter folder name:');
    if (!folderName) return;
    
    // Normalize path separators
    const normalizedFolderPath = folderPath.replace(/\\/g, '/');
    const newFolderPath = normalizedFolderPath + (normalizedFolderPath.endsWith('/') ? '' : '/') + folderName;
    
    try {
        const result = await window.electronAPI.createFolder(newFolderPath);
        if (result.success) {
            showToast(`Folder "${folderName}" created!`, 'success');
            // Refresh file tree
            await loadProjectFiles(state.currentProject.path);
        } else {
            showToast(result.error || 'Failed to create folder', 'error');
        }
    } catch (error) {
        showToast('Failed to create folder: ' + error.message, 'error');
    }
}

async function handleRenameFile() {
    if (!currentContextFile || !state.currentProject) return;
    
    const oldPath = currentContextFile.path;
    const oldName = currentContextFile.name;
    const parentPath = oldPath.split(/[/\\]/).slice(0, -1).join('/');
    
    const newName = prompt('Enter new name:', oldName);
    if (!newName || newName === oldName) return;
    
    // Normalize path separators
    const normalizedParentPath = parentPath.replace(/\\/g, '/');
    const newPath = normalizedParentPath + (normalizedParentPath.endsWith('/') ? '' : '/') + newName;
    
    try {
        const result = await window.electronAPI.renameFile(oldPath, newPath);
        if (result.success) {
            // Store undo operation
            state.undoStack = [{
                type: 'rename',
                oldPath: oldPath,
                newPath: newPath,
                oldName: oldName,
                newName: newName
            }];
            updateUndoUI();
            
            showToast(`Renamed "${oldName}" to "${newName}"`, 'success', 3000);
            
            // Close file if it was open in a tab
            const tab = state.openTabs.find(t => t.path === oldPath);
            if (tab) {
                tab.path = newPath;
                tab.name = newName;
                renderTabs();
            }
            
            // Refresh file tree
            await loadProjectFiles(state.currentProject.path);
        } else {
            showToast(result.error || 'Failed to rename', 'error');
        }
    } catch (error) {
        showToast('Failed to rename: ' + error.message, 'error');
    }
}

async function handleDeleteFile() {
    if (!currentContextFile || !state.currentProject) return;
    
    const filePath = currentContextFile.path;
    const fileName = currentContextFile.name;
    const isDirectory = currentContextFile.type === 'folder';
    
    const confirmMsg = isDirectory 
        ? `Delete folder "${fileName}" and all its contents?`
        : `Delete file "${fileName}"?`;
    
    if (!confirm(confirmMsg)) return;
    
    try {
        // For files, read content before deleting for undo
        let content = null;
        if (!isDirectory) {
            try {
                const readResult = await window.electronAPI.readFile(filePath);
                if (readResult.success) {
                    content = readResult.content;
                }
            } catch (e) {
                console.warn('Could not read file for undo:', e);
            }
        }
        
        const result = await window.electronAPI.deleteFile(filePath);
        if (result.success) {
            // Store undo operation
            state.undoStack = [{
                type: 'delete',
                filePath: filePath,
                fileName: fileName,
                content: content,
                isDirectory: isDirectory
            }];
            updateUndoUI();
            
            showToast(`${isDirectory ? 'Folder' : 'File'} "${fileName}" deleted`, 'success', 3000);
            
            // Close file if it was open in a tab
            const tabIndex = state.openTabs.findIndex(t => t.path === filePath);
            if (tabIndex !== -1) {
                state.openTabs.splice(tabIndex, 1);
                if (state.activeTab === filePath) {
                    state.activeTab = state.openTabs.length > 0 ? state.openTabs[0].id : null;
                }
                renderTabs();
                if (state.activeTab) {
                    switchToTab(state.activeTab);
                } else {
                    document.getElementById('monacoEditor').style.display = 'none';
                    document.getElementById('welcomeScreen').style.display = 'block';
                }
            }
            
            // Refresh file tree
            await loadProjectFiles(state.currentProject.path);
        } else {
            showToast(result.error || 'Failed to delete', 'error');
        }
    } catch (error) {
        showToast('Failed to delete: ' + error.message, 'error');
    }
}

function handleCopyPath() {
    if (!currentContextFile) return;
    
    if (navigator.clipboard) {
        navigator.clipboard.writeText(currentContextFile.path).then(() => {
            showToast('Path copied to clipboard!', 'success', 2000);
        }).catch(() => {
            showToast('Failed to copy path', 'error', 2000);
        });
    } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = currentContextFile.path;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast('Path copied to clipboard!', 'success', 2000);
        } catch (e) {
            showToast('Failed to copy path', 'error', 2000);
        }
        document.body.removeChild(textArea);
    }
    
    // Close context menu
    const contextMenu = document.getElementById('fileTreeContextMenu');
    if (contextMenu) {
        contextMenu.style.display = 'none';
        currentContextFile = null;
    }
}

// Undo functionality
function updateUndoUI() {
    const undoBtn = document.getElementById('btnUndo');
    if (!undoBtn) return;
    
    if (state.undoStack.length > 0) {
        const lastOp = state.undoStack[0];
        let tooltip = 'Undo: ';
        if (lastOp.type === 'rename') {
            tooltip += `Rename "${lastOp.newName}" back to "${lastOp.oldName}"`;
        } else if (lastOp.type === 'delete') {
            tooltip += `Restore ${lastOp.isDirectory ? 'folder' : 'file'} "${lastOp.fileName}"`;
        }
        undoBtn.disabled = false;
        undoBtn.title = tooltip;
    } else {
        undoBtn.disabled = true;
        undoBtn.title = 'No file operations to undo';
    }
}

async function undoLastOperation() {
    if (state.undoStack.length === 0 || !state.currentProject) {
        showToast('Nothing to undo', 'info');
        return;
    }
    
    const operation = state.undoStack[0];
    
    try {
        if (operation.type === 'rename') {
            // Undo rename: rename newPath back to oldPath
            const result = await window.electronAPI.renameFile(operation.newPath, operation.oldPath);
            if (result.success) {
                showToast(`Undone: Renamed "${operation.newName}" back to "${operation.oldName}"`, 'success');
                
                // Update tab if file was open
                const tab = state.openTabs.find(t => t.path === operation.newPath);
                if (tab) {
                    tab.path = operation.oldPath;
                    tab.name = operation.oldName;
                    renderTabs();
                }
                
                // Clear undo stack (can't undo an undo)
                state.undoStack = [];
                updateUndoUI();
                
                // Refresh file tree
                await loadProjectFiles(state.currentProject.path);
            } else {
                showToast('Failed to undo: ' + (result.error || 'Unknown error'), 'error');
            }
        } else if (operation.type === 'delete') {
            // Undo delete: restore file/folder
            if (operation.isDirectory) {
                // For folders, just recreate (content restoration would be complex)
                const result = await window.electronAPI.createFolder(operation.filePath);
                if (result.success) {
                    showToast(`Undone: Restored folder "${operation.fileName}"`, 'success');
                    state.undoStack = [];
                    updateUndoUI();
                    await loadProjectFiles(state.currentProject.path);
                } else {
                    showToast('Failed to undo: ' + (result.error || 'Unknown error'), 'error');
                }
            } else {
                // For files, restore with saved content
                if (operation.content !== null) {
                    const result = await window.electronAPI.createFile(operation.filePath, operation.content);
                    if (result.success) {
                        showToast(`Undone: Restored file "${operation.fileName}"`, 'success');
                        state.undoStack = [];
                        updateUndoUI();
                        await loadProjectFiles(state.currentProject.path);
                    } else {
                        showToast('Failed to undo: ' + (result.error || 'Unknown error'), 'error');
                    }
                } else {
                    // Content wasn't saved, just create empty file
                    const result = await window.electronAPI.createFile(operation.filePath, '');
                    if (result.success) {
                        showToast(`Undone: Restored file "${operation.fileName}" (content may be lost)`, 'warning');
                        state.undoStack = [];
                        updateUndoUI();
                        await loadProjectFiles(state.currentProject.path);
                    } else {
                        showToast('Failed to undo: ' + (result.error || 'Unknown error'), 'error');
                    }
                }
            }
        }
    } catch (error) {
        showToast('Failed to undo: ' + error.message, 'error');
    }
}

// Expose globally for potential onclick handlers
window.undoLastOperation = undoLastOperation;

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

// Convert HTML to Markdown for chat (simpler version)
function htmlToMarkdownForChat(html) {
    if (!html) return '';
    
    // Remove GIF preview images (they're stored separately)
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Remove GIF preview images
    temp.querySelectorAll('.chat-gif-preview').forEach(img => img.remove());
    
    let markdown = '';
    
    function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        }
        
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }
        
        const tag = node.tagName.toLowerCase();
        const children = Array.from(node.childNodes).map(processNode).join('');
        
        switch(tag) {
            case 'strong': case 'b': return `**${children}**`;
            case 'em': case 'i': return `*${children}*`;
            case 'code': return `\`${children}\``;
            case 'pre': return `\`\`\`\n${children}\n\`\`\`\n\n`;
            case 's': case 'del': case 'strike': return `~~${children}~~`;
            case 'br': return '\n';
            case 'p': return `${children}\n\n`;
            case 'div': return `${children}\n`;
            default: return children;
        }
    }
    
    markdown = Array.from(temp.childNodes).map(processNode).join('');
    return markdown.trim();
}

// Simple lightweight markdown parser for chat
function parseSimpleMarkdown(text) {
    // Escape HTML first to prevent XSS
    let html = escapeHtml(text);
    
    // GIF embeds ([GIF:url]) - must be done before other markdown
    html = html.replace(/\[GIF:(https?:\/\/[^\]]+)\]/g, '<img src="$1" class="chat-gif" alt="GIF" style="max-width: 200px; border-radius: 4px; margin: 4px 0;" />');
    
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
        if (para.trim().startsWith('<pre') || para.trim().startsWith('<code') || para.trim().startsWith('<img')) {
            return para; // Don't wrap code blocks or images
        }
        return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
    }).join('');
    
    return html;
}

// Enhanced markdown parser for WYSIWYG preview
function parseMarkdownForPreview(text) {
    if (!text) return '';
    
    let html = text;
    
    // Headers (# ## ### etc.)
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Horizontal rules
    html = html.replace(/^---$/gim, '<hr>');
    html = html.replace(/^\*\*\*$/gim, '<hr>');
    
    // Code blocks with language (```language\ncode```)
    html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
        const language = lang || 'text';
        return `<pre class="md-code-block"><code class="language-${language}">${escapeHtml(code.trim())}</code></pre>`;
    });
    
    // Inline code (`code`)
    html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Italic (*text* or _text_)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // Strikethrough (~~text~~)
    html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    
    // Images ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="md-image" />');
    
    // Blockquotes (> text)
    html = html.replace(/^> (.+)$/gim, '<blockquote>$1</blockquote>');
    
    // Lists (unordered - * or -)
    html = html.replace(/^[\*\-] (.+)$/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
        return '<ul>' + match + '</ul>';
    });
    
    // Lists (ordered - 1. 2. etc.)
    html = html.replace(/^\d+\. (.+)$/gim, '<li>$1</li>');
    
    // Paragraphs (double newline = paragraph)
    html = html.split(/\n\n+/).map(para => {
        para = para.trim();
        if (!para) return '';
        // Don't wrap if it's already a block element
        if (para.match(/^<(h[1-6]|pre|ul|ol|blockquote|hr)/)) {
            return para;
        }
        // Don't wrap if it's a list item
        if (para.match(/^<li>/)) {
            return para;
        }
        return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
    }).filter(p => p).join('\n');
    
    return html;
}

// Toggle markdown preview mode
function toggleMarkdownPreview() {
    const activeTab = state.openTabs.find(t => t.id === state.activeTab);
    if (!activeTab) return;
    
    const isMarkdown = activeTab.name.endsWith('.md') || activeTab.name.endsWith('.markdown');
    if (!isMarkdown) return;
    
    // If switching from preview to edit, save WYSIWYG content back to markdown
    if (state.mdPreviewMode) {
        saveWYSIWYGToMarkdown();
    }
    
    state.mdPreviewMode = !state.mdPreviewMode;
    
    const editorEl = document.getElementById('monacoEditor');
    const previewEl = document.getElementById('mdPreview');
    
    if (state.mdPreviewMode) {
        // Show preview, hide editor - make it editable!
        editorEl.style.display = 'none';
        previewEl.style.display = 'block';
        previewEl.contentEditable = 'true'; // Make preview editable!
        previewEl.setAttribute('spellcheck', 'true');
        updateMarkdownPreview();
        
        // Focus the preview
        setTimeout(() => previewEl.focus(), 100);
    } else {
        // Show editor, hide preview
        previewEl.contentEditable = 'false';
        editorEl.style.display = 'block';
        previewEl.style.display = 'none';
        if (state.monacoEditor) {
            state.monacoEditor.focus();
        }
    }
    
    // Update toggle button text
    updatePreviewToggleButton();
    renderTabs();
}

// Setup markdown toolbar buttons
function setupMarkdownToolbar() {
    const toolbar = document.getElementById('mdToolbar');
    if (!toolbar) return;
    
    // Remove existing listeners to avoid duplicates
    // BUT preserve the preview toggle button - don't clone it
    const buttons = toolbar.querySelectorAll('.md-toolbar-btn:not(#mdPreviewToggle)');
    buttons.forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });
    
    // Make sure preview toggle button exists (it should, but just in case)
    let previewToggle = document.getElementById('mdPreviewToggle');
    if (!previewToggle) {
        // Button was somehow removed, recreate it
        const separator = toolbar.querySelector('.md-toolbar-separator:last-of-type');
        if (separator) {
            previewToggle = document.createElement('button');
            previewToggle.id = 'mdPreviewToggle';
            previewToggle.className = 'md-toolbar-btn';
            previewToggle.title = 'Toggle Preview/Editor';
            previewToggle.innerHTML = '👁️ Preview';
            toolbar.appendChild(previewToggle);
        }
    }
    
    // Setup heading dropdown
    const headingBtn = document.getElementById('headingBtn');
    const headingMenu = document.getElementById('headingMenu');
    if (headingBtn && headingMenu) {
        headingBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            headingMenu.style.display = headingMenu.style.display === 'block' ? 'none' : 'block';
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!headingBtn.contains(e.target) && !headingMenu.contains(e.target)) {
                headingMenu.style.display = 'none';
            }
        });
        
        // Handle heading menu items
        headingMenu.querySelectorAll('.md-toolbar-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = item.getAttribute('data-action');
                headingMenu.style.display = 'none';
                
                // If in preview mode, use WYSIWYG editing
                if (state.mdPreviewMode) {
                    handleWYSIWYGAction(action);
                } else {
                    // If in edit mode, insert markdown syntax
                    handleMarkdownToolbarAction(action);
                }
            });
        });
    }
    
    // Add event listeners for other buttons
    toolbar.querySelectorAll('.md-toolbar-btn[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const action = btn.getAttribute('data-action');
            
            // If in preview mode, use WYSIWYG editing
            if (state.mdPreviewMode) {
                handleWYSIWYGAction(action);
            } else {
                // If in edit mode, insert markdown syntax
                handleMarkdownToolbarAction(action);
            }
        });
    });
    
    // Setup preview toggle button
    const previewToggle = document.getElementById('mdPreviewToggle');
    if (previewToggle) {
        previewToggle.addEventListener('click', (e) => {
            e.preventDefault();
            toggleMarkdownPreview();
            // Update button text
            updatePreviewToggleButton();
        });
        // Set initial button state
        updatePreviewToggleButton();
    }
}

// Update preview toggle button text
function updatePreviewToggleButton() {
    const previewToggle = document.getElementById('mdPreviewToggle');
    if (previewToggle) {
        if (state.mdPreviewMode) {
            previewToggle.innerHTML = '📝 Editor';
            previewToggle.title = 'Switch to Markdown Editor';
        } else {
            previewToggle.innerHTML = '👁️ Preview';
            previewToggle.title = 'Switch to WYSIWYG Preview';
        }
    }
}

// Handle WYSIWYG toolbar actions (when in preview/edit mode)
function handleWYSIWYGAction(action) {
    const previewEl = document.getElementById('mdPreview');
    if (!previewEl || !previewEl.contentEditable) return;
    
    // Get current selection
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    
    // Execute formatting command
    document.execCommand('defaultParagraphSeparator', false, 'div');
    
    switch(action) {
        case 'bold':
            document.execCommand('bold', false, null);
            break;
        case 'italic':
            document.execCommand('italic', false, null);
            break;
        case 'h1':
            document.execCommand('formatBlock', false, '<h1>');
            break;
        case 'h2':
            document.execCommand('formatBlock', false, '<h2>');
            break;
        case 'h3':
            document.execCommand('formatBlock', false, '<h3>');
            break;
        case 'h4':
            document.execCommand('formatBlock', false, '<h4>');
            break;
        case 'ulist':
            document.execCommand('insertUnorderedList', false, null);
            break;
        case 'olist':
            document.execCommand('insertOrderedList', false, null);
            break;
        case 'link':
            const url = prompt('Enter URL:');
            if (url) {
                document.execCommand('createLink', false, url);
            }
            break;
        case 'image':
            const imgUrl = prompt('Enter image URL:');
            if (imgUrl) {
                const img = document.createElement('img');
                img.src = imgUrl;
                img.alt = 'Image';
                img.className = 'md-image';
                range.deleteContents();
                range.insertNode(img);
            }
            break;
        case 'code':
            // Wrap in <code> tag
            const code = document.createElement('code');
            code.className = 'md-inline-code';
            try {
                range.surroundContents(code);
            } catch(e) {
                // If surroundContents fails, insert code element
                code.textContent = range.toString();
                range.deleteContents();
                range.insertNode(code);
            }
            break;
        case 'quote':
            document.execCommand('formatBlock', false, '<blockquote>');
            break;
        case 'hr':
            const hr = document.createElement('hr');
            range.insertNode(hr);
            break;
    }
    
    // Save changes back to markdown
    saveWYSIWYGToMarkdown();
    
    // Restore focus
    previewEl.focus();
}

// Handle toolbar button clicks (when in code/edit mode)
function handleMarkdownToolbarAction(action) {
    if (!state.monacoEditor) return;
    
    const editor = state.monacoEditor;
    const selection = editor.getSelection();
    const model = editor.getModel();
    const selectedText = model.getValueInRange(selection);
    
    let insertText = '';
    let newSelection = null;
    
    switch(action) {
        case 'bold':
            insertText = selectedText ? `**${selectedText}**` : '**bold text**';
            newSelection = { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn + 2, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn + (selectedText ? 2 : 11) };
            break;
        case 'italic':
            insertText = selectedText ? `*${selectedText}*` : '*italic text*';
            newSelection = { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn + 1, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn + (selectedText ? 1 : 12) };
            break;
        case 'h1':
            insertText = selectedText ? `# ${selectedText}` : '# Heading 1';
            newSelection = { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn + 2, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn + (selectedText ? 2 : 9) };
            break;
        case 'h2':
            insertText = selectedText ? `## ${selectedText}` : '## Heading 2';
            newSelection = { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn + 3, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn + (selectedText ? 3 : 9) };
            break;
        case 'h3':
            insertText = selectedText ? `### ${selectedText}` : '### Heading 3';
            newSelection = { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn + 4, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn + (selectedText ? 4 : 9) };
            break;
        case 'h4':
            insertText = selectedText ? `#### ${selectedText}` : '#### Heading 4';
            newSelection = { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn + 5, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn + (selectedText ? 5 : 9) };
            break;
        case 'ulist':
            insertText = selectedText ? `- ${selectedText.split('\n').join('\n- ')}` : '- List item';
            break;
        case 'olist':
            insertText = selectedText ? `1. ${selectedText.split('\n').join('\n1. ')}` : '1. List item';
            break;
        case 'link':
            insertText = selectedText ? `[${selectedText}](url)` : '[link text](url)';
            newSelection = { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn + (selectedText ? selectedText.length + 3 : 10), endLineNumber: selection.startLineNumber, endColumn: selection.startColumn + (selectedText ? selectedText.length + 6 : 13) };
            break;
        case 'image':
            insertText = `![alt text](image-url)`;
            newSelection = { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn + 2, endLineNumber: selection.startLineNumber, endColumn: selection.startColumn + 10 };
            break;
        case 'code':
            insertText = selectedText ? `\`${selectedText}\`` : '`code`';
            newSelection = { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn + 1, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn + (selectedText ? 1 : 4) };
            break;
        case 'quote':
            insertText = selectedText ? `> ${selectedText.split('\n').join('\n> ')}` : '> Quote';
            break;
        case 'hr':
            insertText = '\n---\n';
            break;
    }
    
    if (insertText) {
        editor.executeEdits('markdown-toolbar', [{
            range: selection,
            text: insertText
        }]);
        
        if (newSelection) {
            editor.setSelection(newSelection);
        }
        
        editor.focus();
    }
}

// Convert WYSIWYG HTML back to markdown
function saveWYSIWYGToMarkdown() {
    const previewEl = document.getElementById('mdPreview');
    if (!previewEl || !state.monacoEditor) return;
    
    const html = previewEl.innerHTML;
    let markdown = htmlToMarkdown(html);
    
    // Update Monaco editor with markdown
    state.monacoEditor.setValue(markdown);
    
    // Update tab content
    const activeTab = state.openTabs.find(t => t.id === state.activeTab);
    if (activeTab) {
        activeTab.content = markdown;
        activeTab.isDirty = true;
        renderTabs();
    }
}

// Simple HTML to Markdown converter
function htmlToMarkdown(html) {
    // Create a temporary div to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    let markdown = '';
    
    function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        }
        
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }
        
        const tag = node.tagName.toLowerCase();
        const children = Array.from(node.childNodes).map(processNode).join('');
        
        switch(tag) {
            case 'h1': return `# ${children}\n\n`;
            case 'h2': return `## ${children}\n\n`;
            case 'h3': return `### ${children}\n\n`;
            case 'h4': return `#### ${children}\n\n`;
            case 'h5': return `##### ${children}\n\n`;
            case 'h6': return `###### ${children}\n\n`;
            case 'p': return `${children}\n\n`;
            case 'strong': case 'b': return `**${children}**`;
            case 'em': case 'i': return `*${children}*`;
            case 'code': return `\`${children}\``;
            case 'pre': return `\`\`\`\n${children}\n\`\`\`\n\n`;
            case 'ul': return `${children}\n`;
            case 'ol': return `${children}\n`;
            case 'li': return `- ${children}\n`;
            case 'blockquote': return `> ${children}\n\n`;
            case 'a': return `[${children}](${node.href || ''})`;
            case 'img': return `![${node.alt || ''}](${node.src || ''})`;
            case 'hr': return `---\n\n`;
            case 'br': return '\n';
            default: return children;
        }
    }
    
    markdown = Array.from(temp.childNodes).map(processNode).join('');
    return markdown.trim();
}

// Update markdown preview content
function updateMarkdownPreview() {
    const activeTab = state.openTabs.find(t => t.id === state.activeTab);
    if (!activeTab) return;
    
    const previewEl = document.getElementById('mdPreview');
    if (!previewEl) return;
    
    // Always get content from Monaco editor if available (it has the latest), otherwise from tab content
    let content = '';
    if (state.monacoEditor) {
        content = state.monacoEditor.getValue();
    } else if (activeTab.content) {
        content = activeTab.content;
    }
    
    // Parse and render markdown
    const html = parseMarkdownForPreview(content);
    previewEl.innerHTML = html;
}

// Listen for editor changes to update preview in real-time
function setupMarkdownPreviewListener() {
    if (state.monacoEditor) {
        state.monacoEditor.onDidChangeModelContent(() => {
            if (state.mdPreviewMode) {
                updateMarkdownPreview();
            }
        });
    }
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
        chatInput.tabIndex = 0; // Ensure it's in tab order
        chatInput.style.pointerEvents = 'auto'; // Ensure it can receive clicks
        
        // Ensure input focuses when clicked
        chatInput.addEventListener('click', (e) => {
            e.stopPropagation();
            chatInput.focus();
        });
        
        // Force focus on load (optional - can be removed if annoying)
        // chatInput.focus();
        
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
        
        // GIF picker initialization
        initGifPicker();
        
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
                // For contentEditable, check if it's empty or just whitespace
                if (chatInput.contentEditable === 'true') {
                    const text = chatInput.textContent.trim();
                    if (!text && !chatInput.querySelector('img')) {
                        return; // Don't send empty messages
                    }
                }
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
        
        // Toggle Cursy visualization
        const toggleCursyViz = document.getElementById('toggleCursyViz');
        const cursyVisualization = document.getElementById('cursyVisualization');
        if (toggleCursyViz && cursyVisualization) {
            // Load saved preference
            const savedVisibility = localStorage.getItem('vibe-ide-cursy-viz-visible');
            const isVisible = savedVisibility !== 'false'; // Default to visible
            cursyVisualization.style.display = isVisible ? 'block' : 'none';
            toggleCursyViz.textContent = isVisible ? '👁️' : '👁️‍🗨️';
            toggleCursyViz.title = isVisible ? 'Hide Cursy Visualization' : 'Show Cursy Visualization';
            
            toggleCursyViz.addEventListener('click', () => {
                const isCurrentlyVisible = cursyVisualization.style.display !== 'none';
                cursyVisualization.style.display = isCurrentlyVisible ? 'none' : 'block';
                toggleCursyViz.textContent = isCurrentlyVisible ? '👁️‍🗨️' : '👁️';
                toggleCursyViz.title = isCurrentlyVisible ? 'Show Cursy Visualization' : 'Hide Cursy Visualization';
                localStorage.setItem('vibe-ide-cursy-viz-visible', (!isCurrentlyVisible).toString());
                
                // Rebuild office when visualization is shown
                if (!isCurrentlyVisible) {
                    console.log('🔄 Rebuilding office when visualization shown...');
                    buildCursyOffice();
                }
            });
            
            // Allow right-click context menu on visualization area for element inspection
            cursyVisualization.addEventListener('contextmenu', (e) => {
                // Allow default browser context menu (Inspect Element) on visualization area
                e.stopPropagation(); // Don't let it bubble up to document level
                // Default context menu will show (Inspect Element, etc.)
            });
        }
        
        // Update welcome message with genre context if available
        updateChatWelcomeMessage();
        
        // Initialize Cursy visualization
        initCursyVisualization();
        
        console.log('Chat interface initialized successfully');
    } catch (e) {
        console.error('Error initializing chat interface:', e);
    }
}

// GIF Picker functionality
function initGifPicker() {
    const gifPickerBtn = document.getElementById('gifPickerBtn');
    const gifPickerModal = document.getElementById('gifPickerModal');
    const gifPickerClose = document.getElementById('gifPickerClose');
    const gifSearchInput = document.getElementById('gifSearchInput');
    const gifSearchBtn = document.getElementById('gifSearchBtn');
    const gifPickerResults = document.getElementById('gifPickerResults');
    const gifSuggestionBtns = document.querySelectorAll('.gif-suggestion-btn');
    const chatInput = document.getElementById('chatInput');
    
    if (!gifPickerBtn || !gifPickerModal) return;
    
    // Open GIF picker
    gifPickerBtn.addEventListener('click', () => {
        gifPickerModal.style.display = 'flex';
        gifSearchInput.focus();
    });
    
    // Close GIF picker
    const closeGifPicker = () => {
        gifPickerModal.style.display = 'none';
    };
    
    if (gifPickerClose) {
        gifPickerClose.addEventListener('click', closeGifPicker);
    }
    
    // Close on background click
    gifPickerModal.addEventListener('click', (e) => {
        if (e.target === gifPickerModal) {
            closeGifPicker();
        }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && gifPickerModal.style.display === 'flex') {
            closeGifPicker();
        }
    });
    
    // Search button
    if (gifSearchBtn) {
        gifSearchBtn.addEventListener('click', () => {
            const query = gifSearchInput.value.trim();
            if (query) {
                searchGifs(query);
            }
        });
    }
    
    // Search on Enter key
    if (gifSearchInput) {
        gifSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const query = gifSearchInput.value.trim();
                if (query) {
                    searchGifs(query);
                }
            }
        });
    }
    
    // Suggestion buttons
    gifSuggestionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const term = btn.dataset.term;
            gifSearchInput.value = term;
            searchGifs(term);
        });
    });
    
    // GIF search function
    async function searchGifs(query) {
        if (!gifPickerResults) return;
        
        // Show loading state
        gifPickerResults.innerHTML = '<div class="gif-loading">🔍 Searching GIFs...</div>';
        
        try {
            const apiKey = state.giphyApiKey;
            const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=20&rating=g`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.data && data.data.length > 0) {
                gifPickerResults.innerHTML = '';
                data.data.forEach(gif => {
                    const gifItem = document.createElement('div');
                    gifItem.className = 'gif-result-item';
                    gifItem.title = gif.title || 'GIF';
                    
                    const img = document.createElement('img');
                    img.src = gif.images.fixed_height_small.url;
                    img.alt = gif.title || 'GIF';
                    img.loading = 'lazy';
                    
                    gifItem.appendChild(img);
                    gifItem.addEventListener('click', () => {
                        // Insert GIF visually (but store code separately)
                        const chatGifCode = document.getElementById('chatGifCode');
                        const gifUrl = gif.images.original.url;
                        const gifCode = `[GIF:${gifUrl}]`;
                        
                        // Store GIF code in hidden input (for sending to AI)
                        if (chatGifCode) {
                            const existing = chatGifCode.value;
                            chatGifCode.value = existing ? existing + '\n' + gifCode : gifCode;
                        }
                        
                        // Insert GIF visually in chat input (WYSIWYG)
                        if (chatInput.contentEditable === 'true') {
                            // Insert as image element
                            const selection = window.getSelection();
                            if (selection.rangeCount > 0) {
                                const range = selection.getRangeAt(0);
                                const gifImg = document.createElement('img');
                                gifImg.src = gif.images.fixed_height_small.url;
                                gifImg.alt = 'GIF';
                                gifImg.className = 'chat-gif-preview';
                                gifImg.style.cssText = 'max-width: 100px; max-height: 100px; border-radius: 4px; margin: 4px 0; display: inline-block; vertical-align: middle;';
                                range.insertNode(gifImg);
                                range.setStartAfter(gifImg);
                                range.collapse(true);
                                selection.removeAllRanges();
                                selection.addRange(range);
                            } else {
                                chatInput.appendChild(gifImg);
                            }
                        } else {
                            // Fallback for textarea - insert GIF code
                            insertTextAtCursor(chatInput, gifCode);
                        }
                        
                        // Close picker and focus input
                        closeGifPicker();
                        chatInput.focus();
                    });
                    
                    gifPickerResults.appendChild(gifItem);
                });
            } else {
                gifPickerResults.innerHTML = '<div class="gif-error">No GIFs found. Try a different search term!</div>';
            }
        } catch (error) {
            console.error('Error searching GIFs:', error);
            gifPickerResults.innerHTML = '<div class="gif-error">Error searching GIFs. Please try again later.</div>';
        }
    }
}

// Get a random GIF from GIPHY for a given search term
async function getRandomGif(searchTerm) {
    try {
        const apiKey = state.giphyApiKey;
        const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(searchTerm)}&limit=10&rating=g`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            // Pick a random GIF from the results
            const randomIndex = Math.floor(Math.random() * data.data.length);
            return data.data[randomIndex].images.original.url;
        }
        return null;
    } catch (error) {
        console.error('Error fetching GIF:', error);
        return null;
    }
}

function insertTextAtCursor(element, text) {
    if (element.contentEditable === 'true') {
        // ContentEditable div
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(text);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            element.textContent += text;
        }
    } else {
        // Textarea (fallback)
        const start = element.selectionStart;
        const end = element.selectionEnd;
        const value = element.value;
        element.value = value.substring(0, start) + text + value.substring(end);
        element.selectionStart = element.selectionEnd = start + text.length;
    }
}

function applyFormatting(element, format) {
    if (element.contentEditable === 'true') {
        // WYSIWYG formatting for contentEditable
        document.execCommand('defaultParagraphSeparator', false, 'div');
        
        switch (format) {
            case 'bold':
                document.execCommand('bold', false, null);
                break;
            case 'italic':
                document.execCommand('italic', false, null);
                break;
            case 'code':
                // Wrap in <code> tag
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const code = document.createElement('code');
                    try {
                        range.surroundContents(code);
                    } catch(e) {
                        code.textContent = range.toString();
                        range.deleteContents();
                        range.insertNode(code);
                    }
                }
                break;
            case 'codeblock':
                // Wrap in <pre><code>
                const sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    const rng = sel.getRangeAt(0);
                    const pre = document.createElement('pre');
                    const code = document.createElement('code');
                    pre.appendChild(code);
                    try {
                        code.textContent = rng.toString() || 'code here';
                        rng.deleteContents();
                        rng.insertNode(pre);
                    } catch(e) {
                        code.textContent = rng.toString() || 'code here';
                        rng.deleteContents();
                        rng.insertNode(pre);
                    }
                }
                break;
            case 'strikethrough':
                document.execCommand('strikeThrough', false, null);
                break;
        }
        element.focus();
    } else {
        // Textarea formatting (fallback)
        const start = element.selectionStart;
        const end = element.selectionEnd;
        const selectedText = element.value.substring(start, end);
        
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
        
        const value = element.value;
        element.value = value.substring(0, start) + formattedText + value.substring(end);
        element.selectionStart = element.selectionEnd = newCursorPos;
    }
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
            const aiStatus = state.useOpenAI && state.openaiClient ? '🟢 **AI Enabled**' : '🟡 **Offline Mode**';
            welcomeDiv.innerHTML = `
                <p>👋 Hey! I'm <strong>Cursy</strong>, your AI coding buddy!</p>
                <p>Status: ${aiStatus}</p>
                <p>I can help with:</p>
                <ul style="text-align: left; margin: 10px 0; padding-left: 20px;">
                    <li>Code explanations (functions, variables, loops, arrays)</li>
                    <li>Debugging tips and error fixing</li>
                    <li>Getting started with projects</li>
                    <li>Learning the basics and advanced topics</li>
                    <li>Any coding questions you have!</li>
                </ul>
                <p>Try asking: <em>"How do I create a function?"</em> or <em>"What is a variable?"</em> 😊</p>
                <p style="font-size: 0.9em; opacity: 0.7; margin-top: 10px;">💡 ${state.useOpenAI && state.openaiClient ? 'AI chat is active! Ask me anything!' : 'AI chat will be available when API is configured!'}</p>
            `;
        }
    }
}

// ============================================
// Agent Persona & Project Journal Management
// ============================================

// Load Agent_Persona.md from project
async function loadAgentPersona(projectPath) {
    try {
        const personaPath = projectPath.replace(/[/\\]$/, '') + (projectPath.includes('\\') ? '\\' : '/') + 'Agent_Persona.md';
        if (window.electronAPI && window.electronAPI.readFile) {
            const result = await window.electronAPI.readFile(personaPath);
            if (result.success) {
                state.agentPersona = result.content;
                console.log('✅ Loaded Agent_Persona.md');
                return true;
            }
        }
        state.agentPersona = null;
        return false;
    } catch (error) {
        console.warn('Could not load Agent_Persona.md:', error);
        state.agentPersona = null;
        return false;
    }
}

// Load PROJECT_JOURNAL.md from project
async function loadProjectJournal(projectPath) {
    try {
        const journalPath = projectPath.replace(/[/\\]$/, '') + (projectPath.includes('\\') ? '\\' : '/') + 'PROJECT_JOURNAL.md';
        if (window.electronAPI && window.electronAPI.readFile) {
            const result = await window.electronAPI.readFile(journalPath);
            if (result.success) {
                state.projectJournal = result.content;
                console.log('✅ Loaded PROJECT_JOURNAL.md');
                return true;
            }
        }
        state.projectJournal = null;
        return false;
    } catch (error) {
        console.warn('Could not load PROJECT_JOURNAL.md:', error);
        state.projectJournal = null;
        return false;
    }
}

// Update PROJECT_JOURNAL.md with AI-generated content
async function updateProjectJournal(updates) {
    if (!state.currentProject || !state.currentProject.path) {
        console.warn('No project loaded, cannot update journal');
        return { success: false, error: 'No project loaded' };
    }
    
    try {
        const projectPath = state.currentProject.path;
        const journalPath = projectPath.replace(/[/\\]$/, '') + (projectPath.includes('\\') ? '\\' : '/') + 'PROJECT_JOURNAL.md';
        if (window.electronAPI && window.electronAPI.writeFile) {
            const result = await window.electronAPI.writeFile(journalPath, updates);
            if (result.success) {
                state.projectJournal = updates;
                console.log('✅ Updated PROJECT_JOURNAL.md');
                showToast('Project journal updated!', 'success');
                return { success: true };
            }
            return { success: false, error: result.error };
        }
        return { success: false, error: 'File operations not available' };
    } catch (error) {
        console.error('Error updating PROJECT_JOURNAL.md:', error);
        return { success: false, error: error.message };
    }
}

// Extract code blocks and file paths from AI response for implementation
async function handleCodeImplementation(responseText, originalMessage) {
    if (!state.currentProject || !window.electronAPI) {
        return;
    }
    
    try {
        const implementations = [];
        
        // 1. Extract code blocks with potential file paths
        // Strategy: Find all code blocks first, then look backwards for file hints
        // This handles multiple formats:
        // - "### File: index.html" followed by code block
        // - "File: index.html" followed by code block
        // - "Here's the revised index.html file:" followed by code block
        // - Just code blocks (will prompt user for file path)
        
        const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
        const allCodeBlocks = [];
        let match;
        
        // Find all code blocks with their positions
        while ((match = codeBlockRegex.exec(responseText)) !== null) {
            allCodeBlocks.push({
                index: match.index,
                language: match[1] || 'text',
                code: match[2].trim(),
                fullMatch: match[0]
            });
        }
        
        // For each code block, look backwards for file hints
        allCodeBlocks.forEach(block => {
            if (block.code.length < 10) return; // Skip tiny code blocks
            
            // Look backwards up to 500 chars for file hints
            const beforeBlock = responseText.substring(Math.max(0, block.index - 500), block.index);
            
            // Try multiple patterns to find file hints
            // Pattern 1: "### File: path" or "## File: path" (markdown headers) - capture only the path
            // Pattern 2: "File: path" (simple format)
            // Pattern 3: "Here's the revised/updated path:" or similar
            const fileHintPatterns = [
                /(?:###?\s*)?File:\s*([^\n\s]+(?:\s+[^\n\s]+)*)/i,  // Captures path after "File:"
                /(?:here'?s|here is|revised|updated).*?([^\s:]+\.(?:html|js|css|json|md|ts|tsx|jsx|py|java|cpp|c|h|php|rb|go|rs|swift|kt)):?/i,
                /(?:file|path):\s*([^\s\n]+\.(?:html|js|css|json|md|ts|tsx|jsx|py|java|cpp|c|h|php|rb|go|rs|swift|kt))/i
            ];
            
            let filePathHint = null;
            for (let i = 0; i < fileHintPatterns.length; i++) {
                const pattern = fileHintPatterns[i];
                const fileHintMatch = beforeBlock.match(pattern);
                if (fileHintMatch && fileHintMatch[1]) {
                    filePathHint = fileHintMatch[1].trim();
                    // Clean up the file path - remove any markdown formatting or extra text
                    filePathHint = filePathHint.replace(/^###?\s*/, '').replace(/\s*$/, '');
                    console.log(`🔍 Found file hint: "${filePathHint}" using pattern ${i + 1}`);
                    break;
                }
            }
            
            if (!filePathHint) {
                console.log(`⚠️ No file hint found for code block (${block.language}, ${block.code.length} chars)`);
                console.log(`   Looking in: "${beforeBlock.substring(Math.max(0, beforeBlock.length - 200))}"`);
            }
            
            // Add to implementations
            implementations.push({
                filePath: filePathHint,
                language: block.language,
                code: block.code
            });
            
            console.log(`📝 Found code block: ${filePathHint || 'unnamed'} (${block.language}), ${block.code.length} chars`);
        });
        
        // 2. Detect file updates in natural language responses (e.g., "Here's the updated PROJECT_JOURNAL.md:")
        // Look for patterns like:
        // - "updated PROJECT_JOURNAL.md" or "updated journal"
        // - "Here's the revised journal:"
        // - "Project Journal Update" followed by markdown content
        const lowerResponse = responseText.toLowerCase();
        const projectPath = state.currentProject.path;
        
        // Check for journal updates - look for various phrases that indicate a journal update
        const journalPhrases = [
            'updated journal', 'revised journal', 'fresh journal', 'journal update',
            'project journal update', 'project_journal.md', 'project journal',
            'here\'s the', 'here is the'
        ];
        const hasJournalPhrase = journalPhrases.some(phrase => lowerResponse.includes(phrase));
        const hasJournalContent = responseText.includes('## Project Name:') || 
                                  responseText.includes('# 🚀 Project Journal') ||
                                  responseText.includes('### Project Journal Update') ||
                                  (responseText.includes('##') && lowerResponse.includes('project name'));
        
        if (hasJournalPhrase && hasJournalContent) {
            console.log('📝 Detected journal update phrase and content');
            
            // DON'T extract just a snippet - we need to tell Cursy to provide the FULL journal
            // For now, skip auto-implementation of journal updates to prevent overwriting
            // Instead, we should enhance the "update journal" command to handle this properly
            console.log('⚠️ Journal update detected, but skipping auto-implementation to prevent overwriting full journal');
            console.log('💡 Use "update journal" command instead for safe journal updates');
            
            // Actually, let's check if the response contains a FULL journal (starts with # 🚀 Project Journal)
            // If it's just a snippet (starts with ### Project Journal Update or ## Project Name:), skip it
            if (responseText.includes('# 🚀 Project Journal')) {
                // This looks like a full journal - extract from the heading to the end
                const fullJournalMatch = responseText.match(/(#+\s*[🚀]*\s*Project Journal[\s\S]*)/i);
                if (fullJournalMatch && fullJournalMatch[1].length > 200) {
                    const journalPath = projectPath.replace(/[/\\]$/, '') + (projectPath.includes('\\') ? '\\' : '/') + 'PROJECT_JOURNAL.md';
                    implementations.push({
                        filePath: journalPath,
                        language: 'markdown',
                        code: fullJournalMatch[1].trim()
                    });
                    console.log('✅ Added FULL journal update to implementations, length:', fullJournalMatch[1].length);
                } else {
                    console.log('⚠️ Journal content too short, skipping to prevent overwrite');
                }
            } else {
                console.log('⚠️ Response contains journal snippet, not full journal - skipping auto-implementation');
                console.log('💡 Ask Cursy to "update journal" for a complete, safe journal update');
            }
        }
        
        // 3. Check for other common file updates (package.json, config files, etc.)
        const filePatterns = [
            { pattern: /package\.json/i, defaultPath: 'package.json' },
            { pattern: /project\.json|config\.json/i, defaultPath: 'project.json' },
            { pattern: /readme\.md/i, defaultPath: 'README.md' }
        ];
        
        for (const filePattern of filePatterns) {
            if (filePattern.pattern.test(responseText)) {
                // Look for JSON or markdown content after mentioning the file
                // Escape the pattern source for use in a new RegExp
                const escapedPattern = filePattern.pattern.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regexPattern = '(?:updated|here\'?s|revised).*?' + escapedPattern + '[\\s\\S]*?(?:```(?:json|markdown)?\\n?([\\s\\S]*?)```|(\\{[\\s\\S]*?\\}))';
                const fileMatch = responseText.match(new RegExp(regexPattern, 'i'));
                if (fileMatch && (fileMatch[1] || fileMatch[2])) {
                    const fileContent = (fileMatch[1] || fileMatch[2]).trim();
                    if (fileContent.length > 10) {
                        const filePath = projectPath.replace(/[/\\]$/, '') + (projectPath.includes('\\') ? '\\' : '/') + filePattern.defaultPath;
                        implementations.push({
                            filePath: filePath,
                            language: filePattern.defaultPath.endsWith('.json') ? 'json' : 'markdown',
                            code: fileContent
                        });
                        console.log('📝 Detected ' + filePattern.defaultPath + ' update in response');
                    }
                }
            }
        }
        
        // If we found code blocks, offer to implement them
        if (implementations.length > 0) {
            console.log(`✅ Found ${implementations.length} code block(s) to implement`);
            // Show implementation options
            const chatMessages = document.getElementById('chatMessages');
            if (chatMessages) {
                const implDiv = document.createElement('div');
                implDiv.className = 'chat-message assistant implementation-offer';
                implDiv.style.cssText = 'margin-top: 10px; padding: 15px; background: rgba(0, 255, 136, 0.1); border-left: 3px solid #00ff88; border-radius: 4px;';
                
                let implHtml = '<strong>💻 Code Implementation Detected!</strong><br><br>';
                implHtml += `I found ${implementations.length} code block(s) in my response. Would you like me to implement them?<br><br>`;
                
                implementations.forEach((impl, idx) => {
                    const fileName = impl.filePath || `code-${idx + 1}.${getFileExtension(impl.language)}`;
                    implHtml += `<div style="margin: 8px 0; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">`;
                    implHtml += `<strong>📄 ${fileName}</strong> (${impl.language})<br>`;
                    implHtml += `<button onclick="implementCode(${idx})" style="margin-top: 5px; padding: 5px 15px; background: #00ff88; color: #000; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Implement This</button>`;
                    implHtml += `</div>`;
                });
                
                implHtml += '<br><button onclick="implementAllCode()" style="padding: 8px 20px; background: #00d4ff; color: #000; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">✨ Implement All</button>';
                
                implDiv.innerHTML = implHtml;
                // IMPORTANT: Insert AFTER the last assistant message, not just append
                // Find the last assistant message and insert after it
                const assistantMessages = chatMessages.querySelectorAll('.chat-message.assistant');
                if (assistantMessages.length > 0) {
                    const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];
                    lastAssistantMsg.insertAdjacentElement('afterend', implDiv);
                } else {
                    // Fallback: just append if no assistant messages found
                    chatMessages.appendChild(implDiv);
                }
                chatMessages.scrollTop = chatMessages.scrollHeight;
                
                // Store implementations for button handlers
                window.pendingImplementations = implementations;
                console.log('✅ Implementation offer displayed');
            } else {
                console.warn('⚠️ chatMessages element not found');
            }
        } else {
            console.log('ℹ️ No code blocks found in response (or they were too short)');
        }
    } catch (err) {
        console.error('Error handling code implementation:', err);
    }
}

// Get file extension from language
function getFileExtension(language) {
    const extMap = {
        'html': 'html',
        'javascript': 'js',
        'js': 'js',
        'css': 'css',
        'python': 'py',
        'json': 'json',
        'markdown': 'md',
        'md': 'md',
        'typescript': 'ts',
        'ts': 'ts'
    };
    return extMap[language.toLowerCase()] || 'txt';
}

// Implement a specific code block
window.implementCode = async function(index) {
    if (!window.pendingImplementations || !window.pendingImplementations[index]) {
        return;
    }
    
    const impl = window.pendingImplementations[index];
    const projectPath = state.currentProject.path;
    
    // Determine file path
    let filePath = impl.filePath;
    if (!filePath) {
        // Try to infer from language
        const ext = getFileExtension(impl.language);
        filePath = `code-${index + 1}.${ext}`;
    }
    
    // Make path relative to project
    const isAbsolute = filePath.match(/^[A-Z]:[\\/]/) || filePath.startsWith('/');
    if (!isAbsolute) {
        filePath = projectPath.replace(/[/\\]$/, '') + (projectPath.includes('\\') ? '\\' : '/') + filePath;
    }
    
    try {
        // Check if file exists
        const exists = await window.electronAPI.fileExists(filePath);
        
        if (exists) {
            // Ask for confirmation to overwrite
            const confirm = window.confirm(`File ${filePath.split(/[/\\]/).pop()} already exists. Overwrite?`);
            if (!confirm) return;
        }
        
        // Write the file
        const result = await window.electronAPI.writeFile(filePath, impl.code);
        if (result.success) {
            showToast(`✅ Implemented: ${filePath.split(/[/\\]/).pop()}`, 'success');
            
            // Reload file tree
            await loadProjectFiles(projectPath);
            
            // Open the file
            openFileFromPath(filePath);
            
            // Remove the implementation offer
            const offers = document.querySelectorAll('.implementation-offer');
            offers.forEach(offer => offer.remove());
            
            // Clear pending implementations
            window.pendingImplementations = null;
        } else {
            showToast(`❌ Failed to implement: ${result.error}`, 'error');
        }
    } catch (err) {
        console.error('Error implementing code:', err);
        showToast(`❌ Error: ${err.message}`, 'error');
    }
};

// Implement all code blocks
window.implementAllCode = async function() {
    if (!window.pendingImplementations || window.pendingImplementations.length === 0) {
        return;
    }
    
    for (let i = 0; i < window.pendingImplementations.length; i++) {
        await window.implementCode(i);
        // Small delay between implementations
        await new Promise(resolve => setTimeout(resolve, 300));
    }
};

// Analyze project structure and generate journal update
async function analyzeProjectForJournal() {
    if (!state.currentProject || !state.currentProject.path) {
        return null;
    }
    
    try {
        // Get project files
        const result = await window.electronAPI.readDir(state.currentProject.path);
        if (!result.success) {
            return null;
        }
        
        // Analyze file structure
        const files = result.files.filter(f => f.type === 'file');
        const fileTypes = {};
        const keyFiles = [];
        
        files.forEach(file => {
            const ext = file.path.split('.').pop().toLowerCase();
            fileTypes[ext] = (fileTypes[ext] || 0) + 1;
            
            // Identify key files
            const name = file.path.split(/[/\\]/).pop().toLowerCase();
            if (name === 'package.json' || name === 'readme.md' || name === 'index.html' || 
                name === 'main.js' || name === 'app.js' || name === 'game.js') {
                keyFiles.push(file.path);
            }
        });
        
        return {
            fileCount: files.length,
            fileTypes: fileTypes,
            keyFiles: keyFiles,
            projectName: state.currentProject.config?.projectName || state.currentProject.path.split(/[/\\]/).pop()
        };
    } catch (error) {
        console.error('Error analyzing project:', error);
        return null;
    }
}

// ============================================
// OpenAI Integration (Phase 2)
// ============================================

// Initialize OpenAI client (via IPC)
async function initOpenAI() {
    try {
        console.log('🔧 Checking OpenAI status via IPC...');
        
        // Wait a bit for electronAPI to be available
        if (!window.electronAPI) {
            console.warn('⚠️ electronAPI not yet available, retrying in 500ms...');
            setTimeout(() => initOpenAI(), 500);
            return false;
        }
        
        if (window.electronAPI.openaiCheckStatus) {
            const status = await window.electronAPI.openaiCheckStatus();
            console.log('OpenAI status:', status);
            
            if (status.initialized) {
                state.useOpenAI = true;
                state.openaiClient = true; // Mark as available (actual client is in main process)
                console.log('✅ OpenAI client is available via IPC');
                console.log('✅ AI mode: ENABLED');
                
                // Update welcome message if it exists
                setTimeout(() => {
                    if (typeof updateWelcomeMessage === 'function') {
                        updateWelcomeMessage();
                    }
                }, 100);
                
                return true;
            } else {
                console.warn('⚠️ OpenAI client not initialized in main process');
                state.useOpenAI = false;
                return false;
            }
        } else {
            console.warn('⚠️ OpenAI IPC methods not available, retrying in 500ms...');
            setTimeout(() => initOpenAI(), 500);
            return false;
        }
    } catch (error) {
        console.error('❌ Failed to check OpenAI status:', error);
        console.error('Error details:', error.message);
        // Retry once after error
        setTimeout(() => {
            console.log('🔄 Retrying OpenAI initialization...');
            initOpenAI();
        }, 1000);
        state.useOpenAI = false;
        return false;
    }
}

// Update welcome message to reflect AI status
function updateWelcomeMessage() {
    const welcomeDiv = document.querySelector('.chat-welcome');
    if (welcomeDiv) {
        const aiStatus = state.useOpenAI && state.openaiClient ? '🟢 **AI Enabled**' : '🟡 **Offline Mode**';
        // Update status in welcome message
        const currentHtml = welcomeDiv.innerHTML;
        if (currentHtml.includes('Status:')) {
            welcomeDiv.innerHTML = currentHtml.replace(/Status:.*?<br>/i, `Status: ${aiStatus}<br>`);
        } else if (currentHtml.includes('offline mode')) {
            // Update the old offline mode message
            welcomeDiv.innerHTML = currentHtml.replace(/offline mode/i, aiStatus);
        }
        
        // Ensure chat input is still focusable after update
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.disabled = false;
            chatInput.readOnly = false;
            // Try to focus if it's not already focused
            if (document.activeElement !== chatInput) {
                setTimeout(() => {
                    chatInput.focus();
                }, 100);
            }
        }
    }
}

// Expose test function to console for debugging
window.testOpenAI = async function() {
    console.log('🧪 Testing OpenAI initialization...');
    console.log('Current state:', {
        useOpenAI: state.useOpenAI,
        hasClient: !!state.openaiClient,
        hasApiKey: !!state.openaiApiKey,
        hasIPC: !!(window.electronAPI && window.electronAPI.openaiChat)
    });
    
    if (!state.useOpenAI) {
        console.log('🔄 Attempting to initialize...');
        await initOpenAI();
    } else {
        console.log('✅ OpenAI client is available');
    }
    
    // Test status check
    if (window.electronAPI && window.electronAPI.openaiCheckStatus) {
        const status = await window.electronAPI.openaiCheckStatus();
        console.log('Main process status:', status);
        console.log('📁 Config file should be at:', status.configPath);
        console.log('📁 Config file exists:', status.configExists);
        if (!status.configExists) {
            console.log('💡 To fix: Create a file at the path above with:');
            console.log('   { "apiKey": "your-key-here" }');
        }
    }
    
    return {
        useOpenAI: state.useOpenAI,
        hasClient: !!state.openaiClient,
        hasApiKey: !!state.openaiApiKey,
        hasIPC: !!(window.electronAPI && window.electronAPI.openaiChat)
    };
};

// Call OpenAI API for chat completion (via IPC)
async function callOpenAI(message) {
    if (!state.useOpenAI || !window.electronAPI || !window.electronAPI.openaiChat) {
        return null;
    }

    try {
        // Build conversation context with persona and journal
        let systemPrompt = `You are Cursy, a friendly and enthusiastic AI coding assistant for VIBE IDE. You help beginners learn to code with patience, encouragement, and clear explanations. You use emojis naturally, support markdown formatting, and can suggest GIFs when appropriate. Be conversational, supportive, and educational. Always maintain a positive, helpful tone.

## IMPORTANT: File Modification Capability

**YOU CAN MODIFY FILES DIRECTLY!** When users ask you to make changes to files, you should:

1. **Provide the complete code** in a code block with the file path, like this:
   \`\`\`
   ### File: index.html
   \`\`\`html
   [your code here]
   \`\`\`

2. **The system will automatically detect your code** and show "Implement This" buttons below your response.

3. **Users can click these buttons** to apply your changes directly to their files.

4. **DO NOT say you can't modify files** - you can! Just provide the code and the system handles the rest.

5. **When asked to update a file**, provide the complete updated file content (or the relevant section) in a code block with the file path clearly indicated.

**Example format:**
\`\`\`
### File: index.html
\`\`\`html
<!DOCTYPE html>
<html>
<head>
    <title>My App</title>
</head>
<body>
    <h1>Hello World!</h1>
</body>
</html>
\`\`\`

This will automatically show an "Implement This" button that users can click to apply your changes!`;
        
        // Add Agent Persona if available
        if (state.agentPersona) {
            systemPrompt += `\n\n## Your Persona Guidelines:\n${state.agentPersona}\n\nFollow these persona guidelines to maintain consistency with the project's expectations.`;
        }
        
        // Add Project Journal context if available
        if (state.projectJournal) {
            // Extract key sections from journal for context
            const journalLines = state.projectJournal.split('\n');
            const relevantSections = [];
            let currentSection = null;
            let inSection = false;
            
            for (let i = 0; i < journalLines.length; i++) {
                const line = journalLines[i];
                if (line.startsWith('##')) {
                    if (inSection && currentSection) {
                        relevantSections.push(currentSection);
                    }
                    currentSection = line + '\n';
                    inSection = line.includes('Overview') || line.includes('Status') || line.includes('Next Steps') || line.includes('Structure');
                } else if (inSection && currentSection && line.trim()) {
                    currentSection += line + '\n';
                    if (currentSection.length > 1000) break; // Limit context size
                }
            }
            if (inSection && currentSection) {
                relevantSections.push(currentSection);
            }
            
            if (relevantSections.length > 0) {
                systemPrompt += `\n\n## Project Context (from PROJECT_JOURNAL.md):\n${relevantSections.join('\n')}\n\nUse this context to provide relevant, project-aware assistance.`;
            }
        }
        
        // Build messages array (without system message, it's passed separately)
        const messages = [];

        // Add conversation history (last 10 messages for context)
        const recentHistory = state.conversationContext.slice(-10);
        messages.push(...recentHistory);

        // Add current user message
        messages.push({
            role: 'user',
            content: message
        });

        // Call OpenAI API via IPC
        const response = await window.electronAPI.openaiChat(messages, systemPrompt);
        
        if (!response.success) {
            console.error('OpenAI API error:', response.error);
            
            // Handle specific error types
            if (response.status === 401) {
                console.error('Invalid API key');
                state.useOpenAI = false;
                return null;
            } else if (response.status === 429) {
                console.error('Rate limit exceeded');
                return null;
            } else if (response.status === 500) {
                console.error('OpenAI server error');
                return null;
            }
            
            return null;
        }

        const aiResponse = response.content;

        // Update conversation context
        state.conversationContext.push(
            { role: 'user', content: message },
            { role: 'assistant', content: aiResponse }
        );

        // Keep context manageable (last 20 messages)
        if (state.conversationContext.length > 20) {
            state.conversationContext = state.conversationContext.slice(-20);
        }

        return aiResponse;
    } catch (error) {
        console.error('OpenAI IPC call error:', error);
        return null;
    }
}

// Initialize OpenAI on load
function initializeOpenAIClient() {
    // Try to initialize immediately if DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                initOpenAI();
            }, 500);
        });
    } else {
        // DOM already loaded, initialize now
        setTimeout(() => {
            initOpenAI();
        }, 500);
    }
}

// Initialize immediately
initializeOpenAIClient();

// Mock AI Response System (Offline Mode / Fallback)
function getMockResponse(message) {
    const lowerMessage = message.toLowerCase();
    
    // Greetings
    if (lowerMessage.match(/\b(hi|hello|hey|howdy|greetings)\b/)) {
        return {
            text: "👋 Hey there! I'm Cursy, your AI coding buddy! I'm here to help you learn and code. What would you like to work on today?",
            emoji: "👋",
            gifTerm: "happy coding"
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
        if (lowerMessage.match(/\b(object|obj|property|key|value)\b/)) {
            return {
                text: "📋 **Objects:**\n\nObjects store data as key-value pairs:\n\n```javascript\nconst person = {\n    name: 'Cursy',\n    age: 1,\n    role: 'AI Assistant'\n};\n\n// Access properties\nconsole.log(person.name); // 'Cursy'\n\n// Add properties\nperson.location = 'VIBE IDE';\n\n// Loop through\nfor (let key in person) {\n    console.log(key, person[key]);\n}\n```\n\nObjects are perfect for organizing related data!",
                emoji: "📋"
            };
        }
        if (lowerMessage.match(/\b(class|constructor|instance|new)\b/)) {
            return {
                text: "🏗️ **Classes:**\n\nClasses are blueprints for creating objects:\n\n```javascript\nclass Person {\n    constructor(name, age) {\n        this.name = name;\n        this.age = age;\n    }\n    \n    greet() {\n        return `Hi, I'm ${this.name}!`;\n    }\n}\n\n// Create an instance\nconst person = new Person('Cursy', 1);\nconsole.log(person.greet());\n```\n\nClasses help organize code and create reusable structures!",
                emoji: "🏗️"
            };
        }
        if (lowerMessage.match(/\b(if|else|conditional|condition|switch)\b/)) {
            return {
                text: "🔀 **Conditionals:**\n\nConditionals make decisions:\n\n```javascript\n// If/else\nif (age >= 18) {\n    console.log('Adult');\n} else {\n    console.log('Minor');\n}\n\n// Switch\nswitch (day) {\n    case 'Monday':\n        console.log('Start of week!');\n        break;\n    case 'Friday':\n        console.log('Weekend!');\n        break;\n    default:\n        console.log('Midweek');\n}\n```\n\nConditionals let your code make choices!",
                emoji: "🔀"
            };
        }
        if (lowerMessage.match(/\b(async|await|promise|then|fetch)\b/)) {
            return {
                text: "⏳ **Async/Await:**\n\nHandle asynchronous operations:\n\n```javascript\n// Using async/await\nasync function fetchData() {\n    try {\n        const response = await fetch('https://api.example.com/data');\n        const data = await response.json();\n        console.log(data);\n    } catch (error) {\n        console.error('Error:', error);\n    }\n}\n\n// Using promises\nfetch('https://api.example.com/data')\n    .then(response => response.json())\n    .then(data => console.log(data))\n    .catch(error => console.error('Error:', error));\n```\n\nAsync/await makes asynchronous code easier to read!",
                emoji: "⏳"
            };
        }
        if (lowerMessage.match(/\b(import|export|module|require)\b/)) {
            return {
                text: "📦 **Modules:**\n\nOrganize code into separate files:\n\n```javascript\n// Export from file.js\nexport function greet(name) {\n    return `Hello, ${name}!`;\n}\n\nexport const PI = 3.14159;\n\n// Import in another file\nimport { greet, PI } from './file.js';\n\nconsole.log(greet('Cursy'));\n```\n\nModules help keep your code organized and reusable!",
                emoji: "📦"
            };
        }
        if (lowerMessage.match(/\b(callback|map|filter|reduce)\b/)) {
            return {
                text: "🔄 **Array Methods:**\n\nPowerful array operations:\n\n```javascript\nconst numbers = [1, 2, 3, 4, 5];\n\n// Map - transform each item\nconst doubled = numbers.map(n => n * 2);\n// [2, 4, 6, 8, 10]\n\n// Filter - keep only matching items\nconst evens = numbers.filter(n => n % 2 === 0);\n// [2, 4]\n\n// Reduce - combine all items\nconst sum = numbers.reduce((acc, n) => acc + n, 0);\n// 15\n```\n\nThese methods make working with arrays super powerful!",
                emoji: "🔄"
            };
        }
        if (lowerMessage.match(/\b(dom|element|queryselector|getelementbyid)\b/)) {
            return {
                text: "🌐 **DOM Manipulation:**\n\nInteract with HTML elements:\n\n```javascript\n// Get elements\nconst button = document.getElementById('myButton');\nconst div = document.querySelector('.myDiv');\n\n// Change content\nbutton.textContent = 'Click me!';\ndiv.innerHTML = '<p>New content</p>';\n\n// Add event listeners\nbutton.addEventListener('click', () => {\n    console.log('Button clicked!');\n});\n\n// Change styles\ndiv.style.color = 'blue';\ndiv.classList.add('active');\n```\n\nThe DOM lets you make your web pages interactive!",
                emoji: "🌐"
            };
        }
        return {
            text: "🤔 I'd love to help! Could you be more specific? Try asking:\n\n• \"How do I create a function?\"\n• \"What is a variable?\"\n• \"How do I use a loop?\"\n• \"Explain arrays\"\n• \"What are objects?\"\n• \"How do classes work?\"\n• \"Explain async/await\"\n\nOr just describe what you're trying to build! 😊",
            emoji: "🤔"
        };
    }
    
    // Error/debugging (specific error types handled above, this is general)
    // This section is now handled by the earlier error/debugging section with GIF support
    
    // Code explanation / Thinking
    if (lowerMessage.match(/\b(explain|what does|mean|understand|confused|how|why|think|thinking)\b/)) {
        return {
            text: "📚 I'd be happy to explain! Try:\n\n• Select some code in the editor\n• Click \"Explain this code\"\n• Or paste the code here and ask me to explain it\n\nI can break down functions, loops, variables, and more! 😊",
            emoji: "📚",
            gifTerm: "thinking"
        };
    }
    
    // Project/template questions
    if (lowerMessage.match(/\b(project|template|start|begin|new project|create)\b/)) {
        return {
            text: "🚀 **Starting a Project:**\n\n1. Click **\"New Project\"** on the welcome screen\n2. Choose a template:\n   • **Web App** - HTML/CSS/JavaScript\n   • **Python Beginner** - Simple Python scripts\n   • **Game (Phaser.js)** - Make games!\n   • **Data Analysis** - Python data science\n3. Pick a folder and start coding!\n\nNeed help with a specific template? Just ask! 😊",
            emoji: "🚀"
        };
    }
    
    // Thank you / Success / Celebration
    if (lowerMessage.match(/\b(thanks|thank you|ty|appreciate|cheers|great|awesome|perfect|excellent|well done|good job|success|it works|working|solved|fixed)\b/)) {
        return {
            text: "😊 You're welcome! Happy to help! Keep coding and learning - you're doing great! 💪\n\nNeed anything else? Just ask!",
            emoji: "😊",
            gifTerm: "celebration"
        };
    }
    
    // Error / Frustration
    if (lowerMessage.match(/\b(error|bug|broken|not working|doesn't work|why|fix|debug|stuck|confused|help)\b/)) {
        return {
            text: "🐛 **Debugging Tips:**\n\n1. **Check the console** - Press F12 to see error messages\n2. **Read the error** - It usually tells you what's wrong!\n3. **Check your syntax** - Missing brackets, quotes, or semicolons?\n4. **Use console.log()** - Add `console.log('here!')` to see where your code runs\n5. **Use breakpoints** - Pause execution to inspect variables\n6. **Check variable values** - Log them to see what they actually contain\n\nPaste your error message here and I can help more! 🔍",
            emoji: "🐛",
            gifTerm: "debugging"
        };
    }
    
    // Python-specific questions
    if (lowerMessage.match(/\b(python|py|pip|import|def|print)\b/)) {
        return {
            text: "🐍 **Python Basics:**\n\n```python\n# Variables\nname = 'Cursy'\nage = 1\n\n# Functions\ndef greet(name):\n    return f'Hello, {name}!'\n\n# Lists (like arrays)\nfruits = ['apple', 'banana', 'orange']\n\n# Loops\nfor fruit in fruits:\n    print(fruit)\n\n# Conditionals\nif age >= 18:\n    print('Adult')\nelse:\n    print('Minor')\n```\n\nPython is great for beginners - clean and readable!",
            emoji: "🐍"
        };
    }
    
    // Default response (fallback when OpenAI is unavailable)
    const aiStatus = state.useOpenAI && state.openaiClient ? '🟢 **AI Enabled**' : '🟡 **Offline Mode**';
    const journalHint = state.currentProject ? '\n• **Project Journal** - Type "update journal" to have me analyze and update PROJECT_JOURNAL.md!' : '';
    return {
        text: `🤖 I'm Cursy, your AI coding assistant! Status: ${aiStatus}\n\nI can help with:\n• **Code explanations** - Ask "what does this do?"\n• **Learning basics** - Functions, variables, loops, arrays, objects, classes\n• **Advanced topics** - Async/await, modules, DOM manipulation\n• **Debugging** - Share errors and I'll help!\n• **Getting started** - Project templates and setup${journalHint}\n\nTry asking:\n• "How do I create a function?"\n• "What are objects?"\n• "Explain async/await"\n• "How do classes work?"\n• "Update journal" (if you have a project open)\n\n${state.useOpenAI && state.openaiClient ? '*AI chat is active! Ask me anything!* 🚀' : '*Note: Full AI chat will be available when API credits are configured!* 🚀'}`,
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
            
            // Populate conversation context for OpenAI from chat history
            state.conversationContext = [];
            state.chatHistory.forEach(msg => {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    state.conversationContext.push({
                        role: msg.role,
                        content: msg.content
                    });
                }
            });
            
            // Keep context manageable (last 20 messages)
            if (state.conversationContext.length > 20) {
                state.conversationContext = state.conversationContext.slice(-20);
            }
        }
    } catch (e) {
        console.warn('Failed to load chat history:', e);
        state.chatHistory = [];
        state.conversationContext = [];
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
        if (chatInput.contentEditable === 'true') {
            chatInput.innerHTML = message;
        } else {
            chatInput.value = message;
        }
        chatInput.focus();
    }
};

function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    const emoticonConvert = document.getElementById('emoticonConvert');
    const chatGifCode = document.getElementById('chatGifCode');
    
    if (!chatInput || !chatMessages) return;
    
    // Get content from WYSIWYG input
    let messageHtml = '';
    let messageMarkdown = '';
    
    if (chatInput.contentEditable === 'true') {
        // Get HTML content
        messageHtml = chatInput.innerHTML.trim();
        if (!messageHtml) return;
        
        // Convert HTML to markdown for sending
        messageMarkdown = htmlToMarkdownForChat(messageHtml);
        
        // Get GIF code if any (stored separately)
        const gifCode = chatGifCode ? chatGifCode.value : '';
        if (gifCode) {
            messageMarkdown += (messageMarkdown ? '\n\n' : '') + gifCode;
        }
        
        // Convert emoticons in markdown if enabled
        if (emoticonConvert && emoticonConvert.checked) {
            messageMarkdown = convertEmoticons(messageMarkdown);
        }
    } else {
        // Fallback for textarea
        messageMarkdown = chatInput.value.trim();
        if (!messageMarkdown) return;
        
        if (emoticonConvert && emoticonConvert.checked) {
            messageMarkdown = convertEmoticons(messageMarkdown);
        }
        
        messageHtml = parseSimpleMarkdown(messageMarkdown);
    }
    
    // Display user message as styled HTML (no markdown visible)
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message user';
    messageDiv.innerHTML = messageHtml;
    chatMessages.appendChild(messageDiv);
    
    // Add to history (with markdown for AI)
    addMessageToHistory('user', messageMarkdown);
    
    // Clear input
    if (chatInput.contentEditable === 'true') {
        chatInput.innerHTML = '';
    } else {
        chatInput.value = '';
    }
    if (chatGifCode) chatGifCode.value = '';
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Update Cursy to thinking state
    updateCursyState('thinking', 'Thinking...');
    
    // Show typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message assistant typing';
    typingDiv.innerHTML = '<p>🤖 Cursy is typing...</p>';
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Update to typing state after a short delay
    setTimeout(() => {
        updateCursyState('typing', 'Typing response...');
    }, 300);
    
    // Check for special commands (use messageMarkdown)
    const messageLower = messageMarkdown.toLowerCase().trim();
    if (messageLower === 'update journal' || messageLower === 'update project journal' || messageLower.startsWith('cursy, update journal')) {
        // Trigger journal update
        typingDiv.innerHTML = '<p>🤖 Cursy is analyzing the project and updating the journal...</p>';
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        (async () => {
            try {
                const analysis = await analyzeProjectForJournal();
                
                // Check all requirements
                if (!analysis) {
                    throw new Error('Could not analyze project structure');
                }
                if (!state.currentProject) {
                    throw new Error('No project loaded. Please open a project first.');
                }
                if (!window.electronAPI || !window.electronAPI.openaiChat) {
                    throw new Error('OpenAI IPC not available. Please restart the app.');
                }
                if (!state.useOpenAI) {
                    throw new Error('OpenAI not initialized. Check console for details.');
                }
                
                // All checks passed, proceed
                if (analysis && state.useOpenAI && window.electronAPI && window.electronAPI.openaiChat) {
                    // Use AI to generate journal update with a very specific prompt
                    const journalPrompt = `You are updating a PROJECT_JOURNAL.md file. IMPORTANT: Return ONLY the complete markdown content of the updated journal file. Do NOT include any commentary, explanations, or text outside the markdown. Start directly with the markdown content.

Based on the following project analysis, update the PROJECT_JOURNAL.md file. Focus on:
1. Current project structure and key files
2. Recent work (if any changes detected)
3. Next steps and priorities

Project Analysis:
- Project Name: ${analysis.projectName}
- Total Files: ${analysis.fileCount}
- File Types: ${JSON.stringify(analysis.fileTypes)}
- Key Files: ${analysis.keyFiles.map(f => f.split(/[/\\]/).pop()).join(', ')}

${state.projectJournal ? `Current Journal Content (first 2000 chars):\n${state.projectJournal.substring(0, 2000)}...` : 'No existing journal found - create a new one with the template structure.'}

CRITICAL: Return ONLY the complete updated PROJECT_JOURNAL.md markdown content. No explanations, no "here's the updated journal", just the raw markdown starting with "# 🚀 Project Journal"`;

                    // Call OpenAI directly via IPC (bypass conversation context for this)
                    try {
                        const systemPrompt = `You are Cursy, an AI assistant. When asked to update a project journal, return ONLY the complete markdown file content with no additional commentary. Start directly with "# 🚀 Project Journal" or "# Project Journal".`;
                        const messages = [{ role: 'user', content: journalPrompt }];
                        
                        console.log('📤 Sending journal update request to OpenAI...');
                        const response = await window.electronAPI.openaiChat(messages, systemPrompt, 4000); // Request 4000 tokens for journal
                        
                        console.log('📥 OpenAI response received:', {
                            success: response.success,
                            hasContent: !!response.content,
                            contentLength: response.content?.length || 0
                        });
                        
                        if (response.success && response.content) {
                            let journalContent = response.content.trim();
                            
                            console.log('📝 Raw response length:', journalContent.length);
                            console.log('📝 Raw response first 500 chars:', journalContent.substring(0, 500));
                            
                            // Remove any leading/trailing commentary
                            // Look for markdown code blocks first
                            if (journalContent.includes('```markdown')) {
                                const match = journalContent.match(/```markdown\s*\n([\s\S]*?)\n```/);
                                if (match) {
                                    journalContent = match[1].trim();
                                    console.log('📝 Extracted from markdown code block, new length:', journalContent.length);
                                }
                            } else if (journalContent.includes('```')) {
                                const match = journalContent.match(/```[a-z]*\s*\n([\s\S]*?)\n```/);
                                if (match) {
                                    journalContent = match[1].trim();
                                    console.log('📝 Extracted from code block, new length:', journalContent.length);
                                }
                            }
                            
                            // Remove any text before the first # heading
                            const firstHeading = journalContent.indexOf('#');
                            if (firstHeading > 0 && firstHeading < 200) {
                                journalContent = journalContent.substring(firstHeading);
                                console.log('📝 Trimmed before first heading, new length:', journalContent.length);
                            }
                            
                            // Ensure it starts with the journal header
                            if (!journalContent.startsWith('# 🚀 Project Journal') && !journalContent.startsWith('# Project Journal')) {
                                // Try to find where the actual journal starts
                                const journalStart = journalContent.search(/#\s*[🚀]*\s*Project Journal/i);
                                if (journalStart > 0 && journalStart < 500) {
                                    journalContent = journalContent.substring(journalStart);
                                    console.log('📝 Found journal start at position', journalStart, 'new length:', journalContent.length);
                                } else {
                                    // If we can't find the header, prepend it
                                    console.warn('⚠️ Journal header not found, prepending it');
                                    journalContent = '# 🚀 Project Journal\n\n' + journalContent;
                                }
                            }
                            
                            // Only proceed if we have substantial content
                            if (journalContent.length > 100) {
                                console.log('✅ Journal content ready to write, length:', journalContent.length);
                                console.log('📝 First 300 chars:', journalContent.substring(0, 300));
                                
                                const result = await updateProjectJournal(journalContent);
                                console.log('📝 Write result:', result);
                                
                                if (result.success) {
                                    // Reload the journal to verify it was written
                                    await loadProjectJournal(state.currentProject.path);
                                    
                                    // Verify the content was actually written
                                    if (state.projectJournal && state.projectJournal.length > 100) {
                                        console.log('✅ Journal successfully written and verified, length:', state.projectJournal.length);
                                        
                                        // If PROJECT_JOURNAL.md is currently open in a tab, refresh it
                                        const journalPath = state.currentProject.path.replace(/[/\\]$/, '') + (state.currentProject.path.includes('\\') ? '\\' : '/') + 'PROJECT_JOURNAL.md';
                                        const journalTab = state.openTabs.find(t => t.path === journalPath || t.path.replace(/\\/g, '/') === journalPath.replace(/\\/g, '/'));
                                        if (journalTab) {
                                            console.log('📝 PROJECT_JOURNAL.md is open in a tab, refreshing from disk...');
                                            
                                            // Re-read from disk to ensure we have the actual file content
                                            const readResult = await window.electronAPI.readFile(journalPath);
                                            if (readResult.success) {
                                                const freshContent = readResult.content;
                                                console.log('📝 Fresh content from disk, length:', freshContent.length);
                                                
                                                // Update the tab content with fresh content from disk
                                                journalTab.content = freshContent;
                                                journalTab.isDirty = false;
                                                
                                                // Force editor refresh
                                                const wasActive = journalTab.id === state.activeTab;
                                                if (wasActive) {
                                                    // Update tab content first
                                                    journalTab.content = freshContent;
                                                    
                                                    // If editor is ready, update it directly
                                                    if (state.monacoEditor) {
                                                        state.monacoEditor.setValue(freshContent);
                                                        console.log('✅ Editor content refreshed with fresh content from disk');
                                                    } else {
                                                        // Editor not ready, try again after a delay
                                                        setTimeout(() => {
                                                            if (state.monacoEditor && journalTab.id === state.activeTab) {
                                                                state.monacoEditor.setValue(freshContent);
                                                                console.log('✅ Editor content refreshed (delayed)');
                                                            }
                                                        }, 200);
                                                    }
                                                    
                                                    // Also force a tab switch to trigger reload
                                                    const otherTab = state.openTabs.find(t => t.id !== journalTab.id);
                                                    if (otherTab) {
                                                        // Quick switch away and back to force reload
                                                        const originalTab = journalTab.id;
                                                        switchToTab(otherTab.id);
                                                        setTimeout(() => {
                                                            switchToTab(originalTab);
                                                            // Ensure content is set after switch
                                                            if (state.monacoEditor) {
                                                                state.monacoEditor.setValue(freshContent);
                                                                console.log('✅ Editor content refreshed (via tab switch)');
                                                            }
                                                        }, 100);
                                                    }
                                                }
                                                
                                                // Re-render tabs to update the dirty indicator
                                                renderTabs();
                                            } else {
                                                console.warn('⚠️ Could not re-read journal file for refresh:', readResult.error);
                                            }
                                        } else {
                                            console.log('📝 PROJECT_JOURNAL.md is not currently open in a tab');
                                        }
                                        
                                        typingDiv.remove();
                                        const responseDiv = document.createElement('div');
                                        responseDiv.className = 'chat-message assistant';
                                        responseDiv.innerHTML = parseSimpleMarkdown('✅ **Project journal updated!**\n\nI\'ve analyzed your project structure and updated the PROJECT_JOURNAL.md file with current information. Check it out! 📝');
                                        chatMessages.appendChild(responseDiv);
                                        addMessageToHistory('assistant', 'Project journal updated successfully!');
                                        chatMessages.scrollTop = chatMessages.scrollHeight;
                                        updateCursyState('celebrating', 'Journal updated!');
                                        setTimeout(() => updateCursyState('idle', 'Ready to help!'), 2000);
                                        return;
                                    } else {
                                        console.error('❌ Journal was written but reload failed or content is empty');
                                        console.error('Reloaded journal length:', state.projectJournal?.length || 0);
                                        throw new Error('Journal update verification failed');
                                    }
                                } else {
                                    console.error('❌ Failed to update journal file:', result.error);
                                    throw new Error(result.error || 'Failed to write journal file');
                                }
                            } else {
                                console.warn('⚠️ Extracted journal content too short:', journalContent.length);
                                console.warn('⚠️ Content preview:', journalContent.substring(0, 500));
                                throw new Error('Extracted journal content is too short or invalid');
                            }
                        } else {
                            console.error('❌ OpenAI response failed or empty:', response);
                            throw new Error(response.error || 'OpenAI response was empty');
                        }
                    } catch (err) {
                        console.error('Error calling OpenAI for journal update:', err);
                        throw err;
                    }
                } else {
                    throw new Error('AI not available or project not loaded');
                }
                
                // Fallback response (shouldn't reach here if everything worked)
                typingDiv.remove();
                const responseDiv = document.createElement('div');
                responseDiv.className = 'chat-message assistant';
                responseDiv.innerHTML = parseSimpleMarkdown('I can help update the project journal! However, I need AI access to analyze and update it properly. The journal file is located at `PROJECT_JOURNAL.md` in your project root. You can also manually update it, or ask me specific questions about what to add! 📝');
                chatMessages.appendChild(responseDiv);
                addMessageToHistory('assistant', responseDiv.textContent);
                chatMessages.scrollTop = chatMessages.scrollHeight;
                updateCursyState('idle', 'Ready to help!');
            } catch (err) {
                console.error('Journal update error:', err);
                console.error('Error stack:', err.stack);
                typingDiv.remove();
                const responseDiv = document.createElement('div');
                responseDiv.className = 'chat-message assistant';
                const errorMsg = err.message || 'Unknown error';
                responseDiv.innerHTML = parseSimpleMarkdown(`❌ Sorry, I encountered an error while updating the journal: ${errorMsg}\n\nYou can manually edit \`PROJECT_JOURNAL.md\` in your project root, or check the console for more details!`);
                chatMessages.appendChild(responseDiv);
                addMessageToHistory('assistant', `Error updating journal: ${errorMsg}`);
                chatMessages.scrollTop = chatMessages.scrollHeight;
                updateCursyState('error', 'Update failed');
                setTimeout(() => updateCursyState('idle', 'Ready to help!'), 2000);
            }
        })();
        return;
    }
    
    // Check if this is an implementation request (using messageMarkdown)
    const isImplementationRequest = messageMarkdown.toLowerCase().match(/\b(implement|create|write|add to|update|modify|change|edit|build|make|generate)\b/) && 
                                    (messageMarkdown.toLowerCase().includes('file') || messageMarkdown.toLowerCase().includes('code') || messageMarkdown.toLowerCase().includes('script') || 
                                     messageMarkdown.toLowerCase().includes('html') || messageMarkdown.toLowerCase().includes('css') || messageMarkdown.toLowerCase().includes('js'));
    
    // Try OpenAI first, fall back to mock if unavailable
    (async () => {
        let responseText = null;
        let gifTerm = null;
        
        // Try OpenAI API
        if (state.useOpenAI && state.openaiClient) {
            try {
                // Enhance prompt for implementation requests
                let enhancedMessage = messageMarkdown;
                if (isImplementationRequest && state.currentProject) {
                    enhancedMessage = `${messageMarkdown}\n\nIMPORTANT: If you provide code, please format it clearly with file paths. For example: "File: index.html" followed by the code block. I will implement the changes automatically.`;
                }
                
                responseText = await callOpenAI(enhancedMessage); // Use markdown version (includes GIF code)
                if (responseText) {
                    // Check if response suggests a GIF (simple heuristic)
                    const lowerResponseText = responseText.toLowerCase();
                    if (lowerResponseText.includes('celebrat') || lowerResponseText.includes('🎉') || lowerResponseText.includes('success')) {
                        gifTerm = 'celebration';
                    } else if (lowerResponseText.includes('think') || lowerResponseText.includes('🤔')) {
                        gifTerm = 'thinking';
                    } else if (lowerResponseText.includes('error') || lowerResponseText.includes('bug') || lowerResponseText.includes('🐛')) {
                        gifTerm = 'debugging';
                    }
                    
                }
            } catch (err) {
                console.error('OpenAI call failed:', err);
                responseText = null;
            }
        }
        
        // Fall back to mock response if OpenAI failed or unavailable
        if (!responseText) {
            const mockResponse = getMockResponse(messageMarkdown);
            responseText = mockResponse.text;
            gifTerm = mockResponse.gifTerm;
        }
        
        // Remove typing indicator
        typingDiv.remove();
        
        // Create assistant response
        const responseDiv = document.createElement('div');
        responseDiv.className = 'chat-message assistant';
        
        // Get GIF if needed
        if (gifTerm) {
            try {
                const gifUrl = await getRandomGif(gifTerm);
                if (gifUrl) {
                    responseText += `\n\n[GIF:${gifUrl}]`;
                }
            } catch (err) {
                console.warn('Failed to get GIF:', err);
            }
        }
        
        responseDiv.innerHTML = parseSimpleMarkdown(responseText);
        chatMessages.appendChild(responseDiv);
        
        // Add to history
        addMessageToHistory('assistant', responseText);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // Check if response contains code blocks OR file updates that should be implemented
        // This includes: code blocks, journal updates, config file updates, etc.
        // IMPORTANT: Do this AFTER displaying the response so buttons appear below it
        if (state.currentProject && responseText) {
            const hasCodeBlocks = responseText.includes('```');
            const hasFileUpdates = responseText.toLowerCase().includes('updated journal') || 
                                  responseText.toLowerCase().includes('revised journal') ||
                                  responseText.toLowerCase().includes('project journal update') ||
                                  responseText.includes('## Project Name:') ||
                                  responseText.includes('# 🚀 Project Journal');
            
            if (hasCodeBlocks || hasFileUpdates) {
                console.log('💻 Detected code blocks or file updates in response, checking for implementation...');
                await handleCodeImplementation(responseText, message);
                // Scroll again after implementation offer is added
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        }
        
        // Update Cursy state based on response
        if (responseText.toLowerCase().includes('error') || responseText.toLowerCase().includes('bug')) {
            updateCursyState('error', 'Error detected');
            setTimeout(() => {
                updateCursyState('idle', 'Ready to help!');
            }, 2000);
        } else if (responseText.toLowerCase().includes('celebrat') || responseText.toLowerCase().includes('success')) {
            updateCursyState('celebrating', 'Success!');
            setTimeout(() => {
                updateCursyState('idle', 'Ready to help!');
            }, 2000);
        } else {
            // Return to idle state
            setTimeout(() => {
                updateCursyState('idle', 'Ready to help!');
            }, 500);
        }
    })();
}

