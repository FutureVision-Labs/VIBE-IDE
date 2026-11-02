/**
 * Gemini Flash (BYOK) — chat and agent drafts. Project files stay on disk.
 */

const path = require('path');

const GEMINI_MODEL = 'gemini-2.5-flash';

let cachedKey = null;
let genAI = null;

function loadGeminiApiKey(userDataPath, fs) {
  try {
    const configPath = path.join(userDataPath, 'google-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.apiKey && String(config.apiKey).trim()) {
        cachedKey = String(config.apiKey).trim();
        return cachedKey;
      }
    }
    if (process.env.GEMINI_API_KEY && String(process.env.GEMINI_API_KEY).trim()) {
      cachedKey = String(process.env.GEMINI_API_KEY).trim();
      return cachedKey;
    }
    if (process.env.GOOGLE_API_KEY && String(process.env.GOOGLE_API_KEY).trim()) {
      cachedKey = String(process.env.GOOGLE_API_KEY).trim();
      return cachedKey;
    }
    cachedKey = null;
    return null;
  } catch {
    cachedKey = null;
    return null;
  }
}

function saveGeminiApiKey(userDataPath, fs, apiKey) {
  const configPath = path.join(userDataPath, 'google-config.json');
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) {
    return { success: false, error: 'API key is empty' };
  }
  fs.writeFileSync(configPath, JSON.stringify({ apiKey: trimmed }, null, 2), 'utf-8');
  cachedKey = trimmed;
  genAI = null;
  return { success: true, configPath };
}

function getGeminiStatus(userDataPath, fs) {
  const configPath = path.join(userDataPath, 'google-config.json');
  const key = loadGeminiApiKey(userDataPath, fs);
  return {
    hasApiKey: !!key,
    initialized: !!genAI,
    model: GEMINI_MODEL,
    configPath,
    configExists: fs.existsSync(configPath),
    hasEnvVar: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  };
}

function ensureGeminiClient(userDataPath, fs) {
  const key = loadGeminiApiKey(userDataPath, fs);
  if (!key) {
    genAI = null;
    return null;
  }
  if (genAI && cachedKey === key) return genAI;
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    genAI = new GoogleGenerativeAI(key);
    cachedKey = key;
    return genAI;
  } catch (err) {
    genAI = null;
    throw err;
  }
}

function buildProvideCodeBlockTools() {
  const { SchemaType } = require('@google/generative-ai');
  return [
    {
      functionDeclarations: [
        {
          name: 'provide_code_block',
          description:
            'Deliver complete file contents for VIBE IDE to write to the user project. Call once per file when implementing code.',
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              filePath: {
                type: SchemaType.STRING,
                description: 'Project-relative path (e.g. index.html, src/app.js)',
              },
              language: {
                type: SchemaType.STRING,
                description: 'html, javascript, css, json, etc.',
              },
              code: {
                type: SchemaType.STRING,
                description: 'Full file source to write',
              },
            },
            required: ['filePath', 'code'],
          },
        },
      ],
    },
  ];
}

function messagesToGeminiHistory(messages) {
  const history = [];
  if (!Array.isArray(messages)) return history;
  for (const m of messages) {
    if (!m || m.role === 'system') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = typeof m.content === 'string' ? m.content : '';
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (!text.trim()) continue;
    history.push({ role, parts: [{ text }] });
  }
  return history;
}

function buildGeminiUserParts(message) {
  const text = typeof message?.content === 'string' ? message.content.trim() : '';
  const images = Array.isArray(message?.images) ? message.images : [];
  const parts = [];
  if (text) parts.push({ text });
  for (const img of images.slice(0, 4)) {
    const mimeType = img.mimeType || img.mime || 'image/jpeg';
    const data = img.data || img.base64;
    if (data && typeof data === 'string') {
      parts.push({ inlineData: { mimeType, data: data.replace(/^data:[^;]+;base64,/, '') } });
    }
  }
  return parts;
}

