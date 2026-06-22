/**
 * chartFormat.test.js — WS4 (prompt 50): interactive forest/funnel plot number
 * formatting. Verifies the chart formatter is bounded, readable, edge-case safe,
 * and INDEPENDENT of export precision (it never honours `full`).
 */
import { describe, it, expect } from 'vitest';
import {
  chartNum, chartES, chartCI, chartPct, chartI2, chartWeight, chartP,
  chartAxisTick, chartDecimals, CHART_MAX_DECIMALS,
} from '../../src/research-engine/format/chartFormat.js';

describe('chartNum — bounded, readable chart numbers', () => {
  it('formats ordinary values at the default 3 dp', () => {
    expect(chartNum(0.6157)).toBe('0.616');
    expect(chartNum(1.5)).toBe('1.500');
    expect(chartNum(-0.25)).toBe('-0.250');
  });

  it('respects a 2-dp project precision', () => {
    expect(chartNum(0.6157, { decimals: 2 })).toBe('0.62');
    expect(chartNum(1.239, 2)).toBe('1.24');
  });

  it('caps decimals at CHART_MAX_DECIMALS even when the project asks for more', () => {
    // project precision 6 dp → chart still caps at 4 (readability)
    expect(chartNum(0.123456789, { decimals: 6 })).toBe('0.1235');
    expect(CHART_MAX_DECIMALS).toBe(4);
  });

  it('IGNORES full precision (the export-only raw mode) — THE WS4 BUG', () => {
    // precision.js would emit String(n) here ("0.00000000000000000"-style noise).
    expect(chartNum(0, { full: true })).toBe('0.000');
    expect(chartNum(0.00000000000000001, { full: true })).toBe('0.000');
    expect(chartNum(0.6157, { full: true, decimals: 3 })).toBe('0.616');
  });

  it('renders a clean zero for true zero and round-to-zero values', () => {
    expect(chartNum(0)).toBe('0.000');
    expect(chartNum(0, { decimals: 2 })).toBe('0.00');
    // a tiny non-zero that rounds to zero must NOT show a wall of digits
    expect(chartNum(1e-15)).toBe('0.000');
    expect(chartNum(2.3e-9, { decimals: 2 })).toBe('0.00');
  });

  it('normalises negative zero to a plain zero (no -0.00)', () => {
    expect(chartNum(-0)).toBe('0.000');
    expect(chartNum(-0.0001, { decimals: 2 })).toBe('0.00');
    expect(chartNum(-0.000000001)).toBe('0.000');
    expect(chartNum(-0.00004, { decimals: 3 })).toBe('0.000');
  });

  it('collapses very large magnitudes to scientific notation', () => {
    expect(chartNum(1e7)).toBe('1e+7');
    expect(chartNum(1.5e8)).toBe('1.5e+8');
    expect(chartNum(-2.5e9, { decimals: 2 })).toBe('-2.5e+9');
  });

  it('handles non-finite + missing inputs', () => {
    expect(chartNum(NaN)).toBe('—');
    expect(chartNum(null)).toBe('—');
    expect(chartNum(undefined)).toBe('—');
    expect(chartNum('')).toBe('—');
    expect(chartNum(Infinity)).toBe('∞');
    expect(chartNum(-Infinity)).toBe('−∞');
  });

  it('accepts numeric strings', () => {
    expect(chartNum('0.5')).toBe('0.500');
    expect(chartNum('abc')).toBe('—');
  });

  it('can strip trailing zeros when asked', () => {
    expect(chartNum(1.5, { decimals: 3, trailingZeros: false })).toBe('1.5');
    expect(chartNum(2, { decimals: 3, trailingZeros: false }, )).toBe('2');
  });
});

describe('chartES / chartCI — effect estimates & intervals', () => {
  it('formats an effect estimate near 1 without floating noise', () => {
    expect(chartES(1.0000000000000002)).toBe('1.000');
    expect(chartES(0.9999999999)).toBe('1.000');
  });
  it('handles negative effects and ratios crossing 1 / 0', () => {
    expect(chartES(-0.5)).toBe('-0.500');
    expect(chartCI(-0.2, 0.3)).toBe('-0.200, 0.300');
    expect(chartCI(0.8, 1.4)).toBe('0.800, 1.400');
  });
  it('caps effect estimates at 3 dp even for a 6-dp project', () => {
    expect(chartES(0.123456, { decimals: 6 })).toBe('0.123');
  });
  it('renders missing CI bound as a dash', () => {
    expect(chartCI(null, 1.2)).toBe('—, 1.200');
  });
});

describe('chartPct / chartI2 / chartWeight — percentages (1 dp)', () => {
  it('formats I² and weights at 1 dp regardless of effect precision', () => {
    expect(chartI2(61.3408)).toBe('61.3');
    expect(chartWeight(12.34)).toBe('12.3');
    expect(chartPct(0)).toBe('0.0');
  });
  it('handles non-finite percentages', () => {
    expect(chartI2(NaN)).toBe('—');
    expect(chartWeight(null)).toBe('—');
  });
});

describe('chartP — p-values', () => {
  it('shows ≥3 dp and a <0.001 threshold for tiny p', () => {
    expect(chartP(0.0324)).toBe('0.032');
    expect(chartP(0.0000001)).toBe('<0.001');
    expect(chartP(0)).toBe('<0.001');
  });
  it('does not emit a row of zeros for an essentially-zero p', () => {
    expect(chartP(1e-18)).toBe('<0.001');
  });
  it('dashes a missing p', () => {
    expect(chartP(null)).toBe('—');
  });
});

describe('chartAxisTick — back-transformed axis labels', () => {
  it('formats ratio (log) ticks readably', () => {
    expect(chartAxisTick(1, { isLog: true })).toBe('1');
    expect(chartAxisTick(0.5, { isLog: true })).toBe('0.5');
    expect(chartAxisTick(2, { isLog: true })).toBe('2');
    expect(chartAxisTick(1.0000000000000002, { isLog: true })).toBe('1');
  });
  it('collapses huge / tiny ratio ticks', () => {
    expect(chartAxisTick(5000, { isLog: true })).toBe('5000');
    expect(chartAxisTick(0.0002, { isLog: true })).toBe('0.000');
  });
  it('formats proportion ticks as percentages', () => {
    expect(chartAxisTick(0.5, { isProp: true })).toBe('50%');
    expect(chartAxisTick(0.123, { isProp: true })).toBe('12.3%');
  });
  it('formats linear grid values at ≤2 dp', () => {
    expect(chartAxisTick(0)).toBe('0');
    expect(chartAxisTick(-1.5)).toBe('-1.5');
    expect(chartAxisTick(0.0000000001)).toBe('0');
  });
});

describe('chartDecimals helper', () => {
  it('caps and ignores full', () => {
    expect(chartDecimals({ decimals: 6 })).toBe(CHART_MAX_DECIMALS);
    expect(chartDecimals({ decimals: 2 })).toBe(2);
    expect(chartDecimals(undefined)).toBe(3);
  });
});
