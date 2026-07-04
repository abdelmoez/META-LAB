/**
 * digitizerCalibration.test.js — figure-digitizer axis calibration.
 * Covers: linear + log two-point mapping, y-down inversion, round-trip
 * precision guarantees, validation errors, and the 2-D calibration wrapper.
 */

import { describe, it, expect } from 'vitest';
import { mkAxis, mkCalibration } from '../../../src/research-engine/extraction/digitizer/calibration.js';

describe('mkAxis (linear)', () => {
  it('interpolates linearly between the two calibration points', () => {
    const { ok, axis } = mkAxis({ p1: { px: 0, value: 0 }, p2: { px: 100, value: 50 } });
    expect(ok).toBe(true);
    expect(axis.toData(0)).toBeCloseTo(0, 12);
    expect(axis.toData(100)).toBeCloseTo(50, 12);
    expect(axis.toData(50)).toBeCloseTo(25, 12);
    expect(axis.toData(200)).toBeCloseTo(100, 12); // extrapolates
    expect(axis.toPx(25)).toBeCloseTo(50, 12);
  });

  it('handles an inverted (y-down) axis with zero special-casing', () => {
    // Canvas py grows DOWN: value 0 sits at py 400 (bottom), value 100 at py 0 (top).
    const { ok, axis } = mkAxis({ p1: { px: 400, value: 0 }, p2: { px: 0, value: 100 } });
    expect(ok).toBe(true);
    expect(axis.toData(400)).toBeCloseTo(0, 12);
    expect(axis.toData(0)).toBeCloseTo(100, 12);
    expect(axis.toData(200)).toBeCloseTo(50, 12);
    expect(axis.toPx(75)).toBeCloseTo(100, 12);
  });

  it('round-trips toPx(toData(px)) within 1e-9', () => {
    const { axis } = mkAxis({ p1: { px: 37.2, value: -4.5 }, p2: { px: 913.8, value: 17.25 } });
    for (const px of [-50, 0, 37.2, 123.456, 500, 913.8, 2000]) {
      expect(Math.abs(axis.toPx(axis.toData(px)) - px)).toBeLessThan(1e-9);
    }
  });

  it('returns NaN for non-finite pixel/value inputs', () => {
    const { axis } = mkAxis({ p1: { px: 0, value: 0 }, p2: { px: 100, value: 1 } });
    expect(axis.toData(NaN)).toBeNaN();
    expect(axis.toData('nope')).toBeNaN();
    expect(axis.toData(null)).toBeNaN();
    expect(axis.toPx(undefined)).toBeNaN();
  });
});

describe('mkAxis (log)', () => {
  it('interpolates on log10 and pows back', () => {
    const { ok, axis } = mkAxis({ p1: { px: 0, value: 0.1 }, p2: { px: 100, value: 10 }, log: true });
    expect(ok).toBe(true);
    expect(axis.toData(0)).toBeCloseTo(0.1, 9);
    expect(axis.toData(100)).toBeCloseTo(10, 9);
    expect(axis.toData(50)).toBeCloseTo(1, 9); // geometric midpoint
    expect(axis.toPx(1)).toBeCloseTo(50, 9);
    expect(axis.toPx(0.5)).toBeCloseTo(50 + (Math.log10(0.5) / 2) * 100, 9);
  });

  it('round-trips toPx(toData(px)) within 1e-6', () => {
    const { axis } = mkAxis({ p1: { px: 12, value: 0.02 }, p2: { px: 640, value: 50 }, log: true });
    for (const px of [12, 100, 333.33, 500, 640, 900]) {
      expect(Math.abs(axis.toPx(axis.toData(px)) - px)).toBeLessThan(1e-6);
    }
  });

  it('toPx returns NaN for non-positive values on a log axis', () => {
    const { axis } = mkAxis({ p1: { px: 0, value: 0.1 }, p2: { px: 100, value: 10 }, log: true });
    expect(axis.toPx(0)).toBeNaN();
    expect(axis.toPx(-2)).toBeNaN();
  });
});

