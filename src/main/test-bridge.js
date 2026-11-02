/**
 * Local HTTP bridge for MCP / agent testing — 127.0.0.1 only.
 * Enable: VIBE_TEST_BRIDGE=1 or electron . --test-bridge
 */

const http = require('http');

const DEFAULT_PORT = 8790;

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ raw });
      }
    });
  });
}

function getRenderer(win) {
  if (!win || win.isDestroyed()) return null;
  return win.webContents;
}

async function evalInRenderer(wc, expression) {
  const wrapped = `(async function(){ try { const r = (${expression}); return { ok: true, result: r }; } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; } })()`;
  return wc.executeJavaScript(wrapped, true);
}

async function captureScreenshotPng(win) {
  const wc = getRenderer(win);
  if (!wc) throw new Error('No main window');
  const img = await wc.capturePage();
  return img.toPNG();
}

function startTestBridge(getMainWindow, options = {}) {
  const port = options.port || DEFAULT_PORT;
  let server = null;

  server = http.createServer(async (req, res) => {
    const url = req.url?.split('?')[0] || '/';
    const win = getMainWindow();
    const wc = getRenderer(win);

    try {
      if (req.method === 'GET' && url === '/health') {
        return jsonResponse(res, 200, {
          ok: true,
          service: 'vibe-ide-test-bridge',
          port,
          window: !!(win && !win.isDestroyed()),
          cdpHint: 'Launch with --remote-debugging-port=9223 for CDP',
        });
      }

      if (!wc) {
        return jsonResponse(res, 503, { ok: false, error: 'Main window not ready' });
      }

      if (req.method === 'GET' && url === '/chat/text') {
        const out = await evalInRenderer(
          wc,
          `(function(){
            const el = document.getElementById('chatMessages');
            return el ? el.innerText.slice(-12000) : '';
          })()`
        );
        return jsonResponse(res, 200, { ok: true, text: out.result ?? '' });
      }

      if (req.method === 'POST' && url === '/chat/send') {
        const body = await readBody(req);
        const message = String(body.message || body.text || '').trim();
        if (!message) {
          return jsonResponse(res, 400, { ok: false, error: 'message required' });
        }
        const out = await wc.executeJavaScript(
          `(async function(){
            const message = ${JSON.stringify(message)};
            const chatInput = document.getElementById('chatInput');
            if (!chatInput) return { error: 'chatInput not found' };
            if (chatInput.contentEditable === 'true') {
              chatInput.innerHTML = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            } else {
              chatInput.value = message;
            }
            if (typeof sendChatMessage !== 'function') return { error: 'sendChatMessage not in scope yet' };
            sendChatMessage();
            return { ok: true };
          })()`,
          true
        );
        return jsonResponse(res, 200, out.result ?? out);
      }

      if (req.method === 'POST' && url === '/eval') {
        const body = await readBody(req);
        const expr = body.expression ?? body.expr;
        if (!expr) {
          return jsonResponse(res, 400, { ok: false, error: 'expression required' });
        }
        const out = await evalInRenderer(wc, expr);
        return jsonResponse(res, 200, out);
      }

      if (req.method === 'GET' && url === '/screenshot') {
        const png = await captureScreenshotPng(win);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(png);
      }

      if (req.method === 'POST' && url === '/agent/approve') {
        const out = await wc.executeJavaScript(
          `(function(){
            const btn = document.querySelector('.agent-approve-btn');
            if (!btn) return { ok: false, error: 'No Approve write button in chat' };
            btn.click();
            return { ok: true };
          })()`,
          true
        );
        return jsonResponse(res, 200, out.result ?? out);
      }

      if (req.method === 'POST' && url === '/agent/reject') {
        const out = await wc.executeJavaScript(
          `(function(){
            const btn = document.querySelector('.agent-reject-btn');
            if (!btn) return { ok: false, error: 'No Reject button in chat' };
            btn.click();
            return { ok: true };
          })()`,
          true
        );
        return jsonResponse(res, 200, out.result ?? out);
      }

      if (req.method === 'GET' && url === '/agent/pending') {
        const out = await evalInRenderer(
          wc,
          `(function(){
            const approve = !!document.querySelector('.agent-approve-btn');
            const pathEl = document.querySelector('.agent-approval code');
            return { pending: approve, path: pathEl ? pathEl.textContent : null };
          })()`
        );
        return jsonResponse(res, 200, { ok: true, ...(out.result || {}) });
      }

      if (req.method === 'GET' && url === '/cdp/targets') {
        const cdpPort = options.cdpPort || 9223;
        const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).catch(() => null);
        if (!listRes?.ok) {
          return jsonResponse(res, 502, {
            ok: false,
            error: `CDP not reachable on ${cdpPort}. Start: npm run dev:cdp`,
          });
        }
        const targets = await listRes.json();
        return jsonResponse(res, 200, { ok: true, targets });
      }

      return jsonResponse(res, 404, {
        ok: false,
        error: 'Not found',
        routes: [
          'GET /health',
          'GET /chat/text',
          'POST /chat/send',
          'GET /screenshot',
          'POST /eval',
          'GET /agent/pending',
          'POST /agent/approve',
          'POST /agent/reject',
          'GET /cdp/targets',
        ],
      });
    } catch (err) {
      return jsonResponse(res, 500, { ok: false, error: err.message || String(err) });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`🧪 VIBE test bridge http://127.0.0.1:${port} (MCP / Chief QA)`);
  });

  return {
    port,
    close() {
      if (server) server.close();
    },
  };
}

module.exports = { startTestBridge, DEFAULT_PORT };
