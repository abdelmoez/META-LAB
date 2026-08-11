/**
 * seoAdminController.test.js — 113.md item 8 — Ops › SEO.
 *
 * Two things are worth pinning here, and they are the two halves of the console:
 *
 *   A. REPOSITORY VALIDATION is a pure function of the registry. The checks must
 *      catch the failures they claim to catch (duplicate titles, out-of-bound
 *      descriptions, a missing component file) and must PASS against the real
 *      PUBLIC_PAGES — if the shipped registry cannot satisfy its own console,
 *      one of the two is wrong.
 *
 *   B. EXTERNALLY OBSERVED must recognise the production failure it exists for.
 *      The 111 deploy served the app shell on every route: the homepage title on
 *      a feature URL, no <h1>, no JSON-LD. `evaluateLiveTarget` has to report
 *      that as "not prerendered" and a dead origin as an explicit fetch failure,
 *      never as an unknown or a pass.
 *
 * No network and no database: the fetch used by probeLiveTarget is injected.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PUBLIC_PAGES } from '../../../src/frontend/website/publicPages.js';
import {
  REPO_ROOT, DESCRIPTION_MIN, DESCRIPTION_MAX, LIVE_CHECK_MAX_BYTES,
  inSitemap, registryInventory, registryCounts, registryChecks,
  countSitemapUrls, countLlmsLinks, extractTitle, decodeTitleEntities, hasH1, hasJsonLdMarker,
  buildArtifactReport, artifactChecks, readVerificationTokens, appShellTitle,
  liveCheckTargets, evaluateLiveTarget, probeLiveTarget,
} from '../../../server/controllers/seoAdminController.js';

const componentExists = (rel) => (typeof rel === 'string' && rel ? existsSync(resolve(REPO_ROOT, rel)) : false);

/**
 * A fetch Response double with a REAL readable body, because probeLiveTarget now
 * caps the read while streaming instead of buffering with `await res.text()`. A
 * mock that only offers text() would silently exercise a path production never
 * takes.
 */
function streamRes(status, text, { chunkSize = 64 * 1024 } = {}) {
  const buf = Buffer.from(String(text), 'utf8');
  let at = 0;
  return {
    status,
    body: {
      getReader: () => ({
        read: async () => {
          if (at >= buf.length) return { done: true, value: undefined };
          const value = buf.subarray(at, at + chunkSize);
          at += value.length;
          return { done: false, value };
        },
        cancel: async () => { at = buf.length; },
      }),
    },
  };
}

const page = (over = {}) => ({
  path: '/x',
  title: 'A title',
  description: 'x'.repeat(140),
  canonicalPath: '/x',
  component: 'src/frontend/pages/Landing.jsx',
  indexable: true,
  ...over,
});

const byId = (checks, id) => checks.find((c) => c.id === id);

describe('registry inventory (pure)', () => {
  it('one row per entry, with the sitemap flag read defensively', () => {
    const rows = registryInventory([
      page({ path: '/a', canonicalPath: '/a' }),
      page({ path: '/b', canonicalPath: '/b', indexable: false }),
      page({ path: '/c', canonicalPath: '/c', sitemap: false }),
    ]);
    expect(rows.map((r) => r.path)).toEqual(['/a', '/b', '/c']);
    expect(rows.map((r) => r.inSitemap)).toEqual([true, false, false]);
    expect(rows[0].descriptionLength).toBe(140);
    expect(rows[0].canonicalUrl).toBe('https://pecanrev.com/a');
  });

  it('inSitemap: noindex OR an explicit sitemap:false keeps a page out', () => {
    expect(inSitemap({ indexable: true })).toBe(true);
    expect(inSitemap({ indexable: false })).toBe(false);
    expect(inSitemap({ indexable: true, sitemap: false })).toBe(false);
  });

  it('counts split indexable / noindex / sitemap-excluded', () => {
    const counts = registryCounts(registryInventory([
      page({ path: '/a', canonicalPath: '/a' }),
      page({ path: '/b', canonicalPath: '/b', indexable: false }),
      page({ path: '/c', canonicalPath: '/c', sitemap: false }),
      page({ path: '/d', canonicalPath: '/d', jsonLd: () => ({}) }),
    ]));
    expect(counts).toMatchObject({ total: 4, indexable: 3, noindex: 1, sitemapExcluded: 1, inSitemap: 2, withJsonLd: 1 });
  });
});

