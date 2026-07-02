/**
 * evidenceShift.test.js — shift detection between two MA snapshots.
 * es/lo/hi are on the ANALYSIS scale (log for ratios); null = 0.
 */
import { describe, it, expect } from 'vitest';
import {
  detectEvidenceShift,
  DEFAULT_SHIFT_THRESHOLDS,
} from '../../../src/research-engine/statistics/evidenceShift.js';

/** Build a per-outcome summary with sensible defaults. */
function ma(over = {}) {
  return {
    outcome: 'Mortality',
    timepoint: '30d',
    esType: 'OR',
    k: 5,
    es: -0.3,
    lo: -0.5,
    hi: -0.1,
    pval: 0.01,
    i2: 20,
    method: 'random',
    ...over,
  };
}

const typesOf = (res) => res.shifts.map((s) => s.type);

describe('DEFAULT_SHIFT_THRESHOLDS', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_SHIFT_THRESHOLDS).toEqual({ relEffectChange: 0.25, i2Change: 20, minK: 2 });
  });
});

describe('direction change', () => {
  it('sign flip with both k>=minK → major', () => {
    const prev = ma({ es: -0.3, lo: -0.5, hi: -0.1 });
    const curr = ma({ es: 0.3, lo: 0.1, hi: 0.5 });
    const res = detectEvidenceShift(prev, curr);
    const dir = res.shifts.find((s) => s.type === 'direction_change');
    expect(dir).toBeTruthy();
    expect(dir.severity).toBe('major');
    expect(res.majors).toBeGreaterThanOrEqual(1);
    expect(dir.message).toMatch(/potential evidence shift/i);
  });

  it('does not fire when one snapshot has k<minK', () => {
    const prev = ma({ es: -0.3, k: 1 });
    const curr = ma({ es: 0.3, lo: 0.1, hi: 0.5, k: 5 });
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).not.toContain('direction_change');
  });

  it('does not fire when one effect is exactly zero', () => {
    const prev = ma({ es: 0, lo: -0.2, hi: 0.2 });
    const curr = ma({ es: 0.3, lo: 0.1, hi: 0.5 });
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).not.toContain('direction_change');
  });
});

describe('significance change', () => {
  it('gained significance (CI crossed null before, not now) → major', () => {
    const prev = ma({ es: -0.2, lo: -0.5, hi: 0.1 }); // crosses 0
    const curr = ma({ es: -0.3, lo: -0.5, hi: -0.1 }); // excludes 0
    const res = detectEvidenceShift(prev, curr);
    const sig = res.shifts.find((s) => s.type === 'significance_change');
    expect(sig).toBeTruthy();
    expect(sig.severity).toBe('major');
    expect(sig.significanceGained).toBe(true);
    expect(sig.message).toMatch(/excludes the null/i);
  });

  it('lost significance (excluded null before, crosses now) → major', () => {
    const prev = ma({ es: -0.3, lo: -0.5, hi: -0.1 }); // excludes 0
    const curr = ma({ es: -0.2, lo: -0.5, hi: 0.1 });  // crosses 0
    const res = detectEvidenceShift(prev, curr);
    const sig = res.shifts.find((s) => s.type === 'significance_change');
    expect(sig).toBeTruthy();
    expect(sig.significanceGained).toBe(false);
    expect(sig.message).toMatch(/includes the null/i);
  });

  it('no significance shift when both exclude the null', () => {
    const prev = ma({ es: -0.3, lo: -0.5, hi: -0.1 });
    const curr = ma({ es: -0.35, lo: -0.55, hi: -0.15 });
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).not.toContain('significance_change');
  });

  it('touching the null (hi === 0) counts as crossing', () => {
    const prev = ma({ es: -0.2, lo: -0.4, hi: 0 });    // touches → not sig
    const curr = ma({ es: -0.3, lo: -0.5, hi: -0.1 }); // excludes → sig
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).toContain('significance_change');
  });
});

