/**
 * listWindow.test.js — 65.md SCR-5: pure windowed-rendering math for the
 * screening record list (slice bounds, spacer heights, scroll-height parity,
 * measurement refinement). No DOM, no React.
 */
import { describe, it, expect } from 'vitest';
import {
  computeListWindow, measuredRowHeight, shouldWindow, nearestScrollTop,
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

/* ── 107.md §5 — keep the selected row visible, minimally ─────────────────────── */

describe('nearestScrollTop', () => {
  // A 600px viewport over 74px rows: row N occupies [74N, 74N+74).
  const vh = 600, rh = 74;
  const at = (index, scrollTop) => nearestScrollTop({ rowTop: index * rh, rowHeight: rh, scrollTop, viewportHeight: vh });

  it('leaves a fully visible row exactly where it is', () => {
    expect(at(0, 0)).toBeNull();          // first row, top of the list
    expect(at(4, 0)).toBeNull();          // 296…370, well inside 0…600
    expect(at(7, 0)).toBeNull();          // 518…592, the last fully visible row
    expect(at(20, 20 * rh)).toBeNull();   // scrolled so the row is flush at the top
  });

  it('scrolls DOWN just far enough to reveal a row below the viewport', () => {
    // Row 8 spans 592…666; the viewport ends at 600 → 66px short.
    expect(at(8, 0)).toBe(8 * rh + rh - vh);
    expect(at(8, 0)).toBe(66);
    // Far below: the row lands flush against the bottom edge, never centred/topped.
    expect(at(400, 0)).toBe(400 * rh + rh - vh);
  });

  it('scrolls UP just far enough to reveal a row above the viewport', () => {
    // Row 10 spans 740…814; scrolled to 2000 it is off the top → align its top edge.
    expect(at(10, 2000)).toBe(10 * rh);
    // One row above the fold moves by only that row's overlap, not a page.
    expect(at(26, 2000)).toBe(26 * rh); // 1924 — a 76px nudge
  });

  it('nudges a PARTIALLY visible row by only its overlap', () => {
    // Row 8 (592…666) with scrollTop 30: bottom overflows by 36px.
    expect(at(8, 30)).toBe(66);
    // …and by 1px when it is 1px short.
    expect(at(8, 65)).toBe(66);
    expect(at(8, 66)).toBeNull();
  });

  it('never returns a negative offset', () => {
    expect(nearestScrollTop({ rowTop: 0, rowHeight: 74, scrollTop: 0, viewportHeight: 600 })).toBeNull();
    expect(nearestScrollTop({ rowTop: 10, rowHeight: 74, scrollTop: 300, viewportHeight: 600 })).toBe(10);
    expect(nearestScrollTop({ rowTop: -20, rowHeight: 74, scrollTop: 300, viewportHeight: 600 })).toBe(0);
  });

  it('works off the WINDOWED estimate (row not mounted → rowTop = index × rowHeight)', () => {
    // The virtualised list only knows `index * DEFAULT_ROW_HEIGHT` for an unmounted row.
    const target = nearestScrollTop({
      rowTop: 350 * DEFAULT_ROW_HEIGHT, rowHeight: DEFAULT_ROW_HEIGHT,
      scrollTop: 0, viewportHeight: 600,
    });
    expect(target).toBe(350 * DEFAULT_ROW_HEIGHT + DEFAULT_ROW_HEIGHT - 600);
    // Applying it once is enough — a second pass is a no-op (the loop terminates).
    expect(nearestScrollTop({
      rowTop: 350 * DEFAULT_ROW_HEIGHT, rowHeight: DEFAULT_ROW_HEIGHT,
      scrollTop: target, viewportHeight: 600,
    })).toBeNull();
  });

  it('handles a row taller than the viewport by aligning the nearest edge', () => {
    const tall = { rowTop: 1000, rowHeight: 900, viewportHeight: 400 };
    expect(nearestScrollTop({ ...tall, scrollTop: 0 })).toBe(1000);      // align top
    expect(nearestScrollTop({ ...tall, scrollTop: 1200 })).toBeNull();   // row covers the viewport
    expect(nearestScrollTop({ ...tall, scrollTop: 1900 })).toBe(1500);   // align bottom
  });

  it('declines to guess without a measured viewport', () => {
    expect(nearestScrollTop({ rowTop: 500, rowHeight: 74, scrollTop: 0, viewportHeight: 0 })).toBeNull();
    expect(nearestScrollTop({ rowTop: 500, rowHeight: 74, scrollTop: 0, viewportHeight: NaN })).toBeNull();
    expect(nearestScrollTop({})).toBeNull();
    expect(nearestScrollTop()).toBeNull();
  });
});

/* ── 107.md rec — obstructed strips (the sticky "Load more" bar) ───────────────── */

describe('nearestScrollTop insets', () => {
  // Same 600px viewport over 74px rows, now with a 50px opaque bar pinned to the
  // bottom of the SAME scrollport: only 0…550 of the viewport is actually visible.
  const vh = 600, rh = 74, bar = 50;
  const at = (index, scrollTop, insets = {}) => nearestScrollTop({
    rowTop: index * rh, rowHeight: rh, scrollTop, viewportHeight: vh, ...insets,
  });

  it('defaults to zero insets — every un-inset result is byte-identical', () => {
    for (const [i, st] of [[0, 0], [8, 0], [10, 2000], [400, 0], [8, 65]]) {
      expect(at(i, st, { insetTop: 0, insetBottom: 0 })).toEqual(at(i, st));
    }
  });

  it('bottom-aligns ABOVE the sticky bar instead of behind it', () => {
    // Row 8 spans 592…666. Without the inset the row's bottom edge lands on 600, i.e.
    // its last 50px sit under the bar; with it, on 550.
    expect(at(8, 0)).toBe(66);
    expect(at(8, 0, { insetBottom: bar })).toBe(66 + bar);
    // The row is then fully inside the UNOBSTRUCTED band [scrollTop, scrollTop+550].
    const next = at(8, 0, { insetBottom: bar });
    expect(8 * rh - next).toBeGreaterThanOrEqual(0);            // top edge visible
    expect(8 * rh + rh - next).toBeLessThanOrEqual(vh - bar);   // bottom edge clear of the bar
  });

  it('treats rows that the bar merely clips as NOT visible', () => {
    // Row 7 (518…592) is fully inside the raw viewport but its last 42px are behind
    // the bar, so the inset pass nudges it up while the un-inset pass does nothing.
    expect(at(7, 0)).toBeNull();
    expect(at(7, 0, { insetBottom: bar })).toBe(7 * rh + rh - (vh - bar));
    expect(at(7, 0, { insetBottom: bar })).toBe(42);
  });

  it('is idempotent — applying the inset offset once is enough', () => {
    const target = at(400, 0, { insetBottom: bar });
    expect(target).toBe(400 * rh + rh - (vh - bar));
    expect(nearestScrollTop({
      rowTop: 400 * rh, rowHeight: rh, scrollTop: target, viewportHeight: vh, insetBottom: bar,
    })).toBeNull();
  });

  it('never lets the bottom inset drag a row DOWN out of view', () => {
    // A row above the fold still aligns to the top edge — the bottom inset is irrelevant.
    expect(at(10, 2000, { insetBottom: bar })).toBe(10 * rh);
    expect(at(26, 2000, { insetBottom: bar })).toBe(26 * rh);
  });

  it('honours a TOP inset symmetrically (a sticky header, if one is ever added)', () => {
    const head = 40;
    // Row 10 spans 740…814; scrolled to 2000 it is above the fold. Aligning its top
    // edge to the raw top puts it under the header, so it must land 40px lower.
    expect(at(10, 2000, { insetTop: head })).toBe(10 * rh - head);
    // A row already clear of the header does not move.
    expect(nearestScrollTop({ rowTop: 100, rowHeight: rh, scrollTop: 0, viewportHeight: vh, insetTop: head })).toBeNull();
    // …one that is only partially under it moves by exactly the overlap.
    expect(nearestScrollTop({ rowTop: 20, rowHeight: rh, scrollTop: 0, viewportHeight: vh, insetTop: head })).toBeNull();
    expect(nearestScrollTop({ rowTop: 20, rowHeight: rh, scrollTop: 10, viewportHeight: vh, insetTop: head })).toBe(0);
  });

  it('combines both insets into one usable band', () => {
    const both = { insetTop: 40, insetBottom: bar };
    // Usable band is 40…550 of the viewport (510px tall).
    expect(at(8, 0, both)).toBe(8 * rh + rh - (vh - bar));
    expect(at(20, 20 * rh, both)).toBe(20 * rh - 40);
  });

  it('ignores garbage / negative insets', () => {
    expect(at(8, 0, { insetBottom: -50 })).toBe(66);
    expect(at(8, 0, { insetBottom: NaN })).toBe(66);
    expect(at(8, 0, { insetTop: undefined, insetBottom: null })).toBe(66);
  });

  it('ignores insets that swallow the whole viewport (mid-layout measurement)', () => {
    expect(at(8, 0, { insetBottom: vh })).toBe(66);
    expect(at(8, 0, { insetBottom: vh + 400 })).toBe(66);
    expect(at(8, 0, { insetTop: 400, insetBottom: 400 })).toBe(66);
  });

  it('cannot ask for a negative offset at the top of the list', () => {
    expect(nearestScrollTop({ rowTop: 0, rowHeight: rh, scrollTop: 0, viewportHeight: vh, insetTop: 100 })).toBeNull();
    expect(nearestScrollTop({ rowTop: 10, rowHeight: rh, scrollTop: 300, viewportHeight: vh, insetTop: 100 })).toBe(0);
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
