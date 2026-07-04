/**
 * searchBuilderPhases.test.jsx — 73.md P4/P6. The Search Builder's embedded-phase
 * matrix (the 3-way 'concepts' | 'terms' | 'build' split, with the legacy 'define'
 * alias kept byte-identical for the old SearchWizard) and the per-database strategy
 * workspace (DbStrategyPanel driven by the compiler result contract + the all-
 * strategies .txt export). SSR-safe house pattern: pure helpers + presentational
 * components rendered with renderToStaticMarkup; the real compiler is exercised for
 * a non-native database (scopus) so the panel can't drift from the engine.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  embeddedShowsStep, DbStrategyPanel, allStrategiesExportText,
} from '../../src/features/searchBuilder/index.js';
import { compileStrategy } from '../../src/research-engine/searchBuilder/compilers/index.js';
import { capabilitiesFor } from '../../src/research-engine/searchBuilder/compilers/capabilities.js';

describe('embeddedShowsStep — the 3-way embedded phase matrix (P4)', () => {
  const matrix = (phase) => [1, 2, 3, 4, 5].filter((n) => embeddedShowsStep(phase, n));

  it("legacy 'define' stays the combined concepts+terms alias (old SearchWizard unchanged)", () => {
    expect(matrix('define')).toEqual([1, 2]);
  });
  it("'concepts' shows ONLY step 1 (Select Keywords + the compact summary)", () => {
    expect(matrix('concepts')).toEqual([1]);
  });
  it("'terms' shows ONLY step 2 (full concept/term detail + limits)", () => {
    expect(matrix('terms')).toEqual([2]);
  });
  it("'build' shows steps 3+4 (databases + strategy workspace)", () => {
    expect(matrix('build')).toEqual([3, 4]);
  });
  it('concepts and terms are DISTINCT (the old no-op stage bug cannot recur)', () => {
    expect(matrix('concepts')).not.toEqual(matrix('terms'));
  });
  it('returns null for a non-embedded phase (standalone keeps its own stepper)', () => {
    expect(embeddedShowsStep(undefined, 1)).toBeNull();
    expect(embeddedShowsStep('', 2)).toBeNull();
    expect(embeddedShowsStep('bogus', 3)).toBeNull();
  });
});

/* A small strategy the real compiler can chew on. */
const STRATEGY = {
  concepts: [
    { id: 'p', label: 'Population', op: 'AND', terms: [{ text: 'type 2 diabetes', type: 'freetext', field: 'tiab' }, { text: 'T2DM', type: 'freetext', field: 'tiab' }] },
    { id: 'i', label: 'Intervention', op: 'AND', terms: [{ text: 'metformin', type: 'freetext', field: 'tiab' }] },
  ],
  filters: { dateFrom: '', dateTo: '', languages: [], pubTypes: [] },
  overrides: {},
};

