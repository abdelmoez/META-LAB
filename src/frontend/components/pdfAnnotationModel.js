/**
 * pdfAnnotationModel.js — 116.md §71-104 (Part VII). The PURE core of the
 * collaborative PDF annotation layer: palette, selection geometry, anchoring math,
 * page indexing, the client permission mirror and the optimistic-list reducer.
 *
 * WHY A PURE MODULE. The repo forbids jsdom in unit tests (tests-infra §B3: "no
 * jsdom, initial render only"), so anything that decides something has to live
 * outside the component — the same discipline that produced pdfRevealBox.js,
 * pdfCaret.js and pdfSearch.js. Every function here takes plain data.
 *
 * ── THE ANCHOR (§76) ─────────────────────────────────────────────────────────
 * A highlight is stored as a list of rectangles in PDF USER SPACE at scale 1,
 * y-UP from the page bottom, in the UNROTATED page frame — byte-for-byte the
 * contract `AppPdfViewer.cssToUser`, `pdfRevealBox.revealBoxFor` and extraction
 * provenance bboxes already share. That space is a property of the DOCUMENT, so
 * none of the things §76 lists can move a highlight:
 *   - zoom / scale ladder  → only the projection multiplier `s` changes;
 *   - container width, sidebar open/close, window resize → only `s` changes
 *     (fit-width is recomputed, the stored rect is untouched);
 *   - device pixel ratio / rendering resolution → canvas backing store only;
 *   - rotation → the projection is always computed in the unrotated frame and the
 *     viewer resets rotation for annotation work, exactly as it already does for
 *     region capture and jump-to-source;
 *   - page width in CSS px → derived, never stored.
 * The selected TEXT is stored alongside as a human-readable witness (§78) — it is
 * never used to re-derive a position, because a text-match anchor that is not
 * unique would fabricate a location (the honesty rule AppPdfViewer already
 * enforces for coordinate-less provenance).
 *
 * ── 117.md §46-§48 (Safari/WebKit parity) ────────────────────────────────────
 * The stored-anchor contract above is UNCHANGED. What 117 adds lives entirely at
 * CAPTURE time, because that is where the WebKit defect is: the browser's own
 * `Range.getClientRects()` is now audited against the text layer it must live in and,
 * when it cannot be trusted, rebuilt from per-word/per-character Range geometry
 * (`auditSelectionRects` / `rectsFromRangeGeometry` / `captureSelectionRects`) — the
 * same cross-validate-then-fall-back-to-geometry discipline 98.md §16 established in
 * pdfCaret.js for the identical mis-mapping. `endOfContentPlacement` and the
 * `clampRenderDpr` / `dprMediaQuery` pair carry the two other pure decisions the
 * viewer needs for that parity, so both are unit-testable without a browser.
 */
import { revealBoxFor } from './pdfRevealBox.js';

/* ── §77 palette ──────────────────────────────────────────────────────────── */

/**
 * The fixed six-colour palette. Deliberately hard-coded rgba rather than theme
 * tokens: these paint OVER a white PDF canvas, and AppPdfViewer already states the
 * rule for its search highlights ("intentionally fixed … never leak a CSS var into
 * a canvas-rasterized context"). `fill` is the author's own highlight; `fillMuted`
 * is §81 — same hue, lower intensity, never washed out to grey.
 */
export const ANNOTATION_COLORS = Object.freeze([
  { key: 'yellow', label: 'Yellow', fill: 'rgba(255,213,0,0.42)',  fillMuted: 'rgba(255,213,0,0.24)',  swatch: '#f2c200', border: 'rgba(190,150,0,0.85)' },
  { key: 'green',  label: 'Green',  fill: 'rgba(52,199,89,0.38)',  fillMuted: 'rgba(52,199,89,0.21)',  swatch: '#2f9e4f', border: 'rgba(30,120,60,0.85)' },
  { key: 'blue',   label: 'Blue',   fill: 'rgba(0,145,255,0.34)',  fillMuted: 'rgba(0,145,255,0.19)',  swatch: '#1273d4', border: 'rgba(10,90,180,0.85)' },
  { key: 'pink',   label: 'Pink',   fill: 'rgba(255,90,160,0.36)', fillMuted: 'rgba(255,90,160,0.20)', swatch: '#d94b8c', border: 'rgba(180,40,105,0.85)' },
  { key: 'orange', label: 'Orange', fill: 'rgba(255,138,0,0.38)',  fillMuted: 'rgba(255,138,0,0.21)',  swatch: '#e07b00', border: 'rgba(175,90,0,0.85)' },
  { key: 'purple', label: 'Purple', fill: 'rgba(150,90,255,0.34)', fillMuted: 'rgba(150,90,255,0.19)', swatch: '#7c4dd6', border: 'rgba(95,45,175,0.85)' },
]);

