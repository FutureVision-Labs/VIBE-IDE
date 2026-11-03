/**
 * Bounded agent — one action per Gemini turn, sandboxed to project root.
 */

const path = require('path');
const { chatGemini } = require('./cloud-llm-client');
const { salvageProvideCodeBlockToolArgs } = require('./local-llm-client');
const {
  grepProject,
  findFiles,
  applyPatchToFile,
  applySearchReplace,
} = require('./project-search');

const DEFAULT_MAX_STEPS = 8;
const MAX_READ_CHARS = 12000;

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

function isBuildOrCreateGoal(goal) {
  const g = String(goal || '');
  if (goalSignalsIncrementalEdit(g)) return false;
  return (
    /\b(build|create|scaffold|make|landing|implement|write|generate|add|ship|design|page|site|rebuild)\b/i.test(g) ||
    /\b(landing page|one-page|homepage)\b/i.test(g)
  );
}

/** "styles.css only" polish — not a landing pair ship. */
function goalIsScopedSingleFileGoal(goal) {
  const g = String(goal || '').toLowerCase();
  if (!/\b(only|just)\b/.test(g)) return false;
  const namesHtml = /\bindex\.html\b/.test(g);
  const namesCss = /\bstyles\.css\b/.test(g);
  if (namesCss && !namesHtml) return true;
  if (namesHtml && !namesCss) return true;
  return false;
}

function normalizeWrittenPath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function goalExplicitlyWantsScriptJs(g) {
  const text = String(g || '').toLowerCase();
  if (/\b(not|without|skip|avoid)\s+script\.js\b/.test(text)) return false;
  if (/\b(?:write|add|ship|include|and)\s+script\.js\b/.test(text)) return true;
  if (/\bscript\.js\b|\bjavascript file\b/.test(text)) return true;
  return (
    /\b(interactiv|cta|scroll|button click)\b/.test(text) &&
    /\b(js|javascript)\b/.test(text) &&
    !/\blanding page\b/.test(text)
  );
}

function goalExpectedFiles(goal, orchestratedFile = '') {
  const of = normalizeWrittenPath(orchestratedFile).split('/').pop();
  if (of) return [of];

  const g = String(goal || '').toLowerCase();
  if (goalSignalsCssOnlyShip(goal)) {
    return ['styles.css'];
  }
  if (goalIsScopedSingleFileGoal(goal)) {
    return [];
  }

  const expected = [];

  const namesHtml = /\bindex\.html\b|\brebuild\s+html\b|\bhtml\s*(&|and)\s*styles|\bwrite\s+html\b/.test(g);
  const namesCss = /\bstyles\.css\b|\brebuild\s+css\b|\bhtml\s*(&|and)\s*css|\bstylesheet\b/.test(g);
  const wantsJs = goalExplicitlyWantsScriptJs(g);
  const fullPair =
    /\bfull landing\b|\bboth files\b|index\.html\s*\+\s*styles|\bhtml and styles\.css\b/.test(g);
  const scratchLanding =
    !wantsJs &&
    /\b(landing page|one-page|homepage|landing)\b/.test(g) &&
    /\b(build|create|scaffold|rebuild|from scratch|write)\b/.test(g);

  if (namesHtml || fullPair || scratchLanding) expected.push('index.html');
  if (namesCss || fullPair || scratchLanding) expected.push('styles.css');
  if (wantsJs) expected.push('script.js');

  return [...new Set(expected)];
}

function projectHasFile(projectRoot, relFile, fsModule) {
  if (!projectRoot || !fsModule || !relFile) return false;
  try {
    return fsModule.existsSync(path.join(projectRoot, relFile));
  } catch {
    return false;
  }
}

function requiresFreshLandingWrites(goal) {
  const g = String(goal || '').toLowerCase();
  if (/\brebuild\b|\bfrom scratch\b/.test(g)) return true;
  if (/\b(build|create|make|scaffold)\b/.test(g) && /\b(landing page|landing|homepage|one-page)\b/.test(g)) {
    return true;
  }
  return false;
}

function missingExpectedFiles(goal, sessionBrief, writtenPaths, projectRoot, fsModule, orchestratedFile = '') {
  const expected = goalExpectedFiles(goal, orchestratedFile);
  if (!expected.length) return [];
  const freshLanding = requiresFreshLandingWrites(goal);
  const written = (writtenPaths || []).map(normalizeWrittenPath);
  return expected.filter((f) => {
    if (written.some((w) => w === f || w.endsWith(`/${f}`))) return false;
    if (orchestratedFile) return true;
    if (!freshLanding && projectHasFile(projectRoot, f, fsModule)) return false;
    return true;
  });
}

/** First missing goal file — landing runs prefer index.html → styles.css → script.js */
function nextRequiredWriteFile(goal, sessionBrief, writtenPaths, projectRoot, fsModule, orchestratedFile = '') {
  const order = ['index.html', 'styles.css', 'script.js'];
  const missing = missingExpectedFiles(goal, sessionBrief, writtenPaths, projectRoot, fsModule, orchestratedFile);
  if (!missing.length) return null;
  for (const f of order) {
    if (missing.includes(f)) return f;
  }
  return missing[0];
}

function prematureLandingWriteMessage(relPath, goal, sessionBrief, writtenPaths, projectRoot, fsModule) {
  if (!requiresFreshLandingWrites(goal)) return null;
  const base = normalizeWrittenPath(relPath).split('/').pop() || '';
  if (!/^(script|main|app)\.(js|mjs|ts)$/i.test(base)) return null;
  const missing = missingExpectedFiles(goal, sessionBrief, writtenPaths, projectRoot, fsModule).filter(
    (f) => f === 'index.html' || f === 'styles.css'
  );
  if (!missing.length) return null;
  return `Landing goal still needs ${missing.join(' and ')} — write **${missing[0]}** next, not ${base} yet.`;
}

function buildMissingFilesToolResult(
  goal,
  sessionBrief,
  writtenPaths,
  projectRoot,
  fsModule,
  extra = '',
  orchestratedFile = '',
  parentGoal = ''
) {
  const missing = missingExpectedFiles(goal, sessionBrief, writtenPaths, projectRoot, fsModule, orchestratedFile);
  const next =
    orchestratedFile ||
    nextRequiredWriteFile(goal, sessionBrief, writtenPaths, projectRoot, fsModule, orchestratedFile);
  if (!missing.length) return null;
  const incremental = goalSignalsIncrementalEdit(goal, parentGoal);
  const why = orchestratedFile
    ? `Still need a full write of ${orchestratedFile}.`
    : `Goal still wants: ${missing.join(', ')}.`;
  let error = incremental
    ? `${why} Use **apply_patch** JSON with exact \`old_string\` / \`new_string\` from read_file — not provide_code_block or a partial stylesheet.`
    : `${why} Use provide_code_block or write_file with complete file body — not done.`;
  if (extra) error += ` ${extra}`;
  return { ok: false, error, missing, nextRequiredFile: next };
}

function incrementalPatchNudge(goal, parentGoal = '') {
  if (!goalSignalsIncrementalEdit(goal, parentGoal)) return '';
  return ' Next: **apply_patch** with exact strings from disk, or **done** with a chat summary if edits are already approved — never put farewell prose in styles.css comments.';
}

function allowlistedPathsWrittenThisRun(writtenPaths, allowedShipPaths) {
  if (!Array.isArray(allowedShipPaths) || !allowedShipPaths.length) return false;
  if (!Array.isArray(writtenPaths) || !writtenPaths.length) return false;
  const written = new Set(writtenPaths.map((p) => normalizeWrittenPath(p).toLowerCase()));
  return allowedShipPaths.every((p) => written.has(normalizeWrittenPath(p).toLowerCase()));
}

const INCREMENTAL_PATCH_TEXT_EXT =
  /\.(css|scss|sass|less|html?|js|mjs|cjs|jsx|tsx?|ts|vue|svelte|json|md|py|rb|go|rs|sql|yaml|yml|toml|xml|php)$/i;

function rejectIncrementalFullFileToolWrite(projectRoot, relPath, goal, parentGoal, fsModule) {
  if (!shouldTryPatchFirst(goal, relPath, projectRoot, fsModule, parentGoal)) return null;
  const base = normalizeWrittenPath(relPath).split('/').pop() || '';
  if (!INCREMENTAL_PATCH_TEXT_EXT.test(base)) return null;
  try {
    const file = resolveInProject(projectRoot, relPath);
    if (!fsModule.existsSync(file)) return null;
    if (fsModule.statSync(file).size < 600) return null;
    return (
      `**${relPath}** already exists (${Math.round(fsModule.statSync(file).size / 1024)}KB). ` +
      'Use **apply_patch** with exact old_string/new_string — not provide_code_block or write_file for the whole file.'
    );
  } catch {
    return null;
  }
}

function agentStallToolResult(
  goal,
  sessionBrief,
  writtenPaths,
  projectRoot,
  fsModule,
  orchestratedFile,
  parentGoal = ''
) {
  return (
    buildMissingFilesToolResult(
      goal,
      sessionBrief,
      writtenPaths,
      projectRoot,
      fsModule,
      '',
      orchestratedFile,
      parentGoal
    ) || {
      ok: false,
      error: goalSignalsIncrementalEdit(goal, parentGoal)
        ? `One JSON action only: apply_patch (preferred after read_file), read_file, or grep_project — not prose, not done.${incrementalPatchNudge(goal, parentGoal)}`
        : 'One action only: provide_code_block or write_file JSON with path + full content — not done, not prose.',
    }
  );
}

function pathOnShipAllowlist(relPath, allowedShipPaths) {
  if (!Array.isArray(allowedShipPaths) || !allowedShipPaths.length) return true;
  const got = normalizeWrittenPath(relPath).toLowerCase();
  return allowedShipPaths.some((p) => normalizeWrittenPath(p).toLowerCase() === got);
}

function rejectDestructiveFullRewrite(projectRoot, relPath, newContent, fsModule, goal, parentGoal = '') {
  if (!goalSignalsIncrementalEdit(goal, parentGoal)) return null;
  try {
    const file = resolveInProject(projectRoot, relPath);
    if (!fsModule.existsSync(file)) return null;
    const old = fsModule.readFileSync(file, 'utf-8');
    const next = String(newContent ?? '');
    if (old.length < 400 || next.length >= old.length * 0.72) return null;
    return (
      `Refusing full-file replace: **${relPath}** would shrink from ${old.length} to ${next.length} chars. ` +
      `Use **apply_patch** with exact \`old_string\` / \`new_string\` for small edits.`
    );
  } catch {
    return null;
  }
}

function rejectWritePathOrNull(
  relPath,
  goal,
  sessionBrief,
  writtenPaths,
  projectRoot,
  fsModule,
  baseStepFields,
  orchestratedFile = '',
  allowedShipPaths = null
) {
  if (Array.isArray(allowedShipPaths) && allowedShipPaths.length) {
    if (!pathOnShipAllowlist(relPath, allowedShipPaths)) {
      const block = `This run may only touch: ${allowedShipPaths.join(', ')} — not **${relPath}**.`;
      const toolResult = {
        ok: false,
        error: block,
        allowedShipPaths,
      };
      return {
        ...baseStepFields,
        action: 'write_file',
        reason: block,
        narration: block,
        toolResult,
        needsContinue: true,
      };
    }
    return null;
  }

  const want = normalizeWrittenPath(orchestratedFile).split('/').pop();
  if (want) {
    const got = normalizeWrittenPath(relPath).split('/').pop();
    if (got && got !== want) {
      const block = `This pass is only for **${want}**, not ${got}.`;
      const toolResult = buildMissingFilesToolResult(
        goal,
        sessionBrief,
        writtenPaths,
        projectRoot,
        fsModule,
        block,
        orchestratedFile
      );
      return {
        ...baseStepFields,
        action: 'write_file',
        reason: block,
        narration: block,
        toolResult,
        needsContinue: true,
      };
    }
    return null;
  }
  const block = prematureLandingWriteMessage(relPath, goal, sessionBrief, writtenPaths, projectRoot, fsModule);
  if (!block) return null;
  const toolResult = buildMissingFilesToolResult(goal, sessionBrief, writtenPaths, projectRoot, fsModule, block);
  return {
    ...baseStepFields,
    action: 'write_file',
    reason: block,
    narration: block,
    toolResult,
    needsContinue: true,
  };
}

