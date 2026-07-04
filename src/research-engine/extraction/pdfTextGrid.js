/**
 * extraction/pdfTextGrid.js — turn pdf.js `getTextContent()` items into
 * row/column grids so tables can be parsed deterministically from the PDF text
 * layer. Pure, dependency-free — no I/O, no React, no DOM, no pdf.js import —
 * safe to import from the server, the client, and unit tests.
 *
 * PDF.JS ITEM SHAPE (input)
 *   { str, transform: [a, b, c, d, e, f], width, height }
 *   - x = transform[4] (e), y = transform[5] (f): the BASELINE origin of the
 *     text run in PDF user space. y grows UP (opposite of screen coords), so
 *     the visually-first table row has the LARGEST y.
 *   - width is the advance width in user-space units; height (when present) is
 *     the run height. When height is missing, |transform[3]| (the d component,
 *     ~font size for unrotated text) is a serviceable stand-in; 10 is the last
 *     resort.
 *   Items are accepted defensively: empty/whitespace `str`, a missing/invalid
 *   transform, or non-finite coordinates simply skip the item — nothing throws.
 *   Already-normalized items ({ str, x, y, w, h }) are accepted too, so the
 *   pipeline stages compose freely.
 *
 * PIPELINE
 *   normalizeItems → itemsToRows → detectColumns → buildGrid
 *   or, for a caller-selected rectangle, gridFromRegion does all four and
 *   returns null when the region does not look like a table (<2 rows or
 *   <2 columns) — a usable "no table here" signal, never an exception.
 *
 * DETERMINISM
 *   Pure functions of their inputs; all sorts carry explicit tie-breakers
 *   (y descending then x ascending) so the same items always yield the same
 *   grid. No randomness, no timestamps.
 */

/** Fallback text height (user-space units) when neither height nor d is usable. */
const FALLBACK_HEIGHT = 10;

/** Fallback per-character width when no item yields a measurable one. */
const FALLBACK_CHAR_WIDTH = 5;

/** Horizontal slack (user-space units) when assigning an item to a column. */
const COLUMN_ASSIGN_TOL = 2;

/**
 * normalizeItems(items) — coerce raw pdf.js text items into a flat
 * { str, x, y, w, h } shape. Malformed entries are skipped, never thrown on:
 *   - str missing / empty / whitespace-only → skipped
 *   - no usable (x, y): needs transform[4..5] finite, or pre-normalized x/y → skipped
 *   - w: `width` when finite and ≥ 0, else 0
 *   - h: `height` when finite and > 0, else |transform[3]|, else 10
 *
 * @param {Array} items  raw pdf.js items and/or already-normalized items
 * @returns {Array<{str:string, x:number, y:number, w:number, h:number}>}
 */
export function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const str = typeof it.str === 'string' ? it.str : '';
    if (!str.trim()) continue;

    let x = null;
    let y = null;
    let d = null;
    if (Array.isArray(it.transform) && it.transform.length >= 6) {
      const e = Number(it.transform[4]);
      const f = Number(it.transform[5]);
      if (Number.isFinite(e) && Number.isFinite(f)) {
        x = e;
        y = f;
      }
      const dRaw = Number(it.transform[3]);
      if (Number.isFinite(dRaw)) d = dRaw;
    }
    // Already-normalized items ({ str, x, y, w, h }) pass through.
    if (x === null) {
      const px = Number(it.x);
      const py = Number(it.y);
      if (Number.isFinite(px) && Number.isFinite(py)) {
        x = px;
        y = py;
      }
    }
    if (x === null || y === null) continue;

    const wRaw = Number(it.width !== undefined ? it.width : it.w);
    const w = Number.isFinite(wRaw) && wRaw >= 0 ? wRaw : 0;

    const hRaw = Number(it.height !== undefined ? it.height : it.h);
    let h;
    if (Number.isFinite(hRaw) && hRaw > 0) h = hRaw;
    else if (d !== null && Math.abs(d) > 0) h = Math.abs(d);
    else h = FALLBACK_HEIGHT;

    out.push({ str, x, y, w, h });
  }
  return out;
}

/**
 * itemsToRows(items, opts?) — cluster items into visual rows by baseline y.
 * Rows come back sorted TOP to BOTTOM (descending y, because PDF y grows up);
 * items inside a row are sorted by x ascending.
 *
 * Clustering walks items in descending-y order and joins an item to the
 * current row while |y − rowMeanY| ≤ yTol, so mild baseline jitter (sub/super
 * scripts, mixed font sizes) still lands in one row.
 *
 * @param {Array} items  raw or normalized items (see normalizeItems)
 * @param {{yTol?: number}} [opts]  yTol default: max(2, 0.4 × median item height)
 * @returns {Array<{y:number, items:Array}>}  y is the row's mean baseline
 */
