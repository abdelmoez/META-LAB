/**
 * tableShape.test.js — RoadMap/1.md e1 result-table shape detection.
 *
 * Covers the three mappable shapes (direct-effect ratio+CI, dichotomous
 * events/total, continuous mean/SD/n), the continuation-column merge pass
 * ('0.99' + '–1.03' → one 'ci' column; 'Age,' + 'years' → one label column),
 * footnote row filtering, CI/range recognition, header-span detection, and a
 * smoke that buildGrid's existing behaviour is unchanged.
 */

import { describe, it, expect } from 'vitest';
import {
  buildGrid,
  looksCiColumn,
  detectHeaderSpan,
  partitionRows,
  mergeContinuationColumns,
  CI_CELL_PATTERNS,
} from '../../../src/research-engine/extraction/pdfTextGrid.js';
import { detectTableShape } from '../../../src/research-engine/extraction/tableShape.js';

/** Build a grid input ({cells, boxes}) from a plain string matrix (null boxes). */
function gridOf(cells) {
  return { cells, boxes: cells.map((r) => r.map(() => null)) };
}

/* ── Golden grid 1: DIRECT-EFFECT univariate OR table ─────────────────────────
   Two-tier header (spanning "Multivariable analysis" over the ratio column) and
   a COMBINED 95% CI column ('0.99–1.03'). Per-variable rows — no events/total. */
const DIRECT_CELLS = [
  ['', 'Multivariable analysis', '', ''],
  ['Variable', 'aOR', '95% CI', 'P value'],
  ['Age, per year', '1.02', '0.99–1.03', '0.34'],
  ['Male sex', '1.45', '1.10–1.91', '0.008'],
  ['Smoking', '2.10', '1.50–2.94', '<0.001'],
  ['BMI', '0.98', '0.90–1.07', '0.65'],
];

/* ── Golden grid 2: DICHOTOMOUS two-arm events/total (two-tier header) ──────── */
const DICH_CELLS = [
  ['', 'Intervention', '', 'Control', ''],
  ['Study', 'Events', 'Total', 'Events', 'Total'],
  ['Trial A', '18', '120', '12', '98'],
  ['Trial B', '25', '150', '9', '77'],
  ['Trial C', '30', '160', '14', '101'],
];

/* ── Golden grid 3: CONTINUOUS two-arm mean/SD/n ───────────────────────────── */
const CONT_CELLS = [
  ['Study', 'Mean', 'SD', 'N', 'Mean', 'SD', 'N'],
  ['Trial A', '5.2', '1.1', '40', '4.8', '1.3', '38'],
  ['Trial B', '6.0', '0.9', '55', '5.5', '1.0', '50'],
  ['Trial C', '5.6', '1.0', '48', '5.1', '1.2', '45'],
];

describe('CI_CELL_PATTERNS / looksCiColumn', () => {
  it('recognizes dash, "to", unicode-dash and bracketed CI tokens', () => {
    const ok = ['0.99–1.03', '0.99-1.03', '0.95 to 1.08', '(0.95, 1.08)', '[0.90–1.07]', '0.99−1.03'];
    ok.forEach((s) => expect(CI_CELL_PATTERNS.some((re) => re.test(s))).toBe(true));
  });

  it('rejects plain numbers, negatives and thousands values', () => {
    ['1.02', '-0.4', '1,234', '45%', '18/120', 'ns'].forEach((s) =>
      expect(CI_CELL_PATTERNS.some((re) => re.test(s))).toBe(false)
    );
  });

  it('flags a column that is ≥60% CI tokens', () => {
    const ciCol = DIRECT_CELLS.slice(2); // body rows only
    expect(looksCiColumn(ciCol, 2)).toBe(true); // the CI column
    expect(looksCiColumn(ciCol, 1)).toBe(false); // the ratio column
    expect(looksCiColumn(ciCol, 99)).toBe(false);
  });
});

describe('detectHeaderSpan', () => {
  it('spans a two-tier header and combines column names top-to-bottom', () => {
    const { headerRows, headerText } = detectHeaderSpan(DICH_CELLS);
    expect(headerRows).toBe(2);
    expect(headerText[0]).toBe('Study');
    expect(headerText[1]).toBe('Intervention Events');
    expect(headerText[2]).toBe('Total');
    expect(headerText[3]).toBe('Control Events');
  });

  it('detects a single-row header and stops at the first data row', () => {
    const { headerRows, headerText } = detectHeaderSpan(CONT_CELLS);
    expect(headerRows).toBe(1);
    expect(headerText).toEqual(['Study', 'Mean', 'SD', 'N', 'Mean', 'SD', 'N']);
  });
});

