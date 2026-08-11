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
  relatedLabelFor,
  resolveRelated,
  sitemapPages,
  softwareApplicationJsonLd,
  stripTrailingSlash,
  webSiteJsonLd,
} from '../../../src/frontend/website/publicPages.js';
import { allNavPaths, CHROME_LINKS } from '../../../src/frontend/website/siteNav.js';

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

/* ───────────────── 113 §2 — the `sitemap` flag ───────────────────────────── */

describe('publicPages registry — sitemap eligibility', () => {
  /**
   * The ONLY two entries allowed to opt out. Hardcoded so that adding a third is a
   * deliberate act with a test edit attached, not something that happens because a
   * new page felt thin on the day it was written — every silent drop from the
   * sitemap is a page nobody notices is missing.
   */
  const SITEMAP_OPT_OUT = ['/login', '/register'];

  it('only /login and /register opt out, and they stay indexable', () => {
    const optedOut = PUBLIC_PAGES.filter((e) => e.sitemap === false).map((e) => e.path);
    expect(optedOut.sort()).toEqual([...SITEMAP_OPT_OUT].sort());
    for (const p of SITEMAP_OPT_OUT) {
      const entry = getPublicPage(p);
      // sitemap:false is NOT noindex. These pages answer the navigational query
      // "PecanRev login"; noindexing them hands that query to a third party.
      expect(entry.indexable, `${p} must stay indexable`).toBe(true);
      expect(entry.canonicalPath, `${p} must stay self-canonical`).toBe(p);
      expect(isNonIndexablePath(p), `${p} must not be noindex`).toBe(false);
    }
  });

  it('sitemapPages() is indexablePages() minus the opt-outs', () => {
    const sitemap = sitemapPages().map((e) => e.path);
    const indexable = indexablePages().map((e) => e.path);
    for (const p of SITEMAP_OPT_OUT) {
      expect(indexable, `${p} belongs in llms.txt`).toContain(p);
      expect(sitemap, `${p} must not be submitted for crawl`).not.toContain(p);
    }
    expect(sitemap).toEqual(indexable.filter((p) => !SITEMAP_OPT_OUT.includes(p)));
    expect(sitemap.length).toBe(indexable.length - SITEMAP_OPT_OUT.length);
  });

  it('every sitemap entry is self-canonical, so no submitted URL points elsewhere', () => {
    for (const e of sitemapPages()) expect(e.canonicalPath, `${e.path}`).toBe(e.path);
  });

  it('the default is inclusion — an entry with no flag is submitted', () => {
    const unflagged = PUBLIC_PAGES.filter((e) => e.indexable !== false && e.sitemap === undefined);
    const sitemap = new Set(sitemapPages().map((e) => e.path));
    for (const e of unflagged) expect(sitemap.has(e.path), `${e.path}`).toBe(true);
  });
});

/* ───────────────── 113 §5 — the related-links graph ──────────────────────── */