export function itemsToRows(items, { yTol } = {}) {
  const norm = normalizeItems(items);
  if (!norm.length) return [];

  const tol =
    Number.isFinite(yTol) && yTol > 0
      ? yTol
      : Math.max(2, 0.4 * median(norm.map((i) => i.h)));

  const sorted = norm.slice().sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  let cur = null;
  let sumY = 0;
  for (const it of sorted) {
    if (cur && Math.abs(it.y - sumY / cur.items.length) <= tol) {
      cur.items.push(it);
      sumY += it.y;
    } else {
      cur = { y: it.y, items: [it] };
      sumY = it.y;
      rows.push(cur);
    }
  }
  for (const row of rows) {
    row.y = row.items.reduce((s, i) => s + i.y, 0) / row.items.length;
    row.items.sort((a, b) => a.x - b.x || b.y - a.y);
  }
  return rows;
}

/**
 * detectColumns(rows, opts?) — infer column x centers from item start-x
 * positions across rows. Start-x values are clustered with a gap threshold
 * derived from the median character width (median of w / str.length): starts
 * closer than the threshold belong to one cluster. A cluster supported by at
 * least `minRows` DISTINCT rows becomes a column (its center = the cluster's
 * mean x), so one-off split runs inside a cell do not spawn phantom columns.
 *
 * @param {Array<{y:number, items:Array}>} rows  output of itemsToRows
 * @param {{minRows?: number}} [opts]  default minRows 2
 * @returns {number[]}  column x centers, ascending
 */
export function detectColumns(rows, { minRows = 2 } = {}) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const need = Number.isFinite(minRows) && minRows >= 1 ? Math.floor(minRows) : 2;

  const entries = [];
  const charWidths = [];
  rows.forEach((row, rowIdx) => {
    if (!row || !Array.isArray(row.items)) return;
    for (const it of row.items) {
      if (!it || !Number.isFinite(it.x)) continue;
      entries.push({ x: it.x, rowIdx });
      const len = typeof it.str === 'string' ? it.str.length : 0;
      if (len > 0 && Number.isFinite(it.w) && it.w > 0) charWidths.push(it.w / len);
    }
  });
  if (!entries.length) return [];

  const charW = charWidths.length ? median(charWidths) : FALLBACK_CHAR_WIDTH;
  const gapThreshold = Math.max(3, 1.5 * charW);

  entries.sort((a, b) => a.x - b.x || a.rowIdx - b.rowIdx);

  const cols = [];
  let cluster = [entries[0]];
  const flush = () => {
    const support = new Set(cluster.map((e) => e.rowIdx));
    if (support.size >= need) {
      cols.push(cluster.reduce((s, e) => s + e.x, 0) / cluster.length);
    }
  };
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].x - cluster[cluster.length - 1].x <= gapThreshold) {
      cluster.push(entries[i]);
    } else {
      flush();
      cluster = [entries[i]];
    }
  }
  flush();
  return cols;
}

/**
 * buildGrid(rows, cols) — assign every item to a column and materialize the
 * cell matrix. An item belongs to the RIGHTMOST column whose center is at or
 * left of its start-x (+ a small tolerance) — i.e. the column range runs from
 * its center to just before the next center — so continuation runs inside a
 * cell ("12.3" then "± 4.5") land in the same cell. Items left of the first
 * column clamp into column 0.
 *
 * Multiple items in one cell are joined with a single space in x order; the
 * cell box is the union of its items' boxes ({x0,y0,x1,y1} in PDF space,
 * y0 = baseline, y1 = baseline + height). Missing cells come back as '' with
 * a null box, so every row has exactly cols.length entries.
 *
 * @param {Array<{y:number, items:Array}>} rows  output of itemsToRows
 * @param {number[]} cols  column x centers (output of detectColumns)
 * @returns {{cells: string[][], boxes: Array<Array<{x0:number,y0:number,x1:number,y1:number}|null>>}}
 */
export function buildGrid(rows, cols) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeCols = Array.isArray(cols)
    ? cols.filter((c) => Number.isFinite(c)).slice().sort((a, b) => a - b)
    : [];

  const cells = [];
  const boxes = [];
  for (const row of safeRows) {
    const parts = safeCols.map(() => []);
    const rowBoxes = safeCols.map(() => null);
    const items =
      row && Array.isArray(row.items)
        ? row.items.slice().sort((a, b) => a.x - b.x || b.y - a.y)
        : [];
    for (const it of items) {
      if (!it || !Number.isFinite(it.x) || typeof it.str !== 'string') continue;
      const ci = columnIndexFor(safeCols, it.x);
      if (ci < 0) continue; // no columns at all
      parts[ci].push(it.str);
      const w = Number.isFinite(it.w) ? it.w : 0;
      const h = Number.isFinite(it.h) ? it.h : 0;
      const box = { x0: it.x, y0: it.y, x1: it.x + w, y1: it.y + h };
      rowBoxes[ci] = rowBoxes[ci] ? unionBox(rowBoxes[ci], box) : box;
    }
    cells.push(parts.map((p) => p.join(' ')));
    boxes.push(rowBoxes);
  }
  return { cells, boxes };
}

/** Rightmost column whose center ≤ x + tolerance; clamps to 0 left of all columns. */
function columnIndexFor(cols, x) {
  if (!cols.length) return -1;
  let idx = 0;
  for (let i = 0; i < cols.length; i++) {
    if (cols[i] <= x + COLUMN_ASSIGN_TOL) idx = i;
    else break;
  }
  return idx;
}

