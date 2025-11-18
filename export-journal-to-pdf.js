// export-journal-to-pdf.js
// Fresh PDF exporter built for GameForge IDE - follows mk-journal-html.js pattern exactly
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const root = path.resolve(__dirname);
// Parse --outDir argument (EXACT same logic as mk-journal-html.js)
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

// Find HTML file (same priority as HTML generator finds markdown)
const genHtmlPath = path.join(outRoot, 'PROJECT_JOURNAL.generated.html');
const htmlPath = path.join(outRoot, 'PROJECT_JOURNAL.html');
const appHtmlPath = path.join(root, 'PROJECT_JOURNAL.html');

let inputHtml = null;
if (fs.existsSync(genHtmlPath)) {
  inputHtml = genHtmlPath;
} else if (fs.existsSync(htmlPath)) {
  inputHtml = htmlPath;
} else if (fs.existsSync(appHtmlPath)) {
  inputHtml = appHtmlPath;
} else {
  console.error('No HTML file found');
  process.exit(1);
}

// Load config if present (same as HTML generator)
let cfg = { base: '#00a2ff', logoPath: 'logo.jpg', coverTagline: 'Create at the speed of imagination — without losing the pen.', pdf: { fullBleed: true } };
let cfgPath = path.join(outRoot, 'journal.config.json');
if (!fs.existsSync(cfgPath)) cfgPath = path.join(root, 'journal.config.json');
if (fs.existsSync(cfgPath)) {
  try {
    cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };
  } catch (e) {
    console.warn('Failed to load journal.config.json:', e.message);
  }
}

// Derive project directory from HTML file location
const projectDir = path.dirname(inputHtml);
const outDir = path.join(projectDir, 'exports');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const projectName = path.basename(projectDir).replace(/[^a-z0-9-_]/gi, '_');
const outPdf = path.join(outDir, `PROJECT_JOURNAL_${projectName}-${new Date().toISOString().slice(0,10)}.pdf`);

// Resolve logo path - handle both relative and absolute paths
let logoSrc = cfg.logoPath || 'logo.jpg';
let logoDataUrl = null;

