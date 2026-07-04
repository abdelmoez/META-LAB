/**
 * effectMeasures.test.js — RoadMap/2.md. New effect measures via calcES:
 * Peto OR, IRR, AUC, BETA, Generic/Generic-log, plus a RD regression check.
 * Values are cross-checked against hand computation (arithmetic in the test).
 */
import { describe, it, expect } from 'vitest';
import { calcES } from '../../../src/research-engine/statistics/monolithStats.js';
import { ES_TYPES } from '../../../src/research-engine/project-model/monolithConstants.js';

describe('ES_TYPES additions', () => {
  it('registers the new measures with sane scale flags', () => {
    expect(ES_TYPES.PETO).toMatchObject({ log: true, scale: 'lnOR' });
    expect(ES_TYPES.IRR).toMatchObject({ log: true, scale: 'lnIRR' });
    expect(ES_TYPES.AUC).toMatchObject({ log: false, nullVal: 0.5 });
    expect(ES_TYPES.BETA).toMatchObject({ log: false, nullVal: 0 });
    expect(ES_TYPES.GENERIC).toMatchObject({ log: false });
    expect(ES_TYPES.GENERIC_LOG).toMatchObject({ log: true });
    // RD mislabel fixed: it is a difference, not a ratio.
    expect(ES_TYPES.RD.family).toBe('difference');
    expect(ES_TYPES.RD.log).toBe(false);
  });
});

describe('calcES — Peto OR', () => {
  it('matches the Peto one-step formula for a 2×2', () => {
    // a=8,b=92 (n1=100); c=4,d=96 (n2=100). N=200, events=12.
    const r = calcES('PETO', { a: 8, b: 92, c: 4, d: 96 });
    const N = 200, n1 = 100, n2 = 100, ev = 12;
    const O = 8, E = n1 * ev / N;                       // 6
    const V = (n1 * n2 * ev * (N - ev)) / (N * N * (N - 1)); // hypergeometric variance
    const lnPeto = (O - E) / V, se = Math.sqrt(1 / V);
    expect(r.es).toBeCloseTo(lnPeto, 10);
    expect(r.se).toBeCloseTo(se, 10);
    expect(r.lo).toBeCloseTo(lnPeto - 1.96 * se, 10);
    expect(Math.exp(r.es)).toBeGreaterThan(1); // more events in the intervention arm
  });
  it('rejects a double-zero-event table (not estimable)', () => {
    expect(calcES('PETO', { a: 0, b: 100, c: 0, d: 100 })).toBeNull();
  });
  it('handles a single zero cell without a continuity correction', () => {
    const r = calcES('PETO', { a: 0, b: 100, c: 6, d: 94 });
    expect(r).not.toBeNull();
    expect(Math.exp(r.es)).toBeLessThan(1);
  });
});

describe('calcES — IRR', () => {
  it('computes ln IRR and SE from events + person-time', () => {
    const r = calcES('IRR', { e1: 20, t1: 1000, e2: 10, t2: 1000 });
    expect(r.es).toBeCloseTo(Math.log(2), 10);
    expect(r.se).toBeCloseTo(Math.sqrt(1 / 20 + 1 / 10), 10);
  });
  it('requires positive events in both arms', () => {
    expect(calcES('IRR', { e1: 0, t1: 1000, e2: 10, t2: 1000 })).toBeNull();
  });
});

describe('calcES — AUC (raw 0–1 scale)', () => {
  it('uses a supplied SE', () => {
    const r = calcES('AUC', { auc: 0.82, se: 0.03 });
    expect(r.es).toBeCloseTo(0.82, 10);
    expect(r.lo).toBeCloseTo(0.82 - 1.96 * 0.03, 10);
  });
  it('derives SE from a 95% CI', () => {
    const r = calcES('AUC', { auc: 0.82, lo: 0.76, hi: 0.88 });
    expect(r.se).toBeCloseTo((0.88 - 0.76) / (2 * 1.96), 10);
  });
  it('rejects an AUC outside (0,1)', () => {
    expect(calcES('AUC', { auc: 1.2, se: 0.03 })).toBeNull();
  });
});

describe('calcES — BETA / Generic', () => {
  it('BETA passes through with a supplied SE', () => {
    const r = calcES('BETA', { beta: 0.45, se: 0.1 });
    expect(r.es).toBeCloseTo(0.45, 10);
    expect(r.se).toBeCloseTo(0.1, 10);
  });
  it('GENERIC uses est/lo/hi verbatim and derives SE from the CI width', () => {
    const r = calcES('GENERIC', { est: 1.5, lo: 1.1, hi: 2.0 });
    expect(r.es).toBeCloseTo(1.5, 10);
    expect(r.se).toBeCloseTo((2.0 - 1.1) / (2 * 1.96), 10);
  });
  it('GENERIC_LOG log-transforms a pre-computed ratio + CI', () => {
    const r = calcES('GENERIC_LOG', { est: 1.5, lo: 1.1, hi: 2.0 });
    expect(r.es).toBeCloseTo(Math.log(1.5), 10);
    expect(r.lo).toBeCloseTo(Math.log(1.1), 10);
    expect(r.hi).toBeCloseTo(Math.log(2.0), 10);
  });
  it('GENERIC_LOG rejects a non-positive estimate', () => {
    expect(calcES('GENERIC_LOG', { est: -1, lo: 0.5, hi: 2 })).toBeNull();
  });
});

describe('calcES — RD regression (unchanged)', () => {
  it('computes the risk difference and its SE', () => {
    const r = calcES('RD', { a: 8, b: 92, c: 4, d: 96 });
    const r1 = 8 / 100, r2 = 4 / 100;
    expect(r.es).toBeCloseTo(r1 - r2, 10);
    expect(r.se).toBeCloseTo(Math.sqrt(r1 * (1 - r1) / 100 + r2 * (1 - r2) / 100), 10);
  });
});
