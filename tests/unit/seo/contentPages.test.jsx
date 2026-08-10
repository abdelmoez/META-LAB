/**
 * 111.md §§8, 9, 55 — SSR shape tests for every public content page.
 *
 * The build-time prerenderer renders these components with react-dom/server, so
 * "does it render at all under renderToStaticMarkup" is the load-bearing
 * assertion: any window/document access fails here before it can fail the build.
 *
 * `html()` wraps each page in a <MemoryRouter> seeded with that page's real path,
 * exactly as scripts/prerender-public.mjs does. That is not a convenience — PageShell
 * calls useLocation() to look its registry entry up for usePageHead, so rendering
 * bare would assert a configuration the prerenderer never uses. Effects still never
 * run under renderToStaticMarkup, so no head is touched here.
 *
 * House style: renderToStaticMarkup only — no jsdom, no Testing Library.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { DOCS, validateDocs, REQUIRED_FRONTMATTER } from '../../../src/frontend/website/content/index.js';
import { PUBLIC_PAGES } from '../../../src/frontend/website/publicPages.js';
import { FEATURE_LINKS, RESOURCE_LINKS, COMPANY_LINKS, allNavPaths } from '../../../src/frontend/website/siteNav.js';

import { FeaturesIndexPage } from '../../../src/frontend/website/pages/FeaturesIndexPage.jsx';
import { SearchEnginePage } from '../../../src/frontend/website/pages/SearchEnginePage.jsx';
import { ScreeningPage } from '../../../src/frontend/website/pages/ScreeningPage.jsx';
import { DataExtractionPage } from '../../../src/frontend/website/pages/DataExtractionPage.jsx';
import { MetaAnalysisPage } from '../../../src/frontend/website/pages/MetaAnalysisPage.jsx';
import { ManuscriptPage } from '../../../src/frontend/website/pages/ManuscriptPage.jsx';
import { ResourcesIndexPage } from '../../../src/frontend/website/pages/ResourcesIndexPage.jsx';
import { WhatIsSystematicReviewPage } from '../../../src/frontend/website/pages/WhatIsSystematicReviewPage.jsx';
import { Prisma2020Page } from '../../../src/frontend/website/pages/Prisma2020Page.jsx';
import { ScreeningGuidePage } from '../../../src/frontend/website/pages/ScreeningGuidePage.jsx';
import { MetaAnalysisGuidePage } from '../../../src/frontend/website/pages/MetaAnalysisGuidePage.jsx';
import { AboutPage } from '../../../src/frontend/website/pages/AboutPage.jsx';

/** [slug, Component] for every markdown-backed public page. */
const PAGES = [
  ['features', FeaturesIndexPage],
  ['features/search-engine', SearchEnginePage],
  ['features/screening', ScreeningPage],
  ['features/data-extraction', DataExtractionPage],
  ['features/meta-analysis', MetaAnalysisPage],
  ['features/manuscript', ManuscriptPage],
  ['resources', ResourcesIndexPage],
  ['resources/what-is-a-systematic-review', WhatIsSystematicReviewPage],
  ['resources/prisma-2020-explained', Prisma2020Page],
  ['resources/title-and-abstract-screening', ScreeningGuidePage],
  ['resources/how-to-run-a-meta-analysis', MetaAnalysisGuidePage],
  ['about', AboutPage],
];

const html = (Component, slug) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[slug ? `/${slug}` : '/']}>
    <Component />
  </MemoryRouter>,
);
const count = (str, re) => (str.match(re) || []).length;

describe('content documents', () => {
  it('every document carries the required frontmatter and a valid heading shape', () => {
    expect(validateDocs()).toEqual([]);
  });

  it('exposes exactly the documents the page components need', () => {
    for (const [slug] of PAGES) expect(DOCS[slug], `missing doc ${slug}`).toBeTruthy();
    expect(Object.keys(DOCS).sort()).toEqual(PAGES.map(p => p[0]).sort());
  });

  it('requires all six frontmatter keys', () => {
    expect(REQUIRED_FRONTMATTER).toEqual(['title', 'description', 'slug', 'published', 'updated', 'author']);
  });

  it('gives every document a unique title and description', () => {
    const titles = Object.values(DOCS).map(d => d.frontmatter.title);
    const descs = Object.values(DOCS).map(d => d.frontmatter.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descs).size).toBe(descs.length);
  });

  it('never links to an unsafe scheme', () => {
    for (const doc of Object.values(DOCS)) {
      expect(doc.source, `${doc.slug} contains a javascript: link`).not.toMatch(/\]\(\s*javascript:/i);
      expect(doc.source, `${doc.slug} contains a data: link`).not.toMatch(/\]\(\s*data:/i);
    }
  });
});

