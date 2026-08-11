/**
 * seoPageviewService.js — 113.md phase 19 — the first-party, privacy-safe
 * landing-page counter behind Ops › SEO › Landing analytics.
 *
 * WHAT THIS IS NOT: an analytics product. There is no visitor, no session, no
 * cookie, no device id, no user agent, no IP, no query string and no timestamp
 * finer than a UTC calendar day. One row is (day, path, referrerClass) with an
 * integer counter — the coarsest shape that can still answer "did anything land
 * on the new guides, and did it come from a search engine or an AI assistant?".
 *
 * DESIGN RULES:
 *   - ALLOWLIST, not sanitisation. Only a path that is a canonicalPath of the
 *     public-page registry is ever written; everything else is dropped in
 *     silence (the endpoint still answers 204 — a beacon must never tell a
 *     caller which paths exist, and must never look like an error in a browser
 *     console).
 *   - The referrer is CLASSIFIED SERVER-SIDE and the raw value is discarded. A
 *     referring URL can carry a search query, a document title, or a private
 *     workspace URL; only one of five class labels is ever persisted.
 *   - NO UNIQUE CONSTRAINT on the table, deliberately. Two concurrent beacons
 *     for the same (day, path, class) may both miss the findFirst and both
 *     insert; twins are fine because every reader SUMs — the summary read is a
 *     groupBy with _sum, so the database collapses them before any row reaches
 *     this process. The alternative — an upsert on a composite unique — buys
 *     nothing here and would turn a racing write into a 500.
 *   - NEVER THROWS. A database outage must not surface anywhere near a public
 *     page; every failure is a typed return value.
 *
 * The pure parts (classification, allowlist, day string, aggregation) are
 * exported separately so tests/unit/seo/seoPageviewService.test.js can pin them
 * without a database.
 */

import { prisma } from '../db/client.js';
import { PUBLIC_PAGES, SITE_ORIGIN, stripTrailingSlash } from '../../src/frontend/website/publicPages.js';

/** The five labels the schema comment declares. Order is the display order. */
export const REFERRER_CLASSES = Object.freeze(['search', 'ai', 'referral', 'internal', 'direct']);

/**
 * Hostname LABELS that identify a classic search engine. Matched against the
 * dot-separated labels of the referrer hostname, so `www.google.co.uk`,
 * `google.de` and `search.yahoo.co.jp` all match without a suffix list.
 */
export const SEARCH_HOST_LABELS = Object.freeze([
  'google', 'bing', 'duckduckgo', 'yahoo', 'baidu', 'ecosia',
]);

/**
 * Hostname labels that identify an AI assistant / answer engine. Checked BEFORE
 * the search list on purpose: `gemini.google.com` and `copilot.microsoft.com`
 * carry a search-engine label too, and the AI attribution is the interesting one.
 */
export const AI_HOST_LABELS = Object.freeze([
  'chatgpt', 'openai', 'perplexity', 'claude', 'anthropic', 'copilot', 'gemini',
]);

/** AI referrers whose identity is the whole registrable domain, not one label. */
export const AI_HOST_SUFFIXES = Object.freeze(['you.com']);

/** The public base URL the site is served from (also used by the live check). */
export function publicBaseUrl() {
  const raw = String(process.env.PUBLIC_BASE_URL || SITE_ORIGIN || '').trim();
  return raw.replace(/\/+$/, '') || SITE_ORIGIN;
}

