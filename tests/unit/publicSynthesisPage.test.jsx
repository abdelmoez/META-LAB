/**
 * publicSynthesisPage.test.jsx — 68.md (P8). SSR-safe smoke test for the PUBLIC
 * synthesis page (mirrors the repo house style — react-dom/server, no jsdom, so
 * effects never run during static render).
 *
 * Covered:
 *  - Given a `payload` prop (preview / embed mode), the page renders the title,
 *    the PRISMA counts, an interactive forest row per pooled outcome, and the
 *    included-studies table — all WITHOUT touching the network. A fetch that
 *    throws is stubbed to prove payload mode never calls it.
 *  - The public API builds the exact download / QR / embed URLs the backend serves.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PublicSynthesisPage from '../../src/features/publicSynthesis/PublicSynthesisPage.jsx';
import { publicUrls, embedSnippet } from '../../src/features/publicSynthesis/publicSynthesisApi.js';

// In payload mode NOTHING should hit the network. Make fetch throw so any accidental
// call fails loudly (and assert it was never invoked).
vi.stubGlobal('fetch', vi.fn(() => { throw new Error('fetch must not be called in payload mode'); }));

afterAll(() => {
  vi.unstubAllGlobals();
});

const PAYLOAD = {
  title: 'Effect of Drug X on Outcome Y: a systematic review',
  summary: 'A plain-language summary of the pooled evidence.',
  publishedFrom: 'PecanRev',
  version: 3,
  sections: { prisma: true, forest: true, studies: true, rob: true, methods: true, yearHistogram: true },
  pico: { question: 'Does Drug X reduce Outcome Y?', population: 'Adults', intervention: 'Drug X', comparator: 'Placebo', outcome: 'Outcome Y' },
  prisma: { identified: 1200, duplicatesRemoved: 200, screened: 1000, fullTextAssessed: 80, included: 12 },
  includedStudies: [
    { author: 'Smith', year: 2019, title: 'Trial A', journal: 'J Med', doi: '10.1/a' },
    { author: 'Jones', year: 2021, title: 'Trial B', journal: 'BMJ', doi: '10.1/b' },
  ],
  ma: [
    {
      outcome: 'Mortality', timepoint: '12mo', esType: 'OR', k: 2,
      es: -0.22, lo: -0.45, hi: 0.01, pval: 0.06, i2: 30, method: 'random',
      studies: [
        { label: 'Smith 2019', es: -0.3, lo: -0.6, hi: 0.0, weight: 55 },
        { label: 'Jones 2021', es: -0.1, lo: -0.5, hi: 0.3, weight: 45 },
      ],
    },
    {
      outcome: 'Response', timepoint: '', esType: 'MD', k: 2,
      es: 1.4, lo: 0.5, hi: 2.3, pval: 0.002, i2: 10, method: 'random',
      studies: [
        { label: 'Smith 2019', es: 1.6, lo: 0.4, hi: 2.8, weight: 50 },
        { label: 'Jones 2021', es: 1.2, lo: 0.2, hi: 2.2, weight: 50 },
      ],
    },
  ],
  rob: { total: 12, low: 7, some: 3, high: 2 },
  yearHistogram: [{ year: 2019, count: 5 }, { year: 2021, count: 7 }],
  dashboard: { cards: [] },
};

describe('PublicSynthesisPage (payload / preview mode, no network)', () => {
  const html = renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(PublicSynthesisPage, { payload: PAYLOAD })),
  );

  it('never calls fetch in payload mode', () => {
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders the public title and PecanRev branding + version', () => {
    expect(html).toContain('Effect of Drug X on Outcome Y');
    expect(html).toContain('PecanRev');
    expect(html).toContain('Version 3');
  });

  it('renders the PRISMA counts row', () => {
    expect(html).toContain('PRISMA flow');
    expect(html).toContain('1200');           // records identified
    expect(html).toContain('Studies included');
  });

  it('renders a forest plot per pooled outcome with per-study rows', () => {
    expect(html).toContain('Meta-analysis');
    expect(html).toContain('Mortality');
    expect(html).toContain('Response');
    // per-study labels appear in the SVG rows
    expect(html).toContain('Smith 2019');
    expect(html).toContain('Jones 2021');
    // pooled diamond label
    expect(html).toContain('Pooled');
    // honest log-scale note for the ratio (OR) outcome
    expect(html).toContain('analysis scale: log');
  });

  it('renders the included-studies table', () => {
    expect(html).toContain('Included studies (2)');
    expect(html).toContain('Smith');
    expect(html).toContain('Jones');
    expect(html).toContain('J Med');
  });

  it('renders the RoB distribution and the read-only snapshot footer', () => {
    expect(html).toContain('Risk of bias');
    expect(html).toContain('read-only published snapshot');
    expect(html).toContain('version 3');
  });
});

describe('publicSynthesis public URLs / embed snippet', () => {
  it('builds the export, QR and embed URLs the backend serves', () => {
    expect(publicUrls.exportJson('tok')).toBe('/api/public/synthesis/tok/export.json');
    expect(publicUrls.exportCsv('tok')).toBe('/api/public/synthesis/tok/export.csv');
    expect(publicUrls.qr('tok')).toBe('/api/public/synthesis/tok/qr.png');
    const snip = embedSnippet('tok');
    expect(snip).toContain('/embed/synthesis/tok');
    expect(snip).toContain('width="100%"');
    expect(snip).toContain('height="720"');
    expect(snip).toContain('loading="lazy"');
  });
});
