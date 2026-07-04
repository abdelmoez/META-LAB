/**
 * pubmed.test.js — PubMed compiler golden test. The concept/term rendering matches
 * SearchBuilderTab.renderSearch for single-operator concept chains; a MIXED AND/OR
 * chain is made explicit with left-associative parentheses (semantically identical
 * in PubMed's left-to-right evaluation, but unambiguous in databases that apply
 * AND-before-OR precedence). Filters are the additive PubMed limit layer.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('pubmed compiler', () => {
  it('compiles the fixture to the exact PubMed string (with filters)', () => {
    const r = compileStrategy(FIXTURE, 'pubmed');
    expect(r.query).toBe(
      '((("Heart Failure"[Mesh] OR "cardiac failure"[tiab] OR chf[ti]) AND sglt2*[tiab]) OR placebo[tiab])'
      + ' AND ("2010/01/01"[Date - Publication] : "2025/12/31"[Date - Publication])'
      + ' AND English[Language] AND "Randomized Controlled Trial"[Publication Type]',
    );
    expect(r.syntaxLevel).toBe('native');
    expect(r.filtersApplied).toBe(true);
    expect(r.vocab).toEqual({ system: 'mesh', mapped: 1, unmapped: 0, approximate: false });
    expect(r.warnings).toEqual([]);
    expect(r.unsupported).toEqual([]);
  });

  it('parenthesizes a mixed AND/OR chain explicitly when no filters are set', () => {
    const r = compileStrategy({ ...FIXTURE, filters: {} }, 'pubmed');
    // renderSearch's op joins to the NEXT concept; a mixed AND→OR chain is made
    // explicit (left-associative), semantically identical under PubMed evaluation.
    expect(r.query).toBe('((("Heart Failure"[Mesh] OR "cardiac failure"[tiab] OR chf[ti]) AND sglt2*[tiab]) OR placebo[tiab])');
    expect(r.filtersApplied).toBe(false);
  });

  it('is byte-identical to a flat all-AND chain (single operator, no wrap)', () => {
    const allAnd = {
      concepts: FIXTURE.concepts.map((c) => ({ ...c, op: 'AND' })),
      filters: {},
    };
    const r = compileStrategy(allAnd, 'pubmed');
    // A single-operator chain stays unwrapped — byte-for-byte the legacy renderer.
    expect(r.query).toBe('("Heart Failure"[Mesh] OR "cardiac failure"[tiab] OR chf[ti]) AND sglt2*[tiab] AND placebo[tiab]');
  });

  it('renders a no-explode MeSH heading as [Mesh:NoExp]', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [
      { text: 'Heart Failure', type: 'controlled', field: 'tiab', vocab: { mesh: 'Heart Failure' }, noExplode: true },
    ] }], filters: {} };
    expect(compileStrategy(s, 'pubmed').query).toBe('"Heart Failure"[Mesh:NoExp]');
  });
});
