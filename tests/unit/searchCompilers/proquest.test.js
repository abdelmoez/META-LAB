/**
 * proquest.test.js — ProQuest compiler golden.
 * 100.md §3 — ProQuest Dissertations & Theses carries no medical subject-heading
 * thesaurus. `MAINSUBJECT.EXACT("<MeSH heading>")` demanded an EXACT match against
 * ProQuest's own subject list and therefore returned nothing for most MeSH strings;
 * subject terms now ride as TI,AB free text.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('proquest compiler', () => {
  it('compiles the fixture to TI,AB() groups', () => {
    const r = compileStrategy(FIXTURE, 'proquest');
    expect(r.query).toBe(
      '(((TI,AB("Heart Failure") OR TI,AB("cardiac failure") OR TI(chf))'
      + ' AND TI,AB(sglt2*)) OR TI,AB(placebo))',
    );
    expect(r.filtersApplied).toBe(false); // date/language use ProQuest's own limiters
  });

  it('records the missing thesaurus instead of faking MAINSUBJECT.EXACT', () => {
    const r = compileStrategy(FIXTURE, 'proquest');
    expect(r.query).not.toContain('MAINSUBJECT');
    expect(r.vocab).toEqual({ system: 'none', mapped: 0, unmapped: 1, fallback: 1, approximate: false });
    expect(r.unsupported.map((u) => u.feature)).toContain('controlled-vocabulary');
    expect(r.notes.some((n) => /ProQuest limiters/.test(n))).toBe(true);
  });
});
