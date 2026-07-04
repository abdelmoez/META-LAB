/**
 * extraction/pageLayout.js — RoadMap/4.md §19.1. Deterministic classification of a
 * PDF page's text items into a column layout: one-column pages, two-column pages,
 * and mixed pages where full-width bands (a title, a spanning table or figure
 * caption) interrupt a two-column body.
 *
 * Evidence-based, NEVER a fixed pixel threshold:
 *   • an x-position histogram of item spans across the page — a wide vertical
 *     whitespace CHANNEL near the page middle, crossed by fewer than ~10% of
 *     items, is the two-column signal (findGutter);
 *   • a single dominant start-x cluster + wide line widths → one column;
 *   • a baseline row whose ink physically covers the channel center is a
 *     'full-width' band even on a two-column page (so a spanning title or table
 *     never gets clustered across columns — the §19.1 Sujan requirement);
 *   • reading order: full-width bands and column pairs in vertical position,
 *     each column pair left-top→bottom then right-top→bottom.
 *
 * Pure, dependency-free (only the sibling grid primitives). No I/O, no DOM, no
 * pdf.js import, no Date.now()/Math.random(); same items in → byte-identical
 * result out. Never throws on malformed input — it returns a safe one-column
 * default with a warning instead. Coordinates are pdf.js user space (y grows UP).
 */

import { normalizeItems, buildLines } from './pdfTextGrid.js';

/** Number of histogram bins swept across the page width when hunting the gutter. */
const GUTTER_BINS = 96;

/** Max fraction of items allowed to cross the whitespace channel (titles do). */
const MAX_CROSS_FRAC = 0.1;

/** The channel center must sit inside this middle band of the page width. */
const CENTER_BAND = [0.25, 0.75];

/** Minimum items required on EACH side of a channel to call it a column split. */
const MIN_SIDE_COUNT = 3;

/** Below this many baseline rows the page is "sparse" — default to one column. */
const MIN_ROWS = 4;

/**
 * findGutter(spans, bounds, opts?) — locate a vertical whitespace channel (the
 * column gutter) from an x-coverage histogram of item spans.
 *
 * Sweeps GUTTER_BINS bin centers across [bounds.x0, bounds.x1] counting how many
 * spans cross each center, then takes the WIDEST contiguous run of bins crossed
 * by ≤ maxCrossFrac of the spans whose center lies in the middle band of the
 * page and whose width clears minWidth (so word gaps never read as a gutter).
 * Both sides of the channel must carry at least minSideCount spans.
 *
 * @param {Array<{x0:number, x1:number}>} spans  item extents (x .. x+w)
 * @param {{x0:number, x1:number}} bounds  page text extent
 * @param {{maxCrossFrac?:number, minWidth?:number, minSideCount?:number}} [opts]
 * @returns {{x0:number, x1:number, center:number, crossFrac:number,
 *            leftCount:number, rightCount:number}|null}  null = no credible gutter
 */
