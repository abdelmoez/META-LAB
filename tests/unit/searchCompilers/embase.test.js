/**
 * embase.test.js — Embase.com quick-syntax compiler golden.
 *
 * 100.md §3 — Embase is indexed with Emtree, which is Elsevier-proprietary and has no
 * published MeSH crosswalk, so the capability table declares `controlledVocab: false`
 * and the renderer has NO `renderHeading` hook. The pre-100 compiler emitted
 * `'<lower-cased de-inverted MeSH heading>'/exp` — a subject heading that frequently
 * does not exist in Emtree, i.e. exactly the invented syntax 100.md forbids. Subject
 * terms now compile to a real, quoted Embase free-text phrase with an explicit
 * VOCAB_NO_EQUIVALENT warning, and the result is honestly `native` (the string IS
 * valid Embase syntax) rather than `approximate`.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('embase compiler', () => {
  it('compiles the fixture to the exact Embase string', () => {
    const r = compileStrategy(FIXTURE, 'embase');
    expect(r.query).toBe(
      "((('Heart Failure':ti,ab OR 'cardiac failure':ti,ab OR chf:ti) AND sglt2*:ti,ab) OR placebo:ti,ab)"
      + ' AND [2010-2025]/py AND [english]/lim',
    );
    expect(r.syntaxLevel).toBe('native');
    expect(r.filtersApplied).toBe(true);
    expect(r.vocab).toEqual({ system: 'emtree', mapped: 0, unmapped: 1, fallback: 1, approximate: false });
    // Publication-type limit is not embeddable in Embase quick syntax → warned, not faked.
    expect(r.warnings.map((w) => w.code)).toContain('FILTER_NOT_EMBEDDABLE');
  });

  it('never invents an Emtree heading — it says there is no verified equivalent', () => {
    const r = compileStrategy(FIXTURE, 'embase');
    const w = r.warnings.find((x) => x.code === 'VOCAB_NO_EQUIVALENT');
    expect(w).toBeTruthy();
    expect(w.message).toMatch(/indexed with Emtree/);
    expect(w.message).toMatch(/no public crosswalk/);
    // The fabricated forms must be gone entirely.
    expect(r.query).not.toContain('/exp');
    expect(r.query).not.toContain('/de');
  });

  it('a strategy with NO controlled terms is untouched', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [
      { text: 'metformin', type: 'freetext', field: 'tiab' },
    ] }], filters: {} };
    const r = compileStrategy(s, 'embase');
    expect(r.query).toBe('metformin:ti,ab');
    expect(r.syntaxLevel).toBe('native');
    expect(r.vocab).toEqual({ system: 'emtree', mapped: 0, unmapped: 0, fallback: 0, approximate: false });
  });

  it('searches an INVERTED heading in natural word order, not as the indexed string', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [
      { text: 'type 2 diabetes', type: 'controlled', field: 'tiab', vocab: { mesh: 'Diabetes Mellitus, Type 2' } },
    ] }], filters: {} };
    // No paper writes "diabetes mellitus, type 2"; the de-inverted form is what a
    // free-text fallback has to search (100.md §3).
    expect(compileStrategy(s, 'embase').query).toBe("'Type 2 Diabetes Mellitus':ti,ab");
  });
});