describe('effect magnitude', () => {
  it('fires just above the 25% relative threshold → notable', () => {
    // prev es = -0.40 → denom 0.40, +25% needs |Δ| >= 0.10
    const prev = ma({ es: -0.40, lo: -0.6, hi: -0.2 });
    const curr = ma({ es: -0.51, lo: -0.7, hi: -0.32 }); // Δ 0.11 → 27.5%
    const res = detectEvidenceShift(prev, curr);
    const mag = res.shifts.find((s) => s.type === 'effect_magnitude');
    expect(mag).toBeTruthy();
    expect(mag.severity).toBe('notable');
    expect(mag.relChange).toBeGreaterThanOrEqual(0.25);
  });

  it('does not fire just below the threshold', () => {
    const prev = ma({ es: -0.40, lo: -0.6, hi: -0.2 });
    const curr = ma({ es: -0.44, lo: -0.64, hi: -0.24 }); // Δ 0.04 → 10%
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).not.toContain('effect_magnitude');
  });

  it('uses the 0.05 floor for tiny prev effects', () => {
    // prev es ~0 → denom floored at 0.05; curr 0.06 → change 0.06/0.05 = 1.2 >= 0.25
    const prev = ma({ es: 0.0, lo: -0.1, hi: 0.1 });
    const curr = ma({ es: 0.06, lo: -0.04, hi: 0.16 });
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).toContain('effect_magnitude');
  });
});

describe('heterogeneity change', () => {
  it('fires at >= 20 I² points → info', () => {
    const prev = ma({ i2: 20 });
    const curr = ma({ i2: 45 });
    const res = detectEvidenceShift(prev, curr);
    const het = res.shifts.find((s) => s.type === 'heterogeneity_change');
    expect(het).toBeTruthy();
    expect(het.severity).toBe('info');
    expect(het.i2Diff).toBe(25);
  });
  it('does not fire below threshold', () => {
    const res = detectEvidenceShift(ma({ i2: 20 }), ma({ i2: 35 }));
    expect(typesOf(res)).not.toContain('heterogeneity_change');
  });
  it('exactly 20 points fires (boundary inclusive)', () => {
    const res = detectEvidenceShift(ma({ i2: 20 }), ma({ i2: 40 }));
    expect(typesOf(res)).toContain('heterogeneity_change');
  });
});

describe('studies added', () => {
  it('standalone: fires only when growth >= 25%', () => {
    // 4 → 5 = 25% growth, nothing else changes → should fire
    const prev = ma({ k: 4 });
    const curr = ma({ k: 5 });
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).toContain('studies_added');
  });

  it('standalone: does NOT fire for small growth with no other shift', () => {
    // 10 → 11 = 10% growth, identical effect → no shift
    const prev = ma({ k: 10 });
    const curr = ma({ k: 11 });
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).not.toContain('studies_added');
    expect(res.any).toBe(false);
  });

  it('fires alongside another shift even for small growth', () => {
    // 10 → 11 (10%) but a heterogeneity shift also fires → studies_added rides along
    const prev = ma({ k: 10, i2: 20 });
    const curr = ma({ k: 11, i2: 45 });
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).toContain('heterogeneity_change');
    expect(typesOf(res)).toContain('studies_added');
    const sa = res.shifts.find((s) => s.type === 'studies_added');
    expect(sa.kDelta).toBe(1);
  });

  it('does not fire when k decreased or unchanged', () => {
    expect(typesOf(detectEvidenceShift(ma({ k: 5 }), ma({ k: 5 })))).not.toContain('studies_added');
    expect(typesOf(detectEvidenceShift(ma({ k: 5 }), ma({ k: 4 })))).not.toContain('studies_added');
  });
});

