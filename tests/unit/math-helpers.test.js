/**
 * math-helpers.test.js
 * Unit tests for low-level mathematical utilities in math-helpers.js
 */

import { describe, it, expect } from 'vitest';
import {
  normalCDF,
  chiSquareCDF,
  tCDF,
  tCrit,
  invNorm,
  Z975,
  lgamma,
  ibeta,
  gammp,
  invNormAbs,
} from '../../src/research-engine/statistics/math-helpers.js';

// ── Z975 constant ─────────────────────────────────────────────────────────────
describe('Z975', () => {
  it('is approximately 1.96', () => {
    expect(Z975).toBeCloseTo(1.96, 2);
  });
  it('is the exact 97.5th percentile of the standard normal', () => {
    expect(Z975).toBeCloseTo(1.959963984540054, 10);
  });
});

// ── normalCDF ─────────────────────────────────────────────────────────────────
describe('normalCDF', () => {
  it('normalCDF(0) === 0.5', () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 5);
  });
  it('normalCDF(1.96) ≈ 0.975', () => {
    expect(normalCDF(1.96)).toBeCloseTo(0.975, 3);
  });
  it('normalCDF(-1.96) ≈ 0.025', () => {
    expect(normalCDF(-1.96)).toBeCloseTo(0.025, 3);
  });
  it('normalCDF(1.645) ≈ 0.95', () => {
    expect(normalCDF(1.645)).toBeCloseTo(0.95, 2);
  });
  it('normalCDF(3) ≈ 0.9987', () => {
    expect(normalCDF(3)).toBeCloseTo(0.9987, 3);
  });
  it('normalCDF(-3) ≈ 0.0013', () => {
    expect(normalCDF(-3)).toBeCloseTo(0.0013, 3);
  });
  it('is symmetric: normalCDF(x) + normalCDF(-x) === 1', () => {
    expect(normalCDF(1.5) + normalCDF(-1.5)).toBeCloseTo(1, 5);
  });
  it('returns values between 0 and 1 for large positive z', () => {
    const v = normalCDF(10);
    expect(v).toBeGreaterThan(0.999);
    expect(v).toBeLessThanOrEqual(1);
  });
  it('returns values between 0 and 1 for large negative z', () => {
    const v = normalCDF(-10);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(0.001);
  });
});

// ── invNorm ───────────────────────────────────────────────────────────────────
describe('invNorm', () => {
  it('invNorm(0.5) === 0', () => {
    expect(invNorm(0.5)).toBeCloseTo(0, 5);
  });
  it('invNorm(0.975) ≈ 1.96', () => {
    expect(invNorm(0.975)).toBeCloseTo(1.96, 2);
  });
  it('invNorm(0.025) ≈ -1.96', () => {
    expect(invNorm(0.025)).toBeCloseTo(-1.96, 2);
  });
  it('invNorm(0) returns NaN', () => {
    expect(invNorm(0)).toBeNaN();
  });
  it('invNorm(1) returns NaN', () => {
    expect(invNorm(1)).toBeNaN();
  });
  it('invNorm(-0.1) returns NaN', () => {
    expect(invNorm(-0.1)).toBeNaN();
  });
  it('is the inverse of normalCDF (round trip)', () => {
    const z = 1.23;
    expect(invNorm(normalCDF(z))).toBeCloseTo(z, 4);
  });
  it('invNorm(0.95) ≈ 1.645', () => {
    expect(invNorm(0.95)).toBeCloseTo(1.645, 2);
  });
});

// ── invNormAbs ────────────────────────────────────────────────────────────────
describe('invNormAbs', () => {
  it('invNormAbs(0.975) returns exact value ≈ 1.96', () => {
    expect(invNormAbs(0.975)).toBeCloseTo(1.96, 2);
  });
  it('invNormAbs(0.95) returns exact value ≈ 1.645', () => {
    expect(invNormAbs(0.95)).toBeCloseTo(1.645, 2);
  });
});

// ── lgamma ────────────────────────────────────────────────────────────────────
describe('lgamma', () => {
  it('lgamma(1) ≈ 0 (log(0!) = log(1) = 0)', () => {
    expect(lgamma(1)).toBeCloseTo(0, 4);
  });
  it('lgamma(2) ≈ 0 (log(1!) = 0)', () => {
    expect(lgamma(2)).toBeCloseTo(0, 4);
  });
  it('lgamma(3) ≈ log(2) ≈ 0.693', () => {
    expect(lgamma(3)).toBeCloseTo(Math.log(2), 4);
  });
  it('lgamma(5) ≈ log(24) ≈ 3.178', () => {
    expect(lgamma(5)).toBeCloseTo(Math.log(24), 3);
  });
});

