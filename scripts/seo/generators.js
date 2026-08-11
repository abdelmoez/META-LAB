/**
 * scripts/seo/generators.js — 111.md — PURE builders for the three crawler files.
 *
 * sitemap.xml, robots.txt and llms.txt are the only build artefacts a crawler reads
 * BEFORE it reads a page, so they are the easiest place to ship a lie by accident.
 * Keeping them here — pure, dependency-free, unit-tested — means the prerenderer
 * (scripts/prerender-public.mjs) only has to decide WHAT the entries are; HOW they
 * serialise is settled and covered by tests/unit/seo/generators.test.js.
 *
 * Deliberately plain `.js` with no imports: eslint.config.js lints `**\/*.js`, and
 * vitest can import it directly without a build step.
 *
 * HONESTY RULES (111.md prohibitions), enforced by the tests:
 *   - <lastmod> is OMITTED when the caller has no real date. Never `new Date()`.
 *   - llms.txt describes the product in plain capability language. No superlatives,
 *     no unverifiable claims, no marketing adjectives.
 *
 * WHICH PAGES GO WHERE (113 §2) — decided by the registry, not here:
 *   - sitemap.xml gets `sitemapPages()`  — indexable AND not `sitemap: false`.
 *   - llms.txt  gets `indexablePages()` — the wider set, so /login and /register
 *     stay discoverable to an assistant answering "where do I sign in" while staying
 *     out of the crawl submission. scripts/prerender-public.mjs makes both calls;
 *     these builders only serialise the list they are handed.
 */

/* ────────────────────────────── sitemap.xml ─────────────────────────────── */

/** Escape a value destined for XML text content. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a sitemap.xml document.
 *
 * @param {{loc: string, lastmod?: string, changefreq?: string, priority?: number}[]} entries
 *   `loc` MUST already be absolute (use absoluteUrl from publicPages.js). `lastmod`
 *   is emitted only when it is a non-empty string — an absent or empty value means
 *   "we do not know", and the correct sitemap for that is no <lastmod> element.
 * @returns {string} the complete XML document, newline-terminated.
 */
export function sitemapXml(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && e.loc);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const entry of list) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    if (typeof entry.lastmod === 'string' && entry.lastmod.trim()) {
      lines.push(`    <lastmod>${escapeXml(entry.lastmod.trim())}</lastmod>`);
    }
    if (typeof entry.changefreq === 'string' && entry.changefreq.trim()) {
      lines.push(`    <changefreq>${escapeXml(entry.changefreq.trim())}</changefreq>`);
    }
    if (typeof entry.priority === 'number' && Number.isFinite(entry.priority)) {
      lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
    }
    lines.push('  </url>');
  }
  lines.push('</urlset>');
  return `${lines.join('\n')}\n`;
}

/* ─────────────────────────────── robots.txt ─────────────────────────────── */

/**
 * The Disallow list. Every rule here corresponds to a real authenticated,
 * tokenised or staff-only surface (mirrors NON_INDEXABLE_PATTERNS in
 * src/frontend/website/publicPages.js) plus the internal prerender staging
 * directory, which is an implementation detail the origin serves from, not a URL
 * a human is meant to visit.
 *
 * SECURITY NOTE: robots.txt is SEO hygiene, never access control. /ops and
 * /sift-beta are 404-cloaked by AdminRoute + requireAdmin; this list is layered on
 * top of that control and does not replace it.
 */
export const ROBOTS_DISALLOW = [
  '/api/',
  '/app',
  '/ops',
  '/sift-beta',
  '/invite/',
  '/reset',
  '/verify-email',
  '/accept-invitation',
  '/embed/',
  '/public/synthesis/',
  '/__prerender/',
];

/** Absolute URL of the sitemap, advertised in robots.txt. */
export const ROBOTS_SITEMAP = 'https://pecanrev.com/sitemap.xml';

/**
 * Build robots.txt.
 * @returns {string} the complete file, newline-terminated.
 */
export function robotsTxt() {
  const lines = ['User-agent: *', 'Allow: /'];
  for (const rule of ROBOTS_DISALLOW) lines.push(`Disallow: ${rule}`);
  lines.push('');
  lines.push(`Sitemap: ${ROBOTS_SITEMAP}`);
  return `${lines.join('\n')}\n`;
}

/* ──────────────────────────────── llms.txt ──────────────────────────────── */

/**
 * The site summary at the top of llms.txt. Capability statements only — this text
 * is read by systems that will repeat it, so anything unverifiable here becomes a
 * fabricated claim somewhere else.
 */
export const LLMS_SUMMARY = [
  'PecanRev is a systematic review and meta-analysis platform. One project carries the '
  + 'search strategy, screening decisions, extracted data, risk-of-bias assessments, '
  + 'statistical synthesis and the manuscript draft.',
  'It covers search strategy building across bibliographic databases, title/abstract and '
  + 'full-text screening with multiple reviewers, structured data extraction, meta-analysis '
  + 'with forest plots and network meta-analysis, the PRISMA 2020 flow diagram, and '
  + 'manuscript preparation.',
  'Screening and extraction models produce suggestions; a person records every decision.',
];

/**
 * 113 §6 — llms.txt sections, in emission order.
 *
 * The file grew from 16 pages to 33; one flat list of 33 links is a worse map of the
 * site than six labelled ones, because the reader (a model deciding which URL answers
 * a question) has to infer the difference between a feature page, a methodology guide
 * and a comparison from the slug. `key` is the registry entry's `navGroup`, so adding
 * a page to an existing group needs no change here.
 *
 * A page whose navGroup matches nothing below lands in the trailing catch-all rather
 * than being dropped: a silently missing page is exactly the failure this file exists
 * to prevent, and it is caught by tests/unit/seo/generators.test.js.
 */
export const LLMS_GROUPS = [
  { key: 'product', heading: 'Product' },
  { key: 'resources', heading: 'Methodology guides' },
  { key: 'compare', heading: 'Comparisons' },
  { key: 'company', heading: 'Company' },
  { key: 'account', heading: 'Account access' },
  { key: 'legal', heading: 'Legal' },
];

/** Heading used for pages whose group is unknown. */
export const LLMS_OTHER_HEADING = 'Other pages';

/**
 * Build llms.txt — a plain-text map of the public site for LLM crawlers.
 *
 * @param {{title: string, url: string, description?: string, group?: string}[]} pages
 *   `url` MUST already be absolute. `group` is the registry `navGroup`; see LLMS_GROUPS.
 * @returns {string} the complete file, newline-terminated.
 */
export function llmsTxt(pages) {
  const list = (Array.isArray(pages) ? pages : []).filter((p) => p && p.title && p.url);
  const lines = ['# PecanRev', ''];
  for (const sentence of LLMS_SUMMARY) {
    lines.push(sentence);
    lines.push('');
  }

  const known = new Set(LLMS_GROUPS.map((g) => g.key));
  const sections = LLMS_GROUPS
    .map((g) => ({ heading: g.heading, items: list.filter((p) => p.group === g.key) }))
    .concat([{
      heading: LLMS_OTHER_HEADING,
      items: list.filter((p) => !known.has(p.group)),
    }])
    .filter((s) => s.items.length > 0);

  for (const section of sections) {
    lines.push(`## ${section.heading}`);
    lines.push('');
    for (const page of section.items) {
      const description = typeof page.description === 'string' ? page.description.trim() : '';
      lines.push(description
        ? `- [${page.title}](${page.url}): ${description}`
        : `- [${page.title}](${page.url})`);
    }
    lines.push('');
  }

  // Trailing blank line from the last section becomes the file's single terminator.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return `${lines.join('\n')}\n`;
}
