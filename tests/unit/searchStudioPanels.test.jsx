/**
 * searchStudioPanels.test.jsx — P11. The guided Strategy Studio + recall-check panels
 * (StrategyStudioPanel, RecallReportPanel) and the PRISMA-S export leaf.
 *
 * SSR-safe, mirroring the house pattern (searchWizardPanels): the top-level panels load
 * in effects that never run under renderToStaticMarkup, so we test the pure leaves from
 * props and stub `fetch` (vi.stubGlobal / unstubAllGlobals) for the soft API helpers.
 * Wording rule (P11): the UI never says "AI" — a guard test asserts that.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StrategyCard, IterationTimeline } from '../../src/features/searchWizard/StrategyStudioPanel.jsx';
import { SeedList, RecallSummary } from '../../src/features/searchWizard/RecallReportPanel.jsx';
import { PrismaSExport } from '../../src/features/searchWizard/SearchExportPanel.jsx';
import { strategyStudioApi } from '../../src/features/searchWizard/strategyStudioApi.js';

afterEach(() => { vi.unstubAllGlobals(); });

const STRATEGY = {
  database: 'PubMed',
  profile: 'balanced',
  searchString: '("type 2 diabetes"[tiab] OR "T2DM"[tiab]) AND metformin[tiab]',
  blocks: [
    { concept: 'Type 2 diabetes', picoField: 'P', mesh: ['Diabetes Mellitus, Type 2'], freeText: ['type 2 diabetes', 'T2DM'], fieldTags: ['[tiab]'], explanation: 'Population concept with synonyms.' },
    { concept: 'Metformin', picoField: 'I', mesh: [], freeText: ['metformin'], fieldTags: ['[tiab]'], explanation: 'Single-term intervention.' },
  ],
  filters: { dateFrom: '2015' },
  warnings: [{ type: 'thin', message: 'Intervention has only one term.', term: 'metformin' }],
};

describe('StrategyCard leaf', () => {
  it('renders readable concept blocks, MeSH separated from free-text, warnings, and a Boolean expander', () => {
    const html = renderToStaticMarkup(h(StrategyCard, { strategy: STRATEGY }));
    expect(html).toContain('PubMed');
    expect(html).toContain('Balanced');
    // Blocks: PICO label + concept name + separated vocabularies.
    expect(html).toContain('Type 2 diabetes');
    expect(html).toContain('Population');
    expect(html).toContain('Controlled vocab (MeSH)');
    expect(html).toContain('Diabetes Mellitus, Type 2');
    expect(html).toContain('Free-text terms');
    // Warning surfaced calmly with its term.
    expect(html).toContain('Intervention has only one term');
    expect(html).toContain('metformin');
    // Raw Boolean string is present (inside the <details> expander).
    expect(html).toContain('Show Boolean query');
    expect(html).toContain('[tiab]');
    // Wording rule: no "AI" anywhere.
    expect(html).not.toMatch(/\bAI\b/);
  });

  it('renders a calm note when a candidate has no blocks', () => {
    const html = renderToStaticMarkup(h(StrategyCard, { strategy: { database: 'Embase', blocks: [] } }));
    expect(html).toContain('No concept blocks');
  });
});

describe('IterationTimeline leaf', () => {
  const iterations = [
    { iteration: 1, database: 'PubMed', searchString: 'metformin', hitCount: 128000, hitKind: 'estimate', critic: { issues: [{ severity: 'warning', message: 'Too broad — add the population block.', suggestion: 'AND the diabetes concept.' }], score: 62 }, changes: 'Initial draft.' },
    { iteration: 2, database: 'PubMed', searchString: '(diabetes) AND metformin', hitCount: 1240, hitKind: 'exact', critic: { issues: [], score: 88 }, changes: 'Added the population block.' },
  ];

  it('renders a timeline with hit counts, what changed, and critic notes on demand', () => {
    const html = renderToStaticMarkup(h(IterationTimeline, { iterations }));
    expect(html).toContain('Iteration 1');
    expect(html).toContain('Iteration 2');
    // Hit counts (estimate marker + formatted number).
    expect(html).toContain('128,000');
    expect(html).toContain('1,240');
    // What changed + critic notes.
    expect(html).toContain('Added the population block');
    expect(html).toContain('Critic notes');
    expect(html).toContain('Too broad');
    expect(html).toContain('AND the diabetes concept');
    expect(html).not.toMatch(/\bAI\b/);
  });

  it('renders an empty prompt when there are no iterations', () => {
    const html = renderToStaticMarkup(h(IterationTimeline, { iterations: [] }));
    expect(html).toContain('Optimize');
  });
});

describe('SeedList leaf', () => {
  const seeds = [
    { id: 's1', title: 'Metformin in T2DM: an RCT', doi: '10.1/abc', pmid: '12345', source: 'manual' },
    { id: 's2', title: 'A second known study', pmid: '67890', source: 'manual' },
  ];

  it('lists seed studies with identifiers and a remove control for writers', () => {
    const html = renderToStaticMarkup(h(SeedList, { seeds, readOnly: false }));
    expect(html).toContain('Metformin in T2DM');
    expect(html).toContain('DOI 10.1/abc');
    expect(html).toContain('PMID 12345');
    expect(html).toContain('Remove');
  });

  it('hides the remove control for read-only users', () => {
    const html = renderToStaticMarkup(h(SeedList, { seeds, readOnly: true }));
    expect(html).toContain('A second known study');
    expect(html).not.toContain('Remove');
  });

  it('shows an empty hint when there are no seeds', () => {
    const html = renderToStaticMarkup(h(SeedList, { seeds: [], readOnly: false }));
    expect(html).toContain('No seed studies yet');
  });
});

describe('RecallSummary leaf', () => {
  const report = {
    seedTotal: 5, foundCount: 4,
    found: [{ title: 'Found study A' }],
    notFound: [{ title: 'Missing study Z' }],
    estimatedRecall: 0.8,
    missingAnalysis: [{ seed: { title: 'Missing study Z' }, likelyReason: 'Not indexed with the intervention term.' }],
    suggestions: [{ suggestion: 'Add "glucophage" as a synonym.', rationale: 'The missing study uses the brand name.' }],
  };

  it('renders a summary-first recall report with found/not-found and suggestions', () => {
    const html = renderToStaticMarkup(h(RecallSummary, { report }));
    expect(html).toContain('Found 4 of 5 seed studies');
    expect(html).toContain('estimated recall 80%');
    expect(html).toContain('Found study A');
    expect(html).toContain('Missing study Z');
    expect(html).toContain('Not indexed with the intervention term');
    expect(html).toContain('Suggested improvements');
    expect(html).toContain('glucophage'); // suggestion text (quotes are HTML-escaped in SSR markup)
    expect(html).toContain('The missing study uses the brand name');
    expect(html).not.toMatch(/\bAI\b/);
  });

  it('is defensive with an empty report', () => {
    const html = renderToStaticMarkup(h(RecallSummary, { report: {} }));
    expect(html).toContain('Found 0 of 0 seed studies');
  });
});

describe('PrismaSExport leaf', () => {
  it('renders json/csv/html download links pointing at the strategy prisma-s route', () => {
    const html = renderToStaticMarkup(h(PrismaSExport, { projectId: 'p1' }));
    expect(html).toContain('PRISMA-S');
    expect(html).toContain('Download JSON');
    expect(html).toContain('Download CSV');
    expect(html).toContain('Download HTML');
    expect(html).toContain('/strategy/prisma-s?format=json');
    expect(html).toContain('/strategy/prisma-s?format=csv');
  });
});

describe('strategyStudioApi — soft reads + actions (fetch stubbed)', () => {
  it('iterations() returns a quiet unavailable shape on a 404 (flag off) instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null), text: () => Promise.resolve('') })));
    const out = await strategyStudioApi.iterations('p1');
    expect(out.available).toBe(false);
    expect(out.iterations).toEqual([]);
  });

  it('listSeeds() parses an array payload when the backend answers', async () => {
    const seeds = [{ id: 's1', title: 'A' }];
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(seeds)) })));
    const out = await strategyStudioApi.listSeeds('p1');
    expect(out.available).toBe(true);
    expect(out.seeds).toHaveLength(1);
  });

  it('generate() THROWS on failure (a real user action)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }), text: () => Promise.resolve('') })));
    await expect(strategyStudioApi.generate('p1', {})).rejects.toThrow();
  });

  it('prismaSUrl() builds a safe, format-clamped download URL', () => {
    expect(strategyStudioApi.prismaSUrl('p1', 'csv')).toBe('/api/search-builder/projects/p1/strategy/prisma-s?format=csv');
    // Unknown format falls back to json.
    expect(strategyStudioApi.prismaSUrl('p1', 'xml')).toContain('format=json');
  });
});
