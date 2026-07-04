/**
 * europepmc.test.js — Europe PMC compiler golden (mirrors the pecanSearch connector).
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('europepmc compiler', () => {
  it('compiles the fixture to the exact Europe PMC string with PUB_YEAR/LANG/PUB_TYPE', () => {
    const r = compileStrategy(FIXTURE, 'europepmc');
    expect(r.query).toBe(
      '((MESH:"Heart Failure" OR (TITLE:"cardiac failure" OR ABSTRACT:"cardiac failure") OR TITLE:chf)'
      + ' AND (TITLE:sglt2* OR ABSTRACT:sglt2*) OR (TITLE:placebo OR ABSTRACT:placebo))'
      + ' AND (PUB_YEAR:[2010 TO 2025]) AND (LANG:"eng") AND (PUB_TYPE:"Randomized Controlled Trial")',
    );
    expect(r.filtersApplied).toBe(true);
  });

  it('renders MeSH best-effort with an approximate warning', () => {
    const r = compileStrategy(FIXTURE, 'europepmc');
    expect(r.vocab).toEqual({ system: 'mesh', mapped: 1, unmapped: 0, approximate: true });
    expect(r.warnings.map((w) => w.code)).toContain('VOCAB_APPROXIMATE');
  });
});
