/**
 * seo/fields.js — 113.md item 8 — the vocabulary of the Ops › SEO section.
 *
 * Dependency-free on purpose (no React, no theme): the labels and the
 * repository-vs-observed wording are the part of this section most likely to
 * drift into a claim we cannot support, so they live in one plain module that a
 * unit test can import and pin.
 */

/** The five referrer classes the server persists, in display order. */
export const REFERRER_CLASSES = Object.freeze(['search', 'ai', 'referral', 'internal', 'direct']);

export const REFERRER_CLASS_LABELS = Object.freeze({
  search: 'Search',
  ai: 'AI assistant',
  referral: 'Referral',
  internal: 'Internal',
  direct: 'Direct',
});

/**
 * What each class actually means — shown as a legend, because "AI assistant"
 * means "the referring hostname looked like one", not "an AI recommended us".
 */
export const REFERRER_CLASS_NOTES = Object.freeze({
  search: 'Referring host looked like a search engine (Google, Bing, DuckDuckGo, Yahoo, Baidu, Ecosia).',
  ai: 'Referring host looked like an AI assistant or answer engine (ChatGPT, Perplexity, Claude, Copilot, Gemini, You.com).',
  referral: 'Some other site linked here.',
  internal: 'Navigation from one of our own pages.',
  direct: 'No referrer was sent — typed, bookmarked, or a client that strips referrers.',
});

/** Check verdicts. 'unknown' is a first-class outcome, never rendered as a pass. */
export const CHECK_STATUS_LABEL = Object.freeze({
  pass: 'Pass',
  fail: 'Fail',
  unknown: 'Not checked',
});

export const SEO_TABS = Object.freeze([
  { id: 'repository', label: 'Repository validation' },
  { id: 'live', label: 'Externally observed' },
  { id: 'analytics', label: 'Landing analytics' },
]);

/** Human label for a live-check target id. */
export const LIVE_TARGET_LABEL = Object.freeze({
  home: 'Homepage',
  feature: 'Feature page',
  sitemap: 'sitemap.xml',
  robots: 'robots.txt',
});

/** Search-engine verification states the repository can actually distinguish. */
export const VERIFICATION_STATE_LABEL = Object.freeze({
  token_present: 'Verification token present in the repository',
  not_configured: 'Not configured',
});

/**
 * Verdict for one live PAGE result: did the origin serve the PRERENDERED
 * document, or the empty app shell? PURE.
 *
 * This is the single most important computation in the section — it is the
 * check that would have caught the 111 production failure, where every route
 * returned a JavaScript shell with the homepage title and no content.
 *
 * @returns {'unreachable'|'http-error'|'prerendered'|'shell'|'partial'}
 */
export function servingVerdict(result) {
  if (!result || result.ok === false) return 'unreachable';
  if (typeof result.status === 'number' && result.status >= 400) return 'http-error';
  const signals = [result.titleMatches, result.h1Present, result.jsonLdPresent];
  if (signals.every(Boolean)) return 'prerendered';
  if (signals.every((s) => !s)) return 'shell';
  return 'partial';
}

export const SERVING_VERDICT_LABEL = Object.freeze({
  unreachable: 'Unreachable',
  'http-error': 'HTTP error',
  prerendered: 'Prerendered HTML served',
  shell: 'App shell served — crawlers see no content',
  partial: 'Partially prerendered',
});

/** A rounded, non-fabricated percentage string, or '—' when the base is zero. */
export function sharePct(value, total) {
  const v = Number(value) || 0;
  const t = Number(total) || 0;
  if (t <= 0) return '—';
  return `${Math.round((v / t) * 100)}%`;
}
