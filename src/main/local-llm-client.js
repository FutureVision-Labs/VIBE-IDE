/**
 * Local LLM connectivity (LM Studio default, Ollama optional).
 * OpenAI-compatible /v1/models for LM Studio; Ollama /api/* when provider is ollama.
 */

const path = require('path');

const PROVIDERS = {
  lmstudio: {
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: '',
  },
  ollama: {
    defaultBaseUrl: 'http://127.0.0.1:11434',
    defaultModel: 'gemma4:e4b',
  },
};

const DEFAULT_PROVIDER = 'lmstudio';

function normalizeBaseUrl(url, provider) {
  const fallback = PROVIDERS[provider]?.defaultBaseUrl || PROVIDERS.lmstudio.defaultBaseUrl;
  const s = String(url || fallback).trim().replace(/\/+$/, '');
  return s || fallback;
}

function loadLocalLlmConfig(userDataPath, fs) {
  const localPath = path.join(userDataPath, 'local-llm-config.json');
  const legacyOllamaPath = path.join(userDataPath, 'ollama-config.json');

  const build = (raw, configPath, configExists, providerOverride) => {
    const provider =
      providerOverride ||
      (raw.provider === 'ollama' ? 'ollama' : raw.provider === 'lmstudio' ? 'lmstudio' : DEFAULT_PROVIDER);
    const defs = PROVIDERS[provider] || PROVIDERS.lmstudio;
    return {
      provider,
      baseUrl: normalizeBaseUrl(raw.baseUrl, provider),
      model: typeof raw.model === 'string' ? raw.model.trim() : defs.defaultModel,
      promptCompat: raw.promptCompat !== false,
      configPath,
      configExists,
    };
  };

  try {
    if (fs.existsSync(localPath)) {
      const raw = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
      return build(raw, localPath, true);
    }
  } catch {
    return build({ promptCompat: true }, localPath, true, DEFAULT_PROVIDER);
  }

  try {
    if (fs.existsSync(legacyOllamaPath)) {
      const raw = JSON.parse(fs.readFileSync(legacyOllamaPath, 'utf-8'));
      return build(raw, legacyOllamaPath, true, 'ollama');
    }
  } catch {
    /* fall through */
  }

  const defs = PROVIDERS[DEFAULT_PROVIDER];
  return {
    provider: DEFAULT_PROVIDER,
    baseUrl: defs.defaultBaseUrl,
    model: defs.defaultModel,
    promptCompat: true,
    configPath: localPath,
    configExists: false,
  };
}

function isPromptTemplateError(err) {
  const s = String(err || '').toLowerCase();
  return (
    s.includes('jinja') ||
    s.includes('prompt template') ||
    s.includes('undefinedvalue') ||
    s.includes('cannot call something that is not a function')
  );
}

function lmStudioTemplateHint() {
  return (
    'LM Studio could not render this model’s Jinja prompt template. Try: My Models → your model → Prompt Template (or a lmstudio-community build). ' +
    'VIBE IDE can retry with a simpler message shape (no separate system role / no tools).'
  );
}

function shouldMergeSystemPrompt(cfg, modelId) {
  if (cfg && cfg.promptCompat === false) return false;
  if (cfg && cfg.promptCompat === true) return true;
  const hay = `${modelId || ''} ${cfg?.model || ''}`.toLowerCase();
  return hay.includes('gemma') || hay.includes('google/');
}

async function fetchJson(url, ms = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err.message || String(err), data: null };
  } finally {
    clearTimeout(timer);
  }
}

function ollamaModelInstalled(tagsPayload, modelName) {
  const models = tagsPayload?.models;
  if (!Array.isArray(models) || !modelName) return false;
  const want = modelName.toLowerCase();
  const wantBase = want.split(':')[0];
  return models.some((m) => {
    const name = (m.name || m.model || '').toLowerCase();
    return name === want || name.startsWith(`${wantBase}:`) || name.startsWith(`${wantBase}-`);
  });
}

function openAiModelIds(modelsPayload) {
  const data = modelsPayload?.data;
  if (!Array.isArray(data)) return [];
  return data.map((m) => m.id || m.name).filter(Boolean);
}

