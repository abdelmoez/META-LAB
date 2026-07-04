/**
 * proquest.test.js — ProQuest compiler golden + MAINSUBJECT approximation.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('proquest compiler', () => {
  it('compiles the fixture to TI,AB() groups with an approximate MAINSUBJECT', () => {
    const r = compileStrategy(FIXTURE, 'proquest');
    expect(r.query).toBe(
      '(((MAINSUBJECT.EXACT("Heart Failure") OR TI,AB("cardiac failure") OR TI(chf))'
      + ' AND TI,AB(sglt2*)) OR TI,AB(placebo))',
    );
    expect(r.filtersApplied).toBe(false); // date/language use ProQuest's own limiters
  });

  it('flags the MAINSUBJECT mapping as approximate + notes the limiters', () => {
    const r = compileStrategy(FIXTURE, 'proquest');
    expect(r.vocab).toEqual({ system: 'none', mapped: 1, unmapped: 0, approximate: true });
    expect(r.warnings.map((w) => w.code)).toContain('VOCAB_APPROXIMATE');
    expect(r.notes.some((n) => /ProQuest limiters/.test(n))).toBe(true);
  });
});
