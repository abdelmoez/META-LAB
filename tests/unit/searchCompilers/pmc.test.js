/**
 * pmc.test.js — PubMed Central compiler golden (conservative NCBI field subset).
 * 100.md §4 — PMC indexes MeSH (identity mapping). `[MeSH Terms]` ALWAYS explodes and
 * PMC exposes no NoExp form, declared as explosion:false / explosionDefault:'explode',
 * so the mismatch is reported only when the user asked NOT to explode.
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
    expect(r.vocab).toEqual({ system: 'mesh', mapped: 1, unmapped: 0, fallback: 0, approximate: false });
    expect(r.notes.some((n) => /field behaviour differs from PubMed/.test(n))).toBe(true);
    // Exploded is what PMC does by default → nothing to warn about.
    expect(r.warnings.map((w) => w.code)).not.toContain('VOCAB_EXPLOSION_UNSUPPORTED');
  });

  it('warns when no-explosion is requested but PMC always explodes', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [
      { text: 'Heart Failure', type: 'controlled', field: 'tiab', vocab: { mesh: 'Heart Failure' }, noExplode: true },
    ] }], filters: {} };
    const r = compileStrategy(s, 'pmc');
    expect(r.query).toBe('"Heart Failure"[MeSH Terms]');
    const w = r.warnings.find((x) => x.code === 'VOCAB_EXPLOSION_UNSUPPORTED');
    expect(w).toBeTruthy();
    expect(w.message).toMatch(/WITH its narrower topics/);
  });
});
