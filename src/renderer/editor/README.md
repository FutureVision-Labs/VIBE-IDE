# VIBE IDE Monaco host (alpha)

**Isolated Monaco frame** — real `IStandaloneCodeEditor` lives in `monaco-frame.html` (iframe). Parent `styles.css` cannot touch view lines (smoke-parity scroll).

| File | Role |
|------|------|
| `monaco-host.js` | iframe mount, layout, theme, setDocument |
| `monaco-frame.html` + `monaco-frame.js` | Monaco + `automaticLayout` (like smoke) |
| `editor-host.css` | viewport + iframe sizing |

Genre JSON modal still loads Monaco from `index.html` (AMD `editor.main`) in the parent document.

## If scroll/repaint is wrong (lines vanish while scrolling)

1. **Isolate:** `npm run monaco:smoke` from repo root. Scroll the long CSS sample.
   - Breaks in smoke too → Electron/Chromium/Monaco on this machine (try `VIBE_DISABLE_GPU=1` or Electron bump).
   - Fine in smoke only → VIBE shell: panes live in `#editorPaneViewport` with **visibility stack** (not `display:none` on Monaco). Layout sizes from viewport `clientWidth`/`clientHeight`.

2. **GPU test:**

```bash
set VIBE_DISABLE_GPU=1
npm start
```

Or: `electron . --disable-gpu`

Monaco is **0.57.0** via `node_modules` (not `assets/monaco`).

**Origin:** Main UI is **`file://`** (Monaco scroll). A localhost server still runs for **`voice-mic-bridge.html`** (mic capture only). One launch: **`npm start`**. Debug full-HTTP shell: **`npm run start:http`**.

Editor uses postMessage to `monaco-frame.html` (no cross-frame `IEditor` handles).

## Do not add

- inline Monaco in `#monacoEditor` (shell CSS breaks scroll paint)
- manual wheel / scrollTop hijacking
- overlapping opacity panes over the editor
