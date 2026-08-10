/**
 * prerenderPreload.test.js — 111.md §3 — the prerendered document must not flash.
 *
 * WHAT THIS PROTECTS
 * ──────────────────
 * server/middleware/publicPages.js serves dist/__prerender/<path>/index.html to every
 * client (there is no user-agent check anywhere in server/), so a visitor arriving
 * from a search result sees the real article painted immediately. src/main.jsx then
 * mounts with `createRoot`, which DISCARDS the container's children on its first
 * commit — acceptable, since it re-renders the same tree — but only while that first
 * render does not SUSPEND. If the matched route is a bare `lazy()`, the commit that
 * clears `#root` also paints `<RouteFallback/>`: a full-viewport spinner where the
 * article was, on precisely the pages this round added for Core Web Vitals.
 *
 * The fix is `preloadableLazy` + `preloadPublicRoute` (src/App.jsx), awaited by
 * main.jsx before mounting a prerendered document. Both halves are pinned here by
 * SOURCE SCAN rather than by import: pulling src/App.jsx into a unit test would drag
 * the entire application module graph (workspace, ops console, screening) into the
 * test process for a wiring assertion.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PUBLIC_PAGES, getPublicPage } from '../../../src/frontend/website/publicPages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src/main.jsx'), 'utf8');

/** The `PRERENDERED_ROUTES = { … }` object literal in src/App.jsx, as path → identifier. */
function prerenderedRoutes() {
  const block = /const PRERENDERED_ROUTES = \{([\s\S]*?)\n\};/.exec(appSource);
  expect(block, 'src/App.jsx must declare a PRERENDERED_ROUTES map').toBeTruthy();
  const out = {};
  for (const [, p, ident] of block[1].matchAll(/'([^']+)':\s*([A-Za-z0-9_]+),/g)) out[p] = ident;
  return out;
}

/** How a route component is declared in src/App.jsx: 'lazy', 'preloadableLazy' or 'eager'. */
function declarationKind(identifier) {
  const re = new RegExp(`const\\s+${identifier}\\s*=\\s*(preloadableLazy|lazy)\\(`);
  const m = re.exec(appSource);
  if (m) return m[1];
  return new RegExp(`^import\\s+${identifier}\\s+from`, 'm').test(appSource) ? 'eager' : 'unknown';
}

describe('prerendered routes are preloaded before React mounts', () => {
  const routes = prerenderedRoutes();

  it('covers every prerendered registry path whose component is code-split', () => {
    // '/' is the one legitimate omission: Landing is imported eagerly, so it can
    // never suspend and has no chunk to wait for.
    const expected = PUBLIC_PAGES.map((e) => e.path).filter((p) => p !== '/');
    expect(Object.keys(routes).sort()).toEqual(expected.sort());
  });

  it('every mapped route resolves to a real registry entry', () => {
    for (const p of Object.keys(routes)) {
      expect(getPublicPage(p), `${p} is preloaded but not in PUBLIC_PAGES`).toBeTruthy();
    }
  });

  it('every mapped component is declared with preloadableLazy, not lazy', () => {
    // A bare lazy() has no .preload(), so preloadPublicRoute would silently no-op and
    // the flash would come back without a single test going red.
    for (const [p, ident] of Object.entries(routes)) {
      expect(declarationKind(ident), `${p} → ${ident} must be preloadableLazy`).toBe('preloadableLazy');
    }
  });

  it('Landing — the one eagerly imported public page — stays eager', () => {
    expect(declarationKind('Landing')).toBe('eager');
    expect(routes['/']).toBeUndefined();
  });

  it('preloadPublicRoute is exported and never rejects', () => {
    expect(appSource).toContain('export function preloadPublicRoute(pathname)');
    // A chunk that fails to load must not stop the app from mounting.
    expect(appSource).toMatch(/preload\s*=\s*\(\)\s*=>\s*resolve\(\)\.catch\(/);
  });

  it('the element type is pinned per mount so a resolved chunk cannot remount the page', () => {
    // Swapping <Lazy> for the raw component mid-life would unmount and remount the
    // whole page; the ref freezes the choice at mount.
    expect(appSource).toMatch(/const pinned = useRef\(loaded\)/);
  });
});

describe('src/main.jsx boots a prerendered document without blanking it', () => {
  it('preloads the matched route before mounting, and only when markup was served', () => {
    expect(mainSource).toContain('import App, { preloadPublicRoute } from "./App.jsx"');
    expect(mainSource).toMatch(/container\.firstElementChild/);
    expect(mainSource).toMatch(/preloadPublicRoute\(window\.location\.pathname\)\.then\(mount, mount\)/);
  });

  it('a shell document (empty #root) still mounts synchronously', () => {
    // The Vite dev server and every app route ship `<div id="root"></div>`; delaying
    // their mount on a network round-trip would be a straight regression.
    expect(mainSource).toMatch(/\}\s*else\s*\{\s*\n\s*mount\(\);\s*\n\s*\}/);
  });

  it('documents that this is createRoot, not hydrateRoot', () => {
    // If someone switches to hydrateRoot the trees must be made to match first —
    // see docs/seo-overhaul-111.md §5. Until then the honest word is "boot".
    expect(mainSource, 'no hydrateRoot CALL (the comment naming it is fine)')
      .not.toMatch(/\bhydrateRoot\s*\(/);
    expect(mainSource).toContain('createRoot, not hydrateRoot');
  });
});