function openAiModelMatches(ids, modelName) {
  if (!Array.isArray(ids) || ids.length === 0) return false;
  if (!modelName) return true;
  const want = modelName.toLowerCase();
  const wantTokens = want.split(/[/:\s_-]+/).filter((t) => t.length > 1);
  return ids.some((id) => {
    const hay = id.toLowerCase();
    if (hay === want || hay.includes(want) || want.includes(hay)) return true;
    return wantTokens.length > 0 && wantTokens.every((t) => hay.includes(t));
  });
}

function lmStudioOfflineHint(cfg) {
  return [
    'Open LM Studio → download Gemma 4 E4B (VIBE IDE default · VRAM-friendly)',
    'Load the model → Local Server tab → Start Server',
    `Default URL: ${cfg.baseUrl}`,
    'Optional: copy local-llm-config.example.json to userData as local-llm-config.json',
  ].join('\n');
}

function lmStudioNoModelHint() {
  return 'Server is up but no model is loaded. In LM Studio: pick a downloaded model, load it, then Start Server again.';
}

function resolveModelId(models, cfgModel) {
  if (!Array.isArray(models) || models.length === 0) return null;
  const chatModels = models.filter((m) => !/embed/i.test(m));
  const pool = chatModels.length ? chatModels : models;
  if (!cfgModel) return pool[0];
  const hit = pool.find((id) => openAiModelMatches([id], cfgModel));
  return hit || pool[0];
}

function toOpenAiMessages(messages, systemPrompt, options = {}) {
  const mergeSystemIntoUser = !!options.mergeSystemIntoUser;
  const sys = systemPrompt && String(systemPrompt).trim() ? String(systemPrompt).trim() : '';
  const out = [];

  if (sys && !mergeSystemIntoUser) {
    out.push({ role: 'system', content: sys });
  }

  let systemMerged = !sys || !mergeSystemIntoUser;
  for (const m of Array.isArray(messages) ? messages : []) {
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user';
    let content = typeof m.content === 'string' ? m.content : String(m.content ?? '');
    if (!content.trim() && role !== 'system') continue;

    if (mergeSystemIntoUser && sys && role === 'user' && !systemMerged) {
      content = `[System instructions]\n${sys}\n\n[User]\n${content}`;
      systemMerged = true;
    }

    if (role === 'system' && mergeSystemIntoUser) {
      continue;
    }

    out.push({ role, content });
  }

  if (mergeSystemIntoUser && sys && !systemMerged) {
    out.push({ role: 'user', content: `[System instructions]\n${sys}` });
  }

  return out;
}

async function postJson(url, body, ms = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data,
        error: data?.error?.message || data?.error || text || `HTTP ${res.status}`,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err.message || String(err), data: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chat via LM Studio (OpenAI) or Ollama /api/chat.
 */
function buildOpenAiProvideCodeBlockTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'provide_code_block',
        description:
          'Deliver complete file contents for VIBE IDE to write to the user project. Call once per file when implementing code.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Project-relative path (e.g. index.html, src/game.js)' },
            language: { type: 'string', description: 'html, javascript, css, json, etc.' },
            code: { type: 'string', description: 'Full file source to write' },
          },
          required: ['filePath', 'code'],
        },
      },
    },
  ];
}

function unescapePartialJsonString(raw) {
  let s = String(raw || '');
  s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\"/g, '"');
  s = s.replace(/\\\\/g, '\\');
  s = s.replace(/"\s*}\s*$/, '').replace(/"\s*$/, '');
  return s.trim();
}

