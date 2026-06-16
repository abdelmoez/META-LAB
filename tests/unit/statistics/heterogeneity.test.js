/**
 * heterogeneity.test.js — golden tests for Cochran's Q, I², and the Q p-value.
 * Anchored to hand-computed values (HC2, HC3). Tolerances in
 * statistical-validation.md §11.
 */
import { describe, it, expect } from 'vitest';
import { runMeta } from '../../../src/research-engine/statistics/meta-analysis.js';
import { chiSquareCDF } from '../../../src/research-engine/statistics/math-helpers.js';
import { HC2, HC3, Z975 } from '../../fixtures/meta/canonical.js';

describe('heterogeneity statistics (golden, hand-computed)', () => {
  it('HC2: Q = 0.80, I² = 0 (Q < df), τ² = 0', () => {
    const r = runMeta(HC2.studies);
    expect(r.Q).toBeCloseTo(HC2.Q, 9);
    expect(r.I2).toBeCloseTo(HC2.I2, 9);
    expect(r.tau2).toBeCloseTo(HC2.tau2, 9);
  });

  it('HC3: Q = 32, I² = 93.75%, τ² = 0.15', () => {
    const r = runMeta(HC3.studies);
    expect(r.Q).toBeCloseTo(HC3.Q, 9);
    expect(r.I2).toBeCloseTo(HC3.I2, 9);
    expect(r.tau2).toBeCloseTo(HC3.tau2, 9);
  });

  it('HC3: I²=93.75 → "considerable" band', () => {
    const r = runMeta(HC3.studies);
    expect(r.I2desc).toBe('considerable');
  });

  it('Qpval = 1 − χ²CDF(Q, k−1) — matches an independent χ² evaluation', () => {
    const r = runMeta(HC3.studies);
    expect(r.Qpval).toBeCloseTo(1 - chiSquareCDF(HC3.Q, HC3.studies.length - 1), 9);
    // Q=32 on df=2 is extreme → tiny p.
    expect(r.Qpval).toBeLessThan(0.001);
  });

  it('Q equals an independent Σ w(y−μ)² reimplementation', () => {
    const ref = (studies) => {
      const w = studies.map(s => 1 / (((+s.hi - +s.lo) / (2 * Z975)) ** 2));
      const y = studies.map(s => +s.es);
      const W = w.reduce((a, b) => a + b, 0);
      const mu = w.reduce((a, wi, i) => a + wi * y[i], 0) / W;
      return w.reduce((a, wi, i) => a + wi * (y[i] - mu) ** 2, 0);
    };
    expect(runMeta(HC2.studies).Q).toBeCloseTo(ref(HC2.studies), 12);
    expect(runMeta(HC3.studies).Q).toBeCloseTo(ref(HC3.studies), 12);
  });
});
