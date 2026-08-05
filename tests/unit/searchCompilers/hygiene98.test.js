/**
 * hygiene98.test.js — 98.md §12 compile-hygiene contracts, exercised through the
 * public compiler (normalize.js + shared.js), in the house golden style:
 *
 *  - orGroup collapses case-insensitive EXACT-duplicate clauses inside one
 *    concept ("x[tiab] OR x[tiab]" adds nothing but noise; legacy saves can
 *    carry in-group duplicates the UI now prevents). Cross-group duplicates are
 *    untouched — semantically meaningful under AND.
 *  - An EMPTY strategy NEVER compiles to a runnable string: persisted filters
 *    used to produce a bare filters-only query (a date range with no terms)
 *    while the note claimed the query was empty. Filters apply only when there
 *    is something to filter.
 *  - Unicode hygiene: curly quotes/apostrophes are folded to ASCII and text is
 *    NFC-normalized at the normalize.js choke point, so "Crohn’s disease"
 *    pasted from a paper compiles EXACTLY like "Crohn's disease" in every
 *    quote grammar (double-quote PubMed AND single-quote Embase).
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';

const ft = (text, extra = {}) => ({ text, type: 'freetext', field: 'tiab', ...extra });
const strat = (terms, filters = {}) => ({ concepts: [{ id: 'c1', label: 'C', op: 'AND', terms }], filters });

describe('98.md §12 — orGroup collapses case-insensitive exact-duplicate clauses', () => {
  it('x OR x → one clause (no parens left behind)', () => {
    expect(compileStrategy(strat([ft('x'), ft('x')]), 'pubmed').query).toBe('x[tiab]');
  });
  it('the duplicate test is case-INSENSITIVE on the rendered clause; first spelling wins', () => {
    expect(compileStrategy(strat([ft('EUS'), ft('eus')]), 'pubmed').query).toBe('EUS[tiab]');
  });
  it('distinct clauses survive; only the exact repeats collapse', () => {
    expect(compileStrategy(strat([ft('stroke'), ft('TIA'), ft('stroke')]), 'pubmed').query)
      .toBe('(stroke[tiab] OR TIA[tiab])');
  });
  it('same TEXT in different FIELDS renders different clauses — NOT collapsed', () => {
    expect(compileStrategy(strat([ft('stroke'), ft('stroke', { field: 'ti' })]), 'pubmed').query)
      .toBe('(stroke[tiab] OR stroke[ti])');
  });
  it('CROSS-group duplicates are untouched (meaningful under AND)', () => {
    const s = {
      concepts: [
        { id: 'a', label: 'A', op: 'AND', terms: [ft('eus')] },
        { id: 'b', label: 'B', op: 'AND', terms: [ft('eus')] },
      ],
      filters: {},
    };
    expect(compileStrategy(s, 'pubmed').query).toBe('eus[tiab] AND eus[tiab]');
  });
});

describe('98.md §12 — an empty strategy + persisted filters compiles to query ""', () => {
  const filters = { dateFrom: '2010', dateTo: '2025', languages: ['en'], pubTypes: [] };
  it('pubmed: no concepts → "" even with a saved date/language limit', () => {
    const r = compileStrategy({ concepts: [], filters }, 'pubmed');
    expect(r.query).toBe('');
    expect(r.notes.some((n) => /No concepts with search terms/.test(n))).toBe(true);
  });
  it('embase: same rule (never a runnable filters-only string)', () => {
    const r = compileStrategy({ concepts: [], filters }, 'embase');
    expect(r.query).toBe('');
    expect(r.query).not.toContain('/py');
  });
  it('a strategy whose every term is disabled is empty too (liveness rule)', () => {
    const r = compileStrategy(strat([ft('stroke', { disabled: true })], filters), 'pubmed');
    expect(r.query).toBe('');
  });
  it('regression: a LIVE strategy still gets its filter limits appended', () => {
    const r = compileStrategy(strat([ft('stroke')], filters), 'pubmed');
    expect(r.query).toContain('stroke[tiab]');
    expect(r.query).toContain('Date - Publication');
    expect(r.filtersApplied).toBe(true);
  });
});

describe('98.md §12 — curly-quote/apostrophe folding + NFC at the normalize choke point', () => {
  const CURLY = 'Crohn’s disease';    // Crohn’s disease (U+2019)
  const ASCII = "Crohn's disease";
  it('pubmed (double-quote grammar): the curly apostrophe compiles as ASCII', () => {
    const r = compileStrategy(strat([ft(CURLY, { phrase: true })]), 'pubmed');
    expect(r.query).toBe('"Crohn\'s disease"[tiab]');
    // byte-identical to the straight-apostrophe input
    expect(r.query).toBe(compileStrategy(strat([ft(ASCII, { phrase: true })]), 'pubmed').query);
  });
  it('embase (single-quote grammar): folded first, then the grammar strips it WITH the explicit warning', () => {
    const curly = compileStrategy(strat([ft(CURLY, { phrase: true })]), 'embase');
    const ascii = compileStrategy(strat([ft(ASCII, { phrase: true })]), 'embase');
    // identical compile for curly vs straight input — the §12 guarantee
    expect(curly.query).toBe(ascii.query);
    expect(curly.query).toBe("'Crohns disease':ti,ab"); // single-quote grammar drops the apostrophe…
    expect(curly.warnings.map((w) => w.code)).toContain('CHARS_REMOVED'); // …but never silently
  });
  it('NFC normalization: a decomposed accent compiles like its composed form', () => {
    const decomposed = 'café au lait spots'; // e + combining acute
    const composed = 'café au lait spots';
    expect(compileStrategy(strat([ft(decomposed, { phrase: true })]), 'pubmed').query)
      .toBe(compileStrategy(strat([ft(composed, { phrase: true })]), 'pubmed').query);
  });
});