function looksTruncatedDoneMessage(message) {
  const t = String(message || '').trim();
  if (t.length < 25) return false;
  if (/[.!?…"']$/.test(t)) return false;
  if (/\b(since we|and then|next i|now let|let's|we still|also need)$/i.test(t)) return true;
  return t.length > 80 && !/[.!?]$/.test(t.slice(-1));
}

function looksLikeProseWithoutAction(text) {
  const t = String(text || '').trim();
  if (!t || t.startsWith('{')) return false;
  if (tryParseAgentObject(t)) return false;
  return /[a-zA-Z]{4,}/.test(t) && !/"action"\s*:/.test(t);
}

function buildAgentSystemPrompt(
  projectRoot,
  goal,
  stepIndex,
  maxSteps,
  recallContext = '',
  personaContext = '',
  projectSnapshot = '',
  sessionBrief = '',
  writtenPaths = [],
  fsModule = null,
  forceWritePath = '',
  orchestratedFile = '',
  allowedShipPaths = null,
  parentGoal = ''
) {
  const singleFile = normalizeWrittenPath(orchestratedFile).split('/').pop() || '';
  let prompt = `You are **Cursy** — warm, playful coding co-organiser in VIBE IDE (Team DC energy: encouraging, clear, not a dry robot).
Speak to the user in your "reason" field: short, friendly, 1–2 sentences per step.

Project root (paths relative): ${projectRoot}
User goal: ${goal}
Step ${stepIndex + 1} of ${maxSteps}.

## Actions (one per turn)

**File writes (preferred):** call **provide_code_block** with filePath, code, language. User approves before disk write.

**Or JSON in a \`\`\`json fence** for read/list/done/writes:
- list_dir — {"action":"list_dir","path":".","reason":"Cursy-voice why"}
- read_file — {"action":"read_file","path":"index.html","reason":"…"}
- grep_project — {"action":"grep_project","pattern":"hero-title","reason":"…"} (regex, project-wide)
- find_files — {"action":"find_files","query":"styles.css","reason":"…"} (filename substring)
- apply_patch — {"action":"apply_patch","path":"styles.css","old_string":"…exact…","new_string":"…","reason":"…"} (one unique match)
- write_file — {"action":"write_file","path":"index.html","content":"…full file…","reason":"…"}
- done — {"action":"done","message":"warm summary for the user"} — **summary only, no code, no fences**

**Never** put \`"action":"provide_code_block"\` in JSON — that name is **only** for the tool API. If tools fail, use write_file with path + content.
**Never** bundle file code inside a **done** message. Ship files on a write step first; then **done** on the next turn.

Every action MUST include "reason" in Cursy's voice (not "listing directory").

## Exploration budget (important)
- Prefer **grep_project** / **find_files** before blind list/read when hunting symbols or paths.
- Max **one** list_dir, **two** read_file, and **two** grep_project per run unless debugging unknown code.
- Prefer **apply_patch** for small edits when the file already exists; use full write_file only for new files or big rewrites.
- When a file **already exists**, **read_file** (or grep) before a full rewrite so you edit what is on disk, not a guess.
- For build/create/landing/scaffold goals: **write files by step 2–3**. Do not spend all steps exploring.
- If a project snapshot is below, **do not list_dir** the root again unless you need a subfolder.

Paths: relative only. Never \`..\` or absolute paths.
When files are written or the goal is satisfied, use **done** with a celebratory but concise summary.

If a **Session creative brief** appears below, it is **binding**: match the agreed vibe name, color palette, section outline, and CTAs (e.g. waitlist). Do **not** swap in a generic or different theme.

Use **done** only when every file **named in the user goal** is written this run. For **build/create/rebuild … landing page** goals, you must write **index.html** and **styles.css** in this run (existing copies on disk do not count).

If the brief says the project is a **game**, HTML copy must sell **the game** to players — not unrelated generic marketing filler.`;

  if (singleFile) {
    prompt += `\n\n## Single-file pass (orchestrated)\nPropose **${singleFile}** only — full source via **provide_code_block** (\`code\` field must contain the **entire file**) or **write_file** with \`content\`. Do **not** use **done** until that file is proposed. No other paths. Prefer the session brief over re-listing the folder.\n**Never** send an empty \`code\` / \`content\` with only a cheerful \`reason\` — the IDE rejects hype-only steps.`;
  }

  if (Array.isArray(allowedShipPaths) && allowedShipPaths.length && !singleFile) {
    const incremental = goalSignalsIncrementalEdit(goal, parentGoal);
    const patchFirstMode = allowlistUsesPatchFirstMode(
      goal,
      parentGoal,
      allowedShipPaths,
      projectRoot,
      fsModule
    );
    const cssOnlyShip = goalSignalsCssOnlyShip(goal, parentGoal);
    const htmlLookupForCss = goalHtmlReadOnlyForCssImplement(goal, parentGoal);
    prompt += `\n\n## Write allowlist (hard limit)\nYou may **only** patch/write these paths this run: ${allowedShipPaths.map((p) => `\`${p}\``).join(', ')}.\nDo **not** list_dir the whole repo, touch \`game/\`, journals, or other folders.`;
    if (htmlLookupForCss) {
      prompt += `\nYou **may** \`read_file\` / \`grep_project\` on **index.html** to collect class names — then patch **styles.css** only. Do **not** patch or rewrite HTML.`;
    }
    if (patchFirstMode) {
      prompt += `\n**Patch-first (existing file):** use **apply_patch** with exact old_string/new_string — do **not** replace the whole file via write_file / provide_code_block unless a patch fails twice. Then **done**.`;
      if (cssOnlyShip && !htmlLookupForCss) {
        prompt += `\n**CSS-only run:** touch **styles.css** only — do **not** read or patch index.html unless the goal asks you to check markup for selectors.`;
      }
    } else if (incremental) {
      prompt += `\n**Scoped edit:** prefer **apply_patch** on existing files; use **provide_code_block** / **write_file** (full file) when the goal is a rebuild, new file, or the on-disk file is missing/stub.`;
    } else {
      prompt += `\nPrefer **apply_patch** on existing files when making small edits; use full **write_file** / **provide_code_block** for new files or complete rewrites.`;
    }
  }

  const missing = missingExpectedFiles(goal, sessionBrief, writtenPaths, projectRoot, fsModule, orchestratedFile);
  if (writtenPaths?.length) {
    prompt += `\n\n## Written this run\n${writtenPaths.map(normalizeWrittenPath).join(', ')}`;
  }
  if (!singleFile && missing.length && isBuildOrCreateGoal(goal)) {
    const next = nextRequiredWriteFile(goal, sessionBrief, writtenPaths, projectRoot, fsModule, orchestratedFile);
    prompt += `\n\n## Still required before done\n${missing.join(', ')}`;
    if (next) {
      prompt += `\n**Next write:** \`${next}\` (full file).`;
    }
  } else if (!singleFile && goalExpectedFiles(goal, orchestratedFile).length === 0 && isBuildOrCreateGoal(goal)) {
    prompt += `\n\n## Note\nGoal does not name specific files — ship what the goal describes, then **done**.`;
  }

  if (sessionBrief && String(sessionBrief).trim()) {
    prompt += `\n\n## Session creative brief (BINDING — must follow)\n${String(sessionBrief).trim()}`;
  }

  if (personaContext && String(personaContext).trim()) {
    prompt += `\n\n## Persona\n${String(personaContext).trim()}`;
  }
  if (projectSnapshot && String(projectSnapshot).trim()) {
    prompt += `\n\n## Project snapshot (already listed)\n${String(projectSnapshot).trim()}`;
  }
  if (recallContext && String(recallContext).trim()) {
    prompt += `\n\n## Project Recall\n${String(recallContext).trim()}`;
  }

  const forcePath = (forceWritePath && String(forceWritePath).trim()) || singleFile;
  const incrementalScoped =
    Array.isArray(allowedShipPaths) &&
    allowedShipPaths.length &&
    !singleFile &&
    allowlistUsesPatchFirstMode(goal, parentGoal, allowedShipPaths, projectRoot, fsModule);
  if (forcePath && !incrementalScoped) {
    prompt += `\n\n**Write this turn:** \`${forcePath}\` — complete file body via provide_code_block or write_file.`;
  } else if (forcePath && incrementalScoped) {
    prompt += `\n\n**Target file:** \`${forcePath}\` — use **grep_project** / **read_file** then **apply_patch** only; do not full-rewrite.`;
  }

  if (stepIndex >= maxSteps - 2) {
    const next = nextRequiredWriteFile(goal, sessionBrief, writtenPaths, projectRoot, fsModule, orchestratedFile);
    if (next && isBuildOrCreateGoal(goal)) {
      prompt += `\n\n⚠️ **Step budget almost gone.** Next action MUST be a full write of **${next}** — no done until that file is proposed.`;
    } else {
      prompt += `\n\n⚠️ **Step budget almost gone.** Next action MUST be provide_code_block, write_file with full content, or done — no more list/read.`;
    }
  } else if (stepIndex >= 2 && isBuildOrCreateGoal(goal)) {
    prompt += `\n\n📌 **Write now.** You have context; propose real file(s) via provide_code_block this turn.`;
  }

  return prompt;
}

function unescapeJsonStringPartial(raw) {
  let s = String(raw || '');
  s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\"/g, '"');
  s = s.replace(/\\\\/g, '\\');
  s = s.replace(/"\s*}\s*$/, '').replace(/"\s*$/, '');
  return s.trim();
}

function salvagePartialProvideCodeBlockJson(block) {
  const blob = String(block || '');
  if (!/provide_code_block|write_file|"code"\s*:/i.test(blob)) return null;
  const fp =
    blob.match(/"filePath"\s*:\s*"([^"]+)"/i) || blob.match(/"path"\s*:\s*"([^"]+)"/i);
  if (!fp) return null;
  const codeMatch =
    blob.match(/"code"\s*:\s*"([\s\S]*)/i) || blob.match(/"content"\s*:\s*"([\s\S]*)/i);
  if (!codeMatch) return null;
  const code = unescapeJsonStringPartial(codeMatch[1]);
  if (code.length < 8) return null;
  const langMatch = blob.match(/"language"\s*:\s*"([^"]+)"/i);
  return {
    path: fp[1],
    content: code,
    language: langMatch?.[1] || 'text',
    fromTool: /provide_code_block/i.test(blob),
  };
}

function inferFenceLanguageForPath(relPath) {
  const p = String(relPath || '').toLowerCase();
  if (p.endsWith('.css') || p.endsWith('.scss')) return 'css';
  if (p.endsWith('.html') || p.endsWith('.htm')) return 'html';
  if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return 'javascript';
  if (p.endsWith('.ts') || p.endsWith('.tsx')) return 'typescript';
  if (p.endsWith('.json')) return 'json';
  return null;
}

function preferFenceFirstForPath(relPath) {
  const p = String(relPath || '').toLowerCase();
  return /\.(css|scss|sass|less|html?|js|mjs|cjs|tsx?|json|svg)$/.test(p);
}

function braceDepth(text) {
  let depth = 0;
  for (const ch of String(text || '')) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
  }
  return depth;
}

function isTokenLimitFinish(finishReason) {
  const r = String(finishReason || '').toUpperCase();
  if (!r) return false;
  return r === 'LENGTH' || r === 'MAX_TOKENS' || r === 'MAX_OUTPUT_TOKENS' || r.includes('MAX_TOKEN');
}

