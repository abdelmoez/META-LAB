/**
 * effect-sizes.test.js
 * Unit tests for calcES — all supported effect measure types.
 */

import { describe, it, expect } from 'vitest';
import { calcES } from '../../src/research-engine/effect-sizes/calculators.js';

// Helper to check a result has the standard shape
function expectValidResult(res) {
  expect(res).not.toBeNull();
  expect(typeof res.es).toBe('number');
  expect(typeof res.se).toBe('number');
  expect(typeof res.lo).toBe('number');
  expect(typeof res.hi).toBe('number');
  expect(res.se).toBeGreaterThan(0);
  expect(res.lo).toBeLessThan(res.hi);
}

// ── SMD (Hedges' g / Cohen's d) ───────────────────────────────────────────────
describe('calcES SMD', () => {
  // Hand-worked: poolSD = sqrt(((9*4)+(9*9))/18) = sqrt((36+81)/18) = sqrt(6.5) ≈ 2.550
  // d = (10-8)/2.550 ≈ 0.7845
  const params = { n1: 10, n2: 10, m1: 10, m2: 8, sd1: 2, sd2: 3 };

  it('returns a valid result object', () => {
    expectValidResult(calcES('SMD', params));
  });

  it('effect size has correct sign (m1 > m2 → positive d)', () => {
    const res = calcES('SMD', params);
    expect(res.es).toBeGreaterThan(0);
  });

  it('es is on Cohen d scale (reasonable magnitude)', () => {
    const res = calcES('SMD', params);
    expect(res.es).toBeGreaterThan(0.5);
    expect(res.es).toBeLessThan(2);
  });

  it('zero difference → es = 0', () => {
    const res = calcES('SMD', { n1: 10, n2: 10, m1: 5, m2: 5, sd1: 2, sd2: 2 });
    expect(res.es).toBeCloseTo(0, 4);
  });

  it('negative difference → negative es', () => {
    const res = calcES('SMD', { n1: 10, n2: 10, m1: 5, m2: 8, sd1: 2, sd2: 2 });
    expect(res.es).toBeLessThan(0);
  });

  it('returns null when n1 < 2', () => {
    expect(calcES('SMD', { n1: 1, n2: 10, m1: 5, m2: 3, sd1: 2, sd2: 2 })).toBeNull();
  });

  it('returns null when n2 < 2', () => {
    expect(calcES('SMD', { n1: 10, n2: 1, m1: 5, m2: 3, sd1: 2, sd2: 2 })).toBeNull();
  });

  it('returns null when sd1 is missing', () => {
    expect(calcES('SMD', { n1: 10, n2: 10, m1: 5, m2: 3, sd2: 2 })).toBeNull();
  });

  it('returns null for non-numeric params', () => {
    expect(calcES('SMD', { n1: 'a', n2: 10, m1: 5, m2: 3, sd1: 2, sd2: 2 })).toBeNull();
  });
});

// ── MD (raw mean difference) ───────────────────────────────────────────────────
describe('calcES MD', () => {
  const params = { n1: 20, n2: 20, m1: 15, m2: 10, sd1: 3, sd2: 4 };

  it('returns a valid result object', () => {
    expectValidResult(calcES('MD', params));
  });

  it('es equals m1 - m2', () => {
    const res = calcES('MD', params);
    expect(res.es).toBeCloseTo(15 - 10, 4);
  });

  it('larger SDs give wider CI', () => {
    const narrow = calcES('MD', { ...params, sd1: 1, sd2: 1 });
    const wide   = calcES('MD', { ...params, sd1: 5, sd2: 5 });
    expect(wide.hi - wide.lo).toBeGreaterThan(narrow.hi - narrow.lo);
  });

  it('returns null for n < 2', () => {
    expect(calcES('MD', { ...params, n1: 1 })).toBeNull();
  });
});

