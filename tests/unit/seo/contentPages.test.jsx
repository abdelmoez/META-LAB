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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { DOCS, validateDocs, REQUIRED_FRONTMATTER } from '../../../src/frontend/website/content/index.js';
import { PUBLIC_PAGES, getPublicPage, resolveRelated } from '../../../src/frontend/website/publicPages.js';
import { FEATURE_LINKS, RESOURCE_LINKS, COMPARE_LINKS, COMPANY_LINKS, allNavPaths } from '../../../src/frontend/website/siteNav.js';

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
// 113 W1-A — commercial, feature and comparison pages.
import { SystematicReviewSoftwarePage } from '../../../src/frontend/website/pages/SystematicReviewSoftwarePage.jsx';
import { AiSystematicReviewPage } from '../../../src/frontend/website/pages/AiSystematicReviewPage.jsx';
import { RiskOfBiasPage } from '../../../src/frontend/website/pages/RiskOfBiasPage.jsx';
import { PrismaFlowDiagramPage } from '../../../src/frontend/website/pages/PrismaFlowDiagramPage.jsx';
import { NetworkMetaAnalysisPage } from '../../../src/frontend/website/pages/NetworkMetaAnalysisPage.jsx';
import { CaseSeriesPage } from '../../../src/frontend/website/pages/CaseSeriesPage.jsx';
import { CompareIndexPage } from '../../../src/frontend/website/pages/CompareIndexPage.jsx';
import { CompareCovidencePage } from '../../../src/frontend/website/pages/CompareCovidencePage.jsx';
import { CompareRayyanPage } from '../../../src/frontend/website/pages/CompareRayyanPage.jsx';
// 113 W1-B — the eight methodology guides.
import { ConductSystematicReviewPage } from '../../../src/frontend/website/pages/ConductSystematicReviewPage.jsx';
import { SearchStrategyGuidePage } from '../../../src/frontend/website/pages/SearchStrategyGuidePage.jsx';
import { DataExtractionGuidePage } from '../../../src/frontend/website/pages/DataExtractionGuidePage.jsx';
import { RiskOfBiasGuidePage } from '../../../src/frontend/website/pages/RiskOfBiasGuidePage.jsx';
import { ForestPlotsGuidePage } from '../../../src/frontend/website/pages/ForestPlotsGuidePage.jsx';
import { PublicationBiasGuidePage } from '../../../src/frontend/website/pages/PublicationBiasGuidePage.jsx';
import { NetworkMetaAnalysisGuidePage } from '../../../src/frontend/website/pages/NetworkMetaAnalysisGuidePage.jsx';
import { PrismaFlowDiagramGuidePage } from '../../../src/frontend/website/pages/PrismaFlowDiagramGuidePage.jsx';

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
  // 113 W1-A
  ['systematic-review-software', SystematicReviewSoftwarePage],
  ['ai-systematic-review', AiSystematicReviewPage],
  ['features/risk-of-bias', RiskOfBiasPage],
  ['features/prisma-flow-diagram', PrismaFlowDiagramPage],
  ['features/network-meta-analysis', NetworkMetaAnalysisPage],
  ['features/case-series', CaseSeriesPage],
  ['compare', CompareIndexPage],
  ['compare/pecanrev-vs-covidence', CompareCovidencePage],
  ['compare/pecanrev-vs-rayyan', CompareRayyanPage],
  // 113 W1-B
  ['resources/how-to-conduct-a-systematic-review', ConductSystematicReviewPage],
  ['resources/systematic-review-search-strategy', SearchStrategyGuidePage],
  ['resources/data-extraction-for-systematic-reviews', DataExtractionGuidePage],
  ['resources/risk-of-bias-assessment', RiskOfBiasGuidePage],
  ['resources/forest-plots-and-heterogeneity', ForestPlotsGuidePage],
  ['resources/publication-bias', PublicationBiasGuidePage],
  ['resources/network-meta-analysis-explained', NetworkMetaAnalysisGuidePage],
  ['resources/prisma-flow-diagram-guide', PrismaFlowDiagramGuidePage],
];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

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
  // 113 W1-B — DERIVED, not a hand-maintained list. Every markdown document under
  // /resources/ is a methodology guide and must carry real citations; deriving the
  // set means a new guide cannot be added without meeting the bar.
  const GUIDES = Object.keys(DOCS).filter(slug => slug.startsWith('resources/'));

  it('covers every published methodology guide', () => {
    expect(GUIDES.length).toBeGreaterThanOrEqual(12);
    expect(GUIDES).toContain('resources/what-is-a-systematic-review');
    expect(GUIDES).toContain('resources/prisma-flow-diagram-guide');
  });

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
    const linked = new Set(
      [...FEATURE_LINKS, ...RESOURCE_LINKS, ...COMPARE_LINKS, ...COMPANY_LINKS].map(l => l.path),
    );
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
      for (const link of COMPARE_LINKS) expect(markup).toContain(`href="${link.path}"`);
    }
  });
});

