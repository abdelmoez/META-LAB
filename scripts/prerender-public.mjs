#!/usr/bin/env node
/**
 * scripts/prerender-public.mjs — 111.md §3 — BUILD-TIME PRERENDERER.
 *
 * Runs immediately after `vite build` (see the `build` script in package.json).
 * For every entry in THE public-route registry (src/frontend/website/publicPages.js)
 * it renders the real React page to HTML and writes a crawlable document to
 * `dist/__prerender/<path>/index.html`. The Express edge middleware serves those
 * files to crawlers; browsers keep getting the normal SPA shell.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE RULES THIS SCRIPT EXISTS TO ENFORCE
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. dist/index.html is NEVER written. It is the app shell and the CSP hash
 *    source; a prerendered page is an ADDITIONAL artefact, never a replacement.
 *
 * 2. The prerendered document is the freshly built dist/index.html with EXACTLY
 *    five families of head tag removed (title, meta[name=description],
 *    link[rel=canonical], meta[property^=og:], meta[name^=twitter:]) and the
 *    per-page head spliced in before </head>. Everything else — charset, viewport,
 *    theme-color, icons, manifest, preconnects, the font stylesheet, the inline
 *    bootstrap scripts, the critical <style>, the hashed Vite module script — stays
 *    BYTE-EXACT. The SPA must BOOT on a prerendered page exactly as it boots on the
 *    shell.
 *
 *    Note the precise wording: BOOT, not hydrate. src/main.jsx mounts with
 *    `createRoot`, not `hydrateRoot`, so the markup below is NOT hydrated — React
 *    discards it on the first commit and renders the same tree again. The markup is
 *    what a non-JS crawler reads and what the visitor sees before the chunk lands;
 *    main.jsx preloads the matched route so the re-render is synchronous and nothing
 *    flashes. See docs/seo-overhaul-111.md §5 for why true hydration is not on the
 *    table without restructuring both trees.
 *
 * 3. PERMANENT GUARD (step d): server/security/csp.js computes `script-src` SHA-256
 *    hashes from dist/index.html at runtime and applies them to every HTML response,
 *    including these prerendered ones. If a prerendered page's inline scripts ever
 *    diverged from the shell's by even one byte, the browser would refuse to run the
 *    theme bootstrap and every prerendered page would flash the wrong theme (or, for
 *    the module script, fail to boot). The guard compares the extracted inline script
 *    bodies and exits nonzero on any mismatch. Do not weaken it.
 *
 * A page that is INDEXABLE and fails to render is a hard build failure. There are no
 * silent skips: a missing prerender is invisible in the UI and only shows up weeks
 * later as a page that never got indexed.
 */

import { execFile } from 'node:child_process';
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

import {
  PUBLIC_PAGES,
  indexablePages,
  sitemapPages,
  SITE_ORIGIN,
  absoluteUrl,
} from '../src/frontend/website/publicPages.js';
import { sitemapXml, robotsTxt, llmsTxt } from './seo/generators.js';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const SHELL = path.join(DIST, 'index.html');
const OUT_DIR = path.join(DIST, '__prerender');

/**
 * prompt48 — the beta-waitlist homepage swap. `BetaWaitlistGate` swaps the Beta
 * Waitlist page onto '/' at RUNTIME for unauthenticated visitors when the flag is
 * on, but the registry's '/' entry points at Landing.jsx and that is what we
 * prerender: the flag is a live server setting, so baking either variant into the
 * build would be wrong half the time. This env var is accepted (and validated) so a
 * future build can opt into rendering the waitlist page at '/' without a signature
 * change; today it deliberately changes nothing.
 */
const ASSUME_WAITLIST = process.env.PRERENDER_ASSUME_WAITLIST === '1'
  || process.env.PRERENDER_ASSUME_WAITLIST === 'true';

/* ────────────────────────────── small helpers ───────────────────────────── */

const log = (...args) => console.log('[prerender]', ...args);
const fail = (...args) => { console.error('[prerender] ERROR', ...args); };

/** dist path for a route: '/' → dist/__prerender/index.html, '/a/b' → .../a/b/index.html */
function outputPathFor(routePath) {
  const rel = routePath === '/' ? '' : routePath.replace(/^\/+/, '');
  return path.join(OUT_DIR, rel, 'index.html');
}

/**
 * Last commit date of a file, ISO-8601, or '' when unknown.
 * NEVER falls back to "now": an invented <lastmod> is a lie told to a crawler.
 */
async function gitLastModified(relFile) {
  if (!relFile) return '';
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-1', '--format=%cI', '--', relFile],
      { cwd: ROOT, windowsHide: true },
    );
    return String(stdout || '').trim();
  } catch {
    return ''; // no git, shallow clone, untracked file → omit <lastmod>
  }
}

