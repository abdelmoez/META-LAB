/**
 * 86.md P1.6 — summary views must pool ONE outcome, not every outcome/measure mixed.
 */
import { describe, it, expect } from 'vitest';
import { poolPrimaryOutcome } from '../../../src/research-engine/statistics/summaryPool.js';
import { runMeta } from '../../../src/research-engine/statistics/monolithStats.js';

const S = (over) => ({ id: Math.random().toString(36).slice(2), es: '', lo: '', hi: '', esType: 'OR', outcome: '', timepoint: '', ...over });

describe('poolPrimaryOutcome (P1.6)', () => {
  it('pools only the primary outcome group, not all outcomes mixed', () => {
    const studies = [
      // mortality (lnOR)
      S({ outcome: 'Mortality', esType: 'OR', es: '0.30', lo: '0.10', hi: '0.50' }),
      S({ outcome: 'Mortality', esType: 'OR', es: '0.35', lo: '0.15', hi: '0.55' }),
      // pain (SMD) — a totally different measure/scale
      S({ outcome: 'Pain', esType: 'SMD', es: '-0.80', lo: '-1.10', hi: '-0.50' }),
      S({ outcome: 'Pain', esType: 'SMD', es: '-0.75', lo: '-1.05', hi: '-0.45' }),
    ];
    const pooled = poolPrimaryOutcome(studies, 'random');
    expect(pooled.outcomeCount).toBe(2);
    expect(pooled.subset).toHaveLength(2);
    expect(pooled.subset.every((s) => s.outcome === 'Mortality')).toBe(true);
    // equals a direct runMeta over just the mortality studies
    const ref = runMeta(studies.slice(0, 2), 'random');
    expect(pooled.result.k).toBe(2);
    expect(pooled.result.pES).toBeCloseTo(ref.pES, 6);
  });

  it('excludes studies marked out of analysis (P1.17)', () => {
    const studies = [
      S({ outcome: 'X', es: '0.3', lo: '0.1', hi: '0.5' }),
      S({ outcome: 'X', es: '0.4', lo: '0.2', hi: '0.6' }),
      S({ outcome: 'X', es: '5.0', lo: '4.0', hi: '6.0', extractionMeta: { includedInAnalysis: false } }),
    ];
    const pooled = poolPrimaryOutcome(studies, 'random');
    expect(pooled.subset).toHaveLength(2);
  });

  it('threads the τ² estimator', () => {
    const studies = [
      S({ outcome: 'X', es: '0.3', lo: '0.1', hi: '0.9' }),
      S({ outcome: 'X', es: '0.4', lo: '0.2', hi: '1.2' }),
      S({ outcome: 'X', es: '0.5', lo: '0.1', hi: '1.5' }),
    ];
    const dl = poolPrimaryOutcome(studies, 'random', { tau2Method: 'DL' }).result;
    const reml = poolPrimaryOutcome(studies, 'random', { tau2Method: 'REML' }).result;
    expect(dl.tau2Method).toBe('DL');
    expect(reml.tau2Method).toBe('REML');
  });

  it('returns null result for no analyzable studies', () => {
    expect(poolPrimaryOutcome([], 'random').result).toBeNull();
    expect(poolPrimaryOutcome([S({ es: '' })], 'random').result).toBeNull();
  });
});