// ── OR (Odds Ratio on log scale) ───────────────────────────────────────────────
describe('calcES OR', () => {
  // 2×2 table: a=40 b=60 c=20 d=80
  // OR = (40*80)/(60*20) = 3200/1200 ≈ 2.667 → lnOR ≈ 0.9808
  const params = { a: 40, b: 60, c: 20, d: 80 };

  it('returns a valid result object', () => {
    expectValidResult(calcES('OR', params));
  });

  it('es equals ln(OR)', () => {
    const res = calcES('OR', params);
    const expected = Math.log((40 * 80) / (60 * 20));
    expect(res.es).toBeCloseTo(expected, 4);
  });

  it('has display property with OR= prefix', () => {
    const res = calcES('OR', params);
    expect(res.display).toMatch(/^OR=/);
  });

  it('se is correct: sqrt(1/a + 1/b + 1/c + 1/d)', () => {
    const res = calcES('OR', params);
    const expected = Math.sqrt(1/40 + 1/60 + 1/20 + 1/80);
    expect(res.se).toBeCloseTo(expected, 4);
  });

  it('returns null when any cell is 0 or negative', () => {
    expect(calcES('OR', { a: 0, b: 60, c: 20, d: 80 })).toBeNull();
    expect(calcES('OR', { a: 40, b: -1, c: 20, d: 80 })).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(calcES('OR', { a: 'x', b: 60, c: 20, d: 80 })).toBeNull();
  });

  it('equal odds → es = 0', () => {
    // a/b == c/d → OR = 1 → lnOR = 0
    const res = calcES('OR', { a: 50, b: 50, c: 50, d: 50 });
    expect(res.es).toBeCloseTo(0, 4);
  });
});

// ── RR (Risk Ratio on log scale) ───────────────────────────────────────────────
describe('calcES RR', () => {
  // a=30 b=70 c=10 d=90  → risk_exp = 30/100 = 0.3, risk_ctrl = 10/100 = 0.1
  // RR = 0.3/0.1 = 3 → lnRR = ln(3) ≈ 1.0986
  const params = { a: 30, b: 70, c: 10, d: 90 };

  it('returns a valid result object', () => {
    expectValidResult(calcES('RR', params));
  });

  it('es equals ln(RR)', () => {
    const res = calcES('RR', params);
    const riskExp  = 30 / (30 + 70);
    const riskCtrl = 10 / (10 + 90);
    const expected = Math.log(riskExp / riskCtrl);
    expect(res.es).toBeCloseTo(expected, 4);
  });

  it('has display property with RR= prefix', () => {
    const res = calcES('RR', params);
    expect(res.display).toMatch(/^RR=/);
  });

  it('equal risks → es = 0', () => {
    const res = calcES('RR', { a: 50, b: 50, c: 50, d: 50 });
    expect(res.es).toBeCloseTo(0, 4);
  });

  it('returns null when any cell <= 0', () => {
    expect(calcES('RR', { a: 0, b: 70, c: 10, d: 90 })).toBeNull();
  });
});

// ── HR (Hazard Ratio on log scale, from reported CI) ──────────────────────────
describe('calcES HR', () => {
  // HR = 2.0, 95% CI [1.2, 3.3] → lnHR = ln(2) ≈ 0.6931
  const params = { hr: 2.0, lo: 1.2, hi: 3.3 };

  it('returns a valid result object', () => {
    expectValidResult(calcES('HR', params));
  });

  it('es equals ln(hr)', () => {
    const res = calcES('HR', params);
    expect(res.es).toBeCloseTo(Math.log(2.0), 4);
  });

  it('se derived from log-scale CI width', () => {
    const res = calcES('HR', params);
    const expected = (Math.log(3.3) - Math.log(1.2)) / (2 * 1.96);
    expect(res.se).toBeCloseTo(expected, 4);
  });

  it('has display property with HR= prefix', () => {
    const res = calcES('HR', params);
    expect(res.display).toMatch(/^HR=/);
  });

  it('HR = 1 → es = 0', () => {
    const res = calcES('HR', { hr: 1.0, lo: 0.5, hi: 2.0 });
    expect(res.es).toBeCloseTo(0, 4);
  });

  it('returns null when HR <= 0', () => {
    expect(calcES('HR', { hr: 0, lo: 1.2, hi: 3.3 })).toBeNull();
    expect(calcES('HR', { hr: -1, lo: 1.2, hi: 3.3 })).toBeNull();
  });

  it('returns null when lo or hi <= 0', () => {
    expect(calcES('HR', { hr: 2.0, lo: 0, hi: 3.3 })).toBeNull();
  });
});

