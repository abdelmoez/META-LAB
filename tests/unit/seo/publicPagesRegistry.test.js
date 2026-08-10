/**
 * publicPagesRegistry.test.js — 111.md §1 — integrity of THE public-route registry.
 *
 * Two kinds of assertion:
 *  1. Shape/uniqueness invariants over PUBLIC_PAGES (cheap, catch copy-paste bugs
 *     when other agents append entries).
 *  2. SOURCE SCANS over src/App.jsx. These are the load-bearing ones: they pin the
 *     registry to the router so a newly added <Route> cannot silently start
 *     returning a hard 404 (KNOWN_SPA_PREFIXES) and so every noindex rule keeps
 *     pointing at a route that actually exists (NON_INDEXABLE_PATTERNS).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PUBLIC_PAGES,
  KNOWN_SPA_PREFIXES,
  NON_INDEXABLE_PATTERNS,
  PERMANENT_REDIRECTS,
  SITE_ORIGIN,
  SITE_DESCRIPTION,
  absoluteUrl,
  breadcrumbJsonLd,
  faqJsonLd,
  findRedirect,
  getPublicPage,
  indexablePages,
  isKnownSpaPath,
  isNonIndexablePath,
  isRegistryPath,
  isServeableSpaPath,
  matchPattern,
  normalizePath,
  organizationJsonLd,
  softwareApplicationJsonLd,
  stripTrailingSlash,
  webSiteJsonLd,
} from '../../../src/frontend/website/publicPages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

/** Every `path="…"` declared on a <Route> in src/App.jsx, minus the `*` catch-all. */
function appRoutePaths() {
  const out = [];
  const re = /<Route\s+[^>]*path=(?:"([^"]*)"|\{'([^']*)'\})/g;
  let m;
  while ((m = re.exec(appSource)) !== null) {
    const p = m[1] != null ? m[1] : m[2];
    if (p && p !== '*') out.push(p);
  }
  return out;
}

/** Turn `/invite/:token` into a concrete probe path. */
function concretePath(routePath) {
  return routePath.replace(/:[A-Za-z0-9_]+/g, 'sample-value');
}