/** LM Studio often truncates tool `arguments` mid-string — recover filePath + code body. */
function salvageProvideCodeBlockToolArgs(rawArgs) {
  const blob = String(rawArgs || '').trim();
  if (!blob) return null;
  try {
    const parsed = JSON.parse(blob);
    if (parsed && (parsed.filePath || parsed.path)) return parsed;
  } catch {
    /* partial below */
  }
  const fp =
    blob.match(/"filePath"\s*:\s*"((?:\\.|[^"\\])*)"/i) ||
    blob.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/i);
  if (!fp) return null;
  const filePath = fp[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const codeMatch = blob.match(/"code"\s*:\s*"([\s\S]*)/i) || blob.match(/"content"\s*:\s*"([\s\S]*)/i);
  if (!codeMatch) return { filePath, code: '', language: 'text' };
  const code = unescapePartialJsonString(codeMatch[1]);
  if (code.length < 8) return null;
  const langMatch = blob.match(/"language"\s*:\s*"([^"]+)"/i);
  return {
    filePath,
    code,
    language: langMatch?.[1] || 'text',
    _salvagedFromTruncatedToolJson: true,
  };
}

function parseOpenAiToolCalls(data) {
  const calls = data?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls
    .map((tc) => {
      const raw = tc.function?.arguments || '{}';
      let args = {};
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') args = parsed;
      } catch {
        const salv = salvageProvideCodeBlockToolArgs(raw);
        if (salv) args = salv;
      }
      if ((!args.code || !String(args.code).trim()) && (args.filePath || args.path)) {
        const salv = salvageProvideCodeBlockToolArgs(raw);
        if (salv?.code && String(salv.code).length > String(args.code || '').length) {
          args = salv;
        }
      }
      if (!args.filePath && !args.path) {
        const salv = salvageProvideCodeBlockToolArgs(raw);
        if (salv) args = salv;
      }
      return {
        name: tc.function?.name,
        arguments: args,
        rawArguments: typeof raw === 'string' ? raw : undefined,
      };
    })
    .filter((c) => c.name);
}

