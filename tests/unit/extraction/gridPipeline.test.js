/**
 * gridPipeline.test.js — RoadMap/4.md §12 staged table pipeline: token repair
 * (mid-word splits), adaptive line building, caption/footnote stripping, wrapped-row
 * merging with hierarchy, and the buildTableGrid §10.2 contract.
 *
 * Items are constructed in pdf.js user space: transform=[a,b,c,d,x,y], y grows UP so
 * the visually-first row has the LARGEST y.
 */
import { describe, it, expect } from 'vitest';
import {
  repairTokens,
  buildLines,
  stripCaptionAndFootnotes,
  mergeWrappedRows,
  buildTableGrid,
  PARSER_VERSION,
} from '../../../src/research-engine/extraction/pdfTextGrid.js';

/** item(str, x, y, w, h) — a normalized item. */
const item = (str, x, y, w, h = 10) => ({ str, x, y, w, h });

describe('repairTokens — §12.1 mid-word split repair', () => {
  it('merges a mid-word split "u"+"nivariate" into one token', () => {
    // "u" at x=100 w=5, "nivariate" starting right after with a tiny gap
    const items = [item('u', 100, 700, 5), item('nivariate', 105.5, 700, 45)];
    const out = repairTokens(items);
    expect(out).toHaveLength(1);
    expect(out[0].str).toBe('univariate');
    expect(out[0].srcIndexes).toEqual([0, 1]);
  });

  it('preserves a true inter-word space (does NOT merge across a real gap)', () => {
    // "Male" then "sex" with a full space-width gap
    const items = [item('Male', 100, 700, 24), item('sex', 135, 700, 18)];
    const out = repairTokens(items);
    expect(out).toHaveLength(2);
  });

  it('does not merge across a large font-size change (superscript)', () => {
    const items = [item('value', 100, 700, 30, 10), item('2', 130.5, 704, 3, 5)];
    const out = repairTokens(items);
    expect(out.length).toBe(2);
  });

  it('is defensive on empty / single input', () => {
    expect(repairTokens([])).toEqual([]);
    expect(repairTokens([item('x', 1, 1, 5)])).toHaveLength(1);
  });
});

describe('buildLines — §12.2 adaptive baseline clustering', () => {
  it('clusters items into rows top-to-bottom and tolerates jitter', () => {
    const items = [
      item('A', 100, 700, 8), item('B', 200, 701, 8), // same line (jitter 1)
      item('C', 100, 680, 8), item('D', 200, 680, 8), // next line
    ];
    const lines = buildLines(items);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('A B');
    expect(lines[1].text).toBe('C D');
  });
});

describe('stripCaptionAndFootnotes — §12.3', () => {
  it('captures a Table N caption and keeps it out of the body', () => {
    const lines = buildLines([
      item('Table 2. Risk factors (Test Cohort, n = 390)', 100, 720, 200),
      item('Variable', 100, 700, 40), item('aOR', 200, 700, 20),
      item('SIRS', 100, 685, 30), item('2.24', 200, 685, 20),
    ]);
    const { caption, body, footnotes } = stripCaptionAndFootnotes(lines);
    expect(caption).toMatch(/^Table 2/);
    expect(caption).toMatch(/n = 390/); // subtitle absorbed into caption, not a data row
    expect(body.length).toBe(2);
    expect(footnotes).toEqual([]);
  });

  it('separates an abbreviation footnote from the data body', () => {
    const lines = buildLines([
      item('Variable', 100, 700, 40), item('aOR', 200, 700, 20),
      item('SIRS', 100, 685, 30), item('2.24', 200, 685, 20),
      item('CI, confidence interval; aOR, adjusted odds ratio', 100, 650, 220, 8),
    ]);
    const { body, footnotes } = stripCaptionAndFootnotes(lines);
    expect(footnotes.length).toBe(1);
    expect(footnotes[0]).toMatch(/confidence interval/);
    expect(body.every((l) => !/confidence interval/.test(l.text))).toBe(true);
  });
});

describe('mergeWrappedRows — §12.6 wrapped labels vs real hierarchy', () => {
  it('merges a hyphenated wrapped label ("ob-"+"struction")', () => {
    const cells = [
      ['Cause of biliary ob-', '', ''],
      ['struction', '', ''],
      ['Malignant', '64', '61'],
    ];
    const boxes = cells.map((r) => r.map(() => ({ x0: 100, y0: 0, x1: 110, y1: 10 })));
    const out = mergeWrappedRows(cells, boxes);
    expect(out[0].cells[0]).toBe('Cause of biliary obstruction');
    expect(out.length).toBe(2);
  });

  it('keeps indented numeric sub-rows as independent children (not flattened)', () => {
    const cells = [
      ['Patients, n', '125', '90'],
      ['EUS-BD', '64', '61'],
      ['ERCP', '61', '29'],
    ];
    const boxes = [
      [{ x0: 100, y0: 0, x1: 150, y1: 10 }],
      [{ x0: 112, y0: 0, x1: 150, y1: 10 }], // indented
      [{ x0: 112, y0: 0, x1: 150, y1: 10 }],
    ];
    const out = mergeWrappedRows(cells, boxes);
    expect(out.length).toBe(3); // children NOT merged into parent
    expect(out[1].indentLevel).toBe(1);
    expect(out[1].parentRow).toBe(0);
    expect(out[1].cells[1]).toBe('64'); // numeric data preserved
  });
});

