/**
 * publicPages.js — 111.md §5 — the SEO edge for every non-API GET.
 *
 * WHY: before this middleware, `serveSpa` returned dist/index.html with an implicit
 * HTTP 200 for EVERY non-API GET path. Every typo, every dead backlink, every
 * crawler probe got a soft-404: a 200 response whose body says "Page not found".
 * Search engines treat that as a real page, and the whole URL space of the site
 * looks infinitely large. This middleware makes the HTTP status tell the truth.
 *
 * Five jobs, in decision order (see `classifyRequest`, which is PURE and unit
 * tested against a full path matrix):
 *   (a) real HTTP 404 for a path src/App.jsx does not declare — with the SPA shell
 *       as the BODY, so <NotFound/> still renders exactly as it does today;
 *   (b) 301 /privacy → /terms#privacy (replaces a client-side <Navigate>, which
 *       could only ever produce a soft 200);
 *   (c) `X-Robots-Tag: noindex, nofollow` on every NON_INDEXABLE_PATTERNS surface
 *       (authenticated app, 404-cloaked admin, token URLs) and on registry entries
 *       flagged `indexable: false`;
 *   (d) 301 canonicalisation of trailing-slash and upper-case spellings — REGISTRY
 *       PATHS ONLY, so `/App` stays an honest 404 instead of being laundered into
 *       a 200;
 *   (e) serving build-time prerendered HTML when it exists, with the same brand/
 *       theme injection and the same `Cache-Control: no-cache` as the shell.
 *
 * MOUNT ORDER (server/index.js): express.static → THIS → serveSpa.
 *   - after express.static so real files (assets, favicon, robots.txt, sitemap.xml)
 *     are served untouched, and so a MISSING asset now 404s instead of returning
 *     an HTML shell with a 200;
 *   - before serveSpa so the status code / headers are decided before the shell is
 *     written. For the `spa` and `not-found` outcomes this middleware sets headers
 *     (and, for 404, `res.status(404)`) and then calls `next()` — serveSpa writes
 *     the body, so there is exactly ONE shell-rendering code path.
 *
 * SECURITY: nothing here weakens the /ops + /sift-beta 404 cloak (AdminRoute +
 * requireAdmin still own it) and nothing here is used as access control.
 */

import fs from 'fs';
import path from 'path';
import {
  NOINDEX_DIRECTIVE,
  findRedirect,
  getPublicPage,
  isKnownSpaPath,
  isNonIndexablePath,
  isRegistryPath,
  normalizePath,
} from '../../src/frontend/website/publicPages.js';
import {
  buildThemeInjection,
  distDir,
  getThemeInputs,
  injectThemeTag,
} from './spaTheme.js';

/**
 * Directory (relative to dist/) that holds build-time prerendered pages.
 *
 * Deliberately NOT `dist/<path>/index.html` for the root: `dist/index.html` IS the
 * SPA shell that serveSpa returns for every app route, so writing a prerendered
 * homepage there would make EVERY route serve the landing markup. One uniform
 * location avoids that whole class of bug.
 *
 * `dist/<path>/index.html` is still accepted as a secondary location for non-root
 * paths so a prerenderer that writes the conventional layout also works.
 *
 * robots.txt must Disallow /__prerender/ (the files are reachable as static assets
 * and would otherwise be duplicate URLs; each also carries its own canonical link).
 */
export const PRERENDER_DIR = '__prerender';

/**
 * True when a request URL is reaching into the prerender directory directly.
 * `/__prerender/terms/index.html` is a real file inside dist/, so express.static
 * would happily serve it — a byte-identical DUPLICATE of /terms under a second URL.
 * PURE.
 */
export function isPrerenderDirRequest(pathname) {
  if (typeof pathname !== 'string') return false;
  return pathname === `/${PRERENDER_DIR}` || pathname.startsWith(`/${PRERENDER_DIR}/`);
}

/**
 * Mount BEFORE express.static: the prerender directory is an internal build
 * artefact, never a public URL space. Answering 404 here (rather than relying on a
 * robots.txt Disallow, which is a request not a rule) means the duplicate URLs
 * simply do not exist.
 */
export function blockPrerenderDir(req, res, next) {
  if (!isPrerenderDirRequest(req.path)) return next();
  res.set('X-Robots-Tag', NOINDEX_DIRECTIVE);
  return res.status(404).type('txt').send('Not found');
}

/**
 * dist-relative candidate files for a prerendered path, most-specific first. PURE.
 * @param {string} pathname
 * @returns {string[]}
 */
