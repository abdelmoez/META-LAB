/**
 * engineTuning.test.js — screeningEngine.md tasks 3 & 4:
 *   - the named engine config version registry (v1 legacy untouched, v2 tuned)
 *   - logistic-regression momentum (deterministic; mu=0 == plain GD)
 *   - HELD-OUT (nested) calibration metrics replacing the optimistic apparent ones
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AI_CONFIG, resolveConfig,
  ENGINE_CONFIG_VERSIONS, ENGINE_CONFIG_DEFAULT_VERSION, resolveEngineConfig,
} from '../../../../src/research-engine/screening/ai/config.js';
import { trainLogReg, predictProba } from '../../../../src/research-engine/screening/ai/logreg.js';
import {
  fitCalibrator, heldOutCalibrationMetrics, expectedCalibrationError, applyCalibrator,
} from '../../../../src/research-engine/screening/ai/calibration.js';

describe('engine config version registry', () => {
  it('exposes v1 (legacy) and v2 (tuned); default is v2', () => {
    expect(ENGINE_CONFIG_VERSIONS['v1-hybrid-legacy']).toBeTruthy();
    expect(ENGINE_CONFIG_VERSIONS['v2-lexical-tuned']).toBeTruthy();
    expect(ENGINE_CONFIG_DEFAULT_VERSION).toBe('v2-lexical-tuned');
  });

  it('v1 is the UNTOUCHED default config (empty override) — preserved for rollback', () => {
    const v1 = resolveEngineConfig('v1-hybrid-legacy');
    expect(v1.vectorizer.useKeywordFeatures).toBe(DEFAULT_AI_CONFIG.vectorizer.useKeywordFeatures);
    expect(v1.vectorizer.fieldWeights).toEqual(DEFAULT_AI_CONFIG.vectorizer.fieldWeights);
    expect(v1.classifier.l2).toBe(DEFAULT_AI_CONFIG.classifier.l2);
    expect(v1.classifier.momentum).toBeUndefined(); // v1 = plain GD, untouched
    expect(v1.engineConfigVersion).toBe('v1-hybrid-legacy');
  });

  it('v2 keeps the deployed feature set + hybrid, changing only the optimiser', () => {
    const v2 = resolveEngineConfig('v2-lexical-tuned');
    // Features + fusion are intentionally identical to v1 (the change is the classifier).
    expect(v2.vectorizer.useKeywordFeatures).toBe(DEFAULT_AI_CONFIG.vectorizer.useKeywordFeatures);
    expect(v2.vectorizer.fieldWeights).toEqual(DEFAULT_AI_CONFIG.vectorizer.fieldWeights);
    // The classifier converges to the regularised optimum: momentum + sklearn-style C.
    expect(v2.classifier.momentum).toBeGreaterThan(0);
    expect(v2.classifier.cInverseReg).toBeGreaterThan(0);
    expect(v2.classifier.classWeight).toBe('balanced');
    expect(v2.engineConfigVersion).toBe('v2-lexical-tuned');
  });

  it('unknown version falls back to the default version', () => {
    const c = resolveEngineConfig('does-not-exist');
    expect(c.engineConfigVersion).toBe(ENGINE_CONFIG_DEFAULT_VERSION);
  });
});

describe('logreg momentum', () => {
  // Tiny separable problem: two features, two classes.
  const samples = [
    { x: { 0: 1 }, y: 1 }, { x: { 0: 0.9 }, y: 1 }, { x: { 0: 0.8 }, y: 1 },
    { x: { 1: 1 }, y: 0 }, { x: { 1: 0.9 }, y: 0 }, { x: { 1: 0.8 }, y: 0 },
  ];

  it('mu=0 is byte-identical to omitting momentum (legacy path preserved)', () => {
    const a = trainLogReg(samples, 2, { l2: 1e-4, learningRate: 0.5, epochs: 50 });
    const b = trainLogReg(samples, 2, { l2: 1e-4, learningRate: 0.5, epochs: 50, momentum: 0 });
    expect(Array.from(a.weights)).toEqual(Array.from(b.weights));
    expect(a.bias).toBe(b.bias);
  });

  it('is deterministic and momentum reaches a separating solution', () => {
    const m1 = trainLogReg(samples, 2, { cInverseReg: 1, momentum: 0.9, learningRate: 1, epochs: 300 });
    const m2 = trainLogReg(samples, 2, { cInverseReg: 1, momentum: 0.9, learningRate: 1, epochs: 300 });
    expect(Array.from(m1.weights)).toEqual(Array.from(m2.weights)); // deterministic
    expect(predictProba(m1, { 0: 1 })).toBeGreaterThan(predictProba(m1, { 1: 1 }));
  });
});

// Deterministic LCG so the calibration tests are reproducible without imports.
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }

describe('held-out (nested) calibration metrics', () => {
  it('flags heldOut and computes a finite, non-trivial ECE', () => {
    // Clean signal: probability rises with score → calibratable.
    const rnd = lcg(7);
    const scores = [], labels = [];
    for (let i = 0; i < 400; i++) { const s = i / 400; scores.push(s); labels.push(rnd() < s ? 1 : 0); }
    const ho = heldOutCalibrationMetrics(scores, labels, { isotonicMinSamples: 100, eceBins: 10 });
    expect(ho.heldOut).toBe(true);
    expect(Number.isFinite(ho.ece)).toBe(true);
    expect(ho.ece).toBeGreaterThanOrEqual(0);
    expect(ho.ece).toBeLessThan(0.15);
  });

  it('is NOT optimistic: on noisy data, held-out ECE exceeds the apparent ECE≈0', () => {
    // Labels independent of score → isotonic overfits in-sample (apparent ECE ≈ 0),
    // but the held-out estimate must reveal the real miscalibration.
    const rnd = lcg(42);
    const scores = [], labels = [];
    for (let i = 0; i < 400; i++) { scores.push(rnd()); labels.push(rnd() < 0.5 ? 1 : 0); }
    const apparent = fitCalibrator(scores, labels, { isotonicMinSamples: 100 });
    const apparentEce = apparent.metrics.ece;
    const ho = heldOutCalibrationMetrics(scores, labels, { isotonicMinSamples: 100 });
    expect(apparent.method).toBe('isotonic');
    expect(apparentEce).toBeLessThan(0.05);          // apparent is optimistic
    expect(ho.ece).toBeGreaterThan(apparentEce);      // held-out is honest (higher)
  });

  it('reports a reason and null metrics below the nested-split floor', () => {
    const scores = [0.1, 0.2, 0.8, 0.9, 0.3, 0.7];
    const labels = [0, 0, 1, 1, 0, 1];
    const ho = heldOutCalibrationMetrics(scores, labels, {});
    expect(ho.ece).toBeNull();
    expect(typeof ho.reason).toBe('string');
  });
});