describe('SSR rendering', () => {
  for (const [slug, Component] of PAGES) {
    describe(slug, () => {
      const markup = html(Component, slug);
      const doc = DOCS[slug];

      it('renders under renderToStaticMarkup without touching the DOM', () => {
        expect(markup.length).toBeGreaterThan(2000);
      });

      it('has exactly one h1, and it is the document h1', () => {
        expect(count(markup, /<h1[\s>]/g)).toBe(1);
        expect(markup).toContain(doc.frontmatter.h1);
      });

      it('has h2 section headings and no heading level skips below h2', () => {
        expect(count(markup, /<h2[\s>]/g)).toBeGreaterThanOrEqual(2);
        // h5/h6 are not part of the content subset.
        expect(count(markup, /<h5[\s>]/g)).toBe(0);
        expect(count(markup, /<h6[\s>]/g)).toBe(0);
      });

      it('shows a byline and a machine-readable last-reviewed date', () => {
        expect(markup).toContain(doc.frontmatter.author);
        // React emits the JSX prop name verbatim here; HTML attribute names are
        // case-insensitive, so this is a valid <time datetime="…"> to a parser.
        expect(markup).toContain(`<time dateTime="${doc.frontmatter.updated}">`);
      });

      it('has a breadcrumb trail and a registration CTA to /register', () => {
        expect(markup).toContain('aria-label="Breadcrumb"');
        expect(markup).toContain('href="/register"');
      });

      it('emits no raw markdown syntax and no injected HTML', () => {
        expect(markup).not.toMatch(/<p[^>]*>\s*##\s/);
        expect(markup).not.toContain('dangerouslySetInnerHTML');
        expect(markup).not.toContain('<script');
      });

      it('links onward to other public pages', () => {
        const internal = new Set((markup.match(/href="(\/[a-z0-9/-]*)"/g) || []));
        expect(internal.size).toBeGreaterThan(6);
      });
    });
  }
});

describe('cornerstone guides cite real sources', () => {
  const GUIDES = [
    'resources/what-is-a-systematic-review',
    'resources/prisma-2020-explained',
    'resources/title-and-abstract-screening',
    'resources/how-to-run-a-meta-analysis',
  ];

  it('each guide has a References section with at least four resolvable citations', () => {
    for (const slug of GUIDES) {
      const doc = DOCS[slug];
      expect(doc.source, `${slug} has no References section`).toContain('## References');
      const links = doc.source.match(/\]\(https:\/\/(doi\.org|training\.cochrane\.org|www\.prisma-statement\.org)[^)]*\)/g) || [];
      expect(links.length, `${slug} has too few citations`).toBeGreaterThanOrEqual(4);
    }
  });

  it('cites the PRISMA 2020 statement DOI where PRISMA is discussed', () => {
    expect(DOCS['resources/prisma-2020-explained'].source).toContain('10.1136/bmj.n71');
  });
});

describe('internal linking (111.md §23)', () => {
  it('every navigation path is a registered public page', () => {
    const registered = new Set(PUBLIC_PAGES.map(e => e.path));
    for (const path of allNavPaths()) {
      expect(registered.has(path), `nav links to unregistered path ${path}`).toBe(true);
    }
  });

  it('every feature and resource page is reachable from the shared footer', () => {
    const linked = new Set([...FEATURE_LINKS, ...RESOURCE_LINKS, ...COMPANY_LINKS].map(l => l.path));
    for (const [slug] of PAGES) {
      if (slug === 'features' || slug === 'resources' || slug === 'about') continue;
      expect(linked.has(`/${slug}`), `/${slug} is orphaned`).toBe(true);
    }
  });

  it('the shared footer appears on every content page', () => {
    for (const [slug, Component] of PAGES) {
      const markup = html(Component, slug);
      for (const link of FEATURE_LINKS) expect(markup).toContain(`href="${link.path}"`);
      for (const link of RESOURCE_LINKS) expect(markup).toContain(`href="${link.path}"`);
    }
  });
});