function unionBox(a, b) {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/**
 * gridFromRegion(items, region) — grid the items whose BASELINE origin (x, y)
 * falls inside a caller-selected rectangle. The region is in PDF user space:
 * y0 is the BOTTOM edge and y1 the TOP edge (y0 < y1, because y grows up).
 *
 * Returns null — never throws — when the region is malformed, or when what is
 * inside does not look like a table (< 2 rows or < 2 detected columns).
 *
 * @param {Array} items  raw or normalized items
 * @param {{x0:number, y0:number, x1:number, y1:number}} region
 * @returns {{grid:{cells:string[][], boxes:Array}, cols:number[], rows:Array}|null}
 */
export function gridFromRegion(items, region) {
  if (!region || typeof region !== 'object') return null;
  const x0 = Number(region.x0);
  const y0 = Number(region.y0);
  const x1 = Number(region.x1);
  const y1 = Number(region.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  if (x1 <= x0 || y1 <= y0) return null;

  const inside = normalizeItems(items).filter(
    (it) => it.x >= x0 && it.x <= x1 && it.y >= y0 && it.y <= y1
  );
  const rows = itemsToRows(inside);
  if (rows.length < 2) return null;
  const cols = detectColumns(rows);
  if (cols.length < 2) return null;
  return { grid: buildGrid(rows, cols), cols, rows };
}

/**
 * Cell-text patterns that count as "numeric" for column classification:
 * plain numbers (thousands commas, optional %), events/total, mean ± sd,
 * mean (sd), and "n = 123".
 */
const NUMERIC_CELL_PATTERNS = [
  /^[-+]?\d[\d,]*(?:\.\d+)?\s*%?$/, // 123 · 12.3 · 1,234 · 45%
  /^\d[\d,]*\s*\/\s*\d[\d,]*$/, // 18/120 (events/total)
  /^[-+]?\d[\d,]*(?:\.\d+)?\s*(?:±|\+\/-)\s*\d[\d,]*(?:\.\d+)?$/, // 12.3 ± 4.5
  /^[-+]?\d[\d,]*(?:\.\d+)?\s*\(\s*\d[\d,]*(?:\.\d+)?\s*\)$/, // 12.3 (4.5)
  /^[nN]\s*=\s*\d[\d,]*$/, // n = 123
];

/**
 * looksNumericColumn(cells, colIdx) — true when at least 60% of the column's
 * NON-EMPTY cells look like data values (number / n-pattern / mean-sd /
 * events-total). A column with no non-empty cells, or an out-of-range index,
 * is false.
 *
 * @param {string[][]} cells  the `cells` matrix from buildGrid
 * @param {number} colIdx
 * @returns {boolean}
 */
export function looksNumericColumn(cells, colIdx) {
  if (!Array.isArray(cells)) return false;
  const idx = Number(colIdx);
  if (!Number.isInteger(idx) || idx < 0) return false;

  let nonEmpty = 0;
  let numeric = 0;
  for (const row of cells) {
    if (!Array.isArray(row) || idx >= row.length) continue;
    const raw = row[idx];
    const cell = (typeof raw === 'string' ? raw : raw == null ? '' : String(raw)).trim();
    if (!cell) continue;
    nonEmpty++;
    if (NUMERIC_CELL_PATTERNS.some((re) => re.test(cell))) numeric++;
  }
  if (!nonEmpty) return false;
  return numeric / nonEmpty >= 0.6;
}

/* ════════════════════════════════════════════════════════════════════════════
   ADDITIVE TABLE-SHAPE SUPPORT (RoadMap/1.md e1 — result-table mapping)
   Pure, dependency-free helpers layered on top of the grid primitives above.
   None of the existing exports (NUMERIC_CELL_PATTERNS, detectColumns, buildGrid,
   gridFromRegion, looksNumericColumn) are touched — these are strictly new.
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Cell-text patterns that count as a CONFIDENCE-INTERVAL / RANGE token:
 *   0.99–1.03 · 0.99-1.03 · 0.99 to 1.03 · (0.95, 1.08) · [0.90–1.07]
 * Unicode dashes (en U+2013, em U+2014, minus U+2212) are all accepted. A token
 * MUST carry two numbers separated by a range separator, so a plain negative
 * number ('-0.4') or a thousands value ('1,234') never matches.
 */
export const CI_CELL_PATTERNS = [
  // bare range: two numbers with a dash / "to" separator
  /^[-+]?\d[\d,]*(?:\.\d+)?\s*(?:to|[-–—−])\s*[-+]?\d[\d,]*(?:\.\d+)?$/i,
  // bracketed range: (0.95, 1.08) · [0.95–1.08] · {0.95 to 1.08}
  /^[([{]\s*[-+]?\d[\d,]*(?:\.\d+)?\s*(?:,|to|[-–—−])\s*[-+]?\d[\d,]*(?:\.\d+)?\s*[)\]}]$/i,
];

/** Header text that names a 95% confidence interval (used only by merge/shape). */
const CI_HEADER_RE = /95\s*%?\s*c\.?\s*i\.?|confidence\s*interval/i;

/** Footnote / caption leader that must never be mistaken for a data row. */
const FOOTNOTE_RE = /^\s*[*†‡§¶a-d]\s|^Note|^Abbrev|^CI[,: ]|^Values are|^Data are/i;

/** true when a cell reads as a data value (number-ish) OR a CI/range token. */
function cellLooksData(cell) {
  const s = (typeof cell === 'string' ? cell : cell == null ? '' : String(cell)).trim();
  if (!s) return false;
  return NUMERIC_CELL_PATTERNS.some((re) => re.test(s)) || CI_CELL_PATTERNS.some((re) => re.test(s));
}

/** true when a cell is a plain signed number (no %, no range, no slash). */
function isPlainNumber(cell) {
  const s = (typeof cell === 'string' ? cell : cell == null ? '' : String(cell)).trim();
  return /^[-+]?\d[\d,]*(?:\.\d+)?$/.test(s);
}

/**
 * looksCiColumn(cells, colIdx) — true when ≥60% of the column's NON-EMPTY cells
 * read as a CI/range token (see CI_CELL_PATTERNS). Mirrors looksNumericColumn's
 * contract: an out-of-range index or a column with no non-empty cells is false.
 *
 * @param {string[][]} cells
 * @param {number} colIdx
 * @returns {boolean}
 */
export function looksCiColumn(cells, colIdx) {
  if (!Array.isArray(cells)) return false;
  const idx = Number(colIdx);
  if (!Number.isInteger(idx) || idx < 0) return false;

  let nonEmpty = 0;
  let ci = 0;
  for (const row of cells) {
    if (!Array.isArray(row) || idx >= row.length) continue;
    const raw = row[idx];
    const cell = (typeof raw === 'string' ? raw : raw == null ? '' : String(raw)).trim();
    if (!cell) continue;
    nonEmpty++;
    if (CI_CELL_PATTERNS.some((re) => re.test(cell))) ci++;
  }
  if (!nonEmpty) return false;
  return ci / nonEmpty >= 0.6;
}

/**
 * detectHeaderSpan(cells) — how many leading rows form the header, plus a
 * per-column combined header name. A row is a header row while fewer than 50%
 * of its non-empty cells read as data (number / CI token); scanning stops at the
 * first data-heavy row or after 3 rows (a two-tier header rarely runs deeper).
 * headerText[col] is the header cells for that column joined top-to-bottom, so a
 * two-tier "Intervention" / "Events" stack yields "Intervention Events".
 *
 * @param {string[][]} cells
 * @returns {{ headerRows: number, headerText: string[] }}
 */
export function detectHeaderSpan(cells) {
  const rows = Array.isArray(cells) ? cells : [];
  const nCols = rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
  const CAP = 3;

  let headerRows = 0;
  for (let r = 0; r < rows.length && r < CAP; r++) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const nonEmpty = row
      .map((c) => (c == null ? '' : String(c)).trim())
      .filter((s) => s.length > 0);
    if (!nonEmpty.length) break; // a fully-blank row ends the header span
    const dataLike = nonEmpty.filter((c) => cellLooksData(c)).length;
    if (dataLike / nonEmpty.length < 0.5) headerRows++;
    else break;
  }

  const headerText = new Array(nCols).fill('');
  for (let c = 0; c < nCols; c++) {
    const parts = [];
    for (let r = 0; r < headerRows; r++) {
      const v = rows[r] && rows[r][c] != null ? String(rows[r][c]).trim() : '';
      if (v) parts.push(v);
    }
    headerText[c] = parts.join(' ');
  }
  return { headerRows, headerText };
}

/**
 * partitionRows(cells) — classify every row as header, body, or footnote.
 * A footnote/caption row concentrates its content in column 0 (at most one other
 * non-empty cell) AND its column-0 text matches a footnote leader (*, †, a-d
 * markers, "Note", "Abbrev", "CI, …", "Values are", "Data are"). Everything after
 * the header span that is not a footnote is body.
 *
 * @param {string[][]} cells
 * @returns {{ headerRows: number, bodyRowIdx: number[], footnoteRowIdx: number[] }}
 */
export function partitionRows(cells) {
  const rows = Array.isArray(cells) ? cells : [];
  const { headerRows } = detectHeaderSpan(cells);
  const bodyRowIdx = [];
  const footnoteRowIdx = [];
  for (let r = headerRows; r < rows.length; r++) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const trimmed = row.map((c) => (c == null ? '' : String(c)).trim());
    const col0 = trimmed[0] || '';
    const others = trimmed.slice(1).filter((s) => s.length > 0);
    const concentrates = col0.length > 0 && others.length <= 1;
    if (concentrates && FOOTNOTE_RE.test(col0)) footnoteRowIdx.push(r);
    else bodyRowIdx.push(r);
  }
  return { headerRows, bodyRowIdx, footnoteRowIdx };
}