export function findGutter(spans, bounds, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const ls = Array.isArray(spans)
    ? spans.filter((s) => s && Number.isFinite(s.x0) && Number.isFinite(s.x1) && s.x1 >= s.x0)
    : [];
  if (
    !bounds ||
    !Number.isFinite(bounds.x0) ||
    !Number.isFinite(bounds.x1) ||
    bounds.x1 <= bounds.x0
  ) {
    return null;
  }
  const minSideCount = Number.isFinite(o.minSideCount) ? o.minSideCount : MIN_SIDE_COUNT;
  if (ls.length < 2 * minSideCount) return null;

  const width = bounds.x1 - bounds.x0;
  const maxCrossFrac = Number.isFinite(o.maxCrossFrac) ? o.maxCrossFrac : MAX_CROSS_FRAC;
  const minWidth = Number.isFinite(o.minWidth) ? o.minWidth : 0.02 * width;
  const binW = width / GUTTER_BINS;

  const cross = new Array(GUTTER_BINS).fill(0);
  for (const s of ls) {
    for (let b = 0; b < GUTTER_BINS; b++) {
      const c = bounds.x0 + (b + 0.5) * binW;
      if (s.x0 < c && s.x1 > c) cross[b]++;
    }
  }

  const limit = maxCrossFrac * ls.length;
  let best = null;
  let runStart = -1;
  for (let b = 0; b <= GUTTER_BINS; b++) {
    const ok = b < GUTTER_BINS && cross[b] <= limit;
    if (ok && runStart < 0) runStart = b;
    if (!ok && runStart >= 0) {
      const gx0 = bounds.x0 + runStart * binW;
      const gx1 = bounds.x0 + b * binW;
      runStart = -1;
      const centerFrac = ((gx0 + gx1) / 2 - bounds.x0) / width;
      if (
        gx1 - gx0 >= minWidth &&
        centerFrac >= CENTER_BAND[0] &&
        centerFrac <= CENTER_BAND[1] &&
        (!best || gx1 - gx0 > best.x1 - best.x0)
      ) {
        best = { x0: gx0, x1: gx1 };
      }
    }
  }
  if (!best) return null;

  const cx = (best.x0 + best.x1) / 2;
  let leftCount = 0;
  let rightCount = 0;
  let crossers = 0;
  for (const s of ls) {
    if (s.x0 < cx && s.x1 > cx) crossers++;
    else if (s.x1 <= cx) leftCount++;
    else rightCount++;
  }
  if (leftCount < minSideCount || rightCount < minSideCount) return null;
  if (crossers > limit) return null;

  return {
    x0: best.x0,
    x1: best.x1,
    center: cx,
    crossFrac: ls.length ? crossers / ls.length : 0,
    leftCount,
    rightCount,
  };
}

/**
 * detectPageLayout(items, opts?) — classify a page's normalized text items
 * ({str,x,y,w,h} or raw pdf.js items — normalizeItems coerces both) into a
 * column layout with regions, confidence, reading order, and warnings.
 *
 * @param {Array} items  raw or normalized pdf.js text items for ONE page
 * @param {{maxCrossFrac?:number, minLines?:number}} [opts]
 * @returns {{
 *   columns: 1|2,
 *   regions: Array<{x0:number, x1:number, role:'column'|'full-width', y0:number, y1:number}>,
 *   confidence: number,
 *   readingOrder: number[],
 *   warnings: string[]
 * }}
 *   readingOrder holds indexes into `regions` in reading order: for two columns,
 *   left column top→bottom then right column, with full-width bands slotted at
 *   their vertical position. Malformed/empty input → safe one-column default.
 */
