/**
 * extraction/tableShape.js — RoadMap/1.md e1. Deterministic classification of a
 * detected PDF result table into one of three mappable SHAPES, plus a per-column
 * semantic tagging so the TableRegionMapper can pre-fill roles (and fall back to
 * manual tagging when confidence is low).
 *
 * The three shapes a reviewer actually maps:
 *   • direct-effect — per-variable / per-outcome rows carrying a ratio
 *     (OR/RR/HR/…) + a 95% CI (combined column or a low/high pair) + optional P.
 *     We read the effect and its CI straight off the row — no events/total.
 *   • dichotomous  — two-arm events/total (→ 2×2).
 *   • continuous   — two-arm mean/SD/n.
 *
 * Pure, dependency-free (only the sibling grid primitives). No I/O, no DOM, no
 * Date.now(); same grid in → same classification out. Confidence is deliberately
 * LOW when signals conflict — the mapper treats <~0.5 as "ask the human".
 */

import {
  looksNumericColumn,
  looksCiColumn,
  detectHeaderSpan,
  partitionRows,
} from './pdfTextGrid.js';

/* ── Header keyword vocabulary ───────────────────────────────────────────────
   Checked against each column's COMBINED (top-to-bottom) header text. */
const EFFECT_RE = /\b(a?OR|RR|HR|IRR|aHR)\b|odds ratio|risk ratio|hazard ratio|rate ratio/i;
const CI_RE = /95\s*%?\s*c\.?\s*i\.?|confidence\s*interval/i;
const P_RE = /\bp\b|p[-\s]?value/i;
const EVENTS_RE = /event|death|\bcases?\b|respond|\bno\.?\b|n\/n/i;
const TOTAL_RE = /\btotal\b|denominator/i;
const MEAN_RE = /\bmean\b/i;
const SD_RE = /\bsd\b|s\.d\.|standard\s*deviation|\bstd\.?\b|deviation/i;
const N_RE = /^n$|\(n\)|\bn\s*=|sample\s*size|participants|patients|no\.\s*of/i;
const MEDIAN_RE = /median/i;
const Q1_RE = /\bq1\b|25th|lower\s*quartile/i;
const Q3_RE = /\bq3\b|75th|upper\s*quartile/i;

/** Body-cell events/total token, e.g. "18/120". */
const SLASH_RE = /^\d[\d,]*\s*\/\s*\d[\d,]*$/;

/**
 * detectTableShape({cells, boxes}) — classify a grid and tag its columns.
 *
 * @param {{cells:string[][], boxes?:Array}} input  a buildGrid() result (ideally
 *   after mergeContinuationColumns so a split CI is a single column)
 * @returns {{
 *   shape:'direct-effect'|'dichotomous'|'continuous'|'unknown',
 *   columnTags:string[],
 *   rowKind:'per-variable'|'per-arm',
 *   headerRows:number,
 *   confidence:number
 * }}
 *   columnTags[i] ∈ 'row-label','effect','ci','ciLow','ciHigh','pValue',
 *   'events','total','mean','sd','n','median','q1','q3','ignore'.
 */