/** Key list — pinned against the server's ANNOTATION_COLOR_KEYS by a unit test. */
export const ANNOTATION_COLOR_KEYS = Object.freeze(ANNOTATION_COLORS.map((c) => c.key));
export const DEFAULT_ANNOTATION_COLOR = 'yellow';

/** Bounds — pinned against the server's caps by the same unit test. */
export const MAX_SELECTED_TEXT = 2000;
export const MAX_COMMENT = 4000;

/** Palette entry for a colour key; anything unknown falls back to yellow. */
export function colorFor(key) {
  const k = typeof key === 'string' ? key.trim().toLowerCase() : '';
  return ANNOTATION_COLORS.find((c) => c.key === k) || ANNOTATION_COLORS[0];
}

/* ── Selection geometry (§75/§76) ─────────────────────────────────────────── */

const finite = (v) => Number.isFinite(+v);
/**
 * The two size tolerances used while turning a browser selection into rectangles.
 * They are expressed in PDF USER UNITS (points), not CSS px, and projected to the
 * current zoom by `selectionThresholds` below — see the note there.
 */
const MIN_RECT_UNITS = 1.5;       // below this a rect is selection noise, not a line
const LINE_OVERLAP = 0.55;        // vertical overlap ratio that means "same line"
const LINE_GAP_UNITS = 4;         // horizontal gap still merged inside one line

/**
 * selectionThresholds(scale) → { minSize, lineGap } in CSS px at that scale.
 *
 * 116.md §76 — a highlight must mean the same thing at every zoom level. Fixing
 * these tolerances in CSS px broke that in both directions: at fit-width inside a
 * narrow panel a 12 pt text line is barely 1 px tall, so a REAL selection was
 * discarded as noise and no Highlight control appeared (with no explanation); zoomed
 * in, genuine sub-pixel noise sailed through and two columns 4 px apart on screen
 * were merged into one rectangle. Scaling them keeps the decision a property of the
 * DOCUMENT. At scale 1 the numbers are exactly the pre-116 constants, so nothing
 * changes for a page rendered at 100 %.
 */
export function selectionThresholds(scale) {
  const s = +scale > 0 ? +scale : 1;
  return { minSize: MIN_RECT_UNITS * s, lineGap: LINE_GAP_UNITS * s };
}

/**
 * §75/§100 — how long to wait before turning a settled selection into the pending
 * highlight control, per the event that reported it. Returning null means "ignore
 * this one".
 *   'mouseup'         → immediately (the drag has ended; this is the §75 gesture);
 *   'selectionchange' → only when NO drag is in progress, after a short settle. A
 *                       keyboard user selecting with Shift+Arrow never produces a
 *                       mouseup at all, so this is the only event that can offer
 *                       them the control (§100); suppressing it mid-drag is what
 *                       stops the control flickering along under the cursor.
 */
export const SELECTION_SETTLE_MS = 150;
export function selectionCaptureDelay(source, { dragging = false } = {}) {
  if (source === 'mouseup') return 0;
  if (source === 'selectionchange') return dragging ? null : SELECTION_SETTLE_MS;
  return null;
}

/**
 * toPageRects(clientRects, host, { minSize }) — viewport DOMRect-likes → page-local
 * CSS rects. `host` is the page wrapper's bounding rect ({left, top}). Anything
 * degenerate is dropped rather than clamped: an empty result means "there was no
 * real selection here", which the caller must treat as "do not offer to highlight".
 * `minSize` is a CSS-px floor — callers pass `selectionThresholds(scale).minSize`.
 */
export function toPageRects(clientRects, host, { minSize = MIN_RECT_UNITS } = {}) {
  const hl = host && finite(host.left) ? +host.left : 0;
  const ht = host && finite(host.top) ? +host.top : 0;
  const out = [];
  for (const r of (Array.isArray(clientRects) ? clientRects : [])) {
    if (!r) continue;
    const x0 = +r.left - hl, y0 = +r.top - ht, x1 = +r.right - hl, y1 = +r.bottom - ht;
    if (![x0, y0, x1, y1].every(finite)) continue;
    if (x1 - x0 < minSize || y1 - y0 < minSize) continue;
    out.push({ x0, y0, x1, y1 });
  }
  return out;
}

/** Vertical overlap ratio of two CSS rects (0..1), relative to the shorter one. */
function vOverlap(a, b) {
  const top = Math.max(a.y0, b.y0);
  const bot = Math.min(a.y1, b.y1);
  if (bot <= top) return 0;
  return (bot - top) / Math.max(1e-6, Math.min(a.y1 - a.y0, b.y1 - b.y0));
}

