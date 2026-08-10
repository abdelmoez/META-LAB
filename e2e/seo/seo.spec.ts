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
 *     dist/__prerender/<path>/index.html for all 17 entries. This is what a crawler
 *     receives.
 *   - RUNTIME — src/frontend/website/usePageHead.js applies the head from inside the
 *     React tree. Landing (`/`), Terms, Login, Register and BetaWaitlist call it
 *     directly; the twelve content pages under src/frontend/website/pages/ get it
 *     from PageShell, which resolves `useLocation().pathname` against the registry
 *     (getPublicPage ∘ stripTrailingSlash) and hands the entry to usePageHead.
 *
 * That closes the gap this header used to describe: on the Vite dev server, and
 * after any client-side navigation, every indexable route now applies its own
 * title/description/canonical instead of inheriting index.html's shell head. So
 * RUNTIME_HEAD_PATHS is simply INDEXABLE_PATHS — group 1 and group 2 assert the same
 * 16 routes from the two different directions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GROUP 1 — RUNTIME HEAD (baseURL, dev + prod)
 * ─────────────────────────────────────────────────────────────────────────────
 * All 16 indexable routes, driven by usePageHead. Every read here is retry-based:
 * these components are `lazy()`, so their chunk — and the effect — executes AFTER
 * the load event `page.goto()` resolves on. A bare `page.title()` reads the shell
 * default and races hydration. `waitForRuntimeHead()` is the gate; there are no
 * fixed waits anywhere in this file. The group closes with a real client-side
 * navigation, which is the case a `goto()` per route cannot cover: only a SPA route
 * change proves the head is re-applied rather than merely set once on first paint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GROUP 2 — CRAWLER-VISIBLE HEAD (Express only, all 16 routes)
 * ─────────────────────────────────────────────────────────────────────────────
 * Navigates to the Express origin, where the prerendered document is served, and
 * asserts the head a crawler actually receives: distinct title, description,
 * canonical, exactly one <h1>, parseable JSON-LD.
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

/**
 * The 16 `indexable: true` entries of src/frontend/website/publicPages.js.
 *
 * Hardcoded on purpose: the registry is ESM `.js` under src/ and this suite is TS
 * compiled by Playwright's own transform, so importing it would drag the whole
 * website module graph into the test process. tests/unit/seo/publicPagesRegistry.test.js
 * is the guard that keeps this list honest — it asserts the indexable count, so a
 * 17th public page fails there and sends you back here.
 *
 * `/beta-waitlist` is the one registry entry deliberately absent: `indexable: false`.
 */
const INDEXABLE_PATHS = [
  '/',
  '/terms',
  '/login',
  '/register',
  '/features',
  '/features/search-engine',
  '/features/screening',
  '/features/data-extraction',
  '/features/meta-analysis',
  '/features/manuscript',
  '/resources',
  '/resources/what-is-a-systematic-review',
  '/resources/prisma-2020-explained',
  '/resources/title-and-abstract-screening',
  '/resources/how-to-run-a-meta-analysis',
  '/about',
] as const;

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

/* ═══════════ GROUP 2 — crawler-visible head, all 16 (Express only) ═══════ */

anonTest.describe('SEO — crawler-visible head (prerendered, Express only)', () => {
  for (const path of INDEXABLE_PATHS) {
    anonTest(`${path} is served with a complete, crawlable head`, async ({ page }) => {
      anonTest.skip(!server, skipReason);
      const res = await page.goto(new URL(path, API_URL).href);
      expect(res?.status(), `${path} should not be an error page`).toBeLessThan(400);
      await assertHeadContract(page, path);
    });
  }

  anonTest('@smoke every indexable route is served a distinct <title>', async ({ page }) => {
    anonTest.skip(!server, skipReason);
    const seen = new Map<string, string>();
    for (const path of INDEXABLE_PATHS) {
      await page.goto(new URL(path, API_URL).href);
      await expect
        .poll(() => page.title(), { message: `${path} should set a substantive <title>` })
        .toMatch(/\S.{5,}/s);
      const title = (await page.title()).trim();
      const clash = seen.get(title);
      expect(clash, `${path} duplicates the <title> already used by ${clash}`).toBeUndefined();
      seen.set(title, path);
    }
    expect(seen.size).toBe(INDEXABLE_PATHS.length);
  });
});

/* ═════════════ GROUP 3 — server-owned crawler semantics ═════════════════ */

anonTest.describe('SEO — server crawler semantics (Express only)', () => {
  anonTest('@smoke an unknown path is a real HTTP 404, not a soft 404', async () => {
    anonTest.skip(!server, skipReason);
    const res = await server!.get('/this-path-does-not-exist-111-seo');
    expect(res.status(), 'unknown paths must not answer 200 with a "Page not found" body').toBe(404);
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
    expect(html, 'prerendered <h1>').toMatch(/<h1[\s>]/);
  });

  anonTest('the internal prerender directory is not a public URL space', async () => {
    anonTest.skip(!server, skipReason);
    // dist/__prerender/* are real files; serving them would duplicate every page.
    expect((await server!.get('/__prerender/terms/index.html')).status()).toBe(404);
  });
});
