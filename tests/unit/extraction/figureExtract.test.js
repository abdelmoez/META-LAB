/**
 * figureExtract.test.js — click-based figure extraction (digitizer).
 * Covers: forest row on a log axis, bar chart SE→SD conversion + baseline
 * warning, box plot cross-checked against the repo CONVERSIONS median_iqr
 * converter, scatter mapping, and KM trace cleaning.
 */

import { describe, it, expect } from 'vitest';
import { mkCalibration } from '../../../src/research-engine/extraction/digitizer/calibration.js';
import {
  forestFromClicks,
  barsFromClicks,
  boxFromClicks,
  scatterFromClicks,
  kmPointsFromTrace,
} from '../../../src/research-engine/extraction/digitizer/figureExtract.js';
import { CONVERSIONS } from '../../../src/research-engine/statistics/monolithStats.js';

/** Linear cal: x px 0..600 → 0..60; y py 400 (bottom) → 0, py 0 (top) → 100. */
function linearCal() {
  const { cal } = mkCalibration({
    x: { p1: { px: 0, value: 0 }, p2: { px: 600, value: 60 } },
    y: { p1: { px: 400, value: 0 }, p2: { px: 0, value: 100 } },
  });
  return cal;
}

/** Forest cal: log x axis, px 0 → ratio 0.1, px 100 → ratio 10. */
function logForestCal() {
  const { cal } = mkCalibration({
    x: { p1: { px: 0, value: 0.1 }, p2: { px: 100, value: 10 }, log: true },
    y: { p1: { px: 400, value: 0 }, p2: { px: 0, value: 100 } },
  });
  return cal;
}

/** Pixel x-position of a ratio on the logForestCal x axis. */
const ratioPx = (v) => ((Math.log10(v) + 1) / 2) * 100;

describe('forestFromClicks', () => {
  it('recovers a forest row clicked at known ratios on a log axis', () => {
    const cal = logForestCal();
    const row = forestFromClicks({
      pointPx: ratioPx(1), // 50
      loPx: ratioPx(0.5), // ≈ 34.9485
      hiPx: ratioPx(2), // ≈ 65.0515
      cal,
    });
    expect(row).not.toBeNull();
    expect(row.est).toBeCloseTo(1, 6);
    expect(row.lo).toBeCloseTo(0.5, 6);
    expect(row.hi).toBeCloseTo(2, 6);
  });

  it('sorts so lo ≤ est ≤ hi even when the whisker clicks arrive swapped', () => {
    const cal = logForestCal();
    const row = forestFromClicks({
      pointPx: ratioPx(1.5),
      loPx: ratioPx(3), // "lo" click actually on the upper whisker
      hiPx: ratioPx(0.8),
      cal,
    });
    expect(row.lo).toBeCloseTo(0.8, 6);
    expect(row.est).toBeCloseTo(1.5, 6);
    expect(row.hi).toBeCloseTo(3, 6);
  });

  it('supports vertical orientation (values on the y axis)', () => {
    const cal = linearCal(); // y: py 400 → 0, py 0 → 100
    const row = forestFromClicks({ pointPx: 200, loPx: 240, hiPx: 160, cal, orientation: 'v' });
    expect(row.est).toBeCloseTo(50, 9);
    expect(row.lo).toBeCloseTo(40, 9); // py 240 → lower value
    expect(row.hi).toBeCloseTo(60, 9);
  });

  it('returns null on a missing calibration or missing clicks (never throws)', () => {
    expect(forestFromClicks({ pointPx: 1, loPx: 2, hiPx: 3, cal: null })).toBeNull();
    expect(forestFromClicks({ pointPx: 1, loPx: 'x', hiPx: 3, cal: logForestCal() })).toBeNull();
    expect(forestFromClicks()).toBeNull();
  });
});

