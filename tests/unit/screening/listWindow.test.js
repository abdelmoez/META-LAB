/**
 * listWindow.test.js — 65.md SCR-5: pure windowed-rendering math for the
 * screening record list (slice bounds, spacer heights, scroll-height parity,
 * measurement refinement). No DOM, no React.
 */
import { describe, it, expect } from 'vitest';
import {
  computeListWindow, measuredRowHeight, shouldWindow,
  WINDOW_MIN_COUNT, DEFAULT_OVERSCAN, DEFAULT_ROW_HEIGHT,
} from '../../../src/frontend/screening/lib/listWindow.js';

describe('shouldWindow', () => {
  it('windows only above the minimum count', () => {
    expect(shouldWindow(WINDOW_MIN_COUNT)).toBe(false);
    expect(shouldWindow(WINDOW_MIN_COUNT + 1)).toBe(true);
    expect(shouldWindow(0)).toBe(false);
    expect(shouldWindow(NaN)).toBe(false);
  });
});

describe('computeListWindow', () => {
  const base = { count: 1000, viewportHeight: 500, rowHeight: 50, overscan: 5 };

  it('renders the top slice at scrollTop 0 (no top spacer)', () => {
    const w = computeListWindow({ ...base, scrollTop: 0 });
    expect(w.start).toBe(0);
    expect(w.topPad).toBe(0);
    // 10 visible + 5 overscan below
    expect(w.end).toBe(15);
    expect(w.bottomPad).toBe((1000 - 15) * 50);
  });

  it('centres the slice around the scroll position with overscan on both sides', () => {
    const w = computeListWindow({ ...base, scrollTop: 50 * 100 }); // row 100 at top
    expect(w.start).toBe(95);           // 100 − overscan
    expect(w.end).toBe(115);            // 100 + 10 visible + overscan
    expect(w.topPad).toBe(95 * 50);
  });

  it('preserves total scroll height exactly: topPad + slice + bottomPad = count × rowHeight', () => {
    for (const scrollTop of [0, 1234, 49_000, 60_000]) {
      const w = computeListWindow({ ...base, scrollTop });
      expect(w.topPad + (w.end - w.start) * 50 + w.bottomPad).toBe(1000 * 50);
      expect(w.totalHeight).toBe(1000 * 50);
    }
  });

  it('clamps at the end of the list (no negative bottom spacer, end ≤ count)', () => {
    const w = computeListWindow({ ...base, scrollTop: 10_000_000 });
    expect(w.end).toBe(1000);
    expect(w.bottomPad).toBe(0);
    expect(w.start).toBeLessThanOrEqual(w.end);
    expect(w.topPad).toBeGreaterThanOrEqual(0);
  });

  it('start/end always bound a non-empty visible viewport slice', () => {
    const w = computeListWindow({ ...base, scrollTop: 500 * 50 - 1 });
    expect(w.end - w.start).toBeGreaterThan(0);
    expect(w.start).toBeGreaterThanOrEqual(0);
    expect(w.end).toBeLessThanOrEqual(1000);
  });

  it('empty list → all zeros', () => {
    expect(computeListWindow({ count: 0, scrollTop: 0, viewportHeight: 500 }))
      .toEqual({ start: 0, end: 0, topPad: 0, bottomPad: 0, totalHeight: 0 });
  });

  it('defends against garbage inputs (negative scroll, zero row height, NaN)', () => {
    const w = computeListWindow({ count: 10, scrollTop: -50, viewportHeight: NaN, rowHeight: 0 });
    expect(w.start).toBe(0);
    expect(w.end).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(w.totalHeight)).toBe(true);
    expect(w.totalHeight).toBe(10 * DEFAULT_ROW_HEIGHT); // rowHeight 0 → default
  });

  it('defaults overscan + row height when omitted', () => {
    const w = computeListWindow({ count: 500, scrollTop: 0, viewportHeight: 600 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(Math.ceil(600 / DEFAULT_ROW_HEIGHT) + DEFAULT_OVERSCAN);
  });
});

describe('measuredRowHeight', () => {
  it('adopts a measurement that differs beyond the threshold', () => {
    expect(measuredRowHeight(900, 10, 74)).toBeCloseTo(90, 6);
  });
  it('keeps the previous estimate within the jitter threshold (no re-render loop)', () => {
    expect(measuredRowHeight(750, 10, 74)).toBe(74); // avg 75, |75−74| ≤ 2
  });
  it('ignores degenerate measurements', () => {
    expect(measuredRowHeight(0, 10, 74)).toBe(74);
    expect(measuredRowHeight(500, 0, 74)).toBe(74);
    expect(measuredRowHeight(NaN, 10, 74)).toBe(74);
  });
  it('falls back to the default when the previous estimate is invalid', () => {
    expect(measuredRowHeight(0, 0, 0)).toBe(DEFAULT_ROW_HEIGHT);
  });
});
