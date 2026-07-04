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

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** median(values) — middle value (mean of the two middles for even counts). */
function median(values) {
  const v = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