/**
 * mergeContinuationColumns({cells, boxes}) — deterministic post-pass that
 * collapses adjacent column PAIRS when, across ≥60% of body rows, the two cells
 * belong together:
 *   • CI / range continuation — the joined text is one CI token ('0.99' + '–1.03'
 *     → '0.99–1.03'), OR both cells are plain numbers sitting under a "95% CI"
 *     header (lower / upper bound → 'low–high').
 *   • label continuation — the left cell ends with a comma ('Age,' + 'years'), OR
 *     the right column is non-numeric text that only ever appears alongside a
 *     left-column label.
 * The input is never mutated; a fresh grid is returned along with `merges`
 * (original-index descriptions of every collapse performed).
 *
 * @param {{cells:string[][], boxes?:Array}} input
 * @returns {{cells:string[][], boxes:Array, merges:Array<{leftCol:number,rightCol:number,kind:'ci'|'label'}>}}
 */
export function mergeContinuationColumns(input) {
  const cellsIn = input && Array.isArray(input.cells) ? input.cells : [];
  const boxesIn = input && Array.isArray(input.boxes) ? input.boxes : [];
  const nCols = cellsIn.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);

  // Rectangularized, string-normalized VIEW — never mutate the caller's arrays.
  const cells = cellsIn.map((r) => {
    const row = Array.isArray(r) ? r.map((v) => (v == null ? '' : String(v))) : [];
    while (row.length < nCols) row.push('');
    return row;
  });
  const boxes = cellsIn.map((_, ri) => {
    const b = Array.isArray(boxesIn[ri]) ? boxesIn[ri].slice() : [];
    while (b.length < nCols) b.push(null);
    return b;
  });

  if (nCols < 2) {
    return { cells: cells.map((r) => r.slice()), boxes: boxes.map((r) => r.slice()), merges: [] };
  }

  const { bodyRowIdx } = partitionRows(cells);
  const { headerText } = detectHeaderSpan(cells);
  const bodyView = bodyRowIdx.map((i) => cells[i]);
  const total = bodyRowIdx.length;

  const classifyPair = (c) => {
    if (total === 0) return null;
    const leftHdr = headerText[c] || '';
    const pairHeader = `${leftHdr} ${headerText[c + 1] || ''}`;
    // Header-based CI merge only when the CI header actually covers the LEFT
    // column (its own header is blank or CI-ish) — so 'aOR' | '95% CI' never
    // swallows the effect column, but 'Lower' | 'Upper' under one CI header does.
    const ciHeaderApplies =
      CI_HEADER_RE.test(pairHeader) && (leftHdr === '' || CI_HEADER_RE.test(leftHdr));

    let ciCount = 0;
    let labelCount = 0;
    let rightNonEmpty = 0;
    let rightTextCount = 0;
    let rightImpliesLeft = true;
    for (const r of bodyRowIdx) {
      const left = (cells[r][c] || '').trim();
      const right = (cells[r][c + 1] || '').trim();
      if (right) {
        rightNonEmpty++;
        if (!left) rightImpliesLeft = false;
        if (!cellLooksData(right)) rightTextCount++;
      }
      if (left && right) {
        const direct = (left + right).replace(/\s+/g, '');
        if (CI_CELL_PATTERNS.some((re) => re.test(direct))) ciCount++;
        else if (ciHeaderApplies && isPlainNumber(left) && isPlainNumber(right)) ciCount++;
      }
      if (left && left.endsWith(',') && right) labelCount++;
    }
    if (ciCount / total >= 0.6) return 'ci';
    if (labelCount / total >= 0.6) return 'label';
    // Pure text continuation: a non-numeric right column that only co-occurs with
    // a non-numeric left label column (e.g. a units column split off the label).
    if (
      rightNonEmpty > 0 &&
      rightImpliesLeft &&
      rightTextCount === rightNonEmpty &&
      rightNonEmpty / total >= 0.6 &&
      !looksNumericColumn(bodyView, c) &&
      !looksNumericColumn(bodyView, c + 1)
    ) {
      return 'label';
    }
    return null;
  };

  const mergeKind = new Array(nCols).fill(null);
  const consumed = new Array(nCols).fill(false);
  for (let c = 0; c < nCols - 1; c++) {
    if (consumed[c]) continue;
    const kind = classifyPair(c);
    if (kind) {
      mergeKind[c] = kind;
      consumed[c + 1] = true;
    }
  }

  const outCells = cells.map(() => []);
  const outBoxes = cells.map(() => []);
  const merges = [];
  for (let c = 0; c < nCols; c++) {
    if (consumed[c]) continue; // folded into the previous column
    if (mergeKind[c]) {
      merges.push({ leftCol: c, rightCol: c + 1, kind: mergeKind[c] });
      for (let r = 0; r < cells.length; r++) {
        outCells[r].push(joinContinuation(cells[r][c] || '', cells[r][c + 1] || '', mergeKind[c]));
        outBoxes[r].push(unionMaybe(boxes[r][c], boxes[r][c + 1]));
      }
    } else {
      for (let r = 0; r < cells.length; r++) {
        outCells[r].push(cells[r][c]);
        outBoxes[r].push(boxes[r][c]);
      }
    }
  }
  return { cells: outCells, boxes: outBoxes, merges };
}

