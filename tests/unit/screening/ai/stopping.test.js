/**
 * stopping.test.js — se2.md §9 statistically-grounded stopping rules (pure math).
 */
import { describe, it, expect } from 'vitest';
import {
  estimateRecall, recentInclusionYield, stoppingPreconditions,
  evaluateStopping, retrospectiveStopping, STOPPING_LANGUAGE,
} from '../../../../src/research-engine/screening/ai/stopping.js';

const okCalibration = { method: 'platt', metrics: { ece: 0.04 } };

describe('estimateRecall', () => {
  it('recall is 1 when nothing remains unscreened', () => {
    const e = estimateRecall({ foundPositives: 20, unscreenedProbs: [], targetRecall: 0.95 });
    expect(e.nRemaining).toBe(0);
    expect(e.estimatedRecall).toBe(1);
    expect(e.meetsTarget).toBe(true);
  });

  it('point recall = F / (F + ΣP), with bounds bracketing the estimate', () => {
    const e = estimateRecall({ foundPositives: 10, unscreenedProbs: [0.5, 0.5], targetRecall: 0.95 });
    expect(e.estimatedRemainingPositives).toBeCloseTo(1, 10);
    expect(e.estimatedRecall).toBeCloseTo(10 / 11, 6);
    expect(e.recallLo).toBeLessThanOrEqual(e.estimatedRecall + 1e-9);
    expect(e.recallHi).toBeGreaterThanOrEqual(e.estimatedRecall - 1e-9);
    expect(e.meetsTarget).toBe(e.recallLo >= 0.95);
  });

  it('judges the target against the conservative lower bound', () => {
    // Many remaining low-prob records: point recall high but lower bound below target.
    const probs = Array.from({ length: 100 }, () => 0.05);
    const e = estimateRecall({ foundPositives: 95, unscreenedProbs: probs, targetRecall: 0.95 });
    expect(e.estimatedRecall).toBeGreaterThan(e.recallLo);
    expect(e.meetsTarget).toBe(e.recallLo >= 0.95);
  });
});

describe('recentInclusionYield', () => {
  it('counts includes in the trailing window', () => {
    expect(recentInclusionYield([0, 0, 1, 1, 1], 3)).toEqual({ yield: 1, window: 3, includes: 3 });
    expect(recentInclusionYield([0, 0, 1, 1, 1], 10)).toEqual({ yield: 0.6, window: 5, includes: 3 });
    expect(recentInclusionYield([], 5).yield).toBe(null);
  });
});

describe('stoppingPreconditions', () => {
  const good = {
    nIncludes: 20, nDecisions: 200, nRemaining: 500,
    calibration: okCalibration, recentYield: { yield: 0.02, window: 50 },
  };
  it('passes when all conditions are met', () => {
    expect(stoppingPreconditions(good).ok).toBe(true);
  });
  it('flags too few includes', () => {
    const r = stoppingPreconditions({ ...good, nIncludes: 3 });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/eligible records/i);
  });
  it('flags missing calibration', () => {
    const r = stoppingPreconditions({ ...good, calibration: { method: 'none' } });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/calibration/i);
  });
  it('flags poor calibration (high ECE)', () => {
    const r = stoppingPreconditions({ ...good, calibration: { method: 'platt', metrics: { ece: 0.4 } } });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/ECE/);
  });
  it('flags a high recent inclusion yield', () => {
    const r = stoppingPreconditions({ ...good, recentYield: { yield: 0.5, window: 50 } });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/high rate/i);
  });
  it('flags partial coverage (records left unscored by the per-run cap)', () => {
    const r = stoppingPreconditions({ ...good, unscoredUnscreened: 2000 });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/not scored this run|exceeds the per-run cap/i);
  });
});

describe('evaluateStopping', () => {
  it('is unavailable (no recommendation) without calibration', () => {
    const out = evaluateStopping({
      foundPositives: 20, nDecisions: 200, unscreenedProbs: [0.01, 0.02],
      calibration: { method: 'none' }, chronoLabels: [0, 0, 0],
    });
    expect(out.available).toBe(false);
    expect(out.recommendStop).toBe(false);
    expect(out.headline).toBe(STOPPING_LANGUAGE.notAvailable);
  });

  it('recommends stopping only when preconditions pass AND target is met', () => {
    const out = evaluateStopping({
      // many found, a few unscreened records with tiny remaining mass → recall LB ≥ target
      foundPositives: 400, nDecisions: 800, unscreenedProbs: Array(50).fill(0.001),
      calibration: okCalibration, chronoLabels: Array(60).fill(0),
    });
    expect(out.estimate.nRemaining).toBe(50);
    expect(out.available).toBe(true);
    expect(out.recommendStop).toBe(true);
    expect(out.headline).toBe(STOPPING_LANGUAGE.reachedTarget);
  });

  it('available but below target → does not recommend stopping', () => {
    const probs = Array.from({ length: 200 }, () => 0.2); // large remaining mass
    const out = evaluateStopping({
      foundPositives: 20, nDecisions: 300, unscreenedProbs: probs,
      calibration: okCalibration, chronoLabels: Array(60).fill(0),
    });
    expect(out.available).toBe(true);
    expect(out.recommendStop).toBe(false);
    expect(out.headline).toBe(STOPPING_LANGUAGE.belowTarget);
  });

  it('suppresses the recommendation when the per-run cap left records unscored', () => {
    // Same numbers that recommend stopping above, but with dropped unscreened records.
    const out = evaluateStopping({
      foundPositives: 400, nDecisions: 800, unscreenedProbs: Array(50).fill(0.001),
      calibration: okCalibration, chronoLabels: Array(60).fill(0),
      unscoredUnscreened: 3000, // project exceeds the per-run cap
    });
    expect(out.available).toBe(false);
    expect(out.recommendStop).toBe(false);
    expect(out.headline).toBe(STOPPING_LANGUAGE.notAvailable);
    expect(out.preconditions.reasons.join(' ')).toMatch(/per-run cap|not scored/i);
  });

  it('never uses forbidden "safe to stop" wording', () => {
    const out = evaluateStopping({
      foundPositives: 400, nDecisions: 800, unscreenedProbs: Array(50).fill(0.001),
      calibration: okCalibration, chronoLabels: Array(60).fill(0),
    });
    const text = JSON.stringify(out).toLowerCase();
    expect(text).not.toContain('safe to stop');
    expect(text).not.toContain('all relevant studies have been found');
  });
});

describe('retrospectiveStopping', () => {
  it('reports WSS and a stage curve for a perfectly-ranked review', () => {
    // 10 positives ranked first, then 90 negatives → near-maximal work saved.
    const scores = [], labels = [];
    for (let i = 0; i < 100; i++) { scores.push((100 - i) / 100); labels.push(i < 10 ? 1 : 0); }
    const r = retrospectiveStopping(scores, labels, 0.95);
    expect(r.wssAtTarget).toBeGreaterThan(0.5);
    expect(Array.isArray(r.stages)).toBe(true);
    expect(r.docsToTargetRecall).toBeGreaterThan(0);
  });
});
