/**
 * menuPosition.js — 108.md §21 "context menu … appears close to the pointer …
 * remains within viewport boundaries". The pure placement maths for
 * pointer-anchored overlays, extracted so it can be unit-tested without a DOM
 * (house style: DOM adapter thin, rules pure).
 *
 * The repo had FIVE independent clamp implementations and no shared one:
 *   components/Tooltip.jsx           both axes + flip   (the best of them — adapted here)
 *   pages/admin/users/RowMenu.jsx    horizontal only, no vertical flip
 *   searchBuilder/…/TermEditorPopover.jsx  horizontal + flipUp
 *   screening/…/PresenceIndicator.jsx      horizontal + top cap
 *   stitch/primitives/overlay.jsx StitchTooltip   no clamping at all
 * A sixth ad-hoc copy was the path of least resistance and the wrong one.
 *
 * MODEL: a context menu opens DOWN and RIGHT from the pointer, like every native
 * menu. When it would overflow an edge it FLIPS to the other side of the pointer
 * (so the menu never covers the thing that was right-clicked); if it still does
 * not fit — a menu taller than the viewport, a pointer in a corner — it CLAMPS to
 * the `gap` margin. Clamping runs last on both axes, so the returned rectangle is
 * always inside the viewport as far as the viewport allows.
 *
 * Pure and SSR-safe: no window, no document, no measurement. The caller measures
 * (getBoundingClientRect / offsetWidth) and passes numbers in.
 */

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * placeMenu({ x, y, menuWidth, menuHeight, viewportWidth, viewportHeight, gap })
 *   → { left, top, flippedX, flippedY }
 *
 * @param {number} x,y                     pointer position in viewport coords
 * @param {number} menuWidth,menuHeight    measured menu size
 * @param {number} viewportWidth,viewportHeight
 * @param {number} [gap=8]                 minimum margin from every viewport edge
 * @returns {{left:number, top:number, flippedX:boolean, flippedY:boolean}}
 *   `left`/`top` are `position: fixed` coordinates. `flippedX`/`flippedY` report
 *   which side the menu ended up on, so a caller can mirror an arrow/transform
 *   origin — the placement itself is already final.
 */
export function placeMenu({
  x, y, menuWidth, menuHeight, viewportWidth, viewportHeight, gap = 8,
} = {}) {
  const g = Math.max(0, num(gap, 8));
  const px = num(x);
  const py = num(y);
  const mw = Math.max(0, num(menuWidth));
  const mh = Math.max(0, num(menuHeight));
  const vw = Math.max(0, num(viewportWidth));
  const vh = Math.max(0, num(viewportHeight));

  // X: prefer right of the pointer; flip left only when that side actually fits.
  let left = px;
  let flippedX = false;
  if (px + mw > vw - g && px - mw >= g) {
    left = px - mw;
    flippedX = true;
  }

  // Y: prefer below the pointer; flip above only when that side actually fits.
  let top = py;
  let flippedY = false;
  if (py + mh > vh - g && py - mh >= g) {
    top = py - mh;
    flippedY = true;
  }

  // Final clamp. Math.min first, then Math.max, so a menu larger than the
  // viewport pins to the top/left margin instead of being pushed off-screen.
  left = Math.max(g, Math.min(left, vw - mw - g));
  top = Math.max(g, Math.min(top, vh - mh - g));

  return { left, top, flippedX, flippedY };
}

export default placeMenu;
