/**
 * leaveoneout.test.js — golden tests for leave-one-out sensitivity analysis.
 * Cross-checks each LOO entry against an independent runMeta(subset) and a
 * hand-computed value on HC3.
 */
import { describe, it, expect } from 'vitest';
import { runMeta, leaveOneOut } from '../../../src/research-engine/statistics/meta-analysis.js';
import { HC3, fromSE } from '../../fixtures/meta/canonical.js';

describe('leaveOneOut (golden)', () => {
  it('returns one entry per study, each = runMeta(remaining k−1)', () => {
    const loo = leaveOneOut(HC3.studies, 'random');
    expect(loo).toHaveLength(3);
    HC3.studies.forEach((omit, idx) => {
      const subset = HC3.studies.filter((_, i) => i !== idx);
      const ref = runMeta(subset, 'random');
      const entry = loo.find(e => e.omittedId === omit.id);
      expect(entry.pES).toBeCloseTo(ref.pES, 12);
      expect(entry.lo95).toBeCloseTo(ref.lo95, 12);
      expect(entry.hi95).toBeCloseTo(ref.hi95, 12);
      expect(entry.I2).toBeCloseTo(ref.I2, 12);
    });
  });

  it('HC3: omitting C (es=0.9) leaves equal-weight {0.1,0.5} → pooled 0.3', () => {
    const loo = leaveOneOut(HC3.studies, 'random');
    const omitC = loo.find(e => e.omittedId === 'C');
    expect(omitC.pES).toBeCloseTo(0.3, 9);
  });

  it('requires k≥3 (need ≥2 after removal)', () => {
    expect(leaveOneOut([fromSE(0.2, 0.1, 'a'), fromSE(0.4, 0.1, 'b')], 'random')).toEqual([]);
  });
});
