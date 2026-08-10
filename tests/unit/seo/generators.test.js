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
  ROBOTS_DISALLOW,
  ROBOTS_SITEMAP,
} from '../../../scripts/seo/generators.js';

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
    },
    { title: 'About PecanRev', url: 'https://pecanrev.com/about', description: 'Who we build for.' },
  ];
  const txt = llmsTxt(pages);

  it('starts with the # PecanRev header and a prose summary', () => {
    expect(txt.startsWith('# PecanRev\n')).toBe(true);
    const summary = txt.split('## Pages')[0];
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
    expect(txt).toContain('## Pages');
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
      expect(out).toContain('## Pages');
      expect(out).not.toContain('- [');
    }
  });
});
