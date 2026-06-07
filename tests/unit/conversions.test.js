/**
 * conversions.test.js
 * Unit tests for the CONVERSIONS array in catalogue.js.
 * Tests each conversion recipe's run() function.
 */

import { describe, it, expect } from 'vitest';
import { CONVERSIONS, invNorm } from '../../src/research-engine/conversions/catalogue.js';

// Helper: find a conversion by id
const conv = id => CONVERSIONS.find(c => c.id === id);

// ── Catalogue structure ────────────────────────────────────────────────────────
describe('CONVERSIONS catalogue structure', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(CONVERSIONS)).toBe(true);
    expect(CONVERSIONS.length).toBeGreaterThan(0);
  });

  it('each entry has id, group, label, inputs, method, run', () => {
    CONVERSIONS.forEach(c => {
      expect(typeof c.id).toBe('string');
      expect(typeof c.group).toBe('string');
      expect(typeof c.label).toBe('string');
      expect(Array.isArray(c.inputs)).toBe(true);
      expect(typeof c.method).toBe('string');
      expect(typeof c.run).toBe('function');
    });
  });

  it('all ids are unique', () => {
    const ids = CONVERSIONS.map(c => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ── Re-exported invNorm ───────────────────────────────────────────────────────
describe('invNorm re-export from catalogue', () => {
  it('invNorm(0.975) ≈ 1.96', () => {
    expect(invNorm(0.975)).toBeCloseTo(1.96, 2);
  });
  it('invNorm(0.5) ≈ 0', () => {
    expect(invNorm(0.5)).toBeCloseTo(0, 5);
  });
});

// ── median_iqr ────────────────────────────────────────────────────────────────
describe('median_iqr conversion', () => {
  const c = conv('median_iqr');

  it('exists in catalogue', () => {
    expect(c).toBeDefined();
  });

  it('returns ok:true for valid inputs', () => {
    const res = c.run({ q1: 10, med: 15, q3: 20, n: 50 });
    expect(res.ok).toBe(true);
  });

  it('returns mean and sd values', () => {
    const res = c.run({ q1: 10, med: 15, q3: 20, n: 50 });
    expect(res.values).toHaveProperty('mean');
    expect(res.values).toHaveProperty('sd');
  });

  it('mean ≈ (Q1 + median + Q3) / 3', () => {
    const res = c.run({ q1: 10, med: 15, q3: 20, n: 50 });
    expect(res.values.mean).toBeCloseTo((10 + 15 + 20) / 3, 3);
  });

  it('sd is positive', () => {
    const res = c.run({ q1: 10, med: 15, q3: 20, n: 50 });
    expect(res.values.sd).toBeGreaterThan(0);
  });

  it('returns ok:false when q3 < q1', () => {
    const res = c.run({ q1: 20, med: 15, q3: 10, n: 50 });
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('returns ok:false for n < 2', () => {
    const res = c.run({ q1: 10, med: 15, q3: 20, n: 1 });
    expect(res.ok).toBe(false);
  });

  it('returns ok:false for non-numeric input', () => {
    const res = c.run({ q1: 'x', med: 15, q3: 20, n: 50 });
    expect(res.ok).toBe(false);
  });

  it('returns formula and detail strings', () => {
    const res = c.run({ q1: 10, med: 15, q3: 20, n: 50 });
    expect(typeof res.formula).toBe('string');
    expect(typeof res.detail).toBe('string');
  });
});

// ── median_range ──────────────────────────────────────────────────────────────
describe('median_range conversion', () => {
  const c = conv('median_range');

  it('exists in catalogue', () => {
    expect(c).toBeDefined();
  });

  it('returns ok:true for valid inputs', () => {
    const res = c.run({ min: 5, med: 15, max: 30, n: 50 });
    expect(res.ok).toBe(true);
  });

  it('mean ≈ (min + 2*median + max) / 4', () => {
    const res = c.run({ min: 5, med: 15, max: 30, n: 50 });
    expect(res.values.mean).toBeCloseTo((5 + 2*15 + 30) / 4, 3);
  });

  it('sd is positive', () => {
    const res = c.run({ min: 5, med: 15, max: 30, n: 50 });
    expect(res.values.sd).toBeGreaterThan(0);
  });

  it('returns ok:false when max < min', () => {
    const res = c.run({ min: 30, med: 15, max: 5, n: 50 });
    expect(res.ok).toBe(false);
  });

  it('returns ok:false for n < 2', () => {
    const res = c.run({ min: 5, med: 15, max: 30, n: 1 });
    expect(res.ok).toBe(false);
  });
});

// ── se_sd ─────────────────────────────────────────────────────────────────────
describe('se_sd conversion', () => {
  const c = conv('se_sd');

  it('exists in catalogue', () => {
    expect(c).toBeDefined();
  });

  it('returns ok:true for valid inputs', () => {
    const res = c.run({ se: 0.5, n: 100 });
    expect(res.ok).toBe(true);
  });

  it('sd = se × sqrt(n)', () => {
    const res = c.run({ se: 0.5, n: 100 });
    expect(res.values.sd).toBeCloseTo(0.5 * Math.sqrt(100), 4);
  });

  it('returns ok:false for se < 0', () => {
    const res = c.run({ se: -1, n: 100 });
    expect(res.ok).toBe(false);
  });

  it('returns ok:false for n < 1', () => {
    const res = c.run({ se: 0.5, n: 0 });
    expect(res.ok).toBe(false);
  });
});

// ── ci_sd ─────────────────────────────────────────────────────────────────────
describe('ci_sd conversion', () => {
  const c = conv('ci_sd');

  it('exists in catalogue', () => {
    expect(c).toBeDefined();
  });

  it('returns ok:true for valid inputs', () => {
    const res = c.run({ lo: 10, hi: 20, n: 36 });
    expect(res.ok).toBe(true);
  });

  it('sd = sqrt(n) × (hi - lo) / (2 × 1.96)', () => {
    const res = c.run({ lo: 10, hi: 20, n: 36 });
    const expected = Math.sqrt(36) * (20 - 10) / (2 * 1.96);
    expect(res.values.sd).toBeCloseTo(expected, 3);
  });

  it('returns ok:false when hi < lo', () => {
    const res = c.run({ lo: 20, hi: 10, n: 36 });
    expect(res.ok).toBe(false);
  });

  it('returns ok:false for n < 1', () => {
    const res = c.run({ lo: 10, hi: 20, n: 0 });
    expect(res.ok).toBe(false);
  });
});

// ── pval_se ───────────────────────────────────────────────────────────────────
describe('pval_se conversion', () => {
  const c = conv('pval_se');

  it('exists in catalogue', () => {
    expect(c).toBeDefined();
  });

  it('returns ok:true for valid inputs', () => {
    const res = c.run({ effect: 1.5, p: 0.05 });
    expect(res.ok).toBe(true);
  });

  it('se is positive', () => {
    const res = c.run({ effect: 1.5, p: 0.05 });
    expect(res.values.se).toBeGreaterThan(0);
  });

  it('se = |effect| / z where z = invNorm(1 - p/2)', () => {
    const res = c.run({ effect: 1.5, p: 0.05 });
    // z for p=0.05 two-sided ≈ 1.96
    const z = Math.abs(invNorm(0.05 / 2));
    expect(res.values.se).toBeCloseTo(1.5 / z, 3);
  });

  it('returns ok:false for p <= 0 or p >= 1', () => {
    expect(c.run({ effect: 1.5, p: 0 }).ok).toBe(false);
    expect(c.run({ effect: 1.5, p: 1 }).ok).toBe(false);
  });
});

// ── pct_events ────────────────────────────────────────────────────────────────
describe('pct_events conversion', () => {
  const c = conv('pct_events');

  it('exists in catalogue', () => {
    expect(c).toBeDefined();
  });

  it('events = round(pct / 100 × n)', () => {
    const res = c.run({ pct: 25, n: 100 });
    expect(res.ok).toBe(true);
    expect(res.values.events).toBe(25);
    expect(res.values.total).toBe(100);
  });

  it('rounds non-integer result', () => {
    const res = c.run({ pct: 33.3, n: 100 });
    expect(res.values.events).toBe(33);
  });

  it('returns ok:false for pct > 100', () => {
    expect(c.run({ pct: 110, n: 100 }).ok).toBe(false);
  });

  it('returns ok:false for n < 1', () => {
    expect(c.run({ pct: 50, n: 0 }).ok).toBe(false);
  });
});

// ── events_pct ────────────────────────────────────────────────────────────────
describe('events_pct conversion', () => {
  const c = conv('events_pct');

  it('exists in catalogue', () => {
    expect(c).toBeDefined();
  });

  it('pct = events / n × 100', () => {
    const res = c.run({ events: 30, n: 100 });
    expect(res.ok).toBe(true);
    expect(res.values.pct).toBeCloseTo(30, 2);
  });

  it('returns ok:false when events > n', () => {
    expect(c.run({ events: 110, n: 100 }).ok).toBe(false);
  });

  it('returns ok:false for n < 1', () => {
    expect(c.run({ events: 5, n: 0 }).ok).toBe(false);
  });
});

// ── ratio_log ─────────────────────────────────────────────────────────────────
describe('ratio_log conversion', () => {
  const c = conv('ratio_log');

  it('exists in catalogue', () => {
    expect(c).toBeDefined();
  });

  it('returns ok:true for valid inputs', () => {
    const res = c.run({ est: 2.5, lo: 1.2, hi: 5.2 });
    expect(res.ok).toBe(true);
  });

  it('es = ln(est)', () => {
    const res = c.run({ est: 2.5, lo: 1.2, hi: 5.2 });
    expect(res.values.es).toBeCloseTo(Math.log(2.5), 4);
  });

  it('log CI = [ln(lo), ln(hi)]', () => {
    const res = c.run({ est: 2.5, lo: 1.2, hi: 5.2 });
    expect(res.values.lo).toBeCloseTo(Math.log(1.2), 4);
    expect(res.values.hi).toBeCloseTo(Math.log(5.2), 4);
  });

  it('se = (ln(hi) - ln(lo)) / (2 × 1.96)', () => {
    const res = c.run({ est: 2.5, lo: 1.2, hi: 5.2 });
    const expected = (Math.log(5.2) - Math.log(1.2)) / (2 * 1.96);
    expect(res.values.se).toBeCloseTo(expected, 4);
  });

  it('returns ok:false for non-positive values', () => {
    expect(c.run({ est: 0, lo: 1.2, hi: 5.2 }).ok).toBe(false);
    expect(c.run({ est: -1, lo: 1.2, hi: 5.2 }).ok).toBe(false);
  });

  it('returns ok:false when hi < lo', () => {
    expect(c.run({ est: 2.5, lo: 5.2, hi: 1.2 }).ok).toBe(false);
  });
});

// ── unit_scale ────────────────────────────────────────────────────────────────
describe('unit_scale conversion', () => {
  const c = conv('unit_scale');

  it('exists in catalogue', () => {
    expect(c).toBeDefined();
  });

  it('value = val × factor', () => {
    const res = c.run({ val: 1000, factor: 0.001 });
    expect(res.ok).toBe(true);
    expect(res.values.value).toBeCloseTo(1, 4);
  });

  it('factor of 1 is identity', () => {
    const res = c.run({ val: 42, factor: 1 });
    expect(res.values.value).toBeCloseTo(42, 4);
  });

  it('returns ok:false for non-numeric input', () => {
    expect(c.run({ val: 'x', factor: 2 }).ok).toBe(false);
  });
});