/**
 * mergeLineRects(rects) — collapse a browser's per-glyph-run client rects into ONE
 * rect per rendered line.
 *
 * Range.getClientRects() returns a rect per text node fragment, so a two-line
 * selection over five spans yields five (often overlapping, sometimes duplicated)
 * rects. Rendering them raw stacks alpha and produces the mottled look every
 * home-grown highlighter has. Grouping by vertical overlap and unioning within a
 * group is both prettier and cheaper to store (§76 "normalized rectangles").
 */
export function mergeLineRects(rects, { lineGap = LINE_GAP_UNITS } = {}) {
  const list = (Array.isArray(rects) ? rects : []).filter(Boolean)
    .slice()
    .sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));

  // Pass 1 — bucket by VERTICAL overlap alone: one bucket per rendered line. Doing the
  // horizontal decision here (the obvious one-pass version) is wrong, because a run
  // whose reported top differs by a fraction of a pixel sorts between two runs of the
  // same line: the middle run then bridges a gap that was already closed as a separate
  // rect, and the line comes out in two pieces that never re-coalesce.
  const buckets = [];
  for (const r of list) {
    const b = buckets.find((x) => vOverlap(x.span, r) >= LINE_OVERLAP);
    if (b) {
      b.span.y0 = Math.min(b.span.y0, r.y0);
      b.span.y1 = Math.max(b.span.y1, r.y1);
      b.items.push(r);
    } else {
      buckets.push({ span: { y0: r.y0, y1: r.y1 }, items: [r] });
    }
  }

  // Pass 2 — inside a line, sweep left→right and union CONTIGUOUS runs. A genuine gap
  // (a two-column layout, a figure between two text blocks) keeps its own rectangle, so
  // a selection spanning columns is never painted across the white space between them.
  const out = [];
  for (const b of buckets) {
    const items = b.items.slice().sort((x, y) => x.x0 - y.x0 || x.x1 - y.x1);
    let cur = null;
    for (const r of items) {
      if (cur && r.x0 <= cur.x1 + lineGap) {
        cur.x1 = Math.max(cur.x1, r.x1);
        cur.y0 = Math.min(cur.y0, r.y0);
        cur.y1 = Math.max(cur.y1, r.y1);
      } else {
        cur = { ...r };
        out.push(cur);
      }
    }
  }
  return out.sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
}

/**
 * cssRectsToUser(rects, { scale, pageHeight }) — page-local CSS px → PDF user
 * space at scale 1, y-up. The exact inverse of AppPdfViewer's `cssToUser`, which is
 * what makes an annotation rect interchangeable with an extraction provenance bbox.
 */
export function cssRectsToUser(rects, { scale, pageHeight } = {}) {
  const s = +scale;
  const H = +pageHeight;
  if (!(s > 0) || !finite(H)) return [];
  const round = (v) => Math.round(v * 10000) / 10000;
  return (Array.isArray(rects) ? rects : []).map((r) => ({
    x0: round(r.x0 / s),
    y0: round(H - r.y1 / s),     // CSS bottom edge → smaller user y
    x1: round(r.x1 / s),
    y1: round(H - r.y0 / s),     // CSS top edge    → larger user y
  })).filter((r) => r.x1 > r.x0 && r.y1 > r.y0);
}

/**
 * userRectsToCss(rects, pageDims, scale) — the render projection. Delegates each
 * rect to `pdfRevealBox.revealBoxFor` so annotation overlays and the jump-to-source
 * box can NEVER drift apart: one implementation of the mapping, two callers.
 */
export function userRectsToCss(rects, pageDims, scale) {
  const out = [];
  for (const r of (Array.isArray(rects) ? rects : [])) {
    const box = revealBoxFor(r, pageDims, scale);
    if (box && box.kind === 'exact') out.push(box);
  }
  return out;
}

/** The union of an annotation's rects (used for popover placement + jump-to). */
export function rectsBounds(rects) {
  const list = (Array.isArray(rects) ? rects : []).filter((r) => r && finite(r.x0));
  if (!list.length) return null;
  return list.reduce((acc, r) => ({
    x0: Math.min(acc.x0, +r.x0), y0: Math.min(acc.y0, +r.y0),
    x1: Math.max(acc.x1, +r.x1), y1: Math.max(acc.y1, +r.y1),
  }), { x0: +list[0].x0, y0: +list[0].y0, x1: +list[0].x1, y1: +list[0].y1 });
}

/* ── 117.md §46-§48 — WebKit selection-rect validation + geometric rebuild ─── */

/**
 * How far outside the text layer a reported selection rectangle may sit before it is
 * treated as a mis-mapped coordinate rather than an antialiasing rounding error.
 * Two CSS px covers the sub-pixel drift a transformed span legitimately produces.
 */
export const SELECTION_RECT_SLACK_PX = 2;

