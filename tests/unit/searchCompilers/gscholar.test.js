/**
 * gscholar.test.js — Google Scholar (simplified) compiler golden + length warning.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('gscholar compiler', () => {
  it('compiles the fixture with OR inside a concept and an implicit-AND space between', () => {
    const r = compileStrategy(FIXTURE, 'gscholar');
    // c1 AND(space) c2 OR c3 — Scholar joins AND concepts with a bare space.
    expect(r.query).toBe('((("Heart Failure" OR "cardiac failure" OR chf) sglt2) OR placebo)');
    expect(r.warnings.map((w) => w.code)).toContain('TRUNCATION_UNSUPPORTED'); // Google auto-stems
    expect(r.syntaxLevel).toBe('approximate');
  });

  it('warns when the query exceeds the ~256-character ceiling', () => {
    const terms = Array.from({ length: 40 }, (_, i) => ({ text: `verylongsearchterm${i}`, type: 'freetext', field: 'tiab' }));
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms }], filters: {} };
    const r = compileStrategy(s, 'gscholar');
    expect(r.query.length).toBeGreaterThan(256);
    expect(r.warnings.map((w) => w.code)).toContain('LENGTH_LIMIT');
  });
});