/** Join a merged pair per its detected kind (both trimmed; empty side passes through). */
function joinContinuation(left, right, kind) {
  const l = String(left).trim();
  const r = String(right).trim();
  if (!l) return r;
  if (!r) return l;
  if (kind === 'ci') {
    const direct = (l + r).replace(/\s+/g, ' ').trim();
    if (CI_CELL_PATTERNS.some((re) => re.test(direct.replace(/\s+/g, '')))) return direct;
    return `${l}–${r}`; // header-based lower/upper bound pair
  }
  return `${l} ${r}`; // label continuation
}

/** Box union that tolerates null on either side. */
function unionMaybe(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return unionBox(a, b);
}

/* ════════════════════════════════════════════════════════════════════════════
   STAGED TABLE PIPELINE (RoadMap/4.md §12) — additive, pure, dependency-free.
   Each stage is exported and independently testable; buildTableGrid composes them
   into the §10.2 grid contract. None of the existing exports above are altered.
   ════════════════════════════════════════════════════════════════════════════ */

/** Parser version — bump on any behaviour change so cached grids invalidate (§10.2). */
export const PARSER_VERSION = 'grid-2';

/**
 * repairTokens(items) — §12.1. Repair malformed pdf.js text segmentation BEFORE line
 * and table inference: merge adjacent same-baseline runs whose horizontal gap is a
 * small fraction of the local space width, so a mid-word split ("u"+"nivariate",
 * "v"+"ariables") becomes one token. The gap threshold is derived from LOCAL font
 * metrics (per-run character width), never a universal pixel constant, so true spaces
 * between words survive and columns are not bridged.
 *
 * @param {Array} items  raw or normalized items
 * @param {{gapRatio?:number}} [opts]  merge when gap < gapRatio × estimated space (0.33)
 * @returns {Array<{str,x,y,w,h,srcIndexes:number[]}>}  repaired, normalized items
 */
