/**
 * seo.spec.ts — 111.md — the public, crawlable surface of PecanRev.
 *
 * Three groups, on two different origins. Read this before adding a test.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE EACH PAGE'S HEAD COMES FROM (this drives the whole file's shape)
 * ─────────────────────────────────────────────────────────────────────────────
 * The registry feeds two independent head paths, and BOTH are now complete:
 *
 *   - BUILD TIME — scripts/prerender-public.mjs splices the head into
 *     dist/__prerender/<path>/index.html for EVERY registry entry. This is what a
 *     crawler receives.
 *   - RUNTIME — src/frontend/website/usePageHead.js applies the head from inside the
 *     React tree. Landing (`/`), Terms, Login, Register and BetaWaitlist call it
 *     directly; every content page under src/frontend/website/pages/ gets it from
 *     PageShell, which resolves `useLocation().pathname` against the registry
 *     (getPublicPage ∘ stripTrailingSlash) and hands the entry to usePageHead.
 *
 * That closes the gap this header used to describe: on the Vite dev server, and
 * after any client-side navigation, every indexable route now applies its own
 * title/description/canonical instead of inheriting index.html's shell head. So
 * RUNTIME_HEAD_PATHS is simply INDEXABLE_PATHS — group 1 and group 2 assert the same
 * routes from the two different directions, and both lists are DERIVED from the
 * registry (113.md §5) rather than transcribed from it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GROUP 1 — RUNTIME HEAD (baseURL, dev + prod)
 * ─────────────────────────────────────────────────────────────────────────────
 * Every indexable route, driven by usePageHead. Every read here is retry-based:
 * these components are `lazy()`, so their chunk — and the effect — executes AFTER
 * the load event `page.goto()` resolves on. A bare `page.title()` reads the shell
 * default and races hydration. `waitForRuntimeHead()` is the gate; there are no
 * fixed waits anywhere in this file. The group closes with a real client-side
 * navigation, which is the case a `goto()` per route cannot cover: only a SPA route
 * change proves the head is re-applied rather than merely set once on first paint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GROUP 2 — CRAWLER-VISIBLE HEAD (Express only, every indexable route)
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches the raw bytes from the Express origin, where the prerendered document is
 * served, and asserts the head a crawler actually receives: distinct title,
 * description, canonical, exactly one <h1>, parseable JSON-LD. One looped test over
 * plain HTTP rather than a browser navigation per route — see the comment above the
 * group for why that is both faster and closer to the thing being tested.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GROUP 3 — SERVER-OWNED CRAWLER SEMANTICS (Express only)
 * ─────────────────────────────────────────────────────────────────────────────
 * Real 404s, the 301s, X-Robots-Tag and the three crawler files, all decided by
 * server/middleware/publicPages.js + `vite build` artefacts. THE VITE DEV SERVER
 * IMPLEMENTS ALMOST NONE OF IT — vite.config.js mirrors only PERMANENT_REDIRECTS
 * (the /privacy 301); an unknown path in dev is a 200 SPA shell, there is no
 * X-Robots-Tag, no dist/__prerender and no sitemap/robots/llms unless a build ran.
 *
 * Groups 2 and 3 therefore target API_URL (:3001) — the Express server, which serves
 * the built SPA + dist assets whenever dist/ exists — and share one probe
 * (GET /robots.txt) in a file-level beforeAll. If it fails, both groups self-skip
 * with the reason rather than failing a dev-only run. The request context uses
 * `maxRedirects: 0`: a followed 301 is an unasserted 301.
 *
 * Everything is logged-out (`anonTest`): PublicRoute bounces an authenticated session
 * off `/`, `/login` and `/register` straight to `/app`.
 *
 * NOTE the split with the unit suite: tests/unit/seo/ already covers classifyRequest's
 * path matrix, the generators' serialisation and the head builder. This file only
 * asserts that the wiring is real over HTTP.
 */