describe('publicPages registry — related-links graph', () => {
  /**
   * The four indexable entries with no `related` array, and why each is exempt.
   *
   * `related` is not decoration: it is what ArticlePage renders as the page's
   * related-links block. Declaring links on a page that renders none would be a
   * graph that claims coverage the HTML does not have. These four are the only
   * registry entries whose component is not ArticlePage:
   *   /          Landing — its footer already links every feature, guide and
   *              comparison, which is strictly more than a related block would.
   *   /terms     legal page, deliberately chrome-less.
   *   /login     auth form, ~17 words. Sending a visitor mid-sign-in to a
   *   /register  methodology guide is not a link, it is an interruption.
   * Hardcoded so a new page cannot quietly join them.
   */
  const RELATED_EXEMPT = ['/', '/terms', '/login', '/register'];

  const withRelated = PUBLIC_PAGES.filter((e) => Array.isArray(e.related));

  it('exactly the non-exempt indexable entries declare `related`', () => {
    const missing = PUBLIC_PAGES
      .filter((e) => e.indexable !== false && !RELATED_EXEMPT.includes(e.path))
      .filter((e) => !Array.isArray(e.related))
      .map((e) => e.path);
    expect(missing, `these indexable pages have no related[]: ${missing.join(', ')}`).toEqual([]);
    for (const p of RELATED_EXEMPT) {
      expect(getPublicPage(p).related, `${p} is exempt and must not declare related[]`).toBeUndefined();
    }
    expect(withRelated.length).toBe(indexablePages().length - RELATED_EXEMPT.length);
  });

  it('every related list is 3-5 real registry paths, deduped, never self', () => {
    for (const e of withRelated) {
      expect(e.related.length, `${e.path} has ${e.related.length} related links`)
        .toBeGreaterThanOrEqual(3);
      expect(e.related.length, `${e.path} has ${e.related.length} related links`)
        .toBeLessThanOrEqual(5);
      expect(new Set(e.related).size, `${e.path} repeats a related path`).toBe(e.related.length);
      for (const target of e.related) {
        expect(isRegistryPath(target), `${e.path} links to unregistered ${target}`).toBe(true);
        expect(target, `${e.path} lists itself`).not.toBe(e.path);
        expect(getPublicPage(target).indexable, `${e.path} links to noindex ${target}`).not.toBe(false);
      }
    }
  });

  it('resolveRelated returns registry order with labels, and honours notes', () => {
    const entry = getPublicPage('/features/screening');
    const links = resolveRelated('/features/screening', { '/features/search-engine': 'where records come from' });
    expect(links.map((l) => l.path)).toEqual(entry.related);
    expect(links.every((l) => l.label && l.label.length > 1)).toBe(true);
    expect(links.find((l) => l.path === '/features/search-engine').note).toBe('where records come from');
    // A note for a path the registry does NOT list cannot smuggle in an extra link.
    expect(resolveRelated('/features/screening', { '/about': 'nope' }).map((l) => l.path))
      .toEqual(entry.related);
    // Exempt and unknown paths resolve to nothing rather than throwing.
    expect(resolveRelated('/login')).toEqual([]);
    expect(resolveRelated('/nope-not-a-page')).toEqual([]);
  });

  /**
   * A related block is read as a list of destinations. Two rows reading
   * "Data extraction" is not a choice, it is a coin flip — and `navLabel` is written
   * for a footer column whose heading ("Product" / "Learn") already disambiguates it.
   * `relatedLabel` exists for exactly this; the assertion makes forgetting it fail.
   */
  it('no two links in one related block share a label', () => {
    for (const e of withRelated) {
      const labels = resolveRelated(e.path).map((l) => l.label);
      const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
      expect(dupes, `${e.path} shows ambiguous related labels: ${dupes.join(', ')}`).toEqual([]);
    }
  });

  it('relatedLabel is only set where navLabel would genuinely be ambiguous', () => {
    for (const e of PUBLIC_PAGES.filter((x) => x.relatedLabel)) {
      expect(relatedLabelFor(e)).toBe(e.relatedLabel);
      const collides = PUBLIC_PAGES.some((o) => o !== e && o.navLabel && o.navLabel === e.navLabel);
      expect(collides, `${e.path} sets relatedLabel but its navLabel is already unique`).toBe(true);
    }
    // Fallback chain, for entries that need no override.
    expect(relatedLabelFor(getPublicPage('/features/screening'))).toBe('Screening');
    expect(relatedLabelFor(null)).toBe('');
  });

  /**
   * THE orphan test. A page nothing links to is a page Google reaches only through
   * the sitemap and then treats as unimportant; internally it is a page a reader can
   * never stumble into. Reachability is the union of the two link systems that
   * actually render: the shared nav/footer (siteNav.js) and the related graph.
   */
  it('every indexable page is reachable from the navigation or the related graph', () => {
    const reachable = new Set([...allNavPaths(), ...withRelated.flatMap((e) => e.related)]);
    const orphans = indexablePages().map((e) => e.path).filter((p) => !reachable.has(p));
    expect(orphans, `orphaned public pages: ${orphans.join(', ')}`).toEqual([]);
  });

  it('most pages earn an inbound RELATED link, not just a footer row', () => {
    // Nav coverage alone is weak: the footer links everything, so it can never fail.
    // The related graph is the signal that carries topical context, so hold it to a
    // high bar without pretending the four exempt pages can meet it.
    const inbound = new Set(withRelated.flatMap((e) => e.related));
    const missing = indexablePages()
      .map((e) => e.path)
      .filter((p) => !inbound.has(p) && !RELATED_EXEMPT.includes(p));
    expect(missing, `no page links to: ${missing.join(', ')}`).toEqual([]);
  });

  it('CHROME_LINKS matches the hrefs PageShell actually renders', () => {
    // CHROME_LINKS is what lets the orphan test count /, /login and /register as
    // reachable. If the navbar buttons are ever removed or re-pointed, that claim
    // becomes false — so pin it to the source rather than trusting the constant.
    const shell = fs.readFileSync(
      path.join(repoRoot, 'src/frontend/website/PageShell.jsx'), 'utf8',
    );
    for (const link of CHROME_LINKS) {
      expect(shell, `PageShell no longer renders href="${link.path}"`)
        .toContain(`href="${link.path}"`);
      expect(isRegistryPath(link.path), `${link.path} is not a registry page`).toBe(true);
    }
    expect(CHROME_LINKS.map((l) => l.path).sort()).toEqual(['/', '/login', '/register']);
  });

  it('every navigation path is a registry path', () => {
    for (const p of allNavPaths()) {
      expect(isRegistryPath(p), `nav links to unregistered ${p}`).toBe(true);
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