describe('barsFromClicks', () => {
  // linearCal y axis: py(v) = 400 − 4v (100 data units over 400 px).
  it('converts SE spread to SD via spread·√n', () => {
    const cal = linearCal();
    const { arms, warnings } = barsFromClicks({
      arms: [{ label: 'Drug', topPx: 200, capPx: 180, n: 25 }],
      zeroPx: 400,
      cal,
      errorType: 'SE',
    });
    expect(warnings).toEqual([]);
    expect(arms).toHaveLength(1);
    expect(arms[0].mean).toBeCloseTo(50, 9); // py 200 → 50
    expect(arms[0].spread).toBeCloseTo(5, 9); // py 180 → 55; |55−50| = 5
    expect(arms[0].sd).toBeCloseTo(25, 9); // 5·√25
    expect(arms[0].n).toBe(25);
  });

  it('uses the spread directly when errorType is SD', () => {
    const cal = linearCal();
    const { arms } = barsFromClicks({
      arms: [{ label: 'Placebo', topPx: 280, capPx: 260, n: 30 }],
      cal,
      errorType: 'SD',
    });
    expect(arms[0].mean).toBeCloseTo(30, 9);
    expect(arms[0].spread).toBeCloseTo(5, 9);
    expect(arms[0].sd).toBeCloseTo(5, 9);
  });

  it('leaves sd null + warns when errorType is SE but n is missing', () => {
    const cal = linearCal();
    const { arms, warnings } = barsFromClicks({
      arms: [{ label: 'A', topPx: 200, capPx: 180 }],
      cal,
      errorType: 'SE',
    });
    expect(arms[0].spread).toBeCloseTo(5, 9);
    expect(arms[0].sd).toBeNull();
    expect(warnings.join(' ')).toMatch(/needs n/);
  });

  it('leaves spread and sd null when no cap was clicked', () => {
    const cal = linearCal();
    const { arms, warnings } = barsFromClicks({
      arms: [{ label: 'A', topPx: 100, n: 10 }],
      cal,
      errorType: 'SD',
    });
    expect(arms[0].mean).toBeCloseTo(75, 9);
    expect(arms[0].spread).toBeNull();
    expect(arms[0].sd).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('warns when the clicked baseline is not zero (truncated axis)', () => {
    const cal = linearCal();
    const { warnings } = barsFromClicks({
      arms: [{ label: 'A', topPx: 200, capPx: 180, n: 4 }],
      zeroPx: 380, // maps to 5, not 0
      cal,
      errorType: 'SE',
    });
    expect(warnings.join(' ')).toMatch(/truncated/);
  });

  it('returns an empty result for malformed input (never throws)', () => {
    expect(barsFromClicks()).toEqual({ arms: [], warnings: [] });
    expect(barsFromClicks({ arms: 'nope', cal: linearCal() }).arms).toEqual([]);
  });
});

describe('boxFromClicks', () => {
  // y axis: py 400 → 0, py 0 → 40, i.e. py(v) = 400 − 10v.
  function boxCal() {
    const { cal } = mkCalibration({
      x: { p1: { px: 0, value: 0 }, p2: { px: 600, value: 60 } },
      y: { p1: { px: 400, value: 0 }, p2: { px: 0, value: 40 } },
    });
    return cal;
  }

  it('matches the repo CONVERSIONS median_iqr converter (Wan et al. 2014)', () => {
    const cal = boxCal();
    // q1 = 10, median = 15, q3 = 22 → py 300 / 250 / 180.
    const r = boxFromClicks({ q1Px: 300, medianPx: 250, q3Px: 180, n: 40, cal });
    expect(r.ok).toBe(true);
    expect(r.q1).toBeCloseTo(10, 9);
    expect(r.median).toBeCloseTo(15, 9);
    expect(r.q3).toBeCloseTo(22, 9);

    const medianIqr = CONVERSIONS.find((c) => c.id === 'median_iqr');
    expect(medianIqr).toBeDefined();
    const ref = medianIqr.run({ q1: 10, med: 15, q3: 22, n: 40 });
    expect(ref.ok).toBe(true);
    // CONVERSIONS rounds to 4dp; the digitizer keeps full precision → 1e-3 window.
    expect(Math.abs(r.mean - ref.values.mean)).toBeLessThan(1e-3);
    expect(Math.abs(r.sd - ref.values.sd)).toBeLessThan(1e-3);
  });

  it('rejects n < 2', () => {
    const r = boxFromClicks({ q1Px: 300, medianPx: 250, q3Px: 180, n: 1, cal: boxCal() });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/n must/);
  });

  it('rejects mislabelled clicks (q1 > median after mapping)', () => {
    // Swapping q1Px and q3Px puts q1 at 22 and q3 at 10 — must NOT silently reorder.
    const r = boxFromClicks({ q1Px: 180, medianPx: 250, q3Px: 300, n: 40, cal: boxCal() });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/q1 ≤ median ≤ q3/);
  });

  it('rejects a missing calibration or non-numeric clicks (never throws)', () => {
    expect(boxFromClicks({ q1Px: 1, medianPx: 2, q3Px: 3, n: 10, cal: null }).ok).toBe(false);
    expect(boxFromClicks({ q1Px: 'a', medianPx: 250, q3Px: 180, n: 10, cal: boxCal() }).ok).toBe(false);
    expect(boxFromClicks().ok).toBe(false);
  });
});