/** CSS outside block comments (rough strip for chat-in-comment detection). */
function cssOutsideBlockComments(text) {
  return String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

/** Model sometimes patches a comment to Cursy farewell prose instead of using action done. */
function isChattyCssCommentFragment(fragment) {
  const t = String(fragment || '').trim();
  if (!t.includes('/*')) return false;
  const outside = cssOutsideBlockComments(t);
  if (outside && /[{;]/.test(outside)) return false;
  const blocks = t.match(/\/\*[\s\S]*?\*\//g) || [];
  for (const block of blocks) {
    const inner = block.replace(/^\/\*+|\*+\/$/g, '').trim();
    if (inner.length < 45) continue;
    if (
      /\b(you must be|how about|take a peek|preview to see|preview and see|thrilled|delightful|goodness in action|shimmering with|come to life|in action\?|bubblegum pop pastel|bubbly goodness)\b/i.test(
        inner
      )
    ) {
      return true;
    }
  }
  return false;
}

function rejectChattyCssPatchFragment(relPath, fragment) {
  if (!/\.css$/i.test(String(relPath || ''))) return null;
  if (isChattyCssCommentFragment(fragment)) {
    return 'That change is chat prose in a CSS comment, not styling. Use {"action":"done","message":"…"} — never put farewells in styles.css.';
  }
  return null;
}

function rejectChattyCssFileBody(relPath, body) {
  if (!/\.css$/i.test(String(relPath || ''))) return null;
  const blocks = String(body || '').match(/\/\*[\s\S]*?\*\//g) || [];
  for (const block of blocks) {
    if (isChattyCssCommentFragment(block)) {
      return 'Stylesheet has chat prose in a comment block. Reject and use **done** for summaries only — not styles.css.';
    }
  }
  return null;
}

/** Existing styles.css much larger than draft → likely mid-file token cut (even if braces balance). */
function cssDraftLooksPartialVsDisk(projectRoot, relPath, body, fsModule) {
  if (!/styles?\.css$/i.test(String(relPath || ''))) return false;
  try {
    const file = resolveInProject(projectRoot, relPath);
    if (!fsModule.existsSync(file)) return false;
    const old = fsModule.readFileSync(file, 'utf-8');
    if (old.length < 800) return false;
    const next = String(body || '').trim();
    if (!next) return true;
    if (next.length < old.length * 0.72) return true;
    const oldRules = (old.match(/\{[^{}]*\}/g) || []).length;
    const newRules = (next.match(/\{[^{}]*\}/g) || []).length;
    if (oldRules > 12 && newRules < Math.max(8, Math.floor(oldRules * 0.55))) return true;
    const oldLines = old.split('\n').length;
    const newLines = next.split('\n').length;
    if (oldLines > 100 && newLines < Math.floor(oldLines * 0.65)) return true;
  } catch {
    return false;
  }
  return false;
}

/** Block approving writes that are obviously cut off (LM length / salvaged tool JSON). */
function isIncompleteWriteContent(content, targetFile, meta = {}) {
  const body = String(content || '').trim();
  if (!body) return true;
  const { finishReason, salvagedTool } = meta;
  if (isTokenLimitFinish(finishReason)) return true;

  const base = String(targetFile || '')
    .split('/')
    .pop()
    .toLowerCase();

  if (base.endsWith('.css') || base.endsWith('.scss') || base.endsWith('.sass')) {
    if (braceDepth(body) !== 0) return true;
    if (/[\{\:]\s*$/.test(body)) return true;
    const lastOpenComment = body.lastIndexOf('/*');
    const lastCloseComment = body.lastIndexOf('*/');
    if (lastOpenComment >= 0 && lastOpenComment > lastCloseComment) return true;
  }

  if (base.endsWith('.html') || base.endsWith('.htm')) {
    if (/<html[\s>]/i.test(body) && !/<\/html>\s*$/i.test(body)) return true;
  }

  if ((base.endsWith('.js') || base.endsWith('.mjs') || base.endsWith('.cjs')) && salvagedTool) {
    if (braceDepth(body) !== 0) return true;
  }

  if (salvagedTool && (base.endsWith('.css') || base.endsWith('.scss'))) {
    if (braceDepth(body) !== 0) return true;
  }

  return false;
}

/**
 * Single gate for agent approve + disk commit — fixes half-stylesheet via agent loop (was only on proposeSingleFileWrite).
 */
function evaluateWriteForApproval(projectRoot, relPath, content, fsModule, options = {}) {
  const { finishReason, salvagedTool, goal = '', parentGoal = '' } = options;
  const body = String(content ?? '');
  const meta = { finishReason, salvagedTool };

  if (isIncompleteWriteContent(body, relPath, meta)) {
    return {
      allowed: false,
      incomplete: true,
      truncated: isTokenLimitFinish(finishReason) || !!salvagedTool,
      error:
        'File body looks incomplete (token limit, unclosed CSS, or cut-off syntax). Not safe to approve — retry with a smaller scope or patch.',
    };
  }

  if (!options.patchApply && cssDraftLooksPartialVsDisk(projectRoot, relPath, body, fsModule)) {
    return {
      allowed: false,
      incomplete: true,
      truncated: true,
      error:
        'styles.css draft is much smaller than the file on disk — likely a partial rewrite. Use apply_patch with exact old_string/new_string from read_file — not a full-file tool write.',
    };
  }

  const chattyCss = rejectChattyCssFileBody(relPath, body);
  if (chattyCss) {
    return { allowed: false, error: chattyCss };
  }

  const shrinkBlock = rejectDestructiveFullRewrite(
    projectRoot,
    relPath,
    body,
    fsModule,
    goal,
    parentGoal
  );
  if (shrinkBlock) {
    return { allowed: false, error: shrinkBlock };
  }

  return { allowed: true };
}

function blockWriteApprovalStep(stepBase, relPath, content, projectRoot, fsModule, writeOpts) {
  const ev = evaluateWriteForApproval(projectRoot, relPath, content, fsModule, writeOpts);
  if (ev.allowed) return null;
  return {
    ...stepBase,
    toolResult: { ok: false, error: ev.error },
    needsContinue: true,
    incomplete: !!ev.incomplete,
    truncated: !!ev.truncated,
    error: ev.error,
  };
}

function mergeWriteContinuation(prefix, suffixRaw) {
  const prefixStr = String(prefix || '');
  let suffix = String(suffixRaw || '').trim();
  if (!suffix) return prefixStr;
  const maxOverlap = Math.min(120, prefixStr.length, suffix.length);
  for (let n = maxOverlap; n > 20; n -= 1) {
    const tail = prefixStr.slice(-n);
    if (suffix.startsWith(tail)) {
      suffix = suffix.slice(n);
      break;
    }
  }
  return prefixStr + suffix;
}

/** Model often puts the real file in a markdown fence while tool JSON is empty. */
function extractMarkdownFenceForTarget(raw, targetPath) {
  const text = String(raw || '');
  const rel = String(targetPath || '').trim();
  if (!text.trim()) return null;
  const wantLang = inferFenceLanguageForPath(rel);
  const re = /```(\w+)?\s*\n([\s\S]*?)```/gi;
  let best = null;
  let m;
  while ((m = re.exec(text)) !== null) {
    const lang = (m[1] || '').toLowerCase();
    const code = m[2].trim();
    if (code.length < 24) continue;
    if (wantLang && (lang === wantLang || (wantLang === 'html' && lang === 'htm'))) {
      return { path: rel, content: code, language: lang };
    }
    if (!best || code.length > best.content.length) {
      best = { path: rel, content: code, language: lang || wantLang || 'text' };
    }
  }
  const open = text.match(/```(\w+)?\s*\n([\s\S]+)$/i);
  if (open) {
    const code = open[2].trim();
    if (code.length >= 24) {
      return { path: rel, content: code, language: (open[1] || wantLang || 'text').toLowerCase() };
    }
  }
  return best;
}

function fillWritePayloadFromLlmContent(writePayload, llmContent, preferredPath) {
  if (!writePayload || writePayload.content?.trim()) return writePayload;
  const target = preferredPath || writePayload.path;
  const fromSalvage = salvageWriteFromContent(llmContent);
  if (fromSalvage?.content?.trim()) {
    return {
      ...writePayload,
      path: target || fromSalvage.path,
      content: fromSalvage.content,
    };
  }
  const fromFence = extractMarkdownFenceForTarget(llmContent, target);
  if (fromFence?.content?.trim()) {
    return {
      ...writePayload,
      path: target || fromFence.path,
      content: fromFence.content,
      language: fromFence.language,
    };
  }
  return writePayload;
}

function salvageWriteFromContent(content) {
  const text = String(content || '');
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fenceRe.exec(text)) !== null) {
    const block = match[1].trim();
    try {
      const obj = JSON.parse(block);
      const w = pendingWriteFromParsed(obj);
      if (w?.content?.trim()) return w;
    } catch {
      const partial = salvagePartialProvideCodeBlockJson(block);
      if (partial) return partial;
    }
  }
  const open = text.match(/```(?:json)?\s*([\s\S]+)$/i);
  if (open) {
    const partial = salvagePartialProvideCodeBlockJson(open[1].trim());
    if (partial) return partial;
  }
  return null;
}

function stripAgentPayloadFromMessage(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/```[\s\S]*$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tryParseAgentObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const candidates = [];
  if (raw.startsWith('{')) candidates.push(raw);
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace && brace[0] !== raw) candidates.push(brace[0]);

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fm;
  while ((fm = fenceRe.exec(raw)) !== null) {
    candidates.push(fm[1].trim());
  }

  for (const cand of candidates) {
    if (!cand || !cand.includes('"action"')) continue;
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj.action === 'string') return obj;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

function parseAgentJson(content) {
  const text = String(content || '').trim();

  const direct = tryParseAgentObject(text);
  if (direct) return direct;

  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const fm of fences) {
    const partial = salvagePartialProvideCodeBlockJson(fm[1].trim());
    if (partial) {
      return {
        action: 'write_file',
        filePath: partial.path,
        code: partial.content,
        language: partial.language,
        reason: 'Recovered a file proposal from JSON in chat.',
      };
    }
  }
  const salvaged = salvageWriteFromContent(text);
  if (salvaged) {
    return {
      action: 'write_file',
      filePath: salvaged.path,
      code: salvaged.content,
      language: salvaged.language,
      reason: 'Recovered a file proposal (JSON was truncated or wrapped in prose).',
    };
  }
  if (text.length > 0) {
    if (looksLikeProseWithoutAction(text)) {
      return { action: '_prose', message: text };
    }
    const reparsed = tryParseAgentObject(stripAgentPayloadFromMessage(text) || text);
    if (reparsed && String(reparsed.action).toLowerCase() !== 'done') return reparsed;
    // Never treat ambiguous model output as success — local models "chat" instead of acting.
    return { action: '_no_action', message: stripAgentPayloadFromMessage(text) || text };
  }
  return { action: '_no_action', message: 'No parseable agent action.' };
}

/** Model sometimes JSON-ifies provide_code_block instead of calling the tool. */
function pendingWriteFromParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const action = String(parsed.action || '').toLowerCase();
  const isWrite =
    action === 'write_file' ||
    action === 'write' ||
    action === 'provide_code_block' ||
    action === 'code_block';
  if (!isWrite) return null;

  const relPath = parsed.filePath || parsed.path || parsed.file;
  if (!relPath) return null;

  const content =
    parsed.code != null
      ? String(parsed.code)
      : parsed.content != null
        ? String(parsed.content)
        : '';

  return {
    path: String(relPath).trim(),
    content,
    language: parsed.language || 'text',
    fromTool: action === 'provide_code_block',
  };
}

function executeListDir(projectRoot, relPath, fs) {
  const dir = resolveInProject(projectRoot, relPath || '.');
  if (!fs.existsSync(dir)) {
    return { ok: false, error: 'Directory not found', path: relPath || '.' };
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const items = entries.slice(0, 200).map((e) => ({
    name: e.name,
    type: e.isDirectory() ? 'dir' : 'file',
  }));
  return { ok: true, path: relPath || '.', items };
}

/** Paths the user mentioned for lookup (read-only context), not necessarily on the write allowlist. */
function extractContextReadPathsFromGoal(goal, parentGoal, writeAllowlist = []) {
  const blob = combinedGoalText(goal, parentGoal);
  const writeSet = new Set(
    (writeAllowlist || []).map((p) => normalizeWrittenPath(p).toLowerCase()).filter(Boolean)
  );
  const readIntent =
    /\b(check|read|inspect|look at|grep|scan|open|use|from|match|find)\b/i.test(blob) ||
    /\b(classes|class names|selectors|symbols|types|imports)\b/i.test(blob);
  if (!readIntent) return [];

  const paths = [];
  const pathRe =
    /\b([a-zA-Z0-9_][a-zA-Z0-9_./-]*\.(?:html?|css|scss|sass|less|js|mjs|cjs|jsx|tsx?|ts|vue|svelte|json|md|py|rb|go|rs|sql|yaml|yml|toml|xml|php|rb))\b/g;
  let m;
  while ((m = pathRe.exec(blob)) !== null) {
    const rel = normalizeWrittenPath(m[1]);
    const key = rel.toLowerCase();
    if (writeSet.has(key)) continue;
    if (paths.some((p) => p.toLowerCase() === key)) continue;
    paths.push(rel);
  }
  return paths.slice(0, 2);
}

/** Step-0 prefetch: allowlisted patch targets + optional context files named in the goal. */
function bootstrapPathsForIncrementalEdit(projectRoot, goal, parentGoal, allowedShipPaths, fsModule) {
  if (!Array.isArray(allowedShipPaths) || !allowedShipPaths.length) return [];
  const seen = new Set();
  const out = [];
  const push = (rel) => {
    const n = normalizeWrittenPath(rel);
    const k = n.toLowerCase();
    if (!n || seen.has(k)) return;
    if (!projectHasFile(projectRoot, n, fsModule)) return;
    seen.add(k);
    out.push(n);
  };
  for (const p of extractContextReadPathsFromGoal(goal, parentGoal, allowedShipPaths)) {
    push(p);
  }
  for (const p of allowedShipPaths) {
    push(p);
  }
  return out.slice(0, 4);
}

function shouldBootstrapIncrementalRead(
  goal,
  parentGoal,
  allowedShipPaths,
  lastToolResult,
  stepIndex,
  history,
  projectRoot,
  fsModule
) {
  if (stepIndex !== 0 || lastToolResult || (history && history.length)) return false;
  if (!goalSignalsIncrementalEdit(goal, parentGoal)) return false;
  if (!Array.isArray(allowedShipPaths) || !allowedShipPaths.length || allowedShipPaths.length > 4) {
    return false;
  }
  return bootstrapPathsForIncrementalEdit(projectRoot, goal, parentGoal, allowedShipPaths, fsModule).length > 0;
}

function executeBootstrapReads(projectRoot, relPaths, fsModule, writeAllowlist = []) {
  const files = [];
  for (const rel of relPaths) {
    const r = executeReadFile(projectRoot, rel, fsModule);
    if (r.ok && r.content != null) {
      files.push({ path: r.path || rel, content: r.content });
    }
  }
  if (!files.length) return { ok: false, error: 'No readable bootstrap files on disk.' };
  const allow = new Set(
    (writeAllowlist || []).map((p) => normalizeWrittenPath(p).toLowerCase()).filter(Boolean)
  );
  const primary =
    files.find((f) => allow.has(normalizeWrittenPath(f.path).toLowerCase())) || files[files.length - 1];
  return {
    ok: true,
    prefetched: true,
    path: primary.path,
    content: primary.content,
    files,
    writeAllowlist: [...allow],
    chars: files.reduce((n, f) => n + String(f.content).length, 0),
  };
}

function executeReadFile(projectRoot, relPath, fs) {
  const file = resolveInProject(projectRoot, relPath);
  if (!fs.existsSync(file)) {
    return { ok: false, error: 'File not found', path: relPath };
  }
  const stat = fs.statSync(file);
  if (stat.isDirectory()) {
    return { ok: false, error: 'Path is a directory', path: relPath };
  }
  if (stat.size > 512 * 1024) {
    return { ok: false, error: 'File too large to read', path: relPath };
  }
  let content = fs.readFileSync(file, 'utf-8');
  if (content.length > MAX_READ_CHARS) {
    content = content.slice(0, MAX_READ_CHARS) + '\n… [truncated]';
  }
  return { ok: true, path: relPath, content };
}

function executeGrepProject(projectRoot, pattern, fs) {
  return grepProject(projectRoot, pattern, fs, { maxMatches: 35 });
}

function executeFindFiles(projectRoot, query, fs) {
  return findFiles(projectRoot, query, fs, { maxResults: 40 });
}

function combinedGoalText(goal, parentGoal = '') {
  return [goal, parentGoal].filter(Boolean).join('\n');
}

/** User asked for a clean-slate rewrite — skip patch-first and optional read context. */
function isFullRewriteGoal(goal, parentGoal = '') {
  const blob = combinedGoalText(goal, parentGoal);
  if (
    /\b(write|generate|create|ship|rebuild|scaffold)\b/i.test(blob) &&
    /\b(styles?\.css|stylesheet)\b/i.test(blob) &&
    !/\b(only|polish|patch|tweak)\s+(the\s+)?(styles?\.css|stylesheet)\b/i.test(blob) &&
    !/\bstyles?\.css\s+only\b/i.test(blob)
  ) {
    return true;
  }
  if (/\bfull\b/i.test(blob) && /\b(styles?\.css|stylesheet)\b/i.test(blob)) return true;
  if (/\bper (the )?(plan|outline|brief)\b/i.test(blob) && /\b(styles?\.css|write)\b/i.test(blob)) {
    return true;
  }
  return /\b(rebuild|from scratch|full file|rewrite entire|scaffold|create new|generate from|brand new|replace whole)\b/i.test(
    blob
  );
}

/** Obliterated or stub CSS — patch-first cannot help; generate full file. */
function cssFileNeedsFullRewrite(projectRoot, targetFile, fsModule) {
  if (!/styles?\.css$/i.test(String(targetFile || ''))) return false;
  try {
    const file = resolveInProject(projectRoot, targetFile);
    if (!fsModule.existsSync(file)) return true;
    const content = fsModule.readFileSync(file, 'utf-8');
    if (content.trim().length < 400) return true;
    const ruleBlocks = (content.match(/\{[^{}]*\}/g) || []).length;
    if (ruleBlocks < 10) return true;
  } catch {
    return false;
  }
  return false;
}

/** Mirror renderer isScopedEditRequest — small layout/CSS tweaks, not theme reboots. */
function goalHtmlReadOnlyForCssImplement(goal, parentGoal = '') {
  const g = combinedGoalText(goal, parentGoal).toLowerCase();
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

function goalSignalsCssOnlyShip(goal, parentGoal = '') {
  const g = combinedGoalText(goal, parentGoal).toLowerCase();
  if (goalHtmlReadOnlyForCssImplement(goal, parentGoal)) return true;
  const wantsHtml =
    /\b(index\.html|\.html\b|markup|structure|the html|html file)\b/.test(g) &&
    !/\b(no html|not html|don't touch html|without html|css only|stylesheet only)\b/.test(g);
  if (wantsHtml) return false;
  if (/\bstyles?\.css\b/.test(g) && !/\bindex\.html\b/.test(g) && /\b(css only|stylesheet only|do not edit index)\b/.test(g)) {
    return true;
  }
  if (/\b(edit|update|fix|apply|polish|change|tweak)\s+(the\s+)?(css|stylesheet)\b/.test(g)) return true;
  if (
    /\b(the\s+)?css\b/.test(g) &&
    /\b(those fixes|these fixes|with those|styles\.css only|do not edit index)\b/.test(g)
  ) {
    return true;
  }
  return false;
}

function goalSignalsScopedHarnessEdit(goal, parentGoal = '') {
  const m = combinedGoalText(goal, parentGoal).toLowerCase();
  if (goalSignalsCssOnlyShip(goal, parentGoal)) return true;
  if (/\b(only|just|don't change|do not change|keep the theme|without changing|same theme)\b/.test(m)) {
    return true;
  }
  if (
    /\b(fix|adjust|make|put|change|tweak|so the|can you|could you|want the)\b/.test(m) &&
    /\b(features|feature|nav|hero|grid|card|cards|footer|header|section|layout|waitlist|button|squid|spacing)\b/.test(
      m
    )
  ) {
    return true;
  }
  return false;
}

/** Polish / fix / single-file style goals — prefer patches over blind full regen. */
function goalSignalsIncrementalEdit(goal, parentGoal = '') {
  const blob = combinedGoalText(goal, parentGoal);
  if (isFullRewriteGoal(goal, parentGoal)) return false;
  const userLead = String(goal || '').split(/\n\n\[/)[0].trim();
  if (
    /\b@agent\s+write\b/i.test(userLead) ||
    /\bwrite\s+(the\s+)?(full\s+)?styles?\.css\b/i.test(userLead)
  ) {
    return false;
  }
  if (goalSignalsScopedHarnessEdit(goal, parentGoal)) return true;
  return /\b(polish|fix|tweak|update|refresh|adjust|change|improve|patch|only|per chat|match)\b/i.test(blob);
}

function existingFileContextBlock(projectRoot, targetFile, fsModule, goal, parentGoal = '') {
  try {
    const file = resolveInProject(projectRoot, targetFile);
    if (!fsModule.existsSync(file)) return '';
    if (isFullRewriteGoal(goal, parentGoal)) return '';
    const st = fsModule.statSync(file);
    if (st.size < 40) return '';
    let content = fsModule.readFileSync(file, 'utf-8');
    const cap = 12000;
    if (content.length > cap) {
      content = `${content.slice(0, cap)}\n… [truncated for context]`;
    }
    return (
      `Existing **${targetFile}** on disk (read before write). Return the **full** updated file. ` +
      `Preserve structure and content the goal does not ask to change.\n\`\`\`\n${content}\n\`\`\``
    );
  } catch {
    return '';
  }
}

function userExplicitFullFileWrite(goal, parentGoal = '') {
  const blob = combinedGoalText(goal, parentGoal);
  if (/\b@agent\s+write\b/i.test(blob)) return true;
  if (/\b(write|generate|create|ship|rebuild|replace|implement)\s+(the\s+)?(full|complete|entire|whole)\b/i.test(blob)) {
    return true;
  }
  if (/\bfrom scratch\b|\bbrand new\b|\bnew file\b|\bscaffold\b/i.test(blob)) return true;
  return isFullRewriteGoal(goal, parentGoal);
}

/** Existing file + scoped goal → patch-first; new/rebuild/full-write goals → full file tools. */
function shouldTryPatchFirst(goal, targetFile, projectRoot, fsModule, parentGoal = '') {
  if (userExplicitFullFileWrite(goal, parentGoal)) return false;
  if (isFullRewriteGoal(goal, parentGoal)) return false;
  if (!goalSignalsIncrementalEdit(goal, parentGoal)) return false;
  if (cssFileNeedsFullRewrite(projectRoot, targetFile, fsModule)) return false;
  try {
    const file = resolveInProject(projectRoot, targetFile);
    if (!fsModule.existsSync(file)) return false;
    const st = fsModule.statSync(file);
    if (st.size < 80) return false;
    return true;
  } catch {
    return false;
  }
}

/** Server-side auto-patch (replacements / single apply_patch) — not for builds or full rewrites. */
function allowlistUsesPatchFirstMode(goal, parentGoal, allowedShipPaths, projectRoot, fsModule) {
  if (!Array.isArray(allowedShipPaths) || !allowedShipPaths.length || allowedShipPaths.length > 2) {
    return false;
  }
  if (userExplicitFullFileWrite(goal, parentGoal)) return false;
  if (isBuildOrCreateGoal(goal) && !goalSignalsIncrementalEdit(goal, parentGoal)) return false;
  const primary = allowedShipPaths[0];
  return shouldTryPatchFirst(goal, primary, projectRoot, fsModule, parentGoal);
}

function shouldUseHarnessServerPatch(goal, parentGoal, allowedShipPaths, projectRoot, fsModule) {
  return allowlistUsesPatchFirstMode(goal, parentGoal, allowedShipPaths, projectRoot, fsModule);
}

function parsePatchReplacementsJson(blob) {
  const text = String(blob || '');
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let jsonText = fence ? fence[1].trim() : text.trim();
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let parsed = tryParse(jsonText);
  if (!parsed) {
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start >= 0 && end > start) parsed = tryParse(jsonText.slice(start, end + 1));
  }
  if (!parsed) return null;
  const reps = parsed.replacements || parsed.patches;
  return Array.isArray(reps) && reps.length ? reps : null;
}

async function tryPatchFirstWrite(
  userDataPath,
  fsModule,
  {
    projectRoot,
    targetFile,
    goal,
    parentGoal = '',
    sessionBrief,
    maxTokens,
    simple = false,
    continuation = false,
  }
) {
  const file = resolveInProject(projectRoot, targetFile);
  let existing = fsModule.readFileSync(file, 'utf-8');
  const cap = 14000;
  const snippet = existing.length > cap ? `${existing.slice(0, cap)}\n… [file truncated for patch prompt]` : existing;

  const sys = simple
    ? `Edit the file with 1–3 small search-replace steps. Reply with ONLY a \`\`\`json fence:
{"replacements":[{"old_string":"copy exact text from file","new_string":"…"}]}
Each old_string must appear exactly once. No prose.`
    : `You edit ONE existing file via small search-replace patches.
Reply with ONLY a \`\`\`json fence containing:
{"replacements":[{"old_string":"exact substring from file","new_string":"replacement"}, ...]}
Rules: at most 6 replacements; each old_string must appear exactly once in the file; copy old_string verbatim from the snippet; no prose outside JSON.`;

  const goalLine = combinedGoalText(goal, parentGoal).slice(0, 1200);

  const user = [
    `File: ${targetFile}`,
    `Goal: ${goalLine}`,
    continuation
      ? 'Some edits from this goal may already be on disk from an earlier approve in the same run. Apply **all remaining** changes from the goal in one JSON (up to 6 replacements).'
      : '',
    sessionBrief ? `Session brief (binding):\n${String(sessionBrief).slice(0, 900)}` : '',
    `Current file:\n\`\`\`\n${snippet}\n\`\`\``,
  ]
    .filter(Boolean)
    .join('\n\n');

  const llm = await chatGemini(userDataPath, fsModule, {
    messages: [{ role: 'user', content: user }],
    systemPrompt: sys,
    maxTokens: Math.min(simple ? 2048 : 4096, maxTokens || 4096),
    useTools: false,
    temperature: simple ? 0.1 : 0.15,
  });
  if (!llm.success) return null;

  const reps = parsePatchReplacementsJson(llm.content || '');
  if (!reps) return null;

  let content = existing;
  let appliedCount = 0;
  for (const r of reps.slice(0, 6)) {
    const oldS = r.old_string ?? r.oldString ?? r.search;
    const newS = r.new_string ?? r.newString ?? r.replace ?? '';
    const chatty = rejectChattyCssPatchFragment(targetFile, newS);
    if (chatty) continue;
    const applied = applySearchReplace(content, oldS, newS);
    if (!applied.ok) continue;
    content = applied.content;
    appliedCount += 1;
  }
  if (rejectChattyCssFileBody(targetFile, content)) return null;
  if (!appliedCount || content === existing) return null;
  return { content, patchCount: appliedCount, provider: llm.provider, model: llm.model };
}

/** One-shot apply_patch JSON from a dedicated LLM call (no multi-step agent JSON). */
async function harnessGenerateSingleApplyPatch(userDataPath, fsModule, options) {
  const {
    projectRoot,
    targetFile,
    goal,
    parentGoal = '',
    sessionBrief = '',
    maxTokens = 8192,
  } = options;

  const file = resolveInProject(projectRoot, targetFile);
  if (!fsModule.existsSync(file)) return null;
  let existing = fsModule.readFileSync(file, 'utf-8');
  const cap = 14000;
  const snippet =
    existing.length > cap ? `${existing.slice(0, cap)}\n… [file truncated for patch prompt]` : existing;

  const sys = `You make ONE surgical edit. Reply with ONLY a JSON object (no markdown prose):
{"action":"apply_patch","path":"${targetFile}","old_string":"copy verbatim from snippet","new_string":"updated text","reason":"short"}
Rules: old_string must appear exactly once in the file; copy whitespace and punctuation exactly; change only what the goal and brief ask.`;

  const user = [
    `Goal:\n${combinedGoalText(goal, parentGoal).slice(0, 1200)}`,
    sessionBrief ? `Session brief:\n${String(sessionBrief).slice(0, 900)}` : '',
    `File:\n\`\`\`\n${snippet}\n\`\`\``,
  ]
    .filter(Boolean)
    .join('\n\n');

  for (let attempt = 0; attempt < 2; attempt++) {
    const llm = await chatGemini(userDataPath, fsModule, {
      messages: [{ role: 'user', content: user }],
      systemPrompt: sys,
      maxTokens: Math.min(4096, maxTokens || 4096),
      useTools: false,
      temperature: attempt ? 0.08 : 0.12,
    });
    if (!llm.success) continue;

    const parsed = tryParseAgentObject(llm.content || '');
    if (!parsed || String(parsed.action || '').toLowerCase() !== 'apply_patch') continue;

    const relPath = parsed.path || parsed.filePath || targetFile;
    const oldS = parsed.old_string ?? parsed.oldString ?? parsed.search;
    const newS = parsed.new_string ?? parsed.newString ?? parsed.replace ?? '';
    const patched = applyPatchToFile(projectRoot, relPath, oldS, newS, fsModule);
    if (!patched.ok) continue;

    return {
      content: patched.content,
      path: relPath,
      patchCount: 1,
      provider: llm.provider,
      model: llm.model,
      patchError: null,
    };
  }
  return null;
}

function countHarnessServerPatchAttempts(history) {
  let n = 0;
  for (const h of history || []) {
    const c = String(h.content || '');
    if (/\[harness patch-first miss\]/i.test(c)) continue;
    if (/\[harness (patch-first|single-patch) [^\]]+\]/i.test(c)) n += 1;
  }
  return n;
}

const MAX_HARNESS_PATCH_PROPOSALS_PER_RUN = 5;

/** After partial approve on allowlisted paths, server may propose more patches (same run). */
function writtenPathsAllowHarnessContinuation(writtenPaths, allowedShipPaths) {
  if (!writtenPaths?.length) return true;
  if (!Array.isArray(allowedShipPaths) || !allowedShipPaths.length) return false;
  const allow = new Set(allowedShipPaths.map((p) => normalizeWrittenPath(p).toLowerCase()));
  return writtenPaths.every((p) => allow.has(normalizeWrittenPath(p).toLowerCase()));
}

function lastHistoryWasProseOrJsonStall(history) {
  const last = history?.[history.length - 1];
  if (!last?.content) return false;
  const c = String(last.content);
  return (
    /Need apply_patch|not prose|One JSON action only/i.test(c) ||
    /"action"\s*:\s*"reply"/i.test(c) ||
    /\[agent.*stall/i.test(c)
  );
}

function shouldRunHarnessPatchProposal(ctx) {
  const {
    goal,
    parentGoal = '',
    allowedShipPaths,
    projectRoot,
    fsModule,
    writtenPaths,
    history,
    stepIndex,
    lastToolResult,
  } = ctx;
  if (!shouldUseHarnessServerPatch(goal, parentGoal, allowedShipPaths, projectRoot, fsModule)) {
    return false;
  }
  if (!goalSignalsIncrementalEdit(goal, parentGoal)) return false;
  if (!writtenPathsAllowHarnessContinuation(writtenPaths, allowedShipPaths)) return false;
  if (countHarnessServerPatchAttempts(history) >= MAX_HARNESS_PATCH_PROPOSALS_PER_RUN) {
    return false;
  }
  if (stepIndex === 0 && (!history || !history.length)) return true;
  if (countHarnessServerPatchAttempts(history) === 0 && stepIndex <= 1) return true;
  if (lastToolResult?.ok && lastToolResult.path) return true;
  if (lastHistoryWasProseOrJsonStall(history)) {
    if (
      allowlistedPathsWrittenThisRun(writtenPaths, allowedShipPaths) &&
      countHarnessServerPatchAttempts(history) >= 1
    ) {
      return false;
    }
    return true;
  }
  if (
    lastToolResult?.ok === false &&
    /JSON|prose|apply_patch|One action only/i.test(String(lastToolResult.error || ''))
  ) {
    return true;
  }
  return false;
}

async function maybeHarnessPatchProposal(userDataPath, fsModule, options) {
  if (!shouldRunHarnessPatchProposal(options)) return null;
  return attemptHarnessPatchFirstProposal(userDataPath, fsModule, options);
}

/** After prefetch (or early incremental run): server-side search-replace, same as proposeSingleFileWrite patch path. */
async function attemptHarnessPatchFirstProposal(userDataPath, fsModule, options) {
  const {
    projectRoot,
    goal,
    parentGoal = '',
    sessionBrief = '',
    allowedShipPaths,
    writtenPaths,
    stepIndex,
    maxSteps,
    maxTokens = 8192,
  } = options;

  if (!goalSignalsIncrementalEdit(goal, parentGoal)) return null;
  if (!writtenPathsAllowHarnessContinuation(writtenPaths, allowedShipPaths)) return null;
  if (!Array.isArray(allowedShipPaths) || !allowedShipPaths.length || allowedShipPaths.length > 2) {
    return null;
  }

  const targetFile = allowedShipPaths[0];
  if (!shouldTryPatchFirst(goal, targetFile, projectRoot, fsModule, parentGoal)) return null;

  const continuation = Array.isArray(writtenPaths) && writtenPaths.length > 0;

  let patch = await tryPatchFirstWrite(userDataPath, fsModule, {
    projectRoot,
    targetFile,
    goal,
    parentGoal,
    sessionBrief,
    maxTokens,
    continuation,
  });
  if (!patch?.content?.trim()) {
    patch = await tryPatchFirstWrite(userDataPath, fsModule, {
      projectRoot,
      targetFile,
      goal,
      parentGoal,
      sessionBrief,
      maxTokens,
      simple: true,
      continuation,
    });
  }

  const stepBase = {
    success: true,
    stepIndex,
    maxSteps,
    provider: patch?.provider,
    model: patch?.model,
  };

  if (!patch?.content?.trim()) {
    const single = await harnessGenerateSingleApplyPatch(userDataPath, fsModule, {
      projectRoot,
      targetFile,
      goal,
      parentGoal,
      sessionBrief,
      maxTokens,
    });
    if (single?.content?.trim()) {
      patch = single;
    }
  }

  if (!patch?.content?.trim()) {
    return {
      ...stepBase,
      action: 'checkpoint',
      reason:
        'Harness could not auto-patch (no matching strings). Try a tighter goal with an exact class or line from the file, or edit manually.',
      narration: 'Server-side patch passes found no safe replacements.',
      toolResult: {
        ok: false,
        error:
          'Harness tried replacements + single apply_patch — no unique match. Quote exact CSS from disk in your goal (e.g. `.hero { … }`).',
        harnessPatchFirstFailed: true,
      },
      needsContinue: true,
      raw: '[harness patch-first miss]',
    };
  }

  const blocked = rejectWritePathOrNull(
    targetFile,
    goal,
    sessionBrief,
    writtenPaths,
    projectRoot,
    fsModule,
    stepBase,
    '',
    allowedShipPaths
  );
  if (blocked) return blocked;

  const writeGate = blockWriteApprovalStep(stepBase, targetFile, patch.content, projectRoot, fsModule, {
    goal,
    parentGoal,
    patchApply: true,
  });
  if (writeGate) return writeGate;

  const patchPath = patch.path || targetFile;
  const narration = `Harness patch: ${patch.patchCount || 1} edit(s) on **${patchPath}** — review diff, then approve.`;
  return {
    ...stepBase,
    action: 'apply_patch',
    reason: narration,
    narration,
    pendingWrite: { path: patchPath, content: patch.content },
    needsApproval: true,
    toolMeta: { patch: true, patchFirst: true, harness: true, patchCount: patch.patchCount || 1 },
    raw: patch.path ? `[harness single-patch ${patch.path}]` : `[harness patch-first ${targetFile}]`,
  };
}

/**
 * One agent step: LLM plan → optional tool (read/list) or pending write or done.
 */
async function runAgentStep(userDataPath, fs, options) {
  const {
    projectRoot,
    goal,
    history = [],
    stepIndex = 0,
    maxSteps = DEFAULT_MAX_STEPS,
    lastToolResult = null,
    recallContext = '',
    personaContext = '',
    projectSnapshot = '',
    sessionBrief = '',
    writtenPaths = [],
    forceWritePath = '',
    orchestratedFile = '',
    maxTokens = 8192,
    forceProvideCodeBlock = false,
    allowedShipPaths = null,
    parentGoal = '',
  } = options;

  if (!projectRoot || !goal) {
    return { success: false, error: 'projectRoot and goal required' };
  }
  if (stepIndex >= maxSteps) {
    return {
      success: true,
      done: true,
      action: 'done',
      message: 'Step limit reached. Ask me to continue if you need more.',
      stepIndex,
    };
  }

  // Orchestrated file ship: still one *agent* step, but the LM must produce the full write in one go
  // (internal fence fallback only — no checkpoint / reply / JSON spin).
  if (orchestratedFile) {
    const targetFile = orchestratedFile;
    const propose = await proposeSingleFileWrite(userDataPath, fs, {
      projectRoot,
      targetFile,
      goal,
      parentGoal: options.parentGoal || '',
      sessionBrief: options.fastFileShip
        ? String(options.sessionBrief || sessionBrief || '').trim().slice(0, 900)
        : sessionBrief,
      contextSnippet: options.contextSnippet || '',
      maxTokens: options.fastFileShip ? Math.min(maxTokens || 6144, 8192) : maxTokens,
      fastFileShip: options.fastFileShip !== false,
    });
    if (!propose.success) {
      return { ...propose, stepIndex, maxSteps };
    }
    const blocked = rejectWritePathOrNull(
      propose.pendingWrite.path,
      goal,
      sessionBrief,
      writtenPaths,
      projectRoot,
      fs,
      { success: true, stepIndex, raw: propose.narration || '' },
      orchestratedFile,
      allowedShipPaths
    );
    if (blocked) return blocked;
    return {
      ...propose,
      stepIndex,
      maxSteps,
      raw: propose.narration || propose.raw || `[write ${targetFile}]`,
      needsContinue: false,
    };
  }

  const harnessPatch = await maybeHarnessPatchProposal(userDataPath, fs, {
    projectRoot,
    goal,
    parentGoal,
    sessionBrief,
    allowedShipPaths,
    writtenPaths,
    stepIndex,
    maxSteps,
    maxTokens,
    history,
    lastToolResult,
    fsModule: fs,
  });
  if (harnessPatch?.needsApproval) return harnessPatch;

  const patchFirstActive = shouldUseHarnessServerPatch(
    goal,
    parentGoal,
    allowedShipPaths,
    projectRoot,
    fs
  );
  if (
    !patchFirstActive &&
    shouldBootstrapIncrementalRead(
      goal,
      parentGoal,
      allowedShipPaths,
      lastToolResult,
      stepIndex,
      history,
      projectRoot,
      fs
    )
  ) {
    const paths = bootstrapPathsForIncrementalEdit(
      projectRoot,
      goal,
      parentGoal,
      allowedShipPaths,
      fs
    );
    const boot = executeBootstrapReads(projectRoot, paths, fs, allowedShipPaths);
    if (boot.ok) {
      const names = boot.files.map((f) => f.path).join(', ');
      const narration = `Harness prefetched ${names} (${boot.chars} chars) — use full write or patch per goal.`;
      return {
        success: true,
        stepIndex,
        maxSteps,
        action: 'read_file',
        reason: narration,
        narration,
        raw: `[bootstrap read ${names}]`,
        toolResult: boot,
        needsContinue: true,
      };
    }
  }

  const systemPrompt = buildAgentSystemPrompt(
    projectRoot,
    goal,
    stepIndex,
    maxSteps,
    recallContext,
    personaContext,
    projectSnapshot,
    sessionBrief,
    writtenPaths,
    fs,
    forceWritePath,
    orchestratedFile,
    allowedShipPaths,
    parentGoal
  );
  const messages = [];

  for (const h of history) {
    if (h.role && h.content) messages.push({ role: h.role, content: h.content });
  }

  if (lastToolResult) {
    const nextFile = lastToolResult.nextRequiredFile;
    const incremental = goalSignalsIncrementalEdit(goal, parentGoal);
    const writePush =
      stepIndex >= 2 && isBuildOrCreateGoal(goal)
        ? '\n\nYou already explored — use **provide_code_block** or write_file next, not another read.'
        : incremental && stepIndex >= 3
          ? `\n\nYou have context — use **apply_patch** on ${(allowedShipPaths || []).map((p) => `\`${p}\``).join(' or ') || 'the allowlisted file(s)'} (exact old_string/new_string).`
          : '';
    let forceLine = '';
    if (incremental) {
      forceLine = incrementalPatchNudge(goal, parentGoal);
      if (lastToolResult.ok && lastToolResult.content && lastToolResult.path) {
        forceLine =
          '\n\nYou read the file — now **apply_patch** with a unique old_string copied verbatim from that content.';
      } else if (lastToolResult.error && /apply_patch|partial|smaller than the file/i.test(String(lastToolResult.error))) {
        forceLine = `\n\nPrevious write rejected: ${lastToolResult.error}`;
      }
    } else if (nextFile) {
      forceLine = `\n\nWrite **${nextFile}** this turn (complete file). Do not reply done.`;
    } else if (forceWritePath) {
      forceLine = `\n\nWrite **${forceWritePath}** this turn (complete file). Do not reply done.`;
    }
    let toolPayload;
    if (lastToolResult.files?.length) {
      const chunks = lastToolResult.files.map(
        (f) => `### ${f.path}\n\`\`\`\n${String(f.content)}\n\`\`\``
      );
      toolPayload = `Prefetched file(s) from disk:\n\n${chunks.join('\n\n')}`;
    } else {
      toolPayload = `Tool result:\n\`\`\`json\n${JSON.stringify(lastToolResult, null, 2)}\n\`\`\``;
    }
    messages.push({
      role: 'user',
      content: `${toolPayload}\nContinue toward the goal. One action only.${writePush}${forceLine}`,
    });
  } else if (stepIndex === 0) {
    const startHint = goalSignalsIncrementalEdit(goal, parentGoal)
      ? `Scoped edit: use grep_project or read_file if needed, then apply_patch on ${(allowedShipPaths || []).map((p) => `\`${p}\``).join(', ') || 'allowlisted paths'} with exact old_string/new_string. Do not full-file rewrite large existing targets.`
      : isBuildOrCreateGoal(goal)
        ? 'This is a build/create goal: after at most one quick look, use provide_code_block to ship files.'
        : 'Begin with your first action (JSON or provide_code_block).';
    messages.push({ role: 'user', content: startHint });
  }

  const tokenBudget = orchestratedFile || forceProvideCodeBlock ? Math.max(maxTokens, 32768) : maxTokens;
  const mustUseTool = !!(forceProvideCodeBlock || orchestratedFile);
  const incrementalJsonTurn =
    goalSignalsIncrementalEdit(goal, parentGoal) && !mustUseTool && !orchestratedFile;
  const agentTemperature = mustUseTool ? 0.35 : incrementalJsonTurn ? 0.12 : 0.7;
  let llm = await chatGemini(userDataPath, fs, {
    messages,
    systemPrompt,
    maxTokens: tokenBudget,
    useTools: true,
    forceProvideCodeBlock: mustUseTool,
    temperature: agentTemperature,
  });

  if (!llm.success && mustUseTool) {
    llm = await chatGemini(userDataPath, fs, {
      messages,
      systemPrompt,
      maxTokens: tokenBudget,
      useTools: false,
      temperature: agentTemperature,
    });
  }

  if (!llm.success) {
    return { success: false, error: llm.error || 'Cloud LLM unavailable', hint: llm.hint };
  }

  if (llm.functionCalls?.length) {
    const codeCall = llm.functionCalls.find((f) => f.name === 'provide_code_block');
    if (codeCall?.arguments) {
      const filePath = codeCall.arguments.filePath || codeCall.arguments.path;
      let content = codeCall.arguments.code != null ? String(codeCall.arguments.code) : '';
      const salvagedTool = !!codeCall.arguments._salvagedFromTruncatedToolJson;
      if (filePath && (!content.trim() || salvagedTool)) {
        const fromContent = salvageWriteFromContent(llm.content);
        if (fromContent?.content?.trim() && fromContent.content.length > content.length) {
          content = fromContent.content;
        }
      }
      if (filePath && !content.trim() && codeCall.rawArguments) {
        const again = salvageProvideCodeBlockToolArgs(codeCall.rawArguments);
        if (again?.code) content = String(again.code);
      }
      const effectivePath = orchestratedFile || filePath;
      if (filePath && !content.trim()) {
        const fence = extractMarkdownFenceForTarget(llm.content, effectivePath);
        if (fence?.content?.trim()) content = fence.content;
      }
      if (filePath && content.trim()) {
        try {
          resolveInProject(projectRoot, filePath);
          const stepBase = {
            success: true,
            stepIndex,
            raw: llm.content || '[provide_code_block tool]',
            provider: llm.provider,
            model: llm.model,
          };
          const blocked = rejectWritePathOrNull(
            filePath,
            goal,
            sessionBrief,
            writtenPaths,
            projectRoot,
            fs,
            stepBase,
            orchestratedFile,
            allowedShipPaths
          );
          if (blocked) return blocked;
          const incrementalBlock = rejectIncrementalFullFileToolWrite(
            projectRoot,
            filePath,
            goal,
            parentGoal,
            fs
          );
          if (incrementalBlock) {
            return {
              ...stepBase,
              toolResult: { ok: false, error: incrementalBlock },
              needsContinue: true,
            };
          }
          const writeGate = blockWriteApprovalStep(stepBase, filePath, content, projectRoot, fs, {
            finishReason: llm.finishReason,
            salvagedTool,
            goal,
            parentGoal,
          });
          if (writeGate) return writeGate;
          const fromFence = !codeCall.arguments.code?.trim() && content.trim();
          const reason = salvagedTool
            ? `Recovered full file from tool payload (truncated JSON — repaired).`
            : fromFence
              ? 'Pulled full file from markdown fence (tool code was empty).'
              : 'Structured code via provide_code_block';
          return {
            ...stepBase,
            action: 'write_file',
            reason,
            narration: `Proposed write: ${filePath}`,
            pendingWrite: { path: filePath, content },
            needsApproval: true,
            fromTool: true,
            toolMeta: {
              language: codeCall.arguments.language || 'text',
              salvagedTool,
            },
          };
        } catch (err) {
          return {
            success: true,
            stepIndex,
            toolResult: { ok: false, error: err.message },
            needsContinue: true,
            action: 'write_file',
            raw: llm.content,
          };
        }
      }
    }
  }

  const parsed = parseAgentJson(llm.content);
  const writeFromJsonRaw = pendingWriteFromParsed(parsed);
  if (writeFromJsonRaw) {
    const writeFromJson = fillWritePayloadFromLlmContent(
      writeFromJsonRaw,
      llm.content,
      orchestratedFile || writeFromJsonRaw.path
    );
    const reason =
      parsed.reason ||
      parsed.message ||
      `Ready to write ${writeFromJson.path} — approve when it looks good.`;
    try {
      resolveInProject(projectRoot, writeFromJson.path);
      if (!writeFromJson.content.trim()) {
        const hint = orchestratedFile
          ? `Tool/code field was empty — put the **full ${orchestratedFile}** in provide_code_block.code or a \`\`\`html/css fence.`
          : 'Write payload empty — use provide_code_block with full code or write_file content.';
        return {
          success: true,
          stepIndex,
          raw: llm.content,
          action: 'write_file',
          reason: 'Need the actual file body, not just hype.',
          narration: reason.slice(0, 280),
          provider: llm.provider,
          model: llm.model,
          toolResult: {
            ok: false,
            error: hint,
          },
          needsContinue: true,
        };
      }
      const stepBase = {
        success: true,
        stepIndex,
        raw: llm.content,
        reason,
        narration: reason,
        provider: llm.provider,
        model: llm.model,
      };
      const blocked = rejectWritePathOrNull(
        writeFromJson.path,
        goal,
        sessionBrief,
        writtenPaths,
        projectRoot,
        fs,
        { ...stepBase, action: 'write_file' },
        orchestratedFile,
        allowedShipPaths
      );
      if (blocked) return blocked;
      const writeGateJson = blockWriteApprovalStep(
        stepBase,
        writeFromJson.path,
        writeFromJson.content,
        projectRoot,
        fs,
        { finishReason: llm.finishReason, goal, parentGoal }
      );
      if (writeGateJson) return writeGateJson;
      return {
        ...stepBase,
        action: 'write_file',
        pendingWrite: { path: writeFromJson.path, content: writeFromJson.content },
        needsApproval: true,
        fromTool: writeFromJson.fromTool,
        toolMeta: { language: writeFromJson.language, finishReason: llm.finishReason },
      };
    } catch (err) {
      return {
        success: true,
        stepIndex,
        raw: llm.content,
        action: 'write_file',
        reason,
        toolResult: { ok: false, error: err.message },
        needsContinue: true,
      };
    }
  }

  const action = String(parsed.action || 'done').toLowerCase();
  const reason = parsed.reason || parsed.message || '';
  const friendlyReason =
    reason ||
    (action === 'list_dir'
      ? "Quick peek at the folder layout so I know where to put things."
      : action === 'read_file'
        ? 'Reading this file so edits match what you already have.'
        : action === 'grep_project'
          ? 'Searching the project for that string.'
          : action === 'find_files'
            ? 'Finding files by name.'
            : action === 'apply_patch'
              ? 'Applying a small patch — you still approve before save.'
              : `Working on ${action}…`);

  const base = {
    success: true,
    stepIndex,
    raw: llm.content,
    action,
    reason: friendlyReason,
    narration: friendlyReason,
    provider: llm.provider,
    model: llm.model,
  };

  if (action === '_prose' || action === '_no_action') {
    const inc = goalSignalsIncrementalEdit(goal, parentGoal);
    const missingOnProse = missingExpectedFiles(
      goal,
      sessionBrief,
      writtenPaths,
      projectRoot,
      fs,
      orchestratedFile
    );
    if (
      inc &&
      !orchestratedFile &&
      !missingOnProse.length &&
      allowlistedPathsWrittenThisRun(writtenPaths, allowedShipPaths)
    ) {
      const wrapMsg =
        stripAgentPayloadFromMessage(llm.content) ||
        stripAgentPayloadFromMessage(reason) ||
        'Edits are on disk — wrapping this pass.';
      return {
        ...base,
        done: true,
        message: wrapMsg,
      };
    }
    const toolResult = agentStallToolResult(
      goal,
      sessionBrief,
      writtenPaths,
      projectRoot,
      fs,
      orchestratedFile,
      parentGoal
    );
    return {
      ...base,
      action: 'reply',
      reason: inc
        ? 'Need apply_patch / read_file / grep JSON — not prose or done.'
        : action === '_prose'
          ? 'That was hype, not a file write — keeping going.'
          : 'Need a real write or read action — keeping going.',
      narration: friendlyReason.slice(0, 280),
      toolResult,
      needsContinue: true,
    };
  }

  if (action === 'done') {
    const incrementalScopedDone =
      goalSignalsIncrementalEdit(goal, parentGoal) &&
      Array.isArray(writtenPaths) &&
      writtenPaths.length > 0 &&
      !orchestratedFile;
    const missingBeforeDone = missingExpectedFiles(
      goal,
      sessionBrief,
      writtenPaths,
      projectRoot,
      fs,
      orchestratedFile
    );
    if (incrementalScopedDone && !missingBeforeDone.length) {
      const summaryEarly =
        stripAgentPayloadFromMessage(parsed.message || reason || llm.content) ||
        'All set for this pass.';
      return {
        ...base,
        done: true,
        message: summaryEarly,
      };
    }

    const mislabeled = tryParseAgentObject(parsed.message || llm.content);
    if (mislabeled && String(mislabeled.action).toLowerCase() !== 'done') {
      const retry = { ...mislabeled };
      const reAction = String(retry.action || '').toLowerCase();
      const reReason = retry.reason || retry.message || friendlyReason;
      const reBase = { ...base, action: reAction, reason: reReason, narration: reReason };
      if (reAction === 'list_dir') {
        try {
          const toolResult = executeListDir(projectRoot, retry.path, fs);
          return { ...reBase, toolResult, needsContinue: true };
        } catch (err) {
          return { ...reBase, toolResult: { ok: false, error: err.message }, needsContinue: true };
        }
      }
      if (reAction === 'read_file') {
        try {
          const toolResult = executeReadFile(projectRoot, retry.path, fs);
          return { ...reBase, toolResult, needsContinue: true };
        } catch (err) {
          return { ...reBase, toolResult: { ok: false, error: err.message }, needsContinue: true };
        }
      }
      const writeRetry = pendingWriteFromParsed(retry);
      if (
        writeRetry?.content?.trim() &&
        !(incrementalScopedDone && pathOnShipAllowlist(writeRetry.path, allowedShipPaths))
      ) {
        try {
          resolveInProject(projectRoot, writeRetry.path);
          const retryGate = blockWriteApprovalStep(
            reBase,
            writeRetry.path,
            writeRetry.content,
            projectRoot,
            fs,
            { finishReason: llm?.finishReason, goal, parentGoal }
          );
          if (retryGate) return retryGate;
          return {
            ...reBase,
            action: 'write_file',
            pendingWrite: { path: writeRetry.path, content: writeRetry.content },
            needsApproval: true,
            fromTool: writeRetry.fromTool,
            toolMeta: { language: writeRetry.language || 'text', finishReason: llm?.finishReason },
          };
        } catch (err) {
          return { ...reBase, toolResult: { ok: false, error: err.message }, needsContinue: true };
        }
      }
    }

    const embedded = salvageWriteFromContent(llm.content);
    if (
      embedded?.content?.trim() &&
      !(incrementalScopedDone && pathOnShipAllowlist(embedded.path, allowedShipPaths))
    ) {
      const writeReason =
        parsed.reason ||
        `One more file — **${embedded.path}** — then we can wrap up.`;
      try {
        resolveInProject(projectRoot, embedded.path);
        const embeddedGate = blockWriteApprovalStep(
          base,
          embedded.path,
          embedded.content,
          projectRoot,
          fs,
          { finishReason: llm?.finishReason, goal, parentGoal }
        );
        if (embeddedGate) return embeddedGate;
        return {
          ...base,
          action: 'write_file',
          reason: writeReason,
          narration: writeReason,
          pendingWrite: { path: embedded.path, content: embedded.content },
          needsApproval: true,
          fromTool: embedded.fromTool,
          toolMeta: { language: embedded.language || 'text', finishReason: llm?.finishReason },
        };
      } catch (err) {
        return {
          ...base,
          toolResult: { ok: false, error: err.message },
          needsContinue: true,
        };
      }
    }
    const summary =
      stripAgentPayloadFromMessage(parsed.message || reason || llm.content) ||
      'All set for this pass.';
    const missing = missingExpectedFiles(goal, sessionBrief, writtenPaths, projectRoot, fs, orchestratedFile);
    const truncated = looksTruncatedDoneMessage(summary);
    const incremental = goalSignalsIncrementalEdit(goal, parentGoal);
    const needsMoreWrites =
      missing.length &&
      (isBuildOrCreateGoal(goal) || orchestratedFile || incremental) &&
      (!incremental || !writtenPaths?.length);
    if (needsMoreWrites || truncated) {
      const why = missing.length
        ? orchestratedFile
          ? `Still need ${orchestratedFile} proposed for approval.`
          : incremental
            ? `Still need an approved patch on ${missing.join(', ')}.`
            : `Goal still wants: ${missing.join(', ')}`
        : 'Reply was cut off — continue with the next action';
      const toolResult =
        agentStallToolResult(goal, sessionBrief, writtenPaths, projectRoot, fs, orchestratedFile, parentGoal) ||
        (truncated
          ? {
              ok: false,
              error: `${why}.${incremental ? incrementalPatchNudge(goal, parentGoal) : ' Use provide_code_block or write_file.'}`,
            }
          : null);
      return {
        ...base,
        action: 'checkpoint',
        reason: why,
        narration: why,
        toolResult:
          toolResult ||
          {
            ok: false,
            error: `${why}.${incremental ? incrementalPatchNudge(goal, parentGoal) : ' Use provide_code_block or write_file.'}`,
          },
        needsContinue: true,
      };
    }
    return {
      ...base,
      done: true,
      message: summary,
    };
  }

  if (action === 'list_dir') {
    const stall = buildMissingFilesToolResult(goal, sessionBrief, writtenPaths, projectRoot, fs, '', orchestratedFile);
    if (stall && (orchestratedFile || (stepIndex >= 2 && requiresFreshLandingWrites(goal)))) {
      return {
        ...base,
        action: 'checkpoint',
        reason: stall.error,
        narration: stall.error,
        toolResult: stall,
        needsContinue: true,
      };
    }
    try {
      const toolResult = executeListDir(projectRoot, parsed.path, fs);
      return { ...base, toolResult, needsContinue: true };
    } catch (err) {
      return { ...base, toolResult: { ok: false, error: err.message }, needsContinue: true };
    }
  }

  if (action === 'read_file') {
    const stall = buildMissingFilesToolResult(goal, sessionBrief, writtenPaths, projectRoot, fs, '', orchestratedFile);
    if (stall && (orchestratedFile || (stepIndex >= 2 && requiresFreshLandingWrites(goal)))) {
      return {
        ...base,
        action: 'checkpoint',
        reason: stall.error,
        narration: stall.error,
        toolResult: stall,
        needsContinue: true,
      };
    }
    try {
      const toolResult = executeReadFile(projectRoot, parsed.path, fs);
      return { ...base, toolResult, needsContinue: true };
    } catch (err) {
      return { ...base, toolResult: { ok: false, error: err.message }, needsContinue: true };
    }
  }

  if (action === 'grep_project' || action === 'grep') {
    try {
      const pattern = parsed.pattern || parsed.query || parsed.search;
      const toolResult = executeGrepProject(projectRoot, pattern, fs);
      return { ...base, toolResult, needsContinue: true };
    } catch (err) {
      return { ...base, toolResult: { ok: false, error: err.message }, needsContinue: true };
    }
  }

  if (action === 'find_files' || action === 'find_file') {
    try {
      const query = parsed.query || parsed.pattern || parsed.name;
      const toolResult = executeFindFiles(projectRoot, query, fs);
      return { ...base, toolResult, needsContinue: true };
    } catch (err) {
      return { ...base, toolResult: { ok: false, error: err.message }, needsContinue: true };
    }
  }

  if (action === 'apply_patch') {
    try {
      const relPath = parsed.path || parsed.filePath || parsed.file;
      const oldS = parsed.old_string ?? parsed.oldString ?? parsed.search;
      const newS = parsed.new_string ?? parsed.newString ?? parsed.replace ?? '';
      const chattyPatch = rejectChattyCssPatchFragment(relPath, newS);
      if (chattyPatch) {
        return {
          ...base,
          toolResult: { ok: false, error: chattyPatch },
          needsContinue: true,
        };
      }
      const patched = applyPatchToFile(projectRoot, relPath, oldS, newS, fs);
      if (!patched.ok) {
        return { ...base, toolResult: patched, needsContinue: true };
      }
      const blocked = rejectWritePathOrNull(
        relPath,
        goal,
        sessionBrief,
        writtenPaths,
        projectRoot,
        fs,
        base,
        orchestratedFile,
        allowedShipPaths
      );
      if (blocked) return blocked;
      const patchGate = blockWriteApprovalStep(base, relPath, patched.content, projectRoot, fs, {
        finishReason: llm?.finishReason,
        goal,
        parentGoal,
        patchApply: true,
      });
      if (patchGate) return patchGate;
      return {
        ...base,
        action: 'apply_patch',
        pendingWrite: { path: relPath, content: patched.content },
        needsApproval: true,
        toolMeta: { patch: true, beforeLength: patched.beforeLength, afterLength: patched.afterLength },
      };
    } catch (err) {
      return { ...base, toolResult: { ok: false, error: err.message }, needsContinue: true };
    }
  }

  if (action === 'write_file') {
    try {
      const relPath = parsed.path || parsed.filePath || parsed.file;
      resolveInProject(projectRoot, relPath);
      const content =
        parsed.content != null
          ? String(parsed.content)
          : parsed.code != null
            ? String(parsed.code)
            : '';
      if (!content.trim()) {
        const inc = goalSignalsIncrementalEdit(goal, parentGoal);
        return {
          ...base,
          toolResult: {
            ok: false,
            error: inc
              ? 'write_file missing content — use apply_patch JSON with old_string/new_string'
              : 'write_file missing content — use provide_code_block with full file body',
          },
          needsContinue: true,
        };
      }
      const blocked = rejectWritePathOrNull(
        relPath,
        goal,
        sessionBrief,
        writtenPaths,
        projectRoot,
        fs,
        base,
        orchestratedFile,
        allowedShipPaths
      );
      if (blocked) return blocked;
      const incrementalBlock = rejectIncrementalFullFileToolWrite(
        projectRoot,
        relPath,
        goal,
        parentGoal,
        fs
      );
      if (incrementalBlock) {
        return { ...base, toolResult: { ok: false, error: incrementalBlock }, needsContinue: true };
      }
      const writeGateAction = blockWriteApprovalStep(base, relPath, content, projectRoot, fs, {
        finishReason: llm?.finishReason,
        goal,
        parentGoal,
      });
      if (writeGateAction) return writeGateAction;
      return {
        ...base,
        pendingWrite: {
          path: relPath,
          content,
        },
        needsApproval: true,
      };
    } catch (err) {
      return { ...base, toolResult: { ok: false, error: err.message }, needsContinue: true };
    }
  }

  if (action === 'provide_code_block' || action === 'write') {
    return {
      ...base,
      toolResult: {
        ok: false,
        error:
          'Use write_file JSON with path + content, or call provide_code_block as a tool (not JSON action)',
      },
      needsContinue: true,
    };
  }

  return {
    ...base,
    done: true,
    message: `Unknown action "${action}". ${parsed.message || ''}`.trim(),
  };
}