function normalizeGeminiHistory(history) {
  const h = Array.isArray(history) ? [...history] : [];
  while (h.length > 0 && h[0].role === 'model') {
    h.shift();
  }
  const out = [];
  for (const entry of h) {
    if (!entry || !entry.parts || !entry.parts.length) continue;
    if (!out.length) {
      if (entry.role === 'user') out.push(entry);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev.role === entry.role) {
      prev.parts[0].text = `${prev.parts[0].text || ''}\n${entry.parts[0].text || ''}`;
    } else {
      out.push(entry);
    }
  }
  while (out.length > 0 && out[0].role === 'model') {
    out.shift();
  }
  return out;
}

/**
 * Gemini chat completion — same return shape as legacy chatLocalLlm for agent compatibility.
 */
async function chatGemini(
  userDataPath,
  fs,
  {
    messages,
    systemPrompt,
    maxTokens,
    useTools = false,
    forceProvideCodeBlock = false,
    temperature,
  }
) {
  let client;
  try {
    client = ensureGeminiClient(userDataPath, fs);
  } catch (err) {
    return { success: false, error: err.message || String(err), provider: 'gemini' };
  }
  if (!client) {
    return {
      success: false,
      error: 'No Gemini API key',
      hint: 'File → User Settings → add your Google AI Studio key (saved as google-config.json).',
      provider: 'gemini',
    };
  }

  const rawMessages = Array.isArray(messages) ? messages : [];
  if (rawMessages.length === 0) {
    return { success: false, error: 'No messages provided', provider: 'gemini' };
  }

  const last = rawMessages[rawMessages.length - 1];
  if (!last || last.role !== 'user') {
    return { success: false, error: 'Last message must be from user', provider: 'gemini' };
  }

  const userParts = buildGeminiUserParts(last);
  if (!userParts.length) {
    return { success: false, error: 'User message needs text or at least one image', provider: 'gemini' };
  }

  const hasImages = userParts.some((p) => p.inlineData);
  const prior = rawMessages.slice(0, -1);
  const history = normalizeGeminiHistory(messagesToGeminiHistory(prior));
  const sys =
    systemPrompt ||
    'You are Cursy, a friendly and enthusiastic AI coding assistant for VIBE IDE.';

  const { FunctionCallingMode } = require('@google/generative-ai');
  const effectiveMax = Math.min(Math.max(maxTokens || 8192, 256), 65536);
  const temp = typeof temperature === 'number' ? temperature : 0.7;
  const allowTools = useTools && !hasImages;

  const modelOpts = {
    model: GEMINI_MODEL,
    systemInstruction: sys,
    generationConfig: {
      temperature: temp,
      maxOutputTokens: effectiveMax,
    },
  };

  if (allowTools) {
    modelOpts.tools = buildProvideCodeBlockTools();
    modelOpts.toolConfig = {
      functionCallingConfig: {
        mode: forceProvideCodeBlock ? FunctionCallingMode.ANY : FunctionCallingMode.AUTO,
      },
    };
  }

  try {
    const model = client.getGenerativeModel(modelOpts);
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(userParts);
    const response = result.response;

    let content = '';
    try {
      content = response.text() || '';
    } catch {
      content = '';
    }

    const rawFc = typeof response.functionCalls === 'function' ? response.functionCalls() : undefined;
    const functionCalls = [];
    if (rawFc && rawFc.length > 0) {
      for (const fc of rawFc) {
        const args = fc.args && typeof fc.args === 'object' ? fc.args : {};
        functionCalls.push({
          name: fc.name,
          arguments: args,
        });
      }
    }

    const finishReason =
      response.candidates?.[0]?.finishReason ||
      response.promptFeedback?.blockReason ||
      null;

    return {
      success: true,
      content,
      functionCalls: functionCalls.length ? functionCalls : undefined,
      finishReason: finishReason || null,
      provider: 'gemini',
      model: GEMINI_MODEL,
    };
  } catch (error) {
    const status = error.status || error.statusCode || error.code || 500;
    return {
      success: false,
      error: error.message || String(error),
      status,
      provider: 'gemini',
    };
  }
}

module.exports = {
  GEMINI_MODEL,
  loadGeminiApiKey,
  saveGeminiApiKey,
  getGeminiStatus,
  ensureGeminiClient,
  chatGemini,
  buildProvideCodeBlockTools,
  messagesToGeminiHistory,
  normalizeGeminiHistory,
};
