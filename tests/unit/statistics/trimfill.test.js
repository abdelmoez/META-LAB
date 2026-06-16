/**
 * trimfill.test.js — golden test for Duval & Tweedie trim-and-fill, pinned to
 * R metafor::trimfill on the 14-study fixture (D14). The L0 centre is
 * model-aware: random-effects funnel is ~symmetric (k0=0, no shift); the
 * fixed-effect model over-weights the precise positive studies, so trim-and-fill
 * imputes 4 mirror studies on the left and pulls the estimate down to 0.2422.
 */
import { describe, it, expect } from 'vitest';
import { trimFill } from '../../../src/research-engine/statistics/meta-analysis.js';
import { D14 } from '../../fixtures/meta/canonical.js';

describe('trim-and-fill (golden, metafor-pinned)', () => {
  it('random-effects: k0 = 0, estimate unchanged (≈0.6137)', () => {
    const r = trimFill(D14.studies, 'random');
    expect(r.k0).toBe(D14.trimfillRE_k0);
    expect(r.side).toBeNull();
    expect(r.imputed).toHaveLength(0);
    expect(r.base.pES).toBeCloseTo(D14.dlPooled, 3);
    expect(r.adjusted.pES).toBeCloseTo(D14.dlPooled, 3);
  });

  it('fixed-effect: k0 = 4, imputes left, adjusted ≈ 0.2422', () => {
    const r = trimFill(D14.studies, 'fixed');
    expect(r.k0).toBe(D14.trimfillFE_k0);
    expect(r.side).toBe('left');
    expect(r.imputed).toHaveLength(4);
    expect(r.adjusted.pES).toBeCloseTo(D14.trimfillFE_adjusted, 3);
    expect(r.adjusted.pES).toBeLessThan(r.base.pES);
  });

  it('guards the old FE-centred bug: RE k0 < 3', () => {
    expect(trimFill(D14.studies, 'random').k0).toBeLessThan(3);
  });
});
