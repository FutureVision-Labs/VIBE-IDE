const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const root = path.resolve(__dirname, '..');
// Parse --outDir argument (supports both --outDir=path and --outDir path)
let outRoot = root;
const outDirIndex = process.argv.findIndex(a => a === '--outDir' || a.startsWith('--outDir='));
if (outDirIndex !== -1) {
  const arg = process.argv[outDirIndex];
  if (arg.includes('=')) {
    // Format: --outDir=path
    outRoot = path.resolve(arg.split('=').slice(1).join('=')); // Join in case path has = in it
  } else if (process.argv[outDirIndex + 1]) {
    // Format: --outDir path
    outRoot = path.resolve(process.argv[outDirIndex + 1]);
  }
}
// Normalize quotes around paths (PowerShell can pass quoted paths)
outRoot = outRoot.trim().replace(/^"(.+)"$/, '$1').replace(/^\'(.+)\'$/, '$1');
// Prefer markdown from the target project folder; fallback to app folder
let mdPath = path.join(outRoot, 'PROJECT_JOURNAL.md');
if (!fs.existsSync(mdPath)) mdPath = path.join(root, 'PROJECT_JOURNAL.md');
const outPath = path.join(outRoot, 'PROJECT_JOURNAL.generated.html');

marked.setOptions({ mangle: false, headerIds: true, breaks: false });

function buildHtml(contentHtml, cfg, projectName) {
  const base = cfg?.base || '#00a2ff';
  // Generate theme colors from base color
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h, s, l };
  }
  function hslToCss(h, s, l) {
    return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }
  function mixRgb(c1, c2, t) {
    return {
      r: Math.round(c1.r + (c2.r - c1.r) * t),
      g: Math.round(c1.g + (c2.g - c1.g) * t),
      b: Math.round(c1.b + (c2.b - c1.b) * t)
    };
  }
  function rgbToHex({ r, g, b }) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function luminance({ r, g, b }) {
    const f = x => {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  const baseRgb = hexToRgb(base);
  const baseHsl = rgbToHsl(baseRgb.r, baseRgb.g, baseRgb.b);
  const text = luminance(baseRgb) > 0.55 ? '#0b0b12' : '#e6f7ff';
  const accentH = (baseHsl.h + (50 / 360)) % 1;
  const accent = hslToCss(accentH, Math.min(1, baseHsl.s * 0.9), Math.min(1, baseHsl.l + 0.1));
  const bgStart = rgbToHex(mixRgb({ r: 0, g: 0, b: 0 }, baseRgb, 0.12));
  const bgEnd = rgbToHex(mixRgb({ r: 0, g: 0, b: 0 }, baseRgb, 0.35));
  const border = `rgba(${baseRgb.r},${baseRgb.g},${baseRgb.b},0.25)`;
  const link = hslToCss(accentH, Math.min(1, baseHsl.s * 0.8), Math.min(1, baseHsl.l + 0.2));

  const title = projectName ? `${projectName} — Project Journal` : 'Project Journal';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body{font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;background:linear-gradient(135deg,${bgStart},${bgEnd});color:${text};margin:0;padding:24px}
    .wrap{max-width:1100px;margin:0 auto;background:rgba(20,20,30,.95);border:1px solid ${border};border-radius:12px;box-shadow:0 0 24px ${border.replace('0.25', '0.18')};padding:28px}
    h1,h2{color:${base};text-shadow:0 0 10px ${border.replace('0.25', '0.5')}}
    a{color:${link}}
    pre{background:#0f0f18;padding:12px;border-radius:8px;overflow:auto}
    code{font-family:Consolas,Monaco,monospace}
    hr{border:0;border-top:1px solid ${border}}
  </style>
</head>
<body>
  <div class="wrap">
    ${contentHtml}
  </div>
</body>
</html>`;
}

// Load config if present
let cfg = { base: '#00a2ff' };
let cfgPath = path.join(outRoot, 'journal.config.json');
if (!fs.existsSync(cfgPath)) cfgPath = path.join(root, 'journal.config.json');
if (fs.existsSync(cfgPath)) {
  try {
    cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };
    console.log('Loaded theme config from:', cfgPath);
  } catch (e) {
    console.warn('Failed to load journal.config.json:', e.message);
  }
}

if (!fs.existsSync(mdPath)) {
  console.error('Missing PROJECT_JOURNAL.md in', outRoot);
  process.exit(1);
}

const md = fs.readFileSync(mdPath, 'utf8');
// Extract project name from markdown
let projectName = null;
const nameMatch = md.match(/Project Name:\s*([^\n]+)/i);
if (nameMatch) {
  projectName = nameMatch[1].trim()
    .replace(/™/g, '')
    .replace(/\*\*/g, '')  // Remove markdown bold
    .replace(/\*/g, '')    // Remove any remaining asterisks
    .trim();
}
const htmlContent = marked.parse(md);
const finalHtml = buildHtml(htmlContent, cfg, projectName);
fs.writeFileSync(outPath, finalHtml, 'utf8');
console.log('Wrote', outPath);


