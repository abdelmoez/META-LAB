/**
 * meta-random-dl.test.js — golden tests for the DerSimonian–Laird random-effects
 * model, its τ² estimator, HKSJ adjustment, and prediction interval.
 *
 * Anchored to hand-computed values (HC3) and a metafor-pinned pooled estimate
 * (D14 DL pooled = 0.6137). Tolerances documented in statistical-validation.md §11.
 */
import { describe, it, expect } from 'vitest';
import { runMeta } from '../../../src/research-engine/statistics/meta-analysis.js';
import { HC3, D14, Z975 } from '../../fixtures/meta/canonical.js';

describe('random-effects DL pooling (golden, hand-computed)', () => {
  it('HC3: DL random ES = 0.5, SE = sqrt(1/18.75), τ² = 0.15', () => {
    const r = runMeta(HC3.studies, 'random');
    expect(r.method).toBe('random');
    expect(r.pES).toBeCloseTo(HC3.randomES, 9);
    expect(r.pSE).toBeCloseTo(HC3.randomSE, 9);
    expect(r.tau2).toBeCloseTo(HC3.tau2, 9);
    expect(r.tau).toBeCloseTo(HC3.tau, 9);
  });

  it('HC3: z statistic = ES/SE = 2.16506…', () => {
    const r = runMeta(HC3.studies, 'random');
    expect(r.z).toBeCloseTo(HC3.zRandom, 9);
    // p = 2(1−Φ(z)) for z≈2.165 → ≈0.0304
    expect(r.pval).toBeCloseTo(0.0304, 3);
  });

  it('HC3: random CI is wider than fixed CI (τ² > 0)', () => {
    const r = runMeta(HC3.studies, 'random');
    const fixedW = r.fixed.hi - r.fixed.lo;
    const randW = r.random.hi - r.random.lo;
    expect(randW).toBeGreaterThan(fixedW);
  });

  it('DL τ² equals an independent reimplementation of the DL estimator', () => {
    // Independent reference: τ² = max(0,(Q−(k−1))/(W−W²/W)), Q from fixed mean.
    const ref = (studies) => {
      const w = studies.map(s => 1 / (((+s.hi - +s.lo) / (2 * Z975)) ** 2));
      const y = studies.map(s => +s.es);
      const W = w.reduce((a, b) => a + b, 0);
      const W2 = w.reduce((a, b) => a + b * b, 0);
      const mu = w.reduce((a, wi, i) => a + wi * y[i], 0) / W;
      const Q = w.reduce((a, wi, i) => a + wi * (y[i] - mu) ** 2, 0);
      return Math.max(0, (Q - (studies.length - 1)) / (W - W2 / W));
    };
    const r = runMeta(HC3.studies, 'random');
    expect(r.tau2).toBeCloseTo(ref(HC3.studies), 12);
  });

  it('HKSJ adjustment: HC3 seHK = randomSE, t = 2.16506…, df = 2', () => {
    const r = runMeta(HC3.studies, 'random');
    expect(r.hksj).not.toBeNull();
    expect(r.hksj.se).toBeCloseTo(HC3.hksjSE, 9);
    expect(r.hksj.t).toBeCloseTo(HC3.hksjT, 9);
    expect(r.hksj.df).toBe(HC3.hksjDf);
    // t-based CI must be wider than the normal-based random CI (t₂ > z).
    expect(r.hksj.hi - r.hksj.lo).toBeGreaterThan(r.random.hi - r.random.lo);
  });

  it('prediction interval present for k≥3 and wider than the CI', () => {
    const r = runMeta(HC3.studies, 'random');
    expect(r.predInt).not.toBeNull();
    expect(r.predInt.hi - r.predInt.lo).toBeGreaterThan(r.random.hi - r.random.lo);
  });

  it('D14: DL pooled estimate matches metafor::rma(method="DL") ≈ 0.6137', () => {
    const r = runMeta(D14.studies, 'random');
    expect(r.pES).toBeCloseTo(D14.dlPooled, 3);
  });
});
