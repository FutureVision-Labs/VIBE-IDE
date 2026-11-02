/**
 * Project Recall v0 — hybrid-ish search without embeddings (keyword + path boosts).
 * Indexes .md, .cml, .txt under project root; prioritizes cml/ and PROJECT_JOURNAL.
 */

const path = require('path');

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.cache',
  'coverage',
  '.vite',
  'assets',
  '.vibe',
]);
const RECALL_EXTENSIONS = new Set([
  '.md',
  '.cml',
  '.txt',
  '.markdown',
  '.js',
  '.jsx',
  '.html',
  '.htm',
  '.css',
]);
const MAX_CODE_FILE_BYTES = 256 * 1024;
const MAX_FILES = 280;
const MAX_DEPTH = 7;
const MAX_CHUNK_CHARS = 900;
const MAX_SNIPPETS = 6;
const MAX_NEURAL_CHUNKS = 120;
const RECALL_INDEX_VERSION = 1;

function recallIndexPath(projectRoot) {
  return path.join(projectRoot, '.vibe', 'recall-index.json');
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function chunkKey(relPath, index) {
  return `${relPath}#${index}`;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function pathBoost(relPath) {
  const p = relPath.replace(/\\/g, '/').toLowerCase();
  if (p.includes('/.vibe/pinned')) return 3;
  if (p.startsWith('pinned:')) return 3.2;
  if (p.includes('/cml/') || p.startsWith('cml/')) return 2.4;
  if (p.includes('project_journal')) return 2;
  if (p.includes('agent_persona')) return 1.6;
  if (/\.(js|jsx|html?|css)$/.test(p)) return 1.35;
  return 1;
}

function chunkText(content, relPath) {
  const chunks = [];
  const normalized = String(content || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return chunks;

  const parts = normalized.split(/\n{2,}/);
  let buf = '';
  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    if ((buf + '\n\n' + piece).length > MAX_CHUNK_CHARS) {
      if (buf) chunks.push(buf.trim());
      buf = piece.length > MAX_CHUNK_CHARS ? piece.slice(0, MAX_CHUNK_CHARS) + '…' : piece;
    } else {
      buf = buf ? `${buf}\n\n${piece}` : piece;
    }
  }
  if (buf) chunks.push(buf.trim());

  if (chunks.length === 0 && normalized.length) {
    chunks.push(normalized.slice(0, MAX_CHUNK_CHARS));
  }

  return chunks.map((text, index) => ({ relPath, text, index }));
}

function collectFiles(rootDir, fs, acc, depth = 0) {
  if (acc.length >= MAX_FILES || depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (acc.length >= MAX_FILES) break;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name.toLowerCase())) continue;
      collectFiles(full, fs, acc, depth + 1);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!RECALL_EXTENSIONS.has(ext)) continue;
      acc.push(full);
    }
  }
}

function scoreChunk(chunk, queryTokens) {
  if (!queryTokens.length) return 0;
  const hay = chunk.text.toLowerCase();
  let score = 0;
  for (const tok of queryTokens) {
    if (hay.includes(tok)) {
      const re = new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const hits = hay.match(re);
      score += hits ? hits.length : 1;
    }
  }
  return score * pathBoost(chunk.relPath);
}

