/**
 * wos.test.js — Web of Science compiler golden + topic-text approximation.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('wos compiler', () => {
  it('compiles the fixture to the exact Web of Science string with PY + LA limits', () => {
    const r = compileStrategy(FIXTURE, 'wos');
    expect(r.query).toBe(
      '((TS=("Heart Failure") OR TS=("cardiac failure") OR TI=(chf))'
      + ' AND TS=(sglt2*) OR TS=(placebo)) AND PY=(2010-2025) AND LA=(English)',
    );
    expect(r.filtersApplied).toBe(true);
  });

  it('searches controlled headings as Topic text (approximate, no thesaurus)', () => {
    const r = compileStrategy(FIXTURE, 'wos');
    expect(r.vocab).toEqual({ system: 'none', mapped: 0, unmapped: 1, approximate: true });
    expect(r.warnings.map((w) => w.code)).toContain('VOCAB_APPROXIMATE');
  });
});
