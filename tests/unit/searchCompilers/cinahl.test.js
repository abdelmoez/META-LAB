/**
 * cinahl.test.js — CINAHL (EBSCOhost) compiler golden + approximate-heading warning.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('cinahl compiler', () => {
  it('compiles the fixture to the exact CINAHL string with PY/LA/PT limits', () => {
    const r = compileStrategy(FIXTURE, 'cinahl');
    expect(r.query).toBe(
      '((((MH "Heart Failure+") OR (TI "cardiac failure" OR AB "cardiac failure") OR TI chf)'
      + ' AND (TI sglt2* OR AB sglt2*)) OR (TI placebo OR AB placebo))'
      + ' AND (PY 2010-2025) AND (LA English) AND (PT "Randomized Controlled Trial")',
    );
    expect(r.filtersApplied).toBe(true);
  });

  it('reuses the MeSH label as an approximate CINAHL Heading (exploded with +)', () => {
    const r = compileStrategy(FIXTURE, 'cinahl');
    expect(r.vocab).toEqual({ system: 'cinahl', mapped: 1, unmapped: 0, approximate: true });
    expect(r.warnings.map((w) => w.code)).toContain('VOCAB_APPROXIMATE');
  });

  it('drops the + explode marker when no-explode is requested', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [
      { text: 'Heart Failure', type: 'controlled', field: 'tiab', vocab: { mesh: 'Heart Failure' }, noExplode: true },
    ] }], filters: {} };
    expect(compileStrategy(s, 'cinahl').query).toBe('(MH "Heart Failure")');
  });
});
