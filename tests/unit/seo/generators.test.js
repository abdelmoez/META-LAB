/**
 * generators.test.js — 111.md — the crawler-file builders.
 *
 * These three files are the first thing a crawler reads, and a mistake in them is
 * invisible in the UI: a wrong Disallow silently de-indexes a real page, a
 * fabricated <lastmod> teaches Google to distrust the whole sitemap, and hype in
 * llms.txt gets repeated verbatim by an assistant as if it were a product fact.
 * Hence: escaping, omission-not-invention, the exact Disallow set, and a banned-word
 * check on the LLM-facing copy.
 */
import { describe, it, expect } from 'vitest';
import {
  sitemapXml,
  robotsTxt,
  llmsTxt,
  LLMS_GROUPS,
  LLMS_OTHER_HEADING,
  ROBOTS_DISALLOW,
  ROBOTS_SITEMAP,
} from '../../../scripts/seo/generators.js';
import {
  SITE_ORIGIN,
  absoluteUrl,
  indexablePages,
  sitemapPages,
} from '../../../src/frontend/website/publicPages.js';

describe('sitemapXml', () => {
  it('emits a well-formed urlset with one <url> per entry', () => {
    const xml = sitemapXml([
      { loc: 'https://pecanrev.com/' },
      { loc: 'https://pecanrev.com/terms' },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
    expect(xml.match(/<url>/g)).toHaveLength(2);
    expect(xml.match(/<\/url>/g)).toHaveLength(2);
    expect(xml).toContain('<loc>https://pecanrev.com/terms</loc>');
    // Balanced tags — the cheapest possible well-formedness signal.
    expect(xml.match(/<loc>/g)).toHaveLength(2);
    expect(xml.match(/<\/loc>/g)).toHaveLength(2);
  });

  it('XML-escapes the loc', () => {
    const xml = sitemapXml([{ loc: 'https://pecanrev.com/s?a=1&b=2<x>"y\'z' }]);
    expect(xml).toContain('<loc>https://pecanrev.com/s?a=1&amp;b=2&lt;x&gt;&quot;y&apos;z</loc>');
    // The raw ampersand must not survive anywhere.
    expect(/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml)).toBe(false);
  });

  it('emits <lastmod> when given one', () => {
    const xml = sitemapXml([{ loc: 'https://pecanrev.com/', lastmod: '2026-06-20T17:03:47-04:00' }]);
    expect(xml).toContain('<lastmod>2026-06-20T17:03:47-04:00</lastmod>');
  });

  it('OMITS <lastmod> entirely when it is absent, empty or blank', () => {
    for (const entry of [
      { loc: 'https://pecanrev.com/' },
      { loc: 'https://pecanrev.com/', lastmod: '' },
      { loc: 'https://pecanrev.com/', lastmod: '   ' },
      { loc: 'https://pecanrev.com/', lastmod: null },
      { loc: 'https://pecanrev.com/', lastmod: undefined },
    ]) {
      const xml = sitemapXml([entry]);
      expect(xml).not.toContain('<lastmod>');
    }
  });

  it('emits optional changefreq/priority only when supplied', () => {
    const bare = sitemapXml([{ loc: 'https://pecanrev.com/' }]);
    expect(bare).not.toContain('<changefreq>');
    expect(bare).not.toContain('<priority>');
    const full = sitemapXml([{ loc: 'https://pecanrev.com/', changefreq: 'weekly', priority: 1 }]);
    expect(full).toContain('<changefreq>weekly</changefreq>');
    expect(full).toContain('<priority>1.0</priority>');
  });

  it('tolerates a missing/empty entry list and skips entries with no loc', () => {
    for (const input of [undefined, null, [], [null], [{}], [{ loc: '' }]]) {
      const xml = sitemapXml(input);
      expect(xml).toContain('<urlset');
      expect(xml).not.toContain('<url>');
    }
  });
});

describe('robotsTxt', () => {
  const txt = robotsTxt();

  it('opens with the wildcard user-agent and an Allow', () => {
    expect(txt.startsWith('User-agent: *\nAllow: /\n')).toBe(true);
  });

  it.each([
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
  ])('disallows %s', (rule) => {
    expect(txt).toContain(`\nDisallow: ${rule}\n`);
    expect(ROBOTS_DISALLOW).toContain(rule);
  });

  it('advertises the absolute sitemap URL', () => {
    expect(txt).toContain('Sitemap: https://pecanrev.com/sitemap.xml');
    expect(ROBOTS_SITEMAP).toBe('https://pecanrev.com/sitemap.xml');
  });

  it('never disallows a public marketing surface', () => {
    for (const publicPath of ['/features', '/resources', '/about', '/terms', '/login', '/register']) {
      expect(txt).not.toContain(`Disallow: ${publicPath}\n`);
    }
  });

  it('is deterministic and newline-terminated', () => {
    expect(robotsTxt()).toBe(txt);
    expect(txt.endsWith('\n')).toBe(true);
  });
});

describe('llmsTxt', () => {
  const pages = [
    {
      title: 'PecanRev — Systematic Review & Meta-Analysis Platform',
      url: 'https://pecanrev.com/',
      description: 'An end-to-end platform for systematic reviews.',
      group: 'product',
    },
    {
      title: 'About PecanRev',
      url: 'https://pecanrev.com/about',
      description: 'Who we build for.',
      group: 'company',
    },
  ];
  const txt = llmsTxt(pages);
  /** Everything before the first `## ` section heading. */
  const summaryOf = (out) => out.split(/\n## /)[0];

  it('starts with the # PecanRev header and a prose summary', () => {
    expect(txt.startsWith('# PecanRev\n')).toBe(true);
    const summary = summaryOf(txt);
    expect(summary).toMatch(/systematic review and meta-analysis platform/i);
    // 2-3 honest sentences, not a wall of copy.
    const sentences = summary.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });

  it('names the real capabilities', () => {
    for (const capability of [
      /search strategy/i,
      /screening/i,
      /data extraction/i,
      /meta-analysis/i,
      /forest plot/i,
      /network meta-analysis/i,
      /PRISMA/,
      /manuscript/i,
    ]) {
      expect(txt).toMatch(capability);
    }
  });

  it('lists each page as a markdown link with its description', () => {
    expect(txt).toContain(
      '- [PecanRev — Systematic Review & Meta-Analysis Platform](https://pecanrev.com/): '
      + 'An end-to-end platform for systematic reviews.',
    );
    expect(txt).toContain('- [About PecanRev](https://pecanrev.com/about): Who we build for.');
  });

  it('omits the ": description" suffix when a page has none', () => {
    const out = llmsTxt([{ title: 'Bare', url: 'https://pecanrev.com/bare' }]);
    expect(out).toContain('- [Bare](https://pecanrev.com/bare)\n');
    expect(out).not.toContain('- [Bare](https://pecanrev.com/bare):');
  });

  /* ── 113 §6 — grouping ── */

  it('groups pages under their navGroup heading, in the declared order', () => {
    expect(txt).toContain('## Product');
    expect(txt).toContain('## Company');
    expect(txt.indexOf('## Product')).toBeLessThan(txt.indexOf('## Company'));
    // Each link sits under its own heading, not in one flat list.
    const productSection = txt.split('## Product')[1].split('\n## ')[0];
    expect(productSection).toContain('](https://pecanrev.com/)');
    expect(productSection).not.toContain('/about');
  });

  it('emits no heading for a group with no pages', () => {
    const out = llmsTxt([{ title: 'Only', url: 'https://pecanrev.com/x', group: 'product' }]);
    expect(out).toContain('## Product');
    for (const g of LLMS_GROUPS.filter((x) => x.key !== 'product')) {
      expect(out, `empty group ${g.key} should not print a heading`).not.toContain(`## ${g.heading}`);
    }
  });

  /**
   * A page silently vanishing from llms.txt is precisely the class of bug this file
   * exists to prevent, so an unrecognised group must degrade to a visible catch-all
   * rather than to nothing. scripts/prerender-public.mjs additionally fails the build
   * when the link count does not match the indexable count.
   */
  it('never drops a page whose group is unknown or missing', () => {
    const out = llmsTxt([
      { title: 'Grouped', url: 'https://pecanrev.com/a', group: 'product' },
      { title: 'Strange', url: 'https://pecanrev.com/b', group: 'not-a-real-group' },
      { title: 'Ungrouped', url: 'https://pecanrev.com/c' },
    ]);
    expect(out).toContain(`## ${LLMS_OTHER_HEADING}`);
    expect((out.match(/^- \[/gm) || []).length).toBe(3);
    expect(out).toContain('- [Strange](https://pecanrev.com/b)');
    expect(out).toContain('- [Ungrouped](https://pecanrev.com/c)');
  });

  it('lists EVERY indexable registry page exactly once, /login and /register included', () => {
    const indexable = indexablePages();
    const out = llmsTxt(indexable.map((e) => ({
      title: e.title,
      url: absoluteUrl(e.canonicalPath || e.path, SITE_ORIGIN),
      description: e.description,
      group: e.navGroup,
    })));
    const links = out.match(/^- \[/gm) || [];
    expect(links.length, 'grouping must not drop a page').toBe(indexable.length);
    for (const e of indexable) {
      const url = absoluteUrl(e.canonicalPath || e.path, SITE_ORIGIN);
      expect(out.split(`](${url}):`).length - 1, `${e.path} listed once`).toBe(1);
    }
    // sitemap:false pages are OUT of the sitemap but IN here — "where do I sign in"
    // is a question an assistant should be able to answer.
    expect(out).toContain(`](${SITE_ORIGIN}/login):`);
    expect(out).toContain(`](${SITE_ORIGIN}/register):`);
    // No section is left empty or unlabelled.
    expect(out).not.toContain(`## ${LLMS_OTHER_HEADING}`);
  });

  it('contains no marketing hype', () => {
    // Pinned, small, and deliberately unambiguous: these words assert a ranking
    // nobody can verify, and an LLM will repeat them as fact.
    const BANNED = ['world-class', 'revolutionary', 'best-in-class'];
    const lower = txt.toLowerCase();
    for (const word of BANNED) expect(lower).not.toContain(word);
  });

  it('tolerates a missing/empty page list', () => {
    for (const input of [undefined, null, [], [null], [{}], [{ title: 'x' }]]) {
      const out = llmsTxt(input);
      expect(out).toContain('# PecanRev');
      expect(out).not.toContain('- [');
      // No page, no section headings — an empty "## Product" advertises nothing.
      expect(out).not.toContain('\n## ');
      expect(out.endsWith('\n')).toBe(true);
    }
  });
});

/* ─────────── 113 §2 — what the built sitemap actually contains ───────────── */

describe('sitemap.xml built from the registry', () => {
  const xml = sitemapXml(sitemapPages().map((e) => ({
    loc: absoluteUrl(e.canonicalPath || e.path, SITE_ORIGIN),
    ...(e.changefreq ? { changefreq: e.changefreq } : {}),
    ...(typeof e.priority === 'number' ? { priority: e.priority } : {}),
  })));

  it('EXCLUDES every `sitemap: false` entry — /login and /register', () => {
    // Regression pin: the deployed sitemap listed both, which submits two thin auth
    // forms for crawl alongside the pages that actually have something to say.
    expect(xml).not.toContain(`<loc>${SITE_ORIGIN}/login</loc>`);
    expect(xml).not.toContain(`<loc>${SITE_ORIGIN}/register</loc>`);
  });

  it('includes every other indexable page, once each', () => {
    for (const e of sitemapPages()) {
      const loc = `<loc>${absoluteUrl(e.canonicalPath || e.path, SITE_ORIGIN)}</loc>`;
      expect(xml.split(loc).length - 1, `${e.path} appears exactly once`).toBe(1);
    }
    expect((xml.match(/<url>/g) || []).length).toBe(sitemapPages().length);
  });

  it('lists the pages that carry the commercial and educational intent', () => {
    for (const p of ['/', '/systematic-review-software', '/ai-systematic-review',
      '/features/risk-of-bias', '/features/prisma-flow-diagram', '/compare',
      '/resources/how-to-conduct-a-systematic-review', '/resources/publication-bias']) {
      expect(xml, `${p} missing from sitemap.xml`).toContain(`<loc>${absoluteUrl(p, SITE_ORIGIN)}</loc>`);
    }
  });

  it('never submits a noindex surface', () => {
    for (const p of ['/beta-waitlist', '/app', '/ops', '/sift-beta', '/__prerender']) {
      expect(xml, `${p} must never be submitted`).not.toContain(`${SITE_ORIGIN}${p}`);
    }
  });
});
