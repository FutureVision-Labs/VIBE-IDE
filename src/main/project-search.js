/**
 * Project grep / find — sandboxed under project root, no shell rg required.
 */

const path = require('path');

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.vibe',
  'dist',
  'build',
  'out',
  '.cache',
  'coverage',
  '.next',
  'vendor',
]);

const TEXT_EXT = new Set([
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.mdx',
  '.txt',
  '.cml',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.svg',
  '.php',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.vue',
  '.svelte',
]);

const MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_MATCHES = 40;
const DEFAULT_MAX_FILES_SCAN = 800;

function normalizeProjectPath(projectRoot) {
  return path.resolve(projectRoot);
}

function resolveInProject(projectRoot, relPath) {
  const root = normalizeProjectPath(projectRoot);
  const target = path.resolve(root, relPath || '.');
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes project root');
  }
  return target;
}

function shouldSkipDir(name) {
  return SKIP_DIR_NAMES.has(String(name || '').toLowerCase());
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  return base === 'dockerfile' || base.startsWith('.env');
}

function walkProjectFiles(projectRoot, fs, maxFiles = DEFAULT_MAX_FILES_SCAN) {
  const root = normalizeProjectPath(projectRoot);
  const files = [];

  function walk(dir, depth) {
    if (files.length >= maxFiles || depth > 12) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (files.length >= maxFiles) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!shouldSkipDir(ent.name)) walk(full, depth + 1);
      } else if (ent.isFile() && isTextFile(full)) {
        files.push(full);
      }
    }
  }

  walk(root, 0);
  return files;
}

function grepProject(projectRoot, pattern, fs, options = {}) {
  const root = normalizeProjectPath(projectRoot);
  const maxMatches = Math.min(options.maxMatches || DEFAULT_MAX_MATCHES, 80);
  const caseInsensitive = options.caseInsensitive !== false;
  let re;
  try {
    re = new RegExp(pattern, caseInsensitive ? 'i' : '');
  } catch (err) {
    return { ok: false, error: `Invalid pattern: ${err.message}`, matches: [] };
  }

  const matches = [];
  let truncated = false;
  const files = walkProjectFiles(root, fs, options.maxFilesScan || DEFAULT_MAX_FILES_SCAN);

  for (const abs of files) {
    if (matches.length >= maxMatches) {
      truncated = true;
      break;
    }
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;

    let text;
    try {
      text = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
      if (re.test(lines[i])) {
        matches.push({
          file: path.relative(root, abs).replace(/\\/g, '/'),
          line: i + 1,
          text: lines[i].trim().slice(0, 240),
        });
      }
    }
  }

  return {
    ok: true,
    pattern,
    matchCount: matches.length,
    truncated,
    filesScanned: files.length,
    matches,
  };
}

function findFiles(projectRoot, query, fs, options = {}) {
  const root = normalizeProjectPath(projectRoot);
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { ok: false, error: 'Empty query', files: [] };

  const maxResults = Math.min(options.maxResults || 50, 100);
  const files = walkProjectFiles(root, fs, options.maxFilesScan || DEFAULT_MAX_FILES_SCAN);
  const hits = [];

  for (const abs of files) {
    if (hits.length >= maxResults) break;
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    const base = path.basename(rel).toLowerCase();
    if (base.includes(q) || rel.toLowerCase().includes(q)) {
      hits.push(rel);
    }
  }

  return { ok: true, query, count: hits.length, files: hits };
}