/**
 * 113 §5 — the related-links block is GENERATED from the registry.
 *
 * Page components used to hand-roll their own `RELATED` array, so the rendered links
 * and the internal-link graph were two lists maintained by hand and free to drift —
 * and the orphan test could only ever check the one it could see. ArticlePage now
 * calls resolveRelated() on the registry entry, and the component supplies only the
 * per-link note. These assertions are what makes "the graph IS the page" a fact
 * rather than an intention.
 */
describe('related links are the registry graph (113 §5)', () => {
  /** The RelatedLinks <aside> is the only <aside> a content page renders. */
  const relatedAside = (markup) => {
    const start = markup.indexOf('<aside');
    if (start === -1) return null;
    const end = markup.indexOf('</aside>', start);
    return end === -1 ? null : markup.slice(start, end);
  };
  const hrefsIn = (fragment) =>
    [...fragment.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

  for (const [slug, Component] of PAGES) {
    it(`/${slug} renders exactly its registry related list, in order`, () => {
      const entry = getPublicPage(`/${slug}`);
      expect(entry, `/${slug} must be a registry page`).toBeTruthy();
      expect(Array.isArray(entry.related), `/${slug} must declare related[]`).toBe(true);

      const aside = relatedAside(html(Component, slug));
      expect(aside, `/${slug} renders no related block`).toBeTruthy();
      expect(hrefsIn(aside)).toEqual(entry.related);
    });
  }

  it('every rendered related link carries a visible label and an editorial note', () => {
    for (const [slug, Component] of PAGES) {
      const aside = relatedAside(html(Component, slug));
      for (const link of resolveRelated(`/${slug}`)) {
        // React escapes text nodes, so "Title & abstract screening" ships as
        // "Title &amp; abstract screening".
        const label = link.label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        expect(aside, `/${slug} → ${link.path} has no label`).toContain(`>${label}</a>`);
      }
      // A bare list of page names is a menu; the note is what makes it a
      // recommendation. Missing notes are a content gap, so fail on them.
      // RelatedLinks prefixes each note with an em dash (JSX `&mdash;`, which
      // renderToStaticMarkup emits as the literal character, not the entity).
      const notes = (aside.match(/—/g) || []).length;
      expect(notes, `/${slug} related links are missing notes`)
        .toBe(getPublicPage(`/${slug}`).related.length);
    }
  });

  it('no page component hand-rolls a related list any more', () => {
    // The prop and the const are both gone; a reintroduced `related={…}` would
    // silently take precedence over the registry and reopen the drift.
    const dir = path.join(repoRoot, 'src/frontend/website/pages');
    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      expect(source, `${file} still declares a local RELATED array`)
        .not.toMatch(/const RELATED\s*=/);
      expect(source, `${file} still passes a related= prop`).not.toMatch(/\brelated=\{/);
    }
  });
});