// If it's already an absolute path (Windows drive letter or starts with /)
if (/^[A-Za-z]:/.test(logoSrc) || logoSrc.startsWith('/')) {
  // Convert absolute path to base64 data URL (works reliably with Puppeteer)
  const logoFilePath = logoSrc.replace(/^file:\/\//, '').replace(/\//g, '\\');
  if (fs.existsSync(logoFilePath)) {
    const logoBuffer = fs.readFileSync(logoFilePath);
    const logoExt = path.extname(logoFilePath).toLowerCase();
    const mimeType = logoExt === '.png' ? 'image/png' : logoExt === '.jpg' || logoExt === '.jpeg' ? 'image/jpeg' : 'image/png';
    logoDataUrl = `data:${mimeType};base64,${logoBuffer.toString('base64')}`;
    console.log('Logo converted to base64 from absolute path:', logoFilePath);
  } else {
    console.warn('Logo file not found at:', logoFilePath);
  }
} else if (!logoSrc.startsWith('http') && !logoSrc.startsWith('file://') && !logoSrc.startsWith('data:')) {
  // Relative path - try project folder first, then app folder
  const testPaths = [
    path.join(projectDir, logoSrc),
    path.join(root, logoSrc)
  ];
  for (const p of testPaths) {
    if (fs.existsSync(p)) {
      // Convert to base64 for reliability
      const logoBuffer = fs.readFileSync(p);
      const logoExt = path.extname(p).toLowerCase();
      const mimeType = logoExt === '.png' ? 'image/png' : logoExt === '.jpg' || logoExt === '.jpeg' ? 'image/jpeg' : 'image/png';
      logoDataUrl = `data:${mimeType};base64,${logoBuffer.toString('base64')}`;
      console.log('Logo converted to base64 from relative path:', p);
      break;
    }
  }
} else if (logoSrc.startsWith('http') || logoSrc.startsWith('data:')) {
  // Keep HTTP URLs and data URLs as-is
  logoDataUrl = logoSrc;
}

// Use base64 data URL if available, otherwise fallback to original
cfg.logoPath = logoDataUrl || logoSrc;

// Write diagnostic to file so we can see what's happening
const debugPath = path.join(projectDir, 'pdf-export-debug.txt');
const debugInfo = [
  '=== PDF EXPORT DEBUG ===',
  `outRoot: ${outRoot}`,
  `genHtmlPath: ${genHtmlPath} ${fs.existsSync(genHtmlPath) ? 'EXISTS' : 'NOT FOUND'}`,
  `htmlPath: ${htmlPath} ${fs.existsSync(htmlPath) ? 'EXISTS' : 'NOT FOUND'}`,
  `appHtmlPath: ${appHtmlPath} ${fs.existsSync(appHtmlPath) ? 'EXISTS' : 'NOT FOUND'}`,
  `Selected inputHtml: ${inputHtml}`,
  `Project dir: ${projectDir}`,
  '========================'
].join('\n');
fs.writeFileSync(debugPath, debugInfo, 'utf8');
console.log('Debug info written to:', debugPath);

console.log('=== PDF EXPORT DEBUG ===');
console.log('outRoot:', outRoot);
console.log('genHtmlPath:', genHtmlPath, fs.existsSync(genHtmlPath) ? 'EXISTS' : 'NOT FOUND');
console.log('htmlPath:', htmlPath, fs.existsSync(htmlPath) ? 'EXISTS' : 'NOT FOUND');
console.log('appHtmlPath:', appHtmlPath, fs.existsSync(appHtmlPath) ? 'EXISTS' : 'NOT FOUND');
console.log('Selected inputHtml:', inputHtml);
console.log('Project dir:', projectDir);
console.log('========================');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Load HTML with proper base URL for relative resources
  const htmlContent = fs.readFileSync(inputHtml, 'utf8');
  
  // DIAGNOSTIC: Verify what we're actually reading
  const htmlDebug = [
    '=== HTML CONTENT CHECK ===',
    `File size: ${htmlContent.length} chars`,
    `First 500 chars: ${htmlContent.substring(0, 500)}`,
    `Contains "Damo"? ${htmlContent.includes('Damo')}`,
    `Contains "GameForge"? ${htmlContent.includes('GameForge')}`,
    `Contains "Troll Killer"? ${htmlContent.includes('Troll Killer')}`,
    '==========================='
  ].join('\n');
  fs.appendFileSync(debugPath, '\n\n' + htmlDebug, 'utf8');
  
  console.log('=== HTML CONTENT CHECK ===');
  console.log('File size:', htmlContent.length, 'chars');
  console.log('First 500 chars:', htmlContent.substring(0, 500));
  console.log('Contains "Damo"?', htmlContent.includes('Damo'));
  console.log('Contains "GameForge"?', htmlContent.includes('GameForge'));
  console.log('Contains "Troll Killer"?', htmlContent.includes('Troll Killer'));
  console.log('===========================');
  
  const baseUrl = 'file:///' + projectDir.replace(/\\/g, '/') + '/';
  await page.setContent(htmlContent, { waitUntil: 'networkidle0', baseURL: baseUrl });
  
  // Extract project name from HTML page title
  const pageTitle = await page.evaluate(() => document.title);
  let projectName = 'Project Journal';
  if (pageTitle.includes('—')) {
    projectName = pageTitle.split('—')[0]
      .trim()
      .replace(/\*\*/g, '')  // Remove markdown bold
      .replace(/\*/g, '')    // Remove any remaining asterisks
      .trim();
  } else if (pageTitle !== 'Project Journal') {
    projectName = pageTitle.replace('Project Journal', '')
      .trim()
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .trim();
  }
  
  // Check what Puppeteer actually sees
  const pageContent = await page.evaluate(() => {
    return {
      title: document.title,
      bodyText: document.body.innerText.substring(0, 500),
      hasDamo: document.body.innerText.includes('Damo'),
      hasGameForge: document.body.innerText.includes('GameForge'),
      hasTrollKiller: document.body.innerText.includes('Troll Killer')
    };
  });
  
  const puppeteerDebug = [
    '=== PUPPETEER CONTENT CHECK ===',
    `Title: ${pageContent.title}`,
    `Body text (first 500): ${pageContent.bodyText}`,
    `Has "Damo"? ${pageContent.hasDamo}`,
    `Has "GameForge"? ${pageContent.hasGameForge}`,
    `Has "Troll Killer"? ${pageContent.hasTrollKiller}`,
    '==============================='
  ].join('\n');
  fs.appendFileSync(debugPath, '\n\n' + puppeteerDebug, 'utf8');
  
  // Inject cover page, TOC, changelog, and print styles
  await page.evaluate((todayStr, cfg, projectName) => {
    function slugify(s) {
      return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g,'').substring(0,80);
    }

    // Theme helpers
    function hexToRgb(hex){ hex=hex.replace('#',''); if(hex.length===3) hex=hex.split('').map(c=>c+c).join(''); const n=parseInt(hex,16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; }
    function rgbToHsl(r,g,b){ r/=255;g/=255;b/=255; const max=Math.max(r,g,b),min=Math.min(r,g,b); let h,s,l=(max+min)/2; if(max===min){h=s=0;} else { const d=max-min; s=l>0.5?d/(2-max-min):d/(max+min); switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;case b:h=(r-g)/d+4;break;} h/=6;} return {h,s,l}; }
    function hslToCss(h,s,l){ return `hsl(${Math.round(h*360)} ${Math.round(s*100)}% ${Math.round(l*100)}%)`; }
    function mix(a,b,t){ return a+(b-a)*t; }
    function mixRgb(c1,c2,t){ return { r:Math.round(mix(c1.r,c2.r,t)), g:Math.round(mix(c1.g,c2.g,t)), b:Math.round(mix(c1.b,c2.b,t)) }; }
    function rgbToHex({r,g,b}){ return '#' + [r,g,b].map(x=>x.toString(16).padStart(2,'0')).join(''); }
    function luminance({r,g,b}){ const f=x=>{x/=255; return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)}; const R=f(r),G=f(g),B=f(b); return 0.2126*R+0.7152*G+0.0722*B; }

    const baseRgb = hexToRgb(cfg.base||'#00a2ff');
    const baseHsl = rgbToHsl(baseRgb.r, baseRgb.g, baseRgb.b);
    const text = luminance(baseRgb) > 0.55 ? '#0b0b12' : '#e6f7ff';
    const accentH = (baseHsl.h + (50/360)) % 1; // hue rotate
    const accent = hslToCss(accentH, Math.min(1, baseHsl.s*0.9), Math.min(1, baseHsl.l+0.1));
    const bgStart = rgbToHex(mixRgb({r:0,g:0,b:0}, baseRgb, 0.12));
    const bgEnd = rgbToHex(mixRgb({r:0,g:0,b:0}, baseRgb, 0.35));
    const primary = cfg.base;
    const border = `rgba(${baseRgb.r},${baseRgb.g},${baseRgb.b},0.25)`;

    const container = document.querySelector('.container') || document.querySelector('.wrap') || document.body;
    const header = container.querySelector('header');
    const firstChild = container.firstElementChild || container.firstChild;

    // Cover page
    const cover = document.createElement('section');
    cover.id = 'pdf-cover';
    cover.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;text-align:center; background:rgba(20,20,30,.9); border:1px solid rgba(0,162,255,.25); border-radius:12px; padding:32px; margin:0 0 24px;';
    const logoSrc = cfg.logoPath || 'logo.jpg';
    cover.innerHTML = `
      <img src="${logoSrc}" alt="Project Logo" style="max-width:520px;width:100%;height:auto;box-shadow:0 0 30px ${border};border-radius:10px;margin-bottom:20px;" onerror="this.style.display='none'">
      <h1 style="color:${primary}; margin:0 0 8px; font-size:40px;">${projectName}<br><span style="font-size:0.7em;font-weight:normal;">Project Journal</span></h1>
      <p style="color:${accent}; margin:6px 0 14px; font-size:16px;">${cfg.coverTagline||''}</p>
      <p style="color:${text}; opacity:.8; font-size:14px;">Generated: ${todayStr}</p>
    `;
    if (header) {
      header.parentNode.insertBefore(cover, header);
    } else if (firstChild) {
      container.insertBefore(cover, firstChild);
    } else {
      container.appendChild(cover);
    }

    // TOC
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
    headings.forEach(h => { if (!h.id) h.id = slugify(h.textContent); });
    const toc = document.createElement('section');
    toc.id = 'pdf-toc';
    toc.style.cssText = 'background:rgba(20,20,30,.9); border:1px solid rgba(0,162,255,.25); border-radius:12px; padding:16px; margin:12px 0 24px;';
    toc.innerHTML = `<h1 style="margin:0 0 8px; color:#00a2ff;">Table of Contents</h1><ul id="toc-list" style="list-style:none; padding:0; margin:0; line-height:1.7;"></ul>`;
    const ul = toc.querySelector('#toc-list');
    headings.forEach(h => {
      const level = h.tagName === 'H1' ? 1 : h.tagName === 'H2' ? 2 : 3;
      const li = document.createElement('li');
      li.style.marginLeft = level === 1 ? '0' : level === 2 ? '16px' : '32px';
      const a = document.createElement('a');
      a.href = `#${h.id}`;
      a.textContent = h.textContent.trim();
      a.style.cssText = 'color:#9fe0ff; text-decoration:none;';
      li.appendChild(a);
      ul.appendChild(li);
    });
    if (cover.nextSibling) cover.parentNode.insertBefore(toc, cover.nextSibling); else container.insertBefore(toc, container.firstChild);

    // Back to TOC after H2
    headings.forEach(h => {
      if (h.tagName === 'H2') {
        const back = document.createElement('a');
        back.href = '#pdf-toc';
        back.textContent = '↑ Back to TOC';
        back.style.cssText = 'display:inline-block;margin-top:4px;font-size:12px;color:#888;text-decoration:none;';
        h.parentNode.insertBefore(back, h.nextSibling);
      }
    });

    // Changelog appendix
    const appendix = document.createElement('section');
    appendix.id = 'pdf-changelog';
    appendix.style.cssText = 'background:rgba(20,20,30,.9); border:1px solid rgba(138,43,226,.25); border-radius:12px; padding:16px; margin:24px 0;';
    appendix.innerHTML = `<h1 style="color:#00a2ff;margin:0 0 8px;">Appendix — Changelog (Auto‑extracted)</h1><ul id="chg" style="margin:0 0 0 18px;"></ul>`;
    const chg = appendix.querySelector('#chg');
    const keep = (t) => /Recap|Sprint|Phase|Auto\-bundle|Preview|Audio|Cursy AI|Team Realtime|Vision|Roadmap|Deployment|Safety/i.test(t);
    headings.forEach(h => {
      const t = h.textContent.trim();
      if (keep(t)) {
        const li = document.createElement('li');
        li.innerHTML = `<a href="#${h.id}" style="color:#9fe0ff;text-decoration:none;">${t}</a>`;
        chg.appendChild(li);
      }
    });
    container.appendChild(appendix);

    // Print CSS
    const style = document.createElement('style');
    style.textContent = `
      :root{
        --c-primary:${primary};
        --c-accent:${accent};
        --c-text:${text};
        --c-bg-start:${bgStart};
        --c-bg-end:${bgEnd};
        --c-border:${border};
      }
      body{ color:var(--c-text); background: linear-gradient(135deg,var(--c-bg-start),var(--c-bg-end)); }
      h1,h2{ color:var(--c-primary); }
      a{ color: color-mix(in oklab, var(--c-primary) 75%, white); }
      @media print {
        #pdf-cover { page-break-after: always; }
        #pdf-toc { page-break-after: always; }
        h2 { page-break-before: always; }
        .scroll-indicator, .badge-strip { display:none !important; }
      }
    `;
    document.head.appendChild(style);
  }, new Date().toLocaleDateString(), cfg, projectName);

  // Check what Puppeteer sees AFTER injection
  const afterInjection = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    return {
      bodyLength: bodyText.length,
      first500: bodyText.substring(0, 500),
      hasDamo: bodyText.includes('Damo'),
      hasGameForge: bodyText.includes('GameForge'),
      coverExists: !!document.getElementById('pdf-cover'),
      tocExists: !!document.getElementById('pdf-toc')
    };
  });
  
  const afterDebug = [
    '=== AFTER INJECTION CHECK ===',
    `Body length: ${afterInjection.bodyLength}`,
    `First 500: ${afterInjection.first500}`,
    `Has "Damo"? ${afterInjection.hasDamo}`,
    `Has "GameForge"? ${afterInjection.hasGameForge}`,
    `Cover exists? ${afterInjection.coverExists}`,
    `TOC exists? ${afterInjection.tocExists}`,
    '============================='
  ].join('\n');
  fs.appendFileSync(debugPath, '\n\n' + afterDebug, 'utf8');

  // Full-bleed: remove all page margins and header/footer
  await page.addStyleTag({ content: `@page { margin: ${cfg.pdf&&cfg.pdf.fullBleed?0:'10mm'}; } @media print { html, body { margin: 0 !important; } }` });

  await page.pdf({
    path: outPdf,
    format: 'A4',
    printBackground: true,
    margin: cfg.pdf&&cfg.pdf.fullBleed?{ top:'0',bottom:'0',left:'0',right:'0'}:{ top:'10mm',bottom:'10mm',left:'10mm',right:'10mm' },
    displayHeaderFooter: false
  });

  await browser.close();
  console.log('Saved:', outPdf);
})();
