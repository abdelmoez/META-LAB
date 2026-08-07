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

/** Round to 2dp — keeps the emitted path data short and byte-stable. */
const r = (v) => Math.round(v * 100) / 100;

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
  const boxes = [];              // geometry, returned for the interactive overlay
  const geom = new Map();        // boxId → { x, y, w, h } — the layout's memory
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
    const box = { id: boxId, x, y: yy, w, h };
    boxes.push(box);
    geom.set(boxId, box);
    return { svg: s, h };
  };

  /* ── 105.md: connectors are DERIVED FROM BOX GEOMETRY, never from row maths ──
   *
   * The old code drew each arrow from a row's BOTTOM — `Math.max(mainBox.h,
   * sideBox.h)` — which is the bottom of whichever box in that row happens to be
   * taller. In every real project the right-hand box is the taller one (six
   * full-text exclusion reasons is seven lines against the assessed box's one), so
   * the arrow out of "Reports assessed for eligibility" began far below that box,
   * in empty space beside the exclusions list, and read as an arrow pointing from
   * nowhere. Two more arrows had the same defect, and one was worse still: a
   * hard-coded `y - 24` that assumed a row height rather than measuring one.
   *
   * A connector is now a RELATIONSHIP between two boxes. It reads both boxes'
   * recorded geometry and works out where to start and stop, so it stays correct
   * however tall either box grows. That is what makes the layout respond to the
   * data instead of to assumptions about it:
   *   - more exclusion reasons  → the eligibility row gets taller → the arrow to
   *     the included box lengthens automatically to clear it;
   *   - fewer reasons           → the diagram compacts, with no leftover gap;
   *   - a branch disappears     → its connector is simply never requested.
   *
   * Connectors are collected and emitted AFTER every box, so a connector can
   * reference a destination that does not exist yet when the source is drawn —
   * which is what lets the arrow know how far down it must actually reach.
   */
  const links = [];
  const line = (x1, y1, x2, y2) => `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}"`
    + ` stroke="${GREY}" stroke-width="1.3" marker-end="url(#ah)"/>`;

  /**
   * Down the flow: from the SOURCE box's own bottom edge to the DESTINATION box's
   * top edge, always leaving from the source's own centre.
   *
   * Most steps sit directly under their predecessor, so the connector is a plain
   * vertical line. The shared terminal box is the exception: it is centred across
   * BOTH columns, so the database arm's column-centre is to its left. Sliding the
   * line sideways to hit it would drag it straight through the full-text exclusions
   * box — trading an arrow that points at nothing for one that crosses a box of
   * text. So when the destination is not below the source, the connector takes an
   * ELBOW: straight down out of the source, across the gap BELOW every box in the
   * row it is leaving, then down into the destination's top edge. That is how the
   * published PRISMA diagram routes it, and it keeps the rule that an arrow may
   * never overlap a box or a label.
   */
  const connectDown = (fromId, toId) => {
    links.push(() => {
      const a = geom.get(fromId); const c = geom.get(toId);
      if (!a || !c) return '';
      const x = a.x + a.w / 2;
      const y1 = a.y + a.h; const y2 = c.y;
      // A destination that is not actually below the source would produce an
      // upward or zero-length arrow. Drawing nothing is the honest outcome.
      if (y2 <= y1 + 2) return '';
      // Directly above the destination (with margin for the arrowhead) → straight.
      if (x >= c.x + 10 && x <= c.x + c.w - 10) return line(x, y1, x, y2);
      // Otherwise elbow. The cross leg sits midway between the destination's top
      // and the bottom of the tallest box already placed above it, so it runs
      // through the gap rather than over anything.
      let above = y1;
      for (const g of geom.values()) {
        if (g === c) continue;
        const gb = g.y + g.h;
        if (gb <= y2 && gb > above) above = gb;
      }
      const my = (above + y2) / 2;
      const tx = c.x + c.w / 2;
      return `<polyline points="${r(x)},${r(y1)} ${r(x)},${r(my)} ${r(tx)},${r(my)} ${r(tx)},${r(y2)}"`
        + ` fill="none" stroke="${GREY}" stroke-width="1.3" marker-end="url(#ah)"/>`;
    });
  };

  /**
   * Out of the flow: from the SOURCE box's right edge to the SIDE box's left edge,
   * at a height that lies inside BOTH boxes — so it leaves a real edge and arrives
   * at a real edge rather than floating past a short box's corner.
   */
  const connectRight = (fromId, toId) => {
    links.push(() => {
      const a = geom.get(fromId); const c = geom.get(toId);
      if (!a || !c) return '';
      const lo = Math.max(a.y, c.y) + 12;
      const hi = Math.min(a.y + a.h, c.y + c.h) - 12;
      const yy = hi >= lo ? (lo + hi) / 2 : Math.max(a.y, c.y) + 15;
      if (c.x <= a.x + a.w + 2) return '';
      return line(a.x + a.w, yy, c.x, yy);
    });
  };

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
  connectRight('identified_db', 'removed_before_screening');

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
  connectRight('screened', 'excluded_screening');
  connectDown('identified_db', 'screened');
  y += Math.max(screened.h, excl.h) + 24;

  /* ── retrieval row (BOTH arms) ─────────────────────────────────────────── */
  const soughtDb = drawBox('sought_db', dbX, y, COL_W, [`Reports sought for retrieval (n = ${n('sought_db')})`], { bold: true });
  const nrDb = drawBox('not_retrieved_db', dbX + COL_W + GAP_X, y, SIDE_W, [`Reports not retrieved (n = ${n('not_retrieved_db')})`]);
  svg += soughtDb.svg + nrDb.svg;
  connectRight('sought_db', 'not_retrieved_db');
  connectDown('screened', 'sought_db');

  let rowH = Math.max(soughtDb.h, nrDb.h);
  if (hasOther) {
    const soughtOther = drawBox('sought_other', otherX, y, COL_W, [`Reports sought for retrieval (n = ${n('sought_other')})`], { bold: true });
    const nrOther = drawBox('not_retrieved_other', otherX + COL_W + GAP_X, y, SIDE_W, [`Reports not retrieved (n = ${n('not_retrieved_other')})`]);
    svg += soughtOther.svg + nrOther.svg;
    connectRight('sought_other', 'not_retrieved_other');
    connectDown('identified_other', 'sought_other');
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
  connectRight('assessed_db', 'excluded_full_text_db');
  connectDown('sought_db', 'assessed_db');

  let rowH2 = Math.max(assessedDb.h, exDb.h);
  if (hasOther) {
    const assessedOther = drawBox('assessed_other', otherX, y, COL_W, [`Reports assessed for eligibility (n = ${n('assessed_other')})`], { bold: true });
    const exOther = drawBox('excluded_full_text_other', otherX + COL_W + GAP_X, y, SIDE_W, exLines('Reports excluded', n('excluded_full_text_other'), 'other'));
    svg += assessedOther.svg + exOther.svg;
    connectRight('assessed_other', 'excluded_full_text_other');
    connectDown('sought_other', 'assessed_other');
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
  // 105.md — the arrow the user reported. It starts at the ELIGIBILITY box's own
  // bottom and runs the full distance down to the included box, clearing the tall
  // exclusion-reasons box beside it, because both endpoints are measured rather
  // than assumed.
  connectDown('assessed_db', 'included_studies');
  if (hasOther) connectDown('assessed_other', 'included_studies');
  y += inc.h;

  /* ── connectors ────────────────────────────────────────────────────────
     Emitted now that every box has been placed, so each one could measure
     both of its endpoints. They run in the gaps between boxes, so drawing
     them last cannot obscure any text. */
  for (const link of links) svg += link();

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
