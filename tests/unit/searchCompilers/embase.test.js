/**
 * embase.test.js — Embase.com quick-syntax compiler golden + Emtree-fallback warning.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('embase compiler', () => {
  it('compiles the fixture to the exact Embase string', () => {
    const r = compileStrategy(FIXTURE, 'embase');
    // 96.md QA M7 — the QUERY STRING is byte-identical to the pre-M7 pin; only the
    // honesty metadata changed (see the vocab/warning assertions below).
    expect(r.query).toBe(
      "((('heart failure'/exp OR 'cardiac failure':ti,ab OR chf:ti) AND sglt2*:ti,ab) OR placebo:ti,ab)"
      + ' AND [2010-2025]/py AND [english]/lim',
    );
    // 96.md QA M7 — every emtree value in the vocab payload is a MeSH-derived
    // heuristic (NLM publishes no Emtree; see nlmClient.emtreeFallback), so a
    // "mapped" Emtree heading is HONESTLY flagged approximate + warned, exactly
    // like cinahl/scopus flag their carried-over headings. syntaxLevel follows.
    expect(r.syntaxLevel).toBe('approximate');
    expect(r.filtersApplied).toBe(true);
    expect(r.vocab).toEqual({ system: 'emtree', mapped: 1, unmapped: 0, approximate: true });
    expect(r.warnings.map((w) => w.code)).toContain('VOCAB_APPROXIMATE');
    expect(r.warnings.find((w) => w.code === 'VOCAB_APPROXIMATE').message).toMatch(/verify it in the Emtree thesaurus/);
    // Publication-type limit is not embeddable in Embase quick syntax → warned, not faked.
    expect(r.warnings.map((w) => w.code)).toContain('FILTER_NOT_EMBEDDABLE');
  });

  it('M7 — a strategy with NO controlled terms stays native (no heuristic in play)', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [
      { text: 'metformin', type: 'freetext', field: 'tiab' },
    ] }], filters: {} };
    const r = compileStrategy(s, 'embase');
    expect(r.query).toBe('metformin:ti,ab');
    expect(r.syntaxLevel).toBe('native');
    expect(r.vocab).toEqual({ system: 'emtree', mapped: 0, unmapped: 0, approximate: false });
  });

  it('warns + falls back to free text when a controlled term has no Emtree mapping', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [
      { text: 'Widget Disease', type: 'controlled', field: 'tiab', vocab: { mesh: 'Widget Disease' } },
    ] }], filters: {} };
    const r = compileStrategy(s, 'embase');
    expect(r.query).toBe("'widget disease':ti,ab");
    expect(r.vocab).toEqual({ system: 'emtree', mapped: 0, unmapped: 1, approximate: true });
    expect(r.warnings.map((w) => w.code)).toContain('VOCAB_FALLBACK');
    expect(r.syntaxLevel).toBe('approximate');
  });
});
