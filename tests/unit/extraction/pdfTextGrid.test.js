/**
 * pdfTextGrid.test.js — pdf.js text-layer → row/column grid.
 * Covers: defensive item normalization, y-clustering into top-to-bottom rows
 * (PDF y grows UP), column detection from start-x clusters, exact grid text for
 * a clean table, jitter tolerance, region filtering, prose rejection,
 * multi-item cell joining, and numeric-column classification.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeItems,
  itemsToRows,
  detectColumns,
  buildGrid,
  gridFromRegion,
  looksNumericColumn,
} from '../../../src/research-engine/extraction/pdfTextGrid.js';

/** Build a raw pdf.js-shaped item. Baseline origin (x, y) in PDF space (y UP). */
function mkItem(str, x, y, { w, h = 10, fontSize = 10 } = {}) {
  return {
    str,
    transform: [fontSize, 0, 0, fontSize, x, y],
    width: w !== undefined ? w : str.length * 5,
    height: h,
  };
}

/** Small seeded LCG so jitter tests stay deterministic. Returns [0, 1). */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* Clean 4×3 table: 4 author rows × [n, mean-sd, events/total].
   PDF y grows UP, so the visually-FIRST row gets the LARGEST y. */
const TABLE_CELLS = [
  ['120', '12.3 ± 4.5', '18/120'], // Smith 2020 (top, y=700)
  ['98', '11.1 ± 3.9', '12/98'], // Jones 2021 (y=685)
  ['150', '13.0 ± 5.2', '25/150'], // Lee 2022 (y=670)
  ['77', '10.4 ± 4.1', '9/77'], // Chen 2023 (bottom, y=655)
];
const COL_X = [100, 160, 260];
const ROW_Y = [700, 685, 670, 655];

/** Items for TABLE_CELLS, with optional per-item x/y jitter. */
function tableItems({ jitterX = () => 0, jitterY = () => 0 } = {}) {
  const items = [];
  TABLE_CELLS.forEach((rowCells, r) => {
    rowCells.forEach((text, c) => {
      items.push(mkItem(text, COL_X[c] + jitterX(), ROW_Y[r] + jitterY()));
    });
  });
  // Scramble input order — nothing may depend on the incoming order.
  return items.reverse();
}

describe('normalizeItems', () => {
  it('maps transform e/f to baseline x/y and keeps width/height', () => {
    const [n] = normalizeItems([mkItem('120', 100, 700)]);
    expect(n).toEqual({ str: '120', x: 100, y: 700, w: 15, h: 10 });
  });

  it('skips empty/whitespace strings and items without a usable position', () => {
    const out = normalizeItems([
      mkItem('', 10, 10),
      mkItem('   ', 10, 10),
      { str: 'no transform at all' },
      { str: 'bad transform', transform: [1, 0, 0, 1, NaN, 700] },
      { str: 'short transform', transform: [1, 0] },
      null,
      42,
      mkItem('kept', 50, 600),
    ]);
    expect(out.map((i) => i.str)).toEqual(['kept']);
  });

  it('falls back to |d| for height, then to 10', () => {
    const fromD = normalizeItems([
      { str: 'x', transform: [12, 0, 0, -12, 50, 700], width: 5 },
    ]);
    expect(fromD[0].h).toBe(12);
    const fromDefault = normalizeItems([
      { str: 'x', transform: [0, 0, 0, 0, 50, 700], width: 5 },
    ]);
    expect(fromDefault[0].h).toBe(10);
  });

  it('accepts already-normalized items (pipeline stages compose)', () => {
    const out = normalizeItems([{ str: 'n', x: 1, y: 2, w: 5, h: 10 }]);
    expect(out).toEqual([{ str: 'n', x: 1, y: 2, w: 5, h: 10 }]);
  });

  it('returns [] for non-array input', () => {
    expect(normalizeItems(null)).toEqual([]);
    expect(normalizeItems('items')).toEqual([]);
  });
});

