/**
 * pmc.test.js — PubMed Central compiler golden (conservative NCBI field subset).
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('pmc compiler', () => {
  it('compiles the fixture using [Title]/[Abstract]/[MeSH Terms] with limits', () => {
    const r = compileStrategy(FIXTURE, 'pmc');
    expect(r.query).toBe(
      '((("Heart Failure"[MeSH Terms] OR ("cardiac failure"[Title] OR "cardiac failure"[Abstract]) OR chf[Title])'
      + ' AND (sglt2*[Title] OR sglt2*[Abstract])) OR (placebo[Title] OR placebo[Abstract]))'
      + ' AND ("2010/01/01"[Publication Date] : "2025/12/31"[Publication Date])'
      + ' AND English[Language] AND "Randomized Controlled Trial"[Publication Type]',
    );
    expect(r.syntaxLevel).toBe('native');
    expect(r.filtersApplied).toBe(true);
    expect(r.vocab).toEqual({ system: 'mesh', mapped: 1, unmapped: 0, approximate: false });
    expect(r.notes.some((n) => /field behaviour differs from PubMed/.test(n))).toBe(true);
  });
});
