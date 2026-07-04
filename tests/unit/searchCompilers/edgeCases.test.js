/**
 * edgeCases.test.js — cross-database edge cases: empty strategy, all-ignored concept,
 * op-chaining across a dropped concept, special-character escaping, and too-short
 * truncation. These exercise normalize.js + shared.js through the public compiler.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';

const oneTerm = (text, extra = {}) => ({ text, type: 'freetext', field: 'tiab', ...extra });

describe('empty + degenerate strategies', () => {
  it('empty strategy → empty query + an explanatory note', () => {
    const r = compileStrategy({}, 'pubmed');
    expect(r.query).toBe('');
    expect(r.notes.some((n) => /No concepts with search terms/.test(n))).toBe(true);
    expect(r.vocab).toEqual({ system: 'mesh', mapped: 0, unmapped: 0, approximate: false });
    expect(r.filtersApplied).toBe(false);
  });

  it('a concept whose terms are all blank is skipped with a per-concept note', () => {
    const s = { concepts: [{ id: 'x', label: 'Ghost', op: 'AND', terms: [{ text: '   ', type: 'freetext' }] }], filters: {} };
    const r = compileStrategy(s, 'pubmed');
    expect(r.query).toBe('');
    expect(r.notes.some((n) => /Concept "Ghost" has no usable terms and was skipped/.test(n))).toBe(true);
  });

  it('op chaining uses the previous SURVIVING block when an empty concept is dropped', () => {
    const s = { concepts: [
      { id: 'c1', label: 'A', op: 'AND', terms: [oneTerm('alpha')] },
      { id: 'c2', label: 'B', op: 'OR', terms: [{ text: '', type: 'freetext' }] }, // dropped
      { id: 'c3', label: 'C', op: 'AND', terms: [oneTerm('beta')] },
    ], filters: {} };
    // The dropped OR concept's op vanishes; A's AND joins straight to C.
    expect(compileStrategy(s, 'pubmed').query).toBe('alpha[tiab] AND beta[tiab]');
  });
});

describe('special-character escaping', () => {
  it('PubMed keeps an apostrophe in a single word (SearchBuilderTab parity)', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [oneTerm("heart's")] }], filters: {} };
    expect(compileStrategy(s, 'pubmed').query).toBe("heart's[tiab]");
  });

  it('Embase (single-quote grammar) strips an embedded apostrophe', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [oneTerm("heart's")] }], filters: {} };
    expect(compileStrategy(s, 'embase').query).toBe('hearts:ti,ab');
  });

  it('force-quotes a single word that contains parentheses so they are literal', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [oneTerm('tnf(alpha)')] }], filters: {} };
    expect(compileStrategy(s, 'scopus').query).toBe('TITLE-ABS-KEY("tnf(alpha)")');
  });
});

describe('truncation validity', () => {
  it('warns + drops the wildcard when the stem is under the per-db minimum (Embase, 4)', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [oneTerm('hf', { truncate: true })] }], filters: {} };
    const r = compileStrategy(s, 'embase');
    expect(r.query).toBe('hf:ti,ab'); // no trailing *
    expect(r.warnings.map((w) => w.code)).toContain('TRUNCATION_TOO_SHORT');
  });
});