/* ─────────────────────── step (d): the CSP inline-script guard ──────────── */

/** Script `type` values a browser actually EXECUTES (and that CSP therefore hashes). */
const EXECUTABLE_SCRIPT_TYPES = new Set([
  '', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript',
  'application/ecmascript', 'text/jscript',
]);

/**
 * Every INLINE, EXECUTABLE script body in a document, in source order.
 *
 * HTML comments are stripped first — index.html's CSP comment literally contains the
 * text `<script>`, and without this the naive regex would pair that with the real
 * bootstrap's `</script>` and swallow the whole head.
 *
 * `<script type="application/ld+json">` is DATA, not script: the browser never
 * executes it, `script-src` does not apply, and it legitimately differs per page.
 */
function inlineScriptBodies(html) {
  const source = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const re = /<script([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  const bodies = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    const attrs = m[1] || '';
    if (/\ssrc\s*=/i.test(attrs)) continue; // external: hashed by URL, not by content
    const typeMatch = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
    const type = ((typeMatch && (typeMatch[1] ?? typeMatch[2] ?? typeMatch[3])) || '').trim().toLowerCase();
    if (!EXECUTABLE_SCRIPT_TYPES.has(type)) continue;
    bodies.push(m[2]);
  }
  return bodies;
}

/* ───────────────────────── step (b): head stripping ─────────────────────── */

/**
 * The ONLY tags removed from the shell. `[^>]*` matches newlines in JS, so these
 * handle index.html's multi-line, prettier-wrapped <meta> tags.
 */
const STRIP_PATTERNS = [
  /<title>[\s\S]*?<\/title>\s*/i,
  /<meta[^>]*\bname="description"[^>]*>\s*/gi,
  /<link[^>]*\brel="canonical"[^>]*>\s*/gi,
  /<meta[^>]*\bproperty="og:[^>]*>\s*/gi,
  /<meta[^>]*\bname="twitter:[^>]*>\s*/gi,
];

function stripManagedHead(html) {
  let out = html;
  for (const re of STRIP_PATTERNS) out = out.replace(re, '');
  return out;
}

/* ─────────────────── step (a): bundle a Node-side SSR entry ─────────────── */

/**
 * Generate the SSR entry source. The component paths are baked in as LITERAL
 * dynamic imports so esbuild can actually follow them (a computed specifier would
 * be left as a runtime import of a .jsx file Node cannot load).
 */
function buildEntrySource(entries) {
  const cases = entries.map((e) => {
    const spec = `./${e.component.replace(/\\/g, '/')}`;
    return `  ${JSON.stringify(e.path)}: () => import(${JSON.stringify(spec)}),`;
  }).join('\n');

  return `// GENERATED by scripts/prerender-public.mjs — do not edit, do not commit.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PUBLIC_PAGES, SITE_ORIGIN } from './src/frontend/website/publicPages.js';
import { buildHead, renderHeadHtml } from './src/frontend/website/usePageHead.js';
import { ThemeProvider } from './src/frontend/theme/ThemeContext.jsx';
import { AuthProvider } from './src/frontend/context/AuthContext.jsx';

const LOADERS = {
${cases}
};

const BY_PATH = new Map(PUBLIC_PAGES.map((e) => [e.path, e]));

export async function renderRoute(routePath) {
  const entry = BY_PATH.get(routePath);
  if (!entry) throw new Error('no registry entry for ' + routePath);
  const loader = LOADERS[routePath];
  if (!loader) throw new Error('no bundled component for ' + routePath);
  const mod = await loader();
  const Component = mod.default;
  if (typeof Component !== 'function' && typeof Component !== 'object') {
    throw new Error('module for ' + routePath + ' has no default export component');
  }
  // Provider nesting mirrors src/App.jsx (ThemeProvider > AuthProvider). The router
  // is outermost so <Link>/useLocation resolve against the route being rendered.
  const tree = createElement(
    MemoryRouter,
    { initialEntries: [entry.path] },
    createElement(
      ThemeProvider,
      null,
      createElement(
        AuthProvider,
        null,
        createElement(Component, { ...(entry.componentProps || {}) }),
      ),
    ),
  );
  const body = renderToString(tree);
  const head = renderHeadHtml(buildHead(entry, { origin: SITE_ORIGIN }));
  return { body, head };
}
`;
}

async function buildSsrBundle(entries) {
  const entryFile = path.join(ROOT, `.prerender-entry.${process.pid}.mjs`);
  const outFile = path.join(ROOT, `.prerender-bundle.${process.pid}.mjs`);
  const cssFile = outFile.replace(/\.mjs$/, '.css');

  // Declared BEFORE the first write so an esbuild error or a failed dynamic import
  // cannot leave scratch files sitting in the repo root.
  const cleanup = () => {
    for (const f of [entryFile, outFile, cssFile]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* best effort */ }
    }
  };

  try {
    fs.writeFileSync(entryFile, buildEntrySource(entries), 'utf8');

    const nodeExternals = [
      ...builtinModules,
      ...builtinModules.map((m) => `node:${m}`),
    ];

    await esbuild.build({
      entryPoints: [entryFile],
      outfile: outFile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node18',
      jsx: 'automatic',
      logLevel: 'silent',
      // react / react-dom / react-router-dom are bundled IN on purpose: the SSR entry
      // must see exactly the same module instances the app does.
      external: nodeExternals,
      // react-dom/server is CommonJS and requires 'stream' lazily. Bundled to ESM
      // there is no ambient `require`, and esbuild's shim throws "Dynamic require of
      // stream is not supported". Handing it a real createRequire fixes that without
      // externalising react-dom (which would fork the React the providers use).
      banner: {
        js: [
          "import { createRequire as __prerenderCreateRequire } from 'node:module';",
          'const require = __prerenderCreateRequire(import.meta.url);',
        ].join('\n'),
      },
      define: {
        // Vite `define`s these; outside Vite they would be free identifiers.
        __APP_VERSION__: JSON.stringify('prerender'),
        'process.env.NODE_ENV': JSON.stringify('production'),
        'import.meta.env.MODE': JSON.stringify('production'),
        'import.meta.env.DEV': 'false',
        'import.meta.env.PROD': 'true',
        'import.meta.env.SSR': 'true',
        'import.meta.env.BASE_URL': JSON.stringify('/'),
      },
      loader: {
        // Assets are irrelevant to markup; never let a missing loader fail the build.
        '.css': 'empty',
        '.svg': 'empty',
        '.png': 'empty',
        '.jpg': 'empty',
        '.jpeg': 'empty',
        '.gif': 'empty',
        '.webp': 'empty',
        '.woff': 'empty',
        '.woff2': 'empty',
      },
    });

    // Windows: a bare absolute path is not a valid ESM specifier — must be a file: URL.
    const mod = await import(pathToFileURL(outFile).href);
    return { mod, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

/* ──────────────────────────────── main ──────────────────────────────────── */

async function main() {
  if (!fs.existsSync(SHELL)) {
    fail(`dist/index.html not found at ${SHELL}. Run \`vite build\` first.`);
    process.exit(1);
  }

  const template = fs.readFileSync(SHELL, 'utf8');

  // (e) The server splices its nonce'd theme <script> immediately after this exact
  // token. Losing it would silently disable the server-side theme injection.
  if (!template.includes('<head>')) {
    fail('dist/index.html has no literal `<head>` token — the server theme injection would break.');
    process.exit(1);
  }
  if (!template.includes('<div id="root"></div>')) {
    fail('dist/index.html has no `<div id="root"></div>` mount point to inject markup into.');
    process.exit(1);
  }

  const stripped = stripManagedHead(template);
  const templateScripts = inlineScriptBodies(template);
  log(`shell inline executable scripts: ${templateScripts.length}`);
  if (ASSUME_WAITLIST) log('PRERENDER_ASSUME_WAITLIST is set (accepted, currently a no-op).');

  const entries = PUBLIC_PAGES;
  const { mod, cleanup } = await buildSsrBundle(entries);

  const written = [];
  const failures = [];
  let guardChecked = 0;

  try {
    for (const entry of entries) {
      let rendered;
      try {
        rendered = await mod.renderRoute(entry.path);
      } catch (err) {
        failures.push({ entry, reason: `render threw: ${err && err.stack ? err.stack : err}` });
        continue;
      }

      const { body, head } = rendered;
      if (!body || !body.trim()) {
        failures.push({ entry, reason: 'rendered an empty body' });
        continue;
      }
      // EXACTLY one <h1>, not merely one-or-more. A page with two h1s tells a crawler
      // it has two top-level subjects; a presence-only check let that ship green.
      // e2e/seo/seo.spec.ts asserts the same count on the served document.
      const h1Count = (body.match(/<h1[\s>]/gi) || []).length;
      if (h1Count !== 1) {
        failures.push({
          entry,
          reason: `rendered markup contains ${h1Count} <h1> elements — exactly one is required`,
        });
        continue;
      }

      let html = stripped
        .replace('</head>', `${head}\n  </head>`)
        .replace('<div id="root"></div>', `<div id="root">${body}</div>`);

      if (!html.includes('<head>')) {
        failures.push({ entry, reason: 'output lost the literal `<head>` token' });
        continue;
      }

      // (d) THE GUARD. Byte-identical inline executable scripts, or the build fails.
      const outScripts = inlineScriptBodies(html);
      guardChecked += 1;
      if (outScripts.length !== templateScripts.length) {
        failures.push({
          entry,
          reason: `CSP guard: inline script COUNT changed (shell ${templateScripts.length} → page ${outScripts.length})`,
        });
        continue;
      }
      const diverged = outScripts.findIndex((s, i) => s !== templateScripts[i]);
      if (diverged !== -1) {
        failures.push({
          entry,
          reason: `CSP guard: inline script #${diverged + 1} body differs from dist/index.html — its SHA-256 would no longer match the CSP script-src hash`,
        });
        continue;
      }

      const outFile = outputPathFor(entry.path);
      if (path.resolve(outFile) === path.resolve(SHELL)) {
        failures.push({ entry, reason: 'refusing to overwrite dist/index.html' });
        continue;
      }
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, html, 'utf8');
      written.push({ entry, outFile, bytes: Buffer.byteLength(html, 'utf8') });
    }
  } finally {
    cleanup();
  }

  for (const { entry, outFile, bytes } of written) {
    log(`  ok   ${entry.path.padEnd(42)} → ${path.relative(ROOT, outFile).replace(/\\/g, '/')} (${bytes} B)`);
  }

  // Non-indexable entries may be excluded without failing the build; an INDEXABLE
  // page that did not render is a hard failure — a silent skip is invisible until
  // the page never gets indexed.
  let hardFailure = false;
  for (const { entry, reason } of failures) {
    const indexable = entry.indexable !== false;
    if (indexable) {
      hardFailure = true;
      fail(`INDEXABLE page ${entry.path} FAILED to prerender: ${reason}`);
    } else {
      console.warn(`[prerender] warn non-indexable page ${entry.path} skipped: ${reason}`);
    }
  }

  log(`CSP inline-script guard: ${guardChecked}/${guardChecked} page(s) byte-identical to dist/index.html`);
  log(`wrote ${written.length}/${entries.length} prerendered documents to dist/__prerender/`);

  if (hardFailure) {
    fail('aborting: at least one indexable page failed to prerender.');
    process.exit(1);
  }

  /* ── (f) sitemap.xml / robots.txt / llms.txt ── */

  // 113 §2 — TWO different sets on purpose. sitemap.xml is a crawl submission and
  // drops `sitemap: false` entries (/login, /register: indexable, but no content a
  // crawler benefits from fetching); llms.txt keeps them, because "where do I sign
  // in" is a question an assistant should be able to answer.
  const indexable = indexablePages();
  const sitemapEntries = [];
  for (const entry of sitemapPages()) {
    const loc = absoluteUrl(entry.canonicalPath || entry.path, SITE_ORIGIN);
    const lastmod = entry.lastmodSource ? await gitLastModified(entry.lastmodSource) : '';
    sitemapEntries.push({
      loc,
      ...(lastmod ? { lastmod } : {}),
      ...(entry.changefreq ? { changefreq: entry.changefreq } : {}),
      ...(typeof entry.priority === 'number' ? { priority: entry.priority } : {}),
    });
  }
  const sitemap = sitemapXml(sitemapEntries);
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap, 'utf8');
  const withLastmod = sitemapEntries.filter((e) => e.lastmod).length;
  log(`sitemap.xml: ${sitemapEntries.length} URLs (${withLastmod} with a real git <lastmod>)`);

  const robots = robotsTxt();
  fs.writeFileSync(path.join(ROOT, 'public', 'robots.txt'), robots, 'utf8');
  // public/ is copied by Vite BEFORE this script runs, so the current dist needs the
  // same file written directly or this build would ship the previous robots.txt.
  fs.writeFileSync(path.join(DIST, 'robots.txt'), robots, 'utf8');
  log('robots.txt: rewritten (public/robots.txt + dist/robots.txt)');

  const llms = llmsTxt(indexable.map((entry) => ({
    title: entry.title,
    url: absoluteUrl(entry.canonicalPath || entry.path, SITE_ORIGIN),
    description: entry.description,
    group: entry.navGroup,
  })));
  fs.writeFileSync(path.join(DIST, 'llms.txt'), llms, 'utf8');
  const llmsListed = (llms.match(/^- \[/gm) || []).length;
  if (llmsListed !== indexable.length) {
    fail(`llms.txt listed ${llmsListed} of ${indexable.length} indexable pages — a page was dropped by grouping.`);
    process.exit(1);
  }
  log(`llms.txt: ${indexable.length} pages listed`);
}

main().catch((err) => {
  fail(err && err.stack ? err.stack : err);
  process.exit(1);
});
