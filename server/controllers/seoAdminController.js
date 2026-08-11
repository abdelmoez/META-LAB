/**
 * seoAdminController.js — Ops Console › SEO.
 *
 * 113.md item 8. The console exists because of ONE production failure that no
 * test could ever have caught: the 111 build shipped correct prerendered HTML
 * into dist/__prerender/, and the web server never served it. Every crawler saw
 * the empty app shell on every route while the repository looked perfect. So
 * this section is deliberately split into two panels that are never mixed:
 *
 *   A. REPOSITORY VALIDATION — computed here, at request time, from the
 *      public-page registry and the files on disk. It answers "is what we built
 *      correct?" and it can be trusted completely, because it is a measurement
 *      of this machine.
 *
 *   B. EXTERNALLY OBSERVED — an on-demand fetch of the real public origin. It
 *      answers "is what we built actually being SERVED?" and it is never cached,
 *      never mixed into panel A, and never reported as anything other than what
 *      the fetch returned. A failure is printed verbatim.
 *
 * PROHIBITED, permanently: inventing a ranking, an impression count, an index
 * status, a Search Console figure or a competitor metric. We have no API for any
 * of that. Where the answer is "we cannot know", the console says so.
 *
 * Capability: every route here takes requirePermission('view_seo_status')
 * (admin + mod). There is nothing to manage — the registry is code.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_PAGES, SITE_ORIGIN, absoluteUrl,
} from '../../src/frontend/website/publicPages.js';
import { publicBaseUrl, getPageViewSummary } from '../services/seoPageviewService.js';
import { timeoutSignal, describeFetchError } from '../utils/fetchTimeout.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root — server/controllers/ is two levels down. */
export const REPO_ROOT = path.resolve(HERE, '..', '..');
const DIST = path.join(REPO_ROOT, 'dist');
const PRERENDER_DIR = path.join(DIST, '__prerender');

/** The description bound publicPages.js documents and the SEO tests enforce. */
export const DESCRIPTION_MIN = 110;
export const DESCRIPTION_MAX = 165;

/** Live check budget. 8s is generous for a static page and short enough that an
 *  unreachable origin cannot pin an Ops request. */
export const LIVE_CHECK_TIMEOUT_MS = 8000;

/* ─── pure registry introspection (unit-tested without fs or a database) ──── */

/**
 * True when this entry belongs in sitemap.xml. `sitemap: false` is the 113 flag
 * for "crawlable but not advertised" (login/register); reading it defensively
 * means this controller is correct both before and after that flag lands.
 */
export function inSitemap(entry) {
  return entry?.indexable !== false && entry?.sitemap !== false;
}

/**
 * One inventory row per registry entry. PURE apart from the injected
 * `componentExists` predicate.
 *
 * @param {object[]} pages
 * @param {{componentExists?: (relPath: string) => boolean}} [opts]
 */
export function registryInventory(pages, { componentExists } = {}) {
  const exists = typeof componentExists === 'function' ? componentExists : () => null;
  return (Array.isArray(pages) ? pages : []).map((e) => ({
    path: e.path,
    title: e.title,
    description: e.description,
    descriptionLength: typeof e.description === 'string' ? e.description.length : 0,
    canonicalPath: e.canonicalPath,
    canonicalUrl: absoluteUrl(e.canonicalPath || e.path, SITE_ORIGIN),
    indexable: e.indexable !== false,
    inSitemap: inSitemap(e),
    hasJsonLd: typeof e.jsonLd === 'function',
    component: e.component,
    componentExists: exists(e.component),
    lastmodSource: e.lastmodSource || null,
  }));
}

/** Headline counts for the inventory strip. PURE. */
export function registryCounts(inventory) {
  const rows = Array.isArray(inventory) ? inventory : [];
  return {
    total: rows.length,
    indexable: rows.filter((r) => r.indexable).length,
    noindex: rows.filter((r) => !r.indexable).length,
    sitemapExcluded: rows.filter((r) => r.indexable && !r.inSitemap).length,
    inSitemap: rows.filter((r) => r.inSitemap).length,
    withJsonLd: rows.filter((r) => r.hasJsonLd).length,
  };
}

