/**
 * cinahl.test.js — CINAHL (EBSCOhost) compiler golden.
 *
 * 100.md §3 — CINAHL Headings are an EBSCO thesaurus with no published MeSH crosswalk.
 * The pre-100 compiler pasted the MeSH string straight into `(MH "…+")`, which returns
 * ZERO whenever the two vocabularies word a concept differently. There is no
 * `renderHeading` hook now: subject terms compile to CINAHL free text with an explicit
 * "no verified CINAHL Heading equivalent" warning that names the recovery path.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('cinahl compiler', () => {
  it('compiles the fixture to the exact CINAHL string with PY/LA/PT limits', () => {
    const r = compileStrategy(FIXTURE, 'cinahl');
    expect(r.query).toBe(
      '((((TI "Heart Failure" OR AB "Heart Failure") OR (TI "cardiac failure" OR AB "cardiac failure") OR TI chf)'
      + ' AND (TI sglt2* OR AB sglt2*)) OR (TI placebo OR AB placebo))'
      + ' AND (PY 2010-2025) AND (LA English) AND (PT "Randomized Controlled Trial")',
    );
    expect(r.filtersApplied).toBe(true);
    expect(r.syntaxLevel).toBe('native');
  });

  it('never invents a CINAHL Heading — no (MH "…") clause is emitted', () => {
    const r = compileStrategy(FIXTURE, 'cinahl');
    expect(r.query).not.toContain('MH "');
    expect(r.vocab).toEqual({ system: 'cinahl', mapped: 0, unmapped: 1, fallback: 1, approximate: false });
    const w = r.warnings.find((x) => x.code === 'VOCAB_NO_EQUIVALENT');
    expect(w).toBeTruthy();
    expect(w.message).toMatch(/indexed with CINAHL Headings/);
    // It points at the recovery path rather than leaving a dead end.
    expect(w.message).toMatch(/paste its own heading in through Edit/);
  });
});
