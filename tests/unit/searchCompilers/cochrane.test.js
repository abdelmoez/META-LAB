/**
 * cochrane.test.js — Cochrane CENTRAL compiler golden + non-embeddable-limit warnings.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('cochrane compiler', () => {
  it('compiles the fixture to the exact CENTRAL string (no in-string limits)', () => {
    const r = compileStrategy(FIXTURE, 'cochrane');
    expect(r.query).toBe(
      '((([mh "Heart Failure"] OR "cardiac failure":ti,ab,kw OR chf:ti) AND sglt2*:ti,ab,kw) OR placebo:ti,ab,kw)',
    );
    expect(r.syntaxLevel).toBe('native');
    expect(r.filtersApplied).toBe(false);
    expect(r.vocab).toEqual({ system: 'mesh', mapped: 1, unmapped: 0, approximate: false });
    // date + language + pubtype each warned as not embeddable, plus a summary note.
    expect(r.warnings.filter((w) => w.code === 'FILTER_NOT_EMBEDDABLE')).toHaveLength(3);
    expect(r.notes.some((n) => /Cochrane Library filters/.test(n))).toBe(true);
  });

  it('renders a no-explode MeSH heading with the ^ marker', () => {
    const s = { concepts: [{ id: 'a', label: 'A', op: 'AND', terms: [
      { text: 'Heart Failure', type: 'controlled', field: 'tiab', vocab: { mesh: 'Heart Failure' }, noExplode: true },
    ] }], filters: {} };
    expect(compileStrategy(s, 'cochrane').query).toBe('[mh ^"Heart Failure"]');
  });
});