export function detectTableShape(input) {
  const cellsIn = input && Array.isArray(input.cells) ? input.cells : [];
  const nCols = cellsIn.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
  const cells = cellsIn.map((r) => {
    const row = Array.isArray(r) ? r.map((v) => (v == null ? '' : String(v))) : [];
    while (row.length < nCols) row.push('');
    return row;
  });

  const empty = {
    shape: 'unknown',
    columnTags: new Array(nCols).fill('ignore'),
    rowKind: 'per-arm',
    headerRows: 0,
    confidence: 0,
  };
  if (cells.length < 2 || nCols < 2) return empty;

  const { headerText } = detectHeaderSpan(cells);
  const { headerRows, bodyRowIdx } = partitionRows(cells);
  const bodyCells = bodyRowIdx.map((i) => cells[i]);
  if (!bodyCells.length) return { ...empty, headerRows };

  const colIsCi = (c) => looksCiColumn(bodyCells, c);
  const colIsNum = (c) => looksNumericColumn(bodyCells, c);
  const colIsSlash = (c) => slashFraction(bodyCells, c) >= 0.6;

  /* ── Per-column base tag (header keyword first, then body pattern) ──────── */
  const tags = new Array(nCols).fill('ignore');
  for (let c = 0; c < nCols; c++) {
    const h = headerText[c] || '';
    if (colIsCi(c)) tags[c] = 'ci';
    else if (CI_RE.test(h)) tags[c] = 'ci';
    else if (EFFECT_RE.test(h)) tags[c] = 'effect';
    else if (P_RE.test(h)) tags[c] = 'pValue';
    else if (TOTAL_RE.test(h)) tags[c] = 'total';
    else if (EVENTS_RE.test(h)) tags[c] = 'events';
    else if (MEDIAN_RE.test(h)) tags[c] = 'median';
    else if (Q3_RE.test(h)) tags[c] = 'q3';
    else if (Q1_RE.test(h)) tags[c] = 'q1';
    else if (MEAN_RE.test(h)) tags[c] = 'mean';
    else if (SD_RE.test(h)) tags[c] = 'sd';
    else if (N_RE.test(h)) tags[c] = 'n';
    else if (colIsSlash(c)) tags[c] = 'events';
    else if (!colIsNum(c)) tags[c] = 'row-label';
    else tags[c] = 'ignore';
  }

  // A CI header sitting over two plain-numeric columns is a lower/upper pair.
  for (let c = 0; c < nCols - 1; c++) {
    if (
      tags[c] === 'ci' &&
      !colIsCi(c) &&
      colIsNum(c) &&
      colIsNum(c + 1) &&
      !colIsCi(c + 1) &&
      (tags[c + 1] === 'ci' || tags[c + 1] === 'ignore')
    ) {
      tags[c] = 'ciLow';
      tags[c + 1] = 'ciHigh';
    }
  }

  /* ── Shape scoring ─────────────────────────────────────────────────────── */
  const cols = Array.from({ length: nCols }, (_, c) => c);
  const anyEffectHdr = headerText.some((h) => EFFECT_RE.test(h));
  const anyCiCol = cols.some((c) => colIsCi(c));
  const anyCiSignal = anyCiCol || headerText.some((h) => CI_RE.test(h)) || tags.includes('ciLow');
  const anyP = headerText.some((h) => P_RE.test(h));
  const eventsSignal = tags.includes('events') || cols.some((c) => colIsSlash(c));
  const hasTotal = tags.includes('total') || cols.some((c) => colIsSlash(c));
  const hasMean = tags.includes('mean');
  const hasSd = tags.includes('sd');
  const hasN = tags.includes('n');
  const numColCount = cols.filter((c) => colIsNum(c)).length;

  let direct = 0;
  if (anyEffectHdr) {
    direct = 0.5;
    if (anyCiSignal) direct += 0.25;
    if (anyCiCol) direct += 0.15;
    if (anyP) direct += 0.1;
  }
  direct = clamp01(direct);

  let dich = 0;
  if (eventsSignal) {
    dich = 0.5;
    if (hasTotal) dich += 0.3;
    if (numColCount >= 2) dich += 0.2;
  }
  dich = clamp01(dich);

  let cont = 0;
  if (hasMean && hasSd) {
    cont = 0.6;
    if (hasN) cont += 0.2;
    if (numColCount >= 2) cont += 0.2;
  } else if (hasMean || hasSd) {
    cont = 0.3;
  }
  cont = clamp01(cont);

  const scored = [
    ['direct-effect', direct],
    ['dichotomous', dich],
    ['continuous', cont],
  ].sort((a, b) => b[1] - a[1]);
  const [topName, topScore] = scored[0];
  const secondScore = scored[1][1];

  const shape = topScore >= 0.35 ? topName : 'unknown';
  const confidence = clamp01(topScore - 0.5 * secondScore);
  const rowKind = shape === 'direct-effect' ? 'per-variable' : 'per-arm';

  return { shape, columnTags: tags, rowKind, headerRows, confidence };
}

/** Fraction of a column's non-empty body cells that read as an events/total slash. */
function slashFraction(cells, colIdx) {
  let nonEmpty = 0;
  let hit = 0;
  for (const row of cells) {
    if (!Array.isArray(row) || colIdx >= row.length) continue;
    const s = (row[colIdx] == null ? '' : String(row[colIdx])).trim();
    if (!s) continue;
    nonEmpty++;
    if (SLASH_RE.test(s)) hit++;
  }
  return nonEmpty ? hit / nonEmpty : 0;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