describe('DbStrategyPanel — the per-database strategy workspace panel (P6)', () => {
  it('renders a REAL compiled scopus strategy: query + syntax badge + Copy + Open', () => {
    const res = compileStrategy(STRATEGY, 'scopus');
    expect(res.query).toBeTruthy(); // the compiler covers non-native databases now
    const html = renderToStaticMarkup(
      h(DbStrategyPanel, { res, cap: capabilitiesFor('scopus'), setOverride: () => {}, hitState: null }),
    );
    expect(html).toContain('sb-db-strategy-scopus');
    expect(html).toContain('Scopus');
    // The compiled query lands in the monospace block (SSR escapes quotes)
    expect(html).toContain(res.query.slice(0, 20).replace(/"/g, '&quot;'));
    expect(html).toContain('Copy');
    expect(html).toContain('Open Scopus');
    expect(html).toContain('rel="noopener noreferrer"');
    // scopus has no prefilled-search URL → paste guidance caption
    expect(html).toContain('paste your copied strategy');
    expect(html).toContain('in sync');
  });

  it('renders warnings (amber), unsupported chips (with detail) and the vocab status line', () => {
    const res = {
      dbId: 'wos', label: 'Web of Science', query: 'TS=("x" OR "y")',
      warnings: [{ code: 'W1', message: 'Subject headings were searched as topic text.' }],
      notes: ['Paste into the Advanced Search.'],
      unsupported: [{ feature: 'explosion', detail: 'No thesaurus in Web of Science.' }],
      vocab: { system: 'mesh', mapped: 3, unmapped: 1, approximate: true },
      syntaxLevel: 'native', filtersApplied: false,
    };
    const html = renderToStaticMarkup(
      h(DbStrategyPanel, { res, cap: capabilitiesFor('wos'), setOverride: () => {}, hitState: null }),
    );
    expect(html).toContain('Subject headings were searched as topic text.');
    expect(html).toContain('not supported: explosion');
    expect(html).toContain('No thesaurus in Web of Science.');
    expect(html).toContain('Subject headings (mesh): 3 mapped, 1 unmapped (approximate)');
    expect(html).toContain('Paste into the Advanced Search.');
  });

  it('an overridden result shows ✎ EDITED + the not-synced note + Revert (never silent)', () => {
    const res = compileStrategy({ ...STRATEGY, overrides: { scopus: 'TITLE-ABS-KEY(custom)' } }, 'scopus');
    expect(res.overridden).toBe(true);
    const html = renderToStaticMarkup(
      h(DbStrategyPanel, { res, cap: capabilitiesFor('scopus'), setOverride: () => {}, hitState: null }),
    );
    expect(html).toContain('✎ EDITED');
    expect(html).toContain('not synced to concept changes');
    expect(html).toContain('Revert');
    expect(html).toContain('TITLE-ABS-KEY(custom)');
    expect(html).not.toContain('in sync');
  });

  it('pubmed keeps the LIVE badge + the hit-count wiring', () => {
    const res = compileStrategy(STRATEGY, 'pubmed');
    const html = renderToStaticMarkup(
      h(DbStrategyPanel, {
        res, cap: capabilitiesFor('pubmed'), setOverride: () => {},
        hitState: { status: 'updated', hitCount: 1234, strategyHash: 'x', lastUpdatedAt: Date.now() - 60000, errorMessage: null },
      }),
    );
    expect(html).toContain('LIVE');
    expect(html).toContain('hits');
    expect(html).toContain('1.2k');
    // pubmed HAS a prefilled-search URL template
    expect(html).toContain('pubmed.ncbi.nlm.nih.gov');
  });

  it('an approximate database is labelled approximate (tooltip carries the meaning)', () => {
    const res = compileStrategy(STRATEGY, 'gscholar');
    expect(res.syntaxLevel).toBe('approximate');
    const html = renderToStaticMarkup(
      h(DbStrategyPanel, { res, cap: capabilitiesFor('gscholar'), setOverride: () => {}, hitState: null }),
    );
    expect(html).toContain('approximate');
  });

  it('with no terms yet, invites instead of rendering an empty query block', () => {
    const res = compileStrategy({ concepts: [], filters: {}, overrides: {} }, 'scopus');
    const html = renderToStaticMarkup(
      h(DbStrategyPanel, { res, cap: capabilitiesFor('scopus'), setOverride: () => {}, hitState: null }),
    );
    expect(html).toContain('Add terms to see the Scopus strategy');
  });
});

describe('allStrategiesExportText — the one-file .txt export (P6)', () => {
  it('concatenates label + syntax level + query + warnings + unsupported per database', () => {
    const txt = allStrategiesExportText([
      { label: 'PubMed / MEDLINE', syntaxLevel: 'native', query: 'a[tiab] AND b[tiab]', warnings: [], unsupported: [] },
      {
        label: 'Google Scholar', syntaxLevel: 'approximate', query: '"a" "b"', overridden: true,
        warnings: [{ code: 'LEN', message: 'Keep it under 256 characters.' }],
        unsupported: [{ feature: 'truncation', detail: 'auto-stemming only' }],
      },
    ]);
    expect(txt).toContain('### PubMed / MEDLINE (native)');
    expect(txt).toContain('a[tiab] AND b[tiab]');
    expect(txt).toContain('### Google Scholar (approximate, manually edited)');
    expect(txt).toContain('! Keep it under 256 characters.');
    expect(txt).toContain('- not supported: truncation — auto-stemming only');
  });
  it('tolerates an empty query and junk input', () => {
    expect(allStrategiesExportText([{ label: 'X', syntaxLevel: 'native', query: '' }])).toContain('(no terms)');
    expect(allStrategiesExportText(null)).toBe('');
  });
});