describe('partitionRows — footnote filtering', () => {
  const withFootnote = [
    ['Variable', 'aOR', '95% CI', 'P value'],
    ['Age', '1.02', '0.99–1.03', '0.34'],
    ['Male sex', '1.45', '1.10–1.91', '0.008'],
    ['* CI, confidence interval; aOR, adjusted odds ratio', '', '', ''],
  ];

  it('keeps data rows as body and routes the footnote out', () => {
    const { headerRows, bodyRowIdx, footnoteRowIdx } = partitionRows(withFootnote);
    expect(headerRows).toBe(1);
    expect(bodyRowIdx).toEqual([1, 2]);
    expect(footnoteRowIdx).toEqual([3]);
  });

  it('does not mistake a multi-value data row for a footnote', () => {
    const { bodyRowIdx, footnoteRowIdx } = partitionRows([
      ['Variable', 'aOR', '95% CI'],
      ['Age', '1.02', '0.99–1.03'], // starts with 'A' — not a footnote marker
      ['Note: adjusted', '', ''], // concentrates in col0 + "Note" leader → footnote
    ]);
    expect(bodyRowIdx).toEqual([1]);
    expect(footnoteRowIdx).toEqual([2]);
  });
});

describe('mergeContinuationColumns', () => {
  it("collapses a split CI ('0.99' + '–1.03') into one 'ci' column", () => {
    const split = [
      ['Variable', 'aOR', '95% CI', '', 'P value'],
      ['Age', '1.02', '0.99', '–1.03', '0.34'],
      ['Male sex', '1.45', '1.10', '–1.91', '0.008'],
      ['BMI', '0.98', '0.90', '–1.07', '0.65'],
    ];
    const { cells, merges } = mergeContinuationColumns(gridOf(split));
    expect(merges).toEqual([{ leftCol: 2, rightCol: 3, kind: 'ci' }]);
    expect(cells[0]).toEqual(['Variable', 'aOR', '95% CI', 'P value']);
    expect(cells[1]).toEqual(['Age', '1.02', '0.99–1.03', '0.34']);
    // The effect column is NOT swallowed by the CI header.
    expect(cells[1][1]).toBe('1.02');

    // Downstream: the merged grid classifies as direct-effect with one CI column.
    const shape = detectTableShape({ cells, boxes: null });
    expect(shape.columnTags.filter((t) => t === 'ci')).toHaveLength(1);
    expect(shape.columnTags[2]).toBe('ci');
    expect(shape.shape).toBe('direct-effect');
  });

  it('collapses a comma label continuation (\"Age,\" + \"years\")', () => {
    const split = [
      ['Characteristic', '', 'n'],
      ['Age,', 'years', '40'],
      ['Weight,', 'kg', '55'],
      ['Height,', 'cm', '170'],
    ];
    const { cells, merges } = mergeContinuationColumns(gridOf(split));
    expect(merges).toEqual([{ leftCol: 0, rightCol: 1, kind: 'label' }]);
    expect(cells[1]).toEqual(['Age, years', '40']);
    expect(cells[2]).toEqual(['Weight, kg', '55']);
  });

  it('does not mutate the input grid and leaves an already-clean grid alone', () => {
    const clean = gridOf(DICH_CELLS.map((r) => r.slice()));
    const snapshot = JSON.stringify(clean.cells);
    const { merges, cells } = mergeContinuationColumns(clean);
    expect(merges).toEqual([]);
    expect(cells).toEqual(DICH_CELLS);
    expect(JSON.stringify(clean.cells)).toBe(snapshot); // input untouched
  });
});

describe('detectTableShape — three shapes', () => {
  it('classifies a direct-effect OR table (per-variable, high confidence)', () => {
    const s = detectTableShape(gridOf(DIRECT_CELLS));
    expect(s.shape).toBe('direct-effect');
    expect(s.rowKind).toBe('per-variable');
    expect(s.headerRows).toBe(2);
    expect(s.columnTags).toEqual(['row-label', 'effect', 'ci', 'pValue']);
    expect(s.confidence).toBeGreaterThan(0.7);
  });

  it('classifies a dichotomous events/total table (per-arm)', () => {
    const s = detectTableShape(gridOf(DICH_CELLS));
    expect(s.shape).toBe('dichotomous');
    expect(s.rowKind).toBe('per-arm');
    expect(s.headerRows).toBe(2);
    expect(s.columnTags).toEqual(['row-label', 'events', 'total', 'events', 'total']);
    expect(s.confidence).toBeGreaterThan(0.7);
  });

  it('classifies a continuous mean/SD/n table (per-arm)', () => {
    const s = detectTableShape(gridOf(CONT_CELLS));
    expect(s.shape).toBe('continuous');
    expect(s.rowKind).toBe('per-arm');
    expect(s.headerRows).toBe(1);
    expect(s.columnTags).toEqual(['row-label', 'mean', 'sd', 'n', 'mean', 'sd', 'n']);
    expect(s.confidence).toBeGreaterThan(0.7);
  });

  it('tags a separate lower/upper CI pair as ciLow/ciHigh', () => {
    const s = detectTableShape(
      gridOf([
        ['Variable', 'aOR', '95% CI', '', 'P value'],
        ['Age', '1.02', '0.99', '1.03', '0.34'],
        ['Male sex', '1.45', '1.10', '1.91', '0.008'],
        ['BMI', '0.98', '0.90', '1.07', '0.65'],
      ])
    );
    expect(s.shape).toBe('direct-effect');
    expect(s.columnTags[2]).toBe('ciLow');
    expect(s.columnTags[3]).toBe('ciHigh');
  });

  it('returns unknown / low confidence for a table with no data signals', () => {
    const s = detectTableShape(
      gridOf([
        ['Author', 'Country', 'Design'],
        ['Smith', 'USA', 'RCT'],
        ['Jones', 'UK', 'Cohort'],
      ])
    );
    expect(s.shape).toBe('unknown');
    expect(s.confidence).toBeLessThan(0.5);
  });

  it('is defensive on tiny / malformed input', () => {
    expect(detectTableShape({ cells: [] }).shape).toBe('unknown');
    expect(detectTableShape(null).shape).toBe('unknown');
    expect(detectTableShape({ cells: [['only one row']] }).shape).toBe('unknown');
  });
});

