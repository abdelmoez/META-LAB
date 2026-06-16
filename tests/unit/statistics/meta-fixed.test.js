/**
 * meta-fixed.test.js — golden tests for the fixed-effect (common-effect)
 * inverse-variance model in runMeta(studies, "fixed").
 *
 * Anchored to hand-computed values (see tests/fixtures/meta/canonical.js),
 * not to the engine's own output. Tolerance: 1e-9 absolute on pooled ES/SE
 * (documented in statistical-validation.md §11).
 */
import { describe, it, expect } from 'vitest';
import { runMeta } from '../../../src/research-engine/statistics/meta-analysis.js';
import { HC2, HC3, Z975 } from '../../fixtures/meta/canonical.js';

describe('fixed-effect pooling (golden, hand-computed)', () => {
  it('HC2: pooled ES = 0.24, SE = sqrt(1/125)', () => {
    const r = runMeta(HC2.studies, 'fixed');
    expect(r.method).toBe('fixed');
    expect(r.pES).toBeCloseTo(HC2.fixedES, 9);
    expect(r.pSE).toBeCloseTo(HC2.fixedSE, 9);
    expect(r.tau2).toBe(0); // fixed model never adds between-study variance
  });

  it('HC2: 95% CI = ES ± Z975·SE', () => {
    const r = runMeta(HC2.studies, 'fixed');
    expect(r.lo95).toBeCloseTo(HC2.fixedES - Z975 * HC2.fixedSE, 9);
    expect(r.hi95).toBeCloseTo(HC2.fixedES + Z975 * HC2.fixedSE, 9);
  });

  it('HC3: equal-weight pooled ES = 0.5, SE = sqrt(1/300)', () => {
    const r = runMeta(HC3.studies, 'fixed');
    expect(r.pES).toBeCloseTo(HC3.fixedES, 9);
    expect(r.pSE).toBeCloseTo(HC3.fixedSE, 9);
  });

  it('fixed pooled ES equals an independent inverse-variance reimplementation', () => {
    // Independent reference: pooled = Σ(w·y)/Σw, w = 1/SE², SE recovered from CI.
    const ref = (studies) => {
      let sw = 0, swy = 0;
      for (const s of studies) {
        const se = (+s.hi - +s.lo) / (2 * Z975);
        const w = 1 / (se * se);
        sw += w; swy += w * (+s.es);
      }
      return { es: swy / sw, se: Math.sqrt(1 / sw) };
    };
    for (const fx of [HC2.studies, HC3.studies]) {
      const r = runMeta(fx, 'fixed');
      const e = ref(fx);
      expect(r.pES).toBeCloseTo(e.es, 12);
      expect(r.pSE).toBeCloseTo(e.se, 12);
    }
  });

  it('exposes per-study fixed weight percentages summing to 100', () => {
    const r = runMeta(HC2.studies, 'fixed');
    // HC2 weights are 100 and 25 → 80% and 20%.
    const pcts = r.studies.map(s => s._wFixedPct).sort((a, b) => a - b);
    expect(pcts[0]).toBeCloseTo(20, 9);
    expect(pcts[1]).toBeCloseTo(80, 9);
    expect(pcts[0] + pcts[1]).toBeCloseTo(100, 9);
  });
});
