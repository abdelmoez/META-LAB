/**
 * commercialPages.test.js — 113 W1-A — the pages added for commercial intents.
 *
 * These pins protect three things the generic content tests cannot:
 *
 *  1. FAQ PARITY BY CONSTRUCTION. An entry carrying an `faq` array builds its
 *     FAQPage schema from that array AND the content document interpolates the
 *     same array through content/faqSection.js. Schema that does not match
 *     visible copy is a hard prohibition (111.md §17), so this asserts both
 *     halves against the one source rather than trusting the wiring.
 *  2. THE COMPARISON POLICY. Pages that describe another company's product are
 *     the easiest place in a marketing site to publish something untrue. The
 *     policy — dated verification line, no pricing, no ratings, link to the
 *     vendor's own site — is asserted here so it cannot quietly erode.
 *  3. SECTION ROUTING. /compare is a registry-gated prefix like /features; an
 *     ungated prefix would hand a 200 + <NotFound/> body to /compare/<anything>,
 *     which is the soft-404 the middleware exists to kill.
 */

import { describe, it, expect } from 'vitest';

import {
  PUBLIC_PAGES,
  KNOWN_SPA_PREFIXES,
  SITE_ORIGIN,
  getPublicPage,
  isKnownSpaPath,
  isServeableSpaPath,
} from '../../../src/frontend/website/publicPages.js';
import { DOCS } from '../../../src/frontend/website/content/index.js';
import { COMPARE_LINKS, FEATURE_LINKS, allNavPaths } from '../../../src/frontend/website/siteNav.js';

/** The nine paths this round added. */
const W1A_PATHS = [
  '/systematic-review-software',
  '/ai-systematic-review',
  '/features/risk-of-bias',
  '/features/prisma-flow-diagram',
  '/features/network-meta-analysis',
  '/features/case-series',
  '/compare',
  '/compare/pecanrev-vs-covidence',
  '/compare/pecanrev-vs-rayyan',
];

const COMPARE_PATHS = W1A_PATHS.filter(p => p.startsWith('/compare'));
const entryFor = p => PUBLIC_PAGES.find(e => e.path === p);
const docFor = p => DOCS[p.slice(1)];
const graphFor = (entry) => entry.jsonLd({ origin: SITE_ORIGIN, path: entry.path, entry })['@graph'];

describe('113 W1-A pages are registered and routable', () => {
  it('every path has a registry entry backed by a content document', () => {
    for (const path of W1A_PATHS) {
      expect(entryFor(path), `${path} is not in PUBLIC_PAGES`).toBeTruthy();
      expect(docFor(path), `${path} has no content document`).toBeTruthy();
      expect(entryFor(path).indexable).toBe(true);
      expect(entryFor(path).canonicalPath).toBe(path);
    }
  });

  it('the new top-level paths are known SPA routes, not 404s', () => {
    expect(isKnownSpaPath('/systematic-review-software')).toBe(true);
    expect(isKnownSpaPath('/ai-systematic-review')).toBe(true);
    expect(isServeableSpaPath('/systematic-review-software')).toBe(true);
    expect(isServeableSpaPath('/ai-systematic-review')).toBe(true);
  });

  it('/compare is a registry-gated prefix, so unknown children stay 404s', () => {
    const rule = KNOWN_SPA_PREFIXES.find(r => r.pattern === '/compare');
    expect(rule, '/compare must be a KNOWN_SPA_PREFIXES rule').toBeTruthy();
    expect(rule.kind).toBe('prefix');
    expect(rule.registryGated).toBe(true);
    for (const p of COMPARE_PATHS) expect(isServeableSpaPath(p), `${p} must be served`).toBe(true);
    for (const p of ['/compare/bogus', '/compare/pecanrev-vs-covidence/x']) {
      expect(isKnownSpaPath(p), `${p} is still route-covered`).toBe(true);
      expect(isServeableSpaPath(p), `${p} must not be served a 200`).toBe(false);
    }
  });

  it('every new page is reachable from the site navigation', () => {
    const nav = new Set(allNavPaths());
    for (const path of W1A_PATHS) {
      expect(nav.has(path), `${path} is orphaned from siteNav.js`).toBe(true);
    }
    // The comparison section is its own group, and the flagship page leads Product.
    expect(COMPARE_LINKS.map(l => l.path)).toEqual(COMPARE_PATHS);
    expect(FEATURE_LINKS[0].path).toBe('/systematic-review-software');
  });
});

