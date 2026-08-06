/**
 * scopus.test.js — Scopus Advanced-search compiler golden.
 *
 * 100.md §3 — Scopus indexes no medical subject-heading thesaurus, so
 * `controlledVocab: false` and subject terms ride as TITLE-ABS-KEY free text (which
 * already reaches Scopus's own author/index keywords). The pre-100
 * `INDEXTERMS("<MeSH heading>")` clause searched a publisher-keyword field that MeSH
 * strings almost never match.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('scopus compiler', () => {
  it('compiles the fixture to the exact Scopus string with PUBYEAR + LANGUAGE limits', () => {
    const r = compileStrategy(FIXTURE, 'scopus');
    expect(r.query).toBe(
      '(((TITLE-ABS-KEY("Heart Failure") OR TITLE-ABS-KEY("cardiac failure") OR TITLE(chf))'
      + ' AND TITLE-ABS-KEY(sglt2*)) OR TITLE-ABS-KEY(placebo))'
      + ' AND (PUBYEAR > 2009 AND PUBYEAR < 2026) AND LANGUAGE(English)',
    );
    expect(r.filtersApplied).toBe(true);
  });

  it('records the missing thesaurus as unsupported instead of faking INDEXTERMS', () => {
    const r = compileStrategy(FIXTURE, 'scopus');
    expect(r.query).not.toContain('INDEXTERMS');
    expect(r.vocab).toEqual({ system: 'none', mapped: 0, unmapped: 1, fallback: 1, approximate: false });
    expect(r.syntaxLevel).toBe('native');
    expect(r.unsupported.map((u) => u.feature)).toContain('controlled-vocabulary');
    expect(r.warnings.map((w) => w.code)).toContain('FILTER_NOT_EMBEDDABLE'); // pubtype not mapped
  });
});
