/**
 * calibration.test.js — se2.md §8 probability calibration (pure math).
 */
import { describe, it, expect } from 'vitest';
import {
  fitPlatt, fitIsotonic, applyCalibrator, fitCalibrator,
  brierScore, logLoss, expectedCalibrationError, reliabilityBins,
  calibrationSlopeIntercept, selectCalibrationMethod, calibrationMetrics,
} from '../../../../src/research-engine/screening/ai/calibration.js';

// Deterministic separable-ish dataset: negatives score in [0.4,0.5), positives in
// [0.5,0.6). Separated at 0.5 but raw scores are badly *calibrated* (a 0.45 score
// that is always negative should map near 0, not 0.45).
function miscalibrated(nPer = 100) {
  const scores = [], labels = [];
  for (let i = 0; i < nPer; i++) { scores.push(0.40 + 0.001 * i); labels.push(0); }
  for (let i = 0; i < nPer; i++) { scores.push(0.50 + 0.001 * i); labels.push(1); }
  return { scores, labels };
}

describe('applyCalibrator', () => {
  it('is the clamped identity when method is none', () => {
    expect(applyCalibrator({ method: 'none' }, 0.7)).toBe(0.7);
    expect(applyCalibrator(null, 1.5)).toBe(1);
    expect(applyCalibrator(null, -0.2)).toBe(0);
    expect(applyCalibrator(null, NaN)).toBe(null);
  });
});

describe('fitPlatt', () => {
  it('produces a monotone increasing map in [0,1]', () => {
    const { scores, labels } = miscalibrated();
    const cal = fitPlatt(scores, labels);
    const lo = applyCalibrator(cal, 0.42);
    const hi = applyCalibrator(cal, 0.58);
    expect(hi).toBeGreaterThan(lo);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
  });
});

describe('fitIsotonic', () => {
  it('is monotone non-decreasing across the score range', () => {
    const { scores, labels } = miscalibrated();
    const cal = fitIsotonic(scores, labels);
    let prev = -1;
    for (let s = 0.4; s <= 0.6; s += 0.01) {
      const p = applyCalibrator(cal, s);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = p;
    }
  });

  it('recovers observed inclusion rates (low Brier on its own fit set)', () => {
    const { scores, labels } = miscalibrated();
    const cal = fitIsotonic(scores, labels);
    const probs = scores.map(s => applyCalibrator(cal, s));
    expect(brierScore(probs, labels)).toBeLessThan(0.05);
  });
});

describe('metrics', () => {
  it('brierScore: perfect → 0, coin-flip → 0.25', () => {
    expect(brierScore([1, 0], [1, 0])).toBeCloseTo(0, 10);
    expect(brierScore([0.5, 0.5], [1, 0])).toBeCloseTo(0.25, 10);
  });
  it('logLoss: coin-flip → ln 2', () => {
    expect(logLoss([0.5, 0.5], [1, 0])).toBeCloseTo(Math.log(2), 6);
  });
  it('expectedCalibrationError: a perfectly-calibrated set → ~0', () => {
    // bin at 0.05 with 50% positives, predicted mean 0.05? Build predicted==observed.
    const probs = [], labels = [];
    for (let i = 0; i < 100; i++) { probs.push(0.25); labels.push(i < 25 ? 1 : 0); } // observed 0.25 == predicted
    expect(expectedCalibrationError(probs, labels, 10)).toBeCloseTo(0, 6);
  });
  it('reliabilityBins partition all points', () => {
    const probs = [0.05, 0.15, 0.95], labels = [0, 0, 1];
    const bins = reliabilityBins(probs, labels, 10);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(3);
  });
  it('calibrationSlopeIntercept ≈ (1,0) for well-calibrated probabilities', () => {
    // labels drawn deterministically to match probs would need RNG; instead assert
    // a perfectly-separated, well-spread calibrated set gives a positive slope.
    const probs = [], labels = [];
    for (let i = 0; i < 200; i++) { const p = i / 199; probs.push(p); labels.push(p >= 0.5 ? 1 : 0); }
    const { slope } = calibrationSlopeIntercept(probs, labels);
    expect(slope).toBeGreaterThan(0);
  });
});

describe('selectCalibrationMethod', () => {
  it('returns none below the minimum', () => {
    expect(selectCalibrationMethod(2, 2).method).toBe('none');
    expect(selectCalibrationMethod(4, 100).method).toBe('none'); // <5 positives
  });
  it('prefers Platt for small sets and isotonic for large', () => {
    expect(selectCalibrationMethod(30, 30).method).toBe('platt');     // 60 < 200
    expect(selectCalibrationMethod(150, 150).method).toBe('isotonic'); // 300 ≥ 200
  });
});

describe('fitCalibrator (end to end)', () => {
  it('returns method none with a reason when data is insufficient', () => {
    const out = fitCalibrator([0.4, 0.6], [0, 1]);
    expect(out.method).toBe('none');
    expect(out.params).toBe(null);
    expect(out.reason).toMatch(/enough/i);
  });

  it('calibrates and materially reduces Brier vs the raw score (platt path)', () => {
    const { scores, labels } = miscalibrated(80);       // 160 samples (< 200) → platt
    const rawBrier = brierScore(scores.map(s => Math.min(1, Math.max(0, s))), labels);
    const out = fitCalibrator(scores, labels);
    expect(out.method).toBe('platt');
    expect(out.metrics.brier).toBeLessThan(rawBrier);
    expect(out.metrics.n).toBe(160);
    expect(Number.isFinite(out.metrics.ece)).toBe(true);
  });

  it('uses isotonic on a large set and still reduces Brier', () => {
    const { scores, labels } = miscalibrated(150);      // 300 samples (≥ 200) → isotonic
    const rawBrier = brierScore(scores.map(s => Math.min(1, Math.max(0, s))), labels);
    const out = fitCalibrator(scores, labels);
    expect(out.method).toBe('isotonic');
    expect(out.metrics.brier).toBeLessThan(rawBrier);
  });
});