/** The host page-layer box, tolerant about which DOMRect fields the caller supplied. */
function hostBox(host) {
  if (!host) return null;
  const left = +host.left, top = +host.top;
  if (!finite(left) || !finite(top)) return null;
  const w = finite(host.width) ? +host.width : (finite(host.right) ? +host.right - left : NaN);
  const h = finite(host.height) ? +host.height : (finite(host.bottom) ? +host.bottom - top : NaN);
  // Bounds we cannot measure are reported as null: the audit may then only reject a
  // rect it can actually DISPROVE (the pdfCaret.js §16 discipline — never veto blind).
  return { left, top, w: w > 0 ? w : null, h: h > 0 ? h : null };
}

/**
 * auditSelectionRects(clientRects, host, { minSize, slack })
 *   → { rects, suspect, reason, dropped }
 *
 * 117.md §47 — the capture path used to trust `Range.getClientRects()` outright. This
 * repo already documents (98.md §16, pdfCaret.js) that WebKit MIS-MAPS the x coordinate
 * of Ranges inside the per-span `scaleX` transform pdf.js applies to a text layer: the
 * numbers come back plausible-looking but wrong — collapsed to zero width, shifted off
 * the page, or spanning the whole document. A highlight built from those is stored in
 * PDF user space and is then wrong FOREVER, on every browser, which is exactly the
 * class of bug §76 forbids. So every reported rectangle is now judged against the text
 * layer it must live in:
 *   - it must be finite and not inverted;
 *   - it must intersect the layer box (within `slack`);
 *   - it must not be LARGER than the layer box (a selection cannot exceed its page);
 *   - it must clear the zoom-projected noise floor to be KEPT (that part is not
 *     evidence of a bug — but if it eats every rect while text was selected, the
 *     geometry is not usable and the caller should rebuild).
 * `suspect` says "do not trust this list"; it never decides on its own what to store.
 */
export function auditSelectionRects(clientRects, host, { minSize = MIN_RECT_UNITS, slack = SELECTION_RECT_SLACK_PX } = {}) {
  const box = hostBox(host);
  const dropped = { outside: 0, inverted: 0, oversize: 0, tiny: 0 };
  if (!box) return { rects: [], suspect: true, reason: 'no-host', dropped };
  const list = Array.isArray(clientRects) ? clientRects : [];
  const rects = [];
  let seen = 0;
  for (const r of list) {
    if (!r) continue;
    const x0 = +r.left - box.left, y0 = +r.top - box.top;
    const x1 = +r.right - box.left, y1 = +r.bottom - box.top;
    if (![x0, y0, x1, y1].every(finite)) { dropped.inverted++; continue; }
    seen++;
    if (x1 < x0 || y1 < y0) { dropped.inverted++; continue; }
    if (box.w != null && box.h != null) {
      if (x1 < -slack || x0 > box.w + slack || y1 < -slack || y0 > box.h + slack) { dropped.outside++; continue; }
      if ((x1 - x0) > box.w + slack || (y1 - y0) > box.h + slack) { dropped.oversize++; continue; }
    }
    if (x1 - x0 < minSize || y1 - y0 < minSize) { dropped.tiny++; continue; }
    rects.push({ x0, y0, x1, y1 });
  }
  const reason = dropped.outside ? 'out-of-bounds'
    : dropped.oversize ? 'oversize'
      : dropped.inverted ? 'inverted'
        : (seen > 0 && !rects.length) ? 'degenerate' : '';
  return { rects, suspect: !!reason, reason, dropped };
}

/** True for whitespace, without allocating a regexp per character. */
function isSpace(ch) { return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === ' '; }

/** Non-whitespace [from,to) segments of `text` between `from` and `to`. */
function wordSegments(text, from, to) {
  const segs = [];
  let i = from;
  while (i < to) {
    while (i < to && isSpace(text[i])) i++;
    if (i >= to) break;
    let j = i;
    while (j < to && !isSpace(text[j])) j++;
    segs.push([i, j]);
    i = j;
  }
  return segs;
}

/**
 * rangeTextChunks(range) → [{ node, from, to }] in document order.
 *
 * The text-node slices a Range actually covers, resolved WITHOUT `TreeWalker` /
 * `intersectsNode` so the same walk is exercisable against the tiny fake DOM the
 * pdfCaret suite established (house rule: no jsdom). Element-boundary Ranges — which
 * is what `selectNodeContents(span)` produces — are honoured by slicing the child
 * list at the start/end offsets.
 */