export function detectPageLayout(items, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const warnings = [];

  const norm = normalizeItems(items);
  if (!norm.length) {
    return { columns: 1, regions: [], confidence: 0, readingOrder: [], warnings: ['no usable text items'] };
  }

  const x0 = Math.min(...norm.map((i) => i.x));
  const x1 = Math.max(...norm.map((i) => i.x + i.w));
  const width = x1 - x0;
  if (!(width > 0)) {
    return {
      columns: 1,
      regions: [{ x0, x1, role: 'column', y0: Math.min(...norm.map((i) => i.y)), y1: Math.max(...norm.map((i) => i.y)) }],
      confidence: 0,
      readingOrder: [0],
      warnings: ['degenerate page width — treated as one column'],
    };
  }

  const rows = buildLines(norm);
  const yTop = Math.max(...rows.map((r) => r.y));
  const yBot = Math.min(...rows.map((r) => r.y));

  const minLines = Number.isFinite(o.minLines) ? o.minLines : MIN_ROWS;
  if (rows.length < minLines) {
    warnings.push(`sparse page (${rows.length} line${rows.length === 1 ? '' : 's'}) — defaulting to one column`);
    return {
      columns: 1,
      regions: [{ x0, x1, role: 'column', y0: yBot, y1: yTop }],
      confidence: clamp01(0.1 + 0.05 * rows.length),
      readingOrder: [0],
      warnings,
    };
  }

  /* ── Two-column evidence: a whitespace channel in the item-span histogram ──
     Item level, NOT line level: buildLines merges same-baseline items across
     columns, which would make every two-column row look full-width. */
  const medianH = median(norm.map((i) => i.h));
  const spans = norm.map((i) => ({ x0: i.x, x1: i.x + i.w }));
  const gutter = findGutter(spans, { x0, x1 }, {
    maxCrossFrac: Number.isFinite(o.maxCrossFrac) ? o.maxCrossFrac : MAX_CROSS_FRAC,
    minWidth: Math.max(0.025 * width, 1.2 * medianH),
    minSideCount: MIN_SIDE_COUNT,
  });

  if (!gutter) {
    /* ── One column: dominant start-x cluster + wide lines ─────────────────── */
    const startTol = Math.max(4, 0.02 * width);
    const starts = rows.map((r) => r.x0).sort((a, b) => a - b);
    let bestCluster = 1;
    let cur = 1;
    for (let i = 1; i < starts.length; i++) {
      if (starts[i] - starts[i - 1] <= startTol) cur++;
      else cur = 1;
      if (cur > bestCluster) bestCluster = cur;
    }
    const startFrac = bestCluster / rows.length;
    const wideFrac = rows.filter((r) => r.x1 - r.x0 >= 0.6 * width).length / rows.length;
    if (startFrac < 0.5 && wideFrac < 0.5) {
      warnings.push('weak one-column evidence — start positions are scattered; verify manually');
    }
    return {
      columns: 1,
      regions: [{ x0, x1, role: 'column', y0: yBot, y1: yTop }],
      confidence: clamp01(0.25 + 0.45 * startFrac + 0.3 * wideFrac),
      readingOrder: [0],
      warnings,
    };
  }

  /* ── Two columns: band the rows, split each columnar band at the gutter ─── */
  const cx = gutter.center;
  // A row is full-width when some item's INK physically covers the channel
  // center — a spanning title/table. A merged left+right baseline row has no
  // ink in the gutter and stays columnar.
  const isFwRow = (row) => row.items.some((it) => it.x < cx && it.x + it.w > cx);

  const runs = [];
  for (const row of rows) {
    const kind = isFwRow(row) ? 'full-width' : 'column';
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.rows.push(row);
    else runs.push({ kind, rows: [row] });
  }

  const regions = [];
  const readingOrder = [];
  for (const run of runs) {
    if (run.kind === 'full-width') {
      readingOrder.push(
        regions.push({
          x0,
          x1,
          role: 'full-width',
          y0: Math.min(...run.rows.map((r) => r.y)),
          y1: Math.max(...run.rows.map((r) => r.y)),
        }) - 1
      );
      continue;
    }
    const leftYs = [];
    const rightYs = [];
    for (const row of run.rows) {
      for (const it of row.items) {
        if (it.x + it.w / 2 < cx) leftYs.push(row.y);
        else rightYs.push(row.y);
      }
    }
    if (leftYs.length) {
      readingOrder.push(
        regions.push({ x0, x1: gutter.x0, role: 'column', y0: Math.min(...leftYs), y1: Math.max(...leftYs) }) - 1
      );
    }
    if (rightYs.length) {
      readingOrder.push(
        regions.push({ x0: gutter.x1, x1, role: 'column', y0: Math.min(...rightYs), y1: Math.max(...rightYs) }) - 1
      );
    }
  }

  const maxCross = Number.isFinite(o.maxCrossFrac) ? o.maxCrossFrac : MAX_CROSS_FRAC;
  const purity = clamp01(1 - gutter.crossFrac / (maxCross || 1));
  const balance =
    Math.min(gutter.leftCount, gutter.rightCount) / Math.max(gutter.leftCount, gutter.rightCount);
  if (balance < 0.35) warnings.push('column item counts are imbalanced — verify the column split');

  return {
    columns: 2,
    regions,
    confidence: clamp01(0.5 + 0.3 * purity + 0.2 * balance),
    readingOrder,
    warnings,
  };
}

/** median(arr) — deterministic median of a numeric array (0 when empty). */
function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
