/**
 * psycinfo.test.js — APA PsycInfo (EBSCOhost) compiler golden.
 *
 * 100.md §3 — PsycInfo is indexed with the proprietary APA Thesaurus of Psychological
 * Index Terms, worded quite differently from MeSH (a biomedical thesaurus) and with no
 * public crosswalk. The pre-100 `DE "<MeSH heading>"` clause matched almost nothing;
 * subject terms now compile to PsycInfo free text with an explicit warning.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('psycinfo compiler', () => {
  it('compiles the fixture to the exact PsycInfo string with PY/LA/PT limits', () => {
    const r = compileStrategy(FIXTURE, 'psycinfo');
    expect(r.query).toBe(
      '((((TI "Heart Failure" OR AB "Heart Failure") OR (TI "cardiac failure" OR AB "cardiac failure") OR TI chf)'
      + ' AND (TI sglt2* OR AB sglt2*)) OR (TI placebo OR AB placebo))'
      + ' AND (PY 2010-2025) AND (LA English) AND (PT "Randomized Controlled Trial")',
    );
    expect(r.filtersApplied).toBe(true);
  });

  it('never invents an APA descriptor — no DE "…" clause is emitted', () => {
    const r = compileStrategy(FIXTURE, 'psycinfo');
    expect(r.query).not.toContain('DE "');
    expect(r.vocab).toEqual({ system: 'apa', mapped: 0, unmapped: 1, fallback: 1, approximate: false });
    expect(r.warnings.map((w) => w.code)).toContain('VOCAB_NO_EQUIVALENT');
  });
});