export function rangeTextChunks(range) {
  const root = range && range.commonAncestorContainer;
  if (!root) return [];
  const start = range.startContainer, end = range.endContainer;
  const sOff = Math.max(0, Math.trunc(+range.startOffset) || 0);
  const eOff = Math.max(0, Math.trunc(+range.endOffset) || 0);
  const chunks = [];
  let started = false, finished = false;
  const visit = (node) => {
    if (finished || !node) return;
    const isStartEl = node === start && node.nodeType === 1;
    const isEndEl = node === end && node.nodeType === 1;
    if (isStartEl) started = true;
    if (node.nodeType === 3) {
      const text = node.textContent || '';
      let from = 0, to = text.length;
      if (!started) {
        if (node !== start) return;              // still before the range
        started = true;
        from = Math.min(sOff, text.length);
      }
      if (node === end) { to = Math.min(eOff, text.length); finished = true; }
      if (to > from) chunks.push({ node, from, to, text });
      return;
    }
    const kids = node.childNodes || [];
    const lo = isStartEl ? Math.min(sOff, kids.length) : 0;
    const hi = isEndEl ? Math.min(eOff, kids.length) : kids.length;
    for (let i = lo; i < hi; i++) { visit(kids[i]); if (finished) return; }
    if (isEndEl) finished = true;
  };
  visit(root);
  return chunks;
}

/**
 * rectsFromRangeGeometry(range, { maxChars }) → viewport rects, rebuilt from
 * per-WORD (and, where a word will not measure, per-CHARACTER) sub-Ranges.
 *
 * 117.md §47 — the same escape hatch pdfCaret.caretOffsetByGeometry already uses for
 * the identical WebKit defect: a one-character `Range.getBoundingClientRect()` is
 * measured by the layout engine and is correct on transformed text, where the
 * whole-Range client-rect list is not. Bounded by `maxChars` so a 2 000-character
 * selection can never turn into an unbounded layout storm; the cap is only ever hit
 * on the already-degraded path.
 */
export function rectsFromRangeGeometry(range, { maxChars = 4000 } = {}) {
  const chunks = rangeTextChunks(range);
  if (!chunks.length) return [];
  const owner = chunks[0].node.ownerDocument;
  if (!owner || typeof owner.createRange !== 'function') return [];
  let rng;
  try { rng = owner.createRange(); } catch { return []; }
  const out = [];
  let budget = maxChars;
  const measure = (node, a, b) => {
    let r;
    try { rng.setStart(node, a); rng.setEnd(node, b); r = rng.getBoundingClientRect(); }
    catch { return null; }
    if (!r) return null;
    const left = +r.left, top = +r.top, right = +r.right, bottom = +r.bottom;
    if (![left, top, right, bottom].every(finite)) return null;
    if (right - left <= 0 && bottom - top <= 0) return null;
    return { left, top, right, bottom };
  };
  for (const chunk of chunks) {
    const segs = wordSegments(chunk.text, chunk.from, chunk.to);
    for (let k = 0; k < segs.length; k++) {
      if (budget <= 0) return out;
      const a = segs[k][0];
      // Each measurement runs to where the NEXT word starts (and the last one to the
      // end of the chunk), so the inter-word space is inside a rectangle rather than a
      // hole between two of them. Measuring the bare words instead leaves gaps a space
      // wide, which `mergeLineRects` would honour as real — and a rebuilt highlight
      // would come out word-by-word instead of as the line the reviewer dragged.
      const stop = k + 1 < segs.length ? segs[k + 1][0] : chunk.to;
      budget -= (stop - a);
      const word = measure(chunk.node, a, stop);
      if (word) { out.push(word); continue; }
      // It would not measure as one Range — fall back to its characters, which is the
      // narrowest question the layout engine can be asked (and the one 98.md §16 found
      // WebKit still answers correctly on transformed text).
      for (let i = a; i < stop; i++) {
        const ch = measure(chunk.node, i, i + 1);
        if (ch) out.push(ch);
      }
    }
  }
  return out;
}

/**
 * captureSelectionRects(range, host, { scale, maxChars })
 *   → { rects, source, suspect, reason }
 *
 * 117.md §46/§47 — THE capture decision, in one pure place: take the browser's own
 * client rects, audit them against the text layer, and rebuild them from per-word
 * geometry when the audit distrusts what came back. `rects` are page-local CSS px,
 * already merged into one rectangle per rendered line; an empty list means "there is
 * nothing honest to highlight here", never a guess.
 */