function collectRecallChunks(projectRoot, fs, maxChunks = MAX_NEURAL_CHUNKS) {
  const files = [];
  collectFiles(projectRoot, fs, files);
  const allChunks = [];
  for (const filePath of files) {
    if (allChunks.length >= maxChunks) break;
    let content;
    try {
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const maxSize = ['.js', '.jsx', '.html', '.htm', '.css'].includes(ext)
        ? MAX_CODE_FILE_BYTES
        : 512 * 1024;
      if (stat.size > maxSize) continue;
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    const relPath = path.relative(projectRoot, filePath);
    for (const c of chunkText(content, relPath)) {
      if (allChunks.length >= maxChunks) break;
      allChunks.push({
        chunkId: chunkKey(c.relPath, c.index),
        relPath: c.relPath,
        index: c.index,
        text: c.text,
      });
    }
  }
  return { chunks: allChunks, scannedFiles: files.length };
}

function buildRecallFingerprint(projectRoot, fs) {
  const files = [];
  collectFiles(projectRoot, fs, files);
  const parts = files
    .map((fp) => {
      try {
        const st = fs.statSync(fp);
        return `${path.relative(projectRoot, fp)}:${st.mtimeMs}:${st.size}`;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort();
  return parts.join('|');
}

function loadRecallIndex(projectRoot, fs) {
  const fp = recallIndexPath(projectRoot);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {
    return null;
  }
}

function saveRecallIndex(projectRoot, fs, payload) {
  const dir = path.join(projectRoot, '.vibe');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(recallIndexPath(projectRoot), JSON.stringify(payload, null, 0), 'utf-8');
  return { success: true, path: recallIndexPath(projectRoot) };
}

function searchVectorRecall(indexEntries, queryEmbedding, topK = MAX_SNIPPETS) {
  if (!queryEmbedding?.length || !Array.isArray(indexEntries)) return [];
  return indexEntries
    .map((e) => ({
      path: e.relPath,
      text: e.text,
      chunkId: e.chunkId,
      score: cosineSimilarity(queryEmbedding, e.embedding) * 10 * pathBoost(e.relPath),
      source: 'neural',
    }))
    .filter((e) => e.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function mergeRecallResults(keywordSnippets, vectorSnippets) {
  const map = new Map();
  for (const s of keywordSnippets) {
    const key = `${s.path}::${s.text.slice(0, 80)}`;
    map.set(key, { ...s, score: s.score || 0, sources: ['keyword'] });
  }
  for (const s of vectorSnippets) {
    const key = `${s.path}::${s.text.slice(0, 80)}`;
    const prev = map.get(key);
    if (prev) {
      prev.score += s.score;
      prev.sources.push('neural');
    } else {
      map.set(key, { ...s, sources: ['neural'] });
    }
  }
  return [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SNIPPETS)
    .map((r) => ({
      path: r.path,
      text: r.text,
      score: Math.round(r.score * 100) / 100,
      sources: r.sources,
    }));
}

/**
 * @returns {{ success: boolean, snippets: Array<{path:string, score:number, text:string}>, scannedFiles: number }}
 */
function searchProjectRecall(projectRoot, query, fs, queryEmbedding = null) {
  if (!projectRoot || !fs.existsSync(projectRoot)) {
    return { success: false, error: 'Invalid project path', snippets: [], scannedFiles: 0 };
  }

  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    return { success: true, snippets: [], scannedFiles: 0, hint: 'Empty query' };
  }

  const files = [];
  collectFiles(projectRoot, fs, files);

  const allChunks = [];
  for (const filePath of files) {
    let content;
    try {
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const maxSize = ['.js', '.jsx', '.html', '.htm', '.css'].includes(ext)
        ? MAX_CODE_FILE_BYTES
        : 512 * 1024;
      if (stat.size > maxSize) continue;
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    const relPath = path.relative(projectRoot, filePath);
    allChunks.push(...chunkText(content, relPath));
  }

  const keywordSnippets = allChunks
    .map((c) => ({ ...c, score: scoreChunk(c, queryTokens) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SNIPPETS)
    .map((r) => ({
      path: r.relPath,
      score: Math.round(r.score * 10) / 10,
      text: r.text,
      sources: ['keyword'],
    }));

  let vectorSnippets = [];
  const stored = loadRecallIndex(projectRoot, fs);
  if (queryEmbedding?.length && stored?.entries?.length) {
    vectorSnippets = searchVectorRecall(stored.entries, queryEmbedding);
  }

  const snippets =
    vectorSnippets.length > 0
      ? mergeRecallResults(keywordSnippets, vectorSnippets)
      : keywordSnippets;

  return {
    success: true,
    snippets,
    scannedFiles: files.length,
    queryTokens,
    hybrid: vectorSnippets.length > 0,
    indexEntries: stored?.entries?.length || 0,
  };
}

/**
 * Recent CML filenames (newest first by name / mtime).
 */
function listRecentCmlFiles(projectRoot, fs, limit = 5) {
  const cmlDir = path.join(projectRoot, 'cml');
  if (!fs.existsSync(cmlDir)) {
    return { success: true, files: [] };
  }
  let entries;
  try {
    entries = fs
      .readdirSync(cmlDir)
      .filter((n) => n.toLowerCase().endsWith('.cml'))
      .map((name) => {
        const full = path.join(cmlDir, name);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          /* ignore */
        }
        return { name, full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name))
      .slice(0, limit);
  } catch (err) {
    return { success: false, error: err.message, files: [] };
  }
  return { success: true, files: entries.map((e) => ({ name: e.name, path: e.full })) };
}

function unescapeCmlString(raw) {
  return String(raw || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function extractCmlQuotedField(text, fieldName) {
  const re = new RegExp(`${fieldName}\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 's');
  const m = String(text || '').match(re);
  return m ? unescapeCmlString(m[1]) : '';
}

/**
 * Rebuild Cursy chat turns from auto-saved chat-conversation CML files (oldest → newest).
 */
function rebuildChatHistoryFromCml(projectRoot, fs, limit = 120) {
  const cmlDir = path.join(projectRoot, 'cml');
  if (!fs.existsSync(cmlDir)) {
    return { success: true, messages: [], fileCount: 0 };
  }

  let entries;
  try {
    entries = fs
      .readdirSync(cmlDir)
      .filter((n) => n.toLowerCase().endsWith('.cml'))
      .map((name) => {
        const full = path.join(cmlDir, name);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          /* ignore */
        }
        return { name, full, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
  } catch (err) {
    return { success: false, error: err.message, messages: [], fileCount: 0 };
  }

  const messages = [];
  let fileCount = 0;

  for (const entry of entries) {
    if (fileCount >= limit) break;
    let text;
    try {
      text = fs.readFileSync(entry.full, 'utf-8');
    } catch {
      continue;
    }
    if (!/type\s*:\s*chat-conversation/i.test(text)) continue;

    const userMsg = extractCmlQuotedField(text, 'user_message');
    const assistantMsg = extractCmlQuotedField(text, 'assistant_message');
    const ts = extractCmlQuotedField(text, 'timestamp') || new Date(entry.mtime).toISOString();

    if (userMsg) {
      messages.push({ role: 'user', content: userMsg, timestamp: ts });
    }
    if (assistantMsg) {
      messages.push({ role: 'assistant', content: assistantMsg, timestamp: ts });
    }
    fileCount += 1;
  }

  return { success: true, messages, fileCount };
}

module.exports = {
  searchProjectRecall,
  listRecentCmlFiles,
  rebuildChatHistoryFromCml,
  collectRecallChunks,
  buildRecallFingerprint,
  loadRecallIndex,
  saveRecallIndex,
  RECALL_INDEX_VERSION,
  MAX_NEURAL_CHUNKS,
  tokenize,
};
