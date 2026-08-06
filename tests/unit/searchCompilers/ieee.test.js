/**
 * ieee.test.js — IEEE Xplore Command-Search compiler golden.
 * 100.md §3 — no subject-heading thesaurus; controlled terms ride through renderFree
 * ("Document Title" OR "Abstract") instead of the old "All Metadata" full-text sweep.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('ieee compiler', () => {
  it('compiles the fixture to "Document Title"/"Abstract" groups', () => {
    const r = compileStrategy(FIXTURE, 'ieee');
    expect(r.query).toBe(
      '(((("Document Title":"Heart Failure" OR "Abstract":"Heart Failure")'
      + ' OR ("Document Title":"cardiac failure" OR "Abstract":"cardiac failure")'
      + ' OR "Document Title":chf) AND ("Document Title":sglt2* OR "Abstract":sglt2*))'
      + ' OR ("Document Title":placebo OR "Abstract":placebo))',
    );
    expect(r.filtersApplied).toBe(false);
  });

  it('records controlled vocab as unsupported', () => {
    const r = compileStrategy(FIXTURE, 'ieee');
    expect(r.unsupported.map((u) => u.feature)).toContain('controlled-vocabulary');
    expect(r.vocab.fallback).toBe(1);
  });
});