describe('outcome added / removed', () => {
  it('prev null → outcome_added (info)', () => {
    const res = detectEvidenceShift(null, ma({ outcome: 'Relapse' }));
    expect(res.shifts).toHaveLength(1);
    expect(res.shifts[0].type).toBe('outcome_added');
    expect(res.shifts[0].severity).toBe('info');
    expect(res.shifts[0].outcome).toBe('Relapse');
    expect(res.shifts[0].message).toMatch(/newly synthesised/i);
  });

  it('curr null → outcome_removed (info)', () => {
    const res = detectEvidenceShift(ma({ outcome: 'Relapse' }), null);
    expect(res.shifts).toHaveLength(1);
    expect(res.shifts[0].type).toBe('outcome_removed');
    expect(res.shifts[0].outcome).toBe('Relapse');
  });

  it('both null → no shifts, no crash', () => {
    const res = detectEvidenceShift(null, null);
    expect(res.shifts).toEqual([]);
    expect(res.any).toBe(false);
  });
});

describe('NaN / missing safety', () => {
  it('skips comparisons with NaN es without crashing', () => {
    const prev = ma({ es: NaN, lo: NaN, hi: NaN });
    const curr = ma({ es: 0.3, lo: 0.1, hi: 0.5 });
    expect(() => detectEvidenceShift(prev, curr)).not.toThrow();
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).not.toContain('direction_change');
    expect(typesOf(res)).not.toContain('effect_magnitude');
  });

  it('skips heterogeneity when i2 missing', () => {
    const prev = ma({ i2: undefined });
    const curr = ma({ i2: 80 });
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).not.toContain('heterogeneity_change');
  });

  it('skips significance/direction when k missing', () => {
    const prev = ma({ k: undefined, es: -0.3, lo: -0.5, hi: -0.1 });
    const curr = ma({ k: 5, es: 0.3, lo: 0.1, hi: 0.5 });
    const res = detectEvidenceShift(prev, curr);
    expect(typesOf(res)).not.toContain('direction_change');
    expect(typesOf(res)).not.toContain('significance_change');
  });
});

describe('result envelope + ordering', () => {
  it('sorts majors before notables before infos', () => {
    // direction flip (major) + heterogeneity (info) + magnitude (notable)
    const prev = ma({ es: -0.4, lo: -0.6, hi: -0.2, i2: 10, k: 5 });
    const curr = ma({ es: 0.6, lo: 0.4, hi: 0.8, i2: 60, k: 8 });
    const res = detectEvidenceShift(prev, curr);
    const ranks = res.shifts.map((s) => s.severity);
    const order = { major: 0, notable: 1, info: 2 };
    for (let i = 1; i < ranks.length; i++) {
      expect(order[ranks[i]]).toBeGreaterThanOrEqual(order[ranks[i - 1]]);
    }
    expect(res.any).toBe(true);
    expect(res.majors).toBeGreaterThanOrEqual(1);
  });

  it('carries prev/curr payloads and identity on each shift', () => {
    const prev = ma({ i2: 20 });
    const curr = ma({ i2: 60 });
    const res = detectEvidenceShift(prev, curr);
    const s = res.shifts[0];
    expect(s.outcome).toBe('Mortality');
    expect(s.timepoint).toBe('30d');
    expect(s.esType).toBe('OR');
    expect(s.prev).toMatchObject({ i2: 20 });
    expect(s.curr).toMatchObject({ i2: 60 });
  });

  it('identical snapshots → no shifts', () => {
    const res = detectEvidenceShift(ma(), ma());
    expect(res.any).toBe(false);
    expect(res.shifts).toEqual([]);
  });

  it('is deterministic', () => {
    const prev = ma({ es: -0.4, i2: 10, k: 5 });
    const curr = ma({ es: 0.6, lo: 0.4, hi: 0.8, i2: 60, k: 8 });
    expect(JSON.stringify(detectEvidenceShift(prev, curr)))
      .toBe(JSON.stringify(detectEvidenceShift(prev, curr)));
  });
});
