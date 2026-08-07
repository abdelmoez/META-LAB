/**
 * prisma/svg.js — 103.md §16/§21. The PRISMA 2020 flow diagram, drawn from the
 * canonical flow.
 *
 * ── WHY A NEW BUILDER ───────────────────────────────────────────────────────
 * The previous diagram (charts/svgBuilders.js buildPrismaSVG) was a SINGLE column
 * and jumped straight from "Records screened" to "Reports assessed for eligibility".
 * It therefore had:
 *   - no "Identification of studies via other methods" column, so citation-mined
 *     and hand-added records had nowhere correct to appear (§5, §6);
 *   - no "Reports sought for retrieval" / "Reports not retrieved" boxes at all (§8);
 *   - only "Duplicates" under records-removed, missing the two other official
 *     sub-lines.
 * That is not a styling gap — it is a methodologically wrong diagram, which is
 * exactly what §17 says not to ship.
 *
 * ── ONE CALCULATION (§16) ───────────────────────────────────────────────────
 * This builder takes the SAME `derivePrismaFlow` output the manuscript and the
 * statistics read. There is no export-time arithmetic anywhere in this file: every
 * number is read out of `flow.boxes`. So the exported diagram cannot disagree with
 * the live one, and neither can disagree with the Methods paragraph.
 *
 * Emits `data-box` on every box so the interactive layer can make a count
 * clickable (§12) without a second source of truth for hit-testing.
 *
 * Pure — no DOM/React/network/Date. Returns an SVG string plus its geometry.
 */

import { COLUMN_HEADERS, FOOTNOTES, SOURCE_CITATION } from './model.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const INK = '#111';
const GREY = '#555';
const LINE = '#333';
const FF = "Georgia,'Times New Roman',serif";

