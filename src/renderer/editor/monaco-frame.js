/**
 * Monaco in isolated document. Parent talks via postMessage only — no cross-frame editor handles.
 */
(function () {
    'use strict';

    const CHANNEL_CMD = 'vibe-monaco-cmd';
    const CHANNEL_EVT = 'vibe-monaco-event';

    /** @type {import('monaco-editor').editor.IStandaloneCodeEditor | null} */
    let editor = null;
    let libraryReady = false;
    const readyWaiters = [];

    function parentOrigin() {
        try {
            if (document.referrer) {
                return new URL(document.referrer).origin;
            }
        } catch (_) {
            /* ignore */
        }
        return window.location.origin;
    }

    function post(event, payload) {
        if (window.parent === window) return;
        window.parent.postMessage(
            { channel: CHANNEL_EVT, event, ...payload },
            parentOrigin()
        );
    }

    function notifyLibraryReady(err) {
        libraryReady = !err;
        while (readyWaiters.length) {
            const w = readyWaiters.shift();
            if (err) w.reject(err);
            else w.resolve();
        }
        if (!err) post('library-ready', {});
    }

    function whenLibraryReady() {
        if (libraryReady) return Promise.resolve();
        return new Promise((resolve, reject) => readyWaiters.push({ resolve, reject }));
    }

    function applyFrameThemeClass(appTheme) {
        const light = appTheme === 'light';
        document.documentElement.classList.toggle('vibe-monaco-light', light);
        document.documentElement.classList.toggle('vibe-monaco-dark', !light);
    }

    function editorOptions(language, appTheme) {
        applyFrameThemeClass(appTheme);
        const wrap =
            language === 'css' || language === 'html' || language === 'javascript' ? 'off' : 'on';
        return {
            language: language || 'plaintext',
            theme: appTheme === 'dark' ? 'vs-dark' : 'vs',
            fontSize: 14,
            fontFamily: 'Consolas, "Courier New", monospace',
            lineNumbers: 'on',
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: wrap,
            formatOnPaste: true,
            formatOnType: true,
            tabSize: 2,
            // Shadow DOM context menus get :host { all: initial } — theme vars never apply (transparent menu).
            useShadowDOM: false,
            // Keep overflow widgets in iframe; file:// shell fixed scroll — no need to hoist to parent.
            fixedOverflowWidgets: false,
            smoothScrolling: false,
            disableLayerHinting: false,
            stickyScroll: { enabled: false },
        };
    }

    function pushSelection() {
        if (!editor) return;
        const model = editor.getModel();
        const selection = editor.getSelection();
        const position = editor.getPosition();
        if (!model || !selection || !position) return;
        post('selection', {
            selection,
            position,
            selectedText: model.getValueInRange(selection),
            lineContent: model.getLineContent(position.lineNumber),
        });
    }

    function bindEditorEvents() {
        if (!editor) return;
        editor.onDidChangeModelContent(() => {
            post('content', { value: editor.getModel()?.getValue() ?? '' });
        });
        editor.onDidChangeCursorSelection(() => pushSelection());
        pushSelection();
    }

    function ensureEditor(value, language, appTheme) {
        const root = document.getElementById('root');
        if (!root || typeof monaco === 'undefined') return false;

        if (editor) {
            const next = value ?? '';
            if (editor.getModel()?.getValue() !== next) {
                editor.setValue(next);
            }
            if (language) {
                monaco.editor.setModelLanguage(editor.getModel(), language);
            }
            monaco.editor.setTheme(appTheme === 'dark' ? 'vs-dark' : 'vs');
            return true;
        }

        editor = monaco.editor.create(root, {
            value: value ?? '',
            ...editorOptions(language, appTheme),
        });
        bindEditorEvents();
        return true;
    }

    function loadMonacoLibrary() {
        return new Promise((resolve, reject) => {
            try {
                if (typeof monaco !== 'undefined' && monaco.editor) {
                    resolve();
                    return;
                }
                const req = typeof require !== 'undefined' ? require : null;
                if (!req) {
                    reject(new Error('require missing in Monaco frame (nodeIntegrationInSubFrames)'));
                    return;
                }
                const fs = req('fs');
                const path = req('path');
                const appPath = process.cwd();
                const loaderPath = path.join(
                    appPath,
                    'node_modules',
                    'monaco-editor',
                    'min',
                    'vs',
                    'loader.js'
                );
                if (!fs.existsSync(loaderPath)) {
                    reject(new Error('Monaco loader not found: ' + loaderPath));
                    return;
                }
                const script = document.createElement('script');
                script.textContent = fs.readFileSync(loaderPath, 'utf-8');
                document.head.appendChild(script);
                setTimeout(() => {
                    try {
                        const vs = path
                            .join(appPath, 'node_modules', 'monaco-editor', 'min', 'vs')
                            .replace(/\\/g, '/');
                        require.config({ paths: { vs } });
                        require(['vs/editor/editor.main'], () => resolve(), reject);
                    } catch (e) {
                        reject(e);
                    }
                }, 50);
            } catch (e) {
                reject(e);
            }
        });
    }

    window.addEventListener('message', (e) => {
        const data = e.data;
        if (!data || data.channel !== CHANNEL_CMD) return;
        if (e.origin !== parentOrigin() && e.origin !== window.location.origin) return;

        whenLibraryReady()
            .then(() => {
                switch (data.cmd) {
                    case 'create':
                    case 'set-document': {
                        const ok = ensureEditor(data.value, data.language, data.theme || 'dark');
                        if (ok) {
                            post('document', {
                                value: editor.getModel()?.getValue() ?? '',
                            });
                        } else {
                            post('error', { message: 'Monaco editor not created' });
                        }
                        break;
                    }
                    case 'set-theme':
                        applyFrameThemeClass(data.theme === 'light' ? 'light' : 'dark');
                        if (typeof monaco !== 'undefined') {
                            monaco.editor.setTheme(data.theme === 'dark' ? 'vs-dark' : 'vs');
                        }
                        break;
                    case 'focus':
                        editor?.focus();
                        break;
                    default:
                        break;
                }
            })
            .catch((err) => post('error', { message: String(err.message || err) }));
    });

    loadMonacoLibrary()
        .then(() => {
            notifyLibraryReady(null);
            console.log('[monaco-frame] library ready (postMessage bridge)');
        })
        .catch((err) => {
            console.error('[monaco-frame]', err);
            notifyLibraryReady(err);
        });
})();