export function captureSelectionRects(range, host, { scale = 1, maxChars = 4000 } = {}) {
  const s = +scale > 0 ? +scale : 1;
  const tol = selectionThresholds(s);
  const merge = (rects) => mergeLineRects(rects, { lineGap: tol.lineGap });
  let raw = [];
  try { raw = Array.from((range && range.getClientRects && range.getClientRects()) || []); } catch { raw = []; }
  const direct = auditSelectionRects(raw, host, { minSize: tol.minSize });
  if (!direct.suspect && direct.rects.length) {
    return { rects: merge(direct.rects), source: 'client-rects', suspect: false, reason: '' };
  }
  const rebuilt = auditSelectionRects(
    rectsFromRangeGeometry(range, { maxChars }), host, { minSize: tol.minSize },
  );
  if (rebuilt.rects.length) {
    return { rects: merge(rebuilt.rects), source: 'geometry', suspect: true, reason: direct.reason || 'rebuilt' };
  }
  if (direct.rects.length) {
    // Geometry could not improve on it (an environment with no measurable layout).
    // Using what the browser said is still better than refusing — it is flagged.
    return { rects: merge(direct.rects), source: 'client-rects', suspect: true, reason: direct.reason };
  }
  return { rects: [], source: 'none', suspect: direct.suspect, reason: direct.reason || 'empty' };
}

/* ── 117.md §46 — the pdf.js text-layer selection sink ────────────────────── */

/** `Range.compareBoundaryPoints` constants, named so the rule below reads. */
export const RANGE_START_TO_END = 1;
export const RANGE_END_TO_END = 2;

/**
 * endOfContentPlacement(range, prevRange) → { modifyStart }
 *
 * The one DECISION inside pdf.js's `TextLayerBuilder` global selection handler, lifted
 * out so it is testable: when the live range still ends where the previous one ended
 * (or its start has arrived at that end), the user is dragging the START of the
 * selection, so the "end of content" sink belongs BEFORE the anchor rather than after
 * it. Getting this backwards is what makes a WebKit backward drag select the wrong
 * spans. Total: no previous range, or a Range that cannot compare, means "after".
 */
export function endOfContentPlacement(range, prevRange) {
  if (!range || !prevRange || typeof range.compareBoundaryPoints !== 'function') return { modifyStart: false };
  let sameEnd = false, startAtEnd = false;
  try { sameEnd = range.compareBoundaryPoints(RANGE_END_TO_END, prevRange) === 0; } catch { sameEnd = false; }
  try { startAtEnd = range.compareBoundaryPoints(RANGE_START_TO_END, prevRange) === 0; } catch { startAtEnd = false; }
  return { modifyStart: !!(sameEnd || startAtEnd) };
}

/* ── 117.md §47 — rendering resolution ────────────────────────────────────── */

/**
 * The backing-store ceiling. §76 states that device pixel ratio touches the CANVAS
 * ONLY and can never move a stored annotation; keeping the clamp and the media query
 * here — beside that claim — is what lets a unit test hold the viewer to it.
 */
export const MAX_RENDER_DPR = 2;

/** The scale a page canvas is rasterized at: the device ratio, capped at 2. */
export function clampRenderDpr(value) {
  const n = +value;
  return Math.min(Number.isFinite(n) && n > 0 ? n : 1, MAX_RENDER_DPR);
}

/**
 * The media query that fires when the device pixel ratio LEAVES its current value —
 * `(resolution: Xdppx)` matches only while the ratio is exactly X, so a `change` event
 * means "the ratio moved" and the listener must be re-armed against the new one. Built
 * from the RAW ratio, never the clamped one, so a 3 → 2 move (dragging the window to a
 * different monitor) is still detected even though both clamp to 2.
 */
export function dprMediaQuery(value) {
  const n = +value;
  const raw = Number.isFinite(n) && n > 0 ? n : 1;
  return `(resolution: ${raw}dppx)`;
}

/* ── 117.md §46/§48 — fit-width must not oscillate with the scrollbar ─────── */

/**
 * fitWidthFromContainer({ offsetWidth, clientWidth, reserved }) → { width, reserved }
 *
 * THE DECISION that stops a fit-width PDF panel from re-laying-out forever, and the
 * reason it lives beside the other §46-§48 rules: on WebKit it is what made "text
 * selection does not work in Safari" true even after the sink and the capture audit
 * were right.
 *
 * Fit-width sizes the page from the container's CONTENT width, and a classic
 * (space-taking) vertical scrollbar is subtracted from that width. A document whose
 * height lands within a scrollbar's width of the viewport is therefore BISTABLE: with
 * the bar the page is ~10 px narrower and overflows, so the bar is right; re-fitting to
 * that narrower width makes the page short enough to fit, so the bar goes; the container
 * widens; re-fit; forever. Every cycle rebuilds the text layer, so a selection lives a
 * few hundred milliseconds. Blink hides it behind overlay scrollbars; WebKit does not.
 *
 * The rule: once a container has shown a vertical scrollbar, that width stays RESERVED,
 * so the number fed to fit-width is the same whether or not the bar is showing right now
 * and the loop cannot close. `offsetWidth - clientWidth` is that width; a border sits in
 * both the live and the remembered term, so it cancels and is never double-counted.
 * Monotone in `reserved` (it only ever grows), which is what makes the fixed point
 * reachable in one step. Pure: the caller owns the remembered value.
 */
