/**
 * VIBE IDE — Monaco host: iframe + postMessage only (never hold cross-frame IEditor).
 */
(function (global) {
    'use strict';

    const CONTAINER_ID = 'monacoEditor';
    const FRAME_SRC = 'editor/monaco-frame.html';
    const CHANNEL_CMD = 'vibe-monaco-cmd';
    const CHANNEL_EVT = 'vibe-monaco-event';

    class MonacoEditorProxy {
        constructor(host) {
            this._host = host;
            this._value = '';
            this._contentListeners = [];
            this._selection = {
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            };
            this._position = { lineNumber: 1, column: 1 };
            this._selectedText = '';
            this._lineContent = '';
            this.__vibeIsProxy = true;
        }

        getValue() {
            return this._value;
        }

        setValue(value) {
            this._value = value ?? '';
            this._host._sendCmd('set-document', {
                value: this._value,
                language: this._host._lastLanguage,
                theme: this._host._lastTheme,
            });
        }

        focus() {
            this._host._sendCmd('focus', {});
            this._host._iframe?.focus();
        }

        onDidChangeModelContent(callback) {
            this._contentListeners.push(callback);
            return {
                dispose: () => {
                    this._contentListeners = this._contentListeners.filter((c) => c !== callback);
                },
            };
        }

        getSelection() {
            return this._selection;
        }

        getPosition() {
            return this._position;
        }

        getModel() {
            const self = this;
            return {
                getValueInRange() {
                    return self._selectedText;
                },
                getLineContent() {
                    return self._lineContent;
                },
            };
        }

        _setValueSilent(value) {
            this._value = value ?? '';
        }

        _applyContent(value) {
            this._value = value ?? '';
            this._contentListeners.forEach((fn) => {
                try {
                    fn();
                } catch (_) {
                    /* ignore */
                }
            });
        }

        _applySelection(payload) {
            if (payload.selection) this._selection = payload.selection;
            if (payload.position) this._position = payload.position;
            if (payload.selectedText != null) this._selectedText = payload.selectedText;
            if (payload.lineContent != null) this._lineContent = payload.lineContent;
        }
    }

    class VibeMonacoHost {
        constructor() {
            this._iframe = null;
            this._frameReady = null;
            this._proxy = new MonacoEditorProxy(this);
            this._uiBound = false;
            this._messageBound = false;
            this._lastLanguage = 'plaintext';
            this._lastTheme = 'dark';
            this._createWaiters = [];
        }

        getEditor() {
            return this._proxy;
        }

        _container() {
            return document.getElementById(CONTAINER_ID);
        }

        _bindMessageRouter() {
            if (this._messageBound) return;
            this._messageBound = true;
            global.addEventListener('message', (e) => {
                const data = e.data;
                if (!data || data.channel !== CHANNEL_EVT) return;
                if (this._iframe && e.source !== this._iframe.contentWindow) return;

                switch (data.event) {
                    case 'library-ready':
                        break;
                    case 'document':
                    case 'content':
                        if (data.value != null) this._proxy._applyContent(data.value);
                        this._flushCreateWaiters();
                        break;
                    case 'selection':
                        this._proxy._applySelection(data);
                        break;
                    case 'error':
                        console.error('[monaco-frame]', data.message);
                        break;
                    default:
                        break;
                }
            });
        }

        _flushCreateWaiters() {
            while (this._createWaiters.length) {
                this._createWaiters.shift().resolve(this._proxy);
            }
        }

        _sendCmd(cmd, payload) {
            if (!this._iframe?.contentWindow) return;
            this._iframe.contentWindow.postMessage(
                { channel: CHANNEL_CMD, cmd, ...payload },
                global.location.origin
            );
        }

        _ensureFrame() {
            const container = this._container();
            if (!container) return Promise.reject(new Error('Monaco container missing'));

            this._bindMessageRouter();

            if (this._iframe && container.contains(this._iframe)) {
                return this._waitFrameLoad();
            }

            container.replaceChildren();
            const iframe = document.createElement('iframe');
            iframe.className = 'vibe-monaco-frame';
            iframe.setAttribute('title', 'Code editor');
            iframe.setAttribute('tabindex', '-1');
            iframe.src = FRAME_SRC;
            container.appendChild(iframe);
            this._iframe = iframe;
            this._frameReady = null;

            const viewport = document.getElementById('editorPaneViewport');
            if (viewport && !viewport.dataset.vibeWheelBound) {
                viewport.dataset.vibeWheelBound = '1';
                viewport.addEventListener(
                    'wheel',
                    (ev) => ev.stopPropagation(),
                    { capture: true, passive: true }
                );
            }

            return this._waitFrameLoad();
        }

        _waitFrameLoad() {
            if (this._frameReady) return this._frameReady;
            this._frameReady = new Promise((resolve, reject) => {
                const iframe = this._iframe;
                if (!iframe) {
                    reject(new Error('Monaco iframe missing'));
                    return;
                }
                const timeout = setTimeout(() => {
                    reject(new Error('Monaco frame load timeout'));
                }, 30000);
                iframe.addEventListener(
                    'load',
                    () => {
                        clearTimeout(timeout);
                        resolve();
                    },
                    { once: true }
                );
            });
            return this._frameReady;
        }

        nudgeFrameLayout() {
            /* automaticLayout inside frame */
        }

        setTheme(appTheme) {
            this._lastTheme = appTheme;
            this._sendCmd('set-theme', { theme: appTheme });
        }

        async createEditor(value, language, appTheme) {
            this._lastLanguage = language || 'plaintext';
            this._lastTheme = appTheme || 'dark';

            try {
                await this._ensureFrame();
            } catch (err) {
                console.error('[monaco-host]', err);
                this.showLoadError(String(err.message || err));
                return null;
            }

            this._proxy._setValueSilent(value ?? '');

            return new Promise((resolve) => {
                const timer = setTimeout(() => {
                    console.warn('[monaco-host] create ack timeout — using proxy anyway');
                    resolve(this._proxy);
                }, 8000);
                this._createWaiters.push({
                    resolve: (p) => {
                        clearTimeout(timer);
                        resolve(p);
                    },
                });
                this._sendCmd('create', {
                    value: value ?? '',
                    language: this._lastLanguage,
                    theme: this._lastTheme,
                });
            });
        }

        setDocument(value, language) {
            if (language) this._lastLanguage = language;
            const next = value ?? '';
            this._proxy._setValueSilent(next);
            this._sendCmd('set-document', {
                value: next,
                language: this._lastLanguage,
                theme: this._lastTheme,
            });
        }

        attachUiHandlers() {
            if (this._uiBound) return;
            this._uiBound = true;
            const editorArea = document.querySelector('.editor-area');
            if (!editorArea) return;
            editorArea.addEventListener('mousedown', () => {
                const el = this._container();
                if (!el?.classList.contains('editor-pane-active')) return;
                this._proxy.focus();
            });
        }

        showLoadError(message) {
            const container = this._container();
            if (!container) return;
            this._iframe = null;
            this._frameReady = null;
            container.innerHTML =
                '<div style="padding: 20px; color: #f48771; font-family: sans-serif;">' +
                message +
                '</div>';
        }
    }

    global.vibeMonacoHost = new VibeMonacoHost();
})(window);