describe('detectTableShape — §14 canonical shapes, evidence, alternates, arm matching', () => {
  it('maps internal names to the 4.md canonical vocabulary', () => {
    expect(detectTableShape(gridOf(DIRECT_CELLS)).canonicalShape).toBe('effect-per-row');
    expect(detectTableShape(gridOf(DICH_CELLS)).canonicalShape).toBe('two-by-two');
    expect(detectTableShape(gridOf(CONT_CELLS)).canonicalShape).toBe('mean-sd');
  });

  it('surfaces plain-language evidence for the chosen shape', () => {
    const s = detectTableShape(gridOf(DIRECT_CELLS));
    expect(Array.isArray(s.evidence)).toBe(true);
    expect(s.evidence.join(' ')).toMatch(/effect-measure|CI/i);
  });

  it('detects a multi-study summary table as arms-in-columns (Khoury §14.2)', () => {
    const khoury = [
      ['Characteristic', 'Paik et al. [5]', 'Park 2018', 'Kim (2019)', 'Lee et al', 'Cho 2020'],
      ['Patients, n', '125', '90', '110', '84', '77'],
      ['Technical success, %', '94', '96', '92', '95', '93'],
      ['Adverse events, %', '12', '9', '14', '11', '10'],
    ];
    const s = detectTableShape(gridOf(khoury));
    expect(s.canonicalShape).toBe('arms-in-columns');
    expect(s.evidence.join(' ')).toMatch(/multi-study/i);
  });

  it('offers a runner-up shape as an alternate when scores are close', () => {
    // A table with BOTH a mean/SD and events signal can score two shapes closely.
    const ambiguous = [
      ['Study', 'Events', 'Total', 'Mean', 'SD'],
      ['A', '18', '120', '5.2', '1.1'],
      ['B', '25', '150', '6.0', '0.9'],
    ];
    const s = detectTableShape(gridOf(ambiguous));
    expect(Array.isArray(s.alternates)).toBe(true);
  });

  it('performs PICO arm matching when pico is supplied', () => {
    const armsTable = [
      ['Outcome', 'EUS-BD', 'ERCP'],
      ['Technical success', '0.94', '0.90'],
      ['Adverse events', '0.12', '0.18'],
    ];
    const s = detectTableShape(gridOf(armsTable), { intervention: 'EUS-BD', comparator: 'ERCP' });
    expect(s.armAssignment).toBeTruthy();
    expect(s.armAssignment.confident).toBe(true);
  });

  it('backward compatible: pico is optional (armAssignment null when absent)', () => {
    expect(detectTableShape(gridOf(DIRECT_CELLS)).armAssignment).toBeNull();
  });
});

describe('existing-behaviour smoke: buildGrid unchanged', () => {
  it('grids a simple 2×2 into the same cell matrix', () => {
    const rows = [
      { y: 700, items: [{ str: 'a', x: 100, y: 700, w: 5, h: 10 }, { str: 'b', x: 200, y: 700, w: 5, h: 10 }] },
      { y: 685, items: [{ str: 'c', x: 100, y: 685, w: 5, h: 10 }, { str: 'd', x: 200, y: 685, w: 5, h: 10 }] },
    ];
    const { cells, boxes } = buildGrid(rows, [100, 200]);
    expect(cells).toEqual([['a', 'b'], ['c', 'd']]);
    expect(boxes[0][0]).toEqual({ x0: 100, y0: 700, x1: 105, y1: 710 });
  });
});