async function chatLocalLlm(
  userDataPath,
  fs,
  {
    messages,
    systemPrompt,
    maxTokens,
    useTools = false,
    forceProvideCodeBlock = false,
    temperature,
    forceMergeSystem = false,
  }
) {
  const cfg = loadLocalLlmConfig(userDataPath, fs);
  const status =
    cfg.provider === 'ollama'
      ? await checkOllamaProviderStatus(cfg)
      : await checkLmStudioStatus(cfg);

  if (!status.reachable || !status.hasPreferredModel) {
    return { success: false, error: 'Local brain not ready', hint: status.hint, provider: status.provider };
  }

  const modelId = status.resolvedModelId || status.configuredModel;
  const effectiveMax = Math.min(Math.max(maxTokens || 4096, 256), 65536);
  const temp = typeof temperature === 'number' ? temperature : 0.7;
  const mergeDefault = forceMergeSystem || shouldMergeSystemPrompt(cfg, modelId);

  if (cfg.provider === 'ollama') {
    const openAiMessages = toOpenAiMessages(messages, systemPrompt, { mergeSystemIntoUser: mergeDefault });
    const baseUrl = cfg.baseUrl.replace(/\/v1$/, '');
    const res = await postJson(`${baseUrl}/api/chat`, {
      model: modelId,
      messages: openAiMessages,
      stream: false,
      options: { num_predict: effectiveMax, temperature: 0.7 },
    });
    if (!res.ok) {
      return { success: false, error: res.error || 'Ollama chat failed', provider: 'ollama', status: res.status };
    }
    const content = res.data?.message?.content ?? '';
    return { success: true, content, provider: 'ollama', model: modelId };
  }

  const attemptPlans = [
    { useTools, mergeSystem: mergeDefault },
    { useTools: false, mergeSystem: mergeDefault },
    { useTools: false, mergeSystem: true },
  ];
  const seen = new Set();
  let lastError = 'LM Studio chat failed';

  for (const plan of attemptPlans) {
    const key = `${plan.useTools}:${plan.mergeSystem}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const openAiMessages = toOpenAiMessages(messages, systemPrompt, {
      mergeSystemIntoUser: plan.mergeSystem,
    });
    const body = {
      model: modelId,
      messages: openAiMessages,
      temperature: temp,
      max_tokens: effectiveMax,
      stream: false,
    };
    if (plan.useTools) {
      body.tools = buildOpenAiProvideCodeBlockTools();
      // LM Studio: tool_choice must be "none" | "auto" | "required" (not OpenAI object form).
      body.tool_choice = forceProvideCodeBlock ? 'required' : 'auto';
    }

    const res = await postJson(`${cfg.baseUrl}/chat/completions`, body);
    if (res.ok) {
      const choice = res.data?.choices?.[0] || {};
      const message = choice.message || {};
      const content = message.content ?? '';
      const functionCalls = plan.useTools ? parseOpenAiToolCalls(res.data) : [];
      return {
        success: true,
        content,
        functionCalls: functionCalls.length ? functionCalls : undefined,
        finishReason: choice.finish_reason || null,
        provider: 'lmstudio',
        model: modelId,
        promptCompatUsed: plan.mergeSystem || !plan.useTools,
      };
    }

    lastError = res.error || lastError;
    if (!isPromptTemplateError(lastError)) {
      return {
        success: false,
        error: lastError,
        hint: res.status === 400 ? lmStudioTemplateHint() : undefined,
        provider: 'lmstudio',
        status: res.status,
      };
    }
  }

  return {
    success: false,
    error: lastError,
    hint: lmStudioTemplateHint(),
    provider: 'lmstudio',
  };
}

async function checkLmStudioStatus(cfg) {
  const modelsUrl = `${cfg.baseUrl}/models`;
  const modelsRes = await fetchJson(modelsUrl);
  if (!modelsRes.ok) {
    return {
      reachable: false,
      provider: 'lmstudio',
      baseUrl: cfg.baseUrl,
      configuredModel: cfg.model || '(any loaded model)',
      hasPreferredModel: false,
      models: [],
      version: null,
      configPath: cfg.configPath,
      configExists: cfg.configExists,
      hint: lmStudioOfflineHint(cfg),
    };
  }

  const models = openAiModelIds(modelsRes.data);
  const hasPreferredModel = openAiModelMatches(models, cfg.model);
  const resolvedModelId = resolveModelId(models, cfg.model);
  const activeModel = resolvedModelId || cfg.model || '';

  let hint;
  if (models.length === 0) {
    hint = lmStudioNoModelHint();
  } else if (!hasPreferredModel && cfg.model) {
    hint = `Load a model matching "${cfg.model}" in LM Studio, or clear "model" in local-llm-config.json to use whatever is loaded. Loaded: ${models.slice(0, 3).join(', ')}`;
  } else if (hasPreferredModel) {
    hint = 'Local brain online — chat & @agent ready';
  } else {
    hint = lmStudioNoModelHint();
  }

  return {
    reachable: true,
    provider: 'lmstudio',
    baseUrl: cfg.baseUrl,
    configuredModel: activeModel || cfg.model || '(any loaded model)',
    resolvedModelId,
    hasPreferredModel: models.length > 0 && (cfg.model ? hasPreferredModel : true),
    models,
    version: 'lmstudio',
    configPath: cfg.configPath,
    configExists: cfg.configExists,
    hint,
  };
}

async function checkOllamaProviderStatus(cfg) {
  const baseUrl = cfg.baseUrl.replace(/\/v1$/, '');

  const versionRes = await fetchJson(`${baseUrl}/api/version`);
  if (!versionRes.ok) {
    return {
      reachable: false,
      provider: 'ollama',
      baseUrl,
      configuredModel: cfg.model,
      hasPreferredModel: false,
      models: [],
      version: null,
      configPath: cfg.configPath,
      configExists: cfg.configExists,
      hint: 'Start Ollama, then run: ollama pull gemma4:e4b',
    };
  }

  const tagsRes = await fetchJson(`${baseUrl}/api/tags`);
  const models = Array.isArray(tagsRes.data?.models)
    ? tagsRes.data.models.map((m) => m.name || m.model).filter(Boolean)
    : [];
  const hasPreferredModel = ollamaModelInstalled(tagsRes.data, cfg.model);
  let resolvedModelId = models[0] || cfg.model;
  if (cfg.model) {
    const want = cfg.model.toLowerCase();
    const wantBase = want.split(':')[0];
    resolvedModelId =
      models.find((n) => n.toLowerCase() === want) ||
      models.find((n) => n.toLowerCase().startsWith(`${wantBase}:`)) ||
      models[0] ||
      cfg.model;
  }

  return {
    reachable: true,
    provider: 'ollama',
    baseUrl,
    configuredModel: cfg.model,
    resolvedModelId,
    hasPreferredModel,
    models,
    version: versionRes.data?.version || null,
    configPath: cfg.configPath,
    configExists: cfg.configExists,
    hint: hasPreferredModel
      ? 'Local brain online — chat & @agent ready'
      : `Run: ollama pull ${cfg.model}`,
  };
}

async function checkLocalLlmStatus(userDataPath, fs) {
  const cfg = loadLocalLlmConfig(userDataPath, fs);
  if (cfg.provider === 'ollama') {
    return checkOllamaProviderStatus(cfg);
  }
  return checkLmStudioStatus(cfg);
}

function saveLocalLlmConfig(userDataPath, fs, raw) {
  const configPath = path.join(userDataPath, 'local-llm-config.json');
  const provider = raw.provider === 'ollama' ? 'ollama' : 'lmstudio';
  const defs = PROVIDERS[provider] || PROVIDERS.lmstudio;
  const payload = {
    provider,
    baseUrl: normalizeBaseUrl(raw.baseUrl, provider),
    model: typeof raw.model === 'string' ? raw.model.trim() : defs.defaultModel,
  };
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), 'utf-8');
  return { success: true, configPath, config: payload };
}

/**
 * Stream tokens from LM Studio (OpenAI SSE). Tools not supported while streaming.
 */
async function chatLocalLlmStream(userDataPath, fs, { messages, systemPrompt, maxTokens }, onDelta) {
  const cfg = loadLocalLlmConfig(userDataPath, fs);
  const status =
    cfg.provider === 'ollama'
      ? await checkOllamaProviderStatus(cfg)
      : await checkLmStudioStatus(cfg);

  if (!status.reachable || !status.hasPreferredModel) {
    return { success: false, error: 'Local brain not ready', hint: status.hint };
  }
  if (cfg.provider === 'ollama') {
    return { success: false, error: 'Streaming not implemented for Ollama yet' };
  }

  const modelId = status.resolvedModelId || status.configuredModel;
  const effectiveMax = Math.min(Math.max(maxTokens || 4096, 256), 16384);
  const mergeDefault = shouldMergeSystemPrompt(cfg, modelId);

  async function runStream(mergeSystem) {
    const openAiMessages = toOpenAiMessages(messages, systemPrompt, { mergeSystemIntoUser: mergeSystem });
    return fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: openAiMessages,
        temperature: 0.7,
        max_tokens: effectiveMax,
        stream: true,
      }),
    });
  }

  let res = await runStream(mergeDefault);
  if (!res.ok) {
    const errText = await res.text();
    if (isPromptTemplateError(errText) && !mergeDefault) {
      res = await runStream(true);
    } else if (isPromptTemplateError(errText) && mergeDefault) {
      return { success: false, error: errText, hint: lmStudioTemplateHint() };
    } else if (!res.ok) {
      return { success: false, error: errText || `HTTP ${res.status}` };
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    return { success: false, error: errText || `HTTP ${res.status}`, hint: lmStudioTemplateHint() };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let functionCalls;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          if (typeof onDelta === 'function') onDelta(delta);
        }
        const tcs = parsed.choices?.[0]?.delta?.tool_calls;
        if (tcs) functionCalls = tcs;
      } catch {
        /* skip malformed SSE */
      }
    }
  }

  return {
    success: true,
    content: full,
    provider: 'lmstudio',
    model: modelId,
    streamed: true,
  };
}

module.exports = {
  DEFAULT_PROVIDER,
  PROVIDERS,
  loadLocalLlmConfig,
  saveLocalLlmConfig,
  checkLocalLlmStatus,
  chatLocalLlm,
  chatLocalLlmStream,
  buildOpenAiProvideCodeBlockTools,
  salvageProvideCodeBlockToolArgs,
  isPromptTemplateError,
  lmStudioTemplateHint,
  checkOllamaStatus: checkLocalLlmStatus,
  loadOllamaConfig: loadLocalLlmConfig,
};