describe('buildTableGrid — §10.2 grid contract', () => {
  it('produces the contract shape with caption, columns, rows, confidence, parserVersion', () => {
    const items = [
      item('Table 2. Predictors', 100, 720, 120),
      item('Variable', 100, 700, 40), item('aOR', 220, 700, 20), item('95% CI', 300, 700, 40),
      item('SIRS', 100, 685, 30), item('2.24', 220, 685, 20), item('1.40-3.57', 300, 685, 50),
      item('Age', 100, 670, 30), item('1.02', 220, 670, 20), item('0.99-1.03', 300, 670, 50),
    ];
    const grid = buildTableGrid(items);
    expect(grid).toBeTruthy();
    expect(grid.caption).toMatch(/^Table 2/);
    expect(grid.columns.length).toBeGreaterThanOrEqual(3);
    expect(grid.rows.length).toBeGreaterThanOrEqual(2);
    expect(grid.parserVersion).toBe(PARSER_VERSION);
    expect(typeof grid.confidence).toBe('number');
    expect(Array.isArray(grid.warnings)).toBe(true);
  });

  it('returns null for a non-table region', () => {
    expect(buildTableGrid([item('just one line of prose', 100, 700, 200)])).toBeNull();
  });

  it('does NOT collapse a combined "aOR (95% CI)" effect column into the label (regression F8)', () => {
    // Variable | aOR (95% CI) | P — the effect column co-occurs with the label on every
    // row, so the indent-collapse must leave it intact.
    const items = [
      item('Variable', 60, 700, 40), item('aOR (95% CI)', 240, 700, 60), item('P', 420, 700, 8),
      item('Age', 60, 686, 24), item('1.24 (0.99-1.03)', 240, 686, 80), item('0.06', 420, 686, 24),
      item('Male sex', 60, 672, 40), item('1.45 (1.10-1.91)', 240, 672, 80), item('0.008', 420, 672, 30),
      item('Smoking', 60, 658, 40), item('2.10 (1.50-2.94)', 240, 658, 80), item('0.001', 420, 658, 30),
    ];
    const grid = buildTableGrid(items);
    expect(grid).toBeTruthy();
    const age = grid.rows.find((r) => /Age/.test(r.cells[0].raw));
    expect(age.cells[0].raw).toBe('Age'); // label NOT merged with the effect column
    expect(age.cells.map((c) => c.raw).some((r) => /1\.24 \(0\.99/.test(r))).toBe(true); // effect preserved
  });

  it('does NOT strip a data row whose label is "A"/"B"/"C" as a footnote (regression F9)', () => {
    const lines = buildLines([
      item('Class', 100, 700, 30), item('Exp', 220, 700, 20), item('Ctrl', 300, 700, 24),
      item('A', 100, 685, 8), item('10 (33)', 220, 685, 40), item('12 (43)', 300, 685, 40),
      item('B', 100, 671, 8), item('14 (47)', 220, 671, 40), item('10 (36)', 300, 671, 40),
      item('C', 100, 657, 8), item('6 (20)', 220, 657, 34), item('6 (21)', 300, 657, 34),
    ]);
    const { body, footnotes } = stripCaptionAndFootnotes(lines);
    expect(footnotes).toEqual([]); // Child-Pugh class rows are DATA, not footnotes
    expect(body.length).toBe(4); // header + 3 class rows
  });

  it('does NOT absorb a Title-Case spanning header into the caption (regression F12)', () => {
    const lines = buildLines([
      item('Table 3. Study endpoints', 60, 720, 120),
      item('Outcomes', 60, 705, 40), // a spanning group header — must NOT be caption
      item('Group', 60, 690, 30), item('n', 240, 690, 6),
      item('Death', 60, 676, 30), item('12', 240, 676, 12),
      item('MI', 60, 662, 20), item('8', 240, 662, 8),
    ]);
    const { caption } = stripCaptionAndFootnotes(lines);
    expect(caption).toMatch(/^Table 3/);
    expect(caption).not.toMatch(/Outcomes/);
  });
});
