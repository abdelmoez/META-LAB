/**
 * clinicaltrials.test.js — ClinicalTrials.gov (Essie) compiler golden + degrade paths.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy } from '../../../src/research-engine/searchBuilder/compilers/index.js';
import { FIXTURE } from './fixture.js';

describe('clinicaltrials compiler', () => {
  it('compiles the fixture to plain Essie boolean with quoted phrases', () => {
    const r = compileStrategy(FIXTURE, 'clinicaltrials');
    expect(r.query).toBe('((("Heart Failure" OR "cardiac failure" OR chf) AND sglt2) OR placebo)');
    expect(r.filtersApplied).toBe(false);
  });

  it('degrades controlled vocab to a phrase and records it as unsupported', () => {
    const r = compileStrategy(FIXTURE, 'clinicaltrials');
    expect(r.unsupported.map((u) => u.feature)).toContain('controlled-vocabulary');
    expect(r.warnings.map((w) => w.code)).toContain('TRUNCATION_UNSUPPORTED');
    // 100.md §3 — a free-text fallback is a REAL translation, not an approximation of
    // this database's syntax, so `approximate` stays false and `fallback` counts it.
    expect(r.vocab.fallback).toBe(1);
    expect(r.vocab.approximate).toBe(false);
    expect(r.notes.some((n) => /AREA\[ConditionSearch\]/.test(n))).toBe(true);
  });
});
