import { describe, it, expect } from 'vitest';
import { autoCalibrateAxis, pxToValue, valueToPx } from '../../../src/research-engine/extraction/digitizer/autoCalibrate.js';

/** Evenly spaced clean linear ticks: value === px on 0..100. */
const LINEAR_TICKS = [0, 25, 50, 75, 100].map((v) => ({ px: v, value: v }));

/** Forest-plot decades 0.1 / 1 / 10 evenly spaced in px. */
const LOG_TICKS = [
  { px: 0, value: 0.1 },
  { px: 50, value: 1 },
  { px: 100, value: 10 },
];

describe('autoCalibrateAxis — deterministic axis auto-calibration (§22.1–22.5)', () => {
  it('fits a clean linear axis with scale linear and auto:true', () => {
    const fit = autoCalibrateAxis(LINEAR_TICKS);
    expect(fit).not.toBeNull();
    expect(fit.scale).toBe('linear');
    expect(fit.auto).toBe(true);
    expect(fit.warnings).toEqual([]);
    expect(fit.r2).toBeGreaterThanOrEqual(0.999);
    expect(fit.a).toBeCloseTo(1, 9);
    expect(fit.b).toBeCloseTo(0, 9);
    expect(fit.domain).toEqual([0, 100]);
    expect(pxToValue(fit, 37)).toBeCloseTo(37, 9);
    expect(valueToPx(fit, 62)).toBeCloseTo(62, 9);
  });

  it('detects the 0.1 / 1 / 10 forest-plot axis as log with auto:true', () => {
    const fit = autoCalibrateAxis(LOG_TICKS, { ratioMeasure: true });
    expect(fit).not.toBeNull();
    expect(fit.scale).toBe('log');
    expect(fit.auto).toBe(true);
    expect(fit.r2).toBeCloseTo(1, 9);
    // ln(value) = a·px + b with a = ln(10)/50 and b = ln(0.1)
    expect(fit.a).toBeCloseTo(Math.log(10) / 50, 9);
    expect(fit.b).toBeCloseTo(Math.log(0.1), 9);
    expect(pxToValue(fit, 50)).toBeCloseTo(1, 9);
    expect(pxToValue(fit, 75)).toBeCloseTo(Math.sqrt(10), 9);
    expect(valueToPx(fit, 10)).toBeCloseTo(100, 9);
  });

  it('picks log even WITHOUT ratioMeasure when it is clearly the better fit', () => {
    const fit = autoCalibrateAxis(LOG_TICKS);
    expect(fit.scale).toBe('log');
  });

  it('prefers linear on a near-tie unless ratioMeasure is set (§22.4 modest prior)', () => {
    // value = px: BOTH exact-fit candidates are unavailable here (log of a
    // 0-crossing axis is skipped), so use strictly positive linear values where
    // linear is perfect and log is merely very good — linear must win.
    const ticks = [10, 20, 30, 40, 50].map((v) => ({ px: v, value: v }));
    const fit = autoCalibrateAxis(ticks);
    expect(fit.scale).toBe('linear');
    expect(fit.auto).toBe(true);
  });

  it('round-trips pxToValue ↔ valueToPx on both scales', () => {
    const lin = autoCalibrateAxis(LINEAR_TICKS);
    expect(valueToPx(lin, pxToValue(lin, 33))).toBeCloseTo(33, 9);
    const log = autoCalibrateAxis(LOG_TICKS, { ratioMeasure: true });
    expect(valueToPx(log, pxToValue(log, 42))).toBeCloseTo(42, 9);
  });

  it('flags a shuffled / non-monotonic tick set as auto:false with a warning', () => {
    const fit = autoCalibrateAxis([
      { px: 50, value: 50 },
      { px: 0, value: 0 },
      { px: 100, value: 100 },
    ]);
    expect(fit).not.toBeNull();
    expect(fit.auto).toBe(false);
    expect(fit.warnings.join(' ')).toMatch(/monotonic/);
    // the best fit is still returned for confirm-mode
    expect(fit.r2).toBeCloseTo(1, 9);
  });

  it('returns null for fewer than 3 ticks or empty/malformed input', () => {
    expect(autoCalibrateAxis([{ px: 0, value: 0 }, { px: 100, value: 100 }])).toBeNull();
    expect(autoCalibrateAxis([])).toBeNull();
    expect(autoCalibrateAxis(null)).toBeNull();
    expect(autoCalibrateAxis('not an array')).toBeNull();
  });

  it('handles duplicate px positions (dedupe + warning, auto:false)', () => {
    const fit = autoCalibrateAxis([
      { px: 0, value: 0 },
      { px: 0, value: 5 },
      { px: 50, value: 50 },
      { px: 100, value: 100 },
    ]);
    expect(fit).not.toBeNull();
    expect(fit.ticks).toHaveLength(3);
    expect(fit.auto).toBe(false);
    expect(fit.warnings.join(' ')).toMatch(/duplicate/);
  });

  it('fails the R² gate on a slightly-noisy axis (auto:false, r2 < 0.999)', () => {
    const fit = autoCalibrateAxis([
      { px: 0, value: 0 },
      { px: 25, value: 27 },
      { px: 50, value: 49 },
      { px: 75, value: 78 },
      { px: 100, value: 100 },
    ]);
    expect(fit).not.toBeNull();
    expect(fit.r2).toBeLessThan(0.999);
    expect(fit.auto).toBe(false);
    expect(fit.warnings.join(' ')).toMatch(/0\.999/);
  });

  it('flags uneven tick spacing (§22.5 near-even gate)', () => {
    const fit = autoCalibrateAxis([
      { px: 0, value: 0 },
      { px: 10, value: 10 },
      { px: 100, value: 100 },
    ]);
    expect(fit).not.toBeNull();
    expect(fit.auto).toBe(false);
    expect(fit.warnings.join(' ')).toMatch(/spacing/);
  });

  it('handles negative-value axes (log skipped, linear fit)', () => {
    const fit = autoCalibrateAxis([
      { px: 0, value: -10 },
      { px: 50, value: 0 },
      { px: 100, value: 10 },
    ]);
    expect(fit.scale).toBe('linear');
    expect(fit.auto).toBe(true);
    expect(pxToValue(fit, 0)).toBeCloseTo(-10, 9);
  });

  it('ignores non-finite ticks with a warning and never throws on malformed input', () => {
    const fit = autoCalibrateAxis([
      { px: 0, value: 0 },
      { px: 25, value: 25 },
      { px: NaN, value: 3 },
      { px: 50, value: 50 },
      { px: 75, value: 75 },
    ]);
    expect(fit).not.toBeNull();
    expect(fit.ticks).toHaveLength(4);
    expect(fit.auto).toBe(false);
    expect(fit.warnings.join(' ')).toMatch(/ignored/);

    expect(() => autoCalibrateAxis([null, undefined, 'x', { px: 'a', value: {} }])).not.toThrow();
    expect(autoCalibrateAxis([null, undefined, 'x'])).toBeNull();
    // degenerate: identical values everywhere → no fittable variance
    expect(autoCalibrateAxis([{ px: 0, value: 5 }, { px: 50, value: 5 }, { px: 100, value: 5 }])).toBeNull();
  });

  it('AxisFit is fully serializable and the helpers reconstruct from a JSON round-trip', () => {
    const fit = autoCalibrateAxis(LOG_TICKS, { ratioMeasure: true });
    const revived = JSON.parse(JSON.stringify(fit));
    expect(revived).toEqual(fit);
    expect(pxToValue(revived, 100)).toBeCloseTo(10, 9);
    expect(valueToPx(revived, 0.1)).toBeCloseTo(0, 9);
  });

  it('pxToValue / valueToPx are guarded on malformed fits', () => {
    expect(pxToValue(null, 10)).toBeNaN();
    expect(valueToPx(undefined, 10)).toBeNaN();
    expect(pxToValue({ scale: 'linear', a: NaN, b: 0 }, 10)).toBeNaN();
    expect(valueToPx({ scale: 'linear', a: 0, b: 0 }, 10)).toBeNaN();
    expect(valueToPx({ scale: 'log', a: 1, b: 0 }, -1)).toBeNaN();
    const lin = autoCalibrateAxis(LINEAR_TICKS);
    expect(pxToValue(lin, 'not a number')).toBeNaN();
  });
});