import { request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';
import { anonTest, expect } from '../fixtures/stitch-test';
import { API_URL } from '../helpers/env';
import { PUBLIC_PAGES } from '../../src/frontend/website/publicPages.js';

/**
 * Every `indexable: true` entry of src/frontend/website/publicPages.js — DERIVED.
 *
 * This list used to be sixteen hardcoded strings, on the theory that importing the
 * registry would drag the website module graph into the test process. It does not:
 * publicPages.js is dependency-free BY CONTRACT (see its header — no React, no
 * `process`, no `fs`, no app module), which is exactly why the Express server and
 * vite.config.js can both import it. The cost of hardcoding was real, though — the
 * site went from 16 public pages to 33 and this suite silently kept asserting the
 * original sixteen, i.e. the seventeen newest pages, the ones most likely to be
 * broken, were the ones nothing checked.
 *
 * `/beta-waitlist` is the one registry entry deliberately absent: `indexable: false`.
 */
const INDEXABLE_PATHS: string[] = PUBLIC_PAGES
  .filter((entry: { indexable?: boolean }) => entry.indexable !== false)
  .map((entry: { path: string }) => entry.path);

/**
 * The indexable routes whose component applies `usePageHead` (see the file header).
 * Since PageShell wired the content pages up, that is every indexable route — the
 * alias is kept so group 1 still reads as "the runtime-head set", and so a route
 * that ever loses its runtime head has one obvious place to be carved back out.
 */
const RUNTIME_HEAD_PATHS = INDEXABLE_PATHS;

/**
 * `/login` and `/register` carry no `jsonLd` in the registry — they are thin
 * navigational pages with nothing truthful to say in schema.org terms, and 111.md
 * forbids inventing structured data. Any ld+json they DO emit must still parse.
 */
const JSON_LD_EXEMPT = new Set<string>(['/login', '/register']);

/** The production origin every canonical is built from (registry SITE_ORIGIN). */
const SITE_ORIGIN = 'https://pecanrev.com';

/** The absolute canonical for a registry path. */
const canonicalFor = (path: string) => (path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`);

/* ───────────────────────── shared Express probe ─────────────────────────── */

let server: APIRequestContext | null = null;
let skipReason = '';

anonTest.beforeAll(async () => {
  let ctx: APIRequestContext | null = null;
  try {
    ctx = await playwrightRequest.newContext({
      baseURL: API_URL,
      storageState: { cookies: [], origins: [] },
      maxRedirects: 0,
    });
    const robots = await ctx.get('/robots.txt');
    if (!robots.ok() || !(await robots.text()).includes('User-agent')) {
      skipReason =
        `${API_URL} did not serve a built robots.txt (status ${robots.status()}). ` +
        'These assertions need the Express server over a `npm run build` dist/ — ' +
        'the Vite dev server implements none of them.';
      await ctx.dispose();
      return;
    }
    server = ctx;
  } catch (err) {
    if (ctx) await ctx.dispose().catch(() => {});
    skipReason = `${API_URL} is not reachable (${(err as Error).message}).`;
  }
});

anonTest.afterAll(async () => {
  if (server) await server.dispose();
  server = null;
});

/* ─────────────────────────── shared assertions ──────────────────────────── */

/**
 * Wait until `usePageHead` has applied THIS page's head.
 *
 * `og:url` is the signal: the shell ships `https://pecanrev.com` (no trailing slash)
 * and usePageHead overwrites it with the page's canonical — which is
 * `https://pecanrev.com/` even for `/`. So the applied value differs from the shell
 * for EVERY path, including the homepage, whose title and canonical happen to equal
 * the shell's. `toHaveAttribute` is web-first, so this polls.
 */
async function waitForRuntimeHead(page: Page, path: string): Promise<void> {
  await expect(
    page.locator('head meta[property="og:url"]'),
    `usePageHead should apply ${path}'s head (lazy chunk may still be loading)`,
  ).toHaveAttribute('content', canonicalFor(path));
}

/** The full head contract for one indexable route. Every read is retry-based. */
async function assertHeadContract(page: Page, path: string): Promise<void> {
  await expect(
    page.locator('head link[rel="canonical"]'),
    `${path} canonical should be the absolute production URL`,
  ).toHaveAttribute('href', canonicalFor(path));

  await expect(
    page.locator('head meta[name="description"]'),
    `${path} should carry a substantive meta description`,
  ).toHaveAttribute('content', /\S.{19,}/s);

  await expect
    .poll(() => page.title(), { message: `${path} should set a substantive <title>` })
    .toMatch(/\S.{5,}/s);

  // The prerenderer enforces the same rule at build time.
  await expect(page.locator('h1'), `${path} should render exactly one <h1>`).toHaveCount(1);

  const ld = page.locator('head script[type="application/ld+json"]');
  if (!JSON_LD_EXEMPT.has(path)) {
    await expect(ld, `${path} should emit a JSON-LD graph`).not.toHaveCount(0);
  }
  for (const raw of await ld.allTextContents()) {
    expect(() => JSON.parse(raw), `${path} JSON-LD should parse`).not.toThrow();
    expect(typeof JSON.parse(raw), `${path} JSON-LD should be an object`).toBe('object');
  }
}

/* ══════════════════ GROUP 1 — runtime head (dev + prod) ══════════════════ */

anonTest.describe('SEO — runtime page head (usePageHead)', () => {
  for (const path of RUNTIME_HEAD_PATHS) {
    anonTest(`${path} applies its head at runtime`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should not be an error page`).toBeLessThan(400);
      await waitForRuntimeHead(page, path);
      await assertHeadContract(page, path);
    });
  }

  anonTest('@smoke navigating in-app from / to a content page re-applies the head', async ({ page }) => {
    // The regression PageShell's usePageHead call fixes: before it, ArticlePage
    // routes kept index.html's shell head ("PecanRev …", canonical `/`) and only the
    // prerendered document was correct — invisible in production, wrong everywhere a
    // human or a headless renderer actually navigates.
    //
    // 111.md §23 makes every public cross-page link a real <a href> (crawlable, works
    // with JS off), so this click is a document navigation into the React app rather
    // than a history.pushState — which is precisely the path that has no prerendered
    // head on the dev server, and therefore the one that proves the runtime wiring.
    await page.goto('/');
    await waitForRuntimeHead(page, '/');

    await page.locator('footer a[href="/features/screening"]').first().click();

    await expect(page).toHaveURL(/\/features\/screening$/);
    await expect(page).toHaveTitle(/screening/i);
    await waitForRuntimeHead(page, '/features/screening');
    await assertHeadContract(page, '/features/screening');
  });
});

/* ═══════ GROUP 2 — crawler-visible head, every indexable route (Express) ═══ */

/**
 * One looped RAW-HTTP test rather than one browser test per route.
 *
 * Deriving INDEXABLE_PATHS took this group from 16 routes to 33, and a `page.goto()`
 * per route would have roughly doubled the suite's wall time to assert something a
 * browser is the wrong instrument for: these are the BYTES a crawler receives, before
 * any script runs. `server.get()` reads exactly those bytes, so the loop is both
 * faster and a closer match to the thing under test. Group 1 still drives a real
 * browser, because the runtime head genuinely requires one.
 */
const titleOf = (html: string) => (/<title>([^<]*)<\/title>/i.exec(html) || [, ''])[1].trim();
const jsonLdBlocksOf = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

anonTest.describe('SEO — crawler-visible head (prerendered, Express only)', () => {
  anonTest('@smoke every indexable route serves a complete, distinct, crawlable head', async () => {
    anonTest.skip(!server, skipReason);
    expect(INDEXABLE_PATHS.length, 'the registry should expose a real public surface')
      .toBeGreaterThanOrEqual(30);

    const seenTitle = new Map<string, string>();
    for (const path of INDEXABLE_PATHS) {
      const res = await server!.get(path);
      expect(res.status(), `${path} should be served`).toBe(200);
      const html = await res.text();

      const title = titleOf(html);
      expect(title.length, `${path} should set a substantive <title>`).toBeGreaterThan(5);
      const clash = seenTitle.get(title);
      expect(clash, `${path} duplicates the <title> already used by ${clash}`).toBeUndefined();
      seenTitle.set(title, path);

      const description = /<meta name="description" content="([^"]*)"/i.exec(html);
      expect(description?.[1]?.length ?? 0, `${path} should carry a meta description`)
        .toBeGreaterThan(20);

      expect(html, `${path} canonical should be the absolute production URL`)
        .toContain(`<link rel="canonical" href="${canonicalFor(path)}"`);

      // The prerenderer enforces the same rule at build time.
      expect((html.match(/<h1[\s>]/gi) || []).length, `${path} should render exactly one <h1>`)
        .toBe(1);

      const blocks = jsonLdBlocksOf(html);
      if (!JSON_LD_EXEMPT.has(path)) {
        expect(blocks.length, `${path} should emit a JSON-LD graph`).toBeGreaterThan(0);
      }
      for (const raw of blocks) {
        expect(() => JSON.parse(raw), `${path} JSON-LD should parse`).not.toThrow();
        expect(typeof JSON.parse(raw), `${path} JSON-LD should be an object`).toBe('object');
      }
    }
    expect(seenTitle.size).toBe(INDEXABLE_PATHS.length);
  });

  anonTest('a prerendered page is a real DOM once a browser parses it', async ({ page }) => {
    anonTest.skip(!server, skipReason);
    // The loop above reads bytes; this proves those bytes parse into the document a
    // rendering crawler walks. One representative page is enough — the shape is
    // identical for all of them, and the per-page assertions are covered above.
    const res = await page.goto(new URL('/features/screening', API_URL).href);
    expect(res?.status(), 'should not be an error page').toBeLessThan(400);
    await assertHeadContract(page, '/features/screening');
  });
});

/* ═════════════ GROUP 3 — server-owned crawler semantics ═════════════════ */

anonTest.describe('SEO — server crawler semantics (Express only)', () => {
  anonTest('@smoke an unknown path is a real HTTP 404, not a soft 404', async () => {
    anonTest.skip(!server, skipReason);
    const res = await server!.get('/this-path-does-not-exist-111-seo');
    expect(res.status(), 'unknown paths must not answer 200 with a "Page not found" body').toBe(404);
  });

  anonTest('@smoke an unknown child of an indexable prefix is a real 404 too', async () => {
    anonTest.skip(!server, skipReason);
    // /features and /resources are the only two subtrees sitemap.xml invites crawlers
    // into, and neither has a parameterised route. Before the registry gate, every
    // /features/<anything> answered 200 with the <NotFound/> body and no
    // X-Robots-Tag — an unbounded indexable URL space with duplicate shell metadata.
    for (const path of ['/features/does-not-exist', '/resources/does-not-exist',
      '/features/screening/does-not-exist']) {
      const res = await server!.get(path);
      expect(res.status(), `${path} must be a real 404, not a soft one`).toBe(404);
      expect(res.headers()['x-robots-tag'] || '', `${path} noindex`).toContain('noindex');
    }
    // …while the real children are untouched.
    for (const path of ['/features/screening', '/resources/prisma-2020-explained']) {
      expect((await server!.get(path)).status(), `${path} must still be served`).toBe(200);
    }
  });

  anonTest('/privacy 301s to /terms#privacy', async () => {
    anonTest.skip(!server, skipReason);
    const res = await server!.get('/privacy');
    expect(res.status()).toBe(301);
    expect(res.headers()['location'] || '').toContain('/terms#privacy');
  });

  anonTest('trailing-slash and upper-case registry spellings 301 to the canonical path', async () => {
    anonTest.skip(!server, skipReason);
    for (const variant of ['/terms/', '/Terms']) {
      const res = await server!.get(variant);
      expect(res.status(), `${variant} should canonicalise`).toBe(301);
      expect(res.headers()['location'] || '', `${variant} → /terms`).toContain('/terms');
    }
    // …but a path the registry does not know stays an honest 404 rather than being
    // laundered into a 200 by the canonicaliser.
    expect((await server!.get('/App')).status()).toBe(404);
  });

  anonTest('@smoke /app carries X-Robots-Tag: noindex', async () => {
    anonTest.skip(!server, skipReason);
    const res = await server!.get('/app');
    expect(res.headers()['x-robots-tag'] || '').toContain('noindex');
  });

  anonTest('/sitemap.xml is XML and lists the screening feature page', async () => {
    anonTest.skip(!server, skipReason);
    const res = await server!.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] || '').toContain('xml');
    const body = await res.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('/features/screening');
  });

  anonTest('/robots.txt disallows the ops console and points at the sitemap', async () => {
    anonTest.skip(!server, skipReason);
    const body = await (await server!.get('/robots.txt')).text();
    expect(body).toContain('Disallow: /ops');
    expect(body).toContain('Sitemap:');
  });

  anonTest('/llms.txt is served', async () => {
    anonTest.skip(!server, skipReason);
    const res = await server!.get('/llms.txt');
    expect(res.status()).toBe(200);
    expect((await res.text()).trim().length).toBeGreaterThan(0);
  });

  anonTest('a prerendered page is crawlable with no JavaScript at all', async () => {
    anonTest.skip(!server, skipReason);
    // The raw bytes an HTML-only crawler sees — no hydration, no usePageHead.
    const html = await (await server!.get('/features/screening')).text();
    expect(html, 'prerendered <title>').toMatch(/<title>[^<]{5,}<\/title>/);
    expect(html, 'prerendered canonical').toContain(`${SITE_ORIGIN}/features/screening`);
    // EXACTLY one h1, matching the build-time guard in scripts/prerender-public.mjs.
    // Presence-only would pass a page that declares two top-level subjects.
    expect((html.match(/<h1[\s>]/gi) || []).length, 'prerendered <h1> count').toBe(1);
  });

  anonTest('the internal prerender directory is not a public URL space', async () => {
    anonTest.skip(!server, skipReason);
    // dist/__prerender/* are real files; serving them would duplicate every page.
    expect((await server!.get('/__prerender/terms/index.html')).status()).toBe(404);
  });
});
