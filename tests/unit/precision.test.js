/**
 * precision.test.js
 * Unit tests for the centralised display-precision formatting system.
 * Covers prompt15 Task 1 testing requirements:
 *   1. formatter returns 3 decimals by default
 *   2. formatter supports 2–6 decimals
 *   3. optional trailing-zeros behaviour
 *   4. p-value formatting (incl. "<0.001")
 *   5. raw numeric values are never mutated/rounded by the formatter
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DECIMALS,
  DECIMAL_OPTIONS,
  clampDecimals,
  normalizePrecision,
  fmtNum,
  fmtES,
  fmtCI,
  fmtEstCI,
  fmtP,
  fmtPct,
  fmtI2,
  fmtWeight,
  fmtInt,
} from '../../src/research-engine/format/precision.js';

describe('defaults & config', () => {
  it('default is 3 decimals', () => {
    expect(DEFAULT_DECIMALS).toBe(3);
    expect(fmtNum(0.61572)).toBe('0.616');
  });

  it('offers 2/3/4/5/6 as decimal options', () => {
    expect(DECIMAL_OPTIONS).toEqual([2, 3, 4, 5, 6]);
  });

  it('clampDecimals bounds to [0,6] with fallback 3', () => {
    expect(clampDecimals(4)).toBe(4);
    expect(clampDecimals(99)).toBe(6);
    expect(clampDecimals(-5)).toBe(0);
    expect(clampDecimals('nope')).toBe(3);
    expect(clampDecimals(undefined)).toBe(3);
  });

  it('normalizePrecision accepts number, object, or undefined', () => {
    expect(normalizePrecision(undefined)).toEqual({ decimals: 3, trailingZeros: true, full: false });
    expect(normalizePrecision(4)).toEqual({ decimals: 4, trailingZeros: true, full: false });
    expect(normalizePrecision({ decimals: 5, trailingZeros: false })).toEqual({ decimals: 5, trailingZeros: false, full: false });
    expect(normalizePrecision({ full: true }).full).toBe(true);
  });
});

describe('fmtNum', () => {
  it('rounds to the requested decimals (2–6)', () => {
    const x = 1.0152834;
    expect(fmtNum(x, 2)).toBe('1.02');
    expect(fmtNum(x, 3)).toBe('1.015');
    expect(fmtNum(x, 4)).toBe('1.0153');
    expect(fmtNum(x, 5)).toBe('1.01528');
    expect(fmtNum(x, 6)).toBe('1.015283');
  });

  it('keeps trailing zeros by default', () => {
    expect(fmtNum(14.5, 3)).toBe('14.500');
    expect(fmtNum(0.5, 3)).toBe('0.500');
  });

  it('strips trailing zeros when trailingZeros=false', () => {
    expect(fmtNum(14.5, { decimals: 3, trailingZeros: false })).toBe('14.5');
    expect(fmtNum(1.0, { decimals: 3, trailingZeros: false })).toBe('1');
    expect(fmtNum(0.61, { decimals: 4, trailingZeros: false })).toBe('0.61');
  });

  it('full precision emits the raw value unrounded', () => {
    expect(fmtNum(0.123456789, { full: true })).toBe('0.123456789');
  });

  it('returns dash for blank / non-finite input', () => {
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum(undefined)).toBe('—');
    expect(fmtNum('')).toBe('—');
    expect(fmtNum(NaN)).toBe('—');
    expect(fmtNum(Infinity)).toBe('—');
    expect(fmtNum('abc')).toBe('—');
    expect(fmtNum(null, 3, 'n/a')).toBe('n/a');
  });

  it('accepts numeric strings', () => {
    expect(fmtNum('0.6157', 3)).toBe('0.616');
  });

  it('does not emit negative zero', () => {
    expect(fmtNum(-0.0001, 2)).toBe('0.00');
  });
});

describe('fmtES / fmtCI / fmtEstCI (metafor validation targets)', () => {
  // Values from the prompt15 validation table (back-transformed point + CI).
  it('formats estimate + CI at 3 decimals', () => {
    expect(fmtEstCI(0.6157, 0.3418, 1.1103)).toBe('0.616 (0.342, 1.110)');
    expect(fmtEstCI(0.7942, 0.5971, 1.0563)).toBe('0.794 (0.597, 1.056)');
    expect(fmtEstCI(1.0153, 0.5031, 2.0492)).toBe('1.015 (0.503, 2.049)');
    expect(fmtEstCI(0.9771, 0.7939, 1.2026)).toBe('0.977 (0.794, 1.203)');
  });

  it('fmtCI joins with the given separator', () => {
    expect(fmtCI(0.342, 1.11, 3)).toBe('0.342, 1.110');
    expect(fmtCI(0.342, 1.11, 3, ' to ')).toBe('0.342 to 1.110');
  });

  it('fmtES honours widened precision', () => {
    expect(fmtES(0.6157432, 5)).toBe('0.61574');
  });
});

describe('fmtP (p-values)', () => {
  it('defaults to 3 decimals', () => {
    expect(fmtP(0.0234)).toBe('0.023');
    expect(fmtP(0.5)).toBe('0.500');
  });

  it('collapses very small p to <0.001 by default', () => {
    expect(fmtP(0.0001)).toBe('<0.001');
    expect(fmtP(0)).toBe('<0.001');
  });

  it('threshold tracks widened precision', () => {
    expect(fmtP(0.0001, 4)).toBe('0.0001');
    expect(fmtP(0.00001, 4)).toBe('<0.0001');
  });

  it('never shows fewer than 3 decimals even at 2-dp project precision', () => {
    expect(fmtP(0.0012, 2)).toBe('0.001');
  });

  it('full precision shows the raw p-value', () => {
    expect(fmtP(0.00001234, { full: true })).toBe('0.00001234');
  });

  it('returns dash for invalid', () => {
    expect(fmtP(null)).toBe('—');
    expect(fmtP('x')).toBe('—');
  });
});

describe('fmtPct / fmtI2 / fmtWeight (percentages default 1 dp)', () => {
  it('I² defaults to 1 decimal', () => {
    expect(fmtI2(61.34)).toBe('61.3');
    expect(fmtI2(0)).toBe('0.0');
  });

  it('weights default to 1 decimal', () => {
    expect(fmtWeight(12.345)).toBe('12.3');
  });

  it('percentages stay at 1 dp regardless of project effect precision', () => {
    expect(fmtPct(61.3456, 2)).toBe('61.3');
    expect(fmtPct(61.3456, 4)).toBe('61.3'); // does NOT track effect precision
  });

  it('an explicit default widens a percentage', () => {
    expect(fmtPct(61.3456, 3, 2)).toBe('61.35');
  });

  it('full precision captures the raw percentage', () => {
    expect(fmtPct(61.345678, { full: true })).toBe('61.345678');
  });
});

describe('fmtInt (counts)', () => {
  it('renders integers with no decimals', () => {
    expect(fmtInt(4)).toBe('4');
    expect(fmtInt(4.7)).toBe('5');
    expect(fmtInt('12')).toBe('12');
  });
  it('dash for invalid', () => {
    expect(fmtInt(null)).toBe('—');
  });
});

describe('formatter never mutates underlying values', () => {
  it('returns strings and leaves the input number untouched', () => {
    const raw = 0.123456789;
    const out = fmtNum(raw, 3);
    expect(typeof out).toBe('string');
    expect(out).toBe('0.123');
    // raw is a primitive — confirm full precision still available afterwards
    expect(raw).toBe(0.123456789);
    expect(fmtNum(raw, { full: true })).toBe('0.123456789');
  });

  it('object precision config is not mutated', () => {
    const cfg = { decimals: 5 };
    fmtNum(1.23456789, cfg);
    expect(cfg).toEqual({ decimals: 5 });
  });
});