describe('registry checks catch the failures they advertise', () => {
  it('duplicate titles among indexable pages fail', () => {
    const checks = registryChecks(registryInventory([
      page({ path: '/a', canonicalPath: '/a', title: 'Same' }),
      page({ path: '/b', canonicalPath: '/b', title: 'Same' }),
    ]));
    expect(byId(checks, 'unique-titles').status).toBe('fail');
    expect(byId(checks, 'unique-titles').offenders).toContain('Same');
  });

  it('a noindex page may reuse a title without failing the check', () => {
    const checks = registryChecks(registryInventory([
      page({ path: '/a', canonicalPath: '/a', title: 'Same' }),
      page({ path: '/b', canonicalPath: '/a', title: 'Same', indexable: false }),
    ]));
    expect(byId(checks, 'unique-titles').status).toBe('pass');
  });

  it('descriptions outside the SERP bound fail, and are named with their length', () => {
    const checks = registryChecks(registryInventory([
      page({ path: '/short', canonicalPath: '/short', description: 'too short' }),
      page({ path: '/long', canonicalPath: '/long', description: 'y'.repeat(DESCRIPTION_MAX + 1) }),
    ]));
    const c = byId(checks, 'description-length');
    expect(c.status).toBe('fail');
    expect(c.offenders).toEqual(['/short (9)', `/long (${DESCRIPTION_MAX + 1})`]);
  });

  it('a missing canonical fails', () => {
    const checks = registryChecks(registryInventory([page({ canonicalPath: undefined })]));
    expect(byId(checks, 'canonical-present').status).toBe('fail');
  });

  it('a component path that does not resolve fails; an unchecked one is "unknown", never a pass', () => {
    const missing = registryChecks(registryInventory(
      [page({ component: 'src/frontend/pages/DoesNotExist.jsx' })],
      { componentExists },
    ));
    expect(byId(missing, 'components-exist').status).toBe('fail');

    const unchecked = registryChecks(registryInventory([page()]));
    expect(byId(unchecked, 'components-exist').status).toBe('unknown');
  });
});