function commitAgentWrite(projectRoot, relPath, content, fs) {
  const ev = evaluateWriteForApproval(projectRoot, relPath, content, fs, {});
  if (!ev.allowed) {
    return {
      ok: false,
      error: ev.error,
      incomplete: !!ev.incomplete,
      truncated: !!ev.truncated,
    };
  }
  const file = resolveInProject(projectRoot, relPath);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(file, content, 'utf-8');
  return { ok: true, path: relPath };
}

/** Turn one LLM response into a pending write for targetFile (tool → fence → salvage). */
function resolvePendingWriteFromLlmResponse(llm, targetFile, projectRoot, fsModule) {
  if (!llm?.success) return null;
  const want = normalizeWrittenPath(targetFile).split('/').pop() || targetFile;
  let content = '';
  let language = 'text';
  let fromTool = false;
  let salvagedTool = false;

  const codeCall = llm.functionCalls?.find((f) => f.name === 'provide_code_block');
  if (codeCall?.arguments) {
    fromTool = true;
    salvagedTool = !!codeCall.arguments._salvagedFromTruncatedToolJson;
    language = codeCall.arguments.language || language;
    content = codeCall.arguments.code != null ? String(codeCall.arguments.code) : '';
    if (!content.trim() && codeCall.rawArguments) {
      const again = salvageProvideCodeBlockToolArgs(codeCall.rawArguments);
      if (again?.code) content = String(again.code);
    }
  }

  if (!content.trim()) {
    const salv = salvageWriteFromContent(llm.content);
    if (salv?.content?.trim()) {
      content = salv.content;
      language = salv.language || language;
    }
  }
  if (!content.trim()) {
    const fence = extractMarkdownFenceForTarget(llm.content, targetFile);
    if (fence?.content?.trim()) {
      content = fence.content;
      language = fence.language || language;
    }
  }

  if (!content.trim() || content.length < 24) return null;
  try {
    resolveInProject(projectRoot, targetFile);
  } catch {
    return null;
  }
  return {
    path: targetFile,
    content,
    language,
    fromTool,
    salvagedTool,
  };
}