// ── COR (Pearson correlation as Fisher z) ─────────────────────────────────────
describe('calcES COR', () => {
  // r = 0.5, n = 50 → z = 0.5 * ln((1.5)/(0.5)) = 0.5 * ln(3) ≈ 0.5493
  const params = { r: 0.5, n: 50 };

  it('returns a valid result object', () => {
    expectValidResult(calcES('COR', params));
  });

  it('es equals Fisher z-transformation of r', () => {
    const res = calcES('COR', params);
    const expected = 0.5 * Math.log((1 + 0.5) / (1 - 0.5));
    expect(res.es).toBeCloseTo(expected, 4);
  });

  it('se = 1 / sqrt(n - 3)', () => {
    const res = calcES('COR', params);
    expect(res.se).toBeCloseTo(1 / Math.sqrt(50 - 3), 4);
  });

  it('r = 0 → es = 0', () => {
    const res = calcES('COR', { r: 0, n: 50 });
    expect(res.es).toBeCloseTo(0, 4);
  });

  it('returns null for |r| >= 1', () => {
    expect(calcES('COR', { r: 1, n: 50 })).toBeNull();
    expect(calcES('COR', { r: -1, n: 50 })).toBeNull();
    expect(calcES('COR', { r: 1.5, n: 50 })).toBeNull();
  });

  it('returns null for n < 4', () => {
    expect(calcES('COR', { r: 0.5, n: 3 })).toBeNull();
  });

  it('negative correlation → negative Fisher z', () => {
    const res = calcES('COR', { r: -0.5, n: 50 });
    expect(res.es).toBeLessThan(0);
  });
});

// ── PROP (single-arm proportion on logit scale) ───────────────────────────────
describe('calcES PROP', () => {
  // events=30, total=100 → p=0.3; logit = ln(0.3/0.7) ≈ -0.847
  const params = { events: 30, total: 100 };

  it('returns a valid result object', () => {
    expectValidResult(calcES('PROP', params));
  });

  it('es equals logit of proportion', () => {
    const res = calcES('PROP', params);
    const p = 30 / 100;
    const expected = Math.log(p / (1 - p));
    expect(res.es).toBeCloseTo(expected, 4);
  });

  it('p = 0.5 → logit = 0', () => {
    const res = calcES('PROP', { events: 50, total: 100 });
    expect(res.es).toBeCloseTo(0, 4);
  });

  it('applies continuity correction when events = 0', () => {
    const res = calcES('PROP', { events: 0, total: 100 });
    expect(res).not.toBeNull();
    // With correction: ev=0.5, tot=101, p=0.5/101
    const p = 0.5 / 101;
    const expected = Math.log(p / (1 - p));
    expect(res.es).toBeCloseTo(expected, 3);
  });

  it('applies continuity correction when events = total', () => {
    const res = calcES('PROP', { events: 100, total: 100 });
    expect(res).not.toBeNull();
  });

  it('returns null when events > total', () => {
    expect(calcES('PROP', { events: 110, total: 100 })).toBeNull();
  });

  it('returns null when total < 1', () => {
    expect(calcES('PROP', { events: 0, total: 0 })).toBeNull();
  });

  it('has display property', () => {
    const res = calcES('PROP', params);
    expect(res.display).toBeDefined();
    expect(typeof res.display).toBe('string');
  });
});

// ── DIAG (Diagnostic Odds Ratio on log scale) ─────────────────────────────────
describe('calcES DIAG', () => {
  // TP=80, FP=10, FN=20, TN=90
  // DOR = (TP*TN)/(FP*FN) = (80*90)/(10*20) = 7200/200 = 36 → lnDOR = ln(36) ≈ 3.584
  const params = { tp: 80, fp: 10, fn: 20, tn: 90 };

  it('returns a valid result object', () => {
    expectValidResult(calcES('DIAG', params));
  });

  it('es equals ln(DOR)', () => {
    const res = calcES('DIAG', params);
    const expected = Math.log((80 * 90) / (10 * 20));
    expect(res.es).toBeCloseTo(expected, 4);
  });

  it('has display property with Sens and Spec', () => {
    const res = calcES('DIAG', params);
    expect(res.display).toMatch(/Sens=/);
    expect(res.display).toMatch(/Spec=/);
  });

  it('applies Haldane correction when any cell is 0', () => {
    // With TP=0: all cells get +0.5
    const res = calcES('DIAG', { tp: 0, fp: 10, fn: 20, tn: 90 });
    expect(res).not.toBeNull();
    const expected = Math.log((0.5 * 90.5) / (10.5 * 20.5));
    expect(res.es).toBeCloseTo(expected, 3);
  });

  it('returns null for negative cell counts', () => {
    expect(calcES('DIAG', { tp: -1, fp: 10, fn: 20, tn: 90 })).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(calcES('DIAG', { tp: 'x', fp: 10, fn: 20, tn: 90 })).toBeNull();
  });
});

// ── Unknown type ───────────────────────────────────────────────────────────────
describe('calcES unknown type', () => {
  it('returns null for an unknown type string', () => {
    expect(calcES('UNKNOWN', { a: 10, b: 10 })).toBeNull();
  });

  it('returns null for undefined type', () => {
    expect(calcES(undefined, {})).toBeNull();
  });
});
