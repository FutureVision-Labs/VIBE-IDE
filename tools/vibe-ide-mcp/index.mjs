#!/usr/bin/env node
/**
 * VIBE IDE MCP — Chief can screenshot, read chat, send messages, eval in renderer.
 *
 * Prereq: VIBE running with test bridge (npm run dev:cdp in VIBE-IDE).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BRIDGE = process.env.VIBE_TEST_BRIDGE_URL || 'http://127.0.0.1:8790';

async function bridgeFetch(path, options = {}) {
  const url = `${BRIDGE.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('image/png')) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: res.ok, status: res.status, png: buf };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const server = new Server(
  { name: 'vibe-ide', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'vibe_status',
      description: 'Check VIBE IDE test bridge (and CDP hint). Start app with npm run dev:cdp first.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'vibe_screenshot',
      description: 'PNG screenshot of the main VIBE IDE window (via test bridge).',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'vibe_chat_read',
      description: 'Last ~12k chars of chat message pane text.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'vibe_chat_send',
      description: 'Send a user chat message (same as typing in Cursy chat and sending).',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Plain text / markdown for chat' },
        },
        required: ['message'],
      },
    },
    {
      name: 'vibe_eval',
      description: 'Run a JavaScript expression in the renderer (DevTools-style). Returns JSON-serializable result.',
      inputSchema: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'JS expression, e.g. document.title' },
        },
        required: ['expression'],
      },
    },
    {
      name: 'vibe_cdp_targets',
      description: 'List Chromium debug targets when VIBE was started with --remote-debugging-port=9223.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'vibe_agent_pending',
      description: 'True if an agent Approve write card is visible in chat; includes file path if found.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'vibe_agent_approve',
      description: 'Click Approve write on the pending agent card (test bridge). Use Computer Use only if this fails.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'vibe_agent_reject',
      description: 'Click Reject on the pending agent write card.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'vibe_status') {
      const r = await bridgeFetch('/health');
      return {
        content: [{ type: 'text', text: JSON.stringify(r.data ?? { error: r.status }, null, 2) }],
      };
    }

    if (name === 'vibe_screenshot') {
      const r = await bridgeFetch('/screenshot');
      if (!r.ok || !r.png) {
        return {
          content: [{ type: 'text', text: `Screenshot failed (${r.status}). Is VIBE running with --test-bridge?` }],
          isError: true,
        };
      }
      return {
        content: [
          { type: 'text', text: 'VIBE IDE window screenshot' },
          { type: 'image', data: r.png.toString('base64'), mimeType: 'image/png' },
        ],
      };
    }

    if (name === 'vibe_chat_read') {
      const r = await bridgeFetch('/chat/text');
      return {
        content: [{ type: 'text', text: r.data?.text ?? JSON.stringify(r.data) }],
      };
    }

    if (name === 'vibe_chat_send') {
      const message = String(args?.message || '').trim();
      const r = await bridgeFetch('/chat/send', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(r.data, null, 2) }],
        isError: !r.ok,
      };
    }

    if (name === 'vibe_eval') {
      const expression = String(args?.expression || '').trim();
      const r = await bridgeFetch('/eval', {
        method: 'POST',
        body: JSON.stringify({ expression }),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(r.data, null, 2) }],
        isError: !r.ok,
      };
    }

    if (name === 'vibe_cdp_targets') {
      const r = await bridgeFetch('/cdp/targets');
      return {
        content: [{ type: 'text', text: JSON.stringify(r.data, null, 2) }],
        isError: !r.ok,
      };
    }

    if (name === 'vibe_agent_pending') {
      const r = await bridgeFetch('/agent/pending');
      return { content: [{ type: 'text', text: JSON.stringify(r.data, null, 2) }] };
    }

    if (name === 'vibe_agent_approve') {
      const r = await bridgeFetch('/agent/approve', { method: 'POST', body: '{}' });
      return {
        content: [{ type: 'text', text: JSON.stringify(r.data, null, 2) }],
        isError: !r.ok || r.data?.ok === false,
      };
    }

    if (name === 'vibe_agent_reject') {
      const r = await bridgeFetch('/agent/reject', { method: 'POST', body: '{}' });
      return {
        content: [{ type: 'text', text: JSON.stringify(r.data, null, 2) }],
        isError: !r.ok || r.data?.ok === false,
      };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Bridge error: ${err.message}. Start VIBE with npm run dev:cdp` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