export function prerenderCandidates(pathname) {
  const rel = pathname === '/' ? '' : String(pathname || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const out = [`${PRERENDER_DIR}/${rel ? `${rel}/` : ''}index.html`];
  if (rel) out.push(`${rel}/index.html`);
  return out;
}

/**
 * Decide what to do with a GET path. PURE — the only IO is the injected
 * `hasPrerenderedFile` predicate, so the whole decision table is unit testable.
 *
 * @param {string} pathname req.path (no query string)
 * @param {object} [opts]
 * @param {(relFile: string) => boolean} [opts.hasPrerenderedFile]
 * @returns {{kind:'skip'}
 *          |{kind:'redirect', status:number, location:string, preserveQuery:boolean}
 *          |{kind:'prerendered', path:string, file:string, noindex:boolean}
 *          |{kind:'spa', path:string, noindex:boolean}
 *          |{kind:'not-found', path:string, noindex:true}}
 */
export function classifyRequest(pathname, opts = {}) {
  const hasPrerenderedFile = opts.hasPrerenderedFile || (() => false);

  // Not a routable path (or the API surface) → not ours.
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return { kind: 'skip' };
  if (pathname === '/api' || pathname.startsWith('/api/')) return { kind: 'skip' };

  // (b) permanent redirects. The target may carry a fragment, so the original
  //     query string is NOT re-appended (it would land after the '#').
  const redirect = findRedirect(pathname);
  if (redirect) {
    return {
      kind: 'redirect',
      status: redirect.status || 301,
      location: redirect.to,
      preserveQuery: !redirect.to.includes('#'),
    };
  }

  // (d) canonicalisation — REGISTRY PATHS ONLY. `/Terms/` → `/terms`, but `/App`
  //     is left alone so it falls through to an honest 404.
  const canonical = normalizePath(pathname);
  if (canonical !== pathname && isRegistryPath(canonical)) {
    return { kind: 'redirect', status: 301, location: canonical, preserveQuery: true };
  }

  // (e) registry pages — prerendered when the build produced a file, else the shell.
  const entry = getPublicPage(pathname);
  if (entry) {
    const noindex = entry.indexable === false;
    for (const file of prerenderCandidates(pathname)) {
      if (hasPrerenderedFile(file)) return { kind: 'prerendered', path: pathname, file, noindex };
    }
    return { kind: 'spa', path: pathname, noindex };
  }

  // (c) known-but-never-indexable surfaces (authenticated, cloaked, tokenised).
  if (isNonIndexablePath(pathname)) return { kind: 'spa', path: pathname, noindex: true };

  // Any other route src/App.jsx declares: normal 200 shell, no robots directive.
  if (isKnownSpaPath(pathname)) return { kind: 'spa', path: pathname, noindex: false };

  // (a) genuinely unknown → real 404 (shell body, so <NotFound/> renders).
  return { kind: 'not-found', path: pathname, noindex: true };
}

/* ─────────────────────────────── file lookup ────────────────────────────── */

/**
 * Existence cache for prerendered files. The build output is immutable for the
 * lifetime of the process, so a hit/miss is resolved once per path.
 * @type {Map<string, string|null>}
 */
const prerenderCache = new Map();

/** Test/ops hook — forget every cached prerender lookup. */
export function resetPrerenderCache() { prerenderCache.clear(); }

/** Absolute path of a dist-relative prerendered file, or null when absent. */
function resolvePrerendered(relFile) {
  if (prerenderCache.has(relFile)) return prerenderCache.get(relFile);
  let resolved = null;
  try {
    const abs = path.resolve(distDir, relFile);
    // Defence in depth: never escape dist/ even if a registry path were malformed.
    if (abs.startsWith(distDir) && fs.statSync(abs).isFile()) resolved = abs;
  } catch { resolved = null; }
  prerenderCache.set(relFile, resolved);
  return resolved;
}

/* ──────────────────────────────── middleware ────────────────────────────── */

/**
 * Express middleware implementing the decision table above.
 * @param {object} [opts]
 * @param {(relFile:string)=>string|null} [opts.resolveFile] override for tests
 */
export function publicPagesMiddleware(opts = {}) {
  const resolveFile = opts.resolveFile || resolvePrerendered;

  return async function publicPages(req, res, next) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();

      const decision = classifyRequest(req.path, {
        hasPrerenderedFile: (rel) => resolveFile(rel) != null,
      });

      switch (decision.kind) {
        case 'redirect': {
          let location = decision.location;
          if (decision.preserveQuery) {
            const q = req.originalUrl ? req.originalUrl.indexOf('?') : -1;
            if (q >= 0) location += req.originalUrl.slice(q);
          }
          res.set('Cache-Control', 'no-cache');
          return res.redirect(decision.status, location);
        }

        case 'prerendered': {
          if (decision.noindex) res.set('X-Robots-Tag', NOINDEX_DIRECTIVE);
          const abs = resolveFile(decision.file);
          if (!abs) return next(); // file vanished between check and read → shell
          let html;
          try { html = fs.readFileSync(abs, 'utf8'); } catch { return next(); }
          const { themeSettings, defaultTheme } = await getThemeInputs();
          const tag = buildThemeInjection(themeSettings, defaultTheme, res.locals && res.locals.cspNonce);
          res.set('Cache-Control', 'no-cache'); // HTML revalidates, like the shell
          return res.type('html').send(injectThemeTag(html, tag));
        }

        case 'not-found': {
          res.set('X-Robots-Tag', NOINDEX_DIRECTIVE);
          // Fall through to serveSpa: it writes the shell (with the theme injection)
          // and preserves the 404 status set here, so <NotFound/> renders under a
          // truthful status. When no build exists serveSpa passes through to the
          // JSON 404 fallback — also correct.
          res.status(404);
          return next();
        }

        case 'spa': {
          if (decision.noindex) res.set('X-Robots-Tag', NOINDEX_DIRECTIVE);
          return next();
        }

        default:
          return next();
      }
    } catch {
      return next(); // never let SEO plumbing take down a page
    }
  };
}

export default publicPagesMiddleware;