describe('itemsToRows', () => {
  it('clusters a clean table into rows sorted TOP to BOTTOM (descending y)', () => {
    const rows = itemsToRows(tableItems());
    expect(rows.length).toBe(4);
    expect(rows.map((r) => r.y)).toEqual([700, 685, 670, 655]);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].y).toBeGreaterThan(rows[i].y);
    // Items within a row come back sorted by x ascending.
    expect(rows[0].items.map((i) => i.x)).toEqual(COL_X);
    expect(rows[0].items.map((i) => i.str)).toEqual(TABLE_CELLS[0]);
  });

  it('keeps ragged y jitter within tolerance in one row (default yTol adapts)', () => {
    const rand = lcg(42);
    const jitterY = () => (rand() - 0.5) * 3; // ±1.5, item h=10 → yTol=4
    const rows = itemsToRows(tableItems({ jitterY }));
    expect(rows.length).toBe(4);
    rows.forEach((r, i) => expect(Math.abs(r.y - ROW_Y[i])).toBeLessThanOrEqual(1.5));
  });

  it('an explicit tiny yTol splits jittered baselines apart', () => {
    const rand = lcg(7);
    const jitterY = () => (rand() - 0.5) * 3;
    const rows = itemsToRows(tableItems({ jitterY }), { yTol: 0.5 });
    expect(rows.length).toBeGreaterThan(4);
  });

  it('returns [] for empty or garbage input', () => {
    expect(itemsToRows([])).toEqual([]);
    expect(itemsToRows([{ str: '  ' }, null])).toEqual([]);
  });
});

describe('detectColumns', () => {
  it('finds the three column centers of the clean table', () => {
    const cols = detectColumns(itemsToRows(tableItems()));
    expect(cols).toEqual(COL_X);
  });

  it('tolerates small start-x jitter within one column cluster', () => {
    const rand = lcg(99);
    const jitterX = () => (rand() - 0.5) * 2; // ±1 around each column start
    const cols = detectColumns(itemsToRows(tableItems({ jitterX })));
    expect(cols.length).toBe(3);
    cols.forEach((c, i) => expect(Math.abs(c - COL_X[i])).toBeLessThanOrEqual(1));
  });

  it('drops clusters supported by fewer than minRows rows', () => {
    const items = tableItems();
    items.push(mkItem('footnote', 400, ROW_Y[3])); // x=400 appears in 1 row only
    const cols = detectColumns(itemsToRows(items));
    expect(cols).toEqual(COL_X);
    const relaxed = detectColumns(itemsToRows(items), { minRows: 1 });
    expect(relaxed).toEqual([...COL_X, 400]);
  });

  it('returns [] for empty rows', () => {
    expect(detectColumns([])).toEqual([]);
    expect(detectColumns(null)).toEqual([]);
  });
});

describe('buildGrid', () => {
  it('reproduces the clean 4×3 table text exactly', () => {
    const rows = itemsToRows(tableItems());
    const cols = detectColumns(rows);
    const { cells, boxes } = buildGrid(rows, cols);
    expect(cells).toEqual(TABLE_CELLS);
    // Box of the top-left cell: "120" at (100, 700), w=15, h=10.
    expect(boxes[0][0]).toEqual({ x0: 100, y0: 700, x1: 115, y1: 710 });
  });

  it('emits empty string + null box for a missing cell', () => {
    // Drop the bottom row's events/total item; col 3 keeps ≥2 supporting rows.
    const items = tableItems().filter((it) => !(it.str === '9/77'));
    const rows = itemsToRows(items);
    const cols = detectColumns(rows);
    expect(cols).toEqual(COL_X);
    const { cells, boxes } = buildGrid(rows, cols);
    expect(cells[3]).toEqual(['77', '10.4 ± 4.1', '']);
    expect(boxes[3][2]).toBeNull();
  });

  it('joins multiple items in one cell with a space, in x order', () => {
    // Row 2's mean-sd cell arrives as two runs: "12.3" then "± 4.5" — the
    // second run starts before the next column, so it must join the same cell.
    const items = [
      mkItem('120', 100, 700),
      mkItem('12.3 ± 4.5', 160, 700),
      mkItem('18/120', 260, 700),
      mkItem('98', 100, 685),
      mkItem('± 3.9', 186, 685), // deliberately BEFORE its partner in input order
      mkItem('11.1', 160, 685),
      mkItem('12/98', 260, 685),
      mkItem('150', 100, 670),
      mkItem('13.0 ± 5.2', 160, 670),
      mkItem('25/150', 260, 670),
    ];
    const rows = itemsToRows(items);
    const cols = detectColumns(rows);
    expect(cols).toEqual(COL_X); // the one-row split at x=186 spawns no column
    const { cells, boxes } = buildGrid(rows, cols);
    expect(cells[1][1]).toBe('11.1 ± 3.9');
    // Cell box is the union of both runs: x from 160 to 186 + 5×5 chars.
    expect(boxes[1][1]).toEqual({ x0: 160, y0: 685, x1: 211, y1: 695 });
  });

  it('handles empty rows/cols defensively', () => {
    expect(buildGrid([], [])).toEqual({ cells: [], boxes: [] });
    expect(buildGrid(null, null)).toEqual({ cells: [], boxes: [] });
  });
});