describe('FAQ schema and visible copy come from one array', () => {
  const faqEntries = PUBLIC_PAGES.filter(e => Array.isArray(e.faq) && W1A_PATHS.includes(e.path));

  it('the pages that should carry an FAQ do', () => {
    expect(faqEntries.map(e => e.path).sort())
      .toEqual(['/ai-systematic-review', '/systematic-review-software']);
  });

  it('each FAQ is a set of unique, genuine questions with substantive answers', () => {
    for (const entry of faqEntries) {
      expect(entry.faq.length, `${entry.path} FAQ too short`).toBeGreaterThanOrEqual(5);
      const questions = entry.faq.map(f => f.question);
      expect(new Set(questions).size, `${entry.path} has duplicate questions`).toBe(questions.length);
      for (const item of entry.faq) {
        expect(item.question.endsWith('?'), `not a question: ${item.question}`).toBe(true);
        expect(item.answer.length, `answer too thin: ${item.question}`).toBeGreaterThan(120);
      }
    }
  });

  it('the FAQPage schema is exactly the array, in order', () => {
    for (const entry of faqEntries) {
      const faq = graphFor(entry).find(n => n['@type'] === 'FAQPage');
      expect(faq, `${entry.path} has no FAQPage node`).toBeTruthy();
      expect(faq.mainEntity.map(q => q.name)).toEqual(entry.faq.map(f => f.question));
      expect(faq.mainEntity.map(q => q.acceptedAnswer.text)).toEqual(entry.faq.map(f => f.answer));
    }
  });

  it('every question and answer is visible in the page body', () => {
    // The content document interpolates faqMarkdown(path); if someone hardcodes
    // the copy instead, or edits one side only, this fails.
    for (const entry of faqEntries) {
      const source = docFor(entry.path).source;
      expect(source, `${entry.path} does not render its FAQ`).toContain('## Frequently asked questions');
      for (const item of entry.faq) {
        expect(source, `${entry.path}: question missing from the page`).toContain(`### ${item.question}`);
        expect(source, `${entry.path}: answer missing from the page`).toContain(item.answer);
      }
    }
  });

  it('the flagship page also declares the SoftwareApplication entity', () => {
    const types = graphFor(entryFor('/systematic-review-software')).map(n => n['@type']);
    expect(types).toContain('WebPage');
    expect(types).toContain('SoftwareApplication');
    expect(types).toContain('FAQPage');
    expect(types).toContain('BreadcrumbList');
  });
});

describe('comparison-page policy', () => {
  it('every comparison page carries a dated verification line', () => {
    for (const path of COMPARE_PATHS) {
      expect(docFor(path).source, `${path} has no verification date`)
        .toContain('Information verified as of August 2026');
    }
  });

  it('no comparison page makes a pricing claim about anyone', () => {
    // The product has no public price list, and a competitor's pricing is exactly
    // the kind of fact that is stale the week after it is written.
    for (const path of COMPARE_PATHS) {
      const source = docFor(path).source;
      expect(source, `${path} quotes a currency amount`).not.toMatch(/[$£€]\s?\d/);
      expect(source, `${path} quotes a rate`).not.toMatch(/\bper (month|year|seat|user|licence|license)\b/i);
      expect(source, `${path} names a pricing tier`).not.toMatch(/\b(free|paid|premium|enterprise) (tier|plan)\b/i);
      expect(source, `${path} quotes an amount`).not.toMatch(/\b\d+(\.\d+)?\s?(USD|EUR|GBP)\b/);
    }
  });

  it('no comparison page fabricates a rating or a superlative verdict', () => {
    for (const path of COMPARE_PATHS) {
      const source = docFor(path).source;
      expect(source, `${path} quotes a score`).not.toMatch(/\b\d(\.\d)?\s*(\/|out of)\s*(5|10)\b/);
      expect(source, `${path} declares a winner`).not.toMatch(/\bthe best (tool|platform|software)\b/i);
      const json = JSON.stringify(entryFor(path).jsonLd({ origin: SITE_ORIGIN, path, entry: entryFor(path) }));
      expect(json).not.toMatch(/aggregateRating|ratingValue|reviewCount/i);
    }
  });

  it('each head-to-head page links to the other product own public site', () => {
    expect(docFor('/compare/pecanrev-vs-covidence').source).toContain('https://www.covidence.org');
    expect(docFor('/compare/pecanrev-vs-rayyan').source).toContain('https://www.rayyan.ai');
    // Rayyan is described in a peer-reviewed paper; cite it rather than paraphrase.
    expect(docFor('/compare/pecanrev-vs-rayyan').source).toContain('10.1186/s13643-016-0384-5');
  });

  it('the section index states the policy the pages follow', () => {
    const index = docFor('/compare').source;
    expect(index).toContain('## How we write these comparisons');
    for (const path of COMPARE_PATHS.filter(p => p !== '/compare')) {
      expect(index, `${path} is not listed on the section index`).toContain(`(${path})`);
    }
  });
});

describe('113 W1-A content shape', () => {
  it('no document uses a markdown table (the renderer has none)', () => {
    for (const path of W1A_PATHS) {
      const body = docFor(path).source.replace(/^---[\s\S]*?---/, '');
      expect(body, `${path} contains a pipe character — a table would render as text`)
        .not.toMatch(/\|/);
    }
  });

  it('every document declares an explicit h1 in its frontmatter', () => {
    for (const path of W1A_PATHS) {
      expect(docFor(path).frontmatter.h1, `${path} has no h1`).toBeTruthy();
    }
  });

  it('the honest-scoping pages say what is NOT automated or NOT implemented', () => {
    // The AI page and the feature pages exist to scope claims, not to inflate
    // them; losing these sections would be a silent change of policy.
    expect(docFor('/ai-systematic-review').source).toContain('## What PecanRev does not automate');
    expect(docFor('/systematic-review-software').source).toContain('## What does PecanRev not do?');
    for (const path of ['/features/risk-of-bias', '/features/prisma-flow-diagram',
      '/features/network-meta-analysis', '/features/case-series']) {
      expect(docFor(path).source, `${path} has no limitations section`)
        .toContain('## What this does not do');
    }
  });

  it('the AI page scopes the model claims rather than advertising them', () => {
    const source = docFor('/ai-systematic-review').source;
    expect(source).toContain('deterministic lexical model');
    expect(source).toContain('cannot record a screening decision');
    expect(source).toContain('Text recognition is not AI');
  });

  it('/systematic-review-software is the flagship page and outranks the feature pages', () => {
    const flagship = getPublicPage('/systematic-review-software');
    expect(flagship.priority).toBeGreaterThan(getPublicPage('/features').priority);
    expect(flagship.priority).toBeLessThan(getPublicPage('/').priority);
  });
});
