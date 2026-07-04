/**
 * tau2.test.js — RoadMap/2.md between-study variance estimators.
 *
 * Verification strategy (stronger than matching a rounded published number):
 *  - DL is tied to the already-metafor-validated runMeta (bit-for-bit).
 *  - PM is checked against its DEFINING equation Q(τ²) = k−1 (exact).
 *  - ML/REML are checked at their fixed points (plug the estimate back → unchanged).
 *  - HO/HS/SJ closed forms are checked against hand computation.
 *  - Fallback + degenerate behaviours are asserted explicitly.
 */
import { describe, it, expect } from 'vitest';
import {
  estimateTau2, tau2DL, tau2HO, tau2HS, tau2SJ, tau2PM, tau2Iterative,
  TAU2_METHODS, TAU2_LABELS,
} from '../../../src/research-engine/statistics/tau2.js';
import { runMeta } from '../../../src/research-engine/statistics/meta-analysis.js';

// A heterogeneous set of log-effects with distinct variances.
const y = [0.30, 0.55, -0.10, 0.80, 0.20, 0.65];
const v = [0.04, 0.09, 0.06, 0.12, 0.05, 0.08];
const k = y.length;

const wmean = (yy, w) => { let sw = 0, swy = 0; for (let i = 0; i < yy.length; i++) { sw += w[i]; swy += w[i] * yy[i]; } return swy / sw; };

describe('tau2 estimators', () => {
  it('exposes all eight methods with labels', () => {
    expect(TAU2_METHODS).toEqual(['DL', 'REML', 'ML', 'PM', 'EB', 'SJ', 'HO', 'HS']);
    TAU2_METHODS.forEach((m) => expect(typeof TAU2_LABELS[m]).toBe('string'));
  });

  it('DL closed form matches the metafor-validated runMeta τ² (bit-for-bit)', () => {
    // Build studies with es/lo/hi so runMeta derives exactly v = ((hi-lo)/(2*Z975))².
    const Z = 1.959963984540054;
    const studies = y.map((yi, i) => {
      const se = Math.sqrt(v[i]);
      return { id: `s${i}`, es: String(yi), lo: String(yi - Z * se), hi: String(yi + Z * se), esType: 'SMD' };
    });
    const rm = runMeta(studies, 'random');
    expect(tau2DL(y, v)).toBeCloseTo(rm.random.tau2, 12);
    expect(estimateTau2(y, v, { method: 'DL' }).tau2).toBeCloseTo(rm.random.tau2, 12);
  });

  it('PM satisfies its defining equation Q(τ²) = k−1', () => {
    const { tau2 } = estimateTau2(y, v, { method: 'PM' });
    const w = v.map((x) => 1 / (x + tau2));
    const mu = wmean(y, w);
    let Q = 0;
    for (let i = 0; i < k; i++) Q += w[i] * (y[i] - mu) ** 2;
    expect(Q).toBeCloseTo(k - 1, 6);
  });

  it('EB equals PM (Morris ≡ Paule–Mandel)', () => {
    expect(estimateTau2(y, v, { method: 'EB' }).tau2).toBeCloseTo(estimateTau2(y, v, { method: 'PM' }).tau2, 10);
  });

  it('ML is a fixed point of the ML update', () => {
    const t = estimateTau2(y, v, { method: 'ML' }).tau2;
    const step = tau2Iterative(y, v, 'ML', t, 1, 0).tau2; // one update from the solution
    expect(step).toBeCloseTo(t, 6);
  });

  it('REML is a fixed point of the REML update and exceeds ML', () => {
    const tR = estimateTau2(y, v, { method: 'REML' }).tau2;
    const step = tau2Iterative(y, v, 'REML', tR, 1, 0).tau2;
    expect(step).toBeCloseTo(tR, 6);
    const tM = estimateTau2(y, v, { method: 'ML' }).tau2;
    expect(tR).toBeGreaterThan(tM - 1e-9); // REML applies the df correction upward
  });

  it('HO matches its hand formula: s²/(k−1) − v̄', () => {
    const ybar = y.reduce((a, b) => a + b, 0) / k;
    const s2 = y.reduce((a, yi) => a + (yi - ybar) ** 2, 0) / (k - 1);
    const vbar = v.reduce((a, b) => a + b, 0) / k;
    expect(tau2HO(y, v)).toBeCloseTo(s2 - vbar, 12);
  });

  it('HS matches (Q − k)/ΣW', () => {
    const w = v.map((x) => 1 / x);
    const S1 = w.reduce((a, b) => a + b, 0);
    const mu = wmean(y, w);
    let Q = 0; for (let i = 0; i < k; i++) Q += w[i] * (y[i] - mu) ** 2;
    expect(tau2HS(y, v)).toBeCloseTo((Q - k) / S1, 12);
  });

  it('SJ is strictly positive on heterogeneous data', () => {
    expect(tau2SJ(y, v)).toBeGreaterThan(0);
    expect(estimateTau2(y, v, { method: 'SJ' }).tau2).toBeGreaterThan(0);
  });

  it('all estimators are finite, non-negative, and reasonably close on this data', () => {
    const vals = TAU2_METHODS.map((m) => estimateTau2(y, v, { method: m }).tau2);
    vals.forEach((t) => { expect(Number.isFinite(t)).toBe(true); expect(t).toBeGreaterThanOrEqual(0); });
    // They should agree to within a factor on a well-behaved dataset (sanity, not exact).
    const max = Math.max(...vals), min = Math.min(...vals.filter((x) => x > 0));
    expect(max).toBeLessThan(min * 8 + 0.05);
  });

  it('homogeneous data drives every estimator to ~0', () => {
    const yh = [0.5, 0.5, 0.5, 0.5, 0.5];
    const vh = [0.05, 0.06, 0.04, 0.05, 0.07];
    TAU2_METHODS.forEach((m) => {
      expect(estimateTau2(yh, vh, { method: m }).tau2).toBeLessThan(1e-6);
    });
  });

  it('iterative estimators fall back to DL for k < 3', () => {
    const y2 = [0.3, 0.6], v2 = [0.04, 0.09];
    ['REML', 'ML', 'PM', 'EB'].forEach((m) => {
      const r = estimateTau2(y2, v2, { method: m });
      expect(r.fallback).toBe('DL');
      expect(r.tau2).toBeCloseTo(tau2DL(y2, v2), 12);
    });
  });

  it('guards k<2 / non-positive variance', () => {
    expect(estimateTau2([0.3], [0.04], { method: 'REML' }).tau2).toBe(0);
    expect(estimateTau2([0.3, 0.5], [0, 0.04], { method: 'PM' }).tau2).toBe(0);
  });

  it('PM returns 0 when studies are under-dispersed (F(0) ≤ 0)', () => {
    // Effects tighter than their SEs imply → no excess heterogeneity.
    const yu = [0.40, 0.42, 0.39, 0.41];
    const vu = [0.20, 0.20, 0.20, 0.20];
    expect(tau2PM(yu, vu).tau2).toBe(0);
  });
});
