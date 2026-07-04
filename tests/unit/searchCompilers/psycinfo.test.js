/**
 * psycinfo.test.js — APA PsycInfo (EBSCOhost) compiler golden + approximate descriptor.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('psycinfo compiler', () => {
  it('compiles the fixture to the exact PsycInfo string with PY/LA/PT limits', () => {
    const r = compileStrategy(FIXTURE, 'psycinfo');
    expect(r.query).toBe(
      '(((DE "Heart Failure" OR (TI "cardiac failure" OR AB "cardiac failure") OR TI chf)'
      + ' AND (TI sglt2* OR AB sglt2*)) OR (TI placebo OR AB placebo))'
      + ' AND (PY 2010-2025) AND (LA English) AND (PT "Randomized Controlled Trial")',
    );
    expect(r.filtersApplied).toBe(true);
  });

  it('maps controlled vocab to an approximate APA descriptor (DE)', () => {
    const r = compileStrategy(FIXTURE, 'psycinfo');
    expect(r.vocab).toEqual({ system: 'apa', mapped: 1, unmapped: 0, approximate: true });
    expect(r.warnings.map((w) => w.code)).toContain('VOCAB_APPROXIMATE');
  });
});
