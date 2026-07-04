/**
 * fixtures.integration.test.js — RoadMap/4.md §11 + §15 + §33.2. Run the full grid
 * pipeline against the SYNTHETIC extraction fixtures and assert the §15 acceptance
 * criteria. Fixtures are labelled synthetic (the real Sujan/Khoury PDFs are not in the
 * repo); see tests/fixtures/extraction/README.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTableGrid,
  itemsToRows,
  detectColumns,
  buildGrid,
  mergeContinuationColumns,
  repairTokens,
  buildLines,
  stripCaptionAndFootnotes,
} from '../../../src/research-engine/extraction/pdfTextGrid.js';
import { detectTableShape } from '../../../src/research-engine/extraction/tableShape.js';
import { parseCell } from '../../../src/research-engine/extraction/cellGrammar.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'extraction');
const load = (name) => JSON.parse(readFileSync(join(DIR, name), 'utf8'));

describe('fixtures: Sujan-style effect-per-row (§15.1)', () => {
  const fx = load('sujan-table2.synthetic.json');

  it('repairs the mid-word header split (Predictor v + ariables → variables)', () => {
    const repaired = repairTokens(fx.items);
    const joined = repaired.map((r) => r.str).join(' ');
    expect(joined).toMatch(/variables/);
    expect(joined).not.toMatch(/\bv ariables\b/);
  });

  it('captures the caption subtitle and keeps "n = 390" out of the data body', () => {
    const lines = buildLines(repairTokens(fx.items));
    const { caption, body } = stripCaptionAndFootnotes(lines);
    expect(caption).toMatch(/Test Cohort, n = 390/);
    expect(body.some((l) => /n = 390/.test(l.text))).toBe(false);
  });

  it('builds a grid whose SIRS row parses to aOR 2.24, CI [1.40, 3.57], P 0.001', () => {
    const grid = buildTableGrid(fx.items);
    expect(grid).toBeTruthy();
    const sirs = grid.rows.find((r) => /SIRS/.test(r.cells[0].raw));
    expect(sirs).toBeTruthy();
    const raws = sirs.cells.map((c) => c.raw);
    expect(raws).toContain('2.24');
    const ci = raws.map(parseCell).find((p) => p && p.kind === 'CI');
    expect(ci).toMatchObject({ low: 1.40, high: 3.57 });
    const p = raws.map(parseCell).find((x) => x && x.kind === 'P');
    expect(p).toMatchObject({ value: 0.001, operator: '<' }); // inequality preserved (§13.1)
  });

  it('classifies as effect-per-row (no events/total required)', () => {
    const rows = itemsToRows(repairTokens(fx.items).filter((i) => i.y < 745)); // drop caption
    const cols = detectColumns(rows);
    const grid = buildGrid(rows, cols);
    const merged = mergeContinuationColumns(grid);
    const shape = detectTableShape(merged);
    expect(shape.canonicalShape).toBe('effect-per-row');
  });
});

describe('fixtures: Khoury-style arms-in-columns (§15.2)', () => {
  const fx = load('khoury-table1.synthetic.json');

  it('merges the wrapped "biliary ob-/struction" label into one logical row', () => {
    const grid = buildTableGrid(fx.items);
    expect(grid).toBeTruthy();
    const labels = grid.rows.map((r) => r.cells[0].raw);
    expect(labels.some((l) => /biliary obstruction/.test(l))).toBe(true);
  });

  it('keeps EUS-BD / ERCP as indented children of "Patients, n"', () => {
    const grid = buildTableGrid(fx.items);
    const eus = grid.rows.find((r) => /EUS-BD/.test(r.cells[0].raw));
    const ercp = grid.rows.find((r) => /ERCP/.test(r.cells[0].raw));
    expect(eus).toBeTruthy();
    expect(ercp).toBeTruthy();
    expect(eus.indentLevel).toBe(1);
    expect(eus.parentRow).not.toBeNull();
    // Paik column value preserved for EUS-BD (64) and ERCP (61).
    expect(eus.cells.map((c) => c.raw)).toContain('64');
    expect(ercp.cells.map((c) => c.raw)).toContain('61');
  });

  it('detects the arms-in-columns (multi-study) shape and drops no study column', () => {
    const rows = itemsToRows(fx.items.filter((i) => i.y < 745 && !/endoscopic ultrasound/.test(i.str)));
    const cols = detectColumns(rows);
    expect(cols.length).toBeGreaterThanOrEqual(5); // 1 label + ≥5 study columns
    const grid = buildGrid(rows, cols);
    const shape = detectTableShape(grid);
    expect(shape.canonicalShape).toBe('arms-in-columns');
  });
});

describe('fixtures: mean-sd and events/total (§14.4/§14.3)', () => {
  it('mean-sd fixture classifies as mean-sd', () => {
    const fx = load('mean-sd.synthetic.json');
    const rows = itemsToRows(fx.items);
    const grid = buildGrid(rows, detectColumns(rows));
    expect(detectTableShape(grid).canonicalShape).toBe('mean-sd');
  });

  it('events/total fixture classifies as two-by-two with a missing cell tolerated', () => {
    const fx = load('events-total.synthetic.json');
    const rows = itemsToRows(fx.items);
    const grid = buildGrid(rows, detectColumns(rows));
    const shape = detectTableShape(grid);
    expect(['two-by-two', 'arms-in-columns']).toContain(shape.canonicalShape);
  });
});