describe('the SHIPPED registry satisfies its own console', () => {
  const inventory = registryInventory(PUBLIC_PAGES, { componentExists });
  const checks = registryChecks(inventory);

  it('every registry check passes against PUBLIC_PAGES', () => {
    for (const c of checks) {
      expect(c.status, `${c.id}: ${c.detail} ${JSON.stringify(c.offenders)}`).toBe('pass');
    }
  });

  it('every description sits inside the documented bound', () => {
    for (const row of inventory) {
      expect(row.descriptionLength, row.path).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
      expect(row.descriptionLength, row.path).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it('the inventory covers the whole registry', () => {
    expect(inventory).toHaveLength(PUBLIC_PAGES.length);
    expect(registryCounts(inventory).total).toBe(PUBLIC_PAGES.length);
  });
});

describe('artefact parsing (pure)', () => {
  it('counts sitemap URLs and llms.txt page links', () => {
    expect(countSitemapUrls('<urlset><url><loc>a</loc></url><url><loc>b</loc></url></urlset>')).toBe(2);
    expect(countSitemapUrls(null)).toBe(0);
    expect(countLlmsLinks('# PecanRev\n\n## Pages\n- [A](https://x/a): d\n- [B](https://x/b): d\n')).toBe(2);
    expect(countLlmsLinks('no links here')).toBe(0);
  });

  it('artifactChecks fails an absent build rather than staying silent', () => {
    const empty = {
      distPresent: false,
      prerender: { present: false, pageCount: 0, generatedAt: null },
      sitemap: { present: false, urlCount: 0, generatedAt: null },
      robots: { present: false, hasSitemapLine: false },
      llms: { present: false, pageLinkCount: 0 },
    };
    const checks = artifactChecks(empty);
    expect(checks.every((c) => c.status === 'fail')).toBe(true);
    expect(byId(checks, 'prerender-present').detail).toMatch(/npm run build/);
  });

  it('a sitemap whose URL count disagrees with the registry fails', () => {
    const report = {
      distPresent: true,
      prerender: { present: true, pageCount: 5, generatedAt: '2026-08-10T00:00:00.000Z' },
      sitemap: { present: true, urlCount: 4, generatedAt: null },
      robots: { present: true, hasSitemapLine: true },
      llms: { present: true, pageLinkCount: 4 },
    };
    expect(byId(artifactChecks(report, { expectedSitemapUrls: 4 }), 'sitemap-present').status).toBe('pass');
    expect(byId(artifactChecks(report, { expectedSitemapUrls: 9 }), 'sitemap-present').status).toBe('fail');
  });

  it('buildArtifactReport reads the real dist/ without throwing when it is absent', () => {
    const report = buildArtifactReport();
    expect(typeof report.distPresent).toBe('boolean');
    expect(typeof report.prerender.pageCount).toBe('number');
    expect(typeof report.sitemap.urlCount).toBe('number');
  });
});

describe('verification tokens — presence only, never a claim of verification', () => {
  const v = readVerificationTokens();

  it('reports one of exactly two honest states per engine', () => {
    expect(['token_present', 'not_configured']).toContain(v.google.state);
    expect(['token_present', 'not_configured']).toContain(v.bing.state);
  });

  it('states plainly that coverage/impressions cannot be shown', () => {
    expect(v.note).toMatch(/no Search Console/i);
    expect(v.note).toMatch(/cannot be shown/i);
  });
});

describe('live check — the shell-vs-prerender detector', () => {
  const HOME_TITLE = PUBLIC_PAGES.find((e) => e.path === '/').title;

  it('probes the homepage, one feature page and the two crawler files', () => {
    const targets = liveCheckTargets();
    expect(targets.map((t) => t.id)).toEqual(['home', 'feature', 'sitemap', 'robots']);
    expect(targets[0].expectTitle).toBe(HOME_TITLE);
    expect(targets[1].path).toMatch(/^\/features\/[^/]+$/);
    expect(targets[1].expectTitle).not.toBe(HOME_TITLE);
  });

  it('recognises a properly prerendered page', () => {
    const r = evaluateLiveTarget(
      { id: 'home', kind: 'page', path: '/', expectTitle: 'T' },
      { status: 200, body: '<html><head><title>T</title></head><body><h1>Hi</h1><script type="application/ld+json">{"@type":"WebSite"}</script></body></html>' },
    );
    expect(r).toMatchObject({ status: 200, titleMatches: true, h1Present: true, jsonLdPresent: true, servedTitle: 'T' });
  });

  it('THE 111 PRODUCTION FAILURE: a feature URL served the app shell — wrong title, no h1, no JSON-LD', () => {
    const shell = `<html><head><title>${HOME_TITLE}</title></head><body><div id="root"></div></body></html>`;
    const r = evaluateLiveTarget(
      { id: 'feature', kind: 'page', path: '/features/screening', expectTitle: 'Title, Abstract & Full-Text Screening Software | PecanRev' },
      { status: 200, body: shell },
    );
    expect(r.status).toBe(200);          // a 200 is NOT evidence of anything
    expect(r.titleMatches).toBe(false);
    expect(r.h1Present).toBe(false);
    expect(r.jsonLdPresent).toBe(false);
    expect(r.servedTitle).toBe(HOME_TITLE);
  });

  it('reads sitemap and robots facts', () => {
    expect(evaluateLiveTarget({ id: 'sitemap', kind: 'sitemap', path: '/sitemap.xml' }, { status: 200, body: '<loc>a</loc><loc>b</loc>' }).urlCount).toBe(2);
    const robots = evaluateLiveTarget({ id: 'robots', kind: 'robots', path: '/robots.txt' }, { status: 200, body: 'User-agent: *\nAllow: /\nSitemap: https://pecanrev.com/sitemap.xml\n' });
    expect(robots).toMatchObject({ hasUserAgentLine: true, hasSitemapLine: true });
  });

  it('a failed fetch is reported verbatim, never as unknown or pass', async () => {
    const boom = async () => { throw new Error('getaddrinfo ENOTFOUND pecanrev.com'); };
    const r = await probeLiveTarget('https://pecanrev.com', { id: 'home', kind: 'page', path: '/' }, { fetchImpl: boom });
    expect(r.ok).toBe(false);
    expect(r.status).toBeNull();
    expect(r.error).toMatch(/^fetch failed: /);
    expect(r.error).toMatch(/ENOTFOUND/);
    expect(r).not.toHaveProperty('titleMatches');
  });

  it('a non-200 keeps its status so the UI can say "HTTP error" rather than "shell"', async () => {
    const fetchImpl = async () => streamRes(404, 'Not found');
    const r = await probeLiveTarget('https://pecanrev.com', { id: 'home', kind: 'page', path: '/', expectTitle: 'T' }, { fetchImpl });
    expect(r).toMatchObject({ ok: true, status: 404, titleMatches: false });
  });

  it('builds the URL from the base and the target path', async () => {
    const seen = [];
    const fetchImpl = async (url) => { seen.push(url); return streamRes(200, ''); };
    await probeLiveTarget('https://example.test', { id: 'robots', kind: 'robots', path: '/robots.txt' }, { fetchImpl });
    expect(seen).toEqual(['https://example.test/robots.txt']);
  });
});

describe('live check — the response body is capped WHILE streaming', () => {
  it('reads a normal page through the stream and evaluates it', async () => {
    const html = '<html><head><title>T</title></head><body><h1>Hi</h1>{"@type":"WebPage"}</body></html>';
    const r = await probeLiveTarget(
      'https://pecanrev.com',
      { id: 'home', kind: 'page', path: '/', expectTitle: 'T' },
      { fetchImpl: async () => streamRes(200, html, { chunkSize: 7 }) },
    );
    expect(r).toMatchObject({ ok: true, status: 200, titleMatches: true, h1Present: true, jsonLdPresent: true });
  });

  it('a hostile/huge body is ABANDONED mid-stream and reported, never buffered whole or graded truncated', async () => {
    // 4MB in 256kB chunks: the reader must stop and cancel past the 1.5MB cap
    // rather than pulling the lot into memory and slicing afterwards.
    const chunk = 'x'.repeat(256 * 1024);
    let pulled = 0;
    let cancelled = false;
    const body = {
      getReader: () => ({
        read: async () => {
          if (pulled >= 16) return { done: true, value: undefined };
          pulled += 1;
          return { done: false, value: Buffer.from(chunk) };
        },
        cancel: async () => { cancelled = true; },
      }),
    };
    const r = await probeLiveTarget(
      'https://pecanrev.com',
      { id: 'home', kind: 'page', path: '/', expectTitle: 'T' },
      { fetchImpl: async () => ({ status: 200, body }) },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/read cap/i);
    expect(r.error).toMatch(/not evaluated/i);
    expect(r).not.toHaveProperty('titleMatches'); // nothing is graded from a truncated body
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(16);            // the whole body was never read
    expect(pulled * chunk.length).toBeLessThan(LIVE_CHECK_MAX_BYTES + chunk.length);
  });

  it('the cap is a real byte budget, not a post-hoc slice', () => {
    expect(LIVE_CHECK_MAX_BYTES).toBe(1_500_000);
  });
});

describe('the homepage title trap — a title match on "/" proves nothing', () => {
  it('appShellTitle reads index.html, and it IS the registry title for "/"', () => {
    const shell = appShellTitle();
    expect(shell).toBeTruthy();
    // If these ever diverge the trap is gone, but so is the reason for the flag —
    // this assertion is the thing that tells us which world we are in.
    expect(shell).toBe(PUBLIC_PAGES.find((e) => e.path === '/').title);
  });

  it('flags the homepage target: expected title === the app shell default', () => {
    const shell = appShellTitle();
    const r = evaluateLiveTarget(
      { id: 'home', kind: 'page', path: '/', expectTitle: shell },
      { status: 200, body: `<html><head><title>${shell}</title></head><body><div id="root"></div></body></html>`, shellTitle: shell },
    );
    expect(r.titleMatches).toBe(true);        // …and it is worth nothing
    expect(r.titleIsShellDefault).toBe(true);
    expect(r.h1Present).toBe(false);
    expect(r.jsonLdPresent).toBe(false);
  });

  it('does NOT flag a page whose expected title is its own', () => {
    const shell = appShellTitle();
    const feature = PUBLIC_PAGES.find((e) => /^\/features\/[^/]+$/.test(e.path));
    const r = evaluateLiveTarget(
      { id: 'feature', kind: 'page', path: feature.path, expectTitle: feature.title },
      { status: 200, body: `<title>${feature.title}</title><h1>x</h1>{"@type":"WebPage"}`, shellTitle: shell },
    );
    expect(r.titleIsShellDefault).toBe(false);
    expect(r.titleMatches).toBe(true);
  });

  it('without a known shell title the flag is false, never a guess', () => {
    const r = evaluateLiveTarget({ id: 'home', kind: 'page', path: '/', expectTitle: 'T' }, { status: 200, body: '<title>T</title>' });
    expect(r.titleIsShellDefault).toBe(false);
  });
});

describe('tiny HTML predicates (pure)', () => {
  it('extractTitle trims and tolerates attributes and a missing tag', () => {
    expect(extractTitle('<title data-x="1">  Hello  </title>')).toBe('Hello');
    expect(extractTitle('<html></html>')).toBeNull();
    expect(extractTitle(null)).toBeNull();
  });

  it('extractTitle DECODES entities — the homepage title contains a literal "&"', () => {
    const registryTitle = PUBLIC_PAGES.find((e) => e.path === '/').title;
    expect(registryTitle).toContain('&');
    // What a real server actually returns (React escapes the ampersand).
    const served = `<title>${registryTitle.replace(/&/g, '&amp;')}</title>`;
    expect(extractTitle(served)).toBe(registryTitle);
  });

  it('decodeTitleEntities handles the named and numeric references, ampersand last', () => {
    expect(decodeTitleEntities('A &amp; B')).toBe('A & B');
    expect(decodeTitleEntities('&lt;tag&gt; &quot;q&quot; &apos;a&apos;')).toBe('<tag> "q" \'a\'');
    expect(decodeTitleEntities('&#8212; &#x2014;')).toBe('— —');
    // An encoded &amp;lt; is the TEXT "&lt;", not the character '<'.
    expect(decodeTitleEntities('&amp;lt;')).toBe('&lt;');
  });

  it('hasH1 needs a real tag, not the word h1', () => {
    expect(hasH1('<h1>x</h1>')).toBe(true);
    expect(hasH1('<h1 class="a">x</h1>')).toBe(true);
    expect(hasH1('the h1 is missing')).toBe(false);
    expect(hasH1('<h10>x</h10>')).toBe(false);
  });

  it('hasJsonLdMarker looks for the @type key a JSON-LD graph always carries', () => {
    expect(hasJsonLdMarker('{"@type":"WebPage"}')).toBe(true);
    expect(hasJsonLdMarker('<div id="root"></div>')).toBe(false);
  });
});