export function fitWidthFromContainer({ offsetWidth, clientWidth, reserved = 0 } = {}) {
  const held = +reserved > 0 ? +reserved : 0;
  const cw = +clientWidth;
  if (!Number.isFinite(cw) || cw <= 0) return { width: 0, reserved: held };
  const ow = +offsetWidth;
  const live = Number.isFinite(ow) ? Math.max(0, ow - cw) : 0;
  const keep = Math.max(held, live);
  return { width: Math.max(0, cw - (keep - live)), reserved: keep };
}

/* ── Page indexing (§93/§94) ──────────────────────────────────────────────── */

/**
 * indexByPage(annotations) → Map<page, annotation[]>
 *
 * §93: a 300-page PDF must never render thousands of invisible overlay components.
 * The viewer only mounts pages inside its ±900 px virtualization window, so the
 * overlay for a page is looked up from this index and the rest of the document
 * costs one Map entry each. Rebuilt only when the ANNOTATION LIST changes — not on
 * scroll, not on zoom.
 */
export function indexByPage(annotations) {
  const map = new Map();
  for (const a of (Array.isArray(annotations) ? annotations : [])) {
    if (!a || a.deleted) continue;
    const p = Math.trunc(+a.page);
    if (!(p >= 1)) continue;
    const bucket = map.get(p);
    if (bucket) bucket.push(a); else map.set(p, [a]);
  }
  // Stable document order inside a page: top-first, then left.
  for (const [, bucket] of map) {
    bucket.sort((x, y) => {
      const bx = rectsBounds(x.rects), by = rectsBounds(y.rects);
      if (!bx || !by) return 0;
      return (by.y1 - bx.y1) || (bx.x0 - by.x0);
    });
  }
  return map;
}

/** Document order across the whole PDF — the §98 annotation list. */
export function sortForList(annotations) {
  return (Array.isArray(annotations) ? annotations : [])
    .filter((a) => a && !a.deleted)
    .slice()
    .sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      const ba = rectsBounds(a.rects), bb = rectsBounds(b.rects);
      if (!ba || !bb) return 0;
      return (bb.y1 - ba.y1) || (ba.x0 - bb.x0);
    });
}

/* ── Permission mirror (§83) ──────────────────────────────────────────────── */

/**
 * The CLIENT mirror of server/annotations/pdfAnnotationModel.mutationDecision.
 * Purely for rendering (which buttons exist); the server re-decides every request,
 * so a tampered client gets a structured 403, never a write.
 */
export function canMutateAnnotation(annotation, { userId, canModerate } = {}) {
  if (!annotation || annotation.deleted) return false;
  if (userId && annotation.authorId === userId) return true;
  return !!canModerate;
}

/** True when the viewing user authored this annotation (drives §81 muting). */
export function isOwnAnnotation(annotation, userId) {
  return !!(annotation && userId && annotation.authorId === userId);
}

/**
 * §82/§100 — the accessible label. Ownership and colour must BOTH be readable
 * without seeing the colour, so the label always names the author and the colour.
 */
export function annotationAriaLabel(annotation, userId) {
  if (!annotation) return 'Highlight';
  const own = isOwnAnnotation(annotation, userId);
  const who = own ? 'you' : (annotation.authorName || 'another member');
  const color = colorFor(annotation.color).label.toLowerCase();
  const excerpt = String(annotation.selectedText || '').trim().slice(0, 80);
  const note = annotation.comment ? ' — has a comment' : '';
  return `${color} highlight by ${who}${excerpt ? `: ${excerpt}` : ''}${note}`;
}

/* ── Mount gate (§89) ─────────────────────────────────────────────────────── */

/**
 * createMountGate() — the "is this hook instance still mounted?" gate that every
 * async continuation in `usePdfAnnotations` checks before touching state.
 *
 * WHY IT IS A FACTORY AND NOT A `useRef(true)` + teardown-only effect. React 18
 * StrictMode double-invokes mount effects in development: mount → cleanup → mount.
 * A gate that is only ever CLOSED (by the cleanup) is therefore closed permanently
 * after the first simulated unmount, and every later server answer — the capability
 * list, the annotation list, an optimistic reconcile — is silently discarded. That
 * is exactly the shape of bug an SSR-only unit suite cannot see and a production
 * build does not reproduce, so the invariant is pinned here instead:
 *
 *   arming the gate again after a teardown MUST re-open it.
 *
 * `alive` starts open so a continuation that somehow resolves between the first
 * render and the first effect still lands, which is the pre-existing behaviour.
 */