export function repairTokens(items, { gapRatio = 0.33 } = {}) {
  const norm = normalizeItems(items).map((it, i) => ({ ...it, srcIndexes: [i] }));
  if (norm.length < 2) return norm;

  const heights = norm.map((i) => i.h);
  const yTol = Math.max(1, 0.4 * median(heights));

  // Group by baseline (descending y), then walk left-to-right merging tight gaps.
  const sorted = norm.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const out = [];
  let cur = null;
  for (const it of sorted) {
    if (!cur) { cur = clone(it); out.push(cur); continue; }
    const sameLine = Math.abs(it.y - cur.y) <= yTol;
    const curEnd = cur.x + cur.w;
    const gap = it.x - curEnd;
    // Estimate the local space width from the wider of the two runs' char widths.
    const charW = Math.max(charWidthOf(cur), charWidthOf(it), 1);
    const spaceW = charW; // one char width ≈ one space in most fonts
    const bigFontJump = Math.abs(it.h - cur.h) > 0.5 * Math.max(it.h, cur.h);
    if (sameLine && gap >= -charW * 0.5 && gap < gapRatio * spaceW && !bigFontJump) {
      // Merge: no visible space, same baseline, same font size → one token.
      cur.str += it.str;
      cur.w = (it.x + it.w) - cur.x;
      cur.h = Math.max(cur.h, it.h);
      cur.srcIndexes.push(...it.srcIndexes);
    } else {
      cur = clone(it);
      out.push(cur);
    }
  }
  return out;
}

/** buildLines(items, opts?) — §12.2. Adaptive baseline clustering (tolerance =
 *  0.5 × median item height, never a fixed pixel). Returns lines top→bottom with
 *  per-line bbox and font stats, resisting obvious cross-column merges by baseline. */
export function buildLines(items, { yTol } = {}) {
  const norm = Array.isArray(items) && items.length && items[0] && 'srcIndexes' in items[0]
    ? items
    : normalizeItems(items);
  if (!norm.length) return [];
  const tol = Number.isFinite(yTol) && yTol > 0 ? yTol : Math.max(2, 0.5 * median(norm.map((i) => i.h)));
  const sorted = norm.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let cur = null;
  let sumY = 0;
  for (const it of sorted) {
    if (cur && Math.abs(it.y - sumY / cur.items.length) <= tol) {
      cur.items.push(it); sumY += it.y;
    } else {
      cur = { y: it.y, items: [it] }; sumY = it.y; lines.push(cur);
    }
  }
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);
    ln.y = ln.items.reduce((s, i) => s + i.y, 0) / ln.items.length;
    ln.x0 = Math.min(...ln.items.map((i) => i.x));
    ln.x1 = Math.max(...ln.items.map((i) => i.x + i.w));
    ln.h = median(ln.items.map((i) => i.h));
    ln.text = ln.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
  }
  return lines;
}

const CAPTION_RE = /^(TABLE|Table|TABLA|Tab\.)\s*\d+[.:]?/;
const FOOTNOTE_LEADER_RE = /^\s*([*†‡§¶]|[a-d]\s|Note|Abbreviation|CI[,: ]|Values are|Data are|SD,|Adapted|Source)/i;

/**
 * stripCaptionAndFootnotes(lines) — §12.3. Split a table's lines into caption, body,
 * and footnotes using combined evidence (leader regex, a large vertical gap before a
 * trailing note block, and a smaller-than-body font). Never removes a genuine data row
 * on font size alone — a footnote needs a leader OR a big gap.
 *
 * @param {Array} lines  buildLines() output
 * @returns {{ caption:(string|null), body:Array, footnotes:string[], evidence:string[] }}
 */