describe('scatterFromClicks', () => {
  it('maps a point cloud to data units and skips malformed points', () => {
    const cal = linearCal();
    const pts = scatterFromClicks({
      points: [
        { px: 300, py: 200 }, // → (30, 50)
        { px: 0, py: 400 }, // → (0, 0)
        { px: 'x', py: 10 }, // malformed → skipped
        null, // malformed → skipped
        { px: 600, py: 0 }, // → (60, 100)
      ],
      cal,
    });
    expect(pts).toHaveLength(3);
    expect(pts[0].x).toBeCloseTo(30, 9);
    expect(pts[0].y).toBeCloseTo(50, 9);
    expect(pts[1]).toEqual({ x: 0, y: 0 });
    expect(pts[2].x).toBeCloseTo(60, 9);
    expect(pts[2].y).toBeCloseTo(100, 9);
  });

  it('returns [] for malformed input (never throws)', () => {
    expect(scatterFromClicks()).toEqual([]);
    expect(scatterFromClicks({ points: null, cal: linearCal() })).toEqual([]);
    expect(scatterFromClicks({ points: [{ px: 1, py: 2 }], cal: {} })).toEqual([]);
  });
});

describe('kmPointsFromTrace', () => {
  /** KM cal: x px 0..500 → t 0..50; y py 400 → s 0, py 0 → s 1 (py(s) = 400 − 400s). */
  function kmCal() {
    const { cal } = mkCalibration({
      x: { p1: { px: 0, value: 0 }, p2: { px: 500, value: 50 } },
      y: { p1: { px: 400, value: 0 }, p2: { px: 0, value: 1 } },
    });
    return cal;
  }

  // Unsorted trace with s > 1 noise at t=0 and a non-monotone wiggle at t=25.
  const rawPoints = [
    { px: 200, py: 120 }, // t 20, s 0.70
    { px: 0, py: -4 }, // t 0,  s 1.01 → clamp to 1
    { px: 400, py: 240 }, // t 40, s 0.40
    { px: 100, py: 80 }, // t 10, s 0.80
    { px: 250, py: 100 }, // t 25, s 0.75 — WIGGLE above the t=20 value
    { px: 'x', py: 5 }, // malformed → skipped
  ];

  it('sorts by t, clamps s to [0,1], and forces non-increasing survival', () => {
    const pts = kmPointsFromTrace({ points: rawPoints, cal: kmCal() });
    expect(pts.map((p) => p.t)).toEqual([0, 10, 20, 25, 40]);
    expect(pts[0].s).toBe(1); // 1.01 noise clamped to 1
    expect(pts[1].s).toBeCloseTo(0.8, 9);
    expect(pts[2].s).toBeCloseTo(0.7, 9);
    expect(pts[3].s).toBeCloseTo(0.7, 9); // wiggle 0.75 capped at running min
    expect(pts[4].s).toBeCloseTo(0.4, 9);
    // Global invariants.
    for (let i = 0; i < pts.length; i++) {
      expect(pts[i].s).toBeGreaterThanOrEqual(0);
      expect(pts[i].s).toBeLessThanOrEqual(1);
      if (i > 0) {
        expect(pts[i].t).toBeGreaterThanOrEqual(pts[i - 1].t);
        expect(pts[i].s).toBeLessThanOrEqual(pts[i - 1].s);
      }
    }
  });

  it('keeps the wiggle when clampMonotone is false (but still clamps [0,1] and sorts)', () => {
    const pts = kmPointsFromTrace({ points: rawPoints, cal: kmCal(), clampMonotone: false });
    expect(pts.map((p) => p.t)).toEqual([0, 10, 20, 25, 40]);
    expect(pts[0].s).toBe(1); // [0,1] clamp still applies
    expect(pts[3].s).toBeCloseTo(0.75, 9); // wiggle preserved
  });

  it('clamps sub-zero tail noise up to 0', () => {
    const pts = kmPointsFromTrace({
      points: [
        { px: 450, py: 404 }, // t 45, s = −0.01 → 0
        { px: 500, py: 410 }, // t 50, s = −0.025 → 0
      ],
      cal: kmCal(),
    });
    expect(pts[0].s).toBe(0);
    expect(pts[1].s).toBe(0);
  });

  it('returns [] for malformed input (never throws)', () => {
    expect(kmPointsFromTrace()).toEqual([]);
    expect(kmPointsFromTrace({ points: 'nope', cal: kmCal() })).toEqual([]);
    expect(kmPointsFromTrace({ points: [{ px: 1, py: 2 }], cal: null })).toEqual([]);
  });
});
