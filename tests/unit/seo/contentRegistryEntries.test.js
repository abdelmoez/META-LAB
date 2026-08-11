/**
 * 111.md §§7, 8, 9, 17 — integrity of the content-page registry entries (W1-B).
 *
 * These complement W1-A's registry-shape tests: they pin the things that can
 * only drift between the registry and the CONTENT — descriptions, canonical
 * paths, lastmod sources, and the FAQPage-versus-visible-copy contract.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PUBLIC_PAGES,
  HOMEPAGE_FAQ,
  SITE_ORIGIN,
  contentArticleJsonLd,
} from '../../../src/frontend/website/publicPages.js';
import { DOCS } from '../../../src/frontend/website/content/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** The entries this agent owns: everything backed by a markdown content file. */
const CONTENT_PATHS = Object.values(DOCS).map(d => d.path);
const contentEntries = PUBLIC_PAGES.filter(e => CONTENT_PATHS.includes(e.path));

describe('content registry entries', () => {
  it('registers every content document exactly once', () => {
    expect(contentEntries).toHaveLength(CONTENT_PATHS.length);
    expect(new Set(contentEntries.map(e => e.path)).size).toBe(CONTENT_PATHS.length);
  });

  it('carries the same title and description as the document frontmatter', () => {
    for (const entry of contentEntries) {
      const doc = DOCS[entry.path.slice(1)];
      expect(entry.title, `${entry.path} title drifted`).toBe(doc.frontmatter.title);
      expect(entry.description, `${entry.path} description drifted`).toBe(doc.frontmatter.description);
    }
  });

  it('self-canonicalises and is indexable', () => {
    for (const entry of contentEntries) {
      expect(entry.canonicalPath).toBe(entry.path);
      expect(entry.indexable).toBe(true);
    }
  });

  it('points component and lastmodSource at files that exist', () => {
    for (const entry of contentEntries) {
      expect(existsSync(resolve(REPO_ROOT, entry.component)), `missing ${entry.component}`).toBe(true);
      expect(existsSync(resolve(REPO_ROOT, entry.lastmodSource)), `missing ${entry.lastmodSource}`).toBe(true);
    }
  });

  it('uses the markdown body as the lastmod source, not the wrapper component', () => {
    // 111.md — honest lastmod: the thing that changes is the copy.
    for (const entry of contentEntries) {
      expect(entry.lastmodSource).toMatch(/^src\/frontend\/website\/content\//);
    }
  });

  it('gives each entry a description inside the registry contract (110-165 chars)', () => {
    // This band used to be 90-230, which is why twelve entries drifted past the
    // documented 165 without anything going red. It now mirrors the ENTRY CONTRACT
    // in publicPages.js exactly — Google truncates around 155-160.
    for (const entry of contentEntries) {
      expect(entry.description.length, `${entry.path} description too short`).toBeGreaterThanOrEqual(110);
      expect(entry.description.length, `${entry.path} description too long`).toBeLessThanOrEqual(165);
    }
  });

  it('carries navLabel and navGroup for internal linking', () => {
    for (const entry of contentEntries) {
      expect(entry.navLabel, `${entry.path} has no navLabel`).toBeTruthy();
      // 113 W1-A added 'compare': the /compare section is its own footer column,
      // because "which tool" is a different question from "what does this do".
      expect(['product', 'resources', 'compare', 'company']).toContain(entry.navGroup);
    }
  });
});

describe('content JSON-LD', () => {
  const ctxFor = entry => ({ origin: SITE_ORIGIN, path: entry.path, entry });

  it('produces a serialisable @graph for every content entry', () => {
    for (const entry of contentEntries) {
      const graph = entry.jsonLd(ctxFor(entry));
      expect(graph['@context']).toBe('https://schema.org');
      expect(Array.isArray(graph['@graph'])).toBe(true);
      expect(() => JSON.stringify(graph)).not.toThrow();
      // A JSON-LD payload must never be able to close its own <script> element.
      expect(JSON.stringify(graph)).not.toContain('</script');
    }
  });

  it('emits a BreadcrumbList matching the visible trail depth', () => {
    for (const entry of contentEntries) {
      const nodes = entry.jsonLd(ctxFor(entry))['@graph'];
      const crumbs = nodes.find(n => n['@type'] === 'BreadcrumbList');
      expect(crumbs, `${entry.path} has no BreadcrumbList`).toBeTruthy();
      expect(crumbs.itemListElement[0].name).toBe('Home');
      expect(crumbs.itemListElement.at(-1).item).toBe(`${SITE_ORIGIN}${entry.path}`);
      crumbs.itemListElement.forEach((item, i) => expect(item.position).toBe(i + 1));
    }
  });

  it('marks every methodology guide as Article and everything else as WebPage', () => {
    // 113 W1-B — the count is derived from the content documents rather than pinned
    // at a literal, so adding a guide cannot silently skip the Article assertions.
    const guides = contentEntries.filter(e => e.path.startsWith('/resources/'));
    const guideDocs = Object.keys(DOCS).filter(s => s.startsWith('resources/'));
    expect(guides).toHaveLength(guideDocs.length);
    expect(guides.length).toBeGreaterThanOrEqual(12);
    for (const entry of guides) {
      const nodes = entry.jsonLd(ctxFor(entry))['@graph'];
      const article = nodes.find(n => n['@type'] === 'Article');
      expect(article, `${entry.path} is not an Article`).toBeTruthy();
      expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // 111.md §36 — authorship is the organisation, never an invented person.
      expect(article.author['@type']).toBe('Organization');
    }
    for (const entry of contentEntries.filter(e => !e.path.startsWith('/resources/'))) {
      const nodes = entry.jsonLd(ctxFor(entry))['@graph'];
      expect(nodes.some(n => n['@type'] === 'WebPage')).toBe(true);
    }
  });

  it('never emits a rating, review or aggregateRating', () => {
    for (const entry of contentEntries) {
      const json = JSON.stringify(entry.jsonLd(ctxFor(entry)));
      expect(json).not.toMatch(/aggregateRating|"review"|ratingValue/i);
    }
  });

  it('contentArticleJsonLd omits dates when the entry has none', () => {
    const node = contentArticleJsonLd({ path: '/x', title: 'T', description: 'D' });
    expect(node.datePublished).toBeUndefined();
    expect(node.dateModified).toBeUndefined();
  });
});

describe('homepage FAQ (111.md §7)', () => {
  const home = PUBLIC_PAGES.find(e => e.path === '/');

  it('has a meaningful number of real questions', () => {
    expect(HOMEPAGE_FAQ.length).toBeGreaterThanOrEqual(6);
    expect(HOMEPAGE_FAQ.length).toBeLessThanOrEqual(12);
  });

  it('every entry is a genuine question with a substantive answer', () => {
    for (const item of HOMEPAGE_FAQ) {
      expect(item.question.endsWith('?'), `not a question: ${item.question}`).toBe(true);
      expect(item.answer.length, `answer too thin: ${item.question}`).toBeGreaterThan(120);
    }
  });

  it('has unique questions', () => {
    const qs = HOMEPAGE_FAQ.map(f => f.question);
    expect(new Set(qs).size).toBe(qs.length);
  });

  it("the homepage FAQPage schema matches HOMEPAGE_FAQ exactly", () => {
    const graph = home.jsonLd({ origin: SITE_ORIGIN, path: '/', entry: home })['@graph'];
    const faq = graph.find(n => n['@type'] === 'FAQPage');
    expect(faq).toBeTruthy();
    expect(faq.mainEntity.map(q => q.name)).toEqual(HOMEPAGE_FAQ.map(f => f.question));
    expect(faq.mainEntity.map(q => q.acceptedAnswer.text)).toEqual(HOMEPAGE_FAQ.map(f => f.answer));
  });

  /**
   * Source-scan pin. Landing.jsx cannot be SSR-rendered in a unit test (it needs
   * router + auth context and fetches /api/settings/public), so the guarantee
   * that the visible FAQ comes from HOMEPAGE_FAQ is pinned at the source level.
   * If someone hardcodes the questions in JSX instead, this fails.
   */
  describe('Landing.jsx wiring', () => {
    const landing = readFileSync(resolve(REPO_ROOT, 'src/frontend/pages/Landing.jsx'), 'utf8');

    it('imports and maps HOMEPAGE_FAQ rather than duplicating the copy', () => {
      expect(landing).toContain("import { HOMEPAGE_FAQ } from '../website/publicPages.js'");
      expect(landing).toContain('HOMEPAGE_FAQ.map(item =>');
      expect(landing).toContain('{item.question}');
      expect(landing).toContain('{item.answer}');
    });

    it('renders the FAQ questions as h3 under a section h2', () => {
      expect(landing).toMatch(/<section id="faq"/);
      expect(landing).toMatch(/<h3[\s\S]{0,240}\{item\.question\}/);
    });

    it('keeps exactly one h1 on the homepage', () => {
      expect((landing.match(/<h1[\s>]/g) || []).length).toBe(1);
    });

    it('links the new public pages from the footer via the shared nav map', () => {
      expect(landing).toContain("import { FEATURE_LINKS, RESOURCE_LINKS } from '../website/siteNav.js'");
      expect(landing).toContain('FEATURE_LINKS.map(');
      expect(landing).toContain('RESOURCE_LINKS.map(');
    });

    it('still reads admin-editable copy through the landingContent overlay', () => {
      // The admin-copy contract must survive this round untouched.
      expect(landing).toContain('const c = data.landingContent || data;');
      expect(landing).toContain('settings.navLinks');
      expect(landing).toContain('settings.footerLinks');
    });
  });

  it('keeps the homepage entity graph intact alongside the FAQ', () => {
    const graph = home.jsonLd({ origin: SITE_ORIGIN, path: '/', entry: home })['@graph'];
    expect(graph.map(n => n['@type'])).toEqual(['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']);
  });
});