/** Extract grep terms from goal/brief for planner hints. */
function extractSearchTerms(blob) {
  const terms = [];
  const text = String(blob || '');
  const quoted = text.match(/["'`]([^"'`]{2,48})["'`]/g);
  if (quoted) {
    for (const q of quoted) {
      const inner = q.slice(1, -1).trim();
      if (inner && !/^https?:/i.test(inner)) terms.push(inner);
    }
  }
  const idClass = text.match(/\b(?:#|\.)([a-zA-Z][\w-]{2,32})/g);
  if (idClass) {
    for (const t of idClass) terms.push(t.replace(/^[#.]/, ''));
  }
  const fixMatch = text.match(/\bfix(?:ing)?\s+([a-zA-Z][\w.-]{2,40})/i);
  if (fixMatch) terms.push(fixMatch[1]);
  return [...new Set(terms)].slice(0, 6);
}

/**
 * Enrich a ship plan with files that grep hits suggest (IDE planner).
 */
function goalHtmlReadOnlyForCssImplement(goal) {
  const g = String(goal || '').toLowerCase();
  if (
    /\b(edit|change|update|fix|rewrite|modify|write|patch|ship)\s+(the\s+)?(html|index\.html|markup)\b/.test(g)
  ) {
    return false;
  }
  const readHtml =
    /\b(check|read|look at|inspect|grep|scan|open|use)\s+(the\s+)?(html|index\.html|markup)\b/.test(g) ||
    /\b(html|index\.html|markup)\s+for\s+(the\s+)?(classes|class names|selectors|ids|structure)\b/.test(g) ||
    /\b(classes|class names|selectors)\s+(in|from)\s+(the\s+)?(html|index\.html|markup)\b/.test(g);
  const cssWork =
    /\b(css|stylesheet|styles?\.css)\b/.test(g) &&
    /\b(implement|apply|fix|ship|write|update|polish|change|edit|do)\b/.test(g);
  return readHtml && cssWork;
}

function goalIsCssOnlyShip(goal) {
  const g = String(goal || '').toLowerCase();
  if (goalHtmlReadOnlyForCssImplement(goal)) return true;
  const wantsHtml =
    /\b(index\.html|\.html\b|markup|structure|the html|html file)\b/.test(g) &&
    !/\b(no html|not html|don't touch html|without html|css only|stylesheet only)\b/.test(g);
  if (wantsHtml) return false;
  if (/\bstyles?\.css\b/.test(g) && !/\bindex\.html\b/.test(g)) return true;
  if (/\b(edit|update|fix|apply|polish|change|tweak|ship|write|implement)\s+(the\s+)?(css|stylesheet)\b/.test(g)) {
    return true;
  }
  if (
    /\b(the\s+)?css\b/.test(g) &&
    /\b(those fixes|these fixes|fixes from|with those|per chat|per plan|from chat|from above)\b/.test(g)
  ) {
    return true;
  }
  if (/\bcss\b/.test(g) && /\bonly\b/.test(g)) return true;
  return false;
}

function goalIsTargetedEdit(blob) {
  const text = String(blob || '');
  if (goalIsCssOnlyShip(text)) return true;
  if (/\b(only|just|scoped edit|edit in place|do not redo|enhance not redo)\b/i.test(text)) return true;
  return (
    /\b(fix|adjust|tweak|polish|update|refine|edit|apply)\b/i.test(text) &&
    /\b(css|styles|section|feature|nav|hero|layout|card|theme|stylesheet)\b/i.test(text)
  );
}

function goalIsGameDirectoryOnlyScope(goal) {
  const g = String(goal || '');
  const gl = g.toLowerCase();
  if (!/\bgame\b/.test(gl)) return false;
  if (/\b@agent\s+scaffold\s+game\/?\b/i.test(g)) return true;
  if (/\bscaffold\s+(?:the\s+)?game\/?\b/i.test(g) && !/\blanding\b/i.test(gl)) return true;
  if (/\b(?:scaffold|write|ship|create|build)\s+(?:in\s+)?(?:the\s+)?game\/?\s+only\b/i.test(g)) return true;
  if (/\bgame\/?\s+only\b/i.test(g)) return true;
  if (/\bonly\s+(?:in\s+)?(?:the\s+)?game\/?\b/i.test(g)) return true;
  if (/\bnothing outside (?:the\s+)?game\/?\b/i.test(g)) return true;
  if (/\b(?:do\s+not|don't)\s+(?:touch|modify|write)\b/i.test(g) && /\b(?:landing|index\.html|styles\.css)\b/i.test(g)) {
    return true;
  }
  return false;
}

function enrichShipPlanFromSearch(projectRoot, goal, sessionBrief, plan, fs) {
  if (goalIsCssOnlyShip(goal)) {
    return ['styles.css'];
  }

  const basePlan = Array.isArray(plan) ? [...plan] : [];
  const seen = new Set(basePlan.map((p) => String(p).toLowerCase()));
  const blob = `${goal || ''}\n${sessionBrief || ''}`;

  if (goalIsGameDirectoryOnlyScope(goal)) {
    const scoped = basePlan
      .map((p) => String(p || '').replace(/\\/g, '/'))
      .filter((p) => /^game\//i.test(p));
    if (scoped.length) return scoped.slice(0, 4);
    return ['game/index.html', 'game/style.css', 'game/script.js'];
  }

  if (goalIsTargetedEdit(blob) && basePlan.length >= 1 && basePlan.length <= 3) {
    return basePlan;
  }

  const terms = extractSearchTerms(blob);
  const added = [];
  for (const term of terms) {
    if (term.length < 3) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const res = grepProject(projectRoot, escaped, fs, { maxMatches: 12, maxFilesScan: 400 });
    if (!res.ok) continue;
    for (const m of res.matches || []) {
      const key = m.file.toLowerCase();
      if (seen.has(key)) continue;
      const norm = String(m.file || '').replace(/\\/g, '/');
      if (norm.includes('/') && !blob.toLowerCase().includes(norm.toLowerCase())) {
        continue;
      }
      if (!/\b(fix|polish|update|tweak|find|where|grep|search)\b/i.test(blob) && basePlan.length >= 2) {
        continue;
      }
      seen.add(key);
      added.push(m.file);
      if (added.length >= 2) break;
    }
    if (added.length >= 2) break;
  }

  return [...basePlan, ...added].slice(0, 4);
}

function applySearchReplace(content, oldString, newString) {
  const oldS = String(oldString ?? '');
  const newS = String(newString ?? '');
  if (!oldS) return { ok: false, error: 'old_string is empty' };
  const count = content.split(oldS).length - 1;
  if (count === 0) return { ok: false, error: 'old_string not found in file' };
  if (count > 1) return { ok: false, error: `old_string matched ${count} times — be more specific` };
  return { ok: true, content: content.replace(oldS, newS) };
}

function applyPatchToFile(projectRoot, relPath, oldString, newString, fs) {
  const file = resolveInProject(projectRoot, relPath);
  if (!fs.existsSync(file)) {
    return { ok: false, error: 'File does not exist' };
  }
  const before = fs.readFileSync(file, 'utf-8');
  const applied = applySearchReplace(before, oldString, newString);
  if (!applied.ok) return applied;
  return {
    ok: true,
    path: relPath,
    content: applied.content,
    beforeLength: before.length,
    afterLength: applied.content.length,
  };
}

module.exports = {
  grepProject,
  findFiles,
  enrichShipPlanFromSearch,
  extractSearchTerms,
  applyPatchToFile,
  applySearchReplace,
  resolveInProject,
};