/** Wrap a line to a pixel width, roughly — SVG has no text flow. */
function wrap(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/**
 * buildPrismaFlowSVG(flow, opts) → { svg, W, H }
 *
 * @param {object} flow   derivePrismaFlow() output
 * @param {object} [opts]
 *   title      optional heading
 *   noBg       skip the white backdrop (transparent PNG export)
 *   updated    render the UPDATED-review template (previous-studies column)
 *   perSource  include the per-database breakdown inside the identification box
 *   footnotes  include the official footnotes (default true)
 * Pure.
 */
export function buildPrismaFlowSVG(flow, opts = {}) {
  const f = flow || {};
  const b = f.boxes || {};
  const n = (id) => {
    const v = b[id];
    return v && Number.isFinite(Number(v.n)) ? Number(v.n) : 0;
  };
  const o = opts || {};
  const hasOther = n('identified_other') > 0 || n('sought_other') > 0;
  const showFootnotes = o.footnotes !== false;

  /* ── geometry ──────────────────────────────────────────────────────────── */
  const RAIL = 26;               // left stage-band rail
  const COL_W = 250;             // a main (left-hand) box
  const SIDE_W = 250;            // a right-hand removed/excluded box
  const GAP_X = 34;              // main → side
  const COL_GAP = 46;            // database column → other-methods column
  const PAD = 16;
  const colW = COL_W + GAP_X + SIDE_W;
  const W = RAIL + PAD + colW + (hasOther ? COL_GAP + colW : 0) + PAD;

  const dbX = RAIL + PAD;
  const otherX = dbX + colW + COL_GAP;

  let svg = o.noBg ? '' : `<rect x="0" y="0" width="${W}" height="100%" fill="#ffffff"/>`;
  let y = 14;
  if (o.title) {
    svg += `<text x="${W / 2}" y="${y + 14}" text-anchor="middle" font-family="${FF}" font-size="14" font-weight="700" fill="${INK}">${esc(o.title)}</text>`;
    y += 30;
  }

  /* ── column headers ────────────────────────────────────────────────────── */
  const headerH = 26;
  const header = (x, text) => `<rect x="${x}" y="${y}" width="${colW}" height="${headerH}" fill="#eef1f5" stroke="${LINE}" stroke-width="1"/>`
    + `<text x="${x + colW / 2}" y="${y + 17}" text-anchor="middle" font-family="${FF}" font-size="11.5" font-weight="700" fill="${INK}">${esc(text)}</text>`;

  svg += header(dbX, o.updated ? COLUMN_HEADERS.dbUpdated : COLUMN_HEADERS.db);
  if (hasOther) svg += header(otherX, o.updated ? COLUMN_HEADERS.otherUpdated : COLUMN_HEADERS.other);
  y += headerH + 18;

  /* ── box primitive ─────────────────────────────────────────────────────── */
  const boxes = []; // geometry, returned for the interactive overlay
  const drawBox = (boxId, x, yy, w, lines, style = {}) => {
    const h = Math.max(30, 12 + lines.length * 15);
    const fill = style.fill || '#ffffff';
    const stroke = style.stroke || LINE;
    let s = `<g data-box="${esc(boxId)}">`
      + `<rect x="${x}" y="${yy}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.2" rx="3"/>`;
    lines.forEach((ln, i) => {
      s += `<text x="${x + 10}" y="${yy + 19 + i * 15}" font-family="${FF}" font-size="10.5"`
        + ` font-weight="${style.bold && i === 0 ? '700' : '400'}" fill="${INK}">${esc(ln)}</text>`;
    });
    s += '</g>';
    boxes.push({ id: boxId, x, y: yy, w, h });
    return { svg: s, h };
  };

  const vArrow = (x, y1, y2) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${GREY}" stroke-width="1.3" marker-end="url(#ah)"/>`;
  const hArrow = (x1, x2, yy) => `<line x1="${x1}" y1="${yy}" x2="${x2}" y2="${yy}" stroke="${GREY}" stroke-width="1.3" marker-end="url(#ah)"/>`;

  /* ── identification row ────────────────────────────────────────────────── */
  const dbSources = (o.perSource && f.sources && f.sources.db) ? f.sources.db.slice(0, 6) : [];
  const idDbLines = [`Records identified from*: (n = ${n('identified_db')})`]
    .concat(dbSources.length
      ? dbSources.map((s) => `   ${s.label} (n = ${s.n})`)
      : ['   Databases / registers']);

  const removedLines = [
    'Records removed before screening:',
    `   Duplicate records removed (n = ${(f.removedBreakdown && f.removedBreakdown.duplicate ? f.removedBreakdown.duplicate.n : 0)})`,
    `   Records marked as ineligible by automation tools (n = ${(f.removedBreakdown && f.removedBreakdown.automation ? f.removedBreakdown.automation.n : 0)})`,
    `   Records removed for other reasons (n = ${(f.removedBreakdown && f.removedBreakdown.other ? f.removedBreakdown.other.n : 0)})`,
  ];

  const idDb = drawBox('identified_db', dbX, y, COL_W, idDbLines, { bold: true });
  const removed = drawBox('removed_before_screening', dbX + COL_W + GAP_X, y, SIDE_W, removedLines);
  svg += idDb.svg + removed.svg;
  svg += hArrow(dbX + COL_W, dbX + COL_W + GAP_X, y + 15);

  let otherBottom = y;
  if (hasOther) {
    const otherSources = (o.perSource && f.sources && f.sources.other) ? f.sources.other.slice(0, 6) : [];
    const idOtherLines = [`Records identified from: (n = ${n('identified_other')})`]
      .concat(otherSources.length
        ? otherSources.map((s) => `   ${s.label} (n = ${s.n})`)
        : ['   Websites, organisations, citation searching']);
    const idOther = drawBox('identified_other', otherX, y, COL_W, idOtherLines, { bold: true });
    svg += idOther.svg;
    otherBottom = y + idOther.h;
  }

  const idBottom = y + Math.max(idDb.h, removed.h);
  y = Math.max(idBottom, otherBottom) + 24;

  /* ── screening row (DATABASE ARM ONLY — PRISMA 2020 gives the other-methods
        column no screening box, and drawing one is the commonest error) ────── */
  const screened = drawBox('screened', dbX, y, COL_W, [`Records screened (n = ${n('screened')})`], { bold: true });
  const excl = drawBox('excluded_screening', dbX + COL_W + GAP_X, y, SIDE_W, [`Records excluded** (n = ${n('excluded_screening')})`]);
  svg += screened.svg + excl.svg;
  svg += hArrow(dbX + COL_W, dbX + COL_W + GAP_X, y + 15);
  svg += vArrow(dbX + COL_W / 2, idBottom, y);
  y += Math.max(screened.h, excl.h) + 24;

  /* ── retrieval row (BOTH arms) ─────────────────────────────────────────── */
  const soughtDb = drawBox('sought_db', dbX, y, COL_W, [`Reports sought for retrieval (n = ${n('sought_db')})`], { bold: true });
  const nrDb = drawBox('not_retrieved_db', dbX + COL_W + GAP_X, y, SIDE_W, [`Reports not retrieved (n = ${n('not_retrieved_db')})`]);
  svg += soughtDb.svg + nrDb.svg;
  svg += hArrow(dbX + COL_W, dbX + COL_W + GAP_X, y + 15);
  svg += vArrow(dbX + COL_W / 2, y - 24, y);

  let rowH = Math.max(soughtDb.h, nrDb.h);
  if (hasOther) {
    const soughtOther = drawBox('sought_other', otherX, y, COL_W, [`Reports sought for retrieval (n = ${n('sought_other')})`], { bold: true });
    const nrOther = drawBox('not_retrieved_other', otherX + COL_W + GAP_X, y, SIDE_W, [`Reports not retrieved (n = ${n('not_retrieved_other')})`]);
    svg += soughtOther.svg + nrOther.svg;
    svg += hArrow(otherX + COL_W, otherX + COL_W + GAP_X, y + 15);
    svg += vArrow(otherX + COL_W / 2, otherBottom, y);
    rowH = Math.max(rowH, soughtOther.h, nrOther.h);
  }
  const soughtBottom = y + rowH;
  y = soughtBottom + 24;

  /* ── eligibility row (BOTH arms), with reasons ─────────────────────────── */
  // Reasons are per-arm: the two columns are independent flows.
  const reasonsFor = (arm) => ((f.exclusionReasonsByArm && f.exclusionReasonsByArm[arm])
    || (arm === 'db' ? f.exclusionReasons : []) || []).slice(0, 6);
  const exLines = (label, count, arm) => {
    const rs = reasonsFor(arm);
    return [`${label} (n = ${count}):`].concat(
      rs.length ? rs.map((r) => `   ${r.label} (n = ${r.n})`) : ['   Reasons not recorded'],
    );
  };

  const assessedDb = drawBox('assessed_db', dbX, y, COL_W, [`Reports assessed for eligibility (n = ${n('assessed_db')})`], { bold: true });
  const exDb = drawBox('excluded_full_text_db', dbX + COL_W + GAP_X, y, SIDE_W, exLines('Reports excluded', n('excluded_full_text_db'), 'db'));
  svg += assessedDb.svg + exDb.svg;
  svg += hArrow(dbX + COL_W, dbX + COL_W + GAP_X, y + 15);
  svg += vArrow(dbX + COL_W / 2, soughtBottom, y);

  let rowH2 = Math.max(assessedDb.h, exDb.h);
  if (hasOther) {
    const assessedOther = drawBox('assessed_other', otherX, y, COL_W, [`Reports assessed for eligibility (n = ${n('assessed_other')})`], { bold: true });
    const exOther = drawBox('excluded_full_text_other', otherX + COL_W + GAP_X, y, SIDE_W, exLines('Reports excluded', n('excluded_full_text_other'), 'other'));
    svg += assessedOther.svg + exOther.svg;
    svg += hArrow(otherX + COL_W, otherX + COL_W + GAP_X, y + 15);
    svg += vArrow(otherX + COL_W / 2, soughtBottom, y);
    rowH2 = Math.max(rowH2, assessedOther.h, exOther.h);
  }
  const assessedBottom = y + rowH2;
  y = assessedBottom + 26;

  /* ── included (SHARED terminal box, never duplicated per column) ────────── */
  const incLines = o.updated
    ? [
      `New studies included in review (n = ${n('included_studies')})`,
      `Reports of new included studies (n = ${n('included_reports')})`,
    ]
    : [
      `Studies included in review (n = ${n('included_studies')})`,
      `Reports of included studies (n = ${n('included_reports')})`,
    ];
  const incW = hasOther ? COL_W + GAP_X + SIDE_W : COL_W;
  const incX = hasOther ? dbX + (W - RAIL - PAD * 2 - incW) / 2 : dbX;
  const inc = drawBox('included_studies', incX, y, incW, incLines, {
    bold: true, fill: '#f3f7f3', stroke: '#2e7d32',
  });
  svg += inc.svg;
  svg += vArrow(dbX + COL_W / 2, assessedBottom, y);
  if (hasOther) svg += vArrow(otherX + COL_W / 2, assessedBottom, y);
  y += inc.h;

  /* ── left rail: the three official stage bands ─────────────────────────── */
  const bandTop = (o.title ? 44 : 14) + headerH + 18;
  const band = (label, y1, y2) => {
    const cy = (y1 + y2) / 2;
    return `<rect x="${RAIL - 22}" y="${y1}" width="20" height="${Math.max(0, y2 - y1)}" fill="#eef1f5" stroke="${LINE}" stroke-width="0.8"/>`
      + `<text x="${RAIL - 12}" y="${cy}" text-anchor="middle" font-family="${FF}" font-size="10" font-weight="700"`
      + ` fill="${INK}" transform="rotate(-90 ${RAIL - 12} ${cy})">${esc(label)}</text>`;
  };
  svg += band('Identification', bandTop, idBottom + 8);
  svg += band('Screening', idBottom + 12, assessedBottom + 8);
  svg += band('Included', assessedBottom + 12, y);

  /* ── footnotes ─────────────────────────────────────────────────────────── */
  if (showFootnotes) {
    y += 16;
    for (const fn of FOOTNOTES) {
      for (const ln of wrap(fn, Math.floor(W / 5.4))) {
        svg += `<text x="${dbX}" y="${y}" font-family="${FF}" font-size="8.5" fill="${GREY}">${esc(ln)}</text>`;
        y += 11;
      }
    }
    svg += `<text x="${dbX}" y="${y}" font-family="${FF}" font-size="8.5" fill="${GREY}">${esc(`Source: ${SOURCE_CITATION}`)}</text>`;
    y += 12;
  }

  const H = y + 12;
  const defs = `<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${GREY}"/></marker></defs>`;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${svg}</svg>`,
    W,
    H,
    boxes,
    hasOther,
  };
}

export default { buildPrismaFlowSVG };
