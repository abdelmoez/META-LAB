/**
 * searchMethodsText.test.js — 69.md §8. Pure manuscript-ready "Search strategy"
 * paragraph builder. The load-bearing property: HONEST, never fabricated — absent
 * facts become explicit bracketed placeholders, and counts appear only when real
 * run data is supplied.
 */
import { describe, it, expect } from 'vitest';
import { buildSearchMethodsText } from '../../src/research-engine/searchBuilder/methodsText.js';

const concept = (label, terms) => ({
  label, op: 'AND', terms: terms.map((t) => ({ text: t, field: 'tiab' })),
});

describe('buildSearchMethodsText — empty strategy', () => {
  it('emits honest placeholders and NO fabricated counts', () => {
    const text = buildSearchMethodsText({ strategy: {} });
    expect(text).toContain('[insert databases]');
    expect(text).toContain('[insert search date]');
    expect(text).toContain('[insert search strategy');
    // never invents numbers
    expect(text).not.toMatch(/n = \d/);
    expect(text).not.toMatch(/total of \d/);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('tolerates undefined input entirely', () => {
    const text = buildSearchMethodsText();
    expect(text).toContain('[insert databases]');
    expect(text).toContain('[insert search date]');
  });
});

describe('buildSearchMethodsText — databases', () => {
  it('names known databases and still requires a search date placeholder', () => {
    const text = buildSearchMethodsText({
      strategy: { databases: ['pubmed', 'embase', 'cochrane'], concepts: [concept('Population', ['diabetes'])] },
    });
    expect(text).toContain('We searched PubMed, Embase, and the Cochrane Central Register of Controlled Trials (CENTRAL)');
    expect(text).toContain('[insert search date]');
  });

  it('falls back to the raw id for an unknown database (never drops it silently)', () => {
    const text = buildSearchMethodsText({ strategy: { databases: ['some_new_db'], concepts: [] } });
    expect(text).toContain('some_new_db');
  });
});

describe('buildSearchMethodsText — concept structure', () => {
  it('describes a single concept with OR synonyms', () => {
    const text = buildSearchMethodsText({ strategy: { concepts: [concept('Population', ['diabetes', 'T2DM'])] } });
    expect(text).toContain('single concept');
    expect(text).toContain('OR operator');
  });

  it('describes N concepts combined with AND, naming them when all are labelled', () => {
    const text = buildSearchMethodsText({
      strategy: { concepts: [concept('Population', ['diabetes']), concept('Intervention', ['SGLT2']), concept('Outcome', ['mortality'])] },
    });
    expect(text).toContain('combined 3 concepts');
    expect(text).toContain('Population, Intervention, and Outcome');
    expect(text).toContain('AND operator');
    expect(text).toContain('OR operator');
  });

  it('drops concepts with no usable terms from the count', () => {
    const text = buildSearchMethodsText({
      strategy: { concepts: [concept('Population', ['diabetes']), concept('Empty', []), concept('Outcome', ['mortality'])] },
    });
    expect(text).toContain('combined 2 concepts');
  });
});

describe('buildSearchMethodsText — filters / limits', () => {
  it('renders a date range, languages, and publication types when present', () => {
    const text = buildSearchMethodsText({
      strategy: {
        concepts: [concept('Population', ['diabetes'])],
        filters: { dateFrom: '2010', dateTo: '2025', languages: ['en', 'es'], pubTypes: ['Randomized Controlled Trial'] },
      },
    });
    expect(text).toContain('publication dates from 2010 to 2025');
    expect(text).toContain('English and Spanish');
    expect(text).toContain('Randomized Controlled Trial');
  });

  it('handles an open-ended (from-only) date range', () => {
    const text = buildSearchMethodsText({ strategy: { concepts: [], filters: { dateFrom: '2015' } } });
    expect(text).toContain('from 2015 onwards');
  });

  it('omits the limits sentence entirely when no filters are set', () => {
    const text = buildSearchMethodsText({ strategy: { concepts: [concept('P', ['x'])] } });
    expect(text).not.toContain('Results were limited to');
  });
});

describe('buildSearchMethodsText — run counts (only when real data supplied)', () => {
  it('states per-run counts and a total when counts are present', () => {
    const text = buildSearchMethodsText({
      strategy: { concepts: [concept('P', ['x'])], databases: ['pubmed'] },
      runs: [{ provider: 'pubmed', date: '2026-01-01', count: 120 }, { provider: 'embase', date: '2026-01-01', count: 80 }],
    });
    expect(text).toContain('PubMed (n = 120)');
    expect(text).toContain('Embase (n = 80)');
    expect(text).toContain('total of 200 records');
  });

  it('uses a placeholder for a run whose count is missing — never invents one', () => {
    const text = buildSearchMethodsText({
      strategy: { concepts: [] },
      runs: [{ provider: 'pubmed', date: '2026-01-01', count: null }],
    });
    expect(text).toContain('PubMed ([insert count])');
    expect(text).not.toMatch(/n = /);
    expect(text).not.toMatch(/total of/);
  });

  it('does not mention any counts when no runs are supplied', () => {
    const text = buildSearchMethodsText({ strategy: { concepts: [concept('P', ['x'])] } });
    expect(text).not.toContain('retrieved records');
    expect(text).not.toMatch(/n = \d/);
  });
});

describe('buildSearchMethodsText — final version provenance', () => {
  it('names the final version by name and number', () => {
    const text = buildSearchMethodsText({
      strategy: { concepts: [concept('P', ['x'])] },
      versions: [{ version: 2, name: 'Frozen for submission', isFinal: true }, { version: 1, name: 'Draft', isFinal: false }],
    });
    expect(text).toContain('"Frozen for submission" (version 2)');
    expect(text).toContain('frozen for reproducibility');
  });

  it('names a final version by number when it is unnamed', () => {
    const text = buildSearchMethodsText({
      strategy: { concepts: [] },
      versions: [{ version: 3, name: '', isFinal: true }],
    });
    expect(text).toContain('version 3');
  });

  it('uses the neutral supplementary-material sentence when no version is final', () => {
    const text = buildSearchMethodsText({
      strategy: { concepts: [concept('P', ['x'])] },
      versions: [{ version: 1, name: 'Draft', isFinal: false }],
    });
    expect(text).toContain('supplementary material');
    expect(text).not.toContain('frozen for reproducibility');
  });
});
