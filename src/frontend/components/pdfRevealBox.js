/**
 * pdfRevealBox.js — 83.md §3. PURE geometry for the persistent jump-to-source
 * highlight in AppPdfViewer. No DOM, no React — unit-testable.
 *
 * Coordinate contract (matches articleProvenance bbox + AppPdfViewer cssToUser):
 * regions are PDF USER-SPACE rectangles {x0,y0,x1,y1} at scale 1, x right from the
 * page's left edge, y UP from the page's bottom. CSS space is y DOWN from the top,
 * multiplied by the current render scale. So: left = x0·s, top = (H − y1)·s.
 */

const finite = (v) => Number.isFinite(+v);

/** True when `region` is a usable exact rectangle. */
export function isExactRegion(region) {
  return !!(region && ['x0', 'y0', 'x1', 'y1'].every((k) => finite(region[k]))
    && +region.x1 > +region.x0 && +region.y1 > +region.y0);
}

/**
 * revealBoxFor(region, pageDims, scale) — the CSS-px box for a source highlight on
 * its page, or a page-level marker when no exact region is stored (a page-only
 * provenance must show a DISTINCT indicator, never a fabricated location).
 * @param {object|null} region  PDF user-space rect or null
 * @param {{w:number,h:number}|null} pageDims  intrinsic page dims at scale 1
 * @param {number} scale  current render scale
 * @returns {{kind:'exact',left,top,width,height}|{kind:'page'}|null}
 */
export function revealBoxFor(region, pageDims, scale) {
  if (!pageDims || !(+scale > 0)) return null;
  if (!isExactRegion(region)) return { kind: 'page' };
  const H = +pageDims.h;
  return {
    kind: 'exact',
    left: +region.x0 * scale,
    top: (H - +region.y1) * scale,
    width: (+region.x1 - +region.x0) * scale,
    height: (+region.y1 - +region.y0) * scale,
  };
}

/**
 * revealScrollTop(args) — the scroll-container scrollTop that comfortably centres a
 * source highlight in the viewport (83.md §3 "scroll the exact source location into
 * view … centred comfortably"). Page-only reveals land on the page top.
 * @param {{ pageTop:number, box:object|null, viewportH:number, pagePad?:number }} args
 *   pageTop — the page's offset in scroll content px; box — revealBoxFor() result;
 *   viewportH — scroll container height; pagePad — the column padding above the page.
 * @returns {number} clamped (≥0) scrollTop
 */
export function revealScrollTop({ pageTop, box, viewportH, pagePad = 8 }) {
  const top = +pageTop || 0;
  if (!box || box.kind !== 'exact') return Math.max(0, top - pagePad);
  const vh = Math.max(0, +viewportH || 0);
  // Centre the box vertically, but never scroll ABOVE the box's own page position by
  // more than the page top (small boxes near a page top stay visible, not clipped).
  const centred = top + box.top - Math.max(16, (vh - box.height) / 2);
  return Math.max(0, centred);
}
