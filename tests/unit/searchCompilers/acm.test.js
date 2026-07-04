/**
 * acm.test.js — ACM Digital Library compiler golden + limitation warning.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('acm compiler', () => {
  it('compiles the fixture to Title:()/Abstract:() groups', () => {
    const r = compileStrategy(FIXTURE, 'acm');
    expect(r.query).toBe(
      '(AllField:("Heart Failure") OR (Title:("cardiac failure") OR Abstract:("cardiac failure")) OR Title:(chf))'
      + ' AND (Title:(sglt2*) OR Abstract:(sglt2*)) OR (Title:(placebo) OR Abstract:(placebo))',
    );
    expect(r.filtersApplied).toBe(false);
  });

  it('searches subject terms as AllField full text with a warning', () => {
    const r = compileStrategy(FIXTURE, 'acm');
    expect(r.warnings.map((w) => w.code)).toContain('VOCAB_APPROXIMATE');
    expect(r.vocab.approximate).toBe(true);
  });
});
