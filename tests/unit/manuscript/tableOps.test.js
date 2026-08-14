/**
 * 116.md §59-§66 — pure structural table ops for the Manuscript Editor.
 * Pins:
 *   1. makeTableMd builds a header-first empty table of the requested size.
 *   2. Every op (insert/delete row/col, delete table) transforms the model
 *      correctly, stays inside the pipe grammar, and reports the Word-modeled
 *      caret target.
 *   3. Ops preserve alignment and escaped-pipe cell content.
 *   4. Every op output is a round-trip FIXED POINT of the mdDom converters
 *      (htmlToMd(mdToHtml(md)) === md) — the §63 no-DOM-only-tables guarantee.
 *   5. normalizeTableMd rectangularizes ragged input.
 */
import { describe, it, expect } from 'vitest';
import {
  parseTableModel, serializeTableModel, normalizeTableMd, makeTableMd,
  applyTableOp, TABLE_OPS,
} from '../../../src/features/manuscript/richEditor/tableOps.js';
import { mdToHtml, htmlToMd } from '../../../src/features/manuscript/richEditor/mdDom.js';

const rt = (md) => htmlToMd(mdToHtml(md));

/** Assert md is a byte-stable fixed point of the editor round trip. */
function expectFixedPoint(md, label) {
  expect(rt(md), `${label} should be round-trip stable`).toBe(md);
}

const T = [
  '| H1 | H2 | H3 |',
  '| :--- | :---: | ---: |',
  '| a | b | c |',
  '| d | e | f |',
].join('\n');

describe('makeTableMd (116.md §60)', () => {
  it('builds a header-first empty rows × cols table', () => {
    expect(makeTableMd(3, 2)).toBe('|  |  |\n| --- | --- |\n|  |  |\n|  |  |');
    expect(makeTableMd(1, 1)).toBe('|  |\n| --- |');
  });
  it('clamps degenerate sizes instead of throwing', () => {
    expect(makeTableMd(0, 0)).toBe('|  |\n| --- |');
    expect(makeTableMd('junk', null)).toBe('|  |\n| --- |');
  });
  it('every generated table is a round-trip fixed point', () => {
    for (const [r, c] of [[1, 1], [2, 3], [4, 6], [3, 1]]) {
      expectFixedPoint(makeTableMd(r, c), `makeTableMd(${r},${c})`);
    }
  });
});

describe('parse/serialize/normalize', () => {
  it('parseTableModel reads only the pipe lines and keeps alignment', () => {
    const m = parseTableModel(T);
    expect(m.header).toEqual(['H1', 'H2', 'H3']);
    expect(m.align).toEqual(['left', 'center', 'right']);
    expect(m.rows).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
    expect(serializeTableModel(m)).toBe(T);
  });
  it('returns null for non-table text', () => {
    expect(parseTableModel('just prose')).toBeNull();
    expect(parseTableModel('')).toBeNull();
  });
  it('normalizeTableMd rectangularizes ragged rows', () => {
    expect(normalizeTableMd('| a | b |\n| c |')).toBe('| a | b |\n| c |  |');
  });
});

describe('row ops (116.md §61)', () => {
  it('rowBelow inserts after the caret row, caret lands in the new row', () => {
    const r = applyTableOp('rowBelow', T, { gridRow: 1, col: 2 });
    expect(r.md.split('\n')).toEqual([
      '| H1 | H2 | H3 |', '| :--- | :---: | ---: |', '| a | b | c |', '|  |  |  |', '| d | e | f |',
    ]);
    expect(r.caret).toEqual({ gridRow: 2, col: 2 });
    expectFixedPoint(r.md, 'rowBelow');
  });

  it('rowBelow at the header inserts the first body row', () => {
    const r = applyTableOp('rowBelow', T, { gridRow: 0, col: 0 });
    expect(r.md.split('\n')[2]).toBe('|  |  |  |');
    expect(r.caret).toEqual({ gridRow: 1, col: 0 });
  });

  it('rowAbove inserts before the caret row and keeps the caret on it', () => {
    const r = applyTableOp('rowAbove', T, { gridRow: 2, col: 1 });
    expect(r.md.split('\n')).toEqual([
      '| H1 | H2 | H3 |', '| :--- | :---: | ---: |', '| a | b | c |', '|  |  |  |', '| d | e | f |',
    ]);
    expect(r.caret).toEqual({ gridRow: 2, col: 1 });
  });

  it('rowAbove at the header degrades to first-body-row (the grammar keeps the header first)', () => {
    const r = applyTableOp('rowAbove', T, { gridRow: 0, col: 0 });
    expect(r.md.split('\n')[2]).toBe('|  |  |  |');
    expect(r.caret).toEqual({ gridRow: 1, col: 0 });
  });

  it('deleteRow removes a body row and clamps the caret', () => {
    const r = applyTableOp('deleteRow', T, { gridRow: 2, col: 1 });
    expect(r.md.split('\n')).toEqual(['| H1 | H2 | H3 |', '| :--- | :---: | ---: |', '| a | b | c |']);
    expect(r.caret).toEqual({ gridRow: 1, col: 1 });
  });

  it('deleteRow on the header makes the table headerless and drops alignment honestly', () => {
    const r = applyTableOp('deleteRow', T, { gridRow: 0, col: 0 });
    expect(r.md).toBe('| a | b | c |\n| d | e | f |');
    expect(r.caret).toEqual({ gridRow: 0, col: 0 });
    expectFixedPoint(r.md, 'headerless after header delete');
  });

  it('deleting the last remaining row deletes the table (md null)', () => {
    const one = '| only |';
    expect(applyTableOp('deleteRow', one, { gridRow: 0, col: 0 })).toEqual({ md: null, caret: null });
    const headerOnly = '| H |\n| --- |';
    expect(applyTableOp('deleteRow', headerOnly, { gridRow: 0, col: 0 })).toEqual({ md: null, caret: null });
  });
});

