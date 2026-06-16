/**
 * egger.test.js — golden test for Egger's regression test, pinned to
 * R metafor::regtest(model="lm") on the 14-study Cohen's d fixture (D14).
 *
 * The engine uses canonical UNWEIGHTED OLS of y=ES/SE on x=1/SE; the intercept
 * is Egger's bias coefficient. metafor reference: intercept ≈ 1.86, t ≈ 1.01,
 * p ≈ 0.334. (A previous weighted variant gave 3.94/1.42/0.181 — guarded against.)
 */
import { describe, it, expect } from 'vitest';
import { eggersTest } from '../../../src/research-engine/statistics/meta-analysis.js';
import { D14 } from '../../fixtures/meta/canonical.js';

describe("Egger's test (golden, metafor-pinned)", () => {
  it('D14: matches metafor::regtest(model="lm")', () => {
    const r = eggersTest(D14.studies);
    expect(r.k).toBe(14);
    expect(r.dof).toBe(12);
    expect(r.intercept).toBeCloseTo(D14.eggerIntercept, 1);
    expect(r.t).toBeCloseTo(D14.eggerT, 1);
    expect(r.pval).toBeCloseTo(D14.eggerP, 2);
  });

  it('does not regress to the old weighted numbers (intercept < 2.5, p > 0.28)', () => {
    const r = eggersTest(D14.studies);
    expect(r.intercept).toBeLessThan(2.5);
    expect(r.pval).toBeGreaterThan(0.28);
  });

  it('returns null for k < 3', () => {
    expect(eggersTest(D14.studies.slice(0, 2))).toBeNull();
  });
});
