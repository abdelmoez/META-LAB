/**
 * drift.test.js — se2.md §11 model drift tracking (pure).
 */
import { describe, it, expect } from 'vitest';
import {
  scoreHistogram, populationStabilityIndex, detectClassCollapse,
  runDriftSnapshot, computeDrift, DRIFT_DEFAULTS,
} from '../../../../src/research-engine/screening/ai/drift.js';

describe('scoreHistogram', () => {
  it('buckets scores into fractional bins with a mean', () => {
    const h = scoreHistogram([0.05, 0.05, 0.95], 10);
    expect(h.n).toBe(3);
    expect(h.hist[0]).toBeCloseTo(2 / 3, 6);
    expect(h.hist[9]).toBeCloseTo(1 / 3, 6);
    expect(h.mean).toBeCloseTo((0.05 + 0.05 + 0.95) / 3, 6);
  });
  it('ignores non-finite scores', () => {
    expect(scoreHistogram([NaN, 0.5]).n).toBe(1);
  });
});

describe('populationStabilityIndex', () => {
  it('is ~0 for identical distributions', () => {
    const h = scoreHistogram([0.1, 0.3, 0.5, 0.7, 0.9], 10).hist;
    expect(populationStabilityIndex(h, h)).toBeCloseTo(0, 6);
  });
  it('is large for a big shift', () => {
    const a = scoreHistogram(Array(100).fill(0.05), 10).hist;
    const b = scoreHistogram(Array(100).fill(0.95), 10).hist;
    expect(populationStabilityIndex(a, b)).toBeGreaterThan(0.25);
  });
  it('returns null for incomparable inputs', () => {
    expect(populationStabilityIndex([0.5], [0.3, 0.7])).toBe(null);
  });
});

describe('detectClassCollapse', () => {
  it('flags a single dominant bin', () => {
    expect(detectClassCollapse(scoreHistogram(Array(100).fill(0.99), 10).hist)).toBe(true);
    expect(detectClassCollapse(scoreHistogram([0.1, 0.3, 0.5, 0.7, 0.9], 10).hist)).toBe(false);
  });
});

describe('computeDrift', () => {
  const snap = (over = {}) => ({ auc: 0.9, wss95: 0.5, brier: 0.1, ece: 0.05, prevalence: 0.2, dist: scoreHistogram([0.1, 0.4, 0.6, 0.9]), ...over });

  it('reports baseline when there is no previous run', () => {
    const r = computeDrift(null, snap());
    expect(r.baseline).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('no warnings when metrics are stable', () => {
    const r = computeDrift(snap(), snap());
    expect(r.warnings).toEqual([]);
  });

  it('warns when AUC drops', () => {
    const r = computeDrift(snap({ auc: 0.9 }), snap({ auc: 0.8 }));
    expect(r.warnings.join(' ')).toMatch(/AUC dropped/);
    expect(r.deltas.auc).toBeCloseTo(-0.1, 6);
  });

  it('warns when calibration worsens (Brier + ECE rise)', () => {
    const r = computeDrift(snap({ brier: 0.1, ece: 0.04 }), snap({ brier: 0.18, ece: 0.12 }));
    expect(r.warnings.join(' ')).toMatch(/Brier/);
    expect(r.warnings.join(' ')).toMatch(/ECE/);
  });

  it('warns when WSS@95 falls (independent of the AUC threshold)', () => {
    const r = computeDrift(snap({ wss95: 0.6 }), snap({ wss95: 0.5 }));
    expect(r.warnings.join(' ')).toMatch(/WSS@95\) fell/);
    expect(r.deltas.wss95).toBeCloseTo(-0.1, 6);
  });

  it('warns on a large score-distribution shift (PSI)', () => {
    const prev = snap({ dist: scoreHistogram(Array(100).fill(0.05)) });
    const curr = snap({ dist: scoreHistogram(Array(100).fill(0.95)) });
    const r = computeDrift(prev, curr);
    expect(r.psi).toBeGreaterThan(DRIFT_DEFAULTS.psiLarge);
    expect(r.warnings.join(' ')).toMatch(/distribution shifted/);
  });

  it('warns on model collapse (all scores in one band)', () => {
    const curr = snap({ dist: scoreHistogram(Array(100).fill(0.99)) });
    const r = computeDrift(snap(), curr);
    expect(r.collapse).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/not discriminating/);
  });
});

describe('runDriftSnapshot', () => {
  it('extracts comparable signals from a run metrics bundle', () => {
    const metrics = {
      crossVal: { heldOut: true, auc: 0.88, wss95: 0.55, sensitivity: 0.9 },
      calibration: { metrics: { brier: 0.12, ece: 0.06 } },
      stopping: { prevalenceObserved: 0.18 },
    };
    const dist = scoreHistogram([0.2, 0.8]);
    const s = runDriftSnapshot(metrics, dist);
    expect(s.auc).toBe(0.88);
    expect(s.brier).toBe(0.12);
    expect(s.ece).toBe(0.06);
    expect(s.prevalence).toBe(0.18);
    expect(s.dist).toBe(dist);
  });
});