/** Keep fast file ship on the creative brief (avoid synthwave default when chat said bubblegum). */
function buildThemeLockLine(sessionBrief, goal) {
  const blob = `${String(sessionBrief || '')}\n${String(goal || '')}`.toLowerCase();
  if (/\bbubblegum\b/.test(blob) || /\bbubblegum pop\b/.test(blob)) {
    return (
      'THEME LOCK (binding): Bubblegum Pop — light pastel backgrounds, playful sugary vibe, soft pinks/mints/lavender. ' +
      'NOT full-page dark synthwave, NOT purple-on-black cyberpunk default.'
    );
  }
  if (/\bpastel/.test(blob) && /\blanding\b/.test(blob)) {
    return 'THEME LOCK: Pastel / light landing aesthetic from chat — do not switch to dark neon synthwave.';
  }
  if (/\bsynthwave\b/.test(blob) && !/\bnot synthwave\b/.test(blob)) {
    return 'THEME LOCK: Synthwave as discussed in chat.';
  }
  return '';
}

function tokenBudgetForFile(targetFile, requested, fast = false) {
  const base = String(targetFile || '').toLowerCase();
  let cap = fast ? 6144 : 12288;
  if (base.endsWith('.css') || base.endsWith('.scss')) cap = fast ? 4096 : 8192;
  else if (base.endsWith('.html') || base.endsWith('.htm')) cap = fast ? 6144 : 12288;
  else if (base.endsWith('.js') || base.endsWith('.mjs')) cap = fast ? 6144 : 12288;
  const want = Math.min(Math.max(requested || (fast ? 4096 : 8192), 1024), cap);
  return want;
}

