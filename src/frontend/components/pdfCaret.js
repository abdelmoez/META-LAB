/**
 * pdfCaret.js — 79.md §4 + 98.md §16. The click-to-pick caret resolvers for
 * AppPdfViewer's text layer, extracted as a sibling module (the pdfSearch/pdfRevealBox
 * precedent) so the Safari/WebKit behavior is unit-testable without pdf.js/React.
 *
 * caretOffsetInSpan resolves the character offset within a text-layer span's ORIGINAL
 * text (dataset.t) at a screen point. Highlight passes replace a span's single text
 * node with text + <mark> nodes, but the concatenated textContent still equals
 * dataset.t, so we sum node lengths in DFS order up to the caret node.
 *
 * Safari/WebKit (79.md §4): document.caretPositionFromPoint arrived only in Safari 17,
 * and both caret-from-point APIs can return a caret in a DIFFERENT node — or nothing —
 * for the CSS-transformed text-layer spans this viewer draws. When the caret APIs don't
 * land inside `span`, we fall back to a purely GEOMETRIC resolver
 * (Range.getBoundingClientRect per character, supported everywhere).
 *
 * 98.md §16 — wrong-but-PLAUSIBLE carets: WebKit's caretRangeFromPoint mis-maps the x
 * coordinate on CSS-scaled text (pdf.js applies a per-span scaleX transform), returning
 * the RIGHT node with a WRONG offset — so the geometry fallback never ran and the
 * capture snapped to an adjacent token. The caret API's answer is therefore
 * CROSS-VALIDATED before it is trusted: a one-character Range at the returned offset
 * must sit at (or within a few px of) the click point, else the offset is distrusted
 * and the geometric resolver decides. Feature-detected only — no UA sniffing; an
 * environment whose Ranges measure 0×0 (no layout, e.g. jsdom) keeps the caret answer,
 * because the check may only VETO a caret it can actually disprove.
 */

/** Px slack for the caret-vs-click agreement check: half a glyph of drift is normal
 *  (the caret sits BETWEEN characters), a whole token of drift is the WebKit bug. */
const CARET_AGREE_TOL_PX = 4;

/**
 * caretAgreesWithPoint(node, offset, clientX, clientY[, tol]) — 98.md §16. True when
 * the (node, offset) caret plausibly belongs to the click point, judged by the
 * bounding rect(s) of the character(s) adjacent to the caret. Only text nodes are
 * checkable; unmeasurable rects (0×0) mean "cannot disprove" → true.
 */
export function caretAgreesWithPoint(node, offset, clientX, clientY, tol = CARET_AGREE_TOL_PX) {
  if (!node || node.nodeType !== 3) return true; // element-offset carets: not checkable here
  const len = node.textContent ? node.textContent.length : 0;
  if (!len) return true;
  const doc = node.ownerDocument;
  if (!doc || typeof doc.createRange !== 'function') return true;
  // The caret sits BETWEEN characters: agree when the click is on either neighbour.
  const pairs = [];
  if (offset < len) pairs.push([offset, offset + 1]);
  if (offset > 0) pairs.push([offset - 1, offset]);
  let sawMeasurable = false;
  for (const [a, b] of pairs) {
    let r;
    try {
      const rng = doc.createRange();
      rng.setStart(node, a); rng.setEnd(node, b);
      r = rng.getBoundingClientRect();
    } catch { continue; }
    if (!r || (r.width === 0 && r.height === 0)) continue;
    sawMeasurable = true;
    if (clientX >= r.left - tol && clientX <= r.right + tol
      && clientY >= r.top - tol && clientY <= r.bottom + tol) return true;
  }
  return sawMeasurable ? false : true;
}

/**
 * caretOffsetInSpan(span, clientX, clientY) — the character offset within `span`'s
 * concatenated text at the screen point, or null when nothing is resolvable. Tries the
 * native caret-from-point APIs first (cross-validated per 98.md §16 above), then the
 * geometric resolver.
 */
export function caretOffsetInSpan(span, clientX, clientY) {
  const doc = span && span.ownerDocument;
  if (!doc) return null;
  let node = null, off = 0;
  try {
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(clientX, clientY);
      if (pos && span.contains(pos.offsetNode)) { node = pos.offsetNode; off = pos.offset; }
    }
    if (!node && doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(clientX, clientY);
      if (r && span.contains(r.startContainer)) { node = r.startContainer; off = r.startOffset; }
    }
  } catch { node = null; }
  // 98.md §16 — right node, wrong offset (WebKit x mis-map on scaled text): distrust a
  // caret whose neighbouring character rects don't contain the click; geometry decides.
  if (node && !caretAgreesWithPoint(node, off, clientX, clientY)) node = null;
  if (node) {
    let total = 0, done = false;
    const walk = (n) => {
      if (done) return;
      if (n === node) {
        if (n.nodeType === 3) total += off;
        else for (let i = 0; i < off && i < n.childNodes.length; i++) total += (n.childNodes[i].textContent || '').length;
        done = true; return;
      }
      if (n.nodeType === 3) { total += (n.textContent || '').length; return; }
      for (const c of n.childNodes) { walk(c); if (done) return; }
    };
    walk(span);
    if (done) return total;
  }
  // Fallback: browser-independent geometry (fixes Safari/WebKit click-to-pick).
  return caretOffsetByGeometry(span, clientX, clientY);
}

/**
 * caretOffsetByGeometry(span, clientX, clientY) — character offset within `span`
 * nearest the screen point, using per-character Range rects only. Returns the offset
 * of the character whose rect contains the point, else the nearest character on the
 * clicked line; null when the span has no measurable text.
 */
export function caretOffsetByGeometry(span, clientX, clientY) {
  try {
    const doc = span && span.ownerDocument;
    if (!doc || typeof doc.createRange !== 'function') return null;
    let acc = 0, best = null, bestDist = Infinity;
    const rng = doc.createRange();
    const consider = (textNode) => {
      const len = textNode.textContent ? textNode.textContent.length : 0;
      for (let i = 0; i < len; i++) {
        let r;
        try { rng.setStart(textNode, i); rng.setEnd(textNode, i + 1); r = rng.getBoundingClientRect(); }
        catch { continue; }
        if (!r || (r.width === 0 && r.height === 0)) continue;
        const onLine = clientY >= r.top - 2 && clientY <= r.bottom + 2;
        if (onLine && clientX >= r.left && clientX <= r.right) return acc + i; // exact hit
        const mid = (r.left + r.right) / 2;
        const dist = Math.abs(clientX - mid) + (onLine ? 0 : 10000); // prefer the clicked line
        if (dist < bestDist) { bestDist = dist; best = acc + i; }
      }
      acc += len;
      return null;
    };
    const walk = (n) => {
      if (n.nodeType === 3) return consider(n);
      for (const c of n.childNodes) { const hit = walk(c); if (hit != null) return hit; }
      return null;
    };
    const hit = walk(span);
    return hit != null ? hit : best;
  } catch { return null; }
}
