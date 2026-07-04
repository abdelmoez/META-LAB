/**
 * pubmed.test.js — PubMed compiler golden test. The concept/term rendering is
 * byte-identical to today's SearchBuilderTab.renderSearch output; filters are the
 * additive PubMed limit layer.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('pubmed compiler', () => {
  it('compiles the fixture to the exact PubMed string (with filters)', () => {
    const r = compileStrategy(FIXTURE, 'pubmed');
    expect(r.query).toBe(
      '(("Heart Failure"[Mesh] OR "cardiac failure"[tiab] OR chf[ti]) AND sglt2*[tiab] OR placebo[tiab])'
      + ' AND ("2010/01/01"[Date - Publication] : "2025/12/31"[Date - Publication])'
      + ' AND English[Language] AND "Randomized Controlled Trial"[Publication Type]',
    );
    expect(r.syntaxLevel).toBe('native');
    expect(r.filtersApplied).toBe(true);
    expect(r.vocab).toEqual({ system: 'mesh', mapped: 1, unmapped: 0, approximate: false });
    expect(r.warnings).toEqual([]);
    expect(r.unsupported).toEqual([]);
  });

  it('is byte-identical to SearchBuilderTab.renderSearch when no filters are set', () => {
    const r = compileStrategy({ ...FIXTURE, filters: {} }, 'pubmed');
    // Exactly the flat concept chaining renderSearch produces (op joins to the NEXT concept).
    expect(r.query).toBe('("Heart Failure"[Mesh] OR "cardiac failure"[tiab] OR chf[ti]) AND sglt2*[tiab] OR placebo[tiab]');
    expect(r.filtersApplied).toBe(false);
  });

  it('renders a no-explode MeSH heading as [Mesh:NoExp]', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [
      { text: 'Heart Failure', type: 'controlled', field: 'tiab', vocab: { mesh: 'Heart Failure' }, noExplode: true },
    ] }], filters: {} };
    expect(compileStrategy(s, 'pubmed').query).toBe('"Heart Failure"[Mesh:NoExp]');
  });
});