async function callFileDraftLlm(userDataPath, fsModule, { mode, userBody, targetFile, maxTokens, temperature, fastFileShip }) {
  const budget = tokenBudgetForFile(targetFile, maxTokens, fastFileShip);
  if (mode === 'fence') {
    const lang = inferFenceLanguageForPath(targetFile) || 'text';
    const fenceSystem = fastFileShip
      ? `One \`\`\`${lang}\`\`\` fence. Full ${targetFile}. No text outside the fence.`
      : `Output ONLY one markdown fenced code block (\`\`\`${lang} ... \`\`\`) with the COMPLETE ${targetFile}. No prose.`;
    const fenceUser = fastFileShip
      ? userBody
      : `${userBody}\n\nEntire file in one \`\`\`${lang}\`\`\` fence. Must end with valid closing syntax (e.g. CSS closes all \`{\`).`;
    return chatGemini(userDataPath, fsModule, {
      messages: [{ role: 'user', content: fenceUser }],
      systemPrompt: fenceSystem,
      maxTokens: budget,
      useTools: false,
      temperature: temperature ?? (fastFileShip ? 0.12 : 0.2),
    });
  }

  const toolSystem = `You generate ONE file for VIBE IDE.
Call **provide_code_block** once: filePath="${targetFile}", code=FULL file body, language=appropriate.
No chat, no JSON action blocks, no prose.`;
  return chatGemini(userDataPath, fsModule, {
    messages: [{ role: 'user', content: userBody }],
    systemPrompt: toolSystem,
    maxTokens: budget,
    useTools: true,
    forceProvideCodeBlock: true,
    temperature: temperature ?? 0.25,
  });
}

