/**
 * Serve renderer over http://127.0.0.1 (same pattern as gemini-matrix-portal Electron → localhost:3333).
 * getUserMedia + ScriptProcessor are reliable on a secure origin, not on file://.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};

function safeJoin(root, urlPath) {
  const normalized = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(root, normalized);
  if (!full.startsWith(path.resolve(root))) return null;
  return full;
}

/** Stable origin so localStorage survives relaunch (random port = new origin every boot). */
const DEFAULT_RENDERER_PORT = 37891;

function startRendererStaticServer(rendererRoot, options = {}) {
  const root = path.resolve(rendererRoot);
  const preferredPort = options.port ?? DEFAULT_RENDERER_PORT;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        const filePath = safeJoin(root, urlPath);
        if (!filePath || !fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const type = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err.message || err));
      }
    });
    function onListening(port) {
      resolve({
        server,
        port,
        indexUrl: `http://127.0.0.1:${port}/index.html`,
      });
    }

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && preferredPort !== 0) {
        console.warn(
          `[VIBE IDE] Renderer port ${preferredPort} busy — falling back to ephemeral port (localStorage may not persist across restarts)`
        );
        server.listen(0, '127.0.0.1', () => onListening(server.address().port));
        return;
      }
      reject(err);
    });

    server.listen(preferredPort, '127.0.0.1', () => onListening(server.address().port));
  });
}

module.exports = { startRendererStaticServer, DEFAULT_RENDERER_PORT };