// ── gammp ─────────────────────────────────────────────────────────────────────
describe('gammp', () => {
  it('gammp(a, 0) === 0', () => {
    expect(gammp(2, 0)).toBe(0);
  });
  it('gammp(1, large x) approaches 1', () => {
    expect(gammp(1, 100)).toBeCloseTo(1, 5);
  });
  it('gammp(2, 2) ≈ 0.594', () => {
    // P(2, 2) = 1 - e^{-2}(1 + 2) = 1 - 3e^{-2} ≈ 0.594
    expect(gammp(2, 2)).toBeCloseTo(1 - 3 * Math.exp(-2), 3);
  });
});

// ── chiSquareCDF ──────────────────────────────────────────────────────────────
describe('chiSquareCDF', () => {
  it('chiSquareCDF(x <= 0, df) === 0', () => {
    expect(chiSquareCDF(0, 3)).toBe(0);
    expect(chiSquareCDF(-1, 3)).toBe(0);
  });
  it('chiSquareCDF(3.841, 1) ≈ 0.95 (standard chi-sq critical value)', () => {
    expect(chiSquareCDF(3.841, 1)).toBeCloseTo(0.95, 2);
  });
  it('chiSquareCDF(5.991, 2) ≈ 0.95', () => {
    expect(chiSquareCDF(5.991, 2)).toBeCloseTo(0.95, 2);
  });
  it('chiSquareCDF(7.815, 3) ≈ 0.95', () => {
    expect(chiSquareCDF(7.815, 3)).toBeCloseTo(0.95, 2);
  });
  it('p-value from chi-sq: 1 - chiSquareCDF(large, df) → near 0', () => {
    expect(1 - chiSquareCDF(50, 2)).toBeCloseTo(0, 4);
  });
});

// ── tCDF ──────────────────────────────────────────────────────────────────────
describe('tCDF', () => {
  it('tCDF(0, df) ≈ 0.5 (median of t distribution)', () => {
    expect(tCDF(0, 10)).toBeCloseTo(0.5, 4);
  });
  it('tCDF for large df approaches normalCDF', () => {
    // With df=1000, t(1.96) ≈ normal(1.96) ≈ 0.975
    expect(tCDF(1.96, 1000)).toBeCloseTo(0.975, 2);
  });
  it('tCDF(2.571, 5) ≈ 0.975 (df=5, two-tailed 95%)', () => {
    // t-critical for 5 df at 0.975 is ~2.571
    expect(tCDF(2.571, 5)).toBeCloseTo(0.975, 2);
  });
  it('tCDF is symmetric: tCDF(-t, df) = 1 - tCDF(t, df)', () => {
    expect(tCDF(-1.5, 10)).toBeCloseTo(1 - tCDF(1.5, 10), 5);
  });
});

// ── tCrit ─────────────────────────────────────────────────────────────────────
describe('tCrit', () => {
  it('tCrit(0.95, Infinity) ≈ 1.96 (falls back to normal)', () => {
    expect(tCrit(0.95, Infinity)).toBeCloseTo(1.96, 2);
  });
  it('tCrit(0.95, 0) ≈ 1.96 (df <= 0 falls back to normal)', () => {
    expect(tCrit(0.95, 0)).toBeCloseTo(1.96, 2);
  });
  it('tCrit(0.95, 5) ≈ 2.571', () => {
    expect(tCrit(0.95, 5)).toBeCloseTo(2.571, 2);
  });
  it('tCrit(0.95, 10) ≈ 2.228', () => {
    expect(tCrit(0.95, 10)).toBeCloseTo(2.228, 2);
  });
  it('tCrit(0.95, 30) ≈ 2.042', () => {
    expect(tCrit(0.95, 30)).toBeCloseTo(2.042, 2);
  });
  it('tCrit is larger than z for finite df', () => {
    expect(tCrit(0.95, 10)).toBeGreaterThan(1.96);
  });
  it('tCrit increases as df decreases', () => {
    expect(tCrit(0.95, 5)).toBeGreaterThan(tCrit(0.95, 10));
    expect(tCrit(0.95, 10)).toBeGreaterThan(tCrit(0.95, 30));
  });
  it('tCrit round-trip: tCDF(tCrit(0.95, df), df) ≈ 0.975', () => {
    const t = tCrit(0.95, 8);
    expect(tCDF(t, 8)).toBeCloseTo(0.975, 3);
  });
});