export function stripCaptionAndFootnotes(lines) {
  const evidence = [];
  const ls = Array.isArray(lines) ? lines.slice() : [];
  if (!ls.length) return { caption: null, body: [], footnotes: [], evidence };

  // Caption: leading Table N line(s) until the first clearly columnar line.
  let captionParts = [];
  let bodyStart = 0;
  if (CAPTION_RE.test(ls[0].text)) {
    captionParts.push(ls[0].text);
    bodyStart = 1;
    // Absorb continuation lines that are clearly NOT columnar: a single run with no
    // numeric content (a wrapped caption clause), never a 2+ column data/header row.
    while (
      bodyStart < ls.length && bodyStart < 3 &&
      ls[bodyStart].items.length <= 1 &&
      !/\d/.test(ls[bodyStart].text) &&
      !CAPTION_RE.test(ls[bodyStart].text)
    ) {
      captionParts.push(ls[bodyStart].text);
      bodyStart++;
    }
    evidence.push('caption anchored on a "Table N" line');
  }

  // Footnotes: trailing lines with a leader, or a note block after a large gap.
  const bodyLines = ls.slice(bodyStart);
  const bodyFontMedian = median(bodyLines.map((l) => l.h));
  const footnotes = [];
  let end = bodyLines.length;
  for (let i = bodyLines.length - 1; i >= 1; i--) {
    const ln = bodyLines[i];
    const prev = bodyLines[i - 1];
    const gap = prev.y - ln.y; // baseline distance (y grows up)
    const bigGap = gap > 1.5 * (bodyFontMedian || ln.h || 10);
    const smallFont = ln.h > 0 && bodyFontMedian > 0 && ln.h < 0.9 * bodyFontMedian;
    const hasLeader = FOOTNOTE_LEADER_RE.test(ln.text);
    if (hasLeader || (bigGap && (smallFont || hasLeader))) {
      footnotes.unshift(ln.text);
      end = i;
    } else break;
  }
  if (footnotes.length) evidence.push(`${footnotes.length} trailing footnote line(s) separated`);

  return {
    caption: captionParts.length ? captionParts.join(' ') : null,
    body: bodyLines.slice(0, end),
    footnotes,
    evidence,
  };
}

/**
 * mergeWrappedRows(rows) — §12.6. Merge visual continuation lines into logical rows,
 * WITHOUT collapsing genuine hierarchical sub-rows. A line merges up when its label
 * ends in a hyphen (a wrapped word: "ob-"+"struction") or it carries only a label cell
 * that visually continues the row above and has NO numeric data of its own. Indented
 * numeric sub-rows ("EUS-BD", "ERCP" under "Patients, n") stay independent and receive
 * indentLevel/parentRow.
 *
 * @param {string[][]} cells  buildGrid() cells (body rows)
 * @param {Array} [boxes]     matching boxes (used for indent detection)
 * @returns {Array<{cells:string[], indentLevel:number, parentRow:(number|null)}>}
 */
export function mergeWrappedRows(cells, boxes) {
  const rows = Array.isArray(cells) ? cells.map((r) => (Array.isArray(r) ? r.slice() : [])) : [];
  if (!rows.length) return [];
  const rowBoxes = Array.isArray(boxes) ? boxes : rows.map(() => []);

  const isDataCell = (c) => {
    const s = (c == null ? '' : String(c)).trim();
    return !!s && (NUMERIC_CELL_PATTERNS.some((re) => re.test(s)) || CI_CELL_PATTERNS.some((re) => re.test(s)));
  };
  const hasData = (row) => row.slice(1).some(isDataCell);
  const labelX = (i) => {
    const b = rowBoxes[i] && rowBoxes[i][0];
    return b && Number.isFinite(b.x0) ? b.x0 : null;
  };

  // First pass: merge hyphen-wrap and label-only continuation lines UP.
  const merged = [];
  const mergedBoxes = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = String(row[0] || '').trim();
    const prev = merged[merged.length - 1];
    const wrapUp =
      prev &&
      !hasData(row) && // no numbers of its own
      label &&
      (String(prev.cells[0]).trim().endsWith('-') || (!hasData(prev.cells) && merged.length && row.slice(1).every((c) => !String(c || '').trim())));
    if (wrapUp) {
      const prevLabel = String(prev.cells[0]).trim();
      prev.cells[0] = prevLabel.endsWith('-') ? prevLabel.slice(0, -1) + label : `${prevLabel} ${label}`.trim();
    } else {
      merged.push({ cells: row.slice(), indentLevel: 0, parentRow: null });
      mergedBoxes.push(rowBoxes[i] || []);
    }
  }

  // Second pass: hierarchy — an indented row (label starts further right) whose parent
  // above is a non-indented label becomes a child (parentRow set), numeric data kept.
  const xs = merged.map((_, i) => {
    const b = mergedBoxes[i] && mergedBoxes[i][0];
    return b && Number.isFinite(b.x0) ? b.x0 : null;
  });
  // The BASE indent is the leftmost label x (top-level rows); a row indented past it is
  // a child. Using the minimum (not the median) so a minority of children never shifts
  // the baseline into themselves.
  const present = xs.filter((x) => x != null);
  const baseX = present.length ? Math.min(...present) : NaN;
  for (let i = 0; i < merged.length; i++) {
    const x = xs[i];
    if (x == null || !Number.isFinite(baseX)) continue;
    if (x > baseX + 4) {
      merged[i].indentLevel = 1;
      for (let j = i - 1; j >= 0; j--) {
        if (merged[j].indentLevel === 0) { merged[i].parentRow = j; break; }
      }
    }
  }
  return merged;
}