describe('column ops (116.md §61)', () => {
  it('colLeft inserts an empty column before the caret column (alignment stays with its column)', () => {
    const r = applyTableOp('colLeft', T, { gridRow: 2, col: 1 });
    expect(r.md.split('\n')).toEqual([
      '| H1 |  | H2 | H3 |', '| :--- | --- | :---: | ---: |', '| a |  | b | c |', '| d |  | e | f |',
    ]);
    expect(r.caret).toEqual({ gridRow: 2, col: 1 });
    expectFixedPoint(r.md, 'colLeft');
  });

  it('colRight inserts after the caret column', () => {
    const r = applyTableOp('colRight', T, { gridRow: 1, col: 2 });
    expect(r.md.split('\n')[0]).toBe('| H1 | H2 | H3 |  |');
    expect(r.md.split('\n')[1]).toBe('| :--- | :---: | ---: | --- |');
    expect(r.caret).toEqual({ gridRow: 1, col: 3 });
  });

  it('deleteCol removes the column everywhere including the separator', () => {
    const r = applyTableOp('deleteCol', T, { gridRow: 1, col: 1 });
    expect(r.md.split('\n')).toEqual([
      '| H1 | H3 |', '| :--- | ---: |', '| a | c |', '| d | f |',
    ]);
    expect(r.caret).toEqual({ gridRow: 1, col: 1 });
  });

  it('deleting the last column deletes the table', () => {
    const r1 = applyTableOp('deleteCol', '| a |\n| b |', { gridRow: 0, col: 0 });
    expect(r1).toEqual({ md: null, caret: null });
  });
});

describe('deleteTable + unknown ops', () => {
  it('deleteTable always reports the table gone', () => {
    expect(applyTableOp('deleteTable', T, { gridRow: 1, col: 1 })).toEqual({ md: null, caret: null });
  });
  it('unknown op or unparseable table → null (caller leaves the document alone)', () => {
    expect(applyTableOp('mergeCells', T, { gridRow: 0, col: 0 })).toBeNull();
    expect(applyTableOp('rowBelow', 'not a table', { gridRow: 0, col: 0 })).toBeNull();
  });
  it('exports exactly the seven supported ops (no merge/split — unrepresentable in the grammar)', () => {
    expect(Object.keys(TABLE_OPS).sort()).toEqual(
      ['colLeft', 'colRight', 'deleteCol', 'deleteRow', 'deleteTable', 'rowAbove', 'rowBelow'],
    );
  });
});

describe('content safety through ops (116.md §63)', () => {
  const esc = '| A | B |\n| --- | --- |\n| a\\|b | [[cite:r1]] |';

  it('escaped pipes and chip tokens survive every structural op', () => {
    for (const op of ['rowAbove', 'rowBelow', 'colLeft', 'colRight']) {
      const r = applyTableOp(op, esc, { gridRow: 2, col: 0 });
      expect(r.md, op).toContain('a\\|b');
      expect(r.md, op).toContain('[[cite:r1]]');
      expectFixedPoint(r.md, op);
    }
  });

  it('ragged input is rectangularized by any op', () => {
    const r = applyTableOp('rowBelow', '| a | b |\n| c |', { gridRow: 1, col: 0 });
    expect(r.md).toBe('| a | b |\n| c |  |\n|  |  |');
  });

  it('out-of-range coordinates are clamped, never a crash', () => {
    const r = applyTableOp('rowBelow', T, { gridRow: 99, col: 99 });
    expect(r.md.split('\n')).toHaveLength(5);
    const c = applyTableOp('deleteCol', T, { gridRow: 0, col: 99 });
    expect(c.md.split('\n')[0]).toBe('| H1 | H2 |');
  });
});