describe('mkAxis validation', () => {
  it('rejects identical calibration pixels', () => {
    const r = mkAxis({ p1: { px: 50, value: 0 }, p2: { px: 50, value: 10 } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/px/);
  });

  it('rejects identical calibration values', () => {
    const r = mkAxis({ p1: { px: 0, value: 5 }, p2: { px: 100, value: 5 } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/values/);
  });

  it('rejects a log axis with a non-positive calibration value', () => {
    expect(mkAxis({ p1: { px: 0, value: 0 }, p2: { px: 100, value: 10 }, log: true }).ok).toBe(false);
    expect(mkAxis({ p1: { px: 0, value: -1 }, p2: { px: 100, value: 10 }, log: true }).ok).toBe(false);
  });

  it('rejects missing or non-numeric points without throwing', () => {
    expect(mkAxis().ok).toBe(false);
    expect(mkAxis(null).ok).toBe(false);
    expect(mkAxis({ p1: { px: 0 }, p2: { px: 100, value: 10 } }).ok).toBe(false);
    expect(mkAxis({ p1: { px: 'a', value: 1 }, p2: { px: 100, value: 10 } }).ok).toBe(false);
  });
});

describe('mkCalibration', () => {
  // A typical plot region: x 0..600 px maps 0..60 data; y 400..0 px maps 0..100 data
  // (py grows DOWN, data y grows up — larger value ↔ smaller py).
  const spec = {
    x: { p1: { px: 0, value: 0 }, p2: { px: 600, value: 60 } },
    y: { p1: { px: 400, value: 0 }, p2: { px: 0, value: 100 } },
  };

  it('maps canvas points to data points (y inversion handled by the two-point mapping)', () => {
    const { ok, cal } = mkCalibration(spec);
    expect(ok).toBe(true);
    const d = cal.toData({ px: 300, py: 100 });
    expect(d.x).toBeCloseTo(30, 12);
    expect(d.y).toBeCloseTo(75, 12); // py 100 is near the TOP → high data value
    const p = cal.toPx({ x: 30, y: 75 });
    expect(p.px).toBeCloseTo(300, 12);
    expect(p.py).toBeCloseTo(100, 12);
  });

  it('round-trips toPx(toData(p)) within 1e-9 (linear axes)', () => {
    const { cal } = mkCalibration(spec);
    for (const p of [{ px: 0, py: 400 }, { px: 600, py: 0 }, { px: 123.4, py: 321.9 }]) {
      const back = cal.toPx(cal.toData(p));
      expect(Math.abs(back.px - p.px)).toBeLessThan(1e-9);
      expect(Math.abs(back.py - p.py)).toBeLessThan(1e-9);
    }
  });

  it('round-trips within 1e-6 with a log x axis', () => {
    const { ok, cal } = mkCalibration({
      x: { p1: { px: 0, value: 0.1 }, p2: { px: 100, value: 10 }, log: true },
      y: spec.y,
    });
    expect(ok).toBe(true);
    for (const p of [{ px: 0, py: 400 }, { px: 34.9485, py: 137 }, { px: 100, py: 0 }]) {
      const back = cal.toPx(cal.toData(p));
      expect(Math.abs(back.px - p.px)).toBeLessThan(1e-6);
      expect(Math.abs(back.py - p.py)).toBeLessThan(1e-6);
    }
  });

  it('propagates axis validation failures with the axis named', () => {
    const bad = mkCalibration({ x: { p1: { px: 0, value: 0 }, p2: { px: 0, value: 1 } }, y: spec.y });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/^x axis:/);
    const badY = mkCalibration({ x: spec.x, y: null });
    expect(badY.ok).toBe(false);
    expect(badY.error).toMatch(/^y axis:/);
  });

  it('exposes the individual axes for single-axis consumers', () => {
    const { cal } = mkCalibration(spec);
    expect(cal.x.toData(300)).toBeCloseTo(30, 12);
    expect(cal.y.toData(200)).toBeCloseTo(50, 12);
  });
});