describe('publicPages registry — entry shape', () => {
  it('is non-empty and every entry carries the required contract fields', () => {
    expect(PUBLIC_PAGES.length).toBeGreaterThan(0);
    for (const e of PUBLIC_PAGES) {
      expect(typeof e.path, `path of ${e.path}`).toBe('string');
      expect(typeof e.title, `title of ${e.path}`).toBe('string');
      expect(typeof e.description, `description of ${e.path}`).toBe('string');
      expect(typeof e.canonicalPath, `canonicalPath of ${e.path}`).toBe('string');
      expect(typeof e.component, `component of ${e.path}`).toBe('string');
      expect(typeof e.indexable, `indexable of ${e.path}`).toBe('boolean');
      expect(e.title.length, `title length of ${e.path}`).toBeGreaterThan(10);
      expect(e.description.length, `description length of ${e.path}`).toBeGreaterThan(40);
    }
  });

  /**
   * The ENTRY CONTRACT at the top of publicPages.js states 110-165 characters, and
   * that bound is the whole point: Google truncates a description around 155-160, so
   * an over-long one loses its tail in the SERP. The bound previously existed only as
   * prose — nothing failed when twelve of seventeen entries blew past it — so it is
   * asserted here, over EVERY entry, against the documented numbers.
   */
  it('every description honours the documented 110-165 character contract', () => {
    const violations = PUBLIC_PAGES
      .filter((e) => e.description.length < 110 || e.description.length > 165)
      .map((e) => `${e.path} (${e.description.length})`);
    expect(violations, `descriptions outside 110-165 chars: ${violations.join(', ')}`).toEqual([]);
  });

  it('the documented contract and the asserted bound are the same numbers', () => {
    // Guards against the other half of the drift: silently widening the prose.
    const source = fs.readFileSync(
      path.join(repoRoot, 'src/frontend/website/publicPages.js'), 'utf8',
    );
    expect(source).toContain('meta[name=description]. Honest, 110-165 chars.');
  });

  it('paths and canonicalPaths are lowercase, rooted and slash-free', () => {
    for (const e of PUBLIC_PAGES) {
      for (const p of [e.path, e.canonicalPath]) {
        expect(p.startsWith('/'), `${p} must start with /`).toBe(true);
        expect(p, `${p} must be lowercase`).toBe(p.toLowerCase());
        if (p !== '/') expect(p.endsWith('/'), `${p} must not end with /`).toBe(false);
      }
    }
  });

  it('every `component` module actually exists on disk', () => {
    for (const e of PUBLIC_PAGES) {
      expect(fs.existsSync(path.join(repoRoot, e.component)), `missing ${e.component}`).toBe(true);
    }
  });

  it('every `lastmodSource` points at a real file (honest lastmod, never faked)', () => {
    for (const e of PUBLIC_PAGES) {
      if (!e.lastmodSource) continue;
      expect(fs.existsSync(path.join(repoRoot, e.lastmodSource)), `missing ${e.lastmodSource}`).toBe(true);
    }
  });

  it('sitemap hints are in range when present', () => {
    for (const e of PUBLIC_PAGES) {
      if (e.priority != null) {
        expect(e.priority).toBeGreaterThanOrEqual(0);
        expect(e.priority).toBeLessThanOrEqual(1);
      }
      if (e.changefreq != null) {
        expect(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'])
          .toContain(e.changefreq);
      }
    }
  });
});

describe('publicPages registry — uniqueness', () => {
  it('paths are unique', () => {
    const paths = PUBLIC_PAGES.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('indexable entries have unique titles, descriptions and canonicals', () => {
    // Non-indexable entries may deliberately share a canonical with the original
    // they duplicate (that is what a canonical is FOR) — hence the filter.
    const pages = indexablePages();
    for (const field of ['title', 'description', 'canonicalPath']) {
      const values = pages.map((e) => e[field]);
      const dupes = values.filter((v, i) => values.indexOf(v) !== i);
      expect(dupes, `duplicate ${field}: ${dupes.join(' | ')}`).toEqual([]);
    }
  });

  it('a non-indexable entry canonicalises to an indexable page', () => {
    const indexableCanonicals = new Set(indexablePages().map((e) => e.canonicalPath));
    for (const e of PUBLIC_PAGES.filter((x) => x.indexable === false)) {
      expect(indexableCanonicals.has(e.canonicalPath), `${e.path} canonical is orphaned`).toBe(true);
    }
  });
});

describe('publicPages registry — pinned to src/App.jsx', () => {
  it('KNOWN_SPA_PREFIXES covers EVERY route declared in App.jsx', () => {
    const uncovered = appRoutePaths().filter((p) => !isKnownSpaPath(concretePath(p)));
    expect(uncovered, `add these to KNOWN_SPA_PREFIXES or they will hard-404: ${uncovered.join(', ')}`)
      .toEqual([]);
  });

  it('every KNOWN_SPA_PREFIXES rule corresponds to a real App.jsx route', () => {
    const routes = appRoutePaths();
    for (const rule of KNOWN_SPA_PREFIXES) {
      const hit = routes.some((r) => r === rule.pattern || r.startsWith(`${rule.pattern}/`));
      expect(hit, `${rule.pattern} matches no route in App.jsx (stale entry?)`).toBe(true);
    }
  });

  /**
   * A `kind: 'prefix'` rule is a promise that SOMETHING under it is dynamic. When
   * nothing is, the prefix hands a 200 + <NotFound/> body to every unknown child —
   * the soft 404 the whole middleware exists to kill. So: a prefix whose App.jsx
   * children are all static must be registryGated, and a prefix with a real
   * parameterised child must NOT be (gating it would 404 live routes).
   */
  it('a prefix is registryGated exactly when it has no parameterised App.jsx child', () => {
    const routes = appRoutePaths();
    for (const rule of KNOWN_SPA_PREFIXES.filter((r) => r.kind === 'prefix')) {
      const children = routes.filter((r) => r.startsWith(`${rule.pattern}/`));
      const hasParam = children.some((r) => r.includes(':'));
      expect(
        rule.registryGated === true,
        `${rule.pattern}: registryGated should be ${!hasParam} `
        + `(children: ${children.join(', ') || 'none'})`,
      ).toBe(!hasParam);
    }
  });

  it('every static child of a registryGated prefix is a registry path', () => {
    // Otherwise the gate would 404 a route App.jsx genuinely declares.
    const gated = KNOWN_SPA_PREFIXES.filter((r) => r.registryGated);
    expect(gated.length, 'the gate must actually be in use').toBeGreaterThan(0);
    for (const rule of gated) {
      for (const route of appRoutePaths().filter((r) => r.startsWith(`${rule.pattern}/`))) {
        expect(isRegistryPath(route), `${route} is routed but not in PUBLIC_PAGES`).toBe(true);
      }
    }
  });

  it('isServeableSpaPath 404s unknown children of a gated prefix, not real ones', () => {
    for (const p of ['/features', '/features/screening', '/resources',
      '/resources/prisma-2020-explained']) {
      expect(isServeableSpaPath(p), `${p} must stay serveable`).toBe(true);
    }
    for (const p of ['/features/bogus', '/features/screening/x', '/resources/nope']) {
      expect(isKnownSpaPath(p), `${p} is still route-covered`).toBe(true);
      expect(isServeableSpaPath(p), `${p} must not be served a 200`).toBe(false);
    }
    // Ungated prefixes are unaffected — their dynamic children are real routes.
    expect(isServeableSpaPath('/app/project/1')).toBe(true);
    expect(isServeableSpaPath('/invite/tok')).toBe(true);
  });

  it('every NON_INDEXABLE_PATTERNS rule matches at least one App.jsx route', () => {
    const routes = appRoutePaths();
    for (const rule of NON_INDEXABLE_PATTERNS) {
      const hit = routes.some((r) => r === rule.pattern || r.startsWith(`${rule.pattern}/`));
      expect(hit, `${rule.pattern} matches no route in App.jsx`).toBe(true);
      expect(typeof rule.reason, `${rule.pattern} must document why`).toBe('string');
    }
  });

  it('every registry path is a known SPA path and is NOT non-indexable-by-pattern', () => {
    for (const e of PUBLIC_PAGES) {
      expect(isKnownSpaPath(e.path), `${e.path} is not in KNOWN_SPA_PREFIXES`).toBe(true);
      const patternHit = NON_INDEXABLE_PATTERNS.some((r) => matchPattern(e.path, r));
      expect(patternHit, `${e.path} is both a registry page and a noindex pattern`).toBe(false);
    }
  });

  it('the admin surfaces stay 404-cloaked AND noindex (security invariant)', () => {
    expect(appSource).toContain('<AdminRoute>');
    for (const p of ['/ops', '/sift-beta', '/sift-beta/projects/x']) {
      expect(isNonIndexablePath(p), `${p} must be noindex`).toBe(true);
      expect(isRegistryPath(p), `${p} must never be a registry page`).toBe(false);
    }
  });

  it('/privacy is a redirect, not a registry page, and App.jsx no longer routes it', () => {
    expect(isRegistryPath('/privacy')).toBe(false);
    expect(isKnownSpaPath('/privacy')).toBe(false);
    expect(findRedirect('/privacy')).toEqual({ from: '/privacy', to: '/terms#privacy', status: 301 });
    expect(appRoutePaths()).not.toContain('/privacy');
    // The client <Navigate> is gone — a soft 200 must never be reintroduced.
    expect(appSource).not.toContain('path="/privacy"');
  });

  it('every redirect target resolves to a registry path', () => {
    for (const r of PERMANENT_REDIRECTS) {
      const target = r.to.split('#')[0].split('?')[0];
      expect(isRegistryPath(target), `${r.to} points nowhere`).toBe(true);
    }
  });
});

describe('publicPages — path helpers', () => {
  it('stripTrailingSlash preserves the root', () => {
    expect(stripTrailingSlash('/')).toBe('/');
    expect(stripTrailingSlash('/terms/')).toBe('/terms');
    expect(stripTrailingSlash('/terms')).toBe('/terms');
    expect(stripTrailingSlash('/a/b///')).toBe('/a/b');
  });

  it('normalizePath lowercases and strips the trailing slash', () => {
    expect(normalizePath('/Terms/')).toBe('/terms');
    expect(normalizePath('/LOGIN')).toBe('/login');
    expect(normalizePath('')).toBe('/');
  });

  it('matchPattern is case-sensitive and honours exact vs prefix', () => {
    const exact = { pattern: '/terms', kind: 'exact' };
    const prefix = { pattern: '/app', kind: 'prefix' };
    expect(matchPattern('/terms', exact)).toBe(true);
    expect(matchPattern('/terms/', exact)).toBe(true);
    expect(matchPattern('/terms/x', exact)).toBe(false);
    expect(matchPattern('/Terms', exact)).toBe(false);
    expect(matchPattern('/app', prefix)).toBe(true);
    expect(matchPattern('/app/project/1', prefix)).toBe(true);
    expect(matchPattern('/appendix', prefix)).toBe(false);
  });

  it('absoluteUrl builds production URLs', () => {
    expect(absoluteUrl('/')).toBe('https://pecanrev.com/');
    expect(absoluteUrl('/terms')).toBe('https://pecanrev.com/terms');
    expect(absoluteUrl('/terms', 'http://localhost:3000/')).toBe('http://localhost:3000/terms');
  });

  it('getPublicPage is exact — a trailing slash is a miss (it 301s instead)', () => {
    expect(getPublicPage('/terms')).toBeTruthy();
    expect(getPublicPage('/terms/')).toBeUndefined();
    expect(getPublicPage('/Terms')).toBeUndefined();
  });

  it('isNonIndexablePath covers app/auth/token surfaces but not login/register', () => {
    for (const p of ['/app', '/app/project/1', '/profile', '/onboarding', '/rob/3',
      '/ops', '/sift-beta', '/invite/abc', '/accept-invitation', '/reset',
      '/verify-email', '/public/synthesis/tok', '/embed/synthesis/tok']) {
      expect(isNonIndexablePath(p), `${p} should be noindex`).toBe(true);
    }
    for (const p of ['/', '/terms', '/login', '/register']) {
      expect(isNonIndexablePath(p), `${p} should be indexable`).toBe(false);
    }
    expect(isNonIndexablePath('/beta-waitlist'), 'preview duplicate is noindex').toBe(true);
  });
});

describe('publicPages — JSON-LD (honest fields only)', () => {
  const ctx = { origin: SITE_ORIGIN };
  const home = getPublicPage('/');
  const graph = home.jsonLd({ ...ctx, path: '/', entry: home });

  // The homepage graph is EXTENSIBLE (content work may append e.g. a FAQPage for
  // FAQs genuinely visible on the page), so these assert the required entity core
  // rather than an exact node list.
  const nodeOfType = (t) => graph['@graph'].find((n) => n['@type'] === t);

  it('the homepage emits an Organization + WebSite + SoftwareApplication core', () => {
    expect(graph['@context']).toBe('https://schema.org');
    const types = graph['@graph'].map((n) => n['@type']);
    expect(types.slice(0, 3)).toEqual(['Organization', 'WebSite', 'SoftwareApplication']);
  });

  it('graph nodes cross-reference each other by @id', () => {
    const org = nodeOfType('Organization');
    const site = nodeOfType('WebSite');
    const app = nodeOfType('SoftwareApplication');
    expect(site.publisher['@id']).toBe(org['@id']);
    expect(app.publisher['@id']).toBe(org['@id']);
    const ids = graph['@graph'].map((n) => n['@id']).filter(Boolean);
    expect(new Set(ids).size, 'every @id in a graph must be unique').toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  /**
   * An @id is a NODE identity, not a page. The builders concatenate the site root
   * with a JSONLD_IDS anchor; a stray `.slice(1)` used to strip the '#', so the graph
   * asserted `https://pecanrev.com/organization` — a URL-shaped identity for a page
   * that does not exist (and, since the registry-gated 404s landed, genuinely 404s).
   * Fragment identities are also what #webpage/#article already use.
   */
  it('every @id is a fragment on a real URL, never a page-shaped URL that 404s', () => {
    const ids = [
      organizationJsonLd(ctx)['@id'],
      webSiteJsonLd(ctx)['@id'],
      softwareApplicationJsonLd(ctx)['@id'],
      ...graph['@graph'].map((n) => n['@id']).filter(Boolean),
      ...PUBLIC_PAGES.filter((e) => typeof e.jsonLd === 'function')
        .flatMap((e) => e.jsonLd({ ...ctx, path: e.path, entry: e })['@graph'])
        .map((n) => n['@id']).filter(Boolean),
    ];
    for (const id of ids) {
      expect(id, `${id} must carry a fragment anchor`).toContain('#');
      expect(id.startsWith(SITE_ORIGIN), `${id} must be absolute`).toBe(true);
    }
    expect(organizationJsonLd(ctx)['@id']).toBe(`${SITE_ORIGIN}/#organization`);
    expect(webSiteJsonLd(ctx)['@id']).toBe(`${SITE_ORIGIN}/#website`);
    expect(softwareApplicationJsonLd(ctx)['@id']).toBe(`${SITE_ORIGIN}/#software`);
  });

  it('SoftwareApplication declares only verifiable fields', () => {
    const app = softwareApplicationJsonLd(ctx);
    expect(app.operatingSystem).toBe('Web');
    expect(app.applicationCategory).toBe('BusinessApplication');
    expect(Array.isArray(app.featureList)).toBe(true);
  });

  it('NEVER fabricates ratings, reviews, prices or awards anywhere in the graph', () => {
    const serialized = JSON.stringify([
      graph,
      organizationJsonLd(ctx),
      webSiteJsonLd(ctx),
      softwareApplicationJsonLd(ctx),
      ...PUBLIC_PAGES.filter((e) => typeof e.jsonLd === 'function')
        .map((e) => e.jsonLd({ ...ctx, path: e.path, entry: e })),
    ]);
    for (const banned of ['aggregateRating', 'ratingValue', 'reviewCount', '"review"',
      'offers', 'price', 'award', 'foundingDate', 'numberOfEmployees']) {
      expect(serialized.includes(banned), `fabricated signal: ${banned}`).toBe(false);
    }
  });

  it('WebSite declares no SearchAction (the public site has no search endpoint)', () => {
    expect(JSON.stringify(webSiteJsonLd(ctx))).not.toContain('SearchAction');
  });

  it('breadcrumbJsonLd needs at least two levels', () => {
    expect(breadcrumbJsonLd([{ name: 'Home', path: '/' }], ctx)).toBeNull();
    const bc = breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Terms', path: '/terms' }], ctx);
    expect(bc['@type']).toBe('BreadcrumbList');
    expect(bc.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    expect(bc.itemListElement[1].item).toBe('https://pecanrev.com/terms');
  });

  it('faqJsonLd returns null for empty input and a FAQPage otherwise', () => {
    expect(faqJsonLd([])).toBeNull();
    expect(faqJsonLd([{ question: 'Q?', answer: 'A.' }])['@type']).toBe('FAQPage');
  });
});

describe('publicPages — index.html stays in sync with the root entry', () => {
  it('the shell description matches SITE_DESCRIPTION byte for byte', () => {
    expect(indexHtml).toContain(SITE_DESCRIPTION);
    expect(getPublicPage('/').description).toBe(SITE_DESCRIPTION);
  });

  it('the shell declares the large-image Twitter card and both share images', () => {
    expect(indexHtml).toContain('name="twitter:card" content="summary_large_image"');
    expect(indexHtml).toContain('property="og:image" content="https://pecanrev.com/og-image.png"');
    expect(indexHtml).toContain('name="twitter:image" content="https://pecanrev.com/og-image.png"');
  });
});