describe('gridFromRegion', () => {
  it('grids only the items whose baseline falls inside the region', () => {
    const items = [
      ...tableItems(),
      mkItem('Table 2 Baseline characteristics', 100, 760), // caption above
      mkItem('doi:10.1000/xyz', 100, 40), // footer below
      mkItem('margin-note', 20, 685), // left of region
      mkItem('sidebar', 400, 670), // right of region
    ];
    // Region in PDF space: y0 = BOTTOM edge (< y1 = TOP edge).
    const res = gridFromRegion(items, { x0: 90, y0: 640, x1: 330, y1: 720 });
    expect(res).not.toBeNull();
    expect(res.rows.length).toBe(4);
    expect(res.cols).toEqual(COL_X);
    expect(res.grid.cells).toEqual(TABLE_CELLS);
    const allText = res.grid.cells.flat().join(' ');
    expect(allText).not.toMatch(/Table 2|doi|margin-note|sidebar/);
  });

  it('returns null for a prose region (fewer than 2 columns)', () => {
    // A paragraph: one long run per line, all starting at the same x.
    const prose = [
      mkItem('We conducted a randomized controlled trial of', 90, 700),
      mkItem('the intervention in adults with the condition and', 90, 688),
      mkItem('followed participants for twelve months to assess', 90, 676),
      mkItem('the primary outcome of interest.', 90, 664),
    ];
    expect(gridFromRegion(prose, { x0: 0, y0: 600, x1: 600, y1: 750 })).toBeNull();
  });

  it('returns null for fewer than 2 rows', () => {
    const oneRow = [mkItem('120', 100, 700), mkItem('18/120', 260, 700)];
    expect(gridFromRegion(oneRow, { x0: 0, y0: 600, x1: 600, y1: 750 })).toBeNull();
  });

  it('returns null for malformed or inverted regions', () => {
    const items = tableItems();
    expect(gridFromRegion(items, null)).toBeNull();
    expect(gridFromRegion(items, {})).toBeNull();
    expect(gridFromRegion(items, { x0: 0, y0: 750, x1: 600, y1: 600 })).toBeNull(); // y0 must be bottom
    expect(gridFromRegion(items, { x0: 'a', y0: 0, x1: 10, y1: 10 })).toBeNull();
  });
});

describe('looksNumericColumn', () => {
  const cells = [
    ['Smith 2020', '120', '12.3 ± 4.5', '18/120', 'n = 30', ''],
    ['Jones 2021', '98', '11.1 (3.9)', '12/98', '45%', ''],
    ['Lee 2022', '150', '13.0 ± 5.2', '25/150', '1,234', ''],
    ['Chen 2023', '77', 'not reported', '9/77', '-0.4', ''],
  ];

  it('recognizes numeric columns (plain, mean-sd, events/total, n=, %, commas)', () => {
    expect(looksNumericColumn(cells, 1)).toBe(true); // plain integers
    expect(looksNumericColumn(cells, 2)).toBe(true); // 3/4 numeric = 75% ≥ 60%
    expect(looksNumericColumn(cells, 3)).toBe(true); // events/total
    expect(looksNumericColumn(cells, 4)).toBe(true); // n=, %, 1,234, negative
  });

  it('rejects text columns and columns without non-empty cells', () => {
    expect(looksNumericColumn(cells, 0)).toBe(false); // author labels
    expect(looksNumericColumn(cells, 5)).toBe(false); // all empty
  });

  it('applies the 60% threshold over NON-EMPTY cells only', () => {
    const mixed = [['12'], ['ns'], ['34'], [''], ['']]; // 2/3 non-empty numeric
    expect(looksNumericColumn(mixed, 0)).toBe(true);
    const mostlyText = [['12'], ['ns'], ['high'], ['low']]; // 1/4
    expect(looksNumericColumn(mostlyText, 0)).toBe(false);
  });

  it('is false for out-of-range or malformed input', () => {
    expect(looksNumericColumn(cells, 99)).toBe(false);
    expect(looksNumericColumn(cells, -1)).toBe(false);
    expect(looksNumericColumn(null, 0)).toBe(false);
    expect(looksNumericColumn([], 0)).toBe(false);
  });
});

describe('end-to-end: table region → grid → numeric classification', () => {
  it('classifies every column of the extracted 4×3 table as numeric', () => {
    const res = gridFromRegion(tableItems(), { x0: 0, y0: 600, x1: 600, y1: 750 });
    expect(res).not.toBeNull();
    expect(looksNumericColumn(res.grid.cells, 0)).toBe(true);
    expect(looksNumericColumn(res.grid.cells, 1)).toBe(true);
    expect(looksNumericColumn(res.grid.cells, 2)).toBe(true);
  });
});
