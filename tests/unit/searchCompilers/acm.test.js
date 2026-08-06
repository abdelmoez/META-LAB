/**
 * acm.test.js — ACM Digital Library compiler golden.
 * 100.md §3 — no subject-heading thesaurus; controlled terms ride through renderFree
 * (Title OR Abstract), a truer analogue of a topical heading than the old AllField
 * full-text sweep.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('acm compiler', () => {
  it('compiles the fixture to Title:()/Abstract:() groups', () => {
    const r = compileStrategy(FIXTURE, 'acm');
    expect(r.query).toBe(
      '((((Title:("Heart Failure") OR Abstract:("Heart Failure"))'
      + ' OR (Title:("cardiac failure") OR Abstract:("cardiac failure")) OR Title:(chf))'
      + ' AND (Title:(sglt2*) OR Abstract:(sglt2*))) OR (Title:(placebo) OR Abstract:(placebo)))',
    );
    expect(r.filtersApplied).toBe(false);
  });

  it('records the missing thesaurus as unsupported', () => {
    const r = compileStrategy(FIXTURE, 'acm');
    expect(r.unsupported.map((u) => u.feature)).toContain('controlled-vocabulary');
    expect(r.vocab.fallback).toBe(1);
    expect(r.vocab.approximate).toBe(false);
  });
});
