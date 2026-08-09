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
 * nearestScrollTop — 107.md §5: the MINIMAL scroll offset that brings a row fully
 * into view, i.e. `scrollIntoView({ block: 'nearest' })` expressed as arithmetic on
 * one container.
 *
 * The real `scrollIntoView` is unusable for ordinary keyboard navigation here: it
 * walks up the tree and can scroll the page and the abstract pane as well as the
 * record list, which §5 explicitly forbids. Feeding this result into
 * `container.scrollTop` moves exactly one element and nothing else.
 *
 * 'nearest' semantics — a row that is already fully visible never moves (returns
 * null), a row above the viewport is brought to the TOP edge, a row below it to the
 * BOTTOM edge. It never centres and never jumps to the top of the list.
 *
 * INSETS (107.md rec) — "visible" is not the same as "inside clientHeight". The record
 * list pins an OPAQUE `position: sticky; bottom: 0` "Load more" bar inside its own
 * scrollport whenever more pages exist, so a row aligned against the raw bottom edge
 * ends up mostly hidden behind it (~50px of a 74px row) — on exactly the long lists
 * the auto-scroll was written for. `insetTop`/`insetBottom` describe those obstructed
 * strips; the alignment targets shift by them so the row lands in the UNOBSTRUCTED
 * band. Both default to 0, i.e. the un-inset behaviour is unchanged.
 *
 * @param {object} o
 * @param {number} o.rowTop          row offset from the top of the scrollable CONTENT (px)
 * @param {number} o.rowHeight       row height (px)
 * @param {number} o.scrollTop       current container scroll offset (px)
 * @param {number} o.viewportHeight  visible height of the container (px)
 * @param {number} [o.insetTop]      obstructed strip pinned to the container's TOP (px)
 * @param {number} [o.insetBottom]   obstructed strip pinned to the container's BOTTOM (px)
 * @returns {number|null} the new scrollTop, or null when no scrolling is needed
 */
export function nearestScrollTop({ rowTop, rowHeight, scrollTop, viewportHeight, insetTop = 0, insetBottom = 0 } = {}) {
  const top = Number(rowTop);
  const rh = Number(rowHeight);
  const cur = Math.max(0, Number(scrollTop) || 0);
  const vh = Number(viewportHeight);
  // Without a measured viewport there is no "visible" to reason about.
  if (!Number.isFinite(top) || !Number.isFinite(rh) || !Number.isFinite(vh) || vh <= 0) return null;

  let padTop = Number(insetTop) > 0 ? Number(insetTop) : 0;
  let padBottom = Number(insetBottom) > 0 ? Number(insetBottom) : 0;
  // Insets that swallow the whole viewport describe nothing usable (a mid-layout
  // measurement, a collapsed container). Ignore them rather than emit nonsense.
  if (padTop + padBottom >= vh) { padTop = 0; padBottom = 0; }

  const alignTop = top - padTop;                    // row's top edge below the top inset
  const alignBottom = top + rh - vh + padBottom;    // row's bottom edge above the bottom inset
  // For a row shorter than the viewport this is [alignBottom, alignTop]; for a row
  // TALLER than the viewport the order flips and the interval is every offset at which
  // the row covers the whole viewport — both are "as visible as it gets".
  const lo = Math.max(0, Math.min(alignTop, alignBottom));
  const hi = Math.max(0, Math.max(alignTop, alignBottom));
  if (cur >= lo && cur <= hi) return null;
  const next = cur < lo ? lo : hi;
  return next === cur ? null : next;
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
