/**
 * scopus.test.js — Scopus Advanced-search compiler golden + INDEXTERMS approximation.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('scopus compiler', () => {
  it('compiles the fixture to the exact Scopus string with PUBYEAR + LANGUAGE limits', () => {
    const r = compileStrategy(FIXTURE, 'scopus');
    expect(r.query).toBe(
      '((INDEXTERMS("Heart Failure") OR TITLE-ABS-KEY("cardiac failure") OR TITLE(chf))'
      + ' AND TITLE-ABS-KEY(sglt2*) OR TITLE-ABS-KEY(placebo))'
      + ' AND (PUBYEAR > 2009 AND PUBYEAR < 2026) AND LANGUAGE(English)',
    );
    expect(r.filtersApplied).toBe(true);
  });

  it('maps controlled vocab to INDEXTERMS with an approximate warning', () => {
    const r = compileStrategy(FIXTURE, 'scopus');
    expect(r.vocab).toEqual({ system: 'none', mapped: 1, unmapped: 0, approximate: true });
    expect(r.syntaxLevel).toBe('approximate');
    expect(r.warnings.map((w) => w.code)).toContain('VOCAB_APPROXIMATE');
    expect(r.warnings.map((w) => w.code)).toContain('FILTER_NOT_EMBEDDABLE'); // pubtype not mapped
  });
});