/**
 * One-shot file draft for approve UI — no multi-step JSON agent loop.
 * Fence-first for web files (faster, no JSON-in-tool bloat). Validates completeness; continues once if truncated.
 */
async function proposeSingleFileWrite(userDataPath, fsModule, options) {
  const {
    projectRoot,
    targetFile,
    goal = '',
    parentGoal = '',
    sessionBrief = '',
    contextSnippet = '',
    maxTokens = 6144,
    fastFileShip = false,
  } = options;

  if (!projectRoot || !targetFile) {
    return { success: false, error: 'projectRoot and targetFile required' };
  }

  const started = Date.now();
  const fast = !!fastFileShip;
  let patchAttempted = false;

  if (shouldTryPatchFirst(goal, targetFile, projectRoot, fsModule, parentGoal)) {
    patchAttempted = true;
    let patch = await tryPatchFirstWrite(userDataPath, fsModule, {
      projectRoot,
      targetFile,
      goal,
      parentGoal,
      sessionBrief,
      maxTokens,
    });
    if (!patch?.content?.trim()) {
      patch = await tryPatchFirstWrite(userDataPath, fsModule, {
        projectRoot,
        targetFile,
        goal,
        parentGoal,
        sessionBrief,
        maxTokens,
        simple: true,
      });
    }
    if (patch?.content?.trim()) {
      const durationMs = Date.now() - started;
      return {
        success: true,
        pendingWrite: { path: targetFile, content: patch.content },
        needsApproval: true,
        narration: `Patch-first: ${patch.patchCount} edit(s) on **${targetFile}** (${Math.round(durationMs / 1000)}s) — review diff, then approve.`,
        raw: `[patch-first ${targetFile}]`,
        attempts: patchAttempted ? 2 : 1,
        durationMs,
        provider: patch.provider,
        model: patch.model,
        patchFirst: true,
      };
    }
    if (goalSignalsIncrementalEdit(goal, parentGoal)) {
      return {
        success: false,
        error:
          'Patch-first could not apply a safe edit. Try a tighter goal with exact text from the file, or use chat + Implement for a manual snippet.',
        attempts: patchAttempted ? 2 : 1,
        durationMs: Date.now() - started,
      };
    }
  }

  const briefSlice = sessionBrief ? String(sessionBrief).trim().slice(0, fast ? 700 : 600) : '';
  const themeLock = buildThemeLockLine(sessionBrief, goal);
  const goalSlice = combinedGoalText(goal, parentGoal).trim().slice(0, fast ? 380 : 900);
  const editingExisting =
    patchAttempted || shouldTryPatchFirst(goal, targetFile, projectRoot, fsModule, parentGoal);
  const fullCssRewrite =
    /\.css$/i.test(targetFile) &&
    (isFullRewriteGoal(goal, parentGoal) || cssFileNeedsFullRewrite(projectRoot, targetFile, fsModule));
  const ctxCap = fullCssRewrite
    ? 8000
    : fast
      ? editingExisting
        ? 3500
        : 1200
      : 4000;
  const draftMaxTokens =
    fast && editingExisting && /\.css$/i.test(targetFile) && !fullCssRewrite
      ? Math.min(maxTokens, 4096)
      : fullCssRewrite
        ? Math.max(maxTokens, 8192)
        : maxTokens;
  let fileContext =
    contextSnippet?.trim() ||
    existingFileContextBlock(projectRoot, targetFile, fsModule, goal, parentGoal);
  if (contextSnippet?.trim() && !isFullRewriteGoal(goal, parentGoal)) {
    const onDisk = existingFileContextBlock(projectRoot, targetFile, fsModule, goal, parentGoal);
    if (onDisk && !fileContext.includes('Existing **')) {
      fileContext = `${contextSnippet.trim()}\n\n${onDisk}`;
    }
  }
  const userBody = fast
    ? [
        `Output complete ${targetFile}.`,
        themeLock || '',
        goalSlice || '',
        briefSlice || '',
        fileContext ? String(fileContext).trim().slice(0, ctxCap) : '',
      ]
        .filter(Boolean)
        .join('\n')
    : [
        `Write the complete file **${targetFile}**.`,
        goalSlice ? `Goal: ${goalSlice}` : '',
        briefSlice ? `Session brief:\n${briefSlice}` : '',
        fileContext ? String(fileContext).trim().slice(0, ctxCap) : '',
      ]
        .filter(Boolean)
        .join('\n\n');

  const modes =
    fast && preferFenceFirstForPath(targetFile)
      ? ['fence']
      : preferFenceFirstForPath(targetFile)
        ? ['fence', 'tool']
        : ['tool', 'fence'];
  let llm = null;
  let pending = null;
  let attempts = 0;

  for (const mode of modes) {
    attempts += 1;
    llm = await callFileDraftLlm(userDataPath, fsModule, {
      mode,
      userBody,
      targetFile,
      maxTokens: draftMaxTokens,
      fastFileShip: fast,
      temperature: mode === 'fence' ? (fast ? 0.12 : 0.2) : 0.25,
    });
    if (!fast && !llm.success && mode === 'tool') {
      llm = await callFileDraftLlm(userDataPath, fsModule, {
        mode: 'fence',
        userBody,
        targetFile,
        maxTokens,
        fastFileShip: false,
      });
      attempts += 1;
    }
    if (!llm.success) continue;
    pending = resolvePendingWriteFromLlmResponse(llm, targetFile, projectRoot, fsModule);
    if (pending?.content?.trim()) break;
  }

  if (fast && !pending?.content?.trim() && preferFenceFirstForPath(targetFile) && !patchAttempted) {
    attempts += 1;
    llm = await callFileDraftLlm(userDataPath, fsModule, {
      mode: 'tool',
      userBody,
      targetFile,
      maxTokens: draftMaxTokens,
      fastFileShip: false,
    });
    if (llm.success) {
      pending = resolvePendingWriteFromLlmResponse(llm, targetFile, projectRoot, fsModule);
    }
  }

  const writeMeta = (p, l) => ({
    finishReason: l?.finishReason,
    salvagedTool: p?.salvagedTool,
  });

  const needsContinue =
    pending?.content?.trim() &&
    isIncompleteWriteContent(pending.content, targetFile, writeMeta(pending, llm));
  if (needsContinue && (!fast || pending.content.length > 400)) {
    attempts += 1;
    const lang = inferFenceLanguageForPath(targetFile) || 'text';
    const tail = pending.content.slice(-800);
    const contUser =
      `The file ${targetFile} was cut off mid-write. Complete it.\n\n` +
      `End of current file:\n\`\`\`${lang}\n${tail}\n\`\`\`\n\n` +
      `Output ONE \`\`\`${lang}\`\`\` fence with ONLY the remaining lines (do not repeat the beginning).`;
    const contLlm = await chatGemini(userDataPath, fsModule, {
      messages: [{ role: 'user', content: contUser }],
      systemPrompt: `Append-only continuation for ${targetFile}. One fence, suffix only.`,
      maxTokens: tokenBudgetForFile(targetFile, maxTokens, fast),
      useTools: false,
      temperature: 0.15,
    });
    if (contLlm.success) {
      const suffix =
        resolvePendingWriteFromLlmResponse(contLlm, targetFile, projectRoot, fsModule)?.content || contLlm.content;
      const fence = extractMarkdownFenceForTarget(suffix, targetFile);
      const piece = fence?.content?.trim() || String(suffix || '').trim();
      if (piece) {
        pending.content = mergeWriteContinuation(pending.content, piece);
        llm = contLlm;
      }
    }
  }

  const durationMs = Date.now() - started;

  if (!pending?.content?.trim()) {
    return {
      success: false,
      error: llm?.error || 'Model returned no file body — try again or use chat + Implement.',
      attempts,
      durationMs,
      provider: llm?.provider,
      model: llm?.model,
    };
  }

  const writeEv = evaluateWriteForApproval(projectRoot, targetFile, pending.content, fsModule, {
    finishReason: llm?.finishReason,
    salvagedTool: pending.salvagedTool,
    goal,
    parentGoal,
  });
  if (!writeEv.allowed) {
    return {
      success: false,
      error: writeEv.error,
      incomplete: !!writeEv.incomplete,
      truncated: !!writeEv.truncated,
      attempts,
      durationMs,
      finishReason: llm?.finishReason,
      salvagedTool: pending.salvagedTool,
      partialChars: pending.content.length,
      provider: llm?.provider,
      model: llm?.model,
    };
  }

  return {
    success: true,
    action: 'write_file',
    pendingWrite: { path: pending.path, content: pending.content },
    needsApproval: true,
    fromTool: pending.fromTool,
    toolMeta: {
      language: pending.language,
      salvagedTool: pending.salvagedTool,
      attempts,
      durationMs,
      finishReason: llm?.finishReason,
      fastFileShip: fast,
    },
    provider: llm.provider,
    model: llm.model,
    narration: patchAttempted
      ? `Patch missed → full-file draft: **${targetFile}** (${Math.round(durationMs / 1000)}s). Prefer smaller goals for faster patches.`
      : `One-shot draft: ${targetFile} (${pending.content.length} chars, ${Math.round(durationMs / 1000)}s)`,
  };
}

module.exports = {
  DEFAULT_MAX_STEPS,
  runAgentStep,
  proposeSingleFileWrite,
  commitAgentWrite,
  evaluateWriteForApproval,
  resolveInProject,
};
