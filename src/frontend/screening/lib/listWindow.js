/**
 * listWindow.js — 65.md SCR-5: pure windowed-rendering math for long record lists.
 *
 * ScreeningTab's "Load more" APPENDS pages into one array, so the DOM previously
 * grew without bound (10k records → 10k row nodes). These helpers compute which
 * slice of the accumulated array to actually render for the current scroll
 * position, plus spacer heights that preserve the total scroll height (the
 * scrollbar and scroll offsets behave exactly as if every row were rendered).
 *
 * Pure functions, no DOM — the component feeds in scrollTop / viewportHeight /
 * a measured average row height and renders [start, end) between two spacers.
 */

// Below this many rows windowing is skipped entirely — the full list renders
// exactly as before (zero behaviour change for typical projects).
export const WINDOW_MIN_COUNT = 120;

// Rows drawn beyond each edge of the viewport so keyboard/scroll movement never
// shows a blank gap before the next compute.
export const DEFAULT_OVERSCAN = 10;

// Starting estimate for a record row (px); the component refines it from real
// measurements of the rendered slice.
export const DEFAULT_ROW_HEIGHT = 74;

/** True when the list is long enough to be worth windowing. */
export function shouldWindow(count, minCount = WINDOW_MIN_COUNT) {
  return Number.isFinite(count) && count > minCount;
}

/**
 * computeListWindow — the render window for a uniform-estimate row list.
 *
 * @param {object} o
 * @param {number} o.count           total rows in the accumulated array
 * @param {number} o.scrollTop       scroll offset of the list container (px)
 * @param {number} o.viewportHeight  visible height of the list container (px)
 * @param {number} [o.rowHeight]     estimated/measured average row height (px)
 * @param {number} [o.overscan]      extra rows beyond each viewport edge
 * @returns {{ start:number, end:number, topPad:number, bottomPad:number, totalHeight:number }}
 *   start/end   — slice bounds ([start, end), clamped to [0, count])
 *   topPad      — spacer height above the slice (px)
 *   bottomPad   — spacer height below the slice (px)
 *   totalHeight — topPad + rendered estimate + bottomPad (== count * rowHeight)
 */
export function computeListWindow({ count, scrollTop, viewportHeight, rowHeight = DEFAULT_ROW_HEIGHT, overscan = DEFAULT_OVERSCAN } = {}) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const rh = Number(rowHeight) > 0 ? Number(rowHeight) : DEFAULT_ROW_HEIGHT;
  const ov = Math.max(0, Math.floor(Number(overscan) || 0));
  const top = Math.max(0, Number(scrollTop) || 0);
  const vh = Math.max(0, Number(viewportHeight) || 0);

  if (n === 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0, totalHeight: 0 };

  const first = Math.floor(top / rh);
  const visible = Math.ceil(vh / rh);
  const start = Math.max(0, Math.min(n, first - ov));
  const end = Math.max(start, Math.min(n, first + visible + ov));

  return {
    start,
    end,
    topPad: start * rh,
    bottomPad: (n - end) * rh,
    totalHeight: n * rh,
  };
}

/**
 * measuredRowHeight — refine the row-height estimate from the rendered slice.
 * Returns the previous estimate unchanged for degenerate measurements or when
 * the change is below the jitter threshold (avoids re-render feedback loops).
 *
 * @param {number} contentHeight  measured pixel height of the rendered rows block
 * @param {number} renderedCount  rows currently rendered in that block
 * @param {number} previous       current estimate (px)
 * @param {number} [threshold]    minimum px delta to accept (default 2)
 */
export function measuredRowHeight(contentHeight, renderedCount, previous, threshold = 2) {
  const prev = Number(previous) > 0 ? Number(previous) : DEFAULT_ROW_HEIGHT;
  if (!(Number(contentHeight) > 0) || !(Number(renderedCount) > 0)) return prev;
  const avg = contentHeight / renderedCount;
  if (!Number.isFinite(avg) || avg <= 0) return prev;
  return Math.abs(avg - prev) > threshold ? avg : prev;
}
