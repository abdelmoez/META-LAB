/**
 * features/manuscript/richEditor/tableOps.js — 116.md §59-§66 (Manuscript Editor
 * native tables). PURE structural operations on pipe-markdown tables — no DOM, no
 * React — so every table edit is unit-testable in Node exactly like mdDom.js.
 *
 * The model deliberately stays INSIDE the pipe grammar (116.md §63): a table is
 * { header:[cells]|null, rows:[[cells]], align:[…]|null } — the parsePipeTable
 * shape — and every op re-serializes through the shared serializePipeTable, so
 * the editor, the autosaved markdown and the DOCX exporter can never disagree.
 * No merge/split (unrepresentable → would become a DOM-only feature that silently
 * drops on remount, the §63 violation), no block content in cells.
 *
 * Coordinates: gridRow is the 0-based row index over [header?, …bodyRows] — the
 * same order the rendered <tr> elements have — and col is the 0-based cell index.
 * Ops return { md, caret } where md === null means "the table is gone" and caret
 * is the {gridRow, col} the editor should land in afterwards (Word-modeled).
 */

import { parsePipeTable, serializePipeTable } from './mdDom.js';

/** Parse a markdown table block (only its `|` lines) into the model. */
export function parseTableModel(md) {
  // same line test the mdToHtml block grouper uses — a table block is exactly
  // the run of `|`-prefixed lines
  const lines = String(md == null ? '' : md).split(/\r?\n/).filter((l) => /^\s*\|/.test(l));
  if (!lines.length) return null;
  return parsePipeTable(lines);
}

/** Model → canonical pipe markdown (rectangularized, pipes escaped). */
export function serializeTableModel(model) {
  return serializePipeTable(model);
}

/** Re-serialize a table block canonically (rectangularize ragged input). */
export function normalizeTableMd(md) {
  const m = parseTableModel(md);
  return m ? serializePipeTable(m) : null;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi));

/** Rectangular width of a model. */
function widthOf(m) {
  return Math.max(m.header ? m.header.length : 0, ...m.rows.map((r) => r.length), 1);
}

/** Pad every row/header/align of the model to the rectangular width, in place. */
function rectangularize(m) {
  const w = widthOf(m);
  const pad = (arr, fill) => { while (arr.length < w) arr.push(fill); return arr; };
  if (m.header) pad(m.header, '');
  for (const r of m.rows) pad(r, '');
  if (m.align) pad(m.align, null);
  return m;
}

/**
 * 116.md §60 — a fresh empty table. `rows` counts TOTAL rows including the
 * header: manuscript tables always carry a header row (bold + repeats across
 * pages in the Word export), so the first grid row is the header.
 */
export function makeTableMd(rows, cols) {
  const r = clamp(Math.floor(Number(rows) || 0), 1, 30);
  const c = clamp(Math.floor(Number(cols) || 0), 1, 12);
  const empty = () => Array.from({ length: c }, () => '');
  return serializePipeTable({
    header: empty(),
    rows: Array.from({ length: r - 1 }, empty),
    align: null,
  });
}

/** gridRow → body index; -1 when the gridRow addresses the header row. */
function bodyIndexOf(m, gridRow) {
  return m.header ? gridRow - 1 : gridRow;
}

function emptyRow(m) {
  return Array.from({ length: widthOf(m) }, () => '');
}

/* ── the ops — each takes (md, {gridRow, col}) and returns {md, caret}|null ── */

function rowAbove(m, ctx) {
  rectangularize(m);
  // 116.md §61 — the pipe grammar cannot represent a row ABOVE the header;
  // inserting "above" the header inserts the first body row instead (the closest
  // representable intent — Word has no header concept to collide with).
  const at = Math.max(0, bodyIndexOf(m, ctx.gridRow));
  m.rows.splice(at, 0, emptyRow(m));
  const gridRow = m.header ? at + 1 : at;
  return { md: serializePipeTable(m), caret: { gridRow, col: ctx.col } };
}

function rowBelow(m, ctx) {
  rectangularize(m);
  const at = clamp(bodyIndexOf(m, ctx.gridRow) + 1, 0, m.rows.length);
  m.rows.splice(at, 0, emptyRow(m));
  const gridRow = m.header ? at + 1 : at;
  return { md: serializePipeTable(m), caret: { gridRow, col: ctx.col } };
}

function colLeft(m, ctx) {
  return insertCol(m, ctx, ctx.col);
}

function colRight(m, ctx) {
  return insertCol(m, ctx, ctx.col + 1);
}

function insertCol(m, ctx, at) {
  rectangularize(m);
  const i = clamp(at, 0, widthOf(m));
  if (m.header) m.header.splice(i, 0, '');
  for (const r of m.rows) r.splice(i, 0, '');
  if (m.align) m.align.splice(i, 0, null);
  return { md: serializePipeTable(m), caret: { gridRow: ctx.gridRow, col: i } };
}

function deleteRow(m, ctx) {
  rectangularize(m);
  if (m.header && ctx.gridRow === 0) {
    // Deleting the header row: the table becomes headerless (the grammar
    // supports that); alignment lives on the separator row, so it drops with it.
    if (!m.rows.length) return { md: null, caret: null };
    const next = { header: null, rows: m.rows, align: null };
    return { md: serializePipeTable(next), caret: { gridRow: 0, col: ctx.col } };
  }
  const at = bodyIndexOf(m, ctx.gridRow);
  if (at < 0 || at >= m.rows.length) return null;
  m.rows.splice(at, 1);
  if (!m.rows.length && !m.header) return { md: null, caret: null };
  const gridRows = (m.header ? 1 : 0) + m.rows.length;
  return { md: serializePipeTable(m), caret: { gridRow: clamp(ctx.gridRow, 0, gridRows - 1), col: ctx.col } };
}

function deleteCol(m, ctx) {
  rectangularize(m);
  const w = widthOf(m);
  if (ctx.col < 0 || ctx.col >= w) return null;
  if (w <= 1) return { md: null, caret: null }; // last column → the table is gone
  if (m.header) m.header.splice(ctx.col, 1);
  for (const r of m.rows) r.splice(ctx.col, 1);
  if (m.align) m.align.splice(ctx.col, 1);
  return { md: serializePipeTable(m), caret: { gridRow: ctx.gridRow, col: clamp(ctx.col, 0, w - 2) } };
}

function deleteTable() {
  return { md: null, caret: null };
}

export const TABLE_OPS = {
  rowAbove, rowBelow, colLeft, colRight, deleteRow, deleteCol, deleteTable,
};

/**
 * Apply a named structural op to a table's markdown. Returns { md, caret } —
 * md === null means "delete the whole table" — or null for an unknown op /
 * unparseable table (the caller leaves the document untouched).
 */
export function applyTableOp(opId, md, ctx = {}) {
  const op = TABLE_OPS[opId];
  if (!op) return null;
  const m = parseTableModel(md);
  if (!m) return null;
  const c = {
    gridRow: clamp(Math.floor(Number(ctx.gridRow) || 0), 0, (m.header ? 1 : 0) + m.rows.length),
    col: clamp(Math.floor(Number(ctx.col) || 0), 0, widthOf(m) - 1),
  };
  return op(m, c);
}

export default {
  parseTableModel, serializeTableModel, normalizeTableMd, makeTableMd,
  applyTableOp, TABLE_OPS,
};