/** UTC calendar day as `YYYY-MM-DD`. The only time resolution we keep. */
export function utcDay(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return utcDay(new Date());
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` for `days - 1` days before `now` (inclusive window start). */
export function windowStartDay(days, now = new Date()) {
  const n = Math.max(1, Math.min(365, Math.floor(Number(days) || 0) || 1));
  const base = now instanceof Date ? now : new Date(now);
  const start = new Date(base.getTime() - (n - 1) * 86400000);
  return utcDay(start);
}

/**
 * The allowlist: every canonicalPath in the registry. A row is only ever keyed on
 * a canonicalPath, so a duplicate/alias page counts against the page it
 * canonicalises to — the same rollup a search engine performs.
 */
const ALLOWED_PATHS = new Set(
  PUBLIC_PAGES
    .map((e) => (typeof e?.canonicalPath === 'string' ? e.canonicalPath : null))
    .filter(Boolean),
);

/**
 * The ROLLUP map: every registry `path` (and every canonicalPath, mapping to
 * itself) → the canonicalPath it is counted under. Built from the registry so it
 * can never drift from it.
 *
 * This is what makes the rollup real rather than documented. `/beta-waitlist`
 * canonicalises to `/`; before this map existed a beacon from that page was
 * DROPPED as "not tracked" (its own path is not a canonicalPath), silently
 * undercounting the homepage instead of rolling into it.
 */
const PATH_TO_CANONICAL = (() => {
  const map = new Map();
  for (const canon of ALLOWED_PATHS) map.set(canon, canon);
  for (const e of PUBLIC_PAGES) {
    const canon = typeof e?.canonicalPath === 'string' ? e.canonicalPath : null;
    const own = typeof e?.path === 'string' && e.path ? stripTrailingSlash(e.path) : null;
    if (!canon || !own || map.has(own)) continue;
    map.set(own, canon);
  }
  return map;
})();

/** The allowlist as a sorted array (the Ops analytics table's row skeleton). */
export function trackablePaths() {
  return [...ALLOWED_PATHS].sort();
}

/** True when a beacon path is one the registry canonicalises to. PURE. */
export function isTrackablePath(pathname) {
  return typeof pathname === 'string' && ALLOWED_PATHS.has(pathname);
}

/**
 * The canonicalPath a normalized beacon path is COUNTED UNDER, or null when the
 * registry does not know the path at all. PURE.
 *
 * A canonicalPath maps to itself, so this is a superset of `isTrackablePath`:
 * everything the allowlist accepted still passes, and an alias whose entry
 * canonicalises elsewhere now rolls up instead of being dropped.
 */
export function canonicalizeBeaconPath(pathname) {
  if (typeof pathname !== 'string') return null;
  return PATH_TO_CANONICAL.get(pathname) || null;
}

/**
 * Reduce a client-supplied path to the registry shape, or null. PURE.
 * Query strings and fragments are cut off before anything else — they are the
 * part most likely to carry something personal, and they are never part of a
 * registry path.
 */
export function normalizeBeaconPath(raw) {
  if (typeof raw !== 'string') return null;
  let p = raw.trim();
  if (!p || p.length > 512) return null;
  // Absolute URLs are accepted only for their pathname (a beacon from a page
  // that built location.href rather than location.pathname).
  if (/^https?:\/\//i.test(p)) {
    try { p = new URL(p).pathname; } catch { return null; }
  }
  p = p.split('#')[0].split('?')[0];
  if (!p.startsWith('/')) return null;
  if (p.includes('//')) return null;
  p = stripTrailingSlash(p);
  return /^[a-z0-9/\-._]*$/.test(p.slice(1)) ? p : null;
}

/** The dot-separated labels of a hostname, lowercased. PURE. */
function hostLabels(hostname) {
  return String(hostname || '').toLowerCase().split('.').filter(Boolean);
}

/** Own-host set: the request Host header, PUBLIC_BASE_URL and SITE_ORIGIN. */
function internalHostSet(host) {
  const out = new Set();
  const add = (value) => {
    const h = String(value || '').toLowerCase().split(':')[0].trim();
    if (!h) return;
    out.add(h);
    out.add(h.startsWith('www.') ? h.slice(4) : `www.${h}`);
  };
  add(host);
  for (const origin of [publicBaseUrl(), SITE_ORIGIN]) {
    try { add(new URL(origin).hostname); } catch { /* not a URL — ignore */ }
  }
  return out;
}

/**
 * Classify a referrer into one of REFERRER_CLASSES. PURE apart from reading the
 * PUBLIC_BASE_URL env for the internal-host set.
 *
 * @param {string} referrer  raw document.referrer (never persisted)
 * @param {{host?: string}} [opts]  the request Host header
 */
export function classifyReferrer(referrer, { host } = {}) {
  const raw = typeof referrer === 'string' ? referrer.trim() : '';
  if (!raw) return 'direct';

  let hostname = '';
  try {
    hostname = new URL(raw).hostname.toLowerCase();
  } catch {
    return 'direct'; // unparseable referrer tells us nothing — do not guess
  }
  if (!hostname) return 'direct';

  if (internalHostSet(host).has(hostname)) return 'internal';

  const labels = hostLabels(hostname);
  if (AI_HOST_SUFFIXES.some((s) => hostname === s || hostname.endsWith(`.${s}`))) return 'ai';
  if (AI_HOST_LABELS.some((l) => labels.includes(l))) return 'ai';
  if (SEARCH_HOST_LABELS.some((l) => labels.includes(l))) return 'search';
  return 'referral';
}

/**
 * Record one page view. Returns a typed result; NEVER throws and never reveals
 * anything to the caller (the route answers 204 whatever comes back).
 *
 * @param {{path?: string, referrer?: string, host?: string, now?: Date}} input
 * @returns {Promise<{ok:boolean, reason?:string, day?:string, path?:string,
 *                    referrerClass?:string, created?:boolean}>}
 */
export async function recordPageView({ path, referrer, host, now = new Date() } = {}) {
  const normalized = normalizeBeaconPath(path);
  // Roll up to the canonicalPath SERVER-SIDE. The client sends its entry's
  // canonicalPath too, but the server must not depend on that: an old cached
  // bundle, a hand-made request or a future alias would otherwise be dropped.
  const canonical = canonicalizeBeaconPath(normalized);
  if (!canonical) return { ok: false, reason: 'not-tracked' };

  const referrerClass = classifyReferrer(referrer, { host });
  const day = utcDay(now);

  try {
    const existing = await prisma.seoPageView.findFirst({
      where: { day, path: canonical, referrerClass },
      select: { id: true },
    });
    if (existing) {
      await prisma.seoPageView.update({
        where: { id: existing.id },
        data: { count: { increment: 1 } },
      });
      return { ok: true, day, path: canonical, referrerClass, created: false };
    }
    await prisma.seoPageView.create({
      data: { day, path: canonical, referrerClass, count: 1 },
    });
    return { ok: true, day, path: canonical, referrerClass, created: true };
  } catch {
    // A telemetry sink that can fail a request is worse than no telemetry.
    return { ok: false, reason: 'error' };
  }
}

/** Zeroed class bucket. */
const emptyClasses = () => Object.fromEntries(REFERRER_CLASSES.map((c) => [c, 0]));

/**
 * Fold raw SeoPageView rows into the Ops table shape. PURE — this is where the
 * "racing twins are fine" contract is honoured: rows are SUMMED, never counted.
 *
 * @param {{day?:string, path:string, referrerClass?:string, count?:number}[]} rows
 * @returns {{rows: object[], totals: object, grandTotal: number, days: string[]}}
 */
export function aggregatePageViews(rows) {
  const byPath = new Map();
  const totals = emptyClasses();
  const days = new Set();
  let grandTotal = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const path = typeof row?.path === 'string' ? row.path : null;
    if (!path) continue;
    const cls = REFERRER_CLASSES.includes(row?.referrerClass) ? row.referrerClass : 'direct';
    const count = Number.isFinite(Number(row?.count)) ? Math.max(0, Math.trunc(Number(row.count))) : 0;
    if (typeof row?.day === 'string' && row.day) days.add(row.day);

    if (!byPath.has(path)) byPath.set(path, { path, total: 0, classes: emptyClasses() });
    const bucket = byPath.get(path);
    bucket.classes[cls] += count;
    bucket.total += count;
    totals[cls] += count;
    grandTotal += count;
  }

  const out = [...byPath.values()].sort((a, b) => (b.total - a.total) || a.path.localeCompare(b.path));
  return { rows: out, totals, grandTotal, days: [...days].sort() };
}

/**
 * The last-N-days landing summary. Reads only the aggregate table.
 *
 * @param {{days?: number, now?: Date}} [opts]
 * @returns {Promise<{days:number, from:string, to:string, rows:object[],
 *                    totals:object, grandTotal:number, observedDays:string[],
 *                    available:boolean, error?:string}>}
 */
export async function getPageViewSummary({ days = 14, now = new Date() } = {}) {
  // A junk, missing or non-positive window falls back to the DEFAULT, not to 1:
  // silently showing a single day because a query param was malformed would look
  // like "nobody visited" rather than "you asked for nothing".
  const requested = Number(days);
  const window = Number.isFinite(requested) && requested >= 1
    ? Math.min(90, Math.floor(requested))
    : 14;
  const from = windowStartDay(window, now);
  const to = utcDay(now);

  let rows = [];
  try {
    // groupBy, not findMany+take. The previous read took at most 20 000 raw rows
    // with no orderBy and then presented the fold as complete: twin rows (there
    // is no unique index, by design) multiply the row count, and 90 days × the
    // registry × five classes can exceed the cap on its own — so an undercount
    // would have been rendered as data. The database does the SUM instead, which
    // collapses the twins at the source and bounds the result by the number of
    // DISTINCT (day, path, class) keys in the window. No cap is needed.
    const grouped = await prisma.seoPageView.groupBy({
      by: ['day', 'path', 'referrerClass'],
      where: { day: { gte: from, lte: to } },
      _sum: { count: true },
    });
    rows = (Array.isArray(grouped) ? grouped : []).map((g) => ({
      day: g.day,
      path: g.path,
      referrerClass: g.referrerClass,
      count: g?._sum?.count ?? 0,
    }));
  } catch (err) {
    return {
      days: window, from, to, rows: [], totals: emptyClasses(), grandTotal: 0,
      observedDays: [], available: false,
      error: err && err.message ? String(err.message).slice(0, 200) : 'query failed',
    };
  }

  const agg = aggregatePageViews(rows);
  return {
    days: window,
    from,
    to,
    rows: agg.rows,
    totals: agg.totals,
    grandTotal: agg.grandTotal,
    observedDays: agg.days,
    available: true,
  };
}
