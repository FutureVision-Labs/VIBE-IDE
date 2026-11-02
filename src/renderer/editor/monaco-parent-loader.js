/**
 * Lazy-load Monaco into the *parent* document (genre JSON modal only).
 * Main file editor uses editor/monaco-frame.html — do not mount Monaco in #monacoEditor here.
 */
(function (global) {
    'use strict';

    /** @type {Promise<void> | null} */
    let loadPromise = null;

    function ensureMonacoParentLibrary() {
        if (typeof monaco !== 'undefined' && monaco.editor) {
            return Promise.resolve();
        }
        if (loadPromise) return loadPromise;

        loadPromise = new Promise((resolve, reject) => {
            try {
                const req = global.nodeRequire || (typeof require !== 'undefined' ? require : null);
                if (!req) {
                    reject(new Error('Node require unavailable for Monaco parent loader'));
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
                        if (typeof require === 'undefined' || !require.config) {
                            reject(new Error('require.config not available after Monaco loader'));
                            return;
                        }
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

        loadPromise.catch(() => {
            loadPromise = null;
        });

        return loadPromise;
    }

    global.ensureMonacoParentLibrary = ensureMonacoParentLibrary;
})(window);