/** A check result. `status` is 'pass' | 'fail' | 'unknown'; details are facts. */
const check = (id, label, status, detail, offenders = []) => ({
  id, label, status, detail, offenders: offenders.slice(0, 25),
});

/** Values appearing more than once in `list`. PURE. */
function duplicates(list) {
  const seen = new Map();
  for (const v of list) seen.set(v, (seen.get(v) || 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([v]) => v);
}

/**
 * The repository-validation check list. PURE — everything it needs about the
 * filesystem arrives through the inventory rows.
 *
 * @param {object[]} inventory  output of registryInventory
 */
export function registryChecks(inventory) {
  const rows = Array.isArray(inventory) ? inventory : [];
  const indexable = rows.filter((r) => r.indexable);
  const out = [];

  const dupTitles = duplicates(indexable.map((r) => r.title));
  out.push(check(
    'unique-titles',
    'Every indexable page has a unique <title>',
    dupTitles.length === 0 ? 'pass' : 'fail',
    dupTitles.length === 0
      ? `${indexable.length} indexable pages, ${indexable.length} distinct titles.`
      : `${dupTitles.length} title(s) used by more than one page.`,
    dupTitles,
  ));

  const dupDescriptions = duplicates(indexable.map((r) => r.description));
  out.push(check(
    'unique-descriptions',
    'Every indexable page has a unique meta description',
    dupDescriptions.length === 0 ? 'pass' : 'fail',
    dupDescriptions.length === 0
      ? `${indexable.length} distinct descriptions.`
      : `${dupDescriptions.length} description(s) reused across pages.`,
    dupDescriptions.map((d) => String(d).slice(0, 80)),
  ));

  const badLength = rows.filter(
    (r) => r.descriptionLength < DESCRIPTION_MIN || r.descriptionLength > DESCRIPTION_MAX,
  );
  out.push(check(
    'description-length',
    `Meta descriptions are ${DESCRIPTION_MIN}–${DESCRIPTION_MAX} characters`,
    badLength.length === 0 ? 'pass' : 'fail',
    badLength.length === 0
      ? 'Every description fits the SERP window without being truncated.'
      : `${badLength.length} description(s) outside the bound.`,
    badLength.map((r) => `${r.path} (${r.descriptionLength})`),
  ));

  const missingCanonical = rows.filter(
    (r) => typeof r.canonicalPath !== 'string' || !r.canonicalPath.startsWith('/'),
  );
  out.push(check(
    'canonical-present',
    'Every page declares a canonical path',
    missingCanonical.length === 0 ? 'pass' : 'fail',
    missingCanonical.length === 0
      ? 'All entries carry a rooted canonicalPath.'
      : `${missingCanonical.length} entr(ies) without a usable canonicalPath.`,
    missingCanonical.map((r) => r.path),
  ));

  const unknownComponents = rows.filter((r) => r.componentExists === false);
  const uncheckedComponents = rows.filter((r) => r.componentExists === null);
  out.push(check(
    'components-exist',
    'Every registry entry points at a component file that exists',
    unknownComponents.length === 0 ? (uncheckedComponents.length ? 'unknown' : 'pass') : 'fail',
    unknownComponents.length
      ? `${unknownComponents.length} component path(s) do not resolve on disk.`
      : uncheckedComponents.length
        ? 'Component existence was not checked in this context.'
        : `${rows.length} component files resolved.`,
    unknownComponents.map((r) => `${r.path} → ${r.component}`),
  ));

  return out;
}

/** Count `<loc>` elements in a sitemap document. PURE. */
export function countSitemapUrls(xml) {
  if (typeof xml !== 'string') return 0;
  return (xml.match(/<loc>/g) || []).length;
}

/** Count the `- [title](url)` page links in an llms.txt document. PURE. */
export function countLlmsLinks(text) {
  if (typeof text !== 'string') return 0;
  return (text.match(/^- \[/gm) || []).length;
}

/**
 * Decode the handful of character references an HTML serializer emits inside a
 * `<title>`. PURE.
 *
 * This is load-bearing, not cosmetic. React escapes `&` to `&amp;`, and the
 * homepage title contains one ("Systematic Review & Meta-Analysis Platform").
 * Comparing raw bytes would report titleMatches:false for a page that is being
 * served perfectly — a false alarm on the most important row in the console,
 * which is exactly how a monitor gets ignored.
 */
export function decodeTitleEntities(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hx) => String.fromCodePoint(Number.parseInt(hx, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // last: an encoded &amp;lt; must not become '<'
}

/** The served `<title>` text, entity-decoded, or null. PURE. */
export function extractTitle(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeTitleEntities(m[1]).trim() : null;
}

/** True when the document contains at least one `<h1>`. PURE. */
export function hasH1(html) {
  return typeof html === 'string' && /<h1[\s>]/i.test(html);
}

/**
 * True when the document carries a JSON-LD `"@type"` marker — the cheapest
 * reliable signal that the PRERENDERED document (not the app shell) was served.
 * PURE.
 */
export function hasJsonLdMarker(html) {
  return typeof html === 'string' && html.includes('"@type"');
}

/* ─── filesystem facts (dist artefacts + verification tokens) ─────────────── */

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function readSafe(p, limit = 2_000_000) {
  try {
    const s = fs.statSync(p);
    if (!s.isFile() || s.size > limit) return null;
    return fs.readFileSync(p, 'utf8');
  } catch { return null; }
}

/** Recursively count `index.html` files under the prerender directory. */
function countPrerenderPages(dir, depth = 0) {
  if (depth > 6) return 0;
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (e.isDirectory()) total += countPrerenderPages(path.join(dir, e.name), depth + 1);
    else if (e.name === 'index.html') total += 1;
  }
  return total;
}

/**
 * The build artefacts a crawler reads before it reads any page. Reported as
 * facts (present / absent / count / mtime), never as a grade.
 */
export function buildArtifactReport() {
  const prerenderStat = statSafe(PRERENDER_DIR);
  const prerenderPages = prerenderStat && prerenderStat.isDirectory() ? countPrerenderPages(PRERENDER_DIR) : 0;

  const sitemapPath = path.join(DIST, 'sitemap.xml');
  const robotsPath = path.join(DIST, 'robots.txt');
  const llmsPath = path.join(DIST, 'llms.txt');

  const sitemap = readSafe(sitemapPath);
  const robots = readSafe(robotsPath);
  const llms = readSafe(llmsPath);
  const sitemapStat = statSafe(sitemapPath);

  return {
    distPresent: Boolean(statSafe(DIST)),
    prerender: {
      present: Boolean(prerenderStat && prerenderStat.isDirectory()),
      pageCount: prerenderPages,
      // The prerender step is the LAST thing `npm run build` does, so the
      // directory mtime is an honest "last generated" — not a guess.
      generatedAt: prerenderStat ? new Date(prerenderStat.mtimeMs).toISOString() : null,
    },
    sitemap: {
      present: sitemap != null,
      urlCount: countSitemapUrls(sitemap),
      generatedAt: sitemapStat ? new Date(sitemapStat.mtimeMs).toISOString() : null,
    },
    robots: {
      present: robots != null,
      hasSitemapLine: typeof robots === 'string' && /^Sitemap:\s*\S+/mi.test(robots),
    },
    llms: { present: llms != null, pageLinkCount: countLlmsLinks(llms) },
  };
}

/** Checks derived from the artefact report. PURE given the report. */
export function artifactChecks(report, { expectedSitemapUrls } = {}) {
  const out = [];
  out.push(check(
    'prerender-present',
    'dist/__prerender contains a prerendered document per page',
    report.prerender.present && report.prerender.pageCount > 0 ? 'pass' : 'fail',
    report.prerender.present
      ? `${report.prerender.pageCount} prerendered page(s); last generated ${report.prerender.generatedAt || 'unknown'}.`
      : 'No prerender output on disk — run `npm run build`. (This checks the BUILD, not what the web server serves.)',
  ));

  const expected = Number.isFinite(expectedSitemapUrls) ? expectedSitemapUrls : null;
  const countMatches = expected == null || report.sitemap.urlCount === expected;
  out.push(check(
    'sitemap-present',
    'dist/sitemap.xml exists and lists every sitemap-eligible page',
    report.sitemap.present && countMatches ? 'pass' : 'fail',
    report.sitemap.present
      ? `${report.sitemap.urlCount} URL(s)${expected == null ? '' : ` — registry expects ${expected}`}.`
      : 'No sitemap.xml in dist/.',
  ));

  out.push(check(
    'robots-present',
    'dist/robots.txt exists and points at the sitemap',
    report.robots.present && report.robots.hasSitemapLine ? 'pass' : 'fail',
    report.robots.present
      ? (report.robots.hasSitemapLine ? 'Present, with a Sitemap: line.' : 'Present, but no Sitemap: line.')
      : 'No robots.txt in dist/.',
  ));

  out.push(check(
    'llms-present',
    'dist/llms.txt exists and lists the public pages',
    report.llms.present && report.llms.pageLinkCount > 0 ? 'pass' : 'fail',
    report.llms.present
      ? `${report.llms.pageLinkCount} page link(s).`
      : 'No llms.txt in dist/.',
  ));

  return out;
}

/**
 * Search-engine ownership verification, as far as a repository can possibly know
 * it: a meta tag or a verification file committed to the repo. There is no API
 * key and no Search Console integration, so "we cannot see this" is the answer
 * for everything else — and the UI says exactly that.
 */
export function readVerificationTokens() {
  const indexHtml = readSafe(path.join(REPO_ROOT, 'index.html')) || '';
  let publicFiles = [];
  try { publicFiles = fs.readdirSync(path.join(REPO_ROOT, 'public')); } catch { publicFiles = []; }

  const googleMeta = /name=["']google-site-verification["']/i.test(indexHtml);
  const googleFile = publicFiles.find((f) => /^google[0-9a-f]+\.html$/i.test(f)) || null;
  const bingMeta = /name=["']msvalidate\.01["']/i.test(indexHtml);
  const bingFile = publicFiles.includes('BingSiteAuth.xml') ? 'BingSiteAuth.xml' : null;

  return {
    // 'token_present' means a token EXISTS in the repo — never that the property
    // is verified, which only the search engine can tell us.
    google: {
      state: googleMeta || googleFile ? 'token_present' : 'not_configured',
      via: googleMeta ? 'meta tag in index.html' : googleFile ? `public/${googleFile}` : null,
    },
    bing: {
      state: bingMeta || bingFile ? 'token_present' : 'not_configured',
      via: bingMeta ? 'meta tag in index.html' : bingFile ? `public/${bingFile}` : null,
    },
    note: 'PecanRev holds no Search Console or Bing Webmaster API credentials, so coverage, '
      + 'impressions and index status cannot be shown here. This reports only whether a '
      + 'verification token exists in the repository.',
  };
}

/* ─── GET /api/admin/seo/status — panel A ────────────────────────────────── */

export async function getSeoStatus(req, res) {
  try {
    const componentExists = (rel) => {
      if (typeof rel !== 'string' || !rel) return false;
      return Boolean(statSafe(path.join(REPO_ROOT, rel)));
    };
    const inventory = registryInventory(PUBLIC_PAGES, { componentExists });
    const counts = registryCounts(inventory);
    const artifacts = buildArtifactReport();

    const checks = [
      ...registryChecks(inventory),
      ...artifactChecks(artifacts, { expectedSitemapUrls: counts.inSitemap }),
    ];

    return res.json({
      generatedAt: new Date().toISOString(),
      origin: SITE_ORIGIN,
      baseUrl: publicBaseUrl(),
      inventory,
      counts,
      artifacts,
      checks,
      verification: readVerificationTokens(),
      passing: checks.filter((c) => c.status === 'pass').length,
      failing: checks.filter((c) => c.status === 'fail').length,
    });
  } catch (err) {
    console.error('[seoAdmin] getSeoStatus error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── POST /api/admin/seo/live-check — panel B ───────────────────────────── */

/** The paths the live check probes: home, one feature page, and the two crawler files. */
export function liveCheckTargets(pages = PUBLIC_PAGES) {
  const list = Array.isArray(pages) ? pages : [];
  const home = list.find((e) => e.path === '/') || null;
  const feature = list.find((e) => e.indexable !== false && /^\/features\/[^/]+$/.test(e.path)) || null;

  const targets = [];
  if (home) targets.push({ id: 'home', kind: 'page', path: '/', expectTitle: home.title });
  if (feature) targets.push({ id: 'feature', kind: 'page', path: feature.path, expectTitle: feature.title });
  targets.push({ id: 'sitemap', kind: 'sitemap', path: '/sitemap.xml' });
  targets.push({ id: 'robots', kind: 'robots', path: '/robots.txt' });
  return targets;
}

/** Turn a fetched body into the honest per-target report. PURE. */
export function evaluateLiveTarget(target, { status, body }) {
  const base = { id: target.id, kind: target.kind, path: target.path, ok: true, status };

  if (target.kind === 'page') {
    const servedTitle = extractTitle(body);
    return {
      ...base,
      expectedTitle: target.expectTitle || null,
      servedTitle,
      titleMatches: Boolean(target.expectTitle) && servedTitle === target.expectTitle,
      h1Present: hasH1(body),
      jsonLdPresent: hasJsonLdMarker(body),
    };
  }
  if (target.kind === 'sitemap') {
    return { ...base, urlCount: countSitemapUrls(body) };
  }
  return {
    ...base,
    hasSitemapLine: typeof body === 'string' && /^Sitemap:\s*\S+/mi.test(body),
    hasUserAgentLine: typeof body === 'string' && /^User-agent:/mi.test(body),
  };
}

/**
 * Fetch one target. Returns a report or an honest failure — never throws.
 * `fetchImpl` is injectable so the unit tests never touch the network.
 */
export async function probeLiveTarget(baseUrl, target, { fetchImpl = fetch, timeoutMs = LIVE_CHECK_TIMEOUT_MS } = {}) {
  const url = `${baseUrl}${target.path}`;
  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      signal: timeoutSignal(timeoutMs),
      headers: { accept: target.kind === 'page' ? 'text/html' : '*/*' },
    });
    const body = await res.text();
    return { url, ...evaluateLiveTarget(target, { status: res.status, body: body.slice(0, 1_500_000) }) };
  } catch (err) {
    return {
      id: target.id, kind: target.kind, path: target.path, url,
      ok: false, status: null,
      error: `fetch failed: ${describeFetchError(err, timeoutMs)}`,
    };
  }
}

export async function runSeoLiveCheck(req, res) {
  const baseUrl = publicBaseUrl();
  try {
    const targets = liveCheckTargets();
    const results = [];
    // Sequential on purpose: four requests to ONE origin, and a burst from an
    // Ops click is a worse neighbour than four in a row.
    for (const t of targets) results.push(await probeLiveTarget(baseUrl, t));

    return res.json({
      baseUrl,
      checkedAt: new Date().toISOString(),
      timeoutMs: LIVE_CHECK_TIMEOUT_MS,
      results,
    });
  } catch (err) {
    console.error('[seoAdmin] runSeoLiveCheck error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── GET /api/admin/seo/analytics — panel C ─────────────────────────────── */

export async function getSeoAnalytics(req, res) {
  try {
    // The service owns the clamp (1–90, junk → the 14-day default), so the
    // query param and a direct service call can never disagree.
    const summary = await getPageViewSummary({ days: req.query?.days });
    return res.json(summary);
  } catch (err) {
    console.error('[seoAdmin] getSeoAnalytics error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
