/**
 * europepmc.test.js — Europe PMC compiler golden (mirrors the pecanSearch connector).
 * 100.md §4 — Europe PMC carries MEDLINE's MeSH annotations, so the mesh→mesh identity
 * mapping applies and `MESH:` is real native syntax. It has no explosion form, which
 * the capability table declares (explosion:false, explosionDefault:'exact') and the
 * shared layer reports in the right direction.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('europepmc compiler', () => {
  it('compiles the fixture to the exact Europe PMC string with PUB_YEAR/LANG/PUB_TYPE', () => {
    const r = compileStrategy(FIXTURE, 'europepmc');
    expect(r.query).toBe(
      '(((MESH:"Heart Failure" OR (TITLE:"cardiac failure" OR ABSTRACT:"cardiac failure") OR TITLE:chf)'
      + ' AND (TITLE:sglt2* OR ABSTRACT:sglt2*)) OR (TITLE:placebo OR ABSTRACT:placebo))'
      + ' AND (PUB_YEAR:[2010 TO 2025]) AND (LANG:"eng") AND (PUB_TYPE:"Randomized Controlled Trial")',
    );
    expect(r.filtersApplied).toBe(true);
  });

  it('uses the real MeSH descriptor and warns that explosion is unavailable', () => {
    const r = compileStrategy(FIXTURE, 'europepmc');
    expect(r.vocab).toEqual({ system: 'mesh', mapped: 1, unmapped: 0, fallback: 0, approximate: false });
    const w = r.warnings.find((x) => x.code === 'VOCAB_EXPLOSION_UNSUPPORTED');
    expect(w).toBeTruthy();
    expect(w.message).toMatch(/WITHOUT its narrower topics/);
  });

  it('does not warn about explosion when the user switched it off', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [
      { text: 'Heart Failure', type: 'controlled', field: 'tiab', vocab: { mesh: 'Heart Failure' }, noExplode: true },
    ] }], filters: {} };
    const r = compileStrategy(s, 'europepmc');
    expect(r.query).toBe('MESH:"Heart Failure"');
    expect(r.warnings.map((w) => w.code)).not.toContain('VOCAB_EXPLOSION_UNSUPPORTED');
  });
});