export function createMountGate() {
  let alive = true;
  return {
    isAlive: () => alive,
    /** Call from a mount effect and RETURN the result as that effect's cleanup. */
    arm() { alive = true; return () => { alive = false; }; },
  };
}

/* ── Optimistic list reducer (§89/§91) ────────────────────────────────────── */

/**
 * A locally-created annotation before the server has answered. It carries the
 * `clientId` the POST is idempotent on, so a retry (or a realtime refetch landing
 * first) can never duplicate the highlight.
 */
export function pendingAnnotation({ clientId, docHash, page, rects, selectedText, color, comment, recordId, studyId, authorId, authorName, now }) {
  return {
    id: `local:${clientId}`,
    clientId,
    docHash,
    page,
    rects: Array.isArray(rects) ? rects : [],
    selectedText: String(selectedText || '').slice(0, MAX_SELECTED_TEXT),
    color: colorFor(color).key,
    comment: String(comment || '').slice(0, MAX_COMMENT),
    recordId: recordId || null,
    studyId: studyId || null,
    authorId: authorId || '',
    authorName: authorName || '',
    revision: 0,
    deleted: false,
    pending: true,
    failed: false,
    createdAt: now || new Date().toISOString(),
    updatedAt: now || new Date().toISOString(),
  };
}

/** Replace (or append) one annotation by clientId — the ack reconcile step. */
export function upsertByClientId(list, next) {
  if (!next) return Array.isArray(list) ? list : [];
  const arr = Array.isArray(list) ? list : [];
  const i = arr.findIndex((a) => a && a.clientId === next.clientId);
  if (i < 0) return [...arr, next];
  const copy = arr.slice();
  copy[i] = { ...arr[i], ...next };
  return copy;
}

/** Flag a create/update that failed to persist (§89 "do not pretend it persisted"). */
export function markFailed(list, clientId) {
  return (Array.isArray(list) ? list : []).map((a) => (
    a && a.clientId === clientId ? { ...a, pending: false, failed: true } : a
  ));
}

/** Drop a locally-created row that will never exist server-side (revert path). */
export function dropByClientId(list, clientId) {
  return (Array.isArray(list) ? list : []).filter((a) => !(a && a.clientId === clientId));
}

/**
 * mergeServerList(local, server, { full })
 *
 * The reconcile step for BOTH the initial fetch and the `?since=` delta (§91).
 * Rules:
 *   - a server row always wins over the local copy of the SAME clientId (it is the
 *     canonical revision), which is how an optimistic insert gets its real id;
 *   - tombstones (`deleted`) remove the row;
 *   - a still-PENDING local row with no server twin survives a delta merge (its
 *     POST may still be in flight) but not a FULL refresh, where the server list is
 *     authoritative for everything already acknowledged;
 *   - duplicate events are therefore idempotent — merging the same payload twice
 *     produces the same list (§91).
 */
export function mergeServerList(local, server, { full = false } = {}) {
  const incoming = Array.isArray(server) ? server : [];
  const byClient = new Map();
  for (const a of (Array.isArray(local) ? local : [])) {
    if (a && a.clientId) byClient.set(a.clientId, a);
  }
  for (const s of incoming) {
    if (!s || !s.clientId) continue;
    if (s.deleted) { byClient.delete(s.clientId); continue; }
    const prev = byClient.get(s.clientId);
    byClient.set(s.clientId, { ...(prev || {}), ...s, pending: false, failed: false });
  }
  if (full) {
    const seen = new Set(incoming.map((s) => s && s.clientId));
    for (const [cid, a] of [...byClient]) {
      // Anything the server did not return and that is not an in-flight local
      // insert no longer exists (deleted by a collaborator, or a different document).
      if (!seen.has(cid) && !(a && (a.pending || a.failed))) byClient.delete(cid);
    }
  }
  return [...byClient.values()];
}

export default {
  ANNOTATION_COLORS, ANNOTATION_COLOR_KEYS, DEFAULT_ANNOTATION_COLOR,
  MAX_SELECTED_TEXT, MAX_COMMENT, colorFor,
  toPageRects, mergeLineRects, cssRectsToUser, userRectsToCss, rectsBounds,
  selectionThresholds, selectionCaptureDelay, SELECTION_SETTLE_MS,
  auditSelectionRects, rangeTextChunks, rectsFromRangeGeometry, captureSelectionRects,
  SELECTION_RECT_SLACK_PX, endOfContentPlacement, RANGE_START_TO_END, RANGE_END_TO_END,
  clampRenderDpr, dprMediaQuery, MAX_RENDER_DPR,
  indexByPage, sortForList, createMountGate,
  canMutateAnnotation, isOwnAnnotation, annotationAriaLabel,
  pendingAnnotation, upsertByClientId, markFailed, dropByClientId, mergeServerList,
};