/**
 * buildTableGrid(items, opts?) — §12 top-level. Compose the staged pipeline into the
 * §10.2 grid contract. Reuses the proven column/cell primitives (detectColumns/buildGrid)
 * after token repair, caption/footnote stripping, and wrapped-row merging.
 *
 * @param {Array} items  raw pdf.js or normalized items for ONE table region
 * @param {object} [opts]  { region } forwarded for bbox context (optional)
 * @returns {{
 *   caption, footnotes, headerRows, columns, rows, confidence, warnings, parserVersion
 * } | null}  null when the region does not look like a table (§ contract).
 */
export function buildTableGrid(items, opts = {}) {
  const warnings = [];
  const repaired = repairTokens(items);
  if (repaired.length < 2) return null;
  const lines = buildLines(repaired);
  const { caption, body, footnotes, evidence } = stripCaptionAndFootnotes(lines);
  if (body.length < 2) { warnings.push('too few body lines for a table'); return null; }

  // Column inference + cell assignment via the proven primitives.
  const bodyRows = body.map((ln) => ({ y: ln.y, items: ln.items }));
  let cols = detectColumns(bodyRows);
  if (cols.length < 2) { warnings.push('fewer than two columns detected'); return null; }
  let grid = buildGrid(bodyRows, cols);
  // Indented row labels (a child row's label sits further right — "EUS-BD" under
  // "Patients, n") can spawn a phantom label column, mis-shifting the data. Collapse any
  // leading NON-numeric columns before the first numeric column into ONE label column so
  // the hierarchy is preserved instead of fragmenting the grid (§12.4/§12.6).
  let firstNumeric = -1;
  for (let c = 0; c < cols.length; c++) { if (looksNumericColumn(grid.cells, c)) { firstNumeric = c; break; } }
  if (firstNumeric > 1) {
    cols = [cols[0], ...cols.slice(firstNumeric)];
    grid = buildGrid(bodyRows, cols);
    warnings.push('collapsed indented label sub-columns into one label column');
  }
  let { headerRows, headerText } = detectHeaderSpan(grid.cells);
  // A genuine header row LABELS multiple columns (≥2 non-empty cells). Trim any leading
  // "header" rows that populate only column 0 — those are wrapped multi-line data labels
  // (e.g. "Cause of biliary ob-" / "struction"), not headers, and must reach the body so
  // mergeWrappedRows can stitch them (§12.6).
  const populatedCols = (r) => (grid.cells[r] || []).filter((c) => String(c || '').trim()).length;
  while (headerRows > 1 && populatedCols(headerRows - 1) < 2) headerRows -= 1;
  const wrapped = mergeWrappedRows(grid.cells.slice(headerRows), grid.boxes.slice(headerRows));

  // Column alignment from body cells (right for numeric, decimal when dot-clustered).
  const columns = cols.map((cx, ci) => ({
    x0: ci === 0 ? cx : (cols[ci - 1] + cx) / 2,
    x1: ci === cols.length - 1 ? cx : (cols[ci + 1] + cx) / 2,
    align: looksNumericColumn(grid.cells.slice(headerRows), ci) ? 'right' : 'left',
    headerPath: headerText[ci] ? headerText[ci].split(' ') : [],
  }));

  // Structural confidence (§12.8): rewards stable column count + clean parses.
  const colConsistency = grid.cells.length
    ? grid.cells.filter((r) => r.length === cols.length).length / grid.cells.length
    : 0;
  const confidence = clamp01Local(0.4 + 0.4 * colConsistency + (headerRows > 0 ? 0.2 : 0) - 0.1 * warnings.length);
  if (caption) evidence.push('caption captured (not leaked into cells)');

  return {
    caption,
    footnotes,
    headerRows: headerRows > 0 ? Array.from({ length: headerRows }, (_, i) => i) : [],
    columns,
    rows: wrapped.map((w) => ({
      cells: w.cells.map((raw) => ({ raw, value: null })),
      indentLevel: w.indentLevel,
      parentRow: w.parentRow,
    })),
    confidence,
    warnings: warnings.concat(evidence),
    parserVersion: PARSER_VERSION,
  };
}

/* ── Staged-pipeline helpers ─────────────────────────────────────────────── */

function clone(it) { return { ...it, srcIndexes: it.srcIndexes ? it.srcIndexes.slice() : [] }; }
function charWidthOf(it) {
  const len = typeof it.str === 'string' ? it.str.length : 0;
  return len > 0 && Number.isFinite(it.w) && it.w > 0 ? it.w / len : FALLBACK_CHAR_WIDTH;
}
function clamp01Local(x) { return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** median(values) — middle value (mean of the two middles for even counts). */
function median(values) {
  const v = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
